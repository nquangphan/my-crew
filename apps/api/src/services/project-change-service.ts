import type {
  ProjectChangeRequest,
  ProjectChangeResponse,
  ProjectChangeStatus,
  ProjectTestSetup,
} from '@crew/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { machines, type ProjectChangeRequestRow, projectChangeRequests, projects } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { appendEvents } from './event-service.js';

const sameSetup = (a: ProjectTestSetup, b: ProjectTestSetup) =>
  a.platform === b.platform &&
  a.uiTestMcp.maestro === b.uiTestMcp.maestro &&
  a.uiTestMcp.playwright === b.uiTestMcp.playwright;

/**
 * The owning machine asks to change its project's type and UI-test MCP mapping. Nothing changes yet: a
 * pending request plus `project.change_requested` for the owner inbox, answered `pending` (202 on the
 * route). Only the machine that owns the project may ask. One pending request per project: asking again
 * with the same values returns it, other values are refused until the owner decides.
 */
export async function requestProjectChange(
  db: Executor,
  machineId: string,
  projectKey: string,
  body: ProjectTestSetup,
): Promise<ProjectChangeResponse> {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.key, projectKey)).for('update');
    if (!project) throw notFound('project');
    if (project.ownerMachineId !== machineId) {
      throw new ApiError('FORBIDDEN', `only the machine that owns project ${projectKey} may change it`);
    }
    const [pending] = await tx
      .select()
      .from(projectChangeRequests)
      .where(
        and(eq(projectChangeRequests.projectId, project.id), eq(projectChangeRequests.status, 'pending')),
      );
    if (pending) {
      if (sameSetup(requestedOf(pending), body)) return { status: 'pending' as const, requestId: pending.id };
      throw new ApiError('CONFLICT', `a change of project ${projectKey} already waits for the owner`, {
        requestId: pending.id,
      });
    }
    if (sameSetup(project, body)) return { status: 'unchanged' as const, requestId: null };

    const [created] = await tx
      .insert(projectChangeRequests)
      .values({
        projectId: project.id,
        machineId,
        currentPlatform: project.platform,
        currentUiTestMcp: project.uiTestMcp,
        platform: body.platform,
        uiTestMcp: body.uiTestMcp,
      })
      .returning({ id: projectChangeRequests.id });
    if (!created) throw new Error('project change request insert returned no row');
    await appendEvents(tx, [
      {
        payload: {
          type: 'project.change_requested',
          data: { requestId: created.id, projectId: project.id, machineId },
        },
        projectId: project.id,
      },
    ]);
    return { status: 'pending' as const, requestId: created.id };
  });
}

/**
 * Approves or rejects a pending change (the route has re-confirmed the owner's TOTP). Only an approval
 * changes the project, so QC tickets created afterwards carry the new UI-test MCP servers. The requesting
 * machine gets `project.change_decided` either way.
 */
export async function decideProjectChange(
  db: Executor,
  requestId: string,
  decision: 'approve' | 'reject',
): Promise<ProjectChangeRequest> {
  await db.transaction(async (tx) => {
    const [peek] = await tx
      .select({ projectId: projectChangeRequests.projectId })
      .from(projectChangeRequests)
      .where(eq(projectChangeRequests.id, requestId));
    if (!peek) throw notFound('project change request');
    // Lock order: the project first, then its request rows (as for claims).
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, peek.projectId)).for('update');
    const [request] = await tx
      .select()
      .from(projectChangeRequests)
      .where(eq(projectChangeRequests.id, requestId))
      .for('update');
    if (!request) throw notFound('project change request');
    if (request.status !== 'pending') {
      throw new ApiError('CONFLICT', `the project change request is already ${request.status}`);
    }
    const status = decision === 'approve' ? ('approved' as const) : ('rejected' as const);
    if (status === 'approved') {
      await tx
        .update(projects)
        .set({ platform: request.platform, uiTestMcp: request.uiTestMcp, updatedAt: new Date() })
        .where(eq(projects.id, request.projectId));
    }
    await tx
      .update(projectChangeRequests)
      .set({ status, decidedAt: new Date() })
      .where(eq(projectChangeRequests.id, request.id));
    await appendEvents(tx, [
      {
        payload: {
          type: 'project.change_decided',
          data: { requestId: request.id, projectId: request.projectId, machineId: request.machineId, status },
        },
        projectId: request.projectId,
        targetMachineId: request.machineId,
      },
    ]);
  });
  return getProjectChange(db, requestId);
}

const requestedOf = (row: ProjectChangeRequestRow): ProjectTestSetup => ({
  platform: row.platform,
  uiTestMcp: row.uiTestMcp,
});

const columns = { request: projectChangeRequests, machineName: machines.name, projectKey: projects.key };

function toDto(row: { request: ProjectChangeRequestRow; machineName: string; projectKey: string }) {
  const r = row.request;
  return {
    id: r.id,
    projectId: r.projectId,
    projectKey: row.projectKey,
    machineId: r.machineId,
    machineName: row.machineName,
    current: { platform: r.currentPlatform, uiTestMcp: r.currentUiTestMcp },
    requested: requestedOf(r),
    status: r.status,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  } satisfies ProjectChangeRequest;
}

function selectRequests(db: Executor) {
  return db
    .select(columns)
    .from(projectChangeRequests)
    .innerJoin(machines, eq(machines.id, projectChangeRequests.machineId))
    .innerJoin(projects, eq(projects.id, projectChangeRequests.projectId));
}

export async function getProjectChange(db: Executor, id: string): Promise<ProjectChangeRequest> {
  const [row] = await selectRequests(db).where(eq(projectChangeRequests.id, id));
  if (!row) throw notFound('project change request');
  return toDto(row);
}

export async function listProjectChanges(
  db: Executor,
  status?: ProjectChangeStatus,
): Promise<ProjectChangeRequest[]> {
  const rows = await selectRequests(db)
    .where(status ? eq(projectChangeRequests.status, status) : undefined)
    .orderBy(desc(projectChangeRequests.createdAt))
    .limit(200);
  return rows.map(toDto);
}

/** The calling machine's pending change per project id, for the daemon project view. */
export async function pendingChangesOf(
  db: Executor,
  machineId: string,
): Promise<Map<string, ProjectTestSetup & { requestId: string }>> {
  const rows = await db
    .select()
    .from(projectChangeRequests)
    .where(and(eq(projectChangeRequests.machineId, machineId), eq(projectChangeRequests.status, 'pending')));
  return new Map(rows.map((row) => [row.projectId, { requestId: row.id, ...requestedOf(row) }]));
}
