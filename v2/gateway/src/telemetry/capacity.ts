export type Telemetry = {
  observedAt: string;
  monotonicAt: number;
  cpuLoad1: number;
  cpuCount: number;
  memoryAvailableBytes: string;
  memoryPressure: 'normal' | 'warn' | 'critical' | 'unknown';
  diskAvailableBytes: string;
  activeJobs: number;
  configuredMaxJobs: number;
  ownershipKeys: string[];
};
export type TelemetryProvider = { sample(): Promise<Telemetry> };
export type DispatchRequest = {
  kind: 'implement' | 'review' | 'fix';
  ticketId: string;
  ownershipKeys: string[];
  maxJobs: number;
};
export type CapacityThresholds = {
  maxAgeMs: number;
  minMemoryBytes: bigint;
  minDiskBytes: bigint;
  maxLoadPerCpu: number;
};
const defaults: CapacityThresholds = {
  maxAgeMs: 15000,
  minMemoryBytes: 2n * 1024n ** 3n,
  minDiskBytes: 5n * 1024n ** 3n,
  maxLoadPerCpu: 1,
};
export class DispatchCapacity {
  private readonly provider: TelemetryProvider;
  private readonly limits: CapacityThresholds;
  constructor(provider: TelemetryProvider, limits: Partial<CapacityThresholds> = {}) {
    this.provider = provider;
    this.limits = { ...defaults, ...limits };
  }
  async sampleAndDecide(
    request: DispatchRequest,
  ): Promise<{ allowed: boolean; telemetry: Telemetry; reason: string; checkedAt: string }> {
    const checkedAt = new Date().toISOString();
    let telemetry: Telemetry;
    try {
      telemetry = await this.provider.sample();
    } catch {
      telemetry = {
        observedAt: checkedAt,
        monotonicAt: performance.now(),
        cpuLoad1: 0,
        cpuCount: 0,
        memoryAvailableBytes: '0',
        memoryPressure: 'unknown',
        diskAvailableBytes: '0',
        activeJobs: 0,
        configuredMaxJobs: 0,
        ownershipKeys: [],
      };
    }
    let reason = 'ALLOWED';
    const age = performance.now() - telemetry.monotonicAt;
    try {
      if (
        !Number.isFinite(age) ||
        age < 0 ||
        !Number.isFinite(Date.parse(telemetry.observedAt)) ||
        !Number.isFinite(telemetry.cpuLoad1) ||
        telemetry.cpuLoad1 < 0 ||
        !Number.isInteger(telemetry.cpuCount) ||
        telemetry.cpuCount < 1 ||
        telemetry.memoryPressure === 'unknown' ||
        !Number.isInteger(telemetry.activeJobs) ||
        telemetry.activeJobs < 0 ||
        !Number.isInteger(telemetry.configuredMaxJobs) ||
        telemetry.configuredMaxJobs < 1 ||
        !Number.isInteger(request.maxJobs) ||
        request.maxJobs < 1
      )
        reason = 'TELEMETRY_UNAVAILABLE';
      else if (
        age > this.limits.maxAgeMs ||
        Date.now() - Date.parse(telemetry.observedAt) > this.limits.maxAgeMs
      )
        reason = 'STALE_TELEMETRY';
      else if (telemetry.memoryPressure !== 'normal') reason = 'MEMORY_PRESSURE';
      else if (BigInt(telemetry.diskAvailableBytes) < this.limits.minDiskBytes) reason = 'LOW_DISK';
      else if (BigInt(telemetry.memoryAvailableBytes) < this.limits.minMemoryBytes) reason = 'LOW_MEMORY';
      else if (telemetry.cpuLoad1 / telemetry.cpuCount > this.limits.maxLoadPerCpu) reason = 'CPU_LOAD';
      else if (telemetry.activeJobs >= Math.min(request.maxJobs, telemetry.configuredMaxJobs))
        reason = 'MAX_JOBS';
      else if (request.ownershipKeys.some((key) => telemetry.ownershipKeys.includes(key)))
        reason = 'OWNERSHIP_CONFLICT';
    } catch {
      reason = 'TELEMETRY_UNAVAILABLE';
    }
    return { allowed: reason === 'ALLOWED', telemetry, reason, checkedAt };
  }
}
