import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../lib/ipc';
import { ErrorBox, Notice } from './ui';

export const LOGIN_POLL_MS = 2_000;

type State = 'idle' | 'waiting' | 'approved';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Nút "Đăng nhập lại" Paperclip ngoài wizard: chạy đúng luồng `cli-auth` của bước Đăng nhập (`paperclip:login` mở
 * trang duyệt trên trình duyệt, rồi hỏi `paperclip:loginStatus` tới khi xong). Board key mới thay key cũ của origin.
 */
export function ReloginButton({ origin }: { origin: string | null }) {
  const [state, setState] = useState<State>('idle');
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const poll = useCallback(() => {
    invoke('paperclip:loginStatus')
      .then((status) => {
        if (status === 'pending') {
          timer.current = setTimeout(poll, LOGIN_POLL_MS);
          return;
        }
        setApprovalUrl(null);
        if (status === 'approved') {
          setState('approved');
          return;
        }
        setState('idle');
        setError('Đăng nhập chưa xong (hết hạn hoặc bị hủy). Thử lại.');
      })
      .catch((e: unknown) => {
        setState('idle');
        setError(errorText(e));
      });
  }, []);

  const start = () => {
    if (!origin) return;
    setError(null);
    setState('waiting');
    invoke('paperclip:login', origin)
      .then((answer) => {
        setApprovalUrl(answer.approvalUrl);
        poll();
      })
      .catch((e: unknown) => {
        setState('idle');
        setError(errorText(e));
      });
  };

  return (
    <div className="relogin">
      <button type="button" className="btn" disabled={!origin || state === 'waiting'} onClick={start}>
        {state === 'waiting' ? 'Đang chờ duyệt trên trình duyệt...' : 'Đăng nhập lại'}
      </button>
      {!origin && (
        <span className="muted"> Chưa có địa chỉ Paperclip: làm bước Đăng nhập Paperclip trong Cài đặt.</span>
      )}
      {state === 'waiting' && approvalUrl && (
        <p className="muted">
          Duyệt trên trình duyệt vừa mở. Không thấy trang thì mở link: <code>{approvalUrl}</code>
        </p>
      )}
      {state === 'approved' && <Notice tone="ok">Đã đăng nhập lại Paperclip, board key mới đã lưu.</Notice>}
      <ErrorBox message={error} />
    </div>
  );
}
