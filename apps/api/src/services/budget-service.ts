import { type BudgetStatusResponse, canTransition } from '@crew/shared';
import { and, eq, ne, or, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { budgetsUsage, comments, type ProjectRow, projects, type TicketRow, tickets } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { appendEvents } from './event-service.js';

export const DEFAULT_BUDGET_TIMEZONE = 'Asia/Ho_Chi_Minh';

export type HoldKind = 'children' | 'cost' | 'bug_cycles';

/**
 * Parks a pm_task for the owner: moves it to needs_input when the workflow allows it, posts an owner-visible
 * system comment and emits `budget.exceeded` to the owner stream. `pmTask` must be locked by the caller.
 * A repeated hold of the same cap/budget kind is a no-op, so retries do not spam the thread.
 */
export async function applyHold(
  tx: Executor,
  pmTask: TicketRow,
  kind: HoldKind,
  message: string,
): Promise<void> {
  const budgetHold = kind === 'bug_cycles' ? null : kind;
  if (budgetHold && pmTask.budgetHold === budgetHold) return;

  const moveToNeedsInput = canTransition('system', pmTask.status, 'needs_input');
  await tx
    .update(tickets)
    .set({
      ...(budgetHold ? { budgetHold } : {}),
      ...(moveToNeedsInput ? { status: 'needs_input' as const } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, pmTask.id));
  await tx.insert(comments).values({ ticketId: pmTask.id, authorKind: 'system', body: message });
  await appendEvents(tx, [
    ...(moveToNeedsInput
      ? [
          {
            payload: {
              type: 'ticket.status_changed' as const,
              data: { ticketId: pmTask.id, from: pmTask.status, to: 'needs_input' as const },
            },
            ticketId: pmTask.id,
            projectId: pmTask.projectId,
          },
        ]
      : []),
    {
      payload: { type: 'budget.exceeded', data: { ticketId: pmTask.id, kind } },
      ticketId: pmTask.id,
      projectId: pmTask.projectId,
    },
  ]);
}

/** Owner approval (a comment or a manual resume): lifts the cap or budget that parked the ticket. */
export async function liftHold(tx: Executor, ticket: TicketRow): Promise<void> {
  if (!ticket.budgetHold) return;
  await tx
    .update(tickets)
    .set({
      budgetHold: null,
      ...(ticket.budgetHold === 'children' ? { childCapLifted: true } : { costBudgetLifted: true }),
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticket.id));
}

/**
 * Checks the per-ticket child cap before `slots` new children are created under `parent` (locked).
 * Over the cap, parks the parent and returns the error to raise after the transaction commits.
 */
export async function enforceChildCap(
  tx: Executor,
  parent: TicketRow,
  project: ProjectRow,
  slots: number,
): Promise<ApiError | null> {
  if (parent.childCapLifted) return null;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.parentId, parent.id), ne(tickets.status, 'cancelled')));
  const current = row?.n ?? 0;
  if (current + slots <= project.maxChildrenPerTicket) return null;

  await applyHold(
    tx,
    parent,
    'children',
    `Đã đạt giới hạn ${project.maxChildrenPerTicket} ticket con cho ${parent.key}. ` +
      'Ticket được chuyển sang needs_input. Hãy bình luận để phê duyệt vượt giới hạn, ' +
      'hoặc tăng giới hạn trong cài đặt dự án.',
  );
  return new ApiError(
    'CHILD_CAP_EXCEEDED',
    `ticket ${parent.key} would exceed ${project.maxChildrenPerTicket} children`,
    { parentId: parent.id, limit: project.maxChildrenPerTicket, current },
    true,
  );
}

/**
 * Adds reported cost to the ticket and the project's daily usage, then enforces the optional tree and daily
 * budgets on the pm_task (locked by the caller). Budgets are null (no limit) unless the owner set them.
 */
export async function addCost(
  tx: Executor,
  args: {
    ticket: TicketRow;
    pmTask: TicketRow | null;
    project: ProjectRow | null;
    deltaUsd: number;
    timezone: string;
  },
): Promise<void> {
  const { ticket, pmTask, project, deltaUsd, timezone } = args;
  if (deltaUsd <= 0) return;
  await tx
    .update(tickets)
    .set({ costUsd: sql`${tickets.costUsd} + ${deltaUsd}` })
    .where(eq(tickets.id, ticket.id));
  if (!project) return;

  const [usage] = await tx
    .insert(budgetsUsage)
    .values({ projectId: project.id, day: sql`(now() at time zone ${timezone})::date`, costUsd: deltaUsd })
    .onConflictDoUpdate({
      target: [budgetsUsage.projectId, budgetsUsage.day],
      set: { costUsd: sql`${budgetsUsage.costUsd} + ${deltaUsd}` },
    })
    .returning({ costUsd: budgetsUsage.costUsd });

  if (!pmTask || pmTask.costBudgetLifted) return;

  if (project.ticketTreeBudgetUsd !== null) {
    const [tree] = await tx
      .select({ total: sql<string>`coalesce(sum(${tickets.costUsd}), 0)` })
      .from(tickets)
      .where(or(eq(tickets.id, pmTask.id), eq(tickets.parentId, pmTask.id)));
    const total = Number(tree?.total ?? 0);
    if (total > project.ticketTreeBudgetUsd) {
      await applyHold(
        tx,
        pmTask,
        'cost',
        `Chi phí của ${pmTask.key} (${formatUsd(total)}) đã vượt ngân sách cây ticket ` +
          `(${formatUsd(project.ticketTreeBudgetUsd)}). Ticket được chuyển sang needs_input. ` +
          'Hãy bình luận để phê duyệt tiếp tục, hoặc tăng ngân sách trong cài đặt dự án.',
      );
      return;
    }
  }

  const today = usage?.costUsd ?? 0;
  if (project.dailyBudgetUsd !== null && today > project.dailyBudgetUsd) {
    await applyHold(
      tx,
      pmTask,
      'cost',
      `Chi phí hôm nay của dự án ${project.key} (${formatUsd(today)}) đã vượt ngân sách ngày ` +
        `(${formatUsd(project.dailyBudgetUsd)}). ${pmTask.key} được chuyển sang needs_input. ` +
        'Hãy bình luận để phê duyệt tiếp tục, hoặc tăng ngân sách trong cài đặt dự án.',
    );
  }
}

const formatUsd = (value: number) => `${value.toFixed(2)} USD`;

/**
 * What a job may still spend on a ticket: the pm_task tree budget and the project's daily budget for today
 * in `timezone`. Limits are null (no limit) unless the owner set them.
 */
export async function getBudgetStatus(
  db: Executor,
  ticket: TicketRow,
  timezone: string,
): Promise<BudgetStatusResponse> {
  const [parent] = ticket.parentId
    ? await db.select().from(tickets).where(eq(tickets.id, ticket.parentId))
    : [];
  const pmTask = ticket.type === 'pm_task' ? ticket : parent?.type === 'pm_task' ? parent : null;
  const [project] = ticket.projectId
    ? await db.select().from(projects).where(eq(projects.id, ticket.projectId))
    : [];

  const [tree] = pmTask
    ? await db
        .select({ total: sql<string>`coalesce(sum(${tickets.costUsd}), 0)` })
        .from(tickets)
        .where(or(eq(tickets.id, pmTask.id), eq(tickets.parentId, pmTask.id)))
    : [];
  const [today] = await db.execute<{ day: string; cost: string | null }>(sql`
    select to_char((now() at time zone ${timezone})::date, 'YYYY-MM-DD') as day,
      (select ${budgetsUsage.costUsd}::text from ${budgetsUsage}
        where ${budgetsUsage.projectId} = ${project?.id ?? null}::uuid
          and ${budgetsUsage.day} = (now() at time zone ${timezone})::date) as cost`);

  const line = (spentUsd: number, limitUsd: number | null) => ({
    spentUsd,
    limitUsd,
    remainingUsd: limitUsd === null ? null : Math.max(0, limitUsd - spentUsd),
  });
  const treeLine = line(Number(tree?.total ?? 0), project?.ticketTreeBudgetUsd ?? null);
  const dailyLine = line(Number(today?.cost ?? 0), project?.dailyBudgetUsd ?? null);
  const hold = pmTask?.budgetHold ?? null;
  const lifted = pmTask?.costBudgetLifted ?? false;
  const usedUp = (l: { remainingUsd: number | null }) => l.remainingUsd !== null && l.remainingUsd <= 0;
  return {
    ticketId: ticket.id,
    pmTaskId: pmTask?.id ?? null,
    projectId: ticket.projectId,
    ticketCostUsd: ticket.costUsd,
    tree: treeLine,
    daily: { ...dailyLine, day: today?.day ?? '' },
    hold,
    costBudgetLifted: lifted,
    overBudget: hold === 'cost' || (pmTask !== null && !lifted && (usedUp(treeLine) || usedUp(dailyLine))),
  };
}
