---
title: "Crew v3 R3X — Ép Done, sửa/xóa skill, gỡ agent/project trên web"
description: "Ba việc owner thêm vào R3 sáng 10/10: nút Ép Done có lý do (route plugin + mở rộng thân H2, lịch sử issue), sửa/xóa skill trên trang Skills (gỡ khỏi agent, bỏ chọn ở nguồn, dọn bản chép trên Mac bằng việc máy skill-remove), gỡ project/agent trên web (pause, archive environment và project, dọn checkout bằng việc máy remove-checkouts, không DELETE). Chạy trên nhánh R3, sau khi vá lõi CORE-P gộp."
status: pending
priority: P1
effort: 4d
branch: r3
fork_branch: crew/r3
tags: [crew-v3, ui, crew-plugin, mac-app, machine-jobs, gate, skills]
created: 2026-10-10
---

# Crew v3 R3X — Ép Done, sửa/xóa skill, gỡ agent/project — Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner ép đóng được yêu cầu đang kẹt (có lý do, hiện trong lịch sử), sửa và xóa skill trên web, gỡ project và
agent trên web mà không mất dữ liệu.

**Architecture:**
- Ép Done đi qua **route plugin** `POST /issues/:issueId/force-done` gọi `ctx.issues.update` (bỏ qua transition của route
  stock, H2 vẫn ghi `board_override`). Thân H2 thêm một chỗ: xóa `executionState` khi board ép vào `done`.
- Sửa/xóa skill và gỡ project/agent chạy trong trình duyệt bằng REST stock (phiên owner). Phần trên Mac đi qua hàng đợi
  việc máy với hai `kind` mới. Gỡ chạy như setup run hai `kind` mới, nên có "Chạy tiếp".
- App 2P Crew thêm hai executor.

**Tech Stack:** như [plan R3](../261010-0020-crew-v3-r3/plan.md) (nằm trên nhánh `v3`).

**Spec:** [2026-10-10-crew-v3-r3x-design.md](../../docs/superpowers/specs/2026-10-10-crew-v3-r3x-design.md). Mã mới:
`S6.17`, `S6.18`, `S14.5`–`S14.7`, `S8.7`, `S11.9`, `F10`; tiêu chí `AX1`–`AX11`.

**Hiện trạng (10/10/2026 07:28, theo `date`):**
- Fork `crew/r3` @ `f569bf4a5` đang chạy prod (DP-1 07:04, tag cục bộ `crew/v3.5-rc1`, mốc rollback `20261010-070026`).
- Repo Crew `r3` @ `94b8dff` (= `r3-mac`).
- Đang chạy song song:
  - **CORE-P** (opus, `.worktrees/paperclip-r3-core`, nhánh `crew/r3-core`): vá lõi D5/D6/D7/D12 và notify→call. D6 làm
    route project chỉ board gọi được — R3X dùng phiên board nên không vướng, nhưng ca âm AX9 phụ thuộc vá này.
  - **DP-2** (opus): cài app/`crew-mac` R3 lên Mac mini.
- AC-A của R3 chưa chạy.

## Global Constraints

Áp dụng toàn bộ Global Constraints của plan R3. Ghi đè hoặc thêm:

- **Đường dẫn fork được đổi** như R3. Thêm: `server/src/crew/issue-gate.ts` và test `server/src/__tests__/crew-issue-gate*`
  chỉ ở SEC-X1 (opus), cập nhật `description` H2 trong `crew/release/core-hooks.json`, không đổi `anchor/head/file`.
- **Không `DELETE`** agent, project, environment. Không `terminate`. Không `git worktree remove --force`, không xóa nhánh,
  không xóa folder gốc. Mọi xóa trên Mac chỉ trong `~/crew-agents/<key>/` và `~/.crew/skills/<companyId>/`, kiểm bằng
  `realpath`.
- **Model:** opus cho cổng, bảo mật, xóa dữ liệu và review: PL-X1, PL-X2, SEC-X1, MC-X1, WK-X1, OR-X1, WZ-X1, RV-X, DP-X1,
  DP-X2, AC-X. sonnet cho việc bám khuôn: DS-X1, OR-X2, E2E-X1. Không Codex, không fable.
- **Phụ thuộc CORE-P:** SEC-X1 (cùng vùng `server/src/crew/**` và `issues.ts`) và WZ-X1 bắt đầu sau khi `crew/r3-core` đã
  gộp vào `crew/r3`. Các ticket khác chạy được ngay.
- **Thử trên prod** chỉ ở company Crew E2E, chế độ stub. Mọi bản ghi thử (issue, skill, project, agent, environment)
  ghi vào [processes.md của R3](../261010-0020-crew-v3-r3/processes.md).
- **Deploy:** plugin (migration mới) trước, cài app sau. Trình tự deploy như R3.
- **Docs repo Crew:** MC-X1 sửa `docs/flows/mac-app-paperclip.md` (flow chứa `apps/mac-app/src/main/jobs/**`), chạy
  `crew-docs check --staged`. File mới vào `docs/flows.yaml` rồi `crew-docs generate`.
- **Commit:** Conventional Commits tiếng Việt, không nhắc AI, không ghi mã ticket/plan trong code, test, commit message.

## Review Focus

1. **Ép Done không được thành Duyệt hay mở workflow.** Ba trạng thái xuất phát (chờ stage của agent, chờ stage approval
   của chính owner, chưa vào stage) đều thành `done`, `executionState = null`, không có decision mới, không run mới của
   reviewer. Test: SEC-X1 (`crew-issue-gate.db.test.ts` 3 ca qua `issueService.update` với actorUserId), PL-X2
   (`force-done.test.ts`), AX1.
2. **Mở rộng H2 không đổi hành vi cũ.** Duyệt đủ 4 stage vẫn 0 override; board ép bằng `PATCH` như cũ; agent vào `done`
   thiếu cổng vẫn `crew_gate_blocked`; rời `done` vẫn xóa state và trả việc. Test: SEC-X1 chạy lại toàn bộ
   `crew-issue-gate*.test.ts`.
3. **Xóa trên Mac không bao giờ ra ngoài gốc cho phép, không mất việc chưa commit.** Test: MC-X1 (`remove-checkouts`:
   checkout bẩn, có process, symlink trỏ ra ngoài, worktree chính, đường đã mất; `skill-remove`: slug `..`, symlink ra
   `~/.crew/workflows`).
4. **Xóa skill không để lại skill "sống lại"** (refresh nguồn) và không để agent trỏ tới skill không còn. Test: OR-X1
   (`delete-skill.test.ts` thứ tự gọi API), AX5.
5. **Không archive environment dùng chung.** Test: WZ-X1 (`exclusive-environments.test.ts`: environment mẫu, environment
   hai agent dùng), AX7.
6. **Chạy tiếp sau lỗi giữa chừng** không làm lại bước đã xong, không pause lại agent đã resume tay. Test: WZ-X1
   (`remove-project.test.ts` ca lỗi ở `checkouts`).

---

## Gói ngữ cảnh

Giữ cách chia gói của plan R3. Mỗi ticket thuộc đúng một gói; trong gói chạy lần lượt, giữa các gói chạy song song.

| Gói | Phạm vi ghi | Nạp chung | Ticket |
|---|---|---|---|
| `plugin` | Fork `packages/crew-plugin/**` | Spec R3X §4.1, §4.6; plugin `src/{manifest.ts,worker.ts}`, `src/jobs/{types,validate,api,data}.ts`, `src/setup/{api,data}.ts`, `src/skills/sync-data.ts`, `src/roles/api.ts` (khuôn kiểm actor), `migrations/0006*,0007*,0009*`; SDK `packages/plugins/sdk/src/types.ts:1395-1560`; `server/src/services/plugin-host-services.ts:1930-1990` | PL-X1, PL-X2 |
| `security` | Fork `server/src/crew/issue-gate.ts`, `server/src/__tests__/crew-issue-gate*`, `crew/release/core-hooks.json` (`description`) | Spec R3X §2.1, §4.1; `server/src/crew/{core-hooks,issue-gate}.ts`; `server/src/services/issue-execution-policy.ts:660-1050`; `server/src/routes/issues.ts:13100-13160` | SEC-X1 |
| `mac` | Repo Crew `apps/mac-app/src/main/jobs/**`, `apps/mac-app/test/jobs/**`, `docs/flows/mac-app-paperclip.md`, `docs/flows.yaml`, `docs/files.md` | Spec R3X §4.6; `apps/mac-app/src/main/jobs/*`, `projects/{remove-project,folder,progress}.ts`, `ops-bridge.ts` | MC-X1 |
| `ds` | Fork `packages/crew-web/src/api/**`, `test/api/**` | Spec R3X §4.7; `src/api/{endpoints.ts,http.ts,queryKeys.ts}`, `src/api/paperclip/{skills,issues,agents,projects,environments}.ts`, `src/api/crew/*` | DS-X1 |
| `work` | Fork `packages/crew-web/src/features/issues/**`, `test/features/issues/**` | Spec R3X §4.1; `features/issues/detail/{issue-page,properties-panel}.tsx`, `detail/crew/*`; `src/ds/index.ts` (chỉ đọc) | WK-X1 |
| `org` | Fork `packages/crew-web/src/features/{skills,projects,agents,guide}/**`, `test/features/{…}/**` | Spec R3X §4.2–4.5; `features/skills/*`, `features/projects/detail/project-page.tsx`, `features/agents/{list,detail}/*`, `features/guide/missing-features.ts` | OR-X1, OR-X2 |
| `wizards` | Fork `packages/crew-web/src/features/wizards/**`, `test/features/wizards/**` | Spec R3X §4.4–4.6; `features/wizards/{setup-progress.tsx,resume.ts,add-project/*}`, `features/projects/detail/use-save-roles.ts`, `features/readiness/*` (chỉ đọc) | WZ-X1 |
| `e2e` | Fork `packages/crew-web/e2e/**` | Spec R3X §5; `e2e/support/*`, `e2e/coverage.json`, `e2e/ba-ids.json` | E2E-X1 |
| `ops` | VPS qua `crew/ops/*`; Mac mini | Ledger R3 DP-1, DP-2 | DP-X1, DP-X2 |

## Ticket

| ID | Việc | Gói | Phụ thuộc | Model | Ước |
|---|---|---|---|---|---|
| PL-X1 | Migration `0011` (hai `kind` việc máy, hai `kind` setup run), types + validate payload/result, `setup-runs` nhận `kind` và bước mới, `crew.skillSync` bỏ cặp đã `skill-remove` | `plugin` | — | opus | 0,4d |
| SEC-X1 | Thân H2: xóa `executionState` khi board ép vào `done`; test 3 trạng thái + hồi quy; `description` H2 | `security` | CORE-P gộp | opus | 0,3d |
| MC-X1 | App: executor `remove-checkouts`, `skill-remove`; validate; xóa tiến độ `app.json`; docs flow | `mac` | IX1 chốt (có trong plan) | opus | 0,5d |
| PL-X2 | Route `force-done` (IX3), capability `issue.comments.create_human_attributed`, `issues.wakeup`; đánh thức cha | `plugin` | PL-X1 | opus | 0,4d |
| DS-X1 | `endpoints.ts` + client + kiểu (spec §4.7, IX5) | `ds` | IX1–IX3 chốt | sonnet | 0,3d |
| WK-X1 | S6.17 nút + dialog Ép Done, S6.18 Lịch sử, badge "Đã ép Done", ẩn thẻ câu hỏi khi issue đã đóng | `work` | DS-X1 | opus | 0,5d |
| OR-X1 | S14.5–S14.7: sửa thông tin/nội dung, cập nhật từ nguồn, tạo bản sửa được, xóa skill, khối skill ghim chỉ đọc | `org` | DS-X1 | opus | 0,6d |
| WZ-X1 | Runner `remove-project`, `remove-agent` (setup run, chạy tiếp), điều kiện gỡ agent, chọn environment riêng; export `RemoveProjectButton`, `RemoveAgentButton`, `removalState` | `wizards` | DS-X1, PL-X1, CORE-P gộp | opus | 0,6d |
| OR-X2 | Gắn nút gỡ ở S8/S11, bộ lọc "Đã gỡ", banner project đã gỡ, Hướng dẫn VI/EN (bỏ "không có nút gỡ/ép/xóa skill", thêm mục mới) | `org` | OR-X1, WZ-X1, WK-X1 | sonnet | 0,3d |
| E2E-X1 | Spec Playwright AX1–AX10, ca âm bằng token agent, `coverage.json` + `ba-ids.json` thêm mã mới | `e2e` | OR-X2, MC-X1 | sonnet | 0,5d |
| RV-X | Review diff R3X hai repo theo Review Focus; full suite như RV-1 | — | mọi ticket code | opus | 0,2d |
| DP-X1 | Deploy fork (migration `0011`, plugin, web), mốc rollback, tag cục bộ `crew/v3.5-rcN` kế tiếp | `ops` | RV-X | opus | 0,2d |
| DP-X2 | Cài app mới lên Mac mini (0 run active, giữ bản cũ) | `ops` | DP-X1 | opus | 0,1d |
| AC-X | T2 trên Crew E2E: AX1–AX10 (AX11 ở RV-X), dọn bản ghi thử | — | DP-X2, E2E-X1 | opus | 0,3d |

**Tổng:** 14 ticket (10 code, 1 review, 2 deploy, 1 nghiệm thu), khoảng **4 ngày công**. Có thể gộp đợt deploy/nghiệm
thu với AC-A của R3 nếu hai bên xong cùng lúc (Trợ Lý quyết, ghi ledger).

### Đợt chạy

| Đợt | Ticket | Ghi chú |
|---|---|---|
| 0 | PL-X1 ∥ MC-X1 ∥ DS-X1 | Hợp đồng IX1–IX5 đã chốt ở plan nên ba gói chạy song song. PL-X1 dùng Postgres nhúng: không chạy cùng test DB khác |
| 1 | PL-X2 ∥ WK-X1 ∥ OR-X1 ∥ (SEC-X1, WZ-X1 khi CORE-P đã gộp) | |
| 2 | OR-X2 → E2E-X1 | |
| 3 | RV-X → DP-X1 → DP-X2 → AC-X | 0 run active khi deploy/cài |

### Nhánh và worktree

- Fork: dùng lại worktree gói của R3 (`.worktrees/paperclip-r3-{plugin,security,ds,work,org,wizards,e2e,ops}`, nhánh
  `crew/r3-<gói>`). Mỗi ticket bắt đầu bằng `git merge --ff-only crew/r3` (không ff được thì `git merge crew/r3`, không
  rebase). Trợ Lý ff gói vào `crew/r3` sau khi đọc log test.
- Repo Crew: `.worktrees/crew-r3-mac` nhánh `r3-mac`, ff vào `r3`.

### Sở hữu file

| Ticket | Ghi |
|---|---|
| PL-X1 | Plugin `migrations/0011_removal_kinds.sql`, `src/jobs/{types,validate}.ts`, `src/setup/{api,data,types}.ts` (nếu kiểu nằm ở đó), `src/skills/sync-data.ts`, `src/__tests__/{machine-jobs-validate,setup-runs.db,skill-sync.db}.test.ts` |
| PL-X2 | Plugin `src/issues/force-done.ts`, `src/__tests__/force-done.test.ts`, `src/manifest.ts` (route + 2 capability), `src/worker.ts` (định tuyến) |
| SEC-X1 | `server/src/crew/issue-gate.ts`, `server/src/__tests__/crew-issue-gate.db.test.ts`, `crew-issue-gate.test.ts`, `crew/release/core-hooks.json` (`description` H2) |
| MC-X1 | `apps/mac-app/src/main/jobs/{types,validate,executors}.ts`, `src/main/jobs/remove.ts` (mới), `test/jobs/{validate,executors,remove}.test.ts`, `docs/flows/mac-app-paperclip.md`, `docs/flows.yaml`, `docs/files.md` |
| DS-X1 | `src/api/endpoints.ts`, `src/api/paperclip/{issues,skills,skill-sources,environments,projects}.ts`, `src/api/crew/{types,force-done}.ts`, `src/api/queryKeys.ts`, `test/api/*` |
| WK-X1 | `src/features/issues/detail/crew/{force-done.ts,force-done-dialog.tsx,actions-slot.tsx,interactions-slot.tsx}`, `src/features/issues/detail/{history.tsx,history-format.ts,issue-page.tsx,properties-panel.tsx}`, `locales/*.json`, `test/features/issues/{force-done,force-done-dialog,history-format,history}.test.ts(x)` |
| OR-X1 | `src/features/skills/{skill-detail.tsx,edit-skill.tsx,skill-files-editor.tsx,delete-skill.ts,delete-skill-dialog.tsx,update-from-source.tsx,fork-skill-dialog.tsx,pinned-skills.tsx,frontmatter.ts,skills-page.tsx,use-skill-sync.ts}`, `locales/*.json`, `test/features/skills/*` |
| WZ-X1 | `src/features/wizards/remove/{remove-project.ts,remove-agent.ts,eligibility.ts,exclusive-environments.ts,remove-buttons.tsx,removal-state.ts}`, `src/features/wizards/index.ts` (export), `setup-progress.tsx` (nhận kind mới), `locales/*.json`, `test/features/wizards/remove/*` |
| OR-X2 | `src/features/projects/detail/project-page.tsx`, `src/features/projects/list/projects-page.tsx`, `src/features/agents/detail/agent-page.tsx`, `src/features/agents/list/{agents-page,use-status-filter}.ts(x)`, `src/features/guide/**`, locales, test tương ứng |
| E2E-X1 | `e2e/specs/{s6-force-done,s14-skill-edit,s8-remove-project,s11-remove-agent,negative-r3x}.spec.ts`, `e2e/coverage.json`, `e2e/ba-ids.json`, `e2e/support/*` (helper mới nếu cần) |
| RV-X, DP-X*, AC-X | `sdd-ledger.md`, `processes.md` (R3), `reports/{rv-x,ac-x}.md` |

---

## Interface

**IX1. Hai `kind` việc máy** (PL-X1 tạo; MC-X1, WZ-X1, OR-X1 dùng).

```sql
-- packages/crew-plugin/migrations/0011_removal_kinds.sql (số kế tiếp lúc làm; tên constraint xác nhận bằng \d như 0009)
ALTER TABLE plugin_crew_core_0433ea20b6.crew_machine_jobs DROP CONSTRAINT crew_machine_jobs_kind_check;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_machine_jobs ADD CONSTRAINT crew_machine_jobs_kind_check
  CHECK (kind IN ('inspect-folder','prepare-checkouts','agent-workspace','skill-sync','check','remove-checkouts','skill-remove'));
ALTER TABLE plugin_crew_core_0433ea20b6.crew_setup_runs DROP CONSTRAINT crew_setup_runs_kind_check;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_setup_runs ADD CONSTRAINT crew_setup_runs_kind_check
  CHECK (kind IN ('add-project','add-agent','remove-project','remove-agent'));
```

```ts
export type MachineJobKind = 'inspect-folder' | 'prepare-checkouts' | 'agent-workspace' | 'skill-sync' | 'check'
  | 'remove-checkouts' | 'skill-remove';
// JobPayload thêm:
  | { kind: 'remove-checkouts'; projectId: string; projectKey: string; roles: CrewRoleSlot[]; removeStatusRepo: boolean }
  | { kind: 'skill-remove'; skillId: string; slug: string }
// JobResult thêm:
  | { kind: 'remove-checkouts';
      removed: { role: CrewRoleSlot; path: string }[];
      kept: { role: CrewRoleSlot; path: string; reason: 'dirty' | 'busy' | 'not_worktree' | 'git_failed'; detail?: string }[];
      absent: CrewRoleSlot[] }
  | { kind: 'skill-remove'; removed: boolean }
```

- Validate: `projectId` uuid; `projectKey` `KEY_RE`; `roles` 1–5 phần tử, không trùng, thuộc `CrewRoleSlot`;
  `removeStatusRepo` boolean; `skillId` uuid; `slug` `^[a-z0-9][a-z0-9-]{0,63}$`; không key lạ. `detail` qua
  `sanitizeJobError` (≤ 300 ký tự). Kết quả sai dạng → 400 ở `jobs.result` như các kind cũ.
- `crew.skillSync`: tính việc mới nhất theo cặp `(skillId, machineId)` trên cả `skill-sync` và `skill-remove`; mới nhất là
  `skill-remove` `done` thì bỏ cặp; `skill-remove` đang chờ/lỗi thì trả `status` của việc đó kèm `kind`.

**IX2. Setup run gỡ** (PL-X1 tạo; WZ-X1 dùng).

```ts
export type SetupRunKind = 'add-project' | 'add-agent' | 'remove-project' | 'remove-agent';
export type SetupStepId = /* như R3 */
  | 'pause-agents' | 'roles' | 'environments' | 'checkouts' | 'project'                  // remove-project
  | 'pause-agent' | 'environment' | 'checkout';                                           // remove-agent (dùng chung 'roles')
export interface RemoveProjectInput { projectId: string; projectName: string }
export interface RemoveAgentInput { agentId: string; agentName: string; projectId: string | null; role: CrewRoleSlot | null }
```

- `setup.create` với `remove-project`: `projectKey` = khóa project, `projectId` bắt buộc; 409 kèm id nếu đã có run
  `remove-project` chưa `done/abandoned` cho cùng `projectId`. Với `remove-agent`: `projectKey` = khóa project của vai trò,
  hoặc `agent-<8 hex đầu của agentId>` khi agent không giữ vai trò; 409 nếu có run `remove-agent` dở cùng `agentId`.
- Bước cuối: `project` (remove-project), `checkout` hoặc `environment` (remove-agent, tùy có vai trò) → run `done`.
  `setup.finish` đánh dấu run `done` theo danh sách bước của từng kind (plugin giữ danh sách, như add-project).

**IX3. Route Ép Done** (PL-X2 tạo; DS-X1, WK-X1 dùng). Đúng spec §4.1.

| routeKey | Method + path | companyResolution | Body | Trả |
|---|---|---|---|---|
| `issues.forceDone` | `POST /issues/:issueId/force-done` | body `companyId` | `{companyId, reason}` | 200 `{issue, violations, warnings}` · 400 `reason_invalid` · 403 · 404 · 409 `issue_terminal` |

- `violations`: đọc activity `crew.policy.board_override` vừa ghi của issue (cùng transaction không đọc được thì đọc
  sau update, lọc theo `entityId` và mốc thời gian bắt đầu handler). Không đọc được thì `[]` và `warnings:['violations_unread']`.
- Activity `crew.issue.force_done` `details {reason, fromStatus, fromStageId, fromStageType, violations}`.
- `warnings`: `'comment_failed' | 'wakeup_failed' | 'activity_failed' | 'violations_unread'`.

**IX4. Mở rộng thân H2** (SEC-X1).

```ts
// server/src/crew/issue-gate.ts, trong nhánh ghi sau khi có verdict
if (verdict.kind === "override" && enteringDone && !Object.hasOwn(input.patch, "executionState")) {
  input.patch.executionState = null; // như stock khi board ép issue đang chờ stage (issue-execution-policy.ts:912-916)
}
```

Sửa luôn chú thích `issue-gate.ts:42` (giờ có hai chỗ được sửa patch). `description` H2 thêm vế "board override vào
done xóa execution state treo".

**IX5. Client `crew-web`** (DS-X1).

```ts
api.issues.activity(issueId): Promise<ActivityEvent[]>                      // GET /api/issues/:id/activity
api.crew.forceDone(issueId, { companyId, reason }): Promise<ForceDoneResult>
api.skills.update(companyId, skillId, body: UpdateCompanySkillBody)
api.skills.files(companyId, skillId) / readFile(companyId, skillId, path) / writeFile(companyId, skillId, { path, content }) / deleteFile(companyId, skillId, { path, target: 'file' })
api.skills.updateStatus(companyId, skillId) / installUpdate(companyId, skillId, body) / forkPrecheck(companyId, skillId) / fork(companyId, skillId, body)
api.skills.remove(companyId, skillId)
api.skillSources.get(companyId, sourceId) / select(companyId, sourceId, { revision, selectedPaths, excludedFolders })
api.environments.archive(environmentId)                                      // PATCH {status:'archived'} — không có hàm delete
api.projects.archive(projectId)                                              // PATCH {archivedAt: new Date().toISOString()}
```

Tên kiểu body/response lấy từ `@paperclipai/shared`; đường dẫn đọc file đúng route `GET …/skills/:id/files` (DS-X1 Step 1
xác nhận query của route đọc một file). Test `endpoints.test.ts` khẳng định không có hàm nào gọi `DELETE` tới
`/environments`, `/projects/:id`, `/agents/:id`.

---

## Task

### PL-X1 — Hai kind việc máy, hai kind setup run (plugin, opus)

**Files:** như bảng Sở hữu file.

- [ ] **Step 1:** `\d` bảng trên Postgres nhúng (hoặc đọc `pg_constraint` trong test) lấy đúng tên constraint `kind`;
  sửa IX1 nếu khác, ghi ledger.
- [ ] **Step 2: Test đỏ.**
  - `machine-jobs-validate.test.ts`: payload/result hợp lệ của hai kind; ca sai: `projectKey` `../x`, `roles` rỗng/trùng/
    lạ, `slug` `..`, `slug` có `/`, key lạ, `detail` > 300 bị cắt.
  - `setup-runs.db.test.ts`: tạo `remove-project` (409 khi trùng run dở cùng `projectId`); `remove-agent` khóa
    `agent-xxxxxxxx`; bước cuối đặt `done`; `add-project` cũ không đổi.
  - `skill-sync.db.test.ts`: cặp có `skill-remove` `done` mới nhất bị bỏ; `skill-remove` `queued` trả kèm `kind`.
- [ ] **Step 3: Cài**, migration chạy được trên DB đã có 0001–0010 (test migration như các lần trước).
- [ ] **Step 4:** Toàn gói plugin từng file một, typecheck, `node build.mjs`, `check-core-hooks` 5/5. Kiểm `ipcs -m` trước/sau.
- [ ] **Step 5: Commit** `feat(crew-plugin): việc máy gỡ checkout, xóa skill và setup run gỡ`.

### SEC-X1 — H2 xóa execution state khi board ép Done (security, opus)

- [ ] **Step 1:** `git merge --ff-only crew/r3` có CORE-P; đọc diff CORE-P chạm `issue-gate.ts`/`core-hooks.ts` nếu có.
- [ ] **Step 2: Test đỏ** `crew-issue-gate.db.test.ts` (gọi `issueService.update(id, {status:'done', actorUserId})`, đúng
  đường plugin dùng):
  1. issue chờ stage review của agent → `done`, `executionState null`, 1 activity override;
  2. issue chờ approval của chính user → như trên, không có `issue_execution_decisions` mới;
  3. issue `in_progress` có policy, state null → `done`, 1 override (violations có `stage_unapproved:*`);
  4. hồi quy: actorAgentId → `crew_gate_blocked`, không đổi DB; Duyệt đủ stage → 0 override; patch có `executionState`
     sẵn thì giữ nguyên giá trị đó.
- [ ] **Step 3: Cài** IX4, sửa chú thích, `description` H2.
- [ ] **Step 4:** Test crew server tuần tự (chờ Postgres), `tsc` file crew, `check-core-hooks` 5/5.
- [ ] **Step 5: Commit** `fix(crew): board ép done xóa execution state treo`.

### MC-X1 — Executor gỡ checkout và xóa skill (mac, opus)

- [ ] **Step 1:** Đọc `executors.ts`, `validate.ts` (`checkoutPath`, `machineGuardReason`), `projects/{remove-project,
  progress}.ts`, `ops-bridge.ts` (`removeStatusRepo`). Kiểm trên máy thật (thư mục tạm ngoài TCC) rằng `git worktree
  remove` không `--force` chấp nhận worktree chỉ có tệp bị ignore qua `info/exclude` (`.paperclip-runtime`) — ghi kết quả
  vào ledger; nếu không chấp nhận thì xóa riêng `.paperclip-runtime` trước, chỉ khi `git status --porcelain` rỗng.
- [ ] **Step 2: Test đỏ** `remove.test.ts` (HOME giả `mkdtemp`, repo git thật trong thư mục tạm):
  - sạch → `removed`, nhánh `crew/<key>/<role>` còn, folder gốc còn;
  - có tệp sửa chưa commit → `kept dirty`, thư mục còn nguyên;
  - process giả đang mở thư mục (runner `lsof` giả trả PID; chuỗi lệnh lấy từ máy thật) → `kept busy`;
  - đường dẫn là symlink trỏ ra ngoài `~/crew-agents/<key>/` → `kept not_worktree`, không xóa đích;
  - đường dẫn là worktree chính (git-dir = common-dir) → `kept not_worktree`;
  - không tồn tại → `absent`;
  - xong mọi vai → `~/crew-agents/<key>` rỗng bị `rmdir`; `removeStatusRepo:true` gọi `removeStatusRepo(projectId)` và xóa
    tiến độ `app.json` của project (nếu có);
  - `skill-remove`: xóa đúng thư mục; không có → `removed:false`; `slug` symlink trỏ sang `~/.crew/workflows/x` → từ chối,
    đích còn nguyên.
  - `validate.test.ts`: luật IX1 phía app.
- [ ] **Step 3: Cài** `src/main/jobs/remove.ts` (dùng `execFile`, không shell), nối vào `runJob`.
- [ ] **Step 4:** `pnpm --filter @crew/mac-app test`, `typecheck`, `pnpm lint`. Sửa `docs/flows/mac-app-paperclip.md`
  (thêm hai kind, luật giữ lại), file mới vào `docs/flows.yaml`, `crew-docs generate`, `crew-docs check --staged`.
- [ ] **Step 5: Commit** `feat(mac-app): nhận việc gỡ checkout và xóa skill trên máy`.

### PL-X2 — Route Ép Done (plugin, opus)

- [ ] **Step 1:** Đọc `roles/api.ts` (khuôn kiểm actor board), SDK `issues.update/createComment/requestWakeup`,
  `plugin-host-services.ts` (actorUserId đi vào `issueService.update`). Kiểm `issues.list({parentId})` hoặc
  `getSubtree` để đếm con của cha.
- [ ] **Step 2: Test đỏ** `force-done.test.ts` (ctx giả, như các test route khác):
  - actor không phải board → 403, không gọi `update`;
  - `reason` 9 ký tự / 1001 ký tự / chỉ khoảng trắng / có `\x00` → 400;
  - issue khác company → 404; `done`/`cancelled` → 409 `issue_terminal`;
  - thành công: `update(id, {status:'done'}, companyId, {actorUserId})` đúng một lần; comment "**Ép Done** — <lý do>" với
    `actorUserId`; activity `crew.issue.force_done` có `reason`, `fromStatus`, `fromStageId`;
  - cha giao agent, mọi con khác đã xong → `requestWakeup(parentId, …, {reason:'issue_children_completed',
    idempotencyKey:'force-done:<id>'})`; còn con mở → không đánh thức; cha giao user → không đánh thức;
  - comment/wakeup lỗi → 200 kèm `warnings`.
- [ ] **Step 3: Cài**, manifest thêm route và 2 capability.
- [ ] **Step 4:** Như PL-X1 Step 4. Ghi ledger: plugin cần cài lại để host cấp capability mới (DP-X1 kiểm `plugin-state.sh`).
- [ ] **Step 5: Commit** `feat(crew-plugin): route ép done cho board, ghi lý do và báo Trợ Lý`.

### DS-X1 — Client (ds, sonnet)

- [ ] **Step 1:** Đọc route server cho từng dòng IX5 (đặc biệt `GET …/skills/:id/files` đọc một file, `GET
  /issues/:id/activity` dạng trả), sửa chữ ký IX5 nếu khác, ghi ledger.
- [ ] **Step 2: Test đỏ** `test/api/*`: mỗi hàm gọi đúng method/path/body; `endpoints.test.ts` có mã BA mới; không có hàm
  `DELETE` tới environments/projects/agents.
- [ ] **Step 3: Cài.** Chép kiểu IX1/IX2/IX3 vào `src/api/crew/types.ts`.
- [ ] **Step 4:** test, typecheck, biome. **Step 5: Commit** `feat(crew-web): client ép done, lịch sử, sửa xóa skill, gỡ`.

### WK-X1 — Ép Done và Lịch sử (work, opus)

- [ ] **Step 1:** Đọc `gate-actions.ts`, `actions-slot.tsx`, `gate-dialogs.tsx`, `use-issue.ts`, `issue-runs.tsx` (run
  đang chạy), `properties-panel.tsx`.
- [ ] **Step 2: Test thuần (đỏ)** `force-done.test.ts`: `forceDoneAvailable(issue)` đúng khi `status ∉ {done,cancelled}`;
  `skippedGates(issue)` liệt kê stage chưa xong theo policy/state; `validReason` (trim, 10–1000); `runForceDone(deps)` gọi
  theo thứ tự: đọc lại issue → (hủy con nếu chọn) → hủy run → route; dừng ở lỗi đầu; issue đã đóng khi đọc lại thì không gọi
  gì.
- [ ] **Step 3: Test component (đỏ)** `force-done-dialog.test.tsx`: nút xác nhận tắt khi lý do < 10; ô hủy con bật sẵn và
  hiện số con; lỗi server hiện nguyên văn, giữ lý do; thành công invalidate `issue`, `issueActivity`, `issues`.
- [ ] **Step 4: Test lịch sử (đỏ)** `history-format.test.ts`: dịch action đã biết, gộp `board_override` + `force_done`
  cùng user ≤ 5 giây, dịch `violations` (`stage_unapproved:<id>` → tên stage theo policy, `docs_missing`, `push_stale`…),
  action lạ hiện mã gốc; giờ `Asia/Ho_Chi_Minh`. `history.test.tsx`: badge "Ép Done" và lý do.
- [ ] **Step 5:** `interactions-slot.tsx` không hiện thẻ khi issue `done/cancelled` (test).
- [ ] **Step 6: Cài**, locale VI/EN. **Step 7:** test, typecheck, biome, build.
- [ ] **Step 8: Commit** `feat(crew-web): nút ép done có lý do và lịch sử yêu cầu`.

### OR-X1 — Sửa và xóa skill (org, opus)

- [ ] **Step 1:** Đọc `skill-detail.tsx`, `add-skill-dialog.tsx`, `name-guard.ts`, `use-skill-sync.ts`; route server
  `company-skills.ts:1184-1530` để biết trường `editable`/`editableReason` trong `GET skill` và cách báo xung đột khi ghi
  file. Ghi ledger.
- [ ] **Step 2: Test thuần (đỏ)**:
  - `frontmatter.test.ts`: đọc `name:`; chặn tên trùng Superpowers (dùng lại `superpowersNameClash`).
  - `delete-skill.test.ts`: thứ tự gọi (gỡ khỏi từng agent bằng `syncSkills` `replace` → bỏ đường dẫn ở nguồn nếu có
    `skillSourceId` → `DELETE` → xếp `skill-remove` cho mỗi máy đã có bản chép); 422 `usedByAgents` → gỡ lại rồi thử một
    lần; 409 `revision` → đọc lại, thử một lần; chạy lại sau lỗi không gọi lại bước đã xong.
- [ ] **Step 3: Test component (đỏ)**: skill GitHub không có trình sửa nội dung, có "Cập nhật từ nguồn" và "Tạo bản sửa
  được"; skill sửa được có trình sửa, lưu xong xếp `skill-sync` mọi máy; xóa cần gõ đúng slug; khối "Skill ghim" chỉ đọc,
  không có `button` nào bên trong.
- [ ] **Step 4: Cài**, locale VI/EN. **Step 5:** test, typecheck, biome, build.
- [ ] **Step 6: Commit** `feat(crew-web): sửa nội dung, cập nhật, tạo bản sửa được và xóa skill`.

### WZ-X1 — Gỡ project và gỡ agent (wizards, opus)

- [ ] **Step 1:** `git merge --ff-only crew/r3` có CORE-P. Đọc `add-project/{run-step,wait-job}.ts`, `setup-progress.tsx`,
  `resume.ts`, `use-save-roles.ts`, `assistant-instructions.ts`; repo Crew `remove-project.ts` (khuôn bước, `git show
  r3:…`).
- [ ] **Step 2: Test thuần (đỏ)**:
  - `eligibility.test.ts`: bảng spec §4.5 (không vai trò; executor có bạn; executor duy nhất; Trợ Lý; reviewer;
    integrator; terminated).
  - `exclusive-environments.test.ts`: environment chỉ agent trong phạm vi dùng → archive; environment mẫu/environment có
    agent ngoài phạm vi (chưa terminated) → giữ; environment đã `archived` → bỏ qua.
  - `remove-project.test.ts`: đúng thứ tự bước spec §4.4; `refs` lưu id; lỗi ở `checkouts` → run `failed`, "Chạy tiếp"
    bỏ qua bước `done`, không pause lại; kết quả `kept` → bước `done` kèm cảnh báo; không có lời gọi `DELETE` nào.
  - `remove-agent.test.ts`: executor-2 → roles mới + render lại `AGENTS.md` Trợ Lý (409 → dừng, báo, "Chạy tiếp"); agent
    không vai trò → chỉ `pause-agent`, `environment`.
- [ ] **Step 3: Test component (đỏ)** `remove-buttons.test.tsx`: `ConfirmDialog requireText` = tên; nút tắt kèm lý do
  khi không đủ điều kiện; dialog hiện số issue mở, run đang chạy, checkout bẩn.
- [ ] **Step 4: Cài**, export qua `features/wizards/index.ts`; `setup-progress.tsx` hiện được hai kind mới.
- [ ] **Step 5:** test, typecheck, biome, build. **Step 6: Commit** `feat(crew-web): gỡ project và gỡ agent không mất dữ liệu`.

### OR-X2 — Gắn nút gỡ, bộ lọc, Hướng dẫn (org, sonnet)

- [ ] **Step 1:** Gắn `RemoveProjectButton` vào S8 header, `RemoveAgentButton` vào S11 header. Trang project đã archive
  hiện banner "Đã gỡ lúc …". Danh sách agent thêm bộ lọc "Đã gỡ" dùng `removalState`; mặc định ẩn agent đã gỡ.
- [ ] **Step 2:** Hướng dẫn VI/EN: bỏ dòng "không có nút ép xong/gỡ/xóa skill" trong `missing-features.ts`; thêm mục Ép
  Done (khi nào dùng, hệ quả, lịch sử), Sửa/xóa skill (đổi nguồn = thêm mới rồi xóa cũ), Gỡ project/agent (giữ dữ liệu,
  checkout bẩn được giữ).
- [ ] **Step 3:** Test component tương ứng + test guide hiện có xanh. **Step 4:** test, typecheck, biome, build.
- [ ] **Step 5: Commit** `feat(crew-web): nút gỡ ở project và agent, cập nhật hướng dẫn`.

### E2E-X1 — Playwright (e2e, sonnet)

- [ ] **Step 1:** Thêm mã `S6.17, S6.18, S14.5, S14.6, S14.7, S8.7, S11.9, F10` vào `ba-ids.json`, `coverage.json`.
- [ ] **Step 2:** Spec theo AX1–AX9; mỗi ca kiểm tác dụng bằng API hoặc `db.query` (chỉ `SELECT`, body qua stdin), kiểm
  trên Mac bằng `fs` (Playwright chạy trên Mac mini). Ca âm dùng `agentToken()`. Dọn bản ghi trong `cleanup`.
- [ ] **Step 3:** Chạy T1 nếu stack còn; T2 để AC-X. `coverage.test.ts` xanh.
- [ ] **Step 4: Commit** `test(crew-web): playwright ép done, sửa xóa skill, gỡ project và agent`.

### RV-X, DP-X1, DP-X2, AC-X

- **RV-X:** như RV-1 R3, phạm vi `git diff <mốc trước R3X>..crew/r3` và `r3`; full suite hai repo; AX11.
- **DP-X1:** trình tự deploy R3; kiểm thêm migration `0011` đã áp (plugin ready), capability mới được cấp
  (`plugin-state.sh`), `GET /` mốc `crew-ui` đúng commit.
- **DP-X2:** cài app mới khi 0 run active; giữ bản cũ ở `~/crew-r3-app-prev/`; kiểm `jobsAgent` trong bản tin.
- **AC-X:** T2 AX1–AX10 trên Crew E2E; bằng chứng vào `reports/ac-x.md` và ledger; dọn: issue thử cancel, skill thử xóa,
  project/agent thử đã gỡ (giữ archive), marker stub tắt.

## Nghiệm thu

- [ ] AX1–AX10 đạt ở AC-X; AX11 đạt ở RV-X.
- [ ] Ledger có: tên constraint (PL-X1), hành vi `git worktree remove` với tệp ignore (MC-X1), chữ ký IX5 chốt (DS-X1),
  bằng chứng deploy.
- [ ] Push theo luật R3 (owner đã cho push R3); tag theo chốt của owner: `crew/v3.2` sau R3 (cho-dai-ca mục "Đã chốt").

## Self-review

R3X-PLAN (opus) tự review 2026-10-10 07:33 sau khi viết spec và plan.

- **Phủ spec:** §4.1 → PL-X2, SEC-X1, DS-X1, WK-X1, AX1–AX3; §4.2 → OR-X1, AX4; §4.3 → OR-X1, PL-X1, MC-X1, AX5–AX6;
  §4.4 → WZ-X1, OR-X2, PL-X1, MC-X1, AX7; §4.5 → WZ-X1, OR-X2, AX8; §4.6 → PL-X1, MC-X1; §4.7 → DS-X1; §5 → E2E-X1,
  AC-X, RV-X; §10 → bảng dưới.
- **Mỗi ticket một gói**; điểm nối chung `manifest.ts`/`worker.ts` chỉ PL-X2 sửa; `setup-progress.tsx` chỉ WZ-X1;
  trang project/agent chỉ OR-X2.
- **Placeholder:** không có `TBD`/`TODO`. Bốn giá trị chốt khi làm đều có bước xác nhận: tên constraint (PL-X1 Step 1),
  hành vi worktree remove (MC-X1 Step 1), chữ ký đọc file skill/activity (DS-X1 Step 1), cách báo xung đột ghi file skill
  (OR-X1 Step 1).
- **Nhất quán tên:** `remove-checkouts`, `skill-remove`, `remove-project`, `remove-agent`, `issues.forceDone`,
  `crew.issue.force_done`, `RemoveProjectButton`, `RemoveAgentButton`, `removalState`, `forceDoneAvailable`,
  `skippedGates`, `runForceDone`.

## Giả định chờ owner

Đang tạm theo phương án khuyên ở spec §10 (không chặn):

| # | Tạm theo | Owner bác thì đổi |
|---|---|---|
| Q1 | Ép Done: ô "Hủy luôn issue con chưa xong" bật sẵn | WK-X1 đổi mặc định (một dòng + test) |
| Q2 | Gỡ agent = pause, không terminate | WZ-X1 thêm bước `terminate` (opus) |
| Q3 | Gỡ project giữ nguyên issue mở | WZ-X1 thêm bước hủy issue mở trước `pause-agents` |
| Q4 | "Sửa nguồn" = cập nhật từ nguồn / tạo bản sửa được / thêm mới rồi xóa cũ | OR-X1 thêm luồng "Đổi nguồn" ghép ba bước |
| Q5 | Checkout bẩn được giữ, không `--force` | MC-X1 thêm cờ `force` theo từng checkout, WZ-X1 thêm ô chọn |
