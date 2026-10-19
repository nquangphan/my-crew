# R2-5 — Gói `mac` (repo Crew `apps/crew-mac`)

Đọc trước: [plan.md](plan.md) (Global Constraints, Review Focus 5, Interface I1, I7), spec §4.2, §4.5;
`docs/flows/mac-setup.md` mục "Ảnh chụp docs".

Worktree `.worktrees/crew-r25-mac`, nhánh `r25/mac-docs` rẽ từ `r2-5`. Lệnh chạy ở gốc worktree.
- Test một file: `pnpm --filter @crew/mac exec vitest run test/<file>`.
- Typecheck: `pnpm --filter @crew/mac typecheck`. Lint: `pnpm exec biome check apps/crew-mac docs`.
- Trước commit: `node packages/docs-kit/dist/crew-docs.cjs check --staged`. Bundle chưa có thì
  `pnpm --filter @crew/docs-kit build`.
- Test dùng `HOME` giả và repo git trong `os.tmpdir()`. Không đụng `~/.crew` thật, sshd, app.

Mỗi ticket: dòng đầu tiên là ghi ledger `- <date> <ID> bắt đầu (sonnet)`.

---

## MD-1: gửi `flows.yaml` và danh sách commit (sonnet)

**Files:**
- Modify: `apps/crew-mac/src/status/docs.ts`, `apps/crew-mac/src/commands/status.ts`,
  `apps/crew-mac/test/status-docs.test.ts`, `docs/flows/mac-setup.md`

**Interfaces:**
- Consumes: không có.
- Produces (I1):
  - `readFlowsManifest(root, commit): FlowsManifestPayload`;
  - `collectCommits(root, commit, base: string | null): CommitsPayload`;
  - `isAncestor(root, ancestor, commit): boolean`;
  - `buildDocsSnapshot(...)` trả thêm `manifest`;
  - `StatusRepo.format?: 2`.

- [ ] **Bước 1: Test (đỏ).** Thêm vào `test/status-docs.test.ts`, dùng lại `fixture()` (trả đường dẫn repo, đã có commit
  `docs: seed`, có `docs/private.md` chứa token mẫu) và `git()` có sẵn trong file. Import thêm `createHash` từ
  `node:crypto`:

```ts
import { collectCommits, isAncestor } from '../src/status/docs.js';

describe('docs snapshot format 2', () => {
  it('sends flows.yaml text with its sha and marks absent or oversized manifests', () => {
    const repo = fixture();
    writeFileSync(join(repo, 'docs', 'flows.yaml'), 'version: 1\nsource:\n  include: ["src/**"]\nflows: {}\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'manifest');
    const head = git(repo, 'rev-parse', 'HEAD');
    const snap = buildDocsSnapshot(repo, head);
    expect(snap.manifest).toMatchObject({ status: 'present' });
    if (snap.manifest.status === 'present') {
      expect(snap.manifest.sha256).toBe(createHash('sha256').update(snap.manifest.text, 'utf8').digest('hex'));
    }
    writeFileSync(join(repo, 'docs', 'flows.yaml'), `# ${'x'.repeat(600 * 1024)}\n`);
    git(repo, 'commit', '-qam', 'big');
    expect(buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD')).manifest).toEqual({ status: 'dropped', reason: 'too-large' });
    git(repo, 'rm', '-q', 'docs/flows.yaml'); git(repo, 'commit', '-qm', 'rm');
    expect(buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD')).manifest).toEqual({ status: 'absent' });
  });

  it('drops a manifest that trips the secret scan', () => {
    const repo = fixture();
    const token = ['ghp_', 'b'.repeat(36)].join('');   // dựng lúc chạy để R7 không bắt chính file test
    writeFileSync(join(repo, 'docs', 'flows.yaml'), `version: 1\n# ${token}\n`);
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'secret');
    const snap = buildDocsSnapshot(repo, git(repo, 'rev-parse', 'HEAD'));
    expect(snap.manifest).toEqual({ status: 'dropped', reason: 'secret-scan' });
    expect(JSON.stringify(snap)).not.toContain(token);
  });

  it('collects commits newest first with changed paths, merges without paths, root commit included', () => {
    const repo = fixture();
    const first = git(repo, 'rev-list', '--max-parents=0', 'HEAD');
    git(repo, 'switch', '-qc', 'side');
    writeFileSync(join(repo, 'tên có dấu cách.ts'), 'a'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'side');
    git(repo, 'switch', '-q', 'main');
    writeFileSync(join(repo, 'src.ts'), 'b'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'main');
    git(repo, 'merge', '-q', '--no-ff', '--no-edit', 'side');
    const head = git(repo, 'rev-parse', 'HEAD');
    const all = collectCommits(repo, head, null);
    expect(all.truncated).toBe(false);
    expect(all.items[0]).toEqual({ sha: head, merge: true, paths: [] });
    expect(all.items.flatMap((c) => c.paths)).toEqual(expect.arrayContaining(['src.ts', 'tên có dấu cách.ts']));
    expect(all.items.find((c) => c.sha === first)?.paths.length).toBeGreaterThan(0);
    const since = collectCommits(repo, head, first);
    expect(since.base).toBe(first);
    expect(since.items.some((c) => c.sha === first)).toBe(false);
  });

  it('skips paths with control characters and caps commits and paths', () => {
    const repo = fixture();
    writeFileSync(join(repo, 'bad\nname.ts'), 'x');
    for (let i = 0; i < 510; i++) writeFileSync(join(repo, `f${i}.ts`), String(i));
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'many');
    const head = git(repo, 'rev-parse', 'HEAD');
    const out = collectCommits(repo, head, null);
    expect(out.items[0]?.paths.length).toBe(500);
    expect(out.items[0]?.paths.some((p) => p.includes('\n'))).toBe(false);
    expect(out.truncated).toBe(true);
    for (let i = 0; i < 205; i++) git(repo, 'commit', '-q', '--allow-empty', '-m', `e${i}`);
    expect(collectCommits(repo, git(repo, 'rev-parse', 'HEAD'), null).items.length).toBe(200);
  });

  it('isAncestor follows git and survives a rewritten history', () => {
    const repo = fixture();
    const a = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'b');
    const b = git(repo, 'rev-parse', 'HEAD');
    expect(isAncestor(repo, a, b)).toBe(true);
    git(repo, 'reset', '-q', '--hard', a); git(repo, 'commit', '-q', '--allow-empty', '-m', 'c');
    expect(isAncestor(repo, b, git(repo, 'rev-parse', 'HEAD'))).toBe(false);
    expect(isAncestor(repo, 'f'.repeat(40), b)).toBe(false);
  });
});
```

Thêm vào khối test `sendDocsSnapshots` có sẵn (dùng `fakeMac` và `fetcher` giả như các ca hiện có):
1. **Định dạng cũ gửi lại một lần:**
   - repo trong `status-repos.json` có `lastCommit` = HEAD, không có `format`;
   - `sendDocsSnapshots` gọi `fetcher` đúng 1 lần, body có `format: 2`, `commits.base === null`;
   - sau đó `listStatusRepos(ctx)[0]` có `format: 2`;
   - gọi lần nữa thì `fetcher` không được gọi.
2. **Commit mới:** commit thêm 1 lần. Body có `commits.base === <lastCommit cũ>` và đúng 1 item.
3. **Force-push:** `lastCommit` không còn là tổ tiên. Body có `commits.base === null`.
4. **Body vượt 5 MB:**
   - repo có trang docs lớn sao cho body đầy đủ > 5 MB nhưng bỏ `paths` thì ≤ 5 MB. Cách dựng: 4,9 MB trang +
     commit có 500 path dài 900 ký tự;
   - `fetcher` được gọi 1 lần với mọi `paths` rỗng và `truncated: true`.
5. **`format` lạ:** `format: 3` trong `status-repos.json` thì `listStatusRepos` ném `Danh sách repo không hợp lệ`.

Chạy: `pnpm --filter @crew/mac exec vitest run test/status-docs.test.ts`. Kỳ vọng: FAIL.

- [ ] **Bước 2: Cài trong `docs.ts`.**

```ts
export type FlowsManifestPayload =
  | { status: 'present'; text: string; sha256: string }
  | { status: 'absent' }
  | { status: 'dropped'; reason: 'secret-scan' | 'too-large' };
export interface CommitsPayload { base: string | null; truncated: boolean; items: { sha: string; merge: boolean; paths: string[] }[] }
export const MANIFEST_MAX_BYTES = 512 * 1024;
const MAX_COMMITS = 200;
const MAX_PATHS = 500;

export function isAncestor(root: string, ancestor: string, commit: string): boolean {
  if (!/^[0-9a-f]{40}$/.test(ancestor) || !/^[0-9a-f]{40}$/.test(commit)) return false;
  return spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', ancestor, commit], { timeout: 30_000 }).status === 0;
}

export function collectCommits(root: string, commit: string, base: string | null): CommitsPayload {
  const args = ['rev-list', '--parents', `--max-count=${MAX_COMMITS + 1}`, commit];
  if (base) args.push(`^${base}`);
  const lines = git(root, args).split('\n').filter(Boolean);
  let truncated = lines.length > MAX_COMMITS;
  const items = lines.slice(0, MAX_COMMITS).map((line) => {
    const [sha = '', ...parents] = line.trim().split(' ');
    if (parents.length > 1) return { sha, merge: true, paths: [] as string[] };
    const all = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--root', sha])
      .split('\0')
      .filter((p) => p.length > 0 && p.length <= 1024 && !/[\u0000-\u001f]/.test(p));
    if (all.length > MAX_PATHS) truncated = true;
    return { sha, merge: false, paths: all.slice(0, MAX_PATHS) };
  });
  return { base, truncated, items };
}
```

`readFlowsManifest` chạy **trong** `buildDocsSnapshot`, vì phải quét secret cùng repo scan:
- Kiểm `git ls-tree <commit> -- docs/flows.yaml` có mode `100644`/`100755`. Không có thì `{status:'absent'}`.
- `git show <commit>:docs/flows.yaml`. Quá `MANIFEST_MAX_BYTES` (đo `Buffer.byteLength`) thì
  `{status:'dropped', reason:'too-large'}`. Có byte NUL cũng `dropped`/`too-large`.
- Ghi text vào repo scan ở `docs/scan-flows-yaml.md`. **Không** dùng `docs/flows.yaml`, vì tên đó là `SCAN_MANIFEST`.
  Đưa đường dẫn này vào danh sách map khi đọc dòng `R7 …`. Dính R7 thì `{status:'dropped', reason:'secret-scan'}`.
- Còn lại `{status:'present', text, sha256: createHash('sha256').update(text,'utf8').digest('hex')}`.
- `buildDocsSnapshot` trả thêm `manifest`. Chữ ký giữ nguyên để R3 MC-1 không phải sửa lời gọi.
- **Không** thêm `manifest` vào `pages` hay `dropped`.

- [ ] **Bước 3: Cài trong `status.ts`.**
  - `StatusRepo` thêm `format?: 2`. `listStatusRepos` thêm điều kiện `(item.format === undefined || item.format === 2)`.
  - Trong `sendDocsSnapshots`:

```ts
if (commit === repo.lastCommit && repo.format === 2) continue;
const base = repo.format === 2 && repo.lastCommit && isAncestor(repo.path, repo.lastCommit, commit) ? repo.lastCommit : null;
const snapshot = buildDocsSnapshot(repo.path, commit, basename(repo.path));
const commits = collectCommits(repo.path, commit, base);
const payload = { version: 1, format: 2, companyId: config.companyId, machineId: config.machineId, projectId: repo.projectId,
  repo: basename(repo.path), commit, ...snapshot, commits };
let body = JSON.stringify(payload);
if (Buffer.byteLength(body, 'utf8') > 5 * 1024 * 1024) {
  body = JSON.stringify({ ...payload, commits: { ...commits, truncated: true, items: commits.items.map((c) => ({ ...c, paths: [] })) } });
}
if (Buffer.byteLength(body, 'utf8') > 5 * 1024 * 1024) { /* như cũ: log, success = false, continue */ }
```

  - Gửi thành công thì `mutateRepos` ghi `{ ...item, lastCommit: commit, format: 2 }`.
  - `addStatusRepo` giữ nguyên (repo mới không có `format`, nên lần đầu lấy 200 commit).

- [ ] **Bước 4: Chạy** `test/status-docs.test.ts`, `test/status.test.ts`, typecheck, biome. Kỳ vọng: PASS. Ca body 5 MB
  mất > 5 giây thì đặt `timeout` riêng cho ca đó, không giảm cỡ dưới ngưỡng.

- [ ] **Bước 5: Docs.** Sửa `docs/flows/mac-setup.md` mục "Ảnh chụp docs":
  - Body có `format: 2`, `manifest` (đọc `docs/flows.yaml` ở commit, trần 512 KiB, quét secret qua tên tạm
    `docs/scan-flows-yaml.md`, ba trạng thái).
  - `commits`: `rev-list --parents`, tối đa 200 commit, 500 path, merge không có path, `--root`, path có ký tự điều khiển
    bị bỏ, `base` = `lastCommit` khi là tổ tiên và repo đã ở định dạng 2.
  - Repo cũ chưa có `format` được gửi lại một lần dù commit không đổi.
  - Body vượt 5 MB thì gửi lại không có `paths`.
  - `status-repos.json` có thêm `format`.
  Rồi `node packages/docs-kit/dist/crew-docs.cjs check --staged`.

- [ ] **Bước 6: Commit.**

```bash
git add apps/crew-mac/src/status/docs.ts apps/crew-mac/src/commands/status.ts apps/crew-mac/test/status-docs.test.ts docs/flows/mac-setup.md
git commit -m "feat(crew-mac): gửi flows.yaml và danh sách commit cùng ảnh chụp docs"
```

---

## MD-2: cỡ cache file đính kèm trong bản tin máy (sonnet)

**Files:**
- Create: `apps/crew-mac/src/files/stats.ts`, `apps/crew-mac/test/files/stats.test.ts`
- Modify: `apps/crew-mac/src/status/report.ts`, `apps/crew-mac/test/status.test.ts`, `docs/flows/mac-setup.md`,
  `docs/flows/mac-attachments.md`, `docs/flows.yaml` (khối `mac-attachments`: thêm `src/files/stats.ts` vào `files`,
  test vào `tests`), `docs/files.md` (sinh)

**Interfaces:**
- Consumes: `attachmentPaths(home)` (`src/files/paths.ts`), `CACHE_MAX_BYTES` (`src/files/config.ts`).
- Produces (I7):
  - `attachmentCacheStats(home: string, now?: Date, budgetMs?: number): AttachmentCacheStats | null`;
  - `MachineReport.attachmentCache?`.

- [ ] **Bước 1: Test (đỏ).**

```ts
// apps/crew-mac/test/files/stats.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CACHE_MAX_BYTES } from '../../src/files/config.js';
import { attachmentPaths } from '../../src/files/paths.js';
import { attachmentCacheStats } from '../../src/files/stats.js';

function home() {
  const h = mkdtempSync(join(tmpdir(), 'crew-stats-'));
  const p = attachmentPaths(h);
  for (const d of [p.blobs, join(p.derived, 'a'.repeat(64), 'v1'), join(p.runs, 'r1'), join(p.runs, 'r2')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(p.blobs, 'a'.repeat(64)), Buffer.alloc(1000));
  writeFileSync(join(p.blobs, 'b'.repeat(64)), Buffer.alloc(24));
  writeFileSync(join(p.blobs, `${'c'.repeat(64)}.part`), Buffer.alloc(7));
  writeFileSync(join(p.derived, 'a'.repeat(64), 'v1', 'x.md'), 'hello');
  writeFileSync(join(p.runs, 'r1', 'manifest.json'), '{}');
  return h;
}

it('counts every file, blob bytes against the limit, and runs', () => {
  const stats = attachmentCacheStats(home(), new Date('2026-10-10T01:00:00Z'));
  expect(stats).toEqual({ bytes: 1000 + 24 + 7 + 5 + 2, blobBytes: 1031, blobs: 2, runs: 2,
    limitBytes: CACHE_MAX_BYTES, measuredAt: '2026-10-10T01:00:00.000Z' });
});
it('returns null when the cache does not exist or the walk runs out of time', () => {
  expect(attachmentCacheStats(mkdtempSync(join(tmpdir(), 'crew-stats-empty-')))).toBeNull();
  expect(attachmentCacheStats(home(), new Date(), -1)).toBeNull();
});
```

`blobs` đếm file tên đúng 64 hex (không đếm `.part`). `blobBytes` gồm cả `.part`, vì chúng nằm trong `blobs/` và
chiếm chỗ. Test ghi đúng như vậy: 1000 + 24 + 7 = 1031.

Trong `test/status.test.ts` thêm hai ca của `buildMachineReport`:
- `HOME` giả có cache thì `report.attachmentCache` có đủ 6 khóa;
- không có cache thì không có key `attachmentCache`, và bản tin vẫn ≤ 16 KB.

Chạy: FAIL.

- [ ] **Bước 2: Cài `stats.ts`.**

```ts
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_MAX_BYTES } from './config.js';
import { attachmentPaths } from './paths.js';

export interface AttachmentCacheStats { bytes: number; blobBytes: number; blobs: number; runs: number; limitBytes: number; measuredAt: string }

/** Byte thật của cache file đính kèm; quá giờ hoặc lỗi đọc thì null (bản tin bỏ key). Không theo symlink. */
export function attachmentCacheStats(home: string, now = new Date(), budgetMs = 2000): AttachmentCacheStats | null {
  const p = attachmentPaths(home);
  const deadline = Date.now() + budgetMs;
  let walked = 0;
  const walk = (dir: string): number => {
    let total = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (++walked % 256 === 0 && Date.now() > deadline) throw new Error('timeout');
      const full = join(dir, entry.name);
      if (entry.isDirectory()) total += walk(full);
      else if (entry.isFile()) total += lstatSync(full).size;
    }
    return total;
  };
  try {
    if (budgetMs < 0) return null;
    lstatSync(p.root);
    const blobBytes = walk(p.blobs);
    const blobs = readdirSync(p.blobs).filter((n) => /^[0-9a-f]{64}$/.test(n)).length;
    const runs = readdirSync(p.runs, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    const bytes = walk(p.root);
    return { bytes, blobBytes, blobs, runs, limitBytes: CACHE_MAX_BYTES, measuredAt: now.toISOString() };
  } catch {
    return null;
  }
}
```

`report.ts`: sau khi dựng `report`, gán `const cache = attachmentCacheStats(ctx.home, ctx.now()); if (cache)
report.attachmentCache = cache;` **trước** kiểm 16 KB. `MachineReport` thêm `attachmentCache?: AttachmentCacheStats`.
Kiểu import từ `../files/stats.js`.

- [ ] **Bước 3: Chạy** `test/files/stats.test.ts`, `test/status.test.ts`, typecheck, biome. Kỳ vọng: PASS.

- [ ] **Bước 4: Docs.**
  - `docs/flows/mac-attachments.md` thêm mục ngắn "Số liệu cache cho bản tin máy" (`attachmentCacheStats`, 2 giây, không
    theo symlink, `null` thì bỏ key).
  - `docs/flows/mac-setup.md` mục bản tin máy thêm trường `attachmentCache` (giống đoạn trường `app`: plugin bỏ riêng key
    sai dạng; plugin cũ chưa biết key này sẽ từ chối cả bản tin, nên plugin R2-5 phải lên prod trước).
  - `docs/flows.yaml` khối `mac-attachments` thêm `apps/crew-mac/src/files/stats.ts` (files) và
    `apps/crew-mac/test/files/stats.test.ts` (tests).
  - Chạy `node packages/docs-kit/dist/crew-docs.cjs generate`, rồi `check --staged`.

- [ ] **Bước 5: Commit.** `feat(crew-mac): báo dung lượng cache file đính kèm trong bản tin máy`.

**Lưu ý deploy (ghi vào báo cáo ticket):** webhook máy của plugin R2-2 dùng `fields()` chặt cho phần thân bản tin, nên
key lạ `attachmentCache` làm **cả bản tin** bị từ chối. `crew-mac` có MD-2 chỉ được cài sau khi plugin R2-5 (ST-1) đã
`ready` trên prod (DP-1 bước 7).
