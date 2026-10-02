import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { databaseFixture } from './support/db.ts';
import { buildIdentityTestApp } from './support/identity-app.ts';

const withDatabase = databaseFixture(3);

test('auth login, cookie và CSRF chặn request thiếu quyền', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      const missing = await fixture.app.inject({ method: 'GET', url: '/v2/projects' });
      assert.equal(missing.statusCode, 401);
      const wrong = await fixture.app.inject({
        method: 'POST',
        url: '/v2/auth/session',
        payload: { password: 'wrong' },
        headers: { origin: 'http://localhost:5182' },
      });
      assert.equal(wrong.statusCode, 401);
      const me = await fixture.ownerGet('/v2/auth/session');
      assert.equal(me.statusCode, 200);
      assert.equal(me.json().owner.id, 'owner');
      const missingCsrf = await fixture.app.inject({
        method: 'POST',
        url: '/v2/projects',
        payload: { key: 'AB', name: 'Test', repositoryUrl: null },
        headers: { cookie: fixture.cookie, origin: 'http://localhost:5182' },
      });
      assert.equal(missingCsrf.statusCode, 403);
      const bearerOnly = await fixture.app.inject({
        method: 'GET',
        url: '/v2/auth/session',
        headers: { authorization: 'Bearer bogus' },
      });
      assert.equal(bearerOnly.statusCode, 403);
    } finally {
      await fixture.close();
    }
  }));

test('machine provision replay cùng owner và không leak cho machine', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      const a = await fixture.ownerPost('/v2/machines', { name: 'Mac test' }, 'provision-one');
      const b = await fixture.ownerPost('/v2/machines', { name: 'Mac test' }, 'provision-one');
      assert.equal(a.statusCode, 201);
      assert.deepEqual(a.json(), b.json());
      const stored = JSON.stringify(await db`select response from idempotency`);
      assert.equal(stored.includes(a.json().token), false);
      assert.equal(stored.includes('ciphertext'), true);
      assert.equal((await fixture.machineGet('/v2/projects', a.json().token)).statusCode, 403);
      const hashes = JSON.stringify(await db`select token_hash from machines`);
      assert.equal(hashes.includes(a.json().token), false);
    } finally {
      await fixture.close();
    }
  }));

test('auth backup không chứa credential gốc', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      const provision = await fixture.ownerPost('/v2/machines', { name: 'Mac test' }, 'backup-token');
      const token = provision.json().token as string;
      const [database] = await db`select current_database() as name`;
      const containerId = process.env.CREW_V2_TEST_CONTAINER_ID;
      if (!containerId || !database) throw new Error('TEST_DB_MISSING');
      const dump = execFileSync(
        'docker',
        ['exec', containerId, 'pg_dump', '-U', 'postgres', '-d', database.name as string, '--data-only'],
        { encoding: 'utf8' },
      );
      for (const secret of [fixture.password, fixture.cookie.split('=')[1], fixture.csrf, token]) {
        assert.equal(dump.includes(secret ?? ''), false);
      }
    } finally {
      await fixture.close();
    }
  }));

test('auth login khóa sau năm lần sai trong năm phút', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      for (let i = 0; i < 5; i++) {
        const wrong = await fixture.app.inject({
          method: 'POST',
          url: '/v2/auth/session',
          payload: { password: `wrong-${i}` },
          headers: { origin: 'http://localhost:5182' },
        });
        assert.equal(wrong.statusCode, 401);
      }
      const throttled = await fixture.app.inject({
        method: 'POST',
        url: '/v2/auth/session',
        payload: { password: fixture.password },
        headers: { origin: 'http://localhost:5182' },
      });
      assert.equal(throttled.statusCode, 429);
    } finally {
      await fixture.close();
    }
  }));

test('auth forbidden input bị từ chối thay vì xóa thầm', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      const result = await fixture.ownerPost(
        '/v2/machines',
        { name: 'Mac test', admin: true },
        'forbidden-field',
      );
      assert.equal(result.statusCode, 400);
      assert.equal((await db`select count(*)::integer as n from machines`)[0]?.n, 0);
    } finally {
      await fixture.close();
    }
  }));

test('auth session sống qua app restart rồi hết hạn và logout thu hồi', async () =>
  withDatabase(async (db) => {
    const first = await buildIdentityTestApp(db);
    await first.close();
    const fixture = await buildIdentityTestApp(db, first);
    try {
      const session = await fixture.ownerGet('/v2/auth/session');
      assert.equal(session.statusCode, 200);
      assert.equal(session.json().csrfToken, fixture.csrf);
      const logout = await fixture.app.inject({
        method: 'DELETE',
        url: '/v2/auth/session',
        headers: { cookie: fixture.cookie, origin: 'http://localhost:5182', 'x-csrf-token': fixture.csrf },
      });
      assert.equal(logout.statusCode, 204);
      assert.equal((await fixture.ownerGet('/v2/auth/session')).statusCode, 401);
      const login = await fixture.app.inject({
        method: 'POST',
        url: '/v2/auth/session',
        payload: { password: fixture.password },
        headers: { origin: 'http://localhost:5182' },
      });
      const cookie = login.headers['set-cookie']?.toString().split(';')[0] ?? '';
      await db`update sessions set expires_at=now() - interval '1 second' where id_hash in (select id_hash from sessions where revoked_at is null)`;
      assert.equal(
        (await fixture.app.inject({ method: 'GET', url: '/v2/auth/session', headers: { cookie } }))
          .statusCode,
        401,
      );
    } finally {
      await fixture.close();
    }
  }));

test('auth machine và owner không hoán đổi quyền', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      const provision = await fixture.ownerPost('/v2/machines', { name: 'Mac test' }, 'machine-auth');
      const token = provision.json().token as string;
      assert.equal((await fixture.machineGet('/v2/machines/self', token)).statusCode, 200);
      assert.equal((await fixture.ownerGet('/v2/machines/self')).statusCode, 401);
      assert.equal((await fixture.machineGet('/v2/auth/session', token)).statusCode, 403);
      const badOrigin = await fixture.app.inject({
        method: 'POST',
        url: '/v2/projects',
        payload: { key: 'AB', name: 'Demo', repositoryUrl: null },
        headers: {
          cookie: fixture.cookie,
          origin: 'http://evil.test',
          'x-csrf-token': fixture.csrf,
          'idempotency-key': 'bad-origin',
        },
      });
      assert.equal(badOrigin.statusCode, 403);
    } finally {
      await fixture.close();
    }
  }));

test('auth không tạo owner ngầm khi DB chưa bootstrap', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db, undefined, false);
    try {
      assert.equal((await fixture.app.inject({ method: 'GET', url: '/v2/projects' })).statusCode, 503);
      assert.equal(
        (
          await fixture.app.inject({
            method: 'POST',
            url: '/v2/auth/session',
            payload: { password: 'anything' },
            headers: { origin: 'http://localhost:5182' },
          })
        ).statusCode,
        503,
      );
      assert.equal((await db`select count(*)::integer as n from owners`)[0]?.n, 0);
    } finally {
      await fixture.close();
    }
  }));

test('provision replay cùng key khác payload báo conflict không tạo thêm máy', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      assert.equal((await fixture.ownerPost('/v2/machines', { name: 'Mac 1' }, 'same-key')).statusCode, 201);
      const conflict = await fixture.ownerPost('/v2/machines', { name: 'Mac 2' }, 'same-key');
      assert.equal(conflict.statusCode, 409);
      assert.equal(conflict.json().error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal((await db`select count(*)::integer as n from machines`)[0]?.n, 1);
    } finally {
      await fixture.close();
    }
  }));
