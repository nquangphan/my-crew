import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setup } from '../src/commands/setup.js';
import { uninstall } from '../src/commands/uninstall.js';
import { SetupError } from '../src/context.js';
import { macPaths, SPIKE_LABEL, SSHD_LABEL } from '../src/paths.js';
import { runtimePaths } from '../src/runtimes/paths.js';
import { PATH_BLOCK_BEGIN, PATH_BLOCK_BODY, SPIKE_PATH_COMMENT } from '../src/zshenv.js';
import {
  APP_EXECUTABLE,
  fakeMac,
  fakeProcs,
  LIVE_PS,
  LIVE_RUN_ID,
  PAPERCLIP_PUB,
} from './helpers/fake-mac.js';
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

describe('crew-mac uninstall fail-closed', () => {
  const blocked = (e: ReturnType<typeof fakeMac>) => {
    seedSpike(e.home);
    return expect(uninstall(e.ctx)).rejects;
  };

  it('process claude --print không tty mà env không đọc được thì từ chối, claude thủ công có tty thì cho qua', async () => {
    const argv = '  4300 /Users/a/.local/bin/claude --print --output-format stream-json\n';
    const e = fakeMac({ ps: { tree: '  4300     1  4300 ??       00:05 claude\n', argv, env: argv } });
    await (await blocked(e)).toThrow(/không đọc được env/);
    await expect(uninstall(e.ctx, { force: true })).resolves.toBeDefined();
  });

  it('claude -p nền đọc được env nhưng không có run id thì không chặn', async () => {
    const argv = '  4310 /Users/a/.local/bin/claude -p hi\n';
    const e = fakeMac({
      ps: {
        tree: '  4310     1  4310 ??       00:05 claude\n',
        argv,
        env: `  4310 /Users/a/.local/bin/claude -p hi HOME=/Users/a\n`,
      },
    });
    seedSpike(e.home);
    await expect(uninstall(e.ctx)).resolves.toBeDefined();
  });

  it('node -p "<expr>" (cờ eval của node) không chặn dù không đọc được env', async () => {
    const cmd = '/opt/homebrew/bin/node -p process.version';
    const e = fakeMac({
      ps: {
        tree: '  4311     1  4311 ??       00:05 node\n',
        argv: `  4311 ${cmd}\n`,
        env: `  4311 ${cmd}\n`,
      },
    });
    seedSpike(e.home);
    await expect(uninstall(e.ctx)).resolves.toBeDefined();
  });

  it('claude cài bằng npm chạy dưới tên node vẫn được nhận là run', async () => {
    const cmd =
      '/opt/homebrew/bin/node /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js --print';
    const e = fakeMac({
      ps: {
        tree: '  4400     1  4400 ??       00:05 node\n',
        argv: `  4400 ${cmd}\n`,
        env: `  4400 ${cmd} PAPERCLIP_RUN_ID=${LIVE_RUN_ID} HOME=/Users/a\n`,
      },
    });
    await (await blocked(e)).toThrow(LIVE_RUN_ID);
  });

  it('node --print không tty không đọc được env cũng bị từ chối', async () => {
    const cmd = '/opt/homebrew/bin/node /x/claude-code/cli.js -p hi';
    const e = fakeMac({
      ps: {
        tree: '  4401     1  4401 ??       00:05 node\n',
        argv: `  4401 ${cmd}\n`,
        env: `  4401 ${cmd}\n`,
      },
    });
    await (await blocked(e)).toThrow(/không đọc được env/);
  });

  it('còn phiên sshd của agent (con cháu của job sshd) thì từ chối', async () => {
    const e = fakeMac({
      spikeLoaded: true,
      ps: {
        tree: '  4242     1  4242 ??  10:00 sshd\n  4500  4242  4500 ??  00:30 sshd-session: owner@notty\n',
        argv: '  4242 /usr/sbin/sshd -D\n  4500 sshd-session: owner@notty\n',
        env: '  4242 /usr/sbin/sshd -D\n  4500 sshd-session: owner@notty\n',
      },
    });
    await (await blocked(e)).toThrow(/phiên SSH qua sshd agent \(pid 4500\)/);
    await expect(uninstall(e.ctx, { force: true })).resolves.toBeDefined();
  });

  it('sshd agent đang chạy mà không có phiên con thì cho qua', async () => {
    const e = fakeMac({
      spikeLoaded: true,
      ps: {
        tree: '  4242     1  4242 ??  10:00 sshd\n',
        argv: '  4242 /usr/sbin/sshd -D\n',
        env: '  4242 /usr/sbin/sshd -D\n',
      },
    });
    seedSpike(e.home);
    await expect(uninstall(e.ctx)).resolves.toBeDefined();
  });

  it('thông báo nói rõ --force bỏ qua cả hai kiểm', async () => {
    const e = fakeMac({ ps: LIVE_PS });
    await (await blocked(e)).toThrow(/CẢ kiểm phiên sshd agent LẪN kiểm run Paperclip/);
  });
});

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

  it('gỡ wrapper Codex/OpenCode, crew-run-mark.sh và ~/.crew/runtimes; không đụng ~/.codex', async () => {
    const { home, ctx } = fakeMac();
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    const rt = runtimePaths(home);
    for (const file of [rt.codexWrapper, rt.opencodeWrapper, rt.runMark, rt.superpowersDirFile])
      expect(existsSync(file)).toBe(true);
    const codexDir = join(home, '.codex');
    mkdirSync(join(codexDir, 'sessions'), { recursive: true });
    writeFileSync(join(codexDir, 'auth.json'), '{"x":1}', { mode: 0o600 });
    const agentHome = rt.codexHome('11111111-2222-3333-4444-555555555555');
    mkdirSync(join(agentHome, 'sessions'), { recursive: true });
    symlinkSync(join(codexDir, 'auth.json'), join(agentHome, 'auth.json'));
    symlinkSync(join(codexDir, 'sessions'), join(agentHome, 'linked'));
    mkdirSync(rt.opencodeHome('shared'), { recursive: true });

    const report = await uninstall(ctx);

    for (const path of [rt.codexWrapper, rt.opencodeWrapper, rt.runMark, rt.runtimesRoot]) {
      expect(existsSync(path)).toBe(false);
      expect(report.removed).toContain(path);
    }
    expect(readFileSync(join(codexDir, 'auth.json'), 'utf8')).toBe('{"x":1}');
    expect(existsSync(join(codexDir, 'sessions'))).toBe(true);
  });

  describe('auth.json Codex của agent là file thường', () => {
    const AGENT = '11111111-2222-3333-4444-555555555555';
    const OLD = new Date('2026-01-01T00:00:00Z');
    const NEW = new Date('2026-02-01T00:00:00Z');
    const agentTok = '{"tokens":{"refresh_token":"agent-fake"}}';
    const ownerTok = '{"tokens":{"refresh_token":"owner-fake"}}';

    async function seed(opts: { agent: string; owner: string | null; agentAt: Date; ownerAt: Date }) {
      const e = fakeMac();
      await setup(e.ctx, { paperclipKey: PAPERCLIP_PUB });
      const rt = runtimePaths(e.home);
      const mine = join(rt.codexHome(AGENT), 'auth.json');
      mkdirSync(rt.codexHome(AGENT), { recursive: true });
      writeFileSync(mine, opts.agent, { mode: 0o600 });
      utimesSync(mine, opts.agentAt, opts.agentAt);
      const owner = join(e.home, '.codex', 'auth.json');
      if (opts.owner !== null) {
        mkdirSync(join(e.home, '.codex'), { recursive: true });
        writeFileSync(owner, opts.owner, { mode: 0o644 });
        utimesSync(owner, opts.ownerAt, opts.ownerAt);
      }
      return { ...e, rt, mine, owner };
    }

    it('bản agent mới hơn và hợp lệ thì chép ngược về ~/.codex (0600) rồi xóa runtimes', async () => {
      const t = await seed({ agent: agentTok, owner: ownerTok, agentAt: NEW, ownerAt: OLD });
      await uninstall(t.ctx);
      expect(readFileSync(t.owner, 'utf8')).toBe(agentTok);
      expect(statSync(t.owner).mode & 0o777).toBe(0o600);
      expect(existsSync(t.rt.runtimesRoot)).toBe(false);
    });

    it('giống nội dung hoặc owner mới hơn thì bỏ bản agent, ~/.codex giữ nguyên', async () => {
      for (const [agent, agentAt, ownerAt] of [
        [ownerTok, NEW, OLD],
        [agentTok, OLD, NEW],
      ] as const) {
        const t = await seed({ agent, owner: ownerTok, agentAt, ownerAt });
        await uninstall(t.ctx);
        expect(readFileSync(t.owner, 'utf8')).toBe(ownerTok);
        expect(existsSync(t.rt.runtimesRoot)).toBe(false);
      }
    });

    it.each([
      ['cùng mtime', agentTok, ownerTok, NEW, NEW],
      ['nội dung không giống credential', 'junk', ownerTok, NEW, OLD],
      ['~/.codex/auth.json không tồn tại', agentTok, null, NEW, OLD],
    ])(
      'không chắc (%s) thì giữ ~/.crew/runtimes, báo rõ, không in token',
      async (_n, agent, owner, agentAt, ownerAt) => {
        const t = await seed({ agent, owner, agentAt, ownerAt });
        const report = await uninstall(t.ctx);
        expect(existsSync(t.mine)).toBe(true);
        expect(readFileSync(t.mine, 'utf8')).toBe(agent);
        if (owner !== null) expect(readFileSync(t.owner, 'utf8')).toBe(owner);
        expect(report.removed).not.toContain(t.rt.runtimesRoot);
        const text = (report.notes ?? []).join('\n');
        expect(text).toContain(t.rt.runtimesRoot);
        expect(text).not.toMatch(/fake|junk/);
        expect(existsSync(t.rt.codexWrapper)).toBe(false);
      },
    );
  });

  it('chạy lại khi đã gỡ hết thì không lỗi và không gỡ gì', async () => {
    const { ctx } = fakeMac();
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    await uninstall(ctx);
    expect(await uninstall(ctx)).toEqual({ removed: [], kept: [] });
  });
});

describe('crew-mac uninstall khi app 2P Crew giữ sshd agent', () => {
  async function appMode(extra: Record<number, { ppid: number; command: string }> = {}) {
    const mac = fakeMac();
    await setup(mac.ctx, { paperclipKey: PAPERCLIP_PUB });
    await setup(mac.ctx, { sshdOwner: 'app' });
    const paths = macPaths(mac.home);
    writeFileSync(paths.sshdPid, '4242\n');
    fakeProcs(mac.runner, () => ({
      4100: { ppid: 1, command: APP_EXECUTABLE },
      4242: { ppid: 4100, command: `/usr/sbin/sshd -D -f ${paths.sshdConfig} -E ${paths.sshdLog}` },
      ...extra,
    }));
    return { ...mac, paths };
  }

  it('không bootout sshd, không đụng listener của app, gỡ phần còn lại và báo cách dừng sshd', async () => {
    const t = await appMode();
    const before = t.runner.calls.length;
    const report = await uninstall(t.ctx);
    const later = t.runner.commands().slice(before);
    expect(later).not.toContain(`launchctl bootout gui/501/${SSHD_LABEL}`);
    expect(later.some((c) => c.startsWith('/bin/kill'))).toBe(false);
    expect(t.loaded.size).toBe(0);
    expect(existsSync(t.paths.reaperPlist)).toBe(false);
    expect(existsSync(t.paths.root)).toBe(false);
    expect(report.notes).toContain('sshd do app 2P Crew giữ: thoát app để dừng');
  });

  it('còn phiên SSH qua listener của app thì từ chối', async () => {
    const t = await appMode({ 4500: { ppid: 4242, command: 'sshd-session: owner@notty' } });
    await expect(uninstall(t.ctx)).rejects.toThrow(/phiên SSH qua sshd agent \(pid 4500\)/);
  });
});
