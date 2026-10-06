import type { CommandRunner } from '../system.js';

export interface ProcInfo {
  pid: number;
  ppid: number;
  pgid: number;
  /** Tiêu đề process (sshd đổi thành "sshd-session: user@notty"). */
  comm: string;
  /** Chỉ argv (`ps -o command=` không có `-E`). */
  command: string;
  /** PAPERCLIP_RUN_ID lấy từ phần env lúc exec (`ps -E`), không bao giờ từ argv. */
  runId: string | null;
}

const TREE_RE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/;
const ENV_RE = /^\s*(\d+)\s(.*)$/;
const RUN_ID_RE = /(?:^|\s)PAPERCLIP_RUN_ID=([A-Za-z0-9_-]{1,128})(?=\s|$)/;

export function parsePsTree(text: string): Map<number, { ppid: number; pgid: number; comm: string }> {
  const rows = new Map<number, { ppid: number; pgid: number; comm: string }>();
  for (const line of text.split('\n')) {
    const match = TREE_RE.exec(line);
    if (match) {
      rows.set(Number(match[1]), {
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        comm: (match[4] as string).trim(),
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

/**
 * Run id chỉ được tìm trong phần env mà `ps -E` nối sau argv. Prompt của owner (`claude -p "… PAPERCLIP_RUN_ID=…"`)
 * nằm trong argv nên không được tính. Argv rỗng hoặc không khớp đầu chuỗi thì không đoán.
 */
export function extractRunId(argvOnly: string, withEnv: string): string | null {
  if (argvOnly === '' || !withEnv.startsWith(argvOnly)) return null;
  return RUN_ID_RE.exec(withEnv.slice(argvOnly.length))?.[1] ?? null;
}

export async function listProcesses(runner: CommandRunner): Promise<ProcInfo[]> {
  const tree = await runner.run('/bin/ps', ['-axww', '-o', 'pid=,ppid=,pgid=,comm='], { timeoutMs: 15_000 });
  const argv = await runner.run('/bin/ps', ['-axww', '-o', 'pid=,command='], { timeoutMs: 15_000 });
  const env = await runner.run('/bin/ps', ['-E', '-axww', '-o', 'pid=,command='], { timeoutMs: 15_000 });
  if (tree.code !== 0 || argv.code !== 0 || env.code !== 0) {
    throw new Error(`ps lỗi: ${tree.stderr} ${argv.stderr} ${env.stderr}`.trim());
  }
  const argvs = parsePsCommands(argv.stdout);
  const envs = parsePsCommands(env.stdout);
  return [...parsePsTree(tree.stdout)].map(([pid, row]) => {
    const command = argvs.get(pid) ?? '';
    return { pid, ...row, command, runId: extractRunId(command, envs.get(pid) ?? '') };
  });
}
