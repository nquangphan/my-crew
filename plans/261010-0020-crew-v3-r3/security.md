# Crew v3 R3: gói `security` (SEC-1, SEC-2), kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent của company Crew không làm được những việc phá bất biến của Crew:
- tạo agent;
- tạo/sửa skill;
- tạo project trơn;
- sửa vai trò, sửa cấu hình ghim;
- hủy issue;
- giao việc sai vai trò.

Trợ Lý vẫn giao việc cho executor được. Mọi route ghi mà token agent gọi được đều đã truy tới dòng kiểm quyền.

**Architecture:**
- SEC-1 chỉ đọc code, ra bảng quyết định.
- SEC-2 sửa theo thứ tự ưu tiên (spec §4.11):
  - (a) quyền/grant qua REST board (script ops);
  - (b) mở rộng thân hook H2/H4/H5 trong `server/src/crew/**`;
  - (c) plugin phát hiện rồi trả lại;
  - (d) cần sửa lõi thì dừng, chờ owner;
  - (e) chấp nhận kèm lý do.
- Không thêm hook, không sửa route lõi.

**Tech Stack:** Fork server Express + Drizzle (đọc), `server/src/crew/*` (TypeScript, Vitest + Postgres nhúng như `crew-*.test.ts`), plugin SDK (events), bash + `node --test` cho script ops.

**Spec:** [plan.md](plan.md) (Global Constraints, Lệch 3, Interface I9), spec §2 (bằng chứng `canCreateAgents` → `canAssignTasks`), §4.11, §5 ý 6, AC7.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng gói này:

- SEC-1 không sửa file nguồn nào. Chỉ ghi `plans/261010-0020-crew-v3-r3/reports/sec-1-authz.md`.
- SEC-2 chỉ ghi:
  - `crew/ops/agent-permissions.{sh,test.mjs}`;
  - `server/src/crew/**`, `server/src/__tests__/crew-*`;
  - plugin `src/security/**` + một dòng `worker.ts`/`features.ts` + capability `manifest.ts`;
  - `crew/release/core-hooks.json` (chỉ `description`).
- `node crew/release/check-core-hooks.mjs` vẫn đủ 5 mốc.
- Không gọi API ghi trên prod trong SEC-1/SEC-2. Áp quyền lên prod ở DP-1 bằng script của SEC-2.

---

### Task 1 (SEC-1): Truy authz

**Files:**
- Create: `plans/261010-0020-crew-v3-r3/reports/sec-1-authz.md`

- [ ] **Step 1: Xác định actor agent.** Đọc middleware auth (`server/src/middleware/*auth*`, `server/src/routes/authz.ts`) và ghi:
  - token nào thành `req.actor.type === 'agent'` (run JWT bridge, agent API key);
  - `assertCompanyAccess`, `assertBoard`, `assertBoardOrgAccess`, `assertAuthenticated` cho agent qua hay không.
- [ ] **Step 2: Liệt kê route ghi.** `grep -nE "router\.(post|put|patch|delete)\(" server/src/routes/*.ts` → danh sách đầy đủ (file:dòng, method, path). Mỗi route đọc tới dòng kiểm quyền đầu tiên và ghi:
  - agent gọi được không;
  - điều kiện (cùng company, quyền `canCreateAgents`, grant, self-only…);
  - hook Crew nào chạy trên đường đó (H2 `beforeIssueWrite`, H4 `beforeIssueCreate`, H5 `beforeAgentMutation`; xem `server/src/crew/core-hooks.ts` để biết điểm gọi).
- [ ] **Step 3: Bắt buộc phủ các nhóm** (spec §4.11). Mỗi nhóm có ít nhất một dòng kết luận:
  - project: tạo, sửa, archive, xóa;
  - workspace (xóa, đóng), `inbox-archive`, `/children`, xóa attachment, adapters, goals;
  - agents: tạo, permissions, keys, instructions bundle của agent **khác**, terminate, pause/resume, wakeup agent khác;
  - environments, secrets;
  - company skills: tạo, sync cho agent khác, skill-sources;
  - routines, labels, approvals, company settings, plugin routes, heartbeat-runs cancel.
- [ ] **Step 4: Đánh giá rủi ro với bất biến Crew.** Bất biến:
  - agent không đổi cổng của mình (vai trò, policy, cấu hình ghim);
  - mọi việc đi qua Trợ Lý của project;
  - agent không tạo thực thể mới ngoài issue con được phép;
  - agent không đọc/ghi company khác;
  - credential không lộ.

  Mỗi route agent gọi được và chạm bất biến thì chọn (a)–(e), ghi lý do và cách kiểm. Với `canCreateAgents`: ghi rõ `agents.ts:1596-1625` (`agent_creator` → `canAssignTasks`) và cách giữ quyền giao việc của Trợ Lý (grant `tasks:assign` qua `PATCH /agents/:id/permissions`, body theo `agents.ts:4946-4975`).
- [ ] **Step 5: Danh sách ca âm** cho E2E (token agent của Crew E2E). Mỗi ca ghi: route, body, mã trả mong đợi, cách kiểm DB không đổi.
- [ ] **Step 6: Tóm tắt đầu báo cáo:**
  - số route đã truy;
  - số route agent gọi được;
  - số mục cần sửa theo từng loại (a)/(b)/(c)/(d)/(e);
  - mục (d) nêu rõ để Trợ Lý báo owner.

  Không commit (plans do Trợ Lý commit ở repo Crew).

---

### Task 2 (SEC-2): Sửa quyền

**Files (tùy kết quả SEC-1; luôn có dòng 1):**
1. Create `crew/ops/agent-permissions.sh`, `crew/ops/agent-permissions.test.mjs`.
2. Nếu có mục (b): Modify `server/src/crew/<hook-file>.ts`, Create `server/src/__tests__/crew-<tên>.test.ts`, Modify `crew/release/core-hooks.json` (`description` hook liên quan).
3. Nếu có mục (c): Create plugin `src/security/{project-created.ts,index.ts}`, `src/__tests__/security-project-created.db.test.ts`; Modify `src/features.ts` (một dòng), `src/manifest.ts` (capability cần thiết, ví dụ `events.subscribe` đã có, `projects.update` nếu SDK có).

**Interfaces:**
- Consumes: `reports/sec-1-authz.md`; I9 (`CREW_AGENT_PERMISSIONS`, `ASSISTANT_GRANTS`); `crew/ops/api.sh` trên VPS (shim curl có board key, như DP-3 R2-1); `policy-config.py list` (company Crew).
- Produces:
  - `agent-permissions.sh <companyId|--all-crew> [--dry-run]`: với mỗi agent `claude_local` của company Crew, đặt `canCreateAgents=false`, `canCreateSkills=false`; với agent là `assistantAgentId` của bất kỳ project nào (roles route), hoặc là assistant trong `CREW_POLICY_CONFIG`, thêm grant `tasks:assign`.
  - In bảng `agentId8 tên trước→sau`, không in token. Body đi qua stdin của `api.sh`. Idempotent.

- [ ] **Step 1: Test script (đỏ)** `agent-permissions.test.mjs` (`node --test`, `api.sh` giả là script ghi lại stdin/đối số vào file tạm, trả JSON cố định):
  - 3 agent (assistant, executor, reviewer), trong đó assistant đang có `canCreateAgents=true` → 3 lời gọi `PATCH /agents/:id/permissions` có `canCreateAgents:false, canCreateSkills:false`, chỉ assistant có `canAssignTasks:true` (hoặc key grant đúng theo SEC-1).
  - `--dry-run` → 0 lời gọi ghi.
  - Chạy lần hai khi đã đúng → 0 lời gọi ghi.
  - Đối số `ssh`/`api.sh` không chứa body.
- [ ] **Step 2: Test hook (đỏ), nếu có mục (b).** Ví dụ: mở rộng H5 `beforeAgentMutation` để từ chối agent tạo agent mới trong company Crew dù có `canCreateAgents`. Test theo mẫu `server/src/__tests__/crew-*.test.ts` có sẵn:
  - actor agent company Crew → 422 mã `crew_agent_create_forbidden`;
  - actor board → cho;
  - company ngoài cấu hình → hành vi stock.

  Chỉ làm nếu SEC-1 xác nhận đường tạo agent đi qua H5.
- [ ] **Step 3: Test plugin (đỏ), nếu có mục (c).** Project do actor agent tạo trong company Crew:
  - plugin nhận sự kiện `project.created` (đọc tên sự kiện thật trong `packages/shared` hoặc plugin SDK events);
  - đặt `archivedAt` qua client SDK (nếu SDK không có client sửa project thì đổi mục này sang (d) và ghi ledger);
  - ghi log `crew.security.project_archived` kèm `projectId`, `agentId`.

  Project do board tạo → không làm gì.
- [ ] **Step 4: Chạy, đỏ. Step 5: Cài. Step 6: Xanh.**
  - `node --test crew/ops/agent-permissions.test.mjs`;
  - test server/plugin từng file (kiểm `ipcs -m`);
  - `node crew/release/check-core-hooks.mjs` đủ 5;
  - `biome`/`tsc` file đổi.
- [ ] **Step 7: Commit** từng phần riêng:
  - `feat(ops): script tắt quyền tạo agent/skill của agent Crew và giữ quyền giao việc của Trợ Lý`;
  - `fix(crew): chặn agent tạo agent trong company Crew` (nếu có);
  - `fix(crew-plugin): lưu trữ project do agent tạo trong company Crew` (nếu có).
- [ ] **Step 8: Bàn giao DP-1.** Ghi ledger lệnh áp:
  1. `agent-permissions.sh --all-crew --dry-run`;
  2. `agent-permissions.sh --all-crew`;
  3. kiểm `GET /agents/<tro-ly>` có `taskAssignSource` = `explicit_grant`.

  Ghi thêm danh sách ca âm cho E2E-4.
