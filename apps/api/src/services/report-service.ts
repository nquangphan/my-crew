import {
  type Report,
  type ReportResponse,
  type SubmitReportRequest as SubmitReportInput,
  SubmitReportRequest,
} from '@crew/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { projects, type ReportRow, ticketReports } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { addCost, DEFAULT_BUDGET_TIMEZONE } from './budget-service.js';
import { getTicketRow, governingPmTask, lockWithParent } from './ticket-service.js';

export function toReportDto(row: ReportRow): Report {
  return {
    id: row.id,
    ticketId: row.ticketId,
    version: row.version,
    isCurrent: row.isCurrent,
    summaryMd: row.summaryMd,
    filesChanged: row.filesChanged,
    commits: row.commits,
    headSha: row.headSha,
    skillsSelected: row.skillsSelected,
    mcpsSelected: row.mcpsSelected,
    skillsUsed: row.skillsUsed,
    skillsMissing: row.skillsMissing,
    mcpsUsed: row.mcpsUsed,
    mcpsMissing: row.mcpsMissing,
    docsFirst: row.docsFirst,
    testsRun: row.testsRun,
    bugsFiled: row.bugsFiled,
    leftResources: row.leftResources,
    costUsd: row.costUsd,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Stores a new current report (older versions stay as history) and books its cost against the ticket,
 * the project's daily usage and the optional budgets. Called by the daemon write route.
 */
export async function submitReport(
  db: Executor,
  ticketId: string,
  input: SubmitReportInput,
  options: { timezone?: string } = {},
): Promise<Report> {
  const data = SubmitReportRequest.parse(input);
  return db.transaction(async (tx) => {
    const { ticket, parent } = await lockWithParent(tx, ticketId);
    if (ticket.status === 'cancelled') throw new ApiError('TICKET_CLOSED', `${ticket.key} is cancelled`);

    const [last] = await tx
      .select({ version: sql<number>`coalesce(max(${ticketReports.version}), 0)::int` })
      .from(ticketReports)
      .where(eq(ticketReports.ticketId, ticket.id));
    await tx
      .update(ticketReports)
      .set({ isCurrent: false })
      .where(and(eq(ticketReports.ticketId, ticket.id), eq(ticketReports.isCurrent, true)));
    const [row] = await tx
      .insert(ticketReports)
      .values({
        ...data,
        ticketId: ticket.id,
        version: (last?.version ?? 0) + 1,
        isCurrent: true,
      })
      .returning();
    if (!row) throw new Error('report insert returned no row');

    const [project] = ticket.projectId
      ? await tx.select().from(projects).where(eq(projects.id, ticket.projectId))
      : [];
    await addCost(tx, {
      ticket,
      pmTask: governingPmTask(ticket, parent),
      project: project ?? null,
      deltaUsd: data.costUsd,
      timezone: options.timezone ?? DEFAULT_BUDGET_TIMEZONE,
    });
    return toReportDto(row);
  });
}

export async function getReports(db: Executor, idOrKey: string): Promise<ReportResponse> {
  const ticket = await getTicketRow(db, idOrKey);
  const rows = await db
    .select()
    .from(ticketReports)
    .where(eq(ticketReports.ticketId, ticket.id))
    .orderBy(desc(ticketReports.version));
  const history = rows.map(toReportDto);
  return { current: history.find((r) => r.isCurrent) ?? null, history };
}

export async function getCurrentReport(db: Executor, ticketId: string): Promise<Report | null> {
  const [row] = await db
    .select()
    .from(ticketReports)
    .where(and(eq(ticketReports.ticketId, ticketId), eq(ticketReports.isCurrent, true)));
  return row ? toReportDto(row) : null;
}
