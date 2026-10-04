# CREWV2-701 / Task 3 — S3a review (độc lập, phạm vi task)

Phạm vi: `ba58e42^ → 167f79c`, chỉ file S3a (`v2/web/src/tickets/*`, `v2/web/test/tickets.test.ts`, `v2/web/e2e/tickets.spec.ts`) cùng `v2/docs/flows.yaml`, `files.md`, `index.md`, `flows/web-tickets.md`. Hunk `web/e2e/app-router.spec.ts` (web-shell) bỏ qua. Không chạy lại test; bằng chứng là đọc source ở HEAD (SHA khớp report) và mỗi rủi ro được kiểm một lần với code ngoài phạm vi.

### Spec Compliance

- ✅ Chỉ S3a: commit `ba58e42` thêm đúng 7 source + 2 test + docs; không có `requests.tsx`, `create-request*`, không import `compose/*`, không sửa router/main/styles/server.
- ✅ DTO lấy từ `web/src/contracts/tickets.ts` (Ticket/Page/Graph/Comment/Decision, `newerTicket`), không khai báo lại và không import runtime server. `TimelineEntry`/`TicketFilters` chỉ là view-model.
- ✅ `statusLabels` khớp đúng 7 nhãn của brief, kèm `satisfies Record<TicketStatus,string>` (`status.ts:8-16`). Icon chữ + nhãn ở cột bảng/badge; không có kéo thả.
- ✅ `requestRoots` dùng `level==='request' && id===rootId && parentId===null`, dedupe theo revision mới (`status.ts:56-67`). Unit fixture có hai root trùng tiêu đề, bước mồ côi, con bắt buộc, done/cancelled.
- ✅ Filter là đúng 4 filter của producer (`projectId,status,kind,rootId`), khớp schema `server/src/tickets/routes.ts:199-239` (additionalProperties false, không có `level`). Cursor UUID, tải trang qua “Tải thêm” tới `nextCursor===null`, hiện “danh sách chưa đầy đủ”; không tuyên bố đủ danh sách root.
- ✅ Producer gaps được kiểm: attachment routes chưa mount (grep `attachments/routes` trong `server/src` chỉ có chính file đó); docs-links chỉ có PUT (`routes.ts:454`). Máy/model/độ khó/lượt chạy/bằng chứng, attachment, docs liên quan đều hiện “chưa có dữ liệu” (`detail.tsx:193-210`); không đọc `criteria`/prose.
- ✅ Timeline đọc hết trang comments/decisions (limit 100 = max producer `routes.ts:150-152`), sắp theo `createdAt` rồi `id`, chặn cursor lặp; có actor/kind/time/source/rationale; giờ Asia/Ho_Chi_Minh (`queries.ts:197-213`).
- ✅ Một Radix dialog dùng chính `TicketDetail`; `Dialog.Title`/`Dialog.Description` có ở cả trạng thái loading/lỗi/có dữ liệu; Escape/X/overlay; trả focus trigger → `[data-focus-fallback]` → `#main-content` (có thật ở `shell.tsx:93`).
- ✅ Task2 libs: dùng `queryKeys.ticket/tickets/comments/decisions/graph`, khớp prefix `invalidations()` (`lib/events.ts:33-56`); `getDecoded`/`OwnerClient`; revision guard `ticketQueryOptions` (`queries.ts:102-112`) có test.
- ✅ Hai caller S3a có thật: `board.tsx:67`, `list.tsx:150`. Bốn caller còn lại được khai báo là pending, không claim.
- ✅ Manifest: `167f79c` chỉ sửa `v2/docs/flows.yaml` (dời `shared: {}`/`unassigned: []` xuống sau `web-tickets`) và `v2/docs/files.md` (chỉ sắp lại vị trí 5 dòng, không thêm/xóa mapping). Trailer `Crew-Owner-Approved: CREWV2-701` có mặt.
- ⚠️ Draft giữ theo ticket khi đóng chưa có (không có ô nhập trước S3b); phải đóng ở S3b/A3.
- ⚠️ Bốn caller (request selection, graph node, docs link, Assistant link), route `/projects/$projectId/tickets` và `/tickets/$ticketId` còn chờ controller/Task4/Task6; brief yêu cầu review lại danh sách callsite file:line khi wiring xong.
- ⚠️ Docs nằm ở `v2/docs/flows/web-tickets.md`, không phải `docs/v2/web-tickets.md` như brief ghi. Task2 cũng chỉ có flow doc (`docs/v2/` chỉ có `web-shell.md`), nên cần controller xác nhận flow doc là canonical.
- ⚠️ `ba58e42` tự nó để `web-tickets` sau `shared`/`unassigned` (YAML sai cấu trúc); trạng thái đúng chỉ có từ `167f79c`. Bisect/check trên `ba58e42` sẽ fail manifest.
- ⚠️ Nhánh trả focus về container khi trigger đã rời DOM chỉ có unit test cho `pickReturnFocus`; không có browser test cho việc chụp `fallback` lúc mở (`dialog.tsx:49-52`). E2E chỉ phủ trường hợp trigger vẫn còn trong DOM.
- ⚠️ E2E mount harness bằng cách lấy URL `.vite/deps` từ `main.tsx` (`tickets.spec.ts:62-69`), chưa đi qua router thật. Deep link/reload/404, zoom 200% và needs_input/repair5 trong browser thuộc A3.

### Strengths

- Mọi ranh giới authority đều rõ: không có mutation, root/status/waitReason đều đọc từ field producer, mã `waitReason` lạ hiện nguyên văn. Hai mã đã biết có nguồn (`repair.ts:54`, `attempts.ts:489`).
- `buildLegacyTimeline` xử lý `createdAt` không parse được (NaN → sắp cuối, rồi theo id), và có test cho trường hợp thứ tự UUID ngược với thời gian.
- Khi đã có dữ liệu, lỗi refetch không thay nội dung (`detail.tsx:153-157`, `history.tsx:93`), nên event realtime không remount vùng đang có focus. E2E kiểm focus ở nút Đóng giữ nguyên qua event SSE thật.
- Workaround `aria-live` → `role="status"` để Radix `hideOthers` vẫn ẩn được nền có cơ sở và được E2E kiểm (`aria-hidden="true"` trên root).

### Issues

#### Critical

Không có.

#### Important

Không có.

#### Minor

1. **`queries.ts:75-78`, `queries.ts:223-225`, `queries.ts:237-246` — ID ticket không được chuẩn hóa chữ thường.** `isUuid` không phân biệt hoa/thường (`contracts/http.ts:21`), nên `ticketPath` chấp nhận UUID chữ hoa và query key là `['v2','ticket',<UPPER>]`. Server và event journal dùng UUID chữ thường, nên `queryRoots.ticket(id)`/`comments(id)`/`decisions(id)` không khớp key: deep link `/tickets/<UPPER>` không bao giờ được làm mới realtime. Ngoài ra `newerTicket` so `current.id !== incoming.id` sẽ luôn khác, nên revision guard bị bỏ qua. `parseTicketFilters` đã lowercase filter nhưng detail thì chưa. **Sửa:** lowercase `ticketId` một lần ở `TicketDetail`/`TicketHistory` (hoặc trong `useTicket`/`useTicketHistory`) trước khi tạo key và path, và thêm một unit test.
2. **`history.tsx:41-48` — `failureText` gán lỗi phía client cho server.** `kind:'local'` (ví dụ `TICKET_ID_INVALID`, `CURSOR_INVALID`) và `kind:'aborted'` rơi vào “Máy chủ báo lỗi (…)”. Với deep link có ID sai, owner sẽ thấy câu sai về nguồn lỗi. **Sửa:** thêm nhánh `local` (“Đường dẫn ticket không hợp lệ.”) và `aborted`.
3. **`list.tsx:82-106` — vùng `role="status"` bao cả nút “Tải thêm”/“Thử lại” và có `role="alert"` lồng bên trong.** Live region chứa control tương tác và live region lồng nhau khiến screen reader đọc lặp hoặc khó đoán; “Đã tải N ticket” cũng được đọc lại sau mỗi refetch do event làm số dòng thay đổi. **Sửa:** chỉ đặt `role="status"` trên `<span>` đếm/hoàn tất, để nút ra ngoài, và để alert là sibling.
4. **`detail.tsx:163-167` + `status.ts:87` — `waitReason` chỉ hiện khi `needs_input`.** Producer ghi `final_result_pending` trong khi ticket vẫn ở trạng thái khác (`attempts.ts:489` chỉ cập nhật `wait_reason`), nên nhãn này không bao giờ hiện ra. Nếu có trường hợp nó đi cùng `needs_input`, câu sẽ là “Đang chờ bạn: Đang chờ máy xác nhận…”, tự mâu thuẫn. **Sửa:** hiện `waitReason` khác null ở mọi trạng thái với tiền tố trung tính (“Lý do chờ:”), chỉ dùng “Đang chờ bạn” khi `needs_input`.
5. **`dialog.tsx:76` / `detail.tsx:61,88,169…` — cấp heading phẳng trong dialog.** `Dialog.Title` render `h2`, và các section bên trong cũng là `h2`, nên tiêu đề ticket không đứng trên các mục. **Sửa:** truyền cấp heading theo `presentation` (dialog: section `h3`), hoặc dùng `Dialog.Title asChild` với `h1` trong dialog.
6. **`queries.ts:237-247`, `detail.tsx:82-84` — chi phí refetch theo event.** Mỗi `comment.created`/`decision.created` đọc lại toàn bộ trang lịch sử. Mỗi event ticket bất kỳ (prefix `graphs`) tải lại graph của cả root khi dialog đang mở. Report có ghi nhận một phần (ChildTickets). Hiện chấp nhận được trước G1, nhưng nên ghi vào docs flow là giới hạn đã biết.

### Assessment

**Task quality:** Approved

S3a đáp ứng phạm vi đọc, giữ đúng authority và không bịa dữ liệu producer. Không có lỗi Critical/Important. Minor 1 (chuẩn hóa UUID) nên sửa trước khi controller mount route deep link. Các mục ⚠️ (draft, bốn caller, route, A3) vẫn mở và không được tính là đã xong.
