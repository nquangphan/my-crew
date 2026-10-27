import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
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
import { hostname } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';
import { parsePublicKey } from '../authorized-keys.js';
import type { MacContext } from '../context.js';
import { readManifest } from '../manifest.js';
import { macPaths } from '../paths.js';
import {
  buildDocsSnapshot,
  collectCommits,
  isAncestor,
  scrubCommitPaths,
  snapshotCommit,
  snapshotCommitFromRefs,
} from '../status/docs.js';
import { buildMachineReport, type MachineReport } from '../status/report.js';
import { signCrewBody } from '../status/sign.js';
import {
  type KeychainRead,
  LEGACY_KEYCHAIN_SERVICE,
  listTargets,
  readKeychainSecret,
  type StatusTarget,
  targetsOf,
  writeKeychainSecret,
} from '../status/targets.js';

export interface StatusConfig {
  url: string;
  companyId?: string;
  machineId: string;
  claudePath?: string;
  /** Các đích nhận bản tin (`status add-target`); không có thì `{url, companyId}` là đích duy nhất. */
  targets?: StatusTarget[];
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
/** Trần body ảnh chụp docs, khớp `maxBytes` của webhook `docs-snapshot` trên server. */
export const DOCS_BODY_MAX_BYTES = 16 * 1024 * 1024;
/** Body tới 16 MB qua mạng nhà cần lâu hơn bản tin máy. */
const DOCS_SEND_TIMEOUT_MS = 60_000;

export interface StatusRepo {
  projectId: string;
  path: string;
  lastCommit: string | null;
  format?: 2;
  /**
   * Commit gửi gần nhất ở định dạng 2. crew-mac bản cũ chép nguyên item và chỉ dời `lastCommit`, nên lệch với
   * `lastCommit` nghĩa là đã có bản cũ chạy xen giữa: phải gửi lại một lần, kèm commit từ mốc này.
   */
  formatCommit?: string;
  /** Company nhận ảnh chụp docs của repo; thiếu thì là company của đích đầu tiên. */
  companyId?: string;
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
        !(item.format === undefined || item.format === 2) ||
        !(item.formatCommit === undefined || /^[0-9a-f]{40}$/.test(item.formatCommit)) ||
        !(item.companyId === undefined || UUID_PATTERN.test(item.companyId))
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
export function addStatusRepo(ctx: MacContext, projectId: string, path: string, companyId?: string): void {
  if (!UUID_PATTERN.test(projectId)) throw new Error('projectId phải là UUID hợp lệ');
  if (companyId !== undefined && !UUID_PATTERN.test(companyId))
    throw new Error('company phải là UUID hợp lệ');
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
    { projectId, path: canonical, lastCommit: null, ...(companyId ? { companyId } : {}) },
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

export function writeStatusConfig(ctx: MacContext, config: StatusConfig): void {
  writePrivate(statusPath(ctx), config);
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

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Origin HTTP(S) của Paperclip, không user/pass/query/hash/path; sai thì ném. */
export function normalizeStatusUrl(url: string): string {
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
  return parsed.origin;
}

export function configureStatus(ctx: MacContext, url: string, companyId: string): StatusConfig {
  if (!UUID_PATTERN.test(companyId)) throw new Error('company phải là UUID hợp lệ');
  const origin = normalizeStatusUrl(url);
  const previous = readStatusConfig(ctx);
  const config: StatusConfig = {
    url: origin,
    companyId,
    machineId: previous?.machineId ?? randomUUID(),
    claudePath: resolveClaudePath(ctx.home) ?? previous?.claudePath,
  };
  // Đã có nhiều đích: config chỉ thay đích dùng service cũ (đứng đầu), các đích `add-target` giữ nguyên.
  if (Array.isArray(previous?.targets))
    config.targets = [
      { url: origin, companyId, keychainService: LEGACY_KEYCHAIN_SERVICE },
      ...targetsOf(previous).filter(
        (target) => target.keychainService !== LEGACY_KEYCHAIN_SERVICE && target.companyId !== companyId,
      ),
    ];
  writePrivate(statusPath(ctx), config);
  return config;
}

export async function setStatusSecret(ctx: MacContext, input: string): Promise<void> {
  await writeKeychainSecret(ctx, LEGACY_KEYCHAIN_SERVICE, input);
}

/** Chỉ tên/mã lỗi, không lấy message vì có thể chứa secret hay URL. */
function errorKind(error: unknown): string {
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  if (typeof cause?.code === 'string') return cause.code;
  return error instanceof Error ? error.name : 'lỗi không rõ';
}

function keychainFailure(read: KeychainRead): string {
  return read.ok ? '' : `Keychain${read.timedOut ? ' quá hạn' : ` mã ${read.code}`}`;
}

/**
 * Vì sao một lần gửi bản tin thất bại: `keychain` (không đọc được secret), `report` (không dựng được bản tin),
 * `network` (không tới được Paperclip), `http` (server trả mã không 2xx), `no-target` (company không có trong đích).
 */
export type StatusSendFailure = 'no-target' | 'keychain' | 'report' | 'network' | 'http';

interface TargetOutcome {
  companyId: string;
  ok: boolean;
  httpStatus: number | null;
  failure: StatusSendFailure | null;
}

/** Gửi bản tin máy tới một đích; lỗi chỉ in một dòng có company id, không có secret, URL hay message lỗi. */
async function sendReportTo(
  ctx: MacContext,
  target: StatusTarget,
  report: () => Promise<MachineReport>,
  fetcher: typeof fetch,
  label: string,
): Promise<TargetOutcome> {
  let httpStatus: number | null = null;
  let failureMessage = 'crew-mac status: gửi thất bại';
  let failure: StatusSendFailure = 'keychain';
  try {
    const secret = await readKeychainSecret(ctx, target.keychainService);
    if (!secret.ok) {
      failureMessage = `crew-mac status: gửi thất bại (${keychainFailure(secret)}); kiểm tra secret`;
      throw new Error('keychain');
    }
    failureMessage = 'crew-mac status: gửi thất bại (dựng bản tin máy)';
    failure = 'report';
    const body = JSON.stringify({ ...(await report()), companyId: target.companyId });
    failureMessage = 'crew-mac status: gửi thất bại (kết nối tới Paperclip)';
    failure = 'network';
    const response = await fetcher(`${target.url}/api/plugins/crew.core/webhooks/machine-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...signCrewBody(body, secret.secret, Math.floor(ctx.now().getTime() / 1000)),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = response.status;
    failure = 'http';
    if (response.status < 200 || response.status >= 300) throw new Error('http');
    return { companyId: target.companyId, ok: true, httpStatus, failure: null };
  } catch (error) {
    if (httpStatus === null && failureMessage.endsWith('(kết nối tới Paperclip)'))
      failureMessage = `${failureMessage.slice(0, -1)}: ${errorKind(error)})`;
    ctx.out(
      `${httpStatus === null ? failureMessage : `crew-mac status: gửi thất bại (HTTP ${httpStatus})`}${label}`,
    );
    return { companyId: target.companyId, ok: false, httpStatus, failure };
  }
}

/**
 * Gửi bản tin máy cho từng đích (cùng `machineId`, `companyId` của đích), rồi ảnh chụp docs. Một đích lỗi không chặn
 * đích khác; có lỗi thì ném `StatusSendError` sau khi đã thử hết.
 */
export async function sendStatus(ctx: MacContext, fetcher: typeof fetch = fetch): Promise<void> {
  const config = readStatusConfig(ctx);
  const targets = targetsOf(config);
  let outcomes: TargetOutcome[] = [];
  if (!config) {
    ctx.out('crew-mac status: gửi thất bại; kiểm tra cấu hình và secret');
  } else if (targets.length === 0) {
    ctx.out('crew-mac status: thiếu companyId; chạy status config --company <UUID>');
  } else {
    // Dựng bản tin một lần (doctor, sysctl, quét checkout) cho mọi đích.
    let built: Promise<MachineReport> | null = null;
    const report = () => {
      built ??= buildMachineReport(ctx, (targets[0] as StatusTarget).companyId, config.machineId);
      return built;
    };
    for (const target of targets)
      outcomes.push(
        await sendReportTo(
          ctx,
          target,
          report,
          fetcher,
          targets.length > 1 ? ` [company ${target.companyId}]` : '',
        ),
      );
  }
  if (outcomes.length === 0)
    outcomes = [{ companyId: '', ok: false, httpStatus: null, failure: 'no-target' }];
  const failed = outcomes.find((outcome) => !outcome.ok);
  writePrivate(lastPath(ctx), {
    at: ctx.now().toISOString(),
    ok: !failed,
    httpStatus: (failed ?? outcomes.at(-1))?.httpStatus ?? null,
    ...(outcomes.length > 1 || outcomes[0]?.companyId
      ? {
          targets: outcomes
            .filter((o) => o.companyId)
            .map(({ companyId, ok, httpStatus }) => ({ companyId, ok, httpStatus })),
        }
      : {}),
  });
  let docsFailed = false;
  try {
    docsFailed = !(await sendDocsSnapshots(ctx, fetcher));
  } catch {
    docsFailed = true;
  }
  if (failed || docsFailed) throw new StatusSendError('Gửi trạng thái thất bại');
}

export interface StatusTestResult {
  ok: boolean;
  /** Mã HTTP server trả; `null` khi chưa tới được server. */
  httpStatus: number | null;
  failure: StatusSendFailure | null;
}

/**
 * Gửi đúng một bản tin máy tới đích của `companyId` (không gửi ảnh chụp docs, không ghi `status-last.json`) để kiểm
 * secret trong Keychain với server ngay lúc cài. Không bao giờ ném vì lỗi gửi: lý do nằm ở `failure`.
 */
export async function testStatus(
  ctx: MacContext,
  companyId: string,
  fetcher: typeof fetch = fetch,
): Promise<StatusTestResult> {
  if (!UUID_PATTERN.test(companyId)) throw new Error('company phải là UUID hợp lệ');
  const config = readStatusConfig(ctx);
  const wanted = companyId.toLowerCase();
  const target = targetsOf(config).find((candidate) => candidate.companyId.toLowerCase() === wanted);
  if (!config || !target) return { ok: false, httpStatus: null, failure: 'no-target' };
  const { ok, httpStatus, failure } = await sendReportTo(
    ctx,
    target,
    () => buildMachineReport(ctx, target.companyId, config.machineId),
    fetcher,
    '',
  );
  return { ok, httpStatus, failure };
}

/**
 * Ghi secret (key máy do server cấp khi ghép, hoặc secret dán tay) vào đúng service Keychain của đích thuộc
 * `companyId`, không đụng service của company khác. Đi qua stdin của `security -i`, không lên argv.
 */
export async function setTargetSecret(ctx: MacContext, companyId: string, secret: string): Promise<void> {
  if (!UUID_PATTERN.test(companyId)) throw new Error('company phải là UUID hợp lệ');
  const wanted = companyId.toLowerCase();
  const target = listTargets(ctx).find((candidate) => candidate.companyId.toLowerCase() === wanted);
  if (!target) throw new Error('Chưa có đích bản tin cho company này; cấu hình bản tin trước');
  await writeKeychainSecret(ctx, target.keychainService, secret);
}

/** Thông tin máy để tạo environment SSH và ghép máy với Paperclip. Không có secret. */
export interface MachineFacts {
  /** IP Tailscale sshd agent nghe (manifest). */
  listenAddress: string;
  port: number;
  worktreeRoot: string;
  /** Dòng `[ip]:port ssh-ed25519 AAAA…` crew-mac setup đã ghi, dùng làm `knownHosts` của environment. */
  knownHostsLine: string;
  /** Như `ssh-keygen -lf host_ed25519.pub`: `SHA256:<43 ký tự base64>`. */
  hostKeyFingerprint: string;
  username: string;
  hostname: string;
}

const HOSTNAME_MAX = 200;

async function localHostname(ctx: MacContext): Promise<string> {
  const result = await ctx.runner.run('scutil', ['--get', 'LocalHostName'], { timeoutMs: 10_000 });
  const fromScutil = result.code === 0 ? result.stdout.trim() : '';
  const name = fromScutil || (hostname().split('.')[0] ?? '');
  if (name === '' || name.length > HOSTNAME_MAX || name.includes('\0'))
    throw new Error('Không đọc được tên máy (scutil --get LocalHostName)');
  return name;
}

/** Đọc manifest, known_hosts và host key mà `crew-mac setup` đã ghi; thiếu hay lệch nhau thì ném. */
export async function machineFacts(ctx: MacContext): Promise<MachineFacts> {
  const paths = macPaths(ctx.home);
  const manifest = readManifest(paths.manifest);
  if (!manifest) throw new Error('Máy chưa cài crew-mac (thiếu manifest); chạy crew-mac setup trước');
  const { type, body } = parsePublicKey(readFileSync(`${paths.hostKey}.pub`, 'utf8'));
  const prefix = `[${manifest.listenAddress}]:${manifest.port} `;
  const knownHostsLine =
    readFileSync(paths.knownHosts, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? '';
  if (knownHostsLine !== `${prefix}${type} ${body}`)
    throw new Error('known_hosts của crew-mac không khớp manifest hoặc host key; chạy lại crew-mac setup');
  const digest = createHash('sha256').update(Buffer.from(body, 'base64')).digest('base64').replace(/=+$/, '');
  return {
    listenAddress: manifest.listenAddress,
    port: manifest.port,
    worktreeRoot: manifest.worktreeRoot,
    knownHostsLine,
    hostKeyFingerprint: `SHA256:${digest}`,
    username: ctx.user,
    hostname: await localHostname(ctx),
  };
}

export async function sendDocsSnapshots(ctx: MacContext, fetcher: typeof fetch = fetch): Promise<boolean> {
  const repos = listStatusRepos(ctx);
  if (repos.length === 0) return true;
  const config = readStatusConfig(ctx);
  const targets = targetsOf(config);
  if (!config || targets.length === 0) throw new Error('Thiếu companyId');
  const secrets = new Map<string, Promise<KeychainRead>>();
  let success = true;
  for (const repo of repos) {
    const target = repo.companyId
      ? targets.find((candidate) => candidate.companyId === repo.companyId)
      : targets[0];
    if (!target) {
      success = false;
      ctx.out(`crew-mac status: repo ${repo.projectId} thuộc company không có trong đích gửi; bỏ qua.`);
      continue;
    }
    if (!secrets.has(target.keychainService))
      secrets.set(target.keychainService, readKeychainSecret(ctx, target.keychainService));
    const secret = await secrets.get(target.keychainService);
    if (!secret?.ok) {
      success = false;
      ctx.out(`crew-mac status: không đọc được secret Keychain cho ảnh chụp docs của ${repo.projectId}.`);
      continue;
    }
    try {
      const selected = await snapshotCommit(repo.path);
      const { commit } = selected;
      if (selected.fetchFailed) ctx.out(`Không fetch được origin của ${repo.projectId}`);
      const sent = repo.format === 2 && repo.formatCommit === repo.lastCommit ? repo.formatCommit : undefined;
      if (sent && commit === sent) continue;
      const base =
        repo.format === 2 && repo.formatCommit && isAncestor(repo.path, repo.formatCommit, commit)
          ? repo.formatCommit
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
        companyId: target.companyId,
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
        ctx.out(
          `crew-mac status: ảnh chụp docs của ${repo.projectId} vượt ${DOCS_BODY_MAX_BYTES / 1024 / 1024} MB; sẽ thử lại.`,
        );
        success = false;
        continue;
      }
      const response = await fetcher(`${target.url}/api/plugins/crew.core/webhooks/docs-snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...signCrewBody(body, secret.secret, Math.floor(ctx.now().getTime() / 1000)),
        },
        body,
        signal: AbortSignal.timeout(DOCS_SEND_TIMEOUT_MS),
      });
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      mutateRepos(ctx, (current) =>
        current.map((item) =>
          item.projectId === repo.projectId && item.path === repo.path
            ? { ...item, lastCommit: commit, format: 2 as const, formatCommit: commit }
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
