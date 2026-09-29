import { expect, test } from '@playwright/test';
import {
  Agent,
  expectNoHorizontalOverflow,
  login,
  ownerCreateRequest,
  readState,
  snap,
  viewportOf,
} from './helpers';

/**
 * The owner calls the PM from a subtask: typing `@` in the comment box suggests `@pm`, the sent comment is
 * marked "Đã gọi PM", and the mark opens the pm_task, whose activity line shows the PM job the machine
 * reports. At the three viewports; the page never overflows sideways.
 */
test('owner @pm: suggestion, mark on the comment, and the PM job on the pm_task', async ({
  page,
}, testInfo) => {
  const state = readState();
  const viewport = viewportOf(testInfo);
  const agent = new Agent(state.machineA.token);
  const machine = state.machineA.name;
  const title = `Gọi PM từ subtask (${viewport} ${Date.now()})`;

  await login(page, state);
  try {
    const request = await ownerCreateRequest(page, `Yêu cầu: ${title}`);
    await agent.transition(request.id, 'in_progress');
    const pm = await agent.createSubtask({
      type: 'pm_task',
      parentId: request.id,
      projectId: state.project.id,
      title,
    });
    const dev = await agent.createSubtask({
      type: 'dev',
      parentId: pm.id,
      title: `Nút thanh toán (${viewport})`,
      complexity: 'small',
      complexityReason: 'Một nút và test của nó',
    });

    await page.goto(`/tickets/${dev.key}`);
    const box = page.getByRole('textbox', { name: 'Thêm bình luận' });
    await box.click();
    await box.pressSequentially('Nhờ @');
    const option = page.getByRole('option', { name: /@pm/ });
    await expect(option).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await snap(page, testInfo, 'pm-mention-suggest');
    await box.press('Enter');
    await expect(box).toHaveValue('Nhờ @pm ');
    await box.pressSequentially('đánh giá lại độ phức tạp giúp');
    await page.getByRole('button', { name: 'Gửi' }).click();

    const list = page.getByRole('list', { name: 'Bình luận' });
    const item = list.getByRole('listitem').filter({ hasText: 'đánh giá lại độ phức tạp giúp' });
    await expect(item).toContainText('Đã gọi PM');
    await expect(box).toHaveValue('');
    await expectNoHorizontalOverflow(page);
    await snap(page, testInfo, 'pm-mention-marked');

    // The machine reports the PM job it queued for the call: it shows on the pm_task.
    await agent.heartbeat({
      runningJobs: [
        {
          ticketId: pm.id,
          role: 'pm',
          kind: 'agent',
          startedAt: new Date().toISOString(),
          stage: 'pm_monitor',
          model: 'sonnet',
          effort: 'high',
        },
      ],
    });
    await item.getByRole('button', { name: `Xem ${pm.key}` }).click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${pm.key}$`));
    const line = page.getByRole('status', { name: 'Hoạt động của agent' });
    await expect(line).toContainText(`Đang chạy trên ${machine} · sonnet/high · từ `);
    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(page.getByText(`Bạn gọi PM (@pm) từ ${dev.key}`)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await snap(page, testInfo, 'pm-mention-activity');
  } finally {
    await agent.heartbeat({});
  }
});
