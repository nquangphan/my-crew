import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { availableParallelism, loadavg } from 'node:os';
import { promisify } from 'node:util';
import type { Telemetry, TelemetryProvider } from './capacity.ts';

const execute = promisify(execFile);
export class MacOsTelemetryProvider implements TelemetryProvider {
  private readonly root: string;
  private readonly registry: () => Promise<{ activeJobs: number; ownershipKeys: string[] }>;
  private readonly maxJobs: () => number;
  constructor(
    root: string,
    registry: () => Promise<{ activeJobs: number; ownershipKeys: string[] }>,
    maxJobs: () => number,
  ) {
    this.root = root;
    this.registry = registry;
    this.maxJobs = maxJobs;
  }
  async sample(): Promise<Telemetry> {
    if (process.platform !== 'darwin') throw new Error('TELEMETRY_UNAVAILABLE');
    const monotonicAt = performance.now();
    const observedAt = new Date().toISOString();
    const [vm, pressure, disk, jobs] = await Promise.all([
      execute('/usr/bin/vm_stat', [], { timeout: 2000 }),
      execute('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 2000 }),
      statfs(this.root, { bigint: true }),
      this.registry(),
    ]);
    const page = vm.stdout.match(/page size of (\d+) bytes/);
    const free = vm.stdout.match(/Pages free:\s+(\d+)/);
    const inactive = vm.stdout.match(/Pages inactive:\s+(\d+)/);
    const speculative = vm.stdout.match(/Pages speculative:\s+(\d+)/);
    if (!page || !free || !inactive || !speculative) throw new Error('TELEMETRY_UNAVAILABLE');
    const level = pressure.stdout.trim();
    const memoryPressure =
      level === '1' ? 'normal' : level === '2' ? 'warn' : level === '4' ? 'critical' : 'unknown';
    return {
      observedAt,
      monotonicAt,
      cpuLoad1: loadavg()[0],
      cpuCount: availableParallelism(),
      memoryAvailableBytes: (
        (BigInt(free[1]) + BigInt(inactive[1]) + BigInt(speculative[1])) *
        BigInt(page[1])
      ).toString(),
      memoryPressure,
      diskAvailableBytes: (disk.bavail * disk.bsize).toString(),
      activeJobs: jobs.activeJobs,
      ownershipKeys: jobs.ownershipKeys,
      configuredMaxJobs: this.maxJobs(),
    };
  }
}
