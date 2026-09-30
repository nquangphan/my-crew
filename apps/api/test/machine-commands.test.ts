import { MACHINE_COMMAND_TTL_MS, type MachineCommand } from '@crew/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type PairedMachine, pairTestMachine, writeHeaders } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import { eventsOf, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance;
let owner: LoggedInOwner;
let a: PairedMachine;
let b: PairedMachine;

beforeEach(async () => {
  app = await makeApp(ctx.db);
  owner = await seedAndLogin(app, ctx.db);
  a = await pairTestMachine(ctx.db, 'mac-a');
  b = await pairTestMachine(ctx.db, 'mac-b');
});
afterEach(() => app.close());

const ask = (machine: PairedMachine, body: object) =>
  app.inject({
    method: 'POST',
    url: `/v1/machines/${machine.machineId}/commands`,
    headers: owner.headers,
    payload: body,
  });
const start = (machine: PairedMachine, id: string, key?: string) =>
  app.inject({ method: 'POST', url: `/v1/daemon/commands/${id}/start`, headers: writeHeaders(machine, key) });
const finish = (machine: PairedMachine, id: string, body: object) =>
  app.inject({
    method: 'POST',
    url: `/v1/daemon/commands/${id}/result`,
    headers: writeHeaders(machine),
    payload: body,
  });

describe('machine commands', () => {
  it('accepts only whitelisted actions with valid parameters', async () => {
    for (const body of [
      { action: 'shell', command: 'rm -rf /' },
      { action: 'health.fix', group: 'mcp', fixId: 'Bad Id; rm' },
      { action: 'logs.tail', limit: 10_000 },
      { action: 'pause', extra: true },
      { action: 'bmad.install', projectKey: '../x' },
    ]) {
      expect((await ask(a, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    const ok = await ask(a, { action: 'logs.tail', ticket: 'WEB-3' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({
      action: 'logs.tail',
      params: { limit: 200, ticket: 'WEB-3' },
      status: 'pending',
      requestedBy: 'owner:owner',
    });
  });

  it('sends the command to that machine only, runs it once and stores a result of the right shape', async () => {
    const command: MachineCommand = (await ask(a, { action: 'pause' })).json();
    const sent = await eventsOf(ctx.db, 'machine.command');
    expect(sent.map((event) => event.targetMachineId)).toEqual([null, a.machineId]);

    expect((await start(b, command.id)).statusCode).toBe(404);
    const started = await start(a, command.id, 'command-start-key-1');
    expect(started.json()).toMatchObject({ status: 'running' });
    // A retried start with the same key replays; a new start of a running command returns it as is.
    expect((await start(a, command.id, 'command-start-key-1')).headers['idempotent-replayed']).toBe('true');
    expect((await start(a, command.id)).json()).toMatchObject({ status: 'running' });

    const done = await finish(a, command.id, { ok: true, result: { paused: true } });
    expect(done.json()).toMatchObject({ status: 'done', result: { paused: true } });
    const read = await app.inject({
      method: 'GET',
      url: `/v1/machines/${a.machineId}/commands/${command.id}`,
      headers: owner.headers,
    });
    expect(read.json()).toMatchObject({ status: 'done', finishedAt: expect.any(String) });
    expect((await eventsOf(ctx.db, 'machine.command_updated')).map((event) => event.payload)).toEqual([
      {
        type: 'machine.command_updated',
        data: { commandId: command.id, machineId: a.machineId, status: 'running' },
      },
      {
        type: 'machine.command_updated',
        data: { commandId: command.id, machineId: a.machineId, status: 'done' },
      },
    ]);
  });

  it('stores a failure, and a result of the wrong shape as a failure', async () => {
    const one: MachineCommand = (await ask(a, { action: 'jobs.list' })).json();
    await start(a, one.id);
    expect((await finish(a, one.id, { ok: true, result: { not: 'a list' } })).json()).toMatchObject({
      status: 'failed',
      error: 'Máy trả về kết quả không đúng dạng của thao tác này.',
    });
    const two: MachineCommand = (await ask(a, { action: 'bmad.install', projectKey: 'WEB' })).json();
    await start(a, two.id);
    expect(
      (await finish(a, two.id, { ok: false, error: 'Máy này chưa có thư mục cho WEB.' })).json(),
    ).toMatchObject({ status: 'failed', error: 'Máy này chưa có thư mục cho WEB.' });
  });

  it('expires a command the machine did not take in time', async () => {
    const command: MachineCommand = (await ask(a, { action: 'resume' })).json();
    await ctx.db.execute(
      sql`update machine_commands set created_at = now() - make_interval(secs => ${MACHINE_COMMAND_TTL_MS / 1000 + 5})`,
    );
    const late = await start(a, command.id);
    expect(late.statusCode).toBe(409);
    expect(late.json().error.details).toEqual({ status: 'expired' });
    const list = await app.inject({
      method: 'GET',
      url: `/v1/machines/${a.machineId}/commands`,
      headers: owner.headers,
    });
    expect(list.json().items[0]).toMatchObject({ id: command.id, status: 'expired' });
  });

  it('refuses commands for a revoked machine and keeps owner and daemon routes apart', async () => {
    await app.inject({ method: 'POST', url: `/v1/machines/${b.machineId}/revoke`, headers: owner.headers });
    expect((await ask(b, { action: 'pause' })).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/machines/${a.machineId}/commands`,
          headers: a.auth,
          payload: { action: 'pause' },
        })
      ).statusCode,
    ).toBe(401);
  });
});
