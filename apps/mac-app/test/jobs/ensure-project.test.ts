import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultProjectRoots, originKey } from '../../src/main/jobs/ensure-project.js';
import { type ExecutorDeps, runJob } from '../../src/main/jobs/executors.js';
import type { JobPayload } from '../../src/main/jobs/types.js';
import { runGit } from '../../src/main/projects/folder.js';
import { makeSandbox } from '../projects-fixture.js';

const COMPANY = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function setup(
  opts: {
    statusRepos?: (s: ReturnType<typeof makeSandbox>) => string[];
    roots?: (s: ReturnType<typeof makeSandbox>) => string[];
  } = {},
) {
  const s = makeSandbox();
  cleanups.push(s.cleanup);
  const deps: ExecutorDeps = {
    home: s.home,
    env: s.env,
    addStatusRepo: async () => undefined,
    statusRepoPaths: async () => opts.statusRepos?.(s) ?? [],
    projectRoots: () => opts.roots?.(s) ?? [],
    docsNodePath: async () => process.execPath,
    removeStatusRepo: async () => undefined,
    doctor: async () => [],
    workflowCheck: async () => ({ ok: true, lines: [] }),
    runtimesSetup: async () => {
      throw new Error('không gọi');
    },
  };
  return { s, deps };
}

const payload = (
  s: ReturnType<typeof makeSandbox>,
  over: Partial<Extract<JobPayload, { kind: 'ensure-project' }>> = {},
): JobPayload => ({
  kind: 'ensure-project',
  projectKey: 'landing',
  projectId: PROJECT,
  originUrl: `file://${s.origin}`,
  branch: 'main',
  roles: [
    { role: 'assistant', branch: 'agent/landing-assistant' },
    { role: 'executor-1', branch: 'agent/landing-executor-1' },
  ],
  companions: [],
  ...over,
});
const run = (deps: ExecutorDeps, p: JobPayload) =>
  runJob({ companyId: COMPANY, kind: 'ensure-project', payload: p }, { projectId: null }, deps);

/** Repo đi kèm: origin bare riêng và (tùy chọn) bản clone trong thư mục project của owner. */
function companionRepo(s: ReturnType<typeof makeSandbox>, name: string, cloneInto?: string) {
  const work = join(s.root, `${name}-src`);
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'README.md'), `${name}\n`);
  s.git(['init', '-q', '-b', 'main', work]);
  s.git(['-C', work, 'add', '.']);
  s.git(['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'đầu']);
  const origin = join(s.root, `${name}.git`);
  s.git(['clone', '-q', '--bare', work, origin]);
  if (cloneInto) s.git(['clone', '-q', origin, cloneInto]);
  return origin;
}

describe('originKey', () => {
  it.each([
    ['git@github.com:Org/App.git', 'github.com/Org/App'],
    ['https://GitHub.com/Org/App', 'github.com/Org/App'],
    ['https://bob:token@github.com/Org/App.git/', 'github.com/Org/App'],
    ['ssh://git@github.com/Org/App.git', 'github.com/Org/App'],
    ['file:///tmp/x/origin.git', '/tmp/x/origin'],
    ['/tmp/x/origin.git', '/tmp/x/origin'],
    ['', null],
  ])('%s → %s', (url, key) => {
    expect(originKey(url)).toBe(key);
  });
});

describe('defaultProjectRoots', () => {
  it('chỉ giữ thư mục có thật trong HOME (và /Volumes/<ổ>/Projects có thật)', () => {
    const s = makeSandbox();
    cleanups.push(s.cleanup);
    mkdirSync(join(s.home, 'Projects'));
    const roots = defaultProjectRoots(s.home);
    expect(roots).toContain(join(s.home, 'Projects'));
    expect(roots).not.toContain(join(s.home, 'Documents', 'projects'));
    expect(roots.every((root) => existsSync(root))).toBe(true);
    expect(
      roots
        .filter((root) => !root.startsWith(s.home))
        .every((root) => /^\/Volumes\/[^/]+\/Projects$/.test(root)),
    ).toBe(true);
  });
});

describe('ensure-project', () => {
  it('dùng lại repo có sẵn trong bản tin docs dù origin viết khác dạng; không clone', async () => {
    const { s, deps } = setup({ statusRepos: (x) => [x.folder] });
    const outcome = await run(deps, payload(s));
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done' || outcome.result.kind !== 'ensure-project') throw new Error('sai kết quả');
    expect(outcome.result).toMatchObject({ repoPath: realpathSync(s.folder), cloned: false, companions: [] });
    expect(outcome.result.checkouts.map((c) => c.role)).toEqual(['assistant', 'executor-1']);
    expect(outcome.result.checkouts[1]?.path).toBe(join(s.home, 'crew-agents', 'landing', 'executor-1'));
    expect(outcome.result.checkouts[1]?.head).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(s.home, 'crew-agents', 'landing', 'repo'))).toBe(false);
    expect(s.git(['-C', s.folder, 'config', '--get', 'crew-docs.bundle'])).not.toBe('');
  });

  it('tìm được repo ở thư mục project quen thuộc khi bản tin docs không có', async () => {
    const { s, deps } = setup({ roots: (x) => [join(x.root, 'Projects')] });
    const outcome = await run(deps, payload(s));
    expect(outcome).toMatchObject({
      status: 'done',
      result: { repoPath: realpathSync(s.folder), cloned: false },
    });
  });

  it('không có bản nào thì clone về ~/crew-agents/<key>/repo; chạy lại cho cùng kết quả, không clone thêm', async () => {
    const { s, deps } = setup();
    const first = await run(deps, payload(s));
    const repo = join(s.home, 'crew-agents', 'landing', 'repo');
    expect(first).toMatchObject({ status: 'done', result: { repoPath: realpathSync(repo), cloned: true } });
    expect(s.git(['-C', repo, 'symbolic-ref', 'refs/remotes/origin/HEAD'])).toBe('refs/remotes/origin/main');
    const again = await run(deps, payload(s));
    expect(again).toMatchObject({ status: 'done', result: { repoPath: realpathSync(repo), cloned: false } });
    if (first.status === 'done' && again.status === 'done')
      expect(again.result).toEqual({ ...first.result, cloned: false });
  });

  it('thư mục clone dở (không có .git) bị xóa rồi clone lại', async () => {
    const { s, deps } = setup();
    const repo = join(s.home, 'crew-agents', 'landing', 'repo');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, 'rac.txt'), 'dở\n');
    const outcome = await run(deps, payload(s));
    expect(outcome).toMatchObject({ status: 'done', result: { cloned: true } });
    expect(existsSync(join(repo, 'rac.txt'))).toBe(false);
  });

  it('bản clone dở thật (có .git, HEAD chưa có commit, không nhánh, không worktree) bị xóa rồi clone lại', async () => {
    const { s, deps } = setup();
    const repo = join(s.home, 'crew-agents', 'landing', 'repo');
    mkdirSync(repo, { recursive: true });
    s.git(['init', '-q', '-b', 'main', repo]);
    writeFileSync(join(repo, 'rac.txt'), 'dở\n');
    const outcome = await run(deps, payload(s));
    expect(outcome).toMatchObject({ status: 'done', result: { repoPath: realpathSync(repo), cloned: true } });
    expect(existsSync(join(repo, 'rac.txt'))).toBe(false);
    expect(existsSync(join(repo, 'README.md'))).toBe(true);
  });

  it('chỗ repo đi kèm có thư mục lạ hay symlink khi phải clone: báo checkout_exists, không đè', async () => {
    const { s, deps } = setup({ statusRepos: (x) => [x.folder] });
    const docsOrigin = companionRepo(s, 'docs');
    const target = join(s.home, 'crew-agents', 'landing', 'docs_repo');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'cua-owner.txt'), 'giữ\n');
    const p = payload(s, { companions: [{ name: 'docs_repo', originUrl: `file://${docsOrigin}` }] });
    expect(await run(deps, p)).toMatchObject({ status: 'failed', errorCode: 'checkout_exists' });
    expect(existsSync(join(target, 'cua-owner.txt'))).toBe(true);

    rmSync(target, { recursive: true, force: true });
    symlinkSync(join(s.root, 'khong-co'), target);
    expect(await run(deps, p)).toMatchObject({ status: 'failed', errorCode: 'checkout_exists' });
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readlinkSync(target)).toBe(join(s.root, 'khong-co'));
  });

  it('repo có nhánh và worktree mà HEAD hỏng: git_failed, không xóa gì', async () => {
    const { s, deps } = setup();
    const repo = join(s.home, 'crew-agents', 'landing', 'repo');
    const wt = join(s.home, 'crew-agents', 'landing', 'assistant');
    s.git(['clone', '-q', s.origin, repo]);
    s.git(['-C', repo, 'worktree', 'add', '-q', '-b', 'agent/landing-assistant', wt]);
    writeFileSync(join(wt, 'chua-push.txt'), 'việc agent\n');
    // HEAD trỏ nhánh chưa có; bỏ origin để không tìm thấy repo này theo origin, buộc đi đường clone.
    s.git(['-C', repo, 'symbolic-ref', 'HEAD', 'refs/heads/khong-co']);
    s.git(['-C', repo, 'remote', 'remove', 'origin']);
    const outcome = await run(deps, payload(s));
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'git_failed' });
    expect(outcome.status === 'failed' && outcome.errorText).toContain('không xóa');
    expect(existsSync(join(repo, 'README.md'))).toBe(true);
    expect(existsSync(join(wt, 'chua-push.txt'))).toBe(true);
    expect(s.git(['-C', repo, 'branch', '--list', 'main'])).not.toBe('');
  });

  it('repo chỉ có nhánh local mà HEAD hỏng: git_failed, không xóa', async () => {
    const { s, deps } = setup();
    const repo = join(s.home, 'crew-agents', 'landing', 'repo');
    s.git(['clone', '-q', s.origin, repo]);
    s.git(['-C', repo, 'symbolic-ref', 'HEAD', 'refs/heads/khong-co']);
    s.git(['-C', repo, 'remote', 'remove', 'origin']);
    expect(await run(deps, payload(s))).toMatchObject({ status: 'failed', errorCode: 'git_failed' });
    expect(existsSync(join(repo, 'README.md'))).toBe(true);
  });

  it('rev-parse HEAD lỗi vì lý do khác (quá giờ, safe.directory): git_failed, không xóa', async () => {
    for (const failure of [
      { code: -1, stdout: '', stderr: '' },
      { code: 128, stdout: '', stderr: "fatal: detected dubious ownership in repository at '/x'" },
    ]) {
      const { s, deps } = setup();
      const repo = join(s.home, 'crew-agents', 'landing', 'repo');
      mkdirSync(repo, { recursive: true });
      s.git(['init', '-q', '-b', 'main', repo]);
      writeFileSync(join(repo, 'cua-owner.txt'), 'giữ\n');
      deps.git = async (args, opts) =>
        args[1] === repo && args[2] === 'rev-parse' && args[3] === 'HEAD' ? failure : runGit(args, opts);
      expect(await run(deps, payload(s))).toMatchObject({ status: 'failed', errorCode: 'git_failed' });
      expect(existsSync(join(repo, 'cua-owner.txt'))).toBe(true);
    }
  });

  it('mất mạng khi clone: git_failed, không bảo thêm key SSH', async () => {
    const { s, deps } = setup();
    const fakeSsh = join(s.root, 'fake-ssh.sh');
    writeFileSync(
      fakeSsh,
      '#!/bin/sh\necho "ssh: Could not resolve hostname github.com: nodename nor servname provided" >&2\nexit 255\n',
    );
    chmodSync(fakeSsh, 0o755);
    deps.env = { ...deps.env, GIT_SSH_COMMAND: fakeSsh };
    const outcome = await run(deps, payload(s, { originUrl: 'git@github.com:nquangphan/khong-co.git' }));
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'git_failed' });
    expect(existsSync(join(s.home, 'crew-agents', 'landing', 'repo'))).toBe(false);
  });

  it('GitHub từ chối key SSH: clone_auth_failed kèm hướng dẫn thêm key, không để lại thư mục', async () => {
    const { s, deps } = setup();
    const fakeSsh = join(s.root, 'fake-ssh.sh');
    writeFileSync(
      fakeSsh,
      '#!/bin/sh\necho "git@github.com: Permission denied (publickey)." >&2\nexit 255\n',
    );
    chmodSync(fakeSsh, 0o755);
    deps.env = { ...deps.env, GIT_SSH_COMMAND: fakeSsh };
    const outcome = await run(deps, payload(s, { originUrl: 'git@github.com:nquangphan/khong-co.git' }));
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'clone_auth_failed' });
    expect(outcome.status === 'failed' && outcome.errorText).toContain('ssh -T git@github.com');
    expect(existsSync(join(s.home, 'crew-agents', 'landing', 'repo'))).toBe(false);
  });

  it('repo đi kèm có sẵn: symlink cạnh worktree; symlink đúng thì giữ; thứ khác chắn chỗ thì báo, không đè', async () => {
    const { s, deps } = setup({ statusRepos: (x) => [x.folder], roots: (x) => [join(x.root, 'Projects')] });
    const docs = join(s.root, 'Projects', 'docs');
    const docsOrigin = companionRepo(s, 'docs', docs);
    const p = payload(s, { companions: [{ name: 'docs_repo', originUrl: `file://${docsOrigin}` }] });
    const first = await run(deps, p);
    const link = join(s.home, 'crew-agents', 'landing', 'docs_repo');
    expect(first).toMatchObject({
      status: 'done',
      result: { companions: [{ name: 'docs_repo', path: link }] },
    });
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(realpathSync(docs));
    expect(await run(deps, p)).toMatchObject({ status: 'done' });

    const other = setup({ statusRepos: (x) => [x.folder], roots: (x) => [join(x.root, 'Projects')] });
    const otherDocs = companionRepo(other.s, 'docs', join(other.s.root, 'Projects', 'docs'));
    const blocked = join(other.s.home, 'crew-agents', 'landing', 'docs_repo');
    mkdirSync(blocked, { recursive: true });
    const outcome = await run(
      other.deps,
      payload(other.s, { companions: [{ name: 'docs_repo', originUrl: `file://${otherDocs}` }] }),
    );
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'checkout_exists' });
    expect(existsSync(blocked) && !lstatSync(blocked).isSymbolicLink()).toBe(true);
  });

  it('repo đi kèm không tìm thấy: clone thẳng vào ~/crew-agents/<key>/<tên>; việc check bỏ qua bản clone', async () => {
    const { s, deps } = setup({ statusRepos: (x) => [x.folder] });
    const docsOrigin = companionRepo(s, 'docs');
    const outcome = await run(
      deps,
      payload(s, { companions: [{ name: 'docs_repo', originUrl: `file://${docsOrigin}` }] }),
    );
    const target = join(s.home, 'crew-agents', 'landing', 'docs_repo');
    expect(outcome).toMatchObject({
      status: 'done',
      result: { companions: [{ name: 'docs_repo', path: target }] },
    });
    expect(existsSync(join(target, '.git'))).toBe(true);
    const checked: string[] = [];
    deps.workflowCheck = async (root) => {
      checked.push(root);
      return { ok: true, lines: [] };
    };
    await runJob(
      { companyId: COMPANY, kind: 'check', payload: { kind: 'check', projectKey: 'landing' } },
      { projectId: null },
      deps,
    );
    expect(checked.map((p) => p.split('/').pop()).sort()).toEqual(['assistant', 'executor-1']);
  });
});
