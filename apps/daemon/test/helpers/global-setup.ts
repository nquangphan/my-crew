import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
// @ts-expect-error build.mjs is plain JavaScript without type declarations.
import { buildBundle } from '../../../../packages/docs-kit/build.mjs';
import { runMigrations } from '../../../api/src/db/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    bundlePath: string;
  }
}

let dir: string | undefined;

/**
 * Creates the daemon test database on the crew dev Postgres if needed, recreates its schema from the API
 * migrations, and builds the real crew-docs bundle once.
 */
export async function setup(project: TestProject): Promise<void> {
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? 'postgres://crew:crew@127.0.0.1:55432/crew_daemon_test',
  );
  const name = url.pathname.replace(/^\//, '');
  if (!name.endsWith('_test'))
    throw new Error(`refusing to use "${name}": the database name must end with _test`);
  const admin = new URL(url);
  admin.pathname = '/crew';
  const adminSql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const exists = await adminSql`select 1 from pg_database where datname = ${name}`;
    if (exists.length === 0) await adminSql.unsafe(`create database "${name}"`);
  } catch (error) {
    throw new Error(
      `Cannot prepare ${name} on ${admin.host}. Start the dev database with: docker compose -f docker-compose.dev.yml up -d --wait`,
      { cause: error },
    );
  } finally {
    await adminSql.end({ timeout: 5 });
  }
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(
      'drop schema if exists drizzle cascade; drop schema public cascade; create schema public;',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
  await runMigrations(url.toString());

  dir = mkdtempSync(join(tmpdir(), 'crewd-bundle-'));
  project.provide('bundlePath', (await buildBundle(join(dir, 'crew-docs.cjs'))) as string);
}

export async function teardown(): Promise<void> {
  if (dir) rmSync(dir, { recursive: true, force: true });
}
