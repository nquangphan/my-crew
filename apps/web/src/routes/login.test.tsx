import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockFetch, renderWithApp } from '../test/render';
import { LoginForm } from './login';

const session = { owner: { username: 'owner' }, csrfToken: 'csrf-1' };

async function submit(user: ReturnType<typeof userEvent.setup>, password: string) {
  await user.type(await screen.findByLabelText('Tên đăng nhập'), 'owner');
  await user.type(screen.getByLabelText('Mật khẩu'), password);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

describe('login', () => {
  it('signs in with the username and password in one step', async () => {
    const calls = mockFetch([['POST /v1/auth/login', () => ({ body: session })]]);
    const onLoggedIn = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<LoginForm onLoggedIn={onLoggedIn} />);
    await submit(user, 'correct horse battery staple');
    await vi.waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith(session));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ username: 'owner', password: 'correct horse battery staple' });
  });

  it('has no verification code or recovery code field', async () => {
    renderWithApp(<LoginForm onLoggedIn={() => {}} />);
    await screen.findByLabelText('Tên đăng nhập');
    expect(screen.queryByLabelText(/Mã xác thực|Mã khôi phục|TOTP/)).toBeNull();
    expect(screen.queryByRole('button', { name: /mã khôi phục/i })).toBeNull();
  });

  it('shows a wrong password and stays on the form', async () => {
    mockFetch([
      [
        'POST /v1/auth/login',
        () => ({
          status: 401,
          body: { error: { code: 'UNAUTHORIZED', message: 'invalid username or password' } },
        }),
      ],
    ]);
    const onLoggedIn = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<LoginForm onLoggedIn={onLoggedIn} />);
    await submit(user, 'wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent('Sai tên đăng nhập hoặc mật khẩu.');
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(onLoggedIn).not.toHaveBeenCalled();
  });

  it('tells the owner to wait when the login rate limit is hit', async () => {
    mockFetch([
      [
        'POST /v1/auth/login',
        () => ({ status: 429, body: { error: { code: 'RATE_LIMITED', message: 'rate limit exceeded' } } }),
      ],
    ]);
    const user = userEvent.setup();
    renderWithApp(<LoginForm onLoggedIn={() => {}} />);
    await submit(user, 'correct horse battery staple');
    expect(await screen.findByRole('alert')).toHaveTextContent('Thử quá nhiều lần, hãy đợi một chút.');
  });
});
