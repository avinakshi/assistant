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
  AUDIO_BYTES_PER_FRAME_DIARIZED,
  AUDIO_SAMPLE_RATE_HZ,
  AUDIO_SOURCE_TAG_BYTES,
  ClientMessageSchema,
  decodeAudioSourceTag,
  encodeServerMessage,
  type AudioSource,
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
import { renderStructuredResume } from '../lib/resume-render';
import { renderJdResumeGapForContext, type JdResumeGap } from '@repo/prompts';

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
  /**
   * Phase 13b. When `diarize:true`, audio frames carry a 1-byte source prefix and the
   * orchestrator runs two parallel Deepgram sessions so "interviewer" and "candidate"
   * can be labeled independently. In single-channel mode this stays null and all frames
   * flow through `this.stt`.
   */
  private sttCandidate: SttSession | null = null;
  private diarize = false;
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
   * Phase 13-scroll-stitch: when the candidate scrolls a long problem and hits Analyze
   * multiple times, we stitch the OCR text from each screenshot into one combined
   * problem body so the LLM sees the whole thing at once. Without this, only the
   * viewport-height of text reached Gemini and the rest was hallucinated.
   */
  private stitchedRawText: string | null = null;
  private lastStitchAt = 0;
  /** ms. Successive screenshots within this window extend the stitch; beyond it, reset. */
  private readonly STITCH_WINDOW_MS = 30_000;

  /**
   * Question debounce buffer. Deepgram splits long interviewer utterances into multiple
   * `transcript.final` events at silence boundaries (~500ms). Without buffering, the
   * question detector fires on the FIRST final that matches a behavioral / technical
   * prefix ("how would you") — even though the real question continues for another
   * few seconds ("how would you handle an unhappy customer whose training session
   * didn't meet expectations?"). Result: the LLM answers a truncated question, the
   * user sees half an answer before it's canceled by the next full-question fire.
   *
   * Fix: collect consecutive interviewer finals into a buffer and only fire the LLM
   * when EITHER
   *   (a) the buffered text ends with terminal punctuation (?, ., !), OR
   *   (b) QUESTION_DEBOUNCE_MS of silence passes with no new final.
   *
   * Same problem hits people using Google Translate's real-time voice translation —
   * the translated text arrives in bursts that Deepgram re-chunks unpredictably.
   */
  private pendingQuestion: {
    text: string;
    firstTs: number;
    hint: 'behavioral' | 'coding' | 'system_design' | 'technical' | null;
    timer: NodeJS.Timeout | null;
  } | null = null;
  private readonly QUESTION_DEBOUNCE_MS = 1_500;
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
  /**
   * Phase 9. When true, the orchestrator writes every transcript.final + answer.done
   * to session_events so the user can review the session later. Mirrored to
   * `sessions.persist_transcripts` so the web UI can tell.
   */
  private persistTranscripts = false;
  /**
   * Phase 13d. Resume + JD text loaded from Supabase at session.start so every answer
   * gets grounded context without re-fetching. null when the user didn't pick one.
   * Prior to 13d, msg.resumeId/jdId were saved to the sessions row but the bodies were
   * never loaded — answers ran resume-free. Closing that gap is half of 13d's value.
   */
  private resumeText: string | null = null;
  private jobDescriptionText: string | null = null;
  /** Free-form bias the user supplied at session start. */
  private extraInstructions: string | null = null;
  /** Phase 13f. When true, force answers into CEFR A2-B1 English. */
  private simpleEnglish = false;
  /**
   * Phase 13e. Compact gap summary threaded into every AnswerContext. Renders from the
   * cached jd_resume_gaps row when (resumeId, jdId) are both picked — otherwise null,
   * and answers use the raw resume + JD as before.
   */
  private gapContext: string | null = null;

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

  /**
   * Replay a message the route handler buffered during its async auth window.
   * See session-handler.ts for why that buffering is necessary. Exposed as a method
   * (not a bare call to handleMessage) so the route can remain agnostic about the
   * orchestrator's private fields.
   */
  replayMessage(data: Buffer, isBinary: boolean): void {
    this.handleMessage(data, isBinary);
  }

  private handleMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.handleBinary(toBuffer(data));
      return;
    }
    const text = bufferToString(data);
    let msg: ClientMessage;
    try {
      // eslint-disable-next-line no-restricted-syntax
      const json = JSON.parse(text);
      this.deps.logger.info({ msgType: (json as { type?: string }).type }, 'ws client message received');
      msg = ClientMessageSchema.parse(json);
    } catch (err) {
      this.deps.logger.warn({ err: String(err), preview: text.slice(0, 120) }, 'bad client message');
      this.send({ type: 'error', code: 'BAD_FRAME', message: 'malformed client message' });
      return;
    }
    void this.handleClientMessage(msg);
  }

  private binaryDiagCount = 0;

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
    this.persistTranscripts = msg.persistTranscripts === true;
    this.diarize = msg.diarize === true;
    this.extraInstructions = msg.extraInstructions?.trim() || null;
    this.simpleEnglish = msg.simpleEnglish === true;
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
      // Primary stream — always open. In single-channel mode it's the only stream; in
      // diarize mode it handles the "interviewer" source (display-capture audio).
      this.stt = await this.openSttFor('interviewer', msg.language);
      if (this.diarize) {
        this.sttCandidate = await this.openSttFor('candidate', msg.language);
      }
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
            persist_transcripts: this.persistTranscripts,
            ...(msg.resumeId ? { resume_id: msg.resumeId } : {}),
            ...(msg.jdId ? { jd_id: msg.jdId } : {}),
            ...(msg.personaId ? { persona_id: msg.personaId } : {}),
            ...(this.extraInstructions ? { extra_instructions: this.extraInstructions } : {}),
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

      // Phase 13d: load resume + JD text up front so every fireAnswer() has grounded
      // context. Fire-and-forget — answers before the fetch resolves just run resume-free
      // (matches pre-13d behavior, no regression).
      if (msg.resumeId || msg.jdId) {
        void this.loadResumeAndJd(msg.resumeId, msg.jdId).catch((err) => {
          this.deps.logger.warn({ err: String(err) }, 'resume/jd load failed');
        });
      }
    }

    this.state = 'active';
    this.send({ type: 'session.ready', sessionId: this.sessionId, secondsAvailable });
  }

  /**
   * Fetch the resume + JD bodies the user picked and stash them on the instance. Prefers
   * `resumes.structured_json` when present (populated by the parser, editable via the
   * resume detail page) because the typed view gives the LLM a much cleaner signal than
   * a blob of OCR'd text.
   */
  private async loadResumeAndJd(
    resumeId: string | undefined,
    jdId: string | undefined,
  ): Promise<void> {
    if (!this.deps.supabase) return;
    const tasks: Promise<void>[] = [];
    if (resumeId) {
      tasks.push(
        (async () => {
          const { data } = await this.deps.supabase!
            .from('resumes')
            .select('parsed_text, structured_json')
            .eq('id', resumeId)
            .maybeSingle();
          if (!data) return;
          const row = data as { parsed_text?: string | null; structured_json?: unknown };
          const structured = renderStructuredResume(row.structured_json);
          const fallback = (row.parsed_text ?? '').trim();
          this.resumeText = structured ?? (fallback.length > 0 ? fallback : null);
        })(),
      );
    }
    if (jdId) {
      tasks.push(
        (async () => {
          const { data } = await this.deps.supabase!
            .from('job_descriptions')
            .select('body')
            .eq('id', jdId)
            .maybeSingle();
          if (!data) return;
          const row = data as { body?: string | null };
          this.jobDescriptionText = (row.body ?? '').trim() || null;
        })(),
      );
    }
    // Phase 13e: gap analysis is only meaningful when BOTH sides are picked.
    if (resumeId && jdId && this.deps.userId) {
      tasks.push(
        (async () => {
          const { data } = await this.deps.supabase!
            .from('jd_resume_gaps')
            .select('analysis')
            .eq('user_id', this.deps.userId!)
            .eq('resume_id', resumeId)
            .eq('jd_id', jdId)
            .maybeSingle();
          if (!data) return;
          const row = data as { analysis?: unknown };
          if (row.analysis && typeof row.analysis === 'object') {
            const rendered = renderJdResumeGapForContext(row.analysis as JdResumeGap);
            if (rendered.length > 0) this.gapContext = rendered;
          }
        })(),
      );
    }
    await Promise.all(tasks);
  }

  private handleBinary(frame: Buffer): void {
    // Log first binary frame + every 100th to confirm audio is flowing.
    this.binaryDiagCount += 1;
    if (this.binaryDiagCount === 1 || this.binaryDiagCount % 100 === 0) {
      this.deps.logger.info(
        {
          count: this.binaryDiagCount,
          frameBytes: frame.byteLength,
          state: this.state,
          diarize: this.diarize,
          hasStt: !!this.stt,
        },
        'ws binary frame diag',
      );
    }
    if (this.state !== 'active' || !this.stt) {
      this.framesDropped += 1;
      return;
    }
    const expected = this.diarize ? AUDIO_BYTES_PER_FRAME_DIARIZED : AUDIO_BYTES_PER_FRAME;
    if (frame.byteLength !== expected) {
      this.framesDropped += 1;
      this.send({
        type: 'error',
        code: 'BAD_FRAME',
        message: `frame length ${frame.byteLength} ≠ ${expected}`,
      });
      return;
    }
    if (this.diarize) {
      const source = decodeAudioSourceTag(frame[0] ?? 0);
      const pcm = frame.subarray(AUDIO_SOURCE_TAG_BYTES);
      const target = source === 'candidate' ? this.sttCandidate : this.stt;
      if (!target) {
        this.framesDropped += 1;
        return;
      }
      target.pushFrame(pcm);
    } else {
      this.stt.pushFrame(frame);
    }
    this.framesForwarded += 1;
    if (this.framesForwarded % 100 === 0) {
      this.deps.logger.debug(
        { sessionId: this.sessionId, framesForwarded: this.framesForwarded },
        'stt heartbeat',
      );
    }
  }

  /**
   * Open one Deepgram (or fallback) stream, with its partial/final events tagged by
   * audio source. In diarize mode we call this twice — once per source — so each lane
   * carries the correct label end-to-end. LLM answers still fire only off the interviewer
   * lane: answering our own candidate's "um, so, like…" would be the opposite of useful.
   */
  private async openSttFor(source: AudioSource, language: string): Promise<SttSession> {
    return this.deps.router.connect({
      language,
      sampleRateHz: AUDIO_SAMPLE_RATE_HZ,
      onPartial: (text, ts) =>
        this.send({
          type: 'transcript.partial',
          text,
          ts,
          ...(this.diarize ? { source } : {}),
        }),
      onFinal: (text, ts) => this.handleFinalTranscript(text, ts, source),
      onError: (err) => {
        this.deps.logger.warn(
          { code: err.code, message: err.message, status: err.statusCode, source },
          'stt error',
        );
        this.send({ type: 'error', code: 'UPSTREAM_STT', message: err.message });
      },
      onClose: (reason) => {
        this.deps.logger.info({ reason, source }, 'stt closed');
      },
    });
  }

  private handleFinalTranscript(text: string, ts: number, source: AudioSource): void {
    const classification = classifyQuestion({
      text,
      prevAnswerEndedAt: this.lastAnswerEndedAt,
      nowMs: ts,
    });
    this.deps.logger.info(
      {
        source,
        isQuestion: classification.isQuestion,
        hint: classification.hint,
        hasLlm: !!this.deps.llmRouter,
        preview: text.slice(0, 80),
      },
      'transcript final',
    );
    this.send({
      type: 'transcript.final',
      text,
      ts,
      isQuestion: classification.isQuestion,
      ...(this.diarize ? { source } : {}),
    });
    this.persistEvent('transcript', {
      text,
      ts,
      isQuestion: classification.isQuestion,
      ...(this.diarize ? { source } : {}),
    });
    // Only the interviewer's questions should trigger answers. In single-channel mode
    // there's no way to tell, so we behave as before (treat everything as interviewer).
    const treatAsInterviewer = !this.diarize || source === 'interviewer';
    if (!treatAsInterviewer || !this.deps.llmRouter) return;
    if (!classification.isQuestion && !this.pendingQuestion) return;

    // If we already have a pending buffer from the previous final (or two), append
    // this final to it. Otherwise start a new one. The classification of the FULL
    // combined text happens when we decide to fire.
    const combinedText = this.pendingQuestion
      ? `${this.pendingQuestion.text} ${text}`.replace(/\s+/g, ' ').trim()
      : text.trim();
    const firstTs = this.pendingQuestion?.firstTs ?? ts;

    // Clear the existing timer (we got a new final, restart silence count).
    if (this.pendingQuestion?.timer) {
      clearTimeout(this.pendingQuestion.timer);
    }

    // Did we hit terminal punctuation? If yes, fire immediately — no need to wait.
    const endsWithPunct = /[?.!]\s*$/.test(combinedText);
    if (endsWithPunct) {
      this.pendingQuestion = null;
      const reclassified = classifyQuestion({
        text: combinedText,
        prevAnswerEndedAt: this.lastAnswerEndedAt,
        nowMs: firstTs,
      });
      if (reclassified.isQuestion) {
        void this.fireAnswer(combinedText, reclassified.hint ?? 'technical');
      }
      return;
    }

    // No terminal punctuation — the speaker may still be talking. Arm the debounce
    // timer; if another final arrives within the window we'll re-enter and extend.
    const timer = setTimeout(() => {
      const pending = this.pendingQuestion;
      this.pendingQuestion = null;
      if (!pending) return;
      const reclassified = classifyQuestion({
        text: pending.text,
        prevAnswerEndedAt: this.lastAnswerEndedAt,
        nowMs: pending.firstTs,
      });
      if (reclassified.isQuestion && this.deps.llmRouter) {
        void this.fireAnswer(pending.text, reclassified.hint ?? 'technical');
      }
    }, this.QUESTION_DEBOUNCE_MS);
    this.pendingQuestion = {
      text: combinedText,
      firstTs,
      hint: classification.hint,
      timer,
    };
  }

  private async fireAnswer(
    question: string,
    hint: 'behavioral' | 'coding' | 'system_design' | 'technical',
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
      // Only apply the cached coding problem when the incoming question is ALSO coding-
      // flavored. Previously ANY stored codingProblem forced effectiveHint='coding', so
      // after a single Analyze-screen capture every future transcript question (behavioral,
      // technical, HR) got answered against the stale coding problem — "how would you
      // handle an unhappy customer" came back as a string-reversal solution. Huge bug.
      const keepCodingProblem = this.codingProblem && hint === 'coding';
      const effectiveHint: 'behavioral' | 'coding' | 'system_design' | 'technical' =
        keepCodingProblem ? 'coding' : hint;
      const codingProblemForContext = keepCodingProblem ? this.codingProblem : null;
      const stream = await this.deps.llmRouter!.startStream({
        tier: this.deps.tier ?? 'free',
        llm: this.llmChoice,
        context: {
          question,
          language: this.language,
          hint: effectiveHint,
          ...(codingProblemForContext ? { codingProblem: codingProblemForContext } : {}),
          ...(priorTurnForContext ? { priorTurn: priorTurnForContext } : {}),
          ...(this.resumeText ? { resume: this.resumeText } : {}),
          ...(this.jobDescriptionText ? { jobDescription: this.jobDescriptionText } : {}),
          ...(buildExtraInstructions(
            this.extraInstructions,
            this.gapContext,
            this.simpleEnglish ? SIMPLE_ENGLISH_DIRECTIVE : null,
          )
            ? {
                extraInstructions: buildExtraInstructions(
                  this.extraInstructions,
                  this.gapContext,
                  this.simpleEnglish ? SIMPLE_ENGLISH_DIRECTIVE : null,
                )!,
              }
            : {}),
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
          this.persistEvent('answer', {
            answerId,
            provider,
            mode: hint,
            question: this.currentAnswerQuestion,
            answer: this.currentAnswerText,
            latencyMs: (answer.firstTokenAt ?? Date.now()) - answer.startedAt,
            chars: answer.totalChars,
          });
        }
        // One-shot use: the coding problem we just answered about shouldn't carry
        // over to the next question. If the candidate pulls up a new problem they'll
        // click Analyze again (which resets codingProblem to the fresh capture).
        if (keepCodingProblem) {
          this.codingProblem = null;
          this.stitchedRawText = null;
          this.lastStitchAt = 0;
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
          { sessionId: this.sessionId, sha: sha.slice(0, 12), source: 'cache', pngBytes: png.byteLength },
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
            pngBytes: png.byteLength,
            rawTextChars: result.text.length,
            rawTextPreview: result.text.slice(0, 120),
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

      // Scroll-stitch: if the candidate took another screenshot within the window, merge
      // its OCR text with the previous one. This handles the common "problem doesn't fit
      // on one screen" case: candidate scrolls, clicks Analyze again, and gets ONE
      // answer grounded in the entire problem text instead of two partial hallucinations.
      const now = Date.now();
      const withinWindow = now - this.lastStitchAt < this.STITCH_WINDOW_MS;
      if (withinWindow && this.stitchedRawText) {
        problem = {
          ...problem,
          rawText: mergeOcrTexts(this.stitchedRawText, problem.rawText),
        };
      }
      this.stitchedRawText = problem.rawText;
      this.lastStitchAt = now;

      this.codingProblem = problem;
      this.send({ type: 'ocr.result', problemId, parsed: problem });
      this.persistEvent('ocr', {
        problemId,
        site: problem.site,
        title: problem.title ?? null,
        difficulty: problem.difficulty ?? null,
        stitched: withinWindow,
      });

      // The screenshot IS the candidate's request: "solve this problem". Fire an immediate
      // coding answer rather than waiting for a separate spoken question. This matches the
      // UX of Ctrl+Shift+C — one keypress from screen to answer.
      //
      // Gate: only skip when OCR truly returned nothing (< 80 chars = unreadable screen or
      // capture race). For anything else we fire the LLM and let it decide whether what's
      // on the screen is a coding problem — the coding prompt pack now explicitly handles
      // "not a problem" by asking the candidate to re-share with the problem visible.
      // Previously we required a detected site (LeetCode/HackerRank), which blocked every
      // other platform: CodeSignal, Codility, CoderByte, HackerEarth, Pramp, in-house
      // Google Docs problems, PDF screenshots, etc. That was too strict.
      if (problem.rawText.trim().length < 80) {
        this.deps.logger.info(
          {
            sessionId: this.sessionId,
            rawTextLen: problem.rawText.trim().length,
            site: problem.site,
          },
          'ocr: not enough readable text — skipping auto-answer',
        );
        this.send({
          type: 'error',
          code: 'INTERNAL',
          message:
            'Couldn\u2019t read much from the shared screen. Make sure the coding problem is fully visible and readable, then try Analyze again.',
        });
        return;
      }
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
    // With the Phase-13 "any page" rewrite we no longer require a detected site, so
    // title is often missing. Prompt the LLM to read raw OCR text itself and decide.
    return 'Solve whatever coding problem is shown on screen. If the OCR text isn\u2019t a coding problem, say so briefly instead of inventing one.';
  }

  private send(msg: ServerMessage): void {
    if (this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(encodeServerMessage(msg));
  }

  /**
   * Append a row to `session_events` when transcript persistence is enabled. Fire and
   * forget — DB hiccups must never delay the live flow. We swallow errors after logging
   * because otherwise a migration lag would force-close the session.
   */
  private persistEvent(kind: string, payload: Record<string, unknown>): void {
    if (!this.persistTranscripts) return;
    if (!this.deps.supabase || !this.dbSessionId) return;
    const sessionId = this.dbSessionId;
    void this.deps.supabase
      .from('session_events')
      .insert({ session_id: sessionId, kind, payload })
      .then((res) => {
        if (res.error) {
          this.deps.logger.warn(
            { err: res.error.message, kind, sessionId },
            'session_events insert failed',
          );
        }
      });
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
    if (this.pendingQuestion?.timer) {
      clearTimeout(this.pendingQuestion.timer);
      this.pendingQuestion = null;
    }
    if (this.currentAnswer) {
      this.currentAnswer.abort.abort();
      this.currentAnswer = null;
    }
    const closers: Promise<void>[] = [];
    if (this.stt) closers.push(this.stt.close());
    if (this.sttCandidate) closers.push(this.sttCandidate.close());
    const results = await Promise.allSettled(closers);
    for (const r of results) {
      if (r.status === 'rejected') {
        this.deps.logger.warn({ err: String(r.reason) }, 'stt close failed');
      }
    }
    this.stt = null;
    this.sttCandidate = null;

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

      // Phase 9b: generate a post-session recap if persistence was on. Fire-and-forget;
      // never block socket close. Gemini call + summary insert happens in the background.
      if (this.persistTranscripts && this.deps.userId) {
        const { generateLiveRecap } = await import('../lib/live-recap');
        void generateLiveRecap({
          supabase: this.deps.supabase,
          sessionId: this.dbSessionId,
          userId: this.deps.userId,
          // The session doesn't hold a fixed mode; the orchestrator classifies each
          // question individually. Omitted so the prompt stays generic.
        }).catch((err) => {
          this.deps.logger.warn(
            { err: String(err), sessionId: this.dbSessionId },
            'live recap failed',
          );
        });
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
/**
 * Hard directive injected when the candidate toggles "Simple English" pre-start.
 * Targets CEFR A2-B1 so non-native speakers can deliver the answer naturally without
 * sounding rehearsed. Stacked after the user's own instructions + gap context so it
 * takes precedence over any prompt-pack default prose style.
 */
export const SIMPLE_ENGLISH_DIRECTIVE =
  'Write in simple English (CEFR A2-B1 level): short sentences, common everyday words, no idioms, no business jargon. The candidate is a non-native speaker and will read this answer aloud.';

/**
 * Merge the user's free-form instructions, the cached gap summary, and any hard
 * directives (e.g. simple-English) into a single block. Order matters: user wording
 * comes first (most specific), then gap defense, then style directives.
 * Returns null when every input is empty so the caller can skip the wrapper entirely.
 */
export function buildExtraInstructions(
  userInstructions: string | null,
  gapContext: string | null,
  directive: string | null = null,
): string | null {
  const parts = [userInstructions, gapContext, directive]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

/**
 * Combine two OCR transcripts into one, de-duplicating line-by-line. Each screenshot the
 * candidate takes as they scroll a long problem will have significant overlap with the
 * previous one (the visible viewport moved a few hundred pixels), so naive concatenation
 * gives the LLM 2–3× the same text and burns tokens. We keep the first occurrence of
 * each non-trivially-short line and append everything new in arrival order.
 *
 * Exported for unit tests.
 */
export function mergeOcrTexts(prev: string, next: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  const push = (raw: string): void => {
    const line = raw.trim();
    if (line.length === 0) return;
    // Short lines (UI chrome like "Run", "Submit", page numbers) are noise — don't
    // dedup them, they're cheap to keep duplicated and fine to mostly drop.
    if (line.length < 4) return;
    // Dedup on a normalized form so "Hello." and "Hello" aren't seen as different.
    const key = line.replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(line);
  };
  for (const l of prev.split('\n')) push(l);
  for (const l of next.split('\n')) push(l);
  return lines.join('\n');
}

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
