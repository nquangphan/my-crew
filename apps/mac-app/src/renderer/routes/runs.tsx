import { useCallback, useEffect, useState } from 'react';
import type { ActiveRun } from '../../shared/ipc-contract';
import { ErrorBox, Notice, PageHeader } from '../components/ui';
import { invoke, useStateChanged } from '../lib/ipc';
import { formatTime } from './health';

export const RUNS_REFRESH_MS = 5_000;

/** Tên agent suy từ thư mục worktree (`.../<agent>`). */
export function agentName(worktree: string | null): string {
  if (!worktree) return 'không rõ';
  return worktree.replace(/\/+$/, '').split('/').pop() || 'không rõ';
}

export function elapsed(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h} giờ ${m} phút` : `${m} phút ${total % 60} giây`;
}

export function RunsScreen() {
  const [runs, setRuns] = useState<ActiveRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    invoke('runs:list')
      .then((list) => {
        setRuns(list);
        setError(null);
        setNow(Date.now());
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, RUNS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);
  useStateChanged(load);

  const act = (channel: 'runs:cancel' | 'runs:openWeb', runId: string) => {
    invoke(channel, runId)
      .then((result) => setMessage({ ok: result.ok, text: result.message }))
      .catch((e: unknown) => setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) }))
      .finally(load);
  };
  const cancel = (runId: string) => {
    if (window.confirm(`Hủy run ${runId}? Paperclip sẽ dừng run này.`)) act('runs:cancel', runId);
  };

  return (
    <>
      <PageHeader
        title="Run đang chạy"
        subtitle={runs ? `${runs.length} run trên máy này (giờ Việt Nam)` : 'Đang đọc danh sách run...'}
      />
      <ErrorBox message={error} />
      {message && <Notice tone={message.ok ? 'ok' : 'bad'}>{message.text}</Notice>}
      {runs?.length === 0 && <p className="muted">Hiện không có run nào.</p>}
      {runs && runs.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Agent</th>
              <th>Bắt đầu</th>
              <th>Đã chạy</th>
              <th>Process con</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.pid}>
                <td className="mono">{run.runId}</td>
                <td>{agentName(run.worktree)}</td>
                <td>{formatTime(run.startedAt)}</td>
                <td>{elapsed(run.startedAt, now)}</td>
                <td>{run.children}</td>
                <td className="row-actions">
                  <button type="button" className="btn" onClick={() => act('runs:openWeb', run.runId)}>
                    Mở trên web
                  </button>
                  <button type="button" className="btn danger" onClick={() => cancel(run.runId)}>
                    Hủy run
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
