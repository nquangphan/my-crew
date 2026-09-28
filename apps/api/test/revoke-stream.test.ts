import { afterEach, describe, expect, it } from 'vitest';
import {
  emitEvents,
  openSse,
  pairTestMachine,
  type SseClient,
  setTokenExpiry,
  sleep,
  startServer,
  type TestServer,
  within,
} from './helpers/machines.js';
import { seedAndLogin } from './helpers/owner-session.js';
import { useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let server: TestServer | undefined;
const clients: SseClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server?.app.close();
  server = undefined;
});

async function connect(path: string, headers: Record<string, string>) {
  if (!server) throw new Error('server not started');
  const client = await openSse(`${server.url}${path}`, headers);
  clients.push(client);
  return client;
}

describe('revocation and expiry close open streams', () => {
  it('revoking a machine closes its stream at once, and the next event is not delivered', async () => {
    // A long heartbeat, so only the revocation itself can close the stream quickly.
    server = await startServer(ctx.db, { streamHeartbeatMs: 60_000 });
    const owner = await seedAndLogin(server.app, ctx.db);
    const m = await pairTestMachine(ctx.db, 'm1');
    const bystander = await pairTestMachine(ctx.db, 'm2');
    const stream = await connect('/v1/daemon/stream', m.auth);
    const other = await connect('/v1/daemon/stream', bystander.auth);
    await emitEvents(ctx.db, m.machineId, 1);
    await stream.waitFor(1);

    const revoke = await server.app.inject({
      method: 'POST',
      url: `/v1/machines/${m.machineId}/revoke`,
      headers: owner.headers,
    });
    expect(revoke.statusCode).toBe(200);
    await within(stream.closed, 1_000, 'stream close after revoke');

    await emitEvents(ctx.db, m.machineId, 1);
    await sleep(200);
    expect(stream.events).toHaveLength(1);
    expect((await connect('/v1/daemon/stream', m.auth)).status).toBe(401);

    // Other machines' streams are untouched.
    expect(other.isClosed()).toBe(false);
    await emitEvents(ctx.db, bystander.machineId, 1);
    await other.waitFor(1);
  });

  it('a token that expires while its stream is open closes the stream within one heartbeat', async () => {
    server = await startServer(ctx.db, { streamHeartbeatMs: 300 });
    const m = await pairTestMachine(ctx.db, 'm1');
    const stream = await connect('/v1/daemon/stream', m.auth);
    await sleep(400);
    expect(stream.isClosed()).toBe(false);

    await setTokenExpiry(ctx.db, m.token, new Date(Date.now() - 1_000));
    await within(stream.closed, 700, 'stream close after expiry');
    expect((await connect('/v1/daemon/stream', m.auth)).status).toBe(401);
  });

  it('the owner stream closes within one heartbeat after logout', async () => {
    server = await startServer(ctx.db, { streamHeartbeatMs: 300 });
    const owner = await seedAndLogin(server.app, ctx.db);
    const stream = await connect('/v1/stream', { cookie: owner.cookie });
    expect(stream.status).toBe(200);
    const logout = await server.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: owner.headers,
    });
    expect(logout.statusCode).toBe(204);
    await within(stream.closed, 700, 'owner stream close after logout');
  });
});
