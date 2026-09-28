import {
  type ListTicketsQuery as ListTicketsInput,
  ListTicketsQuery,
  type SearchResponse,
  type TicketDetailResponse,
  type TicketListResponse,
} from '@crew/shared';
import { and, arrayContains, asc, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { comments, tickets } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { listTicketEvents } from './event-service.js';
import { getCurrentReport } from './report-service.js';
import { getTicketRow, toTicketDto } from './ticket-service.js';

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

/** Escapes LIKE wildcards so user text is matched literally. */
export const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

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

/** Filtered, sorted, keyset-paginated ticket list for the board and list views. */
export async function listTickets(db: Executor, input: ListTicketsInput): Promise<TicketListResponse> {
  const query = ListTicketsQuery.parse(input);
  const sort = SORTS[query.sort];
  const filters: SQL[] = [];
  if (query.projectId) filters.push(eq(tickets.projectId, query.projectId));
  if (query.parentId) filters.push(eq(tickets.parentId, query.parentId));
  if (query.status?.length) filters.push(inArray(tickets.status, query.status));
  if (query.type?.length) filters.push(inArray(tickets.type, query.type));
  if (query.role?.length) filters.push(inArray(tickets.assigneeRole, query.role));
  if (query.priority?.length) filters.push(inArray(tickets.priority, query.priority));
  if (query.flow) filters.push(arrayContains(tickets.flows, [query.flow]));
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
    comments: commentRows.map((c) => ({
      id: c.id,
      ticketId: c.ticketId,
      authorKind: c.authorKind,
      authorRole: c.authorRole,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
    report,
    events,
  };
}

const SEARCH_LIMIT = 10;

/**
 * Quick search: tickets by key or title (exact key first). Docs pages are matched by title once the docs
 * snapshot tables exist; until then the docs list is empty.
 */
export async function search(db: Executor, q: string): Promise<SearchResponse> {
  const pattern = likePattern(q.trim());
  const rows = await db
    .select({
      id: tickets.id,
      key: tickets.key,
      title: tickets.title,
      type: tickets.type,
      status: tickets.status,
    })
    .from(tickets)
    .where(or(ilike(tickets.key, pattern), ilike(tickets.title, pattern)))
    .orderBy(sql`(upper(${tickets.key}) = upper(${q.trim()})) desc`, desc(tickets.updatedAt))
    .limit(SEARCH_LIMIT);
  return { tickets: rows, docs: [] };
}
