import type { DocsPageResponse, DocsPageSummary, DocsSnapshotInfo } from '@crew/shared';
import { Link } from '@tanstack/react-router';
import { ExternalLink, Info } from 'lucide-react';
import { type ReactNode, type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { Breadcrumbs, type Crumb } from '../layout/breadcrumbs';
import { docsLinkFor } from '../lib/docs-links';
import { blobUrl, createSlugger, resolveDocsHref, stripLeadingTitle } from '../lib/docs-space';
import { formatDateTime } from '../lib/format';
import { DocsToc, scrollToHeading, type TocHeading } from './docs-toc';
import { InfoTip } from './ui/info-tip';

/** The subset of a hast tree the heading-id plugin walks. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const HEADING = /^h[1-6]$/;

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/**
 * Gives every heading a slug id. It runs after rehype-sanitize, so the ids come only from the heading text
 * (never from author-supplied attributes) and need no `user-content-` prefix: the TOC links and in-page
 * `#anchors` use the same slugs.
 */
function rehypeHeadingIds() {
  return (tree: HastNode) => {
    const slug = createSlugger();
    const visit = (node: HastNode) => {
      if (node.type === 'element' && node.tagName && HEADING.test(node.tagName)) {
        node.properties = { ...node.properties, id: slug(textOf(node)) };
        return;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}

const EXTERNAL_REL = 'noopener noreferrer nofollow';

interface LinkContext {
  projectKey: string;
  pagePath: string;
  pages: ReadonlyMap<string, DocsPageSummary>;
  repoUrl: string;
  commit: string;
}

/**
 * Links in docs: `#anchors` scroll inside the page, relative paths to a synced page navigate inside the
 * space, other repo paths go to the forge (https remotes only), external URLs open in a new tab.
 */
function DocsLink({ href, children, context }: { href?: string; children: ReactNode; context: LinkContext }) {
  if (!href) return <span>{children}</span>;
  if (href.startsWith('#')) {
    const id = decodeURIComponentSafe(href.slice(1));
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          scrollToHeading(id);
        }}
      >
        {children}
      </a>
    );
  }
  const repoPath = resolveDocsHref(context.pagePath, href);
  if (repoPath !== null) {
    const page = context.pages.get(repoPath);
    if (page) return <Link {...docsLinkFor(context.projectKey, page)}>{children}</Link>;
    const external = blobUrl(context.repoUrl, context.commit, repoPath);
    if (!external) return <span title={repoPath}>{children}</span>;
    return (
      <a href={external} target="_blank" rel={EXTERNAL_REL}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel={EXTERNAL_REL}>
      {children}
    </a>
  );
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Renders a docs page from the repo snapshot. Raw HTML is never parsed and rehype-sanitize (GitHub schema)
 * strips dangerous URLs and attributes; wide tables and code blocks scroll inside their own box.
 */
export function DocsMarkdown({ source, context }: { source: string; context: LinkContext }) {
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => (
        <DocsLink href={href} context={context}>
          {children}
        </DocsLink>
      ),
      table: ({ node: _node, ...props }) => (
        <div className="docs-scroll">
          <table {...props} />
        </div>
      ),
      pre: ({ node: _node, ...props }) => (
        <div className="docs-scroll">
          <pre {...props} />
        </div>
      ),
    }),
    [context],
  );
  return (
    <div className="prose-crew docs-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize, rehypeHeadingIds]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

/** Collects the article's h2/h3 headings after each render (the TOC links to exactly these ids). */
function useHeadings(root: RefObject<HTMLElement | null>): TocHeading[] {
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  useLayoutEffect(() => {
    const found: TocHeading[] = [...(root.current?.querySelectorAll('h2[id], h3[id]') ?? [])].map((el) => ({
      id: el.id,
      text: el.textContent?.trim() ?? '',
      level: el.tagName === 'H3' ? 3 : 2,
    }));
    setHeadings((current) => (JSON.stringify(current) === JSON.stringify(found) ? current : found));
  });
  return headings;
}

export interface DocsPageViewProps {
  projectKey: string;
  spaceName: string;
  page: DocsPageResponse['page'];
  snapshot: DocsSnapshotInfo;
  /** Every page of the snapshot, to keep relative links inside the space. */
  pages: readonly DocsPageSummary[];
  repoUrl: string;
  /** Phone and tablet: the TOC becomes a collapsed block and `aside` follows the article. */
  compact: boolean;
  /** Shown above the page content (the file lookup on "Tra cứu file"). */
  before?: ReactNode;
  /** Shown after the page content (a flow's files table). */
  after?: ReactNode;
  /** The side panel under the TOC (a flow's related tickets). */
  aside?: ReactNode;
}

/**
 * One page of the space: breadcrumbs, title, the commit it comes from with a forge link, the rendered page
 * and its table of contents.
 */
export function DocsPageView(props: DocsPageViewProps) {
  const { projectKey, spaceName, page, snapshot, pages, repoUrl, compact, before, after, aside } = props;
  const article = useRef<HTMLElement>(null);
  const headings = useHeadings(article);
  const pageMap = useMemo(() => new Map(pages.map((p) => [p.path, p])), [pages]);
  const context = useMemo<LinkContext>(
    () => ({ projectKey, pagePath: page.path, pages: pageMap, repoUrl, commit: snapshot.commit }),
    [projectKey, page.path, pageMap, repoUrl, snapshot.commit],
  );
  const forgeUrl = blobUrl(repoUrl, snapshot.commit, page.path);
  const crumbs: Crumb[] = [
    { label: 'Tài liệu', link: { to: '/docs' } },
    { label: spaceName, link: { to: '/projects/$projectKey/docs', params: { projectKey }, search: {} } },
    ...(page.kind === 'flow' ? [{ label: 'Flows' }] : []),
    { label: page.title },
  ];
  const yaml = page.path.endsWith('.yaml');

  return (
    <div className="flex gap-7">
      <article
        ref={article}
        className="flex max-w-[780px] min-w-0 grow flex-col gap-3"
        aria-label={page.title}
      >
        <Breadcrumbs items={crumbs} />
        <h1 className="m-0 text-[22px] leading-tight font-semibold xl:text-[28px]">{page.title}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          <span>
            Cập nhật ở commit{' '}
            <code className="font-mono" title={snapshot.commit}>
              {snapshot.commit.slice(0, 7)}
            </code>{' '}
            lúc <time dateTime={snapshot.syncedAt}>{formatDateTime(snapshot.syncedAt)}</time>
          </span>
          {forgeUrl && (
            <>
              <span aria-hidden className="hidden md:inline">
                ·
              </span>
              <a
                href={forgeUrl}
                target="_blank"
                rel={EXTERNAL_REL}
                className="inline-flex items-center gap-1"
              >
                Xem trên GitHub <ExternalLink size={12} aria-hidden />
              </a>
            </>
          )}
          <span aria-hidden className="hidden md:inline">
            ·
          </span>
          <InfoTip
            label="Chỉnh sửa"
            trigger={
              <span className="inline-flex min-h-11 items-center gap-1 text-muted xl:min-h-0">
                <Info size={13} aria-hidden /> Chỉnh sửa
              </span>
            }
          >
            Docs chỉ đọc vì git là nguồn gốc. Sửa file trong repo rồi commit; trang tự cập nhật sau lần đồng
            bộ kế tiếp.
          </InfoTip>
        </div>
        {compact && <DocsToc headings={headings} variant="collapsed" />}
        {before}
        {yaml ? (
          <div className="docs-scroll">
            <pre className="m-0 p-3 font-mono text-[12.5px] leading-relaxed">
              <code>{page.content}</code>
            </pre>
          </div>
        ) : (
          <DocsMarkdown source={stripLeadingTitle(page.content)} context={context} />
        )}
        {after}
        {compact && aside}
      </article>
      {!compact && (
        <div className="sticky top-0 flex w-60 shrink-0 flex-col gap-[18px] self-start">
          <DocsToc headings={headings} variant="sidebar" />
          {aside}
        </div>
      )}
    </div>
  );
}
