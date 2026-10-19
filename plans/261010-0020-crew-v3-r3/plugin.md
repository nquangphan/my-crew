# Crew v3 R3: gói `plugin` (PL-1..PL-3), kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugin `crew.core` thêm:
- hàng đợi việc trên máy;
- tiến độ wizard;
- danh sách company Crew;
- trạng thái sync skill;
- nhận key mới của bản tin máy;
- export logic thuần cho web dùng lại.

**Architecture:**
- Hai migration mới trong namespace plugin (`0006`, `0007`).
- Route `apiRoutes` `auth: "board"`. `worker.ts` định tuyến `onApiRequest` theo `routeKey` tới `roles/api.ts`, `jobs/api.ts`, `setup/api.ts`.
- Data đăng ký bằng `ctx.data.register`, theo mẫu `machines/data.ts`.
- Mọi SQL dùng tham số, không ghép chuỗi giá trị.

**Tech Stack:** Plugin SDK fork (`definePlugin`, `PluginApiRequestInput`, `ctx.db.query/execute`, `ctx.data.register`), Vitest + Postgres nhúng (mẫu `roles.db.test.ts`), TypeScript 7.

**Spec:** [plan.md](plan.md) (Lệch 3, Review Focus 1, 3, Interface I1, I2, I3, I6), spec §4.5, 4.6.

## Global Constraints

Áp dụng Global Constraints của [plan.md](plan.md). Riêng gói này:

- Chỉ ghi `packages/crew-plugin/**`. Migration chỉ thêm `0006`, `0007`. Không sửa `0001`–`0005`.
- Test Postgres nhúng:
  - kiểm `ipcs -m` trước;
  - chạy một file một lúc (`corepack pnpm --filter @crew/paperclip-plugin exec vitest run src/__tests__/<file>`);
  - không chạy cùng `verify.sh` hay test DB của gói khác.
- Handler route kiểm `input.actor?.type === 'board'` (trả 403 nếu không), dù host đã kiểm. Lỗi DB ghi `ctx.logger.error` kèm `routeKey`, trả 500 `{error: 'Không đọc/ghi được <tên>'}`, không lộ SQL.
- `worker.ts`, `manifest.ts` là điểm nối chung với SEC-2: PL-1 → PL-2 → SEC-2 tuần tự.
- Lệnh: test như trên; `corepack pnpm --filter @crew/paperclip-plugin typecheck`; `corepack pnpm --filter @crew/paperclip-plugin build`; `npx biome check packages/crew-plugin`.

---

### Task 1 (PL-1): Hàng đợi việc trên máy

**Files:**
- Create:
  - `packages/crew-plugin/migrations/0006_machine_jobs.sql` (đúng I1)
  - `src/jobs/{types.ts,validate.ts,sanitize.ts,data.ts,api.ts}`
  - `src/__tests__/{machine-jobs-validate.test.ts,machine-jobs-sanitize.test.ts,machine-jobs.db.test.ts}`
- Modify:
  - `src/manifest.ts`: thêm 6 route I1, cùng `capability: "api.routes.register"`. `jobs.list` dùng `companyResolution: { from: "query", key: "companyId" }`, còn lại `from: "body"`.
  - `src/worker.ts`: `onApiRequest` định tuyến theo tiền tố `routeKey` (`roles.` → `handleRolesApi`, `jobs.` → `handleJobsApi`; lạ thì 404).
  - `src/features.ts`: `registerJobsData(ctx)`.

**Interfaces:**
- Consumes: `ctx.db` (`SCHEMA` trong `shared/db.ts`), `UUID`.
- Produces:
  - I1;
  - `handleJobsApi(ctx, input): Promise<PluginApiResponse>`;
  - `validateJobPayload(kind, payload): JobPayload | string` (string = lỗi);
  - `sanitizeJobError(text: string): string`;
  - `claimNextJob(ctx, companyId, machineId, now): Promise<MachineJob | null>`.

- [ ] **Step 1: Test validate (đỏ)**

```ts
// src/__tests__/machine-jobs-validate.test.ts
it.each([
  ['inspect-folder', { folder: 'relative/path' }, 'folder phải là đường tuyệt đối'],
  ['inspect-folder', { folder: '/Users/a/../b' }, 'folder không được chứa ..'],
  ['inspect-folder', { folder: '/Users/a\u0007' }, 'folder có ký tự điều khiển'],
  ['prepare-checkouts', { projectKey: 'Bad_Key', folder: '/x', roles: [] }, 'projectKey không hợp lệ'],
  ['prepare-checkouts', { projectKey: 'demo', folder: '/x', roles: [{ role: 'executor', branch: '-x' }] }, 'branch không hợp lệ'],
  ['skill-sync', { skillId: 'x', slug: 'Ok', version: '1' }, 'skillId phải là uuid'],
  ['check', { projectKey: 'demo', extra: 1 }, 'trường extra không được hỗ trợ'],
])('%s từ chối %j', (kind, payload, error) => {
  expect(validateJobPayload(kind as MachineJobKind, payload)).toBe(error);
});
it('nhận payload hợp lệ', () => {
  expect(validateJobPayload('prepare-checkouts', { projectKey: 'demo', folder: '/Users/a/repo', roles: [
    { role: 'assistant', branch: 'crew/demo/assistant' }, { role: 'executor', branch: 'crew/demo/executor' },
    { role: 'reviewer', branch: 'crew/demo/reviewer' }, { role: 'integrator', branch: 'crew/demo/integrator' }] })).toMatchObject({ kind: 'prepare-checkouts' });
});
```

  Chuỗi lỗi trên là chuỗi cố định viết trong `validate.ts`.
- [ ] **Step 2: Test sanitize (đỏ):**
  - `sanitizeJobError('fatal: x\x1b[31m AKIAIOSFODNN7EXAMPLE ' + 'y'.repeat(400))` không chứa `\x1b`, không chứa `AKIAIOSFODNN7EXAMPLE`, có `[ĐÃ CHE]`, dài ≤ 300.
  - Chuỗi `ghp_` + 36 ký tự cũng bị che.

  Bảng luật chép từ `packages/docs-kit/src/secret-scan.ts` của repo Crew (`git show r2-2:packages/docs-kit/src/secret-scan.ts`), bỏ `allow`, ghi nguồn ở đầu file.
- [ ] **Step 3: Test DB (đỏ)** `machine-jobs.db.test.ts` (mẫu dựng DB, áp migration như `roles.db.test.ts`):
  - `jobs.create` board → 201; actor agent → 403; payload sai → 400 câu cố định; company khác project → vẫn tạo (job không gắn project) nhưng `companyId` trong body phải khớp `input.companyId`, sai thì 400.
  - `jobs.claim` hai lời gọi song song (`Promise.all`) trên 1 việc `queued` → đúng một trả việc, một trả 204 (Review Focus 1).
  - Lease: việc `claimed` có `lease_until` quá hạn → `claim` sau trả lại chính việc đó, `attempts = 1`. Sau 3 lần → `failed` `lease_expired`, `claim` trả 204.
  - `jobs.result` từ `machineId` khác → 409; việc không `claimed` → 409; `done` lưu `result`; `failed` lưu `errorText` đã qua `sanitizeJobError`.
  - `jobs.retry`: `failed` → `queued`; trạng thái khác → 409. `jobs.cancel`: `queued` → `cancelled`.
  - `jobs.list` và data `crew.machineJobs` lọc theo `machineId`, `setupRunId`, `status`, giới hạn 100, mới nhất trước.
- [ ] **Step 4: Chạy từng file, thấy đỏ.**
- [ ] **Step 5: Cài.** `claimNextJob` trong một transaction (`BEGIN … COMMIT` qua `ctx.db.execute`; nếu SDK không cho transaction nhiều lệnh thì dùng một câu `WITH expired AS (UPDATE … RETURNING …), picked AS (SELECT … FOR UPDATE SKIP LOCKED) UPDATE … RETURNING *`). Ghi lại cách đã chọn trong comment đầu hàm.
- [ ] **Step 6: Xanh từng file, typecheck, build, biome.**
- [ ] **Step 7: Commit** `feat(crew-plugin): hàng đợi việc trên máy cho app Mac`.

---

### Task 2 (PL-2): Tiến độ wizard, company Crew, sync skill, bản tin mở rộng

**Files:**
- Create:
  - `migrations/0007_setup_runs.sql` (đúng I2)
  - `src/setup/{types.ts,data.ts,api.ts}`
  - `src/companies/data.ts`
  - `src/skills/sync-data.ts`
  - `src/__tests__/{setup-runs.db.test.ts,companies.test.ts,skill-sync.db.test.ts}`
- Modify:
  - `src/manifest.ts`: 4 route I2;
  - `src/worker.ts`: tiền tố `setup.`;
  - `src/features.ts`;
  - `src/machines/webhook.ts`: key tùy chọn I3, `maxBytes` 65 536;
  - `src/__tests__/webhook.test.ts`.

**Interfaces:**
- Consumes: I1 (bảng job cho `crew.skillSync`), `ctx.config` (instance config `companies`), bảng lõi `companies` (đọc).
- Produces: I2; data `crew.companies`, `crew.setupRuns`, `crew.skillSync` (I6); `MachineReport` mở rộng (I3).

- [ ] **Step 1: Test setup runs (đỏ)** `setup-runs.db.test.ts`:
  - `setup.create` `add-project` khóa `demo` → 201.
  - Tạo lần hai cùng khóa khi run trước chưa `done` → 409 `{error, setupRunId}`.
  - `setup.begin` bước `agents` → 200. Lần hai trong 5 phút → 409. Sau `setup.finish` → begin lại được (Review Focus 1).
  - `running_since` quá 5 phút → begin được (khóa chết).
  - `setup.finish` `failed` → run `failed`, `steps.agents.status='failed'`, `error` đã sanitize.
  - `setup.finish` bước `check` `done` → run `done`. `projectId` ghi khi finish bước `project`.
  - Actor agent → 403. `companyId` lệch → 400.
- [ ] **Step 2: Test company (đỏ)** `companies.test.ts`: config `companies: [{companyId: A}, {companyId: B}]`, bảng `companies` chỉ có A → `crew.companies` trả `[{id: A, name}]`. Config rỗng → `[]`.
- [ ] **Step 3: Test sync skill (đỏ)** `skill-sync.db.test.ts`: 3 job `skill-sync` cùng skill trên cùng máy (failed, done cũ, done mới) → trả bản `done` mới nhất có `sha256`.
- [ ] **Step 4: Test webhook (đỏ)** thêm vào `webhook.test.ts`:
  - Bản tin có `checkouts` hợp lệ → lưu nguyên.
  - `checkouts` có 65 phần tử hoặc phần tử thiếu `path` → bỏ riêng key `checkouts`, phần còn lại lưu, trả 200.
  - `superpowers.skills` > 100 hoặc không phải mảng chuỗi → bỏ riêng `skills`.
  - `jobsAgent.lastPollAt` không phải ISO → bỏ `jobsAgent`.
  - Body 40 000 byte hợp lệ → nhận.
- [ ] **Step 5: Chạy từng file, đỏ. Step 6: Cài. Step 7: Xanh, typecheck, build, biome.**
- [ ] **Step 8: Commit** `feat(crew-plugin): tiến độ wizard, company Crew, trạng thái sync skill, bản tin máy mở rộng`.

---

### Task 3 (PL-3): Export logic thuần cho web

**Files:**
- Create:
  - `src/shared-web/{map.ts,docs-tree.ts,machine-card.ts,attachment-rules.ts}`: chỉ `export … from '../ui/map/layout.js'` …, không chép code.
  - `src/__tests__/shared-exports.test.ts`
- Modify:
  - `package.json`: thêm `"exports": { "./shared/*": { "types": "./src/shared-web/*.ts", "import": "./src/shared-web/*.ts" } }`;
  - `tsconfig.json`, nếu cần cho `allowImportingTsExtensions`/`moduleResolution: bundler`.

**Interfaces:**
- Produces: `@crew/paperclip-plugin/shared/{map,docs-tree,machine-card,attachment-rules}`. Không module nào kéo React hay SDK worker. Test kiểm graph import.

- [ ] **Step 1: Test (đỏ)** `shared-exports.test.ts`:
  - import động từng subpath, khẳng định có các hàm mà DS-4 cần (`layoutTicketMap`, `projectMap`, `buildDocsTree`, `machineCardModel`, `warnForAttachment`). Tên thật đọc từ file nguồn. Nếu `warnForAttachment` chưa có thì thêm hàm thuần vào `attachments/rules.ts`: `(filename) => string | null`, câu theo I2 của R2-2.
  - Đọc text các file nguồn trong graph, khẳng định không có `from "react"` và `@paperclipai/plugin-sdk`.
- [ ] **Step 2: Đỏ. Step 3: Cài. Step 4: Xanh.** Kiểm thêm trong worktree `ds`: `corepack pnpm --filter @crew/paperclip-web exec tsc --noEmit` import được (Trợ Lý chạy sau khi ff).
- [ ] **Step 5: Commit** `feat(crew-plugin): export logic map, docs, máy, đính kèm cho UI Crew`.
