# R2-5 — Gói `plugin` (fork `packages/crew-plugin`)

Đọc trước: [plan.md](plan.md) (Global Constraints, Review Focus, Interface I1–I8), spec §4.1–4.8,
`reports/sp-0-probe.md`.

Worktree `.worktrees/paperclip-r25-plugin`, nhánh `crew/r25-plugin` rẽ từ `crew/r2-5`. Lệnh chạy trong
`packages/crew-plugin` trừ khi ghi khác.
- Test một file: `pnpm vitest run --config vitest.config.ts src/__tests__/<file>`. Test DB dùng Postgres nhúng: kiểm
  `ipcs -m` trước, chạy một file một lúc.
- Typecheck: `pnpm typecheck`. Biome trên file đổi: `pnpm exec biome check <file…>` ở gốc fork.

Namespace viết tắt trong tài liệu này là `ns` = `plugin_crew_core_0433ea20b6`. Code luôn lấy bằng
`pluginNamespace(ctx)`.

Mỗi ticket: dòng đầu tiên là ghi ledger `- <date> <ID> bắt đầu (<model>)`. Commit cuối ticket theo Conventional
Commits, không nhắc AI hay mã ticket.

---

## DB-1: kho blob, lịch sử, webhook, reader (opus)

**Files:**
- Create: `migrations/0008_docs_storage.sql` (đúng I2), `src/docs/content-key.ts`, `src/docs/manifest.ts`,
  `src/docs/history.ts`, `src/__tests__/docs-dedup.db.test.ts`, `src/__tests__/docs-manifest.test.ts`,
  `src/__tests__/docs-content-key.test.ts`
- Modify: `src/docs/webhook.ts`, `src/docs/data.ts`, `src/features.ts` (1 dòng), `src/__tests__/docs.db.test.ts`,
  `package.json` (`"yaml": "^2.8.1"` vào `dependencies`), `pnpm-lock.yaml`

**Interfaces:**
- Consumes: I1 (body), I2 (DDL).
- Produces:
  - `computeContentKey(input: ContentKeyInput): string`;
  - `parseFlowsManifest(text: string): FlowsManifestResult`;
  - `storeDocsSnapshot(ctx, body: DocsSnapshot): Promise<{ snapshotId: string; deduplicated: boolean }>`;
  - `loadDocsTree(ctx, projectId, companyId, snapshotId?)`, `loadDocsPage(ctx, projectId, path, companyId, snapshotId?)`
    (thêm tham số cuối);
  - `loadDocsHistory(ctx, projectId, companyId, limit?)`;
  - `resolveSnapshot(ctx, companyId, projectId, snapshotId?): Promise<SnapshotRow | null>` (export từ `data.ts`, GR-1
    dùng);
  - `loadManifestForSnapshot(ctx, snapshot): Promise<FlowsManifestOk | null>` (export từ `data.ts`, GR-1 dùng).

- [ ] **Bước 1: Viết test thuần cho `content-key` và `manifest` (đỏ).**

`src/__tests__/docs-content-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeContentKey } from "../docs/content-key.js";

const base = { format: 2 as const, commit: "a".repeat(40), auditState: "verified", manifestSha256: null,
  pages: [{ path: "docs/b.md", sha256: "2".repeat(64) }, { path: "docs/a.md", sha256: "1".repeat(64) }],
  dropped: [{ path: "docs/x.md", reason: "secret-scan" }] };

describe("computeContentKey", () => {
  it("is a 64-hex sha and ignores page order", () => {
    const key = computeContentKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(computeContentKey({ ...base, pages: [...base.pages].reverse() })).toBe(key);
  });
  it("changes when any part changes", () => {
    const key = computeContentKey(base);
    for (const variant of [
      { ...base, commit: "b".repeat(40) },
      { ...base, auditState: "invalid" },
      { ...base, format: 1 as const },
      { ...base, manifestSha256: "3".repeat(64) },
      { ...base, pages: [{ path: "docs/a.md", sha256: "9".repeat(64) }, base.pages[0]!] },
      { ...base, dropped: [] },
    ]) expect(computeContentKey(variant)).not.toBe(key);
  });
});
```

`src/__tests__/docs-manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseFlowsManifest } from "../docs/manifest.js";

const ok = `version: 1
source:
  include: ["apps/**"]
flows:
  mac-setup:
    title: Cài Mac
    doc: docs/flows/mac-setup.md
    entrypoints: [apps/crew-mac/src/cli.ts]
    files: [apps/crew-mac/src/status/docs.ts]
    tests: [apps/crew-mac/test/status-docs.test.ts]
shared:
  apps/crew-mac/src/paths.ts: [mac-setup]
`;

describe("parseFlowsManifest", () => {
  it("parses a valid manifest with defaults", () => {
    const result = parseFlowsManifest(ok);
    expect(result.state).toBe("ok");
    if (result.state !== "ok") return;
    expect(result.flows).toEqual([{ id: "mac-setup", title: "Cài Mac", doc: "docs/flows/mac-setup.md",
      entrypoints: ["apps/crew-mac/src/cli.ts"], files: ["apps/crew-mac/src/status/docs.ts"],
      tests: ["apps/crew-mac/test/status-docs.test.ts"] }]);
    expect(result.shared).toEqual([{ path: "apps/crew-mac/src/paths.ts", flows: ["mac-setup"] }]);
  });
  it("defaults missing arrays to empty", () => {
    const result = parseFlowsManifest('version: 1\nsource: {include: ["a/**"]}\nflows: {x: {title: X, doc: docs/x.md}}\n');
    expect(result.state === "ok" && result.flows[0]).toMatchObject({ entrypoints: [], files: [], tests: [] });
  });
  it.each([
    ["not yaml", "flows: [\n"],
    ["duplicate key", "version: 1\nversion: 1\n"],
    ["wrong version", 'version: 2\nsource: {include: ["a"]}\nflows: {}\n'],
    ["no source", "version: 1\nflows: {}\n"],
    ["bad flow id", 'version: 1\nsource: {include: ["a"]}\nflows: {Bad_Id: {title: X, doc: d.md}}\n'],
    ["files not strings", 'version: 1\nsource: {include: ["a"]}\nflows: {x: {title: X, doc: d.md, files: [1]}}\n'],
    ["shared to unknown flow", 'version: 1\nsource: {include: ["a"]}\nflows: {}\nshared: {a.ts: [nope]}\n'],
  ])("rejects %s with at most 20 short errors", (_name, text) => {
    const result = parseFlowsManifest(text);
    expect(result.state).toBe("invalid");
    if (result.state === "invalid") {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.length).toBeLessThanOrEqual(20);
      for (const error of result.errors) expect(error.length).toBeLessThanOrEqual(200);
    }
  });
});
```

Chạy: `pnpm vitest run --config vitest.config.ts src/__tests__/docs-content-key.test.ts src/__tests__/docs-manifest.test.ts`.
Kỳ vọng: FAIL (module không tồn tại).

- [ ] **Bước 2: Cài `content-key.ts` và `manifest.ts`.**

```ts
// src/docs/content-key.ts
import { createHash } from "node:crypto";

export interface ContentKeyInput {
  format: 1 | 2;
  commit: string;
  auditState: string;
  manifestSha256: string | null;
  pages: ReadonlyArray<{ path: string; sha256: string }>;
  dropped: ReadonlyArray<{ path: string; reason: string }>;
}

/** Identity of a snapshot's content: equal keys mean a resend of the same snapshot. */
export function computeContentKey(input: ContentKeyInput): string {
  const pages = [...input.pages].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((page) => `${page.path}\u0000${page.sha256}`);
  const dropped = [...input.dropped].map((item) => `${item.path}\u0000${item.reason}`).sort();
  return createHash("sha256")
    .update(JSON.stringify([input.format, input.commit, input.auditState, input.manifestSha256, pages, dropped]))
    .digest("hex");
}
```

```ts
// src/docs/manifest.ts
import { parse } from "yaml";

export interface ManifestFlow { id: string; title: string; doc: string; entrypoints: string[]; files: string[]; tests: string[] }
export type FlowsManifestOk = { state: "ok"; flows: ManifestFlow[]; shared: Array<{ path: string; flows: string[] }> };
export type FlowsManifestResult = FlowsManifestOk | { state: "invalid"; errors: string[] };

const FLOW_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isPath = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 1024 && !/[\u0000-\u001f]/.test(v);

/** Mirrors the FlowsManifest schema of crew-docs (packages/docs-kit/src/flows-schema.ts) without zod. */
export function parseFlowsManifest(text: string): FlowsManifestResult {
  const errors: string[] = [];
  const add = (message: string) => { if (errors.length < 20) errors.push(message.slice(0, 200)); };
  let raw: unknown;
  try {
    raw = parse(text, { uniqueKeys: true, prettyErrors: false });
  } catch (error) {
    return { state: "invalid", errors: [`YAML lỗi: ${String((error as Error).message ?? error).split("\n")[0]}`.slice(0, 200)] };
  }
  if (!isObject(raw)) return { state: "invalid", errors: ["gốc phải là object"] };
  if (raw.version !== 1) add("version phải là 1");
  if (!isObject(raw.source) || !Array.isArray(raw.source.include) || raw.source.include.length === 0
    || !raw.source.include.every((v) => typeof v === "string")) add("source.include phải là mảng chuỗi khác rỗng");
  const flows: ManifestFlow[] = [];
  if (!isObject(raw.flows)) add("flows phải là object");
  else for (const [id, value] of Object.entries(raw.flows)) {
    if (!FLOW_ID.test(id)) { add(`flows.${id}: id phải kebab-case`); continue; }
    if (!isObject(value) || typeof value.title !== "string" || !value.title || !isPath(value.doc)) {
      add(`flows.${id}: cần title và doc`); continue;
    }
    const list = (key: string): string[] | null => {
      const v = value[key];
      if (v === undefined || v === null) return [];
      return Array.isArray(v) && v.every(isPath) ? v as string[] : null;
    };
    const entrypoints = list("entrypoints"); const files = list("files"); const tests = list("tests");
    if (!entrypoints || !files || !tests) { add(`flows.${id}: entrypoints/files/tests phải là mảng đường dẫn`); continue; }
    flows.push({ id, title: value.title, doc: value.doc, entrypoints, files, tests });
  }
  const shared: Array<{ path: string; flows: string[] }> = [];
  const ids = new Set(flows.map((flow) => flow.id));
  if (raw.shared !== undefined && raw.shared !== null) {
    if (!isObject(raw.shared)) add("shared phải là object");
    else for (const [path, value] of Object.entries(raw.shared)) {
      if (!isPath(path) || !Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && ids.has(v))) {
        add(`shared.${path}: phải là danh sách flow có thật`); continue;
      }
      shared.push({ path, flows: value as string[] });
    }
  }
  return errors.length ? { state: "invalid", errors } : { state: "ok", flows, shared };
}
```

Chạy lại hai test. Kỳ vọng: PASS. `yaml` phải có trong `dependencies` và `pnpm install` ở gốc fork đã chạy.
`build.mjs` bundle worker bằng esbuild (kiểm: `node build.mjs` rồi `grep -c "uniqueKeys" dist/worker.js` ≥ 1).

- [ ] **Bước 3: Viết test DB `docs-dedup.db.test.ts` (đỏ).** Dựng DB như `docs.db.test.ts`:
  - chạy lần lượt `0001`…`0005` rồi `0008`, mỗi câu qua `validatePluginMigrationStatement(statement, ns, ["projects",
    "issues", "issue_comments"])`;
  - `ctx.db.execute` qua `validatePluginRuntimeExecute`, `ctx.db.query` qua `validatePluginRuntimeQuery`.

Helper trang có sha thật:

```ts
import { createHash } from "node:crypto";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const page = (path: string, title: string, text: string) =>
  ({ path, title, parentPath: path.slice(0, path.lastIndexOf("/")), text, sha256: sha(text) });
const ten = Array.from({ length: 10 }, (_, i) => page(`docs/p${i}.md`, `P${i}`, `# P${i}\nnội dung ${i}`));
const manifestText = 'version: 1\nsource: {include: ["src/**"]}\nflows: {core: {title: Core, doc: docs/p0.md, files: [src/a.ts]}}\n';
const v2 = (commit: string, pages = ten, extra: Record<string, unknown> = {}) => ({
  version: 1, format: 2, companyId, machineId, projectId, repo: "repo-a", commit, auditState: "verified", checkExit: 0,
  pages, links: [], dropped: [],
  manifest: { status: "present", text: manifestText, sha256: sha(manifestText) },
  commits: { base: null, truncated: false, items: [{ sha: commit, merge: false, paths: ["src/a.ts", "docs/p1.md"] }] },
  ...extra });
```

Các ca (mỗi ca một `it`, dùng chung DB, xóa sạch namespace giữa ca bằng `DELETE` qua `sql` trực tiếp):
1. **Dedup một trang đổi:**
   - gửi `v2(A)` rồi `v2(B, [page("docs/p1.md","P1","sửa"), ...ten.filter(p=>p.path!=="docs/p1.md")])`;
   - `count(docs_blobs)` = 12 (10 trang + manifest + 1 trang mới);
   - `count(docs_snapshots WHERE completed_at IS NOT NULL)` = 2;
   - `loadDocsTree(..)` trả commit B;
   - `loadDocsPage(ctx, projectId, "docs/p1.md", companyId, snapshotIdA)` trả text cũ.
2. **Gửi lại:** gửi lại nguyên `v2(B…)` hai lần. Số snapshot hoàn tất vẫn 2, con trỏ vẫn B. Hàm trả
   `deduplicated: true`.
3. **Song song:** `Promise.all([receive(v2(C)), receive(v2(C))])` cả hai resolve, số snapshot hoàn tất cho C = 1.
4. **Sha sai:** trang có `sha256: sha("khác")`. `receiveDocsSnapshot` reject `/mã băm trang không khớp/`. Số dòng
   `docs_snapshots`, `docs_snapshot_pages`, `docs_commits` không đổi.
5. **Blob giả trùng sha:** chèn trực tiếp bằng `sql` một blob `sha256 = sha("thật")`, `text = "giả"`, `byte_size = 3`.
   Gửi snapshot có trang `"thật"`. Kết quả: reject `/trùng mã băm nhưng khác nội dung/`, không có snapshot mới.
6. **Mac cũ:** body không có `format`/`manifest`/`commits`. Được nhận, `format = 1`, `manifest_state = 'not_sent'`.
7. **Project khác cùng nội dung:** `v2(A)` cho `otherProjectSameCompany`. `count(docs_blobs)` không tăng.
   `loadDocsTree(ctx, projectId, companyId, snapshotIdCuaProjectKhac)` reject `/Snapshot không thuộc dự án/`.
8. **Commit:** sau ca 1 có `docs_commits` (A, B) với `first_snapshot_id` đúng bản, và `docs_commit_files` có
   `src/a.ts` cho A. Gửi `commits.items` có sha trùng thì không lỗi.
9. **Dọn dở dang:**
   - chèn bằng `sql` một snapshot `completed_at NULL`, `received_at = now() - interval '11 minutes'`, có 1 dòng
     `docs_snapshot_pages`. Gửi `v2(D)`. Snapshot dở bị xóa, trang của nó cũng mất;
   - snapshot hoàn tất cũ hơn 10 phút **còn nguyên**.
10. **Lịch sử:** `loadDocsHistory(ctx, projectId, companyId)` trả B (current), rồi A, theo thứ tự. `changed` của B là
    `{added:0, modified:1, removed:0}`, của A là `null`.
11. **Migration backfill** (DB riêng, trong cùng file):
    - chạy `0001`…`0005`;
    - chèn dữ liệu kiểu cũ: một snapshot hiện hành, 2 trang, một trang có `sha256` cột cũ sai;
    - chạy `0008`;
    - kiểm: `docs_blobs` có đúng 2 sha tính lại, `docs_snapshot_pages` 2 dòng với sha tính lại, snapshot có
      `completed_at` và `content_key LIKE 'legacy:%'`, `loadDocsTree` đọc được qua bảng mới.
12. **Cỡ dữ liệu:**
    - 200 snapshot × 300 trang, mỗi bản đổi 15 trang (5 %), chèn bằng `storeDocsSnapshot`;
    - in `console.log(JSON.stringify({ logical, physical, blobsTotal: pg_total_relation_size('ns.docs_blobs'), pagesTotal: … }))`;
    - khẳng định `physical < logical / 10`;
    - đặt `it(…, { timeout: 300_000 })`.

Chạy: `pnpm vitest run --config vitest.config.ts src/__tests__/docs-dedup.db.test.ts`. Kỳ vọng: FAIL.

- [ ] **Bước 4: Viết `0008_docs_storage.sql`** đúng khối I2 trong plan (chép nguyên văn). Kiểm không có `;` trong
  chuỗi hay comment, và không có dòng comment `--` (test tách theo `;`).

- [ ] **Bước 5: Viết lại `webhook.ts`.**

Giữ nguyên `validateDocsSnapshot` cũ và thêm vào cuối hàm:

```ts
import { createHash } from "node:crypto";
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
// trong validateDocsSnapshot, sau các kiểm cũ:
for (const p of pages) if (sha256(p.text) !== p.sha256) fail("mã băm trang không khớp nội dung");
if (v.format !== undefined && v.format !== 2) fail("format không hợp lệ");
if ((v.manifest !== undefined || v.commits !== undefined) && v.format !== 2) fail("format không hợp lệ");
if (v.manifest !== undefined) {
  const m = v.manifest as Record<string, unknown>;
  const valid = m && (m.status === "absent"
    || m.status === "dropped" && (m.reason === "secret-scan" || m.reason === "too-large")
    || m.status === "present" && typeof m.text === "string" && Buffer.byteLength(m.text, "utf8") <= 512 * 1024
      && sha64.test(String(m.sha256)) && sha256(m.text) === m.sha256);
  if (!valid) fail("manifest không hợp lệ");
}
if (v.commits !== undefined) {
  const c = v.commits as Record<string, unknown>;
  const items = Array.isArray(c?.items) ? c.items as Array<Record<string, unknown>> : null;
  const seen = new Set<string>();
  let total = 0;
  const ok = !!items && typeof c.truncated === "boolean" && (c.base === null || sha40.test(String(c.base)))
    && items.length <= 200 && items.every((item) => {
      if (!item || !sha40.test(String(item.sha)) || seen.has(String(item.sha)) || typeof item.merge !== "boolean"
        || !Array.isArray(item.paths) || item.paths.length > 500 || (item.merge && item.paths.length > 0)) return false;
      seen.add(String(item.sha)); total += item.paths.length;
      return item.paths.every((path) => typeof path === "string" && path.length > 0 && path.length <= 1024 && !/[\u0000-\u001f]/.test(path));
    }) && total <= 100_000;
  if (!ok) fail("commits không hợp lệ");
}
```

Kiểu `DocsSnapshot` thêm ba trường tùy chọn đúng I1.

`receiveDocsSnapshot` chỉ còn: xác thực → `validateDocsSnapshot` → kiểm project thuộc company → `storeDocsSnapshot`.
Hàm `storeDocsSnapshot` (export, dùng ở test cỡ dữ liệu) làm theo thứ tự sau. Mỗi bước một câu SQL. Mảng truyền bằng
tham số `$n::text[]`/`$n::int[]` và `unnest`, chia lô 200 phần tử:

```ts
export async function storeDocsSnapshot(ctx: PluginContext, body: DocsSnapshot): Promise<{ snapshotId: string; deduplicated: boolean }> {
  const ns = pluginNamespace(ctx);
  const { companyId, projectId } = body;
  // 1. Parse manifest (server-side), compute content key.
  const manifest = body.manifest;
  const parsed = manifest?.status === "present" ? parseFlowsManifest(manifest.text) : null;
  const manifestState = !manifest ? "not_sent" : manifest.status === "absent" ? "absent"
    : manifest.status === "dropped" ? "dropped" : parsed!.state;
  const manifestSha = manifest?.status === "present" ? manifest.sha256 : null;
  const contentKey = computeContentKey({ format: body.format ?? 1, commit: body.commit, auditState: body.auditState,
    manifestSha256: manifestSha, pages: body.pages, dropped: body.dropped });
  // 2. Drop broken staging rows of this project (never completed snapshots: history is kept).
  await ctx.db.execute(`DELETE FROM ${ns}.docs_snapshots WHERE company_id = $1 AND project_id = $2
    AND completed_at IS NULL AND received_at < now() - interval '10 minutes'`, [companyId, projectId]);
  // 3. Resend of an already completed snapshot: keep its commits complete and point at it.
  const existing = await findCompleted(ctx, companyId, projectId, body.commit, contentKey);
  if (existing) {
    await storeCommits(ctx, body, existing);
    await pointCurrent(ctx, companyId, projectId, existing);
    return { snapshotId: existing, deduplicated: true };
  }
  // 4. Blobs: verify every existing blob byte-for-byte before writing anything that references it.
  const blobs = new Map(body.pages.map((page) => [page.sha256, page.text]));
  if (manifest?.status === "present") blobs.set(manifest.sha256, manifest.text);
  await putBlobs(ctx, blobs);            // INSERT … SELECT FROM unnest ON CONFLICT DO NOTHING, then re-read and compare
  // 5. Staging row, pages, links.
  const id = randomUUID();
  await ctx.db.execute(`INSERT INTO ${ns}.docs_snapshots (id, company_id, project_id, machine_id, repo, commit, audit_state,
      check_exit, dropped, content_key, format, manifest_state, manifest_sha256, manifest_errors, commits_truncated)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15)`,
    [id, companyId, projectId, body.machineId, body.repo, body.commit, body.auditState, body.checkExit,
      JSON.stringify(body.dropped), contentKey, body.format ?? 1, manifestState, manifestSha,
      JSON.stringify(parsed?.state === "invalid" ? parsed.errors : []), body.commits?.truncated ?? false]);
  await insertPages(ctx, id, body.pages);  // INSERT INTO docs_snapshot_pages SELECT $1, * FROM unnest($2::text[],$3::text[],$4::text[],$5::text[])
  await insertLinks(ctx, id, body.links);  // INSERT INTO docs_links … FROM unnest(...)
  // 6. Complete. A concurrent identical snapshot may have completed first: then this one is discarded.
  try {
    await ctx.db.execute(`UPDATE ${ns}.docs_snapshots SET completed_at = now() WHERE id = $1`, [id]);
  } catch (error) {
    if (!/duplicate key|docs_snapshots_done_key|23505/i.test(String((error as Error).message ?? error))) throw error;
    await ctx.db.execute(`DELETE FROM ${ns}.docs_snapshots WHERE id = $1 AND completed_at IS NULL`, [id]);
    const winner = await findCompleted(ctx, companyId, projectId, body.commit, contentKey);
    if (!winner) throw error;
    await storeCommits(ctx, body, winner);
    await pointCurrent(ctx, companyId, projectId, winner);
    return { snapshotId: winner, deduplicated: true };
  }
  await storeCommits(ctx, body, id);
  await pointCurrent(ctx, companyId, projectId, id);
  return { snapshotId: id, deduplicated: false };
}
```

Hàm phụ trong cùng file (cài đầy đủ, mỗi hàm ≤ 25 dòng):
- `findCompleted(ctx, companyId, projectId, commit, contentKey)`: `SELECT id FROM ns.docs_snapshots WHERE company_id=$1
  AND project_id=$2 AND commit=$3 AND content_key=$4 AND completed_at IS NOT NULL LIMIT 1`.
- `putBlobs(ctx, blobs: Map<sha, text>)`:
  - chia lô 200 sha. Mỗi lô `INSERT INTO ns.docs_blobs (sha256, byte_size, text) SELECT * FROM unnest($1::text[],
    $2::int[], $3::text[]) ON CONFLICT (sha256) DO NOTHING`, với `byte_size = Buffer.byteLength(text, "utf8")`;
  - sau đó `SELECT sha256, byte_size, text FROM ns.docs_blobs WHERE sha256 = ANY($1::text[])`. Dòng nào có
    `byte_size !==` cỡ mới hoặc `text !==` text mới thì `fail("trùng mã băm nhưng khác nội dung")`. Log
    `ctx.logger.warn` chỉ với `sha.slice(0, 12)`.
- `insertPages`, `insertLinks`: chia lô 200 với `unnest`. Mảng `null` dùng `$n::text[]` có phần tử `null`.
- `storeCommits(ctx, body, snapshotId)`: không có `body.commits` thì return. Ngược lại:
  - `INSERT INTO ns.docs_commits (company_id, project_id, sha, is_merge, first_snapshot_id) SELECT $1, $2, s, m, $3 FROM
    unnest($4::text[], $5::bool[]) AS t(s, m) ON CONFLICT DO NOTHING`;
  - `docs_commit_files` theo lô 1000 cặp `(sha, path)` cũng `ON CONFLICT DO NOTHING`.
- `pointCurrent(ctx, companyId, projectId, id)`: câu `INSERT … ON CONFLICT (company_id, project_id) DO UPDATE` như cũ.

Bỏ hẳn hai câu `DELETE` cũ (xóa snapshot trước và xóa snapshot không hiện hành cũ hơn 10 phút).

- [ ] **Bước 6: Sửa `data.ts`.**
  - Thêm `resolveSnapshot(ctx, companyId, projectId, snapshotId?)`:
    - có `snapshotId` (phải là UUID, sai thì `throw new Error("ID không hợp lệ")`) thì `SELECT s.* FROM ns.docs_snapshots s
      WHERE s.id = $1 AND s.completed_at IS NOT NULL`, rồi so `company_id`/`project_id`; khác thì
      `throw new Error("Snapshot không thuộc dự án")`;
    - không có thì đi qua `docs_current`.
  - `loadDocsTree`/`loadDocsPage` nhận `snapshotId?` cuối, đọc trang bằng
    `JOIN ns.docs_snapshot_pages sp … JOIN ns.docs_blobs b ON b.sha256 = sp.sha256`.
  - `searchDocs` tìm `b.text ILIKE` trên snapshot hiện hành.
  - `loadDocsProjects` không đổi.
  - `loadDocsTree` trả thêm `snapshotId`, `manifestState`.
  - Thêm `loadManifestForSnapshot(ctx, snapshot)`: `manifest_state = 'ok'` thì đọc `docs_blobs.text` theo
    `manifest_sha256` rồi `parseFlowsManifest`. Kết quả không `ok` (không thể xảy ra, vì đã parse lúc nhận) thì trả
    `null`.
  - `registerDocsData` truyền `params.snapshotId` khi là chuỗi khác rỗng.

- [ ] **Bước 7: `history.ts`.**

```ts
export async function loadDocsHistory(ctx: PluginContext, projectId: string, companyId: string, limit = 20) {
  await projectScope(ctx, projectId, companyId);   // export projectScope từ data.ts
  const size = Number.isInteger(limit) && limit >= 1 && limit <= 50 ? limit : 20;
  const ns = pluginNamespace(ctx);
  const rows = await ctx.db.query<{ id: string; commit: string; received_at: string; completed_at: string; audit_state: string;
    format: number; manifest_state: string; page_count: number; current: boolean }>(`
    SELECT s.id, s.commit, s.received_at, s.completed_at, s.audit_state, s.format, s.manifest_state,
      (SELECT count(*)::int FROM ${ns}.docs_snapshot_pages p WHERE p.snapshot_id = s.id) AS page_count,
      EXISTS (SELECT 1 FROM ${ns}.docs_current c WHERE c.snapshot_id = s.id) AS current
    FROM ${ns}.docs_snapshots s
    WHERE s.company_id = $1 AND s.project_id = $2 AND s.completed_at IS NOT NULL
    ORDER BY s.completed_at DESC, s.id DESC LIMIT $3`, [companyId, projectId, size + 1]);
  const pagesOf = async (id: string) => new Map((await ctx.db.query<{ path: string; sha256: string }>(
    `SELECT path, sha256 FROM ${ns}.docs_snapshot_pages WHERE snapshot_id = $1`, [id])).map((r) => [r.path, r.sha256]));
  const items = [];
  for (let i = 0; i < Math.min(rows.length, size); i++) {
    const row = rows[i]!; const older = rows[i + 1];
    let changed = null;
    if (older) {
      const [now, before] = [await pagesOf(row.id), await pagesOf(older.id)];
      let added = 0, modified = 0, removed = 0;
      for (const [path, sha] of now) { const prev = before.get(path); if (prev === undefined) added++; else if (prev !== sha) modified++; }
      for (const path of before.keys()) if (!now.has(path)) removed++;
      changed = { added, modified, removed };
    }
    items.push({ snapshotId: row.id, commit: row.commit, receivedAt: new Date(row.received_at).toISOString(),
      completedAt: new Date(row.completed_at).toISOString(), auditState: row.audit_state, format: row.format,
      manifestState: row.manifest_state, pageCount: row.page_count, current: row.current, changed });
  }
  return items;
}
export function registerDocsHistory(ctx: PluginContext): void {
  ctx.data.register("crew.docs.history", (params) => loadDocsHistory(ctx, String(params.projectId ?? ""),
    String(params.companyId ?? ""), Number(params.limit ?? 20)));
}
```

`features.ts` thêm `registerDocsHistory(ctx);`.

- [ ] **Bước 8: Sửa `docs.db.test.ts` theo hành vi mới.**
  - `page()` dùng sha thật như helper ở Bước 3.
  - Chạy thêm migration `0008` (sau `0001`, cùng vòng lặp với danh sách file).
  - Khẳng định cũ `expect(await count()).toBe(1)` sau snapshot thứ hai đổi thành `toBe(2)`.
  - `loadDocsPage(…,"docs/index.md")` trên snapshot hiện hành vẫn `null`. Đọc với `snapshotId` của bản đầu thì ra trang.
  - Ca "trang 5 MB" giữ nguyên (vẫn bị chặn ở xác thực 5 MB).

- [ ] **Bước 9: Chạy.**
  `pnpm vitest run --config vitest.config.ts src/__tests__/docs-content-key.test.ts src/__tests__/docs-manifest.test.ts`,
  rồi từng file DB: `docs-dedup.db.test.ts`, `docs.db.test.ts`, `docs-check-evidence.test.ts`. Kỳ vọng: PASS. Ghi số in
  ra của ca 12 vào báo cáo ticket.
  Sau đó `pnpm typecheck`, `node build.mjs`, `pnpm exec biome check packages/crew-plugin/src/docs
  packages/crew-plugin/src/__tests__` (ở gốc fork).

- [ ] **Bước 10: Commit.**

```bash
git add packages/crew-plugin/migrations/0008_docs_storage.sql packages/crew-plugin/src/docs packages/crew-plugin/src/features.ts \
  packages/crew-plugin/src/__tests__/docs*.ts packages/crew-plugin/package.json pnpm-lock.yaml
git commit -m "feat(crew-plugin): lưu docs theo mã băm, giữ lịch sử ảnh chụp và nhận manifest, commit"
```

---

## GR-1: graph, trạng thái docs, route agent (sonnet)

**Files:**
- Create: `src/docs/graph.ts` (thuần), `src/docs/status.ts` (thuần + loader), `src/docs/graph-data.ts` (loader +
  register), `src/docs/api.ts` (route), `src/__tests__/docs-graph.test.ts`, `src/__tests__/docs-status.test.ts`,
  `src/__tests__/docs-graph.db.test.ts`
- Modify: `src/manifest.ts` (`apiRoutes` thêm I4), `src/worker.ts`, `src/features.ts` (1 dòng)

**Interfaces:**
- Consumes: `resolveSnapshot`, `loadManifestForSnapshot`, `projectScope` (DB-1); `parseCrewCommit` (`shared/markers.ts`).
- Produces:
  - `buildDocsGraph(input: GraphInput): Omit<DocsGraph, "snapshot"> & { nodes; edges }`;
  - `loadDocsGraph(ctx, companyId, projectId, opts: { snapshotId?: string; flowId?: string }): Promise<DocsGraph | null>`;
  - `docsState(input: DocsStateInput): { state: DocsState; reason: string }`;
  - `loadDocsStatus(ctx, companyId, projectId): Promise<DocsStatus>`;
  - `handleDocsApi(ctx, input): Promise<PluginApiResponse | null>` (`null` = không phải route của docs).

- [ ] **Bước 1: Test thuần `docs-graph.test.ts` (đỏ).**

```ts
import { describe, expect, it } from "vitest";
import { buildDocsGraph, GRAPH_NOTICE } from "../docs/graph.js";

const manifest = { state: "ok" as const,
  flows: [
    { id: "core", title: "Core", doc: "docs/flows/core.md", entrypoints: ["src/main.ts"], files: ["src/a.ts"], tests: ["test/a.test.ts"] },
    { id: "ui", title: "UI", doc: "docs/flows/ui-missing.md", entrypoints: [], files: ["src/ui.ts"], tests: [] },
  ],
  shared: [{ path: "src/shared.ts", flows: ["core", "ui"] }] };
const input = {
  projectId: "p1", projectName: "Repo A",
  pages: [{ path: "docs/index.md", title: "Mục lục" }, { path: "docs/flows/core.md", title: "Core" }],
  links: [{ fromPath: "docs/index.md", toPath: "docs/flows/core.md", status: "ok" }, { fromPath: "docs/index.md", toPath: "docs/x.md", status: "missing" }],
  manifest,
  tickets: [{ issueId: "i1", identifier: "TPS-1", title: "Sửa core", status: "done", paths: ["src/a.ts", "src/ui.ts", "README.md"] },
            { issueId: "i2", identifier: "TPS-2", title: "Không chạm", status: "done", paths: ["README.md"] }],
  flowId: null, maxNodes: 3000 };

describe("buildDocsGraph", () => {
  it("builds nodes and edges from manifest, links and ticket commits only", () => {
    const g = buildDocsGraph(input);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
    expect(g.nodes.find((n) => n.id === "page:docs/flows/ui-missing.md")).toMatchObject({ kind: "page", missing: true });
    expect(g.edges.map((e) => e.id)).toEqual(expect.arrayContaining([
      "project-flow:project:p1->flow:core", "flow-doc:flow:core->page:docs/flows/core.md",
      "flow-entrypoint:flow:core->file:src/main.ts", "flow-file:flow:core->file:src/a.ts", "flow-test:flow:core->file:test/a.test.ts",
      "shared-file:file:src/shared.ts->flow:ui", "page-link:page:docs/index.md->page:docs/flows/core.md",
    ]));
    expect(g.edges.filter((e) => e.kind === "ticket-flow")).toEqual([
      { id: "ticket-flow:ticket:i1->flow:core", kind: "ticket-flow", from: "ticket:i1", to: "flow:core", files: 1 },
      { id: "ticket-flow:ticket:i1->flow:ui", kind: "ticket-flow", from: "ticket:i1", to: "flow:ui", files: 1 },
    ]);
    expect(g.nodes.some((n) => n.id === "ticket:i2")).toBe(false);
    expect(g.edges.some((e) => e.to === "page:docs/x.md")).toBe(false);
    expect(g.notice).toBe(GRAPH_NOTICE);
  });
  it("without a manifest keeps only project, pages and page links", () => {
    const g = buildDocsGraph({ ...input, manifest: null });
    expect(new Set(g.nodes.map((n) => n.kind))).toEqual(new Set(["project", "page"]));
    expect(g.edges.every((e) => e.kind === "page-link")).toBe(true);
  });
  it("filters to one flow neighbourhood", () => {
    const g = buildDocsGraph({ ...input, flowId: "ui" });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(
      ["file:src/shared.ts", "file:src/ui.ts", "flow:ui", "page:docs/flows/ui-missing.md", "project:p1", "ticket:i1"].sort());
  });
  it("drops file nodes when over the node limit", () => {
    const g = buildDocsGraph({ ...input, maxNodes: 6 });
    expect(g.truncated).toBe("files");
    expect(g.nodes.some((n) => n.kind === "file")).toBe(false);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
  });
  it("unknown flowId yields only the project node", () => {
    expect(buildDocsGraph({ ...input, flowId: "nope" }).nodes.map((n) => n.id)).toEqual(["project:p1"]);
  });
});
```

Chạy: kỳ vọng FAIL.

- [ ] **Bước 2: Cài `graph.ts`.**

```ts
// src/docs/graph.ts
import type { FlowsManifestOk } from "./manifest.js";

export type GraphNodeKind = "project" | "flow" | "page" | "file" | "ticket";
export type GraphEdgeKind = "project-flow" | "flow-doc" | "flow-entrypoint" | "flow-file" | "flow-test" | "shared-file" | "page-link" | "ticket-flow";
export interface GraphNode { id: string; kind: GraphNodeKind; label: string;
  ref: { path?: string; flowId?: string; issueId?: string; identifier?: string; status?: string; projectId?: string }; missing?: true }
export interface GraphEdge { id: string; kind: GraphEdgeKind; from: string; to: string; files?: number }
export const GRAPH_NOTICE = "Đồ thị lấy từ docs/flows.yaml, liên kết Markdown và commit của ticket; không phải call graph hay bằng chứng hành vi khi chạy.";
export interface GraphInput {
  projectId: string; projectName: string;
  pages: Array<{ path: string; title: string }>;
  links: Array<{ fromPath: string; toPath: string | null; status: string }>;
  manifest: FlowsManifestOk | null;
  tickets: Array<{ issueId: string; identifier: string; title: string; status: string; paths: string[] }>;
  flowId: string | null; maxNodes: number;
}

export function buildDocsGraph(input: GraphInput) {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const node = (n: GraphNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id; };
  const edge = (kind: GraphEdgeKind, from: string, to: string, files?: number) => {
    const id = `${kind}:${from}->${to}`;
    edges.set(id, files === undefined ? { id, kind, from, to } : { id, kind, from, to, files });
  };
  const pageTitles = new Map(input.pages.map((p) => [p.path, p.title]));
  const pageNode = (path: string) => node(pageTitles.has(path)
    ? { id: `page:${path}`, kind: "page", label: pageTitles.get(path)!, ref: { path } }
    : { id: `page:${path}`, kind: "page", label: path, ref: { path }, missing: true });
  const fileNode = (path: string) => node({ id: `file:${path}`, kind: "file", label: path, ref: { path } });
  const project = node({ id: `project:${input.projectId}`, kind: "project", label: input.projectName, ref: { projectId: input.projectId } });

  const flows = (input.manifest?.flows ?? []).filter((f) => input.flowId === null || f.id === input.flowId);
  const keepFlow = new Set(flows.map((f) => f.id));
  const fileFlows = new Map<string, Set<string>>();
  const own = (path: string, flowId: string) => { if (!fileFlows.has(path)) fileFlows.set(path, new Set()); fileFlows.get(path)!.add(flowId); };
  for (const flow of flows) {
    const id = node({ id: `flow:${flow.id}`, kind: "flow", label: flow.title, ref: { flowId: flow.id } });
    edge("project-flow", project, id);
    edge("flow-doc", id, pageNode(flow.doc));
    for (const [kind, list] of [["flow-entrypoint", flow.entrypoints], ["flow-file", flow.files], ["flow-test", flow.tests]] as const) {
      for (const path of list) { edge(kind, id, fileNode(path)); own(path, flow.id); }
    }
  }
  for (const item of input.manifest?.shared ?? []) {
    for (const flowId of item.flows) if (keepFlow.has(flowId)) { edge("shared-file", fileNode(item.path), `flow:${flowId}`); own(item.path, flowId); }
  }
  if (input.flowId === null) for (const page of input.pages) pageNode(page.path);
  const docPages = new Set(flows.map((f) => `page:${f.doc}`));
  for (const link of input.links) {
    if (link.status !== "ok" || !link.toPath) continue;
    const from = `page:${link.fromPath}`;
    if (input.flowId !== null && !docPages.has(from)) continue;
    edge("page-link", pageNode(link.fromPath), pageNode(link.toPath));
  }
  if (input.manifest) for (const t of input.tickets) {
    const counts = new Map<string, number>();
    for (const path of new Set(t.paths)) for (const flowId of fileFlows.get(path) ?? []) counts.set(flowId, (counts.get(flowId) ?? 0) + 1);
    if (counts.size === 0) continue;
    const id = node({ id: `ticket:${t.issueId}`, kind: "ticket", label: `${t.identifier} · ${t.title}`,
      ref: { issueId: t.issueId, identifier: t.identifier, status: t.status } });
    for (const [flowId, files] of [...counts].sort()) edge("ticket-flow", id, `flow:${flowId}`, files);
  }
  let truncated: null | "files" = null;
  let outNodes = [...nodes.values()];
  let outEdges = [...edges.values()];
  if (input.flowId === null && outNodes.length > input.maxNodes) {
    truncated = "files";
    outNodes = outNodes.filter((n) => n.kind !== "file");
    const ids = new Set(outNodes.map((n) => n.id));
    outEdges = outEdges.filter((e) => ids.has(e.from) && ids.has(e.to));
  }
  return { nodes: outNodes, edges: outEdges, truncated, flowId: input.flowId, notice: GRAPH_NOTICE };
}
```

Chạy lại test. Kỳ vọng: PASS. Ca "filters to one flow": trang link một bước từ trang doc của flow vẫn được thêm qua
`page-link`. Ca `ui` không có link nên không có trang thêm. Nếu ca này đỏ vì thứ tự id thì sửa code, không sửa test.

- [ ] **Bước 3: Test thuần `docs-status.test.ts` (đỏ) rồi cài `docsState`.**

```ts
import { describe, expect, it } from "vitest";
import { docsState } from "../docs/status.js";
const snap = (auditState: string) => ({ commit: "a".repeat(40), auditState });
const pushed = { sha: "b".repeat(40), at: "2026-10-10T01:00:00.000Z" };
describe("docsState", () => {
  it.each([
    [{ snapshot: null, latestPushed: null, pushedKnown: null }, "missing"],
    [{ snapshot: snap("verified"), latestPushed: pushed, pushedKnown: false }, "stale"],
    [{ snapshot: snap("invalid"), latestPushed: pushed, pushedKnown: false }, "stale"],
    [{ snapshot: snap("invalid"), latestPushed: pushed, pushedKnown: true }, "invalid"],
    [{ snapshot: snap("unverified"), latestPushed: null, pushedKnown: null }, "unverified"],
    [{ snapshot: snap("verified"), latestPushed: pushed, pushedKnown: null }, "current"],
    [{ snapshot: snap("verified"), latestPushed: pushed, pushedKnown: true }, "current"],
  ])("%o → %s", (input, state) => expect(docsState(input).state).toBe(state));
  it("stale reason names the pushed commit and Vietnam time", () => {
    expect(docsState({ snapshot: snap("verified"), latestPushed: pushed, pushedKnown: false }).reason)
      .toBe("Commit bbbbbbbbbbbb đã push lúc 08:00 10/10/2026 nhưng ảnh chụp docs chưa có commit này.");
  });
});
```

`pushedKnown`:
- `null`: project chưa có dòng `docs_commits` (Mac cũ), hoặc không có `latestPushed`;
- `true`/`false`: sha có hay không có trong `docs_commits`.

```ts
// src/docs/status.ts (phần thuần)
export type DocsState = "missing" | "unverified" | "invalid" | "stale" | "current";
export interface DocsStateInput { snapshot: { commit: string; auditState: string } | null;
  latestPushed: { sha: string; at: string } | null; pushedKnown: boolean | null }
const vnTime = (iso: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit",
  day: "2-digit", month: "2-digit", year: "numeric", hour12: false }).formatToParts(new Date(iso))
  .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {} as Record<string, string>);
export function docsState(input: DocsStateInput): { state: DocsState; reason: string } {
  if (!input.snapshot) return { state: "missing", reason: "Dự án chưa có ảnh chụp docs nào." };
  const short = input.snapshot.commit.slice(0, 12);
  if (input.latestPushed && input.pushedKnown === false) {
    const t = vnTime(input.latestPushed.at);
    return { state: "stale", reason: `Commit ${input.latestPushed.sha.slice(0, 12)} đã push lúc ${t.hour}:${t.minute} ${t.day}/${t.month}/${t.year} nhưng ảnh chụp docs chưa có commit này.` };
  }
  if (input.snapshot.auditState === "invalid") return { state: "invalid", reason: `crew-docs check báo lỗi ở commit ${short}.` };
  if (input.snapshot.auditState === "unverified") return { state: "unverified", reason: `Chưa chạy được crew-docs check ở commit ${short}.` };
  return { state: "current", reason: `Docs khớp commit ${short}.` };
}
```

Chạy: PASS.

- [ ] **Bước 4: Loader và route.** `graph-data.ts`:

```ts
export async function loadDocsGraph(ctx: PluginContext, companyId: string, projectId: string,
  opts: { snapshotId?: string; flowId?: string } = {}): Promise<DocsGraph | null> {
  await projectScope(ctx, projectId, companyId);
  if (opts.flowId !== undefined && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(opts.flowId)) throw new Error("flowId không hợp lệ");
  const snapshot = await resolveSnapshot(ctx, companyId, projectId, opts.snapshotId);
  if (!snapshot) return null;
  const ns = pluginNamespace(ctx);
  const [project] = await ctx.db.query<{ name: string }>("SELECT name FROM public.projects WHERE id = $1 AND company_id = $2", [projectId, companyId]);
  const pages = await ctx.db.query<{ path: string; title: string }>(`SELECT path, title FROM ${ns}.docs_snapshot_pages WHERE snapshot_id = $1 ORDER BY path`, [snapshot.id]);
  const links = await ctx.db.query<{ fromPath: string; toPath: string | null; status: string }>(`SELECT from_path AS "fromPath", to_path AS "toPath", status FROM ${ns}.docs_links WHERE snapshot_id = $1 ORDER BY from_path, occurrence`, [snapshot.id]);
  const manifest = await loadManifestForSnapshot(ctx, snapshot);
  const tickets = manifest ? await loadTicketCommits(ctx, companyId, projectId) : [];
  const graph = buildDocsGraph({ projectId, projectName: project?.name ?? projectId, pages, links, manifest, tickets,
    flowId: opts.flowId ?? null, maxNodes: 3000 });
  return { snapshot: { snapshotId: snapshot.id, commit: snapshot.commit, receivedAt: new Date(snapshot.received_at).toISOString(),
    auditState: snapshot.audit_state, manifestState: snapshot.manifest_state }, ...graph };
}
```

`loadTicketCommits(ctx, companyId, projectId)`:
- Câu 1:

```sql
SELECT i.id AS "issueId", i.identifier, i.title, i.status, c.body
FROM public.issue_comments c JOIN public.issues i ON i.id = c.issue_id
WHERE i.company_id = $1 AND i.project_id = $2 AND i.hidden_at IS NULL AND c.deleted_at IS NULL
  AND c.author_agent_id IS NOT NULL AND c.body ~ '^crew-commit sha=[0-9a-f]{40}'
ORDER BY c.created_at DESC LIMIT 5000
```

- Lấy sha bằng `parseCrewCommit(body)`. Gom theo issue, giữ tối đa 500 issue đầu tiên gặp.
- Câu 2: `SELECT sha, path FROM ns.docs_commit_files WHERE company_id = $1 AND project_id = $2 AND sha = ANY($3::text[])`.
- Trả `{issueId, identifier, title, status, paths}`.

Cột `identifier` có thể null trên stock: dùng `coalesce(i.identifier, '')`, nhãn dùng `title` khi rỗng.

`status.ts` thêm `loadDocsStatus(ctx, companyId, projectId)`:
- `projectScope`;
- `resolveSnapshot`;
- comment `crew-merge` mới nhất bằng câu SQL như trên, regex `'^crew-merge sha=[0-9a-f]{40} branch=\S+ pushed=yes'`,
  `ORDER BY c.created_at DESC, c.id DESC LIMIT 1`, tách sha bằng
  `/^crew-merge sha=([0-9a-f]{40})/.exec(body.split("\n",1)[0])`;
- `SELECT EXISTS(SELECT 1 FROM ns.docs_commits WHERE company_id=$1 AND project_id=$2) AS any,
  EXISTS(SELECT 1 FROM ns.docs_commits WHERE company_id=$1 AND project_id=$2 AND sha=$3) AS hit`;
- `pushedKnown = latest && any ? hit : null`;
- trả `DocsStatus` (I3).

`register…` trong `graph-data.ts`: `crew.docs.graph`, `crew.docs.status`.

`api.ts`:

```ts
export async function handleDocsApi(ctx: PluginContext, input: PluginApiRequestInput): Promise<PluginApiResponse | null> {
  if (input.routeKey !== "docs.graph") return null;
  const q = input.query ?? {};
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const companyId = String(one(q.companyId) ?? input.companyId ?? "");
  const projectId = String(one(q.projectId) ?? "");
  const snapshotId = one(q.snapshotId); const flowId = one(q.flowId);
  if (!UUID.test(companyId) || !UUID.test(projectId)) return { status: 400, body: { error: "companyId/projectId không hợp lệ" } };
  try {
    const graph = await loadDocsGraph(ctx, companyId, projectId, {
      snapshotId: typeof snapshotId === "string" && snapshotId ? snapshotId : undefined,
      flowId: typeof flowId === "string" && flowId ? flowId : undefined });
    return graph ? { status: 200, body: graph } : { status: 404, body: { error: "Dự án chưa có tài liệu" } };
  } catch (error) {
    return { status: 400, body: { error: String((error as Error).message ?? error).slice(0, 200) } };
  }
}
```

Trước khi viết, đọc `PluginApiRequestInput` trong `packages/plugins/sdk/src/types.ts` để dùng đúng tên trường
(`routeKey`, `query`, `companyId` do host đã giải). Tên khác thì dùng tên thật và ghi vào báo cáo ticket.

`worker.ts`, `onApiRequest`:

```ts
onApiRequest: async (input) => {
  if (!pluginCtx) throw new Error("Plugin chưa sẵn sàng");
  return (await handleDocsApi(pluginCtx, input)) ?? handleRolesApi(pluginCtx, input);
},
```

`manifest.ts` thêm I4 vào `apiRoutes`.

- [ ] **Bước 5: Test DB `docs-graph.db.test.ts`.** Dựng như DB-1 (migration `0001`–`0005`, `0008`). Gửi snapshot định
  dạng 2 có manifest + commit `X` đổi `src/a.ts`. Thêm issue `TPS-1` của project, comment
  `crew-commit sha=X` do agent viết. Thêm issue project khác có comment `crew-commit sha=X`. Khẳng định:
  1. `loadDocsGraph` có cạnh `ticket-flow:ticket:<TPS-1>->flow:core`, không có node của issue project khác.
  2. `handleDocsApi(ctx, {routeKey:"docs.graph", query:{companyId, projectId}})` trả `200` với `body` deep-equal
     `loadDocsGraph(...)`.
  3. Company khác: `handleDocsApi` với `companyId` khác trả `400` (lỗi `Dự án không thuộc company hiện tại`), không có
     `nodes`.
  4. `loadDocsStatus`:
     - chưa có `crew-merge` → `current`;
     - thêm comment agent `crew-merge sha=<Y> branch=main pushed=yes` với Y chưa gửi → `stale`;
     - comment cùng nội dung do user (không agent) không làm đổi trạng thái;
     - gửi snapshot mới có commit Y trong `commits` → `current`.
  5. Project không có snapshot → `loadDocsGraph` `null`, route `404`.

Chạy từng file test của GR-1. Kỳ vọng: PASS. Sau đó `pnpm typecheck`, build, biome.

- [ ] **Bước 6: Commit.** `feat(crew-plugin): đồ thị docs cho người và agent, trạng thái docs theo dự án`.

---

## ST-1: thống kê dung lượng, cỡ file đính kèm, cache Mac (sonnet)

**Files:**
- Create: `src/storage/data.ts`, `src/__tests__/storage.db.test.ts`
- Modify: `src/attachments/audit.ts`, `src/machines/webhook.ts`, `src/manifest.ts` (`coreReadTables`),
  `src/__tests__/attachments-audit.db.test.ts`, `src/__tests__/machines.test.ts`, `src/features.ts` (1 dòng)

**Interfaces:**
- Consumes: bảng I2; `machine_latest.report` (jsonb); `crew_attachment_audit.byte_size`.
- Produces: `loadStorageReport(ctx, companyId): Promise<StorageReport>` (I5); `MachineReport.attachmentCache?` (I7).

- [ ] **Bước 1: Webhook máy nhận `attachmentCache` (test trước).** Trong `machines.test.ts` thêm:

```ts
it("keeps a valid attachmentCache and drops a malformed one", () => {
  const cache = { bytes: 1234, blobBytes: 1000, blobs: 3, runs: 2, limitBytes: 2147483648, measuredAt: "2026-10-10T01:00:00.000Z" };
  expect(parseMachineReport({ ...validReport, attachmentCache: cache }).attachmentCache).toEqual(cache);
  for (const bad of [{ ...cache, bytes: -1 }, { ...cache, extra: 1 }, { ...cache, measuredAt: "hôm qua" }, "x"]) {
    const parsed = parseMachineReport({ ...validReport, attachmentCache: bad });
    expect(parsed).not.toHaveProperty("attachmentCache");
    expect(parsed.machineId).toBe(validReport.machineId);
  }
});
```

`validReport` là bản tin hợp lệ có sẵn trong file test. Không có thì dựng theo `MachineReport`.

Cài trong `parseMachineReport`: tách `attachmentCache` ra trước khi kiểm phần còn lại, giống hệt cách đang làm với
`app`.

```ts
const count = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
function attachmentCache(value: unknown): value is AttachmentCache {
  return fields(value, ["bytes", "blobBytes", "blobs", "runs", "limitBytes", "measuredAt"])
    && count(value.bytes) && count(value.blobBytes) && value.blobBytes <= value.bytes && count(value.blobs) && count(value.runs) && count(value.limitBytes) && iso(value.measuredAt);
}
```

Kiểu `MachineReport` thêm `attachmentCache?: AttachmentCache`.

- [ ] **Bước 2: Job kiểm file ghi `byte_size` (test trước).** Trong `attachments-audit.db.test.ts`:
  - chạy thêm migration `0008`;
  - ca 1: entry audit giả có `details.byteSize = 4096` → dòng có `byte_size = 4096`;
  - ca 2: dòng có sẵn `byte_size NULL` + `listAttachments` giả trả `byteSize: 777` → sau một lượt job, `byte_size = 777`;
  - ca 3: issue mà `listAttachments` không còn file đó → dòng vẫn `NULL`, và lượt sau trong cùng process không gọi
    `listAttachments` lại cho issue đó.

Cài trong `audit.ts`:
- `toUpload` đọc `details.byteSize` (số nguyên ≥ 0, ngược lại `null`) vào `Upload.byteSize`.
- Câu `INSERT` thêm cột `byte_size` (`$6`).
- Cuối `auditCompany` gọi `fillSizes(ctx, companyId)`:
  - `SELECT attachment_id::text, issue_id::text FROM <table> WHERE company_id = $1 AND byte_size IS NULL
    ORDER BY checked_at DESC LIMIT 200`;
  - gom theo issue, bỏ issue đã có trong `Set` cấp module `sizeLookedUp`, lấy tối đa 20 issue;
  - với mỗi issue gọi `listAttachments` (lỗi thì bỏ qua issue đó), thêm issue vào `sizeLookedUp`, rồi
    `UPDATE <table> SET byte_size = $1 WHERE attachment_id = $2 AND byte_size IS NULL` cho từng file tìm thấy.

- [ ] **Bước 3: `storage.db.test.ts` (đỏ).** Dựng DB như DB-1 (thêm `issue_comments`, `heartbeat_runs`, `cost_events`
  vào danh sách `coreReadTables` khi validate). Dữ liệu:
  - project P1, P2 cùng company C; project P3 của company khác;
  - P1: snapshot A, B (B đổi 1 trang); P2: snapshot giống A; P3: một snapshot có trang riêng;
  - 1 dòng `docs_pages` cũ cho P1;
  - 3 issue P1 với 2 comment; 2 dòng `heartbeat_runs`, 1 `cost_events`;
  - 2 dòng `crew_attachment_audit` (một có `byte_size = 100`, một `NULL`);
  - `machine_latest` với `report` có `attachmentCache` và một máy không có.

Khẳng định (tính tay trong test từ chính dữ liệu đã chèn, không hằng số chép từ output):
- `docs.logical(P1)` = Σ byte trang A + Σ byte trang B;
- `docs.physical(P1)` = Σ blob khác nhau của A ∪ B;
- `company.docsPhysical` = Σ blob khác nhau của P1 ∪ P2, không tính P3;
- `company.docsShared` = Σ byte trang của A (blob dùng ở cả P1 và P2);
- `docs.legacy(P1)` = `octet_length` dòng cũ;
- `tickets.commentBytes(P1)` = Σ `octet_length(body)`; `tickets.physical.kind === "chua_do"`;
- `attachments(P1)` = `{count: 2, unsized: 1, logical: {kind:"logic", bytes:100}}`;
- `machines` có `attachmentCache` của máy 1 và `null` của máy 2;
- `pluginTables` có `docs_blobs` với `total.kind === "vat_ly"` và `bytes > 0`. Nếu test này đỏ vì validator chặn
  `pg_total_relation_size` thì đổi khẳng định sang `kind === "chua_do"` và ghi vào báo cáo ticket (Lệch 4 của plan);
- P3 không xuất hiện; `loadStorageReport(ctx, companyKhac)` không chứa P1/P2.

- [ ] **Bước 4: Cài `storage/data.ts`.** Một hàm `loadStorageReport` gọi các câu dưới (đều `WHERE company_id = $1`),
  rồi ghép theo `projectId`. Project không có dữ liệu nhóm nào vẫn có dòng (lấy danh sách từ `public.projects` của
  company, bỏ project đã archive: `archived_at IS NULL`).

```sql
-- docs: tham chiếu blob của snapshot hoàn tất (trang + manifest)
WITH refs AS (
  SELECT s.project_id, s.id AS snapshot_id, sp.sha256 FROM ns.docs_snapshots s JOIN ns.docs_snapshot_pages sp ON sp.snapshot_id = s.id
  WHERE s.company_id = $1 AND s.completed_at IS NOT NULL
  UNION ALL
  SELECT s.project_id, s.id, s.manifest_sha256 FROM ns.docs_snapshots s
  WHERE s.company_id = $1 AND s.completed_at IS NOT NULL AND s.manifest_sha256 IS NOT NULL)
SELECT r.project_id::text AS "projectId", count(DISTINCT r.snapshot_id)::int AS snapshots, count(*)::int AS refs,
  coalesce(sum(b.byte_size), 0)::bigint AS logical,
  (SELECT coalesce(sum(d.byte_size), 0) FROM (SELECT DISTINCT b2.sha256, b2.byte_size FROM refs r2 JOIN ns.docs_blobs b2 ON b2.sha256 = r2.sha256 WHERE r2.project_id = r.project_id) d)::bigint AS physical
FROM refs r JOIN ns.docs_blobs b ON b.sha256 = r.sha256 GROUP BY r.project_id
```

```sql
-- company: blob khác nhau và blob dùng chung ≥ 2 project (CTE refs như trên)
SELECT coalesce(sum(byte_size), 0)::bigint AS physical,
  coalesce(sum(byte_size) FILTER (WHERE projects >= 2), 0)::bigint AS shared
FROM (SELECT b.sha256, b.byte_size, count(DISTINCT r.project_id) AS projects FROM refs r JOIN ns.docs_blobs b ON b.sha256 = r.sha256 GROUP BY b.sha256, b.byte_size) x
```

- `pages` của project = số dòng `docs_snapshot_pages` (không tính manifest).
- Legacy: `SELECT s.project_id::text, coalesce(sum(octet_length(p.text)),0)::bigint FROM ns.docs_pages p JOIN
  ns.docs_snapshots s ON s.id = p.snapshot_id WHERE s.company_id = $1 GROUP BY 1`.
- Index:
  - đếm `docs_links` qua snapshot của company;
  - `docs_commits`, `docs_commit_files` theo project;
  - `logical` = Σ (`octet_length(from_path) + coalesce(octet_length(to_path),0) + octet_length(original_href)`) +
    Σ (40 + `octet_length(path)`) của file commit.
- Ticket/event:
  - `issues` theo `project_id`;
  - comment: `JOIN issues` `sum(octet_length(c.body))` theo `i.project_id`;
  - run: `coalesce(i.project_id::text, r.context_snapshot->>'projectId')` với `LEFT JOIN public.issues i ON
    i.id::text = r.context_snapshot->>'issueId'`;
  - `cost_events` theo `project_id`.
- File đính kèm: `crew_attachment_audit a JOIN public.issues i ON i.id = a.issue_id` theo `i.project_id`: `count(*)`,
  `count(*) FILTER (WHERE a.byte_size IS NULL)`, `sum(a.byte_size)`, `min(a.checked_at)`.
- Bảng plugin: `SELECT t AS table, pg_total_relation_size(t::regclass)::bigint AS bytes FROM unnest($1::text[]) AS t`
  với `$1` = danh sách `${ns}.<tên>` của: `docs_snapshots`, `docs_current`, `docs_pages`, `docs_links`, `docs_blobs`,
  `docs_snapshot_pages`, `docs_commits`, `docs_commit_files`, `machine_reports`, `machine_latest`,
  `crew_project_roles`, `crew_attachment_audit`. Bọc `try/catch`: lỗi thì mọi dòng
  `{kind:"chua_do", reason:"không gọi được hàm đo kích thước bảng"}`.
- Máy: `SELECT machine_id::text, hostname, received_at, report->'attachmentCache' AS cache FROM ns.machine_latest WHERE
  company_id = $1 ORDER BY hostname`.

Số `bigint` từ driver là chuỗi: đổi bằng `Number(...)`. Mọi nhóm vật lý không đo được dùng đúng lý do cố định ở I5.

`register`: `ctx.data.register("crew.storage", (p) => loadStorageReport(ctx, String(p.companyId ?? "")))`, và
`checkedId(companyId)` ở đầu hàm. `features.ts` thêm một dòng.

`manifest.ts`: ST-1 đọc `public.cost_events`, nên ST-1 thêm `"cost_events"` vào `coreReadTables` (US-1 dùng lại, không
sửa `manifest.ts`). Không thêm capability.

- [ ] **Bước 5: Chạy** `machines.test.ts`, `attachments-audit.db.test.ts`, `storage.db.test.ts` (từng file), typecheck,
  build, biome. Kỳ vọng: PASS.

- [ ] **Bước 6: Commit.** `feat(crew-plugin): thống kê dung lượng docs, ticket, file đính kèm và cache trên Mac`.

---

## US-1: usage rollup (opus)

**Files:**
- Create: `src/usage/rollup.ts` (thuần), `src/usage/data.ts`, `src/__tests__/usage-rollup.test.ts`,
  `src/__tests__/usage.db.test.ts`
- Modify: `src/features.ts` (1 dòng). `manifest.ts` đã có `cost_events` từ ST-1.

**Interfaces:**
- Consumes: `crew_project_roles` (`src/roles/data.ts` `readProjectRoles` nếu chữ ký hợp; không thì SQL trực tiếp).
- Produces:
  - `toUsageRun(raw: RawRun): UsageRun & { models: ModelUsage[] }`;
  - `sumRuns(runs: ReadonlyArray<UsageRun>): UsageTotals`;
  - `USAGE_NOTES: readonly string[]`;
  - `loadIssueUsage(ctx, companyId, issueId): Promise<IssueUsage | null>`;
  - `loadUsageSummary(ctx, companyId, opts: { projectId?: string; days: 7 | 30 | 90; now?: Date }): Promise<UsageSummary>`.

- [ ] **Bước 1: Test thuần `usage-rollup.test.ts` (đỏ).**

```ts
import { describe, expect, it } from "vitest";
import { sumRuns, toUsageRun, USAGE_NOTES, vnWindowStart } from "../usage/rollup.js";

const raw = (over: Partial<Parameters<typeof toUsageRun>[0]> = {}) => ({
  runId: "r1", ownerIssueId: "i1", identifier: "TPS-1", agentId: "a1", agentName: "Exec", role: "executor" as const,
  status: "succeeded", startedAt: "2026-10-09T01:00:00Z", finishedAt: "2026-10-09T01:10:00Z",
  costEventCount: 1, ce: { input: 100, cached: 1000, output: 50, cents: 0, model: "claude-sonnet-5", billingType: "subscription_included" },
  usageJson: { costUsd: 0.5, cacheAdjustedCostUsd: 0.42, usageSource: "per_run", sessionReused: false, freshSession: true },
  modelUsage: { "claude-sonnet-5": { inputTokens: 60, cacheCreationInputTokens: 30, cacheReadInputTokens: 1000, outputTokens: 40, costUSD: 0.4 },
                "claude-haiku-5": { inputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 10, costUSD: 0.02 } },
  ...over });

describe("toUsageRun", () => {
  it("uses cost_events tokens and the cache-adjusted SDK estimate", () => {
    const run = toUsageRun(raw());
    expect(run).toMatchObject({ inputTokens: 100, cachedInputTokens: 1000, outputTokens: 50, estimatedUsd: 0.42,
      completeness: "day_du", usageSource: "per_run", sessionReused: false, model: "claude-sonnet-5" });
    expect(run.models).toEqual([
      { model: "claude-haiku-5", source: "model_usage", inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, estimatedUsd: 0.02 },
      { model: "claude-sonnet-5", source: "model_usage", inputTokens: 90, cachedInputTokens: 1000, outputTokens: 40, estimatedUsd: 0.4 },
    ]);
  });
  it("is partial without an estimate, missing without any usage, running when unfinished", () => {
    expect(toUsageRun(raw({ usageJson: { usageSource: "per_run" } })).completeness).toBe("mot_phan");
    expect(toUsageRun(raw({ costEventCount: 0, ce: null, usageJson: { inputTokens: 5, outputTokens: 1, cachedInputTokens: 0 } })))
      .toMatchObject({ completeness: "mot_phan", inputTokens: 5 });
    expect(toUsageRun(raw({ costEventCount: 0, ce: null, usageJson: null, modelUsage: null })))
      .toMatchObject({ completeness: "thieu", inputTokens: null, outputTokens: null, estimatedUsd: null });
    expect(toUsageRun(raw({ status: "running", finishedAt: null })).completeness).toBe("dang_chay");
  });
  it("uses the run model when usage is not per run", () => {
    const run = toUsageRun(raw({ usageJson: { usageSource: "session_delta", costUsd: 1 } }));
    expect(run.models).toEqual([{ model: "claude-sonnet-5", source: "run_model", inputTokens: 100, cachedInputTokens: 1000, outputTokens: 50, estimatedUsd: 1 }]);
  });
  it("ignores negative, NaN and non-number estimates", () => {
    for (const bad of [-1, Number.NaN, "0.5", null]) {
      expect(toUsageRun(raw({ usageJson: { costUsd: bad, usageSource: "per_run" } })).estimatedUsd).toBeNull();
    }
  });
});

describe("sumRuns", () => {
  it("skips running runs, counts missing, never turns null into 0 silently", () => {
    const runs = [toUsageRun(raw()), toUsageRun(raw({ runId: "r2", costEventCount: 0, ce: null, usageJson: null, modelUsage: null })),
      toUsageRun(raw({ runId: "r3", status: "running", finishedAt: null }))];
    expect(sumRuns(runs)).toEqual({ runs: 3, runsWithUsage: 1, runsMissing: 1, runsRunning: 1, inputTokens: 100,
      cachedInputTokens: 1000, outputTokens: 50, estimatedUsd: 0.42, estimatedUsdRuns: 1, billedCents: 0, completeness: "mot_phan" });
    expect(sumRuns([]).completeness).toBe("khong_co");
    expect(sumRuns([toUsageRun(raw({ costEventCount: 0, ce: null, usageJson: null, modelUsage: null }))]).estimatedUsd).toBeNull();
  });
  it("counts a run once even if passed twice", () => {
    const run = toUsageRun(raw());
    expect(sumRuns([run, run]).runs).toBe(1);
  });
});

it("notes are the four fixed sentences", () => {
  expect(USAGE_NOTES).toEqual([
    "USD là ước tính của Claude Code, không phải hóa đơn; gói subscription ghi 0 đồng thực trả.",
    "Token không quy đổi ra phần trăm quota của gói.",
    "Claude Code không báo riêng token suy luận.",
    "Token đầu vào gồm cả token ghi cache; token đọc cache tính riêng.",
  ]);
});

it("window starts at Vietnam midnight", () => {
  expect(vnWindowStart(new Date("2026-10-10T01:30:00Z"), 7).toISOString()).toBe("2026-10-03T17:00:00.000Z");
  expect(vnWindowStart(new Date("2026-10-09T18:30:00Z"), 1).toISOString()).toBe("2026-10-09T17:00:00.000Z");
});
```

Chạy: FAIL.

- [ ] **Bước 2: Cài `rollup.ts`.**

```ts
export type Completeness = "day_du" | "mot_phan" | "thieu" | "dang_chay";
export type CrewRole = "assistant" | "executor" | "reviewer" | "integrator" | "khac";
export interface RawRun { runId: string; ownerIssueId: string | null; identifier: string | null; agentId: string; agentName: string;
  role: CrewRole; status: string; startedAt: string | null; finishedAt: string | null; costEventCount: number;
  ce: { input: number; cached: number; output: number; cents: number; model: string | null; billingType: string | null } | null;
  usageJson: Record<string, unknown> | null; modelUsage: Record<string, unknown> | null }
// UsageRun, UsageTotals, ModelUsage đúng I6.
export const USAGE_NOTES = [
  "USD là ước tính của Claude Code, không phải hóa đơn; gói subscription ghi 0 đồng thực trả.",
  "Token không quy đổi ra phần trăm quota của gói.",
  "Claude Code không báo riêng token suy luận.",
  "Token đầu vào gồm cả token ghi cache; token đọc cache tính riêng.",
] as const;
const FINISHED = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
const usd = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const tok = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

export function toUsageRun(raw: RawRun) {
  const u = raw.usageJson ?? {};
  const running = raw.finishedAt === null && !FINISHED.has(raw.status);
  const estimate = usd(u.cacheAdjustedCostUsd) ?? usd(u.costUsd);
  let input: number | null = null, cached: number | null = null, output: number | null = null;
  let completeness: Completeness;
  if (raw.ce && raw.costEventCount > 0) {
    [input, cached, output] = [raw.ce.input, raw.ce.cached, raw.ce.output];
    completeness = estimate === null ? "mot_phan" : "day_du";
  } else if (tok(u.inputTokens) !== null || tok(u.outputTokens) !== null) {
    [input, cached, output] = [tok(u.inputTokens) ?? 0, tok(u.cachedInputTokens) ?? 0, tok(u.outputTokens) ?? 0];
    completeness = "mot_phan";
  } else completeness = "thieu";
  if (running) completeness = "dang_chay";
  const source = u.usageSource === "per_run" || u.usageSource === "session_delta" ? u.usageSource : null;
  const models = source === "per_run" && raw.modelUsage && Object.keys(raw.modelUsage).length > 0
    ? Object.entries(raw.modelUsage).map(([model, value]) => {
        const e = (value ?? {}) as Record<string, unknown>;
        return { model, source: "model_usage" as const, inputTokens: (tok(e.inputTokens) ?? 0) + (tok(e.cacheCreationInputTokens) ?? 0),
          cachedInputTokens: tok(e.cacheReadInputTokens) ?? 0, outputTokens: tok(e.outputTokens) ?? 0, estimatedUsd: usd(e.costUSD) };
      }).sort((a, b) => a.model.localeCompare(b.model))
    : input !== null && raw.ce?.model
      ? [{ model: raw.ce.model, source: "run_model" as const, inputTokens: input, cachedInputTokens: cached ?? 0, outputTokens: output ?? 0, estimatedUsd: estimate }]
      : [];
  return { runId: raw.runId, issueId: raw.ownerIssueId, identifier: raw.identifier, agentId: raw.agentId, agentName: raw.agentName,
    role: raw.role, status: raw.status, startedAt: raw.startedAt, finishedAt: raw.finishedAt, model: raw.ce?.model ?? (typeof u.model === "string" ? u.model : null),
    inputTokens: input, cachedInputTokens: cached, outputTokens: output, estimatedUsd: estimate,
    billingType: raw.ce?.billingType ?? null, usageSource: source,
    sessionReused: typeof u.sessionReused === "boolean" ? u.sessionReused : null, completeness, models,
    billedCents: raw.ce?.cents ?? 0 };
}

export function sumRuns(runs: ReadonlyArray<ReturnType<typeof toUsageRun>>) {
  const unique = [...new Map(runs.map((r) => [r.runId, r])).values()];
  let input = 0, cached = 0, output = 0, est = 0, estRuns = 0, cents = 0, withUsage = 0, missing = 0, running = 0, full = 0;
  for (const r of unique) {
    if (r.completeness === "dang_chay") { running++; continue; }
    if (r.completeness === "thieu") { missing++; continue; }
    withUsage++; if (r.completeness === "day_du") full++;
    input += r.inputTokens ?? 0; cached += r.cachedInputTokens ?? 0; output += r.outputTokens ?? 0; cents += r.billedCents;
    if (r.estimatedUsd !== null) { est += r.estimatedUsd; estRuns++; }
  }
  const done = unique.length - running;
  return { runs: unique.length, runsWithUsage: withUsage, runsMissing: missing, runsRunning: running,
    inputTokens: input, cachedInputTokens: cached, outputTokens: output,
    estimatedUsd: estRuns > 0 ? Math.round(est * 1e6) / 1e6 : null, estimatedUsdRuns: estRuns, billedCents: cents,
    completeness: withUsage === 0 ? "khong_co" as const : full === done ? "day_du" as const : "mot_phan" as const };
}

/** 00:00 Asia/Ho_Chi_Minh (UTC+7, no DST) of the first day of a `days`-long window ending today. */
export function vnWindowStart(now: Date, days: number): Date {
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() - (days - 1)) - 7 * 3_600_000);
}
```

`UsageRun` công khai (I6) không có `models`, `billedCents`. Loader bỏ hai trường này khỏi `runs[]` trả ra. Chạy test:
PASS.

- [ ] **Bước 3: Test DB `usage.db.test.ts` (đỏ).** Dữ liệu company C, project P có `crew_project_roles` (assistant A0,
  executor A1, reviewer A2, integrator A3):
  - cây: `R` (gốc) → `C1` → `C11`; `R` → `C2`; `R` → `H` (`hidden_at` đặt) → `H1`;
  - run, `context_snapshot.issueId` như ghi:
    - `R`: run A0 `succeeded` có `cost_events`;
    - `C1`: run A1 thất bại có `cost_events` (input 10), run A1 retry có **hai** dòng `cost_events` (input 5 + 7), run A2
      reviewer có `cost_events`;
    - `C11`: run A1 `cancelled` không có `cost_events`, không có `usage_json`;
    - `C2`: run A1 `running`;
    - `H`: một run;
    - run không có issue nhưng `context_snapshot.projectId = P`;
    - run company khác có `issueId` của `R` (giả mạo, phải bị loại vì `company_id`).

Khẳng định:
- `direct(R).runs = 1`.
- `tree(R).runs = 1 + 3 + 1 + 1 = 6`. Không có run của `H`/`H1`, không có run company khác.
- `tree(R).inputTokens` = tổng tính tay. Run có hai dòng `cost_events` được cộng 12, không phải 5 hay 7.
- `tree(R) = direct(R) + Σ children[].tree` theo từng trường số (vòng lặp trên mọi key của `UsageTotals` trừ
  `completeness`).
- `children` gồm `C1`, `C2`, không gồm `H`.
- `byRole` có `executor`, `reviewer`, `assistant`. Run C11 vào `executor` với `runsMissing = 1`.
- Run C2 nằm trong `tree.runsRunning`.
- `loadIssueUsage(ctx, companyKhac, R)` trả `null` (issue không thuộc company).
- `loadUsageSummary(ctx, C, {projectId: P, days: 7, now})`: `unattributed.runs = 1`; `topRoots[0].id = R`.

- [ ] **Bước 4: Cài `data.ts`.**
  - `loadIssueUsage`:
    1. `checkedId` cả hai id.
    2. Lấy cây bằng `WITH RECURSIVE`, giới hạn sâu 20:

```sql
WITH RECURSIVE tree(id, depth) AS (
  SELECT id, 0 FROM public.issues WHERE id = $2 AND company_id = $1 AND hidden_at IS NULL
  UNION ALL
  SELECT i.id, t.depth + 1 FROM public.issues i JOIN tree t ON i.parent_id = t.id
  WHERE i.company_id = $1 AND i.hidden_at IS NULL AND t.depth < 20)
SELECT i.id::text, i.parent_id::text AS "parentId", coalesce(i.identifier, '') AS identifier, i.title, i.status, i.project_id::text AS "projectId"
FROM public.issues i JOIN tree t ON t.id = i.id
```

       Rỗng thì trả `null`.
    3. Lấy run bằng `fetchRuns(ctx, companyId, treeIds)`:

```sql
SELECT r.id::text AS "runId", r.agent_id::text AS "agentId", a.name AS "agentName", r.status, r.started_at AS "startedAt",
  r.finished_at AS "finishedAt", r.usage_json AS "usageJson", r.result_json->'modelUsage' AS "modelUsage",
  r.context_snapshot->>'issueId' AS "ctxIssue", ce.issue_id AS "ceIssue", coalesce(ce.n, 0)::int AS "costEventCount",
  ce.input, ce.cached, ce.output, ce.cents, ce.model, ce.billing_type AS "billingType"
FROM public.heartbeat_runs r
JOIN public.agents a ON a.id = r.agent_id
LEFT JOIN (
  SELECT heartbeat_run_id, min(issue_id::text) AS issue_id, count(*) AS n, sum(input_tokens)::bigint AS input,
    sum(cached_input_tokens)::bigint AS cached, sum(output_tokens)::bigint AS output, sum(cost_cents)::bigint AS cents,
    min(model) AS model, min(billing_type) AS billing_type
  FROM public.cost_events WHERE company_id = $1 AND heartbeat_run_id IS NOT NULL
    AND (issue_id::text = ANY($2::text[]) OR heartbeat_run_id IN (
      SELECT id FROM public.heartbeat_runs WHERE company_id = $1 AND context_snapshot->>'issueId' = ANY($2::text[])))
  GROUP BY heartbeat_run_id) ce ON ce.heartbeat_run_id = r.id
WHERE r.company_id = $1 AND (r.context_snapshot->>'issueId' = ANY($2::text[]) OR ce.issue_id = ANY($2::text[]))
```

    4. Chủ sở hữu = `ceIssue ?? ctxIssue`, chỉ giữ run có chủ thuộc cây. Role tra theo `crew_project_roles` của
       `projectId` của issue chủ (`SELECT … FROM ns.crew_project_roles WHERE company_id = $1 AND project_id =
       ANY($2::uuid[])`).
    5. `direct` = run có chủ = gốc.
    6. `children[i].tree` = run có chủ thuộc cây con của con thứ i (dựng map cha → con trong JS).
    7. `tree` = `null` khi không có con, ngược lại là mọi run.
    8. `byRole` theo `role`. `byModel` gộp `models` theo `(model, source)`, cộng token, `estimatedUsd` cộng khi mọi
       phần đều có số, có một phần `null` thì `null`.
    9. `runs` sắp `startedAt` giảm dần, tối đa 200, kèm `runsTruncated`.
    10. `reuse` đếm `sessionReused === true`/`false`/`null` trên run không `dang_chay`.
    11. `notes = [...USAGE_NOTES]`.
  - `loadUsageSummary`:
    - `from = vnWindowStart(now, days)`, `to = now`. `days` không thuộc `{7, 30, 90}` thì
      `throw new Error("days không hợp lệ")`;
    - run: `WHERE r.company_id = $1 AND coalesce(r.started_at, r.created_at) >= $2`, cùng phần join `cost_events` như
      trên nhưng lọc theo `heartbeat_run_id IN (run trong cửa sổ)`;
    - issue của company: `SELECT id::text, parent_id::text, coalesce(identifier,'') AS identifier, title, project_id::text,
      hidden_at FROM public.issues WHERE company_id = $1 LIMIT 50000`, để tìm gốc (đi lên `parent_id`, tối đa 20 bước)
      và project;
    - lọc theo `projectId` nếu có. Run có chủ là issue ẩn thì bỏ;
    - `unattributed` = run không có chủ, với `context_snapshot->>'projectId' = projectId` (hoặc mọi run như vậy khi không
      truyền `projectId`);
    - `topRoots` = 10 gốc có `outputTokens` của cây lớn nhất trong cửa sổ.
  - `register`: `crew.usage.issue`, `crew.usage.summary` (`days = Number(params.days ?? 7)`). `features.ts` thêm một
    dòng.

- [ ] **Bước 5: Chạy** `usage-rollup.test.ts`, `usage.db.test.ts`, typecheck, build, biome. Kỳ vọng: PASS.

- [ ] **Bước 6: Commit.** `feat(crew-plugin): tổng hợp usage theo issue trực tiếp và gồm issue con, theo vai trò và model`.

---

## UI-1: module thuần và UI tối thiểu (sonnet)

**Files:**
- Create: `src/ui/graph/model.ts`, `src/ui/graph/model.test.ts`, `src/ui/graph/docs-graph.tsx`,
  `src/ui/storage/format.ts`, `src/ui/storage/format.test.ts`, `src/ui/storage/index.ts`, `src/ui/usage/format.ts`,
  `src/ui/usage/format.test.ts`, `src/ui/usage/index.ts`
- Modify: `src/ui/docs/index.ts`, `src/ui/index.tsx` (import hai module mới để chúng tự `register…`), và
  `src/__tests__/ui-bundle.test.ts` nếu test này liệt kê file/export

**Interfaces:**
- Consumes: I3, I5, I6 qua `usePluginData`.
- Produces: I8.

- [ ] **Bước 1: Test thuần (đỏ).**

```ts
// src/ui/storage/format.test.ts
import { expect, it } from "vitest";
import { formatBytes, formatMeasured } from "./format.js";
it("formats bytes in vi-VN with 1024 steps", () => {
  expect(formatBytes(0)).toBe("0 B"); expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1536)).toBe("1,5 KB"); expect(formatBytes(2 * 1024 ** 3)).toBe("2 GB");
  expect(formatBytes(1024 ** 4 * 3)).toBe("3 TB");
});
it("labels measured values and never shows 0 for unmeasured", () => {
  expect(formatMeasured({ kind: "logic", bytes: 1536 })).toBe("1,5 KB (logic)");
  expect(formatMeasured({ kind: "vat_ly", bytes: 0 })).toBe("0 B (vật lý)");
  expect(formatMeasured({ kind: "chua_do", reason: "x" })).toBe("Chưa đo");
});
```

```ts
// src/ui/usage/format.test.ts
import { expect, it } from "vitest";
import { COMPLETENESS_LABEL, formatTokens, formatUsd, ROLE_LABEL } from "./format.js";
it("formats tokens and estimates", () => {
  expect(formatTokens(null)).toBe("—"); expect(formatTokens(1234567)).toBe("1.234.567");
  expect(formatUsd(null)).toBe("—"); expect(formatUsd(1.234)).toBe("≈ $1.23"); expect(formatUsd(0)).toBe("≈ $0.00");
});
it("has fixed labels", () => {
  expect(COMPLETENESS_LABEL).toEqual({ day_du: "Đủ", mot_phan: "Một phần", thieu: "Thiếu", dang_chay: "Đang chạy", khong_co: "Không có số liệu" });
  expect(ROLE_LABEL).toEqual({ assistant: "Trợ Lý", executor: "Executor", reviewer: "Reviewer", integrator: "Integrator", khac: "Khác" });
});
```

```ts
// src/ui/graph/model.test.ts
import { expect, it } from "vitest";
import { DOCS_STATE_LABEL, filterGraph, layoutGraph } from "./model.js";
const graph = { nodes: [
  { id: "project:p", kind: "project", label: "P", ref: {} }, { id: "flow:a", kind: "flow", label: "A", ref: {} },
  { id: "page:x", kind: "page", label: "X", ref: {} }, { id: "file:f", kind: "file", label: "f", ref: {} },
  { id: "ticket:t", kind: "ticket", label: "T", ref: {} }, { id: "flow:b", kind: "flow", label: "B", ref: {} } ],
  edges: [{ id: "e1", kind: "project-flow", from: "project:p", to: "flow:a" }, { id: "e2", kind: "flow-file", from: "flow:a", to: "file:f" },
          { id: "e3", kind: "ticket-flow", from: "ticket:t", to: "flow:a", files: 1 }] } as never;
it("filters by kind without dangling edges", () => {
  const out = filterGraph(graph, new Set(["project", "flow", "ticket"]));
  expect(out.nodes.map((n) => n.id)).toEqual(["project:p", "flow:a", "ticket:t", "flow:b"]);
  expect(out.edges.map((e) => e.id)).toEqual(["e1", "e3"]);
});
it("lays out columns by kind, rows by order", () => {
  const pos = Object.fromEntries(layoutGraph(graph.nodes, graph.edges).map((n) => [n.id, [n.x, n.y]]));
  expect(pos["project:p"]).toEqual([0, 0]); expect(pos["flow:a"]).toEqual([260, 0]); expect(pos["flow:b"]).toEqual([260, 64]);
  expect(pos["page:x"]).toEqual([520, 0]); expect(pos["file:f"]).toEqual([780, 0]); expect(pos["ticket:t"]).toEqual([1040, 0]);
});
it("state labels", () => {
  expect(DOCS_STATE_LABEL).toEqual({ missing: "Chưa có docs", unverified: "Chưa xác minh", invalid: "Không hợp lệ", stale: "Cũ hơn code", current: "Đúng với code" });
});
```

Kiểm `vitest.config.ts` của plugin có gom `src/**/*.test.ts` (đã có `src/ui/docs/tree.test.ts`). Chạy: FAIL.

- [ ] **Bước 2: Cài ba module thuần** đúng chữ ký I8.
  - `formatBytes`:
    - `units = ["B","KB","MB","GB","TB"]`, chia 1024 tới khi < 1024 hoặc hết đơn vị;
    - `B` in số nguyên, đơn vị khác dùng `new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 })`.
  - `formatTokens` dùng `Intl.NumberFormat("vi-VN")`.
  - `formatUsd` trả `"≈ $" + n.toFixed(2)`.
  - `layoutGraph`: cột `{project:0, flow:1, page:2, file:3, ticket:4}` × 260, hàng là thứ tự xuất hiện trong cột × 64.
  - Kiểu import `type` từ `../../docs/graph.js`, `../../docs/status.js`, `../../usage/rollup.js`. Đó là import kiểu, không
    kéo code worker vào bundle UI (kiểm bằng `node build.mjs` rồi `grep -c "pluginNamespace" dist/ui/*.js` = 0).
  Chạy test: PASS.

- [ ] **Bước 3: Mục Docs.** Sửa `DocsSpace` trong `src/ui/docs/index.ts`:
  - **Trên cùng:** badge `DOCS_STATE_LABEL[status.state]` + `status.reason` (`usePluginData("crew.docs.status",
    {projectId})`).
  - **`<label>Ảnh chụp <select>`:** tùy chọn từ `crew.docs.history`, nhãn `"<commit 12> · <giờ VN> · +a ~m −r"`, bản
    hiện hành ghi thêm "(hiện hành)". Chọn bản khác thì truyền `snapshotId` cho `crew.docs.tree`/`crew.docs.page`.
  - **Hai nút `role="tab"`:** "Trang" (mặc định, giao diện cũ) và "Đồ thị" (`DocsGraphView`).
  - **`DocsGraphView`** (`src/ui/graph/docs-graph.tsx`):
    - gọi `crew.docs.graph({projectId, snapshotId, flowId})`;
    - hàng checkbox loại node (mặc định bật cả 5) và `<select>` flow;
    - `ReactFlow` (`@xyflow/react`, như `src/ui/map/ticket-map.tsx`), node từ `layoutGraph(filterGraph(...))`;
    - `onNodeClick`: `page` thì gọi `onOpenPage(path)` (chuyển về tab Trang tại path đó); `flow` thì đặt `flowId`;
      `ticket` thì `navigation.navigate(`/issues/${ref.identifier || ref.issueId}`)` (dùng `useHostNavigation` như
      `page.tsx`); `file` thì hiện dưới đồ thị dòng `"<path> thuộc flow: <danh sách>"` (từ cạnh tới file đó);
    - dưới đồ thị in `graph.notice`. `truncated === "files"` thì in thêm "Quá nhiều node, đã ẩn file; chọn một flow để
      xem file.";
    - `manifestState` khác `ok` thì in câu theo trạng thái:
      - `not_sent`: "Máy chưa gửi docs/flows.yaml (cần crew-mac mới).";
      - `absent`: "Repo không có docs/flows.yaml.";
      - `invalid`: "docs/flows.yaml không hợp lệ.";
      - `dropped`: "docs/flows.yaml bị bỏ do secret-scan hoặc quá lớn.".
  - Mọi hàng thao tác có thể đi bằng Tab. Nút có nhãn chữ, không chỉ icon.

- [ ] **Bước 4: Mục Dung lượng** (`src/ui/storage/index.ts`, `registerPageSection({id:"storage", title:"Dung lượng",
  order:40, component: StorageSection})`).
  - Gọi `crew.storage({companyId})`.
  - Bảng `DataTable` theo project: cột Docs (logic / vật lý / bản cũ), Index, Ticket/event (số issue, comment, run, byte
    comment, vật lý), File đính kèm (số file, chưa có cỡ, logic, "từ <ngày>").
  - Dòng tổng company: docs vật lý, dùng chung, bản cũ.
  - Bảng bảng plugin (ghi "toàn plugin, mọi company").
  - Bảng máy: cache "x / 2 GB", số blob, số run, giờ đo; `null` thì "Chưa đo".
  - Mọi số qua `formatMeasured`/`formatBytes`.
  - Cuối mục: "Logic = tổng theo từng ảnh chụp; vật lý = thực sự chiếm chỗ sau khử trùng; không cộng vật lý của các
    nhóm khi có nhóm chưa đo."

- [ ] **Bước 5: Panel Usage** (`src/ui/usage/index.ts`, `registerIssuePanel({id:"usage", order:30, component:
  UsagePanel})`). Panel nhận `issueId` của gốc map. Tab truyền `data.root.id`, nên panel hiện usage của yêu cầu gốc. Thêm
  dòng "Đang xem: <identifier>".
  - Gọi `crew.usage.issue({issueId})`.
  - Hai thẻ tách nhau: "Chỉ issue này" (`direct`) và "Gồm issue con" (`tree`, ẩn khi `null`). Mỗi thẻ: input, cache
    đọc, output, USD ước tính, mức đầy đủ, "x/y lượt có số liệu".
  - **Không** có ô tổng hai thẻ.
  - Bảng con (`children`), bảng vai trò, bảng model (cột "Nguồn": `model_usage` → "theo model", `run_model` → "model
    chính của lượt").
  - `<details>` "Các lượt chạy" (bảng `runs`, cột mức đầy đủ dùng `COMPLETENESS_LABEL`).
  - Dòng reuse "Phiên mới: a · Dùng lại phiên: b · Không rõ: c".
  - Danh sách `notes` (4 câu).
  - Không có ký tự `%` cạnh số token.

- [ ] **Bước 6: Chạy** test thuần UI, `ui-bundle.test.ts`, `page-headings.test.ts`, `pnpm typecheck`, `node build.mjs`,
  biome. Kỳ vọng: PASS, bundle UI không có `pluginNamespace`.

- [ ] **Bước 7: Commit.** `feat(crew-plugin): đồ thị docs, mục dung lượng và panel usage trên giao diện Crew`.

- [ ] **Bước 8 (Trợ Lý, sau khi ff gói `plugin` vào `crew/r2-5`):** ghi một dòng vào
  `plans/261010-0020-crew-v3-r3/sdd-ledger.md`, nội dung:
  - data key `crew.docs.history/status/graph`, `crew.storage`, `crew.usage.issue/summary`;
  - route `GET /docs/graph`;
  - module thuần `src/ui/{graph/model,storage/format,usage/format}.ts`;
  - đề nghị PL-3 export `shared/docs-graph`, `shared/storage-format`, `shared/usage-format`, DS-4 làm widget.
