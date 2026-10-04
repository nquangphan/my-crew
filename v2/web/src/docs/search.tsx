/** Docs search over the pinned snapshot. Hits are plain text (the snippet is never interpreted as HTML). */
import { type CSSProperties, type FormEvent, useState } from 'react';
import { useRuntime } from '../app-runtime.ts';
import { auditLabels, contentClassLabels } from './page.tsx';
import { docsFailureText, useDocsSearch } from './queries.ts';

const listStyle: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' };
const hitStyle: CSSProperties = { display: 'block', textAlign: 'left', width: '100%' };

export type DocsSearchProps = {
  projectId: string;
  snapshotId: string;
  onSelect: (path: string) => void;
};

export function DocsSearch({ projectId, snapshotId, onSelect }: DocsSearchProps) {
  const { client } = useRuntime();
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState('');
  const query = useDocsSearch(client, submitted === '' ? null : { q: submitted, projectId, snapshotId });
  const hits = query.data?.pages.flatMap((entry) => entry.items) ?? [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(draft.trim());
  };

  return (
    <div>
      <search>
        <form onSubmit={submit}>
          <label>
            Tìm trong tài liệu
            <input
              type="search"
              value={draft}
              maxLength={256}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button type="submit" disabled={draft.trim() === ''}>
            Tìm
          </button>
        </form>
      </search>
      {submitted !== '' && query.isPending && <p role="status">Đang tìm…</p>}
      {query.isError && <p role="alert">{docsFailureText(query.error)}</p>}
      {query.isSuccess && hits.length === 0 && <p>Không có trang nào khớp “{submitted}”.</p>}
      {hits.length > 0 && (
        <ul aria-label="Kết quả tìm kiếm" style={listStyle}>
          {hits.map((hit) => (
            <li key={`${hit.snapshotId}:${hit.path}`}>
              <button type="button" style={hitStyle} onClick={() => onSelect(hit.path)}>
                <strong>{hit.title}</strong> — <code>{hit.path}</code>
                <br />
                <span>{hit.snippet}</span>
                <br />
                <small>
                  {hit.sourceCommit ?? 'Không có commit'} · {auditLabels[hit.auditState]} ·{' '}
                  {contentClassLabels[hit.contentClass]}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <button type="button" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          Tải thêm kết quả
        </button>
      )}
    </div>
  );
}
