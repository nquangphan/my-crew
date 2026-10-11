import { createHash, randomBytes } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseLauncher } from './launcher.js';
import { macPaths } from './paths.js';
import type { CommandRunner } from './system.js';

/** Major tối thiểu, khớp `engines.node` ở gốc repo. */
export const MIN_NODE_MAJOR = 22;
export const BREW_NODE_PATHS: readonly string[] = ['/opt/homebrew/bin/node', '/usr/local/bin/node'];
export const NODE_DIST_URL = 'https://nodejs.org/dist';
export const NO_NODE_MESSAGE = 'Chưa có node dùng được';
/** Shell đăng nhập: phủ nvm (đường đổi theo version) và node owner tự cài vào PATH. */
const LOGIN_SHELL = '/bin/zsh';
const LOGIN_SHELL_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 10_000;
const FETCH_JSON_TIMEOUT_MS = 30_000;
const FETCH_TARBALL_TIMEOUT_MS = 300_000;
const TAR_TIMEOUT_MS = 120_000;

/**
 * `homebrew`: `/opt/homebrew` hoặc `/usr/local`; `crew`: bản đã tải trước vào `<prefix>/node`; `login-shell`:
 * `command -v node` của shell đăng nhập (nvm); `downloaded`: vừa tải Node LTS.
 */
export type NodeSource = 'homebrew' | 'crew' | 'login-shell' | 'downloaded';

/** Nhãn nguồn hiện cho owner (CLI `crew-mac node`, dòng `node` ở bước Kiểm tra máy). */
export const NODE_SOURCE_LABEL: Record<NodeSource, string> = {
  homebrew: 'Homebrew',
  crew: 'bản đã tải trong ~/.crew/node',
  'login-shell': 'shell đăng nhập',
  downloaded: 'vừa tải Node LTS, checksum khớp',
};

export interface NodeInfo {
  path: string;
  source: NodeSource;
  /** `process.versions.node`, không có tiền tố `v`. */
  version: string;
}

/** Dạng tối thiểu của `fetch` mà bước tải dùng (test thay bằng bản giả). */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface ResolveNodeInput {
  home: string;
  runner: CommandRunner;
  /** Mặc định `BREW_NODE_PATHS`. */
  brewPaths?: readonly string[];
  /** Shell chạy `-ilc 'command -v node'`; mặc định `/bin/zsh`. */
  loginShell?: string;
  /** Thư mục chứa `node/` của Crew; mặc định `~/.crew`. */
  prefix?: string;
  /** Bỏ Homebrew và shell đăng nhập, chỉ xét `<prefix>/node` (để thử đường tải trên máy đã có node). */
  skipSystem?: boolean;
}

export interface EnsureNodeInput extends ResolveNodeInput {
  fetch?: FetchLike;
  /** Mặc định `process.arch`; chỉ nhận `arm64` và `x64`. */
  arch?: string;
}

export function crewPrefix(home: string): string {
  return join(home, '.crew');
}

export function crewNodeBin(prefix: string): string {
  return join(prefix, 'node', 'bin', 'node');
}

/** Đường (sau khi giải symlink) nằm trong một bundle `.app`: binary Electron/Helper, không chạy như node. */
export function isInsideAppBundle(path: string): boolean {
  let real = path;
  try {
    real = realpathSync(path);
  } catch {
    // Không giải được thì xét chính đường đã cho.
  }
  return real.includes('.app/Contents/') || path.includes('.app/Contents/');
}

function majorOf(version: string): number {
  return Number.parseInt(version, 10);
}

/** Chạy `<node> -p process.versions.node`; trả version khi major ≥ 22 và không nằm trong `.app`, ngược lại null. */
export async function probeNode(runner: CommandRunner, path: string): Promise<string | null> {
  if (!isAbsolute(path) || isInsideAppBundle(path)) return null;
  const result = await runner.run(path, ['-p', 'process.versions.node'], { timeoutMs: PROBE_TIMEOUT_MS });
  const version = result.stdout.trim();
  if (result.code !== 0 || !/^\d+\.\d+\.\d+$/.test(version)) return null;
  return majorOf(version) >= MIN_NODE_MAJOR ? version : null;
}

/** Dòng cuối không rỗng của shell đăng nhập; chỉ nhận khi là đường tuyệt đối (shell có thể in rác trước đó). */
async function loginShellNode(runner: CommandRunner, shell: string): Promise<string | null> {
  const result = await runner.run(shell, ['-ilc', 'command -v node'], { timeoutMs: LOGIN_SHELL_TIMEOUT_MS });
  if (result.code !== 0 || result.timedOut) return null;
  const last = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return last !== undefined && isAbsolute(last) ? last : null;
}

/**
 * Dò node dùng được theo thứ tự: Homebrew, `<prefix>/node` (bản đã tải, đặt trước nvm vì đường của nvm đổi theo
 * version), shell đăng nhập. Không tải gì; không thấy thì null.
 */
export async function resolveNode(input: ResolveNodeInput): Promise<NodeInfo | null> {
  const prefix = input.prefix ?? crewPrefix(input.home);
  if (!input.skipSystem) {
    for (const path of input.brewPaths ?? BREW_NODE_PATHS) {
      const version = await probeNode(input.runner, path);
      if (version) return { path, source: 'homebrew', version };
    }
  }
  const crewNode = crewNodeBin(prefix);
  const crewVersion = await probeNode(input.runner, crewNode);
  if (crewVersion) return { path: crewNode, source: 'crew', version: crewVersion };
  if (input.skipSystem) return null;
  const shellNode = await loginShellNode(input.runner, input.loginShell ?? LOGIN_SHELL);
  if (shellNode) {
    const version = await probeNode(input.runner, shellNode);
    if (version) return { path: shellNode, source: 'login-shell', version };
  }
  return null;
}

async function fetchOk(fetchImpl: FetchLike, url: string, timeoutMs: number) {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`Không tải được ${url}: ${(error as Error).message}`);
  }
  if (!response.ok) throw new Error(`Không tải được ${url}: HTTP ${response.status}`);
  return response;
}

/** Bản đầu tiên có `lts` trong `index.json` (mới nhất trước), major ≥ 22. */
export function pickLtsVersion(index: unknown): string {
  if (!Array.isArray(index)) throw new Error('index.json của nodejs.org không đúng dạng');
  for (const entry of index) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { version, lts } = entry as { version?: unknown; lts?: unknown };
    if (typeof lts !== 'string' || lts === '') continue;
    if (typeof version !== 'string' || !/^v\d+\.\d+\.\d+$/.test(version)) continue;
    if (majorOf(version.slice(1)) >= MIN_NODE_MAJOR) return version;
  }
  throw new Error('index.json của nodejs.org không có bản LTS nào');
}

/** sha256 của `file` trong `SHASUMS256.txt`; không có thì ném. */
export function shasumFor(shasums: string, file: string): string {
  for (const line of shasums.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (match && match[2] === file) return match[1] as string;
  }
  throw new Error(`SHASUMS256.txt không có ${file}`);
}

function distArch(arch: string): 'arm64' | 'x64' {
  if (arch === 'arm64' || arch === 'x64') return arch;
  throw new Error(`Không có bản Node cho kiến trúc ${arch}`);
}

/**
 * Tải Node LTS chính thức vào `<prefix>/node`: đọc `index.json`, tải tarball darwin và `SHASUMS256.txt` cùng thư mục,
 * so sha256 (lệch thì bỏ tệp và báo lỗi), giải nén bằng `/usr/bin/tar` vào `<prefix>/node.tmp-<rand>` rồi `rename`
 * nguyên khối thành `<prefix>/node`. Bản cũ (nếu có) bị đổi tên sang chỗ khác trước rồi mới xóa.
 */
export async function downloadNode(input: EnsureNodeInput): Promise<NodeInfo> {
  const fetchImpl = input.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const prefix = input.prefix ?? crewPrefix(input.home);
  const arch = distArch(input.arch ?? process.arch);
  const index = await (await fetchOk(fetchImpl, `${NODE_DIST_URL}/index.json`, FETCH_JSON_TIMEOUT_MS)).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(index);
  } catch {
    throw new Error('index.json của nodejs.org không phải JSON');
  }
  const version = pickLtsVersion(parsed);
  const file = `node-${version}-darwin-${arch}.tar.gz`;
  const base = `${NODE_DIST_URL}/${version}`;
  const shasums = await (await fetchOk(fetchImpl, `${base}/SHASUMS256.txt`, FETCH_JSON_TIMEOUT_MS)).text();
  const expected = shasumFor(shasums, file);

  mkdirSync(prefix, { recursive: true, mode: 0o700 });
  const tag = randomBytes(6).toString('hex');
  const staging = join(prefix, `node.tmp-${tag}`);
  const tarball = join(prefix, `node.tmp-${tag}.tar.gz`);
  const dest = join(prefix, 'node');
  try {
    const body = Buffer.from(
      await (await fetchOk(fetchImpl, `${base}/${file}`, FETCH_TARBALL_TIMEOUT_MS)).arrayBuffer(),
    );
    writeFileSync(tarball, body, { mode: 0o600 });
    const actual = createHash('sha256').update(readFileSync(tarball)).digest('hex');
    if (actual !== expected) {
      throw new Error(`Checksum ${file} không khớp SHASUMS256.txt (cần ${expected}, nhận ${actual})`);
    }
    mkdirSync(staging, { mode: 0o755 });
    const untar = await input.runner.run(
      '/usr/bin/tar',
      ['-xzf', tarball, '-C', staging, '--strip-components', '1'],
      { timeoutMs: TAR_TIMEOUT_MS },
    );
    if (untar.code !== 0) {
      throw new Error(`Giải nén ${file} lỗi (mã ${untar.code}): ${untar.stderr.trim().slice(0, 200)}`);
    }
    const stagedVersion = await probeNode(input.runner, join(staging, 'bin', 'node'));
    if (stagedVersion === null) throw new Error(`Node vừa tải (${file}) không chạy được`);
    if (existsSync(dest)) {
      const old = join(prefix, `node.old-${tag}`);
      renameSync(dest, old);
      renameSync(staging, dest);
      rmSync(old, { recursive: true, force: true });
    } else {
      renameSync(staging, dest);
    }
    return { path: crewNodeBin(prefix), source: 'downloaded', version: stagedVersion };
  } finally {
    rmSync(tarball, { force: true });
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Dò node (`resolveNode`); không có thì tải Node LTS vào `<prefix>/node`. */
export async function ensureNode(input: EnsureNodeInput): Promise<NodeInfo> {
  return (await resolveNode(input)) ?? downloadNode(input);
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface StableNodeInput {
  home: string;
  /** Mặc định `Boolean(process.versions.electron)`. */
  electron?: boolean;
  brewPaths?: readonly string[];
  /** Mặc định `process.execPath`. */
  execPath?: string;
}

/**
 * Node cho launcher/plist, dò đồng bộ: Homebrew, `~/.crew/node`, rồi node mà launcher `~/.crew/bin/crew-mac` đang
 * trỏ tới (nơi lưu bền giữa các lần mở app). Đường trong `.app` không bao giờ được nhận. CLI chạy bằng node thật nên
 * rơi về `execPath`; dưới Electron thì `execPath` là binary của app nên ném `NO_NODE_MESSAGE`.
 */
export function stableNodePath(input: StableNodeInput): string {
  const usable = (path: string) => isAbsolute(path) && executable(path) && !isInsideAppBundle(path);
  for (const path of input.brewPaths ?? BREW_NODE_PATHS) if (usable(path)) return path;
  const crewNode = crewNodeBin(crewPrefix(input.home));
  if (usable(crewNode)) return crewNode;
  try {
    const launcher = parseLauncher(readFileSync(macPaths(input.home).launcher, 'utf8'));
    if (launcher && usable(launcher.nodePath)) return launcher.nodePath;
  } catch {
    // Chưa có launcher.
  }
  const electron = input.electron ?? Boolean(process.versions.electron);
  if (electron) throw new Error(NO_NODE_MESSAGE);
  return input.execPath ?? process.execPath;
}
