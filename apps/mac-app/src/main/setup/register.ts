import { existsSync } from 'node:fs';
import { createRunner, DEFAULT_PORT, macPaths, readManifest } from '@crew/mac';
import { app, shell } from 'electron';
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
import { createMoveStep, createV2Step, detectV2, type V2Deps } from './v2-removal.js';
import { createDoctorStep, createPaperclipStep, createWizard } from './wizard.js';

/**
 * Wizard cài đặt lần đầu (kênh `setup:*`). `health.run` làm mới chấm màu tray sau khi đổi chủ sshd và sau khi
 * kiểm cuối. Bước `v2` chỉ gỡ app 2P Crew cũ trong Applications (Thùng rác, mục đăng nhập, quyền TCC), không đụng
 * dữ liệu v2 của owner; bước `move` chuyển app này vào Applications sau đó.
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

  const v2Deps: V2Deps = {
    applicationsDir: '/Applications',
    runner,
    exists: existsSync,
    trashItem: (path) => shell.trashItem(path),
    selfPid: process.pid,
  };

  const wizard = createWizard({
    store: ctx.store,
    loginItem: ctx.loginItem,
    steps: {
      check: async () => {
        const result = await checkMachine(runner);
        return { ok: result.ok, message: summarizeMachineCheck(result) };
      },
      v2: createV2Step(v2Deps),
      move: createMoveStep({
        isPackaged: app.isPackaged,
        isInApplicationsFolder: () => app.isInApplicationsFolder(),
        moveToApplicationsFolder: (options) => app.moveToApplicationsFolder(options),
        detect: () => detectV2(v2Deps),
      }),
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
  ctx.ipc.handle('setup:v2Detect', () => detectV2(v2Deps));
}
