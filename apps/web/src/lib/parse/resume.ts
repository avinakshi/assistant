/**
 * Resume parser — extracts plain text from PDF / DOCX / plain text uploads, then runs the
 * text through Gemini for a lightly-structured JSON summary. Everything here is server-only;
 * the imports below (pdf-parse, mammoth) pull in Node built-ins that won't work in the browser.
 */
import 'server-only';
import mammoth from 'mammoth';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface ParsedResume {
  /** Raw text extracted from the file — the ground truth we send to the LLM. */
  readonly rawText: string;
  /** LLM's structured view. Best-effort; any field may be absent. */
  readonly summary?: ResumeSummary;
}

export interface ResumeSummary {
  readonly name?: string;
  readonly headline?: string;
  readonly summary?: string;
  readonly yearsOfExperience?: number;
  readonly companies?: readonly string[];
  readonly titles?: readonly string[];
  readonly skills?: readonly string[];
  readonly education?: readonly string[];
  readonly experience?: readonly ResumeExperience[];
  readonly projects?: readonly ResumeProject[];
  readonly certifications?: readonly string[];
}

export interface ResumeExperience {
  readonly company?: string;
  readonly title?: string;
  readonly dates?: string;
  readonly bullets?: readonly string[];
}

export interface ResumeProject {
  readonly name?: string;
  readonly description?: string;
  readonly tech?: readonly string[];
}

const MAX_TEXT_CHARS = 20_000;

export async function parseResumeFile(input: {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}): Promise<ParsedResume> {
  const rawText = await extractText(input);
  const clipped = rawText.slice(0, MAX_TEXT_CHARS);
  const summary = await llmSummarize(clipped).catch((err) => {
    // A failed summary should never block the upload — callers still get rawText.
    console.warn('[resume] llm summary failed', err instanceof Error ? err.message : err);
    return undefined;
  });
  return summary ? { rawText: clipped, summary } : { rawText: clipped };
}

async function extractText(input: {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}): Promise<string> {
  const buffer = Buffer.from(input.bytes);
  const lowerName = input.filename.toLowerCase();

  if (input.mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    // pdf-parse is CommonJS and does a self-referential require at import time that can
    // crash in ESM. We dynamic-import the nested dist file directly to bypass that.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = await import('pdf-parse/lib/pdf-parse.js');
    const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;
    const { text } = await pdfParse(buffer);
    return text.trim();
  }

  if (
    input.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.docx')
  ) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.trim();
  }

  if (input.mimeType === 'text/plain' || lowerName.endsWith('.txt')) {
    return buffer.toString('utf8').trim();
  }

  throw new Error(`unsupported resume format: ${input.mimeType || lowerName}`);
}

async function llmSummarize(text: string): Promise<ResumeSummary | undefined> {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!apiKey || !text) return undefined;
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });

  const prompt = `Extract a structured summary of the following resume. Return JSON matching:

{
  "name": string | null,
  "headline": string | null,
  "summary": string | null,
  "yearsOfExperience": number | null,
  "companies": string[],
  "titles": string[],
  "skills": string[],
  "education": string[],
  "experience": [{ "company": string, "title": string, "dates": string, "bullets": string[] }],
  "projects": [{ "name": string, "description": string, "tech": string[] }],
  "certifications": string[]
}

Rules:
- Only include items explicitly present in the resume; never invent.
- "headline" is the one-line self-description (target role or tagline) if the resume has one; otherwise null.
- "summary" is a 2-3 sentence "About" blurb if present; otherwise null.
- For "experience", include up to 6 most-recent roles. Up to 8 bullets per role, verbatim.
- For "projects", include up to 6 items.
- Keep top-level arrays under 15 items each, most significant first.
- Return ONLY the JSON object, no prose.

Resume:
${text}`;

  const result = await model.generateContent(prompt);
  const jsonText = result.response.text();
  try {
    // Gemini returns JSON text when generationConfig.responseMimeType is json. Field
    // shape is re-validated by normalizeSummary — treating this as an external trust
    // boundary with a full Zod parse would be overkill.
    // eslint-disable-next-line no-restricted-syntax
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return normalizeSummary(parsed);
  } catch {
    return undefined;
  }
}

function normalizeSummary(obj: Record<string, unknown>): ResumeSummary {
  const asString = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;
  const asNumber = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const asStringArray = (v: unknown, cap = 15): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const filtered = (v as unknown[]).filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    );
    return filtered.length > 0 ? filtered.slice(0, cap) : undefined;
  };
  const asExperience = (v: unknown): ResumeExperience[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out: ResumeExperience[] = [];
    for (const item of v as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const entry: ResumeExperience = {
        ...(asString(row['company']) ? { company: asString(row['company'])! } : {}),
        ...(asString(row['title']) ? { title: asString(row['title'])! } : {}),
        ...(asString(row['dates']) ? { dates: asString(row['dates'])! } : {}),
        ...(asStringArray(row['bullets'], 8) ? { bullets: asStringArray(row['bullets'], 8)! } : {}),
      };
      if (Object.keys(entry).length > 0) out.push(entry);
      if (out.length >= 6) break;
    }
    return out.length > 0 ? out : undefined;
  };
  const asProjects = (v: unknown): ResumeProject[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out: ResumeProject[] = [];
    for (const item of v as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const entry: ResumeProject = {
        ...(asString(row['name']) ? { name: asString(row['name'])! } : {}),
        ...(asString(row['description']) ? { description: asString(row['description'])! } : {}),
        ...(asStringArray(row['tech'], 10) ? { tech: asStringArray(row['tech'], 10)! } : {}),
      };
      if (Object.keys(entry).length > 0) out.push(entry);
      if (out.length >= 6) break;
    }
    return out.length > 0 ? out : undefined;
  };

  const name = asString(obj['name']);
  const headline = asString(obj['headline']);
  const summary = asString(obj['summary']);
  const yoe = asNumber(obj['yearsOfExperience']);
  const companies = asStringArray(obj['companies']);
  const titles = asStringArray(obj['titles']);
  const skills = asStringArray(obj['skills']);
  const education = asStringArray(obj['education']);
  const experience = asExperience(obj['experience']);
  const projects = asProjects(obj['projects']);
  const certifications = asStringArray(obj['certifications']);

  return {
    ...(name ? { name } : {}),
    ...(headline ? { headline } : {}),
    ...(summary ? { summary } : {}),
    ...(yoe !== undefined ? { yearsOfExperience: yoe } : {}),
    ...(companies ? { companies } : {}),
    ...(titles ? { titles } : {}),
    ...(skills ? { skills } : {}),
    ...(education ? { education } : {}),
    ...(experience ? { experience } : {}),
    ...(projects ? { projects } : {}),
    ...(certifications ? { certifications } : {}),
  };
}
