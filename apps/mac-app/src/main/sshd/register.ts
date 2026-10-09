import { setTimeout as sleep } from 'node:timers/promises';
import { createRunner } from '@crew/mac';
import { app, dialog } from 'electron';
import type { AppContext } from '../app-context.js';
import {
  choiceFromButton,
  installQuitGuard,
  QUIT_BUTTONS,
  QUIT_CANCEL_ID,
  QUIT_DEFAULT_ID,
  quitMessage,
} from '../quit-guard.js';
import { createSshdSupervisor, type SshdSupervisor } from './supervisor.js';
import { createSystemDeps } from './system-deps.js';

/**
 * Bật bộ giám sát sshd (theo manifest crew-mac) và quit guard. Trả supervisor cho màn hình Run/Sức khỏe và updater.
 */
export function registerSshd(ctx: AppContext): SshdSupervisor {
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

  installQuitGuard({
    onBeforeQuit: (handler) => app.on('before-quit', handler),
    quit: () => app.quit(),
    ask: async (runs) => {
      const { message, detail } = quitMessage(runs);
      const result = await dialog.showMessageBox({
        type: 'warning',
        buttons: [...QUIT_BUTTONS],
        defaultId: QUIT_DEFAULT_ID,
        cancelId: QUIT_CANCEL_ID,
        noLink: true,
        message,
        detail,
      });
      return choiceFromButton(result.response);
    },
    activeRuns: async () => (await supervisor.activeRuns()).length,
    stopForQuit: () => supervisor.stopForQuit(),
    pause: () => supervisor.pause(),
    resume: () => supervisor.resume(),
    showWaiting: (runs) => ctx.tray.update({ color: 'yellow', runs }),
    sleep: (ms) => sleep(ms),
    log: ctx.log,
  });

  void supervisor.start().catch((error) =>
    ctx.log('error', 'sshd-start-failed', {
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return supervisor;
}
