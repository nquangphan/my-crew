import {
  type Actor,
  type AgentRole,
  type CreateRequestTicket as CreateRequestInput,
  CreateRequestTicket,
  type CreateSubtaskRequest as CreateSubtaskInput,
  CreateSubtaskRequest,
  canTransition,
  type FileBugRequest as FileBugInput,
  FileBugRequest,
  qcDefaultMcps,
  REQUEST_KEY_SCOPE,
  TERMINAL_STATUSES,
  type Ticket,
  type TicketStatus,
  type TicketType,
} from '@crew/shared';
import { and, arrayContains, asc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.js';
import {
  type CommentRow,
  comments,
  machines,
  type ProjectRow,
  projects,
  type TicketRow,
  ticketCounters,
  ticketReports,
  tickets,
} from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { applyHold, enforceChildCap, liftHold } from './budget-service.js';
import { appendEvents, type NewEvent } from './event-service.js';

/** The QC bug loop stops after this many bug cycles per root dev ticket. */
export const MAX_BUG_CYCLES = 3;

const TERMINAL = [...TERMINAL_STATUSES];
const isTerminal = (status: TicketStatus) => TERMINAL.includes(status);

const ROLE_BY_TYPE: Record<TicketType, AgentRole> = {
  request: 'assistant',
  pm_task: 'pm',
  dev: 'dev',
  bug: 'dev',
  docs_init: 'dev',
  qc: 'qc',
};

export function toTicketDto(row: TicketRow): Ticket {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    description: row.description,
    type: row.type,
    parentId: row.parentId,
    projectId: row.projectId,
    projectHintId: row.projectHintId,
    assigneeRole: row.assigneeRole,
    assigneeMachineId: row.assigneeMachineId,
    status: row.status,
    priority: row.priority,
    allowConfigChange: row.allowConfigChange,
    complexity: row.complexity,
    model: row.model,
    effort: row.effort,
    requiredSkills: row.requiredSkills,
    requiredMcps: row.requiredMcps,
    dependsOn: row.dependsOn,
    pairsWith: row.pairsWith,
    originDevId: row.originDevId,
    bugCycle: row.bugCycle,
    flows: row.flows,
    agentSessionId: row.agentSessionId,
    costUsd: row.costUsd,
    budgetHold: row.budgetHold,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Row access and locking
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Looks a ticket up by uuid or by key (e.g. `AST-1`). */
export async function getTicketRow(db: Executor, idOrKey: string): Promise<TicketRow> {
  const where = UUID_RE.test(idOrKey) ? eq(tickets.id, idOrKey) : eq(tickets.key, idOrKey.toUpperCase());
  const [row] = await db.select().from(tickets).where(where);
  if (!row) throw notFound('ticket');
  return row;
}

async function lockTicket(tx: Executor, id: string): Promise<TicketRow> {
  const [row] = await tx.select().from(tickets).where(eq(tickets.id, id)).for('update');
  if (!row) throw notFound('ticket');
  return row;
}

/**
 * Locks a ticket's parent, then the ticket. Every writer locks top-down in this order, which keeps the
 * "last child done" check race-free and avoids lock-order deadlocks.
 */
export async function lockWithParent(
  tx: Executor,
  idOrKey: string,
): Promise<{ ticket: TicketRow; parent: TicketRow | null }> {
  const found = await getTicketRow(tx, idOrKey);
  const parent = found.parentId ? await lockTicket(tx, found.parentId) : null;
  const ticket = await lockTicket(tx, found.id);
  return { ticket, parent };
}

async function findProject(tx: Executor, id: string | null): Promise<ProjectRow | null> {
  if (!id) return null;
  const [row] = await tx.select().from(projects).where(eq(projects.id, id));
  return row ?? null;
}

/** The pm_task whose caps and budgets govern a ticket: itself, its pm_task parent, or none. */
export function governingPmTask(ticket: TicketRow, parent: TicketRow | null): TicketRow | null {
  if (ticket.type === 'pm_task') return ticket;
  return parent?.type === 'pm_task' ? parent : null;
}

/**
 * Runs `fn` in a transaction. When it returns an ApiError, the transaction still commits (it holds side
 * effects such as parking a pm_task) and the error is thrown afterwards.
 */
async function commitThenThrow<T>(db: Executor, fn: (tx: Transaction) => Promise<T | ApiError>): Promise<T> {
  const result = await db.transaction(fn);
  if (result instanceof ApiError) throw result;
  return result;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

type InsertTicket = Omit<
  typeof tickets.$inferInsert,
  'id' | 'key' | 'assigneeRole' | 'createdAt' | 'updatedAt'
> & {
  type: TicketType;
};

/** Allocates the next key in `scope` inside the transaction; the row lock serialises concurrent creators. */
async function allocateKey(tx: Executor, scope: string): Promise<string> {
  const [row] = await tx
    .insert(ticketCounters)
    .values({ scope, next: 2 })
    .onConflictDoUpdate({ target: ticketCounters.scope, set: { next: sql`${ticketCounters.next} + 1` } })
    .returning({ next: ticketCounters.next });
  if (!row) throw new Error('ticket counter upsert returned no row');
  return `${scope}-${row.next - 1}`;
}

async function insertTicket(tx: Executor, scope: string, values: InsertTicket): Promise<TicketRow> {
  const key = await allocateKey(tx, scope);
  const assigneeRole = ROLE_BY_TYPE[values.type];
  const [row] = await tx
    .insert(tickets)
    .values({ ...values, key, assigneeRole })
    .returning();
  if (!row) throw new Error('ticket insert returned no row');
  await appendEvents(tx, [
    {
      payload: { type: 'ticket.assigned', data: { ticketId: row.id, role: assigneeRole } },
      ticketId: row.id,
      projectId: row.projectId,
      targetMachineId: row.assigneeMachineId,
      targetRole: assigneeRole,
    },
  ]);
  return row;
}

/** Owner creates a request; it is assigned to the machine hosting the assistant, when one is paired. */
export async function createRequestTicket(db: Executor, input: CreateRequestInput): Promise<Ticket> {
  const data = CreateRequestTicket.parse(input);
  return db.transaction(async (tx) => {
    if (data.projectHintId && !(await findProject(tx, data.projectHintId))) throw notFound('hinted project');
    const [host] = await tx
      .select({ id: machines.id })
      .from(machines)
      .where(eq(machines.hostsAssistant, true));
    const row = await insertTicket(tx, REQUEST_KEY_SCOPE, {
      type: 'request',
      title: data.title,
      description: data.description,
      priority: data.priority,
      projectHintId: data.projectHintId,
      allowConfigChange: data.allowConfigChange,
      assigneeMachineId: host?.id ?? null,
    });
    return toTicketDto(row);
  });
}

/**
 * Agents create a pm_task under a request, and dev/qc/docs_init under a pm_task (3 levels at most).
 * The machine is resolved from the project; QC tickets get the platform's UI-test MCP servers.
 */
export async function createSubtask(db: Executor, input: CreateSubtaskInput): Promise<Ticket> {
  const data = CreateSubtaskRequest.parse(input);
  return commitThenThrow(db, async (tx) => {
    const parent = await lockTicket(tx, data.parentId);
    const expectedParent: TicketType = data.type === 'pm_task' ? 'request' : 'pm_task';
    if (parent.type !== expectedParent) {
      throw new ApiError(
        'INVALID_HIERARCHY',
        `a ${data.type} ticket must be created under a ${expectedParent}`,
      );
    }
    if (isTerminal(parent.status))
      throw new ApiError('PARENT_CLOSED', `parent ${parent.key} is ${parent.status}`);

    let project: ProjectRow | null;
    if (data.type === 'pm_task') {
      if (!data.projectId) throw new ApiError('VALIDATION_FAILED', 'projectId is required for a pm_task');
      project = await findProject(tx, data.projectId);
      if (!project) throw notFound('project');
    } else {
      if (data.projectId && data.projectId !== parent.projectId) {
        throw new ApiError('INVALID_HIERARCHY', 'a subtask belongs to its pm_task project');
      }
      project = await findProject(tx, parent.projectId);
      if (!project) throw new ApiError('INVALID_HIERARCHY', `pm_task ${parent.key} has no project`);
      if (parent.budgetHold) {
        throw new ApiError('BUDGET_HOLD', `${parent.key} waits for owner approval (${parent.budgetHold})`);
      }
      const capError = await enforceChildCap(tx, parent, project, 1);
      if (capError) return capError;
    }

    const dependsOn = [...new Set(data.dependsOn)];
    let requiredMcps = [...new Set(data.requiredMcps)];
    if (data.type === 'qc') {
      if (!data.pairsWith)
        throw new ApiError('VALIDATION_FAILED', 'a qc ticket needs pairsWith (its dev ticket)');
      await assertPairable(tx, parent.id, data.pairsWith);
      if (!dependsOn.includes(data.pairsWith)) dependsOn.push(data.pairsWith);
      requiredMcps = mergeUnique(requiredMcps, qcDefaultMcps(project.platform, project.uiTestMcp));
    } else if (data.pairsWith) {
      throw new ApiError('VALIDATION_FAILED', 'only qc tickets pair with another ticket');
    }
    await assertSiblings(tx, parent.id, dependsOn);

    const row = await insertTicket(tx, project.key, {
      type: data.type,
      parentId: parent.id,
      projectId: project.id,
      title: data.title,
      description: data.description,
      priority: data.priority ?? parent.priority,
      allowConfigChange: parent.allowConfigChange,
      assigneeMachineId: project.ownerMachineId,
      complexity: data.complexity ?? null,
      model: data.model ?? null,
      effort: data.effort ?? null,
      requiredSkills: [...new Set(data.requiredSkills)],
      requiredMcps,
      dependsOn,
      pairsWith: data.pairsWith ?? null,
      originDevId: null,
      bugCycle: 0,
      flows: [...new Set(data.flows)],
    });
    return toTicketDto(row);
  });
}

const mergeUnique = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];

async function assertSiblings(tx: Executor, parentId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.parentId, parentId), inArray(tickets.id, [...ids])));
  if (found.length !== ids.length) {
    const known = new Set(found.map((r) => r.id));
    throw new ApiError('INVALID_DEPENDENCY', 'dependsOn must list sibling tickets', {
      unknown: ids.filter((id) => !known.has(id)),
    });
  }
}

/** A QC ticket pairs with one live dev or bug sibling, and each of those has one live QC ticket. */
async function assertPairable(tx: Executor, parentId: string, pairsWith: string): Promise<void> {
  const [target] = await tx
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, pairsWith), eq(tickets.parentId, parentId)));
  if (!target || (target.type !== 'dev' && target.type !== 'bug')) {
    throw new ApiError('INVALID_DEPENDENCY', 'pairsWith must be a sibling dev or bug ticket');
  }
  if (target.status === 'cancelled') throw new ApiError('TICKET_CLOSED', `${target.key} is cancelled`);
  const [existing] = await tx
    .select({ key: tickets.key })
    .from(tickets)
    .where(and(eq(tickets.pairsWith, pairsWith), eq(tickets.type, 'qc'), ne(tickets.status, 'cancelled')));
  if (existing)
    throw new ApiError('QC_ALREADY_PAIRED', `${target.key} already has QC ticket ${existing.key}`);
}

// ---------------------------------------------------------------------------
// QC bug loop
// ---------------------------------------------------------------------------

export interface FileBugResult {
  bug: Ticket;
  retest: Ticket;
}

/**
 * QC files a defect: a `bug` ticket for dev plus a paired QC retest that depends on it, under the same
 * pm_task. Past MAX_BUG_CYCLES nothing is created; the pm_task is parked for the owner instead.
 */
export async function fileBug(db: Executor, qcTicketId: string, input: FileBugInput): Promise<FileBugResult> {
  const data = FileBugRequest.parse(input);
  return commitThenThrow(db, async (tx) => {
    const { ticket: qc, parent: pmTask } = await lockWithParent(tx, qcTicketId);
    if (qc.type !== 'qc') throw new ApiError('VALIDATION_FAILED', 'only qc tickets file bugs');
    if (isTerminal(qc.status)) throw new ApiError('TICKET_CLOSED', `${qc.key} is ${qc.status}`);
    if (pmTask?.type !== 'pm_task' || !qc.pairsWith) {
      throw new ApiError('INVALID_HIERARCHY', `${qc.key} is not a paired QC ticket under a pm_task`);
    }
    if (isTerminal(pmTask.status)) throw new ApiError('PARENT_CLOSED', `${pmTask.key} is ${pmTask.status}`);
    const project = await findProject(tx, pmTask.projectId);
    if (!project) throw new ApiError('INVALID_HIERARCHY', `pm_task ${pmTask.key} has no project`);
    const [verified] = await tx.select().from(tickets).where(eq(tickets.id, qc.pairsWith));
    if (!verified) throw notFound('paired ticket');

    const cycle = verified.bugCycle + 1;
    const originDevId = verified.originDevId ?? verified.id;
    if (cycle > MAX_BUG_CYCLES) {
      const [origin] = await tx.select({ key: tickets.key }).from(tickets).where(eq(tickets.id, originDevId));
      await applyHold(
        tx,
        pmTask,
        'bug_cycles',
        `QC (${qc.key}) báo thêm lỗi cho ${origin?.key ?? verified.key}, nhưng chuỗi sửa lỗi đã đạt giới hạn ` +
          `${MAX_BUG_CYCLES} vòng nên lỗi mới chưa được tạo: "${data.title}". ` +
          'Hãy bình luận để quyết định bước tiếp theo.',
      );
      return new ApiError(
        'BUG_CYCLE_CAP',
        `bug chain of ${origin?.key ?? verified.key} reached ${MAX_BUG_CYCLES} cycles`,
        { originDevId, cycle },
        true,
      );
    }
    if (pmTask.budgetHold) {
      throw new ApiError('BUDGET_HOLD', `${pmTask.key} waits for owner approval (${pmTask.budgetHold})`);
    }
    const capError = await enforceChildCap(tx, pmTask, project, 2);
    if (capError) return capError;

    const common = {
      parentId: pmTask.id,
      projectId: project.id,
      priority: data.priority ?? verified.priority,
      allowConfigChange: pmTask.allowConfigChange,
      assigneeMachineId: project.ownerMachineId,
      originDevId,
      bugCycle: cycle,
      flows: mergeUnique(verified.flows, data.flows),
    };
    const bug = await insertTicket(tx, project.key, {
      ...common,
      type: 'bug',
      title: data.title,
      description: data.description,
      complexity: verified.complexity,
      model: verified.model,
      effort: verified.effort,
      requiredSkills: mergeUnique(verified.requiredSkills, data.requiredSkills),
      requiredMcps: verified.requiredMcps,
    });
    const retest = await insertTicket(tx, project.key, {
      ...common,
      type: 'qc',
      title: `Kiểm thử lại ${bug.key}: ${data.title}`,
      description: `Kiểm thử lại sau khi sửa lỗi ${bug.key} (vòng ${cycle}/${MAX_BUG_CYCLES}).`,
      complexity: qc.complexity,
      model: qc.model,
      effort: qc.effort,
      requiredSkills: qc.requiredSkills,
      requiredMcps: mergeUnique(qc.requiredMcps, qcDefaultMcps(project.platform, project.uiTestMcp)),
      dependsOn: [bug.id],
      pairsWith: bug.id,
    });
    return { bug: toTicketDto(bug), retest: toTicketDto(retest) };
  });
}

// ---------------------------------------------------------------------------
// Transitions and lifecycle side effects
// ---------------------------------------------------------------------------

export interface TransitionInput {
  ticketId: string;
  to: TicketStatus;
  actor: Actor;
}

/**
 * Moves a ticket along the actor-aware workflow and applies the server-side effects in the same
 * transaction: report gate, dependency wake-ups, children.all_done, owner wake-ups and cancel cascade.
 */
export async function transitionTicket(db: Executor, input: TransitionInput): Promise<Ticket> {
  const { to, actor } = input;
  return db.transaction(async (tx) => {
    const { ticket, parent } = await lockWithParent(tx, input.ticketId);
    const from = ticket.status;
    if (!canTransition(actor, from, to)) {
      throw new ApiError('ILLEGAL_TRANSITION', `${actor} cannot move ${ticket.key} from ${from} to ${to}`, {
        from,
        to,
      });
    }
    if (ticket.budgetHold && from === 'needs_input' && actor !== 'owner' && to !== 'cancelled') {
      throw new ApiError('BUDGET_HOLD', `${ticket.key} waits for owner approval (${ticket.budgetHold})`);
    }
    if (to === 'done') {
      const [report] = await tx
        .select({ id: ticketReports.id })
        .from(ticketReports)
        .where(and(eq(ticketReports.ticketId, ticket.id), eq(ticketReports.isCurrent, true)));
      if (!report) throw new ApiError('REPORT_REQUIRED', `${ticket.key} needs a report before done`);
    }

    const [updated] = await tx
      .update(tickets)
      .set({ status: to, updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id))
      .returning();
    if (!updated) throw new Error('ticket update returned no row');
    if (actor === 'owner' && from === 'needs_input') await liftHold(tx, ticket);

    const out: NewEvent[] = [statusChanged(ticket, from, to)];
    if (to === 'cancelled') out.push(...(await cascadeCancel(tx, ticket)));
    if (to === 'done') out.push(...(await resolveDependents(tx, ticket)));
    if (actor === 'owner') {
      const wake = ownerWakeUp(from, to);
      if (wake) out.push(toAssignee(ticket, { type: wake, data: { ticketId: ticket.id } }));
    }
    if (parent && isTerminal(to)) out.push(...(await childrenAllDone(tx, parent)));
    await appendEvents(tx, out);

    const [fresh] = await tx.select().from(tickets).where(eq(tickets.id, ticket.id));
    return toTicketDto(fresh ?? updated);
  });
}

/** Owner edges that send work back to an agent resume its session. */
function ownerWakeUp(from: TicketStatus, to: TicketStatus): 'ticket.reopened' | 'ticket.unblocked' | null {
  if (to !== 'in_progress') return null;
  if (from === 'done' || from === 'in_review') return 'ticket.reopened';
  if (from === 'blocked' || from === 'needs_input') return 'ticket.unblocked';
  return null;
}

function statusChanged(ticket: TicketRow, from: TicketStatus, to: TicketStatus): NewEvent {
  return {
    payload: { type: 'ticket.status_changed', data: { ticketId: ticket.id, from, to } },
    ticketId: ticket.id,
    projectId: ticket.projectId,
  };
}

function toAssignee(ticket: TicketRow, payload: NewEvent['payload']): NewEvent {
  return {
    payload,
    ticketId: ticket.id,
    projectId: ticket.projectId,
    targetMachineId: ticket.assigneeMachineId,
    targetRole: ticket.assigneeRole,
  };
}

/** `dependency.resolved` for every open sibling that waits on the ticket that just finished. */
async function resolveDependents(tx: Executor, done: TicketRow): Promise<NewEvent[]> {
  if (!done.parentId) return [];
  const dependents = await tx
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.parentId, done.parentId),
        arrayContains(tickets.dependsOn, [done.id]),
        notInArray(tickets.status, TERMINAL),
      ),
    )
    .orderBy(asc(tickets.createdAt));
  return dependents.map((dep) =>
    toAssignee(dep, { type: 'dependency.resolved', data: { ticketId: dep.id, dependencyId: done.id } }),
  );
}

/**
 * One `children.all_done` when the last open child closes. The caller holds the parent row lock, so two
 * children finishing at the same time are serialised and only the second sees zero open siblings.
 */
async function childrenAllDone(tx: Executor, parent: TicketRow): Promise<NewEvent[]> {
  if (isTerminal(parent.status)) return [];
  const [open] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.parentId, parent.id), notInArray(tickets.status, TERMINAL)));
  if ((open?.n ?? 0) > 0) return [];
  return [toAssignee(parent, { type: 'children.all_done', data: { ticketId: parent.id } })];
}

/**
 * Cancels every non-terminal descendant of `root` (already locked and being cancelled) and emits one
 * `ticket.cancelled` per affected machine. Descendants are locked level by level, top-down.
 */
async function cascadeCancel(tx: Executor, root: TicketRow): Promise<NewEvent[]> {
  const cancelled: TicketRow[] = [];
  let frontier = [root.id];
  while (frontier.length > 0) {
    const level = await tx
      .select()
      .from(tickets)
      .where(inArray(tickets.parentId, frontier))
      .orderBy(asc(tickets.id))
      .for('update');
    cancelled.push(...level.filter((row) => !isTerminal(row.status)));
    frontier = level.map((row) => row.id);
  }

  const out: NewEvent[] = [];
  if (cancelled.length > 0) {
    await tx
      .update(tickets)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        inArray(
          tickets.id,
          cancelled.map((row) => row.id),
        ),
      );
    out.push(...cancelled.map((row) => statusChanged(row, row.status, 'cancelled')));
  }

  const machinesHit = new Set(
    [root, ...cancelled].map((row) => row.assigneeMachineId).filter((id): id is string => id !== null),
  );
  for (const machineId of machinesHit) {
    out.push({
      payload: { type: 'ticket.cancelled', data: { ticketId: root.id } },
      ticketId: root.id,
      projectId: root.projectId,
      targetMachineId: machineId,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export interface AddCommentInput {
  ticketId: string;
  body: string;
  authorKind: 'owner' | 'agent' | 'system';
  /** Required for agent comments. */
  authorRole?: AgentRole | null;
}

/**
 * Stores a comment. An owner comment wakes the assignee (`ticket.comment_added`), resumes a `needs_input`
 * ticket, and counts as approval when the ticket was parked by a cap or budget.
 */
export async function addComment(db: Executor, input: AddCommentInput): Promise<CommentRow> {
  const body = input.body.trim();
  if (body === '') throw new ApiError('VALIDATION_FAILED', 'comment body is empty');
  if (input.authorKind === 'agent' && !input.authorRole) {
    throw new ApiError('VALIDATION_FAILED', 'agent comments need an authorRole');
  }
  return db.transaction(async (tx) => {
    const { ticket } = await lockWithParent(tx, input.ticketId);
    const [comment] = await tx
      .insert(comments)
      .values({
        ticketId: ticket.id,
        authorKind: input.authorKind,
        authorRole: input.authorKind === 'owner' ? null : (input.authorRole ?? null),
        body,
      })
      .returning();
    if (!comment) throw new Error('comment insert returned no row');
    if (input.authorKind !== 'owner' || isTerminal(ticket.status)) return comment;

    const out: NewEvent[] = [];
    if (ticket.status === 'needs_input') {
      await tx
        .update(tickets)
        .set({ status: 'in_progress', updatedAt: new Date() })
        .where(eq(tickets.id, ticket.id));
      await liftHold(tx, ticket);
      out.push(statusChanged(ticket, 'needs_input', 'in_progress'));
    }
    out.push(
      toAssignee(ticket, {
        type: 'ticket.comment_added',
        data: { ticketId: ticket.id, commentId: comment.id },
      }),
    );
    await appendEvents(tx, out);
    return comment;
  });
}
