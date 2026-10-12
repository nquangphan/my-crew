---
title: "Trang Roadmap: bản đồ công ty → project → yêu cầu → việc con"
description: "Trang bản đồ phóng to/thu nhỏ trong crew-web: công ty ở giữa, tỏa ra project, yêu cầu do người tạo và việc con, popup chi tiết ở tầng cuối; chỉ hiện project người xem được cấp."
status: pending
priority: P2
effort: 15h
branch: crew/project-access
tags: [crew-web, roadmap, xyflow, ux, project-access]
created: 2026-10-12
---

# Trang Roadmap (bản đồ công ty)

Ngày 12/10/2026 (Asia/Ho_Chi_Minh). Fork: `~/Documents/projects/crew/.worktrees/paperclip-issues-ui`, nhánh
`crew/project-access`, gói `packages/crew-web`. Mọi đường dẫn bên dưới tương đối với `packages/crew-web/` trừ khi ghi khác.
Mockup cảm nhận chuyển động: `roadmap-mockup.html` cùng thư mục (mở thẳng bằng trình duyệt, dữ liệu giả).

## 1. Kết quả mong muốn

Một trang `/<prefix>/roadmap` cho owner nhìn toàn cảnh công ty như một bản đồ:

1. Mở trang: công ty ở giữa, các project tỏa tròn quanh, mỗi project ghi số yêu cầu và số đang mở.
2. Bấm project: camera phóng vào project, đổi tầng, rồi thu ra để lộ các yêu cầu (do người tạo) của project tỏa quanh nó.
3. Bấm yêu cầu: cùng kiểu chuyển động, lộ cây việc con (cả cháu chắt) nối bằng cạnh cha-con, cạnh "chặn" nét đứt.
4. Bấm việc con (hoặc chính yêu cầu ở giữa): mở popup chi tiết yêu cầu có sẵn.
5. Thành viên không phải owner chỉ thấy project được cấp, đúng như các trang khác.

## 2. Phân tích yêu cầu và mặc định đã chọn

| # | Chỗ còn mơ hồ | Mặc định em chọn | Lý do |
|---|---|---|---|
| A1 | "Request ticket do người tạo" là gì | Issue có `parentId == null` và `createdByUserId != null` (không xét `createdByAgentId`). Không giới hạn ở yêu cầu có policy Crew (`crew.roots`). | Đúng nghĩa đen câu của owner; danh sách Yêu cầu cũng hiện mọi issue chứ không chỉ gốc Crew. Gốc do agent tạo (routine, CEO agent) bị bỏ. |
| A2 | "Việc con" gồm mấy tầng | Toàn bộ hậu duệ (con, cháu…) của yêu cầu, vẽ thành cây tỏa tròn theo độ sâu. | "Liên kết như bản đồ" — cắt ở một tầng thì mất phần lớn việc agent tách ra. |
| A3 | "Liên kết với nhau" | Cạnh cha-con (liền) + cạnh `blocks` giữa các việc trong cây (nét đứt có mũi tên, lấy từ `blockedBy` của compact issue). | Dữ liệu sẵn trong cùng lời gọi, không thêm API. |
| A4 | Việc đã xong/đã hủy | Vẫn hiện (owner muốn toàn cảnh), xếp sau việc đang mở, màu theo trạng thái. Không làm bộ lọc. | Giữ phạm vi; đếm "đang mở" trên nút đã cho tín hiệu. |
| A5 | Yêu cầu không thuộc project | Chỉ owner thấy thêm một nút "Chưa gắn project" ở tầng công ty (khi có ít nhất một yêu cầu như vậy). | Khớp luật hiện có: yêu cầu không project chỉ owner thấy (`canSeeIssue`, `src/features/access/use-visible-projects.ts:34`). |
| A6 | Tên mục menu | "Roadmap" (cả vi và en), nhóm "Công việc", ngay sau "Yêu cầu". | Chữ owner dùng; sidebar đã có từ mượn ("Project", "Docs", "Skills"). Đổi chỉ là sửa một key locale. |
| A7 | Bấm yêu cầu ở tầng project: zoom hay mở chi tiết | Zoom vào cây việc con. Chi tiết của yêu cầu: bấm nút yêu cầu ở giữa tầng việc con. | Theo câu owner; vẫn mở được chi tiết yêu cầu mà không thêm nút. |
| A8 | Ai vào được trang | Mọi vai trò (owner, admin, operator, viewer, Phòng Marketing); nội dung lọc theo quyền project. | "Các tài khoản khác chỉ thấy project mình cấp quyền" — tức họ vẫn có trang. |
| A9 | Quyền thật ở server | Giữ đúng quyết định 1 đã duyệt của tính năng quyền project: chỉ ẩn ở UI Crew, API lõi vẫn trả đủ (`plans/261011-1735-project-access/report.md` mục "Luật"). Trang này lọc bằng cùng hook `useVisibleProjects`. | Không mở lại quyết định owner đã chốt; ghi rõ ở mục Rủi ro. |
| A10 | Tìm kiếm/lọc trên bản đồ | Ngoài phạm vi (xem Non-goals). | Đã có trang Tìm kiếm và bộ lọc ở trang Yêu cầu. |

## 3. Non-goals

- Không sửa server, plugin hay migration; không thêm endpoint. Không vá lõi Paperclip.
- Không chặn quyền project ở API lõi (đã chấp nhận ở tính năng quyền project).
- Không có tìm kiếm, bộ lọc trạng thái/agent, kéo thả nút, sửa issue ngay trên bản đồ, lưu vị trí nút.
- Không có trục thời gian/Gantt (roadmap ở đây là bản đồ quan hệ, không phải lịch).
- Không thêm thư viện mới (không d3, không framer-motion).

## 4. Hiện trạng đã kiểm trong code

| Sự thật | Bằng chứng |
|---|---|
| `@xyflow/react` ^12 đã là dependency, đã dùng cho bản đồ yêu cầu Crew, nạp lười. | `package.json`; `src/ds/widgets/crew/crew-map.tsx:9` (`lazy(() => import('./crew-map-flow'))`) |
| Guard: ngoài `src/ds/**` cấm import `@xyflow/`, cấm `style=`, `className` chỉ class bố cục; `@/ds` không được kéo gói nặng vào chunk đầu. | `test/guards/design-system.test.ts:11`, `:95` (`staticPackages`), `src/ds/README.md` mục Luật |
| Route feature tự gom bằng glob `../features/*/routes.tsx`; locale feature tự gom từ `features/*/locales/*.json` (namespace = tên feature). | `src/app/router.tsx:17`; `src/i18n/index.ts:12,19` |
| Mục sidebar khai ở `NAV_ITEMS` + `NavId`; icon ở `ICONS` của sidebar. | `src/app/routes-util.ts:31-66`; `src/app/shell/sidebar.tsx:49` |
| Viewer không bị chặn route mới (chỉ chặn danh sách cố định). | `src/features/access/nav-access.ts:14-26` |
| Lọc quyền project: `useVisibleProjects()` cấp `filterProjects`/`filterIssues`, dùng làm `select`; chưa tải/lỗi = không thấy gì. | `src/features/access/use-visible-projects.ts:20,66` |
| Danh sách issue: `api.issues.listCompact(companyId, filters)`, server tối đa `limit=1000`, có `projectId`, `descendantOf` (đệ quy), `parentId`. Không có lọc "chỉ gốc" hay "do người tạo". | `src/api/paperclip/issues.ts:7-36`; `server/src/services/issues.ts:212` (`ISSUE_LIST_MAX_LIMIT = 1000`), `:6203` (descendantOf) |
| Compact issue có `parentId`, `projectId`, `createdByUserId`, `createdByAgentId`, `status`, `identifier`, `blockedBy`. | `packages/shared/src/types/issue.ts:878-920`; `server/src/routes/issues.ts:2988` (`toCompactIssue`, dòng +39 `blockedBy`) |
| Trang Yêu cầu gọi `listCompact({ view:'compact', limit:1000 })` mặc định → cùng khóa cache nếu trang Roadmap dùng đúng bộ lọc đó. | `src/features/issues/list/use-issues.ts:134-141,163` |
| Sự kiện live làm mới theo tiền tố `queryKeys.issues(companyId)` → mọi query `['issues', companyId, …]` tự cập nhật. | `src/api/queryKeys.ts:18`; `src/app/live/live-events.ts` (dòng `keys.push(queryKeys.issues(companyId), queryKeys.crew())`) |
| Popup chi tiết dùng lại được ở mọi trang: thêm `?issue=<mã>` là `IssuePopupHost` ở shell mở `IssueDetail`; `IssueDetail` tự kiểm `canSeeIssue`. Mở bằng `useIssueOpener().open(identifier)`. | `src/features/issues/popup/issue-href.ts:5`, `issue-popup-host.tsx`, `issue-nav.tsx:20`; `src/features/issues/detail/issue-detail.tsx:103-106` |
| Màu trạng thái có token sáng/tối `--status-task-icon-<status>`; có `StatusGlyph`, `Breadcrumb`. | `src/ds/tokens.css:236+`; `src/ds/widgets/status-glyph.tsx`; `src/ds/components/breadcrumb.tsx` |
| Token chuyển động: `--motion-ease-out-expo`. | `src/ds/tokens.css:6` |
| E2E: mã BA phải có ca trong `e2e/coverage.json`; mã mới khai ở `e2e/ba-ids.json`. Helper tạo project/issue và cấp quyền có sẵn. | `test/e2e-coverage.test.ts:17-35`; `e2e/specs/s21-project-access.spec.ts`; `e2e/support/data.ts`, `e2e/support/project-access.ts` |

## 5. Chọn cách vẽ

**Chọn: `@xyflow/react` (đã có) + bố cục tỏa tròn tự viết (hàm thuần ~80 dòng) + chuyển động camera bằng
`setCenter`/`fitView({ duration })` + hiệu ứng nút bay ra bằng CSS keyframe trong ds.**

| Phương án | Được | Mất | Kết luận |
|---|---|---|---|
| xyflow + bố cục tự viết | 0 KB thêm (gói đã nằm trong chunk lười của bản đồ Crew); pan/zoom/pinch, `Controls`, `MiniMap` sẵn; nút là HTML thật (button, focus, aria); `onlyRenderVisibleElements` cho cây lớn; `fitView`/`setCenter` có `duration` và trả Promise để nối chuỗi zoom-vào → đổi tầng → thu-ra. | Phải tự viết bố cục tròn (đơn giản: vòng đồng tâm và cây tỏa theo số lá). | **Chọn.** |
| SVG thuần + d3-zoom (+ d3-hierarchy) | Kiểm soát tuyệt đối từng pixel. | Thêm 2 gói; tự làm lại nút HTML/focus/bàn phím, controls, cảm ứng; trùng việc xyflow đã làm. | Bỏ (trái DRY). |
| framer-motion | Hoạt ảnh layout đẹp. | ~40 KB gói mới, không có pan/zoom; vẫn phải có canvas. | Bỏ. |
| d3-hierarchy cho bố cục | Thuật toán chuẩn. | Thêm gói cho việc 80 dòng làm được; cây ở đây nhỏ (≤150 nút). | Bỏ; nếu sau này cần thì thay hàm bố cục, giao diện không đổi. |

Chuyển động (khớp mockup):

1. Bấm nút: các nút khác mờ đi, `setCenter(node.x, node.y, { zoom: 2.4, duration: 450 })`.
2. Xong (Promise resolve): `navigate` đẩy URL tầng mới (một mục history).
3. Tầng mới dựng với nút trung tâm ở gốc (0,0): `setViewport` tức thì về (0,0, zoom 2.4) — nút trung tâm trông y như
   nút vừa bấm — rồi `fitView({ duration: 650, padding: 0.15 })`: cảm giác "thu ra để lộ".
4. Nút con bay từ tâm ra vị trí của nó: keyframe CSS trong ds dịch từ `(-x, -y)` về 0, trễ so le `min(i*18, 500)ms`.
   Cạnh hiện dần sau 250 ms.
5. Lùi tầng (nút Lùi, breadcrumb, Esc, Back trình duyệt): dựng tầng cha, đặt camera tức thì vào nút vừa rời (zoom 2.4) rồi
   `fitView` → thu ra, focus trả về nút đó.
6. `prefers-reduced-motion`: mọi `duration` = 0, không keyframe (Tailwind `motion-reduce:animate-none`).

Nút đến từ URL (deep link, Back) cũng chạy bước 3–5 vì hiệu ứng gắn vào effect theo khóa tầng, không gắn vào cú bấm.

## 6. Luồng dữ liệu

```
URL ?project=<projectId|none>&request=<mã>&view=map|list&issue=<mã>
        │
        ▼
roadmap-page.tsx ── useRoadmapData(companyId, project, request)
        │            ├─ projects   : api.projects.list            select: filterProjects
        │            ├─ company    : listCompact({view:'compact',limit:1000})  select: filterIssues   (dùng chung cache với trang Yêu cầu)
        │            ├─ project    : listCompact({projectId, limit:1000})      chỉ khi có ?project    select: filterIssues
        │            └─ subtree    : listCompact({descendantOf:<id>, limit:1000}) chỉ khi có ?request select: filterIssues
        ▼
roadmap-model.ts (thuần): humanRoots, đếm theo project, cây hậu duệ, cạnh cha-con + blocks, cắt trần "+N"
        ▼  RoadmapLevel { center, nodes[], edges[], overflow, truncated }
roadmap-layout.ts (thuần, trong ds): rings() cho tầng 0/1, radialTree() cho tầng 2 → { [id]: {x,y} }
        ▼
@/ds RoadmapCanvas (lazy) → roadmap-flow.tsx (xyflow, hoạt ảnh)   |   RoadmapList (danh sách lồng nhau)
        ▼ onOpen(node)
tầng 0/1: navigate(?project / ?request)      tầng 2: useIssueOpener().open(identifier) → ?issue= → IssuePopupHost
```

- `project=none` là nút "Chưa gắn project" (chỉ khi `visible.all`). Tầng project của nó dùng dữ liệu `company` lọc
  `projectId == null` (server không lọc được null).
- `request` dùng mã (TPS-12) cho URL dễ đọc; tìm trong `humanRoots` của tầng project. Không thấy, hoặc yêu cầu thuộc
  project khác, hoặc project không được cấp → cùng một thông báo "Không tìm thấy hoặc bạn không được xem" + nút về tầng
  trên (không phân biệt hai trường hợp để không lộ sự tồn tại).
- Thứ tự ổn định để nút không nhảy khi live cập nhật: đang mở trước, rồi `createdAt` tăng dần, rồi `identifier`.
- `truncated = data.length === 1000` → dải thông báo "Có hơn 1000 việc, bản đồ có thể thiếu" (đếm ở tầng công ty ghi
  "≥").

## 7. Trần số nút và cách xử lý khi vượt

| Tầng | Trần vẽ | Vượt trần |
|---|---|---|
| 0 Công ty | 40 project | Nút "+N project khác" → mở dạng danh sách. |
| 1 Project | 60 yêu cầu (vòng đồng tâm, vòng ngoài chứa nhiều hơn) | Nút "+N yêu cầu khác" → dạng danh sách đầy đủ của tầng. |
| 2 Yêu cầu | 150 việc (lấy theo độ sâu tăng dần, rồi thứ tự ổn định), `onlyRenderVisibleElements` | Nút "+N việc khác" cạnh tâm → dạng danh sách cây đầy đủ. |
| Dữ liệu | 1000 dòng mỗi query (trần server) | Dải thông báo `truncated`. |

Dạng danh sách vừa là lối thoát khi vượt trần, vừa là bản thay thế cho trình đọc màn hình (DRY: một component).

## 8. UX chi tiết

- **Đầu trang**: `PageHeader` "Roadmap" + `Breadcrumb` "Công ty › Project › TPS-12 Tiêu đề" (mục cuối `aria-current`),
  nút "Lùi" (tắt ở tầng công ty), công tắc "Bản đồ / Danh sách" (`?view=list`).
- **Nút công ty**: tròn, tên công ty, "N project · M yêu cầu đang mở".
- **Nút project**: tròn, viền màu `project.color` (fallback token primary), tên, "N yêu cầu", "M đang mở".
- **Nút yêu cầu**: thẻ 200px, viền trái màu trạng thái, chấm trạng thái + "TPS-12 · Đang làm", tiêu đề 1 dòng, thanh
  tiến độ "x/y việc con xong" (đếm từ dữ liệu project).
- **Nút việc con**: thẻ 180px, như trên, dòng phụ "agent · n con".
- **Chú giải** góc dưới trái: 7 trạng thái + cạnh cha-con + cạnh chặn. **Controls** góc dưới phải (+, −, vừa màn hình).
- **Gợi ý** đầu canvas theo tầng ("Bấm project để đi vào…").
- **Bàn phím**: mỗi nút là `<button>` (Tab đi qua), Enter/Space = bấm, Esc = lùi tầng (khi không có popup),
  focus về nút trung tâm sau khi vào tầng, về nút vừa rời sau khi lùi. Canvas có `aria-label`, cạnh `aria-hidden`.
- **Trình đọc màn hình**: `aria-label` của nút đủ nghĩa ("TPS-12: Tiêu đề, Đang làm, 3/5 việc con xong"); dạng danh sách
  là `<ul>` lồng nhau với cùng hành động.
- **Mobile 390px**: canvas cao `calc(100dvh - header)`, pinch-zoom, chú giải xuống thành hàng dưới, nút mặc định
  `fitView` nên cả tầng nằm gọn; sidebar ☰ có sẵn không đổi. Nếu thẻ quá nhỏ người dùng chuyển "Danh sách".
- **Sáng/tối**: chỉ dùng token ds (`bg-card`, `border`, `--status-task-icon-*`); `ReactFlow colorMode` theo theme hiện
  tại.
- **Trạng thái trang**: đang tải (Spinner), lỗi (ErrorState + Thử lại), thành viên chưa được cấp project nào
  (EmptyState "Bạn chưa được cấp project nào. Hỏi owner ở trang Thành viên."), project chưa có yêu cầu (EmptyState
  trong canvas), yêu cầu chưa có việc con (chỉ nút tâm + "Chưa có việc con").

## 9. Pha

Một người làm, tuần tự (mỗi pha dựa vào pha trước). Không pha nào chạy song song nên không tranh file.

### Pha 1 — Mô hình và bố cục thuần (3h)

Tạo:
- `src/features/roadmap/roadmap-model.ts`: `isHumanRoot`, `buildCompanyLevel(projects, issues, { includeNoProject })`,
  `buildProjectLevel(project, issues)`, `buildRequestLevel(request, descendants)`, `stableOrder`, hằng `CAPS =
  { projects: 40, requests: 60, tickets: 150 }`, `LIST_LIMIT = 1000`. Trả `RoadmapLevel` (kiểu khai ở ds, xem pha 2).
- `src/ds/widgets/roadmap/roadmap-layout.ts`: `rings(n, r0, gap, spacing)`, `radialTree(rootId, nodes)` thuần, export
  qua `@/ds`.
- Test: `test/features/roadmap/roadmap-model.test.ts`, `test/ds/crew/roadmap-layout.test.ts`.

Kiểm (unit): gốc do agent tạo bị bỏ; gốc có `parentId` bị bỏ; đếm đang mở đúng; cắt trần sinh nút `more` với `extra`
đúng; cạnh `blocks` chỉ nối hai việc cùng nằm trong cây; vòng cha-con hỏng không treo; thứ tự ổn định khi thêm issue mới
(vị trí nút cũ không đổi); `rings` không chồng nút (khoảng cách tối thiểu ≥ spacing·0.9); `radialTree` đặt con trong
cung của cha.

### Pha 2 — Widget canvas trong ds (5h)

Tạo:
- `src/ds/widgets/roadmap/roadmap-canvas.tsx` (dòng 1 `// crew: tự dựng`): kiểu `RoadmapNode`/`RoadmapEdge`/
  `RoadmapLevel`, `lazy(() => import('./roadmap-flow'))`, error boundary + Spinner (mẫu `crew-map.tsx`). Props:
  `level`, `levelKey`, `direction: 'in' | 'out'`, `focusId?`, `onOpen(node)`, `labels`.
- `src/ds/widgets/roadmap/roadmap-flow.tsx`: `ReactFlowProvider` + `ReactFlow` (không kéo nút, không nối), 5 node type
  (`company`, `project`, `request`, `ticket`, `more`), cạnh `parent` (straight/bezier) và `blocks` (nét đứt + mũi tên),
  chuỗi hoạt ảnh ở mục 5, `onlyRenderVisibleElements` khi > 80 nút, `Controls`, không `MiniMap`.
- `src/ds/widgets/roadmap/roadmap-legend.tsx`.
- `src/ds/tokens.css`: keyframe `roadmap-node-enter` (dùng biến `--from-x/--from-y` gán trong ds) + biến
  `--roadmap-zoom-in: 450ms`, `--roadmap-zoom-out: 650ms`.
- Sửa `src/ds/index.ts`: export canvas, legend, layout.
- Sửa `src/dev/crew-showcase.tsx`: thêm một khối Roadmap với dữ liệu giả (trang `/ds` là nơi xem mọi widget).
- Locale chung `src/i18n/locales/{vi,en}.json`: khóa `roadmap.*` dùng trong ds (nhãn controls, chú giải, "+N khác").

Kiểm: `test/ds/crew/roadmap-canvas.test.tsx` (jsdom; mock `ResizeObserver`/`DOMMatrixReadOnly` như `test/ds/crew/crew-map.test.tsx:11-13`): hiện đúng số button,
`aria-label` đủ nghĩa, bấm gọi `onOpen` với nút đúng, nút `more` hiển thị số. Guard design-system phải xanh (xyflow chỉ
trong ds, `@/ds` không kéo xyflow vào chunk đầu).

### Pha 3 — Trang, route, menu, URL, dạng danh sách (4h)

Tạo:
- `src/features/roadmap/routes.tsx`: `{ path: 'roadmap', lazy: … RoadmapPage }`.
- `src/features/roadmap/index.ts`: `export { routes }`.
- `src/features/roadmap/use-roadmap.ts`: 4 query ở mục 6 với `select` của `useVisibleProjects`; `enabled` theo tầng;
  khóa `company` dùng đúng bộ lọc của trang Yêu cầu để chung cache.
- `src/features/roadmap/roadmap-url.ts`: `parseRoadmapParams`, `roadmapHref(current, { project, request })` (giữ tham số
  khác, xoá `issue` khi đổi tầng).
- `src/features/roadmap/roadmap-page.tsx`: header, breadcrumb, nút Lùi, công tắc view, chọn tầng, gọi canvas hoặc
  danh sách, các trạng thái ở mục 8, Esc = lùi (bỏ qua khi `?issue=` đang mở), bấm tầng 2 → `useIssueOpener().open`.
- `src/features/roadmap/roadmap-list.tsx`: `<ul>` lồng nhau theo tầng hiện tại, dùng component ds có sẵn (`StatusGlyph`,
  link/button), chỉ class bố cục.
- `src/features/roadmap/locales/{vi,en}.json`.

Sửa:
- `src/app/routes-util.ts`: `NavId` thêm `'roadmap'`; `NAV_ITEMS` thêm `{ id: 'roadmap', group: 'work', segment:
  'roadmap', to: 'roadmap' }` ngay sau `issues`.
- `src/app/shell/sidebar.tsx`: `ICONS.roadmap = Network` (đã có trong `src/ds/icons.ts:34`).
- `src/i18n/locales/{vi,en}.json`: `nav.roadmap = "Roadmap"`.
- Không cần sửa `src/app/shell/command-palette.tsx`: palette tự lấy trang từ `NAV_ITEMS` (`command-palette.tsx:77`), nên
  "Roadmap" tự có trong Tìm nhanh.

Kiểm: `test/features/roadmap/roadmap-url.test.ts`; `test/features/roadmap/roadmap-page.test.tsx` (fetch mock như
`test/app/fetch-mock.ts`): owner thấy mọi project + "Chưa gắn project"; thành viên bị giới hạn chỉ thấy project được
cấp, không có nút "Chưa gắn project", deep link `?project=<không được cấp>` ra thông báo chung; `?view=list` hiện danh
sách; tầng 2 bấm việc con thêm `?issue=`. Cập nhật `test/app/sidebar-groups.test.tsx` thêm khẳng định link "Roadmap"
trong nhóm Công việc.

### Pha 4 — E2E, hướng dẫn, nghiệm thu (3h)

Tạo `e2e/specs/s22-roadmap.spec.ts` (`@t1`), chỉ chạy spec này (owner không muốn chạy cả bộ):

- `PW-S22-1` owner: tạo project thử A, yêu cầu gốc R (qua API phiên owner → `createdByUserId`), 2 việc con (một chặn
  một) và 1 việc gốc do agent tạo (`agent-token.ts`) → mở `roadmap`, thấy nút A; bấm A → URL có `project=`, thấy R, không
  thấy việc do agent; bấm R → URL có `request=`, thấy 2 việc con; bấm một việc → popup (`?issue=`) hiện đúng mã; Esc đóng
  popup, Esc nữa về tầng project; Back trình duyệt về tầng công ty. Dạng danh sách cho cùng kết quả.
- `PW-S22-2` thành viên bị giới hạn (fixture `contributorPage`, mẫu `s21-project-access.spec.ts`): cấp A, không cấp B →
  chỉ thấy A; mở thẳng `roadmap?project=<B>` ra thông báo chung; gỡ quyền sau ca.

Sửa `e2e/ba-ids.json` (nhóm `S22.x`: S22.1 bản đồ và chuyển tầng, S22.2 lọc theo quyền project) và
`e2e/coverage.json`.

Sửa hướng dẫn người dùng: `src/features/guide/content/huong-dan.vi.md` và `guide.en.md` thêm mục `### Roadmap
{#roadmap}` trong "Làm việc hằng ngày" (cách đi vào/lùi, ý nghĩa màu và nét đứt, dạng danh sách); ảnh chụp qua
`guide:shots` nếu mục khác đang có ảnh [tùy tiện, không bắt buộc].

Nghiệm thu thủ công trên T1: desktop 1280 và phone 390, sáng/tối, `prefers-reduced-motion`, project có > 60 yêu cầu.

## 10. Ma trận kiểm thử

| Mức | Cái gì | File |
|---|---|---|
| Unit | Lọc gốc do người, đếm, cây, cạnh blocks, trần +N, thứ tự ổn định | `test/features/roadmap/roadmap-model.test.ts` |
| Unit | Bố cục vòng và cây tỏa | `test/ds/crew/roadmap-layout.test.ts` |
| Unit | Đọc/ghi URL | `test/features/roadmap/roadmap-url.test.ts` |
| Component | Canvas: nút, aria, onOpen, more | `test/ds/crew/roadmap-canvas.test.tsx` |
| Component | Trang: quyền owner/giới hạn, deep link, list view, popup | `test/features/roadmap/roadmap-page.test.tsx` |
| Guard | Design system, i18n đủ khóa vi/en, coverage BA | `test/guards/*.test.ts`, `test/e2e-coverage.test.ts` (có sẵn) |
| E2E | Chuyển tầng, popup, Back, quyền | `e2e/specs/s22-roadmap.spec.ts` |

Lệnh: `pnpm --filter @crew/paperclip-web test`, `… typecheck`, `… lint`, `… build`; E2E: `cd packages/crew-web && bash
e2e/support/run-e2e.sh --project=t1 --grep PW-S22`.

## 11. Tiêu chí nghiệm thu (đo được)

1. Sidebar có "Roadmap" trong nhóm Công việc cho mọi vai trò; `/<prefix>/roadmap` mở tầng công ty.
2. Tầng công ty hiện đúng các project người xem được cấp (owner: tất cả + "Chưa gắn project" khi có); số yêu cầu trên
   nút bằng số issue gốc do người tạo của project đó.
3. Bấm project/yêu cầu: URL đổi (`project=`, `request=`), Back trình duyệt trở về tầng trước; mở thẳng URL ra đúng tầng.
4. Tầng yêu cầu hiện mọi hậu duệ (≤150) với cạnh cha-con và cạnh chặn; bấm việc con mở popup chi tiết có sẵn.
5. Thành viên bị giới hạn không thấy project/yêu cầu/việc con của project không được cấp ở bất kỳ tầng nào của UI, kể cả
   qua deep link (PW-S22-2 xanh).
6. Toàn bộ thao tác làm được bằng bàn phím; dạng danh sách cho cùng nội dung; không có lỗi console.
7. Chunk khởi đầu không chứa `@xyflow/react` (guard xanh); `pnpm build` không tăng chunk `index` quá 2 KB.
8. 390px: không cuộn ngang, chú giải không che controls; tối/sáng đúng token; reduced-motion không có hoạt ảnh.
9. Mọi test unit/component mới + guard + PW-S22 xanh; typecheck, lint, build sạch.

## 12. Rủi ro

| Rủi ro | Khả năng × Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Quyền project chỉ ở UI: thành viên mở DevTools vẫn thấy dữ liệu trả về từ API lõi (query `company` trả mọi issue). | Cao × Trung bình | Đúng quyết định 1 owner đã duyệt; trang này không làm lộ thêm so với trang Yêu cầu (cùng query). Nếu owner muốn chặn thật thì là việc server riêng (xem câu hỏi mở). |
| Company > 1000 issue: đếm tầng công ty thiếu. | Trung bình × Thấp | Dải `truncated` + "≥"; tầng project/yêu cầu dùng query riêng nên chính xác tới 1000 mỗi tầng. |
| Hoạt ảnh giật khi > 100 nút trên máy yếu/mobile. | Trung bình × Trung bình | Trần 60/150, trễ so le tối đa 500 ms, `onlyRenderVisibleElements`, chỉ animate `transform`/`opacity`; reduced-motion tắt hết. |
| Live update làm nút nhảy chỗ giữa lúc xem. | Trung bình × Thấp | Thứ tự ổn định theo `createdAt`; không chạy lại hoạt ảnh khi `levelKey` không đổi. |
| Chuỗi `setCenter` → navigate bị bấm chồng. | Trung bình × Thấp | Cờ `busy` bỏ qua bấm trong lúc chuyển (như mockup). |
| Guard ds chặn style/class ở feature. | Thấp × Thấp | Mọi thứ có màu/kích thước nằm trong `src/ds/widgets/roadmap/*`; feature chỉ bố cục. |
| `createdByUserId` không đúng với yêu cầu tạo qua đường khác (duyệt góp ý, CLI). | Thấp × Trung bình | Kiểm lúc làm pha 1 bằng một truy vấn đọc DB T1; nếu sai thì nới định nghĩa (gốc có policy Crew cũng tính). |

## 13. Tương thích ngược và rollback

- Không đổi API, schema, khóa cache cũ hay URL cũ; chỉ thêm route, mục menu, khóa locale, widget ds.
- Rollback: revert commit của tính năng (mỗi pha một commit theo Conventional Commits). Không có dữ liệu cần dọn. Bỏ
  riêng menu: xoá mục `roadmap` khỏi `NAV_ITEMS` (route vẫn sống cho link trực tiếp).

## 14. Danh sách file

Tạo: `src/features/roadmap/{routes.tsx,index.ts,use-roadmap.ts,roadmap-model.ts,roadmap-url.ts,roadmap-page.tsx,
roadmap-list.tsx,locales/vi.json,locales/en.json}`, `src/ds/widgets/roadmap/{roadmap-canvas.tsx,roadmap-flow.tsx,
roadmap-legend.tsx,roadmap-layout.ts}`, `e2e/specs/s22-roadmap.spec.ts`, 5 file test ở mục 10.

Sửa: `src/ds/index.ts`, `src/ds/tokens.css`, `src/dev/crew-showcase.tsx`, `src/app/routes-util.ts`,
`src/app/shell/sidebar.tsx`, `src/i18n/locales/{vi,en}.json`, `test/app/sidebar-groups.test.tsx`, `e2e/ba-ids.json`,
`e2e/coverage.json`, `src/features/guide/content/{huong-dan.vi.md,guide.en.md}`.

## Câu hỏi mở cho owner

1. Yêu cầu "do người tạo" có tính cả yêu cầu gốc do agent tạo (routine, CEO agent) không? Mặc định: không.
2. Quyền xem chỉ ẩn ở UI (như trang Yêu cầu hiện nay) có đủ cho Roadmap không, hay owner muốn server chặn thật? Mặc
   định: giữ quyết định cũ, chỉ ẩn ở UI.
3. Tên menu "Roadmap" hay "Bản đồ"/"Lộ trình"? Mặc định: "Roadmap".
