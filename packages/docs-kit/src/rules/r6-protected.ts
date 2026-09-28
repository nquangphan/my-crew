import picomatch from 'picomatch';
import { type FileChange, hasTrailer } from '../git.js';
import { FLOWS_MANIFEST_PATH } from '../manifest.js';
import type { Violation } from './types.js';

export const OWNER_APPROVED_TRAILER = 'Crew-Owner-Approved';
export const DOCS_INIT_TRAILER = 'Crew-Docs-Init';
const TICKET_KEY = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

/**
 * Repo config an agent must not change on its own: agent settings, the hook scripts and hook-manager
 * configs that run crew-docs, and the CI wiring that re-runs it.
 */
export const PROTECTED_PATTERNS: readonly string[] = [
  '.claude/**',
  '.githooks/**',
  'CLAUDE.md',
  '.husky/**',
  'lefthook.yml',
  'lefthook.yaml',
  '.lefthook.yml',
  '.lefthook.yaml',
  '.github/workflows/crew-docs.yml',
  '.github/crew-docs/**',
];

/** Sections of `flows.yaml` that widen or narrow what the checks cover. */
export const PROTECTED_SECTIONS = ['source', 'unassigned', 'shared'] as const;

export interface ProtectedInput {
  changes: readonly FileChange[];
  /** Parsed YAML of `flows.yaml` before and after (null when absent or unparseable). */
  beforeRaw: unknown;
  afterRaw: unknown;
  /** The commit message; trailers are read from any line so they survive a squash. */
  message: string;
  /** Extra protected globs, e.g. a custom `core.hooksPath` directory inside the repo. */
  extraPatterns?: readonly string[];
}

export function isOwnerApproved(message: string): boolean {
  return hasTrailer(message, OWNER_APPROVED_TRAILER, TICKET_KEY);
}

export function isDocsInitMessage(message: string): boolean {
  return hasTrailer(message, DOCS_INIT_TRAILER, /^true$/i);
}

function section(raw: unknown, key: string): string {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined;
  return JSON.stringify(value ?? null);
}

/** R6: outside the docs-init commit, protected paths and manifest sections need the owner-approved trailer. */
export function checkProtected(input: ProtectedInput): Violation[] {
  if (isOwnerApproved(input.message)) return [];
  const isProtected = picomatch([...PROTECTED_PATTERNS, ...(input.extraPatterns ?? [])], { dot: true });
  const hint = `needs the owner's approval: add the trailer "${OWNER_APPROVED_TRAILER}: <ticket-key>" (set only for tickets marked "config change allowed")`;
  const violations: Violation[] = [];
  const seen = new Set<string>();
  for (const change of input.changes) {
    for (const path of change.oldPath ? [change.oldPath, change.path] : [change.path]) {
      if (isProtected(path) && !seen.has(path)) {
        seen.add(path);
        violations.push({ rule: 'R6', path, message: `protected path changed; ${hint}` });
      }
    }
  }
  const manifestTouched = input.changes.some(
    (change) => change.path === FLOWS_MANIFEST_PATH || change.oldPath === FLOWS_MANIFEST_PATH,
  );
  if (manifestTouched) {
    const changed = PROTECTED_SECTIONS.filter(
      (key) => section(input.beforeRaw, key) !== section(input.afterRaw, key),
    );
    if (changed.length > 0) {
      const initHint =
        input.beforeRaw === null
          ? ` (the docs-init commit carries "${DOCS_INIT_TRAILER}: true" instead)`
          : '';
      violations.push({
        rule: 'R6',
        path: FLOWS_MANIFEST_PATH,
        message: `protected section(s) ${changed.join(', ')} changed; ${hint}${initHint}`,
      });
    }
  }
  return violations;
}
