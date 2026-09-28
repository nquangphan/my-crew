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
3. `apps/api/src/services/ticket-service.ts` → `fileBug()`: QC báo lỗi — tính `cycle = bugCycle + 1` của dev
   gốc (`originDevId`); vượt `MAX_BUG_CYCLES` (3) thì không tạo ticket, gọi `applyHold()` park pm_task và trả
   lỗi `BUG_CYCLE_CAP` (side effect đã commit); còn lại tạo một `bug` ticket cộng một `qc` retest phụ thuộc nó,
   cùng `pairsWith` bug đó, `bugCycle` tăng dần.
4. `apps/api/src/services/ticket-service.ts` → `transitionTicket()`: `canTransition(actor, from, to)` (từ
   `packages/shared/src/status-workflow.ts`) gác cổng; `to='done'` bắt buộc đã có report hiện hành
   (`REPORT_REQUIRED`); sau khi cập nhật trạng thái trong cùng transaction: `cascadeCancel()` khi huỷ,
   `resolveDependents()` phát `dependency.resolved` cho ticket đang chờ khi `done`, `ownerWakeUp()` phát
   `ticket.reopened`/`ticket.unblocked` khi owner mở lại/bỏ chặn, `childrenAllDone()` phát
   `children.all_done` khi con cuối cùng đóng (dù `done` hay `cancelled`).
5. `packages/shared/src/status-workflow.ts` → `canTransition()`/`allowedTransitions()`: bảng cạnh hợp lệ theo
   actor (`AGENT_EDGES`, `OWNER_EDGES`); `system` (dùng cho cascade cancel) được thêm cạnh `* → cancelled`.
6. `apps/api/src/services/ticket-service.ts` → `addComment()`: bình luận owner trên ticket đang
   `needs_input` tự chuyển nó về `in_progress` và gọi `liftHold()`; bình luận agent/system chỉ phát
   `ticket.updated{change:'comment'}`, không đánh thức ai.
7. `apps/api/src/services/ticket-service.ts` → `updateTicket()`: owner sửa tiêu đề/mô tả/ưu tiên tại chỗ,
   không bao giờ đánh thức agent, chỉ phát `ticket.updated{change:'fields'}`.
8. `apps/api/src/services/report-service.ts` → `submitReport()`: lưu report mới là bản hiện hành (bản cũ mất
   `is_current`), cộng `costUsd` của report vào ticket/ngân sách qua `addCost()` (flow này gọi sang
   `budget-service.ts`), phát `ticket.updated{change:'report'}`.
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
| `packages/shared/src/ticket-schemas.ts` | Enum trạng thái/loại/ưu tiên/actor ticket | `TicketStatus`, `TicketType`, `Actor` |
| `packages/shared/src/agent-schemas.ts` | Enum role/complexity/model/effort agent | `AgentRole`, `Complexity`, `ModelAlias`, `Effort` |
| `packages/shared/src/status-workflow.ts` | Bảng cạnh workflow, kiểm tra transition | `canTransition`, `allowedTransitions`, `AGENT_EDGES`, `OWNER_EDGES`, `TERMINAL_STATUSES` |

## Dữ liệu

- Bảng: `tickets`, `ticket_counters`, `comments`, `ticket_reports`, `budgets_usage`.
- Sự kiện: `ticket.assigned`, `ticket.status_changed`, `ticket.cancelled`, `ticket.comment_added`,
  `ticket.updated`, `ticket.reopened`, `ticket.unblocked`, `dependency.resolved`, `children.all_done`,
  `budget.exceeded`.
- Gọi ngoài: không.

## Flow liên quan

- daemon-api: mọi ghi của agent (tạo subtask, file bug, report, transition, bình luận) gọi thẳng các hàm ở
  đây với `actor='agent'`, qua route `/v1/daemon/*`.
- project-claims: `qcDefaultMcps()` (project-schemas) quyết định MCP bắt buộc của QC; `retargetOpenTickets()`
  ở đó cập nhật `assignee_machine_id` khi project đổi chủ.
- event-delivery: mọi `NewEvent` sinh ra ở đây được `appendEvents()` ghi vào outbox `events` rồi phát qua SSE.
- docs-sync-viewer: `search()` gộp kết quả `searchAllDocs()`; `flows[]` của ticket liên kết tới trang
  `docs/flows/<id>.md` tương ứng trên web.

## Tests

- `apps/api/test/ticket-service.test.ts`: key đầu tiên là `AST-1`, key không trùng khi tạo đồng thời.
- `apps/api/test/transition.test.ts`: đủ ma trận cạnh hợp lệ theo actor, `REPORT_REQUIRED`, mã lỗi HTTP.
- `apps/api/test/lifecycle-effects.test.ts`: `dependency.resolved`, đúng một `children.all_done` khi tuần tự
  lẫn đồng thời, cascade cancel phát đúng một `ticket.cancelled` mỗi máy, đánh thức owner, rollback nguyên tử.
- `apps/api/test/bug-loop.test.ts`: vòng lặp bug, chặn ở chu kỳ 4.
- `apps/api/test/budget.test.ts`: trần con và ngân sách cây/ngày, mỗi loại đẩy pm_task sang `needs_input`,
  cộng owner duyệt.
- `apps/api/test/owner-web-support.test.ts`: `PATCH /v1/tickets/:id`, sự kiện `ticket.updated`.
- `packages/shared/src/status-workflow.test.ts`: `canTransition`/`allowedTransitions` cho từng actor.
