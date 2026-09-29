import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectChangeRequests, projects } from '../src/db/schema.js';
import { createRequestTicket, createSubtask } from '../src/services/ticket-service.js';
import { freshTotp, type PairedMachine, pairTestMachine, writeHeaders } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import { createTestProject, eventsOf, useTestDb } from './helpers/test-db.js';

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

const MOBILE = { platform: 'mobile', uiTestMcp: { maestro: 'maestro-cloud', playwright: 'playwright' } };

const requestAs = (machine: PairedMachine, body: object, key?: string, projectKey = 'WEB') =>
  app.inject({
    method: 'POST',
    url: `/v1/daemon/projects/${projectKey}/change-requests`,
    headers: writeHeaders(machine, key),
    payload: body,
  });
const decide = async (id: string, decision: 'approve' | 'reject', code?: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/project-change-requests/${id}/${decision}`,
    headers: owner.headers,
    payload: { code: code ?? (await freshTotp(ctx.db, owner.totpSecret)) },
  });
const project = async () => {
  const [row] = await ctx.db.select().from(projects).where(eq(projects.key, 'WEB'));
  if (!row) throw new Error('no project');
  return row;
};
const daemonView = async (machine: PairedMachine) =>
  (await app.inject({ method: 'GET', url: '/v1/daemon/projects', headers: machine.auth })).json().items[0];

/** A pm_task in WEB, so QC tickets can be created under it. */
async function pmTaskIn(projectId: string) {
  const request = await createRequestTicket(ctx.db, { title: 'Giỏ hàng' });
  return createSubtask(ctx.db, { type: 'pm_task', parentId: request.id, projectId, title: 'PM' });
}

describe('a machine changing its own project type and UI-test MCP mapping', () => {
  it('stays pending until the owner approves with TOTP; then the project and new QC defaults change', async () => {
    const web = await createTestProject(ctx.db, { ownerMachineId: a.machineId, platform: 'web' });
    const pmTask = await pmTaskIn(web.id);
    const qcFor = async (title: string) => {
      const dev = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: `Dev ${title}` });
      return createSubtask(ctx.db, { type: 'qc', parentId: pmTask.id, title, pairsWith: dev.id });
    };
    const before = await qcFor('QC trước');
    expect(before.requiredMcps).toEqual(['playwright']);

    const res = await requestAs(a, MOBILE);
    expect(res.statusCode).toBe(202);
    const { status, requestId } = res.json();
    expect(status).toBe('pending');
    expect(await project()).toMatchObject({ platform: 'web' });

    const [requested] = await eventsOf(ctx.db, 'project.change_requested');
    expect(requested).toMatchObject({ targetMachineId: null, projectId: web.id });
    expect(requested?.payload).toEqual({
      type: 'project.change_requested',
      data: { requestId, projectId: web.id, machineId: a.machineId },
    });
    expect(await daemonView(a)).toMatchObject({
      platform: 'web',
      pendingChange: { requestId, ...MOBILE },
    });
    const notices = await app.inject({ method: 'GET', url: '/v1/notices', headers: owner.headers });
    expect(notices.json().items.map((n: { type: string }) => n.type)).toContain('project.change_requested');

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/project-change-requests?status=pending',
      headers: owner.headers,
    });
    expect(listed.json().items).toMatchObject([
      {
        id: requestId,
        projectKey: 'WEB',
        machineName: 'mac-a',
        current: { platform: 'web', uiTestMcp: { maestro: 'maestro', playwright: 'playwright' } },
        requested: MOBILE,
        status: 'pending',
      },
    ]);

    expect((await decide(requestId, 'approve', '000000')).statusCode).toBe(401);
    expect(await project()).toMatchObject({ platform: 'web' });

    const approved = await decide(requestId, 'approve');
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'approved', requested: MOBILE });
    expect(await project()).toMatchObject(MOBILE);
    const [decided] = await eventsOf(ctx.db, 'project.change_decided');
    expect(decided).toMatchObject({ targetMachineId: a.machineId, projectId: web.id });
    expect(decided?.payload).toEqual({
      type: 'project.change_decided',
      data: { requestId, projectId: web.id, machineId: a.machineId, status: 'approved' },
    });
    expect((await daemonView(a)).pendingChange).toBeNull();

    const after = await qcFor('QC sau');
    expect(after.requiredMcps).toEqual(['maestro-cloud']);
    expect((await decide(requestId, 'reject')).statusCode).toBe(409);
  });

  it('leaves the project unchanged when the owner rejects, and tells the machine', async () => {
    await createTestProject(ctx.db, { ownerMachineId: a.machineId, platform: 'web' });
    const { requestId } = (await requestAs(a, MOBILE)).json();
    const rejected = await decide(requestId, 'reject');
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe('rejected');
    expect(await project()).toMatchObject({ platform: 'web' });
    const [decided] = await eventsOf(ctx.db, 'project.change_decided');
    expect(decided?.targetMachineId).toBe(a.machineId);
    expect(decided?.payload).toMatchObject({ data: { status: 'rejected' } });
    expect((await decide(requestId, 'approve')).statusCode).toBe(409);
    // A new request is possible once the previous one is decided.
    expect((await requestAs(a, MOBILE)).statusCode).toBe(202);
  });

  it('refuses machines that do not own the project', async () => {
    await createTestProject(ctx.db, { ownerMachineId: a.machineId });
    const res = await requestAs(b, MOBILE);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    await ctx.db.update(projects).set({ ownerMachineId: null });
    expect((await requestAs(a, MOBILE)).statusCode).toBe(403);
    expect(await ctx.db.$count(projectChangeRequests)).toBe(0);
    expect(await eventsOf(ctx.db, 'project.change_requested')).toHaveLength(0);
  });

  it('is idempotent: a retry replays, the same values return the pending request, other values conflict', async () => {
    await createTestProject(ctx.db, { ownerMachineId: a.machineId, platform: 'web' });
    const first = await requestAs(a, MOBILE, 'change-key-1');
    const retry = await requestAs(a, MOBILE, 'change-key-1');
    expect(retry.statusCode).toBe(202);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(first.json());
    const same = await requestAs(a, MOBILE);
    expect(same.json()).toEqual(first.json());
    const other = await requestAs(a, { platform: 'backend', uiTestMcp: {} });
    expect(other.statusCode).toBe(409);
    expect(other.json().error.details).toEqual({ requestId: first.json().requestId });
    expect(await ctx.db.$count(projectChangeRequests)).toBe(1);
    expect(await eventsOf(ctx.db, 'project.change_requested')).toHaveLength(1);
  });

  it('answers unchanged for the current values, validates the body, and requires the owner session', async () => {
    await createTestProject(ctx.db, { ownerMachineId: a.machineId, platform: 'web' });
    const same = await requestAs(a, { platform: 'web', uiTestMcp: {} });
    expect(same.statusCode).toBe(200);
    expect(same.json()).toEqual({ status: 'unchanged', requestId: null });
    expect((await requestAs(a, { platform: 'desktop', uiTestMcp: {} })).statusCode).toBe(400);
    expect((await requestAs(a, { ...MOBILE, name: 'x' })).statusCode).toBe(400);
    expect((await requestAs(a, MOBILE, undefined, 'NOPE')).statusCode).toBe(404);
    const noKey = await app.inject({
      method: 'POST',
      url: '/v1/daemon/projects/WEB/change-requests',
      headers: a.auth,
      payload: MOBILE,
    });
    expect(noKey.statusCode).toBe(400);

    const { requestId } = (await requestAs(a, MOBILE)).json();
    const asMachine = await app.inject({
      method: 'POST',
      url: `/v1/project-change-requests/${requestId}/approve`,
      headers: a.auth,
      payload: { code: '123456' },
    });
    expect(asMachine.statusCode).toBe(401);
    const unknown = await decide('00000000-0000-4000-8000-000000000000', 'approve');
    expect(unknown.statusCode).toBe(404);
  });
});

describe('a pending change of a project the requesting machine loses', () => {
  const claimAs = (machine: PairedMachine, body: object) =>
    app.inject({ method: 'POST', url: '/v1/daemon/claims', headers: writeHeaders(machine), payload: body });
  const decideClaim = async (id: string, decision: 'approve' | 'reject') =>
    app.inject({
      method: 'POST',
      url: `/v1/claim-requests/${id}/${decision}`,
      headers: owner.headers,
      payload: { code: await freshTotp(ctx.db, owner.totpSecret) },
    });

  /** WEB owned by mac-a, with mac-a's type change waiting for the owner. */
  async function pendingChangeOfA() {
    const web = await createTestProject(ctx.db, { ownerMachineId: a.machineId, platform: 'web' });
    const res = await requestAs(a, MOBILE);
    expect(res.statusCode).toBe(202);
    return { web, requestId: res.json().requestId as string };
  }

  /** The request is withdrawn, mac-a and the owner stream were told, and deciding it now conflicts. */
  async function expectWithdrawn(requestId: string, projectId: string) {
    const [row] = await ctx.db
      .select()
      .from(projectChangeRequests)
      .where(eq(projectChangeRequests.id, requestId));
    expect(row?.status).toBe('withdrawn');
    expect(row?.decidedAt).toBeInstanceOf(Date);
    const decided = await eventsOf(ctx.db, 'project.change_decided');
    expect(decided).toHaveLength(1);
    expect(decided[0]).toMatchObject({ targetMachineId: a.machineId, projectId });
    expect(decided[0]?.payload).toEqual({
      type: 'project.change_decided',
      data: { requestId, projectId, machineId: a.machineId, status: 'withdrawn' },
    });
    expect(await project()).toMatchObject({ platform: 'web' });
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/project-change-requests',
      headers: owner.headers,
    });
    expect(listed.json().items).toMatchObject([{ id: requestId, status: 'withdrawn' }]);
    const pending = await app.inject({
      method: 'GET',
      url: '/v1/project-change-requests?status=pending',
      headers: owner.headers,
    });
    expect(pending.json().items).toEqual([]);
    for (const decision of ['approve', 'reject'] as const) {
      const late = await decide(requestId, decision);
      expect(late.statusCode).toBe(409);
      expect(late.json().error.message).toContain('withdrawn');
    }
    expect(await project()).toMatchObject({ platform: 'web' });
  }

  it('is withdrawn when an approved takeover moves the project to another machine', async () => {
    const { web, requestId } = await pendingChangeOfA();
    const claim = await claimAs(b, { projectKey: 'WEB' });
    expect(claim.json().status).toBe('pending');
    // A takeover request alone does not move the project, so the change still waits.
    expect((await daemonView(a)).pendingChange).toMatchObject({ requestId });

    expect((await decideClaim(claim.json().claimRequestId, 'approve')).statusCode).toBe(200);
    await expectWithdrawn(requestId, web.id);
    expect(await daemonView(a)).toMatchObject({
      ownerState: 'other',
      pendingChange: null,
      lastChange: { requestId, status: 'withdrawn' },
    });
    expect((await daemonView(b)).lastChange).toBeNull();
    // The new holder may ask for its own change.
    expect((await requestAs(b, MOBILE)).statusCode).toBe(202);
  });

  it('is withdrawn when the owner reassigns the project to another machine', async () => {
    const { web, requestId } = await pendingChangeOfA();
    const assign = await app.inject({
      method: 'POST',
      url: `/v1/machines/${b.machineId}/claims`,
      headers: owner.headers,
      payload: { projectId: web.id },
    });
    expect(assign.json().status).toBe('granted');
    await expectWithdrawn(requestId, web.id);
  });

  it('stays pending when the owner rejects the takeover', async () => {
    const { requestId } = await pendingChangeOfA();
    const claim = await claimAs(b, { projectKey: 'WEB' });
    expect((await decideClaim(claim.json().claimRequestId, 'reject')).statusCode).toBe(200);
    expect((await daemonView(a)).pendingChange).toMatchObject({ requestId });
    expect(await eventsOf(ctx.db, 'project.change_decided')).toHaveLength(0);
  });

  it('is withdrawn when the machine releases the project', async () => {
    const { web, requestId } = await pendingChangeOfA();
    const released = await app.inject({
      method: 'DELETE',
      url: '/v1/daemon/claims/WEB',
      headers: writeHeaders(a),
    });
    expect(released.json()).toEqual({ status: 'released' });
    await expectWithdrawn(requestId, web.id);
    expect(await daemonView(a)).toMatchObject({
      ownerState: 'unowned',
      pendingChange: null,
      lastChange: { requestId, status: 'withdrawn' },
    });
  });

  it('is withdrawn when the owner revokes the machine', async () => {
    const { web, requestId } = await pendingChangeOfA();
    const revoked = await app.inject({
      method: 'POST',
      url: `/v1/machines/${a.machineId}/revoke`,
      headers: owner.headers,
    });
    expect(revoked.statusCode).toBe(200);
    await expectWithdrawn(requestId, web.id);
  });
});
