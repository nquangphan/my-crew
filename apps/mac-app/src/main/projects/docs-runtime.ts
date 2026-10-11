import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { isInsideAppBundle } from '@crew/mac';
import type { OpsBridge } from '../ops-bridge.js';
import type { GitRunner } from './folder.js';

const GIT_TIMEOUT_MS = 30_000;
export const RUNTIME_KEY = 'crew-docs.runtime';
export const BUNDLE_KEY = 'crew-docs.bundle';
/** Tên file bundle `crew-docs` app mang theo trong `Contents/Resources`. */
export const SHIPPED_BUNDLE_NAME = 'crew-docs.cjs';

/** Bundle `crew-docs` app cài cho máy: nơi hook và agent của mọi repo trỏ tới khi owner chưa tự đặt. */
export function installedDocsBundle(home: string): string {
  return join(home, '.crew', 'bin', SHIPPED_BUNDLE_NAME);
}

export function isFile(path: string): boolean {
  try {
    return isAbsolute(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

/**
 * Lý do `runtime` không dùng được làm `crew-docs.runtime`, hoặc null nếu dùng được: phải là file thực thi, không nằm
 * trong bundle `.app` và không phải binary đang chạy dưới Electron. App đóng gói với fuse `runAsNode: false`, nên
 * `ELECTRON_RUN_AS_NODE=1 <binary app>` chỉ mở thêm một instance của app (cửa sổ bật lên) rồi thoát 0, hook coi
 * như đạt mà không kiểm gì.
 */
export function runtimeProblem(runtime: string, execPath = electronExecPath()): string | null {
  if (runtime === '') return 'chưa đặt';
  if (!isFile(runtime)) return 'không phải file';
  if (isInsideAppBundle(runtime) || (execPath !== undefined && sameFile(runtime, execPath)))
    return 'là binary của app, không chạy được như node';
  try {
    accessSync(runtime, constants.X_OK);
  } catch {
    return 'không có quyền chạy';
  }
  return null;
}

/** `process.execPath` khi đang chạy dưới Electron (binary của app); chạy bằng node thật thì không có. */
function electronExecPath(): string | undefined {
  return process.versions.electron ? process.execPath : undefined;
}

export interface InstallBundleResult {
  path: string;
  /** `false` khi bản đã cài giống hệt bản mang theo. */
  installed: boolean;
}

/**
 * Chép bundle `crew-docs` app mang theo (`src`) vào `~/.crew/bin/crew-docs.cjs`. Chỉ chép khi chưa có hoặc nội dung
 * khác; ghi file tạm rồi `rename` để hook đang chạy không bao giờ đọc phải file dở.
 */
export function installDocsBundle(src: string, home: string): InstallBundleResult {
  const dest = installedDocsBundle(home);
  if (!isFile(src)) throw new Error(`Không có bundle crew-docs mang theo ở ${src}`);
  const body = readFileSync(src);
  if (isFile(dest) && readFileSync(dest).equals(body)) return { path: dest, installed: false };
  mkdirSync(dirname(dest), { recursive: true, mode: 0o755 });
  const tmp = `${dest}.tmp-${process.pid}`;
  writeFileSync(tmp, body, { mode: 0o644 });
  chmodSync(tmp, 0o644);
  renameSync(tmp, dest);
  return { path: dest, installed: true };
}

export interface RepoRepair {
  repo: string;
  /** Key git config vừa đặt lại (`crew-docs.runtime`, `crew-docs.bundle`). */
  fixed: string[];
  /** Vì sao còn hỏng mà không sửa (không có node, git lỗi). */
  skipped?: string;
}

export interface RepairDeps {
  env: NodeJS.ProcessEnv;
  git: GitRunner;
  /** Bundle đã cài ở `~/.crew/bin/crew-docs.cjs`; null khi không cài được. */
  bundle: string | null;
  /** Node thật cho `crew-docs.runtime` (dò, không có thì tải); null khi không có. Chỉ gọi khi cần. */
  nodePath(): Promise<string | null>;
  execPath?: string;
}

/**
 * Sửa git config crew-docs của các repo app đã biết. Repo chưa đặt cả hai key (không dùng crew-docs) thì bỏ qua.
 * `crew-docs.runtime` hỏng (thiếu, không phải file, nằm trong `.app`) thì đặt sang node thật; không có node thì để
 * nguyên. `crew-docs.bundle` không còn là file thì trỏ về bundle đã cài. Giá trị còn dùng được thì giữ nguyên.
 */
export async function repairDocsConfig(repos: string[], deps: RepairDeps): Promise<RepoRepair[]> {
  const run = (args: string[]) => deps.git(args, { env: deps.env, timeoutMs: GIT_TIMEOUT_MS });
  let node: Promise<string | null> | null = null;
  const nodePath = () => {
    node ??= deps.nodePath();
    return node;
  };
  const out: RepoRepair[] = [];
  for (const repo of repos) {
    const get = async (key: string) => {
      const r = await run(['-C', repo, 'config', '--get', key]);
      // Mã 1: key chưa đặt; mã khác: không phải repo hay git lỗi.
      if (r.code !== 0 && r.code !== 1) throw new Error(`git config --get ${key} mã ${r.code}`);
      return r.code === 0 ? r.stdout.trim() : '';
    };
    const set = async (key: string, value: string) => {
      const r = await run(['-C', repo, 'config', key, value]);
      if (r.code !== 0) throw new Error(`git config ${key} mã ${r.code}`);
    };
    const result: RepoRepair = { repo, fixed: [] };
    try {
      const runtime = await get(RUNTIME_KEY);
      const bundle = await get(BUNDLE_KEY);
      if (runtime === '' && bundle === '') continue;
      if (!isFile(bundle) && deps.bundle !== null && isFile(deps.bundle)) {
        await set(BUNDLE_KEY, deps.bundle);
        result.fixed.push(BUNDLE_KEY);
      }
      if (runtimeProblem(runtime, deps.execPath) !== null) {
        const found = await nodePath();
        if (found !== null && runtimeProblem(found, deps.execPath) === null) {
          await set(RUNTIME_KEY, found);
          result.fixed.push(RUNTIME_KEY);
        } else {
          result.skipped = `${RUNTIME_KEY} hỏng mà chưa có node dùng được`;
        }
      }
    } catch (error) {
      result.skipped = error instanceof Error ? error.message : String(error);
    }
    if (result.fixed.length > 0 || result.skipped) out.push(result);
  }
  return out;
}

export interface DocsRepairReport {
  bundle: InstallBundleResult | { error: string };
  /** Node dùng cho `crew-docs.runtime`, null khi không cần hoặc không có. */
  node: string | null;
  nodeError?: string;
  repos: RepoRepair[];
  /** Không đọc được danh sách repo hay sửa dở. */
  error?: string;
}

/**
 * Lúc app mở: cài bundle `crew-docs` mang theo và tự sửa git config crew-docs của các repo đã biết (chạy trong
 * utilityProcess). Không bao giờ ném: mọi lỗi chỉ ghi vào `app.log`, không chặn app mở.
 */
export async function repairDocsOnStart(deps: {
  ops: Pick<OpsBridge, 'call'>;
  resourcesPath: string;
  log: (level: 'info' | 'warn', event: string, fields?: Record<string, unknown>) => void;
}): Promise<void> {
  let report: DocsRepairReport;
  try {
    report = await deps.ops.call('repairDocsHooks', join(deps.resourcesPath, SHIPPED_BUNDLE_NAME));
  } catch (error) {
    deps.log('warn', 'docs-repair-failed', { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  if ('error' in report.bundle)
    deps.log('warn', 'docs-bundle-install-failed', { error: report.bundle.error });
  else if (report.bundle.installed) deps.log('info', 'docs-bundle-installed', { path: report.bundle.path });
  if (report.nodeError) deps.log('warn', 'docs-node-missing', { error: report.nodeError });
  if (report.error) deps.log('warn', 'docs-repair-failed', { error: report.error });
  for (const repo of report.repos) {
    if (repo.fixed.length > 0)
      deps.log('info', 'docs-hooks-repaired', { repo: repo.repo, fixed: repo.fixed, runtime: report.node });
    if (repo.skipped)
      deps.log('warn', 'docs-hooks-repair-skipped', { repo: repo.repo, reason: repo.skipped });
  }
}
