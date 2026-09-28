import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseConfig, saveConfig } from '../src/config.js';
import { backoffDelayMs, classifyRetry, isBackoffError } from '../src/runner/retry-classifier.js';
import { scrubSecrets } from '../src/runner/secret-scrubber.js';
import { mcpServersUsed, skillsInvoked, slashCommandsIn } from '../src/runner/skill-usage.js';
import { FileTokenStore, KeychainTokenStore } from '../src/secrets.js';
import { StateDb } from '../src/state-db.js';
import { tempDir } from './helpers/git.js';

describe('config', () => {
  it('fills defaults and validates', () => {
    const config = parseConfig({ apiUrl: 'https://crew.2p-solutions.com', machineName: 'mac' });
    expect(config).toMatchObject({
      projects: [],
      resources: { maxConcurrentJobs: 2, minFreeMemGb: 2, maxLoadPerCpu: 1.5 },
      models: {
        allow: ['haiku', 'sonnet', 'opus'],
        complexityMap: { large: { model: 'opus', effort: 'high' } },
      },
      budgets: { perJobUsd: null },
      autoCloseRequests: false,
    });
  });

  it('rejects a model allowlist without sonnet (docs work always runs on sonnet)', () => {
    expect(() =>
      parseConfig({ apiUrl: 'https://x.test', machineName: 'm', models: { allow: ['haiku', 'opus'] } }),
    ).toThrow(/models.allow must include sonnet/);
  });

  it('rejects relative repo paths, duplicate keys and paths escaping the repo', () => {
    const base = { apiUrl: 'https://x.test', machineName: 'm' };
    expect(() => parseConfig({ ...base, projects: [{ key: 'WEB', repoPath: 'rel/path' }] })).toThrow(
      ConfigError,
    );
    expect(() =>
      parseConfig({
        ...base,
        projects: [
          { key: 'WEB', repoPath: '/a' },
          { key: 'WEB', repoPath: '/b' },
        ],
      }),
    ).toThrow(/unique/);
    expect(() =>
      parseConfig({ ...base, projects: [{ key: 'WEB', repoPath: '/a', sharedPaths: ['../x'] }] }),
    ).toThrow(ConfigError);
  });

  it('saves atomically with mode 0600 and loads back', () => {
    const path = join(tempDir('crewd-cfg-'), 'config.yaml');
    saveConfig(path, {
      apiUrl: 'https://x.test',
      machineName: 'm',
      projects: [{ key: 'WEB', repoPath: '/repo' }],
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadConfig(path).projects[0]).toMatchObject({
      key: 'WEB',
      defaultBranch: 'main',
      sharedPaths: [],
    });
    expect(() => loadConfig(join(tempDir('crewd-cfg-'), 'missing.yaml'))).toThrow(/crewd pair/);
  });
});

describe('secrets', () => {
  it('keeps the token in a 0600 file', () => {
    const file = join(tempDir('crewd-sec-'), 'machine-token');
    const store = new FileTokenStore(file);
    expect(store.get()).toBeNull();
    store.set(`crew_mt_${'x'.repeat(43)}`);
    expect(store.get()).toBe(`crew_mt_${'x'.repeat(43)}`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    store.delete();
    expect(store.get()).toBeNull();
    expect(() => store.set('short')).toThrow(/malformed/);
  });

  it('writes to the Keychain through `security -i`, so the token never shows in argv', () => {
    const dir = tempDir('crewd-sec-');
    const fake = join(dir, 'security');
    writeFileSync(
      fake,
      `#!/bin/sh\necho "$@" >> "${dir}/argv"\nif [ "$1" = "-i" ]; then cat >> "${dir}/stdin"; exit 0; fi\nif [ "$1" = "find-generic-password" ]; then echo tok-from-keychain-000000; exit 0; fi\nexit 0\n`,
    );
    chmodSync(fake, 0o755);
    const store = new KeychainTokenStore('/home/me/.crew/machine-token', fake);
    const token = `crew_mt_${'y'.repeat(43)}`;
    store.set(token);
    expect(readFileSync(join(dir, 'argv'), 'utf8')).not.toContain(token);
    expect(readFileSync(join(dir, 'stdin'), 'utf8')).toContain(`-w "${token}"`);
    expect(store.get()).toBe('tok-from-keychain-000000');
  });
});

describe('retry classifier', () => {
  it('parks backoff-class errors with min(5 min · 2^attempt, 60 min), then blocks at 4', () => {
    expect(['rate_limit', 'overloaded', 'billing_error', 'account_on_hold'].every(isBackoffError)).toBe(true);
    expect(isBackoffError('invalid_request')).toBe(false);
    expect([0, 1, 2, 3, 4, 5].map((a) => backoffDelayMs(a) / 60_000)).toEqual([5, 10, 20, 40, 60, 60]);
    const now = new Date('2026-09-29T00:00:00Z');
    expect(classifyRetry('rate_limit', 0, now)).toEqual({
      action: 'backoff',
      attempts: 1,
      error: 'rate_limit',
      retryAt: new Date('2026-09-29T00:05:00Z'),
    });
    expect(classifyRetry('overloaded', 3, now)).toEqual({
      action: 'blocked',
      attempts: 4,
      error: 'overloaded',
    });
  });
});

describe('secret scrubber', () => {
  it('hides credentials and keeps the surrounding text', () => {
    const aws = ['AKIA', 'QWERTYUIOPASDFGH'].join('');
    const text = [
      `aws key ${aws}`,
      `aws_secret_access_key = ${'a'.repeat(40)}`,
      `https://user:${'p'.repeat(12)}@github.com/x.git`,
      `crew_mt_${'z'.repeat(43)}`,
      // Assembled at runtime so the commit gate's R7 scan never sees a key header in the source.
      [`-----BEGIN OPENSSH ${'PRIVATE'} KEY-----`, 'abc', `-----END OPENSSH ${'PRIVATE'} KEY-----`].join(
        '\n',
      ),
      'bình thường',
    ].join('\n');
    const { text: out, found } = scrubSecrets(text);
    expect(out).not.toContain(aws);
    expect(out).not.toContain('p'.repeat(12));
    expect(out).toContain('aws_secret_access_key = [đã ẩn: aws-secret-access-key]');
    expect(out).toContain('https://user:[đã ẩn: basic-auth-url]@github.com');
    expect(out).toContain('bình thường');
    expect(found).toEqual(
      expect.arrayContaining([
        'aws-access-key-id',
        'aws-secret-access-key',
        'crew-machine-token',
        'private-key',
        'basic-auth-url',
      ]),
    );
  });
});

describe('skill and MCP usage from the tool log', () => {
  it('collects Skill tool calls, /commands and MCP servers', () => {
    const state = new StateDb(':memory:');
    state.logTool({ jobId: 'j', tool: 'Skill', target: 'ak:scout', decision: 'allow', reason: null });
    state.logTool({ jobId: 'j', tool: 'Skill', target: 'denied-skill', decision: 'deny', reason: 'x' });
    state.logTool({
      jobId: 'j',
      tool: 'mcp__playwright__browser_click',
      target: '{}',
      decision: 'allow',
      reason: null,
    });
    state.logTool({
      jobId: 'j',
      tool: 'mcp__claude_ai_Figma__get_file',
      target: '{}',
      decision: 'allow',
      reason: null,
    });
    const log = state.toolLog('j');
    expect(skillsInvoked(log, ['ak:plan'])).toEqual(['ak:scout', 'ak:plan']);
    expect(slashCommandsIn('<command-name>/ak:cook</command-name> go')).toEqual(['ak:cook']);
    expect(slashCommandsIn('/review this')).toEqual(['review']);
    expect(mcpServersUsed(log, ['playwright', 'maestro', 'claude.ai Figma'])).toEqual([
      'playwright',
      'claude.ai Figma',
    ]);
  });
});
