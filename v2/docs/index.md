# Tổng quan Crew v2

## Mục đích

`@crew-v2/domain` là thư viện miền độc lập cho ticket, chọn model, workflow và điều kiện hoàn tất docs. `server/` là API/database v2 riêng; phần02 đã review các migration001–006 và xác thực, project, ticket, execution journal, import/read/search docs. Gateway control plane007 và model pool/provisioning008 đã qua review độc lập. Schema/storage attachment009 đã qua review độc lập, gồm sửa replay deadline và kiểm tra text EOF; chưa nghiệm thu public attachment API hay extraction. Producer comment attachment và migration010 đã nghiệm thu f6d3728; atomic submission/inbox/routing490001c đã nghiệm thu sau FIX1, bounded extractor workerb670d82 đã nghiệm thu trong phạm vi protocol/diagnostic. Public access/API và parser/corpus đang triển khai riêng. Các migration001–010 giữ nguyên.

`gateway/` và `desktop/` cung cấp host macOS độc lập cửa sổ UI. Host/journal/resource registry và workflow source/projection registry đã qua review. Bridge đồng bộ/thực thi7c7c719 đã qua review độc lập; bước cách ly workflow ced6bb1 đã qua full review và FIX1 review. Runtime boundary đang triển khai. Model inventory/broker/current credential binding đã nghiệm thu49e2333 sau full review và hai batch sửa; final scoped gateway cover114/114 PASS. Các class chưa được nối đầy đủ vào host composition. Checksum và test protocol không cấp chứng nhận runtime isolation/live/Keychain/signing. Dispatch production và xác nhận kết quả vẫn mặc định từ chối đến producer phần06/08. Web v2 đang chờ duyệt prototype; Assistant, integration và signed updater chưa triển khai. Lộ trình và trạng thái chi tiết ở `plans/261002-0002-crew-v2/plan.md` từ repo root.

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
| `server/` | API/DB v2 riêng, migration có checksum; fixtures PostgreSQL riêng, không dùng DB v1 |
| `gateway/` | Host/journal/workflow registry, bridge và model broker theo các gate review riêng |
| `desktop/` | Cửa sổ Electron mỏng, kết nối host qua IPC; không sở hữu job |
| `docs/` | Kiến trúc, manifest flow và bảng tra file |

## Danh sách flow

<!-- crew-docs:flows:start -->
| Flow | Id | Điểm vào |
|------|----|----------|
| [Worker trích xuất attachment có giới hạn](flows/attachment-extraction.md) | `attachment-extraction` | `server/src/attachments/worker-entry.ts` |
| [Giao diện cổng Crew v2 trên macOS](flows/desktop-shell.md) | `desktop-shell` | `desktop/src/main/index.ts` |
| [Hợp đồng miền Crew v2](flows/domain-foundation.md) | `domain-foundation` | — |
| [Host cổng macOS Crew v2](flows/gateway-host.md) | `gateway-host` | `gateway/src/host/main.ts` |
| [Inventory, credential broker và probe model trên gateway](flows/gateway-models.md) | `gateway-models` | — |
| [Boundary runtime và receipt logical effect Crew v2](flows/gateway-runtime.md) | `gateway-runtime` | — |
| [Registry workflow ghim nguồn và runtime projection](flows/gateway-workflows.md) | `gateway-workflows` | `gateway/src/workflows/registry.ts` |
| [Storage và staging attachment Crew v2](flows/server-attachments.md) | `server-attachments` | — |
| [Kiểm tra snapshot tài liệu và nhập nguyên trạng Crew v2](flows/server-docs-import.md) | `server-docs-import` | `server/scripts/docs-import.ts`, `server/src/docs/validator.ts` |
| [Đọc tài liệu và tích hợp HTTP Crew v2](flows/server-docs-view.md) | `server-docs-view` | `server/src/app.ts`, `server/src/docs/routes.ts` |
| [Command, attempt và quyền thực thi có fencing](flows/server-execution.md) | `server-execution` | `server/src/execution/routes.ts` |
| [Control plane gateway và boot/config/report](flows/server-gateway.md) | `server-gateway` | `server/src/gateway/routes.ts` |
| [Xác thực owner và gắn dự án với máy Crew v2](flows/server-identity.md) | `server-identity` | `server/src/auth/routes.ts`, `server/src/projects/routes.ts` |
| [Mutation và event journal bền vững Crew v2](flows/server-journal.md) | `server-journal` | `server/src/journal/routes.ts` |
| [Nguồn model, catalogue và provisioning credential Crew v2](flows/server-models.md) | `server-models` | `server/src/models/routes.ts` |
| [Nền tảng server và database riêng Crew v2](flows/server-platform.md) | `server-platform` | `server/src/db/migrate.ts` |
| [Cây ticket, phụ thuộc và bằng chứng hoàn tất](flows/server-tickets.md) | `server-tickets` | `server/src/tickets/routes.ts` |
<!-- crew-docs:flows:end -->

## Cách dùng docs

- [Kiến trúc](architecture.md) mô tả ranh giới của thư viện miền.
- [Bảng tra file](files.md) cho biết file thuộc flow nào.
- Mỗi trang trong `flows/` mô tả điểm vào, bước xử lý, dữ liệu và test của một flow.
