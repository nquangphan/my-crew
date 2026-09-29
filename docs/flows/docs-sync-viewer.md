# Đồng bộ và xem docs

> Flow `docs-sync-viewer`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow
> docs-sync-viewer` in ra đúng danh sách đó.

## Mục đích

Nhận snapshot docs mới nhất mà daemon đồng bộ từ repo của project (nội dung `docs/**` tại một commit), lưu vào
DB, và phục vụ một không gian xem chỉ đọc kiểu Confluence trên web: cây trang, breadcrumb, mục lục, liên kết
hai chiều với ticket qua `flows[]`, tìm kiếm trong không gian và tìm kiếm toàn cục — cộng một trang chủ docs
(`/docs`) liệt kê trạng thái docs của mọi project và cho tìm kiếm xuyên project, để chủ dự án luôn chuyển/lọc
được theo project ở mọi màn hình docs.

## Điểm vào

- `apps/api/src/routes/docs-routes.ts` — owner: `GET /v1/docs`, `GET /v1/docs/search`,
  `GET /v1/projects/:id/docs`, `GET /v1/projects/:id/docs/page`, `GET /v1/projects/:id/docs/search`; daemon:
  `PUT /v1/daemon/projects/:key/docs` (chỉ máy sở hữu project).
- `apps/web/src/routes/docs-home.tsx` → `DocsHomePage` — trang `/docs` ("Tài liệu · Tất cả dự án").
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
5. `apps/api/src/services/docs-service.ts` → `getDocsOverview()` (`GET /v1/docs`, owner): mọi project theo
   thứ tự khóa, mỗi project kèm `docsStatus`, snapshot mới nhất (commit/branch/syncedAt) hoặc `null`,
   `fileCount` (số file của snapshot) và `docsInit` (ticket `docs_init` mới nhất của project — id/key/tiêu
   đề/trạng thái/`updatedAt` — hoặc `null`); phục vụ trang chủ docs (`DocsHomePage`) nói vì sao một project
   chưa có docs.
6. `apps/api/src/services/docs-service.ts` → `searchDocsAcrossProjects()` (`GET /v1/docs/search`, owner): ILIKE
   trên tiêu đề/nội dung/path của mọi project, hoặc chỉ `projectIds` (tối đa 100 uuid, phân tách bằng dấu
   phẩy); tiêu đề khớp trước, rồi tới khóa project, rồi path; giới hạn 50 kết quả, mỗi kết quả kèm `projectId`
   và đoạn trích (`snippetOf()`, dùng chung với `searchDocs()`).
7. `apps/api/src/services/ticket-query-service.ts` → `search()` (`GET /v1/search`, flow `ticket-lifecycle`) gọi
   `searchAllDocs()` (định nghĩa ở `docs-service.ts`) để gộp kết quả docs vào tìm kiếm nhanh toàn cục;
   `projectIds` (nếu có) thu hẹp cả ticket lẫn docs về đúng các project đó.
8. `apps/web/src/routes/project-docs.tsx` → `ProjectDocsPage`: đọc `DocsSpaceResponse` qua `useDocsSpace()`,
   suy ra trang cần mở bằng `resolveDocsTarget()` (`apps/web/src/lib/docs-space.ts`) từ query `?flow=`/`?path=`;
   chưa có snapshot thì hiện `EmptySpace`; path/flow không tồn tại trong snapshot thì hiện `MissingPage`; cả
   hai, cộng breadcrumb của trang có nội dung, đều bắt đầu bằng "Tài liệu" dẫn về trang chủ docs (`/docs`).
9. `apps/web/src/routes/docs-home.tsx` → `DocsHomePage` (`/docs`, "Tài liệu · Tất cả dự án"): đọc
   `useDocsOverview()`, một thẻ mỗi project — có snapshot thì hiện số file, commit rút gọn, branch và giờ
   đồng bộ (`formatDateTime`) kèm link "Mở docs"; chưa có thì hiện "Chưa có docs" cộng lý do
   (`noDocsReason()`: khởi tạo docs đang chặn/chờ trả lời/xong chờ đồng bộ/đã hủy/đang chạy, hoặc chưa có máy
   giữ project/máy giữ chưa đồng bộ khi không có ticket khởi tạo) và link tới ticket `docs_init` kèm trạng
   thái; ô tìm kiếm gọi `searchDocsAcrossProjects()` qua `useDocsSearchAcross()` (giữ text tìm kiếm trong URL
   `q`); bộ lọc "Dự án" (`ProjectFilterMenu`, URL `project=KEY,KEY`, flow `web-tickets`) thu hẹp cả thẻ lẫn
   tìm kiếm — tìm kiếm chờ danh sách project tải xong mới chạy kèm bộ lọc, để không nhấp nháy kết quả chưa
   lọc.
10. `apps/web/src/components/docs-project-switcher.tsx` → `DocsProjectSwitcher`, `switchTarget()`: menu chuyển
    dự án ngay trong không gian docs — trên desktop nằm trong `DocsPageTree` (prop `switcher`, phía trên ô tìm
    kiếm), trên điện thoại/tablet nằm ở header của space, và cũng có trên `EmptySpace`; liệt kê "Tất cả dự án"
    (dẫn `/docs`) và mọi project kèm số file hoặc "chưa có docs" (từ `useDocsOverview()`); chọn một project
    gọi `switchTarget()`: nạp cây trang của project đích (`docsSpaceQuery()`, `apps/web/src/lib/queries.ts`)
    và giữ nguyên trang đang xem nếu path đó tồn tại ở đích (qua `docsLinkFor()`), không thì mở trang chủ của
    project đích; lỗi khi nạp cây trang cũng lùi về trang chủ của project đích.
11. `apps/web/src/lib/docs-space.ts` → `buildPageTree()`, `resolveDocsTarget()`, `flowFiles()`,
    `resolveDocsHref()`: dựng cây trang theo `kind`, chọn trang theo `flow`/`path`/mặc định home, liệt kê file
    một flow theo vai trò (entrypoint/file/test/shared), và phân giải link tương đối bên trong nội dung docs về
    path trong repo (chặn đường dẫn vượt gốc repo và URL ngoài).
12. `apps/web/src/lib/docs-links.ts` → `docsHome()`/`docsFlow()`/`docsPage()`/`docsLinkFor()`, hằng
    `DOCS_INDEX` (`/docs`): nơi duy nhất dựng URL vào docs space và trang chủ docs; ticket "Docs liên quan",
    kết quả tìm kiếm nhanh, sidebar, phím tắt `g d` và `DocsProjectSwitcher` đều dùng các hàm/hằng này.
13. `apps/web/src/components/docs-page-tree.tsx`, `docs-page-view.tsx`, `docs-toc.tsx`, `flow-view.tsx`,
    `related-tickets.tsx`, `file-lookup.tsx`: render cây trang (`DocsPageTree` nhận thêm ô bật/tắt phạm vi tìm
    "Dự án này"/"Mọi dự án" — "Mọi dự án" gọi `searchDocsAcrossProjects()` qua `useDocsSearchAcross()`, kết quả
    render bằng `DocsSearchHits` xuất khẩu dùng chung với trang chủ docs, kèm `ProjectBadge` khi tìm xuyên
    project), nội dung trang (markdown đã khử trùng, mục lục tự cuộn, breadcrumb bắt đầu bằng "Tài liệu" dẫn về
    `/docs`), danh sách file của flow kèm link blob GitHub (`blobUrl`), ticket liên quan tới flow
    (`GET /v1/tickets?flow=`), và tra path → flow (dùng cho trang `docs/files.md`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/docs-routes.ts` | Route đọc (owner) + sync (daemon) | `docsRoutes`, `daemonDocsRoutes` |
| `apps/api/src/services/docs-service.ts` | Lưu snapshot, phân loại trang, đọc, tìm kiếm (một project và xuyên project), tổng quan mọi project | `syncDocsSnapshot`, `classifyPage`, `getDocsSpace`, `getDocsPage`, `searchDocs`, `searchAllDocs`, `searchDocsAcrossProjects`, `getDocsOverview` |
| `apps/api/drizzle/0002_docs_snapshots.sql` | Migration bảng `docs_snapshots`/`docs_files` | — |
| `apps/web/src/routes/project-docs.tsx` | Trang docs space | `ProjectDocsPage` |
| `apps/web/src/routes/docs-home.tsx` | Trang chủ docs, trạng thái mọi project + tìm kiếm xuyên project | `DocsHomePage`, `noDocsReason` |
| `apps/web/src/components/docs-project-switcher.tsx` | Chuyển dự án trong không gian docs, giữ trang đang xem | `DocsProjectSwitcher`, `switchTarget` |
| `apps/web/src/lib/docs-space.ts` | Cây trang, chọn trang, file theo flow, resolve link | `buildPageTree`, `resolveDocsTarget`, `flowFiles`, `resolveDocsHref`, `blobUrl` |
| `apps/web/src/lib/docs-links.ts` | Dựng URL vào docs space + trang chủ docs | `docsHome`, `docsFlow`, `docsPage`, `docsLinkFor`, `DOCS_INDEX` |
| `apps/web/src/components/docs-page-tree.tsx` | Cây trang (desktop + drawer), tìm kiếm trong space/xuyên project | `DocsPageTree`, `DocsSearchHits` |
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

- ticket-lifecycle: `searchAllDocs()` góp kết quả cho `GET /v1/search` (`projectIds` thu hẹp cả ticket lẫn
  docs, dùng chung `inProjectsFilter()` với danh sách ticket); ticket có `flows[]` liên kết hai chiều với
  trang flow qua `RelatedTickets`/`GET /v1/tickets?flow=`.
- event-delivery: `docs.synced` phát qua outbox sự kiện dùng chung; sự kiện ticket cũng làm mới
  `keys.docsOverview` trên trang chủ docs, vì trạng thái ticket `docs_init` giải thích lý do một project chưa
  có docs.
- docs-check: nội dung được daemon đồng bộ chính là các file mà `crew-docs` (flow `docs-check`) kiểm tra và
  sinh ra trong repo; `FlowsManifest` (schema) dùng chung giữa hai flow.
- web-shell: `Breadcrumbs`, `useViewport()`, route docs và mục "Tài liệu" (`/docs`) trên sidebar dùng lại khung
  ứng dụng chung.
- web-tickets: bộ lọc "Dự án" của trang chủ docs dùng chung `ProjectFilterMenu`/`selectedProjects()`
  (`components/project-filter.tsx`) với board, danh sách, Inbox và Máy.

## Tests

- `apps/api/test/docs-sync.test.ts`: đồng bộ thay thế đúng snapshot, chỉ máy sở hữu project được sync, manifest
  sai bị từ chối, phân loại trang, đọc trang/tìm kiếm, sự kiện `docs.synced`.
- `apps/api/test/docs-overview.test.ts`: `GET /v1/docs` liệt kê mọi project theo thứ tự khóa kèm
  docsStatus/snapshot/fileCount/docsInit (trường hợp bị chặn), chỉ owner gọi được; `GET /v1/docs/search` tìm
  xuyên project, thu hẹp theo `projectIds`, 400 khi uuid sai hay `q` rỗng, 401 khi chưa đăng nhập; `GET
  /v1/search` trả đúng `projectId` từng ticket (kể cả request được route) và thu hẹp cả ticket lẫn docs theo
  `projectIds`.
- `packages/shared/src/docs-schemas.test.ts`: schema `FlowsManifest`/request/response docs.
- `apps/web/src/lib/docs-space.test.ts`: dựng cây trang, chọn target theo `flow`/`path`, resolve link tương
  đối, `blobUrl`, slug heading.
- `apps/web/src/routes/docs-home.test.tsx`: thẻ hiện đúng trạng thái/lý do chưa có docs/link ticket
  `docs_init`; tìm kiếm xuyên project kèm badge; `?project=` thu hẹp cả thẻ lẫn tìm kiếm (gửi `projectIds`)
  và ghi lại URL; câu chữ của `noDocsReason()` cho từng trạng thái docs_init.
- `apps/web/src/components/docs-project-switcher.test.tsx`: `switchTarget()` giữ nguyên trang khi đích có,
  lùi về home khi đích không có trang đó hoặc khi lỗi; switcher liệt kê project kèm trạng thái docs và giữ
  trang đang xem khi chuyển; "Tất cả dự án" dẫn `/docs`; xuất hiện ở header điện thoại và ở `EmptySpace`; nút
  bật "Mọi dự án" của phạm vi tìm kiếm kèm badge project.
- `apps/web/src/routes/project-docs.test.tsx`: hiển thị trang, trạng thái rỗng, trang không tìm thấy.
- `apps/web/e2e/docs-across-projects.spec.ts`: ở cả ba viewport — sidebar "Tài liệu" mở trang chủ docs liệt kê
  đúng project sẵn sàng (file/commit) và project chưa có docs kèm link ticket `docs_init` bị chặn; chuyển từ
  "Kiến trúc" của một project sang project khác qua switcher vẫn giữ đúng trang; tìm "Mọi dự án" trong space
  hiện badge của cả hai project; trang Máy lọc `?project=` chỉ hiện job của project đã chọn và ẩn máy không
  giữ project đó, thêm project vào bộ lọc thì job của nó hiện lại; phím tắt `g d` trên desktop từ `/inbox` mở
  `/docs`; không tràn ngang ở cả ba viewport.
- `apps/web/e2e/docs-space.spec.ts`: mở docs từ sidebar và từ chip flow trên ticket, điều hướng cây trang;
  breadcrumb bắt đầu bằng "Tài liệu" dẫn về trang chủ docs; trên desktop, tìm kiếm nhanh thu hẹp về dự án SHOP
  bằng chip phạm vi rồi mở trang "Kiến trúc".
