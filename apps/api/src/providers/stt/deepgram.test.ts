import { describe, expect, it } from 'vitest';
import { buildDeepgramUrl, parseDeepgramEvent } from './deepgram';

describe('buildDeepgramUrl', () => {
  it('locks the spec query string', () => {
    const url = buildDeepgramUrl({ language: 'en', sampleRateHz: 16000 });
    expect(url).toContain('wss://api.deepgram.com/v1/listen');
    expect(url).toContain('encoding=linear16');
    expect(url).toContain('sample_rate=16000');
    expect(url).toContain('channels=1');
    expect(url).toContain('model=nova-3');
    expect(url).toContain('language=en');
    expect(url).toContain('smart_format=true');
    expect(url).toContain('punctuate=true');
    expect(url).toContain('interim_results=true');
    expect(url).toContain('endpointing=300');
    expect(url).toContain('utterance_end_ms=1000');
    expect(url).toContain('vad_events=true');
  });

  it('passes the caller-selected language through unchanged', () => {
    expect(buildDeepgramUrl({ language: 'hi', sampleRateHz: 16000 })).toContain('language=hi');
    expect(buildDeepgramUrl({ language: 'en-IN', sampleRateHz: 16000 })).toContain(
      'language=en-IN',
    );
  });

  it('honors the sample rate we pass (defense against pipeline changes)', () => {
    expect(buildDeepgramUrl({ language: 'en', sampleRateHz: 8000 })).toContain('sample_rate=8000');
  });

  it('uses a caller-provided base URL (for mock-server tests)', () => {
    const url = buildDeepgramUrl(
      { language: 'en', sampleRateHz: 16000 },
      'ws://localhost:9999/fake',
    );
    expect(url.startsWith('ws://localhost:9999/fake?')).toBe(true);
  });
});

describe('parseDeepgramEvent', () => {
  it('extracts a partial transcript', () => {
    const event = parseDeepgramEvent({
      type: 'Results',
      is_final: false,
      channel: { alternatives: [{ transcript: 'tell me about' }] },
    });
    expect(event).toEqual({ kind: 'transcript', text: 'tell me about', isFinal: false });
  });

  it('extracts a final transcript', () => {
    const event = parseDeepgramEvent({
      type: 'Results',
      is_final: true,
      channel: { alternatives: [{ transcript: 'tell me about yourself' }] },
    });
    expect(event).toEqual({
      kind: 'transcript',
      text: 'tell me about yourself',
      isFinal: true,
    });
  });

  it('ignores empty transcripts', () => {
    const event = parseDeepgramEvent({
      type: 'Results',
      is_final: false,
      channel: { alternatives: [{ transcript: '' }] },
    });
    expect(event.kind).toBe('unknown');
  });

  it('parses utterance-end events', () => {
    const event = parseDeepgramEvent({ type: 'UtteranceEnd', last_word_end: 3.25 });
    expect(event).toEqual({ kind: 'utterance-end', lastWordEndMs: 3250 });
  });

  it('parses speech-started + metadata events', () => {
    expect(parseDeepgramEvent({ type: 'SpeechStarted' })).toEqual({ kind: 'speech-started' });
    expect(parseDeepgramEvent({ type: 'Metadata', request_id: 'x' })).toEqual({
      kind: 'metadata',
    });
  });

  it('returns unknown for null / non-object input', () => {
    expect(parseDeepgramEvent(null).kind).toBe('unknown');
    expect(parseDeepgramEvent(42).kind).toBe('unknown');
    expect(parseDeepgramEvent({ type: 'SomeFutureEvent' }).kind).toBe('unknown');
  });
});
