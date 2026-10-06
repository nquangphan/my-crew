import { describe, expect, it } from 'vitest';
import { bootout, bootstrap, guiSessionAvailable, serviceState } from '../src/launchctl.js';
import { tailscaleIpv4 } from '../src/tailscale.js';
import { FakeRunner } from './helpers/fake-runner.js';

describe('launchctl', () => {
  it('đọc trạng thái đang chạy, pid và mã thoát', async () => {
    const runner = new FakeRunner().on('launchctl', () => ({
      stdout: 'gui/501/com.2p.crew-mac-sshd = {\n\tstate = running\n\tpid = 17611\n\tlast exit code = 0\n}\n',
    }));
    expect(await serviceState(runner, 501, 'com.2p.crew-mac-sshd')).toEqual({
      loaded: true,
      running: true,
      pid: 17611,
      lastExitCode: 0,
    });
    expect(runner.commands()).toEqual(['launchctl print gui/501/com.2p.crew-mac-sshd']);
  });

  it('service chưa nạp', async () => {
    const runner = new FakeRunner().on('launchctl', () => ({ code: 113, stderr: 'Could not find service' }));
    expect(await serviceState(runner, 501, 'x')).toEqual({
      loaded: false,
      running: false,
      pid: null,
      lastExitCode: null,
    });
    expect(await guiSessionAvailable(runner, 501)).toBe(false);
    expect(await bootout(runner, 501, 'x')).toBe(false);
  });

  it('bootstrap lỗi thì ném lỗi có stderr', async () => {
    const runner = new FakeRunner().on('launchctl', () => ({
      code: 5,
      stderr: 'Bootstrap failed: 5: Input/output error',
    }));
    await expect(bootstrap(runner, 501, '/p.plist')).rejects.toThrow('Input/output error');
  });
});

describe('tailscaleIpv4', () => {
  it('thử CLI trên PATH rồi tới CLI trong app', async () => {
    const runner = new FakeRunner()
      .on('tailscale', () => ({ code: 127 }))
      .on('/Applications/Tailscale.app/Contents/MacOS/Tailscale', () => ({ stdout: '100.102.189.67\n' }));
    expect(await tailscaleIpv4(runner)).toBe('100.102.189.67');
  });

  it('bỏ qua IP ngoài dải 100.64.0.0/10', async () => {
    const runner = new FakeRunner()
      .on('tailscale', () => ({ stdout: '100.200.1.1\n' }))
      .on('/Applications/Tailscale.app/Contents/MacOS/Tailscale', () => ({ code: 1 }));
    expect(await tailscaleIpv4(runner)).toBeNull();
  });
});
