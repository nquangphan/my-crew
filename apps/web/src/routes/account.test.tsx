import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../lib/api-client';
import { keys } from '../lib/queries';
import { mockFetch, renderWithApp } from '../test/render';
import { ChangePasswordForm, PASSWORD_CHANGED_TEXT } from './account';

const CURRENT = 'correct horse battery staple';
const NEXT = 'a brand new passphrase 42';
const rotated = { owner: { username: 'owner' }, csrfToken: 'csrf-rotated', recoveryCodesLeft: 10 };
const rejected = {
  status: 401,
  body: { error: { code: 'UNAUTHORIZED', message: 'invalid password or verification code' } },
};

afterEach(() => setCsrfToken(null));

type User = ReturnType<typeof userEvent.setup>;

async function fill(
  user: User,
  values: { current?: string; code?: string; next?: string; confirm?: string },
) {
  const field = (label: string) => screen.getByLabelText(label, { exact: true });
  await screen.findByLabelText('Mật khẩu hiện tại');
  for (const [label, value] of [
    ['Mật khẩu hiện tại', values.current],
    ['Mã TOTP', values.code],
    ['Mật khẩu mới', values.next],
    ['Nhập lại mật khẩu mới', values.confirm],
  ] as const) {
    await user.clear(field(label));
    if (value) await user.type(field(label), value);
  }
}

const submit = (user: User) => user.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));

describe('ChangePasswordForm', () => {
  it('checks length, match and difference locally, without calling the API', async () => {
    const calls = mockFetch([]);
    const user = userEvent.setup();
    renderWithApp(<ChangePasswordForm />);

    await fill(user, { current: CURRENT, code: '12345', next: 'too short', confirm: 'too short' });
    await submit(user);
    expect(await screen.findByText('Mã TOTP gồm 6 chữ số.')).toBeInTheDocument();
    expect(screen.getByText('Mật khẩu mới cần ít nhất 12 ký tự.')).toBeInTheDocument();

    await fill(user, { current: CURRENT, code: '123456', next: NEXT, confirm: `${NEXT}x` });
    await submit(user);
    expect(await screen.findByText('Mật khẩu nhập lại không khớp.')).toBeInTheDocument();

    await fill(user, { current: CURRENT, code: '123456', next: CURRENT, confirm: CURRENT });
    await submit(user);
    expect(await screen.findByText('Mật khẩu mới phải khác mật khẩu hiện tại.')).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu mới', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    expect(calls).toHaveLength(0);
  });

  it('changes the password, takes over the rotated CSRF token and confirms with a toast', async () => {
    const calls = mockFetch([
      ['POST /v1/auth/password', () => ({ body: rotated })],
      ['POST /v1/auth/logout', () => ({ status: 204 })],
    ]);
    const user = userEvent.setup();
    const { queryClient } = renderWithApp(<ChangePasswordForm />);
    await fill(user, { current: CURRENT, code: '123456', next: NEXT, confirm: NEXT });
    await submit(user);

    expect(await screen.findByText(PASSWORD_CHANGED_TEXT)).toBeInTheDocument();
    expect(PASSWORD_CHANGED_TEXT).toBe('Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị đăng xuất.');
    expect(calls[0]?.body).toEqual({ currentPassword: CURRENT, newPassword: NEXT, code: '123456' });
    expect(queryClient.getQueryData(keys.session)).toEqual(rotated);
    expect(screen.getByLabelText('Mật khẩu mới', { exact: true })).toHaveValue('');

    // The next mutating request carries the rotated token.
    const { api } = await import('../lib/api-client');
    await api.logout();
    expect(calls.at(-1)?.headers['x-csrf-token']).toBe('csrf-rotated');
  });

  it('shows a generic error on a wrong password or code and keeps the owner signed in', async () => {
    const calls = mockFetch([
      ['POST /v1/auth/password', () => rejected],
      ['GET /v1/auth/session', () => ({ body: { ...rotated, csrfToken: 'csrf-1' } })],
    ]);
    const user = userEvent.setup();
    const { router } = renderWithApp(<ChangePasswordForm />);
    await fill(user, { current: 'wrong password!', code: '123456', next: NEXT, confirm: NEXT });
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Mật khẩu hiện tại hoặc mã TOTP không đúng. Nếu vừa dùng mã này, đợi mã mới rồi thử lại.',
    );
    expect(screen.getByLabelText('Mã TOTP')).toHaveValue('');
    await vi.waitFor(() => expect(calls.some((c) => c.path === '/v1/auth/session')).toBe(true));
    expect(router.state.location.pathname).toBe('/');
  });

  it('sends a recovery code instead of a TOTP code', async () => {
    const calls = mockFetch([
      ['POST /v1/auth/password', () => ({ body: { ...rotated, recoveryCodesLeft: 9 } })],
    ]);
    const user = userEvent.setup();
    renderWithApp(<ChangePasswordForm />);
    await screen.findByLabelText('Mật khẩu hiện tại');
    await user.click(screen.getByRole('button', { name: 'Dùng mã khôi phục' }));
    await user.type(screen.getByLabelText('Mật khẩu hiện tại'), CURRENT);
    await user.type(screen.getByLabelText('Mã khôi phục'), 'ABCD-EFGH-IJKL-MNOP');
    await user.type(screen.getByLabelText('Mật khẩu mới', { exact: true }), NEXT);
    await user.type(screen.getByLabelText('Nhập lại mật khẩu mới'), NEXT);
    await submit(user);
    expect(await screen.findByText(PASSWORD_CHANGED_TEXT)).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({
      currentPassword: CURRENT,
      newPassword: NEXT,
      recoveryCode: 'ABCD-EFGH-IJKL-MNOP',
    });
  });
});
