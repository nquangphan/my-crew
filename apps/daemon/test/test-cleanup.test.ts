import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';
import { startServer } from '../../api/test/helpers/machines.js';
import { closeServer, fixture, useApi } from './helpers/api.js';
import { makeDaemon, waitFor } from './helpers/daemon.js';
import { onCleanup } from './helpers/git.js';

const api = useApi();

/** What the first test's cleanup did, checked by the second (tests in a file run in order). */
const cleanupLog: string[] = [];
let cleanupMs = 0;

async function streamConnected(f: Awaited<ReturnType<typeof fixture>>): Promise<boolean> {
  const response = await f.server.app.inject({
    method: 'GET',
    url: '/v1/machines',
    headers: f.owner.headers,
  });
  const items = (response.json() as { items: { id: string; streamConnected: boolean }[] }).items;
  return items.some((item) => item.id === f.machine.machineId && item.streamConnected);
}

describe('test cleanup', () => {
  it('leaves a connected daemon running for the cleanup to stop', async () => {
    const f = await fixture(api);
    const { daemon } = makeDaemon(f, { repoPath: null });
    await daemon.start();
    await waitFor(() => streamConnected(f), 10_000, 'the daemon stream');

    const halt = daemon.halt.bind(daemon);
    daemon.halt = async () => {
      cleanupLog.push('daemon halted');
      await halt();
    };
    const close = f.server.app.close.bind(f.server.app);
    f.server.app.close = (async () => {
      const started = Date.now();
      cleanupLog.push('server closing');
      await close();
      cleanupMs = Date.now() - started;
    }) as typeof f.server.app.close;
  });

  it('stopped that daemon before closing the server, so the close was immediate', () => {
    expect(cleanupLog).toEqual(['daemon halted', 'server closing']);
    // Well inside the server's own drain window, so nothing had to be cut. (A connection the daemon opened
    // but never used can linger until the client's 4 s keep-alive timeout drops it.)
    expect(cleanupMs).toBeLessThan(5_000);
  });

  it('a client still attached makes closing the server fail with a clear error, not hang', async () => {
    const server = await startServer(api.db);
    const { port } = new URL(server.url);
    // A request whose headers never finish: the server can neither answer it nor treat the socket as idle.
    const socket = connect(Number(port), '127.0.0.1');
    onCleanup(() => {
      socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.on('error', () => {});
    socket.write('GET /v1/health HTTP/1.1\r\nhost: 127.0.0.1\r\n');
    await waitFor(
      () =>
        new Promise<boolean>((resolve) =>
          server.app.server.getConnections((_error, count) => resolve(count > 0)),
        ),
      5_000,
      'the server to accept the connection',
    );

    const started = Date.now();
    await expect(closeServer(server)).rejects.toThrow(/never stopped/);
    expect(Date.now() - started).toBeLessThan(8_000);
  });
});
