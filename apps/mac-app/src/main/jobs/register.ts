import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, utilityProcess } from 'electron';
import type { AppContext } from '../app-context.js';
import { type UtilityLike, UtilityOpsBridge } from '../ops-bridge.js';
import { boardKeys } from '../paperclip/register.js';
import { createJobsPoller } from './poller.js';
import { createJobsRemote } from './remote.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Hàng đợi việc trên máy: hỏi Paperclip (board key) theo các đích bản tin của crew-mac, làm việc trong một
 * utilityProcess riêng ("2P Crew jobs") để việc quá giờ hủy được bằng cách giết tiến trình đó mà không đụng các thao
 * tác khác của app, rồi báo kết quả. Ghi `jobsAgent` vào `app.json` để bản tin máy báo app đang nhận việc.
 */
export function registerJobs(ctx: AppContext): void {
  const jobsOps = new UtilityOpsBridge(
    () =>
      utilityProcess.fork(join(here, 'ops.js'), [], {
        serviceName: '2P Crew jobs',
        stdio: 'pipe',
        env: { ...process.env },
      }) as unknown as UtilityLike,
  );
  const remote = createJobsRemote({
    fetch: globalThis.fetch,
    readKey: (origin) => boardKeys.read(origin),
    log: (event, fields) => ctx.log('debug', event, fields),
  });
  const poller = createJobsPoller({
    loadTargets: () => jobsOps.call('jobTargets'),
    claim: (target, machineId) => remote.claim(target, machineId),
    submit: (target, machineId, jobId, outcome) => remote.submit(target, machineId, jobId, outcome),
    run: async (job, target, signal) => {
      const prepared = await remote.prepare(target, job);
      if ('outcome' in prepared) return prepared.outcome;
      // Quá giờ giữa lúc tải skill: không bắt đầu ghi file sau khi đã báo lỗi.
      if (signal.aborted) throw new Error('Việc đã bị hủy vì quá thời gian');
      return jobsOps.call('runMachineJob', job, prepared.extras);
    },
    cancelRunning: async () => {
      // Giết nhóm tiến trình git con trước (SIGKILL tiến trình phụ không dọn được con), rồi mới giết tiến trình phụ.
      await Promise.race([jobsOps.call('cancelMachineJob'), new Promise((r) => setTimeout(r, 2_000))]).catch(
        () => undefined,
      );
      jobsOps.dispose();
    },
    isVisible: () => BrowserWindow.getAllWindows().some((win) => win.isVisible()),
    recordPoll: async (at) => {
      await ctx.store.update((state) => ({
        ...state,
        jobsAgent: { version: ctx.appVersion, lastPollAt: at.toISOString() },
      }));
    },
    log: (level, event, fields) => ctx.log(level, event, fields),
  });
  poller.start();
  app.on('will-quit', () => {
    poller.stop();
    jobsOps.dispose();
  });
}
