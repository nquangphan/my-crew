import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { setup } from '../src/commands/setup.js';
import { configureStatus, readStatusConfig } from '../src/commands/status.js';
import { SetupError } from '../src/context.js';
import { readManifest } from '../src/manifest.js';
import { macPaths, REAPER_LABEL, SSHD_LABEL, STATUS_LABEL } from '../src/paths.js';
import { runtimePaths } from '../src/runtimes/paths.js';
import { pinDir, superpowersPinDir } from '../src/workflows/pin.js';
import { treeChecksum } from '../src/workflows/tree-checksum.js';
import {
  CODEX_WRAPPER_SOURCE,
  OPENCODE_WRAPPER_SOURCE,
  RUN_MARK_SOURCE,
  WRAPPER_SOURCE,
} from '../src/wrapper.js';
import { PATH_BLOCK_BEGIN, PATH_BLOCK_BODY } from '../src/zshenv.js';
import {
  APP_EXECUTABLE,
  FIXTURE_BMAD_PIN,
  FIXTURE_PIN,
  fakeMac,
  fakeProcs,
  fixtureBmadPin,
  LIVE_PS,
  PAPERCLIP_PUB,
  passThroughGitTar,
  seedBmadMarketplace,
  seedOwnerPlugin,
} from './helpers/fake-mac.js';

describe('crew-mac setup', () => {
  it('lưu đường dẫn Claude tuyệt đối để job chạy với PATH launchd tối thiểu', async () => {
    const { home, ctx } = fakeMac();
    configureStatus(ctx, 'https://paperclip.example', '22222222-2222-4222-8222-222222222222');
    const claudePath = join(home, '.local', 'bin', 'claude');
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    writeFileSync(claudePath, '#!/bin/sh\n', { mode: 0o755 });
    vi.stubEnv('PATH', '/usr/bin:/bin:/usr/sbin:/sbin');
    try {
      await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
      expect(readStatusConfig(ctx)?.claudePath).toBe(realpathSync(claudePath));
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('~/.zshenv có khối mở mà thiếu dòng đóng thì dừng và giữ nguyên file', async () => {
    const { home, ctx } = fakeMac();
    const broken = `export A=1\n${PATH_BLOCK_BEGIN}\n${PATH_BLOCK_BODY}\nexport OWNER=giu\n`;
    writeFileSync(join(home, '.zshenv'), broken);
    await expect(setup(ctx, { paperclipKey: PAPERCLIP_PUB })).rejects.toThrow(SetupError);
    expect(readFileSync(join(home, '.zshenv'), 'utf8')).toBe(broken);
  });

  it('~/.zshenv và authorized_keys là symlink từ dotfiles: giữ symlink, sửa file đích, giữ mode', async () => {
    const { home, ctx } = fakeMac();
    const dotfiles = join(home, 'dotfiles');
    mkdirSync(dotfiles);
    writeFileSync(join(dotfiles, 'zshenv'), 'export A=1\n', { mode: 0o600 });
    symlinkSync(join(dotfiles, 'zshenv'), join(home, '.zshenv'));
    mkdirSync(join(home, '.ssh'));
    writeFileSync(join(dotfiles, 'authorized_keys'), 'ssh-ed25519 AAAAOwnerKey owner@macbook\n', {
      mode: 0o600,
    });
    symlinkSync(join(dotfiles, 'authorized_keys'), join(home, '.ssh', 'authorized_keys'));

    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });

    expect(lstatSync(join(home, '.zshenv')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dotfiles, 'zshenv'), 'utf8')).toContain(PATH_BLOCK_BEGIN);
    expect(statSync(join(dotfiles, 'zshenv')).mode & 0o777).toBe(0o600);
    expect(lstatSync(join(home, '.ssh', 'authorized_keys')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dotfiles, 'authorized_keys'), 'utf8')).toContain('crew-mac-paperclip');
  });

  it('thư mục worktree là symlink trỏ vào ~/Desktop thì từ chối', async () => {
    const { home, ctx } = fakeMac();
    mkdirSync(join(home, 'Desktop', 'agents'), { recursive: true });
    symlinkSync(join(home, 'Desktop', 'agents'), join(home, 'agents-link'));
    await expect(
      setup(ctx, { paperclipKey: PAPERCLIP_PUB, worktreeRoot: join(home, 'agents-link') }),
    ).rejects.toThrow('Desktop');
  });

  it('cài sshd phiên Aqua, key, PATH, thư mục worktree và manifest', async () => {
    const { home, ctx, runner, loaded } = fakeMac();
    const paths = macPaths(home);
    writeFileSync(join(home, '.zshenv'), 'export EDITOR=vim\n');
    mkdirSync(join(home, '.ssh'), { recursive: true });
    writeFileSync(paths.authorizedKeys, 'ssh-ed25519 AAAAOwnerKey owner@macbook\n', { mode: 0o600 });

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
    // node của launcher/reaper (/opt/homebrew/bin/node) phải có trong PATH của sshd agent.
    expect(readFileSync(paths.zshenv, 'utf8')).toContain(
      'export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"',
    );
    expect(readFileSync(paths.knownHosts, 'utf8')).toMatch(/^\[100\.102\.189\.67\]:2222 ssh-ed25519 \S+\n$/);
    expect(readFileSync(paths.wrapper, 'utf8')).toBe(readFileSync(WRAPPER_SOURCE, 'utf8'));
    expect(statSync(paths.wrapper).mode & 0o777).toBe(0o755);
    expect(readFileSync(paths.launcher, 'utf8')).toBe(
      "#!/bin/sh\n# Quản lý bởi crew-mac setup: đường dẫn ổn định để gọi crew-mac qua SSH.\n[ -x '/opt/homebrew/bin/node' ] && [ -f '/opt/crew/apps/crew-mac/dist/cli.js' ] || exit 127\nexec '/opt/homebrew/bin/node' '/opt/crew/apps/crew-mac/dist/cli.js' \"$@\"\n",
    );
    expect(statSync(paths.launcher).mode & 0o777).toBe(0o755);
    expect(existsSync(join(home, 'crew-agents'))).toBe(true);
    expect(loaded.has(SSHD_LABEL)).toBe(true);
    expect(report.restarted).toEqual([SSHD_LABEL, REAPER_LABEL, STATUS_LABEL]);
    expect(loaded.has(STATUS_LABEL)).toBe(true);
    const statusPlist = readFileSync(paths.statusPlist, 'utf8');
    expect(statusPlist).toContain('<string>status</string>');
    expect(statusPlist).toContain('<string>send</string>');
    expect(statusPlist).toContain('<key>StartInterval</key><integer>60</integer>');
    expect(loaded.has(REAPER_LABEL)).toBe(true);
    const reaperPlist = readFileSync(paths.reaperPlist, 'utf8');
    expect(reaperPlist).toContain('<string>/opt/homebrew/bin/node</string>');
    expect(reaperPlist).toContain('<string>/opt/crew/apps/crew-mac/dist/cli.js</string>');
    expect(reaperPlist).toContain('<string>reap</string>');
    expect(reaperPlist).toContain('<key>StartInterval</key><integer>60</integer>');
    expect(report.manifest).toMatchObject({
      port: 2222,
      listenAddress: '100.102.189.67',
      worktreeRoot: join(home, 'crew-agents'),
    });
    expect(runner.commands()).toContain(`launchctl bootstrap gui/501 ${paths.sshdPlist}`);
  });

  it('cài wrapper Codex/OpenCode, file hàm chung và superpowers-dir cho runtime', async () => {
    const { home, ctx, runner } = fakeMac();
    const report = await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    const rt = runtimePaths(home);
    expect(readFileSync(rt.codexWrapper, 'utf8')).toBe(readFileSync(CODEX_WRAPPER_SOURCE, 'utf8'));
    expect(readFileSync(rt.opencodeWrapper, 'utf8')).toBe(readFileSync(OPENCODE_WRAPPER_SOURCE, 'utf8'));
    expect(readFileSync(rt.runMark, 'utf8')).toBe(readFileSync(RUN_MARK_SOURCE, 'utf8'));
    expect(statSync(rt.codexWrapper).mode & 0o777).toBe(0o755);
    expect(statSync(rt.opencodeWrapper).mode & 0o777).toBe(0o755);
    expect(statSync(rt.runMark).mode & 0o777).toBe(0o644);
    expect(readFileSync(rt.superpowersDirFile, 'utf8')).toBe(`${superpowersPinDir(home, FIXTURE_PIN)}\n`);
    expect(statSync(rt.superpowersDirFile).mode & 0o777).toBe(0o600);
    expect(statSync(rt.runtimesRoot).mode & 0o777).toBe(0o700);
    expect(report.changed).toEqual(
      expect.arrayContaining([rt.codexWrapper, rt.opencodeWrapper, rt.runMark, rt.superpowersDirFile]),
    );
    // Setup không bao giờ tạo file key hay chạm Keychain.
    expect(runner.calls.some((c) => c.command === '/usr/bin/security')).toBe(false);
  });

  it('key Paperclip chỉ vào được từ dải Tailscale, không forwarding; thay dòng cũ không options', async () => {
    const { home, ctx } = fakeMac();
    const paths = macPaths(home);
    mkdirSync(join(home, '.ssh'), { recursive: true });
    writeFileSync(
      paths.authorizedKeys,
      'ssh-ed25519 AAAAOwnerKey owner@macbook\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000 crew-mac-paperclip\n',
      { mode: 0o600 },
    );
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    const lines = readFileSync(paths.authorizedKeys, 'utf8').trim().split('\n');
    const paperclip = lines.filter((l) => l.includes('PaperclipTestKey'));
    expect(paperclip).toEqual([
      'from="100.64.0.0/10",no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000 crew-mac-paperclip',
    ]);
    expect(lines).toContain('ssh-ed25519 AAAAOwnerKey owner@macbook');
  });

  it('chạy lại không đổi file nào và không restart', async () => {
    const { home, ctx, runner } = fakeMac();
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    expect(statSync(macPaths(home).authorizedKeys).mode & 0o777).toBe(0o600);
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

  it('từ chối thư mục worktree là chính HOME', async () => {
    const { home, ctx } = fakeMac();
    await expect(setup(ctx, { paperclipKey: PAPERCLIP_PUB, worktreeRoot: home })).rejects.toThrow('HOME');
  });

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

  it('ghim Superpowers vào ~/.crew/workflows và trả extraArgs cho agent', async () => {
    const { home, ctx } = fakeMac();
    const dir = superpowersPinDir(home, FIXTURE_PIN);
    const report = await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    expect(dir).toBe(join(home, '.crew', 'workflows', 'superpowers', '9.9.9-ffffffffffff'));
    expect(report.superpowers).toEqual({
      dir,
      extraArgs: ['--setting-sources', 'project,local', '--plugin-dir', dir],
    });
    expect(report.changed).toContain(dir);
    expect(treeChecksum(dir).checksum).toBe(FIXTURE_PIN.checksum);
    expect((await setup(ctx)).changed).toEqual([]);
  });

  it('cài cả bản ghim BMAD (từ marketplace) và trả extraArgs cho vai bmad', async () => {
    const { home, ctx, runner } = fakeMac({ bmadInstalled: false });
    passThroughGitTar(runner);
    ctx.bmadPin = fixtureBmadPin(seedBmadMarketplace(home).revision);
    const dir = pinDir(home, ctx.bmadPin);
    const report = await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    expect(report.bmad).toEqual({
      dir,
      extraArgs: ['--setting-sources', 'project,local', '--plugin-dir', dir],
    });
    expect(report.changed).toContain(dir);
    expect(treeChecksum(dir).checksum).toBe(ctx.bmadPin.checksum);
    expect((await setup(ctx)).changed).toEqual([]);
  });

  it('bản ghim BMAD có sẵn thì setup không gọi git', async () => {
    const { home, ctx, runner } = fakeMac();
    const report = await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    expect(report.bmad.dir).toBe(pinDir(home, FIXTURE_BMAD_PIN));
    expect(report.changed).not.toContain(report.bmad.dir);
    expect(runner.calls.some((c) => c.command === '/usr/bin/git')).toBe(false);
  });

  it('BMAD không lấy được thì SetupError sau khi Superpowers đã ghim, chưa ghi file khác', async () => {
    const { home, ctx } = fakeMac({ bmadInstalled: false });
    const err = await setup(ctx, { paperclipKey: PAPERCLIP_PUB }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect((err as Error).message).toContain('không lấy được BMAD 9.9.9-next');
    expect(treeChecksum(superpowersPinDir(home, FIXTURE_PIN)).checksum).toBe(FIXTURE_PIN.checksum);
    expect(existsSync(macPaths(home).manifest)).toBe(false);
    expect(existsSync(macPaths(home).sshdConfig)).toBe(false);
  });

  it('owner chưa cài Superpowers đúng bản thì setup báo SetupError, không ghi gì', async () => {
    const { home, ctx } = fakeMac({ ownerSuperpowers: false });
    seedOwnerPlugin(home, '9.9.8', 'e'.repeat(40));
    const err = await setup(ctx, { paperclipKey: PAPERCLIP_PUB }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect((err as Error).message).toContain('9.9.9');
    expect(existsSync(macPaths(home).manifest)).toBe(false);
    expect(existsSync(macPaths(home).sshdConfig)).toBe(false);
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

describe('crew-mac setup: chủ sshd agent', () => {
  const sshdCommands = (cmds: string[]) =>
    cmds.filter((c) => c.startsWith('launchctl') && c.includes(SSHD_LABEL));

  it('chuyển sang app: bootout sshd của launchd, xóa plist, ghi manifest, không đổi config và host key', async () => {
    const { home, ctx, runner, loaded } = fakeMac();
    const paths = macPaths(home);
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    const config = readFileSync(paths.sshdConfig, 'utf8');
    const hostKey = readFileSync(paths.hostKey, 'utf8');
    const before = runner.calls.length;

    const report = await setup(ctx, { sshdOwner: 'app' });

    const later = runner.commands().slice(before);
    expect(later.filter((c) => c.startsWith('launchctl bootout'))).toEqual([
      `launchctl bootout gui/501/${SSHD_LABEL}`,
    ]);
    expect(later.some((c) => c.startsWith('launchctl bootstrap') && c.includes(SSHD_LABEL))).toBe(false);
    expect(loaded.has(SSHD_LABEL)).toBe(false);
    expect(existsSync(paths.sshdPlist)).toBe(false);
    expect(readManifest(paths.manifest)?.sshdOwner).toBe('app');
    expect(report.manifest.sshdOwner).toBe('app');
    expect(report.sshdHandoff).toBe('app');
    expect(readFileSync(paths.sshdConfig, 'utf8')).toBe(config);
    expect(readFileSync(paths.hostKey, 'utf8')).toBe(hostKey);
  });

  it('chạy lại ở chế độ app (có cờ hoặc không) thì không bootout, không đổi gì', async () => {
    const { ctx, runner } = fakeMac();
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    await setup(ctx, { sshdOwner: 'app' });
    for (const options of [{ sshdOwner: 'app' as const }, {}]) {
      const before = runner.calls.length;
      const report = await setup(ctx, options);
      expect(
        sshdCommands(runner.commands().slice(before)).filter((c) => !c.startsWith('launchctl print')),
      ).toEqual([]);
      expect(report.sshdHandoff).toBe('unchanged');
      expect(report.changed).toEqual([]);
      expect(report.manifest.sshdOwner).toBe('app');
    }
  });

  it('đổi chủ khi còn run đang chạy thì từ chối và chưa bootout; force thì chạy', async () => {
    const { ctx, runner, loaded } = fakeMac({ ps: LIVE_PS });
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    const before = runner.calls.length;
    const err = await setup(ctx, { sshdOwner: 'app' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect((err as Error).message).toMatch(/run Paperclip đang chạy/);
    expect(
      runner
        .commands()
        .slice(before)
        .some((c) => c.startsWith('launchctl bootout')),
    ).toBe(false);
    expect(loaded.has(SSHD_LABEL)).toBe(true);
    expect((await setup(ctx, { sshdOwner: 'app', force: true })).sshdHandoff).toBe('app');
  });

  it('cài mới không cờ vẫn như cũ: plist, bootstrap, manifest không có sshdOwner', async () => {
    const { home, ctx, runner } = fakeMac();
    const report = await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    expect(runner.commands()).toContain(`launchctl bootstrap gui/501 ${macPaths(home).sshdPlist}`);
    expect(report.sshdHandoff).toBe('unchanged');
    expect(JSON.parse(readFileSync(macPaths(home).manifest, 'utf8'))).not.toHaveProperty('sshdOwner');
  });

  async function appMode() {
    const mac = fakeMac();
    const paths = macPaths(mac.home);
    await setup(mac.ctx, { paperclipKey: PAPERCLIP_PUB });
    await setup(mac.ctx, { sshdOwner: 'app' });
    return { ...mac, paths, listener: `/usr/sbin/sshd -D -f ${paths.sshdConfig} -E ${paths.sshdLog}` };
  }
  const pidChecks = (runner: ReturnType<typeof fakeMac>['runner']) =>
    runner.calls.filter((c) => c.command === '/bin/ps' && c.args.includes('-p')).length;

  it('về launchd: kiểm pid trước, ghi manifest, chờ listener của app thoát, không kill, rồi bootstrap', async () => {
    const t = await appMode();
    writeFileSync(t.paths.sshdPid, '4242\n');
    // Chủ trong manifest lúc mỗi lượt `ps -p` (bỏ các lượt quét cả bảng process của kiểm run).
    const owners = new Map<number, string | undefined>();
    fakeProcs(t.runner, () => {
      const checks = pidChecks(t.runner);
      if (checks > 0 && !owners.has(checks)) owners.set(checks, readManifest(t.paths.manifest)?.sshdOwner);
      // Lượt 1–2: dò listener (pid và file thực thi của cha); lượt 3: vòng chờ còn thấy; sau đó listener đã thoát.
      return checks >= 1 && checks <= 3
        ? { 4242: { ppid: 4100, command: t.listener }, 4100: { ppid: 1, command: APP_EXECUTABLE } }
        : { 4100: { ppid: 1, command: APP_EXECUTABLE } };
    });
    const before = t.runner.calls.length;

    const report = await setup(t.ctx, { sshdOwner: 'launchd' });

    // Dò khi manifest còn là app; vòng chờ chạy sau khi manifest đã là launchd (app thấy và tự dừng listener).
    const seen = [...owners.entries()].sort(([a], [b]) => a - b).map(([, owner]) => owner);
    expect(seen.slice(0, 2)).toEqual(['app', 'app']);
    expect(seen.slice(2).every((o) => o === undefined)).toBe(true);
    expect(pidChecks(t.runner)).toBeGreaterThanOrEqual(4);
    const later = t.runner.commands().slice(before);
    expect(later.some((c) => c.startsWith('/bin/kill'))).toBe(false);
    expect(later).toContain(`launchctl bootstrap gui/501 ${t.paths.sshdPlist}`);
    expect(t.loaded.has(SSHD_LABEL)).toBe(true);
    expect(report.sshdHandoff).toBe('launchd');
    expect(report.manifest.sshdOwner).toBeUndefined();
    expect(readManifest(t.paths.manifest)?.sshdOwner).toBeUndefined();
  });

  /** `lsof -t` của cổng sshd: danh sách pid đang LISTEN, rỗng (rc 1) khi cổng trống. */
  const fakeLsof = (runner: ReturnType<typeof fakeMac>['runner'], pids: number[]) =>
    runner.on('/usr/sbin/lsof', () =>
      pids.length === 0 ? { code: 1 } : { stdout: pids.map((p) => `${p}\n`).join('') },
    );

  it('về launchd: pidfile trỏ process lạ và cổng bị process lạ giữ thì báo lỗi TRƯỚC khi ghi manifest', async () => {
    const t = await appMode();
    writeFileSync(t.paths.sshdPid, '4242\n');
    fakeProcs(t.runner, () => ({ 4242: { ppid: 4100, command: 'sshd-session: owner@notty' } }));
    fakeLsof(t.runner, [777]);
    const before = t.runner.calls.length;
    const err = await setup(t.ctx, { sshdOwner: 'launchd' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect((err as Error).message).toContain('pid 4242 không phải listener của crew-mac');
    expect((err as Error).message).toContain('cổng 2222');
    const later = t.runner.commands().slice(before);
    expect(later.some((c) => c.startsWith('/bin/kill'))).toBe(false);
    expect(later.some((c) => c.startsWith('launchctl bootstrap') && c.includes(SSHD_LABEL))).toBe(false);
    // Chủ cũ giữ nguyên: app vẫn giữ listener của nó, không ai mất cổng.
    expect(readManifest(t.paths.manifest)?.sshdOwner).toBe('app');
  });

  it('về launchd: pidfile trỏ process lạ mà cổng trống thì bootstrap luôn, không kill', async () => {
    const t = await appMode();
    writeFileSync(t.paths.sshdPid, '4242\n');
    fakeProcs(t.runner, () => ({ 4242: { ppid: 4100, command: 'sshd-session: owner@notty' } }));
    fakeLsof(t.runner, []);
    const before = t.runner.calls.length;
    const report = await setup(t.ctx, { sshdOwner: 'launchd' });
    const later = t.runner.commands().slice(before);
    expect(later.some((c) => c.startsWith('/bin/kill'))).toBe(false);
    expect(later).toContain(`launchctl bootstrap gui/501 ${t.paths.sshdPlist}`);
    expect(report.sshdHandoff).toBe('launchd');
    expect(readManifest(t.paths.manifest)?.sshdOwner).toBeUndefined();
    expect(t.loaded.has(SSHD_LABEL)).toBe(true);
  });

  it('về launchd: pidfile trỏ process lạ và không đọc được cổng thì dừng, giữ chủ app', async () => {
    const t = await appMode();
    writeFileSync(t.paths.sshdPid, '4242\n');
    fakeProcs(t.runner, () => ({ 4242: { ppid: 4100, command: 'sshd-session: owner@notty' } }));
    t.runner.on('/usr/sbin/lsof', () => ({ code: 1, stderr: 'lsof: lỗi lạ' }));
    await expect(setup(t.ctx, { sshdOwner: 'launchd' })).rejects.toThrow(SetupError);
    expect(readManifest(t.paths.manifest)?.sshdOwner).toBe('app');
  });

  it('về launchd: lần chạy lại sau khi báo lỗi vẫn không ghi launchd khi cổng còn bị giữ', async () => {
    const t = await appMode();
    writeFileSync(t.paths.sshdPid, '4242\n');
    fakeProcs(t.runner, () => ({ 4242: { ppid: 4100, command: 'sshd-session: owner@notty' } }));
    fakeLsof(t.runner, [777]);
    await expect(setup(t.ctx, { sshdOwner: 'launchd' })).rejects.toThrow(SetupError);
    await expect(setup(t.ctx, { sshdOwner: 'launchd' })).rejects.toThrow(SetupError);
    expect(readManifest(t.paths.manifest)?.sshdOwner).toBe('app');
    expect(t.loaded.has(SSHD_LABEL)).toBe(false);
  });

  it('sang app: bootout báo lỗi và job vẫn nạp thì dừng, giữ manifest launchd và plist', async () => {
    const { home, ctx, loaded } = fakeMac({ bootoutFails: [SSHD_LABEL] });
    const paths = macPaths(home);
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    const err = await setup(ctx, { sshdOwner: 'app' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect((err as Error).message).toContain(SSHD_LABEL);
    expect(loaded.has(SSHD_LABEL)).toBe(true);
    expect(existsSync(paths.sshdPlist)).toBe(true);
    expect(readManifest(paths.manifest)?.sshdOwner).toBeUndefined();
  });

  it('sang app: thứ tự ghi manifest app → xóa plist → bootout', async () => {
    const t = fakeMac();
    const paths = macPaths(t.home);
    await setup(t.ctx, { paperclipKey: PAPERCLIP_PUB });
    const seen: { owner: string | undefined; plist: boolean }[] = [];
    const launchctl = t.runner;
    const original = launchctl.run.bind(launchctl);
    launchctl.run = async (command, args, options) => {
      if (command === 'launchctl' && args[0] === 'bootout' && String(args[1]).endsWith(SSHD_LABEL))
        seen.push({ owner: readManifest(paths.manifest)?.sshdOwner, plist: existsSync(paths.sshdPlist) });
      return original(command, args, options);
    };
    await setup(t.ctx, { sshdOwner: 'app' });
    expect(seen).toEqual([{ owner: 'app', plist: false }]);
  });

  /**
   * Tiến trình gọi `setup({ sshdOwner: 'app' })` chết sau từng bước (ghi manifest, xóa plist, bootout). Trạng thái để
   * lại phải được lần chạy sau đưa về đúng một chủ khớp manifest, dù lần sau là wizard chạy lại (`app`), CLI không cờ
   * hay CLI lui về `launchd`.
   */
  describe('chết giữa chừng khi sang app', () => {
    type Step = 'manifest' | 'plist' | 'bootout';
    const STEPS: Step[] = ['manifest', 'plist', 'bootout'];

    async function stoppedAfter(done: Step[]) {
      const t = fakeMac();
      const paths = macPaths(t.home);
      await setup(t.ctx, { paperclipKey: PAPERCLIP_PUB });
      if (done.includes('manifest')) {
        const m = readManifest(paths.manifest);
        writeFileSync(paths.manifest, `${JSON.stringify({ ...m, sshdOwner: 'app' }, null, 2)}\n`);
      }
      if (done.includes('plist')) rmSync(paths.sshdPlist);
      if (done.includes('bootout')) t.loaded.delete(SSHD_LABEL);
      return { ...t, paths };
    }

    function expectOneOwner(t: Awaited<ReturnType<typeof stoppedAfter>>, owner: 'app' | 'launchd') {
      const manifestOwner = readManifest(t.paths.manifest)?.sshdOwner ?? 'launchd';
      expect(manifestOwner).toBe(owner);
      expect(t.loaded.has(SSHD_LABEL)).toBe(owner === 'launchd');
      expect(existsSync(t.paths.sshdPlist)).toBe(owner === 'launchd');
    }

    for (let k = 0; k <= STEPS.length; k += 1) {
      const done = STEPS.slice(0, k);
      const label = k === 0 ? 'chưa bước nào' : `sau ${done.join(' → ')}`;

      it(`${label}: còn ít nhất một chủ thật cho cổng, hoặc manifest đã là app (app tự sinh listener)`, async () => {
        const t = await stoppedAfter(done);
        const manifestOwner = readManifest(t.paths.manifest)?.sshdOwner ?? 'launchd';
        // Không bao giờ: manifest nói launchd mà LaunchAgent không còn (cổng trống, app mở lại thì `disabled`).
        if (manifestOwner === 'launchd') expect(t.loaded.has(SSHD_LABEL)).toBe(true);
      });

      it(`${label}: wizard chạy lại sang app thì về đúng một chủ app`, async () => {
        const t = await stoppedAfter(done);
        await setup(t.ctx, { sshdOwner: 'app' });
        expectOneOwner(t, 'app');
      });

      it(`${label}: CLI không cờ thì về đúng một chủ theo manifest`, async () => {
        const t = await stoppedAfter(done);
        const owner = readManifest(t.paths.manifest)?.sshdOwner ?? 'launchd';
        await setup(t.ctx, {});
        expectOneOwner(t, owner);
      });

      it(`${label}: CLI lui về launchd thì về đúng một chủ launchd`, async () => {
        const t = await stoppedAfter(done);
        await setup(t.ctx, { sshdOwner: 'launchd' });
        expectOneOwner(t, 'launchd');
      });
    }
  });

  it('về launchd: không có pidfile thì bootstrap ngay', async () => {
    const t = await appMode();
    const before = t.runner.calls.length;
    const report = await setup(t.ctx, { sshdOwner: 'launchd' });
    expect(t.runner.commands().slice(before)).toContain(`launchctl bootstrap gui/501 ${t.paths.sshdPlist}`);
    expect(report.sshdHandoff).toBe('launchd');
    expect(existsSync(t.paths.sshdPlist)).toBe(true);
  });
});
