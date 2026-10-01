import postgres from 'postgres';
import type { Db } from '../platform/contracts.ts';

export function connectDb(url: string): Db {
  const u = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.pathname.startsWith('/crew_v2_')) {
    throw new Error('NOT_V2_DATABASE');
  }
  if (
    ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname) &&
    ['', '5432', '55432'].includes(u.port)
  )
    throw new Error('SHARED_DB_PORT');
  return postgres(url, { max: 8, idle_timeout: 20, connect_timeout: 5 });
}
