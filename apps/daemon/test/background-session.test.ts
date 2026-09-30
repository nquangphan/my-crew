import { describe, expect, it } from 'vitest';
import {
  BackgroundSession,
  type BackgroundSessionOptions,
  type BackgroundTaskPayload,
  reminderText,
} from '../src/runner/background-session.js';
import { sleep } from './helpers/daemon.js';

/** Polls every few ms (the shared `waitFor` polls too coarsely for timers this short). */
async function until(check: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}

const task = (id: string, over: Partial<BackgroundTaskPayload> = {}): BackgroundTaskPayload => ({
  task_id: id,
  task_type: 'local_bash',
  description: `lệnh ${id}`,
  ...over,
});

/** A session over a fake port that records, in order, what the session logic did to it. */
function harness(
  over: Partial<BackgroundSessionOptions> = {},
  stop: (id: string) => Promise<void> = async () => {},
) {
  const events: string[] = [];
  const sent: string[] = [];
  const session = new BackgroundSession({
    port: {
      send: (text) => {
        sent.push(text);
        events.push('send');
      },
      stopTask: (id) => {
        events.push(`stop:${id}`);
        return stop(id);
      },
      close: () => {
        events.push('close');
      },
    },
    waitMs: 20,
    settleMs: 20,
    stopTimeoutMs: 50,
    ...over,
  });
  return { session, events, sent };
}

describe('background session', () => {
  it('starts with no task and closes a turn that ends without background work', async () => {
    const { session, events } = harness();
    expect(session.liveTasks()).toEqual([]);
    expect(await session.turnEnded({ isError: false })).toBe('closed');
    expect(events).toEqual(['close']);
    expect(session).toMatchObject({ closed: true, closeReason: 'idle', reminded: false, tasksLeft: [] });
  });

  it('replaces the whole task set with each payload', () => {
    const { session } = harness();
    session.tasksChanged([task('a'), task('b')]);
    session.tasksChanged([task('c', { ambient: true })]);
    expect(session.liveTasks()).toEqual([
      { id: 'c', type: 'local_bash', description: 'lệnh c', ambient: true },
    ]);
    expect(session.liveWork()).toEqual([]);
    session.tasksChanged([]);
    expect(session.liveTasks()).toEqual([]);
  });

  it('waits while background work is alive, and closes once a later turn ends without any', async () => {
    const { session, events } = harness({ waitMs: 5_000 });
    session.tasksChanged([task('a')]);
    expect(await session.turnEnded({ isError: false })).toBe('waiting');
    expect(session.closed).toBe(false);
    expect(events).toEqual([]);
    // The runtime delivers the notification: the task leaves the set and a turn starts.
    session.tasksChanged([]);
    session.turnStarted();
    expect(await session.turnEnded({ isError: false })).toBe('closed');
    expect(events).toEqual(['close']);
    expect(session).toMatchObject({ closeReason: 'idle', reminded: false, tasksLeft: [] });
    session.dispose();
  });

  it('does not wait after an error result, a requested end or finished work, and stops the tasks first', async () => {
    const cases: [Partial<BackgroundSessionOptions>, boolean, string][] = [
      [{}, true, 'turn_error'],
      [{ endRequested: () => true }, false, 'end_requested'],
      [{ workDone: () => true }, false, 'work_done'],
      [{ workDone: async () => true }, false, 'work_done'],
    ];
    for (const [options, isError, reason] of cases) {
      const { session, events } = harness(options);
      session.tasksChanged([task('a'), task('b')]);
      expect(await session.turnEnded({ isError })).toBe('closed');
      expect(events).toEqual(['stop:a', 'stop:b', 'close']);
      expect(session.closeReason).toBe(reason);
      expect(session.tasksLeft.map((left) => left.id)).toEqual(['a', 'b']);
    }
  });

  it('keeps waiting when the run is not finished, or its state cannot be read', async () => {
    for (const workDone of [
      () => false,
      async () => {
        throw new Error('API unreachable');
      },
    ]) {
      const { session, events } = harness({ waitMs: 5_000, workDone });
      session.tasksChanged([task('a')]);
      expect(await session.turnEnded({ isError: false })).toBe('waiting');
      expect(events).toEqual([]);
      session.dispose();
    }
  });

  it('reminds once when a wait hits its ceiling, then closes after the answering turn', async () => {
    const { session, events, sent } = harness({ waitMs: 150 });
    session.tasksChanged([task('a')]);
    expect(await session.turnEnded({ isError: false })).toBe('waiting');
    await until(() => sent.length === 1, 'the reminder');
    expect(sent[0]).toBe(reminderText(session.liveWork(), 150));
    expect(sent[0]).toContain('lệnh a (id a)');
    expect(session.reminded).toBe(true);
    // The answering turn runs longer than the ceiling: no second reminder, and the session stays open.
    session.turnStarted();
    await sleep(400);
    expect(sent).toHaveLength(1);
    expect(events).toEqual(['send']);
    expect(session.closed).toBe(false);
    expect(await session.turnEnded({ isError: false })).toBe('closed');
    expect(events).toEqual(['send', 'stop:a', 'close']);
    expect(session).toMatchObject({ closeReason: 'reminded', reminded: true });
    expect(session.tasksLeft.map((left) => left.id)).toEqual(['a']);
  });

  it('closes when the reminder starts no turn within another full wait', async () => {
    const { session, events, sent } = harness({ waitMs: 60 });
    session.tasksChanged([task('a')]);
    const startedAt = Date.now();
    await session.turnEnded({ isError: false });
    await until(() => events.includes('close'), 'the close after an unanswered reminder');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(110);
    expect(sent).toHaveLength(1);
    expect(events).toEqual(['send', 'stop:a', 'close']);
    expect(session).toMatchObject({ closeReason: 'reminded', reminded: true });
  });

  it('gives each wait its own ceiling: a turn that starts ends the wait without a reminder', async () => {
    const { session, sent } = harness({ waitMs: 250 });
    session.tasksChanged([task('a'), task('b')]);
    await session.turnEnded({ isError: false });
    await sleep(100);
    // The notification of `a` starts a turn that outlasts the ceiling.
    session.tasksChanged([task('b')]);
    session.turnStarted();
    await sleep(350);
    expect(sent).toEqual([]);
    expect(await session.turnEnded({ isError: false })).toBe('waiting');
    await sleep(100);
    expect(sent).toEqual([]);
    await until(() => sent.length === 1, 'the reminder of the second wait');
    session.dispose();
  });

  it('stays open for the turn owed to work that ended during the turn, then closes', async () => {
    const { session, events } = harness({ settleMs: 5_000 });
    session.tasksChanged([task('a')]);
    // The task ends while the agent writes the last answer of its turn: the set is empty at the result.
    session.tasksChanged([]);
    expect(await session.turnEnded({ isError: false })).toBe('waiting');
    expect(session.closed).toBe(false);
    // The runtime starts the notification turn; nothing ended during it.
    session.turnStarted();
    expect(await session.turnEnded({ isError: false })).toBe('closed');
    expect(events).toEqual(['close']);
    expect(session).toMatchObject({ closeReason: 'idle', reminded: false, tasksLeft: [] });
  });

  it('a turn that ran nothing pays for no owed turn, and each turn pays for one at most', async () => {
    const { session, events } = harness({ waitMs: 5_000, settleMs: 5_000 });
    session.tasksChanged([task('a'), task('b')]);
    expect(await session.turnEnded({ isError: false })).toBe('waiting');
    // Both tasks end at the same moment: two turns may be owed.
    session.tasksChanged([task('b')]);
    session.tasksChanged([]);
    session.turnStarted();
    expect(await session.turnEnded({ isError: false, empty: true })).toBe('waiting');
    session.turnStarted();
    expect(await session.turnEnded({ isError: false })).toBe('waiting');
    expect(session.closed).toBe(false);
    session.turnStarted();
    expect(await session.turnEnded({ isError: false })).toBe('closed');
    expect(events).toEqual(['close']);
    expect(session).toMatchObject({ closeReason: 'idle', reminded: false, tasksLeft: [] });
  });

  it('closes after the settle time when an empty turn leaves an owed turn that never comes', async () => {
    const { session, events } = harness({ waitMs: 5_000, settleMs: 40 });
    session.tasksChanged([task('a'), task('b')]);
    await session.turnEnded({ isError: false });
    session.tasksChanged([]);
    session.turnStarted();
    expect(await session.turnEnded({ isError: false, empty: true })).toBe('waiting');
    await until(() => events.includes('close'), 'the settle close');
    expect(session).toMatchObject({ closeReason: 'idle', tasksLeft: [] });
  });

  it('the reminder is owed a turn of its own: work that ends after it still gets its notification turn', async () => {
    const { session, events, sent } = harness({ waitMs: 60, settleMs: 5_000 });
    session.tasksChanged([task('a')]);
    await session.turnEnded({ isError: false });
    await until(() => sent.length === 1, 'the reminder');
    session.tasksChanged([]);
    // The turn answering the reminder, then the notification turn.
    session.turnStarted();
    expect(await session.turnEnded({ isError: false })).toBe('waiting');
    session.turnStarted();
    expect(await session.turnEnded({ isError: false })).toBe('closed');
    expect(events).toEqual(['send', 'close']);
    expect(session).toMatchObject({ closeReason: 'idle', reminded: true, tasksLeft: [] });
  });

  it('does not take a turn that ran nothing for the answer to the reminder', async () => {
    const { session, events, sent } = harness({ waitMs: 80, settleMs: 5_000 });
    session.tasksChanged([task('a'), task('b')]);
    await session.turnEnded({ isError: false });
    await until(() => sent.length === 1, 'the reminder');
    session.tasksChanged([task('b')]);
    session.turnStarted();
    expect(await session.turnEnded({ isError: false, empty: true })).toBe('waiting');
    expect(events).toEqual(['send']);
    session.turnStarted();
    expect(await session.turnEnded({ isError: false })).toBe('closed');
    expect(events).toEqual(['send', 'stop:b', 'close']);
    expect(session).toMatchObject({ closeReason: 'reminded', reminded: true });
    expect(session.tasksLeft.map((left) => left.id)).toEqual(['b']);
  });

  it('closes after the settle time when no turn comes for work that ended during the turn', async () => {
    const { session, events, sent } = harness({ waitMs: 5_000, settleMs: 40 });
    session.tasksChanged([task('a')]);
    session.tasksChanged([]);
    const startedAt = Date.now();
    expect(await session.turnEnded({ isError: false })).toBe('waiting');
    await until(() => events.includes('close'), 'the settle close');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(35);
    expect(sent).toEqual([]);
    expect(session).toMatchObject({ closeReason: 'idle', tasksLeft: [] });
  });

  it('does not settle after an error result or a requested end', async () => {
    for (const [options, isError] of [
      [{}, true],
      [{ endRequested: () => true }, false],
    ] as [Partial<BackgroundSessionOptions>, boolean][]) {
      const { session, events } = harness({ ...options, settleMs: 5_000 });
      session.tasksChanged([task('a')]);
      session.tasksChanged([]);
      expect(await session.turnEnded({ isError })).toBe('closed');
      expect(events).toEqual(['close']);
    }
  });

  it('closes without a reminder when the work ends during a wait and no turn starts', async () => {
    const { session, events, sent } = harness({ waitMs: 5_000, settleMs: 120 });
    session.tasksChanged([task('a')]);
    await session.turnEnded({ isError: false });
    const startedAt = Date.now();
    session.tasksChanged([]);
    // Later changes that bring no work back do not restart the settle time.
    await sleep(60);
    session.tasksChanged([task('w', { ambient: true })]);
    await sleep(30);
    session.tasksChanged([]);
    await until(() => events.includes('close'), 'the settle close');
    expect(Date.now() - startedAt).toBeLessThan(200);
    expect(sent).toEqual([]);
    expect(session).toMatchObject({ closeReason: 'idle', tasksLeft: [] });
  });

  it('never waits for an ambient task, and still stops it before closing', async () => {
    const { session, events } = harness();
    session.tasksChanged([task('w', { ambient: true })]);
    expect(await session.turnEnded({ isError: false })).toBe('closed');
    expect(events).toEqual(['stop:w', 'close']);
    expect(session).toMatchObject({ closeReason: 'idle', tasksLeft: [] });
  });

  it('closes even when a stop fails or never answers', async () => {
    const { session, events } = harness({}, (id) =>
      id === 'a' ? Promise.reject(new Error('no such task')) : new Promise<void>(() => {}),
    );
    session.tasksChanged([task('a'), task('b')]);
    const startedAt = Date.now();
    await session.shutdown();
    expect(events).toEqual(['stop:a', 'stop:b', 'close']);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(session.closeReason).toBe('shutdown');
  });

  it('shuts down once: a later turn end or shutdown does nothing more', async () => {
    const { session, events } = harness();
    session.tasksChanged([task('a')]);
    await session.turnEnded({ isError: false });
    await Promise.all([session.shutdown(), session.shutdown()]);
    expect(await session.turnEnded({ isError: false })).toBe('closed');
    await sleep(50);
    expect(events).toEqual(['stop:a', 'close']);
    expect(session.tasksLeft.map((left) => left.id)).toEqual(['a']);
  });

  it('is not held up or reopened by a turn end still reading the run state when the session shuts down', async () => {
    let release: (done: boolean) => void = () => {};
    const { session, events } = harness({
      workDone: () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    });
    session.tasksChanged([task('a')]);
    const ended = session.turnEnded({ isError: false });
    await sleep(5);
    await session.shutdown();
    // The turn end returns with the shutdown; it does not wait for the state read.
    expect(await ended).toBe('closed');
    release(false);
    await sleep(50);
    expect(events).toEqual(['stop:a', 'close']);
    expect(session.closeReason).toBe('shutdown');
  });
});
