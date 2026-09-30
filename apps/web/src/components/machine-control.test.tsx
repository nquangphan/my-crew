import type { Machine, MachineCommand } from '@crew/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { type MockCall, mockFetch, renderWithApp } from '../test/render';
import { MachineControl } from './machine-control';

const MACHINE_ID = '00000000-0000-4000-8000-00000000000a';

const machine = (overrides: Partial<Machine> = {}): Machine => ({
  id: MACHINE_ID,
  name: 'macbook-m4',
  hostname: null,
  os: null,
  hardware: null,
  hostsAssistant: false,
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
  settings: { reported: null, expectedRevision: '', current: false },
  createdAt: '2026-09-28T00:00:00.000Z',
  ...overrides,
});

const REPORT = {
  generatedAt: '2026-09-30T03:00:00.000Z',
  results: [
    {
      id: 'mcp.WEB.figma',
      group: 'mcp',
      title: 'figma (WEB)',
      status: 'red',
      detail: 'Server báo trạng thái "failed"',
      fix: { id: 'mcp-disable:WEB:figma', label: 'Tắt cho project này' },
    },
  ],
  summary: { status: 'red', failing: [{ id: 'mcp.WEB.figma', title: 'figma (WEB)' }] },
};

/** Every command finishes at once with a result that fits its action. */
function setup() {
  const commands = new Map<string, MachineCommand>();
  const calls = mockFetch([
    [
      'POST /v1/machines/',
      (call) => {
        const body = call.body as { action: MachineCommand['action'] };
        const id = `00000000-0000-4000-8000-00000000c0${String(commands.size).padStart(2, '0')}`;
        const result =
          body.action === 'health.run' || body.action === 'health.fix'
            ? { ...REPORT, results: body.action === 'health.fix' ? [] : REPORT.results }
            : body.action === 'pause'
              ? { paused: true }
              : null;
        const command: MachineCommand = {
          id,
          machineId: MACHINE_ID,
          action: body.action,
          params: {},
          status: body.action === 'logs.tail' ? 'failed' : 'done',
          result,
          error: body.action === 'logs.tail' ? 'Máy này không làm được "Log gần nhất"' : null,
          requestedBy: 'owner:quang',
          createdAt: '2026-09-30T03:00:00.000Z',
          startedAt: null,
          finishedAt: null,
        };
        commands.set(id, command);
        return { status: 201, body: { ...command, status: 'pending', result: null, error: null } };
      },
    ],
    ['GET /v1/machines/', (call) => ({ body: commands.get(call.path.split('/').at(-1) ?? '') })],
  ]);
  return calls;
}

const posts = (calls: MockCall[]) => calls.filter((call) => call.method === 'POST').map((call) => call.body);

describe('machine control', () => {
  it('runs the health checks remotely and applies the fix the report offers', async () => {
    const calls = setup();
    renderWithApp(<MachineControl machine={machine()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Kiểm tra sức khỏe' }));
    const report = await screen.findByRole('region', { name: 'Sức khỏe máy' }, { timeout: 5_000 });
    await user.click(within(report).getByRole('button', { name: 'Tắt cho project này' }));
    await waitFor(() =>
      expect(posts(calls)).toEqual([
        { action: 'health.run', quick: true },
        { action: 'health.fix', group: 'mcp', fixId: 'mcp-disable:WEB:figma' },
      ]),
    );
  });

  it('pauses the machine and shows an action it cannot do', async () => {
    const calls = setup();
    renderWithApp(<MachineControl machine={machine()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Tạm dừng nhận job' }));
    expect(await screen.findByText('Tạm dừng máy: xong', {}, { timeout: 5_000 })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Số dòng log'));
    await user.type(screen.getByLabelText('Số dòng log'), '50');
    await user.type(screen.getByLabelText('Chỉ ticket (key)'), 'WEB-3');
    await user.click(screen.getByRole('button', { name: 'Xem log' }));
    expect(await screen.findByRole('alert', {}, { timeout: 5_000 })).toHaveTextContent(
      'Máy này không làm được',
    );
    expect(posts(calls)).toEqual([{ action: 'pause' }, { action: 'logs.tail', limit: 50, ticket: 'WEB-3' }]);
  });

  it('offers resume on a paused machine and nothing while it is offline', async () => {
    setup();
    renderWithApp(<MachineControl machine={machine({ paused: true, online: false })} />);
    expect(await screen.findByRole('button', { name: 'Cho chạy tiếp' })).toBeDisabled();
    expect(screen.getByText('Máy đang offline: các thao tác chạy khi máy kết nối lại.')).toBeInTheDocument();
  });
});
