/**
 * Editor of the pages a ticket is linked to (`PUT /v2/tickets/:id/docs-links`). The server replaces the whole
 * set with pages of ONE snapshot, guarded by the ticket revision (`expectedRevision`). Rules kept here:
 * - paths are chosen from the tree of the real snapshot the tree query returned;
 * - the save is one `PendingOperation` per intent, so a retry after a lost response re-sends the same key and
 *   bytes, and a new key is only issued after the previous one was confirmed or terminally rejected;
 * - the draft (selected paths) lives in component state and is never dropped by a failure, in particular by
 *   409 `REVISION_CONFLICT`; only a confirmed save of exactly the saved bytes clears it;
 * - saving needs every page of the existing links to be read first, otherwise links on unread pages would be
 *   silently dropped.
 * To embed, render `<TicketDocsLinksEditor ticketId={id} />` inside `TicketDetail`.
 */
import { useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useEffect, useState, useSyncExternalStore } from 'react';
import { useRuntime } from '../app-runtime.ts';
import { ApiFailure } from '../lib/api.ts';
import { IntentUnresolvedError, type PendingOperation } from '../lib/pending-operation.ts';
import { queryKeys } from '../lib/query-keys.ts';
import { useTicket } from '../tickets/queries.ts';
import { docsFailureText, useDocsTree, useTicketDocsLinks } from './queries.ts';

/** Producer limit of `paths` (`tickets/routes.ts` `docsLinksBody`). */
export const maxTicketDocPaths = 100;

const noticeStyle: CSSProperties = {
  margin: 0,
  padding: '0.6rem 0.8rem',
  border: '1px solid #2b2f35',
  borderRadius: 4,
};
// Linked pages as bordered chips (dark ticket dialog mockup); a selected page has the accent border.
const chipsStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};
const chipStyle = (selected: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 32,
  padding: '6px 10px',
  fontSize: 13,
  border: `1px solid ${selected ? '#8ab4ff' : '#2b2f35'}`,
  borderRadius: 4,
  cursor: 'pointer',
});

function saveFailureText(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.status === 409)
      return 'Ticket đã thay đổi (revision mới). Bản nháp của bạn được giữ; kiểm tra lại rồi lưu lần nữa.';
    if (error.status === 422)
      return 'Trang tài liệu hoặc phiên bản này chưa được xác minh nên chưa thể liên kết.';
    if (error.status === 400) return `Danh sách trang không hợp lệ (cần 1 đến ${maxTicketDocPaths} trang).`;
    if (error.kind === 'transport' || error.kind === 'shape' || (error.status ?? 0) >= 500)
      return 'Lần lưu chưa xác nhận được kết quả. Bấm Lưu để gửi lại đúng yêu cầu đó.';
  }
  return docsFailureText(error);
}

export function TicketDocsLinksEditor({ ticketId }: { ticketId: string }) {
  const { client } = useRuntime();
  const ticket = useTicket(client, ticketId);
  if (ticket.isPending) return <p role="status">Đang tải ticket…</p>;
  if (ticket.isError) return <p role="alert">{docsFailureText(ticket.error)}</p>;
  return (
    <Editor ticketId={ticket.data.id} projectId={ticket.data.projectId} revision={ticket.data.revision} />
  );
}

function Editor({
  ticketId,
  projectId,
  revision,
}: {
  ticketId: string;
  projectId: string;
  revision: number;
}) {
  const { client, pending } = useRuntime();
  const cache = useQueryClient();
  const tree = useDocsTree(client, projectId);
  const links = useTicketDocsLinks(client, ticketId);
  const [draft, setDraft] = useState<ReadonlySet<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const intentId = `ticket-docs-links:${ticketId}`;
  const operations = useSyncExternalStore(
    (listener) => pending.subscribe(listener),
    () => pending.list(),
  );
  const stuck = operations.find((operation) => operation.intentId === intentId);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = links;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (tree.isPending || links.isPending) return <p role="status">Đang tải liên kết tài liệu…</p>;
  if (tree.isError) return <p role="alert">{docsFailureText(tree.error)}</p>;
  if (links.isError) return <p role="alert">{docsFailureText(links.error)}</p>;

  const snapshotId = tree.data.snapshotId;
  const existing = links.data.pages.flatMap((entry) => entry.items);
  const complete = !hasNextPage;
  const current = existing.filter((link) => link.snapshotId === snapshotId).map((link) => link.path);
  const replaced = existing.length - current.length;
  const selected = draft ?? new Set(current);
  const paths = [...selected].sort();
  const body = { snapshotId, paths, expectedRevision: revision };
  const dirty = draft !== null && (draft.size !== current.length || current.some((path) => !draft.has(path)));
  const canSave =
    complete &&
    !busy &&
    paths.length >= 1 &&
    paths.length <= maxTicketDocPaths &&
    (dirty || stuck !== undefined);

  const toggle = (path: string) => {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setDraft(next);
  };

  async function save() {
    setBusy(true);
    setMessage(null);
    let operation: PendingOperation | undefined = stuck;
    try {
      if (!operation) {
        try {
          operation = pending.begin({
            intentId,
            method: 'PUT',
            path: `/v2/tickets/${ticketId}/docs-links`,
            body,
            storage: 'tab',
          });
        } catch (error) {
          if (!(error instanceof IntentUnresolvedError)) throw error;
          operation = pending.get(error.operationId);
          if (!operation) {
            setMessage('Có một lần lưu trước chưa xác nhận và cần khôi phục; chưa thể lưu lần mới.');
            return;
          }
        }
      }
      await client.mutate(operation);
      // The saved bytes may be an older payload re-sent under its original key; only an identical save
      // may clear the draft.
      if (operation.bodyJson === JSON.stringify(body)) {
        setDraft(null);
        setMessage('Đã lưu liên kết tài liệu.');
      } else {
        setMessage(
          'Đã gửi lại lần lưu trước với nội dung cũ của nó. Bản nháp hiện tại được giữ; kiểm tra rồi lưu lại.',
        );
      }
    } catch (error) {
      setMessage(saveFailureText(error));
    } finally {
      await cache.invalidateQueries({ queryKey: queryKeys.ticket(ticketId) });
      setBusy(false);
    }
  }

  return (
    <section aria-label="Tài liệu liên kết với ticket">
      <h3>Tài liệu liên kết</h3>
      <p>
        Phiên bản tài liệu: <code>{snapshotId}</code> (commit {tree.data.sourceCommit ?? 'không có'}). Ticket
        revision {revision}.
      </p>
      {!complete && <p role="status">Đang đọc hết các liên kết hiện có trước khi cho sửa…</p>}
      {replaced > 0 && (
        <p style={noticeStyle}>
          {replaced} liên kết thuộc phiên bản tài liệu cũ sẽ bị thay khi lưu, vì máy chủ chỉ giữ liên kết của
          một phiên bản.
        </p>
      )}
      <ul style={chipsStyle}>
        {tree.data.pages.map((page) => (
          <li key={page.path}>
            <label style={chipStyle(selected.has(page.path))}>
              <input
                type="checkbox"
                checked={selected.has(page.path)}
                disabled={!complete}
                onChange={() => toggle(page.path)}
              />{' '}
              {page.title} <code>{page.path}</code>
            </label>
          </li>
        ))}
      </ul>
      {paths.length === 0 && <p>Cần chọn ít nhất một trang; máy chủ chưa hỗ trợ xóa hết liên kết.</p>}
      {paths.length > maxTicketDocPaths && <p>Tối đa {maxTicketDocPaths} trang cho mỗi lần lưu.</p>}
      {stuck && (
        <p role="status" style={noticeStyle}>
          Lần lưu trước chưa xác nhận kết quả. Bấm Lưu để gửi lại đúng yêu cầu đó (cùng khóa chống trùng),
          hoặc bỏ nó nếu bạn đã kiểm tra rằng nó không được áp dụng.{' '}
          <button type="button" disabled={busy} onClick={() => pending.reject(stuck.id)}>
            Bỏ lần gửi treo
          </button>
        </p>
      )}
      <button type="button" disabled={!canSave} onClick={() => void save()}>
        Lưu liên kết
      </button>
      {message && (
        <p role="status" style={noticeStyle}>
          {message}
        </p>
      )}
    </section>
  );
}
