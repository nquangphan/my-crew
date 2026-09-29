import { join } from 'node:path';
import type { Report, Ticket } from '@crew/shared';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { ensureWorktree } from '../src/git/worktree-manager.js';
import {
  acceptanceViolations,
  mergeAndPush,
  mergeOrder,
  takeOurs,
  type WorkItem,
} from '../src/roles/merge-policy.js';
import { git, writeFiles } from './helpers/git.js';
import { bundlePath, makeWorkflowRepo } from './helpers/workflow.js';

let seq = 0;
function ticket(overrides: Partial<Ticket> = {}): Ticket {
  seq += 1;
  return {
    id: `t-${seq}`,
    key: `WEB-${seq}`,
    title: `ticket ${seq}`,
    description: '',
    type: 'dev',
    parentId: 'pm',
    projectId: 'p',
    projectHintId: null,
    assigneeRole: 'dev',
    assigneeMachineId: null,
    status: 'done',
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
    createdAt: `2026-09-29T00:00:${String(seq).padStart(2, '0')}.000Z`,
    updatedAt: '2026-09-29T00:00:00.000Z',
    ...overrides,
  };
}

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: 'r',
    ticketId: 't',
    version: 1,
    isCurrent: true,
    summaryMd: 'ok',
    filesChanged: [],
    commits: [],
    headSha: 'a'.repeat(40),
    skillsSelected: [],
    mcpsSelected: [],
    skillsUsed: [],
    skillsMissing: [],
    mcpsUsed: [],
    mcpsMissing: [],
    docsFirst: true,
    testsRun: [],
    bugsFiled: [],
    leftResources: false,
    costUsd: 0,
    createdAt: '2026-09-29T00:00:00.000Z',
    ...overrides,
  };
}

const item = (t: Ticket, r: Partial<Report> = {}): WorkItem => ({
  ticket: t,
  report: report(r),
  headSha: r.headSha ?? 'a'.repeat(40),
});

describe('merge policy rules', () => {
  it('keeps ours inside conflict blocks and the clean hunks of both sides', () => {
    const text =
      'a\n<<<<<<< HEAD\nours\n||||||| base\nold\n=======\ntheirs\n>>>>>>> x\nb\n<<<<<<< HEAD\n=======\nt2\n>>>>>>> x\nc';
    expect(takeOurs(text)).toBe('a\nours\nb\nc');
  });

  it('orders docs-init first, then dependencies, then each bug after its chain', () => {
    const init = ticket({ type: 'docs_init' });
    const b = ticket({ title: 'B' });
    const a = ticket({ title: 'A', dependsOn: [b.id] });
    const bug = ticket({ type: 'bug', originDevId: a.id, bugCycle: 1 });
    const bug2 = ticket({ type: 'bug', originDevId: a.id, bugCycle: 2 });
    const order = mergeOrder([bug2, bug, a, b, init].map((t) => item(t)));
    expect(order.map((i) => i.ticket.id)).toEqual([init.id, b.id, a.id, bug.id, bug2.id]);
  });

  it('rejects docs_first=false always and missing skills or left resources unless excepted', () => {
    const dev = ticket();
    const other = ticket();
    const items = [
      item(dev, { docsFirst: false }),
      item(other, { skillsMissing: ['api-design'], leftResources: true }),
    ];
    const all = acceptanceViolations(items, [dev, other], []);
    expect(all.map((v) => [v.ticketKey, v.reason])).toEqual([
      [dev.key, 'docs_first'],
      [other.key, 'skills_missing'],
      [other.key, 'left_resources'],
    ]);
    const excepted = acceptanceViolations(
      items,
      [dev, other],
      [{ ticketId: other.id, reason: 'đã giải thích' }],
    );
    expect(excepted.map((v) => v.reason)).toEqual(['docs_first']);
    // A later bug of the chain that is done carried the fix: the old violation is waived.
    const fix = ticket({ type: 'bug', originDevId: dev.id, bugCycle: 1 });
    expect(acceptanceViolations(items.slice(0, 1), [dev, fix], [])).toEqual([]);
  });
});

describe('merge and push (real git, real crew-docs, bare origin)', () => {
  function setup() {
    const { repo, remote } = makeWorkflowRepo({ docs: true });
    const project = parseConfig({
      apiUrl: 'http://127.0.0.1:1',
      machineName: 'm',
      projects: [{ key: 'WEB', repoPath: repo, testCommand: 'node --test' }],
    }).projects[0] as NonNullable<ReturnType<typeof parseConfig>['projects'][number]>;
    const branch = (key: string, files: Record<string, string>, extra: string[] = []) => {
      const wt = ensureWorktree({ repo, key, base: 'main' });
      writeFiles(wt.path, files);
      git(wt.path, 'add', '-A');
      git(wt.path, 'commit', '-q', ...extra, '-m', `change ${key}`);
      return git(wt.path, 'rev-parse', 'HEAD').trim();
    };
    const pm = ensureWorktree({ repo, key: 'WEB-1', base: 'main' });
    const run = (children: Ticket[], heads: Record<string, string>) =>
      mergeAndPush({
        cwd: pm.path,
        project,
        pmKey: 'WEB-1',
        children,
        reports: new Map(children.map((c) => [c.id, report({ headSha: heads[c.id] ?? null })])),
        exceptions: [],
        crewDocs: { bundle: bundlePath(), runtime: process.execPath },
        syncDocs: async () => {},
      });
    return { repo, remote, branch, run };
  }

  it('does not push when the tests fail on the merged tree', async () => {
    const { remote, branch, run } = setup();
    const before = git(remote, 'rev-parse', 'main').trim();
    const dev = ticket();
    const head = branch('WEB-2', {
      'test/fail.test.js': "require('node:test')('x', () => { throw new Error('hỏng'); });\n",
    });
    const outcome = await run([dev], { [dev.id]: head });
    expect(outcome.status).toBe('gate_failed');
    if (outcome.status === 'gate_failed') expect(outcome.output).toContain('### tests');
    expect(git(remote, 'rev-parse', 'main').trim()).toBe(before);
  });

  it('does not push a protected-path change that bypassed the commit hooks', async () => {
    const { remote, branch, run } = setup();
    const before = git(remote, 'rev-parse', 'main').trim();
    const dev = ticket();
    const head = branch('WEB-3', { '.claude/settings.json': '{"permissions":{"allow":["Bash(*)"]}}\n' }, [
      '--no-verify',
    ]);
    const outcome = await run([dev], { [dev.id]: head });
    expect(outcome.status).toBe('gate_failed');
    if (outcome.status === 'gate_failed') {
      expect(outcome.gate.find((step) => step.name === 'protected-paths')?.ok).toBe(false);
      expect(outcome.gate.find((step) => step.name === 'crew-docs')?.output).toMatch(/R6/);
    }
    expect(git(remote, 'rev-parse', 'main').trim()).toBe(before);
  });

  it('returns a conflict outside the generated docs instead of merging, and leaves the worktree clean', async () => {
    const { repo, branch, run } = setup();
    const a = ticket();
    const b = ticket();
    const headA = branch('WEB-4', { 'README.md': '# Shop A\n' });
    const headB = branch('WEB-5', { 'README.md': '# Shop B\n' });
    const outcome = await run([a, b], { [a.id]: headA, [b.id]: headB });
    expect(outcome).toMatchObject({ status: 'conflict', ticketKey: b.key, files: ['README.md'] });
    expect(git(join(repo, '.crew/worktrees/WEB-1'), 'status', '--porcelain').trim()).toBe('');
  });
});
