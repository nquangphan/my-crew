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

const PICKED = {
  folder: '/Volumes/CORSAIR/Projects/2ps-landing',
  name: '2ps-landing',
  key: 'p-2ps-landing',
  problem: null,
};

it('Chọn folder: mở hộp thoại ở Main, hiện đường dẫn, gợi ý tên và khóa (sửa được); khóa sai thì khóa nút', async () => {
  handlers['projects:pickFolder'] = () => PICKED;
  await openForm();
  const start = screen.getByRole('button', { name: 'Bắt đầu thêm' }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  expect(screen.queryByLabelText('URL git (origin)')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Chọn folder' }));
  expect(await screen.findByText('/Volumes/CORSAIR/Projects/2ps-landing')).toBeTruthy();
  expect((screen.getByLabelText('Tên project') as HTMLInputElement).value).toBe('2ps-landing');
  expect((screen.getByLabelText('Khóa') as HTMLInputElement).value).toBe('p-2ps-landing');
  expect(start.disabled).toBe(false);
  fill('Khóa', 'Sai Khoa');
  expect(start.disabled).toBe(true);
  expect(screen.getByText(/Khóa chỉ gồm chữ thường/)).toBeTruthy();
  fill('Khóa', 'landing');
  expect(start.disabled).toBe(false);
});

it('folder không dùng được thì hiện lý do và khóa nút', async () => {
  handlers['projects:pickFolder'] = () => ({
    folder: '/Users/o/Projects/landing/docs',
    name: 'docs',
    key: 'docs',
    problem: 'là thư mục con của repo /Users/o/Projects/landing',
  });
  await openForm();
  fireEvent.click(screen.getByRole('button', { name: 'Chọn folder' }));
  expect(await screen.findByText(/thư mục con của repo/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Bắt đầu thêm' }) as HTMLButtonElement).disabled).toBe(true);
});

it('gửi đúng dữ liệu với số executor đã chọn', async () => {
  handlers['projects:pickFolder'] = () => PICKED;
  handlers['projects:add'] = () => ({
    key: 'landing',
    folder: PICKED.folder,
    projectId: 'p1',
    done: ['check'],
    agents: {},
    error: null,
  });
  await openForm();
  fireEvent.click(screen.getByRole('button', { name: 'Chọn folder' }));
  await screen.findByText(PICKED.folder);
  fill('Tên project', 'Landing');
  fill('Khóa', 'landing');
  fireEvent.click(screen.getByLabelText('2 executor'));
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu thêm' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('projects:add', {
      folder: PICKED.folder,
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
        folder: '/Volumes/CORSAIR/Projects/landing',
        projectId: 'p1',
        done: ['folder', 'project'],
        agents: {
          'executor-1': { agentId: null, environmentId: null, checkout: '/c' },
          'executor-2': { agentId: null, environmentId: null, checkout: '/d' },
        },
        error: 'addStatusRepo hỏng',
      },
    }),
  ];
  handlers['projects:add'] = () => rows[0]?.progress;
  render(<ProjectsScreen />);
  expect(await screen.findByText('addStatusRepo hỏng')).toBeTruthy();
  expect(screen.getByText(/Đang ở bước: Đăng ký repo ảnh chụp docs/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Chạy tiếp' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('projects:add', {
      folder: '/Volumes/CORSAIR/Projects/landing',
      name: 'Landing',
      key: 'landing',
      executors: 2,
    }),
  );
});

it('tiến độ kiểu cũ (URL git) không có Chạy tiếp, báo cần gỡ rồi thêm lại; vẫn gỡ được', async () => {
  rows = [
    row({
      onMac: false,
      checkouts: [],
      docsRepo: null,
      progress: {
        key: 'landing',
        origin: 'git@github.com:x/landing.git',
        projectId: 'p1',
        done: ['ls-remote', 'mirror', 'project'],
        agents: {},
        error: 'git clone thất bại',
      },
    }),
  ];
  render(<ProjectsScreen />);
  expect(await screen.findByText(/bản cũ/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Chạy tiếp' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Gỡ khỏi Mac' })).toBeTruthy();
});

it('Gỡ khỏi Mac hỏi xác nhận rồi hiện lệnh xóa thư mục', async () => {
  rows = [row()];
  handlers['projects:remove'] = () => ({
    removed: ['agent landing-executor-1 đã pause'],
    manualCommand:
      'git -C /Volumes/CORSAIR/Projects/landing worktree remove /h/crew-agents/landing/executor-1',
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<ProjectsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Gỡ khỏi Mac' }));
  expect(invoke).not.toHaveBeenCalledWith('projects:remove', 'p1');
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Gỡ khỏi Mac' }));
  expect(
    await screen.findByText(
      'git -C /Volumes/CORSAIR/Projects/landing worktree remove /h/crew-agents/landing/executor-1',
    ),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Chép lệnh' })).toBeTruthy();
});

it('stepLabel dịch tên bước', () => {
  expect(stepLabel('role:reviewer')).toBe('Tạo agent reviewer');
  expect(stepLabel('check')).toBe('Kiểm tra cuối');
  expect(stepLabel('folder')).toBe('Kiểm folder và đặt crew-docs');
});
