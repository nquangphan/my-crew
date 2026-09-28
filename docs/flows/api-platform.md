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
   nếu thiếu/sai biến.
3. `apps/api/src/db/client.ts` → `createDb()`: mở pool `postgres.js`, bọc bằng `drizzle()` với `schema`, trả
   `DbHandle { db, close }`.
4. `apps/api/src/app.ts` → `buildApp()`: tạo instance Fastify (`trustProxy` theo whitelist CIDR,
   `bodyLimit=2MB`), đăng ký `@fastify/cookie`, `@fastify/rate-limit`, error handler chuyển `ApiError` thành
   JSON đúng mã lỗi, route `GET /v1/health` (ping DB), dựng `EventBus`, rồi đăng ký ba nhóm route: public
   (`authRoutes`, `pairRoutes`), owner (bọc hook `ownerGuard`) và daemon (bọc hook `machineGuard`). Hook
   `onReady` khởi động `EventBus` và `startHeartbeatSweeper`, cộng thêm timer dọn `idempotency_keys`/`sessions`
   hết hạn mỗi giờ (`MAINTENANCE_INTERVAL_MS`). Hook `preClose` dừng sweeper và event bus trước khi đóng kết
   nối, vì response SSE bị "hijack" khỏi vòng đời request thường.
5. `apps/api/src/routes/route-deps.ts` → `parseInput()`, `idParam()`, `uuidParam()`: mọi route handler dùng ba
   hàm này ở biên để validate body/param, ném `ApiError('VALIDATION_FAILED', …)` khi sai.
6. `apps/api/src/errors.ts` → `ApiError`, `STATUS_BY_CODE`: ánh xạ `ApiErrorCode` (định nghĩa ở
   `packages/shared/src/api-schemas.ts`) sang HTTP status; `sideEffectsCommitted` đánh dấu lỗi mà service đã
   ghi side effect trước khi từ chối (ví dụ đẩy pm_task sang `needs_input`), để tầng idempotency vẫn lưu và
   phát lại response đó.
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
| `apps/api/src/errors.ts` | Lỗi API chuẩn hoá, ánh xạ mã lỗi → status | `ApiError`, `STATUS_BY_CODE`, `notFound` |
| `apps/api/src/routes/route-deps.ts` | Dependency + helper validate dùng chung cho mọi route | `RouteDeps`, `parseInput`, `idParam`, `uuidParam` |
| `apps/api/src/services/pg-errors.ts` | Phân loại lỗi SQLSTATE của Postgres | `isUniqueViolation` |
| `apps/api/src/db/client.ts` | Kết nối Postgres qua Drizzle | `createDb`, `Database`, `Executor` |
| `apps/api/src/db/schema.ts` | Toàn bộ bảng và enum Drizzle | mọi `pgTable`/`pgEnum` xuất khẩu |
| `apps/api/src/db/migrate.ts` | Chạy migration SQL | `runMigrations`, `MIGRATIONS_FOLDER` |
| `apps/api/drizzle/0000_init.sql` | Migration khởi tạo | — |
| `apps/api/drizzle/0001_machine_auth_and_delivery.sql` | Migration thêm bảng auth máy + `events.seq` | — |
| `packages/shared/src/index.ts` | Re-export toàn bộ schema zod dùng chung | — |

## Dữ liệu

- Bảng: toàn bộ bảng ở `apps/api/src/db/schema.ts` (xem `docs/architecture.md#lưu-trữ-dữ-liệu`); flow này sở
  hữu việc kết nối và migrate, không riêng bảng nào.
- Sự kiện: không tự phát sự kiện nghiệp vụ; dựng `EventBus` dùng chung cho flow `event-delivery`.
- Gọi ngoài: không.

## Flow liên quan

- owner-auth: `ownerGuard` được gắn vào nhóm route owner tại `buildApp()`.
- machine-pairing: `pairRoutes` (public) và `machineGuard` (nhóm route daemon) được gắn tại `buildApp()`.
- event-delivery: `EventBus` được tạo và khởi động/dừng theo vòng đời app tại đây.
- ticket-lifecycle, daemon-api, project-claims, docs-sync-viewer: route của các flow này được đăng ký bên
  trong `buildApp()`.

## Tests

- Không có file test riêng cho flow này (`tests: []` trong `docs/flows.yaml`); hành vi của `buildApp()` được
  phủ gián tiếp qua test của mọi flow route khác (ví dụ `apps/api/test/auth.test.ts`,
  `apps/api/test/machine-scope.test.ts`), vì các test đó đều dựng app thật qua `buildApp()`.
