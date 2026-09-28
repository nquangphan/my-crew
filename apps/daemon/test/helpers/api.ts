import type { Ticket } from '@crew/shared';
import { afterEach } from 'vitest';
import { createRequestTicket, createSubtask } from '../../../api/src/services/ticket-service.js';
import {
  type PairedMachine,
  pairTestMachine,
  startServer,
  type TestServer,
} from '../../../api/test/helpers/machines.js';
import { type LoggedInOwner, seedAndLogin } from '../../../api/test/helpers/owner-session.js';
import { createTestProject, setStatus, useTestDb } from '../../../api/test/helpers/test-db.js';

export { commentsOf, eventsOf, getTicket, setStatus } from '../../../api/test/helpers/test-db.js';

/**
 * The real API (`buildApp()` on the daemon test database, listening on a random port), truncated before
 * every test. Call at the top level of a test file.
 */
export function useApi() {
  const handle = useTestDb();
  const servers: TestServer[] = [];
  afterEach(async () => {
    for (const server of servers.splice(0)) await server.app.close();
  });
  return {
    get db() {
      return handle.db;
    },
    /** Starts a server with short realtime timings (so a test does not wait for a 20 s ping). */
    async server(): Promise<TestServer> {
      const server = await startServer(handle.db, { pollMs: 200, streamHeartbeatMs: 1_000 });
      servers.push(server);
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
  return createSubtask(api.db, { type: 'dev', parentId, title, ...extra });
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
