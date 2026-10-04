import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { appendEvent } from '../src/journal/events.ts';
import { createMutator } from '../src/journal/mutation.ts';
import { registerEventRoutes } from '../src/journal/routes.ts';
import type { Actor, Db } from '../src/platform/contracts.ts';
import { registerTicketRoutes } from '../src/tickets/routes.ts';
import { databaseFixture } from './support/db.ts';
import { inputTicket, owner, ticketFixture } from './support/tickets.ts';

const withDatabase = databaseFixture(4);

async function appFor(db: Db, actorOf: (header: string | undefined) => Actor) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  const options = {
    db,
    publicOrigin: 'http://localhost',
    secureCookies: false,
    sessionEncryptionKey: Buffer.alloc(32),
    now: () => new Date(),
    authorizeDispatch: async () => {},
    verifyFinalResult: async () => {},
  };
  const deps = {
    mutator: createMutator(db),
    auth: {
      authenticate: async (request: { headers: Record<string, unknown> }) =>
        actorOf(request.headers['x-actor'] as string | undefined),
      requireOwner: async () => owner,
    },
  };
  registerTicketRoutes(app, options, deps as never);
  registerEventRoutes(app, options, deps as never, async () => ({ projectIds: [], allowGlobal: true }));
  return app;
}
const asOwner = () => owner;

test('GET /v2/tickets?level=request chỉ trả request root và phân trang ổn định theo id', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    const extra = await f.mutation('request-2', (tx) =>
      f.services.createTicket(tx, inputTicket(f.project.id, 'request'), owner),
    );
    const third = await f.mutation('request-3', (tx) =>
      f.services.createTicket(tx, inputTicket(f.project.id, 'request'), owner),
    );
    const app = await appFor(db, asOwner);
    try {
      const expected = [f.request.id, extra.id, third.id].sort();
      const first = await app.inject({ method: 'GET', url: '/v2/tickets?level=request&limit=2' });
      assert.equal(first.statusCode, 200);
      const firstBody = first.json();
      assert.deepEqual(
        firstBody.items.map((item: { id: string }) => item.id),
        expected.slice(0, 2),
      );
      assert.equal(firstBody.nextCursor, expected[1]);
      const second = await app.inject({
        method: 'GET',
        url: `/v2/tickets?level=request&limit=2&cursor=${firstBody.nextCursor}`,
      });
      const secondBody = second.json();
      assert.deepEqual(
        secondBody.items.map((item: { id: string }) => item.id),
        [expected[2]],
      );
      assert.equal(secondBody.nextCursor, null);
      const steps = await app.inject({ method: 'GET', url: '/v2/tickets?level=step' });
      assert.deepEqual(
        steps
          .json()
          .items.map((item: { id: string }) => item.id)
          .sort(),
        [f.a.id, f.b.id].sort(),
      );
      const bad = await app.inject({ method: 'GET', url: '/v2/tickets?level=epic' });
      assert.equal(bad.statusCode, 400);
    } finally {
      await app.close();
    }
  }));

test('GET /v2/tickets/:id/history trả timeline theo cursor, không lộ nội dung comment/decision', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    const comment = await f.mutation('c1', (tx) =>
      f.services.appendComment(tx, f.a.id, 'BÍ MẬT-comment', owner),
    );
    const decisionId = await f.mutation('d1', (tx) =>
      f.services.recordDecision(
        tx,
        f.a.id,
        { kind: 'assessment', content: 'BÍ MẬT-content', rationale: 'BÍ MẬT-why', sources: [], scope: {} },
        owner,
      ),
    );
    await f.mutation('other', (tx) => f.services.appendComment(tx, f.b.id, 'ticket khác', owner));
    const app = await appFor(db, asOwner);
    try {
      const all = await app.inject({ method: 'GET', url: `/v2/tickets/${f.a.id}/history` });
      assert.equal(all.statusCode, 200);
      const body = all.json();
      assert.equal(body.nextCursor, null);
      const types = body.items.map((item: { type: string }) => item.type);
      assert.deepEqual(types.slice(0, 1), ['ticket.created']);
      assert.ok(types.includes('comment.created') && types.includes('decision.created'));
      const cursors = body.items.map((item: { cursor: string }) => BigInt(item.cursor));
      assert.deepEqual(
        [...cursors].sort((x, y) => (x < y ? -1 : 1)),
        cursors,
      );
      assert.ok(body.items.every((item: { cursor: unknown }) => typeof item.cursor === 'string'));
      const commentItem = body.items.find((item: { type: string }) => item.type === 'comment.created');
      assert.deepEqual(commentItem.actor, { kind: 'owner', id: 'owner' });
      assert.equal(commentItem.data.commentId, comment.id);
      const decisionItem = body.items.find((item: { type: string }) => item.type === 'decision.created');
      assert.equal(decisionItem.data.decisionId, decisionId);
      assert.ok(!all.body.includes('BÍ MẬT'), 'không được lộ nội dung comment/decision');
      assert.ok(!all.body.includes('ticket khác'));

      const page1 = (
        await app.inject({ method: 'GET', url: `/v2/tickets/${f.a.id}/history?limit=2` })
      ).json();
      assert.equal(page1.items.length, 2);
      assert.equal(page1.nextCursor, page1.items[1].cursor);
      const page2 = (
        await app.inject({
          method: 'GET',
          url: `/v2/tickets/${f.a.id}/history?limit=2&cursor=${page1.nextCursor}`,
        })
      ).json();
      assert.deepEqual(
        [...page1.items, ...page2.items]
          .map((item: { cursor: string }) => item.cursor)
          .slice(0, body.items.length),
        body.items
          .map((item: { cursor: string }) => item.cursor)
          .slice(0, page1.items.length + page2.items.length),
      );
      for (const url of [
        'cursor=-1',
        'cursor=abc',
        'cursor=9223372036854775808',
        'limit=0',
        'limit=101',
        'x=1',
      ])
        assert.equal(
          (await app.inject({ method: 'GET', url: `/v2/tickets/${f.a.id}/history?${url}` })).statusCode,
          400,
          url,
        );
      assert.equal(
        (await app.inject({ method: 'GET', url: `/v2/tickets/${randomUUID()}/history` })).statusCode,
        404,
      );
    } finally {
      await app.close();
    }
  }));

test('history áp dụng ACL của ticket và audience của event cho machine', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    const machineId = randomUUID();
    const otherId = randomUUID();
    for (const id of [machineId, otherId])
      await db`insert into machines(id,name,token_hash) values(${id},'Mac',${randomUUID().replaceAll('-', '').padEnd(64, '0')})`;
    await db`update projects set machine_id=${machineId},checkout_path='/tmp/crew' where id=${f.project.id}`;
    await f.mutation('targeted', (tx) =>
      appendEvent(tx, {
        type: 'ticket.changed',
        projectId: f.project.id,
        ticketId: f.a.id,
        audienceMachineId: otherId,
        data: { revision: 9 },
      }),
    );
    const app = await appFor(db, (header) =>
      header === 'bound'
        ? { kind: 'machine', id: machineId }
        : header === 'other'
          ? { kind: 'machine', id: otherId }
          : owner,
    );
    try {
      const bound = await app.inject({
        method: 'GET',
        url: `/v2/tickets/${f.a.id}/history`,
        headers: { 'x-actor': 'bound' },
      });
      assert.equal(bound.statusCode, 200);
      assert.ok(
        !bound.json().items.some((item: { data: { revision?: number } }) => item.data.revision === 9),
      );
      const ownerView = await app.inject({ method: 'GET', url: `/v2/tickets/${f.a.id}/history` });
      assert.ok(
        ownerView.json().items.some((item: { data: { revision?: number } }) => item.data.revision === 9),
      );
      for (const path of ['history', 'docs-links']) {
        const denied = await app.inject({
          method: 'GET',
          url: `/v2/tickets/${f.a.id}/${path}`,
          headers: { 'x-actor': 'other' },
        });
        assert.ok([403, 404].includes(denied.statusCode), `${path} ${denied.statusCode}`);
      }
    } finally {
      await app.close();
    }
  }));

test('GET /v2/tickets/:id/docs-links phân trang >20 theo keyset và không trùng/mất mục', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    const snapshots = [randomUUID(), randomUUID()];
    const expected: { snapshotId: string; path: string }[] = [];
    for (const snapshotId of snapshots)
      for (let index = 0; index < 13; index++) {
        const path = `docs/${index % 2 ? 'b' : 'a'}/trang-${String(index).padStart(2, '0')}.md`;
        await db`insert into ticket_docs(ticket_id,snapshot_id,path) values(${f.request.id},${snapshotId},${path})`;
        expected.push({ snapshotId, path });
      }
    await db`insert into ticket_docs(ticket_id,snapshot_id,path) values(${f.a.id},${snapshots[0]},'khac.md')`;
    expected.sort((x, y) =>
      x.snapshotId === y.snapshotId ? (x.path < y.path ? -1 : 1) : x.snapshotId < y.snapshotId ? -1 : 1,
    );
    const app = await appFor(db, asOwner);
    try {
      const seen: { snapshotId: string; path: string }[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const url: string = `/v2/tickets/${f.request.id}/docs-links${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
        const response = await app.inject({ method: 'GET', url });
        assert.equal(response.statusCode, 200);
        const body: { items: typeof seen; nextCursor: string | null } = response.json();
        assert.ok(body.items.length <= 20);
        seen.push(...body.items);
        cursor = body.nextCursor;
        pages++;
      } while (cursor);
      assert.equal(pages, 2);
      assert.deepEqual(seen, expected);
      const small = await app.inject({ method: 'GET', url: `/v2/tickets/${f.a.id}/docs-links` });
      assert.deepEqual(small.json(), {
        items: [{ snapshotId: snapshots[0], path: 'khac.md' }],
        nextCursor: null,
      });
      const empty = await app.inject({ method: 'GET', url: `/v2/tickets/${f.b.id}/docs-links` });
      assert.deepEqual(empty.json(), { items: [], nextCursor: null });
      for (const query of ['cursor=!!', 'cursor=e30', 'limit=0', 'limit=101'])
        assert.equal(
          (await app.inject({ method: 'GET', url: `/v2/tickets/${f.a.id}/docs-links?${query}` })).statusCode,
          400,
          query,
        );
    } finally {
      await app.close();
    }
  }));

test('GET /v2/events/latest trả cursor lớn nhất dạng chuỗi, an toàn với BigInt', async () =>
  withDatabase(async (db) => {
    const app = await appFor(db, asOwner);
    try {
      const empty = await app.inject({ method: 'GET', url: '/v2/events/latest' });
      assert.equal(empty.statusCode, 200);
      assert.deepEqual(empty.json(), { cursor: '0' });
      await db`update event_cursor set value = 9007199254740993 where singleton = true`;
      const big = await app.inject({ method: 'GET', url: '/v2/events/latest' });
      assert.equal(big.json().cursor, '9007199254740993');
      assert.match(big.body, /"cursor":"9007199254740993"/);
      assert.equal((await app.inject({ method: 'GET', url: '/v2/events/latest?after=1' })).statusCode, 400);
    } finally {
      await app.close();
    }
  }));
