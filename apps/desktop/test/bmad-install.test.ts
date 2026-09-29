import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AppLogEntry, BmadInstallResult, BmadProfile, ProjectDetail } from '@crew/shared';
import { describe, expect, inject, it } from 'vitest';
import { projects } from '../../api/src/db/schema.js';
import { insertPairingCode } from '../../api/test/helpers/machines.js';
import { BMAD_6_11, BMAD_6_12 } from '../../daemon/test/fixtures/bmad-installs.js';
import { useApi as apiFixture } from '../../daemon/test/helpers/api.js';
import { git, makeRepo, onCleanup, tempDir, writeFiles } from '../../daemon/test/helpers/git.js';
import {
  type BmadRunInput,
  type BmadRunner,
  bmadInstallerArgs,
  bmadInstallPlan,
  installBmad,
  npxRunner,
} from '../src/daemon-host/bmad-install.js';
import { HostContext } from '../src/daemon-host/host-context.js';
import { HostService } from '../src/daemon-host/host-service.js';
import { fakeBmadRunner, testSeams } from '../src/daemon-host/test-seams.js';

const PROFILE: BmadProfile = {
  version: '6.12.0',
  lastUpdated: '2026-09-24T15:27:41.562Z',
  modules: ['core', 'bmm', 'tea', 'bmb'],
  tools: ['claude-code', 'codex'],
  communicationLanguage: 'Vietnamese',
  documentOutputLanguage: 'English',
  outputFolder: '_bmad-output',
  settings: [
    { module: 'core', key: 'project_name', value: 'shop' },
    { module: 'bmm', key: 'project_knowledge', value: '{project-root}/docs' },
    { module: 'tea', key: 'tea_use_playwright_utils', value: 'true' },
  ],
  pins: [
    { module: 'tea', tag: 'v1.27.2' },
    { module: 'bmb', tag: 'v2.2.2' },
  ],
};

describe('BMAD install decision and installer arguments', () => {
  it('installs only into a folder without BMAD, whatever version or modules an existing install has', () => {
    const local = (version: string, modules: string[]) => ({ version, modules });
    expect(bmadInstallPlan(null, null)).toBe('no_profile');
    expect(bmadInstallPlan(null, local('6.12.0', ['core']))).toBe('no_profile');
    expect(bmadInstallPlan(PROFILE, null)).toBe('install');
    expect(bmadInstallPlan(PROFILE, local('6.12.0', ['core', 'bmm', 'tea', 'bmb']))).toBe('installed');
    expect(bmadInstallPlan(PROFILE, local('6.12.0', ['core']))).toBe('installed');
    expect(bmadInstallPlan(PROFILE, local('6.10.0', ['core', 'bmm']))).toBe('installed');
    expect(bmadInstallPlan(PROFILE, local('6.13.0', ['core']))).toBe('installed');
  });

  it('builds the exact argv of a fresh install, pinning external modules to the profile tags', () => {
    expect(bmadInstallerArgs(PROFILE, '/repos/shop')).toEqual([
      '-y',
      'bmad-method@6.12.0',
      'install',
      '--yes',
      '--directory',
      '/repos/shop',
      '--modules',
      'bmm,tea,bmb',
      '--tools',
      'claude-code,codex',
      '--communication-language',
      'Vietnamese',
      '--document-output-language',
      'English',
      '--output-folder',
      '_bmad-output',
      '--set',
      'core.project_name=shop',
      '--set',
      'bmm.project_knowledge={project-root}/docs',
      '--set',
      'tea.tea_use_playwright_utils=true',
      '--pin',
      'tea=v1.27.2',
      '--pin',
      'bmb=v2.2.2',
    ]);
    expect(bmadInstallerArgs(PROFILE, '/r')).not.toContain('--action');
  });

  it('defaults tools to Claude Code and leaves out what the profile does not set', () => {
    const bare: BmadProfile = {
      ...PROFILE,
      modules: ['core', 'bmm'],
      tools: [],
      communicationLanguage: null,
      documentOutputLanguage: null,
      outputFolder: null,
      settings: [],
      pins: [],
    };
    expect(bmadInstallerArgs(bare, '/r')).toEqual([
      '-y',
      'bmad-method@6.12.0',
      'install',
      '--yes',
      '--directory',
      '/r',
      '--modules',
      'bmm',
      '--tools',
      'claude-code',
    ]);
  });
});

const api = apiFixture();

/** A repo whose pushes go to a local bare repo (push access without network). */
function projectRepo(repoUrl: string): string {
  const repo = makeRepo({ 'README.md': '# repo\n', 'docs/flows.yaml': 'version: 1\n' });
  const bare = tempDir('crew-bare-');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', repoUrl);
  git(repo, 'remote', 'set-url', '--push', 'origin', bare);
  return repo;
}

/** A stand-in installer: records its arguments, then plays the given script. */
function stubRunner(script: (input: BmadRunInput) => ReturnType<BmadRunner>) {
  const calls: BmadRunInput[] = [];
  const runner: BmadRunner = (input) => {
    calls.push(input);
    return script(input);
  };
  return { runner, calls };
}

async function pairedHost(runner: BmadRunner) {
  const server = await api.server();
  const home = join(tempDir('crew-desktop-home-'), 'crew');
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
    bmadRunner: runner,
  });
  onCleanup(() => service.shutdown());
  const call = async <T>(method: string, params: unknown = {}) => {
    try {
      return (await service.handle(method, params)) as T;
    } finally {
      await service.settled();
    }
  };
  await call('setup.pair', { apiUrl: server.url, code: await insertPairingCode(api.db), machineName: 'mac' });
  const repo = projectRepo('git@github.com:2p/shop.git');
  await call('projects.create', {
    path: repo,
    key: 'SHOP',
    name: 'Shop',
    description: 'Cửa hàng',
    repoUrl: 'git@github.com:2p/shop.git',
    defaultBranch: 'main',
    platform: 'backend',
  });
  return { call, events, logs, repo };
}

describe('daemon host: "Cài BMAD" with a stand-in installer', () => {
  it('shows "no profile" and refuses to install until a machine reported one', async () => {
    const { runner, calls } = stubRunner(fakeBmadRunner);
    const { call } = await pairedHost(runner);
    const detail = await call<ProjectDetail>('projects.detail', { key: 'SHOP' });
    expect(detail.bmad).toEqual({ profile: null, local: null, plan: 'no_profile' });
    await expect(call('projects.installBmad', { key: 'SHOP' })).rejects.toThrow(
      'Chưa có cấu hình BMAD (máy đang giữ project chưa có BMAD).',
    );
    await expect(call('projects.installBmad', { key: 'NOPE' })).rejects.toThrow('chưa có thư mục cho NOPE');
    await expect(call('projects.installBmad', { key: 'bad' })).rejects.toThrow('Dữ liệu không hợp lệ');
    expect(calls).toHaveLength(0);
  });

  it('installs the profile, streams progress, commits nothing, reports R6 files, then skips a second click', async () => {
    const { runner, calls } = stubRunner(fakeBmadRunner);
    const { call, events, logs, repo } = await pairedHost(runner);
    await api.db.update(projects).set({ bmadProfile: PROFILE });
    const head = git(repo, 'rev-parse', 'HEAD').trim();

    expect((await call<ProjectDetail>('projects.detail', { key: 'SHOP' })).bmad).toEqual({
      profile: PROFILE,
      local: null,
      plan: 'install',
    });
    const installed = await call<BmadInstallResult>('projects.installBmad', { key: 'SHOP' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(bmadInstallerArgs(PROFILE, repo));
    expect(calls[0]?.cwd).toBe(repo);
    expect(installed.status).toBe('installed');
    expect(installed.message).toContain('Đã cài BMAD 6.12.0 (module: core, bmm, tea, bmb).');
    expect(installed.message).toContain('Không commit gì: 2 file mới');
    expect(installed.message).toContain('vùng luật R6 bảo vệ (.claude/skills/bmad-help/SKILL.md)');
    expect(installed.message).toContain('Daemon chưa chạy');
    expect(installed.detail.bmad).toMatchObject({ local: { version: '6.12.0' }, plan: 'installed' });
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(head);
    expect(git(repo, 'status', '--porcelain')).toContain('?? .claude/');
    expect(events.filter((event) => event.name === 'bmad.progress').map((event) => event.payload)).toEqual([
      { key: 'SHOP', line: 'BMad Method v6.12.0 (bộ cài giả lập của bộ test)' },
      { key: 'SHOP', line: 'Đã cài xong.' },
    ]);
    expect(logs.map((entry) => entry.event)).toEqual(
      expect.arrayContaining(['bmad-install-started', 'bmad-install-output', 'bmad-install-finished']),
    );

    const again = await call<BmadInstallResult>('projects.installBmad', { key: 'SHOP' });
    expect(again).toMatchObject({ status: 'skipped', message: 'Máy này đã có BMAD 6.12.0; không cài lại.' });
    expect(calls).toHaveLength(1);
  });

  it('never touches a folder that already has BMAD: older, incomplete, newer, or an unreadable _bmad', async () => {
    const { runner, calls } = stubRunner(fakeBmadRunner);
    const { call, repo } = await pairedHost(runner);
    await api.db.update(projects).set({ bmadProfile: PROFILE });

    writeFiles(repo, BMAD_6_11);
    expect((await call<ProjectDetail>('projects.detail', { key: 'SHOP' })).bmad).toMatchObject({
      local: { version: '6.11.0' },
      plan: 'installed',
    });
    expect(await call<BmadInstallResult>('projects.installBmad', { key: 'SHOP' })).toMatchObject({
      status: 'skipped',
      message: 'Máy này đã có BMAD 6.11.0; không cài lại.',
    });

    await api.db.update(projects).set({ bmadProfile: { ...PROFILE, version: '6.11.0' } });
    writeFiles(repo, BMAD_6_12);
    expect(await call<BmadInstallResult>('projects.installBmad', { key: 'SHOP' })).toMatchObject({
      status: 'skipped',
      message: 'Máy này đã có BMAD 6.12.0; không cài lại.',
    });

    rmSync(join(repo, '_bmad', '_config'), { recursive: true });
    expect((await call<ProjectDetail>('projects.detail', { key: 'SHOP' })).bmad).toMatchObject({
      local: null,
      plan: 'installed',
    });
    expect(await call<BmadInstallResult>('projects.installBmad', { key: 'SHOP' })).toMatchObject({
      status: 'skipped',
      message: 'Máy này đã có BMAD không rõ phiên bản; không cài lại.',
    });
    expect(calls).toHaveLength(0);
  });

  it('explains a missing npx, a network failure, an installer failure, a timeout and an incomplete install', async () => {
    let script: (input: BmadRunInput) => ReturnType<BmadRunner> = fakeBmadRunner;
    const { runner } = stubRunner((input) => script(input));
    const { call, logs } = await pairedHost(runner);
    await api.db.update(projects).set({ bmadProfile: PROFILE });

    script = async () => {
      throw Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' });
    };
    await expect(call('projects.installBmad', { key: 'SHOP' })).rejects.toThrow(
      'Không tìm thấy npx trên máy: cài Node.js (có kèm npx) rồi thử lại.',
    );
    script = async ({ onLine }) => {
      onLine('npm error code ENOTFOUND');
      onLine('npm error network request to https://registry.npmjs.org/bmad-method failed');
      return { code: 1, timedOut: false };
    };
    await expect(call('projects.installBmad', { key: 'SHOP' })).rejects.toThrow(
      'Lỗi mạng khi tải bmad-method@6.12.0',
    );
    script = async ({ onLine }) => {
      onLine('Error: Invalid action: update');
      return { code: 2, timedOut: false };
    };
    await expect(call('projects.installBmad', { key: 'SHOP' })).rejects.toThrow(
      'Trình cài BMAD thất bại (mã thoát 2): Error: Invalid action: update',
    );
    script = async () => ({ code: null, timedOut: true });
    await expect(call('projects.installBmad', { key: 'SHOP' })).rejects.toThrow(
      'Cài BMAD quá 7 phút nên đã dừng',
    );
    script = async () => ({ code: 0, timedOut: false });
    await expect(call('projects.installBmad', { key: 'SHOP' })).rejects.toThrow(
      'Trình cài BMAD chạy xong nhưng thư mục chưa khớp cấu hình 6.12.0: đang có không có _bmad.',
    );
    expect(logs.filter((entry) => entry.event === 'bmad-install-failed')).toHaveLength(5);
  });
});

describe.runIf(process.env.CREW_LIVE_BMAD_TEST === '1')('live: the real bmad-method installer', () => {
  it('installs core, bmm and a pinned external module into a temp git repo, commits nothing, then skips', async () => {
    const repo = makeRepo({ 'README.md': '# live\n' });
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    const home = tempDir('crew-live-bmad-home-');
    const lines: string[] = [];
    const ctx = new HostContext({
      home,
      runtime: process.execPath,
      crewDocsSource: '',
      appVersion: '0.0.0-live',
      env: process.env,
      emit: (_name, payload) => lines.push((payload as { line: string }).line),
    });
    const profile: BmadProfile = {
      ...PROFILE,
      modules: ['core', 'bmm', 'cis'],
      tools: ['claude-code'],
      settings: [{ module: 'bmm', key: 'project_knowledge', value: '{project-root}/docs' }],
      // An older cis tag than the current stable one, so the pin is what decides the installed version.
      pins: [{ module: 'cis', tag: 'v0.2.1' }],
    };
    const outcome = await installBmad(ctx, 'LIVE', profile, repo, {
      runner: npxRunner,
      reprobe: async () => null,
    });
    expect(outcome.status).toBe('installed');
    expect(outcome.message).toContain('vùng luật R6 bảo vệ (.claude/');
    expect(lines.length).toBeGreaterThan(0);
    expect(existsSync(join(repo, '.claude', 'skills'))).toBe(true);
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(head);
    expect(readFileSync(join(repo, '_bmad', '_config', 'manifest.yaml'), 'utf8')).toMatch(
      /- name: cis\n\s+version: v0\.2\.1/,
    );
    const again = await installBmad(ctx, 'LIVE', profile, repo, {
      runner: npxRunner,
      reprobe: async () => null,
    });
    expect(again).toEqual({ status: 'skipped', message: 'Máy này đã có BMAD 6.12.0; không cài lại.' });
  }, 600_000);
});
