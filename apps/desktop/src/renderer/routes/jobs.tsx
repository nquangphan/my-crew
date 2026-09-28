import type { JobView } from '@crew/shared';
import { useEffect, useState } from 'react';
import { ErrorBox, Lozenge, PageHeader, type Tone } from '../components/ui';
import { errorText, formatElapsed, formatTime, formatUsd } from '../lib/format';
import { invoke, useDesktopEvent } from '../lib/ipc';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  running: { label: 'Đang chạy', tone: 'info' },
  queued: { label: 'Đang chờ', tone: 'gray' },
  backoff: { label: 'Chờ thử lại', tone: 'warn' },
};

/** Running, queued and backoff jobs of this machine. */
export function JobsPage() {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useDesktopEvent('jobs.changed', setJobs);
  useEffect(() => {
    invoke('jobs.list', {}).then(setJobs, (caught) => setError(errorText(caught)));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-8">
      <PageHeader title="Job" subtitle="Các job đang chạy, đang chờ và đang chờ thử lại trên máy này." />
      <ErrorBox message={error} />
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-soft text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2">Ticket</th>
              <th className="px-4 py-2">Vai trò</th>
              <th className="px-4 py-2">Trạng thái</th>
              <th className="px-4 py-2">Model</th>
              <th className="px-4 py-2">Thời gian</th>
              <th className="px-4 py-2">Chi phí</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted">
                  Không có job nào.
                </td>
              </tr>
            )}
            {jobs.map((job) => {
              const status = STATUS[job.status] ?? { label: job.status, tone: 'gray' as const };
              return (
                <tr key={job.id} className="border-t border-line2" data-job={job.id}>
                  <td className="px-4 py-2">
                    <div className="font-mono text-xs font-semibold">
                      {job.ticketKey ?? job.ticketId.slice(0, 8)}
                    </div>
                    <div className="max-w-72 truncate">{job.ticketTitle ?? '—'}</div>
                  </td>
                  <td className="px-4 py-2">
                    {job.role}
                    {job.kind !== 'agent' && <span className="text-xs text-muted"> · {job.kind}</span>}
                  </td>
                  <td className="px-4 py-2">
                    <Lozenge tone={status.tone}>{status.label}</Lozenge>
                    {job.status === 'backoff' && job.retryAt && (
                      <div className="text-xs text-muted">thử lại {formatTime(job.retryAt)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {job.model ?? '—'}
                    {job.effort && <span className="text-xs text-muted"> / {job.effort}</span>}
                  </td>
                  <td className="px-4 py-2">
                    {job.status === 'running' ? formatElapsed(job.startedAt, now) : '—'}
                  </td>
                  <td className="px-4 py-2">{formatUsd(job.costUsd)}</td>
                  <td className="px-4 py-2 text-right">
                    {job.webUrl && (
                      <button
                        type="button"
                        className="btn text-xs"
                        onClick={() => void invoke('app.openExternal', { url: job.webUrl as string })}
                      >
                        Mở trên web
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
