import type { Ticket, TicketDetailResponse, TicketType } from '@crew/shared';
import { canTransition, RoleStage } from '@crew/shared';
import { describe, expect, it } from 'vitest';
import { loadPrompt, renderPrompt } from '../src/roles/prompt-templates.js';
import { FAILURE_PATHS, resolveStage, STAGES } from '../src/roles/role-registry.js';
import { StateDb } from '../src/state-db.js';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    key: 'WEB-1',
    title: 't',
    description: '',
    type: 'dev',
    parentId: null,
    projectId: null,
    projectHintId: null,
    assigneeRole: 'dev',
    assigneeMachineId: null,
    status: 'todo',
    priority: 'medium',
    allowConfigChange: false,
    complexity: null,
    complexityReason: null,
    model: null,
    effort: null,
    requiredSkills: [],
    requiredMcps: [],
    dependsOn: [],
    pairsWith: null,
    originDevId: null,
    bugCycle: 0,
    flows: [],
    agentSessionId: null,
    agentModel: null,
    agentEffort: null,
    costUsd: 0,
    budgetHold: null,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
    ...overrides,
  };
}

const detail = (t: Ticket, children: Ticket[] = []): TicketDetailResponse => ({
  ticket: t,
  children,
  comments: [],
  report: null,
  events: [],
});

describe('role contracts', () => {
  it('every status path of every stage is legal for an agent', () => {
    for (const contract of Object.values(STAGES)) {
      for (const path of [...contract.paths, ...FAILURE_PATHS]) {
        for (let i = 0; i + 1 < path.length; i++) {
          const from = path[i] as NonNullable<(typeof path)[number]>;
          const to = path[i + 1] as NonNullable<(typeof path)[number]>;
          expect(canTransition('agent', from, to), `${contract.stage}: ${from} → ${to}`).toBe(true);
        }
      }
    }
    // Every stage the shared contract names has a contract here.
    expect(Object.keys(STAGES).sort()).toEqual([...RoleStage.options].sort());
  });

  it('every role prompt carries the preflight, docs-first, language, injection and report rules', () => {
    const vars = new Proxy<Record<string, string>>({}, { get: (_t, key) => `<${String(key)}>` });
    for (const contract of Object.values(STAGES)) {
      const raw = loadPrompt(contract.prompt);
      expect(raw, contract.prompt).toContain('{{> _capability-preflight}}');
      const text = renderPrompt(contract.prompt, vars);
      expect(text, contract.prompt).toContain('select_capabilities');
      expect(text, contract.prompt).toContain('tiếng Việt');
      expect(text, contract.prompt).toContain('<untrusted-data>');
      expect(text, contract.prompt).toContain('ask_owner');
      expect(text, contract.prompt).not.toMatch(/\{\{/);
      if (contract.stage !== 'assistant_triage' && contract.stage !== 'assistant_close') {
        expect(text, `${contract.prompt} docs-first`).toContain('docs/index.md');
      }
      if (['assistant_close', 'pm_accept', 'docs_update', 'qc', 'docs_init'].includes(contract.stage)) {
        expect(text, `${contract.prompt} report schema`).toContain('submit_report');
      }
    }
    for (const prompt of ['dev', 'qc']) {
      const text = renderPrompt(prompt, vars);
      expect(text).toContain('$TMPDIR');
      expect(text).toMatch(/dừng mọi tiến trình/);
    }
    expect(renderPrompt('dev', vars)).toContain('handoff_docs');
    expect(renderPrompt('docs-update', vars)).toContain('return_to_dev');
    expect(renderPrompt('pm-accept', vars)).toContain('Dọn dẹp tài nguyên');
    expect(renderPrompt('pm-accept', vars)).toContain('merge_and_push');
    expect(renderPrompt('pm-analyze', vars)).toContain('resource_report');
    expect(renderPrompt('pm-analyze', vars)).toContain('pairsWith');
  });

  it('refuses a variable without a value, and never expands template text inside a value', () => {
    expect(() => renderPrompt('dev', {})).toThrow(/no value/);
    const vars = new Proxy<Record<string, string>>(
      {},
      { get: (_t, key) => (key === 'header' ? '{{notes}} {{> dev}}' : '') },
    );
    expect(renderPrompt('dev', vars)).toContain('{{notes}} {{> dev}}');
  });

  it('resolves the stage from the ticket, its children and the job kind', () => {
    const state = new StateDb(':memory:');
    const job = { id: 'job-1' };
    const at = (type: TicketType, children: Ticket[] = [], kind: 'agent' | 'docs_update' = 'agent') =>
      resolveStage({ job, kind, detail: detail(ticket({ type }), children), state });

    expect(at('request')).toBe('assistant_triage');
    expect(at('request', [ticket({ type: 'pm_task', status: 'in_progress' })])).toBe('assistant_triage');
    expect(at('request', [ticket({ type: 'pm_task', status: 'done' })])).toBe('assistant_close');
    expect(at('pm_task')).toBe('pm_analyze');
    expect(at('pm_task', [ticket({ type: 'docs_init', status: 'done' })])).toBe('pm_analyze');
    expect(at('pm_task', [ticket({ type: 'dev', status: 'in_progress' })])).toBe('pm_monitor');
    expect(
      at('pm_task', [ticket({ type: 'dev', status: 'done' }), ticket({ type: 'qc', status: 'cancelled' })]),
    ).toBe('pm_accept');
    expect(at('dev')).toBe('dev');
    expect(at('bug', [], 'docs_update')).toBe('docs_update');
    expect(at('qc')).toBe('qc');
    expect(at('docs_init')).toBe('docs_init');
  });

  it('keeps the PM on analyze until a breakdown run finished (owner question, cap, crash)', () => {
    const state = new StateDb(':memory:');
    const pm = ticket({ type: 'pm_task', status: 'in_progress' });
    const children = [ticket({ type: 'dev', status: 'todo' })];
    const first = state.insertJob({
      ticketId: pm.id,
      projectId: null,
      role: 'pm',
      trigger: 'ticket.assigned',
    });
    state.updateJob(first.id, { stage: 'pm_analyze', status: 'done', askedOwner: true });
    const next = state.insertJob({
      ticketId: pm.id,
      projectId: null,
      role: 'pm',
      trigger: 'ticket.comment_added',
    });
    const stage = () => resolveStage({ job: next, kind: 'agent', detail: detail(pm, children), state });
    // The first run created a subtask, then asked the owner: the answer continues the breakdown.
    expect(stage()).toBe('pm_analyze');
    state.updateJob(next.id, { stage: 'pm_analyze', status: 'done' });
    const later = state.insertJob({
      ticketId: pm.id,
      projectId: null,
      role: 'pm',
      trigger: 'child.resources',
    });
    expect(resolveStage({ job: later, kind: 'agent', detail: detail(pm, children), state })).toBe(
      'pm_monitor',
    );
    // A job restarted after a crash mid-breakdown stays on analyze.
    const crashed = state.insertJob({
      ticketId: 'other',
      projectId: null,
      role: 'pm',
      trigger: 'ticket.assigned',
    });
    state.updateJob(crashed.id, { stage: 'pm_analyze', status: 'queued', resumeMode: 'restart_resume' });
    const pm2 = ticket({ id: 'other', type: 'pm_task', status: 'triage' });
    expect(resolveStage({ job: crashed, kind: 'agent', detail: detail(pm2, children), state })).toBe(
      'pm_analyze',
    );
  });
});
