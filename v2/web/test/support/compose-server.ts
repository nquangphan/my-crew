/**
 * In-memory unit-test fake of the attachment producer routes (`v2/server/src/attachments/routes.ts`), driven
 * through the real Task2 `OwnerClient`/`PendingStore`. It mirrors the semantics the composer relies on:
 * revision CAS, idempotent replay by key with body comparison, compose-level submission replay, exact
 * active-ready selection, and the upload state machine. It is never used by E2E.
 */
import { createHash } from 'node:crypto';
import { createOwnerClient } from '../../src/lib/api.ts';
import { PendingStore, type TabStorage } from '../../src/lib/pending-operation.ts';
import { SessionController } from '../../src/lib/session.ts';

export const csrf = 'c'.repeat(64);
export const projectId = '11111111-1111-4111-8111-111111111111';
export const ticketId = '22222222-2222-4222-8222-222222222222';
export const conversationId = '33333333-3333-4333-8333-333333333333';

type Upload = {
  attachmentId: string;
  composeId: string;
  fileName: string;
  mime: string;
  byteLength: number;
  sha256: string;
  state: 'reserved' | 'receiving' | 'ready' | 'rejected' | 'abandoned';
};
type Compose = {
  id: string;
  purpose: 'ticket' | 'comment' | 'assistant_message';
  projectId: string | null;
  ticketId: string | null;
  conversationId?: string;
  revision: number;
  state: 'open' | 'submitted' | 'abandoned';
  /** Past `expiresAt`: the server rejects reserve, PUT and submission (`staging.ts:341,391`, `submissions.ts:133`). */
  expired?: boolean;
  /** Server-side expiry instant to report (default far future, or the past when `expired`). */
  expiresAt?: string;
};
export type Call = { method: string; url: string; headers: Headers; body: string | null };
type Reply = { status: number; body: unknown };

export class MemoryStorage implements TabStorage {
  readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

let counter = 0;
export function uuidFor(prefix: number): string {
  counter++;
  const tail = `${prefix}`.padStart(4, '0') + `${counter}`.padStart(8, '0');
  return `aaaaaaaa-bbbb-4ccc-8ddd-${tail}`;
}

export const policy = {
  policySha256: 'f'.repeat(64),
  maxFileBytes: 1024,
  maxComposeFiles: 5,
  maxComposeBytes: 4096,
  maxOwnerStagingBytes: 8192,
  stagingTtlMs: 86_400_000,
  cleanupGraceMs: 3_600_000,
  uploadLeaseMs: 120_000,
  uploadHeartbeatMs: 15_000,
  uploadMaxWallMs: 300_000,
  chunkBytes: 65_536,
  workerConcurrency: 1,
  workerMemoryMiB: 512,
  workerCpu: 1,
  workerPids: 32,
  workerWallMs: 120_000,
  allowedExtensions: ['png', 'jpg', 'jpeg', 'pdf', 'txt', 'csv', 'md'],
  limits: {
    maxExpandedBytes: 1,
    maxEntryBytes: 1,
    maxZipEntries: 1,
    maxCompressionRatio: 1,
    maxXmlDepth: 1,
    maxTextNodeBytes: 1,
    maxTextBytes: 1,
    maxCsvRows: 1,
    maxCsvColumns: 1,
    maxCsvFieldBytes: 1,
    maxPdfPages: 1,
    pdfDpi: 1,
    maxPagePixels: 1,
    maxImagePixels: 1,
    maxOutputBytes: 1,
  },
  supportedMime: ['image/png', 'application/pdf', 'text/plain'],
  extractionCapabilities: ['text', 'vision'],
};

function sha(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function error(status: number, code: string, message = code): Reply {
  return { status, body: { error: { code, message } } };
}

export class FakeComposeServer {
  readonly calls: Call[] = [];
  readonly composes = new Map<string, Compose>();
  readonly uploads = new Map<string, Upload>();
  readonly tickets: unknown[] = [];
  readonly comments: unknown[] = [];
  readonly messages: unknown[] = [];
  readonly #receipts = new Map<string, { body: string; reply: Reply }>();
  readonly #submissions = new Map<string, { hash: string; reply: Reply }>();
  authenticated = true;
  /** Commit the next matching request, then lose its response (transport error). */
  dropAfterCommit: ((call: Call) => boolean) | null = null;
  /** Fail matching request before commit with a transport error. */
  failBefore: ((call: Call) => boolean) | null = null;
  /** Commit the next matching request, then answer 201 with a body that does not match the contract. */
  corruptNext: ((call: Call) => boolean) | null = null;
  /** Server-side switches mirroring producer branches (`auth/routes.ts:43,47`, `auth/session.ts:116`). */
  sessionInvalid = false;
  originInvalid = false;
  ownerRequired = false;
  /** False: submissions with files answer 503 EXTRACTION_NOT_CONFIGURED (`submissions.ts:147`). */
  extractionConfigured = true;
  readonly #commentLinks: { ticketId: string; commentId: string; attachmentIds: string[] }[] = [];
  /** Hold matching requests (before the producer sees them) until `release()`. */
  hold: ((call: Call) => boolean) | null = null;
  #held: (() => void)[] = [];
  release(): void {
    for (const resume of this.#held.splice(0)) resume();
  }
  /** While true every PUT content fails with a transport error before reaching the producer. */
  blockPuts = false;
  /** PUT content answers 409 ATTACHMENT_UPLOAD_BUSY this many times while the upload reads `receiving`. */
  busyPuts = 0;

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string' ? init.body : init.body instanceof Blob ? await init.body.text() : null;
    const call: Call = { method, url, headers: new Headers(init.headers), body };
    this.calls.push(call);
    if (this.failBefore?.(call)) {
      this.failBefore = null;
      throw new TypeError('fetch failed');
    }
    if (this.blockPuts && method === 'PUT') throw new TypeError('fetch failed');
    if (this.hold?.(call)) await new Promise<void>((resume) => this.#held.push(resume));
    const bytes = init.body instanceof Blob ? new Uint8Array(await init.body.arrayBuffer()) : null;
    const reply = this.#handle(call, bytes);
    if (this.corruptNext?.(call) && reply.status < 300) {
      this.corruptNext = null;
      return new Response(JSON.stringify({ unexpected: true }), {
        status: reply.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (this.dropAfterCommit?.(call)) {
      this.dropAfterCommit = null;
      throw new TypeError('fetch failed');
    }
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  };

  #handle(call: Call, bytes: Uint8Array | null): Reply {
    const path = call.url;
    if (path === '/v2/auth/session' && call.method === 'GET')
      return this.authenticated
        ? { status: 200, body: { owner: { id: 'owner' }, csrfToken: csrf } }
        : error(401, 'UNAUTHENTICATED');
    if (path === '/v2/auth/session' && call.method === 'POST') {
      this.authenticated = true;
      return { status: 200, body: { owner: { id: 'owner' }, csrfToken: csrf } };
    }
    if (!this.authenticated) return error(401, 'UNAUTHENTICATED');
    if (this.sessionInvalid) return error(401, 'SESSION_INVALID');
    if (call.method === 'GET') return this.#read(path);
    if (this.ownerRequired) return error(403, 'OWNER_REQUIRED');
    if (this.originInvalid) return error(403, 'ORIGIN_INVALID');
    if (call.headers.get('x-csrf-token') !== csrf) return error(403, 'CSRF_INVALID');
    if (call.method === 'PUT') return this.#put(path, bytes ?? new Uint8Array());
    const key = call.headers.get('idempotency-key') ?? '';
    const route = `${call.method}:${path}:${key}`;
    const prior = this.#receipts.get(route);
    if (prior) return prior.body === call.body ? prior.reply : error(409, 'IDEMPOTENCY_CONFLICT');
    const reply = this.#mutate(call.method, path, JSON.parse(call.body ?? 'null'));
    if (reply.status < 300) this.#receipts.set(route, { body: call.body ?? '', reply });
    return reply;
  }

  #read(path: string): Reply {
    if (path === '/v2/attachment-policy') return { status: 200, body: policy };
    const byComment = /^\/v2\/tickets\/([^/?]+)\/attachments\/by-comment(?:\?(.*))?$/.exec(path);
    if (byComment) return this.#byComment(byComment[1] ?? '', new URLSearchParams(byComment[2] ?? ''));
    const match = /^\/v2\/attachment-compose\/([^/]+)$/.exec(path);
    const compose = match ? this.composes.get(match[1] ?? '') : undefined;
    if (!compose) return error(404, 'ATTACHMENT_NOT_FOUND');
    return {
      status: 200,
      body: {
        session: this.#session(compose),
        attachments: [...this.uploads.values()]
          .filter((upload) => upload.composeId === compose.id)
          .map((upload) => this.#attachment(upload)),
      },
    };
  }

  /** GET `/v2/tickets/:id/attachments/by-comment` (`comment-refs.ts`): keyset by commentId. */
  #byComment(ticket: string, query: URLSearchParams): Reply {
    const limit = Number(query.get('limit') ?? 50);
    const cursor = query.get('cursor');
    const groups = this.#commentLinks
      .filter((link) => link.ticketId === ticket && link.attachmentIds.length > 0)
      .filter((link) => cursor === null || link.commentId > cursor)
      .sort((a, b) => (a.commentId < b.commentId ? -1 : 1));
    const items = groups.slice(0, limit).map((link) => ({
      commentId: link.commentId,
      attachments: link.attachmentIds.map((id, index) => {
        const upload = this.uploads.get(id);
        return {
          linkId: `bbbbbbbb-cccc-4ddd-8eee-${String(index).padStart(4, '0')}${id.slice(-8)}`,
          attachmentId: id,
          sha256: upload?.sha256 ?? '0'.repeat(64),
          ownerId: 'owner',
          fileName: upload?.fileName ?? 'x',
          mime: upload?.mime ?? null,
          byteLength: upload?.byteLength ?? 0,
        };
      }),
    }));
    return {
      status: 200,
      body: { items, nextCursor: groups.length > limit ? (items.at(-1)?.commentId ?? null) : null },
    };
  }

  #session(compose: Compose) {
    return {
      id: compose.id,
      ownerId: 'owner',
      purpose: compose.purpose,
      projectId: compose.projectId,
      ticketId: compose.ticketId,
      ...(compose.conversationId ? { conversationId: compose.conversationId } : {}),
      revision: compose.revision,
      state: compose.state,
      expiresAt:
        compose.expiresAt ?? (compose.expired ? '2000-01-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z'),
    };
  }

  #attachment(upload: Upload) {
    return {
      attachmentId: upload.attachmentId,
      sha256: upload.sha256,
      ownerId: 'owner',
      composeSessionId: upload.composeId,
      fileName: upload.fileName,
      mime: upload.state === 'ready' ? upload.mime : null,
      byteLength: upload.byteLength,
      state: upload.state,
      extraction: 'pending',
      problems:
        upload.state === 'rejected' ? [{ code: 'ATTACHMENT_MAGIC_MISMATCH', message: 'x', unitIds: [] }] : [],
    };
  }

  #put(path: string, bytes: Uint8Array): Reply {
    const id = /^\/v2\/attachment-uploads\/([^/]+)\/content$/.exec(path)?.[1] ?? '';
    const upload = this.uploads.get(id);
    if (!upload) return error(404, 'ATTACHMENT_NOT_FOUND');
    if (this.busyPuts > 0) {
      this.busyPuts--;
      upload.state = 'receiving';
      if (this.busyPuts === 0) upload.state = 'ready';
      return error(409, 'ATTACHMENT_UPLOAD_BUSY');
    }
    if (upload.state === 'ready') return { status: 200, body: this.#attachment(upload) };
    if (this.composes.get(upload.composeId)?.expired) return error(409, 'ATTACHMENT_UPLOAD_EXPIRED');
    if (upload.state !== 'reserved') return error(409, 'ATTACHMENT_UPLOAD_CONFLICT');
    if (bytes.byteLength !== upload.byteLength || sha(bytes) !== upload.sha256)
      return error(409, 'ATTACHMENT_REPLAY_MISMATCH');
    upload.state = 'ready';
    return { status: 201, body: this.#attachment(upload) };
  }

  #mutate(method: string, path: string, body: Record<string, unknown>): Reply {
    if (method === 'POST' && path === '/v2/attachment-compose') {
      const id = uuidFor(1);
      const compose: Compose = {
        id,
        purpose: body.purpose as Compose['purpose'],
        projectId: body.projectId as string | null,
        ticketId: body.ticketId as string | null,
        ...(typeof body.conversationId === 'string' ? { conversationId: body.conversationId } : {}),
        revision: 1,
        state: 'open',
      };
      this.composes.set(id, compose);
      return { status: 201, body: this.#session(compose) };
    }
    let match = /^\/v2\/attachment-compose\/([^/]+)\/uploads$/.exec(path);
    if (method === 'POST' && match) {
      const compose = this.composes.get(match[1] ?? '');
      if (!compose) return error(404, 'ATTACHMENT_NOT_FOUND');
      if (compose.state !== 'open' || compose.expired) return error(409, 'ATTACHMENT_COMPOSE_CLOSED');
      if (compose.revision !== body.expectedRevision) return error(409, 'ATTACHMENT_SELECTION_STALE');
      const upload: Upload = {
        attachmentId: uuidFor(2),
        composeId: compose.id,
        fileName: String(body.fileName),
        mime: String(body.declaredMime),
        byteLength: Number(body.byteLength),
        sha256: String(body.sha256),
        state: 'reserved',
      };
      this.uploads.set(upload.attachmentId, upload);
      compose.revision++;
      return {
        status: 201,
        body: { attachment: this.#attachment(upload), selectionRevision: compose.revision },
      };
    }
    match = /^\/v2\/attachment-compose\/([^/]+)\/uploads\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && match) {
      const compose = this.composes.get(match[1] ?? '');
      const upload = this.uploads.get(match[2] ?? '');
      if (compose?.state !== 'open' || compose.revision !== body.expectedRevision)
        return error(409, 'ATTACHMENT_SELECTION_STALE');
      if (!upload || upload.state === 'abandoned') return error(409, 'ATTACHMENT_UPLOAD_CONFLICT');
      upload.state = 'abandoned';
      compose.revision++;
      return { status: 200, body: { selectionRevision: compose.revision } };
    }
    match = /^\/v2\/attachment-compose\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && match) {
      const compose = this.composes.get(match[1] ?? '');
      if (compose?.state !== 'open' || compose.revision !== body.expectedRevision)
        return error(409, 'ATTACHMENT_SELECTION_STALE');
      for (const upload of this.uploads.values())
        if (upload.composeId === compose.id) upload.state = 'abandoned';
      compose.state = 'abandoned';
      compose.revision++;
      return { status: 200, body: this.#session(compose) };
    }
    if (method === 'POST' && path === '/v2/attachment-submissions/tickets')
      return this.#submit('ticket', body, () => {
        const ticket = {
          ...(body.ticket as Record<string, unknown>),
          id: uuidFor(3),
          rootId: '',
          status: 'pending',
          revision: 1,
          waitReason: null,
          repairCycles: 0,
          mergedCommit: null,
        };
        ticket.rootId = ticket.id;
        delete (ticket as { deployApprovalDecisionId?: unknown }).deployApprovalDecisionId;
        this.tickets.push(ticket);
        return { ticket };
      });
    match = /^\/v2\/tickets\/([^/]+)\/attachment-comments$/.exec(path);
    if (method === 'POST' && match)
      return this.#submit('comment', body, (ids) => {
        const comment = {
          id: uuidFor(4),
          ticketId: match?.[1],
          actor: { kind: 'owner', id: 'owner' },
          text: body.text,
          createdAt: '2026-10-04T03:00:00.000Z',
        };
        this.comments.push(comment);
        this.#commentLinks.push({ ticketId: String(match?.[1]), commentId: comment.id, attachmentIds: ids });
        return { comment };
      });
    if (method === 'POST' && path === '/v2/attachment-submissions/messages')
      return this.#submit('assistant_message', body, (ids) => {
        const message = {
          id: uuidFor(5),
          conversationId: body.conversationId,
          ownerId: 'owner',
          text: body.text,
          attachmentIds: ids,
          inputRevision: '1',
          routeRevision: 0,
          createdAt: '2026-10-04T03:00:00.000Z',
        };
        this.messages.push(message);
        return message;
      });
    return error(404, 'ROUTE_NOT_FOUND');
  }

  #submit(
    purpose: Compose['purpose'],
    body: Record<string, unknown>,
    create: (attachmentIds: string[]) => Record<string, unknown>,
  ): Reply {
    const selection = body.selection as {
      composeSessionId: string;
      selectionRevision: number;
      attachmentIds: string[];
    };
    const hash = sha(JSON.stringify(body));
    const prior = this.#submissions.get(selection.composeSessionId);
    if (prior) return prior.hash === hash ? prior.reply : error(409, 'COMPOSE_ALREADY_SUBMITTED');
    const compose = this.composes.get(selection.composeSessionId);
    if (!compose || compose.purpose !== purpose) return error(404, 'NOT_FOUND');
    if (compose.state !== 'open' || compose.revision !== selection.selectionRevision || compose.expired)
      return error(409, 'SELECTION_CHANGED');
    const ids = [...selection.attachmentIds].sort();
    for (const id of ids)
      if (this.uploads.get(id)?.composeId !== compose.id)
        return error(404, 'NOT_FOUND', 'Không tìm thấy tệp');
    const active = [...this.uploads.values()].filter(
      (upload) => upload.composeId === compose.id && upload.state !== 'abandoned',
    );
    if (active.length !== ids.length || active.some((upload) => !ids.includes(upload.attachmentId)))
      return error(409, 'SELECTION_CHANGED');
    if (active.length > 0 && !this.extractionConfigured)
      return error(503, 'EXTRACTION_NOT_CONFIGURED', 'Chưa cấu hình xử lý tệp');
    if (active.some((upload) => upload.state !== 'ready')) return error(422, 'ATTACHMENT_NOT_READY');
    const response = create(ids);
    const reply = {
      status: 201,
      body: purpose === 'assistant_message' ? response : { ...response, attachmentIds: ids },
    };
    compose.state = 'submitted';
    compose.revision++;
    this.#submissions.set(compose.id, { hash, reply });
    return reply;
  }
}

/** Real Task2 session/pending/client over the fake producer. */
export async function harness(server: FakeComposeServer, storage: MemoryStorage = new MemoryStorage()) {
  const session = new SessionController({ fetch: server.fetch });
  await session.bootstrap();
  const pending = new PendingStore(storage);
  const client = createOwnerClient({
    session,
    pending,
    fetch: server.fetch,
    sleep: async () => undefined,
    maxRetries: 0,
  });
  return { session, pending, client, storage };
}

/** Synchronous hasher with the real SHA-256 for unit tests (the worker path has its own tests). */
export function inlineHasher() {
  let disposed = 0;
  return {
    hasher: {
      async hash(file: File, maxBytes: number) {
        if (file.size > maxBytes) throw new Error('CLIENT_HASH_LIMIT');
        return sha(new Uint8Array(await file.arrayBuffer()));
      },
      dispose() {
        disposed++;
      },
    },
    disposed: () => disposed,
  };
}

export const pngBytes = (seed: number) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, seed + 1]);

export function pngFile(name: string, seed: number): File {
  return new File([pngBytes(seed)], name, { type: 'image/png' });
}

/** Wait until the controller settles (queue and file pipeline). */
export async function settle(predicate: () => boolean, label = 'settle'): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`TIMEOUT:${label}`);
}
