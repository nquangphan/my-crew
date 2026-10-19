# Crew v3 R2-2: gói `sync` (SV-1), `plugin` (PA-1), `agents` (AG-1, AG-2), `ops` (DP-1), kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phần VPS của R2-2:
- plugin `crew.core` cảnh báo file đính kèm agent sẽ không đọc;
- hướng dẫn agent biết chạy `crew-mac files`;
- nếu cổng G0 chọn B, H1 đẩy attachment sang Mac bằng SSH ngay sau khi claim run.

Sau đó deploy lên `crew.2p-solutions.com`, áp instructions mới cho agent, cài `crew-mac` mới lên Mac mini.

**Architecture:** Không thêm hook, không sửa lõi.
- SV-1 thêm `server/src/crew/attachment-sync.ts`. `implementations.beforeClaim` trong `core-hooks.ts` gọi `startAttachmentSyncOnClaim(input)` sau `applyBundleResumeSafely` khi run được claim. Tác vụ chạy nền, theo mẫu `startRemoteStopOnRelease`.
- PA-1 thêm job theo lịch của plugin, bảng audit trong namespace plugin, comment không đánh thức assignee.
- AG-1 sửa 4 file markdown trong `crew/agents/`.
- DP-1 theo đúng trình tự DP-3 của R2-1.

**Tech Stack:** Fork `crew/r2-2` (nền `v2026.1005.0`); Express, Drizzle; `@paperclipai/adapter-utils/ssh` (`runSshCommand`, `syncDirectoryToSsh`, `shellQuote`); `server/src/storage` (`getStorageService`); plugin SDK (`ctx.jobs.register`, `ctx.authorization.audit.search`, `ctx.issues.getAttachmentContent`, `ctx.issues.createComment`, `ctx.db`); Vitest + Postgres nhúng; `crew/release/verify.sh`; `crew/ops/*`.

**Spec:** [plan.md](plan.md) (Global Constraints, Lệch 1–3, 6, 7, Review Focus 4–5, Interface I5–I8) và spec §5.2 (đường B), §5.5, §5.6, §5.9.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng các gói này:

- Chỉ sửa `server/src/crew/**`, `server/src/__tests__/crew-*`, `packages/crew-plugin/**`, `crew/agents/**`, `crew/release/core-hooks.json` (chỉ `description` của H1). `node crew/release/check-core-hooks.mjs` vẫn đủ 5 mốc.
- Test Postgres nhúng: kiểm `ipcs -m` trước, chạy một file một lúc, không chạy cùng `verify.sh` hay test DB của gói khác.
- Migration plugin chỉ thêm `0005_attachment_audit.sql`. Không sửa `0001`–`0004` đã áp.
- Mỗi ticket bắt đầu bằng `git merge --ff-only crew/r2-2` trong worktree của gói.

---

### Task 1 (SV-1, chỉ khi G0 = B): Đẩy attachment sang Mac sau H1

**Files:**
- Create: `server/src/crew/attachment-sync.ts`, `server/src/__tests__/crew-attachment-sync.test.ts`
- Modify: `server/src/crew/core-hooks.ts` (import + một dòng trong `implementations.beforeClaim`), `crew/release/core-hooks.json` (`entries[H1].description`)

**Interfaces:**
- Consumes: `BeforeClaimInput` (`load-gate.ts`), `resolveEnvironmentDriverConfigForRuntime`, `environmentService(db).getById`, bảng `agents.defaultEnvironmentId`, `issueService(db).listAttachments`/`getAncestors`/`getById`, `getStorageService().getObject(companyId, objectKey)`, `runSshCommand`, `syncDirectoryToSsh`, `shellQuote`.
- Produces: I5 và

```ts
export const ATTACHMENT_SYNC_ENV = "CREW_ATTACHMENT_SYNC";
export const ATTACHMENT_SYNC_LIMIT_MS = 120_000;
export const ATTACHMENT_SYNC_MAX_FILES = 40;
export const ATTACHMENT_SYNC_MAX_BYTES = 10 * 1024 * 1024;
export interface AttachmentSyncDeps {
  enabled(): boolean;
  loadTarget(run: BeforeClaimInput["run"]): Promise<{ issueId: string; companyId: string; ssh: SshConfig } | null>;
  listFiles(issueId: string): Promise<Array<Omit<IncomingManifest["files"][number], "blob"> & { objectKey: string }>>;   // issue + ancestors, đã sắp theo I5
  runSsh(ssh: SshConfig, command: string, timeoutMs: number): Promise<{ stdout: string }>;
  openBlob(companyId: string, objectKey: string): Promise<NodeJS.ReadableStream>;
  syncDir(ssh: SshConfig, localDir: string, remoteDir: string): Promise<void>;
}
export type AttachmentSyncOutcome = "skipped" | "nothing" | "synced" | "failed" | "timeout";
export function buildProbeCommand(runId: string, shas: string[]): string;     // ném nếu runId/sha sai dạng
export function buildFinalizeCommand(runId: string, home: string): string;    // home phải là đường dẫn tuyệt đối không có ký tự điều khiển
export function parseProbeOutput(stdout: string): { home: string; missing: string[] } | null;
export async function syncAttachmentsForRun(input: BeforeClaimInput, deps?: Partial<AttachmentSyncDeps>): Promise<AttachmentSyncOutcome>;
export function startAttachmentSyncOnClaim(input: BeforeClaimInput, deps?: Partial<AttachmentSyncDeps>): void;   // không await, không ném
export async function settleAttachmentSyncsForTests(): Promise<void>;
```

- [ ] **Step 1: Test** (`crew-attachment-sync.test.ts`, deps giả, không SSH thật):
  1. `enabled()` false → `skipped`, không gọi `loadTarget`.
  2. Run không có `contextSnapshot.issueId`, agent không có environment, environment không phải `ssh`/không `active` → `skipped`.
  3. Issue + 2 ancestors có 45 file → manifest 40 mục theo thứ tự I5. File > 10 MB → `blob: 'over_limit'`, không `openBlob`.
  4. Probe trả `home=/Users/x` và `missing=<sha1>` → chỉ blob sha1 nằm trong thư mục tạm. `syncDir` nhận `remoteDir = /Users/x/.crew/cache/attachments/incoming/<runId>`. Finalize được gọi sau `syncDir`. Thư mục tạm bị xóa ở mọi nhánh (kiểm `existsSync` sau).
  5. `buildProbeCommand('x;rm -rf /', …)` và sha `../../etc` → ném. Lệnh hợp lệ chỉ chứa script cố định + đối số đã `shellQuote`. Snapshot chuỗi lệnh.
  6. `parseProbeOutput` từ chối `home=` tương đối hay có xuống dòng lạ.
  7. `runSsh` ném ở probe → `failed`, log `warn` chỉ có `runId`, `outcome`, `err.name`. Logger giả: không có `objectKey`, tên file, nội dung.
  8. `syncDir` treo → sau `ATTACHMENT_SYNC_LIMIT_MS` (fake timers) → `timeout`, thư mục tạm vẫn bị xóa.
  9. **Review Focus 5:** `crewCoreHooks.beforeClaim` với `overrideCrewCoreHooksForTests` giữ load gate trả `false` và deps sync ném ngay. `beforeClaim` vẫn trả `false`, trả về trước khi sync xong (deferred chưa resolve), không reject.
  10. Run đang bị load gate giữ (`crewBeforeClaim` true) → không khởi động sync.
- [ ] **Step 2: Chạy** `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-attachment-sync.test.ts` → FAIL.
- [ ] **Step 3: Cài.**
  - `startAttachmentSyncOnClaim` giữ Map `pending` như `remote-stop.ts`, `Promise.race` với giới hạn 120 giây, `.catch` log.
  - Thư mục tạm `mkdtemp(join(tmpdir(), 'crew-att-'))` chmod 0700, blob ghi 0600 bằng `pipeline(openBlob, createWriteStream)`.
  - Kiểm sha256 trên VPS khi ghi; lệch `assets.sha256` thì xóa blob đó khỏi thư mục tạm và đánh `blob: 'hash_mismatch'` (I5). Thêm ca test: `openBlob` trả bytes khác sha → mục đó `hash_mismatch`, không có trong thư mục gửi.
  - `core-hooks.ts`:

```ts
  beforeClaim: async (input) => {
    if (await crewBeforeClaim(input)) return true;
    await applyBundleResumeSafely(input);
    startAttachmentSyncOnClaim(input);
    return false;
  },
```

  - `core-hooks.json` H1 `description`: `"Keep a queued run queued while its environment is overloaded or unreachable; when claimed, resume the previous issue's session within a Crew bundle and, when CREW_ATTACHMENT_SYNC=ssh, push the issue's attachments to the SSH host in the background."`
- [ ] **Step 4: Kiểm:**
  - Chạy `vitest run src/__tests__/crew-attachment-sync.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-core-hooks.test.ts src/__tests__/crew-claim-resume-contract.test.ts`.
  - Chạy `node crew/release/check-core-hooks.mjs` (5/5) và `corepack pnpm --filter @paperclipai/server exec tsc --noEmit`.
  - Kết quả mong đợi: PASS.
- [ ] **Step 5: Commit** (nhánh `crew/r22-sync`) `feat(crew): đẩy file đính kèm của issue sang máy SSH khi run được nhận`. Ghi vào ledger tên trường I5 thực tế cho FL-B.

---

### Task 2 (PA-1): Job kiểm file đính kèm của plugin

**Files:**
- Create: `packages/crew-plugin/migrations/0005_attachment_audit.sql`, `packages/crew-plugin/src/attachments/{rules.ts,audit.ts}`, `packages/crew-plugin/src/__tests__/{attachments-rules.test.ts,attachments-audit.db.test.ts}`
- Modify: `packages/crew-plugin/src/manifest.ts`, `packages/crew-plugin/src/worker.ts` (một dòng `registerAttachmentsAudit(ctx)` trong `setup`)

**Interfaces:**
- Consumes: I6, I7; `ctx.authorization.audit.search({ companyId, action: "issue.attachment_added", limit: 100, offset })` (trả mới nhất trước, `details` có `attachmentId`, `originalFilename`, `contentType`, `byteSize`; `entityId` = issueId); `ctx.issues.getAttachmentContent(id, companyId, { maxBytes })`; `ctx.issues.createComment(issueId, body, companyId)`; companies từ `config.companies[].companyId` (mẫu `src/shared/webhook.ts:78`).
- Produces:

```ts
// rules.ts
export const ALLOWED_EXTENSIONS: readonly string[]; export const SNIFF_CHECKED: readonly string[]; export const MACRO_EXTENSIONS: readonly string[];
export type AuditVerdict = { verdict: "allowed" } | { verdict: "blocked"; reason: string } | { verdict: "unreadable" };
export function judgeByName(filename: string | null, contentType: string): AuditVerdict | "needs-bytes";
export function judgeBytes(filename: string, head: Uint8Array): AuditVerdict;   // chỉ đọc ≤ 16 byte đầu
export function sanitizeFilename(name: string | null): string;                  // bỏ điều khiển, backtick, xuống dòng; ≤ 120 ký tự; null → "(không tên)"
// audit.ts
export function registerAttachmentsAudit(ctx: PluginContext): void;
export async function runAttachmentsAudit(ctx: PluginContext, now: Date): Promise<{ checked: number; warned: number }>;
```

- [ ] **Step 1: Test rules** (`attachments-rules.test.ts`):
  - Chuỗi `ALLOWED_EXTENSIONS.join(" ")`, `SNIFF_CHECKED`, `MACRO_EXTENSIONS` đúng nguyên văn I6, giống bản crew-mac FL-2.
  - `tool.zip` → blocked `kiểu file không được phép (zip)`; `a.docm` → `tài liệu Office có macro (docm)`; `a.exe` → `kiểu file không được phép (exe)`; `a.pptx` → `(pptx)`; `a.mp4` → `(media)`; `a.doc` → `(office-cu)`; không đuôi → `(khac)`.
  - `a.md` → allowed (không cần bytes); `a.png` → `"needs-bytes"`.
  - `judgeBytes("a.png", MACHO)` → blocked `(exe)`; PNG thật → allowed; `a.docx` bắt đầu `PK\x03\x04` → allowed; `a.pdf` bắt đầu `MZ` → blocked `(exe)`; `a.png` có chữ ký jpeg → allowed (Mac tự xử lý).
  - `sanitizeFilename("a`b\nc.zip")` → `abc.zip`.
- [ ] **Step 2: Test DB** (`attachments-audit.db.test.ts`, khuôn `roles.db.test.ts`, Postgres nhúng, ctx giả):
  1. 3 activity (`tool.zip`, `fake.png` có bytes Mach-O, `ok.png` thật) cùng một issue → **một** comment có 2 dòng đúng câu I7 (thứ tự theo `createdAt`), bảng có 3 dòng (`blocked`, `blocked`, `allowed`), `warned_at` có ở 2 dòng.
  2. Chạy lần hai → 0 comment mới (mỗi attachment một lần).
  3. `createComment` được gọi **không** có `options.actorUserId` (kiểm đối số) → không đánh thức assignee (Lệch 3).
  4. `getAttachmentContent` ném (file > `maxBytes`) hoặc trả `null` → verdict `unreadable`, không comment, không ném ra ngoài job.
  5. Trang 1 của `audit.search` toàn id mới → đọc tiếp `offset=100`; gặp id đã có trong bảng thì dừng.
  6. Company không có trong config → không quét.
  7. Logger giả không nhận tên file, `contentType`, bytes; chỉ `companyId`, số đếm.
  8. Activity có `entityType` khác `issue` hoặc thiếu `attachmentId` → bỏ qua.
- [ ] **Step 3: Chạy:**
  - `corepack pnpm --filter @crew/paperclip-plugin exec vitest run src/__tests__/attachments-rules.test.ts`;
  - rồi (sau `ipcs -m`) `… vitest run src/__tests__/attachments-audit.db.test.ts`.
  - Mong đợi: FAIL.
- [ ] **Step 4: Cài.**
  - Migration đúng DDL I7.
  - `manifest.ts`: thêm capability `"issue.attachments.read"`, `"jobs.schedule"`, `"authorization.audit.read"` và
    `jobs: [{ jobKey: "attachments-audit", displayName: "Kiểm file đính kèm", description: "Cảnh báo file đính kèm agent sẽ không đọc", schedule: "* * * * *" }]`.
  - `audit.ts`: với từng company, đọc trang activity, lọc id chưa có trong bảng, rồi `judgeByName`. Kết quả `needs-bytes` thì đọc `getAttachmentContent(id, companyId, { maxBytes: 10 * 1024 * 1024 })`, lấy 16 byte đầu của `Buffer.from(contentBase64, "base64")`, rồi `judgeBytes`. Biến buffer không giữ ngoài vòng lặp.
  - Ghi bảng (`INSERT … ON CONFLICT DO NOTHING`). Gom các file `blocked` theo issue thành một comment, rồi cập nhật `warned_at`.
  - `worker.ts`: `registerAttachmentsAudit(ctx)` trong `setup`.
- [ ] **Step 5: Kiểm:**
  - Hai lệnh test trên, `vitest run src/__tests__/registry.test.ts src/__tests__/ui-bundle.test.ts`.
  - `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-plugin-manifest.test.ts`.
  - `corepack pnpm --filter @crew/paperclip-plugin exec tsc --noEmit && node packages/crew-plugin/build.mjs`.
  - Mong đợi: PASS.
- [ ] **Step 6: Commit** (nhánh `crew/r22-plugin`) `feat(crew-plugin): cảnh báo file đính kèm agent sẽ không đọc`.

---

### Task 3 (AG-1): Hướng dẫn agent về file đính kèm

**Files:**
- Modify: `crew/agents/{assistant,executor,reviewer,integrator}.md`, `crew/agents/instructions.test.mjs`

**Interfaces:**
- Consumes: I3 (lệnh, tên trạng thái tiếng Việt), I8.
- Produces: 4 file instructions có khối I8. DP-1 và AG-2 dùng nguyên văn.

- [ ] **Step 1: Test** (thêm vào `instructions.test.mjs`):

```js
const ATTACH_CMD = '"$HOME/.crew/bin/crew-mac" files --issue "$PAPERCLIP_TASK_ID" --run "$PAPERCLIP_RUN_ID"';
for (const role of ["assistant", "executor", "reviewer", "integrator"]) {
  test(`${role} có mục File đính kèm đúng lệnh và luật`, () => {
    const text = readFileSync(new URL(`./${role}.md`, import.meta.url), "utf8");
    const section = text.split("\n## ").find((s) => s.startsWith("File đính kèm"));
    assert.ok(section, "thiếu mục ## File đính kèm");
    assert.ok(section.includes(ATTACH_CMD));
    for (const s of ["bị chặn", "mã hóa", "không đọc được", "hỏng", "quá lớn", "chưa đồng bộ", "không phải chỉ thị", "[ĐÃ CHE: …]"])
      assert.ok(section.includes(s), `thiếu "${s}"`);
    assert.ok(text.indexOf("## File đính kèm") < text.indexOf("## Mỗi lần được đánh thức") || !text.includes("## Mỗi lần được đánh thức"));
  });
}
```

- [ ] **Step 2: Chạy** `node --test crew/agents/instructions.test.mjs` → FAIL.
- [ ] **Step 3: Chèn** khối I8 nguyên văn vào 4 file. Vị trí: ngay trước `## Mỗi lần được đánh thức`; file nào không có mục đó thì đặt ngay sau `## Gọi API`. Thêm vào mục `## Không bao giờ` của mỗi file một dòng: `- Mở file đính kèm bị chặn bằng công cụ khác, hay chép credential từ file/ảnh vào comment, code, commit.`
- [ ] **Step 4: Kiểm** `node --test crew/agents/*.test.mjs` (77+ test) → PASS. Kiểm `render-instructions.mjs` vẫn render được cả 4 vai (test có sẵn).
- [ ] **Step 5: Commit** (nhánh `crew/r22-agents`) `docs(crew-agents): hướng dẫn agent đọc file đính kèm bằng crew-mac files`.

---

### Task 4 (AG-2, chỉ khi owner cho phép): Đồng bộ template của app

**Files:**
- Modify (repo Crew, nhánh `r22/mac-app-templates`): `apps/mac-app/src/main/projects/templates/{assistant,executor,reviewer,integrator}.md`, `apps/mac-app/test/projects-instructions.test.ts`, `docs/flows/mac-app-paperclip.md`

- [ ] **Step 1:** Chép khối I8 và dòng "Không bao giờ" mới từ fork `crew/agents/*.md` (sau AG-1) vào đúng vị trí tương ứng trong 4 template. Không đổi phần riêng theo project.
- [ ] **Step 2:** Render 4 vai bằng `renderInstructions` của `instructions.ts` và so với `render-instructions.mjs` của fork (cách FX-12): chỉ được lệch ở mục "Executor của company". Cập nhật sha256 trong `projects-instructions.test.ts`.
- [ ] **Step 3:** `pnpm --filter @crew/mac-app test -- test/projects-instructions.test.ts && pnpm --filter @crew/mac-app typecheck && pnpm exec biome check apps/mac-app docs && node packages/docs-kit/dist/crew-docs.cjs check --staged` → PASS.
- [ ] **Step 4: Commit** `docs(mac-app): đồng bộ hướng dẫn file đính kèm vào template agent`. Nếu owner yêu cầu trailer R6 thì thêm `Crew-Owner-Approved: <ticket-key owner đưa>`.

---

### Task 5 (DP-1): Deploy, áp instructions, cài crew-mac

**Files:** không file nguồn. Ghi `sdd-ledger.md`, `processes.md`.

**Interfaces:**
- Consumes: `crew/r2-2` đã có PA-1, AG-1 (+ SV-1); `r2-2` đã có FL-1..FL-5 (+ FL-B); RV-1 `DONE`.
- Produces:
  - image `crew-v3/paperclip:v3-<sha8>` đang chạy;
  - mốc rollback `TS`;
  - tag cục bộ `crew/v3.2-rc1`;
  - instructions agent mới (R1 + `2ps-landing` nếu AG-2 xong);
  - `~/.crew/app/crew-mac` bản R2-2.

- [ ] **Step 1: Verify.** Worktree `.worktrees/paperclip-r22-int` @ `crew/r2-2`. Chạy `ipcs -m`, rồi `bash crew/release/verify.sh` → "XANH". `node crew/release/check-core-hooks.mjs` 5/5. Ghi giờ theo `date`.
- [ ] **Step 2: Deploy** khi `active-runs.sh` rỗng. Trình tự:
  1. `backup.sh`.
  2. `overlay-source.sh <sha>`.
  3. `overlay-job.sh <sha>`.
  4. Nếu B: thêm `CREW_ATTACHMENT_SYNC=ssh` vào env compose bằng cơ chế env có sẵn của `deploy.sh` (đọc `deploy.sh`/`policy-env.sh` để biết chỗ; body đi qua scp).
  5. `deploy.sh`.
  
  Ghi mã backup và mốc rollback.
- [ ] **Step 3: Kiểm sau deploy.**
  - `https://crew.2p-solutions.com/api/health` `status ok` và `commit` = sha.
  - `/api/plugins` `crew.core` `ready`; capability mới được cấp. Nếu host đòi duyệt lại capability thì dừng, báo Trợ Lý, không tự duyệt thay owner.
  - Job `attachments-audit` có trong danh sách job của plugin; một lượt chạy `succeeded` trong 2 phút.
  - `https://2p-solutions.com` 200, `https://kidyschool.com` 200.
  - Hỏng bất kỳ mục nào thì `rollback.sh <TS>` ngay.
- [ ] **Step 4: Instructions.**
  - **4 agent R1:** `apply-roles.sh agent <id> <role> <pin>`, chạy từ máy này với shim `api.sh` chuyển lệnh qua ssh `</dev/null`. Body đi bằng scp, không nhúng vào lệnh ssh. Lấy id trong `crew-policy.json`, executor/assistant theo cách DP-3. GET lại `AGENTS.md` khớp từng byte bản render.
  - **4 agent `2ps-landing`:** chỉ khi AG-2 xong. Dùng PUT có `baseHash` (cách FX-12), GET lại khớp.
  - Không đổi `extraArgs`, `adapterConfig`.
- [ ] **Step 5: Cài crew-mac.** 0 run active.
  1. `pnpm --filter @crew/mac build` trên `r2-2`.
  2. Gọi `installCrewMacFrom(createMacContext({ env: process.env, out: console.log, cliPath: <home>/.crew/app/crew-mac/dist/cli.js }), '<repo>/apps/crew-mac')` bằng một script tạm trong scratchpad.
  3. Kết quả `installed: true` hoặc `reason` hợp lệ.
  
  Kiểm qua sshd agent: `ssh -p 2222 <user>@127.0.0.1 '"$HOME/.crew/bin/crew-mac" files --gc-only'` in `Đã dọn: …` và thoát 0. `ls ~/.crew/app/crew-mac/dist/files-worker.cjs ~/.crew/app/crew-mac/dist/files/pdf-info.js` có đủ.
- [ ] **Step 6: Tag** `git tag -a crew/v3.2-rc1 -m "crew v3.2 rc1: file đính kèm"` trên sha đã deploy (cục bộ, không push). Ghi ledger: giờ, sha, backup, mốc rollback, kết quả từng kiểm.

Kết thúc mỗi ticket bằng `Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`.
