/* eslint-disable no-console */
// Minimal structured logger for desktop main process. Upgrades to electron-log + Sentry in Phase 7.
import { config } from './config';

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
const threshold = LEVELS[config.LOG_LEVEL as Level] ?? LEVELS.info;

function log(level: Level, obj: Record<string, unknown>, msg: string): void {
  if (LEVELS[level] < threshold) return;
  const payload = { ts: new Date().toISOString(), level, msg, ...redact(obj) };
  const line = JSON.stringify(payload);
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (['email', 'name', 'fullName', 'transcript', 'answerText', 'resumeText'].includes(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

export const logger = {
  trace: (o: Record<string, unknown>, m: string) => log('trace', o, m),
  debug: (o: Record<string, unknown>, m: string) => log('debug', o, m),
  info: (o: Record<string, unknown>, m: string) => log('info', o, m),
  warn: (o: Record<string, unknown>, m: string) => log('warn', o, m),
  error: (o: Record<string, unknown>, m: string) => log('error', o, m),
};
