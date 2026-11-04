/**
 * E2E cầu nối thật 2P Crew ↔ Bug Finding (spec TPS-643 mục 11, tiêu chí 2, 5): file `projects.json` và `requests/*.json`
 * do mac-app ghi được code Swift thật của Bug Finding (`CrewBridge` trong `MRQueueCore`, nhánh `feat/crew-bridge`) đọc,
 * quyết định và trả `heartbeat.json` + `responses/*.json`; mac-app đọc lại để hiện trạng thái và relay kết quả lên
 * server giả.
 *
 * Chỉ chạy khi `CREW_BUG_FINDING_REPO` trỏ tới một checkout DÙNG MỘT LẦN của repo bug-finding ở commit có cầu nối
 * (ví dụ `git worktree add --detach <thư mục tạm> <sha>`): spec chép `test/fixtures/CrewBridgeLiveTests.swift` vào
 * `apps/mr-review-queue/Tests/MRQueueCoreTests/` rồi gỡ ra khi xong. Không khởi động app Bug Finding thật: app dùng
 * thư mục dữ liệu cố định `~/Library/Application Support/MRReviewQueue`, trùng với bản đang chạy của owner.
 */
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/main/app-context';
import { AppStateStore } from '../src/main/app-state';
import type { MachineJob } from '../src/main/jobs/types';
import type { ProjectRow } from '../src/shared/ipc-contract';
import { startFakePaperclip } from './paperclip-fake-server';

const run = promisify(execFile);
const REPO = process.env.CREW_BUG_FINDING_REPO ?? '';
const PACKAGE = join(REPO, 'apps', 'mr-review-queue');
const FIXTURE = join(import.meta.dirname, 'fixtures', 'CrewBridgeLiveTests.swift');
const INSTALLED_FIXTURE = join(PACKAGE, 'Tests', 'MRQueueCoreTests', 'CrewBridgeLiveTests.swift');
const runnable = Boolean(REPO) && existsSync(join(PACKAGE, 'Sources', 'MRQueueCore', 'CrewBridge.swift'));

const electron = vi.hoisted(() => ({ quitHandlers: [] as Array<() => void> }));
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
const sys = vi.hoisted(() => ({ pgrepStdout: '' }));
vi.mock('@crew/mac', () => ({
  createRunner: () => ({
    run: async (command: string) => {
      if (command === '/bin/ps') return { code: 0, stdout: sys.pgrepStdout, stderr: '' };
      if (command === '/usr/libexec/PlistBuddy') return { code: 0, stdout: '0.2.0-e2e\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  }),
}));
vi.mock('../src/main/paperclip/register', () => ({ boardKeys: { read: async () => 'pcp_board_khoa-gia' } }));
const projectRows = vi.hoisted(() => ({ rows: [] as ProjectRow[] }));
vi.mock('../src/main/projects/ipc', () => ({
  createProjectsIpc: () => ({ list: async () => projectRows.rows }),
}));

const { registerBugFinding } = await import('../src/main/bug-finding/register');
const { createLaunchGate } = await import('../src/main/bug-finding/launch');

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MACHINE = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST = '7a0c3f2e-1b4d-4c5e-8f60-0123456789ab';
const HEAD = 'd'.repeat(40);
const RESULTS_PATH = '/api/plugins/crew.core/api/bug-finding/results';

type Handler = (...args: unknown[]) => unknown;
let home: string;
let appPath: string;
let store: AppStateStore;
let handlers: Map<string, Handler>;
let server: Awaited<ReturnType<typeof startFakePaperclip>>;

const dataDir = () => join(home, 'Library/Application Support/MRReviewQueue');
const ctx = (): AppContext =>
  ({
    home,
    appVersion: '0.0.0-test',
    resourcesPath: '/nonexistent',
    store,
    log: () => undefined,
    ops: { call: async () => [] },
    sendStatusSoon: () => undefined,
    syncBugFindingSoon: () => undefined,
    ipc: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
  }) as unknown as AppContext;

const swiftBridge = (finish: boolean) =>
  run('swift', ['test', '--filter', 'CrewBridgeLiveTests'], {
    cwd: PACKAGE,
    env: { ...process.env, CREW_E2E_BRIDGE_ROOT: dataDir(), CREW_E2E_FINISH: finish ? '1' : '0' },
    timeout: 540_000,
    maxBuffer: 16 * 1024 * 1024,
  });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'bf-swift-e2e-'));
  appPath = join(home, 'Bug Finding.app');
  mkdirSync(appPath);
  vi.stubEnv('CREW_BUG_FINDING_APP', appPath);
  server = await startFakePaperclip((req) =>
    req.path === RESULTS_PATH ? { status: 200, body: { run: {} } } : { status: 404 },
  );
  store = new AppStateStore(join(home, 'app.json'), '0.0.0-test');
  await store.update((s) => ({
    ...s,
    setup: { ...s.setup, paperclipOrigin: server.origin, companyId: COMPANY },
  }));
  handlers = new Map();
  sys.pgrepStdout = `4242 ${appPath}/Contents/MacOS/MRReviewQueue\n`;
  electron.quitHandlers = [];
  projectRows.rows = [
    {
      projectId: PROJECT_ID,
      name: 'my-crew',
      onMac: true,
      checkouts: [],
      docsRepo: join(home, 'repo'),
      lastSentCommit: null,
      progress: null,
    },
  ];
});
afterEach(async () => {
  for (const fn of electron.quitHandlers) fn();
  vi.unstubAllEnvs();
  await server.close();
  rmSync(home, { recursive: true, force: true });
});
afterAll(() => {
  if (runnable) rmSync(INSTALLED_FIXTURE, { force: true });
});

const job = (repoPath: string): MachineJob => ({
  id: '66666666-6666-4666-8666-666666666666',
  companyId: COMPANY,
  machineId: MACHINE,
  kind: 'bug-finding-review',
  payload: {
    kind: 'bug-finding-review',
    requestId: REQUEST,
    issueId: '33333333-3333-4333-8333-333333333333',
    identifier: 'TPS-645',
    run: 1,
    projectId: PROJECT_ID,
    projectKey: 'my-crew',
    repoPath,
    provider: 'github',
    prNumber: 87,
    prUrl: 'https://github.com/nquangphan/my-crew/pull/87',
    headSha: HEAD,
    baseBranch: 'main',
  },
  status: 'claimed',
  result: null,
  errorCode: null,
  errorText: null,
  attempts: 0,
  setupRunId: null,
  createdAt: '2026-11-04T05:00:00.000Z',
  claimedAt: '2026-11-04T05:00:01.000Z',
  finishedAt: null,
});

describe.skipIf(!runnable)('E2E cầu nối thật với Bug Finding (Swift, nhánh feat/crew-bridge)', () => {
  it('Swift đọc projects.json + request do mac-app ghi, trả heartbeat/response; mac-app hiện trạng thái và relay kết quả', async () => {
    mkdirSync(join(home, 'repo'));
    const module = registerBugFinding(ctx(), createLaunchGate());
    await vi.waitFor(() => expect(existsSync(join(dataDir(), 'crew', 'projects.json'))).toBe(true));
    expect(await module.runReview(job(join(home, 'repo')), { origin: server.origin })).toEqual({
      status: 'done',
      result: { kind: 'bug-finding-review', accepted: true },
    });
    expect(existsSync(join(dataDir(), 'crew', 'requests', `${REQUEST}.json`))).toBe(true);

    copyFileSync(FIXTURE, INSTALLED_FIXTURE);

    // Lượt 1: Bug Finding nhận yêu cầu, đang chạy 2/7 lane.
    await swiftBridge(false);
    const during = (await handlers.get('bugFinding:state')?.()) as {
      running: boolean;
      pid: number | null;
      runningReviews: number;
      version: string | null;
      requests: Array<Record<string, unknown>>;
    };
    expect(during).toMatchObject({ running: true, pid: 4242, runningReviews: 1, version: '0.2.0-e2e' });
    expect(during.requests[0]).toMatchObject({
      requestId: REQUEST,
      identifier: 'TPS-645',
      prNumber: 87,
      state: 'running',
      lanesDone: 2,
      lanesTotal: 7,
    });

    // Lượt 2: xong, APPROVE kèm kết quả và báo cáo: relay gửi lên route results.
    await swiftBridge(true);
    await vi.waitFor(
      () =>
        expect(
          server.requests.some(
            (r) => r.path === RESULTS_PATH && (r.body as { state?: string }).state === 'succeeded',
          ),
        ).toBe(true),
      { timeout: 10_000 },
    );
    const final = server.requests
      .filter((r) => r.path === RESULTS_PATH)
      .map((r) => r.body as Record<string, unknown>)
      .find((b) => b.state === 'succeeded');
    expect(final).toMatchObject({
      companyId: COMPANY,
      machineId: MACHINE,
      requestId: REQUEST,
      headSha: HEAD,
      verdict: 'APPROVE',
      reportMarkdown: '# Báo cáo Bug Finding (Swift)',
    });
    expect(JSON.stringify(final)).toContain('F-01');
    expect(readFileSync(join(dataDir(), 'crew', 'projects.json'), 'utf8')).toContain(PROJECT_ID);
  }, 600_000);
});
