import { buildServer, config } from './server';
import { logger } from './logger';

async function main(): Promise<void> {
  const app = await buildServer();
  try {
    await app.listen({ port: config.API_PORT, host: config.API_HOST });
    logger.info({ port: config.API_PORT, host: config.API_HOST }, 'api listening');
  } catch (err) {
    logger.fatal({ err: String(err) }, 'failed to start api');
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
