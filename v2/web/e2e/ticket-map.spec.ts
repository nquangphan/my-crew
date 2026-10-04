/**
 * Ticket map on the real app router with the Task1 fixture (PostgreSQL, API, Vite). Tickets and dependencies
 * are created through the owner API (`POST /v2/tickets`, `POST /v2/tickets/:id/dependencies`). Repair links
 * are the one exception: the only producer route that writes them (`POST /v2/tickets/:id/repair-results`) is a
 * machine route that needs a running check step with a claimed attempt and evidence, so this spec inserts
 * `repair_links` rows directly into the fixture database. Nothing on the network is mocked.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';
import { connectDb } from '../../server/src/db/client.ts';
import type { Ticket, TicketGraph } from '../src/contracts/tickets.ts';
import { cardHeight, rowGap } from '../src/graph/layout.ts';
import { type FixtureHandle, withFixture } from './support/fixture.ts';

const evidenceDir = fileURLToPath(
  new URL('../../../plans/261002-0002-crew-v2/execution-phase07/ui-evidence/task-4/', import.meta.url),
);

type Owner = {
  post<T>(path: string, body: unknown): Promise<T>;
  get<T>(path: string): Promise<T>;
};

/** Owner session through the real API: login, CSRF token and a fresh idempotency key per POST. */
async function ownerApi(crew: FixtureHandle): Promise<Owner> {
  const login = await fetch(`${crew.apiOrigin}/v2/auth/session`, {
    method: 'POST',
    headers: { origin: crew.webOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ password: crew.ownerPassword }),
    signal: AbortSignal.timeout(15_000),
  });
  if (login.status !== 200) throw new Error(`MAP_SEED_LOGIN:${login.status}`);
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
  const { csrfToken } = (await login.json()) as { csrfToken?: string };
  if (!cookie || !csrfToken) throw new Error('MAP_SEED_SESSION');
  const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${crew.apiOrigin}${path}`, {
      method,
      headers: {
        origin: crew.webOrigin,
        cookie,
        ...(method === 'POST'
          ? { 'x-csrf-token': csrfToken, 'idempotency-key': randomUUID(), 'content-type': 'application/json' }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200 && response.status !== 201)
      throw new Error(`MAP_SEED:${method}:${path}:${response.status}:${await response.text()}`);
    return (await response.json()) as T;
  };
  return { post: (path, body) => call('POST', path, body), get: (path) => call('GET', path) };
}

function ticketBody(projectId: string, parentId: string | null, level: Ticket['level'], title: string) {
  return {
    projectId,
    parentId,
    level,
    kind: 'code',
    title,
    description: `Mô tả của ${title}.`,
    mandatory: true,
    criteria: level === 'request' ? { workflowChoice: 'superpowers' } : {},
    inputs: {},
    outputs: {},
    skill: null,
    workflowPin: null,
  };
}

async function create(
  owner: Owner,
  projectId: string,
  parent: string | null,
  level: Ticket['level'],
  title: string,
) {
  return owner.post<Ticket>('/v2/tickets', ticketBody(projectId, parent, level, title));
}

/**
 * `ticket` must finish after `predecessor`. The expected revision is read right before the write; a concurrent
 * writer can bump it in between (409 REVISION_CONFLICT), in which case the revision is read again.
 */
async function depend(owner: Owner, ticket: string, predecessor: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const current = await owner.get<Ticket>(`/v2/tickets/${ticket}`);
    try {
      await owner.post(`/v2/tickets/${ticket}/dependencies`, {
        predecessorId: predecessor,
        expectedRevision: current.revision,
      });
      return;
    } catch (error) {
      if (attempt >= 5 || !String(error).includes('REVISION_CONFLICT')) throw error;
    }
  }
}

/** Runs `work` over `items` with at most `limit` requests in flight. */
async function pool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++] as T);
    }),
  );
}

type Seeded = {
  projectId: string;
  root: Ticket;
  steps: Record<'A' | 'B' | 'C' | 'K', Ticket>;
  tasks: Record<'a1' | 'a2' | 'b1' | 'c1', Ticket>;
  fixes: Ticket[];
};

/**
 * Root → steps A and B in parallel → C joins both (fork/join) → K checks C. Tasks a1→a2 inside A, c1 after a2
 * and b1 across steps. K has five fix tasks linked by repair cycles 1–5.
 */
async function seedTree(crew: FixtureHandle, owner: Owner, key: string): Promise<Seeded> {
  const project = await owner.post<{ id: string }>('/v2/projects', {
    key,
    name: `Dự án sơ đồ ${key}`,
    repositoryUrl: null,
  });
  const p = project.id;
  const root = await create(owner, p, null, 'request', 'Yêu cầu sơ đồ ticket');
  const A = await create(owner, p, root.id, 'step', 'Bước A — phân tích');
  const B = await create(owner, p, root.id, 'step', 'Bước B — giao diện');
  const C = await create(owner, p, root.id, 'step', 'Bước C — tích hợp');
  const K = await create(owner, p, root.id, 'step', 'Bước K — kiểm tra');
  const a1 = await create(owner, p, A.id, 'task', 'Việc a1 — đọc yêu cầu');
  const a2 = await create(owner, p, A.id, 'task', 'Việc a2 — viết đặc tả');
  const b1 = await create(owner, p, B.id, 'task', 'Việc b1 — dựng màn hình');
  const c1 = await create(owner, p, C.id, 'task', 'Việc c1 — nối dữ liệu');
  const fixes: Ticket[] = [];
  for (let cycle = 1; cycle <= 5; cycle++)
    fixes.push(await create(owner, p, K.id, 'task', `Sửa vòng ${cycle}`));
  await depend(owner, C.id, A.id);
  await depend(owner, C.id, B.id);
  await depend(owner, K.id, C.id);
  await depend(owner, a2.id, a1.id);
  await depend(owner, c1.id, a2.id);
  await depend(owner, c1.id, b1.id);
  // No owner route writes repair links (see header): fixture-only insert of the five historical cycles.
  const db = connectDb(`postgres://postgres@127.0.0.1:${crew.dbPort}/${crew.dbName}`);
  try {
    for (const fix of fixes)
      await db`insert into repair_links(check_step_id,fix_ticket_id,cycle_id) values (${K.id},${fix.id},${randomUUID()})`;
  } finally {
    await db.end({ timeout: 2 });
  }
  return { projectId: p, root, steps: { A, B, C, K }, tasks: { a1, a2, b1, c1 }, fixes };
}

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
test.describe.configure({ mode: 'serial', timeout: 240_000 });

/**
 * The map pulls `@xyflow/react`, which the Vite dev server may discover on first import and re-optimize (a
 * mid-load re-optimization mixes two React copies). Import the map module once, let it settle, then start from
 * a fresh page.
 */
async function warmUp(page: Page, crew: FixtureHandle): Promise<void> {
  await page.goto(`${crew.webOrigin}/crew-v2/login`);
  await page.waitForSelector('.app-shell');
  await page
    .evaluate((url) => import(/* @vite-ignore */ url), '/crew-v2/src/graph/ticket-map-route.tsx')
    .catch(() => undefined);
  await page.waitForTimeout(1500);
}

async function signIn(page: Page, crew: FixtureHandle): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Đăng nhập Crew' })).toBeVisible();
  await page.getByLabel('Mật khẩu').fill(crew.ownerPassword);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập Crew' })).toBeHidden({ timeout: 15_000 });
}

type View = { x: number; y: number; zoom: number };

/** The transform ReactFlow applies to `.react-flow__viewport`: what the owner actually sees. */
async function viewport(page: Page): Promise<View> {
  const transform = await page
    .locator('.react-flow__viewport')
    .evaluate((node) => (node as HTMLElement).style.transform);
  const match = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)\s*scale\(([-\d.e]+)\)/.exec(transform);
  if (!match) throw new Error(`VIEWPORT_UNREADABLE:${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

function expectSameView(after: View, before: View): void {
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.zoom - before.zoom)).toBeLessThanOrEqual(0.001);
}

const node = (page: Page, id: string) => page.locator(`button[data-map-node="${id}"]`);
/** Map route of one request tree (`phase-07-web.md`: `/requests/:rootId/map`); `search` carries `ticket`. */
const mapUrl = (crew: FixtureHandle, rootId: string, search = '') =>
  `${crew.webOrigin}/crew-v2/requests/${rootId}/map${search ? `?${search}` : ''}`;
const mapPath = (rootId: string) => `/crew-v2/requests/${rootId}/map`;

/** Every pair of mounted cards: none may overlap (checked on real layout boxes). */
async function expectNoOverlap(page: Page): Promise<void> {
  const clashes = await page.locator('.react-flow__node').evaluateAll((elements) => {
    const boxes = elements.map((element) => ({
      id: element.getAttribute('data-id') ?? '',
      rect: element.getBoundingClientRect(),
    }));
    const found: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]?.rect as DOMRect;
        const b = boxes[j]?.rect as DOMRect;
        if (
          a.left < b.right - 0.5 &&
          b.left < a.right - 0.5 &&
          a.top < b.bottom - 0.5 &&
          b.top < a.bottom - 0.5
        )
          found.push(`${boxes[i]?.id}~${boxes[j]?.id}`);
      }
    return found;
  });
  expect(clashes).toEqual([]);
}

function expectSameBox(
  after: { x: number; y: number } | null,
  before: { x: number; y: number } | null,
  label: string,
): void {
  expect(after, label).not.toBeNull();
  expect(before, label).not.toBeNull();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0)), label).toBeLessThanOrEqual(1);
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0)), label).toBeLessThanOrEqual(1);
}

/** Every task card sits in its step's band: at most (tasks − 1) / 2 rows (pitch 136 × zoom) from the step. */
async function expectTasksBesideSteps(page: Page, graph: TicketGraph): Promise<void> {
  const { zoom } = await viewport(page);
  const far: string[] = [];
  for (const step of graph.nodes.filter((row) => row.level === 'step')) {
    const tasks = graph.nodes.filter((row) => row.parentId === step.id);
    if (tasks.length === 0) continue;
    const stepBox = await node(page, step.id).boundingBox();
    const band = ((tasks.length - 1) / 2) * (cardHeight + rowGap) * zoom + 1;
    // The step sits exactly between its first and last task (parents centred, like the reference map).
    const boxes = (await Promise.all(tasks.map((task) => node(page, task.id).boundingBox()))).filter(
      (box): box is NonNullable<typeof box> => box !== null,
    );
    const ys = boxes.map((box) => box.y).sort((a, b) => a - b);
    if (
      stepBox &&
      ys.length === tasks.length &&
      Math.abs(stepBox.y - ((ys[0] ?? 0) + (ys[ys.length - 1] ?? 0)) / 2) > 1
    )
      far.push(`${step.title} không nằm giữa các việc`);
    for (const task of tasks) {
      const box = await node(page, task.id).boundingBox();
      if (!stepBox || !box || Math.abs(box.y - stepBox.y) > band) far.push(`${task.title} ↔ ${step.title}`);
    }
  }
  expect(far).toEqual([]);
}

/** After “Vừa khung” the whole frame and the legend are inside the window and every card is inside the frame. */
async function expectFittedInWindow(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const frame = document.querySelector('.react-flow')?.getBoundingClientRect();
    if (!frame) return { frame: false, outside: [] as string[], bottom: 0 };
    const outside = [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left < frame.left - 1 ||
          rect.top < frame.top - 1 ||
          rect.right > frame.right + 1 ||
          rect.bottom > frame.bottom + 1
        );
      })
      .map((element) => element.getAttribute('data-id') ?? '');
    const legend = document.querySelector('[aria-label="Chú giải"]')?.getBoundingClientRect();
    return { frame: true, outside, bottom: Math.max(frame.bottom, legend?.bottom ?? 0) - window.innerHeight };
  });
  expect(result.frame).toBe(true);
  expect(result.bottom).toBeLessThanOrEqual(0);
  expect(result.outside).toEqual([]);
}

async function graphOf(page: Page, id: string): Promise<TicketGraph> {
  return page.evaluate(async (ticketId) => {
    const response = await fetch(`/v2/tickets/${ticketId}/graph`, { credentials: 'include' });
    if (!response.ok) throw new Error(`GRAPH_${response.status}`);
    return (await response.json()) as TicketGraph;
  }, id);
}

/** Every relation of the producer graph is drawn once with its real endpoints, and nothing else is drawn. */
async function expectEdgesMatch(page: Page, graph: TicketGraph): Promise<void> {
  const drawn = await page
    .locator('.react-flow__edge')
    .evaluateAll((edges) => edges.map((edge) => edge.getAttribute('data-id') ?? ''));
  const expected = [
    ...graph.nodes.filter((row) => row.parentId !== null).map((row) => `parent:${row.parentId}:${row.id}`),
    ...graph.dependencies.map((row) => `dependency:${row.predecessorId}:${row.ticketId}`),
    ...graph.repairLinks.map((row) => `repair:${row.cycleId}:${row.checkStepId}:${row.fixTicketId}`),
  ].sort();
  expect([...drawn].sort()).toEqual(expected);
}

const mockupPath = fileURLToPath(
  new URL(
    '../../../plans/261002-0002-crew-v2/execution-phase07/ui-evidence/design-map-mockup.html',
    import.meta.url,
  ),
);

/**
 * Evidence: our screenshot next to the matching screen of the owner-approved mockup (screen 1 = map, screen 2 =
 * dialog), both at 1440 px wide, composed into one image.
 */
async function sideBySide(page: Page, ours: string, screen: 1 | 2, name: string): Promise<void> {
  const context = page.context();
  const mock = await context.newPage();
  try {
    await mock.setViewportSize({ width: 1440, height: 1000 });
    await mock.goto(pathToFileURL(mockupPath).href);
    const label = mock.locator('.label').nth(screen - 1);
    const section = label.locator('xpath=following-sibling::div[1]');
    const mockShot = await section.screenshot();
    const ourShot = await readFile(`${evidenceDir}${ours}`);
    await mock.setViewportSize({ width: 2400, height: 900 });
    await mock.setContent(
      `<body style="margin:0;background:#08090a;color:#e8e9eb;font:14px sans-serif;display:flex;gap:16px;padding:16px">` +
        `<figure style="margin:0;flex:1"><figcaption>Ứng dụng (${ours})</figcaption><img style="width:100%" src="data:image/png;base64,${ourShot.toString('base64')}"></figure>` +
        `<figure style="margin:0;flex:1"><figcaption>Mockup owner duyệt — màn ${screen}</figcaption><img style="width:100%" src="data:image/png;base64,${mockShot.toString('base64')}"></figure>` +
        `</body>`,
    );
    await mock.screenshot({ path: `${evidenceDir}${name}`, fullPage: true });
  } finally {
    await mock.close();
  }
}

async function shoot(page: Page, name: string): Promise<void> {
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}${name}`, fullPage: false });
}

test('A4: sơ đồ root/fork/join/repair, mở node bằng dialog chung, đóng giữ viewport, realtime không tự fit, URL Back/Forward/reload', async ({
  page,
  crew,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const owner = await ownerApi(crew);
  await warmUp(page, crew);
  const seeded = await seedTree(crew, owner, 'MAPA');
  const { root, steps, tasks } = seeded;
  const requests: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/v2/')) requests.push(`${request.method()} ${pathname}`);
  });

  // Graph read from a child ticket still describes the whole root (single coherent snapshot).
  // The old project route still works for existing links: it redirects to the request route.
  await page.goto(`${crew.webOrigin}/crew-v2/projects/${seeded.projectId}/map?root=${root.id}`);
  await signIn(page, crew);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe(mapPath(root.id));
  await expect(
    page.getByRole('navigation', { name: 'Chế độ xem' }).getByRole('link', { name: 'Bảng', exact: true }),
  ).toHaveAttribute('href', `/crew-v2/projects/${seeded.projectId}/tickets?view=board`);
  const map = page.getByRole('region', { name: 'Sơ đồ ticket' });
  await expect(node(page, root.id)).toBeVisible({ timeout: 30_000 });
  const fromChild = await graphOf(page, tasks.c1.id);
  const fromRoot = await graphOf(page, root.id);
  expect(fromChild).toEqual(fromRoot);
  expect(fromRoot.nodes).toHaveLength(14);

  // Default: root and steps visible, tasks collapsed with relation badges.
  for (const step of Object.values(steps)) await expect(node(page, step.id)).toBeVisible();
  await expect(node(page, tasks.a1.id)).toHaveCount(0);
  await expect(map.getByRole('img', { name: /quan hệ tới công việc thu gọn/ }).first()).toBeVisible();
  await expect(map.getByRole('heading', { name: 'Sơ đồ ticket', level: 1 })).toBeVisible();
  await expect(map.getByText('14 ticket · bấm vào thẻ để xem chi tiết')).toBeVisible();
  await expect(node(page, steps.A.id)).toHaveAttribute(
    'aria-label',
    `Bước: ${steps.A.title}. Trạng thái: Chờ thực hiện. Phiên bản ${(fromRoot.nodes.find((row) => row.id === steps.A.id) as Ticket).revision}`,
  );

  // Owner relayouts keep their anchor still on screen: the clicked step, or the root for “Mở tất cả”.
  const rootBefore = await node(page, root.id).boundingBox();
  await map.getByRole('button', { name: 'Mở tất cả' }).click();
  await expect(map).toHaveAttribute('data-nodes', '14');
  await page.waitForTimeout(300);
  expectSameBox(await node(page, root.id).boundingBox(), rootBefore, 'root khi Mở tất cả');
  // Bring every card on screen (off-screen cards are not mounted) before the single-step check.
  await map.getByRole('button', { name: 'Vừa khung' }).click();
  await expect(node(page, steps.C.id)).toBeVisible();
  await page.waitForTimeout(300);
  const stepBefore = await node(page, steps.C.id).boundingBox();
  await map.getByRole('button', { name: `Thu gọn công việc của ${steps.C.title}` }).click();
  await expect(map).toHaveAttribute('data-nodes', '13');
  await page.waitForTimeout(300);
  expectSameBox(await node(page, steps.C.id).boundingBox(), stepBefore, 'bước C khi thu gọn');
  await map.getByRole('button', { name: `Mở công việc của ${steps.C.title}` }).click();
  await expect(map).toHaveAttribute('data-nodes', '14');
  await page.waitForTimeout(300);
  expectSameBox(await node(page, steps.C.id).boundingBox(), stepBefore, 'bước C khi mở lại');

  // Expand everything, fit, and compare every drawn edge with the producer graph.
  await map.getByRole('button', { name: 'Mở tất cả' }).click();
  // Cards outside the viewport are not mounted, so fit before looking for the new tasks.
  await map.getByRole('button', { name: 'Vừa khung' }).click();
  await expect(node(page, tasks.c1.id)).toBeVisible();
  await page.waitForTimeout(400);
  await expectNoOverlap(page);
  await expectFittedInWindow(page);
  await expectTasksBesideSteps(page, fromRoot);
  await shoot(page, 'map-root-fork-join-repair.png');
  await sideBySide(page, 'map-root-fork-join-repair.png', 1, 'side-by-side-map-vs-mockup.png');
  await expectEdgesMatch(page, fromRoot);
  await expect(map.getByText('phải xong trước').first()).toBeVisible();
  await expect(map.getByText(/^sửa vòng /).first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Restore a stored view at zoom 1.7 that puts step A at (120, 60) of the pane (reload path), then pan by
  // hand from the empty gap left of A's column.
  // A reload lays the tree out afresh; “Sắp xếp lại” produces that same layout, so read A's place after it.
  await map.getByRole('button', { name: 'Sắp xếp lại' }).click();
  await map.getByRole('button', { name: 'Vừa khung' }).click();
  await expect(node(page, steps.A.id)).toBeVisible();
  const placed = await page
    .locator(`.react-flow__node[data-id="${steps.A.id}"]`)
    .evaluate((element) => (element as HTMLElement).style.transform);
  const flowAt = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec(placed);
  if (!flowAt) throw new Error(`NODE_POSITION_UNREADABLE:${placed}`);
  const stored: View = { x: 120 - Number(flowAt[1]) * 1.7, y: 60 - Number(flowAt[2]) * 1.7, zoom: 1.7 };
  await page.evaluate(
    ({ rootId, expanded, view }) =>
      sessionStorage.setItem(
        `crew-v2:map-view:${rootId}`,
        JSON.stringify({ rootId, viewport: view, expanded, selectedTicketId: null, focusedTicketId: null }),
      ),
    { rootId: root.id, expanded: [steps.A.id, steps.B.id, steps.C.id, steps.K.id].sort(), view: stored },
  );
  await page.reload();
  // At zoom 1.7 only the cards inside the viewport are mounted.
  await expect(node(page, steps.A.id)).toBeVisible({ timeout: 30_000 });
  expectSameView(await viewport(page), stored);
  const pane = page.locator('.react-flow');
  const box = await pane.boundingBox();
  if (!box) throw new Error('MAP_BOX');
  await page.mouse.move(box.x + 40, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 430, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const before = await viewport(page);
  expect(before.zoom).toBeCloseTo(1.7, 3);
  expect(Math.abs(before.x - stored.x - 60)).toBeLessThanOrEqual(2);
  expect(Math.abs(before.y - stored.y - 30)).toBeLessThanOrEqual(2);

  // Open step A (on screen at this zoom): the shared dialog with TicketDetail.
  const target = steps.A;
  await node(page, target.id).click();
  const dialog = page.getByRole('dialog', { name: target.title });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('ticket-detail')).toHaveAttribute('data-ticket-id', target.id);
  expect(new URL(page.url()).searchParams.get('ticket')).toBe(target.id);
  // Screen 2 of the mockup: header (status dot, title, subline) and info tiles, before scrolling.
  await expect(dialog.getByRole('list', { name: 'Thông tin nhanh' })).toBeVisible();
  await page.waitForTimeout(300);
  await shoot(page, 'dialog-header-from-map.png');
  await sideBySide(page, 'dialog-header-from-map.png', 2, 'side-by-side-dialog-vs-mockup.png');
  const comment = `Bình luận từ sơ đồ ${randomUUID().slice(0, 8)}`;
  await dialog.getByRole('textbox', { name: 'Nội dung', exact: true }).fill(comment);
  await dialog.getByRole('button', { name: 'Gửi bình luận', exact: true }).click();
  await expect(dialog.getByTestId('timeline-entry').filter({ hasText: comment })).toHaveCount(1, {
    timeout: 15_000,
  });
  await shoot(page, 'dialog-open-from-map.png');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(node(page, target.id)).toBeFocused();
  const after = await viewport(page);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    `${evidenceDir}viewport-a4.json`,
    `${JSON.stringify({ storedOnReload: stored, beforeDialog: before, afterClose: after, delta: { x: after.x - before.x, y: after.y - before.y, zoom: after.zoom - before.zoom } }, null, 2)}\n`,
  );
  expectSameView(after, before);
  expect(new URL(page.url()).searchParams.get('ticket')).toBeNull();
  await shoot(page, 'viewport-restored-after-close.png');

  // Realtime: a new step created elsewhere re-lays the tree out (parents centred) without refitting; the focused
  // card (the one just closed) is the anchor and stays still on screen.
  const focusedBefore = await node(page, target.id).boundingBox();
  const extra = await create(owner, seeded.projectId, root.id, 'step', 'Bước E — tạo khi đang xem');
  // The new card may sit outside the viewport (not mounted), so check the projected node count.
  await expect(map).toHaveAttribute('data-nodes', '15', { timeout: 15_000 });
  await page.waitForTimeout(300);
  expectSameBox(await node(page, target.id).boundingBox(), focusedBefore, 'thẻ đang focus khi có bước mới');
  expect((await viewport(page)).zoom).toBeCloseTo(after.zoom, 3);
  const afterRealtime = await viewport(page);

  // Closing an in-app dialog went back in history, so the dialog entry is forward and Back leaves the map
  // state as it is (it never reopens what was just closed).
  const mapEntry = page.url();
  await page.goForward();
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(mapEntry);
  expectSameView(await viewport(page), afterRealtime);
  // Open again, then Back closes the dialog.
  await node(page, target.id).click();
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(mapEntry);
  // Deep link with ?ticket: closing replaces the entry, Back does not reopen it.
  await page.goto(mapUrl(crew, root.id, `ticket=${target.id}`));
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(new URL(page.url()).searchParams.get('ticket')).toBeNull();
  expectSameView(await viewport(page), afterRealtime);
  await page.goBack();
  await expect(dialog).toBeHidden();
  await page.goForward();
  await expect(dialog).toBeHidden();

  // A malformed ticket query opens nothing and sends no ticket request or mutation.
  requests.length = 0;
  await page.goto(mapUrl(crew, root.id, 'ticket=..%2F..%2Fv2%2Fmachines'));
  await expect(page.locator('button[data-map-node]').first()).toBeAttached({ timeout: 30_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    requests.filter((call) => call.startsWith('POST ') || /\/v2\/(machines|tickets\/[^/]*\.\.)/.test(call)),
  ).toEqual([]);

  // Fit so every card is rendered (cards off screen are not mounted), then use the keyboard.
  await map.getByRole('button', { name: 'Vừa khung' }).click();
  await page.waitForTimeout(400);

  // Keyboard: arrows move between cards, Enter opens the dialog, Escape returns focus to the card.
  await node(page, root.id).focus();
  await page.keyboard.press('ArrowRight');
  const firstStep = [steps.A, steps.B, steps.C, steps.K, extra].sort((a, b) =>
    a.id < b.id ? -1 : 1,
  )[0] as Ticket;
  await expect(node(page, firstStep.id)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: firstStep.title })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(node(page, firstStep.id)).toBeFocused();
  await expect(page.getByRole('region', { name: `Quan hệ của ${firstStep.title}` })).toContainText(root.id);

  // A child ID in the URL resolves to its root.
  await page.goto(mapUrl(crew, tasks.a1.id));
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe(mapPath(root.id));
  await expect(map).toHaveAttribute('data-nodes', '15');
});

test('G1 race: tạo con và dependency đồng thời khi sơ đồ mở — không cạnh treo, bảng/danh sách/sơ đồ cùng revision cuối', async ({
  page,
  crew,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const owner = await ownerApi(crew);
  await warmUp(page, crew);
  const seeded = await seedTree(crew, owner, 'MAPB');
  const { root, steps, tasks } = seeded;
  await page.goto(mapUrl(crew, root.id));
  await signIn(page, crew);
  const map = page.getByRole('region', { name: 'Sơ đồ ticket' });
  await expect(node(page, root.id)).toBeVisible({ timeout: 30_000 });
  await map.getByRole('button', { name: 'Mở tất cả' }).click();
  await page.waitForTimeout(300);
  // No card has focus: the root anchors every realtime relayout and must stay still on screen.
  const rootBefore = await node(page, root.id).boundingBox();

  // Concurrent writers: new tasks under A and B, each depending on an existing task, all at once.
  const created = await Promise.all(
    Array.from({ length: 6 }, async (_, index) => {
      const parent = index % 2 === 0 ? steps.A : steps.B;
      const task = await create(owner, seeded.projectId, parent.id, 'task', `Việc song song ${index + 1}`);
      await depend(owner, task.id, index % 2 === 0 ? tasks.a1.id : tasks.b1.id);
      return task;
    }),
  );
  await Promise.all([
    depend(owner, tasks.c1.id, created[0]?.id ?? ''),
    depend(owner, tasks.c1.id, created[1]?.id ?? ''),
  ]);

  const final = await graphOf(page, root.id);
  expect(final.nodes).toHaveLength(20);
  await expect(map).toHaveAttribute('data-nodes', String(final.nodes.length), { timeout: 20_000 });
  await page.waitForTimeout(500);
  expectSameBox(await node(page, root.id).boundingBox(), rootBefore, 'root (neo) sau ghi đồng thời');
  await map.getByRole('button', { name: 'Vừa khung' }).click();
  await page.waitForTimeout(400);
  await expect(page.locator('button[data-map-node]')).toHaveCount(final.nodes.length);
  // Realtime relayout: every parent is centred between its children and no card covers another.
  await expectNoOverlap(page);
  await expectTasksBesideSteps(page, final);
  for (const row of final.nodes)
    await expect(node(page, row.id)).toHaveAttribute('data-revision', String(row.revision), {
      timeout: 20_000,
    });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expectEdgesMatch(page, final);
  await shoot(page, 'map-after-concurrent-writes.png');

  // Board and list read the same revisions.
  await page.goto(`${crew.webOrigin}/crew-v2/projects/${seeded.projectId}/tickets?view=board`);
  const board = page.getByRole('region', { name: 'Bảng ticket' });
  await expect(board.locator('button[data-ticket-id]')).toHaveCount(final.nodes.length, { timeout: 20_000 });
  for (const row of final.nodes)
    await expect(board.locator(`button[data-ticket-id="${row.id}"]`)).toHaveAttribute(
      'data-revision',
      String(row.revision),
    );
  await page.goto(`${crew.webOrigin}/crew-v2/projects/${seeded.projectId}/tickets?view=list`);
  const list = page.getByRole('region', { name: 'Danh sách ticket' });
  for (const row of final.nodes)
    await expect(list.locator(`tr[data-ticket-id="${row.id}"]`)).toHaveAttribute(
      'data-revision',
      String(row.revision),
    );
  // Without a root filter “Sơ đồ” opens the project's request picker, which leads to the request route.
  await page.getByRole('link', { name: 'Sơ đồ' }).click();
  await expect(page).toHaveURL(new RegExp(`/crew-v2/projects/${seeded.projectId}/map$`));
  await page.getByRole('combobox', { name: 'Yêu cầu' }).selectOption(root.id);
  await expect.poll(() => new URL(page.url()).pathname).toBe(mapPath(root.id));
  await expect(node(page, root.id)).toBeAttached({ timeout: 15_000 });
});

test('390px và 640px (tương đương zoom 200%): danh sách tương đương, không tràn ngang, mở dialog chung', async ({
  page,
  crew,
}) => {
  const owner = await ownerApi(crew);
  await warmUp(page, crew);
  const seeded = await seedTree(crew, owner, 'MAPC');
  await page.goto(mapUrl(crew, seeded.root.id));
  await signIn(page, crew);
  for (const width of [390, 640]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(mapUrl(crew, seeded.root.id));
    const outline = page.getByRole('list', { name: 'Danh sách ticket thay cho sơ đồ' });
    await expect(outline).toBeVisible({ timeout: 30_000 });
    await expect(outline.locator('li[data-ticket-id]')).toHaveCount(14);
    await expect(page.getByText(/^Bước đang làm|^Chưa có bước nào/)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await shoot(page, `map-list-${width}.png`);
    await outline.getByRole('button', { name: seeded.steps.C.title }).click();
    const dialog = page.getByRole('dialog', { name: seeded.steps.C.title });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(outline.getByRole('button', { name: seeded.steps.C.title })).toBeFocused();
  }
});

test('hiệu năng: 200 bước / 600 task — sơ đồ dùng được lần đầu ≤ 2s trên máy fixture', async ({
  page,
  crew,
}) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await warmUp(page, crew);
  const owner = await ownerApi(crew);
  const project = await owner.post<{ id: string }>('/v2/projects', {
    key: 'PERF',
    name: 'Dự án sơ đồ lớn',
    repositoryUrl: null,
  });
  const root = await create(owner, project.id, null, 'request', 'Yêu cầu 200 bước');
  const seedStarted = Date.now();
  const stepIndexes = Array.from({ length: 200 }, (_, index) => index);
  const stepIds: string[] = [];
  await pool(stepIndexes, 8, async (index) => {
    stepIds[index] = (
      await create(owner, project.id, root.id, 'step', `Bước ${String(index + 1).padStart(3, '0')}`)
    ).id;
  });
  const taskIds: string[][] = stepIds.map(() => []);
  await pool(stepIndexes, 8, async (index) => {
    for (let task = 0; task < 3; task++)
      (taskIds[index] as string[])[task] = (
        await create(owner, project.id, stepIds[index] as string, 'task', `Việc ${index + 1}.${task + 1}`)
      ).id;
  });
  const pairs: [string, string][] = [];
  for (let index = 1; index < 200; index++)
    pairs.push([stepIds[index] as string, stepIds[index - 1] as string]);
  for (const list of taskIds)
    for (let task = 1; task < 3; task++) pairs.push([list[task] as string, list[task - 1] as string]);
  await pool(pairs, 8, async ([ticket, predecessor]) => depend(owner, ticket, predecessor));
  const seedSeconds = (Date.now() - seedStarted) / 1000;

  await page.goto(mapUrl(crew, root.id));
  await signIn(page, crew);
  await expect(node(page, root.id)).toBeVisible({ timeout: 30_000 });

  // First usable = from the owner's click on “Sơ đồ” (in-app navigation, cold graph cache after a page load)
  // until the root card is on screen and the controls respond. Full reloads through the Vite dev server are
  // recorded too, but they mostly measure unbundled module loading, not the map.
  const spaRuns: number[] = [];
  for (let run = 0; run < 3; run++) {
    await page.goto(`${crew.webOrigin}/crew-v2/projects/${project.id}/tickets?view=board&rootId=${root.id}`);
    const link = page.getByRole('link', { name: 'Sơ đồ' });
    await expect(link).toBeVisible({ timeout: 30_000 });
    const started = Date.now();
    await link.click();
    await expect(node(page, root.id)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Mở tất cả' })).toBeEnabled();
    spaRuns.push(Date.now() - started);
  }
  const reloadRuns: number[] = [];
  for (let run = 0; run < 3; run++) {
    const started = Date.now();
    await page.goto(mapUrl(crew, root.id));
    await expect(node(page, root.id)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Mở tất cả' })).toBeEnabled();
    reloadRuns.push(Date.now() - started);
  }
  const expandStarted = Date.now();
  await page.getByRole('button', { name: 'Mở tất cả' }).click();
  await page.getByRole('button', { name: 'Vừa khung' }).click();
  await expect(page.locator('button[data-map-node]').first()).toBeVisible();
  const expandMs = Date.now() - expandStarted;
  const graph = await graphOf(page, root.id);
  expect(graph.nodes).toHaveLength(801);
  expect(graph.dependencies).toHaveLength(599);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await shoot(page, 'map-801-expanded.png');

  const browserVersion = page.context().browser()?.version() ?? 'unknown';
  const machine = {
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    memoryGiB: Math.round((totalmem() / 2 ** 30) * 10) / 10,
    node: process.version,
    chromium: browserVersion,
    fixture: 'Task1 fixture: PostgreSQL 18.6 container, Fastify API, Vite dev server, one Playwright worker',
  };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    `${evidenceDir}perf-801.json`,
    `${JSON.stringify({ firstUsableMs: spaRuns, fullReloadDevServerMs: reloadRuns, expandAllAndFitMs: expandMs, seedSeconds, nodes: 801, dependencies: 599, machine }, null, 2)}\n`,
  );
  for (const ms of spaRuns) expect(ms).toBeLessThanOrEqual(2000);
});
