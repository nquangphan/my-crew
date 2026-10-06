import { TAILSCALE_CANDIDATES } from './paths.js';
import type { CommandRunner } from './system.js';

const CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/;

/** IPv4 Tailscale của máy này; CLI không có trên PATH khi cài bản app nên thử cả đường dẫn trong app. */
export async function tailscaleIpv4(runner: CommandRunner): Promise<string | null> {
  for (const command of TAILSCALE_CANDIDATES) {
    const result = await runner.run(command, ['ip', '-4'], { timeoutMs: 10_000 });
    if (result.code !== 0) continue;
    const ip = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .find((line) => CGNAT.test(line));
    if (ip) return ip;
  }
  return null;
}
