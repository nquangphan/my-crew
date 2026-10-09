import { statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { forbiddenRootReason } from '@crew/mac';
import type { AddProjectInput } from '../../shared/ipc-contract.js';
import type { ProjectProgress } from '../app-state.js';
import type { PaperclipEnvironment, ProjectRoles } from '../paperclip/types.js';
import {
  agentBranch,
  ensureRuntimeExcluded,
  ensureWorktree,
  type FolderInfo,
  type GitResult,
  type GitRunner,
  hasEntries,
  inspectFolder,
  runGit,
} from './folder.js';
import { pinnedExtraArgs, ROLE_TEMPLATES, renderInstructions, uploadInstructions } from './instructions.js';
import {
  isLegacyProgress,
  KEY_RE,
  ProgressRecorder,
  type ProgressStep,
  type ProjectDeps,
  projectPaths,
  recordName,
  roleNames,
  templateOf,
} from './progress.js';

const LOCAL_GIT_TIMEOUT_MS = 30_000;

/** Một project chỉ chạy một lần thêm tại một thời điểm (hai lần bấm "Chạy tiếp" liền nhau). */
const running = new Set<string>();

function validateInput(input: AddProjectInput): void {
  if (typeof input.key !== 'string' || !KEY_RE.test(input.key)) {
    throw new Error('Khóa project chỉ gồm chữ thường, số, dấu gạch ngang, bắt đầu bằng chữ, dài 2–31 ký tự');
  }
  if (input.executors !== 1 && input.executors !== 2) throw new Error('Số executor phải là 1 hoặc 2');
  if (typeof input.name !== 'string' || input.name.trim() === '' || input.name.length > 120) {
    throw new Error('Tên project không được trống (tối đa 120 ký tự)');
  }
  if (typeof input.folder !== 'string' || input.folder === '' || input.folder.length > 4096) {
    throw new Error('Chưa chọn folder project');
  }
}

/**
 * Thêm project vào Mac và Paperclip từ một folder repo git có sẵn trên máy (không clone). Mỗi bước bỏ qua nếu đã có
 * trong `progress.done`; mỗi id tạo ra được ghi vào `app.json` ngay sau khi có. Lỗi ở một bước thì ghi
 * `progress.error`, pause mọi agent của project đã tạo, rồi trả tiến độ (không ném); chạy lại tiếp từ bước dở. Dữ liệu
 * vào sai, folder không dùng được, company chưa chọn hay thư mục checkout đã có thì ném trước mọi lời gọi.
 */
export async function addProject(deps: ProjectDeps, input: AddProjectInput): Promise<ProjectProgress> {
  validateInput(input);
  const companyId = deps.store.get().setup.companyId;
  if (!companyId) throw new Error('Chưa chọn company Paperclip (mục Cài đặt)');
  const paths = projectPaths(deps.home, input.key);
  const roles = roleNames(input.executors);
  for (const dir of roles.map(paths.checkout)) {
    const reason = forbiddenRootReason(deps.home, dir);
    if (reason) throw new Error(`${dir}: ${reason}`);
  }
  if (running.has(input.key)) throw new Error(`Project ${input.key} đang được thêm`);
  const info = await inspectFolder(input.folder, { home: deps.home, env: deps.env });

  const all = deps.store.get().projects;
  const sameFolder = Object.values(all).find((p) => p.key !== input.key && p.folder === info.root);
  if (sameFolder) throw new Error(`Folder ${info.root} đã được thêm với khóa ${sameFolder.key}`);

  let existing: ProjectProgress | undefined = all[input.key];
  if (existing && isLegacyProgress(existing)) {
    const started = !!existing.projectId || Object.keys(existing.agents).length > 0;
    if (started) {
      throw new Error(
        `Tiến độ thêm "${input.key}" là kiểu cũ (URL git, bản trước): bấm "Gỡ khỏi Mac" rồi thêm lại bằng Chọn folder`,
      );
    }
    existing = undefined;
  }
  if (existing && existing.folder !== info.root) {
    const untouched =
      existing.done.length === 0 && !existing.projectId && Object.keys(existing.agents).length === 0;
    if (!untouched) throw new Error(`Khóa ${input.key} đang dùng cho folder khác (${existing.folder})`);
    existing = undefined;
  }
  if (existing) {
    const extra = Object.keys(existing.agents).filter((role) => !roles.includes(role));
    if (extra.length > 0) {
      throw new Error(`Lần trước đã tạo ${extra.join(', ')}: chọn lại đúng số executor như lần trước`);
    }
  } else if (hasEntries(paths.agentsRoot)) {
    throw new Error(`${paths.agentsRoot} đã có trên máy: chọn khóa khác hoặc tự dời thư mục đó`);
  }

  running.add(input.key);
  try {
    const fresh: ProjectProgress = {
      key: input.key,
      folder: info.root,
      projectId: null,
      done: [],
      agents: {},
      error: null,
    };
    await deps.store.update((s) => ({
      ...s,
      projects: { ...s.projects, [input.key]: existing ? { ...existing, error: null } : fresh },
    }));
    const rec = new ProgressRecorder(deps.store, input.key);
    const run = new AddRun(deps, input, companyId, rec, roles, info);
    try {
      await run.all();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.log?.('project-add-failed', { key: input.key, message });
      await run.pauseOwnAgents();
      await rec.setError(message);
    }
    return rec.get();
  } finally {
    running.delete(input.key);
  }
}

function isFile(path: string): boolean {
  try {
    return isAbsolute(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

class AddRun {
  private readonly paths: ReturnType<typeof projectPaths>;
  private setupInfo: Promise<{ pinDir: string; extraArgs: string[]; port: number }> | null = null;
  private template: Promise<PaperclipEnvironment> | null = null;
  private readonly git: GitRunner = runGit;

  constructor(
    private readonly deps: ProjectDeps,
    private readonly input: AddProjectInput,
    private readonly companyId: string,
    private readonly rec: ProgressRecorder,
    private readonly roles: string[],
    private readonly info: FolderInfo,
  ) {
    this.paths = projectPaths(deps.home, input.key);
  }

  async all(): Promise<void> {
    await this.step('folder', () => this.configureDocs());
    await this.step('project', () => this.ensureProject());
    await this.step('status-repo', () =>
      this.deps.ops.call('addStatusRepo', this.projectId(), this.info.root),
    );
    for (const role of this.roles) await this.step(`role:${role}`, () => this.ensureRole(role));
    await this.step('roles', () =>
      this.deps.client.setRoles(this.companyId, this.projectId(), this.expectedRoles()),
    );
    await this.step('check', () => this.check());
  }

  private async step(name: ProgressStep, fn: () => Promise<unknown>): Promise<void> {
    if (this.rec.get().done.includes(name)) return;
    this.deps.log?.('project-step', { key: this.input.key, step: name });
    await fn();
    await this.rec.markDone(name);
  }

  private projectId(): string {
    const id = this.rec.get().projectId;
    if (!id) throw new Error('Chưa có projectId');
    return id;
  }

  private agentId(role: string): string {
    const id = this.rec.get().agents[role]?.agentId;
    if (!id) throw new Error(`Chưa có agent ${role}`);
    return id;
  }

  private expectedRoles(): ProjectRoles {
    return {
      assistantAgentId: this.agentId('assistant'),
      executorAgentIds: this.roles.filter((r) => r.startsWith('executor-')).map((r) => this.agentId(r)),
      reviewerAgentId: this.agentId('reviewer'),
      integratorAgentId: this.agentId('integrator'),
    };
  }

  private runGit(args: string[], timeoutMs = LOCAL_GIT_TIMEOUT_MS): Promise<GitResult> {
    return this.git(args, { env: this.deps.env, timeoutMs });
  }

  /**
   * Nhánh mặc định có `docs/flows.yaml` thì đặt `crew-docs.bundle` (và `crew-docs.runtime` nếu có) trong git config
   * của repo (chung cho mọi worktree agent). Giá trị owner đã đặt mà còn hợp lệ thì giữ, không ghi đè.
   */
  private async configureDocs(): Promise<void> {
    const dir = this.info.root;
    const tracked = await this.runGit(['-C', dir, 'cat-file', '-e', `${this.info.baseRef}:docs/flows.yaml`]);
    if (tracked.code !== 0) return;
    const current = async (name: string) =>
      (await this.runGit(['-C', dir, 'config', '--get', name])).stdout.trim();
    const set = async (name: string, value: string) => {
      const r = await this.runGit(['-C', dir, 'config', name, value]);
      if (r.code !== 0) throw new Error(`Không đặt được git config ${name} trong ${dir}`);
    };
    if (isFile(await current('crew-docs.bundle'))) return;
    const { bundle, runtime } = await this.resolveDocsBundle();
    await set('crew-docs.bundle', bundle);
    if (runtime && (await current('crew-docs.runtime')) === '') await set('crew-docs.runtime', runtime);
  }

  private async resolveDocsBundle(): Promise<{ bundle: string; runtime: string | null }> {
    for (const repo of await this.deps.ops.call('listStatusRepos')) {
      const bundle = (
        await this.runGit(['-C', repo.path, 'config', '--get', 'crew-docs.bundle'])
      ).stdout.trim();
      if (!isFile(bundle)) continue;
      const runtime = (
        await this.runGit(['-C', repo.path, 'config', '--get', 'crew-docs.runtime'])
      ).stdout.trim();
      return { bundle, runtime: isFile(runtime) ? runtime : null };
    }
    const fallback = join(this.deps.home, '.crew', 'bin', 'crew-docs.cjs');
    if (isFile(fallback)) return { bundle: fallback, runtime: null };
    throw new Error('Không tìm thấy bundle crew-docs (~/.crew/bin/crew-docs.cjs): chạy lại cài đặt máy');
  }

  /** Project cùng tên đã có (kể cả do lần trước tạo mà response bị mất) thì dùng lại, không tạo thêm. */
  private async ensureProject(): Promise<void> {
    if (this.rec.get().projectId) return;
    const name = this.input.name.trim();
    const found = (await this.deps.client.projects(this.companyId)).find((p) => p.name === name);
    const id = found?.id ?? (await this.deps.client.createProject(this.companyId, { name })).id;
    await this.rec.save((p) => ({ ...p, projectId: id }));
  }

  /** `crew-mac setup` (idempotent) cho bản ghim Superpowers và cổng sshd; gọi một lần mỗi lần chạy. */
  private getSetupInfo() {
    this.setupInfo ??= (async () => {
      const report = await this.deps.ops.call('setup', {});
      const extraArgs = pinnedExtraArgs(report.superpowers.dir);
      if (JSON.stringify(extraArgs) !== JSON.stringify(report.superpowers.extraArgs)) {
        throw new Error('extraArgs của crew-mac setup không khớp bản Superpowers đã ghim');
      }
      return { pinDir: report.superpowers.dir, extraArgs, port: report.manifest.port };
    })();
    return this.setupInfo;
  }

  /** Environment SSH `in_place` có sẵn của máy này (cùng cổng sshd): nguồn host, user, known_hosts, secret SSH. */
  private getTemplate(port: number) {
    this.template ??= (async () => {
      const envs = await this.deps.client.environments(this.companyId);
      const candidates = envs
        .filter((env) => {
          const config = env.config;
          const ref = config.privateKeySecretRef as { secretId?: unknown } | undefined;
          return (
            env.status === 'active' &&
            env.driver === 'ssh' &&
            env.metadata?.workspaceRealizationMode === 'in_place' &&
            typeof ref?.secretId === 'string' &&
            typeof config.host === 'string' &&
            typeof config.username === 'string' &&
            config.port === port
          );
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const found = candidates[0];
      if (!found) {
        throw new Error(
          `Paperclip chưa có environment SSH in_place nào của máy này (cổng ${port}) để dùng chung secret SSH`,
        );
      }
      return found;
    })();
    return this.template;
  }

  private async ensureRole(role: string): Promise<void> {
    const checkout = this.paths.checkout(role);
    const name = recordName(this.input.key, role);
    await this.rec.setAgent(role, { checkout });
    const gitDeps = { home: this.deps.home, env: this.deps.env };
    await ensureWorktree(this.info, checkout, agentBranch(this.input.key, role), gitDeps);
    await ensureRuntimeExcluded(checkout, gitDeps);
    const setup = await this.getSetupInfo();
    const { client } = this.deps;

    let environmentId = this.rec.get().agents[role]?.environmentId ?? null;
    if (!environmentId) {
      const lost = (await client.environments(this.companyId)).find(
        (env) => env.name === name && env.status === 'active' && env.config.remoteWorkspacePath === checkout,
      );
      environmentId = lost?.id ?? (await this.createEnvironment(name, role, checkout, setup.port));
      await this.rec.setAgent(role, { environmentId });
    }

    let agentId = this.rec.get().agents[role]?.agentId ?? null;
    if (!agentId) {
      const lost = (await client.agents(this.companyId)).find(
        (agent) =>
          agent.name === name &&
          agent.defaultEnvironmentId === environmentId &&
          agent.status !== 'terminated',
      );
      agentId =
        lost?.id ??
        (
          await client.createAgent(this.companyId, {
            name,
            command: join(this.deps.home, '.crew', 'bin', 'crew-claude-run'),
            extraArgs: setup.extraArgs,
            defaultEnvironmentId: environmentId,
          })
        ).id;
      await this.rec.setAgent(role, { agentId });
    }
    await this.holdPaused(agentId, name);

    const template = templateOf(role);
    const executors =
      template === 'assistant'
        ? this.roles.filter((r) => r.startsWith('executor-')).map((r) => this.agentId(r))
        : [];
    const content = renderInstructions(template, ROLE_TEMPLATES[template], agentId, executors);
    await uploadInstructions(client, agentId, content);
  }

  private async createEnvironment(
    name: string,
    role: string,
    checkout: string,
    port: number,
  ): Promise<string> {
    const template = await this.getTemplate(port);
    const config = template.config;
    const gate = template.metadata?.crewLoadGate as
      | { maxLoad1?: unknown; maxWaitMinutes?: unknown }
      | undefined;
    const created = await this.deps.client.createEnvironment(this.companyId, {
      name,
      description: `Checkout ${role} của project ${this.input.name.trim()} trên Mac`,
      host: config.host as string,
      port,
      username: config.username as string,
      remoteWorkspacePath: checkout,
      privateKeySecretId: (config.privateKeySecretRef as { secretId: string }).secretId,
      knownHosts: typeof config.knownHosts === 'string' ? config.knownHosts : null,
      ...(typeof gate?.maxLoad1 === 'number' && typeof gate.maxWaitMinutes === 'number'
        ? { crewLoadGate: { maxLoad1: gate.maxLoad1, maxWaitMinutes: gate.maxWaitMinutes } }
        : {}),
    });
    return created.id;
  }

  /**
   * Agent mới phải ở `paused` tới khi vai trò ghi xong. Company bật duyệt agent thì agent ở `pending_approval`: chờ
   * owner duyệt trên web (không pause agent đang chờ, vì pause sẽ bỏ qua bước duyệt), rồi mới pause.
   */
  private async holdPaused(agentId: string, name: string): Promise<void> {
    const { client } = this.deps;
    const pollMs = this.deps.approvalPollMs ?? 10_000;
    const timeoutMs = this.deps.approvalTimeoutMs ?? 30 * 60_000;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let agent = await client.getAgent(agentId);
    let waited = 0;
    while (agent?.status === 'pending_approval') {
      if (waited >= timeoutMs) {
        throw new Error(
          `Chờ duyệt agent trên web quá ${Math.round(timeoutMs / 60_000)} phút: duyệt ${name} trên Paperclip rồi bấm Chạy tiếp`,
        );
      }
      this.deps.log?.('project-agent-waiting-approval', { key: this.input.key, agent: name });
      await sleep(pollMs);
      waited += pollMs;
      agent = await client.getAgent(agentId);
    }
    if (!agent) throw new Error(`Agent ${name} không còn trên Paperclip`);
    if (agent.status === 'terminated') throw new Error(`Agent ${name} đã bị terminated trên Paperclip`);
    if (agent.status !== 'paused') await client.pauseAgent(agentId);
  }

  /** Kiểm cuối rồi mới resume agent: worktree sạch nguồn skill, vai trò đọc lại khớp. */
  private async check(): Promise<void> {
    const results = await this.deps.ops.call('doctor', {
      probe: false,
      tccWindow: '1h',
      probeTimeoutSec: 90,
      skipTcc: true,
    });
    const bad = results.filter(
      (r) => (r.id === 'worktree-workflows' || r.id === 'worktree-root') && r.status === 'fail',
    );
    if (bad.length > 0) {
      throw new Error(`Kiểm máy chưa đạt: ${bad.map((r) => `${r.title}: ${r.detail}`).join('; ')}`);
    }
    const { pinDir } = await this.getSetupInfo();
    for (const role of this.roles) {
      const report = await this.deps.ops.call('workflowCheck', {
        root: this.paths.checkout(role),
        pluginDir: pinDir,
      });
      if (!report.ok) throw new Error(`workflow-check của ${role} chưa sạch: ${report.lines.join('; ')}`);
    }
    const expected = this.expectedRoles();
    const saved = await this.deps.client.getRoles(this.companyId, this.projectId());
    if (JSON.stringify(saved) !== JSON.stringify(expected)) {
      throw new Error('Vai trò đọc lại từ Paperclip không khớp vai trò vừa ghi');
    }
    for (const role of this.roles) {
      const id = this.agentId(role);
      const agent = await this.deps.client.getAgent(id);
      if (agent?.status === 'paused') await this.deps.client.resumeAgent(id);
    }
  }

  /**
   * Sau lỗi: pause mọi agent của project đang chạy được (cả agent server đã tạo mà response bị mất, nhận ra bằng tên
   * và environment riêng). Không có environment nào thì chưa thể có agent: không gọi Paperclip.
   */
  async pauseOwnAgents(): Promise<void> {
    const entries = Object.values(this.rec.get().agents);
    const envIds = new Set(entries.map((e) => e.environmentId).filter((id): id is string => !!id));
    if (envIds.size === 0) return;
    const known = new Set(entries.map((e) => e.agentId).filter((id): id is string => !!id));
    const names = new Set(this.roles.map((role) => recordName(this.input.key, role)));
    try {
      for (const agent of await this.deps.client.agents(this.companyId)) {
        const ours =
          known.has(agent.id) ||
          (names.has(agent.name) && !!agent.defaultEnvironmentId && envIds.has(agent.defaultEnvironmentId));
        if (!ours || ['paused', 'terminated', 'pending_approval'].includes(agent.status)) continue;
        await this.deps.client.pauseAgent(agent.id).catch((error: unknown) => {
          this.deps.log?.('project-pause-failed', { agentId: agent.id, message: String(error) });
        });
      }
    } catch (error) {
      this.deps.log?.('project-pause-failed', { key: this.input.key, message: String(error) });
    }
  }
}
