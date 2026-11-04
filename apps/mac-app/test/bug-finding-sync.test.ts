import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProjectProgress } from '../src/main/app-state';
import {
  buildCrewProjectList,
  createRepoResolver,
  createSyncRunner,
  jobChangesProjects,
  syncedProjectKnown,
  syncProjects,
} from '../src/main/bug-finding/sync-projects';
import type { ProjectRow } from '../src/shared/ipc-contract';

const row = (id: string, name: string, docsRepo: string | null, onMac = true): ProjectRow => ({
  projectId: id,
  name,
  onMac,
  checkouts: [],
  docsRepo,
  lastSentCommit: null,
  progress: null,
});

const progress = (key: string, folder?: string): ProjectProgress => ({
  key,
  folder,
  projectId: 'p-x',
  done: [],
  agents: {},
  error: null,
});

describe('buildCrewProjectList', () => {
  it('chỉ lấy project có repo trên máy, giữ đúng id Crew', async () => {
    const list = await buildCrewProjectList(
      [row('p-1', 'my-crew', '/r/my-crew'), row('p-2', 'web-only', null, false)],
      async (r) => r.docsRepo,
      'c-1',
    );
    expect(list.schema).toBe('crew-projects/1');
    expect(list.companyId).toBe('c-1');
    expect(list.projects).toEqual([
      { crewProjectId: 'p-1', key: 'my-crew', name: 'my-crew', repoPath: '/r/my-crew' },
    ]);
  });

  it('dùng repo chính của checkout khi không có docsRepo', async () => {
    const list = await buildCrewProjectList([row('p-3', 'shop', null)], async () => '/r/shop', 'c-1');
    expect(list.projects[0]?.repoPath).toBe('/r/shop');
  });

  it('key lấy progress.key, không thì thư mục ~/crew-agents/<key> của checkout, không thì name', async () => {
    const withProgress = { ...row('p-1', 'My Crew', '/r/a'), progress: progress('my-crew') };
    const withCheckout = {
      ...row('p-2', 'Shop App', '/r/b'),
      checkouts: [{ role: 'executor', path: '/Users/o/crew-agents/shop/executor', head: null }],
    };
    const bare = row('p-3', 'plain', '/r/c');
    const list = await buildCrewProjectList(
      [withProgress, withCheckout, bare],
      async (r) => r.docsRepo,
      'c-1',
    );
    expect(list.projects.map((p) => p.key)).toEqual(['my-crew', 'shop', 'plain']);
  });

  it('bỏ tiến độ thêm dở chưa có project Crew (projectId rỗng)', async () => {
    const list = await buildCrewProjectList([row('', 'half', '/r/half')], async (r) => r.docsRepo, 'c-1');
    expect(list.projects).toEqual([]);
  });
});

describe('createRepoResolver', () => {
  const checkout = { role: 'executor', path: '/h/crew-agents/shop/executor', head: null };

  it('ưu tiên docsRepo, rồi thư mục gốc trong tiến độ', async () => {
    const calls: string[][] = [];
    const resolve = createRepoResolver(async (args) => {
      calls.push(args);
      return { code: 0, stdout: '/x/.git\n' };
    });
    expect(await resolve({ ...row('p', 'n', '/r/docs'), progress: progress('n', '/r/folder') })).toBe(
      '/r/docs',
    );
    expect(await resolve({ ...row('p', 'n', null), progress: progress('n', '/r/folder') })).toBe('/r/folder');
    expect(calls).toEqual([]);
  });

  it('không có hai nguồn trên thì lấy repo chính của checkout qua git common-dir, bỏ đuôi .git', async () => {
    const calls: string[][] = [];
    const resolve = createRepoResolver(async (args) => {
      calls.push(args);
      return { code: 0, stdout: '/Volumes/P/shop/.git\n' };
    });
    expect(await resolve({ ...row('p', 'shop', null), checkouts: [checkout] })).toBe('/Volumes/P/shop');
    expect(calls[0]).toEqual([
      '-C',
      checkout.path,
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]);
  });

  it('trả null khi checkout không phải repo git và không có nguồn nào khác', async () => {
    const resolve = createRepoResolver(async () => ({
      code: 128,
      stdout: '',
      stderr: 'fatal: not a git repository (or any of the parent directories): .git',
    }));
    expect(await resolve({ ...row('p', 'shop', null), checkouts: [checkout] })).toBeNull();
    expect(await resolve(row('p', 'web-only', null, false))).toBeNull();
  });

  it('git lỗi tạm thời (quá hạn, thư mục chưa mount) thì ném RepoUnknownError, không coi là không có repo', async () => {
    for (const out of [
      { code: -1, stdout: '', stderr: '' },
      { code: 128, stdout: '', stderr: "fatal: cannot change to '/Volumes/X': No such file or directory" },
    ]) {
      const resolve = createRepoResolver(async () => out);
      await expect(resolve({ ...row('p', 'shop', null), checkouts: [checkout] })).rejects.toThrow(
        'Chưa dò được repo',
      );
    }
  });
});

describe('syncProjects khi dò repo lỗi tạm thời', () => {
  it('giữ project với repoPath của lần ghi trước, không làm project biến mất', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bf-sync-unknown-'));
    const file = join(dir, 'projects.json');
    const checkout = { role: 'executor', path: '/Volumes/X/crew-agents/shop/executor', head: null };
    const shop = { ...row('p-1', 'shop', null), checkouts: [checkout] };
    try {
      let git = { code: 0, stdout: '/Volumes/X/shop/.git\n', stderr: '' };
      const deps = {
        file,
        companyId: 'c-1',
        listRows: async () => [shop],
        resolveRepo: createRepoResolver(async () => git),
      };
      await syncProjects(deps);
      git = { code: -1, stdout: '', stderr: '' };
      expect(await syncProjects(deps)).toEqual({ written: false, count: 1 });
      expect(JSON.parse(readFileSync(file, 'utf8')).projects).toEqual([
        { crewProjectId: 'p-1', key: 'shop', name: 'shop', repoPath: '/Volumes/X/shop' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('syncedProjectKnown', () => {
  it('chỉ đúng khi projects.json ghi cho company của việc và có project của lượt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bf-known-'));
    const file = join(dir, 'projects.json');
    try {
      expect(await syncedProjectKnown(file, 'c-1', 'p-1')).toBe(false);
      writeFileSync(
        file,
        JSON.stringify({
          schema: 'crew-projects/1',
          companyId: 'C-1',
          projects: [{ crewProjectId: 'P-1', key: 'shop', name: 'shop', repoPath: '/r/shop' }],
        }),
      );
      expect(await syncedProjectKnown(file, 'c-1', 'p-1')).toBe(true);
      expect(await syncedProjectKnown(file, 'c-2', 'p-1')).toBe(false);
      expect(await syncedProjectKnown(file, 'c-1', 'p-9')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('syncProjects', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'bf-sync-'));
    const file = join(dir, 'crew', 'projects.json');
    let rows = [row('p-1', 'my-crew', '/r/my-crew')];
    let clock = Date.parse('2026-11-04T02:00:00.000Z');
    const deps = {
      file,
      companyId: 'c-1',
      listRows: async () => rows,
      resolveRepo: async (r: ProjectRow) => r.docsRepo,
      now: () => new Date(clock),
    };
    return {
      dir,
      file,
      deps,
      setRows: (next: ProjectRow[]) => {
        rows = next;
      },
      tick: () => {
        clock += 60_000;
      },
    };
  };

  it('ghi crew/projects.json (tạo thư mục) và không để lại file tạm', async () => {
    const t = setup();
    expect(await syncProjects(t.deps)).toEqual({ written: true, count: 1 });
    const saved = JSON.parse(readFileSync(t.file, 'utf8'));
    expect(saved).toEqual({
      schema: 'crew-projects/1',
      writtenAt: '2026-11-04T02:00:00.000Z',
      companyId: 'c-1',
      projects: [{ crewProjectId: 'p-1', key: 'my-crew', name: 'my-crew', repoPath: '/r/my-crew' }],
    });
    expect(readdirSync(join(t.dir, 'crew'))).toEqual(['projects.json']);
  });

  it('không ghi lại khi danh sách project không đổi (bỏ qua writtenAt)', async () => {
    const t = setup();
    await syncProjects(t.deps);
    t.tick();
    expect(await syncProjects(t.deps)).toEqual({ written: false, count: 1 });
    expect(JSON.parse(readFileSync(t.file, 'utf8')).writtenAt).toBe('2026-11-04T02:00:00.000Z');
  });

  it('ghi lại khi thêm project', async () => {
    const t = setup();
    await syncProjects(t.deps);
    t.tick();
    t.setRows([row('p-1', 'my-crew', '/r/my-crew'), row('p-2', 'shop', '/r/shop')]);
    expect(await syncProjects(t.deps)).toEqual({ written: true, count: 2 });
    const saved = JSON.parse(readFileSync(t.file, 'utf8'));
    expect(saved.writtenAt).toBe('2026-11-04T02:01:00.000Z');
    expect(saved.projects.map((p: { crewProjectId: string }) => p.crewProjectId)).toEqual(['p-1', 'p-2']);
  });

  it('ghi đè file hỏng thay vì ném', async () => {
    const t = setup();
    await syncProjects(t.deps);
    writeFileSync(t.file, '{không phải json');
    expect(await syncProjects(t.deps)).toEqual({ written: true, count: 1 });
    expect(JSON.parse(readFileSync(t.file, 'utf8')).projects).toHaveLength(1);
  });
});

describe('jobChangesProjects', () => {
  it('chỉ đúng các việc tạo/gỡ checkout đã xong', () => {
    const done = { status: 'done' } as const;
    expect(jobChangesProjects('prepare-checkouts', done)).toBe(true);
    expect(jobChangesProjects('ensure-project', done)).toBe(true);
    expect(jobChangesProjects('remove-checkouts', done)).toBe(true);
    expect(jobChangesProjects('agent-workspace', done)).toBe(true);
    expect(jobChangesProjects('inspect-folder', done)).toBe(false);
    expect(jobChangesProjects('remove-checkouts', { status: 'failed' })).toBe(false);
  });
});

describe('createSyncRunner', () => {
  it('gộp các lần nhờ trong lúc đang đồng bộ thành đúng một lần chạy thêm', async () => {
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const runner = createSyncRunner({
      sync: async () => {
        runs += 1;
        if (runs === 1) await gate;
        return { written: true, count: runs };
      },
      log: () => {},
    });
    const first = runner.runNow('startup');
    runner.request('project-added');
    runner.request('job:prepare-checkouts');
    release();
    expect(await first).toEqual({ written: true, count: 1 });
    await runner.idle();
    expect(runs).toBe(2);
  });

  it('request không ném khi đồng bộ lỗi, chỉ ghi log', async () => {
    const logs: string[] = [];
    const runner = createSyncRunner({
      sync: async () => {
        throw new Error('Chưa đăng nhập Paperclip');
      },
      log: (_level, event) => logs.push(event),
    });
    runner.request('interval');
    await runner.idle();
    expect(logs).toEqual(['bug-finding-sync-failed']);
    await expect(runner.runNow('ipc')).rejects.toThrow('Chưa đăng nhập Paperclip');
  });
});
