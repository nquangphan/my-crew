import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../platform/config.ts';
import type { Db } from '../platform/contracts.ts';
import { connectDb } from './client.ts';

const defaultDir = fileURLToPath(new URL('../../migrations/', import.meta.url));
export type MigrationSet = {
  through: number;
  files: ReadonlyArray<{
    version: number;
    name: string;
    sha256: string;
    sql: string;
  }>;
};

export async function captureMigrations(through: number, migrationsDir = defaultDir): Promise<MigrationSet> {
  if (!Number.isSafeInteger(through) || through < 1) throw new Error('MIGRATION_SEQUENCE_INVALID');
  const names = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  const files = [];
  for (let version = 1; version <= through; version++) {
    const matches = names.filter((name) => name.startsWith(`${String(version).padStart(3, '0')}_`));
    const [name] = matches;
    if (!name || matches.length !== 1 || !/^\d{3}_[a-z0-9_]+\.sql$/.test(name)) {
      throw new Error('MIGRATION_SEQUENCE_INVALID');
    }
    const source = await readFile(join(migrationsDir, name));
    files.push(
      Object.freeze({
        version,
        name,
        sha256: createHash('sha256').update(source).digest('hex'),
        sql: source.toString('utf8'),
      }),
    );
  }
  return Object.freeze({ through, files: Object.freeze(files) });
}

export async function migrate(db: Db, set: MigrationSet): Promise<void> {
  if (!set || !Number.isSafeInteger(set.through) || set.through < 1 || set.files.length !== set.through) {
    throw new Error('MIGRATION_SET_INVALID');
  }
  for (const [index, file] of set.files.entries()) {
    if (
      file.version !== index + 1 ||
      !new RegExp(`^${String(index + 1).padStart(3, '0')}_[a-z0-9_]+\\.sql$`).test(file.name) ||
      createHash('sha256').update(file.sql).digest('hex') !== file.sha256
    )
      throw new Error('MIGRATION_SET_INVALID');
  }
  await db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('crew-v2-migrations', 0))`;
    const existing = await tx`select tablename from pg_tables where schemaname = current_schema()`;
    const tableNames = existing.map((row) => row.tablename as string);
    if (tableNames.length > 0 && !tableNames.includes('system_identity')) throw new Error('NOT_V2_DATABASE');
    if (tableNames.includes('system_identity')) {
      const identity = await tx`select system_name from system_identity where singleton = true`;
      if (identity.length !== 1 || identity[0]?.system_name !== 'crew-v2') throw new Error('NOT_V2_DATABASE');
    }
    if (!tableNames.includes('schema_migrations')) {
      await tx`create table schema_migrations (
        version integer primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`;
    }
    const applied = await tx`select version, checksum from schema_migrations order by version`;
    if (applied.length > set.through) throw new Error('MIGRATION_SET_BEHIND');
    for (const [index, row] of applied.entries()) {
      if (Number(row.version) !== index + 1) throw new Error('MIGRATION_SEQUENCE_INVALID');
      const migration = set.files[index];
      if (!migration || migration.sha256 !== row.checksum) throw new Error('MIGRATION_DRIFT');
    }
    for (const migration of set.files.slice(applied.length)) {
      await tx.unsafe(migration.sql, [], { prepare: false });
      await tx`insert into schema_migrations (version, checksum) values (${migration.version}, ${migration.sha256})`;
    }
    const identity = await tx`select system_name from system_identity where singleton = true`;
    if (identity.length !== 1 || identity[0]?.system_name !== 'crew-v2') throw new Error('NOT_V2_DATABASE');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig(process.env);
  const through = Number(process.env.CREW_V2_MIGRATION_THROUGH);
  if (!Number.isSafeInteger(through) || through < 1) throw new Error('CREW_V2_MIGRATION_THROUGH_REQUIRED');
  const set = await captureMigrations(through);
  const db = connectDb(config.databaseUrl);
  try {
    await migrate(db, set);
  } finally {
    await db.end();
  }
}
