# Hướng dẫn làm việc trong Crew v2

Đọc `docs/index.md` trước khi đọc code. Tra `crew-docs where <file>` hoặc `crew-docs flow <id>` từ một
Git checkout có `v2/` làm gốc, rồi đọc trang `docs/flows/<id>.md` trước khi sửa file của flow.

`v2/` là package miền độc lập, không import code Crew v1. Dùng Node.js ≥ 24.12 và pnpm 10.32.1.

- Cài dependency: `pnpm install --ignore-workspace` từ `v2/`.
- Chạy test: `pnpm test`.
- Kiểm tra kiểu: `pnpm typecheck`.
- Docs theo `docs/flows.yaml`; cập nhật trang flow cùng thay đổi source, rồi chạy `crew-docs generate` và
  `crew-docs check --all` trong checkout có `v2/` làm Git root.

Prose và docs viết tiếng Việt. Identifier, tên file, route và key YAML giữ tiếng Anh. Commit theo
Conventional Commits; không commit credential.
