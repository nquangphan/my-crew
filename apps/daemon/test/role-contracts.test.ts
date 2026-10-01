import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Ticket, TicketDetailResponse, TicketType } from '@crew/shared';
import {
  canTransition,
  DEFAULT_GUARD_POLICY,
  RoleStage,
  TEST_KIND_INFO,
  TestKind,
  validatePromptTemplate,
} from '@crew/shared';
import { describe, expect, it } from 'vitest';
import { loadPrompt, renderPrompt } from '../src/roles/prompt-templates.js';
import { DOCS_ONLY_QC_NOTE, testKindsText, testPlanText } from '../src/roles/role-planner.js';
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
    testKinds: null,
    testReason: null,
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

  /** Placeholder values for every variable but the ones a test renders for real. */
  const varsWith = (real: Record<string, string>) =>
    new Proxy<Record<string, string>>(real, { get: (t, key) => t[String(key)] ?? `<${String(key)}>` });
  const LEGACY_UI_TEXT =
    'Kiểm thử UI bằng MCP bắt buộc khi diff đổi file nguồn (diff chỉ đổi docs thì review tĩnh là đủ): ';

  it('the QC prompt follows the PM test plan and names a UI-test MCP server only for a UI kind', () => {
    const render = (qc: Ticket, uiTest = true) =>
      renderPrompt('qc', varsWith({ test_plan: testPlanText(qc, uiTest, DEFAULT_GUARD_POLICY) }));
    const reason = 'Chỉ đổi route và truy vấn, không có giao diện';

    // No UI kind: the plan kind by kind from the shared table, the PM's reason as data, and no UI MCP.
    const apiOnly = render(
      ticket({ type: 'qc', key: 'WEB-7', testKinds: ['api', 'integration'], testReason: reason }),
    );
    expect(apiOnly).toContain('4. Kiểm thử theo **phương án PM đã chọn** cho ticket này');
    for (const kind of ['api', 'integration'] as const) {
      const { label, tooling } = TEST_KIND_INFO[kind];
      expect(apiOnly).toContain(`   - \`${kind}\` (${label}): ${tooling}.`);
    }
    expect(apiOnly).toContain(
      `<untrusted-data source="ticket WEB-7 testReason">\n${reason}\n</untrusted-data>`,
    );
    expect(apiOnly).toContain('không cần MCP kiểm thử UI nào');
    expect(apiOnly).not.toMatch(/`(playwright|maestro)`/i);
    expect(apiOnly).not.toContain(LEGACY_UI_TEXT);
    expect(apiOnly).not.toContain('`unit`');
    // The report names every kind that ran.
    expect(apiOnly).toContain('**từng loại kiểm thử đã chạy**');

    // ui_web: Playwright, with the same instruction as before; ui_mobile: Maestro.
    const web = render(
      ticket({ type: 'qc', testKinds: ['ui_web', 'api'], testReason: reason, requiredMcps: ['playwright'] }),
    );
    expect(web).toContain(`\`ui_web\` (${TEST_KIND_INFO.ui_web.label})`);
    expect(web).toContain(
      '`playwright` (Playwright): mở ứng dụng và kiểm tra từng tiêu chí nghiệm thu. Server chạy headless/nền (không chiếm màn hình máy) nên bạn sẽ không thấy cửa sổ trình duyệt thật — đừng kỳ vọng điều đó, cứ dựa vào accessibility snapshot/kết quả tool trả về.',
    );
    expect(web).toContain('Ghi lại flow hoặc script đã chạy và kết quả của chúng trong report.');
    expect(web).not.toMatch(/maestro/i);
    const mobile = render(
      ticket({ type: 'qc', testKinds: ['ui_mobile'], testReason: reason, requiredMcps: ['maestro'] }),
    );
    expect(mobile).toContain('`maestro` (Maestro): chạy app trên simulator/emulator');

    // A QC ticket from before test plans (testKinds null) keeps the older text, word for word.
    const legacy = render(ticket({ type: 'qc', requiredMcps: ['playwright'] }));
    expect(legacy).toContain(
      `4. ${LEGACY_UI_TEXT}\n   - \`playwright\` (Playwright): mở ứng dụng và kiểm tra từng tiêu chí nghiệm thu. Server chạy headless/nền (không chiếm màn hình máy) nên bạn sẽ không thấy cửa sổ trình duyệt thật — đừng kỳ vọng điều đó, cứ dựa vào accessibility snapshot/kết quả tool trả về.\n   Ghi lại flow hoặc script đã chạy và kết quả của chúng trong report.`,
    );
    expect(legacy).not.toContain('phương án PM đã chọn');
    expect(render(ticket({ type: 'qc' }))).toContain(
      `4. ${LEGACY_UI_TEXT}ticket không yêu cầu MCP kiểm thử UI (dự án backend hoặc thư viện).`,
    );
    // So does the QC of a docs-only diff, plan or not.
    const docsOnly = render(
      ticket({ type: 'qc', testKinds: ['ui_web'], testReason: reason, requiredMcps: ['playwright'] }),
      false,
    );
    expect(docsOnly).toContain(`4. ${LEGACY_UI_TEXT}không cần: diff chỉ đổi docs`);
    expect(docsOnly).toContain(DOCS_ONLY_QC_NOTE);
    expect(docsOnly).not.toContain('phương án PM đã chọn');
  });

  it('the PM prompts carry the test-plan analysis, with the kind table rendered from the shared source', () => {
    const analyze = renderPrompt('pm-analyze', varsWith({ test_kinds: testKindsText('web') }));
    expect(analyze).toContain('### Phương án kiểm thử của QC');
    expect(analyze).toContain('Xem subtask dev đổi gì: route/service/DB của API, logic daemon, CLI');
    // Kind ↔ tooling table: one row per kind, label and tooling straight from TEST_KIND_INFO.
    for (const kind of TestKind.options) {
      const { label, tooling, uiRole } = TEST_KIND_INFO[kind];
      const row = analyze.split('\n').find((line) => line.startsWith(`| \`${kind}\` |`));
      expect(row, kind).toContain(`| ${label} | ${tooling} |`);
      expect(row?.endsWith('| không |'), kind).toBe(uiRole === null);
    }
    // The rules for the UI kinds and the section every QC description needs.
    expect(analyze).toContain('Chỉ chọn `ui_web`/`ui_mobile` khi thay đổi có **giao diện chạy được**');
    expect(analyze).toContain('Thay đổi có giao diện thì **phải** có loại UI tương ứng');
    expect(analyze).toContain('Không chọn loại UI mà platform của dự án không có');
    expect(analyze).toContain(
      'Dự án này có platform `web`: loại UI dùng được là `ui_web` (server từ chối `ui_mobile`).',
    );
    expect(analyze).toContain('## Phương án kiểm thử\n');
    for (const line of [
      '- Loại kiểm thử:',
      '- Công cụ / lệnh:',
      '- Công cụ UI:',
      '- Tiêu chí nghiệm thu ↔ cách kiểm:',
    ]) {
      expect(analyze).toContain(line);
    }
    expect(analyze).toContain('`testKinds` và `testReason`: **bắt buộc với `qc`**');
    expect(analyze).toContain('plan_qc_test');
    // The server no longer adds a default UI-test MCP server to every QC.
    expect(analyze).not.toContain('server tự thêm');
    expect(analyze).not.toContain('MCP kiểm thử UI mặc định');
    expect(analyze).not.toContain('kiểm 3 flow UI bằng Playwright');

    expect(testKindsText('backend')).toContain(
      'Dự án này có platform `backend`: không có loại UI nào dùng được (server từ chối `ui_web`, `ui_mobile`).',
    );
    expect(testKindsText('web_mobile')).toContain(
      'loại UI dùng được là `ui_web`, `ui_mobile` (mọi loại UI đều dùng được).',
    );
    expect(testKindsText(null)).toContain('Server từ chối loại UI mà platform của dự án không hỗ trợ.');

    // The monitor stage knows how to free a QC stuck on a UI-test MCP server it should never have needed.
    const monitor = renderPrompt('pm-monitor', varsWith({ test_kinds: testKindsText('web') }));
    expect(monitor).toContain('QC `blocked` vì MCP kiểm thử UI chưa kết nối');
    expect(monitor).toContain('Gọi `plan_qc_test` trên ticket QC');
    expect(monitor).toContain('`plan_qc_test` không mở chặn ticket');
    expect(monitor).toContain('thì gọi `retry_subtask` ngay sau đó');
    expect(monitor).toContain(`| \`api\` | ${TEST_KIND_INFO.api.label} |`);
  });

  it('keeps the test-kind labels and tooling in the shared table only, and every bundled prompt valid', () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((file) =>
      /\.(ts|md)$/.test(file),
    );
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      const text = readFileSync(join(src, file), 'utf8');
      for (const kind of TestKind.options) {
        expect(text.includes(TEST_KIND_INFO[kind].label), `${file} copies the label of ${kind}`).toBe(false);
        expect(text.includes(TEST_KIND_INFO[kind].tooling), `${file} copies the tooling of ${kind}`).toBe(
          false,
        );
      }
    }
    // The new variables are declared where the web editor and the daemon validate a prompt.
    for (const contract of Object.values(STAGES)) {
      expect(validatePromptTemplate(contract.prompt, loadPrompt(contract.prompt)), contract.prompt).toEqual(
        [],
      );
    }
    expect(loadPrompt('qc')).toContain('{{test_plan}}');
    expect(loadPrompt('pm-analyze')).toContain('{{test_kinds}}');
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
