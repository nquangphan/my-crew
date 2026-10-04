# Review: web controller integration (2b101ec^ → 2b101ec)

Phạm vi: đọc diff + `app-runtime.ts`, `session.ts`, `e2e-fixture.ts` đầy đủ quanh chỗ sửa; không chạy lại test. Mọi nhận định về kết quả chạy lấy từ report, chưa kiểm.

### Spec Compliance

1. Router: ✅ `/projects/$projectId/tickets` (search `view/status/kind/rootId` qua `parseTicketsSearch`, TicketBoard/TicketList/RequestList, một `TicketDialog` qua `useTicketDialog`), `/tickets/$ticketId`, `/projects/$projectId/docs`, nav "Tài liệu"; cả ba route nằm dưới `protectedRoute` (`authorizeRoute` trong `beforeLoad`). ID không phải UUID hoặc UUID lạ hiện view 404, không bỏ filter project. ⚠️ RequestList là `view=requests` của route tickets, không phải route riêng (đúng với "mount ... RequestList", chưa chắc đúng với "RequestList route").
2. Providers: ✅ `ComposeServicesProvider` + `TicketDraftStorageProvider` nằm trong `ProtectedLayout`, dùng `runtime.composeServices` (cùng client/pending/session/storage của đúng một runtime/QueryClient mỗi mount). ✅ `session.onLogout(() => clearTicketDrafts(storage))` trong `createAppRuntime`, có `offLogout` ở `dispose`. ✅ Test (a) và (b) có ở unit lẫn E2E. ⚠️ Test (b) về bản chất vacuous (guest không ghi nháp; wipe đã xảy ra ở logout). ⚠️ Hết phiên (`expire`) không xóa nháp (hook chỉ chạy trong `logout()`); khớp ghi chú "hết phiên giữ nháp" của report nhưng tôi không thấy ruling PM cho riêng việc này.
3. Harness: ✅ `buildApp({attachments})`, scratch riêng `crew-v2-web-attachments-*` đăng ký resource `scratch`, xóa trước scratch chính, UNKNOWN giữ lại, `storageHostId` chữ thường, lifecycle assert registry/tồn tại/401/`removed`. ⚠️ Receivers port macOS là bản sao 121 dòng, không test nào chạy qua nó (xem I1).
4. app-router: ✅ assert `GET /v2/events` là GET đầu tiên sau phiên xác minh và `GET /v2/tickets/<id>` đứng sau. Vì `afterLogin[0]` phải là catch-up nên GET `/v2/projects` của sidebar cũng bị phủ gián tiếp (báo cáo nói "chưa có assert đích danh" là quá khiêm tốn, nhưng cũng chưa đủ rõ).
5. E2E: ✅ ticket-routes (deep link, reload, 404, UUID sai, URL state, dialog, back link, nháp). ⚠️ docs E2E chỉ khẳng định trạng thái "Không hợp lệ" từ legacy import, không có snapshot hiện hành/stale; chấp nhận được với điều kiện "nếu có đường seeding production", nhưng độ phủ docs thấp. ⚠️ E2E S3b text-only create-request chưa viết dù fixture đã mở khả năng đó.

### Harness invariants

- Owned resource registry: ✅ `record(attachmentScratchResource)` với dev:ino, nonce; test lifecycle khẳng định resource có trong `handle.resources`.
- UNKNOWN retention: ✅ nhánh `blocked` đẩy UNKNOWN cho cả attachment scratch và scratch chính, không `rm`; nếu attachment scratch UNKNOWN thì scratch chính (giữ registry) cũng UNKNOWN và return sớm.
- Deadline fence: ✅ attachment scratch dùng lại `createScratchRemoval` (fence `signal.aborted` sau `stat` của FIX2) và `closeOwnedResource`, không tự viết `rm`. ⚠️ Không có test riêng cho đường UNKNOWN/deadline của attachment scratch (xem M1).
- Không destructive sau deadline: ✅ bước mới chỉ chạy sau `phase='stopped'`, không đụng container/DB.
- No fake authority: ⚠️ trên Linux dùng writer native (chuẩn). Trên macOS dùng port tự dựng phát `closed-ack` với `linuxBootId/procNamespaceInode/startTicks='fixture-only'`, `proveStopped` đọc từ Map trong bộ nhớ. Không chạm đường production (`main.ts` chưa nối) và nằm trong DB của fixture, nhưng đây là "proof" không có bằng chứng native, đúng thứ invariants cấm đưa thành authority; chỉ chấp nhận được khi nó được chứng minh là không bao giờ được kiểm đường upload thật. Hiện chẳng test nào chạy nó.

### Strengths

- Không tự viết lại logic xóa scratch; tái dùng helper đã có fence.
- Wipe nháp đặt ở runtime (không phụ thuộc component đã mount), bắt đúng sót "reload không mở ticket".
- `routeUuid` chặn việc `projectId` sai làm rơi filter project (không lộ ticket mọi dự án).
- Assert thứ tự catch-up chặt (`afterLogin[0]`), không có đường vacuous (`indexOf` = -1 sẽ fail).

### Issues

**Critical:** không có.

**Important**

- I1 `v2/web/scripts/e2e-attachment-receivers.ts:1-121` (và `e2e-fixture.ts` nhánh `process.platform === 'linux' ? {} : …`): một cổng closed-ACK song song được sao chép từ fixture server test, chỉ chạy trên macOS, không có bất kỳ test hay E2E nào đi qua (không upload nào được thực hiện; lifecycle chỉ kiểm 401). Hệ quả: Linux/CI và macOS chạy hai đường writer khác nhau; code phát proof giả danh tính (`'fixture-only'`) không được kiểm, dễ drift khỏi `ManagedReceiverRegistry` thật (đã có bản sao ở server test). Fix: hoặc export fixture receivers từ một nơi duy nhất mà server test và web fixture cùng import (DRY), hoặc thêm một test chạy `register→run→closeAndAcknowledge→proveStopped` trên đúng port này; ghi rõ trong docs flow rằng macOS không chứng minh native process-gone.

**Minor**

- M1 `e2e-fixture.ts` (khối "Attachment storage goes first"): wiring UNKNOWN của attachment scratch (propagate sang scratch chính, `phase='unknown:ATTACHMENT_SCRATCH_REMOVE'`) chưa có regression test; chỉ happy path `removed` được assert. Fix: test đơn vị với port `rm`/`stat` trì hoãn như FIX2, hoặc test fault-injection cho nhánh này.
- M2 `e2e-fixture.ts` quanh `mkdtemp(... 'crew-v2-web-attachments-')`: giữa `mkdtemp` và `record()` có cửa sổ thư mục chưa đăng ký nếu `record`/`stat` ném lỗi (scratch chính được push vào `resources` ngay từ đầu). Fix: đăng ký resource trước khi dựa vào nó, hoặc `rm` đúng path vừa tạo trong catch.
- M3 `test/ticket-routes.test.ts` ("after logout, a reload as guest ..."): assert `storage.map.size === 0` đúng ngay cả khi không có logic nào ngoài lần wipe đầu; không phát hiện regression "guest tạo nháp". Fix: mô phỏng mount guest route nhập liệu, hoặc bỏ test dư và giữ E2E (b).
- M4 `app-router.spec.ts`: cho phép `afterLogin[0]==='GET /v2/events'` nhưng không có assert đích danh cho `GET /v2/projects` của sidebar; nếu sau này có GET khác chèn trước, thông báo lỗi sẽ không nói rõ. Fix: thêm assert `projects` sau catch-up.
- M5 `e2e-fixture.ts`: `randomUUID().toLowerCase()` thừa (UUID sinh ra đã chữ thường); và `register` của port macOS dùng `String(upload?.ownership_nonce)` có thể thành chuỗi `'undefined'` khi không có dòng upload.

### Assessment

Phần router, provider, wipe nháp và harness lifecycle đúng bất biến chính (registry, UNKNOWN, fence tái dùng); rủi ro lớn nhất là port macOS dựng thêm, không test, mang proof không native. Việc vi phạm quy trình (chạy nặng trước telemetry) không sửa được bằng code; ghi nhận. E2E S3b và docs hiện hành là phạm vi còn hở có chủ đích.

**Task quality:** Needs fixes (I1; M1–M2 nên sửa cùng vòng)
