import {
  type ClaimRequest,
  type ClaimRequestStatus,
  type ClaimResponse,
  type ClaimTarget,
  type DaemonCreateProjectRequest as DaemonCreateProjectInput,
  DaemonCreateProjectRequest,
  type DaemonProjectsResponse,
  type OwnerAssignRequest,
  type Project,
  type ProjectCatalogResponse,
  type ReleaseClaimResponse,
  TERMINAL_STATUSES,
  type TicketStatus,
} from '@crew/shared';
import { and, asc, desc, eq, isNull, notInArray, type SQL, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.js';
import {
  type ClaimRequestRow,
  claimRequests,
  machines,
  type ProjectRow,
  projects,
  tickets,
} from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { appendEvents, type NewEvent } from './event-service.js';
import { isUniqueViolation } from './pg-errors.js';
import { pendingChangesOf } from './project-change-service.js';
import { toProjectDto } from './project-service.js';

/** A project (`projectId`) or the assistant role (`projectId` null). */
interface ClaimScope {
  projectId: string | null;
  assistant: boolean;
}

interface LockedScope extends ClaimScope {
  label: string;
  holder: string | null;
}

const TERMINAL = [...TERMINAL_STATUSES];
/** Open tickets in these states were being worked on, so the new machine gets a fresh `ticket.assigned`. */
const REDISPATCH: readonly TicketStatus[] = ['todo', 'triage', 'in_progress'];
const ASSISTANT_LOCK = sql`select pg_advisory_xact_lock(hashtextextended('crew.assistant', 0))`;

// ---------------------------------------------------------------------------
// Locking and binding
// ---------------------------------------------------------------------------

async function lockProject(tx: Executor, where: SQL): Promise<ProjectRow> {
  const [row] = await tx.select().from(projects).where(where).for('update');
  if (!row) throw notFound('project');
  return row;
}

/** Serialises every change of the assistant host, then reads the current one. */
async function lockAssistant(tx: Executor): Promise<string | null> {
  await tx.execute(ASSISTANT_LOCK);
  const [host] = await tx.select({ id: machines.id }).from(machines).where(eq(machines.hostsAssistant, true));
  return host?.id ?? null;
}

async function lockScope(tx: Executor, scope: ClaimScope): Promise<LockedScope> {
  if (scope.assistant) return { ...scope, label: 'the assistant role', holder: await lockAssistant(tx) };
  const project = await lockProject(tx, eq(projects.id, scope.projectId ?? ''));
  return { ...scope, label: `project ${project.key}`, holder: project.ownerMachineId };
}

async function lockTarget(tx: Executor, target: ClaimTarget): Promise<LockedScope> {
  if ('hostsAssistant' in target) return lockScope(tx, { projectId: null, assistant: true });
  const project = await lockProject(tx, eq(projects.key, target.projectKey));
  return {
    projectId: project.id,
    assistant: false,
    label: `project ${project.key}`,
    holder: project.ownerMachineId,
  };
}

/**
 * Moves the open tickets of a scope to `to` (null leaves them unowned). Tickets that were being worked on
 * get a fresh `ticket.assigned` on the new machine, because it has never seen their earlier events; tickets
 * waiting on someone else get their next wake-up there anyway, since events target the current assignee.
 */
async function retargetOpenTickets(tx: Executor, scope: ClaimScope, to: string | null): Promise<NewEvent[]> {
  const inScope = scope.assistant
    ? eq(tickets.type, 'request')
    : eq(tickets.projectId, scope.projectId ?? '');
  const moved = await tx
    .update(tickets)
    .set({ assigneeMachineId: to, updatedAt: new Date() })
    .where(
      and(
        inScope,
        notInArray(tickets.status, TERMINAL),
        sql`${tickets.assigneeMachineId} is distinct from ${to}`,
      ),
    )
    .returning();
  if (!to) return [];
  return moved
    .filter((ticket) => REDISPATCH.includes(ticket.status))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((ticket) => ({
      payload: {
        type: 'ticket.assigned' as const,
        data: { ticketId: ticket.id, role: ticket.assigneeRole, reassigned: true },
      },
      ticketId: ticket.id,
      projectId: ticket.projectId,
      targetMachineId: to,
      targetRole: ticket.assigneeRole,
    }));
}

/** Gives a locked scope to `to` (or to nobody) and re-targets its open tickets. */
async function bindScope(tx: Executor, scope: LockedScope, to: string | null): Promise<NewEvent[]> {
  if (scope.assistant) {
    if (scope.holder) {
      await tx.update(machines).set({ hostsAssistant: false }).where(eq(machines.id, scope.holder));
    }
    if (to) await tx.update(machines).set({ hostsAssistant: true }).where(eq(machines.id, to));
  } else {
    await tx
      .update(projects)
      .set({ ownerMachineId: to, updatedAt: new Date() })
      .where(eq(projects.id, scope.projectId ?? ''));
  }
  return retargetOpenTickets(tx, scope, to);
}

const scopeWhere = (scope: ClaimScope) =>
  scope.assistant ? eq(claimRequests.assistant, true) : eq(claimRequests.projectId, scope.projectId ?? '');

const scopeData = (scope: ClaimScope) => ({ projectId: scope.projectId, assistant: scope.assistant });

async function assertLiveMachine(tx: Executor, machineId: string): Promise<void> {
  const [row] = await tx
    .select({ revokedAt: machines.revokedAt })
    .from(machines)
    .where(eq(machines.id, machineId));
  if (!row) throw notFound('machine');
  if (row.revokedAt) throw new ApiError('CONFLICT', 'the machine is revoked');
}

// ---------------------------------------------------------------------------
// Claims from the local app
// ---------------------------------------------------------------------------

/**
 * Claims a project or the assistant role for a machine. Unheld: bound at once (audit row plus
 * `machine.claimed`). Held by another machine: a pending claim request plus `claim.requested`, answered with
 * `pending` (202 on the route) until the owner decides.
 */
export async function claim(db: Executor, machineId: string, target: ClaimTarget): Promise<ClaimResponse> {
  return db.transaction(async (tx) => {
    const scope = await lockTarget(tx, target);
    if (scope.holder === machineId) return { status: 'already_owned' as const, claimRequestId: null };

    if (scope.holder === null) {
      const [audit] = await tx
        .insert(claimRequests)
        .values({ machineId, ...scopeData(scope), status: 'granted', decidedAt: new Date() })
        .returning({ id: claimRequests.id });
      if (!audit) throw new Error('claim request insert returned no row');
      const out = await bindScope(tx, scope, machineId);
      out.push({
        payload: { type: 'machine.claimed', data: { machineId, ...scopeData(scope) } },
        projectId: scope.projectId,
      });
      await appendEvents(tx, out);
      return { status: 'granted' as const, claimRequestId: audit.id };
    }

    const [existing] = await tx
      .select({ id: claimRequests.id })
      .from(claimRequests)
      .where(
        and(eq(claimRequests.machineId, machineId), scopeWhere(scope), eq(claimRequests.status, 'pending')),
      );
    let claimRequestId = existing?.id;
    if (!claimRequestId) {
      const [created] = await tx
        .insert(claimRequests)
        .values({ machineId, ...scopeData(scope), previousMachineId: scope.holder, status: 'pending' })
        .returning({ id: claimRequests.id });
      if (!created) throw new Error('claim request insert returned no row');
      claimRequestId = created.id;
      await appendEvents(tx, [
        {
          payload: {
            type: 'claim.requested',
            data: { claimRequestId, machineId, ...scopeData(scope) },
          },
          projectId: scope.projectId,
        },
      ]);
    }
    return { status: 'pending' as const, claimRequestId };
  });
}

/**
 * Releases a claim now. The scope's open tickets stay put but become unowned until another machine claims
 * it. A machine that only has a pending request withdraws it instead.
 */
export async function release(
  db: Executor,
  machineId: string,
  target: ClaimTarget,
): Promise<ReleaseClaimResponse> {
  return db.transaction(async (tx) => {
    const scope = await lockTarget(tx, target);
    if (scope.holder === machineId) {
      const out = await bindScope(tx, scope, null);
      out.push({
        payload: { type: 'machine.released', data: { machineId, ...scopeData(scope) } },
        projectId: scope.projectId,
      });
      await appendEvents(tx, out);
      return { status: 'released' as const };
    }
    const withdrawn = await withdrawPending(tx, machineId, scope);
    if (withdrawn > 0) return { status: 'withdrawn' as const };
    throw new ApiError('CONFLICT', `this machine does not hold ${scope.label}`);
  });
}

async function withdrawPending(tx: Executor, machineId: string, scope?: ClaimScope): Promise<number> {
  const rows = await tx
    .update(claimRequests)
    .set({ status: 'withdrawn', decidedAt: new Date() })
    .where(
      and(
        eq(claimRequests.machineId, machineId),
        eq(claimRequests.status, 'pending'),
        ...(scope ? [scopeWhere(scope)] : []),
      ),
    )
    .returning({ id: claimRequests.id });
  return rows.length;
}

/**
 * For machine revocation (inside the caller's transaction): releases every project and the assistant role
 * the machine holds, and withdraws its pending requests. Returns the events to append.
 */
export async function releaseEverything(tx: Transaction, machineId: string): Promise<NewEvent[]> {
  const out: NewEvent[] = [];
  const owned = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.ownerMachineId, machineId))
    .orderBy(asc(projects.key));
  const scopes: ClaimScope[] = [
    { projectId: null, assistant: true },
    ...owned.map((p) => ({ projectId: p.id, assistant: false })),
  ];
  for (const candidate of scopes) {
    const scope = await lockScope(tx, candidate);
    if (scope.holder !== machineId) continue;
    out.push(...(await bindScope(tx, scope, null)));
    out.push({
      payload: { type: 'machine.released', data: { machineId, ...scopeData(scope) } },
      projectId: scope.projectId,
    });
  }
  await withdrawPending(tx, machineId);
  return out;
}

// ---------------------------------------------------------------------------
// Owner decisions and reassignment
// ---------------------------------------------------------------------------

function claimChanged(
  row: ClaimRequestRow,
  status: 'approved' | 'rejected',
  holder: string | null,
  previous: string | null,
  target: string,
): NewEvent {
  return {
    payload: {
      type: 'claim.changed',
      data: {
        claimRequestId: row.id,
        status,
        machineId: holder,
        previousMachineId: previous,
        ...scopeData(row),
      },
    },
    projectId: row.projectId,
    targetMachineId: target,
  };
}

/**
 * Approves or rejects a pending takeover (the route has re-confirmed the owner's TOTP). On approval the
 * previous holder loses the claim, open tickets move to the requester, and both machines get
 * `claim.changed`. A rejection notifies the requester only.
 */
export async function decideClaimRequest(
  db: Executor,
  requestId: string,
  decision: 'approve' | 'reject',
): Promise<ClaimRequest> {
  await db.transaction(async (tx) => {
    const [peek] = await tx.select().from(claimRequests).where(eq(claimRequests.id, requestId));
    if (!peek) throw notFound('claim request');
    // Lock order everywhere: the claimed scope first, then claim request rows.
    const scope = await lockScope(tx, peek);
    const [request] = await tx
      .select()
      .from(claimRequests)
      .where(eq(claimRequests.id, requestId))
      .for('update');
    if (!request) throw notFound('claim request');
    if (request.status !== 'pending') {
      throw new ApiError('CONFLICT', `the claim request is already ${request.status}`);
    }

    if (decision === 'reject') {
      await tx
        .update(claimRequests)
        .set({ status: 'rejected', decidedAt: new Date(), previousMachineId: scope.holder })
        .where(eq(claimRequests.id, request.id));
      await appendEvents(tx, [
        claimChanged(request, 'rejected', scope.holder, scope.holder, request.machineId),
      ]);
      return;
    }

    await assertLiveMachine(tx, request.machineId);
    const out = scope.holder === request.machineId ? [] : await bindScope(tx, scope, request.machineId);
    await tx
      .update(claimRequests)
      .set({ status: 'approved', decidedAt: new Date(), previousMachineId: scope.holder })
      .where(eq(claimRequests.id, request.id));
    out.push(claimChanged(request, 'approved', request.machineId, scope.holder, request.machineId));
    if (scope.holder && scope.holder !== request.machineId) {
      out.push(claimChanged(request, 'approved', request.machineId, scope.holder, scope.holder));
    }
    await appendEvents(tx, out);
  });
  return getClaimRequest(db, requestId);
}

/**
 * Owner reassigns a project or the assistant role to a machine. Recorded as an approved claim request, with
 * the same effects as approving a takeover.
 */
export async function ownerAssign(
  db: Executor,
  machineId: string,
  target: OwnerAssignRequest,
): Promise<ClaimResponse> {
  return db.transaction(async (tx) => {
    await assertLiveMachine(tx, machineId);
    const scope =
      'hostsAssistant' in target
        ? await lockScope(tx, { projectId: null, assistant: true })
        : await lockScope(tx, { projectId: target.projectId, assistant: false });
    if (scope.holder === machineId) return { status: 'already_owned' as const, claimRequestId: null };

    const decided = { status: 'approved' as const, decidedAt: new Date(), previousMachineId: scope.holder };
    const [pending] = await tx
      .update(claimRequests)
      .set(decided)
      .where(
        and(eq(claimRequests.machineId, machineId), scopeWhere(scope), eq(claimRequests.status, 'pending')),
      )
      .returning();
    const [row] = pending
      ? [pending]
      : await tx
          .insert(claimRequests)
          .values({ machineId, ...scopeData(scope), ...decided })
          .returning();
    if (!row) throw new Error('claim request insert returned no row');

    const out = await bindScope(tx, scope, machineId);
    out.push(claimChanged(row, 'approved', machineId, scope.holder, machineId));
    if (scope.holder) out.push(claimChanged(row, 'approved', machineId, scope.holder, scope.holder));
    await appendEvents(tx, out);
    return { status: 'granted' as const, claimRequestId: row.id };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const requestColumns = {
  request: claimRequests,
  machineName: machines.name,
  projectKey: projects.key,
};

function toClaimRequestDto(row: {
  request: ClaimRequestRow;
  machineName: string;
  projectKey: string | null;
}): ClaimRequest {
  const r = row.request;
  return {
    id: r.id,
    machineId: r.machineId,
    machineName: row.machineName,
    projectId: r.projectId,
    projectKey: row.projectKey,
    assistant: r.assistant,
    previousMachineId: r.previousMachineId,
    status: r.status,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function getClaimRequest(db: Executor, id: string): Promise<ClaimRequest> {
  const [row] = await db
    .select(requestColumns)
    .from(claimRequests)
    .innerJoin(machines, eq(machines.id, claimRequests.machineId))
    .leftJoin(projects, eq(projects.id, claimRequests.projectId))
    .where(eq(claimRequests.id, id));
  if (!row) throw notFound('claim request');
  return toClaimRequestDto(row);
}

export async function listClaimRequests(db: Executor, status?: ClaimRequestStatus): Promise<ClaimRequest[]> {
  const rows = await db
    .select(requestColumns)
    .from(claimRequests)
    .innerJoin(machines, eq(machines.id, claimRequests.machineId))
    .leftJoin(projects, eq(projects.id, claimRequests.projectId))
    .where(status ? eq(claimRequests.status, status) : undefined)
    .orderBy(desc(claimRequests.createdAt))
    .limit(200);
  return rows.map(toClaimRequestDto);
}

/** Every project with its owner state from the calling machine's point of view, plus the assistant role. */
export async function listDaemonProjects(db: Executor, machineId: string): Promise<DaemonProjectsResponse> {
  const [rows, pending, [host], changes] = await Promise.all([
    db
      .select({ project: projects, ownerName: machines.name })
      .from(projects)
      .leftJoin(machines, eq(machines.id, projects.ownerMachineId))
      .orderBy(asc(projects.key)),
    db
      .select({ projectId: claimRequests.projectId, assistant: claimRequests.assistant })
      .from(claimRequests)
      .where(and(eq(claimRequests.machineId, machineId), eq(claimRequests.status, 'pending'))),
    db
      .select({ id: machines.id, name: machines.name })
      .from(machines)
      .where(and(eq(machines.hostsAssistant, true), isNull(machines.revokedAt))),
    pendingChangesOf(db, machineId),
  ]);
  const pendingProjects = new Set(pending.map((p) => p.projectId));
  const stateOf = (owner: string | null) =>
    owner === null ? 'unowned' : owner === machineId ? 'mine' : 'other';
  return {
    items: rows.map(({ project, ownerName }) => {
      const ownerState = stateOf(project.ownerMachineId);
      return {
        id: project.id,
        key: project.key,
        name: project.name,
        description: project.description,
        repoUrl: project.repoUrl,
        defaultBranch: project.defaultBranch,
        platform: project.platform,
        uiTestMcp: project.uiTestMcp,
        docsStatus: project.docsStatus,
        ownerState,
        ownerMachineName: ownerState === 'other' ? ownerName : null,
        pendingClaim: pendingProjects.has(project.id),
        pendingChange: changes.get(project.id) ?? null,
      };
    }),
    assistant: {
      state: stateOf(host?.id ?? null),
      hostName: host && host.id !== machineId ? host.name : null,
      pendingClaim: pending.some((p) => p.assistant),
    },
  };
}

/**
 * A machine creates a project from a local folder and owns it at once. The description is the owner's
 * text typed in the app. Emits `project.created` to the owner inbox.
 */
export async function createDaemonProject(
  db: Executor,
  machineId: string,
  input: DaemonCreateProjectInput,
): Promise<Project> {
  const data = DaemonCreateProjectRequest.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(projects)
        .values({ ...data, ownerMachineId: machineId })
        .returning();
      if (!row) throw new Error('project insert returned no row');
      await tx
        .insert(claimRequests)
        .values({ machineId, projectId: row.id, status: 'granted', decidedAt: new Date() });
      await appendEvents(tx, [
        { payload: { type: 'project.created', data: { projectId: row.id, machineId } }, projectId: row.id },
      ]);
      return toProjectDto(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError('CONFLICT', `project key ${data.key} already exists`);
    throw error;
  }
}

/** Triage catalog for the assistant: owner-entered name and description only, never repo content. */
export async function projectCatalog(db: Executor): Promise<ProjectCatalogResponse> {
  const items = await db
    .select({ id: projects.id, key: projects.key, name: projects.name, description: projects.description })
    .from(projects)
    .orderBy(asc(projects.key));
  return { items };
}
