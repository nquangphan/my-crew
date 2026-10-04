import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { passwordLimits, type SessionController, type SessionError, safeReturnPath } from '../lib/session.ts';

export type LoginMode = 'login' | 'reauth';

export type LoginScreenProps = {
  session: SessionController;
  mode: LoginMode;
  /** Requested in-app path; validated with `safeReturnPath` before it is handed back. */
  returnTo?: string | null;
  onAuthenticated?: (path: string) => void;
};

const messages: Record<SessionError, string> = {
  INVALID_CREDENTIALS: 'Mật khẩu không đúng. Vui lòng kiểm tra và nhập lại.',
  LOGIN_THROTTLED: 'Đăng nhập sai quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.',
  OWNER_NOT_BOOTSTRAPPED: 'Máy chủ chưa khởi tạo chủ dự án. Hãy hoàn tất bước khởi tạo trước khi đăng nhập.',
  PASSWORD_INVALID: `Mật khẩu cần từ ${passwordLimits.min} đến ${passwordLimits.max} ký tự.`,
  OWNER_MISMATCH: 'Phiên vừa tạo không thuộc chủ dự án hiện tại. Yêu cầu cũ chưa được gửi lại.',
  ORIGIN_INVALID: 'Trang này không được phép đăng nhập vào máy chủ Crew.',
  UNAVAILABLE: 'Không kết nối được máy chủ. Vui lòng thử lại sau.',
};

const formStyle: CSSProperties = { display: 'grid', gap: '0.75rem', maxWidth: '24rem' };
const inputStyle: CSSProperties = {
  font: 'inherit',
  padding: '0.6rem 0.75rem',
  borderRadius: '0.5rem',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
};
const buttonStyle: CSSProperties = { ...inputStyle, cursor: 'pointer', fontWeight: 600 };

/**
 * Owner password form for first login and re-authentication. The password lives only in this component's
 * state, is cleared after each request and on unmount, and is never logged or cached.
 */
export function LoginScreen({ session, mode, returnTo, onAuthenticated }: LoginScreenProps) {
  const snapshot = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.snapshot(),
  );
  const [password, setPassword] = useState('');
  const inFlight = useRef<AbortController | null>(null);
  const inputId = useId();
  const errorId = useId();

  useEffect(
    () => () => {
      inFlight.current?.abort();
      inFlight.current = null;
    },
    [],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (snapshot.busy) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const value = password;
    try {
      const ok = await session.login(value, controller.signal);
      if (ok) onAuthenticated?.(safeReturnPath(returnTo ?? null));
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      setPassword('');
    }
  };

  const error = snapshot.error ? messages[snapshot.error] : null;
  const reauth = mode === 'reauth';
  return (
    <section className="page-stack" aria-labelledby={`${inputId}-heading`}>
      <div className="page-intro">
        <span className="eyebrow">{reauth ? 'Phiên đã hết hạn' : 'Chủ dự án'}</span>
        <h1 id={`${inputId}-heading`}>{reauth ? 'Đăng nhập lại để tiếp tục' : 'Đăng nhập Crew'}</h1>
        <p>
          {reauth
            ? 'Phiên làm việc đã kết thúc. Các yêu cầu chưa được xác nhận vẫn được giữ nguyên và chỉ được gửi lại khi bạn chọn sau khi đăng nhập.'
            : 'Nhập mật khẩu chủ dự án để mở không gian làm việc.'}
        </p>
      </div>
      <form style={formStyle} onSubmit={submit} noValidate>
        <label htmlFor={inputId}>Mật khẩu</label>
        <input
          id={inputId}
          style={inputStyle}
          type="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={passwordLimits.min}
          maxLength={passwordLimits.max}
          value={password}
          disabled={snapshot.busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <p id={errorId} role="alert">
            <span aria-hidden="true">! </span>
            {error}
          </p>
        )}
        <button type="submit" style={buttonStyle} disabled={snapshot.busy || password.length === 0}>
          {snapshot.busy ? 'Đang đăng nhập…' : reauth ? 'Đăng nhập lại' : 'Đăng nhập'}
        </button>
      </form>
    </section>
  );
}
