import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { arch, cpus, hostname, platform, release, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import {
  CREW_DOCS_BUNDLE,
  type DaemonConfig,
  type HookInspection,
  inspectFolder,
  inspectHooks,
  installCrewDocs,
  installHooks,
  type ProjectConfig,
  repoFolderChecks,
  runCrewDocs,
  VpsClient,
  VpsError,
} from '@crew/daemon';
import type {
  DesktopParsed,
  FolderValidation,
  PairResult,
  ResourceSettings,
  ServerCheck,
  StatusView,
} from '@crew/shared';
import { type HostContext, HostError } from './host-context.js';

/** The UI text for a server failure: network and TLS problems, refused tokens, contract mismatches. */
export function describeError(error: unknown): string {
  if (error instanceof HostError) return error.message;
  if (error instanceof VpsError) {
    if (error.status === 0) {
      const tls = /certificate|ssl|tls/i.test(error.message) ? ' (chứng chỉ TLS không hợp lệ)' : '';
      return `Không kết nối được server${tls}: ${error.message}`;
    }
    if (error.status === 401) return 'Server từ chối token của máy: ghép lại máy.';
    if (error.code === 'BAD_RESPONSE') return `Server trả lời không đúng hợp đồng API v1: ${error.message}`;
    return error.message;
  }
  return (error as Error).message ?? String(error);
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `GET /v1/health`: reachable, TLS valid (https outside loopback) and the v1 API contract. */
export async function checkServer(ctx: HostContext, apiUrl: string): Promise<ServerCheck> {
  const url = apiUrl.trim().replace(/\/+$/, '');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !LOOPBACK.has(parsed.hostname)) {
    return { ok: false, apiUrl: url, message: 'Server phải dùng https:// (TLS).' };
  }
  const vps = new VpsClient({
    apiUrl: url,
    token: () => null,
    fetch: ctx.deps.fetch,
    attempts: 1,
    timeoutMs: 10_000,
    onError: ctx.logApiError,
  });
  try {
    await vps.health();
    return {
      ok: true,
      apiUrl: url,
      message: 'Server trả lời /v1/health: kết nối, TLS và phiên bản API v1 đều ổn.',
    };
  } catch (error) {
    if (error instanceof VpsError && error.status === 404) {
      return { ok: false, apiUrl: url, message: 'Server không có API /v1: phiên bản API không tương thích.' };
    }
    return { ok: false, apiUrl: url, message: describeError(error) };
  }
}

/** Defaults from the machine: half the CPUs (at most one job per 4 GB of RAM), 15 % of RAM kept free. */
export function suggestResources(cpuCount: number, totalMemGb: number): ResourceSettings {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return {
    maxConcurrentJobs: clamp(Math.min(Math.floor(cpuCount / 2), Math.floor(totalMemGb / 4)), 1, 8),
    minFreeMemGb: clamp(Math.round(totalMemGb * 0.15), 2, 16),
    maxLoadPerCpu: 1.5,
  };
}

/**
 * Pairs this machine with a single-use code. A first pairing also writes resource limits suggested from the
 * machine's CPU and RAM into the local config: the daemon uploads them once as the machine's server setting,
 * which the owner then edits on the web.
 */
export async function pairMachine(ctx: HostContext, input: DesktopParsed<'setup.pair'>): Promise<PairResult> {
  const server = await checkServer(ctx, input.apiUrl);
  if (!server.ok) throw new HostError(server.message);
  const vps = new VpsClient({
    apiUrl: server.apiUrl,
    token: () => null,
    fetch: ctx.deps.fetch,
    onError: ctx.logApiError,
  });
  const cpuCount = Math.max(1, cpus().length);
  const memGb = Math.round(totalmem() / 1024 ** 3);
  const paired = await vps.pair({
    code: input.code,
    name: input.machineName,
    hostname: hostname(),
    os: `${platform()} ${release()}`,
    hardware: { cpus: cpuCount, memGb, arch: arch() },
  });
  ctx.tokenStore.set(paired.token);
  const existing = ctx.config();
  ctx.save({
    ...(existing ?? { resources: suggestResources(cpuCount, memGb) }),
    apiUrl: server.apiUrl,
    machineName: input.machineName,
    machineId: paired.machineId,
  });
  return { machineId: paired.machineId, machineName: input.machineName, expiresAt: paired.expiresAt };
}

export function validateFolder(
  path: string,
  repoUrl: string | null,
  defaultBranch: string,
): FolderValidation {
  const checks = repoFolderChecks({
    idPrefix: 'folder',
    label: basename(path),
    path,
    repoUrl,
    defaultBranch,
    pushProbe: true,
  });
  return {
    path: inspectFolder(path).root,
    ok: checks.every((check) => check.status !== 'red'),
    checks,
  };
}

/**
 * The folder picker's convenience: checks the folder here (repo, the project's origin and default branch, push
 * access), saves it as this machine's folder of the project on the server (the setting the owner also edits on
 * the web) and in the local config (the fallback while the server is unreachable), then installs the crew-docs
 * hooks unless working ones are there.
 */
export async function setFolder(ctx: HostContext, key: string, path: string): Promise<FolderValidation> {
  const config = ctx.requireConfig();
  await ctx.folderAccess(path);
  const view = (await ctx.vps().listProjects()).items.find((item) => item.key === key);
  if (!view) throw new HostError(`Server không có project ${key}.`);
  const validation = validateFolder(path, view.repoUrl, view.defaultBranch);
  if (!validation.ok) return validation;
  if (ctx.daemon) {
    await ctx.daemon.setProjectFolder(key, { repoPath: validation.path });
  } else {
    await ctx
      .vps()
      .putProjectFolder(key, { repoPath: validation.path }, `project-folder:${key}:${randomUUID()}`);
  }
  const existing = config.projects.find((project) => project.key === key);
  const entry: ProjectConfig = {
    key,
    repoPath: validation.path,
    defaultBranch: view.defaultBranch,
    ...(existing?.testCommand ? { testCommand: existing.testCommand } : {}),
    sharedPaths: existing?.sharedPaths ?? [],
    disabledMcpServers: existing?.disabledMcpServers ?? [],
  };
  ctx.save({
    ...config,
    projects: [...config.projects.filter((project) => project.key !== key), entry],
  });
  ctx.log('info', 'project-folder-set', { project: key, path: validation.path });
  const hookError = ensureHooks(ctx, entry);
  if (!hookError) return validation;
  return {
    ...validation,
    checks: [
      ...validation.checks,
      {
        id: 'folder.hooks',
        group: 'repos',
        title: `Hook crew-docs của ${key}`,
        status: 'yellow',
        detail: `Đã lưu thư mục nhưng chưa cài được hook crew-docs: ${hookError}`,
      },
    ],
  };
}

/**
 * The gateway's status view: the projects this machine holds (or waits for) with the folder it uses and any
 * folder it cannot use, the settings revision, the folders whose macOS permission prompt is open, and links to
 * this machine's pages on the web.
 */
export async function statusView(ctx: HostContext): Promise<StatusView> {
  const config = ctx.config();
  const machineId = config?.machineId ?? null;
  const links = {
    machines: ctx.webUrl('/machines'),
    machineSettings: machineId ? ctx.webUrl(`/settings/machines/${machineId}`) : null,
    systemSettings: ctx.webUrl('/settings'),
  };
  const empty: StatusView = {
    machineId,
    projects: [],
    assistant: 'unowned',
    settings: ctx.daemon?.status().settings ?? null,
    folderAccessWaiting: ctx.foldersWaiting(),
    links,
  };
  if (!config?.machineId || !ctx.tokenStore.get()) return empty;
  const view = await ctx.vps().listProjects();
  const folders = new Map(ctx.projects().map((project) => [project.key, project.repoPath]));
  const problems = ctx.daemon?.folderProblems() ?? new Map<string, string>();
  return {
    ...empty,
    assistant: view.assistant.state,
    projects: view.items
      .filter((item) => item.ownerState === 'mine' || item.pendingClaim || folders.has(item.key))
      .map((item) => ({
        key: item.key,
        name: item.name,
        ownerState: item.ownerState,
        localPath: folders.get(item.key) ?? null,
        folderProblem: problems.get(item.key) ?? null,
        webUrl: ctx.webUrl(`/projects/${item.key}/settings`),
      })),
  };
}

function crewDocsBundle(ctx: HostContext, refresh: boolean): string {
  const bundle = join(ctx.paths.bin, CREW_DOCS_BUNDLE);
  if (refresh || !existsSync(bundle))
    installCrewDocs(ctx.paths.bin, ctx.deps.crewDocsSource, ctx.deps.runtime);
  return bundle;
}

/** Copies the shipped crew-docs bundle to `~/.crew/bin` (first run and every app update). */
export function installShippedCrewDocs(ctx: HostContext): void {
  crewDocsBundle(ctx, true);
}

/** The machine's crew-docs bundle in `~/.crew/bin` and its version, run by the app binary. */
function machineCrewDocs(ctx: HostContext): { bundle: string; version: string | null } {
  const bundle = crewDocsBundle(ctx, false);
  const run = runCrewDocs(bundle, ['--version'], ctx.paths.bin, ctx.deps.runtime);
  return { bundle, version: run.code === 0 ? run.stdout.trim() : null };
}

function inspectProjectHooks(ctx: HostContext, project: ProjectConfig): HookInspection {
  return inspectHooks(project.repoPath, machineCrewDocs(ctx));
}

/**
 * Installs a project folder's crew-docs hooks unless working hooks are already there, whoever installed them
 * (the app binary or the CLI's node): a working setup is never rewritten, and a stale but working one keeps
 * its runtime. Returns why the install failed, or null when the hooks work.
 */
export function ensureHooks(ctx: HostContext, project: ProjectConfig): string | null {
  try {
    const current = inspectProjectHooks(ctx, project);
    if (current.state === 'ok') return null;
    const runtime = current.state === 'stale' && current.runtime ? current.runtime : ctx.deps.runtime;
    const installed = installHooks(project.repoPath, crewDocsBundle(ctx, false), runtime);
    if (installed.code !== 0) {
      const reason = (installed.stderr || installed.stdout).trim() || `mã thoát ${installed.code}`;
      ctx.log('warn', 'hooks-install-failed', { project: project.key, state: current.state, error: reason });
      return reason;
    }
    ctx.log('info', 'hooks-installed', { project: project.key, previous: current.state, runtime });
    return null;
  } catch (error) {
    const reason = describeError(error);
    ctx.log('warn', 'hooks-install-failed', { project: project.key, error: reason });
    return reason;
  }
}

/**
 * At start: hooks whose runtime or bundle no longer runs (the app was moved, for example out of a mounted dmg
 * or macOS App Translocation) block every commit of the owner, so they are reinstalled at once. Hooks that
 * work, and repos without hooks, are left alone.
 */
export function repairBrokenHooks(ctx: HostContext): void {
  let config: DaemonConfig | null;
  try {
    config = ctx.config();
  } catch {
    return;
  }
  for (const project of ctx.daemon ? ctx.projects() : (config?.projects ?? [])) {
    if (!existsSync(project.repoPath)) continue;
    try {
      const current = inspectProjectHooks(ctx, project);
      if (current.state !== 'broken') continue;
      ctx.log('warn', 'hooks-broken', { project: project.key, detail: current.detail });
      ensureHooks(ctx, project);
    } catch (error) {
      ctx.log('warn', 'hooks-repair-failed', { project: project.key, error: describeError(error) });
    }
  }
}
