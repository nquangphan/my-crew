// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UPDATE_STATES } from '../../../crew-mac/src/status/app-state';
import { ROUTES } from '../../src/renderer/app';
import { UPDATE_STATE_LABEL, UpdateScreen } from '../../src/renderer/routes/update';
import type { UpdateView } from '../../src/shared/ipc-contract';

let view: UpdateView;
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'update:state') return { ok: true, result: view };
  if (channel === 'update:rollback') return { ok: false, error: 'Chưa có bản trước' };
  return { ok: true, result: undefined };
});

beforeEach(() => {
  view = {
    current: '0.1.0',
    available: null,
    state: 'idle',
    previous: null,
    enabled: true,
    reason: null,
    lastCheckedAt: '2026-10-09T06:00:00.000Z',
  };
  (window as unknown as { crew: unknown }).crew = { invoke, on: () => () => undefined };
});
afterEach(() => {
  cleanup();
  invoke.mockClear();
});

it('route update là màn hình thật', () => {
  const route = ROUTES.find((r) => r.id === 'update');
  expect(route?.label).toBe('Cập nhật');
  render(<div>{route?.render()}</div>);
  expect(screen.getByRole('heading', { name: 'Cập nhật' })).toBeTruthy();
});

it('nhãn trạng thái tiếng Việt khớp thẻ máy trên web', () => {
  expect(UPDATE_STATE_LABEL).toEqual({
    idle: 'Đã cập nhật',
    downloading: 'Đang tải bản mới',
    'waiting-idle': 'Chờ máy rảnh để cài',
    installing: 'Đang cài',
    probation: 'Đang thử bản mới',
    'rolled-back': 'Đã quay về bản trước',
  });
});

it('mọi trạng thái app ghi đều thuộc bộ crew-mac gửi được (giá trị lạ làm thẻ máy bỏ trường app)', () => {
  expect(Object.keys(UPDATE_STATE_LABEL).sort()).toEqual([...UPDATE_STATES].sort());
});

it('hiện bản đang chạy, bản mới, bản trước, giờ kiểm theo giờ Việt Nam', async () => {
  view = { ...view, available: '0.1.1', state: 'waiting-idle', previous: '0.0.9' };
  render(<UpdateScreen />);
  await waitFor(() => expect(screen.getByText('0.1.1')).toBeTruthy());
  expect(screen.getByText('0.1.0')).toBeTruthy();
  expect(screen.getByText('0.0.9')).toBeTruthy();
  expect(screen.getByText('Chờ máy rảnh để cài')).toBeTruthy();
  expect(screen.getByText('13:00:00 09/10')).toBeTruthy();
  const install = screen.getByRole('button', { name: 'Cài khi rảnh' }) as HTMLButtonElement;
  expect(install.disabled).toBe(false);
  fireEvent.click(install);
  expect(invoke).toHaveBeenCalledWith('update:installWhenIdle');
});

it('"Kiểm ngay" gọi update:check; "Cài khi rảnh" tắt khi chưa có bản đã tải', async () => {
  render(<UpdateScreen />);
  await waitFor(() => expect(screen.getByText('Đã cập nhật')).toBeTruthy());
  expect((screen.getByRole('button', { name: 'Cài khi rảnh' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm ngay' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('update:check'));
});

it('chưa có bản trước thì nút quay lui tắt', async () => {
  render(<UpdateScreen />);
  await waitFor(() => expect(screen.getByText('Chưa có')).toBeTruthy());
  expect((screen.getByRole('button', { name: 'Quay về bản trước' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it('updater tắt: hiện lý do, nút Kiểm ngay tắt', async () => {
  view = { ...view, enabled: false, reason: 'Bản này không ký Developer ID, cập nhật tự động tắt' };
  render(<UpdateScreen />);
  await waitFor(() =>
    expect(screen.getByText('Bản này không ký Developer ID, cập nhật tự động tắt')).toBeTruthy(),
  );
  expect((screen.getByRole('button', { name: 'Kiểm ngay' }) as HTMLButtonElement).disabled).toBe(true);
});

it('quay lui lỗi thì hiện thông báo của Main', async () => {
  view = { ...view, previous: '0.0.9' };
  render(<UpdateScreen />);
  await waitFor(() => expect(screen.getByText('0.0.9')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Quay về bản trước' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Chưa có bản trước'));
});
