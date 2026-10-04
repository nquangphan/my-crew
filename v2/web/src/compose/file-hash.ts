/**
 * SHA-256 of one File at a time in an owned dedicated worker. WebCrypto has no streaming digest, so the
 * bytes of exactly one policy-bounded file are read into one ArrayBuffer, digested and released; no base64
 * copy is made. Cancelling terminates the worker, which stops the read/digest and frees its memory; the next
 * hash starts a fresh worker.
 */

export type HashRequest = { id: number; file: File; maxBytes: number };
export type HashResponse = { id: number; sha256: string } | { id: number; error: string };

export interface FileHasher {
  /** Rejects with `HashError` (`HASH_ABORTED`, `CLIENT_HASH_LIMIT`, `HASH_FAILED`). */
  hash(file: File, maxBytes: number, signal?: AbortSignal): Promise<string>;
  dispose(): void;
}

export class HashError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'HashError';
    this.code = code;
  }
}

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Digest used inside the worker (and directly in tests). Refuses files above the budget before reading. */
export async function digestFile(file: Blob, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || file.size > maxBytes)
    throw new HashError('CLIENT_HASH_LIMIT');
  let bytes: ArrayBuffer | null = await file.arrayBuffer();
  try {
    return toHex(await crypto.subtle.digest('SHA-256', bytes));
  } finally {
    bytes = null;
  }
}

/** Handles one worker message; exported so the worker entry stays a thin adapter. */
export async function answerHashRequest(request: HashRequest): Promise<HashResponse> {
  try {
    return { id: request.id, sha256: await digestFile(request.file, request.maxBytes) };
  } catch (error) {
    return { id: request.id, error: error instanceof HashError ? error.code : 'HASH_FAILED' };
  }
}

/** Minimal worker surface so tests can drive the hasher without a browser. */
export type HashWorker = {
  postMessage(message: HashRequest): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<HashResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<HashResponse>) => void): void;
  removeEventListener(type: 'error', listener: (event: Event) => void): void;
};

export function defaultHashWorker(): HashWorker {
  return new Worker(new URL('./file-hash.worker.ts', import.meta.url), {
    type: 'module',
    name: 'crew-v2-file-hash',
  }) as unknown as HashWorker;
}

/**
 * Serial hasher: one file in flight; later calls queue behind it. Abort of the current file terminates the
 * worker; abort of a queued file just drops it.
 */
export function createWorkerHasher(createWorker: () => HashWorker = defaultHashWorker): FileHasher {
  let worker: HashWorker | null = null;
  let nextId = 1;
  let tail: Promise<unknown> = Promise.resolve();
  let disposed = false;
  const stopWorker = () => {
    worker?.terminate();
    worker = null;
  };

  const run = (file: File, maxBytes: number, signal?: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      if (disposed) return reject(new HashError('HASH_ABORTED'));
      if (signal?.aborted) return reject(new HashError('HASH_ABORTED'));
      if (file.size > maxBytes) return reject(new HashError('CLIENT_HASH_LIMIT'));
      worker ??= createWorker();
      const current = worker;
      const id = nextId++;
      const cleanup = () => {
        current.removeEventListener('message', onMessage);
        current.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };
      const onMessage = (event: MessageEvent<HashResponse>) => {
        if (event.data.id !== id) return;
        cleanup();
        if ('sha256' in event.data) resolve(event.data.sha256);
        else reject(new HashError(event.data.error));
      };
      const onError = () => {
        cleanup();
        if (worker === current) stopWorker();
        reject(new HashError('HASH_FAILED'));
      };
      const onAbort = () => {
        cleanup();
        if (worker === current) stopWorker();
        reject(new HashError('HASH_ABORTED'));
      };
      current.addEventListener('message', onMessage);
      current.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
      current.postMessage({ id, file, maxBytes });
    });

  return {
    hash(file, maxBytes, signal) {
      const result = tail.then(() => run(file, maxBytes, signal));
      tail = result.catch(() => undefined);
      return result;
    },
    dispose() {
      disposed = true;
      stopWorker();
    },
  };
}
