# SV-2 — C8: viewer đọc data `crew.core`, ma trận viewer bị chặn ghi

Ngày: 11/10/2026 (Asia/Ho_Chi_Minh). Worktree `.worktrees/paperclip-ga-sv2`, nhánh `crew/ga-sv2`, nền `38580c5d7`.

## Commit

- `f2b0c2724` feat(server): viewer của company Crew đọc được data plugin crew.core

File:
- `server/src/crew/plugin-data-scope.ts` (mới): `crewViewerPluginDataScope(db, req, pluginKey, companyId)`.
- `server/src/routes/plugins.ts`: đúng 1 dòng ở route `POST /plugins/:pluginId/data/:key` (anchor spec §8) và 1 import cuối file.
- `crew/release/core-hooks.json`: mục C8 (`core-patch`, `importLine`, mô tả tiếng Anh, `upstreamPr: null`, 2 test).
- `server/src/__tests__/crew-plugin-data-viewer.test.ts` (mới, Postgres nhúng, 9 ca).
- `server/src/__tests__/crew-viewer-write-matrix.test.ts` (mới, Postgres nhúng, 2 ca: 11 route viewer → 403, operator → 201).

## Lệnh kiểm và kết quả

| Lệnh | Kết quả |
|---|---|
| `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-plugin-data-viewer.test.ts` | 9/9 pass |
| `… vitest run src/__tests__/crew-viewer-write-matrix.test.ts` | 2/2 pass (chạy 2 lần, không còn log lỗi DB sau khi đóng) |
| `… vitest run src/__tests__/plugin-routes-authz.test.ts` | 38/38 pass |
| `… vitest run src/__tests__/authz-company-access.test.ts` | 19/19 pass |
| `… vitest run src/__tests__/plugin-scoped-api-routes.test.ts` | 9/9 pass |
| `… vitest run src/__tests__/write-path-membership.test.ts` | 8/8 pass |
| `node crew/release/check-core-hooks.mjs` | `Hook một dòng: 5/5; vá lõi: 7; mục: 19; lỗi: 0` (cảnh báo C6, C8 chưa có PR upstream, như mẫu) |
| `node --test crew/release/check-core-hooks.test.mjs` | 13/13 pass, không đổi |
| `cd server && corepack pnpm exec tsc --noEmit` | exit 0 |

`ipcs -m` trước/sau đều 3 segment (có sẵn từ trước), không còn tiến trình Postgres hay server của worktree.

## Lệch so với plan

- `corepack pnpm --filter @paperclipai/server typecheck` không chạy hết trên máy này vì bước `prepare:runner-vendor`
  cần `cargo` (không cài). Đã chạy `ensure-build-deps` của plugin-sdk rồi `tsc --noEmit` trực tiếp trong `server`, sạch.
- Phải build `@paperclipai/plugin-sdk` (`corepack pnpm --filter @paperclipai/plugin-sdk build`) một lần thì test route
  plugin mới import được (dist chưa có sau `pnpm install`). Chỉ sinh `dist`, không đổi file theo dõi.
- Helper có thêm một điều kiện rẻ trước khi đọc DB: chỉ tra DB khi phiên ghi membership `viewer` ở company đó (role
  khác thì stock đã cho qua). DB vẫn là nguồn quyết định; lỗi đọc DB trả `undefined` (viewer nhận 403 stock, đóng khi
  lỗi). `local_implicit` bị loại.
- Test data-viewer thêm các ca: viewer vẫn 403 ở `bridge/data`, `bridge/action`, `actions/:key` của `crew.core`;
  phiên ghi viewer nhưng DB là operator/suspended/không có dòng → 403; `companyId` rỗng → 400 stock.
- Ca operator trong ma trận chờ 1 giây sau khi trả 201 để khối đánh thức best-effort của route bình luận đọc DB xong
  trước khi đóng Postgres (chỉ để log sạch, không ảnh hưởng kết quả).
