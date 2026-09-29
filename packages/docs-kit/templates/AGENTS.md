# AGENTS.md

Hướng dẫn cho agent (và người) làm việc trong repo này.

## Đọc trước tiên

1. Đọc `docs/index.md` TRƯỚC khi đọc code.
2. Tìm flow liên quan: `crew-docs where <file>` cho biết file thuộc flow nào, `crew-docs flow <id>` liệt kê
   đúng các file của một flow.
3. Đọc `docs/flows/<id>.md` của flow đó, rồi mới mở các file nó liệt kê.

## Lệnh

- Cài đặt: `<điền lệnh>`
- Build: `<điền lệnh>`
- Test: `<điền lệnh>`
- Lint: `<điền lệnh>`

## Quy ước

- <điền quy ước code của repo>

## Docs đi cùng mỗi commit

- Commit nào đổi file nguồn cũng phải sửa `docs/flows/<id>.md` của mọi flow chứa file đó (luật R3).
- File nguồn mới phải có mặt trong một flow của `docs/flows.yaml` (luật R2).
- Sửa `docs/flows.yaml` xong thì chạy `crew-docs generate`.
- Không sửa `.claude/**`, `.githooks/**`, `CLAUDE.md`, `AGENTS.md` (file này) hay các mục `source`, `shared`,
  `unassigned` của `docs/flows.yaml` khi ticket không được chủ dự án cho phép (luật R6).
- Không bao giờ commit credential (luật R7).
- Kiểm tra trước khi commit: `crew-docs check --staged`.
