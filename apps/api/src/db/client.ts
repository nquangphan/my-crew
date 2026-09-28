import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.js';

/** Drizzle over postgres.js; `$client` is the driver, used for LISTEN. */
export type Database = PostgresJsDatabase<typeof schema> & { $client: Sql };
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** A pool-backed database or an open transaction. Services accept either, so callers can compose them. */
export type Executor = Database | Transaction;

export interface DbHandle {
  db: Database;
  close(): Promise<void>;
}

export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const client = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}
