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
- **`apps/daemon`**: chưa có hành vi (xem `docs/flows.yaml` mục `unassigned`); vai trò dự kiến (kết nối SSE,
  lập lịch, chạy Claude Code agent qua Agent SDK) nằm trong `plans/260928-0613-crew-platform/plan.md`, chưa
  phải code đã triển khai.

## Lưu trữ dữ liệu

PostgreSQL qua Drizzle, schema khai báo ở `apps/api/src/db/schema.ts`, migration SQL ở `apps/api/drizzle/`.

- **Owner & phiên đăng nhập**: `owner` (mật khẩu argon2id, `totp_secret`, `recovery_code_hashes`), `sessions`
  (id phiên chỉ lưu hash SHA-256).
- **Máy & project**: `machines` (trạng thái online/paused/health/resources/running_jobs, index unique một máy
  giữ vai trò assistant), `projects` (key, mô tả, platform, `ui_test_mcp`, ngân sách/giới hạn con), `pairing_codes`,
  `machine_tokens` (chỉ lưu hash token), `machine_skills` (kho skill/MCP theo máy và theo project),
  `claim_requests` (yêu cầu nhận project hoặc vai trò assistant, có ràng buộc chờ duyệt).
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

## Dịch vụ bên ngoài

- Không có dịch vụ bên thứ ba nào được gọi trong `apps/api` hay `apps/web` ở trạng thái hiện tại (không email,
  không thanh toán, không hàng đợi ngoài). Agent runtime (Claude Code / Agent SDK) và các skill/MCP server chạy
  trên máy cục bộ qua daemon, thuộc phạm vi các giai đoạn sau (Phase 6, 7) — chưa có trong repo này.
- GitHub lưu mã nguồn; `crew-docs ci-workflow` sinh workflow GitHub Actions cho `packages/docs-kit`.

## Triển khai

- **Hiện tại (dev)**: `docker-compose.dev.yml` chạy một container Postgres 17 (`crew-dev-postgres`) trên
  `127.0.0.1:55432`, dùng chung cho DB dev và DB test (`_test` suffix). API và web chạy trực tiếp bằng
  `pnpm --filter @crew/api dev` / `pnpm --filter @crew/web dev`, không có reverse proxy.
- **Kế hoạch (chưa triển khai)**: theo `plans/260928-0613-crew-platform/plan.md`, sản phẩm chạy trên VPS Linux
  sau Caddy (HTTPS, SSE giữ kết nối lâu), `docker compose up -d`, backup Postgres hằng đêm — thuộc Phase 8
  (Deploy and E2E), chưa có file cấu hình nào trong repo hiện tại.
- Cấu hình API qua biến môi trường, xem `apps/api/.env.example` (`DATABASE_URL`, `SESSION_SECRET`,
  `PUBLIC_ORIGIN`, `ALLOWED_ORIGINS`, `TRUST_PROXY`, `COOKIE_SECURE`, `LOGIN_RATE_LIMIT_PER_MINUTE`,
  `BUDGET_TIMEZONE`, `LOG_LEVEL`).

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

Máy được ghép đôi qua `POST /v1/machines/pair` (public, cần mã pairing do owner tạo bằng TOTP), trả về token
`crew_mt_...` một lần duy nhất — chỉ SHA-256 của token được lưu (`machine_tokens`). Mọi route `/v1/daemon/*`
đi qua `machineGuard` (`apps/api/src/auth/machine-auth.ts`): kiểm tra hash token, `expires_at`, `revoked_at`
của token lẫn của máy trên từng request, rồi cập nhật `last_seen_at`/`online`. Phạm vi truy cập (project nào
máy được thao tác) được đọc lại mỗi request từ bảng `machines`/`projects`, không cache theo phiên.
