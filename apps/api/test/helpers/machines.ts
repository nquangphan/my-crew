import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { EventEnvelope, EventPayload } from '@crew/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type BuildAppOptions, buildApp } from '../../src/app.js';
import type { Database } from '../../src/db/client.js';
import { owner, pairingCodes } from '../../src/db/schema.js';
import { appendEvents } from '../../src/services/event-service.js';
import { pairMachine } from '../../src/services/machine-service.js';
import { testConfig } from './test-db.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Inserts a valid pairing code directly (the owner route is tested separately). */
export async function insertPairingCode(db: Database, ttlMs = 10 * 60 * 1000): Promise<string> {
  const raw = Array.from({ length: 12 }, () => BASE32[randomInt(BASE32.length)]).join('');
  await db.insert(pairingCodes).values({
    codeHash: createHash('sha256').update(raw).digest('hex'),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return raw;
}

export interface PairedMachine {
  machineId: string;
  token: string;
  /** Authorization header only. */
  auth: Record<string, string>;
}

export async function pairTestMachine(db: Database, name: string): Promise<PairedMachine> {
  const code = await insertPairingCode(db);
  const paired = await pairMachine(db, {
    code,
    name,
    hostname: `${name}.local`,
    os: 'darwin 25.5',
    hardware: { cpus: 8, memGb: 16 },
  });
  return {
    machineId: paired.machineId,
    token: paired.token,
    auth: { authorization: `Bearer ${paired.token}` },
  };
}

/** Headers for a daemon write: bearer token plus an Idempotency-Key (random unless given). */
export function writeHeaders(machine: PairedMachine, key = `test-${randomUUID()}`): Record<string, string> {
  return { ...machine.auth, 'idempotency-key': key };
}

/** Appends `count` owner-visible wake-up events targeted at a machine, each in its own transaction. */
export async function emitEvents(db: Database, machineId: string | null, count: number): Promise<string[]> {
  const ticketIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const ticketId = randomUUID();
    const payload: EventPayload = { type: 'ticket.unblocked', data: { ticketId } };
    await db.transaction((tx) => appendEvents(tx, [{ payload, ticketId, targetMachineId: machineId }]));
    ticketIds.push(ticketId);
  }
  return ticketIds;
}

export async function setTokenExpiry(db: Database, token: string, expiresAt: Date): Promise<void> {
  const hash = createHash('sha256').update(token).digest('hex');
  await db.execute(
    sql`update machine_tokens set expires_at = ${expiresAt.toISOString()}::timestamptz where token_hash = ${hash}`,
  );
}

export async function ownerRow(db: Database) {
  const [row] = await db.select().from(owner);
  if (!row) throw new Error('owner not seeded');
  return row;
}

// ---------------------------------------------------------------------------
// Real HTTP server and SSE client (streams cannot be tested with inject)
// ---------------------------------------------------------------------------

export interface TestServer {
  app: FastifyInstance;
  url: string;
}

export async function startServer(
  db: Database,
  realtime: BuildAppOptions['realtime'] = {},
  options: Pick<BuildAppOptions, 'closeDrainMs'> = {},
): Promise<TestServer> {
  const app = await buildApp({
    config: testConfig(),
    db,
    realtime: { sweeper: false, ...realtime },
    ...options,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('server has no TCP address');
  return { app, url: `http://127.0.0.1:${address.port}` };
}

export interface SseClient {
  status: number;
  events: EventEnvelope[];
  /** Resolves when the server ends the stream (or the client closes it). */
  closed: Promise<void>;
  isClosed(): boolean;
  /** Waits until at least `count` events arrived. */
  waitFor(count: number, timeoutMs?: number): Promise<EventEnvelope[]>;
  close(): void;
}

export async function openSse(url: string, headers: Record<string, string>): Promise<SseClient> {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  const events: EventEnvelope[] = [];
  let done = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const closed = (async () => {
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) return;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf('\n\n');
        while (split >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice(6))
            .join('\n');
          if (data) {
            events.push(JSON.parse(data) as EventEnvelope);
            notify();
          }
          split = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // aborted by close()
    } finally {
      done = true;
      notify();
    }
  })();

  return {
    status: response.status,
    events,
    closed,
    isClosed: () => done,
    close: () => controller.abort(),
    waitFor: (count, timeoutMs = 5_000) =>
      new Promise((resolve, reject) => {
        const check = () => {
          if (events.length >= count) {
            listeners.delete(check);
            clearTimeout(timer);
            resolve(events.slice());
          } else if (done) {
            listeners.delete(check);
            clearTimeout(timer);
            reject(new Error(`stream ended after ${events.length}/${count} events`));
          }
        };
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`timed out after ${events.length}/${count} events`));
        }, timeoutMs);
        listeners.add(check);
        check();
      }),
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once `promise` settles, or rejects after `ms`. */
export function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} did not happen in ${ms} ms`)), ms),
    ),
  ]);
}
