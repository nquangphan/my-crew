# Kiến trúc

## Thành phần

Sản phẩm **Crew v3** chạy trên bản fork Paperclip nằm ở repo khác; repo này không chứa server, web hay daemon.
Ở đây chỉ còn hai gói công cụ cùng tài liệu và kế hoạch của dự án.

- **`apps/crew-mac`** (`@crew/mac`): CLI `crew-mac` cài và kiểm máy Mac chạy agent — sshd riêng trong phiên
  desktop để đọc đăng nhập Claude trong Keychain, khoá `authorized_keys` cho Paperclip, PATH và wrapper
  `claude`, LaunchAgent dọn process mồ côi, bản Superpowers ghim, và báo cáo `status` (kể cả hộp thoại quyền
  macOS). Xem `docs/flows/mac-setup.md`, `docs/flows/mac-orphan-reaper.md`, `docs/flows/mac-workflows.md`.
- **`packages/docs-kit`** (`@crew/docs-kit`): CLI `crew-docs` đóng gói thành một bundle CommonJS
  (`packages/docs-kit/dist/crew-docs.cjs`) để hook git, CI và `crew-mac` chạy không cần cài dependency; đọc và
  ghi `docs/flows.yaml` cùng các file dưới `docs/`. Schema của `flows.yaml` nằm ở
  `packages/docs-kit/src/flows-schema.ts`. Xem `docs/flows/docs-check.md`, `docs/flows/docs-hooks.md`.
- **`docs/`, `plans/`**: tài liệu theo flow (`docs/flows`), đặc tả thiết kế (`docs/superpowers/specs`) và lịch
  sử kế hoạch, báo cáo (`plans/`, chỉ để tra cứu).
- **`.claude/`, `.codex/`, `.agents/`, `.agentkit/`, `.githooks/`**: cấu hình agent và hook git của repo.

## Lưu trữ dữ liệu

Repo không có cơ sở dữ liệu. `crew-mac` ghi trạng thái cài đặt vào `~/.crew` và `~/Library/LaunchAgents` trên
máy Mac; chi tiết ở `docs/flows/mac-setup.md`.

## Dịch vụ bên ngoài

- GitHub lưu mã nguồn; `crew-docs ci-workflow` sinh workflow GitHub Actions cho repo áp dụng chuẩn docs, và
  `.github/workflows/ci.yml` chạy typecheck, lint, `crew-docs check`, test và build của repo này.
- `crew-mac` gọi các công cụ cục bộ của Mac (`launchctl`, `sshd`, `tailscale`, `ps`, `git`) — không có dịch vụ
  mạng nào khác.

## Triển khai

Không có thứ gì để triển khai từ repo này: `crew-mac` chạy trực tiếp trên máy Mac (`pnpm --filter @crew/mac build`
rồi `node apps/crew-mac/dist/cli.js`), còn server Crew v3 được vận hành cùng fork Paperclip.
