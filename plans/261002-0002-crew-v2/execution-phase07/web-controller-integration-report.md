# Web controller integration: route ticket/yêu cầu/tài liệu, ComposeServices, fixture attachment

Worktree `my-crew-v2`, nhánh `codex/crew-v2-server`, BASE `51ccdf8`, commit `2b101ec`. Node v24.21.0, pnpm 10.32.1.

## Đã làm

- Router: `/projects/$projectId/tickets?view=board|list|requests&status&kind&rootId`, `/projects/$projectId/docs?path=`, `/tickets/$ticketId`, đều sau `authorizeRoute`. Một `TicketDialog` mỗi trang (`useTicketDialog`). `projectId`/`ticketId` không phải UUID hiện view "Không tìm thấy" (không bỏ filter project); UUID không tồn tại hiện 404 của `TicketDetail`. Trang ticket có link quay lại danh sách. Deep link guest được chuyển tới login rồi quay về đúng path; reload giữ trang.
- Runtime: `AppRuntime.composeServices` (cùng client/pending/session/storage). `ProtectedLayout` bọc `ComposeServicesProvider` và `TicketDraftStorageProvider` (cùng storage). `session.onLogout` gọi `clearTicketDrafts(storage)`; hết phiên giữ nháp.
- Shell: sidebar "Dự án" đọc `GET /v2/projects` chỉ khi đã đăng nhập, mỗi dự án có link "Ticket" và "Tài liệu".
- Fixture: `buildApp({attachments})` với storage root riêng `crew-v2-web-attachments-*` (resource `scratch` trong registry, xóa trước scratch chính, UNKNOWN giữ lại), `storageHostId` UUID chữ thường, writer native trên Linux, cổng closed-ACK trong process (`e2e-attachment-receivers.ts`, sao từ fixture server test, không có bằng chứng process-gone native) trên macOS. Không truyền `extractorVersion` (503 `EXTRACTION_NOT_CONFIGURED` giữ nguyên) và không port nào khác.
- Lifecycle: thêm assert storage root nằm trong registry, tồn tại khi chạy, route policy trả 401 (đã mount), và bị xóa khi close (`removed`).
- E2E: app-router (GET ticket sau catch-up `/v2/events`), ticket-routes (deep link, reload, 404, UUID sai, URL state, dialog, view yêu cầu, quay lại, nháp khi logout hai đường), docs-assistant (cây Unicode, mở trang theo URL, link nội bộ, metadata commit/loại/audit, nav). Snapshot tài liệu seed qua `POST /v2/docs/imports` thật (bundle legacy, server tự kiểm checksum), không ghi DB trực tiếp.

## Kiểm chứng

| Hạng mục | Kết quả | Log |
|---|---|---|
| RED unit (route/search/compose chưa có) | 5/5 fail do thiếu hành vi | `web-int-red.log` |
| Unit toàn web `node --test test/*.test.ts` (gồm lifecycle 6) | exit 0 | `web-int-final.log` |
| Fixture lifecycle riêng | 6/6, storage root `removed` | `web-int-lifecycle.log` |
| `tsc --noEmit`, `vite build` | exit 0, exit 0 | `web-int-final.log` |
| E2E app-router, ticket-routes, docs-assistant, auth, events, tickets | 13 passed | `web-int-final.log` |
| Biome 13 file đã chạm | không lỗi (còn warning/info cũ trong e2e-fixture) | |
| `crew-docs generate/check --all` (bản sao v2 làm Git root) | ok | |

Mọi lần chạy nặng đi qua wrapper lấy lock, đọc `heavyEligible` rồi mới chạy (telemetry nằm đầu mỗi log); một lần đầu em chạy chưa chặn theo telemetry (đã báo PM).

## Giới hạn và việc còn lại

- E2E tạo yêu cầu text-only của S3b: spec chưa có (tickets.spec chỉ kiểm form mở/nháp), nên chưa chạy. Fixture đã mount attachments nên có thể viết ngay.
- Test xóa nháp khi logout viết sau code (không có RED riêng); độ phủ đã kiểm bằng unit (hai đường) và E2E trình duyệt.
- Phần Trợ lý của docs-assistant chưa làm (chờ producer G3). Legacy import cho audit "Không hợp lệ" và không có commit; E2E khẳng định đúng trạng thái đó, chưa có đường production để có snapshot "hiện hành"/stale (cần sync với attempt/fence).
- A5 file thật vẫn bị chặn bởi extractor (phase05 Task5); `main.ts` production chưa nối `attachments`.
- `GET /v2/projects` của sidebar chạy sau catch-up `/v2/events` (assert vẫn xanh), nhưng chưa có assert đích danh cho GET này.
- Có file `perl`, `perl.resource` lạ ở gốc repo, không phải của em.

## Fix round 1 (review `web-controller-integration-review.md`)

Mỗi mục có RED trước (`web-int-fix1-red.log`: fixture-scratch fail vì chưa có `closeScratches`/`createAttachmentScratch`; attachment-receivers fail do mutation `closed` → `writing` trong port, upload trả 409 `ATTACHMENT_UPLOAD_CONFLICT`), rồi GREEN.

- I1: không import chung được (fixture server không export, ngoài phạm vi sửa). Thêm `test/attachment-receivers.test.ts` chạy upload thật qua API (xác nhận receiver `closed` có `stop_proof`, writer `fixture-only` đúng khi non-Linux) và chạy trực tiếp register → run → closeAndAcknowledge → proveStopped (null khi chưa đóng, đóng lặp trả đúng proof, run lần hai bị từ chối). Docs flow ghi port không có bằng chứng native process-gone và không reachable từ production.
- M1: `closeScratches` tách ra, test deadline REMOVE của attachment scratch: cả hai UNKNOWN, `rm` không chạy, registry còn.
- M2: `createAttachmentScratch` xóa đúng thư mục vừa tạo nếu `realpath`/`stat` lỗi; có test.
- M3: xóa test unit guest-reload (vacuous), docs ghi chỉ E2E kiểm đường này.
- M4: assert đích danh `GET /v2/projects` sau catch-up trong `app-router.spec.ts`.
- M5 (ledger): bỏ `.toLowerCase()` thừa; port ném `FIXTURE_UPLOAD_NOT_FOUND` thay vì `'undefined'`.
- Docs: `session.expire()` giữ nháp, chỉ `logout()` xóa (ruling PM).

Kết quả: unit 226/226, tsc 0, E2E 13 passed (`web-int-fix1-*.log`). `crew-docs check --all` chỉ còn R2 của `server/src/assistant/tools.ts` (file chưa theo dõi của worker khác).
