import {
  DEFAULT_BUDGET_SETTINGS,
  DEFAULT_GUARD_POLICY,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_RESOURCE_SETTINGS,
  type SettingsOverviewResponse,
  type SettingsRevision,
} from '@crew/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { project } from '../test/fixtures';
import { type MockCall, mockFetch, renderWithApp } from '../test/render';
import { SettingsMachinePage } from './settings-machine';
import { SettingsPromptPage } from './settings-prompt';
import { SettingsRulesPage } from './system-settings';

const MACHINE_ID = '00000000-0000-4000-8000-00000000000a';

function overview(active: SettingsRevision[] = []): SettingsOverviewResponse {
  return {
    prompts: [
      { name: 'qc', label: 'QC: kiểm thử', partial: false, defaultText: '{{header}}\nKiểm thử mặc định' },
      { name: '_shared-rules', label: 'Phần chung: luật dùng chung', partial: true, defaultText: 'Luật' },
    ],
    variables: [
      { name: 'header', description: 'Đầu prompt' },
      { name: 'ticket_key', description: 'Key ticket' },
    ],
    defaults: {
      policy: DEFAULT_GUARD_POLICY,
      models: DEFAULT_MODEL_SETTINGS,
      budgets: DEFAULT_BUDGET_SETTINGS,
      resources: DEFAULT_RESOURCE_SETTINGS,
    },
    active,
  };
}

function revision(overrides: Partial<SettingsRevision>): SettingsRevision {
  return {
    id: '00000000-0000-4000-8000-0000000000r1',
    kind: 'prompt',
    scope: 'global',
    machineId: null,
    projectId: null,
    name: 'qc',
    version: 1,
    content: { text: '{{header}}\nBản 1' },
    note: 'bản đầu',
    author: 'owner:quang',
    restoredFrom: null,
    createdAt: '2026-09-30T02:00:00.000Z',
    ...overrides,
  };
}

const machine = (current: boolean) => ({
  id: MACHINE_ID,
  name: 'macbook-m4',
  hostname: null,
  os: null,
  hardware: null,
  hostsAssistant: true,
  online: true,
  streamConnected: true,
  lastSeenAt: null,
  lastHeartbeatAt: null,
  paused: false,
  health: null,
  resources: null,
  runningJobs: [],
  waitingJobs: [],
  failedJobs: [],
  cliVersion: null,
  appVersion: null,
  tokenExpiresAt: null,
  revokedAt: null,
  projectKeys: [],
  settings: {
    reported: {
      revision: current ? 'new' : 'old',
      source: 'server',
      rejected: ['project_folder:SHOP: thư mục không tồn tại'],
    },
    expectedRevision: 'new',
    current,
  },
  createdAt: '2026-09-28T00:00:00.000Z',
});

function setup(
  options: { active?: SettingsRevision[]; history?: SettingsRevision[]; current?: boolean } = {},
) {
  let picked = options.current ?? false;
  const calls = mockFetch([
    ['GET /v1/settings/history', () => ({ body: { items: options.history ?? [] } })],
    [
      'GET /v1/settings/diff',
      () => ({ body: { from: revision({}), to: revision({}), lines: [{ op: 'add', text: 'x' }] } }),
    ],
    ['GET /v1/settings', () => ({ body: overview(options.active) })],
    [
      'POST /v1/settings/revisions/',
      (call) => ({
        status: 201,
        body: {
          revision: revision({ version: 3, restoredFrom: 1, id: call.path.split('/')[4] }),
          affectedMachineIds: [MACHINE_ID],
        },
      }),
    ],
    [
      'POST /v1/settings',
      (call) => {
        picked = false;
        const body = call.body as { key: SettingsRevision; content: unknown; note: string };
        return {
          status: 201,
          body: {
            revision: revision({ ...body.key, version: 2, content: body.content, note: body.note }),
            affectedMachineIds: [MACHINE_ID],
          },
        };
      },
    ],
    ['GET /v1/machines', () => ({ body: { items: [machine(picked)] } })],
    ['GET /v1/projects', () => ({ body: { items: [project({ key: 'SHOP', ownerMachineId: MACHINE_ID })] } })],
  ]);
  return {
    calls,
    pickUp: () => {
      picked = true;
    },
  };
}

const saves = (calls: MockCall[]) =>
  calls.filter((call) => call.method === 'POST' && call.path === '/v1/settings');

describe('prompt editor', () => {
  it('starts from the bundled prompt and refuses unknown variables', async () => {
    setup();
    renderWithApp(<SettingsPromptPage name="qc" />);
    const editor = await screen.findByLabelText('Nội dung qc.md');
    expect(editor).toHaveValue('{{header}}\nKiểm thử mặc định');
    expect(screen.getByText('Đang dùng bản mặc định đi kèm app.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(editor, ' {{{{typo}}');
    expect(await screen.findByText('Không có biến {{typo}}.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });

  it('saves with a note on top of the version it opened, then shows which machines picked it up', async () => {
    const { calls, pickUp } = setup({ active: [revision({})] });
    renderWithApp(<SettingsPromptPage name="qc" />);
    const editor = await screen.findByLabelText('Nội dung qc.md');
    expect(editor).toHaveValue('{{header}}\nBản 1');
    const user = userEvent.setup();
    await user.clear(editor);
    await user.type(editor, 'Bản mới cho {{{{ticket_key}}');
    await user.click(screen.getByRole('button', { name: 'Với bản đang dùng' }));
    const diff = screen.getByRole('region', { name: 'Khác biệt với bản đang dùng' });
    expect(within(diff).getByText(/Bản mới cho/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Ghi chú thay đổi'), 'rõ hơn');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(saves(calls)[0]?.body).toEqual({
      key: { kind: 'prompt', scope: 'global', name: 'qc' },
      content: { text: 'Bản mới cho {{ticket_key}}' },
      note: 'rõ hơn',
      baseVersion: 1,
    });
    const pickup = await screen.findByRole('region', { name: 'Máy nhận bản vừa lưu' });
    expect(await within(pickup).findByText('chưa nhận (chờ heartbeat kế tiếp)')).toBeInTheDocument();
    pickUp();
    expect(
      await within(pickup).findByText('đã nhận, job kế tiếp dùng bản này', {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
  });

  it('restores an earlier version from the history', async () => {
    const two = revision({ id: '00000000-0000-4000-8000-0000000000r2', version: 2, note: 'bản hai' });
    const one = revision({});
    const { calls } = setup({ active: [two], history: [two, one] });
    renderWithApp(<SettingsPromptPage name="qc" />);
    const history = await screen.findByRole('region', { name: 'Lịch sử thay đổi' });
    expect(await within(history).findByText('bản hai')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(history).getByRole('button', { name: 'Khôi phục' }));
    const dialog = await screen.findByRole('dialog', { name: 'Khôi phục bản 1?' });
    await user.click(within(dialog).getByRole('button', { name: 'Khôi phục' }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === `/v1/settings/revisions/${one.id}/restore`)).toBe(true),
    );
  });
});

describe('rules page', () => {
  it('shows the line of an unsafe path and saves valid rules', async () => {
    const { calls } = setup();
    renderWithApp(<SettingsRulesPage />);
    const docs = await screen.findByLabelText('Đường dẫn docs');
    const user = userEvent.setup();
    await user.type(docs, '\n../ngoài/**');
    expect(await screen.findByText('Đường dẫn docs, dòng 3: không có đoạn rỗng hay ..')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    await user.clear(docs);
    await user.type(docs, 'docs/**\nhandbook/**');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(saves(calls)[0]?.body).toMatchObject({
      key: { kind: 'policy', scope: 'global' },
      content: {
        ...DEFAULT_GUARD_POLICY,
        docsPaths: ['docs/**', 'handbook/**'],
        qcUiTestOnlyForNonDocs: false,
      },
    });
  });
});

describe('machine settings', () => {
  it('saves the machine resources and a machine-only model map', async () => {
    const { calls } = setup({ current: true });
    renderWithApp(<SettingsMachinePage machineId={MACHINE_ID} />);
    const resources = await screen.findByRole('region', { name: 'Tài nguyên' });
    const user = userEvent.setup();
    const jobs = within(resources).getByLabelText('Số job chạy cùng lúc');
    await user.clear(jobs);
    await user.type(jobs, '5');
    await user.click(within(resources).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(saves(calls)[0]?.body).toMatchObject({
      key: { kind: 'resources', scope: 'machine', machineId: MACHINE_ID },
      content: { maxConcurrentJobs: 5, minFreeMemGb: 2, maxLoadPerCpu: 1.5 },
    });

    const models = screen.getByRole('region', { name: 'Bảng model' });
    await user.click(within(models).getByRole('radio', { name: 'Riêng máy này' }));
    await user.selectOptions(within(models).getByLabelText('Lớn (large): model'), 'sonnet');
    await user.click(within(models).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(2));
    expect(saves(calls)[1]?.body).toMatchObject({
      key: { kind: 'models', scope: 'machine', machineId: MACHINE_ID },
      content: { complexityMap: { large: { model: 'sonnet', effort: 'high' } } },
    });
  });

  it('edits the folder of each project the machine holds and shows the folders it cannot use', async () => {
    const { calls } = setup({ current: true });
    renderWithApp(<SettingsMachinePage machineId={MACHINE_ID} />);
    const folders = await screen.findByRole('region', { name: 'Thư mục dự án' });
    const row = await within(folders).findByText('SHOP');
    expect(within(folders).getByRole('alert')).toHaveTextContent(
      'Máy không dùng được thư mục này: thư mục không tồn tại',
    );
    const user = userEvent.setup();
    await user.type(within(folders).getByLabelText('Thư mục SHOP trên máy'), 'relative/path');
    expect(await within(folders).findByText(/SHOP: phải là đường dẫn tuyệt đối/)).toBeInTheDocument();
    await user.clear(within(folders).getByLabelText('Thư mục SHOP trên máy'));
    await user.type(within(folders).getByLabelText('Thư mục SHOP trên máy'), '/Users/quang/shop');
    await user.type(within(folders).getByLabelText('Đường dẫn dùng chung của SHOP'), '.cursor/rules');
    await user.click(within(folders).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(saves(calls)[0]?.body).toMatchObject({
      key: { kind: 'project_folders', scope: 'machine', machineId: MACHINE_ID },
      content: { projects: [{ key: 'SHOP', repoPath: '/Users/quang/shop', sharedPaths: ['.cursor/rules'] }] },
    });
    expect(row).toBeInTheDocument();
  });
});
