import type { PairingCodeResponse } from '@crew/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../lib/api-client';
import { formatFullDateTime } from '../lib/format';
import { keys } from '../lib/queries';
import { ConfirmDialog } from './confirm-dialog';
import { Button } from './ui/button';
import { DialogContent, DialogRoot } from './ui/dialog';

function useCountdown(until: string | null): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [until]);
  if (!until) return '';
  const left = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/**
 * Creates a single-use pairing code once the owner confirms. The code is shown once; projects and folders
 * are chosen later in the desktop app.
 */
export function PairingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [result, setResult] = useState<PairingCodeResponse | null>(null);
  const queryClient = useQueryClient();
  const countdown = useCountdown(result?.expiresAt ?? null);

  useEffect(() => {
    if (!open) setResult(null);
  }, [open]);

  if (result) {
    const expired = new Date(result.expiresAt).getTime() <= Date.now();
    return (
      <DialogRoot
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) void queryClient.invalidateQueries({ queryKey: keys.machines });
        }}
      >
        <DialogContent title="Mã ghép máy" description="Mã chỉ hiện một lần và dùng được một lần.">
          <div className="flex flex-col items-center gap-3 py-2">
            <output
              aria-label="Mã ghép máy"
              className="rounded-md border border-line bg-soft px-5 py-3 font-mono text-2xl font-semibold tracking-[0.2em] select-all"
            >
              {result.pairingCode}
            </output>
            <p className="m-0 text-sm text-muted">
              {expired
                ? 'Mã đã hết hạn.'
                : `Hết hạn sau ${countdown} (lúc ${formatFullDateTime(result.expiresAt)}).`}
            </p>
          </div>
          <ol className="m-0 flex flex-col gap-1 pl-5 text-sm">
            <li>
              Mở app 2P Crew trên máy mới (hoặc chạy <code className="font-mono">crewd pair --code</code>).
            </li>
            <li>Nhập mã này ở bước “Ghép máy”.</li>
            <li>Chọn dự án và thư mục cho máy trong app.</li>
          </ol>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              Xong
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ghép máy mới"
      description="Tạo một mã ghép máy dùng một lần (hết hạn sau 10 phút)."
      confirmLabel="Tạo mã ghép"
      onConfirm={async () => setResult(await api.createPairingCode())}
    />
  );
}
