import { setTimeout as sleep } from 'node:timers/promises';
import { createRunner } from '@crew/mac';
import { app, dialog } from 'electron';
import type { AppContext } from '../app-context.js';
import { choiceFromButton, installQuitGuard, type QuitGuard, quitPrompt } from '../quit-guard.js';
import { createSshdSupervisor, type SshdSupervisor } from './supervisor.js';
import { createSystemDeps } from './system-deps.js';

/** Supervisor kèm hai cửa của quit guard: updater dùng `allowQuitForUpdate`, wizard đổi chủ sshd dùng `holdQuit`. */
export interface SshdRuntime extends SshdSupervisor, QuitGuard {}

/**
 * Bật bộ giám sát sshd (theo manifest crew-mac) và quit guard. Trả supervisor (kèm cửa của quit guard) cho màn hình
 * Run/Sức khỏe, wizard và updater.
 */
export function registerSshd(ctx: AppContext): SshdRuntime {
  const supervisor = createSshdSupervisor(
    createSystemDeps({ home: ctx.home, runner: createRunner(), store: ctx.store, log: ctx.log }),
  );

  let lastLogged = '';
  supervisor.onChange(() => {
    const status = supervisor.status();
    const key = `${status.state}:${status.pid}`;
    if (key === lastLogged) return;
    lastLogged = key;
    ctx.log(status.state === 'backoff' ? 'warn' : 'info', 'sshd-state', { ...status });
  });

  const guard: QuitGuard = installQuitGuard({
    onBeforeQuit: (handler) => app.on('before-quit', handler),
    quit: () => app.quit(),
    ask: async (runs) => {
      const prompt = quitPrompt(runs);
      const result = await dialog.showMessageBox({
        type: 'warning',
        buttons: [...prompt.buttons],
        defaultId: prompt.defaultId,
        cancelId: prompt.cancelId,
        noLink: true,
        message: prompt.message,
        detail: prompt.detail,
      });
      return choiceFromButton(prompt, result.response);
    },
    ownsListener: () => supervisor.status().state !== 'disabled',
    activeRuns: async () => (await supervisor.activeRuns()).length,
    stopForQuit: () => supervisor.stopForQuit(),
    pause: () => supervisor.pause(),
    resume: () => supervisor.resume(),
    showWaiting: (runs) => ctx.tray.update({ runs, waiting: true }),
    hideWaiting: () => ctx.tray.update({ waiting: false }),
    sleep: (ms) => sleep(ms),
    log: ctx.log,
  });

  void supervisor.start().catch((error) =>
    ctx.log('error', 'sshd-start-failed', {
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return Object.assign(supervisor, {
    allowQuitForUpdate: guard.allowQuitForUpdate,
    holdQuit: guard.holdQuit,
  });
}
