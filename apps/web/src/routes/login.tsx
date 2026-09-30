import type { SessionResponse } from '@crew/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { Button } from '../components/ui/button';
import { Field, Input } from '../components/ui/field';
import { ApiRequestError, api, setCsrfToken } from '../lib/api-client';
import { errorMessage } from '../lib/format';
import { keys } from '../lib/queries';
import { safeRedirect } from '../lib/search-params';

/** One-step owner login: username and password. The session response carries the CSRF token used by every
 * later mutation. */
export function LoginForm({ onLoggedIn }: { onLoggedIn: (session: SessionResponse) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(username.trim(), password);
      setPassword('');
      onLoggedIn(session);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.code === 'UNAUTHORIZED'
          ? 'Sai tên đăng nhập hoặc mật khẩu.'
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm rounded-lg border border-line bg-panel p-6 shadow-sm">
      <div className="mb-6 flex items-center gap-2 text-base font-bold">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-xs text-white">
          2P
        </span>
        2P Crew
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Đăng nhập">
        <h1 className="m-0 text-xl font-semibold">Đăng nhập</h1>
        <Field label="Tên đăng nhập">
          <Input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Mật khẩu">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error && (
          <p role="alert" className="m-0 text-sm text-bad">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </Button>
      </form>
    </div>
  );
}

export function LoginPage({ redirectTo }: { redirectTo?: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return (
    <main className="flex min-h-full items-center justify-center bg-bg p-4">
      <LoginForm
        onLoggedIn={(session) => {
          setCsrfToken(session.csrfToken);
          queryClient.setQueryData(keys.session, session);
          router.history.push(safeRedirect(redirectTo));
        }}
      />
    </main>
  );
}
