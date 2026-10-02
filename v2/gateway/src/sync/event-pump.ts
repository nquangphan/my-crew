import { join } from 'node:path';
import type { ReadTransport } from '../commands/contracts.ts';
import { AtomicRecords } from '../journal/atomic-records.ts';
export type EventPumpOptions = {
  read: ReadTransport;
  stream?: (after: string, signal: AbortSignal) => AsyncIterable<string>;
  reconcile: () => Promise<void>;
};
/** Stream is a wakeup, commands remain durable server truth. Poll is the reconnect fallback. */
export class GatewayEventPump {
  private readonly store: AtomicRecords;
  private readonly options: EventPumpOptions;
  private constructor(store: AtomicRecords, options: EventPumpOptions) {
    this.store = store;
    this.options = options;
  }
  static async open(root: string, options: EventPumpOptions) {
    return new GatewayEventPump(await AtomicRecords.open(join(root, 'event-sync')), options);
  }
  async once(): Promise<void> {
    await this.store.transaction(async () => {
      const previous = await this.store.get<{ formatVersion: 1; cursor: string }>('cursor'),
        after = previous?.cursor ?? '0';
      let cursor: string | null = null;
      if (this.options.stream) {
        try {
          for await (const id of this.options.stream(after, AbortSignal.timeout(15000))) {
            cursor = id;
            break;
          }
        } catch {
          /* Offline SSE falls back to authenticated poll; no cursor advance. */
        }
      }
      if (cursor === null) {
        const page = (await this.options.read(`/v2/events?after=${after}&limit=50`)) as { cursor: string };
        cursor = page.cursor;
      }
      if (!/^(0|[1-9][0-9]*)$/.test(cursor) || BigInt(cursor) < BigInt(after))
        throw new Error('INVALID_EVENT_CURSOR');
      await this.options.reconcile();
      await this.store.put('cursor', { formatVersion: 1, cursor });
    });
  }
  close() {
    return this.store.close();
  }
}
