import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, sshServerPort, USAGE } from '../src/cli.js';
import { fakeMac, LIVE_PS, LIVE_RUN_ID, PAPERCLIP_PUB } from './helpers/fake-mac.js';

function io(mac: ReturnType<typeof fakeMac>, env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env, context: mac.ctx },
  };
}

describe('crew-mac CLI', () => {
  it('lệnh lạ in cách dùng, mã 2', async () => {
    const t = io(fakeMac());
    expect(await main(['lung-tung'], t.io)).toBe(2);
    expect(t.err.join('\n')).toContain(USAGE);
  });

  it('setup đọc key từ file .pub và in việc đã làm', async () => {
    const mac = fakeMac();
    const keyFile = join(mac.home, 'paperclip.pub');
    writeFileSync(keyFile, `${PAPERCLIP_PUB}\n`);
    const t = io(mac);
    expect(await main(['setup', '--paperclip-key', keyFile], t.io)).toBe(0);
    expect(t.out.join('\n')).toContain('sshd agent nghe 100.102.189.67:2222');
    expect(t.out.join('\n')).toContain(`adapterConfig.command = ${mac.home}/.crew/bin/crew-claude-run`);
    const pinDir = `${mac.home}/.crew/workflows/superpowers/9.9.9-ffffffffffff`;
    expect(t.out).toContain(
      `Agent claude_local: đặt adapterConfig.extraArgs = ${JSON.stringify(['--setting-sources', 'project,local', '--plugin-dir', pinDir])}`,
    );
    const bmadDir = `${mac.home}/.crew/workflows/bmad/9.9.9-next-bbbbbbbbbbbb`;
    expect(t.out).toContain(
      `Agent BMAD (vai bmad): đặt adapterConfig.extraArgs = ${JSON.stringify(['--setting-sources', 'project,local', '--plugin-dir', bmadDir])}`,
    );
  });

  it('doctor trả 1 khi có check lỗi', async () => {
    const t = io(fakeMac());
    expect(await main(['doctor', '--no-probe'], t.io)).toBe(1);
    expect(t.out.join('\n')).toContain('[LỖI] Cài đặt');
  });

  it('uninstall từ chối khi đang chạy qua chính sshd agent, trừ khi có --force', async () => {
    const mac = fakeMac();
    const viaAgent = io(mac, { SSH_CONNECTION: '100.88.1.2 51234 100.102.189.67 2222' });
    expect(await main(['uninstall'], viaAgent.io)).toBe(2);
    expect(viaAgent.err.join('\n')).toContain('Terminal trên màn hình Mac');
    const forced = io(mac, { SSH_CONNECTION: '100.88.1.2 51234 100.102.189.67 2222' });
    expect(await main(['uninstall', '--force'], forced.io)).toBe(0);
  });

  it('uninstall từ chối khi còn run Paperclip, --force thì gỡ', async () => {
    const mac = fakeMac({ ps: LIVE_PS });
    const refused = io(mac);
    expect(await main(['uninstall'], refused.io)).toBe(1);
    expect(refused.err.join('\n')).toContain(LIVE_RUN_ID);
    const forced = io(mac);
    expect(await main(['uninstall', '--force'], forced.io)).toBe(0);
  });

  it('setup --sshd-owner từ chối khi chạy qua chính sshd agent, trừ khi có --force', async () => {
    const mac = fakeMac();
    expect(await main(['setup', '--paperclip-key', PAPERCLIP_PUB], io(mac).io)).toBe(0);
    const before = mac.runner.calls.length;
    const env = { SSH_CONNECTION: '100.1.2.3 5555 100.4.5.6 2222' };
    const viaAgent = io(mac, env);
    expect(await main(['setup', '--sshd-owner', 'app'], viaAgent.io)).not.toBe(0);
    expect(viaAgent.err.join('\n')).toContain('qua chính sshd agent');
    expect(
      mac.runner
        .commands()
        .slice(before)
        .some((c) => c.includes('bootout')),
    ).toBe(false);
    const forced = io(mac, env);
    expect(await main(['setup', '--sshd-owner', 'app', '--force'], forced.io)).toBe(0);
    expect(
      mac.runner
        .commands()
        .slice(before)
        .some((c) => c.includes('bootout')),
    ).toBe(true);
    expect(forced.out.join('\n')).toContain('2P Crew');
  });

  it('setup ở chế độ app nói đúng việc app nạp lại cấu hình; đổi cổng thì báo app sẽ nạp lại listener', async () => {
    const mac = fakeMac();
    expect(await main(['setup', '--paperclip-key', PAPERCLIP_PUB], io(mac).io)).toBe(0);
    const toApp = io(mac);
    expect(await main(['setup', '--sshd-owner', 'app'], toApp.io)).toBe(0);
    const said = toApp.out.join('\n');
    expect(said).toContain('Chủ sshd agent: app 2P Crew.');
    expect(said).toContain('App đang mở tự nạp lại cấu hình khi manifest đổi cổng/IP');
    expect(said).not.toContain('Cấu hình sshd đã đổi');
    const newPort = io(mac);
    expect(await main(['setup', '--port', '2223'], newPort.io)).toBe(0);
    expect(newPort.out.join('\n')).toContain(
      'Cấu hình sshd đã đổi sang 100.102.189.67:2223: app 2P Crew đang mở sẽ dừng listener cũ và sinh lại theo cấu hình mới',
    );
  });

  it('setup --sshd-owner giá trị lạ thì báo cách dùng', async () => {
    const t = io(fakeMac());
    expect(await main(['setup', '--sshd-owner', 'systemd'], t.io)).toBe(2);
    expect(t.err.join('\n')).toContain('--sshd-owner chỉ nhận app hoặc launchd');
  });

  it('reap chạy được với bảng process rỗng và từ chối số giây sai', async () => {
    const mac = fakeMac();
    mac.runner.on('/bin/ps', () => ({ stdout: '    1     0     1 /sbin/launchd\n' }));
    const ok = io(mac);
    expect(await main(['reap', '--dry-run'], ok.io)).toBe(0);
    const bad = io(mac);
    expect(await main(['reap', '--grace-seconds', 'abc'], bad.io)).toBe(2);
    const tooShort = io(mac);
    expect(await main(['reap', '--grace-seconds', '30'], tooShort.io)).toBe(2);
    expect(tooShort.err.join('\n')).toContain('60');
  });

  it('đọc cổng server từ SSH_CONNECTION', () => {
    expect(sshServerPort({ SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22' })).toBe(22);
    expect(sshServerPort({})).toBeNull();
  });
  describe('files', () => {
    const ISSUE = '11111111-1111-4111-8111-111111111111';
    const RUN = '0b7f3c2e-7d1a-4c55-9a51-5d0e7a6b9c10';
    const BRIDGE_ENV = { PAPERCLIP_API_URL: 'http://127.0.0.1:1', PAPERCLIP_API_KEY: 'k' };

    it('thiếu --issue hoặc --run thì mã 2', async () => {
      const t = io(fakeMac(), BRIDGE_ENV);
      expect(await main(['files'], t.io)).toBe(2);
      expect(await main(['files', '--issue', ISSUE], t.io)).toBe(2);
      expect(await main(['files', '--run', RUN], t.io)).toBe(2);
    });

    it('đối số lạ hoặc --issue/--run không phải UUID thì mã 2', async () => {
      const t = io(fakeMac(), BRIDGE_ENV);
      expect(await main(['files', '--issue', 'TPS-80', '--run', RUN], t.io)).toBe(2);
      expect(await main(['files', '--issue', ISSUE, '--run', '../x'], t.io)).toBe(2);
      expect(await main(['files', '--issue', ISSUE, '--run', RUN, '--lung-tung'], t.io)).toBe(2);
    });

    it('thiếu PAPERCLIP_API_URL hoặc PAPERCLIP_API_KEY thì mã 2 với câu cố định', async () => {
      const t = io(fakeMac(), { PAPERCLIP_API_URL: 'http://127.0.0.1:1' });
      expect(await main(['files', '--issue', ISSUE, '--run', RUN], t.io)).toBe(2);
      expect(t.err.join('\n')).toContain(
        'files: thiếu PAPERCLIP_API_URL hoặc PAPERCLIP_API_KEY (chỉ chạy trong run Paperclip)',
      );
    });

    it('--gc-only dọn cache, in số run và blob, không cần env bridge', async () => {
      const mac = fakeMac();
      const t = io(mac);
      expect(await main(['files', '--gc-only'], t.io)).toBe(0);
      expect(t.out).toEqual(['Đã dọn: 0 run, 0 blob']);
    });
  });
});
