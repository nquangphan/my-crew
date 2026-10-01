# Nền tảng API

> Flow `api-platform`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow api-platform` in
> ra đúng danh sách đó.

## Mục đích

Hạ tầng dùng chung cho toàn bộ API: khởi động tiến trình, cấu hình từ biến môi trường, lắp Fastify (plugin,
route, guard, error handler), kết nối Postgres và chạy migration. Mọi flow API khác (owner-auth,
ticket-lifecycle, machine-pairing, project-claims, daemon-api, event-delivery, docs-sync-viewer) đăng ký route
của mình vào app do flow này dựng lên.

## Điểm vào

- `apps/api/src/server.ts` — tiến trình thật sự chạy (`node dist/server.js` hoặc `pnpm --filter @crew/api dev`).

## Các bước

1. `apps/api/src/server.ts` → `main()`: gọi `loadConfig()`, `createDb()`, `buildApp()`, đăng ký xử lý
   `SIGINT`/`SIGTERM` để đóng app sạch, rồi `app.listen({ host, port })`.
2. `apps/api/src/config.ts` → `loadConfig()`: parse `process.env` bằng zod (`EnvSchema`), kiểm tra
   `BUDGET_TIMEZONE` hợp lệ, gộp `PUBLIC_ORIGIN` và `ALLOWED_ORIGINS` thành `allowedOrigins`; ném lỗi rõ ràng
   nếu thiếu/sai biến. `RUNTIME_RELEASES_REPO` (mặc định `nquangphan/my-crew`, rỗng tắt việc nhập release
   `runtime-v*`) và `RUNTIME_EXTRA_PUBLIC_KEYS` (danh sách khoá Ed25519 base64, phân tách bằng dấu phẩy, tin
   thêm ngoài `RUNTIME_SIGNING_KEYS` đóng gói sẵn) thuộc flow `runtime-updates`.
3. `apps/api/src/db/client.ts` → `createDb()`: mở pool `postgres.js`, bọc bằng `drizzle()` với `schema`, trả
   `DbHandle { db, close }`.
4. `apps/api/src/app.ts` → `buildApp()`: tạo instance Fastify (`trustProxy` theo whitelist CIDR,
   `bodyLimit=2MB`), đăng ký `@fastify/cookie`, `@fastify/rate-limit`, error handler gọi thẳng `sendApiError()`
   (bước 6, dùng chung với route tự đặt `setErrorHandler` riêng) chuyển `ApiError` thành JSON đúng mã lỗi, route
   `GET /v1/health` (ping DB), dựng `EventBus` và `WaitingJobsRegistry` (tham số
   `waitingJobs`, mặc định một registry mới — test tự truyền registry riêng để xem). Tham số `closeDrainMs`
   chỉnh thời gian đóng app đợi request đang chạy trước khi cắt kết nối của chúng (mặc định `CLOSE_DRAIN_MS`,
   test rút ngắn để không phải đợi). Sau đó đăng ký ba nhóm route:
   public (`authRoutes`, `pairRoutes`), owner (bọc hook `ownerGuard`, gồm `runtimeRoutes` — flow
   `runtime-updates`) và daemon (bọc hook `machineGuard`, gồm `daemonRuntimeRoutes` cùng flow đó). Hook
   `onReady` khởi động `EventBus`, `startHeartbeatSweeper`, `startStuckTicketAlarm()` và
   `startDraftAttachmentCleanup()` — dọn ảnh nháp mồ côi mỗi giờ (cả ba flow `ticket-lifecycle`, cùng tắt khi
   `realtime.sweeper: false`) — cộng thêm `startRuntimeImport()` (cùng điều kiện sweeper, chỉ khi
   `config.runtimeReleasesRepo` không rỗng — nhập release `runtime-v*` từ GitHub mỗi giờ, flow
   `runtime-updates`) và timer dọn `idempotency_keys`/`sessions` hết hạn mỗi giờ (`MAINTENANCE_INTERVAL_MS`).
   Đóng app có giới hạn thời gian: khi `preClose` chạy, một cờ
   `closing` bật lên, từ đó hook `onSend` gắn header `connection: close` vào mọi response và hook `onResponse`
   tự kết thúc socket (`socket.end()`) — bù cho response đã gửi header kiểu keep-alive ngay trước khi đóng bắt
   đầu, việc mà Fastify tự trả 503 cho request đến sau `close()` không che được, vì `server.close()` vẫn đợi
   phía kia (daemon, hay kết nối upstream nginx giữ pool) tự ngắt, có thể tới hết thời gian keep-alive 72s của
   Fastify. `preClose` cũng đặt timer `closeDrainMs` (mặc định `CLOSE_DRAIN_MS` = 10s, nằm trong
   `stop_grace_period` 20s của container) gọi `app.server.closeAllConnections()` kèm log warn để cắt request còn
   kẹt (ví dụ handler đang đợi DB); timer này bị huỷ khi server phát sự kiện `close`. Sau đó, như trước, `preClose` dừng
   cả hai timer sweeper/stuck alarm và đóng event bus, vì response SSE bị "hijack" khỏi vòng đời request
   thường.
5. `apps/api/src/routes/route-deps.ts` → `parseInput()`, `idParam()`, `uuidParam()`: mọi route handler dùng ba
   hàm này ở biên để validate body/param, ném `ApiError('VALIDATION_FAILED', …)` khi sai.
6. `apps/api/src/errors.ts` → `ApiError`, `STATUS_BY_CODE`, `sendApiError()`: ánh xạ `ApiErrorCode` (định nghĩa
   ở `packages/shared/src/api-schemas.ts`) sang HTTP status — ví dụ `PM_NOT_AVAILABLE` (owner tag `@pm` trên
   ticket không thuộc cây pm_task nào đang mở, flow `ticket-lifecycle`) → 400, `ATTACHMENT_TOO_LARGE` (ảnh dán
   clipboard vượt `MAX_ATTACHMENT_BYTES`, flow `ticket-lifecycle`) → 413; `sideEffectsCommitted` đánh dấu
   lỗi mà service đã ghi side effect trước khi từ chối (ví dụ đẩy pm_task sang `needs_input`), để tầng
   idempotency vẫn lưu và phát lại response đó. `sendApiError()` gói logic dùng chung: `ApiError` gửi thẳng theo
   `toBody()`; lỗi Fastify/khác có `statusCode` 4xx được đoán thành `ApiError` (`UNAUTHORIZED`/`NOT_FOUND`/
   `VALIDATION_FAILED` chung); còn lại log rồi trả `INTERNAL`. Hàm này được cả error handler toàn app ở
   `buildApp()` (bước 4) lẫn error handler riêng của `attachmentRoutes` (flow `ticket-lifecycle`) gọi lại — route
   đó chỉ bắt riêng `FST_ERR_CTP_BODY_TOO_LARGE` của chính nó trước khi rơi về `sendApiError()` chung.
7. `apps/api/src/services/pg-errors.ts` → `isUniqueViolation()`: dò `SQLSTATE 23505` xuyên qua chuỗi
   `cause` mà driver Postgres bọc, dùng ở các service cần phân biệt "trùng khoá" với lỗi khác (ví dụ cấp key
   ticket, tạo project).
8. `apps/api/src/db/migrate.ts` → `runMigrations()`: chạy `drizzle-orm/postgres-js/migrator` với thư mục
   `apps/api/drizzle`; cũng là script CLI (`pnpm --filter @crew/api db:migrate`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/server.ts` | Điểm vào tiến trình | `main` |
| `apps/api/src/index.ts` | Placeholder rỗng (không export gì) | — |
| `apps/api/src/app.ts` | Lắp Fastify, đăng ký route, vòng đời | `buildApp`, `BuildAppOptions` |
| `apps/api/src/config.ts` | Đọc và validate biến môi trường | `loadConfig`, `AppConfig` |
| `apps/api/src/errors.ts` | Lỗi API chuẩn hoá, ánh xạ mã lỗi → status | `ApiError`, `STATUS_BY_CODE`, `notFound`, `sendApiError` |
| `apps/api/src/routes/route-deps.ts` | Dependency + helper validate dùng chung cho mọi route (`RouteDeps.waitingJobs` mang `WaitingJobsRegistry`, flow `ticket-lifecycle`) | `RouteDeps`, `parseInput`, `idParam`, `uuidParam` |
| `apps/api/src/services/pg-errors.ts` | Phân loại lỗi SQLSTATE của Postgres | `isUniqueViolation` |
| `apps/api/src/db/client.ts` | Kết nối Postgres qua Drizzle | `createDb`, `Database`, `Executor` |
| `apps/api/src/db/schema.ts` | Toàn bộ bảng và enum Drizzle — `modelAliasEnum` liệt kê tay `['haiku','sonnet','opus','fable']` thay vì suy ra từ `ModelAlias`, vì Postgres không xoá được giá trị enum; `fable` chỉ còn cho hàng cũ, mọi input dùng `SelectableModel` (không migration nào đổi, `drizzle-kit` không thấy khác biệt schema); bảng `owner` giữ nguyên ba cột xác thực hai bước cũ (`totp_secret`, `totp_last_step`, `recovery_code_hashes`, không xoá vì không có migration phá hoại) nhưng không flow nào còn đọc hay ghi chúng — xem flow `owner-auth`; custom type `bytea` (đầu file) dùng chung cho `attachments` (flow `ticket-lifecycle`) và `runtimeBundles` (flow `runtime-updates`) | mọi `pgTable`/`pgEnum` xuất khẩu |
| `apps/api/src/db/migrate.ts` | Chạy migration SQL | `runMigrations`, `MIGRATIONS_FOLDER` |
| `apps/api/drizzle/0000_init.sql` | Migration khởi tạo | — |
| `apps/api/drizzle/0001_machine_auth_and_delivery.sql` | Migration thêm bảng auth máy + `events.seq` | — |
| `apps/api/drizzle/0003_project_changes_and_notice_reads.sql` | Migration thêm `project_change_requests` (flow `project-claims`) và `notice_reads` (flow `event-delivery`) | — |
| `apps/api/drizzle/0004_project_change_withdrawn.sql` | Migration thêm giá trị `withdrawn` vào enum `project_change_status` (flow `project-claims`) | — |
| `apps/api/drizzle/0005_machine_job_activity.sql` | Migration thêm `machines.waiting_jobs`/`machines.failed_jobs` jsonb (flow `machine-pairing`, đọc bởi `ticket-lifecycle` cho hoạt động agent) | — |
| `apps/api/drizzle/0006_pm_complexity_reason.sql` | Migration thêm cột `tickets.complexity_reason` text (flow `ticket-lifecycle`: lý do PM đánh giá `complexity` của subtask dev/QC) | — |
| `apps/api/drizzle/0007_project_bmad_profile.sql` | Migration thêm cột `projects.bmad_profile` jsonb, nullable (flow `project-claims`: hồ sơ cài BMAD mà máy sở hữu project báo cáo, dùng cho tính năng "Cài BMAD" trên máy khác) | — |
| `apps/api/drizzle/0008_server_settings_and_machine_commands.sql` | Migration thêm bảng `settings_revisions` và cột `machines.settings_state` jsonb (flow `server-settings`: cài đặt server theo bản, prompt/quy tắc/model/tài nguyên/thư mục dự án/MCP dự án), và bảng `machine_commands` (flow `machine-control`: lệnh từ xa owner gửi từ web) | — |
| `apps/api/drizzle/0009_runtime_releases.sql` | Migration thêm bảng `runtime_releases`/`runtime_bundles` và cột `machines.runtime_state`/`runtime_pinned_version` (flow `runtime-updates`: bản runtime đã ký, ghim máy vào một bản) | — |
| `apps/api/drizzle/0010_attachments.sql` | Migration thêm bảng `attachments` (flow `ticket-lifecycle`: ảnh dán clipboard vào ticket, nội dung `bytea`, FK `ticket_id`/`owner_id` cascade delete) | — |
| `apps/api/drizzle/0011_attachments_nullable_ticket_id.sql` | Migration đổi `attachments.ticket_id` thành nullable (flow `ticket-lifecycle`: ảnh nháp dán vào hộp thoại "Tạo ticket" trước khi ticket tồn tại, `POST /v1/attachments`), giữ nguyên FK `ON DELETE cascade` và index, không mất dữ liệu cũ | — |
| `apps/api/drizzle/0012_qc_test_plan.sql` | Migration thêm cột `tickets.test_kinds` (`text[]`, nullable) và `tickets.test_reason` (`text`, nullable) (flow `ticket-lifecycle`: phương án kiểm thử của ticket `qc`, không đổi dữ liệu hàng cũ) | — |
| `packages/shared/src/index.ts` | Re-export toàn bộ schema zod dùng chung (kể cả `desktop-ipc.ts`/`health-schemas.ts` của flow `desktop-app`/`daemon-health`, `bmad-schemas.ts` của flow `project-claims`, `secret-scrubber.ts` của flow `agent-runs`, `comment-mentions.ts` của flow `ticket-lifecycle`, và `runtime-schemas.ts` của flow `runtime-updates`) | — |

## Dữ liệu

- Bảng: toàn bộ bảng ở `apps/api/src/db/schema.ts` (xem `docs/architecture.md#lưu-trữ-dữ-liệu`); flow này sở
  hữu việc kết nối và migrate, không riêng bảng nào.
- Sự kiện: không tự phát sự kiện nghiệp vụ; dựng `EventBus` dùng chung cho flow `event-delivery`.
- Gọi ngoài: không.

## Flow liên quan

- owner-auth: `ownerGuard` được gắn vào nhóm route owner tại `buildApp()`.
- machine-pairing: `pairRoutes` (public) và `machineGuard` (nhóm route daemon) được gắn tại `buildApp()`.
- event-delivery: `EventBus` được tạo và khởi động/dừng theo vòng đời app tại đây.
- ticket-lifecycle: `startStuckTicketAlarm()`, `startDraftAttachmentCleanup()` và `WaitingJobsRegistry`
  (`RouteDeps.waitingJobs`) được tạo và khởi động/dừng cùng vòng đời `buildApp()`, cạnh `startHeartbeatSweeper`
  (flow `machine-pairing`); `attachmentRoutes` (nhóm route owner, gồm `POST /v1/tickets/:id/attachments`,
  `POST /v1/attachments` ảnh nháp và `GET /v1/attachments/:id`) đăng ký tại `buildApp()`, `daemonAttachmentRoutes`
  (cùng file, route đọc `GET /v1/daemon/attachments/:id` cho daemon) đăng ký cạnh `daemonRoutes` trong nhóm route
  daemon; migration `0010_attachments.sql` (tạo bảng), `0011_attachments_nullable_ticket_id.sql` (`ticket_id`
  nullable, phục vụ ảnh nháp) và `0012_qc_test_plan.sql` (cột `tickets.test_kinds`/`tickets.test_reason`) chạy
  qua `runMigrations()` như mọi migration khác; `attachmentRoutes` tự đăng ký thêm một `setErrorHandler` riêng
  (Fastify cô lập theo `register()`, không ảnh hưởng route khác) bắt riêng `FST_ERR_CTP_BODY_TOO_LARGE` để trả
  đúng `ATTACHMENT_TOO_LARGE`, còn lại gọi lại `sendApiError()` (bước 6) dùng chung với error handler toàn app.
- daemon-api, project-claims, docs-sync-viewer: route của các flow này được đăng ký bên trong `buildApp()`,
  gồm cả `daemonBmadProfileRoutes` (`apps/api/src/routes/bmad-profile-routes.ts`, flow `daemon-api`) trong
  nhóm route daemon.
- server-settings: `settingsRoutes` (nhóm route owner) và `daemonSettingsRoutes` (nhóm route daemon) cũng
  đăng ký tại `buildApp()`; migration `0008_server_settings_and_machine_commands.sql` (phần `settings_revisions`/
  `machines.settings_state`) chạy qua `runMigrations()` như mọi migration khác.
- machine-control: `machineCommandRoutes` (nhóm route owner) và `daemonCommandRoutes` (nhóm route daemon)
  cũng đăng ký tại `buildApp()`; migration `0008_server_settings_and_machine_commands.sql` (phần
  `machine_commands`) chạy qua `runMigrations()` như mọi migration khác.
- runtime-updates: `runtimeRoutes`/`daemonRuntimeRoutes` đăng ký tại `buildApp()`, `startRuntimeImport()`
  khởi động cạnh sweeper/stuck-alarm; migration `0009_runtime_releases.sql` chạy qua `runMigrations()`;
  `RUNTIME_RELEASES_REPO`/`RUNTIME_EXTRA_PUBLIC_KEYS` đọc ở `config.ts`.

## Tests

- `apps/api/test/shutdown.test.ts`: một stream còn đang xác thực khi đóng bắt đầu bị kết thúc ngay và đóng
  không đợi nó; client ngắt kết nối trong lúc xác thực không để lại subscriber nào; request trả lời xong sau
  khi đóng bắt đầu mang header `connection: close`, nên đóng không đợi keep-alive; request còn kẹt bị cắt kết
  nối sau khi hết `closeDrainMs`. Phần còn lại của hành vi `buildApp()` được phủ gián tiếp qua test của mọi
  flow route khác (ví dụ `apps/api/test/auth.test.ts`, `apps/api/test/machine-scope.test.ts`), vì các test đó
  đều dựng app thật qua `buildApp()`.
