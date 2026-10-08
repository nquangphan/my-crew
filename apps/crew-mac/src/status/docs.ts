import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
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

/** Prefer the remote default branch, then local main/master, then HEAD. Never fetch. */
export function snapshotCommit(root: string): string {
  const remote = gitTry(root, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
  for (const ref of [remote, 'refs/heads/main', 'refs/heads/master', 'HEAD']) {
    if (!ref) continue;
    const sha = gitTry(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
    if (sha && /^[0-9a-f]{40}$/.test(sha)) return sha;
  }
  throw new Error('Không tìm được commit mặc định');
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

export function buildDocsSnapshot(root: string, commit: string) {
  const bundle = checkBundle(root);
  const tmp = mkdtempSync(join(tmpdir(), 'crew-mac-docs-'));
  const checkout = join(tmp, 'checkout');
  git(root, ['worktree', 'add', '--detach', checkout, commit]);
  try {
    const audit = spawnSync(process.execPath, [bundle, 'check', '--all'], {
      cwd: checkout,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const checkExit = audit.status ?? 2;
    const paths = git(root, ['ls-tree', '-r', '--name-only', commit, '--', 'docs'])
      .split('\n')
      .filter((p) => p.startsWith('docs/') && p.endsWith('.md'))
      .sort();
    // A new temporary repo makes every committed page an added line for docs-kit's R7 scanner.
    const scanRoot = join(tmp, 'scan');
    mkdirSync(scanRoot);
    git(scanRoot, ['init', '-q']);
    mkdirSync(join(scanRoot, 'docs'));
    writeFileSync(join(scanRoot, 'docs', 'flows.yaml'), 'version: 1\nflows: {}\n');
    for (const path of paths) {
      const full = join(scanRoot, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, git(root, ['show', `${commit}:${path}`]));
    }
    git(scanRoot, ['add', '--', 'docs']);
    const scan = spawnSync(process.execPath, [bundle, 'check', '--staged'], {
      cwd: scanRoot,
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (scan.error || scan.status === null || scan.status > 1) throw new Error('Không chạy được secret-scan');
    const droppedPaths = new Set<string>();
    for (const line of scan.stdout.split('\n')) {
      const match = /^R7 (.+?): line \d+ looks like a credential/.exec(line);
      if (match?.[1]) droppedPaths.add(match[1]);
    }
    const allDocs = new Set(paths);
    const pages: Page[] = paths
      .filter((path) => !droppedPaths.has(path))
      .map((path) => {
        const text = git(root, ['show', `${commit}:${path}`]);
        const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || basename(path, '.md');
        const parent = posix.dirname(path);
        return {
          path,
          title,
          parentPath: parent === 'docs' ? null : parent,
          text,
          sha256: createHash('sha256').update(text).digest('hex'),
        };
      });
    const pagePaths = new Set(pages.map((page) => page.path));
    return {
      auditState: checkExit === 0 ? 'verified' : checkExit === 1 ? 'invalid' : 'unverified',
      checkExit,
      pages,
      links: pages.flatMap((page) => linksOf(page, pagePaths, allDocs)),
      dropped: [...droppedPaths]
        .filter((path) => allDocs.has(path))
        .sort()
        .map((path) => ({ path, reason: 'secret-scan' as const })),
    };
  } finally {
    git(root, ['worktree', 'remove', '--force', checkout]);
  }
}
