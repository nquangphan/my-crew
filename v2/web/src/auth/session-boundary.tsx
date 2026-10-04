import { type CSSProperties, type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { ApiFailure, type OwnerClient } from '../lib/api.ts';
import type { EventSync } from '../lib/events.ts';
import type { PendingOperation, PendingStore, RecoveryTombstone } from '../lib/pending-operation.ts';
import type { SessionController } from '../lib/session.ts';
import { LoginScreen } from './login.tsx';

export { safeReturnPath } from '../lib/session.ts';

/** Minimal cache surface so the wiring stays independent of a specific QueryClient instance. */
export type SessionCache = { cancelQueries(): Promise<unknown>; clear(): void };

/**
 * Lifetime wiring for one app mount: expiry suspends writes and drops the owner cache; logout additionally
 * reduces unresolved operations to tombstones; the event stream runs only while authenticated; tab unload
 * wipes memory-only (secret) payloads. Returns a disposer.
 */
export function wireSession(input: {
  session: SessionController;
  pending: PendingStore;
  cache: SessionCache;
  events?: EventSync;
  window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}): () => void {
  const { session, pending, cache, events } = input;
  const dropCache = () => {
    void cache.cancelQueries().catch(() => undefined);
    cache.clear();
  };
  const offExpire = session.onExpire(() => {
    events?.stop();
    pending.suspendAll();
    dropCache();
  });
  const offLogout = session.onLogout(() => {
    events?.stop();
    pending.tombstoneAll();
    dropCache();
  });
  const sync = () => {
    if (session.snapshot().state === 'authenticated') events?.start();
  };
  const offState = session.subscribe(sync);
  sync();
  const onPageHide = () => pending.discardMemory();
  input.window?.addEventListener('pagehide', onPageHide);
  return () => {
    offExpire();
    offLogout();
    offState();
    input.window?.removeEventListener('pagehide', onPageHide);
  };
}

function useStore<T>(subscribe: (listener: () => void) => () => void, read: () => T): T {
  return useSyncExternalStore(subscribe, read);
}

const panelStyle: CSSProperties = {
  border: '1px solid currentColor',
  borderRadius: '0.75rem',
  padding: '1rem',
  display: 'grid',
  gap: '0.75rem',
};
const buttonStyle: CSSProperties = {
  font: 'inherit',
  padding: '0.4rem 0.75rem',
  borderRadius: '0.5rem',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

function failureMessage(error: unknown, kept: boolean): string {
  if (error instanceof ApiFailure) {
    if (error.kind === 'configuration')
      return `Lỗi cấu hình máy chủ (${error.code}). Yêu cầu vẫn giữ khóa cũ; gửi lại sau khi máy chủ được cấu hình.`;
    if (kept && (error.code === 'CSRF_INVALID' || error.code === 'ORIGIN_INVALID'))
      return 'Máy chủ chưa nhận mã bảo vệ của tab này. Yêu cầu vẫn giữ nguyên khóa cũ; hãy thử gửi lại hoặc tải lại trang.';
    if (error.code === 'IDEMPOTENCY_CONFLICT')
      return 'Nội dung khác với yêu cầu cũ. Yêu cầu cũ vẫn được giữ; hãy nhập lại đúng nội dung ban đầu.';
    if (
      error.code === 'UNAUTHENTICATED' ||
      error.code === 'SESSION_REQUIRED' ||
      error.code === 'SESSION_ENDED'
    )
      return 'Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.';
    if (error.code === 'UNCONFIRMED' || error.kind === 'transport' || error.kind === 'aborted')
      return 'Chưa xác nhận kết quả. Yêu cầu vẫn giữ nguyên để gửi lại.';
    if (kept) return `Chưa xác nhận kết quả (${error.code}). Yêu cầu vẫn giữ nguyên khóa cũ để gửi lại.`;
    return `Máy chủ từ chối yêu cầu (${error.code}).`;
  }
  return 'Chưa xác nhận kết quả. Yêu cầu vẫn giữ nguyên để gửi lại.';
}

const stateLabel: Record<PendingOperation['state'], string> = {
  pending: 'Đang gửi',
  ambiguous: 'Chưa xác nhận',
  suspended: 'Tạm dừng vì hết phiên',
  accepted: 'Đã xác nhận',
  rejected: 'Bị từ chối',
};

/**
 * “Tiếp tục yêu cầu chưa xác nhận”: lists unresolved operations and tombstones of this tab. Replay sends
 * the same key and bytes with the current CSRF token; it never edits the payload or creates a new key.
 */
export function RecoveryPanel({ pending, client }: { pending: PendingStore; client: OwnerClient }) {
  const operations = useStore(
    (listener) => pending.subscribe(listener),
    () => pending.list(),
  );
  const tombstones = useStore(
    (listener) => pending.subscribe(listener),
    () => pending.tombstones(),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const unresolved = operations.filter((operation) => operation.state !== 'pending' || busy === operation.id);
  if (unresolved.length === 0 && tombstones.length === 0) return null;

  const replay = async (operation: PendingOperation) => {
    setBusy(operation.id);
    try {
      await client.mutate(operation);
      setMessages((current) => ({ ...current, [operation.id]: 'Đã xác nhận.' }));
    } catch (error) {
      const kept = pending.get(operation.id) !== undefined;
      setMessages((current) => ({ ...current, [operation.id]: failureMessage(error, kept) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section style={panelStyle} aria-labelledby="recovery-heading" data-testid="recovery-panel">
      <h2 id="recovery-heading">Tiếp tục yêu cầu chưa xác nhận</h2>
      <ul style={{ display: 'grid', gap: '0.75rem', margin: 0, paddingLeft: '1.25rem' }}>
        {unresolved.map((operation) => (
          <li key={operation.id} data-operation-id={operation.id}>
            <p>
              <strong>
                {pending.configurationError(operation.id)
                  ? `Lỗi cấu hình máy chủ (${pending.configurationError(operation.id)})`
                  : stateLabel[operation.state]}
              </strong>{' '}
              · {operation.method} <code>{operation.path}</code>
            </p>
            <button
              type="button"
              style={buttonStyle}
              disabled={busy !== null}
              onClick={() => void replay(operation)}
            >
              {busy === operation.id ? 'Đang gửi lại…' : 'Gửi lại đúng yêu cầu cũ'}
            </button>
            {messages[operation.id] && <p role="status">{messages[operation.id]}</p>}
          </li>
        ))}
        {tombstones.map((tombstone: RecoveryTombstone) => (
          <li key={tombstone.id} data-tombstone-id={tombstone.id}>
            <p>
              <strong>Chưa thể xác nhận yêu cầu cũ</strong> · {tombstone.method} <code>{tombstone.path}</code>
            </p>
            <p>
              Nội dung đã được xóa khỏi trình duyệt. Nhập lại đúng nội dung ở biểu mẫu gốc để gửi lại bằng
              khóa cũ; không tạo yêu cầu mới cho cùng thao tác này.
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export type SessionBoundaryProps = {
  session: SessionController;
  pending: PendingStore;
  client: OwnerClient;
  /** Protected route the owner asked for; only an internal `/crew-v2/` path is honoured. */
  returnTo?: string | null;
  onAuthenticated?: (path: string) => void;
  children: ReactNode;
};

/**
 * Gate for protected routes: guest sees login, expired sees re-authentication (without any recovered
 * payload), authenticated sees the recovery panel above the protected content.
 */
export function SessionBoundary({
  session,
  pending,
  client,
  returnTo,
  onAuthenticated,
  children,
}: SessionBoundaryProps) {
  const snapshot = useStore(
    (listener) => session.subscribe(listener),
    () => session.snapshot(),
  );
  useEffect(() => {
    void session.bootstrap();
  }, [session]);

  if (snapshot.state === 'bootstrapping' || snapshot.state === 'logging_out') {
    return (
      <section className="state-panel state-panel--loading" aria-live="polite">
        <span className="state-panel__symbol" aria-hidden="true">
          ◌
        </span>
        <div>
          <h2>{snapshot.state === 'bootstrapping' ? 'Đang kiểm tra phiên đăng nhập' : 'Đang đăng xuất'}</h2>
          <p>Vui lòng chờ trong giây lát.</p>
        </div>
      </section>
    );
  }
  if (snapshot.state === 'guest' || snapshot.state === 'expired') {
    return (
      <LoginScreen
        session={session}
        mode={snapshot.state === 'expired' ? 'reauth' : 'login'}
        returnTo={returnTo}
        onAuthenticated={onAuthenticated}
      />
    );
  }
  return (
    <>
      <RecoveryPanel pending={pending} client={client} />
      {children}
    </>
  );
}
