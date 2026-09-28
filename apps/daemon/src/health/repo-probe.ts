import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { type HealthCheckResult, result } from './types.js';

/** The probe worktree the inventory is read from; it is never an orphan. */
export const PROBE_WORKTREE_KEY = '_probe';

interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs git without a prompt: a credential or host-key question fails instead of hanging the check, and a
 * slow remote hits the timeout.
 */
export function runGit(cwd: string, args: string[], timeoutMs = 15_000): GitRun {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=10';
  const run = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: timeoutMs });
  if (run.error) return { code: 127, stdout: '', stderr: run.error.message };
  return { code: run.status ?? 1, stdout: run.stdout.trim(), stderr: run.stderr.trim() };
}

/**
 * `git@github.com:Org/Repo.git`, `ssh://git@github.com/Org/Repo` and `https://github.com/Org/Repo.git`
 * all normalize to `github.com/org/repo`.
 */
export function normalizeRepoUrl(url: string): string {
  let value = url.trim();
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(value);
  if (scp) value = `${scp[1]}/${scp[2]}`;
  else value = value.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '');
  return value
    .replace(/:\d+\//, '/')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
}

export function sameRepo(a: string, b: string): boolean {
  return normalizeRepoUrl(a) === normalizeRepoUrl(b);
}

export interface FolderInspection {
  isRepo: boolean;
  /** Top level of the repo (realpath), or the folder itself when it is not a repo. */
  root: string;
  origin: string | null;
  defaultBranch: string | null;
}

/** Reads what the app can prefill from a folder: the repo root, `origin` and the default branch. */
export function inspectFolder(path: string): FolderInspection {
  if (!existsSync(path)) return { isRepo: false, root: path, origin: null, defaultBranch: null };
  const top = runGit(path, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0 || top.stdout === '')
    return { isRepo: false, root: path, origin: null, defaultBranch: null };
  const root = realpathSync(top.stdout);
  const origin = runGit(root, ['remote', 'get-url', 'origin']);
  const remoteHead = runGit(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  let defaultBranch: string | null =
    remoteHead.code === 0 ? remoteHead.stdout.replace(/^origin\//, '') : null;
  if (!defaultBranch) {
    for (const candidate of ['main', 'master']) {
      if (runGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`]).code === 0) {
        defaultBranch = candidate;
        break;
      }
    }
  }
  if (!defaultBranch) {
    const current = runGit(root, ['symbolic-ref', '--short', 'HEAD']);
    defaultBranch = current.code === 0 ? current.stdout : null;
  }
  return { isRepo: true, root, origin: origin.code === 0 ? origin.stdout : null, defaultBranch };
}

/** A project key suggestion from a repo name: `my-shop.app` → `MYSHOPAPP` (2–10 upper-case characters). */
export function suggestProjectKey(folder: string): string {
  const letters = basename(folder)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const key = /^[A-Z]/.test(letters) ? letters : `P${letters}`;
  const trimmed = key.slice(0, 10);
  return trimmed.length >= 2 ? (trimmed === 'AST' ? 'ASTX' : trimmed) : 'PROJ';
}

export interface RepoFolderCheckInput {
  /** Result id prefix, e.g. `repos.WEB` or `folder`. */
  idPrefix: string;
  /** Shown in titles, e.g. the project key. */
  label: string;
  path: string;
  /** The project's repo URL on the server; null skips the origin comparison. */
  repoUrl: string | null;
  defaultBranch: string;
  /** Contact the remote to prove push access (skipped on quick runs). */
  pushProbe: boolean;
  /** Offer "pick the folder again" on path and origin failures (the app's Settings → Projects). */
  repickFixKey?: string;
}

/**
 * The folder checks shared by the setup wizard and the Repos health group: a git repo, `origin` matching the
 * project, the default branch, push access and the working tree state.
 */
export function repoFolderChecks(input: RepoFolderCheckInput): HealthCheckResult[] {
  const { idPrefix: id, label } = input;
  const repick = input.repickFixKey
    ? { id: `repick-folder:${input.repickFixKey}`, label: 'Chọn lại thư mục' }
    : undefined;
  const results: HealthCheckResult[] = [];
  const folder = inspectFolder(input.path);
  if (!folder.isRepo) {
    results.push(
      result(
        `${id}.path`,
        'repos',
        `Thư mục ${label}`,
        'red',
        `${input.path} không tồn tại hoặc không phải repo git.`,
        repick,
      ),
    );
    return results;
  }
  results.push(result(`${id}.path`, 'repos', `Thư mục ${label}`, 'green', folder.root));

  if (input.repoUrl !== null) {
    if (!folder.origin) {
      results.push(
        result(
          `${id}.origin`,
          'repos',
          `Remote origin của ${label}`,
          'red',
          'Repo chưa có remote origin.',
          repick,
        ),
      );
    } else if (!sameRepo(folder.origin, input.repoUrl)) {
      results.push(
        result(
          `${id}.origin`,
          'repos',
          `Remote origin của ${label}`,
          'red',
          `origin là ${folder.origin}, nhưng project dùng ${input.repoUrl}: chọn đúng thư mục của project.`,
          repick,
        ),
      );
    } else {
      results.push(result(`${id}.origin`, 'repos', `Remote origin của ${label}`, 'green', folder.origin));
    }
  }

  const branch = input.defaultBranch;
  const local = runGit(folder.root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).code === 0;
  const remote =
    local ||
    runGit(folder.root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]).code === 0;
  results.push(
    remote
      ? result(
          `${id}.branch`,
          'repos',
          `Nhánh mặc định của ${label}`,
          'green',
          `Có nhánh ${branch}${local ? '' : ' (chỉ trên origin)'}.`,
        )
      : result(
          `${id}.branch`,
          'repos',
          `Nhánh mặc định của ${label}`,
          'red',
          `Không có nhánh ${branch} trong repo này (kể cả trên origin): kiểm tra nhánh mặc định của project.`,
        ),
  );

  if (input.pushProbe) {
    const source = local ? `refs/heads/${branch}` : 'HEAD';
    // A dry run still opens the remote's receive-pack, which the host only grants with push access. The
    // repo's own pre-push hooks (crew-docs) do not belong to this probe.
    const push = runGit(
      folder.root,
      [
        'push',
        '--dry-run',
        '--no-verify',
        '--porcelain',
        'origin',
        `${source}:refs/heads/crew/push-access-check`,
      ],
      30_000,
    );
    const reason = push.stderr.split('\n').filter(Boolean).at(-1) ?? `mã thoát ${push.code}`;
    results.push(
      push.code === 0
        ? result(
            `${id}.push`,
            'repos',
            `Quyền push của ${label}`,
            'green',
            'Push thử (dry-run) lên origin thành công.',
          )
        : result(
            `${id}.push`,
            'repos',
            `Quyền push của ${label}`,
            'red',
            `Không push được lên origin (${reason}): kiểm tra SSH key hoặc credential helper của git.`,
          ),
    );
  }

  const status = runGit(folder.root, ['status', '--porcelain=v1', '--branch']);
  const lines = status.stdout.split('\n').filter(Boolean);
  const head = lines[0]?.replace(/^## /, '') ?? '?';
  const changes = lines.length - 1;
  results.push(
    result(
      `${id}.tree`,
      'repos',
      `Working tree của ${label}`,
      'green',
      changes === 0
        ? `${head}: sạch.`
        : `${head}: ${changes} file thay đổi chưa commit (agent làm trong worktree riêng).`,
    ),
  );
  return results;
}
