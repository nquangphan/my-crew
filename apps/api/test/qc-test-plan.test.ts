import type { TestKind } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequestTicket, createSubtask, fileBug } from '../src/services/ticket-service.js';
import { type PairedMachine, pairTestMachine, writeHeaders } from './helpers/machines.js';
import { makeApp } from './helpers/owner-session.js';
import { createTestProject, getTicket, RATED, setStatus, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance;
/** Owns every project created in these tests. */
let a: PairedMachine;
/** Owns nothing. */
let b: PairedMachine;

async function pmTaskFor(projectId: string, title = 'PM task') {
  const request = await createRequestTicket(ctx.db, { title: 'Yêu cầu' });
  const pmTask = await createSubtask(ctx.db, { type: 'pm_task', parentId: request.id, projectId, title });
  await setStatus(ctx.db, pmTask.id, 'in_progress');
  return pmTask;
}

async function devTicketOf(pmTaskId: string) {
  return createSubtask(ctx.db, { type: 'dev', parentId: pmTaskId, title: 'Dev', ...RATED });
}

beforeEach(async () => {
  app = await makeApp(ctx.db);
  a = await pairTestMachine(ctx.db, 'mac-a');
  b = await pairTestMachine(ctx.db, 'mac-b');
});
afterEach(() => app.close());

describe('createSubtask: phương án kiểm thử (testKinds/testReason) của QC', () => {
  it('testKinds api+integration trên web và web_mobile: requiredMcps không có MCP UI', async () => {
    for (const [platform, key] of [
      ['web', 'WEB'],
      ['web_mobile', 'WEBM'],
    ] as const) {
      const project = await createTestProject(ctx.db, { platform, key, ownerMachineId: a.machineId });
      const pmTask = await pmTaskFor(project.id);
      const dev = await devTicketOf(pmTask.id);
      const qc = await createSubtask(ctx.db, {
        type: 'qc',
        parentId: pmTask.id,
        title: 'QC',
        pairsWith: dev.id,
        ...RATED,
        testKinds: ['api', 'integration'],
        testReason: 'Chỉ đổi API, không đụng UI',
      });
      expect(qc.requiredMcps, platform).toEqual([]);
      expect(qc.testKinds, platform).toEqual(['api', 'integration']);
      expect(qc.testReason, platform).toBe('Chỉ đổi API, không đụng UI');
    }
  });

  it("testKinds ['ui_web'] trên web: requiredMcps chứa đúng tên playwright của dự án", async () => {
    const project = await createTestProject(ctx.db, {
      platform: 'web',
      ownerMachineId: a.machineId,
      uiTestMcp: { maestro: 'maestro', playwright: 'e2e-playwright' },
    });
    const pmTask = await pmTaskFor(project.id);
    const dev = await devTicketOf(pmTask.id);
    const qc = await createSubtask(ctx.db, {
      type: 'qc',
      parentId: pmTask.id,
      title: 'QC',
      pairsWith: dev.id,
      ...RATED,
      testKinds: ['ui_web'],
      testReason: 'Cần kiểm giao diện',
    });
    expect(qc.requiredMcps).toEqual(['e2e-playwright']);
  });

  it("testKinds ['ui_web','ui_mobile'] trên web_mobile: requiredMcps chứa cả hai", async () => {
    const project = await createTestProject(ctx.db, {
      platform: 'web_mobile',
      key: 'WEBM',
      ownerMachineId: a.machineId,
    });
    const pmTask = await pmTaskFor(project.id);
    const dev = await devTicketOf(pmTask.id);
    const qc = await createSubtask(ctx.db, {
      type: 'qc',
      parentId: pmTask.id,
      title: 'QC',
      pairsWith: dev.id,
      ...RATED,
      testKinds: ['ui_web', 'ui_mobile'],
      testReason: 'Kiểm cả web lẫn app',
    });
    expect([...qc.requiredMcps].sort()).toEqual(['maestro', 'playwright']);
  });

  it('ui_mobile trên web, ui_web trên mobile, và mọi loại UI trên backend đều VALIDATION_FAILED', async () => {
    const cases = [
      { platform: 'web', key: 'W1', kinds: ['ui_mobile'] },
      { platform: 'mobile', key: 'M1', kinds: ['ui_web'] },
      { platform: 'backend', key: 'B1', kinds: ['ui_web'] },
      { platform: 'backend', key: 'B2', kinds: ['ui_mobile'] },
    ] as const;
    for (const c of cases) {
      const project = await createTestProject(ctx.db, {
        platform: c.platform,
        key: c.key,
        ownerMachineId: a.machineId,
      });
      const pmTask = await pmTaskFor(project.id);
      const dev = await devTicketOf(pmTask.id);
      await expect(
        createSubtask(ctx.db, {
          type: 'qc',
          parentId: pmTask.id,
          title: 'QC',
          pairsWith: dev.id,
          ...RATED,
          testKinds: [...c.kinds],
          testReason: 'lý do',
        }),
        `${c.kinds.join(',')} trên ${c.platform}`,
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('requiredMcps có MCP UI của dự án mà testKinds không có loại UI tương ứng → VALIDATION_FAILED', async () => {
    const project = await createTestProject(ctx.db, { platform: 'web', ownerMachineId: a.machineId });
    const pmTask = await pmTaskFor(project.id);
    const dev = await devTicketOf(pmTask.id);
    await expect(
      createSubtask(ctx.db, {
        type: 'qc',
        parentId: pmTask.id,
        title: 'QC',
        pairsWith: dev.id,
        ...RATED,
        testKinds: ['api'],
        testReason: 'chỉ API',
        requiredMcps: ['playwright'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('testKinds/testReason trên ticket dev → 400 VALIDATION_FAILED qua route daemon', async () => {
    const project = await createTestProject(ctx.db, { platform: 'web', ownerMachineId: a.machineId });
    const pmTask = await pmTaskFor(project.id);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/daemon/tickets',
      headers: writeHeaders(a),
      payload: {
        type: 'dev',
        parentId: pmTask.id,
        title: 'Dev',
        ...RATED,
        testKinds: ['api'],
        testReason: 'lý do',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    const paths = (res.json().error.details as { path: string }[]).map((d) => d.path);
    expect(paths.sort()).toEqual(['testKinds', 'testReason']);
  });

  it('không gửi testKinds: giống hệt hành vi cũ (qcDefaultMcps, testKinds/testReason null)', async () => {
    const project = await createTestProject(ctx.db, { platform: 'web', ownerMachineId: a.machineId });
    const pmTask = await pmTaskFor(project.id);
    const dev = await devTicketOf(pmTask.id);
    const qc = await createSubtask(ctx.db, {
      type: 'qc',
      parentId: pmTask.id,
      title: 'QC',
      pairsWith: dev.id,
      ...RATED,
    });
    expect(qc.requiredMcps).toEqual(['playwright']);
    expect(qc.testKinds).toBeNull();
    expect(qc.testReason).toBeNull();
  });
});

describe('fileBug: QC retest kế thừa phương án kiểm thử', () => {
  it('QC gốc có testKinds: retest có cùng testKinds/testReason/requiredMcps, không có MCP UI', async () => {
    const project = await createTestProject(ctx.db, { platform: 'web', ownerMachineId: a.machineId });
    const pmTask = await pmTaskFor(project.id);
    const dev = await devTicketOf(pmTask.id);
    const qc = await createSubtask(ctx.db, {
      type: 'qc',
      parentId: pmTask.id,
      title: 'QC',
      pairsWith: dev.id,
      ...RATED,
      testKinds: ['api'],
      testReason: 'chỉ API',
    });
    await setStatus(ctx.db, qc.id, 'in_progress');
    const { retest } = await fileBug(ctx.db, qc.id, { title: 'Lỗi API' });
    expect(retest.testKinds).toEqual(['api']);
    expect(retest.testReason).toBe('chỉ API');
    expect(retest.requiredMcps).toEqual([]);
  });

  it('QC gốc không có testKinds (ticket cũ): giữ hành vi hiện tại', async () => {
    const project = await createTestProject(ctx.db, { platform: 'web', ownerMachineId: a.machineId });
    const pmTask = await pmTaskFor(project.id);
    const dev = await devTicketOf(pmTask.id);
    const qc = await createSubtask(ctx.db, {
      type: 'qc',
      parentId: pmTask.id,
      title: 'QC',
      pairsWith: dev.id,
      ...RATED,
    });
    await setStatus(ctx.db, qc.id, 'in_progress');
    const { retest } = await fileBug(ctx.db, qc.id, { title: 'Lỗi UI' });
    expect(retest.testKinds).toBeNull();
    expect(retest.testReason).toBeNull();
    expect(retest.requiredMcps).toEqual(['playwright']);
  });
});

describe('POST /v1/daemon/tickets/:id/test-plan', () => {
  const setPlan = (machine: PairedMachine, pmTaskId: string, payload: object, key?: string) =>
    app.inject({
      method: 'POST',
      url: `/v1/daemon/tickets/${pmTaskId}/test-plan`,
      headers: writeHeaders(machine, key),
      payload,
    });

  async function webTreeWithQc(kinds: readonly TestKind[] = ['ui_web']) {
    const project = await createTestProject(ctx.db, { platform: 'web', ownerMachineId: a.machineId });
    const pmTask = await pmTaskFor(project.id);
    const dev = await devTicketOf(pmTask.id);
    const qc = await createSubtask(ctx.db, {
      type: 'qc',
      parentId: pmTask.id,
      title: 'QC',
      pairsWith: dev.id,
      ...RATED,
      testKinds: [...kinds],
      testReason: 'phương án ban đầu',
      requiredMcps: ['some-other-mcp'],
    });
    return { project, pmTask, dev, qc };
  }

  it("đổi ['ui_web'] → ['api']: gỡ playwright khỏi requiredMcps, giữ MCP khác", async () => {
    const { pmTask, qc } = await webTreeWithQc(['ui_web']);
    expect(qc.requiredMcps.sort()).toEqual(['playwright', 'some-other-mcp']);

    const res = await setPlan(a, pmTask.id, { ticket: qc.id, testKinds: ['api'], testReason: 'chỉ API' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: qc.id,
      testKinds: ['api'],
      testReason: 'chỉ API',
      requiredMcps: ['some-other-mcp'],
      status: 'todo',
    });
  });

  it("đổi ['api'] → ['ui_web']: thêm playwright vào requiredMcps", async () => {
    const { pmTask, qc } = await webTreeWithQc(['api']);
    expect(qc.requiredMcps).toEqual(['some-other-mcp']);

    const res = await setPlan(a, pmTask.id, { ticket: qc.id, testKinds: ['ui_web'], testReason: 'cần UI' });
    expect(res.statusCode).toBe(200);
    expect(res.json().requiredMcps.sort()).toEqual(['playwright', 'some-other-mcp']);
    expect(res.json()).toMatchObject({ testKinds: ['ui_web'], testReason: 'cần UI' });
  });

  it('không đổi trạng thái ticket, chỉ requiredMcps/testKinds/testReason', async () => {
    const { pmTask, qc } = await webTreeWithQc(['ui_web']);
    await setStatus(ctx.db, qc.id, 'in_progress');
    const res = await setPlan(a, pmTask.id, { ticket: qc.id, testKinds: ['api'], testReason: 'x' });
    expect(res.json().status).toBe('in_progress');
    expect((await getTicket(ctx.db, qc.id)).status).toBe('in_progress');
  });

  it('ticket done/cancelled → TICKET_CLOSED', async () => {
    const { pmTask, qc } = await webTreeWithQc();
    await setStatus(ctx.db, qc.id, 'done');
    const done = await setPlan(a, pmTask.id, { ticket: qc.id, testKinds: ['api'], testReason: 'x' });
    expect(done.statusCode).toBe(409);
    expect(done.json().error.code).toBe('TICKET_CLOSED');

    await setStatus(ctx.db, qc.id, 'cancelled');
    const cancelled = await setPlan(a, pmTask.id, { ticket: qc.id, testKinds: ['api'], testReason: 'x' });
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json().error.code).toBe('TICKET_CLOSED');
  });

  it('ticket không phải qc, không thuộc pm_task đó, hoặc :id không phải pm_task → FORBIDDEN', async () => {
    const { pmTask, dev, qc } = await webTreeWithQc();
    const refused = async (machine: PairedMachine, callerId: string, ticket: string) => {
      const res = await setPlan(machine, callerId, { ticket, testKinds: ['api'], testReason: 'x' });
      return { status: res.statusCode, code: res.json().error?.code as string | undefined };
    };
    // A dev ticket, not a qc: not eligible.
    expect(await refused(a, pmTask.id, dev.id)).toEqual({ status: 403, code: 'FORBIDDEN' });
    // The pm_task itself is not a qc subtask.
    expect(await refused(a, pmTask.id, pmTask.id)).toEqual({ status: 403, code: 'FORBIDDEN' });
    // :id must be a pm_task, not the qc ticket itself.
    expect(await refused(a, qc.id, qc.id)).toEqual({ status: 403, code: 'FORBIDDEN' });
    // A qc ticket of another pm_task tree.
    const otherProject = await createTestProject(ctx.db, {
      platform: 'web',
      key: 'OTH',
      ownerMachineId: a.machineId,
    });
    const otherPmTask = await pmTaskFor(otherProject.id, 'PM task khác');
    expect(await refused(a, otherPmTask.id, qc.id)).toEqual({ status: 403, code: 'FORBIDDEN' });
    // A machine that does not own the project.
    expect(await refused(b, pmTask.id, qc.id)).toEqual({ status: 403, code: 'FORBIDDEN' });
  });

  it('gửi lại cùng Idempotency-Key không tạo thay đổi thứ hai', async () => {
    const { pmTask, qc } = await webTreeWithQc(['ui_web']);
    const first = await setPlan(
      a,
      pmTask.id,
      { ticket: qc.id, testKinds: ['api'], testReason: 'chỉ API' },
      'k-test-plan-1',
    );
    const again = await setPlan(
      a,
      pmTask.id,
      { ticket: qc.id, testKinds: ['api'], testReason: 'chỉ API' },
      'k-test-plan-1',
    );
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    // updatedAt only advances once: a second write would bump it again.
    const row = await getTicket(ctx.db, qc.id);
    expect(row.updatedAt.toISOString()).toBe(first.json().updatedAt);
  });
});
