import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { budgetsUsage, comments, machines, ticketReports, tickets } from '../src/db/schema.js';
import { updateProject } from '../src/services/project-service.js';
import { createRequestTicket, createSubtask } from '../src/services/ticket-service.js';
import { type PairedMachine, pairTestMachine, writeHeaders } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import { createTestProject, eventsOf, getTicket, RATED, setStatus, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance;
let owner: LoggedInOwner;
/** Owns project WEB. */
let a: PairedMachine;
/** Owns nothing. */
let b: PairedMachine;
/** Hosts the assistant. */
let host: PairedMachine;
let tree: Awaited<ReturnType<typeof buildTree>>;

async function buildTree() {
  await ctx.db.update(machines).set({ hostsAssistant: true }).where(eq(machines.id, host.machineId));
  const project = await createTestProject(ctx.db, { ownerMachineId: a.machineId });
  const request = await createRequestTicket(ctx.db, { title: 'Thêm giỏ hàng' });
  const pmTask = await createSubtask(ctx.db, {
    type: 'pm_task',
    parentId: request.id,
    projectId: project.id,
    title: 'Phân tích',
  });
  await setStatus(ctx.db, pmTask.id, 'in_progress');
  const dev = await createSubtask(ctx.db, {
    type: 'dev',
    ...RATED,
    parentId: pmTask.id,
    title: 'API',
    model: 'opus',
  });
  const qc = await createSubtask(ctx.db, {
    type: 'qc',
    ...RATED,
    parentId: pmTask.id,
    title: 'QC API',
    pairsWith: dev.id,
  });
  await setStatus(ctx.db, qc.id, 'in_progress');
  return { project, request, pmTask, dev, qc };
}

beforeEach(async () => {
  app = await makeApp(ctx.db);
  owner = await seedAndLogin(app, ctx.db);
  a = await pairTestMachine(ctx.db, 'mac-a');
  b = await pairTestMachine(ctx.db, 'mac-b');
  host = await pairTestMachine(ctx.db, 'mac-host');
  tree = await buildTree();
});
afterEach(() => app.close());

type Call = { method: 'GET' | 'POST' | 'PUT' | 'PATCH'; url: string; payload?: object };
const callAs = (machine: PairedMachine, call: Call, key?: string) =>
  app.inject({
    method: call.method,
    url: call.url,
    headers: call.method === 'GET' ? machine.auth : writeHeaders(machine, key),
    ...(call.payload ? { payload: call.payload } : {}),
  });

describe('scope', () => {
  it("machine B gets 403 on every ticket endpoint of machine A's project, with no side effects", async () => {
    const { dev, qc } = tree;
    const calls: Call[] = [
      { method: 'GET', url: `/v1/daemon/tickets/${dev.id}` },
      { method: 'GET', url: `/v1/daemon/tickets/${dev.key}` },
      { method: 'GET', url: `/v1/daemon/budget/${dev.id}` },
      { method: 'POST', url: `/v1/daemon/tickets/${dev.id}/comments`, payload: { body: 'Xin chào' } },
      { method: 'POST', url: `/v1/daemon/tickets/${dev.id}/transition`, payload: { to: 'in_progress' } },
      {
        method: 'PUT',
        url: `/v1/daemon/tickets/${dev.id}/report`,
        payload: { summaryMd: 'Xong', docsFirst: true },
      },
      { method: 'POST', url: `/v1/daemon/tickets/${qc.id}/bugs`, payload: { title: 'Lỗi nút' } },
      { method: 'PATCH', url: `/v1/daemon/tickets/${dev.id}/agent-meta`, payload: { costDeltaUsd: 1 } },
      {
        method: 'POST',
        url: '/v1/daemon/tickets',
        payload: { type: 'dev', ...RATED, parentId: tree.pmTask.id, title: 'X' },
      },
    ];
    for (const call of calls) {
      const res = await callAs(b, call);
      expect(res.statusCode, `${call.method} ${call.url}`).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    }
    expect(await ctx.db.$count(comments)).toBe(0);
    expect(await ctx.db.$count(ticketReports)).toBe(0);
    expect((await getTicket(ctx.db, dev.id)).status).toBe('todo');
    expect((await getTicket(ctx.db, dev.id)).costUsd).toBe(0);

    // The owning machine can do all of it.
    expect((await callAs(a, calls[0] as Call)).statusCode).toBe(200);
    expect((await callAs(a, calls[3] as Call)).statusCode).toBe(201);
    expect((await callAs(a, calls[4] as Call)).statusCode).toBe(200);
    expect((await callAs(a, calls[5] as Call)).statusCode).toBe(200);
    expect((await callAs(a, calls[6] as Call)).statusCode).toBe(201);
    expect((await callAs(a, calls[7] as Call)).statusCode).toBe(200);
  });

  it('request tickets are readable by the assistant host and by the machine of one of their pm_tasks', async () => {
    const url = `/v1/daemon/tickets/${tree.request.id}`;
    expect((await callAs(host, { method: 'GET', url })).statusCode).toBe(200);
    const detail = (await callAs(host, { method: 'GET', url })).json();
    expect(detail.children.map((c: { id: string }) => c.id)).toEqual([tree.pmTask.id]);
    // The PM on machine A reads the owner's own request; machine B has no pm_task under it.
    const read = await callAs(a, { method: 'GET', url });
    expect(read.statusCode).toBe(200);
    expect(read.json().ticket.title).toBe('Thêm giỏ hàng');
    expect((await callAs(b, { method: 'GET', url })).statusCode).toBe(403);
    const other = await createRequestTicket(ctx.db, { title: 'Chưa có PM' });
    expect((await callAs(a, { method: 'GET', url: `/v1/daemon/tickets/${other.id}` })).statusCode).toBe(403);
  });

  it('the project machine cannot write to the request above its pm_task', async () => {
    const write = await callAs(a, {
      method: 'POST',
      url: `/v1/daemon/tickets/${tree.request.id}/comments`,
      payload: { body: 'không được' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('only the assistant host creates a pm_task, and only under a request', async () => {
    const pmTask = { type: 'pm_task', parentId: tree.request.id, projectId: tree.project.id, title: 'PM 2' };
    const post = (machine: PairedMachine, payload: object) =>
      callAs(machine, { method: 'POST', url: '/v1/daemon/tickets', payload });

    expect((await post(a, pmTask)).statusCode).toBe(403);
    const created = await post(host, pmTask);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      type: 'pm_task',
      assigneeMachineId: a.machineId,
      assigneeRole: 'pm',
    });

    const nested = await post(host, { ...pmTask, parentId: tree.pmTask.id });
    expect(nested.statusCode).toBe(422);
    expect(nested.json().error.code).toBe('INVALID_HIERARCHY');
    // The host does not own WEB, so it cannot add dev work there.
    expect(
      (await post(host, { type: 'dev', ...RATED, parentId: tree.pmTask.id, title: 'Dev' })).statusCode,
    ).toBe(403);

    const dev = await post(a, { type: 'dev', ...RATED, parentId: tree.pmTask.id, title: 'Dev 2' });
    expect(dev.statusCode).toBe(201);
    const qc = await post(a, {
      type: 'qc',
      ...RATED,
      parentId: tree.pmTask.id,
      title: 'QC 2',
      pairsWith: dev.json().id,
    });
    expect(qc.json().requiredMcps).toContain('playwright');
    const docs = await post(a, { type: 'docs_init', parentId: tree.pmTask.id, title: 'Khởi tạo docs' });
    expect(docs.json()).toMatchObject({ type: 'docs_init', assigneeRole: 'dev' });
  });

  it('refuses a dev or QC subtask without the PM complexity rating and its reason', async () => {
    const post = (payload: object) =>
      callAs(a, {
        method: 'POST',
        url: '/v1/daemon/tickets',
        payload: { parentId: tree.pmTask.id, ...payload },
      });
    const issues = (res: Awaited<ReturnType<typeof post>>) =>
      res.json().error.details as { path: string; message: string }[];

    const noRating = await post({ type: 'dev', title: 'Dev chưa đánh giá' });
    expect(noRating.statusCode).toBe(400);
    expect(noRating.json().error.code).toBe('VALIDATION_FAILED');
    expect(
      issues(noRating)
        .map((issue) => issue.path)
        .sort(),
    ).toEqual(['complexity', 'complexityReason']);
    expect(issues(noRating).find((issue) => issue.path === 'complexity')?.message).toContain(
      'bắt buộc có complexity',
    );

    const noReason = await post({ type: 'dev', title: 'Dev thiếu lý do', complexity: 'medium' });
    expect(noReason.statusCode).toBe(400);
    expect(issues(noReason)).toEqual([
      { path: 'complexityReason', message: expect.stringContaining('một dòng lý do') },
    ]);
    const blankReason = await post({
      type: 'dev',
      title: 'Dev',
      complexity: 'medium',
      complexityReason: '  ',
    });
    expect(blankReason.statusCode).toBe(400);

    const dev = await post({
      type: 'dev',
      title: 'Dev đã đánh giá',
      complexity: 'medium',
      complexityReason: 'Sửa 3 module và thêm migration',
      model: 'opus',
    });
    expect(dev.statusCode).toBe(201);
    expect(dev.json()).toMatchObject({
      complexity: 'medium',
      complexityReason: 'Sửa 3 module và thêm migration',
      model: 'opus',
    });

    const qcNoRating = await post({ type: 'qc', title: 'QC', pairsWith: dev.json().id });
    expect(qcNoRating.statusCode).toBe(400);
    expect(
      issues(qcNoRating)
        .map((issue) => issue.path)
        .sort(),
    ).toEqual(['complexity', 'complexityReason']);
    const qc = await post({
      type: 'qc',
      title: 'QC',
      pairsWith: dev.json().id,
      complexity: 'large',
      complexityReason: 'Kiểm 4 flow UI bằng Playwright, luồng thanh toán',
    });
    expect(qc.statusCode).toBe(201);
    expect(qc.json()).toMatchObject({ complexity: 'large' });

    // pm_task and docs_init keep their own model rules: no rating needed.
    expect((await post({ type: 'docs_init', title: 'Khởi tạo docs' })).statusCode).toBe(201);
  });

  it('the triage catalog is for the assistant host and carries owner-entered text only', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/projects/catalog', headers: host.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [{ id: tree.project.id, key: 'WEB', name: 'Web shop', description: 'Cửa hàng trực tuyến' }],
    });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/projects/catalog', headers: a.auth })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/projects/catalog', headers: { cookie: owner.cookie } }))
        .statusCode,
    ).toBe(401);
  });
});

describe('idempotency on daemon writes', () => {
  it('a retry returns the stored response and writes once', async () => {
    const call: Call = {
      method: 'POST',
      url: `/v1/daemon/tickets/${tree.dev.id}/comments`,
      payload: { body: 'Một' },
    };
    const first = await callAs(a, call, 'job-1:comment-1');
    const retry = await callAs(a, call, 'job-1:comment-1');
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(first.json()).toMatchObject({ authorKind: 'agent', authorRole: 'dev' });
    expect(await ctx.db.$count(comments)).toBe(1);

    const otherTicket = await callAs(
      a,
      { ...call, url: `/v1/daemon/tickets/${tree.qc.id}/comments` },
      'job-1:comment-1',
    );
    expect(otherTicket.statusCode).toBe(422);
    expect(otherTicket.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const noKey = await app.inject({ method: 'POST', url: call.url, headers: a.auth, payload: call.payload });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('QC comments on the dev ticket as qc, and files bugs with a paired retest', async () => {
    const comment = await callAs(a, {
      method: 'POST',
      url: `/v1/daemon/tickets/${tree.dev.id}/comments`,
      payload: { body: 'QC thấy lỗi', role: 'qc' },
    });
    expect(comment.json()).toMatchObject({ authorRole: 'qc' });
    const bugs = await callAs(a, {
      method: 'POST',
      url: `/v1/daemon/tickets/${tree.qc.id}/bugs`,
      payload: { title: 'Nút thanh toán không chạy' },
    });
    expect(bugs.statusCode).toBe(201);
    expect(bugs.json().bug).toMatchObject({ type: 'bug', bugCycle: 1, assigneeMachineId: a.machineId });
    expect(bugs.json().retest).toMatchObject({ type: 'qc', pairsWith: bugs.json().bug.id });
  });
});

describe('agent-meta and the cost contract', () => {
  it('books report cost and agent-meta delta cost once each; retries add nothing', async () => {
    const { dev, project } = tree;
    await callAs(a, {
      method: 'PUT',
      url: `/v1/daemon/tickets/${dev.id}/report`,
      payload: { summaryMd: 'Đã làm xong', docsFirst: true, costUsd: 1.5 },
    });
    const meta: Call = {
      method: 'PATCH',
      url: `/v1/daemon/tickets/${dev.id}/agent-meta`,
      payload: { sessionId: 'sess-1', model: 'claude-sonnet-4-6', effort: 'high', costDeltaUsd: 0.5 },
    };
    const first = await callAs(a, meta, 'job-7:meta-1');
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      agentSessionId: 'sess-1',
      agentModel: 'claude-sonnet-4-6',
      agentEffort: 'high',
      model: 'opus',
      costUsd: 2,
    });
    await callAs(a, meta, 'job-7:meta-1');

    expect((await getTicket(ctx.db, dev.id)).costUsd).toBe(2);
    const usage = await ctx.db.select().from(budgetsUsage).where(eq(budgetsUsage.projectId, project.id));
    expect(usage.map((u) => u.costUsd)).toEqual([2]);

    const sessionOnly = await callAs(a, {
      method: 'PATCH',
      url: `/v1/daemon/tickets/${dev.id}/agent-meta`,
      payload: { sessionId: 'sess-2' },
    });
    expect(sessionOnly.json()).toMatchObject({ agentSessionId: 'sess-2', costUsd: 2 });
    const empty = await callAs(a, {
      method: 'PATCH',
      url: `/v1/daemon/tickets/${dev.id}/agent-meta`,
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
  });

  it('the budget endpoint reports what is left and flags an exhausted budget', async () => {
    const { dev, project, pmTask } = tree;
    await updateProject(ctx.db, project.id, { ticketTreeBudgetUsd: 3, dailyBudgetUsd: 10 });
    await callAs(a, {
      method: 'PATCH',
      url: `/v1/daemon/tickets/${dev.id}/agent-meta`,
      payload: { costDeltaUsd: 2 },
    });
    const budget = await callAs(a, { method: 'GET', url: `/v1/daemon/budget/${dev.id}` });
    expect(budget.statusCode).toBe(200);
    expect(budget.json()).toMatchObject({
      ticketId: dev.id,
      pmTaskId: pmTask.id,
      ticketCostUsd: 2,
      tree: { spentUsd: 2, limitUsd: 3, remainingUsd: 1 },
      daily: { spentUsd: 2, limitUsd: 10, remainingUsd: 8 },
      hold: null,
      overBudget: false,
    });
    expect(budget.json().daily.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await callAs(a, {
      method: 'PATCH',
      url: `/v1/daemon/tickets/${dev.id}/agent-meta`,
      payload: { costDeltaUsd: 1.5 },
    });
    const over = (await callAs(a, { method: 'GET', url: `/v1/daemon/budget/${dev.id}` })).json();
    expect(over).toMatchObject({ hold: 'cost', overBudget: true, tree: { remainingUsd: 0 } });
    expect((await getTicket(ctx.db, pmTask.id)).status).toBe('needs_input');

    const noLimits = (
      await callAs(host, { method: 'GET', url: `/v1/daemon/budget/${tree.request.id}` })
    ).json();
    expect(noLimits).toMatchObject({ pmTaskId: null, tree: { limitUsd: null }, overBudget: false });
  });
});

describe('heartbeat and inventory', () => {
  const beat = (health?: object) => ({
    resources: { cpus: 8, loadAvg1: 1.2, freeMemGb: 6, totalMemGb: 16, orphansCleaned: 2 },
    runningJobs: [{ ticketId: tree.dev.id, role: 'dev', kind: 'agent' }],
    cliVersion: '2.1.300',
    appVersion: '1.0.0',
    paused: true,
    ...(health ? { health } : {}),
  });
  const send = (payload: object) =>
    app.inject({ method: 'POST', url: '/v1/daemon/heartbeat', headers: a.auth, payload });

  it('stores the state and alerts the owner once when health turns red', async () => {
    const res = await send(beat({ status: 'green', failing: [] }));
    expect(res.statusCode).toBe(200);
    expect(new Date(res.json().tokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
    const [row] = await ctx.db.select().from(machines).where(eq(machines.id, a.machineId));
    expect(row).toMatchObject({
      paused: true,
      cliVersion: '2.1.300',
      online: true,
      health: { status: 'green' },
    });
    expect(row?.runningJobs).toHaveLength(1);
    expect(row?.lastHeartbeatAt).not.toBeNull();

    const red = { status: 'red', failing: [{ id: 'claude-login', title: 'Chưa đăng nhập Claude' }] };
    await send(beat(red));
    await send(beat(red));
    expect(await eventsOf(ctx.db, 'machine.unhealthy')).toHaveLength(1);
    await send(beat({ status: 'yellow', failing: [] }));
    await send(beat(red));
    const alerts = await eventsOf(ctx.db, 'machine.unhealthy');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ targetMachineId: null });
    expect(alerts[0]?.payload).toEqual({
      type: 'machine.unhealthy',
      data: { machineId: a.machineId, ...{ failing: red.failing } },
    });

    expect((await send({ ...beat(), resources: { cpus: 0 } })).statusCode).toBe(400);
  });

  it('PUT skills stores per-project and machine-level inventories for owned projects only', async () => {
    const inventory = {
      skills: [{ name: 'ak:scout', source: 'plugin', description: 'Tìm file' }],
      mcpServers: [
        { name: 'playwright', source: 'project', status: 'connected', tools: [{ name: 'click' }] },
      ],
    };
    const put = (machine: PairedMachine, projectKey: string | null) =>
      app.inject({
        method: 'PUT',
        url: '/v1/daemon/skills',
        headers: writeHeaders(machine),
        payload: { projectKey, ...inventory },
      });
    expect((await put(a, 'WEB')).statusCode).toBe(204);
    expect((await put(a, 'WEB')).statusCode).toBe(204);
    expect((await put(a, null)).statusCode).toBe(204);
    expect((await put(b, 'WEB')).statusCode).toBe(403);

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/machines/${a.machineId}`,
      headers: owner.headers,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().machine.projectKeys).toEqual(['WEB']);
    const inventories = detail.json().inventories as { projectKey: string | null }[];
    expect(inventories.map((i) => i.projectKey).sort()).toEqual([null, 'WEB'].sort());
    expect(inventories.find((i) => i.projectKey === 'WEB')).toMatchObject({
      skills: [{ name: 'ak:scout' }],
      mcpServers: [{ name: 'playwright', tools: [{ name: 'click' }] }],
    });
  });

  it('refuses required skills and MCP servers the project machine did not report, or switched off', async () => {
    const create = (payload: object) =>
      callAs(a, {
        method: 'POST',
        url: '/v1/daemon/tickets',
        payload: { parentId: tree.pmTask.id, ...payload },
      });
    const noInventory = await create({ type: 'dev', ...RATED, title: 'X', requiredSkills: ['api-design'] });
    expect(noInventory.statusCode).toBe(400);
    expect(noInventory.json().error.code).toBe('VALIDATION_FAILED');
    // Without requirements there is nothing to check.
    expect((await create({ type: 'dev', ...RATED, title: 'Không cần skill' })).statusCode).toBe(201);

    const put = (projectKey: string | null, body: object) =>
      app.inject({
        method: 'PUT',
        url: '/v1/daemon/skills',
        headers: writeHeaders(a),
        payload: { projectKey, ...body },
      });
    await put('WEB', {
      skills: [{ name: 'api-design', source: 'project' }],
      mcpServers: [
        { name: 'figma', source: 'user', status: 'connected' },
        { name: 'maestro', source: 'user', status: 'connected', disabled: true },
      ],
    });
    await put(null, { skills: [{ name: 'ak:plan', source: 'plugin' }], mcpServers: [] });

    const ok = await create({
      type: 'dev',
      ...RATED,
      title: 'Có skill',
      requiredSkills: ['api-design', 'ak:plan'],
      requiredMcps: ['figma'],
    });
    expect(ok.statusCode).toBe(201);
    const unknown = await create({
      type: 'dev',
      ...RATED,
      title: 'Sai',
      requiredSkills: ['nope'],
      requiredMcps: ['maestro'],
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.details).toEqual({ unknownSkills: ['nope'], unknownMcps: ['maestro'] });
    // The QC default UI-test server is added by the server and never checked against the inventory.
    const qc = await create({ type: 'qc', ...RATED, title: 'QC có skill', pairsWith: ok.json().id });
    expect(qc.statusCode).toBe(201);
    expect(qc.json().requiredMcps).toEqual(['playwright']);
    const bug = await callAs(a, {
      method: 'POST',
      url: `/v1/daemon/tickets/${tree.qc.id}/bugs`,
      payload: { title: 'Lỗi', requiredSkills: ['nope'] },
    });
    expect(bug.statusCode).toBe(400);
  });

  it('the owner lists the tickets of one machine', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tickets?machineId=${a.machineId}`,
      headers: owner.headers,
    });
    const ids = (res.json().items as { id: string }[]).map((t) => t.id).sort();
    expect(ids).toEqual([tree.pmTask.id, tree.dev.id, tree.qc.id].sort());
    expect(await ctx.db.$count(tickets)).toBe(4);
  });
});
