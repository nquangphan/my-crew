# Cài đặt môi trường dev

Hướng dẫn này dành cho dev mới vào repo `crew` (pnpm TypeScript monorepo cho 2P Crew), đi từ máy trắng tới lúc
chạy được API, web, daemon và app desktop ở chế độ dev, cộng bộ lệnh kiểm tra trước khi commit. Đọc
[`../index.md`](../index.md) và [`../../AGENTS.md`](../../AGENTS.md) trước hoặc sau khi làm theo trang này đều
được — hai trang đó nói về kiến trúc và quy ước, trang này chỉ nói về cách dựng máy dev.

## Yêu cầu hệ thống

- **Node** `>=22` — khớp `.nvmrc` (`22`) và `engines.node` trong `package.json` ở gốc repo. Dùng `nvm use` hoặc
  tương đương để lấy đúng bản.
- **pnpm** `10.32.1` — khớp `packageManager` trong `package.json` ở gốc repo. Khuyến khích bật qua Corepack
  (`corepack enable`) để luôn dùng đúng bản pnpm mà repo khai báo, thay vì cài pnpm rời rạc.
- **Docker** (Docker Desktop hoặc daemon Docker trên Linux) — cần để chạy Postgres cho dev/test và cho bộ E2E
  toàn hệ thống ở `e2e/`.

## Cài đặt

```sh
pnpm install
```

Chạy ở gốc repo; pnpm dựng workspace cho toàn bộ `apps/*` và `packages/*`.

## Database dev và test

```sh
docker compose -f docker-compose.dev.yml up -d --wait
```

Lệnh này khởi động một container Postgres 17 (`postgres:17-alpine`) tên **`crew-dev-postgres`**, lắng nghe ở
**`127.0.0.1:55432`** (map từ cổng `5432` trong container). Cổng `55432` được chọn có chủ đích để không đụng
một Postgres cục bộ khác đang chạy ở cổng mặc định `5432` trên máy dev — **không dùng cổng `5432`** cho DB của
repo này.

Cùng một container phục vụ cả DB dev lẫn DB test:

- DB dev chính tên `crew` (user/password mặc định cho container này là `crew`/`crew`, đặt cứng trong
  `docker-compose.dev.yml` — chỉ là giá trị cục bộ dùng trên máy dev, không phải secret của môi trường thật).
- DB test `crew_test` được tạo sẵn tự động lúc container khởi động lần đầu (script init trong
  `docker-compose.dev.yml`). Bộ test của `apps/daemon` và `apps/desktop` tự tạo và migrate thêm hai DB test
  riêng của chúng (`crew_daemon_test`, `crew_desktop_test`) ngay khi chạy `pnpm -r test` lần đầu — không cần
  tạo tay. Tên DB test luôn có hậu tố `_test`, đúng quy ước kiểm tra ở `apps/api/.env.example`.

## Biến môi trường API

`apps/api` đọc cấu hình qua biến môi trường; file mẫu nằm ở `apps/api/.env.example`. Dưới đây chỉ liệt tên
biến và ý nghĩa — bộ giá trị dùng được cho dev nằm ở mục
[Nạp biến môi trường trước khi chạy lệnh `apps/api`](#nạp-biến-môi-trường-trước-khi-chạy-lệnh-appsapi) bên
dưới, không chép giá trị bí mật vào đâu khác:

| Biến | Ý nghĩa |
|------|---------|
| `DATABASE_URL` | Chuỗi kết nối Postgres chính; mặc định dev trỏ vào `crew-dev-postgres` ở trên. |
| `SESSION_SECRET` | Tối thiểu 32 ký tự ngẫu nhiên, ký CSRF token; tự sinh cho máy dev, không commit. |
| `PUBLIC_ORIGIN` | Origin công khai của **web app** (không phải của API) — theo comment tại `apps/api/src/config.ts`; luôn nằm trong danh sách origin được phép của API (`allowedOrigins`). |
| `ALLOWED_ORIGINS` | Danh sách origin bổ sung được phép, phân tách bằng dấu phẩy (ví dụ thêm origin của Vite dev khi cần gọi trực tiếp không qua proxy). |
| `HOST` | Địa chỉ Fastify bind vào. |
| `PORT` | Cổng API. |
| `TRUST_PROXY` | Danh sách CIDR của reverse proxy được tin cậy cho `X-Forwarded-For`, phân tách bằng dấu phẩy; để trống nghĩa là không tin proxy nào — hợp lý khi chạy dev không qua proxy. |
| `COOKIE_SECURE` | Cookie session có đặt cờ `Secure` hay không. |
| `LOGIN_RATE_LIMIT_PER_MINUTE` | Giới hạn số lần đăng nhập mỗi phút. |
| `BUDGET_TIMEZONE` | Múi giờ tính ngân sách theo ngày. |
| `LOG_LEVEL` | Mức log của Fastify. |
| `RUNTIME_RELEASES_REPO` | Repo GitHub chứa release `runtime-v*` của daemon mà API tự nhập hàng giờ; để trống thì tắt tính năng này. |
| `RUNTIME_EXTRA_PUBLIC_KEYS` | Khoá ký runtime tin cậy bổ sung (Ed25519, base64), phân tách bằng dấu phẩy; thường để trống. |
| `TEST_DATABASE_URL` | Chỉ dùng khi chạy test của `apps/api`; tên DB phải có hậu tố `_test`. |

Giá trị mẫu trong `apps/api/.env.example` **không dùng ngay được cho dev**: `PUBLIC_ORIGIN` ở đó là domain
production (`https://crew.2p-solutions.com`), `ALLOWED_ORIGINS` để trống và `COOKIE_SECURE=true`. `DATABASE_URL`
và `TEST_DATABASE_URL` mẫu thì dùng được nguyên vẹn vì đã trỏ sẵn vào `crew-dev-postgres`. Bộ giá trị dùng được
cho dev nằm ở mục ngay dưới đây.

## Nạp biến môi trường trước khi chạy lệnh `apps/api`

`apps/api` không tự đọc file `.env` nào — `loadConfig()` trong `apps/api/src/config.ts` parse thẳng
`process.env`, và `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_ORIGIN` bắt buộc, không có giá trị mặc định. Thiếu
biến thì `db:migrate` thoát với `DATABASE_URL is required`, còn `dev` ném `Invalid API configuration: ...` (xem
mục "Lỗi thường gặp" bên dưới). **Export các biến sau vào shell trước khi chạy bất kỳ lệnh nào của `apps/api`**
(mọi lệnh còn lại trong trang này giả định đã export sẵn):

```sh
export DATABASE_URL=postgres://crew:crew@127.0.0.1:55432/crew   # trỏ crew-dev-postgres, khớp apps/api/.env.example
export SESSION_SECRET=$(openssl rand -base64 32)                # tự sinh, không dùng giá trị cố định
export PUBLIC_ORIGIN=http://127.0.0.1:5173                      # origin của Vite dev, KHÔNG phải giá trị production trong .env.example
export COOKIE_SECURE=false                                      # dev chạy HTTP thuần; true chỉ dùng khi có HTTPS
```

`apps/web/playwright.config.ts` (khối `webServer[0].env`, project `api`) cũng export 4 biến này, nhưng cho một
môi trường E2E riêng — **không khớp** giá trị dev ở trên: `DATABASE_URL` trỏ DB `crew_e2e_test` và
`PUBLIC_ORIGIN` dùng cổng `4178`, cố tình khác DB `crew` và cổng `5173` của dev để một lượt E2E không bao giờ
đụng server hoặc dữ liệu dev (xem hằng số và comment giải thích trong `apps/web/e2e/e2e-env.ts`). Cách nạp cụ
thể (`export` trong shell, `.envrc`, `dotenv-cli`, …) tuỳ công cụ bạn dùng — trang này chỉ đảm bảo bộ giá trị
dev hoạt động được, không quy định cơ chế nạp; tự chạy thử để xác nhận cách nạp phù hợp với môi trường của bạn.

## Migrate DB và tạo tài khoản owner

Cần đã export các biến ở mục trên (đặc biệt `DATABASE_URL`) trước khi chạy hai lệnh này:

```sh
pnpm --filter @crew/api db:migrate
pnpm --filter @crew/api seed:owner --username <tên đăng nhập>
```

- `db:migrate` chạy migration Drizzle (script thật: `tsx src/db/migrate.ts`) lên DB trỏ bởi `DATABASE_URL`.
- `seed:owner` (script thật: `tsx src/cli/seed-owner.ts`) tạo tài khoản owner duy nhất của môi trường dev: cần
  `DATABASE_URL` và `--username`, hỏi mật khẩu ẩn hai lần trên terminal (hoặc đọc từ biến `CREW_OWNER_PASSWORD`
  nếu không có TTY), không truyền mật khẩu qua tham số dòng lệnh; thêm cờ `--reset` để thay owner đã có (đăng
  xuất mọi phiên hiện tại).

## Chạy API và web

Cần đã export các biến ở mục [Nạp biến môi trường trước khi chạy lệnh `apps/api`](#nạp-biến-môi-trường-trước-khi-chạy-lệnh-appsapi)
ở trên trước khi chạy `pnpm --filter @crew/api dev`:

```sh
pnpm --filter @crew/api dev   # tsx watch src/server.ts, mặc định cổng 8787 (biến PORT)
pnpm --filter @crew/web dev   # vite, mặc định cổng 5173
```

Vite dev server (cổng `5173`) proxy các request `/v1` sang API, nên không cần đặt `ALLOWED_ORIGINS` hay CORS
riêng — **miễn là `PUBLIC_ORIGIN` đúng bằng origin Vite đang chạy** (`http://127.0.0.1:5173` theo bộ giá trị dev
ở trên). `assertAllowedOrigin()` trong `apps/api/src/auth/csrf.ts` từ chối mọi request có header `Origin` không
nằm trong `allowedOrigins` (= `PUBLIC_ORIGIN` gộp `ALLOWED_ORIGINS`); hàm này chạy khi đăng nhập và ở guard owner
cho các method có side effect. Dùng `PUBLIC_ORIGIN` khác origin Vite (ví dụ để nguyên giá trị production trong
`.env.example`) thì đăng nhập từ web dev sẽ bị từ chối.

## Chạy daemon `crewd` và app desktop ở chế độ dev

`apps/daemon` không có script `dev` — CLI `crewd` chạy từ bản đã build:

```sh
pnpm --filter @crew/daemon build
node apps/daemon/dist/cli.js <lệnh>   # ví dụ: pair, start, doctor
```

Toàn bộ lệnh con, biến môi trường (`CREW_HOME`, `CREW_TOKEN_STORE`) và vòng đời job của daemon nằm ở
[`../flows/daemon-runtime.md`](../flows/daemon-runtime.md).

App desktop (macOS only) có script `dev` riêng, đóng gói sẵn bản build:

```sh
pnpm --filter @crew/desktop dev   # pnpm build:app && electron-vite dev
```

Chi tiết tiến trình main/renderer và cách app desktop chạy `crewd` bên trong nằm ở
[`../flows/desktop-app.md`](../flows/desktop-app.md).

## Kiểm tra

```sh
pnpm -r typecheck                       # typecheck toàn repo
pnpm -r test                            # test toàn repo (tự tạo/migrate các DB test cần thiết)
pnpm --filter @crew/web test:e2e        # E2E của apps/web (playwright test)
pnpm lint                                # biome check .
pnpm -r build                           # build toàn repo
pnpm --filter @crew/docs-kit build      # build bundle crew-docs (node build.mjs), ra packages/docs-kit/dist/crew-docs.cjs
```

`pnpm --filter @crew/web test:e2e` là E2E riêng của `apps/web` (Playwright chạy cùng một dev server/API cục
bộ). Có một bộ E2E toàn hệ thống khác ở `e2e/` (`pnpm --filter @crew/e2e test:e2e`), dùng
`deploy/compose.yml`/`deploy/compose.test.yml` và cần Docker — đây là bộ khác, không phải bộ chạy trong bước
kiểm tra thường ngày ở trên.

## Triển khai

Môi trường thật chạy trên một VPS Ubuntu bằng Docker Compose, đứng sau một nginx biên có sẵn của máy chủ (không
publish cổng host riêng cho crew), chuyển sang HTTPS bằng certbot của chính máy chủ đó, tạo tài khoản owner qua
`scripts/seed-owner.sh`, backup Postgres mỗi đêm, và có CI kiểm type/lint/test/docs cùng build trước khi phát
hành. Toàn bộ quy trình, script và cấu hình nằm ở [`../flows/deployment.md`](../flows/deployment.md).

## Đưa một máy local vào hệ thống

Sau khi có một máy chủ (VPS) đang chạy, đưa một máy cục bộ (app desktop hoặc CLI `crewd`) vào hệ thống để nhận
job agent là một quy trình riêng cho chủ dự án, không phải bước dev tại đây — xem
[`../flows/daemon-setup.md`](../flows/daemon-setup.md).

## Lỗi thường gặp

- **Không kết nối được DB**: dùng nhầm cổng `5432` thay vì `55432`, hoặc container `crew-dev-postgres` chưa
  sẵn sàng (chưa chạy `docker compose -f docker-compose.dev.yml up -d --wait`, hoặc chạy thiếu cờ `--wait` nên
  lệnh tiếp theo chạy trước khi healthcheck đạt).
- **API không khởi động được**: thiếu `SESSION_SECRET` hoặc giá trị ngắn hơn 32 ký tự.
- **`DATABASE_URL is required` (khi chạy `db:migrate`) hoặc `Invalid API configuration: ...` (khi chạy `dev`)**:
  chưa export biến môi trường trước khi chạy lệnh — xem mục
  [Nạp biến môi trường trước khi chạy lệnh `apps/api`](#nạp-biến-môi-trường-trước-khi-chạy-lệnh-appsapi)
  (nguồn: `apps/api/src/db/migrate.ts` dòng 19–23, `apps/api/src/config.ts` `loadConfig()`).
- **Đăng nhập web thất bại khi chạy HTTP cục bộ**: `COOKIE_SECURE=true` trong khi truy cập qua HTTP — cookie
  `Secure` chỉ được trình duyệt gửi lại qua HTTPS; đặt `COOKIE_SECURE=false` khi chạy dev thuần HTTP.
- **Đăng nhập web bị từ chối (lỗi CSRF, "request origin is not allowed")**: `PUBLIC_ORIGIN` không khớp origin
  web đang chạy — đặt `PUBLIC_ORIGIN=http://127.0.0.1:5173` khi chạy Vite dev mặc định (nguồn:
  `apps/api/src/auth/csrf.ts` `assertAllowedOrigin()`).
- **Test bị từ chối chạy**: `TEST_DATABASE_URL` (hoặc biến tương đương của `apps/daemon`/`apps/desktop`) trỏ
  vào một DB không có hậu tố `_test` — cả ba bộ test đều tự chặn để tránh xoá nhầm dữ liệu không phải DB test.
