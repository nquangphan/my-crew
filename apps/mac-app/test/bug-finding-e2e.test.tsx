// @vitest-environment jsdom
/**
 * E2E luồng Bug Finding trong 2P Crew (spec TPS-643 mục 11, tiêu chí 1, 2, 5, 14): main thật (`registerBugFinding`,
 * handler IPC thật, file cầu nối thật trong thư mục tạm, relay thật gọi HTTP) nối với màn hình renderer thật
 * (`BugFindingScreen`). Chỉ giả: electron, tiến trình hệ thống (pgrep/open/PlistBuddy), danh sách project Paperclip và
 * server Paperclip (HTTP thật trên cổng ngẫu nhiên).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/main/app-context';
import { AppStateStore } from '../src/main/app-state';
import type { MachineJob } from '../src/main/jobs/types';
import type { ProjectRow } from '../src/shared/ipc-contract';
import { type FakeReply, startFakePaperclip } from './paperclip-fake-server';

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

// Tiến trình hệ thống giả: `pgrep` trả các tiến trình Bug Finding đang chạy, `open` được ghi lại.
const sys = vi.hoisted(() => ({ pgrepStdout: '', commands: [] as string[][] }));
vi.mock('@crew/mac', () => ({
  createRunner: () => ({
    run: async (command: string, args: readonly string[]) => {
      sys.commands.push([command, ...args]);
      if (command === '/usr/bin/pgrep') {
        return sys.pgrepStdout
          ? { code: 0, stdout: sys.pgrepStdout, stderr: '' }
          : { code: 1, stdout: '', stderr: '' };
      }
      if (command === '/usr/libexec/PlistBuddy') return { code: 0, stdout: '0.2.0\n', stderr: '' };
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
const { BugFindingScreen } = await import('../src/renderer/routes/bug-finding');

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MACHINE = '22222222-2222-4222-8222-222222222222';
const REQUEST = '7a0c3f2e-1b4d-4c5e-8f60-0123456789ab';
const HEAD = 'd'.repeat(40);
const RESULTS_PATH = '/api/plugins/crew.core/api/bug-finding/results';

type Handler = (...args: unknown[]) => unknown;
let home: string;
let appPath: string;
let store: AppStateStore;
let handlers: Map<string, Handler>;
let server: Awaited<ReturnType<typeof startFakePaperclip>>;
let serverReply: () => FakeReply;

const bridge = () => join(home, 'Library/Application Support/MRReviewQueue/crew');
const writeBridge = (name: string, body: unknown) => {
  mkdirSync(join(bridge(), ...name.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(join(bridge(), name), JSON.stringify(body));
};

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
    store,
    log: () => undefined,
    ops: { call: async () => [] },
    sendStatusSoon: () => undefined,
    syncBugFindingSoon: () => undefined,
    ipc: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
  }) as unknown as AppContext;

/** Cầu `window.crew` của preload: gọi thẳng handler IPC của Main, trả đúng dạng `{ ok, result | error }`. */
const installPreload = () => {
  (window as unknown as { crew: unknown }).crew = {
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) return { ok: false, error: `Không có kênh ${channel}` };
      try {
        return { ok: true, result: await handler(...args) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    on: () => () => undefined,
  };
};

const reviewJob = (repoPath: string): MachineJob => ({
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
    projectId: '44444444-4444-4444-8444-444444444444',
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

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'bf-e2e-'));
  appPath = join(home, 'Bug Finding.app');
  mkdirSync(join(appPath, 'Contents'), { recursive: true });
  vi.stubEnv('CREW_BUG_FINDING_APP', appPath);
  serverReply = () => ({ status: 200, body: { run: {} } });
  server = await startFakePaperclip((req) => (req.path === RESULTS_PATH ? serverReply() : { status: 404 }));
  store = new AppStateStore(join(home, 'app.json'), '0.0.0-test');
  await store.update((s) => ({
    ...s,
    setup: { ...s.setup, paperclipOrigin: server.origin, companyId: COMPANY },
  }));
  handlers = new Map();
  sys.pgrepStdout = '';
  sys.commands = [];
  projectRows.rows = [row('p-1', 'my-crew', '/r/my-crew'), row('p-2', 'shop', '/r/shop')];
  electron.quitHandlers = [];
  installPreload();
});
afterEach(async () => {
  cleanup();
  for (const fn of electron.quitHandlers) fn();
  vi.unstubAllEnvs();
  await server.close();
  rmSync(home, { recursive: true, force: true });
});

describe('E2E Bug Finding trong 2P Crew', () => {
  it('màn Bug Finding hiện trạng thái từ heartbeat và responses giả', async () => {
    registerBugFinding(ctx());
    sys.pgrepStdout = `48211 ${appPath}/Contents/MacOS/MRReviewQueue\n`;
    writeBridge('heartbeat.json', {
      pid: 48211,
      version: '0.2.0',
      at: new Date(Date.now() - 12_000).toISOString(),
      running: 1,
      waiting: 1,
    });
    writeBridge('requests/r-1.json', { requestId: 'r-1', identifier: 'TPS-650', prNumber: 87, run: 1 });
    writeBridge('responses/r-1.json', {
      schema: 'crew-review-response/1',
      requestId: 'r-1',
      state: 'running',
      lanesDone: 4,
      lanesTotal: 7,
      startedAt: new Date().toISOString(),
    });
    writeBridge('requests/r-2.json', { requestId: 'r-2', identifier: 'TPS-640', prNumber: 84, run: 2 });
    writeBridge('responses/r-2.json', {
      schema: 'crew-review-response/1',
      requestId: 'r-2',
      state: 'succeeded',
      lanesDone: 7,
      lanesTotal: 7,
      verdict: 'APPROVE',
      finishedAt: '2026-11-04T01:40:00.000Z',
    });

    render(<BugFindingScreen />);
    await waitFor(() => expect(screen.getByText('pid 48211')).toBeTruthy());
    expect(screen.getByText('Đang chạy')).toBeTruthy();
    expect(screen.getByText('0.2.0 (cập nhật cùng 2P Crew)')).toBeTruthy();
    expect(screen.getByText('1 đang review, 1 đang chờ')).toBeTruthy();
    expect(screen.getByText(/Đã nhận tín hiệu \d+ giây trước/)).toBeTruthy();
    expect(screen.getByText('TPS-650')).toBeTruthy();
    expect(screen.getByText('Đang review')).toBeTruthy();
    expect(screen.getByText('4/7 lane xong')).toBeTruthy();
    expect(screen.getByText('2 (chạy lại)')).toBeTruthy();
    expect(screen.getByText('APPROVE')).toBeTruthy();
  });

  it('bản cài riêng đang chạy: từ chối mở bản nhúng (không gọi open) và báo thoát trước', async () => {
    registerBugFinding(ctx());
    sys.pgrepStdout = '777 /Applications/Bug Finding.app/Contents/MacOS/MRReviewQueue\n';
    render(<BugFindingScreen />);
    const button = await screen.findByRole('button', { name: 'Mở Bug Finding' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Thoát Bug Finding (bản cài riêng) trước'),
    );
    expect(sys.commands.some(([cmd]) => cmd === '/usr/bin/open')).toBe(false);

    // Cùng điều kiện đó thì việc bug-finding-review cũng bị từ chối và không để lại file yêu cầu.
    const repo = join(home, 'repo');
    mkdirSync(repo);
    const module = registerBugFinding(ctx());
    const outcome = await module.runReview(reviewJob(repo));
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'standalone_running' });
    expect(() => readFileSync(join(bridge(), 'requests', `${REQUEST}.json`))).toThrow();
  });

  it('đồng bộ project (Đồng bộ lại) ghi đúng crew/projects.json và màn hiện bảng project', async () => {
    registerBugFinding(ctx());
    render(<BugFindingScreen />);
    const file = join(bridge(), 'projects.json');
    await waitFor(() => expect(JSON.parse(readFileSync(file, 'utf8')).projects).toHaveLength(2));

    projectRows.rows = [...projectRows.rows, row('p-3', 'kidy', '/r/kidy')];
    const sync = await screen.findByRole('button', { name: 'Đồng bộ lại' });
    await waitFor(() => expect((sync as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sync);
    await waitFor(() => expect(screen.getAllByText('Đã đồng bộ 3 project').length).toBeGreaterThan(0));

    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved).toMatchObject({ schema: 'crew-projects/1', companyId: COMPANY });
    expect(saved.projects).toEqual([
      { crewProjectId: 'p-1', key: 'my-crew', name: 'my-crew', repoPath: '/r/my-crew' },
      { crewProjectId: 'p-2', key: 'shop', name: 'shop', repoPath: '/r/shop' },
      { crewProjectId: 'p-3', key: 'kidy', name: 'kidy', repoPath: '/r/kidy' },
    ]);
    const table = screen.getByRole('table', { name: 'Project Crew ↔ Bug Finding' });
    expect(within(table).getByText('/r/kidy')).toBeTruthy();
  });

  it('job bug-finding-review ghi request file, mở app nền, rồi relay tiến độ và kết quả lên server giả', async () => {
    const repo = join(home, 'repo');
    mkdirSync(repo);
    const module = registerBugFinding(ctx());
    const outcome = await module.runReview(reviewJob(repo));
    expect(outcome).toEqual({ status: 'done', result: { kind: 'bug-finding-review', accepted: true } });

    const request = JSON.parse(readFileSync(join(bridge(), 'requests', `${REQUEST}.json`), 'utf8'));
    expect(request).toMatchObject({
      schema: 'crew-review-request/1',
      requestId: REQUEST,
      crewProjectId: '44444444-4444-4444-8444-444444444444',
      identifier: 'TPS-645',
      prNumber: 87,
      headSha: HEAD,
      baseBranch: 'main',
    });
    expect(sys.commands).toContainEqual(['/usr/bin/open', '-g', appPath]);

    // Màn hình thấy lượt vừa xếp ở trạng thái "Chờ Bug Finding nhận".
    sys.pgrepStdout = `1 ${appPath}/Contents/MacOS/MRReviewQueue\n`;
    render(<BugFindingScreen />);
    await waitFor(() => expect(screen.getByText('Chờ Bug Finding nhận')).toBeTruthy());

    // Bug Finding đang chạy rồi xong: relay gửi từng trạng thái về route results với board key của máy.
    writeBridge(`responses/${REQUEST}.json`, {
      schema: 'crew-review-response/1',
      requestId: REQUEST,
      state: 'running',
      headSha: HEAD,
      lanesDone: 2,
      lanesTotal: 7,
    });
    await waitFor(() => expect(server.requests.some((r) => r.path === RESULTS_PATH)).toBe(true), {
      timeout: 5_000,
    });
    const running = server.requests.find((r) => r.path === RESULTS_PATH);
    expect(running?.authorization).toBe('Bearer pcp_board_khoa-gia');
    expect(running?.body).toMatchObject({ companyId: COMPANY, machineId: MACHINE, requestId: REQUEST });

    const resultDir = join(home, 'result');
    mkdirSync(resultDir);
    writeFileSync(
      join(resultDir, 'review-result.json'),
      JSON.stringify({
        findings: [{ id: 'F-01', rule: 'R1', title: 'Thiếu kiểm null', severity: 'LOW', fix: 'x' }],
      }),
    );
    writeFileSync(join(resultDir, 'mr-87-r1.md'), '# Báo cáo Bug Finding');
    writeBridge(`responses/${REQUEST}.json`, {
      schema: 'crew-review-response/1',
      requestId: REQUEST,
      state: 'succeeded',
      headSha: HEAD,
      verdict: 'APPROVE WITH CONDITIONS',
      resultDir,
      reportPath: join(resultDir, 'mr-87-r1.md'),
    });
    await waitFor(
      () =>
        expect(
          server.requests
            .filter((r) => r.path === RESULTS_PATH)
            .some((r) => (r.body as { state?: string }).state === 'succeeded'),
        ).toBe(true),
      { timeout: 8_000 },
    );
    const final = server.requests
      .filter((r) => r.path === RESULTS_PATH)
      .map((r) => r.body as Record<string, unknown>)
      .find((b) => b.state === 'succeeded');
    expect(final).toMatchObject({
      requestId: REQUEST,
      verdict: 'APPROVE WITH CONDITIONS',
      reportMarkdown: '# Báo cáo Bug Finding',
    });
    expect(JSON.stringify(final)).toContain('F-01');
    await waitFor(() => expect(store.get().bugFindingRequests?.[REQUEST]?.delivered).toBe(true));
  });
});
