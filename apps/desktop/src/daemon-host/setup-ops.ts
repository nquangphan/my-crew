import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { arch, cpus, hostname, platform, release, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import {
  CREW_DOCS_BUNDLE,
  type DaemonConfig,
  detectSharedPaths,
  type HookInspection,
  inspectFolder,
  inspectHooks,
  installCrewDocs,
  installHooks,
  type ProjectConfig,
  repoFolderChecks,
  runCrewDocs,
  sameRepo,
  suggestProjectKey,
  VpsClient,
  VpsError,
} from '@crew/daemon';
import {
  type ClaimOutcome,
  type DaemonProject,
  type DesktopParsed,
  type FolderInfo,
  type FolderValidation,
  type HookView,
  type PairResult,
  type ProjectDetail,
  type ProjectsView,
  qcDefaultMcps,
  type ResourceSettings,
  type ResourcesView,
  type ServerCheck,
  SkillInventory,
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

export async function pairMachine(ctx: HostContext, input: DesktopParsed<'setup.pair'>): Promise<PairResult> {
  const server = await checkServer(ctx, input.apiUrl);
  if (!server.ok) throw new HostError(server.message);
  const vps = new VpsClient({
    apiUrl: server.apiUrl,
    token: () => null,
    fetch: ctx.deps.fetch,
    onError: ctx.logApiError,
  });
  const paired = await vps.pair({
    code: input.code,
    name: input.machineName,
    hostname: hostname(),
    os: `${platform()} ${release()}`,
    hardware: { cpus: Math.max(1, cpus().length), memGb: Math.round(totalmem() / 1024 ** 3), arch: arch() },
  });
  ctx.tokenStore.set(paired.token);
  const existing = ctx.config();
  ctx.save({
    ...(existing ?? {}),
    apiUrl: server.apiUrl,
    machineName: input.machineName,
    machineId: paired.machineId,
  });
  return { machineId: paired.machineId, machineName: input.machineName, expiresAt: paired.expiresAt };
}

export function folderInfo(path: string): FolderInfo {
  const folder = inspectFolder(path);
  return {
    path: folder.root,
    isRepo: folder.isRepo,
    origin: folder.origin,
    defaultBranch: folder.defaultBranch,
    suggestedKey: suggestProjectKey(folder.root),
    suggestedName: basename(folder.root),
  };
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

export async function listProjects(ctx: HostContext): Promise<ProjectsView> {
  const config = ctx.requireConfig();
  const view = await ctx.vps().listProjects();
  const local = new Map(config.projects.map((project) => [project.key, project.repoPath]));
  return {
    items: view.items.map((item) => ({ ...item, localPath: local.get(item.key) ?? null })),
    assistant: view.assistant,
  };
}

function withProject(config: DaemonConfig, entry: ProjectConfig): DaemonConfig['projects'] {
  return [...config.projects.filter((project) => project.key !== entry.key), entry];
}

function localEntry(
  config: DaemonConfig,
  key: string,
  repoPath: string,
  defaultBranch: string,
): ProjectConfig {
  const existing = config.projects.find((project) => project.key === key);
  return {
    key,
    repoPath,
    defaultBranch,
    ...(existing?.testCommand ? { testCommand: existing.testCommand } : {}),
    sharedPaths: existing?.sharedPaths ?? [],
    disabledMcpServers: existing?.disabledMcpServers ?? [],
  };
}

async function claimProject(ctx: HostContext, view: DaemonProject): Promise<ClaimOutcome> {
  if (view.ownerState === 'mine') {
    return { target: view.key, status: 'already_owned', message: `Máy này đã sở hữu ${view.key}.` };
  }
  if (view.pendingClaim) {
    return { target: view.key, status: 'pending', message: 'Đang chờ duyệt trên web.' };
  }
  const claimed = await ctx.vps().claim({ projectKey: view.key }, `claim:${view.key}:${randomUUID()}`);
  return claimed.status === 'pending'
    ? {
        target: view.key,
        status: 'pending',
        message: `Đang chờ duyệt trên web (${view.key} đang thuộc máy ${view.ownerMachineName ?? 'khác'}).`,
      }
    : { target: view.key, status: claimed.status, message: `Máy này đã nhận ${view.key}.` };
}

/** Claims the assistant role, or releases it (or withdraws a pending request). */
export async function setAssistant(ctx: HostContext, enabled: boolean): Promise<ClaimOutcome> {
  const { assistant } = await ctx.vps().listProjects();
  const held = assistant.state === 'mine' || assistant.pendingClaim;
  if (enabled === held) {
    return {
      target: 'assistant',
      status: 'unchanged',
      message: enabled
        ? assistant.pendingClaim
          ? 'Vai trò trợ lý đang chờ duyệt trên web.'
          : 'Máy này đang là trợ lý.'
        : 'Máy này không làm trợ lý.',
    };
  }
  if (enabled) {
    const claimed = await ctx.vps().claim({ hostsAssistant: true }, `claim:assistant:${randomUUID()}`);
    return claimed.status === 'pending'
      ? {
          target: 'assistant',
          status: 'pending',
          message: `Đang chờ duyệt trên web (trợ lý đang ở máy ${assistant.hostName ?? 'khác'}).`,
        }
      : { target: 'assistant', status: claimed.status, message: 'Máy này là trợ lý.' };
  }
  const released = await ctx.vps().release({ hostsAssistant: true }, `release:assistant:${randomUUID()}`);
  return {
    target: 'assistant',
    status: released.status,
    message: released.status === 'withdrawn' ? 'Đã rút yêu cầu làm trợ lý.' : 'Đã trả vai trò trợ lý.',
  };
}

/**
 * The wizard's project step: every ticked project gets its folder validated, then claimed (at once when
 * unowned; pending the owner's approval when another machine holds it) and saved to the local config. A
 * pending project is saved too: the daemon starts its jobs once the owner approves.
 */
export async function applyProjects(
  ctx: HostContext,
  input: DesktopParsed<'projects.apply'>,
): Promise<ClaimOutcome[]> {
  const view = await ctx.vps().listProjects();
  const byKey = new Map(view.items.map((item) => [item.key, item]));
  const outcomes: ClaimOutcome[] = [];
  let config = ctx.requireConfig();
  for (const selection of input.selections) {
    const project = byKey.get(selection.key);
    if (!project) {
      outcomes.push({
        target: selection.key,
        status: 'error',
        message: `Server không có project ${selection.key}.`,
      });
      continue;
    }
    const validation = validateFolder(selection.path, project.repoUrl, project.defaultBranch);
    const failed = validation.checks.find((check) => check.status === 'red');
    if (failed) {
      outcomes.push({ target: selection.key, status: 'error', message: `${failed.title}: ${failed.detail}` });
      continue;
    }
    try {
      const outcome = await claimProject(ctx, project);
      const entry = localEntry(config, project.key, validation.path, project.defaultBranch);
      config = ctx.save({ ...config, projects: withProject(config, entry) });
      outcomes.push(withHookNote(outcome, ensureHooks(ctx, entry)));
    } catch (error) {
      outcomes.push({ target: selection.key, status: 'error', message: describeError(error) });
    }
  }
  try {
    outcomes.push(await setAssistant(ctx, input.assistant));
  } catch (error) {
    outcomes.push({ target: 'assistant', status: 'error', message: describeError(error) });
  }
  await ctx.daemon?.refreshProjects().catch(() => undefined);
  return outcomes;
}

/**
 * "Thêm project mới từ thư mục": the server creates the project owned by this machine, the folder is saved and
 * the crew-docs hooks are installed. Creating again a key this machine already owns with the same repo (a
 * retry after a lost answer, or a second click) is the same success; any other existing key is a clear 409.
 */
export async function createProject(
  ctx: HostContext,
  input: DesktopParsed<'projects.create'>,
): Promise<ClaimOutcome> {
  const { path, ...project } = input;
  const folder = inspectFolder(path);
  if (!folder.isRepo) throw new HostError(`${path} không phải repo git.`);
  const validation = validateFolder(folder.root, project.repoUrl, project.defaultBranch ?? 'main');
  const failed = validation.checks.find((check) => check.status === 'red');
  if (failed) throw new HostError(`${failed.title}: ${failed.detail}`);
  let created: { key: string; defaultBranch: string };
  let outcome: ClaimOutcome;
  try {
    created = await ctx.vps().createProject(project, `project-create:${project.key}:${randomUUID()}`);
    outcome = {
      target: created.key,
      status: 'granted',
      message: `Đã tạo project ${created.key}; máy này sở hữu nó.`,
    };
  } catch (error) {
    if (!(error instanceof VpsError && error.status === 409)) throw error;
    const existing = await ctx
      .vps()
      .listProjects()
      .then((view) => view.items.find((item) => item.key === project.key))
      .catch(() => undefined);
    if (existing?.ownerState !== 'mine' || !sameRepo(existing.repoUrl, project.repoUrl)) {
      throw new HostError(
        `Key ${project.key} đã có trên server: chọn key khác, hoặc tick project đó trong danh sách.`,
      );
    }
    created = existing;
    outcome = {
      target: existing.key,
      status: 'already_owned',
      message: `Project ${existing.key} đã được tạo trước đó và thuộc máy này; đã lưu thư mục.`,
    };
    ctx.log('info', 'project-create-idempotent', { project: existing.key });
  }
  const config = ctx.requireConfig();
  const entry = localEntry(config, created.key, folder.root, created.defaultBranch);
  ctx.save({ ...config, projects: withProject(config, entry) });
  const hookError = ensureHooks(ctx, entry);
  await ctx.daemon?.refreshProjects().catch(() => undefined);
  return withHookNote(outcome, hookError);
}

export async function setFolder(ctx: HostContext, key: string, path: string): Promise<FolderValidation> {
  const config = ctx.requireConfig();
  const view = (await ctx.vps().listProjects()).items.find((item) => item.key === key);
  if (!view) throw new HostError(`Server không có project ${key}.`);
  const validation = validateFolder(path, view.repoUrl, view.defaultBranch);
  if (!validation.ok) return validation;
  const entry = localEntry(config, key, validation.path, view.defaultBranch);
  ctx.save({ ...config, projects: withProject(config, entry) });
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

/** Releases a project (or withdraws a pending claim) and forgets its folder. Its open tickets become unowned. */
export async function releaseProject(ctx: HostContext, key: string): Promise<ClaimOutcome> {
  const config = ctx.requireConfig();
  let outcome: ClaimOutcome;
  try {
    const released = await ctx.vps().release({ projectKey: key }, `release:${key}:${randomUUID()}`);
    outcome = {
      target: key,
      status: released.status,
      message:
        released.status === 'withdrawn'
          ? `Đã rút yêu cầu nhận ${key}.`
          : `Đã trả ${key}; các ticket đang mở chờ máy khác nhận.`,
    };
  } catch (error) {
    if (!(error instanceof VpsError && error.status === 409)) throw error;
    outcome = {
      target: key,
      status: 'unchanged',
      message: `Máy này không giữ ${key}; đã bỏ thư mục khỏi máy.`,
    };
  }
  ctx.save({ ...config, projects: config.projects.filter((project) => project.key !== key) });
  await ctx.daemon?.refreshProjects().catch(() => undefined);
  return outcome;
}

/** The inventory the running daemon last probed in the project's job-like worktree. */
function storedInventoryOf(ctx: HostContext, key: string): SkillInventory | null {
  const raw = ctx.daemon?.state.getMeta(`inventory:${key}`);
  if (!raw) return null;
  const parsed = SkillInventory.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

export async function projectDetail(ctx: HostContext, key: string): Promise<ProjectDetail> {
  const config = ctx.requireConfig();
  const project = config.projects.find((item) => item.key === key) ?? null;
  let view: DaemonProject | undefined;
  try {
    view = (await ctx.vps().listProjects()).items.find((item) => item.key === key);
  } catch {
    view = undefined;
  }
  const detected =
    project && existsSync(project.repoPath) ? detectSharedPaths(project.repoPath, []) : ([] as string[]);
  return {
    key,
    localPath: project?.repoPath ?? null,
    platform: view?.platform ?? null,
    uiTestMcp: view?.uiTestMcp ?? null,
    requiredMcps: view ? qcDefaultMcps(view.platform, view.uiTestMcp) : [],
    inventory: storedInventoryOf(ctx, key),
    disabledMcpServers: project?.disabledMcpServers ?? [],
    sharedPaths: { detected, extra: project?.sharedPaths ?? [] },
    webSettingsUrl: ctx.webUrl(`/projects/${key}/settings`),
    pendingChange: view?.pendingChange ?? null,
    lastChange: view?.lastChange ?? null,
  };
}

/**
 * Asks the owner to change the project type and UI-test MCP mapping. The server keeps the request pending
 * until the owner approves it on the web with a TOTP; only the machine that owns the project may ask.
 */
export async function requestTestSetup(
  ctx: HostContext,
  input: DesktopParsed<'projects.requestTestSetup'>,
): Promise<ProjectDetail> {
  const { key, ...setup } = input;
  try {
    await ctx.vps().requestProjectChange(key, setup, `project-change:${key}:${randomUUID()}`);
  } catch (error) {
    if (error instanceof VpsError && error.status === 403) {
      throw new HostError(`Máy này không sở hữu project ${key} nên không đổi được loại project.`);
    }
    if (error instanceof VpsError && error.status === 409) {
      throw new HostError('Đã có một thay đổi khác đang chờ chủ dự án xác nhận.');
    }
    throw error;
  }
  return projectDetail(ctx, key);
}

export function updateProject(
  ctx: HostContext,
  key: string,
  change: (project: ProjectConfig) => ProjectConfig,
): void {
  const config = ctx.requireConfig();
  if (!config.projects.some((project) => project.key === key)) {
    throw new HostError(`Máy này chưa có thư mục cho ${key}.`);
  }
  ctx.save({
    ...config,
    projects: config.projects.map((project) => (project.key === key ? change(project) : project)),
  });
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
  for (const project of config?.projects ?? []) {
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

/** Appends a failed hook install to an outcome; the project itself was saved. */
function withHookNote(outcome: ClaimOutcome, hookError: string | null): ClaimOutcome {
  if (!hookError) return outcome;
  return {
    ...outcome,
    message: `${outcome.message} Chưa cài được hook crew-docs (${hookError}): cài lại ở bảng sức khỏe.`,
  };
}

function hookView(ctx: HostContext, project: ProjectConfig, docsStatus: string | null): HookView {
  const hooks = inspectProjectHooks(ctx, project);
  return {
    key: project.key,
    path: project.repoPath,
    installed: hooks.state === 'ok' || hooks.state === 'stale',
    current: hooks.state === 'ok',
    detail: hooks.detail,
    docsInitialized: existsSync(join(project.repoPath, 'docs', 'flows.yaml')),
    docsStatus,
  };
}

async function docsStatuses(ctx: HostContext): Promise<Map<string, string>> {
  try {
    return new Map((await ctx.vps().listProjects()).items.map((item) => [item.key, item.docsStatus]));
  } catch {
    return new Map();
  }
}

export async function listHooks(ctx: HostContext): Promise<HookView[]> {
  const config = ctx.requireConfig();
  const docs = await docsStatuses(ctx);
  return config.projects.map((project) => hookView(ctx, project, docs.get(project.key) ?? null));
}

/** Installs the crew-docs hooks (the app binary as the runtime) unless working hooks are already there. */
export async function installProjectHooks(ctx: HostContext, key: string): Promise<HookView> {
  const project = ctx.requireConfig().projects.find((item) => item.key === key);
  if (!project) throw new HostError(`Máy này chưa có thư mục cho ${key}.`);
  const failed = ensureHooks(ctx, project);
  if (failed) throw new HostError(`Cài hook thất bại: ${failed}`);
  const docs = await docsStatuses(ctx);
  return hookView(ctx, project, docs.get(key) ?? null);
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

export function resourcesView(ctx: HostContext): ResourcesView {
  const config = ctx.requireConfig();
  const machine = { cpus: Math.max(1, cpus().length), totalMemGb: Math.round(totalmem() / 1024 ** 3) };
  return {
    resources: config.resources,
    models: config.models,
    suggested: suggestResources(machine.cpus, machine.totalMemGb),
    machine,
  };
}

export function saveResources(ctx: HostContext, input: DesktopParsed<'config.saveResources'>): ResourcesView {
  const config = ctx.requireConfig();
  ctx.save({ ...config, resources: input.resources, models: input.models });
  return resourcesView(ctx);
}
