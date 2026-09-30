import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { project, ticket } from '../test/fixtures';
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
  waitingJobs: [],
  failedJobs: [],
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
  it('lists takeovers, waiting tickets, offline machines with their tickets, and approves a claim with a confirm click', async () => {
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
      ['GET /v1/notices', () => ({ body: { items: [], unread: 0 } })],
      ['GET /v1/project-change-requests', () => ({ body: { items: [] } })],
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
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Duyệt' }));
    await screen.findByText('Đã duyệt yêu cầu');
    const decision = calls.find((c) => c.method === 'POST');
    expect(decision?.path).toBe(`/v1/claim-requests/${claim.id}/approve`);
    expect(decision?.body).toBeUndefined();
  });

  it('keeps the dialog open with a message when the decision fails', async () => {
    mockFetch([
      ['GET /v1/claim-requests', () => ({ body: { items: [claim] } })],
      [
        'POST /v1/claim-requests',
        () => ({
          status: 409,
          body: { error: { code: 'CONFLICT', message: 'claim request is already decided' } },
        }),
      ],
      ['GET /v1/tickets', () => ({ body: { items: [], nextCursor: null } })],
      ['GET /v1/machines', () => ({ body: { items: [] } })],
      ['GET /v1/projects', () => ({ body: { items: [] } })],
      ['GET /v1/notices', () => ({ body: { items: [], unread: 0 } })],
      ['GET /v1/project-change-requests', () => ({ body: { items: [] } })],
    ]);
    const user = userEvent.setup();
    renderWithApp(<InboxPage />);
    await user.click(await screen.findByRole('button', { name: 'Từ chối' }));
    const dialog = await screen.findByRole('dialog', { name: 'Từ chối yêu cầu' });
    await user.click(within(dialog).getByRole('button', { name: 'Từ chối' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Dữ liệu bị trùng hoặc đã thay đổi.');
    expect(within(dialog).getByRole('button', { name: 'Từ chối' })).toBeEnabled();
  });

  it("approves a machine's project type change with a confirm click", async () => {
    const change = {
      id: '00000000-0000-4000-8000-0000000000d1',
      projectId: 'p1',
      projectKey: 'SHOP',
      machineId: A,
      machineName: 'macbook',
      current: { platform: 'web', uiTestMcp: { maestro: 'maestro', playwright: 'playwright' } },
      requested: { platform: 'mobile', uiTestMcp: { maestro: 'maestro-cloud', playwright: 'playwright' } },
      status: 'pending',
      decidedAt: null,
      createdAt: '2026-09-28T01:00:00.000Z',
    };
    const calls = mockFetch([
      ['GET /v1/claim-requests', () => ({ body: { items: [] } })],
      ['GET /v1/project-change-requests', () => ({ body: { items: [change] } })],
      [
        'POST /v1/project-change-requests',
        () => ({ body: { ...change, status: 'approved', decidedAt: '2026-09-28T02:00:00.000Z' } }),
      ],
      ['GET /v1/tickets', () => ({ body: { items: [], nextCursor: null } })],
      ['GET /v1/machines', () => ({ body: { items: [machine(A, 'macbook', true)] } })],
      ['GET /v1/projects', () => ({ body: { items: [] } })],
      ['GET /v1/notices', () => ({ body: { items: [], unread: 0 } })],
    ]);
    const user = userEvent.setup();
    renderWithApp(<InboxPage />);
    const group = await screen.findByRole('region', { name: 'Yêu cầu đổi loại dự án cần duyệt' });
    expect(group).toHaveTextContent(
      'macbook muốn đổi dự án SHOP: Web · test UI web playwright → Mobile · test UI mobile maestro-cloud',
    );
    await user.click(within(group).getByRole('button', { name: 'Duyệt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Duyệt đổi loại dự án' });
    await user.click(within(dialog).getByRole('button', { name: 'Duyệt' }));
    await screen.findByText('Đã duyệt thay đổi dự án');
    const decision = calls.find((c) => c.method === 'POST');
    expect(decision?.path).toBe(`/v1/project-change-requests/${change.id}/approve`);
    expect(decision?.body).toBeUndefined();
  });

  it('keeps the read state on the server: opening marks the shown notices read, new ones get a button', async () => {
    const notice = (id: string, read: boolean) => ({
      id,
      type: 'machine.offline',
      ticketId: null,
      projectId: null,
      targetMachineId: null,
      targetRole: null,
      payload: { type: 'machine.offline', data: { machineId: A } },
      createdAt: '2026-09-28T01:00:00.000Z',
      read,
    });
    let server = { items: [notice('12', false), notice('11', false), notice('10', true)], unread: 2 };
    const calls = mockFetch([
      ['GET /v1/claim-requests', () => ({ body: { items: [] } })],
      ['GET /v1/project-change-requests', () => ({ body: { items: [] } })],
      ['GET /v1/tickets', () => ({ body: { items: [], nextCursor: null } })],
      ['GET /v1/machines', () => ({ body: { items: [machine(A, 'macbook', true)] } })],
      ['GET /v1/projects', () => ({ body: { items: [] } })],
      ['GET /v1/notices', () => ({ body: server })],
      [
        'POST /v1/notices/read-all',
        () => {
          // Meanwhile another notice arrived; the read-all stops at the newest one the page showed.
          server = {
            items: [notice('13', false), notice('12', true), notice('11', true), notice('10', true)],
            unread: 1,
          };
          return { body: { unread: 1 } };
        },
      ],
      [
        'POST /v1/notices/read',
        () => {
          server = { items: server.items.map((n) => ({ ...n, read: true })), unread: 0 };
          return { body: { unread: 0 } };
        },
      ],
    ]);
    const user = userEvent.setup();
    renderWithApp(<InboxPage />);

    const feed = await screen.findByRole('region', { name: 'Thông báo' });
    await within(feed).findByText('Đánh dấu tất cả đã đọc');
    const readAll = await waitForCall(calls, 'POST', '/v1/notices/read-all');
    expect(readAll.body).toEqual({ throughId: '12' });
    // The new notice has a button; the ones read on opening keep their dot for this visit.
    const button = await within(feed).findByRole('button', { name: 'Đã đọc' });
    expect(within(feed).getAllByText('Chưa đọc:')).toHaveLength(3);
    await user.click(button);
    const one = await waitForCall(calls, 'POST', '/v1/notices/read');
    expect(one.body).toEqual({ ids: ['13'] });
    await waitFor(() => expect(within(feed).queryByRole('button', { name: 'Đã đọc' })).toBeNull());
    expect(within(feed).queryByText('Đánh dấu tất cả đã đọc')).toBeNull();
  });
});

describe('InboxPage project filter', () => {
  it("keeps only the chosen projects' claims, tickets, machines and notices, with project badges", async () => {
    const shop = project({ key: 'SHOP', ownerMachineId: A });
    const admin = project({ key: 'KIDYADMIN', ownerMachineId: B });
    const lone = project({ key: 'LONE' });
    const shopWait = ticket({ key: 'SHOP-7', title: 'Hỏi SHOP', status: 'needs_input', projectId: shop.id });
    const adminWait = ticket({
      key: 'KIDYADMIN-2',
      title: 'Hỏi admin',
      status: 'needs_input',
      projectId: admin.id,
    });
    const notice = (id: string, projectId: string) => ({
      id,
      type: 'project.created',
      ticketId: null,
      projectId,
      targetMachineId: null,
      targetRole: null,
      payload: { type: 'project.created', data: { projectId, machineId: A } },
      createdAt: '2026-09-28T01:00:00.000Z',
      read: true,
    });
    const calls = mockFetch([
      ['GET /v1/claim-requests', () => ({ body: { items: [claim] } })],
      ['GET /v1/project-change-requests', () => ({ body: { items: [] } })],
      [
        'GET /v1/tickets',
        (call) => {
          const ids = new URL(call.path, 'http://x').searchParams.get('projectIds');
          return { body: { items: ids ? [adminWait] : [shopWait, adminWait], nextCursor: null } };
        },
      ],
      [
        'GET /v1/machines',
        () => ({
          body: {
            items: [
              { ...machine(A, 'macbook', false), projectKeys: ['SHOP'] },
              { ...machine(B, 'mac-mini', false), projectKeys: ['KIDYADMIN'] },
            ],
          },
        }),
      ],
      ['GET /v1/projects', () => ({ body: { items: [shop, admin, lone] } })],
      [
        'GET /v1/notices',
        () => ({ body: { items: [notice('3', admin.id), notice('2', shop.id)], unread: 0 } }),
      ],
    ]);
    const user = userEvent.setup();
    const { router } = renderWithApp(<InboxPage search={{ project: 'KIDYADMIN' }} />);

    const waiting = await screen.findByRole('region', { name: 'Agent đang chờ bạn trả lời' });
    await within(waiting).findByText('KIDYADMIN-2');
    expect(within(waiting).queryByText('SHOP-7')).toBeNull();
    expect(waiting.querySelector('[data-project="KIDYADMIN"]')).not.toBeNull();
    const list = calls.find((c) => c.path.includes('projectIds='));
    expect(new URL(list?.path ?? '', 'http://x').searchParams.get('projectIds')).toBe(admin.id);
    // The SHOP claim, the SHOP machine and the unowned LONE project are hidden.
    expect(screen.queryByRole('region', { name: 'Yêu cầu chuyển máy cần duyệt' })).toBeNull();
    const offline = screen.getByRole('region', { name: 'Máy offline' });
    expect(within(offline).getByText('mac-mini')).toBeInTheDocument();
    expect(within(offline).queryByText('macbook')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Dự án chưa có máy' })).toBeNull();
    const feed = screen.getByRole('region', { name: 'Thông báo' });
    expect(within(feed).getAllByRole('listitem')).toHaveLength(1);
    expect(within(feed).getByText('Ẩn 1 thông báo không thuộc dự án đã chọn.')).toBeInTheDocument();
    expect(feed.querySelector('[data-project="KIDYADMIN"]')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /^Dự án: 1/ }));
    await user.click(await screen.findByRole('menuitem', { name: /KIDYADMIN/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });
});

async function waitForCall(calls: ReturnType<typeof mockFetch>, method: string, path: string) {
  let found: (typeof calls)[number] | undefined;
  await waitFor(() => {
    found = calls.find((c) => c.method === method && c.path === path);
    expect(found).toBeDefined();
  });
  return found as (typeof calls)[number];
}
