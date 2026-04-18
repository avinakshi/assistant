/**
 * Mock Deepgram-compatible WebSocket server. Accepts binary PCM frames, ignores them,
 * and emits scripted transcript events on a schedule — enough to exercise the full pipeline
 * (desktop PCM → api → "deepgram" → transcripts → client) without a real API key.
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export interface ScriptedEvent {
  delayMs: number;
  payload: unknown;
}

export interface MockDeepgram {
  url: string;
  close: () => Promise<void>;
  connections: () => number;
}

export async function startMockDeepgram(script: ScriptedEvent[]): Promise<MockDeepgram> {
  const http: Server = createServer();
  const wss = new WebSocketServer({ server: http });
  let connections = 0;

  wss.on('connection', (ws: WebSocket) => {
    connections += 1;
    for (const ev of script) {
      setTimeout(() => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev.payload));
      }, ev.delayMs);
    }
    ws.on('message', () => {
      // We accept but discard. Real Deepgram would transcribe; our script ignores audio.
    });
  });

  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
  const addr = http.address() as AddressInfo;
  const url = `ws://127.0.0.1:${addr.port}`;

  return {
    url,
    connections: () => connections,
    close: () =>
      new Promise((resolve) => {
        wss.close();
        http.close(() => resolve());
      }),
  };
}
