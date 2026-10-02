import { pathToFileURL } from 'node:url';
import { connectDb } from '../db/client.ts';
import { loadConfig } from '../platform/config.ts';
import type { Db } from '../platform/contracts.ts';
import { hashPassword } from './password.ts';

export async function bootstrapOwner(db: Db, password: string): Promise<void> {
  const { salt, hash } = await hashPassword(password);
  await db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('crew-v2-owner-bootstrap', 0))`;
    const exists = await tx`select id from owners limit 1`;
    if (exists.length) throw new Error('OWNER_ALREADY_EXISTS');
    await tx`insert into owners (id, password_salt, password_hash) values ('owner', ${salt}, ${hash})`;
  });
}

async function readPasswordFromStdin(): Promise<string> {
  if (process.argv.length > 2) throw new Error('PASSWORD_ARGUMENT_FORBIDDEN');
  let value = '';
  for await (const chunk of process.stdin) {
    value += chunk.toString();
    if (value.length > 4096) throw new Error('PASSWORD_TOO_LONG');
  }
  return value.replace(/\r?\n$/, '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig(process.env);
  const password = await readPasswordFromStdin();
  const db = connectDb(config.databaseUrl);
  try {
    await bootstrapOwner(db, password);
  } finally {
    await db.end();
  }
}
