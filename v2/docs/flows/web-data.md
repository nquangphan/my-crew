# Transport, phiên owner và đồng bộ sự kiện web Crew v2

## Mục đích

Lớp dữ liệu của `v2/web` gửi mọi request owner tới `/v2/` cùng origin. Nó giữ phiên đăng nhập và mã CSRF trong bộ nhớ, giữ nguyên khóa gửi lại cho mutation chưa xác nhận, và dùng event journal để đánh dấu query cũ. Login/reauth và panel “Tiếp tục yêu cầu chưa xác nhận” thuộc flow này. Controller nối các thành phần vào router/shell ở bước sau.

## Điểm vào

- `web/src/auth/session-boundary.tsx` → `SessionBoundary`: chặn route được bảo vệ. Guest thấy đăng nhập, phiên hết hạn thấy đăng nhập lại, owner đã xác thực thấy `RecoveryPanel` và nội dung.
- `web/src/auth/session-boundary.tsx` → `wireSession`: nối vòng đời phiên với `PendingStore`, cache và `EventSync` cho mỗi lần mount app.

## Các bước

1. `web/src/lib/session.ts` → `SessionController.bootstrap`: GET `/v2/auth/session` đúng một lần, kể cả khi StrictMode gọi hai lần. Nếu được 200 thì phiên `authenticated`. Nếu được 401 thì `guest`. Nếu được 503 `OWNER_NOT_BOOTSTRAPPED` thì `guest` kèm thông báo máy chủ chưa khởi tạo owner.
2. `web/src/auth/login.tsx` → `LoginScreen`: mật khẩu 1–4096 ký tự, chỉ nằm trong state của form và bị xóa sau mỗi request hoặc khi đóng form. `SessionController.login` gửi POST `{password}`; trình duyệt tự gắn Origin, request không có CSRF hay Idempotency-Key. Sau đó web GET lại session để xác minh đúng `owner`. Lỗi 401, 429, 503 hoặc mất kết nối hiện thành thông báo, và 429 không tự gửi lại. `safeReturnPath` chỉ chấp nhận path nội bộ `/crew-v2/`.
3. `web/src/lib/pending-operation.ts` → `PendingStore.begin`: `bodyJson` được serialize một lần và đóng băng. `id` vừa là Idempotency-Key vừa giữ `intentId`/`ownerId`. Mỗi intent chỉ có một khóa chưa giải quyết. Khóa mới chỉ được cấp sau khi khóa cũ đã được xác nhận hoặc bị từ chối hẳn. Payload thường dùng `storage: 'tab'` và lưu trong sessionStorage `crew-v2:pending` version 1. Payload có key dạng password/secret/token/credential/apiKey bắt buộc dùng `memory`. `serializePending` từ chối operation memory, secret, token và hash của secret.
4. `web/src/lib/api.ts` → `createOwnerClient`: GET chỉ nhận path `/v2/...` mà URL parser giữ nguyên byte; request gửi kèm cookie same-origin và signal của epoch phiên. Mutation gửi đúng `bodyJson`, `X-CSRF-Token` và `Idempotency-Key = id`. Lỗi transport, abort, 5xx hoặc 2xx không đọc được đưa operation về `ambiguous` và giữ khóa. Client gửi lại cùng key/body tối đa 3 lần với backoff 1/2/4 giây, rồi báo “Chưa xác nhận”. 4xx là từ chối cuối và giải phóng khóa. `IDEMPOTENCY_CONFLICT` giữ operation, hoặc trả nó về tombstone nếu payload vừa được nhập lại. Upload bytes dùng PUT octet-stream kèm CSRF, không có Idempotency-Key.
5. Mọi phản hồi 401 gọi `SessionController.expire`. Bước này hủy GET và stream của epoch, xóa CSRF, xóa cache owner, chặn write và chuyển operation chưa giải quyết sang `suspended` mà vẫn giữ key/body. Payload secret chỉ nằm trong bộ nhớ của tab. Màn hình đăng nhập lại không hiển thị payload. Sau khi owner đăng nhập lại đúng owner, panel “Tiếp tục yêu cầu chưa xác nhận” cho owner chủ động gửi lại cùng key/body với CSRF mới; server vẫn authorize route trước khi replay.
6. `SessionController.logout`: gửi DELETE kèm CSRF, rồi hủy request/stream và xóa cache, kể cả khi DELETE thất bại. `PendingStore.tombstoneAll` chỉ giữ `RecoveryTombstone` gồm key, intent, owner, method, path, target UUID trong path và `expectedRevision`. Tombstone không chứa title, text, file, secret hay response. Reload tab hoặc đóng form secret (`discardMemory`) cũng biến operation memory thành tombstone. Owner phải nhập lại đúng nội dung (`PendingStore.resume`) để gửi bằng khóa cũ. Nếu không nhập lại được, panel giữ dòng “Chưa thể xác nhận yêu cầu cũ”; web không tự tra receipt.
7. `web/src/lib/events.ts` → `EventSync.start`: mỗi app/phiên chỉ có một vòng đồng bộ, và vòng này phải chạy trước GET dữ liệu đầu tiên. Bước catch-up đọc `/v2/events?after=<applied>&limit=100` tới khi trang rỗng. Sau đó web mở stream `/v2/events/stream` bằng fetch, gửi `Last-Event-ID`. `SseParser` giải mã UTF-8 strict theo từng chunk, nhận CRLF/CR/LF và comment, và giới hạn mỗi frame 1 MiB. Frame hỏng (JSON sai, `event:` khác `type`, `id` khác `cursor`, vượt giới hạn) làm đóng stream rồi resync. Backoff tăng tới 30 giây; sau `maxFailures` lần lỗi, trạng thái thành `failed` để owner thử lại.
8. `compareCursor` so sánh cursor bằng BigInt nên cursor lớn hơn `Number.MAX_SAFE_INTEGER` vẫn chính xác. Event trùng hoặc đến sai thứ tự bị bỏ qua. `invalidations` ánh xạ type đã review sang prefix query (`queryRoots`). Type lạ được invalidate rộng theo thứ tự ticket → project → máy → toàn bộ cache, không bị bỏ qua. Cursor chỉ được ghi sau khi invalidation đã vào hàng đợi. Nếu invalidation lỗi, nó ở lại hàng đợi và được thử lại. Mỗi lần nối lại, web invalidate `['v2']` để refetch view hiện tại.
9. `web/src/lib/api.ts` → `LatestRequest` hủy GET cũ khi view bắt đầu GET mới. `web/src/contracts/tickets.ts` → `newerTicket` từ chối row có revision cũ hơn. Graph luôn được refetch nguyên root; client không vá một phần cạnh.

## Dữ liệu

`web/src/contracts/*.ts` mirror DTO producer tại HEAD: Session/Event (`server/src/platform/contracts.ts:13`, `auth/routes.ts:141`), Ticket/Dependency/RepairLink/graph/comment/decision (`tickets/contracts.ts:8-47`, `service.ts:28`), docs tree/page/search (`docs/read.ts:9,21`, `search.ts:8`), Machine/Project/model sources desired+applied/pool (`auth/machine.ts:7`, `projects/service.ts:13`, `models/config.ts:108`, `models/contracts.ts:40`) và attachment (`attachments/contracts.ts:28-56`, chưa mount production tới G2). Decoder runtime từ chối field thiếu, sai primitive và field lạ; field bổ sung chỉ được nhận khi khai báo `additive` sau review. Gateway status chưa có decoder vì DTO còn chờ G4.

Lifetime: mỗi app có một `SessionController` và một `EventSync`; cache bị xóa khi phiên kết thúc; `PendingStore` sống theo tab; mỗi request có `AbortController` riêng. Password, CSRF, token máy và secret API không vào query cache, logger hay storage. Query key luôn bắt đầu bằng `'v2'`. Khi nối wiring, controller nên tắt retry mặc định của TanStack Query cho các query dùng `OwnerClient.get`, vì client đã tự retry tối đa 3 lần.

## Flow liên quan

`web-shell.md` sở hữu shell, router và fixture. `server-identity.md` định nghĩa route session. `server-journal.md` định nghĩa idempotency, event và SSE.

## Tests

- `web/test/client.test.ts`, `web/test/events.test.ts`, `web/test/auth-recovery.test.ts`: RED đầu tiên trên deny scaffold có 30/31 test thất bại theo hành vi, ví dụ cursor `9007199254740993` so với `…992` trả 0 thay vì 1. Sau triển khai, 31/31 PASS; toàn bộ web unit 38/38.
- `web/e2e/auth.spec.ts` chạy trên PostgreSQL 18.6, API và Vite thật của fixture Task1. Kịch bản đầu: server commit rồi response bị cắt; phiên bị hết hạn qua DB fixture; owner đăng nhập lại cùng owner; panel gửi lại cùng key/body với CSRF mới. Kết quả có đúng một project, một receipt idempotency và một event `project.created`; write bị chặn khi hết phiên; screenshot login/expired/recovery được lưu. Kịch bản thứ hai kiểm logout chỉ để lại tombstone, nhập payload khác với cùng key bị 409 mà tombstone vẫn giữ, nhập lại đúng thì được chấp nhận, và secret không vào sessionStorage.
- `web/e2e/events.spec.ts` chạy SSE thật qua proxy `/v2`: catch-up `after=0` rồi stream; event `project.created` invalidate query project; cursor khớp DB; phiên hết hạn trong DB thì server đóng stream, client dừng ở `expired`; sau khi đăng nhập lại, web catch-up từ cursor đã áp dụng và gửi `Last-Event-ID` đúng cursor đó.
