import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { createMutator } from '../src/journal/mutation.ts';
import { registerTicketRoutes } from '../src/tickets/routes.ts';
import { databaseFixture } from './support/db.ts';
import { inputTicket, owner, ticketFixture } from './support/tickets.ts';

test('hierarchy schema stores a request root and rejects self dependency', async () =>
  databaseFixture(4)(async (db) => {
    const [tables] =
      await db`select count(*)::integer as n from information_schema.tables where table_schema='public' and table_name in ('tickets','dependencies','comments','decisions','evidence','repair_results','repair_links','ticket_docs')`;
    assert.equal(tables?.n, 8);
  }));

test('machine cannot record an owner answer to unlock a repair limit', async () =>
  databaseFixture(4)(async (db) => {
    const f = await ticketFixture(db);
    const machineId = crypto.randomUUID();
    await db`insert into machines(id,name,token_hash) values(${machineId},'Mac',${'a'.repeat(64)})`;
    await db`update projects set machine_id=${machineId},checkout_path='/tmp/crew' where id=${f.project.id}`;
    await assert.rejects(
      () =>
        f.mutation('fake-answer', (tx) =>
          f.services.recordDecision(
            tx,
            f.a.id,
            {
              kind: 'owner_answer',
              content: 'Tiếp tục',
              rationale: 'Giả mạo',
              sources: [],
              scope: { repairStepId: f.a.id, continueAfterFive: true },
            },
            { kind: 'machine', id: machineId },
          ),
        ),
      { code: 'OWNER_DECISION_REQUIRED' },
    );
    assert.equal((await db`select count(*)::integer as n from decisions`)[0]?.n, 0);
  }));

test('docs links fail closed until a verified snapshot reader is supplied', async () =>
  databaseFixture(4)(async (db) => {
    const f = await ticketFixture(db);
    await assert.rejects(
      () =>
        f.mutation('docs-link', (tx) =>
          f.services.linkDocs(tx, f.request.id, crypto.randomUUID(), ['docs/index.md'], 1, owner),
        ),
      { code: 'DOCS_SOURCE_UNVERIFIED' },
    );
    assert.equal((await db`select count(*)::integer as n from ticket_docs`)[0]?.n, 0);
  }));

test('ticket criteria rejects inherited-key payloads before persistence', async () =>
  databaseFixture(4)(async (db) => {
    const f = await ticketFixture(db);
    await assert.rejects(
      () =>
        f.mutation('unsafe-criteria', (tx) =>
          f.services.createTicket(
            tx,
            inputTicket(f.project.id, 'step', f.request.id, {
              criteria: { nested: { constructor: { prototype: { admin: true } } } },
            }),
            owner,
          ),
        ),
      { code: 'VALIDATION' },
    );
  }));

test('comment during running is durable timeline data without changing execution status', async () =>
  databaseFixture(4)(async (db) => {
    const f = await ticketFixture(db);
    await db`update tickets set status='running' where id=${f.a.id}`;
    const comment = await f.mutation('running-comment', (tx) =>
      f.services.appendComment(tx, f.a.id, 'Thông tin mới', owner),
    );
    assert.equal(comment.text, 'Thông tin mới');
    assert.equal((await f.read(f.a.id)).status, 'running');
    const [event] =
      await db`select type,data from events where type='comment.created' and ticket_id=${f.a.id}`;
    assert.equal(event?.data.commentId, comment.id);
    assert.equal(Object.keys(event?.data ?? {}).length, 1);
  }));

test('ticket route rejects unknown JSON fields before mutation', async () =>
  databaseFixture(4)(async (db) => {
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    registerTicketRoutes(
      app,
      {
        db,
        publicOrigin: 'http://localhost',
        secureCookies: false,
        sessionEncryptionKey: Buffer.alloc(32),
        now: () => new Date(),
        authorizeDispatch: async () => {},
        verifyFinalResult: async () => {},
      },
      {
        mutator: createMutator(db),
        auth: {
          authenticate: async () => ({ kind: 'owner', id: 'owner' }),
          requireOwner: async () => ({ kind: 'owner', id: 'owner' }),
        },
      },
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v2/tickets',
        headers: { 'idempotency-key': 'bad-field' },
        payload: { unknown: true },
      });
      assert.equal(response.statusCode, 400);
      assert.equal((await db`select count(*)::integer as n from tickets`)[0]?.n, 0);
    } finally {
      await app.close();
    }
  }));
