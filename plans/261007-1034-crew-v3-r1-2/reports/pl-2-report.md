# Báo cáo PL-2 — H4 `beforeIssueCreate`

Ngày 07/10/2026 (Asia/Ho_Chi_Minh). Worktree fork `.worktrees/paperclip-r12-policy`, nhánh `crew/r12-policy` (nối sau PL-1 `20a620cfe`).

## Commit

`66e1ee650a8ae55418873f88b8c500db0b6e07da` — `feat(crew): attach the Crew execution policy to every new issue`

## File đổi

- Tạo `server/src/crew/issue-create-policy.ts` (`decideCreatePolicy`, `crewBeforeIssueCreate`)
- Sửa `server/src/crew/core-hooks.ts` (`IssueCreateLike`, `BeforeIssueCreateInput`, `beforeIssueCreate` trong interface, `implementations`, `crewCoreHooks`)
- Sửa `server/src/services/issues.ts`: đúng một dòng, dòng đầu thân `create`:
  `      data = await crewCoreHooks.beforeIssueCreate({ db, companyId, data });` (không thêm import; import đã có ở cuối file)
- Tạo `server/src/__tests__/crew-issue-create-policy.test.ts` (8 test unit + 4 test embedded PG)
- Sửa `crew/release/core-hooks.json` (mục H4 sau H3, trước P1)

## Test

```
$ node crew/release/check-core-hooks.mjs
Hook một dòng: 4/5; mục: 8; lỗi: 0

$ node --test crew/release/check-core-hooks.test.mjs
ℹ tests 9
ℹ pass 9
ℹ fail 0

$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  4 passed (4)
      Tests  46 passed (46)
   Duration  11.66s

$ (cd server && corepack pnpm exec tsc --noEmit; echo tsc-exit=$?)
tsc-exit=0
```

Embedded PG chạy thật (không skip).

## Lệch plan / bổ sung

- Thêm test unit "board tạo issue con không policy: template con" và kiểm cả integrator trong "giao việc cho reviewer hoặc integrator".
- Thêm test DB "agent giao issue con cho reviewer bị 422 crew_role_assignee"; test "agent tạo issue gốc" khẳng định thêm `details.code`; test template gốc kiểm participant integrator và owner.
- Bỏ ép kiểu `as T` ở giá trị trả về (tsc chấp nhận spread), thêm comment giải thích `roles as CrewRoles`.

## Giả định và rủi ro cần để ý khi tích hợp

- Hook đọc vai trò/owner qua `db` (theo interface plan), không qua `dbOrTx`: caller tạo issue trong transaction vẫn đọc được vai trò đã commit; agent vừa được gán vai trò trong cùng transaction chưa commit sẽ không thấy (không có đường stock nào làm vậy).
- Fail closed: company chưa có đúng một reviewer + một integrator thì **mọi** agent tạo issue đều 422 `crew_roles_unconfigured`. Theo tầng test, em không chạy full suite; các test stock tạo issue bằng `createdByAgentId` trên company không vai trò (ngoài `crew-*`) có thể đỏ khi chạy full suite. `crew/release/verify.sh` chỉ chạy `src/__tests__/crew-`, nên Cổng 1 không bị ảnh hưởng. Nếu owner muốn upstream suite xanh thì cần quyết (ví dụ chỉ áp H4 khi company có cấu hình vai trò) — hiện giữ đúng ruling ledger.
- Trên Paperclip production, company chưa chạy `apply-roles.sh` thì agent (kể cả Trợ Lý) không tạo issue được cho tới khi có vai trò.

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

## Sửa sau re-review

Commit `21fcb1451890f95e9130097bffcaa1b5f433df38` — `fix(crew): route system-created issues by origin and warn when Crew gates are off`. Hook vẫn 4/5.

File: `server/src/crew/{issue-policy,issue-gate,issue-create-policy,core-hooks}.ts`, `server/src/__tests__/{crew-issue-gate,crew-issue-create-policy}.test.ts`.

- R1: `CREW_HOUSEKEEPING_ORIGIN_KINDS`, `isCrewHousekeepingOrigin`, `isCrewHousekeepingIssue` trong `issue-policy.ts`. H4 (không người tạo): watchdog/recovery → giữ stock; routine và nguồn khác/không nhận diện → template con (cấu hình lỗi → `crew_roles_unconfigured`). H2: issue watchdog/recovery không có stage, không `createdBy*` → agent được giao `done` được (O7 vẫn chặn cancel). `originKind` thêm vào `IssueCreateFields`/`IssueCreateLike`. `createIssueSchema` không nhận `originKind`, nên agent không tự gắn nguồn nội bộ được; nhánh agent của H4 chạy trước, không xét `originKind`.
- R2: so khớp key company không phân biệt hoa thường (trùng key → invalid); `reportCrewPolicyConfigAtStartup` warn một lần lúc nạp module khi chưa đặt env.
- R3: không sửa, ruling chấp nhận đã append ledger.

Test mới: unit "key company…", "reportCrewPolicyConfigAtStartup", "isCrewHousekeepingIssue" (kèm kiểm danh sách khớp `RECOVERY_ORIGIN_KINDS`, `TASK_WATCHDOG_ORIGIN_KIND`, `TASK_WATCHDOG_PRODUCT_BUG_ORIGIN_KIND`), "issue watchdog/recovery… agent done được", "hệ thống tạo issue watchdog/recovery", "hệ thống tạo issue routine hoặc nguồn không nhận diện được"; DB "hệ thống tạo issue watchdog… hệ thống và agent được giao đều done được", "hệ thống tạo issue routine: template con, agent không done thẳng được", "nguồn không nhận diện được (manual): template con".

```
RED: $ vitest run src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-create-policy.test.ts
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected { kind: 'keep' } to deeply equal { kind: 'set', template: 'child' }
Error: Crew: chưa đủ điều kiện để hoàn tất: policy_missing.
TypeError: reportCrewPolicyConfigAtStartup is not a function
TypeError: CREW_HOUSEKEEPING_ORIGIN_KINDS is not iterable
 Test Files  2 failed (2)
      Tests  8 failed | 50 passed (58)

GREEN: $ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  4 passed (4)
      Tests  81 passed (81)

$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issues-service.test.ts src/__tests__/routines-service.test.ts src/__tests__/issue-recovery-actions.test.ts src/__tests__/heartbeat-issue-liveness-escalation.test.ts src/__tests__/task-watchdogs-scheduler.test.ts
 Test Files  5 passed (5)
      Tests  281 passed (281)
   Duration  54.66s

$ node crew/release/check-core-hooks.mjs
Hook một dòng: 4/5; mục: 8; lỗi: 0
$ (cd server && corepack pnpm exec tsc --noEmit; echo tsc-exit=$?)
tsc-exit=0
```

Ghi chú: một lần GREEN đầu đỏ 1 test do uuid thử toàn chữ số (hoa = thường, JSON gộp key); đã đổi sang uuid có chữ cái, không đổi code. Test stock chạy không đặt `CREW_POLICY_CONFIG` (hành vi stock); đường có cấu hình được phủ bằng test DB của gói.

## Sửa sau re-review 2

Commit `1da5b34da7bd6045fb38d777afab440c74b2bca8` — `fix(crew): give system-created root issues the root template and gate recovery work handed back to its executor`. Hook vẫn 4/5.

File: `server/src/crew/{issue-policy,issue-gate,issue-create-policy,core-hooks}.ts`, `server/src/__tests__/crew-issue-create-policy.test.ts`.

- RR1: nhánh hệ thống (không người tạo, không được miễn) của `decideCreatePolicy`: có `parentId` → template con; không có → template gốc, owner lấy từ file cấu hình. Test DB "hệ thống tạo issue routine" (trước đây khẳng định template con cho issue gốc) đổi thành "hệ thống tạo issue routine cấp gốc: template gốc ba stage…"; thêm "issue con nguồn routine: template con", "nguồn không nhận diện được (manual) cấp gốc: template gốc", và "agent tạo routine giao cho chính mình" (qua `routineService.create` với actor agent + `runRoutine(…, { source: "schedule" })`: issue sinh ra có `createdByAgentId` null, policy reviewer → integrator → owner, executor `done` bị 422).
- RR2: `housekeepingSourceIssueId`, `loadSourceExecutorAgentIds` trong `issue-policy.ts`. H4: issue watchdog/recovery giao cho assignee/`returnAssignee` của issue nguồn → template con. H2: không miễn khi agent `done` là agent đang làm issue nguồn. `originId` thêm vào `IssueCreateFields`/`IssueCreateLike`. Test DB "monitor create_recovery_issue do executor đặt" chạy `heartbeatService(db).tickTimers` thật trên issue Crew có monitor `recoveryPolicy: "create_recovery_issue"`: issue `stranded_issue_recovery` giao lại executor nhận template con, executor `done` bị 422; test "issue recovery không policy: executor của issue nguồn không done được, agent khác thì được".

```
RED: $ vitest run src/__tests__/crew-issue-create-policy.test.ts
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected { kind: 'set', template: 'child' } to deeply equal { kind: 'set', template: 'root', …(1) }
AssertionError: expected [ [ 'review', …(1) ] ] to deeply equal [ [ 'review', …(1) ], …(2) ]
TypeError: Cannot read properties of null (reading 'stages')
AssertionError: promise resolved "{ …(65) }" instead of rejecting
 Test Files  1 failed (1)
      Tests  7 failed | 18 passed (25)

GREEN: $ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  4 passed (4)
      Tests  86 passed (86)

$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issues-service.test.ts src/__tests__/routines-service.test.ts src/__tests__/issue-recovery-actions.test.ts src/__tests__/heartbeat-issue-liveness-escalation.test.ts src/__tests__/task-watchdogs-scheduler.test.ts src/__tests__/issue-monitor-scheduler.test.ts
 Test Files  6 passed (6)
      Tests  290 passed (290)
   Duration  67.60s

$ node crew/release/check-core-hooks.mjs
Hook một dòng: 4/5; mục: 8; lỗi: 0
$ (cd server && corepack pnpm exec tsc --noEmit; echo tsc-exit=$?)
tsc-exit=0
```

Ghi chú: lần GREEN đầu đỏ 1 test do fixture chèn hai issue recovery đang mở cùng nguồn (vi phạm unique index stock `issues_active_stranded_issue_recovery_uq`); test đã cancel issue thứ nhất trước khi chèn issue thứ hai, code không đổi. Thêm `issue-monitor-scheduler.test.ts` vào bộ stock đã chạy (đường `create_recovery_issue`).

## Sửa sau re-review 3

Commit `2db8aafa9f132090e570f1529b8c76c419a2c03e` — `fix(crew): find the source of a watchdog or recovery issue by originId first`.

- RR3: `housekeepingSourceIssueId` dùng `originId` (uuid) trước, chỉ rơi về `parentId` khi không có `originId`. Test DB mới "executor tự giao issue watchdog không policy và đổi parentId sang issue khác: done vẫn 422".

```
RED: $ vitest run src/__tests__/crew-issue-create-policy.test.ts -t "đổi parentId"
     × executor tự giao issue watchdog không policy và đổi parentId sang issue khác: done vẫn 422
AssertionError: promise resolved "{ …(65) }" instead of rejecting

GREEN: $ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  4 passed (4)
      Tests  87 passed (87)
$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issue-monitor-scheduler.test.ts src/__tests__/task-watchdogs-scheduler.test.ts src/__tests__/issue-recovery-actions.test.ts
 Test Files  3 passed (3)
      Tests  84 passed (84)
$ node crew/release/check-core-hooks.mjs
Hook một dòng: 4/5; mục: 8; lỗi: 0
$ (cd server && corepack pnpm exec tsc --noEmit; echo tsc-exit=$?)
tsc-exit=0
```

## Sửa sau review toàn nhánh (m4)

Commit `66ef8470910302621fde24379aef7f6121e60d66` — `docs(crew): note that the issue-create hook reads committed source issues`.

- Dòng hook H4 trong `issues.ts:9639` chỉ truyền `db` (không có `dbOrTx`), và lead chốt không đổi dòng hook lõi, nên H4 không có transaction của bên gọi. Không đổi hành vi; thêm doc comment ở `crewBeforeIssueCreate` nêu giới hạn, ruling chấp nhận đã append ledger. Lớp bảo vệ còn lại: H2 so executor của issue nguồn bằng transaction của lệnh `done`.

```
$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  4 passed (4)
      Tests  87 passed (87)
$ (cd server && corepack pnpm exec tsc --noEmit; echo tsc-exit=$?)
tsc-exit=0
$ node crew/release/check-core-hooks.mjs
Hook một dòng: 4/5; mục: 8; lỗi: 0
```
