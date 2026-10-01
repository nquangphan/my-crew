import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { connectDb } from '../../src/db/client.ts';
import { captureMigrations, migrate } from '../../src/db/migrate.ts';
import type { Db } from '../../src/platform/contracts.ts';

const execFileAsync = promisify(execFile);

export function databaseFixture(through: number, options: { migrate?: boolean } = {}) {
  return async (fn: (db: Db) => Promise<void>): Promise<void> => {
    const set = await captureMigrations(through);
    const baseUrl = process.env.CREW_V2_TEST_DATABASE_URL;
    if (!baseUrl) throw new Error('CREW_V2_TEST_DATABASE_URL_REQUIRED');
    const url = new URL(baseUrl);
    if (
      url.hostname !== '127.0.0.1' ||
      url.username !== 'postgres' ||
      url.password ||
      url.search ||
      url.pathname !== '/crew_v2_test' ||
      ['', '5432', '55432'].includes(url.port)
    )
      throw new Error('UNSAFE_TEST_DB_URL');
    const containerId = process.env.CREW_V2_TEST_CONTAINER_ID;
    if (!containerId || !/^[0-9a-f]{64}$/.test(containerId)) throw new Error('UNSAFE_TEST_DB_CONTAINER');
    try {
      const [inspection, mapping] = await Promise.all([
        execFileAsync('docker', ['inspect', '--format', '{{.Name}}', containerId]),
        execFileAsync('docker', ['port', containerId, '5432/tcp']),
      ]);
      if (
        !/^\/crew-v2-test-[0-9a-f-]{36}\s*$/.test(inspection.stdout) ||
        mapping.stdout.trim() !== `127.0.0.1:${url.port}`
      )
        throw new Error('UNSAFE_TEST_DB_CONTAINER');
    } catch {
      throw new Error('UNSAFE_TEST_DB_CONTAINER');
    }
    const name = `crew_v2_test_${randomUUID().replaceAll('-', '')}`;
    const admin = postgres(baseUrl, { max: 1 });
    let created = false;
    try {
      await admin`create database ${admin(name)}`;
      created = true;
      url.pathname = `/${name}`;
      const db = connectDb(url.toString());
      try {
        if (options.migrate !== false) await migrate(db, set);
        await fn(db);
      } finally {
        await db.end();
      }
    } finally {
      try {
        if (created) await admin`drop database ${admin(name)} with (force)`;
      } finally {
        await admin.end();
      }
    }
  };
}
