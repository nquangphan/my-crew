import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mutate } from '../commands/http-client.ts';
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
  private constructor(store: AtomicRecords, http: HttpOperationJournal) {
    this.store = store;
    this.http = http;
  }
  static async open(root: string, http: HttpOperationJournal) {
    return new GatewayConnection(await AtomicRecords.open(join(root, 'server-connection')), http);
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
