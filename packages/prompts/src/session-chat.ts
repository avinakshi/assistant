/**
 * "Ask AI about this session" chat prompt (Phase 13c).
 *
 * Separate from the live answer-generation prompts because the use case is different:
 * here we're *not* generating an interview answer in the candidate's voice. We're a
 * coach sitting next to the candidate *after* the interview, looking at the transcript
 * with them and answering their questions ("what did I miss?", "rephrase that last
 * answer", "draft a thank-you email"). The model needs to ground every reply in the
 * transcript rather than the behavioral prompt pack's STAR scaffolding.
 */

export interface SessionChatEvent {
  readonly kind: 'transcript' | 'answer' | 'ocr' | string;
  readonly payload: Record<string, unknown>;
}

export type SessionChatRole = 'user' | 'assistant';

export interface SessionChatMessage {
  readonly role: SessionChatRole;
  readonly content: string;
}

export interface BuildSessionChatInput {
  readonly events: readonly SessionChatEvent[];
  readonly history: readonly SessionChatMessage[];
  readonly userMessage: string;
  /** Role the candidate was interviewing for, if known. */
  readonly role?: string;
  readonly company?: string;
  readonly recap?: {
    readonly topics?: readonly string[];
    readonly highlights?: readonly string[];
    readonly improvements?: readonly string[];
  };
}

export interface BuildSessionChatOutput {
  readonly systemPrompt: string;
  /**
   * Flattened conversation to pass to the model. The transcript context is prepended
   * to the first user message rather than stuffed in the system prompt, so a very long
   * transcript doesn't blow past system-instruction limits on any provider.
   */
  readonly messages: readonly SessionChatMessage[];
}

const MAX_TRANSCRIPT_CHARS = 14_000;

const SYSTEM_PROMPT = `You are an interview coach helping a candidate review their interview session.

You have access to the full transcript: questions the interviewer asked, AI-suggested answers that were shown to the candidate in real time, and any coding problems that appeared on screen. You do NOT know what the candidate actually said out loud — the copilot only captured the interviewer's side of the audio. When the user asks you about "my answer", assume they mean the AI-suggested one unless they clarify.

Guidelines:
- Ground every reply in the transcript. Quote specific moments when it helps.
- If the user asks something the transcript can't answer (e.g. "how did I sound?"), say so briefly and offer what you can answer instead.
- Be concrete and practical — polish-able rephrasings, specific follow-up questions, draft snippets, next-step prep items.
- Keep replies tight. No corporate fluff. No "As an AI language model".
- If the user asks for a rewrite, give the rewrite in full. Don't narrate what you're about to do.
- Markdown is allowed (lists, code fences, bold) — the UI renders it.`;

export function buildSessionChatPrompt(input: BuildSessionChatInput): BuildSessionChatOutput {
  const transcript = renderTranscript(input.events);
  const contextHeader = buildContextHeader(input);
  const firstUserMessageContent = [
    contextHeader,
    'Transcript:',
    transcript || '(no transcript events captured)',
    '',
    '---',
    '',
    input.history.length === 0
      ? input.userMessage
      : `The user just asked: ${input.userMessage}`,
  ]
    .filter((l) => l.length > 0)
    .join('\n');

  const messages: SessionChatMessage[] = [];
  if (input.history.length === 0) {
    messages.push({ role: 'user', content: firstUserMessageContent });
  } else {
    // On subsequent turns, we don't re-send the transcript context — it was already
    // baked into the first message. Send the raw history + the new user message.
    for (const m of input.history) {
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: 'user', content: input.userMessage });
  }

  return { systemPrompt: SYSTEM_PROMPT, messages };
}

function buildContextHeader(input: BuildSessionChatInput): string {
  const parts: string[] = [];
  const target = [input.role, input.company ? `at ${input.company}` : null]
    .filter(Boolean)
    .join(' ');
  if (target) parts.push(`Interview context: ${target}.`);
  if (input.recap) {
    if (input.recap.topics && input.recap.topics.length > 0) {
      parts.push(`Topics covered (from recap): ${input.recap.topics.join(', ')}.`);
    }
    if (input.recap.highlights && input.recap.highlights.length > 0) {
      parts.push(`Highlights: ${input.recap.highlights.slice(0, 4).join(' | ')}.`);
    }
    if (input.recap.improvements && input.recap.improvements.length > 0) {
      parts.push(`Suggested improvements: ${input.recap.improvements.slice(0, 4).join(' | ')}.`);
    }
  }
  return parts.join('\n');
}

/**
 * Collapses session_events into a compact plain-text transcript. Truncates from the
 * FRONT if it exceeds MAX_TRANSCRIPT_CHARS — recent turns matter more than the opener,
 * and recent is where most user questions land ("that last answer", "the thing they
 * just asked").
 */
export function renderTranscript(events: readonly SessionChatEvent[]): string {
  const lines: string[] = [];
  let qIndex = 0;
  for (const ev of events) {
    if (ev.kind === 'transcript') {
      const text = strField(ev.payload, 'text');
      if (!text) continue;
      const isQuestion = ev.payload['isQuestion'] === true;
      const source = ev.payload['source'] === 'candidate' ? 'candidate' : 'interviewer';
      if (isQuestion) {
        qIndex += 1;
        lines.push(`Q${qIndex} (${source}): ${text}`);
      } else {
        lines.push(`[${source}] ${text}`);
      }
    } else if (ev.kind === 'answer') {
      const answer = strField(ev.payload, 'answer');
      if (!answer) continue;
      lines.push(`A${qIndex} (AI suggestion to candidate): ${answer}`);
    } else if (ev.kind === 'ocr') {
      const title = strField(ev.payload, 'title');
      const site = strField(ev.payload, 'site');
      lines.push(`[screenshot] ${title || '(untitled)'} (${site || 'unknown-site'})`);
    }
  }
  const full = lines.join('\n');
  if (full.length <= MAX_TRANSCRIPT_CHARS) return full;
  // Keep the tail — it's the most relevant part of the interview.
  const truncated = full.slice(full.length - MAX_TRANSCRIPT_CHARS);
  const firstBreak = truncated.indexOf('\n');
  return `[...earlier turns truncated for length...]\n${firstBreak >= 0 ? truncated.slice(firstBreak + 1) : truncated}`;
}

function strField(p: Record<string, unknown>, key: string): string {
  const v = p[key];
  return typeof v === 'string' ? v : '';
}
