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
 * The owner sees what the agent machine does with a ticket: a waiting mark on the board card, the wait
 * reason in the ticket panel, the switch to running live when the next heartbeat reports it, and the
 * machine's job list. At the three viewports; the page never overflows sideways.
 */
test('agent activity: waiting for a slot, then running, on the card, the ticket and the machine', async ({
  page,
}, testInfo) => {
  const state = readState();
  const viewport = viewportOf(testInfo);
  const agent = new Agent(state.machineA.token);
  const machine = state.machineA.name;
  const title = `Phân tích hoạt động agent (${viewport} ${Date.now()})`;

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
    await agent.heartbeat({
      waitingJobs: [
        {
          ticketId: pm.id,
          status: 'queued',
          role: 'pm',
          kind: 'agent',
          since: new Date().toISOString(),
          waitReason: 'no_slots',
          waitDetail: { loadAvg1: 22.97, cpus: 12, maxLoad: 18, slots: 0, runningJobs: 0 },
        },
      ],
    });

    await page.goto(`/projects/${state.project.key}/board`);
    await expect(page.getByRole('heading', { name: `Board ${state.project.key}` })).toBeVisible();
    if (viewport === 'phone') {
      await page
        .getByRole('navigation', { name: 'Cột trạng thái' })
        .getByRole('button', { name: /^Cần làm/ })
        .click();
    }
    const card = page.getByRole('button', { name: `${pm.key}: ${title}` });
    await expect(card).toBeVisible();
    await expect(card.getByRole('img', { name: /đang chờ slot/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await snap(page, testInfo, 'activity-board');

    await card.click();
    const panel = page.getByRole('complementary', { name: /^Panel ticket/ });
    const line = panel.getByRole('status', { name: 'Hoạt động của agent' });
    await expect(line).toHaveText(`${machine} đã nhận, đang chờ slot — máy bận (tải 23/18, 0 slot trống)`);
    await expectNoHorizontalOverflow(page);
    await snap(page, testInfo, 'activity-waiting');

    // The next heartbeat reports the job running: the panel follows live.
    await agent.heartbeat({
      runningJobs: [
        {
          ticketId: pm.id,
          role: 'pm',
          kind: 'agent',
          startedAt: new Date().toISOString(),
          stage: 'pm_analyze',
          model: 'sonnet',
          effort: 'high',
        },
      ],
    });
    await expect(line).toContainText(`Đang chạy trên ${machine} · sonnet/high · từ `, { timeout: 5_000 });
    await expectNoHorizontalOverflow(page);
    await snap(page, testInfo, 'activity-running');

    await page.goto('/machines');
    const jobs = page.getByRole('list', { name: `Job trên ${machine}` });
    await expect(jobs.getByRole('link', { name: pm.key })).toBeVisible();
    await expect(jobs).toContainText('sonnet/high');
    await expectNoHorizontalOverflow(page);
    await snap(page, testInfo, 'activity-machines');
  } finally {
    await agent.heartbeat({});
  }
});
