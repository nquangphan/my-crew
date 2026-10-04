/**
 * Ticket timeline from the legacy comment and decision collections, read completely and ordered by
 * `createdAt`/`id`. Review, fallback, artifact, commit and docs-sync entries need the G1/G3 history
 * projection and are reported as not yet available instead of being inferred.
 */
import type { CSSProperties } from 'react';
import { useRuntime } from '../app-runtime.ts';
import { ApiFailure } from '../lib/api.ts';
import { actorLabel, formatTime, type TimelineEntry, useTicketHistory } from './queries.ts';

const decisionLabels: Record<Extract<TimelineEntry, { source: 'decision' }>['kind'], string> = {
  assessment: 'Đánh giá',
  delegated: 'Ủy quyền',
  owner_answer: 'Câu trả lời của bạn',
  approval: 'Phê duyệt',
  intervention: 'Can thiệp',
  dispatch: 'Điều phối',
};
const sourceLabels = {
  docs: 'Tài liệu',
  ticket: 'Ticket',
  artifact: 'Sản phẩm',
  owner_decision: 'Quyết định của bạn',
};

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: '0.75rem',
};
const entryStyle: CSSProperties = {
  borderLeft: '3px solid currentColor',
  paddingLeft: '0.75rem',
  display: 'grid',
  gap: '0.25rem',
};
const textStyle: CSSProperties = { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

export function failureText(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.status === 404) return 'Không tìm thấy ticket hoặc bạn không có quyền xem.';
    if (error.kind === 'transport') return 'Mất kết nối tới máy chủ.';
    if (error.kind === 'shape') return 'Máy chủ trả dữ liệu không đúng định dạng.';
    return `Máy chủ báo lỗi (${error.code}).`;
  }
  return 'Đã có lỗi không xác định.';
}

function Entry({ entry }: { entry: TimelineEntry }) {
  const heading = entry.source === 'comment' ? 'Bình luận' : `Quyết định · ${decisionLabels[entry.kind]}`;
  return (
    <li style={entryStyle} data-testid="timeline-entry" data-entry-id={entry.id} data-source={entry.source}>
      <div>
        <strong>{heading}</strong> · <span>{actorLabel(entry.actor)}</span> ·{' '}
        <time dateTime={entry.createdAt}>{formatTime(entry.createdAt)}</time>
      </div>
      {entry.source === 'comment' ? (
        <p style={textStyle}>{entry.text}</p>
      ) : (
        <>
          <p style={textStyle}>{entry.content}</p>
          <p style={textStyle}>
            <span>Lý do: </span>
            {entry.rationale}
          </p>
          {entry.sources.length > 0 && (
            <ul aria-label="Nguồn">
              {entry.sources.map((source) => (
                <li key={`${source.kind}:${source.id}:${source.path ?? ''}:${source.locator ?? ''}`}>
                  {sourceLabels[source.kind]} <code>{source.path ?? source.id}</code>
                  {source.locator ? ` (${source.locator})` : ''}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

export function TicketHistory({ ticketId }: { ticketId: string }) {
  const history = useTicketHistory(useRuntime().client, ticketId);
  return (
    <section aria-labelledby={`history-${ticketId}`} style={{ display: 'grid', gap: '0.75rem' }}>
      <h2 id={`history-${ticketId}`}>Lịch sử</h2>
      <p style={textStyle}>
        Gồm bình luận và quyết định đã ghi nhận. Review, phương án dự phòng, sản phẩm, commit và đồng bộ tài
        liệu sẽ hiện khi máy chủ cung cấp lịch sử đầy đủ.
      </p>
      {history.entries === undefined && history.error ? (
        <div role="alert">
          <p style={textStyle}>Không tải được lịch sử: {failureText(history.error)}</p>
          <button type="button" onClick={() => void history.refetch()}>
            Thử lại
          </button>
        </div>
      ) : history.entries === undefined ? (
        <p role="status">Đang tải lịch sử…</p>
      ) : history.entries.length === 0 ? (
        <p>Chưa có bình luận hay quyết định nào.</p>
      ) : (
        <ol style={listStyle} aria-label="Dòng thời gian">
          {history.entries.map((entry) => (
            <Entry key={`${entry.source}:${entry.id}`} entry={entry} />
          ))}
        </ol>
      )}
    </section>
  );
}
