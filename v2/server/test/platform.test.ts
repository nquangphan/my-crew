import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import postgres from 'postgres';
import { connectDb } from '../src/db/client.ts';
import { captureMigrations, migrate } from '../src/db/migrate.ts';
import { loadConfig } from '../src/platform/config.ts';
import { databaseFixture } from './support/db.ts';

const withDatabase = databaseFixture(1);
const withUnmigratedDatabase = databaseFixture(1, { migrate: false });

test('không dùng DB v1 hoặc port DB dùng chung', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/crew' }), /CREW_V2_DATABASE_URL/);
  for (const port of [5432, 55432]) {
    assert.throws(
      () =>
        loadConfig({
          CREW_V2_DATABASE_URL: `postgres://localhost:${port}/crew_v2_test`,
          CREW_V2_PUBLIC_ORIGIN: 'http://localhost:5182',
        }),
      /SHARED_DB_PORT/,
    );
  }
});

test('migration chạy lại và giữ dữ liệu', async () =>
  withDatabase(async (db) => {
    const set = await captureMigrations(1);
    await migrate(db, set);
    await migrate(db, set);
    const rows = await db`select version from schema_migrations order by version`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.version, 1);
    const marker = await db`select system_name from system_identity`;
    assert.equal(marker[0]?.system_name, 'crew-v2');
  }));

test('hai lượt migration đồng thời giữ một bản ghi mỗi version', async () =>
  withUnmigratedDatabase(async (db) => {
    const set = await captureMigrations(1);
    await Promise.all([migrate(db, set), migrate(db, set)]);
    const rows = await db`select version from schema_migrations`;
    assert.deepEqual(
      rows.map((row) => row.version),
      [1],
    );
  }));

test('captureMigrations từ chối prefix chưa có file SQL', async () => {
  await assert.rejects(captureMigrations(999), /MIGRATION_SEQUENCE_INVALID/);
});

test('fixture tạo logical DB đã migrate trước callback', async () =>
  withDatabase(async (db) => {
    const marker = await db`select system_name from system_identity`;
    assert.equal(marker[0]?.system_name, 'crew-v2');
  }));

test('cấu hình hợp lệ giữ khóa 32 byte và DB v2 riêng', () => {
  const key = randomBytes(32).toString('hex');
  const value = loadConfig({
    CREW_V2_DATABASE_URL: 'postgres://crew@127.0.0.1:49123/crew_v2_prod',
    CREW_V2_PUBLIC_ORIGIN: 'https://crew.example.test',
    CREW_V2_SESSION_ENCRYPTION_KEY: key,
  });
  assert.equal(value.port, 8788);
  assert.equal(value.sessionEncryptionKey.length, 32);
  assert.equal(value.sessionEncryptionKey.toString('hex'), key);
});

test('DB client từ chối endpoint dùng chung trước khi tạo pool', () => {
  assert.throws(() => connectDb('postgres://localhost:5432/crew_v2_prod'), /SHARED_DB_PORT/);
  assert.throws(() => connectDb('postgres://db/crew'), /NOT_V2_DATABASE/);
});

test('migration từ chối database có bảng lạ trước khi ghi schema', async () =>
  withUnmigratedDatabase(async (db) => {
    await db`create table foreign_data (id integer)`;
    await assert.rejects(migrate(db, await captureMigrations(1)), /NOT_V2_DATABASE/);
    const tables =
      await db`select tablename from pg_tables where schemaname = current_schema() order by tablename`;
    assert.deepEqual(
      tables.map((row) => row.tablename),
      ['foreign_data'],
    );
  }));

test('fixture từ chối URL không khớp container do runner tạo', async () => {
  const original = process.env.CREW_V2_TEST_DATABASE_URL;
  try {
    process.env.CREW_V2_TEST_DATABASE_URL = 'postgres://postgres@127.0.0.1:49123/crew_v2_test';
    await assert.rejects(
      withDatabase(async () => {}),
      /UNSAFE_TEST_DB_CONTAINER/,
    );
  } finally {
    if (original === undefined) delete process.env.CREW_V2_TEST_DATABASE_URL;
    else process.env.CREW_V2_TEST_DATABASE_URL = original;
  }
});

test('migration lỗi SQL rollback toàn bộ schema', async () =>
  withUnmigratedDatabase(async (db) => {
    const dir = await mkdtemp(join(tmpdir(), 'crew-v2-migrations-'));
    try {
      const base = await readFile(new URL('../migrations/001_platform.sql', import.meta.url));
      await writeFile(join(dir, '001_platform.sql'), base);
      await writeFile(
        join(dir, '002_failure.sql'),
        'create table rollback_probe (id integer); select * from table_does_not_exist;',
      );
      await assert.rejects(migrate(db, await captureMigrations(2, dir)));
      const tables = await db`select tablename from pg_tables where schemaname = current_schema()`;
      assert.equal(tables.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }));

test('migration checksum drift bị chặn và không sửa dữ liệu', async () =>
  withDatabase(async (db) => {
    const dir = await mkdtemp(join(tmpdir(), 'crew-v2-migrations-'));
    try {
      const base = await readFile(new URL('../migrations/001_platform.sql', import.meta.url));
      await writeFile(join(dir, '001_platform.sql'), base);
      const set = await captureMigrations(1, dir);
      await migrate(db, set);
      await db`create table owner_data (value text)`;
      await db`insert into owner_data (value) values ('untouched')`;
      await writeFile(join(dir, '001_platform.sql'), Buffer.concat([base, Buffer.from('\n-- edited\n')]));
      await assert.rejects(migrate(db, await captureMigrations(1, dir)), /MIGRATION_DRIFT/);
      const rows = await db`select value from owner_data`;
      assert.equal(rows[0]?.value, 'untouched');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }));

test('migration set đã chụp không đổi khi file SQL đổi sau đó', async () =>
  withUnmigratedDatabase(async (db) => {
    const dir = await mkdtemp(join(tmpdir(), 'crew-v2-migrations-'));
    try {
      const base = await readFile(new URL('../migrations/001_platform.sql', import.meta.url));
      await writeFile(join(dir, '001_platform.sql'), base);
      const set = await captureMigrations(1, dir);
      await writeFile(join(dir, '001_platform.sql'), 'create table unexpected (id int);');
      await migrate(db, set);
      const marker = await db`select system_name from system_identity`;
      assert.equal(marker[0]?.system_name, 'crew-v2');
      const unexpected = await db`select tablename from pg_tables where tablename = 'unexpected'`;
      assert.equal(unexpected.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }));

test('backup và restore trong container test giữ marker và dữ liệu', async () =>
  withDatabase(async (db) => {
    const containerId = process.env.CREW_V2_TEST_CONTAINER_ID;
    assert.ok(containerId && /^[0-9a-f]{64}$/.test(containerId), 'Test runner phải cấp container ID riêng');
    const source = await db`select current_database() as name`;
    const sourceName = source[0]?.name as string;
    await db`create table backup_probe (value text not null)`;
    await db`insert into backup_probe (value) values ('retained')`;
    const dump = spawnSync('docker', ['exec', containerId, 'pg_dump', '-Fc', '-U', 'postgres', sourceName], {
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(dump.status, 0, dump.stderr.toString());
    const restoredName = `crew_v2_test_${randomUUID().replaceAll('-', '')}`;
    const baseUrl = process.env.CREW_V2_TEST_DATABASE_URL;
    assert.ok(baseUrl, 'Test runner phải cấp URL database riêng');
    const admin = postgres(baseUrl, { max: 1 });
    try {
      await admin`create database ${admin(restoredName)}`;
      try {
        const restore = spawnSync(
          'docker',
          ['exec', '-i', containerId, 'pg_restore', '-U', 'postgres', '-d', restoredName],
          { input: dump.stdout, maxBuffer: 4 * 1024 * 1024 },
        );
        assert.equal(restore.status, 0, restore.stderr.toString());
        const url = new URL(baseUrl);
        url.pathname = `/${restoredName}`;
        const restored = connectDb(url.toString());
        try {
          const rows = await restored`select value from backup_probe`;
          assert.deepEqual(
            rows.map((row) => row.value),
            ['retained'],
          );
          const marker = await restored`select system_name from system_identity`;
          assert.equal(marker[0]?.system_name, 'crew-v2');
        } finally {
          await restored.end();
        }
      } finally {
        await admin`drop database ${admin(restoredName)} with (force)`;
      }
    } finally {
      await admin.end();
    }
  }));
