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

describe('MachinesPage runtime updates', () => {
  const release = (version: string, app = '>=0.3.0 <0.4.0') => ({
    version,
    commit: 'abcdef1234567890',
    createdAt: '2026-09-30T05:00:00.000Z',
    publishedAt: '2026-09-30T05:10:00.000Z',
    shellRange: { app, electron: '44' },
    size: 1000,
    bundleSha256: 'a'.repeat(64),
    source: 'github',
    publishedBy: 'github:nquangphan/my-crew',
    keyId: 'crew-runtime-2026-09',
  });
  const runtimeState = (overrides: object = {}) => ({
    shellVersion: '0.3.0',
    version: '0.3.1',
    source: 'installed',
    state: 'idle',
    target: null,
    message: null,
    checkedAt: '2026-09-30T05:20:00.000Z',
    ...overrides,
  });

  function setupRuntime(pinnedVersion: string | null = null, reported: object = runtimeState()) {
    return mockFetch([
      [
        'GET /v1/machines',
        () => ({
          body: {
            items: [
              {
                ...machine('00000000-0000-4000-8000-0000000000a1', 'macbook', [], []),
                appVersion: '0.3.0',
                runtime: { reported, pinnedVersion },
              },
              machine('00000000-0000-4000-8000-0000000000a2', 'mac-cu', [], []),
            ],
          },
        }),
      ],
      ['GET /v1/projects', () => ({ body: { items: [] } })],
      [
        'GET /v1/runtime/releases',
        () => ({ body: { items: [release('0.3.2'), release('0.3.1')], githubRepo: 'nquangphan/my-crew' } }),
      ],
      [
        'PUT /v1/machines/',
        (call) => ({
          body: {
            machineId: call.path.split('/')[3],
            pinnedVersion: (call.body as { version: string | null }).version,
          },
        }),
      ],
      ['POST /v1/runtime/releases/import', () => ({ body: { imported: ['0.3.3'], skipped: [] } })],
    ]);
  }

  it("shows each machine's app and runtime versions, its update state and the published releases", async () => {
    setupRuntime(
      null,
      runtimeState({
        state: 'rolled_back',
        target: '0.3.2',
        message: 'Bản runtime 0.3.2 không khởi động được; đã quay lại bản 0.3.1.',
      }),
    );
    renderWithApp(<MachinesPage search={{}} />);
    const card = await screen.findByRole('listitem', { name: 'Máy macbook' });
    await within(card).findByText(/không khởi động được/);
    expect(card.querySelector('[data-runtime="0.3.1"]')).not.toBeNull();
    expect(card.textContent).toContain('app 0.3.0 · runtime 0.3.1 (cập nhật nóng)');
    const old = screen.getByRole('listitem', { name: 'Máy mac-cu' });
    expect(within(old).getByText(/máy chưa báo runtime/)).toBeInTheDocument();
    const releases = screen.getByRole('region', { name: 'Bản runtime' });
    await within(releases).findByText('0.3.2');
    expect(within(releases).getByText(/mới nhất/)).toBeInTheDocument();
  });

  it('pins a machine to an older release (a rollback), unpins it, and imports new releases from GitHub', async () => {
    const calls = setupRuntime('0.3.1');
    const user = userEvent.setup();
    renderWithApp(<MachinesPage search={{}} />);
    const card = await screen.findByRole('listitem', { name: 'Máy macbook' });
    await within(card).findByText(/ghim bản 0.3.1/);
    const select = within(card).getByRole('combobox', { name: 'Bản runtime cho macbook' });
    await within(select).findByRole('option', { name: /0\.3\.2/ });
    await user.selectOptions(select, '');
    await user.click(within(card).getByRole('button', { name: 'Bỏ ghim' }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')).toMatchObject({
        path: '/v1/machines/00000000-0000-4000-8000-0000000000a1/runtime',
        body: { version: null },
      }),
    );
    await user.selectOptions(select, '0.3.2');
    await user.click(within(card).getByRole('button', { name: 'Ghim bản này' }));
    await waitFor(() =>
      expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ version: '0.3.2' }),
    );

    await user.click(screen.getByRole('button', { name: 'Nhập bản mới từ GitHub' }));
    await screen.findByText('Đã nhập runtime 0.3.3');
  });
});
