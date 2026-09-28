# Đồng bộ và xem docs

> Flow `docs-sync-viewer`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow
> docs-sync-viewer` in ra đúng danh sách đó.

## Mục đích

Nhận snapshot docs mới nhất mà daemon đồng bộ từ repo của project (nội dung `docs/**` tại một commit), lưu vào
DB, và phục vụ một không gian xem chỉ đọc kiểu Confluence trên web: cây trang, breadcrumb, mục lục, liên kết
hai chiều với ticket qua `flows[]`, tìm kiếm trong không gian và tìm kiếm toàn cục.

## Điểm vào

- `apps/api/src/routes/docs-routes.ts` — owner: `GET /v1/projects/:id/docs`,
  `GET /v1/projects/:id/docs/page`, `GET /v1/projects/:id/docs/search`; daemon:
  `PUT /v1/daemon/projects/:key/docs` (chỉ máy sở hữu project).
- `apps/web/src/routes/project-docs.tsx` → `ProjectDocsPage` — trang `/projects/$projectKey/docs`.

## Các bước

1. `apps/api/src/routes/docs-routes.ts` → `daemonDocsRoutes` (`PUT /v1/daemon/projects/:key/docs`): daemon gửi
   toàn bộ file trong `docs/**` (giới hạn `DOCS_SNAPSHOT_MAX_BYTES`) qua idempotency
   (`replyIdempotent`, flow `daemon-api`), gọi `syncDocsSnapshot()`.
2. `apps/api/src/services/docs-service.ts` → `syncDocsSnapshot()`: khoá hàng `projects`, chỉ chấp nhận khi máy
   gọi đúng là `project.ownerMachineId`; parse `docs/flows.yaml` bằng `parseManifest()` (validate schema
   `FlowsManifest`, snapshot có manifest sai bị từ chối); xoá toàn bộ `docs_files` cũ của project, ghi lại
   `docs_snapshots` (upsert theo `project_id`) và chèn `docs_files` theo lô (`INSERT_BATCH=200`); đặt
   `projects.docs_status='ready'`; phát `docs.synced`.
3. `apps/api/src/services/docs-service.ts` → `classifyPage()`: phân loại từng file — 4 đường dẫn cố định
   (`docs/index.md`, `docs/architecture.md`, `docs/files.md`, `AGENTS.md`) ánh xạ `kind` cố định; file trùng
   `doc` của một flow trong manifest thành `kind:'flow'` kèm `flowId`; còn lại `kind:'other'`, tiêu đề lấy từ
   heading `#` đầu tiên hoặc tên file.
4. `apps/api/src/routes/docs-routes.ts` → `docsRoutes` (owner đọc): `getDocsSpace()` trả cây trang + manifest
   của snapshot mới nhất; `getDocsPage()` trả một trang theo path (`normalizeDocsPath`); `searchDocs()` tìm
   ILIKE trên tiêu đề/nội dung/path trong một project.
5. `apps/api/src/services/ticket-query-service.ts` → `search()` gọi `searchAllDocs()` (định nghĩa ở
   `docs-service.ts`) để gộp kết quả docs vào tìm kiếm nhanh toàn cục (flow `ticket-lifecycle`).
6. `apps/web/src/routes/project-docs.tsx` → `ProjectDocsPage`: đọc `DocsSpaceResponse` qua `useDocsSpace()`,
   suy ra trang cần mở bằng `resolveDocsTarget()` (`apps/web/src/lib/docs-space.ts`) từ query `?flow=`/`?path=`;
   chưa có snapshot thì hiện `EmptySpace`; path/flow không tồn tại trong snapshot thì hiện `MissingPage`.
7. `apps/web/src/lib/docs-space.ts` → `buildPageTree()`, `resolveDocsTarget()`, `flowFiles()`,
   `resolveDocsHref()`: dựng cây trang theo `kind`, chọn trang theo `flow`/`path`/mặc định home, liệt kê file
   một flow theo vai trò (entrypoint/file/test/shared), và phân giải link tương đối bên trong nội dung docs về
   path trong repo (chặn đường dẫn vượt gốc repo và URL ngoài).
8. `apps/web/src/lib/docs-links.ts` → `docsHome()`/`docsFlow()`/`docsPage()`/`docsLinkFor()`: nơi duy nhất
   dựng URL vào docs space; ticket "Docs liên quan", kết quả tìm kiếm nhanh, sidebar và phím tắt `g d` đều
   dùng các hàm này.
9. `apps/web/src/components/docs-page-tree.tsx`, `docs-page-view.tsx`, `docs-toc.tsx`, `flow-view.tsx`,
   `related-tickets.tsx`, `file-lookup.tsx`: render cây trang, nội dung trang (markdown đã khử trùng, mục
   lục tự cuộn), danh sách file của flow kèm link blob GitHub (`blobUrl`), ticket liên quan tới flow
   (`GET /v1/tickets?flow=`), và tra path → flow (dùng cho trang `docs/files.md`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/docs-routes.ts` | Route đọc (owner) + sync (daemon) | `docsRoutes`, `daemonDocsRoutes` |
| `apps/api/src/services/docs-service.ts` | Lưu snapshot, phân loại trang, đọc, tìm kiếm | `syncDocsSnapshot`, `classifyPage`, `getDocsSpace`, `getDocsPage`, `searchDocs`, `searchAllDocs` |
| `apps/api/drizzle/0002_docs_snapshots.sql` | Migration bảng `docs_snapshots`/`docs_files` | — |
| `apps/web/src/routes/project-docs.tsx` | Trang docs space | `ProjectDocsPage` |
| `apps/web/src/lib/docs-space.ts` | Cây trang, chọn trang, file theo flow, resolve link | `buildPageTree`, `resolveDocsTarget`, `flowFiles`, `resolveDocsHref`, `blobUrl` |
| `apps/web/src/lib/docs-links.ts` | Dựng URL vào docs space | `docsHome`, `docsFlow`, `docsPage`, `docsLinkFor` |
| `apps/web/src/components/docs-page-tree.tsx` | Cây trang (desktop + drawer) | `DocsPageTree` |
| `apps/web/src/components/docs-page-view.tsx` | Nội dung trang + markdown | `DocsPageView`, `DocsMarkdown` |
| `apps/web/src/components/docs-toc.tsx` | Mục lục trang | `DocsToc`, `scrollToHeading` |
| `apps/web/src/components/flow-view.tsx` | Danh sách file của một flow | `FlowFiles` |
| `apps/web/src/components/related-tickets.tsx` | Ticket gắn `flows[]` với flow đang xem | `RelatedTickets` |
| `apps/web/src/components/file-lookup.tsx` | Tra path → flow trên trang `docs/files.md` | `FileLookup` |

## Dữ liệu

- Bảng: `docs_snapshots` (một bản mới nhất mỗi project), `docs_files` (nội dung từng trang).
- Sự kiện: `docs.synced` (phát khi đồng bộ xong; web invalidate `['docs']` và `['projects']`, xem flow
  `event-delivery`).
- Gọi ngoài: không (nội dung `docs/**` do daemon đọc từ repo cục bộ rồi gửi lên, không có request ra ngoài từ
  API).

## Flow liên quan

- ticket-lifecycle: `searchAllDocs()` góp kết quả cho `GET /v1/search`; ticket có `flows[]` liên kết hai chiều
  với trang flow qua `RelatedTickets`/`GET /v1/tickets?flow=`.
- event-delivery: `docs.synced` phát qua outbox sự kiện dùng chung.
- docs-check: nội dung được daemon đồng bộ chính là các file mà `crew-docs` (flow `docs-check`) kiểm tra và
  sinh ra trong repo; `FlowsManifest` (schema) dùng chung giữa hai flow.
- web-shell: `Breadcrumbs`, `useViewport()` và route docs dùng lại khung ứng dụng chung.

## Tests

- `apps/api/test/docs-sync.test.ts`: đồng bộ thay thế đúng snapshot, chỉ máy sở hữu project được sync, manifest
  sai bị từ chối, phân loại trang, đọc trang/tìm kiếm, sự kiện `docs.synced`.
- `packages/shared/src/docs-schemas.test.ts`: schema `FlowsManifest`/request/response docs.
- `apps/web/src/lib/docs-space.test.ts`: dựng cây trang, chọn target theo `flow`/`path`, resolve link tương
  đối, `blobUrl`, slug heading.
- `apps/web/src/routes/project-docs.test.tsx`: hiển thị trang, trạng thái rỗng, trang không tìm thấy.
- `apps/web/e2e/docs-space.spec.ts`: mở docs từ sidebar và từ chip flow trên ticket, điều hướng cây trang.
