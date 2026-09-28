import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { EventEnvelope } from '@crew/shared';
import { describe, expect, it } from 'vitest';
import { VpsClient } from '../src/api/vps-client.js';
import { StateDb } from '../src/state-db.js';
import { StreamClient } from '../src/stream/stream-client.js';
import { tempDir } from './helpers/git.js';

function assigned(id: string, ticketId: string): EventEnvelope {
  return {
    id,
    type: 'ticket.assigned',
    ticketId,
    projectId: null,
    targetMachineId: 'm',
    targetRole: 'dev',
    payload: { type: 'ticket.assigned', data: { ticketId, role: 'dev' } },
    createdAt: new Date().toISOString(),
  };
}

const vps = new VpsClient({ apiUrl: 'http://127.0.0.1:9', token: () => 'unused-token-000000' });

describe('stream atomicity', () => {
  it('a crash between the job insert and the cursor write persists neither', () => {
    const path = join(tempDir('crewd-state-'), 'state.db');
    const ticket = randomUUID();
    let crash = true;
    const state = new StateDb(path);
    const client = new StreamClient({
      vps,
      state,
      onEffect: () => {},
      beforeCursorWrite: () => {
        if (crash) throw new Error('simulated crash');
      },
    });
    expect(() => client.applyEnvelope(assigned('7', ticket))).toThrow('simulated crash');
    state.close();

    // A fresh process on the same file sees neither the job nor the cursor, so the event is replayed.
    const reopened = new StateDb(path);
    expect(reopened.getCursor()).toBeNull();
    expect(reopened.listJobs()).toHaveLength(0);
    crash = false;
    const replay = new StreamClient({ vps, state: reopened, onEffect: () => {} });
    expect(replay.applyEnvelope(assigned('7', ticket))?.kind).toBe('enqueued');
    expect(reopened.getCursor()).toBe('7');
    expect(reopened.listJobs()).toHaveLength(1);
    // A duplicate delivery below the cursor is skipped: still one job.
    expect(replay.applyEnvelope(assigned('7', ticket))).toBeNull();
    expect(reopened.listJobs()).toHaveLength(1);
    reopened.close();
  });

  it('commits the job and the cursor together', () => {
    const path = join(tempDir('crewd-state-'), 'state.db');
    const state = new StateDb(path);
    const client = new StreamClient({ vps, state, onEffect: () => {} });
    client.applyEnvelope(assigned('3', randomUUID()));
    client.applyEnvelope(assigned('4', randomUUID()));
    state.close();
    const reopened = new StateDb(path);
    expect(reopened.getCursor()).toBe('4');
    expect(reopened.listJobs()).toHaveLength(2);
    reopened.close();
  });
});
