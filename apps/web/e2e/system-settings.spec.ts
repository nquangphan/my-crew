import { expect, test } from '@playwright/test';
import { closeDb, login, ownerApi, ownerCreateRequest, pairExtraMachine, readState } from './helpers';
import { type ScriptedDaemon, startScriptedDaemon } from './scripted-daemon';

test.afterAll(closeDb);

/**
 * Desktop only. A prompt edited under "Cài đặt hệ thống" reaches a running daemon without a restart or an app
 * update: the machine picks the revision up (shown on the web from its heartbeat) and its next job renders the
 * new prompt. A new machine with a fresh event history plays the assistant host for this test, so the older
 * events of the other specs never reach its daemon.
 */
test('a prompt edited on the web is used by the next job of a running machine', async ({ page }) => {
  const state = readState();
  const marker = `E2E-DẤU-${Date.now()}`;
  const machine = await pairExtraMachine('e2e-settings-mac');
  let daemon: ScriptedDaemon | null = null;
  await login(page, state, '/settings/prompts');
  try {
    await ownerApi(page, 'POST', `/v1/machines/${machine.id}/claims`, { hostsAssistant: true });
    daemon = await startScriptedDaemon({
      machineId: machine.id,
      machineName: machine.name,
      token: machine.token,
      marker,
    });

    await expect(page.getByRole('heading', { name: 'Cài đặt hệ thống' })).toBeVisible();
    await page.getByRole('link', { name: 'Trợ lý: định tuyến yêu cầu' }).click();
    const editor = page.getByLabel('Nội dung assistant-triage.md');
    await expect(editor).not.toHaveValue('');
    const bundled = await editor.inputValue();
    await editor.fill(`${bundled}\n\n${marker} cho {{ticket_key}}`);
    await page.getByRole('button', { name: 'Với bản mặc định' }).click();
    await expect(page.getByRole('region', { name: 'Khác biệt với bản mặc định' })).toContainText(marker);
    await page.getByLabel('Ghi chú thay đổi').fill('E2E: thêm dấu vào prompt trợ lý');
    await page.getByRole('button', { name: 'Lưu' }).click();

    // The daemon hears `settings.changed`, refetches, and its next heartbeat shows the web it has the revision.
    const pickup = page.getByRole('region', { name: 'Máy nhận bản vừa lưu' });
    await expect(pickup.getByRole('listitem').filter({ hasText: machine.name })).toContainText(
      'đã nhận, job kế tiếp dùng bản này',
      { timeout: 30_000 },
    );
    const history = page.getByRole('region', { name: 'Lịch sử thay đổi' });
    await expect(history).toContainText('E2E: thêm dấu vào prompt trợ lý');

    // The next job renders the edited prompt: the scripted run comments the line with the marker.
    const request = await ownerCreateRequest(page, 'Yêu cầu sau khi sửa prompt trợ lý');
    await page.goto(`/tickets/${request.key}`);
    await expect(page.getByText(`Prompt của lượt chạy: ${marker} cho ${request.key}`)).toBeVisible({
      timeout: 30_000,
    });
    expect(daemon.runs.at(-1)?.prompt).toContain(`${marker} cho ${request.key}`);
  } finally {
    await daemon?.stop();
    // Leave the stack as the other specs expect it: the assistant back on machine A, the bundled prompt, and
    // the extra machine gone.
    await ownerApi(page, 'POST', `/v1/machines/${state.machineA.id}/claims`, { hostsAssistant: true });
    await ownerApi(page, 'POST', '/v1/settings', {
      key: { kind: 'prompt', scope: 'global', name: 'assistant-triage' },
      content: null,
      note: 'E2E: dùng lại bản mặc định',
    });
    await ownerApi(page, 'POST', `/v1/machines/${machine.id}/revoke`, {});
  }
});
