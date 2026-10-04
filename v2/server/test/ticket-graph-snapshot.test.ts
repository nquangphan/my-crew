import assert from 'node:assert/strict';
import test from 'node:test';
import type { Db, Id, Tx } from '../src/platform/contracts.ts';
import { readGraph } from '../src/tickets/dependencies.ts';
import { databaseFixture } from './support/db.ts';
import { inputTicket, owner, ticketFixture } from './support/tickets.ts';

const withDatabase = databaseFixture(4);

// Wraps db.begin so that `afterQuery` runs once, right after the first query whose text matches
// `needle` has returned inside the transaction. The hook uses a different connection (the real db).
function interleaved(db: Db, needle: string, afterQuery: () => Promise<void>): Db {
  let fired = false;
  const wrapTx = (tx: Tx): Tx =>
    new Proxy(tx, {
      async apply(target, thisArg, args) {
        const result = await Reflect.apply(target, thisArg, args);
        const strings = args[0] as readonly string[] | undefined;
        if (!fired && Array.isArray(strings) && strings.join('?').includes(needle)) {
          fired = true;
          await afterQuery();
        }
        return result;
      },
    });
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== 'begin') return Reflect.get(target, prop, target);
      return (...args: unknown[]) => {
        const work = args.pop() as (tx: Tx) => Promise<unknown>;
        return (target.begin as (...a: unknown[]) => Promise<unknown>)(...args, (tx: Tx) => work(wrapTx(tx)));
      };
    },
  });
}

test('graph read is one snapshot even when a write commits between its queries', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    let added: Id | null = null;
    // Coupled to how readGraph spells its nodes query: if that SQL changes the hook never fires and
    // assert.ok(added) fails loudly.
    const hooked = interleaved(db, 'where root_id=', async () => {
      const step = await f.mutation('late-step', (tx) =>
        f.services.createTicket(tx, inputTicket(f.project.id, 'step', f.request.id), owner),
      );
      await f.mutation('late-edge', (tx) => f.services.addDependency(tx, step.id, f.a.id, 1));
      added = step.id;
    });
    const graph = await readGraph(hooked, f.request.id, owner);
    assert.ok(added, 'the interleaved write must have committed');
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.dependencies) {
      assert.ok(ids.has(edge.ticketId) && ids.has(edge.predecessorId), 'edge endpoints must be nodes');
    }
    assert.equal(ids.has(added), false, 'snapshot predates the interleaved write');
    assert.equal(graph.dependencies.length, 0);
    const after = await readGraph(db, f.request.id, owner);
    assert.equal(after.nodes.length, graph.nodes.length + 1);
    assert.equal(after.dependencies.length, 1);
  }));
