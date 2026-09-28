import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { ApiRequestError } from '../lib/api-client';
import { errorMessage } from '../lib/format';
import { Button, type ButtonVariant } from './ui/button';
import { DialogContent, DialogRoot } from './ui/dialog';
import { Field, Input } from './ui/field';

/**
 * Re-confirms the owner with a fresh 6-digit TOTP code before a sensitive action (claim approval,
 * pairing). `onConfirm` throws on failure; a 401 means the code was wrong or already used.
 */
export function TotpDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = 'primary',
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  onConfirm: (code: string) => Promise<void>;
  children?: ReactNode;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCode('');
      setError(null);
    }
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Mã xác thực gồm 6 chữ số.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(code);
    } catch (err) {
      setCode('');
      setError(
        err instanceof ApiRequestError && err.code === 'UNAUTHORIZED'
          ? 'Mã xác thực không đúng hoặc đã dùng. Đợi mã mới rồi thử lại.'
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <form onSubmit={submit} className="flex flex-col gap-4" aria-label={title}>
          {children}
          <Field label="Mã xác thực (TOTP)">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              className="font-mono tracking-widest"
            />
          </Field>
          {error && (
            <p role="alert" className="m-0 text-sm text-bad">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Hủy</Button>
            <Button type="submit" variant={confirmVariant} disabled={busy}>
              {busy ? 'Đang xác thực…' : confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
