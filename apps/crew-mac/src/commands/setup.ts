import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parsePublicKey, upsertKey } from '../authorized-keys.js';
import { type MacContext, SetupError } from '../context.js';
import { readText, writeIfChanged } from '../fs-util.js';
import { bootout, bootstrap, guiSessionAvailable, serviceState } from '../launchctl.js';
import { renderLauncher } from '../launcher.js';
import { type Manifest, readManifest, writeManifest } from '../manifest.js';
import {
  DEFAULT_PORT,
  DOCTOR_KEY_COMMENT,
  forbiddenRootReason,
  type MacPaths,
  macPaths,
  PAPERCLIP_KEY_COMMENT,
  REAPER_LABEL,
  SPIKE_LABEL,
  SSHD_LABEL,
  STATUS_LABEL,
} from '../paths.js';
import { type PlistSpec, renderPlist } from '../plist.js';
import { renderSshdConfig } from '../sshd-config.js';
import {
  currentSshdOwner,
  handOffToApp,
  prepareTakeBack,
  resolveSshdOwner,
  type SshdOwner,
  takeBackToLaunchd,
} from '../sshd-owner.js';
import { tailscaleIpv4 } from '../tailscale.js';
import { installBmadPin } from '../workflows/bmad-install.js';
import { installSuperpowersPin } from '../workflows/install.js';
import { agentExtraArgs } from '../workflows/pin.js';
import { gcAfterInstall } from '../workflows/workflow-gc.js';
import { WRAPPER_SOURCE } from '../wrapper.js';
import { upsertPathBlock } from '../zshenv.js';
import { saveConfiguredClaudePath } from './status.js';
import { assertNoLiveRuns } from './uninstall.js';

export interface SetupOptions {
  paperclipKey?: string;
  port?: number;
  worktreeRoot?: string;
  /** Không truyền thì giữ chủ sshd trong manifest (cài mới: `launchd`). */
  sshdOwner?: SshdOwner;
  /** Đổi chủ sshd dù còn run hay phiên SSH đang chạy (bootout có thể cắt phiên). */
  force?: boolean;
}

export interface SetupReport {
  changed: string[];
  restarted: string[];
  manifest: Manifest;
  /** Thư mục Superpowers đã ghim và `adapterConfig.extraArgs` tương ứng cho agent claude_local. */
  superpowers: { dir: string; extraArgs: string[] };
  /** Thư mục BMAD đã ghim và `extraArgs` cho agent vai bmad. */
  bmad: { dir: string; extraArgs: string[] };
  /** Lần chạy này chuyển sshd agent sang app, về LaunchAgent, hay giữ nguyên chủ. */
  sshdHandoff: 'app' | 'launchd' | 'unchanged';
}

/** Chờ listener của app thoát sau khi manifest đổi sang `launchd`, trước khi bootstrap LaunchAgent. */
const TAKE_BACK_WAIT_MS = 15_000;

/**
 * Key của Paperclip và của doctor chỉ vào được từ dải Tailscale và không mở được forwarding (driver SSH của Paperclip
 * không dùng forwarding).
 */
export const KEY_OPTIONS = 'from="100.64.0.0/10",no-port-forwarding,no-agent-forwarding,no-X11-forwarding';
export const DOCTOR_KEY_OPTIONS = KEY_OPTIONS;

export function sshdPlistSpec(paths: MacPaths): PlistSpec {
  return {
    label: SSHD_LABEL,
    programArguments: ['/usr/sbin/sshd', '-D', '-f', paths.sshdConfig, '-E', paths.sshdLog],
    keepAlive: true,
    aquaOnly: true,
    processType: 'Interactive',
  };
}

export function reaperPlistSpec(ctx: MacContext, paths: MacPaths): PlistSpec {
  return {
    label: REAPER_LABEL,
    programArguments: [ctx.nodePath, ctx.cliPath, 'reap'],
    keepAlive: false,
    startIntervalSec: 60,
    aquaOnly: true,
    processType: 'Background',
    stdoutPath: paths.reaperLog,
    stderrPath: paths.reaperLog,
  };
}

export function statusPlistSpec(ctx: MacContext, paths: MacPaths): PlistSpec {
  return {
    label: STATUS_LABEL,
    programArguments: [ctx.nodePath, ctx.cliPath, 'status', 'send'],
    keepAlive: false,
    startIntervalSec: 60,
    aquaOnly: true,
    processType: 'Background',
    stdoutPath: paths.statusLog,
    stderrPath: paths.statusLog,
  };
}

async function ensureKeyPair(
  ctx: MacContext,
  path: string,
  comment: string,
  changed: string[],
): Promise<void> {
  if (existsSync(path) && existsSync(`${path}.pub`)) return;
  const result = await ctx.runner.run(
    'ssh-keygen',
    ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', path],
    {
      timeoutMs: 20_000,
    },
  );
  if (result.code !== 0) throw new SetupError(`ssh-keygen ${path} lỗi: ${result.stderr.trim()}`);
  changed.push(path);
}

function publicKeyOf(path: string): string {
  const { type, body } = parsePublicKey(readFileSync(`${path}.pub`, 'utf8'));
  return `${type} ${body}`;
}

/** Nạp lại service khi config đổi, hoặc khi chưa nạp/chưa chạy. Trả true nếu đã bootstrap. */
export async function ensureService(
  ctx: MacContext,
  label: string,
  plistPath: string,
  mustReload: boolean,
  requireRunning: boolean,
): Promise<boolean> {
  const state = await serviceState(ctx.runner, ctx.uid, label);
  const healthy = requireRunning ? state.running : state.loaded;
  if (healthy && !mustReload) return false;
  if (state.loaded) await bootout(ctx.runner, ctx.uid, label);
  await bootstrap(ctx.runner, ctx.uid, plistPath);
  return true;
}

export async function setup(ctx: MacContext, options: SetupOptions = {}): Promise<SetupReport> {
  if (ctx.platform !== 'darwin') throw new SetupError('crew-mac chỉ chạy trên macOS.');
  const paths = macPaths(ctx.home);
  if (!(await guiSessionAvailable(ctx.runner, ctx.uid))) {
    throw new SetupError(
      'Không thấy phiên desktop (Aqua) của user này. Đăng nhập màn hình Mac rồi chạy lại lệnh trong Terminal của phiên đó.',
    );
  }
  if ((await serviceState(ctx.runner, ctx.uid, SPIKE_LABEL)).loaded) {
    throw new SetupError(
      `LaunchAgent spike ${SPIKE_LABEL} vẫn đang chạy và giữ cổng sshd. Chạy "crew-mac uninstall" trong Terminal trên màn hình Mac rồi setup lại.`,
    );
  }
  const listenAddress = await tailscaleIpv4(ctx.runner);
  if (!listenAddress) {
    throw new SetupError(
      'Không lấy được IP Tailscale ("tailscale ip -4"). Mở app Tailscale, đăng nhập rồi chạy lại.',
    );
  }
  const previous = readManifest(paths.manifest);
  const keyText = options.paperclipKey ?? previous?.paperclipKey;
  if (!keyText) {
    throw new SetupError(
      'Thiếu --paperclip-key (public key SSH của Paperclip: file .pub hoặc chuỗi "ssh-ed25519 AAAA...").',
    );
  }
  const key = parsePublicKey(keyText);
  const paperclipKey = `${key.type} ${key.body}`;
  const port = options.port ?? previous?.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new SetupError(`Cổng ${port} không hợp lệ (cần 1024–65535).`);
  }
  const worktreeRoot = resolve(options.worktreeRoot ?? previous?.worktreeRoot ?? paths.defaultWorktreeRoot);
  const forbidden = forbiddenRootReason(ctx.home, worktreeRoot);
  if (forbidden) throw new SetupError(`${worktreeRoot}: ${forbidden}.`);
  // Tính trước khi ghi gì: khối PATH hỏng trong ~/.zshenv thì dừng khi máy còn nguyên.
  // Thư mục của node mà launcher và reaper dùng (symlink ổn định của Homebrew nếu có) cũng vào PATH của sshd agent.
  const zshenvNext = upsertPathBlock(readText(paths.zshenv), dirname(ctx.nodePath));
  const sshdOwner = resolveSshdOwner(previous, options.sshdOwner);
  const switchingOwner = sshdOwner !== currentSshdOwner(previous);
  // Đổi chủ sshd (bootout hoặc TERM listener) có thể cắt phiên của run: chỉ làm khi 0 run, trừ khi force.
  if (switchingOwner && !options.force) await assertNoLiveRuns(ctx);
  const manifest: Manifest = {
    version: 1,
    port,
    listenAddress,
    worktreeRoot,
    paperclipKey,
    installedAt: previous?.installedAt ?? ctx.now().toISOString(),
    ...(sshdOwner === 'app' ? { sshdOwner } : {}),
  };

  const changed: string[] = [];
  const track = (path: string, didChange: boolean) => {
    if (didChange) changed.push(path);
  };
  // Trước mọi file khác: owner chưa cài đúng bản Superpowers, hay không lấy được BMAD, thì dừng khi máy còn nguyên
  // (chỉ có thể đã thêm bản ghim dưới ~/.crew/workflows). Superpowers trước BMAD.
  const pin = installSuperpowersPin(ctx);
  track(pin.dir, pin.changed);
  const bmad = await installBmadPin(ctx);
  track(bmad.dir, bmad.source !== 'existing');
  mkdirSync(paths.sshdDir, { recursive: true, mode: 0o700 });
  mkdirSync(paths.reaperDir, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(paths.statusLog), { recursive: true, mode: 0o700 });
  await ensureKeyPair(ctx, paths.hostKey, 'crew-mac-host', changed);
  await ensureKeyPair(ctx, paths.doctorKey, DOCTOR_KEY_COMMENT, changed);

  const sshdConfig = renderSshdConfig({
    port,
    listenAddress,
    hostKey: paths.hostKey,
    pidFile: paths.sshdPid,
    authorizedKeysFile: paths.authorizedKeys,
    user: ctx.user,
  });
  track(paths.sshdConfig, writeIfChanged(paths.sshdConfig, sshdConfig, 0o600));
  track(
    paths.knownHosts,
    writeIfChanged(paths.knownHosts, `[${listenAddress}]:${port} ${publicKeyOf(paths.hostKey)}\n`, 0o600),
  );
  let keys = upsertKey(readText(paths.authorizedKeys), paperclipKey, PAPERCLIP_KEY_COMMENT, KEY_OPTIONS);
  keys = upsertKey(keys, publicKeyOf(paths.doctorKey), DOCTOR_KEY_COMMENT, DOCTOR_KEY_OPTIONS);
  track(paths.authorizedKeys, writeIfChanged(paths.authorizedKeys, keys, 0o600, { keepExistingMode: true }));
  track(paths.zshenv, writeIfChanged(paths.zshenv, zshenvNext, 0o644, { keepExistingMode: true }));
  track(paths.wrapper, writeIfChanged(paths.wrapper, readFileSync(WRAPPER_SOURCE, 'utf8'), 0o755));
  track(paths.launcher, writeIfChanged(paths.launcher, renderLauncher(ctx.nodePath, ctx.cliPath), 0o755));
  if (!existsSync(worktreeRoot)) {
    mkdirSync(worktreeRoot, { recursive: true, mode: 0o700 });
    changed.push(worktreeRoot);
  }

  const restarted: string[] = [];
  let sshdHandoff: SetupReport['sshdHandoff'] = 'unchanged';
  if (sshdOwner === 'app') {
    // Thứ tự để chết giữa chừng vẫn tự hồi phục: manifest `app` trước (app thấy và sinh listener khi cổng trống; lần
    // chạy sau thấy chủ `app` và gỡ nốt LaunchAgent), rồi xóa plist, rồi bootout. Không bao giờ để lại cổng trống mà
    // manifest nói `launchd`. Bootout không gỡ được job thì trả manifest cũ (plist đã được trả lại): chủ cũ giữ nguyên.
    const plistExisted = existsSync(paths.sshdPlist);
    const manifestBefore = existsSync(paths.manifest) ? readFileSync(paths.manifest) : null;
    const manifestChanged = writeManifest(paths.manifest, manifest);
    let handedOff: boolean;
    try {
      handedOff = await handOffToApp(ctx, paths);
    } catch (err) {
      if (manifestChanged) {
        if (manifestBefore === null) rmSync(paths.manifest, { force: true });
        else writeFileSync(paths.manifest, manifestBefore, { mode: 0o600 });
      }
      throw err;
    }
    if (handedOff || switchingOwner) sshdHandoff = 'app';
    track(paths.sshdPlist, plistExisted);
    track(paths.manifest, manifestChanged);
  } else {
    if (switchingOwner) {
      // Biết cổng thuộc ai TRƯỚC khi ghi manifest: pidfile trỏ process lạ mà cổng bị giữ thì dừng khi app còn là chủ.
      const mustWait = await prepareTakeBack(ctx, paths, port);
      // Ghi manifest để app thấy `launchd` và tự dừng listener, rồi mới chờ và nạp LaunchAgent.
      track(paths.manifest, writeManifest(paths.manifest, manifest));
      if (mustWait) await takeBackToLaunchd(ctx, paths, { waitMs: TAKE_BACK_WAIT_MS });
      sshdHandoff = 'launchd';
    }
    const sshdPlistChanged = writeIfChanged(paths.sshdPlist, renderPlist(sshdPlistSpec(paths)), 0o644);
    track(paths.sshdPlist, sshdPlistChanged);
    const sshdReload =
      sshdPlistChanged || changed.includes(paths.sshdConfig) || changed.includes(paths.hostKey);
    if (await ensureService(ctx, SSHD_LABEL, paths.sshdPlist, sshdReload, true)) restarted.push(SSHD_LABEL);
  }
  const reaperPlistChanged = writeIfChanged(
    paths.reaperPlist,
    renderPlist(reaperPlistSpec(ctx, paths)),
    0o644,
  );
  track(paths.reaperPlist, reaperPlistChanged);
  if (await ensureService(ctx, REAPER_LABEL, paths.reaperPlist, reaperPlistChanged, false))
    restarted.push(REAPER_LABEL);
  const statusPlistChanged = writeIfChanged(
    paths.statusPlist,
    renderPlist(statusPlistSpec(ctx, paths)),
    0o644,
  );
  track(paths.statusPlist, statusPlistChanged);
  if (await ensureService(ctx, STATUS_LABEL, paths.statusPlist, statusPlistChanged, false))
    restarted.push(STATUS_LABEL);

  if (writeManifest(paths.manifest, manifest) && !changed.includes(paths.manifest))
    changed.push(paths.manifest);
  saveConfiguredClaudePath(ctx);
  gcAfterInstall(ctx);
  return {
    changed,
    restarted,
    manifest,
    superpowers: { dir: pin.dir, extraArgs: agentExtraArgs(pin.dir) },
    bmad: { dir: bmad.dir, extraArgs: agentExtraArgs(bmad.dir) },
    sshdHandoff,
  };
}
