/**
 * E2E đồng bộ project sang Bug Finding cho project dựng bằng `crew-mac` hay do server dựng (không có tiến độ trong
 * `app.json`): Main thật (`registerBugFinding`, `createProjectsIpc`, client Paperclip, `git` thật trên repo tạm) từ
 * lượt đồng bộ tới `crew/projects.json` rồi tới lượt `bug-finding-review` (`projectKnown`). Chỉ giả: electron, tiến
 * trình hệ thống (`open`, `ps`) và server Paperclip (HTTP thật trên cổng ngẫu nhiên).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/main/app-context';
import { AppStateStore, type ProjectProgress } from '../src/main/app-state';
import type { MachineJob } from '../src/main/jobs/types';
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

// Không chạy ps/open thật: runner giả ghi lại lệnh. `git` của đồng bộ project không đi qua runner này.
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
// Client Paperclip thật (HTTP thật tới server giả), chỉ thay Keychain bằng key giả.
vi.mock('../src/main/paperclip/register', async () => {
  const { createPaperclipClient } = await import('../src/main/paperclip/client');
  return {
    boardKeys: { read: async () => 'pcp_board_khoa-gia' },
    paperclipClient: (ctx: AppContext) => {
      const origin = ctx.store.get().setup.paperclipOrigin;
      if (!origin) throw new Error('Chưa đăng nhập Paperclip');
      return createPaperclipClient(origin, {
        fetch: globalThis.fetch,
        readKey: async () => 'pcp_board_khoa-gia',
        log: () => undefined,
      });
    },
  };
});

const { registerBugFinding } = await import('../src/main/bug-finding/register');
const { createLaunchGate } = await import('../src/main/bug-finding/launch');

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MACHINE = '22222222-2222-4222-8222-222222222222';
const REQUEST = '7a0c3f2e-1b4d-4c5e-8f60-0123456789ab';
const REST_ONLY = '44444444-4444-4444-8444-444444444441'; // dựng bằng crew-mac, server ghi repoPath cho máy này
const NO_SOURCE = '44444444-4444-4444-8444-444444444442'; // không nguồn nào
const WITH_FOLDER = '44444444-4444-4444-8444-444444444443'; // tiến độ có folder
const WITH_CHECKOUT = '44444444-4444-4444-8444-444444444444'; // tiến độ chỉ có checkout
const WITH_DOCS = '44444444-4444-4444-8444-444444444445'; // repo docs đã đăng ký
const PROJECTS_PATH = `/api/companies/${COMPANY}/projects`;
const machinesPath = (projectId: string) => `/api/crew/companies/${COMPANY}/projects/${projectId}/machines`;

type Handler = (...args: unknown[]) => unknown;
let home: string;
let store: AppStateStore;
let handlers: Map<string, Handler>;
let server: Awaited<ReturnType<typeof startFakePaperclip>>;
let machineRepoPaths: Record<string, string>;
let statusRepos: Array<{ projectId: string; path: string; lastCommit: string | null }>;
let repos: { rest: string; decoy: string; folder: string; checkout: string; docs: string };

const bridge = () => join(home, 'Library/Application Support/MRReviewQueue/crew');
const projectsFile = () => join(bridge(), 'projects.json');
const savedProjects = (): Array<{ crewProjectId: string; key: string; repoPath: string }> =>
  JSON.parse(readFileSync(projectsFile(), 'utf8')).projects;
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('/usr/bin/git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
};
const initRepo = (name: string) => {
  const dir = join(home, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  return realpathSync(dir);
};

const ctx = (): AppContext =>
  ({
    home,
    appVersion: '0.0.0-test',
    resourcesPath: '/nonexistent',
    store,
    log: () => undefined,
    ops: {
      call: async (name: string) => {
        if (name === 'listStatusRepos') return statusRepos;
        if (name === 'jobTargets') return { machineId: MACHINE, targets: [] };
        return [];
      },
    },
    sendStatusSoon: () => undefined,
    syncBugFindingSoon: () => undefined,
    ipc: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
  }) as unknown as AppContext;

const reviewJob = (projectId: string, projectKey: string, repoPath: string): MachineJob => ({
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
    projectId,
    projectKey,
    repoPath,
    provider: 'github',
    prNumber: 87,
    prUrl: 'https://github.com/nquangphan/my-crew/pull/87',
    headSha: 'd'.repeat(40),
    baseBranch: 'main',
  },
  status: 'claimed',
  result: null,
  errorCode: null,
  errorText: null,
  attempts: 0,
  setupRunId: null,
  createdAt: '2026-11-05T05:00:00.000Z',
  claimedAt: '2026-11-05T05:00:01.000Z',
  finishedAt: null,
});

const progress = (key: string, projectId: string, patch: Partial<ProjectProgress>): ProjectProgress => ({
  key,
  projectId,
  done: [],
  agents: {},
  error: null,
  ...patch,
});

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'bf-machine-e2e-'));
  const app = join(home, 'Bug Finding.app');
  mkdirSync(join(app, 'Contents'), { recursive: true });
  vi.stubEnv('CREW_BUG_FINDING_APP', app);
  commands.length = 0;
  handlers = new Map();
  electron.quitHandlers = [];

  repos = {
    rest: initRepo('crew-mac-made'),
    decoy: initRepo('decoy'),
    folder: initRepo('with-folder'),
    checkout: initRepo('with-checkout'),
    docs: initRepo('with-docs'),
  };
  // Checkout agent: thư mục con của repo chính, như `~/crew-agents/<key>/<vai>`.
  const checkoutDir = join(repos.checkout, 'executor');
  mkdirSync(checkoutDir);
  // Server: REST_ONLY có repoPath cho máy này; các project có tiến độ cũng có repoPath khác (mồi) để chứng minh
  // thứ tự cũ không bị nguồn mới chen vào; NO_SOURCE chỉ có repoPath của máy khác.
  machineRepoPaths = { [REST_ONLY]: repos.rest, [WITH_FOLDER]: repos.decoy, [WITH_CHECKOUT]: repos.decoy };
  statusRepos = [{ projectId: WITH_DOCS, path: repos.docs, lastCommit: null }];
  server = await startFakePaperclip((req): FakeReply => {
    if (req.path === PROJECTS_PATH) {
      return {
        status: 200,
        body: [
          { id: REST_ONLY, name: 'crew-mac-made', urlKey: 'crew-mac-made' },
          { id: NO_SOURCE, name: 'no-source', urlKey: 'no-source' },
          { id: WITH_FOLDER, name: 'with-folder', urlKey: 'with-folder' },
          { id: WITH_CHECKOUT, name: 'with-checkout', urlKey: 'with-checkout' },
          { id: WITH_DOCS, name: 'with-docs', urlKey: 'with-docs' },
        ],
      };
    }
    for (const id of [REST_ONLY, NO_SOURCE, WITH_FOLDER, WITH_CHECKOUT, WITH_DOCS]) {
      if (req.path !== machinesPath(id)) continue;
      const mine = machineRepoPaths[id];
      return {
        status: 200,
        body: {
          machines: [
            { machineId: '99999999-9999-4999-8999-999999999999', repoPath: '/Volumes/May-khac/repo' },
            ...(mine ? [{ machineId: MACHINE.toUpperCase(), repoPath: mine }] : []),
          ],
        },
      };
    }
    return { status: 404 };
  });
  store = new AppStateStore(join(home, 'app.json'), '0.0.0-test');
  await store.update((s) => ({
    ...s,
    setup: { ...s.setup, paperclipOrigin: server.origin, companyId: COMPANY },
    projects: {
      'with-folder': progress('with-folder', WITH_FOLDER, { folder: repos.folder }),
      'with-checkout': progress('with-checkout', WITH_CHECKOUT, {
        agents: { 'executor-1': { agentId: null, environmentId: null, checkout: checkoutDir } },
      }),
    },
  }));
});
afterEach(async () => {
  for (const fn of electron.quitHandlers) fn();
  vi.unstubAllEnvs();
  await server.close();
  rmSync(home, { recursive: true, force: true });
});

const syncNow = async () => {
  const module = registerBugFinding(ctx(), createLaunchGate());
  await vi.waitFor(() => expect(existsSync(projectsFile())).toBe(true));
  await handlers.get('bugFinding:syncNow')?.();
  return module;
};

describe('E2E đồng bộ project dựng bằng crew-mac sang Bug Finding', () => {
  it('project REST không có tiến độ nhưng server ghi repoPath cho máy này: vào projects.json và qua projectKnown', async () => {
    const module = await syncNow();
    await vi.waitFor(() => expect(savedProjects().map((p) => p.crewProjectId)).toContain(REST_ONLY));
    expect(savedProjects().find((p) => p.crewProjectId === REST_ONLY)).toEqual({
      crewProjectId: REST_ONLY,
      key: 'crew-mac-made',
      name: 'crew-mac-made',
      repoPath: repos.rest,
    });
    // Server được hỏi đúng project, bằng board key.
    const asked = server.requests.find((r) => r.path === machinesPath(REST_ONLY));
    expect(asked?.method).toBe('GET');
    expect(asked?.authorization).toBe('Bearer pcp_board_khoa-gia');

    // Lượt bug-finding-review của project đó không bị projectKnown từ chối: yêu cầu được ghi và Bug Finding được mở nền.
    const outcome = await module.runReview(reviewJob(REST_ONLY, 'crew-mac-made', repos.rest), {
      origin: server.origin,
    });
    expect(outcome).toEqual({ status: 'done', result: { kind: 'bug-finding-review', accepted: true } });
    const request = JSON.parse(readFileSync(join(bridge(), 'requests', `${REQUEST}.json`), 'utf8'));
    expect(request).toMatchObject({ schema: 'crew-review-request/1', requestId: REQUEST, prNumber: 87 });
    expect(commands).toContainEqual(['/usr/bin/open', '-g', join(home, 'Bug Finding.app')]);
  });

  it('project không có nguồn nào (server không ghi repoPath cho máy này): không vào projects.json, lượt review bị từ chối', async () => {
    const module = await syncNow();
    await vi.waitFor(() => expect(savedProjects().map((p) => p.crewProjectId)).toContain(REST_ONLY));
    expect(savedProjects().map((p) => p.crewProjectId)).not.toContain(NO_SOURCE);
    expect(server.requests.some((r) => r.path === machinesPath(NO_SOURCE))).toBe(true);

    const outcome = await module.runReview(reviewJob(NO_SOURCE, 'no-source', repos.rest), {
      origin: server.origin,
    });
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'project_missing' });
    expect(commands.some((c) => c[0] === '/usr/bin/open')).toBe(false);
    expect(existsSync(join(bridge(), 'requests', `${REQUEST}.json`))).toBe(false);
  });

  it('project có tiến độ trong app.json: repo vẫn theo thứ tự docsRepo → progress.folder → checkout, không hỏi server', async () => {
    await syncNow();
    await vi.waitFor(() => expect(savedProjects().map((p) => p.crewProjectId)).toContain(REST_ONLY));
    const byId = Object.fromEntries(savedProjects().map((p) => [p.crewProjectId, p.repoPath]));
    expect(byId[WITH_DOCS]).toBe(repos.docs);
    expect(byId[WITH_FOLDER]).toBe(repos.folder);
    expect(byId[WITH_CHECKOUT]).toBe(repos.checkout);
    // Repo mồi của server không chen vào.
    expect(Object.values(byId)).not.toContain(repos.decoy);
    for (const id of [WITH_DOCS, WITH_FOLDER, WITH_CHECKOUT]) {
      expect(server.requests.some((r) => r.path === machinesPath(id))).toBe(false);
    }
    // Nguồn mới không đụng status-repos.json.
    expect(existsSync(join(home, '.crew', 'status-repos.json'))).toBe(false);
  });
});
