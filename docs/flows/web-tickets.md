# Board, danh sách và ticket trên web

> Flow `web-tickets`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow web-tickets` in ra
> đúng danh sách đó.

## Mục đích

Xem và thao tác ticket trên web: board kéo-thả theo trạng thái, danh sách có lọc/sắp xếp/thao tác hàng loạt,
và trang chi tiết ticket (tiêu đề, mô tả markdown, cây subtask dev↔QC, bình luận, dòng sự kiện, report, hành
động chuyển trạng thái) dùng chung giữa panel bên cạnh và trang toàn màn hình.

## Điểm vào

- `apps/web/src/routes/board.tsx` → `BoardPage` — `/projects/$projectKey/board`.
- `apps/web/src/routes/list.tsx` → `ListPage` — `/projects/$projectKey/list`.
- `apps/web/src/routes/ticket-detail.tsx` → `TicketDetailPage` — `/tickets/$ticketKey`.
- `apps/web/src/routes/my-requests.tsx` → `MyRequestsPage` — `/requests` ("Tất cả request của tôi").

## Các bước

1. `apps/web/src/routes/board.tsx`/`my-requests.tsx` → `BoardPage`/`MyRequestsPage`: nạp ticket qua
   `useTickets()` (flow `web-shell`), render `BoardView`; bộ lọc và ticket đang mở (`?selected=KEY`) sống
   trong URL.
2. `apps/web/src/components/board-view.tsx` → `BoardView()`, `filterBoardTickets()`, `columnOf()`: nhóm ticket
   vào `BOARD_COLUMNS` theo trạng thái (`blocked` hiện trong cột "Đang làm" kèm badge đỏ), lane theo
   pm_task/loại, kéo-thả gọi API chuyển trạng thái lạc quan — bị từ chối (`REPORT_REQUIRED`, chuyển không hợp
   lệ) thì hiện toast và thẻ bật lại vị trí cũ; click thẻ mở `TicketSidePanel`.
3. `apps/web/src/components/ticket-card.tsx` → `TicketCard`, `TicketCardFace`: hiển thị icon loại, key, mũi
   tên ưu tiên, avatar vai trò (spinner khi đang chạy job cục bộ hoặc khi `agentActivity.status==='running'`),
   `AgentActivityMark`, badge trạng thái.
4. `apps/web/src/routes/list.tsx` → `ListPage`: lọc/sắp xếp qua `parseStatuses`/`parseTypes`/… (`search-params.ts`,
   flow `web-shell`), sắp xếp phía client trên toàn bộ dữ liệu đã tải (`sortTickets()`), sửa trạng thái/ưu
   tiên tại chỗ (`useTransition`/`useUpdateTicket`), thao tác hàng loạt (`runBulk()`, `Promise.allSettled`,
   báo lỗi theo key).
5. `apps/web/src/components/issue-table.tsx` → `IssueTable`, `sortTickets()`: bảng cột co giãn (độ rộng lưu
   trình duyệt), điều hướng bàn phím `j`/`k`/`Enter` (từ `useShortcuts`, flow `web-shell`).
6. `apps/web/src/routes/ticket-detail.tsx` → `TicketDetailPage`: dựng breadcrumb (dự án hoặc "Request", cha
   nếu có), render `TicketView` chế độ `mode="page"`.
7. `apps/web/src/components/ticket-view.tsx` → `TicketView()`: một component dùng chung cho panel
   (`ticket-side-panel.tsx`) và trang toàn màn hình — tiêu đề/mô tả sửa tại chỗ, banner vàng khi
   `needs_input` (nút "Trả lời" focus ô soạn), tabs Hoạt động (Bình luận/Lịch sử/Report), `DetailsBox` (dropdown
   trạng thái chỉ hiện `allowedTransitions('owner', …)`; mục "Độ phức tạp" hiện thêm dòng "Lý do: …" từ
   `ticket.complexityReason` khi PM đã ghi lý do đánh giá), nút Hủy/Mở lại/Bỏ chặn, và `AgentActivityLine` (thay
   ô "Agent đang chạy" cũ) ngay dưới tiêu đề.
8. `apps/web/src/components/subtask-tree.tsx` → `buildSubtaskTree()`, `SubtaskTree`: nhóm dev↔QC theo cặp
   `pairsWith`, hiện chuỗi bug "vòng n/`BUG_CYCLE_CAP`" và phụ thuộc "Chờ KEY" chưa xong.
9. `apps/web/src/components/comment-thread.tsx`, `event-timeline.tsx`, `report-panel.tsx`: danh sách bình
   luận + ô soạn (gắn CSRF qua `api-client`), dòng sự kiện từ `EventEnvelope`, report hiện hành kèm bộ chọn
   phiên bản.
10. `apps/web/src/components/cancel-dialog.tsx`, `new-ticket-dialog.tsx`: hộp thoại Hủy (liệt kê mọi hậu duệ
    đang mở), hộp thoại Tạo ticket (gợi ý dự án, ưu tiên, markdown, "Cho phép sửa config", "Tạo thêm" — người
    nhận luôn là assistant).
11. `apps/web/src/components/agent-activity.tsx` → `describeActivity()`, `AgentActivityLine`,
    `AgentActivityMark`: một dòng tiếng Việt kể máy nào đang chạy ticket (kèm model/effort/giờ bắt đầu), đang
    chờ vì sao (`describeWait()`, không nêu tên máy), lỗi gần nhất, hay "chưa máy nào nhận"; báo cáo cũ hơn
    `AGENT_ACTIVITY_STALE_MS` (2 phút, từ `@crew/shared`) tự đọc thành "không rõ" phía client trước khi kịp
    refetch. `AgentActivityLine` tự làm mới mỗi 30s để giờ tương đối và trạng thái cũ luôn đúng.
    `AgentActivityMark` là icon nhỏ trên `TicketCardFace` cho trạng thái chờ/lỗi/không rõ (đang chạy vẫn chỉ
    dùng spinner avatar có sẵn) — cả hai đọc `ticket.agentActivity` (flow `ticket-lifecycle`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/web/src/routes/board.tsx` | Trang board dự án | `BoardPage` |
| `apps/web/src/routes/list.tsx` | Trang danh sách | `ListPage` |
| `apps/web/src/routes/ticket-detail.tsx` | Trang ticket toàn màn hình | `TicketDetailPage` |
| `apps/web/src/routes/my-requests.tsx` | Board request của owner | `MyRequestsPage` |
| `apps/web/src/components/board-view.tsx` | Board: cột, lane, kéo-thả | `BoardView`, `filterBoardTickets`, `columnOf`, `BOARD_COLUMNS` |
| `apps/web/src/components/ticket-card.tsx` | Thẻ ticket trên board | `TicketCard`, `TicketCardFace` |
| `apps/web/src/components/filter-menu.tsx` | Menu lọc nhiều lựa chọn | `FilterMenu` |
| `apps/web/src/components/issue-table.tsx` | Bảng danh sách | `IssueTable`, `sortTickets` |
| `apps/web/src/components/ticket-side-panel.tsx` | Panel bên cạnh | `TicketSidePanel` |
| `apps/web/src/components/ticket-view.tsx` | Nội dung ticket dùng chung panel/trang | `TicketView` |
| `apps/web/src/components/details-box.tsx` | Hộp chi tiết + hành động | `DetailsBox` |
| `apps/web/src/components/status-dropdown.tsx` | Dropdown đổi trạng thái | `StatusDropdown`, `ownerTargets` |
| `apps/web/src/components/subtask-tree.tsx` | Cây subtask dev↔QC + bug loop | `SubtaskTree`, `buildSubtaskTree`, `BUG_CYCLE_CAP` |
| `apps/web/src/components/comment-thread.tsx` | Danh sách + ô soạn bình luận | `CommentList`, `CommentComposer` |
| `apps/web/src/components/event-timeline.tsx` | Dòng sự kiện ticket | `EventTimeline` |
| `apps/web/src/components/report-panel.tsx` | Xem report + lịch sử phiên bản | `ReportPanel` |
| `apps/web/src/components/cancel-dialog.tsx` | Hộp thoại hủy ticket | `CancelDialog` |
| `apps/web/src/components/new-ticket-dialog.tsx` | Hộp thoại tạo ticket | `NewTicketDialog` |
| `apps/web/src/components/markdown-editor.tsx` | Ô soạn markdown | `MarkdownEditor` |
| `apps/web/src/components/role-avatar.tsx` | Avatar vai trò agent + spinner | `RoleAvatar`, `Spinner` |
| `apps/web/src/components/type-icon.tsx` | Icon loại ticket | `TypeIcon` |
| `apps/web/src/components/markdown-view.tsx` | Hiển thị markdown đã khử trùng (dùng chung) | `MarkdownView` |
| `apps/web/src/components/status-lozenge.tsx` | Badge trạng thái/ưu tiên (dùng chung) | `StatusLozenge`, `PriorityArrow` |
| `apps/web/src/components/agent-activity.tsx` | Dòng/mark hoạt động agent trên ticket và board | `describeActivity`, `describeWait`, `AgentActivityLine`, `AgentActivityMark`, `formatClock` |

## Dữ liệu

- Bảng: không trực tiếp (đọc/ghi qua API `apps/api`, xem flow `ticket-lifecycle`).
- Sự kiện: tiêu thụ sự kiện ticket (`ticket.*`, `dependency.resolved`, `children.all_done`) qua
  `invalidationsFor()` của flow `event-delivery`.
- Gọi ngoài: gọi API qua `lib/api-client.ts` (flow `web-shell`).

## Flow liên quan

- ticket-lifecycle: mọi hành động (tạo, transition, bình luận, report) gọi route owner của flow này;
  `Ticket.agentActivity` (đọc bởi `describeActivity()`) xuất phát từ flow đó.
- web-shell: dùng chung `queries.ts`, `format.ts`, `shortcuts.ts`, `ShellContext`, component `ui/*`.
- event-delivery: sự kiện `agent.activity_changed` làm mới ticket và máy qua `invalidationsFor()`.
- docs-sync-viewer: `TicketView` hiển thị "Docs liên quan" từ `flows[]`, dùng `docsFlow()`.
- web-admin: `RoleAvatar`/`role_avatar` và badge trạng thái dùng lại ở Inbox và trang Máy; trang Máy dùng lại
  `describeWait()`/`formatClock()` của `agent-activity.tsx` cho job đang chờ của từng máy.

## Tests

- `apps/web/src/components/board-view.test.ts`: lọc, nhóm cột/lane.
- `apps/web/src/components/ticket-view.test.tsx`: từ chối `REPORT_REQUIRED`, bật lại thẻ khi kéo-thả bị từ
  chối.
- `apps/web/src/components/status-dropdown.test.tsx`: chỉ hiện đích hợp lệ theo `canTransition('owner', …)`.
- `apps/web/src/components/subtask-tree.test.tsx`: cặp dev↔QC, chuỗi bug, phụ thuộc.
- `apps/web/src/components/comment-thread.test.tsx`: đăng bình luận (header CSRF, nội dung, xoá ô soạn,
  đường lỗi).
- `apps/web/src/components/cancel-dialog.test.tsx`: liệt kê hậu duệ đang mở qua nhiều cấp.
- `apps/web/e2e/core-flows.spec.ts`: tạo ticket, mở panel, bình luận agent xuất hiện dưới 2s, đổi trạng thái bị
  từ chối rồi qua khi có report, mở docs từ chip flow, hủy pm_task kéo theo hủy QC con, "Lý do: …" của
  `complexityReason` hiện trong Details.
- `apps/web/src/components/agent-activity.test.tsx`: mô tả đúng từng trạng thái/lý do chờ và lỗi; báo "không
  rõ" (không phải "đang chạy") khi máy im lặng lâu hơn `AGENT_ACTIVITY_STALE_MS`; ticket `todo` chưa ai nhận
  hiện đúng máy được giao; dòng hoạt động hiện trên ticket, mark trên card chỉ hiện khi job không chạy;
  `agent.activity_changed` làm mới ticket và máy.
- `apps/web/e2e/agent-activity.spec.ts`: từ chờ slot tới đang chạy live trên card, panel và trang Máy, ở cả ba
  viewport, không tràn ngang.
