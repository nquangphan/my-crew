// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExistingMachine } from '../../src/main/setup/import-existing';
import { SetupScreen } from '../../src/renderer/routes/setup';

type Handler = (...args: unknown[]) => unknown;

let step = 'check';
let origin: string | null = null;
let machine: ExistingMachine = { kind: 'fresh' };
let handlers: Record<string, Handler> = {};
const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
  try {
    if (channel === 'setup:state')
      return { ok: true, result: { step, paperclipOrigin: origin, companyId: null } };
    if (channel === 'setup:detect') return { ok: true, result: machine };
    const handler = handlers[channel];
    return { ok: true, result: handler ? await handler(...args) : undefined };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
});

beforeEach(() => {
  step = 'check';
  origin = null;
  machine = { kind: 'fresh' };
  handlers = {};
  (window as unknown as { crew: unknown }).crew = { invoke, on: () => () => undefined };
});
afterEach(() => {
  cleanup();
  invoke.mockClear();
});

const stepCalls = () => invoke.mock.calls.filter(([channel]) => channel === 'setup:step');

it('hiện danh sách bước, chạy bước hiện tại và nạp lại tiến độ khi xong', async () => {
  handlers['setup:step'] = (s) => {
    step = 'v2';
    return { ok: true, message: `đã xong ${s}`, next: 'v2' };
  };
  render(<SetupScreen />);
  expect(await screen.findByRole('heading', { name: 'Kiểm tra máy' })).toBeTruthy();
  expect(screen.getByRole('list', { name: 'Các bước' }).children).toHaveLength(9);
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));
  expect(await screen.findByRole('heading', { name: 'Gỡ app 2P Crew cũ' })).toBeTruthy();
  expect(screen.getByText('đã xong check')).toBeTruthy();
  expect(stepCalls()[0]).toEqual(['setup:step', 'check', {}]);
});

it('bước lỗi hiện thông báo và giữ nguyên bước', async () => {
  handlers['setup:step'] = () => ({ ok: false, message: 'Mở Tailscale và đăng nhập', next: 'check' });
  render(<SetupScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Mở Tailscale và đăng nhập');
  expect(screen.getByRole('heading', { name: 'Kiểm tra máy' })).toBeTruthy();
});

it('máy có sẵn: ghi "Nhận cài đặt có sẵn" và chỉ có nút Tiếp', async () => {
  step = 'machine';
  machine = {
    kind: 'existing',
    port: 2222,
    worktreeRoot: '/Users/owner/crew-agents',
    statusUrl: 'https://crew.example.com',
    companyId: null,
    hasWebhookSecret: true,
  };
  handlers['setup:step'] = () => ({ ok: true, message: 'ok', next: 'disk-access' });
  render(<SetupScreen />);
  expect(await screen.findByText(/Nhận cài đặt có sẵn/)).toBeTruthy();
  expect(screen.queryByLabelText(/Key Paperclip/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp' }));
  await waitFor(() => expect(stepCalls()).toHaveLength(1));
  expect(stepCalls()[0]).toEqual(['setup:step', 'machine', {}]);
});

it('máy mới: cần key và secret mới bấm được, gửi đủ ô nhập', async () => {
  step = 'machine';
  handlers['setup:step'] = () => ({ ok: true, message: 'Đã cài', next: 'disk-access' });
  render(<SetupScreen />);
  const install = (await screen.findByRole('button', { name: 'Cài đặt' })) as HTMLButtonElement;
  expect(install.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Key Paperclip/), { target: { value: 'ssh-ed25519 AAAA k' } });
  fireEvent.change(screen.getByLabelText('Secret webhook'), { target: { value: 'bi-mat' } });
  expect(install.disabled).toBe(false);
  fireEvent.click(install);
  await waitFor(() => expect(stepCalls()).toHaveLength(1));
  expect(stepCalls()[0]).toEqual([
    'setup:step',
    'machine',
    { paperclipKey: 'ssh-ed25519 AAAA k', webhookSecret: 'bi-mat', port: '2222', worktreeRoot: '' },
  ]);
  await waitFor(() => expect((screen.getByLabelText('Secret webhook') as HTMLInputElement).value).toBe(''));
});

it('manifest hỏng: hiện thông báo và nút kiểm tra lại', async () => {
  step = 'machine';
  machine = { kind: 'broken', message: 'manifest hỏng; xóa file rồi chạy lại' };
  render(<SetupScreen />);
  expect((await screen.findByRole('alert')).textContent).toContain('manifest hỏng');
  machine = { kind: 'fresh' };
  fireEvent.click(screen.getByRole('button', { name: 'Đã xử lý, kiểm tra lại' }));
  expect(await screen.findByLabelText(/Key Paperclip/)).toBeTruthy();
});

it('quyền ổ đĩa: dò lúc mở và mỗi lần cửa sổ focus lại, nút mở đúng pane', async () => {
  step = 'disk-access';
  let granted = false;
  handlers['setup:step'] = (_s, input) =>
    (input as { recheck?: boolean }).recheck
      ? { ok: granted, message: granted ? 'Đã cấp quyền ổ đĩa' : 'Chưa cấp quyền ổ đĩa', next: 'disk-access' }
      : { ok: true, message: 'Đi tiếp', next: 'sshd' };
  render(<SetupScreen />);
  expect(await screen.findByText('Chưa cấp quyền ổ đĩa')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Tiếp' }) as HTMLButtonElement).disabled).toBe(true);
  granted = true;
  fireEvent(window, new Event('focus'));
  expect(await screen.findByText('Đã cấp quyền ổ đĩa')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Mở Cài đặt hệ thống' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('health:action', 'open-privacy'));
  step = 'sshd';
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp' }));
  expect(await screen.findByRole('heading', { name: 'Chuyển sshd sang 2P Crew' })).toBeTruthy();
});

it('bước sshd: nút khóa và giải thích khi chưa cấp quyền ổ đĩa, mở khi đã cấp', async () => {
  step = 'sshd';
  let granted = false;
  handlers['setup:step'] = (s, input) =>
    s === 'disk-access' && (input as { recheck?: boolean }).recheck
      ? { ok: granted, message: granted ? 'Đã cấp quyền ổ đĩa' : 'Chưa cấp quyền ổ đĩa', next: 'disk-access' }
      : { ok: true, message: 'đã chuyển', next: 'doctor' };
  render(<SetupScreen />);
  const button = (await screen.findByRole('button', { name: 'Chuyển sshd' })) as HTMLButtonElement;
  expect(await screen.findByText(/Chưa cấp quyền ổ đĩa/)).toBeTruthy();
  expect(button.disabled).toBe(true);
  granted = true;
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(button.disabled).toBe(false));
});

it('chuyển sshd thất bại hiện lý do và thông báo đã tự lui', async () => {
  step = 'sshd';
  handlers['setup:step'] = (s) =>
    s === 'disk-access'
      ? { ok: true, message: 'Đã cấp quyền ổ đĩa', next: 'disk-access' }
      : {
          ok: false,
          message: 'Listener không lên.\nĐã tự chuyển sshd về LaunchAgent như cũ.',
          next: 'sshd',
        };
  render(<SetupScreen />);
  const button = (await screen.findByRole('button', { name: 'Chuyển sshd' })) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  expect((await screen.findByRole('alert')).textContent).toContain('Đã tự chuyển sshd về LaunchAgent');
});

it('đăng nhập Paperclip: mở trình duyệt, chờ duyệt, chọn company rồi tiếp', async () => {
  step = 'paperclip';
  handlers['paperclip:login'] = () => ({ approvalUrl: 'https://crew.2p-solutions.com/cli-auth/x' });
  handlers['paperclip:loginStatus'] = () => 'approved';
  handlers['paperclip:companies'] = () => [
    { id: 'c1', name: 'TPS' },
    { id: 'c2', name: 'Khác' },
  ];
  handlers['setup:step'] = () => ({ ok: true, message: 'Đã chọn company Khác.', next: 'machine' });
  render(<SetupScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập' }));
  expect(invoke).toHaveBeenCalledWith('paperclip:login', 'https://crew.2p-solutions.com');
  const select = (await screen.findByLabelText('Company')) as HTMLSelectElement;
  // Ô Company hiện ngay khi duyệt xong, danh sách company về sau: chờ có lựa chọn mới đổi.
  await screen.findByRole('option', { name: 'Khác' });
  fireEvent.change(select, { target: { value: 'c2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp' }));
  await waitFor(() => expect(stepCalls()).toHaveLength(1));
  expect(stepCalls()[0]).toEqual(['setup:step', 'paperclip', { companyId: 'c2' }]);
});

it('đã xong: Hoàn tất bật mở cùng máy và có nút chạy lại bước', async () => {
  step = 'done';
  handlers['setup:step'] = (s) => ({ ok: true, message: `chạy ${s}`, next: s });
  render(<SetupScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Hoàn tất' }));
  expect(await screen.findByText('chạy done')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Chuyển sshd sang 2P Crew' }));
  expect(await screen.findByText('chạy sshd')).toBeTruthy();
});

it('đã xong: có nút Đăng nhập lại Paperclip chạy luồng cli-auth với origin đã lưu', async () => {
  step = 'done';
  origin = 'https://crew.2p-solutions.com';
  handlers['paperclip:login'] = () => ({ approvalUrl: 'https://crew.2p-solutions.com/cli-auth/abc' });
  handlers['paperclip:loginStatus'] = () => 'approved';
  render(<SetupScreen />);
  expect(await screen.findByText(/https:\/\/crew\.2p-solutions\.com/)).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập lại' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('paperclip:login', 'https://crew.2p-solutions.com'),
  );
  expect(await screen.findByText(/Đã đăng nhập lại/)).toBeTruthy();
});

const v2Found = {
  appPath: '/Applications/2P Crew.app',
  bundleId: 'com.2p-solutions.crew',
  isV2: true,
  running: false,
  isSelf: false,
};
const v2None = { appPath: null, bundleId: null, isV2: false, running: false, isSelf: false };

it('bước gỡ app cũ: có app v2 thì chỉ gửi các việc owner tích, ghi rõ dữ liệu cũ được giữ', async () => {
  step = 'v2';
  let detection: unknown = v2Found;
  handlers['setup:v2Detect'] = () => detection;
  handlers['setup:step'] = () => {
    detection = v2None;
    return { ok: true, message: 'Đã chuyển app 2P Crew cũ vào Thùng rác', next: 'v2' };
  };
  render(<SetupScreen />);
  expect(await screen.findByText(/dữ liệu cũ.*giữ nguyên/)).toBeTruthy();
  fireEvent.click(await screen.findByLabelText(/Xóa quyền macOS/));
  fireEvent.click(screen.getByRole('button', { name: 'Gỡ các mục đã chọn' }));
  await waitFor(() => expect(stepCalls()).toHaveLength(1));
  expect(stepCalls()[0]).toEqual(['setup:step', 'v2', { confirm: ['login-item', 'trash'] }]);
  // Xong thì dò lại, không còn app cũ: hiện Tiếp.
  expect(await screen.findByRole('button', { name: 'Tiếp' })).toBeTruthy();
  expect((await screen.findAllByText(/Thùng rác/)).length).toBeGreaterThan(0);
});

it('bước gỡ app cũ: không có app cũ thì chỉ có Tiếp', async () => {
  step = 'v2';
  handlers['setup:v2Detect'] = () => v2None;
  handlers['setup:step'] = () => ({ ok: true, message: 'ok', next: 'move' });
  render(<SetupScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp' }));
  await waitFor(() => expect(stepCalls()).toHaveLength(1));
  expect(stepCalls()[0]).toEqual(['setup:step', 'v2', {}]);
  expect(screen.queryByRole('button', { name: 'Gỡ các mục đã chọn' })).toBeNull();
});

it('bước gỡ app cũ: app cũ đang chạy thì nhờ thoát, không cho gỡ', async () => {
  step = 'v2';
  handlers['setup:v2Detect'] = () => ({ ...v2Found, running: true });
  render(<SetupScreen />);
  expect(await screen.findByText(/Thoát app 2P Crew cũ/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Gỡ các mục đã chọn' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
});

it('bước gỡ app cũ: nút mở đúng trang Mục đăng nhập', async () => {
  step = 'v2';
  handlers['setup:v2Detect'] = () => v2Found;
  render(<SetupScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Mở Mục đăng nhập' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('health:action', 'open-login-items'));
});

it('bước chuyển vào Applications: chỉ chuyển sau khi bấm nút xác nhận', async () => {
  step = 'move';
  handlers['setup:step'] = () => ({ ok: true, message: 'Đã chuyển', next: 'paperclip' });
  render(<SetupScreen />);
  const button = await screen.findByRole('button', { name: 'Chuyển vào Applications' });
  expect(stepCalls()).toHaveLength(0);
  fireEvent.click(button);
  await waitFor(() => expect(stepCalls()).toHaveLength(1));
  expect(stepCalls()[0]).toEqual(['setup:step', 'move', { confirm: true }]);
});
