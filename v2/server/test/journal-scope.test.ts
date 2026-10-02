import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { type EventScopeReader, readEvents } from '../src/journal/events.ts';
import { mutate } from '../src/journal/mutation.ts';
import type { Actor } from '../src/platform/contracts.ts';
import { bindProject, projectEventScope } from '../src/projects/service.ts';
import { databaseFixture } from './support/db.ts';

const withDatabase = databaseFixture(3);

test('máy cũ không nhận event commit sau khi scope đã đọc nhưng binding đổi', async () =>
  withDatabase(async (db) => {
    const machineA = randomUUID();
    const machineB = randomUUID();
    const projectId = randomUUID();
    await db`insert into machines (id, name, token_hash) values (${machineA}, 'A', ${'a'.repeat(64)}), (${machineB}, 'B', ${'b'.repeat(64)})`;
    await db`insert into projects (id, key, name, machine_id, checkout_path, binding_revision) values (${projectId}, 'SCOPE', 'Scope', ${machineA}, '/tmp/old', 2)`;

    let scopeObserved: (() => void) | undefined;
    let releaseRead: (() => void) | undefined;
    const observed = new Promise<void>((resolve) => (scopeObserved = resolve));
    const gate = new Promise<void>((resolve) => (releaseRead = resolve));
    const pausedScope: EventScopeReader = async (queryDb, actor) => {
      const access = await projectEventScope(queryDb, actor);
      scopeObserved?.();
      await gate;
      return access;
    };
    const actorA: Actor = { kind: 'machine', id: machineA };
    const actorB: Actor = { kind: 'machine', id: machineB };
    const pendingRead = readEvents(db, actorA, '0', 50, pausedScope);
    await observed;
    try {
      await mutate(
        db,
        {
          actor: { kind: 'owner', id: 'owner' },
          route: `PUT:/v2/projects/${projectId}/binding`,
          key: 'rebind',
          body: { machineId: machineB },
        },
        async (tx) => {
          await bindProject(
            tx,
            projectId,
            { machineId: machineB, checkoutPath: '/tmp/new', expectedRevision: 2 },
            async () => {},
          );
          return { status: 200, body: {} };
        },
      );
    } finally {
      releaseRead?.();
    }

    assert.deepEqual(
      (await pendingRead).map((event) => event.cursor),
      [],
    );
    assert.deepEqual(
      (await readEvents(db, actorA, '0', 50, projectEventScope)).map((event) => event.cursor),
      [],
    );
    assert.deepEqual(
      (await readEvents(db, actorB, '0', 50, projectEventScope)).map((event) => event.cursor),
      ['1'],
    );
  }));
