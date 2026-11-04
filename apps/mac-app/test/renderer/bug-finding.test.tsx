// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BugFindingView } from '../../src/main/bug-finding/state';
import { ROUTES } from '../../src/renderer/app';
import { BugFindingScreen } from '../../src/renderer/routes/bug-finding';

let view: BugFindingView;
let openAnswer: unknown;
let trashAnswer: unknown;
let listener: (() => void) | null;
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'bugFinding:state') return { ok: true, result: view };
  if (channel === 'bugFinding:open') return { ok: true, result: openAnswer };
  if (channel === 'bugFinding:trashStandalone') return { ok: true, result: trashAnswer };
  if (channel === 'bugFinding:syncNow') return { ok: true, result: { written: true, count: 2 } };
  return { ok: true, result: undefined };
});

beforeEach(() => {
  view = {
    installed: true,
    version: '0.2.0',
    running: true,
    pid: 48211,
    heartbeatAgeSec: 12,
    runningReviews: 1,
    waitingReviews: 1,
    standaloneApp: null,
    requests: [
      {
        requestId: 'r-1',
        identifier: 'TPS-650',
        prNumber: 87,
        run: 1,
        state: 'running',
        lanesDone: 4,
        lanesTotal: 7,
        startedAt: '2026-11-04T02:42:00.000Z',
        finishedAt: null,
        verdict: null,
        error: null,
      },
      {
        requestId: 'r-2',
        identifier: 'TPS-640',
        prNumber: 84,
        run: 2,
        state: 'succeeded',
        lanesDone: 7,
        lanesTotal: 7,
        startedAt: '2026-11-04T01:00:00.000Z',
        finishedAt: '2026-11-04T01:40:00.000Z',
        verdict: 'APPROVE',
        error: null,
      },
    ],
    sync: {
      lastSyncAt: '2026-11-04T02:41:00.000Z',
      projects: [
        { crewProjectId: 'p-1', key: 'my-crew', name: 'my-crew', repoPath: '/Volumes/P/my-crew' },
        { crewProjectId: 'p-2', key: 'shop', name: 'Shop', repoPath: '/Volumes/P/shop' },
      ],
    },
  };
  openAnswer = { ok: true };
  trashAnswer = { ok: true, message: 'Đã chuyển bản cài riêng vào Thùng rác (khôi phục được)' };
  listener = null;
  (window as unknown as { crew: unknown }).crew = {
    invoke,
    on: (l: () => void) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
});
afterEach(() => {
  cleanup();
  invoke.mockClear();
  vi.useRealTimers();
});

it('route bug-finding nằm ngay sau Project trên thanh bên', () => {
  const ids = ROUTES.map((r) => r.id);
  expect(ids.indexOf('bug-finding')).toBe(ids.indexOf('projects') + 1);
  const route = ROUTES.find((r) => r.id === 'bug-finding');
  expect(route?.label).toBe('Bug Finding');
  render(<div>{route?.render()}</div>);
  expect(screen.getByRole('heading', { name: 'Bug Finding' })).toBeTruthy();
});

it('hiện trạng thái app, hàng đợi, tín hiệu và bảng MR do Crew xếp', async () => {
  render(<BugFindingScreen />);
  await waitFor(() => expect(screen.getByText('pid 48211')).toBeTruthy());
  expect(screen.getByText('Đang chạy')).toBeTruthy();
  expect(screen.getByText('1 đang review, 1 đang chờ')).toBeTruthy();
  expect(screen.getByText('Đã nhận tín hiệu 12 giây trước')).toBeTruthy();
  expect(screen.getByText('Không có')).toBeTruthy();
  expect(screen.getByText('TPS-650')).toBeTruthy();
  expect(screen.getByText('#87')).toBeTruthy();
  expect(screen.getByText('Đang review')).toBeTruthy();
  expect(screen.getByText('4/7 lane xong')).toBeTruthy();
  expect(screen.getByText('2 (chạy lại)')).toBeTruthy();
  expect(screen.getByText('APPROVE')).toBeTruthy();
});

it('"Mở Bug Finding" gọi bugFinding:open; bản riêng đang chạy thì báo thoát trước', async () => {
  openAnswer = { ok: false, reason: 'standalone_running' };
  render(<BugFindingScreen />);
  await waitFor(() => expect(screen.getByText('pid 48211')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Mở Bug Finding' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('bugFinding:open'));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Thoát Bug Finding (bản cài riêng) trước'),
  );
});

it('chưa có app thì báo và tắt nút mở', async () => {
  view = { ...view, installed: false, version: null, running: false, pid: null, heartbeatAgeSec: null };
  render(<BugFindingScreen />);
  await waitFor(() => expect(screen.getByText(/Không tìm thấy app Bug Finding/)).toBeTruthy());
  expect((screen.getByRole('button', { name: 'Mở Bug Finding' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Không chạy')).toBeTruthy();
});

it('bản cài riêng còn: hiện đường dẫn, nút chuyển vào Thùng rác gọi bugFinding:trashStandalone', async () => {
  view = { ...view, standaloneApp: { path: '/Applications/Bug Finding.app', running: false } };
  render(<BugFindingScreen />);
  await waitFor(() => expect(screen.getByText('Còn /Applications/Bug Finding.app')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Chuyển vào Thùng rác' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('bugFinding:trashStandalone'));
  await waitFor(() =>
    expect(screen.getByText('Đã chuyển bản cài riêng vào Thùng rác (khôi phục được)')).toBeTruthy(),
  );
});

it('bản cài riêng đang chạy thì cảnh báo thoát trước', async () => {
  view = { ...view, standaloneApp: { path: '/Applications/Bug Finding.app', running: true } };
  render(<BugFindingScreen />);
  await waitFor(() => expect(screen.getByText(/Bug Finding bản cài riêng .* đang chạy/)).toBeTruthy());
});

it('nghe state:changed và gọi lại state mỗi 10 giây khi đang mở', async () => {
  vi.useFakeTimers();
  render(<BugFindingScreen />);
  const calls = () => invoke.mock.calls.filter(([c]) => c === 'bugFinding:state').length;
  await act(async () => {
    await Promise.resolve();
  });
  expect(calls()).toBe(1);
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  expect(calls()).toBe(2);
  await act(async () => {
    listener?.();
  });
  expect(calls()).toBe(3);
  cleanup();
  await act(async () => {
    vi.advanceTimersByTime(30_000);
  });
  expect(calls()).toBe(3);
});

it('đồng bộ project: số project, giờ lần cuối theo giờ Việt Nam và bảng project Crew ↔ repo trên máy', async () => {
  render(<BugFindingScreen />);
  await waitFor(() => expect(screen.getByText('Đã đồng bộ 2 project')).toBeTruthy());
  expect(screen.getByText(/lần cuối 09:41:00 04\/11/)).toBeTruthy();
  const table = screen.getByRole('table', { name: 'Project Crew ↔ Bug Finding' });
  expect(table.textContent).toContain('my-crew');
  expect(table.textContent).toContain('/Volumes/P/shop');
});

it('chưa đồng bộ thì báo chưa có project; "Đồng bộ lại" gọi bugFinding:syncNow', async () => {
  view = { ...view, sync: { lastSyncAt: null, projects: [] } };
  render(<BugFindingScreen />);
  await waitFor(() => expect(screen.getByText('Chưa đồng bộ')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Đồng bộ lại' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('bugFinding:syncNow'));
  await waitFor(() => expect(screen.getByText('Đã đồng bộ 2 project')).toBeTruthy());
});
