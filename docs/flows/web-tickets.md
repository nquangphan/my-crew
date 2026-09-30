# Board, danh sách và ticket trên web

> Flow `web-tickets`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow web-tickets` in ra
> đúng danh sách đó.

## Mục đích

Xem và thao tác ticket trên web: board kéo-thả theo trạng thái, danh sách có lọc/sắp xếp/thao tác hàng loạt,
và trang chi tiết ticket (tiêu đề, mô tả markdown, cây subtask dev↔QC, bình luận, dòng sự kiện, report, hành
động chuyển trạng thái) dùng chung giữa panel bên cạnh và trang toàn màn hình.

## Điểm vào

- `apps/web/src/routes/board.tsx` → `BoardPage` — `/projects/$projectKey/board`.
- `apps/web/src/routes/list.tsx` → `ListPage` — `/projects/$projectKey/list`, và (`projectKey=null`) `/list`
  ("Tất cả dự án").
- `apps/web/src/routes/all-board.tsx` → `AllProjectsBoardPage` — `/board` ("Tất cả dự án").
- `apps/web/src/routes/ticket-detail.tsx` → `TicketDetailPage` — `/tickets/$ticketKey`.
- `apps/web/src/routes/my-requests.tsx` → `MyRequestsPage` — `/requests` ("Tất cả request của tôi").

## Các bước

1. `apps/web/src/routes/board.tsx`/`my-requests.tsx`/`all-board.tsx` → `BoardPage`/`MyRequestsPage`/
   `AllProjectsBoardPage`: nạp ticket qua `useTickets()` (flow `web-shell`), render `BoardView`; bộ lọc và
   ticket đang mở (`?selected=KEY`) sống trong URL. `AllProjectsBoardPage` (`/board`, "Tất cả dự án") nạp mọi
   dự án (`useProjects`) cộng ticket của mọi dự án và request của owner (`useTickets({ projectIds?, status })`
   với `status` = cột board cộng `blocked`; ticket đã hủy không được nạp, chỉ hiện trong danh sách), truyền
   `projects` cho `BoardView` và có link "Xem danh sách" tới `/list` giữ nguyên bộ lọc dự án. `MyRequestsPage`
   (`/requests`, "Tất cả request của tôi") chỉ nạp ticket loại `request`; truyền `projectFilter={projects.data}`
   cho `BoardView` để có bộ lọc "Dự án" mà không có badge/lane dự án (request không thuộc project nào), gửi
   `projectIds` của các project đã chọn kèm `type=['request']` (server giữ request được route hoặc gợi ý tới
   project đó, qua `inProjectsFilter()` của flow `ticket-lifecycle`).
2. `apps/web/src/components/board-view.tsx` → `BoardView()`, `filterBoardTickets()`, `columnOf()`: nhóm ticket
   vào `BOARD_COLUMNS` theo trạng thái (`blocked` hiện trong cột "Đang làm" kèm badge đỏ), lane theo
   pm_task/loại, kéo-thả gọi API chuyển trạng thái lạc quan — bị từ chối (`REPORT_REQUIRED`, chuyển không hợp
   lệ) thì hiện toast và thẻ bật lại vị trí cũ; click thẻ mở `TicketSidePanel`. Prop `projects` (board "Tất cả
   dự án") thêm `ProjectFilterMenu` "Dự án" (khóa dự án trong URL `project`, gửi lên dạng `projectIds`), badge
   dự án trên mọi thẻ, và swimlane qua `lanesOf(tickets, all, mode, projects)` với `LaneMode = 'parent' |
   'request' | 'project' | 'none'` — board dự án giữ mặc định `parent` (theo pm_task), board "Tất cả dự án" mặc
   định `request` ("Request → PM task": lane của một request chứa request và mọi pm_task nó được route tới,
   con của mỗi pm_task nằm trong lane con lồng "› KEY · title"; ticket chưa nạp được request nằm ở "Không thuộc
   request"); `project` xếp một lane mỗi dự án ("KEY · tên"), request chưa có dự án vào lane "Request" trước.
   Prop `projectFilter` (board request) chỉ thêm `ProjectFilterMenu`, không badge/lane. Menu "Nhóm theo" chỉ
   liệt kê các mode của board hiện tại; mode mặc định không có trong URL.
3. `apps/web/src/components/ticket-card.tsx` → `TicketCard`, `TicketCardFace`: hiển thị icon loại, key, mũi
   tên ưu tiên, avatar vai trò (spinner khi đang chạy job cục bộ hoặc khi `agentActivity.status==='running'`),
   `AgentActivityMark`, badge trạng thái, và (prop `projectKey`, board "Tất cả dự án") badge dự án; hàng
   key/badge xuống dòng khi chật (`flex-wrap`, `min-w-0`) và nút thẻ có `min-w-0`, nên `ProjectBadge` không
   tràn sang cột kế bên với khóa dài.
4. `apps/web/src/routes/list.tsx` → `ListPage({ projectKey: string | null, search: AllListSearch })`: lọc/sắp
   xếp qua `parseStatuses`/`parseTypes`/… (`search-params.ts`, flow `web-shell`), sắp xếp phía client trên toàn
   bộ dữ liệu đã tải (`sortTickets()`), sửa trạng thái/ưu tiên tại chỗ (`useTransition`/`useUpdateTicket`), thao
   tác hàng loạt (`runBulk()`, `Promise.allSettled`, báo lỗi theo key). `projectKey=null` là danh sách "Tất cả
   dự án" tại `/list` (breadcrumb "Tất cả dự án / Danh sách", link "Xem board" tới `/board`): thêm
   `ProjectFilterMenu` "Dự án" (khóa dự án trong URL `project`, quy đổi ra id rồi gửi `projectIds`) và cột dự
   án trên `IssueTable` (`projectKeyOf`); với một `projectKey`, hành vi giữ nguyên như cũ
   (`/projects/$projectKey/list`, không cột/lọc dự án).
5. `apps/web/src/components/issue-table.tsx` → `IssueTable`, `sortTickets()`: bảng cột co giãn (độ rộng lưu
   trình duyệt), điều hướng bàn phím `j`/`k`/`Enter` (từ `useShortcuts`, flow `web-shell`). Prop `projectKeyOf`
   (danh sách "Tất cả dự án"): thêm cột "Dự án" trên desktop/tablet ("—" cho request), badge dự án trên card
   điện thoại, và `sortTickets()` nhận thêm giá trị sắp xếp `project` (`ListSort`).
6. `apps/web/src/components/project-badge.tsx` → `ProjectBadge`, `projectKeyResolver()`: badge khóa dự án
   (mono, `data-project`) và hàm quy ticket → khóa dự án (request không có), dùng lại trên card, dòng danh sách
   và cây ticket; co lại và kết thúc bằng dấu ba chấm khi khung chứa hẹp thay vì tràn ra ngoài, khóa đầy đủ vẫn
   nằm trong tooltip (`title`). `apps/web/src/components/project-filter.tsx` → `ProjectFilterMenu`,
   `selectedProjects()`: bộ lọc nhiều lựa chọn "Dự án" dùng chung, lưu trong URL `project=KEY,KEY` (khóa lạ bị
   bỏ qua); ngoài board/danh sách ở đây, cùng component này phục vụ Inbox và Máy (flow `web-admin`) và trang
   chủ docs (flow `docs-sync-viewer`).
7. `apps/web/src/routes/ticket-detail.tsx` → `TicketDetailPage`: dựng breadcrumb (dự án hoặc "Request", cha
   nếu có), render `TicketView` chế độ `mode="page"`.
8. `apps/web/src/components/ticket-view.tsx` → `TicketView()`: một component dùng chung cho panel
   (`ticket-side-panel.tsx`) và trang toàn màn hình — tiêu đề/mô tả sửa tại chỗ (`MarkdownEditor` của ô mô tả
   nhận `ticketId={ticket.id}` để bật paste-to-upload ảnh clipboard, xem bước 12), banner vàng khi
   `needs_input` (nút "Trả lời" focus ô soạn), tabs Hoạt động (Bình luận/Lịch sử/Report), `DetailsBox` (dropdown
   trạng thái chỉ hiện `allowedTransitions('owner', …)`; mục "Độ phức tạp" hiện thêm dòng "Lý do: …" từ
   `ticket.complexityReason` khi PM đã ghi lý do đánh giá), nút Hủy/Mở lại/Bỏ chặn, và `AgentActivityLine` (thay
   ô "Agent đang chạy" cũ) ngay dưới tiêu đề. Một `request`/`pm_task` còn con hiện `TicketTree` ("Cây ticket")
   thay cho danh sách "Ticket con" phẳng: nạp cả cây hậu duệ bằng một lần gọi (`useTicketTree()` →
   `GET /v1/tickets/:id/tree`, flow `ticket-lifecycle`), cả ticket mở và đã đóng; tiêu đề mục hiện số lượng
   "Cây ticket (n)", cây bị server cắt thì thêm dòng "Cây quá lớn: chỉ hiện n ticket đầu", gọi `/tree` lỗi thì
   hiện dòng lỗi và lùi về danh sách con trực tiếp của chi tiết ticket.
9. `apps/web/src/components/ticket-tree.tsx` → `TicketTree`: mỗi dòng gồm icon loại, key, `ProjectBadge`, tiêu
   đề, `StatusLozenge`, `AgentActivityMark` (chờ/lỗi/không rõ) và avatar vai trò kèm spinner khi đang chạy;
   pm_task theo từng dự án rồi con dev/qc/bug/docs_init của nó (cặp dev↔QC, chuỗi bug và "Chờ KEY" nhóm bằng
   `buildSubtaskTree()` của `subtask-tree.tsx`); click một dòng mở ticket đó. Cập nhật theo sự kiện: khoá
   `keys.tree(id)` = `['descendants', id, 'tree']` nằm dưới tiền tố `descendants` mà sự kiện ticket
   (`invalidationsFor()`, flow `event-delivery`) và `invalidateTicketData()` đã tự làm mới.
10. `apps/web/src/components/subtask-tree.tsx` → `buildSubtaskTree()`, `SubtaskTree`: nhóm dev↔QC theo cặp
    `pairsWith`, hiện chuỗi bug "vòng n/`BUG_CYCLE_CAP`" và phụ thuộc "Chờ KEY" chưa xong.
11. `apps/web/src/components/comment-thread.tsx`, `event-timeline.tsx`, `report-panel.tsx`: danh sách bình
    luận + ô soạn (gắn CSRF qua `api-client`), dòng sự kiện từ `EventEnvelope`, report hiện hành kèm bộ chọn
    phiên bản. `CommentComposer` truyền `ticketId: ticketKey` vào `usePasteImage()` (bước 12) để bật
    paste-to-upload ảnh clipboard, hiện dòng lỗi dán dưới ô soạn khi có. `CommentComposer` (`canCallPm`, mọi
    loại ticket trừ `request` — `TicketView` gán): gõ `@` (hoặc
    `@p`/`@pm`) sau khoảng trắng/`(`/đầu dòng hiện listbox gợi ý "@pm — gọi PM của cây ticket (thay cho agent
    của ticket này)"; Enter/Tab hoặc click chèn `@pm `, Escape ẩn gợi ý; Ctrl/Cmd+Enter vẫn gửi bình thường; một
    tag bị từ chối hiện lỗi `PM_NOT_AVAILABLE` (`format.ts`, flow `web-shell`) và giữ nguyên nội dung ô soạn.
    `unblocks` (`TicketView` gán `ticket.status === 'blocked'`) hiện gợi ý "Bình luận sẽ mở chặn ticket" dưới ô
    soạn (nối bằng `aria-describedby`), ẩn khi nội dung đang tag `@pm` (bình luận đó chỉ đánh thức PM, không mở
    chặn, flow `ticket-lifecycle`).
    `CommentList` hiện badge nhỏ "Đã gọi PM" trên bình luận owner có `mentions` chứa `pm`, cộng nút "Xem
    <pm_task key>" (khi bình luận nằm trên một subtask, `pmTaskKey` do `TicketView` truyền xuống cùng ticket cha)
    mở ticket đó — nơi hoạt động PM hiện trên `AgentActivityLine` như bước cuối.
12. `apps/web/src/lib/paste-image.ts` → `usePasteImage()`: hook paste-to-upload ảnh clipboard dùng chung cho ô
    mô tả ticket (`MarkdownEditor`, bước 8) và ô bình luận (`CommentComposer`, bước 11) — bắt `onPaste` trên
    textarea, tìm file ảnh đầu tiên trong `clipboardData.items`; không phải ảnh thì bỏ qua, giữ nguyên hành vi
    dán văn bản mặc định. Mime ngoài whitelist (`AttachmentMimeType`, flow `ticket-lifecycle`) báo lỗi tiếng
    Việt ngay phía client, không gọi API, không đổi nội dung. Ảnh hợp lệ: chèn placeholder
    `![Đang tải ảnh...](uploading:<n>)` tại đúng vị trí con trỏ (không đè nội dung đang có), đọc file thành
    base64 rồi gọi `useUploadAttachment()` (`queries.ts`, flow `web-shell`) → `POST /v1/tickets/:id/attachments`
    (flow `ticket-lifecycle`); xong thì thay placeholder bằng `![ảnh](url)` thật. Lỗi upload (mime bị server từ
    chối, quá 10MB, mất kết nối) gỡ placeholder (không chèn link hỏng, không mất nội dung khác), báo lỗi qua
    `errorMessage()` (`format.ts`, flow `web-shell`). `ticketId` rỗng (hộp thoại tạo ticket mới, chưa có ticket)
    tắt hẳn tính năng — dán ảnh không làm gì. `MarkdownView`/`rehype-sanitize` (schema GitHub mặc định) render
    đúng `<img src="/v1/attachments/:id">` (URL tương đối) nên không cần chỉnh schema sanitize.
13. `apps/web/src/components/cancel-dialog.tsx`, `new-ticket-dialog.tsx`: hộp thoại Hủy (liệt kê mọi hậu duệ
    đang mở), hộp thoại Tạo ticket (gợi ý dự án, ưu tiên, markdown, "Cho phép sửa config", "Tạo thêm" — người
    nhận luôn là assistant).
14. `apps/web/src/components/agent-activity.tsx` → `describeActivity()`, `AgentActivityLine`,
    `AgentActivityMark`: một dòng tiếng Việt kể máy nào đang chạy ticket (kèm model/effort/giờ bắt đầu, cộng
    "· cài đặt `<rev>`" từ `AgentActivity.settingsRevision` — bản cài đặt server lượt chạy đó bắt đầu với,
    flow `server-settings`), đang chờ vì sao (`describeWait()`, không nêu tên máy), lỗi gần nhất, hay "chưa
    máy nào nhận"; báo cáo cũ hơn
    `AGENT_ACTIVITY_STALE_MS` (2 phút, từ `@crew/shared`) tự đọc thành "không rõ" phía client trước khi kịp
    refetch. `AgentActivityLine` tự làm mới mỗi 30s để giờ tương đối và trạng thái cũ luôn đúng.
    `AgentActivityMark` là icon nhỏ trên `TicketCardFace` cho trạng thái chờ/lỗi/không rõ (đang chạy vẫn chỉ
    dùng spinner avatar có sẵn) — cả hai đọc `ticket.agentActivity` (flow `ticket-lifecycle`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/web/src/routes/board.tsx` | Trang board dự án | `BoardPage` |
| `apps/web/src/routes/list.tsx` | Trang danh sách (dự án hoặc tất cả) | `ListPage` |
| `apps/web/src/routes/all-board.tsx` | Trang board "Tất cả dự án" | `AllProjectsBoardPage` |
| `apps/web/src/routes/ticket-detail.tsx` | Trang ticket toàn màn hình | `TicketDetailPage` |
| `apps/web/src/routes/my-requests.tsx` | Board request của owner | `MyRequestsPage` |
| `apps/web/src/components/board-view.tsx` | Board: cột, lane, kéo-thả | `BoardView`, `filterBoardTickets`, `columnOf`, `lanesOf`, `BOARD_COLUMNS` |
| `apps/web/src/components/ticket-card.tsx` | Thẻ ticket trên board | `TicketCard`, `TicketCardFace` |
| `apps/web/src/components/filter-menu.tsx` | Menu lọc nhiều lựa chọn | `FilterMenu` |
| `apps/web/src/components/issue-table.tsx` | Bảng danh sách | `IssueTable`, `sortTickets` |
| `apps/web/src/components/project-badge.tsx` | Badge khóa dự án trên card/hàng/cây | `ProjectBadge`, `projectKeyResolver` |
| `apps/web/src/components/project-filter.tsx` | Bộ lọc nhiều lựa chọn "Dự án" dùng chung | `ProjectFilterMenu`, `selectedProjects` |
| `apps/web/src/components/ticket-side-panel.tsx` | Panel bên cạnh | `TicketSidePanel` |
| `apps/web/src/components/ticket-view.tsx` | Nội dung ticket dùng chung panel/trang | `TicketView` |
| `apps/web/src/components/ticket-tree.tsx` | Cây hậu duệ đầy đủ của request/pm_task | `TicketTree` |
| `apps/web/src/components/details-box.tsx` | Hộp chi tiết + hành động | `DetailsBox` |
| `apps/web/src/components/status-dropdown.tsx` | Dropdown đổi trạng thái | `StatusDropdown`, `ownerTargets` |
| `apps/web/src/components/subtask-tree.tsx` | Cây subtask dev↔QC + bug loop | `SubtaskTree`, `buildSubtaskTree`, `BUG_CYCLE_CAP` |
| `apps/web/src/components/comment-thread.tsx` | Danh sách + ô soạn bình luận | `CommentList`, `CommentComposer` |
| `apps/web/src/components/event-timeline.tsx` | Dòng sự kiện ticket | `EventTimeline` |
| `apps/web/src/components/report-panel.tsx` | Xem report + lịch sử phiên bản | `ReportPanel` |
| `apps/web/src/components/cancel-dialog.tsx` | Hộp thoại hủy ticket | `CancelDialog` |
| `apps/web/src/components/new-ticket-dialog.tsx` | Hộp thoại tạo ticket | `NewTicketDialog` |
| `apps/web/src/components/markdown-editor.tsx` | Ô soạn markdown | `MarkdownEditor` |
| `apps/web/src/lib/paste-image.ts` | Paste-to-upload ảnh clipboard dùng chung | `usePasteImage` |
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
  `Ticket.agentActivity` (đọc bởi `describeActivity()`) xuất phát từ flow đó; `MyRequestsPage` lọc theo
  `projectIds` bằng đúng `inProjectsFilter()` mà `GET /v1/tickets?projectIds=` dùng; `usePasteImage()` gọi
  `POST /v1/tickets/:id/attachments` của flow đó (`AttachmentMimeType`, `Attachment`) để paste-to-upload ảnh
  clipboard vào ô mô tả/bình luận.
- web-shell: dùng chung `queries.ts`, `format.ts`, `shortcuts.ts`, `ShellContext`, component `ui/*`.
- event-delivery: sự kiện `agent.activity_changed` làm mới ticket và máy qua `invalidationsFor()`.
- docs-sync-viewer: `TicketView` hiển thị "Docs liên quan" từ `flows[]`, dùng `docsFlow()`; trang chủ docs dùng
  lại `ProjectFilterMenu`/`selectedProjects()` của flow này.
- web-admin: `RoleAvatar`/`role_avatar` và badge trạng thái dùng lại ở Inbox và trang Máy; Inbox và Máy cũng
  dùng lại `ProjectFilterMenu`/`selectedProjects()`; trang Máy dùng lại
  `describeWait()`/`formatClock()` của `agent-activity.tsx` cho job đang chờ của từng máy.
- server-settings: dòng ticket đang chạy hiện bản cài đặt server nó bắt đầu với
  (`AgentActivity.settingsRevision`).

## Tests

- `apps/web/src/components/board-view.test.ts`: lọc, nhóm cột/lane.
- `apps/web/src/components/ticket-view.test.tsx`: từ chối `REPORT_REQUIRED`, bật lại thẻ khi kéo-thả bị từ
  chối; ticket `blocked` hiện gợi ý mở chặn trên ô soạn bình luận, ticket đang mở thì không.
- `apps/web/src/components/ticket-tree.test.tsx`: lồng cây theo `parentId`, badge dự án, trạng thái, "Chờ
  KEY", mark hoạt động (chờ/lỗi; đang chạy chỉ hiện spinner), click mở ticket; `TicketView` của một request nạp
  cây bằng đúng một lần gọi `/tree` (không gọi danh sách theo từng cấp), làm mới khi có invalidation
  `descendants`, lùi về ticket con trực tiếp khi `/tree` lỗi.
- `apps/web/src/routes/all-projects.test.tsx`: board "Tất cả dự án" hiện mọi dự án và lane request → pm_task
  kèm badge, không nạp ticket đã hủy, nhóm theo dự án, bộ lọc dự án gửi `projectIds` và giữ `project=` trong
  URL; danh sách "Tất cả dự án" có cột/lọc "Dự án" và sắp xếp theo dự án; danh sách một dự án không có cột dự
  án; bộ lọc "Dự án" của "Tất cả request của tôi" gửi `projectIds` kèm `type=request` và ghi lại URL.
- `apps/web/src/components/status-dropdown.test.tsx`: chỉ hiện đích hợp lệ theo `canTransition('owner', …)`.
- `apps/web/src/components/subtask-tree.test.tsx`: cặp dev↔QC, chuỗi bug, phụ thuộc.
- `apps/web/src/components/comment-thread.test.tsx`: đăng bình luận (header CSRF, nội dung, xoá ô soạn,
  đường lỗi); gõ `@` hiện gợi ý `@pm`, Enter/click chèn đúng và ẩn gợi ý, Escape ẩn, không gợi ý khi
  `canCallPm` tắt hay khi tag nằm trong email; thông báo tiếng Việt khi server từ chối `PM_NOT_AVAILABLE`; badge
  "Đã gọi PM" trên đúng bình luận và nút "Xem <key>" mở đúng pm_task; `unblocks` hiện gợi ý mở chặn dưới ô
  soạn (đọc được qua `aria-describedby`), ẩn khi gõ `@pm`; dán ảnh chèn đúng markdown tại vị trí con trỏ (qua
  placeholder "Đang tải ảnh..." rồi link thật), lỗi tiếng Việt và gỡ placeholder khi server từ chối upload,
  mime không hỗ trợ bị chặn trước khi gọi API và giữ nguyên nội dung đang soạn.
- `apps/web/src/components/markdown-editor.test.tsx`: dán ảnh vào ô mô tả chèn markdown tại vị trí con trỏ
  qua đúng vòng placeholder/link thật giống `CommentComposer`, ảnh hiện đúng ở tab "Xem trước"; ảnh vượt 10MB
  (server trả 413/`ATTACHMENT_TOO_LARGE`) hiện đúng thông báo cụ thể "Ảnh vượt quá giới hạn 10MB, hãy chọn ảnh
  nhỏ hơn." (`format.ts`, flow `web-shell`) thay vì thông báo chung "Dữ liệu không hợp lệ."; không truyền
  `ticketId` (hộp thoại tạo ticket mới) thì dán ảnh không làm gì.
- `apps/web/src/components/markdown-view.test.tsx`: `<img src="/v1/attachments/:id">` (URL tương đối) không
  bị `rehype-sanitize` strip khi render qua `MarkdownView`.
- `apps/web/src/components/cancel-dialog.test.tsx`: liệt kê hậu duệ đang mở qua nhiều cấp.
- `apps/web/e2e/core-flows.spec.ts`: tạo ticket, mở panel, bình luận agent xuất hiện dưới 2s, đổi trạng thái bị
  từ chối rồi qua khi có report, mở docs từ chip flow, hủy pm_task kéo theo hủy QC con, "Lý do: …" của
  `complexityReason` hiện trong Details.
- `apps/web/src/components/agent-activity.test.tsx`: mô tả đúng từng trạng thái/lý do chờ và lỗi; báo "không
  rõ" (không phải "đang chạy") khi máy im lặng lâu hơn `AGENT_ACTIVITY_STALE_MS`; ticket `todo` chưa ai nhận
  hiện đúng máy được giao; dòng hoạt động hiện trên ticket, mark trên card chỉ hiện khi job không chạy; dòng
  ticket đang chạy có `settingsRevision` hiện thêm "· cài đặt `<rev>`";
  `agent.activity_changed` làm mới ticket và máy.
- `apps/web/e2e/agent-activity.spec.ts`: từ chờ slot tới đang chạy live trên card, panel và trang Máy, ở cả ba
  viewport, không tràn ngang.
- `apps/web/e2e/pm-mention.spec.ts`: owner gõ `@` trên một subtask thấy gợi ý `@pm`, gửi xong bình luận hiện
  badge "Đã gọi PM", nút "Xem <pm_task key>" mở pm_task và thấy đúng job PM máy vừa báo (heartbeat) trên
  `AgentActivityLine`, dòng lịch sử "Bạn gọi PM (@pm) từ <key>" trên pm_task — ở cả ba viewport, không tràn
  ngang.
- `apps/web/e2e/cross-project-views.spec.ts`: ở cả ba viewport, một request được route tới hai dự án hiện đủ
  pm_task và con của chúng trên board "Tất cả dự án" (vào từ sidebar) và danh sách; bộ lọc dự án thu hẹp cả
  hai; "Cây ticket" của request liệt kê đủ bốn hậu duệ kèm dự án/trạng thái và tự cập nhật khi ticket dev
  chuyển sang review; không tràn ngang; dự án thứ hai dùng khóa dài tối đa (`XPPHONELAN`/`XPTABLETLA`/
  `XPDESKTOPL` theo viewport) và `expectBadgeInside()` kiểm tra khung `ProjectBadge` luôn nằm trong thẻ board,
  dòng/cột danh sách và dòng cây ticket.
