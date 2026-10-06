import type { CommandRunner } from '../system.js';

export interface ProcInfo {
  pid: number;
  ppid: number;
  pgid: number;
  /** Tiêu đề process (sshd đổi thành "sshd-session: user@notty"). */
  comm: string;
  /** Argv rồi tới env lúc exec, theo `ps -E`; env chỉ có với binary không phải của Apple. */
  command: string;
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

export function parsePsEnv(text: string): Map<number, string> {
  const rows = new Map<number, string>();
  for (const line of text.split('\n')) {
    const match = ENV_RE.exec(line);
    if (match) rows.set(Number(match[1]), (match[2] as string).trim());
  }
  return rows;
}

export function extractRunId(commandWithEnv: string): string | null {
  return RUN_ID_RE.exec(commandWithEnv)?.[1] ?? null;
}

export async function listProcesses(runner: CommandRunner): Promise<ProcInfo[]> {
  const tree = await runner.run('/bin/ps', ['-axww', '-o', 'pid=,ppid=,pgid=,comm='], { timeoutMs: 15_000 });
  const env = await runner.run('/bin/ps', ['-E', '-axww', '-o', 'pid=,command='], { timeoutMs: 15_000 });
  if (tree.code !== 0 || env.code !== 0) throw new Error(`ps lỗi: ${tree.stderr} ${env.stderr}`.trim());
  const commands = parsePsEnv(env.stdout);
  return [...parsePsTree(tree.stdout)].map(([pid, row]) => {
    const command = commands.get(pid) ?? '';
    return { pid, ...row, command, runId: extractRunId(command) };
  });
}
