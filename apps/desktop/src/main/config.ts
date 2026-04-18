import { DesktopEnvSchema, parseOrDie } from '@repo/shared';

export const config = parseOrDie(DesktopEnvSchema, process.env, 'apps/desktop');
