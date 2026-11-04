import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/main/app-context';
import { AppStateStore } from '../src/main/app-state';
import type { MachineJob } from '../src/main/jobs/types';

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
// Không chạy pgrep/open thật: runner giả ghi lại lệnh.
const commands = vi.hoisted(() => [] as string[][]);
vi.mock('@crew/mac', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createRunner: () => ({
    run: async (command: string, args: readonly string[]) => {
      commands.push([command, ...args]);
      return { code: 0, stdout: '', stderr: '', timedOut: false };
    },
  }),
}));
vi.mock('../src/main/paperclip/register', () => ({ boardKeys: { read: async () => 'pcp_board_khoa-gia' } }));
const projectRows = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('../src/main/projects/ipc', () => ({
  createProjectsIpc: () => ({ list: async () => projectRows.rows }),
}));

const { registerBugFinding } = await import('../src/main/bug-finding/register');
const { createLaunchGate } = await import('../src/main/bug-finding/launch');
const { RELAY_INTERVAL_MS } = await import('../src/main/bug-finding/results');

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MACHINE = '22222222-2222-4222-8222-222222222222';
const REQUEST = '7a0c3f2e-1b4d-4c5e-8f60-0123456789ab';
const HEAD = 'd'.repeat(40);
const PROJECT = '44444444-4444-4444-8444-444444444444';
const ORIGIN = 'https://crew.example';

let home: string;
let store: AppStateStore;
let posts: Array<{ url: string; body: unknown }>;
const handlers = new Map<string, (...args: unknown[]) => unknown>();

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
    ipc: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn);
      },
    },
  }) as unknown as AppContext;

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
  // fs.watch có thể trễ khi máy bận: test đẩy lượt quét định kỳ (30 giây) của relay bằng đồng hồ giả.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  home = mkdtempSync(join(tmpdir(), 'bf-review-wiring-'));
  store = new AppStateStore(join(home, 'app.json'), '0.0.0-test');
  await store.update((s) => ({
    ...s,
    setup: { ...s.setup, paperclipOrigin: 'https://crew.example', companyId: COMPANY },
  }));
  const app = join(home, 'Bug Finding.app');
  mkdirSync(app);
  vi.stubEnv('CREW_BUG_FINDING_APP', app);
  commands.length = 0;
  posts = [];
  projectRows.rows = [
    {
      projectId: PROJECT,
      name: 'my-crew',
      onMac: true,
      checkouts: [],
      docsRepo: join(home, 'repo'),
      lastSentCommit: null,
      progress: null,
    },
  ];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    posts.push({ url, body: JSON.parse(String(init.body)) });
    return new Response('{"run":{}}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  electron.quitHandlers = [];
});
afterEach(() => {
  for (const fn of electron.quitHandlers) fn();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
});

describe('registerBugFinding: việc bug-finding-review và chuyển kết quả', () => {
  it('nhận việc → ghi request, mở Bug Finding nền, ghi sổ lượt; response xong → gửi kết quả về server', async () => {
    const repo = join(home, 'repo');
    mkdirSync(repo);
    const module = registerBugFinding(ctx(), createLaunchGate());
    const outcome = await module.runReview(job(repo), { origin: ORIGIN });
    expect(outcome).toEqual({ status: 'done', result: { kind: 'bug-finding-review', accepted: true } });

    const bridge = join(home, 'Library/Application Support/MRReviewQueue/crew');
    const request = JSON.parse(readFileSync(join(bridge, 'requests', `${REQUEST}.json`), 'utf8'));
    expect(request).toMatchObject({ schema: 'crew-review-request/1', requestId: REQUEST, prNumber: 87 });
    expect(commands).toContainEqual(['/usr/bin/open', '-g', join(home, 'Bug Finding.app')]);
    expect(store.get().bugFindingRequests?.[REQUEST]).toMatchObject({
      companyId: COMPANY,
      machineId: MACHINE,
      origin: ORIGIN,
    });

    // Bug Finding ghi response kết quả cuối: relay gửi về route results của plugin.
    const resultDir = join(bridge, '..', 'reviews', 'x', '87', 'round-1', 'result');
    mkdirSync(resultDir, { recursive: true });
    writeFileSync(
      join(resultDir, 'review-result.json'),
      JSON.stringify({ findings: [{ id: 'F-01', rule: 'R', severity: 'LOW', fix: 'x' }] }),
    );
    writeFileSync(join(resultDir, 'mr-87-r1.md'), '# Báo cáo');
    writeFileSync(
      join(bridge, 'responses', `${REQUEST}.json`),
      JSON.stringify({
        schema: 'crew-review-response/1',
        requestId: REQUEST,
        state: 'succeeded',
        headSha: HEAD,
        verdict: 'APPROVE',
        resultDir,
        reportPath: join(resultDir, 'mr-87-r1.md'),
      }),
    );
    vi.advanceTimersByTime(RELAY_INTERVAL_MS);
    await vi.waitFor(() => expect(posts).toHaveLength(1), { timeout: 5_000 });
    expect(posts[0]?.url).toBe('https://crew.example/api/plugins/crew.core/api/bug-finding/results');
    expect(posts[0]?.body).toMatchObject({
      companyId: COMPANY,
      machineId: MACHINE,
      requestId: REQUEST,
      state: 'succeeded',
      verdict: 'APPROVE',
      reportMarkdown: '# Báo cáo',
    });
    await vi.waitFor(() => expect(store.get().bugFindingRequests?.[REQUEST]?.delivered).toBe(true));
  });

  it('đổi origin đăng nhập sau khi nhận việc: không POST kết quả sang origin mới, giữ chờ', async () => {
    const repo = join(home, 'repo');
    mkdirSync(repo);
    const module = registerBugFinding(ctx(), createLaunchGate());
    expect((await module.runReview(job(repo), { origin: ORIGIN })).status).toBe('done');
    await store.update((s) => ({ ...s, setup: { ...s.setup, paperclipOrigin: 'https://other.example' } }));
    const bridge = join(home, 'Library/Application Support/MRReviewQueue/crew');
    writeFileSync(
      join(bridge, 'responses', `${REQUEST}.json`),
      JSON.stringify({
        schema: 'crew-review-response/1',
        requestId: REQUEST,
        state: 'failed',
        headSha: HEAD,
      }),
    );
    vi.advanceTimersByTime(RELAY_INTERVAL_MS);
    await vi.waitFor(() => expect(store.get().bugFindingOutbox).toHaveLength(1), { timeout: 5_000 });
    expect(posts).toEqual([]);
    expect(store.get().bugFindingRequests?.[REQUEST]?.delivered).toBeUndefined();
  });

  it('project của lượt không có trong danh sách đồng bộ sang Bug Finding: project_missing, không mở app', async () => {
    projectRows.rows = [];
    const repo = join(home, 'repo');
    mkdirSync(repo);
    const module = registerBugFinding(ctx(), createLaunchGate());
    const outcome = await module.runReview(job(repo), { origin: ORIGIN });
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'project_missing' });
    expect(commands.some((c) => c[0] === '/usr/bin/open')).toBe(false);
  });

  it('cổng mở Bug Finding đóng (chờ cài bản mới): từ chối việc và nút Mở', async () => {
    const repo = join(home, 'repo');
    mkdirSync(repo);
    const gate = createLaunchGate();
    await gate.close();
    const module = registerBugFinding(ctx(), gate);
    const outcome = await module.runReview(job(repo), { origin: ORIGIN });
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'app_error' });
    expect(await handlers.get('bugFinding:open')?.()).toEqual({ ok: false, reason: 'updating' });
    expect(commands.some((c) => c[0] === '/usr/bin/open')).toBe(false);
  });
});
