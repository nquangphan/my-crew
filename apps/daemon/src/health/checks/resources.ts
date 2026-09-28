import { removeWorktree, worktreeKeys, worktreePath } from '../../git/worktree-manager.js';
import { ResourceOps, type ResourceReport, type WorktreeEntry } from '../../runner/resource-report.js';
import { ResourceTracker } from '../../runner/resource-tracker.js';
import { takeSnapshot, totalSlots } from '../../scheduler/resource-monitor.js';
import { PROBE_WORKTREE_KEY } from '../repo-probe.js';
import { type HealthCheck, type HealthCheckResult, type HealthContext, result } from '../types.js';

/**
 * The same `ResourceOps` the PM's `resource_report` / `cleanup_resources` use. Without a live daemon (the CLI)
 * every job the state DB marks running counts as running, so a check never touches a job that may be alive.
 */
export function healthResourceOps(ctx: HealthContext): ResourceOps | null {
  const state = ctx.state;
  if (!state) return null;
  const running = ctx.daemon
    ? () => ctx.daemon?.jobs.runningJobIds() ?? new Set<string>()
    : () => new Set(state.listJobs(['running']).map((job) => job.id));
  const snapshot = () => takeSnapshot(ctx.paths.home);
  return new ResourceOps({
    state,
    tracker: new ResourceTracker(),
    tmpRoot: ctx.paths.tmp,
    snapshot,
    freeSlots: () => (ctx.config ? totalSlots(ctx.config.resources, snapshot()) : 0),
    runningJobIds: running,
    worktrees: async () => {
      const entries: WorktreeEntry[] = [];
      for (const project of ctx.config?.projects ?? []) {
        for (const key of worktreeKeys(project.repoPath)) {
          if (key === PROBE_WORKTREE_KEY) continue;
          let ticketStatus: string | null = null;
          try {
            ticketStatus = ctx.vps ? (await ctx.vps.getTicket(key)).ticket.status : null;
          } catch {
            ticketStatus = null;
          }
          entries.push({
            projectKey: project.key,
            repo: project.repoPath,
            key,
            path: worktreePath(project.repoPath, key),
            ticketStatus,
          });
        }
      }
      return entries;
    },
    removeWorktree: (entry) => removeWorktree(entry.repo, entry.key),
  });
}

const cleanableIds = (report: ResourceReport) => [
  ...report.processes.filter((item) => item.cleanable).map((item) => item.id),
  ...report.tmpDirs.filter((item) => item.cleanable).map((item) => item.id),
  ...report.worktrees.filter((item) => item.cleanable).map((item) => item.id),
];

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export const resourceChecks: HealthCheck = {
  id: 'resources',
  group: 'resources',
  async run(ctx) {
    const ops = healthResourceOps(ctx);
    if (!ops)
      return [
        result(
          'resources.jobs',
          'resources',
          'Tài nguyên job',
          'green',
          'Chưa có job nào chạy trên máy này.',
        ),
      ];
    const report = await ops.report();
    const cleanup = { id: 'cleanup-resources', label: 'Dọn ngay' };
    const processes = report.processes.filter((item) => item.cleanable);
    const tmpDirs = report.tmpDirs.filter((item) => item.cleanable);
    const worktrees = report.worktrees.filter((item) => item.cleanable);
    const liveContainers = report.containers.filter((item) => /^up\b/i.test(item.status));
    const results: HealthCheckResult[] = [
      processes.length === 0
        ? result(
            'resources.processes',
            'resources',
            'Tiến trình mồ côi',
            'green',
            'Không còn tiến trình nào của job đã xong.',
          )
        : result(
            'resources.processes',
            'resources',
            'Tiến trình mồ côi',
            'yellow',
            processes
              .map(
                (item) =>
                  `pid ${item.pid}${item.ports.length ? ` (cổng ${item.ports.join(', ')})` : ''}: ${item.command}`,
              )
              .join('; '),
            cleanup,
          ),
      tmpDirs.length === 0
        ? result(
            'resources.tmp',
            'resources',
            'Thư mục tạm',
            'green',
            'Không còn thư mục tạm của job đã xong.',
          )
        : result(
            'resources.tmp',
            'resources',
            'Thư mục tạm',
            'yellow',
            `${tmpDirs.length} thư mục tạm của job đã xong, ${mb(tmpDirs.reduce((sum, item) => sum + item.bytes, 0))}.`,
            cleanup,
          ),
      worktrees.length === 0
        ? result('resources.worktrees', 'resources', 'Worktree của ticket đã đóng', 'green', 'Không có.')
        : result(
            'resources.worktrees',
            'resources',
            'Worktree của ticket đã đóng',
            'yellow',
            worktrees.map((item) => `${item.projectKey}/${item.key}`).join(', '),
            cleanup,
          ),
      liveContainers.length === 0
        ? result(
            'resources.containers',
            'resources',
            'Container do job tạo',
            'green',
            report.containers.length === 0 ? 'Không có.' : `${report.containers.length} container đã dừng.`,
          )
        : result(
            'resources.containers',
            'resources',
            'Container do job tạo',
            'yellow',
            `Đang chạy: ${liveContainers.map((item) => item.name).join(', ')} (chỉ báo cáo; PM dừng khi cần).`,
          ),
    ];
    return results;
  },
  async fix(ctx, fixId) {
    if (fixId !== 'cleanup-resources') return;
    const ops = healthResourceOps(ctx);
    if (!ops) return;
    const report = await ops.report();
    const outcome = await ops.cleanup(cleanableIds(report));
    if (outcome.refused.length > 0) {
      throw new Error(outcome.refused.map((item) => `${item.item}: ${item.reason}`).join('; '));
    }
  },
};
