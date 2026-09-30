# 2P Crew

**2P Crew** là hệ thống ticket và docs kiểu Jira/Confluence: một chủ dự án (owner) con người tạo ticket trên
web và giao cho một **assistant agent**. Một daemon TypeScript trên từng máy cục bộ kết nối ra VPS, biết máy đó
sở hữu những project nào, và chạy các Claude Code agent (PM, dev, QC) qua Agent SDK cho project đó. PM làm rõ
yêu cầu với owner trong luồng bình luận của ticket, chia việc thành các subtask dev/QC, dev và QC triển khai và
nộp report, PM nghiệm thu rồi báo lại assistant để đóng ticket gốc. Mỗi project tuân theo một chuẩn docs chung
theo từng flow; agent đọc docs trước khi đọc code.

## Thành phần

| Thư mục | Vai trò |
|---------|---------|
| `apps/api` | Fastify 5 + Drizzle + PostgreSQL; route public, owner (session cookie) và daemon (bearer token). |
| `apps/web` | SPA React 19 + Vite + TanStack Router/Query, nói chuyện với API qua `apps/web/src/lib/api-client.ts` và nhận cập nhật realtime qua SSE. |
| `apps/daemon` | Daemon `crewd` chạy trên máy cục bộ, nhận sự kiện, lập lịch job, chạy Claude Code (PM/dev/QC/assistant) qua Agent SDK trong worktree riêng từng ticket. |
| `apps/desktop` | App Electron (macOS) đóng gói `crewd` làm cổng vào cho máy; cấu hình thật nằm trên web. |
| `packages/shared` | Schema zod dùng chung giữa API và web (hợp đồng request/response, sự kiện, manifest docs). |
| `packages/docs-kit` | CLI `crew-docs`, kiểm tra và sinh docs theo chuẩn `packages/docs-kit/STANDARD.md`. |

## Chạy nhanh

```sh
pnpm install
docker compose -f docker-compose.dev.yml up -d --wait

# apps/api không tự đọc .env — export biến trước khi chạy lệnh của apps/api, xem
# docs/guides/dev-setup.md mục "Nạp biến môi trường trước khi chạy lệnh apps/api"
export DATABASE_URL=postgres://crew:crew@127.0.0.1:55432/crew
export SESSION_SECRET=$(openssl rand -base64 32)
export PUBLIC_ORIGIN=http://127.0.0.1:5173
export COOKIE_SECURE=false

pnpm --filter @crew/api db:migrate
pnpm --filter @crew/api seed:owner --username <tên đăng nhập>
pnpm --filter @crew/api dev   # cổng 8787
pnpm --filter @crew/web dev   # cổng 5173, proxy /v1 sang API
```

Xem đầy đủ tại [`docs/guides/dev-setup.md`](docs/guides/dev-setup.md) (biến môi trường, lỗi thường gặp, chạy
daemon/app desktop ở chế độ dev).

## Tài liệu

- [Cài đặt môi trường dev](docs/guides/dev-setup.md): từ máy trắng tới lúc chạy được API, web, daemon, app desktop ở chế độ dev.
- [Hướng dẫn sử dụng](docs/guides/user-guide.md): thao tác trên web cho chủ dự án, không cần biết code.
- [Quy trình ticket](docs/guides/workflow.md): một yêu cầu đi qua những bước nào từ lúc tạo tới lúc merge.
- [Bảng tra API](docs/guides/api-reference.md): danh sách endpoint, dẫn tới schema zod và trang flow sở hữu route.
- [Hướng dẫn đóng góp](docs/CONTRIBUTING.md): quy ước, thứ tự đọc docs trước khi sửa code, docs đi cùng mỗi commit.
- [Tổng quan docs](docs/index.md): mục đích, stack, bản đồ module và danh sách flow.
- [Kiến trúc](docs/architecture.md): thành phần, nơi lưu dữ liệu, dịch vụ bên ngoài, cách triển khai.
- [Triển khai VPS](docs/flows/deployment.md): quy trình và cấu hình triển khai, vận hành.
- [Cài đặt máy local](docs/flows/daemon-setup.md): đưa một máy local mới vào hệ thống.
- [AGENTS.md](AGENTS.md): hướng dẫn cho agent làm việc trong repo này.

## Lệnh thường dùng

| Lệnh | Ý nghĩa |
|------|---------|
| `pnpm -r typecheck` | Typecheck toàn repo. |
| `pnpm -r test` | Test toàn repo. |
| `pnpm lint` | Biome check toàn repo. |
| `pnpm -r build` | Build toàn repo. |
