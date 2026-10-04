# CREWV2-701 / Task 3 — S3b: review độc lập (spec + chất lượng)

Phạm vi: `60f546e^..f1cda08`, chỉ các file S3b (`task-3-s3b-review-package.diff`), đối chiếu brief
`task-3-brief.md` dòng 21, 22, 28, S3a review (M1/M2/M4), interface S5a (`compose/composer.tsx`,
`compose/controller.ts`) và producer (`server/src/tickets/*`, `execution/attempts.ts`). Không chạy lại test;
bằng chứng chạy lấy từ report và log của implementer. Wiring controller (`router.tsx`, `ticket-routes.tsx`)
đang dở trong working tree, chỉ đọc để kiểm callsite.

### Spec Compliance

- ✅ `makeRequestSubmission` map đúng 13 field của `CreateTicket` và target `{purpose:'ticket',projectId,ticketId:null}`. `workflowPin` luôn null, root preference không thay run pin (`create-request-state.ts:27-46`).
- ✅ Superpowers là mặc định, BMAD phải chọn rõ. Ghi chú nói rõ BMAD chỉ có định nghĩa cho Claude Code, Codex chưa chạy được (`create-request-state.ts:57-68`).
- ✅ “Tạo yêu cầu” có trên board, list và request view (`board.tsx`, `list.tsx`, `requests.tsx`). Mô tả và tệp đi qua `AttachmentComposer` chung, không clone. Không sửa file nào trong `compose/*`, Task2 lib hay contracts.
- ✅ Field bị khóa khi composer khác `editing`. Trong cùng tab, lost response → hết phiên → đăng nhập lại → gửi lại dùng cùng key và cùng body, chỉ tạo một ticket (test component `create-request.test.ts` “mất response rồi hết phiên”). Server-side an toàn vì body frozen nằm trong controller.
- ⚠️ Lost response kèm reload tab: draft của composer (key, tệp, operation) sống trong `sessionStorage`, còn field form chỉ nằm trong bộ nhớ. Form hiện field không khớp với body sẽ được gửi lại (xem Important 2).
- ✅ Bình luận trong `TicketDetail` dùng composer chung, draft key `comment:<id>`. Draft theo ticket vẫn còn sau khi đóng/mở dialog (DOM test + E2E). Ticket terminal không có composer.
- ⚠️ “Explicit discard mới abandon”: chỉ đạt một phần. “Bỏ bản nháp bình luận/yêu cầu” chỉ xóa chữ, không abandon compose session/tệp. “Bỏ bản nháp tệp” của composer thì abandon nhưng giữ chữ. Không có một thao tác nào bỏ trọn bản nháp (Important 3).
- ✅ Discard có cảnh báo trùng của composer (`showDiscard`) giữ nguyên, đúng quyết định của owner.
- ⚠️ Draft theo ticket chỉ an toàn khi `TicketDetail` remount theo ID. Dialog có `key={ticketId}` (`dialog.tsx:76`), nhưng trang ticket của controller (`ticket-routes.tsx:105`, chưa commit) thì không (Important 1).
- ✅ Realtime không lấy focus của textbox bình luận: E2E thật (event comment, `toBeFocused` + giữ giá trị). `submission` của composer chỉ phụ thuộc `projectId/id/text` nên refetch ticket không reset được.
- ⚠️ Focus sau khi tạo: `setOpen(false)` của dialog tạo và việc mở `TicketDialog` xảy ra trong cùng một tick. Radix trả focus khi unmount bằng `setTimeout`, nên có thể giành focus với focus trap của dialog ticket. Chưa có test (A3 blocked).
- ✅ M1: `canonicalTicketId` được dùng cho key ticket, comments/decisions và graph, cho path (`ticketPath` cũng lowercase) và revision guard. Event journal và mọi caller khác (`docs/ticket-links.tsx`, `docs/queries.ts`, `TicketAttachments`) đều dùng `ticket.id` của server, vốn đã là chữ thường.
- ⚠️ M1 mới chỉ được test qua URL. Không có test nào chứng minh key/invalidation/revision guard với deep link chữ hoa (Minor 2).
- ✅ M2: `failureText` có câu riêng cho `local` (`TICKET_ID_INVALID` → “Đường dẫn ticket không hợp lệ.”) và `aborted`, và được chuyển sang `queries.ts` để dùng chung.
- ✅ M4: `final_result_pending` hiện ở mọi trạng thái với tiền tố trung tính “Lý do chờ:”. “Đang chờ bạn” chỉ đi với `needs_input`. Producer xóa `wait_reason` khi chuyển signal (`service.ts:419-420`), nên không mâu thuẫn với terminal.
- ⚠️ M4: thiếu nhãn cho mã `owner_input`, mà đây là mã phổ biến nhất của `needs_input` (Minor 1).
- ✅ Editor liên kết tài liệu (PM add-on) được nhúng thay cho dòng “chưa có dữ liệu”, dùng chung key `ticket(id)` nên không phát sinh GET thừa.
- ⚠️ Editor docs-links vẫn sửa được trên ticket terminal, ngay dưới câu “chỉ xem” (Minor 3).
- ✅ E2E không mock network (API/PG/Vite thật của fixture Task1). Không có `page.route`.
- ⚠️ A3 tạo yêu cầu qua API thật bị BLOCKED vì fixture chưa mount `AttachmentAssembly`. Đường text-only/PNG/reauth-replay và gửi bình luận mới chỉ được chứng minh trên producer giả trong bộ nhớ. Report ghi đúng “claim S3b only, A3 pending”.
- ⚠️ `/history` chưa đọc (contracts chưa có decoder). S3a M3/M5/M6 vẫn deferred. Report đã ghi nhận.
- ⚠️ `test/support/dom-events.ts` đã được S6docs (`2eb8936`) import trước khi được commit. Lịch sử trong khoảng `2eb8936..60f546e` không build được test.

### Strengths

- Ranh giới authority được giữ chặt. Form chỉ sở hữu metadata, composer sở hữu mô tả/tệp/key, và `setSubmission` bị từ chối khi đã frozen. Vì vậy, kể cả khi UI lệch, server không thể nhận body mới dưới key cũ.
- Test component dựng đúng kịch bản trùng lặp nguy hiểm (`dropAfterCommit` → expire → login → retry) và assert một key, một body, một entity.
- Draft của form gắn với vòng đời session (xóa ở `logging_out`/`guest`, giữ ở `expired`), khớp với ranh giới wipe của Task2. App chỉ có một owner, nên không có rò rỉ giữa các tài khoản.

### Issues

#### Critical

Không có.

#### Important

1. **`detail.tsx:120-122`, `detail.tsx:267`: draft bình luận có thể rò sang ticket khác.**
   - **Vấn đề:** `CommentComposer` khởi tạo `text` bằng `useState(() => drafts.comments.get(ticket.id))` và không có `key`. Nếu `TicketDetail` được render lại với `ticketId` khác mà không remount, `text` của ticket A vẫn giữ nguyên. Ví dụ: trang `/tickets/$ticketId` trong `ticket-routes.tsx:105` không đặt `key`, và TanStack Router giữ instance khi bấm back/forward hay đi link giữa hai ticket. Trong khi đó `submission.target` đã chuyển sang B, controller mới (`draftKey` `comment:B`) nhận ngay chữ của A, và `write()` ghi chữ đó vào draft của B.
   - **Tại sao nghiêm trọng:** owner có thể gửi bình luận soạn cho A lên ticket B. Dialog hiện an toàn chỉ vì `dialog.tsx:76` có `key`.
   - **Sửa:** `<CommentComposer key={ticket.id} ticket={ticket} />`, hoặc remount toàn bộ nội dung chi tiết theo `canonicalTicketId(ticketId)`. Thêm một DOM test đổi prop `ticketId` mà không remount.

2. **`create-request.tsx:57-64`, `176-186`, `create-request-state.ts:74-98`: field form và body frozen lệch nhau sau khi reload.**
   - **Vấn đề:** `formDrafts` chỉ nằm trong bộ nhớ, còn composer lưu draft key/tệp/operation vào `sessionStorage` (`main.tsx:10`, `controller.ts:1327-1360`). Giả sử lần tạo bị mất response rồi tab reload. Form mở lại với field mặc định (title rỗng, project theo view) và bị khóa khi composer báo `ambiguous`, trong khi nút “Gửi lại đúng yêu cầu cũ” replay một body owner không nhìn thấy. Tệ hơn, khi chưa có `projectId` hợp lệ thì composer không được mount: `composeState` giữ `'editing'`, field mở khóa, owner sửa tiêu đề/loại mới, rồi bấm gửi sẽ ra body cũ hoặc nhận `SUBMIT_UNCONFIRMED`. Bình luận cũng bị như vậy: ô nội dung trống nhưng gửi lại body cũ.
   - **Tại sao nghiêm trọng:** brief yêu cầu “form khóa khi ambiguous/suspended, không đổi metadata”. Server-side vẫn an toàn, nhưng UI cho owner thấy một yêu cầu khác với yêu cầu thật sự được gửi.
   - **Sửa (chọn một):**
     - lưu `RequestFormFields`/text bình luận vào cùng tab storage, theo `draftKey`, và wipe ở logout giống Task2;
     - khi composer không ở `editing`, hiển thị field đọc từ body của pending operation (read-only) thay vì từ `formDrafts`.
   - Ngoài ra, luôn mount composer (hoặc đọc trạng thái key `create-request`) trước khi mở khóa field.

3. **`detail.tsx:148-156`, `create-request.tsx:187-193`: “bỏ bản nháp” không bỏ trọn bản nháp.**
   - **Vấn đề:** nút của form chỉ xóa chữ. Session và tệp vẫn còn, nên bình luận/yêu cầu mới viết sau đó sẽ gửi kèm tệp cũ. Ngược lại, “Bỏ bản nháp tệp” của composer thì giữ chữ.
   - **Tại sao nghiêm trọng:** brief yêu cầu “explicit discard mới abandon” (dòng 28). Hiện không có thao tác nào abandon trọn vẹn, và người dùng dễ hiểu nhầm là đã bỏ hết.
   - **Sửa:** khi composer còn tệp/session, ẩn hoặc disable nút bỏ chữ, kèm hướng dẫn bấm “Bỏ bản nháp tệp” trước. Hoặc xin controller mở rộng interface S5a (`onAbandoned`/abandon từ ngoài) rồi xóa chữ khi nhận callback. Cần controller quyết định vì S5a đã đóng.

#### Minor

1. **`status.ts:85-93`: thiếu nhãn `owner_input`.** Producer ghi `owner_input` (`server/src/tickets/service.ts:420,486`), nên `needs_input` thông thường hiện “Lý do chờ: mã từ máy chủ “owner_input”.”. Comment “Codes the producer writes” liệt kê thiếu mã này. **Sửa:** thêm nhãn và sửa lại comment.
2. **`ticket-detail-dom.test.ts` (test deep link chữ hoa): test M1 chỉ chứng minh URL lowercase.** `ticketPath` cũng lowercase, nên bỏ `canonicalTicketId` khỏi key thì test vẫn pass, và không test nào cover lỗi gốc S3a M1 (invalidation theo event/revision guard với key chữ hoa). **Sửa:** assert `cache.getQueryData(queryKeys.ticket(lower))` có dữ liệu, và một invalidation `queryRoots.ticket(lower)` làm detail mở bằng ID chữ hoa refetch.
3. **`detail.tsx:211-215` + `259`: editor docs-links vẫn sửa được trên ticket done/cancelled, ngay dưới câu “chỉ xem”.** **Sửa:** chọn một trong hai — truyền read-only khi terminal, hoặc đổi câu thông báo nếu sửa docs link sau khi xong là chủ đích (server cho phép).
4. **`create-request.tsx:246`: tạo thành công nhưng không mở ticket khi `trigger.current` null.** Hiếm xảy ra, nhưng dialog đóng mà không phản hồi gì. **Sửa:** gọi `onOpenTicket` với fallback focus.
5. **`queries.ts:255`: `projectsQueryOptions` chiếm root key dùng chung `['v2','projects']` cho shape `Project[]` (đã đọc hết mọi trang) của riêng tickets.** View project/machine sau này dùng cùng key với shape page sẽ va cache. **Sửa:** dùng key con, ví dụ `[...queryKeys.projects(), 'all']`.
6. **`detail.tsx:267`: ticket chuyển sang terminal qua realtime khi một bình luận đang `sending`/`ambiguous` thì composer bị unmount và nút gửi lại biến mất khỏi chi tiết.** Chỉ còn đường qua panel recovery của Task2. **Sửa:** vẫn mount composer khi composer chưa ở `editing`, hoặc ghi rõ hành vi này trong docs flow.

### Assessment

**Task quality:** Needs fixes

Phần map body, Superpowers/BMAD, khóa field trong cùng tab và M1/M2/M4 đều đạt. Phải sửa Important 1 (rò draft giữa các ticket, sửa một dòng) trước khi controller mount trang ticket. Important 2 và 3 lệch với yêu cầu “form khóa, không đổi metadata” và “explicit discard mới abandon”. Important 3 có thể cần controller quyết định về interface S5a. A3 vẫn pending và không được tính là xong.
