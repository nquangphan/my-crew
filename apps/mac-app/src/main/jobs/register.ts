import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, utilityProcess } from 'electron';
import { STATE_CHANGED_EVENT } from '../../shared/ipc-contract.js';
import type { AppContext } from '../app-context.js';
import { type UtilityLike, UtilityOpsBridge } from '../ops-bridge.js';
import { createPaperclipClient } from '../paperclip/client.js';
import { boardKeys } from '../paperclip/register.js';
import { createJobsPoller, MissingKeyError } from './poller.js';
import { createJobsRemote } from './remote.js';
import { createTargetResolver } from './targets.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Hàng đợi việc trên máy: hỏi Paperclip ở origin board đã đăng nhập (board key của origin đó) cho các company có đích
 * bản tin của crew-mac mà tài khoản thấy được (URL đích bản tin không dùng để hỏi việc), làm việc trong một
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
  const resolver = createTargetResolver({
    statusTargets: () => jobsOps.call('jobTargets'),
    origin: () => ctx.store.get().setup.paperclipOrigin,
    companies: async (origin) => {
      const key = await boardKeys.read(origin);
      if (!key) throw new MissingKeyError();
      const client = createPaperclipClient(origin, {
        fetch: globalThis.fetch,
        readKey: async () => key,
        log: (event, fields) => ctx.log('debug', event, fields),
      });
      return (await client.companies()).map(({ id, name }) => ({ id, name }));
    },
  });
  // Đăng nhập lại (hay đổi origin) ghi `app.json`: đọc lại danh sách company ở lần hỏi sau.
  ctx.store.onChange(() => resolver.invalidate());
  const poller = createJobsPoller({
    loadTargets: () => resolver.resolve(),
    claim: (target, machineId) => remote.claim(target, machineId),
    submit: (target, machineId, jobId, outcome, claimedAt) =>
      remote.submit(target, machineId, jobId, outcome, claimedAt),
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
    onStatus: () => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(STATE_CHANGED_EVENT);
    },
    onForbidden: () => resolver.invalidate(),
  });
  ctx.ipc.handle('jobs:status', () => ({
    ...poller.status(),
    origin: ctx.store.get().setup.paperclipOrigin,
  }));
  poller.start();
  app.on('will-quit', () => {
    poller.stop();
    jobsOps.dispose();
  });
}
