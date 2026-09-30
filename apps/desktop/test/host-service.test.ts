import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '@crew/daemon';
import type {
  AppLogEntry,
  DaemonRuntimeResponse,
  DaemonStatusView,
  FolderValidation,
  HealthReport,
  Machine,
  MachineCommand,
  PairResult,
  StatusView,
} from '@crew/shared';
import { describe, expect, inject, it } from 'vitest';
import { settingsRevisions } from '../../api/src/db/schema.js';
import { publishRelease } from '../../api/src/services/runtime-service.js';
import { insertPairingCode } from '../../api/test/helpers/machines.js';
import { type LoggedInOwner, seedAndLogin } from '../../api/test/helpers/owner-session.js';
import { createTestProject } from '../../api/test/helpers/test-db.js';
import { useApi as apiFixture } from '../../daemon/test/helpers/api.js';
import { git, makeRepo, onCleanup, tempDir } from '../../daemon/test/helpers/git.js';
import { HostService } from '../src/daemon-host/host-service.js';
import { testSeams } from '../src/daemon-host/test-seams.js';
import { buildRelease, testKey } from './runtime-fixtures.js';

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
  const logs: AppLogEntry[] = [];
  const service = new HostService({
    home,
    runtime: process.execPath,
    crewDocsSource: inject('bundlePath'),
    appVersion: '0.1.0-test',
    env: { ...process.env, CREW_TOKEN_STORE: 'file' },
    emit: (name, payload) => events.push({ name, payload }),
    log: (entry) => logs.push(entry),
    seams: testSeams(home),
  });
  onCleanup(() => service.shutdown());
  // Each call also waits for the health re-check it started, so no request is in flight when a test ends
  // (the API server's close would wait for that keep-alive connection).
  const call = async <T>(method: string, params: unknown = {}) => {
    try {
      return (await service.handle(method, params)) as T;
    } finally {
      await service.settled();
    }
  };
  return { service, events, logs, call };
}

const until = async (condition: () => boolean | Promise<boolean>, ms = 20_000) => {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/** The owner's side of the web: assign a project, ask the machine for a remote action and wait for it. */
type ApiApp = Awaited<ReturnType<typeof api.server>>['app'];

function web(app: ApiApp, owner: LoggedInOwner, machineId: string) {
  return {
    assign: async (body: object) => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/machines/${machineId}/claims`,
        headers: owner.headers,
        payload: body,
      });
      expect(res.statusCode).toBe(200);
    },
    command: async (body: object): Promise<MachineCommand> => {
      const asked = await app.inject({
        method: 'POST',
        url: `/v1/machines/${machineId}/commands`,
        headers: owner.headers,
        payload: body,
      });
      expect(asked.statusCode).toBe(201);
      const id = (asked.json() as MachineCommand).id;
      let command: MachineCommand | null = null;
      await until(async () => {
        const res = await app.inject({
          method: 'GET',
          url: `/v1/machines/${machineId}/commands/${id}`,
          headers: owner.headers,
        });
        command = res.json() as MachineCommand;
        return command.status === 'done' || command.status === 'failed';
      });
      return command as unknown as MachineCommand;
    },
    saveFolders: async (projects: object[]) => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/settings',
        headers: owner.headers,
        payload: { key: { kind: 'project_folders', scope: 'machine', machineId }, content: { projects } },
      });
      expect(res.statusCode).toBe(201);
    },
  };
}

describe('daemon host: runtime updates against the real API', () => {
  it('hears a published runtime, reports the app and runtime versions, and downloads the tarball for the shell', async () => {
    const server = await api.server();
    const owner = await seedAndLogin(server.app, api.db);
    const home = join(tempDir('crew-desktop-home-'), 'crew');
    const { call, service, events } = host(home);
    expect(await call('host.runtimeCheck')).toBeNull();
    const paired = await call<PairResult>('setup.pair', {
      apiUrl: server.url,
      code: await insertPairingCode(api.db),
      machineName: 'mac-runtime',
    });
    await call('host.startDaemon');
    await until(() => service.status()?.connected === true);

    // The shell's runtime state goes out in a heartbeat at once.
    service.setFacts({
      version: '0.3.0',
      loginItem: true,
      update: { state: 'disabled', version: null, canAutoInstall: false, downloadUrl: null, message: null },
      runtime: {
        shellVersion: '0.3.0',
        version: '0.3.0',
        source: 'builtin',
        state: 'idle',
        target: null,
        message: null,
        checkedAt: null,
      },
    });
    await until(async () => {
      const res = await server.app.inject({ method: 'GET', url: '/v1/machines', headers: owner.headers });
      const machine = (res.json().items as Machine[]).find((item) => item.id === paired.machineId);
      return machine?.runtime.reported?.shellVersion === '0.3.0';
    });

    const key = testKey('host-service');
    const built = buildRelease(key.privateKey, '0.3.1');
    await publishRelease(
      api.db,
      { manifest: built.manifest, signature: built.signature ?? '', bundle: built.bundle },
      { source: 'upload', publishedBy: 'owner:owner', keys: [{ id: 'test', publicKey: key.publicKey }] },
    );
    // The stream event reaches the host, which tells the main process to check.
    await until(() => events.some((event) => event.name === 'runtime.changed'));
    const answer = await call<DaemonRuntimeResponse>('host.runtimeCheck');
    expect(answer.desired).toMatchObject({
      version: '0.3.1',
      manifest: built.manifest,
      signature: built.signature,
    });

    const downloaded = await call<{ path: string; size: number }>('host.runtimeDownload', {
      version: '0.3.1',
    });
    expect(downloaded.path).toBe(join(home, 'runtime', '.incoming', '0.3.1.tar.gz'));
    expect(readFileSync(downloaded.path).equals(built.bundle)).toBe(true);
    await expect(call('host.runtimeDownload', { version: '../0.3.1' })).rejects.toThrow(
      /Dữ liệu không hợp lệ/,
    );
  });
});

describe('daemon host: the gateway against the real API', () => {
  it('pairs, shows the projects assigned on the web, saves a picked folder to the server and runs the project', async () => {
    const server = await api.server();
    const owner = await seedAndLogin(server.app, api.db);
    const project = await createTestProject(api.db, {
      key: 'WEB',
      repoUrl: 'https://github.com/2p/web-shop.git',
    });
    const home = join(tempDir('crew-desktop-home-'), 'crew');
    const { call, service, logs } = host(home);

    // Server check, then pairing (the token goes to the token store, never to the config).
    expect(await call('setup.checkServer', { apiUrl: server.url })).toMatchObject({ ok: true });
    expect(await call('setup.checkServer', { apiUrl: 'http://crew.example.com' })).toMatchObject({
      ok: false,
      message: 'Server phải dùng https:// (TLS).',
    });
    expect(await call('setup.checkServer', { apiUrl: `${server.url}/nope` })).toMatchObject({
      ok: false,
      message: 'Server không có API /v1: phiên bản API không tương thích.',
    });
    const paired = await call<PairResult>('setup.pair', {
      apiUrl: server.url,
      code: await insertPairingCode(api.db),
      machineName: 'mac-moi',
    });
    expect(await call('host.appState')).toEqual({ apiUrl: server.url, machineName: 'mac-moi', paired: true });
    const config = loadConfig(join(home, 'config.yaml'));
    expect(JSON.stringify(config)).not.toContain('crew_mt_');
    // Resources suggested from this machine's CPU and RAM, uploaded once when the daemon starts.
    expect(config.resources.maxLoadPerCpu).toBe(1.5);
    const owned = web(server.app, owner, paired.machineId);

    // Nothing assigned yet; the owner assigns WEB and the assistant role on the web.
    const empty = await call<StatusView>('status.view');
    expect(empty).toMatchObject({ machineId: paired.machineId, projects: [], assistant: 'unowned' });
    expect(empty.links.machineSettings).toBe(`${server.url}/settings/machines/${paired.machineId}`);
    await owned.assign({ projectId: project.id });
    await owned.assign({ hostsAssistant: true });
    const assigned = await call<StatusView>('status.view');
    expect(assigned.assistant).toBe('mine');
    expect(assigned.projects).toEqual([
      expect.objectContaining({ key: 'WEB', ownerState: 'mine', localPath: null, folderProblem: null }),
    ]);

    // The folder picker checks the folder here; a wrong origin is refused and nothing is saved.
    const wrong = projectRepo('https://github.com/2p/something-else.git');
    const refused = await call<FolderValidation>('projects.setFolder', { key: 'WEB', path: wrong });
    expect(refused.ok).toBe(false);
    expect(refused.checks.find((check) => check.id === 'folder.origin')?.status).toBe('red');
    const folders = async () =>
      (await api.db.select().from(settingsRevisions)).filter((row) => row.kind === 'project_folders');
    expect(await folders()).toEqual([]);

    const repo = projectRepo('https://github.com/2p/web-shop');
    const saved = await call<FolderValidation>('projects.setFolder', { key: 'WEB', path: repo });
    expect(saved.ok).toBe(true);
    expect((await folders())[0]).toMatchObject({
      author: 'machine:mac-moi',
      content: { projects: [{ key: 'WEB', repoPath: saved.path, sharedPaths: [] }] },
    });
    // The hooks come with the folder (the app binary as the runtime).
    expect(git(repo, 'config', '--get', 'crew-docs.runtime').trim()).toBe(process.execPath);

    // The daemon runs WEB from the server's folder.
    const status = await call<DaemonStatusView>('host.startDaemon');
    expect(status.running).toBe(true);
    await until(() => service.status()?.connected === true);
    await until(async () => {
      const projects = (await call<DaemonStatusView>('host.status')).projects;
      return projects.find((p) => p.key === 'WEB')?.runnable === true;
    });
    expect((await call<StatusView>('status.view')).projects[0]).toMatchObject({ localPath: saved.path });

    // Health runs in the host with the live daemon; the heartbeat carries the same summary to the web.
    const report = await call<HealthReport>('health.run', {});
    expect(report.results.find((item) => item.id === 'server.stream')?.status).toBe('green');
    expect(report.results.find((item) => item.id === 'claude.login')?.status).toBe('green');
    expect(report.results.find((item) => item.id === 'repos.WEB.push')?.status).toBe('green');
    await service.host.daemon?.heartbeat();
    const machines = await server.app.inject({ method: 'GET', url: '/v1/machines', headers: owner.headers });
    const me = (machines.json().items as Machine[]).find((machine) => machine.id === paired.machineId);
    expect(me?.health).toEqual(report.summary);

    // A folder set on the web that this machine cannot use shows in the status view (and WEB waits).
    await owned.saveFolders([{ key: 'WEB', repoPath: join(tempDir('crew-gone-'), 'missing') }]);
    await until(async () => (await call<StatusView>('status.view')).projects[0]?.folderProblem !== null);
    expect((await call<StatusView>('status.view')).projects[0]).toMatchObject({
      localPath: null,
      folderProblem: 'thư mục không tồn tại',
    });
    await owned.saveFolders([{ key: 'WEB', repoPath: saved.path }]);
    await until(async () => (await call<StatusView>('status.view')).projects[0]?.localPath === saved.path);

    expect(JSON.stringify(logs)).not.toContain('crew_mt_');
    await call('host.stopDaemon', { mode: 'requeue' });
    expect(service.status()).toBeNull();
    expect(existsSync(join(home, 'crewd.pid'))).toBe(false);
  });

  it('runs the health checks, their fixes and the log tail the owner asks for from the web', async () => {
    const server = await api.server();
    const owner = await seedAndLogin(server.app, api.db);
    const project = await createTestProject(api.db, {
      key: 'WEB',
      repoUrl: 'https://github.com/2p/web-shop.git',
    });
    const home = join(tempDir('crew-desktop-home-'), 'crew');
    const { call, events } = host(home);
    const paired = await call<PairResult>('setup.pair', {
      apiUrl: server.url,
      code: await insertPairingCode(api.db),
      machineName: 'mac',
    });
    const owned = web(server.app, owner, paired.machineId);
    await owned.assign({ projectId: project.id });
    const repo = projectRepo('https://github.com/2p/web-shop');
    expect((await call<FolderValidation>('projects.setFolder', { key: 'WEB', path: repo })).ok).toBe(true);
    await call('host.startDaemon');

    // A deleted hook turns red; the fix asked for from the web makes it green again.
    rmSync(join(repo, '.githooks', 'pre-commit'));
    git(repo, 'config', '--unset', 'crew-docs.runtime');
    const broken = await owned.command({ action: 'health.run', quick: true });
    const hooks = (broken.result as HealthReport).results.find((item) => item.id === 'repos.WEB.hooks');
    expect(hooks).toMatchObject({ status: 'red', fix: { id: 'install-hooks:WEB' } });
    const fixed = await owned.command({ action: 'health.fix', group: 'repos', fixId: 'install-hooks:WEB' });
    expect(
      (fixed.result as HealthReport).results.find((item) => item.id === 'repos.WEB.hooks'),
    ).toMatchObject({
      status: 'green',
    });

    // Logging out of Claude turns the login probe red; its fix (open Terminal) goes to the main process.
    writeFileSync(join(home, '.test-claude-logged-out'), '');
    const loggedOut = await owned.command({ action: 'health.run', quick: false });
    expect(
      (loggedOut.result as HealthReport).results.find((item) => item.id === 'claude.login'),
    ).toMatchObject({
      status: 'red',
      fix: { id: 'open-claude-login' },
    });
    await owned.command({ action: 'health.fix', group: 'claude', fixId: 'open-claude-login' });
    expect(events).toContainEqual({ name: 'app.fix', payload: { fixId: 'open-claude-login' } });
    const restart = await owned.command({ action: 'health.fix', group: 'app', fixId: 'restart-daemon' });
    expect(restart).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('chỉ làm được trên máy'),
    });

    // The log tail the web asks for.
    const tail = await owned.command({ action: 'logs.tail', limit: 100 });
    expect((tail.result as { message: string }[]).some((line) => line.message === 'crewd started')).toBe(
      true,
    );
    await call('host.stopDaemon', { mode: 'requeue' });
  });

  it('repairs hooks whose runtime vanished (the app moved) after start, never while constructing, and leaves working hooks alone', async () => {
    const server = await api.server();
    const owner = await seedAndLogin(server.app, api.db);
    const home = join(tempDir('crew-desktop-home-'), 'crew');
    const first = host(home);
    const paired = await first.call<PairResult>('setup.pair', {
      apiUrl: server.url,
      code: await insertPairingCode(api.db),
      machineName: 'mac',
    });
    const moved = projectRepo('git@github.com:2p/moved.git', {});
    const kept = projectRepo('git@github.com:2p/kept.git', {});
    for (const [key, path] of [
      ['MOVED', moved],
      ['KEPT', kept],
    ] as const) {
      await createTestProject(api.db, {
        key,
        repoUrl: `git@github.com:2p/${key.toLowerCase()}.git`,
        ownerMachineId: paired.machineId,
      });
      expect((await first.call<FolderValidation>('projects.setFolder', { key, path })).ok).toBe(true);
    }
    expect(owner.cookie).toBeTruthy();
    // MOVED was installed by an app copy that is gone now; KEPT by another working runtime (the CLI's node).
    const gone = join(tempDir('crew-old-app-'), '2P Crew');
    const other = join(tempDir('crew-cli-'), 'node');
    writeFileSync(other, `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
    git(moved, 'config', 'crew-docs.runtime', gone);
    git(kept, 'config', 'crew-docs.runtime', other);

    // Constructing the service touches no repo: the host reports ready before any repo work, which can wait
    // on a macOS folder-permission prompt.
    const second = host(home);
    expect(git(moved, 'config', '--get', 'crew-docs.runtime').trim()).toBe(gone);
    await second.service.start();
    expect(git(moved, 'config', '--get', 'crew-docs.runtime').trim()).toBe(process.execPath);
    expect(git(kept, 'config', '--get', 'crew-docs.runtime').trim()).toBe(other);
    expect(second.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'hooks-broken',
          fields: expect.objectContaining({ project: 'MOVED' }),
        }),
        expect.objectContaining({
          event: 'hooks-installed',
          fields: expect.objectContaining({ project: 'MOVED' }),
        }),
      ]),
    );
    expect(second.logs.some((entry) => entry.fields?.project === 'KEPT')).toBe(false);
  });
});
