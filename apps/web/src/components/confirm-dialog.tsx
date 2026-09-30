import { type ReactNode, useEffect, useState } from 'react';
import { errorMessage } from '../lib/format';
import { Button, type ButtonVariant } from './ui/button';
import { DialogContent, DialogRoot } from './ui/dialog';

/**
 * Asks the owner to confirm a sensitive action (claim approval, pairing, project change) with one click.
 * `onConfirm` throws on failure; the error is shown in the dialog and the owner can try again.
 */
export function ConfirmDialog({
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
  onConfirm: () => Promise<void>;
  children?: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <div className="flex flex-col gap-4">
          {children}
          {error && (
            <p role="alert" className="m-0 text-sm text-bad">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Hủy</Button>
            <Button variant={confirmVariant} onClick={() => void confirm()} disabled={busy}>
              {busy ? 'Đang xử lý…' : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
