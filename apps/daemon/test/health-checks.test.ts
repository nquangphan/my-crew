import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { VpsClient } from '../src/api/vps-client.js';
import { doctor } from '../src/commands/doctor.js';
import { homePaths, parseConfig } from '../src/config.js';
import { hookStatus, installCrewDocs, installHooks } from '../src/git/docs-kit-bridge.js';
import {
  claudeChecks,
  compareVersions,
  loginProbe,
  parseClaudeVersion,
} from '../src/health/checks/claude.js';
import { repoChecks } from '../src/health/checks/repos.js';
import { summarize } from '../src/health/health-runner.js';
import type { HealthContext } from '../src/health/types.js';
import { FileTokenStore } from '../src/secrets.js';
import { installService, systemdUnit } from '../src/service/systemd.js';
import { fixture, useApi } from './helpers/api.js';
import { makeRepo, tempDir } from './helpers/git.js';

const api = useApi();

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
    exec: () => ({ code: 0, stdout: '2.1.283 (Claude Code)\n', stderr: '' }),
    ...over,
  };
}

describe('health checks', () => {
  it('compares versions and parses the CLI output', () => {
    expect(compareVersions('2.1.283', '2.1.277')).toBeGreaterThan(0);
    expect(compareVersions('2.1.9', '2.1.277')).toBeLessThan(0);
    expect(compareVersions('2.2', '2.1.999')).toBeGreaterThan(0);
    expect(parseClaudeVersion('2.1.283 (Claude Code)')).toBe('2.1.283');
  });

  it('fails when ANTHROPIC_API_KEY is in the service env or the CLI is too old', async () => {
    const home = tempDir('crewd-home-');
    const bad = await claudeChecks.run(
      context({
        home,
        env: { ANTHROPIC_API_KEY: 'x' },
        exec: () => ({ code: 0, stdout: '2.1.100 (Claude Code)', stderr: '' }),
      }),
    );
    expect(bad.find((r) => r.id === 'claude.api-key-env')?.status).toBe('red');
    expect(bad.find((r) => r.id === 'claude.cli')?.status).toBe('red');
    const good = await claudeChecks.run(context({ home }));
    expect(good.every((r) => r.status === 'green')).toBe(true);
    expect(summarize([...bad, ...good])).toEqual({
      status: 'red',
      failing: [
        { id: 'claude.api-key-env', title: 'Không có ANTHROPIC_API_KEY' },
        { id: 'claude.cli', title: 'Claude Code CLI' },
      ],
    });
  });

  it('summarizes warnings as yellow and lists only red checks as failing', () => {
    const row = (id: string, status: 'green' | 'yellow' | 'red') => ({
      id,
      group: 'repos' as const,
      title: id,
      status,
      detail: '',
    });
    expect(
      summarize([row('a', 'green'), row('mcp.X.device', 'yellow'), row('app.version', 'yellow')]),
    ).toEqual({ status: 'yellow', failing: [] });
    expect(summarize([row('mcp.X.device', 'yellow'), row('repos.X.hooks', 'red')])).toEqual({
      status: 'red',
      failing: [{ id: 'repos.X.hooks', title: 'repos.X.hooks' }],
    });
  });

  it('the login probe flags API-key billing', async () => {
    const query = ((params: { options: Record<string, unknown> }) => {
      expect(params.options).toMatchObject({
        model: 'haiku',
        settingSources: [],
        tools: [],
        permissionMode: 'dontAsk',
      });
      expect(params.options.env).not.toHaveProperty('ANTHROPIC_API_KEY');
      const iterator = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          apiKeySource: 'ANTHROPIC_API_KEY',
          claude_code_version: '2.1.283',
        };
        yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.001, result: 'ok' };
      })();
      return Object.assign(iterator, {
        initializationResult: async () => ({ account: {} }),
        close: () => {},
      });
    }) as never;
    const probe = await loginProbe({ query, env: { ANTHROPIC_API_KEY: 'sk-x' } });
    expect(probe).toMatchObject({ ok: true, apiKeySource: 'ANTHROPIC_API_KEY', costUsd: 0.001 });
    const results = await claudeChecks.run(
      context({ home: tempDir('crewd-home-'), skipLoginProbe: false, query }),
    );
    expect(results.find((r) => r.id === 'claude.login')).toMatchObject({ status: 'red' });
  });

  it('doctor installs missing crew-docs and repo hooks, then reports green', async () => {
    const home = tempDir('crewd-home-');
    const repo = makeRepo();
    const config = parseConfig({
      apiUrl: 'https://crew.test',
      machineName: 'm',
      projects: [{ key: 'WEB', repoPath: repo }],
    });
    const paths = homePaths(home);
    const ctx = context({ home, config });
    const before = await repoChecks.run(ctx);
    expect(before.find((r) => r.id === 'repos.crew-docs')?.status).toBe('red');
    expect(before.find((r) => r.id === 'repos.WEB.hooks')?.fix?.id).toBe('install-hooks:WEB');

    installCrewDocs(paths.bin, inject('bundlePath'));
    const report = await doctor(ctx, { fix: true });
    const hooks = report.results.find((r) => r.id === 'repos.WEB.hooks');
    expect(hooks).toMatchObject({ status: 'green', fixed: true });
    expect(hookStatus(repo).installed).toBe(true);
    expect(existsSync(join(repo, '.githooks/pre-commit'))).toBe(true);
    expect(report.text).toContain('Hook crew-docs của WEB (đã tự sửa)');
  });

  it('accepts hooks installed with another working runtime and never rewrites them; repairs a vanished runtime', async () => {
    const home = tempDir('crewd-home-');
    const repo = makeRepo();
    const config = parseConfig({
      apiUrl: 'https://crew.test',
      machineName: 'm',
      projects: [{ key: 'WEB', repoPath: repo }],
    });
    const paths = homePaths(home);
    const bundle = installCrewDocs(paths.bin, inject('bundlePath')).bundle;
    // Another installer's runtime (the desktop app binary in production): a separate executable that runs
    // the bundle like node does.
    const other = join(tempDir('crewd-runtime-'), 'app-runtime');
    writeFileSync(other, `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
    expect(installHooks(repo, bundle, other).code).toBe(0);

    const report = await doctor(context({ home, config }), { fix: true });
    expect(report.results.find((r) => r.id === 'repos.WEB.hooks')).toMatchObject({
      status: 'green',
      detail: expect.stringContaining(`runtime ${other}`),
    });
    expect(hookStatus(repo).runtime).toBe(other);

    // The other runtime disappears (the app moved or was removed): red, and the fix reinstalls with this one.
    rmSync(other);
    const broken = await repoChecks.run(context({ home, config }));
    expect(broken.find((r) => r.id === 'repos.WEB.hooks')).toMatchObject({
      status: 'red',
      detail: expect.stringContaining('không còn tồn tại'),
      fix: { id: 'install-hooks:WEB' },
    });
    const fixed = await doctor(context({ home, config }), { fix: true });
    expect(fixed.results.find((r) => r.id === 'repos.WEB.hooks')).toMatchObject({
      status: 'green',
      fixed: true,
    });
    expect(hookStatus(repo).runtime).toBe(process.execPath);
  });

  it('server checks: reachable, token valid, expiry', async () => {
    const f = await fixture(api);
    const home = tempDir('crewd-home-');
    const paths = homePaths(home);
    const tokenStore = new FileTokenStore(paths.tokenFile);
    tokenStore.set(f.machine.token);
    const config = parseConfig({ apiUrl: f.server.url, machineName: 'm' });
    const vps = new VpsClient({ apiUrl: f.server.url, token: () => tokenStore.get() });
    const { serverChecks } = await import('../src/health/checks/server.js');
    const ok = await serverChecks.run(context({ home, config, vps, tokenStore }));
    expect(ok.map((r) => [r.id, r.status])).toEqual([
      ['server.reachable', 'green'],
      ['server.token', 'green'],
    ]);
    tokenStore.set(`crew_mt_${'0'.repeat(43)}`);
    const refused = await serverChecks.run(context({ home, config, vps, tokenStore }));
    expect(refused.find((r) => r.id === 'server.token')?.status).toBe('red');
  });
});

describe('systemd user unit', () => {
  it('renders a user unit without an API key and installs it through systemctl --user', () => {
    const unit = systemdUnit({
      nodePath: '/usr/bin/node',
      cliPath: '/opt/crew/cli.js',
      crewHome: '/home/me/.crew',
    });
    expect(unit).toContain('ExecStart=/usr/bin/node /opt/crew/cli.js start');
    expect(unit).toContain('UnsetEnvironment=ANTHROPIC_API_KEY');
    expect(unit).toContain('WantedBy=default.target');
    const dir = tempDir('crewd-unit-');
    const calls: string[][] = [];
    const path = installService({
      nodePath: '/usr/bin/node',
      cliPath: '/opt/crew/cli.js',
      crewHome: '/home/me/.crew',
      unitDir: dir,
      systemctl: (args) => {
        calls.push(args);
        return { code: 0, stderr: '' };
      },
    });
    expect(readFileSync(path, 'utf8')).toBe(unit);
    expect(calls).toEqual([['daemon-reload'], ['enable', '--now', 'crewd.service']]);
  });
});
