import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '@crew/daemon';
import type {
  ClaimOutcome,
  DaemonStatusView,
  HealthReport,
  HookView,
  Machine,
  PairResult,
  ProjectDetail,
} from '@crew/shared';
import { describe, expect, inject, it } from 'vitest';
import { freshTotp, insertPairingCode, pairTestMachine } from '../../api/test/helpers/machines.js';
import { seedAndLogin } from '../../api/test/helpers/owner-session.js';
import { createTestProject } from '../../api/test/helpers/test-db.js';
import { useApi as apiFixture } from '../../daemon/test/helpers/api.js';
import { git, makeRepo, onCleanup, tempDir } from '../../daemon/test/helpers/git.js';
import { HostService } from '../src/daemon-host/host-service.js';
import { testSeams } from '../src/daemon-host/test-seams.js';

const api = apiFixture();

/** A repo whose fetch URL is the project URL while pushes go to a local bare repo (push access without network). */
function projectRepo(
  repoUrl: string,
  files: Record<string, string> = { 'docs/flows.yaml': 'version: 1\n' },
): string {
  const repo = makeRepo({ 'README.md': '# repo\n', ...files });
  const bare = tempDir('crew-bare-');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', repoUrl);
  git(repo, 'remote', 'set-url', '--push', 'origin', bare);
  return repo;
}

function host(home: string) {
  const events: { name: string; payload: unknown }[] = [];
  const service = new HostService({
    home,
    runtime: process.execPath,
    crewDocsSource: inject('bundlePath'),
    appVersion: '0.1.0-test',
    env: { ...process.env, CREW_TOKEN_STORE: 'file' },
    emit: (name, payload) => events.push({ name, payload }),
    seams: testSeams(home),
  });
  onCleanup(() => service.shutdown());
  const call = <T>(method: string, params: unknown = {}) => service.handle(method, params) as Promise<T>;
  return { service, events, call };
}

const until = async (condition: () => boolean | Promise<boolean>, ms = 20_000) => {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

describe('daemon host: setup wizard operations against the real API', () => {
  it('checks the server, pairs, claims projects (202 pending for a takeover) and runs them once approved', async () => {
    const server = await api.server();
    const owner = await seedAndLogin(server.app, api.db);
    const other = await pairTestMachine(api.db, 'may-cu');
    await createTestProject(api.db, { key: 'WEB', repoUrl: 'https://github.com/2p/web-shop.git' });
    await createTestProject(api.db, {
      key: 'APP',
      name: 'Mobile app',
      repoUrl: 'git@github.com:2p/mobile-app.git',
      platform: 'mobile',
      ownerMachineId: other.machineId,
    });
    const home = join(tempDir('crew-desktop-home-'), 'crew');
    const { call, service } = host(home);

    // Step 1: server.
    expect(await call('setup.checkServer', { apiUrl: server.url })).toMatchObject({ ok: true });
    expect(await call('setup.checkServer', { apiUrl: 'http://crew.example.com' })).toMatchObject({
      ok: false,
      message: 'Server phải dùng https:// (TLS).',
    });
    expect(await call('setup.checkServer', { apiUrl: `${server.url}/nope` })).toMatchObject({
      ok: false,
      message: 'Server không có API /v1: phiên bản API không tương thích.',
    });

    // Step 2: pairing (the token goes to the token store, never to the config).
    await expect(call('projects.list')).rejects.toThrow('Máy chưa được ghép');
    const code = await insertPairingCode(api.db);
    const paired = await call<PairResult>('setup.pair', { apiUrl: server.url, code, machineName: 'mac-moi' });
    expect(paired.machineName).toBe('mac-moi');
    expect(await call('host.appState')).toEqual({ apiUrl: server.url, machineName: 'mac-moi', paired: true });
    expect(JSON.stringify(loadConfig(join(home, 'config.yaml')))).not.toContain('crew_mt_');

    // Step 4: projects and folders.
    const web = projectRepo('https://github.com/2p/web-shop');
    const app = projectRepo('https://github.com/2p/mobile-app.git');
    const wrong = projectRepo('https://github.com/2p/something-else.git');
    const wrongOrigin = await call<ClaimOutcome[]>('projects.apply', {
      selections: [{ key: 'WEB', path: wrong }],
      assistant: false,
    });
    expect(wrongOrigin[0]).toMatchObject({ target: 'WEB', status: 'error' });
    expect(wrongOrigin[0]?.message).toContain('origin');

    const outcomes = await call<ClaimOutcome[]>('projects.apply', {
      selections: [
        { key: 'WEB', path: web },
        { key: 'APP', path: app },
      ],
      assistant: true,
    });
    expect(outcomes.map((item) => [item.target, item.status])).toEqual([
      ['WEB', 'granted'],
      ['APP', 'pending'],
      ['assistant', 'granted'],
    ]);
    expect(outcomes[1]?.message).toContain('Đang chờ duyệt trên web');
    expect(loadConfig(join(home, 'config.yaml')).projects.map((p) => [p.key, p.repoPath])).toEqual([
      ['WEB', web],
      ['APP', app],
    ]);
    const list = await call<{ items: { key: string; pendingClaim: boolean; localPath: string | null }[] }>(
      'projects.list',
    );
    expect(list.items.find((item) => item.key === 'APP')).toMatchObject({
      pendingClaim: true,
      localPath: app,
    });

    // Step 5: hooks with the app binary as the runtime.
    const hook = await call<HookView>('hooks.install', { key: 'WEB' });
    expect(hook).toMatchObject({ installed: true, current: true, docsInitialized: true });
    expect(git(web, 'config', '--get', 'crew-docs.runtime').trim()).toBe(process.execPath);

    // Step 6: resources are validated (sonnet stays allowed) and saved.
    const view = await call<{ suggested: { maxConcurrentJobs: number } }>('config.resources');
    expect(view.suggested.maxConcurrentJobs).toBeGreaterThanOrEqual(1);
    await call('config.saveResources', {
      resources: { maxConcurrentJobs: 3, minFreeMemGb: 0, maxLoadPerCpu: 64 },
      models: {
        allow: ['haiku', 'sonnet'],
        complexityMap: {
          trivial: { model: 'haiku', effort: 'low' },
          small: { model: 'sonnet', effort: 'medium' },
          medium: { model: 'sonnet', effort: 'high' },
          large: { model: 'sonnet', effort: 'high' },
        },
      },
    });
    expect(loadConfig(join(home, 'config.yaml')).resources.maxConcurrentJobs).toBe(3);

    // Step 7: the daemon runs WEB at once; APP waits for the owner's approval.
    const status = await call<DaemonStatusView>('host.startDaemon');
    expect(status.running).toBe(true);
    await until(() => service.status()?.connected === true);
    await until(async () => {
      const projects = (await call<DaemonStatusView>('host.status')).projects;
      return projects.find((p) => p.key === 'WEB')?.runnable === true;
    });
    expect(
      (await call<DaemonStatusView>('host.status')).projects.find((p) => p.key === 'APP')?.runnable,
    ).toBe(false);

    const requests = await server.app.inject({
      method: 'GET',
      url: '/v1/claim-requests?status=pending',
      headers: owner.headers,
    });
    const pending = requests.json().items as { id: string; projectKey: string }[];
    expect(pending.map((item) => item.projectKey)).toEqual(['APP']);
    const approved = await server.app.inject({
      method: 'POST',
      url: `/v1/claim-requests/${pending[0]?.id}/approve`,
      headers: owner.headers,
      payload: { code: await freshTotp(api.db, owner.totpSecret) },
    });
    expect(approved.statusCode).toBe(200);
    await until(async () => {
      const projects = (await call<DaemonStatusView>('host.status')).projects;
      return projects.find((p) => p.key === 'APP')?.runnable === true;
    });

    // Health runs in the host with the live daemon; the heartbeat carries the same summary to the web.
    const report = await call<HealthReport>('health.run', {});
    expect(report.results.find((item) => item.id === 'server.stream')?.status).toBe('green');
    expect(report.results.find((item) => item.id === 'claude.login')?.status).toBe('green');
    expect(report.results.find((item) => item.id === 'skills.WEB.inventory')?.detail).toContain(
      'crew-test:scout',
    );
    expect(report.results.find((item) => item.id === 'repos.WEB.push')?.status).toBe('green');
    await service.host.daemon?.heartbeat();
    const machines = await server.app.inject({ method: 'GET', url: '/v1/machines', headers: owner.headers });
    const me = (machines.json().items as Machine[]).find((machine) => machine.id === paired.machineId);
    expect(me?.health).toEqual(report.summary);

    // A deleted hook turns red, the fix makes it green again.
    rmSync(join(web, '.githooks', 'pre-commit'));
    git(web, 'config', '--unset', 'crew-docs.runtime');
    const broken = await call<HealthReport>('health.run', { quick: true });
    expect(broken.results.find((item) => item.id === 'repos.WEB.hooks')?.status).toBe('red');
    // Quick runs keep the last known probe rows (the push dry run and the login probe).
    expect(broken.results.find((item) => item.id === 'repos.WEB.push')?.status).toBe('green');
    const fixed = await call<HealthReport>('health.fix', { group: 'repos', fixId: 'install-hooks:WEB' });
    expect(fixed.results.find((item) => item.id === 'repos.WEB.hooks')).toMatchObject({ status: 'green' });

    // Logging out of Claude turns the login probe red.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(home, '.test-claude-logged-out'), '');
    const loggedOut = await call<HealthReport>('health.run', {});
    expect(loggedOut.results.find((item) => item.id === 'claude.login')).toMatchObject({
      status: 'red',
      fix: { id: 'open-claude-login' },
    });

    // The log viewer tails the daemon log.
    const lines = await call<{ message: string }[]>('logs.tail', { limit: 50 });
    expect(lines.some((line) => line.message === 'crewd started')).toBe(true);

    await call('host.stopDaemon', { mode: 'requeue' });
    expect(service.status()).toBeNull();
    expect(existsSync(join(home, 'crewd.pid'))).toBe(false);
  });

  it('creates a project from a folder, refuses a duplicate key, edits settings live and releases a project', async () => {
    const server = await api.server();
    await createTestProject(api.db, { key: 'WEB', repoUrl: 'https://github.com/2p/web-shop.git' });
    const home = join(tempDir('crew-desktop-home-'), 'crew');
    const { call } = host(home);
    await call('setup.pair', {
      apiUrl: server.url,
      code: await insertPairingCode(api.db),
      machineName: 'mac',
    });

    const folder = projectRepo('git@github.com:2p/new-thing.git', {});
    const info = await call<{ suggestedKey: string; origin: string; defaultBranch: string }>(
      'folder.inspect',
      {
        path: folder,
      },
    );
    expect(info).toMatchObject({ origin: 'git@github.com:2p/new-thing.git', defaultBranch: 'main' });
    expect(info.suggestedKey).toMatch(/^[A-Z][A-Z0-9]{1,9}$/);

    const created = await call<ClaimOutcome>('projects.create', {
      path: folder,
      key: 'NEW',
      name: 'Dự án mới',
      description: 'Công cụ nội bộ do chủ dự án mô tả',
      repoUrl: 'git@github.com:2p/new-thing.git',
      defaultBranch: 'main',
      platform: 'backend',
    });
    expect(created).toMatchObject({ target: 'NEW', status: 'granted' });
    await expect(
      call('projects.create', {
        path: folder,
        key: 'WEB',
        name: 'Trùng',
        description: 'x',
        repoUrl: 'git@github.com:2p/new-thing.git',
        defaultBranch: 'main',
        platform: 'web',
      }),
    ).rejects.toThrow('Key WEB đã có trên server');

    const detail = await call<{ sharedPaths: { extra: string[] }; disabledMcpServers: string[] }>(
      'projects.setSharedPaths',
      { key: 'NEW', paths: ['.cursor/rules'] },
    );
    expect(detail.sharedPaths.extra).toEqual(['.cursor/rules']);
    const mcp = await call<{ disabledMcpServers: string[] }>('projects.setMcpEnabled', {
      key: 'NEW',
      server: 'figma',
      enabled: false,
    });
    expect(mcp.disabledMcpServers).toEqual(['figma']);
    await expect(call('projects.setSharedPaths', { key: 'NEW', paths: ['../outside'] })).rejects.toThrow(
      'Dữ liệu không hợp lệ',
    );

    const released = await call<ClaimOutcome>('projects.release', { key: 'NEW' });
    expect(released.status).toBe('released');
    expect(loadConfig(join(home, 'config.yaml')).projects).toEqual([]);
  });

  it('asks the owner to change the project type and UI-test MCP mapping, pending until approved on the web', async () => {
    const server = await api.server();
    const owner = await seedAndLogin(server.app, api.db);
    await createTestProject(api.db, { key: 'WEB', repoUrl: 'https://github.com/2p/web-shop.git' });
    const home = join(tempDir('crew-desktop-home-'), 'crew');
    const { call } = host(home);
    await call('setup.pair', {
      apiUrl: server.url,
      code: await insertPairingCode(api.db),
      machineName: 'mac',
    });
    const folder = projectRepo('git@github.com:2p/new-thing.git', {});
    await call('projects.create', {
      path: folder,
      key: 'NEW',
      name: 'Dự án mới',
      description: 'Công cụ nội bộ do chủ dự án mô tả',
      repoUrl: 'git@github.com:2p/new-thing.git',
      defaultBranch: 'main',
      platform: 'backend',
    });

    const setup = { platform: 'web', uiTestMcp: { playwright: 'pw-cloud', maestro: 'maestro' } };
    const pending = await call<ProjectDetail>('projects.requestTestSetup', { key: 'NEW', ...setup });
    expect(pending).toMatchObject({ platform: 'backend', requiredMcps: [], pendingChange: setup });
    await expect(
      call('projects.requestTestSetup', { key: 'NEW', platform: 'mobile', uiTestMcp: setup.uiTestMcp }),
    ).rejects.toThrow('Đã có một thay đổi khác đang chờ chủ dự án xác nhận.');
    await expect(call('projects.requestTestSetup', { key: 'WEB', ...setup })).rejects.toThrow(
      'Máy này không sở hữu project WEB',
    );

    const approved = await server.app.inject({
      method: 'POST',
      url: `/v1/project-change-requests/${pending.pendingChange?.requestId}/approve`,
      headers: owner.headers,
      payload: { code: await freshTotp(api.db, owner.totpSecret) },
    });
    expect(approved.statusCode).toBe(200);
    expect(await call<ProjectDetail>('projects.detail', { key: 'NEW' })).toMatchObject({
      platform: 'web',
      uiTestMcp: setup.uiTestMcp,
      requiredMcps: ['pw-cloud'],
      pendingChange: null,
    });
  });
});
