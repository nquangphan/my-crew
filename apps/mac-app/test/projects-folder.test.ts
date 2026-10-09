import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  folderGuardReason,
  inspectFolder,
  killActiveGit,
  runGit,
  suggestKey,
} from '../src/main/projects/folder.js';
import { makeSandbox } from './projects-fixture.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function sandbox() {
  const s = makeSandbox();
  cleanups.push(s.cleanup);
  return s;
}

const commit = (s: ReturnType<typeof makeSandbox>, dir: string) =>
  s.git(['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x']);

describe('inspectFolder', () => {
  it('repo clone thường: gốc, git dir chung, origin, nhánh mặc định theo origin/HEAD', async () => {
    const s = sandbox();
    const info = await inspectFolder(s.folder, { home: s.home, env: s.env });
    expect(info.root).toBe(realpathSync.native(s.folder));
    expect(info.commonDir).toBe(join(realpathSync.native(s.folder), '.git'));
    expect(info.origin).toBe(s.origin);
    expect(info.baseRef).toBe('refs/remotes/origin/main');
  });

  it('không có origin/HEAD thì lấy origin/main, rồi main, rồi master', async () => {
    const s = sandbox();
    s.git(['-C', s.folder, 'remote', 'set-head', 'origin', '-d']);
    expect((await inspectFolder(s.folder, { home: s.home, env: s.env })).baseRef).toBe(
      'refs/remotes/origin/main',
    );
    s.git(['-C', s.folder, 'update-ref', '-d', 'refs/remotes/origin/main']);
    expect((await inspectFolder(s.folder, { home: s.home, env: s.env })).baseRef).toBe('refs/heads/main');
    s.git(['-C', s.folder, 'branch', '-m', 'main', 'master']);
    expect((await inspectFolder(s.folder, { home: s.home, env: s.env })).baseRef).toBe('refs/heads/master');
  });

  it('từ chối từng ca với lời tiếng Việt rõ', async () => {
    const s = sandbox();
    const opts = { home: s.home, env: s.env };
    await expect(inspectFolder('Projects/landing', opts)).rejects.toThrow('đường dẫn tuyệt đối');
    await expect(inspectFolder(join(s.root, 'khong-co'), opts)).rejects.toThrow('Không tìm thấy folder');
    writeFileSync(join(s.root, 'tep.txt'), 'x');
    await expect(inspectFolder(join(s.root, 'tep.txt'), opts)).rejects.toThrow('không phải thư mục');

    const plain = join(s.root, 'plain');
    mkdirSync(plain);
    await expect(inspectFolder(plain, opts)).rejects.toThrow('không phải repo git');

    await expect(inspectFolder(s.origin, opts)).rejects.toThrow('repo bare');

    await expect(inspectFolder(join(s.folder, 'docs'), opts)).rejects.toThrow(
      `thư mục con của repo ${realpathSync.native(s.folder)}`,
    );

    const extra = join(s.root, 'wt-phu');
    s.git(['-C', s.folder, 'worktree', 'add', '-q', '--detach', extra]);
    await expect(inspectFolder(extra, opts)).rejects.toThrow('worktree phụ');

    const noOrigin = join(s.root, 'no-origin');
    s.git(['init', '-q', '-b', 'main', noOrigin]);
    commit(s, noOrigin);
    await expect(inspectFolder(noOrigin, opts)).rejects.toThrow('chưa có remote origin');

    const noBranch = join(s.root, 'no-branch');
    s.git(['init', '-q', '-b', 'dev', noBranch]);
    commit(s, noBranch);
    s.git(['-C', noBranch, 'remote', 'add', 'origin', s.origin]);
    await expect(inspectFolder(noBranch, opts)).rejects.toThrow('nhánh mặc định');

    await expect(inspectFolder(s.home, opts)).rejects.toThrow('HOME');
  });
});

describe('folderGuardReason', () => {
  it('chặn gốc ổ đĩa, HOME và cha của HOME; không chặn /Volumes', () => {
    expect(folderGuardReason('/Users/o', '/')).toContain('HOME');
    expect(folderGuardReason('/Users/o', '/Users/o')).toContain('HOME');
    expect(folderGuardReason('/Users/o', '/Users')).toContain('HOME');
    expect(folderGuardReason('/Users/o', '/Volumes/CORSAIR/Projects/2ps-landing')).toBeNull();
    expect(folderGuardReason('/Users/o', '/Users/o/Projects/a')).toBeNull();
  });
});

describe('suggestKey', () => {
  it('đổi tên folder thành khóa hợp lệ', () => {
    expect(suggestKey('landing')).toBe('landing');
    expect(suggestKey('My App')).toBe('my-app');
    expect(suggestKey('2ps-landing')).toBe('p-2ps-landing');
    expect(suggestKey('Đồ án Cũ')).toBe('do-an-cu');
    expect(suggestKey('a'.repeat(50))).toBe('a'.repeat(31));
    expect(suggestKey('---')).toBe('');
  });
});

describe('killActiveGit', () => {
  it('giết cả nhóm tiến trình con của git đang chạy, không để mồ côi', async () => {
    const s = sandbox();
    const pidFile = join(s.home, 'ssh.pid');
    const running = runGit(['ls-remote', 'ssh://example.invalid/x.git'], {
      env: { ...s.env, GIT_SSH_COMMAND: `sh -c 'echo $$ > ${pidFile}; exec sleep 30'` },
      timeoutMs: 60_000,
    });
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50));
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(() => process.kill(pid, 0)).not.toThrow();
    killActiveGit();
    await running;
    for (let i = 0; i < 40; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('tiến trình con của git vẫn sống');
  });
});
