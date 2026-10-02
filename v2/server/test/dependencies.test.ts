import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createProject } from '../src/projects/service.ts';
import { createTicketServices } from '../src/tickets/service.ts';
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

test('closed request and completed step reject new descendants', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    await db`update tickets set status='done' where id=${f.request.id}`;
    await assert.rejects(
      () =>
        f.mutation('after-root-done', (tx) =>
          f.services.createTicket(tx, inputTicket(f.project.id, 'step', f.request.id), owner),
        ),
      { code: 'TICKET_CLOSED' },
    );
    await db`update tickets set status='running' where id=${f.request.id}`;
    await db`update tickets set status='done' where id=${f.a.id}`;
    await assert.rejects(
      () =>
        f.mutation('after-step-done', (tx) =>
          f.services.createTicket(tx, inputTicket(f.project.id, 'task', f.a.id), owner),
        ),
      { code: 'TICKET_CLOSED' },
    );
  }));

test('concurrent request completion and child creation cannot leave done root with pending child', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    await db`update tickets set status='running' where id=${f.request.id}`;
    await db`update tickets set status='done' where id in (${f.a.id},${f.b.id})`;
    await db`insert into evidence(id,ticket_id,kind,data) values
      (${randomUUID()},${f.request.id},'research_result',${db.json({ verification: 'verified' })})`;
    const services = createTicketServices({
      execution: {
        verifySignal: async () => {},
        verifyRepairResult: async () => {},
        requestTerminalIntent: async () => {},
      },
    });
    const results = await Promise.allSettled([
      db.begin((tx) => services.applyExecutionSignal(tx, f.request.id, 'passed', 1, null, owner)),
      db.begin((tx) => services.createTicket(tx, inputTicket(f.project.id, 'step', f.request.id), owner)),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const [root] = await db`select status from tickets where id=${f.request.id}`;
    const [pending] =
      await db`select count(*)::integer as n from tickets where parent_id=${f.request.id} and status<>'done'`;
    assert.equal(root?.status === 'done' && Number(pending?.n) > 0, false);
  }));

test('dependency graph rejects adding edge once target is ready or running', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    const ready = await f.mutation('make-ready', (tx) =>
      f.services.signalTicket(tx, f.a.id, 'dependencies_ready', 1, null, owner),
    );
    assert.equal(ready.status, 'ready');
    await assert.rejects(
      () => f.mutation('edge-ready', (tx) => f.services.addDependency(tx, f.a.id, f.b.id, 2)),
      { code: 'DEPENDENCY_EDIT_NOT_ALLOWED' },
    );
    await db`update tickets set status='running' where id=${f.a.id}`;
    await assert.rejects(
      () => f.mutation('edge-running', (tx) => f.services.addDependency(tx, f.a.id, f.b.id, 2)),
      { code: 'DEPENDENCY_EDIT_NOT_ALLOWED' },
    );
    assert.equal((await db`select count(*)::integer as n from dependencies`)[0]?.n, 0);
  }));
