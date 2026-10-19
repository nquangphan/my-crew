import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { removeKeysByComment } from '../authorized-keys.js';
import { type MacContext, SetupError } from '../context.js';
import { readText, writeIfChanged } from '../fs-util.js';
import { bootout, serviceState } from '../launchctl.js';
import { type Manifest, readManifest } from '../manifest.js';
import {
  DOCTOR_KEY_COMMENT,
  macPaths,
  PAPERCLIP_KEY_COMMENT,
  REAPER_LABEL,
  SPIKE_KEY_COMMENT,
  SPIKE_LABEL,
  SSHD_LABEL,
  STATUS_LABEL,
} from '../paths.js';
import { listProcesses, type ProcInfo } from '../reaper/process-table.js';
import { descendants, isClaudeExe } from '../reaper/run-members.js';
import { runtimePaths } from '../runtimes/paths.js';
import { currentSshdOwner, isCrewListener, readSshdPid } from '../sshd-owner.js';
import { RUN_MARK_SOURCE } from '../wrapper.js';
import { removePathBlock, removeSpikePathLines } from '../zshenv.js';

export interface UninstallReport {
  removed: string[];
  kept: string[];
  /** Việc crew-mac cố ý không làm (chỉ có khi cần báo). */
  notes?: string[];
}

function manifestOrNull(path: string): Manifest | null {
  try {
    return readManifest(path);
  } catch {
    return null;
  }
}

const FORCE_NOTE = '--force bỏ qua CẢ kiểm phiên sshd agent LẪN kiểm run Paperclip.';

function exeName(p: ProcInfo): string {
  return basename(p.command.split(/\s+/)[0] ?? '');
}

/**
 * claude (cả bản `…/claude/versions/<bản>`) ở chế độ --print/-p, hoặc node chạy script claude (claude cài bằng npm)
 * ở chế độ đó. `node -p "<expr>"` là cờ eval của node, không phải claude: cần có token chứa "claude" trước cờ.
 */
function isPrintAgent(p: ProcInfo): boolean {
  const tokens = p.command.split(/\s+/);
  const printAt = tokens.findIndex((t) => t === '--print' || t === '-p');
  if (printAt < 0) return false;
  if (isClaudeExe(p)) return true;
  return exeName(p) === 'node' && tokens.slice(1, printAt).some((t) => /claude/.test(t));
}

export interface UninstallScan {
  /** Run id đọc được từ env của process --print. */
  runIds: string[];
  /** Process --print không tty mà không đọc được env: không chắc có phải run Paperclip. */
  unknownPids: number[];
  /** Process con cháu của sshd agent (phiên SSH đang mở, thường là run đang chạy). */
  sshdSessionPids: number[];
}

/**
 * Quét theo hướng fail-closed: ngoài run id đọc được, coi là "không chắc" mọi process --print không tty mà env
 * không đọc được, và mọi con cháu của sshd agent (tín hiệu không phụ thuộc env).
 */
export async function scanUninstallBlockers(ctx: MacContext): Promise<UninstallScan> {
  const procs = await listProcesses(ctx.runner);
  const runIds = new Set<string>();
  const unknownPids: number[] = [];
  for (const p of procs) {
    if (!isPrintAgent(p)) continue;
    if (p.runId !== null) runIds.add(p.runId);
    else if (p.tty === '??' && !p.envReadable) unknownPids.push(p.pid);
  }
  const listeners: number[] = [];
  for (const label of [SSHD_LABEL, SPIKE_LABEL]) {
    const { pid } = await serviceState(ctx.runner, ctx.uid, label);
    if (pid !== null) listeners.push(pid);
  }
  // Listener do app 2P Crew giữ không phải job launchd: tìm theo pidfile, chỉ khi argv đúng listener của crew-mac.
  const paths = macPaths(ctx.home);
  const appListener = readSshdPid(paths.sshdPid);
  const appListenerProc = procs.find((p) => p.pid === appListener);
  if (appListenerProc && isCrewListener(appListenerProc.command, paths.sshdConfig))
    listeners.push(appListenerProc.pid);
  const sshdSessionPids = new Set<number>();
  for (const pid of listeners) {
    for (const child of descendants(pid, procs)) if (child !== pid) sshdSessionPids.add(child);
  }
  return {
    runIds: [...runIds].sort(),
    unknownPids,
    sshdSessionPids: [...sshdSessionPids].sort((x, y) => x - y),
  };
}

export async function assertNoLiveRuns(ctx: MacContext): Promise<void> {
  let scan: UninstallScan;
  try {
    scan = await scanUninstallBlockers(ctx);
  } catch (err) {
    throw new SetupError(
      `Không đọc được bảng process (${err instanceof Error ? err.message : String(err)}); ` +
        `không chắc còn run nào đang chạy. ${FORCE_NOTE}`,
    );
  }
  const reasons: string[] = [];
  if (scan.runIds.length > 0)
    reasons.push(
      `còn ${scan.runIds.length} run Paperclip đang chạy trên máy này (${scan.runIds.join(', ')})`,
    );
  if (scan.sshdSessionPids.length > 0)
    reasons.push(`còn phiên SSH qua sshd agent (pid ${scan.sshdSessionPids.join(', ')})`);
  if (scan.unknownPids.length > 0)
    reasons.push(
      `còn claude/node --print không tty mà không đọc được env nên không chắc có phải run Paperclip (pid ${scan.unknownPids.join(', ')})`,
    );
  if (reasons.length > 0) {
    throw new SetupError(
      `${reasons.join('; ')}. Hủy hoặc chờ các run xong trên Paperclip (nên tạm dừng agent) rồi chạy lại. ${FORCE_NOTE}`,
    );
  }
}

/**
 * Đối chiếu auth.json của từng agent Codex với ~/.codex/auth.json bằng đúng hàm của wrapper
 * (`crew_codex_auth_reconcile` trong crew-run-mark.sh), trước khi xóa ~/.crew/runtimes. Trả danh sách agent không
 * chắc (kèm lý do); không bao giờ chứa nội dung token.
 */
export function reconcileCodexAuth(home: string): string[] {
  const codexRoot = join(runtimePaths(home).runtimesRoot, 'codex');
  if (!existsSync(codexRoot)) return [];
  const owner = join(home, '.codex', 'auth.json');
  const unsure: string[] = [];
  for (const agent of readdirSync(codexRoot)) {
    const mine = join(codexRoot, agent, 'auth.json');
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(mine);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const r = spawnSync(
      '/bin/sh',
      [
        '-c',
        '. "$1" && crew_codex_auth_reconcile "$2" "$3" || { printf %s "$auth_reason" >&2; exit 1; }',
        'sh',
        RUN_MARK_SOURCE,
        mine,
        owner,
      ],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) unsure.push(`${mine} (${r.stderr.trim() || 'không đối chiếu được'})`);
  }
  return unsure;
}

export async function uninstall(
  ctx: MacContext,
  options: { force?: boolean } = {},
): Promise<UninstallReport> {
  if (ctx.platform !== 'darwin') throw new SetupError('crew-mac chỉ chạy trên macOS.');
  if (!options.force) await assertNoLiveRuns(ctx);
  const paths = macPaths(ctx.home);
  const manifest = manifestOrNull(paths.manifest);
  // Kiểm ~/.zshenv trước mọi thao tác: khối hỏng thì dừng khi chưa gỡ gì.
  const zshenvNext = existsSync(paths.zshenv)
    ? removeSpikePathLines(removePathBlock(readText(paths.zshenv)))
    : null;
  const removed: string[] = [];
  const appOwnsSshd = currentSshdOwner(manifest) === 'app';
  const notes = appOwnsSshd ? ['sshd do app 2P Crew giữ: thoát app để dừng'] : [];

  // Chế độ app: không bootout sshd và không đụng listener của app (app tự dừng khi thoát).
  const labels = [STATUS_LABEL, REAPER_LABEL, ...(appOwnsSshd ? [] : [SSHD_LABEL]), SPIKE_LABEL];
  for (const label of labels) {
    if (await bootout(ctx.runner, ctx.uid, label)) removed.push(`LaunchAgent ${label}`);
  }
  for (const file of [paths.statusPlist, paths.reaperPlist, paths.sshdPlist, paths.spikePlist]) {
    if (existsSync(file)) {
      rmSync(file);
      removed.push(file);
    }
  }
  if (existsSync(paths.authorizedKeys)) {
    let keys = readText(paths.authorizedKeys);
    for (const comment of [PAPERCLIP_KEY_COMMENT, DOCTOR_KEY_COMMENT, SPIKE_KEY_COMMENT]) {
      keys = removeKeysByComment(keys, comment);
    }
    if (writeIfChanged(paths.authorizedKeys, keys, 0o600, { keepExistingMode: true }))
      removed.push(`${paths.authorizedKeys} (key crew-mac và spike)`);
  }
  if (zshenvNext !== null) {
    // File rỗng thì xóa, trừ khi là symlink từ dotfiles của owner: khi đó chỉ làm rỗng file đích.
    if (zshenvNext.trim() === '' && !lstatSync(paths.zshenv).isSymbolicLink()) {
      rmSync(paths.zshenv);
      removed.push(paths.zshenv);
    } else if (writeIfChanged(paths.zshenv, zshenvNext, 0o644, { keepExistingMode: true })) {
      removed.push(`${paths.zshenv} (dòng PATH crew-mac và spike)`);
    }
  }
  const rt = runtimePaths(ctx.home);
  // Đối chiếu token Codex trước khi xóa: bản mới hơn của agent được chép ngược, không chắc thì giữ ~/.crew/runtimes.
  const unsureAuth = reconcileCodexAuth(ctx.home);
  for (const file of [paths.wrapper, rt.codexWrapper, rt.opencodeWrapper, rt.runMark, paths.launcher]) {
    if (existsSync(file)) {
      rmSync(file);
      removed.push(file);
    }
  }
  if (existsSync(paths.crewBin) && readdirSync(paths.crewBin).length === 0)
    rmSync(paths.crewBin, { recursive: true });
  // ~/.crew/runtimes: CODEX_HOME/XDG riêng theo agent; auth.json symlink thì ~/.codex không bị đụng, file thường đã đối chiếu ở trên.
  const keptRuntimes = unsureAuth.length > 0;
  if (keptRuntimes)
    notes.push(
      `giữ ${rt.runtimesRoot}: không chắc auth.json Codex nào mới hơn (${unsureAuth.join('; ')}); so với ~/.codex/auth.json, giữ bản đúng rồi xóa file riêng của agent và chạy lại uninstall`,
    );
  for (const dir of [paths.root, paths.spikeDir, rt.runtimesRoot]) {
    if (keptRuntimes && dir === rt.runtimesRoot) continue;
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    }
  }
  return { removed, kept: manifest ? [manifest.worktreeRoot] : [], ...(notes.length > 0 ? { notes } : {}) };
}
