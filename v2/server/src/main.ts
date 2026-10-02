import { pathToFileURL } from 'node:url';
import { buildApp } from './app.ts';
import { connectDb } from './db/client.ts';
import { loadConfig } from './platform/config.ts';
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = loadConfig({ ...env, CREW_V2_PORT: env.CREW_V2_PORT ?? '8792' });
  const db = connectDb(config.databaseUrl);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    app = await buildApp({
      db,
      publicOrigin: config.publicOrigin,
      secureCookies: config.publicOrigin.startsWith('https:'),
      sessionEncryptionKey: config.sessionEncryptionKey,
      now: () => new Date(),
    });
    const close = async () => {
      await app?.close();
      await db.end();
    };
    app.addHook('onClose', async () => {
      await db.end();
    });
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    await app.listen({ host: '127.0.0.1', port: config.port });
  } catch (error) {
    await app?.close();
    await db.end();
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    process.stderr.write('Không thể khởi động Crew v2\n');
    process.exitCode = 1;
  });
