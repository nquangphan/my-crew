import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WRAPPER_SOURCE } from '../src/wrapper.js';
import { claudeRunSucceeded, parseClaudeStreamJson } from './fixtures/claude-local-parse.js';
import { gitIn } from './helpers/fake-mac.js';

const STUB = fileURLToPath(new URL('../assets/crew-e2e-stub.sh', import.meta.url));
const RESULT_LINE = readFileSync(
  fileURLToPath(new URL('./fixtures/stream-json-result.txt', import.meta.url)),
  'utf8',
);
const RUN_ID = '11111111-2222-4333-8444-555555555555';

/** HOME giả (không realpath: trên macOS tmpdir là symlink /var → /private/var, wrapper phải tự quy về đường thật). */
function fakeHome(): { home: string; bin: string } {
  const home = mkdtempSync(join(tmpdir(), 'crew-stub-home-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'crew-mac'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho REAL-CLAUDE\n', { mode: 0o755 });
  return { home, bin };
}

function checkout(home: string, project: string, role: string): string {
  const dir = join(home, 'crew-agents', project, role);
  mkdirSync(dir, { recursive: true });
  gitIn(dir, 'init', '-q', '-b', 'main');
  return dir;
}

function marker(dir: string, content: string): void {
  const gitDir = execFileSync('git', ['-C', dir, 'rev-parse', '--absolute-git-dir'], {
    encoding: 'utf8',
  }).trim();
  writeFileSync(join(gitDir, 'crew-e2e-stub'), content);
}

function runWrapper(
  cwd: string,
  env: { home: string; bin: string },
  extra: Record<string, string> = {},
): { code: number | null; stdout: string } {
  const result = spawnSync('/bin/sh', [WRAPPER_SOURCE, '--print', '-', '--plugin-dir', '/pin'], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: env.home,
      PAPERCLIP_RUN_ID: RUN_ID,
      CREW_MAC_BIN: join(env.bin, 'crew-mac'),
      CREW_CLAUDE_BIN: join(env.bin, 'claude'),
      CREW_E2E_STUB_BIN: STUB,
      ...extra,
    },
  });
  return { code: result.status, stdout: result.stdout };
}

describe('chế độ stub cho nghiệm thu', () => {
  it('file stub có quyền chạy', () => {
    expect(statSync(STUB).mode & 0o755).toBe(0o755);
  });

  it('checkout e2e-* có tệp đánh dấu: in đúng dòng kết quả, không gọi claude, thoát 0', () => {
    const env = fakeHome();
    const dir = checkout(env.home, 'e2e-demo', 'executor');
    marker(dir, '0\n');
    const { code, stdout } = runWrapper(dir, env);
    expect(code).toBe(0);
    expect(stdout).toBe(RESULT_LINE);
    expect(stdout).not.toContain('REAL-CLAUDE');
  });

  it('dòng của stub được adapter claude_local đọc là run thành công', () => {
    const parsed = parseClaudeStreamJson(RESULT_LINE);
    expect(parsed.resultJson).not.toBeNull();
    expect(parsed.sessionId).toBe('crew-e2e-stub');
    expect(parsed.summary).toBe('crew-e2e-stub');
    expect(parsed.costUsd).toBe(0);
    expect(claudeRunSucceeded(parsed.resultJson as Record<string, unknown>, 0)).toBe(true);
  });

  it('checkout e2e-* không có tệp đánh dấu thì chạy claude thật', () => {
    const env = fakeHome();
    const dir = checkout(env.home, 'e2e-demo', 'executor');
    expect(runWrapper(dir, env).stdout).toBe('REAL-CLAUDE\n');
  });

  it('checkout không có tiền tố e2e- thì có tệp đánh dấu vẫn chạy claude thật', () => {
    const env = fakeHome();
    const dir = checkout(env.home, 'demo', 'executor');
    marker(dir, '0\n');
    expect(runWrapper(dir, env).stdout).toBe('REAL-CLAUDE\n');
  });

  it('symlink crew-agents/e2e-* trỏ sang checkout thật thì không stub (so theo đường thật)', () => {
    const env = fakeHome();
    const dir = checkout(env.home, 'demo', 'executor');
    marker(dir, '0\n');
    symlinkSync(join(env.home, 'crew-agents', 'demo'), join(env.home, 'crew-agents', 'e2e-link'));
    expect(runWrapper(join(env.home, 'crew-agents', 'e2e-link', 'executor'), env).stdout).toBe(
      'REAL-CLAUDE\n',
    );
  });

  it('không có PAPERCLIP_RUN_ID thì không stub', () => {
    const env = fakeHome();
    const dir = checkout(env.home, 'e2e-demo', 'executor');
    marker(dir, '0\n');
    const result = spawnSync('/bin/sh', [WRAPPER_SOURCE, '--print'], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: env.home,
        CREW_CLAUDE_BIN: join(env.bin, 'claude'),
        CREW_E2E_STUB_BIN: STUB,
      },
    });
    expect(result.stdout).toBe('REAL-CLAUDE\n');
  });

  it('workflow-check từ chối thì không tới stub', () => {
    const env = fakeHome();
    writeFileSync(join(env.bin, 'crew-mac'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const dir = checkout(env.home, 'e2e-demo', 'executor');
    marker(dir, '0\n');
    const { code, stdout } = runWrapper(dir, env);
    expect(code).toBe(78);
    expect(stdout).toBe('');
  });

  it.each([
    ['abc\n', '5'],
    ['9999\n', '900'],
    ['', '5'],
    ['7\n', '7'],
  ])('tệp đánh dấu %j thì ngủ %s giây', (content, seconds) => {
    const env = fakeHome();
    const dir = checkout(env.home, 'e2e-demo', 'executor');
    marker(dir, content);
    const { code, stdout } = runWrapper(dir, env, { CREW_E2E_STUB_SLEEP: 'echo' });
    expect(code).toBe(0);
    expect(stdout).toBe(`${seconds}\n${RESULT_LINE}`);
  });

  it('stub bị TERM khi đang ngủ thì thoát 143', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crew-stub-'));
    writeFileSync(join(dir, 'marker'), '30\n');
    const child = spawn('/bin/sh', [STUB, join(dir, 'marker')], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    await sleep(300);
    child.kill('SIGTERM');
    expect(await exited).toBe(143);
    expect(stdout).toBe('');
  });
});
