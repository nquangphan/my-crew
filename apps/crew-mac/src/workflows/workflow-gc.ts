import { lstatSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { MacContext } from '../context.js';
import { macPaths } from '../paths.js';
import { pinDir } from './pin.js';
import { certifiedWorkflows } from './registry.js';

export interface WorkflowGcReport {
  removed: string[];
  kept: Array<{ dir: string; reason: 'current' | 'in_use' | 'recent' }>;
}

/** `reap` chỉ dọn bản ghim cũ tối đa mỗi giờ một lần. */
export const WORKFLOW_GC_INTERVAL_MS = 60 * 60 * 1000;
/** Bản ghim cũ vừa đổi trong khoảng này vẫn được giữ (run vừa kết thúc, hoặc owner vừa nâng bản). */
export const WORKFLOW_GC_RECENT_MS = 24 * 60 * 60 * 1000;
/** Dấu `.in_use` cũ hơn tuổi này (theo mtime, tức giờ run ghi dấu) bị xóa, kể cả khi pid còn sống hay dấu hỏng. */
export const IN_USE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Tên thư mục ghim: `<version>-<12 hex của revision>`. Thứ khác dưới `workflows/<id>/` không phải của crew-mac. */
const PIN_DIR_NAME = /^.+-[0-9a-f]{12}$/;
/** Dấu ghi bởi wrapper: `<pid> <started>`. */
const MARK = /^(\d+) \d+$/;

export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isDirectory(path: string): boolean {
  try {
    const st = lstatSync(path);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Duyệt các dấu `.in_use/<runId>` của một bản ghim: xóa dấu có pid đã chết hoặc cũ hơn `IN_USE_MAX_AGE_MS` (pid có thể
 * đã cấp lại cho process khác; dấu hỏng cũng theo tuổi này) và trả về có còn run nào dùng không. Lỗi đọc dấu thì coi
 * như còn dùng, vì không chứng minh được run đã xong.
 */
function reapMarks(dir: string, now: number, isAlive: (pid: number) => boolean): boolean {
  const marksDir = join(dir, '.in_use');
  let names: string[];
  try {
    names = readdirSync(marksDir);
  } catch {
    return false;
  }
  let inUse = false;
  for (const name of names) {
    const mark = join(marksDir, name);
    try {
      const fresh = now - statSync(mark).mtimeMs < IN_USE_MAX_AGE_MS;
      const m = MARK.exec(readFileSync(mark, 'utf8').trim());
      const alive = fresh && (m === null || isAlive(Number(m[1])));
      if (alive) inUse = true;
      else unlinkSync(mark);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') inUse = true;
    }
  }
  return inUse;
}

/**
 * Lần đổi gần nhất của một bản ghim: mtime lớn nhất của thư mục, của `.in_use/` và của từng dấu trong đó. Ghi hay xóa
 * dấu chỉ đổi mtime của `.in_use/`, không đổi mtime thư mục ghim, nên phải tính cả hai để run vừa chạy làm bản đó
 * "mới".
 */
function lastChangeMs(dir: string): number {
  let latest = statSync(dir).mtimeMs;
  const marksDir = join(dir, '.in_use');
  try {
    latest = Math.max(latest, lstatSync(marksDir).mtimeMs);
    for (const name of readdirSync(marksDir)) {
      try {
        latest = Math.max(latest, lstatSync(join(marksDir, name)).mtimeMs);
      } catch {}
    }
  } catch {}
  return latest;
}

/**
 * Dọn bản workflow ghim cũ dưới `~/.crew/workflows/<id>/`. Giữ bản hiện hành của từng workflow, bản còn dấu `.in_use`
 * của run sống và bản vừa đổi trong 24 giờ (`lastChangeMs`, đo trước khi xóa dấu); không đụng `*.tmp-*` (việc của
 * lệnh cài) hay tên lạ.
 */
export function gcWorkflowPins(
  ctx: MacContext,
  opts: { isAlive?: (pid: number) => boolean } = {},
): WorkflowGcReport {
  const isAlive = opts.isAlive ?? processExists;
  const now = ctx.now().getTime();
  const report: WorkflowGcReport = { removed: [], kept: [] };
  for (const w of certifiedWorkflows(ctx)) {
    const current = pinDir(ctx.home, w.pin);
    const parent = join(macPaths(ctx.home).workflowsRoot, w.id);
    let names: string[];
    try {
      names = readdirSync(parent).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = join(parent, name);
      if (dir === current) {
        report.kept.push({ dir, reason: 'current' });
        continue;
      }
      if (name.includes('.tmp-') || !PIN_DIR_NAME.test(name) || !isDirectory(dir)) continue;
      let mtime: number;
      try {
        mtime = lastChangeMs(dir);
      } catch {
        continue;
      }
      if (reapMarks(dir, now, isAlive)) {
        report.kept.push({ dir, reason: 'in_use' });
      } else if (now - mtime < WORKFLOW_GC_RECENT_MS) {
        report.kept.push({ dir, reason: 'recent' });
      } else {
        rmSync(dir, { recursive: true, force: true });
        report.removed.push(dir);
      }
    }
  }
  return report;
}

/** Các dòng `Đã dọn: <n> bản ghim cũ` kèm từng thư mục (lệnh `workflows gc`). */
export function gcReportLines(report: WorkflowGcReport): string[] {
  return [`Đã dọn: ${report.removed.length} bản ghim cũ`, ...report.removed.map((dir) => `  ${dir}`)];
}

/** Dọn bản cũ sau khi cài; lỗi dọn không làm hỏng việc cài đã xong. */
export function gcAfterInstall(ctx: MacContext): void {
  try {
    const report = gcWorkflowPins(ctx);
    if (report.removed.length > 0) for (const line of gcReportLines(report)) ctx.out(line);
  } catch (error) {
    ctx.out(`Không dọn được bản ghim cũ: ${error instanceof Error ? error.message : String(error)}`);
  }
}
