import { createRunner, DEFAULT_PORT, macPaths, readManifest } from '@crew/mac';
import type { AppContext } from '../app-context.js';
import { paperclipClient } from '../paperclip/register.js';
import type { SshdSupervisor } from '../sshd/supervisor.js';
import { readLogSince } from '../sshd/system-deps.js';
import { defaultProbes, detectFullDiskAccess, diskAccessOutcome } from './disk-access.js';
import { detectExisting } from './import-existing.js';
import { checkMachine, summarizeMachineCheck } from './machine-check.js';
import { createMachineStep } from './machine-step.js';
import { handoffSshd, listenerPids } from './sshd-handoff.js';
import { isRecord } from './types.js';
import { createDoctorStep, createPaperclipStep, createWizard } from './wizard.js';

/**
 * Wizard cài đặt lần đầu (kênh `setup:*`). `health.run` làm mới chấm màu tray sau khi đổi chủ sshd và sau khi
 * kiểm cuối. Bước `v2` và `move` (gỡ app v2, chuyển vào Applications) do AP-6 thêm vào `steps`.
 */
export function registerSetup(
  ctx: AppContext,
  sshd: SshdSupervisor,
  health: { run(probe: boolean): Promise<unknown> },
): void {
  const runner = createRunner();
  const paths = macPaths(ctx.home);
  const refreshHealth = () => {
    health.run(false).catch(() => undefined);
  };
  const detect = () => detectExisting({ home: ctx.home, runner });
  const manifest = () => {
    try {
      return readManifest(paths.manifest);
    } catch {
      return null;
    }
  };

  const wizard = createWizard({
    store: ctx.store,
    loginItem: ctx.loginItem,
    steps: {
      check: async () => {
        const result = await checkMachine(runner);
        return { ok: result.ok, message: summarizeMachineCheck(result) };
      },
      paperclip: createPaperclipStep({ store: ctx.store, companies: () => paperclipClient(ctx).companies() }),
      machine: createMachineStep({
        ops: ctx.ops,
        home: ctx.home,
        resourcesPath: ctx.resourcesPath,
        detect,
        store: ctx.store,
      }),
      // Dò bằng đọc file, không bao giờ gây hộp thoại; `recheck` chỉ hỏi trạng thái, không đi tiếp.
      diskAccess: async (input) =>
        diskAccessOutcome(
          detectFullDiskAccess(defaultProbes(ctx.home)),
          isRecord(input) && input.recheck === true,
        ),
      sshd: async () => {
        const result = await handoffSshd({
          ops: ctx.ops,
          supervisor: sshd,
          store: ctx.store,
          readOwner: () => manifest()?.sshdOwner ?? 'launchd',
          port: () => manifest()?.port ?? DEFAULT_PORT,
          listenerPids: (port) => listenerPids(runner, port),
          readLogTail: (lines) =>
            readLogSince(paths.sshdLog, 0).split('\n').filter(Boolean).slice(-lines).join('\n'),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
        });
        refreshHealth();
        return result;
      },
      doctor: createDoctorStep({ ops: ctx.ops, refreshHealth }),
    },
  });

  ctx.ipc.handle('setup:state', () => wizard.state());
  ctx.ipc.handle('setup:step', (step, input) => wizard.step(step, input));
  ctx.ipc.handle('setup:detect', () => detect());
}
