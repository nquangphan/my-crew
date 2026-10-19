import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync, statSync, unwatchFile, watchFile } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  type CommandRunner,
  DEFAULT_PORT,
  listProcesses,
  macPaths,
  readCwds,
  readManifest,
  readSshdPid,
} from '@crew/mac';
import type { AppContext } from '../app-context.js';
import type { SshdChild, SupervisorDeps } from './supervisor.js';
import type { ListenerProc } from './takeover.js';

const SSHD_BINARY = '/usr/sbin/sshd';
/** Đọc tối đa bấy nhiêu byte log mới để tìm lý do listener thoát. */
const LOG_TAIL_BYTES = 8_192;

/** Phần log ghi thêm từ `offset` (tối đa 8 KB cuối); file chưa có thì rỗng. */
export function readLogSince(path: string, offset: number): string {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return '';
  }
  const start = Math.max(offset > size ? 0 : offset, size - LOG_TAIL_BYTES);
  const length = size - start;
  if (length <= 0) return '';
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, start);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** `lsof -nP -iTCP:<port> -sTCP:LISTEN` → "sshd 16059, …" (lệnh và pid của từng chủ cổng). */
export function summarizeLsof(stdout: string): string {
  const owners = stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/).slice(0, 2).join(' '))
    .filter((line) => line !== '');
  return [...new Set(owners)].join(', ');
}

const ERROR_LINE_RE = /error|fatal|failed|bad |denied|no such|missing|invalid/i;

/**
 * Lý do thoát đọc từ log sshd: cổng bị chiếm có câu riêng; còn lại lấy dòng lỗi cuối. Không có dòng lỗi (ví dụ
 * listener bị kill) thì null để bộ giám sát dùng mã thoát/tín hiệu.
 */
export function exitReasonFromLog(logTail: string, port: number, lsofSummary: string | null): string | null {
  if (/Address already in use/i.test(logTail)) {
    return `Cổng ${port} đang bị chiếm: ${lsofSummary || 'không rõ process'}`;
  }
  const last = logTail
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => ERROR_LINE_RE.test(line))
    .at(-1);
  return last ? `sshd: ${last}` : null;
}

async function procInfo(runner: CommandRunner, pid: number): Promise<ListenerProc | null> {
  const command = await runner.run('/bin/ps', ['-ww', '-o', 'pid=,command=', '-p', String(pid)], {
    timeoutMs: 10_000,
  });
  const match = /^\s*(\d+)\s(.*)$/m.exec(command.stdout);
  if (command.code !== 0 || !match || Number(match[1]) !== pid) return null;
  const comm = await runner.run('/bin/ps', ['-o', 'comm=', '-p', String(pid)], { timeoutMs: 10_000 });
  return { pid, comm: comm.stdout.trim(), command: (match[2] as string).trim() };
}

/** Deps thật của bộ giám sát: process, file và manifest dưới `home`. */
export function createSystemDeps(input: {
  home: string;
  runner: CommandRunner;
  store: AppContext['store'];
  log: AppContext['log'];
  /** Chu kỳ `watchFile` (mặc định 2 giây; test dùng ngắn hơn). */
  watchIntervalMs?: number;
}): SupervisorDeps {
  const { runner } = input;
  const paths = macPaths(input.home);
  let logOffset = 0;

  const port = () => {
    try {
      return readManifest(paths.manifest)?.port ?? DEFAULT_PORT;
    } catch {
      return DEFAULT_PORT;
    }
  };

  return {
    sshdConfig: paths.sshdConfig,
    readPidFile: () => readSshdPid(paths.sshdPid),
    procInfo: (pid) => procInfo(runner, pid),
    spawnSshd: (): SshdChild => {
      try {
        logOffset = statSync(paths.sshdLog).size;
      } catch {
        logOffset = 0;
      }
      // Process group riêng (detached) để app thoát/crash không kéo listener và phiên của run theo.
      const child = spawn(SSHD_BINARY, ['-D', '-f', paths.sshdConfig, '-E', paths.sshdLog], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return {
        pid: child.pid,
        onExit: (cb) => {
          let done = false;
          child.once('exit', (code, signal) => {
            if (done) return;
            done = true;
            cb({ code, signal });
          });
          child.once('error', (error) => {
            if (done) return;
            done = true;
            cb({ code: null, signal: null, error });
          });
        },
      };
    },
    signal: (pid, signal) => {
      try {
        process.kill(pid, signal);
      } catch {
        // đã thoát
      }
    },
    readOwner: () => readManifest(paths.manifest)?.sshdOwner ?? 'launchd',
    readListenConfig: () => {
      // sshd chỉ đọc sshd_config (Port, ListenAddress) và host key lúc khởi động: hai thứ này đổi thì phải nạp lại.
      let config: string;
      try {
        config = readFileSync(paths.sshdConfig, 'utf8');
      } catch {
        return null;
      }
      let hostKey = 'none';
      try {
        const stat = statSync(paths.hostKey);
        hostKey = `${stat.mtimeMs}:${stat.size}`;
      } catch {
        // chưa có host key: sshd sẽ báo lỗi, backoff lo
      }
      return `${config}\0hostkey ${hostKey}`;
    },
    watchConfig: (cb) => {
      // watchFile (stat định kỳ) chịu được ghi atomic bằng rename và file chưa tồn tại.
      const files = [paths.manifest, paths.sshdConfig, paths.hostKey];
      const listener = () => cb();
      for (const file of files) watchFile(file, { interval: input.watchIntervalMs ?? 2_000 }, listener);
      return () => {
        for (const file of files) unwatchFile(file, listener);
      };
    },
    sleep: (ms) => sleep(ms),
    now: () => Date.now(),
    listProcesses: () => listProcesses(runner),
    readCwds: (pids) => readCwds(runner, pids),
    store: input.store,
    describeExit: async () => {
      const tail = readLogSince(paths.sshdLog, logOffset);
      if (tail === '') return null;
      let owners: string | null = null;
      if (/Address already in use/i.test(tail)) {
        const lsof = await runner.run('/usr/sbin/lsof', ['-nP', `-iTCP:${port()}`, '-sTCP:LISTEN'], {
          timeoutMs: 10_000,
        });
        owners = summarizeLsof(lsof.stdout);
      }
      return exitReasonFromLog(tail, port(), owners);
    },
    log: input.log,
  };
}
