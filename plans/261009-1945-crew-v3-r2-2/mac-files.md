# Crew v3 R2-2: gói `mac-files` (FL-1…FL-5, FL-B) trong repo Crew, kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm lệnh `crew-mac files` vào `@crew/mac`. Agent đang chạy trong run Paperclip gọi lệnh này để có danh sách file đính kèm của issue (và issue tổ tiên), mỗi file có nguồn, trạng thái cố định và đường dẫn tuyệt đối trỏ vào cache 0700/0600 để `Read`. DOCX/XLSX/text/CSV được trích ra `.md` có locator và đã che credential.

**Architecture:** Thư mục mới `apps/crew-mac/src/files/`.
- Phần chính chạy trong process CLI (tsc build như hiện nay): cache, nhận diện byte, client bridge, provenance, render, GC.
- Parser port từ v2 chạy trong process con riêng `dist/files-worker.cjs`. File này do esbuild bundle kèm `yauzl`/`saxes`, nên bản cài `~/.crew/app/crew-mac` và bản app mang theo (`extraResources` chép `dist/**`) không cần `node_modules`.
- Ảnh và PDF không trích chữ: Claude Code `Read` thẳng blob. Lệnh macOS `sips` đổi HEIC/thu nhỏ ảnh; `osascript -l JavaScript` (PDFKit) đếm trang và phát hiện mã hóa.

**Tech Stack:** Node ≥ 22 ESM, TypeScript 7, Vitest, Biome 2.5, esbuild ^0.28.2 (devDependency), yauzl 3.4.0, saxes 6.0.0, `@types/yauzl`; macOS `sips`, `osascript`.

**Spec:** [plan.md](plan.md) (Global Constraints, Review Focus 1–5, Interface I1–I6) và spec §2, §5.3, §5.4, §5.8.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng gói này:

- Worktree `.worktrees/crew-r22-files`, nhánh `r22/mac-files` rẽ từ `r2-2`. Mỗi ticket bắt đầu bằng `git merge --ff-only r2-2` (Trợ Lý đã ff ticket trước).
- Không sửa `apps/mac-app/**`, `apps/crew-mac/assets/**`, các lệnh crew-mac khác. `src/cli.ts` chỉ FL-3 thêm một nhánh `case 'files'` và dòng usage.
- Test không gọi mạng thật, không cần Mac mini thật. Test dùng `sips`/`osascript` thật thì bọc `it.runIf(process.platform === 'darwin')`; mọi thứ khác dùng runner giả `test/helpers/fake-runner.ts`.
- Log của lệnh: `~/.crew/logs/attachments.log` (append, 0600, xoay vòng khi > 5 MB: đổi tên `.1`, giữ 1 bản). Mỗi dòng: `<ISO> <runId8> <attachmentId8> <sha12> <bytes> <status> <reason|-> <ghi chú cố định>`. Không bao giờ có nội dung file, tên sheet, text lỗi bên ngoài.
- Port từ v2 bằng `git show a13dd7d:<path>` (repo Crew). Ghi nguồn port ở đầu mỗi file port bằng một dòng comment: `// Port từ v2/server/src/attachments/extract/<file>.ts (a13dd7d).` Giữ nguyên số trong `ParserLimits` v2.
- Lệnh kiểm mỗi ticket (trong worktree):
  `pnpm --filter @crew/mac test -- <file test của ticket> && pnpm --filter @crew/mac typecheck && pnpm exec biome check apps/crew-mac docs && node packages/docs-kit/dist/crew-docs.cjs check --staged`.

---

### Task 1 (FL-1): Kiểu, cấu hình, cache và GC

**Files:**
- Create: `apps/crew-mac/src/files/{types.ts,config.ts,paths.ts,cache.ts,gc.ts,log.ts}`, `apps/crew-mac/test/files/{cache,gc}.test.ts`, `docs/flows/mac-attachments.md`
- Modify: `docs/flows.yaml` (thêm khối `mac-attachments`, không đụng `source`/`shared`/`unassigned`), `docs/files.md` (sinh)

**Interfaces:**
- Consumes: `MacContext` (`home`, `now`) từ `src/context.ts`.
- Produces: I1 (kiểu, hằng số), I2 (`ReasonCode`, `NoteCode`, `REASON_TEXT`, `NOTE_TEXT`, `STATUS_LABEL`); và

```ts
// paths.ts
export interface AttachmentPaths { root: string; blobs: string; derived: string; runs: string; incoming: string; gcLock: string; log: string }
export function attachmentPaths(home: string): AttachmentPaths;
export function blobPath(p: AttachmentPaths, sha256: string): string;          // ném nếu sha không khớp /^[0-9a-f]{64}$/
export function derivedDir(p: AttachmentPaths, sha256: string): string;        // …/derived/<sha>/v<EXTRACTOR_VERSION>
export function runDir(p: AttachmentPaths, runId: string): string;             // ném nếu runId không phải UUID
// cache.ts
export function ensureCacheDirs(p: AttachmentPaths): void;                     // mkdir 0700, chmod lại nếu lệch
export function hasBlob(p: AttachmentPaths, sha256: string): boolean;          // tồn tại và sha256 bytes khớp tên (kiểm lười: chỉ khi mtime > lần kiểm cuối, lưu trong derived/<sha>/verified)
export async function storeBlob(p: AttachmentPaths, expectedSha: string, data: AsyncIterable<Uint8Array> | Uint8Array, maxBytes: number):
  Promise<{ ok: true; path: string; bytes: number } | { ok: false; reason: 'sai_ma_bam' | 'vuot_10mb' }>;
export function writeRunManifest(p: AttachmentPaths, m: RunManifest): string;  // ghi .tmp 0600 rồi rename
export function readRunManifest(p: AttachmentPaths, runId: string): RunManifest | null;
// gc.ts
export interface GcReport { removedRuns: number; removedBlobs: number; removedDerived: number; freedBytes: number; skippedLocked: boolean }
export function runGc(p: AttachmentPaths, opts: { now: Date; currentRunId: string | null }): GcReport;
// log.ts
export function logLine(p: AttachmentPaths, fields: { now: Date; runId: string; attachmentId: string; sha256: string; bytes: number; status: FileStatus | 'cache_hit' | 'gc'; reason: ReasonCode | null; note?: 'tai_bridge' | 'tai_ssh' | 'cache_hit' | 'gc' }): void;
```

- [ ] **Step 1: Test cache** (`test/files/cache.test.ts`). HOME giả trong `mkdtemp`:

```ts
it('storeBlob ghi .part rồi rename, quyền 0600, thư mục 0700', async () => {
  const p = attachmentPaths(home); ensureCacheDirs(p);
  const data = Buffer.from('xin chao'); const sha = sha256Hex(data);
  const r = await storeBlob(p, sha, data, MAX_FILE_BYTES);
  expect(r).toEqual({ ok: true, path: blobPath(p, sha), bytes: 8 });
  expect(statSync(p.root).mode & 0o777).toBe(0o700);
  expect(statSync(blobPath(p, sha)).mode & 0o777).toBe(0o600);
  expect(readdirSync(p.blobs).filter((n) => n.endsWith('.part'))).toEqual([]);
});
it('sha lệch thì không để lại blob, trả sai_ma_bam', async () => { /* expectedSha của chuỗi khác → ok:false, blobs/ rỗng */ });
it('vượt trần trong lúc stream thì dừng, xóa .part, trả vuot_10mb', async () => { /* async generator 3 khúc 4 MiB, max 10 MiB */ });
it('blob có sẵn bị sửa nội dung thì hasBlob = false và blob bị xóa', () => { /* ghi đè byte, chỉnh mtime */ });
it('runDir từ chối runId không phải UUID; blobPath từ chối sha sai dạng (chặn ../)', () => { /* expect toThrow */ });
it('quyền thư mục cũ 0755 được sửa về 0700', () => { /* mkdir 0755 trước, ensureCacheDirs */ });
```

- [ ] **Step 2: Test GC** (`test/files/gc.test.ts`). Đồng hồ cố định `NOW = 2026-10-09T12:00:00Z`, dựng cây bằng helper `seed({ runs: [{ id, ageDays, shas }], blobs: [{ sha, ageDays, bytes }] })` (đặt mtime bằng `utimesSync`):
  1. Run 8 ngày bị xóa. Blob chỉ run đó tham chiếu và không đụng tới 8 ngày bị xóa cùng `derived/<sha>`.
  2. Blob 8 ngày nhưng còn được run 2 ngày tham chiếu thì giữ.
  3. Tổng 2,5 GB (giả lập `bytes` bằng file thưa: `ftruncateSync`): xóa blob không tham chiếu cũ nhất trước. Còn vượt thì xóa blob chỉ được run > 24 giờ tham chiếu (cùng manifest của run đó). Không bao giờ xóa blob của `currentRunId` hay của run < 24 giờ.
  4. `gc.lock` đang có (pid sống, < 10 phút) thì `skippedLocked: true`, không xóa gì. Khóa của pid chết hoặc > 10 phút thì chiếm lại.
  5. `.part` > 1 giờ bị xóa; `.part` < 1 giờ giữ.
  6. Hai lời gọi `runGc` song song (Promise.all qua `setImmediate`): đúng một lời gọi dọn, lời gọi kia `skippedLocked`.
- [ ] **Step 3: Chạy** `pnpm --filter @crew/mac test -- test/files/cache.test.ts test/files/gc.test.ts` → FAIL (thiếu module).
- [ ] **Step 4: Cài.**
  - `types.ts`/`config.ts` đúng I1/I2 (`REASON_TEXT: Record<ReasonCode, string>`, `NOTE_TEXT: Record<NoteCode, (x: { count?: number; name?: string }) => string>`, `STATUS_LABEL: Record<FileStatus, string>`).
  - `storeBlob`: `createHash('sha256')` theo stream, ghi `blobs/<sha>.part.<pid>` bằng `openSync(…, 'wx', 0o600)`, `fsync`, rồi `renameSync`.
  - `runGc`: đọc mọi `runs/*/manifest.json` + `server-manifest.json` để lập tập tham chiếu, rồi xóa theo luật Step 2. `gc.lock` bằng `openSync(…, 'wx')` ghi `{pid, at}`, gỡ trong `finally`.
- [ ] **Step 5: Docs.** Tạo `docs/flows/mac-attachments.md` theo khuôn `docs/flows/mac-setup.md`: mục đích, sơ đồ thư mục cache I1, luật GC, bảng trạng thái I2. Thêm khối:

```yaml
  mac-attachments:
    title: Đọc file đính kèm trên Mac (crew-mac files)
    doc: docs/flows/mac-attachments.md
    entrypoints:
      - apps/crew-mac/src/files/command.ts
    files:
      - apps/crew-mac/src/files/types.ts
      - apps/crew-mac/src/files/config.ts
      - apps/crew-mac/src/files/paths.ts
      - apps/crew-mac/src/files/cache.ts
      - apps/crew-mac/src/files/gc.ts
      - apps/crew-mac/src/files/log.ts
```

  `command.ts` chưa có ở FL-1, nên tạm để `entrypoints: [apps/crew-mac/src/files/cache.ts]`. FL-3 đổi sang `command.ts`. Chạy `node packages/docs-kit/dist/crew-docs.cjs generate`.
- [ ] **Step 6: Kiểm** (lệnh kiểm chung) → PASS.
- [ ] **Step 7: Commit**

```bash
git add apps/crew-mac/src/files apps/crew-mac/test/files docs/flows.yaml docs/flows/mac-attachments.md docs/files.md
git commit -m "feat(crew-mac): cache file đính kèm có kiểm mã băm và dọn theo hạn"
```

---

### Task 2 (FL-2): Nhận diện byte, chính sách kiểu, ảnh, PDF

**Files:**
- Create: `apps/crew-mac/src/files/{sniff.ts,policy.ts,image.ts,pdf.ts,pdf-info.js}`, `apps/crew-mac/test/files/{sniff,policy,image,pdf}.test.ts`, `apps/crew-mac/test/fixtures/attachments/{encrypted.pdf,scan.pdf,text.pdf,orientation-6.jpg}`
- Modify: `docs/flows/mac-attachments.md`, khối `mac-attachments` (thêm file)

**Interfaces:**
- Consumes: I1, I2 (FL-1); `CommandRunner` (`src/system.ts`); `READ_LIMITS` từ `probe-report.md`. Nếu SP-0 đo được ngưỡng `Read` ảnh khác 5 MB hay số trang PDF mỗi lần khác 20, sửa `INLINE_IMAGE_MAX_BYTES`/`PDF_PAGES_PER_READ` trong `config.ts` theo số đo và ghi vào ledger.
- Produces:

```ts
// sniff.ts
export function detectKind(bytes: Uint8Array, filename: string, declaredType: string): DetectedKind;   // theo byte trước, tên/mime chỉ để tách csv/text/svg
export function blockLabel(kind: DetectedKind, filename: string): BlockLabel | null;                    // 'zip'|'exe'|'docm'|'xlsm'|'office-cu'|'pptx'|'media'|'khac'
// policy.ts
export const ALLOWED_EXTENSIONS: readonly string[]; export const SNIFF_CHECKED: readonly string[]; export const MACRO_EXTENSIONS: readonly string[];
export type Decision =
  | { action: 'image' } | { action: 'pdf' } | { action: 'extract'; kind: 'text' | 'csv' | 'docx' | 'xlsx' }
  | { action: 'reject'; status: 'bi_chan' | 'ma_hoa'; reason: ReasonCode; label?: BlockLabel };
export function decide(kind: DetectedKind, filename: string): Decision;
// image.ts
export async function prepareImage(runner: CommandRunner, blob: string, kind: 'png'|'jpeg'|'gif'|'webp'|'heic', outDir: string):
  Promise<{ readPath: string; resized: boolean } | { error: 'doi_anh_loi' }>;
// pdf.ts
export async function inspectPdf(runner: CommandRunner, blob: string): Promise<{ pages: number; encrypted: boolean } | { error: 'hong_cau_truc' }>;
export function pdfReadHint(pages: number): string;   // "" khi ≤ 10 trang; "pages 1-20, 21-40, …" khi > 10
```

- [ ] **Step 1: Test sniff** (`sniff.test.ts`). Mỗi ca là một buffer dựng trong test:

```ts
const MACHO = Buffer.concat([Buffer.from('cffaedfe', 'hex'), Buffer.alloc(64)]);
it.each([
  ['png thật', png1x1, 'a.png', 'image/png', 'png'],
  ['exe đổi đuôi png, mime khai báo png', MACHO, 'a.png', 'image/png', 'executable'],
  ['MZ', Buffer.from('MZ\x90\x00'), 'a.jpg', 'image/jpeg', 'executable'],
  ['ELF', Buffer.from('7f454c46', 'hex'), 'x.txt', 'text/plain', 'executable'],
  ['heic ftyp', heicHeader('heic'), 'IMG_1.HEIC', 'image/heic', 'heic'],
  ['webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'a.webp', '', 'webp'],
  ['gif', Buffer.from('GIF89a'), 'a.gif', '', 'gif'],
  ['pdf', Buffer.from('%PDF-1.7\n'), 'x.bin', 'application/octet-stream', 'pdf'],
  ['docx', makeOffice('docx'), 'a.docx', '', 'docx'],
  ['docm (vbaProject)', makeOffice('docx', { 'word/vbaProject.bin': 'x' }), 'a.docx', '', 'macro-office'],
  ['zip thường', makeZip({ 'a.txt': 'x' }), 'tool.zip', 'application/zip', 'zip'],
  ['pptx', makeOffice('pptx'), 'a.pptx', '', 'pptx'],
  ['OLE mã hóa', encryptedOleFixture, 'a.docx', '', 'encrypted-office'],
  ['OLE cũ (doc)', plainOleFixture, 'a.doc', '', 'legacy-office'],
  ['csv', Buffer.from('a,b\n1,2\n'), 'a.csv', 'text/csv', 'csv'],
  ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.svg', 'image/svg+xml', 'svg'],
  ['text có NUL', Buffer.from('ab\0cd'), 'a.txt', 'text/plain', 'unknown'],
  ['mp4', mp4Header, 'a.mp4', 'video/mp4', 'media'],
])('%s', (_n, bytes, name, mime, kind) => expect(detectKind(bytes, name, mime)).toBe(kind));
```

  `makeOffice`/`makeZip` lấy từ helper `test/fixtures/attachments/make-fixtures.ts`. FL-2 tạo bản tối thiểu (zip store bằng `node:zlib` crc32); FL-4 mở rộng.
- [ ] **Step 2: Test policy** (`policy.test.ts`):
  - `ALLOWED_EXTENSIONS.join(' ')` đúng nguyên chuỗi I6; tương tự `SNIFF_CHECKED`, `MACRO_EXTENSIONS`. Bảng này phải giống hệt bản của plugin PA-1.
  - `decide('executable', 'a.png')` → `{ action:'reject', status:'bi_chan', reason:'kieu_cam', label:'exe' }`.
  - `decide('zip','tool.zip')` → nhãn `zip`.
  - `decide('macro-office','a.docm')` → `office_macro` nhãn `docm`.
  - `decide('encrypted-office', …)` → `ma_hoa`/`office_ma_hoa`.
  - `decide('png','a.png')` → `image`.
  - `decide('text','a.exe')` → `bi_chan` nhãn `khac` (đuôi ngoài danh sách thì chặn dù byte là text).
  - `decide('text','script.sh')` → `extract text`.
- [ ] **Step 3: Test image** (`image.test.ts`):
  - Runner giả: ảnh PNG 3 MB, 2000×1500 → `readPath` = blob, `resized:false`, không gọi `sips` thay đổi.
  - PNG 6 MB → `sips -Z 4096 -s format jpeg <blob> --out <outDir>/<sha>.jpg`, `resized:true`.
  - HEIC → `sips -s format jpeg`.
  - `sips` thoát 1 → `{ error: 'doi_anh_loi' }`.
  - Lấy kích thước bằng `sips -g pixelWidth -g pixelHeight` (parse đầu ra thật, dán mẫu đầu ra `sips` chạy trên máy này vào test).
  - `it.runIf(darwin)`: chạy thật với `orientation-6.jpg` và một HEIC tạo bằng `sips -s format heic` trong thư mục tạm → ra JPEG đọc được (`sips -g format` = `jpeg`).
- [ ] **Step 4: Test pdf** (`pdf.test.ts`):
  - Runner giả với đầu ra JSON của `pdf-info.js`: `{"pages":3,"encrypted":false}` → `{pages:3, encrypted:false}`; `{"error":"open"}` → `hong_cau_truc`; stdout rác → `hong_cau_truc`.
  - `pdfReadHint(8)` = `''`; `pdfReadHint(45)` = `'pages 1-20, 21-40, 41-45'`.
  - `it.runIf(darwin)`: `encrypted.pdf` → `encrypted:true`; `text.pdf`, `scan.pdf` → `pages ≥ 1`, `encrypted:false`.
- [ ] **Step 5: Chạy** 4 file test → FAIL.
- [ ] **Step 6: Cài.**
  - `sniff.ts` port `detectFormat` (v2 `extract/formats.ts`) giữ nguyên thuật toán OLE/ZIP, rồi bổ sung:
    - chữ ký ảnh/HEIC/executable/media theo I6;
    - OLE không mã hóa → `legacy-office`;
    - OOXML có `ppt/presentation.xml` → `pptx`;
    - zip không phải OOXML → `zip`;
    - text có `<svg` trong 1 KB đầu và đuôi `.svg` → `svg`.
  - `pdf-info.js`: JXA (đọc bằng `readFileSync(new URL('./pdf-info.js', import.meta.url))`, truyền qua `osascript -l JavaScript -e <script> <path>`):

```js
ObjC.import('PDFKit');
function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (doc.isNil()) return JSON.stringify({ error: 'open' });
  return JSON.stringify({ pages: Number(doc.pageCount), encrypted: Boolean(doc.isEncrypted) || Boolean(doc.isLocked) });
}
```

  `pdf-info.js` cần nằm trong `dist/`. Build tsc không chép `.js` ngoài `src`, nên thêm vào script `build` lệnh `cp src/files/pdf-info.js dist/files/` (sửa `package.json`).
- [ ] **Step 7: Kiểm** → PASS. Cập nhật `mac-attachments.md` (bảng kiểu → xử lý theo spec 5.4, chữ ký I6) và khối flow.
- [ ] **Step 8: Commit** `feat(crew-mac): nhận diện file đính kèm theo chữ ký byte và chặn kiểu cấm`.

---

### Task 3 (FL-3): Lệnh `crew-mac files`, bridge, provenance, render

**Files:**
- Create: `apps/crew-mac/src/files/{bridge.ts,provenance.ts,render.ts,run.ts,command.ts}`, `apps/crew-mac/test/files/{bridge,provenance,render,run}.test.ts`
- Modify: `apps/crew-mac/src/cli.ts` (một nhánh `case 'files'` + dòng usage), `apps/crew-mac/src/index.ts` (export `filesCommand`, kiểu I1), `apps/crew-mac/test/cli.test.ts`, `docs/flows/mac-attachments.md`, `docs/flows/mac-setup.md` (R3: `cli.ts` có lệnh mới), khối `mac-attachments` (`entrypoints` → `command.ts`)

**Interfaces:**
- Consumes: FL-1, FL-2; `probe-report.md` (`LINK_FORMS`, `LISTING_FIELDS`, `COMMENT_ORDER`, `ANCESTOR_VIA_BRIDGE`).
- Produces: I3 và

```ts
// bridge.ts — mọi lời gọi có AbortSignal.timeout; lỗi chỉ trả mã, không trả thân
export interface BridgeClient {
  issue(id: string): Promise<{ id: string; identifier: string; description: string | null; parentId: string | null; createdAt: string }>;
  heartbeatContext(id: string): Promise<{ ancestors: { id: string; identifier: string }[] }>;
  comments(id: string): Promise<{ id: string; body: string; authorAgentId: string | null; authorUserId: string | null; createdAt: string }[]>;
  attachments(id: string): Promise<AttachmentMeta[]>;
  content(attachmentId: string, maxBytes: number): Promise<AsyncIterable<Uint8Array>>;   // ném BridgeError
}
export interface AttachmentMeta { id: string; issueId: string; issueCommentId: string | null; contentType: string; byteSize: number; sha256: string; originalFilename: string | null; createdAt: string }
export class BridgeError extends Error { readonly code: 'http' | 'timeout' | 'network' | 'too_large'; readonly status: number | null }
export function createBridgeClient(env: { PAPERCLIP_API_URL: string; PAPERCLIP_API_KEY: string }, fetchImpl?: typeof fetch): BridgeClient;
// provenance.ts
export function extractAttachmentIds(text: string): string[];          // ![…](/api/attachments/<uuid>/content), […](…), <img src>, <a href>; bỏ fenced/inline code; theo thứ tự xuất hiện, mỗi id một lần; URL tuyệt đối chỉ nhận khi path đúng mẫu
export interface SourceText { kind: 'description' | 'comment'; issueKey: string; ordinal: number | null; author: 'chủ dự án' | 'agent' | null; commentId: string | null; text: string }
export function sourceFor(a: AttachmentMeta, issueKey: string, relation: 'self' | 'ancestor', texts: SourceText[]): string;   // câu nguồn I3
// run.ts
export interface FilesDeps { ctx: MacContext; bridge: BridgeClient; runner: CommandRunner; sleep(ms: number): Promise<void>; extract?: ExtractFn /* FL-4 */; redact?: RedactFn /* FL-5 */ }
export async function collectFiles(deps: FilesDeps, input: { issueId: string; runId: string }): Promise<RunManifest>;
// render.ts
export function renderMarkdown(m: RunManifest): string;
// command.ts
export async function filesCommand(ctx: MacContext, argv: string[], env: NodeJS.ProcessEnv, io: { out(s: string): void; err(s: string): void }): Promise<number>;
```

- [ ] **Step 1: Test provenance** (`provenance.test.ts`), port ca của v2 `ticket-images` và đổi mẫu:
  - Mô tả có `![a](/api/attachments/<A>/content)` rồi `[b.pdf](/api/attachments/<B>/content)` → `[A, B]`.
  - Link trong khối ``` hoặc `inline` bị bỏ.
  - `<img src="https://crew.2p-solutions.com/api/attachments/<C>/content">` → `C`.
  - Link `/api/attachments/not-a-uuid/content` bị bỏ.
  - Lặp id → một lần.
  - `sourceFor`:
    - A link trong mô tả → `mô tả TPS-80`;
    - D không link nhưng `issueCommentId` = comment thứ 3 (user) → `bình luận thứ 3 của TPS-80 (chủ dự án)`;
    - E link ở cả mô tả và comment → nguồn đầu tiên (mô tả);
    - F của tổ tiên → `issue cha TPS-79`;
    - G không link, không comment → `đính kèm của issue TPS-80`.
- [ ] **Step 2: Test bridge** (`bridge.test.ts`) với `fetch` giả:
  - Header `Authorization: Bearer <key>` có trên mọi request. URL ghép từ `PAPERCLIP_API_URL` không có `/` thừa.
  - 500 với thân `MÃ-KIỂM-RÒ-RỈ` → `BridgeError{code:'http',status:500}`, `message` không chứa chuỗi mốc.
  - Timeout (fetch không trả) → `code:'timeout'` sau `AbortSignal.timeout` (dùng `vi.useFakeTimers`).
  - `content` vượt `maxBytes` khi stream → `too_large`.
- [ ] **Step 3: Test run** (`run.test.ts`) với bridge giả + runner giả + HOME tạm, đồng hồ giả:
  1. 3 file (png, pdf 25 trang, zip) → manifest có 3 mục, đúng `status`/`reason`/`readPaths`/`pages`; pdf có note `pdf_doc_theo_trang`. Lần chạy thứ hai cùng sha → không gọi `content` (cache hit, log `cache_hit`).
  2. **Liệt kê lại (Review Focus 1):** issue `createdAt` = now − 30 giây; lần liệt kê đầu 1 file, sau `sleep(15000)` lần hai 2 file → manifest 2 file. Issue tạo cách đây 5 phút thì không `sleep`.
  3. 45 attachment → 40 mục xử lý (hiện tại trước, tổ tiên gần trước, mới trước), 5 mục `qua_lon`/`vuot_40_file`, không tải.
  4. `byteSize` > 10 MB (khai báo) → `qua_lon`/`vuot_10mb`, không tải.
  5. Bridge 500 cho 1 file → `khong_doc_duoc`/`tai_loi`; file khác vẫn `san_sang`; exit 0.
  6. sha tải về lệch listing → `hong`/`sai_ma_bam`, không có blob.
  7. `ANCESTOR_VIA_BRIDGE = no` (từ SP-0): listing tổ tiên trả 403 → các file tổ tiên không xuất hiện, thêm một dòng cố định ở render: `Không đọc được file của issue cha qua bridge.`. Nếu SP-0 báo `yes` thì ca này chỉ kiểm 403 không làm hỏng lệnh.
  8. Không có attachment → manifest `files: []`.
  9. `extract` chưa có (FL-3 chạy trước FL-4) → docx/xlsx/text/csv ra `khong_doc_duoc`/`trinh_doc_loi`. FL-4 thay ca này.
- [ ] **Step 4: Test render** (`render.test.ts`): snapshot inline đúng ví dụ I3 cho một manifest dựng tay (4 dòng, kể cả câu mở đầu). Không có file → `Không có file đính kèm.`.
- [ ] **Step 5: Test CLI** (`cli.test.ts` thêm):
  - `main(['files'])` thiếu `--issue` → exit 2.
  - Thiếu env → exit 2 với câu I3.
  - `--issue` không phải UUID → exit 2.
  - `files --gc-only` → chạy `runGc`, in `Đã dọn: <n> run, <m> blob` rồi exit 0, không cần env bridge (dùng cho AC9).
- [ ] **Step 6: Chạy** → FAIL. **Cài.**
  - `collectFiles`:
    1. `ensureCacheDirs`, rồi `runGc({ currentRunId })`.
    2. `issue` + `heartbeatContext` + `comments` + `attachments` (của issue và từng ancestor).
    3. Liệt kê lại nếu issue mới.
    4. Sắp xếp và cắt 40.
    5. Với từng file: cache hoặc tải (`storeBlob`), rồi `detectKind` trên 4 KB đầu của blob, rồi `decide`, rồi xử lý (image/pdf/extract).
    6. `writeRunManifest`, mỗi file một `logLine`.
  - `command.ts` parse cờ, dựng `createBridgeClient(process.env)`, gọi `collectFiles`, in `renderMarkdown` hoặc JSON. Mọi lỗi không lường trước → exit 1 với `files: lỗi nội bộ, xem ~/.crew/logs/attachments.log`, log chỉ ghi `err.name`.
  - `cli.ts`:

```ts
      case 'files':
        return await filesCommand(ctx, args, process.env, io);
```

- [ ] **Step 7: Docs.**
  - `mac-attachments.md`: luồng lệnh, câu nguồn, ví dụ đầu ra, cách agent gọi.
  - `mac-setup.md`: thêm `files` vào danh sách lệnh của `cli.ts`, trỏ sang flow `mac-attachments`.
  - Chạy `crew-docs generate`.
- [ ] **Step 8: Kiểm** (lệnh chung + `test/cli.test.ts`) → PASS.
- [ ] **Step 9: Commit** `feat(crew-mac): lệnh files liệt kê file đính kèm có nguồn và trạng thái cho agent`.

---

### Task 4 (FL-B, chỉ khi G0 = B): Đọc cache do server đẩy

**Files:**
- Create: `apps/crew-mac/src/files/server-sync.ts`, `apps/crew-mac/test/files/server-sync.test.ts`
- Modify: `apps/crew-mac/src/files/run.ts`, `apps/crew-mac/src/files/config.ts` (`ATTACHMENT_TRANSPORT = 'ssh'`), `docs/flows/mac-attachments.md`, khối flow

**Interfaces:**
- Consumes: I5 (`IncomingManifest`, `pending`, `ready`); SV-1 đã ff vào `crew/r2-2` (đọc `server/src/crew/attachment-sync.ts` để đối chiếu tên trường).
- Produces: `export async function awaitServerSync(p: AttachmentPaths, runId: string, deps: { sleep(ms: number): Promise<void>; now(): Date }): Promise<IncomingManifest | null>`.

- [ ] **Step 1: Test** (`server-sync.test.ts`, đồng hồ và `sleep` giả):
  1. `ready` + `server-manifest.json` có sẵn → trả manifest ngay, các blob `sent`/`cached` có trong `blobs/` → không gọi bridge `content`.
  2. `pending` có, `ready` xuất hiện sau 40 giây → chờ, trả manifest.
  3. `pending` có, quá 90 giây không `ready` → `null`. `run.ts` dùng bridge cho file ≤ 256 KB, file lớn hơn ghi `chua_dong_bo`/`den_sau`.
  4. Không thấy `pending` trong 15 giây và có file > 256 KB chưa có blob → `null` sau 15 giây. Không có file lớn nào thiếu thì không chờ.
  5. Listing (bridge) có file mới hơn `generatedAt` của manifest: ≤ 256 KB → tải bridge `san_sang`; > 256 KB → `chua_dong_bo`/`den_sau` (Review Focus 1).
  6. `server-manifest.json` hỏng JSON hoặc `version ≠ 1` → `null`, log cố định, không ném.
  7. Blob server gửi lệch sha → `hasBlob` false; mục `blob: 'hash_mismatch'` hoặc `over_limit` của server → file ≤ 256 KB tải lại qua bridge, lớn hơn thì `hong`/`sai_ma_bam` (hash_mismatch) hoặc `qua_lon`/`vuot_10mb` (over_limit).
- [ ] **Step 2: FAIL → cài → PASS.** Trong `run.ts`: nhánh `if (ATTACHMENT_TRANSPORT === 'ssh')` trước khi tải; metadata từ server chỉ dùng để biết blob nào đã có, provenance vẫn theo FL-3.
- [ ] **Step 3: Docs + Commit** `feat(crew-mac): files dùng file đính kèm do server đẩy sẵn qua SSH`.

---

### Task 5 (FL-4): Parser port v2 trong process con

**Files:**
- Create: `apps/crew-mac/src/files/extract/{limits.ts,index.ts,text.ts,csv.ts,zip.ts,xml.ts,docx.ts,xlsx.ts}`, `apps/crew-mac/src/files/{worker-entry.ts,worker-client.ts}`, `apps/crew-mac/build-files.mjs`, `apps/crew-mac/test/files/{extract-ooxml,extract-text-csv,worker}.test.ts`
- Modify: `apps/crew-mac/package.json`, `pnpm-lock.yaml`, `apps/crew-mac/test/fixtures/attachments/make-fixtures.ts` (port đầy đủ `makeOffice`, `makeZip` từ v2), `apps/crew-mac/src/files/run.ts` (truyền `extract`), `docs/flows/mac-attachments.md`, khối flow

**Interfaces:**
- Consumes: v2 `extract/*.ts` tại `a13dd7d`; I4.
- Produces: I4; `export type ExtractFn = (req: Omit<WorkerRequest,'outDir'> & { sha256: string }) => Promise<{ status: FileStatus; reason: ReasonCode | null; notes: NoteCode[]; readPaths: string[] }>`; `export function createWorkerExtract(p: AttachmentPaths, opts?: { workerPath?: string; timeoutMs?: number }): ExtractFn`.

- [ ] **Step 1: Port test v2 sang Vitest.**
  - Chép `attachments-ooxml.unit.test.ts` (27 ca) và `attachments-text-csv.unit.test.ts` (18 ca) thành `extract-ooxml.test.ts`, `extract-text-csv.test.ts`.
  - Đổi `node:test`/`assert` sang `it`/`expect`, import từ `../../src/files/extract/index.js`.
  - Giữ nguyên tên ca và giá trị mong đợi (locator `{kind:'docx', part, paragraph, table, row, cell}`, sheet ẩn `veryHidden`, `FORMULA_CACHE_MISSING`, DTD bị từ chối, zip bomb `LIMIT_EXCEEDED`).
  - Ca dùng `extractImage`/`@napi-rs/canvas` (ảnh nhúng) đổi mong đợi: ảnh nhúng PNG/JPEG được ghi ra `media/<n>.<ext>` thành output `kind:'image'`; ảnh nhúng kiểu khác → note `anh_nhung_bo_qua`, trạng thái `partial`.
- [ ] **Step 2: Test đầu ra `.md`.**
  - DOCX ra `# <filename>` rồi từng đoạn `[đoạn N] …`, bảng `[bảng T, hàng R, ô C] …`.
  - XLSX ra `## Sheet "<tên>"` (thêm ` (ẩn)` khi ẩn), từng ô `[<sheet>!B3] 771 304`, công thức `[<sheet>!C1] =1+1 → 2`.
  - CSV giữ nguyên bản gốc (không trích), text giữ nguyên. Hai loại này chỉ qua giải mã UTF-8 nghiêm; lỗi thì `khong_utf8`.
- [ ] **Step 3: Test worker** (`worker.test.ts`):
  1. Build trước bằng `node apps/crew-mac/build-files.mjs` trong `beforeAll`.
  2. `createWorkerExtract` với docx mẫu → `san_sang`, `readPaths` trỏ `derived/<sha>/v1/<tên>.md` 0600.
  3. Zip bomb (tỉ lệ > 100) → `mot_phan` hoặc `hong` đúng mã v2, không treo.
  4. Worker giả treo (`workerPath` trỏ script `setInterval`) với `timeoutMs: 500` → `khong_doc_duoc`/`trinh_doc_loi`, process con đã chết (`process.kill(pid, 0)` ném).
  5. Worker giả in rác → `trinh_doc_loi`.
  6. Worker giả cấp phát vượt `--max-old-space-size` → thoát khác 0 → `trinh_doc_loi`.
  7. `workerPath` không tồn tại → `trinh_doc_loi`.
  8. Bundle `dist/files-worker.cjs` không chứa chuỗi `fetch(`, `require("http`, `require("https`, `require("net` (đọc file và `expect(...).not.toMatch`).
  9. Env của process con chỉ có `PATH`, `HOME`, `LANG`: worker giả in `Object.keys(process.env)`.
- [ ] **Step 4: Chạy** → FAIL. **Cài.**
  - Port 7 file v2 vào `extract/`. Bỏ phụ thuộc `../config.ts`/`../contracts.ts` bằng `limits.ts` (chép `ParserLimits` + `parserDefaults` nguyên số) và kiểu tối thiểu (`CoverageUnit`, `SourceLocator`, `Problem`).
  - `docx.ts` thay `extractImage` bằng `writeMedia` (sniff PNG/JPEG/GIF/WebP, ghi raw).
  - `worker-entry.ts` đọc một dòng stdin, chạy extractor tương ứng, ghi output vào `outDir`, in `WorkerResponse`.
  - `worker-client.ts`:
    1. `spawn(process.execPath, ['--max-old-space-size=512', workerPath], { env: { PATH, HOME, LANG:'C.UTF-8' }, cwd: mkdtemp, stdio: 'pipe' })`.
    2. Timeout thì `SIGKILL`.
    3. Ghi output vào `derived/<sha>/v1/.tmp-<pid>` rồi `rename` sang `v1/` khi xong; chmod 0600 mọi file. Bản đã có thì dùng lại.
  - `build-files.mjs`:

```js
import { build } from 'esbuild';
await build({ entryPoints: ['src/files/worker-entry.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  outfile: 'dist/files-worker.cjs', legalComments: 'none', logLevel: 'warning' });
```

  - `package.json`: `"build": "tsc -p tsconfig.build.json && node build-files.mjs && cp src/files/pdf-info.js dist/files/"`; devDependencies `esbuild` `^0.28.2`, `yauzl` `3.4.0`, `saxes` `6.0.0`, `@types/yauzl` (bản khớp). Chạy `pnpm install`.
- [ ] **Step 5: Kiểm** (lệnh chung + `pnpm --filter @crew/mac build`) → PASS.
- [ ] **Step 6: Commit** `feat(crew-mac): trích DOCX, XLSX, CSV, text trong process con giới hạn bộ nhớ và thời gian`.

---

### Task 6 (FL-5): Che credential, không rò rỉ

**Files:**
- Create: `apps/crew-mac/src/files/redact.ts`, `apps/crew-mac/test/files/{redact,no-leak}.test.ts`
- Modify: `apps/crew-mac/src/files/run.ts` (che text gốc và bản trích trước khi trả `readPaths`), `apps/crew-mac/src/files/worker-client.ts` (bản trích `.md` chỉ được công bố sau khi che), `docs/flows/mac-attachments.md`

**Interfaces:**
- Consumes: `SECRET_RULES` từ `packages/docs-kit/src/secret-scan.ts`. Import bằng đường dẫn tương đối `../../../../packages/docs-kit/src/secret-scan.js`; nếu tsc `rootDir` chặn thì gom vào bundle worker (che chạy trong worker), quyết định ghi ledger. `crew-mac` không lấy `@crew/docs-kit` làm dependency lúc chạy.
- Produces:

```ts
export type RedactFn = (text: string) => { text: string; findings: CredentialFinding[] };
export function redactSecrets(text: string): { text: string; findings: CredentialFinding[] };
// Mọi luật trong SECRET_RULES, cờ 'g' thêm vào, BỎ QUA rule.allow. Thay bằng `[ĐÃ CHE: <rule.id>]`. line đếm từ 1.
```

- [ ] **Step 1: Test redact:**
  - `aws_access_key_id = AKIAIOSFODNN7EXAMPLE` → `aws_access_key_id = [ĐÃ CHE: aws-access-key-id]`, findings `[{rule:'aws-access-key-id', line:1}]`.
  - Hai khóa trên một dòng → hai lần thay.
  - PEM nhiều dòng (dòng mở đầu kiểu BEGIN … PRIVATE KEY; test ghép chuỗi lúc chạy vì R7 pre-commit chặn header thật) → dòng mở đầu bị che.
  - Text sạch → giữ nguyên, findings rỗng.
  - Test đếm `SECRET_RULES.length` để phát hiện khi docs-kit thêm luật.
- [ ] **Step 2: Test no-leak** (Review Focus 4). Một lượt `collectFiles` với fixture có:
  - txt chứa khóa và mốc `MỐC-RÒ-RỈ-1`;
  - xlsx có ô chứa `ghp_` + 36 ký tự;
  - bridge giả trả 500 cho một file với thân chứa `MỐC-RÒ-RỈ-2`;
  - worker giả in stderr chứa `MỐC-RÒ-RỈ-3`.
  
  Kiểm:
  - Đọc stdout của `filesCommand` (markdown và `--json`), mọi file trong `runs/`, `attachments.log`, bản `.md` trong `derived/`.
  - Không có khóa AWS, không có `ghp_…`, không có `MỐC-RÒ-RỈ-2`, `MỐC-RÒ-RỈ-3`.
  - `MỐC-RÒ-RỈ-1` chỉ được có trong bản `.md` đã che (nội dung không phải credential vẫn giữ). Không có trong log/manifest/stdout.
  - Manifest có `credentialFindings` đúng luật và dòng, không có giá trị.
- [ ] **Step 3: FAIL → cài → PASS.**
  - Text/CSV: bản agent đọc là `derived/<sha>/v1/<tên>.redacted.txt` (CSV giữ đuôi `.csv`). Không bao giờ trỏ `readPaths` vào blob gốc của file text.
  - Ảnh/PDF trỏ blob gốc (không quét được, theo spec §5.8).
- [ ] **Step 4: Docs + Commit** `feat(crew-mac): che credential trong file đính kèm trước khi agent đọc`.
