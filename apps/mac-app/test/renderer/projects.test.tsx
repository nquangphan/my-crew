// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectsScreen, stepLabel } from '../../src/renderer/routes/projects';
import type { ProjectRow } from '../../src/shared/ipc-contract';

let rows: ProjectRow[] = [];
const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
  try {
    const fn = handlers[channel];
    return { ok: true, result: fn ? await fn(...args) : rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

beforeEach(() => {
  rows = [];
  for (const k of Object.keys(handlers)) delete handlers[k];
  handlers['projects:list'] = () => rows;
  (window as unknown as { crew: unknown }).crew = { invoke, on: () => () => undefined };
});
afterEach(() => {
  cleanup();
  invoke.mockClear();
});

const row = (over: Partial<ProjectRow> = {}): ProjectRow => ({
  projectId: 'p1',
  name: 'Landing',
  onMac: true,
  checkouts: [{ role: 'executor-1', path: '/h/crew-agents/landing/executor-1', head: 'abc1234' }],
  docsRepo: '/h/crew-projects/landing',
  lastSentCommit: 'a'.repeat(40),
  progress: null,
  ...over,
});

async function openForm() {
  render(<ProjectsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm project' }));
}
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

it('liệt kê project với checkout, head, repo docs và commit gửi cuối', async () => {
  rows = [row()];
  render(<ProjectsScreen />);
  expect(await screen.findByText('Landing')).toBeTruthy();
  expect(screen.getByText('executor-1')).toBeTruthy();
  expect(screen.getByText('abc1234')).toBeTruthy();
  expect(screen.getByText('/h/crew-projects/landing')).toBeTruthy();
  expect(screen.getByText('aaaaaaa')).toBeTruthy();
});

it('khóa sai dạng thì nút Bắt đầu bị khóa kèm lý do', async () => {
  await openForm();
  fill('URL git (origin)', 'git@github.com:x/landing.git');
  fill('Tên project', 'Landing');
  fill('Khóa', 'Sai Khoa');
  const start = screen.getByRole('button', { name: 'Bắt đầu thêm' }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  expect(screen.getByText(/Khóa chỉ gồm chữ thường/)).toBeTruthy();
  fill('Khóa', 'landing');
  expect(start.disabled).toBe(false);
});

it('gửi đúng dữ liệu với số executor đã chọn', async () => {
  handlers['projects:add'] = () => ({
    key: 'landing',
    origin: 'o',
    projectId: 'p1',
    done: ['check'],
    agents: {},
    error: null,
  });
  await openForm();
  fill('URL git (origin)', 'git@github.com:x/landing.git');
  fill('Tên project', 'Landing');
  fill('Khóa', 'landing');
  fireEvent.click(screen.getByLabelText('2 executor'));
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu thêm' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('projects:add', {
      origin: 'git@github.com:x/landing.git',
      name: 'Landing',
      key: 'landing',
      executors: 2,
    }),
  );
});

it('tiến độ lỗi hiện bước hiện tại, message và Chạy tiếp gọi lại cùng dữ liệu', async () => {
  rows = [
    row({
      projectId: 'p1',
      onMac: false,
      checkouts: [],
      progress: {
        key: 'landing',
        origin: 'git@github.com:x/landing.git',
        projectId: 'p1',
        done: ['ls-remote', 'mirror'],
        agents: {
          'executor-1': { agentId: null, environmentId: null, checkout: '/c' },
          'executor-2': { agentId: null, environmentId: null, checkout: '/d' },
        },
        error: 'git clone thất bại',
      },
    }),
  ];
  handlers['projects:add'] = () => rows[0]?.progress;
  render(<ProjectsScreen />);
  expect(await screen.findByText('git clone thất bại')).toBeTruthy();
  expect(screen.getByText(/Đang ở bước: Tạo project trên Paperclip/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Chạy tiếp' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('projects:add', {
      origin: 'git@github.com:x/landing.git',
      name: 'Landing',
      key: 'landing',
      executors: 2,
    }),
  );
});

it('Gỡ khỏi Mac hỏi xác nhận rồi hiện lệnh xóa thư mục', async () => {
  rows = [row()];
  handlers['projects:remove'] = () => ({
    removed: ['agent landing-executor-1 đã pause'],
    manualCommand: 'rm -rf ~/crew-agents/landing ~/crew-projects/landing',
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<ProjectsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Gỡ khỏi Mac' }));
  expect(invoke).not.toHaveBeenCalledWith('projects:remove', 'p1');
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Gỡ khỏi Mac' }));
  expect(await screen.findByText('rm -rf ~/crew-agents/landing ~/crew-projects/landing')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Chép lệnh' })).toBeTruthy();
});

it('stepLabel dịch tên bước', () => {
  expect(stepLabel('role:reviewer')).toBe('Tạo agent reviewer');
  expect(stepLabel('check')).toBe('Kiểm tra cuối');
});
