# Báo cáo PL-3 — L6 và P1 sau nghiệm thu AC-2

Ngày 07/10/2026 (Asia/Ho_Chi_Minh). Worktree `.worktrees/paperclip-r12-policy`, nhánh `crew/r12-policy`.

## Commit

`11a5ec4a78b7654f2dff90061da39831bd596115` — `test(crew): pin how stock recovery and owner comments interact with the root push stage`. Chỉ thêm test DB (3 test); không đổi code Crew, không đổi lõi, hook vẫn 4/5.

Không có bước RED: phân tích cho thấy L6 không làm gãy stage 4 ở tầng server (test mới xanh ngay trên code hiện tại), còn P1 là quyết định sản phẩm. Test được thêm để khóa hành vi đã đo, làm căn cứ cho instructions và cho lựa chọn P1.

## L6 — recovery chuyển `blocked`, comment owner đưa về `todo`

### Stock làm gì (theo symbol)

- `recovery/service.ts` `reconcileStrandedAssignedIssues`, nhánh `issue.status === "in_review"`: issue có `executionState` pending với participant là agent. Khi run mới nhất của participant đã kết thúc mà stage vẫn chờ, recovery đánh thức participant **một lần** (`enqueueStrandedIssueRecovery`, reason `execution_review_participant_recovery`, chỉ dẫn "Submit the review decision now, or mark the issue blocked…"). Lần sau, `didAutomaticRecoveryFail(...)` đúng nên gọi `escalateStrandedAssignedIssue`, tức `issuesSvc.update(id, { status: "blocked", blockedByIssueIds })` không actor.
  - Đây là hợp đồng stock: participant review phải ra quyết định hoặc tự `blocked`. Ruling N1 ("integrator chỉ comment `pushed=no`, không đổi status") chắc chắn chạm nhánh này.
- Lệnh ghi `blocked` không qua transition, nên **`executionState` vẫn pending ở stage 4**, participant là integrator.
- Comment của owner trên issue `blocked`: `routes/issues.ts` `shouldImplicitlyMoveCommentedIssueToTodo` đúng (user, `blocked`, có `assigneeAgentId`) nên gọi `svc.update(id, { status: "todo" })` không actor. H2 không xóa state, vì chỉ xóa khi issue rời `done`/`cancelled`. State stage 4 vẫn còn.
- `issue-execution-policy.ts` `applyIssueExecutionStageTransition`: `activeStage` chỉ phụ thuộc `existingState.status === "pending"`, **không** phụ thuộc `issue.status`. Vì vậy integrator `PATCH done` khi issue đang `todo`/`blocked` vẫn rơi vào nhánh participant: approve stage 4, `nextPendingStageAfter` rỗng, rồi `done`.

### Kết quả đo (test DB mới)

- "push lỗi ở stage 4 → recovery chuyển blocked → owner comment mở về todo…": sau `blocked` rồi `todo`, issue có `status: todo`, assignee là integrator, state pending ở stage 4. Integrator comment `crew-merge … pushed=yes` rồi `PATCH done` (qua transition như route) thì `done`.
- "issue blocked ở stage 4: owner đặt lại in_review…": board `PATCH status in_review` qua transition. `stageStateDrifted` dựng lại pending, `status in_review`, assignee integrator, cùng stage 4. Sau đó push + `done` đều được.

Kết luận: luồng 4 stage **không gãy ở server**. Issue chỉ hiện `blocked`/`todo` thay vì `in_review`, và gate stage 4 vẫn giữ nguyên. Ở AC-2, CRE-24 không tới `done` vì L5: integrator gọi sai URL nên không đăng được `crew-merge`/`done`. L6 không phải nguyên nhân.

### Không sửa bằng code, vì sao

- Chặn ghi `blocked` của recovery bằng H2: `escalateStrandedAssignedIssue` sẽ ném lỗi mỗi tick, recovery lặp lại và ghi log lỗi. Việc này cũng trái ruling "H2 không chặn `blocked`" (Review Focus 1, cổng tải/plugin).
- Sửa `status` trong patch (ví dụ ép `todo` thành `in_review`): các side effect stock đã tính trên `issueData.status` trước khi hook chạy (`applyStatusSideEffects`, `statusVersion`, `checkoutRunId`…), nên đổi `status` muộn sẽ làm lệch trạng thái. Ngoài ra không đánh thức lại được (`buildExecutionStageWakeup` coi stage và participant không đổi).

### Đề xuất (gói `roles`, không phải file của gói policy)

1. `integrator.md`, stage 4: push lỗi thì comment `crew-merge … pushed=no` kèm lý do, rồi **tự `PATCH status blocked`** kèm cách gỡ. Đây đúng là việc stock yêu cầu. Bỏ Ruling N1 "không đổi status", vì recovery stock sẽ tự làm việc đó sau một lần đánh thức. Khi được đánh thức lại mà issue đang `todo`/`blocked` nhưng `executionState` còn chờ stage 4 của mình, integrator chạy lại bước push rồi `PATCH done` như bình thường.
2. Owner, sau khi gỡ lỗi push, chọn một trong hai:
   - (a) Comment thường. Issue về `todo` và integrator được đánh thức; đủ để hoàn tất (đã đo).
   - (b) Đặt status `in_review` (UI/PATCH) rồi comment. Comment trên `in_review` đánh thức assignee (AC-2 #25 đạt); cách này giữ nhãn `in_review`.
   Em đề xuất (b) nếu owner muốn nhãn đúng, (a) nếu muốn ít thao tác. Không cần nút đặc biệt.

## P1 — comment owner trên issue gốc `done` mở lại về `todo`

### Hiện trạng (đo bằng test DB)

- Sau O9, issue gốc `done` ở stage 4 có assignee là integrator. Comment owner kích hoạt `shouldImplicitlyMoveCommentedIssueToTodo`, nên issue về `todo`. H2 ghi `crew.gate.cycle_reset` và xóa `executionState` (ruling lead chốt concern 2).
- Nếu integrator (assignee) tiếp tục rồi `PATCH done`: stock bắt đầu lại stage 1 với `returnAssignee = integrator`, issue sang `in_review` cho reviewer. Khi reviewer duyệt, stage 2 không có participant hợp lệ, vì integrator chính là `returnAssignee` bị loại. Stock báo 422 `No eligible review participant…`.
- **Không lách gate.** Nhưng luồng **kẹt ở stage 2** cho tới khi board giao lại. Test: "owner comment mở lại issue gốc đã done (assignee là integrator)…".

### Lựa chọn cho owner

| Lựa chọn | Cách làm | Hệ quả |
|---|---|---|
| A. Giữ stock (hiện tại) | Không đổi code. Instructions owner: muốn giao thêm việc trên issue gốc đã `done` thì **đổi assignee về executor/Trợ Lý trước** (hoặc cùng lúc) rồi comment | Vòng mới chạy đúng (executor là `returnAssignee`, đủ 4 stage). Quên đổi assignee thì kẹt ở stage 2, phải giao lại bằng board. Comment chỉ để hỏi/ghi chú trên issue `done` vẫn mở lại issue (đánh thức integrator một lần vô ích) |
| B. H2 tự giao lại khi mở lại | Trong `server/src/crew/issue-gate.ts`, cùng chỗ xóa `executionState`: nếu issue có policy Crew, patch không tự đặt assignee, và assignee hiện tại là participant agent của một stage, thì đặt `assigneeAgentId = returnAssignee` cũ (executor) | Mở lại bằng comment là giao việc thêm cho executor luôn, không kẹt. Đổi thêm một trường trong patch stock: side effect "đổi owner" của `runUpdate` (`statusVersion + 1`) và việc đánh thức theo assignee mới phải đo lại. Rủi ro nhỏ nhưng là hành vi mới, cần owner duyệt |
| C. Chặn mở lại | Không làm được gọn trong `server/src/crew/**`: chặn bằng H2 thì cả comment owner bị 422 (route ghi comment rồi mới `update`, hoặc trả lỗi cho owner). Muốn chỉ bỏ phần mở lại thì phải sửa route lõi (hook thứ 5) | Không khuyên |

Em đề xuất **A** cho R1 (không đổi code, ghi vào hướng dẫn owner và `roles`). Chuyển sang **B** nếu owner hay mở lại issue gốc để giao thêm việc. P1 là quyết định sản phẩm; em chưa làm B.

## Test

```
$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.db.test.ts -t "stage 4|mở lại issue gốc đã done"
      Tests  3 passed | 20 skipped (23)

$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  4 passed (4)
      Tests  100 passed (100)
$ (cd server && corepack pnpm exec tsc --noEmit; echo tsc-exit=$?)
tsc-exit=0
```

## Câu hỏi cho owner

- P1: chọn A (giữ stock, owner đổi assignee trước khi giao thêm việc) hay B (H2 tự giao lại executor khi mở lại)?
- L6: đồng ý bỏ Ruling N1, để integrator tự `blocked` khi push lỗi (sửa `crew/agents/integrator.md`, gói `roles`)?

## O11 — mở lại thì giao lại executor (owner chốt P1 = B)

Commit `94b334c5ed893f70dc0076c12786202e4841b83e` — `feat(crew): hand a reopened Crew issue back to its executor`. Hook vẫn 4/5, không đổi `issues.ts`. L6: lead giữ N1, không đổi roles.

### Code (`server/src/crew/issue-gate.ts`)

Cùng chỗ ghi `crew.gate.cycle_reset` (issue có policy Crew rời `done`/`cancelled`), `reopenHandBack` chạy khi lệnh ghi không tự đặt assignee và assignee hiện tại là agent participant của một stage trong policy đã ghim:
- Executor = `returnAssignee` (agent) của state cũ. Không có thì lấy tác giả agent của comment `crew-commit` mới nhất (chưa xóa) kể từ mốc `cycle_reset` trước.
- Executor phải cùng company, không `terminated`, khác assignee hiện tại. Khi hợp lệ: `patch.assigneeAgentId = executor`, `patch.statusVersion ??= statusVersion + 1`, và activity `cycle_reset` ghi `reassignedFromAgentId`/`reassignedToAgentId`.
- Không xác định được thì giữ assignee, ghi activity `crew.gate.reopen_executor_unknown` (`reason`).

### Side effect stock (đọc theo symbol)

- Đánh thức: comment route lấy người đánh thức bằng `svc.getById` **sau** khi ghi (`wakeIssueSnapshot.assigneeAgentId`, reason `issue_reopened_via_comment`), nên executor mới được đánh thức. Route PATCH tính `assigneeChanged` từ bản ghi trả về, cũng thấy executor. Stock không tính wakeup trước hook, nên không cần đề xuất gì thêm.
- `runUpdate` sau khi ghi: `expireConnectionIntentsForOwnershipChange` so `updated` với `existing`, nên vẫn chạy.
- Các bước tính trên `issueData` **trước** hook không thấy assignee mới:
  - `assertAssignableAgent`: H2 thay bằng kiểm cùng company và không `terminated`.
  - Bump `statusVersion`: H2 tự làm.
  - Xóa `checkoutRunId`/`executionRunId`: đã xảy ra vì status rời `in_progress`.
  Còn lệch một điểm: executor đang bị `paused` vẫn được giao lại (stock chặn ở `assertAssignableAgent` với `{ kind: "work" }`). Nếu cần thì thêm điều kiện; em chưa làm vì đánh thức agent paused tự bị bỏ qua.

### Test DB (RED rồi GREEN)

- "owner comment mở lại issue gốc đã done (assignee là integrator): giao lại executor, luồng chạy lại từ reviewer": chạy hết 4 stage tới `done`, rồi `update({status:"todo"})` không actor (như comment route). Kết quả: assignee là executor, state null, activity có `reassigned*`. Executor `done` thì issue sang `in_review` cho reviewer với `returnAssignee` là executor; reviewer duyệt thì sang integrator ở stage 2, không còn kẹt. Test này thay test đặc tả P1 cũ.
- "mở lại khi không còn returnAssignee: lấy tác giả crew-commit mới nhất…"
- "mở lại mà không xác định được executor: giữ assignee và ghi activity"
- "mở lại với assignee không phải participant (executor) hoặc lệnh ghi tự đặt assignee: không đổi assignee"

```
RED: $ vitest run src/__tests__/crew-issue-gate.db.test.ts -t "mở lại"
     × owner comment mở lại issue gốc đã done (assignee là integrator): giao lại executor, luồng chạy lại từ reviewer
     × mở lại khi không còn returnAssignee: lấy tác giả crew-commit mới nhất của vòng trước
     × mở lại mà không xác định được executor: giữ assignee và ghi activity
      Tests  3 failed | 6 passed | 17 skipped (26)

GREEN: $ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  4 passed (4)
      Tests  103 passed (103)
$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issues-service.test.ts src/__tests__/issue-execution-policy.test.ts src/__tests__/issue-execution-policy-routes.test.ts src/__tests__/issue-monitor-scheduler.test.ts src/__tests__/issue-recovery-actions.test.ts
 Test Files  5 passed (5)
      Tests  282 passed (282)
$ node crew/release/check-core-hooks.mjs
Hook một dòng: 4/5; mục: 8; lỗi: 0
$ (cd server && corepack pnpm exec tsc --noEmit; echo tsc-exit=$?)
tsc-exit=0
```

Không có test route thật cho việc đánh thức: route test stock mock `issueService`. Kết luận "executor được đánh thức" dựa trên đọc symbol ở trên. AC-2 lần sau nên kiểm bằng một comment owner thật: có run `issue_reopened_via_comment` của executor.

## Sửa sau review O11

Commit `d2625baa5b3b8fc64e8f4ef725a8526f53c59d2e` — `fix(crew): hand reopened issues back only to the recorded return assignee`.

- O1-1: bỏ nhánh lấy executor từ tác giả `crew-commit`, chỉ dùng `returnAssignee` (agent) của state cũ. Ứng viên là agent participant của bất kỳ stage nào trong policy đã ghim thì bị loại (`executor_is_stage_participant`). Không có `returnAssignee` → `no_return_assignee`.
- O1-2: issue có `chat_conversations` gắn (khớp kiểm `chat_binding_agent_locked` của `issueService.update`) → `chat_bound`. Ứng viên `pending_approval` hoặc `terminated` → `executor_unavailable`. `paused` vẫn được giao theo ruling cũ.
- Mọi ca không giao lại: giữ assignee, ghi `crew.gate.reopen_executor_unknown` kèm `reason`.

Test DB mới (thay test "lấy tác giả crew-commit"):
- "mở lại sau board override (không returnAssignee): comment crew-commit của agent khác không làm đổi assignee" → `no_return_assignee`.
- "returnAssignee là participant agent của policy (reviewer): không giao lại" → `executor_is_stage_participant`.
- "issue gắn kênh chat hoặc executor đang chờ duyệt: không giao lại" → `chat_bound`, `executor_unavailable`. Khung kênh tối thiểu (`toolApplications`, `toolConnections`, `chatEndpoints`, `chatConversations`) theo `heartbeat-reviewed-chat-binding.integration.test.ts`.

```
RED: $ vitest run src/__tests__/crew-issue-gate.db.test.ts -t "mở lại|returnAssignee là|kênh chat"
     × mở lại sau board override (không returnAssignee): comment crew-commit của agent khác không làm đổi assignee
     × returnAssignee là participant agent của policy (reviewer): không giao lại
AssertionError: expected [ 'executor_is_current_assignee' ] to deeply equal [ 'executor_is_stage_participant' ]
     × issue gắn kênh chat hoặc executor đang chờ duyệt: không giao lại
AssertionError: expected { …(65) } to match object { Object (assigneeAgentId) }

GREEN: $ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  4 passed (4)
      Tests  105 passed (105)
$ corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issues-service.test.ts src/__tests__/issue-execution-policy.test.ts
 Test Files  2 passed (2)
      Tests  197 passed (197)
$ node crew/release/check-core-hooks.mjs
Hook một dòng: 4/5; mục: 8; lỗi: 0
$ (cd server && corepack pnpm exec tsc --noEmit; echo tsc-exit=$?)
tsc-exit=0
```

Ghi chú: lần RED đầu của ca kênh chat lỗi do fixture (FK `chat_conversations_company_endpoint_fk`); em dựng thêm endpoint/connection rồi mới có RED đúng.
