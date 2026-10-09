import type { CheckResult } from '@crew/mac';
import { useCallback, useEffect, useState } from 'react';
import { CheckRow } from '../components/check-row';
import { ErrorBox, PageHeader } from '../components/ui';
import { invoke, useStateChanged } from '../lib/ipc';

export const HEALTH_REFRESH_MS = 60_000;

/** Giờ hiển thị luôn theo múi Việt Nam, bất kể múi giờ của máy: `HH:mm:ss dd/MM`. */
export function formatTime(value: string | number | Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.hour}:${parts.minute}:${parts.second} ${parts.day}/${parts.month}`;
}

function ActionButton({ result }: { result: CheckResult }) {
  const [error, setError] = useState<string | null>(null);
  if (result.status === 'ok') return null;
  const run = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  let button: { label: string; onClick: () => void };
  if (result.id === 'tcc-pending') {
    button = { label: 'Mở quyền macOS', onClick: () => run(() => invoke('health:action', 'open-privacy')) };
  } else if (result.id === 'sshd-agent') {
    button = {
      label: 'Chạy lại cài đặt',
      onClick: () => {
        window.location.hash = '#/setup';
      },
    };
  } else {
    button = { label: 'Mở Terminal', onClick: () => run(() => invoke('health:action', 'open-terminal')) };
  }
  return (
    <>
      <button type="button" className="btn" onClick={button.onClick}>
        {button.label}
      </button>
      {error && <span className="muted">{error}</span>}
    </>
  );
}

export function HealthScreen() {
  const [snapshot, setSnapshot] = useState<{ at: string; results: CheckResult[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    invoke('health:last')
      .then(setSnapshot)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, HEALTH_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);
  useStateChanged(load);

  const recheck = () => {
    setBusy(true);
    setError(null);
    invoke('health:run', true)
      .then(() => load())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <PageHeader
        title="Sức khỏe"
        subtitle={
          snapshot ? `Kiểm lúc ${formatTime(snapshot.at)} (giờ Việt Nam)` : 'Đang kiểm máy lần đầu...'
        }
        actions={
          <button type="button" className="btn primary" disabled={busy} onClick={recheck}>
            {busy ? 'Đang kiểm...' : 'Kiểm lại có thử claude'}
          </button>
        }
      />
      <ErrorBox message={error} />
      <ul className="check-list">
        {snapshot?.results.map((result) => (
          <CheckRow key={result.id} result={result} action={<ActionButton result={result} />} />
        ))}
      </ul>
    </>
  );
}
