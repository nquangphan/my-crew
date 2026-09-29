import { MIN_PASSWORD_LENGTH, RecoveryCode, TotpCode } from '@crew/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { Button } from '../components/ui/button';
import { Field, Input } from '../components/ui/field';
import { useToast } from '../components/ui/toast';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { ApiRequestError, api, setCsrfToken } from '../lib/api-client';
import { errorMessage } from '../lib/format';
import { keys, sessionQuery } from '../lib/queries';

export const PASSWORD_CHANGED_TEXT = 'Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị đăng xuất.';

interface Values {
  current: string;
  code: string;
  next: string;
  confirm: string;
}

type Errors = Partial<Record<keyof Values, string>>;

const EMPTY: Values = { current: '', code: '', next: '', confirm: '' };

/** The same rules the API enforces, checked before sending so mistakes cost no TOTP code. */
function validate(values: Values, useRecovery: boolean): Errors {
  const errors: Errors = {};
  if (!values.current) errors.current = 'Nhập mật khẩu hiện tại.';
  const code = values.code.trim();
  if (useRecovery) {
    if (!RecoveryCode.safeParse(code).success) errors.code = 'Mã khôi phục có dạng ABCD-EFGH-IJKL-MNOP.';
  } else if (!TotpCode.safeParse(code).success) {
    errors.code = 'Mã TOTP gồm 6 chữ số.';
  }
  if (values.next.length < MIN_PASSWORD_LENGTH)
    errors.next = `Mật khẩu mới cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
  else if (values.next === values.current) errors.next = 'Mật khẩu mới phải khác mật khẩu hiện tại.';
  if (values.confirm !== values.next) errors.confirm = 'Mật khẩu nhập lại không khớp.';
  return errors;
}

/**
 * Changes the owner password: current password, a TOTP code (or a recovery code), the new password twice.
 * On success the API rotates this device's session and signs out every other one; the new CSRF token is
 * taken over here so later requests keep working.
 */
export function ChangePasswordForm() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [useRecovery, setUseRecovery] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (field: keyof Values) => (event: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validate(values, useRecovery);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const code = values.code.trim();
      const session = await api.changePassword(
        useRecovery
          ? { currentPassword: values.current, newPassword: values.next, recoveryCode: code }
          : { currentPassword: values.current, newPassword: values.next, code },
      );
      setCsrfToken(session.csrfToken);
      queryClient.setQueryData(keys.session, session);
      setValues(EMPTY);
      toast(PASSWORD_CHANGED_TEXT, 'success');
      void router.invalidate();
    } catch (err) {
      setValues((v) => ({ ...v, code: '' }));
      if (err instanceof ApiRequestError && err.code === 'UNAUTHORIZED') {
        setFormError(
          useRecovery
            ? 'Mật khẩu hiện tại hoặc mã khôi phục không đúng (mỗi mã chỉ dùng được một lần).'
            : 'Mật khẩu hiện tại hoặc mã TOTP không đúng. Nếu vừa dùng mã này, đợi mã mới rồi thử lại.',
        );
        // A 401 can also mean the session itself expired: re-check it and go to login if it is gone.
        const current = await queryClient
          .fetchQuery({ ...sessionQuery, staleTime: 0 })
          .catch(() => undefined);
        if (current === null) {
          setCsrfToken(null);
          router.history.push(`/login?redirect=${encodeURIComponent('/account')}`);
        }
      } else {
        setFormError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Đổi mật khẩu">
      <Field label="Mật khẩu hiện tại" error={errors.current}>
        <Input
          type="password"
          autoComplete="current-password"
          value={values.current}
          onChange={set('current')}
        />
      </Field>
      <Field
        label={useRecovery ? 'Mã khôi phục' : 'Mã TOTP'}
        hint={
          useRecovery ? 'Mỗi mã khôi phục chỉ dùng được một lần.' : 'Mã 6 số trong ứng dụng xác thực của bạn.'
        }
        error={errors.code}
      >
        <Input
          key={useRecovery ? 'recovery' : 'totp'}
          inputMode={useRecovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          placeholder={useRecovery ? 'ABCD-EFGH-IJKL-MNOP' : '123456'}
          maxLength={useRecovery ? 19 : 6}
          value={values.code}
          onChange={set('code')}
          className="font-mono tracking-widest"
        />
      </Field>
      <button
        type="button"
        className="-mt-2 min-h-11 self-start text-sm text-accent underline-offset-2 hover:underline xl:min-h-8"
        onClick={() => {
          setUseRecovery((value) => !value);
          setValues((v) => ({ ...v, code: '' }));
          setErrors((e) => ({ ...e, code: undefined }));
        }}
      >
        {useRecovery ? 'Dùng mã TOTP' : 'Dùng mã khôi phục'}
      </button>
      <Field
        label="Mật khẩu mới"
        hint={`Ít nhất ${MIN_PASSWORD_LENGTH} ký tự, khác mật khẩu hiện tại.`}
        error={errors.next}
      >
        <Input type="password" autoComplete="new-password" value={values.next} onChange={set('next')} />
      </Field>
      <Field label="Nhập lại mật khẩu mới" error={errors.confirm}>
        <Input type="password" autoComplete="new-password" value={values.confirm} onChange={set('confirm')} />
      </Field>
      {formError && (
        <p role="alert" className="m-0 text-sm text-bad">
          {formError}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy} className="self-stretch md:self-start">
        {busy ? 'Đang đổi…' : 'Đổi mật khẩu'}
      </Button>
    </form>
  );
}

/** "Tài khoản": the owner's own settings, reached from the account menu. */
export function AccountPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-4 px-3 py-3 md:px-6 md:py-[18px]">
      <Breadcrumbs items={[{ label: 'Tài khoản' }]} />
      <h1 className="m-0 text-[22px] font-semibold">Tài khoản</h1>
      <section
        aria-labelledby="change-password-heading"
        className="flex flex-col gap-3 rounded-md border border-line bg-panel p-4 md:max-w-lg"
      >
        <h2 id="change-password-heading" className="m-0 text-base font-semibold">
          Đổi mật khẩu
        </h2>
        <p className="m-0 text-sm text-muted">
          Sau khi đổi, các thiết bị khác phải đăng nhập lại; thiết bị này vẫn giữ đăng nhập.
        </p>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
