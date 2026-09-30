import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DocsSyncRequest, Report, Ticket } from '@crew/shared';
import type { ProjectConfig } from '../config.js';
import { docsSnapshot, runCrewDocs } from '../git/docs-kit-bridge.js';
import { listWorktrees } from '../git/worktree-manager.js';
import { isProtectedPath } from '../runner/guard-hook.js';

/** A finished child whose work is merged at accept: dev, bug and docs-init tickets with a `head_sha`. */
export interface WorkItem {
  ticket: Ticket;
  report: Report;
  headSha: string;
}

export interface AcceptanceViolation {
  ticketId: string;
  ticketKey: string;
  reason: 'docs_first' | 'skills_missing' | 'left_resources';
  detail: string;
}

export interface GateStep {
  name: string;
  ok: boolean;
  output: string;
}

export type MergeOutcome =
  | {
      status: 'merged';
      merged: string[];
      alreadyIn: string[];
      head: string;
      commits: string[];
      generatedCommit: string | null;
      gate: GateStep[];
      pushed: boolean;
      remote: string | null;
      localDefault: string;
      docsSynced: boolean;
    }
  | { status: 'rejected'; violations: AcceptanceViolation[] }
  | { status: 'conflict'; ticketKey: string; files: string[]; output: string }
  | { status: 'gate_failed'; gate: GateStep[]; output: string };

/** Generated docs blocks: a conflict limited to these files is resolved by regenerating them. */
const GENERATED_DOCS = new Set(['docs/index.md', 'docs/files.md']);
const OUTPUT_LIMIT = 6_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
  timeoutMs = 300_000,
): Run {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...(env ?? process.env), GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) return { code: 2, stdout: '', stderr: result.error.message };
  return { code: result.status ?? 2, stdout: result.stdout, stderr: result.stderr };
}

const both = (r: Run) => [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n');
const clip = (text: string) => (text.length > OUTPUT_LIMIT ? `…${text.slice(-OUTPUT_LIMIT)}` : text);

function gitOut(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv): string {
  const r = run('git', args, cwd, env);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${both(r)}`);
  return r.stdout.trim();
}

const isAncestor = (cwd: string, ancestor: string, of: string) =>
  run('git', ['merge-base', '--is-ancestor', ancestor, of], cwd).code === 0;

// ---------------------------------------------------------------------------
// Acceptance rules
// ---------------------------------------------------------------------------

/** Root of a bug chain: the dev ticket every bug of the chain descends from. */
const chainRoot = (ticket: Ticket) => ticket.originDevId ?? ticket.id;

/**
 * A violation of a finished ticket is waived when a later bug of its chain is done: the PM already rejected
 * it and the bug ticket carried the fix.
 */
function waived(item: WorkItem, children: readonly Ticket[]): boolean {
  return children.some(
    (child) =>
      child.type === 'bug' &&
      child.status === 'done' &&
      chainRoot(child) === chainRoot(item.ticket) &&
      child.bugCycle > item.ticket.bugCycle,
  );
}

/**
 * What blocks a merge at accept. A dev or bug report with `docs_first=false` is always a rejection; missing
 * skills and `left_resources` (a ticket that left processes behind twice) are rejections unless the PM
 * accepts the dev's justification for that ticket.
 */
export function acceptanceViolations(
  items: readonly WorkItem[],
  children: readonly Ticket[],
  exceptions: readonly { ticketId: string; reason: string }[],
): AcceptanceViolation[] {
  const violations: AcceptanceViolation[] = [];
  for (const item of items) {
    if (item.ticket.type !== 'dev' && item.ticket.type !== 'bug') continue;
    if (waived(item, children)) continue;
    if (!item.report.docsFirst) {
      violations.push({
        ticketId: item.ticket.id,
        ticketKey: item.ticket.key,
        reason: 'docs_first',
        detail: 'đọc code trước khi đọc docs (docs_first=false)',
      });
    }
    const excepted = exceptions.some((exception) => exception.ticketId === item.ticket.id);
    if (item.report.skillsMissing.length > 0 && !excepted) {
      violations.push({
        ticketId: item.ticket.id,
        ticketKey: item.ticket.key,
        reason: 'skills_missing',
        detail: `bỏ qua skill: ${item.report.skillsMissing.join(', ')}`,
      });
    }
    if (item.report.leftResources && !excepted) {
      violations.push({
        ticketId: item.ticket.id,
        ticketKey: item.ticket.key,
        reason: 'left_resources',
        detail: 'để lại tiến trình hoặc cổng sau khi kết thúc (lần thứ hai)',
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Merge order
// ---------------------------------------------------------------------------

/**
 * Dependency order: `depends_on` among the items, and each bug after the earlier tickets of its chain.
 * Ties go docs-init first, then by chain, bug cycle and creation time, so the order is deterministic.
 */
export function mergeOrder(items: readonly WorkItem[]): WorkItem[] {
  const rank = (item: WorkItem) => [
    item.ticket.type === 'docs_init' ? 0 : 1,
    items.find((other) => other.ticket.id === chainRoot(item.ticket))?.ticket.createdAt ??
      item.ticket.createdAt,
    item.ticket.bugCycle,
    item.ticket.createdAt,
  ];
  const compare = (a: WorkItem, b: WorkItem) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return (ra[i] as number | string) < (rb[i] as number | string) ? -1 : 1;
    }
    return 0;
  };
  const ids = new Set(items.map((item) => item.ticket.id));
  const deps = new Map<string, Set<string>>();
  for (const item of items) {
    const own = new Set(item.ticket.dependsOn.filter((id) => ids.has(id)));
    for (const other of items) {
      if (
        other !== item &&
        chainRoot(other.ticket) === chainRoot(item.ticket) &&
        other.ticket.bugCycle < item.ticket.bugCycle
      ) {
        own.add(other.ticket.id);
      }
    }
    deps.set(item.ticket.id, own);
  }
  const done = new Set<string>();
  const ordered: WorkItem[] = [];
  const pending = [...items].sort(compare);
  while (pending.length > 0) {
    const index = pending.findIndex((item) =>
      [...(deps.get(item.ticket.id) ?? [])].every((id) => done.has(id)),
    );
    // A dependency cycle cannot come from the server (it only accepts existing siblings); keep going in rank order.
    const [next] = pending.splice(index < 0 ? 0 : index, 1) as [WorkItem];
    done.add(next.ticket.id);
    ordered.push(next);
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Local merge
// ---------------------------------------------------------------------------

/** Keeps "ours" inside every conflict block (clean hunks from both sides stay merged). */
export function takeOurs(text: string): string {
  const out: string[] = [];
  let state: 'clean' | 'ours' | 'base' | 'theirs' = 'clean';
  for (const line of text.split('\n')) {
    if (state === 'clean' && line.startsWith('<<<<<<<')) state = 'ours';
    else if (state === 'ours' && line.startsWith('|||||||')) state = 'base';
    else if ((state === 'ours' || state === 'base') && line.startsWith('=======')) state = 'theirs';
    else if (state === 'theirs' && line.startsWith('>>>>>>>')) state = 'clean';
    else if (state === 'clean' || state === 'ours') out.push(line);
  }
  return out.join('\n');
}

function conflictedFiles(cwd: string): string[] {
  return gitOut(cwd, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
}

type CrewDocs = { bundle: string; runtime: string };

/**
 * Merges one commit into the worktree's branch. A conflict limited to the generated docs blocks is resolved
 * by keeping ours and regenerating them from the merged `docs/flows.yaml`; any other conflict aborts.
 */
function mergeOne(
  cwd: string,
  ref: string,
  message: string,
  crewDocs: CrewDocs | null,
): { ok: true } | { ok: false; files: string[]; output: string } {
  const merge = run('git', ['merge', '--no-ff', '--no-edit', '-m', message, ref], cwd);
  if (merge.code === 0) return { ok: true };
  const files = conflictedFiles(cwd);
  if (files.length > 0 && crewDocs && files.every((file) => GENERATED_DOCS.has(file))) {
    for (const file of files) writeFileSync(join(cwd, file), takeOurs(readFileSync(join(cwd, file), 'utf8')));
    const generate = runCrewDocs(crewDocs.bundle, ['generate'], cwd, crewDocs.runtime);
    if (generate.code === 0) {
      run('git', ['add', '-A'], cwd);
      const commit = run('git', ['commit', '--no-edit'], cwd);
      if (commit.code === 0) return { ok: true };
      run('git', ['merge', '--abort'], cwd);
      return { ok: false, files, output: both(commit) };
    }
  }
  run('git', ['merge', '--abort'], cwd);
  return { ok: false, files, output: both(merge) };
}

// ---------------------------------------------------------------------------
// Pre-push gate
// ---------------------------------------------------------------------------

/**
 * Changes to protected paths need a commit carrying `Crew-Owner-Approved:` (or the docs-init commit). The
 * list is crew-docs rule R6 as shipped (the bundled path rules), not the server's editable guard policy:
 * the commit hooks enforce R6 the same way.
 */
function protectedPathCheck(cwd: string, range: string): GateStep {
  const changed = gitOut(cwd, ['diff', '--name-only', range]).split('\n').filter(Boolean);
  const touched = changed.filter((path) => isProtectedPath(path));
  if (touched.length === 0)
    return { name: 'protected-paths', ok: true, output: 'không đổi đường dẫn được bảo vệ' };
  const log = gitOut(cwd, ['log', '--no-merges', '--format=%H%x1f%B%x1e', range, '--', ...touched]);
  const bad = log
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => {
      const body = entry.slice(entry.indexOf('\x1f') + 1);
      return !/^Crew-Owner-Approved:\s*\S+/m.test(body) && !/^Crew-Docs-Init:\s*true\s*$/m.test(body);
    })
    .map((entry) => entry.slice(0, 12));
  return bad.length === 0
    ? { name: 'protected-paths', ok: true, output: `đổi ${touched.join(', ')} với trailer hợp lệ` }
    : {
        name: 'protected-paths',
        ok: false,
        output: `commit ${bad.join(', ')} đổi đường dẫn được bảo vệ (${touched.join(', ')}) mà không có trailer Crew-Owner-Approved`,
      };
}

/**
 * The pre-push gate on the merged tree: the project's `testCommand`, `crew-docs check --range` (R1–R7) and
 * the protected-path diff check. Nothing is pushed unless every step passes.
 */
export function prePushGate(input: {
  cwd: string;
  range: string;
  testCommand: string | undefined;
  crewDocs: CrewDocs | null;
  env?: NodeJS.ProcessEnv;
}): GateStep[] {
  const steps: GateStep[] = [];
  if (input.testCommand) {
    const tests = run('/bin/sh', ['-c', input.testCommand], input.cwd, input.env, 30 * 60_000);
    steps.push({ name: 'tests', ok: tests.code === 0, output: clip(both(tests)) || `exit ${tests.code}` });
  } else {
    steps.push({ name: 'tests', ok: true, output: 'dự án chưa cấu hình testCommand trên máy này' });
  }
  if (input.crewDocs) {
    const check = runCrewDocs(
      input.crewDocs.bundle,
      ['check', '--range', input.range],
      input.cwd,
      input.crewDocs.runtime,
    );
    steps.push({
      name: 'crew-docs',
      ok: check.code === 0,
      output: clip(both(check)) || `exit ${check.code}`,
    });
  } else {
    steps.push({
      name: 'crew-docs',
      ok: false,
      output: 'crew-docs chưa được cài trên máy này (chạy crewd doctor)',
    });
  }
  steps.push(protectedPathCheck(input.cwd, input.range));
  return steps;
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

/** Moves the local default branch to `head` without touching uncommitted work in the owner's checkout. */
function updateLocalDefault(repo: string, defaultBranch: string, head: string): string {
  const checkout = [...listWorktrees(repo)].find(([, branch]) => branch === defaultBranch)?.[0];
  if (checkout) {
    const dirty = run('git', ['status', '--porcelain', '--untracked-files=no'], checkout).stdout.trim();
    if (dirty)
      return `main checkout có thay đổi chưa commit, nhánh ${defaultBranch} cục bộ chưa được cập nhật`;
    const ff = run('git', ['merge', '--ff-only', head], checkout);
    return ff.code === 0
      ? `main checkout đã fast-forward lên ${head.slice(0, 12)}`
      : `không fast-forward được main checkout: ${clip(both(ff))}`;
  }
  if (!isAncestor(repo, defaultBranch, head))
    return `nhánh ${defaultBranch} cục bộ đã đi khác hướng, chưa cập nhật`;
  gitOut(repo, ['update-ref', `refs/heads/${defaultBranch}`, head]);
  return `nhánh ${defaultBranch} cục bộ đã lên ${head.slice(0, 12)}`;
}

export interface MergeAndPushInput {
  /** The PM worktree (branch `crew/<pm-key>`). */
  cwd: string;
  project: ProjectConfig;
  pmKey: string;
  children: readonly Ticket[];
  /** Current report of each finished child, by ticket id. */
  reports: ReadonlyMap<string, Report>;
  exceptions: readonly { ticketId: string; reason: string }[];
  crewDocs: CrewDocs | null;
  env?: NodeJS.ProcessEnv;
  syncDocs: (snapshot: DocsSyncRequest) => Promise<void>;
}

/**
 * PM accept: merge every finished dev, bug and docs-init `head_sha` into `crew/<pm-key>` in dependency
 * order (after bringing in the default branch), regenerate the docs blocks and commit them, run the pre-push
 * gate, push to the default branch of `origin` (the `pre-push` hook runs), move the local default branch,
 * and sync the docs snapshot. Nothing is pushed when a rule, a merge or the gate fails.
 */
export async function mergeAndPush(input: MergeAndPushInput): Promise<MergeOutcome> {
  const { cwd, project, crewDocs } = input;
  const items: WorkItem[] = input.children
    .filter((child) => ['dev', 'bug', 'docs_init'].includes(child.type) && child.status === 'done')
    .flatMap((ticket) => {
      const report = input.reports.get(ticket.id);
      return report?.headSha ? [{ ticket, report, headSha: report.headSha }] : [];
    });
  const violations = acceptanceViolations(items, input.children, input.exceptions);
  if (violations.length > 0) return { status: 'rejected', violations };

  const dirty = run('git', ['status', '--porcelain'], cwd).stdout.trim();
  if (dirty) {
    return {
      status: 'gate_failed',
      gate: [],
      output: `worktree của PM còn thay đổi chưa commit:\n${clip(dirty)}`,
    };
  }
  const hasOrigin = run('git', ['remote', 'get-url', 'origin'], cwd).code === 0;
  if (hasOrigin) run('git', ['fetch', '--quiet', 'origin', project.defaultBranch], cwd);
  const remoteRef = `refs/remotes/origin/${project.defaultBranch}`;
  const base =
    hasOrigin && run('git', ['rev-parse', '--verify', '--quiet', remoteRef], cwd).code === 0
      ? `origin/${project.defaultBranch}`
      : project.defaultBranch;

  const start = gitOut(cwd, ['rev-parse', 'HEAD']);
  const updated = mergeOne(cwd, base, `Merge ${base} vào crew/${input.pmKey}`, crewDocs);
  if (!updated.ok)
    return { status: 'conflict', ticketKey: base, files: updated.files, output: clip(updated.output) };

  const merged: string[] = [];
  const alreadyIn: string[] = [];
  for (const item of mergeOrder(items)) {
    if (isAncestor(cwd, item.headSha, 'HEAD')) {
      alreadyIn.push(item.ticket.key);
      continue;
    }
    const title = item.ticket.title.replace(/\s+/g, ' ').slice(0, 120);
    const outcome = mergeOne(cwd, item.headSha, `Merge ${item.ticket.key}: ${title}`, crewDocs);
    if (!outcome.ok) {
      return {
        status: 'conflict',
        ticketKey: item.ticket.key,
        files: outcome.files,
        output: clip(outcome.output),
      };
    }
    merged.push(item.ticket.key);
  }

  let generatedCommit: string | null = null;
  if (crewDocs) {
    const generate = runCrewDocs(crewDocs.bundle, ['generate'], cwd, crewDocs.runtime);
    if (generate.code !== 0) {
      return {
        status: 'gate_failed',
        gate: [{ name: 'crew-docs generate', ok: false, output: clip(both(generate)) }],
        output: `crew-docs generate lỗi:\n${clip(both(generate))}`,
      };
    }
    if (run('git', ['status', '--porcelain'], cwd).stdout.trim()) {
      run('git', ['add', '-A'], cwd);
      const commit = run(
        'git',
        ['commit', '-q', '-m', `docs: sinh lại block tự động sau khi merge ${input.pmKey}`],
        cwd,
        input.env,
      );
      if (commit.code !== 0) {
        return {
          status: 'gate_failed',
          gate: [],
          output: `commit block sinh tự động bị từ chối:\n${clip(both(commit))}`,
        };
      }
      generatedCommit = gitOut(cwd, ['rev-parse', 'HEAD']);
    }
  }

  const range = `${base}..HEAD`;
  const gate = prePushGate({ cwd, range, testCommand: project.testCommand, crewDocs, env: input.env });
  const failed = gate.filter((step) => !step.ok);
  if (failed.length > 0) {
    return {
      status: 'gate_failed',
      gate,
      output: failed.map((step) => `### ${step.name}\n${step.output}`).join('\n\n'),
    };
  }

  const head = gitOut(cwd, ['rev-parse', 'HEAD']);
  const commits = gitOut(cwd, ['rev-list', `${start}..HEAD`])
    .split('\n')
    .filter(Boolean);
  let pushed = false;
  if (hasOrigin) {
    const push = run('git', ['push', 'origin', `HEAD:refs/heads/${project.defaultBranch}`], cwd, input.env);
    if (push.code !== 0) {
      return {
        status: 'gate_failed',
        gate: [...gate, { name: 'push', ok: false, output: clip(both(push)) }],
        output: `git push bị từ chối (hook pre-push hoặc remote):\n${clip(both(push))}`,
      };
    }
    pushed = true;
  }
  const localDefault = updateLocalDefault(project.repoPath, project.defaultBranch, head);

  let docsSynced = false;
  if (run('git', ['cat-file', '-e', `${head}:docs/flows.yaml`], cwd).code === 0) {
    await input.syncDocs({ ...docsSnapshot(cwd, head), branch: project.defaultBranch });
    docsSynced = true;
  }
  return {
    status: 'merged',
    merged,
    alreadyIn,
    head,
    commits,
    generatedCommit,
    gate,
    pushed,
    remote: hasOrigin ? 'origin' : null,
    localDefault,
    docsSynced,
  };
}
