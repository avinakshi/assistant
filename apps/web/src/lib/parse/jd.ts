/**
 * Minimal JD fetcher: given a URL, fetch the page and strip to readable text. No headless
 * browser — most LinkedIn / Lever / Greenhouse / Ashby pages render their JD body in the
 * initial HTML response, which is enough for LLM context.
 *
 * When a site is JS-only (LinkedIn Easy Apply deep pages behind a signin wall, Workday),
 * we degrade to returning whatever body text we got. Users can always paste manually.
 */
import 'server-only';

const MAX_FETCH_BYTES = 2 * 1024 * 1024; // 2 MB
const FETCH_TIMEOUT_MS = 8_000;
const UA = 'Mozilla/5.0 (compatible; InterviewCopilotBot/0.1; +https://interview-copilot.local)';

export interface FetchedJd {
  readonly body: string;
  readonly title?: string;
  readonly url: string;
  /** Best-effort company + role extracted from the <title> or og:site_name / og:title. */
  readonly company?: string;
  readonly role?: string;
}

export async function fetchJdFromUrl(url: string): Promise<FetchedJd> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      signal: ac.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(to);
  }

  if (!res.ok) throw new Error(`fetch ${parsed.href} → ${res.status}`);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
    throw new Error(`expected HTML, got ${contentType || 'unknown'}`);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_FETCH_BYTES) {
    throw new Error(`page too large (${buf.byteLength} bytes > ${MAX_FETCH_BYTES})`);
  }
  const html = Buffer.from(buf).toString('utf8');

  return {
    url: parsed.toString(),
    body: stripHtml(html),
    ...extractTitle(html),
  };
}

/** Extracts visible text from HTML. Not a full DOM parser; just enough for JD bodies. */
export function stripHtml(html: string): string {
  return html
    // Remove noisy elements entirely.
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Drop remaining tags.
    .replace(/<[^>]+>/g, ' ')
    // Decode a handful of common HTML entities.
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse whitespace, keep line breaks that were meaningful.
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();
}

/**
 * Pull a best-guess title + company + role from <title>, og:site_name, og:title.
 * LinkedIn titles like "Software Engineer, India at Razorpay | LinkedIn" parse nicely;
 * others degrade gracefully.
 */
export function extractTitle(html: string): { title?: string; company?: string; role?: string } {
  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(html);
  const ogSite = /<meta\s+[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i.exec(
    html,
  );
  const ogTitle = /<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(
    html,
  );
  const rawTitle = titleMatch?.[1]?.trim();
  const site = ogSite?.[1]?.trim();
  const ogT = ogTitle?.[1]?.trim();

  // "<Role> at <Company> | Board" pattern — very common on LinkedIn, Lever, Ashby.
  const atPattern = /^(.*?)\s+(?:at|@|\u2014|\u2013|-)\s+(.*?)(?:\s*[\|·].*)?$/;
  const source = rawTitle ?? ogT ?? '';
  const m = atPattern.exec(source);
  if (m && m[1] && m[2]) {
    const role = m[1].trim();
    const company = m[2].split(/\s*[\|·]\s*/)[0]?.trim();
    return {
      ...(source ? { title: source } : {}),
      ...(role ? { role } : {}),
      ...(company ? { company } : {}),
    };
  }
  return {
    ...(source ? { title: source } : {}),
    ...(site ? { company: site } : {}),
  };
}
