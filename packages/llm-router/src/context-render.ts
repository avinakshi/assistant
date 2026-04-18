/**
 * Shared helpers for rendering an AnswerContext into the provider-specific user message.
 *
 * Both Gemini and Claude providers use XML-ish wrappers (`<resume>`, `<job_description>`,
 * `<question>`, etc.) — LLMs handle these better than free-form markdown section headers,
 * and it keeps prompt caching keys stable.
 */
import type { AnswerContext, CodingProblemLike } from './provider';

export function renderCodingProblem(p: CodingProblemLike): string {
  const lines: string[] = [];
  lines.push('<coding_problem>');
  if (p.site && p.site !== 'unknown') lines.push(`  <source>${p.site}</source>`);
  if (p.difficulty) lines.push(`  <difficulty>${p.difficulty}</difficulty>`);
  if (p.title) lines.push(`  <title>${p.title}</title>`);
  if (p.description) {
    lines.push('  <description>');
    lines.push(indent(p.description, 4));
    lines.push('  </description>');
  }
  if (p.examples.length > 0) {
    lines.push('  <examples>');
    p.examples.forEach((ex, i) => {
      lines.push(`    <example n="${i + 1}">`);
      if (ex.input) {
        lines.push('      <input>');
        lines.push(indent(ex.input, 8));
        lines.push('      </input>');
      }
      if (ex.output) {
        lines.push('      <output>');
        lines.push(indent(ex.output, 8));
        lines.push('      </output>');
      }
      if (ex.explanation) {
        lines.push('      <explanation>');
        lines.push(indent(ex.explanation, 8));
        lines.push('      </explanation>');
      }
      lines.push('    </example>');
    });
    lines.push('  </examples>');
  }
  if (p.constraints.length > 0) {
    lines.push('  <constraints>');
    for (const c of p.constraints) lines.push(`    <c>${c}</c>`);
    lines.push('  </constraints>');
  }
  lines.push('</coding_problem>');
  return lines.join('\n');
}

/**
 * Build the user message body from an AnswerContext. Used by Gemini (which doesn't split
 * system from user turns) and Claude (which keeps the cacheable blocks in `system` and the
 * volatile ones in the user message).
 *
 * @param ctx the full context
 * @param includeStaticBlocks when true, include resume + JD inline. Gemini sets this true;
 *   Claude sets it false because those blocks live in the cached `system` array.
 */
export function buildUserMessage(ctx: AnswerContext, includeStaticBlocks: boolean): string {
  const parts: string[] = [];
  const language = ctx.language ?? 'en';

  if (includeStaticBlocks) {
    if (ctx.resume && ctx.resume.length > 0) {
      parts.push(`<resume>\n${ctx.resume.trim()}\n</resume>`);
    }
    if (ctx.jobDescription && ctx.jobDescription.length > 0) {
      parts.push(`<job_description>\n${ctx.jobDescription.trim()}\n</job_description>`);
    }
  }
  if (ctx.transcriptWindow && ctx.transcriptWindow.length > 0) {
    parts.push(`<transcript_last_90s>\n${ctx.transcriptWindow.trim()}\n</transcript_last_90s>`);
  }
  if (ctx.priorTurn) {
    // Anchor for follow-ups. Trimmed so the cached-system-block key stays stable even
    // when a turn carries trailing whitespace from live STT.
    parts.push(
      [
        '<prior_turn>',
        '  <q>',
        indent(ctx.priorTurn.question.trim(), 4),
        '  </q>',
        '  <a>',
        indent(ctx.priorTurn.answer.trim(), 4),
        '  </a>',
        '  <note>If this question is a follow-up ("Why?", "What was the outcome?", "Can you elaborate?"), continue the SAME story. Do not invent a new one.</note>',
        '</prior_turn>',
      ].join('\n'),
    );
  }
  if (ctx.codingProblem) {
    parts.push(renderCodingProblem(ctx.codingProblem));
  }
  parts.push(`<language>${language}</language>`);
  parts.push(`<question>\n${ctx.question.trim()}\n</question>`);
  if (ctx.retryHint) {
    parts.push(`<retry_instruction>\n${ctx.retryHint.trim()}\n</retry_instruction>`);
  }
  return parts.join('\n\n');
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}
