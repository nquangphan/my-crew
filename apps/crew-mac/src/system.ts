import { spawn } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  /** Hết hạn thì SIGKILL: claude bỏ qua SIGTERM khi bị TCC chặn. */
  timeoutMs?: number;
  input?: string;
}

export interface CommandRunner {
  run(command: string, args: readonly string[], options?: RunOptions): Promise<RunResult>;
}

export function createRunner(): CommandRunner {
  return {
    run(command, args, options = {}) {
      return new Promise((resolve) => {
        const child = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;
        const timer =
          options.timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                timedOut = true;
                child.kill('SIGKILL');
              }, options.timeoutMs);
        const finish = (result: RunResult) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(result);
        };
        child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
          stderr += chunk;
        });
        child.on('error', (error) => finish({ code: 127, stdout, stderr: error.message, timedOut }));
        child.on('close', (code, signal) =>
          finish({ code: code ?? (signal === 'SIGKILL' ? 137 : 1), stdout, stderr, timedOut }),
        );
        child.stdin.on('error', () => {});
        child.stdin.end(options.input ?? '');
      });
    },
  };
}
