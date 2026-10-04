import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalJson } from '../journal/atomic-records.ts';
import {
  HttpOperationJournal,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from '../journal/http-operations.ts';

/**
 * Machine side of `POST /v2/assistant/turns/:id/tools`. The driver emits a `RoutingEvent`; this
 * client validates it against the tool union, derives the durable operation ID from
 * (turn, provider call, sequence), persists the exact request in the gateway HTTP operation
 * journal before the first send, and then sends it, retrying only the identical request.
 * It runs no model, driver or supervisor and never logs.
 */

type Id = string;
type Sha256 = string;
export type TurnFence = {
  turnId: Id;
  designationId: Id;
  designationRevision: number;
  generation: string;
  processInstanceId: Id;
};
export type DispatchInputPin = {
  snapshotId: Id;
  snapshotSha256: Sha256;
  inputRevision: string;
  selectionSha256: Sha256;
};
type ModelKey = { machineId: Id; runtime: string; providerId: string; modelId: string };
type SourceRef = {
  kind: 'docs' | 'ticket' | 'artifact' | 'owner_decision';
  id: Id;
  path?: string;
  locator?: string;
};
type Json = unknown;
export type RoutingTool =
  | { name: 'read_catalog'; input: Record<string, never> }
  | { name: 'read_docs'; input: { projectId: Id; snapshotId: Id; path: string } }
  | {
      name: 'route_message';
      input: {
        messageId: Id;
        expectedInputRevision: string;
        expectedRouteRevision: number;
        ticket: Record<string, Json>;
        confidence: number;
        rationale: string;
        docReadIds: Id[];
      };
    }
  | { name: 'read_execution_candidates'; input: { ticketId: Id; runId: Id } }
  | { name: 'assess_ticket'; input: Record<string, Json> }
  | { name: 'ask_owner'; input: Record<string, Json> }
  | { name: 'create_run'; input: { rootTicketId: Id; path: string; definitionSha256: Sha256 } }
  | {
      name: 'request_dispatch';
      input: { stepId: Id; assessmentId: Id; chosen: ModelKey; priorAttemptId: Id | null };
    }
  | {
      name: 'request_review';
      input: { runId: Id; implementationStepId: Id; implementationAttemptId: Id };
    }
  | {
      name: 'publish_reply';
      input: {
        messageId: Id;
        inputRevision: string;
        snapshotId: Id;
        receiptIds: Id[];
        text: string;
        sources: SourceRef[];
      };
    };
export type RoutingEvent =
  | { kind: 'tool'; providerCallId: string; sequence: string; call: RoutingTool }
  | { kind: 'finished'; outcome: 'completed' | 'failed' | 'interrupted' };
/** Value payloads stay opaque to the gateway; only the kind and its field names are checked. */
export type RoutingToolValue = { kind: string; [field: string]: Json };
export type RoutingToolResult = {
  operationId: Id;
  state: 'completed' | 'pending' | 'rejected';
  result: RoutingToolValue | null;
  errorCode: string | null;
};
export type RoutingToolRequest = {
  fence: TurnFence;
  operationId: Id;
  clientSequence: string;
  inputSnapshot: DispatchInputPin;
  call: RoutingTool;
};
/** The current fence and input pin the call is made under. */
export type ToolTurn = { fence: TurnFence; inputSnapshot: DispatchInputPin };

export type ToolClientErrorKind =
  | 'invalid'
  | 'unauthorized'
  | 'not_found'
  | 'stale'
  | 'conflict'
  | 'budget'
  | 'rejected'
  | 'response_invalid'
  | 'unavailable'
  | 'journal';
/** Never carries a response body or credential: only the kind, HTTP status and server error code. */
export class ToolClientError extends Error {
  readonly kind: ToolClientErrorKind;
  readonly status: number | null;
  readonly serverCode: string | null;
  /** True only when the same call may be executed again and resumes the same durable operation. */
  readonly retryable: boolean;
  constructor(
    kind: ToolClientErrorKind,
    detail: string,
    extra: { status?: number; serverCode?: string | null; retryable?: boolean } = {},
  ) {
    super(`ASSISTANT_TOOL_${kind.toUpperCase()}: ${detail}`);
    this.name = 'ToolClientError';
    this.kind = kind;
    this.status = extra.status ?? null;
    this.serverCode = extra.serverCode ?? null;
    this.retryable = extra.retryable ?? false;
  }
}

// ---- validation of the RoutingEvent tool union (mirrors the server routingToolSchema) ----

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digestPattern = /^[0-9a-f]{64}$/;
const maxCounter = 9223372036854775807n;
// Visible ASCII without a comma: a comma is how repeated header lines are joined.
const providerCallPattern = /^[\x21-\x2b\x2d-\x7e]{1,4096}$/;
const maxProse = 32768;
const maxPath = 4096;
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

type Check = (value: unknown) => boolean;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const uuid: Check = (v) => typeof v === 'string' && uuidPattern.test(v);
const digest: Check = (v) => typeof v === 'string' && digestPattern.test(v);
const counter: Check = (v) =>
  typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= maxCounter;
const nonNegative: Check = (v) => Number.isSafeInteger(v) && (v as number) >= 0;
const prose: Check = (v) => typeof v === 'string' && v.length <= maxProse;
const text =
  (min: number, max: number): Check =>
  (v) =>
    typeof v === 'string' && v.length >= min && v.length <= max;
const oneOf =
  (...values: string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v);
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const list =
  (check: Check, max: number, unique = false): Check =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(check) && (!unique || new Set(v).size === v.length);
const json = (value: unknown, depth = 0): boolean => {
  if (depth > 64) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => json(item, depth + 1));
  return (
    isObject(value) &&
    Object.entries(value).every(([key, item]) => !forbiddenKeys.has(key) && json(item, depth + 1))
  );
};
/** Exactly these keys (optional ones may be absent), each value passing its check. */
const shape =
  (fields: Record<string, Check>, optional: string[] = []): Check =>
  (v) =>
    isObject(v) &&
    Object.keys(v).every((key) => Object.hasOwn(fields, key)) &&
    Object.entries(fields).every(([key, check]) =>
      Object.hasOwn(v, key) ? (check(v[key]) ?? false) : optional.includes(key),
    );

const pin: Check = shape({
  snapshotId: uuid,
  snapshotSha256: digest,
  inputRevision: counter,
  selectionSha256: digest,
});
const fenceShape: Check = shape({
  turnId: uuid,
  designationId: uuid,
  designationRevision: (v) => Number.isSafeInteger(v) && (v as number) >= 1,
  generation: counter,
  processInstanceId: uuid,
});
const modelKey: Check = shape({
  machineId: uuid,
  runtime: text(1, 200),
  providerId: text(1, 200),
  modelId: text(1, 200),
});
const sources: Check = list(
  shape(
    {
      kind: oneOf('docs', 'ticket', 'artifact', 'owner_decision'),
      id: uuid,
      path: text(1, maxPath),
      locator: text(1, 2048),
    },
    ['path', 'locator'],
  ),
  100,
);
const plainJson: Check = (v) => isObject(v) && json(v);
const proseList: Check = list(prose, 1000);

const toolInputs: Record<RoutingTool['name'], Check> = {
  read_catalog: shape({}),
  read_docs: shape({ projectId: uuid, snapshotId: uuid, path: text(1, maxPath) }),
  route_message: shape({
    messageId: uuid,
    expectedInputRevision: counter,
    expectedRouteRevision: nonNegative,
    // The create-ticket body is checked in depth by the server; here it must be plain JSON.
    ticket: plainJson,
    confidence: (v) => typeof v === 'number' && v >= 0 && v <= 1,
    rationale: prose,
    docReadIds: list(uuid, 1000, true),
  }),
  read_execution_candidates: shape({ ticketId: uuid, runId: uuid }),
  assess_ticket: shape({
    ticketId: uuid,
    candidateReadOperationId: uuid,
    input: pin,
    complexity: oneOf('bounded', 'integration', 'architectural'),
    risk: proseList,
    uncertainty: proseList,
    required: list(text(1, 200), 100, true),
    strengthRationale: prose,
    sources,
    candidateReasons: list(shape({ key: modelKey, reason: prose }), 1000),
    chosen: modelKey,
    choiceRationale: prose,
  }),
  ask_owner: shape({
    conversationId: uuid,
    ticketId: nullable(uuid),
    runId: nullable(uuid),
    stepId: nullable(uuid),
    gateId: nullable(uuid),
    cycleId: nullable(uuid),
    artifactSha256: nullable(digest),
    question: prose,
    options: proseList,
    scopeSha256: digest,
  }),
  create_run: shape({
    rootTicketId: uuid,
    path: oneOf('architectural', 'bounded', 'bug', 'spike', 'bmad-dispatch', 'bmad-oneshot'),
    definitionSha256: digest,
  }),
  request_dispatch: shape({
    stepId: uuid,
    assessmentId: uuid,
    chosen: modelKey,
    priorAttemptId: nullable(uuid),
  }),
  request_review: shape({ runId: uuid, implementationStepId: uuid, implementationAttemptId: uuid }),
  publish_reply: shape({
    messageId: uuid,
    inputRevision: counter,
    snapshotId: uuid,
    receiptIds: list(uuid, 1000, true),
    text: prose,
    sources,
  }),
};

/** The one RoutingToolValue kind each tool may be answered with. */
const resultKind: Record<RoutingTool['name'], string> = {
  read_catalog: 'catalog',
  read_docs: 'docs',
  route_message: 'route',
  read_execution_candidates: 'execution_candidates',
  assess_ticket: 'assessment',
  ask_owner: 'question',
  create_run: 'run',
  request_dispatch: 'dispatch',
  request_review: 'review',
  publish_reply: 'reply',
};
const objectField: Check = (v) => isObject(v);
const valueShapes: Record<string, Check> = {
  catalog: shape({
    kind: oneOf('catalog'),
    items: list(objectField, 100000),
    truncated: (v) => typeof v === 'boolean',
  }),
  execution_candidates: shape({ kind: oneOf('execution_candidates'), snapshot: objectField }),
  docs: shape({ kind: oneOf('docs'), page: objectField, readReceiptId: uuid }),
  route: shape({ kind: oneOf('route'), route: objectField }),
  assessment: shape({ kind: oneOf('assessment'), assessment: objectField }),
  question: shape({ kind: oneOf('question'), question: objectField }),
  run: shape({ kind: oneOf('run'), run: objectField }),
  review: shape({ kind: oneOf('review'), step: objectField }),
  dispatch: shape({ kind: oneOf('dispatch'), dispatch: objectField }),
  reply: shape({ kind: oneOf('reply'), decisionId: uuid }),
};

const invalid = (detail: string) => new ToolClientError('invalid', detail);

type ToolEvent = Extract<RoutingEvent, { kind: 'tool' }>;
function assertToolEvent(event: unknown): asserts event is ToolEvent {
  if (!isObject(event) || event.kind !== 'tool') throw invalid('event is not a tool call');
  if (Object.keys(event).some((key) => !['kind', 'providerCallId', 'sequence', 'call'].includes(key)))
    throw invalid('unexpected event field');
  if (typeof event.providerCallId !== 'string' || !providerCallPattern.test(event.providerCallId))
    throw invalid('provider call id');
  if (!counter(event.sequence)) throw invalid('sequence');
  const call = event.call;
  if (!isObject(call) || Object.keys(call).some((key) => key !== 'name' && key !== 'input'))
    throw invalid('call shape');
  const name = call.name;
  if (typeof name !== 'string' || !Object.hasOwn(toolInputs, name)) throw invalid('unknown tool');
  const check = toolInputs[name as RoutingTool['name']];
  if (!check(call.input)) throw invalid(`input of ${name}`);
  if (!json(call.input)) throw invalid(`input of ${name} is not JSON`);
}
function assertTurn(turn: unknown): asserts turn is ToolTurn {
  if (!isObject(turn) || !fenceShape(turn.fence) || !pin(turn.inputSnapshot))
    throw invalid('turn fence or input pin');
}

/**
 * Deterministic UUID (version 5 layout) of one tool call. The same turn, provider call and
 * sequence give the same ID after any restart; any difference gives a different one.
 */
export function toolOperationId(turnId: Id, providerCallId: string, sequence: string): Id {
  const bytes = createHash('sha256')
    .update(
      canonicalJson(['crew-v2:assistant-tool-operation:1', turnId.toLowerCase(), providerCallId, sequence]),
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---- transport: the provider call ID travels in the journaled phase, so it is crash-safe ----

const phasePrefix = 'assistant-tool:';
class TransportFailure extends Error {}

function toolTransport(baseUrl: string, bearer: string, fetchImpl: typeof fetch): HttpTransport {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === '127.0.0.1'))
    throw new Error('UNSAFE_SERVER_URL');
  return async (request: Readonly<HttpRequest>): Promise<HttpResponse> => {
    const providerCallId = request.phase.startsWith(phasePrefix)
      ? request.phase.slice(phasePrefix.length)
      : '';
    if (
      !providerCallPattern.test(providerCallId) ||
      !request.route.startsWith('/v2/') ||
      request.route.includes('..')
    )
      throw new Error('UNSAFE_TOOL_REQUEST');
    try {
      const response = await fetchImpl(new URL(request.route, base), {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        // The bearer lives only in this closure, never in the journaled request.
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
          'x-crew-provider-call-id': providerCallId,
        },
        body: JSON.stringify(request.canonicalBody),
      });
      return { status: response.status, body: await response.json() };
    } catch {
      // Network loss, timeout or an unreadable body: the outcome is unknown, so retry the same request.
      throw new TransportFailure('TOOL_TRANSPORT_FAILED');
    }
  };
}

const transientStatus = (status: number) => [500, 502, 503, 504].includes(status);

function serverCodeOf(body: unknown): string | null {
  const code = isObject(body) && isObject(body.error) ? body.error.code : undefined;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(code) ? code : null;
}

/** Terminal (non-retryable) HTTP outcomes per the route contract. */
function terminalError(status: number, body: unknown): ToolClientError {
  const serverCode = serverCodeOf(body);
  const extra = { status, serverCode };
  const detail = `HTTP ${status}${serverCode ? ` ${serverCode}` : ''}`;
  if (status === 401 || status === 403) return new ToolClientError('unauthorized', detail, extra);
  if (status === 404) return new ToolClientError('not_found', detail, extra);
  if (status === 409) {
    if (serverCode === 'ASSISTANT_TOOL_BUDGET_EXHAUSTED') return new ToolClientError('budget', detail, extra);
    if (serverCode === 'ASSISTANT_INPUT_STALE' || serverCode === 'ASSISTANT_TURN_STALE')
      return new ToolClientError('stale', detail, extra);
    return new ToolClientError('conflict', detail, extra);
  }
  if (status === 400) return new ToolClientError('invalid', detail, extra);
  if (status >= 400 && status < 500) return new ToolClientError('rejected', detail, extra);
  return new ToolClientError('response_invalid', detail, extra);
}

/** Exact envelope of a 200 reply; a completed result must be the one value kind of the tool. */
function parseResult(tool: RoutingTool['name'], operationId: Id, body: unknown): RoutingToolResult {
  const bad = (detail: string) => new ToolClientError('response_invalid', detail);
  if (!isObject(body)) throw bad('reply is not an object');
  if (Object.keys(body).sort().join(',') !== 'errorCode,operationId,result,state') throw bad('reply fields');
  if (typeof body.operationId !== 'string' || body.operationId.toLowerCase() !== operationId)
    throw bad('operation id mismatch');
  const { state, result, errorCode } = body;
  if (state === 'completed') {
    if (errorCode !== null) throw bad('completed with an error code');
    if (!isObject(result) || result.kind !== resultKind[tool])
      throw bad('result kind does not match the tool');
    const shapeOf = valueShapes[resultKind[tool]];
    if (!shapeOf?.(result)) throw bad('result value shape');
  } else if (state === 'pending') {
    if (result !== null || errorCode !== null) throw bad('pending carries a value');
  } else if (state === 'rejected') {
    if (result !== null || !text(1, 200)(errorCode)) throw bad('rejected shape');
  } else throw bad('state');
  return body as unknown as RoutingToolResult;
}

export type ToolClientOptions = {
  /** Gateway private state root; the client owns the `assistant-tools` directory below it. */
  root: string;
  baseUrl: string;
  bearer: string;
  fetch?: typeof fetch;
  /** Attempts per `execute` before the call surfaces as retryable `unavailable`. Default 6. */
  maxAttempts?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};
export type ExecuteOptions = { maxAttempts?: number };
export type ToolClient = {
  execute(turn: ToolTurn, event: RoutingEvent, options?: ExecuteOptions): Promise<RoutingToolResult>;
  close(): Promise<void>;
};

export async function createToolClient(options: ToolClientOptions): Promise<ToolClient> {
  const transport = toolTransport(options.baseUrl, options.bearer, options.fetch ?? fetch);
  const defaultAttempts = options.maxAttempts ?? 6;
  const sleep = options.sleep ?? ((ms: number) => delay(ms));
  const journal = await HttpOperationJournal.open(join(options.root, 'assistant-tools'), transport, {
    ...(options.now ? { now: options.now } : {}),
  });

  async function send(operationId: Id, attempts: number): Promise<HttpResponse> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await journal.retryTransient(operationId);
        if (!transientStatus(response.status)) return response;
      } catch (error) {
        if (!(error instanceof TransportFailure)) throw error;
      }
      if (attempt + 1 >= attempts)
        throw new ToolClientError('unavailable', 'server unavailable', { retryable: true });
      // Matches the journal schedule (1s doubling to 60s), plus a margin so the gate is open.
      await sleep(Math.min(60000, 1000 * 2 ** attempt) + 10);
    }
  }

  async function execute(
    turn: ToolTurn,
    event: RoutingEvent,
    call: ExecuteOptions = {},
  ): Promise<RoutingToolResult> {
    assertToolEvent(event);
    assertTurn(turn);
    const attempts = call.maxAttempts ?? defaultAttempts;
    if (!Number.isSafeInteger(attempts) || attempts < 1) throw invalid('maxAttempts');
    const operationId = toolOperationId(turn.fence.turnId, event.providerCallId, event.sequence);
    const request: RoutingToolRequest = {
      fence: { ...turn.fence },
      operationId,
      clientSequence: event.sequence,
      inputSnapshot: { ...turn.inputSnapshot },
      call: event.call,
    };
    try {
      // Durable before the first send; the same call after a restart finds this exact record.
      await journal.prepare({
        operationId,
        method: 'POST',
        route: `/v2/assistant/turns/${turn.fence.turnId.toLowerCase()}/tools`,
        phase: `${phasePrefix}${event.providerCallId}`,
        canonicalBody: request,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'OPERATION_CONFLICT')
        throw new ToolClientError('conflict', 'operation id already bound to a different request');
      if (
        code === 'SECRET_BODY_FORBIDDEN' ||
        code === 'INVALID_CANONICAL_BODY' ||
        code === 'INVALID_OPERATION'
      )
        throw invalid(code.toLowerCase());
      throw new ToolClientError('journal', 'operation journal failure');
    }
    let response: HttpResponse;
    try {
      response = await send(operationId, attempts);
    } catch (error) {
      if (error instanceof ToolClientError) throw error;
      throw new ToolClientError('journal', 'operation journal failure');
    }
    if (response.status === 200) return parseResult(event.call.name, operationId, response.body);
    if (response.status >= 200 && response.status < 300)
      throw new ToolClientError('response_invalid', `HTTP ${response.status}`, { status: response.status });
    throw terminalError(response.status, response.body);
  }

  return { execute, close: () => journal.close() };
}
