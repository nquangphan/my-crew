import type { Ticket } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTicketTree } from '../src/services/ticket-query-service.js';
import { createRequestTicket, createSubtask } from '../src/services/ticket-service.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import {
  createDevWithQc,
  createMachine,
  createTestProject,
  RATED,
  setStatus,
  useTestDb,
} from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance;
let owner: LoggedInOwner;

beforeEach(async () => {
  app = await makeApp(ctx.db);
  owner = await seedAndLogin(app, ctx.db);
});
afterEach(() => app.close());

/** One request routed to two projects (a pm_task each, with children), plus an unrelated request. */
async function routedRequest() {
  const machine = await createMachine(ctx.db, 'project-mac');
  const web = await createTestProject(ctx.db, { key: 'WEB', ownerMachineId: machine });
  const app2 = await createTestProject(ctx.db, {
    key: 'APP',
    name: 'App',
    repoUrl: 'https://github.com/2p/app.git',
    ownerMachineId: machine,
  });
  const other = await createTestProject(ctx.db, {
    key: 'OPS',
    name: 'Ops',
    repoUrl: 'https://github.com/2p/ops.git',
    ownerMachineId: machine,
  });
  const request = await createRequestTicket(ctx.db, { title: 'Giỏ hàng trên web và app' });
  await setStatus(ctx.db, request.id, 'in_progress');
  const pmWeb = await createSubtask(ctx.db, {
    type: 'pm_task',
    parentId: request.id,
    projectId: web.id,
    title: 'Giỏ hàng web',
  });
  const pmApp = await createSubtask(ctx.db, {
    type: 'pm_task',
    parentId: request.id,
    projectId: app2.id,
    title: 'Giỏ hàng app',
  });
  await setStatus(ctx.db, pmWeb.id, 'in_progress');
  await setStatus(ctx.db, pmApp.id, 'in_progress');
  const webPair = await createDevWithQc(ctx.db, pmWeb.id);
  const appDocs = await createSubtask(ctx.db, { type: 'docs_init', parentId: pmApp.id, title: 'Docs app' });
  const appDev = await createSubtask(ctx.db, { type: 'dev', ...RATED, parentId: pmApp.id, title: 'Nút' });
  await setStatus(ctx.db, appDev.id, 'done');
  const hinted = await createRequestTicket(ctx.db, { title: 'Gợi ý OPS', projectHintId: other.id });
  const unrelated = await createRequestTicket(ctx.db, { title: 'Không liên quan' });
  return { web, app: app2, other, request, pmWeb, pmApp, webPair, appDocs, appDev, hinted, unrelated };
}

async function list(query: string): Promise<Ticket[]> {
  const res = await app.inject({ method: 'GET', url: `/v1/tickets?${query}`, headers: owner.headers });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { items: Ticket[] }).items;
}

const keysOf = (items: readonly Ticket[]) => items.map((t) => t.key).sort();

describe('GET /v1/tickets across projects', () => {
  it('lists every project and every request when no project is given', async () => {
    const s = await routedRequest();
    const items = await list('limit=100');
    expect(keysOf(items)).toEqual(
      keysOf([
        s.request,
        s.pmWeb,
        s.pmApp,
        s.webPair.dev,
        s.webPair.qc,
        s.appDocs,
        s.appDev,
        s.hinted,
        s.unrelated,
      ]),
    );
  });

  it('projectIds keeps the projects’ tickets and the requests routed to or hinted at them', async () => {
    const s = await routedRequest();
    const web = await list(`projectIds=${s.web.id}`);
    expect(keysOf(web)).toEqual(keysOf([s.request, s.pmWeb, s.webPair.dev, s.webPair.qc]));

    const both = await list(`projectIds=${s.web.id},${s.app.id}`);
    expect(keysOf(both)).toEqual(
      keysOf([s.request, s.pmWeb, s.pmApp, s.webPair.dev, s.webPair.qc, s.appDocs, s.appDev]),
    );

    const ops = await list(`projectIds=${s.other.id}`);
    expect(keysOf(ops)).toEqual([s.hinted.key]);
  });

  it('combines projectIds with the other filters and pages through them', async () => {
    const s = await routedRequest();
    const typed = await list(`projectIds=${s.web.id},${s.app.id}&type=pm_task,request`);
    expect(keysOf(typed)).toEqual(keysOf([s.request, s.pmWeb, s.pmApp]));

    const first = await app.inject({
      method: 'GET',
      url: `/v1/tickets?projectIds=${s.app.id}&limit=2&sort=createdAt&order=asc`,
      headers: owner.headers,
    });
    const page1 = first.json() as { items: Ticket[]; nextCursor: string | null };
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const second = await app.inject({
      method: 'GET',
      url: `/v1/tickets?projectIds=${s.app.id}&limit=2&sort=createdAt&order=asc&cursor=${page1.nextCursor}`,
      headers: owner.headers,
    });
    const page2 = second.json() as { items: Ticket[]; nextCursor: string | null };
    expect(keysOf([...page1.items, ...page2.items])).toEqual(
      keysOf([s.request, s.pmApp, s.appDocs, s.appDev]),
    );
    expect(page2.nextCursor).toBeNull();
  });

  it('rejects a malformed project id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tickets?projectIds=not-a-uuid',
      headers: owner.headers,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/tickets/:id/tree', () => {
  it('returns every descendant of a request, closed ones included, parents first, with agent activity', async () => {
    const s = await routedRequest();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${s.request.key}/tree`,
      headers: owner.headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { items: Ticket[]; truncated: boolean };
    expect(body.truncated).toBe(false);
    expect(body.items.map((t) => t.key)).toEqual([
      s.pmWeb.key,
      s.pmApp.key,
      s.webPair.dev.key,
      s.webPair.qc.key,
      s.appDocs.key,
      s.appDev.key,
    ]);
    expect(body.items.find((t) => t.id === s.appDev.id)?.status).toBe('done');
    // Owner reads carry the activity field (a todo ticket no machine reports is "unreported").
    expect(body.items.find((t) => t.id === s.webPair.dev.id)?.agentActivity?.status).toBe('unreported');
  });

  it('returns a pm_task’s children, an empty tree for a leaf, and 404 for an unknown ticket', async () => {
    const s = await routedRequest();
    const pm = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${s.pmApp.id}/tree`,
      headers: owner.headers,
    });
    expect((pm.json() as { items: Ticket[] }).items.map((t) => t.key)).toEqual([s.appDocs.key, s.appDev.key]);
    const leaf = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${s.appDev.key}/tree`,
      headers: owner.headers,
    });
    expect(leaf.json()).toEqual({ items: [], truncated: false });
    const missing = await app.inject({
      method: 'GET',
      url: '/v1/tickets/AST-999/tree',
      headers: owner.headers,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('needs an owner session', async () => {
    const s = await routedRequest();
    const res = await app.inject({ method: 'GET', url: `/v1/tickets/${s.request.key}/tree` });
    expect(res.statusCode).toBe(401);
  });

  it('stops at the limit and says so', async () => {
    const s = await routedRequest();
    const tree = await getTicketTree(ctx.db, s.request.id, 3);
    expect(tree.truncated).toBe(true);
    expect(tree.items.map((t) => t.key)).toEqual([s.pmWeb.key, s.pmApp.key, s.webPair.dev.key]);
    const exact = await getTicketTree(ctx.db, s.request.id, 6);
    expect(exact.truncated).toBe(false);
    expect(exact.items).toHaveLength(6);
  });
});
