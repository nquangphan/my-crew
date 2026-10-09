import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix } from 'node:path';

type LinkStatus = 'ok' | 'missing' | 'external' | 'unverified';
interface Page {
  path: string;
  title: string;
  parentPath: string | null;
  text: string;
  sha256: string;
}
interface Link {
  fromPath: string;
  occurrence: number;
  originalHref: string;
  toPath: string | null;
  fragment: string | null;
  status: LinkStatus;
}

/**
 * Manifest of the throwaway scan repo. It must satisfy the current flows.yaml schema (R1 needs `source`);
 * older bundles also run R2/R4 on `--staged`, so the include glob matches no file in the scan repo.
 */
export const SCAN_MANIFEST = 'version: 1\nsource:\n  include:\n    - "scan-none/**"\nflows: {}\n';

export type FlowsManifestPayload =
  | { status: 'present'; text: string; sha256: string }
  | { status: 'absent' }
  | { status: 'dropped'; reason: 'secret-scan' | 'too-large' };
export interface CommitsPayload {
  base: string | null;
  truncated: boolean;
  items: { sha: string; merge: boolean; paths: string[] }[];
}
export const MANIFEST_MAX_BYTES = 512 * 1024;
const MAX_COMMITS = 200;
const MAX_PATHS = 500;
const MANIFEST_SCAN_PATH = 'docs/scan-flows-yaml.md';

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
}
function gitTry(root: string, args: string[]): string | null {
  try {
    return git(root, args).trim();
  } catch {
    return null;
  }
}

/** Prefer the fetched remote default branch, then local main/master, then HEAD. */
export async function snapshotCommit(root: string): Promise<{ commit: string; fetchFailed: boolean }> {
  let fetchFailed = false;
  if (gitTry(root, ['remote', 'get-url', 'origin'])) {
    try {
      execFileSync(
        'git',
        ['-c', 'core.hooksPath=/dev/null', '-C', root, 'fetch', '--quiet', '--no-tags', '--prune', 'origin'],
        { encoding: 'utf8', timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      );
    } catch {
      fetchFailed = true;
    }
  }
  return { commit: snapshotCommitFromRefs(root), fetchFailed };
}

/** Select an available ref without network access; used to validate repo registration. */
export function snapshotCommitFromRefs(root: string): string {
  const remote = gitTry(root, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
  for (const ref of [remote, 'refs/heads/main', 'refs/heads/master', 'HEAD']) {
    if (!ref) continue;
    const sha = gitTry(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
    if (sha && /^[0-9a-f]{40}$/.test(sha)) return sha;
  }
  throw new Error('Không tìm được commit mặc định');
}

export function isAncestor(root: string, ancestor: string, commit: string): boolean {
  if (!/^[0-9a-f]{40}$/.test(ancestor) || !/^[0-9a-f]{40}$/.test(commit)) return false;
  return (
    spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', ancestor, commit], { timeout: 30_000 })
      .status === 0
  );
}

/** Commits newest first, reachable from `commit` and not from `base`; merges carry no paths. */
export function collectCommits(root: string, commit: string, base: string | null): CommitsPayload {
  const args = ['rev-list', '--parents', `--max-count=${MAX_COMMITS + 1}`, commit];
  if (base) args.push(`^${base}`);
  const lines = git(root, args).split('\n').filter(Boolean);
  let truncated = lines.length > MAX_COMMITS;
  const items = lines.slice(0, MAX_COMMITS).map((line) => {
    const [sha = '', ...parents] = line.trim().split(' ');
    if (parents.length > 1) return { sha, merge: true, paths: [] as string[] };
    const all = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--root', sha])
      .split('\0')
      .filter((p) => p.length > 0 && p.length <= 1024 && ![...p].some((ch) => ch.charCodeAt(0) < 0x20));
    if (all.length > MAX_PATHS) truncated = true;
    return { sha, merge: false, paths: all.slice(0, MAX_PATHS) };
  });
  return { base, truncated, items };
}

/**
 * File names can hold credentials too, so every commit path goes through the same R7 scan as page text
 * (one path per line of a throwaway file) and a flagged path is left out of the payload.
 */
export function scrubCommitPaths(root: string, commits: CommitsPayload): CommitsPayload {
  const unique = [...new Set(commits.items.flatMap((c) => c.paths))];
  if (unique.length === 0) return commits;
  const bundle = checkBundle(root);
  const tmp = mkdtempSync(join(tmpdir(), 'crew-mac-docs-'));
  try {
    git(tmp, ['init', '-q']);
    mkdirSync(join(tmp, 'docs'));
    writeFileSync(join(tmp, 'docs', 'flows.yaml'), SCAN_MANIFEST);
    writeFileSync(join(tmp, 'docs', 'commit-paths.md'), `${unique.join('\n')}\n`);
    git(tmp, ['add', '--', 'docs']);
    const scan = spawnSync(process.execPath, [bundle, 'check', '--staged'], {
      cwd: tmp,
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (scan.error || scan.status === null || scan.status > 1 || /^R1 /m.test(scan.stdout))
      throw new Error('Không chạy được secret-scan');
    const flagged = new Set<string>();
    for (const line of scan.stdout.split('\n')) {
      const match = /^R7 docs\/commit-paths\.md: line (\d+) looks like a credential/.exec(line);
      const path = match?.[1] ? unique[Number(match[1]) - 1] : undefined;
      if (path) flagged.add(path);
    }
    return {
      ...commits,
      items: commits.items.map((c) => ({ ...c, paths: c.paths.filter((p) => !flagged.has(p)) })),
    };
  } finally {
    removeOwnTempDir(tmp);
  }
}

function linksOf(page: Page, pagePaths: ReadonlySet<string>, allDocs: ReadonlySet<string>): Link[] {
  const links: Link[] = [];
  const pattern = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of page.text.matchAll(pattern)) {
    const href = match[1] ?? '';
    const occurrence = links.length + 1;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
      links.push({
        fromPath: page.path,
        occurrence,
        originalHref: href,
        toPath: null,
        fragment: null,
        status: 'external',
      });
      continue;
    }
    const [relative, fragment] = href.split('#', 2);
    if (!relative && fragment) {
      links.push({
        fromPath: page.path,
        occurrence,
        originalHref: href,
        toPath: page.path,
        fragment,
        status: 'ok',
      });
      continue;
    }
    let target: string;
    try {
      target = posix.normalize(posix.join(posix.dirname(page.path), decodeURIComponent(relative ?? '')));
    } catch {
      target = '';
    }
    const inside = target.startsWith('docs/');
    const status: LinkStatus =
      !inside || !target.endsWith('.md')
        ? 'unverified'
        : pagePaths.has(target)
          ? 'ok'
          : allDocs.has(target)
            ? 'unverified'
            : 'missing';
    links.push({
      fromPath: page.path,
      occurrence,
      originalHref: href,
      toPath: inside ? target : null,
      fragment: fragment || null,
      status,
    });
  }
  return links;
}

function checkBundle(root: string): string {
  const path = gitTry(root, ['config', '--get', 'crew-docs.bundle']);
  if (!path || !isAbsolute(path) || !statSync(path).isFile())
    throw new Error('Thiếu crew-docs.bundle hợp lệ');
  return path;
}

export function removeOwnTempDir(path: string): void {
  try {
    const realTmpRoot = realpathSync(tmpdir());
    const realPath = realpathSync(path);
    if (dirname(realPath) === realTmpRoot && basename(realPath).startsWith('crew-mac-docs-')) {
      rmSync(realPath, { recursive: true, force: true });
    }
  } catch {
    // The directory may already be gone; never broaden cleanup beyond a verified path.
  }
}

export function buildDocsSnapshot(root: string, commit: string, repoName = basename(root)) {
  const bundle = checkBundle(root);
  const tmp = mkdtempSync(join(tmpdir(), 'crew-mac-docs-'));
  const checkout = join(tmp, 'checkout');
  try {
    git(root, ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', checkout, commit]);
    const audit = spawnSync(process.execPath, [bundle, 'check', '--all'], {
      cwd: checkout,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const checkExit = audit.status ?? 2;
    const paths = git(root, ['ls-tree', '-r', '-z', commit, '--', 'docs'])
      .split('\0')
      .flatMap((entry) => {
        const match = /^(100644|100755) blob [0-9a-f]+\t(.+)$/.exec(entry);
        return match?.[2] ? [match[2]] : [];
      })
      .filter((p) => p.startsWith('docs/') && p.endsWith('.md'))
      .sort();
    // A new temporary repo makes every committed page an added line for docs-kit's R7 scanner.
    const scanRoot = join(tmp, 'scan');
    mkdirSync(scanRoot);
    git(scanRoot, ['init', '-q']);
    mkdirSync(join(scanRoot, 'docs'));
    writeFileSync(join(scanRoot, 'docs', 'flows.yaml'), SCAN_MANIFEST);
    const binaryPaths = new Set<string>();
    const scanPaths = new Map<string, string>();
    const metadataPaths = new Map<string, string>();
    writeFileSync(join(scanRoot, 'docs', 'repo-metadata.md'), repoName);
    for (const [index, path] of paths.entries()) {
      const text = git(root, ['show', `${commit}:${path}`]);
      const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || basename(path, '.md');
      const metadataPath = `docs/metadata-${index}.md`;
      metadataPaths.set(metadataPath, path);
      writeFileSync(join(scanRoot, metadataPath), `${path}\n${title}\n`);
      if (text.includes('\0')) {
        binaryPaths.add(path);
        continue;
      }
      const scanPath = `docs/page-${index}.md`;
      scanPaths.set(scanPath, path);
      const full = join(scanRoot, scanPath);
      writeFileSync(full, text);
    }
    let manifest: FlowsManifestPayload = { status: 'absent' };
    if (/^100(644|755) blob /.test(git(root, ['ls-tree', commit, '--', 'docs/flows.yaml']))) {
      const text = git(root, ['show', `${commit}:docs/flows.yaml`]);
      if (Buffer.byteLength(text, 'utf8') > MANIFEST_MAX_BYTES || text.includes('\0')) {
        manifest = { status: 'dropped', reason: 'too-large' };
      } else {
        // `docs/flows.yaml` is the scan repo's own manifest, so the text goes under another name.
        writeFileSync(join(scanRoot, MANIFEST_SCAN_PATH), text);
        manifest = {
          status: 'present',
          text,
          sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        };
      }
    }
    git(scanRoot, ['add', '--', 'docs']);
    const scan = spawnSync(process.execPath, [bundle, 'check', '--staged'], {
      cwd: scanRoot,
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (scan.error || scan.status === null || scan.status > 1) throw new Error('Không chạy được secret-scan');
    const droppedPaths = new Set<string>(binaryPaths);
    const metadataDropped = new Set<string>();
    for (const line of scan.stdout.split('\n')) {
      const match = /^R7 (.+?): line \d+ looks like a credential/.exec(line);
      if (match?.[1]) {
        const path = scanPaths.get(match[1]);
        const metadataPath = metadataPaths.get(match[1]);
        if (match[1] === MANIFEST_SCAN_PATH) {
          manifest = { status: 'dropped', reason: 'secret-scan' };
          continue;
        }
        if (match[1] === 'docs/repo-metadata.md') throw new Error('Tên repo không qua secret-scan');
        if (metadataPath) metadataDropped.add(metadataPath);
        else if (path) droppedPaths.add(path);
        else throw new Error('Secret-scan trả đường dẫn không rõ');
      }
    }
    // Only R7 matters here (other rules vary by bundle version); an R1 line means the scan never ran.
    if (/^R1 /m.test(scan.stdout)) throw new Error('Secret-scan không trả kết quả');
    const allDocs = new Set(paths);
    const pages: Page[] = paths
      .filter((path) => !droppedPaths.has(path) && !metadataDropped.has(path))
      .map((path) => {
        const text = git(root, ['show', `${commit}:${path}`]);
        const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || basename(path, '.md');
        const parent = posix.dirname(path);
        return {
          path,
          title,
          parentPath: parent,
          text,
          sha256: createHash('sha256').update(text).digest('hex'),
        };
      });
    const pagePaths = new Set(pages.map((page) => page.path));
    return {
      auditState: checkExit === 0 ? 'verified' : checkExit === 1 ? 'invalid' : 'unverified',
      checkExit,
      manifest,
      pages,
      links: pages.flatMap((page) => linksOf(page, pagePaths, allDocs)),
      dropped: (
        [...droppedPaths]
          .filter((path) => allDocs.has(path))
          .sort()
          .map((path) => ({ path, reason: 'secret-scan' as const })) as {
          path: string;
          reason: 'secret-scan' | 'secret-scan-metadata';
        }[]
      ).concat(
        [...metadataDropped].map(() => ({ path: '<đã che>', reason: 'secret-scan-metadata' as const })),
      ),
    };
  } finally {
    try {
      if (existsSync(checkout)) git(root, ['worktree', 'remove', '--force', checkout]);
    } finally {
      removeOwnTempDir(tmp);
    }
  }
}
