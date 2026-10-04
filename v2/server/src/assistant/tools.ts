import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { digest } from '../attachments/submissions.ts';
import { authenticateCurrentCredential } from '../auth/routes.ts';
import { validPath } from '../docs/manifest.ts';
import { readProjectDocsState } from '../docs/read.ts';
import { canonicalJson } from '../journal/canonical.ts';
import type { Actor, Id, RouteDependencies, ServerOptions, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { createPersistedAssistantActorResolver } from './authority.ts';
import type {
  DocRead,
  OrchestrationProof,
  RoutingTool,
  RoutingToolRequest,
  RoutingToolResult,
  RoutingToolValue,
  Sha256,
} from './contracts.ts';
import { routingToolRequestSchema } from './contracts.ts';
import { createWorkflowGates } from './gates.ts';
import { type OperationRequest, operationRequestSha256 } from './operation-request.ts';
import { createProjectOrchestrationPort } from './orchestration.ts';
import { createWorkflowRuns } from './runs.ts';
import { assertAssistantId, assertTurnFence } from './store.ts';
import type { DefinitionLookup } from './workflows.ts';

export type AssistantToolsDependencies = {
  /** Build hash of the routing verifier pinned at assembly (see the persisted Actor resolver). */
  verifierBuildSha256: Sha256;
  lookup?: DefinitionLookup;
};
/** Persisted scope the proof resolved to; the model never names it. */
export type ToolScope = {
  id: Id;
  rootTicketId: Id | null;
  messageId: Id | null;
  projectId: Id | null;
  toolNames: string[];
  inputSnapshotId: Id;
};
/** A request whose authority was verified in `tx`; only `consume` of the same assembly accepts it. */
export type AuthorizedToolCall = {
  readonly tx: Tx;
  readonly actor: Actor;
  readonly request: RoutingToolRequest;
  readonly providerCallId: string;
  readonly proof: OrchestrationProof;
  readonly scope: ToolScope;
};
export type AssistantTools = {
  /**
   * Every authority check of a tool call, run before any idempotent replay: authenticated
   * machine = persisted Assistant of the exact current fence/admission, the turn's scope for the
   * pinned input, exact current input pin, scope `tool_names` and the per-turn budget.
   */
  authorize(
    tx: Tx,
    actor: Actor,
    request: RoutingToolRequest,
    providerCallId: string,
  ): Promise<AuthorizedToolCall>;
  /** Fresh operation only: writes the bound operation row, runs the tool, stores the result. */
  consume(tx: Tx, call: AuthorizedToolCall): Promise<RoutingToolResult>;
};

type ToolName = RoutingTool['name'];
type Released = 'read_catalog' | 'read_docs' | 'create_run' | 'ask_owner';
// The one RoutingToolValue kind each released tool may return.
const resultKind: Record<Released, RoutingToolValue['kind']> = {
  read_catalog: 'catalog',
  read_docs: 'docs',
  create_run: 'run',
  ask_owner: 'question',
};
const releasedTools: readonly string[] = Object.keys(resultKind);
const toolNames: readonly ToolName[] = [
  'read_catalog',
  'read_docs',
  'route_message',
  'read_execution_candidates',
  'assess_ticket',
  'ask_owner',
  'create_run',
  'request_dispatch',
  'request_review',
  'publish_reply',
];

/** Same code and message for every failure before the proof resolved to a scope. */
const scopeNotFound = () => new ApiError('ASSISTANT_SCOPE_NOT_FOUND', 404, 'Không tìm thấy phạm vi Trợ lý');
const inputStale = () => new ApiError('ASSISTANT_INPUT_STALE', 409, 'Input của lượt Trợ lý đã cũ');
const operationConflict = () =>
  new ApiError('ASSISTANT_OPERATION_CONFLICT', 409, 'Định danh thao tác Trợ lý đã được dùng');
const docsNotFound = () => new ApiError('NOT_FOUND', 404, 'Không tìm thấy tài liệu');
const ticketNotFound = () => new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');

/**
 * Every tool, released or not, is bound with the shared tagged hash of `{action, payload}`.
 * `OperationRequest` lists only the requests an orchestration port consumes; the read and
 * unreleased tools use their tool name as the action domain, which no port action shares.
 */
function toolRequestSha256(action: ToolName, payload: unknown): Sha256 {
  return operationRequestSha256({ action, payload } as unknown as OperationRequest);
}

const nullableId = (value: unknown): Id | null => (value === null ? null : String(value));
const plainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Tools assembly: one persisted Actor resolver, one orchestration port, and the run and gate
 * services built on them. Production does not inject it until the owner releases it.
 */
export function createAssistantTools(deps: AssistantToolsDependencies): AssistantTools {
  const resolver = createPersistedAssistantActorResolver({ verifierBuildSha256: deps?.verifierBuildSha256 });
  const port = createProjectOrchestrationPort({ resolver });
  const runs = createWorkflowRuns({ port, resolver, ...(deps.lookup ? { lookup: deps.lookup } : {}) });
  const gates = createWorkflowGates({ resolver, ...(deps.lookup ? { lookup: deps.lookup } : {}) });
  const issued = new WeakSet<AuthorizedToolCall>();

  async function authorize(
    tx: Tx,
    actor: Actor,
    request: RoutingToolRequest,
    providerCallId: string,
  ): Promise<AuthorizedToolCall> {
    assertTurnFence(request?.fence);
    assertAssistantId(request.operationId);
    assertAssistantId(request.inputSnapshot?.snapshotId);
    if (!toolNames.includes(request.call?.name))
      throw new ApiError('VALIDATION', 400, 'Tool Trợ lý không hợp lệ');
    const fence = { ...request.fence };
    const operationId = request.operationId.toLowerCase();
    const pin = request.inputSnapshot;
    // Proof → scope first: the scope comes from the turn and its pinned input, never from the
    // model. Until it resolves, every failure has one shape and no ticket row is read.
    let proof: OrchestrationProof;
    try {
      if (actor.kind !== 'machine') throw scopeNotFound();
      const scopes = await tx`select id from assistant_scopes where turn_id=${fence.turnId}
        and input_snapshot_id=${pin.snapshotId} and expires_at>clock_timestamp()`;
      if (scopes.length !== 1) throw scopeNotFound();
      proof = { fence, scopeId: String(scopes[0]?.id), operationId };
      // Locks guard → machine → config → designation → turn → monitor → grant → session.
      const resolved = await resolver(tx, proof);
      if (resolved.kind !== 'machine' || resolved.id !== actor.id) throw scopeNotFound();
    } catch (error) {
      if (error instanceof ApiError) throw scopeNotFound();
      throw error;
    }
    const [row] = await tx`select id,root_ticket_id,message_id,project_id,tool_names,input_snapshot_id
      from assistant_scopes where id=${proof.scopeId}`;
    if (!row) throw scopeNotFound();
    const scope: ToolScope = {
      id: String(row.id),
      rootTicketId: nullableId(row.root_ticket_id),
      messageId: nullableId(row.message_id),
      projectId: nullableId(row.project_id),
      toolNames: Array.isArray(row.tool_names) ? row.tool_names.map(String) : [],
      inputSnapshotId: String(row.input_snapshot_id),
    };
    // Exact current input: the stored snapshot, its selection, and the target's live revision.
    const [snapshot] = await tx`select target_kind,target_id,input_revision,route_revision,sha256,canonical
      from attachment_input_snapshots where id=${scope.inputSnapshotId}`;
    const [current] = snapshot
      ? await tx`select revision,route_revision from attachment_input_revisions
        where target_kind=${snapshot.target_kind} and target_id=${snapshot.target_id}`
      : [];
    const required = plainObject(snapshot?.canonical) ? snapshot.canonical.required : undefined;
    if (
      !snapshot ||
      snapshot.sha256 !== pin.snapshotSha256 ||
      String(snapshot.input_revision) !== pin.inputRevision ||
      String(current?.revision ?? '1') !== String(snapshot.input_revision) ||
      Number(current?.route_revision ?? 0) !== Number(snapshot.route_revision) ||
      !Array.isArray(required) ||
      digest(required) !== pin.selectionSha256
    )
      throw inputStale();
    if (!scope.toolNames.includes(request.call.name))
      throw new ApiError('ASSISTANT_TOOL_NOT_IN_SCOPE', 403, 'Tool ngoài phạm vi Trợ lý');
    // Budget of the turn; the turn row is locked, so concurrent calls of the turn serialize.
    const [config] = await tx`select policy from assistant_config where singleton=true`;
    const policy: unknown = config?.policy;
    const maxTools = plainObject(policy) ? policy.maxToolsPerTurn : undefined;
    const maxTurnMs = plainObject(policy) ? policy.maxTurnMs : undefined;
    if (
      typeof maxTools !== 'number' ||
      !Number.isSafeInteger(maxTools) ||
      maxTools < 0 ||
      typeof maxTurnMs !== 'number' ||
      !Number.isSafeInteger(maxTurnMs) ||
      maxTurnMs < 1
    )
      throw new ApiError('ASSISTANT_POLICY_INVALID', 503, 'Chính sách Trợ lý không hợp lệ');
    // A committed operation of this turn is exempt from both limits: its retry only reads the
    // stored result back. Every new call still counts against them.
    const [usage] = await tx`select
      (select count(*)::int from assistant_tool_operations where turn_id=${fence.turnId}
        and operation_id<>${operationId}) as used,
      exists(select 1 from assistant_tool_operations where turn_id=${fence.turnId}
        and operation_id=${operationId}) as recorded,
      (select created_at+${maxTurnMs}*interval '1 millisecond'<=clock_timestamp()
        from assistant_turns where id=${fence.turnId}) as elapsed`;
    if (!usage || Number(usage.used) >= maxTools || (usage.recorded !== true && usage.elapsed !== false))
      throw new ApiError('ASSISTANT_TOOL_BUDGET_EXHAUSTED', 409, 'Lượt Trợ lý đã hết ngân sách tool');
    const call: AuthorizedToolCall = Object.freeze({ tx, actor, request, providerCallId, proof, scope });
    issued.add(call);
    return call;
  }

  async function consume(tx: Tx, call: AuthorizedToolCall): Promise<RoutingToolResult> {
    if (!issued.has(call) || call.tx !== tx) throw new Error('ASSISTANT_TOOL_CALL_NOT_AUTHORIZED');
    issued.delete(call);
    const { request, proof, scope, providerCallId } = call;
    const operationId = proof.operationId;
    const turnId = proof.fence.turnId;
    // A fresh operation: its ID, client sequence and provider call must all be new for the turn.
    const clash =
      await tx`select operation_id from assistant_tool_operations where operation_id=${operationId}
      or (turn_id=${turnId} and (client_sequence=${request.clientSequence} or provider_call_id=${providerCallId}))
      limit 1`;
    if (clash.length) throw operationConflict();
    // Written directly in the caller's Tx (never a savepoint) before any port call.
    const write = async (requestHash: Sha256, result: RoutingToolResult | null) => {
      await tx`insert into assistant_tool_operations(operation_id,turn_id,client_sequence,provider_call_id,
        request_hash,input_snapshot_id,state,response)
        values(${operationId},${turnId},${request.clientSequence},${providerCallId},${requestHash},
        ${scope.inputSnapshotId},${result ? result.state : 'pending'},${result ? tx.json(result as never) : null})`;
    };
    const complete = async (name: Released, value: RoutingToolValue): Promise<RoutingToolResult> => {
      if (value.kind !== resultKind[name]) throw new Error('ASSISTANT_TOOL_RESULT_KIND_INVALID');
      const result = canonical({ operationId, state: 'completed', result: value, errorCode: null });
      const [updated] = await tx`update assistant_tool_operations set state='completed',
        response=${tx.json(result as never)} where operation_id=${operationId} and state='pending'
        returning operation_id`;
      if (!updated) throw new Error('ASSISTANT_TOOL_OPERATION_LOST');
      return result;
    };
    const tool = request.call;
    switch (tool.name) {
      case 'read_catalog': {
        await write(toolRequestSha256(tool.name, tool.input), null);
        return complete(tool.name, { kind: 'catalog', ...(await readCatalog(tx, scope)) });
      }
      case 'read_docs': {
        await write(toolRequestSha256(tool.name, tool.input), null);
        const page = await readDoc(tx, scope, tool.input);
        const readReceiptId = randomUUID();
        await tx`insert into assistant_doc_read_receipts(id,turn_id,snapshot_id,path,sha256)
          values(${readReceiptId},${turnId},${page.snapshotId},${page.path},${page.sha256})`;
        return complete(tool.name, { kind: 'docs', page, readReceiptId });
      }
      case 'create_run': {
        // Only the scope's own root: a foreign root is never looked up.
        if (!scope.rootTicketId || tool.input.rootTicketId.toLowerCase() !== scope.rootTicketId)
          throw ticketNotFound();
        const bound = await runs.createRunRequest(tx, operationId, tool.input);
        await write(operationRequestSha256(bound), null);
        return complete(tool.name, { kind: 'run', run: await runs.createRun(tx, proof, tool.input) });
      }
      case 'ask_owner': {
        await write(operationRequestSha256({ action: 'ask_owner', payload: tool.input }), null);
        return complete(tool.name, {
          kind: 'question',
          question: await gates.createOwnerQuestion(tx, proof, tool.input),
        });
      }
      default: {
        if (releasedTools.includes(tool.name)) throw new Error('ASSISTANT_TOOL_UNHANDLED');
        const rejected = canonical({
          operationId,
          state: 'rejected',
          result: null,
          errorCode: 'TOOL_NOT_RELEASED',
        });
        await write(toolRequestSha256(tool.name, tool.input), rejected);
        return rejected;
      }
    }
  }

  return Object.freeze({ authorize, consume });
}

// Stored and returned in the same canonical form, so a replay is byte-identical.
function canonical(result: RoutingToolResult): RoutingToolResult {
  return JSON.parse(canonicalJson(result)) as RoutingToolResult;
}

const catalogLimit = 1000;
/**
 * Projects the scope may route to: its own project, or every project before routing, each with
 * its latest verified docs snapshot (null until one is verified). `truncated` flags a cut list.
 */
async function readCatalog(tx: Tx, scope: ToolScope) {
  const rows = await tx`select p.id,p.key,p.name,s.id as snapshot_id,s.source_commit from projects p
    left join docs_snapshots s on s.id=p.latest_verified_snapshot_id and s.project_id=p.id
    where ${scope.projectId}::uuid is null or p.id=${scope.projectId}
    order by p.key limit ${catalogLimit + 1}`;
  return {
    items: rows.slice(0, catalogLimit).map((row) => ({
      projectId: String(row.id),
      key: String(row.key),
      name: String(row.name),
      latestSnapshotId: nullableId(row.snapshot_id),
      sourceCommit: row.source_commit === null ? null : String(row.source_commit),
    })),
    truncated: rows.length > catalogLimit,
  };
}

/** One stored docs page of a project the scope may read; anything else is the same 404. */
async function readDoc(
  tx: Tx,
  scope: ToolScope,
  input: { projectId: Id; snapshotId: Id; path: string },
): Promise<DocRead> {
  if (typeof input.path !== 'string' || !validPath(input.path))
    throw new ApiError('PATH_INVALID', 400, 'Đường dẫn không hợp lệ');
  assertAssistantId(input.projectId);
  assertAssistantId(input.snapshotId);
  const projectId = input.projectId.toLowerCase();
  if (scope.projectId !== null && projectId !== scope.projectId) throw docsNotFound();
  const [snapshot] = await tx`select s.id,s.source_commit,s.audit_state,s.received_at,
    (select l.id from docs_snapshots l where l.project_id=s.project_id order by l.received_at desc,l.id desc limit 1) as latest_id
    from docs_snapshots s join projects p on p.id=s.project_id
    where s.id=${input.snapshotId} and s.project_id=${projectId}`;
  if (!snapshot) throw docsNotFound();
  const [file] = await tx`select bytes,sha,content_class from docs_files
    where snapshot_id=${snapshot.id} and path=${input.path}`;
  if (!file) throw docsNotFound();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes as Buffer);
  } catch {
    throw new ApiError('DOCS_ENCODING_INVALID', 422, 'Trang không phải UTF-8 hợp lệ');
  }
  const auditState = snapshot.audit_state as DocRead['auditState'];
  const sourceCommit = snapshot.source_commit === null ? null : String(snapshot.source_commit);
  // The project's docs state comes from the docs service; it describes the latest snapshot,
  // so an older snapshot is stale once verified, and an unverified one stays unverified.
  const projectState = await readProjectDocsState(tx, projectId);
  const state: DocRead['state'] =
    auditState !== 'verified'
      ? 'unverified'
      : snapshot.latest_id === snapshot.id && projectState === 'current'
        ? 'current'
        : 'stale';
  return {
    projectId,
    snapshotId: String(snapshot.id),
    path: input.path,
    sha256: String(file.sha),
    sourceCommit,
    receivedAt: (snapshot.received_at as Date).toISOString(),
    auditState,
    contentClass: file.content_class as DocRead['contentClass'],
    text,
    state,
  };
}

const providerHeader = 'x-crew-provider-call-id';
/**
 * Exactly one provider call ID header: visible ASCII without a comma (a comma is how repeated
 * header lines are joined), case kept, never trimmed.
 */
function providerCallIdOf(request: FastifyRequest): string {
  const raw = request.raw.rawHeaders;
  const values: string[] = [];
  for (let index = 0; index + 1 < raw.length; index += 2)
    if (raw[index]?.toLowerCase() === providerHeader) values.push(String(raw[index + 1]));
  const [value] = values;
  if (values.length !== 1 || value === undefined || !/^[\x21-\x2b\x2d-\x7e]{1,4096}$/.test(value))
    throw new ApiError('PROVIDER_CALL_ID_INVALID', 400, 'Định danh lời gọi provider không hợp lệ');
  return value;
}

const turnParams = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
};
const toolRoute = 'POST:/v2/assistant/turns/:id/tools';

/**
 * `POST /v2/assistant/turns/:id/tools`. Bearer machine only. Authority is checked inside the
 * journal transaction before the idempotent replay; the replay reads the stored result only.
 * Without a tools assembly the route is 503.
 */
export function registerAssistantToolRoutes(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
  tools: AssistantTools | undefined,
): void {
  app.post<{ Params: { id: string }; Body: RoutingToolRequest }>(
    '/v2/assistant/turns/:id/tools',
    { schema: { params: turnParams, body: routingToolRequestSchema } },
    async (request, reply) => {
      if (!tools) throw new ApiError('ASSISTANT_TOOLS_NOT_CONFIGURED', 503, 'Chưa cấu hình tool của Trợ lý');
      const actor = await deps.auth.authenticate(request);
      if (actor.kind !== 'machine')
        throw new ApiError('ASSISTANT_MACHINE_REQUIRED', 403, 'Chỉ máy Trợ lý được gọi tool');
      const providerCallId = providerCallIdOf(request);
      const body = request.body;
      assertAssistantId(body.operationId);
      let authorized: AuthorizedToolCall | undefined;
      const result = await deps.mutator(
        {
          actor,
          route: toolRoute,
          key: body.operationId.toLowerCase(),
          body: { providerCallId, request: body },
          authorize: async (tx) => {
            const current = await authenticateCurrentCredential(tx, request, options.now());
            if (current.kind !== actor.kind || current.id !== actor.id)
              throw new ApiError('UNAUTHENTICATED', 401, 'Cần xác thực máy');
            if (request.params.id.toLowerCase() !== String(body.fence?.turnId).toLowerCase())
              throw scopeNotFound();
            authorized = await tools.authorize(tx, actor, body, providerCallId);
          },
        },
        async (tx) => {
          if (!authorized) throw new Error('ASSISTANT_TOOL_CALL_NOT_AUTHORIZED');
          return { status: 200, body: await tools.consume(tx, authorized) };
        },
      );
      reply.status(result.status);
      // jsonb reorders keys of the stored reply; canonical order keeps every replay byte-identical.
      return canonical(result.body);
    },
  );
}
