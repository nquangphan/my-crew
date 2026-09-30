import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  HeartbeatRequest,
  parseRuntimeManifest,
  runtimePathProblem,
  satisfiesRange,
  shellRangeProblem,
} from './index.js';

const sha = 'a'.repeat(64);
const manifest = (files: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 1,
    version: '0.3.1',
    commit: 'abc',
    createdAt: '2026-09-30T05:00:00.000Z',
    shellRange: { app: '>=0.3.0 <0.4.0', electron: '44' },
    bundle: { sha256: sha, size: 10 },
    files,
    ...extra,
  });
const base = { 'host/index.js': { sha256: sha, size: 1 }, 'renderer/index.html': { sha256: sha, size: 1 } };

describe('runtime versions and ranges', () => {
  it('orders versions numerically, a prerelease before its release', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(['0.3.1', '0.3.10', '0.3.2'].sort(compareVersions)).toEqual(['0.3.1', '0.3.2', '0.3.10']);
  });

  it('checks every comparator of a range', () => {
    expect(satisfiesRange('0.3.4', '>=0.3.0 <0.4.0')).toBe(true);
    expect(satisfiesRange('0.4.0', '>=0.3.0 <0.4.0')).toBe(false);
    expect(satisfiesRange('0.2.9', '>=0.3.0')).toBe(false);
    expect(satisfiesRange('0.3.0', '0.3.0')).toBe(true);
    expect(satisfiesRange('not-a-version', '>=0.0.0')).toBe(false);
    expect(satisfiesRange('0.3.0', '^0.3.0')).toBe(false);
  });

  it('names what a shell is missing', () => {
    const range = { app: '>=0.3.0 <0.4.0', electron: '44' };
    expect(shellRangeProblem(range, { appVersion: '0.3.2', electronVersion: '44.4.5' })).toBeNull();
    expect(shellRangeProblem(range, { appVersion: '0.2.0', electronVersion: '44.4.5' })).toMatch(/0\.3\.0/);
    expect(shellRangeProblem(range, { appVersion: '0.3.2', electronVersion: '45.0.0' })).toMatch(
      /Electron 44/,
    );
  });
});

describe('runtime manifest', () => {
  it('accepts a well-formed manifest', () => {
    const parsed = parseRuntimeManifest(manifest(base));
    expect('manifest' in parsed && parsed.manifest.version).toBe('0.3.1');
  });

  it('refuses paths that could leave the runtime folder', () => {
    for (const path of [
      '../evil.js',
      'host/../../x',
      '/etc/passwd',
      'host\\x.js',
      'other/x.js',
      'host/./x',
      'host',
    ]) {
      expect(runtimePathProblem(path)).not.toBeNull();
      const parsed = parseRuntimeManifest(manifest({ ...base, [path]: { sha256: sha, size: 1 } }));
      expect('error' in parsed).toBe(true);
    }
    expect(runtimePathProblem('renderer/assets/index-Ab_1.js')).toBeNull();
  });

  it('refuses a manifest without the host entry or with bad JSON', () => {
    expect(
      'error' in parseRuntimeManifest(manifest({ 'renderer/index.html': { sha256: sha, size: 1 } })),
    ).toBe(true);
    expect('error' in parseRuntimeManifest('{nope')).toBe(true);
    expect('error' in parseRuntimeManifest(manifest(base, { format: 2 }))).toBe(true);
  });

  it('drops an unknown runtime state from a heartbeat instead of failing it', () => {
    const body = HeartbeatRequest.parse({
      resources: { cpus: 1, loadAvg1: 0, freeMemGb: 1, totalMemGb: 2 },
      cliVersion: '1',
      runtime: { state: 'from-the-future' },
    });
    expect(body.runtime).toBeUndefined();
  });
});
