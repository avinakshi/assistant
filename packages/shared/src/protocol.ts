/**
 * WebSocket wire protocol. Reference: docs/INTERVIEW-COPILOT-COMPLETE.txt §04 ARCHITECTURE Part 6.
 *
 * Binary frames = raw 16 kHz mono linear16 PCM (see ./audio).
 * Text frames = JSON encoded against the Zod schemas below.
 *
 * Every message — in both directions — is validated at the boundary. No untrusted JSON.parse anywhere.
 */
import { z } from 'zod';

// ---------- Client → Server ----------

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.start'),
    resumeId: z.string().uuid().optional(),
    jdId: z.string().uuid().optional(),
    personaId: z.string().uuid().optional(),
    mode: z.enum(['auto', 'behavioral', 'coding', 'system_design']).default('auto'),
    llm: z.enum(['auto', 'claude', 'gpt-5', 'gpt-4.1', 'gemini']).default('auto'),
    language: z.string().min(2).max(10).default('en'),
  }),
  z.object({ type: z.literal('session.stop') }),
  z.object({ type: z.literal('hint'), text: z.string().min(1).max(2000) }),
  z.object({
    type: z.literal('screenshot'),
    pngBase64: z.string().min(1).max(10_000_000), // ~7.5 MB decoded
  }),
  z.object({
    type: z.literal('feedback'),
    answerId: z.string().uuid(),
    rating: z.enum(['good', 'bad']),
    reason: z.string().max(500).optional(),
  }),
  z.object({ type: z.literal('ping') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------- Server → Client ----------

export const TierSchema = z.enum(['free', 'starter', 'pro', 'lifetime']);
export type Tier = z.infer<typeof TierSchema>;

export const ErrorCodeSchema = z.enum([
  'AUTH',
  'QUOTA_EXCEEDED',
  'UPSTREAM_STT',
  'UPSTREAM_LLM',
  'RATE_LIMITED',
  'INTERNAL',
  'BAD_FRAME',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.ready'),
    sessionId: z.string().uuid(),
    secondsAvailable: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('transcript.partial'),
    text: z.string(),
    ts: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('transcript.final'),
    text: z.string(),
    ts: z.number().int().nonnegative(),
    isQuestion: z.boolean(),
  }),
  z.object({
    type: z.literal('answer.start'),
    answerId: z.string().uuid(),
    provider: z.string(),
    mode: z.string().optional(),
  }),
  z.object({
    type: z.literal('answer.delta'),
    answerId: z.string().uuid(),
    text: z.string(),
  }),
  z.object({
    type: z.literal('answer.done'),
    answerId: z.string().uuid(),
    totalTokens: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('answer.canceled'),
    answerId: z.string().uuid(),
    reason: z.enum(['newer_question', 'user_abort', 'upstream_error']),
  }),
  z.object({
    type: z.literal('ocr.result'),
    problemId: z.string().uuid(),
    parsed: z.unknown(), // CodingProblem shape lands in Phase 5
  }),
  z.object({
    type: z.literal('usage'),
    secondsRemaining: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('tier.changed'),
    newTier: TierSchema,
  }),
  z.object({
    type: z.literal('error'),
    code: ErrorCodeSchema,
    message: z.string(),
  }),
  z.object({ type: z.literal('pong') }),
  // Phase 1 only — /ws/echo diagnostic channel.
  z.object({
    type: z.literal('echo.stats'),
    framesReceived: z.number().int().nonnegative(),
    framesPerSecond: z.number().nonnegative(),
    rmsDb: z.number(),
    windowMs: z.number().int().positive(),
  }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ---------- Encode / decode helpers ----------

export function encodeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(ServerMessageSchema.parse(msg));
}

export function decodeClientMessage(raw: string): ClientMessage {
  // Single source of truth for client→server parsing. Callers must wrap in try/catch.
  const json: unknown = JSON.parse(raw);
  return ClientMessageSchema.parse(json);
}

export function decodeServerMessage(raw: string): ServerMessage {
  const json: unknown = JSON.parse(raw);
  return ServerMessageSchema.parse(json);
}
