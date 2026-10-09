import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';
import type { MacContext } from '../context.js';
import {
  buildDocsSnapshot,
  collectCommits,
  isAncestor,
  scrubCommitPaths,
  snapshotCommit,
  snapshotCommitFromRefs,
} from '../status/docs.js';
import { buildMachineReport } from '../status/report.js';
import { signCrewBody } from '../status/sign.js';

export interface StatusConfig {
  url: string;
  companyId?: string;
  machineId: string;
  claudePath?: string;
}
export class StatusSendError extends Error {}

function statusPath(ctx: MacContext): string {
  return join(ctx.home, '.crew', 'status.json');
}
function lastPath(ctx: MacContext): string {
  return join(ctx.home, '.crew', 'status-last.json');
}
function reposPath(ctx: MacContext): string {
  return join(ctx.home, '.crew', 'status-repos.json');
}
const DOCS_BODY_MAX_BYTES = 5 * 1024 * 1024;

export interface StatusRepo {
  projectId: string;
  path: string;
  lastCommit: string | null;
  format?: 2;
}
export function listStatusRepos(ctx: MacContext): StatusRepo[] {
  try {
    const value: unknown = JSON.parse(readFileSync(reposPath(ctx), 'utf8'));
    if (!Array.isArray(value)) throw new Error('Danh sách repo không hợp lệ');
    return value.map((item) => {
      if (
        !item ||
        !UUID_PATTERN.test(item.projectId) ||
        !isAbsolute(item.path) ||
        !(item.lastCommit === null || /^[0-9a-f]{40}$/.test(item.lastCommit)) ||
        !(item.format === undefined || item.format === 2)
      )
        throw new Error('Danh sách repo không hợp lệ');
      return item as StatusRepo;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
function writeRepos(ctx: MacContext, repos: StatusRepo[]): void {
  const path = reposPath(ctx);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(repos)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
function mutateRepos(ctx: MacContext, mutate: (repos: StatusRepo[]) => StatusRepo[]): void {
  const lock = `${reposPath(ctx)}.lock`;
  mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
  let locked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      locked = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 60_000) rmdirSync(lock);
      } catch {
        /* another process released or replaced the lock */
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  if (!locked) throw new Error('Danh sách repo đang được cập nhật');
  try {
    writeRepos(ctx, mutate(listStatusRepos(ctx)));
  } finally {
    rmdirSync(lock);
  }
}
export function addStatusRepo(ctx: MacContext, projectId: string, path: string): void {
  if (!UUID_PATTERN.test(projectId)) throw new Error('projectId phải là UUID hợp lệ');
  if (!isAbsolute(path)) throw new Error('Đường dẫn repo phải tuyệt đối');
  const canonical = realpathSync(path);
  if (!statSync(canonical).isDirectory()) throw new Error('Đường dẫn không phải repo git');
  const top = execFileSync('git', ['-C', canonical, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  if (realpathSync(top) !== canonical || !snapshotCommitFromRefs(canonical))
    throw new Error('Đường dẫn không phải repo git');
  mutateRepos(ctx, (repos) => [
    ...repos.filter((repo) => repo.projectId !== projectId),
    { projectId, path: canonical, lastCommit: null },
  ]);
}
export function removeStatusRepo(ctx: MacContext, projectId: string): void {
  if (!UUID_PATTERN.test(projectId)) throw new Error('projectId phải là UUID hợp lệ');
  mutateRepos(ctx, (repos) => repos.filter((repo) => repo.projectId !== projectId));
}

function writePrivate(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function readStatusConfig(ctx: MacContext): StatusConfig | null {
  try {
    const data = JSON.parse(readFileSync(statusPath(ctx), 'utf8')) as StatusConfig;
    return typeof data.url === 'string' && typeof data.machineId === 'string' ? data : null;
  } catch {
    return null;
  }
}

export function resolveClaudePath(home: string, pathEnv = process.env.PATH ?? ''): string | null {
  for (const dir of [
    ...pathEnv.split(delimiter),
    join(home, '.local/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]) {
    if (!dir || !isAbsolute(dir)) continue;
    const candidate = join(dir, 'claude');
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      /* thử nơi khác */
    }
  }
  return null;
}

export function saveConfiguredClaudePath(ctx: MacContext): void {
  const config = readStatusConfig(ctx);
  if (!config) return;
  const claudePath = resolveClaudePath(ctx.home);
  if (claudePath && config.claudePath !== claudePath)
    writePrivate(statusPath(ctx), { ...config, claudePath });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function configureStatus(ctx: MacContext, url: string, companyId: string): StatusConfig {
  if (!UUID_PATTERN.test(companyId)) throw new Error('company phải là UUID hợp lệ');
  const parsed = new URL(url);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new Error('URL phải là origin HTTP(S) của Paperclip');
  }
  const config = {
    url: parsed.origin,
    companyId,
    machineId: readStatusConfig(ctx)?.machineId ?? randomUUID(),
    claudePath: resolveClaudePath(ctx.home) ?? readStatusConfig(ctx)?.claudePath,
  };
  writePrivate(statusPath(ctx), config);
  return config;
}

export async function setStatusSecret(ctx: MacContext, input: string): Promise<void> {
  const secret = input.replace(/\r?\n$/, '');
  if (!secret || secret.includes('\n') || secret.includes('\r'))
    throw new Error('Secret phải có đúng một dòng');
  // Secret không lên argv (process cùng user đọc được argv qua `ps`): `security -i` đọc lệnh từ stdin. Trong cú pháp
  // của nó, chuỗi trong nháy kép thoát `\` và `"` bằng gạch chéo ngược (đã thử với `$`, `` ` ``, `'`, dấu cách).
  const quoted = `"${secret.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  const result = await ctx.runner.run('security', ['-i'], {
    timeoutMs: 10_000,
    input: `add-generic-password -U -s crew-mac-status -a crew-mac -w ${quoted}\n`,
  });
  if (result.code !== 0) throw new Error('Không ghi được secret vào Keychain');
}

/** Chỉ tên/mã lỗi, không lấy message vì có thể chứa secret hay URL. */
function errorKind(error: unknown): string {
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  if (typeof cause?.code === 'string') return cause.code;
  return error instanceof Error ? error.name : 'lỗi không rõ';
}

export async function sendStatus(ctx: MacContext, fetcher: typeof fetch = fetch): Promise<void> {
  let httpStatus: number | null = null;
  let failureMessage = 'crew-mac status: gửi thất bại; kiểm tra cấu hình và secret';
  let machineFailed = false;
  try {
    const config = readStatusConfig(ctx);
    if (!config) throw new Error('config');
    if (!config.companyId) {
      failureMessage = 'crew-mac status: thiếu companyId; chạy status config --company <UUID>';
      throw new Error('company');
    }
    const found = await ctx.runner.run('security', ['find-generic-password', '-s', 'crew-mac-status', '-w'], {
      timeoutMs: 10_000,
    });
    const secret = found.stdout.replace(/\r?\n$/, '');
    if (found.code !== 0 || !secret) {
      failureMessage = `crew-mac status: gửi thất bại (Keychain${found.timedOut ? ' quá hạn' : ` mã ${found.code}`}); kiểm tra secret`;
      throw new Error('keychain');
    }
    failureMessage = 'crew-mac status: gửi thất bại (dựng bản tin máy)';
    const body = JSON.stringify(await buildMachineReport(ctx, config.companyId, config.machineId));
    failureMessage = 'crew-mac status: gửi thất bại (kết nối tới Paperclip)';
    const response = await fetcher(`${config.url}/api/plugins/crew.core/webhooks/machine-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...signCrewBody(body, secret, Math.floor(ctx.now().getTime() / 1000)),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = response.status;
    if (response.status < 200 || response.status >= 300) throw new Error('http');
    writePrivate(lastPath(ctx), { at: ctx.now().toISOString(), ok: true, httpStatus });
  } catch (error) {
    machineFailed = true;
    if (httpStatus === null && failureMessage.endsWith('(kết nối tới Paperclip)'))
      failureMessage = `${failureMessage.slice(0, -1)}: ${errorKind(error)})`;
    writePrivate(lastPath(ctx), { at: ctx.now().toISOString(), ok: false, httpStatus });
    ctx.out(httpStatus === null ? failureMessage : `crew-mac status: gửi thất bại (HTTP ${httpStatus})`);
  }
  let docsFailed = false;
  try {
    docsFailed = !(await sendDocsSnapshots(ctx, fetcher));
  } catch {
    docsFailed = true;
  }
  if (machineFailed || docsFailed) throw new StatusSendError('Gửi trạng thái thất bại');
}

export async function sendDocsSnapshots(ctx: MacContext, fetcher: typeof fetch = fetch): Promise<boolean> {
  const repos = listStatusRepos(ctx);
  if (repos.length === 0) return true;
  const config = readStatusConfig(ctx);
  if (!config?.companyId) throw new Error('Thiếu companyId');
  const found = await ctx.runner.run('security', ['find-generic-password', '-s', 'crew-mac-status', '-w'], {
    timeoutMs: 10_000,
  });
  const secret = found.stdout.replace(/\r?\n$/, '');
  if (found.code !== 0 || !secret) throw new Error('Không đọc được secret Keychain');
  let success = true;
  for (const repo of repos) {
    try {
      const selected = await snapshotCommit(repo.path);
      const { commit } = selected;
      if (selected.fetchFailed) ctx.out(`Không fetch được origin của ${repo.projectId}`);
      if (commit === repo.lastCommit && repo.format === 2) continue;
      const base =
        repo.format === 2 && repo.lastCommit && isAncestor(repo.path, repo.lastCommit, commit)
          ? repo.lastCommit
          : null;
      const snapshot = buildDocsSnapshot(repo.path, commit, basename(repo.path));
      const commits = scrubCommitPaths(repo.path, collectCommits(repo.path, commit, base));
      if (snapshot.dropped.length > 0)
        ctx.out(
          `crew-mac status: đã bỏ ${snapshot.dropped.length} file docs do secret-scan trong repo ${repo.projectId}.`,
        );
      const payload = {
        version: 1,
        format: 2,
        companyId: config.companyId,
        machineId: config.machineId,
        projectId: repo.projectId,
        repo: basename(repo.path),
        commit,
        ...snapshot,
        commits,
      };
      let body = JSON.stringify(payload);
      if (Buffer.byteLength(body, 'utf8') > DOCS_BODY_MAX_BYTES) {
        body = JSON.stringify({
          ...payload,
          commits: { ...commits, truncated: true, items: commits.items.map((c) => ({ ...c, paths: [] })) },
        });
      }
      if (Buffer.byteLength(body, 'utf8') > DOCS_BODY_MAX_BYTES) {
        ctx.out(`crew-mac status: ảnh chụp docs của ${repo.projectId} vượt 5 MB; sẽ thử lại.`);
        success = false;
        continue;
      }
      const response = await fetcher(`${config.url}/api/plugins/crew.core/webhooks/docs-snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...signCrewBody(body, secret, Math.floor(ctx.now().getTime() / 1000)),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      mutateRepos(ctx, (current) =>
        current.map((item) =>
          item.projectId === repo.projectId && item.path === repo.path
            ? { ...item, lastCommit: commit, format: 2 as const }
            : item,
        ),
      );
    } catch {
      success = false;
      ctx.out(`crew-mac status: không gửi được ảnh chụp docs của ${repo.projectId}; sẽ thử lại.`);
    }
  }
  return success;
}
