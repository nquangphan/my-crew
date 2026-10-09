import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createJobsPoller,
  MissingKeyError,
  type PollerDeps,
  type PollTarget,
} from '../../src/main/jobs/poller.js';
import type { JobOutcome, MachineJob } from '../../src/main/jobs/types.js';

const MACHINE = '55555555-5555-4555-8555-555555555555';
const A: PollTarget = { url: 'https://crew.example.com', companyId: '11111111-1111-4111-8111-111111111111' };
const B: PollTarget = { url: 'https://crew.example.com', companyId: '22222222-2222-4222-8222-222222222222' };

function makeJob(target: PollTarget, over: Partial<MachineJob> = {}): MachineJob {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    companyId: target.companyId,
    machineId: MACHINE,
    kind: 'check',
    payload: { kind: 'check', projectKey: 'demo' },
    status: 'claimed',
    result: null,
    errorCode: null,
    errorText: null,
    attempts: 0,
    setupRunId: null,
    createdAt: '2026-10-10T00:00:00.000Z',
    claimedAt: '2026-10-10T00:00:01.000Z',
    finishedAt: null,
    ...over,
  };
}

const DONE: JobOutcome = { status: 'done', result: { kind: 'check', items: [] } };

function fakes(over: Partial<PollerDeps> = {}) {
  const claims: Array<{ target: PollTarget; at: number }> = [];
  const submits: Array<{ target: PollTarget; jobId: string; outcome: JobOutcome; claimedAt: string | null }> =
    [];
  const polls: number[] = [];
  let visible = true;
  const deps: PollerDeps = {
    loadTargets: async () => ({ machineId: MACHINE, targets: [A, B] }),
    claim: async (target) => {
      claims.push({ target, at: Date.now() });
      return null;
    },
    submit: async (target, _machineId, jobId, outcome, claimedAt) => {
      submits.push({ target, jobId, outcome, claimedAt });
    },
    run: async () => DONE,
    cancelRunning: vi.fn(),
    isVisible: () => visible,
    recordPoll: async (at) => {
      polls.push(at.getTime());
    },
    log: () => undefined,
    ...over,
  };
  return {
    deps,
    claims,
    submits,
    polls,
    setVisible: (v: boolean) => {
      visible = v;
    },
  };
}

let stop: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-10T04:00:00.000Z'));
});
afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

function start(deps: PollerDeps) {
  const poller = createJobsPoller(deps);
  poller.start();
  stop = () => poller.stop();
  return poller;
}

describe('JobsPoller', () => {
  it('mỗi chu kỳ claim cho từng đích; 204 thì không làm gì', async () => {
    const f = fakes({ run: vi.fn(async () => DONE) });
    start(f.deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.claims.map((c) => c.target.companyId)).toEqual([A.companyId, B.companyId]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.claims).toHaveLength(4);
    expect(f.deps.run).not.toHaveBeenCalled();
    expect(f.submits).toEqual([]);
  });

  it('có việc → chạy executor → gửi result cho đúng đích', async () => {
    let given = false;
    const f = fakes({
      claim: async (target) => {
        if (target === B && !given) {
          given = true;
          return makeJob(B);
        }
        return null;
      },
    });
    start(f.deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.submits).toEqual([
      { target: B, jobId: makeJob(B).id, outcome: DONE, claimedAt: makeJob(B).claimedAt },
    ]);
    expect(f.submits[0]?.claimedAt).toBe('2026-10-10T00:00:01.000Z');
  });

  it('chu kỳ 5 giây khi cửa sổ hiện, 15 giây khi ẩn', async () => {
    const f = fakes({ loadTargets: async () => ({ machineId: MACHINE, targets: [A] }) });
    start(f.deps);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.claims).toHaveLength(2);
    f.setVisible(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.claims).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(f.claims).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.claims).toHaveLength(4);
  });

  it('claim lỗi mạng → lùi dần tới 60 giây cho đích đó, đích khác vẫn 5 giây, không ném', async () => {
    const f = fakes();
    f.deps.claim = async (target) => {
      f.claims.push({ target, at: Date.now() });
      if (target === A) throw new Error('Không kết nối được Paperclip');
      return null;
    };
    start(f.deps);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    const times = f.claims.filter((c) => c.target === A).map((c) => c.at);
    const gaps = times.slice(1).map((t, i) => (t - (times[i] as number)) / 1000);
    expect(gaps.slice(0, 6)).toEqual([10, 20, 40, 60, 60, 60]);
    const bTimes = f.claims.filter((c) => c.target === B).map((c) => c.at);
    expect(((bTimes[1] as number) - (bTimes[0] as number)) / 1000).toBe(5);
  });

  it('đang chạy một việc thì không claim thêm', async () => {
    let finish: (o: JobOutcome) => void = () => undefined;
    let given = false;
    const f = fakes({
      loadTargets: async () => ({ machineId: MACHINE, targets: [A] }),
      run: () =>
        new Promise<JobOutcome>((resolve) => {
          finish = resolve;
        }),
    });
    f.deps.claim = async (target) => {
      f.claims.push({ target, at: Date.now() });
      if (given) return null;
      given = true;
      return makeJob(A);
    };
    start(f.deps);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.claims).toHaveLength(1);
    finish(DONE);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.submits).toHaveLength(1);
    expect(f.claims.length).toBeGreaterThanOrEqual(2);
  });

  it('việc quá 8 phút → hủy, báo app_error "quá thời gian"', async () => {
    let given = false;
    const f = fakes({
      loadTargets: async () => ({ machineId: MACHINE, targets: [A] }),
      run: () => new Promise<JobOutcome>(() => undefined),
    });
    f.deps.claim = async () => {
      if (given) return null;
      given = true;
      return makeJob(A);
    };
    start(f.deps);
    await vi.advanceTimersByTimeAsync(8 * 60_000 - 1);
    expect(f.submits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.deps.cancelRunning).toHaveBeenCalledTimes(1);
    expect(f.submits[0]?.outcome).toMatchObject({ status: 'failed', errorCode: 'app_error' });
    expect(f.submits[0]?.outcome.status === 'failed' && f.submits[0].outcome.errorText).toContain(
      'quá thời gian',
    );
  });

  it('hết giờ thì tín hiệu hủy truyền cho run được bật', async () => {
    let given = false;
    let seen: AbortSignal | undefined;
    const f = fakes({
      loadTargets: async () => ({ machineId: MACHINE, targets: [A] }),
      run: (_job, _target, signal) => {
        seen = signal;
        return new Promise<JobOutcome>(() => undefined);
      },
    });
    f.deps.claim = async () => {
      if (given) return null;
      given = true;
      return makeJob(A);
    };
    start(f.deps);
    await vi.advanceTimersByTimeAsync(8 * 60_000 - 1);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen?.aborted).toBe(true);
  });

  it('việc khác company hoặc khác máy → báo app_error, không chạy', async () => {
    let given = false;
    const f = fakes({
      loadTargets: async () => ({ machineId: MACHINE, targets: [A] }),
      run: vi.fn(async () => DONE),
    });
    f.deps.claim = async () => {
      if (given) return null;
      given = true;
      return makeJob(A, { companyId: B.companyId });
    };
    start(f.deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.deps.run).not.toHaveBeenCalled();
    expect(f.submits[0]?.outcome).toMatchObject({ status: 'failed', errorCode: 'app_error' });
  });

  it('ghi jobsAgent.lastPollAt sau chu kỳ hỏi được server, tối đa 30 giây một lần', async () => {
    const f = fakes();
    start(f.deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.polls).toEqual([Date.parse('2026-10-10T04:00:00.000Z')]);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(f.polls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.polls).toEqual([Date.parse('2026-10-10T04:00:00.000Z'), Date.parse('2026-10-10T04:00:30.000Z')]);
  });

  it('chưa có board key → không poll, không ghi jobsAgent', async () => {
    const f = fakes({
      claim: async () => {
        throw new MissingKeyError();
      },
    });
    start(f.deps);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.polls).toEqual([]);
    expect(f.submits).toEqual([]);
  });

  it('crew-mac chưa cấu hình bản tin (không có machineId) → không claim', async () => {
    const f = fakes({ loadTargets: async () => ({ machineId: null, targets: [A] }) });
    start(f.deps);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.claims).toEqual([]);
    expect(f.polls).toEqual([]);
  });

  it('stop() dừng hẳn vòng poll', async () => {
    const f = fakes();
    const poller = start(f.deps);
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.claims).toHaveLength(2);
  });
});
