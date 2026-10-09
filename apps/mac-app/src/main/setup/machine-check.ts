import type { CommandRunner } from '@crew/mac';

export interface MachineCheckLine {
  id: 'macos' | 'tailscale' | 'claude';
  ok: boolean;
  message: string;
}

export interface MachineCheckResult {
  ok: boolean;
  lines: MachineCheckLine[];
}

const MIN_MACOS_MAJOR = 15;
export const TAILSCALE_CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

async function checkMacos(runner: CommandRunner): Promise<MachineCheckLine> {
  const result = await runner.run('/usr/bin/sw_vers', ['-productVersion'], { timeoutMs: 10_000 });
  const version = result.stdout.trim();
  const major = Number.parseInt(version, 10);
  if (result.code !== 0 || Number.isNaN(major)) {
    return { id: 'macos', ok: false, message: 'Không đọc được phiên bản macOS' };
  }
  if (major < MIN_MACOS_MAJOR) {
    return {
      id: 'macos',
      ok: false,
      message: `Cần macOS ${MIN_MACOS_MAJOR} trở lên (máy đang chạy ${version})`,
    };
  }
  return { id: 'macos', ok: true, message: `macOS ${version}` };
}

async function checkTailscale(runner: CommandRunner): Promise<MachineCheckLine> {
  const result = await runner.run(TAILSCALE_CLI, ['ip', '-4'], { timeoutMs: 15_000 });
  const ip = /^100\.\d+\.\d+\.\d+$/m.exec(result.stdout)?.[0];
  if (result.code !== 0 || !ip) return { id: 'tailscale', ok: false, message: 'Mở Tailscale và đăng nhập' };
  return { id: 'tailscale', ok: true, message: `Tailscale đang chạy (${ip})` };
}

async function checkClaude(runner: CommandRunner): Promise<MachineCheckLine> {
  // Shell đăng nhập để thấy PATH của owner (claude cài ở ~/.local/bin hay Homebrew).
  const result = await runner.run('/bin/zsh', ['-lc', 'claude auth status'], { timeoutMs: 60_000 });
  if (result.code !== 0 || !/"loggedIn"\s*:\s*true/.test(result.stdout)) {
    return { id: 'claude', ok: false, message: 'Chạy claude và đăng nhập một lần trong Terminal' };
  }
  return { id: 'claude', ok: true, message: 'Claude Code đã đăng nhập' };
}

/**
 * Bước `check`: macOS 15+, Tailscale có IP 100.x, Claude Code đã đăng nhập. Chỉ đọc, không đổi gì trên máy.
 * Ghim Superpowers do `setup` cài và check `superpowers-pin` của doctor kiểm ở bước `doctor`.
 */
export async function checkMachine(runner: CommandRunner): Promise<MachineCheckResult> {
  const lines = [await checkMacos(runner), await checkTailscale(runner), await checkClaude(runner)];
  return { ok: lines.every((line) => line.ok), lines };
}

/** Một dòng cho `StepResult.message`: dòng lỗi nối bằng xuống dòng, hoặc tóm tắt khi ổn. */
export function summarizeMachineCheck(result: MachineCheckResult): string {
  const lines = result.ok ? result.lines : result.lines.filter((line) => !line.ok);
  return lines.map((line) => line.message).join('\n');
}
