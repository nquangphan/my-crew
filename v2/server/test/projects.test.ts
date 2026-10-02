import assert from 'node:assert/strict';
import test from 'node:test';
import { bindProject } from '../src/projects/service.ts';
import { databaseFixture } from './support/db.ts';
import { buildIdentityTestApp } from './support/identity-app.ts';

const withDatabase = databaseFixture(3);

test('binding concurrent cùng revision chỉ một request thành công', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      const machine = (await fixture.ownerPost('/v2/machines', { name: 'Mac 1' }, 'machine-1')).json();
      const project = (
        await fixture.ownerPost(
          '/v2/projects',
          { key: 'DEMO', name: 'Demo', repositoryUrl: null },
          'project-1',
        )
      ).json();
      const path = `/v2/projects/${project.id}/binding`;
      const body = { machineId: machine.machine.id, checkoutPath: '/Users/test/demo', expectedRevision: 1 };
      const results = await Promise.all([
        fixture.ownerPut(path, body, 'bind-1'),
        fixture.ownerPut(path, body, 'bind-2'),
      ]);
      assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
      const stored = await db`select machine_id, binding_revision from projects where id=${project.id}`;
      assert.equal(stored[0]?.machine_id, machine.machine.id);
      assert.equal(stored[0]?.binding_revision, 2);
    } finally {
      await fixture.close();
    }
  }));

test('binding từ chối đổi máy khi đã bound và từ chối máy revoked', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      const machine = (await fixture.ownerPost('/v2/machines', { name: 'Mac 1' }, 'machine-1')).json();
      const project = (
        await fixture.ownerPost(
          '/v2/projects',
          { key: 'DEMO', name: 'Demo', repositoryUrl: null },
          'project-1',
        )
      ).json();
      const path = `/v2/projects/${project.id}/binding`;
      const first = await fixture.ownerPut(
        path,
        { machineId: machine.machine.id, checkoutPath: '/Users/test/demo', expectedRevision: 1 },
        'bind-1',
      );
      assert.equal(first.statusCode, 200);
      const again = await fixture.ownerPut(
        path,
        { machineId: machine.machine.id, checkoutPath: '/Users/test/demo2', expectedRevision: 2 },
        'bind-2',
      );
      assert.equal(again.statusCode, 409);
      assert.equal(again.json().error.code, 'ACTIVE_EXECUTION');
      const unbound = (
        await fixture.ownerPost(
          '/v2/projects',
          { key: 'SECOND', name: 'Second', repositoryUrl: null },
          'project-2',
        )
      ).json();
      await db`update machines set revoked_at=now() where id=${machine.machine.id}`;
      const revoked = await fixture.ownerPut(
        `/v2/projects/${unbound.id}/binding`,
        { machineId: machine.machine.id, checkoutPath: '/Users/test/second', expectedRevision: 1 },
        'bind-revoked',
      );
      assert.equal(revoked.statusCode, 404);
    } finally {
      await fixture.close();
    }
  }));

test('project từ chối URL có userinfo và giới hạn phân trang vượt 100', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      const invalid = await fixture.ownerPost(
        '/v2/projects',
        { key: 'DEMO', name: 'Demo', repositoryUrl: 'https://user:pass@example.test/repo' },
        'bad-repo',
      );
      assert.equal(invalid.statusCode, 400);
      assert.equal((await fixture.ownerGet('/v2/projects?limit=101')).statusCode, 400);
    } finally {
      await fixture.close();
    }
  }));

test('project key trùng báo conflict rõ ràng và không tạo thêm project', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      const body = { key: 'DUP', name: 'Demo', repositoryUrl: null };
      assert.equal((await fixture.ownerPost('/v2/projects', body, 'duplicate-a')).statusCode, 201);
      const conflict = await fixture.ownerPost('/v2/projects', body, 'duplicate-b');
      assert.equal(conflict.statusCode, 409);
      assert.equal(conflict.json().error.code, 'PROJECT_KEY_CONFLICT');
      assert.equal((await db`select count(*)::integer as n from projects`)[0]?.n, 1);
    } finally {
      await fixture.close();
    }
  }));

test('project list phân trang ổn định và chỉ machine bound đọc event dự án', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      const firstMachine = (await fixture.ownerPost('/v2/machines', { name: 'Mac 1' }, 'm1')).json();
      const secondMachine = (await fixture.ownerPost('/v2/machines', { name: 'Mac 2' }, 'm2')).json();
      const one = (
        await fixture.ownerPost('/v2/projects', { key: 'AA', name: 'A', repositoryUrl: null }, 'p1')
      ).json();
      const two = (
        await fixture.ownerPost('/v2/projects', { key: 'BB', name: 'B', repositoryUrl: null }, 'p2')
      ).json();
      await fixture.ownerPut(
        `/v2/projects/${one.id}/binding`,
        { machineId: firstMachine.machine.id, checkoutPath: '/Users/test/a', expectedRevision: 1 },
        'b1',
      );
      await fixture.ownerPut(
        `/v2/projects/${two.id}/binding`,
        { machineId: secondMachine.machine.id, checkoutPath: '/Users/test/b', expectedRevision: 1 },
        'b2',
      );
      const page = (await fixture.ownerGet('/v2/projects?limit=1')).json();
      assert.equal(page.items.length, 1);
      assert.equal(typeof page.nextCursor, 'string');
      const next = (await fixture.ownerGet(`/v2/projects?limit=1&cursor=${page.nextCursor}`)).json();
      assert.equal(next.items.length, 1);
      assert.notEqual(next.items[0].id, page.items[0].id);
      const events = (await fixture.machineGet('/v2/events?after=0', firstMachine.token)).json().items;
      assert.equal(
        events.some((event: { projectId: string | null }) => event.projectId === one.id),
        true,
      );
      assert.equal(
        events.some((event: { projectId: string | null }) => event.projectId === two.id),
        false,
      );
    } finally {
      await fixture.close();
    }
  }));

test('binding guard cho phép đổi máy sau đối chiếu và xóa commit checkout cũ', async () =>
  withDatabase(async (db) => {
    const fixture = await buildIdentityTestApp(db);
    try {
      const firstMachine = (await fixture.ownerPost('/v2/machines', { name: 'Mac 1' }, 'guard-m1')).json();
      const nextMachine = (await fixture.ownerPost('/v2/machines', { name: 'Mac 2' }, 'guard-m2')).json();
      const project = (
        await fixture.ownerPost(
          '/v2/projects',
          { key: 'GUARD', name: 'Guard', repositoryUrl: null },
          'guard-p',
        )
      ).json();
      await fixture.ownerPut(
        `/v2/projects/${project.id}/binding`,
        {
          machineId: firstMachine.machine.id,
          checkoutPath: '/Users/test/old',
          expectedRevision: 1,
        },
        'guard-b1',
      );
      await db`update projects set expected_commit=${'a'.repeat(40)} where id=${project.id}`;
      let guardCalled = false;
      const rebound = await db.begin(async (tx) =>
        bindProject(
          tx,
          project.id,
          {
            machineId: nextMachine.machine.id,
            checkoutPath: '/Users/test/new',
            expectedRevision: 2,
          },
          async (scope, id) => {
            const [locked] = await scope`select machine_id from projects where id=${id}`;
            assert.equal(locked?.machine_id, firstMachine.machine.id);
            guardCalled = true;
          },
        ),
      );
      assert.equal(guardCalled, true);
      assert.equal(rebound.machineId, nextMachine.machine.id);
      assert.equal(rebound.bindingRevision, 3);
      const [stored] = await db`select expected_commit from projects where id=${project.id}`;
      assert.equal(stored?.expected_commit, null);
    } finally {
      await fixture.close();
    }
  }));
