import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, sshServerPort, USAGE } from '../src/cli.js';
import { fakeMac, PAPERCLIP_PUB } from './helpers/fake-mac.js';

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

  it('đọc cổng server từ SSH_CONNECTION', () => {
    expect(sshServerPort({ SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22' })).toBe(22);
    expect(sshServerPort({})).toBeNull();
  });
});
