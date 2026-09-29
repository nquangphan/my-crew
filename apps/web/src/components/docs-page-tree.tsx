import type { DocsPageSummary } from '@crew/shared';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '../lib/cn';
import { docsLinkFor } from '../lib/docs-links';
import { buildPageTree } from '../lib/docs-space';
import { errorMessage } from '../lib/format';
import { useDocsSearch, useDocsSearchAcross, useProjects } from '../lib/queries';
import { useDebounced } from '../lib/ui-state';
import { ProjectBadge } from './project-badge';

const ROW = 'flex min-h-11 items-center rounded px-2.5 text-sm no-underline hover:bg-soft xl:min-h-8';

function PageLink({
  projectKey,
  page,
  current,
  indent,
  onNavigate,
}: {
  projectKey: string;
  page: DocsPageSummary;
  current: boolean;
  indent?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      {...docsLinkFor(projectKey, page)}
      onClick={onNavigate}
      aria-current={current ? 'page' : undefined}
      className={cn(
        ROW,
        'text-neutral-ink',
        indent && 'pl-[26px]',
        current && 'bg-accent-bg font-semibold text-accent',
      )}
    >
      <span className="min-w-0 truncate">{page.title}</span>
    </Link>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(ROW, 'w-full gap-1 text-left text-neutral-ink')}
      >
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        {label}
      </button>
      {open && <ul className="m-0 flex list-none flex-col gap-px p-0">{children}</ul>}
    </li>
  );
}

/** One docs search result: a page of some project, with its snippet. */
export interface DocsHit {
  projectId: string;
  path: string;
  title: string;
  flowId: string | null;
  snippet: string;
}

/**
 * Docs search results. With `showProject` (a search across projects) each result carries its project badge;
 * a result whose project is unknown (deleted meanwhile) is skipped.
 */
export function DocsSearchHits({
  items,
  showProject,
  onPick,
  label,
}: {
  items: readonly DocsHit[];
  showProject: boolean;
  onPick?: () => void;
  label: string;
}) {
  const projects = useProjects();
  const keyOf = new Map((projects.data ?? []).map((p) => [p.id, p.key]));
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((item) => {
        const projectKey = keyOf.get(item.projectId);
        if (!projectKey) return null;
        return (
          <li key={`${item.projectId}:${item.path}`}>
            <Link
              {...docsLinkFor(projectKey, item)}
              onClick={onPick}
              className="flex min-h-11 min-w-0 flex-col justify-center gap-0.5 rounded px-2.5 py-1.5 text-ink no-underline hover:bg-soft"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {showProject && <ProjectBadge projectKey={projectKey} className="shrink-0" />}
                <span className="min-w-0 truncate text-sm font-semibold">{item.title}</span>
              </span>
              <span className="line-clamp-2 text-xs break-words text-muted">{item.snippet}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export type DocsSearchScope = 'project' | 'all';

function SearchResults({
  projectId,
  q,
  scope,
  onPick,
}: {
  projectId: string;
  q: string;
  scope: DocsSearchScope;
  onPick: () => void;
}) {
  const one = useDocsSearch(scope === 'project' ? projectId : undefined, q);
  const across = useDocsSearchAcross(q, [], scope === 'all');
  const search = scope === 'all' ? across : one;
  if (search.isLoading) return <p className="m-0 px-2.5 text-[13px] text-muted">Đang tìm…</p>;
  if (search.isError) return <p className="m-0 px-2.5 text-[13px] text-bad">{errorMessage(search.error)}</p>;
  const items: DocsHit[] =
    scope === 'all'
      ? (across.data?.items ?? [])
      : (one.data?.items ?? []).map((item) => ({ ...item, projectId }));
  if (items.length === 0)
    return <p className="m-0 px-2.5 text-[13px] text-muted">Không có trang nào khớp.</p>;
  return (
    <DocsSearchHits
      items={items}
      showProject={scope === 'all'}
      onPick={onPick}
      label={scope === 'all' ? 'Kết quả tìm trong mọi dự án' : 'Kết quả tìm trong space'}
    />
  );
}

const SCOPE_LABEL: Record<DocsSearchScope, string> = { project: 'Dự án này', all: 'Mọi dự án' };

/**
 * The space's left column: space search, then the page tree (Tổng quan, Kiến trúc, Flows, Tra cứu file, and
 * any other synced page under "Khác"), and the read-only hint.
 */
export function DocsPageTree({
  projectKey,
  projectId,
  spaceName,
  pages,
  currentPath,
  onNavigate,
  className,
  switcher,
}: {
  projectKey: string;
  projectId: string;
  spaceName: string;
  pages: readonly DocsPageSummary[];
  currentPath: string | null;
  onNavigate?: () => void;
  className?: string;
  /** The project switcher shown above the search, in place of the space name. */
  switcher?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [scope, setScope] = useState<DocsSearchScope>('project');
  const q = useDebounced(text.trim(), 250);
  const tree = buildPageTree(pages);
  const link = (page: DocsPageSummary, indent?: boolean) => (
    <li key={page.path}>
      <PageLink
        projectKey={projectKey}
        page={page}
        current={page.path === currentPath}
        indent={indent}
        onNavigate={onNavigate}
      />
    </li>
  );

  return (
    <div
      className={cn(
        'flex h-full w-[272px] shrink-0 flex-col gap-2.5 overflow-y-auto border-r border-line bg-panel px-2.5 py-4',
        className,
      )}
    >
      <div className="truncate px-2.5 text-xs font-bold tracking-[0.06em] text-muted uppercase">
        Space · {spaceName}
      </div>
      {switcher && <div className="mx-1 flex min-w-0">{switcher}</div>}
      <div className="mx-1 flex min-h-11 items-center gap-2 rounded border border-line bg-bg px-2.5 text-muted focus-within:border-accent xl:min-h-[30px]">
        <Search size={14} aria-hidden />
        <input
          aria-label="Tìm trong space"
          placeholder="Tìm trong space…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setText('');
          }}
          className="min-w-0 grow bg-transparent text-sm text-ink outline-none"
        />
        {text && (
          <button
            type="button"
            aria-label="Xóa tìm kiếm"
            onClick={() => setText('')}
            className="-mr-1 inline-flex size-9 items-center justify-center xl:size-6"
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
      <fieldset className="mx-1 my-0 flex min-w-0 gap-1 border-0 p-0">
        <legend className="sr-only">Phạm vi tìm kiếm docs</legend>
        {(['project', 'all'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={scope === value}
            onClick={() => setScope(value)}
            className={cn(
              'inline-flex min-h-11 grow items-center justify-center rounded border px-2 text-xs xl:min-h-7',
              scope === value
                ? 'border-accent bg-accent-bg font-semibold text-accent-ink'
                : 'border-line bg-panel text-neutral-ink hover:bg-soft',
            )}
          >
            {SCOPE_LABEL[value]}
          </button>
        ))}
      </fieldset>
      {q ? (
        <SearchResults
          projectId={projectId}
          scope={scope}
          q={q}
          onPick={() => {
            setText('');
            onNavigate?.();
          }}
        />
      ) : (
        <nav aria-label="Cây trang docs">
          <ul className="m-0 flex list-none flex-col gap-px p-0">
            {tree.index && link(tree.index)}
            {tree.architecture && link(tree.architecture)}
            {tree.flows.length > 0 && (
              <Group label={`Flows (${tree.flows.length})`}>
                {tree.flows.map((page) => link(page, true))}
              </Group>
            )}
            {tree.files && link(tree.files)}
            {tree.other.length > 0 && (
              <Group label="Khác">{tree.other.map((page) => link(page, true))}</Group>
            )}
          </ul>
        </nav>
      )}
      <p className="m-0 mt-auto px-2.5 pt-2.5 text-xs text-muted">
        Docs chỉ đọc. Sửa bằng commit trong repo.
      </p>
    </div>
  );
}
