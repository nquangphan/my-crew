# Tổng quan Crew v2

## Mục đích

`@crew-v2/domain` là thư viện miền độc lập để kiểm chứng quy tắc ticket, điều kiện chọn model và workflow,
cùng điều kiện hoàn tất tài liệu. Các phần khác của Crew v2 gọi các hàm thuần trong thư viện này. Package `server/` độc lập bổ sung nền tảng PostgreSQL, cấu hình, migration và fixture kiểm thử; các route nghiệp vụ đang được xây theo kế hoạch phần 02.

## Stack

- Node.js ≥ 24.12 chạy TypeScript bằng type stripping.
- TypeScript 7 kiểm tra kiểu ở chế độ strict; `node:test` chạy kiểm thử.
- pnpm 10.32.1 quản lý package độc lập trong `v2/` và `v2/server/`.
- Nền tảng server dùng Fastify 5 và postgres.js; DB v2 riêng PostgreSQL 18.6, không dùng DB v1.

## Bản đồ module

| Thư mục | Vai trò |
|---------|---------|
| `src/` | Bốn policy thuần cho chọn model, workflow, chuyển trạng thái ticket và hoàn tất |
| `test/` | Kiểm thử hành vi và tính độc lập của workspace |
| `server/` | Nền tảng DB server độc lập, migration có checksum và fixture PostgreSQL riêng |
| `docs/` | Kiến trúc, manifest flow và bảng tra file |

## Danh sách flow

<!-- crew-docs:flows:start -->
| Flow | Id | Điểm vào |
|------|----|----------|
| [Hợp đồng miền Crew v2](flows/domain-foundation.md) | `domain-foundation` | — |
| [Xác thực owner và gắn dự án với máy Crew v2](flows/server-identity.md) | `server-identity` | `server/src/auth/routes.ts`, `server/src/projects/routes.ts` |
| [Mutation và event journal bền vững Crew v2](flows/server-journal.md) | `server-journal` | `server/src/journal/routes.ts` |
| [Nền tảng server và database riêng Crew v2](flows/server-platform.md) | `server-platform` | `server/src/db/migrate.ts` |
<!-- crew-docs:flows:end -->

## Cách dùng docs

- [Kiến trúc](architecture.md) mô tả ranh giới của thư viện miền.
- [Bảng tra file](files.md) cho biết file thuộc flow nào.
- Mỗi trang trong `flows/` mô tả điểm vào, bước xử lý, dữ liệu và test của một flow.
