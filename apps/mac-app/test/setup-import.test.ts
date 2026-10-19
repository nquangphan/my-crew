import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectExisting } from '../src/main/setup/import-existing.js';
import { fakeRunner } from './setup-fakes.js';

function fakeHome(files: { manifest?: string; status?: string }) {
  const home = mkdtempSync(join(tmpdir(), 'import-'));
  mkdirSync(join(home, '.crew-mac'), { recursive: true });
  mkdirSync(join(home, '.crew'), { recursive: true });
  if (files.manifest !== undefined) writeFileSync(join(home, '.crew-mac', 'manifest.json'), files.manifest);
  if (files.status !== undefined) writeFileSync(join(home, '.crew', 'status.json'), files.status);
  return home;
}
const manifest = (extra = {}) =>
  JSON.stringify({
    version: 1,
    port: 2222,
    listenAddress: '0.0.0.0',
    worktreeRoot: '/Users/owner/crew-agents',
    paperclipKey: 'ssh-ed25519 AAAA key',
    installedAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  });
const SECRET = 'security find-generic-password -s crew-mac-status';

describe('detectExisting', () => {
  it('có manifest, status.json và secret trong Keychain thì nhận cài đặt có sẵn', async () => {
    const home = fakeHome({
      manifest: manifest(),
      status: JSON.stringify({ url: 'https://crew.example.com', companyId: 'c-1', machineId: 'm' }),
    });
    const runner = fakeRunner({ [SECRET]: { stdout: 'attributes...' } });
    expect(await detectExisting({ home, runner })).toEqual({
      kind: 'existing',
      port: 2222,
      worktreeRoot: '/Users/owner/crew-agents',
      statusUrl: 'https://crew.example.com',
      companyId: 'c-1',
      hasWebhookSecret: true,
    });
    // không đọc giá trị secret
    expect(runner.calls.every((call) => !call.includes(' -w'))).toBe(true);
  });

  it('thiếu status.json hoặc secret thì vẫn là existing nhưng báo thiếu', async () => {
    const home = fakeHome({ manifest: manifest() });
    expect(await detectExisting({ home, runner: fakeRunner({}) })).toMatchObject({
      kind: 'existing',
      statusUrl: null,
      companyId: null,
      hasWebhookSecret: false,
    });
  });

  it('không có manifest thì fresh', async () => {
    expect(await detectExisting({ home: fakeHome({}), runner: fakeRunner({}) })).toEqual({ kind: 'fresh' });
  });

  it('manifest hỏng thì broken kèm thông báo', async () => {
    const result = await detectExisting({
      home: fakeHome({ manifest: '{"version": 2}' }),
      runner: fakeRunner({}),
    });
    expect(result.kind).toBe('broken');
    if (result.kind === 'broken') expect(result.message).toContain('hỏng');
    const garbage = await detectExisting({ home: fakeHome({ manifest: 'xyz' }), runner: fakeRunner({}) });
    expect(garbage.kind).toBe('broken');
  });
});
