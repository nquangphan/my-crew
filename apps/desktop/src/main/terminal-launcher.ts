import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/**
 * Opens Terminal running `claude`, so the owner can `/login`. This is the only command the app ever opens
 * a terminal for; nothing from the UI reaches a shell.
 */
export type TerminalLauncher = () => Promise<void>;

const SCRIPT = ['tell application "Terminal"', 'activate', 'do script "claude"', 'end tell'];

export function macTerminalLauncher(): TerminalLauncher {
  return () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        '/usr/bin/osascript',
        SCRIPT.flatMap((line) => ['-e', line]),
        { stdio: 'ignore' },
      );
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Không mở được Terminal (osascript thoát với mã ${code}).`)),
      );
    });
}

/** Test mode: records the launch in a file of the test home instead of opening Terminal. */
export function recordingTerminalLauncher(path: string): TerminalLauncher {
  return async () => {
    appendFileSync(path, `${new Date().toISOString()} claude\n`);
  };
}
