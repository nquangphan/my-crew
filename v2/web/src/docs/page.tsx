/**
 * One docs page. The metadata block (commit, receive time, audit, docs state, content class) is always
 * rendered next to the text, and a page that is not verified/current is flagged instead of being presented
 * as the current truth. Markdown is rendered with GFM only: raw HTML is never enabled, every link goes through
 * `resolveDocLink`, external links open with noopener/noreferrer, and images are never fetched.
 */
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useRuntime } from '../app-runtime.ts';
import type { DocsPage, DocsTree } from '../contracts/docs.ts';
import { formatTime } from '../tickets/queries.ts';
import { externalLinkRel, isRemoteImage, resolveDocLink } from './links.ts';
import { docsFailureText, relatedTicketsCap, useDocsPage, useProjectDocsState } from './queries.ts';

export const auditLabels = {
  unverified: 'Chưa xác minh',
  invalid: 'Không hợp lệ',
  verified: 'Đã xác minh',
} as const;
export const contentClassLabels = {
  implemented: 'Đã triển khai',
  workflow_artifact: 'Thiết kế/kế hoạch',
  mixed: 'Hỗn hợp',
} as const;
export const docsStateLabels = {
  missing: 'Chưa có tài liệu',
  unverified: 'Chưa xác minh',
  invalid: 'Không hợp lệ',
  current: 'Hiện hành',
  stale: 'Đã cũ so với commit mong đợi',
} as const;
const docsStateWarnings = {
  missing: 'Dự án chưa có tài liệu.',
  unverified: 'Tài liệu chưa được xác minh với mã nguồn; không dùng làm nguồn sự thật.',
  invalid: 'Tài liệu không hợp lệ theo kiểm tra; không dùng làm nguồn sự thật.',
  stale: 'Tài liệu đã cũ so với commit mong đợi của dự án; nội dung có thể không còn đúng.',
} as const;

const noticeStyle: CSSProperties = {
  margin: 0,
  padding: '0.6rem 0.8rem',
  border: '1px solid currentColor',
  borderRadius: '0.5rem',
};
const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(8rem, max-content) 1fr',
  gap: '0.35rem 1rem',
  margin: 0,
};
const textStyle: CSSProperties = { overflowWrap: 'anywhere', minWidth: 0 };

export type DocsPageViewProps = {
  projectId: string;
  snapshotId: string;
  path: string;
  tree: DocsTree;
  onNavigate: (path: string) => void;
  onOpenTicket?: (ticketId: string, trigger: HTMLElement) => void;
};

function Metadata({ page, docsState }: { page: DocsPage; docsState: ReactNode }) {
  return (
    <section aria-label="Thông tin phiên bản tài liệu">
      <dl style={gridStyle}>
        <dt>Commit</dt>
        <dd style={textStyle}>{page.sourceCommit ?? 'Không có commit'}</dd>
        <dt>Nhận lúc</dt>
        <dd>
          <time dateTime={page.receivedAt}>{formatTime(page.receivedAt)}</time>
        </dd>
        <dt>Kiểm tra</dt>
        <dd>{auditLabels[page.auditState]}</dd>
        <dt>Trạng thái tài liệu</dt>
        <dd>{docsState}</dd>
        <dt>Loại nội dung</dt>
        <dd>{contentClassLabels[page.contentClass]}</dd>
        <dt>Phiên bản</dt>
        <dd style={textStyle}>
          <code>{page.snapshotId}</code> · sha256 <code>{page.sha256.slice(0, 12)}</code>
        </dd>
      </dl>
    </section>
  );
}

function RelatedTickets({
  ids,
  onOpenTicket,
}: {
  ids: string[];
  onOpenTicket?: DocsPageViewProps['onOpenTicket'];
}) {
  if (ids.length === 0) return <p>Chưa có ticket nào liên kết với trang này.</p>;
  return (
    <section aria-label="Ticket liên quan">
      <h3>Ticket liên quan</h3>
      <p>
        {ids.length >= relatedTicketsCap
          ? `Máy chủ chỉ trả tối đa ${relatedTicketsCap} ticket (giới hạn ${relatedTicketsCap}); danh sách có thể chưa đầy đủ.`
          : 'Danh sách do máy chủ trả về.'}
      </p>
      <ul>
        {ids.map((id) => (
          <li key={id}>
            {onOpenTicket ? (
              <button type="button" onClick={(event) => onOpenTicket(id, event.currentTarget)}>
                Mở ticket {id.slice(0, 8)}
              </button>
            ) : (
              <code>{id}</code>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function markdownComponents(props: DocsPageViewProps, pages: ReadonlySet<string>): Components {
  const classOf = new Map(props.tree.pages.map((row) => [row.path, row.contentClass]));
  return {
    a({ href, children }) {
      const destination = resolveDocLink({
        href: href ?? '',
        currentPath: props.path,
        projectId: props.projectId,
        snapshotId: props.snapshotId,
        pages,
      });
      if (destination.kind === 'external')
        return (
          <a href={destination.href} target="_blank" rel={externalLinkRel}>
            {children}
          </a>
        );
      if (destination.kind === 'blocked')
        return (
          <span title={destination.reason}>
            {children} <em>({destination.reason})</em>
          </span>
        );
      const target = destination.path;
      const targetClass = classOf.get(target);
      const here = classOf.get(props.path);
      return (
        <>
          <a
            href={`#${encodeURI(target)}`}
            onClick={(event: MouseEvent) => {
              event.preventDefault();
              props.onNavigate(target);
            }}
          >
            {children}
          </a>
          {targetClass && targetClass !== here ? <em> ({contentClassLabels[targetClass]})</em> : null}
        </>
      );
    },
    img({ src, alt }) {
      const source = typeof src === 'string' ? src : '';
      return (
        <span>
          <em>Ảnh không tự tải: {alt || 'không có mô tả'}</em>
          {isRemoteImage(source) && /^https?:\/\//i.test(source.trim()) ? (
            <>
              {' '}
              <a href={source.trim()} target="_blank" rel={externalLinkRel}>
                Mở ảnh gốc
              </a>
            </>
          ) : null}
        </span>
      );
    },
  };
}

export function DocsPageView(props: DocsPageViewProps) {
  const { client } = useRuntime();
  const page = useDocsPage(client, props.projectId, props.snapshotId, props.path);
  const state = useProjectDocsState(client, props.projectId);
  const title = props.tree.pages.find((row) => row.path === props.path)?.title ?? props.path;

  if (page.isPending) return <p role="status">Đang tải trang tài liệu…</p>;
  if (page.isError)
    return (
      <p role="alert" style={noticeStyle}>
        {docsFailureText(page.error)}
      </p>
    );
  const data = page.data;
  const docsState = state.data;
  const stateLabel = docsState
    ? docsStateLabels[docsState]
    : state.isError
      ? 'Chưa xác định'
      : 'Đang xác định…';
  const warnings: string[] = [];
  if (docsState && docsState !== 'current') warnings.push(docsStateWarnings[docsState]);
  else if (!docsState && state.isError)
    warnings.push('Không xác định được trạng thái tài liệu; chưa thể coi đây là bản hiện hành.');
  if (data.auditState !== 'verified' && !(docsState && docsState !== 'current'))
    warnings.push(`Trang này ${auditLabels[data.auditState].toLowerCase()}; không dùng làm nguồn sự thật.`);
  if (data.contentClass === 'workflow_artifact')
    warnings.push('Đây là tài liệu thiết kế/kế hoạch, chưa chắc đã được triển khai.');
  const pages = new Set(props.tree.pages.map((row) => row.path));

  return (
    <div data-testid="docs-page" data-path={data.path} data-snapshot-id={data.snapshotId}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p style={textStyle}>
        <code>{data.path}</code>
      </p>
      <Metadata page={data} docsState={stateLabel} />
      {warnings.length > 0 && (
        <p role="alert" style={noticeStyle}>
          {warnings.join(' ')}
        </p>
      )}
      <article style={textStyle}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) => url}
          components={markdownComponents(props, pages)}
        >
          {data.text}
        </ReactMarkdown>
      </article>
      <RelatedTickets ids={data.relatedTicketIds} onOpenTicket={props.onOpenTicket} />
    </div>
  );
}
