import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { tickets } from '../src/db/schema.js';
import { ApiError } from '../src/errors.js';
import { replyIdempotent, withIdempotency } from '../src/services/idempotency.js';
import { updateProject } from '../src/services/project-service.js';
import { createSubtask } from '../src/services/ticket-service.js';
import { createMachine, createTree, getTicket, RATED, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();

describe('idempotency', () => {
  it('runs a daemon write once and replays the stored response on retry', async () => {
    const { pmTask } = await createTree(ctx.db);
    const machineId = await createMachine(ctx.db, 'daemon');
    let runs = 0;
    const handler = async (tx: Parameters<Parameters<typeof withIdempotency>[2]>[0]) => {
      runs++;
      const dev = await createSubtask(tx, {
        type: 'dev',
        ...RATED,
        parentId: pmTask.id,
        title: 'Idempotent',
      });
      return { statusCode: 201, body: dev };
    };
    const args = { machineId, key: 'job-1:call-1', fingerprint: 'POST /v1/daemon/tickets abc' };

    const [a, b] = await Promise.all([
      withIdempotency(ctx.db, args, handler),
      withIdempotency(ctx.db, args, handler),
    ]);
    const c = await withIdempotency(ctx.db, args, handler);

    expect(runs).toBe(1);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(c).toMatchObject({ replayed: true, statusCode: 201 });
    expect(c.body).toEqual(a.body);
    expect(await ctx.db.$count(tickets, eq(tickets.parentId, pmTask.id))).toBe(1);

    await expect(
      withIdempotency(ctx.db, { ...args, fingerprint: 'POST /v1/daemon/comments xyz' }, handler),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('stores refusals that committed side effects and does not store plain failures', async () => {
    const { pmTask, project } = await createTree(ctx.db);
    await updateProject(ctx.db, project.id, { maxChildrenPerTicket: 1 });
    await createSubtask(ctx.db, { type: 'dev', ...RATED, parentId: pmTask.id, title: 'Một' });
    const machineId = await createMachine(ctx.db, 'daemon');
    const args = { machineId, key: 'job-2:call-1', fingerprint: 'POST /v1/daemon/tickets' };
    const handler = async (tx: Parameters<Parameters<typeof withIdempotency>[2]>[0]) => ({
      statusCode: 201,
      body: await createSubtask(tx, { type: 'dev', ...RATED, parentId: pmTask.id, title: 'Hai' }),
    });

    const first = await withIdempotency(ctx.db, args, handler);
    expect(first).toMatchObject({ statusCode: 409, replayed: false });
    expect((first.body as { error: { code: string } }).error.code).toBe('CHILD_CAP_EXCEEDED');
    expect((await getTicket(ctx.db, pmTask.id)).status).toBe('needs_input');
    expect(await withIdempotency(ctx.db, args, handler)).toMatchObject({ statusCode: 409, replayed: true });

    let calls = 0;
    const failing = async () => {
      calls++;
      throw new ApiError('VALIDATION_FAILED', 'bad');
    };
    const other = { ...args, key: 'job-2:call-2' };
    await expect(withIdempotency(ctx.db, other, failing)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(withIdempotency(ctx.db, other, failing)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(calls).toBe(2);
  });
});

describe('replyIdempotent', () => {
  it('requires the header and replays the stored status and body', async () => {
    const machineId = await createMachine(ctx.db, 'daemon');
    const app = Fastify();
    let runs = 0;
    app.setErrorHandler((error, _request, reply) =>
      error instanceof ApiError ? reply.status(error.statusCode).send(error.toBody()) : reply.send(error),
    );
    app.post('/v1/daemon/echo', (request, reply) =>
      replyIdempotent(ctx.db, request, reply, machineId, async () => ({
        statusCode: 201,
        body: { runs: ++runs },
      })),
    );
    try {
      const missing = await app.inject({ method: 'POST', url: '/v1/daemon/echo', payload: { a: 1 } });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

      const headers = { 'idempotency-key': 'job-9:call-1' };
      const first = await app.inject({ method: 'POST', url: '/v1/daemon/echo', headers, payload: { a: 1 } });
      const retry = await app.inject({ method: 'POST', url: '/v1/daemon/echo', headers, payload: { a: 1 } });
      expect(first.statusCode).toBe(201);
      expect(retry.statusCode).toBe(201);
      expect(retry.json()).toEqual({ runs: 1 });
      expect(retry.headers['idempotent-replayed']).toBe('true');

      const changed = await app.inject({
        method: 'POST',
        url: '/v1/daemon/echo',
        headers,
        payload: { a: 2 },
      });
      expect(changed.statusCode).toBe(422);
    } finally {
      await app.close();
    }
  });
});
