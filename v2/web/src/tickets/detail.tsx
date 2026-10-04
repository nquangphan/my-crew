/**
 * Shared ticket detail used by the ticket page and by the ticket dialog. It renders only producer fields of
 * the Ticket DTO, the legacy history, the shared Task5 attachment list and — for open tickets — a comment
 * composer (the shared `AttachmentComposer`), plus the Task6 ticket→docs links editor. Machine, model,
 * difficulty, current attempt and evidence wait for the typed G1/G3 projection. Missing data is shown as
 * missing, never derived from `criteria` keys or prose.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { type CSSProperties, type ReactNode, useMemo, useRef, useState } from 'react';
import { useRuntime } from '../app-runtime.ts';
import { TicketAttachments } from '../attachments/preview.tsx';
import { AttachmentComposer, type ComposerHandle } from '../compose/composer.tsx';
import type { ComposeDraft, ComposeSubmission } from '../compose/state.ts';
import type { Ticket } from '../contracts/tickets.ts';
import { docsFailureText, useTicketDocsLinks } from '../docs/queries.ts';
import { TicketDocsLinksEditor } from '../docs/ticket-links.tsx';
import { DraftDiscard, useTicketDrafts } from './create-request.tsx';
import { TicketHistory } from './history.tsx';
import { failureText, useTicket, useTicketGraph } from './queries.ts';
import {
  isTerminal,
  kindLabels,
  levelLabels,
  statusIcons,
  statusLabels,
  statusOrder,
  waitNotice,
} from './status.ts';

export type TicketDetailProps = { ticketId: string; presentation: 'page' | 'dialog' };

const stackStyle: CSSProperties = { display: 'grid', gap: '1.25rem', minWidth: 0 };
const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(8rem, max-content) 1fr',
  gap: '0.35rem 1rem',
  margin: 0,
};
const textStyle: CSSProperties = { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const noticeStyle: CSSProperties = {
  margin: 0,
  padding: '0.6rem 0.8rem',
  border: '1px solid currentColor',
  borderRadius: '0.5rem',
};
const missing = 'Chưa có dữ liệu — máy chủ chưa cung cấp thông tin này.';
// Presentation of the dark dialog in the owner-approved mockup (screen 2).
const titleRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 };
const titleStyle: CSSProperties = { margin: 0, fontSize: 18, fontWeight: 600 };
const sublineStyle: CSSProperties = { margin: 0, fontSize: 13, color: '#9aa0a6', overflowWrap: 'anywhere' };
const headerStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  paddingBottom: 16,
  borderBottom: '1px solid #2b2f35',
};
const tilesStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
  gap: 12,
  margin: 0,
  padding: 0,
  listStyle: 'none',
};
const tileStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  background: '#1c1f23',
  border: '1px solid #2b2f35',
  borderRadius: 4,
};
const tileLabelStyle: CSSProperties = { fontSize: 11.5, color: '#9aa0a6' };
const tileValueStyle: CSSProperties = { fontSize: 13, fontWeight: 500 };

export function StatusBadge({ status }: { status: Ticket['status'] }) {
  return (
    <span data-status={status} style={{ whiteSpace: 'nowrap' }}>
      <span aria-hidden="true">{statusIcons[status]}</span> {statusLabels[status]}
    </span>
  );
}

function Headings({
  presentation,
  title,
  description,
  leading,
}: {
  presentation: TicketDetailProps['presentation'];
  title: ReactNode;
  description: ReactNode;
  /** Shown before the title on the same line (status dot). */
  leading?: ReactNode;
}) {
  const row = (heading: ReactNode) =>
    leading ? (
      <div style={titleRowStyle}>
        {leading}
        {heading}
      </div>
    ) : (
      heading
    );
  if (presentation === 'dialog')
    return (
      <>
        {row(<Dialog.Title style={titleStyle}>{title}</Dialog.Title>)}
        <Dialog.Description style={sublineStyle} data-detail-subline="">
          {description}
        </Dialog.Description>
      </>
    );
  return (
    <>
      {row(<h1 style={{ margin: 0 }}>{title}</h1>)}
      <p style={sublineStyle} data-detail-subline="">
        {description}
      </p>
    </>
  );
}

/** Status dot of the map mockup; decoration only, the status is written in the “Trạng thái” tile. */
const dotColors: Readonly<Record<Ticket['status'], string>> = {
  done: '#3fb27f',
  running: '#4c9aff',
  needs_input: '#f0a24a',
  paused: '#f0a24a',
  pending: '#6b7280',
  ready: '#6b7280',
  cancelled: '#6b7280',
};

/** “loại · bước · gốc” from the shared whole-root graph query (same key as `ChildTickets`, no extra request). */
function useTicketSubline(ticket: Ticket): string {
  const graph = useTicketGraph(useRuntime().client, ticket.rootId);
  const titleOf = (id: string | null) =>
    id === null ? undefined : graph.data?.nodes.find((node) => node.id === id)?.title;
  const step = ticket.level === 'task' ? titleOf(ticket.parentId) : undefined;
  const root = ticket.id === ticket.rootId ? undefined : titleOf(ticket.rootId);
  return [levelLabels[ticket.level], step, root].filter(Boolean).join(' · ');
}

function InfoTiles({ ticket }: { ticket: Ticket }) {
  // “Cập nhật” is shown only with real data; the Ticket DTO has no update time yet, so it is omitted.
  const tiles: [string, ReactNode, boolean][] = [
    ['Trạng thái', `${statusLabels[ticket.status]} · Phiên bản ${ticket.revision}`, false],
    ['Máy · model', 'Chưa có dữ liệu', true],
  ];
  return (
    <ul aria-label="Thông tin nhanh" style={tilesStyle}>
      {tiles.map(([label, value, muted]) => (
        <li key={label} style={tileStyle}>
          <span style={tileLabelStyle}>{label}</span>
          <span style={{ ...tileValueStyle, color: muted ? '#9aa0a6' : '#e8e9eb' }}>{value}</span>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{children}</dd>
    </>
  );
}

function ChildTickets({ ticket }: { ticket: Ticket }) {
  const graph = useTicketGraph(useRuntime().client, ticket.rootId);
  const children = graph.data?.nodes.filter((node) => node.parentId === ticket.id) ?? [];
  children.sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
  return (
    <section aria-labelledby={`children-${ticket.id}`} style={{ display: 'grid', gap: '0.5rem' }}>
      <h2 id={`children-${ticket.id}`}>Ticket con</h2>
      {graph.isPending ? (
        <p role="status">Đang tải ticket con…</p>
      ) : graph.error && !graph.data ? (
        <p role="alert">Không tải được ticket con: {failureText(graph.error)}</p>
      ) : children.length === 0 ? (
        <p>Không có ticket con.</p>
      ) : (
        <ul aria-label="Danh sách ticket con">
          {children.map((child) => (
            <li key={child.id} data-ticket-id={child.id}>
              {levelLabels[child.level]}: {child.title} — <StatusBadge status={child.status} />
              {child.mandatory ? ' · Bắt buộc' : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * New comment through the shared Task5 composer. The text draft is kept per ticket for the session (memory
 * and tab storage), so closing the dialog, a realtime refetch or a reload never loses it; only “Bỏ bản nháp
 * bình luận” or a confirmed comment clears it. Rendered with `key={ticket.id}`: a draft never follows the
 * view to another ticket. On a terminal ticket the composer stays mounted only while a comment is still
 * sending or unconfirmed, so its resend/status remains reachable; a fresh comment is not offered.
 */
function CommentComposer({ ticket, terminal }: { ticket: Ticket; terminal: boolean }) {
  const drafts = useTicketDrafts();
  const handle = useRef<ComposerHandle | null>(null);
  const [text, setText] = useState(() => drafts.comment(ticket.id));
  const [state, setState] = useState<ComposeDraft['state']>('editing');
  const submission = useMemo<ComposeSubmission>(
    () => ({
      kind: 'comment',
      target: { purpose: 'comment', projectId: ticket.projectId, ticketId: ticket.id },
      text,
    }),
    [ticket.projectId, ticket.id, text],
  );
  const write = (next: string) => {
    drafts.setComment(ticket.id, next);
    setText(next);
  };
  if (terminal && state === 'editing') return null;
  return (
    <section aria-labelledby={`comment-${ticket.id}`} style={{ display: 'grid', gap: '0.5rem' }}>
      <h2 id={`comment-${ticket.id}`}>Bình luận mới</h2>
      {terminal && (
        <p role="note">
          Ticket đã kết thúc. Bình luận đang chờ xác nhận chỉ có thể gửi lại đúng nội dung cũ hoặc xem trạng
          thái.
        </p>
      )}
      <AttachmentComposer
        draftKey={`comment:${ticket.id}`}
        submission={submission}
        onSubmissionChange={(next) => {
          if (next.kind === 'comment') write(next.text);
        }}
        onStateChange={setState}
        onAccepted={() => write('')}
        onHandle={(next) => {
          handle.current = next;
        }}
      />
      <DraftDiscard
        label="Bỏ bản nháp bình luận"
        state={state}
        handle={() => handle.current}
        onDiscarded={() => write('')}
      />
    </section>
  );
}

/**
 * Read-only ticket→docs links of a terminal ticket (GET `/v2/tickets/:id/docs-links`, same query as the
 * Task6 editor). Nothing here mutates; reading can always be retried.
 */
function TerminalDocsLinks({ ticketId }: { ticketId: string }) {
  const links = useTicketDocsLinks(useRuntime().client, ticketId);
  const rows = links.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section aria-label="Tài liệu liên kết với ticket" style={{ display: 'grid', gap: '0.4rem' }}>
      <h3 style={{ margin: 0 }}>Tài liệu liên kết</h3>
      <p style={{ margin: 0 }}>Ticket đã kết thúc nên liên kết tài liệu chỉ xem.</p>
      {links.isPending ? (
        <p role="status">Đang tải liên kết tài liệu…</p>
      ) : links.isError && !links.data ? (
        <div role="alert">
          <p style={{ margin: 0 }}>Không tải được liên kết tài liệu: {docsFailureText(links.error)}</p>
          <button
            type="button"
            aria-label="Thử lại tải liên kết tài liệu"
            onClick={() => void links.refetch()}
          >
            Thử lại
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p style={{ margin: 0 }}>Không có tài liệu liên kết.</p>
      ) : (
        <ul style={{ margin: 0 }}>
          {rows.map((row) => (
            <li key={`${row.snapshotId}:${row.path}`}>
              <code>{row.path}</code>
            </li>
          ))}
        </ul>
      )}
      {links.hasNextPage && (
        <div>
          <button
            type="button"
            disabled={links.isFetchingNextPage}
            onClick={() => void links.fetchNextPage()}
          >
            Tải thêm liên kết
          </button>
        </div>
      )}
    </section>
  );
}

export function TicketDetail({ ticketId, presentation }: TicketDetailProps) {
  const runtime = useRuntime();
  const query = useTicket(runtime.client, ticketId);
  if (!query.data) {
    const failed = query.error !== null;
    return (
      <article style={stackStyle} aria-busy={!failed}>
        <Headings
          presentation={presentation}
          title={failed ? 'Không tải được ticket' : 'Đang tải ticket'}
          description={failed ? failureText(query.error) : 'Đang lấy dữ liệu mới nhất.'}
        />
        {failed && (
          <div>
            <button type="button" onClick={() => void query.refetch()}>
              Thử lại
            </button>
          </div>
        )}
      </article>
    );
  }
  return <LoadedTicketDetail ticket={query.data} query={query} presentation={presentation} />;
}

function LoadedTicketDetail({
  ticket,
  query,
  presentation,
}: {
  ticket: Ticket;
  query: ReturnType<typeof useTicket>;
  presentation: TicketDetailProps['presentation'];
}) {
  const runtime = useRuntime();
  const subline = useTicketSubline(ticket);
  const pin = ticket.workflowPin;
  const wait = waitNotice(ticket.status, ticket.waitReason);
  const terminal = isTerminal(ticket.status);
  return (
    <article
      style={stackStyle}
      data-testid="ticket-detail"
      data-ticket-id={ticket.id}
      data-revision={ticket.revision}
    >
      <header style={headerStyle}>
        <Headings
          presentation={presentation}
          title={ticket.title}
          description={subline}
          leading={
            <span
              aria-hidden="true"
              data-status-dot={ticket.status}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flex: 'none',
                background: dotColors[ticket.status],
              }}
            />
          }
        />
      </header>
      <InfoTiles ticket={ticket} />
      {query.error && (
        <p role="status" style={noticeStyle}>
          Đang hiển thị dữ liệu đã tải trước đó: {failureText(query.error)}
        </p>
      )}
      {terminal && (
        <p role="note" style={noticeStyle}>
          Ticket đã kết thúc ({statusLabels[ticket.status]}), chỉ xem.
        </p>
      )}
      {wait !== null && (
        <p role="note" style={noticeStyle}>
          {wait}
        </p>
      )}
      <section aria-labelledby={`description-${ticket.id}`}>
        <h2 id={`description-${ticket.id}`}>Mô tả</h2>
        <p style={textStyle}>{ticket.description || 'Chưa có mô tả.'}</p>
      </section>
      <section aria-labelledby={`fields-${ticket.id}`}>
        <h2 id={`fields-${ticket.id}`}>Thông tin</h2>
        <dl style={gridStyle}>
          <Field label="Mã ticket">
            <code>{ticket.id}</code>
          </Field>
          <Field label="Ticket gốc">
            <code>{ticket.rootId}</code>
          </Field>
          <Field label="Ticket cha">{ticket.parentId ? <code>{ticket.parentId}</code> : 'Không có'}</Field>
          <Field label="Loại">{kindLabels[ticket.kind]}</Field>
          <Field label="Bắt buộc">{ticket.mandatory ? 'Có' : 'Không'}</Field>
          <Field label="Workflow đã ghim">
            {pin ? `${pin.workflow === 'bmad' ? 'BMAD' : 'Superpowers'} ${pin.version}` : 'Chưa ghim'}
          </Field>
          <Field label="Skill">{ticket.skill ?? 'Không có'}</Field>
          <Field label="Số vòng sửa">{ticket.repairCycles}/5</Field>
          <Field label="Commit đã merge">
            {ticket.mergedCommit ? <code>{ticket.mergedCommit}</code> : 'Chưa có'}
          </Field>
        </dl>
      </section>
      <section aria-labelledby={`run-${ticket.id}`}>
        <h2 id={`run-${ticket.id}`}>Thực thi hiện tại</h2>
        <dl style={gridStyle}>
          <Field label="Máy">{missing}</Field>
          <Field label="Model">{missing}</Field>
          <Field label="Độ khó">{missing}</Field>
          <Field label="Lượt chạy">{missing}</Field>
          <Field label="Bằng chứng">{missing}</Field>
        </dl>
      </section>
      <ChildTickets ticket={ticket} />
      <section aria-labelledby={`related-${ticket.id}`} style={{ display: 'grid', gap: '0.75rem' }}>
        <h2 id={`related-${ticket.id}`}>Tệp và tài liệu liên quan</h2>
        {terminal ? (
          <TerminalDocsLinks ticketId={ticket.id} />
        ) : (
          <TicketDocsLinksEditor ticketId={ticket.id} />
        )}
        <TicketAttachments
          ticketId={ticket.id}
          client={runtime.client}
          onUnauthorized={() => runtime.session.expire()}
        />
      </section>
      <TicketHistory ticketId={ticket.id} />
      <CommentComposer key={ticket.id} ticket={ticket} terminal={terminal} />
    </article>
  );
}
