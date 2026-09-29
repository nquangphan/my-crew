import {
  type CreateProjectRequest as CreateProjectInput,
  CreateProjectRequest,
  type Project,
  type UpdateProjectRequest as UpdateProjectInput,
  UpdateProjectRequest,
} from '@crew/shared';
import { asc, eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { type ProjectRow, projects } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { isUniqueViolation } from './pg-errors.js';

export function toProjectDto(row: ProjectRow): Project {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    repoUrl: row.repoUrl,
    defaultBranch: row.defaultBranch,
    ownerMachineId: row.ownerMachineId,
    docsStatus: row.docsStatus,
    platform: row.platform,
    uiTestMcp: row.uiTestMcp,
    maxChildrenPerTicket: row.maxChildrenPerTicket,
    ticketTreeBudgetUsd: row.ticketTreeBudgetUsd,
    dailyBudgetUsd: row.dailyBudgetUsd,
    bmadProfile: row.bmadProfile ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createProject(db: Executor, input: CreateProjectInput): Promise<Project> {
  const data = CreateProjectRequest.parse(input);
  try {
    const [row] = await db.insert(projects).values(data).returning();
    if (!row) throw new Error('project insert returned no row');
    return toProjectDto(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError('CONFLICT', `project key ${data.key} already exists`);
    throw error;
  }
}

export async function updateProject(db: Executor, id: string, input: UpdateProjectInput): Promise<Project> {
  const patch = UpdateProjectRequest.parse(input);
  const [row] = await db
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  if (!row) throw notFound('project');
  return toProjectDto(row);
}

export async function listProjects(db: Executor): Promise<Project[]> {
  const rows = await db.select().from(projects).orderBy(asc(projects.key));
  return rows.map(toProjectDto);
}

export async function getProjectRow(db: Executor, id: string): Promise<ProjectRow> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  if (!row) throw notFound('project');
  return row;
}

export async function getProject(db: Executor, id: string): Promise<Project> {
  return toProjectDto(await getProjectRow(db, id));
}
