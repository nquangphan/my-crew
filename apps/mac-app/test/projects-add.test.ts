import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppStateStore } from '../src/main/app-state.js';
import { addProject } from '../src/main/projects/add-project.js';
import { ROLE_TEMPLATES } from '../src/main/projects/instructions.js';
import type { ProjectDeps } from '../src/main/projects/progress.js';
import {
  baseDeps,
  COMPANY,
  fakeOps,
  makeSandbox,
  makeStore,
  SECRET,
  startStatefulPaperclip,
  TEMPLATE_ENV,
} from './projects-fixture.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

async function world(opts: Parameters<typeof startStatefulPaperclip>[0] = {}) {
  const sandbox = makeSandbox();
  cleanups.push(sandbox.cleanup);
  const paperclip = await startStatefulPaperclip(opts);
  cleanups.push(paperclip.close);
  const store: AppStateStore = await makeStore(sandbox.root);
  const fake = fakeOps(sandbox.home);
  const deps: ProjectDeps = baseDeps(sandbox, paperclip, fake.ops, store);
  const input = { origin: sandbox.origin, name: 'Landing', key: 'landing', executors: 1 as const };
  return { sandbox, paperclip, store, fake, deps, input };
}

const ALL_ONE = [
  'ls-remote',
  'mirror',
  'project',
  'status-repo',
  'role:executor-1',
  'role:assistant',
  'role:reviewer',
  'role:integrator',
  'roles',
  'check',
];

const posts = (requests: { method: string; path: string }[], suffix: string) =>
  requests.filter((r) => r.method === 'POST' && r.path.endsWith(suffix)).length;

describe('addProject', () => {
  it('chạy đủ: 4 agent + 4 environment, vai trò ghi đúng, agent pause tới khi vai trò ghi xong', async () => {
    const { sandbox, paperclip, fake, deps, input } = await world();
    const progress = await addProject(deps, input);

    expect(progress.error).toBeNull();
    expect(progress.done).toEqual(ALL_ONE);
    expect(paperclip.projects.size).toBe(1);
    const projectId = [...paperclip.projects.keys()][0] as string;
    expect(progress.projectId).toBe(projectId);
    expect(paperclip.agents.size).toBe(4);
    expect(paperclip.envs.size).toBe(5); // mẫu + 4

    const mirror = join(sandbox.home, 'crew-projects', 'landing');
    expect(sandbox.git(['-C', mirror, 'config', '--get', 'crew-docs.bundle'])).toBe(
      join(sandbox.home, '.crew', 'bin', 'crew-docs.cjs'),
    );
    expect(fake.calls.find((c) => c.op === 'addStatusRepo')?.args).toEqual([projectId, mirror]);

    const byRole = progress.agents;
    expect(Object.keys(byRole).sort()).toEqual(['assistant', 'executor-1', 'integrator', 'reviewer']);
    for (const [role, entry] of Object.entries(byRole)) {
      const checkout = join(sandbox.home, 'crew-agents', 'landing', role);
      expect(entry.checkout).toBe(checkout);
      expect(sandbox.git(['-C', checkout, 'remote', 'get-url', 'origin'])).toBe(sandbox.origin);
      expect(readFileSync(join(checkout, '.git', 'info', 'exclude'), 'utf8')).toContain(
        '.paperclip-runtime/',
      );

      const agent = paperclip.agents.get(entry.agentId as string);
      expect(agent?.name).toBe(`landing-${role}`);
      expect(agent?.adapterType).toBe('claude_local');
      expect(agent?.adapterConfig.command).toBe(join(sandbox.home, '.crew', 'bin', 'crew-claude-run'));
      expect(agent?.adapterConfig.extraArgs).toEqual([
        '--setting-sources',
        'project,local',
        '--plugin-dir',
        fake.pinDir,
      ]);
      expect(agent?.runtimeConfig).toEqual({ heartbeat: { enabled: false, maxConcurrentRuns: 1 } });
      expect(agent?.defaultEnvironmentId).toBe(entry.environmentId);
      expect(agent?.status).toBe('idle');

      const env = paperclip.envs.get(entry.environmentId as string);
      expect(env?.driver).toBe('ssh');
      expect(env?.config).toMatchObject({
        host: '100.64.1.2',
        port: 2222,
        username: 'owner',
        remoteWorkspacePath: checkout,
        privateKeySecretRef: { secretId: SECRET },
        strictHostKeyChecking: true,
      });
      expect(env?.metadata).toEqual({
        workspaceRealizationMode: 'in_place',
        crewLoadGate: { maxLoad1: 6, maxWaitMinutes: 30 },
      });
    }

    const ids = (role: string) => byRole[role]?.agentId as string;
    expect(paperclip.roles.get(projectId)).toEqual({
      assistantAgentId: ids('assistant'),
      executorAgentIds: [ids('executor-1')],
      reviewerAgentId: ids('reviewer'),
      integratorAgentId: ids('integrator'),
    });
    expect(paperclip.files.get(ids('reviewer'))).toBe(ROLE_TEMPLATES.reviewer);
    expect(paperclip.files.get(ids('executor-1'))).toBe(ROLE_TEMPLATES.executor);
    expect(paperclip.files.get(ids('assistant'))).toContain(`- \`${ids('executor-1')}\``);

    // Mỗi agent pause trước khi ghi vai trò, chỉ resume sau khi ghi và kiểm xong.
    const seq = paperclip.requests.map((r) => `${r.method} ${r.path}`);
    const rolesAt = seq.findIndex((s) => s.startsWith('POST /api/plugins/crew.core/'));
    for (const role of Object.keys(byRole)) {
      const pauseAt = seq.indexOf(`POST /api/agents/${ids(role)}/pause`);
      const resumeAt = seq.indexOf(`POST /api/agents/${ids(role)}/resume`);
      expect(pauseAt).toBeGreaterThan(-1);
      expect(pauseAt).toBeLessThan(rolesAt);
      expect(resumeAt).toBeGreaterThan(rolesAt);
    }
    expect(paperclip.requests.some((r) => r.method === 'DELETE')).toBe(false);
    expect(paperclip.envs.get(TEMPLATE_ENV)?.status).toBe('active');
  });

  it('lỗi ở role:reviewer → ghi error, dừng; chạy lại tiếp mà không tạo lại project/agent', async () => {
    const { paperclip, deps, input, store } = await world();
    paperclip.rules.push({
      match: (r) =>
        r.method === 'POST' &&
        r.path.endsWith('/agents') &&
        /-reviewer$/.test(String((r.body as { name?: string }).name)),
      status: 500,
    });
    const first = await addProject(deps, input);
    expect(first.error).toContain('500');
    expect(first.done).toEqual(ALL_ONE.slice(0, ALL_ONE.indexOf('role:reviewer')));
    expect(store.get().projects.landing?.error).toContain('500');
    for (const agent of paperclip.agents.values()) expect(agent.status).toBe('paused');

    const second = await addProject(deps, input);
    expect(second.error).toBeNull();
    expect(second.done).toEqual(ALL_ONE);
    expect(posts(paperclip.requests, `/companies/${COMPANY}/projects`)).toBe(1);
    expect(posts(paperclip.requests, `/companies/${COMPANY}/agents`)).toBe(5); // 4 + lần reviewer bị 500
    expect(paperclip.agents.size).toBe(4);
    expect(posts(paperclip.requests, `/companies/${COMPANY}/environments`)).toBe(4);
  });

  it('server tạo agent nhưng response mất → agent đó vẫn bị pause; chạy lại dùng lại, không tạo trùng', async () => {
    const { paperclip, deps, input } = await world();
    paperclip.rules.push({
      match: (r) => r.method === 'POST' && r.path.endsWith('/agents'),
      status: 502,
      passThrough: true,
    });
    const first = await addProject(deps, input);
    expect(first.error).toContain('502');
    expect(paperclip.agents.size).toBe(1);
    const [lost] = [...paperclip.agents.values()];
    expect(lost?.status).toBe('paused');
    expect(first.agents['executor-1']?.agentId).toBeNull();

    const second = await addProject(deps, input);
    expect(second.error).toBeNull();
    expect(paperclip.agents.size).toBe(4);
    expect(second.agents['executor-1']?.agentId).toBe(lost?.id);
  });

  it('khóa sai dạng, executor ngoài 1–2, hay ~/crew-agents/<key> đã có mà không có tiến độ → từ chối trước mọi lời gọi', async () => {
    const { sandbox, paperclip, fake, deps, input } = await world();
    await expect(addProject(deps, { ...input, key: 'Landing' })).rejects.toThrow('Khóa project');
    await expect(addProject(deps, { ...input, key: 'a' })).rejects.toThrow('Khóa project');
    await expect(addProject(deps, { ...input, executors: 3 as 1 })).rejects.toThrow('executor');
    await expect(addProject(deps, { ...input, origin: '--upload-pack=x' })).rejects.toThrow('URL git');
    mkdirSync(join(sandbox.home, 'crew-agents', 'landing'), { recursive: true });
    await expect(addProject(deps, input)).rejects.toThrow('đã có');
    expect(paperclip.requests).toHaveLength(0);
    expect(fake.calls).toHaveLength(0);
  });

  it('chưa chọn company → từ chối', async () => {
    const { deps, input, sandbox } = await world();
    const store = await makeStore(join(sandbox.root, 'khac'), null);
    await expect(addProject({ ...deps, store }, input)).rejects.toThrow('company');
  });

  it('ls-remote thất bại → "Không đọc được repo bằng git trên máy này", không gọi Paperclip', async () => {
    const { sandbox, paperclip, deps, input } = await world();
    const progress = await addProject(deps, { ...input, origin: join(sandbox.root, 'khong-co.git') });
    expect(progress.error).toContain('Không đọc được repo bằng git trên máy này');
    expect(progress.done).toEqual([]);
    expect(paperclip.requests).toHaveLength(0);
    expect(existsSync(join(sandbox.home, 'crew-projects', 'landing'))).toBe(false);
  });

  it('origin khác với tiến độ đang dở → từ chối', async () => {
    const { paperclip, deps, input, sandbox } = await world();
    paperclip.rules.push({ match: (r) => r.path.endsWith('/environments'), status: 500 });
    await addProject(deps, input);
    await expect(addProject(deps, { ...input, origin: join(sandbox.root, 'khac.git') })).rejects.toThrow(
      'repo khác',
    );
  });

  it('hai executor → 5 agent, executorAgentIds dài 2, Trợ Lý liệt kê cả hai', async () => {
    const { paperclip, deps, input } = await world();
    const progress = await addProject(deps, { ...input, executors: 2 });
    expect(progress.error).toBeNull();
    expect(paperclip.agents.size).toBe(5);
    const projectId = progress.projectId as string;
    const roles = paperclip.roles.get(projectId);
    expect(roles?.executorAgentIds).toEqual([
      progress.agents['executor-1']?.agentId,
      progress.agents['executor-2']?.agentId,
    ]);
    const assistant = paperclip.files.get(progress.agents.assistant?.agentId as string) ?? '';
    for (const id of roles?.executorAgentIds ?? []) expect(assistant).toContain(id);
  });

  it('company bật duyệt agent: chờ duyệt (không pause agent đang chờ duyệt) rồi mới pause', async () => {
    const { paperclip, deps, input } = await world({ requireApproval: true, approveAfterGets: 3 });
    const sleep = vi.fn(async () => undefined);
    const progress = await addProject({ ...deps, sleep }, input);
    expect(progress.error).toBeNull();
    expect(sleep).toHaveBeenCalledWith(10_000);
    const seq = paperclip.requests.map((r) => `${r.method} ${r.path}`);
    for (const entry of Object.values(progress.agents)) {
      const id = entry.agentId as string;
      const lastGet = seq.lastIndexOf(`GET /api/agents/${id}`, seq.indexOf(`POST /api/agents/${id}/pause`));
      expect(lastGet).toBeGreaterThan(-1);
    }
  });

  it('chờ duyệt quá hạn → lỗi "Chờ duyệt agent trên web"', async () => {
    const { deps, input } = await world({ requireApproval: true });
    const progress = await addProject({ ...deps, approvalTimeoutMs: 30_000 }, input);
    expect(progress.error).toContain('Chờ duyệt agent trên web');
  });

  it('plugin từ chối vai trò (400) → error có lời từ chối, agent vẫn pause', async () => {
    const { paperclip, deps, input } = await world();
    paperclip.rules.push({
      match: (r) => r.method === 'POST' && r.path.includes('/plugins/crew.core/'),
      status: 400,
      body: { error: 'agent x đang là reviewer ở project Repo A' },
    });
    const progress = await addProject(deps, input);
    expect(progress.error).toContain('Repo A');
    expect(progress.done).not.toContain('roles');
    for (const agent of paperclip.agents.values()) expect(agent.status).toBe('paused');
  });

  it('kiểm cuối hỏng (doctor fail worktree-workflows) → không resume agent', async () => {
    const { sandbox, paperclip, input, store } = await world();
    const fake = fakeOps(sandbox.home, {
      doctor: () => [{ id: 'worktree-workflows', title: 'x', status: 'fail', detail: 'nguồn bị chặn' }],
    });
    const progress = await addProject({ ...baseDeps(sandbox, paperclip, fake.ops, store) }, input);
    expect(progress.error).toContain('nguồn bị chặn');
    expect(progress.done).not.toContain('check');
    for (const agent of paperclip.agents.values()) expect(agent.status).toBe('paused');
  });

  it('workflow-check của một checkout không sạch → lỗi, không resume', async () => {
    const { sandbox, paperclip, input, store } = await world();
    const fake = fakeOps(sandbox.home, {
      workflowCheck: () => ({ ok: false, lines: ['crew-workflow blocked: x'] }),
    });
    const progress = await addProject(baseDeps(sandbox, paperclip, fake.ops, store), input);
    expect(progress.error).toContain('crew-workflow blocked');
    for (const agent of paperclip.agents.values()) expect(agent.status).toBe('paused');
  });

  it('chạy lại khi đã xong → không gọi ghi gì thêm', async () => {
    const { paperclip, deps, input } = await world();
    await addProject(deps, input);
    const before = paperclip.requests.length;
    const again = await addProject(deps, input);
    expect(again.error).toBeNull();
    expect(paperclip.requests.slice(before).filter((r) => r.method !== 'GET')).toEqual([]);
  });
});
