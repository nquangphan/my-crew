import { randomUUID } from 'node:crypto';
import type { Signal } from '../../../src/ticket-policy.ts';
import { transition } from '../../../src/ticket-policy.ts';
import { samePin } from '../../../src/workflow-policy.ts';
import { appendEvent } from '../journal/events.ts';
import type { Actor, Db, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { readCompletionFacts } from './completion.ts';
import type { CreateTicket, Ticket, TicketServiceDependencies } from './contracts.ts';
import { appendComment, recordDecision } from './decisions.ts';
import { addDependency, readGraph } from './dependencies.ts';
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

export async function createTicket(tx: Tx, input: CreateTicket, actor: Actor): Promise<Ticket> {
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
    !validPin(input.workflowPin)
  )
    throw new ApiError('VALIDATION', 400, 'Ticket không hợp lệ');
  await requireProjectScope(tx, input.projectId, actor);
  const id = randomUUID();
  let rootId: Id = id;
  let workflowPin = input.workflowPin;
  let criteria = input.criteria;
  if (input.level === 'request') {
    if (input.parentId !== null) throw new ApiError('TICKET_HIERARCHY', 400, 'Yêu cầu không có ticket cha');
    criteria = { workflowChoice: 'superpowers', ...criteria };
  } else {
    if (!input.parentId) throw new ApiError('TICKET_HIERARCHY', 400, 'Thiếu ticket cha');
    const [parentRow] = await tx`select * from tickets where id=${input.parentId}`;
    if (!parentRow) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket cha');
    if (parentRow.project_id !== input.projectId)
      throw new ApiError('TICKET_HIERARCHY', 409, 'Ticket cha thuộc dự án khác');
    rootId = parentRow.root_id as Id;
    await tx`select id from tickets where id=${rootId} for update`;
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
  const [row] = await tx`insert into tickets
    (id,project_id,parent_id,root_id,level,kind,title,description,status,mandatory,criteria,inputs,outputs,skill,workflow_pin)
    values (${id},${input.projectId},${input.parentId},${rootId},${input.level},${input.kind},${input.title},
      ${input.description},'pending',${input.mandatory},${tx.json(criteria as never)},${tx.json(input.inputs as never)},
      ${tx.json(input.outputs as never)},${input.skill},${workflowPin ? tx.json(workflowPin) : null}) returning *`;
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
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    throw new ApiError('VALIDATION', 400, 'Revision không hợp lệ');
  const ticket = await requireTicket(tx, ticketId, actor, true);
  if (ticket.revision !== expectedRevision)
    throw new ApiError('REVISION_CONFLICT', 409, 'Ticket đã thay đổi');
  const executionSignals = new Set<Signal>([
    'start',
    'pause_confirmed',
    'cancel_confirmed',
    'reconciled_stopped',
    'passed',
  ]);
  if (executionSignals.has(signal)) {
    if (!internal || !deps.execution)
      throw new ApiError('EXECUTION_PROOF_REQUIRED', 409, 'Thiếu xác nhận thực thi');
    await deps.execution.verifySignal(tx, ticketId, signal, evidenceId);
  }
  if (signal === 'dependencies_ready') {
    const [pending] = await tx`select 1 from dependencies d join tickets p on p.id=d.predecessor_id
      where d.ticket_id=${ticketId} and p.status<>'done' limit 1`;
    if (pending) throw new ApiError('DEPENDENCIES_NOT_READY', 409, 'Phụ thuộc chưa hoàn thành');
  }
  if (signal === 'resume' && ticket.repairCycles === 5) {
    const [approval] = await tx`select id from decisions where ticket_id=${ticketId} and kind='owner_answer'
      and scope @> ${tx.json({ repairStepId: ticketId, continueAfterFive: true })}::jsonb limit 1`;
    if (!approval) throw new ApiError('REPAIR_OWNER_DECISION_REQUIRED', 409, 'Cần quyết định của chủ dự án');
  }
  if (signal === 'wait_owner' && ticket.status === 'running') {
    if (!deps.execution)
      throw new ApiError('EXECUTION_PROOF_REQUIRED', 409, 'Thiếu quyền điều khiển tiến trình');
    if (internal) {
      await deps.execution.verifySignal(tx, ticketId, signal, evidenceId);
    } else {
      await deps.execution.requestTerminalIntent(tx, ticketId, 'needs_input', 'owner_input');
      const [row] = await tx`update tickets set wait_reason='owner_input',revision=revision+1
      where id=${ticketId} returning *`;
      await appendEvent(tx, {
        type: 'ticket.changed',
        projectId: ticket.projectId,
        ticketId,
        audienceMachineId: null,
        data: { revision: Number(row?.revision), status: 'running' },
      });
      return mapTicket(row as Record<string, unknown>);
    }
  }
  let next: Ticket['status'];
  try {
    next = transition(ticket.status, signal);
  } catch {
    throw new ApiError('INVALID_TICKET_TRANSITION', 409, 'Không thể chuyển trạng thái ticket');
  }
  let mergedCommit = ticket.mergedCommit;
  if (signal === 'passed') {
    const facts = await readCompletionFacts(tx, ticket, deps.docsCompletion);
    if (!facts.ready) throw new ApiError('COMPLETION_GATE', 409, 'Thiếu bằng chứng hoàn tất');
    mergedCommit = facts.mergedCommit;
  }
  if (signal === 'cancel_confirmed' && !internal)
    throw new ApiError('EXECUTION_PROOF_REQUIRED', 409, 'Thiếu xác nhận dừng tiến trình');
  const [row] = await tx`update tickets set status=${next}, revision=revision+1,merged_commit=${mergedCommit},
    wait_reason=${next === 'needs_input' ? 'owner_input' : null}
    where id=${ticketId} returning *`;
  await appendEvent(tx, {
    type: 'ticket.changed',
    projectId: ticket.projectId,
    ticketId,
    audienceMachineId: null,
    data: { revision: Number(row?.revision), status: next },
  });
  return mapTicket(row as Record<string, unknown>);
}

export function createTicketServices(deps: TicketServiceDependencies = {}) {
  const immutable: Readonly<TicketServiceDependencies> = Object.freeze({
    docsCompletion: deps.docsCompletion,
    docsSource: deps.docsSource,
    execution: deps.execution ? Object.freeze({ ...deps.execution }) : undefined,
  });
  return {
    mapTicket,
    createTicket,
    addDependency,
    appendComment,
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
