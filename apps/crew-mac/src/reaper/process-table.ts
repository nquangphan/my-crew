import type { CommandRunner } from '../system.js';

export interface ProcInfo {
  pid: number;
  ppid: number;
  pgid: number;
  /** Terminal điều khiển theo `ps -o tty=`; `??` là không có. */
  tty: string;
  /** Thời điểm bắt đầu (epoch giây), tính từ `etime` lúc quét. */
  startedAt: number;
  /** Tiêu đề process (sshd đổi thành "sshd-session: user@notty"). */
  comm: string;
  /** Chỉ argv (`ps -o command=` không có `-E`). */
  command: string;
  /** PAPERCLIP_RUN_ID lấy từ phần env lúc exec (`ps -E`), không bao giờ từ argv. */
  runId: string | null;
  /** `ps -E` trả được phần env sau argv. Binary Apple/SIP thường không; khi false, `runId === null` không có nghĩa là không có run. */
  envReadable: boolean;
}

export interface PsTreeRow {
  ppid: number;
  pgid: number;
  tty: string;
  elapsedSec: number;
  comm: string;
}

const TREE_RE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/;
const ENV_RE = /^\s*(\d+)\s(.*)$/;
const RUN_ID_RE = /(?:^|\s)PAPERCLIP_RUN_ID=([A-Za-z0-9_-]{1,128})(?=\s|$)/;

/** `etime` của ps: `[[dd-]hh:]mm:ss` → giây; sai định dạng thì NaN. */
export function parseEtime(value: string): number {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(value);
  if (!match) return Number.NaN;
  const [, days, hours, minutes, seconds] = match;
  return Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes) * 60 + Number(seconds);
}

export function parsePsTree(text: string): Map<number, PsTreeRow> {
  const rows = new Map<number, PsTreeRow>();
  for (const line of text.split('\n')) {
    const match = TREE_RE.exec(line);
    if (match) {
      rows.set(Number(match[1]), {
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        tty: match[4] as string,
        elapsedSec: parseEtime(match[5] as string),
        comm: (match[6] as string).trim(),
      });
    }
  }
  return rows;
}

/** Đọc `pid command…` của `ps -o pid=,command=` (có hoặc không `-E`). */
export function parsePsCommands(text: string): Map<number, string> {
  const rows = new Map<number, string>();
  for (const line of text.split('\n')) {
    const match = ENV_RE.exec(line);
    if (match) rows.set(Number(match[1]), (match[2] as string).trim());
  }
  return rows;
}

/** Đọc `lsof -a -d cwd -Fpn`: các dòng `p<pid>` rồi `n<đường dẫn>`. */
export function parseLsofCwd(text: string): Map<number, string> {
  const rows = new Map<number, string>();
  let pid: number | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null && Number.isInteger(pid)) rows.set(pid, line.slice(1));
  }
  return rows;
}

/**
 * Run id chỉ được tìm trong phần env mà `ps -E` nối sau argv. Prompt của owner (`claude -p "… PAPERCLIP_RUN_ID=…"`)
 * nằm trong argv nên không được tính. Argv rỗng hoặc không khớp đầu chuỗi thì không đoán.
 */
export function isEnvReadable(argvOnly: string, withEnv: string): boolean {
  return argvOnly !== '' && withEnv.startsWith(argvOnly) && withEnv.trim().length > argvOnly.trim().length;
}

export function extractRunId(argvOnly: string, withEnv: string): string | null {
  if (argvOnly === '' || !withEnv.startsWith(argvOnly)) return null;
  return RUN_ID_RE.exec(withEnv.slice(argvOnly.length))?.[1] ?? null;
}

export async function listProcesses(runner: CommandRunner, now: Date = new Date()): Promise<ProcInfo[]> {
  const tree = await runner.run('/bin/ps', ['-axww', '-o', 'pid=,ppid=,pgid=,tty=,etime=,comm='], {
    timeoutMs: 15_000,
  });
  const argv = await runner.run('/bin/ps', ['-axww', '-o', 'pid=,command='], { timeoutMs: 15_000 });
  const env = await runner.run('/bin/ps', ['-E', '-axww', '-o', 'pid=,command='], { timeoutMs: 15_000 });
  if (tree.code !== 0 || argv.code !== 0 || env.code !== 0) {
    throw new Error(`ps lỗi: ${tree.stderr} ${argv.stderr} ${env.stderr}`.trim());
  }
  const argvs = parsePsCommands(argv.stdout);
  const envs = parsePsCommands(env.stdout);
  const nowSec = Math.floor(now.getTime() / 1000);
  return [...parsePsTree(tree.stdout)].map(([pid, row]) => {
    const command = argvs.get(pid) ?? '';
    return {
      pid,
      ppid: row.ppid,
      pgid: row.pgid,
      tty: row.tty,
      startedAt: nowSec - row.elapsedSec,
      comm: row.comm,
      command,
      runId: extractRunId(command, envs.get(pid) ?? ''),
      envReadable: isEnvReadable(command, envs.get(pid) ?? ''),
    };
  });
}

/** Số pid tối đa cho một lần gọi lsof (độ dài dòng lệnh). */
export const LSOF_BATCH = 500;

/**
 * cwd của đúng các pid cần hỏi, mỗi lô một lần gọi `lsof -a -d cwd -Fpn -p <pid,…>`. lsof báo lỗi với process
 * không đọc được hoặc đã thoát nhưng vẫn in phần đọc được: chỉ dùng stdout.
 */
export async function readCwds(runner: CommandRunner, pids: readonly number[]): Promise<Map<number, string>> {
  const cwds = new Map<number, string>();
  for (let i = 0; i < pids.length; i += LSOF_BATCH) {
    const batch = pids.slice(i, i + LSOF_BATCH);
    const result = await runner.run('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', batch.join(',')], {
      timeoutMs: 15_000,
    });
    for (const [pid, cwd] of parseLsofCwd(result.stdout)) cwds.set(pid, cwd);
  }
  return cwds;
}

/** `sysctl -n kern.boottime` → epoch giây; null khi không đọc được. */
export function parseBootTime(text: string): number | null {
  const match = /sec = (\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

export async function readBootTime(runner: CommandRunner): Promise<number | null> {
  const result = await runner.run('/usr/sbin/sysctl', ['-n', 'kern.boottime'], { timeoutMs: 10_000 });
  return result.code === 0 ? parseBootTime(result.stdout) : null;
}
