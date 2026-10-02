# Nền tảng server và database riêng Crew v2

## Mục đích

`server/` là package API độc lập của Crew v2. Giao dịch dùng PostgreSQL riêng; các policy thuần nằm ở `src/` của v2. Package này không dùng schema, runtime hay database v1.

## Điểm vào

- `server/src/platform/config.ts` → `loadConfig`: đọc và kiểm tra cấu hình v2.
- `server/src/db/client.ts` → `connectDb`: tạo pool PostgreSQL sau khi kiểm tra URL.
- `server/src/db/migrate.ts` → `captureMigrations`, `migrate`: chụp prefix SQL bất biến, kiểm tra marker và áp dụng trong transaction.
- `server/test/support/db.ts` → `databaseFixture`: cấp logical DB riêng cho mỗi test callback.
- `server/scripts/test-db.ts` → chạy test trên container PostgreSQL tạm.
- `server/scripts/test-db-signals.mjs` → probe riêng cho đường ngắt test runner.

## Các bước

1. `server/src/platform/config.ts` → `loadConfig`: yêu cầu `CREW_V2_DATABASE_URL`, `CREW_V2_PUBLIC_ORIGIN`, khóa session 32 byte ở dạng 64 ký tự hex; cổng API mặc định 8788. Tên database phải bắt đầu bằng `crew_v2_`; URL loopback phải có cổng riêng, khác 5432 và 55432.
2. `server/src/db/client.ts` → `connectDb`: kiểm tra lại tên DB/cổng trước khi mở pool. Không đọc DSN v1.
3. `server/src/db/migrate.ts` → `captureMigrations(through)`: đọc đúng các file `001` đến `through`, giữ SQL và SHA-256 trong `MigrationSet` bất biến. `migrate(db,set)` dùng advisory lock `crew-v2-migrations`, xác nhận marker `crew-v2`, phát hiện checksum drift rồi chạy các migration còn thiếu trong một transaction. SQL lỗi khiến toàn bộ lượt migration rollback.
4. `server/test/support/db.ts` → `databaseFixture(through)`: chụp prefix trước khi tạo DB dạng `crew_v2_test_<uuid>`, migrate, chạy callback, đóng pool và xóa đúng DB vừa tạo trong `finally`.
5. `server/scripts/test-db.ts` → khởi chạy `postgres:18.6` không volume, publish cổng ngẫu nhiên trên `127.0.0.1`, chờ `pg_isready` tối đa 30 giây, chuyển URL test cho `node:test`. Mặc định runner tự chọn file `test/*.test.ts`; probe có thể truyền `--test-file` với đường dẫn tuyệt đối đến đúng một fixture riêng. Test child chạy trong process group riêng; khi nhận SIGINT/SIGTERM, runner gửi tín hiệu cho group, sau 750 ms cưỡng chế SIGKILL và chờ reap thêm tối đa 750 ms, rồi dừng đúng container đã tạo. Đường test thoát bình thường giữ exit code của `node:test`.
6. `server/scripts/test-db-signals.mjs` → tạo fixture `.mjs` trong thư mục scratch riêng, không thêm file vào `server/test/`. Fixture ghi container ID chính xác từ `CREW_V2_TEST_CONTAINER_ID` vào readiness file; preload ghi PID direct child. Probe chỉ dọn các PID/ID nhận từ chính lượt này. Một lượt đặt test child vào trạng thái `SIGSTOP` để kiểm tra đường cưỡng chế khi child không thể tự thoát. Probe xác minh process, descendant và container riêng đã dừng trong 4 giây; tài nguyên tạm được dọn trong `finally`.

## Files

| Đường dẫn từ `v2/` | Vai trò |
|---|---|
| `server/package.json`, `server/pnpm-lock.yaml`, `server/tsconfig.json` | Pin dependency, lệnh và kiểm tra kiểu strict |
| `server/.env.example` | Tên biến cấu hình mẫu, không chứa secret thật |
| `server/src/platform/contracts.ts` | Kiểu dùng chung cho Actor, mutation, route và server options |
| `server/src/platform/errors.ts` | `ApiError` có code, HTTP status và details |
| `server/src/platform/config.ts` | `loadConfig` |
| `server/src/platform/picomatch.d.ts` | Kiểu cho picomatch 4 |
| `server/src/platform/thread-stream.d.ts` | Alias kiểu hẹp cho thread-stream 4.2.0 với `@types/node` 26 |
| `server/src/db/client.ts` | `connectDb` |
| `server/src/db/migrate.ts` | `MigrationSet`, `captureMigrations`, `migrate` |
| `server/migrations/001_platform.sql` | Bảng `system_identity` và marker `crew-v2` |
| `server/scripts/test-db.ts` | Container test riêng, cổng loopback ngẫu nhiên và cleanup |
| `server/scripts/test-db-signals.mjs` | Regression probe cho cleanup khi child bỏ qua tín hiệu |
| `server/test/support/db.ts` | `databaseFixture` |
| `server/test/platform.test.ts` | Kiểm thử cấu hình, migration, fixture và backup/restore |

## Dữ liệu

Cấu hình mẫu nằm tại `server/.env.example`; giá trị thật cấp từ nơi giữ secret. Migration không chạy khi import module hoặc khởi động app. Người vận hành chọn prefix phát hành bằng `CREW_V2_MIGRATION_THROUGH` rồi chạy `pnpm --dir v2/server db:migrate`. Trước khi migrate DB v2 có dữ liệu phải backup và diễn tập restore. CLI không tự lấy file SQL mới xuất hiện giữa lượt chạy.

Test chỉ dùng container tạm với trust auth trên loopback; URL test lấy từ runner, không dùng `CREW_V2_DATABASE_URL`. Image PostgreSQL đã xác minh khi triển khai: `postgres:18.6`, digest `sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`.

## Flow liên quan

`domain-foundation` cung cấp policy thuần. Các flow journal, identity, tickets, execution và docs ở phần tiếp theo tiêu thụ `MigrationSet`, fixture DB và hợp đồng route; flow này không cài các nghiệp vụ đó.

## Tests

`pnpm --dir v2/server test` cần Docker. Test chạy migration lặp lại, từ chối DB lạ/cổng dùng chung, checksum drift, rollback SQL lỗi và prefix đã chụp không đổi khi file sửa. `pg_dump`/`pg_restore` chạy qua `docker exec` trong đúng container test để xác nhận marker và dữ liệu được giữ. `pnpm --dir v2/server test:signals` thực hiện SIGTERM, SIGINT cùng trường hợp child bị `SIGSTOP`; có thể chạy đồng thời với suite thường vì fixture nằm ngoài thư mục test chung và mỗi runner dùng container riêng. `pnpm --dir v2/server typecheck` kiểm tra mã TypeScript; `pnpm --dir v2 test` kiểm tra policy miền.
