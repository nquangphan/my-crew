import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject } from '../src/projects/service.ts';
import { databaseFixture } from './support/db.ts';
import { inputTicket, owner, ticketFixture } from './support/tickets.ts';

const withDatabase = databaseFixture(4);

test('hierarchy rejects a task directly under a request and cross-project parent', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    await assert.rejects(
      () =>
        f.mutation('bad-level', (tx) =>
          f.services.createTicket(tx, inputTicket(f.project.id, 'task', f.request.id), owner),
        ),
      { code: 'TICKET_HIERARCHY' },
    );
    const other = await f.mutation('other', (tx) =>
      f.services.createTicket(tx, inputTicket(f.project.id, 'request'), owner),
    );
    assert.notEqual(other.rootId, f.request.id);
    const secondProject = await f.mutation('second-project', (tx) =>
      createProject(tx, { key: 'SECOND', name: 'Second', repositoryUrl: null }),
    );
    await assert.rejects(
      () =>
        f.mutation('cross-project-child', (tx) =>
          f.services.createTicket(tx, inputTicket(secondProject.id, 'step', f.request.id), owner),
        ),
      { code: 'TICKET_HIERARCHY' },
    );
    await assert.rejects(
      () => f.mutation('cross-root-edge', (tx) => f.services.addDependency(tx, f.a.id, other.id, 1)),
      { code: 'DEPENDENCY_SCOPE' },
    );
  }));

test('concurrent opposite edges cannot create a dependency cycle', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    const add = (id: string, predecessor: string, key: string) =>
      f.mutation(key, (tx) => f.services.addDependency(tx, id, predecessor, 1));
    const results = await Promise.allSettled([add(f.a.id, f.b.id, 'a-b'), add(f.b.id, f.a.id, 'b-a')]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failed.reason.code, 'DEPENDENCY_CYCLE');
    assert.equal((await db`select * from dependencies`).length, 1);
  }));

test('dependencies_ready refuses a step whose predecessor is unfinished', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    await f.mutation('edge', (tx) => f.services.addDependency(tx, f.a.id, f.b.id, 1));
    await assert.rejects(
      () =>
        f.mutation('ready', (tx) =>
          f.services.signalTicket(tx, f.a.id, 'dependencies_ready', 2, null, owner),
        ),
      { code: 'DEPENDENCIES_NOT_READY' },
    );
  }));
