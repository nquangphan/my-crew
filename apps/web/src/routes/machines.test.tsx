import type { Ticket } from '@crew/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { project, ticket } from '../test/fixtures';
import { mockFetch, renderWithApp } from '../test/render';
import { MachinesPage } from './machines';

const shop = project({ key: 'SHOP' });
const admin = project({ key: 'KIDYADMIN' });
const shopDev = ticket({ key: 'SHOP-3', projectId: shop.id, status: 'in_progress' });
const adminDev = ticket({ key: 'KIDYADMIN-5', projectId: admin.id, status: 'in_progress' });
const note = project({ key: 'NOTE' });

function machine(id: string, name: string, projectKeys: string[], jobs: Ticket[]) {
  return {
    id,
    name,
    hostname: null,
    os: null,
    hardware: null,
    hostsAssistant: false,
    online: true,
    streamConnected: true,
    lastSeenAt: '2026-09-28T01:00:00.000Z',
    lastHeartbeatAt: '2026-09-28T01:00:00.000Z',
    paused: false,
    health: null,
    resources: null,
    runningJobs: jobs.map((job) => ({
      ticketId: job.id,
      role: 'dev',
      kind: 'agent',
      startedAt: '2026-09-28T01:00:00.000Z',
    })),
    waitingJobs: [],
    failedJobs: [],
    cliVersion: null,
    appVersion: null,
    tokenExpiresAt: null,
    revokedAt: null,
    projectKeys,
    createdAt: '2026-09-28T00:00:00.000Z',
  };
}

function setup() {
  const byId = new Map([shopDev, adminDev].map((t) => [t.id, t]));
  return mockFetch([
    [
      'GET /v1/machines',
      () => ({
        body: {
          items: [
            machine(
              '00000000-0000-4000-8000-0000000000a1',
              'macbook',
              ['SHOP', 'KIDYADMIN'],
              [shopDev, adminDev],
            ),
            machine('00000000-0000-4000-8000-0000000000a2', 'mac-mini', ['NOTE'], []),
          ],
        },
      }),
    ],
    ['GET /v1/projects', () => ({ body: { items: [shop, admin, note] } })],
    [
      'GET /v1/tickets/',
      (call) => {
        const found = byId.get(call.path.split('/').at(-1) ?? '');
        if (!found) return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
        return { body: { ticket: found, children: [], comments: [], report: null, events: [] } };
      },
    ],
  ]);
}

describe('MachinesPage', () => {
  it('shows each job with its project badge', async () => {
    setup();
    renderWithApp(<MachinesPage search={{}} />);
    const jobs = await screen.findByRole('list', { name: 'Job trên macbook' });
    await within(jobs).findByText('KIDYADMIN-5');
    const badges = [...jobs.querySelectorAll('[data-project]')].map((b) => b.getAttribute('data-project'));
    expect(badges).toEqual(['SHOP', 'KIDYADMIN']);
    expect(screen.getByRole('listitem', { name: 'Máy mac-mini' })).toBeInTheDocument();
  });

  it("keeps the machines holding the chosen projects and only those projects' jobs", async () => {
    setup();
    const user = userEvent.setup();
    const { router } = renderWithApp(<MachinesPage search={{ project: 'KIDYADMIN' }} />);
    const jobs = await screen.findByRole('list', { name: 'Job trên macbook' });
    await within(jobs).findByText('KIDYADMIN-5');
    await waitFor(() => expect(within(jobs).queryByText('SHOP-3')).toBeNull());
    expect(screen.queryByRole('listitem', { name: 'Máy mac-mini' })).toBeNull();
    expect(screen.getByText('Ẩn 1 máy không giữ dự án đã chọn.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Dự án: 1/ }));
    await user.click(await screen.findByRole('menuitem', { name: /NOTE/ }));
    expect(router.state.location.search).toEqual({ project: 'KIDYADMIN,NOTE' });
  });
});
