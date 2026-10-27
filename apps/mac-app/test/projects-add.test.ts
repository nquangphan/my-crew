import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
  const input = { folder: sandbox.folder, name: 'Landing', key: 'landing', executors: 1 as const };
  return { sandbox, paperclip, store, fake, deps, input };
}

const ALL_ONE = [
  'folder',
  'project',
  'status-repo',
  'role:executor-1',
  'role:assistant',
  'role:reviewer',
  'role:integrator',
  'roles',
  'check',
];

/** Chạy lệnh `manualCommand` (một dòng `git -C … worktree remove …` nối bằng `&&`) như owner chạy trong Terminal. */
function execShell(command: string, env: NodeJS.ProcessEnv): void {
  execFileSync('/bin/sh', ['-c', command], { env, encoding: 'utf8' });
}

const posts = (requests: { method: string; path: string }[], suffix: string) =>
  requests.filter((r) => r.method === 'POST' && r.path.endsWith(suffix)).length;

describe('addProject model theo cài đặt model', () => {
  const cell = (model: string, effort: string | null) => ({ model, effort });
  const table = (overrides: Record<string, unknown> = {}) => ({
    revision: 3,
    updatedAt: '2026-10-27T08:00:00.000Z',
    updatedByUserId: 'u',
    canEdit: false,
    settings: {
      catalog: {},
      order: {},
      roles: {
        assistant: cell('claude-opus-6', 'high'),
        executor: cell('claude-sonnet-6', null),
        reviewer: cell('claude-sonnet-6', 'medium'),
        integrator: cell('claude-haiku-6', null),
        bmad: cell('claude-opus-6', null),
        ...overrides,
      },
    },
  });

  it('lấy model và effort từng vai từ server, một lần GET cho cả lần chạy', async () => {
    const w = await world({ modelSettings: table() });
    const progress = await addProject(w.deps, w.input);

    expect(progress.error).toBeNull();
    const seen = (role: string) =>
      w.paperclip.agents.get(progress.agents[role]?.agentId as string)?.adapterConfig;
    expect(seen('assistant')).toMatchObject({ model: 'claude-opus-6', effort: 'high' });
    expect(seen('executor-1')).toMatchObject({ model: 'claude-sonnet-6' });
    expect(seen('executor-1')).not.toHaveProperty('effort');
    expect(seen('reviewer')).toMatchObject({ model: 'claude-sonnet-6', effort: 'medium' });
    expect(seen('integrator')).toMatchObject({ model: 'claude-haiku-6' });
    expect(w.paperclip.requests.filter((r) => r.path === '/api/crew/model-settings')).toHaveLength(1);
  });

  it('bảng sai dạng thì dừng ở bước vai, không tạo agent sai model', async () => {
    const w = await world({ modelSettings: table({ reviewer: { effort: null } }) });
    const progress = await addProject(w.deps, w.input);

    expect(progress.error).toContain('reviewer');
    expect(w.paperclip.agents.size).toBe(0);
  });
});

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

    const folder = realpathSync.native(sandbox.folder);
    expect(progress.folder).toBe(folder);
    expect(sandbox.git(['-C', folder, 'config', '--get', 'crew-docs.bundle'])).toBe(
      join(sandbox.home, '.crew', 'bin', 'crew-docs.cjs'),
    );
    expect(sandbox.git(['-C', folder, 'config', '--get', 'crew-docs.runtime'])).toBe(process.execPath);
    expect(fake.calls.find((c) => c.op === 'addStatusRepo')?.args).toEqual([projectId, folder, COMPANY]);
    expect(existsSync(join(sandbox.home, 'crew-projects'))).toBe(false);

    const byRole = progress.agents;
    expect(Object.keys(byRole).sort()).toEqual(['assistant', 'executor-1', 'integrator', 'reviewer']);
    const worktrees = sandbox.git(['-C', folder, 'worktree', 'list', '--porcelain']);
    for (const [role, entry] of Object.entries(byRole)) {
      const checkout = join(sandbox.home, 'crew-agents', 'landing', role);
      expect(entry.checkout).toBe(checkout);
      // Checkout là git worktree của folder owner, nhánh riêng agent/<khóa>-<vai> rẽ từ nhánh mặc định.
      expect(sandbox.git(['-C', checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir'])).toBe(
        join(folder, '.git'),
      );
      expect(sandbox.git(['-C', checkout, 'symbolic-ref', '--short', 'HEAD'])).toBe(`agent/landing-${role}`);
      expect(sandbox.git(['-C', checkout, 'rev-parse', 'HEAD'])).toBe(
        sandbox.git(['-C', folder, 'rev-parse', 'origin/main']),
      );
      expect(worktrees).toContain(`worktree ${realpathSync.native(checkout)}`);
      expect(sandbox.git(['-C', checkout, 'config', '--get', 'crew-docs.bundle'])).toBe(
        join(sandbox.home, '.crew', 'bin', 'crew-docs.cjs'),
      );
      expect(sandbox.git(['-C', checkout, 'check-ignore', '.paperclip-runtime/x'])).toBe(
        '.paperclip-runtime/x',
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
      // Như agent R1: engine cli (thiếu thì Paperclip chạy ACP và hỏng `adapter_engine_unavailable`), env rỗng,
      // Trợ Lý chạy opus, executor/reviewer/integrator chạy sonnet.
      expect(agent?.adapterConfig.engine).toBe('cli');
      expect(agent?.adapterConfig.env).toEqual({});
      // Server giả chưa có route model-settings (404) nên dùng mặc định của server khi chưa có bản ghi.
      expect(agent?.adapterConfig.model).toBe(role === 'assistant' ? 'claude-opus-5-5' : 'claude-sonnet-5-5');
      expect(agent?.adapterConfig).not.toHaveProperty('effort');
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

    // Quyền agent Crew: không tạo agent, không tạo skill; chỉ Trợ Lý giữ `tasks:assign`. Đặt trước khi resume.
    for (const role of Object.keys(byRole)) {
      const agent = paperclip.agents.get(ids(role));
      expect(agent?.permissions).toEqual({ canCreateAgents: false, canCreateSkills: false });
      expect(agent?.access.grants).toEqual(role === 'assistant' ? [{ permissionKey: 'tasks:assign' }] : []);
      const patchAt = seq.indexOf(`PATCH /api/agents/${ids(role)}/permissions`);
      expect(patchAt).toBeGreaterThan(-1);
      expect(patchAt).toBeLessThan(seq.indexOf(`POST /api/agents/${ids(role)}/resume`));
      const body = paperclip.requests[patchAt]?.body;
      expect(body).toEqual({
        canCreateAgents: false,
        canCreateSkills: false,
        canAssignTasks: role === 'assistant',
      });
    }
  });

  it('tiến độ bản cũ đã qua mọi bước role:* mà chưa đặt quyền → Chạy tiếp đặt quyền rồi mới resume', async () => {
    const { sandbox, paperclip, input, store } = await world();
    let failDoctor = true;
    const fake = fakeOps(sandbox.home, {
      doctor: () =>
        failDoctor ? [{ id: 'worktree-root', title: 'x', status: 'fail', detail: 'chưa sẵn sàng' }] : [],
    });
    const deps = baseDeps(sandbox, paperclip, fake.ops, store);
    const first = await addProject(deps, input);
    expect(first.done).toEqual(ALL_ONE.slice(0, -1));
    // Như bản app cũ: agent vẫn giữ quyền mặc định của Paperclip.
    for (const agent of paperclip.agents.values()) {
      agent.permissions = { canCreateAgents: true, canCreateSkills: true };
      agent.access = { grants: [{ permissionKey: 'tasks:assign' }] };
    }
    failDoctor = false;
    const second = await addProject(deps, input);
    expect(second.error).toBeNull();
    expect(second.done).toEqual(ALL_ONE);
    for (const [role, entry] of Object.entries(second.agents)) {
      const agent = paperclip.agents.get(entry.agentId as string);
      expect(agent?.status).toBe('idle');
      expect(agent?.permissions).toEqual({ canCreateAgents: false, canCreateSkills: false });
      expect(agent?.access.grants.length).toBe(role === 'assistant' ? 1 : 0);
    }
  });

  it('Paperclip không áp quyền (đọc lại vẫn mặc định) → check lỗi tiếng Việt rõ, không resume', async () => {
    const { paperclip, deps, input } = await world();
    paperclip.rules.push({
      match: (r) => r.method === 'PATCH' && r.path.endsWith('/permissions'),
      status: 200,
      body: {},
      times: Number.POSITIVE_INFINITY,
    });
    const progress = await addProject(deps, input);
    expect(progress.error).toContain('Quyền của agent landing-executor-1 chưa bị giới hạn');
    expect(progress.error).toContain('còn được tạo agent');
    expect(progress.error).toContain('còn được tạo skill');
    expect(progress.error).toContain('còn được giao việc');
    expect(progress.done).not.toContain('check');
    for (const agent of paperclip.agents.values()) expect(agent.status).toBe('paused');
  });

  it('Trợ Lý mất grant tasks:assign → check báo thiếu quyền giao việc', async () => {
    const { sandbox, paperclip, input, store } = await world();
    const fake = fakeOps(sandbox.home, {
      doctor: () => {
        for (const agent of paperclip.agents.values()) {
          if (agent.name === 'landing-assistant') agent.access = { grants: [] };
        }
        return [];
      },
    });
    const progress = await addProject(baseDeps(sandbox, paperclip, fake.ops, store), input);
    expect(progress.error).toContain('landing-assistant');
    expect(progress.error).toContain('Trợ Lý thiếu quyền giao việc');
    for (const agent of paperclip.agents.values()) expect(agent.status).toBe('paused');
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

  it('khóa sai dạng, executor ngoài 1–2, folder hỏng hay ~/crew-agents/<key> có nội dung mà không có tiến độ → từ chối trước mọi lời gọi', async () => {
    const { sandbox, paperclip, fake, deps, input } = await world();
    await expect(addProject(deps, { ...input, key: 'Landing' })).rejects.toThrow('Khóa project');
    await expect(addProject(deps, { ...input, key: 'a' })).rejects.toThrow('Khóa project');
    await expect(addProject(deps, { ...input, executors: 3 as 1 })).rejects.toThrow('executor');
    await expect(addProject(deps, { ...input, folder: 'relative/path' })).rejects.toThrow(
      'đường dẫn tuyệt đối',
    );
    await expect(addProject(deps, { ...input, folder: join(sandbox.folder, 'docs') })).rejects.toThrow(
      'thư mục con',
    );
    mkdirSync(join(sandbox.home, 'crew-agents', 'landing', 'x'), { recursive: true });
    await expect(addProject(deps, input)).rejects.toThrow('đã có');
    expect(paperclip.requests).toHaveLength(0);
    expect(fake.calls).toHaveLength(0);
  });

  it('chưa chọn company → từ chối', async () => {
    const { deps, input, sandbox } = await world();
    const store = await makeStore(join(sandbox.root, 'khac'), null);
    await expect(addProject({ ...deps, store }, input)).rejects.toThrow('company');
  });

  it('không clone, không đổi gì trong working tree, nhánh hay index của folder owner (kể cả khi đang dở việc)', async () => {
    const { sandbox, deps, input } = await world();
    const folder = sandbox.folder;
    sandbox.git(['-C', folder, 'checkout', '-q', '-b', 'dang-lam']);
    writeFileSync(join(folder, 'nhanh-owner.txt'), 'commit trên nhánh owner\n');
    sandbox.git(['-C', folder, 'add', 'nhanh-owner.txt']);
    sandbox.git(['-C', folder, '-c', 'user.name=o', '-c', 'user.email=o@o', 'commit', '-q', '-m', 'owner']);
    writeFileSync(join(folder, 'README.md'), 'owner đang sửa\n');
    writeFileSync(join(folder, 'nhap.txt'), 'chưa commit\n');
    sandbox.git(['-C', folder, 'add', 'nhap.txt']);
    writeFileSync(join(folder, 'chua-add.txt'), 'x\n');
    const snapshot = () => ({
      status: sandbox.git(['-C', folder, 'status', '--porcelain=v1', '--untracked-files=all']),
      head: sandbox.git(['-C', folder, 'rev-parse', 'HEAD']),
      branch: sandbox.git(['-C', folder, 'symbolic-ref', 'HEAD']),
      staged: sandbox.git(['-C', folder, 'diff', '--cached']),
      readme: readFileSync(join(folder, 'README.md'), 'utf8'),
    });
    const before = snapshot();
    const progress = await addProject(deps, input);
    expect(progress.error).toBeNull();
    expect(snapshot()).toEqual(before);
    // Worktree agent rẽ từ nhánh mặc định, không từ nhánh hay thay đổi owner đang làm.
    const checkout = progress.agents['executor-1']?.checkout as string;
    expect(readFileSync(join(checkout, 'README.md'), 'utf8')).toBe('repo thử\n');
    expect(existsSync(join(checkout, 'nhap.txt'))).toBe(false);
    expect(existsSync(join(checkout, 'nhanh-owner.txt'))).toBe(false);
  });

  it('bundle crew-docs hợp lệ có sẵn trong folder thì giữ, không ghi đè', async () => {
    const { sandbox, deps, input } = await world();
    const own = join(sandbox.root, 'bundle-cua-owner.cjs');
    writeFileSync(own, '// bundle của owner\n');
    sandbox.git(['-C', sandbox.folder, 'config', 'crew-docs.bundle', own]);
    const progress = await addProject(deps, input);
    expect(progress.error).toBeNull();
    expect(sandbox.git(['-C', sandbox.folder, 'config', '--get', 'crew-docs.bundle'])).toBe(own);
  });

  it('folder khác với tiến độ đang dở → từ chối', async () => {
    const { paperclip, deps, input, sandbox } = await world();
    paperclip.rules.push({ match: (r) => r.path.endsWith('/environments'), status: 500 });
    await addProject(deps, input);
    const other = join(sandbox.root, 'Projects', 'khac');
    sandbox.git(['clone', '-q', sandbox.origin, other]);
    await expect(addProject(deps, { ...input, folder: other })).rejects.toThrow('folder khác');
  });

  it('folder đã thêm với khóa khác → từ chối', async () => {
    const { deps, input } = await world();
    await addProject(deps, input);
    await expect(addProject(deps, { ...input, key: 'landing-2', name: 'Khác' })).rejects.toThrow(
      'đã được thêm với khóa landing',
    );
  });

  it('worktree đã có đúng chỗ thì dùng lại; thư mục lạ ở chỗ checkout → lỗi, không đè', async () => {
    const { paperclip, deps, input, sandbox } = await world();
    paperclip.rules.push({
      match: (r) =>
        r.method === 'POST' &&
        r.path.endsWith('/environments') &&
        /-assistant$/.test(String((r.body as { name?: string }).name)),
      status: 500,
      times: 2,
    });
    const first = await addProject(deps, input);
    expect(first.error).toContain('500');
    const executor = first.agents['executor-1']?.checkout as string;
    const assistant = first.agents.assistant?.checkout as string;
    expect(existsSync(join(assistant, '.git'))).toBe(true);
    writeFileSync(join(executor, 'viec-cua-agent.txt'), 'giữ\n');

    // Thay worktree assistant bằng một repo lạ: lần chạy sau phải báo lỗi chứ không ghi đè.
    sandbox.git(['-C', sandbox.folder, 'worktree', 'remove', '--force', assistant]);
    sandbox.git(['init', '-q', assistant]);
    const second = await addProject(deps, input);
    expect(second.error).toContain('không phải worktree của');
    expect(existsSync(join(executor, 'viec-cua-agent.txt'))).toBe(true);
  });

  it('gỡ rồi chạy lệnh owner tự chạy, thêm lại cùng khóa: dùng lại nhánh agent đã có', async () => {
    const { deps, input, sandbox } = await world();
    const first = await addProject(deps, input);
    const projectId = first.projectId as string;
    const { removeProject } = await import('../src/main/projects/remove-project.js');
    const removed = await removeProject(deps, projectId);
    execShell(removed.manualCommand, sandbox.env);
    expect(existsSync(first.agents.reviewer?.checkout as string)).toBe(false);
    expect(sandbox.git(['-C', sandbox.folder, 'branch', '--list', 'agent/landing-reviewer'])).toContain(
      'agent/landing-reviewer',
    );
    const again = await addProject(deps, input);
    expect(again.error).toBeNull();
    expect(
      sandbox.git(['-C', again.agents.reviewer?.checkout as string, 'symbolic-ref', '--short', 'HEAD']),
    ).toBe('agent/landing-reviewer');
  });

  it('tiến độ kiểu cũ (URL git) đã tạo project → báo cần làm lại; chưa tạo gì thì làm mới', async () => {
    const { store, deps, input, paperclip } = await world();
    await store.update((s) => ({
      ...s,
      projects: {
        landing: {
          key: 'landing',
          origin: 'git@github.com:x/landing.git',
          projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          done: ['ls-remote', 'mirror', 'project'],
          agents: {},
          error: 'git clone thất bại',
        },
      },
    }));
    await expect(addProject(deps, input)).rejects.toThrow('kiểu cũ');
    expect(paperclip.requests).toHaveLength(0);

    await store.update((s) => ({
      ...s,
      projects: {
        landing: {
          key: 'landing',
          origin: 'x',
          projectId: null,
          done: ['ls-remote'],
          agents: {},
          error: 'x',
        },
      },
    }));
    const progress = await addProject(deps, input);
    expect(progress.error).toBeNull();
    expect(progress.origin).toBeUndefined();
    expect(progress.done).toEqual(ALL_ONE);
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

  it('agent đọc lại không có engine cli (vd. agent cũ dùng lại) → lỗi ở bước kiểm, không resume', async () => {
    const { sandbox, paperclip, input, store } = await world();
    const fake = fakeOps(sandbox.home, {
      doctor: () => {
        const [first] = [...paperclip.agents.values()];
        if (first) delete first.adapterConfig.engine;
        return [];
      },
    });
    const progress = await addProject(baseDeps(sandbox, paperclip, fake.ops, store), input);
    expect(progress.error).toContain('engine');
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

  it('thêm xong thì nhờ server dựng sẵn project trên máy khác; server lỗi không làm hỏng lần thêm', async () => {
    const { sandbox, paperclip, deps, input } = await world();
    paperclip.rules.push({ match: (r) => r.path.endsWith('/machines/provision'), status: 500 });
    const progress = await addProject(deps, input);
    expect(progress.error).toBeNull();
    const call = paperclip.requests.find((r) => r.path.endsWith('/machines/provision'));
    expect(call?.body).toEqual({
      exceptMachineId: 'machine-test',
      includeReady: false,
      repo: { originUrl: sandbox.origin, branch: 'main' },
    });
  });

  it('origin ssh:// gửi server giữ user git, chỉ bỏ mật khẩu (máy khác clone bằng user đó)', async () => {
    const { sandbox, paperclip, deps, input } = await world();
    sandbox.git([
      '-C',
      sandbox.folder,
      'remote',
      'set-url',
      'origin',
      'ssh://git:pw@github.com/x/landing.git',
    ]);
    const progress = await addProject(deps, input);
    expect(progress.error).toBeNull();
    const call = paperclip.requests.find((r) => r.path.endsWith('/machines/provision'));
    expect(call?.body).toMatchObject({ repo: { originUrl: 'ssh://git@github.com/x/landing.git' } });
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

describe('addProject: khuôn environment theo máy đã ghép', () => {
  const MACBOOK_ENV = 'abababab-abab-4bab-8bab-abababababab';

  /** Thêm environment của MacBook đã ghép, cùng cổng 2222 với Mac mini (tên xếp sau `mac-mini`). */
  async function pairedWorld(status: 'active' | 'archived' = 'active') {
    const w = await world();
    w.paperclip.envs.set(MACBOOK_ENV, {
      id: MACBOOK_ENV,
      name: 'may-phans-macbook-pro',
      driver: 'ssh',
      status,
      config: {
        host: '100.100.157.19',
        port: 2222,
        username: 'phannhatquang',
        remoteWorkspacePath: '/Users/phannhatquang/crew-agents',
        privateKeySecretRef: { type: 'secret_ref', secretId: SECRET, version: 'latest' },
        knownHosts: '[100.100.157.19]:2222 ssh-ed25519 BBBB',
        strictHostKeyChecking: true,
      },
      metadata: { workspaceRealizationMode: 'in_place' },
    });
    return w;
  }

  const createdEnvs = (w: Awaited<ReturnType<typeof world>>) =>
    [...w.paperclip.envs.values()].filter((env) => env.id !== TEMPLATE_ENV && env.id !== MACBOOK_ENV);

  it('máy đã ghép lấy đúng environment đã ghép làm khuôn, không lấy environment cùng cổng của Mac mini', async () => {
    const w = await pairedWorld();
    await w.store.update((s) => ({ ...s, setup: { ...s.setup, pairedEnvironmentId: MACBOOK_ENV } }));
    const progress = await addProject(w.deps, w.input);
    expect(progress.error).toBeNull();
    const created = createdEnvs(w);
    expect(created).toHaveLength(4);
    for (const env of created) {
      expect(env.config).toMatchObject({
        host: '100.100.157.19',
        username: 'phannhatquang',
        knownHosts: '[100.100.157.19]:2222 ssh-ed25519 BBBB',
      });
    }
  });

  it('environment của company khác đứng đầu danh sách (cùng cổng): bỏ qua, dùng khuôn có secret của company', async () => {
    const w = await pairedWorld();
    w.paperclip.envs.set('e2e-env', {
      id: 'e2e-env',
      name: 'a-crew-e2e',
      driver: 'ssh',
      status: 'active',
      config: {
        host: '100.64.9.9',
        port: 2222,
        username: 'e2e',
        privateKeySecretRef: { type: 'secret_ref', secretId: 'other-company-secret', version: 'latest' },
        knownHosts: '[100.64.9.9]:2222 ssh-ed25519 CCCC',
      },
      metadata: { workspaceRealizationMode: 'in_place' },
    });
    const progress = await addProject(w.deps, w.input);
    expect(progress.error).toBeNull();
    const created = createdEnvs(w).filter((env) => env.id !== 'e2e-env');
    expect(created).toHaveLength(4);
    for (const env of created) {
      expect(env.config).toMatchObject({ host: '100.64.1.2' });
      expect(env.config.privateKeySecretRef).toMatchObject({ secretId: SECRET });
    }
    expect(w.paperclip.requests.every((r) => r.method !== 'DELETE')).toBe(true);
  });

  it('chỉ có environment của company khác thì báo lỗi rõ, không tạo environment', async () => {
    const w = await pairedWorld();
    for (const id of [TEMPLATE_ENV, MACBOOK_ENV]) {
      const env = w.paperclip.envs.get(id);
      if (env) env.config.privateKeySecretRef = { type: 'secret_ref', secretId: 'other-company-secret' };
    }
    const progress = await addProject(w.deps, w.input);
    expect(progress.error).toContain('secret SSH thuộc company');
    expect(createdEnvs(w)).toHaveLength(0);
  });

  it('environment đã ghép dùng secret của company khác thì báo ghép lại', async () => {
    const w = await pairedWorld();
    const env = w.paperclip.envs.get(MACBOOK_ENV);
    if (env) env.config.privateKeySecretRef = { type: 'secret_ref', secretId: 'other-company-secret' };
    await w.store.update((s) => ({ ...s, setup: { ...s.setup, pairedEnvironmentId: MACBOOK_ENV } }));
    const progress = await addProject(w.deps, w.input);
    expect(progress.error).toContain('Environment đã ghép của máy này');
    expect(createdEnvs(w)).toHaveLength(0);
  });

  it('máy chưa ghép (Mac mini) giữ cách cũ: environment cùng cổng đầu tiên theo tên', async () => {
    const w = await pairedWorld();
    const progress = await addProject(w.deps, w.input);
    expect(progress.error).toBeNull();
    for (const env of createdEnvs(w)) expect(env.config).toMatchObject({ host: '100.64.1.2' });
  });

  it('environment đã ghép không còn active thì báo ghép lại, không rơi về environment của máy khác', async () => {
    const w = await pairedWorld('archived');
    await w.store.update((s) => ({ ...s, setup: { ...s.setup, pairedEnvironmentId: MACBOOK_ENV } }));
    const progress = await addProject(w.deps, w.input);
    expect(progress.error).toContain('Environment đã ghép của máy này');
    expect(progress.error).toContain('bước Máy');
    expect(createdEnvs(w)).toHaveLength(0);
  });
});
