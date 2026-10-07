# Review gói `policy`: PL-1 (`20a620cfe`), PL-2 (`66e1ee650`)

- Ngày: 07/10/2026 11:55 (Asia/Ho_Chi_Minh). Nhánh `crew/r12-policy`, worktree `.worktrees/paperclip-r12-policy`, HEAD = `66e1ee650`, cây sạch. Phạm vi `git diff e1c3dd2db..66e1ee650` (10 file, +1132/−13).
- Log trong báo cáo PL-1/PL-2 khớp SHA. Em không chạy lại test `crew-*`. Có chạy:
  - `node crew/release/check-core-hooks.mjs` → `Hook một dòng: 4/5; mục: 8; lỗi: 0` (khớp).
  - `vitest run src/__tests__/issues-service.test.ts` (test stock, một file, embedded PG) để đo rủi ro báo cáo PL-2 nêu nhưng chưa đo: **5 failed / 122 passed**, cả 5 lỗi đều do Crew (`crew_roles_unconfigured` ×2, `roles_unconfigured, policy_missing` ×3). Xem finding 3.
- Hình thức hook: H4 là đúng một dòng đầu thân `create` (`issues.ts:9639`). Import `crewCoreHooks` đã có ở dòng cuối file (`issues.ts:13230`). Mục H4 trong `core-hooks.json` đúng vị trí (sau H3, trước P1), file test có thật. Mục H2 có đủ 3 file test. Đạt.
- H2 không chặn `blocked`: đạt. Chỉ có bốn nhánh chặn: sửa policy, agent `cancelled`, `enteringDone`, `completingIntegrator`. Ghi `blocked` của `load-gate.ts` `blockIssue`, `wake-queue`, `heartbeat`, `execution-recovery-resolution` không vào nhánh nào. Có test unit và test DB.

## Verdict

| Ticket | Verdict | Lý do chính |
|---|---|---|
| PL-1 | **CHANGES_REQUESTED** | Finding 1 (critical): approval của vòng trước vẫn được tính sau khi mở lại issue, nên `done` lại được mà không cần review/integrator/owner mới. Finding 3 (phần H2): tiến trình nền stock đóng issue thì bị 422 |
| PL-2 | **CHANGES_REQUESTED** | Finding 2 (major): agent tạo issue với `status: "done"`/`"cancelled"` mà không qua gate nào. Finding 3 (phần H4): issue phụ do hệ thống tạo nhận template con và không đóng được |

Tổng: 1 critical, 2 major, 4 minor.

## Findings

### 1. [critical] PL-1: approval đã lưu không gắn với vòng làm việc hiện tại. Mở lại rồi `done` lại thì qua gate mà không có review mới
- `server/src/crew/issue-gate.ts`, `evaluateIssueGate`: `stored = f.approvals.some((a) => a.stageId === stage.id && !signedBy(executor, a))`. `crewBeforeIssueWrite` đưa vào **mọi** decision `approved` của issue từ trước tới nay. Bằng chứng docs chỉ so với `changes_requested` gần nhất (`docs_stale`), không so với lần mở lại.
- Đường tấn công bằng API stock (đọc code, chưa chạy):
  1. Issue (con hoặc gốc) đi đúng quy trình tới `done`. State lúc đó là `executionState.status = "completed"` (`buildCompletedState`), assignee vẫn là reviewer, hoặc là owner nếu là issue gốc.
  2. Agent gọi `POST /issues/:id/comments` với `{ body, resume: true }` (hoặc `reopen: true`). Route (`routes/issues.ts` ~17487) gọi `svc.update(id, { status: "todo" })` **không qua** `applyIssueExecutionPolicyTransition`, nên `executionState` vẫn là `completed`. `svc.update` không reset state (`applyStatusSideEffects` chỉ đụng timestamp). H2 cho qua vì không vào `done`, không đụng policy.
  3. Agent làm việc mới, commit, rồi `PATCH status: "done"`. Ở nhánh `shouldStartWorkflow`, transition stock gặp `requestedStatus === "done" && existingState?.status === COMPLETED_STATUS` nên `return { patch }`: không mở lại stage nào (#7893).
  4. Khi đó H2 có `enteringDone`, và mọi stage đều có approval cũ không do `returnAssignee` ký. Docs cũ cũng không bị coi là stale nếu sau đó không có `changes_requested` nào. Kết quả `allow`: issue **gốc** về `done` lần hai mà không có reviewer, integrator hay owner.
- Biến thể tự duyệt: reviewer R là assignee của issue con đã `done`. R mở lại bằng comment `resume: true`, tự làm việc, rồi `done`. `executor = lockedState.returnAssignee` vẫn là executor cũ, nên approval cũ của R vẫn được tính. Tương tự, sau khi state đã bị xóa (`null`), `PATCH assigneeAgentId = R` (H2 không gate assignee, H4 chỉ kiểm lúc tạo) rồi `done` thì stage reviewer được auto-skip (`canAutoSkipPendingStage`). Với `lockedState = null` thì `executor = null` và approval cũ của R vẫn tính.
- Cách sửa, trong H2, không cần hook mới:
  1. **Mốc vòng.** Trong `crewBeforeIssueWrite`, khi lệnh ghi đưa issue ra khỏi `done`/`cancelled` (`locked.status ∈ {done,cancelled}` và trạng thái mới khác), ghi `persistActivity(tx, { action: "crew.gate.cycle_reset", … })`. Lúc đánh giá thì đọc activity đó mới nhất và chỉ tính approval cùng bằng chứng docs có `createdAt` > `max(cycle_reset, changes_requested gần nhất)`. Mọi đường mở lại đều đi qua `issueService.update` (comment route, PATCH, email channel, status card) nên đều bị bắt. Cách khác: chặn luôn `enteringDone` khi `lockedState.status === "completed"` mà `locked.status !== "in_review"`, nhưng cách này đụng #7893 nên em không khuyên.
  2. **Loại người ký là executor hiện tại.** Bỏ approval do `nextState?.returnAssignee`, `lockedState?.returnAssignee` hoặc assignee hiện tại (`existing.assigneeAgentId`) ký, thay vì chỉ `lockedState.returnAssignee`.
- Test cần thêm (DB, `crew-issue-gate.db.test.ts`): seed issue con có decision `approved` của reviewer, `status: "done"`, state `completed`. Gọi `update(id, { status: "todo" })` không actor (giống comment route), rồi `update(id, { status: "done", actorAgentId: executor })`. Kỳ vọng 422 `crew_gate_blocked`. Thêm một ca với issue gốc kèm docs cũ.

### 2. [major] PL-2: agent tạo issue thẳng ở `done`/`cancelled`. H4 không xét `status`, H2 không chạy khi tạo
- `createIssueSchema` nhận `status: z.enum(ISSUE_STATUSES)` (`packages/shared/src/validators/issue.ts:701`). Route `POST /companies/:companyId/issues` (`routes/issues.ts:11553`), `POST /issues/:id/children` và `issueService.create` (`values.status === "done"` → `completedAt`) đều không chặn trạng thái kết thúc. `decideCreatePolicy`/`IssueCreateFields` không có `status`.
- Hậu quả: agent (executor, Trợ Lý) tạo `{ parentId, status: "done" }` thì được 201. Issue con `done` với template con, 0 decision, không có review (O1). Tạo `status: "cancelled"` thì lách O7. Issue `done` còn giải phóng `blockedByIssueIds` của các issue phụ thuộc, tức là mở chuỗi việc mà không có review.
- Cách sửa: trong `decideCreatePolicy`, nhánh `createdByAgentId`, từ chối khi `status ∈ {"done","cancelled"}`. Nên chặn cả `"in_review"`, vì state `null` ở `in_review` làm hỏng logic stage. Dùng mã mới (ví dụ `crew_agent_terminal_create`) hoặc `crew_gate_blocked`. Thêm `status?: string | null` vào `IssueCreateFields` và `IssueCreateLike` (`core-hooks.ts`). Thêm test unit và một test DB qua `createChild`. Mã lỗi mới thì phải ghi vào mục "Mã lỗi H2/H4" của `plan.md` (RO-1 dùng).

### 3. [major] PL-1 + PL-2: tiến trình nền stock bị 422, có cả trong transaction dọn dẹp. Bộ test stock đỏ mà chưa ai báo
- Đã đo: `issues-service.test.ts` 5 lỗi, ví dụ:
  - `unblocks a source issue when a liveness escalation recovery issue is marked done` → `Crew: chưa đủ điều kiện để hoàn tất: roles_unconfigured, policy_missing.`
  - `inherits responsible user for agent-created child issues` → `crew_roles_unconfigured`.
- Đường production bị ảnh hưởng khi company **có** vai trò:
  - `modules/active-run-watchdog/adapters/postgres.ts:358`: `issuesSvc.update(existingEvaluation.id, { status: "done" }, tx)` không actor, trong cùng `tx` với lệnh xóa `executionRunId` của issue nguồn. Issue evaluation do `task-watchdogs.ts:1387` tạo, có `parentId` và không có `createdBy*`, nên H4 gắn template con. Tới bước fold, H2 ném `stage_unapproved`, **cả transaction rollback**: issue nguồn giữ `executionRunId`, watchdog lỗi lặp lại mỗi tick.
  - Tương tự với issue recovery của heartbeat (`heartbeat.ts:11267`, có `parentId`, hệ thống tạo): muốn đóng thì phải qua reviewer.
- Quy tắc trong ledger ("không agent, có `parentId` → template con"; "actor rỗng xử lý như agent cho `done`") chưa tính tới loại issue phụ do hệ thống sinh ra. Đây không phải lối thoát policy, mà là hỏng hành vi stock.
- Cách sửa (cần lead chọn, rồi ghi ruling):
  - (a) H4: issue do hệ thống tạo (không `createdByAgentId`, không `createdByUserId`) có `originKind` nội bộ (watchdog, recovery, status card, summary, run) thì `keep`, không gắn template. Template chỉ gắn khi có người tạo, hoặc `originKind` là `manual`/routine.
  - (b) H2: actor `system` vào `done` trên issue **không có policy** thì cho qua. Hiện ca này bị chặn bằng `policy_missing` và chặn cả company chưa cấu hình. Kết hợp với (a) thì issue phụ của hệ thống đóng được, còn issue có template vẫn bị gate.
- Bộ test stock: `crew/release/verify.sh` chỉ chạy `src/__tests__/crew-`, nên các hồi quy này không hiện ở Cổng 1. Ít nhất phải liệt kê test stock đỏ do Crew trong báo cáo hoặc ledger, để lần nâng Paperclip sau không nhầm với lỗi upstream. Tốt hơn thì sửa fixture các test đó, hoặc ghi danh sách loại trừ có lý do.

### 4. [minor] PL-1: "board" được suy ra từ `actorUserId` mà không xác minh. Plugin host mạo danh được người dùng, agent, decision và bằng chứng docs
- `issue-gate.ts` `actorOf`: có `actorUserId` thì là board.
- `services/plugin-host-services.ts` `update` (~1951): chuyển nguyên `actorUserId`/`actorAgentId` từ plugin xuống mà không qua `requireActiveHumanMember`, và chuyển nguyên `patch`, kể cả `executionState`. Plugin gửi `actorUserId` bất kỳ thì thành board override. Plugin gửi `actorAgentId = reviewer` kèm `executionState` tự dựng (`pending` → `completed`, `lastDecisionOutcome: "approved"`) thì qua `approvedInThisWrite` mà **không có decision nào được lưu**.
- `createComment` (~2381): plugin đặt được `authorAgentId = integrator`, tức là giả được comment `crew-docs-check … exit=0`.
- Mức minor vì plugin do owner cài và R1-2 chỉ có `crew.core`. Ghi vào ruling. Cách sửa rẻ:
  - (i) `actorOf` chỉ coi là board khi `actorUserId` là thành viên đang hoạt động, hoặc đúng `companies.defaultResponsibleUserId`; ngược lại coi là `system`.
  - (ii) `approvedInThisWrite` chỉ áp khi `patch.executionState` thật sự đến từ transition. Không tách được nguồn thì nên đòi thêm đúng một decision được chèn sau trong cùng `tx`, nhưng route chèn decision sau `updateIssue` nên chỉ ghi nhận rủi ro.

### 5. [minor] PL-1: nhận diện stage integrator theo vai trò **hiện tại**. Đổi integrator thì issue cũ mất docs gate mà không báo gì
- `evaluateIssueGate`: `integratorStage = policy.stages.find(... p.agentId === f.roles?.integratorAgentId)`. Integrator I1 bị bỏ `crewRole` (hoặc I2 được gán, I1 bị gỡ) thì stage của I1 trên issue gốc cũ không còn được coi là stage integrator. I1 vẫn là participant stock và approve được, không bị kiểm docs. Bằng chứng docs cũng chỉ đọc comment của integrator hiện tại.
- Cách sửa: với policy có ≥ 2 stage, coi stage `review` thứ hai là stage integrator. Tốt hơn là coi mọi stage `review` có participant không phải reviewer hiện tại. Bằng chứng docs đọc theo participant của chính stage đó (`stage.participants[].agentId`), không theo `roles.integratorAgentId`. Liên quan Q4: chính agent tự đổi `crewRole` cũng gây ra tình huống này.

### 6. [minor] PL-2: `crew_role_assignee` chỉ kiểm lúc tạo
- `decideCreatePolicy` từ chối `assigneeAgentId` là reviewer/integrator khi tạo. Nhưng sau đó `PATCH assigneeAgentId = <reviewer>` thì H2 không xét, vì `GATE_KEYS` không có `assigneeAgentId`.
- Riêng finding này không làm thủng gate: reviewer làm executor thì stage bị auto-skip, H2 chặn vì không có decision. Nhưng nó là bước nối của biến thể tự duyệt ở finding 1. Sau khi sửa finding 1 (loại người ký là assignee/`returnAssignee` hiện tại) thì chỉ còn vấn đề tách vai trò (O1).
- Tùy chọn: H2 chặn agent đổi assignee sang reviewer/integrator khi issue không ở `in_review`.

### 7. [minor] PL-1: test DB không phủ truy vấn bằng chứng docs và quyết định trong chính lệnh ghi
- `crew-issue-gate.db.test.ts` có 5 test, không test nào đi qua nhánh `docsEvidence`: lọc `authorAgentId`, `isNull(deletedAt)`, `like 'crew-docs-check %'`, `orderBy createdAt desc`. Cũng không test nào đi qua `approvedInThisWrite` với state thật. Unit test chỉ dựng sẵn `IssueGateFacts`, nên schema lệch (tên cột, kiểu `createdAt`) hay comment tombstone (`body` bị đổi thành `DELETED_ISSUE_COMMENT_BODY`) sẽ không bị bắt. Route test stock mock `issueService`, nên Cổng 2d là chỗ duy nhất phủ.
- Thêm 2 test DB:
  - integrator comment `exit=1` rồi `exit=0` (cũ hơn), sau đó tombstone comment `exit=1`, rồi integrator hoàn tất stage. Kỳ vọng hành vi đúng như ruling.
  - Một lệnh `update` có `executionState` chuyển `pending` → `completed` với `actorAgentId` = participant: cho qua. Cùng lệnh đó với `actorAgentId` = executor: chặn.

## Đã kiểm, không phải finding

- **SQL trực tiếp vào `issues`**: chỉ có một `insert(issues)` (trong `create`, có H4). Các `update(issues)` trực tiếp đặt `status` gồm: `agent-conversations.ts` (`in_progress`/`in_review`, issue hội thoại không `done` được), `issue-tree-control.ts` (khôi phục từ `cancelled`, route `assertBoard`), `issues.ts` checkout/release (`in_progress`/`todo`), các ghi `blocked`. Không có đường SQL nào đặt `done`/`cancelled` hay đổi `executionPolicy` phần stage. `chat-channels.ts:16077` giữ nguyên `stages` qua spread.
- **Hủy theo cây** (`cancelIssueStatusesForHold`): đi qua `svc.update` có actor của hold; route `tree-holds` là `assertBoard`.
- **Decision queue / stalled review**: đi qua `svc.update` với `actorUserId` của người bấm, tức là board override có activity, đúng ruling.
- **Đổi `parentId`**: không đụng `GATE_KEYS`, policy bị khóa. Biến issue con thành gốc hay ngược lại đều không đổi stage, nên không thành lối thoát.
- **Xóa/sửa decision**: không có route nào. `changesRequestedCount` nằm trong `executionState`, client không ghi được (`updateIssueSchema` không có `executionState`). Chỉ xóa agent (`agents.ts:1080`, board) mới xóa decision, và kết quả là đóng chặt.
- **Sửa/xóa comment bằng chứng**: không có route sửa body. Xóa thì chỉ tác giả được (`actorOwnsComment`), và xóa thì đóng chặt (`docs_missing`).
- **Một vai trò, hai agent**: `pickCrewRoles` đòi đúng một agent cho mỗi vai trò, nên agent thứ hai cùng `crewRole` làm hệ thống đóng chặt chứ không tự duyệt được. Q4 (agent tự đổi `crewRole`) chờ owner, chỉ ghi nhận.
- **`maxReviewRounds`**: bỏ trường thì về 3 (chặt hơn); đặt lại 5 sau khi đã bỏ thì bị chặn (`raised`). Thoát vòng là giao cho owner (người), không phải lối thoát.
- **Monitor**: PATCH thay nguyên policy (`normalizeIssueExecutionPolicy(req.body.executionPolicy)`), nên agent phải gửi lại stage kèm id, giống stock. Fingerprint bỏ qua monitor, đúng Review Focus 2.
- **Agent tạo issue gốc**: routine do agent tạo, chạy theo lịch, sẽ tạo issue gốc dưới danh nghĩa hệ thống (`routines.ts:1915`, `createdByAgentId` chỉ đặt khi `manual`). Issue đó nhận template gốc đủ ba stage nên không thoát gate, chỉ là không đúng tinh thần `crew_agent_root_issue`. Ghi nhận.

## Việc đề nghị theo thứ tự

1. Finding 1: mốc vòng `crew.gate.cycle_reset` cộng với loại người ký là assignee/`returnAssignee` hiện tại; thêm test DB reopen qua `update(…, { status: "todo" })`.
2. Finding 2: chặn agent tạo issue ở `done`/`cancelled`/`in_review`; cập nhật mục mã lỗi trong `plan.md`.
3. Finding 3: lead chọn (a)/(b), ghi ruling; liệt kê test stock đỏ do Crew.
4. Finding 4–7: sửa cùng đợt nếu rẻ, hoặc ghi ruling chấp nhận.

## Câu hỏi còn mở

- Finding 3 cần lead hoặc owner quyết: issue phụ do hệ thống sinh ra có chịu policy Crew không.
- Q4 vẫn chờ owner. Finding 5 là một hệ quả khác của cùng gốc (vai trò sửa được ở `agents.metadata`).

## Re-review (07/10/2026, Asia/Ho_Chi_Minh): `1e72138`, `c32d59f`

- Phạm vi: `git diff 66e1ee650..c32d59fad`, gồm 7 file, +873/−203. HEAD = `c32d59fad`, cây sạch.
- Log "Sửa sau review" đợt 1 và đợt 2 trong `pl-1-report.md` khớp SHA, nên em không chạy lại test. Em chỉ đọc diff và các đường stock liên quan.

### Verdict

| Ticket | Verdict | Lý do |
|---|---|---|
| PL-1 | **APPROVE** | Đã đóng: critical 1, phần H2 của major 3, minor 5–7. Hai minor mới (R2, R3) không chặn merge |
| PL-2 | **CHANGES_REQUESTED** | Đã đóng major 2. Nhưng quy tắc mới "hệ thống tạo → giữ stock" sinh ra finding mới R1 (major): issue phụ do hệ thống tạo, giao cho agent, thì agent không đóng được. Lead có thể hạ R1 xuống bằng một ruling |

### Lặp lại các đường tấn công cũ

- **C1, mở lại qua comment `resume`/`reopen`** → `svc.update({status:"todo"})`. H2 chạy vì patch có `status`. `locked` là `done` và trạng thái mới không phải trạng thái kết thúc, nên H2 đặt `input.patch.executionState = null` rồi ghi `crew.gate.cycle_reset`. `runUpdate` ghi chính object đó (`.set(patch)` ngay sau hook). Lần `PATCH done` sau, stock chạy lại từ stage đầu; approval cũ không được tính (`createdAt > cycleStart`). **Đóng.**
- **C1, biến thể reviewer tự duyệt**: R mở lại rồi `done` → `returnAssignee = R` → stage bị auto-skip → `workers` có R và không có approval nào sau mốc → 422. Biến thể đổi assignee sang R: R2 chặn bằng `crew_role_assignee`. **Đóng.**
- **C1, bằng chứng docs cũ**: `freshAfter = max(cycleStart, changes_requested)`. **Đóng.** Có test DB cho issue gốc.
- **M2**: H4 từ chối agent tạo issue `done`/`cancelled`/`in_review`. `status` đã có trong `IssueCreateFields`/`IssueCreateLike`. `createChild` truyền `status` qua `issueData`. **Đóng.**
- **M3**: system ghi trên issue không có stage thì cho qua hết. Issue hệ thống tạo mà không có người tạo thì H4 giữ stock. Watchdog fold (`active-run-watchdog`) không còn bị rollback. Company không có trong file thì 5 test `issues-service` xanh. **Đóng** phần hệ thống. Phần agent xem R1.
- **m5**: stage cần docs là mọi stage `review` trừ stage `review` đầu, theo policy đã ghim. Tác giả bằng chứng là participant của chính stage đó (`docsAuthors`). Đổi integrator trong file không làm mất docs gate của issue cũ. **Đóng.**
- **m6**: `assigneeAgentId` đã vào `GATE_KEYS`. Agent giao việc cho reviewer/integrator bị 422; ngoại lệ duy nhất là khi chính transition giao stage (`nextState.pending` với `currentParticipant` = agent đó). Các lần giao stock (executor sang `in_review`, approve stage 1 sang integrator, leo thang lên owner kèm `assigneeAgentId: null`) đều qua. **Đóng.**
- **m7**: có test DB cho truy vấn docs (lọc tác giả, comment tombstone, comment mới nhất) và cho nhánh duyệt ngay trong lệnh ghi. **Đóng.**
- **m4**: chấp nhận bằng ruling. Không tính.

### Mutating `patch`: có mở lỗ mới không

- Agent không tự gửi được `executionState: null`: `updateIssueSchema` không có `executionState`, chỉ transition của route mới đặt trường này. Plugin thì gửi được, nhưng thuộc ruling m4.
- Agent đổi `status` để rời `done` cho state bị reset: approval cũ hết hiệu lực nhờ mốc vòng, và stage chạy lại từ đầu. Không có lợi gì để khai thác. Chỉ là phá đám (mở lại issue gốc đã được owner duyệt), và việc đó stock vốn đã cho phép.
- Bỏ `done` sang `in_review` trực tiếp: transition stock đã đặt `executionState = null` sẵn. Lần `done` sau, transition giao lại stage đầu. Không có lỗ.
- H2 chỉ sửa `patch` sau khi verdict không phải `block`, và sửa sau khi đã đánh giá xong. Bản `patch` dùng để đánh giá là cùng object, nhưng không bị đọc lại sau khi sửa. Đúng.
- Test canh chừng upstream: "mở lại để giao thêm việc" khẳng định `reopened?.executionState` là `null` trên giá trị trả về của `update`, tức dòng `.returning()` từ DB. Nếu upstream đổi `runUpdate` sang ghi một bản sao chụp **trước** khi gọi hook (hoặc đưa cho hook một bản sao), dòng DB vẫn là `completed` và test **đỏ**. Nếu bản sao được chụp **sau** hook, kiểu `.set({ ...patch })`, thì sửa đổi vẫn có hiệu lực và test vẫn xanh, đúng mong đợi. Đạt.
- Mốc `crew.gate.cycle_reset` có bị agent giả không: agent không ghi `activity_log` với action tùy ý được. Mà kể cả có giả, mốc chỉ làm approval cũ hết hiệu lực, tức là chặt hơn. Rủi ro thật là **mất** mốc (R3).

### O8

- Không đặt env, hoặc company không có trong file → `absent`. H2 và H4 trả về ngay, kể cả O7, nên hoàn toàn là hành vi stock. Đúng.
- Env có đặt mà file không đọc được, JSON lỗi hoặc thiếu `companies` → `invalid` cho mọi company. Entry sai thì chỉ company đó `invalid`. Mỗi lỗi log `error` một lần. Fail-closed đúng ruling.
- Agent không có đường sửa file: em không tìm thấy route nào để agent ghi file tùy ý trên server. Instructions bundle bị giới hạn trong bundle root (`resolvePathWithinRoot`), bundle external thì cần `assertExternalInstructionsAdmin`. Biến env chỉ đổi được bằng deploy. Agent chạy trên Mac, không chạy trong container. Việc còn phải làm ở AC-2: kiểm mount read-only, và file nằm **ngoài** `resolvePaperclipInstanceRoot()`.

### Finding mới

#### R1. [major] PL-2/PL-1: issue phụ do hệ thống tạo rồi giao cho agent, trong company có cấu hình, thì agent không đóng được
- H4 mới: `if (!data.createdByUserId?.trim()) return keep`, nên issue hệ thống tạo không có policy. H2 thì cho qua system trên issue không có stage, nhưng **agent** vào `done` trên issue không có policy vẫn bị `policy_missing` → 422.
- Các đường stock bị ảnh hưởng:
  - `task-watchdogs.ts:1387`: issue "Watchdog review" giao cho `watchdogAgentId`. Mô tả issue này yêu cầu agent xác nhận rồi đóng.
  - `heartbeat.ts:11267`: issue recovery giao cho assignee của issue nguồn.
  - `routines.ts:1905`: routine chạy theo lịch tạo issue không có `createdBy*`. Trước bản sửa, các issue này nhận template; giờ thì không. Đây là hồi quy do chính bản sửa M3 gây ra.
- Cách sửa, lead chọn một rồi ghi ruling:
  - (a) H4: issue hệ thống tạo có `originKind` là routine thì nhận template như trước: gốc nếu không có `parentId`, con nếu có. Không áp cho watchdog/recovery, vì gắn template cho chúng thì watchdog fold (system `done`) lại bị chặn.
  - (b) H2: cho agent `done` issue không có policy khi `createdByAgentId` và `createdByUserId` đều `null` (issue hệ thống). Agent không tự tạo được issue kiểu này, vì H4 luôn gắn `createdByAgentId` cho agent. Đổi lại, việc trong issue watchdog/recovery không qua review.
  - (c) Chấp nhận: owner đóng bằng board override. Ghi ruling và cập nhật RO-1 để agent biết chuyển `blocked`.
- Em nghiêng về (b) cho watchdog/recovery, và (a) chỉ cho `originKind` routine.

#### R2. [minor] PL-1: cấu hình "vắng" là im lặng, tức là fail-open không có log
- `loadCrewCompanyConfig`: env chưa đặt, hoặc key company gõ sai/khác hoa thường (`Object.hasOwn(parsed.companies, companyId)` so đúng từng ký tự, trong khi id agent thì đã được `toLowerCase`), đều cho ra `absent`. Gate tắt mà không có dòng log nào.
- Cách sửa: so khớp key company không phân biệt hoa thường (lowercase cả hai phía). Log `warn` một lần cho mỗi process khi env chưa đặt. AC-2 kiểm có activity hoặc 422 thật trên company Crew trước khi coi là đạt (Cổng 2a đã làm việc này).

#### R3. [minor] PL-1: mốc vòng mất khi xóa agent đã mở lại issue
- Activity `crew.gate.cycle_reset` ghi `agentId` của actor nếu actor là agent (`actorFields`). Hard delete một agent (`agents.ts:1074`, board) sẽ xóa `activity_log` theo `agentId`, kéo theo mất mốc. Approval cũ trước lần mở lại đó được tính lại.
- Tác động thấp: state đã `null`, nên route vẫn chạy lại stage. Chỉ đường `done` không qua transition (system trên issue có stage, plugin) mới dùng được approval cũ.
- Cách sửa: ghi `cycle_reset` với `actorType: "system"`, không có `agentId`, và để actor thật trong `details`.

### Ghi chú, không phải finding

- Khôi phục cây từ `cancelled` (`issue-tree-control.ts:981`, chỉ board) ghi SQL trực tiếp, nên không có mốc vòng và state cũ được giữ. Đó là tiếp tục cùng một vòng, đúng ý hành động của board.
- Interface "Vai trò agent" trong `plan.md` đã khớp code (`loadCrewCompanyConfig`, `absent | invalid | ok`).

Tổng re-review: đóng 1 critical, 2 major, 3 minor (m5–m7); m4 chấp nhận bằng ruling. Mới: 1 major (R1), 2 minor (R2, R3).

## Re-review 2 (07/10/2026, Asia/Ho_Chi_Minh): `21fcb1451`, chỉ phần sửa PL-2

- Phạm vi: `git diff c32d59fad..21fcb1451`, gồm 6 file, +193/−14. Cây sạch. Log "Sửa sau re-review" trong `pl-2-report.md` khớp SHA, nên em không chạy lại test.

### Verdict

| Ticket | Verdict | Lý do |
|---|---|---|
| PL-2 | **CHANGES_REQUESTED** | Đã đóng R1 (watchdog/recovery về lại stock) và R2. Nhưng quy tắc mặc định mới, "nguồn hệ thống lạ thì gắn template **con**", lại áp cho cả issue **cấp gốc** do routine tạo. Từ đó có đường để agent ra một issue gốc chỉ cần reviewer rồi `done` (RR1) |
| PL-1 | APPROVE (giữ nguyên) | Phần H2 sửa thêm chỉ là nhánh miễn cho issue housekeeping. Rủi ro còn lại của nhánh này xếp minor (RR2) |

### Các câu hỏi trọng tâm

- **Agent đổi `originKind` qua PATCH**: không được. `updateIssueSchema` (`createIssueBaseSchema.omit(...)`) và `createIssueSchema` đều không có `originKind`. `createdByAgentId`/`createdByUserId` cũng không PATCH được: `createdByUserId` bị omit, còn route tạo issue ghi đè cả hai theo actor (`routes/issues.ts` ~11819). Plugin chỉ được đặt `originKind` dạng `plugin` hoặc `plugin:*` (`normalizePluginOriginKind`), nên không trúng danh sách housekeeping. Route tạo issue `task_watchdog_product_bug` gắn `createdByAgentId` của agent, nên nhánh agent của H4 chạy trước và `isCrewHousekeepingIssue` trả false. **Đạt.**
- **Agent kích hoạt hệ thống tạo issue housekeeping rồi đẩy việc thật vào đó**: có, với `stranded_issue_recovery` (RR2, minor). Watchdog review (`task_watchdog`) giao cho `watchdogAgentId`; evaluation (`stale_active_run_evaluation`) do watchdog fold đóng. Hai loại này không giao cho executor.
- **Mặc định template con cho nguồn lạ**: đúng tinh thần fail-closed cho issue **con**, nhưng sai cho issue cấp gốc (RR1).
- **R2**: key company được so không phân biệt hoa thường; trùng key sau khi bỏ hoa thường thì `invalid`. `reportCrewPolicyConfigAtStartup` log `warn` một lần khi chưa đặt env. **Đóng.** Hàm chạy ngay lúc import module, nên test cũng in dòng warn. Chấp nhận được.

### Finding

#### RR1. [major] PL-2: routine theo lịch của agent tạo issue **gốc** chỉ có stage reviewer, bỏ qua integrator, docs và owner
- `decideCreatePolicy`: không có người tạo, không phải housekeeping → `{ kind: "set", template: "child" }` mà không xét `parentId`.
- Đường đi: agent tạo routine giao cho chính mình. `assertCanManageCompanyRoutine` (`routes/routines.ts:99`) cho agent quản lý routine của mình, còn `assertBoardCanAssignTasks` thì bỏ qua actor agent. Đặt trigger theo lịch, `parentIssueId` rỗng. Tới giờ, `routines.ts:1905` tạo issue `routine_execution` với `createdByAgentId: null` (chỉ chạy `manual` mới gắn agent) và không có `parentId`. Issue nhận template con, executor làm, reviewer duyệt, và **issue cấp gốc vào `done`** mà không có integrator, `crew-docs-check` hay owner.
- Hậu quả: lách `crew_agent_root_issue` (Q6, O4) và O2/O3 cho một yêu cầu cấp gốc. Ở `66e1ee650`, đường này còn nhận template gốc có owner; giờ yếu đi.
- Cách sửa: trong nhánh hệ thống không phải housekeeping, `parentId` có thì gắn template con; không có thì gắn `buildCrewPolicy("root", roles, ownerUserId)` lấy owner từ file. Cấu hình lỗi thì `crew_roles_unconfigured` như hiện tại.
  - Sửa test unit "hệ thống tạo issue routine hoặc nguồn không nhận diện được" cho hai ca có và không có `parentId`.
  - Sửa test DB "hệ thống tạo issue routine: template con", vì test này đang tạo issue **không** có `parentId` và khẳng định template con, tức là đang khóa đúng hành vi sai.
  - Có thể cân nhắc thêm: H4 từ chối agent tạo routine không có `parentIssueId`. Nhưng việc đó nằm ngoài hook, không cần nếu đã gắn template gốc.

#### RR2. [minor] PL-1/PL-2: executor tự kích hoạt được issue `stranded_issue_recovery` giao cho chính mình, rồi `done` không qua review
- `heartbeat.ts:11267`: issue recovery có `parentId` là issue nguồn, `assigneeAgentId` là assignee của issue nguồn (tức executor), và không có `createdBy*`. Vì vậy `isCrewHousekeepingIssue` trả true, H4 để nguyên stock (không policy), và nhánh mới của H2 cho agent `done`.
- Cách kích hoạt: executor đặt monitor trên issue Crew của mình với `recoveryPolicy: "create_recovery_issue"`, timeout ngắn. H2 cho phép vì fingerprint bỏ qua monitor. Stock thì đòi agent là assignee **và** có quyền `runtime:manage` (`assertCanManageIssueMonitor`). Cũng có thể làm issue đứng cho tới khi liveness escalation (`harness_liveness_escalation`) bắn.
- Tác động giới hạn: đóng issue recovery chỉ đi vào sổ sách liveness (`issues.ts` ~5701, ~5877), không chuyển issue Crew nguồn sang `done`. Issue gốc vẫn qua integrator và owner. Chỗ thủng duy nhất là commit làm "trong" issue recovery không được reviewer xem ở tầng issue con. Agent PATCH tự giao một issue watchdog cho mình thì cũng vậy.
- Cách sửa, lead chọn:
  - (a) Chỉ miễn cho các loại giao cho watchdog/hệ thống (`task_watchdog`, `task_watchdog_product_bug`, `stale_active_run_evaluation`, `issue_productivity_review`). Loại giao cho executor (`stranded_issue_recovery`, `harness_liveness_escalation`) nhận template con khi tạo. Nếu stock có đường system tự đóng hai loại này thì H2 thêm nhánh miễn theo origin, chỉ cho actor `system`.
  - (b) Nhánh miễn agent `done` của H2 chỉ áp khi actor **không** phải assignee/`returnAssignee` của issue nguồn (`originId`).
  - (c) Chấp nhận bằng ruling, ghi rõ "commit trong issue recovery chỉ được kiểm ở integrator".

### Tổng re-review 2
Đóng R1 (phần watchdog/recovery) và R2. Mới: 1 major (RR1), 1 minor (RR2). Hook vẫn 4/5, không đổi `issues.ts`.

## Re-review 3 (07/10/2026, Asia/Ho_Chi_Minh): `1da5b34da`, chỉ phần sửa PL-2 (vòng 3/5)

- Phạm vi: `git diff 21fcb1451..1da5b34da`, gồm 5 file, +254/−18. Cây sạch. Log "Sửa sau re-review 2" khớp SHA, nên em không chạy lại test.

### Verdict

| Ticket | Verdict | Lý do |
|---|---|---|
| PL-2 | **APPROVE** | RR1 và RR2 đã đóng trên đường tạo issue. Còn một minor mới (RR3): đổi `parentId` làm mất liên kết nguồn, nhưng chỉ áp dụng cho issue housekeeping **không có policy**. Tác động giống RR2, không chặn merge |
| PL-1 | APPROVE (giữ nguyên) | Thay đổi H2 chỉ thu hẹp nhánh miễn |

### RR1: đóng
- Issue do hệ thống tạo, không phải housekeeping, không có `parentId` → template gốc, owner lấy từ file. Có `parentId` → template con. Đường routine theo lịch của agent giờ nhận đủ reviewer → integrator → owner. Có test DB đi qua `routineService.create` với actor agent và `runRoutine(…, { source: "schedule" })`.

### RR2: đóng ở đường tạo
- H4: issue watchdog/recovery giao cho assignee hoặc `returnAssignee` của issue nguồn thì nhận template con. Executor tự đặt monitor `create_recovery_issue` thì issue `stranded_issue_recovery` (giao lại cho executor) có policy, và H2 không miễn nữa vì đã có stage. Có test chạy `tickTimers` thật.
- H2: issue housekeeping không có policy thì không miễn khi agent `done` là executor của issue nguồn.

### "Không tìm được issue nguồn thì vẫn miễn": agent có làm mất hoặc đổi liên kết được không

#### RR3. [minor] PL-1/PL-2: executor đổi `parentId` của issue housekeeping không có policy để thoát kiểm "executor của issue nguồn"
- `housekeepingSourceIssueId` ưu tiên `parentId`, sau đó mới tới `originId`. `parentId` thì PATCH được (`updateIssueSchema` kế thừa `parentId`; `assertExecutionTaskParent` chỉ chặn cha là issue hội thoại), và `GATE_KEYS` không có `parentId`. `originId` thì không PATCH được.
- Đường đi: issue watchdog/recovery được tạo **không có policy** vì lúc tạo nó giao cho agent khác executor (watchdog agent, hoặc chưa giao ai). Executor PATCH `assigneeAgentId` về chính mình; H2 cho qua vì đó không phải agent reviewer hay integrator. Executor PATCH tiếp `parentId = <issue Y không liên quan>`, rồi `done`. Lúc đó H2 tra nguồn theo Y, executor không phải assignee của Y, nên được miễn và `done` không qua review. Gộp hai field vào **cùng** một PATCH thì không lọt, vì H2 đọc `locked.parentId` cũ, nên phải tách làm hai lệnh.
- Biến thể nhẹ hơn: issue nguồn đã mở lại (state bị reset về `null`) và đổi assignee, nên executor cũ không còn là assignee/`returnAssignee`.
- Tác động giống RR2: đóng issue housekeeping không đưa issue Crew nào vào `done`, chỉ khiến commit làm trong đó không được reviewer xem ở tầng issue con.
- Cách sửa (rẻ):
  - Tra nguồn theo `originId` trước, vì trường này không đổi được. `task_watchdog` và `stranded_issue_recovery` đều dùng `originId` = id issue nguồn. `parentId` chỉ dùng khi `originId` không phải uuid (`harness_liveness_escalation` dùng incident key; có thể tách bằng `parseIssueGraphLivenessIncidentKey`).
  - Hoặc H2 chặn agent đổi `parentId` của issue housekeeping.
  - Hoặc chấp nhận bằng ruling cùng với RR2.

### `manual` origin: board tạo tay có bị gắn template ngoài ý muốn không
- Không. Issue board tạo qua UI/API luôn có `createdByUserId` (`routes/issues.ts` ~11819), nên đi nhánh board như cũ: có policy riêng thì giữ, không có thì gắn template theo `parentId`. Nhánh hệ thống chỉ chạy khi **không** có người tạo.
- Ghi nhận (không phải finding): nhánh hệ thống thay mọi `executionPolicy` caller gửi bằng template. Các đường tạo không có `createdBy*` mà không phải housekeeping (onboarding seed, task từ chat/email channel, plugin không actor với `plugin:*`, routine theo lịch) giờ nhận template gốc hoặc con. Với task từ kênh ngoài thì đó là "yêu cầu" thật, nên template gốc là hợp lý. Em không thấy đường stock nào để hệ thống tự `done` các issue này (chỉ có `active-run-watchdog` đóng `stale_active_run_evaluation`, loại này vẫn được miễn).

### Tổng re-review 3
Đóng RR1, RR2. Mới: 1 minor (RR3). PL-2 APPROVE.

## Review O11 (07/10/2026, Asia/Ho_Chi_Minh): `11a5ec4a7`, `94b334c5e`

- Phạm vi: `git diff 46b6cbf5b..94b334c5e`, gồm 2 file, +194/−4. Cây sạch. Log trong `pl-3-report.md` khớp SHA, nên em không chạy lại test.

### Verdict

| Commit | Verdict | Lý do |
|---|---|---|
| `11a5ec4a7` (test L6/P1) | **APPROVE** | Chỉ thêm test DB, khóa đúng hành vi stock đã đo (stage 4 vẫn chờ sau `blocked`/`todo`). Không đổi code |
| `94b334c5e` (O11) | **CHANGES_REQUESTED** | O1-1 (major): nhánh dự phòng "tác giả `crew-commit` mới nhất" cho **bất kỳ agent nào** quyết định ai nhận issue Crew mở lại, kể cả tự nhận về mình hoặc giao cho reviewer/integrator |

### Findings

#### O1-1. [major] `reopenHandBack`: comment `crew-commit` giả thì agent chiếm được, hoặc lái được, việc giao lại
- `server/src/crew/issue-gate.ts` `reopenHandBack`: khi state cũ không có `returnAssignee`, ứng viên là `authorAgentId` của comment mới nhất có body `like 'crew-commit %'` sau mốc vòng trước. Không kiểm định dạng (`sha=<40 hex>`…), không kiểm tác giả từng là assignee/executor của issue, và không loại reviewer/integrator hay participant của stage.
- Khi nào thì không có `returnAssignee`: board ép `done` (`allowBoardOverride` đặt `executionState = null`; đây là luồng có activity `crew.policy.board_override`, owner dùng thật). Ngoài ra là issue bị cancel hay mở lại mà state đã `null`.
- Đường tấn công:
  1. Issue gốc đã `done` bằng board override, assignee là integrator.
  2. Agent X bất kỳ được comment trên issue (quyền ghi mặc định trong company, hoặc mention) đăng `crew-commit x`. Comment của agent không phải assignee trên issue đã đóng không làm mở lại issue (`crossIssueCommentOnlyGrant`), nên không có dấu vết bất thường.
  3. Owner comment trên issue để giao thêm việc, issue về `todo`. H2 giao lại cho **X**. X cũng có thể tự mở lại bằng `reopen: true`, nếu `assertAgentIssueMutationAllowed` cho phép.
- Hậu quả:
  - (a) X chiếm việc của issue gốc, executor thật mất việc.
  - (b) X đặt được ứng viên là **reviewer**: reviewer viết `crew-commit`, hoặc tác giả có sẵn là reviewer. Khi đó hook giao việc thực thi cho reviewer mà lách `crew_role_assignee`, vì kiểm đó chỉ áp cho patch do agent gửi. Gate không thủng: stage reviewer bị auto-skip, không có approval sau mốc, nên 422. Nhưng issue kẹt cho tới khi board giao lại, và trái O1.
  - Đường `returnAssignee` cũng thiếu bước loại vai trò: ứng viên là reviewer/integrator thì vẫn được giao.
- Cách sửa:
  1. Loại ứng viên là `roles.reviewerAgentId`/`integratorAgentId`, hoặc bất kỳ agent participant nào của policy đã ghim, ở **cả hai** đường. Trúng thì `unknown`, reason `executor_is_stage_participant`.
  2. Nhánh `crew-commit`: chỉ nhận tác giả đã từng là `assigneeAgentId` của issue này trong vòng trước. Đối chiếu bằng `activity_log` `issue.updated` có `details.assigneeAgentId`, hoặc bằng `issues.createdByAgentId` / người được giao lúc tạo. Đơn giản hơn nữa là bỏ hẳn nhánh này: không có `returnAssignee` thì `unknown` kèm activity, và owner tự giao. Nếu giữ thì kiểm thêm dòng đầu đúng `^crew-commit sha=[0-9a-f]{40} branch=\S+ ` (interface RO-1).
  3. Test DB: agent X không phải executor đăng `crew-commit` sau board override, rồi mở lại; kỳ vọng không giao cho X. Thêm một ca ứng viên là reviewer, kỳ vọng `unknown`.

#### O1-2. [minor] Đổi `assigneeAgentId` trong hook thì bỏ qua hai kiểm stock chạy trên `issueData` trước hook
- `issues.ts` `update`, phần chặn `chat_binding_agent_locked`: issue gắn với kênh ngoài (`chatConversations.issueId`) thì stock cấm đổi agent. H2 đổi sau bước này nên lách được. Việc này giờ có thật: theo bản sửa RR1, task do kênh chat/email tạo nhận template gốc, tức là thành issue Crew. Khi người dùng kênh nhắn lại và issue mở lại, assignee bị đổi trong khi binding vẫn trỏ agent cũ.
- `assertAssignableAgent({ kind: "work" })`: H2 thay bằng kiểm cùng company và không `terminated`. Còn thiếu `pending_approval` (`agent-assignability.ts`). `paused` thì lead đã chấp nhận.
- Cách sửa: trong `reopenHandBack`, có binding `chatConversations` cho issue thì trả `unknown` (`chat_bound`). Ứng viên có `status = "pending_approval"` thì trả `unknown`. Tốt hơn nữa là gọi thẳng `assertAssignableAgent(tx, companyId, candidate, { kind: "work" })` trong `try`, lỗi thì `unknown`. Ngoại lệ `paused` thì giữ theo ruling, chỉ cần không đẩy lỗi `paused` ra ngoài.

### Đã kiểm, không phải finding
- **Agent tự chuyển `done` → `todo` để kích hoạt giao lại**: chỉ đổi khi assignee hiện tại là participant agent, và chỉ giao về executor của vòng trước (`returnAssignee`, đường stock đáng tin). Executor tự mở lại issue của mình thì nhận lại đúng việc của mình, vòng mới chạy đủ stage, approval cũ hết hiệu lực nhờ mốc. Không có lợi gì để khai thác. Phần nguy hiểm chỉ nằm ở nhánh `crew-commit` (O1-1).
- **Lệnh ghi tự đặt assignee**: `has(patch, "assigneeAgentId" | "assigneeUserId")` thì không đổi gì. Board giữ quyền chọn assignee.
- **`statusVersion`**: H2 dùng `??=` trước đoạn tăng của `runUpdate`. `runUpdate` chỉ tăng khi `issueData.assigneeAgentId` đổi, mà ca này không có, nên không tăng hai lần. Nếu có tăng thêm do `blocked` thì cũng chỉ là thêm một phiên bản, vô hại.
- **Đánh thức**: comment route chọn người đánh thức qua `svc.getById` sau khi ghi; route PATCH tính `assigneeChanged` theo bản ghi trả về; `expireConnectionIntentsForOwnershipChange` so `updated` với `existing`. Đúng như báo cáo.
- **checkout/run lock**: status rời `done`/`cancelled` sang trạng thái khác `in_progress` thì `checkoutRunId`, `executionRunId`, `executionLockedAt` đã bị xóa. Trường hợp board PATCH `done → in_progress`: issue `done` vốn có `checkoutRunId = null` (lần ghi `done` đã xóa), nên không có lock cũ treo lại với assignee mới.

### Tổng review O11
`11a5ec4a7` APPROVE. `94b334c5e` CHANGES_REQUESTED: 1 major (O1-1), 1 minor (O1-2).
