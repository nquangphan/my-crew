# AGENTS.md

Hướng dẫn cho agent (và người) làm việc trong repo này. Repo `crew` là pnpm TypeScript monorepo cho **2P
Crew**: `apps/api` (Fastify + Drizzle + PostgreSQL), `apps/web` (React 19 + Vite + TanStack Router/Query),
`apps/daemon` (daemon `crewd` chạy agent Claude Code trên máy local qua Agent SDK), `packages/shared` (schema
zod dùng chung) và `packages/docs-kit` (CLI `crew-docs`).

## Đọc trước tiên

1. Đọc `docs/index.md` TRƯỚC khi đọc code.
2. Tìm flow liên quan: `crew-docs where <file>` cho biết file thuộc flow nào, `crew-docs flow <id>` liệt kê
   đúng các file của một flow.
3. Đọc `docs/flows/<id>.md` của flow đó, rồi mới mở các file nó liệt kê.

## Lệnh

- Cài đặt: `pnpm install`
- Database dev/test (Postgres, container `crew-dev-postgres` trên `127.0.0.1:55432` — không bao giờ dùng cổng
  5432 mặc định): `docker compose -f docker-compose.dev.yml up -d --wait`
- Typecheck: `pnpm -r typecheck`
- Test (tất cả package): `pnpm -r test`
- Test E2E (web, Playwright, có server và DB riêng): `pnpm --filter @crew/web test:e2e`
- Lint (biome, toàn repo): `pnpm lint`
- Build (tất cả package): `pnpm -r build`
- Chạy API dev (cổng 8787 mặc định, cần `DATABASE_URL`, `SESSION_SECRET` ≥ 32 ký tự, `PUBLIC_ORIGIN`):
  `pnpm --filter @crew/api dev`
- Chạy web dev (cổng 5173, proxy `/v1` sang API): `pnpm --filter @crew/web dev`
- Migrate DB: `pnpm --filter @crew/api db:migrate`
- Build bundle `crew-docs`: `pnpm --filter @crew/docs-kit build`

Biến môi trường đầy đủ của API nằm ở `apps/api/.env.example`.

## Quy ước

- Toàn bộ UI và docs viết bằng tiếng Việt; identifier, đường dẫn file, route, tên bảng và key YAML giữ tiếng
  Anh.
- Giờ hiển thị theo múi giờ `Asia/Ho_Chi_Minh`.
- Commit theo Conventional Commits.
- Lint/format bằng Biome (`biome.json` ở gốc repo); không dùng ESLint/Prettier.

## Docs đi cùng mỗi commit

- Commit nào đổi file nguồn cũng phải sửa `docs/flows/<id>.md` của mọi flow chứa file đó (luật R3).
- File nguồn mới phải có mặt trong một flow của `docs/flows.yaml` (luật R2).
- Sửa `docs/flows.yaml` xong thì chạy bundle `crew-docs generate` (build bằng
  `pnpm --filter @crew/docs-kit build`, ra `packages/docs-kit/dist/crew-docs.cjs`).
- Không sửa `.claude/**`, `.githooks/**`, `CLAUDE.md`, `AGENTS.md` hay các mục `source`, `shared`, `unassigned` của
  `docs/flows.yaml` khi ticket không được chủ dự án cho phép (luật R6) — commit như vậy cần trailer
  `Crew-Owner-Approved: <ticket-key>`.
- Commit khởi tạo docs (thêm `docs/flows.yaml` lần đầu) cần trailer `Crew-Docs-Init: true`.
- Không bao giờ commit credential (luật R7).
- Kiểm tra trước khi commit: `crew-docs check --staged`.
