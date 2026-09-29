import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillInventory, UpdateStatus } from '@crew/shared';
import { describe, expect, inject, it } from 'vitest';
import { VpsClient } from '../src/api/vps-client.js';
import { homePaths, loadConfig, parseConfig, saveConfig } from '../src/config.js';
import type { Daemon } from '../src/daemon.js';
import { installCrewDocs, installHooks } from '../src/git/docs-kit-bridge.js';
import { ensureWorktree, worktreePath } from '../src/git/worktree-manager.js';
import { serviceChecks } from '../src/health/checks/app.js';
import { mcpChecks } from '../src/health/checks/mcp.js';
import { repoChecks } from '../src/health/checks/repos.js';
import { resourceChecks } from '../src/health/checks/resources.js';
import { serverChecks } from '../src/health/checks/server.js';
import { skillChecks } from '../src/health/checks/skills.js';
import { applyHealthFix, HEALTH_CHECKS } from '../src/health/health-runner.js';
import {
  inspectFolder,
  normalizeRepoUrl,
  repoFolderChecks,
  suggestProjectKey,
} from '../src/health/repo-probe.js';
import type { HealthCheckResult, HealthContext } from '../src/health/types.js';
import { ensureJobTmpDir, jobTmpDir } from '../src/runner/job-cleanup.js';
import { FileTokenStore } from '../src/secrets.js';
import { StateDb } from '../src/state-db.js';
import { fixture, pmTask, setStatus, useApi } from './helpers/api.js';
import { git, makeRepo, onCleanup, tempDir } from './helpers/git.js';

const api = useApi();
const REPO_URL = 'https://github.com/2p/web-shop.git';

const byId = (results: HealthCheckResult[], id: string) => results.find((item) => item.id === id);

function context(over: Partial<HealthContext> & { home: string }): HealthContext {
  const paths = homePaths(over.home);
  return {
    config: null,
    paths,
    tokenStore: new FileTokenStore(paths.tokenFile),
    vps: null,
    state: null,
    env: {},
    platform: process.platform,
    skipLoginProbe: true,
    exec: () => ({ code: 0, stdout: '', stderr: '' }),
    ...over,
  };
}

/** A repo whose origin is the project URL for fetch, while pushes go to a local bare repo. */
function projectRepo(files: Record<string, string> = { 'README.md': '# shop\n' }): {
  repo: string;
  bare: string;
} {
  const repo = makeRepo(files);
  const bare = tempDir('crewd-bare-');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', REPO_URL);
  git(repo, 'remote', 'set-url', '--push', 'origin', bare);
  return { repo, bare };
}

function openState(home: string): StateDb {
  mkdirSync(home, { recursive: true });
  const state = new StateDb(join(home, 'state.db'));
  onCleanup(() => state.close());
  return state;
}

describe('repo probe helpers', () => {
  it('normalizes ssh and https repo URLs to one form', () => {
    expect(normalizeRepoUrl('git@github.com:2P/Web-Shop.git')).toBe('github.com/2p/web-shop');
    expect(normalizeRepoUrl('https://github.com/2p/web-shop')).toBe('github.com/2p/web-shop');
    expect(normalizeRepoUrl('ssh://git@github.com:22/2p/web-shop.git/')).toBe('github.com/2p/web-shop');
    expect(normalizeRepoUrl('https://user@github.com/2p/web-shop.git')).toBe('github.com/2p/web-shop');
  });

  it('suggests a valid project key from the folder name', () => {
    expect(suggestProjectKey('/x/web-shop')).toBe('WEBSHOP');
    expect(suggestProjectKey('/x/2p-mobile-application')).toBe('P2PMOBILEA');
    expect(suggestProjectKey('/x/a')).toBe('PROJ');
    expect(suggestProjectKey('/x/ast')).toBe('ASTX');
  });

  it('reads origin and the default branch of a folder, and flags a wrong origin and a missing branch', () => {
    const { repo } = projectRepo();
    expect(inspectFolder(join(repo, '.'))).toMatchObject({
      isRepo: true,
      origin: REPO_URL,
      defaultBranch: 'main',
    });
    expect(inspectFolder(tempDir('crewd-plain-')).isRepo).toBe(false);

    const good = repoFolderChecks({
      idPrefix: 'folder',
      label: 'WEB',
      path: repo,
      repoUrl: 'git@github.com:2p/web-shop.git',
      defaultBranch: 'main',
      pushProbe: true,
    });
    expect(good.map((item) => [item.id, item.status])).toEqual([
      ['folder.path', 'green'],
      ['folder.origin', 'green'],
      ['folder.branch', 'green'],
      ['folder.push', 'green'],
      ['folder.tree', 'green'],
    ]);

    const wrong = repoFolderChecks({
      idPrefix: 'folder',
      label: 'WEB',
      path: repo,
      repoUrl: 'https://github.com/2p/other.git',
      defaultBranch: 'develop',
      pushProbe: false,
      repickFixKey: 'WEB',
    });
    expect(byId(wrong, 'folder.origin')).toMatchObject({ status: 'red', fix: { id: 'repick-folder:WEB' } });
    expect(byId(wrong, 'folder.branch')?.status).toBe('red');
    expect(byId(wrong, 'folder.push')).toBeUndefined();
  });

  it('reports no push access when the remote refuses the dry run', () => {
    const { repo } = projectRepo();
    git(repo, 'remote', 'set-url', '--push', 'origin', join(tempDir('crewd-gone-'), 'missing.git'));
    const results = repoFolderChecks({
      idPrefix: 'folder',
      label: 'WEB',
      path: repo,
      repoUrl: REPO_URL,
      defaultBranch: 'main',
      pushProbe: true,
    });
    expect(byId(results, 'folder.push')?.status).toBe('red');
  });
});

describe('repos group', () => {
  it('turns red on a deleted hook, wrong origin and orphan worktrees, and the fixes make it green', async () => {
    const f = await fixture(api);
    const home = tempDir('crewd-home-');
    const paths = homePaths(home);
    const tokenStore = new FileTokenStore(paths.tokenFile);
    tokenStore.set(f.machine.token);
    const { repo } = projectRepo({ 'README.md': '# shop\n', 'docs/flows.yaml': 'version: 1\n' });
    const config = saveConfig(paths.config, {
      apiUrl: f.server.url,
      machineName: 'm',
      projects: [{ key: 'WEB', repoPath: repo }],
    });
    const vps = new VpsClient({ apiUrl: f.server.url, token: () => tokenStore.get() });
    const state = openState(home);
    const bundle = installCrewDocs(paths.bin, inject('bundlePath')).bundle;
    expect(installHooks(repo, bundle).code).toBe(0);
    const ctx = context({
      home,
      config,
      vps,
      tokenStore,
      state,
      exec: () => ({ code: 0, stdout: 'git', stderr: '' }),
    });

    const green = await repoChecks.run(ctx);
    expect(green.filter((item) => item.status !== 'green')).toEqual([]);
    expect(green.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'repos.WEB.origin',
        'repos.WEB.push',
        'repos.WEB.hooks',
        'repos.WEB.docs',
        'repos.WEB.worktrees',
      ]),
    );

    // Break it: delete the hook, leave a worktree of a closed ticket behind.
    rmSync(join(repo, '.githooks', 'pre-commit'));
    const pm = await pmTask(api, f, 'Xong');
    await setStatus(api.db, pm.id, 'done');
    ensureWorktree({ repo, key: pm.key, base: 'main', sharedPaths: [] });
    const broken = await repoChecks.run(ctx);
    expect(byId(broken, 'repos.WEB.hooks')).toMatchObject({
      status: 'red',
      detail: 'Thiếu hook pre-commit.',
      fix: { id: 'install-hooks:WEB' },
    });
    expect(byId(broken, 'repos.WEB.worktrees')).toMatchObject({
      status: 'yellow',
      fix: { id: 'clean-worktrees:WEB' },
    });

    await applyHealthFix(ctx, 'repos', 'install-hooks:WEB');
    await applyHealthFix(ctx, 'repos', 'clean-worktrees:WEB');
    expect(existsSync(worktreePath(repo, pm.key))).toBe(false);
    const fixed = await repoChecks.run(ctx);
    expect(fixed.filter((item) => item.status !== 'green')).toEqual([]);

    // A folder whose origin is another repo is red and offers picking the folder again.
    git(repo, 'remote', 'set-url', 'origin', 'https://github.com/2p/other.git');
    expect(byId(await repoChecks.run({ ...ctx, quick: true }), 'repos.WEB.origin')).toMatchObject({
      status: 'red',
      fix: { id: 'repick-folder:WEB' },
    });
    // Quick runs skip the push probe.
    expect(byId(await repoChecks.run({ ...ctx, quick: true }), 'repos.WEB.push')).toBeUndefined();
  });

  it('shows a repo without docs as green with a note (docs-init runs first; not a failure)', async () => {
    const home = tempDir('crewd-home-');
    const { repo } = projectRepo();
    const config = parseConfig({
      apiUrl: 'https://crew.test',
      machineName: 'm',
      projects: [{ key: 'WEB', repoPath: repo }],
    });
    const results = await repoChecks.run(context({ home, config, quick: true }));
    expect(byId(results, 'repos.WEB.docs')).toMatchObject({
      status: 'green',
      detail: expect.stringContaining('Repo chưa có docs'),
    });
  });
});

const inventory = (over: Partial<SkillInventory> = {}): SkillInventory => ({
  skills: [
    { name: 'ak:scout', source: 'project', description: 'scout' },
    { name: 'claude-mem:do', source: 'plugin', description: 'mem' },
  ],
  mcpServers: [],
  ...over,
});

describe('mcp and skills groups', () => {
  it('requires Playwright for a web project, installs it with claude mcp add, and disables a failing server', async () => {
    const f = await fixture(api);
    const home = tempDir('crewd-home-');
    const paths = homePaths(home);
    const tokenStore = new FileTokenStore(paths.tokenFile);
    tokenStore.set(f.machine.token);
    const { repo } = projectRepo();
    const config = saveConfig(paths.config, {
      apiUrl: f.server.url,
      machineName: 'm',
      projects: [{ key: 'WEB', repoPath: repo }],
    });
    const state = openState(home);
    state.setMeta(
      'inventory:WEB',
      JSON.stringify(
        inventory({
          mcpServers: [{ name: 'figma', source: 'user', status: 'failed', tools: [] }],
        }),
      ),
    );
    const calls: string[][] = [];
    const refreshed: (string | null)[] = [];
    let playwrightConfigured = false;
    const daemon = {
      refreshInventory: async (key: string | null) => refreshed.push(key),
      updateConfig: () => {},
    };
    const ctx = context({
      home,
      config,
      state,
      tokenStore,
      vps: new VpsClient({ apiUrl: f.server.url, token: () => tokenStore.get() }),
      daemon: daemon as unknown as Daemon,
      exec: (command, args) => {
        calls.push([command, ...args]);
        const missing = args[0] === 'mcp' && args[1] === 'get' && !playwrightConfigured;
        return { code: missing ? 1 : 0, stdout: '', stderr: '' };
      },
    });
    const results = await mcpChecks.run(ctx);
    expect(byId(results, 'mcp.WEB.figma')).toMatchObject({
      status: 'red',
      fix: { id: 'mcp-disable:WEB:figma' },
    });
    expect(byId(results, 'mcp.WEB.qc-playwright')).toMatchObject({
      status: 'red',
      fix: { id: 'mcp-install:WEB:playwright' },
    });
    expect(byId(results, 'mcp.WEB.qc-maestro')).toBeUndefined();

    await applyHealthFix(ctx, 'mcp', 'mcp-install:WEB:playwright');
    expect(calls).toContainEqual([
      'claude',
      'mcp',
      'add',
      '--scope',
      'user',
      'playwright',
      '--',
      'npx',
      '-y',
      '@playwright/mcp@latest',
    ]);
    await applyHealthFix(ctx, 'mcp', 'mcp-disable:WEB:figma');
    expect(loadConfig(paths.config).projects[0]?.disabledMcpServers).toEqual(['figma']);
    expect(refreshed).toEqual(['WEB', 'WEB']);

    // Already in the user config (added by hand or for another project): no second add, only a re-probe.
    playwrightConfigured = true;
    calls.length = 0;
    await applyHealthFix(ctx, 'mcp', 'mcp-install:WEB:playwright');
    expect(calls).toEqual([['claude', 'mcp', 'get', 'playwright']]);
    expect(refreshed).toEqual(['WEB', 'WEB', 'WEB']);

    state.setMeta(
      'inventory:WEB',
      JSON.stringify(
        inventory({
          mcpServers: [
            { name: 'figma', source: 'user', status: 'failed', tools: [] },
            { name: 'playwright', source: 'user', status: 'connected', tools: [{ name: 'browser_click' }] },
          ],
        }),
      ),
    );
    const after = await mcpChecks.run(ctx);
    expect(after.filter((item) => item.status !== 'green')).toEqual([]);
  });

  it('disables a plugin MCP server whose name has colons, and drops a fragment an older build stored', async () => {
    const home = tempDir('crewd-home-');
    const paths = homePaths(home);
    const { repo } = projectRepo();
    // `plugin` is what the old parser stored for `plugin:engineering:asana`; `gone` is a real server name.
    const config = saveConfig(paths.config, {
      apiUrl: 'https://crew.test',
      machineName: 'm',
      projects: [{ key: 'VISINOTE', repoPath: repo, disabledMcpServers: ['plugin', 'gone'] }],
    });
    const state = openState(home);
    const asana = 'plugin:engineering:asana';
    const calendar = 'plugin:engineering:google calendar';
    state.setMeta(
      'inventory:VISINOTE',
      JSON.stringify(
        inventory({
          mcpServers: [
            { name: asana, source: 'plugin', status: 'failed', tools: [] },
            { name: calendar, source: 'plugin', status: 'failed', tools: [] },
          ],
        }),
      ),
    );
    const refreshed: (string | null)[] = [];
    const daemon = {
      refreshInventory: async (key: string | null) => refreshed.push(key),
      updateConfig: () => {},
    };
    const ctx = context({ home, config, state, daemon: daemon as unknown as Daemon });

    const before = await mcpChecks.run(ctx);
    expect(byId(before, `mcp.VISINOTE.${asana}`)?.fix?.id).toBe(`mcp-disable:VISINOTE:${asana}`);
    await applyHealthFix(ctx, 'mcp', `mcp-disable:VISINOTE:${asana}`);
    await applyHealthFix(ctx, 'mcp', `mcp-disable:VISINOTE:${calendar}`);
    expect(loadConfig(paths.config).projects[0]?.disabledMcpServers).toEqual(['gone', asana, calendar]);
    expect(refreshed).toEqual(['VISINOTE', 'VISINOTE']);
    expect((await mcpChecks.run(ctx)).filter((item) => item.status !== 'green')).toEqual([]);

    await applyHealthFix(ctx, 'mcp', `mcp-enable:VISINOTE:${calendar}`);
    expect(loadConfig(paths.config).projects[0]?.disabledMcpServers).toEqual(['gone', asana]);
  });

  it('compares the worktree inventory with the main checkout', async () => {
    const home = tempDir('crewd-home-');
    const { repo } = projectRepo();
    const config = parseConfig({
      apiUrl: 'https://crew.test',
      machineName: 'm',
      projects: [{ key: 'WEB', repoPath: repo }],
    });
    const state = openState(home);
    const missing = await skillChecks.run(context({ home, config, state }));
    expect(byId(missing, 'skills.WEB.inventory')).toMatchObject({
      status: 'yellow',
      fix: { id: 'skills-refresh:WEB' },
    });

    state.setMeta('inventory:WEB', JSON.stringify(inventory()));
    const checkout = inventory({
      skills: [...inventory().skills, { name: 'bmad:dev', source: 'project', description: '' }],
    });
    const results = await skillChecks.run(
      context({ home, config, state, probeCheckout: async () => checkout }),
    );
    expect(byId(results, 'skills.WEB.inventory')?.detail).toContain('2 skill (1 từ plugin: claude-mem)');
    expect(byId(results, 'skills.WEB.match')).toMatchObject({
      status: 'red',
      fix: { id: 'skills-redetect:WEB' },
    });
    expect(byId(results, 'skills.WEB.match')?.detail).toContain('bmad:dev');

    const same = await skillChecks.run(
      context({ home, config, state, probeCheckout: async () => inventory() }),
    );
    expect(byId(same, 'skills.WEB.match')?.status).toBe('green');
    const quick = await skillChecks.run(
      context({ home, config, state, quick: true, probeCheckout: async () => checkout }),
    );
    expect(byId(quick, 'skills.WEB.match')).toBeUndefined();
  });
});

describe('resources, server stream and app groups', () => {
  it('lists a finished job temp dir and cleans it with the job-cleanup code', async () => {
    const home = tempDir('crewd-home-');
    const paths = homePaths(home);
    const state = openState(home);
    const job = state.insertJob({ ticketId: 'WEB-1', projectId: null, role: 'dev', trigger: 'test' });
    state.updateJob(job.id, { status: 'done', endedAt: new Date().toISOString() });
    onCleanup(() => rmSync(paths.tmp, { recursive: true, force: true }));
    ensureJobTmpDir(paths.tmp, job.id);
    writeFileSync(join(jobTmpDir(paths.tmp, job.id), 'scratch.txt'), 'x'.repeat(1024));
    const config = parseConfig({ apiUrl: 'https://crew.test', machineName: 'm' });
    const ctx = context({ home, config, state });
    const before = await resourceChecks.run(ctx);
    expect(byId(before, 'resources.tmp')).toMatchObject({
      status: 'yellow',
      fix: { id: 'cleanup-resources' },
    });
    await applyHealthFix(ctx, 'resources', 'cleanup-resources');
    expect(existsSync(jobTmpDir(paths.tmp, job.id))).toBe(false);
    expect(byId(await resourceChecks.run(ctx), 'resources.tmp')?.status).toBe('green');
    expect(state.cleanups({ limit: 5 }).length).toBeGreaterThan(0);
  });

  it('shows the SSE state of a running daemon and reconnects it', async () => {
    const f = await fixture(api);
    const home = tempDir('crewd-home-');
    const paths = homePaths(home);
    const tokenStore = new FileTokenStore(paths.tokenFile);
    tokenStore.set(f.machine.token);
    let connected = false;
    const stream = {
      get connected() {
        return connected;
      },
      stop: async () => {},
      start: () => {
        connected = true;
      },
    };
    const daemon = {
      stream,
      status: () => ({ running: true, connected, lastEventAt: '2026-09-29T01:00:00.000Z' }),
    } as unknown as Daemon;
    const ctx = context({
      home,
      tokenStore,
      config: parseConfig({ apiUrl: f.server.url, machineName: 'm' }),
      vps: new VpsClient({ apiUrl: f.server.url, token: () => tokenStore.get() }),
      daemon,
    });
    expect(byId(await serverChecks.run(ctx), 'server.stream')).toMatchObject({
      status: 'red',
      fix: { id: 'reconnect' },
    });
    await applyHealthFix(ctx, 'server', 'reconnect');
    expect(byId(await serverChecks.run(ctx), 'server.stream')).toMatchObject({ status: 'green' });
  });

  it('adds the desktop app checks when the app provides its facts', async () => {
    const update: UpdateStatus = {
      state: 'available',
      version: '0.2.0',
      canAutoInstall: false,
      downloadUrl: 'https://github.com/x/y/releases/tag/v0.2.0',
      message: null,
    };
    const results = await serviceChecks.run(
      context({
        home: tempDir('crewd-home-'),
        platform: 'darwin',
        exec: () => ({ code: 0, stdout: 'Aqua\n', stderr: '' }),
        daemon: { status: () => ({ running: false }) } as unknown as Daemon,
        app: { version: '0.1.0', loginItem: false, update },
      }),
    );
    expect(byId(results, 'app.daemon')).toMatchObject({ status: 'red', fix: { id: 'restart-daemon' } });
    expect(byId(results, 'app.login-item')).toMatchObject({
      status: 'yellow',
      fix: { id: 'enable-login-item' },
    });
    expect(byId(results, 'app.version')).toMatchObject({
      status: 'yellow',
      fix: { id: 'install-update', label: 'Tải bản mới' },
    });
    expect(byId(results, 'app.session')?.status).toBe('green');

    // No release published yet (the updater's 404 / empty feed) is not a problem; a network error is.
    const version = async (state: UpdateStatus['state'], message: string | null = null) =>
      byId(
        await serviceChecks.run(
          context({
            home: tempDir('crewd-home-'),
            platform: 'darwin',
            exec: () => ({ code: 0, stdout: 'Aqua\n', stderr: '' }),
            app: { version: '0.1.0', loginItem: true, update: { ...update, state, message } },
          }),
        ),
        'app.version',
      );
    expect(await version('unpublished')).toMatchObject({
      status: 'green',
      detail: 'Chưa có bản phát hành nào; đang dùng 0.1.0.',
    });
    expect(await version('error', 'net::ERR_INTERNET_DISCONNECTED')).toMatchObject({ status: 'yellow' });
  });

  it('runs every group in dashboard order and refuses a fix for a group without fixes', async () => {
    expect(HEALTH_CHECKS.map((check) => check.group)).toEqual([
      'server',
      'claude',
      'mcp',
      'skills',
      'repos',
      'machine',
      'resources',
      'app',
    ]);
    await expect(
      applyHealthFix(context({ home: tempDir('crewd-home-') }), 'machine', 'adjust-limits'),
    ).rejects.toThrow('không có cách sửa tự động');
  });
});
