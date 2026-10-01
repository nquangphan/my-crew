export type Config = {
  databaseUrl: string;
  publicOrigin: string;
  port: number;
  sessionEncryptionKey: Buffer;
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = env.CREW_V2_DATABASE_URL;
  if (!databaseUrl) throw new Error('CREW_V2_DATABASE_URL_REQUIRED');
  let db: URL;
  try {
    db = new URL(databaseUrl);
  } catch {
    throw new Error('CREW_V2_DATABASE_URL_INVALID');
  }
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.pathname.startsWith('/crew_v2_')) {
    throw new Error('NOT_V2_DATABASE');
  }
  if (
    ['localhost', '127.0.0.1', '::1', '[::1]'].includes(db.hostname) &&
    ['', '5432', '55432'].includes(db.port)
  )
    throw new Error('SHARED_DB_PORT');
  const publicOrigin = env.CREW_V2_PUBLIC_ORIGIN;
  if (!publicOrigin) throw new Error('CREW_V2_PUBLIC_ORIGIN_REQUIRED');
  let origin: URL;
  try {
    origin = new URL(publicOrigin);
  } catch {
    throw new Error('CREW_V2_PUBLIC_ORIGIN_INVALID');
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== publicOrigin) {
    throw new Error('CREW_V2_PUBLIC_ORIGIN_INVALID');
  }
  const port = env.CREW_V2_PORT === undefined ? 8788 : Number(env.CREW_V2_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CREW_V2_PORT_INVALID');
  const key = env.CREW_V2_SESSION_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) throw new Error('CREW_V2_SESSION_ENCRYPTION_KEY_INVALID');
  return { databaseUrl, publicOrigin, port, sessionEncryptionKey: Buffer.from(key, 'hex') };
}
