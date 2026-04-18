/**
 * Gemini-backed interviewer for practice mode. Wraps the prompt builders from
 * `@repo/prompts` with a JSON-schema response pass so callers get typed objects, not raw
 * model text.
 *
 * Choice of model: `gemini-2.5-flash-lite` — same as resume parsing. Low thinking budget
 * keeps turn latency under ~1s typical, which matters more than raw quality for a
 * back-and-forth practice session.
 */
import 'server-only';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  buildOpeningPrompt,
  buildTurnPrompt,
  buildFinalizePrompt,
  type PracticeMode,
  type InterviewContext,
  type TurnHistoryEntry,
} from '@repo/prompts';

export type { PracticeMode, InterviewContext, TurnHistoryEntry };

export interface TurnScores {
  readonly communication: number;
  readonly specificity: number;
  readonly structure: number;
  readonly relevance: number;
}

export interface TurnResult {
  readonly scores: TurnScores;
  readonly notes: string;
  /** null = interview is ending; caller should finalize. */
  readonly nextQuestion: string | null;
}

export interface FinalReview {
  readonly scores: TurnScores;
  readonly highlights: readonly string[];
  readonly improvements: readonly string[];
}

const MODEL_ID = 'gemini-2.5-flash-lite';

function client(): GoogleGenerativeAI {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error(
      'GOOGLE_API_KEY not set — practice mode needs Gemini. Set it in apps/web/.env.',
    );
  }
  return new GoogleGenerativeAI(key);
}

async function generateJson(prompt: string): Promise<unknown> {
  const model = client().getGenerativeModel({
    model: MODEL_ID,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.6 },
  });
  const result = await model.generateContent(prompt);
  const raw = result.response.text();
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(
      `interviewer returned invalid JSON: ${err instanceof Error ? err.message : String(err)}\nraw: ${raw.slice(0, 300)}`,
    );
  }
}

function asScores(v: unknown): TurnScores {
  const o = (v ?? {}) as Record<string, unknown>;
  const clamp = (x: unknown): number => {
    if (typeof x !== 'number' || !Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(5, Math.round(x * 10) / 10));
  };
  return {
    communication: clamp(o['communication']),
    specificity: clamp(o['specificity']),
    structure: clamp(o['structure']),
    relevance: clamp(o['relevance']),
  };
}

function asStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string' && item.trim().length > 0) out.push(item.trim());
    if (out.length >= max) break;
  }
  return out;
}

export async function openSession(
  mode: PracticeMode,
  ctx: InterviewContext,
): Promise<{ question: string }> {
  const parsed = await generateJson(buildOpeningPrompt(mode, ctx));
  const q = (parsed as { question?: unknown }).question;
  if (typeof q !== 'string' || q.trim().length === 0) {
    throw new Error('interviewer returned no opening question');
  }
  return { question: q.trim() };
}

export async function takeTurn(input: {
  mode: PracticeMode;
  ctx: InterviewContext;
  history: readonly TurnHistoryEntry[];
  latestAnswer: string;
  questionsAskedSoFar: number;
}): Promise<TurnResult> {
  const parsed = (await generateJson(
    buildTurnPrompt({
      mode: input.mode,
      ctx: input.ctx,
      history: input.history,
      latestAnswer: input.latestAnswer,
      questionsAskedSoFar: input.questionsAskedSoFar,
    }),
  )) as Record<string, unknown>;

  const next = parsed['nextQuestion'];
  const nextQuestion =
    typeof next === 'string' && next.trim().length > 0 ? next.trim() : null;
  const notes = typeof parsed['notes'] === 'string' ? (parsed['notes'] as string).trim() : '';

  return {
    scores: asScores(parsed['scores']),
    notes,
    nextQuestion,
  };
}

export async function finalizeSession(input: {
  mode: PracticeMode;
  ctx: InterviewContext;
  history: readonly TurnHistoryEntry[];
  turnScores: readonly TurnScores[];
}): Promise<FinalReview> {
  const parsed = (await generateJson(
    buildFinalizePrompt({
      mode: input.mode,
      ctx: input.ctx,
      history: input.history,
      turnScores: input.turnScores,
    }),
  )) as Record<string, unknown>;

  return {
    scores: asScores(parsed['scores']),
    highlights: asStringArray(parsed['highlights'], 4),
    improvements: asStringArray(parsed['improvements'], 4),
  };
}
