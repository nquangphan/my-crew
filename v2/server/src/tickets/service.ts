import { randomUUID } from 'node:crypto';
import type { Signal } from '../../../src/ticket-policy.ts';
import { transition } from '../../../src/ticket-policy.ts';
import { samePin } from '../../../src/workflow-policy.ts';
import type { OrchestrationProof } from '../assistant/contracts.ts';
import { appendEvent } from '../journal/events.ts';
import type { Actor, Db, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { PreparedAssistantTarget, VerifiedAssistantScope } from './assistant-access.ts';
import {
  captureAssistantOperation,
  consumeAssistantScope,
  createAssistantAccess,
  immutableSnapshot,
  invalidScope,
  orchestrationTargetHash,
  uuid,
} from './assistant-access.ts';
import { readCompletionFacts } from './completion.ts';
import type {
  AppendAttachmentComment,
  CreateTicket,
  Ticket,
  TicketServiceDependencies,
} from './contracts.ts';
import {
  appendAttachmentComment,
  appendComment,
  createAssistantDecisionRecorder,
  recordDecision,
} from './decisions.ts';
import { addDependency, createAssistantDependencyWriter, readGraph } from './dependencies.ts';
import { deployTicketFingerprint, verifyDeployApprovalForCandidate } from './deploy.ts';
import { linkDocs } from './docs-links.ts';
import { recordRepairResult } from './repair.ts';

export function mapTicket(row: Record<string, unknown>): Ticket {
  return {
    id: row.id as Id,
    projectId: row.project_id as Id,
    parentId: row.parent_id as Id | null,
    rootId: row.root_id as Id,
    level: row.level as Ticket['level'],
    kind: row.kind as Ticket['kind'],
    title: row.title as string,
    description: row.description as string,
    mandatory: row.mandatory as boolean,
    criteria: row.criteria as Record<string, unknown>,
    inputs: row.inputs as Record<string, unknown>,
    outputs: row.outputs as Record<string, unknown>,
    skill: row.skill as string | null,
    workflowPin: row.workflow_pin as Ticket['workflowPin'],
    status: row.status as Ticket['status'],
    revision: Number(row.revision),
    waitReason: row.wait_reason as string | null,
    repairCycles: Number(row.repair_cycles),
    mergedCommit: row.merged_commit as string | null,
  };
}

export async function requireProjectScope(tx: Tx, projectId: Id, actor: Actor): Promise<void> {
  const [project] = await tx`select id,machine_id from projects where id=${projectId}`;
  if (!project || (actor.kind === 'machine' && project.machine_id !== actor.id))
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
}

export async function requireTicket(tx: Tx, ticketId: Id, actor: Actor, lock = false): Promise<Ticket> {
  const [row] = lock
    ? await tx`select * from tickets where id=${ticketId} for update`
    : await tx`select * from tickets where id=${ticketId}`;
  if (!row) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
  await requireProjectScope(tx, row.project_id as Id, actor);
  return mapTicket(row);
}

function validObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

export function safeTicketJson(value: unknown, seen = new Set<object>(), depth = 0): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 32 || seen.has(value)) return false;
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null &&
    !Array.isArray(value)
  )
    return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.every((item) => safeTicketJson(item, seen, depth + 1));
    if (Object.getOwnPropertySymbols(value).length) return false;
    return Object.keys(value).every((name) => {
      if (name === '__proto__' || name === 'prototype' || name === 'constructor') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      return !!descriptor && 'value' in descriptor && safeTicketJson(descriptor.value, seen, depth + 1);
    });
  } finally {
    seen.delete(value);
  }
}

function validPin(pin: CreateTicket['workflowPin']): boolean {
  return (
    pin === null ||
    (validObject(pin) &&
      (pin.workflow === 'superpowers' || pin.workflow === 'bmad') &&
      typeof pin.version === 'string' &&
      !!pin.version &&
      typeof pin.revision === 'string' &&
      !!pin.revision &&
      typeof pin.checksum === 'string' &&
      /^[0-9a-f]{64}$/i.test(pin.checksum))
  );
}

function validateCreateTicket(input: CreateTicket): void {
  if (
    !['request', 'step', 'task'].includes(input.level) ||
    !['code', 'research', 'docs', 'deploy'].includes(input.kind) ||
    typeof input.title !== 'string' ||
    input.title.length < 1 ||
    input.title.length > 200 ||
    typeof input.description !== 'string' ||
    typeof input.mandatory !== 'boolean' ||
    !validObject(input.criteria) ||
    !validObject(input.inputs) ||
    !validObject(input.outputs) ||
    !safeTicketJson(input.criteria) ||
    !safeTicketJson(input.inputs) ||
    !safeTicketJson(input.outputs) ||
    (input.skill !== null && (typeof input.skill !== 'string' || input.skill.length > 200)) ||
    !validPin(input.workflowPin) ||
    (input.deployApprovalDecisionId !== undefined &&
      input.deployApprovalDecisionId !== null &&
      (typeof input.deployApprovalDecisionId !== 'string' || !uuid.test(input.deployApprovalDecisionId))) ||
    (input.kind !== 'deploy' && input.deployApprovalDecisionId != null)
  )
    throw new ApiError('VALIDATION', 400, 'Ticket không hợp lệ');
}

type PreparedTicket = {
  id: Id;
  rootId: Id;
  workflowPin: CreateTicket['workflowPin'];
  criteria: CreateTicket['criteria'];
  deployDefinitionHash: string | null;
  deployApprovalDecisionId: Id | null;
};

// Shared hierarchy, pin and deploy invariants. Scoped callers finish these locks
// before entering their authority; the insert core never acquires a late fence.
async function prepareTicket(tx: Tx, input: CreateTicket, actor: Actor): Promise<PreparedTicket> {
  const id = randomUUID();
  let rootId: Id = id;
  let workflowPin = input.workflowPin;
  let criteria = input.criteria;
  if (input.level === 'request') {
    if (input.parentId !== null) throw new ApiError('TICKET_HIERARCHY', 400, 'Yêu cầu không có ticket cha');
    if (input.kind === 'deploy' && actor.kind !== 'owner')
      throw new ApiError('DEPLOY_OWNER_INTENT_REQUIRED', 403, 'Cần yêu cầu deploy của chủ dự án');
    criteria = { workflowChoice: 'superpowers', ...criteria };
  } else {
    if (!input.parentId) throw new ApiError('TICKET_HIERARCHY', 400, 'Thiếu ticket cha');
    const [initialParent] = await tx`select root_id from tickets where id=${input.parentId}`;
    if (!initialParent) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket cha');
    rootId = initialParent.root_id as Id;
    const [rootRow] = await tx`select * from tickets where id=${rootId} for update`;
    const [parentRow] = await tx`select * from tickets where id=${input.parentId} for update`;
    if (
      !rootRow ||
      !parentRow ||
      parentRow.root_id !== rootId ||
      parentRow.project_id !== input.projectId.toLowerCase()
    )
      throw new ApiError('TICKET_HIERARCHY', 409, 'Ticket cha thuộc cây khác');
    if (
      rootRow.status === 'done' ||
      rootRow.status === 'cancelled' ||
      parentRow.status === 'done' ||
      parentRow.status === 'cancelled'
    )
      throw new ApiError('TICKET_CLOSED', 409, 'Cây ticket đã kết thúc');
    const requiredLevel = input.level === 'step' ? 'request' : 'step';
    if (parentRow.level !== requiredLevel)
      throw new ApiError('TICKET_HIERARCHY', 400, 'Chỉ hỗ trợ yêu cầu → bước → công việc');
    const parentPin = parentRow.workflow_pin as CreateTicket['workflowPin'];
    if (parentPin && workflowPin && !samePin(parentPin, workflowPin))
      throw new ApiError('WORKFLOW_PIN_MISMATCH', 409, 'Workflow khác ticket cha');
    if (!parentPin && workflowPin)
      throw new ApiError('WORKFLOW_PIN_MISMATCH', 409, 'Ticket cha chưa ghim workflow');
    workflowPin = parentPin;
  }
  let deployDefinitionHash: string | null = null;
  let deployApprovalDecisionId: Id | null = null;
  if (input.kind === 'deploy') {
    deployDefinitionHash = deployTicketFingerprint({ ...input, workflowPin }, rootId);
    if (input.deployApprovalDecisionId) {
      if (
        !(await verifyDeployApprovalForCandidate(
          tx,
          rootId,
          input.deployApprovalDecisionId,
          deployDefinitionHash,
        ))
      )
        throw new ApiError('DEPLOY_OWNER_INTENT_REQUIRED', 403, 'Duyệt deploy không khớp hành động');
      deployApprovalDecisionId = input.deployApprovalDecisionId;
    } else if (actor.kind === 'machine') {
      throw new ApiError('DEPLOY_OWNER_INTENT_REQUIRED', 403, 'Cần chủ dự án duyệt deploy');
    }
  }
  return { id, rootId, workflowPin, criteria, deployDefinitionHash, deployApprovalDecisionId };
}

type ScopedCreatePermission = {
  tx: Tx;
  actor: Actor;
  proof: OrchestrationProof;
  input: CreateTicket;
  action: 'create_ticket';
  targetSha256: string;
  projectId: Id;
  rootId: Id;
  prepared: PreparedTicket;
};

// Runtime identity is module-private: a JSON object or TypeScript cast cannot
// manufacture an entry, and each entry is consumed by one insertion attempt.
const scopedCreatePermissions = new WeakMap<object, ScopedCreatePermission>();
function createTargetHash(input: CreateTicket): string {
  return orchestrationTargetHash('create_ticket', input);
}

async function createTicketCore(
  tx: Tx,
  input: CreateTicket,
  actor: Actor,
  permission?: object,
): Promise<Ticket> {
  validateCreateTicket(input);
  let prepared: PreparedTicket;
  if (permission) {
    const scope = scopedCreatePermissions.get(permission);
    scopedCreatePermissions.delete(permission);
    if (
      !scope ||
      scope.tx !== tx ||
      scope.actor !== actor ||
      scope.input !== input ||
      scope.action !== 'create_ticket' ||
      scope.targetSha256 !== createTargetHash(input) ||
      scope.projectId !== input.projectId.toLowerCase() ||
      scope.rootId !== scope.prepared.rootId
    )
      throw invalidScope();
    prepared = scope.prepared;
  } else {
    await requireProjectScope(tx, input.projectId, actor);
    prepared = await prepareTicket(tx, input, actor);
  }
  const { id, rootId, workflowPin, criteria, deployDefinitionHash, deployApprovalDecisionId } = prepared;
  const [row] = await tx`insert into tickets
    (id,project_id,parent_id,root_id,level,kind,title,description,status,mandatory,criteria,inputs,outputs,skill,workflow_pin,
      created_actor_kind,created_actor_id,deploy_definition_hash,deploy_approval_decision_id)
    values (${id},${input.projectId},${input.parentId},${rootId},${input.level},${input.kind},${input.title},
      ${input.description},'pending',${input.mandatory},${tx.json(criteria as never)},${tx.json(input.inputs as never)},
      ${tx.json(input.outputs as never)},${input.skill},${workflowPin ? tx.json(workflowPin) : null},
      ${actor.kind},${actor.id},${deployDefinitionHash},${deployApprovalDecisionId}) returning *`;
  if (!row) throw new Error('TICKET_INSERT_FAILED');
  await appendEvent(tx, {
    type: 'ticket.created',
    projectId: input.projectId,
    ticketId: id,
    audienceMachineId: null,
    data: { revision: 1, status: 'pending' },
  });
  return mapTicket(row);
}

export async function createTicket(tx: Tx, input: CreateTicket, actor: Actor): Promise<Ticket> {
  return createTicketCore(tx, input, actor);
}

function scopedTicketCreator(verify: TicketServiceDependencies['assistant']) {
  const verifyCaptured = verify?.verify.bind(verify);
  return async (tx: Tx, actor: Actor, proof: OrchestrationProof, input: CreateTicket): Promise<Ticket> => {
    // All caller-owned data is captured synchronously, before any DB or producer wait.
    const capturedInput = immutableSnapshot(input);
    const capturedActor = immutableSnapshot(actor);
    const capturedProof = immutableSnapshot(proof);
    validateCreateTicket(capturedInput);
    if (capturedActor.kind !== 'machine')
      throw new ApiError('ORCHESTRATION_MACHINE_REQUIRED', 403, 'Chỉ máy trợ lý được điều phối');
    if (
      !uuid.test(capturedActor.id) ||
      !uuid.test(capturedInput.projectId) ||
      (capturedInput.parentId !== null && !uuid.test(capturedInput.parentId))
    )
      throw new ApiError('VALIDATION', 400, 'Định danh điều phối không hợp lệ');
    if (!verifyCaptured)
      throw new ApiError('ORCHESTRATION_UNAVAILABLE', 503, 'Chưa có nguồn xác minh điều phối');
    const targetSha256 = createTargetHash(capturedInput);
    const prepared = await prepareTicket(tx, capturedInput, capturedActor);
    const [project] = await tx`select id from projects where id=${capturedInput.projectId} for update`;
    if (!project) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
    await verifyCaptured(tx, capturedActor, capturedProof, 'create_ticket', targetSha256);
    const permission = Object.freeze({});
    scopedCreatePermissions.set(permission, {
      tx,
      actor: capturedActor,
      proof: capturedProof,
      input: capturedInput,
      action: 'create_ticket',
      targetSha256,
      projectId: project.id as Id,
      rootId: prepared.rootId,
      prepared,
    });
    return createTicketCore(tx, capturedInput, capturedActor, permission);
  };
}

type AssistantSignal = 'dependencies_ready' | 'wait_owner';
type SignalPayload = { ticketId: Id; signal: AssistantSignal; expectedRevision: number };
type PreparedSignal = Readonly<{
  tx: Tx;
  ticket: Ticket;
  signal: Signal;
  continuationDecisionId: Id | null;
}>;
type SignalOutcome = { next: Ticket['status']; waitReason: string | null; mergedCommit: string | null };
type SignalPermission = {
  target: PreparedAssistantTarget<SignalPayload>;
  scope: VerifiedAssistantScope<SignalPayload>;
};

const executionSignals: ReadonlySet<Signal> = new Set<Signal>([
  'start',
  'pause_confirmed',
  'cancel_confirmed',
  'reconciled_stopped',
  'passed',
]);
const assistantSignals: ReadonlySet<unknown> = new Set<AssistantSignal>(['dependencies_ready', 'wait_owner']);

function validateSignalRevision(expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    throw new ApiError('VALIDATION', 400, 'Revision không hợp lệ');
}

// Generic signal prefix: locks the root, then the target under the generic ticket ACL.
async function prepareSignal(
  tx: Tx,
  ticketId: Id,
  signal: Signal,
  expectedRevision: number,
  actor: Actor,
): Promise<PreparedSignal> {
  const [scope] = await tx`select root_id from tickets where id=${ticketId}`;
  if (!scope) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
  await tx`select id from tickets where id=${scope.root_id} for update`;
  const ticket = await requireTicket(tx, ticketId, actor, true);
  return checkSignal(tx, ticket, signal, expectedRevision);
}

// Shared CAS core for generic and scoped signals; the caller already holds the
// root and target locks (scoped callers also hold the project lock).
async function checkSignal(
  tx: Tx,
  ticket: Ticket,
  signal: Signal,
  expectedRevision: number,
): Promise<PreparedSignal> {
  const ticketId = ticket.id;
  if (ticket.revision !== expectedRevision)
    throw new ApiError('REVISION_CONFLICT', 409, 'Ticket đã thay đổi');
  if (signal === 'dependencies_ready') {
    const [pending] = await tx`select 1 from dependencies d join tickets p on p.id=d.predecessor_id
      where d.ticket_id=${ticketId} and p.status<>'done' limit 1`;
    if (pending) throw new ApiError('DEPENDENCIES_NOT_READY', 409, 'Phụ thuộc chưa hoàn thành');
  }
  let continuationDecisionId: Id | null = null;
  if (signal === 'resume' && ticket.repairCycles === 5) {
    const [limit] = await tx`select repair_limit_cycle_id,repair_limit_at,repair_limit_consumed_decision_id
      from tickets where id=${ticketId}`;
    if (limit?.repair_limit_cycle_id) {
      if (limit.repair_limit_consumed_decision_id)
        throw new ApiError('REPAIR_OWNER_DECISION_REQUIRED', 409, 'Quyết định đã được sử dụng');
      const [approval] = await tx`select id from decisions where ticket_id=${ticketId}
        and kind='owner_answer' and actor_kind='owner' and created_at>${limit.repair_limit_at}
        and scope @> ${tx.json({
          repairStepId: ticketId,
          cycleId: limit.repair_limit_cycle_id,
          continueAfterFive: true,
        })}::jsonb
        order by created_at,id limit 1`;
      if (!approval)
        throw new ApiError('REPAIR_OWNER_DECISION_REQUIRED', 409, 'Cần quyết định của chủ dự án');
      continuationDecisionId = approval.id as Id;
    }
  }
  return Object.freeze({ tx, ticket, signal, continuationDecisionId });
}

function signalTransition(ticket: Ticket, signal: Signal): Pick<SignalOutcome, 'next' | 'waitReason'> {
  let next: Ticket['status'];
  try {
    next = transition(ticket.status, signal);
  } catch {
    throw new ApiError('INVALID_TICKET_TRANSITION', 409, 'Không thể chuyển trạng thái ticket');
  }
  const waitReason =
    next === 'needs_input' ? (ticket.waitReason === 'repair_limit' ? 'repair_limit' : 'owner_input') : null;
  return { next, waitReason };
}

async function persistSignal(
  tx: Tx,
  prepared: PreparedSignal,
  outcome: SignalOutcome,
  permission?: SignalPermission,
): Promise<Ticket> {
  if (prepared.tx !== tx) throw invalidScope();
  if (permission) {
    const operation = permission.target.operation;
    if (
      operation.action !== 'signal' ||
      operation.payload.ticketId.toLowerCase() !== prepared.ticket.id ||
      operation.payload.signal !== prepared.signal ||
      permission.target.tickets.length !== 1 ||
      permission.target.tickets[0]?.id !== prepared.ticket.id ||
      prepared.continuationDecisionId !== null
    )
      throw invalidScope();
    consumeAssistantScope(tx, permission.scope, operation, permission.target);
  }
  const { ticket, continuationDecisionId } = prepared;
  const [row] = await tx`update tickets set status=${outcome.next}, revision=revision+1,
    merged_commit=${outcome.mergedCommit}, wait_reason=${outcome.waitReason},
    repair_limit_cycle_id=case when ${continuationDecisionId}::uuid is not null then null else repair_limit_cycle_id end,
    repair_limit_at=case when ${continuationDecisionId}::uuid is not null then null else repair_limit_at end,
    repair_limit_consumed_decision_id=coalesce(${continuationDecisionId}::uuid,repair_limit_consumed_decision_id)
    where id=${ticket.id} returning *`;
  if (!row) throw new Error('TICKET_UPDATE_FAILED');
  await appendEvent(tx, {
    type: 'ticket.changed',
    projectId: ticket.projectId,
    ticketId: ticket.id,
    audienceMachineId: null,
    data: { revision: Number(row.revision), status: outcome.next },
  });
  return mapTicket(row);
}

async function signalTicketWithDependencies(
  tx: Tx,
  ticketId: Id,
  signal: Signal,
  expectedRevision: number,
  evidenceId: Id | null,
  actor: Actor,
  deps: TicketServiceDependencies,
  internal: boolean,
): Promise<Ticket> {
  validateSignalRevision(expectedRevision);
  const prepared = await prepareSignal(tx, ticketId, signal, expectedRevision, actor);
  const { ticket } = prepared;
  if (executionSignals.has(signal)) {
    if (!internal || !deps.execution)
      throw new ApiError('EXECUTION_PROOF_REQUIRED', 409, 'Thiếu xác nhận thực thi');
    await deps.execution.verifySignal(tx, ticketId, signal, evidenceId);
  }
  if (signal === 'wait_owner' && ticket.status === 'running') {
    if (!deps.execution)
      throw new ApiError('EXECUTION_PROOF_REQUIRED', 409, 'Thiếu quyền điều khiển tiến trình');
    if (internal) {
      await deps.execution.verifySignal(tx, ticketId, signal, evidenceId);
    } else {
      const reason = ticket.waitReason === 'repair_limit' ? 'repair_limit' : 'owner_input';
      await deps.execution.requestTerminalIntent(tx, ticketId, 'needs_input', reason);
      const [row] = await tx`update tickets set wait_reason=${reason},revision=revision+1
      where id=${ticketId} returning *`;
      await appendEvent(tx, {
        type: 'ticket.changed',
        projectId: ticket.projectId,
        ticketId,
        audienceMachineId: null,
        data: { revision: Number(row?.revision), status: row?.status as Ticket['status'] },
      });
      return mapTicket(row as Record<string, unknown>);
    }
  }
  const { next, waitReason } = signalTransition(ticket, signal);
  let mergedCommit = ticket.mergedCommit;
  if (signal === 'passed') {
    const facts = await readCompletionFacts(tx, ticket, deps.docsCompletion);
    if (!facts.ready) throw new ApiError('COMPLETION_GATE', 409, 'Thiếu bằng chứng hoàn tất');
    mergedCommit = facts.mergedCommit;
  }
  if (signal === 'cancel_confirmed' && !internal)
    throw new ApiError('EXECUTION_PROOF_REQUIRED', 409, 'Thiếu xác nhận dừng tiến trình');
  return persistSignal(tx, prepared, { next, waitReason, mergedCommit });
}

// Scoped A→B signal. Only dependencies_ready and wait_owner on a ticket that is not
// running: stopping a running process needs an execution terminal intent bound to
// this Actor, so that branch fails closed instead of borrowing an owner intent.
// Shares the B2a prefix: root → ticket → project locks with recheck, one-use scope.
function createAssistantSignalWriter(authority?: TicketServiceDependencies['assistant']) {
  const access = createAssistantAccess(authority);
  return async (
    tx: Tx,
    actor: Actor,
    proof: OrchestrationProof,
    ticketId: Id,
    signal: AssistantSignal,
    expectedRevision: number,
  ): Promise<Ticket> => {
    // Actor, proof and payload are captured synchronously, before any DB or producer wait.
    const operation = captureAssistantOperation<SignalPayload>(actor, proof, 'signal', {
      ticketId,
      signal,
      expectedRevision,
    });
    const payload = operation.payload;
    if (
      typeof payload.ticketId !== 'string' ||
      !uuid.test(payload.ticketId) ||
      !assistantSignals.has(payload.signal)
    )
      throw new ApiError('VALIDATION', 400, 'Tín hiệu điều phối không hợp lệ');
    validateSignalRevision(payload.expectedRevision);
    const target = await access.prepare(tx, operation, [payload.ticketId]);
    const [locked] = target.tickets;
    if (!locked) throw invalidScope();
    const [row] = await tx`select * from tickets where id=${locked.id}`;
    if (!row) throw invalidScope();
    const prepared = await checkSignal(tx, mapTicket(row), payload.signal, payload.expectedRevision);
    if (payload.signal === 'wait_owner' && prepared.ticket.status === 'running')
      throw new ApiError('EXECUTION_PROOF_REQUIRED', 409, 'Thiếu xác nhận thực thi');
    const outcome = signalTransition(prepared.ticket, payload.signal);
    const scope = await access.authorize(tx, target);
    return persistSignal(
      tx,
      prepared,
      { ...outcome, mergedCommit: prepared.ticket.mergedCommit },
      { target, scope },
    );
  };
}

export function createTicketServices(deps: TicketServiceDependencies = {}) {
  const immutable: Readonly<TicketServiceDependencies> = Object.freeze({
    docsCompletion: deps.docsCompletion,
    docsSource: deps.docsSource,
    commentAttachments: deps.commentAttachments,
    execution: deps.execution ? Object.freeze({ ...deps.execution }) : undefined,
  });
  return {
    mapTicket,
    createTicket,
    assistantCreateTicket: scopedTicketCreator(deps.assistant),
    assistantRecordDecision: createAssistantDecisionRecorder(deps.assistant, immutable.docsSource),
    assistantAddDependency: createAssistantDependencyWriter(deps.assistant),
    assistantSignalTicket: createAssistantSignalWriter(deps.assistant),
    addDependency,
    appendComment,
    appendAttachmentComment: (
      tx: Tx,
      ticketId: Id,
      input: Parameters<AppendAttachmentComment>[2],
      actor: Actor,
    ) => appendAttachmentComment(tx, ticketId, input, actor, immutable.commentAttachments),
    recordDecision: (tx: Tx, ticketId: Id, input: Parameters<typeof recordDecision>[2], actor: Actor) =>
      recordDecision(tx, ticketId, input, actor, immutable.docsSource),
    recordRepairResult: (tx: Tx, input: Parameters<typeof recordRepairResult>[1], actor: Actor) =>
      recordRepairResult(tx, input, actor, immutable.execution),
    linkDocs: (tx: Tx, ticketId: Id, snapshotId: Id, paths: string[], revision: number, actor: Actor) =>
      linkDocs(tx, ticketId, snapshotId, paths, revision, actor, immutable.docsSource),
    signalTicket: (tx: Tx, id: Id, signal: Signal, revision: number, evidenceId: Id | null, actor: Actor) =>
      signalTicketWithDependencies(tx, id, signal, revision, evidenceId, actor, immutable, false),
    applyExecutionSignal: (
      tx: Tx,
      id: Id,
      signal: Signal,
      revision: number,
      evidenceId: Id | null,
      actor: Actor,
    ) => signalTicketWithDependencies(tx, id, signal, revision, evidenceId, actor, immutable, true),
    readGraph,
  };
}

export const signalTicket = createTicketServices().signalTicket;
export const applyExecutionSignal = createTicketServices().applyExecutionSignal;
export async function getTicket(db: Db, id: Id, actor: Actor): Promise<Ticket> {
  return db.begin((tx) => requireTicket(tx, id, actor));
}
