# Tổng quan Crew v2

## Mục đích

`@crew-v2/domain` là thư viện miền độc lập để kiểm chứng quy tắc ticket, điều kiện chọn model và workflow,
cùng điều kiện hoàn tất tài liệu. Các phần khác của Crew v2 sẽ gọi các hàm thuần trong thư viện này.

## Stack

- Node.js ≥ 24.12 chạy TypeScript bằng type stripping.
- TypeScript 7 kiểm tra kiểu ở chế độ strict; `node:test` chạy kiểm thử.
- pnpm 10.32.1 quản lý package độc lập trong `v2/`.

## Bản đồ module

| Thư mục | Vai trò |
|---------|---------|
| `src/` | Quy tắc miền; các module được thêm ở những phần tiếp theo |
| `test/` | Kiểm thử hành vi và tính độc lập của workspace |
| `docs/` | Kiến trúc, manifest flow và bảng tra file |

## Danh sách flow

<!-- crew-docs:flows:start -->
| Flow | Id | Điểm vào |
|------|----|----------|
| [Hợp đồng miền Crew v2](flows/domain-foundation.md) | `domain-foundation` | — |
<!-- crew-docs:flows:end -->

## Cách dùng docs

- [Kiến trúc](architecture.md) mô tả ranh giới của thư viện miền.
- [Bảng tra file](files.md) cho biết file thuộc flow nào.
- Mỗi trang trong `flows/` mô tả điểm vào, bước xử lý, dữ liệu và test của một flow.
