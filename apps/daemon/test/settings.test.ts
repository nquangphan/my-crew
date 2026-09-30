import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_GUARD_POLICY, DEFAULT_RESOURCE_SETTINGS, type EffectiveSettings } from '@crew/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { machines, settingsRevisions } from '../../api/src/db/schema.js';
import type { VpsClient } from '../src/api/vps-client.js';
import { parseConfig } from '../src/config.js';
import { renderPrompt } from '../src/roles/prompt-templates.js';
import { rolePlanner } from '../src/roles/role-planner.js';
import {
  activateSettings,
  BUNDLED_SETTINGS,
  effectiveConfig,
  localSettingsUpload,
  SettingsStore,
} from '../src/settings/settings-store.js';
import { devTicket, fixture, pmTask, useApi } from './helpers/api.js';
import { makeDaemon, waitFor } from './helpers/daemon.js';
import { makeRepo } from './helpers/git.js';

const RAW: EffectiveSettings = {
  revision: 'r1',
  prompts: {},
  policy: null,
  models: null,
  budgets: null,
  resources: null,
  projects: {},
  folders: null,
};

const LOCAL = parseConfig({
  apiUrl: 'https://crew.test',
  machineName: 'mac',
  machineId: 'm1',
  projects: [{ key: 'WEB', repoPath: '/repo/web', disabledMcpServers: ['figma'] }],
  resources: { maxConcurrentJobs: 5, minFreeMemGb: 1, maxLoadPerCpu: 2 },
  budgets: { perJobUsd: 4 },
});

describe('settings validation on the daemon', () => {
  it('keeps valid parts and replaces invalid ones with the bundled default', () => {
    const active = activateSettings(
      {
        ...RAW,
        prompts: { dev: 'Mới {{header}}', qc: '{{no_such_var}}', unknown: 'x' },
        policy: { docsPaths: ['../x'] },
        resources: { maxConcurrentJobs: 3, minFreeMemGb: 0, maxLoadPerCpu: 1 },
        models: { allow: ['haiku'] },
        projects: { WEB: { disabledMcpServers: ['figma'] }, BAD: { disabledMcpServers: 'no' } },
      },
      'server',
    );
    expect(active.prompts).toEqual({ dev: 'Mới {{header}}' });
    expect(active.policy).toEqual(DEFAULT_GUARD_POLICY);
    expect(active.resources).toEqual({ maxConcurrentJobs: 3, minFreeMemGb: 0, maxLoadPerCpu: 1 });
    expect(active.models).toBeNull();
    expect(active.projects).toEqual({ WEB: { disabledMcpServers: ['figma'] } });
    expect([...active.rejected].sort()).toEqual(
      ['models', 'policy', 'project_mcp:BAD', 'prompt:qc', 'prompt:unknown'].sort(),
    );
  });

  it('renders a prompt override in place of the bundled file, partials included', () => {
    const vars = new Proxy({}, { get: (_target, key) => `<${String(key)}>` }) as Record<string, string>;
    const bundled = renderPrompt('dev', vars);
    const custom = renderPrompt('dev', vars, {
      dev: 'Tuỳ chỉnh {{ticket_key}}\n{{> _shared-rules}}',
      '_shared-rules': 'Luật mới',
    });
    expect(bundled).not.toContain('Tuỳ chỉnh');
    expect(custom).toBe('Tuỳ chỉnh <ticket_key>\nLuật mới');
  });
});

describe('effective config', () => {
  it('puts server values over the local config', () => {
    const settings = activateSettings(
      {
        ...RAW,
        resources: { maxConcurrentJobs: 2, minFreeMemGb: 0, maxLoadPerCpu: 1 },
        projects: { WEB: { disabledMcpServers: [] } },
      },
      'server',
    );
    const config = effectiveConfig(LOCAL, settings, true);
    expect(config.resources.maxConcurrentJobs).toBe(2);
    expect(config.projects[0]?.disabledMcpServers).toEqual([]);
    expect(config.projects[0]?.repoPath).toBe('/repo/web');
  });

  it('keeps the local values until the one-time upload succeeded, then the bundled defaults', () => {
    expect(effectiveConfig(LOCAL, BUNDLED_SETTINGS, false)).toMatchObject({
      resources: LOCAL.resources,
      budgets: { perJobUsd: 4 },
      projects: [{ disabledMcpServers: ['figma'] }],
    });
    expect(effectiveConfig(LOCAL, BUNDLED_SETTINGS, true)).toMatchObject({
      resources: DEFAULT_RESOURCE_SETTINGS,
      budgets: { perJobUsd: null },
      projects: [{ disabledMcpServers: [] }],
    });
  });

  it('uploads resources, a changed budget, the MCP switches and the folders, not default models', () => {
    expect(localSettingsUpload(LOCAL)).toEqual({
      resources: LOCAL.resources,
      budgets: { perJobUsd: 4 },
      projects: [{ key: 'WEB', disabledMcpServers: ['figma'] }],
      folders: { projects: [{ key: 'WEB', repoPath: '/repo/web', sharedPaths: [] }] },
    });
  });
});

describe('settings store', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const store = (settings: VpsClient['settings']) => {
    const dir = mkdtempSync(join(tmpdir(), 'crew-settings-'));
    dirs.push(dir);
    const cacheFile = join(dir, 'settings-cache.json');
    const logs: string[] = [];
    const make = () =>
      new SettingsStore({
        vps: { settings } as VpsClient,
        cacheFile,
        log: (_level, message) => logs.push(message),
      });
    return { make, cacheFile, logs };
  };

  it('caches a good copy, uses it while the server is down, and answers a 304 from it', async () => {
    let answer: EffectiveSettings | null | Error = { ...RAW, prompts: { qc: 'QC {{header}}' } };
    const etags: (string | null)[] = [];
    const s = store(async (etag) => {
      etags.push(etag);
      if (answer instanceof Error) throw answer;
      return answer;
    });
    const first = s.make();
    expect(first.current().source).toBe('bundled');
    expect(await first.refresh()).toBe(true);
    expect(first.state()).toEqual({ revision: 'r1', source: 'server', rejected: [] });
    expect(JSON.parse(readFileSync(s.cacheFile, 'utf8')).revision).toBe('r1');

    answer = new Error('ECONNREFUSED');
    const restarted = s.make();
    expect(restarted.current()).toMatchObject({
      source: 'cache',
      revision: 'r1',
      prompts: { qc: 'QC {{header}}' },
    });
    expect(await restarted.refresh()).toBe(false);
    expect(restarted.current().source).toBe('cache');
    expect(s.logs).toContain('settings fetch failed; keeping the current settings');

    answer = null;
    expect(await restarted.refresh()).toBe(false);
    expect(restarted.current().source).toBe('server');
    expect(etags).toEqual([null, '"r1"', '"r1"']);
  });

  it('falls back to the bundled defaults without a cache, and ignores a corrupt cache', async () => {
    const s = store(async () => {
      throw new Error('offline');
    });
    writeFileSync(s.cacheFile, '{not json');
    const offline = s.make();
    expect(offline.current()).toBe(BUNDLED_SETTINGS);
    expect(await offline.refresh()).toBe(false);
    expect(offline.current()).toBe(BUNDLED_SETTINGS);
    expect(existsSync(s.cacheFile)).toBe(true);
  });
});

describe('daemon with server settings', () => {
  const api = useApi();

  it('uploads the local values once, then runs the next job with a prompt edited on the web', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, {
      repoPath: repo,
      config: { resources: { maxConcurrentJobs: 5, minFreeMemGb: 0, maxLoadPerCpu: 64 } },
      extra: { planner: rolePlanner },
    });
    await t.daemon.start();

    // The one-time import stored the local resources as this machine's override.
    const imported = await waitFor(
      async () =>
        (await api.db.select().from(settingsRevisions)).find((row) => row.kind === 'resources') ?? null,
      10_000,
      'local resources uploaded',
    );
    expect(imported).toMatchObject({
      author: 'machine:dev-mac',
      machineId: f.machine.machineId,
      content: { maxConcurrentJobs: 5, minFreeMemGb: 0, maxLoadPerCpu: 64 },
    });
    await waitFor(() => t.daemon.settings().resources?.maxConcurrentJobs === 5, 10_000, 'imported resources');

    const saved = await f.server.app.inject({
      method: 'POST',
      url: '/v1/settings',
      headers: f.owner.headers,
      payload: {
        key: { kind: 'prompt', scope: 'global', name: 'dev' },
        content: { text: '{{header}}\n\nDẤU-PROMPT-TỪ-WEB cho {{ticket_key}}\n\n{{notes}}' },
        note: 'thử prompt mới',
      },
    });
    expect(saved.statusCode).toBe(201);
    // The owner stream event reaches the daemon; it refetches without a restart.
    await waitFor(
      () => t.daemon.settings().prompts.dev?.includes('DẤU-PROMPT-TỪ-WEB'),
      10_000,
      'prompt picked up',
    );
    const revision = t.daemon.settings().revision;

    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Việc sau khi đổi prompt');
    const run = await waitFor(() => t.book.runs.find((item) => item.ticketId === dev.id), 15_000, 'dev run');
    expect(run.prompt).toContain(`DẤU-PROMPT-TỪ-WEB cho ${dev.key}`);
    const job = t.daemon.state.jobsForTicket(dev.id)[0];
    expect(job?.settingsRevision).toBe(revision);

    await t.daemon.heartbeat();
    const row = (await api.db.select().from(machines)).find((item) => item.id === f.machine.machineId);
    expect(row?.settingsState).toEqual({ revision, source: 'server', rejected: [] });
    await t.daemon.stop();
  });

  it('uses the folders set on the web once this machine can read them, and reports the ones it cannot', async () => {
    const f = await fixture(api);
    const local = makeRepo();
    const t = makeDaemon(f, { repoPath: local });
    await t.daemon.start();
    // The one-time upload stored the local folder as this machine's setting.
    await waitFor(
      async () =>
        (await api.db.select().from(settingsRevisions)).some((row) => row.kind === 'project_folders'),
      10_000,
      'folders uploaded',
    );
    expect(t.daemon.effectiveConfig().projects.map((project) => project.repoPath)).toEqual([local]);

    const save = (repoPath: string) =>
      f.server.app.inject({
        method: 'POST',
        url: '/v1/settings',
        headers: f.owner.headers,
        payload: {
          key: { kind: 'project_folders', scope: 'machine', machineId: f.machine.machineId },
          content: { projects: [{ key: f.projectKey, repoPath, sharedPaths: ['.cursor/rules'] }] },
        },
      });
    const missing = join(tmpdir(), `crew-missing-${Date.now()}`);
    expect((await save(missing)).statusCode).toBe(201);
    await waitFor(
      () => t.daemon.folderProblems().get(f.projectKey) === 'thư mục không tồn tại',
      10_000,
      'folder refused',
    );
    expect(t.daemon.effectiveConfig().projects).toEqual([]);
    await t.daemon.heartbeat();
    const reported = (await api.db.select().from(machines)).find((row) => row.id === f.machine.machineId);
    expect(reported?.settingsState?.rejected).toContain(
      `project_folder:${f.projectKey}: thư mục không tồn tại`,
    );

    const moved = makeRepo();
    expect((await save(moved)).statusCode).toBe(201);
    await waitFor(
      () => t.daemon.effectiveConfig().projects[0]?.repoPath === moved,
      10_000,
      'new folder in use',
    );
    expect(t.daemon.effectiveConfig().projects[0]).toMatchObject({
      sharedPaths: ['.cursor/rules'],
      defaultBranch: 'main',
    });
    expect(t.daemon.folderProblems().size).toBe(0);

    // The app's folder picker writes through: one project's folder, the rest kept.
    await t.daemon.setProjectFolder(f.projectKey, { repoPath: local });
    expect(t.daemon.effectiveConfig().projects[0]).toMatchObject({
      repoPath: local,
      sharedPaths: ['.cursor/rules'],
    });
    await t.daemon.stop();
  });
});
