/**
 * LeetCode DOM parser — extracts problem data from a rendered LeetCode problem page.
 *
 * The DOM is volatile: LeetCode ships UI rewrites regularly. We lean on multiple
 * fallback selectors (attribute, data-cy, data-track, class-pattern) so a single
 * selector flipping doesn't break extraction.
 *
 * Kept as a pure function taking a `Document` so unit tests can use jsdom with
 * canned HTML fixtures without spinning up a browser.
 */

export interface ExtractedProblem {
  readonly title: string;
  readonly difficulty?: 'Easy' | 'Medium' | 'Hard';
  readonly description: string;
  readonly examples: readonly { readonly input?: string; readonly output?: string; readonly explanation?: string }[];
  readonly constraints: readonly string[];
  /** Problem slug from the URL, e.g. "two-sum". Stable identifier. */
  readonly slug?: string;
  /** Full raw text of the problem body, for fallback when parsing misses structure. */
  readonly rawText: string;
}

/** Top-level entry: best-effort extraction. Returns `null` when we can't find a title. */
export function extractLeetCodeProblem(doc: Document, url?: string): ExtractedProblem | null {
  const title = findTitle(doc);
  if (!title) return null;

  const difficulty = findDifficulty(doc);
  const body = findBodyContainer(doc);
  const rawText = body ? collapseWhitespace(body.textContent ?? '') : '';

  const { description, examples, constraints } = splitBody(rawText);
  const slug = extractSlug(url);

  return {
    title,
    ...(difficulty ? { difficulty } : {}),
    description,
    examples,
    constraints,
    ...(slug ? { slug } : {}),
    rawText,
  };
}

// ---- Selectors (with fallbacks) --------------------------------------------

function findTitle(doc: Document): string {
  // LeetCode's newer UI uses data-cy on the title element. Older UI uses a classed h1/div.
  const candidates = [
    doc.querySelector('[data-cy="question-title"]'),
    doc.querySelector('a[href^="/problems/"] .text-title-large'),
    doc.querySelector('div.text-title-large'),
    doc.querySelector('a.no-underline[href^="/problems/"]'),
    doc.querySelector('h1'),
    doc.querySelector('title'),
  ];
  for (const el of candidates) {
    const text = el?.textContent?.trim();
    if (!text) continue;
    const cleaned = stripTitleNoise(text);
    if (cleaned.length > 0) return cleaned;
  }
  return '';
}

function stripTitleNoise(raw: string): string {
  // "1. Two Sum - LeetCode" → "1. Two Sum"
  let s = raw.replace(/\s*[-|\u2014]\s*LeetCode\s*$/i, '');
  // Strip duplicate leading numbering if the page title already has " - LeetCode" etc.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function findDifficulty(doc: Document): ExtractedProblem['difficulty'] {
  // LeetCode renders difficulty as a small pill. Match by text to avoid class churn.
  const all = doc.querySelectorAll('span, div');
  for (const el of all) {
    const text = el.textContent?.trim();
    if (text === 'Easy' || text === 'Medium' || text === 'Hard') {
      return text;
    }
  }
  return undefined;
}

function findBodyContainer(doc: Document): Element | null {
  // LeetCode's body container varies. Try in order.
  return (
    doc.querySelector('[data-track-load="description_content"]') ||
    doc.querySelector('div[data-cy="question-content"]') ||
    doc.querySelector('div.question-content') ||
    doc.querySelector('article') ||
    doc.querySelector('main')
  );
}

function extractSlug(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/\/problems\/([a-z0-9-]+)/i);
  return m ? m[1] : undefined;
}

// ---- Body parsing ----------------------------------------------------------

interface SplitResult {
  description: string;
  examples: ExtractedProblem['examples'];
  constraints: string[];
}

export function splitBody(body: string): SplitResult {
  if (!body) return { description: '', examples: [], constraints: [] };

  // Normalize: collapse runs of spaces, preserve single newlines.
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  const descLines: string[] = [];
  const examples: { input?: string; output?: string; explanation?: string }[] = [];
  const constraints: string[] = [];

  let section: 'desc' | 'example' | 'constraints' | 'followup' = 'desc';
  let current: { input?: string; output?: string; explanation?: string } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (/^Example\s*\d*\s*:?/i.test(line)) {
      if (current) examples.push(current);
      current = {};
      section = 'example';
      continue;
    }
    if (/^Constraints?\s*:/i.test(line)) {
      if (current) { examples.push(current); current = null; }
      section = 'constraints';
      // Might have text after the colon on the same line.
      const rest = line.replace(/^Constraints?\s*:/i, '').trim();
      if (rest.length > 0) constraints.push(rest);
      continue;
    }
    if (/^Follow-?up/i.test(line)) {
      if (current) { examples.push(current); current = null; }
      section = 'followup';
      continue;
    }

    if (section === 'desc') {
      descLines.push(line);
    } else if (section === 'example' && current) {
      if (/^Input\s*:/i.test(line)) {
        current.input = line.replace(/^Input\s*:/i, '').trim();
      } else if (/^Output\s*:/i.test(line)) {
        current.output = line.replace(/^Output\s*:/i, '').trim();
      } else if (/^Explanation\s*:/i.test(line)) {
        current.explanation = line.replace(/^Explanation\s*:/i, '').trim();
      } else if (current.explanation !== undefined) {
        current.explanation = (current.explanation + ' ' + line).trim();
      }
    } else if (section === 'constraints') {
      // Strip common bullet markers. Don't eat negative-leading numbers like "-10^9".
      const stripped = line.replace(/^[\u2022\*]\s*/, '').trim();
      if (stripped.length > 0) constraints.push(stripped);
    }
    // followup lines are intentionally ignored for now.
  }
  if (current) examples.push(current);

  return {
    description: descLines.join('\n').trim(),
    examples,
    constraints,
  };
}

function collapseWhitespace(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}
