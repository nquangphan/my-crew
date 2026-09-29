import type { Ticket } from '@crew/shared';
import { createRequestTicket, createSubtask } from '../../../api/src/services/ticket-service.js';
import {
  type PairedMachine,
  pairTestMachine,
  startServer,
  type TestServer,
} from '../../../api/test/helpers/machines.js';
import { type LoggedInOwner, seedAndLogin } from '../../../api/test/helpers/owner-session.js';
import { createTestProject, RATED, setStatus, useTestDb } from '../../../api/test/helpers/test-db.js';
import { onCleanup, withDeadline } from './git.js';

export {
  clearRating,
  commentsOf,
  eventsOf,
  getTicket,
  RATED,
  reportAndFinish,
  setStatus,
} from '../../../api/test/helpers/test-db.js';

/** A server that closes cleanly does so in milliseconds; anything slower has a client still attached. */
const SERVER_CLOSE_DEADLINE_MS = 5_000;

/**
 * Closes a test server after the test's later cleanups (daemons, stream clients) have stopped. If a client
 * is still attached, its connections are cut and the cleanup fails with an error saying so, instead of the
 * hook timing out.
 */
export async function closeServer({ app }: TestServer): Promise<void> {
  let settled = false;
  const closing = app.close().finally(() => {
    settled = true;
  });
  try {
    await withDeadline(closing, SERVER_CLOSE_DEADLINE_MS, 'closing the API server');
  } catch (error) {
    if (settled) throw error;
    app.server.closeAllConnections();
    await closing;
    throw new Error(
      `the API server still had open connections ${SERVER_CLOSE_DEADLINE_MS} ms after the test: a daemon or ` +
        'stream client it started was never stopped (see the test failure above, if any)',
    );
  }
}

/**
 * The real API (`buildApp()` on the daemon test database, listening on a random port), truncated before
 * every test. Call at the top level of a test file.
 */
export function useApi() {
  const handle = useTestDb();
  return {
    get db() {
      return handle.db;
    },
    /** Starts a server with short realtime timings (so a test does not wait for a 20 s ping). */
    async server(): Promise<TestServer> {
      const server = await startServer(handle.db, { pollMs: 200, streamHeartbeatMs: 1_000 });
      // Cleanups run newest first, so daemons and clients started after the server stop before it closes.
      onCleanup(() => closeServer(server));
      return server;
    },
  };
}

export interface Fixture {
  server: TestServer;
  machine: PairedMachine;
  owner: LoggedInOwner;
  projectId: string;
  projectKey: string;
}

/** Server + a paired machine that owns project `WEB` + a logged-in owner. */
export async function fixture(api: ReturnType<typeof useApi>, name = 'dev-mac'): Promise<Fixture> {
  const server = await api.server();
  const machine = await pairTestMachine(api.db, name);
  const project = await createTestProject(api.db, { ownerMachineId: machine.machineId });
  const owner = await seedAndLogin(server.app, api.db);
  return { server, machine, owner, projectId: project.id, projectKey: project.key };
}

/** request → pm_task (in progress) under the fixture's project; returns the pm_task. */
export async function pmTask(
  api: ReturnType<typeof useApi>,
  f: Fixture,
  title = 'Phân tích',
): Promise<Ticket> {
  const request = await createRequestTicket(api.db, { title: `Yêu cầu: ${title}` });
  const pm = await createSubtask(api.db, {
    type: 'pm_task',
    parentId: request.id,
    projectId: f.projectId,
    title,
  });
  await setStatus(api.db, request.id, 'in_progress');
  await setStatus(api.db, pm.id, 'in_progress');
  return pm;
}

export async function devTicket(
  api: ReturnType<typeof useApi>,
  parentId: string,
  title = 'Làm việc',
  extra: { dependsOn?: string[] } = {},
) {
  return createSubtask(api.db, { type: 'dev', ...RATED, parentId, title, ...extra });
}

/** An owner comment through the real owner route (it emits `ticket.comment_added`). */
export async function ownerComment(f: Fixture, ticketId: string, body: string): Promise<void> {
  const response = await f.server.app.inject({
    method: 'POST',
    url: `/v1/tickets/${ticketId}/comments`,
    headers: f.owner.headers,
    payload: { body },
  });
  if (response.statusCode !== 201)
    throw new Error(`owner comment failed: ${response.statusCode} ${response.body}`);
}

export async function ownerTransition(f: Fixture, ticketId: string, to: string): Promise<void> {
  const response = await f.server.app.inject({
    method: 'POST',
    url: `/v1/tickets/${ticketId}/transition`,
    headers: f.owner.headers,
    payload: { to },
  });
  if (response.statusCode !== 200)
    throw new Error(`owner transition failed: ${response.statusCode} ${response.body}`);
}
