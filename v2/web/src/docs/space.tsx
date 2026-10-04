/**
 * Read-only docs space: tree (by the server's `parentPath`), search and one page view, all pinned to the
 * `snapshotId` of the tree that was read. Selection state is owned by the caller (`path`/`onPathChange`), so
 * the router can keep it in the URL; with no `path` the default page of the snapshot is shown.
 */
import { type CSSProperties, useMemo } from 'react';
import { useRuntime } from '../app-runtime.ts';
import type { DocsTree } from '../contracts/docs.ts';
import { ApiFailure } from '../lib/api.ts';
import { contentClassLabels, DocsPageView } from './page.tsx';
import { docsFailureText, useDocsTree } from './queries.ts';
import { DocsSearch } from './search.tsx';

export type DocsSpaceProps = {
  projectId: string;
  path: string | null;
  onPathChange: (path: string | null) => void;
  onOpenTicket?: (ticketId: string, trigger: HTMLElement) => void;
};

type TreeRow = DocsTree['pages'][number];

const layoutStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(14rem, 22rem) minmax(0, 1fr)',
  gap: '1.5rem',
  alignItems: 'start',
};
const treeListStyle: CSSProperties = { listStyle: 'none', margin: 0, paddingLeft: '1rem' };

export function defaultPagePath(pages: TreeRow[]): string | null {
  for (const preferred of ['docs/index.md', 'README.md', 'index.md'])
    if (pages.some((row) => row.path === preferred)) return preferred;
  return pages[0]?.path ?? null;
}

function TreeNodes({
  rows,
  childrenOf,
  selected,
  onSelect,
  seen,
}: {
  rows: TreeRow[];
  childrenOf: Map<string | null, TreeRow[]>;
  selected: string | null;
  onSelect: (path: string) => void;
  seen: ReadonlySet<string>;
}) {
  return (
    <ul style={treeListStyle}>
      {rows.map((row) => {
        const next = new Set(seen).add(row.path);
        const children = (childrenOf.get(row.path) ?? []).filter((child) => !next.has(child.path));
        return (
          <li key={row.path}>
            <button
              type="button"
              aria-current={row.path === selected ? 'page' : undefined}
              onClick={() => onSelect(row.path)}
            >
              {row.title}
              {row.contentClass === 'workflow_artifact' ? ` (${contentClassLabels.workflow_artifact})` : ''}
            </button>
            {children.length > 0 && (
              <TreeNodes
                rows={children}
                childrenOf={childrenOf}
                selected={selected}
                onSelect={onSelect}
                seen={next}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DocsSpaceInner({ projectId, path, onPathChange, onOpenTicket }: DocsSpaceProps) {
  const { client } = useRuntime();
  const tree = useDocsTree(client, projectId);
  const rows = tree.data?.pages;
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, TreeRow[]>();
    const known = new Set((rows ?? []).map((row) => row.path));
    for (const row of rows ?? []) {
      const parent = row.parentPath !== null && known.has(row.parentPath) ? row.parentPath : null;
      map.set(parent, [...(map.get(parent) ?? []), row]);
    }
    return map;
  }, [rows]);

  if (tree.isPending) return <p role="status">Đang tải cây tài liệu…</p>;
  if (tree.isError) {
    const failure = tree.error as ApiFailure;
    return failure instanceof ApiFailure && failure.status === 404 ? (
      <p role="status">Dự án này chưa có tài liệu nào được đồng bộ hoặc nhập vào.</p>
    ) : (
      <p role="alert">{docsFailureText(failure)}</p>
    );
  }
  const data = tree.data;
  if (data.pages.length === 0) return <p role="status">Phiên bản tài liệu này chưa có trang nào.</p>;
  const selected = path ?? defaultPagePath(data.pages);

  return (
    <div style={layoutStyle}>
      <div>
        <DocsSearch projectId={projectId} snapshotId={data.snapshotId} onSelect={onPathChange} />
        <nav aria-label="Cây tài liệu">
          <TreeNodes
            rows={childrenOf.get(null) ?? []}
            childrenOf={childrenOf}
            selected={selected}
            onSelect={onPathChange}
            seen={new Set()}
          />
        </nav>
      </div>
      <main aria-label="Nội dung tài liệu" data-focus-fallback tabIndex={-1}>
        {selected && (
          <DocsPageView
            projectId={projectId}
            snapshotId={data.snapshotId}
            path={selected}
            tree={data}
            onNavigate={onPathChange}
            onOpenTicket={onOpenTicket}
          />
        )}
      </main>
    </div>
  );
}

/** Keyed by project: switching project drops search text and every in-flight view of the old project. */
export function DocsSpace(props: DocsSpaceProps) {
  return (
    <section aria-labelledby="docs-space-title">
      <h1 id="docs-space-title">Tài liệu</h1>
      <DocsSpaceInner key={props.projectId} {...props} />
    </section>
  );
}
