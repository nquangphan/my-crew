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
  `POST /v1/tickets/:id/transition`, `GET /v1/search`.
- `apps/api/src/routes/comment-routes.ts` — owner: `POST /v1/tickets/:id/comments`.
- `apps/api/src/routes/report-routes.ts` — owner: `GET /v1/tickets/:id/report`.

Ghi của agent (tạo subtask, file bug, nộp report, bình luận/transition với `actor='agent'`) đi qua route
daemon ở flow `daemon-api`, nhưng dùng cùng các hàm service mô tả dưới đây.

## Các bước

1. `apps/api/src/services/ticket-service.ts` → `createRequestTicket()`: owner tạo ticket `request`, gán cho
   máy đang host assistant (nếu có), cấp key bằng `allocateKey()` (khoá theo scope `AST`).
2. `apps/api/src/services/ticket-service.ts` → `createSubtask()`: PM/dev/QC tạo con — kiểm tra đúng cấp cha
   (`pm_task` dưới `request`, `dev/qc/docs_init` dưới `pm_task`), cha chưa đóng, `enforceChildCap()` (flow này
   gọi sang `budget-service.ts`), QC bắt buộc `pairsWith` một dev/bug còn sống và chưa có QC khác
   (`assertPairable`), `dependsOn` chỉ được là ticket anh em (`assertSiblings`), QC luôn được cộng thêm MCP
   test UI mặc định theo platform (`qcDefaultMcps`, từ flow `project-claims`).
3. `apps/api/src/services/ticket-service.ts` → `fileBug()`: hai nguồn tạo `bug` — QC báo lỗi trên ticket dev/bug
   nó verify (`pairsWith`), hoặc PM từ chối một ticket dev/bug đã `done` khi nghiệm thu (`reject_work`, flow
   `agent-roles`; ticket nguồn khi đó chính là ticket bị từ chối, không phải QC). Tính `cycle = bugCycle + 1`
   của dev gốc (`originDevId`); vượt `MAX_BUG_CYCLES` (3) thì không tạo ticket, gọi `applyHold()` park pm_task
   và trả lỗi `BUG_CYCLE_CAP` (side effect đã commit); còn lại tạo một `bug` ticket cộng một `qc` retest phụ
   thuộc nó, cùng `pairsWith` bug đó, `bugCycle` tăng dần — retest kế thừa `complexity`/`model`/`effort`/
   `requiredSkills`/`requiredMcps` của **QC ticket đang kiểm ticket bị từ chối** (tìm qua `pairsWith`), không
   phải của ticket nguồn, kể cả khi nguồn là PM từ chối chứ không phải chính QC đó báo lỗi.
4. `apps/api/src/services/ticket-service.ts` → `transitionTicket()`: `canTransition(actor, from, to)` (từ
   `packages/shared/src/status-workflow.ts`) gác cổng; `to='done'` bắt buộc đã có report hiện hành
   (`REPORT_REQUIRED`); sau khi cập nhật trạng thái trong cùng transaction: `cascadeCancel()` khi huỷ,
   `resolveDependents()` phát `dependency.resolved` cho ticket đang chờ khi `done`, `ownerWakeUp()` phát
   `ticket.reopened`/`ticket.unblocked` khi owner mở lại/bỏ chặn, `childrenAllDone()` phát
   `children.all_done` khi con cuối cùng đóng (dù `done` hay `cancelled`).
5. `packages/shared/src/status-workflow.ts` → `canTransition()`/`allowedTransitions()`: bảng cạnh hợp lệ theo
   actor (`AGENT_EDGES`, `OWNER_EDGES`); `system` (dùng cho cascade cancel) được thêm cạnh `* → cancelled`.
   `packages/shared/src/agent-schemas.ts` → `RoleStage`: bước của một agent run (`assistant_triage`,
   `pm_analyze`, `dev`, `docs_update`, `qc`, `docs_init`, …); mỗi bước có đường trạng thái riêng phải hợp lệ
   với `canTransition('agent', …)` (định nghĩa và kiểm ở flow `agent-roles`, không lặp lại ở đây). `DOCS_MODEL`
   (`= 'sonnet'`) là model cố định của `docs_init`/`docs_update`.
6. `apps/api/src/services/ticket-service.ts` → `addComment()`: bình luận owner trên ticket đang
   `needs_input` tự chuyển nó về `in_progress` và gọi `liftHold()`; bình luận agent/system chỉ phát
   `ticket.updated{change:'comment'}`, không đánh thức ai.
7. `apps/api/src/services/ticket-service.ts` → `updateTicket()`: owner sửa tiêu đề/mô tả/ưu tiên tại chỗ,
   không bao giờ đánh thức agent, chỉ phát `ticket.updated{change:'fields'}`.
8. `apps/api/src/services/report-service.ts` → `submitReport()`: lưu report mới là bản hiện hành (bản cũ mất
   `is_current`), cộng `costUsd` của report vào ticket/ngân sách qua `addCost()` (flow này gọi sang
   `budget-service.ts`), phát `ticket.updated{change:'report'}`. `SubmitReportRequest`/subtask (`requiredMcps`)
   ở `packages/shared/src/api-schemas.ts` validate tên MCP server (`mcpsUsed`, `mcpsSelected`) bằng
   `McpServerName` của `packages/shared/src/project-schemas.ts` (flow `project-claims`), nên một report ghi
   đúng tên plugin/connector Claude Code báo cáo không bị từ chối.
9. `apps/api/src/services/report-service.ts` → `recordAgentMeta()`: daemon ghi `agentSessionId`/`agentModel`/
   `agentEffort` và cộng `costDeltaUsd` cho lượt chạy không kết thúc bằng report (hợp đồng: chi phí một lượt
   chạy chỉ được cộng đúng một lần, hoặc qua report hoặc qua delta này, không bao giờ cả hai).
10. `apps/api/src/services/budget-service.ts` → `enforceChildCap()`, `addCost()`, `applyHold()`, `liftHold()`:
    kiểm tra trần con mỗi ticket (`maxChildrenPerTicket`), ngân sách cây pm_task
    (`ticketTreeBudgetUsd`) và ngân sách ngày dự án (`dailyBudgetUsd`, theo múi giờ project); vượt trần thì
    park pm_task (`budgetHold`), bình luận hệ thống giải thích, phát `budget.exceeded`; owner bình luận hoặc
    chuyển `needs_input → in_progress` sẽ gỡ hold cho toàn bộ cây pm_task đó (`childCapLifted`/
    `costBudgetLifted`), không chỉ một batch.
11. `apps/api/src/services/ticket-query-service.ts` → `listTickets()`, `getTicketDetail()`, `search()`: danh
    sách có lọc/sắp xếp/keyset-pagination (cursor mã hoá base64url), chi tiết ticket kèm con/bình luận/report
    hiện hành/dòng sự kiện, tìm kiếm nhanh (ticket theo key/tiêu đề, cộng docs qua `searchAllDocs()` của flow
    `docs-sync-viewer`).
12. `apps/api/src/jobs/stuck-ticket-alarm.ts` → `findStuckTickets()`/`raiseStuckTicketAlarms()`: mỗi
    `STUCK_CHECK_INTERVAL_MS` (5 phút) tìm ticket không kết thúc, im lặng quá `STUCK_AFTER_MS` (30 phút, tính
    theo lần đổi trường ticket gần nhất hoặc bất kỳ sự kiện nào khác ngoài cảnh báo trước đó), không đang chờ
    owner (`needs_input`/`blocked`/`request` ở `in_review`), không còn con hay `dependsOn` mở, và không máy nào
    đang chạy (heartbeat `runningJobs`) hay giữ trong hàng đợi/backoff (heartbeat `waitingJobs`, nhớ tối đa 2
    phút mỗi máy qua `WaitingJobsRegistry`) — mỗi lần im lặng như vậy chỉ phát đúng một sự kiện `ticket.stuck`
    (flow `event-delivery`, chỉ owner stream) cho tới khi có hoạt động mới.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/ticket-routes.ts` | Route ticket owner + search | `ticketRoutes` |
| `apps/api/src/routes/comment-routes.ts` | Route bình luận owner | `commentRoutes` |
| `apps/api/src/routes/report-routes.ts` | Route đọc report owner | `reportRoutes` |
| `apps/api/src/services/ticket-service.ts` | Tạo, transition, bug loop, bình luận, sửa ticket | `createRequestTicket`, `createSubtask`, `fileBug`, `transitionTicket`, `addComment`, `updateTicket`, `lockWithParent`, `governingPmTask` |
| `apps/api/src/services/ticket-query-service.ts` | Danh sách, chi tiết, tìm kiếm | `listTickets`, `getTicketDetail`, `search` |
| `apps/api/src/services/report-service.ts` | Report và agent-meta | `submitReport`, `recordAgentMeta`, `getReports`, `getCurrentReport` |
| `apps/api/src/services/budget-service.ts` | Trần con, ngân sách, hold | `enforceChildCap`, `addCost`, `applyHold`, `liftHold`, `getBudgetStatus` |
| `apps/api/src/jobs/stuck-ticket-alarm.ts` | Báo ticket đứng yên không ai xử lý | `findStuckTickets`, `raiseStuckTicketAlarms`, `startStuckTicketAlarm`, `WaitingJobsRegistry` |
| `packages/shared/src/ticket-schemas.ts` | Enum trạng thái/loại/ưu tiên/actor ticket | `TicketStatus`, `TicketType`, `Actor` |
| `packages/shared/src/agent-schemas.ts` | Enum role/complexity/model/effort/bước agent | `AgentRole`, `Complexity`, `ModelAlias`, `Effort`, `RoleStage`, `DOCS_MODEL` |
| `packages/shared/src/status-workflow.ts` | Bảng cạnh workflow, kiểm tra transition | `canTransition`, `allowedTransitions`, `AGENT_EDGES`, `OWNER_EDGES`, `TERMINAL_STATUSES` |

## Dữ liệu

- Bảng: `tickets`, `ticket_counters`, `comments`, `ticket_reports`, `budgets_usage`.
- Sự kiện: `ticket.assigned`, `ticket.status_changed`, `ticket.cancelled`, `ticket.comment_added`,
  `ticket.updated`, `ticket.reopened`, `ticket.unblocked`, `dependency.resolved`, `children.all_done`,
  `budget.exceeded`, `ticket.stuck`.
- Gọi ngoài: không.

## Flow liên quan

- daemon-api: mọi ghi của agent (tạo subtask, file bug, report, transition, bình luận) gọi thẳng các hàm ở
  đây với `actor='agent'`, qua route `/v1/daemon/*`.
- project-claims: `qcDefaultMcps()` (project-schemas) quyết định MCP bắt buộc của QC; `retargetOpenTickets()`
  ở đó cập nhật `assignee_machine_id` khi project đổi chủ.
- event-delivery: mọi `NewEvent` sinh ra ở đây được `appendEvents()` ghi vào outbox `events` rồi phát qua SSE.
- docs-sync-viewer: `search()` gộp kết quả `searchAllDocs()`; `flows[]` của ticket liên kết tới trang
  `docs/flows/<id>.md` tương ứng trên web.
- agent-roles: `RoleStage` và `STAGES` (flow đó) gán mỗi bước agent vào một ticket loại nào chạy khi nào; tool
  `reject_work` của PM gọi `fileBug()` với ticket dev/bug đã `done` làm nguồn; `create_subtask` thêm phụ thuộc
  `docs_init`.
- local-merge: `head_sha` mà `mergeAndPush()` merge đến từ `report.headSha` (`submitReport()`).
- daemon-runtime: `waitingJobs` mà heartbeat của daemon gửi lên (`apps/daemon/src/daemon.ts`) là điều
  `findStuckTickets()` dùng để không báo nhầm ticket đang chờ thử lại.

## Tests

- `apps/api/test/ticket-service.test.ts`: key đầu tiên là `AST-1`, key không trùng khi tạo đồng thời.
- `apps/api/test/transition.test.ts`: đủ ma trận cạnh hợp lệ theo actor, `REPORT_REQUIRED`, mã lỗi HTTP.
- `apps/api/test/lifecycle-effects.test.ts`: `dependency.resolved`, đúng một `children.all_done` khi tuần tự
  lẫn đồng thời, cascade cancel phát đúng một `ticket.cancelled` mỗi máy, đánh thức owner, rollback nguyên tử.
- `apps/api/test/bug-loop.test.ts`: vòng lặp bug từ QC lẫn từ PM từ chối, chặn ở chu kỳ 4, retest kế thừa
  cấu hình của QC ticket đang kiểm ticket bị từ chối.
- `apps/api/test/budget.test.ts`: trần con và ngân sách cây/ngày, mỗi loại đẩy pm_task sang `needs_input`,
  cộng owner duyệt.
- `apps/api/test/owner-web-support.test.ts`: `PATCH /v1/tickets/:id`, sự kiện `ticket.updated`.
- `apps/api/test/stuck-ticket-alarm.test.ts`: báo đúng một lần mỗi lần im lặng, bỏ qua ticket chờ owner/còn
  con/còn dependency mở, bỏ qua ticket máy online đang chạy hoặc giữ trong hàng đợi/backoff, hết hạn
  `waitingJobs` sau `WAITING_JOBS_TTL_MS`, `POST /v1/daemon/heartbeat` nhận và validate `waitingJobs`.
- `packages/shared/src/status-workflow.test.ts`: `canTransition`/`allowedTransitions` cho từng actor.
