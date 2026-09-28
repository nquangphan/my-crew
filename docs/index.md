# Tổng quan

## Mục đích

**2P Crew** là hệ thống ticket và docs kiểu Jira/Confluence: một chủ dự án (owner) con người tạo ticket trên
web và giao cho một **assistant agent**. Một daemon TypeScript trên từng máy cục bộ kết nối ra VPS, biết máy đó
sở hữu những project nào, và chạy các Claude Code agent (PM, dev, QC) qua Agent SDK cho project đó. PM làm rõ
yêu cầu với owner trong luồng bình luận của ticket, chia việc thành các subtask dev/QC, dev và QC triển khai và
nộp report, PM nghiệm thu rồi báo lại assistant để đóng ticket gốc. Mỗi project tuân theo một chuẩn docs chung
theo từng flow; agent đọc docs trước khi đọc code.

## Stack

- pnpm TypeScript monorepo, Node ≥ 22.
- `apps/api`: Fastify 5, Drizzle ORM, PostgreSQL (qua `postgres`/`postgres-js`), zod 4.
- `apps/web`: React 19, Vite, TanStack Router/Query, Tailwind v4, Radix UI, `@dnd-kit`, `react-markdown`.
- `packages/shared`: schema zod dùng chung giữa API và web (hợp đồng request/response, sự kiện, manifest docs).
- `packages/docs-kit`: CLI `crew-docs` (bundle CommonJS đơn file) kiểm tra và sinh docs theo chuẩn ở
  `packages/docs-kit/STANDARD.md`.
- `apps/daemon`: chỗ giữ chỗ, hành vi thật (kết nối SSE, lập lịch, chạy agent) đến ở giai đoạn sau.

## Bản đồ module

| Thư mục | Vai trò |
|---------|---------|
| `apps/api/src/routes` | Route Fastify cho owner (session cookie) và daemon (bearer token) |
| `apps/api/src/services` | Nghiệp vụ: ticket, report, budget, claim, machine, docs, idempotency |
| `apps/api/src/auth` | Đăng nhập owner (mật khẩu + TOTP), CSRF, xác thực máy |
| `apps/api/src/realtime` | Event bus (LISTEN/NOTIFY + poll dự phòng) và SSE |
| `apps/api/src/db` | Kết nối Postgres, schema Drizzle, migrate |
| `apps/api/drizzle` | File SQL migration |
| `apps/web/src/routes` | Trang ứng dụng (TanStack Router, định tuyến bằng code) |
| `apps/web/src/components` | Component UI: board, ticket, docs, admin |
| `apps/web/src/layout` | Khung ứng dụng: shell, sidebar, breadcrumb, quick search |
| `apps/web/src/lib` | API client, query, tiện ích UI dùng chung |
| `packages/shared/src` | Schema zod: ticket, project, machine, event, docs, workflow trạng thái |
| `packages/docs-kit/src` | Lệnh CLI, luật kiểm tra R1–R7, sinh block tự động, cài hook |
| `packages/docs-kit/templates` | Template `AGENTS.md`, `index.md`, `architecture.md`, `flow.md`, `flows.yaml` |
| `apps/daemon/src` | Chỗ giữ chỗ của daemon |

## Danh sách flow

<!-- crew-docs:flows:start -->
| Flow | Id | Điểm vào |
|------|----|----------|
| [Nền tảng API](flows/api-platform.md) | `api-platform` | `apps/api/src/server.ts` |
| [REST API cho daemon](flows/daemon-api.md) | `daemon-api` | `apps/api/src/routes/daemon-routes.ts` |
| [Kiểm tra chuẩn docs (crew-docs)](flows/docs-check.md) | `docs-check` | `packages/docs-kit/src/bin.ts`, `packages/docs-kit/src/cli.ts` |
| [Hook git và CI của crew-docs](flows/docs-hooks.md) | `docs-hooks` | `packages/docs-kit/src/commands/install-hooks.ts`, `packages/docs-kit/src/commands/ci-workflow.ts` |
| [Đồng bộ và xem docs](flows/docs-sync-viewer.md) | `docs-sync-viewer` | `apps/api/src/routes/docs-routes.ts`, `apps/web/src/routes/project-docs.tsx` |
| [Phát sự kiện và SSE](flows/event-delivery.md) | `event-delivery` | `apps/api/src/routes/stream-routes.ts` |
| [Ghép máy và xác thực máy](flows/machine-pairing.md) | `machine-pairing` | `apps/api/src/routes/machine-routes.ts` |
| [Đăng nhập chủ dự án](flows/owner-auth.md) | `owner-auth` | `apps/api/src/routes/auth-routes.ts`, `apps/web/src/routes/login.tsx` |
| [Dự án và quyền sở hữu máy](flows/project-claims.md) | `project-claims` | `apps/api/src/routes/project-routes.ts` |
| [Vòng đời ticket](flows/ticket-lifecycle.md) | `ticket-lifecycle` | `apps/api/src/routes/ticket-routes.ts`, `apps/api/src/routes/comment-routes.ts`, `apps/api/src/routes/report-routes.ts` |
| [Inbox, dự án và máy trên web](flows/web-admin.md) | `web-admin` | `apps/web/src/routes/inbox.tsx`, `apps/web/src/routes/projects.tsx`, `apps/web/src/routes/project-settings.tsx`, `apps/web/src/routes/machines.tsx` |
| [Khung ứng dụng web](flows/web-shell.md) | `web-shell` | `apps/web/src/main.tsx`, `apps/web/src/router.tsx` |
| [Board, danh sách và ticket trên web](flows/web-tickets.md) | `web-tickets` | `apps/web/src/routes/board.tsx`, `apps/web/src/routes/list.tsx`, `apps/web/src/routes/ticket-detail.tsx`, `apps/web/src/routes/my-requests.tsx` |
<!-- crew-docs:flows:end -->

## Cách dùng docs

- `docs/architecture.md`: thành phần, nơi lưu dữ liệu, dịch vụ bên ngoài, cách triển khai.
- `docs/flows/<id>.md`: mỗi flow nghiệp vụ hoặc kỹ thuật có một trang.
- `docs/flows.yaml`: nguồn sự thật flow ↔ file, cho máy đọc.
- `docs/files.md`: tra ngược file → flow, sinh tự động bằng `crew-docs generate`.
