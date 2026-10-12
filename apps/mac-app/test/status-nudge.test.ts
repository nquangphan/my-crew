import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobOutcome } from '../src/main/jobs/types.js';
import { createStatusNudge, jobCreatedCheckouts, STATUS_NUDGE_DELAY_MS } from '../src/main/status-nudge.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function world(send: () => Promise<void> = async () => undefined) {
  const sendFn = vi.fn(send);
  const log = vi.fn();
  return { nudge: createStatusNudge({ send: sendFn, log }), send: sendFn, log };
}

describe('createStatusNudge', () => {
  it('gửi một lần sau thời gian chờ, không gửi ngay lúc nhờ', async () => {
    const { nudge, send, log } = world();
    nudge.request('project-added:solar');
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(STATUS_NUDGE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('info', 'status-nudge-sent', { reasons: ['project-added:solar'] });
  });

  it('nhiều lần nhờ liền nhau gộp thành một lần gửi', async () => {
    const { nudge, send, log } = world();
    nudge.request('job:agent-workspace');
    await vi.advanceTimersByTimeAsync(500);
    nudge.request('job:agent-workspace');
    nudge.request('job:prepare-checkouts');
    await vi.advanceTimersByTimeAsync(STATUS_NUDGE_DELAY_MS * 5);
    expect(send).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('info', 'status-nudge-sent', {
      reasons: ['job:agent-workspace', 'job:agent-workspace', 'job:prepare-checkouts'],
    });
  });

  it('nhờ trong lúc đang gửi thì gửi thêm đúng một lần sau khi lần đang gửi xong', async () => {
    let finish: () => void = () => undefined;
    const { nudge, send } = world(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    nudge.request('a');
    await vi.advanceTimersByTimeAsync(STATUS_NUDGE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
    nudge.request('b');
    nudge.request('c');
    await vi.advanceTimersByTimeAsync(STATUS_NUDGE_DELAY_MS * 3);
    expect(send).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(STATUS_NUDGE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(STATUS_NUDGE_DELAY_MS * 3);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('gửi lỗi thì nuốt lỗi, ghi log warn, và lần nhờ sau vẫn gửi', async () => {
    const { nudge, send, log } = world(async () => {
      throw new Error('Gửi trạng thái thất bại');
    });
    expect(() => nudge.request('project-added:solar')).not.toThrow();
    await vi.advanceTimersByTimeAsync(STATUS_NUDGE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('warn', 'status-nudge-failed', {
      reasons: ['project-added:solar'],
      error: 'Gửi trạng thái thất bại',
    });
    nudge.request('job:agent-workspace');
    await vi.advanceTimersByTimeAsync(STATUS_NUDGE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('send ném giá trị không phải Error vẫn không lọt ra ngoài', async () => {
    const { nudge, log } = world(() => Promise.reject('utility chết'));
    nudge.request('x');
    await vi.advanceTimersByTimeAsync(STATUS_NUDGE_DELAY_MS);
    expect(log).toHaveBeenCalledWith('warn', 'status-nudge-failed', {
      reasons: ['x'],
      error: 'utility chết',
    });
  });
});

describe('jobCreatedCheckouts', () => {
  const done = (kind: 'prepare-checkouts' | 'agent-workspace' | 'inspect-folder'): JobOutcome =>
    kind === 'prepare-checkouts'
      ? { status: 'done', result: { kind, checkouts: [] } }
      : kind === 'agent-workspace'
        ? {
            status: 'done',
            result: { kind, role: 'executor', path: '/h/crew-agents/p/executor', head: 'abc' },
          }
        : {
            status: 'done',
            result: { kind, root: '/r', branch: null, remote: null, docsBundle: null, clean: true },
          };
  const failed: JobOutcome = { status: 'failed', errorCode: 'git_failed', errorText: 'lỗi' };

  it('chỉ việc tạo checkout làm xong mới cần báo bản tin', () => {
    expect(jobCreatedCheckouts('prepare-checkouts', done('prepare-checkouts'))).toBe(true);
    expect(jobCreatedCheckouts('agent-workspace', done('agent-workspace'))).toBe(true);
    expect(jobCreatedCheckouts('inspect-folder', done('inspect-folder'))).toBe(false);
    expect(jobCreatedCheckouts('prepare-checkouts', failed)).toBe(false);
    expect(jobCreatedCheckouts('agent-workspace', failed)).toBe(false);
  });
});
