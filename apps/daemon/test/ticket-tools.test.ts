import { describe, expect, it } from 'vitest';
import { VpsClient, VpsError } from '../src/api/vps-client.js';
import { StateDb } from '../src/state-db.js';
import {
  type AnyToolDefinition,
  buildTicketTools,
  JobWriter,
  type TicketToolContext,
} from '../src/tools/ticket-mcp-server.js';
import { allowedToolsFor, ticketToolsFor } from '../src/tools/tool-scopes.js';
import { commentsOf, devTicket, fixture, getTicket, pmTask, useApi } from './helpers/api.js';

const api = useApi();

describe('tool scopes', () => {
  it('gives each role its own ticket tools', () => {
    const extras = (
      role: Parameters<typeof ticketToolsFor>[0],
      kind: Parameters<typeof ticketToolsFor>[1] = 'agent',
    ) => ticketToolsFor(role, kind).slice(8);
    expect(ticketToolsFor('dev', 'agent').slice(0, 8)).toEqual([
      'get_ticket',
      'list_children',
      'comment',
      'ask_owner',
      'update_status',
      'submit_report',
      'docs_flow',
      'docs_where',
    ]);
    expect(extras('pm')).toEqual(['create_subtask', 'resource_report', 'cleanup_resources']);
    expect(extras('qc')).toEqual(['file_bug']);
    expect(extras('dev')).toEqual(['handoff_docs']);
    expect(extras('dev', 'docs_update')).toEqual([]);
    expect(extras('assistant')).toEqual(['get_project_catalog', 'create_pm_ticket']);
  });

  it('allows every tool of each enabled inventory MCP server, never a disabled one', () => {
    const tools = allowedToolsFor({
      role: 'qc',
      kind: 'agent',
      mcpServers: ['playwright', 'claude.ai Figma', 'maestro'],
      disabledMcpServers: ['maestro'],
    });
    expect(tools).toContain('mcp__playwright__*');
    expect(tools).toContain('mcp__claude_ai_Figma__*');
    expect(tools).not.toContain('mcp__maestro__*');
    expect(tools).toContain('mcp__tickets__file_bug');
    expect(tools).not.toContain('mcp__tickets__create_subtask');
    expect(allowedToolsFor({ role: 'assistant', kind: 'agent', mcpServers: [] })).not.toContain('Bash');
  });
});

function tools(
  ctx: Partial<TicketToolContext> & Pick<TicketToolContext, 'vps' | 'state' | 'jobId' | 'ticketId' | 'role'>,
) {
  const ended: string[] = [];
  const list = buildTicketTools({
    kind: 'agent',
    cwd: '/',
    crewDocs: null,
    contextBlock: async () => ({ machine: 'test' }),
    inventory: () => ({ skills: [], mcpServers: [] }),
    reportFields: async () => ({
      skillsUsed: [],
      skillsMissing: [],
      mcpsUsed: [],
      mcpsMissing: [],
      docsFirst: true,
      leftResources: false,
    }),
    requestEnd: (reason) => ended.push(reason),
    ...ctx,
  });
  const call = async (name: string, args: Record<string, unknown>) => {
    const definition = list.find((tool) => tool.name === name) as AnyToolDefinition;
    const { z } = await import('zod');
    return definition.handler(z.object(definition.inputSchema).parse(args), {});
  };
  return { list, call, ended };
}

describe('ticket MCP tools against the real API', () => {
  it('comments with secrets scrubbed, asks the owner and ends the run', async () => {
    const f = await fixture(api);
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id);
    const state = new StateDb(':memory:');
    const job = state.insertJob({ ticketId: dev.id, projectId: f.projectId, role: 'dev', trigger: 't' });
    const vps = new VpsClient({ apiUrl: f.server.url, token: () => f.machine.token });
    const t = tools({ vps, state, jobId: job.id, ticketId: dev.id, role: 'dev' });
    expect(t.list.map((tool) => tool.name)).toContain('handoff_docs');
    expect(t.list.map((tool) => tool.name)).not.toContain('create_subtask');

    const fakeKey = `ghp_${'a1B2'.repeat(9)}`;
    await t.call('comment', { body: `Token lỡ dán: ${fakeKey}` });
    await t.call('update_status', { to: 'in_progress' });
    const asked = await t.call('ask_owner', { question: 'Màu nút là gì?' });
    expect(asked.isError).toBeFalsy();
    expect(t.ended).toEqual(['ask_owner']);
    expect((await getTicket(api.db, dev.id)).status).toBe('needs_input');
    const bodies = (await commentsOf(api.db, dev.id)).map((c) => c.body);
    expect(bodies[0]).toContain('[đã ẩn: github-token]');
    expect(bodies[0]).not.toContain(fakeKey);
    expect(bodies).toContain('Màu nút là gì?');
    expect(state.getJob(job.id)?.askedOwner).toBe(true);
    // Four writes, four committed keys.
    expect(state.getJob(job.id)?.toolSeq).toBe(4);

    const refused = await t.call('update_status', { to: 'done' });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toMatch(/ILLEGAL_TRANSITION|REPORT_REQUIRED/);
  });

  it('records a docs handoff on the job and ends the run', async () => {
    const f = await fixture(api);
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id);
    const state = new StateDb(':memory:');
    const job = state.insertJob({ ticketId: dev.id, projectId: f.projectId, role: 'dev', trigger: 't' });
    const vps = new VpsClient({ apiUrl: f.server.url, token: () => f.machine.token });
    const t = tools({ vps, state, jobId: job.id, ticketId: dev.id, role: 'dev' });
    await t.call('handoff_docs', {
      summaryMd: 'Thêm API giỏ hàng',
      files: ['src/cart.ts'],
      tests: ['test/cart.test.ts'],
      flows: ['cart'],
    });
    expect(t.ended).toEqual(['handoff_docs']);
    expect(state.getJob(job.id)?.handoff).toEqual({
      summaryMd: 'Thêm API giỏ hàng',
      files: ['src/cart.ts'],
      tests: ['test/cart.test.ts'],
      flows: ['cart'],
    });
  });

  it('PM creates subtasks idempotently: a lost response re-sent after a restart creates one ticket', async () => {
    const f = await fixture(api);
    const pm = await pmTask(api, f);
    const state = new StateDb(':memory:');
    const job = state.insertJob({ ticketId: pm.id, projectId: f.projectId, role: 'pm', trigger: 't' });
    const real = new VpsClient({ apiUrl: f.server.url, token: () => f.machine.token });
    // The server commits the write, then the answer is lost (the daemon dies before reading it).
    let lose = true;
    const lossy = new VpsClient({
      apiUrl: f.server.url,
      token: () => f.machine.token,
      attempts: 1,
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (lose && init?.method === 'POST') {
          lose = false;
          throw new Error('connection reset');
        }
        return response;
      },
    });
    const body = { type: 'dev', title: 'Làm giỏ hàng', parentId: pm.id } as const;
    const before = new JobWriter(state, job.id);
    await expect(before.write((key) => lossy.createSubtask(body, key))).rejects.toBeInstanceOf(VpsError);
    expect(state.getJob(job.id)?.toolSeq).toBe(0);

    // After the restart the same call goes out again with the same key.
    const after = new JobWriter(state, job.id);
    const created = await after.write((key) => real.createSubtask(body, key));
    const detail = await real.getTicket(pm.id);
    expect(detail.children.filter((child) => child.title === 'Làm giỏ hàng')).toHaveLength(1);
    expect(detail.children[0]?.id).toBe(created.id);
    expect(state.getJob(job.id)?.toolSeq).toBe(1);

    // A different body under a used key moves on to the next key instead of failing.
    state.updateJob(job.id, { toolSeq: 0 });
    const other = await after.write((key) => real.createSubtask({ ...body, title: 'Làm thanh toán' }, key));
    expect(other.title).toBe('Làm thanh toán');
    expect(state.getJob(job.id)?.toolSeq).toBe(2);
  });

  it('refuses PM-only resource tools to a context without resource access', async () => {
    const f = await fixture(api);
    const pm = await pmTask(api, f);
    const state = new StateDb(':memory:');
    const job = state.insertJob({ ticketId: pm.id, projectId: f.projectId, role: 'pm', trigger: 't' });
    const vps = new VpsClient({ apiUrl: f.server.url, token: () => f.machine.token });
    const t = tools({ vps, state, jobId: job.id, ticketId: pm.id, role: 'pm' });
    expect((await t.call('resource_report', {})).isError).toBe(true);
    const detail = await t.call('get_ticket', {});
    expect(JSON.parse((detail.content[0] as { text: string }).text)).toMatchObject({
      ticket: { id: pm.id },
      context: { machine: 'test' },
    });
  });
});
