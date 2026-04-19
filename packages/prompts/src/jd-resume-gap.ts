/**
 * JD ↔ resume gap analysis (Phase 13e).
 *
 * Runs once when the candidate picks a (resume, JD) pair before a live or practice
 * session. Produces a structured view the UI shows at pre-start AND the orchestrator
 * threads into the LLM's AnswerContext so every answer can proactively defend weak
 * spots.
 *
 * Not a "match score" (Parakeet doesn't even do this). The output is actionable:
 *   - matches:         JD requirements the resume clearly demonstrates
 *   - gaps:            JD requirements the resume doesn't obviously cover
 *   - likelyQuestions: probing questions the interviewer is likely to ask given the gaps
 *   - talkingPoints:   bridging framings the candidate can use to turn adjacent experience
 *                      into a credible answer for the gap
 */

export interface BuildJdResumeGapInput {
  /** Structured resume rendered as plain text (via renderStructuredResume) or the raw parsed_text. */
  readonly resumeText: string;
  /** JD body (description + requirements blob). */
  readonly jdText: string;
  /** Role title for the header, if known. */
  readonly role?: string;
  readonly company?: string;
}

export function buildJdResumeGapPrompt(input: BuildJdResumeGapInput): string {
  const header = [input.role, input.company ? `at ${input.company}` : null]
    .filter(Boolean)
    .join(' ');
  const roleLine = header ? `Target role: ${header}.\n` : '';
  return [
    'You are a senior recruiter reviewing a candidate for a specific role. Your job is to compare the resume against the job description and produce an actionable gap analysis.',
    'Be honest and specific. No vague marketing language. When the resume genuinely covers a JD requirement, say so with a concrete pointer ("led 3-person infra migration at Acme"). When it doesn\u2019t, flag it as a gap — but note any adjacent experience that could bridge.',
    roleLine,
    'Job description:',
    input.jdText.trim() || '(empty)',
    '',
    'Resume:',
    input.resumeText.trim() || '(empty)',
    '',
    'Return JSON:',
    '{',
    '  "matches":          ["short line per strong match, up to 6"],',
    '  "gaps":             ["short line per real gap, up to 6"],',
    '  "likelyQuestions":  ["probing questions the interviewer is likely to ask, up to 6"],',
    '  "talkingPoints":    ["bridging framings the candidate can use for the gaps, up to 5"]',
    '}',
    'Rules:',
    '- Each entry is ONE line. No nested bullets.',
    '- Order by importance, most critical first.',
    '- Never invent resume content. If the resume is thin, "gaps" will be longer than "matches" — that\u2019s the honest answer.',
    '- Return ONLY the JSON object.',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

export interface JdResumeGap {
  readonly matches: readonly string[];
  readonly gaps: readonly string[];
  readonly likelyQuestions: readonly string[];
  readonly talkingPoints: readonly string[];
}

const MAX: Record<keyof JdResumeGap, number> = {
  matches: 6,
  gaps: 6,
  likelyQuestions: 6,
  talkingPoints: 5,
};

export function parseJdResumeGapResponse(raw: string): JdResumeGap | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const arr = (key: keyof JdResumeGap): string[] => {
    const v = obj[key];
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const item of v) {
      if (typeof item !== 'string') continue;
      const t = item.trim();
      if (t.length === 0) continue;
      out.push(t);
      if (out.length >= MAX[key]) break;
    }
    return out;
  };
  const matches = arr('matches');
  const gaps = arr('gaps');
  const likelyQuestions = arr('likelyQuestions');
  const talkingPoints = arr('talkingPoints');
  if (
    matches.length === 0 &&
    gaps.length === 0 &&
    likelyQuestions.length === 0 &&
    talkingPoints.length === 0
  ) {
    // Empty everywhere = garbage response.
    return null;
  }
  return { matches, gaps, likelyQuestions, talkingPoints };
}

/**
 * Compact rendering suitable for stuffing into AnswerContext so the LLM can defend
 * gaps proactively during the live interview. Kept short (title + top 3 per section)
 * to stay within the prompt budget alongside the full resume + JD.
 */
export function renderJdResumeGapForContext(gap: JdResumeGap): string {
  const lines: string[] = ['JD/resume gap analysis (use these to defend weak spots):'];
  if (gap.matches.length > 0) {
    lines.push('Strong matches:');
    for (const m of gap.matches.slice(0, 3)) lines.push(`- ${m}`);
  }
  if (gap.gaps.length > 0) {
    lines.push('Gaps to defend:');
    for (const g of gap.gaps.slice(0, 3)) lines.push(`- ${g}`);
  }
  if (gap.talkingPoints.length > 0) {
    lines.push('Bridging framings:');
    for (const t of gap.talkingPoints.slice(0, 3)) lines.push(`- ${t}`);
  }
  return lines.join('\n');
}
