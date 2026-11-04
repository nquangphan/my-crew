import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BugFindingPaths, bugFindingPaths } from '../src/main/bug-finding/paths';
import { type BugFindingStateDeps, readBugFindingState } from '../src/main/bug-finding/state';

const NOW = Date.parse('2026-11-04T03:00:00.000Z');
let home: string;
let paths: BugFindingPaths;
let appPath: string;
let standalonePath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bf-state-'));
  paths = bugFindingPaths(home);
  mkdirSync(paths.requestsDir, { recursive: true });
  mkdirSync(paths.responsesDir, { recursive: true });
  appPath = join(home, '2P Crew.app/Contents/Resources/Bug Finding.app');
  mkdirSync(appPath, { recursive: true });
  standalonePath = join(home, 'Applications/Bug Finding.app');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const deps = (over: Partial<BugFindingStateDeps> = {}): BugFindingStateDeps => ({
  paths,
  appPath,
  standalonePath,
  readVersion: async () => '0.2.0',
  runningAppPaths: async () => [],
  now: () => NOW,
  ...over,
});

const heartbeat = (secondsAgo: number, running: number, waiting = 0) =>
  writeFileSync(
    paths.heartbeatFile,
    JSON.stringify({
      pid: 48211,
      version: '0.2.0',
      at: new Date(NOW - secondsAgo * 1000).toISOString(),
      running,
      waiting,
    }),
  );

const writeAt = (file: string, body: unknown, at: string) => {
  writeFileSync(file, JSON.stringify(body));
  const t = new Date(at);
  utimesSync(file, t, t);
};

describe('readBugFindingState', () => {
  it('heartbeat 20 giây trước với running 1 thì đang chạy, 1 lượt review', async () => {
    heartbeat(20, 1, 2);
    const s = await readBugFindingState(deps());
    expect(s).toMatchObject({
      installed: true,
      version: '0.2.0',
      running: true,
      pid: 48211,
      heartbeatAgeSec: 20,
      runningReviews: 1,
      waitingReviews: 2,
      standaloneApp: null,
      requests: [],
    });
  });

  it('heartbeat 5 phút trước thì coi như không chạy', async () => {
    heartbeat(300, 1);
    const s = await readBugFindingState(deps());
    expect(s.running).toBe(false);
    expect(s.pid).toBeNull();
    expect(s.runningReviews).toBe(0);
    expect(s.heartbeatAgeSec).toBe(300);
  });

  it('không có heartbeat, không có app: chưa cài, không chạy', async () => {
    const s = await readBugFindingState(deps({ appPath: null }));
    expect(s).toMatchObject({ installed: false, version: null, running: false, heartbeatAgeSec: null });
  });

  it('có bản cài riêng ở Applications thì báo, kèm trạng thái đang chạy', async () => {
    mkdirSync(standalonePath, { recursive: true });
    const s = await readBugFindingState(deps({ runningAppPaths: async () => [standalonePath] }));
    expect(s.standaloneApp).toEqual({ path: standalonePath, running: true });
  });

  it('ghép request với response và sắp mới nhất lên đầu', async () => {
    const request = (id: string, identifier: string, prNumber: number, run: number) => ({
      schema: 'crew-review-request/1',
      requestId: id,
      crewProjectId: 'p-1',
      identifier,
      run,
      prNumber,
      headSha: 'a'.repeat(40),
      baseBranch: 'main',
    });
    writeAt(
      join(paths.requestsDir, 'r-old.json.done'),
      request('r-old', 'TPS-640', 84, 1),
      '2026-11-04T00:00:00Z',
    );
    writeAt(
      join(paths.requestsDir, 'r-new.json.done'),
      request('r-new', 'TPS-650', 87, 1),
      '2026-11-04T02:00:00Z',
    );
    writeAt(
      join(paths.requestsDir, 'r-wait.json'),
      request('r-wait', 'TPS-648', 86, 2),
      '2026-11-04T01:00:00Z',
    );
    writeAt(
      join(paths.responsesDir, 'r-old.json'),
      {
        schema: 'crew-review-response/1',
        requestId: 'r-old',
        state: 'succeeded',
        round: 1,
        headSha: 'a'.repeat(40),
        startedAt: '2026-11-04T00:05:00Z',
        finishedAt: '2026-11-04T00:40:00Z',
        verdict: 'BLOCK',
      },
      '2026-11-04T00:40:00Z',
    );
    writeAt(
      join(paths.responsesDir, 'r-new.json'),
      {
        schema: 'crew-review-response/1',
        requestId: 'r-new',
        state: 'running',
        round: 1,
        headSha: 'a'.repeat(40),
        lanesDone: 4,
        lanesTotal: 7,
        startedAt: '2026-11-04T02:42:00Z',
      },
      '2026-11-04T02:59:00Z',
    );
    writeFileSync(join(paths.responsesDir, 'hong.json'), '{không phải json');

    const s = await readBugFindingState(deps());
    expect(s.requests.map((r) => r.requestId)).toEqual(['r-new', 'r-wait', 'r-old']);
    expect(s.requests[0]).toMatchObject({
      identifier: 'TPS-650',
      prNumber: 87,
      run: 1,
      state: 'running',
      lanesDone: 4,
      lanesTotal: 7,
      startedAt: '2026-11-04T02:42:00Z',
    });
    expect(s.requests[1]).toMatchObject({ identifier: 'TPS-648', run: 2, state: 'pending', verdict: null });
    expect(s.requests[2]).toMatchObject({ identifier: 'TPS-640', state: 'succeeded', verdict: 'BLOCK' });
  });

  it('đọc danh sách project đã đồng bộ từ crew/projects.json; lần đồng bộ cuối ưu tiên giờ Main báo', async () => {
    const projects = [{ crewProjectId: 'p-1', key: 'my-crew', name: 'my-crew', repoPath: '/r/my-crew' }];
    writeFileSync(
      paths.projectsFile,
      JSON.stringify({
        schema: 'crew-projects/1',
        writtenAt: '2026-11-04T02:41:00.000Z',
        companyId: 'c-1',
        projects,
      }),
    );
    expect((await readBugFindingState(deps())).sync).toEqual({
      lastSyncAt: '2026-11-04T02:41:00.000Z',
      projects,
    });
    const s = await readBugFindingState(deps({ lastSyncAt: () => '2026-11-04T02:59:00.000Z' }));
    expect(s.sync.lastSyncAt).toBe('2026-11-04T02:59:00.000Z');
  });

  it('chưa đồng bộ lần nào thì sync rỗng', async () => {
    expect((await readBugFindingState(deps())).sync).toEqual({ lastSyncAt: null, projects: [] });
  });
});
