import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLauncher, renderLauncher } from '../src/launcher.js';

function launcherIn(dir: string, nodePath: string, cliPath: string): string {
  const file = join(dir, 'crew-mac');
  writeFileSync(file, renderLauncher(nodePath, cliPath), { mode: 0o755 });
  return file;
}

describe('launcher ~/.crew/bin/crew-mac', () => {
  it('kiểm node và cli.js trước khi exec', () => {
    expect(renderLauncher('/opt/node', "/a b/it's.js")).toBe(
      [
        '#!/bin/sh',
        '# Quản lý bởi crew-mac setup: đường dẫn ổn định để gọi crew-mac qua SSH.',
        "[ -x '/opt/node' ] && [ -f '/a b/it'\\''s.js' ] || exit 127",
        "exec '/opt/node' '/a b/it'\\''s.js' \"$@\"",
        '',
      ].join('\n'),
    );
  });

  it('thiếu cli.js thì thoát 127 (không để node thoát 1)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crew-launcher-'));
    const file = launcherIn(dir, process.execPath, join(dir, 'khong-co.js'));
    expect(spawnSync('/bin/sh', [file, 'stop-run']).status).toBe(127);
  });

  it('thiếu node thì thoát 127', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crew-launcher-'));
    writeFileSync(join(dir, 'cli.js'), '');
    const file = launcherIn(dir, join(dir, 'khong-co-node'), join(dir, 'cli.js'));
    expect(spawnSync('/bin/sh', [file]).status).toBe(127);
  });

  it('đủ node và cli.js thì chạy và chuyển nguyên tham số', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crew-launcher-'));
    writeFileSync(join(dir, 'cli.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)));\n');
    const file = launcherIn(dir, process.execPath, join(dir, 'cli.mjs'));
    const run = spawnSync('/bin/sh', [file, 'a b', 'c'], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('["a b","c"]');
  });

  it('parseLauncher đọc lại đúng node và cli.js', () => {
    expect(parseLauncher(renderLauncher('/opt/node', '/x/cli.js'))).toEqual({
      nodePath: '/opt/node',
      cliPath: '/x/cli.js',
    });
  });
});
