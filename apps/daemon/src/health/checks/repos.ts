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
    const version = existsSync(bundle)
      ? runCrewDocs(bundle, ['--version'], ctx.paths.home, runtimeOf(ctx))
      : null;
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

      const hooks = hookStatus(project.repoPath);
      const reinstall = { id: `install-hooks:${project.key}`, label: 'Cài lại hook' };
      const missing = hooks.installed ? missingHookFiles(project.repoPath) : [];
      if (!hooks.installed || missing.length > 0) {
        results.push(
          result(
            `${id}.hooks`,
            'repos',
            `Hook crew-docs của ${project.key}`,
            'red',
            hooks.installed ? `Thiếu hook ${missing.join(', ')}.` : 'Hook crew-docs chưa được cài.',
            reinstall,
          ),
        );
      } else if (hooks.bundle !== bundle) {
        results.push(
          result(
            `${id}.hooks`,
            'repos',
            `Hook crew-docs của ${project.key}`,
            'yellow',
            `Hook dùng ${hooks.bundle}, không phải bản crew-docs hiện tại của máy (${bundle}).`,
            reinstall,
          ),
        );
      } else {
        results.push(
          result(
            `${id}.hooks`,
            'repos',
            `Hook crew-docs của ${project.key}`,
            'green',
            `Hook dùng ${hooks.bundle}.`,
          ),
        );
      }

      results.push(
        existsSync(join(project.repoPath, 'docs', 'flows.yaml'))
          ? result(
              `${id}.docs`,
              'repos',
              `Docs của ${project.key}`,
              'green',
              'Đã khởi tạo docs (docs/flows.yaml).',
            )
          : result(
              `${id}.docs`,
              'repos',
              `Docs của ${project.key}`,
              'yellow',
              'Repo chưa có docs: một ticket docs-init sẽ chạy trước mọi ticket khác của project.',
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
      const installed = installHooks(project.repoPath, bundle, runtimeOf(ctx));
      if (installed.code !== 0) throw new Error(installed.stderr || installed.stdout);
    } else if (action === 'clean-worktrees') {
      for (const orphan of await orphanWorktrees(ctx, project.repoPath))
        removeWorktree(project.repoPath, orphan.key);
    }
  },
};
