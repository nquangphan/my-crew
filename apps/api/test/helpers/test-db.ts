import type {
  CreateProjectRequest,
  EventType,
  SubmitReportRequest,
  Ticket,
  TicketStatus,
} from '@crew/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach } from 'vitest';
import type { AppConfig } from '../../src/config.js';
import { createDb, type Database } from '../../src/db/client.js';
import { comments, type EventRow, events, machines, tickets } from '../../src/db/schema.js';
import { createProject } from '../../src/services/project-service.js';
import { submitReport } from '../../src/services/report-service.js';
import { createRequestTicket, createSubtask, transitionTicket } from '../../src/services/ticket-service.js';
import { assertTestDatabase, TEST_DATABASE_URL } from './test-database-url.js';

const TABLES = [
  'idempotency_keys',
  'budgets_usage',
  'events',
  'comments',
  'ticket_reports',
  'tickets',
  'ticket_counters',
  'projects',
  'machines',
  'sessions',
  'owner',
];

/**
 * One pooled connection per test file against the migrated test database, truncated before every test.
 * Call at the top level of a test file.
 */
export function useTestDb(): { readonly db: Database } {
  assertTestDatabase(TEST_DATABASE_URL);
  const handle = createDb(TEST_DATABASE_URL, { max: 8 });
  beforeEach(async () => {
    await handle.db.execute(sql.raw(`truncate table ${TABLES.join(', ')} restart identity cascade`));
  });
  afterAll(() => handle.close());
  return { db: handle.db };
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    databaseUrl: TEST_DATABASE_URL,
    sessionSecret: 'test-session-secret-that-is-long-enough-000',
    allowedOrigins: ['https://crew.test'],
    host: '127.0.0.1',
    port: 0,
    trustProxy: [],
    cookieSecure: true,
    loginRateLimitPerMinute: 100,
    budgetTimezone: 'Asia/Ho_Chi_Minh',
    logLevel: 'silent',
    ...overrides,
  };
}

export const ORIGIN = 'https://crew.test';

export async function createMachine(db: Database, name: string, hostsAssistant = false): Promise<string> {
  const [row] = await db.insert(machines).values({ name, hostsAssistant }).returning({ id: machines.id });
  if (!row) throw new Error('machine insert failed');
  return row.id;
}

export async function createTestProject(
  db: Database,
  overrides: Partial<CreateProjectRequest> & { ownerMachineId?: string | null } = {},
) {
  const { ownerMachineId = null, ...rest } = overrides;
  const project = await createProject(db, {
    key: 'WEB',
    name: 'Web shop',
    description: 'Cửa hàng trực tuyến',
    repoUrl: 'https://github.com/2p/web-shop.git',
    platform: 'web',
    ...rest,
  });
  if (ownerMachineId) {
    await db.execute(sql`update projects set owner_machine_id = ${ownerMachineId} where id = ${project.id}`);
  }
  return { ...project, ownerMachineId };
}

/** Forces a status without going through the workflow, to set up a scenario. */
export async function setStatus(db: Database, ticketId: string, status: TicketStatus): Promise<void> {
  await db.update(tickets).set({ status }).where(eq(tickets.id, ticketId));
}

export async function getTicket(db: Database, ticketId: string) {
  const [row] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!row) throw new Error(`ticket ${ticketId} not found`);
  return row;
}

export function minimalReport(overrides: Partial<SubmitReportRequest> = {}): SubmitReportRequest {
  return { summaryMd: 'Đã hoàn thành.', docsFirst: true, ...overrides };
}

export async function reportAndFinish(db: Database, ticketId: string) {
  await submitReport(db, ticketId, minimalReport());
  await setStatus(db, ticketId, 'in_progress');
  return transitionTicket(db, { ticketId, to: 'done', actor: 'agent' });
}

export async function eventsOf(db: Database, type?: EventType): Promise<EventRow[]> {
  const rows = await db.select().from(events).orderBy(asc(events.id));
  return type ? rows.filter((row) => row.type === type) : rows;
}

export async function commentsOf(db: Database, ticketId: string) {
  return db.select().from(comments).where(eq(comments.ticketId, ticketId)).orderBy(asc(comments.createdAt));
}

export interface Tree {
  assistantMachine: string;
  projectMachine: string;
  project: Awaited<ReturnType<typeof createTestProject>>;
  request: Ticket;
  pmTask: Ticket;
}

/** request (assistant host) -> pm_task (project machine), both in progress. */
export async function createTree(
  db: Database,
  projectOverrides: Parameters<typeof createTestProject>[1] = {},
): Promise<Tree> {
  const assistantMachine = await createMachine(db, 'assistant-mac', true);
  const projectMachine = await createMachine(db, 'project-mac');
  const project = await createTestProject(db, { ownerMachineId: projectMachine, ...projectOverrides });
  const request = await createRequestTicket(db, { title: 'Thêm giỏ hàng' });
  const pmTask = await createSubtask(db, {
    type: 'pm_task',
    parentId: request.id,
    projectId: project.id,
    title: 'Phân tích giỏ hàng',
  });
  await setStatus(db, request.id, 'in_progress');
  await setStatus(db, pmTask.id, 'in_progress');
  return { assistantMachine, projectMachine, project, request, pmTask };
}

export async function createDevWithQc(db: Database, pmTaskId: string, title = 'Làm giỏ hàng') {
  const dev = await createSubtask(db, { type: 'dev', parentId: pmTaskId, title });
  const qc = await createSubtask(db, {
    type: 'qc',
    parentId: pmTaskId,
    title: `QC ${title}`,
    pairsWith: dev.id,
  });
  return { dev, qc };
}
