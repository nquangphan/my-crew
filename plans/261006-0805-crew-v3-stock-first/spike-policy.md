# Spike gói `policy` (S4)

## S4 — chuẩn bị

Trạng thái: đã đọc code, chưa chạy gì. Mọi kỳ vọng dưới đây suy ra từ fork `.worktrees/paperclip-v3` ở tag
`v2026.1001.0` (HEAD `8f8a0ab7e`). Tham chiếu code ghi theo tên symbol và file, không theo số dòng.

### Quy ước dùng trong kịch bản

| Biến | Ý nghĩa |
|---|---|
| `$PC` | URL gốc của server Paperclip do S1 dựng, ví dụ `https://<vps>`; mọi API nằm dưới `$PC/api`. |
| `$BOARD` | Header auth của board user (owner): cookie phiên better-auth lấy từ UI, hoặc `Authorization: Bearer <board key>` lấy qua `paperclipai` CLI auth. Ở chế độ `local_trusted` không cần header, actor mặc định là `local-board`. |
| `$EXEC_KEY`, `$REV_KEY`, `$INT_KEY` | Agent API key của `executor`, `reviewer`, `integrator`, gửi dạng `Authorization: Bearer <key>`. |
| `$CO` | Company id riêng cho S4 (không dùng chung company với S2/S3/S5). |
| `$OWNER` | User id của owner (`GET $PC/api/auth/get-session` trả `user.id`). |
| `$A`, `$B`, `$I` | Issue id tạo trong các bước. |

Cách auth được phân loại (`actorMiddleware` trong `server/src/middleware/auth.ts`):

- Bearer khớp board API key cho actor `board`. Không có bearer nhưng có phiên better-auth cũng cho actor `board`
  (`source: "session"`). Ở chế độ `authenticated`, **mọi thành viên là người** đều là `board`.
- Bearer khớp `agent_api_keys.key_hash` cho actor `agent` (`source: "agent_key"`). Key bắt buộc có
  `responsibleUserId`, nếu không có sẽ trả 403 `RESPONSIBLE_USER_UNAVAILABLE`. Key do `POST /api/agents/:id/keys` tạo,
  route này `assertBoard` và gán `responsibleUserId` bằng user board đang gọi.
- Bearer là JWT agent cấp cho một run cũng cho actor `agent`, với `runId` lấy từ claim. Header `X-Paperclip-Run-Id`
  phải khớp claim.
- Với agent key, `runId` lấy từ header `X-Paperclip-Run-Id` (tùy chọn).

Quyền ghi issue của agent (`assertAgentIssueMutationAllowed` trong `server/src/routes/issues.ts`):

- Issue giao cho agent khác: nếu issue đang `in_progress` thì bị từ chối (`issue_write_assignee_run_lock`). Các trạng
  thái khác thì route PATCH cho qua (`allowVisibleIssueWrite: true`, quy tắc "default-open"); khi đó execution
  policy là lớp chặn tiếp theo.
- Issue giao cho chính agent và đang `in_progress`: bắt buộc có run id (`requireAgentRunId`, thiếu thì trả 401) và
  phải là chủ checkout (`svc.assertCheckoutOwner`). Ở trạng thái khác `in_progress` thì không cần run id.

Hệ quả cho kịch bản: muốn "giả làm agent" bằng curl thì làm khi issue **không** ở `in_progress`. Riêng bước
executor nộp lại sau changes requested (issue bị ép về `in_progress`) thì cần run thật của executor, hoặc để board
nộp lại thay (xem Step 4).

Cách quan sát chung:

- Trạng thái issue: `GET $PC/api/issues/$I` (các trường `status`, `assigneeAgentId`, `assigneeUserId`,
  `executionPolicy`, `executionState`). SQL tương đương:
  `select status, assignee_agent_id, assignee_user_id, execution_state from issues where id = '$I';`
- Quyết định: `select stage_type, outcome, actor_agent_id, actor_user_id, created_by_run_id, body, created_at from issue_execution_decisions where issue_id = '$I' order by created_at;`
- Activity: `GET $PC/api/issues/$I/activity`, hoặc
  `select action, actor_type, actor_id, details->'executionState' from activity_log where entity_id = '$I' order by created_at;`
- Wake và run: `select reason, status, payload->>'issueId', run_id, error from agent_wakeup_requests where company_id = '$CO' order by created_at;`
  và `GET $PC/api/issues/$I/runs`, `GET $PC/api/heartbeat-runs/<runId>`, `GET $PC/api/heartbeat-runs/<runId>/log`.
- Lỗi 422 bị từ chối không ghi activity. Chỉ có `logger.warn` trong route PATCH, nên phải đọc log server
  (stdout của process server ghi trong `processes.md`).

### Chuẩn bị agent cho Step 1–5

Để Step 1–5 cho kết quả tất định, ba agent dùng adapter `process` với lệnh vô hại (ví dụ `command: "true"`). Wake
vẫn sinh run thật (quan sát được), nhưng agent không tự PATCH gì. Mọi quyết định do curl gửi bằng key của từng
agent. Không đặt `runtimeConfig.heartbeat.wakeOnDemand=false`, vì cờ này chặn mọi wake không phải timer
(`isHeartbeatWakeOnDemandEnabled`, kiểm ở `enqueueWakeup`), kể cả wake cần quan sát ở Step 5.

Lưu ý phụ: run của adapter `process` không comment nên cơ chế "comment required" sẽ wake lại một lần
(`retry_queued` rồi `retry_exhausted`). Đó là nhiễu dự kiến, không phải lỗi.

---

### Step 1 — Tạo ba agent và issue có policy ba stage

Request:

```bash
# 1a. Tạo agent (lặp cho executor, reviewer, integrator)
POST $PC/api/companies/$CO/agents            # $BOARD
{ "name": "executor", "role": "general", "adapterType": "process",
  "adapterConfig": { "command": "true" } }

# 1b. Cấp key cho từng agent
POST $PC/api/agents/<agentId>/keys           # $BOARD
{ "name": "s4-spike" }                       # response chứa token, chỉ hiện một lần

# 1c. Tạo issue
POST $PC/api/companies/$CO/issues            # $BOARD
{ "title": "S4 gate test", "status": "todo", "assigneeAgentId": "<executor>",
  "executionPolicy": { "mode": "normal", "commentRequired": true, "stages": [
    { "type": "review",   "participants": [ { "type": "agent", "agentId": "<reviewer>" } ] },
    { "type": "review",   "participants": [ { "type": "agent", "agentId": "<integrator>" } ] },
    { "type": "approval", "participants": [ { "type": "user",  "userId": "$OWNER" } ] } ] } }
```

Kỳ vọng theo code:

- `normalizeIssueExecutionPolicy` (`server/src/services/issue-execution-policy.ts`) sinh `id` cho stage và
  participant. Stage không còn participant hợp lệ thì bị bỏ. `maxReviewRounds` mặc định là `null`, tức dùng
  `DEFAULT_MAX_REVIEW_ROUNDS = 3`.
- Issue do board tạo nên có `createdByUserId = $OWNER`. Giá trị này là đích escalation ở Step 4
  (`reviewEscalationUserId` ưu tiên `responsibleUserId`, rồi tới `createdByUserId`).

Quan sát: `GET /api/issues/$I`, kiểm `executionPolicy.stages` có ba id, `executionState` là `null`.

### Step 2 — Đường thuận

| # | Actor | Request | Kỳ vọng (theo `applyIssueExecutionStageTransition`) |
|---|---|---|---|
| 2a | executor (`$EXEC_KEY`, issue đang `todo`) | `PATCH /api/issues/$I` `{ "status": "done", "comment": "Xong phần thực thi." }` | Nhánh `shouldStartWorkflow`: status thành `in_review`, assignee thành reviewer, `executionState.status=pending`, `currentStageIndex=0`, `returnAssignee=executor`. Không có decision. Có wake `execution_review_requested` cho reviewer (`buildExecutionStageWakeup`). |
| 2b | reviewer (`$REV_KEY`) | `PATCH` `{ "status": "done", "comment": "Reviewer: approve." }` | Nhánh participant, `requestedStatus=done`: ghi decision `approved` cho stage 0. `nextPendingStageAfter` trả stage 1 nên chuyển cho integrator, status vẫn `in_review`. Wake `execution_review_requested` cho integrator. |
| 2c | integrator (`$INT_KEY`) | `PATCH` `{ "status": "done", "comment": "Integrator: docs ok, approve." }` | Decision `approved` cho stage 1. Chuyển sang stage 2 (approval), assignee thành `assigneeUserId=$OWNER`. Không wake agent nào vì participant là user. |
| 2d | owner (`$BOARD`) | `PATCH` `{ "status": "done", "comment": "Owner duyệt." }` | Owner chính là `currentParticipant`, nên đi nhánh participant trước nhánh board override. Decision `approved` cho stage 2, `executionState.status=completed`, issue `done`. |

Quan sát: sau mỗi bước chạy hai SQL "trạng thái issue" và "quyết định". Cuối Step 2 phải có ba dòng
`issue_execution_decisions` (`review/approved/actor_agent_id=reviewer`, `review/approved/actor_agent_id=integrator`,
`approval/approved/actor_user_id=$OWNER`). Bước 2d cần Đại Ca tự bấm Approve trên UI hoặc cấp phiên board cho
worker (đã ghi ở cột "Cần Đại Ca" của S4).

Ghi chú từ code (để đối chiếu, không cần làm thêm):

- Thiếu `comment` hoặc comment chỉ có khoảng trắng thì trả 422 ("Approving a review or approval stage requires a
  comment...").
- Route `POST /api/issues/:id/comments` có đường tự duyệt: comment của participant hiện tại khớp
  `isApprovalReviewComment` (heading `## Review: APPROVED`, hoặc hai dòng liền `kind: review` / `decision: approved`)
  sẽ gọi `applyIssueExecutionPolicyTransition` với `requestedStatus: "done"`. Điểm này khác với
  `docs/guides/execution-policy.md`, vốn nói comment rời không tính là quyết định. Nên thử một lần ở 2b bằng comment
  dạng này trên một issue phụ.

### Step 3 — Thử bỏ qua gate

Dựng lại một issue mới theo Step 1 và đi tới 2a, để issue ở stage reviewer (`in_review`, assignee reviewer).

| # | Thử | Request | Kỳ vọng theo code |
|---|---|---|---|
| 3a | Executor tự đóng khi đang ở stage reviewer | `$EXEC_KEY` `PATCH` `{ "status": "done", "comment": "tự đóng" }` | Qua `assertAgentIssueMutationAllowed` (issue không `in_progress`). Trong transition: actor không phải `currentParticipant`, `attemptedStageAdvance=true`, state không lệch, nên **422** "Only the active reviewer or approver can advance the current execution stage". |
| 3b | Executor tự đổi assignee về mình | `$EXEC_KEY` `PATCH` `{ "assigneeAgentId": "<executor>" }` | Cũng là `attemptedStageAdvance` nên **422**. |
| 3c | Executor xóa policy rồi đóng | `$EXEC_KEY` `PATCH` `{ "executionPolicy": null }`, sau đó `PATCH` `{ "status": "done", "comment": "..." }` | **Nghi là bypass.** Route PATCH không có kiểm quyền nào riêng cho việc agent sửa `executionPolicy` (chỉ có `assertCanManageIssueMonitor` cho phần monitor). Khi policy là `null`: `executionState=null`, status thành `in_progress`, trả về executor. Lần PATCH thứ hai đóng được nếu có run id của executor (issue đang `in_progress`). Ghi lại kết quả thật của cả hai lần gọi. |
| 3d | Executor sửa policy để bỏ stage owner | `$EXEC_KEY` `PATCH` `{ "executionPolicy": { "stages": [ <chỉ stage reviewer> ] } }` | Id stage được sinh mới, `existingState.currentStageId` không còn trong policy nên `clearExecutionStatePatch` chạy và issue về executor. Sau đó executor nộp lại thì chỉ còn một stage reviewer, **gate owner mất**. Cần xác nhận khi chạy. |
| 3e | Reviewer tự review task mình thực thi (cấu hình) | Issue mới: `assigneeAgentId=<reviewer>`, policy chỉ có stage review với participant `<reviewer>`. Reviewer `PATCH` `{ "status": "done", "comment": "..." }` | `selectStageParticipant` loại trừ `returnAssignee` nên không còn ai. `canAutoSkipPendingStage` đúng (stage review, mọi participant đều là executor) nên **stage bị bỏ qua lặng lẽ**, `executionState=completed`, issue `done`. Nếu stage là `approval` thì trả 422 "No eligible approval participant". |
| 3f | Reviewer tự review (cấu hình có hai participant) | Như 3e nhưng stage review có `[reviewer, integrator]` | Chọn integrator, vì đã loại reviewer (executor). |
| 3g | Board override (đối chứng) | `$BOARD` `PATCH` `{ "status": "done" }` khi đang ở stage reviewer | `allowBoardOverride = req.actor.type === "board"`: `executionState=null`, issue `done`, **không** ghi decision. Đây là bypass có chủ đích. Mọi user người trong company đều là board. |
| 3h | Plugin hoặc service nội bộ (chỉ ghi nhận) | `ctx.issues.update(...)` từ plugin (`plugin-host-services.ts`, `issues.update`) | Đi thẳng `issueService.update`, không qua `applyIssueExecutionPolicyTransition`. Đây là lý do của hook H2 ở `runUpdate`. Chỉ chạy được nếu S4 có plugin cài sẵn; nếu không thì để S6 kiểm. |

Quan sát: ghi request và response (ẩn token) của từng thử, kèm hai SQL trạng thái và quyết định trước và sau. Với
422, lấy dòng `logger.warn` trong log server. Với 3c/3d/3g, kiểm `activity_log` có `issue.updated` với
`details.executionPolicy` hoặc `details.executionState`.

### Step 4 — Vòng sửa sáu lần

Theo code, rule "tối đa N vòng rồi chuyển owner" **đã có sẵn ở stock**:
`DEFAULT_MAX_REVIEW_ROUNDS = 3`, policy cho đặt `maxReviewRounds` (1–50, `issueExecutionPolicySchema` trong
`packages/shared/src/validators/issue.ts`). Biến đếm `executionState.changesRequestedCount` chỉ tăng khi agent
request changes. Khi `nextRounds >= maxReviewRounds` và có `responsibleUserId`/`createdByUserId`, stage vẫn
`pending` nhưng được giao cho người đó (escalation). Từ đó agent reviewer gửi tiếp sẽ nhận 422 "Only the escalated
reviewer can advance the current execution stage". Quyết định của người reset biến đếm về 0.

Vì vậy "sáu lần liên tiếp" chia làm hai biến thể:

- **4a (mặc định, `maxReviewRounds` null):** kỳ vọng lần request changes thứ 3 escalate sang `$OWNER`, lần thứ 4
  của reviewer bị 422.
- **4b (`maxReviewRounds: 5`, khớp rule Crew):** kỳ vọng lần 1–4 trả về executor
  (`executionState.status=changes_requested`, status `in_progress`), lần 5 escalate sang owner, lần 6 bị 422.
- **4c (tùy chọn, `maxReviewRounds: 10`):** kỳ vọng sáu vòng đều trả về executor. Đây là biến thể đúng nghĩa đen
  của Step 4 trong plan.

Mỗi vòng:

```bash
# reviewer request changes (issue in_review, assignee reviewer)
PATCH $PC/api/issues/$I     # $REV_KEY
{ "status": "in_progress", "comment": "Changes requested vòng <n>: ..." }

# nộp lại: issue đang in_progress và giao executor, nên executor cần run id + checkout.
# Phương án tất định: board nộp lại thay executor (nhánh shouldStartWorkflow không kiểm actor).
PATCH $PC/api/issues/$I     # $BOARD
{ "status": "done", "comment": "Nộp lại vòng <n>" }
```

Kỳ vọng phụ: nộp lại quay về **đúng stage hiện tại** (`existingState.status === changes_requested` thì
`pendingStage = currentStage`), và reviewer được ưu tiên vì là `currentParticipant` cũ. Việc board nộp lại không
reset biến đếm, vì chỉ quyết định của người ở stage mới reset.

Event cho plugin: SDK **không có** event riêng cho execution decision. `PLUGIN_EVENT_TYPES` trong
`packages/shared/src/constants.ts` chỉ có `issue.updated`, `issue.comment.created`, `approval.decided`... Mỗi PATCH
thành công ghi activity `issue.updated`; `persistActivity` (`server/src/services/activity-log.ts`) biến nó thành
plugin event `issue.updated` với payload là `details` đã redact, gồm `updateFields` (có `executionState` với
`changesRequestedCount`, `lastDecisionOutcome`, `lastDecisionId`). Lần 422 không phát event. Kỳ vọng: mỗi vòng có
đúng một `issue.updated` mang `lastDecisionOutcome=changes_requested`.

Quan sát: không cần plugin để đếm. Dùng
`select created_at, details->'executionState'->>'changesRequestedCount', details->'executionState'->>'lastDecisionOutcome' from activity_log where entity_id='$I' and action='issue.updated' order by created_at;`
cùng bảng `issue_execution_decisions` (mỗi vòng một dòng `changes_requested`, kể cả lần escalate). Nếu S4 có
plugin mẫu của SDK (`packages/plugins/examples`) subscribe `issue.updated` thì đối chiếu số event nhận được với số
dòng activity.

### Step 5 — Blockers

```bash
POST $PC/api/companies/$CO/issues    # $BOARD — A
{ "title": "S4 A", "status": "todo", "assigneeAgentId": "<executor>" }
POST $PC/api/companies/$CO/issues    # $BOARD — B bị A chặn
{ "title": "S4 B", "status": "todo", "assigneeAgentId": "<executor>", "blockedByIssueIds": ["$A"] }
# thử ép wake B
POST $PC/api/agents/<executor>/wakeup  # $BOARD
{ "reason": "s4_force", "payload": { "issueId": "$B" } }
# thử comment của người lên B (ngoại lệ có chủ đích)
POST $PC/api/issues/$B/comments        # $BOARD   { "body": "hỏi thăm" }
# đóng A (A không có policy)
PATCH $PC/api/issues/$A                # $BOARD   { "status": "done" }
```

Kỳ vọng theo code:

- Quan hệ lưu ở `issue_relations` với `issue_id` là blocker (A), `related_issue_id` là issue bị chặn (B),
  `type='blocks'`.
- Trong `enqueueWakeup` (`heartbeat.ts`), `listDependencyReadiness` cho `isDependencyReady=false`, nên wake bị ghi
  thành request `skipped` với `reason='issue_dependencies_blocked'` (qua `recordExecutionWait`) và không tạo run.
- Lớp chặn thứ hai: `claimQueuedRun` hủy run đã queue nếu còn blocker (`cancelQueuedRunForBlockedDependencies`,
  `errorCode='issue_dependencies_blocked'`).
- Ngoại lệ: comment hoặc mention của người được phép wake ở chế độ tương tác có giới hạn
  (`allowsIssueInteractionWake` với `ISSUE_TREE_CONTROL_INTERACTION_WAKE_REASONS`; context có
  `dependencyBlockedInteraction=true`).
- Khi A `done`, route PATCH tạo wake `reason='issue_blockers_resolved'` cho assignee của B
  (`addDependencyResolvedWakeup`), activity `issue.blockers_resolved_wake_emitted`.
- Plugin `ctx.issues.requestWakeup` cũng từ chối issue còn blocker ("Issue is blocked by unresolved blockers").

Quan sát:
`select reason, status, payload->>'issueId', run_id from agent_wakeup_requests where agent_id='<executor>' order by created_at;`,
`select id, status, error_code, context_snapshot->>'wakeReason' from heartbeat_runs where context_snapshot->>'issueId'='$B';`,
và activity của B.

### Step 6 — Dùng chung session giữa hai issue

Cơ chế session theo code:

- `deriveTaskKey(contextSnapshot, payload)` (`heartbeat.ts`) lấy theo thứ tự `contextSnapshot.taskKey`, `taskId`,
  `issueId`, rồi `payload.taskKey`, `taskId`, `issueId`. `deriveTaskKeyWithHeartbeatFallback` chỉ thêm
  `__heartbeat__` cho wake timer không gắn issue.
- `enrichWakeContextSnapshot` tính `taskKey` **trước** khi chép `payload.issueId` vào `contextSnapshot`, rồi ghi
  `contextSnapshot.taskKey`. Nếu caller không đặt sẵn `issueId`/`taskId` trong contextSnapshot thì `payload.taskKey`
  thắng `payload.issueId`.
- Khi chạy run, `getTaskSession(company, agent, adapterType, taskKey)` đọc `agent_task_sessions`. Unique index trên
  `(company_id, agent_id, adapter_type, task_key)`. `upsertTaskSession` ghi lại theo cùng `taskKey`.
- Có một đường thứ hai: `payload.resumeFromRunId`. `resolveExplicitResumeSessionOverride` lấy session của một run cũ
  (cùng agent, cùng company) và đặt `contextSnapshot.resumeSessionParams`. Khi chọn session cho run,
  `previousSessionParams = explicitResumeSessionParams ?? ... taskSessionForRun`, nghĩa là resume tường minh thắng
  cả việc reset session.
- Một số wake reason ép session mới (`shouldResetTaskSessionForWake`): `issue_assigned`,
  `execution_approval_requested`, wake khôi phục participant review, timer không gắn issue, và
  `forceFreshSession=true`. Wake `execution_changes_requested`, `execution_review_requested`,
  `issue_blockers_resolved` và comment thì **không** reset.
- Adapter `claude_local` (`packages/adapters/claude-local/src/server/execute.ts`) chỉ `--resume` khi cwd lưu trong
  session params khớp cwd thực thi, prompt bundle khớp, MCP server khớp và execution target khớp. Vì vậy A và B phải
  chạy trên **cùng execution workspace** (cùng project workspace, không dùng worktree riêng cho từng issue).

Đường stock đặt được `taskKey` hoặc session do caller chọn:

| Đường | Đặt được taskKey/session? | Ghi chú |
|---|---|---|
| `POST /api/agents/:id/wakeup` (`wakeAgentSchema`, `handleWakeupRoute` trong `routes/agents.ts`) | **Có.** `payload` là record tự do: `payload.taskKey` hoặc `payload.resumeFromRunId`. | Gọi được bằng board (`assertBoardCanWakeAgent`) hoặc chính agent đó ("Agent can only invoke itself"). Payload của agent chỉ bị xóa `commentId`/`wakeCommentId(s)`. |
| `POST /api/agents/:id/heartbeat/invoke` (legacy) | Có, qua `payload`, cùng logic. | Tương tự route trên. |
| Tạo issue, PATCH (assign, status, review stage), comment, blockers resolved | **Không.** `contextSnapshot` do server dựng, luôn `issueId=taskId=<issue>`. | `issue_assigned` còn ép session mới. |
| Plugin `ctx.issues.requestWakeup(s)` | **Không.** `contextSnapshot.taskId = issue.id`, cố định. | |
| Plugin `ctx.agents.invoke` | Không có issue context, không có taskKey. | |
| Plugin `ctx.agents.sessions.create/sendMessage` | Đặt được taskKey, nhưng `sendMessage` chỉ chấp nhận key dạng `plugin:<pluginKey>:session:%` và không gắn issue. | Không dùng được cho run của một issue. |

Kịch bản chạy thật (cần adapter có session thật, xem câu hỏi Q1):

1. Tạo A và B (B bị A chặn), cả hai giao `executor` (`claude_local`), cùng project workspace.
2. Để A chạy tới `done`. Ghi `heartbeat_runs.session_id_after` của run cuối của A (`$RUN_A`) và dòng
   `agent_task_sessions` có `task_key='$A'`.
3. Đối chứng: run tự động của B (`issue_blockers_resolved`) dự kiến có `task_key='$B'` và session **mới**.
4. Thử 6a, dùng taskKey:
   `POST /api/agents/<executor>/wakeup` `{ "reason": "s4_shared_session", "payload": { "issueId": "$B", "taskKey": "$A" } }`.
   Kỳ vọng: `context_snapshot->>'taskKey' = '$A'`, `issueId = '$B'`, `session_id_before` bằng session của A, log run
   có `--resume <id của A>` và không có dòng "will not be resumed".
5. Thử 6b, dùng resumeFromRunId:
   `{ "payload": { "issueId": "$B", "resumeFromRunId": "$RUN_A" } }`. Kỳ vọng: run resume session của A, sau run
   `agent_task_sessions(task_key='$B')` mang session đó, nên các wake sau của B (comment, changes requested) tiếp tục
   session đó mà không cần gọi lại.

Quan sát:
`select task_key, session_display_id, last_run_id, updated_at from agent_task_sessions where agent_id='<executor>';`,
`select id, context_snapshot->>'issueId', context_snapshot->>'taskKey', session_id_before, session_id_after from heartbeat_runs where agent_id='<executor>' order by created_at;`,
`GET /api/agents/<executor>/task-sessions`, `GET /api/heartbeat-runs/<id>/log` (tìm `--resume` và các dòng
`[paperclip] Claude session ...`), và khối session trong `result_json` (`reset`, `taskSessionReused`).

**Kết luận sơ bộ (đọc code, chưa chạy):**

- Có đường API stock: `POST /api/agents/:id/wakeup` với `payload.taskKey=<A>` (hoặc `payload.resumeFromRunId=<run
  cuối của A>`) và `payload.issueId=<B>`. Nếu chạy thật xác nhận thì Step 6 thuộc loại **"làm được qua API stock"**.
- Đường này chỉ dùng được khi **có ai đó gọi wake thủ công**. Mọi wake tự động của Paperclip đều dùng
  `taskKey = issue id`, và plugin SDK không có API nào đặt taskKey hay resumeFromRunId cho wake của một issue. Muốn
  tự động hóa không cần hook thì phải có thành phần ngoài lõi gọi REST bằng credential board hoặc agent, ví dụ plugin
  Crew dùng HTTP với key đã lưu, hoặc CLI Crew trên Mac. Cách này vẫn đua với wake tự động `issue_blockers_resolved`
  (run B mở session mới trước). Phương án 6b giảm được vấn đề, vì sau một lần resume thì session đã nằm dưới taskKey
  của B.
- Nếu muốn mọi wake của B tự kế thừa session của A, cần **hook lõi**. Vị trí hợp lý nhất là một dòng ở đầu
  `enqueueWakeup` trong `heartbeat.ts`, viết lại `opts.payload`/`opts.contextSnapshot` (đặt `taskKey` hoặc
  `resumeFromRunId` theo chuỗi issue). Hook phải async (đọc quan hệ issue trong DB) nhưng vẫn là một dòng
  `await crewHooks.beforeWakeup(...)`. Không đặt ở `deriveTaskKey`: đây là hàm sync thuần, được gọi ở nhiều chỗ, nên
  đổi ở đó sẽ là patch sâu. Hook `enqueueWakeup` không vượt được việc `issue_assigned` reset session, trừ khi hook
  đặt `resumeFromRunId`, vì resume tường minh thắng reset.

### Câu hỏi chỉ trả lời được khi chạy thật

1. **Q1 — Adapter cho Step 6.** Plan ghi S4 "chạy được với agent local trên máy chủ", nhưng Global Constraints cấm
   credential AI trên VPS. Step 6 cần adapter sinh session thật (`claude_local`). Cần Trợ Lý chốt: chạy Step 6 qua
   SSH environment của Mac (sau S2), hay có adapter không cần credential mà vẫn có session để thử trên VPS.
2. 3c/3d: agent có thật sự sửa hoặc xóa `executionPolicy` được không. Code route không chặn, nhưng
   `access.decide("issue:mutate")` theo key scope có thể chặn. Nếu bypass được thì đây là đường vòng lớn nhất, và H2
   (chặn `done` khi chưa qua đủ stage) không bắt được nếu policy đã bị xóa trước đó.
3. 3e: stage review chỉ có executor có bị auto-skip thật không, và có ghi activity nào cho việc skip không.
4. Bước nộp lại sau changes requested: agent key không có run id có làm được không
   (`assertCheckoutOwner` khi `checkoutRunId` đã bị xóa), hay bắt buộc run thật.
5. Step 4: payload của plugin event `issue.updated` sau redaction (`sanitizeRecord`) có còn `executionState` đủ để
   plugin đếm vòng không.
6. Đường tự duyệt bằng comment `## Review: APPROVED` có chạy đúng như code và có ghi `issue_execution_decisions` không.
7. Step 5: B tạo với blocker có tự chuyển `status=blocked` không. Wake ép bằng API có chỉ ghi `skipped` (không tạo
   run) không. Sau khi A `done` có đúng một wake `issue_blockers_resolved` không.
8. Step 6: `payload.taskKey` có bị lớp nào sau `enrichWakeContextSnapshot` ghi đè không (coalesce theo
   `isSameTaskScope`, execution lock của issue B). Run B có tranh với run tự động `issue_blockers_resolved` không.
9. Step 6: khi Claude Code `--resume`, session id sau run giữ nguyên hay sinh id mới, và `agent_task_sessions` của A
   có bị run B ghi đè `last_run_id` không (6a ghi dưới taskKey của A).
10. Step 6: issue B chạy với `taskKey` của A có làm sai các cơ chế khác gắn với taskKey không (comment-required
    backstop, continuation summary, `upsertTaskSession` khóa issue theo `task_key`).
11. Chế độ deploy của server S1 (`local_trusted` hay `authenticated`) và cách worker lấy auth board (cookie hay board
    key) để chạy Step 2d, 3g và 4.

---

## S4 — chạy thật (Step 1–5)

Thời điểm: 06/10/2026, khoảng 10:00–10:08 (Asia/Ho_Chi_Minh). Server S1 `http://100.105.105.12:3100`,
`authenticated/private`, image `ghcr.io/paperclipai/paperclip:2026.1001.0`. Step 6 chưa chạy, chờ S2 có login Claude
trên Mac mini.

### Môi trường chạy và cách gọi

- Mọi lệnh chạy trên VPS (`ssh nhamoiplatform`). Helper tạm nằm trong `/tmp/s4spike` (root, chmod 700), không đụng
  `/opt/crew-v3-spike`:
  - `b.sh`: gọi API bằng cookie board (cùng cookie jar với `api.sh`).
  - `ak.sh <agent>`: gọi API bằng `Authorization: Bearer [redacted agent key]`, thêm `X-Paperclip-Run-Id: $RUN` khi
    có biến `RUN`.
  - `q.sh`: `docker compose -p crew-v3-spike exec -T db psql -U paperclip -d paperclip`, chỉ dùng SELECT.
  - `st.sh`, `mk.sh`, `own.sh`, `loop4.sh`: tóm tắt trạng thái, tạo issue, chờ run đang chạy, chạy vòng Step 4.
- Key agent lưu trong `/tmp/s4spike/<agent>.key` (chmod 600). Chưa từng in ra output hay ghi vào repo.
- Board = tài khoản owner của Đại Ca (user `Mtye1JcS4JUc3lTZj51hI7nfz1pqMPSI`). **Owner approve ở 2d đi qua API bằng
  cookie board**, không bấm UI.

| Đối tượng | ID |
|---|---|
| Company `Crew Spike Policy` (prefix `CREA`) | `0e73c3ec-caeb-4e90-8097-b4730c5fdcae` |
| Agent `executor` (`process`) | `64d0c707-32e4-48af-9fa2-0e9bcfad0a49` |
| Agent `reviewer` (`process`, `command: true`) | `8eb687b6-f5a6-4839-81ca-46e4e493cdd0` |
| Agent `integrator` (`process`, `command: true`) | `328b852e-cd66-47a1-8c74-3052706467a6` |
| Agent key (`POST /api/agents/:id/keys`, tên `s4-spike`) | executor `b996d158-…`, reviewer `dff9412a-…`, integrator `c317dab1-…`; token [redacted] |

Không đụng company `Crew Spike`, environment `mac-mini` hay agent `mac-claude`. Không restart container, không ghi
DB. Cuối phiên đã **pause** ba agent S4 (`POST /api/agents/:id/pause`) để không còn wake hay timer nào chạy tiếp.

### Hai điều chỉnh so với phần chuẩn bị (phát hiện khi chạy)

1. **Mọi ghi của agent đều cần run id.** `assertCrossIssueInfluenceWithinRunCap` trả **403**
   `cross_issue_influence_run_context_required` cho mọi PATCH có comment của agent nếu thiếu
   `X-Paperclip-Run-Id`, kể cả khi agent là assignee hay participant hiện tại (reviewer ở 2b lần đầu cũng bị chặn).
   Run id **không cần đang chạy**: run đã `succeeded` hay `cancelled` của chính agent đó vẫn được chấp nhận cho các
   issue không ở `in_progress`. Phần chuẩn bị đã sai khi nói "issue không ở `in_progress` thì không cần run id".
2. **Executor làm việc trên issue `in_progress` cần run đang giữ checkout.** Thiếu run id thì trả 401 `Agent run id
   required`. Dùng run cũ đã kết thúc thì trả 409 `Issue run ownership conflict` (`checkoutRunId: null`). Vì vậy
   executor được đổi từ `command: "true"` sang `command: "sleep", args: ["60"]`
   (`PATCH /api/agents/<executor>` bằng board), để mỗi lần wake có một run sống khoảng 60 giây. Executor gửi PATCH
   bằng key của mình kèm `X-Paperclip-Run-Id` = run đang giữ checkout (`own.sh` đọc `issues.checkout_run_id`).
   Reviewer và integrator vẫn dùng `true`.

### Chỗ board làm thay agent

| Chỗ | Lý do |
|---|---|
| Step 4a/4b: lần nộp đầu và mọi lần nộp lại sau changes requested (`PATCH {status:"done"}` bằng board) | Theo quyết định của Trợ Lý. Nhánh `shouldStartWorkflow` không kiểm actor nên board nộp được, `returnAssignee` vẫn là executor. Việc này không reset biến đếm. |
| Step 2d: owner approve | Owner là board; approve qua API. |
| Step 5: đóng issue A | A không có policy; dùng board cho nhanh. |
| Step 5: comment của người lên B | Đúng vai owner/người. |

Executor tự nộp (2a, 3c, 3d, 3e, 3f, 3e2) bằng key của mình và run sống. Reviewer và integrator tự quyết bằng key của
mình và run id gần nhất.

### Step 1 — Tạo agent và issue: ĐẠT

- `POST /api/companies` `{name:"Crew Spike Policy"}` trả 201. Ba lần `POST /api/companies/$CO/agents` trả 201. Ba lần
  `POST /api/agents/:id/keys` trả 201; response có `token` (đã lưu file, không in) và `responsibleUserId` = owner.
- `POST /api/companies/$CO/issues` với policy ba stage (review reviewer → review integrator → approval user owner)
  trả 201, issue **CREA-1** `4df65adc-5a28-4d22-8b02-351e657d057d`. Policy lưu ba stage có id sinh tự động.
  `createdByUserId` = `responsibleUserId` = owner.
- Issue tạo ở `todo` nhưng assignment wake của executor checkout ngay nên chuyển `in_progress`.

### Step 2 — Đường thuận (CREA-1): ĐẠT

| # | Request (đã ẩn token) | Response | Trạng thái sau |
|---|---|---|---|
| 2a | executor `PATCH /issues/CREA-1 {status:"done", comment:"Executor: xong phan thuc thi."}` + `X-Paperclip-Run-Id: 12e615e6-…` (run sống) | 200 | `in_review`, assignee reviewer, `executionState pending`, stage 0. Có run reviewer `execution_review_requested`. Run executor bị cancel khi issue rời `in_progress`. |
| 2b | reviewer `PATCH {status:"done", comment:"Reviewer: approve, code va test on."}` + run `fcf9617a-…` (đã `succeeded`) | 200 | `in_review`, assignee integrator, stage 1, `completedStageIds` có 1 stage |
| 2c | integrator `PATCH {status:"done", comment:"Integrator: docs va merge gate on, approve."}` + run `26dd560c-…` | 200 | `in_review`, `assigneeUserId` = owner, stage 2 (approval) |
| 2d | **board (owner) qua API** `PATCH {status:"done", comment:"Owner duyet (qua API bang board)."}` | 200 | `done`, `executionState.status=completed`, ba stage hoàn tất |

`issue_execution_decisions` của CREA-1 có ba dòng: `review/approved/reviewer` (có `created_by_run_id`),
`review/approved/integrator` (có run), `approval/approved/actor_user_id=owner` (không có run).

Thêm: **tự duyệt bằng comment** (CREA-6, stage review của reviewer). Reviewer
`POST /issues/CREA-6/comments {body:"## Review: APPROVED\n\nCode on."}` trả 201, issue thành `done`, có decision
`review/approved` với body là comment đó. Đúng như code, và khác `docs/guides/execution-policy.md`.

### Step 3 — Thử bỏ qua gate

| # | Thử | Request | Response | Kết luận |
|---|---|---|---|---|
| 3a | Executor đóng khi đang ở stage reviewer, không run id | executor `PATCH CREA-1 {status:"done", comment:…}` | 403 `cross_issue_influence_run_context_required` | Chặn (ở lớp run context) |
| 3a | Như trên, có run id, ở stage integrator | + `X-Paperclip-Run-Id` executor | **422** "Only the active reviewer or approver can advance the current execution stage" | **Chặn đồng bộ** |
| 3a | Executor đóng ở stage owner | như trên | **422** cùng thông báo | **Chặn đồng bộ** |
| 3a' | Reviewer duyệt thay integrator (stage 1) | reviewer `PATCH {status:"done"}` | **422** cùng thông báo | **Chặn đồng bộ** |
| 3b | Executor tự đổi assignee về mình | executor `PATCH {assigneeAgentId:<executor>}` | **422** cùng thông báo | **Chặn đồng bộ** |
| 3c | Executor xóa policy rồi đóng (**CREA-2**) | (1) executor `PATCH {executionPolicy:null}` + run `9d6eb9c3-…` → (2) executor `PATCH {status:"done", comment:…}` + run mới `7bc4f1a2-…` | (1) **200**: policy null, `in_progress`, giao lại executor; (2) **200**: `done` | **BYPASS XÁC NHẬN.** Executor tự đóng trong 11 giây, **0 dòng** `issue_execution_decisions`. Chỉ thấy sau commit qua `activity_log` (`issue.updated` có `changes.executionPolicy`). |
| 3d | Executor rút gọn policy, bỏ stage integrator và owner (**CREA-3**) | executor `PATCH {executionPolicy:{stages:[review reviewer]}}` khi đang ở stage reviewer → nộp lại → reviewer approve | 200 / 200 / 200 | **BYPASS XÁC NHẬN.** Issue `done` chỉ với một decision `review/approved`; gate integrator (docs) và gate owner biến mất. |
| 3e | Stage review chỉ có executor (**CREA-5**) | executor `PATCH {status:"done"}` + run sống | 200, `done`, `executionState.completed` | **BYPASS XÁC NHẬN (do cấu hình).** Stage bị auto-skip, **0 decision**, activity chỉ có `issue.updated` với status done, không có dấu hiệu "skipped". |
| 3e2 | Stage approval chỉ có executor (**CREA-7**) | như trên | **422** "No eligible approval participant is configured for this issue" | Chặn đồng bộ |
| 3f | Stage review có `[executor, reviewer]` (**CREA-6**) | như trên | 200, `in_review`, participant = reviewer | Đúng: executor bị loại, chọn reviewer |
| 3g | Board ép `done` ở stage reviewer (**CREA-4**) | board `PATCH {status:"done"}` (không comment) | 200, `done`, `executionState=null` | **Bypass có chủ đích**, 0 decision, không cần comment. Mọi user người trong company đều là board. |
| 3h | Plugin `ctx.issues.update` | — | — | **Chưa chạy**: chưa có plugin cài trên S4. Để S6 kiểm cùng hook H2. |

Không đọc log server cho các lần 422. Response API đã đủ làm bằng chứng, và các lần thử bị từ chối không ghi activity
(đã kiểm activity của CREA-1: không có dòng nào cho 3a/3b).

### Step 4 — Vòng sửa: ĐẠT, rule "tối đa N vòng rồi chuyển owner" có sẵn ở stock

**4b — CREA-8**, policy `{maxReviewRounds: 5, stages:[review reviewer]}`. Reviewer gửi
`PATCH {status:"in_progress", comment:"Changes requested vong n"}` kèm run id; board nộp lại sau mỗi vòng.

| Vòng | Response reviewer | Sau đó |
|---|---|---|
| 1–4 | 200 | `in_progress`, giao executor, `executionState=changes_requested`, `changesRequestedCount` = 1..4. Board nộp lại thì về đúng stage cũ, reviewer làm participant. |
| 5 | 200 | **Escalate**: `in_review`, `assigneeUserId` = owner, `executionState=pending`, participant = owner, `changesRequestedCount=5` |
| 6 | **422** "Only the escalated reviewer can advance the current execution stage" | Không đổi |

`issue_execution_decisions` của CREA-8 có 5 dòng `changes_requested/reviewer`; vòng 5 vẫn ghi decision. Wake: 4 run
executor `execution_changes_requested` và 5 run reviewer `execution_review_requested` (đều bị cancel vì board hoặc
reviewer đổi trạng thái ngay).

**4a — CREA-9**, policy mặc định (`maxReviewRounds` null). Vòng 1–2 trả về executor; vòng 3 escalate sang owner;
vòng 4 trả 422 cùng thông báo. Đúng với `DEFAULT_MAX_REVIEW_ROUNDS = 3`.

**Event cho plugin:** chưa cài plugin nên chưa đo trực tiếp số event plugin nhận. Bằng chứng gián tiếp:
`activity_log` của CREA-8 có **đúng một** `issue.updated` cho mỗi PATCH thành công (10 dòng: 5 của user nộp, 5 của
agent quyết định). Mỗi dòng mang `details.executionState.changesRequestedCount` và `lastDecisionOutcome`. Theo
`persistActivity`, mỗi dòng này phát plugin event `issue.updated` với payload là `details` đã redact. Lần 422 không
có activity, nên không có event. Kết luận: plugin đếm được vòng từ `issue.updated`, nhưng **không cần plugin cho rule
5 vòng**, chỉ cần đặt `maxReviewRounds: 5` trong policy.

### Step 5 — Blockers: ĐẠT

A = **CREA-10** `3741a18b-…`, B = **CREA-11** `dd0f8d7a-…` (`blockedByIssueIds:[A]`), cả hai giao executor.

- `issue_relations`: `issue_id=A`, `related_issue_id=B`, `type=blocks`. B tạo ở `todo` và **không** tự chuyển
  `blocked`.
- Wake khi tạo B và wake ép bằng `POST /api/agents/<executor>/wakeup {payload:{issueId:B}}` (trả 202
  `{"status":"skipped"}`) đều thành `agent_wakeup_requests` `reason=issue_dependencies_blocked`, `status=skipped`,
  không có run, payload ghi `unresolvedBlockerIssueIds=[A]`.
- Comment của người lên B (`POST /issues/B/comments` bằng board): **có** run `issue_commented` với
  `dependencyBlockedInteraction=true`. Đây là ngoại lệ có chủ đích (chế độ tương tác giới hạn), không phải lỗi.
- Board đóng A thì có activity `issue.blockers_resolved_wake_emitted`. Wake của B lúc đó `deferred_issue_execution`
  vì run comment đang chạy; khi run đó xong thì được promote (`issue_execution_promoted`) thành run
  `issue_blockers_resolved`, khoảng 48 giây sau.

### Ghi chú phụ

- Có một run reviewer `failed` với `setup_failed` / `continuation_task_ownership_changed` (issue đổi chủ trước khi run
  khởi động). Đó là hệ quả của việc kịch bản đổi trạng thái liên tục, không ảnh hưởng kết luận.
- Tổng run của company S4: 19 `succeeded`, 24 `cancelled`, 1 `failed`. Không còn run nào đang chạy; ba agent đã
  pause.
- `/tmp/s4spike` trên VPS vẫn giữ helper và key agent cho Step 6 hoặc kiểm lại. Xóa bằng `rm -rf /tmp/s4spike` và
  revoke key (`DELETE /api/agents/:id/keys/:keyId`) khi S4 kết thúc.

### Kết luận Step 7 (phần Step 1–5)

**Runtime chặn đồng bộ (trả lỗi trước khi commit, không đổi trạng thái):**

- Người không phải participant hiện tại (executor, reviewer của stage khác) muốn chuyển `done` hoặc đổi assignee
  thì nhận 422 (`applyIssueExecutionStageTransition`).
- Duyệt hay request changes không kèm comment thì nhận 422 (theo code; chưa thử riêng).
- Sau khi escalate, agent reviewer gửi tiếp thì nhận 422.
- Stage approval không còn participant hợp lệ thì nhận 422.
- Agent ghi mà không có run id thì nhận 403/401. Agent ghi lên issue `in_progress` không thuộc run đang checkout thì
  nhận 409.
- Wake issue còn blocker thì bị ghi `skipped`, không tạo run.

**Chỉ quan sát được sau commit (qua `activity_log`, `issue_execution_decisions`, plugin event `issue.updated`):**

- Agent sửa hoặc xóa `executionPolicy` (3c, 3d).
- Stage review bị auto-skip vì chỉ có executor (3e). Không có activity riêng; chỉ suy ra được khi thấy `done` mà
  thiếu decision.
- Board override (3g): `executionState` thành null, không có decision.
- Số vòng changes requested: đọc từ `executionState.changesRequestedCount` trong activity hoặc event.

**Đường bypass đã xác nhận thật:**

1. **Agent executor tự xóa policy rồi tự đóng issue** (3c), 0 decision. Đây là lỗ nghiêm trọng nhất cho Review
   Focus #2.
2. **Agent executor rút gọn policy để bỏ gate integrator/docs và gate owner** (3d).
3. **Policy có stage review mà participant chỉ là executor thì stage bị bỏ qua lặng lẽ** (3e).
4. **Board user ép `done` ở bất kỳ stage nào** (3g). Có chủ đích, nhưng mọi thành viên người đều là board.
5. Comment `## Review: APPROVED` của participant hiện tại tự duyệt stage. Không phải bypass vì vẫn là đúng
   participant, nhưng cần biết vì docs upstream nói ngược lại.

Hàm ý cho thiết kế (để S7 quyết, không phải kết luận cuối): hook H2 ở `runUpdate` chặn `done` khi chưa qua đủ stage
**không** chặn được bypass 1 và 2, vì lúc đóng thì policy đã bị xóa hoặc rút gọn hợp lệ. Muốn chặn cần một trong
hai: (a) H2 kiểm thêm việc **agent sửa `executionPolicy`** (từ chối khi actor là agent), hoặc (b) plugin Crew bắt
`issue.updated` có `changes.executionPolicy` từ agent rồi khôi phục policy hoặc mở lại issue. Cách (b) chỉ sửa được
sau commit. Bypass 3 xử lý được ở phía Crew bằng quy tắc tạo policy (không bao giờ để executor là participant duy
nhất của stage review). Rule "tối đa 5 vòng" dùng `maxReviewRounds: 5` của stock, không cần plugin hay hook.

Step 6 (dùng chung session) chưa chạy; kết luận sơ bộ từ code vẫn như mục "S4 — chuẩn bị".
