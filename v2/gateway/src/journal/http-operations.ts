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
export class HttpOperationJournal {
  private readonly store: AtomicRecords;
  private readonly transport: HttpTransport;
  private constructor(store: AtomicRecords, transport: HttpTransport) {
    this.store = store;
    this.transport = transport;
  }
  static async open(root: string, transport: HttpTransport): Promise<HttpOperationJournal> {
    await privateDirectory(root);
    return new HttpOperationJournal(await AtomicRecords.open(join(root, 'http-operations')), transport);
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
  close(): Promise<void> {
    return this.store.close();
  }
}
