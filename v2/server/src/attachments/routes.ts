import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateCurrentCredential } from '../auth/routes.ts';
import type { Actor, Id, RouteDependencies, ServerOptions, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { CreateTicket } from '../tickets/contracts.ts';
import { requireProjectScope } from '../tickets/service.ts';
import {
  type AttachmentExecutionGate,
  assertAttachmentExecutionCurrent,
  authorizeAttachment,
  denyAttachmentExecution,
  liveLinkIds,
  notFound,
  readAuthorizedManifest,
} from './access.ts';
import type { AttachmentConfig } from './config.ts';
import type {
  AssistantInputAuthority,
  AssistantReadReceipt,
  AttemptReadContext,
  BlobHandle,
  BlobStore,
  ComposeTarget,
  InputManifest,
  InputReceipt,
  InputRoutingAuthority,
  PreclaimSelectionAuthority,
  RequiredInput,
  RouteMessageInput,
  RouteRetirementAuthority,
  Selection,
  StageServices,
} from './contracts.ts';
import {
  appendAssistantReadReceipt,
  assertGrantCurrent,
  authorizeAssistantRepresentation,
  bindGrantSnapshot,
  createInputReadAuthorization,
  denyAssistantInput,
  denyPreclaimSelection,
  issueAssistantReadGrant,
  readAssistantSession,
  revokeAssistantGrant,
  revokeInputAuthorization,
  startAssistantReadSession,
} from './grants.ts';
import type { createMessageServices, MessageDecisionInput } from './messages.ts';
import { inheritAttachmentLinks, lockInputTarget } from './references.ts';
import { createRoutingServices } from './routing.ts';
import { readInputSnapshot } from './snapshots.ts';
import { authorizeSubmission, type createAttachmentSubmissions } from './submissions.ts';

export type AttachmentSubmissions = ReturnType<typeof createAttachmentSubmissions>;
export interface AttachmentInputServices {
  buildManifest(
    tx: Tx,
    input: {
      context: AttemptReadContext;
      decisionId: Id;
      required: RequiredInput[];
      inputRevision: string;
      snapshotId: Id;
      snapshotSha256: string;
    },
    actor: Actor,
  ): Promise<InputManifest>;
  appendReceipt(tx: Tx, input: InputReceipt, actor: Actor): Promise<Id>;
}
type Schema = Record<string, unknown>;
const uuid = { type: 'string', format: 'uuid' };
const nullable = (schema: Schema) => ({ anyOf: [schema, { type: 'null' }] });
const text = (maxLength = 200, minLength = 0) => ({ type: 'string', maxLength, minLength });
const integer = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const counter = { type: 'string', pattern: '^[1-9][0-9]*$' };
const hash = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const object = (properties: Record<string, Schema>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const array = (items: Schema, maxItems = 100) => ({ type: 'array', maxItems, items, uniqueItems: true });
const idArray = array(uuid);
const ref = object({ attachmentId: uuid, sha256: hash, ownerId: { const: 'owner' } });
const requiredInput = object({ original: ref, unitIds: array(text(200, 1), 100000) });
const context = object({
  projectId: uuid,
  ticketId: uuid,
  attemptId: uuid,
  fence: counter,
  processInstanceId: uuid,
  bindingRevision: integer,
});
const selection = object({ composeSessionId: uuid, selectionRevision: integer, attachmentIds: idArray });
const target = {
  oneOf: [
    object({ kind: { const: 'message' }, messageId: uuid }),
    object({ kind: { const: 'ticket' }, ticketId: uuid, projectId: uuid }),
  ],
};
const access = {
  oneOf: [
    object({ kind: { const: 'owner' } }),
    object({ kind: { const: 'bound-project' }, projectId: uuid, bindingRevision: integer }),
    object({ kind: { const: 'assistant-grant' }, grantId: uuid, designationRevision: integer }),
  ],
};
const pin = object({
  workflow: { enum: ['superpowers', 'bmad'] },
  version: text(200, 1),
  revision: text(200, 1),
  checksum: hash,
});
const opaque = { type: 'object', additionalProperties: true };
const ticket = object(
  {
    projectId: uuid,
    parentId: nullable(uuid),
    level: { enum: ['request', 'step', 'task'] },
    kind: { enum: ['code', 'research', 'docs', 'deploy'] },
    title: text(200, 1),
    description: text(65536),
    mandatory: { type: 'boolean' },
    criteria: opaque,
    inputs: opaque,
    outputs: opaque,
    skill: nullable(text()),
    workflowPin: nullable(pin),
    deployApprovalDecisionId: nullable(uuid),
  },
  [
    'projectId',
    'parentId',
    'level',
    'kind',
    'title',
    'description',
    'mandatory',
    'criteria',
    'inputs',
    'outputs',
    'skill',
  ],
);
const assistantRead = { enum: ['none', 'selected-inputs'] };
const compose = {
  oneOf: [
    object({ purpose: { const: 'ticket' }, projectId: uuid, ticketId: { type: 'null' } }),
    object({ purpose: { const: 'comment' }, projectId: uuid, ticketId: uuid }),
    object({
      purpose: { const: 'assistant_message' },
      projectId: { type: 'null' },
      ticketId: { type: 'null' },
      conversationId: uuid,
    }),
  ],
};
const receivedPart = object({
  derivativeId: uuid,
  sha256: hash,
  unitIds: array(text(200, 1), 100000),
  modality: { enum: ['text', 'vision'] },
});
const receipt = object({
  manifestId: uuid,
  manifestSha256: hash,
  context,
  runtime: { enum: ['claude', 'codex', 'api'] },
  modelKey: text(4096, 1),
  consumed: array(receivedPart, 10000),
  status: { enum: ['consumed', 'partial', 'failed'] },
  reason: nullable(text(1000)),
});
const assistantReceipt = object({
  sessionId: uuid,
  grantId: uuid,
  snapshotId: uuid,
  snapshotSha256: hash,
  runtime: { enum: ['claude', 'codex', 'api'] },
  modelKey: text(4096, 1),
  delivered: array(receivedPart, 10000),
  status: { enum: ['delivered', 'partial', 'failed'] },
  transportEvidenceSha256: hash,
});
function routeId(ids: Record<string, string>, name: string): string {
  const id = ids[name];
  if (!id) throw new ApiError('VALIDATION', 400, 'Thiếu mã đường dẫn');
  return id;
}
function params(path: string): Schema {
  return object(Object.fromEntries([...path.matchAll(/:([A-Za-z]+)/g)].map((m) => [m[1] ?? '', uuid])));
}
async function writeActor(
  request: FastifyRequest,
  deps: RouteDependencies,
  ownerRoute: boolean,
): Promise<Actor> {
  if (ownerRoute) return deps.auth.requireOwner(request, { csrf: true });
  const actor = await deps.auth.authenticate(request);
  if (actor.kind === 'owner') await deps.auth.requireOwner(request, { csrf: true });
  return actor;
}
function jsonRoutes(app: FastifyInstance, options: ServerOptions, deps: RouteDependencies) {
  return function register<T>(
    method: 'POST' | 'DELETE',
    path: string,
    schema: Schema,
    status: number,
    work: (tx: Tx, body: T, actor: Actor, ids: Record<string, string>) => Promise<unknown>,
    authorize?: (tx: Tx, body: T, actor: Actor, ids: Record<string, string>) => Promise<void>,
    ownerRoute = true,
  ) {
    app.route<{ Body: T; Params: Record<string, string> }>({
      method,
      url: path,
      schema: { body: schema, params: params(path) },
      handler: async (request, reply) => {
        const actor = await writeActor(request, deps, ownerRoute);
        const result = await deps.mutator(
          {
            actor,
            route: `${method}:${request.url.split('?')[0]}`,
            key: String(request.headers['idempotency-key'] ?? ''),
            body: request.body,
            authorize: async (tx) => {
              await authenticateCurrentCredential(tx, request, options.now());
              if (authorize) await authorize(tx, request.body as T, actor, request.params);
            },
          },
          async (tx) => ({ status, body: await work(tx, request.body as T, actor, request.params) }),
        );
        reply.status(result.status);
        return result.body;
      },
    });
  };
}
export function isByteStream(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  );
}
async function* protectedBytes(
  store: BlobStore,
  blob: BlobHandle,
  recheck: () => Promise<void>,
): AsyncIterable<Uint8Array> {
  // FD opens outside SQL; a second short snapshot closes authorize/open TOCTOU.
  const iterator = (await store.open(blob))[Symbol.asyncIterator]();
  let waiting: Promise<IteratorResult<Uint8Array>> | null = null;
  try {
    await recheck();
    for (;;) {
      waiting ??= iterator.next();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 1000);
      });
      let next: IteratorResult<Uint8Array> | null;
      try {
        next = await Promise.race([waiting, timeout]);
      } finally {
        clearTimeout(timer);
      }
      await recheck();
      if (next === null) continue;
      waiting = null;
      if (next.done) break;
      for (let start = 0; start < next.value.byteLength; start += 65536) {
        await recheck();
        yield next.value.subarray(start, start + 65536);
      }
    }
  } finally {
    if (waiting) waiting.catch(() => {});
    await iterator.return?.();
  }
}
async function sendBlob(
  request: FastifyRequest,
  reply: FastifyReply,
  store: BlobStore,
  blob: BlobHandle,
  recheck: () => Promise<void>,
  name: string,
  mime = 'application/octet-stream',
) {
  await recheck();
  if (request.headers.range) throw new ApiError('RANGE_NOT_SUPPORTED', 416, 'Không hỗ trợ đọc từng phần');
  const etag = `"${blob.sha256}"`;
  if (request.headers['if-match'] && request.headers['if-match'] !== etag)
    throw new ApiError('ETAG_MISMATCH', 412, 'Hash tệp không khớp');
  reply
    .header('cache-control', 'private, no-store')
    .header('x-content-type-options', 'nosniff')
    .header('etag', etag);
  if (request.headers['if-none-match'] === etag) {
    reply.status(304);
    return reply.send();
  }
  const fallback =
    name
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\;\r\n]/g, '_')
      .slice(0, 120) || 'attachment';
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  reply
    .header('content-disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`)
    .header('content-length', String(blob.byteLength))
    .type(mime);
  return reply.send(Readable.from(protectedBytes(store, blob, recheck)));
}
const pagination = object({ limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' }, cursor: uuid }, []);
function page(query: { limit?: string; cursor?: string }) {
  const limit = Number(query.limit ?? 50);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new ApiError('LIMIT_INVALID', 400, 'Giới hạn không hợp lệ');
  return { limit, cursor: query.cursor ?? null };
}

export function registerAttachmentRoutes(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
  services: {
    stage: StageServices;
    submissions: AttachmentSubmissions;
    store: BlobStore;
    executionGate?: AttachmentExecutionGate;
    config: AttachmentConfig;
    inputs?: AttachmentInputServices;
  },
): void {
  const { stage, submissions, store, config, inputs } = services,
    gate = services.executionGate ?? denyAttachmentExecution;
  const json = jsonRoutes(app, options, deps);
  app.get('/v2/attachment-policy', async (request) => {
    await deps.auth.requireOwner(request, { csrf: false });
    const { storageRoot: _root, ...policy } = config;
    return {
      ...policy,
      supportedMime: [
        'image/png',
        'image/jpeg',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'text/csv',
      ],
      extractionCapabilities: ['text', 'vision'],
    };
  });
  json<ComposeTarget>(
    'POST',
    '/v2/attachment-compose',
    compose,
    201,
    (tx, b, a) => stage.createCompose(tx, b, a),
    (tx, b, a) =>
      authorizeSubmission(
        tx,
        a,
        'conversationId' in b
          ? { conversationId: b.conversationId }
          : { projectId: b.projectId, ticketId: b.ticketId },
      ),
  );
  app.get<{ Params: { id: string } }>(
    '/v2/attachment-compose/:id',
    { schema: { params: params('/v2/attachment-compose/:id') } },
    async (request) =>
      stage.readCompose(
        options.db,
        request.params.id,
        await deps.auth.requireOwner(request, { csrf: false }),
      ),
  );
  type Reserve = Parameters<StageServices['reserve']>[1];
  json<Omit<Reserve, 'composeSessionId'>>(
    'POST',
    '/v2/attachment-compose/:id/uploads',
    object({
      expectedRevision: integer,
      fileName: text(1024, 1),
      declaredMime: text(200, 1),
      byteLength: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      sha256: hash,
    }),
    201,
    (tx, b, a, p) => stage.reserve(tx, { ...b, composeSessionId: routeId(p, 'id') }, a),
  );
  app.register(async (uploadApp) => {
    uploadApp.addContentTypeParser('application/octet-stream', (_request, payload, done) =>
      done(null, payload),
    );
    uploadApp.put<{ Params: { id: string }; Body: unknown }>(
      '/v2/attachment-uploads/:id/content',
      { schema: { params: params('/v2/attachment-uploads/:id/content') }, bodyLimit: config.maxFileBytes },
      async (request, reply) => {
        const actor = await deps.auth.requireOwner(request, { csrf: true });
        if (!isByteStream(request.body)) throw new ApiError('TYPE_NOT_SUPPORTED', 415, 'Cần luồng bytes');
        const [before] = await options.db`select state from attachment_uploads where id=${request.params.id}`;
        const abort = new AbortController();
        const cancel = () => abort.abort(new Error('UPLOAD_ABORTED'));
        request.raw.once('aborted', cancel);
        try {
          const result = await stage.receive(request.params.id, actor, request.body, abort.signal);
          reply.status(before?.state === 'ready' ? 200 : 201);
          return result;
        } finally {
          request.raw.removeListener('aborted', cancel);
        }
      },
    );
  });
  json<{ expectedRevision: number }>(
    'DELETE',
    '/v2/attachment-compose/:id/uploads/:uploadId',
    object({ expectedRevision: integer }),
    200,
    async (tx, b, a, p) => ({
      selectionRevision: await stage.abandonUpload(
        tx,
        {
          composeSessionId: routeId(p, 'id'),
          attachmentId: routeId(p, 'uploadId'),
          expectedRevision: b.expectedRevision,
        },
        a,
      ),
    }),
  );
  json<{ expectedRevision: number }>(
    'DELETE',
    '/v2/attachment-compose/:id',
    object({ expectedRevision: integer }),
    200,
    (tx, b, a, p) =>
      stage.abandonCompose(
        tx,
        { composeSessionId: routeId(p, 'id'), expectedRevision: b.expectedRevision },
        a,
      ),
  );
  json<{ ticket: CreateTicket; selection: Selection; assistantRead?: 'none' | 'selected-inputs' }>(
    'POST',
    '/v2/attachment-submissions/tickets',
    object({ ticket, selection, assistantRead }, ['ticket', 'selection']),
    201,
    (tx, b, a) => submissions.ticket(tx, b, a),
    (tx, b, a) => authorizeSubmission(tx, a, b.ticket),
  );
  json<{ text: string; selection: Selection; assistantRead?: 'none' | 'selected-inputs' }>(
    'POST',
    '/v2/tickets/:id/attachment-comments',
    object({ text: text(32768), selection, assistantRead }, ['text', 'selection']),
    201,
    (tx, b, a, p) => submissions.comment(tx, routeId(p, 'id'), b, a),
    (tx, _b, a, p) => authorizeSubmission(tx, a, { ticketId: routeId(p, 'id') }),
  );
  json<{ sourceLinkIds: Id[] }>(
    'POST',
    '/v2/tickets/:id/attachment-references',
    object({ sourceLinkIds: { ...idArray, minItems: 1 } }),
    201,
    async (tx, b, a, p) => ({
      linkIds: await inheritAttachmentLinks(tx, routeId(p, 'id'), b.sourceLinkIds, a),
    }),
    async (tx, _b, a, p) => {
      const [t] = await tx`select project_id from tickets where id=${routeId(p, 'id')}`;
      if (!t) notFound();
      await requireProjectScope(tx, String(t.project_id), a);
    },
    false,
  );
  app.get<{ Params: { id: string }; Querystring: { limit?: string; cursor?: string } }>(
    '/v2/tickets/:id/attachments',
    { schema: { params: params('/v2/tickets/:id/attachments'), querystring: pagination } },
    async (request) => {
      const actor = await deps.auth.authenticate(request),
        { limit, cursor } = page(request.query);
      return options.db.begin(async (tx) => {
        await authenticateCurrentCredential(tx, request, options.now());
        const [t] = await tx`select project_id from tickets where id=${request.params.id}`;
        if (!t) notFound();
        await requireProjectScope(tx, String(t.project_id), actor);
        const ids = await liveLinkIds(tx, request.params.id);
        if (!ids.length) return { items: [], nextCursor: null };
        const rows =
          await tx`select l.id as link_id,u.id,u.expected_sha256,u.file_name,u.detected_mime,u.expected_bytes from attachment_links l join attachment_uploads u on u.id=l.attachment_id where l.id in ${tx(ids)} and (${cursor}::uuid is null or l.id>${cursor}::uuid) order by l.id limit ${limit + 1}`;
        const items = rows.slice(0, limit).map((r) => ({
          linkId: String(r.link_id),
          attachmentId: String(r.id),
          sha256: String(r.expected_sha256),
          ownerId: 'owner',
          fileName: r.file_name,
          mime: r.detected_mime,
          byteLength: Number(r.expected_bytes),
        }));
        return { items, nextCursor: rows.length > limit ? items.at(-1)?.linkId : null };
      });
    },
  );
  const download = (machine: boolean, derivative: boolean) => {
    const path = machine
      ? '/v2/machine/attachments/:id/content'
      : derivative
        ? '/v2/attachments/:id/derivatives/:derivativeId/content'
        : '/v2/attachments/:id/content';
    const query = machine
      ? object({ ...context.properties, derivativeId: uuid, manifestId: uuid }, context.required)
      : object({}, []);
    app.get<{ Params: { id: string; derivativeId?: string }; Querystring: Record<string, string> }>(
      path,
      { schema: { params: params(path), querystring: query } },
      async (request, reply) => {
        const actor = machine
          ? await deps.auth.authenticate(request)
          : await deps.auth.requireOwner(request, { csrf: false });
        if (machine && actor.kind !== 'machine')
          throw new ApiError('MACHINE_REQUIRED', 403, 'Cần xác thực máy');
        const attemptContext = machine
          ? ({
              ...request.query,
              bindingRevision: Number(request.query.bindingRevision),
            } as unknown as AttemptReadContext)
          : null;
        const input = {
          attachmentId: request.params.id,
          context: attemptContext,
          derivativeId: request.params.derivativeId ?? request.query.derivativeId ?? null,
          manifestId: request.query.manifestId ?? null,
        };
        const authorize = () =>
          options.db.begin(async (tx) => {
            await authenticateCurrentCredential(tx, request, options.now());
            return authorizeAttachment(tx, actor, input, gate);
          });
        const blob = await authorize();
        const [row] =
          await options.db`select file_name from attachment_uploads where id=${request.params.id}`;
        const recheck = async () => {
          const current = await authorize();
          if (
            current.key !== blob.key ||
            current.sha256 !== blob.sha256 ||
            current.byteLength !== blob.byteLength
          )
            notFound();
        };
        return sendBlob(request, reply, store, blob, recheck, String(row.file_name));
      },
    );
  };
  download(false, false);
  download(false, true);
  download(true, false);
  app.get<{ Params: { id: string }; Querystring: { limit?: string; cursor?: string } }>(
    '/v2/attachments/:id/extractions',
    { schema: { params: params('/v2/attachments/:id/extractions'), querystring: pagination } },
    async (request) => {
      const actor = await deps.auth.requireOwner(request, { csrf: false });
      const { limit, cursor } = page(request.query);
      return options.db.begin(async (tx) => {
        await authenticateCurrentCredential(tx, request, options.now());
        await authorizeAttachment(
          tx,
          actor,
          { attachmentId: request.params.id, context: null, derivativeId: null, manifestId: null },
          gate,
        );
        const rows =
          await tx`select id,status,extractor_version,config_sha256,manifest_sha256,manifest from attachment_extractions where attachment_id=${request.params.id} and (${cursor}::uuid is null or id>${cursor}::uuid) order by id limit ${limit + 1}`;
        const items = rows.slice(0, limit).map((r) => ({
          id: r.id,
          status: r.status,
          extractorVersion: r.extractor_version,
          configSha256: r.config_sha256,
          manifestSha256: r.manifest_sha256,
          extraction: r.manifest,
        }));
        return { items, nextCursor: rows.length > limit ? items.at(-1)?.id : null };
      });
    },
  );
  const configured = () => {
    if (!inputs) throw new ApiError('INPUT_SERVICES_NOT_CONFIGURED', 409, 'Chưa cấu hình input attempt');
    return inputs;
  };
  json<Parameters<AttachmentInputServices['buildManifest']>[1]>(
    'POST',
    '/v2/machine/attachment-manifests',
    object({
      context,
      decisionId: uuid,
      required: array(requiredInput),
      inputRevision: counter,
      snapshotId: uuid,
      snapshotSha256: hash,
    }),
    200,
    (tx, b, a) => configured().buildManifest(tx, b, a),
    async (tx, b, a) => {
      configured();
      await gate(tx, a, b.context);
      await assertAttachmentExecutionCurrent(tx, a, b.context);
    },
    false,
  );
  app.get<{ Params: { id: string }; Querystring: AttemptReadContext }>(
    '/v2/machine/attachment-manifests/:id',
    { schema: { params: params('/v2/machine/attachment-manifests/:id'), querystring: context } },
    async (request) => {
      const actor = await deps.auth.authenticate(request);
      configured();
      return options.db.begin(async (tx) => {
        await authenticateCurrentCredential(tx, request, options.now());
        return readAuthorizedManifest(tx, actor, request.params.id, request.query, gate);
      });
    },
  );
  json<InputReceipt>(
    'POST',
    '/v2/machine/attachment-read-receipts',
    receipt,
    201,
    async (tx, b, a) => {
      const receiptId = await configured().appendReceipt(tx, b, a);
      const [r] = await tx`select coverage,trust from attachment_read_receipts where id=${receiptId}`;
      if (!r) throw new ApiError('RECEIPT_NOT_STORED', 409, 'Receipt chưa được lưu');
      return { receiptId, coverage: r.coverage, trust: r.trust };
    },
    async (tx, b, a) => {
      configured();
      await gate(tx, a, b.context);
      await assertAttachmentExecutionCurrent(tx, a, b.context);
    },
    false,
  );
}

export function registerInputScopeRoutes(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
  ports: {
    selection: PreclaimSelectionAuthority;
    assistant: AssistantInputAuthority;
    routing: InputRoutingAuthority;
    retire: RouteRetirementAuthority;
    store?: BlobStore;
    messages?: ReturnType<typeof createMessageServices>;
  },
): void {
  const json = jsonRoutes(app, options, deps),
    assistant = ports.assistant ?? denyAssistantInput,
    select = ports.selection ?? denyPreclaimSelection;
  const messageServices = ports.messages;
  const messages = () => {
    if (!messageServices)
      throw new ApiError('INPUT_SERVICES_NOT_CONFIGURED', 409, 'Chưa cấu hình tin nhắn input');
    return messageServices;
  };
  const routing = createRoutingServices({ authority: ports.routing, retire: ports.retire, now: options.now });
  json<Record<string, never>>(
    'POST',
    '/v2/attachment-conversations',
    object({}),
    201,
    async (tx, _b, a) => ({ conversationId: (await messages().createConversation(tx, a)).id }),
    async () => {
      messages();
    },
  );
  json<Parameters<ReturnType<typeof createMessageServices>['submitAssistantMessage']>[1]>(
    'POST',
    '/v2/attachment-submissions/messages',
    object({ conversationId: uuid, clientMessageId: uuid, text: text(32768), selection, assistantRead }),
    201,
    (tx, b, a) => messages().submitAssistantMessage(tx, b, a),
    (tx, b, a) => authorizeSubmission(tx, a, { conversationId: b.conversationId }),
  );
  app.get<{ Params: { id: string }; Querystring: { limit?: string; cursor?: string } }>(
    '/v2/attachment-conversations/:id/messages',
    { schema: { params: params('/v2/attachment-conversations/:id/messages'), querystring: pagination } },
    async (request) => {
      const actor = await deps.auth.authenticate(request);
      if (actor.kind !== 'owner') notFound();
      const { limit, cursor } = page(request.query);
      return options.db.begin(async (tx) => {
        await authenticateCurrentCredential(tx, request, options.now());
        await authorizeSubmission(tx, actor, { conversationId: request.params.id });
        const rows =
          await tx`select id,text,input_revision,route_revision,created_at from attachment_messages where conversation_id=${request.params.id} and (${cursor}::uuid is null or id>${cursor}::uuid) order by id limit ${limit + 1}`;
        const items = [];
        for (const row of rows.slice(0, limit)) {
          const refs =
            await tx`select attachment_id,sha256 from attachment_message_links where message_id=${row.id} order by attachment_id`;
          items.push({
            id: row.id,
            conversationId: request.params.id,
            text: row.text,
            inputRevision: String(row.input_revision),
            routeRevision: Number(row.route_revision),
            createdAt: new Date(String(row.created_at)).toISOString(),
            attachments: refs.map((r) => ({
              attachmentId: r.attachment_id,
              sha256: r.sha256,
              ownerId: 'owner',
            })),
          });
        }
        return { items, nextCursor: rows.length > limit ? items.at(-1)?.id : null };
      });
    },
  );
  type RouteBody = Omit<RouteMessageInput, 'messageId'>;
  json<RouteBody>(
    'POST',
    '/v2/attachment-messages/:id/route',
    object({
      expectedInputRevision: counter,
      expectedRouteRevision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      decisionId: uuid,
      ticket,
    }),
    201,
    (tx, b, a, p) => routing.routeAssistantMessage(tx, { ...b, messageId: routeId(p, 'id') }, a),
    (tx, b, a, p) => routing.authorize(tx, { ...b, messageId: routeId(p, 'id') }, a),
    false,
  );
  json<Omit<MessageDecisionInput, 'messageId'>>(
    'POST',
    '/v2/attachment-messages/:id/decisions',
    object({
      inputRevision: counter,
      snapshotId: nullable(uuid),
      grantId: nullable(uuid),
      receiptId: nullable(uuid),
      kind: { enum: ['routing', 'scope', 'reply'] },
      body: opaque,
    }),
    201,
    async (tx, b, a, p) => ({
      decisionId: await messages().persistMessageInputDecision(tx, { ...b, messageId: routeId(p, 'id') }, a),
    }),
    async (tx, b, a, p) => {
      await lockInputTarget(tx, { kind: 'message', messageId: routeId(p, 'id') });
      if (a.kind === 'machine') {
        if (!b.grantId || !b.receiptId)
          throw new ApiError('ASSISTANT_INPUT_NOT_CONFIGURED', 409, 'Cần quyền input Trợ lý');
        await assertGrantCurrent(tx, a, b.grantId, assistant);
        const [r] = await tx`select session_id from attachment_assistant_receipts where id=${b.receiptId}`;
        if (!r) notFound();
        await readAssistantSession(tx, a, String(r.session_id), assistant);
      }
    },
    false,
  );
  type AuthorizationInput = Parameters<typeof createInputReadAuthorization>[1];
  json<AuthorizationInput>(
    'POST',
    '/v2/attachment-submission-authorizations',
    object({
      target,
      originals: { ...array(ref), minItems: 1 },
      allowOriginal: { type: 'boolean' },
      expiresAt: { type: 'string', format: 'date-time' },
    }),
    201,
    (tx, b, a) => createInputReadAuthorization(tx, b, a),
    (tx, b) => lockInputTarget(tx, b.target).then(() => {}),
  );
  json<Record<string, never>>(
    'DELETE',
    '/v2/attachment-submission-authorizations/:id',
    object({}),
    200,
    (tx, _b, a, p) => revokeInputAuthorization(tx, routeId(p, 'id'), a),
  );
  type Issue = Parameters<typeof issueAssistantReadGrant>[1];
  json<Issue>(
    'POST',
    '/v2/attachment-assistant-grants',
    object({ authorizationId: uuid, target, inputRevision: counter }),
    201,
    (tx, b, a) => issueAssistantReadGrant(tx, b, a, assistant),
    async (tx, b, a) => {
      await assistant.authorizeIssue(tx, a, b);
      const current = await lockInputTarget(tx, b.target);
      if (current.revision !== b.inputRevision)
        throw new ApiError('INPUT_SNAPSHOT_STALE', 409, 'Input đã thay đổi');
      const [authorization] =
        await tx`select revoked_at,expires_at from attachment_submission_authorizations where id=${b.authorizationId}`;
      if (
        !authorization ||
        authorization.revoked_at ||
        new Date(String(authorization.expires_at)).getTime() <= options.now().getTime()
      )
        notFound();
    },
  );
  json<Record<string, never>>(
    'DELETE',
    '/v2/attachment-assistant-grants/:id',
    object({}),
    200,
    (tx, _b, a, p) => revokeAssistantGrant(tx, routeId(p, 'id'), a),
  );
  type SnapshotInput = Parameters<typeof readInputSnapshot>[2];
  app.post<{ Body: SnapshotInput }>(
    '/v2/input-snapshots',
    {
      schema: {
        body: object({
          target,
          access,
          expectedInputRevision: nullable(counter),
          scopeDecisionId: nullable(uuid),
        }),
      },
    },
    async (request) => {
      const actor = await writeActor(request, deps, false);
      return options.db.begin(async (tx) => {
        await authenticateCurrentCredential(tx, request, options.now());
        return readInputSnapshot(tx, actor, request.body, select, assistant);
      });
    },
  );
  json<{ snapshotId: Id }>(
    'POST',
    '/v2/machine/assistant-input-grants/:id/bind-snapshot',
    object({ snapshotId: uuid }),
    200,
    (tx, b, a, p) => bindGrantSnapshot(tx, routeId(p, 'id'), b.snapshotId, a, assistant),
    (tx, _b, a, p) => assertGrantCurrent(tx, a, routeId(p, 'id'), assistant, true).then(() => {}),
    false,
  );
  type Start = Parameters<typeof startAssistantReadSession>[1];
  json<Start>(
    'POST',
    '/v2/machine/assistant-input-sessions',
    object({ grantId: uuid, snapshotId: uuid, modelSelectionId: uuid }),
    201,
    (tx, b, a) => startAssistantReadSession(tx, b, a, assistant),
    async (tx, b, a) => {
      await assertGrantCurrent(tx, a, b.grantId, assistant);
      const [prior] =
        await tx`select id from attachment_assistant_sessions where grant_id=${b.grantId} and snapshot_id=${b.snapshotId} and model_selection_id=${b.modelSelectionId}`;
      if (prior) await readAssistantSession(tx, a, String(prior.id), assistant);
    },
    false,
  );
  for (const original of [false, true]) {
    const path = original
      ? '/v2/machine/assistant-input-sessions/:id/originals/:attachmentId'
      : '/v2/machine/assistant-input-sessions/:id/representations/:derivativeId';
    app.get<{
      Params: { id: string; attachmentId?: string; derivativeId?: string };
      Querystring: { grantId: string; snapshotId: string };
    }>(
      path,
      { schema: { params: params(path), querystring: object({ grantId: uuid, snapshotId: uuid }) } },
      async (request, reply) => {
        const actor = await deps.auth.authenticate(request);
        if (actor.kind !== 'machine') throw new ApiError('MACHINE_REQUIRED', 403, 'Cần xác thực máy');
        const input = {
          sessionId: request.params.id,
          derivativeId: request.params.derivativeId ?? null,
          attachmentId: request.params.attachmentId ?? null,
        };
        const authorize = () =>
          options.db.begin(async (tx) => {
            await authenticateCurrentCredential(tx, request, options.now());
            const { session } = await readAssistantSession(tx, actor, input.sessionId, assistant);
            if (session.grantId !== request.query.grantId || session.snapshotId !== request.query.snapshotId)
              notFound();
            return authorizeAssistantRepresentation(tx, actor, input, assistant);
          });
        const blob = await authorize();
        if (!ports.store)
          throw new ApiError('ATTACHMENT_STORAGE_NOT_CONFIGURED', 503, 'Chưa cấu hình storage');
        return sendBlob(
          request,
          reply,
          ports.store,
          blob,
          async () => {
            const current = await authorize();
            if (current.key !== blob.key || current.sha256 !== blob.sha256) notFound();
          },
          original ? 'original' : 'representation',
          'application/octet-stream',
        );
      },
    );
  }
  json<AssistantReadReceipt>(
    'POST',
    '/v2/machine/assistant-input-read-receipts',
    assistantReceipt,
    201,
    (tx, b, a) => appendAssistantReadReceipt(tx, b, a, assistant),
    (tx, b, a) => readAssistantSession(tx, a, b.sessionId, assistant).then(() => {}),
    false,
  );
}
