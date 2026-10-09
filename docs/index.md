# Tổng quan

## Mục đích

**2P Crew** là hệ thống ticket và docs có agent Claude Code làm việc trên máy của chủ dự án. Từ Crew v3, sản
phẩm chạy trên bản fork Paperclip (nằm ở repo khác). Repo này giữ phần công cụ đi kèm: CLI `crew-mac` để cài và
kiểm Mac chạy agent, CLI `crew-docs` để áp chuẩn docs theo flow, cùng tài liệu và kế hoạch của dự án. Agent đọc
docs trước khi đọc code.

## Stack

- pnpm TypeScript monorepo, Node ≥ 22.
- `apps/crew-mac`: CLI TypeScript thuần Node (không dependency runtime), test bằng Vitest.
- `packages/docs-kit`: CLI `crew-docs` (bundle CommonJS đơn file bằng esbuild; dùng `zod`, `yaml`, `picomatch`)
  kiểm tra và sinh docs theo chuẩn ở `packages/docs-kit/STANDARD.md`.

## Bản đồ module

| Thư mục | Vai trò |
|---------|---------|
| `apps/crew-mac/src` | CLI `crew-mac` cho Crew v3: cài sshd phiên desktop, key Paperclip, PATH, kiểm sức khỏe Mac (kể cả hộp thoại quyền macOS) và dọn process `claude` mồ côi |
| `packages/docs-kit/src` | Lệnh CLI, luật kiểm tra R1–R7, sinh block tự động, cài hook |
| `packages/docs-kit/templates` | Template `AGENTS.md`, `index.md`, `architecture.md`, `flow.md`, `flows.yaml` |

## Danh sách flow

<!-- crew-docs:flows:start -->
| Flow | Id | Điểm vào |
|------|----|----------|
| [Kiểm tra chuẩn docs (crew-docs)](flows/docs-check.md) | `docs-check` | `packages/docs-kit/src/bin.ts`, `packages/docs-kit/src/cli.ts` |
| [Hook git và CI của crew-docs](flows/docs-hooks.md) | `docs-hooks` | `packages/docs-kit/src/commands/install-hooks.ts`, `packages/docs-kit/src/commands/ci-workflow.ts` |
| [App macOS 2P Crew (khung, tray, cửa sổ, trạng thái, cầu nối crew-mac)](flows/mac-app.md) | `mac-app` | `apps/mac-app/src/main/index.ts` |
| [App macOS đăng nhập Paperclip (cli-auth), board key trong Keychain và client REST](flows/mac-app-paperclip.md) | `mac-app-paperclip` | `apps/mac-app/src/main/paperclip/client.ts`, `apps/mac-app/src/main/paperclip/register.ts` |
| [Dừng process của run và dọn process mồ côi trên Mac (crew-mac stop-run, reap)](flows/mac-orphan-reaper.md) | `mac-orphan-reaper` | `apps/crew-mac/src/commands/stop-run.ts`, `apps/crew-mac/src/reaper/reap.ts` |
| [Cài và kiểm Mac chạy agent (crew-mac)](flows/mac-setup.md) | `mac-setup` | `apps/crew-mac/src/cli.ts` |
| [Ghim Superpowers và chặn nạp skill chéo trên Mac](flows/mac-workflows.md) | `mac-workflows` | `apps/crew-mac/src/workflows/install.ts`, `apps/crew-mac/src/commands/workflow-check.ts` |
<!-- crew-docs:flows:end -->

## Cách dùng docs

- `docs/architecture.md`: thành phần, nơi lưu dữ liệu, dịch vụ bên ngoài, cách triển khai.
- `docs/flows/<id>.md`: mỗi flow có một trang.
- `docs/flows.yaml`: nguồn sự thật flow ↔ file, cho máy đọc.
- `docs/files.md`: tra ngược file → flow, sinh tự động bằng `crew-docs generate`.
- `docs/CONTRIBUTING.md`: quy ước, thứ tự đọc docs trước khi sửa code, docs đi cùng mỗi commit.
- `docs/superpowers/specs/`: đặc tả thiết kế (lịch sử quyết định, không phải mô tả hiện trạng).
