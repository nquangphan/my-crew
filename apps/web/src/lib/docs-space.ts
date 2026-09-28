import type { DocsPageSummary, FlowFileRole, FlowsManifest } from '@crew/shared';

/** Repo path of the space home page. */
export const DOCS_HOME_PATH = 'docs/index.md';

export const FLOW_ROLE_LABEL: Record<FlowFileRole, string> = {
  entrypoint: 'Điểm vào',
  file: 'File',
  test: 'Test',
  shared: 'Dùng chung',
};

export interface DocsPageTree {
  index: DocsPageSummary | null;
  architecture: DocsPageSummary | null;
  /** One child page per flow, sorted by title. */
  flows: DocsPageSummary[];
  files: DocsPageSummary | null;
  /** AGENTS.md first, then the remaining docs (extra markdown pages, flows.yaml) by title. */
  other: DocsPageSummary[];
}

const byTitle = (a: DocsPageSummary, b: DocsPageSummary) =>
  a.title.localeCompare(b.title, 'vi') || a.path.localeCompare(b.path);

/** Groups the snapshot's pages into the space's page tree. */
export function buildPageTree(pages: readonly DocsPageSummary[]): DocsPageTree {
  const first = (kind: DocsPageSummary['kind']) => pages.find((page) => page.kind === kind) ?? null;
  return {
    index: first('index'),
    architecture: first('architecture'),
    flows: pages.filter((page) => page.kind === 'flow').sort(byTitle),
    files: first('files'),
    other: [
      ...pages.filter((page) => page.kind === 'agents'),
      ...pages.filter((page) => page.kind === 'other').sort(byTitle),
    ],
  };
}

/** Pages in tree order (the fallback home when `docs/index.md` is missing). */
export function treeOrder(tree: DocsPageTree): DocsPageSummary[] {
  return [tree.index, tree.architecture, ...tree.flows, tree.files, ...tree.other].filter(
    (page): page is DocsPageSummary => page !== null,
  );
}

export type DocsTarget =
  | { kind: 'page'; page: DocsPageSummary }
  | { kind: 'missing'; what: 'flow' | 'path'; value: string };

/** Which page the URL asks for: `?flow=` first, then `?path=`, else the space home. */
export function resolveDocsTarget(
  pages: readonly DocsPageSummary[],
  manifest: FlowsManifest | null,
  search: { flow?: string; path?: string },
): DocsTarget {
  const byPath = (path: string) => pages.find((page) => page.path === path);
  if (search.flow) {
    const doc = manifest?.flows[search.flow]?.doc;
    const page = (doc && byPath(doc)) || pages.find((p) => p.kind === 'flow' && p.flowId === search.flow);
    return page ? { kind: 'page', page } : { kind: 'missing', what: 'flow', value: search.flow };
  }
  if (search.path) {
    const page = byPath(search.path);
    return page ? { kind: 'page', page } : { kind: 'missing', what: 'path', value: search.path };
  }
  const home = byPath(DOCS_HOME_PATH) ?? treeOrder(buildPageTree(pages))[0];
  return home ? { kind: 'page', page: home } : { kind: 'missing', what: 'path', value: DOCS_HOME_PATH };
}

/**
 * The GitHub (or any https forge) URL of a file at a commit. Only `https://` repo URLs get a link, so a
 * `git@` remote or a crafted scheme never ends up in an href.
 */
export function blobUrl(repoUrl: string, commit: string, path: string): string | null {
  if (!/^https:\/\/[^\s/]+\//.test(repoUrl) || !/^[0-9a-f]{7,40}$/.test(commit)) return null;
  const base = repoUrl.replace(/\/+$/, '').replace(/\.git$/, '');
  const encoded = path
    .split('/')
    .filter((segment) => segment !== '')
    .map(encodeURIComponent)
    .join('/');
  return `${base}/blob/${commit}/${encoded}`;
}

/**
 * Resolves a link inside a docs page to a repo path, relative to the page (`flows/x.md`, `../architecture.md`)
 * or to the repo root (`/docs/x.md`). Returns null for external URLs, pure `#anchors` and paths that climb
 * above the repo root.
 */
export function resolveDocsHref(fromPath: string, href: string): string | null {
  if (href === '' || href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return null;
  }
  const clean = href.replace(/[?#].*$/, '');
  if (clean === '') return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return null;
  }
  const segments = decoded.startsWith('/') ? [] : fromPath.split('/').slice(0, -1);
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length > 0 ? segments.join('/') : null;
}

export interface FlowFile {
  path: string;
  role: FlowFileRole;
}

/** Every file the manifest lists for one flow: entry points, files, tests, then the shared files it uses. */
export function flowFiles(manifest: FlowsManifest, flowId: string): FlowFile[] {
  const flow = manifest.flows[flowId];
  if (!flow) return [];
  return [
    ...flow.entrypoints.map((path) => ({ path, role: 'entrypoint' as const })),
    ...flow.files.map((path) => ({ path, role: 'file' as const })),
    ...flow.tests.map((path) => ({ path, role: 'test' as const })),
    ...Object.entries(manifest.shared)
      .filter(([, flows]) => flows.includes(flowId))
      .map(([path]) => ({ path, role: 'shared' as const })),
  ];
}

/** Every repo path the manifest mentions, sorted (suggestions for the file lookup). */
export function manifestPaths(manifest: FlowsManifest): string[] {
  const paths = new Set<string>();
  for (const flow of Object.values(manifest.flows)) {
    for (const path of [...flow.entrypoints, ...flow.files, ...flow.tests]) paths.add(path);
  }
  for (const path of Object.keys(manifest.shared)) paths.add(path);
  for (const entry of manifest.unassigned) paths.add(entry.path);
  return [...paths].sort();
}

/** Normalizes a typed path to the manifest's repo-relative form (`./src/x.ts` and `/src/x.ts` → `src/x.ts`). */
export function normalizeLookupPath(input: string): string {
  return input
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/|\/)+/, '');
}

/** Drops a leading `# Title` line: the page header already shows the title. */
export function stripLeadingTitle(markdown: string): string {
  return markdown.replace(/^\s*#[ \t]+[^\n]*\n?/, '');
}

/** Id base of a heading: its lowercase letters and digits, words joined by dashes. */
function slugBase(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'muc'
  );
}

/** GitHub-style heading slugs: repeated headings get `-1`, `-2`… suffixes. */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = slugBase(text);
    let slug = base;
    let count = seen.get(base) ?? 0;
    while (seen.has(slug)) {
      count += 1;
      slug = `${base}-${count}`;
    }
    seen.set(base, count);
    seen.set(slug, 0);
    return slug;
  };
}
