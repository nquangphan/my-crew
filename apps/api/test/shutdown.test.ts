import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import { pairTestMachine, sleep, startServer, type TestServer, within } from './helpers/machines.js';
import { seedAndLogin } from './helpers/owner-session.js';
import { TEST_DATABASE_URL } from './helpers/test-database-url.js';
import { useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let server: TestServer | undefined;
const controllers: AbortController[] = [];
const locks: { release: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const lock of locks.splice(0)) await lock.release();
  for (const controller of controllers.splice(0)) controller.abort();
  const app = server?.app;
  server = undefined;
  if (app?.server.listening) app.server.closeAllConnections();
  await app?.close();
});

/**
 * Locks `machine_tokens` from a separate connection, so every machine request waits inside authentication
 * (the machine guard reads that table) until `release()`.
 */
async function holdMachineAuth(): Promise<{ release: () => Promise<void> }> {
  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const isLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const transaction = client.begin(async (tx) => {
    await tx`lock table machine_tokens in access exclusive mode`;
    locked();
    await released;
  });
  await Promise.race([isLocked, transaction]);
  let done = false;
  const lock = {
    release: async () => {
      if (done) return;
      done = true;
      release();
      await transaction;
      await client.end({ timeout: 5 });
    },
  };
  locks.push(lock);
  return lock;
}

async function until(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/** A machine request is parked in authentication behind the lock. */
async function authBlocked(): Promise<void> {
  await until(async () => {
    const rows = await ctx.db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_locks where not granted and relation = 'machine_tokens'::regclass`,
    );
    return (rows[0]?.n ?? 0) > 0;
  }, 'a request waiting in authentication');
}

function request(path: string, headers: Record<string, string>): Promise<Response> {
  if (!server) throw new Error('server not started');
  const controller = new AbortController();
  controllers.push(controller);
  return fetch(`${server.url}${path}`, { headers, signal: controller.signal });
}

/**
 * Starts `app.close()` and returns once the listening socket is closed, which happens after `preClose`.
 * The close promise is wrapped, since returning it bare from an async function would wait for it.
 */
async function beginClose(s: TestServer): Promise<{ closed: Promise<undefined> }> {
  const closed = s.app.close();
  await until(() => !s.app.server.listening, 'the server to stop listening');
  return { closed };
}

async function openConnections(s: TestServer): Promise<number> {
  return new Promise((resolve, reject) =>
    s.app.server.getConnections((error, count) => (error ? reject(error) : resolve(count))),
  );
}

describe('closing the server', () => {
  it('ends a stream still authenticating when close began, and close does not wait for it', async () => {
    // A long drain, so only ending the stream itself lets close finish quickly.
    server = await startServer(ctx.db, {}, { closeDrainMs: 60_000 });
    const s = server;
    const m = await pairTestMachine(ctx.db, 'm1');
    const lock = await holdMachineAuth();
    const pending = request('/v1/daemon/stream', m.auth);
    await authBlocked();

    const { closed } = await beginClose(s);
    await lock.release();

    const response = await within(pending, 2_000, 'stream response');
    expect(response.status).toBe(200);
    // Only the reconnect hint, then the end of the stream: no event is ever delivered.
    expect(await within(response.text(), 2_000, 'stream end')).toBe('retry: 3000\n\n');
    await within(closed, 2_000, 'server close');
    server = undefined;
  });

  it('a client that disconnects while its stream authenticates leaves no subscriber behind', async () => {
    server = await startServer(ctx.db, { streamHeartbeatMs: 60_000 });
    const s = server;
    const owner = await seedAndLogin(s.app, ctx.db);
    const m = await pairTestMachine(ctx.db, 'm1');
    const lock = await holdMachineAuth();
    const controller = new AbortController();
    const pending = fetch(`${s.url}/v1/daemon/stream`, { headers: m.auth, signal: controller.signal });
    await authBlocked();

    controller.abort();
    await expect(pending).rejects.toThrow();
    await until(async () => (await openConnections(s)) === 0, 'the server to see the disconnect');
    await lock.release();

    // Authentication finishes (it stamps the token as seen), then the route runs straight away.
    await until(async () => {
      const rows = await ctx.db.execute<{ seen: boolean }>(
        sql`select last_seen_at is not null as seen from machine_tokens`,
      );
      return rows[0]?.seen === true;
    }, 'authentication to finish');
    const connected = async () => {
      const list = await s.app.inject({ method: 'GET', url: '/v1/machines', headers: owner.headers });
      const items = (list.json() as { items: { id: string; streamConnected: boolean }[] }).items;
      return items.find((item) => item.id === m.machineId)?.streamConnected;
    };
    for (let i = 0; i < 10; i++) {
      expect(await connected()).toBe(false);
      await sleep(30);
    }
  });

  it('a request answered after close began closes its connection, so close does not wait for keep-alive', async () => {
    server = await startServer(ctx.db, {}, { closeDrainMs: 60_000 });
    const s = server;
    const m = await pairTestMachine(ctx.db, 'm1');
    const lock = await holdMachineAuth();
    const pending = request('/v1/daemon/projects', m.auth);
    await authBlocked();

    const { closed } = await beginClose(s);
    await lock.release();

    const response = await within(pending, 2_000, 'response');
    expect(response.status).toBe(200);
    expect(response.headers.get('connection')).toBe('close');
    await response.arrayBuffer();
    await within(closed, 2_000, 'server close');
    server = undefined;
  });

  it('cuts a request still stuck when the drain window ends', async () => {
    server = await startServer(ctx.db, {}, { closeDrainMs: 200 });
    const s = server;
    const m = await pairTestMachine(ctx.db, 'm1');
    await holdMachineAuth();
    const pending = request('/v1/daemon/projects', m.auth).then(
      (response) => response.status,
      () => 'connection closed',
    );
    await authBlocked();

    await within(s.app.close(), 2_000, 'server close');
    server = undefined;
    expect(await pending).toBe('connection closed');
  });
});
