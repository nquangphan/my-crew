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
});
