import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/main/app-context';
import type { ProjectRow } from '../src/shared/ipc-contract';

const electron = vi.hoisted(() => ({
  quitHandlers: [] as Array<() => void>,
}));
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    on: (event: string, fn: () => void) => {
      if (event === 'will-quit') electron.quitHandlers.push(fn);
    },
  },
  shell: { trashItem: async () => undefined },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
}));

const fakeProjects = vi.hoisted(() => ({
  rows: [] as ProjectRow[],
  list: 0,
  add: async (_input: unknown): Promise<unknown> => ({ key: 'shop', error: null }),
  remove: async (_id: string): Promise<unknown> => ({ removed: [], manualCommand: '' }),
}));
vi.mock('../src/main/projects/ipc', () => ({
  createProjectsIpc: () => ({
    list: async () => {
      fakeProjects.list += 1;
      return fakeProjects.rows;
    },
    pickFolder: async () => null,
    add: (input: unknown) => fakeProjects.add(input),
    remove: (id: string) => fakeProjects.remove(id),
  }),
}));
vi.mock('../src/main/projects/docs-runtime', () => ({ repairDocsOnStart: async () => undefined }));

const { PROJECT_SYNC_INTERVAL_MS, registerBugFinding } = await import('../src/main/bug-finding/register');
const { registerProjects } = await import('../src/main/projects/register');
const { createLaunchGate } = await import('../src/main/bug-finding/launch');

type Handler = (...args: unknown[]) => unknown;
let home: string;
let handlers: Map<string, Handler>;
let setup: { paperclipOrigin: string | null; companyId: string | null };
let changeListeners: Array<() => void>;
let synced: string[];

const row = (id: string, name: string, repo: string): ProjectRow => ({
  projectId: id,
  name,
  onMac: true,
  checkouts: [],
  docsRepo: repo,
  lastSentCommit: null,
  progress: null,
});

const ctx = (): AppContext =>
  ({
    home,
    appVersion: '0.0.0-test',
    resourcesPath: '/nonexistent',
    store: {
      get: () => ({ setup, projects: {} }),
      onChange: (fn: () => void) => {
        changeListeners.push(fn);
        return () => undefined;
      },
    },
    log: () => undefined,
    ops: { call: async () => [] },
    sendStatusSoon: () => undefined,
    syncBugFindingSoon: (reason: string) => synced.push(reason),
    ipc: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
  }) as unknown as AppContext;

const projectsFile = () => join(home, 'Library/Application Support/MRReviewQueue/crew/projects.json');
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bf-wiring-'));
  handlers = new Map();
  setup = { paperclipOrigin: 'https://crew.example', companyId: 'c-1' };
  changeListeners = [];
  synced = [];
  fakeProjects.rows = [row('p-1', 'my-crew', '/r/my-crew')];
  fakeProjects.list = 0;
  electron.quitHandlers = [];
});
afterEach(() => {
  for (const fn of electron.quitHandlers) fn();
  vi.useRealTimers();
  rmSync(home, { recursive: true, force: true });
});

describe('registerBugFinding: lịch đồng bộ project', () => {
  it('đồng bộ ngay khi mở app: ghi projects.json của company đang chọn', async () => {
    registerBugFinding(ctx(), createLaunchGate());
    await vi.waitFor(() => expect(existsSync(projectsFile())).toBe(true));
    const saved = JSON.parse(readFileSync(projectsFile(), 'utf8'));
    expect(saved.companyId).toBe('c-1');
    expect(saved.projects).toEqual([
      { crewProjectId: 'p-1', key: 'my-crew', name: 'my-crew', repoPath: '/r/my-crew' },
    ]);
  });

  it('đồng bộ lại mỗi 10 phút', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    registerBugFinding(ctx(), createLaunchGate());
    await vi.waitFor(() => expect(fakeProjects.list).toBe(1));
    expect(PROJECT_SYNC_INTERVAL_MS).toBe(600_000);
    fakeProjects.rows = [...fakeProjects.rows, row('p-2', 'shop', '/r/shop')];
    vi.advanceTimersByTime(PROJECT_SYNC_INTERVAL_MS);
    await vi.waitFor(() => expect(fakeProjects.list).toBe(2));
    await vi.waitFor(() => expect(JSON.parse(readFileSync(projectsFile(), 'utf8')).projects).toHaveLength(2));
  });

  it('requestSync (thêm/gỡ project, job checkout) và bugFinding:syncNow đều ghi lại danh sách', async () => {
    const module = registerBugFinding(ctx(), createLaunchGate());
    await vi.waitFor(() => expect(fakeProjects.list).toBe(1));
    fakeProjects.rows = [...fakeProjects.rows, row('p-2', 'shop', '/r/shop')];
    module.requestSync('project-added');
    await vi.waitFor(() => expect(JSON.parse(readFileSync(projectsFile(), 'utf8')).projects).toHaveLength(2));
    expect(await handlers.get('bugFinding:syncNow')?.()).toEqual({ written: false, count: 2 });
  });

  it('chưa đăng nhập thì không đồng bộ; chọn company xong thì đồng bộ ngay', async () => {
    setup = { paperclipOrigin: null, companyId: null };
    registerBugFinding(ctx(), createLaunchGate());
    await flush();
    expect(fakeProjects.list).toBe(0);
    setup = { paperclipOrigin: 'https://crew.example', companyId: 'c-2' };
    for (const fn of changeListeners) fn();
    await vi.waitFor(() => expect(existsSync(projectsFile())).toBe(true));
    expect(JSON.parse(readFileSync(projectsFile(), 'utf8')).companyId).toBe('c-2');
  });
});

describe('registerProjects: nhờ đồng bộ sau thêm/gỡ project', () => {
  it('sau projects:add và projects:remove, kể cả khi thao tác lỗi', async () => {
    registerProjects(ctx());
    await handlers.get('projects:add')?.({ folder: '/r/shop', name: 'shop', key: 'shop', executors: 1 });
    await handlers.get('projects:remove')?.('p-1');
    fakeProjects.remove = async () => {
      throw new Error('gỡ lỗi');
    };
    await expect(handlers.get('projects:remove')?.('p-1')).rejects.toThrow('gỡ lỗi');
    expect(synced).toEqual(['project-added', 'project-removed', 'project-removed']);
  });
});
