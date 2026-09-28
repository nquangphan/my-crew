import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { commitFiles, indexFiles, readBlob, workingTreeCandidates } from './git.js';

/** A read-only view of one version of the repo: the working tree, the index, or a commit. */
export interface TreeReader {
  /** Shown in messages, e.g. `index` or a short SHA. */
  readonly label: string;
  files(): ReadonlySet<string>;
  read(path: string): string | null;
}

function memo<T>(load: () => T): () => T {
  let value: T | undefined;
  let loaded = false;
  return () => {
    if (!loaded) {
      value = load();
      loaded = true;
    }
    return value as T;
  };
}

/** The checkout on disk, including untracked files that are not ignored (they would be committed). */
export function workingTreeReader(root: string): TreeReader {
  const files = memo(
    () =>
      new Set(
        workingTreeCandidates(root).filter((path) => {
          const full = join(root, path);
          return existsSync(full) && statSync(full).isFile();
        }),
      ),
  );
  return {
    label: 'working tree',
    files,
    read: (path) => {
      const full = join(root, path);
      return existsSync(full) && statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
    },
  };
}

/** What the next commit will contain. */
export function indexReader(root: string): TreeReader {
  const files = memo(() => new Set(indexFiles(root)));
  return { label: 'index', files, read: (path) => readBlob(root, `:${path}`) };
}

export function commitReader(root: string, sha: string): TreeReader {
  const files = memo(() => new Set(commitFiles(root, sha)));
  return { label: sha.slice(0, 7), files, read: (path) => readBlob(root, `${sha}:${path}`) };
}
