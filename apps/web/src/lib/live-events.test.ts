import type { EventEnvelope } from '@crew/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidationsFor, startLiveEvents } from './live-events';

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  emit(event: EventEnvelope) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event), lastEventId: event.id }));
  }
  fail(closed: boolean) {
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.onerror?.();
  }
  close() {
    this.closed = true;
  }
}

const envelope = (id: string, payload: EventEnvelope['payload']): EventEnvelope => ({
  id,
  type: payload.type,
  ticketId: 'ticketId' in payload.data ? payload.data.ticketId : null,
  projectId: null,
  targetMachineId: null,
  targetRole: null,
  payload,
  createdAt: '2026-09-28T02:00:00.000Z',
});

describe('invalidationsFor', () => {
  it('maps ticket events to ticket queries and machine events to machine, claim and notice queries', () => {
    const comment = envelope('1', { type: 'ticket.updated', data: { ticketId: 't1', change: 'comment' } });
    expect(invalidationsFor(comment)).toEqual(
      expect.arrayContaining([['tickets'], ['ticket'], ['descendants'], ['report']]),
    );
    const claim = envelope('2', {
      type: 'claim.requested',
      data: { claimRequestId: 'c', machineId: 'm', projectId: 'p', assistant: false },
    });
    expect(invalidationsFor(claim)).toEqual(
      expect.arrayContaining([['machines'], ['claims'], ['notices'], ['projects']]),
    );
    const budget = envelope('3', { type: 'budget.exceeded', data: { ticketId: 't', kind: 'cost' } });
    expect(invalidationsFor(budget)).toEqual(expect.arrayContaining([['tickets'], ['notices']]));
    const stuck = envelope('4', {
      type: 'ticket.stuck',
      data: { ticketId: 't', status: 'in_progress', idleMinutes: 42 },
    });
    expect(invalidationsFor(stuck)).toEqual(expect.arrayContaining([['tickets'], ['notices']]));
  });
});

describe('startLiveEvents', () => {
  it('invalidates the mapped queries, resumes from the last event id, and refetches everything after a reconnect', async () => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const onClosed = vi.fn();
    const stop = startLiveEvents(queryClient, {
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
      batchMs: 10,
      retryMs: 50,
      onClosed,
    });
    const first = FakeEventSource.instances[0];
    expect(first?.url).toBe('/v1/stream');
    expect(first?.init).toEqual({ withCredentials: true });
    first?.open();
    expect(invalidate).not.toHaveBeenCalled();

    first?.emit(
      envelope('41', { type: 'ticket.status_changed', data: { ticketId: 't1', from: 'todo', to: 'triage' } }),
    );
    first?.emit(envelope('42', { type: 'ticket.updated', data: { ticketId: 't1', change: 'comment' } }));
    await vi.advanceTimersByTimeAsync(20);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['tickets'],
      ['ticket'],
      ['descendants'],
      ['report'],
    ]);

    // The browser's own reconnect: a second open means events may have been missed.
    invalidate.mockClear();
    first?.fail(false);
    first?.open();
    expect(invalidate).toHaveBeenCalledWith();

    // The browser gave up (e.g. 401): re-open with the cursor after a delay.
    first?.fail(true);
    expect(first?.closed).toBe(true);
    expect(onClosed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60);
    expect(FakeEventSource.instances[1]?.url).toBe('/v1/stream?cursor=42');

    stop();
    expect(FakeEventSource.instances[1]?.closed).toBe(true);
    vi.useRealTimers();
  });
});
