/**
 * Session orchestrator — drives one client WS connection through its lifecycle:
 *   1. Wait for `session.start` (Zod-validated). Respond with `session.ready`.
 *   2. Open an STT stream via the router.
 *   3. Forward binary PCM frames from client → STT.
 *   4. Emit `transcript.partial` / `transcript.final` to client as they arrive.
 *   5. When a final transcript is a question → fire LLM, stream `answer.delta`s.
 *   6. When a newer question arrives mid-answer → abort the in-flight answer, emit
 *      `answer.canceled`, start a new one.
 *   7. On `session.stop` / client close / STT / LLM error → tear down cleanly.
 */
import crypto from 'node:crypto';
import type { WebSocket } from '@fastify/websocket';
import type { RawData } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AUDIO_BYTES_PER_FRAME,
  AUDIO_SAMPLE_RATE_HZ,
  ClientMessageSchema,
  encodeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@repo/shared';
import { classify as classifyQuestion } from '@repo/question-detector';
import type { LlmRouter, Tier } from '@repo/llm-router';
import type { CodingProblem, OcrProvider } from '@repo/ocr';
import { parseCodingProblem } from '@repo/ocr';
import type { SttSession } from '../providers/stt/provider';
import { SttRouter } from '../providers/stt/router';
import type { OcrCache } from '../lib/ocr-cache';
import type { RateLimiter } from '../lib/rate-limiter';
import { checkQuota, formatSeconds } from '../lib/usage';

export interface SessionOrchestratorDeps {
  router: SttRouter;
  logger: FastifyBaseLogger;
  /** Optional — if set, questions trigger LLM streaming via this router. */
  llmRouter?: LlmRouter;
  /** Optional — if set, `screenshot` client messages run through OCR + parsers. */
  ocrProvider?: OcrProvider;
  ocrCache?: OcrCache;
  ocrRateLimiter?: RateLimiter;
  /** User tier (Phase 4a: ignored, everyone gets Gemini). */
  tier?: Tier;
  /**
   * Phase 6f. When set, the orchestrator writes a row to `sessions` on start, updates
   * `ended_at` + `duration_s` on stop, and enforces the user's plan quota before letting
   * the STT stream open.
   *
   * When null/undefined, the orchestrator runs in legacy shared-secret mode — no DB
   * writes, no quota gate. Used by integration tests.
   */
  userId?: string;
  supabase?: SupabaseClient;
}

type State = 'awaiting-start' | 'starting' | 'active' | 'stopping' | 'closed';

interface ActiveAnswer {
  id: string;
  abort: AbortController;
  startedAt: number;
  firstTokenAt: number | null;
  totalChars: number;
}

export class SessionOrchestrator {
  readonly sessionId = crypto.randomUUID();
  private state: State = 'awaiting-start';
  private stt: SttSession | null = null;
  private lastAnswerEndedAt: number | null = null;
  private framesForwarded = 0;
  private framesDropped = 0;
  private language = 'en';
  private llmChoice: 'auto' | 'claude' | 'gpt-5' | 'gpt-4.1' | 'gemini' = 'auto';
  private currentAnswer: ActiveAnswer | null = null;
  /** Wall-clock ms of when STT opened successfully — used to compute duration on stop. */
  private sessionStartedAtMs: number | null = null;
  /** DB row id (sessions.id) for the active row, if any was inserted. */
  private dbSessionId: string | null = null;
  /**
   * Latest OCR-parsed coding problem. Attached to the next answer's context so the LLM
   * sees the structured problem alongside the interviewer's question. Cleared when a new
   * coding problem arrives (always the most-recent).
   */
  private codingProblem: CodingProblem | null = null;
  /**
   * The last completed (question, answer) pair. Threaded into the next AnswerContext so
   * follow-ups like "What was the outcome?" or "Why?" don't hallucinate a fresh story.
   * Cleared when a sufficiently different question arrives (see isFollowUp).
   */
  private priorTurn: { question: string; answer: string } | null = null;
  /** Accumulator for the currently-streaming answer. Copied into priorTurn on done. */
  private currentAnswerText = '';
  /** The question text the active answer is responding to. */
  private currentAnswerQuestion = '';

  constructor(
    private readonly socket: WebSocket,
    private readonly deps: SessionOrchestratorDeps,
  ) {
    socket.on('message', (data: RawData, isBinary: boolean) =>
      this.handleMessage(data, isBinary),
    );
    socket.on('close', (code: number, reason: Buffer) => void this.handleClose(code, reason));
    socket.on('error', (err: Error) => this.handleError(err));
  }

  private handleMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.handleBinary(toBuffer(data));
      return;
    }
    const text = bufferToString(data);
    let msg: ClientMessage;
    try {
      msg = ClientMessageSchema.parse(JSON.parse(text));
    } catch (err) {
      this.deps.logger.warn({ err: String(err), preview: text.slice(0, 120) }, 'bad client message');
      this.send({ type: 'error', code: 'BAD_FRAME', message: 'malformed client message' });
      return;
    }
    void this.handleClientMessage(msg);
  }

  private async handleClientMessage(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'session.start':
        await this.start(msg);
        return;
      case 'session.stop':
        await this.stop();
        return;
      case 'ping':
        this.send({ type: 'pong' });
        return;
      case 'screenshot':
        await this.handleScreenshot(msg);
        return;
      case 'hint':
      case 'feedback':
        // Phase 6 / 9 — acknowledged but ignored until those features land.
        return;
    }
  }

  private async start(msg: Extract<ClientMessage, { type: 'session.start' }>): Promise<void> {
    if (this.state !== 'awaiting-start') {
      this.send({ type: 'error', code: 'INTERNAL', message: 'session already started' });
      return;
    }
    this.state = 'starting';
    this.language = msg.language;
    this.llmChoice = msg.llm;
    this.deps.logger.info(
      { sessionId: this.sessionId, language: msg.language, mode: msg.mode, llm: msg.llm },
      'session starting',
    );

    // Phase 6f: if we know who the user is, gate on their weekly quota before opening
    // STT. Failing here emits QUOTA_EXCEEDED and closes — nothing allocated upstream.
    let secondsAvailable = 0;
    if (this.deps.userId && this.deps.supabase) {
      try {
        const quota = await checkQuota(this.deps.supabase, this.deps.userId);
        if (!quota.allowed) {
          const used = quota.snapshot.usedSeconds;
          const limit = quota.snapshot.weeklyLimitSeconds ?? 0;
          this.deps.logger.info(
            { userId: this.deps.userId, plan: quota.snapshot.plan, used, limit },
            'quota denied',
          );
          this.send({
            type: 'error',
            code: 'QUOTA_EXCEEDED',
            message: `Weekly ${quota.snapshot.plan} quota exhausted (${formatSeconds(used)} / ${formatSeconds(limit)}). Upgrade to continue.`,
          });
          await this.stop();
          return;
        }
        secondsAvailable = quota.snapshot.remainingSeconds ?? 0;
      } catch (err) {
        // A quota check failure must NOT silently let the user through on an unbounded
        // plan — but it also shouldn't hard-fail the live flow over a transient DB blip.
        // Log loudly and treat as allowed with 0 advertised seconds.
        this.deps.logger.warn({ err: String(err) }, 'quota check failed — letting through');
      }
    }

    try {
      this.stt = await this.deps.router.connect({
        language: msg.language,
        sampleRateHz: AUDIO_SAMPLE_RATE_HZ,
        onPartial: (text, ts) => this.send({ type: 'transcript.partial', text, ts }),
        onFinal: (text, ts) => this.handleFinalTranscript(text, ts),
        onError: (err) => {
          this.deps.logger.warn(
            { code: err.code, message: err.message, status: err.statusCode },
            'stt error',
          );
          this.send({ type: 'error', code: 'UPSTREAM_STT', message: err.message });
        },
        onClose: (reason) => {
          this.deps.logger.info({ reason }, 'stt closed');
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.error({ err: message }, 'failed to open stt');
      this.send({ type: 'error', code: 'UPSTREAM_STT', message: 'failed to open stt' });
      await this.stop();
      return;
    }

    this.sessionStartedAtMs = Date.now();

    // Write the sessions row now that STT is actually open — prevents orphans from
    // connections that die during STT handshake.
    if (this.deps.userId && this.deps.supabase) {
      try {
        const { data, error } = await this.deps.supabase
          .from('sessions')
          .insert({
            user_id: this.deps.userId,
            kind: 'live',
            mode: msg.mode,
            language: msg.language,
            llm_choice: msg.llm,
            ...(msg.resumeId ? { resume_id: msg.resumeId } : {}),
            ...(msg.jdId ? { jd_id: msg.jdId } : {}),
            ...(msg.personaId ? { persona_id: msg.personaId } : {}),
          })
          .select('id')
          .single();
        if (error) throw error;
        const row = data as { id: string } | null;
        if (row) this.dbSessionId = row.id;
      } catch (err) {
        // Don't fail the session over a DB write — the user's already talking. Losing a
        // row means we won't count these minutes against quota, which is bad, but so is
        // cutting off a live interview over a migration issue.
        this.deps.logger.warn({ err: String(err) }, 'sessions insert failed');
      }
    }

    this.state = 'active';
    this.send({ type: 'session.ready', sessionId: this.sessionId, secondsAvailable });
  }

  private handleBinary(frame: Buffer): void {
    if (this.state !== 'active' || !this.stt) {
      this.framesDropped += 1;
      return;
    }
    if (frame.byteLength !== AUDIO_BYTES_PER_FRAME) {
      this.framesDropped += 1;
      this.send({
        type: 'error',
        code: 'BAD_FRAME',
        message: `frame length ${frame.byteLength} ≠ ${AUDIO_BYTES_PER_FRAME}`,
      });
      return;
    }
    this.stt.pushFrame(frame);
    this.framesForwarded += 1;
    if (this.framesForwarded % 100 === 0) {
      this.deps.logger.debug(
        { sessionId: this.sessionId, framesForwarded: this.framesForwarded },
        'stt heartbeat',
      );
    }
  }

  private handleFinalTranscript(text: string, ts: number): void {
    const classification = classifyQuestion({
      text,
      prevAnswerEndedAt: this.lastAnswerEndedAt,
      nowMs: ts,
    });
    this.send({
      type: 'transcript.final',
      text,
      ts,
      isQuestion: classification.isQuestion,
    });
    if (classification.isQuestion && this.deps.llmRouter) {
      void this.fireAnswer(text, classification.hint ?? 'behavioral');
    }
  }

  private async fireAnswer(
    question: string,
    hint: 'behavioral' | 'coding' | 'system_design',
  ): Promise<void> {
    // Cancel any in-flight answer. The newer question supersedes it.
    if (this.currentAnswer) {
      const canceled = this.currentAnswer;
      canceled.abort.abort();
      this.send({
        type: 'answer.canceled',
        answerId: canceled.id,
        reason: 'newer_question',
      });
      this.currentAnswer = null;
    }

    // Decide whether the prior turn is still relevant context. Follow-ups like "why?",
    // "what was the outcome?", "can you elaborate?" should stay anchored; genuinely new
    // questions should not drag the last story along (keeps prompt cost bounded too).
    const priorTurnForContext =
      this.priorTurn && isFollowUp(question) ? this.priorTurn : undefined;

    const answerId = crypto.randomUUID();
    const abort = new AbortController();
    const answer: ActiveAnswer = {
      id: answerId,
      abort,
      startedAt: Date.now(),
      firstTokenAt: null,
      totalChars: 0,
    };
    this.currentAnswer = answer;
    this.currentAnswerText = '';
    this.currentAnswerQuestion = question;

    let provider = 'unknown';
    try {
      const effectiveHint: 'behavioral' | 'coding' | 'system_design' =
        this.codingProblem ? 'coding' : hint;
      const stream = await this.deps.llmRouter!.startStream({
        tier: this.deps.tier ?? 'free',
        llm: this.llmChoice,
        context: {
          question,
          language: this.language,
          hint: effectiveHint,
          ...(this.codingProblem ? { codingProblem: this.codingProblem } : {}),
          ...(priorTurnForContext ? { priorTurn: priorTurnForContext } : {}),
        },
        signal: abort.signal,
      });
      provider = stream.provider;
      this.send({
        type: 'answer.start',
        answerId,
        provider,
        mode: hint,
      });

      for await (const delta of stream.deltas) {
        if (abort.signal.aborted) break;
        if (answer.firstTokenAt === null) answer.firstTokenAt = Date.now();
        answer.totalChars += delta.length;
        this.currentAnswerText += delta;
        this.send({ type: 'answer.delta', answerId, text: delta });
      }

      if (!abort.signal.aborted) {
        this.send({
          type: 'answer.done',
          answerId,
          totalTokens: answer.totalChars, // approximation; token count lands in Phase 4b
          latencyMs: (answer.firstTokenAt ?? Date.now()) - answer.startedAt,
        });
        this.deps.logger.info(
          {
            sessionId: this.sessionId,
            answerId,
            provider,
            firstTokenMs: (answer.firstTokenAt ?? Date.now()) - answer.startedAt,
            totalMs: Date.now() - answer.startedAt,
            chars: answer.totalChars,
          },
          'answer done',
        );
        // Commit the completed turn so the next follow-up has an anchor.
        if (this.currentAnswerText.length > 0) {
          this.priorTurn = {
            question: this.currentAnswerQuestion,
            answer: this.currentAnswerText,
          };
        }
      }
    } catch (err) {
      if (abort.signal.aborted) {
        // Already emitted answer.canceled — nothing more to do.
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.warn({ err: message, provider, answerId }, 'llm error');
      this.send({ type: 'error', code: 'UPSTREAM_LLM', message });
    } finally {
      if (this.currentAnswer?.id === answerId) {
        this.lastAnswerEndedAt = Date.now();
        this.currentAnswer = null;
      }
    }
  }

  /**
   * Handle a client-uploaded screenshot. Rate limit per connection, then check cache, then
   * call the OCR provider, parse the result, stash as `codingProblem`, and emit `ocr.result`
   * so the desktop knows OCR landed.
   */
  private async handleScreenshot(
    msg: Extract<ClientMessage, { type: 'screenshot' }>,
  ): Promise<void> {
    if (!this.deps.ocrProvider) {
      this.send({
        type: 'error',
        code: 'INTERNAL',
        message: 'OCR not configured on this api',
      });
      return;
    }

    if (this.deps.ocrRateLimiter) {
      const gate = this.deps.ocrRateLimiter.tryConsume();
      if (!gate.allowed) {
        this.send({
          type: 'error',
          code: 'RATE_LIMITED',
          message: `OCR rate limit — retry after ${Math.ceil(gate.retryAfterMs / 1000)} s`,
        });
        return;
      }
    }

    let png: Buffer;
    try {
      png = Buffer.from(msg.pngBase64, 'base64');
    } catch {
      this.send({ type: 'error', code: 'BAD_FRAME', message: 'invalid base64 PNG' });
      return;
    }
    if (png.byteLength === 0) {
      this.send({ type: 'error', code: 'BAD_FRAME', message: 'empty PNG payload' });
      return;
    }

    const problemId = crypto.randomUUID();
    const started = Date.now();
    try {
      const sha = crypto.createHash('sha256').update(png).digest('hex');
      const cached = this.deps.ocrCache?.get(sha);
      let problem: CodingProblem;
      if (cached) {
        problem = cached;
        this.deps.logger.info(
          { sessionId: this.sessionId, sha: sha.slice(0, 12), source: 'cache' },
          'ocr hit',
        );
      } else {
        const result = await this.deps.ocrProvider.extract(png);
        problem = parseCodingProblem(result.text);
        this.deps.ocrCache?.set(sha, problem);
        this.deps.logger.info(
          {
            sessionId: this.sessionId,
            sha: sha.slice(0, 12),
            site: problem.site,
            elapsedMs: Date.now() - started,
            titleLen: problem.title?.length ?? 0,
            descriptionChars: problem.description?.length ?? 0,
            examples: problem.examples.length,
            constraints: problem.constraints.length,
          },
          'ocr miss → parsed',
        );
      }

      this.codingProblem = problem;
      this.send({ type: 'ocr.result', problemId, parsed: problem });

      // The screenshot IS the candidate's request: "solve this problem". Fire an immediate
      // coding answer rather than waiting for a separate spoken question. This matches the
      // UX of Ctrl+Shift+C — one keypress from screen to answer. If an answer is already
      // streaming (the candidate was mid-question), skip; the newer spoken question will
      // supersede via the normal path.
      if (this.deps.llmRouter && !this.currentAnswer) {
        const synthQuestion = this.buildSynthQuestionFromProblem(problem);
        void this.fireAnswer(synthQuestion, 'coding');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.warn({ err: message }, 'ocr failure');
      this.send({ type: 'error', code: 'INTERNAL', message: 'ocr failed' });
    }
  }

  /**
   * Construct a question string for the coding answer when the user just dropped a
   * screenshot and hasn't spoken yet. The LLM already sees the full structured CodingProblem
   * via AnswerContext; this is just the interviewer-voice proxy that fills `<question>`.
   */
  private buildSynthQuestionFromProblem(p: CodingProblem): string {
    if (p.title) return `Solve: ${p.title}`;
    return 'Solve this coding problem shown on screen.';
  }

  private send(msg: ServerMessage): void {
    if (this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(encodeServerMessage(msg));
  }

  private async handleClose(code: number, reason: Buffer): Promise<void> {
    if (this.state === 'closed') return;
    this.deps.logger.info(
      {
        sessionId: this.sessionId,
        code,
        reason: reason.toString('utf8'),
        framesForwarded: this.framesForwarded,
        framesDropped: this.framesDropped,
      },
      'session closed',
    );
    await this.stop();
  }

  private handleError(err: Error): void {
    this.deps.logger.warn({ sessionId: this.sessionId, err: err.message }, 'ws error');
  }

  async stop(): Promise<void> {
    if (this.state === 'closed' || this.state === 'stopping') return;
    this.state = 'stopping';
    if (this.currentAnswer) {
      this.currentAnswer.abort.abort();
      this.currentAnswer = null;
    }
    if (this.stt) {
      try {
        await this.stt.close();
      } catch (err) {
        this.deps.logger.warn({ err: String(err) }, 'stt close failed');
      }
      this.stt = null;
    }

    // Phase 6f: seal the DB row with the measured duration. Done regardless of whether
    // the socket was still open — a dropped connection still consumed minutes.
    if (this.dbSessionId && this.deps.supabase && this.sessionStartedAtMs !== null) {
      const durationS = Math.max(0, Math.round((Date.now() - this.sessionStartedAtMs) / 1_000));
      try {
        const { error } = await this.deps.supabase
          .from('sessions')
          .update({ ended_at: new Date().toISOString(), duration_s: durationS })
          .eq('id', this.dbSessionId);
        if (error) throw error;
        this.deps.logger.info(
          { sessionId: this.sessionId, dbSessionId: this.dbSessionId, durationS },
          'session row sealed',
        );
      } catch (err) {
        this.deps.logger.warn(
          { err: String(err), dbSessionId: this.dbSessionId },
          'sessions update failed',
        );
      }
    }

    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.close(1000, 'session stopped');
    }
    this.state = 'closed';
  }
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function bufferToString(data: RawData): string {
  return toBuffer(data).toString('utf8');
}

/**
 * Heuristic: is this question a follow-up to the previous turn, or a fresh topic?
 *
 * We keep the prior Q/A threaded into the LLM context only for follow-ups — otherwise
 * every subsequent question pays the token cost of the entire previous answer, and
 * unrelated topics get forced to reference each other.
 *
 * A question is treated as a follow-up if ANY of:
 *   - very short (≤ 4 words) — "why?", "how so?", "and then?"
 *   - starts with a bare connector — "and", "so", "but", "or", "plus"
 *   - matches common continuation phrases — "what was the outcome", "tell me more",
 *     "can you elaborate", "go on", "expand on that", "what happened next"
 *
 * Exported for unit tests.
 */
export function isFollowUp(question: string): boolean {
  const q = question.trim().toLowerCase().replace(/[?.!]+$/, '');
  if (q.length === 0) return false;

  const words = q.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= 4) return true;

  if (/^(and|so|but|or|plus|also|then)\b/.test(q)) return true;

  const CONTINUATION = [
    'what was the outcome',
    'tell me more',
    'can you elaborate',
    'could you elaborate',
    'go on',
    'expand on that',
    'what happened next',
    'what happened after',
    'and then',
    'why is that',
    'why do you say',
    'say more about',
  ];
  for (const c of CONTINUATION) {
    if (q.includes(c)) return true;
  }
  return false;
}
