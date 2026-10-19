import { useCallback, useEffect, useState } from 'react';
import type { UpdateState } from '../../main/app-state';
import type { UpdateView } from '../../shared/ipc-contract';
import { ErrorBox, Lozenge, Notice, PageHeader, type Tone } from '../components/ui';
import { invoke, useStateChanged } from '../lib/ipc';
import { formatTime } from './health';

/** Cùng nhãn với thẻ máy trên web (plugin `crew.core`). */
export const UPDATE_STATE_LABEL: Record<UpdateState, string> = {
  idle: 'Đã cập nhật',
  downloading: 'Đang tải bản mới',
  'waiting-idle': 'Chờ máy rảnh để cài',
  installing: 'Đang cài',
  probation: 'Đang thử bản mới',
  'rolled-back': 'Đã quay về bản trước',
};

const STATE_TONE: Record<UpdateState, Tone> = {
  idle: 'ok',
  downloading: 'info',
  'waiting-idle': 'warn',
  installing: 'info',
  probation: 'info',
  'rolled-back': 'bad',
};

/** Tải/cài chạy nền ở Main; đọc lại định kỳ để thấy bản mới và giờ kiểm. */
const REFRESH_MS = 15_000;

export function UpdateScreen() {
  const [view, setView] = useState<UpdateView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    invoke('update:state')
      .then(setView)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);
  useStateChanged(load);

  const act = (label: string, run: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    run()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusy(null);
        load();
      });
  };

  const rows: Array<[string, string]> = view
    ? [
        ['Bản đang chạy', view.current],
        ['Bản mới', view.available ?? 'Không có'],
        ['Bản trước', view.previous ?? 'Chưa có'],
        ['Kiểm lần cuối', view.lastCheckedAt ? formatTime(view.lastCheckedAt) : 'Chưa kiểm'],
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Cập nhật"
        subtitle="Kiểm bản mới lúc mở app và mỗi giờ. Bản mới chỉ cài khi máy không còn run (giờ Việt Nam)."
        actions={
          <>
            <button
              type="button"
              className="btn primary"
              disabled={!view?.enabled || busy !== null}
              onClick={() => act('check', () => invoke('update:check'))}
            >
              {busy === 'check' ? 'Đang kiểm...' : 'Kiểm ngay'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!view?.enabled || view.state !== 'waiting-idle' || busy !== null}
              onClick={() => act('install', () => invoke('update:installWhenIdle'))}
            >
              Cài khi rảnh
            </button>
            <button
              type="button"
              className="btn"
              disabled={!view?.previous || busy !== null}
              onClick={() => act('rollback', () => invoke('update:rollback'))}
            >
              Quay về bản trước
            </button>
          </>
        }
      />
      <ErrorBox message={error} />
      {view && !view.enabled && view.reason && <Notice tone="warn">{view.reason}</Notice>}
      {view?.enabled && view.reason && <Notice tone="bad">{view.reason}</Notice>}
      {view && (
        <dl className="kv">
          <dt>Trạng thái</dt>
          <dd>
            <Lozenge tone={STATE_TONE[view.state]}>{UPDATE_STATE_LABEL[view.state]}</Lozenge>
          </dd>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: 'contents' }}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
