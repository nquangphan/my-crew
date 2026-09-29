import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { totalSlots } from '../src/scheduler/resource-monitor.js';
import { planSlots, runnableJobs, Scheduler, type StartDecision } from '../src/scheduler/scheduler.js';
import { type JobRow, StateDb } from '../src/state-db.js';
import { waitFor } from './helpers/daemon.js';

const resources = parseConfig({ apiUrl: 'https://crew.test', machineName: 'm' }).resources;
const snapshot = (over: Partial<Parameters<typeof totalSlots>[1]> = {}) => ({
  cpus: 8,
  loadAvg1: 1,
  freeMemGb: 8,
  totalMemGb: 16,
  diskFreeGb: 100,
  ...over,
});

describe('slot math', () => {
  it('is min(maxConcurrentJobs, floor(cpus/2)) and 0 under memory or load pressure', () => {
    expect(totalSlots({ ...resources, maxConcurrentJobs: 2 }, snapshot())).toBe(2);
    expect(totalSlots({ ...resources, maxConcurrentJobs: 6 }, snapshot({ cpus: 6 }))).toBe(3);
    expect(totalSlots({ ...resources, maxConcurrentJobs: 6 }, snapshot({ cpus: 1 }))).toBe(0);
    expect(totalSlots({ ...resources, minFreeMemGb: 4 }, snapshot({ freeMemGb: 3.9 }))).toBe(0);
    expect(totalSlots({ ...resources, maxLoadPerCpu: 1.5 }, snapshot({ loadAvg1: 12.1 }))).toBe(0);
    expect(totalSlots({ ...resources, maxLoadPerCpu: 1.5 }, snapshot({ loadAvg1: 12 }))).toBe(2);
  });

  it('keeps one extra slot for PM and assistant jobs', () => {
    const job = (role: JobRow['role']) => ({ role }) as JobRow;
    const running = [job('dev'), job('qc')];
    expect(planSlots(2, running, [job('dev')]).start).toHaveLength(0);
    expect(planSlots(2, running, [job('pm')]).start).toHaveLength(1);
    expect(planSlots(2, [...running, job('pm')], [job('assistant')]).start).toHaveLength(0);
    expect(planSlots(0, [], [job('pm')]).start).toHaveLength(0);
  });

  it('lists queued jobs not waiting on dependencies and due backoffs', () => {
    const state = new StateDb(':memory:');
    const now = new Date();
    const a = state.insertJob({ ticketId: randomUUID(), projectId: null, role: 'dev', trigger: 't' });
    const b = state.insertJob({ ticketId: randomUUID(), projectId: null, role: 'dev', trigger: 't' });
    const c = state.insertJob({ ticketId: randomUUID(), projectId: null, role: 'dev', trigger: 't' });
    const d = state.insertJob({ ticketId: randomUUID(), projectId: null, role: 'dev', trigger: 't' });
    state.updateJob(b.id, { waitingDeps: true });
    state.updateJob(c.id, { status: 'backoff', retryAt: new Date(now.getTime() - 1000).toISOString() });
    state.updateJob(d.id, { status: 'backoff', retryAt: new Date(now.getTime() + 60_000).toISOString() });
    expect(runnableJobs(state, now).map((job) => job.id)).toEqual([a.id, c.id]);
  });
});

describe('Scheduler', () => {
  function harness(
    slots: number | (() => number),
    decide: (job: JobRow) => StartDecision = () => ({ action: 'start' }),
  ) {
    const state = new StateDb(':memory:');
    const launched: string[] = [];
    const waits: { jobId: string; reason: string }[] = [];
    let concurrent = 0;
    let peak = 0;
    const scheduler = new Scheduler({
      state,
      slots: typeof slots === 'function' ? slots : () => slots,
      paused: () => false,
      decide: async (job) => decide(job),
      launch: async (job) => {
        state.updateJob(job.id, { status: 'running' });
        launched.push(job.id);
        concurrent += 1;
        peak = Math.max(peak, concurrent);
      },
      onWaitChange: (job, reason) => waits.push({ jobId: job.id, reason }),
      tickMs: 20,
      recheckMs: 60_000,
    });
    const finish = (id: string) => {
      state.updateJob(id, { status: 'done' });
      concurrent -= 1;
    };
    return { state, scheduler, launched, finish, waits, peak: () => peak };
  }

  it('runs at most maxConcurrentJobs of 4 independent dev jobs at once', async () => {
    const h = harness(2);
    const ids = Array.from(
      { length: 4 },
      () => h.state.insertJob({ ticketId: randomUUID(), projectId: null, role: 'dev', trigger: 't' }).id,
    );
    await h.scheduler.tick();
    expect(h.launched).toEqual(ids.slice(0, 2));
    h.finish(ids[0] as string);
    await h.scheduler.tick();
    expect(h.launched).toEqual(ids.slice(0, 3));
    h.finish(ids[1] as string);
    h.finish(ids[2] as string);
    await h.scheduler.tick();
    expect(h.launched).toEqual(ids);
    expect(h.peak()).toBe(2);
  });

  it('holds a job with unmet dependencies until a re-check finds them done', async () => {
    let depDone = false;
    const h = harness(2, () => (depDone ? { action: 'start' } : { action: 'wait_deps' }));
    const job = h.state.insertJob({ ticketId: randomUUID(), projectId: null, role: 'qc', trigger: 't' });
    await h.scheduler.tick();
    expect(h.launched).toEqual([]);
    expect(h.state.getJob(job.id)?.waitingDeps).toBe(true);
    // Not re-decided on ordinary ticks while waiting.
    await h.scheduler.tick();
    expect(h.launched).toEqual([]);
    depDone = true;
    await h.scheduler.recheckWaiting();
    expect(h.launched).toEqual([job.id]);
  });

  it('marks skipped jobs terminal and retries deferred ones', async () => {
    const h = harness(2, (job) =>
      job.trigger === 'skip'
        ? { action: 'skip', reason: 'over budget' }
        : { action: 'defer', reason: 'later' },
    );
    const skip = h.state.insertJob({ ticketId: randomUUID(), projectId: null, role: 'dev', trigger: 'skip' });
    const defer = h.state.insertJob({
      ticketId: randomUUID(),
      projectId: null,
      role: 'dev',
      trigger: 'defer',
    });
    await h.scheduler.tick();
    expect(h.state.getJob(skip.id)).toMatchObject({ status: 'skipped', error: 'over budget' });
    expect(h.state.getJob(defer.id)?.status).toBe('queued');
  });

  it('records why each job waits and reports each change of reason once', async () => {
    let free = 0;
    let decision: StartDecision = { action: 'wait_deps', dependsOn: ['AST-3'] };
    const h = harness(
      () => free,
      () => decision,
    );
    const job = h.state.insertJob({ ticketId: randomUUID(), projectId: null, role: 'dev', trigger: 't' });
    // A full machine: every tick sees no slot, but the reason is recorded and reported once.
    await h.scheduler.tick();
    await h.scheduler.tick();
    expect(h.state.getJob(job.id)).toMatchObject({ waitReason: 'no_slots', waitDetail: null });
    expect(h.waits).toEqual([{ jobId: job.id, reason: 'no_slots' }]);

    free = 2;
    await h.scheduler.tick();
    expect(h.state.getJob(job.id)).toMatchObject({
      waitingDeps: true,
      waitReason: 'waiting_deps',
      waitDetail: { dependsOn: ['AST-3'] },
    });

    decision = {
      action: 'defer',
      reason: 'project WEB has no local folder',
      wait: 'no_local_folder',
      detail: { projectKey: 'WEB' },
    };
    await h.scheduler.recheckWaiting();
    expect(h.state.getJob(job.id)).toMatchObject({
      waitReason: 'no_local_folder',
      waitDetail: { projectKey: 'WEB' },
    });
    await h.scheduler.tick();

    decision = { action: 'defer', reason: 'API unreachable' };
    await h.scheduler.tick();
    expect(h.state.getJob(job.id)).toMatchObject({
      waitReason: 'check_failed',
      waitDetail: { message: 'API unreachable' },
    });
    expect(h.waits.map((w) => w.reason)).toEqual([
      'no_slots',
      'waiting_deps',
      'no_local_folder',
      'check_failed',
    ]);
  });

  it('ticks on its own timer', async () => {
    const h = harness(1);
    h.scheduler.start();
    try {
      const job = h.state.insertJob({ ticketId: randomUUID(), projectId: null, role: 'dev', trigger: 't' });
      await waitFor(() => h.launched.includes(job.id), 2_000, 'timer tick');
    } finally {
      await h.scheduler.stop();
    }
  });
});
