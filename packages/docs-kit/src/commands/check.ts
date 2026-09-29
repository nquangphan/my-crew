import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  commitChanges,
  commitMessage,
  commitPatch,
  firstParent,
  getConfig,
  headCommit,
  isMerging,
  isZeroSha,
  nonMergeCommits,
  resolveCommit,
  stagedChanges,
  stagedPatch,
} from '../git.js';
import { loadManifest, type ManifestResult } from '../manifest.js';
import { checkManifest } from '../rules/r1-manifest.js';
import { checkCoverage } from '../rules/r2-coverage.js';
import { checkFreshness } from '../rules/r3-freshness.js';
import { checkGenerated } from '../rules/r4-generated.js';
import { notInitialized } from '../rules/r5-initialized.js';
import { checkProtected, isDocsInitMessage } from '../rules/r6-protected.js';
import { checkSecrets } from '../rules/r7-secrets.js';
import type { Violation } from '../rules/types.js';
import { commitReader, indexReader, type TreeReader, workingTreeReader } from '../tree.js';

export type CheckMode =
  /** pre-commit: R1, R2, R4 on the index; R3 on the staged diff; R7 on the staged lines. */
  | { kind: 'staged' }
  /** commit-msg: R6 on the staged diff, with the message's trailers (and the docs-init exemption). */
  | { kind: 'commit-msg'; messageFile: string }
  /** CI and Phase 7 gates: R1, R2, R4 at the head; R3, R6, R7 per non-merge commit. */
  | { kind: 'range'; range: string }
  /** pre-push: like `range`, for each ref git is about to push (read from the hook's stdin). */
  | { kind: 'pre-push'; stdin: string }
  /** R1, R2, R4 over the working tree. */
  | { kind: 'all' };

export interface CheckOutcome {
  /** 0 ok, 1 violations, 3 not initialized. */
  code: 0 | 1 | 3;
  violations: Violation[];
  /** Commits checked individually (range and pre-push). */
  commitsChecked: number;
  /**
   * Set when a git hook ran in a repo that has not adopted the docs standard yet: nothing was checked and
   * the hook lets the commit or push through (the standard applies from the docs-init commit on).
   */
  skipped?: 'not-initialized';
}

export class CheckUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckUsageError';
  }
}

export interface CheckOptions {
  /** Override of the gitleaks binary lookup (null disables it). */
  gitleaks?: string | null;
}

const ok = (violations: Violation[], commitsChecked = 0): CheckOutcome => ({
  code: violations.length > 0 ? 1 : 0,
  violations,
  commitsChecked,
});
const uninitialized = (where: string): CheckOutcome => ({
  code: 3,
  violations: [notInitialized(where)],
  commitsChecked: 0,
});

/**
 * A hook in a repo without `docs/flows.yaml` (neither staged nor at HEAD) checks nothing and passes: the
 * owner keeps committing to a repo whose docs-init has not landed yet. Only CI (`--range`, `--all`) and the
 * daemon's docs-init detection report NOT_INITIALIZED.
 */
const notAdopted = (): CheckOutcome => ({
  code: 0,
  violations: [],
  commitsChecked: 0,
  skipped: 'not-initialized',
});

/** The manifest at HEAD (missing when there is no commit yet). */
function headManifest(root: string): ManifestResult {
  const head = headCommit(root);
  return head ? loadManifest(commitReader(root, head)) : { status: 'missing' };
}

const rawOf = (result: ManifestResult) => (result.status === 'missing' ? null : result.raw);

/** Rules on one full tree: R1 always, R2 and R4 when the manifest is valid. */
function treeRules(tree: TreeReader, result: ManifestResult): Violation[] {
  const violations = checkManifest(tree, result);
  if (result.status === 'ok') {
    violations.push(...checkCoverage(tree, result.manifest), ...checkGenerated(tree, result.manifest));
  }
  return violations;
}

/** A custom `core.hooksPath` inside the repo is protected like `.githooks/**`. */
function hooksPathPatterns(root: string): string[] {
  const hooksPath = getConfig(root, 'core.hooksPath', '--local');
  if (!hooksPath) return [];
  const rel = relative(root, resolve(root, hooksPath));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return [];
  return [`${rel.split('\\').join('/')}/**`];
}

/** Drops comment lines and everything below the scissors line, as `git commit` does with the message. */
export function cleanMessage(text: string): string {
  const lines: string[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^# -+ >8 -+$/.test(line)) break;
    if (!line.startsWith('#')) lines.push(line);
  }
  return lines.join('\n');
}

function checkStaged(root: string, options: CheckOptions): CheckOutcome {
  const index = indexReader(root);
  const after = loadManifest(index);
  const before = headManifest(root);
  // Removing the manifest of an adopted repo is still refused.
  if (after.status === 'missing') return before.status === 'missing' ? notAdopted() : uninitialized('index');
  const violations = treeRules(index, after);
  // A commit that adds the manifest is the docs-init candidate: R3 and R6 are checked at commit-msg time,
  // where the Crew-Docs-Init trailer is visible. A merge commit is skipped like in range mode: the
  // commits it brings in are checked on their own.
  if (after.status === 'ok' && before.status !== 'missing' && !isMerging(root)) {
    violations.push(
      ...checkFreshness({
        changes: stagedChanges(root),
        before: before.status === 'ok' ? before.manifest : null,
        after: after.manifest,
      }),
    );
  }
  violations.push(...checkSecrets(stagedPatch(root), options.gitleaks));
  return ok(violations);
}

function checkCommitMessage(root: string, messageFile: string): CheckOutcome {
  let text: string;
  try {
    text = readFileSync(resolve(root, messageFile), 'utf8');
  } catch (error) {
    throw new CheckUsageError(
      `cannot read the commit message file ${messageFile}: ${(error as Error).message}`,
    );
  }
  const message = cleanMessage(text);
  const index = indexReader(root);
  const after = loadManifest(index);
  const before = headManifest(root);
  if (after.status === 'missing') return before.status === 'missing' ? notAdopted() : uninitialized('index');
  if (before.status === 'missing' && isDocsInitMessage(message)) return ok([]);
  if (isMerging(root)) return ok([]);
  return ok(
    checkProtected({
      changes: stagedChanges(root),
      beforeRaw: rawOf(before),
      afterRaw: rawOf(after),
      message,
      extraPatterns: hooksPathPatterns(root),
    }),
  );
}

/** R3, R6 and R7 of one non-merge commit; commits from before the docs init are skipped. */
function commitRules(root: string, sha: string, extraPatterns: string[], options: CheckOptions): Violation[] {
  const after = loadManifest(commitReader(root, sha));
  if (after.status === 'missing') return [];
  const parent = firstParent(root, sha);
  const before: ManifestResult = parent ? loadManifest(commitReader(root, parent)) : { status: 'missing' };
  const message = commitMessage(root, sha);
  const isInit = before.status === 'missing' && isDocsInitMessage(message);
  const violations: Violation[] = [];
  if (!isInit) {
    const changes = commitChanges(root, sha);
    if (after.status === 'ok') {
      violations.push(
        ...checkFreshness({
          changes,
          before: before.status === 'ok' ? before.manifest : null,
          after: after.manifest,
        }),
      );
    }
    violations.push(
      ...checkProtected({
        changes,
        beforeRaw: rawOf(before),
        afterRaw: rawOf(after),
        message,
        extraPatterns,
      }),
    );
  }
  violations.push(...checkSecrets(commitPatch(root, sha), options.gitleaks));
  return violations.map((violation) => ({ ...violation, commit: sha }));
}

interface PushTarget {
  head: string;
  revList: string[];
  /** The remote's current tip of the ref, when the remote already has it. */
  remote?: string;
}

/**
 * `hook`: the pre-push hook, where a ref whose pushed tip and remote tip both lack the manifest belongs to a
 * repo that has not adopted the standard yet and is let through.
 */
function checkCommits(
  root: string,
  targets: PushTarget[],
  options: CheckOptions,
  hook = false,
): CheckOutcome {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  const extraPatterns = hooksPathPatterns(root);
  let checked = 0;
  for (const target of targets) {
    const headTree = commitReader(root, target.head);
    const manifest = loadManifest(headTree);
    if (manifest.status === 'missing') {
      const adopted = target.remote && loadManifest(commitReader(root, target.remote)).status !== 'missing';
      if (hook && !adopted) continue;
      return uninitialized(`commit ${target.head.slice(0, 7)}`);
    }
    checked += 1;
    violations.push(
      ...treeRules(headTree, manifest).map((violation) => ({ ...violation, commit: target.head })),
    );
    for (const sha of nonMergeCommits(root, target.revList)) {
      if (seen.has(sha)) continue;
      seen.add(sha);
      violations.push(...commitRules(root, sha, extraPatterns, options));
    }
  }
  if (hook && targets.length > 0 && checked === 0) return notAdopted();
  return ok(violations, seen.size);
}

function parseRange(root: string, range: string): PushTarget {
  const match = /^(.+?)\.\.(.*)$/.exec(range);
  if (!match || match[1] === undefined || match[1].endsWith('.')) {
    throw new CheckUsageError(`--range takes <base>..<head>, got "${range}"`);
  }
  const base = resolveCommit(root, match[1]);
  const head = resolveCommit(root, match[2] || 'HEAD');
  if (!base) throw new CheckUsageError(`unknown base revision "${match[1]}"`);
  if (!head) throw new CheckUsageError(`unknown head revision "${match[2] || 'HEAD'}"`);
  return { head, revList: [`${base}..${head}`] };
}

/** Refs git is about to push: `<local ref> <local sha> <remote ref> <remote sha>` per line. */
export function parsePrePush(root: string, stdin: string): PushTarget[] {
  const targets: PushTarget[] = [];
  for (const line of stdin.split('\n')) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || !remoteSha || isZeroSha(localSha)) continue;
    const known = !isZeroSha(remoteSha) && resolveCommit(root, remoteSha) !== null;
    targets.push({
      head: localSha,
      // A new branch (or an unknown remote tip) checks every commit that no remote-tracking ref has.
      revList: known ? [`${remoteSha}..${localSha}`] : [localSha, '--not', '--remotes'],
      ...(known ? { remote: remoteSha } : {}),
    });
  }
  return targets;
}

export function runCheck(root: string, mode: CheckMode, options: CheckOptions = {}): CheckOutcome {
  switch (mode.kind) {
    case 'staged':
      return checkStaged(root, options);
    case 'commit-msg':
      return checkCommitMessage(root, mode.messageFile);
    case 'range':
      return checkCommits(root, [parseRange(root, mode.range)], options);
    case 'pre-push':
      return checkCommits(root, parsePrePush(root, mode.stdin), options, true);
    case 'all': {
      const tree = workingTreeReader(root);
      const result = loadManifest(tree);
      if (result.status === 'missing') return uninitialized('working tree');
      return ok(treeRules(tree, result));
    }
  }
}
