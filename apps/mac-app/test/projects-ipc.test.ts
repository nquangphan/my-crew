import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectProgress } from '../src/main/app-state.js';
import { createProjectsIpc } from '../src/main/projects/ipc.js';
import type { ProjectDeps } from '../src/main/projects/progress.js';
import {
  baseDeps,
  COMPANY,
  fakeOps,
  makeSandbox,
  makeStore,
  startStatefulPaperclip,
} from './projects-fixture.js';

const P_LANDING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P_OLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P_PLAIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

function progressOf(over: Partial<ProjectProgress> = {}): ProjectProgress {
  return {
    key: 'landing',
    folder: '/Volumes/CORSAIR/Projects/landing',
    projectId: P_LANDING,
    done: ['folder', 'project', 'status-repo'],
    agents: {
      'executor-1': { agentId: 'a1', environmentId: 'e1', checkout: '/h/crew-agents/landing/executor-1' },
      integrator: { agentId: 'a4', environmentId: 'e4', checkout: '/h/crew-agents/landing/integrator' },
      assistant: { agentId: 'a2', environmentId: 'e2', checkout: '/h/crew-agents/landing/assistant' },
      reviewer: { agentId: 'a3', environmentId: 'e3', checkout: '/h/crew-agents/landing/reviewer' },
    },
    error: null,
    ...over,
  };
}

/** Deps với client giả chỉ có `projects`, store thật dưới thư mục tạm. */
async function listWorld(opts: { progress?: ProjectProgress[]; companyId?: string | null } = {}) {
  const sandbox = makeSandbox();
  cleanups.push(sandbox.cleanup);
  const store = await makeStore(sandbox.root, opts.companyId === undefined ? COMPANY : opts.companyId);
  await store.update((s) => ({
    ...s,
    projects: Object.fromEntries((opts.progress ?? []).map((p) => [p.key, p])),
  }));
  const client = {
    projects: vi.fn(async () => [
      { id: P_LANDING, name: 'Landing', urlKey: 'landing' },
      { id: P_OLD, name: 'repo-a', urlKey: 'repo-a' },
      { id: P_PLAIN, name: 'Chưa gắn Mac', urlKey: 'chua' },
    ]),
  };
  const fake = fakeOps(sandbox.home, {
    listStatusRepos: () => [
      { projectId: P_LANDING, path: '/Volumes/CORSAIR/Projects/landing', lastCommit: 'a'.repeat(40) },
      { projectId: P_OLD, path: '/h/repo-a', lastCommit: null },
    ],
  });
  const deps = {
    ...baseDeps(sandbox, { client } as never, fake.ops, store),
    client,
  } as unknown as ProjectDeps;
  const headOf = vi.fn(async (path: string) =>
    path.endsWith('assistant') ? null : `h-${path.split('/').pop()}`,
  );
  return { ipc: createProjectsIpc({ deps: () => deps, headOf }), store, headOf, client };
}

describe('projects:list', () => {
  it('project do app thêm: onMac, checkout theo thứ tự vai trò kèm head, repo docs và commit gửi cuối', async () => {
    const { ipc } = await listWorld({ progress: [progressOf()] });
    const rows = await ipc.list();
    const landing = rows.find((r) => r.projectId === P_LANDING);
    expect(landing).toMatchObject({
      name: 'Landing',
      onMac: true,
      docsRepo: '/Volumes/CORSAIR/Projects/landing',
      lastSentCommit: 'a'.repeat(40),
    });
    expect(landing?.checkouts).toEqual([
      { role: 'executor-1', path: '/h/crew-agents/landing/executor-1', head: 'h-executor-1' },
      { role: 'assistant', path: '/h/crew-agents/landing/assistant', head: null },
      { role: 'reviewer', path: '/h/crew-agents/landing/reviewer', head: 'h-reviewer' },
      { role: 'integrator', path: '/h/crew-agents/landing/integrator', head: 'h-integrator' },
    ]);
    expect(landing?.progress?.key).toBe('landing');
  });

  it('project R1 không có vai trò: onMac theo repo ảnh chụp, checkout rỗng; project chưa gắn Mac onMac false', async () => {
    const { ipc, headOf } = await listWorld();
    const rows = await ipc.list();
    expect(rows.find((r) => r.projectId === P_OLD)).toMatchObject({
      onMac: true,
      checkouts: [],
      docsRepo: '/h/repo-a',
      lastSentCommit: null,
      progress: null,
    });
    expect(rows.find((r) => r.projectId === P_PLAIN)).toMatchObject({
      onMac: false,
      docsRepo: null,
      lastSentCommit: null,
    });
    expect(headOf).not.toHaveBeenCalled();
  });

  it('thêm dở trước khi có project trên Paperclip vẫn hiện, projectId rỗng, tên = khóa, chưa onMac', async () => {
    const pending = progressOf({
      key: 'moi',
      projectId: null,
      done: ['folder'],
      agents: {},
      error: 'git hỏng',
    });
    const { ipc } = await listWorld({ progress: [pending] });
    const row = (await ipc.list()).find((r) => r.progress?.key === 'moi');
    expect(row).toMatchObject({ projectId: '', name: 'moi', onMac: false, checkouts: [] });
    expect(row?.progress?.error).toBe('git hỏng');
  });

  it('chưa chọn company thì ném lời nhắc, không gọi REST', async () => {
    const { ipc, client } = await listWorld({ companyId: null });
    await expect(ipc.list()).rejects.toThrow('Chưa chọn company Paperclip');
    expect(client.projects).not.toHaveBeenCalled();
  });
});

describe('projects:add và projects:remove (Paperclip giả, HOME giả)', () => {
  it('thêm rồi liệt kê rồi gỡ: tiến độ trả về, list thấy 4 checkout với head thật, gỡ trả lệnh xóa thư mục', async () => {
    const sandbox = makeSandbox();
    cleanups.push(sandbox.cleanup);
    const paperclip = await startStatefulPaperclip({});
    cleanups.push(paperclip.close);
    const store = await makeStore(sandbox.root);
    const repos: Array<{ projectId: string; path: string; lastCommit: string | null }> = [];
    const fake = fakeOps(sandbox.home, {
      addStatusRepo: (projectId, path) => {
        repos.push({ projectId: projectId as string, path: path as string, lastCommit: null });
      },
      removeStatusRepo: (projectId) => {
        repos.splice(0, repos.length, ...repos.filter((r) => r.projectId !== projectId));
      },
      listStatusRepos: () => [...repos],
    });
    const deps = baseDeps(sandbox, paperclip, fake.ops, store);
    const ipc = createProjectsIpc({ deps: () => deps });

    const progress = await ipc.add({ folder: sandbox.folder, name: 'Landing', key: 'landing', executors: 1 });
    expect(progress.error).toBeNull();
    expect(progress.done.at(-1)).toBe('check');

    const row = (await ipc.list()).find((r) => r.projectId === progress.projectId);
    expect(row?.onMac).toBe(true);
    expect(row?.checkouts.map((c) => c.role)).toEqual(['executor-1', 'assistant', 'reviewer', 'integrator']);
    expect(row?.checkouts.every((c) => /^[0-9a-f]{7,}$/.test(c.head ?? ''))).toBe(true);

    const removed = await ipc.remove(progress.projectId as string);
    expect(removed.manualCommand).toMatch(/^git -C .+ worktree remove .+executor-1 && /);
    expect(store.get().projects.landing).toBeUndefined();
  });

  it('dữ liệu vào sai thì ném, không đụng Paperclip', async () => {
    const { ipc, client } = await listWorld();
    await expect(ipc.add({ folder: '/x', name: 'A', key: 'Sai Khoa', executors: 1 })).rejects.toThrow(
      'Khóa project',
    );
    expect(client.projects).not.toHaveBeenCalled();
  });
});

describe('projects:pickFolder', () => {
  async function pickWorld(picked: string | null) {
    const sandbox = makeSandbox();
    cleanups.push(sandbox.cleanup);
    const store = await makeStore(sandbox.root);
    const fake = fakeOps(sandbox.home);
    const deps = baseDeps(sandbox, { client: {} } as never, fake.ops, store);
    const pickDirectory = vi.fn(async () => picked);
    return { sandbox, ipc: createProjectsIpc({ deps: () => deps, pickDirectory }), pickDirectory };
  }

  it('owner bấm Hủy → null', async () => {
    const { ipc, pickDirectory } = await pickWorld(null);
    expect(await ipc.pickFolder()).toBeNull();
    expect(pickDirectory).toHaveBeenCalledTimes(1);
  });

  it('repo hợp lệ → đường dẫn gốc, tên và khóa gợi ý từ tên folder, không có vấn đề', async () => {
    const sandbox = makeSandbox();
    cleanups.push(sandbox.cleanup);
    const folder = join(sandbox.root, 'Projects', '2PS Landing');
    sandbox.git(['clone', '-q', sandbox.origin, folder]);
    const { ipc } = await pickWorld(folder);
    expect(await ipc.pickFolder()).toEqual({
      folder: realpathSync.native(folder),
      name: '2PS Landing',
      key: 'p-2ps-landing',
      problem: null,
    });
  });

  it('folder không dùng được → trả lý do tiếng Việt, không ném', async () => {
    const sandbox = makeSandbox();
    cleanups.push(sandbox.cleanup);
    const plain = join(sandbox.root, 'thu-muc-thuong');
    mkdirSync(plain);
    const { ipc } = await pickWorld(plain);
    const choice = await ipc.pickFolder();
    expect(choice?.folder).toBe(plain);
    expect(choice?.key).toBe('thu-muc-thuong');
    expect(choice?.problem).toContain('không phải repo git');
  });
});
