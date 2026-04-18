/**
 * Env-var validation. Every app/package that reads process.env MUST go through these
 * helpers so missing/invalid config fails fast at startup (never at 3am under load).
 */
import { z } from 'zod';

const LogLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);

export const CommonEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: LogLevelSchema.default('info'),
});
export type CommonEnv = z.infer<typeof CommonEnvSchema>;

// Treat empty-string env vars as unset. Shell `export FOO=` and `.env` `FOO=` both produce
// "" at read-time, which would fail a plain `.optional()` check. This makes local config
// files forgiving (a key left blank is the same as not writing the line).
const optionalSecret = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().min(1).optional(),
);

export const ApiEnvSchema = CommonEnvSchema.extend({
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  WS_SHARED_SECRET: z.string().min(16, 'WS_SHARED_SECRET must be ≥16 chars'),
  DEEPGRAM_API_KEY: optionalSecret,
  ASSEMBLYAI_API_KEY: optionalSecret,
  // LLM keys. Gemini is always-on default. Claude is opt-in (session.start llm='claude').
  // OpenAI deferred — slot kept so Phase 4b can wire GPT-5 without an env migration.
  GOOGLE_API_KEY: optionalSecret,
  ANTHROPIC_API_KEY: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  // Budget knob: Haiku 4.5 is the default to stretch the $1.11 Anthropic balance.
  // Change to claude-sonnet-4-6 when balance warrants the quality bump.
  CLAUDE_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  // OCR (Phase 5). Optional — /api/ocr/coding-problem returns 503 if unset.
  GOOGLE_CLOUD_VISION_KEY: optionalSecret,
});
export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export const DesktopEnvSchema = CommonEnvSchema.extend({
  DESKTOP_API_BASE_URL: z.string().url().default('http://localhost:3001'),
  DESKTOP_API_WS_URL: z.string().startsWith('ws').default('ws://localhost:3001'),
});
export type DesktopEnv = z.infer<typeof DesktopEnvSchema>;

/**
 * Small helper so callers can print a friendly error instead of raw Zod dump.
 */
export function parseOrDie<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
  label: string,
): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`[env] ${label} invalid:\n${issues}`);
  }
  return result.data as z.infer<S>;
}
