import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setup } from '../src/commands/setup.js';
import { SetupError } from '../src/context.js';
import { macPaths, SSHD_LABEL } from '../src/paths.js';
import { WRAPPER_SOURCE } from '../src/wrapper.js';
import { PATH_BLOCK_BEGIN } from '../src/zshenv.js';
import { fakeMac, PAPERCLIP_PUB } from './helpers/fake-mac.js';

describe('crew-mac setup', () => {
  it('cài sshd phiên Aqua, key, PATH, thư mục worktree và manifest', async () => {
    const { home, ctx, runner, loaded } = fakeMac();
    const paths = macPaths(home);
    writeFileSync(join(home, '.zshenv'), 'export EDITOR=vim\n');
    mkdirSync(join(home, '.ssh'), { recursive: true });
    writeFileSync(paths.authorizedKeys, 'ssh-ed25519 AAAAOwnerKey owner@macbook\n');

    const report = await setup(ctx, { paperclipKey: PAPERCLIP_PUB });

    expect(readFileSync(paths.sshdConfig, 'utf8')).toContain('ListenAddress 100.102.189.67');
    expect(readFileSync(paths.sshdConfig, 'utf8')).toContain('Port 2222');
    expect(readFileSync(paths.sshdPlist, 'utf8')).toContain('<string>Aqua</string>');
    const keys = readFileSync(paths.authorizedKeys, 'utf8');
    expect(keys).toContain('owner@macbook');
    expect(keys).toMatch(/ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey0+ crew-mac-paperclip/);
    expect(keys).toMatch(/^from="100\.64\.0\.0\/10",no-port-forwarding.* crew-mac-doctor$/m);
    expect(statSync(paths.authorizedKeys).mode & 0o777).toBe(0o600);
    expect(readFileSync(paths.zshenv, 'utf8')).toMatch(
      new RegExp(`^export EDITOR=vim\\n${PATH_BLOCK_BEGIN}`),
    );
    expect(readFileSync(paths.knownHosts, 'utf8')).toMatch(/^\[100\.102\.189\.67\]:2222 ssh-ed25519 \S+\n$/);
    expect(readFileSync(paths.wrapper, 'utf8')).toBe(readFileSync(WRAPPER_SOURCE, 'utf8'));
    expect(statSync(paths.wrapper).mode & 0o777).toBe(0o755);
    expect(existsSync(join(home, 'crew-agents'))).toBe(true);
    expect(loaded.has(SSHD_LABEL)).toBe(true);
    expect(report.restarted).toEqual([SSHD_LABEL]);
    expect(report.manifest).toMatchObject({
      port: 2222,
      listenAddress: '100.102.189.67',
      worktreeRoot: join(home, 'crew-agents'),
    });
    expect(runner.commands()).toContain(`launchctl bootstrap gui/501 ${paths.sshdPlist}`);
  });

  it('chạy lại không đổi file nào và không restart', async () => {
    const { ctx, runner } = fakeMac();
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    const before = runner.calls.length;
    const report = await setup(ctx);
    expect(report.changed).toEqual([]);
    expect(report.restarted).toEqual([]);
    const later = runner.commands().slice(before);
    expect(
      later.some((c) => c.includes('bootstrap') || c.includes('bootout') || c.startsWith('ssh-keygen')),
    ).toBe(false);
  });

  it('đổi cổng thì ghi lại config và restart sshd', async () => {
    const { home, ctx, runner } = fakeMac();
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    const before = runner.calls.length;
    const report = await setup(ctx, { port: 2223 });
    expect(readFileSync(macPaths(home).sshdConfig, 'utf8')).toContain('Port 2223');
    expect(report.restarted).toEqual([SSHD_LABEL]);
    expect(runner.commands().slice(before)).toContain(`launchctl bootout gui/501/${SSHD_LABEL}`);
  });

  it.each(['/Volumes/CORSAIR/agents', 'Desktop/agents', 'Downloads/agents'])(
    'từ chối thư mục worktree %s',
    async (root) => {
      const { home, ctx } = fakeMac();
      const abs = root.startsWith('/') ? root : join(home, root);
      await expect(setup(ctx, { paperclipKey: PAPERCLIP_PUB, worktreeRoot: abs })).rejects.toThrow(
        SetupError,
      );
    },
  );

  it('từ chối khi chưa có phiên desktop', async () => {
    const { ctx } = fakeMac({ gui: false });
    await expect(setup(ctx, { paperclipKey: PAPERCLIP_PUB })).rejects.toThrow('phiên desktop');
  });

  it('từ chối khi sshd của spike còn chạy', async () => {
    const { ctx } = fakeMac({ spikeLoaded: true });
    await expect(setup(ctx, { paperclipKey: PAPERCLIP_PUB })).rejects.toThrow('com.2p.crew-spike-sshd');
  });

  it('từ chối khi không có IP Tailscale', async () => {
    const { ctx } = fakeMac({ tailscaleIp: null });
    await expect(setup(ctx, { paperclipKey: PAPERCLIP_PUB })).rejects.toThrow('Tailscale');
  });

  it('lần đầu bắt buộc có key Paperclip', async () => {
    const { ctx } = fakeMac();
    await expect(setup(ctx)).rejects.toThrow('--paperclip-key');
  });

  it('từ chối khi không phải macOS', async () => {
    const { ctx } = fakeMac();
    await expect(setup({ ...ctx, platform: 'linux' }, { paperclipKey: PAPERCLIP_PUB })).rejects.toThrow(
      'macOS',
    );
  });
});
