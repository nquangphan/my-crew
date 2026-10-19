import { isCrewListener, type ProcInfo, type SshdOwner } from '@crew/mac';
import type { ActiveRun } from '../../shared/ipc-contract.js';
import type { AppStateStore } from '../app-state.js';
import { activeRuns } from './active-runs.js';
import { nextDelayMs, STABLE_RESET_MS } from './backoff.js';
import { type ListenerProc, planListenerTakeover } from './takeover.js';

export type SupervisorState = 'starting' | 'running' | 'backoff' | 'paused' | 'stopped' | 'disabled';

export interface SshdSupervisor {
  /** Tiếp quản: listener cũ khớp argv thì TERM rồi sinh mới, cùng cổng. Manifest chưa giao cho app thì `disabled`. */
  start(): Promise<void>;
  /** TERM listener của mình, không tự sinh lại; phiên đang mở vẫn sống. */
  pause(): Promise<void>;
  /** Sau `pause`, hoặc sau `stopForQuit` khi việc thoát bị hủy: theo dõi cấu hình lại và sinh listener. */
  resume(): Promise<void>;
  /** Như `pause`, dùng khi thoát/cập nhật; thôi theo dõi cấu hình. */
  stopForQuit(): Promise<void>;
  status(): { state: SupervisorState; pid: number | null; restarts: number; lastError: string | null };
  activeRuns(): Promise<ActiveRun[]>;
  onChange(listener: () => void): () => void;
}

export interface SshdExit {
  code: number | null;
  signal: string | null;
  /** Lỗi spawn (ví dụ không chạy được `/usr/sbin/sshd`). */
  error?: Error;
}

export interface SshdChild {
  /** `undefined` khi spawn hỏng; khi đó `onExit` nhận `error`. */
  readonly pid: number | undefined;
  onExit(cb: (exit: SshdExit) => void): void;
}

export interface SupervisorDeps {
  /** `~/.crew-mac/sshd/sshd_config`: chỉ listener có `-f` đúng file này mới bị thay. */
  sshdConfig: string;
  readPidFile(): number | null;
  procInfo(pid: number): Promise<ListenerProc | null>;
  spawnSshd(): SshdChild;
  signal(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void;
  /** Chủ sshd theo manifest crew-mac; ném lỗi khi manifest hỏng. */
  readOwner(): SshdOwner;
  /**
   * Dấu cấu hình listener đang dùng (nội dung `sshd_config` cùng dấu host key); null khi không đọc được (đang ghi
   * dở). Khác dấu lúc sinh thì listener phải nạp lại.
   */
  readListenConfig(): string | null;
  /** Theo dõi manifest, `sshd_config` và host key; trả hàm thôi theo dõi. */
  watchConfig(cb: () => void): () => void;
  sleep(ms: number): Promise<void>;
  now(): number;
  listProcesses(): Promise<ProcInfo[]>;
  readCwds(pids: number[]): Promise<Map<number, string>>;
  store: Pick<AppStateStore, 'update'>;
  /** Mô tả lý do listener thoát (ví dụ cổng bị chiếm, đọc từ `sshd.log`); null thì dùng mã thoát. */
  describeExit?(exit: SshdExit): Promise<string | null>;
  log?(level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>): void;
}

/** Chờ tối đa bấy nhiêu cho listener thoát sau TERM, rồi mới SIGKILL. */
const STOP_WAIT_MS = 5_000;
const POLL_MS = 250;
/** Chờ `crew-mac setup` ghi xong loạt file (sshd_config rồi manifest) trước khi so cấu hình. */
export const CONFIG_SETTLE_MS = 500;

function describeExitCode(exit: SshdExit): string {
  if (exit.error) return `Không chạy được sshd: ${exit.error.message}`;
  if (exit.signal) return `sshd bị dừng bởi ${exit.signal}`;
  return `sshd thoát (mã ${exit.code ?? 'không rõ'})`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Bộ giám sát sshd agent trong Main. Chỉ gửi tín hiệu cho (a) listener do chính nó sinh, (b) listener cũ ở pidfile
 * khi argv khớp `/usr/sbin/sshd … -f <sshdConfig>`. Không bao giờ đụng `sshd-session` (phiên của run).
 */
export function createSshdSupervisor(deps: SupervisorDeps): SshdSupervisor {
  let state: SupervisorState = 'stopped';
  let owner: SshdOwner = 'launchd';
  let child: SshdChild | null = null;
  let spawnedAt = 0;
  let restarts = 0;
  let lastError: string | null = null;
  /** Tăng mỗi lần chủ động dừng/sinh: lần sinh lại đang chờ backoff của thế hệ cũ bị bỏ. */
  let generation = 0;
  let unwatch: (() => void) | null = null;
  /** Dấu cấu hình của listener đang sống (đọc ngay trước khi sinh). */
  let spawnedConfig: string | null = null;
  const exited = new WeakSet<SshdChild>();
  const listeners = new Set<() => void>();
  let queue: Promise<unknown> = Promise.resolve();

  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn);
    queue = next.catch(() => undefined);
    return next;
  };

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        deps.log?.('warn', 'sshd-listener-error', { error: errorMessage(error) });
      }
    }
  };

  const currentPid = () => (child && !exited.has(child) ? (child.pid ?? null) : null);

  const record = async () => {
    const sshdPid = currentPid();
    try {
      await deps.store.update((s) => ({ ...s, sshdPid, sshdOwner: owner }));
    } catch (error) {
      deps.log?.('warn', 'sshd-state-write-failed', { error: errorMessage(error) });
    }
  };

  const setState = async (next: SupervisorState) => {
    state = next;
    await record();
    emit();
  };

  const readOwner = (): SshdOwner | null => {
    try {
      return deps.readOwner();
    } catch (error) {
      lastError = errorMessage(error);
      return null;
    }
  };

  /** TERM listener cũ (không phải con của mình), chờ tối đa 5 giây, còn đúng listener đó thì SIGKILL. */
  const retireOldListener = async (pid: number) => {
    deps.log?.('info', 'sshd-takeover', { pid });
    deps.signal(pid, 'SIGTERM');
    for (let waited = 0; waited < STOP_WAIT_MS; waited += POLL_MS) {
      await deps.sleep(POLL_MS);
      const proc = await deps.procInfo(pid);
      if (proc === null || proc.pid !== pid || !isCrewListener(proc.command, deps.sshdConfig)) return;
    }
    const proc = await deps.procInfo(pid);
    if (proc !== null && proc.pid === pid && isCrewListener(proc.command, deps.sshdConfig)) {
      deps.signal(pid, 'SIGKILL');
    }
  };

  const onChildExit = async (c: SshdChild, gen: number, exit: SshdExit) => {
    exited.add(c);
    if (child !== c) return;
    if (gen !== generation || state === 'paused' || state === 'stopped' || state === 'disabled') {
      await record();
      emit();
      return;
    }
    if (deps.now() - spawnedAt >= STABLE_RESET_MS) restarts = 0;
    const delay = nextDelayMs(restarts);
    restarts += 1;
    let reason: string | null = null;
    try {
      reason = (await deps.describeExit?.(exit)) ?? null;
    } catch {
      reason = null;
    }
    lastError = reason ?? describeExitCode(exit);
    deps.log?.('warn', 'sshd-exited', { code: exit.code, signal: exit.signal, delayMs: delay, lastError });
    if (gen !== generation) return;
    await setState('backoff');
    await deps.sleep(delay);
    await serial(async () => {
      if (gen !== generation || state !== 'backoff') return;
      await spawnListener();
    });
  };

  const spawnListener = async () => {
    generation += 1;
    const gen = generation;
    state = 'starting';
    const configSnapshot = deps.readListenConfig();
    let c: SshdChild;
    try {
      c = deps.spawnSshd();
    } catch (error) {
      c = {
        pid: undefined,
        onExit: (cb) => queueMicrotask(() => cb({ code: null, signal: null, error: error as Error })),
      };
    }
    child = c;
    spawnedAt = deps.now();
    spawnedConfig = configSnapshot;
    c.onExit((exit) => void onChildExit(c, gen, exit));
    if (c.pid !== undefined && !exited.has(c)) {
      deps.log?.('info', 'sshd-spawned', { pid: c.pid });
      await setState('running');
    } else {
      emit();
    }
  };

  /**
   * TERM listener của mình (con trực tiếp, không có nguy cơ pid bị dùng lại khi chưa reap), chờ thoát hẳn; quá 5 giây
   * thì SIGKILL rồi chờ thêm. Phiên `sshd-session` không nhận tín hiệu nào nên vẫn sống.
   */
  const terminateChild = async () => {
    const c = child;
    if (c && c.pid !== undefined && !exited.has(c)) {
      deps.signal(c.pid, 'SIGTERM');
      for (let waited = 0; waited < STOP_WAIT_MS && !exited.has(c); waited += POLL_MS) {
        await deps.sleep(POLL_MS);
      }
      if (!exited.has(c)) {
        deps.signal(c.pid, 'SIGKILL');
        for (let waited = 0; waited < STOP_WAIT_MS && !exited.has(c); waited += POLL_MS) {
          await deps.sleep(POLL_MS);
        }
      }
    }
    child = null;
  };

  const stopListener = async (next: 'paused' | 'stopped' | 'disabled') => {
    generation += 1;
    state = next;
    await terminateChild();
    await setState(next);
  };

  /**
   * Cấu hình đổi (cổng, IP Tailscale, host key): dừng hẳn listener cũ rồi mới sinh listener mới, nên không bao giờ có
   * hai listener của app cùng lúc. Đang backoff thì bỏ lượt chờ cũ và sinh ngay.
   */
  const reloadListener = async () => {
    generation += 1;
    await terminateChild();
    restarts = 0;
    await spawnListener();
  };

  /** Bật theo manifest: không phải app thì `disabled`; là app thì tiếp quản listener cũ rồi sinh mới. */
  const enable = async () => {
    const next = readOwner();
    if (next === null) {
      generation += 1;
      await setState('disabled');
      return;
    }
    owner = next;
    if (next !== 'app') {
      generation += 1;
      await setState('disabled');
      return;
    }
    const pidFromFile = deps.readPidFile();
    const proc = pidFromFile === null ? null : await deps.procInfo(pidFromFile);
    const plan = planListenerTakeover({ pidFromFile, proc, sshdConfig: deps.sshdConfig });
    if (plan.kind === 'replace') await retireOldListener(plan.pid);
    restarts = 0;
    await spawnListener();
  };

  const onConfigChange = async () => {
    await deps.sleep(CONFIG_SETTLE_MS);
    await serial(async () => {
      if (unwatch === null) return;
      const next = readOwner();
      // Manifest đang ghi dở hay hỏng: giữ nguyên, lần đổi sau đọc lại.
      if (next === null) return;
      if (next === 'launchd' && state !== 'disabled') {
        owner = 'launchd';
        deps.log?.('info', 'sshd-owner-launchd', {});
        await stopListener('disabled');
      } else if (next === 'app' && state === 'disabled') {
        await enable();
      } else if (next === 'app' && (state === 'running' || state === 'backoff')) {
        const current = deps.readListenConfig();
        if (current === null || current === spawnedConfig) return;
        deps.log?.('info', 'sshd-config-changed', { pid: currentPid() });
        await reloadListener();
      }
    });
  };

  const watch = () => {
    unwatch ??= deps.watchConfig(
      () =>
        void onConfigChange().catch((error) =>
          deps.log?.('error', 'sshd-config-change-failed', { error: errorMessage(error) }),
        ),
    );
  };

  /** `stopForQuit` đã chạy: còn là `true` tới khi `resume` (thoát bị hủy) hay `start`. */
  let stoppedForQuit = false;

  return {
    start: () =>
      serial(async () => {
        watch();
        stoppedForQuit = false;
        if (state === 'running' || state === 'starting' || state === 'backoff') return;
        await enable();
      }),
    pause: () =>
      serial(async () => {
        if (state === 'disabled' || state === 'paused' || state === 'stopped') return;
        await stopListener('paused');
      }),
    resume: () =>
      serial(async () => {
        if (stoppedForQuit) {
          stoppedForQuit = false;
          watch();
          if (state === 'stopped' || state === 'disabled') await enable();
          return;
        }
        if (state !== 'paused') return;
        await enable();
      }),
    stopForQuit: () =>
      serial(async () => {
        unwatch?.();
        unwatch = null;
        stoppedForQuit = true;
        if (state === 'disabled' || state === 'stopped') return;
        await stopListener('stopped');
      }),
    status: () => {
      if (state === 'running' && deps.now() - spawnedAt >= STABLE_RESET_MS) restarts = 0;
      return { state, pid: currentPid(), restarts, lastError };
    },
    activeRuns: () => activeRuns({ listProcesses: deps.listProcesses, readCwds: deps.readCwds }),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
