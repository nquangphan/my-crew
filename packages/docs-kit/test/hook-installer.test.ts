import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, inject, it } from 'vitest';
import { hookLine, withHookLine, withLefthookCommands } from '../src/hook-installer.js';
import {
  fakeAwsKey,
  fixtureRepo,
  GIT_ENV,
  type RunResult,
  type TestRepo,
  tempDir,
} from './helpers/git-repo.js';

const bundle = inject('bundlePath');
const HOOKS = ['pre-commit', 'commit-msg', 'pre-push'];

/** Runs the real bundle with nothing but an absolute runtime path, like a hook does. */
function bundled(cwd: string, args: string[], env: NodeJS.ProcessEnv = GIT_ENV): RunResult {
  const result = spawnSync(process.execPath, [bundle, ...args], { cwd, env, encoding: 'utf8' });
  return { code: result.status ?? -1, out: result.stdout, err: result.stderr };
}

function install(repo: TestRepo, env?: NodeJS.ProcessEnv): RunResult {
  return bundled(repo.root, ['install-hooks', '--runtime', process.execPath], env);
}

/** A commit through the real hooks (no --no-verify). */
function commitWithHooks(repo: TestRepo, message: string, env?: NodeJS.ProcessEnv): RunResult {
  repo.git('add', '-A');
  const result = spawnSync('git', ['commit', '-q', '-m', message], {
    cwd: repo.root,
    env: env ?? GIT_ENV,
    encoding: 'utf8',
  });
  // Git sends hook output to stdout or stderr depending on the hook; tests read both.
  return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}`, err: result.stderr };
}

/** Changes a mapped source file without touching its flow doc (an R3 violation). */
function staleChange(repo: TestRepo, n: number) {
  repo.write('src/checkout/cart.ts', `export const addItem = (item: string) => [item, ${n}];\n`);
}

function freshChange(repo: TestRepo, n: number) {
  staleChange(repo, n);
  repo.append('docs/flows/checkout.md', `\nThay đổi ${n}.\n`);
}

/** Hook files, their modes and the local git config, to prove a second install changes nothing. */
function snapshotSetup(repo: TestRepo, dir: string): string {
  const files = HOOKS.map((hook) => {
    const file = join(dir, hook);
    return existsSync(file) ? `${hook}:${statSync(file).mode}:${readFileSync(file, 'utf8')}` : `${hook}:none`;
  });
  return [...files, repo.git('config', '--local', '--list')].join('\n---\n');
}

function bareRemote(repo: TestRepo): string {
  const remote = tempDir('crew-docs-remote-');
  execFileSync('git', ['init', '-q', '--bare', remote], { env: GIT_ENV });
  repo.git('remote', 'add', 'origin', remote);
  return remote;
}

describe('bundle', () => {
  it('prints its version with only an absolute node path and an empty environment', () => {
    const result = spawnSync(process.execPath, [bundle, '--version'], { env: {}, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('plain repo: .githooks with core.hooksPath', () => {
  it('installs pre-commit, commit-msg and pre-push that enforce R3, R6 and R7, idempotently', async () => {
    const repo = await fixtureRepo();
    const first = install(repo);
    expect(first.code, first.err).toBe(0);
    expect(first.out).toContain('hooks: githooks');
    expect(repo.git('config', '--local', '--get', 'core.hooksPath').trim()).toBe('.githooks');
    expect(repo.git('config', '--local', '--get', 'crew-docs.runtime').trim()).toBe(process.execPath);
    expect(repo.git('config', '--local', '--get', 'crew-docs.bundle').trim()).toBe(realpathSync(bundle));
    for (const hook of HOOKS) {
      const file = join(repo.root, '.githooks', hook);
      expect(statSync(file).mode & 0o111).not.toBe(0);
      expect(readFileSync(file, 'utf8')).toContain(hookLine(hook as 'pre-commit'));
    }
    const before = snapshotSetup(repo, join(repo.root, '.githooks'));
    const second = install(repo);
    expect(second.out).toContain('unchanged (already installed)');
    expect(snapshotSetup(repo, join(repo.root, '.githooks'))).toBe(before);

    // Committing the hook files is a protected change: the owner-approved trailer lets it through.
    expect(commitWithHooks(repo, 'chore: cài hook').code).not.toBe(0);
    expect(commitWithHooks(repo, 'chore: cài hook\n\nCrew-Owner-Approved: WEB-1').code).toBe(0);

    staleChange(repo, 1);
    let res = commitWithHooks(repo, 'feat: thiếu docs');
    expect(res.code).not.toBe(0);
    expect(res.out).toContain('R3 src/checkout/cart.ts: changed without updating docs/flows/checkout.md');
    freshChange(repo, 1);
    expect(commitWithHooks(repo, 'feat: có docs').code).toBe(0);

    repo.write('.claude/settings.json', '{}\n');
    res = commitWithHooks(repo, 'chore: đổi settings');
    expect(res.code).not.toBe(0);
    expect(res.out).toContain('R6 .claude/settings.json: protected path changed');
    expect(commitWithHooks(repo, 'chore: đổi settings\n\nCrew-Owner-Approved: WEB-2').code).toBe(0);

    repo.write('src/dev-reset.ts', `export const key = '${fakeAwsKey()}';\n`);
    res = commitWithHooks(repo, 'chore: lỡ tay');
    expect(res.code).not.toBe(0);
    expect(res.out).toContain('R7 src/dev-reset.ts: line 1 looks like a credential');
  });

  it('blocks a push carrying a credential or a stale commit that skipped the local hooks', async () => {
    const repo = await fixtureRepo();
    expect(install(repo).code).toBe(0);
    repo.commit('chore: cài hook\n\nCrew-Owner-Approved: WEB-1');
    const remote = bareRemote(repo);
    expect(repo.tryGit('push', '-q', 'origin', 'main').code).toBe(0);

    repo.write('src/dev-reset.ts', `export const key = '${fakeAwsKey()}';\n`);
    repo.commit('chore: bỏ qua hook');
    let push = repo.tryGit('push', '-q', 'origin', 'main');
    expect(push.code).not.toBe(0);
    expect(push.out).toContain('R7 src/dev-reset.ts: line 1 looks like a credential');
    expect(push.out).toMatch(/\[commit [0-9a-f]{7}\]/);

    repo.git('reset', '-q', '--hard', 'HEAD~1');
    staleChange(repo, 7);
    repo.commit('feat: thiếu docs');
    push = repo.tryGit('push', '-q', 'origin', 'HEAD:refs/heads/feature');
    expect(push.code).not.toBe(0);
    expect(push.out).toContain('R3 src/checkout/cart.ts');

    repo.git('reset', '-q', '--hard', 'HEAD~1');
    freshChange(repo, 8);
    repo.commit('feat: có docs');
    expect(repo.tryGit('push', '-q', 'origin', 'HEAD:refs/heads/feature').code).toBe(0);
    expect(
      execFileSync('git', ['rev-parse', 'feature'], { cwd: remote, env: GIT_ENV, encoding: 'utf8' }).trim(),
    ).toBe(repo.head());
  });

  it('lets a merge through when the merged commits were approved on their own', async () => {
    const repo = await fixtureRepo();
    expect(install(repo).code).toBe(0);
    repo.commit('chore: cài hook\n\nCrew-Owner-Approved: WEB-1');
    repo.git('checkout', '-q', '-b', 'config');
    repo.write('.claude/settings.json', '{}\n');
    expect(commitWithHooks(repo, 'chore: settings\n\nCrew-Owner-Approved: WEB-3').code).toBe(0);
    repo.git('checkout', '-q', 'main');
    freshChange(repo, 11);
    expect(commitWithHooks(repo, 'feat: có docs').code).toBe(0);
    const merge = repo.tryGit('merge', '--no-ff', '-q', '-m', 'Merge config', 'config');
    expect(merge.code, `${merge.out}${merge.err}`).toBe(0);
    expect(repo.git('rev-list', '--merges', '--count', 'HEAD').trim()).toBe('1');
  });

  it('runs the same hooks for a commit from a linked worktree, and refuses to install from one', async () => {
    const repo = await fixtureRepo();
    expect(install(repo).code).toBe(0);
    repo.commit('chore: cài hook\n\nCrew-Owner-Approved: WEB-1');
    const worktree = join(tempDir('crew-docs-wt-'), 'feature');
    repo.git('worktree', 'add', '-q', '-b', 'feature', worktree);
    const wt = new (repo.constructor as new (root: string) => TestRepo)(worktree);

    expect(install(wt).code).toBe(2);
    staleChange(wt, 3);
    const res = commitWithHooks(wt, 'feat: thiếu docs');
    expect(res.code).not.toBe(0);
    expect(res.out).toContain('R3 src/checkout/cart.ts');
    freshChange(wt, 3);
    expect(commitWithHooks(wt, 'feat: có docs').code).toBe(0);
    repo.git('worktree', 'remove', '--force', worktree);
  });

  it('fails closed with a clear path when the runtime config is missing, and validates install input', async () => {
    const repo = await fixtureRepo();
    expect(install(repo).code).toBe(0);
    repo.git('config', '--local', '--unset', 'crew-docs.runtime');
    freshChange(repo, 4);
    const res = commitWithHooks(repo, 'feat: có docs');
    expect(res.code).not.toBe(0);
    expect(res.err).toContain('/crew-docs-runtime-not-configured');

    expect(bundled(repo.root, ['install-hooks', '--runtime', 'node']).err).toContain(
      'must be an absolute path',
    );
    expect(bundled(repo.root, ['install-hooks', '--runtime', '/nope/node']).code).toBe(2);
  });
});

describe('chaining with existing hook managers', () => {
  it('husky: keeps husky hooks running, adds the checks, and covers worktrees', async () => {
    const repo = await fixtureRepo();
    const huskyBin = join(fileURLToPath(new URL('.', import.meta.resolve('husky'))), 'bin.js');
    execFileSync(process.execPath, [huskyBin], { cwd: repo.root, env: GIT_ENV });
    const marker = join(tempDir('crew-docs-husky-marker-'), 'ran');
    repo.write('.husky/pre-commit', `echo husky >> "${marker}"\n`);
    repo.commit('chore: husky\n\nCrew-Owner-Approved: WEB-1');

    const res = install(repo);
    expect(res.code, res.err).toBe(0);
    expect(res.out).toContain('hooks: husky');
    const preCommit = repo.read('.husky/pre-commit');
    expect(preCommit).toContain(`echo husky >> "${marker}"`);
    expect(preCommit).toContain(hookLine('pre-commit'));
    expect(repo.git('config', '--local', '--get', 'core.hooksPath').trim()).toBe(
      join(realpathSync(repo.root), '.husky/_'),
    );
    const before = snapshotSetup(repo, join(repo.root, '.husky'));
    expect(install(repo).out).toContain('unchanged');
    expect(snapshotSetup(repo, join(repo.root, '.husky'))).toBe(before);
    repo.commit('chore: crew-docs hooks\n\nCrew-Owner-Approved: WEB-2');

    staleChange(repo, 5);
    const blocked = commitWithHooks(repo, 'feat: thiếu docs');
    expect(blocked.code).not.toBe(0);
    expect(blocked.out).toContain('R3 src/checkout/cart.ts');
    // The crew-docs line runs first and fails fast, so husky's own command did not run for this commit.
    expect(existsSync(marker)).toBe(false);
    freshChange(repo, 5);
    expect(commitWithHooks(repo, 'feat: có docs').code).toBe(0);
    expect(readFileSync(marker, 'utf8')).toBe('husky\n');

    const worktree = join(tempDir('crew-docs-wt-'), 'husky-feature');
    repo.git('worktree', 'add', '-q', '-b', 'husky-feature', worktree);
    const wt = new (repo.constructor as new (root: string) => TestRepo)(worktree);
    staleChange(wt, 6);
    expect(commitWithHooks(wt, 'feat: thiếu docs').out).toContain('R3 src/checkout/cart.ts');
    freshChange(wt, 6);
    expect(commitWithHooks(wt, 'feat: có docs').code).toBe(0);
    expect(readFileSync(marker, 'utf8')).toBe('husky\nhusky\n');
    repo.git('worktree', 'remove', '--force', worktree);
  });

  it('lefthook: adds crew-docs commands next to existing ones and installs the hooks', async () => {
    const repo = await fixtureRepo();
    const lefthookJs = fileURLToPath(import.meta.resolve('lefthook'));
    const binDir = tempDir('crew-docs-lefthook-bin-');
    const shim = join(binDir, 'lefthook');
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${lefthookJs}" "$@"\n`);
    chmodSync(shim, 0o755);
    const env = { ...GIT_ENV, PATH: `${binDir}${delimiter}${GIT_ENV.PATH ?? ''}` };
    const marker = join(tempDir('crew-docs-lefthook-marker-'), 'ran');
    repo.write(
      'lefthook.yml',
      `# team hooks\npre-commit:\n  commands:\n    team:\n      run: echo lefthook >> "${marker}"\n`,
    );
    execFileSync(shim, ['install'], { cwd: repo.root, env });
    repo.commit('chore: lefthook\n\nCrew-Owner-Approved: WEB-1');

    const res = install(repo, env);
    expect(res.code, res.err).toBe(0);
    expect(res.out).toContain('hooks: lefthook');
    const config = repo.read('lefthook.yml');
    expect(config).toContain('# team hooks');
    expect(config).toContain('team:');
    expect(config).toContain('crew-docs:');
    expect(config).toContain('check --commit-msg {1}');
    expect(install(repo, env).out).toContain('unchanged');
    repo.commit('chore: crew-docs hooks\n\nCrew-Owner-Approved: WEB-2');

    staleChange(repo, 9);
    const blocked = commitWithHooks(repo, 'feat: thiếu docs', env);
    expect(blocked.code).not.toBe(0);
    expect(`${blocked.out}${blocked.err}`).toContain('R3 src/checkout/cart.ts');
    expect(readFileSync(marker, 'utf8')).toContain('lefthook');
    freshChange(repo, 9);
    expect(commitWithHooks(repo, 'feat: có docs', env).code).toBe(0);

    repo.write('.claude/settings.json', '{}\n');
    const r6 = commitWithHooks(repo, 'chore: settings', env);
    expect(r6.code).not.toBe(0);
    expect(`${r6.out}${r6.err}`).toContain('R6 .claude/settings.json');
  });

  it('custom core.hooksPath and existing .git/hooks: chains into the existing scripts', async () => {
    for (const setup of ['hooks-path', 'git-hooks-dir'] as const) {
      const repo = await fixtureRepo();
      const marker = join(tempDir('crew-docs-custom-marker-'), 'ran');
      const script = `#!/bin/sh\necho custom >> "${marker}"\nexit 0\n`;
      let dir: string;
      if (setup === 'hooks-path') {
        repo.write('.hooks/pre-commit', script);
        chmodSync(join(repo.root, '.hooks/pre-commit'), 0o755);
        repo.git('config', 'core.hooksPath', '.hooks');
        repo.commit('chore: hooks\n\nCrew-Owner-Approved: WEB-1');
        dir = join(repo.root, '.hooks');
      } else {
        dir = repo.git('rev-parse', '--path-format=absolute', '--git-path', 'hooks').trim();
        writeFileSync(join(dir, 'pre-commit'), script, { mode: 0o755 });
      }
      const res = install(repo);
      expect(res.out).toContain(`hooks: ${setup}`);
      const text = readFileSync(join(dir, 'pre-commit'), 'utf8');
      // The check runs before the script's own `exit 0`, so it cannot be skipped.
      expect(text.split('\n').slice(0, 3)).toEqual([
        '#!/bin/sh',
        hookLine('pre-commit'),
        `echo custom >> "${marker}"`,
      ]);
      if (setup === 'hooks-path') repo.commit('chore: crew-docs hooks\n\nCrew-Owner-Approved: WEB-2');

      staleChange(repo, 10);
      const stale = commitWithHooks(repo, 'feat: thiếu docs');
      expect(stale.out).toContain('R3 src/checkout/cart.ts');
      freshChange(repo, 10);
      expect(commitWithHooks(repo, 'feat: có docs').code).toBe(0);
      expect(readFileSync(marker, 'utf8')).toBe('custom\n');
    }
  });
});

describe('hook text helpers', () => {
  it('replaces an older crew-docs line instead of adding a second one', () => {
    const old = '#!/bin/sh\nold-crew-docs-command || exit 1 # crew-docs:pre-commit\nnpm test\n';
    expect(withHookLine(old, 'pre-commit')).toBe(`#!/bin/sh\n${hookLine('pre-commit')}\nnpm test\n`);
    expect(withHookLine(null, 'pre-push')).toBe(`#!/bin/sh\n${hookLine('pre-push')}\n`);
  });

  it('writes lefthook commands idempotently', () => {
    const once = withLefthookCommands('pre-commit:\n  commands:\n    lint:\n      run: npm run lint\n');
    expect(withLefthookCommands(once)).toBe(once);
    expect(once).toContain('use_stdin: true');
  });
});
