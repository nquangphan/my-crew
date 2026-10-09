import { TAILSCALE_CANDIDATES } from './paths.js';
import type { CommandRunner } from './system.js';

const CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/;

/**
 * IPv4 Tailscale của máy này. Dưới launchd PATH chỉ có /usr/bin:/bin:/usr/sbin:/sbin nên `tailscale` không tìm thấy,
 * vì vậy thử cả đường dẫn tuyệt đối. File trong app là bản GUI: chạy trực tiếp bằng tên `Tailscale` nó mở GUI rồi
 * thoát mã 0 mà không in IP, nên phải đặt TAILSCALE_BE_CLI=1 để nó chạy như CLI.
 */
export async function tailscaleIpv4(runner: CommandRunner): Promise<string | null> {
  for (const command of TAILSCALE_CANDIDATES) {
    const result = await runner.run(command, ['ip', '-4'], {
      timeoutMs: 10_000,
      env: { TAILSCALE_BE_CLI: '1' },
    });
    if (result.code !== 0) continue;
    const ip = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .find((line) => CGNAT.test(line));
    if (ip) return ip;
  }
  return null;
}
