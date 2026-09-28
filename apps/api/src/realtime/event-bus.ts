import type { EventEnvelope } from '@crew/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/client.js';
import { EVENTS_CHANNEL, latestEventSeq, listEventsAfter } from '../services/event-service.js';

export const DEFAULT_POLL_MS = 5_000;
const PAGE = 500;
const LISTEN_RETRY_MAX_MS = 30_000;

/** One open stream. `machineId` null receives every event (the owner stream). */
export interface BusSubscriber {
  readonly machineId: string | null;
  deliver(event: EventEnvelope): void;
  close(reason: string): void;
}

export interface EventBusOptions {
  pollMs?: number;
  /** Set false to rely on polling only (used to test the fallback). */
  listen?: boolean;
  log?: Pick<FastifyBaseLogger, 'warn' | 'error'>;
}

/**
 * In-process fan-out of committed events to open SSE streams. Postgres `LISTEN events_new` wakes it; a poll
 * every few seconds covers a dropped LISTEN connection. Events are read by delivery sequence, which is
 * assigned in commit order, so reading `seq > last` never skips an event that commits late.
 *
 * It also keeps the per-machine connection map, so revoking a machine closes its streams at once.
 */
export class EventBus {
  private lastSeq = 0n;
  private readonly owners = new Set<BusSubscriber>();
  private readonly byMachine = new Map<string, Set<BusSubscriber>>();
  /** Revoked in this process: their streams are closed and new ones refused. */
  private readonly denied = new Set<string>();
  private pumping: Promise<void> | null = null;
  private again = false;
  private timer: NodeJS.Timeout | undefined;
  private unlisten: (() => Promise<void>) | undefined;
  private stopped = false;
  private readonly pollMs: number;

  constructor(
    private readonly db: Database,
    private readonly options: EventBusOptions = {},
  ) {
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.lastSeq = await latestEventSeq(this.db);
    if (this.options.listen !== false) await this.listen(1_000);
    this.timer = setInterval(() => void this.wake(), this.pollMs);
    this.timer.unref();
  }

  /** Subscribes to the LISTEN channel; on failure retries with backoff while the poll keeps delivering. */
  private async listen(retryMs: number): Promise<void> {
    if (this.stopped) return;
    try {
      const handle = await this.db.$client.listen(
        EVENTS_CHANNEL,
        () => void this.wake(),
        // Runs on every (re)connect of the LISTEN connection: catch up on anything missed meanwhile.
        () => void this.wake(),
      );
      this.unlisten = handle.unlisten;
    } catch (error) {
      this.options.log?.warn({ err: error, retryMs }, 'LISTEN failed; polling until it reconnects');
      const retry = setTimeout(() => void this.listen(Math.min(retryMs * 2, LISTEN_RETRY_MAX_MS)), retryMs);
      retry.unref();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    const unlisten = this.unlisten;
    this.unlisten = undefined;
    for (const subscriber of [...this.owners, ...[...this.byMachine.values()].flatMap((set) => [...set])]) {
      subscriber.close('server shutting down');
    }
    this.owners.clear();
    this.byMachine.clear();
    await this.pumping?.catch(() => {});
    await unlisten?.().catch(() => {});
  }

  /** Highest sequence already fanned out; a fresh owner stream starts here. */
  get currentSeq(): bigint {
    return this.lastSeq;
  }

  /** Registers a stream. Throws when its machine was revoked in this process. */
  subscribe(subscriber: BusSubscriber): () => void {
    const { machineId } = subscriber;
    if (machineId === null) {
      this.owners.add(subscriber);
      return () => this.owners.delete(subscriber);
    }
    if (this.denied.has(machineId)) throw new Error('machine revoked');
    let set = this.byMachine.get(machineId);
    if (!set) {
      set = new Set();
      this.byMachine.set(machineId, set);
    }
    set.add(subscriber);
    return () => {
      const current = this.byMachine.get(machineId);
      current?.delete(subscriber);
      if (current?.size === 0) this.byMachine.delete(machineId);
    };
  }

  isConnected(machineId: string): boolean {
    return (this.byMachine.get(machineId)?.size ?? 0) > 0;
  }

  /**
   * Closes every open stream of a machine now and refuses new ones. Call it inside the revoking
   * transaction, before commit, so no event committed after the revocation reaches the machine.
   */
  revokeMachine(machineId: string): void {
    this.denied.add(machineId);
    const set = this.byMachine.get(machineId);
    this.byMachine.delete(machineId);
    for (const subscriber of set ?? []) subscriber.close('machine revoked');
  }

  /** Undoes `revokeMachine` when the revoking transaction rolled back. */
  restoreMachine(machineId: string): void {
    this.denied.delete(machineId);
  }

  /** Fetches newly committed events and fans them out. Concurrent calls coalesce into one extra pass. */
  wake(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.pumping) {
      this.again = true;
      return this.pumping;
    }
    this.pumping = (async () => {
      try {
        do {
          this.again = false;
          await this.pump();
        } while (this.again && !this.stopped);
      } catch (error) {
        this.options.log?.error({ err: error }, 'event bus fetch failed; retrying on the next poll');
      } finally {
        this.pumping = null;
      }
    })();
    return this.pumping;
  }

  private async pump(): Promise<void> {
    for (;;) {
      const batch = await listEventsAfter(this.db, { cursor: this.lastSeq, limit: PAGE });
      for (const event of batch) {
        this.lastSeq = BigInt(event.id);
        this.dispatch(event);
      }
      if (batch.length < PAGE) return;
    }
  }

  private dispatch(event: EventEnvelope): void {
    for (const subscriber of this.owners) subscriber.deliver(event);
    if (event.targetMachineId) {
      for (const subscriber of this.byMachine.get(event.targetMachineId) ?? []) subscriber.deliver(event);
    }
  }
}
