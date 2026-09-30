# Bảng tra API

> Đây là **bảng tra**, không phải đặc tả đầy đủ: mỗi endpoint một dòng, chi tiết request/response dẫn về schema
> zod trong `packages/shared/src` và trang flow sở hữu route đó. Khi cần chi tiết hành vi, đọc trang flow.

## Tổng quan

- Base path: `/v1`. API dựng bằng Fastify tại `apps/api/src/app.ts` (flow [`api-platform`](../flows/api-platform.md)).
- Ba nhóm route:
  - **public**: không cần xác thực (`GET /v1/health`, `POST /v1/auth/login`, `POST /v1/machines/pair`).
  - **owner**: chủ dự án, xác thực bằng session cookie `crew_session`.
  - **daemon**: máy cục bộ (`crewd`), xác thực bằng header `Authorization: Bearer <token>`.
- Cookie owner và bearer daemon **không bao giờ dùng lẫn trên cùng route**: nhóm owner chỉ đọc cookie
  (bearer bị bỏ qua), nhóm daemon chỉ đọc header `Authorization` (cookie bị bỏ qua). Route
  `GET /v1/auth/session`, `POST /v1/auth/password`, `POST /v1/auth/logout` (trong `auth-routes.ts`) tự áp cùng
  guard owner qua option route thay vì nằm trong nhóm `owner` của `app.ts`, nhưng hành vi xác thực giống hệt.

## Xác thực owner

- Đăng nhập một bước (`POST /v1/auth/login`) cấp session cookie `crew_session` (`httpOnly`, `sameSite=lax`)
  và cookie `crew_csrf` (đọc được từ JS). Session có TTL tuyệt đối 7 ngày và TTL rảnh (idle) 12 giờ, quét dọn
  session hết hạn mỗi giờ.
- CSRF: với method "mutating" (`POST`/`PUT`/`PATCH`/`DELETE`), guard owner kiểm thêm `Origin` (phải nằm trong
  danh sách cho phép) và token CSRF double-submit — header `x-csrf-token` (hằng số `CSRF_HEADER`) phải khớp cả
  cookie `crew_csrf` lẫn token ký theo session. Method `GET` không cần CSRF.
- Giới hạn tần suất đăng nhập: `POST /v1/auth/login` và `POST /v1/auth/password` dùng chung một giới hạn theo
  IP, biến môi trường `LOGIN_RATE_LIMIT_PER_MINUTE` (mặc định 5/phút).
- Chi tiết luồng đăng nhập, đổi mật khẩu, đăng xuất: xem flow [`owner-auth`](../flows/owner-auth.md).

## Xác thực máy (daemon)

- Ghép máy: đổi một mã pairing dùng một lần lấy token máy dạng `crew_mt_...` (`POST /v1/machines/pair`,
  public, giới hạn 10 lần/phút theo IP). Owner tạo mã pairing qua `POST /v1/machines/pairing-codes`
  (giới hạn 5 lần/phút).
- Mọi route daemon xác thực bằng header `Authorization: Bearer <token>`, kiểm token chưa bị thu hồi và chưa hết
  hạn trên từng request; máy bị thu hồi (`POST /v1/machines/:id/revoke`) mất quyền ngay.
- Không ghi token thật hay chuỗi giống token vào ticket, bình luận hay tài liệu — chỉ mô tả dạng `crew_mt_...`.
- Chi tiết vòng đời token, ghép máy, thu hồi: xem flow [`machine-pairing`](../flows/machine-pairing.md).

## Định dạng lỗi

Body lỗi luôn có dạng:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "details": {} } }
```

`details` chỉ xuất hiện khi có. Bảng mã lỗi → HTTP status (`apps/api/src/errors.ts`, `STATUS_BY_CODE`):

| Status | Mã lỗi |
|---|---|
| 400 | `VALIDATION_FAILED`, `PM_NOT_AVAILABLE`, `IDEMPOTENCY_KEY_REQUIRED` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN`, `CSRF_FAILED` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT`, `ILLEGAL_TRANSITION`, `REPORT_REQUIRED`, `BUDGET_HOLD`, `CHILD_CAP_EXCEEDED`, `BUDGET_EXCEEDED`, `BUG_CYCLE_CAP`, `PARENT_CLOSED`, `TICKET_CLOSED`, `QC_ALREADY_PAIRED` |
| 413 | `ATTACHMENT_TOO_LARGE` |
| 422 | `INVALID_HIERARCHY`, `INVALID_DEPENDENCY`, `IDEMPOTENCY_KEY_REUSED` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL` |

`sendApiError()` là handler lỗi dùng chung cho toàn app và cho handler riêng của `attachmentRoutes` (bắt
`FST_ERR_CTP_BODY_TOO_LARGE` của Fastify trước khi rơi về logic chung).

## Idempotency

- Áp dụng cho **mọi route ghi của nhóm daemon**, trừ `POST /v1/daemon/token/rotate` (response là secret, không
  được lưu lại) và `POST /v1/daemon/heartbeat` (bản thay toàn trạng thái mỗi 30 giây, không phải "ghi" theo
  nghĩa tạo/sửa dữ liệu nghiệp vụ). Route `GET` (daemon lẫn owner) không dùng idempotency. Route owner không có
  cơ chế idempotency.
- Header bắt buộc: `Idempotency-Key` (hằng số `IDEMPOTENCY_KEY_HEADER`).
  - Thiếu header → `IDEMPOTENCY_KEY_REQUIRED` (400).
  - Dùng lại key với request khác (fingerprint = method + path cụ thể + hash body) → `IDEMPOTENCY_KEY_REUSED`
    (422).
  - Dùng lại đúng fingerprint → phát lại response đã lưu, kèm header `idempotent-replayed: true`. Response được
    lưu tối đa 7 ngày.
- Chi tiết cơ chế, khoá theo `(machineId, key)`, khoá advisory chống race: xem flow
  [`daemon-api`](../flows/daemon-api.md).

## Realtime (SSE)

- `GET /v1/daemon/stream` (daemon): chỉ sự kiện nhắm đúng máy gọi. Cursor qua header `Last-Event-ID` hoặc query
  `?cursor=`; mặc định `0` (phát lại từ đầu).
- `GET /v1/stream` (owner): mọi sự kiện. Cùng cơ chế cursor; không có cursor thì bắt đầu từ sự kiện mới nhất
  (`bus.currentSeq`), không phát lại lịch sử.
- Cả hai stream re-check quyền (session/token) theo mỗi heartbeat; máy bị thu hồi hoặc session hết hạn đóng
  stream ngay.
- `GET /v1/notices`, `POST /v1/notices/read`, `POST /v1/notices/read-all` (owner) không phải SSE — là API đọc
  và đánh dấu thông báo (inbox) thông thường.
- Chi tiết event bus, heartbeat, cơ chế LISTEN/NOTIFY + poll dự phòng: xem flow
  [`event-delivery`](../flows/event-delivery.md).

## Bảng endpoint

Ký hiệu cột **Xác thực**: `public` = không cần đăng nhập; `owner` = session cookie, CSRF bắt buộc khi method
mutating (`GET` không cần CSRF, ghi `owner (no CSRF)`); `daemon` = bearer token, route ghi cần header
`Idempotency-Key` trừ khi ghi chú khác.

### 1. Xác thực

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| POST | `/v1/auth/login` | public (kiểm Origin, rate-limit theo IP) | Đăng nhập owner một bước | [owner-auth](../flows/owner-auth.md) |
| GET | `/v1/auth/session` | owner (no CSRF) | Đọc phiên hiện tại kèm `csrfToken` | [owner-auth](../flows/owner-auth.md) |
| POST | `/v1/auth/password` | owner (CSRF, rate-limit như login) | Đổi mật khẩu, xoay session, đăng xuất thiết bị khác | [owner-auth](../flows/owner-auth.md) |
| POST | `/v1/auth/logout` | owner (CSRF) | Đăng xuất, xoá session | [owner-auth](../flows/owner-auth.md) |

### 2. Máy — ghép, quản lý, token, heartbeat

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| POST | `/v1/machines/pair` | public (rate-limit 10/phút theo IP) | Đổi mã pairing lấy token máy | [machine-pairing](../flows/machine-pairing.md) |
| POST | `/v1/machines/pairing-codes` | owner (CSRF, rate-limit 5/phút) | Owner tạo mã pairing | [machine-pairing](../flows/machine-pairing.md) |
| GET | `/v1/machines` | owner (no CSRF) | Danh sách máy | [machine-pairing](../flows/machine-pairing.md) |
| GET | `/v1/machines/:id` | owner (no CSRF) | Chi tiết một máy | [machine-pairing](../flows/machine-pairing.md) |
| POST | `/v1/machines/:id/revoke` | owner (CSRF) | Thu hồi máy | [machine-pairing](../flows/machine-pairing.md) |
| POST | `/v1/machines/:id/claims` | owner (CSRF) | Owner gán thẳng project/assistant cho máy | [machine-pairing](../flows/machine-pairing.md) |
| GET | `/v1/claim-requests` | owner (no CSRF) | Danh sách yêu cầu claim chờ duyệt | [machine-pairing](../flows/machine-pairing.md) |
| POST | `/v1/claim-requests/:id/approve` | owner (CSRF, rate-limit 5/phút) | Duyệt yêu cầu claim | [machine-pairing](../flows/machine-pairing.md) |
| POST | `/v1/claim-requests/:id/reject` | owner (CSRF, rate-limit 5/phút) | Từ chối yêu cầu claim | [machine-pairing](../flows/machine-pairing.md) |
| POST | `/v1/daemon/token/rotate` | daemon (không cần `Idempotency-Key` — response là secret) | Xoay token máy | [daemon-api](../flows/daemon-api.md) |
| POST | `/v1/daemon/heartbeat` | daemon (không cần `Idempotency-Key` — thay toàn trạng thái) | Heartbeat: tài nguyên, job, settings, runtime | [daemon-api](../flows/daemon-api.md) |
| PUT | `/v1/daemon/skills` | daemon (`Idempotency-Key`) | Ghi đè kho skill/MCP máy báo cáo | [daemon-api](../flows/daemon-api.md) |
| POST | `/v1/daemon/claims` | daemon (`Idempotency-Key`) | Máy claim project/assistant | [daemon-api](../flows/daemon-api.md) |
| DELETE | `/v1/daemon/claims/assistant` | daemon (`Idempotency-Key`) | Máy trả vai trò assistant | [daemon-api](../flows/daemon-api.md) |
| DELETE | `/v1/daemon/claims/:projectKey` | daemon (`Idempotency-Key`) | Máy trả một project | [daemon-api](../flows/daemon-api.md) |

### 3. Dự án

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| GET | `/v1/projects` | owner (no CSRF) | Danh sách project | [project-claims](../flows/project-claims.md) |
| POST | `/v1/projects` | owner (CSRF) | Tạo project | [project-claims](../flows/project-claims.md) |
| GET | `/v1/projects/:id` | owner (no CSRF) | Chi tiết project | [project-claims](../flows/project-claims.md) |
| PATCH | `/v1/projects/:id` | owner (CSRF) | Sửa project | [project-claims](../flows/project-claims.md) |
| GET | `/v1/project-change-requests` | owner (no CSRF) | Danh sách yêu cầu đổi platform/MCP test UI | [project-claims](../flows/project-claims.md) |
| POST | `/v1/project-change-requests/:id/approve` | owner (CSRF, rate-limit 5/phút) | Duyệt đổi platform/MCP | [project-claims](../flows/project-claims.md) |
| POST | `/v1/project-change-requests/:id/reject` | owner (CSRF, rate-limit 5/phút) | Từ chối đổi platform/MCP | [project-claims](../flows/project-claims.md) |
| GET | `/v1/daemon/projects` | daemon | Danh sách project theo góc nhìn máy | [daemon-api](../flows/daemon-api.md) |
| POST | `/v1/daemon/projects` | daemon (`Idempotency-Key`) | Máy tạo project mới từ thư mục cục bộ | [daemon-api](../flows/daemon-api.md) |
| POST | `/v1/daemon/projects/:projectKey/change-requests` | daemon (`Idempotency-Key`) | Máy xin đổi platform/MCP test UI | [daemon-api](../flows/daemon-api.md) |
| GET | `/v1/projects/catalog` | daemon (chỉ máy host assistant) | Danh sách rút gọn dùng để định tuyến ticket | [daemon-api](../flows/daemon-api.md) |
| PUT | `/v1/daemon/projects/:projectKey/bmad-profile` | daemon (`Idempotency-Key`, chỉ máy sở hữu project) | Máy báo cáo hồ sơ cài BMAD | [daemon-api](../flows/daemon-api.md) |

### 4. Ticket

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| GET | `/v1/tickets` | owner (no CSRF) | Danh sách ticket (lọc, phân trang), kèm `agentActivity` | [ticket-lifecycle](../flows/ticket-lifecycle.md) |
| POST | `/v1/tickets` | owner (CSRF) | Owner tạo ticket `request` | [ticket-lifecycle](../flows/ticket-lifecycle.md) |
| GET | `/v1/tickets/:id` | owner (no CSRF) | Chi tiết ticket + con, kèm `agentActivity` | [ticket-lifecycle](../flows/ticket-lifecycle.md) |
| GET | `/v1/tickets/:id/tree` | owner (no CSRF) | Toàn bộ hậu duệ (tối đa 1000 dòng) | [ticket-lifecycle](../flows/ticket-lifecycle.md) |
| PATCH | `/v1/tickets/:id` | owner (CSRF) | Owner sửa tiêu đề/mô tả/ưu tiên | [ticket-lifecycle](../flows/ticket-lifecycle.md) |
| POST | `/v1/tickets/:id/transition` | owner (CSRF) | Owner chuyển trạng thái ticket | [ticket-lifecycle](../flows/ticket-lifecycle.md) |
| GET | `/v1/search` | owner (no CSRF) | Tìm kiếm nhanh ticket và docs | [ticket-lifecycle](../flows/ticket-lifecycle.md) |
| GET | `/v1/daemon/tickets/:id` | daemon (phạm vi đọc rộng hơn phạm vi ghi) | Agent đọc chi tiết ticket | [daemon-api](../flows/daemon-api.md) |
| GET | `/v1/daemon/budget/:id` | daemon | Trạng thái ngân sách của ticket | [daemon-api](../flows/daemon-api.md) |
| POST | `/v1/daemon/tickets` | daemon (`Idempotency-Key`) | Agent tạo subtask (`pm_task`/`dev`/`qc`/`docs_init`) | [daemon-api](../flows/daemon-api.md) |
| POST | `/v1/daemon/tickets/:id/comments` | daemon (`Idempotency-Key`) | Agent bình luận (`actor='agent'`) | [daemon-api](../flows/daemon-api.md) |
| POST | `/v1/daemon/tickets/:id/transition` | daemon (`Idempotency-Key`) | Agent chuyển trạng thái | [daemon-api](../flows/daemon-api.md) |
| PUT | `/v1/daemon/tickets/:id/report` | daemon (`Idempotency-Key`) | Agent nộp report | [daemon-api](../flows/daemon-api.md) |
| POST | `/v1/daemon/tickets/:id/bugs` | daemon (`Idempotency-Key`) | QC báo lỗi, hoặc PM từ chối việc, tạo ticket `bug` | [daemon-api](../flows/daemon-api.md) |
| POST | `/v1/daemon/tickets/:id/rate-subtask` | daemon (`Idempotency-Key`) | PM chấm hoặc chấm lại `complexity` một subtask | [daemon-api](../flows/daemon-api.md) |
| POST | `/v1/daemon/tickets/:id/retry-subtask` | daemon (`Idempotency-Key`) | PM mở lại một subtask `blocked` | [daemon-api](../flows/daemon-api.md) |
| PATCH | `/v1/daemon/tickets/:id/agent-meta` | daemon (`Idempotency-Key`) | Daemon ghi agentSessionId/model/effort/chi phí delta | [daemon-api](../flows/daemon-api.md) |

### 5. Bình luận

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| POST | `/v1/tickets/:id/comments` | owner (CSRF) | Owner bình luận (có thể tag `@pm`) | [ticket-lifecycle](../flows/ticket-lifecycle.md) |

### 6. Report

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| GET | `/v1/tickets/:id/report` | owner (no CSRF) | Đọc report hiện hành và mọi bản cũ | [ticket-lifecycle](../flows/ticket-lifecycle.md) |

### 7. Ảnh đính kèm

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| POST | `/v1/tickets/:id/attachments` | owner (CSRF, `bodyLimit` riêng lớn hơn mặc định) | Upload ảnh dán clipboard (whitelist mime, tối đa 10MB) | [ticket-lifecycle](../flows/ticket-lifecycle.md) |
| POST | `/v1/attachments` | owner (CSRF, `bodyLimit` riêng lớn hơn mặc định) | Upload ảnh nháp trước khi ticket tồn tại (`ticket_id` null, gắn khi tạo ticket hoặc dọn sau 24 giờ nếu bỏ quên) | [ticket-lifecycle](../flows/ticket-lifecycle.md) |
| GET | `/v1/attachments/:id` | owner (no CSRF) | Đọc lại bytes ảnh đã upload | [ticket-lifecycle](../flows/ticket-lifecycle.md) |

### 8. Docs

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| GET | `/v1/docs` | owner (no CSRF) | Trang chủ docs: trạng thái mọi project | [docs-sync-viewer](../flows/docs-sync-viewer.md) |
| GET | `/v1/docs/search` | owner (no CSRF) | Tìm kiếm docs xuyên project | [docs-sync-viewer](../flows/docs-sync-viewer.md) |
| GET | `/v1/projects/:id/docs` | owner (no CSRF) | Cây trang docs một project | [docs-sync-viewer](../flows/docs-sync-viewer.md) |
| GET | `/v1/projects/:id/docs/page` | owner (no CSRF) | Nội dung một trang docs | [docs-sync-viewer](../flows/docs-sync-viewer.md) |
| GET | `/v1/projects/:id/docs/search` | owner (no CSRF) | Tìm kiếm docs trong một project | [docs-sync-viewer](../flows/docs-sync-viewer.md) |
| PUT | `/v1/daemon/projects/:key/docs` | daemon (`Idempotency-Key`, chỉ máy sở hữu, `bodyLimit` riêng) | Đồng bộ snapshot `docs/**` | [docs-sync-viewer](../flows/docs-sync-viewer.md) |

### 9. Cài đặt

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| GET | `/v1/settings` | owner (no CSRF) | Tổng quan cài đặt (prompt catalog, mặc định, bản đang dùng) | [server-settings](../flows/server-settings.md) |
| GET | `/v1/settings/history` | owner (no CSRF) | Lịch sử một key cài đặt | [server-settings](../flows/server-settings.md) |
| POST | `/v1/settings/validate` | owner (CSRF) | Validate nội dung trước khi lưu | [server-settings](../flows/server-settings.md) |
| POST | `/v1/settings` | owner (CSRF) | Lưu một bản cài đặt mới (`baseVersion` chống ghi đè) | [server-settings](../flows/server-settings.md) |
| GET | `/v1/settings/revisions/:id` | owner (no CSRF) | Đọc một bản cụ thể | [server-settings](../flows/server-settings.md) |
| GET | `/v1/settings/diff` | owner (no CSRF) | So khác hai bản | [server-settings](../flows/server-settings.md) |
| POST | `/v1/settings/revisions/:id/restore` | owner (CSRF) | Khôi phục một bản cũ thành bản mới | [server-settings](../flows/server-settings.md) |
| GET | `/v1/daemon/settings` | daemon (hỗ trợ `ETag`/`If-None-Match`, có thể trả 304) | Cài đặt hiệu lực cho máy | [server-settings](../flows/server-settings.md) |
| POST | `/v1/daemon/settings/import` | daemon (`Idempotency-Key`) | Máy tải cấu hình cục bộ lên lần đầu | [server-settings](../flows/server-settings.md) |
| PUT | `/v1/daemon/settings/project-folders/:projectKey` | daemon (`Idempotency-Key`) | Máy đặt thư mục một project | [server-settings](../flows/server-settings.md) |
| DELETE | `/v1/daemon/settings/project-folders/:projectKey` | daemon (`Idempotency-Key`) | Máy xoá thư mục một project | [server-settings](../flows/server-settings.md) |
| PUT | `/v1/daemon/settings/projects/:projectKey/mcp` | daemon (`Idempotency-Key`, chỉ máy sở hữu) | Máy tự đổi MCP tắt của project mình | [server-settings](../flows/server-settings.md) |

### 10. Lệnh máy

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| POST | `/v1/machines/:id/commands` | owner (CSRF) | Owner gửi một hành động (danh sách cố định) tới máy | [machine-control](../flows/machine-control.md) |
| GET | `/v1/machines/:id/commands` | owner (no CSRF) | Danh sách lệnh đã gửi cho máy | [machine-control](../flows/machine-control.md) |
| GET | `/v1/machines/:id/commands/:commandId` | owner (no CSRF) | Theo dõi một lệnh (poll tới khi xong) | [machine-control](../flows/machine-control.md) |
| POST | `/v1/daemon/commands/:commandId/start` | daemon (`Idempotency-Key`) | Daemon nhận lệnh | [machine-control](../flows/machine-control.md) |
| POST | `/v1/daemon/commands/:commandId/result` | daemon (`Idempotency-Key`) | Daemon báo kết quả hoặc lỗi | [machine-control](../flows/machine-control.md) |

### 11. Runtime

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| GET | `/v1/runtime/releases` | owner (no CSRF) | Danh sách bản runtime đã publish | [runtime-updates](../flows/runtime-updates.md) |
| GET | `/v1/runtime/latest` | owner (no CSRF) | Bản runtime mới nhất | [runtime-updates](../flows/runtime-updates.md) |
| POST | `/v1/runtime/releases` | owner (CSRF, `bodyLimit` riêng) | Owner tải bản ký lên thủ công | [runtime-updates](../flows/runtime-updates.md) |
| POST | `/v1/runtime/releases/import` | owner (CSRF) | Nhập release `runtime-v*` từ GitHub ngay | [runtime-updates](../flows/runtime-updates.md) |
| PUT | `/v1/machines/:id/runtime` | owner (CSRF) | Ghim hoặc bỏ ghim một máy vào một bản runtime | [runtime-updates](../flows/runtime-updates.md) |
| GET | `/v1/daemon/runtime` | daemon | Bản runtime máy nên chạy (kèm manifest/signature) | [runtime-updates](../flows/runtime-updates.md) |
| GET | `/v1/daemon/runtime/:version/bundle` | daemon | Tải tarball một bản | [runtime-updates](../flows/runtime-updates.md) |

### 12. Stream và thông báo

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| GET | `/v1/daemon/stream` | daemon | SSE sự kiện nhắm đúng máy, cursor `Last-Event-ID`/`?cursor=` | [event-delivery](../flows/event-delivery.md) |
| GET | `/v1/stream` | owner (no CSRF) | SSE mọi sự kiện, cursor `Last-Event-ID`/`?cursor=` | [event-delivery](../flows/event-delivery.md) |
| GET | `/v1/notices` | owner (no CSRF) | Danh sách thông báo (inbox) | [event-delivery](../flows/event-delivery.md) |
| POST | `/v1/notices/read` | owner (CSRF) | Đánh dấu một số thông báo đã đọc | [event-delivery](../flows/event-delivery.md) |
| POST | `/v1/notices/read-all` | owner (CSRF) | Đánh dấu tất cả đã đọc | [event-delivery](../flows/event-delivery.md) |

### 13. Hạ tầng chung

| Method | Path | Xác thực | Mục đích | Flow |
|---|---|---|---|---|
| GET | `/v1/health` | public | Health check (ping DB) | [api-platform](../flows/api-platform.md) |

**Tổng cộng 89 route**: 3 public, 54 owner, 32 daemon (đếm cả `GET /v1/health`).

## Schema

Request/response của các nhóm trên nằm trong schema zod ở `packages/shared/src` (đọc trực tiếp file, tài liệu
này không copy nội dung schema để tránh lỗi thời):

- `packages/shared/src/api-schemas.ts` — ticket/report/owner-auth cơ bản (`Ticket`, `CreateSubtaskRequest`,
  `RateSubtaskRequest`, `RetrySubtaskRequest`, `LoginRequest`, `SessionResponse`, `ChangePasswordRequest`,
  `MIN_PASSWORD_LENGTH`, `CSRF_HEADER`, `ApiErrorCode`, `ListTicketsQuery`, `SearchQuery`,
  `TicketTreeResponse`, `AttachmentMimeType`, `UploadAttachmentRequest`, `Attachment`).
- `packages/shared/src/ticket-schemas.ts` — `TicketStatus`/`TicketType`/`Actor`, `IDEMPOTENCY_KEY_HEADER`.
- `packages/shared/src/agent-schemas.ts` — role/complexity/model/effort, `RoleStage`, `DOCS_MODEL`.
- `packages/shared/src/status-workflow.ts` — `canTransition`, bảng cạnh trạng thái.
- `packages/shared/src/comment-mentions.ts` — parse tag `@pm`.
- `packages/shared/src/machine-schemas.ts` — pairing/heartbeat/inventory (`PairMachineRequest`,
  `HeartbeatRequest`, `PutSkillsRequest`, `InventoryMcpServer`, `WaitingJob`, `FailedJob`).
- `packages/shared/src/project-schemas.ts` — `CreateProjectRequest`, `UpdateProjectRequest`, `Project`,
  `qcDefaultMcps`, `McpServerName`.
- `packages/shared/src/bmad-schemas.ts` — `BmadProfile`, `BmadSetting`, `BmadPin`.
- `packages/shared/src/settings-schemas.ts` — mọi `SettingsKind`/`SettingsKey`, `GuardPolicy`, `ModelSettings`,
  `ResourceSettings`, `BudgetSettings`, `ProjectFolders`, `EffectiveSettings`, `MachineSettingsState`.
- `packages/shared/src/machine-command-schemas.ts` — `MachineCommandRequest` (discriminated union theo
  `action`), `MACHINE_COMMAND_RESULT`, `MACHINE_COMMAND_TIMEOUT_MS`, `MACHINE_COMMAND_TTL_MS`.
- `packages/shared/src/runtime-schemas.ts` — `RuntimeManifest`, `RuntimeShellRange`, `RUNTIME_SIGNING_KEYS`,
  `RUNTIME_LIMITS`, `MachineRuntimeState`, `DaemonRuntimeResponse`.
- `packages/shared/src/event-schemas.ts` — `EventPayload`, `EventEnvelope`, `STREAM_HEARTBEAT_MS`,
  `NOTICE_EVENT_TYPES`.
- `packages/shared/src/docs-schemas.ts` — `DocsSyncRequest`, `DocsPageQuery`, `DocsSearchQuery`,
  `CrossDocsSearchQuery`, `DOCS_SNAPSHOT_MAX_BYTES`.

## Ghi chú bảo trì

Khi thêm hoặc đổi route trong `apps/api/src/routes/*.ts` hay `apps/api/src/app.ts`, cập nhật bảng endpoint ở
trên **cùng lúc** với trang flow sở hữu file đó (`docs/flows/<id>.md`). Dùng `crew-docs where <file>` để biết
flow sở hữu một route file trước khi sửa.
