import { ApiEnvSchema, parseOrDie } from '@repo/shared';

export const config = parseOrDie(ApiEnvSchema, process.env, 'apps/api');
