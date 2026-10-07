import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setup } from '../src/commands/setup.js';
import { uninstall } from '../src/commands/uninstall.js';
import { SetupError } from '../src/context.js';
import { macPaths, SPIKE_LABEL, SSHD_LABEL } from '../src/paths.js';
import { PATH_BLOCK_BEGIN, PATH_BLOCK_BODY, SPIKE_PATH_COMMENT } from '../src/zshenv.js';
import { fakeMac, LIVE_PS, LIVE_RUN_ID, PAPERCLIP_PUB } from './helpers/fake-mac.js';
import type { FakeRunner } from './helpers/fake-runner.js';

const OWNER_KEY = 'ssh-ed25519 AAAAOwnerKey owner@macbook';

function seedSpike(home: string) {
  const paths = macPaths(home);
  mkdirSync(paths.spikeDir, { recursive: true });
  writeFileSync(join(paths.spikeDir, 'sshd_config'), 'Port 2222\n');
  mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(paths.spikePlist, '<plist/>\n');
  writeFileSync(paths.zshenv, `${SPIKE_PATH_COMMENT}\n${PATH_BLOCK_BODY}\n`);
  mkdirSync(join(home, '.ssh'), { recursive: true });
  writeFileSync(
    paths.authorizedKeys,
    `${OWNER_KEY}\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISpikeKey crew-v3-spike-paperclip\n`,
  );
}

describe('crew-mac uninstall', () => {
  it('còn run Paperclip đang chạy thì từ chối và chưa gỡ gì', async () => {
    const { home, ctx } = fakeMac({ ps: LIVE_PS });
    seedSpike(home);
    await expect(uninstall(ctx)).rejects.toThrow(SetupError);
    await expect(uninstall(ctx)).rejects.toThrow(LIVE_RUN_ID);
    expect(existsSync(macPaths(home).spikePlist)).toBe(true);
  });

  it('--force thì gỡ dù còn run', async () => {
    const { home, ctx } = fakeMac({ ps: LIVE_PS });
    seedSpike(home);
    const report = await uninstall(ctx, { force: true });
    expect(report.removed).toContain(macPaths(home).spikePlist);
  });

  it('claude -p thủ công của owner (không có PAPERCLIP_RUN_ID) không tính là run', async () => {
    const { home, ctx } = fakeMac({
      ps: {
        tree: '  5151     1  5151 ttys001  00:10 claude\n',
        argv: '  5151 claude -p hi\n',
        env: '  5151 claude -p hi HOME=/Users/a\n',
      },
    });
    seedSpike(home);
    await expect(uninstall(ctx)).resolves.toBeDefined();
  });

  it('không đọc được bảng process thì từ chối, trừ --force', async () => {
    const { home, ctx } = fakeMac();
    (ctx.runner as FakeRunner).on('/bin/ps', () => ({ code: 1, stderr: 'ps: lỗi' }));
    seedSpike(home);
    await expect(uninstall(ctx)).rejects.toThrow(/bảng process/);
    await expect(uninstall(ctx, { force: true })).resolves.toBeDefined();
  });

  it('~/.zshenv có khối mở mà thiếu dòng đóng thì dừng và giữ nguyên file', async () => {
    const { home, ctx } = fakeMac();
    const broken = `export A=1\n${PATH_BLOCK_BEGIN}\n${PATH_BLOCK_BODY}\nexport OWNER=giu\n`;
    writeFileSync(join(home, '.zshenv'), broken);
    await expect(uninstall(ctx)).rejects.toThrow(SetupError);
    expect(readFileSync(join(home, '.zshenv'), 'utf8')).toBe(broken);
  });

  it('~/.zshenv là symlink: gỡ khối trong file đích, không xóa symlink kể cả khi file rỗng', async () => {
    const { home, ctx } = fakeMac();
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    const paths = macPaths(home);
    const target = join(home, 'dotfiles-zshenv');
    writeFileSync(target, readFileSync(paths.zshenv, 'utf8'), { mode: 0o600 });
    rmSync(paths.zshenv);
    symlinkSync(target, paths.zshenv);

    await uninstall(ctx);

    expect(lstatSync(paths.zshenv).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('');
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('gỡ phần cài đặt spike rồi setup cài lại được', async () => {
    const { home, ctx, loaded } = fakeMac({ spikeLoaded: true });
    seedSpike(home);
    const paths = macPaths(home);

    const first = await uninstall(ctx);
    expect(first.removed).toContain(`LaunchAgent ${SPIKE_LABEL}`);
    expect(loaded.has(SPIKE_LABEL)).toBe(false);
    expect(existsSync(paths.spikePlist)).toBe(false);
    expect(existsSync(paths.spikeDir)).toBe(false);
    expect(existsSync(paths.zshenv)).toBe(false);
    expect(readFileSync(paths.authorizedKeys, 'utf8')).toBe(`${OWNER_KEY}\n`);

    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    expect(loaded.has(SSHD_LABEL)).toBe(true);
  });

  it('gỡ đúng những gì setup cài, giữ nội dung của owner và thư mục worktree', async () => {
    const { home, ctx, loaded } = fakeMac();
    const paths = macPaths(home);
    writeFileSync(paths.zshenv, 'export EDITOR=vim\n');
    mkdirSync(join(home, '.ssh'), { recursive: true });
    writeFileSync(paths.authorizedKeys, `${OWNER_KEY}\n`);
    mkdirSync(join(home, '.crew'), { recursive: true });
    writeFileSync(join(home, '.crew', 'config.yaml'), 'apiUrl: x\n');
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });

    const report = await uninstall(ctx);

    expect(loaded.size).toBe(0);
    expect(existsSync(paths.sshdPlist)).toBe(false);
    expect(existsSync(paths.reaperPlist)).toBe(false);
    expect(existsSync(paths.root)).toBe(false);
    expect(readFileSync(paths.zshenv, 'utf8')).toBe('export EDITOR=vim\n');
    expect(readFileSync(paths.authorizedKeys, 'utf8')).toBe(`${OWNER_KEY}\n`);
    expect(existsSync(join(home, 'crew-agents'))).toBe(true);
    expect(report.kept).toEqual([join(home, 'crew-agents')]);
    expect(existsSync(paths.wrapper)).toBe(false);
    expect(existsSync(paths.launcher)).toBe(false);
    expect(readFileSync(join(home, '.crew', 'config.yaml'), 'utf8')).toBe('apiUrl: x\n');
  });

  it('chạy lại khi đã gỡ hết thì không lỗi và không gỡ gì', async () => {
    const { ctx } = fakeMac();
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    await uninstall(ctx);
    expect(await uninstall(ctx)).toEqual({ removed: [], kept: [] });
  });
});
