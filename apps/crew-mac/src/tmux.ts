import { join } from 'node:path';
import type { CheckResult } from './commands/doctor.js';
import type { MacContext } from './context.js';
import { readText } from './fs-util.js';
import { type MacPaths, macPaths } from './paths.js';

/**
 * Cấu hình cho tmux server riêng của Crew (socket `-L crew`), nạp bằng `-f`: không đụng `~/.tmux.conf` của owner và
 * cấu hình cho Claude Code luôn có hiệu lực.
 */
export const TMUX_CONF = `set -g extended-keys on
set -as terminal-features 'xterm*:extkeys'
set -g escape-time 0
set -g mouse on
set -g default-terminal "tmux-256color"
set -as terminal-overrides ',xterm*:Tc'
set -g history-limit 10000
set -g window-size latest
set -g focus-events on
`;

const TMUX_CANDIDATES = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux'] as const;
const BREW_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'] as const;
const BREW_INSTALL_TIMEOUT_MS = 10 * 60_000;

export const TMUX_NO_BREW_HINT = 'Cài Homebrew rồi chạy lại crew-mac setup, hoặc tự cài tmux.';

const tmuxConfPathOf = (paths: MacPaths) => join(paths.root, 'tmux.conf');

export function tmuxConfPath(home: string): string {
  return join(macPaths(home).root, 'tmux.conf');
}

/** Chạy được `<path> <arg>` (mã 0) thì coi như file tồn tại: test thay runner nên không dò bằng fs. */
async function runs(ctx: MacContext, path: string, arg: string): Promise<boolean> {
  return (await ctx.runner.run(path, [arg], { timeoutMs: 10_000 })).code === 0;
}

export async function findTmux(ctx: MacContext): Promise<string | null> {
  for (const path of TMUX_CANDIDATES) if (await runs(ctx, path, '-V')) return path;
  const found = await ctx.runner.run('/bin/sh', ['-c', 'command -v tmux'], { timeoutMs: 10_000 });
  const path = found.stdout.trim();
  return found.code === 0 && path !== '' ? path : null;
}

/** Thiếu tmux mà có Homebrew thì `brew install tmux`; không có Homebrew thì chỉ báo (`hint`). */
export async function ensureTmux(
  ctx: MacContext,
): Promise<{ path: string | null; installed: boolean; hint?: string }> {
  const existing = await findTmux(ctx);
  if (existing) return { path: existing, installed: false };
  let brew: string | null = null;
  for (const path of BREW_CANDIDATES) {
    if (await runs(ctx, path, '--version')) {
      brew = path;
      break;
    }
  }
  if (!brew) return { path: null, installed: false, hint: TMUX_NO_BREW_HINT };
  const result = await ctx.runner.run(brew, ['install', 'tmux'], { timeoutMs: BREW_INSTALL_TIMEOUT_MS });
  if (result.code !== 0) {
    return { path: null, installed: false, hint: `brew install tmux lỗi: ${result.stderr.trim()}` };
  }
  const path = await findTmux(ctx);
  return { path, installed: path !== null };
}

export async function checkTmux(ctx: MacContext, paths: MacPaths): Promise<CheckResult> {
  const title = 'tmux (terminal web)';
  const tmux = await findTmux(ctx);
  if (!tmux) {
    return {
      id: 'tmux',
      title,
      status: 'fail',
      detail: 'không thấy tmux',
      hint: 'Chạy "crew-mac setup" (cài bằng Homebrew) hoặc tự cài tmux.',
    };
  }
  const conf = tmuxConfPathOf(paths);
  if (readText(conf) !== TMUX_CONF) {
    return {
      id: 'tmux',
      title,
      status: 'warn',
      detail: `${tmux}; thiếu hoặc lệch ${conf}`,
      hint: 'crew-mac setup',
    };
  }
  return { id: 'tmux', title, status: 'ok', detail: `${tmux}, cấu hình ${conf}` };
}
