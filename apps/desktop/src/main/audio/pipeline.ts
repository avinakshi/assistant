import type { AudioSource } from './audio-source';
import { WsClient } from '../ws/ws-client';
import { logger } from '../logger';
import type { EchoStatsPayload } from '../../shared/ipc-contract';

/**
 * Wires an AudioSource → WsClient. Sole responsibility: forward every PCM frame as a
 * binary WS message, and expose echo-stats telemetry to the main process for IPC broadcast.
 */
export class AudioPipeline {
  private framesSent = 0;
  private lastLog = Date.now();
  private statsListeners: ((payload: EchoStatsPayload) => void)[] = [];

  constructor(
    private readonly source: AudioSource,
    private readonly ws: WsClient,
  ) {
    this.source.onFrame((frame) => this.handleFrame(frame));
    this.source.onError((code, message) => logger.error({ code, message }, 'audio source error'));
    this.ws.onStats((s) => {
      logger.debug(
        { fps: s.framesPerSecond, rmsDb: s.rmsDb, totalFrames: s.framesReceived },
        'api echo.stats',
      );
      const payload: EchoStatsPayload = {
        framesReceived: s.framesReceived,
        framesPerSecond: s.framesPerSecond,
        rmsDb: s.rmsDb,
        windowMs: s.windowMs,
      };
      for (const l of this.statsListeners) l(payload);
    });
  }

  /** Subscribe to echo-stats updates (one-per-second). Returns an unsubscribe function. */
  onStats(listener: (payload: EchoStatsPayload) => void): () => void {
    this.statsListeners.push(listener);
    return () => {
      this.statsListeners = this.statsListeners.filter((l) => l !== listener);
    };
  }

  async start(): Promise<void> {
    await this.ws.connect();
    await this.source.start();
    logger.info({}, 'audio pipeline started');
  }

  async stop(): Promise<void> {
    await this.source.stop();
    await this.ws.disconnect();
    logger.info({ framesSent: this.framesSent }, 'audio pipeline stopped');
  }

  private handleFrame(frame: Int16Array): void {
    this.ws.sendFrame(frame);
    this.framesSent += 1;
    const now = Date.now();
    if (now - this.lastLog >= 5000) {
      logger.debug({ framesSent: this.framesSent }, 'pipeline heartbeat');
      this.lastLog = now;
    }
  }
}
