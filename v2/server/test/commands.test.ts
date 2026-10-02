import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import {
  ackCommand,
  authorizeCommandMutation,
  createCommand,
  listCommands,
  readCommand,
} from '../src/execution/commands.ts';
import { registerExecutionRoutes } from '../src/execution/routes.ts';
import { createMutator } from '../src/journal/mutation.ts';
import { ApiError } from '../src/platform/errors.ts';
import { databaseFixture } from './support/db.ts';
import { executionFixture } from './support/execution.ts';

const withDatabase = databaseFixture(5);

test('completed page anchor works and polling from null sees new commands', async () =>
  withDatabase(async (db) => {
    const x = await executionFixture(db);
    const create = () =>
      db.begin((tx) =>
        createCommand(
          tx,
          { machineId: x.actor.id, ticketId: x.f.a.id, type: 'reconcile', payload: {} },
          { kind: 'owner', id: 'owner' },
        ),
      );
    const second = await create();
    const first = await listCommands(db, x.actor, null, 1);
    assert.equal(first.items.length, 1);
    assert.equal(first.nextCursor, x.command.id);
    await db.begin((tx) =>
      ackCommand(tx, x.command.id, { phase: 'completed', result: { ok: true } }, x.actor),
    );
    const after = await listCommands(db, x.actor, x.command.id, 1);
    assert.equal(after.items[0]?.id, second.id);
    const third = await create();
    assert((await listCommands(db, x.actor, null, 10)).items.some((item) => item.id === third.id));
    await assert.rejects(() => listCommands(db, x.actor, '00000000-0000-4000-8000-000000000000', 10), {
      code: 'NOT_FOUND',
    });
  }));

test('same machine after new binding cannot read or ack old command', async () =>
  withDatabase(async (db) => {
    const x = await executionFixture(db);
    await db`update projects set checkout_path='/tmp/other',binding_revision=3 where id=${x.f.project.id}`;
    await assert.rejects(() => readCommand(db, x.command.id, x.actor), { code: 'NOT_FOUND' });
    await assert.rejects(
      () => db.begin((tx) => ackCommand(tx, x.command.id, { phase: 'received' }, x.actor)),
      { code: 'NOT_FOUND' },
    );
    assert.equal((await listCommands(db, x.actor, null, 10)).items.length, 0);
    await assert.rejects(() => listCommands(db, x.actor, x.command.id, 10), { code: 'NOT_FOUND' });
  }));

test('ack completion is immutable and duplicate result replays canonically', async () =>
  withDatabase(async (db) => {
    const x = await executionFixture(db);
    const first = await db.begin((tx) =>
      ackCommand(tx, x.command.id, { phase: 'completed', result: { a: 1, b: 2 } }, x.actor),
    );
    const again = await db.begin((tx) =>
      ackCommand(tx, x.command.id, { phase: 'completed', result: { b: 2, a: 1 } }, x.actor),
    );
    assert.equal(first.id, again.id);
    await assert.rejects(
      () =>
        db.begin((tx) =>
          ackCommand(tx, x.command.id, { phase: 'completed', result: { a: 2, b: 2 } }, x.actor),
        ),
      { code: 'COMMAND_CONFLICT' },
    );
  }));

test('cached mutation reply is not returned after same machine rebinding', async () =>
  withDatabase(async (db) => {
    const x = await executionFixture(db);
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    app.setErrorHandler((error, _, reply) => {
      const failure = error as ApiError;
      reply.status(failure.status ?? 500).send({ code: failure.code ?? 'INTERNAL' });
    });
    registerExecutionRoutes(
      app,
      {
        db,
        publicOrigin: 'http://example.test',
        secureCookies: false,
        sessionEncryptionKey: Buffer.alloc(32),
        now: () => new Date(),
        authorizeDispatch: async () => {},
        verifyFinalResult: async () => {},
      },
      {
        mutator: createMutator(db),
        auth: {
          authenticate: async () => x.actor,
          requireOwner: async () => {
            throw Error('owner denied');
          },
        },
      },
    );
    const req = {
      method: 'POST' as const,
      url: `/v2/machine/commands/${x.command.id}/ack`,
      headers: { 'idempotency-key': 'same-reply' },
      payload: { phase: 'received' },
    };
    const first = await app.inject(req);
    assert.equal(first.statusCode, 200);
    await db`update projects set checkout_path='/tmp/new',binding_revision=3 where id=${x.f.project.id}`;
    const replay = await app.inject(req);
    assert.equal(replay.statusCode, 404);
    await app.close();
  }));

test('journal authorizes cached replay inside its transaction before returning response', async () =>
  withDatabase(async (db) => {
    const x = await executionFixture(db);
    const mutator = createMutator(db);
    const context = {
      actor: x.actor,
      route: 'test:replay-hook',
      key: 'hook-key',
      body: {},
      authorize: async () => {
        throw new ApiError('CURRENT_BINDING_DENIED', 404, 'Binding denied');
      },
    };
    const first = await mutator({ ...context, authorize: undefined }, async () => ({
      status: 200,
      body: { ok: true },
    }));
    assert.equal(first.body.ok, true);
    await assert.rejects(
      () =>
        mutator(context, async () => {
          throw Error('cached work should not run');
        }),
      { code: 'CURRENT_BINDING_DENIED' },
    );
  }));

test('replay authorization holds project lock until cached response transaction commits', async () =>
  withDatabase(async (db) => {
    const x = await executionFixture(db);
    const mutator = createMutator(db);
    const base = { actor: x.actor, route: 'test:binding-lock', key: 'binding-lock', body: {} };
    await mutator(base, async () => ({ status: 200, body: { ok: true } }));
    let entered!: () => void, release!: () => void;
    const inHook = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const replay = mutator(
      {
        ...base,
        authorize: async (tx) => {
          await authorizeCommandMutation(tx, x.command.id, x.actor);
          entered();
          await resume;
        },
      },
      async () => {
        throw Error('unexpected work');
      },
    );
    await inHook;
    await assert.rejects(
      () => db.begin((tx) => tx`select id from projects where id=${x.f.project.id} for update nowait`),
      { code: '55P03' },
    );
    release();
    assert.deepEqual((await replay).body, { ok: true });
  }));

test('create-command cached reply is scoped to immutable binding revision', async () =>
  withDatabase(async (db) => {
    const x = await executionFixture(db);
    const owner = { kind: 'owner' as const, id: 'owner' as const };
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    app.setErrorHandler((error, _, reply) => {
      const failure = error as ApiError;
      reply.status(failure.status ?? 500).send({ code: failure.code ?? 'INTERNAL' });
    });
    registerExecutionRoutes(
      app,
      {
        db,
        publicOrigin: 'http://example.test',
        secureCookies: false,
        sessionEncryptionKey: Buffer.alloc(32),
        now: () => new Date(),
        authorizeDispatch: async () => {},
        verifyFinalResult: async () => {},
      },
      {
        mutator: createMutator(db),
        auth: { authenticate: async () => owner, requireOwner: async () => owner },
      },
    );
    const req = {
      method: 'POST' as const,
      url: '/v2/commands',
      headers: { 'idempotency-key': 'create-once' },
      payload: { machineId: x.actor.id, ticketId: x.f.a.id, type: 'reconcile', payload: {} },
    };
    const first = await app.inject(req);
    assert.equal(first.statusCode, 202);
    await db`update projects set checkout_path='/tmp/new',binding_revision=3 where id=${x.f.project.id}`;
    const replay = await app.inject(req);
    assert.equal(replay.statusCode, 404);
    await app.close();
  }));
