/**
 * Render a stored structured-resume JSON blob (resumes.structured_json) into the
 * plain-text shape the LLM prompt packs expect for `AnswerContext.resume`.
 *
 * The shape mirrors the editor UI (apps/web/src/app/app/resumes/*-editor.tsx): loose
 * enough that old rows still render, tight enough that a typical parsed resume lights
 * up all the sections. We only consume the fields we recognize — anything unknown is
 * quietly dropped so evolving the editor doesn't force a backend deploy.
 */

interface StructuredExperience {
  readonly company?: string;
  readonly title?: string;
  readonly dates?: string;
  readonly bullets?: readonly string[];
}

interface StructuredProject {
  readonly name?: string;
  readonly description?: string;
  readonly tech?: readonly string[];
}

interface StructuredResume {
  readonly summary?: string;
  readonly headline?: string;
  readonly name?: string;
  readonly yearsOfExperience?: number;
  readonly skills?: readonly string[];
  readonly experience?: readonly StructuredExperience[];
  readonly education?: readonly string[];
  readonly projects?: readonly StructuredProject[];
  readonly certifications?: readonly string[];
}

/**
 * Returns a concise plain-text rendering suitable for the LLM context, or null if the
 * input has no recognizable content (caller falls back to `parsed_text`).
 */
export function renderStructuredResume(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as StructuredResume;

  const lines: string[] = [];
  if (typeof r.name === 'string' && r.name.trim()) lines.push(`Name: ${r.name.trim()}`);
  if (typeof r.headline === 'string' && r.headline.trim()) {
    lines.push(`Headline: ${r.headline.trim()}`);
  }
  if (typeof r.yearsOfExperience === 'number' && r.yearsOfExperience > 0) {
    lines.push(`Years of experience: ${r.yearsOfExperience}`);
  }
  if (typeof r.summary === 'string' && r.summary.trim()) {
    lines.push('', 'Summary:', r.summary.trim());
  }
  if (Array.isArray(r.skills) && r.skills.length > 0) {
    const skills = r.skills.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    if (skills.length > 0) lines.push('', `Skills: ${skills.join(', ')}`);
  }
  if (Array.isArray(r.experience) && r.experience.length > 0) {
    lines.push('', 'Experience:');
    for (const e of r.experience) {
      if (!e || typeof e !== 'object') continue;
      const header = [e.title, e.company, e.dates].filter(Boolean).join(' — ');
      if (header) lines.push(`- ${header}`);
      const bullets = Array.isArray(e.bullets)
        ? (e.bullets as unknown[]).filter(
            (b): b is string => typeof b === 'string' && b.trim().length > 0,
          )
        : [];
      for (const b of bullets) lines.push(`    • ${b}`);
    }
  }
  if (Array.isArray(r.projects) && r.projects.length > 0) {
    lines.push('', 'Projects:');
    for (const p of r.projects) {
      if (!p || typeof p !== 'object') continue;
      if (p.name) lines.push(`- ${p.name}`);
      if (p.description) lines.push(`    ${p.description}`);
      const tech = Array.isArray(p.tech)
        ? (p.tech as unknown[]).filter(
            (t): t is string => typeof t === 'string' && t.trim().length > 0,
          )
        : [];
      if (tech.length > 0) lines.push(`    Tech: ${tech.join(', ')}`);
    }
  }
  if (Array.isArray(r.education) && r.education.length > 0) {
    const rows = r.education.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);
    if (rows.length > 0) {
      lines.push('', 'Education:');
      for (const e of rows) lines.push(`- ${e}`);
    }
  }
  if (Array.isArray(r.certifications) && r.certifications.length > 0) {
    const rows = r.certifications.filter(
      (c): c is string => typeof c === 'string' && c.trim().length > 0,
    );
    if (rows.length > 0) {
      lines.push('', 'Certifications:');
      for (const c of rows) lines.push(`- ${c}`);
    }
  }

  const out = lines.join('\n').trim();
  return out.length > 0 ? out : null;
}
