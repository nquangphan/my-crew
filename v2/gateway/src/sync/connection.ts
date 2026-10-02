import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { mutate } from '../commands/http-client.ts';
import type { TicketCommandBridge } from '../execution/ticket-command-bridge.ts';
import { AtomicRecords } from '../journal/atomic-records.ts';
import type { HttpOperationJournal } from '../journal/http-operations.ts';

type ConnectionRecord = {
  formatVersion: 1;
  bootId: string;
  previousGeneration: string;
  bootGeneration: string | null;
  sequence: string;
  heartbeat: { operationId: string; body: Record<string, unknown> } | null;
};
export class GatewayConnection {
  private readonly store: AtomicRecords;
  private readonly http: HttpOperationJournal;
  private readonly bridge?: TicketCommandBridge;
  private constructor(store: AtomicRecords, http: HttpOperationJournal, bridge?: TicketCommandBridge) {
    this.store = store;
    this.http = http;
    this.bridge = bridge;
  }
  static async open(root: string, http: HttpOperationJournal, bridge?: TicketCommandBridge) {
    return new GatewayConnection(await AtomicRecords.open(join(root, 'server-connection')), http, bridge);
  }
  async boot(bootId?: string, previousGeneration = '0'): Promise<{ bootId: string; bootGeneration: string }> {
    return this.store.transaction(async () => {
      let state = await this.store.get<ConnectionRecord>('current');
      if (!state) {
        state = {
          formatVersion: 1,
          bootId: bootId ?? randomUUID(),
          previousGeneration,
          bootGeneration: null,
          sequence: '0',
          heartbeat: null,
        };
        await this.store.put('current', state);
      } else if (bootId && state.bootId !== bootId) throw new Error('BOOT_RECONCILIATION_REQUIRED');
      const transition = await this.store.get<{ formatVersion: 1; next: ConnectionRecord }>(
        `transition:${state.bootId}`,
      );
      if (transition) {
        if (bootId && bootId !== transition.next.bootId) throw new Error('BOOT_RETIRED');
        state = transition.next;
        await this.store.put('current', state);
      }
      return this.handshake(state);
    });
  }
  private async handshake(state: ConnectionRecord) {
    const response = await mutate<{ bootGeneration: string }>(
      this.http,
      `boot:${state.bootId}`,
      '/v2/gateway/boots',
      'boot',
      { bootId: state.bootId, previousGeneration: state.previousGeneration },
    );
    if (!/^[1-9][0-9]*$/.test(response.bootGeneration)) throw new Error('INVALID_BOOT_GENERATION');
    state.bootGeneration = response.bootGeneration;
    await this.store.put('current', state);
    return { bootId: state.bootId, bootGeneration: state.bootGeneration };
  }
  async advanceBoot(nextBootId: string): Promise<{ bootId: string; bootGeneration: string }> {
    return this.store.transaction(async () => {
      if (!this.bridge) throw new Error('BOOT_RECONCILIATION_NOT_BOUND');
      const prior = await this.store.get<ConnectionRecord>('current');
      if (!prior?.bootGeneration) throw new Error('BOOT_REQUIRED');
      if (prior.bootId === nextBootId) return this.handshake(prior);
      if (await this.store.get(`history:${nextBootId}`)) throw new Error('BOOT_RETIRED');
      const pending = await this.store.get<{ formatVersion: 1; next: ConnectionRecord }>(
        `transition:${prior.bootId}`,
      );
      if (pending) {
        if (pending.next.bootId !== nextBootId) throw new Error('BOOT_TRANSITION_PENDING');
        await this.store.put('current', pending.next);
        return this.handshake(pending.next);
      }
      if (prior.heartbeat) throw new Error('HEARTBEAT_RECONCILIATION_REQUIRED');
      const previousGeneration = prior.bootGeneration;
      return this.bridge.withBootReconciliation(
        {
          hostRoot: dirname(this.store.root),
          priorBootId: prior.bootId,
          priorGeneration: prior.bootGeneration,
          nextBootId,
        },
        async (receipt) => {
          const next: ConnectionRecord = {
            formatVersion: 1,
            bootId: nextBootId,
            previousGeneration,
            bootGeneration: null,
            sequence: '0',
            heartbeat: null,
          };
          // Immutable history/transition precede the pointer and POST. A crash replays this exact transition.
          await this.store.put(`history:${prior.bootId}`, prior);
          await this.store.put(`transition:${prior.bootId}`, { formatVersion: 1, next, receipt });
          await this.store.put('current', next);
          return this.handshake(next);
        },
      );
    });
  }
  async heartbeat(input: Record<string, unknown>): Promise<unknown> {
    return this.store.transaction(async () => {
      const state = await this.store.get<ConnectionRecord>('current');
      if (!state?.bootGeneration) throw new Error('BOOT_REQUIRED');
      if (!state.heartbeat) {
        const sequence = String(BigInt(state.sequence) + 1n);
        state.heartbeat = {
          operationId: `heartbeat:${state.bootId}:${sequence}`,
          body: {
            ...structuredClone(input),
            bootId: state.bootId,
            bootGeneration: state.bootGeneration,
            sequence,
          },
        };
        await this.store.put('current', state);
      }
      const pending = state.heartbeat;
      const response = await mutate(
        this.http,
        pending.operationId,
        '/v2/gateway/heartbeat',
        'heartbeat',
        pending.body,
      );
      state.sequence = pending.body.sequence as string;
      state.heartbeat = null;
      await this.store.put('current', state);
      return response;
    });
  }
  close() {
    return this.store.close();
  }
}
