import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimRequests, machines, projects } from '../src/db/schema.js';
import { createRequestTicket, createSubtask } from '../src/services/ticket-service.js';
import { freshTotp, type PairedMachine, pairTestMachine, writeHeaders } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import { createTestProject, eventsOf, getTicket, setStatus, useTestDb } from './helpers/test-db.js';

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

const claimAs = (machine: PairedMachine, body: object, key?: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/daemon/claims',
    headers: writeHeaders(machine, key),
    payload: body,
  });
const releaseAs = (machine: PairedMachine, what: string) =>
  app.inject({ method: 'DELETE', url: `/v1/daemon/claims/${what}`, headers: writeHeaders(machine) });
const getTicketAs = (machine: PairedMachine, id: string) =>
  app.inject({ method: 'GET', url: `/v1/daemon/tickets/${id}`, headers: machine.auth });
const decide = async (id: string, decision: 'approve' | 'reject', code?: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/claim-requests/${id}/${decision}`,
    headers: owner.headers,
    payload: { code: code ?? (await freshTotp(ctx.db, owner.totpSecret)) },
  });

async function projectOwner(key: string) {
  const [row] = await ctx.db.select().from(projects).where(eq(projects.key, key));
  return row?.ownerMachineId ?? null;
}

/** WEB owned by `holder`, with a pm_task in progress, a todo dev, an in_review dev and a done dev. */
async function webTree(holder: string | null) {
  const project = await createTestProject(ctx.db, { ownerMachineId: holder });
  const request = await createRequestTicket(ctx.db, { title: 'Giỏ hàng' });
  const pmTask = await createSubtask(ctx.db, {
    type: 'pm_task',
    parentId: request.id,
    projectId: project.id,
    title: 'PM giỏ hàng',
  });
  await setStatus(ctx.db, pmTask.id, 'in_progress');
  const todo = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Làm API' });
  const review = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Làm UI' });
  await setStatus(ctx.db, review.id, 'in_review');
  const done = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Xong rồi' });
  await setStatus(ctx.db, done.id, 'done');
  return { project, request, pmTask, todo, review, done };
}

const reassignedTo = async (machineId: string) =>
  (await eventsOf(ctx.db, 'ticket.assigned'))
    .filter(
      (e) =>
        e.targetMachineId === machineId && (e.payload as { data: { reassigned?: boolean } }).data.reassigned,
    )
    .map((e) => e.ticketId);

describe('claiming an unowned project', () => {
  it('binds at once, notifies the owner inbox with an audit row, and hands over the open tickets', async () => {
    const tree = await webTree(null);
    const res = await claimAs(a, { projectKey: 'WEB' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'granted' });
    expect(await projectOwner('WEB')).toBe(a.machineId);

    const [audit] = await ctx.db.select().from(claimRequests);
    expect(audit).toMatchObject({ machineId: a.machineId, projectId: tree.project.id, status: 'granted' });
    const [claimed] = await eventsOf(ctx.db, 'machine.claimed');
    expect(claimed).toMatchObject({ targetMachineId: null, projectId: tree.project.id });
    expect(claimed?.payload).toEqual({
      type: 'machine.claimed',
      data: { machineId: a.machineId, projectId: tree.project.id, assistant: false },
    });

    expect((await getTicket(ctx.db, tree.todo.id)).assigneeMachineId).toBe(a.machineId);
    expect((await getTicket(ctx.db, tree.done.id)).assigneeMachineId).toBeNull();
    expect((await reassignedTo(a.machineId)).sort()).toEqual([tree.pmTask.id, tree.todo.id].sort());

    const again = await claimAs(a, { projectKey: 'WEB' });
    expect(again.json()).toEqual({ status: 'already_owned', claimRequestId: null });
  });

  it('404s for an unknown project key and 400s for a malformed body', async () => {
    expect((await claimAs(a, { projectKey: 'NOPE' })).statusCode).toBe(404);
    expect((await claimAs(a, { projectKey: 'web' })).statusCode).toBe(400);
    expect((await claimAs(a, { hostsAssistant: false })).statusCode).toBe(400);
  });
});

describe('taking over a project held by another machine', () => {
  it('stays pending until the owner approves with TOTP, then moves the open tickets', async () => {
    const tree = await webTree(a.machineId);
    const first = await claimAs(b, { projectKey: 'WEB' }, 'claim-key-1');
    expect(first.statusCode).toBe(409);
    expect(first.json().error.code).toBe('CLAIM_PENDING');
    const { claimRequestId } = first.json().error.details;

    const retry = await claimAs(b, { projectKey: 'WEB' }, 'claim-key-1');
    expect(retry.statusCode).toBe(409);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    const second = await claimAs(b, { projectKey: 'WEB' });
    expect(second.json().error.details.claimRequestId).toBe(claimRequestId);
    expect(await ctx.db.$count(claimRequests)).toBe(1);

    const [requested] = await eventsOf(ctx.db, 'claim.requested');
    expect(requested).toMatchObject({ targetMachineId: null });
    expect(requested?.payload).toMatchObject({
      data: { claimRequestId, machineId: b.machineId, projectId: tree.project.id, assistant: false },
    });
    expect(await projectOwner('WEB')).toBe(a.machineId);
    expect((await getTicketAs(b, tree.todo.id)).statusCode).toBe(403);

    const pending = await app.inject({
      method: 'GET',
      url: '/v1/claim-requests?status=pending',
      headers: owner.headers,
    });
    expect(pending.json().items).toMatchObject([
      { id: claimRequestId, machineName: 'mac-b', projectKey: 'WEB', previousMachineId: a.machineId },
    ]);

    expect((await decide(claimRequestId, 'approve', '000000')).statusCode).toBe(401);
    expect(await projectOwner('WEB')).toBe(a.machineId);

    const approved = await decide(claimRequestId, 'approve');
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'approved', previousMachineId: a.machineId });
    expect(await projectOwner('WEB')).toBe(b.machineId);

    for (const t of [tree.pmTask, tree.todo, tree.review]) {
      expect((await getTicket(ctx.db, t.id)).assigneeMachineId).toBe(b.machineId);
    }
    expect((await getTicket(ctx.db, tree.done.id)).assigneeMachineId).toBe(a.machineId);
    expect((await reassignedTo(b.machineId)).sort()).toEqual([tree.pmTask.id, tree.todo.id].sort());

    const changed = await eventsOf(ctx.db, 'claim.changed');
    expect(changed.map((e) => e.targetMachineId).sort()).toEqual([a.machineId, b.machineId].sort());
    expect(changed[0]?.payload).toMatchObject({
      data: { claimRequestId, status: 'approved', machineId: b.machineId, previousMachineId: a.machineId },
    });

    expect((await getTicketAs(b, tree.todo.id)).statusCode).toBe(200);
    expect((await getTicketAs(a, tree.todo.id)).statusCode).toBe(403);
    expect((await decide(claimRequestId, 'approve')).statusCode).toBe(409);
  });

  it('a rejection keeps the holder and notifies only the requesting machine', async () => {
    await webTree(a.machineId);
    const { claimRequestId } = (await claimAs(b, { projectKey: 'WEB' })).json().error.details;
    const rejected = await decide(claimRequestId, 'reject');
    expect(rejected.json()).toMatchObject({ status: 'rejected' });
    expect(await projectOwner('WEB')).toBe(a.machineId);
    const changed = await eventsOf(ctx.db, 'claim.changed');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ targetMachineId: b.machineId });
    expect(changed[0]?.payload).toMatchObject({ data: { status: 'rejected', machineId: a.machineId } });
  });

  it('a pending request can be withdrawn by releasing it', async () => {
    await webTree(a.machineId);
    const { claimRequestId } = (await claimAs(b, { projectKey: 'WEB' })).json().error.details;
    const res = await releaseAs(b, 'WEB');
    expect(res.json()).toEqual({ status: 'withdrawn' });
    const [row] = await ctx.db.select().from(claimRequests).where(eq(claimRequests.id, claimRequestId));
    expect(row?.status).toBe('withdrawn');
    expect((await decide(claimRequestId, 'approve')).statusCode).toBe(409);
  });
});

describe('the assistant role', () => {
  it('is bound at once when nobody hosts it; a second assistant host returns 409 until approved', async () => {
    const request = await createRequestTicket(ctx.db, { title: 'Chưa có trợ lý' });
    expect(request.assigneeMachineId).toBeNull();

    const granted = await claimAs(a, { hostsAssistant: true });
    expect(granted.json()).toMatchObject({ status: 'granted' });
    expect((await getTicket(ctx.db, request.id)).assigneeMachineId).toBe(a.machineId);
    expect(await reassignedTo(a.machineId)).toEqual([request.id]);

    const second = await claimAs(b, { hostsAssistant: true });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CLAIM_PENDING');
    const hosts = await ctx.db.select().from(machines).where(eq(machines.hostsAssistant, true));
    expect(hosts.map((m) => m.id)).toEqual([a.machineId]);

    const approved = await decide(second.json().error.details.claimRequestId, 'approve');
    expect(approved.json()).toMatchObject({ status: 'approved', assistant: true, projectId: null });
    const after = await ctx.db.select().from(machines).where(eq(machines.hostsAssistant, true));
    expect(after.map((m) => m.id)).toEqual([b.machineId]);
    expect((await getTicket(ctx.db, request.id)).assigneeMachineId).toBe(b.machineId);
    expect((await getTicketAs(a, request.id)).statusCode).toBe(403);
    expect((await getTicketAs(b, request.id)).statusCode).toBe(200);
  });

  it('can be released', async () => {
    await claimAs(a, { hostsAssistant: true });
    expect((await releaseAs(a, 'assistant')).json()).toEqual({ status: 'released' });
    expect(await ctx.db.$count(machines, eq(machines.hostsAssistant, true))).toBe(0);
    expect((await releaseAs(a, 'assistant')).statusCode).toBe(409);
  });
});

describe('releasing a project', () => {
  it('leaves its open tickets unowned until another machine claims it', async () => {
    const tree = await webTree(a.machineId);
    const res = await releaseAs(a, 'WEB');
    expect(res.json()).toEqual({ status: 'released' });
    expect(await projectOwner('WEB')).toBeNull();
    expect((await getTicket(ctx.db, tree.todo.id)).assigneeMachineId).toBeNull();
    expect((await getTicket(ctx.db, tree.todo.id)).status).toBe('todo');
    const [released] = await eventsOf(ctx.db, 'machine.released');
    expect(released).toMatchObject({ targetMachineId: null });
    expect((await releaseAs(a, 'WEB')).statusCode).toBe(409);

    expect((await claimAs(b, { projectKey: 'WEB' })).json()).toMatchObject({ status: 'granted' });
    expect((await getTicket(ctx.db, tree.todo.id)).assigneeMachineId).toBe(b.machineId);
    expect(await reassignedTo(b.machineId)).toContain(tree.todo.id);
  });
});

describe('POST /v1/daemon/projects', () => {
  const body = {
    key: 'APP',
    name: 'Ứng dụng',
    description: 'Ứng dụng di động bán hàng',
    repoUrl: 'git@github.com:2p/app.git',
    platform: 'mobile',
  };
  const create = (payload: object, headers = writeHeaders(a)) =>
    app.inject({ method: 'POST', url: '/v1/daemon/projects', headers, payload });

  it('creates a project owned by the caller and notifies the owner inbox', async () => {
    const res = await create(body);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ key: 'APP', ownerMachineId: a.machineId, defaultBranch: 'main' });
    const [created] = await eventsOf(ctx.db, 'project.created');
    expect(created?.payload).toEqual({
      type: 'project.created',
      data: { projectId: res.json().id, machineId: a.machineId },
    });
  });

  it('409s on a duplicate key and 400s on an invalid repo URL or a missing Idempotency-Key', async () => {
    expect((await create(body)).statusCode).toBe(201);
    const dup = await create(body);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CONFLICT');
    expect((await create({ ...body, key: 'APP2', repoUrl: 'ftp://x/y.git' })).statusCode).toBe(400);
    expect((await create({ ...body, key: 'APP3' }, a.auth)).statusCode).toBe(400);
  });
});

describe('GET /v1/daemon/projects', () => {
  it('shows each project as mine, unowned or other, plus the assistant role and pending claims', async () => {
    await createTestProject(ctx.db, { key: 'WEB', ownerMachineId: a.machineId });
    await createTestProject(ctx.db, { key: 'API', ownerMachineId: b.machineId });
    await createTestProject(ctx.db, { key: 'OPS' });
    await claimAs(a, { hostsAssistant: true });
    await claimAs(b, { projectKey: 'WEB' });

    const res = await app.inject({ method: 'GET', url: '/v1/daemon/projects', headers: b.auth });
    expect(res.statusCode).toBe(200);
    const byKey = Object.fromEntries(
      (res.json().items as { key: string }[]).map((p) => [p.key, p]),
    ) as Record<string, object>;
    expect(byKey.WEB).toMatchObject({ ownerState: 'other', ownerMachineName: 'mac-a', pendingClaim: true });
    expect(byKey.API).toMatchObject({ ownerState: 'mine', ownerMachineName: null, pendingClaim: false });
    expect(byKey.OPS).toMatchObject({ ownerState: 'unowned', ownerMachineName: null });
    expect(res.json().assistant).toEqual({ state: 'other', hostName: 'mac-a', pendingClaim: false });
  });
});

describe('owner reassignment and revocation', () => {
  it('the owner moves a project to another machine; both machines are told', async () => {
    const tree = await webTree(a.machineId);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/machines/${b.machineId}/claims`,
      headers: owner.headers,
      payload: { projectId: tree.project.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'granted' });
    expect(await projectOwner('WEB')).toBe(b.machineId);
    expect((await getTicket(ctx.db, tree.todo.id)).assigneeMachineId).toBe(b.machineId);
    const changed = await eventsOf(ctx.db, 'claim.changed');
    expect(changed.map((e) => e.targetMachineId).sort()).toEqual([a.machineId, b.machineId].sort());
    const [audit] = await ctx.db.select().from(claimRequests);
    expect(audit).toMatchObject({ status: 'approved', previousMachineId: a.machineId });
  });

  it('revoking a machine releases its projects and the assistant role', async () => {
    const tree = await webTree(a.machineId);
    await claimAs(a, { hostsAssistant: true });
    await createTestProject(ctx.db, { key: 'API', ownerMachineId: b.machineId });
    await claimAs(a, { projectKey: 'API' });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/machines/${a.machineId}/revoke`,
      headers: owner.headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hostsAssistant: false, online: false, projectKeys: [] });
    expect(await projectOwner('WEB')).toBeNull();
    expect((await getTicket(ctx.db, tree.todo.id)).assigneeMachineId).toBeNull();
    expect(await eventsOf(ctx.db, 'machine.released')).toHaveLength(2);
    const pending = await ctx.db.select().from(claimRequests).where(eq(claimRequests.status, 'pending'));
    expect(pending).toHaveLength(0);

    const assign = await app.inject({
      method: 'POST',
      url: `/v1/machines/${a.machineId}/claims`,
      headers: owner.headers,
      payload: { hostsAssistant: true },
    });
    expect(assign.statusCode).toBe(409);
  });
});
