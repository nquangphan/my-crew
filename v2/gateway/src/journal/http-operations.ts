import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AtomicRecords, canonicalJson, hash, privateDirectory } from './atomic-records.ts';
export type HttpRequest = {
  operationId: string;
  method: 'POST' | 'PUT';
  route: string;
  phase: string;
  canonicalBody: unknown;
  idempotencyKey: string;
  bodyHash: string;
};
export type HttpResponse = { status: number; body: unknown };
export type HttpTransport = (request: Readonly<HttpRequest>) => Promise<HttpResponse>;
function rejectSecrets(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (
        /^(?:token|accessToken|refreshToken|authorization|secret|password|credential|apiKey|clientSecret)$/i.test(
          key,
        )
      )
        throw new Error('SECRET_BODY_FORBIDDEN');
      rejectSecrets(item);
    }
  }
}
function freezeDeep<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}
type Operation = HttpRequest & { formatVersion: 1; response: HttpResponse | null };
type RetryHistory = {
  formatVersion: 1;
  operationId: string;
  idempotencyKey: string;
  bodyHash: string;
  retryAt: number;
  attempts: { startedAt: number; response: HttpResponse | null }[];
};
const transient = (status: number) => [500, 502, 503, 504].includes(status);
export class HttpOperationJournal {
  private readonly store: AtomicRecords;
  private readonly transport: HttpTransport;
  private readonly retries: AtomicRecords;
  private readonly now: () => number;
  private constructor(
    store: AtomicRecords,
    retries: AtomicRecords,
    transport: HttpTransport,
    now: () => number,
  ) {
    this.store = store;
    this.transport = transport;
    this.retries = retries;
    this.now = now;
  }
  static async open(
    root: string,
    transport: HttpTransport,
    options: { now?: () => number } = {},
  ): Promise<HttpOperationJournal> {
    await privateDirectory(root);
    const store = await AtomicRecords.open(join(root, 'http-operations'));
    try {
      return new HttpOperationJournal(
        store,
        await AtomicRecords.open(join(root, 'http-retries')),
        transport,
        options.now ?? Date.now,
      );
    } catch (error) {
      await store.close();
      throw error;
    }
  }
  async prepare(input: {
    operationId: string;
    method: 'POST' | 'PUT';
    route: string;
    phase: string;
    canonicalBody: unknown;
  }): Promise<{ idempotencyKey: string; bodyHash: string }> {
    if (
      !input.operationId ||
      !input.phase ||
      !/^\/v2\/[A-Za-z0-9_/?=&.-]+$/.test(input.route) ||
      input.route.includes('..')
    )
      throw new Error('INVALID_OPERATION');
    rejectSecrets(input.canonicalBody);
    const body = canonicalJson(input.canonicalBody);
    return this.store.transaction(async () => {
      const old = await this.store.get<Operation>(input.operationId);
      if (old) {
        if (
          old.route !== input.route ||
          old.phase !== input.phase ||
          old.method !== input.method ||
          canonicalJson(old.canonicalBody) !== body
        )
          throw new Error('OPERATION_CONFLICT');
        return { idempotencyKey: old.idempotencyKey, bodyHash: old.bodyHash };
      }
      const operation: Operation = {
        ...input,
        canonicalBody: JSON.parse(body),
        formatVersion: 1,
        idempotencyKey: randomUUID(),
        bodyHash: hash(body),
        response: null,
      };
      await this.store.put(input.operationId, operation);
      return { idempotencyKey: operation.idempotencyKey, bodyHash: operation.bodyHash };
    });
  }
  async recordResponse(operationId: string, status: number, body: unknown): Promise<void> {
    await this.store.transaction(async () => {
      const operation = await this.store.get<Operation>(operationId);
      if (!operation) throw new Error('UNKNOWN_OPERATION');
      const response = { status, body };
      if (operation.response && canonicalJson(operation.response) !== canonicalJson(response))
        throw new Error('RESPONSE_CONFLICT');
      operation.response = response;
      await this.store.put(operationId, operation);
    });
  }
  async replay(operationId: string): Promise<HttpResponse> {
    const operation = await this.store.get<Operation>(operationId);
    if (!operation) throw new Error('UNKNOWN_OPERATION');
    if (operation.response) return operation.response;
    const { formatVersion: _version, response: _response, ...request } = operation;
    const response = await this.transport(freezeDeep(request));
    await this.recordResponse(operationId, response.status, response.body);
    return response;
  }
  /** Additive recovery history. replay() still returns the immutable first response. */
  async retryTransient(operationId: string): Promise<HttpResponse> {
    return this.retries.transaction(async () => {
      const original = await this.replay(operationId);
      if (!transient(original.status)) return original;
      const operation = await this.store.get<Operation>(operationId);
      if (!operation) throw new Error('UNKNOWN_OPERATION');
      let history = await this.retries.get<RetryHistory>(operationId);
      if (!history) {
        history = {
          formatVersion: 1,
          operationId,
          idempotencyKey: operation.idempotencyKey,
          bodyHash: operation.bodyHash,
          retryAt: this.now() + 1000,
          attempts: [],
        };
        await this.retries.put(operationId, history);
        return original;
      }
      if (
        history.operationId !== operationId ||
        history.idempotencyKey !== operation.idempotencyKey ||
        history.bodyHash !== operation.bodyHash
      )
        throw new Error('RETRY_HISTORY_CONFLICT');
      const last = history.attempts.at(-1);
      if (last?.response && !transient(last.response.status)) return last.response;
      const confirmed =
        last?.response ??
        [...history.attempts].reverse().find((attempt) => attempt.response)?.response ??
        original;
      if (this.now() < history.retryAt) return confirmed;
      const pending = last && !last.response ? last : { startedAt: this.now(), response: null };
      if (pending !== last) history.attempts.push(pending);
      history.retryAt = this.now() + Math.min(60000, 1000 * 2 ** Math.min(history.attempts.length, 6));
      // Persist before transport. Ambiguity keeps this pending attempt and the original key.
      await this.retries.put(operationId, history);
      const { formatVersion: _version, response: _response, ...request } = operation;
      const response = await this.transport(freezeDeep(request));
      pending.response = response;
      await this.retries.put(operationId, history);
      return response;
    });
  }
  async close(): Promise<void> {
    await this.retries.close();
    await this.store.close();
  }
}
