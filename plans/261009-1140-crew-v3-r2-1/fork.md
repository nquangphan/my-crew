# Crew v3 R2-1: gói `plugin` (PG-1, PG-2), `policy` (PL-1), `ops` (DP-1) trong fork Paperclip, kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vai trò reviewer/integrator theo project lưu trong DB plugin `crew.core`, ghi được bằng board API key qua route plugin. Gate H2/H4 trong `server/src/crew/` đọc vai trò theo `issue.projectId`, không có thì dùng file company như hôm nay. Thẻ máy hiện phiên bản app. Bản này deploy lên `crew.2p-solutions.com` với tag `crew/v3.1`.

**Architecture:** Không thêm hook, không sửa lõi.
- Plugin thêm migration trong namespace của nó, khai `apiRoutes` (`auth: "board"`) và cài `onApiRequest` trong worker.
- Server đọc bảng plugin trong `server/src/crew/project-roles.ts` bằng SQL thô trên namespace `derivePluginDatabaseNamespace("crew.core")`, có kiểm `to_regclass` trước để không làm hỏng transaction của H2 khi bảng chưa có.
- Deploy theo `crew/ops/deploy.sh` như R1-5.

**Tech Stack:** Fork `.worktrees/paperclip-v3` nền `v2026.1005.0`, Express, Drizzle (`sql` template), plugin SDK (`onApiRequest`, `ctx.db.query/execute`), Vitest + Postgres nhúng (`server/src/__tests__/helpers/embedded-postgres.ts`), `crew/release/verify.sh`.

**Spec:** [plan.md](plan.md) (Global Constraints, Review Focus 3, Interface I7, I8, lệch spec số 1 và 2) và spec §9 "Báo phiên bản lên web", §10, §14 (đổi logic đọc vai trò), §16 Q1.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng ba gói này:

- Không sửa file ngoài `server/src/crew/**`, `server/src/__tests__/crew-*`, `packages/crew-plugin/**`. `node crew/release/check-core-hooks.mjs` vẫn 5/5, `core-hooks.json` `base` vẫn `v2026.1005.0`.
- Không chạy `crew/release/upgrade.sh`.
- Test Postgres nhúng: kiểm `ipcs -m` trước, chạy một file một lúc, không chạy cùng build Electron.
- Bảng plugin chỉ tạo qua `migrations/` của plugin. Không sửa migration đã áp (`0001`–`0003`).
- Hành vi company/project R1 không đổi: không có dòng vai trò thì mọi quyết định gate giống hệt hôm nay (test so sánh).
- Deploy chỉ khi `active-runs.sh` rỗng; theo đúng mã thoát của `deploy.sh`; hỏng thì `rollback.sh <TS>`.

---

### Task 1 (PG-1): Bảng `crew_project_roles` và route vai trò

**Files:**
- Create: `packages/crew-plugin/migrations/0004_project_roles.sql`, `packages/crew-plugin/src/roles/{data.ts,api.ts}`, `packages/crew-plugin/src/__tests__/roles.db.test.ts`
- Modify: `packages/crew-plugin/src/manifest.ts` (capability `api.routes.register`, mảng `apiRoutes`), `packages/crew-plugin/src/worker.ts` (một dòng `onApiRequest: handleRolesApi`)

**Interfaces:**
- Consumes: `ctx.db.namespace`, `ctx.db.query`, `ctx.db.execute` (mẫu ở `src/machines/webhook.ts`, `src/shared/db.ts`); bảng lõi được đọc `agents`, `projects` (đã có trong `coreReadTables`).
- Produces: I7 (DDL, ba route, `ProjectRoles`).

- [ ] **Step 1: Migration** đúng DDL ở plan.md I7 (namespace viết cứng `plugin_crew_core_0433ea20b6` như `0002_machines.sql`), thêm `CREATE INDEX crew_project_roles_company_idx ON plugin_crew_core_0433ea20b6.crew_project_roles (company_id);`.
- [ ] **Step 2: Manifest**

```ts
apiRoutes: [
  { routeKey: "roles.get", method: "GET", path: "/projects/:projectId/roles", auth: "board",
    capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } },
  { routeKey: "roles.set", method: "POST", path: "/projects/:projectId/roles", auth: "board",
    capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
  { routeKey: "roles.delete", method: "DELETE", path: "/projects/:projectId/roles", auth: "board",
    capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } },
],
```

  và thêm `"api.routes.register"` vào `capabilities`.
- [ ] **Step 3: Test DB** (`roles.db.test.ts`, theo khuôn `machines.test.ts`/`docs.db.test.ts`):
  1. `roles.set` hợp lệ (4 agent của company, project của company) → `200 { roles }`; `roles.get` trả đúng; set lần hai thay dòng (upsert), `updated_by_user_id` = `actor.userId`.
  2. Agent thuộc company khác → `400`, body `{ error: 'agent <id> không thuộc company' }`, bảng không đổi.
  3. Project thuộc company khác → `400`.
  4. `reviewerAgentId === integratorAgentId` → `400`; `executorAgentIds` rỗng hoặc 3 phần tử → `400`; một id ở hai vai trò → `400`.
  5. `actor.actorType === 'agent'` → `403` (phòng khi host đổi luật `auth`).
  6. `roles.delete` → `200 { deleted: true }`, lần hai `{ deleted: false }`; `roles.get` sau đó `{ roles: null }`.
  7. Body thiếu trường hay id không phải uuid → `400`, không chạm DB.
- [ ] **Step 4: Cài** `src/roles/data.ts` (`readProjectRoles`, `upsertProjectRoles`, `deleteProjectRoles`; SQL có tham số, tên bảng ghép từ `namespace` đã kiểm như `shared/db.ts`), `src/roles/api.ts` (`handleRolesApi(ctx, input: PluginApiRequestInput): Promise<PluginApiResponse>`, rẽ theo `routeKey`; kiểm company qua `SELECT company_id FROM agents/projects`).
- [ ] **Step 5: Kiểm.** Run: `corepack pnpm --filter @crew/paperclip-plugin exec vitest run src/__tests__/roles.db.test.ts src/__tests__/registry.test.ts && corepack pnpm --filter @crew/paperclip-plugin exec tsc --noEmit && node packages/crew-plugin/build.mjs` → PASS.
- [ ] **Step 6: Commit** (nhánh `crew/r21-plugin`).

```bash
git add packages/crew-plugin
git commit -m "feat(crew-plugin): vai trò agent theo project và route ghi vai trò"
```

---

### Task 2 (PG-2): Trường `app` trong bản tin máy và thẻ máy

**Files:**
- Modify: `packages/crew-plugin/src/machines/{webhook.ts,data.ts}`, `packages/crew-plugin/src/ui/machines/**`, `src/__tests__/{webhook,machines}.test.ts`

**Interfaces:**
- Consumes: I8.
- Produces: `MachineReport.app?: { version: string; sshdOwner: 'app' | 'launchd'; updateState: string }`; dữ liệu `crew.machines` có `app` cho từng máy.

- [ ] **Step 1: Test webhook.**
  - Bản tin không có `app` → hợp lệ như cũ.
  - Có `app` hợp lệ → ghi, `report.app` giữ nguyên.
  - Có `app` mà `version` dài 33 ký tự, `sshdOwner: 'x'`, `updateState: 'lạ'`, hay có key lạ trong `app` → handler ném, host 502, delivery `failed`, DB không đổi (cùng khuôn 5 ca từ chối hiện có).
- [ ] **Step 2: Cài.** `parseMachineReport` cho phép key tùy chọn `app` (giữ kiểm chặt các key bắt buộc), kiểm theo I8. Thẻ máy: dòng "App 2P Crew <version> · sshd do app giữ / LaunchAgent · <trạng thái cập nhật tiếng Việt>"; không có `app` thì "Chạy bằng CLI". Nhãn `updateState`:

| Giá trị | Nhãn |
|---|---|
| `idle` | Đã cập nhật |
| `downloading` | Đang tải bản mới |
| `waiting-idle` | Chờ máy rảnh để cài |
| `installing` | Đang cài |
| `probation` | Đang thử bản mới |
| `rolled-back` | Đã quay về bản trước |

- [ ] **Step 3: Kiểm + commit.** Run: `corepack pnpm --filter @crew/paperclip-plugin exec vitest run src/__tests__/webhook.test.ts src/__tests__/machines.test.ts && corepack pnpm --filter @crew/paperclip-plugin exec tsc --noEmit` → PASS.

```bash
git add packages/crew-plugin
git commit -m "feat(crew-plugin): thẻ máy hiện phiên bản app 2P Crew"
```

---

### Task 3 (PL-1): Gate đọc vai trò theo project

**Files:**
- Create: `server/src/crew/project-roles.ts`, `server/src/__tests__/crew-project-roles.test.ts`, `server/src/__tests__/crew-project-roles.db.test.ts`
- Modify: `server/src/crew/issue-gate.ts` (l.301, l.311: dùng `loadCrewRoles`), `server/src/crew/issue-create-policy.ts` (l.126), `server/src/crew/issue-policy.ts` (export kiểu nếu cần, không đổi `loadCrewCompanyConfig`)

**Interfaces:**
- Consumes: `loadCrewCompanyConfig(companyId)`, `CrewCompanyConfig`, `CrewRoles` (`issue-policy.ts`); `derivePluginDatabaseNamespace` (`server/src/services/plugin-database.ts`, chỉ import); DDL I7.
- Produces:

```ts
export const CREW_PLUGIN_KEY = "crew.core";
export function crewRolesTable(): string; // `${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.crew_project_roles`
export async function loadCrewRoles(input: {
  db: Pick<Db, "execute">;           // tx của H2 hoặc db của H4
  companyId: string;
  projectId: string | null | undefined;
}): Promise<CrewCompanyConfig>;
export async function loadCompanyRoleAgentIds(input: { db: Pick<Db, "execute">; companyId: string }): Promise<Set<string>>;
```

  `loadCompanyRoleAgentIds` = reviewer/integrator trong file company ∪ mọi dòng của company trong bảng (dùng cho kiểm `crew_role_assignee`: không giao việc cho bất kỳ agent reviewer/integrator nào của company).

- [ ] **Step 1: Test thuần** (`crew-project-roles.test.ts`, `db` giả ghi lại SQL):
  1. `crewRolesTable()` = `plugin_crew_core_0433ea20b6.crew_project_roles` (khớp tên trong `packages/crew-plugin/migrations/0002_machines.sql`).
  2. Config file `absent` → trả `absent`, không chạy SQL nào.
  3. `projectId` null → trả config file nguyên vẹn, không SQL.
  4. `to_regclass` trả null (bảng chưa có) → trả config file, chỉ đúng một câu SQL (`SELECT to_regclass(...)`), không có câu `SELECT … FROM …crew_project_roles` (tránh lỗi `42P01` làm hỏng transaction của H2).
  5. Có dòng → `kind: 'ok'`, `roles` = `{ reviewerAgentId, integratorAgentId }` của dòng (chữ thường), `ownerUserId` và `trackingProjectIds` giữ từ file.
  6. Config file `invalid` → trả `invalid` (fail closed như cũ), không SQL.
  7. `execute` ném lỗi khác → trả config file, log cảnh báo tối đa một lần mỗi 60 giây cho mỗi company.
- [ ] **Step 2: Test DB** (`crew-project-roles.db.test.ts`, khuôn `crew-issue-gate.db.test.ts`, chạy migration `0004` vào DB nhúng):
  1. **Round-trip:** ghi dòng vai trò cho project P2 (reviewer R2, integrator I2) → issue gốc board tạo trong P2 nhận `executionPolicy` có stage reviewer R2, integrator I2 (H4 `crewBeforeIssueCreate`); issue trong project P1 (không có dòng) nhận reviewer/integrator của file.
  2. **H2:** agent executor của P2 `PATCH status=done` khi chưa đủ stage → `422`; R2 duyệt stage reviewer được; R1 (reviewer của file) duyệt stage của issue P2 → bị từ chối như agent không phải participant (hành vi hiện có của gate với participant sai).
  3. **Không đổi hành vi P1:** chạy lại các ca chính của `crew-issue-gate.db.test.ts` trên project không có dòng → kết quả giống hệt (gọi chung helper, không chép kỳ vọng).
  4. **Giao việc:** agent giao issue cho I2 → `422 crew_role_assignee`, cả khi issue thuộc P1.
  5. **Bảng chưa migrate:** DB không có `0004` → H2/H4 chạy như hôm nay, transaction không bị abort (ghi issue thành công).
- [ ] **Step 3: Cài** `project-roles.ts`:

```ts
import { sql } from "drizzle-orm";
import { derivePluginDatabaseNamespace } from "../services/plugin-database.js";
import { type CrewCompanyConfig, loadCrewCompanyConfig } from "./issue-policy.js";

export const CREW_PLUGIN_KEY = "crew.core";
export function crewRolesTable(): string {
  return `${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.crew_project_roles`;
}

export async function loadCrewRoles(input: { db: Pick<Db, "execute">; companyId: string; projectId: string | null | undefined }): Promise<CrewCompanyConfig> {
  const config = await loadCrewCompanyConfig(input.companyId);
  if (config.kind !== "ok" || !input.projectId) return config;
  try {
    const table = crewRolesTable();
    const exists = await input.db.execute(sql`SELECT to_regclass(${table}) IS NOT NULL AS ok`);
    if (!rowsOf(exists)[0]?.ok) return config;
    const rows = rowsOf(await input.db.execute(sql`SELECT reviewer_agent_id, integrator_agent_id FROM ${sql.raw(table)}
      WHERE company_id = ${input.companyId} AND project_id = ${input.projectId} LIMIT 1`));
    const row = rows[0];
    if (!row) return config;
    return { ...config, roles: {
      reviewerAgentId: String(row.reviewer_agent_id).toLowerCase(),
      integratorAgentId: String(row.integrator_agent_id).toLowerCase(),
    } };
  } catch (error) {
    warnOncePerMinute(input.companyId, error);
    return config;
  }
}
```

  `rowsOf` chuẩn hóa kết quả `execute` (mảng hoặc `{ rows }`) như các file `server/src/crew/*` đang làm; `warnOncePerMinute` dùng logger của `issue-policy.ts`.
  - `issue-gate.ts` l.311: `loadCrewRoles({ db: tx, companyId: locked.companyId, projectId: locked.projectId })`.
  - Kiểm `crew_role_assignee` dùng `loadCompanyRoleAgentIds`.
  - `issue-create-policy.ts` l.126: `loadCrewRoles({ db: input.db, companyId: input.companyId, projectId: input.data.projectId })`.
  - `agent-config-gate.ts` giữ nguyên (chỉ cần biết company có bật gate hay không).
- [ ] **Step 4: Kiểm.** Run (lần lượt, kiểm `ipcs -m` trước):

```bash
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-project-roles.test.ts
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-project-roles.db.test.ts
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-create-policy.test.ts
corepack pnpm --filter @paperclipai/server exec tsc --noEmit
node crew/release/check-core-hooks.mjs
```

  Expected: PASS; check-core-hooks báo 5 hook đủ mốc.
- [ ] **Step 5: Commit** (nhánh `crew/r21-policy`).

```bash
git add server/src/crew server/src/__tests__/crew-project-roles.test.ts server/src/__tests__/crew-project-roles.db.test.ts
git commit -m "feat(crew): gate đọc vai trò reviewer và integrator theo project"
```

---

### Task 4 (DP-1): Gộp, kiểm, deploy `crew/v3.1`

**Files:**
- Modify: `plans/261009-1140-crew-v3-r2-1/{sdd-ledger.md,processes.md}` (repo Crew)

**Interfaces:**
- Consumes: nhánh `crew/r21-plugin` (PG-1, PG-2), `crew/r21-policy` (PL-1).
- Produces: image `v3-<sha9>` chạy trên VPS; tag `crew/v3.1` (local, push khi owner nói "push"); mốc rollback TS ghi ledger.

- [ ] **Step 1: Gộp** cả hai vào `crew/r2-1` (từ `v3`), giải xung đột nếu có, chạy `crew/release/verify.sh` (một việc nặng). Expected: thoát 0, hook 5/5, test crew server, plugin, agents xanh.
- [ ] **Step 2: Build overlay và deploy** theo đúng lệnh R1-5 dùng (`crew/ops/overlay-source.sh`, `overlay-job.sh`, rồi trên VPS `/opt/crew-v3-spike/ops/deploy.sh <image>`). Chép script sang VPS rồi chạy; lệnh con `</dev/null` (bẫy stdin ở ledger R1-5). Trước deploy: `active-runs.sh` rỗng.
- [ ] **Step 3: Kiểm sau deploy.**
  - `deploy.sh` in `plugin crew.core healthy` và `deploy ok … rollback TS=<TS>`.
  - `curl -s https://crew.2p-solutions.com/api/health` `status ok`.
  - `curl -s -o /dev/null -w '%{http_code}' https://2p-solutions.com` và `https://kidyschool.com` = `200`.
  - Migration `0004` `applied` (`plugin-state.sh` hoặc bảng migration của plugin).
  - Bằng key board tạm (cách R1-5 cổng 2):
    - `GET /api/plugins/crew.core/api/projects/<P>/roles?companyId=<C>` → `{ roles: null }`.
    - `POST` với reviewer = integrator → `400`.
    - Thu hồi key tạm.
  - Gửi một bản tin máy có `app` hợp lệ từ Mac (`crew-mac status` bản MC-3 chạy từ worktree) → 200, thẻ máy hiện "App 2P Crew …". Bản tin không `app` (LaunchAgent hiện tại) vẫn 200.
  - Một issue `repo-a` nhỏ đi qua H4 có policy như cũ (đọc `executionPolicy` qua API, không cần chạy agent).
- [ ] **Step 4: Tag và ghi.** `git -C .worktrees/paperclip-v3 tag crew/v3.1 crew/r2-1`. Ghi ledger: sha, image, backup, rollback TS, kết quả từng kiểm. Hỏng ở bất kỳ kiểm nào: `rollback.sh <TS>`, ghi lý do, mở ticket sửa ở gói sở hữu.

```bash
git add plans/261009-1140-crew-v3-r2-1/sdd-ledger.md plans/261009-1140-crew-v3-r2-1/processes.md
git commit -m "docs(v3): ghi deploy crew/v3.1 vai trò theo project"
```
