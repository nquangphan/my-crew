import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = createDb(config.databaseUrl);
  const app = await buildApp({ config, db: handle.db, logger: true });
  app.addHook('onClose', () => handle.close());

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down');
      app.close().then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error({ err: error }, 'shutdown failed');
          process.exit(1);
        },
      );
    });
  }

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
