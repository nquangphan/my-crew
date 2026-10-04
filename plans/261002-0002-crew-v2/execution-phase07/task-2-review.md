# Review — Crew v2 phase07 web Task 2 (transport, phiên owner, cache, đồng bộ sự kiện)

Phạm vi: `2b958b8^..2b958b8` (21 file, +4309). Đọc trọn source mới (`src/lib/*`, `src/auth/*`, `src/contracts/http.ts`, `tickets.ts`), lướt test/E2E theo các assert chính; không chạy lại test. Kiểm chéo producer, mỗi điểm một lần: `journal/mutation.ts:15-54`, `journal/routes.ts:22-128`, `auth/routes.ts:30-150`, `auth/session.ts:87-114`, `tickets/contracts.ts:8-33`, `tickets/service.ts:16-37`, `platform/contracts.ts:13`.

### Spec Compliance

- ✅ Interface khớp brief: `PendingOperation`, `RecoveryTombstone`, `SessionDto`, `SessionState`, `SessionClient`, `RequestOptions`, `OwnerClient`, `TicketGraph`, `JournalEvent`, `compareCursor`, `invalidations`, `queryKeys` (5 key bắt buộc giữ nguyên chữ ký; key thêm là additive, chấp nhận được).
- ✅ `JournalEvent`/`decodeJournalEvent` mirror `Event` (`platform/contracts.ts:13`), có `occurredAt`; không runtime import server. `decodeTicket` khớp `mapTicket` (không có `deployApprovalDecisionId` trong response, đúng).
- ✅ Same-origin `/v2/` (`assertOwnerPath`, `credentials: 'same-origin'`); CSRF trên JSON mutation và raw upload; không mutation khi chưa có session (`requireSession`).
- ✅ 503 không JSON → `SERVICE_UNAVAILABLE` (`failureFrom`); AbortError → ambiguous giữ key; cùng id/body qua các lần retry; `bodyJson` freeze một lần.
- ✅ Secret: payload `storage=memory` chỉ persist dưới dạng tombstone; serializer từ chối memory operation và key dạng secret; password chỉ nằm trong state component và bị xóa sau request/unmount.
- ✅ 401 → `expired`: abort epoch (GET/stream), xóa CSRF, `suspendAll` giữ key/body, `cache.clear()`; reauth = POST rồi GET verify; replay thủ công qua panel “Tiếp tục yêu cầu chưa xác nhận”.
- ✅ Logout: DELETE + CSRF, không Idempotency-Key; `tombstoneAll` chỉ giữ id/intentId/ownerId/method/path/targetId/expectedRevision. IDEMPOTENCY_CONFLICT trên payload nhập lại → trở lại tombstone, không đổi key.
- ✅ `safeReturnPath` chỉ nhận `/crew-v2/` nội bộ (chặn `\`, control char, `..`, khác origin, chuẩn hóa khác chuỗi gốc).
- ✅ 429 login không blind retry (unit test đếm 3 call).
- ✅ SSE qua fetch + `Last-Event-ID`; parser UTF‑8 fatal incremental, CR/LF/CRLF tách chunk, comment, multiline, ≤1 MiB; malformed/overflow → reconnect có ngân sách `maxFailures` (không loop vô hạn). Kiểm `frame.event === event.type` và `frame.id === event.cursor`.
- ✅ Cursor BigInt-safe; dedup `<= applied`; cursor ghi sau `#enqueue`; unknown type → invalidation rộng trong scope; reconnect → `queryRoots.all`.
- ❌ “Chỉ cấp key mới sau terminal rejection hoặc confirmed acceptance”: `mutate` coi mọi 4xx ≠ 409 là terminal, kể cả `403 CSRF_INVALID`/`ORIGIN_INVALID` do `requireOwner` ném trước idempotency lookup (xem Important #1).
- ⚠️ “Listener bắt đầu trước initial GET”: `wireSession` gọi `events.start()` đồng bộ trong listener của `SessionController`, nên request `/v2/events` thường đi trước GET của children — nhưng thứ tự phụ thuộc thứ tự subscribe và cách controller mount `wireSession` so với `SessionBoundary`; chưa có wiring thật trong `main.tsx`/`router.tsx` để xác minh.
- ⚠️ Refetch khi focus: không có trong diff; phụ thuộc cấu hình `QueryClient` (`refetchOnWindowFocus`) do controller sở hữu.
- ⚠️ Login/expired outlet chưa nối vào `main.tsx`/`router.tsx`: brief giao việc này cho controller sau S2, nên không tính là thiếu; E2E chạy trên test-owned root nên chưa chứng minh tích hợp router thật.
- ⚠️ Lần mở đầu đọc toàn journal từ cursor `0`: server mặc định `after='0'` (`journal/routes.ts:24`) và không có endpoint head cursor, nên đây là ràng buộc của producer chứ không phải lỗi web — nhưng chi phí là O(journal) GET mỗi tab mới.
- ⚠️ Screenshot login/expired/recovery: report có liệt kê hash; em không mở ảnh.

### Strengths

- `PendingStore` có invariant rõ ràng và thực thi bằng code: một intent tối đa một key chưa giải quyết (`begin` → `IntentUnresolvedError`), object frozen, snapshot ổn định cho `useSyncExternalStore`, memory operation persist thành tombstone ngay trong lúc còn sống (reload không hồi sinh secret).
- Tách bạch rõ ràng ba nhánh expiry/logout/pagehide trong `wireSession`.
- E2E A2 kiểm trên PG thật: đếm `projects`/`idempotency`/`events` = 1/1/1, `BLOCKED` = 0, cùng key/body qua 3 lần ghi, CSRF mới ở lần replay — đây là test hành vi, không phải phantom test.

### Issues

#### Critical

Không có.

#### Important

1. **`v2/web/src/lib/api.ts:210-213` — `403 CSRF_INVALID`/`ORIGIN_INVALID` bị coi là terminal rejection, nhả key và có thể gây mutation trùng.**
   - **Vấn đề:** Mọi 4xx khác `IDEMPOTENCY_CONFLICT` đều dẫn tới `pending.reject(id)`, operation bị xóa và intent được phép `begin` key mới. Phía producer, `requireOwner` (`auth/routes.ts:41-50`) kiểm Origin/CSRF **trước** `createMutator`, nên 403 ở đây không cho biết gì về việc lần gửi trước đã commit hay chưa.
   - **Kịch bản cụ thể:** Mỗi lần POST `/v2/auth/session` tạo session mới và ghi đè cookie (`auth/routes.ts:131-133`). Owner đăng nhập ở tab B, thì tab A vẫn đang `authenticated` với CSRF cũ trong memory, cookie hợp lệ nên GET vẫn chạy. Mọi lần ghi hoặc replay của tab A đều nhận `403 CSRF_INVALID`.
     - Nếu operation trước đó đang `ambiguous` (lần gửi đầu mất response nhưng đã commit), `reject` xóa nó; người dùng gửi lại ý định, sinh key mới, và server tạo bản ghi thứ hai.
     - Không có đường làm mới CSRF (server có `GET /v2/auth/session` trả lại CSRF qua `revealCsrf`), nên tab A không ghi được cho tới khi reload, và mỗi lần thử lại đốt một operation.
   - **Vì sao Important:** Vi phạm trực tiếp ràng buộc “new key only after terminal rejection/confirmed acceptance” và rủi ro H×H (duplicate actions) mà brief nêu.
   - **Cách sửa:**
     - Với `403 CSRF_INVALID`/`ORIGIN_INVALID`, không gọi `reject`. Thay vào đó: `markSuspended`, rồi `session.refresh()` (GET session lấy CSRF mới, xác minh owner). Thất bại thì `expire()`. Giữ nguyên key/body để người dùng replay.
     - Tổng quát hơn: chỉ `reject` với mã lỗi mà producer ném từ trong mutator/handler (domain 4xx). Nếu operation đã từng `ambiguous` thì 4xx “trước lookup” phải giữ `ambiguous`.
     - Thêm unit test: ambiguous → retry nhận 403 CSRF_INVALID → operation vẫn còn, cùng key, `begin` cùng intent ném `IntentUnresolvedError`.

#### Minor

1. **`v2/web/src/lib/api.ts:126,181,191,207`:** `sleep(..., request.signal)` bị abort trong lúc backoff sẽ reject bằng `signal.reason` thô (DOMException) thay vì `ApiFailure('ABORTED')`. Trạng thái vẫn `ambiguous` nên an toàn, nhưng caller nhận một kiểu lỗi không nằm trong hợp đồng `ApiFailure`. Sửa: bọc lỗi của `sleep` thành `ApiFailure(null,'ABORTED','aborted')`.
2. **`v2/web/src/lib/pending-operation.ts:52,75-83`:** `containsSecret` chỉ dựa vào tên key, nên có cả bỏ sót lẫn bắt nhầm.
   - Bỏ sót: secret nằm dưới key trung tính (ví dụ `{name, value}`) mà caller khai `storage:'tab'` sẽ vào `sessionStorage`.
   - Bắt nhầm: key như `tokenBudget` hay `maxTokens` làm `begin` ném `SECRET_PAYLOAD`.
   - Lớp bảo vệ thật hiện chỉ là việc caller chọn đúng `storage`. Sửa: chọn `storage` theo danh sách route chứa secret khai báo tập trung (ví dụ route API secret/machine token luôn `memory`), giữ heuristic làm lớp phụ.
3. **`v2/web/src/lib/pending-operation.ts:218-221,400`:** Record trong `sessionStorage` sai version hoặc hỏng sẽ đặt `#unknownVersion` và tắt persist cho **toàn bộ** tab một cách im lặng. Operation mới không được lưu, reload là mất key ambiguous. `begin()` cũng không biết các intent nằm trong record cũ. Sửa: hiển thị trạng thái cần owner quyết định (UI) hoặc lưu record mới dưới key khác, không chặn persist im lặng.
4. **`v2/web/src/lib/events.ts:362,373,442`:** Nếu proxy hoặc intermediary đóng stream trước 30 giây (heartbeat 15 giây là comment, không tính `delivered`), mỗi lần đóng bị tính là failure. Sau 6 lần, sync chuyển `failed` vĩnh viễn và chỉ `retry()` thủ công mới chạy lại. Diff chưa có UI hiển thị `failed`/nút thử lại. Sửa: coi stream đóng sạch có nhận heartbeat là healthy, hoặc chỉ tính failure khi lỗi HTTP/protocol; cần một chỗ hiển thị status.
5. **`v2/web/src/lib/session.ts:276-284`:** Khi DELETE logout lỗi mạng, client vẫn wipe và chuyển `guest`, nhưng cookie session ở server vẫn sống, nên reload sẽ tự `authenticated` lại. Màn login hiện “Không kết nối được máy chủ…”, không nói rõ là đăng xuất chưa hoàn tất. Sửa: dùng message riêng cho trường hợp này (“Đăng xuất trên máy chủ chưa xác nhận”), hoặc cho phép thử DELETE lại.
6. **`v2/web/src/lib/api.ts:217-248`:** `upload` gặp 5xx/transport thì trả `SERVICE_UNAVAILABLE`/`UNCONFIRMED`, không có retry hay trạng thái ambiguous. Chấp nhận được vì upload chưa mount (G2), nhưng cần ghi rõ trong docs flow để controller G2 không coi 5xx là thất bại terminal.

### Assessment

Phần lớn ràng buộc được thực thi bằng code và có test hành vi thật: transport, freeze body/key, secret chỉ ở memory, các nhánh expiry/logout/tombstone, parser SSE và cursor BigInt. Lỗ hổng còn lại nằm ở việc phân loại lỗi 4xx của `mutate`. CSRF cũ (thực tế xảy ra khi owner đăng nhập ở tab khác) làm nhả idempotency key của operation có thể đã commit. Đây đúng là đường dẫn tới duplicate action mà brief xếp rủi ro H×H.

**Task quality:** Needs fixes
