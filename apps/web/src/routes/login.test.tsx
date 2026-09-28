import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockFetch, renderWithApp } from '../test/render';
import { LoginForm } from './login';

const session = { owner: { username: 'owner' }, csrfToken: 'csrf-1', recoveryCodesLeft: 9 };

async function passwordStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Tên đăng nhập'), 'owner');
  await user.type(screen.getByLabelText('Mật khẩu'), 'correct horse battery staple');
  await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  await screen.findByRole('heading', { name: 'Xác thực hai bước' });
}

describe('login TOTP step', () => {
  it('asks for the TOTP after the password, rejects a wrong code, then signs in', async () => {
    let attempts = 0;
    const calls = mockFetch([
      [
        'POST /v1/auth/login/totp',
        () =>
          ++attempts === 1
            ? { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'invalid verification code' } } }
            : { body: session },
      ],
      ['POST /v1/auth/login', () => ({ body: { challenge: 'ch-1', expiresAt: '2026-09-28T03:00:00.000Z' } })],
    ]);
    const onLoggedIn = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<LoginForm onLoggedIn={onLoggedIn} />);
    await passwordStep(user);

    const code = screen.getByLabelText('Mã xác thực');
    await user.type(code, '12345');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mã xác thực gồm 6 chữ số.');

    await user.clear(code);
    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByText('Mã xác thực không đúng.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Mã xác thực'), '123456');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await vi.waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith(session));
    const totpCalls = calls.filter((c) => c.path === '/v1/auth/login/totp');
    expect(totpCalls.at(-1)?.body).toEqual({ challenge: 'ch-1', code: '123456' });
    expect(calls[0]?.body).toEqual({ username: 'owner', password: 'correct horse battery staple' });
  });

  it('accepts a recovery code instead', async () => {
    const calls = mockFetch([
      ['POST /v1/auth/login/totp', () => ({ body: session })],
      ['POST /v1/auth/login', () => ({ body: { challenge: 'ch-2', expiresAt: '2026-09-28T03:00:00.000Z' } })],
    ]);
    const onLoggedIn = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<LoginForm onLoggedIn={onLoggedIn} />);
    await passwordStep(user);
    await user.click(screen.getByRole('button', { name: 'Dùng mã khôi phục' }));
    await user.type(screen.getByLabelText('Mã khôi phục'), 'ABCD-EFGH-IJKL-MNOP');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await vi.waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    expect(calls.at(-1)?.body).toEqual({ challenge: 'ch-2', recoveryCode: 'ABCD-EFGH-IJKL-MNOP' });
  });

  it('shows a wrong password without leaving the first step', async () => {
    mockFetch([
      [
        'POST /v1/auth/login',
        () => ({
          status: 401,
          body: { error: { code: 'UNAUTHORIZED', message: 'invalid username or password' } },
        }),
      ],
    ]);
    const user = userEvent.setup();
    renderWithApp(<LoginForm onLoggedIn={() => {}} />);
    await user.type(await screen.findByLabelText('Tên đăng nhập'), 'owner');
    await user.type(screen.getByLabelText('Mật khẩu'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sai tên đăng nhập hoặc mật khẩu.');
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument();
  });
});
