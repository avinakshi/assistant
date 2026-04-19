/**
 * Live-session recap prompt. Called once when a live interview ends and transcript
 * persistence was on. Turns the sequence of questions + AI-suggested answers into a
 * compact, useful recap the candidate can scan later.
 *
 * This is deliberately NOT a scorecard: in live mode we never captured the candidate's
 * actual spoken responses (only the interviewer's side via WASAPI loopback + the LLM's
 * suggestions to the candidate). Scoring the candidate would need their real answers,
 * which we don't have. Scoring the AI's suggestions is a different (and less useful)
 * exercise. So we stick to the facts: topics covered, key moments, suggested areas to
 * practice based on observed gaps.
 */

export interface LiveRecapEvent {
  readonly kind: 'transcript' | 'answer' | 'ocr' | string;
  readonly payload: Record<string, unknown>;
}

export interface BuildLiveRecapInput {
  /** All session_events rows in chronological order. */
  readonly events: readonly LiveRecapEvent[];
  /** Session mode — drives focus areas in the recap. */
  readonly mode?: string;
  /** Role the candidate was interviewing for, if known. */
  readonly role?: string;
  /** Company, if known. */
  readonly company?: string;
}

export function buildLiveRecapPrompt(input: BuildLiveRecapInput): string {
  // Flatten events into a readable transcript for the model. Strip verbose fields so
  // the prompt stays small; we only need the human-relevant text.
  const lines: string[] = [];
  let qIndex = 0;
  for (const ev of input.events) {
    if (ev.kind === 'transcript') {
      const text = typeof ev.payload['text'] === 'string' ? (ev.payload['text'] as string) : '';
      const isQuestion = ev.payload['isQuestion'] === true;
      if (isQuestion) {
        qIndex += 1;
        lines.push(`Q${qIndex}: ${text}`);
      } else if (text.trim().length > 0) {
        lines.push(`[chatter] ${text}`);
      }
    } else if (ev.kind === 'answer') {
      const answer = typeof ev.payload['answer'] === 'string' ? (ev.payload['answer'] as string) : '';
      lines.push(`A${qIndex} (AI suggestion): ${answer}`);
    } else if (ev.kind === 'ocr') {
      const title = typeof ev.payload['title'] === 'string' ? (ev.payload['title'] as string) : '';
      const site = typeof ev.payload['site'] === 'string' ? (ev.payload['site'] as string) : '';
      lines.push(`[screenshot] ${title || '(untitled)'} (${site})`);
    }
  }
  const transcript = lines.join('\n');

  const target = [input.role, input.company ? `at ${input.company}` : null].filter(Boolean).join(' ');
  const targetLine = target ? `Interview context: ${target}.\n` : '';
  const modeLine = input.mode ? `Mode: ${input.mode}.\n` : '';

  return [
    'You are reviewing an interview session AFTER it ended. You are NOT an interviewer — you are a neutral summarizer.',
    modeLine,
    targetLine,
    'Below is the full transcript. Questions marked "Q" are what the interviewer asked. "A (AI suggestion)" lines are what the AI copilot suggested the candidate say — NOT what the candidate actually said (which we never captured).',
    'Your job: produce a compact recap so the candidate can review what was discussed and prepare better next time.',
    'Be honest. If the transcript has fewer than 2 substantive questions, say so in highlights and leave improvements light.',
    '',
    'Transcript:',
    transcript || '(empty)',
    '',
    'Return JSON:',
    '{',
    '  "topicsCovered": ["one-word or short phrase per topic, up to 8"],',
    '  "highlights":    ["one-line note per notable moment, up to 4"],',
    '  "improvements":  ["actionable prep nudge for next time, up to 4"]',
    '}',
    'Rules:',
    '- Keep each array ≤ 4 items (topicsCovered ≤ 8). Most important first.',
    '- No corporate-speak. Be specific to THIS transcript — quote when it helps.',
    '- Return ONLY the JSON object.',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

export interface LiveRecap {
  readonly topicsCovered: readonly string[];
  readonly highlights: readonly string[];
  readonly improvements: readonly string[];
}

const MAX_ITEMS = { topicsCovered: 8, highlights: 4, improvements: 4 } as const;

/** Tolerant parser: trims, caps per-array length, drops non-string entries. */
export function parseLiveRecapResponse(raw: string): LiveRecap | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const arr = (key: keyof typeof MAX_ITEMS): string[] => {
    const v = obj[key];
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === 'string') {
        const t = item.trim();
        if (t.length > 0) out.push(t);
      }
      if (out.length >= MAX_ITEMS[key]) break;
    }
    return out;
  };
  return {
    topicsCovered: arr('topicsCovered'),
    highlights: arr('highlights'),
    improvements: arr('improvements'),
  };
}
