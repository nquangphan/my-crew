import { join } from 'node:path';
import type { EventEnvelope } from '@crew/shared';
import { describe, expect, it } from 'vitest';
import { emitEvents } from '../../api/test/helpers/machines.js';
import { VpsClient } from '../src/api/vps-client.js';
import { StateDb } from '../src/state-db.js';
import type { DispatchEffect } from '../src/stream/dispatcher.js';
import { StreamClient } from '../src/stream/stream-client.js';
import { fixture, pmTask, useApi } from './helpers/api.js';
import { waitFor } from './helpers/daemon.js';
import { tempDir } from './helpers/git.js';

const api = useApi();

function client(
  url: string,
  token: string,
  state: StateDb,
  seen: EventEnvelope[],
  effects: DispatchEffect[] = [],
) {
  const vps = new VpsClient({ apiUrl: url, token: () => token });
  return new StreamClient({
    vps,
    state,
    onEffect: (effect, envelope) => {
      seen.push(envelope);
      effects.push(effect);
    },
    minBackoffMs: 20,
    maxBackoffMs: 100,
  });
}

describe('stream client against the real API', () => {
  it('replays from the saved cursor after a disconnect: no event lost, none twice', async () => {
    const f = await fixture(api);
    const path = join(tempDir('crewd-state-'), 'state.db');
    const state = new StateDb(path);
    const seen: EventEnvelope[] = [];

    const first = client(f.server.url, f.machine.token, state, seen);
    first.start();
    const early = await emitEvents(api.db, f.machine.machineId, 3);
    await waitFor(() => seen.length >= 3, 10_000, 'first 3 events');
    await first.stop();

    // Offline: 5 more events, plus one for another machine that must never arrive.
    const late = await emitEvents(api.db, f.machine.machineId, 5);
    await emitEvents(api.db, null, 1);
    state.close();

    const reopened = new StateDb(path);
    const second = client(f.server.url, f.machine.token, reopened, seen);
    second.start();
    await waitFor(() => seen.length >= 8, 10_000, 'replayed events');
    await second.stop();

    const tickets = seen.map((envelope) => envelope.ticketId);
    expect(tickets).toEqual([...early, ...late]);
    const ids = seen.map((envelope) => BigInt(envelope.id));
    expect([...ids].sort((a, b) => (a < b ? -1 : 1))).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(reopened.getCursor()).toBe(seen.at(-1)?.id);
    reopened.close();
  });

  it('turns a real ticket.assigned into a queued job for the assignee role', async () => {
    const f = await fixture(api);
    const state = new StateDb(join(tempDir('crewd-state-'), 'state.db'));
    const seen: EventEnvelope[] = [];
    const effects: DispatchEffect[] = [];
    const stream = client(f.server.url, f.machine.token, state, seen, effects);
    stream.start();
    try {
      const pm = await pmTask(api, f);
      await waitFor(() => state.activeJob(pm.id), 10_000, 'pm job');
      expect(state.activeJob(pm.id)).toMatchObject({ role: 'pm', status: 'queued', projectId: f.projectId });
      expect(effects.some((effect) => effect.kind === 'enqueued')).toBe(true);
      expect(stream.connected).toBe(true);
    } finally {
      await stream.stop();
      state.close();
    }
  });

  it('keeps retrying with backoff while the token is refused', async () => {
    const f = await fixture(api);
    const state = new StateDb(':memory:');
    const errors: Error[] = [];
    const vps = new VpsClient({
      apiUrl: f.server.url,
      token: () => 'crew_mt_not-a-real-token-0000000000000000000000',
    });
    const stream = new StreamClient({
      vps,
      state,
      onEffect: () => {},
      onError: (e) => errors.push(e),
      minBackoffMs: 10,
      maxBackoffMs: 20,
    });
    stream.start();
    await waitFor(() => errors.length >= 2, 5_000, 'two refused connects');
    await stream.stop();
    expect(errors[0]?.message).toMatch(/HTTP 401/);
  });
});
