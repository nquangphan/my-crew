import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ToolLogEntry } from '../state-db.js';

/** Ticket tools that look the docs up (`crew-docs flow` and `crew-docs where`). */
const DOCS_TOOLS = new Set(['mcp__tickets__docs_flow', 'mcp__tickets__docs_where']);

/** Paths inside the worktree that are not source: the docs themselves and agent config. */
function isNonSource(rel: string): boolean {
  const posix = rel.split(sep).join('/');
  return (
    posix === 'docs' ||
    posix.startsWith('docs/') ||
    posix === '.claude' ||
    posix.startsWith('.claude/') ||
    posix.startsWith('.crew/') ||
    posix === 'AGENTS.md' ||
    posix === 'CLAUDE.md'
  );
}

/** A path relative to the worktree, or null when it lies outside (skills, `$TMPDIR`, the home dir). */
function inWorktree(cwd: string, path: string): string | null {
  const abs = isAbsolute(path) ? path : resolve(cwd, path);
  const rel = relative(resolve(cwd), abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel;
}

/** The path a Grep entry searched (`pattern @ path`); the worktree root when it named none. */
function grepPath(target: string | null): string {
  if (!target) return '.';
  const at = target.lastIndexOf(' @ ');
  return at < 0 ? '.' : target.slice(at + 3);
}

function isDocsEntry(entry: ToolLogEntry, cwd: string): boolean {
  if (DOCS_TOOLS.has(entry.tool)) return true;
  if (entry.tool === 'Read' && entry.target) {
    const rel = inWorktree(cwd, entry.target);
    return rel !== null && rel.split(sep).join('/') === 'docs/index.md';
  }
  if (entry.tool === 'Bash' && entry.target)
    return /(^|[;&|]\s*)crew-docs\s+(flow|where)\b/.test(entry.target);
  return false;
}

function isSourceRead(entry: ToolLogEntry, cwd: string): boolean {
  if (entry.tool !== 'Read' && entry.tool !== 'Grep') return false;
  const path = entry.tool === 'Read' ? entry.target : grepPath(entry.target);
  if (!path) return false;
  const rel = inWorktree(cwd, path);
  return rel !== null && !isNonSource(rel);
}

/**
 * Docs-first: true when the first Read or Grep of a source file in the worktree came after a docs lookup
 * (`docs_flow`, `docs_where`, `crew-docs flow|where`) or a Read of `docs/index.md`. Reads outside the
 * worktree (skill files, temp files) and reads of the docs or agent config are not source reads. A run that
 * read no source at all is docs-first. Denied calls do not count.
 *
 * `log` may hold several runs of one ticket in order (a dev run then its docs job, or a resumed session):
 * the first source read of the ticket decides.
 */
export function docsFirst(log: readonly ToolLogEntry[], cwd: string): boolean {
  for (const entry of log) {
    if (entry.decision !== 'allow') continue;
    if (isDocsEntry(entry, cwd)) return true;
    if (isSourceRead(entry, cwd)) return false;
  }
  return true;
}
