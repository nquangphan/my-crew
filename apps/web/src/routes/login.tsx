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

type Step = { kind: 'password' } | { kind: 'totp'; challenge: string };

/**
 * Two-step owner login: password, then a 6-digit TOTP code (or a one-time recovery code). The session
 * response carries the CSRF token used by every later mutation.
 */
export function LoginForm({ onLoggedIn }: { onLoggedIn: (session: SessionResponse) => void }) {
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { challenge } = await api.login(username.trim(), password);
      setPassword('');
      setStep({ kind: 'totp', challenge });
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

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (step.kind !== 'totp') return;
    const value = code.trim();
    if (!useRecovery && !/^\d{6}$/.test(value)) {
      setError('Mã xác thực gồm 6 chữ số.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await api.loginTotp(
        useRecovery
          ? { challenge: step.challenge, recoveryCode: value }
          : { challenge: step.challenge, code: value },
      );
      onLoggedIn(session);
    } catch (err) {
      setCode('');
      if (
        err instanceof ApiRequestError &&
        err.code === 'UNAUTHORIZED' &&
        err.message.includes('challenge')
      ) {
        setStep({ kind: 'password' });
        setError('Phiên đăng nhập đã hết hạn, hãy nhập lại mật khẩu.');
      } else if (err instanceof ApiRequestError && err.code === 'UNAUTHORIZED') {
        setError(useRecovery ? 'Mã khôi phục không đúng hoặc đã dùng.' : 'Mã xác thực không đúng.');
      } else {
        setError(errorMessage(err));
      }
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
      {step.kind === 'password' ? (
        <form onSubmit={submitPassword} className="flex flex-col gap-4" aria-label="Đăng nhập">
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
            {busy ? 'Đang kiểm tra…' : 'Tiếp tục'}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="flex flex-col gap-4" aria-label="Xác thực hai bước">
          <h1 className="m-0 text-xl font-semibold">Xác thực hai bước</h1>
          <p className="m-0 text-sm text-muted">
            {useRecovery
              ? 'Nhập một mã khôi phục. Mỗi mã chỉ dùng được một lần.'
              : 'Nhập mã 6 số trong ứng dụng xác thực của bạn.'}
          </p>
          <Field label={useRecovery ? 'Mã khôi phục' : 'Mã xác thực'}>
            <Input
              key={useRecovery ? 'recovery' : 'totp'}
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              placeholder={useRecovery ? 'ABCD-EFGH-IJKL-MNOP' : '123456'}
              maxLength={useRecovery ? 19 : 6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
              className="font-mono tracking-widest"
            />
          </Field>
          {error && (
            <p role="alert" className="m-0 text-sm text-bad">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Đang xác thực…' : 'Đăng nhập'}
          </Button>
          <button
            type="button"
            className="min-h-11 self-start text-sm text-accent underline-offset-2 hover:underline"
            onClick={() => {
              setUseRecovery((value) => !value);
              setCode('');
              setError(null);
            }}
          >
            {useRecovery ? 'Dùng mã xác thực' : 'Dùng mã khôi phục'}
          </button>
        </form>
      )}
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
