'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  openSession,
  takeTurn,
  finalizeSession,
  type PracticeMode,
  type InterviewContext,
  type TurnScores,
  type TurnHistoryEntry,
} from '@/lib/practice/interviewer';

/**
 * Practice-mode server actions. Thin wrappers around `lib/practice/interviewer.ts` that
 * also persist turns + summary to Supabase via the user-scoped client (RLS keeps writes
 * within the user's own rows).
 *
 * State lives entirely in the DB:
 *   - sessions row (kind='practice')
 *   - session_events rows for each interviewer_question, candidate_answer, interviewer_feedback
 *   - session_summaries row when we finalize
 *
 * Loading the "current state" of a practice session means replaying session_events in
 * chronological order; see the page loader in /app/practice/[id]/page.tsx.
 */

export type { PracticeMode };

const VALID_MODES: readonly PracticeMode[] = ['behavioral', 'coding', 'system_design'];
const MAX_QUESTIONS_DEFAULT = 6;

export interface StartResult {
  readonly ok: boolean;
  readonly sessionId?: string;
  readonly error?: string;
}

export interface AnswerResult {
  readonly ok: boolean;
  readonly done?: boolean;
  readonly error?: string;
}

export interface EndResult {
  readonly ok: boolean;
  readonly error?: string;
}

export async function startPracticeAction(formData: FormData): Promise<StartResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  const modeRaw = (formData.get('mode') as string | null) ?? 'behavioral';
  if (!VALID_MODES.includes(modeRaw as PracticeMode)) {
    return { ok: false, error: `invalid mode: ${modeRaw}` };
  }
  const mode = modeRaw as PracticeMode;
  const role = ((formData.get('role') as string | null) ?? '').trim() || undefined;
  const company = ((formData.get('company') as string | null) ?? '').trim() || undefined;

  // Pull resume + JD context if the user has defaults. Keeps opening questions targeted.
  const [{ data: resume }, { data: jd }] = await Promise.all([
    supabase
      .from('resumes')
      .select('parsed_text')
      .eq('is_default', true)
      .maybeSingle(),
    supabase
      .from('job_descriptions')
      .select('body')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const ctx: InterviewContext = {
    maxQuestions: MAX_QUESTIONS_DEFAULT,
    ...(role ? { role } : {}),
    ...(company ? { company } : {}),
    ...((resume as { parsed_text?: string } | null)?.parsed_text
      ? { resumeText: (resume as { parsed_text: string }).parsed_text }
      : {}),
    ...((jd as { body?: string } | null)?.body
      ? { jdText: (jd as { body: string }).body }
      : {}),
  };

  let openingQuestion: string;
  try {
    const result = await openSession(mode, ctx);
    openingQuestion = result.question;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Insert the sessions row first so FK-child session_events can reference it.
  const { data: sess, error: sessErr } = await supabase
    .from('sessions')
    .insert({
      user_id: user.id,
      kind: 'practice',
      mode,
      language: 'en',
      llm_choice: 'gemini',
    })
    .select('id')
    .single();
  if (sessErr || !sess) {
    return { ok: false, error: sessErr?.message ?? 'sessions insert failed' };
  }

  const sessionId = (sess as { id: string }).id;

  const { error: evErr } = await supabase.from('session_events').insert({
    session_id: sessionId,
    kind: 'interviewer_question',
    payload: { index: 0, text: openingQuestion, mode, ctx: sanitizeCtx(ctx) },
  });
  if (evErr) {
    // Row is half-written but recoverable on next call; surface the error so the user
    // doesn't end up on a broken page.
    return { ok: false, error: `session_events: ${evErr.message}` };
  }

  revalidatePath('/app/practice');
  return { ok: true, sessionId };
}

export async function answerPracticeAction(
  sessionId: string,
  answer: string,
): Promise<AnswerResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  const text = answer.trim();
  if (text.length === 0) return { ok: false, error: 'answer is empty' };
  if (text.length > 8_000) return { ok: false, error: 'answer too long (max 8000 chars)' };

  // Load session + history. RLS restricts to this user's rows.
  const [{ data: session, error: sErr }, { data: events, error: eErr }] = await Promise.all([
    supabase.from('sessions').select('id, mode, ended_at').eq('id', sessionId).maybeSingle(),
    supabase
      .from('session_events')
      .select('kind, payload, ts')
      .eq('session_id', sessionId)
      .order('ts', { ascending: true }),
  ]);
  if (sErr || !session) return { ok: false, error: sErr?.message ?? 'session not found' };
  if ((session as { ended_at: string | null }).ended_at) {
    return { ok: false, error: 'session already ended' };
  }
  if (eErr) return { ok: false, error: eErr.message };

  const replay = replayHistory(events ?? []);
  const latestQ = replay.pendingQuestion;
  if (!latestQ) return { ok: false, error: 'no open question to answer' };

  // Record the candidate's answer first.
  const answerIndex = replay.history.length;
  const { error: aErr } = await supabase.from('session_events').insert({
    session_id: sessionId,
    kind: 'candidate_answer',
    payload: { index: answerIndex, text },
  });
  if (aErr) return { ok: false, error: aErr.message };

  const mode = (session as { mode: PracticeMode }).mode;
  const ctx: InterviewContext = replay.ctx ?? { maxQuestions: MAX_QUESTIONS_DEFAULT };
  const questionsAskedSoFar = replay.history.length + 1;

  let turn;
  try {
    turn = await takeTurn({
      mode,
      ctx,
      history: [...replay.history, { question: latestQ, answer: text }],
      latestAnswer: text,
      questionsAskedSoFar,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const { error: fbErr } = await supabase.from('session_events').insert({
    session_id: sessionId,
    kind: 'interviewer_feedback',
    payload: { index: answerIndex, scores: turn.scores, notes: turn.notes },
  });
  if (fbErr) return { ok: false, error: fbErr.message };

  if (turn.nextQuestion) {
    const { error: qErr } = await supabase.from('session_events').insert({
      session_id: sessionId,
      kind: 'interviewer_question',
      payload: { index: questionsAskedSoFar, text: turn.nextQuestion },
    });
    if (qErr) return { ok: false, error: qErr.message };
    revalidatePath(`/app/practice/${sessionId}`);
    return { ok: true, done: false };
  }

  // No next question → finalize.
  const finalized = await endPracticeInternal(supabase, sessionId);
  if (!finalized.ok) return finalized;
  revalidatePath(`/app/practice/${sessionId}`);
  revalidatePath('/app/practice');
  return { ok: true, done: true };
}

export async function endPracticeAction(sessionId: string): Promise<EndResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  const result = await endPracticeInternal(supabase, sessionId);
  revalidatePath(`/app/practice/${sessionId}`);
  revalidatePath('/app/practice');
  return result;
}

async function endPracticeInternal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
): Promise<EndResult> {
  const { data: session } = await supabase
    .from('sessions')
    .select('id, mode, started_at, ended_at, user_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return { ok: false, error: 'session not found' };
  if ((session as { ended_at: string | null }).ended_at) return { ok: true }; // already ended

  const { data: events } = await supabase
    .from('session_events')
    .select('kind, payload')
    .eq('session_id', sessionId)
    .order('ts', { ascending: true });
  const replay = replayHistory(events ?? []);

  let final;
  try {
    final = await finalizeSession({
      mode: (session as { mode: PracticeMode }).mode,
      ctx: replay.ctx ?? {},
      history: replay.history,
      turnScores: replay.scores,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const startedAt = new Date(
    (session as { started_at: string }).started_at,
  ).getTime();
  const durationS = Math.max(0, Math.round((Date.now() - startedAt) / 1_000));

  const { error: sumErr } = await supabase.from('session_summaries').insert({
    session_id: sessionId,
    user_id: (session as { user_id: string }).user_id,
    scores: final.scores,
    highlights: final.highlights,
    improvements: final.improvements,
  });
  if (sumErr) return { ok: false, error: sumErr.message };

  const { error: updErr } = await supabase
    .from('sessions')
    .update({ ended_at: new Date().toISOString(), duration_s: durationS })
    .eq('id', sessionId);
  if (updErr) return { ok: false, error: updErr.message };

  return { ok: true };
}

// ---- Event replay ---------------------------------------------------------

interface ReplayState {
  readonly history: TurnHistoryEntry[];
  readonly scores: TurnScores[];
  readonly pendingQuestion: string | null;
  readonly ctx: InterviewContext | null;
}

interface RawEvent {
  kind: string;
  payload: Record<string, unknown>;
}

function replayHistory(events: readonly RawEvent[]): ReplayState {
  const history: { question: string; answer: string }[] = [];
  const scores: TurnScores[] = [];
  let pendingQuestion: string | null = null;
  let ctx: InterviewContext | null = null;

  // Invariant: questions alternate with answers; a trailing question without an answer
  // becomes `pendingQuestion`. Feedback events are associated with the answer at the
  // same index and contribute to `scores` but don't alter the history chain.
  for (const ev of events) {
    const p = ev.payload ?? {};
    if (ev.kind === 'interviewer_question') {
      const text = typeof p['text'] === 'string' ? (p['text'] as string) : '';
      const storedCtx = (p['ctx'] as InterviewContext | undefined) ?? null;
      if (storedCtx && !ctx) ctx = storedCtx;
      // A fresh question supersedes any prior pending one.
      pendingQuestion = text;
    } else if (ev.kind === 'candidate_answer') {
      const text = typeof p['text'] === 'string' ? (p['text'] as string) : '';
      if (pendingQuestion !== null) {
        history.push({ question: pendingQuestion, answer: text });
        pendingQuestion = null;
      }
    } else if (ev.kind === 'interviewer_feedback') {
      const rawScores = p['scores'] as Record<string, unknown> | undefined;
      if (rawScores) scores.push({
        communication: numOr0(rawScores['communication']),
        specificity: numOr0(rawScores['specificity']),
        structure: numOr0(rawScores['structure']),
        relevance: numOr0(rawScores['relevance']),
      });
    }
  }
  return { history, scores, pendingQuestion, ctx };
}

function numOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function sanitizeCtx(ctx: InterviewContext): InterviewContext {
  // Don't re-persist the full resume/JD into session_events on every turn — event rows
  // balloon otherwise. Keep only the small metadata fields.
  return {
    ...(ctx.role ? { role: ctx.role } : {}),
    ...(ctx.company ? { company: ctx.company } : {}),
    ...(ctx.maxQuestions !== undefined ? { maxQuestions: ctx.maxQuestions } : {}),
  };
}
