import { SetupError } from './context.js';
import type { CommandRunner } from './system.js';

export interface ServiceState {
  loaded: boolean;
  running: boolean;
  pid: number | null;
  lastExitCode: number | null;
}

export async function serviceState(runner: CommandRunner, uid: number, label: string): Promise<ServiceState> {
  const result = await runner.run('launchctl', ['print', `gui/${uid}/${label}`], { timeoutMs: 10_000 });
  if (result.code !== 0) return { loaded: false, running: false, pid: null, lastExitCode: null };
  const pid = /^\s*pid = (\d+)$/m.exec(result.stdout);
  const exit = /^\s*last exit code = (-?\d+)/m.exec(result.stdout);
  return {
    loaded: true,
    running: /^\s*state = running$/m.test(result.stdout),
    pid: pid ? Number(pid[1]) : null,
    lastExitCode: exit ? Number(exit[1]) : null,
  };
}

/** Domain gui/<uid> chỉ tồn tại khi user đang đăng nhập màn hình (phiên Aqua). */
export async function guiSessionAvailable(runner: CommandRunner, uid: number): Promise<boolean> {
  return (await runner.run('launchctl', ['print', `gui/${uid}`], { timeoutMs: 10_000 })).code === 0;
}

export async function bootstrap(runner: CommandRunner, uid: number, plistPath: string): Promise<void> {
  const result = await runner.run('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { timeoutMs: 20_000 });
  if (result.code !== 0) {
    throw new SetupError(`launchctl bootstrap ${plistPath} lỗi (${result.code}): ${result.stderr.trim()}`);
  }
}

/** Trả true nếu service đang nạp và đã được gỡ. */
export async function bootout(runner: CommandRunner, uid: number, label: string): Promise<boolean> {
  return (
    (await runner.run('launchctl', ['bootout', `gui/${uid}/${label}`], { timeoutMs: 20_000 })).code === 0
  );
}
