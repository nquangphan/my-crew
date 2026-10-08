import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
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
} from '../src/commands/status.js';
import { fakeMac } from './helpers/fake-mac.js';
import { buildDocsSnapshot, removeOwnTempDir } from '../src/status/docs.js';

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
    expect(() => buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD'))).toThrow('Không chạy được secret-scan');
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
    expect(body.dropped).toEqual([{ path: 'docs/private.md', reason: 'secret-scan' }]);
    expect(requests[0]?.body).not.toContain('ghp_');
    expect(body.links.map((l: { status: string }) => l.status)).toEqual(['ok', 'missing', 'external']);
    expect(listStatusRepos(ctx)[0]?.lastCommit).toBe(body.commit);
    await sendDocsSnapshots(ctx, fetcher);
    expect(requests).toHaveLength(1);
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
