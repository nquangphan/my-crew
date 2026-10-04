# Báo cáo Task 1 — server platform và DB test riêng

**Trạng thái: DONE.** Không commit, không sửa manifest/index dùng chung, không chạm DB v1 hay production.

## File thay đổi

- Package và cấu hình: `v2/server/package.json`, `v2/server/pnpm-lock.yaml`, `v2/server/tsconfig.json`, `v2/server/.env.example`.
- Platform: `v2/server/src/platform/{contracts,errors,config,picomatch.d,thread-stream.d}.ts` (hai file `.d.ts` là khai báo kiểu).
- DB: `v2/server/src/db/{client,migrate}.ts`, `v2/server/migrations/001_platform.sql`.
- Test: `v2/server/scripts/test-db.ts`, `v2/server/test/support/db.ts`, `v2/server/test/platform.test.ts`.
- Flow: `v2/docs/flows/server-platform.md` theo bảy heading chuẩn. PM sở hữu `v2/docs/flows.yaml` và file docs sinh tự động.

## Interface bàn giao

- `loadConfig(env)` chỉ đọc biến v2; yêu cầu `CREW_V2_SESSION_ENCRYPTION_KEY` 64 hex. `connectDb(url)` từ chối tên DB không bắt đầu `crew_v2_` hoặc loopback cổng mặc định/55432.
- `MigrationSet={through,files:[{version,name,sha256,sql}]}`; `captureMigrations(through, migrationsDir?)` chụp đúng prefix, freeze cả set và từng file; `migrate(db,set)` xác minh SHA của set, marker `crew-v2`, checksum DB, chạy trong một transaction có advisory lock. CLI yêu cầu `CREW_V2_MIGRATION_THROUGH` tường minh, không auto migrate.
- `databaseFixture(through)(fn)` chụp set trước khi tạo DB, kiểm tra URL khớp container test do runner tạo, migrate, đóng pool và drop đúng logical DB test. Tuỳ chọn `{migrate:false}` chỉ phục vụ test từ chối DB lạ/rollback từ DB trống.
- `contracts.ts` gồm Actor, Db/Tx, Mutation, Event, Authenticator, RouteDependencies và `ServerOptions.verifyFinalResult` theo primitive mới. `ApiError` có code/status/message/details.

## TDD và kiểm chứng

| Bước | Lệnh / kết quả thực tế |
|---|---|
| RED nền tảng | `pnpm --dir v2/server test --test-name-pattern='DB v1|migration'` → exit 1, `ERR_MODULE_NOT_FOUND ... src/platform/config.ts` trước khi viết module. Docker test đã khởi động nên đây là thiếu implementation, không phải lỗi hạ tầng. |
| GREEN nền tảng | Cùng lệnh → exit 0, 2/2 tests pass trên Postgres 18.6. |
| RED fixture migrate | `pnpm --dir v2/server test --test-name-pattern='fixture tạo'` → exit 1, `relation "system_identity" does not exist` vì fixture chưa migrate trước callback. |
| GREEN fixture migrate | `pnpm --dir v2/server test` → exit 0, 8/8 tests pass sau khi fixture migrate. |
| RED backup/restore | `pnpm --dir v2/server test --test-name-pattern='backup và restore'` → exit 1, thiếu `CREW_V2_TEST_CONTAINER_ID`. |
| GREEN backup/restore | Cùng lệnh → exit 0, 1/1 test pass; `pg_dump`/`pg_restore` chạy qua `docker exec` trong container test và giữ marker/dữ liệu. |
| RED snapshot | `pnpm --dir v2/server test --test-name-pattern='migration set đã chụp'` → exit 1, `captureMigrations` chưa được export. |
| GREEN snapshot | `pnpm --dir v2/server test` → exit 0, 10/10 tests pass; file SQL đổi sau khi capture không đổi migration đã chụp. |
| RED fixture container | `pnpm --dir v2/server test --test-name-pattern='fixture từ chối URL'` → exit 1: fixture thử nối cổng sai và nhận `ECONNREFUSED`, chưa từ chối trước khi tạo pool. |
| GREEN fixture container | Cùng lệnh → exit 0, 1/1 test pass với lỗi `UNSAFE_TEST_DB_CONTAINER` trước kết nối. |
| Cuối cùng | `pnpm --dir v2/server test` → exit 0, 13/13 tests pass; gồm migration đồng thời, marker refusal, checksum drift, atomic rollback, fixture safety và backup/restore. `pnpm --dir v2/server typecheck` → exit 0. `pnpm --dir v2 test` → exit 0, 14/14 domain tests pass. `git diff --check` → exit 0. |

Typecheck lần đầu báo TS1294 do parameter property không tương thích `erasableSyntaxOnly`, cùng TS2694 vì `thread-stream@4.2.0` dùng alias `TransferListItem` đã bỏ trong `@types/node@26.6.3`. Đã bỏ parameter property và thêm alias hẹp trong `thread-stream.d.ts`; không dùng `skipLibCheck`. Typecheck cuối cùng exit 0.

Kiểm tra cleanup bổ sung:

- Test assertion lỗi tạm: runner exit 1, không còn container `crew-v2-test-*` mới sau khi thoát (`leaked=0`). File probe tạm đã xóa.
- Test treo tạm rồi gửi SIGTERM: container riêng `84e047ff150f` được dừng, probe tạm đã xóa. Handler cũng xử lý SIGINT cùng đường cleanup.
- `docker ps --filter name=crew-v2-test-` sau bộ test chính không còn container từ Task 1.

Image `postgres:18.6` đã pull và inspect; digest thật: `postgres@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`. Runner chỉ publish cổng ngẫu nhiên trên loopback, không gắn volume hoặc dùng compose/shared DB.

## Self-review và giới hạn

- Migration ghi schema và ledger trong cùng transaction, có advisory lock; hai lượt đầu tiên đồng thời chỉ ghi một version. Re-run không ghi trùng. Drift hoặc SQL lỗi không đổi dữ liệu hiện có; DB lạ không bị ghi schema.
- Prefix migration được capture trước khi tạo DB test và trước khi mở pool CLI. Tên file/version/checksum của set được kiểm tra lại tại `migrate`; các file xuất hiện sau capture không được áp dụng trong lượt đó.
- Test backup/restore chỉ diễn tập trên container test. Trước khi migrate DB v2 thật cần backup và diễn tập restore trên môi trường đích; Task 1 không triển khai hoặc chạy migration ngoài test.
- `v2/docs/flows.yaml`, `v2/docs/index.md`, `v2/docs/files.md` và Git staging/commit để PM tích hợp tuần tự. Không có PR/commit từ worker.

## Lint gate trước review

PM chạy Biome và phát hiện 13 lỗi, 7 cảnh báo, 1 thông tin trên 12 file Task 1. Đã chạy formatter/import organizer của repo bằng lệnh `/Users/phannhatquang/Documents/projects/crew/node_modules/.bin/biome check --write v2/server/src v2/server/scripts v2/server/test v2/server/package.json v2/server/tsconfig.json`. Sau đó thay toàn bộ non-null assertion bằng guard/assert có narrowing thực, đổi import built-in sang `node:worker_threads` nhưng giữ augmentation cho tên module `worker_threads` mà dependency sử dụng. Không thêm suppression hay tắt kiểm tra thư viện.

Kiểm chứng sau sửa:

- `/Users/phannhatquang/Documents/projects/crew/node_modules/.bin/biome check v2/server/src v2/server/scripts v2/server/test v2/server/package.json v2/server/tsconfig.json` → exit 0, `Checked 12 files in 5ms. No fixes applied.`, không còn diagnostic.
- `pnpm --dir v2/server test` → exit 0, 13/13 tests pass trên DB riêng.
- `pnpm --dir v2/server typecheck` → exit 0, không lỗi.
- `pnpm --dir v2 test` → exit 0, 14/14 domain tests pass.

## Fix round 1/5 — cleanup khi child không hợp tác

Review `task-1-review.md` chỉ ra handler SIGINT/SIGTERM cũ gửi tín hiệu cho direct `node --test` child rồi chờ `close` không giới hạn; descendant của test có thể sống tiếp hoặc child có thể không thoát, ngăn `finally` dừng container. Đây là lỗi của ranh giới process do runner tạo.

Đã sửa `v2/server/scripts/test-db.ts`: `node --test` chạy trong process group riêng trên macOS/Linux. Khi runner nhận SIGINT/SIGTERM, nó gửi tín hiệu cho đúng group này; sau 750 ms gửi SIGKILL cho cùng group kể cả direct child đã thoát nhưng descendant còn sống, chờ reap thêm tối đa 750 ms rồi luôn đi tiếp tới `finally` để dừng container ID của chính runner. Khi test kết thúc bình thường, runner giữ exit code của `node --test`. Không kill process group khác hoặc container khác.

Regression probe bền vững nằm ở `v2/server/scripts/test-db-signals.mjs`, chạy bằng `pnpm --dir v2/server test:signals`. Probe tạo child và descendant đều cài handler bỏ qua SIGINT/SIGTERM; test chỉ báo sẵn sàng sau khi descendant đã khởi chạy. Probe chờ file readiness và tín hiệu được direct child xác nhận, không dựa vào sleep để chọn thời điểm ngắt. Lượt thứ ba dùng SIGSTOP cho direct child để chứng minh đường chờ có giới hạn và SIGKILL hoạt động ngay cả khi child không thể xử lý tín hiệu. Mỗi lượt khẳng định runner, child, descendant và container riêng đã dừng trong 4 giây. Fixture hiện nằm trong scratch riêng; probe dọn file/process/container do chính nó tạo trong `finally` và chạy được đồng thời với suite thường.

RED tái hiện trên runner ở base `d4f45b8` (bản copy tạm `v2/server/scripts/probe-old-test-db.ts`, đã xóa):

`CREW_V2_PROBE_RUNNER=scripts/probe-old-test-db.ts node v2/server/scripts/test-db-signals.mjs SIGTERM --pause-child` → exit 1 sau 4 giây, `cleanup failed: closed=false, containerStopped=false, descendantAlive=true, testChildAlive=true`. Probe tự dọn các tài nguyên còn lại sau assertion. Probe thường trên runner cũ cũng thấy `descendantAlive=true` dù direct child đã thoát.

GREEN trên runner đã sửa:

- `pnpm --dir v2/server test:signals` → exit 0; `SIGTERM cleanup PASS`, `SIGINT cleanup PASS`, `SIGTERM paused cleanup PASS`; cả ba đều xác nhận runner, child, descendant và container riêng dừng trong 4 giây.
- `pnpm --dir v2/server test` → exit 0, 13/13 tests pass (một lượt full suite sau sửa runner).
- `pnpm --dir v2/server typecheck` → exit 0.
- Test assertion lỗi tạm sau sửa runner → runner exit 1, giữ mã lỗi test thông thường.
- `docker ps --filter name=crew-v2-test-` và tìm process probe sau lượt GREEN → không còn tài nguyên test từ Task 1.

Đã cập nhật riêng `v2/docs/flows/server-platform.md` và thêm script `test:signals` trong `v2/server/package.json`. PM cần map file nguồn mới `v2/server/scripts/test-db-signals.mjs` vào flow `server-platform` của manifest chung; worker không sửa manifest/index.

### Follow-up: fixture và quyền sở hữu độc lập

PM phát hiện phiên bản probe đầu ghi file test tạm vào `v2/server/test/`, khiến một suite không lọc chạy đồng thời có thể vô tình lấy test treo. Probe cũng suy container ID từ phần tử mới trong danh sách Docker toàn cục, có thể nhầm container của lượt khác. Đã sửa hai ranh giới này: fixture là `.mjs` trong scratch riêng và truyền bằng `--test-file <đường dẫn tuyệt đối>` tới `scripts/test-db.ts`; readiness file do fixture ghi chứa chính `CREW_V2_TEST_CONTAINER_ID` runner cấp. Preload ghi PID của direct `node --test` child vào scratch. Probe chỉ inspect/stop container ID và signal PID nhận từ chính lượt mình, không quét chênh lệch container/process toàn cục để quyết định cleanup.

RED trước khi runner nhận đường dẫn tường minh: `node v2/server/scripts/test-db-signals.mjs SIGTERM` → exit 1, `runner exited before explicit scratch test became ready`. Suite này không có fixture trong thư mục test chung.

GREEN đồng thời (hai lệnh được khởi chạy cùng lúc):

- `pnpm --dir v2/server test` → exit 0, 13/13 tests pass.
- `pnpm --dir v2/server test:signals` → exit 0; SIGTERM, SIGINT và SIGTERM với child `SIGSTOP` đều báo cleanup PASS trong 4 giây. Không có dòng test probe xuất hiện trong output 13 test của suite thường.
- `pnpm --dir v2/server typecheck` và Biome được chạy lại sau khi sửa; kết quả ghi ở bước kiểm chứng cuối.

Follow-up cuối: cleanup của chính probe cũng chờ runner xử lý SIGTERM tối đa 2,5 giây trước khi cưỡng chế PID đã ghi trong scratch; nếu readiness bị lỗi, probe chỉ đọc ID từ file của lượt mình và không dò/xóa container khác. Sau thay đổi này, chạy **đồng thời** `pnpm --dir v2/server test` và `pnpm --dir v2/server test:signals` lần cuối: suite thường exit 0, 13/13; probe exit 0 với ba dòng PASS (SIGTERM, SIGINT, SIGTERM paused). Biome trên 13 file exit 0: `Checked 13 files in 7ms. No fixes applied.`; `pnpm --dir v2/server typecheck` exit 0; `git diff --check` exit 0. Không còn process probe theo tên fixture sau lượt chạy.
