import { useCallback, useEffect, useState } from 'react';
import type { LogFile } from '../../shared/ipc-contract';
import { ErrorBox, PageHeader } from '../components/ui';
import { invoke } from '../lib/ipc';

export const LOG_FILES: { id: LogFile; label: string }[] = [
  { id: 'app', label: 'App (app.log)' },
  { id: 'sshd', label: 'sshd agent (sshd.log)' },
  { id: 'reaper', label: 'Dọn process mồ côi (reaper.log)' },
  { id: 'status', label: 'Gửi bản tin máy (status.log)' },
];
const LINES = 500;

export function LogsScreen() {
  const [file, setFile] = useState<LogFile>('app');
  const [runId, setRunId] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    invoke('logs:tail', file, LINES, runId.trim() || undefined)
      .then((result) => {
        setLines(result);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [file, runId]);
  useEffect(load, [load]);

  return (
    <>
      <PageHeader
        title="Log"
        subtitle={`${LINES} dòng cuối của file đang chọn`}
        actions={
          <>
            <button type="button" className="btn" onClick={load}>
              Tải lại
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => invoke('logs:reveal', file).catch((e: unknown) => setError(String(e)))}
            >
              Mở trong Finder
            </button>
          </>
        }
      />
      <div className="toolbar">
        <label>
          File{' '}
          <select value={file} onChange={(e) => setFile(e.target.value as LogFile)}>
            {LOG_FILES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lọc theo run id{' '}
          <input
            type="text"
            value={runId}
            placeholder="dán run id"
            onChange={(e) => setRunId(e.target.value)}
          />
        </label>
      </div>
      <ErrorBox message={error} />
      <pre className="log-view">{lines.length > 0 ? lines.join('\n') : 'Không có dòng nào.'}</pre>
    </>
  );
}
