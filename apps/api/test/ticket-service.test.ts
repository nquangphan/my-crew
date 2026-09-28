import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors.js';
import { createProject, updateProject } from '../src/services/project-service.js';
import { getTicketDetail, listTickets, search } from '../src/services/ticket-query-service.js';
import { addComment, createRequestTicket, createSubtask } from '../src/services/ticket-service.js';
import {
  createDevWithQc,
  createMachine,
  createTestProject,
  createTree,
  eventsOf,
  setStatus,
  useTestDb,
} from './helpers/test-db.js';

const ctx = useTestDb();

describe('ticket keys', () => {
  it('gives the first request the key AST-1 and counts up', async () => {
    const first = await createRequestTicket(ctx.db, { title: 'Một' });
    const second = await createRequestTicket(ctx.db, { title: 'Hai' });
    expect(first.key).toBe('AST-1');
    expect(second.key).toBe('AST-2');
  });

  it('numbers subtasks per project key', async () => {
    const { pmTask } = await createTree(ctx.db);
    const dev = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Dev' });
    expect(pmTask.key).toBe('WEB-1');
    expect(dev.key).toBe('WEB-2');
  });

  it('never hands out a key twice under concurrent creation', async () => {
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, i) => createRequestTicket(ctx.db, { title: `Yêu cầu ${i}` })),
    );
    const keys = created.map((t) => t.key).sort();
    expect(new Set(keys).size).toBe(12);
    expect(keys).toContain('AST-12');
  });
});

describe('assignment', () => {
  it('assigns requests to the assistant host and emits ticket.assigned', async () => {
    const host = await createMachine(ctx.db, 'assistant', true);
    const request = await createRequestTicket(ctx.db, { title: 'Yêu cầu', allowConfigChange: true });
    expect(request).toMatchObject({ assigneeRole: 'assistant', assigneeMachineId: host, status: 'todo' });
    const [assigned] = await eventsOf(ctx.db, 'ticket.assigned');
    expect(assigned).toMatchObject({ ticketId: request.id, targetMachineId: host, targetRole: 'assistant' });
    expect(assigned?.payload).toEqual({
      type: 'ticket.assigned',
      data: { ticketId: request.id, role: 'assistant' },
    });
  });

  it('leaves requests unassigned while no assistant host exists', async () => {
    const request = await createRequestTicket(ctx.db, { title: 'Yêu cầu' });
    expect(request.assigneeMachineId).toBeNull();
  });

  it('resolves pm_task and subtasks to the project owner machine and inherits config permission', async () => {
    const machine = await createMachine(ctx.db, 'mac');
    const project = await createTestProject(ctx.db, { ownerMachineId: machine });
    const request = await createRequestTicket(ctx.db, { title: 'R', allowConfigChange: true });
    const pmTask = await createSubtask(ctx.db, {
      type: 'pm_task',
      parentId: request.id,
      projectId: project.id,
      title: 'PM',
    });
    const dev = await createSubtask(ctx.db, {
      type: 'dev',
      parentId: pmTask.id,
      title: 'Dev',
      complexity: 'medium',
      model: 'sonnet',
      effort: 'high',
      requiredSkills: ['testing', 'testing'],
      flows: ['checkout'],
    });
    expect(pmTask).toMatchObject({ assigneeRole: 'pm', assigneeMachineId: machine, projectId: project.id });
    expect(dev).toMatchObject({
      assigneeRole: 'dev',
      assigneeMachineId: machine,
      projectId: project.id,
      allowConfigChange: true,
      complexity: 'medium',
      model: 'sonnet',
      effort: 'high',
      requiredSkills: ['testing'],
      flows: ['checkout'],
    });
  });
});

describe('hierarchy', () => {
  it('allows at most request -> pm_task -> work tickets', async () => {
    const { request, pmTask } = await createTree(ctx.db);
    const dev = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Dev' });
    await expect(
      createSubtask(ctx.db, { type: 'dev', parentId: request.id, title: 'x' }),
    ).rejects.toMatchObject({
      code: 'INVALID_HIERARCHY',
    });
    await expect(createSubtask(ctx.db, { type: 'dev', parentId: dev.id, title: 'x' })).rejects.toMatchObject({
      code: 'INVALID_HIERARCHY',
    });
    await expect(
      createSubtask(ctx.db, {
        type: 'pm_task',
        parentId: pmTask.id,
        projectId: pmTask.projectId ?? '',
        title: 'x',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_HIERARCHY' });
  });

  it('rejects children of closed parents', async () => {
    const { pmTask } = await createTree(ctx.db);
    await setStatus(ctx.db, pmTask.id, 'cancelled');
    await expect(
      createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'x' }),
    ).rejects.toMatchObject({
      code: 'PARENT_CLOSED',
    });
  });

  it('requires dependsOn to reference siblings', async () => {
    const { pmTask, request } = await createTree(ctx.db);
    const docs = await createSubtask(ctx.db, { type: 'docs_init', parentId: pmTask.id, title: 'Docs init' });
    const dev = await createSubtask(ctx.db, {
      type: 'dev',
      parentId: pmTask.id,
      title: 'Dev',
      dependsOn: [docs.id],
    });
    expect(docs.assigneeRole).toBe('dev');
    expect(dev.dependsOn).toEqual([docs.id]);
    await expect(
      createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'x', dependsOn: [request.id] }),
    ).rejects.toMatchObject({ code: 'INVALID_DEPENDENCY' });
  });
});

describe('qc tickets', () => {
  it('pairs with a dev ticket, depends on it, and carries the platform UI-test MCP', async () => {
    const { pmTask } = await createTree(ctx.db);
    const { dev, qc } = await createDevWithQc(ctx.db, pmTask.id);
    expect(qc).toMatchObject({ assigneeRole: 'qc', pairsWith: dev.id, dependsOn: [dev.id] });
    expect(qc.requiredMcps).toEqual(['playwright']);
  });

  it.each([
    ['mobile', ['maestro']],
    ['web_mobile', ['sim-maestro', 'playwright']],
    ['backend', []],
  ] as const)(
    'uses the %s default MCP servers through the ui_test_mcp mapping',
    async (platform, expected) => {
      const { pmTask, project } = await createTree(ctx.db, { platform });
      if (platform === 'web_mobile') {
        await updateProject(ctx.db, project.id, {
          uiTestMcp: { maestro: 'sim-maestro', playwright: 'playwright' },
        });
      }
      const dev = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Dev' });
      const qc = await createSubtask(ctx.db, {
        type: 'qc',
        parentId: pmTask.id,
        title: 'QC',
        pairsWith: dev.id,
        requiredMcps: ['figma'],
      });
      expect(qc.requiredMcps.sort()).toEqual(['figma', ...expected].sort());
    },
  );

  it('requires pairsWith and allows only one live QC ticket per dev ticket', async () => {
    const { pmTask } = await createTree(ctx.db);
    const { dev } = await createDevWithQc(ctx.db, pmTask.id);
    await expect(
      createSubtask(ctx.db, { type: 'qc', parentId: pmTask.id, title: 'QC' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      createSubtask(ctx.db, { type: 'qc', parentId: pmTask.id, title: 'QC 2', pairsWith: dev.id }),
    ).rejects.toMatchObject({ code: 'QC_ALREADY_PAIRED' });
    await expect(
      createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'x', pairsWith: dev.id }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('projects', () => {
  it('rejects duplicate keys and the reserved AST key', async () => {
    await createTestProject(ctx.db);
    await expect(createTestProject(ctx.db)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      createProject(ctx.db, {
        key: 'AST',
        name: 'x',
        description: 'x',
        repoUrl: 'https://github.com/x/y',
        platform: 'web',
      }),
    ).rejects.toThrow();
  });

  it('defaults budgets to no limit and the child cap to 12', async () => {
    const project = await createTestProject(ctx.db);
    expect(project).toMatchObject({
      maxChildrenPerTicket: 12,
      ticketTreeBudgetUsd: null,
      dailyBudgetUsd: null,
      docsStatus: 'unknown',
      uiTestMcp: { maestro: 'maestro', playwright: 'playwright' },
    });
  });
});

describe('reads', () => {
  it('filters by project, status, type, role, flow and free text', async () => {
    const { pmTask, project } = await createTree(ctx.db);
    const dev = await createSubtask(ctx.db, {
      type: 'dev',
      parentId: pmTask.id,
      title: 'Giỏ hàng 100%_done',
      flows: ['cart'],
    });
    await createSubtask(ctx.db, {
      type: 'dev',
      parentId: pmTask.id,
      title: 'Thanh toán',
      flows: ['checkout'],
    });

    const byFlow = await listTickets(ctx.db, { flow: 'cart' });
    expect(byFlow.items.map((t) => t.id)).toEqual([dev.id]);

    const byText = await listTickets(ctx.db, { q: '100%_' });
    expect(byText.items.map((t) => t.id)).toEqual([dev.id]);
    expect((await listTickets(ctx.db, { q: '%%' })).items).toHaveLength(0);

    const byKey = await listTickets(ctx.db, { q: dev.key.toLowerCase() });
    expect(byKey.items.map((t) => t.id)).toEqual([dev.id]);

    const devs = await listTickets(ctx.db, {
      projectId: project.id,
      type: 'dev',
      role: 'dev',
      status: 'todo',
    });
    expect(devs.items).toHaveLength(2);
    const active = await listTickets(ctx.db, { status: 'in_progress,needs_input' });
    expect(active.items.map((t) => t.type).sort()).toEqual(['pm_task', 'request']);
  });

  it('paginates with a stable cursor for every sort', async () => {
    for (let i = 0; i < 7; i++) {
      await createRequestTicket(ctx.db, { title: `Yêu cầu ${i}`, priority: i % 2 ? 'high' : 'low' });
    }
    for (const sort of ['createdAt', 'updatedAt', 'priority', 'title'] as const) {
      for (const order of ['asc', 'desc'] as const) {
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await listTickets(ctx.db, { sort, order, limit: 3, cursor });
          seen.push(...page.items.map((t) => t.id));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        expect(new Set(seen).size).toBe(7);
      }
    }
    await expect(listTickets(ctx.db, { cursor: 'garbage' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('returns the ticket detail with children, comments, report and events', async () => {
    const { pmTask } = await createTree(ctx.db);
    await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Dev' });
    await addComment(ctx.db, {
      ticketId: pmTask.id,
      body: 'Câu hỏi?',
      authorKind: 'agent',
      authorRole: 'pm',
    });
    const detail = await getTicketDetail(ctx.db, pmTask.key);
    expect(detail.ticket.id).toBe(pmTask.id);
    expect(detail.children).toHaveLength(1);
    expect(detail.comments[0]).toMatchObject({ authorKind: 'agent', authorRole: 'pm', body: 'Câu hỏi?' });
    expect(detail.report).toBeNull();
    expect(detail.events.map((e) => e.type)).toContain('ticket.assigned');
    await expect(getTicketDetail(ctx.db, 'WEB-999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('quick search returns tickets by key or title with the exact key first', async () => {
    const first = await createRequestTicket(ctx.db, { title: 'Sửa đăng nhập' });
    for (let i = 0; i < 12; i++) await createRequestTicket(ctx.db, { title: `AST-1 liên quan ${i}` });
    const result = await search(ctx.db, 'ast-1');
    expect(result.tickets).toHaveLength(10);
    expect(result.tickets[0]?.id).toBe(first.id);
    expect(result.docs).toEqual([]);
  });
});
