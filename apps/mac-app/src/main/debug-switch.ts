/**
 * Cờ Chromium mở cổng DevTools (CDP) cho process bên ngoài. Fuse của Electron chỉ tắt `--inspect` của Node, không
 * phủ các cờ này, nên Main tự thoát khi thấy chúng.
 */
const FORBIDDEN = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-allow-origins'] as const;

export function forbiddenDebugSwitch(commandLine: { hasSwitch: (name: string) => boolean }): string | null {
  return FORBIDDEN.find((name) => commandLine.hasSwitch(name)) ?? null;
}
