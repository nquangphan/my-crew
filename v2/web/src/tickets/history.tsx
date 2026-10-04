/**
 * Ticket timeline from the legacy comment and decision collections, read completely and ordered by
 * `createdAt`/`id`. Review, fallback, artifact, commit and docs-sync entries need the G1/G3 history
 * projection and are reported as not yet available instead of being inferred.
 */
import type { CSSProperties } from 'react';
import { useRuntime } from '../app-runtime.ts';
import { actorLabel, failureText, formatTime, type TimelineEntry, useTicketHistory } from './queries.ts';

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

// Presentation of the dark ticket dialog mockup (screen 2): monospace time column, then the description.
const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: 6,
  fontSize: 13,
};
const entryStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content minmax(0, 1fr)',
  columnGap: 12,
  rowGap: 2,
};
const timeStyle: CSSProperties = {
  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
  color: '#9aa0a6',
  whiteSpace: 'nowrap',
};
const bodyStyle: CSSProperties = { display: 'grid', gap: 2, minWidth: 0 };
const textStyle: CSSProperties = { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const noteStyle: CSSProperties = { ...textStyle, fontSize: 12.5, color: '#9aa0a6' };

function Entry({ entry }: { entry: TimelineEntry }) {
  const heading = entry.source === 'comment' ? 'Bình luận' : `Quyết định · ${decisionLabels[entry.kind]}`;
  return (
    <li style={entryStyle} data-testid="timeline-entry" data-entry-id={entry.id} data-source={entry.source}>
      <time style={timeStyle} dateTime={entry.createdAt}>
        {formatTime(entry.createdAt)}
      </time>
      <div style={bodyStyle}>
        <div>
          <strong>{heading}</strong> · <span>{actorLabel(entry.actor)}</span>
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
      </div>
    </li>
  );
}

export function TicketHistory({ ticketId }: { ticketId: string }) {
  const history = useTicketHistory(useRuntime().client, ticketId);
  return (
    <section aria-labelledby={`history-${ticketId}`} style={{ display: 'grid', gap: '0.75rem' }}>
      <h2 id={`history-${ticketId}`}>Lịch sử</h2>
      <p style={noteStyle}>
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
