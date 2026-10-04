# Bảng, danh sách và hộp thoại ticket dùng chung trên web Crew v2

## Mục đích

Flow này hiển thị ticket cho owner theo kiểu Jira: bảng theo trạng thái, danh sách dạng bảng và một hộp thoại chi tiết dùng chung. Mọi view đọc cùng query key, nên cùng một ticket luôn hiện cùng trạng thái và cùng phiên bản (`revision`). Phần này (S3a) chỉ đọc dữ liệu. Form “Tạo yêu cầu”, composer bình luận và tệp đính kèm thuộc S3b, được gắn vào sau khi composer dùng chung của Task5 (S5a) được nghiệm thu.

## Điểm vào

- `web/src/tickets/dialog.tsx` → `TicketDialog({ ticketId, onClose, returnFocus })`: hộp thoại Radix duy nhất cho mọi nơi mở ticket. Hộp thoại có Title/Description, giữ focus bên trong, làm nền trơ, đóng bằng Escape hoặc nút X. Khi đóng, focus quay về phần tử đã mở hộp thoại. Nếu phần tử đó không còn trong DOM, focus về container `[data-focus-fallback]` gần nhất được ghi nhận lúc mở, rồi tới `#main-content`.
- `web/src/tickets/detail.tsx` → `TicketDetail({ ticketId, presentation })`: phần chi tiết dùng chung. Với `presentation: 'dialog'`, tiêu đề và mô tả ngắn là `Dialog.Title`/`Dialog.Description`; với `'page'` là `h1`/`p`.
- `web/src/tickets/board.tsx` → `TicketBoard` và `web/src/tickets/list.tsx` → `TicketList`: cùng nhận `{ filters, onFiltersChange, onOpenTicket(ticketId, trigger) }`.

## Các bước

1. Router (do controller sở hữu) đọc search params, gọi `parseTicketFilters` để chỉ giữ `projectId`, `status`, `kind`, `rootId` hợp lệ, rồi truyền vào board hoặc list. Filter nằm trong URL nên đổi chế độ xem vẫn giữ nguyên filter. `TicketFilterBar` chỉ cho chọn trạng thái và loại; bỏ lọc theo `rootId` khi có.
2. `web/src/tickets/queries.ts` → `useTicketList(client, filters)`: infinite query trên `queryKeys.tickets(filters)`. Mỗi trang gọi GET `/v2/tickets?…&cursor=<UUID>&limit=50` qua `OwnerClient` của app runtime và giải mã bằng `decodeTicketPage`. Trang tiếp theo chỉ được tải khi owner bấm “Tải thêm”, cho tới khi `nextCursor` là `null`. Nếu còn trang, giao diện ghi rõ “danh sách chưa đầy đủ”. Các trang được gộp bằng `mergeTicketPages`: ID trùng thì giữ revision mới hơn.
3. `TicketBoard` chia ticket vào bảy cột theo `statusOrder`. Mỗi cột có biểu tượng chữ và nhãn từ `statusLabels`, nên trạng thái không chỉ dựa vào màu. Không có kéo thả: trạng thái chỉ đổi qua signal của producer. `TicketList` hiện cùng dữ liệu dạng bảng (tiêu đề, trạng thái, cấp, loại, phiên bản).
4. Bấm thẻ hoặc dòng gọi `onOpenTicket(id, trigger)`. Caller giữ `{ ticketId, trigger }` và render một `TicketDialog`. Hộp thoại nằm trên view hiện tại, không đổi scroll hay viewport của view phía sau.
5. `TicketDetail` dùng `useTicket` (GET `/v2/tickets/:id`). `ticketQueryOptions` từ chối ID không phải UUID trước khi gọi mạng. Response có revision cũ hơn bản trong cache bị bỏ qua (`newerTicket`). Khi đã có dữ liệu, refetch hoặc lỗi refetch không thay thế nội dung, nên event realtime không làm mất focus đang ở trong hộp thoại. Ticket `done`/`cancelled` hiện ghi chú chỉ xem. Ticket `needs_input` hiện lý do chờ từ `waitReason` (`waitReasonLabel`: `repair_limit`, `final_result_pending`; mã lạ hiện nguyên văn). Phần thông tin hiện `repairCycles`/5, workflow đã ghim, skill, commit đã merge và các ID.
6. `ChildTickets` đọc GET `/v2/tickets/:rootId/graph` (`queryKeys.graph(rootId)`) và chỉ liệt kê con trực tiếp (`parentId === ticket.id`).
7. `web/src/tickets/history.tsx` → `TicketHistory`: `fetchAllPages` đọc hết mọi trang `/comments` và `/decisions` (limit 100, cursor UUID). Nếu cursor lặp lại thì dừng với `PAGE_CURSOR_LOOP`. Sau đó `buildLegacyTimeline` sắp xếp theo `createdAt` rồi `id`, vì producer xếp theo UUID chứ không theo thời gian. Mỗi mục hiện loại, người thực hiện, giờ Asia/Ho_Chi_Minh (`formatTime`), nội dung; quyết định có thêm lý do và nguồn.
8. Event `ticket.*`, `comment.created`, `decision.created` từ `EventSync` invalidate các prefix `ticket/tickets/graphs/comments/decisions` (flow `web-data`), nên board, list và hộp thoại đang mở cùng refetch.

## Dữ liệu

DTO lấy từ `web/src/contracts/tickets.ts` (Ticket, trang ticket, graph, comment, decision), không khai báo lại. `statusLabels` khớp chính xác bảy trạng thái của producer. `requestRoots` nhận ra yêu cầu gốc chỉ bằng `level === 'request' && id === rootId && parentId === null`, không dựa vào tiêu đề hay vị trí trang. Hooks nhận `OwnerClient` từ `useRuntime().client` của component gọi, nên `queries.ts` không phụ thuộc composition root và chạy được trong `node:test`.

Phần còn chờ producer được hiện rõ là chưa có dữ liệu, không suy ra từ `criteria` hay prose:

- Máy, model, độ khó, lượt chạy hiện tại và bằng chứng: chờ projection có kiểu của G1/G3.
- Lịch sử review, phương án dự phòng, sản phẩm, commit và đồng bộ tài liệu: chờ history projection G1/G3. Hiện timeline chỉ gồm bình luận và quyết định.
- Tệp đính kèm của ticket: API attachment chưa mount (G2).
- Tài liệu liên quan của ticket: producer chưa có route đọc ticket → docs (G1).
- Phân trang theo yêu cầu gốc: G1. Hiện danh sách chỉ lọc theo các filter producer hỗ trợ.

## Wiring cho controller

Sáu nơi mở ticket phải dùng chung `TicketDialog`/`TicketDetail` và query trong flow này: thẻ trên bảng (`board.tsx`), dòng trong danh sách (`list.tsx`), chọn yêu cầu (S3b), node trên graph (Task4), link ticket liên quan trong docs (Task6) và link ticket trong Trợ lý (Task6). Router cần một route trang chi tiết dùng `TicketDetail presentation="page"` cho deep link/reload, và route board/list lưu filter trong search params. Container của mỗi view cần `data-focus-fallback` và `tabIndex={-1}` để làm đích trả focus dự phòng.

## Flow liên quan

`web-data.md` sở hữu `OwnerClient`, query key, event invalidation và DTO. `web-shell.md` sở hữu app runtime, router và fixture. `server-tickets.md` định nghĩa các route đọc ticket, graph, comment và decision.

## Tests

- `web/test/tickets.test.ts`: 16 test cho đủ 7 nhãn và biểu tượng riêng; `requestRoots` với hai gốc trùng tiêu đề, bước mồ côi, con bắt buộc, gốc giả và gốc done/cancelled; ID trùng lấy revision mới; nhóm theo trạng thái; filter chỉ giữ giá trị producer hỗ trợ; path danh sách và cursor UUID; giải mã và lỗi shape; `nextCursor` null dừng phân trang; đọc hết trang và chặn cursor lặp; timeline theo thời gian khi thứ tự UUID ngược; revision guard; từ chối ID sai trước khi gọi mạng; giờ Asia/Ho_Chi_Minh; nhãn người thực hiện; chọn đích trả focus. RED trên scaffold: 16/16 thất bại; GREEN 16/16.
- `web/e2e/tickets.spec.ts` chạy trên API, PostgreSQL và Vite thật của fixture Task1, dữ liệu tạo qua API owner, không mock mạng. Bảng có đủ 7 cột, ba ticket (hai gốc trùng tiêu đề và một bước con). Hộp thoại mở đúng ticket, hiện mô tả nhiều dòng, ticket con, phần chưa có dữ liệu và timeline bình luận → quyết định → bình luận kèm lý do. Nền bị `aria-hidden`, Tab không thoát khỏi hộp thoại. Bình luận mới tạo trong lúc hộp thoại mở xuất hiện qua event thật mà focus vẫn ở nút Đóng. Escape trả focus về thẻ. Danh sách hiện cùng revision với bảng; mở từ dòng, đóng bằng X trả focus về dòng. Filter loại thu hẹp cả danh sách lẫn bảng.
