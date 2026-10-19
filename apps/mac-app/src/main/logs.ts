import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { macPaths } from '@crew/mac';
import type { LogFile } from '../shared/ipc-contract.js';

/** Chỉ đọc phần cuối này của file log; log sshd/status có thể rất lớn. */
export const LOG_READ_BYTES = 512 * 1024;
const MAX_LINES = 5_000;

export function logPaths(home: string): Record<LogFile, string> {
  const paths = macPaths(home);
  return {
    app: join(home, 'Library', 'Application Support', '2P Crew', 'app.log'),
    sshd: paths.sshdLog,
    reaper: paths.reaperLog,
    status: paths.statusLog,
  };
}

/** Các dòng cuối của file (đọc tối đa 512 KB cuối), lọc dòng chứa `runId` rồi mới lấy `lines` dòng cuối. */
export async function tailFile(path: string, lines: number, runId?: string): Promise<string[]> {
  let text: string;
  try {
    const handle = await open(path, 'r');
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, LOG_READ_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      text = buffer.toString('utf8');
      // Đọc giữa file thì dòng đầu có thể đứt.
      if (size > length) text = text.slice(text.indexOf('\n') + 1);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  let all = text.split('\n');
  if (all.at(-1) === '') all.pop();
  if (runId) all = all.filter((line) => line.includes(runId));
  return lines > 0 ? all.slice(-lines) : [];
}

export interface LogsDeps {
  home: string;
  reveal(path: string): void;
}

export function createLogs(deps: LogsDeps) {
  const paths = logPaths(deps.home);
  const pathOf = (file: LogFile): string => {
    if (!Object.hasOwn(paths, file)) throw new Error('File log không hợp lệ');
    return paths[file];
  };
  return {
    async tail(file: LogFile, lines: number, runId?: string): Promise<string[]> {
      const path = pathOf(file);
      if (!Number.isInteger(lines) || lines < 0) throw new Error('Số dòng không hợp lệ');
      return tailFile(path, Math.min(lines, MAX_LINES), runId?.trim() || undefined);
    },
    reveal(file: LogFile): void {
      deps.reveal(pathOf(file));
    },
  };
}
