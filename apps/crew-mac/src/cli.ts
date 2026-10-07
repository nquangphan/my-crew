#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CheckStatus, doctor } from './commands/doctor.js';
import { setup } from './commands/setup.js';
import { formatStopLine, RUN_ID_UUID, StopRunInputError, stopRun } from './commands/stop-run.js';
import { uninstall } from './commands/uninstall.js';
import type { MacContext } from './context.js';
import { type Manifest, readManifest } from './manifest.js';
import { DEFAULT_PORT, macPaths } from './paths.js';
import { reapOnce } from './reaper/reap.js';
import { createRunner } from './system.js';

export const USAGE = `crew-mac: cài và kiểm Mac chạy agent cho Crew v3

Cách dùng:
  crew-mac setup --paperclip-key <file .pub | chuỗi key> [--port 2222] [--worktree-root <thư mục>]
  crew-mac doctor [--no-probe] [--tcc-window 24h] [--probe-timeout 90]
  crew-mac uninstall [--force]      --force: bỏ qua kiểm phiên sshd agent và run Paperclip đang chạy
  crew-mac reap [--grace-seconds 60] [--dry-run]
  crew-mac stop-run --run-id <uuid> --root <worktree tuyệt đối> [--term-wait-seconds 5]

Chạy setup và uninstall trong Terminal trên màn hình Mac (phiên desktop), không chạy qua sshd agent.`;

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
  /** Test hook: ghi đè từng phần của context. */
  context?: Partial<MacContext>;
}

class UsageError extends Error {}

/**
 * Thời gian chờ sau TERM của stop-run: mặc định và tối đa. Phía server truyền 3 giây và chờ cả lệnh khoảng 12 giây.
 */
const DEFAULT_TERM_WAIT_SECONDS = 5;
const MAX_TERM_WAIT_SECONDS = 20;

/** Ngưỡng mồ côi thấp nhất: ngắn hơn thì dễ dọn nhầm run vừa mất mạng chốc lát. */
const MIN_GRACE_SECONDS = 60;

function parseFlags(
  args: readonly string[],
  valueFlags: readonly string[],
  boolFlags: readonly string[] = [],
) {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (valueFlags.includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} cần một giá trị`);
      flags.set(arg, value);
    } else if (boolFlags.includes(arg)) {
      flags.set(arg, true);
    } else {
      throw new UsageError(`không có tuỳ chọn ${arg}`);
    }
  }
  const value = (flag: string) => {
    const v = flags.get(flag);
    return typeof v === 'string' ? v : undefined;
  };
  const number = (flag: string) => {
    const v = value(flag);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new UsageError(`${flag} cần một số`);
    return n;
  };
  return { has: (flag: string) => flags.has(flag), value, number };
}

function manifestOrNull(path: string): Manifest | null {
  try {
    return readManifest(path);
  } catch {
    return null;
  }
}

export function stableNodePath(): string {
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    if (existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

export function defaultContext(env: NodeJS.ProcessEnv, out: (line: string) => void): MacContext {
  return {
    home: env.HOME ?? homedir(),
    user: userInfo().username,
    uid: process.getuid?.() ?? 0,
    platform: process.platform,
    runner: createRunner(),
    now: () => new Date(),
    out,
    nodePath: stableNodePath(),
    cliPath: realpathSync(fileURLToPath(import.meta.url)),
  };
}

export function sshServerPort(env: NodeJS.ProcessEnv): number | null {
  const parts = env.SSH_CONNECTION?.trim().split(/\s+/);
  if (parts?.length !== 4) return null;
  const port = Number(parts[3]);
  return Number.isInteger(port) ? port : null;
}

const STATUS_LABEL: Record<CheckStatus, string> = { ok: 'ĐẠT', warn: 'CẢNH BÁO', fail: 'LỖI' };

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  try {
    const ctx: MacContext = { ...defaultContext(io.env, io.out), ...io.context };
    switch (command) {
      case 'setup': {
        const flags = parseFlags(args, ['--paperclip-key', '--port', '--worktree-root']);
        const key = flags.value('--paperclip-key');
        const report = await setup(ctx, {
          paperclipKey: key === undefined ? undefined : existsSync(key) ? readFileSync(key, 'utf8') : key,
          port: flags.number('--port'),
          worktreeRoot: flags.value('--worktree-root'),
        });
        const m = report.manifest;
        io.out(`sshd agent nghe ${m.listenAddress}:${m.port}; thư mục worktree ${m.worktreeRoot}.`);
        io.out(
          report.changed.length === 0
            ? 'Không có file nào thay đổi.'
            : `Đã ghi: ${report.changed.join(', ')}`,
        );
        if (report.restarted.length > 0) io.out(`Đã nạp lại: ${report.restarted.join(', ')}`);
        io.out(`Agent claude_local: đặt adapterConfig.command = ${macPaths(ctx.home).wrapper}`);
        io.out('Chạy "crew-mac doctor" để kiểm toàn bộ.');
        return 0;
      }
      case 'doctor': {
        const flags = parseFlags(args, ['--tcc-window', '--probe-timeout'], ['--no-probe']);
        const results = await doctor(ctx, {
          probe: !flags.has('--no-probe'),
          tccWindow: flags.value('--tcc-window') ?? '24h',
          probeTimeoutSec: flags.number('--probe-timeout') ?? 90,
        });
        for (const r of results) {
          io.out(`[${STATUS_LABEL[r.status]}] ${r.title}: ${r.detail}`);
          if (r.hint && r.status !== 'ok') io.out(`    → ${r.hint}`);
        }
        return results.some((r) => r.status === 'fail') ? 1 : 0;
      }
      case 'uninstall': {
        const flags = parseFlags(args, [], ['--force']);
        const sshPort = sshServerPort(io.env);
        const agentPort = (() => {
          try {
            return readManifest(macPaths(ctx.home).manifest)?.port ?? DEFAULT_PORT;
          } catch {
            return DEFAULT_PORT;
          }
        })();
        if (
          sshPort !== null &&
          (sshPort === agentPort || sshPort === DEFAULT_PORT) &&
          !flags.has('--force')
        ) {
          io.err(
            `crew-mac: phiên này đi qua sshd cổng ${sshPort}; uninstall sẽ cắt chính phiên này giữa chừng. ` +
              'Chạy trong Terminal trên màn hình Mac, hoặc thêm --force nếu chắc chắn (--force bỏ qua CẢ kiểm phiên sshd agent LẪN kiểm run Paperclip).',
          );
          return 2;
        }
        const report = await uninstall(ctx, { force: flags.has('--force') });
        io.out(report.removed.length === 0 ? 'Không còn gì để gỡ.' : `Đã gỡ: ${report.removed.join(', ')}`);
        for (const kept of report.kept)
          io.out(`Giữ nguyên thư mục worktree ${kept} (có thể còn việc của agent).`);
        return 0;
      }
      case 'stop-run': {
        const flags = parseFlags(args, ['--run-id', '--root', '--term-wait-seconds']);
        const runId = flags.value('--run-id');
        const root = flags.value('--root');
        const waitSeconds = flags.number('--term-wait-seconds') ?? DEFAULT_TERM_WAIT_SECONDS;
        if (!runId || !RUN_ID_UUID.test(runId)) throw new UsageError('--run-id phải là UUID');
        if (!root || !isAbsolute(root)) throw new UsageError('--root phải là đường dẫn tuyệt đối');
        if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > MAX_TERM_WAIT_SECONDS) {
          throw new UsageError(`--term-wait-seconds phải là số nguyên 0–${MAX_TERM_WAIT_SECONDS}`);
        }
        const manifest = manifestOrNull(macPaths(ctx.home).manifest);
        if (manifest === null) {
          throw new UsageError('chưa chạy "crew-mac setup" trên máy này (không biết thư mục worktree)');
        }
        const result = await stopRun(
          {
            runner: ctx.runner,
            signal: (pid, sig) => process.kill(pid, sig),
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            now: ctx.now,
            selfPid: process.pid,
          },
          { runId, root, termWaitMs: waitSeconds * 1000, allowedRoot: manifest.worktreeRoot, home: ctx.home },
        );
        io.out(formatStopLine(result));
        return 0;
      }
      case 'reap': {
        const flags = parseFlags(args, ['--grace-seconds'], ['--dry-run']);
        const graceSeconds = flags.number('--grace-seconds') ?? MIN_GRACE_SECONDS;
        if (graceSeconds < MIN_GRACE_SECONDS) {
          throw new UsageError(`--grace-seconds tối thiểu ${MIN_GRACE_SECONDS} (giây mồ côi trước khi dọn)`);
        }
        const paths = macPaths(ctx.home);
        const targets = await reapOnce(
          {
            runner: ctx.runner,
            signal: (pid, sig) => process.kill(pid, sig),
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            now: ctx.now,
            selfPid: process.pid,
          },
          {
            graceMs: graceSeconds * 1000,
            termWaitMs: 10_000,
            dryRun: flags.has('--dry-run'),
            statePath: paths.reaperState,
            logPath: paths.reaperLog,
            worktreeRoot: manifestOrNull(paths.manifest)?.worktreeRoot ?? null,
            home: ctx.home,
          },
        );
        if (targets.length > 0)
          io.out(`Đã xử lý ${targets.length} run mồ côi; chi tiết ở ${paths.reaperLog}.`);
        return 0;
      }
      default:
        throw new UsageError(command === undefined ? 'thiếu lệnh' : `không có lệnh ${command}`);
    }
  } catch (error) {
    if (error instanceof StopRunInputError) {
      io.err(`crew-mac: ${error.message}`);
      return 2;
    }
    if (error instanceof UsageError) {
      io.err(`crew-mac: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    io.err(`crew-mac: ${(error as Error).message}`);
    return 1;
  }
}

const invokedDirectly = (() => {
  try {
    return (
      process.argv[1] !== undefined &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    env: process.env,
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: Error) => {
      process.stderr.write(`crew-mac: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
