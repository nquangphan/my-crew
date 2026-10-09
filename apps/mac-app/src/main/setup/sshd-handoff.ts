import type { CommandRunner, SshdOwner } from '@crew/mac';
import type { AppStateStore } from '../app-state.js';
import type { OpsBridge } from '../ops-bridge.js';
import type { SshdSupervisor } from '../sshd/supervisor.js';

export interface SshdHandoffDeps {
  ops: Pick<OpsBridge, 'call'>;
  supervisor: Pick<SshdSupervisor, 'start' | 'status' | 'activeRuns'>;
  store: Pick<AppStateStore, 'update'>;
  /** Chủ sshd theo manifest crew-mac hiện tại. */
  readOwner(): SshdOwner;
  port(): number;
  /** Pid đang nghe cổng. */
  listenerPids(port: number): Promise<number[]>;
  readLogTail(lines: number): string;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Thời hạn chờ listener của app (mặc định 15 giây, Review Focus 2). */
  timeoutMs?: number;
}

export interface HandoffResult {
  ok: boolean;
  message: string;
}

const WAIT_MS = 15_000;
const POLL_MS = 500;
const LOG_LINES = 20;
const MANUAL_ROLLBACK = 'crew-mac setup --sshd-owner launchd';

/** `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`: pid của mọi tiến trình đang nghe cổng. */
export async function listenerPids(runner: Pick<CommandRunner, 'run'>, port: number): Promise<number[]> {
  const result = await runner.run('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    timeoutMs: 10_000,
  });
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .map(Number);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Listener của app lên khi supervisor `running` và cổng chỉ có đúng pid của nó nghe (không có chủ thứ hai). */
async function appListenerUp(deps: SshdHandoffDeps): Promise<boolean> {
  const status = deps.supervisor.status();
  if (status.state !== 'running' || status.pid === null) return false;
  const pids = await deps.listenerPids(deps.port());
  return pids.length === 1 && pids[0] === status.pid;
}

/**
 * Chuyển chủ sshd agent từ LaunchAgent sang app, có tự lui. Từ chối khi còn run (bootout cắt phiên). Sau
 * `setup({ sshdOwner: 'app' })` và `supervisor.start()` chờ tối đa 15 giây cho listener của app; không lên (hoặc
 * `setup` lỗi) thì `setup({ sshdOwner: 'launchd', force: true })` để máy về đúng một chủ, rồi báo lý do kèm đuôi log.
 */
export async function handoffSshd(deps: SshdHandoffDeps): Promise<HandoffResult> {
  const owner = deps.readOwner();
  if (owner === 'app' && (await appListenerUp(deps))) {
    return { ok: true, message: 'sshd đã do 2P Crew giữ và đang nghe cổng.' };
  }

  if (owner !== 'app') {
    const runs = await deps.supervisor.activeRuns();
    if (runs.length > 0) {
      return { ok: false, message: `Có ${runs.length} run đang chạy; chờ run xong rồi chuyển.` };
    }
  }

  let failure: string | null = null;
  try {
    if (owner !== 'app') await deps.ops.call('setup', { sshdOwner: 'app' });
    await deps.supervisor.start();
    const deadline = deps.now() + (deps.timeoutMs ?? WAIT_MS);
    for (;;) {
      if (await appListenerUp(deps)) {
        return { ok: true, message: 'Đã chuyển sshd sang 2P Crew; listener đang nghe cổng.' };
      }
      if (deps.now() >= deadline) break;
      await deps.sleep(POLL_MS);
    }
    const status = deps.supervisor.status();
    failure = `Listener của 2P Crew không lên trong ${(deps.timeoutMs ?? WAIT_MS) / 1000} giây (${status.lastError ?? `trạng thái ${status.state}`}).`;
  } catch (error) {
    failure = `Chuyển sshd sang 2P Crew lỗi: ${errorText(error)}.`;
  }

  try {
    await deps.ops.call('setup', { sshdOwner: 'launchd', force: true });
  } catch (error) {
    return {
      ok: false,
      message: `${failure}\nTự lui về LaunchAgent cũng lỗi: ${errorText(error)}. Mở Terminal chạy "${MANUAL_ROLLBACK}" để đưa sshd về một chủ.`,
    };
  }
  await deps.store.update((state) => ({ ...state, sshdOwner: 'launchd', sshdPid: null }));
  return {
    ok: false,
    message: `${failure}\nĐã tự chuyển sshd về LaunchAgent như cũ.\n${LOG_LINES} dòng cuối sshd.log:\n${deps.readLogTail(LOG_LINES)}`,
  };
}
