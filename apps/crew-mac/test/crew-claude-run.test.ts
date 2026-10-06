import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { WRAPPER_SOURCE } from '../src/wrapper.js';

const RUN_A = '11111111-2222-4333-8444-555555555555';
const roots: string[] = [];
const groups: number[] = [];

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'crew-wrapper-'));
  roots.push(root);
  return root;
}

function envWithout(name: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env[name];
  return env;
}

afterEach(() => {
  for (const pgid of groups.splice(0)) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {}
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('crew-claude-run', () => {
  it('file nguồn có quyền chạy', () => {
    expect(statSync(WRAPPER_SOURCE).mode & 0o755).toBe(0o755);
  });

  it('không có PAPERCLIP_RUN_ID thì chỉ exec và chuyển nguyên tham số', () => {
    const root = newRoot();
    const out = execFileSync('/bin/sh', [WRAPPER_SOURCE, '--print', 'a b'], {
      cwd: root,
      env: envWithout('PAPERCLIP_RUN_ID', { CREW_CLAUDE_BIN: '/bin/echo' }),
      encoding: 'utf8',
    });
    expect(out).toBe('--print a b\n');
    expect(existsSync(join(root, '.paperclip-runtime'))).toBe(false);
  });

  it('run id sai dạng thì không ghi gì', () => {
    const root = newRoot();
    execFileSync('/bin/sh', [WRAPPER_SOURCE, '-c', 'true'], {
      cwd: root,
      env: { ...process.env, PAPERCLIP_RUN_ID: '../../etc', CREW_CLAUDE_BIN: '/bin/sh' },
    });
    expect(existsSync(join(root, '.paperclip-runtime'))).toBe(false);
  });

  it.skipIf(process.platform !== 'darwin')('ghi PGID và thời điểm bắt đầu trước khi exec agent', async () => {
    const root = newRoot();
    const child = spawn('/bin/sh', [WRAPPER_SOURCE, '-c', 'exec sleep 301'], {
      cwd: root,
      env: { ...process.env, PAPERCLIP_RUN_ID: RUN_A, CREW_CLAUDE_BIN: '/bin/sh' },
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    groups.push(child.pid as number);
    await sleep(400);
    const dir = join(root, '.paperclip-runtime', 'runs', RUN_A);
    expect(readFileSync(join(dir, 'pgid'), 'utf8').trim()).toBe(String(child.pid));
    const started = Number(readFileSync(join(dir, 'started'), 'utf8').trim());
    expect(Math.abs(started - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });
});
