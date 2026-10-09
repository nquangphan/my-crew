// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { formatTime, HealthScreen } from '../../src/renderer/routes/health';
import { LogsScreen } from '../../src/renderer/routes/logs';
import { agentName, elapsed, RunsScreen } from '../../src/renderer/routes/runs';

const answers: Record<string, unknown> = {};
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => ({
  ok: true,
  result: answers[channel],
}));

beforeEach(() => {
  window.location.hash = '';
  for (const key of Object.keys(answers)) delete answers[key];
  (window as unknown as { crew: unknown }).crew = { invoke, on: () => () => undefined };
});
afterEach(() => {
  cleanup();
  invoke.mockClear();
});

it('check fail hiện chữ LỖI, chi tiết và gợi ý', async () => {
  answers['health:last'] = {
    at: '2026-10-09T06:00:00.000Z',
    results: [
      {
        id: 'sshd-agent',
        title: 'sshd agent',
        status: 'fail',
        detail: 'cổng 2222 không nghe',
        hint: 'Chạy lại cài đặt',
      },
      { id: 'node', title: 'Node', status: 'ok', detail: 'v24' },
    ],
  };
  render(<HealthScreen />);
  await waitFor(() => expect(screen.getByText('LỖI')).toBeTruthy());
  expect(screen.getByText('ĐẠT')).toBeTruthy();
  expect(screen.getByText('cổng 2222 không nghe')).toBeTruthy();
  expect(screen.getByText('Gợi ý: Chạy lại cài đặt')).toBeTruthy();
  expect(screen.getByText('Kiểm lúc 13:00:00 09/10 (giờ Việt Nam)')).toBeTruthy();
});

it('nút hành động theo id: sshd-agent về wizard, tcc-pending mở quyền, còn lại mở Terminal', async () => {
  answers['health:last'] = {
    at: '2026-10-09T06:00:00.000Z',
    results: [
      { id: 'sshd-agent', title: 'A', status: 'fail', detail: '' },
      { id: 'tcc-pending', title: 'B', status: 'warn', detail: '' },
      { id: 'khac', title: 'C', status: 'fail', detail: '' },
    ],
  };
  render(<HealthScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mở quyền macOS' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Mở quyền macOS' }));
  expect(invoke).toHaveBeenCalledWith('health:action', 'open-privacy');
  fireEvent.click(screen.getByRole('button', { name: 'Mở Terminal' }));
  expect(invoke).toHaveBeenCalledWith('health:action', 'open-terminal');
  fireEvent.click(screen.getByRole('button', { name: 'Chạy lại cài đặt' }));
  expect(window.location.hash).toBe('#/setup');
});

it('nút "Kiểm lại có thử claude" gọi health:run với probe', async () => {
  answers['health:last'] = null;
  answers['health:run'] = [];
  render(<HealthScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm lại có thử claude' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('health:run', true));
});

it('giờ hiển thị theo Asia/Ho_Chi_Minh', () => {
  expect(formatTime('2026-10-09T17:30:00.000Z')).toBe('00:30:00 10/10');
});

it('tên agent lấy từ thư mục worktree, thời gian đã chạy', () => {
  expect(agentName('/Users/x/work/exec-1/')).toBe('exec-1');
  expect(agentName(null)).toBe('không rõ');
  expect(elapsed(0, 125_000)).toBe('2 phút 5 giây');
  expect(elapsed(0, 3_900_000)).toBe('1 giờ 5 phút');
});

it('màn hình run: bảng, mở web và hủy có xác nhận', async () => {
  answers['runs:list'] = [
    { pid: 1, runId: 'run-abc', worktree: '/w/exec-1', startedAt: Date.now(), children: 2 },
  ];
  answers['runs:cancel'] = { ok: true, message: 'Đã gửi lệnh hủy, Paperclip sẽ dừng run.' };
  answers['runs:openWeb'] = { ok: true, message: 'Đã mở run trên web.' };
  const confirm = vi.spyOn(window, 'confirm');
  render(<RunsScreen />);
  await waitFor(() => expect(screen.getByText('run-abc')).toBeTruthy());
  expect(screen.getByText('exec-1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Mở trên web' }));
  expect(invoke).toHaveBeenCalledWith('runs:openWeb', 'run-abc');
  confirm.mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: 'Hủy run' }));
  expect(invoke).not.toHaveBeenCalledWith('runs:cancel', 'run-abc');
  confirm.mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: 'Hủy run' }));
  expect(invoke).toHaveBeenCalledWith('runs:cancel', 'run-abc');
  await waitFor(() => expect(screen.getByText('Đã gửi lệnh hủy, Paperclip sẽ dừng run.')).toBeTruthy());
  confirm.mockRestore();
});

it('màn hình log: lọc run id và mở Finder', async () => {
  answers['logs:tail'] = ['dòng 1', 'dòng 2'];
  answers['logs:reveal'] = undefined;
  render(<LogsScreen />);
  await waitFor(() => expect(screen.getByText(/dòng 1/)).toBeTruthy());
  expect(invoke).toHaveBeenCalledWith('logs:tail', 'app', 500, undefined);
  fireEvent.change(screen.getByPlaceholderText('dán run id'), { target: { value: 'run-abc' } });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('logs:tail', 'app', 500, 'run-abc'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sshd' } });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('logs:tail', 'sshd', 500, 'run-abc'));
  fireEvent.click(screen.getByRole('button', { name: 'Mở trong Finder' }));
  expect(invoke).toHaveBeenCalledWith('logs:reveal', 'sshd');
});
