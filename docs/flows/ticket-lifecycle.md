# Vòng đời ticket

> Flow `ticket-lifecycle`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow
> ticket-lifecycle` in ra đúng danh sách đó.

## Mục đích

Tạo, đọc, chuyển trạng thái và đóng ticket (request → pm_task → dev/qc/docs_init, cộng nhánh bug), theo đúng
workflow trạng thái theo actor, cổng report bắt buộc trước `done`, hiệu ứng dây chuyền (đánh thức phụ thuộc,
`children.all_done`, cascade cancel), vòng lặp bug QC↔dev có giới hạn chu kỳ, và giới hạn/ngân sách theo
pm_task.

## Điểm vào

- `apps/api/src/routes/ticket-routes.ts` — owner: `GET/POST /v1/tickets`, `GET/PATCH /v1/tickets/:id`,
  `GET /v1/tickets/:id/tree`, `POST /v1/tickets/:id/transition`, `GET /v1/search`.
- `apps/api/src/routes/comment-routes.ts` — owner: `POST /v1/tickets/:id/comments`.
- `apps/api/src/routes/report-routes.ts` — owner: `GET /v1/tickets/:id/report`.
- `apps/api/src/routes/attachment-routes.ts` — owner: `POST /v1/tickets/:id/attachments`,
  `POST /v1/attachments` (ảnh nháp, chưa gắn ticket), `GET /v1/attachments/:id`.

Ghi của agent (tạo subtask, file bug, nộp report, bình luận/transition với `actor='agent'`) đi qua route
daemon ở flow `daemon-api`, nhưng dùng cùng các hàm service mô tả dưới đây.

## Các bước
1. `apps/api/src/services/ticket-service.ts` → `createRequestTicket()`: owner tạo ticket `request`, gán cho
   máy đang host assistant (nếu có), cấp key bằng `allocateKey()` (khoá theo scope `AST`). Nhận thêm tham số
   tuỳ chọn `ownerId` (route `POST /v1/tickets` truyền `request.ownerSession.ownerId`, caller khác — ví dụ
   test gọi thẳng service — có thể bỏ qua); có `ownerId` thì trong cùng transaction với việc chèn ticket,
   `claimDraftAttachments()` tìm id attachment dạng `/v1/attachments/<uuid>` trong `description` vừa tạo và
   gắn `ticket_id` = ticket mới cho các bản ghi **đang nháp** (`ticket_id IS NULL`) **của chính owner đó** —
   id không tồn tại, đã gắn ticket khác, hay thuộc owner khác đều bị bỏ qua qua điều kiện `WHERE`, không bao
   giờ làm hỏng việc tạo ticket; ticket tạo lỗi (ví dụ `projectHintId` không tồn tại) rollback cả transaction
   nên không ảnh nào bị gắn. Xem chi tiết ảnh nháp ở bước 16.
2. `apps/api/src/services/ticket-service.ts` → `createSubtask()`: PM/dev/QC tạo con — kiểm tra đúng cấp cha
   (`pm_task` dưới `request`, `dev/qc/docs_init` dưới `pm_task`), cha chưa đóng, `enforceChildCap()` (flow này
   gọi sang `budget-service.ts`), QC bắt buộc `pairsWith` một dev/bug còn sống và chưa có QC khác
   (`assertPairable`), `dependsOn` chỉ được là ticket anh em (`assertSiblings`). QC có phương án kiểm thử
   (`testKinds`, kèm `testReason` bắt buộc đi cùng — `CreateSubtaskRequest.superRefine`, cùng file
   `api-schemas.ts` nói ở bước 11): `requiredMcps` = MCP PM tự thêm ∪ MCP UI suy từ `testKinds`
   (`uiMcpsForTestKinds()`, `packages/shared/src/project-schemas.ts`, flow `project-claims`) — **không** cộng
   `qcDefaultMcps()` nữa, phương án là nguồn sự thật duy nhất cho MCP UI của ticket đó. Loại UI mà `platform`
   dự án không hỗ trợ (`assertTestKindsSupported()`, dùng `isTestKindSupported()`) bị từ chối
   `VALIDATION_FAILED` nêu rõ loại và platform (`details: {unsupported, platform}`); `requiredMcps` PM gửi chứa
   tên MCP Playwright/Maestro của dự án (`Object.values(project.uiTestMcp)`) mà `testKinds` không có loại UI
   tương ứng cũng bị từ chối `VALIDATION_FAILED` (`details: {mismatched}`). QC **không** gửi `testKinds` (daemon
   bản cũ) giữ nguyên hành vi cũ: luôn được cộng thêm MCP test UI mặc định theo platform (`qcDefaultMcps()`, flow
   `project-claims`); `testKinds`/`testReason` chỉ hợp lệ với `type: 'qc'`, đặt trên loại khác bị từ chối ngay
   ở schema. Subtask `dev`/`qc` bắt buộc có
   `complexity` và một dòng `complexityReason` (`CreateSubtaskRequest.superRefine`, cùng file `api-schemas.ts`
   nói ở bước 11) — không có model mặc định cho hai loại này (flow `agent-roles`); thiếu một trong hai trường bị
   từ chối `VALIDATION_FAILED` với `details` nêu đúng trường còn thiếu.
3. `apps/api/src/services/ticket-service.ts` → `rateSubtask()`: PM đánh giá (hoặc đánh giá lại) `complexity` của
   một subtask `dev`/`qc`/`bug` **của chính pm_task đó**, ngay tại chỗ, không tạo subtask thay thế —
   `:id` ticket phải là `pm_task` (không thì `FORBIDDEN`: dev/QC không tự chấm được), ticket đích phải là con
   `dev`/`qc`/`bug` còn sống của đúng pm_task đó (không thì `FORBIDDEN`: `docs_init`, cây khác hay dự án khác
   đều bị từ chối), chưa đóng (`done`/`cancelled` thì `TICKET_CLOSED`); validate `complexity`/`complexityReason`
   bắt buộc và `model` chỉ nhận `SelectableModel` giống `create_subtask`. Mức mới **thay hẳn** mức cũ, kể cả
   `model`/`effort` ghi đè trước đó (bị xoá trừ khi lượt đánh giá này đặt lại); phát `ticket.updated{change:
   'fields'}` nên Details trên web thấy ngay. Một job đang chạy giữ nguyên model hiện tại, lượt chạy sau mới
   dùng mức mới. Ticket đang `blocked` vì chưa từng có `complexity` (đường crash `MissingComplexityError` của
   flow `agent-roles`) được đánh giá xong thì tự chuyển `in_progress` trong cùng transaction, phát thêm
   `ticket.status_changed` và `ticket.unblocked` cho máy phụ trách — daemon tự chạy lại trên model mới mà
   không cần owner mở chặn; một ticket `blocked` vì lý do khác (đã có `complexity` từ trước) giữ nguyên
   `blocked`. Một ticket `todo` chưa từng có `complexity` (lượt chạy trước đó crash trước khi kịp bắt đầu, và
   agent không tự chuyển được ticket `todo` sang `blocked` nên nó kẹt lại `todo`) được đánh giá xong thì đánh
   thức lại bằng cách phát `ticket.assigned` (role = vai trò được giao của ticket) cho đúng máy — daemon xếp
   một job mới (job cũ đã thất bại, không còn hoạt động) mà không cần owner bình luận; một ticket `todo` đã có
   `complexity` từ trước thì không bị đánh thức lại kiểu này.
4. `apps/api/src/services/ticket-service.ts` → `updateQcTestPlan()`: PM đổi phương án kiểm thử
   (`testKinds`/`testReason`) của một subtask `qc` **của chính pm_task đó** tại chỗ, không đổi trạng thái —
   cùng khuôn với `rateSubtask()` ở bước 3: `:id` phải là `pm_task` (không thì `FORBIDDEN`), ticket đích phải là
   con `qc` còn sống của đúng pm_task đó (không thì `FORBIDDEN`), chưa đóng (`done`/`cancelled` thì
   `TICKET_CLOSED`). Ghi `testKinds`/`testReason` mới rồi tính lại `requiredMcps` = (`requiredMcps` hiện tại
   trừ mọi tên MCP UI của dự án, `Object.values(project.uiTestMcp)`) ∪ MCP UI suy từ phương án mới
   (`uiMcpsForTestKinds()`, flow `project-claims`) — cùng luật kiểm tra platform như bước 2
   (`assertTestKindsSupported()`, `VALIDATION_FAILED` khi loại UI dự án không hỗ trợ). Phát
   `ticket.updated{change: 'fields'}` như `rateSubtask()`. Route `POST /v1/daemon/tickets/:id/test-plan` (flow
   `daemon-api`) idempotent như mọi ghi khác của daemon.
5. `apps/api/src/services/ticket-service.ts` → `retrySubtask()`: PM chuyển một subtask `dev`/`qc`/`bug`/
   `docs_init` đang `blocked` **của chính pm_task đó** về `in_progress` và đánh thức agent của nó
   (`ticket.unblocked`), như owner tự bỏ chặn — dùng khi owner gọi PM bằng `@pm` và nguyên nhân chặn đã được xử
   lý (không phải thiếu `complexity`, việc đó dùng `rateSubtask()` ở bước 3). `:id` không phải `pm_task`, hay
   ticket đích không phải con của đúng `pm_task` đó đều `FORBIDDEN`; ticket đích không `blocked` thì
   `ILLEGAL_TRANSITION`. Route `POST /v1/daemon/tickets/:id/retry-subtask` (flow `daemon-api`) idempotent như
   mọi ghi khác của daemon.
6. `apps/api/src/services/ticket-service.ts` → `fileBug()`: hai nguồn tạo `bug` — QC báo lỗi trên ticket dev/bug
   nó verify (`pairsWith`), hoặc PM từ chối một ticket dev/bug đã `done` khi nghiệm thu (`reject_work`, flow
   `agent-roles`; ticket nguồn khi đó chính là ticket bị từ chối, không phải QC). Tính `cycle = bugCycle + 1`
   của dev gốc (`originDevId`); vượt `MAX_BUG_CYCLES` (3) thì không tạo ticket, gọi `applyHold()` park pm_task
   và trả lỗi `BUG_CYCLE_CAP` (side effect đã commit); còn lại tạo một `bug` ticket cộng một `qc` retest phụ
   thuộc nó, cùng `pairsWith` bug đó, `bugCycle` tăng dần. `bug` lấy `complexity`/`model`/`effort` của **dev
   ticket gốc** (`originDevId`, không phải ticket vừa verify) — PM không tự chấm lại bug, nó chạy đúng mức PM
   đã chấm cho dev — với `complexityReason` = `kế thừa từ <DEV-KEY>: <lý do>` (`inheritedReason()`); retest kế
   thừa `complexity`/`model`/`effort`/`requiredSkills`/`requiredMcps` của **QC ticket đang kiểm ticket bị từ
   chối** (tìm qua `pairsWith`), không phải của ticket nguồn, kể cả khi nguồn là PM từ chối chứ không phải
   chính QC đó báo lỗi, với `complexityReason` = `kế thừa từ <QC-KEY>: <lý do>`; một lý do đã bắt đầu bằng
   `kế thừa từ ` (retest của retest) được giữ nguyên, không lồng thêm tiền tố. Retest cũng chép nguyên
   `testKinds`/`testReason` của QC ticket đó: có phương án (`testKinds` khác `null`) thì `requiredMcps` chép
   thẳng của QC gốc, **không** cộng `qcDefaultMcps()` lần nữa (phương án gốc đã là nguồn sự thật); QC gốc là
   ticket cũ không có phương án (`testKinds: null`) thì giữ hành vi hiện tại — cộng `qcDefaultMcps()` vào
   `requiredMcps` chép được như trước khi có phương án kiểm thử.
7. `apps/api/src/services/ticket-service.ts` → `transitionTicket()`: `canTransition(actor, from, to)` (từ
   `packages/shared/src/status-workflow.ts`) gác cổng; `to='done'` bắt buộc đã có report hiện hành
   (`REPORT_REQUIRED`); sau khi cập nhật trạng thái trong cùng transaction: `cascadeCancel()` khi huỷ,
   `resolveDependents()` phát `dependency.resolved` cho ticket đang chờ khi `done`, `ownerWakeUp()` phát
   `ticket.reopened`/`ticket.unblocked` khi owner mở lại/bỏ chặn, `childrenAllDone()` phát
   `children.all_done` khi con cuối cùng đóng (dù `done` hay `cancelled`).
8. `packages/shared/src/status-workflow.ts` → `canTransition()`/`allowedTransitions()`: bảng cạnh hợp lệ theo
   actor (`AGENT_EDGES`, `OWNER_EDGES`); `system` (dùng cho cascade cancel) được thêm cạnh `* → cancelled`.
   `packages/shared/src/agent-schemas.ts` → `RoleStage`: bước của một agent run (`assistant_triage`,
   `pm_analyze`, `dev`, `docs_update`, `qc`, `docs_init`, …); mỗi bước có đường trạng thái riêng phải hợp lệ
   với `canTransition('agent', …)` (định nghĩa và kiểm ở flow `agent-roles`, không lặp lại ở đây). `DOCS_MODEL`
   (`= 'sonnet'`) là model cố định của `docs_init`/`docs_update`.
9. `apps/api/src/services/ticket-service.ts` → `addComment()`: bình luận owner trên ticket đang
   `needs_input` tự chuyển nó về `in_progress` và gọi `liftHold()`; bình luận owner (không tag `@pm`) trên
   ticket đang `blocked` cũng mở chặn nó về `in_progress` (`unblockByComment()`), phát `ticket.status_changed`
   (`blocked`→`in_progress`) và `ticket.unblocked` cho máy phụ trách — y hệt owner tự đổi trạng thái — trước
   `ticket.comment_added` (daemon gộp cả hai vào một job, coi trigger là mở chặn và đọc bình luận mới nhất);
   bình luận agent/system chỉ phát `ticket.updated{change:'comment'}`, không đánh thức ai, không bao giờ mở
   chặn. Bình luận owner tag `@pm` (không phân biệt hoa thường; `packages/shared/src/comment-mentions.ts` →
   `parseMentions()`, bỏ qua tag trong code block/inline code và trong địa chỉ email/URL, qua hàm dùng chung
   `markdownWithoutCode()` — cũng dùng bởi `extractAttachmentIds()` của flow `agent-runs` để bỏ link ảnh viết
   trong code khỏi văn bản ticket) trên **bất kỳ ticket nào của một cây pm_task** (chính pm_task, hay con
   dev/qc/bug/docs_init của nó, kể cả con đã đóng) thay hẳn hiệu ứng ở trên: `pmTaskToWake()` tìm pm_task đang
   coi sóc ticket đó (`governingPmTask()`: chính ticket nếu là pm_task, không thì cha pm_task), rồi `pmMentioned()` phát `ticket.pm_mentioned` (không phát
   `ticket.comment_added`) nhắm `ticketId=<pm_task>`, `targetMachineId` là máy chủ dự án
   (`project.ownerMachineId`, dự phòng máy phụ trách pm_task), `targetRole: 'pm'` — agent của ticket được tag không bị
   đánh thức và trạng thái của nó không đổi (kể cả `needs_input`/`blocked` — một tag trên ticket `blocked`
   không mở chặn nó, chỉ đánh thức PM, PM tự quyết định, ví dụ bằng `retry_subtask`); riêng tag ngay trên
   chính pm_task vẫn trả nó về `in_progress` như một câu trả lời owner bình thường (`answerNeedsInput()`, dùng chung với nhánh không có
   tag). Ticket không thuộc cây pm_task nào (ví dụ `request`) hay pm_task đã đóng (`done`/`cancelled`) bị từ
   chối `PM_NOT_AVAILABLE` (400, `packages/shared/src/api-schemas.ts` → `ApiErrorCode`, flow `api-platform`) —
   không lưu bình luận, không phát sự kiện nào. `toCommentDto()` dựng DTO `Comment` cho mọi phản hồi (owner
   POST, daemon POST, chi tiết ticket ở bước 14) với trường `mentions` tính từ text, chỉ cho bình luận owner
   (agent/system luôn `[]`); một bình luận owner có tag đã lưu trong DB luôn từng đánh thức được PM, vì tag bị
   từ chối ngay khi không có PM nào để gọi.
10. `apps/api/src/services/ticket-service.ts` → `updateTicket()`: owner sửa tiêu đề/mô tả/ưu tiên tại chỗ,
   không bao giờ đánh thức agent, chỉ phát `ticket.updated{change:'fields'}`.
11. `apps/api/src/services/report-service.ts` → `submitReport()`: lưu report mới là bản hiện hành (bản cũ mất
   `is_current`), cộng `costUsd` của report vào ticket/ngân sách qua `addCost()` (flow này gọi sang
   `budget-service.ts`), phát `ticket.updated{change:'report'}`. `SubmitReportRequest`/subtask (`requiredMcps`)
   ở `packages/shared/src/api-schemas.ts` validate tên MCP server (`mcpsUsed`, `mcpsSelected`) bằng
   `McpServerName` của `packages/shared/src/project-schemas.ts` (flow `project-claims`), nên một report ghi
   đúng tên plugin/connector Claude Code báo cáo không bị từ chối. Cùng file `api-schemas.ts` này còn chứa
   schema xác thực owner, gồm `LoginRequest`/`SessionResponse`/`ChangePasswordRequest` và `MIN_PASSWORD_LENGTH`
   (flow `owner-auth`) — ba schema này không còn trường xác thực hai bước (mã TOTP, mã khôi phục, challenge)
   sau khi tính năng đó bị bỏ.
12. `apps/api/src/services/report-service.ts` → `recordAgentMeta()`: daemon ghi `agentSessionId`/`agentModel`/
    `agentEffort` và cộng `costDeltaUsd` cho lượt chạy không kết thúc bằng report (hợp đồng: chi phí một lượt
    chạy chỉ được cộng đúng một lần, hoặc qua report hoặc qua delta này, không bao giờ cả hai).
13. `apps/api/src/services/budget-service.ts` → `enforceChildCap()`, `addCost()`, `applyHold()`, `liftHold()`:
    kiểm tra trần con mỗi ticket (`maxChildrenPerTicket`), ngân sách cây pm_task
    (`ticketTreeBudgetUsd`) và ngân sách ngày dự án (`dailyBudgetUsd`, theo múi giờ project); vượt trần thì
    park pm_task (`budgetHold`), bình luận hệ thống giải thích, phát `budget.exceeded`; owner bình luận hoặc
    chuyển `needs_input → in_progress` sẽ gỡ hold cho toàn bộ cây pm_task đó (`childCapLifted`/
    `costBudgetLifted`), không chỉ một batch.
14. `apps/api/src/services/ticket-query-service.ts` → `listTickets()`, `getTicketDetail()`, `getTicketTree()`,
    `search()`, `inProjectsFilter()`: danh sách có lọc/sắp xếp/keyset-pagination (cursor mã hoá base64url) —
    lọc `projectId` (một dự án) hoặc `projectIds` (tối đa 100 uuid, `ListTicketsQuery` ở
    `packages/shared/src/api-schemas.ts`): không lọc dự án nào trả về ticket mọi dự án cộng mọi request; có
    `projectIds` thì `inProjectsFilter()` giữ ticket có `projectId` nằm trong tập đó, cộng ticket `request`
    được route tới một trong các dự án đó (một con — pm_task — có `projectId` nằm trong tập, qua `EXISTS`
    subquery) hoặc chỉ mới gợi ý (`projectHintId`), kết hợp với các bộ lọc khác và phân trang; chi tiết ticket
    kèm con/bình luận/report hiện hành/dòng sự kiện. `getTicketTree()` (route `GET /v1/tickets/:id/tree`,
    owner): mọi hậu duệ (mở và đã đóng) của một ticket theo id hay key, mỗi cấp một truy vấn (cha trước con,
    cũ nhất trước, tối đa 4 cấp — request → pm_task → dev/qc/bug/docs_init), chặn ở `TREE_LIMIT` (1000) kèm cờ
    `truncated: true` khi bị cắt; mỗi ticket có `agentActivity` (`withAgentActivity()`). Response theo schema
    `TicketTreeResponse { items: Ticket[], truncated: boolean }` (`api-schemas.ts`). Chọn cách này thay vì web
    tự liệt kê từng cấp, để một request nhiều pm_task chỉ tốn một lượt gọi HTTP thay vì một lượt mỗi node/cấp.
    Ticket không tồn tại → 404, không có session owner → 401. `search()` (`GET /v1/search`, `SearchQuery`):
    tìm kiếm nhanh (ticket theo key/tiêu đề, cộng docs qua `searchAllDocs()` của flow `docs-sync-viewer`);
    mỗi ticket trả kèm `projectId` (`null` cho request); `projectIds` (nếu có, cùng `ProjectIdsFilter` mà
    `ListTicketsQuery` dùng) thu hẹp cả ticket (qua `inProjectsFilter()`, gồm request được route hoặc gợi ý)
    lẫn docs (`searchAllDocs(db, q, projectIds)`) về đúng các dự án đó; bình luận trong chi tiết ticket qua
    `toCommentDto()` (bước 9) nên cũng có `mentions`.
15. `apps/api/src/jobs/stuck-ticket-alarm.ts` → `findStuckTickets()`/`raiseStuckTicketAlarms()`: mỗi
    `STUCK_CHECK_INTERVAL_MS` (5 phút) tìm ticket không kết thúc, im lặng quá `STUCK_AFTER_MS` (30 phút, tính
    theo lần đổi trường ticket gần nhất hoặc bất kỳ sự kiện nào khác ngoài cảnh báo trước đó), không đang chờ
    owner (`needs_input`/`blocked`/`request` ở `in_review`), không còn con hay `dependsOn` mở, và không máy nào
    đang chạy (heartbeat `runningJobs`) hay giữ trong hàng đợi/backoff (heartbeat `waitingJobs`, nhớ tối đa 2
    phút mỗi máy qua `WaitingJobsRegistry`) — mỗi lần im lặng như vậy chỉ phát đúng một sự kiện `ticket.stuck`
    (flow `event-delivery`, chỉ owner stream) cho tới khi có hoạt động mới.
16. `apps/api/src/services/agent-activity-service.ts` → `loadAgentActivity()`: cho mỗi ticket, chọn báo cáo tốt
    nhất giữa các máy chưa bị revoke — job đang chạy tươi > job đang chờ tươi > job vừa lỗi > mọi báo cáo cũ
    (đọc `machines.runningJobs`/`waitingJobs`/`failedJobs`, flow `machine-pairing`); heartbeat cũ hơn
    `AGENT_ACTIVITY_STALE_MS` (2 phút) hoặc máy offline đọc thành `unknown`, không bao giờ `running`. Ticket
    `todo` không máy nào báo trả `unreported` kèm máy được gán (`assigneeMachineId`); trạng thái `failed`/
    `unreported` bị ẩn với ticket đã đóng (`done`/`cancelled`). `AgentActivity.settingsRevision` (chỉ khi
    `running`) là bản cài đặt server (flow `server-settings`) mà lượt chạy đó bắt đầu với, lấy nguyên từ
    `RunningJob.settingsRevision` của heartbeat — hiện trên `AgentActivityLine` (flow `web-tickets`).
    `withAgentActivity()` gắn kết quả vào DTO —
    `ticketRoutes` (`GET /v1/tickets`, `GET /v1/tickets/:id`) dùng nó cho cả ticket và con; route daemon không
    gọi, nên `Ticket.agentActivity` luôn vắng ở đó. `recordHeartbeat()` (flow `machine-pairing`) dùng
    `activitySignatures()`/`changedTicketIds()`/`heartbeatFresh()` cùng file để biết ticket nào cần phát
    `agent.activity_changed`.
17. `apps/api/src/services/attachment-service.ts` → `uploadAttachment()`/`uploadDraftAttachment()`/
    `getAttachmentContent()`: ảnh dán clipboard vào ô mô tả/comment ticket (phần paste-to-upload ở UI là
    `usePasteImage()` của flow `web-tickets`), cộng ảnh dán vào hộp thoại "Tạo ticket" khi ticket chưa tồn
    tại. Cả `uploadAttachment()` (route `POST /v1/tickets/:id/attachments`, dùng `getTicketRow()` từ
    `ticket-service.ts` nên `:id` nhận cả uuid lẫn ticket key như route ticket khác, ticket không tồn tại thì
    404 và không tạo bản ghi) lẫn `uploadDraftAttachment()` (route `POST /v1/attachments`, không nhận ticket
    id, chèn `ticket_id = NULL`) đều gọi chung một hàm nội bộ `insertAttachment()` để validate `mimeType` theo
    whitelist (`AttachmentMimeType` = `image/png|jpeg|gif|webp`) và kích thước **bytes đã decode** (không phải
    độ dài chuỗi base64) ≤ `MAX_ATTACHMENT_BYTES` (10MB) trước khi ghi gì — vượt kích thước thì
    `decodeImage()` ném `ApiError('ATTACHMENT_TOO_LARGE', ATTACHMENT_TOO_LARGE_MESSAGE)` (413, message
    `` `ảnh vượt quá 10MB` ``) thay vì `VALIDATION_FAILED` chung; lưu ảnh vào cột `bytea` bảng `attachments`,
    trả `Attachment { id, url, mimeType, sizeBytes }` với `url` là đường dẫn `GET` để chèn vào markdown, cho
    cả hai route. Mime whitelist được kiểm hai lần: ở zod boundary (`UploadAttachmentRequest`, route
    `attachmentRoutes`) và lại trong `decodeImage()` trước khi ghi DB, để `mimeType` lưu luôn nằm trong
    whitelist dù input đi từ đâu. Ảnh nháp (`ticket_id IS NULL`, của owner đang đăng nhập) được
    `claimDraftAttachments()` gắn vào ticket khi owner tạo ticket có mô tả tham chiếu nó (bước 1), hoặc bị
    `deleteOrphanedDraftAttachments()`/`startDraftAttachmentCleanup()` xoá nếu bỏ quên quá `DRAFT_ATTACHMENT_TTL_MS`
    (24 giờ) — chạy mỗi `DRAFT_ATTACHMENT_CLEANUP_INTERVAL_MS` (1 giờ), đăng ký/dừng ở `apps/api/src/app.ts`
    cạnh `startStuckTicketAlarm()` (flow `api-platform`), log `warn` kèm id đã xoá khi có, `error` khi một lượt
    chạy lỗi (không dừng timer). Attachment đã gắn ticket (kể cả rất cũ) không bao giờ là ứng viên của job này,
    dù `ticket_id` trỏ tới ticket đã đóng hay đã bị xoá theo cascade. `getAttachmentContent()` đọc
    `mime_type`/`content` theo `id`, 404 khi không tồn tại; route GET stream đúng bytes kèm header
    `Content-Type` từ `mimeType` đã lưu và `cache-control: private, no-store` — dùng chung cho ảnh đã gắn
    ticket lẫn ảnh nháp. `AttachmentMimeType`, `MAX_ATTACHMENT_BYTES`, `UploadAttachmentRequest`, `Attachment`,
    mã lỗi `ATTACHMENT_TOO_LARGE` khai ở `packages/shared/src/api-schemas.ts` (cùng file nói ở bước 11), status
    413 ánh xạ ở `apps/api/src/errors.ts` (flow `api-platform`). Cả hai route POST tự đặt `bodyLimit` riêng (đủ
    base64 10MB + margin JSON, dư ra ~49KB quy đổi ảnh gốc) để không đụng `bodyLimit` mặc định 2MB của Fastify
    (flow `api-platform`) — cùng cách `runtime-routes.ts` (flow `runtime-updates`) làm với `UPLOAD_BODY_LIMIT`;
    ảnh gốc lớn tới mức vượt cả `UPLOAD_BODY_LIMIT` (ví dụ 15MB, 20MB) bị Fastify tự chặn ở tầng body-parser
    (`FST_ERR_CTP_BODY_TOO_LARGE`) trước khi vào `decodeImage()` — `attachmentRoutes` đăng ký một
    `setErrorHandler` riêng (Fastify cô lập theo `register()`, không ảnh hưởng route khác) bắt riêng mã lỗi đó
    và trả cùng `ApiError('ATTACHMENT_TOO_LARGE', ATTACHMENT_TOO_LARGE_MESSAGE)` mà `decodeImage()` dùng, các
    lỗi khác của cả hai route POST này vẫn qua `sendApiError()` dùng chung (`errors.ts`, flow `api-platform`) —
    nhờ vậy mọi ảnh vượt 10MB, dù lọt qua `bodyLimit` hay bị chặn ở tầng route, đều nhận cùng một mã lỗi và
    thông báo rõ ràng thay vì rơi vào `VALIDATION_FAILED` chung. Agent không tự paste ảnh, nhưng daemon cần tải
    lại ảnh chủ dự án đã dán để đưa cho agent: `getAttachmentWithTicket()` đọc thêm ticket sở hữu ảnh (join
    `attachments.ticket_id` → `tickets`) để route `GET /v1/daemon/attachments/:id` (`daemonAttachmentRoutes`,
    cùng file `attachment-routes.ts`, đăng ký trong nhóm route daemon của `buildApp()`, flow `daemon-api`) kiểm
    phạm vi bằng `assertTicketReadable()` (flow `machine-pairing`, luật y hệt `GET /v1/daemon/tickets/:id`)
    trước khi trả bytes — ảnh ngoài phạm vi máy nhận `403` ngay, không rơi về `404` hay lộ `mimeType`. Route này
    dùng lại đúng header `Content-Type`/`cache-control: private, no-store` như route owner, và không cần
    `Idempotency-Key` vì là route đọc.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/ticket-routes.ts` | Route ticket owner + search | `ticketRoutes` |
| `apps/api/src/routes/comment-routes.ts` | Route bình luận owner | `commentRoutes` |
| `apps/api/src/routes/report-routes.ts` | Route đọc report owner | `reportRoutes` |
| `apps/api/src/routes/attachment-routes.ts` | Route upload/đọc ảnh đính kèm owner (kể cả ảnh nháp), cộng route đọc cho daemon | `attachmentRoutes`, `daemonAttachmentRoutes` |
| `apps/api/src/services/ticket-service.ts` | Tạo, đánh giá lại, transition, bug loop, bình luận (kể cả tag `@pm`), sửa ticket, đổi phương án kiểm thử QC | `createRequestTicket`, `createSubtask`, `rateSubtask`, `updateQcTestPlan`, `retrySubtask`, `fileBug`, `transitionTicket`, `addComment`, `toCommentDto`, `updateTicket`, `lockWithParent`, `governingPmTask`, `claimDraftAttachments`, `assertTestKindsSupported` |
| `apps/api/src/services/ticket-query-service.ts` | Danh sách, chi tiết, cây hậu duệ, tìm kiếm | `listTickets`, `getTicketDetail`, `getTicketTree`, `search`, `inProjectsFilter`, `TREE_LIMIT` |
| `packages/shared/src/comment-mentions.ts` | Tag `@pm` trong bình luận owner | `CommentMention`, `parseMentions`, `markdownWithoutCode` |
| `apps/api/src/services/report-service.ts` | Report và agent-meta | `submitReport`, `recordAgentMeta`, `getReports`, `getCurrentReport` |
| `apps/api/src/services/budget-service.ts` | Trần con, ngân sách, hold | `enforceChildCap`, `addCost`, `applyHold`, `liftHold`, `getBudgetStatus` |
| `apps/api/src/jobs/stuck-ticket-alarm.ts` | Báo ticket đứng yên không ai xử lý | `findStuckTickets`, `raiseStuckTicketAlarms`, `startStuckTicketAlarm`, `WaitingJobsRegistry` |
| `apps/api/src/services/agent-activity-service.ts` | Tính hoạt động agent hiển thị cho owner, từ heartbeat máy | `loadAgentActivity`, `withAgentActivity`, `activitySignatures`, `changedTicketIds`, `heartbeatFresh` |
| `apps/api/src/services/attachment-service.ts` | Lưu/đọc ảnh đính kèm (bytea, kể cả ảnh nháp chưa gắn ticket), validate mime + size, dọn ảnh nháp mồ côi | `uploadAttachment`, `uploadDraftAttachment`, `getAttachmentContent`, `getAttachmentWithTicket`, `deleteOrphanedDraftAttachments`, `startDraftAttachmentCleanup`, `ATTACHMENT_TOO_LARGE_MESSAGE`, `DRAFT_ATTACHMENT_TTL_MS` |
| `packages/shared/src/ticket-schemas.ts` | Enum trạng thái/loại/ưu tiên/actor ticket | `TicketStatus`, `TicketType`, `Actor` |
| `packages/shared/src/agent-schemas.ts` | Enum role/complexity/model/effort/bước agent, lý do chờ job và hoạt động agent | `AgentRole`, `Complexity`, `ModelAlias`, `SelectableModel`, `Effort`, `RoleStage`, `DOCS_MODEL`, `JobWaitReason`, `JobWaitDetail`, `AGENT_ACTIVITY_STALE_MS`, `AgentActivityStatus`, `AgentActivity` |
| `packages/shared/src/status-workflow.ts` | Bảng cạnh workflow, kiểm tra transition | `canTransition`, `allowedTransitions`, `AGENT_EDGES`, `OWNER_EDGES`, `TERMINAL_STATUSES` |

## Dữ liệu

- Bảng: `tickets`, `ticket_counters`, `comments`, `ticket_reports`, `budgets_usage`, `attachments` (ảnh dán
  clipboard, nội dung `bytea`, FK `owner_id` cascade delete, cột `bytea` custom type dùng chung với
  `runtime_bundles` của flow `runtime-updates`, khai ở `apps/api/src/db/schema.ts` flow `api-platform`).
  `ticket_id` **nullable** (từ migration `0011_attachments_nullable_ticket_id.sql`, flow `api-platform`) vẫn
  giữ FK `ON DELETE cascade` khi có giá trị: `NULL` là ảnh nháp chưa gắn ticket (`POST /v1/attachments`), được
  `claimDraftAttachments()` gắn khi tạo ticket tham chiếu nó, hoặc bị dọn sau 24 giờ nếu bỏ quên
  (`deleteOrphanedDraftAttachments()`). Cột `tickets.test_kinds` (`text[]`, nullable) và `tickets.test_reason`
  (`text`, nullable, migration `apps/api/drizzle/0012_qc_test_plan.sql` flow `api-platform`) — phương án kiểm
  thử của một ticket `qc` (`null` cho `dev` và cho QC tạo trước khi có tính năng này); `TestKind`/
  `TEST_KIND_INFO`/`isTestKindSupported`/`uiMcpsForTestKinds` (`packages/shared/src/project-schemas.ts`, flow
  `project-claims`) là nguồn sự thật duy nhất cho nhãn, công cụ gợi ý và MCP UI suy ra từ từng loại.
- Trường tính không lưu DB: `Ticket.agentActivity` — `withAgentActivity()` đọc bảng `machines` (flow
  `machine-pairing`) mỗi lần trả owner đọc, không cache.
- Sự kiện: `ticket.assigned`, `ticket.status_changed`, `ticket.cancelled`, `ticket.comment_added`,
  `ticket.pm_mentioned` (owner tag `@pm`, thay hẳn `ticket.comment_added` của bình luận đó — chi tiết ở flow
  `event-delivery`), `ticket.updated`, `ticket.reopened`, `ticket.unblocked`, `dependency.resolved`,
  `children.all_done`, `budget.exceeded`, `ticket.stuck`.
- Gọi ngoài: không.

## Flow liên quan

- daemon-api: mọi ghi của agent (tạo subtask, file bug, report, transition, bình luận) gọi thẳng các hàm ở
  đây với `actor='agent'`, qua route `/v1/daemon/*`. `GET /v1/daemon/attachments/:id` (`daemonAttachmentRoutes`,
  cùng file `attachment-routes.ts`) cũng đăng ký trong nhóm route daemon đó, đọc lại ảnh đã dán cho agent.
- machine-pairing: `agent-activity-service.ts` đọc `machines.runningJobs`/`waitingJobs`/`failedJobs` (ghi bởi
  `recordHeartbeat()`) để tính `AgentActivity` của từng ticket; `agent.activity_changed` do `recordHeartbeat()`
  phát khi báo cáo đổi. `daemonAttachmentRoutes` dùng lại `assertTicketReadable()` của flow này để kiểm phạm
  vi ticket sở hữu ảnh trước khi trả bytes, không viết luật phạm vi mới.
- project-claims: `qcDefaultMcps()` (project-schemas) quyết định MCP bắt buộc của QC không có phương án kiểm
  thử; `uiMcpsForTestKinds()`/`isTestKindSupported()` (cùng file) quyết định MCP UI của QC có `testKinds`;
  `retargetOpenTickets()` ở đó cập nhật `assignee_machine_id` khi project đổi chủ.
- event-delivery: mọi `NewEvent` sinh ra ở đây được `appendEvents()` ghi vào outbox `events` rồi phát qua SSE.
- docs-sync-viewer: `search()` gộp kết quả `searchAllDocs()`; `flows[]` của ticket liên kết tới trang
  `docs/flows/<id>.md` tương ứng trên web.
- web-tickets: `usePasteImage()` (ô mô tả ticket và ô bình luận) gọi `POST /v1/tickets/:id/attachments` ở đây
  để paste-to-upload ảnh clipboard, chèn `Attachment.url` trả về vào markdown.
- agent-roles: `RoleStage` và `STAGES` (flow đó) gán mỗi bước agent vào một ticket loại nào chạy khi nào; tool
  `reject_work` của PM gọi `fileBug()` với ticket dev/bug đã `done` làm nguồn; `create_subtask` thêm phụ thuộc
  `docs_init`.
- agent-runs: `markdownWithoutCode()` (bảng Files) dùng chung bởi `parseMentions()` ở đây và
  `extractAttachmentIds()` của flow đó; daemon tải ảnh dán trong mô tả/bình luận ticket qua
  `GET /v1/daemon/attachments/:id` ở trên.
- local-merge: `head_sha` mà `mergeAndPush()` merge đến từ `report.headSha` (`submitReport()`).
- daemon-runtime: `waitingJobs` mà heartbeat của daemon gửi lên (`apps/daemon/src/daemon.ts`) là điều
  `findStuckTickets()` dùng để không báo nhầm ticket đang chờ thử lại.
- server-settings: `AgentActivity.settingsRevision` của ticket đang chạy là bản cài đặt server job đó bắt
  đầu với.
- api-platform: bảng `attachments` khai ở `apps/api/src/db/schema.ts`, migration
  `apps/api/drizzle/0010_attachments.sql` (tạo bảng) và `0011_attachments_nullable_ticket_id.sql` (`ticket_id`
  thành nullable) chạy qua `runMigrations()` như mọi migration khác; cột `bytea` custom type dùng chung với
  `runtime_bundles` (flow `runtime-updates`); `attachmentRoutes` dùng lại `sendApiError()`
  (`apps/api/src/errors.ts`) cho mọi lỗi khác lỗi vượt kích thước; mã lỗi `ATTACHMENT_TOO_LARGE` ánh xạ 413 ở
  `STATUS_BY_CODE` (`errors.ts`); `startDraftAttachmentCleanup()` đăng ký/dừng ở `buildApp()` cạnh
  `startStuckTicketAlarm()`, cùng vòng đời `onReady`/`preClose`. Cột `tickets.test_kinds`/`tickets.test_reason`
  cũng khai ở `apps/api/src/db/schema.ts`, migration `apps/api/drizzle/0012_qc_test_plan.sql` chạy qua
  `runMigrations()` như mọi migration khác.

## Tests

- `apps/api/test/ticket-service.test.ts`: key đầu tiên là `AST-1`, key không trùng khi tạo đồng thời.
- `apps/api/test/qc-test-plan.test.ts`: `createSubtask()` — `testKinds` chỉ gồm loại không-UI (`api`,
  `integration`) trên dự án `web`/`web_mobile` không cộng MCP UI vào `requiredMcps`; `['ui_web']` trên `web`
  chứa đúng tên `uiTestMcp.playwright` của dự án (kể cả tên khác mặc định), `['ui_web','ui_mobile']` trên
  `web_mobile` chứa cả hai; `ui_mobile` trên `web`, `ui_web` trên `mobile`, mọi loại UI trên `backend` đều
  `VALIDATION_FAILED`; `requiredMcps` có MCP UI của dự án mà `testKinds` không có loại UI tương ứng
  → `VALIDATION_FAILED`; `testKinds`/`testReason` trên ticket `dev` → 400 `VALIDATION_FAILED` qua route daemon;
  không gửi `testKinds` giữ nguyên hành vi cũ (`qcDefaultMcps`, `testKinds`/`testReason` là `null`). `fileBug()`
  — QC gốc có `testKinds`: retest có cùng `testKinds`/`testReason`/`requiredMcps`, không có MCP UI; QC gốc
  không có `testKinds` (ticket cũ): giữ hành vi hiện tại. `POST /v1/daemon/tickets/:id/test-plan` — đổi
  `['ui_web']` → `['api']` gỡ `playwright` khỏi `requiredMcps`, giữ MCP khác; đổi ngược lại thêm `playwright`
  vào; không đổi trạng thái ticket, chỉ đổi `requiredMcps`/`testKinds`/`testReason`; ticket `done`/`cancelled`
  → `TICKET_CLOSED`; ticket không phải `qc`, không thuộc đúng `pm_task`, hoặc `:id` không phải `pm_task` →
  `FORBIDDEN`; gửi lại cùng `Idempotency-Key` không tạo thay đổi thứ hai.
- `apps/api/test/transition.test.ts`: đủ ma trận cạnh hợp lệ theo actor, `REPORT_REQUIRED`, mã lỗi HTTP.
- `apps/api/test/lifecycle-effects.test.ts`: `dependency.resolved`, đúng một `children.all_done` khi tuần tự
  lẫn đồng thời, cascade cancel phát đúng một `ticket.cancelled` mỗi máy, đánh thức owner, rollback nguyên tử;
  bình luận owner trên ticket `blocked` mở chặn nó (`ticket.status_changed` rồi `ticket.unblocked` phát trước
  `ticket.comment_added`, để daemon coi lượt chạy là trả lời mở chặn); bình luận agent trên ticket `blocked`
  không mở chặn.
- `apps/api/test/bug-loop.test.ts`: vòng lặp bug từ QC lẫn từ PM từ chối, chặn ở chu kỳ 4, retest kế thừa
  cấu hình của QC ticket đang kiểm ticket bị từ chối; `bug` kế thừa `complexity`/`model`/`effort` của dev
  ticket gốc kèm `complexityReason` "kế thừa từ …", retest kế thừa của QC tương ứng, một vòng lặp lỗi tiếp
  theo trong chuỗi vẫn quy về đúng dev gốc và không lồng tiền tố "kế thừa từ ".
- `apps/api/test/rate-subtask.test.ts`: `model: 'fable'` bị từ chối cả ở tạo subtask lẫn ở đánh giá lại với
  thông báo rõ ràng (enum lưu trữ vẫn giữ `fable` cho hàng cũ, không migration nào xoá nó); PM đánh giá lại một
  subtask `dev` tại chỗ, thay hẳn override cũ, báo owner stream ngay; idempotent (retry cùng key chỉ ghi một
  lần); validate `complexity`/`complexityReason` bắt buộc như tạo mới; phạm vi giới hạn đúng PM của subtask đó
  (máy khác, không phải PM, cây khác, ticket đã đóng đều bị từ chối); một ticket `blocked` vì chưa có đánh giá
  tự chuyển `in_progress` và đánh thức máy phụ trách, một ticket `blocked` vì lý do khác thì giữ nguyên; một
  ticket `todo` chưa có đánh giá mà lượt chạy trước đó crash trước khi kịp bắt đầu được đánh thức lại bằng
  `ticket.assigned` (job cũ đã thất bại, không còn hoạt động), một ticket `todo` đã có đánh giá thì không bị
  đánh thức lại kiểu này; đánh giá được cả ticket `bug` do QC báo lỗi.
- `apps/api/test/budget.test.ts`: trần con và ngân sách cây/ngày, mỗi loại đẩy pm_task sang `needs_input`,
  cộng owner duyệt.
- `apps/api/test/owner-web-support.test.ts`: `PATCH /v1/tickets/:id`, sự kiện `ticket.updated`.
- `apps/api/test/cross-project-tickets.test.ts`: liệt kê mọi ticket khi không lọc dự án; `projectIds` gồm
  request được route tới lẫn chỉ được gợi ý, kết hợp với bộ lọc loại và phân trang, uuid sai → 400; endpoint
  cây đúng thứ tự, gồm cả ticket đã đóng, có agent activity, đúng cây con của một pm_task, một ticket lá trả
  cây rỗng, 404, 401, cắt đúng ở `TREE_LIMIT`.
- `apps/api/test/stuck-ticket-alarm.test.ts`: báo đúng một lần mỗi lần im lặng, bỏ qua ticket chờ owner/còn
  con/còn dependency mở, bỏ qua ticket máy online đang chạy hoặc giữ trong hàng đợi/backoff, hết hạn
  `waitingJobs` sau `WAITING_JOBS_TTL_MS`, `POST /v1/daemon/heartbeat` nhận và validate `waitingJobs`.
- `apps/api/test/agent-activity.test.ts`: ticket detail và danh sách hiện đúng job đang chạy (stage, model,
  effort), lý do chờ và lỗi; chỉ ticket đổi báo cáo mới được nêu trong `agent.activity_changed` (số tải đổi
  thì không); hai heartbeat cùng lúc của một máy đều xong; đọc máy im lặng/offline thành `unknown` rồi báo lại đủ ticket khi máy báo cáo tươi lần nữa; gán
  ticket `todo` chưa ai nhận cho máy được giao; giữ báo cáo còn hoạt động dù lý do chờ lạ từ một daemon mới
  hơn, và liệt kê job chờ theo từng máy.
- `packages/shared/src/status-workflow.test.ts`: `canTransition`/`allowedTransitions` cho từng actor.
- `packages/shared/src/comment-mentions.test.ts`: `@pm` nhận diện không phân biệt hoa thường, bỏ qua trong code
  block/inline code và trong email/URL (`team@pm.example.com`), không nhận `@pm-x`/`@pm.x`.
- `apps/api/test/attachment.test.ts`: upload từng mime hỗ trợ (png/jpeg/gif/webp) lưu đúng bytes, nhận cả ticket
  key lẫn uuid ở `:id`; từ chối mime lạ (`application/pdf`), không lưu gì; ảnh vừa vượt 10MB (còn lọt qua
  `bodyLimit` của route) trả 413/`ATTACHMENT_TOO_LARGE` kèm message "ảnh vượt quá 10MB", ảnh vượt hẳn cả
  `bodyLimit` (20MB, bị Fastify chặn ở tầng body-parser trước khi vào `decodeImage()`) trả cùng
  413/`ATTACHMENT_TOO_LARGE`/message thay vì rơi vào `VALIDATION_FAILED` chung — không lưu gì cả hai trường hợp;
  ticket không tồn tại → 404, không tạo bản ghi; thiếu session owner hoặc CSRF → 401/403; `GET` trả đúng
  `Content-Type` và byte-for-byte với ảnh đã upload, 404 khi không tồn tại, cần session owner; route owner từ
  chối token máy (`Authorization: Bearer` không dùng được trên `GET /v1/attachments/:id`). `GET
  /v1/daemon/attachments/:id`: máy sở hữu dự án tải được ảnh trên ticket `pm_task`/`dev`/`qc`/`bug` của dự án
  đó, byte-for-byte kèm đúng `Content-Type` và `cache-control: private, no-store`; ảnh trên ticket `request`:
  máy host trợ lý tải được, máy có `pm_task` con của request đó tải được, máy không liên quan nhận 403 không lộ
  bytes hay mime; máy B gọi ảnh thuộc ticket dự án máy A → 403; thiếu header `Authorization`, token sai/hết
  hạn/đã thu hồi, hoặc session owner hợp lệ mà không có token máy → 401; id không tồn tại → 404, id không phải
  uuid → 400 `VALIDATION_FAILED`; chuyển quyền sở hữu dự án sang máy khác có hiệu lực ngay lần gọi kế tiếp (máy
  cũ 403, máy mới 200).
  `POST /v1/attachments` (ảnh nháp): mọi mime hỗ trợ trả 201 với `ticket_id` null, `GET` đọc lại đúng bytes;
  mime lạ, vượt 10MB, vượt cả `bodyLimit`, thiếu session hoặc CSRF cho cùng kết quả như route ticket-scoped,
  không lưu gì. Gắn ảnh khi tạo ticket: mô tả tham chiếu 2 ảnh nháp của owner → cả hai có `ticket_id` = ticket
  mới; ảnh không được tham chiếu giữ `ticket_id` null; id lạ trong mô tả không làm lỗi việc tạo ticket; ảnh đã
  gắn ticket khác không bị cướp; ảnh nháp của owner khác không bị gắn dù đúng id; tạo ticket lỗi
  (`projectHintId` không tồn tại) rollback nguyên transaction nên không ảnh nào bị gắn.
  `deleteOrphanedDraftAttachments()`: xoá ảnh nháp cũ hơn `DRAFT_ATTACHMENT_TTL_MS`; giữ nguyên ảnh nháp còn
  mới; không bao giờ xoá ảnh đã gắn ticket dù cũ tới đâu.
- `apps/api/test/pm-mention.test.ts`: tag `@pm` từ mọi loại ticket của cây (pm_task, dev, qc, bug, docs_init, kể
  cả con đã đóng của cây còn mở) đều đánh thức đúng PM của cây, nhắm đúng máy chủ dự án; chỉ PM được đánh thức —
  ticket được tag không đổi trạng thái `needs_input`; tag ngay trên pm_task còn trả nó về `in_progress`; tag
  trong code/email không tính, vẫn đánh thức agent của ticket như cũ; bình luận agent chứa `@pm` không bao giờ
  tính; response và chi tiết ticket trả đúng `mentions`; tag trên ticket ngoài cây pm_task (`request`) hay cây
  đã đóng bị từ chối `400 PM_NOT_AVAILABLE`, không lưu gì; `retrySubtask()` chuyển đúng subtask `blocked` về
  `in_progress` và đánh thức agent của nó, từ chối ticket không `blocked`/không phải con của đúng pm_task/caller
  không phải pm_task; route daemon idempotent; bình luận owner tag `@pm` trên ticket `blocked` không mở chặn
  nó, chỉ đánh thức PM.
