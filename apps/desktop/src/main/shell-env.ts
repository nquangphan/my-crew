import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MARKER = '__CREW_PATH__';

/**
 * An app opened from Finder or at login gets launchd's minimal PATH, so `git`, `claude`, `npx` or `maestro`
 * installed by Homebrew or in `~/.local/bin` would not be found. This reads the PATH of the owner's login
 * shell once at start (falling back to the usual install locations) and returns the merged value.
 */
export function loginShellPath(env: NodeJS.ProcessEnv = process.env): string {
  const current = (env.PATH ?? '').split(':').filter(Boolean);
  const shell = env.SHELL?.startsWith('/') ? env.SHELL : '/bin/zsh';
  const run = spawnSync(shell, ['-ilc', `printf '${MARKER}%s' "$PATH"`], {
    encoding: 'utf8',
    timeout: 5_000,
    env: { ...env, TERM: 'dumb' },
  });
  const fromShell =
    run.status === 0 && run.stdout.includes(MARKER)
      ? (run.stdout.split(MARKER).at(-1) ?? '').trim().split(':').filter(Boolean)
      : [];
  const fallback = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir(), '.local', 'bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  return [...new Set([...fromShell, ...current, ...fallback])].join(':');
}
