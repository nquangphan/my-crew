import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commonGitDir,
  detectSharedPaths,
  ensureWorktree,
  listWorktrees,
  removeWorktree,
  worktreeKeys,
} from '../src/git/worktree-manager.js';
import { git, makeRepo, writeFiles } from './helpers/git.js';

describe('worktree manager', () => {
  it('creates crew/<key> from the base, then reuses the worktree and the branch', () => {
    const repo = makeRepo();
    const first = ensureWorktree({ repo, key: 'WEB-1', base: 'main' });
    expect(first.created).toBe(true);
    expect(first.path).toBe(join(repo, '.crew/worktrees/WEB-1'));
    expect(git(first.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('crew/WEB-1');
    writeFileSync(join(first.path, 'work.txt'), 'in progress\n');

    const again = ensureWorktree({ repo, key: 'WEB-1', base: 'main' });
    expect(again.created).toBe(false);
    expect(readFileSync(join(again.path, 'work.txt'), 'utf8')).toBe('in progress\n');

    // The worktree is gone but its branch stays: re-attach the branch instead of branching anew.
    git(first.path, 'add', 'work.txt');
    git(first.path, 'commit', '-q', '-m', 'wip');
    const head = git(first.path, 'rev-parse', 'HEAD').trim();
    expect(removeWorktree(repo, 'WEB-1')).toBe(true);
    expect(existsSync(first.path)).toBe(false);
    const reattached = ensureWorktree({ repo, key: 'WEB-1', base: 'main' });
    expect(reattached.created).toBe(true);
    expect(git(reattached.path, 'rev-parse', 'HEAD').trim()).toBe(head);
    expect([...listWorktrees(repo).values()]).toContain('crew/WEB-1');
  });

  it('starts a QC worktree at the dev head_sha and keeps .crew out of git', () => {
    const repo = makeRepo();
    const dev = ensureWorktree({ repo, key: 'WEB-2', base: 'main' });
    writeFileSync(join(dev.path, 'feature.ts'), 'export {};\n');
    git(dev.path, 'add', '-A');
    git(dev.path, 'commit', '-q', '-m', 'feature');
    const headSha = git(dev.path, 'rev-parse', 'HEAD').trim();
    const qc = ensureWorktree({ repo, key: 'WEB-3', base: headSha });
    expect(git(qc.path, 'rev-parse', 'HEAD').trim()).toBe(headSha);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(commonGitDir(repo), 'info/exclude'), 'utf8')).toContain('/.crew/');
    expect(worktreeKeys(repo).sort()).toEqual(['WEB-2', 'WEB-3']);
  });

  it('links untracked agent config into the worktree, never tracked paths, and git status never shows the links', () => {
    const repo = makeRepo({
      'README.md': '# r\n',
      '.gitignore': '.claude/\n',
      'AGENTS.md': '# tracked agents\n',
    });
    writeFiles(repo, {
      '.claude/skills/shop-domain/SKILL.md': '---\nname: shop-domain\ndescription: Nghiệp vụ cửa hàng\n---\n',
      'CLAUDE.md': '@AGENTS.md\n',
      'kit-config/settings.json': '{}\n',
    });
    const shared = detectSharedPaths(repo, ['kit-config']);
    // AGENTS.md is tracked (the worktree has its own copy); CLAUDE.md and kit-config are untracked.
    expect(shared.sort()).toEqual(['.claude', 'CLAUDE.md', 'kit-config']);

    const worktree = ensureWorktree({ repo, key: 'WEB-4', base: 'main', sharedPaths: shared });
    expect(worktree.linked.sort()).toEqual(['.claude', 'CLAUDE.md', 'kit-config']);
    for (const path of shared) expect(lstatSync(join(worktree.path, path)).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(worktree.path, 'AGENTS.md')).isSymbolicLink()).toBe(false);
    expect(existsSync(join(worktree.path, '.claude/skills/shop-domain/SKILL.md'))).toBe(true);

    expect(git(worktree.path, 'status', '--porcelain', '--untracked-files=all')).toBe('');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    // Adding everything still commits no link.
    git(worktree.path, 'add', '-A');
    expect(git(worktree.path, 'diff', '--cached', '--name-only')).toBe('');

    // Re-running is idempotent (links already present).
    expect(ensureWorktree({ repo, key: 'WEB-4', base: 'main', sharedPaths: shared }).linked).toEqual([]);
  });

  it('checks out a detached probe worktree without creating a branch', () => {
    const repo = makeRepo();
    const probe = ensureWorktree({ repo, key: '_probe', base: 'main', detach: true });
    expect(probe.branch).toBeNull();
    expect(git(repo, 'branch', '--list', 'crew/*').trim()).toBe('');
    expect(removeWorktree(repo, '_probe')).toBe(true);
  });

  it('removes a leftover directory git no longer tracks', () => {
    const repo = makeRepo();
    const worktree = ensureWorktree({ repo, key: 'WEB-5', base: 'main' });
    git(repo, 'worktree', 'remove', '--force', worktree.path);
    writeFiles(worktree.path, { 'stale.txt': 'x' });
    expect(removeWorktree(repo, 'WEB-5')).toBe(true);
    expect(existsSync(worktree.path)).toBe(false);
    expect(removeWorktree(repo, 'WEB-5')).toBe(false);
  });
});
