import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CREW_DOCS_BUNDLE,
  hookStatus,
  installCrewDocs,
  installHooks,
  runCrewDocs,
} from '../../git/docs-kit-bridge.js';
import { removeWorktree, worktreeKeys, worktreePath } from '../../git/worktree-manager.js';
import { serverProjects } from '../project-views.js';
import { PROBE_WORKTREE_KEY, repoFolderChecks, runGit } from '../repo-probe.js';
import { type HealthCheck, type HealthCheckResult, type HealthContext, result } from '../types.js';

const CLOSED = new Set(['done', 'cancelled']);
/** The git hooks the crew-docs installer wires in (plain, husky or lefthook). */
const CREW_DOCS_HOOKS = ['pre-commit', 'commit-msg', 'pre-push'] as const;

/** Hook files missing from the repo's effective hooks dir (`core.hooksPath` resolved by git). */
export function missingHookFiles(repo: string): string[] {
  const dir = runGit(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
  if (dir.code !== 0) return [...CREW_DOCS_HOOKS];
  return CREW_DOCS_HOOKS.filter((hook) => !existsSync(join(dir.stdout, hook)));
}

/** Worktrees under `<repo>/.crew/worktrees` whose ticket is closed and that no active job uses. */
export async function orphanWorktrees(
  ctx: HealthContext,
  repo: string,
): Promise<{ key: string; path: string; status: string }[]> {
  const inUse = new Set(
    (ctx.state?.listJobs(['queued', 'running', 'backoff']) ?? []).map((job) => job.worktree).filter(Boolean),
  );
  const found: { key: string; path: string; status: string }[] = [];
  for (const key of worktreeKeys(repo)) {
    if (key === PROBE_WORKTREE_KEY) continue;
    const path = worktreePath(repo, key);
    if (inUse.has(path) || !ctx.vps) continue;
    try {
      const { ticket } = await ctx.vps.getTicket(key);
      if (CLOSED.has(ticket.status)) found.push({ key, path, status: ticket.status });
    } catch {
      // unknown ticket or server down: never treated as an orphan
    }
  }
  return found;
}

const runtimeOf = (ctx: HealthContext) => ctx.crewDocs?.runtime ?? process.execPath;

export type HookState = 'missing' | 'incomplete' | 'broken' | 'stale' | 'ok';

export interface HookInspection {
  state: HookState;
  /** The runtime and bundle the repo's git config points the hooks at. */
  runtime: string | null;
  bundle: string | null;
  /** `crew-docs --version` of the configured bundle run by the configured runtime. */
  version: string | null;
  detail: string;
}

/**
 * The crew-docs hooks of a repo, judged by whether they work. Any runtime that exists and runs the configured
 * bundle is accepted, whoever installed it (the desktop app's binary or the CLI's node), so the app and
 * `crewd doctor` never see each other's working install as broken. `stale`: the hooks work but run an older
 * crew-docs than the machine's (`machine.version`).
 */
export function inspectHooks(
  repo: string,
  machine: { bundle: string; version: string | null },
): HookInspection {
  const { runtime, bundle } = hookStatus(repo);
  const base = { runtime, bundle, version: null };
  if (!runtime || !bundle) return { ...base, state: 'missing', detail: 'Hook crew-docs chưa được cài.' };
  const missing = missingHookFiles(repo);
  if (missing.length > 0) {
    return { ...base, state: 'incomplete', detail: `Thiếu hook ${missing.join(', ')}.` };
  }
  if (!existsSync(runtime)) {
    return {
      ...base,
      state: 'broken',
      detail: `Runtime ${runtime} của hook không còn tồn tại (app đã bị chuyển chỗ hoặc gỡ): mọi commit bị chặn cho tới khi cài lại hook.`,
    };
  }
  if (!existsSync(bundle)) {
    return { ...base, state: 'broken', detail: `Bundle ${bundle} của hook không còn tồn tại.` };
  }
  const run = runCrewDocs(bundle, ['--version'], repo, runtime);
  if (run.code !== 0) {
    const reason = run.stderr.trim().split('\n').at(-1) || `mã thoát ${run.code}`;
    return { ...base, state: 'broken', detail: `Runtime ${runtime} không chạy được ${bundle}: ${reason}.` };
  }
  const version = run.stdout.trim();
  if (bundle !== machine.bundle && machine.version !== null && version !== machine.version) {
    return {
      ...base,
      version,
      state: 'stale',
      detail: `Hook dùng crew-docs ${version} (${bundle}), máy đang có ${machine.version} (${machine.bundle}).`,
    };
  }
  return {
    ...base,
    version,
    state: 'ok',
    detail: `Hook chạy được: crew-docs ${version} tại ${bundle}, runtime ${runtime}.`,
  };
}

/** `crew-docs --version` of the machine's bundle in `~/.crew/bin`, or null when it is not installed. */
function machineVersion(ctx: HealthContext, bundle: string) {
  return existsSync(bundle) ? runCrewDocs(bundle, ['--version'], ctx.paths.home, runtimeOf(ctx)) : null;
}

/** The status a hook state shows on the dashboard: only hooks that do not run are red. */
const HOOK_STATUS: Record<HookState, 'green' | 'yellow' | 'red'> = {
  missing: 'red',
  incomplete: 'red',
  broken: 'red',
  stale: 'yellow',
  ok: 'green',
};

export const repoChecks: HealthCheck = {
  id: 'repos',
  group: 'repos',
  async run(ctx) {
    const results: HealthCheckResult[] = [];
    const gitVersion = ctx.exec('git', ['--version']);
    results.push(
      gitVersion.code === 0
        ? result('repos.git', 'repos', 'git', 'green', gitVersion.stdout.trim())
        : result(
            'repos.git',
            'repos',
            'git',
            'red',
            'Không tìm thấy git: cài git (Xcode Command Line Tools trên macOS).',
          ),
    );

    const bundle = join(ctx.paths.bin, CREW_DOCS_BUNDLE);
    const version = machineVersion(ctx, bundle);
    results.push(
      version?.code === 0
        ? result(
            'repos.crew-docs',
            'repos',
            'crew-docs',
            'green',
            `crew-docs ${version.stdout.trim()} tại ${bundle}.`,
          )
        : result(
            'repos.crew-docs',
            'repos',
            'crew-docs',
            'red',
            `crew-docs chưa được cài vào ${ctx.paths.bin}.`,
            {
              id: 'install-crew-docs',
              label: 'Cài crew-docs',
            },
          ),
    );
    const machine = { bundle, version: version?.code === 0 ? version.stdout.trim() : null };

    const projects = ctx.config?.projects ?? [];
    const server = await serverProjects(ctx);
    for (const project of projects) {
      const id = `repos.${project.key}`;
      const view = server.get(project.key);
      const folder = repoFolderChecks({
        idPrefix: id,
        label: project.key,
        path: project.repoPath,
        repoUrl: view?.repoUrl ?? null,
        defaultBranch: view?.defaultBranch ?? project.defaultBranch,
        pushProbe: !ctx.quick,
        repickFixKey: project.key,
      });
      results.push(...folder);
      if (folder.some((item) => item.id === `${id}.path` && item.status === 'red')) continue;

      const hooks = inspectHooks(project.repoPath, machine);
      const status = HOOK_STATUS[hooks.state];
      results.push(
        result(
          `${id}.hooks`,
          'repos',
          `Hook crew-docs của ${project.key}`,
          status,
          hooks.detail,
          status === 'green' ? undefined : { id: `install-hooks:${project.key}`, label: 'Cài lại hook' },
        ),
      );

      results.push(
        existsSync(join(project.repoPath, 'docs', 'flows.yaml'))
          ? result(
              `${id}.docs`,
              'repos',
              `Docs của ${project.key}`,
              'green',
              'Đã khởi tạo docs (docs/flows.yaml).',
            )
          : // Expected for a new project, not a problem: shown green with a note, never counted as failing.
            result(
              `${id}.docs`,
              'repos',
              `Docs của ${project.key}`,
              'green',
              'Repo chưa có docs (bình thường với repo mới): ticket đầu tiên của project sẽ chạy docs-init trước. Hook crew-docs chỉ cảnh báo cho tới commit docs-init.',
            ),
      );

      const orphans = await orphanWorktrees(ctx, project.repoPath);
      results.push(
        orphans.length === 0
          ? result(
              `${id}.worktrees`,
              'repos',
              `Worktree thừa của ${project.key}`,
              'green',
              'Không có worktree thừa.',
            )
          : result(
              `${id}.worktrees`,
              'repos',
              `Worktree thừa của ${project.key}`,
              'yellow',
              `${orphans.length} worktree của ticket đã đóng: ${orphans.map((o) => o.key).join(', ')}.`,
              { id: `clean-worktrees:${project.key}`, label: 'Dọn worktree' },
            ),
      );
    }
    return results;
  },
  async fix(ctx, fixId) {
    const bundle = join(ctx.paths.bin, CREW_DOCS_BUNDLE);
    const install = () =>
      ctx.crewDocs
        ? installCrewDocs(ctx.paths.bin, ctx.crewDocs.source, ctx.crewDocs.runtime)
        : installCrewDocs(ctx.paths.bin);
    if (fixId === 'install-crew-docs') {
      install();
      return;
    }
    const [action, key] = fixId.split(':');
    const project = ctx.config?.projects.find((p) => p.key === key);
    if (!project) return;
    if (action === 'install-hooks') {
      if (!existsSync(bundle)) install();
      const version = machineVersion(ctx, bundle);
      const current = inspectHooks(project.repoPath, {
        bundle,
        version: version?.code === 0 ? version.stdout.trim() : null,
      });
      // Working hooks are never rewritten; a stale but working install keeps its runtime.
      if (current.state === 'ok') return;
      const runtime = current.state === 'stale' && current.runtime ? current.runtime : runtimeOf(ctx);
      const installed = installHooks(project.repoPath, bundle, runtime);
      if (installed.code !== 0) throw new Error(installed.stderr || installed.stdout);
    } else if (action === 'clean-worktrees') {
      for (const orphan of await orphanWorktrees(ctx, project.repoPath))
        removeWorktree(project.repoPath, orphan.key);
    }
  },
};
