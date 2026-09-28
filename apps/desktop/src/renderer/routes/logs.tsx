import type { LogLine } from '@crew/shared';
import { useEffect, useRef, useState } from 'react';
import { ErrorBox, PageHeader } from '../components/ui';
import { errorText, formatTime } from '../lib/format';
import { invoke, useDesktopEvent } from '../lib/ipc';

const LIMIT = 500;
const LEVEL_CLASS = { info: 'text-muted', warn: 'text-warn-ink', error: 'text-bad-ink' } as const;

export function matchesTicket(line: LogLine, filter: string): boolean {
  const wanted = filter.trim().toLowerCase();
  if (!wanted) return true;
  return [line.ticketKey, line.ticketId, line.jobId].some((value) => value?.toLowerCase() === wanted);
}

interface KeyedLine {
  key: number;
  line: LogLine;
}

let nextKey = 0;
const keyed = (line: LogLine): KeyedLine => ({ key: nextKey++, line });

/** Tails the daemon log (`~/.crew/logs/daemon.log`), optionally for one ticket. */
export function LogsPage() {
  const [filter, setFilter] = useState('');
  const [applied, setApplied] = useState('');
  const [lines, setLines] = useState<KeyedLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke('logs.tail', { limit: LIMIT, ...(applied ? { ticket: applied } : {}) }).then(
      (loaded) => setLines(loaded.map(keyed)),
      (caught) => setError(errorText(caught)),
    );
  }, [applied]);

  useDesktopEvent('log.line', (line) => {
    if (matchesTicket(line, applied)) setLines((current) => [...current.slice(-(LIMIT - 1)), keyed(line)]);
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever a line arrives.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col p-8">
      <PageHeader
        title="Nhật ký daemon"
        actions={
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(filter.trim());
            }}
          >
            <input
              className="input w-56"
              placeholder="Lọc theo ticket (WEB-12)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button type="submit" className="btn">
              Lọc
            </button>
          </form>
        }
      />
      <ErrorBox message={error} />
      <div className="card min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">
        {lines.length === 0 && <p className="text-muted">Chưa có dòng nhật ký nào.</p>}
        {lines.map(({ key, line }) => (
          <div key={key} className="whitespace-pre-wrap break-words">
            <span className="text-muted">{formatTime(line.at)}</span>{' '}
            <span className={LEVEL_CLASS[line.level]}>{line.level.toUpperCase()}</span>{' '}
            {line.ticketKey && <span className="font-semibold">[{line.ticketKey}] </span>}
            {line.message}
            {Object.keys(line.fields).length > 0 && (
              <span className="text-muted"> {JSON.stringify(line.fields)}</span>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>
    </div>
  );
}
