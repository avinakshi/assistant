import { describe, it, expect } from 'vitest';
import { readNdjson, type CodingAnswerEvent } from './api';

/**
 * readNdjson consumes a ReadableStream of Uint8Array and yields typed events. Build a
 * fake ReadableStream from a string to exercise the parser boundaries (cross-chunk
 * newlines, partial lines, trailing whitespace, malformed JSON).
 */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i]!));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<CodingAnswerEvent[]> {
  const out: CodingAnswerEvent[] = [];
  for await (const ev of readNdjson(body)) out.push(ev);
  return out;
}

describe('readNdjson', () => {
  it('yields one event per line in order', async () => {
    const body = streamOf([
      '{"type":"start","provider":"gemini"}\n',
      '{"type":"delta","text":"Hello "}\n',
      '{"type":"delta","text":"world"}\n',
      '{"type":"done","provider":"gemini","latencyMs":500,"chars":11}\n',
    ]);
    const events = await collect(body);
    expect(events).toEqual([
      { kind: 'start', provider: 'gemini' },
      { kind: 'delta', text: 'Hello ' },
      { kind: 'delta', text: 'world' },
      { kind: 'done', provider: 'gemini', latencyMs: 500, chars: 11 },
    ]);
  });

  it('handles a line split across multiple chunks', async () => {
    const body = streamOf([
      '{"type":"sta',
      'rt","provid',
      'er":"gemini"}\n{"type":"done","provider":"gemini","latencyMs":0,"chars":0}\n',
    ]);
    const events = await collect(body);
    expect(events[0]).toEqual({ kind: 'start', provider: 'gemini' });
    expect(events[1]!.kind).toBe('done');
  });

  it('tolerates a final line without a trailing newline', async () => {
    const body = streamOf(['{"type":"delta","text":"tail"}']);
    const events = await collect(body);
    expect(events).toEqual([{ kind: 'delta', text: 'tail' }]);
  });

  it('drops unparseable lines silently', async () => {
    const body = streamOf([
      '{"type":"delta","text":"ok"}\n',
      'not json at all\n',
      '{"type":"done","provider":"x","latencyMs":1,"chars":2}\n',
    ]);
    const events = await collect(body);
    expect(events.length).toBe(2);
    expect(events[0]!.kind).toBe('delta');
    expect(events[1]!.kind).toBe('done');
  });

  it('drops events with an unknown type', async () => {
    const body = streamOf(['{"type":"heartbeat"}\n{"type":"delta","text":"ok"}\n']);
    const events = await collect(body);
    expect(events).toEqual([{ kind: 'delta', text: 'ok' }]);
  });

  it('handles empty streams', async () => {
    const body = streamOf([]);
    const events = await collect(body);
    expect(events).toEqual([]);
  });

  it('coerces missing text on delta to empty string', async () => {
    const body = streamOf(['{"type":"delta"}\n']);
    const events = await collect(body);
    expect(events).toEqual([{ kind: 'delta', text: '' }]);
  });
});
