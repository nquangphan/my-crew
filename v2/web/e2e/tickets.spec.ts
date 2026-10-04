/**
 * Ticket read paths on the real API/PostgreSQL of the Task1 fixture: board and list read the same query,
 * the shared Radix dialog renders `TicketDetail`, history is chronological across comments and decisions,
 * a live `comment.created` event refreshes the open dialog without moving focus, and focus returns to the
 * trigger on close. Data is created through the owner API; no network is mocked.
 */
import { test as base, expect, type Page } from '@playwright/test';
import type { QueryClient } from '@tanstack/react-query';
import type { Ticket } from '../src/contracts/tickets.ts';
import type { OwnerClient } from '../src/lib/api.ts';
import type { EventSync } from '../src/lib/events.ts';
import type { PendingStore } from '../src/lib/pending-operation.ts';
import type { SessionController } from '../src/lib/session.ts';
import { type FixtureHandle, withFixture } from './support/fixture.ts';

type Harness = {
  session: SessionController;
  pending: PendingStore;
  client: OwnerClient;
  events: EventSync;
  cache: QueryClient;
  setFilters: (filters: Record<string, string>) => void;
};

const test = base.extend<Record<never, never>, { crew: FixtureHandle }>({
  crew: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern for fixture deps.
    async ({}, use) => {
      await withFixture(async (handle) => {
        await use(handle);
      });
    },
    { scope: 'worker', timeout: 180_000 },
  ],
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const ticketModules = ['board.tsx', 'list.tsx', 'dialog.tsx', 'queries.ts'] as const;

/**
 * The ticket modules pull `@radix-ui/react-dialog`, which the Vite dev server discovers on first import and
 * may answer with a full reload. Import once, let any reload settle, then start from a fresh page so every
 * module shares one optimized React instance.
 */
async function warmUp(page: Page, crew: FixtureHandle): Promise<void> {
  await page.goto(`${crew.webOrigin}/crew-v2/`);
  await page.waitForSelector('.app-shell');
  await page
    .evaluate(async (modules) => {
      for (const name of modules) await import(/* @vite-ignore */ `/crew-v2/src/tickets/${name}`);
    }, ticketModules)
    .catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.goto(`${crew.webOrigin}/crew-v2/`);
  await page.waitForSelector('.app-shell');
}

async function mountHarness(page: Page, crew: FixtureHandle): Promise<void> {
  await warmUp(page, crew);
  await page.evaluate(async () => {
    const load = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);
    const entry = await (await fetch('/crew-v2/src/main.tsx')).text();
    const dep = async (name: string) => {
      const url = [...entry.matchAll(/["']([^"']*\/\.vite\/deps\/[^"']+)["']/g)]
        .map((match) => match[1] ?? '')
        .find((candidate) => (candidate.split('/').pop() ?? '').startsWith(`${name}.js`));
      if (!url) throw new Error(`DEP_NOT_FOUND:${name}`);
      return (await load(url)) as Record<string, unknown> & { default?: Record<string, unknown> };
    };
    const reactModule = await dep('react');
    const React = (reactModule.default ?? reactModule) as typeof import('react');
    const domModule = await dep('react-dom_client');
    const { createRoot } = (
      domModule.createRoot ? domModule : domModule.default
    ) as typeof import('react-dom/client');
    const queryModule = (await dep(
      '@tanstack_react-query',
    )) as unknown as typeof import('@tanstack/react-query');
    const runtimeModule = (await load(
      '/crew-v2/src/app-runtime.ts',
    )) as typeof import('../src/app-runtime.ts');
    const boundaryModule = (await load(
      '/crew-v2/src/auth/session-boundary.tsx',
    )) as typeof import('../src/auth/session-boundary.tsx');
    const queries = (await load(
      '/crew-v2/src/tickets/queries.ts',
    )) as typeof import('../src/tickets/queries.ts');
    const boardModule = (await load(
      '/crew-v2/src/tickets/board.tsx',
    )) as typeof import('../src/tickets/board.tsx');
    const listModule = (await load(
      '/crew-v2/src/tickets/list.tsx',
    )) as typeof import('../src/tickets/list.tsx');
    const dialogModule = (await load(
      '/crew-v2/src/tickets/dialog.tsx',
    )) as typeof import('../src/tickets/dialog.tsx');

    // The app's own composition root: one QueryClient, session, owner client and event stream.
    const runtime = runtimeModule.createAppRuntime({ storage: window.sessionStorage, window });
    const { session, pending, client, events, queryClient: cache } = runtime;
    const harness = { session, pending, client, events, cache } as Omit<Harness, 'setFilters'> & {
      setFilters?: Harness['setFilters'];
    };
    (window as unknown as { crewTest: typeof harness }).crewTest = harness;

    const h = React.createElement;
    function Views() {
      const [filters, setFilters] = React.useState<Record<string, string>>({});
      const [view, setView] = React.useState<'board' | 'list'>('board');
      const [open, setOpen] = React.useState<{ id: string | null; trigger: HTMLElement | null }>({
        id: null,
        trigger: null,
      });
      harness.setFilters = setFilters;
      const viewProps = {
        filters: queries.parseTicketFilters(filters),
        onFiltersChange: (next: Record<string, string>) => setFilters({ ...next }),
        onOpenTicket: (id: string, trigger: HTMLElement) => setOpen({ id, trigger }),
      };
      return h(
        'div',
        null,
        h(
          'button',
          { type: 'button', onClick: () => setView(view === 'board' ? 'list' : 'board') },
          view === 'board' ? 'Xem dạng danh sách' : 'Xem dạng bảng',
        ),
        view === 'board' ? h(boardModule.TicketBoard, viewProps) : h(listModule.TicketList, viewProps),
        h(dialogModule.TicketDialog, {
          ticketId: open.id,
          returnFocus: open.trigger,
          onClose: () => setOpen((current) => ({ id: null, trigger: current.trigger })),
        }),
      );
    }

    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
    const mount = document.createElement('main');
    mount.id = 'tickets-harness';
    mount.tabIndex = -1;
    mount.className = 'workspace__main';
    document.body.append(mount);
    createRoot(mount).render(
      h(
        runtimeModule.RuntimeContext.Provider,
        { value: runtime },
        h(
          queryModule.QueryClientProvider,
          { client: cache },
          h(boundaryModule.SessionBoundary, { session, pending, client, children: h(Views) }),
        ),
      ),
    );
  });
}

type Seeded = { projectId: string; rootA: Ticket; rootB: Ticket; step: Ticket };

async function mutate<T>(page: Page, intentId: string, path: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ({ intentId, path, body }) => {
      const harness = (window as unknown as { crewTest: Harness }).crewTest;
      const operation = harness.pending.begin({ intentId, method: 'POST', path, body, storage: 'tab' });
      return harness.client.mutate(operation);
    },
    { intentId, path, body },
  ) as Promise<T>;
}

function rootBody(projectId: string, kind: 'code' | 'research', description: string) {
  return {
    projectId,
    parentId: null,
    level: 'request',
    kind,
    title: 'Yêu cầu trùng tên',
    description,
    mandatory: true,
    criteria: { workflowChoice: 'superpowers' },
    inputs: {},
    outputs: {},
    skill: null,
    workflowPin: null,
  };
}

async function seed(page: Page): Promise<Seeded> {
  const project = await mutate<{ id: string }>(page, 'seed-project', '/v2/projects', {
    key: 'TICK',
    name: 'Dự án ticket',
    repositoryUrl: null,
  });
  const rootA = await mutate<Ticket>(
    page,
    'seed-root-a',
    '/v2/tickets',
    rootBody(project.id, 'code', 'Dòng một của mô tả.\nDòng hai có dấu: ước lượng.'),
  );
  const rootB = await mutate<Ticket>(
    page,
    'seed-root-b',
    '/v2/tickets',
    rootBody(project.id, 'research', 'B'),
  );
  const step = await mutate<Ticket>(page, 'seed-step', '/v2/tickets', {
    ...rootBody(project.id, 'code', 'Bước con'),
    parentId: rootA.id,
    level: 'step',
    title: 'Bước bắt buộc',
    criteria: {},
  });
  await mutate(page, 'seed-c1', `/v2/tickets/${rootA.id}/comments`, { text: 'Bình luận đầu tiên' });
  await mutate(page, 'seed-d1', `/v2/tickets/${rootA.id}/decisions`, {
    kind: 'assessment',
    content: 'Đánh giá khối lượng',
    rationale: 'Phạm vi nhỏ, một bước',
    sources: [],
    scope: {},
  });
  await mutate(page, 'seed-c2', `/v2/tickets/${rootA.id}/comments`, { text: 'Bình luận thứ hai' });
  return { projectId: project.id, rootA, rootB, step };
}

async function login(page: Page, crew: FixtureHandle): Promise<void> {
  const root = page.locator('#tickets-harness');
  await root.getByLabel('Mật khẩu').fill(crew.ownerPassword);
  await root.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(root.getByRole('button', { name: 'Xem dạng danh sách' })).toBeVisible();
}

test('board/list/dialog đọc cùng ticket và revision, lịch sử theo thời gian, event làm mới dialog, trả focus', async ({
  page,
  crew,
}) => {
  await mountHarness(page, crew);
  await login(page, crew);
  const seeded = await seed(page);
  await page.evaluate((projectId) => {
    (window as unknown as { crewTest: Harness }).crewTest.setFilters({ projectId });
  }, seeded.projectId);

  const board = page.getByRole('region', { name: 'Bảng ticket' });
  for (const label of [
    'Chờ thực hiện',
    'Sẵn sàng',
    'Đang chạy',
    'Chờ bạn',
    'Tạm dừng',
    'Hoàn thành',
    'Đã hủy',
  ])
    await expect(board.getByRole('heading', { name: new RegExp(label) })).toBeVisible();
  const cardA = board.locator(`button[data-ticket-id="${seeded.rootA.id}"]`);
  await expect(cardA).toBeVisible();
  await expect(board.locator('button[data-ticket-id]')).toHaveCount(3);
  await expect(board.getByText('Đã tải hết danh sách theo bộ lọc.')).toBeVisible();
  expect(await board.getByText('Yêu cầu trùng tên').count()).toBe(2);

  await cardA.click();
  const dialog = page.getByRole('dialog', { name: 'Yêu cầu trùng tên' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('ticket-detail')).toHaveAttribute('data-ticket-id', seeded.rootA.id);
  await expect(dialog.getByText('Dòng hai có dấu: ước lượng.', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Bước bắt buộc', { exact: false })).toBeVisible();
  await expect(
    dialog.getByText('Chưa có dữ liệu — máy chủ chưa cung cấp thông tin này.').first(),
  ).toBeVisible();
  const entries = dialog.getByTestId('timeline-entry');
  await expect(entries).toHaveCount(3);
  expect(await entries.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-source')))).toEqual(
    ['comment', 'decision', 'comment'],
  );
  await expect(entries.nth(1)).toContainText('Lý do: Phạm vi nhỏ, một bước');
  await expect(entries.nth(1)).toContainText('Quyết định · Đánh giá');
  await expect(page.locator('#tickets-harness')).toHaveAttribute('aria-hidden', 'true');

  // Focus stays inside the dialog while tabbing.
  for (let index = 0; index < 6; index++) await page.keyboard.press('Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);

  // A live event refreshes the open dialog without moving focus.
  const close = dialog.getByRole('button', { name: 'Đóng' });
  await close.focus();
  await mutate(page, 'live-c3', `/v2/tickets/${seeded.rootA.id}/comments`, { text: 'Bình luận realtime' });
  await expect(entries).toHaveCount(4, { timeout: 15_000 });
  await expect(entries.nth(3)).toContainText('Bình luận realtime');
  await expect(close).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(cardA).toBeFocused();

  const boardRevision = await cardA.getAttribute('data-revision');
  await page.getByRole('button', { name: 'Xem dạng danh sách' }).click();
  const list = page.getByRole('region', { name: 'Danh sách ticket' });
  const rowA = list.locator(`tr[data-ticket-id="${seeded.rootA.id}"]`);
  await expect(rowA).toHaveAttribute('data-revision', boardRevision ?? '');
  await expect(list.locator('tr[data-ticket-id]')).toHaveCount(3);

  const rowButton = rowA.getByRole('button', { name: 'Yêu cầu trùng tên' });
  await rowButton.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('ticket-detail')).toHaveAttribute('data-revision', boardRevision ?? '');
  await dialog.getByRole('button', { name: 'Đóng' }).click();
  await expect(dialog).toBeHidden();
  await expect(rowButton).toBeFocused();

  // Kind filter is the producer's; the shared filter bar narrows both views.
  await list.getByLabel('Loại').selectOption('research');
  await expect(list.locator('tr[data-ticket-id]')).toHaveCount(1);
  await expect(list.locator(`tr[data-ticket-id="${seeded.rootB.id}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Xem dạng bảng' }).click();
  await expect(board.locator('button[data-ticket-id]')).toHaveCount(1);
});
