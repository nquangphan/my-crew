import postgres from 'postgres';
import { runMigrations } from '../../src/db/migrate.js';
import { assertTestDatabase, TEST_DATABASE_URL } from './test-database-url.js';

/** Recreates the test schema from the migrations once per run, so every run starts from a clean database. */
export default async function setup(): Promise<void> {
  assertTestDatabase(TEST_DATABASE_URL);
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`select 1`;
  } catch (error) {
    await sql.end({ timeout: 1 });
    throw new Error(
      `Cannot reach the test database at ${TEST_DATABASE_URL}. ` +
        'Start it with: docker compose -f docker-compose.dev.yml up -d --wait',
      { cause: error },
    );
  }
  try {
    await sql.unsafe(
      'drop schema if exists drizzle cascade; drop schema public cascade; create schema public;',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
  await runMigrations(TEST_DATABASE_URL);
}
