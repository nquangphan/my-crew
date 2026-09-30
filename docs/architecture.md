# Kiến trúc

## Thành phần

- **`apps/api`** (Fastify): một tiến trình duy nhất, xây bằng `buildApp()` (`apps/api/src/app.ts`). Đăng ký ba
  nhóm route: public (`/v1/health`, `/v1/machines/pair`), owner (bọc `ownerGuard`, chỉ đọc session cookie) và
  daemon (bọc `machineGuard`, chỉ đọc bearer token — cookie và bearer không bao giờ dùng lẫn nhau trên cùng
  route). Owner đăng nhập qua web; daemon (chạy trên máy cục bộ, thay cho agent) gọi các route `/v1/daemon/*`
  bằng token máy.
- **`apps/web`**: SPA React nói chuyện với API qua `apps/web/src/lib/api-client.ts` (có kiểm tra schema zod) và
  nhận cập nhật realtime qua SSE (`apps/web/src/lib/live-events.ts`).
- **`packages/shared`**: nguồn sự thật cho hợp đồng request/response, sự kiện và enum trạng thái — cả API và
  web import cùng một schema zod, không định nghĩa lại.
- **`packages/docs-kit`**: đóng gói thành một bundle CommonJS (`crew-docs.cjs`) để hook git và CI chạy không
  cần cài dependency; đọc/ghi `docs/flows.yaml` và các file dưới `docs/`.
- **`apps/daemon`**: daemon `crewd` chạy trên máy cục bộ của chủ dự án (CLI + thư viện `createDaemon()` dùng
  chung với app desktop). Giữ kết nối SSE `/v1/daemon/stream`, biến sự kiện thành job và lập lịch theo slot
  máy (`docs/flows/daemon-scheduling.md`), chạy Claude Code (PM, dev, QC, assistant) qua Agent SDK trong một
  worktree git riêng mỗi ticket với bộ công cụ ticket và guard riêng theo vai trò
  (`docs/flows/agent-runs.md`, `docs/flows/agent-workspace.md`), dọn tiến trình/port/container sau mỗi job
  (`docs/flows/resource-hygiene.md`), và tự kiểm tra sức khỏe máy (`crewd doctor`,
  `docs/flows/daemon-health.md`). Hành vi theo vai trò (prompt, cổng docs-init/UI-test, model, thử lại, bọc dữ
  liệu không tin cậy) sống trong `apps/daemon/src/roles` (`docs/flows/agent-roles.md`); nghiệm thu của PM merge
  cục bộ kết quả các subtask, chạy cổng trước khi đẩy và push lên nhánh mặc định, không cần chủ dự án tự
  merge PR (`docs/flows/local-merge.md`). Prompt vai trò, quy tắc guard/QC, bảng model, tài nguyên máy và MCP
  tắt theo dự án và thư mục dự án theo máy là **cài đặt trên server** sửa trên web, không còn cố định trong
  bundle hay `~/.crew/config.yaml`: cấu hình một job thực sự chạy với là cài đặt server chồng lên
  `config.yaml` cục bộ (`effectiveConfig()`), cache lại ở `~/.crew/settings-cache.json` để dùng khi server
  không tới được (`docs/flows/server-settings.md`). Chủ dự án cũng điều khiển một máy đang sống ngay từ web
  (tạm dừng, kiểm tra sức khỏe và fix, dò lại skill/MCP, cài BMAD, job gần đây, log, gỡ project/vai trò trợ
  lý) qua một danh sách hành động cố định kiểm ở cả server và daemon — không có cách chạy lệnh tuỳ ý trên máy
  (`docs/flows/machine-control.md`).
- **`apps/desktop`**: app Electron (macOS) đóng gói `crewd` cho chủ dự án không quen dòng lệnh — một **cổng
  vào** (gateway) cho máy đó, không phải nơi cấu hình: sau khi cài đặt xong (server, ghép máy, đăng nhập
  Claude) chỉ còn trang "Trạng thái máy" và bộ chọn thư mục; mọi project, tài nguyên, model, prompt, quy tắc,
  MCP và cài đặt khác nằm trên web (`docs/flows/server-settings.md`) — **web là nguồn sự thật**, app chỉ đọc
  lại và link tới đó. Tiến trình main quản lý cửa sổ, tray, mở cùng máy và cập nhật
  (`docs/flows/desktop-app.md`); daemon thật và các thao tác trình cài đặt/sức khỏe chạy trong một
  `utilityProcess` riêng, nên đóng cửa sổ hay UI crash không dừng job đang chạy. Renderer React
  (`docs/flows/desktop-ui.md`) chỉ nói chuyện với hai tiến trình đó qua một cầu IPC có kiểu
  (`packages/shared/src/desktop-ipc.ts`), sandbox, không có Node. Từ bản `0.3.0`, app tách "shell" (main,
  preload, native module — chỉ đổi bằng dmg mới) khỏi "runtime" (daemon host + renderer) có thể **cập nhật
  nóng**: server ký một bản, máy tải và tự kiểm chữ ký/hash trước khi chuyển sang chạy nó, không cần cài lại;
  đi cùng đó là một danh tính ký code tự tạo ổn định qua các bản build (macOS không hỏi lại quyền riêng tư mỗi
  lần cập nhật) và một bước hỏi Full Disk Access rõ ràng, đúng một lần (`docs/flows/runtime-updates.md`).

## Lưu trữ dữ liệu

PostgreSQL qua Drizzle, schema khai báo ở `apps/api/src/db/schema.ts`, migration SQL ở `apps/api/drizzle/`.

- **Owner & phiên đăng nhập**: `owner` (mật khẩu argon2id; cột `totp_secret`, `totp_last_step`,
  `recovery_code_hashes` còn trong bảng nhưng không flow nào còn đọc hay ghi, xem `docs/flows/owner-auth.md`), `sessions`
  (id phiên chỉ lưu hash SHA-256); `notice_reads` (owner đã đọc thông báo nào — khoá `owner_id`+`event_seq`,
  dùng để tính số chưa đọc dùng chung giữa các thiết bị, xem `docs/flows/event-delivery.md`).
- **Máy & project**: `machines` (trạng thái online/paused/health/resources/running_jobs/waiting_jobs/
  failed_jobs, index unique một máy giữ vai trò assistant), `projects` (key, mô tả, platform, `ui_test_mcp`,
  ngân sách/giới hạn con), `pairing_codes`,
  `machine_tokens` (chỉ lưu hash token), `machine_skills` (kho skill/MCP theo máy và theo project),
  `claim_requests` (yêu cầu nhận project hoặc vai trò assistant, có ràng buộc chờ duyệt), `project_change_requests`
  (máy sở hữu xin đổi `platform`/`ui_test_mcp` của project mình, chỉ áp dụng khi chủ dự án duyệt bằng một cú
  nhấp xác nhận trên web; tối đa
  một yêu cầu `pending` mỗi project, xem `docs/flows/project-claims.md`).
- **Ticket & vòng đời**: `ticket_counters` (cấp số theo scope), `tickets` (loại, cha/con, người nhận, trạng
  thái, `depends_on`/`flows` kiểu mảng có index GIN, cặp dev↔QC qua `pairs_with`/`origin_dev_id`, cờ ngân sách),
  `comments`, `ticket_reports` (một report hiện hành mỗi ticket, các trường skill/MCP đã chọn và đã dùng,
  `tests_run`, `left_resources`).
- **Sự kiện (outbox)**: `events` — mỗi hàng có `seq` (bigserial, gán khi transaction commit qua trigger có
  khoá) dùng làm cursor SSE; `target_machine_id` null nghĩa là chỉ owner stream nhận.
- **Idempotency & ngân sách**: `idempotency_keys` (khoá theo máy + key, lưu cả response để phát lại),
  `budgets_usage` (chi phí theo project theo ngày, múi giờ cấu hình qua `BUDGET_TIMEZONE`).
- **Docs snapshot**: `docs_snapshots` (bản mới nhất mỗi project: commit, branch, manifest `flows.yaml` đã
  parse), `docs_files` (nội dung từng trang đã đồng bộ, khoá theo project + path).
- **Cài đặt server**: `settings_revisions` (mỗi sửa là một bản có tác giả/giờ/ghi chú của một
  `(kind, scope, machine, project, name)` — prompt, quy tắc guard/QC, model, tài nguyên, thư mục dự án theo
  máy, MCP tắt theo dự án), cột `machines.settings_state` (bản cài đặt máy đó báo qua heartbeat mới nhất). Xem
  `docs/flows/server-settings.md`.
- **Lệnh từ xa**: `machine_commands` (mỗi hàng một hành động owner gửi từ web cho một máy — action, tham số,
  trạng thái `pending`/`running`/`done`/`failed`/`expired`, kết quả hoặc lỗi). Xem
  `docs/flows/machine-control.md`.
- **Trạng thái daemon cục bộ** (`~/.crew/state.db` trên từng máy, SQLite qua `better-sqlite3`, không phải
  Postgres): `jobs` (job agent đang chờ/chạy/đã xong, tối đa một job hoạt động mỗi ticket, cột
  `settings_revision` là bản cài đặt server job đó bắt đầu với), `meta` (cursor sự kiện, hạn token, kho
  skill/MCP đã probe), `pending_wakeups`, `tool_log`, `job_cleanup`. Cạnh đó,
  `~/.crew/settings-cache.json` giữ bản cài đặt server tốt gần nhất (không phải SQLite). Xem
  `docs/flows/daemon-runtime.md`, `docs/flows/server-settings.md`.

## Dịch vụ bên ngoài

- Không có dịch vụ bên thứ ba nào được gọi trong `apps/api` hay `apps/web` (không email, không thanh toán,
  không hàng đợi ngoài).
- Daemon (`apps/daemon`) chạy Claude Code qua Agent SDK trên máy cục bộ, dưới đăng nhập gói đăng ký của chủ
  dự án (không `ANTHROPIC_API_KEY`, xem `docs/flows/daemon-health.md`). Docker, git, `lsof`, `ps` là công cụ
  dòng lệnh cục bộ mà daemon gọi (worktree, dọn tài nguyên, kiểm tra sức khỏe) — không phải dịch vụ mạng.
- GitHub lưu mã nguồn; `crew-docs ci-workflow` sinh workflow GitHub Actions cho `packages/docs-kit`. App
  desktop (`apps/desktop`) cũng phát hành qua GitHub Releases của cùng repo và tự kiểm bản mới từ đó
  (`docs/flows/desktop-app.md`); mỗi bản phát hành có một dmg và một zip cho mỗi kiến trúc (`arm64`, `x64`),
  mỗi app (và cả dmg, zip dựng từ nó) chỉ chứa Claude Code binary và native module của kiến trúc của nó. Hiện
  ký ad-hoc, chưa notarize, nên lần đầu mở phải bấm chuột phải → Open và cập nhật tự động rơi về đường link tải
  đúng dmg kiến trúc máy đó thay vì cài thẳng; zip đã được dựng và đăng sẵn cho khi bật ký (Squirrel.Mac cài từ
  zip).

## Triển khai

- **Dev**: `docker-compose.dev.yml` chạy một container Postgres 17 (`crew-dev-postgres`) trên
  `127.0.0.1:55432`, dùng chung cho DB dev và DB test (`_test` suffix). API và web chạy trực tiếp bằng
  `pnpm --filter @crew/api dev` / `pnpm --filter @crew/web dev`, không có reverse proxy.
- **VPS**: `docker compose` (`deploy/compose.yml`) sau một nginx biên đã có sẵn của máy chủ (không Caddy,
  crew không publish cổng host nào), backup Postgres hằng đêm, chuyển HTTPS bằng certbot của máy chủ đó — xem
  `docs/flows/deployment.md` cho quy trình và toàn bộ file cấu hình.
- Cấu hình API qua biến môi trường, xem `apps/api/.env.example` (`DATABASE_URL`, `SESSION_SECRET`,
  `PUBLIC_ORIGIN`, `ALLOWED_ORIGINS`, `TRUST_PROXY`, `COOKIE_SECURE`, `LOGIN_RATE_LIMIT_PER_MINUTE`,
  `BUDGET_TIMEZONE`, `LOG_LEVEL`) — trên VPS các biến này nằm trong `/opt/crew/.env`, mẫu ở
  `deploy/.env.example`.
- Cách chủ dự án đưa một máy local mới vào hệ thống (app desktop hoặc CLI `crewd`): `docs/flows/daemon-setup.md`.

## Phát sự kiện và SSE (outbox + cursor)

`events` là bảng outbox: mọi thay đổi đáng thông báo được ghi vào đó trong cùng transaction với thay đổi dữ
liệu. Một bigserial `id` được cấp lúc insert, nhưng thứ tự phát đi dùng cột `seq` riêng — được gán bởi một
deferred constraint trigger tại thời điểm **commit**, dưới một advisory lock theo transaction. Nhờ vậy, một
client đã thấy `seq = n` chắc chắn đã thấy mọi sự kiện có `seq` nhỏ hơn đã commit, kể cả khi các transaction
commit không theo đúng thứ tự chúng bắt đầu. `appendEvents` phát `pg_notify('events_new')` lúc commit;
`EventBus` (`apps/api/src/realtime/event-bus.ts`) lắng nghe kênh đó (postgres.js tự LISTEN lại sau khi mất kết
nối) và có vòng poll 5s dự phòng. Mỗi SSE stream (`apps/api/src/realtime/sse.ts`) subscribe trước, phát lại các
sự kiện có `seq` lớn hơn cursor client gửi (`Last-Event-ID` hoặc `?cursor=`), rồi mới flush hàng đợi realtime,
khử trùng lặp theo `seq`.

## Xác thực máy (machine auth)

Máy được ghép đôi qua `POST /v1/machines/pair` (public, cần mã pairing owner tạo bằng session + CSRF), trả về token
`crew_mt_...` một lần duy nhất — chỉ SHA-256 của token được lưu (`machine_tokens`). Mọi route `/v1/daemon/*`
đi qua `machineGuard` (`apps/api/src/auth/machine-auth.ts`): kiểm tra hash token, `expires_at`, `revoked_at`
của token lẫn của máy trên từng request, rồi cập nhật `last_seen_at`/`online`. Phạm vi truy cập (project nào
máy được thao tác) được đọc lại mỗi request từ bảng `machines`/`projects`, không cache theo phiên.
