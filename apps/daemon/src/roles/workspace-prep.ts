import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Ticket } from '@crew/shared';
import { installHooks } from '../git/docs-kit-bridge.js';

interface Run {
  code: number;
  out: string;
}

function git(cwd: string, args: readonly string[]): Run {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    code: result.status ?? 2,
    out: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
  };
}

/** A commit another ticket produced that this worktree builds on. */
export interface BaseHead {
  key: string;
  sha: string;
}

/**
 * Merges each head the worktree does not contain yet (finished dependencies, the docs-init commit, earlier
 * bugs of the chain), so the run starts from the work it builds on. A worktree with uncommitted changes or a
 * merge in progress is left alone (a retry continues where the last run stopped). A conflict stays in the
 * worktree for the agent to resolve; the returned note tells it which files.
 */
export function mergeBaseHeads(
  cwd: string,
  heads: readonly BaseHead[],
): { merged: string[]; note: string | null } {
  const merged: string[] = [];
  if (heads.length === 0) return { merged, note: null };
  if (git(cwd, ['status', '--porcelain', '--untracked-files=no']).out !== '') return { merged, note: null };
  if (git(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).code === 0) return { merged, note: null };
  for (const head of heads) {
    if (git(cwd, ['merge-base', '--is-ancestor', head.sha, 'HEAD']).code === 0) continue;
    const merge = git(cwd, ['merge', '--no-edit', '-m', `Merge ${head.key} (nền của ticket)`, head.sha]);
    if (merge.code === 0) {
      merged.push(head.key);
      continue;
    }
    const files = git(cwd, ['diff', '--name-only', '--diff-filter=U']).out;
    if (files === '') {
      git(cwd, ['merge', '--abort']);
      return {
        merged,
        note: `Daemon không merge được ${head.key} vào worktree: ${merge.out.slice(0, 2_000)}`,
      };
    }
    return {
      merged,
      note: [
        `## Xung đột merge trong worktree`,
        `Daemon merge commit của ${head.key} (${head.sha.slice(0, 12)}) làm nền cho ticket này và gặp xung đột ở:`,
        ...files.split('\n').map((file) => `- \`${file}\``),
        'Giải quyết từng file (sửa rồi `git add`), không commit: job docs sẽ kết thúc merge cùng commit của bạn.',
      ].join('\n'),
    };
  }
  return { merged, note: null };
}

/** Finished tickets whose `head_sha` a dev or bug worktree builds on. */
export function baseHeadsFor(input: {
  ticket: Ticket;
  siblings: readonly Ticket[];
  headOf: ReadonlyMap<string, string>;
}): BaseHead[] {
  const { ticket, siblings, headOf } = input;
  const heads: BaseHead[] = [];
  const add = (sibling: Ticket | undefined) => {
    const sha = sibling ? headOf.get(sibling.id) : undefined;
    if (sibling && sha && !heads.some((head) => head.sha === sha)) heads.push({ key: sibling.key, sha });
  };
  add(siblings.find((sibling) => sibling.type === 'docs_init' && sibling.status === 'done'));
  for (const id of ticket.dependsOn)
    add(siblings.find((sibling) => sibling.id === id && sibling.status === 'done'));
  if (ticket.type === 'bug' && ticket.originDevId) {
    const chain = siblings
      .filter(
        (sibling) =>
          sibling.status === 'done' &&
          (sibling.id === ticket.originDevId || sibling.originDevId === ticket.originDevId) &&
          sibling.bugCycle < ticket.bugCycle,
      )
      .sort((a, b) => a.bugCycle - b.bugCycle || a.createdAt.localeCompare(b.createdAt));
    for (const sibling of chain) add(sibling);
  }
  return heads;
}

/** Changed or untracked paths of a checkout (`git status -z`, every untracked file listed). */
function changedPaths(repo: string): Set<string> {
  const result = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
    cwd: repo,
    encoding: 'utf8',
  });
  const paths = new Set<string>();
  const entries = (result.stdout ?? '').split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as string;
    if (entry.length < 4) continue;
    paths.add(entry.slice(3));
    // A rename or copy is followed by its source path.
    if (entry[0] === 'R' || entry[0] === 'C') i++;
  }
  return paths;
}

const HOOK_PATH = /^(\.githooks\/|\.husky\/|\.?lefthook\.ya?ml$)/;

/**
 * Docs-init: `crew-docs install-hooks` refuses to run in a linked worktree, so the daemon runs it in the
 * main checkout, copies the hook files it wrote into the docs-init worktree (they belong in the docs-init
 * commit, so every later worktree has them), and restores the main checkout so the later fast-forward of
 * the default branch does not trip over untracked copies. The git config it sets is shared by every worktree,
 * so the docs-init commit itself runs through the hooks.
 */
export function installHooksForInit(input: {
  repo: string;
  cwd: string;
  crewDocs: { bundle: string; runtime: string } | null;
}): string {
  const { repo, cwd, crewDocs } = input;
  if (!crewDocs)
    return 'crew-docs chưa được cài trên máy này nên daemon chưa cài được hook (chạy crewd doctor).';
  const before = changedPaths(repo);
  const result = installHooks(repo, crewDocs.bundle, crewDocs.runtime);
  if (result.code !== 0) {
    return `Daemon chạy \`crew-docs install-hooks\` thất bại (exit ${result.code}): ${[result.stdout, result.stderr].join('\n').trim().slice(0, 2_000)}`;
  }
  const after = changedPaths(repo);
  const copied: string[] = [];
  for (const path of after) {
    if (!HOOK_PATH.test(path)) continue;
    const source = join(repo, path);
    if (!existsSync(source) || !lstatSync(source).isFile()) continue;
    const target = join(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    copied.push(path);
    if (before.has(path)) continue;
    if (git(repo, ['ls-files', '--error-unmatch', path]).code === 0) git(repo, ['checkout', '--', path]);
    else rmSync(source, { force: true });
  }
  return copied.length > 0
    ? `Daemon đã cài hook crew-docs cho repo và chép vào worktree: ${copied.map((p) => `\`${p}\``).join(', ')}. Commit chúng cùng docs.`
    : 'Hook crew-docs đã được cài cho repo (git config dùng chung cho mọi worktree).';
}
