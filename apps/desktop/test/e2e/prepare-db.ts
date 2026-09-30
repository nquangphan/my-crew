/**
 * Prepares the desktop E2E database before the API starts: recreates the schema from the migrations, seeds
 * the owner with a random password, stores single-use pairing codes, creates one unowned project, and writes what the tests need to `.e2e/state.json`.
 *
 * Run from apps/api so tsx maps `@crew/shared` to its sources:
 *   pnpm --filter @crew/api exec tsx ../desktop/test/e2e/prepare-db.ts
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import postgres from 'postgres';
import { seedOwner } from '../../../api/src/cli/seed-owner.js';
import { createDb } from '../../../api/src/db/client.js';
import { runMigrations } from '../../../api/src/db/migrate.js';
import { createProject } from '../../../api/src/services/project-service.js';
import {
  assertE2eDatabase,
  E2E_ADMIN_DATABASE_URL,
  E2E_DATABASE_URL,
  E2E_STATE_FILE,
  type E2eState,
} from './e2e-env.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

async function resetDatabase(): Promise<void> {
  assertE2eDatabase(E2E_DATABASE_URL);
  const name = new URL(E2E_DATABASE_URL).pathname.slice(1);
  const admin = postgres(E2E_ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const [row] = await admin`select 1 as ok from pg_database where datname = ${name}`;
    if (!row) await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(
      'drop schema if exists drizzle cascade; drop schema public cascade; create schema public;',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
  await runMigrations(E2E_DATABASE_URL);
}

async function main(): Promise<void> {
  await resetDatabase();
  const handle = createDb(E2E_DATABASE_URL, { max: 2 });
  try {
    const db = handle.db;
    const username = 'desktop-e2e-owner';
    const password = randomBytes(18).toString('base64url');
    await seedOwner(db, { username, password, reset: true });
    const pairingCode = async () => {
      const code = Array.from({ length: 12 }, () => BASE32[randomInt(BASE32.length)]).join('');
      const codeHash = createHash('sha256').update(code).digest('hex');
      await db.$client`insert into pairing_codes (code_hash, expires_at) values (${codeHash}, now() + interval '10 minutes')`;
      return code;
    };
    const repoUrl = 'https://github.com/2p/shop-api.git';
    await createProject(db, {
      key: 'SHOP',
      name: 'Shop API',
      description: 'API bán hàng: đơn hàng, thanh toán, hoàn tiền.',
      repoUrl,
      platform: 'backend',
    });
    const state: E2eState = {
      username,
      password,
      pairingCodes: await Promise.all(Array.from({ length: 9 }, () => pairingCode())),
      project: { key: 'SHOP', repoUrl },
    };
    mkdirSync(dirname(E2E_STATE_FILE), { recursive: true });
    writeFileSync(E2E_STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
    console.log(`desktop E2E database ready (${new URL(E2E_DATABASE_URL).pathname.slice(1)})`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
