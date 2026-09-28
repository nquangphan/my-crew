import type { Report, Ticket } from '@crew/shared';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { formatFullDateTime, formatUsd } from '../lib/format';
import { MarkdownView } from './markdown-view';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="m-0 text-muted">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </>
  );
}

function YesNo({ value, good }: { value: boolean; good: boolean }) {
  return <span className={value === good ? 'text-ok' : 'text-bad'}>{value ? 'Có' : 'Không'}</span>;
}

function NoneOr({ items, bad }: { items: string[]; bad?: boolean }) {
  if (items.length === 0) return <span className={bad ? 'text-ok' : 'text-muted'}>Không</span>;
  return <span className={bad ? 'text-bad' : undefined}>{items.join(', ')}</span>;
}

const FILES_PREVIEW = 12;

/**
 * The ticket's current report: summary, files, commits and head SHA, the skills and MCP servers chosen,
 * used and missing, whether docs were read first, tests and filed bugs. Earlier versions stay selectable.
 */
export function ReportPanel({
  report,
  history = [],
  related = [],
}: {
  report: Report | null;
  history?: Report[];
  /** Tickets used to show filed bug ids as keys. */
  related?: Ticket[];
}) {
  const [version, setVersion] = useState<number | null>(null);
  const [allFiles, setAllFiles] = useState(false);
  const shown = (version !== null ? history.find((r) => r.version === version) : null) ?? report;
  if (!shown) {
    return (
      <p className="m-0 text-sm text-muted">Chưa có report. Ticket chỉ chuyển sang Xong khi đã có report.</p>
    );
  }
  const byId = new Map(related.map((t) => [t.id, t]));
  const files = allFiles ? shown.filesChanged : shown.filesChanged.slice(0, FILES_PREVIEW);

  return (
    <div className="flex flex-col gap-3">
      {history.length > 1 && (
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Phiên bản
          <select
            className="min-h-11 rounded border border-line bg-panel px-2 text-sm xl:min-h-8"
            value={shown.version}
            onChange={(e) => setVersion(Number(e.target.value))}
          >
            {history.map((r) => (
              <option key={r.id} value={r.version}>
                v{r.version} · {formatFullDateTime(r.createdAt)}
                {r.isCurrent ? ' (hiện tại)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <dl
        aria-label="Report"
        className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md border border-line2 p-3 text-[13px] md:grid-cols-[130px_minmax(0,1fr)]"
      >
        <Row label="Tóm tắt">
          <MarkdownView source={shown.summaryMd} />
        </Row>
        <Row label="Commit">
          <span className="font-mono">
            {shown.commits.length > 0 ? shown.commits.map((c) => c.slice(0, 7)).join(' · ') : '—'}
            {shown.headSha && ` · head ${shown.headSha.slice(0, 7)}`}
          </span>
        </Row>
        <Row label={`Files (${shown.filesChanged.length})`}>
          {shown.filesChanged.length === 0 ? (
            <span className="text-muted">—</span>
          ) : (
            <>
              <ul className="m-0 list-none p-0 font-mono text-xs">
                {files.map((file) => (
                  <li key={file} className="break-all">
                    {file}
                  </li>
                ))}
              </ul>
              {shown.filesChanged.length > FILES_PREVIEW && (
                <button
                  type="button"
                  className="min-h-8 text-xs text-accent"
                  onClick={() => setAllFiles((v) => !v)}
                >
                  {allFiles ? 'Thu gọn' : `Xem tất cả ${shown.filesChanged.length} file`}
                </button>
              )}
            </>
          )}
        </Row>
        <Row label="Tests">
          {shown.testsRun.length === 0 ? (
            <span className="text-muted">Không có</span>
          ) : (
            <ul className="m-0 list-none p-0">
              {shown.testsRun.map((test) => (
                <li key={test.name}>
                  <span className={test.passed ? 'text-ok' : 'text-bad'}>{test.passed ? '✓' : '✗'}</span>{' '}
                  {test.name}
                  {test.summary && <span className="text-muted"> — {test.summary}</span>}
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row label="Skill đã chọn">
          {shown.skillsSelected.length === 0 ? (
            <span className="text-muted">Không</span>
          ) : (
            <ul className="m-0 list-none p-0">
              {shown.skillsSelected.map((s) => (
                <li key={s.name}>
                  <span className="font-mono">{s.name}</span> <span className="text-muted">— {s.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row label="Skill đã dùng">
          <NoneOr items={shown.skillsUsed} />
        </Row>
        <Row label="Skill thiếu">
          <NoneOr items={shown.skillsMissing} bad />
        </Row>
        <Row label="MCP đã chọn">
          {shown.mcpsSelected.length === 0 ? (
            <span className="text-muted">Không</span>
          ) : (
            <ul className="m-0 list-none p-0">
              {shown.mcpsSelected.map((m) => (
                <li key={m.server}>
                  <span className="font-mono">{m.server}</span>{' '}
                  <span className="text-muted">— {m.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row label="MCP đã dùng">
          <NoneOr items={shown.mcpsUsed} />
        </Row>
        <Row label="MCP thiếu">
          <NoneOr items={shown.mcpsMissing} bad />
        </Row>
        <Row label="Đọc docs trước">
          <YesNo value={shown.docsFirst} good />
        </Row>
        <Row label="Bug đã tạo">
          {shown.bugsFiled.length === 0 ? (
            <span className="text-muted">Không</span>
          ) : (
            <span className="flex flex-wrap gap-2">
              {shown.bugsFiled.map((id) => {
                const bug = byId.get(id);
                return bug ? (
                  <Link
                    key={id}
                    to="/tickets/$ticketKey"
                    params={{ ticketKey: bug.key }}
                    className="font-mono"
                  >
                    {bug.key}
                  </Link>
                ) : (
                  <span key={id} className="font-mono text-muted">
                    {id.slice(0, 8)}
                  </span>
                );
              })}
            </span>
          )}
        </Row>
        <Row label="Tài nguyên còn lại">
          <YesNo value={shown.leftResources} good={false} />
        </Row>
        <Row label="Chi phí">{formatUsd(shown.costUsd)}</Row>
        <Row label="Nộp lúc">
          v{shown.version} · {formatFullDateTime(shown.createdAt)}
        </Row>
      </dl>
    </div>
  );
}
