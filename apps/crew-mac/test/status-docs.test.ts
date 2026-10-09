import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addStatusRepo,
  configureStatus,
  listStatusRepos,
  removeStatusRepo,
  sendDocsSnapshots,
  sendStatus,
} from '../src/commands/status.js';
import {
  buildDocsSnapshot,
  collectCommits,
  isAncestor,
  removeOwnTempDir,
  SCAN_MANIFEST,
  snapshotCommit,
} from '../src/status/docs.js';
import { fakeMac } from './helpers/fake-mac.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'crew-docs-snapshot-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'crew-docs.bundle', resolve('../..', 'packages/docs-kit/dist/crew-docs.cjs'));
  mkdirSync(join(repo, 'docs', 'guide'), { recursive: true });
  writeFileSync(
    join(repo, 'docs', 'index.md'),
    '# Home\n[Good](guide/ok.md) [Bad](missing.md) [Web](https://example.com)\n',
  );
  writeFileSync(join(repo, 'docs', 'guide', 'ok.md'), '# Good\n');
  writeFileSync(join(repo, 'docs', 'private.md'), `# Private\n${['ghp_', 'a'.repeat(36)].join('')}\n`);
  writeFileSync(join(repo, 'outside.md'), '# Outside\n');
  git(repo, 'add', '-A');
  git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'docs: seed');
  return repo;
}

describe('status docs snapshots', () => {
  it('fetch origin trước khi chọn commit cho ảnh chụp', async () => {
    const seed = fixture();
    const bare = join(mkdtempSync(join(tmpdir(), 'crew-docs-bare-')), 'repo.git');
    git(seed, 'clone', '--bare', '.', bare);
    const cloneA = join(mkdtempSync(join(tmpdir(), 'crew-docs-a-')), 'repo');
    const cloneC = join(mkdtempSync(join(tmpdir(), 'crew-docs-c-')), 'repo');
    execFileSync('git', ['clone', bare, cloneA], { stdio: 'ignore' });
    execFileSync('git', ['clone', bare, cloneC], { stdio: 'ignore' });
    git(cloneA, 'config', 'crew-docs.bundle', resolve('../..', 'packages/docs-kit/dist/crew-docs.cjs'));
    writeFileSync(join(cloneC, 'docs', 'new.md'), '# New from C\n');
    git(cloneC, 'add', '-A');
    git(cloneC, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'docs: from clone C');
    const pushed = git(cloneC, 'rev-parse', 'HEAD');
    git(cloneC, 'push', 'origin', 'HEAD:main');
    const snapshot = await snapshotCommit(cloneA);
    expect(snapshot).toEqual({ commit: pushed, fetchFailed: false });
    expect(git(cloneA, 'status', '--porcelain')).toBe('');
  });

  it('khi fetch origin lỗi, giữ ref cũ và báo cảnh báo', async () => {
    const { ctx, runner, out } = fakeMac();
    const repo = fixture();
    const old = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'remote', 'add', 'origin', '/path/that/does/not/exist');
    git(repo, 'update-ref', 'refs/remotes/origin/main', old);
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    expect(await snapshotCommit(repo)).toEqual({ commit: old, fetchFailed: true });
    configureStatus(ctx, 'https://paperclip.example', COMPANY);
    addStatusRepo(ctx, PROJECT, repo);
    runner.on('security', () => ({ stdout: 'test-secret\n' }));
    await sendDocsSnapshots(ctx, async () => new Response('', { status: 200 }));
    expect(out).toContain(`Không fetch được origin của ${PROJECT}`);
    expect(out.join('\n')).not.toContain('/path/that/does/not/exist');
  });

  it('không fetch repo không có origin', async () => {
    const repo = fixture();
    const commit = git(repo, 'rev-parse', 'HEAD');
    expect(await snapshotCommit(repo)).toEqual({ commit, fetchFailed: false });
  });

  it('flows.yaml mẫu của bước secret-scan hợp lệ với R1 của bundle docs-kit build từ repo', () => {
    const scan = mkdtempSync(join(tmpdir(), 'crew-docs-scan-manifest-'));
    try {
      git(scan, 'init', '-q');
      mkdirSync(join(scan, 'docs'));
      writeFileSync(join(scan, 'docs', 'flows.yaml'), SCAN_MANIFEST);
      const out = spawnSync(
        process.execPath,
        [resolve('../..', 'packages/docs-kit/dist/crew-docs.cjs'), 'check', '--all'],
        { cwd: scan, encoding: 'utf8' },
      );
      expect(out.stdout).not.toMatch(/^R1 /m);
    } finally {
      rmSync(scan, { recursive: true, force: true });
    }
  });

  it('bundle chạy thêm luật R2/R4 ở --staged vẫn cho kết quả secret-scan, bundle R1 hỏng thì ném lỗi', () => {
    const repo = fixture();
    const strict = join(repo, 'strict-bundle.cjs');
    writeFileSync(
      strict,
      [
        "const fs = require('node:fs');",
        "if (!process.argv.includes('--staged')) process.exit(0);",
        "const manifest = fs.readFileSync('docs/flows.yaml', 'utf8');",
        "if (!/^source:/m.test(manifest)) { console.log('R1 docs/flows.yaml: source: Invalid input'); process.exit(1); }",
        'console.log(\'R4 docs/index.md: generated "flows" block is missing\');',
        "for (const f of fs.readdirSync('docs')) {",
        "  if (f.startsWith('page-') && /ghp_/.test(fs.readFileSync('docs/' + f, 'utf8')))",
        "    console.log('R7 docs/' + f + ': line 1 looks like a credential');",
        '}',
        'process.exit(1);',
      ].join('\n'),
    );
    git(repo, 'config', 'crew-docs.bundle', strict);
    const snapshot = buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD'));
    expect(snapshot.dropped).toEqual([{ path: 'docs/private.md', reason: 'secret-scan' }]);
    expect(snapshot.pages.map((p) => p.path)).toContain('docs/index.md');
  });

  it('xóa thư mục tạm sau khi dựng ảnh chụp thành công', () => {
    const repo = fixture();
    const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('crew-mac-docs-')));
    buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD'));
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith('crew-mac-docs-'));
    expect(after.filter((name) => !before.has(name))).toEqual([]);
  });

  it('xóa thư mục tạm khi dựng ảnh chụp ném lỗi sau khi tạo worktree', () => {
    const repo = fixture();
    const failingBundle = join(repo, 'fail-bundle.cjs');
    writeFileSync(failingBundle, "process.exit(process.argv.includes('--staged') ? 2 : 0);\n");
    git(repo, 'config', 'crew-docs.bundle', failingBundle);
    const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('crew-mac-docs-')));
    expect(() => buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD'))).toThrow(
      'Không chạy được secret-scan',
    );
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith('crew-mac-docs-'));
    expect(after.filter((name) => !before.has(name))).toEqual([]);
  });

  it('không xóa đường dẫn ngoài tmpdir', () => {
    const outside = mkdtempSync(join(process.cwd(), 'crew-mac-docs-outside-'));
    try {
      writeFileSync(join(outside, 'keep.txt'), 'keep');
      removeOwnTempDir(outside);
      expect(statSync(join(outside, 'keep.txt')).isFile()).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('quản lý repo UUID, đường dẫn tuyệt đối và file mode 0600', () => {
    const { ctx, home } = fakeMac();
    const repo = fixture();
    expect(() => addStatusRepo(ctx, 'bad', repo)).toThrow();
    expect(() => addStatusRepo(ctx, PROJECT, 'relative')).toThrow();
    expect(() => addStatusRepo(ctx, PROJECT, join(repo, 'docs'))).toThrow();
    addStatusRepo(ctx, PROJECT, repo);
    expect(listStatusRepos(ctx)).toEqual([
      { projectId: PROJECT, path: realpathSync(repo), lastCommit: null },
    ]);
    expect(statSync(join(home, '.crew', 'status-repos.json')).mode & 0o777).toBe(0o600);
    removeStatusRepo(ctx, PROJECT);
    expect(listStatusRepos(ctx)).toEqual([]);
  });

  it('gửi ảnh chụp đúng docs, bỏ secret, ghi commit và không gửi lại', async () => {
    const { ctx, runner } = fakeMac();
    const repo = fixture();
    configureStatus(ctx, 'https://paperclip.example', COMPANY);
    addStatusRepo(ctx, PROJECT, repo);
    runner.on('security', () => ({ stdout: 'test-secret\n' }));
    const requests: Array<{ url: string; body: string; headers: Headers }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), body: String(init?.body), headers: new Headers(init?.headers) });
      return new Response('', { status: 200 });
    };
    await sendDocsSnapshots(ctx, fetcher);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://paperclip.example/api/plugins/crew.core/webhooks/docs-snapshot');
    expect(requests[0]?.headers.get('X-Crew-Signature')).toMatch(/^sha256=/);
    const body = JSON.parse(requests[0]?.body ?? '{}');
    expect(body).toMatchObject({
      version: 1,
      companyId: COMPANY,
      projectId: PROJECT,
      commit: git(repo, 'rev-parse', 'HEAD'),
    });
    expect(body.pages.map((p: { path: string }) => p.path)).toEqual(['docs/guide/ok.md', 'docs/index.md']);
    expect(body.pages.map((p: { parentPath: string }) => p.parentPath)).toEqual(['docs/guide', 'docs']);
    expect(body.dropped).toEqual([{ path: 'docs/private.md', reason: 'secret-scan' }]);
    expect(requests[0]?.body).not.toContain('ghp_');
    expect(body.links.map((l: { status: string }) => l.status)).toEqual(['ok', 'missing', 'external']);
    expect(listStatusRepos(ctx)[0]?.lastCommit).toBe(body.commit);
    await sendDocsSnapshots(ctx, fetcher);
    expect(requests).toHaveLength(1);
  });

  it('bỏ metadata có token và không gửi nếu tên repo có token', async () => {
    const { ctx, runner, out } = fakeMac();
    const repo = fixture();
    const token = ['ghp_', 'a'.repeat(36)].join('');
    writeFileSync(join(repo, 'docs', `${token}.md`), '# Safe\n');
    writeFileSync(join(repo, 'docs', 'title.md'), `# ${token}\n`);
    git(repo, 'add', '-A');
    git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'docs: metadata');
    configureStatus(ctx, 'https://paperclip.example', COMPANY);
    addStatusRepo(ctx, PROJECT, repo);
    runner.on('security', () => ({ stdout: 'test-secret\n' }));
    let body = '';
    await sendDocsSnapshots(ctx, async (_url, init) => {
      body = String(init?.body);
      return new Response('', { status: 200 });
    });
    const snapshot = JSON.parse(body);
    expect(snapshot.dropped).toContainEqual({ path: '<đã che>', reason: 'secret-scan-metadata' });
    expect(snapshot.pages.map((page: { path: string }) => page.path)).not.toContain(`docs/${token}.md`);
    expect(snapshot.pages.map((page: { path: string }) => page.path)).not.toContain('docs/title.md');
    expect(body + out.join('\n')).not.toContain(token);
  });

  it('bỏ symlink dù đích ở ngoài docs hoặc là khóa SSH', () => {
    const repo = fixture();
    symlinkSync('../../outside.md', join(repo, 'docs', 'outside-link.md'));
    symlinkSync('/tmp/fake-home/.ssh/id_ed25519', join(repo, 'docs', 'key-link.md'));
    git(repo, 'add', '-A');
    git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'docs: links');
    const snapshot = buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD'));
    expect(snapshot.pages.map((page) => page.path)).not.toContain('docs/outside-link.md');
    expect(snapshot.pages.map((page) => page.path)).not.toContain('docs/key-link.md');
  });

  it('bỏ gitlink submodule khỏi pages', () => {
    const repo = fixture();
    const sha = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'update-index', '--add', '--cacheinfo', '160000', sha, 'docs/submodule.md');
    git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'docs: gitlink');
    expect(buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD')).pages.map((p) => p.path)).not.toContain(
      'docs/submodule.md',
    );
  });

  it('tên repo chứa token không gửi snapshot và không lộ tên trong log', async () => {
    const { ctx, runner, out } = fakeMac();
    const original = fixture();
    const token = ['ghp_', 'a'.repeat(36)].join('');
    const repo = join(mkdtempSync(join(tmpdir(), 'crew-repo-name-')), `crew-${token}`);
    renameSync(original, repo);
    configureStatus(ctx, 'https://paperclip.example', COMPANY);
    addStatusRepo(ctx, PROJECT, repo);
    runner.on('security', () => ({ stdout: 'test-secret\n' }));
    let calls = 0;
    expect(
      await sendDocsSnapshots(ctx, async () => {
        calls++;
        return new Response('', { status: 200 });
      }),
    ).toBe(false);
    expect(calls).toBe(0);
    expect(out.join('\n')).not.toContain(token);
  });

  it('gửi docs dù bản tin máy lỗi và báo job thất bại', async () => {
    const { ctx, runner } = fakeMac();
    const repo = fixture();
    configureStatus(ctx, 'https://paperclip.example', COMPANY);
    addStatusRepo(ctx, PROJECT, repo);
    runner.on('security', () => ({ stdout: 'test-secret\n' }));
    const sent: string[] = [];
    await expect(
      sendStatus(ctx, async (url) => {
        sent.push(String(url));
        return new Response('', { status: String(url).endsWith('machine-status') ? 502 : 200 });
      }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(2);
    expect(listStatusRepos(ctx)[0]?.lastCommit).toBe(git(repo, 'rev-parse', 'HEAD'));
  });

  it('giữ bản tin máy thành công khi docs lỗi và báo job thất bại', async () => {
    const { ctx, runner, home } = fakeMac();
    const repo = fixture();
    configureStatus(ctx, 'https://paperclip.example', COMPANY);
    addStatusRepo(ctx, PROJECT, repo);
    runner.on('security', () => ({ stdout: 'test-secret\n' }));
    const sent: string[] = [];
    await expect(
      sendStatus(ctx, async (url) => {
        sent.push(String(url));
        return new Response('', { status: String(url).endsWith('docs-snapshot') ? 502 : 200 });
      }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(home, '.crew', 'status-last.json'), 'utf8')).ok).toBe(true);
    expect(listStatusRepos(ctx)[0]?.lastCommit).toBeNull();
  });

  it('HTTP 502 và body quá 5 MB giữ lastCommit', async () => {
    const { ctx, runner, out } = fakeMac();
    const repo = fixture();
    configureStatus(ctx, 'https://paperclip.example', COMPANY);
    addStatusRepo(ctx, PROJECT, repo);
    runner.on('security', () => ({ stdout: 'test-secret\n' }));
    let calls = 0;
    await sendDocsSnapshots(ctx, async () => {
      calls++;
      return new Response('', { status: 502 });
    });
    expect(listStatusRepos(ctx)[0]?.lastCommit).toBeNull();
    writeFileSync(join(repo, 'docs', 'large.md'), `# Large\n${'x'.repeat(5 * 1024 * 1024)}\n`);
    git(repo, 'add', '-A');
    git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'docs: large');
    await sendDocsSnapshots(ctx, async () => {
      calls++;
      return new Response('', { status: 200 });
    });
    expect(calls).toBe(1);
    expect(listStatusRepos(ctx)[0]?.lastCommit).toBeNull();
    expect(out.join('\n')).toMatch(/5 MB/);
  });

  it('không gửi Markdown dạng binary mà git diff bỏ qua khi rà secret', async () => {
    const { ctx, runner } = fakeMac();
    const repo = fixture();
    writeFileSync(join(repo, 'docs', 'binary.md'), `# Binary\0${['ghp_', 'a'.repeat(36)].join('')}\n`);
    git(repo, 'add', '-A');
    git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'docs: binary');
    configureStatus(ctx, 'https://paperclip.example', COMPANY);
    addStatusRepo(ctx, PROJECT, repo);
    runner.on('security', () => ({ stdout: 'test-secret\n' }));
    let body = '';
    await sendDocsSnapshots(ctx, async (_url, init) => {
      body = String(init?.body);
      return new Response('', { status: 200 });
    });
    expect(body).not.toContain('ghp_');
    expect(JSON.parse(body).dropped).toContainEqual({ path: 'docs/binary.md', reason: 'secret-scan' });
  });

  it('giữ đường dẫn Unicode và bỏ secret trong tên file có dấu cách', async () => {
    const { ctx, runner } = fakeMac();
    const repo = fixture();
    writeFileSync(join(repo, 'docs', 'tiếng-việt.md'), '# Tiếng Việt\n');
    writeFileSync(join(repo, 'docs', 'space name.md'), `# Secret\n${['ghp_', 'a'.repeat(36)].join('')}\n`);
    git(repo, 'add', '-A');
    git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'docs: names');
    configureStatus(ctx, 'https://paperclip.example', COMPANY);
    addStatusRepo(ctx, PROJECT, repo);
    runner.on('security', () => ({ stdout: 'test-secret\n' }));
    let body = '';
    await sendDocsSnapshots(ctx, async (_url, init) => {
      body = String(init?.body);
      return new Response('', { status: 200 });
    });
    const snapshot = JSON.parse(body);
    expect(snapshot.pages.map((page: { path: string }) => page.path)).toContain('docs/tiếng-việt.md');
    expect(snapshot.dropped).toContainEqual({ path: 'docs/space name.md', reason: 'secret-scan' });
    expect(body).not.toContain('ghp_');
  });

  it('không ghi đè danh sách repo được sửa trong lúc chờ HTTP', async () => {
    const { ctx, runner } = fakeMac();
    const repo = fixture();
    const second = fixture();
    const secondId = '33333333-3333-4333-8333-333333333333';
    configureStatus(ctx, 'https://paperclip.example', COMPANY);
    addStatusRepo(ctx, PROJECT, repo);
    runner.on('security', () => ({ stdout: 'test-secret\n' }));
    await sendDocsSnapshots(ctx, async () => {
      removeStatusRepo(ctx, PROJECT);
      addStatusRepo(ctx, secondId, second);
      return new Response('', { status: 200 });
    });
    expect(listStatusRepos(ctx)).toEqual([
      { projectId: secondId, path: realpathSync(second), lastCommit: null },
    ]);
  });

  it('không chạy post-checkout hook của repo và gỡ worktree tạm', async () => {
    const { ctx, runner } = fakeMac();
    const repo = fixture();
    const hook = join(repo, '.git', 'hooks', 'post-checkout');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    configureStatus(ctx, 'https://paperclip.example', COMPANY);
    addStatusRepo(ctx, PROJECT, repo);
    runner.on('security', () => ({ stdout: 'test-secret\n' }));
    let calls = 0;
    await sendDocsSnapshots(ctx, async () => {
      calls++;
      return new Response('', { status: 200 });
    });
    expect(calls).toBe(1);
    expect(git(repo, 'worktree', 'list', '--porcelain').split('worktree ').length - 1).toBe(1);
  });
});

describe('docs snapshot format 2', () => {
  it('sends flows.yaml text with its sha and marks absent or oversized manifests', () => {
    const repo = fixture();
    expect(buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD')).manifest).toEqual({ status: 'absent' });
    writeFileSync(
      join(repo, 'docs', 'flows.yaml'),
      'version: 1\nsource:\n  include: ["src/**"]\nflows: {}\n',
    );
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'manifest');
    const snap = buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD'));
    expect(snap.manifest).toMatchObject({ status: 'present' });
    if (snap.manifest.status === 'present') {
      expect(snap.manifest.sha256).toBe(
        createHash('sha256').update(snap.manifest.text, 'utf8').digest('hex'),
      );
      expect(snap.manifest.text).toContain('flows: {}');
    }
    expect(snap.pages.map((p) => p.path)).not.toContain('docs/flows.yaml');
    writeFileSync(join(repo, 'docs', 'flows.yaml'), `# ${'x'.repeat(600 * 1024)}\n`);
    git(repo, 'commit', '-qam', 'big');
    expect(buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD')).manifest).toEqual({
      status: 'dropped',
      reason: 'too-large',
    });
    git(repo, 'rm', '-q', 'docs/flows.yaml');
    git(repo, 'commit', '-qm', 'rm');
    expect(buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD')).manifest).toEqual({ status: 'absent' });
  });

  it('drops a manifest that trips the secret scan', () => {
    const repo = fixture();
    const token = ['ghp_', 'b'.repeat(36)].join('');
    writeFileSync(join(repo, 'docs', 'flows.yaml'), `version: 1\n# ${token}\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'secret');
    const snap = buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD'));
    expect(snap.manifest).toEqual({ status: 'dropped', reason: 'secret-scan' });
    expect(JSON.stringify(snap)).not.toContain(token);
  });

  it('collects commits newest first with changed paths, merges without paths, root commit included', () => {
    const repo = fixture();
    const first = git(repo, 'rev-list', '--max-parents=0', 'HEAD');
    git(repo, 'switch', '-qc', 'side');
    writeFileSync(join(repo, 'tên có dấu cách.ts'), 'a');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'side');
    git(repo, 'switch', '-q', 'main');
    writeFileSync(join(repo, 'src.ts'), 'b');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'main');
    git(repo, 'merge', '-q', '--no-ff', '--no-edit', 'side');
    const head = git(repo, 'rev-parse', 'HEAD');
    const all = collectCommits(repo, head, null);
    expect(all.truncated).toBe(false);
    expect(all.items[0]).toEqual({ sha: head, merge: true, paths: [] });
    expect(all.items.flatMap((c) => c.paths)).toEqual(
      expect.arrayContaining(['src.ts', 'tên có dấu cách.ts']),
    );
    expect(all.items.find((c) => c.sha === first)?.paths.length).toBeGreaterThan(0);
    const since = collectCommits(repo, head, first);
    expect(since.base).toBe(first);
    expect(since.items.some((c) => c.sha === first)).toBe(false);
  });

  it('skips paths with control characters and caps commits and paths', () => {
    const repo = fixture();
    writeFileSync(join(repo, 'bad\nname.ts'), 'x');
    for (let i = 0; i < 510; i++) writeFileSync(join(repo, `f${i}.ts`), String(i));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'many');
    const head = git(repo, 'rev-parse', 'HEAD');
    const out = collectCommits(repo, head, null);
    expect(out.items[0]?.paths.length).toBe(500);
    expect(out.items[0]?.paths.some((p) => p.includes('\n'))).toBe(false);
    expect(out.truncated).toBe(true);
    for (let i = 0; i < 205; i++) git(repo, 'commit', '-q', '--allow-empty', '-m', `e${i}`);
    const capped = collectCommits(repo, git(repo, 'rev-parse', 'HEAD'), null);
    expect(capped.items.length).toBe(200);
    expect(capped.truncated).toBe(true);
  });

  it('isAncestor follows git and survives a rewritten history', () => {
    const repo = fixture();
    const a = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'b');
    const b = git(repo, 'rev-parse', 'HEAD');
    expect(isAncestor(repo, a, b)).toBe(true);
    git(repo, 'reset', '-q', '--hard', a);
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'c');
    expect(isAncestor(repo, b, git(repo, 'rev-parse', 'HEAD'))).toBe(false);
    expect(isAncestor(repo, 'f'.repeat(40), b)).toBe(false);
  });

  function setup() {
    const { ctx, runner } = fakeMac();
    const repo = fixture();
    configureStatus(ctx, 'https://paperclip.example', COMPANY);
    addStatusRepo(ctx, PROJECT, repo);
    runner.on('security', () => ({ stdout: 'test-secret\n' }));
    const bodies: string[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response('', { status: 200 });
    };
    return { ctx, repo, bodies, fetcher };
  }

  it('resends once for a repo recorded before format 2, then stays quiet', async () => {
    const { ctx, repo, bodies, fetcher } = setup();
    const head = git(repo, 'rev-parse', 'HEAD');
    writeFileSync(
      join(ctx.home, '.crew', 'status-repos.json'),
      JSON.stringify([{ projectId: PROJECT, path: realpathSync(repo), lastCommit: head }]),
      { mode: 0o600 },
    );
    await sendDocsSnapshots(ctx, fetcher);
    expect(bodies).toHaveLength(1);
    const body = JSON.parse(bodies[0] ?? '{}');
    expect(body.format).toBe(2);
    expect(body.commits.base).toBeNull();
    expect(listStatusRepos(ctx)[0]?.format).toBe(2);
    await sendDocsSnapshots(ctx, fetcher);
    expect(bodies).toHaveLength(1);
  });

  it('sends only new commits after the previous snapshot', async () => {
    const { ctx, repo, bodies, fetcher } = setup();
    await sendDocsSnapshots(ctx, fetcher);
    const old = git(repo, 'rev-parse', 'HEAD');
    writeFileSync(join(repo, 'docs', 'more.md'), '# More\n');
    git(repo, 'add', '-A');
    git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'docs: more');
    await sendDocsSnapshots(ctx, fetcher);
    expect(bodies).toHaveLength(2);
    const body = JSON.parse(bodies[1] ?? '{}');
    expect(body.commits.base).toBe(old);
    expect(body.commits.items).toHaveLength(1);
    expect(body.commits.items[0].paths).toEqual(['docs/more.md']);
  });

  it('falls back to a full history when the previous commit is no longer an ancestor', async () => {
    const { ctx, repo, bodies, fetcher } = setup();
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'extra');
    await sendDocsSnapshots(ctx, fetcher);
    git(repo, 'reset', '-q', '--hard', 'HEAD~1');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'rewritten');
    await sendDocsSnapshots(ctx, fetcher);
    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[1] ?? '{}').commits.base).toBeNull();
  });

  it('drops commit paths when the full body exceeds 5 MB', async () => {
    const { ctx, repo, bodies, fetcher } = setup();
    writeFileSync(join(repo, 'docs', 'large.md'), `# Large\n${'x'.repeat(Math.floor(4.9 * 1024 * 1024))}\n`);
    const deep = join(repo, ...['a', 'b', 'c', 'd'].map((c) => c.repeat(200)));
    mkdirSync(deep, { recursive: true });
    for (let i = 0; i < 500; i++)
      writeFileSync(join(deep, `f${String(i).padStart(4, '0')}${'z'.repeat(80)}.ts`), '1');
    git(repo, 'add', '-A');
    git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'big');
    await sendDocsSnapshots(ctx, fetcher);
    expect(bodies).toHaveLength(1);
    const body = JSON.parse(bodies[0] ?? '{}');
    expect(body.commits.truncated).toBe(true);
    expect(body.commits.items.every((c: { paths: string[] }) => c.paths.length === 0)).toBe(true);
    expect(Buffer.byteLength(bodies[0] ?? '', 'utf8')).toBeLessThanOrEqual(5 * 1024 * 1024);
  }, 60_000);

  it('rejects an unknown format in status-repos.json', () => {
    const { ctx } = fakeMac();
    writeFileSync(
      join(ctx.home, '.crew', 'status-repos.json'),
      JSON.stringify([{ projectId: PROJECT, path: '/tmp/x', lastCommit: null, format: 3 }]),
      { mode: 0o600 },
    );
    expect(() => listStatusRepos(ctx)).toThrow('Danh sách repo không hợp lệ');
  });
});
