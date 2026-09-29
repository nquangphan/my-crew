import { expect, test } from '@playwright/test';
import {
  Agent,
  closeDb,
  expectNoHorizontalOverflow,
  freshTotp,
  login,
  ownerTicket,
  readState,
  snap,
} from './helpers';

test.afterAll(closeDb);

/** Desktop-only owner flows: shortcuts and quick search, pairing a machine, and approving a takeover. */
test('shortcuts, quick search, pairing and takeover approval with TOTP', async ({ page }, testInfo) => {
  const state = readState();
  await login(page, state);
  await expect(page.getByRole('heading', { name: `Board ${state.project.key}` })).toBeVisible();

  // `?` opens the shortcut sheet; `g i` goes to the inbox, `g l` to the list, `g b` back to the board.
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Phím tắt' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('l');
  await expect(page.getByRole('heading', { name: 'Danh sách ticket' })).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('d');
  await expect(page).toHaveURL(new RegExp(`/projects/${state.project.key}/docs`));
  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await expect(page.getByRole('heading', { name: `Board ${state.project.key}` })).toBeVisible();

  // `c` creates, `/` finds the ticket by key, Enter opens it.
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog', { name: 'Tạo ticket' });
  const title = `Tìm nhanh ${Date.now()}`;
  await dialog.getByLabel('Tiêu đề').fill(title);
  await dialog.getByLabel('Tạo thêm').check();
  await dialog.getByRole('button', { name: 'Tạo', exact: true }).click();
  await expect(page.getByText(new RegExp(`Đã tạo AST-\\d+: ${title}`))).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Tiêu đề')).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await page.keyboard.type(title);
  await expect(page.getByRole('option', { name: new RegExp(title) })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

  // Drag and drop: a card dropped on "Xong" without a report is refused and snaps back to Review.
  const requestKey = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  const request = (await ownerTicket(page, requestKey)).ticket;
  const agent = new Agent(state.machineA.token);
  const pm = await agent.createSubtask({
    type: 'pm_task',
    parentId: request.id,
    projectId: state.project.id,
    title: 'Kéo thả',
  });
  const dev = await agent.createSubtask({
    type: 'dev',
    parentId: pm.id,
    title: 'Kéo tôi sang Xong',
    complexity: 'trivial',
    complexityReason: 'Việc nhỏ trong kịch bản',
  });
  const qc = await agent.createSubtask({
    type: 'qc',
    parentId: pm.id,
    title: 'QC kéo thả',
    complexity: 'trivial',
    complexityReason: 'Một flow kéo thả',
    pairsWith: dev.id,
  });
  await agent.transition(dev.id, 'in_progress');
  await agent.transition(dev.id, 'in_review');
  await page.goto(`/projects/${state.project.key}/board`);
  const card = page.getByRole('button', { name: `${dev.key}: Kéo tôi sang Xong` });
  const review = page.getByRole('region', { name: /^Review,/ });
  const done = page.getByRole('region', { name: /^Xong,/ });
  await expect(review.getByRole('button', { name: new RegExp(dev.key) })).toBeVisible();
  const from = await card.boundingBox();
  const to = await done.boundingBox();
  if (!from || !to) throw new Error('board not laid out');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 15 });
  await page.mouse.up();
  await expect(page.getByText(`${dev.key}: Ticket cần có report trước khi chuyển sang Xong.`)).toBeVisible();
  await expect(review.getByRole('button', { name: new RegExp(dev.key) })).toBeVisible();
  await expect(done.getByRole('button', { name: new RegExp(dev.key) })).toBeHidden();

  // Bulk priority change from the list view.
  await page.goto(`/projects/${state.project.key}/list`);
  await page.getByRole('checkbox', { name: `Chọn ${dev.key}` }).check();
  await page.getByRole('checkbox', { name: `Chọn ${qc.key}` }).check();
  const bulk = page.getByRole('toolbar', { name: 'Thao tác hàng loạt' });
  await expect(bulk).toContainText('2 đã chọn');
  await bulk.getByRole('button', { name: 'Đổi ưu tiên' }).click();
  await page.getByRole('menuitem', { name: /Khẩn cấp/ }).click();
  await expect(page.getByText('Đổi ưu tiên thành Khẩn cấp: 2 ticket')).toBeVisible();
  expect((await ownerTicket(page, qc.key)).ticket).toMatchObject({ priority: 'urgent' });

  // Pairing: confirm the TOTP, see the code once.
  await page.goto('/machines');
  await page.getByRole('button', { name: 'Ghép máy mới' }).click();
  await page.getByLabel('Mã xác thực (TOTP)').fill(await freshTotp(state));
  await page.getByRole('button', { name: 'Tạo mã ghép' }).click();
  await expect(page.getByRole('status', { name: 'Mã ghép máy' })).toHaveText(
    /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/,
  );
  await page.getByRole('button', { name: 'Xong' }).click();

  // Takeover: machine B asks for project SHOP, the owner approves in the inbox with a TOTP.
  const machineB = new Agent(state.machineB.token);
  const pending = await machineB.claimProject(state.project.key);
  expect(pending.status).toBe('pending');
  await page.goto('/inbox');
  const claims = page.getByRole('region', { name: 'Yêu cầu chuyển máy cần duyệt' });
  await expect(claims).toContainText(`${state.machineB.name} muốn nhận dự án ${state.project.key}`);
  await expect(page.getByTestId('inbox-badge')).toBeVisible();
  await snap(page, testInfo, 'inbox-claim');
  await claims.getByRole('button', { name: 'Duyệt' }).click();
  const approve = page.getByRole('dialog', { name: 'Duyệt chuyển máy' });
  await approve.getByLabel('Mã xác thực (TOTP)').fill(await freshTotp(state));
  await approve.getByRole('button', { name: 'Duyệt' }).click();
  await expect(page.getByText('Đã duyệt yêu cầu')).toBeVisible();
  await expect(claims).toBeHidden();

  // The project now belongs to machine B; move it back to A from the projects page.
  await page.goto('/projects');
  const projectCard = page.getByRole('listitem', { name: `Dự án ${state.project.key}` });
  await expect(projectCard).toContainText(state.machineB.name);
  await projectCard.getByRole('button', { name: 'Chuyển máy' }).click();
  const move = page.getByRole('dialog', { name: `Chuyển ${state.project.key} sang máy khác` });
  await move.getByLabel('Máy mới').selectOption({ label: state.machineA.name });
  await move.getByRole('button', { name: `Chuyển sang ${state.machineA.name}` }).click();
  await expect(projectCard).toContainText(state.machineA.name);
  await expectNoHorizontalOverflow(page);

  // Dark mode.
  await page.getByRole('button', { name: 'Menu tài khoản' }).click();
  await page.getByRole('menuitem', { name: 'Giao diện tối' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.goto(`/projects/${state.project.key}/board`);
  await snap(page, testInfo, 'board-dark');
});

test('a machine asks to change its project type, the owner approves with TOTP; the inbox read state is shared live by two devices', async ({
  page,
  browser,
}, testInfo) => {
  const state = readState();
  const machineA = new Agent(state.machineA.token);
  const mapping = { playwright: 'playwright', maestro: 'maestro-cloud' };
  const first = await machineA.requestProjectChange(state.project.key, {
    platform: 'web_mobile',
    uiTestMcp: mapping,
  });
  expect(first.status).toBe('pending');

  await login(page, state, '/inbox');
  const changes = page.getByRole('region', { name: 'Yêu cầu đổi loại dự án cần duyệt' });
  await expect(changes).toContainText(`${state.machineA.name} muốn đổi dự án ${state.project.key}`);
  await expect(changes).toContainText(
    'Web và mobile · test UI web playwright · test UI mobile maestro-cloud',
  );
  await snap(page, testInfo, 'inbox-project-change');
  await changes.getByRole('button', { name: 'Duyệt' }).click();
  const approve = page.getByRole('dialog', { name: 'Duyệt đổi loại dự án' });
  await approve.getByLabel('Mã xác thực (TOTP)').fill(await freshTotp(state));
  await approve.getByRole('button', { name: 'Duyệt' }).click();
  await expect(page.getByText('Đã duyệt thay đổi dự án')).toBeVisible();
  await expect(changes).toBeHidden();

  // Opening the inbox on the desktop marked the notices read on the server: a phone sees them read.
  const feed = page.getByRole('region', { name: 'Thông báo' });
  await expect(feed.getByRole('button', { name: 'Đã đọc', exact: true })).toHaveCount(0);
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const phone = await phoneContext.newPage();
    await login(phone, state, '/inbox');
    const phoneFeed = phone.getByRole('region', { name: 'Thông báo' });
    await expect(phoneFeed.getByRole('listitem').first()).toBeVisible();
    await expect(phoneFeed.getByText('Chưa đọc:')).toHaveCount(0);

    // A new notice arrives live on both devices; reading it on the phone clears it on the desktop too.
    const second = await machineA.requestProjectChange(state.project.key, {
      platform: 'mobile',
      uiTestMcp: mapping,
    });
    expect(second.status).toBe('pending');
    await expect(feed.getByRole('button', { name: 'Đã đọc', exact: true })).toHaveCount(1);
    await phoneFeed.getByRole('button', { name: 'Đã đọc', exact: true }).click();
    await expect(phoneFeed.getByRole('button', { name: 'Đã đọc', exact: true })).toHaveCount(0);
    await expect(feed.getByRole('button', { name: 'Đã đọc', exact: true })).toHaveCount(0);

    // Reject the second change: the project keeps the approved type.
    await changes.getByRole('button', { name: 'Từ chối' }).click();
    const reject = page.getByRole('dialog', { name: 'Từ chối đổi loại dự án' });
    await reject.getByLabel('Mã xác thực (TOTP)').fill(await freshTotp(state));
    await reject.getByRole('button', { name: 'Từ chối' }).click();
    await expect(page.getByText('Đã từ chối thay đổi dự án')).toBeVisible();
  } finally {
    await phoneContext.close();
  }
});
