import { execFile } from 'node:child_process';
import { app, Notification, shell } from 'electron';
import type { HealthAction } from '../shared/ipc-contract.js';
import type { AppContext } from './app-context.js';
import { createHealth, type Health } from './health.js';
import { createLogs } from './logs.js';
import { createNotifier } from './notifications.js';
import { paperclipClient } from './paperclip/register.js';
import { createRuns } from './runs.js';
import type { SshdSupervisor } from './sshd/supervisor.js';
import type { DotColor } from './tray-state.js';

const TRAY_COLOR = { ok: 'green', warn: 'yellow', fail: 'red' } as const satisfies Record<string, DotColor>;
const RUNS_REFRESH_MS = 30_000;
const PRIVACY_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

/**
 * Màn hình Sức khỏe / Run đang chạy / Log (kênh `health:*`, `runs:*`, `logs:*`) và vòng cập nhật tray:
 * chấm màu theo doctor mỗi 15 phút, số run mỗi 30 giây và mỗi khi trạng thái sshd đổi. Trả `run` để wizard làm mới
 * màu tray ngay sau khi đổi chủ sshd hay kiểm cuối.
 */
export function registerHealth(ctx: AppContext, sshd: SshdSupervisor): Pick<Health, 'run'> {
  const health = createHealth({
    doctor: (opts) => ctx.ops.call('doctor', opts),
    notify: createNotifier({
      isSupported: () => Notification.isSupported(),
      create: (options) => new Notification(options),
    }),
    onResult: (worst) => ctx.tray.update({ color: TRAY_COLOR[worst] }),
    log: ctx.log,
  });
  const runs = createRuns({
    activeRuns: () => sshd.activeRuns(),
    client: () => paperclipClient(ctx),
    openExternal: (url) => shell.openExternal(url),
  });
  const logs = createLogs({ home: ctx.home, reveal: (path) => shell.showItemInFolder(path) });

  const refreshRuns = () => {
    runs
      .list()
      .then((list) => ctx.tray.update({ runs: list.length }))
      .catch(() => ctx.tray.update({ runs: null }));
  };
  sshd.onChange(refreshRuns);
  const runsTimer = setInterval(refreshRuns, RUNS_REFRESH_MS);
  refreshRuns();

  ctx.ipc.handle('health:run', (probe) => health.run(probe === true));
  ctx.ipc.handle('health:last', () => health.last());
  ctx.ipc.handle('health:action', async (action: HealthAction) => {
    if (action === 'open-privacy') await shell.openExternal(PRIVACY_PANE);
    else if (action === 'open-terminal') execFile('/usr/bin/open', ['-a', 'Terminal'], () => undefined);
    else throw new Error('Việc không hợp lệ');
    return undefined;
  });
  ctx.ipc.handle('runs:list', () => runs.list());
  ctx.ipc.handle('runs:cancel', (runId) => runs.cancel(runId));
  ctx.ipc.handle('runs:openWeb', (runId) => runs.openWeb(runId));
  ctx.ipc.handle('logs:tail', (file, lines, runId) => logs.tail(file, lines, runId));
  ctx.ipc.handle('logs:reveal', (file) => {
    logs.reveal(file);
    return undefined;
  });

  health.start();
  app.on('will-quit', () => {
    health.stop();
    clearInterval(runsTimer);
  });
  return { run: (probe) => health.run(probe) };
}
