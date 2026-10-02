import assert from 'node:assert/strict';
import test from 'node:test';
import { DispatchCapacity, type Telemetry } from '../src/telemetry/capacity.ts';

const request = { kind: 'implement' as const, ticketId: 'ticket', ownershipKeys: ['workspace'], maxJobs: 3 };
const sample = (extra: Partial<Telemetry> = {}): Telemetry => ({
  observedAt: new Date().toISOString(),
  monotonicAt: performance.now(),
  cpuLoad1: 0.5,
  cpuCount: 8,
  memoryAvailableBytes: '8589934592',
  memoryPressure: 'normal',
  diskAvailableBytes: '42949672960',
  activeJobs: 0,
  configuredMaxJobs: 3,
  ownershipKeys: [],
  ...extra,
});
test('telemetry each dispatch samples again and pressure change blocks second dispatch', async () => {
  let calls = 0;
  const provider = { sample: async () => sample({ memoryPressure: ++calls === 1 ? 'normal' : 'critical' }) };
  const capacity = new DispatchCapacity(provider);
  assert.equal((await capacity.sampleAndDecide(request)).allowed, true);
  assert.equal((await capacity.sampleAndDecide({ ...request, kind: 'review' })).reason, 'MEMORY_PRESSURE');
  assert.equal(calls, 2);
});
test('telemetry stale, disk, RAM, CPU, concurrency and ownership fail closed for all dispatch kinds', async () => {
  for (const [extra, reason] of [
    [{ monotonicAt: performance.now() - 16000 }, 'STALE_TELEMETRY'],
    [{ diskAvailableBytes: '1' }, 'LOW_DISK'],
    [{ memoryAvailableBytes: '1' }, 'LOW_MEMORY'],
    [{ cpuLoad1: 99 }, 'CPU_LOAD'],
    [{ activeJobs: 3 }, 'MAX_JOBS'],
    [{ ownershipKeys: ['workspace'] }, 'OWNERSHIP_CONFLICT'],
    [{ memoryPressure: 'unknown' }, 'TELEMETRY_UNAVAILABLE'],
  ] as [Partial<Telemetry>, string][]) {
    const decision = await new DispatchCapacity({ sample: async () => sample(extra) }).sampleAndDecide({
      ...request,
      kind: 'fix',
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, reason);
    assert.ok(decision.checkedAt);
    assert.ok(decision.telemetry.observedAt);
  }
});

test('telemetry macOS sample obtains live pressure, page memory and disk without a cached result', async () => {
  const { MacOsTelemetryProvider } = await import('../src/telemetry/macos-provider.ts');
  let count = 0;
  const provider = new MacOsTelemetryProvider(
    process.cwd(),
    async () => ({ activeJobs: ++count, ownershipKeys: ['owned'] }),
    () => 3,
  );
  const first = await provider.sample();
  const second = await provider.sample();
  assert.ok(BigInt(first.memoryAvailableBytes) > 0n);
  assert.ok(BigInt(first.diskAvailableBytes) > 0n);
  assert.ok(['normal', 'warn', 'critical'].includes(first.memoryPressure));
  assert.equal(second.activeJobs, 2);
  assert.ok(second.monotonicAt > first.monotonicAt);
});
