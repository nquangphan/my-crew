// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExistingMachine } from '../../src/main/setup/import-existing';
import { SetupScreen } from '../../src/renderer/routes/setup';

type Handler = (...args: unknown[]) => unknown;

let step = 'check';
let origin: string | null = null;
let companyId: string | null = null;
let machine: ExistingMachine = { kind: 'fresh' };
let handlers: Record<string, Handler> = {};
const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
  try {
    if (channel === 'setup:state')
      return {
        ok: true,
        result: { step, paperclipOrigin: origin, companyId, pairedEnvironmentId: null },
      };
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
  companyId = null;
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

const COMPANIES = [
  { id: 'c1', name: 'Crew E2E' },
  { id: 'c2', name: '2P Solutions' },
];

it('máy có sẵn: bấm Ghép máy gửi {} (Main gửi thử trước, chỉ ghép khi server từ chối)', async () => {
  step = 'machine';
  companyId = 'c2';
  handlers['paperclip:companies'] = () => COMPANIES;
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
  expect(await screen.findByText(/gửi thử một bản tin/)).toBeTruthy();
  expect(await screen.findByText('2P Solutions')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ghép máy' }));
  await waitFor(() => expect(stepCalls()).toHaveLength(1));
  expect(stepCalls()[0]).toEqual(['setup:step', 'machine', {}]);
});

it('máy mới: hiện company sẽ ghép, bấm Ghép máy không cần dán gì; dán tay nằm trong khối thu gọn', async () => {
  step = 'machine';
  companyId = 'c2';
  handlers['paperclip:companies'] = () => COMPANIES;
  handlers['setup:step'] = () => ({ ok: true, message: 'Đã ghép máy', next: 'disk-access' });
  render(<SetupScreen />);
  expect(await screen.findByText('2P Solutions')).toBeTruthy();
  expect(screen.getByText(/Ghép vào company/)).toBeTruthy();
  const manual = screen.getByText('Nhập tay (dự phòng)').closest('details') as HTMLDetailsElement;
  expect(manual.open).toBe(false);
  const pair = screen.getByRole('button', { name: 'Ghép máy' }) as HTMLButtonElement;
  expect(pair.disabled).toBe(false);
  fireEvent.click(pair);
  await waitFor(() => expect(stepCalls()).toHaveLength(1));
  expect(stepCalls()[0]).toEqual(['setup:step', 'machine', { port: '2222', worktreeRoot: '' }]);
});

it('server chưa có key Paperclip: mở khối nhập tay; dán key và secret rồi cài, secret bị xóa khỏi ô', async () => {
  step = 'machine';
  handlers['setup:step'] = (_s, input) =>
    (input as { manual?: boolean }).manual
      ? { ok: true, message: 'Đã cài bằng key và secret dán tay', next: 'disk-access' }
      : { ok: false, message: 'Server chưa có key Paperclip', next: 'machine', state: 'manual' };
  render(<SetupScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ghép máy' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Server chưa có key Paperclip');
  const manual = screen.getByText('Nhập tay (dự phòng)').closest('details') as HTMLDetailsElement;
  await waitFor(() => expect(manual.open).toBe(true));
  const install = screen.getByRole('button', { name: 'Cài bằng key và secret đã dán' }) as HTMLButtonElement;
  expect(install.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Key Paperclip/), { target: { value: 'ssh-ed25519 AAAA k' } });
  fireEvent.change(screen.getByLabelText('Secret webhook'), { target: { value: 'bi-mat' } });
  expect(install.disabled).toBe(false);
  fireEvent.click(install);
  await waitFor(() => expect(stepCalls()).toHaveLength(2));
  expect(stepCalls()[1]).toEqual([
    'setup:step',
    'machine',
    {
      manual: true,
      paperclipKey: 'ssh-ed25519 AAAA k',
      webhookSecret: 'bi-mat',
      port: '2222',
      worktreeRoot: '',
    },
  ]);
  await waitFor(() => expect((screen.getByLabelText('Secret webhook') as HTMLInputElement).value).toBe(''));
});

it('máy đã bị gỡ trên web: chỉ khi owner bấm "Ghép lại máy này" mới gửi repair', async () => {
  step = 'machine';
  handlers['setup:step'] = (_s, input) =>
    (input as { repair?: boolean }).repair
      ? { ok: true, message: 'Đã ghép máy', next: 'disk-access' }
      : {
          ok: false,
          message: 'Máy này đã bị gỡ trên web. Bấm Ghép lại nếu muốn dùng lại.',
          next: 'machine',
          state: 'revoked',
        };
  render(<SetupScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ghép máy' }));
  expect(screen.queryByRole('button', { name: 'Ghép lại máy này' })).toBeNull();
  expect((await screen.findByRole('alert')).textContent).toContain('đã bị gỡ trên web');
  expect(stepCalls()[0]?.[2]).not.toHaveProperty('repair');
  fireEvent.click(await screen.findByRole('button', { name: 'Ghép lại máy này' }));
  await waitFor(() => expect(stepCalls()).toHaveLength(2));
  expect(stepCalls()[1]).toEqual(['setup:step', 'machine', { repair: true, port: '2222', worktreeRoot: '' }]);
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
  // Không chọn sẵn company nào: nút Tiếp khóa tới khi owner tự chọn.
  expect(select.value).toBe('');
  expect((screen.getByRole('button', { name: 'Tiếp' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(select, { target: { value: 'c2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp' }));
  await waitFor(() => expect(stepCalls()).toHaveLength(1));
  expect(stepCalls()[0]).toEqual(['setup:step', 'paperclip', { companyId: 'c2' }]);
});

it('đăng nhập Paperclip: máy có sẵn ghi company trong status.json vẫn không được chọn sẵn', async () => {
  step = 'paperclip';
  origin = 'https://crew.example.com';
  machine = {
    kind: 'existing',
    port: 2222,
    worktreeRoot: '/Users/owner/crew-agents',
    statusUrl: 'https://crew.example.com',
    companyId: 'c1',
    hasWebhookSecret: true,
  };
  handlers['paperclip:companies'] = () => COMPANIES;
  render(<SetupScreen />);
  const select = (await screen.findByLabelText('Company')) as HTMLSelectElement;
  await screen.findByRole('option', { name: 'Crew E2E' });
  expect(select.value).toBe('');
  expect((screen.getByRole('button', { name: 'Tiếp' }) as HTMLButtonElement).disabled).toBe(true);
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

it('đã xong: nút Đổi company / Ghép lại máy gọi Main đưa wizard về bước chọn company', async () => {
  step = 'done';
  origin = 'https://crew.2p-solutions.com';
  handlers['setup:reopenMachine'] = () => {
    step = 'paperclip';
    return { step, paperclipOrigin: origin, companyId, pairedEnvironmentId: null };
  };
  handlers['paperclip:loginStatus'] = () => 'approved';
  handlers['paperclip:companies'] = () => COMPANIES;
  render(<SetupScreen />);
  expect(screen.queryByText(/không báo trạng thái/)).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Đổi company / Ghép lại máy' }));
  expect(await screen.findByRole('heading', { name: 'Đăng nhập Paperclip' })).toBeTruthy();
  expect(await screen.findByLabelText('Company')).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith('setup:reopenMachine');
  expect(stepCalls()).toHaveLength(0);
});

it('đã xong: lỗi khi quay về bước company thì báo và giữ nguyên màn hình', async () => {
  step = 'done';
  handlers['setup:reopenMachine'] = () => {
    throw new Error('không ghi được app.json');
  };
  render(<SetupScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Đổi company / Ghép lại máy' }));
  expect((await screen.findByRole('alert')).textContent).toContain('không ghi được app.json');
  expect(screen.getByRole('heading', { name: 'Cài đặt đã xong' })).toBeTruthy();
});

it.each([
  [401, /HTTP 401/],
  [403, /HTTP 403/],
  [502, /HTTP 502/],
  [null, /không gửi được tới server/],
])(
  'đã xong: lần gửi bản tin gần nhất lỗi (%s) thì cảnh báo máy không báo trạng thái',
  async (httpStatus, text) => {
    step = 'done';
    handlers['setup:machineReport'] = () => ({ at: '2026-10-11T08:00:00Z', ok: false, httpStatus });
    render(<SetupScreen />);
    expect((await screen.findByText(/Máy này không báo trạng thái/)).textContent).toMatch(text);
    expect(screen.getAllByRole('button', { name: 'Đổi company / Ghép lại máy' })).toHaveLength(2);
  },
);

it('đã xong: lần gửi gần nhất thành công hoặc chưa có thì không cảnh báo', async () => {
  step = 'done';
  handlers['setup:machineReport'] = () => ({ at: '2026-10-11T08:00:00Z', ok: true, httpStatus: 200 });
  const { unmount } = render(<SetupScreen />);
  await screen.findByRole('button', { name: 'Hoàn tất' });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('setup:machineReport'));
  expect(screen.queryByText(/không báo trạng thái/)).toBeNull();
  unmount();
  handlers['setup:machineReport'] = () => null;
  render(<SetupScreen />);
  await screen.findByRole('button', { name: 'Hoàn tất' });
  expect(screen.queryByText(/không báo trạng thái/)).toBeNull();
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
