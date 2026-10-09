import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fsHooks = vi.hoisted(() => ({ failRenameAt: 0, renameCalls: 0 }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      fsHooks.renameCalls += 1;
      if (fsHooks.renameCalls === fsHooks.failRenameAt) throw new Error('rename giả lập hỏng');
      return actual.renameSync(from, to);
    },
  };
});

import { SetupError } from '../src/context.js';
import { installCrewMacFrom } from '../src/install-cli.js';
import { parseLauncher } from '../src/launcher.js';
import { macPaths } from '../src/paths.js';
import { fakeMac, LIVE_PS } from './helpers/fake-mac.js';

function bundle(version: string, cli = `console.log('${version}');\n`): string {
  const dir = mkdtempSync(join(tmpdir(), 'crew-mac-src-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@crew/mac', version }));
  writeFileSync(join(dir, 'dist', 'cli.js'), cli);
  writeFileSync(join(dir, 'assets', 'crew-claude-run.sh'), '#!/bin/sh\n', { mode: 0o755 });
  return dir;
}

const installedDir = (home: string) => join(home, '.crew', 'app', 'crew-mac');
const version = (dir: string) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;

function seedInstalled(home: string, ver: string) {
  const dir = installedDir(home);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: ver }));
  writeFileSync(join(dir, 'dist', 'cli.js'), `console.log('${ver}');\n`);
}

afterEach(() => {
  fsHooks.failRenameAt = 0;
  fsHooks.renameCalls = 0;
});

describe('installCrewMacFrom', () => {
  it('thay bản cũ, giữ đúng một bản lui và viết lại launcher', async () => {
    const { ctx, home } = fakeMac();
    seedInstalled(home, '0.0.1');
    const result = await installCrewMacFrom(ctx, bundle('0.0.2'));
    const dir = installedDir(home);
    expect(result).toEqual({ installed: true, version: '0.0.2', backup: `${dir}.prev` });
    expect(version(dir)).toBe('0.0.2');
    expect(version(`${dir}.prev`)).toBe('0.0.1');
    expect(existsSync(`${dir}.new`)).toBe(false);
    expect(statSync(join(dir, 'assets', 'crew-claude-run.sh')).mode & 0o111).not.toBe(0);
    const launcher = readFileSync(macPaths(home).launcher, 'utf8');
    expect(parseLauncher(launcher)).toEqual({ nodePath: ctx.nodePath, cliPath: join(dir, 'dist', 'cli.js') });
    expect(statSync(macPaths(home).launcher).mode & 0o777).toBe(0o755);
  });

  it('cài lần đầu thì không có bản lui', async () => {
    const { ctx, home } = fakeMac();
    const result = await installCrewMacFrom(ctx, bundle('0.1.0'));
    expect(result).toEqual({ installed: true, version: '0.1.0', backup: null });
    expect(version(installedDir(home))).toBe('0.1.0');
    expect(existsSync(`${installedDir(home)}.prev`)).toBe(false);
  });

  it('gọi lại với cùng nội dung thì không đổi gì', async () => {
    const { ctx, home } = fakeMac();
    const src = bundle('0.0.2');
    await installCrewMacFrom(ctx, src);
    const before = statSync(installedDir(home)).mtimeMs;
    const again = await installCrewMacFrom(ctx, src);
    expect(again).toEqual({ installed: false, version: '0.0.2', backup: null });
    expect(statSync(installedDir(home)).mtimeMs).toBe(before);
    expect(existsSync(`${installedDir(home)}.prev`)).toBe(false);
  });

  it('cùng version nhưng nội dung khác thì vẫn cài', async () => {
    const { ctx, home } = fakeMac();
    await installCrewMacFrom(ctx, bundle('0.0.2', "console.log('a');\n"));
    const result = await installCrewMacFrom(ctx, bundle('0.0.2', "console.log('b');\n"));
    expect(result.installed).toBe(true);
    expect(readFileSync(join(installedDir(home), 'dist', 'cli.js'), 'utf8')).toBe("console.log('b');\n");
  });

  it('còn run đang chạy thì từ chối và không đổi gì', async () => {
    const { ctx, home } = fakeMac({ ps: LIVE_PS });
    seedInstalled(home, '0.0.1');
    const result = await installCrewMacFrom(ctx, bundle('0.0.2'));
    expect(result.installed).toBe(false);
    expect(result.reason).toContain('run đang chạy');
    expect(version(installedDir(home))).toBe('0.0.1');
    expect(existsSync(`${installedDir(home)}.prev`)).toBe(false);
    expect(existsSync(`${installedDir(home)}.new`)).toBe(false);
    expect(existsSync(macPaths(home).launcher)).toBe(false);
  });

  it('thiếu dist/cli.js thì ném SetupError, bản đang cài nguyên vẹn', async () => {
    const { ctx, home } = fakeMac();
    seedInstalled(home, '0.0.1');
    const src = mkdtempSync(join(tmpdir(), 'crew-mac-src-'));
    writeFileSync(join(src, 'package.json'), JSON.stringify({ version: '0.0.2' }));
    await expect(installCrewMacFrom(ctx, src)).rejects.toBeInstanceOf(SetupError);
    expect(version(installedDir(home))).toBe('0.0.1');
    expect(existsSync(`${installedDir(home)}.new`)).toBe(false);
  });

  it('package.json không có version thì ném SetupError', async () => {
    const { ctx } = fakeMac();
    const src = bundle('0.0.2');
    writeFileSync(join(src, 'package.json'), '{}');
    await expect(installCrewMacFrom(ctx, src)).rejects.toBeInstanceOf(SetupError);
  });

  it('chỉ giữ một bản lui: bản lui cũ bị thay bằng bản vừa bị thay thế', async () => {
    const { ctx, home } = fakeMac();
    await installCrewMacFrom(ctx, bundle('0.0.1'));
    await installCrewMacFrom(ctx, bundle('0.0.2'));
    await installCrewMacFrom(ctx, bundle('0.0.3'));
    const dir = installedDir(home);
    expect(version(dir)).toBe('0.0.3');
    expect(version(`${dir}.prev`)).toBe('0.0.2');
  });

  it('lỗi ở bước đổi tên thứ hai thì khôi phục bản cũ', async () => {
    const { ctx, home } = fakeMac();
    seedInstalled(home, '0.0.1');
    const src = bundle('0.0.2');
    fsHooks.renameCalls = 0;
    fsHooks.failRenameAt = 2;
    await expect(installCrewMacFrom(ctx, src)).rejects.toThrow('rename giả lập hỏng');
    expect(version(installedDir(home))).toBe('0.0.1');
    expect(existsSync(macPaths(home).launcher)).toBe(false);
    expect(dirname(installedDir(home))).toBe(join(home, '.crew', 'app'));
  });
});
