import { takeSnapshot, totalSlots } from '../../scheduler/resource-monitor.js';
import { type HealthCheck, result } from '../types.js';

/** Worktrees and agent temp files need room; below this the dashboard warns. */
export const MIN_DISK_FREE_GB = 10;

export const machineChecks: HealthCheck = {
  id: 'machine',
  group: 'machine',
  async run(ctx) {
    const snapshot = takeSnapshot(ctx.paths.home);
    const slots = ctx.config ? totalSlots(ctx.config.resources, snapshot) : 0;
    const detail = `${snapshot.cpus} CPU, tải ${snapshot.loadAvg1}, RAM trống ${snapshot.freeMemGb}/${snapshot.totalMemGb} GB, ${slots} slot trống`;
    const disk = snapshot.diskFreeGb;
    return [
      result(
        'machine.resources',
        'machine',
        'Tài nguyên máy',
        slots > 0 ? 'green' : 'yellow',
        slots > 0 ? detail : `${detail}: máy đang bận (hoặc giới hạn quá chặt), job mới sẽ chờ.`,
        slots > 0 ? undefined : { id: 'adjust-limits', label: 'Chỉnh giới hạn' },
      ),
      disk === null || disk >= MIN_DISK_FREE_GB
        ? result(
            'machine.disk',
            'machine',
            'Dung lượng đĩa',
            'green',
            disk === null ? 'Không đọc được dung lượng.' : `Còn ${disk} GB.`,
          )
        : result(
            'machine.disk',
            'machine',
            'Dung lượng đĩa',
            'yellow',
            `Chỉ còn ${disk} GB (dưới ${MIN_DISK_FREE_GB} GB) cho worktree và file tạm.`,
          ),
    ];
  },
};
