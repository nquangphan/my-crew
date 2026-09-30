import type { FullDiskAccess } from '@crew/shared';
import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../lib/format';
import { invoke } from '../lib/ipc';
import { ErrorBox, Notice } from './ui';

/**
 * Full Disk Access, asked once: macOS otherwise asks per folder (Documents, Desktop, Downloads, iCloud, external
 * drives) and again whenever the app's signature changes. The check reads a protected path without prompting;
 * the button opens the Full Disk Access pane; the check runs again when the window gets focus back. The
 * per-folder prompts stay the fallback (the status view lists folders waiting for an answer).
 */
export function FullDiskAccessPanel({ onChange }: { onChange?: (access: FullDiskAccess) => void }) {
  const [access, setAccess] = useState<FullDiskAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke('app.fullDiskAccess', {});
      setAccess(next);
      onChange?.(next);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }, [onChange]);

  useEffect(() => {
    void check();
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [check]);

  if (!access || access.state === 'unsupported') return <ErrorBox message={error} />;
  if (access.state === 'granted') {
    return (
      <Notice tone="ok">
        Đã cấp quyền truy cập toàn bộ ổ đĩa: macOS không hỏi quyền từng thư mục cho 2P Crew nữa, kể cả sau khi
        app cập nhật.
      </Notice>
    );
  }
  return (
    <div className="space-y-3" data-full-disk-access={access.state}>
      <Notice tone="warn">
        <p>
          macOS hỏi quyền riêng cho từng thư mục (Documents, Desktop, Downloads, iCloud, ổ ngoài) mà agent
          đọc, và có thể hỏi lại khi app đổi bản. Cấp <strong>Truy cập toàn bộ ổ đĩa</strong> (Full Disk
          Access) một lần cho 2P Crew thì không còn các hộp thoại đó nữa.
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Bấm "Mở cài đặt quyền" bên dưới.</li>
          <li>
            Bật công tắc cạnh 2P Crew (chưa có trong danh sách thì bấm +, chọn 2P Crew trong Applications).
          </li>
          <li>macOS có thể đề nghị mở lại app: chọn "Quit &amp; Reopen", rồi bấm "Kiểm tra lại".</li>
        </ol>
        {access.state === 'unknown' && (
          <p className="mt-2 text-xs">
            App chưa xác định được quyền này trên máy; làm các bước trên rồi kiểm tra lại.
          </p>
        )}
      </Notice>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            void invoke('app.openFullDiskAccess', {}).catch((caught) => setError(errorText(caught)))
          }
        >
          Mở cài đặt quyền
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void check()}>
          {busy ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
        </button>
      </div>
      <ErrorBox message={error} />
    </div>
  );
}
