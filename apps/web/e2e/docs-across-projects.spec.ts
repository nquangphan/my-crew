import { expect, type Page, test } from '@playwright/test';
import {
  Agent,
  closeDb,
  expectNoHorizontalOverflow,
  login,
  openNav,
  ownerCreateRequest,
  readState,
  seedDocs,
  snap,
  type Viewport,
  viewportOf,
} from './helpers';

test.afterAll(closeDb);

/**
 * Two more projects per viewport, sorted after SHOP (and the cross-project spec's keys) so the other specs
 * keep SHOP as the default project: one with synced docs, one without docs and a blocked docs-init ticket.
 */
const WITH_DOCS: Record<Viewport, string> = { phone: 'ZDOCPHONE', tablet: 'ZDOCTABLET', desktop: 'ZDOCDESK' };
const NO_DOCS: Record<Viewport, string> = { phone: 'ZNODOCPH', tablet: 'ZNODOCTA', desktop: 'ZNODOCDE' };

const MANIFEST = [
  'version: 1',
  'source:',
  '  include: ["src/**"]',
  'flows:',
  '  home:',
  '    title: Trang chủ',
  '    doc: docs/flows/home.md',
  '    files: [src/home.ts]',
  '',
].join('\n');

/** The docs project switcher: in the page tree on desktop, in the space header on phone and tablet. */
function switcher(page: Page, current: string) {
  return page.getByRole('button', { name: `Đổi dự án docs (đang xem ${current})` }).first();
}

/**
 * The docs of every project: the docs home lists each project with its docs state (ready or why not), the
 * switcher in a docs page jumps to another project's same page, the space search covers every project with
 * project badges, and the machines page filters jobs by project. At the three viewports; no page overflows
 * sideways.
 */
test('docs home, docs project switcher, cross-project docs search and the machines project filter', async ({
  page,
}, testInfo) => {
  const state = readState();
  const viewport = viewportOf(testInfo);
  const compact = viewport !== 'desktop';
  const agent = new Agent(state.machineA.token);
  const tag = `${viewport}-${Date.now()}`;
  await seedDocs(state);

  const other = await agent.createProject({
    key: WITH_DOCS[viewport],
    name: `Admin ${viewport}`,
    description: 'Trang quản trị trường học.',
    repoUrl: `https://github.com/2p/admin-${viewport}.git`,
    platform: 'web',
  });
  const synced = await agent.syncDocs(other.key, {
    commit: 'a'.repeat(40),
    branch: 'main',
    files: [
      { path: 'docs/flows.yaml', content: MANIFEST },
      { path: 'docs/index.md', content: `# Admin ${viewport}\n\nTrang quản trị.` },
      {
        path: 'docs/architecture.md',
        content: `# Kiến trúc\n\nPostgres là nguồn dữ liệu chính của Admin ${viewport}.`,
      },
      { path: 'docs/flows/home.md', content: '# Trang chủ\n\nMàn hình đầu tiên.' },
    ],
  });
  expect(synced.fileCount).toBe(4);
  const empty = await agent.createProject({
    key: NO_DOCS[viewport],
    name: `Note ${viewport}`,
    description: 'Ghi chú của giáo viên.',
    repoUrl: `https://github.com/2p/note-${viewport}.git`,
    platform: 'web',
  });

  await login(page, state);
  // The no-docs project's docs-init ticket is blocked; the docs home says so and links to it.
  const request = await ownerCreateRequest(page, `Khởi tạo docs ${tag}`);
  await agent.transition(request.id, 'in_progress');
  const pm = await agent.createSubtask({
    type: 'pm_task',
    parentId: request.id,
    projectId: empty.id,
    title: `PM note ${tag}`,
  });
  await agent.transition(pm.id, 'in_progress');
  const docsInit = await agent.createSubtask({ type: 'docs_init', parentId: pm.id, title: `Docs ${tag}` });
  await agent.transition(docsInit.id, 'in_progress');
  await agent.transition(docsInit.id, 'blocked');

  // 1. The sidebar "Tài liệu" opens the docs home with every project and its docs state.
  await openNav(page, viewport, 'Tài liệu');
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Tài liệu · Tất cả dự án' })).toBeVisible();
  const shopCard = page.getByRole('listitem', { name: `Docs dự án ${state.project.key}` });
  const otherCard = page.getByRole('listitem', { name: `Docs dự án ${other.key}` });
  const emptyCard = page.getByRole('listitem', { name: `Docs dự án ${empty.key}` });
  await expect(shopCard).toContainText('file · commit 7b02d1f');
  await expect(otherCard).toContainText('4 file · commit aaaaaaa');
  await expect(emptyCard).toContainText('Chưa có docs');
  await expect(emptyCard).toContainText('Khởi tạo docs đang bị chặn.');
  await expect(emptyCard.getByRole('link', { name: docsInit.key })).toHaveAttribute(
    'href',
    `/tickets/${docsInit.key}`,
  );
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'docs-home-all-projects');

  // 2. Into SHOP's "Kiến trúc", then the switcher opens the other project's "Kiến trúc".
  await shopCard.getByRole('link', { name: 'Mở docs' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${state.project.key}/docs$`));
  await page.goto(`/projects/${state.project.key}/docs?path=docs%2Farchitecture.md`);
  await expect(page.getByRole('heading', { level: 1, name: 'Kiến trúc' })).toBeVisible();
  await switcher(page, state.project.key).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: new RegExp(empty.key) })).toContainText('chưa có docs');
  await menu.getByRole('menuitem', { name: new RegExp(other.key) }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${other.key}/docs\\?path=docs%2Farchitecture\\.md$`));
  await expect(page.getByRole('article')).toContainText(`nguồn dữ liệu chính của Admin ${viewport}`);
  await expect(switcher(page, other.key)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'docs-switched');

  // 3. The space search across every project, with a project badge per result.
  // The search box sits above the page tree: in a drawer behind "Trang docs" on phone and tablet.
  if (compact) await page.getByRole('button', { name: 'Trang docs' }).click();
  await expect(page.getByRole('navigation', { name: 'Cây trang docs' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Tìm trong space' }).fill('nguồn dữ liệu chính');
  await expect(page.getByRole('list', { name: 'Kết quả tìm trong space' }).getByRole('link')).toHaveCount(1);
  await page.getByRole('button', { name: 'Mọi dự án' }).click();
  const across = page.getByRole('list', { name: 'Kết quả tìm trong mọi dự án' });
  await expect(across.locator(`[data-project="${state.project.key}"]`)).toBeVisible();
  await expect(across.locator(`[data-project="${other.key}"]`)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'docs-search-all-projects');
  await across
    .getByRole('link')
    .filter({ has: page.locator(`[data-project="${state.project.key}"]`) })
    .first()
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${state.project.key}/docs\\?path=docs%2Farchitecture\\.md$`),
  );

  // 4. The machines page, filtered to the other project: machine A holds it and shows only its job.
  const shopWork = await agent.createSubtask({
    type: 'pm_task',
    parentId: request.id,
    projectId: state.project.id,
    title: `PM shop ${tag}`,
  });
  await agent.heartbeat({
    runningJobs: [
      { ticketId: pm.id, role: 'pm', kind: 'agent', startedAt: new Date().toISOString() },
      { ticketId: shopWork.id, role: 'pm', kind: 'agent', startedAt: new Date().toISOString() },
    ],
  });
  try {
    await page.goto(`/machines?project=${empty.key}`);
    const machineA = page.getByRole('listitem', { name: `Máy ${state.machineA.name}` });
    const jobs = machineA.getByRole('list', { name: `Job trên ${state.machineA.name}` });
    await expect(jobs.getByRole('link', { name: pm.key })).toBeVisible();
    await expect(jobs.locator(`[data-project="${empty.key}"]`)).toBeVisible();
    await expect(jobs.getByRole('link', { name: shopWork.key })).toBeHidden();
    await expect(page.getByRole('listitem', { name: `Máy ${state.machineB.name}` })).toBeHidden();
    await expect(page.getByRole('button', { name: /^Dự án: 1/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await snap(page, testInfo, 'machines-project-filter');

    // Adding SHOP to the filter brings its job back.
    await page.getByRole('button', { name: /^Dự án: 1/ }).click();
    await page.getByRole('menuitem', { name: new RegExp(state.project.key) }).click();
    await expect(page).toHaveURL(new RegExp(`project=${empty.key}(%2C|,)${state.project.key}`));
    await expect(jobs.getByRole('link', { name: shopWork.key })).toBeVisible();
  } finally {
    // Other specs read machine A's jobs; clear this run's heartbeat.
    await agent.heartbeat({});
  }

  // 5. Desktop keyboard: `g d` opens the docs home from a page outside any project.
  if (viewport === 'desktop') {
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('d');
    await expect(page).toHaveURL(/\/docs$/);
  }
});
