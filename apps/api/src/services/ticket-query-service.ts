import {
  type ListTicketsQuery as ListTicketsInput,
  ListTicketsQuery,
  type SearchResponse,
  type Ticket,
  type TicketDetailResponse,
  type TicketListResponse,
} from '@crew/shared';
import { and, arrayContains, asc, desc, eq, exists, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '../db/client.js';
import { comments, tickets } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { searchAllDocs } from './docs-service.js';
import { listTicketEvents } from './event-service.js';
import { likePattern } from './like-pattern.js';
import { getCurrentReport } from './report-service.js';
import { getTicketRow, toCommentDto, toTicketDto } from './ticket-service.js';

const PRIORITY_RANK = sql`(case ${tickets.priority} when 'low' then 0 when 'medium' then 1 when 'high' then 2 else 3 end)`;

const isTimestamp = (value: string) => !Number.isNaN(Date.parse(value));

/** Sort expression, the SQL type its cursor value is cast back to, and a guard for that value. */
const SORTS = {
  createdAt: { expr: sql`${tickets.createdAt}`, cast: sql`timestamptz`, valid: isTimestamp },
  updatedAt: { expr: sql`${tickets.updatedAt}`, cast: sql`timestamptz`, valid: isTimestamp },
  title: { expr: sql`${tickets.title}`, cast: sql`text`, valid: () => true },
  priority: { expr: PRIORITY_RANK, cast: sql`int`, valid: (value: string) => /^[0-3]$/.test(value) },
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(sortValue: string, id: string): string {
  return Buffer.from(JSON.stringify([sortValue, id])).toString('base64url');
}

function decodeCursor(cursor: string, valid: (value: string) => boolean): [string, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2) {
      const [sortValue, id] = value as unknown[];
      if (typeof sortValue === 'string' && typeof id === 'string' && valid(sortValue) && UUID_RE.test(id)) {
        return [sortValue, id];
      }
    }
  } catch {
    // fall through to the validation error
  }
  throw new ApiError('VALIDATION_FAILED', 'invalid cursor');
}

/**
 * Tickets of any of these projects, plus the requests routed to one of them (a child in the project) or
 * hinted at one: a request belongs to no project, but the owner filters by the projects it went to.
 */
function inProjectsFilter(db: Executor, ids: string[]): SQL | undefined {
  const child = alias(tickets, 'child');
  const routed = db
    .select({ one: sql`1` })
    .from(child)
    .where(and(eq(child.parentId, tickets.id), inArray(child.projectId, ids)));
  return or(
    inArray(tickets.projectId, ids),
    and(eq(tickets.type, 'request'), or(inArray(tickets.projectHintId, ids), exists(routed))),
  );
}

/** Filtered, sorted, keyset-paginated ticket list for the board and list views. */
export async function listTickets(db: Executor, input: ListTicketsInput): Promise<TicketListResponse> {
  const query = ListTicketsQuery.parse(input);
  const sort = SORTS[query.sort];
  const filters: SQL[] = [];
  if (query.projectId) filters.push(eq(tickets.projectId, query.projectId));
  if (query.projectIds?.length) {
    const inProjects = inProjectsFilter(db, query.projectIds);
    if (inProjects) filters.push(inProjects);
  }
  if (query.parentId) filters.push(eq(tickets.parentId, query.parentId));
  if (query.status?.length) filters.push(inArray(tickets.status, query.status));
  if (query.type?.length) filters.push(inArray(tickets.type, query.type));
  if (query.role?.length) filters.push(inArray(tickets.assigneeRole, query.role));
  if (query.priority?.length) filters.push(inArray(tickets.priority, query.priority));
  if (query.flow) filters.push(arrayContains(tickets.flows, [query.flow]));
  if (query.machineId) filters.push(eq(tickets.assigneeMachineId, query.machineId));
  if (query.q) {
    const pattern = likePattern(query.q);
    const match = or(ilike(tickets.key, pattern), ilike(tickets.title, pattern));
    if (match) filters.push(match);
  }
  if (query.cursor) {
    const [value, id] = decodeCursor(query.cursor, sort.valid);
    const op = query.order === 'desc' ? sql`<` : sql`>`;
    filters.push(sql`(${sort.expr}, ${tickets.id}) ${op} (${value}::${sort.cast}, ${id}::uuid)`);
  }

  const direction = query.order === 'desc' ? desc : asc;
  const rows = await db
    .select({ ticket: tickets, sortValue: sql<string>`(${sort.expr})::text` })
    .from(tickets)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(direction(sort.expr), direction(tickets.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => toTicketDto(row.ticket)),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.sortValue, last.ticket.id) : null,
  };
}

/** Ticket with its children, comments, current report and event timeline. */
export async function getTicketDetail(db: Executor, idOrKey: string): Promise<TicketDetailResponse> {
  const ticket = await getTicketRow(db, idOrKey);
  const [children, commentRows, report, events] = await Promise.all([
    db.select().from(tickets).where(eq(tickets.parentId, ticket.id)).orderBy(asc(tickets.createdAt)),
    db.select().from(comments).where(eq(comments.ticketId, ticket.id)).orderBy(asc(comments.createdAt)),
    getCurrentReport(db, ticket.id),
    listTicketEvents(db, ticket.id),
  ]);
  return {
    ticket: toTicketDto(ticket),
    children: children.map(toTicketDto),
    comments: commentRows.map(toCommentDto),
    report,
    events,
  };
}

/** The largest subtree one call returns; a request tree is far smaller (child caps per pm_task). */
export const TREE_LIMIT = 1000;
/** request → pm_task → dev/qc/bug/docs_init: three levels below a request at most, one spare. */
const TREE_MAX_DEPTH = 4;

/**
 * Every descendant of a ticket, open or closed, in one call: one query per level (parents before their
 * children, oldest first), so the web tree needs no request per node.
 */
export async function getTicketTree(
  db: Executor,
  idOrKey: string,
  limit = TREE_LIMIT,
): Promise<{ items: Ticket[]; truncated: boolean }> {
  const root = await getTicketRow(db, idOrKey);
  const found: Ticket[] = [];
  let frontier = [root.id];
  let truncated = false;
  for (let depth = 0; depth < TREE_MAX_DEPTH && frontier.length > 0 && !truncated; depth++) {
    const level = await db
      .select()
      .from(tickets)
      .where(inArray(tickets.parentId, frontier))
      .orderBy(asc(tickets.createdAt), asc(tickets.id))
      .limit(limit - found.length + 1);
    if (found.length + level.length > limit) {
      truncated = true;
      level.length = limit - found.length;
    }
    found.push(...level.map(toTicketDto));
    frontier = level.map((row) => row.id);
  }
  return { items: found, truncated };
}

const SEARCH_LIMIT = 10;

/**
 * Quick search: tickets by key or title (exact key first), and synced docs pages by title, path or text.
 * `projectIds` narrows both to those projects (requests routed or hinted to one of them included).
 */
export async function search(db: Executor, q: string, projectIds?: string[]): Promise<SearchResponse> {
  const pattern = likePattern(q.trim());
  const match = or(ilike(tickets.key, pattern), ilike(tickets.title, pattern));
  const ticketRows = db
    .select({
      id: tickets.id,
      key: tickets.key,
      title: tickets.title,
      type: tickets.type,
      status: tickets.status,
      projectId: tickets.projectId,
    })
    .from(tickets)
    .where(projectIds?.length ? and(match, inProjectsFilter(db, projectIds)) : match)
    .orderBy(sql`(upper(${tickets.key}) = upper(${q.trim()})) desc`, desc(tickets.updatedAt))
    .limit(SEARCH_LIMIT);
  const [rows, docs] = await Promise.all([ticketRows, searchAllDocs(db, q, projectIds)]);
  return { tickets: rows, docs };
}
