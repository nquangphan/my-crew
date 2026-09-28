import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ticket } from '../test/fixtures';
import { mockFetch, renderWithApp } from '../test/render';
import { InboxPage } from './inbox';

const machine = (id: string, name: string, online: boolean) => ({
  id,
  name,
  hostname: null,
  os: null,
  hardware: null,
  hostsAssistant: false,
  online,
  streamConnected: online,
  lastSeenAt: '2026-09-28T01:00:00.000Z',
  lastHeartbeatAt: null,
  paused: false,
  health: null,
  resources: null,
  runningJobs: [],
  cliVersion: null,
  appVersion: null,
  tokenExpiresAt: null,
  revokedAt: null,
  projectKeys: [],
  createdAt: '2026-09-28T00:00:00.000Z',
});

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const claim = {
  id: '00000000-0000-4000-8000-0000000000c1',
  machineId: B,
  machineName: 'mac-mini',
  projectId: 'p1',
  projectKey: 'SHOP',
  assistant: false,
  previousMachineId: A,
  status: 'pending',
  decidedAt: null,
  createdAt: '2026-09-28T01:00:00.000Z',
};

describe('InboxPage', () => {
  it('lists takeovers, waiting tickets, offline machines with their tickets, and approves a claim with a TOTP', async () => {
    const waiting = ticket({ key: 'SHOP-7', title: 'Hỏi về /health', status: 'needs_input' });
    const held = ticket({
      key: 'SHOP-8',
      title: 'Vượt ngân sách',
      status: 'needs_input',
      budgetHold: 'cost',
    });
    const stuck = ticket({ key: 'SHOP-9', title: 'Đang chạy trên máy offline', status: 'in_progress' });
    const calls = mockFetch([
      ['GET /v1/claim-requests', () => ({ body: { items: [claim] } })],
      [
        'POST /v1/claim-requests',
        () => ({ body: { ...claim, status: 'approved', decidedAt: '2026-09-28T02:00:00.000Z' } }),
      ],
      ['GET /v1/tickets?status=needs_input', () => ({ body: { items: [waiting, held], nextCursor: null } })],
      ['GET /v1/tickets?machineId', () => ({ body: { items: [stuck], nextCursor: null } })],
      [
        'GET /v1/machines',
        () => ({ body: { items: [machine(A, 'macbook', true), machine(B, 'mac-mini', false)] } }),
      ],
      ['GET /v1/projects', () => ({ body: { items: [] } })],
      ['GET /v1/notices', () => ({ body: { items: [] } })],
    ]);
    const user = userEvent.setup();
    renderWithApp(<InboxPage />);

    const claims = await screen.findByRole('region', { name: 'Yêu cầu chuyển máy cần duyệt' });
    expect(claims).toHaveTextContent('mac-mini muốn nhận dự án SHOP đang do macbook giữ');
    expect(await screen.findByRole('region', { name: 'Agent đang chờ bạn trả lời' })).toHaveTextContent(
      'SHOP-7',
    );
    expect(screen.getByRole('region', { name: 'Duyệt vượt giới hạn' })).toHaveTextContent('SHOP-8');
    const offline = screen.getByRole('region', { name: 'Máy offline' });
    expect(await within(offline).findByText('SHOP-9')).toBeInTheDocument();

    await user.click(within(claims).getByRole('button', { name: 'Duyệt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Duyệt chuyển máy' });
    await user.type(within(dialog).getByLabelText('Mã xác thực (TOTP)'), '654321');
    await user.click(within(dialog).getByRole('button', { name: 'Duyệt' }));
    await screen.findByText('Đã duyệt yêu cầu');
    const decision = calls.find((c) => c.method === 'POST');
    expect(decision?.path).toBe(`/v1/claim-requests/${claim.id}/approve`);
    expect(decision?.body).toEqual({ code: '654321' });
  });

  it('keeps the dialog open with a message when the TOTP is wrong', async () => {
    mockFetch([
      ['GET /v1/claim-requests', () => ({ body: { items: [claim] } })],
      [
        'POST /v1/claim-requests',
        () => ({
          status: 401,
          body: { error: { code: 'UNAUTHORIZED', message: 'invalid verification code' } },
        }),
      ],
      ['GET /v1/tickets', () => ({ body: { items: [], nextCursor: null } })],
      ['GET /v1/machines', () => ({ body: { items: [] } })],
      ['GET /v1/projects', () => ({ body: { items: [] } })],
      ['GET /v1/notices', () => ({ body: { items: [] } })],
    ]);
    const user = userEvent.setup();
    renderWithApp(<InboxPage />);
    await user.click(await screen.findByRole('button', { name: 'Từ chối' }));
    const dialog = await screen.findByRole('dialog', { name: 'Từ chối yêu cầu' });
    await user.type(within(dialog).getByLabelText('Mã xác thực (TOTP)'), '111111');
    await user.click(within(dialog).getByRole('button', { name: 'Từ chối' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Mã xác thực không đúng hoặc đã dùng');
  });
});
