/**
 * Post-session recap generator for live interviews.
 *
 * Called once from the orchestrator's `stop()` path (fire-and-forget) after we've
 * written the final sessions row update. Reads the persisted session_events, asks Gemini
 * for a compact JSON recap, and writes the result to `session_summaries`.
 *
 * Uses `@google/generative-ai` directly rather than the llm-router because the router is
 * oriented around streaming Q→A answer generation with a resume/JD context — the recap
 * is a one-shot JSON call that doesn't fit that shape.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  buildLiveRecapPrompt,
  parseLiveRecapResponse,
  type LiveRecapEvent,
} from '@repo/prompts';
import { config } from '../config';
import { logger } from '../logger';

interface EventRow {
  kind: string;
  payload: Record<string, unknown>;
}

export interface GenerateLiveRecapInput {
  readonly supabase: SupabaseClient;
  readonly sessionId: string;
  readonly userId: string;
  readonly mode?: string;
  readonly role?: string;
  readonly company?: string;
}

/** Minimum events required before we bother calling Gemini. Otherwise we'd waste a */
/** call on a 5-second session with one transcript. */
const MIN_EVENTS_FOR_RECAP = 2;

export async function generateLiveRecap(input: GenerateLiveRecapInput): Promise<void> {
  if (!config.GOOGLE_API_KEY) {
    logger.info({ sessionId: input.sessionId }, 'recap skipped: GOOGLE_API_KEY unset');
    return;
  }

  const { data, error } = await input.supabase
    .from('session_events')
    .select('kind, payload')
    .eq('session_id', input.sessionId)
    .order('ts', { ascending: true });
  if (error) {
    logger.warn({ err: error.message, sessionId: input.sessionId }, 'recap: events read failed');
    return;
  }
  const events: LiveRecapEvent[] = ((data as EventRow[] | null) ?? []).map((r) => ({
    kind: r.kind,
    payload: r.payload,
  }));
  if (events.length < MIN_EVENTS_FOR_RECAP) {
    logger.info(
      { sessionId: input.sessionId, eventCount: events.length },
      'recap skipped: too few events',
    );
    return;
  }

  const prompt = buildLiveRecapPrompt({
    events,
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.company ? { company: input.company } : {}),
  });

  const client = new GoogleGenerativeAI(config.GOOGLE_API_KEY);
  const model = client.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
  });

  let raw: string;
  try {
    const result = await model.generateContent(prompt);
    raw = result.response.text();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), sessionId: input.sessionId },
      'recap: gemini call failed',
    );
    return;
  }

  const recap = parseLiveRecapResponse(raw);
  if (!recap) {
    logger.warn({ sessionId: input.sessionId, rawHead: raw.slice(0, 200) }, 'recap: bad JSON');
    return;
  }

  // Schema has scores NOT NULL — use all-zeros for live sessions, since we don't score.
  // Phase 8c's aggregator only counts practice sessions when computing averages, so the
  // zeros don't contaminate the overall score.
  const { error: insertErr } = await input.supabase.from('session_summaries').insert({
    session_id: input.sessionId,
    user_id: input.userId,
    scores: { communication: 0, specificity: 0, structure: 0, relevance: 0 },
    highlights: [...recap.topicsCovered.map((t) => `Topic: ${t}`), ...recap.highlights],
    improvements: recap.improvements,
  });
  if (insertErr) {
    logger.warn(
      { err: insertErr.message, sessionId: input.sessionId },
      'recap: summaries insert failed',
    );
    return;
  }
  logger.info(
    {
      sessionId: input.sessionId,
      topics: recap.topicsCovered.length,
      highlights: recap.highlights.length,
      improvements: recap.improvements.length,
    },
    'live recap written',
  );
}
