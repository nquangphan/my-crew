/**
 * Tab-scoped registry of owner mutations whose outcome is not yet confirmed.
 *
 * Invariants:
 * - `bodyJson` is serialized exactly once per operation; retries and replays send the same `id` (the
 *   Idempotency-Key) and the same bytes.
 * - One intent has at most one unresolved key. A new key is issued only after the previous operation was
 *   confirmed accepted or terminally rejected.
 * - Secret payloads (`storage: 'memory'`) never reach sessionStorage; only their payload-free tombstone does,
 *   so a reload or closed secret form leaves recovery metadata without the secret.
 */
import { isUuid } from '../contracts/http.ts';

export type PendingOperation = {
  id: string;
  intentId: string;
  ownerId: 'owner';
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  bodyJson: string;
  storage: 'tab' | 'memory';
  state: 'pending' | 'ambiguous' | 'suspended' | 'accepted' | 'rejected';
};

export type RecoveryTombstone = {
  id: string;
  intentId: string;
  ownerId: 'owner';
  method: PendingOperation['method'];
  path: string;
  targetId: string | null;
  expectedRevision: number | null;
  state: 'needs_payload';
};

export type TabStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type BeginInput = {
  intentId: string;
  method: PendingOperation['method'];
  path: string;
  body: unknown;
  storage: PendingOperation['storage'];
};

export const pendingStorageKey = 'crew-v2:pending';
const storageVersion = 1;
const secretKey = /password|secret|token|credential|api[-_]?key|authorization|cookie/i;
const methods = new Set(['POST', 'PUT', 'DELETE']);

export class IntentUnresolvedError extends Error {
  readonly intentId: string;
  readonly operationId: string;

  constructor(intentId: string, operationId: string) {
    super('INTENT_UNRESOLVED');
    this.name = 'IntentUnresolvedError';
    this.intentId = intentId;
    this.operationId = operationId;
  }
}

export class PendingSerializationError extends Error {
  constructor(reason: string) {
    super(`PENDING_NOT_SERIALIZABLE:${reason}`);
    this.name = 'PendingSerializationError';
  }
}

/** True when any object key in the JSON payload names a credential, token or a hash of one. */
export function containsSecret(bodyJson: string): boolean {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (value && typeof value === 'object')
      return Object.entries(value).some(([key, item]) => secretKey.test(key) || visit(item));
    return false;
  };
  return visit(JSON.parse(bodyJson));
}

function assertOperationPath(path: string): void {
  if (!/^\/v2\/[A-Za-z0-9._~%/-]*$/.test(path) || path.includes('//') || /(^|\/)\.\.?(\/|$)/.test(path))
    throw new PendingSerializationError('PATH');
}

function tombstoneOf(operation: PendingOperation): RecoveryTombstone {
  let expectedRevision: number | null = null;
  try {
    const body: unknown = JSON.parse(operation.bodyJson);
    if (body && typeof body === 'object' && 'expectedRevision' in body) {
      const revision = (body as { expectedRevision: unknown }).expectedRevision;
      if (typeof revision === 'number' && Number.isSafeInteger(revision)) expectedRevision = revision;
    }
  } catch {
    expectedRevision = null;
  }
  return {
    id: operation.id,
    intentId: operation.intentId,
    ownerId: 'owner',
    method: operation.method,
    path: operation.path,
    targetId: operation.path.split('/').find(isUuid) ?? null,
    expectedRevision,
    state: 'needs_payload',
  };
}

/**
 * Serializer for the tab record. Rejects memory operations and any payload carrying a secret, token or a
 * secret's hash; response bodies are not part of the record shape at all.
 */
export function serializePending(state: {
  operations: readonly PendingOperation[];
  tombstones: readonly RecoveryTombstone[];
}): string {
  const operations = state.operations.map((operation) => {
    if (operation.storage !== 'tab') throw new PendingSerializationError('MEMORY_OPERATION');
    if (containsSecret(operation.bodyJson)) throw new PendingSerializationError('SECRET_PAYLOAD');
    const { id, intentId, ownerId, method, path, bodyJson, storage, state: status } = operation;
    return { id, intentId, ownerId, method, path, bodyJson, storage, state: status };
  });
  const tombstones = state.tombstones.map((tombstone) => {
    const { id, intentId, ownerId, method, path, targetId, expectedRevision } = tombstone;
    return {
      id,
      intentId,
      ownerId,
      method,
      path,
      targetId,
      expectedRevision,
      state: 'needs_payload' as const,
    };
  });
  return JSON.stringify({ version: storageVersion, operations, tombstones });
}

function parseRecord(
  raw: string,
): { operations: PendingOperation[]; tombstones: RecoveryTombstone[] } | null {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== storageVersion)
    return null;
  const record = parsed as { operations?: unknown; tombstones?: unknown };
  const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
  const operations = (Array.isArray(record.operations) ? record.operations : []).flatMap(
    (item): PendingOperation[] => {
      const value = item as Record<string, unknown>;
      if (!text(value.id) || !text(value.intentId) || !text(value.path) || !text(value.bodyJson)) return [];
      if (value.storage !== 'tab' || !methods.has(String(value.method))) return [];
      // A reload cannot know whether the last send reached the server.
      return [
        Object.freeze({
          id: value.id,
          intentId: value.intentId,
          ownerId: 'owner' as const,
          method: value.method as PendingOperation['method'],
          path: value.path,
          bodyJson: value.bodyJson,
          storage: 'tab' as const,
          state: value.state === 'suspended' ? ('suspended' as const) : ('ambiguous' as const),
        }),
      ];
    },
  );
  const tombstones = (Array.isArray(record.tombstones) ? record.tombstones : []).flatMap(
    (item): RecoveryTombstone[] => {
      const value = item as Record<string, unknown>;
      if (!text(value.id) || !text(value.intentId) || !text(value.path) || !methods.has(String(value.method)))
        return [];
      return [
        {
          id: value.id,
          intentId: value.intentId,
          ownerId: 'owner',
          method: value.method as PendingOperation['method'],
          path: value.path,
          targetId: isUuid(value.targetId) ? value.targetId : null,
          expectedRevision:
            typeof value.expectedRevision === 'number' && Number.isSafeInteger(value.expectedRevision)
              ? value.expectedRevision
              : null,
          state: 'needs_payload',
        },
      ];
    },
  );
  return { operations, tombstones };
}

export class PendingStore {
  readonly #storage: TabStorage | null;
  readonly #newId: () => string;
  readonly #operations = new Map<string, PendingOperation>();
  readonly #tombstones = new Map<string, RecoveryTombstone>();
  readonly #listeners = new Set<() => void>();
  readonly #resumed = new Set<string>();
  readonly #sending = new Set<string>();
  #listSnapshot: readonly PendingOperation[] | null = null;
  #tombstoneSnapshot: readonly RecoveryTombstone[] | null = null;
  #unknownVersion = false;

  constructor(storage: TabStorage | null, newId: () => string = () => crypto.randomUUID()) {
    this.#storage = storage;
    this.#newId = newId;
    const raw = storage?.getItem(pendingStorageKey) ?? null;
    if (raw === null) return;
    let record: ReturnType<typeof parseRecord>;
    try {
      record = parseRecord(raw);
    } catch {
      record = null;
    }
    if (!record) {
      // Unknown or corrupt version: keep the stored metadata untouched and never auto-send it.
      this.#unknownVersion = true;
      return;
    }
    for (const operation of record.operations) this.#operations.set(operation.id, operation);
    for (const tombstone of record.tombstones) this.#tombstones.set(tombstone.id, tombstone);
  }

  /** True when the tab holds a record of an unknown version that needs an explicit owner decision. */
  get unknownVersion(): boolean {
    return this.#unknownVersion;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get(id: string): PendingOperation | undefined {
    return this.#operations.get(id);
  }

  /** Stable snapshot until the next change (safe for `useSyncExternalStore`). */
  list(): readonly PendingOperation[] {
    this.#listSnapshot ??= Object.freeze([...this.#operations.values()]);
    return this.#listSnapshot;
  }

  /** Stable snapshot until the next change (safe for `useSyncExternalStore`). */
  tombstones(): readonly RecoveryTombstone[] {
    this.#tombstoneSnapshot ??= Object.freeze([...this.#tombstones.values()]);
    return this.#tombstoneSnapshot;
  }

  /** Unresolved entry (operation or tombstone) for an intent, if any. */
  unresolved(intentId: string): PendingOperation | RecoveryTombstone | undefined {
    return (
      [...this.#operations.values()].find((operation) => operation.intentId === intentId) ??
      [...this.#tombstones.values()].find((tombstone) => tombstone.intentId === intentId)
    );
  }

  begin(input: BeginInput): PendingOperation {
    if (!input.intentId) throw new PendingSerializationError('INTENT');
    if (!methods.has(input.method)) throw new PendingSerializationError('METHOD');
    assertOperationPath(input.path);
    const existing = this.unresolved(input.intentId);
    if (existing) throw new IntentUnresolvedError(input.intentId, existing.id);
    const operation = this.#freeze(this.#newId(), input, 'pending');
    this.#operations.set(operation.id, operation);
    this.#commit();
    return operation;
  }

  /**
   * Re-enter the exact payload for a tombstone. The original key is reused so the server compares body
   * hashes; nothing here edits the payload or issues a new key.
   */
  resume(id: string, body: unknown, storage: PendingOperation['storage']): PendingOperation {
    const tombstone = this.#tombstones.get(id);
    if (!tombstone) throw new IntentUnresolvedError('', id);
    const operation = this.#freeze(id, { ...tombstone, body, storage }, 'suspended');
    this.#tombstones.delete(id);
    this.#resumed.add(id);
    this.#operations.set(id, operation);
    this.#commit();
    return operation;
  }

  /** True for an operation re-entered from a tombstone; its bytes may differ from the original send. */
  isResumed(id: string): boolean {
    return this.#resumed.has(id);
  }

  /** Single-flight per operation: false when a send for this key is already in flight in this tab. */
  claim(id: string): boolean {
    if (this.#sending.has(id)) return false;
    this.#sending.add(id);
    return true;
  }

  release(id: string): void {
    this.#sending.delete(id);
  }

  markPending(id: string): void {
    this.#setState(id, 'pending');
  }

  markAmbiguous(id: string): void {
    this.#setState(id, 'ambiguous');
  }

  markSuspended(id: string): void {
    this.#setState(id, 'suspended');
  }

  /** Confirmed acceptance: the draft and its key are released. */
  accept(id: string): void {
    this.#resumed.delete(id);
    this.#operations.delete(id);
    this.#tombstones.delete(id);
    this.#commit();
  }

  /** Terminal rejection: the server did not apply the key, so the intent may start a new operation. */
  reject(id: string): void {
    this.#resumed.delete(id);
    this.#operations.delete(id);
    this.#tombstones.delete(id);
    this.#commit();
  }

  /**
   * IDEMPOTENCY_CONFLICT on a re-entered payload: drop the wrong payload, keep the key as a tombstone.
   * For a live operation the key and payload stay as they are.
   */
  conflict(id: string): void {
    const operation = this.#operations.get(id);
    if (!operation) return;
    if (this.#resumed.has(id)) {
      this.#resumed.delete(id);
      this.#operations.delete(id);
      this.#tombstones.set(id, tombstoneOf(operation));
    } else {
      this.#operations.set(id, Object.freeze({ ...operation, state: 'ambiguous' }));
    }
    this.#commit();
  }

  /** Session expired: keep every payload (secret ones only in memory), block sends until reauth. */
  suspendAll(): void {
    for (const operation of this.#operations.values()) {
      if (operation.state === 'pending' || operation.state === 'ambiguous')
        this.#operations.set(operation.id, Object.freeze({ ...operation, state: 'suspended' }));
    }
    this.#commit();
  }

  /** Explicit logout: every unresolved operation becomes a payload-free tombstone. */
  tombstoneAll(): void {
    for (const operation of this.#operations.values())
      this.#tombstones.set(operation.id, tombstoneOf(operation));
    this.#operations.clear();
    this.#resumed.clear();
    this.#commit();
  }

  /** Secret form closed or tab hidden for unload: wipe memory payloads, keep tombstones. */
  discardMemory(intentId?: string): void {
    for (const operation of this.#operations.values()) {
      if (operation.storage !== 'memory' || (intentId !== undefined && operation.intentId !== intentId))
        continue;
      this.#operations.delete(operation.id);
      this.#resumed.delete(operation.id);
      this.#tombstones.set(operation.id, tombstoneOf(operation));
    }
    this.#commit();
  }

  #freeze(
    id: string,
    input: Omit<BeginInput, 'intentId'> & { intentId: string },
    state: PendingOperation['state'],
  ): PendingOperation {
    if (input.storage !== 'tab' && input.storage !== 'memory') throw new PendingSerializationError('STORAGE');
    let bodyJson: string | undefined;
    try {
      bodyJson = JSON.stringify(input.body);
    } catch {
      bodyJson = undefined;
    }
    if (typeof bodyJson !== 'string') throw new PendingSerializationError('BODY');
    if (input.storage === 'tab' && containsSecret(bodyJson))
      throw new PendingSerializationError('SECRET_PAYLOAD');
    return Object.freeze({
      id,
      intentId: input.intentId,
      ownerId: 'owner',
      method: input.method,
      path: input.path,
      bodyJson,
      storage: input.storage,
      state,
    });
  }

  #setState(id: string, state: 'pending' | 'ambiguous' | 'suspended'): void {
    const operation = this.#operations.get(id);
    if (!operation) return;
    this.#operations.set(id, Object.freeze({ ...operation, state }));
    this.#commit();
  }

  #commit(): void {
    this.#listSnapshot = null;
    this.#tombstoneSnapshot = null;
    if (this.#storage && !this.#unknownVersion) {
      const operations = [...this.#operations.values()];
      const record = serializePending({
        operations: operations.filter((operation) => operation.storage === 'tab'),
        // Memory operations persist only as tombstones so reload never resurrects a secret.
        tombstones: [
          ...this.#tombstones.values(),
          ...operations.filter((operation) => operation.storage === 'memory').map(tombstoneOf),
        ],
      });
      if (operations.length === 0 && this.#tombstones.size === 0) this.#storage.removeItem(pendingStorageKey);
      else this.#storage.setItem(pendingStorageKey, record);
    }
    for (const listener of this.#listeners) listener();
  }
}
