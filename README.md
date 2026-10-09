# 2P Crew

**2P Crew** là hệ thống ticket và docs có agent Claude Code làm việc trên máy của chủ dự án. Sản phẩm (Crew v3)
chạy trên bản fork Paperclip nằm ở repo khác; repo này giữ công cụ đi kèm, tài liệu và kế hoạch của dự án.

## Thành phần

| Thư mục | Vai trò |
|---------|---------|
| `apps/crew-mac` | CLI `crew-mac`: cài và kiểm Mac chạy agent (sshd phiên desktop, key Paperclip, PATH, quyền macOS), dọn process `claude` mồ côi. |
| `packages/docs-kit` | CLI `crew-docs`: kiểm tra và sinh docs theo chuẩn `packages/docs-kit/STANDARD.md`; hook git và CI. |
| `docs/` | Docs theo flow, `docs/flows.yaml` là manifest flow ↔ file. |
| `plans/` | Kế hoạch và báo cáo (lịch sử). |

## Chạy nhanh

```sh
pnpm install
pnpm --filter @crew/docs-kit build   # ra packages/docs-kit/dist/crew-docs.cjs
pnpm --filter @crew/mac build        # ra apps/crew-mac/dist/cli.js
```

## Tài liệu

- [Tổng quan docs](docs/index.md): mục đích, stack, bản đồ module và danh sách flow.
- [Kiến trúc](docs/architecture.md): thành phần, nơi lưu dữ liệu, dịch vụ bên ngoài.
- [Hướng dẫn đóng góp](docs/CONTRIBUTING.md): quy ước, thứ tự đọc docs trước khi sửa code, docs đi cùng mỗi commit.
- [AGENTS.md](AGENTS.md): hướng dẫn cho agent làm việc trong repo này.

## Lệnh thường dùng

| Lệnh | Ý nghĩa |
|------|---------|
| `pnpm -r typecheck` | Typecheck toàn repo. |
| `pnpm -r test` | Test toàn repo. |
| `pnpm lint` | Biome check toàn repo. |
| `pnpm -r build` | Build toàn repo. |
