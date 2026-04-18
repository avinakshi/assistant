import pino from 'pino';
import { config } from './config';

/**
 * Structured JSON logger. Never log transcripts, resume contents, or answer text verbatim —
 * only frame metadata (lengths, durations, token counts). Redact emails and names before logging.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'email', 'name', 'fullName'],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: { service: 'api' },
  ...(config.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
});
