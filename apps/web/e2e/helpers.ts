import { createHash, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { generateSync } from 'otplib';
import postgres from 'postgres';
import { DOCS_COMMIT, DOCS_FILES } from './docs-fixture';
import {
  assertE2eDatabase,
  E2E_API_URL,
  E2E_DATABASE_URL,
  E2E_STATE_FILE,
  E2E_WEB_ORIGIN,
  type E2eState,
} from './e2e-env';

export function readState(): E2eState {
  return JSON.parse(readFileSync(E2E_STATE_FILE, 'utf8')) as E2eState;
}

let sql: postgres.Sql | null = null;
function db(): postgres.Sql {
  assertE2eDatabase(E2E_DATABASE_URL);
  sql ??= postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  return sql;
}

export async function closeDb(): Promise<void> {
  await sql?.end({ timeout: 5 });
  sql = null;
}

/**
 * A fresh TOTP code. Codes are single use per 30 s step; clearing the replay marker of the test owner stands
 * in for waiting for the next step (the same trick the API tests use).
 */
export async function freshTotp(state: E2eState): Promise<string> {
  await db()`update owner set totp_last_step = null`;
  return generateSync({ secret: state.totpSecret });
}

export type Viewport = 'phone' | 'tablet' | 'desktop';
export const viewportOf = (testInfo: TestInfo): Viewport => testInfo.project.name as Viewport;

/** Logs in through the UI: password, then the TOTP step. */
export async function login(page: Page, state: E2eState, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  await page.getByLabel('Tên đăng nhập').fill(state.username);
  await page.getByLabel('Mật khẩu').fill(state.password);
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(page.getByRole('heading', { name: 'Xác thực hai bước' })).toBeVisible();
  await page.getByLabel('Mã xác thực').fill(await freshTotp(state));
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('link', { name: /^Inbox/ }).first()).toBeVisible();
}

/** The page never scrolls sideways (the board scrolls inside its own container). */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'document.documentElement.scrollWidth <= innerWidth').toBeLessThanOrEqual(innerWidth);
}

/** Screenshots for the visual check against the mockup; they land in the gitignored test-results. */
export async function snap(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${name}.png`) });
}

/** Opens a sidebar entry; on phones the sidebar is a drawer behind the menu button. */
export async function openNav(page: Page, viewport: Viewport, label: string): Promise<void> {
  if (viewport !== 'desktop') {
    await page.getByRole('button', { name: viewport === 'phone' ? 'Mở menu' : 'Mở rộng thanh bên' }).click();
  }
  const nav = page.getByRole('navigation', { name: 'Điều hướng dự án' }).last();
  await nav.getByRole('link', { name: label, exact: true }).click();
}

interface TicketDto {
  id: string;
  key: string;
  status: string;
  priority: string;
}

/** Acts as the daemon of a paired machine through the real daemon REST API. */
export class Agent {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (method !== 'GET') headers['idempotency-key'] = `e2e-${randomUUID()}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${E2E_API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  createSubtask(body: Record<string, unknown>) {
    return this.call<TicketDto>('POST', '/v1/daemon/tickets', body);
  }
  comment(ticketId: string, body: string) {
    return this.call('POST', `/v1/daemon/tickets/${ticketId}/comments`, { body });
  }
  transition(ticketId: string, to: string) {
    return this.call<TicketDto>('POST', `/v1/daemon/tickets/${ticketId}/transition`, { to });
  }
  report(ticketId: string, summaryMd: string) {
    return this.call('PUT', `/v1/daemon/tickets/${ticketId}/report`, {
      summaryMd,
      docsFirst: true,
      commits: ['a41c9e2'],
      headSha: 'a41c9e2',
      testsRun: [{ name: 'pnpm test', passed: true, summary: '12 passed' }],
    });
  }
  /** The owning machine asks to change its project's type and UI-test MCP mapping. */
  requestProjectChange(
    projectKey: string,
    body: { platform: string; uiTestMcp: { playwright?: string; maestro?: string } },
  ) {
    return this.call<{ status: string; requestId: string | null }>(
      'POST',
      `/v1/daemon/projects/${projectKey}/change-requests`,
      body,
    );
  }
  /** Creates a project owned by this machine, as the daemon does from a local folder. */
  createProject(body: { key: string; name: string; description: string; repoUrl: string; platform: string }) {
    return this.call<{ id: string; key: string; name: string }>('POST', '/v1/daemon/projects', body);
  }
  /** Syncs a docs snapshot, as the daemon does after a merge to the default branch. */
  syncDocs(
    projectKey: string,
    body: { commit: string; branch: string; files: { path: string; content: string }[] },
  ) {
    return this.call<{ fileCount: number }>('PUT', `/v1/daemon/projects/${projectKey}/docs`, body);
  }
  /** A heartbeat: replaces the machine's reported resources and running, waiting and failed jobs. */
  heartbeat(body: { runningJobs?: unknown[]; waitingJobs?: unknown[]; failedJobs?: unknown[] }) {
    return this.call('POST', '/v1/daemon/heartbeat', {
      resources: { cpus: 12, loadAvg1: 22.97, freeMemGb: 9, totalMemGb: 32 },
      cliVersion: '2.1.283',
      ...body,
    });
  }
  claimProject(projectKey: string) {
    return this.call<{ status: string; claimRequestId: string | null }>('POST', '/v1/daemon/claims', {
      projectKey,
    });
  }
}

/** Reads a ticket as the logged-in owner (the page's cookies). */
export async function ownerTicket(
  page: Page,
  key: string,
): Promise<{ ticket: TicketDto; children: TicketDto[] }> {
  const res = await page.request.get(`/v1/tickets/${key}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as { ticket: TicketDto; children: TicketDto[] };
}

/** Syncs the docs fixture for project SHOP as its owning machine (idempotent: the same commit every time). */
export async function seedDocs(state: E2eState): Promise<void> {
  const result = await new Agent(state.machineA.token).syncDocs(state.project.key, {
    commit: DOCS_COMMIT,
    branch: 'main',
    files: DOCS_FILES,
  });
  expect(result.fileCount).toBe(DOCS_FILES.length);
}

/** A mutating owner API call from the logged-in page (session cookie, CSRF header and Origin). */
export async function ownerApi<T>(
  page: Page,
  method: 'POST' | 'PATCH',
  path: string,
  data: unknown,
): Promise<T> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'crew_csrf')?.value;
  const res = await page.request.fetch(path, {
    method,
    data,
    headers: { 'x-csrf-token': csrf ?? '', origin: E2E_WEB_ORIGIN },
  });
  expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/** Pairs one more machine with a fresh single-use code (stored straight in the E2E database). */
export async function pairExtraMachine(name: string): Promise<{ id: string; name: string; token: string }> {
  const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const code = Array.from({ length: 12 }, () => BASE32[randomInt(BASE32.length)]).join('');
  const codeHash = createHash('sha256').update(code).digest('hex');
  await db()`insert into pairing_codes (code_hash, expires_at) values (${codeHash}, now() + interval '10 minutes')`;
  const res = await fetch(`${E2E_API_URL}/v1/machines/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      name,
      hostname: `${name}.local`,
      os: 'darwin 25.5',
      hardware: { cpus: 8, memGb: 16 },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /v1/machines/pair → ${res.status} ${text}`);
  const paired = JSON.parse(text) as { machineId: string; token: string };
  return { id: paired.machineId, name, token: paired.token };
}

/** Creates a request ticket as the logged-in owner (session cookie plus the CSRF header). */
export async function ownerCreateRequest(page: Page, title: string): Promise<TicketDto> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'crew_csrf')?.value;
  expect(csrf, 'CSRF cookie after login').toBeTruthy();
  const res = await page.request.post('/v1/tickets', {
    data: { title },
    // A browser sends the Origin header on a same-origin POST; the API's CSRF guard requires it.
    headers: { 'x-csrf-token': csrf ?? '', origin: E2E_WEB_ORIGIN },
  });
  expect(res.ok(), `POST /v1/tickets → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as TicketDto;
}
