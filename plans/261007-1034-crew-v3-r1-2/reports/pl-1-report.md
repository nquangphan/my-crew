# Báo cáo PL-1 — H2 logic thật

Ngày 07/10/2026 (Asia/Ho_Chi_Minh). Worktree fork `.worktrees/paperclip-r12-policy`, nhánh `crew/r12-policy` từ `v3` `e1c3dd2db`.

## Commit

`20a620cfe9771ed430e7d97069455de5e380c480` — `feat(crew): enforce review, integrator and docs gates before issue completion`

## File đổi

- Tạo `server/src/crew/issue-policy.ts` (vai trò, template, fingerprint, bằng chứng docs)
- Tạo `server/src/crew/issue-gate.ts` (`evaluateIssueGate`, `crewBeforeIssueWrite`)
- Sửa `server/src/crew/core-hooks.ts` (import + `beforeIssueWrite: crewBeforeIssueWrite`)
- Tạo `server/src/__tests__/crew-issue-gate.test.ts` (22 test unit)
- Tạo `server/src/__tests__/crew-issue-gate.db.test.ts` (5 test embedded PG qua `issueService(db).update` thật)
- Sửa `server/src/__tests__/crew-core-hooks.test.ts` (bỏ khẳng định H2 no-op, thêm test registry H2)
- Sửa `crew/release/core-hooks.json` (H2 `tests` thêm hai file mới)

Không đụng `server/src/services/issues.ts` ở ticket này.

## Test

```
$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts src/__tests__/crew-issue-gate.test.ts
 Test Files  3 passed (3)
      Tests  34 passed (34)
   Duration  26.46s

$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issue-execution-policy.test.ts src/__tests__/issue-execution-policy-routes.test.ts
 Test Files  2 passed (2)
      Tests  89 passed (89)

$ node crew/release/check-core-hooks.mjs
Hook một dòng: 3/5; mục: 7; lỗi: 0

$ (cd server && corepack pnpm exec tsc --noEmit)   # không in lỗi
```

Embedded PG chạy thật trên máy (suite DB không bị skip). Hai cảnh báo log trong `crew-core-hooks.test.ts` (`crew-load-gate: failed open`, `ssh timeout`) có sẵn từ trước, không phải lỗi.

## Lệch plan / bổ sung

- O7 (bổ sung ngoài policy.md): agent (`actorAgentId` có) chuyển issue sang `cancelled` → 422 `crew_gate_blocked`, `violations: ["agent_cancel_forbidden"]`, thông báo hướng dẫn chuyển `blocked`. Board và hệ thống (không actor) vẫn cancel được; ghi lại `cancelled` trên issue đã `cancelled` không bị chặn. Áp cho mọi issue, kể cả issue không có policy Crew hoặc company chưa có vai trò. Test: unit "agent không được chuyển issue sang cancelled…", "agent ghi lại cancelled…", DB "agent chuyển cancelled bị 422, board thì được".
- Truy vấn bằng chứng docs lọc thêm `isNull(issueComments.deletedAt)`: comment đã xóa không còn là bằng chứng (schema có cột `deleted_at`; plan không nhắc).
- `policyPatched` viết gọn thành `hasOwn && !== undefined` (tương đương biểu thức trong plan).
- Test DB thêm khẳng định `details.code` cho "system done" và kiểm policy còn 3 stage sau lần agent xóa bị chặn; test board override kiểm `actorType = "user"`.

## Q4 — đo agent tự PATCH `metadata.crewRole`

Đo bằng hai test tạm (chèn vào `agent-permissions-routes.test.ts` và `authorization-service.test.ts`, chạy `-t TEMPMEASURE`, rồi `git checkout --` hoàn nguyên; không commit):

- Route `PATCH /api/agents/:id` với actor agent chính nó, body `{ "metadata": { "crewRole": "reviewer" } }` → **200**, `svc.update` nhận `{"metadata":{"crewRole":"reviewer"}}`; chỉ một lần gọi `access.decide` với `agent_config:update`. `updateAgentSchema` cho phép `metadata`; route không có kiểm riêng cho `metadata`.
- `authorizationService(db).decide` thật (embedded PG) cho agent tự sửa cấu hình của mình, không `scope` → `{"allowed":true,"reason":"allow_self"}`.

Kết luận: **agent tự đặt/xóa được `metadata.crewRole` của chính nó** (Cổng 2b sẽ thấy 200). Hậu quả với gate hiện tại: executor tự đặt `crewRole: "reviewer"` làm company có hai reviewer → `loadCrewRoles` trả `null` → fail closed (không ai `done`/tạo issue con được bằng agent; board override vẫn được). Agent không chiếm được vai trò của agent khác mà không có grant `agents:configure`; nhưng reviewer/integrator tự xóa vai trò của mình cũng làm fail closed. Tức là lỗ hổng từ chối dịch vụ, không phải tự duyệt — trừ trường hợp agent có `agents:configure` (đổi được metadata của agent khác). Không thêm hook thứ 5; cần owner quyết Q4.

## Giả định

- Actor rỗng (plugin/service nội bộ) xử lý như agent cho `done` và sửa policy, nhưng không bị O7 (đúng ruling ledger và Review Focus 1).

## Sửa sau review

Commit `1e72138cbbdf5e4b573e7336d189c37d26a7c7f6` — `fix(crew): read Crew roles from a server config file and close reopen gaps` (một commit chung cho PL-1 và PL-2, trên `crew/r12-policy`). Không thêm hook; ngân sách vẫn 4/5.

File: `server/src/crew/{issue-policy,issue-gate,issue-create-policy,core-hooks}.ts`, `server/src/__tests__/{crew-issue-gate,crew-issue-gate.db,crew-issue-create-policy}.test.ts`.

Đã sửa:
- O8: vai trò và owner đọc từ file JSON `CREW_POLICY_CONFIG` (`parseCrewPolicyConfig`, `loadCrewCompanyConfig` → `absent | invalid | ok`), đọc lại mỗi lần gọi; bỏ `agents.metadata.crewRole`. Company không có trong file (hoặc không đặt env) → H2/H4 trả về ngay, kể cả O7. Entry lỗi → fail closed, log `error`.
- Critical 1: H2 ghi `crew.gate.cycle_reset` khi issue rời `done`/`cancelled`; approval và docs cũ hơn mốc không tính; approval của assignee hiện tại hoặc `returnAssignee` không tính.
- Major 2: H4 từ chối agent tạo issue `done`/`cancelled`/`in_review` (`crew_gate_blocked`, mã đã có trong plan); `status` thêm vào `IssueCreateFields`/`IssueCreateLike`.
- Major 3: H4 giữ stock khi không có người tạo (hệ thống); H2 cho qua mọi ghi không actor trên issue không có stage. Board tạo issue gốc không policy vẫn nhận template gốc (owner theo file).
- Minor 5: stage docs = mọi stage `review` trừ stage đầu, theo policy đã ghim; tác giả bằng chứng = participant của stage đó.
- Minor 6: H2 chặn agent đổi `assigneeAgentId` sang reviewer/integrator ngoài bước giao stage của workflow (`crew_role_assignee`).
- Minor 7: thêm test DB cho truy vấn bằng chứng docs (lọc tác giả, comment đã xóa, mới nhất) và nhánh duyệt trong cùng lệnh ghi.
- Minor 4: không sửa; ruling chấp nhận đã append vào ledger.

RED (test mới viết trước code):

```
$ vitest run src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts
⎯⎯⎯⎯⎯⎯ Failed Tests 21 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  ... mở lại bằng comment resume (update todo không actor) rồi executor done: 422, approval cũ không tính
 FAIL  ... issue gốc mở lại kèm docs cũ: executor done bị 422 ở mọi stage
 FAIL  ... bằng chứng docs: comment mới nhất chưa xóa của participant stage integrator
 ...
$ vitest run src/__tests__/crew-issue-create-policy.test.ts
 Test Files  1 failed (1)
      Tests  11 failed | 6 passed (17)
```

GREEN:

```
$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  4 passed (4)
      Tests  73 passed (73)

$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issues-service.test.ts src/__tests__/heartbeat-active-run-output-watchdog.test.ts src/__tests__/heartbeat-issue-liveness-escalation.test.ts src/__tests__/task-watchdogs-scheduler.test.ts
 Test Files  4 passed (4)
      Tests  169 passed (169)
   Duration  48.64s

$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issue-execution-policy.test.ts src/__tests__/issue-execution-policy-routes.test.ts
 Test Files  2 passed (2)
      Tests  89 passed (89)

$ node crew/release/check-core-hooks.mjs
Hook một dòng: 4/5; mục: 8; lỗi: 0
$ node --test crew/release/check-core-hooks.test.mjs
ℹ pass 9
ℹ fail 0
$ (cd server && corepack pnpm exec tsc --noEmit; echo tsc-exit=$?)
tsc-exit=0
```

`issues-service.test.ts` xanh (5 test đỏ trước đây đã qua) vì test stock không đặt `CREW_POLICY_CONFIG` nên company nằm ngoài file, tức là hành vi stock. Đường hệ thống trên company **có** cấu hình được phủ bằng test DB "hệ thống tạo issue phụ … đóng được như stock" và "system done issue không có policy Crew".

Lệch/ghi chú: interface `loadCrewRoles(db, companyId)` và `loadCompanyOwnerUserId` trong `plan.md` đã thay bằng `loadCrewCompanyConfig(companyId)`; `plan.md` cần Trợ Lý cập nhật. Issue Crew mở lại khi state còn `completed` chỉ đóng được bằng board (xem ruling C1 hệ quả).

### Đợt 2 (lead chốt concern 2 và 3)

Commit `c32d59fadc7e8f5099cc099e7aa436bb4dbd9475` — `fix(crew): restart the pinned review stages when a Crew issue is reopened`.

- H2: khi issue có policy Crew rời `done`/`cancelled`, đặt `executionState = null` trong patch của chính lệnh ghi đó (activity `crew.gate.cycle_reset` thêm `executionStateCleared`). Hợp đồng `patch` trong `core-hooks.ts`/`issue-gate.ts` đổi từ `Readonly` sang được sửa đúng chỗ này; `runUpdate` ghi chính object `patch` (`tx.update(issues).set(patch)`), không đổi file lõi.
- Test DB mới "mở lại để giao thêm việc…": done + approval cũ của reviewer → `update({status:"todo"})` không actor (như comment resume) → state null → executor `in_progress` → transition stock `done` + `update` như route PATCH → `in_review`, assignee = reviewer, state `pending` ở stage reviewer; sau đó executor `done` thẳng qua service vẫn 422 `stage_unapproved` (approval cũ không tính).
- Concern 3: chấp nhận, ruling đã append vào ledger.

```
RED: $ vitest run src/__tests__/crew-issue-gate.db.test.ts -t "giao thêm việc"
     × mở lại để giao thêm việc: executor PATCH done lại đi vào stage reviewer, approval cũ vẫn không tính
AssertionError: expected { status: 'completed', …(10) } to be null

GREEN: $ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  4 passed (4)
      Tests  74 passed (74)
$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issues-service.test.ts src/__tests__/issue-execution-policy.test.ts
 Test Files  2 passed (2)
      Tests  197 passed (197)
$ node crew/release/check-core-hooks.mjs
Hook một dòng: 4/5; mục: 8; lỗi: 0
$ (cd server && corepack pnpm exec tsc --noEmit; echo tsc-exit=$?)
tsc-exit=0
```

## O9 — template gốc 4 stage và stage push

Commit `46b6cbf5b60bdd0db348c910162b549338a8c028` — `feat(crew): add an integrator push stage after owner approval on root issues`. Hook vẫn 4/5, không đổi `issues.ts`.

File: `server/src/crew/{issue-policy,issue-gate}.ts`, `server/src/__tests__/{crew-issue-gate,crew-issue-gate.db,crew-issue-create-policy}.test.ts`.

- `buildCrewPolicy("root", …)` = `[review reviewer, review integrator, approval owner, review integrator]`, `maxReviewRounds: 5`. `CREW_MERGE_RE`, `parseCrewMergeEvidence` mới.
- H2: `docsGateStages` = stage `review` thứ hai trước `approval` đầu (chỉ stage 2); `pushGateStages` = stage `review` sau `approval` đầu. Hoàn tất stage push/vào `done` cần `crew-merge … pushed=yes` của participant stage push, mới hơn approval owner cùng vòng, `sha` = `commit=` của bằng chứng docs mới nhất; vi phạm `push_missing`/`push_stale`/`push_sha_mismatch` (422 `crew_gate_blocked`).
- Luật loại người ký: assignee hiện tại không bị loại khi workflow đang chờ chính nó ở stage hiện tại (integrator ở stage 4 vẫn tính approval stage 2 của nó); executor (`returnAssignee`) luôn bị loại.
- Stock (đọc theo symbol): không ràng buộc cùng agent ở hai stage hay `review` sau `approval`; `nextPendingStageAfter` theo vị trí; `buildExecutionStageWakeup` đánh thức participant stage 4. Chi tiết trong ledger.
- Test DB đi hết luồng qua `applyIssueExecutionPolicyTransition` + `update` + chèn decision trong cùng transaction (như route PATCH): executor → reviewer → integrator (docs) → owner → integrator `crew-merge pushed=yes` → `done`, không có board override; các ca `docs_missing` ở stage 2, `push_missing` (không comment, `pushed=no`, comment của executor), `push_stale` (merge trước owner duyệt), `push_sha_mismatch`; issue gốc cũ 3 stage: owner duyệt là `done`. Seed thêm membership `owner-1` (stock đòi assignee user là thành viên) và truyền hàng đợi post-commit khi gọi `update` trong transaction ngoài.

```
RED: $ vitest run src/__tests__/crew-issue-gate.test.ts
TypeError: Cannot read properties of undefined (reading 'type')    # template gốc chưa có stage 4
 Test Files  1 failed (1)
$ vitest run src/__tests__/crew-issue-gate.db.test.ts
     × issue gốc mở lại kèm docs cũ: executor done bị 422 ở mọi stage
     × luồng gốc 4 stage: reviewer → integrator docs → owner → integrator crew-merge pushed=yes → done
     × luồng gốc 4 stage: stage push thiếu, cũ hơn owner, lệch sha hoặc pushed=no đều 422
 Test Files  1 failed (1)
      Tests  3 failed | 17 passed (20)

GREEN: $ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  4 passed (4)
      Tests  97 passed (97)
$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issue-execution-policy.test.ts src/__tests__/issue-execution-policy-routes.test.ts src/__tests__/issues-service.test.ts
 Test Files  3 passed (3)
      Tests  216 passed (216)
$ node crew/release/check-core-hooks.mjs
Hook một dòng: 4/5; mục: 8; lỗi: 0
$ (cd server && corepack pnpm exec tsc --noEmit; echo tsc-exit=$?)
tsc-exit=0
```

Lệch: test tạo issue (`crew-issue-create-policy.test.ts`) đổi kỳ vọng template gốc từ 3 sang 4 stage.
