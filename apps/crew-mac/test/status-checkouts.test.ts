import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanCheckouts } from '../src/status/checkouts.js';
import { gitIn } from './helpers/fake-mac.js';

function gitRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  gitIn(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  gitIn(dir, 'add', '.');
  gitIn(dir, 'commit', '-q', '-m', 'init');
}

describe('scanCheckouts', () => {
  it('chỉ lấy thư mục git dưới ~/crew-agents/*/*, có head và clean', async () => {
    const home = mkdtempSync(join(tmpdir(), 'crew-checkouts-'));
    gitRepo(join(home, 'crew-agents', 'demo', 'assistant'));
    gitRepo(join(home, 'crew-agents', 'demo', 'executor'));
    writeFileSync(join(home, 'crew-agents', 'demo', 'executor', 'new.txt'), 'x\n');
    mkdirSync(join(home, 'crew-agents', 'demo', 'notes'), { recursive: true });
    writeFileSync(join(home, 'crew-agents', 'demo', 'README.md'), 'không phải thư mục\n');
    gitRepo(join(home, 'crew-agents', 'deep', 'a', 'b'));
    const checkouts = await scanCheckouts(home);
    expect(checkouts.map((c) => c.path)).toEqual([
      join(home, 'crew-agents', 'demo', 'assistant'),
      join(home, 'crew-agents', 'demo', 'executor'),
    ]);
    expect(checkouts[0]?.head).toMatch(/^[0-9a-f]{40}$/);
    expect(checkouts[0]?.clean).toBe(true);
    expect(checkouts[1]?.clean).toBe(false);
  });

  it('worktree git (.git là file) cũng được tính', async () => {
    const home = mkdtempSync(join(tmpdir(), 'crew-checkouts-'));
    const origin = join(home, 'src', 'repo');
    gitRepo(origin);
    mkdirSync(join(home, 'crew-agents', 'demo'), { recursive: true });
    gitIn(
      origin,
      'worktree',
      'add',
      '-q',
      '-b',
      'crew/demo/reviewer',
      join(home, 'crew-agents', 'demo', 'reviewer'),
    );
    const checkouts = await scanCheckouts(home);
    expect(checkouts).toEqual([
      {
        path: join(home, 'crew-agents', 'demo', 'reviewer'),
        head: expect.stringMatching(/^[0-9a-f]{40}$/),
        clean: true,
      },
    ]);
  });

  it('tối đa 64, sắp theo path', async () => {
    const home = mkdtempSync(join(tmpdir(), 'crew-checkouts-'));
    // Thư mục có `.git` hỏng: đủ để vào danh sách, git đọc lỗi thì head/clean null. Rẻ hơn 70 repo thật.
    for (let i = 0; i < 70; i++) {
      const dir = join(home, 'crew-agents', `p${String(i).padStart(2, '0')}`, 'executor');
      mkdirSync(join(dir, '.git'), { recursive: true });
    }
    const checkouts = await scanCheckouts(home);
    expect(checkouts).toHaveLength(64);
    const paths = checkouts.map((c) => c.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths[0]).toBe(join(home, 'crew-agents', 'p00', 'executor'));
    expect(checkouts.every((c) => c.head === null && c.clean === null)).toBe(true);
  });

  it('không có ~/crew-agents thì trả mảng rỗng', async () => {
    expect(await scanCheckouts(mkdtempSync(join(tmpdir(), 'crew-checkouts-')))).toEqual([]);
  });
});
