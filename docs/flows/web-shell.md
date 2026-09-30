# Khung ứng dụng web

> Flow `web-shell`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow web-shell` in ra
> đúng danh sách đó.

## Mục đích

Khung SPA dùng chung cho mọi trang: khởi tạo router/query client, khung ứng dụng kiểu Jira (top bar, sidebar
project, breadcrumb), quick search, phím tắt bàn phím, responsive theo viewport, API client kèm kiểm tra
schema và CSRF, và các tiện ích định dạng/URL dùng lại ở mọi màn hình khác.

## Điểm vào

- `apps/web/src/main.tsx` — bootstrap ứng dụng (theme ban đầu, query client, router, xử lý 401 toàn cục).
- `apps/web/src/router.tsx` — khai báo route tree (TanStack Router, định tuyến bằng code).

## Các bước

1. `apps/web/src/main.tsx`: đặt class `dark` theo `initialTheme()` trước khi render (tránh nháy màu), tạo
   `queryClient`/`router`, đăng ký `onUnauthorized()` — bất kỳ response 401 nào cũng xoá CSRF token, xoá cache
   session và điều hướng `/login?redirect=…` (trừ khi đã ở `/login`).
2. `apps/web/src/router.tsx`: `appRoute.beforeLoad()` gọi `queryClient.ensureQueryData(sessionQuery)`; chưa
   đăng nhập thì `redirect({to:'/login', search:{redirect: location.href}})`; đã đăng nhập thì
   `setCsrfToken()` rồi mọi route con render trong `AppShell`. Toàn bộ path (`/`, `/requests`, `/board`,
   `/list`, `/projects/$projectKey/board|list|docs|settings`, `/docs`, `/tickets/$ticketKey`, `/projects`,
   `/inbox`, `/machines`, `/account`, `/login`) khai báo tại đây; `search` của mỗi route được validate bằng
   schema ở `lib/search-params.ts` (`/board` dùng `AllBoardSearch`, `/list` dùng `AllListSearch`, `/docs` dùng
   `DocsHomeSearch`, flow `docs-sync-viewer`).
3. `apps/web/src/layout/app-shell.tsx` → `AppShell()`: dựng top bar (logo, `QuickSearch`, nút "Tạo", chuông
   Inbox, menu owner), chọn `ProjectSidebar` theo `useViewport()` (full/rail/drawer), gắn `useShortcuts()`
   toàn cục (gồm `g a` → `/board`, `g d` → docs của project trong URL hoặc trang chủ docs `/docs`), và
   `useEffect` gọi `startLiveEvents()` (flow `event-delivery`) — khi stream đóng hẳn, kiểm tra lại session và
   điều hướng về login nếu mất. `OwnerMenu()` trong cùng file có mục "Tài khoản" dẫn tới `/account` (flow
   `owner-auth`).
4. `apps/web/src/layout/project-sidebar.tsx` → `ProjectSidebar()`, `useCurrentProjectKey()`, `projectSectionOf()`:
   sidebar chọn project, "Tất cả dự án" (đầu danh sách, dẫn tới `/board`, active trên cả `/board` và `/list`),
   "Tất cả request của tôi", "Tài liệu" (dẫn `/docs`, flow `docs-sync-viewer`), rồi Board/Danh sách/Docs/Cài
   đặt của project, rồi Inbox/Dự án/Máy/**Cài đặt hệ thống** (icon `SlidersHorizontal`, dẫn `/settings/prompts`,
   active trên mọi `/settings/*` — trang prompt/quy tắc/model/máy/MCP dự án sửa trên server, flow
   `server-settings`); suy ra project hiện tại từ route param. Menu chuyển dự án cũng có mục
   "Tất cả dự án" đầu tiên; chọn một project khác giữ nguyên trang đang mở (board/danh sách/docs/cài đặt) qua
   `projectSectionOf(path)` thay vì luôn mở board; các mục Board/Danh sách của một dự án chỉ active dưới
   `/projects/…`.
5. `apps/web/src/layout/quick-search.tsx` → `QuickSearch`: gọi `GET /v1/search`, điều hướng tới ticket hoặc
   trang docs (`docsPage()`, flow `docs-sync-viewer`). Chip phạm vi tìm kiếm trong thanh tìm ("Phạm vi tìm
   kiếm: tất cả dự án"/"dự án KEY") mở menu "Tìm trong" (Tất cả dự án + từng project) gửi `projectIds` sang
   `api.search()`; kết quả ticket và docs hiện `ProjectBadge` theo project của chúng; đóng menu trả focus về ô
   input (`onCloseAutoFocus` của `MenuContent`, `components/ui/dropdown-menu.tsx`) để owner gõ tiếp.
6. `apps/web/src/lib/shortcuts.ts` → `useShortcuts()`/`matchShortcut()`: bắt phím `/`, `c`, `g a`, `g b`, `g l`,
   `g d`, `g i`, `j`/`k`, `Enter`, `Esc`, `?`; chỉ hoạt động ở độ rộng desktop (`isDesktop()`), bỏ qua khi đang
   gõ trong input (`isTypingTarget()`) hoặc dialog đang mở.
7. `apps/web/src/lib/api-client.ts` → `api`, `ApiRequestError`: mọi lời gọi kiểm tra response bằng schema zod
   dùng chung, tự gắn header CSRF (`setCsrfToken()`) trên request ghi, gọi `onUnauthorized()` khi gặp 401 —
   gồm cả các route chỉ owner mới thấy như `/v1/project-change-requests*` (flow `project-claims`) và
   `/v1/notices/read*` (flow `event-delivery`) mà trang Inbox (flow `web-admin`) dùng. Ngoại lệ `quiet401`
   (`api.login()` gọi `/v1/auth/login`, một bước duy nhất trả về `SessionResponse`; và
   `api.changePassword()` gọi `/v1/auth/password`, flow `owner-auth`) không gọi `onUnauthorized()` khi
   gặp 401, để trang tự quyết định xử lý. `api.createPairingCode()`, `api.decideClaim(id, decision)` và
   `api.decideProjectChange(id, decision)` (flow `machine-pairing`/`project-claims`) không còn gửi body — chỉ
   gọi đúng route với method POST. `api.getTicketTree(idOrKey)` gọi `GET /v1/tickets/:id/tree`, kiểm
   response bằng `TicketTreeResponse` (flow `ticket-lifecycle`). `api.search(q, projectIds?)` gọi
   `GET /v1/search`, `api.getDocsOverview()` gọi `GET /v1/docs`, `api.searchDocsAcross(q, projectIds?)` gọi
   `GET /v1/docs/search` (cả hai route docs ở flow `docs-sync-viewer`). `api.getSettings()`,
   `api.getSettingsHistory()`, `api.validateSettings()`, `api.saveSettings()`, `api.restoreSettings()`,
   `api.diffSettings()` gọi các route `/v1/settings*` (flow `server-settings`).
8. `apps/web/src/lib/queries.ts` → `keys`, `sessionQuery`, `useTickets`/`useTicket`/`useProjects`/`useNotices`/
   `useProjectChanges`/…: định nghĩa toàn bộ query key và hook TanStack Query dùng chung cho các trang khác;
   `patchCachedTicket()` viết ticket vừa đổi vào mọi cache list/detail sau một lượt ghi — vì response ghi
   không có `agentActivity` (trường chỉ owner đọc mới có, flow `ticket-lifecycle`), nó giữ lại giá trị đang
   cache thay vì ghi đè bằng rỗng. `keys.tree(id)` = `['descendants', id, 'tree']` (dưới tiền tố `descendants`
   nên các invalidation hiện có phủ luôn nó); `useTicketTree(ticket, enabled)` nạp cây hậu duệ của một ticket
   qua `api.getTicketTree()`, dùng bởi "Cây ticket" của flow `web-tickets`. `keys.search(q, projectIds)`,
   `keys.docsOverview`, `keys.docsSearchAcross(q, projectIds)`, `useDocsOverview()`, `useDocsSearchAcross()` và
   `docsSpaceQuery()` phục vụ trang chủ docs và bộ chuyển dự án của flow `docs-sync-viewer`. `keys.settings`,
   `keys.settingsHistory(key)`, `useSettingsOverview()`, `useSettingsHistory(key)`, `useMachine(id)`,
   `useProjectByKey(key)` phục vụ mọi trang "Cài đặt hệ thống" (flow `server-settings`); `keys.settings` được
   invalidate khi nhận `settings.changed` (`invalidationsFor()`, flow `event-delivery`).
9. `apps/web/src/lib/ui-state.ts` → `useViewport()`, `useTheme()`, `useStoredState()`: phát hiện breakpoint
   (phone/tablet/desktop), theme sáng/tối lưu cục bộ, state lưu localStorage dùng chung.
10. `apps/web/src/lib/format.ts` → `errorMessage()`: dịch `ApiErrorCode` (`ERROR_TEXT`) sang một câu tiếng
    Việt cho form/toast đọc từ `ApiRequestError` — ví dụ `PM_NOT_AVAILABLE` ("Không gọi được PM: ticket này
    không thuộc PM task nào đang mở. Bỏ @pm để gửi bình luận thường.", flow `ticket-lifecycle`), hay
    `UNAUTHORIZED` ("Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.") mà `onUnauthorized()` (bước 1) không tự
    hiện — `errorMessage()` chỉ dịch khi một trang khác (ví dụ `ChangePasswordForm`, flow `owner-auth`) tự đọc
    lỗi 401 qua `quiet401`. `describeEvent()`
    dịch mỗi `EventEnvelope` sang một dòng lịch sử ticket — `ticket.pm_mentioned` thành "Bạn gọi PM (@pm) từ
    <sourceTicketKey>", hiện trên tab Lịch sử của pm_task (flow `web-tickets`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/web/src/main.tsx` | Bootstrap ứng dụng | — |
| `apps/web/src/router.tsx` | Route tree, query client | `createAppRouter`, `createAppQueryClient`, `routeTree`, `docsRoute`, `docsHomeRoute` |
| `apps/web/src/layout/app-shell.tsx` | Khung ứng dụng chính | `AppShell` |
| `apps/web/src/layout/project-sidebar.tsx` | Sidebar project | `ProjectSidebar`, `useCurrentProjectKey` |
| `apps/web/src/layout/breadcrumbs.tsx` | Breadcrumb dùng chung | `Breadcrumbs` |
| `apps/web/src/layout/quick-search.tsx` | Tìm kiếm nhanh | `QuickSearch` |
| `apps/web/src/layout/shell-context.ts` | Context hành động của shell | `ShellContext`, `useShell` |
| `apps/web/src/routes/home.tsx` | Điều hướng trang chủ | `HomeRedirect` |
| `apps/web/src/lib/api-client.ts` | API client kiểm tra schema + CSRF | `api`, `ApiRequestError`, `setCsrfToken`, `onUnauthorized` |
| `apps/web/src/lib/queries.ts` | Query key + hook TanStack Query dùng chung | `keys`, `sessionQuery`, `useTickets`, `useProjects`, `useMachines`, `useTicketTree` |
| `apps/web/src/lib/search-params.ts` | Schema search URL theo route | `BoardSearch`, `AllBoardSearch`, `ListSearch`, `AllListSearch`, `DocsSearch`, `DocsHomeSearch`, `ProjectFilterSearch`, `safeRedirect`, `parseProjectKeys` |
| `apps/web/src/lib/shortcuts.ts` | Phím tắt bàn phím | `useShortcuts`, `matchShortcut`, `SHORTCUT_HELP` |
| `apps/web/src/lib/ui-state.ts` | Viewport, theme, state cục bộ | `useViewport`, `useTheme`, `useStoredState` |
| `apps/web/src/lib/format.ts` | Nhãn/màu trạng thái, định dạng ngày/tiền, thông báo lỗi, mô tả sự kiện | `STATUS_LABEL`, `TYPE_META`, `formatDateTime`, `formatUsd`, `errorMessage`, `describeEvent` |
| `apps/web/src/lib/cn.ts` | Ghép class Tailwind | `cn` |
| `apps/web/src/styles/app.css` | Theme sáng/tối, biến CSS | — |
| `apps/web/src/components/ui/button.tsx` | Nút dùng chung | — |
| `apps/web/src/components/ui/dialog.tsx` | Dialog dùng chung (Radix) | — |
| `apps/web/src/components/ui/dropdown-menu.tsx` | Menu thả xuống dùng chung (Radix) | — |
| `apps/web/src/components/ui/field.tsx` | Input/field dùng chung | — |
| `apps/web/src/components/ui/info-tip.tsx` | Tooltip/popover chạm (mobile) | — |
| `apps/web/src/components/ui/tabs.tsx` | Tabs dùng chung | — |
| `apps/web/src/components/ui/toast.tsx` | Toast thông báo | `ToastProvider` |

## Dữ liệu

- Bảng: không (chỉ gọi API).
- Sự kiện: tiêu thụ toàn bộ sự kiện qua `startLiveEvents()` (flow `event-delivery`) ở tầng shell.
- Gọi ngoài: gọi API `apps/api` qua `lib/api-client.ts`.

## Flow liên quan

- event-delivery: `startLiveEvents()` được khởi tạo trong `AppShell`.
- owner-auth: `beforeLoad` của `appRoute` gác mọi trang trừ `/login`; `api-client.ts` gắn CSRF cho request ghi.
- docs-sync-viewer: route `docsRoute`/`docsHomeRoute`, `QuickSearch`, sidebar và phím `g d` dẫn tới docs space
  hoặc trang chủ docs; `api.getDocsOverview()`/`api.searchDocsAcross()` và các hook `useDocsOverview`/
  `useDocsSearchAcross`/`docsSpaceQuery` ở `queries.ts` phục vụ trang chủ docs và bộ chuyển dự án của flow đó.
- web-tickets, web-admin: dùng lại `queries.ts`, `format.ts`, `ui-state.ts`, component `ui/*` và
  `ShellContext` của flow này; `ProjectFilterMenu`/`selectedProjects()` (`components/project-filter.tsx`, flow
  `web-tickets`) là bộ lọc "Dự án" dùng chung mà Inbox và Máy (flow `web-admin`) cũng dùng lại.
- server-settings: mục sidebar "Cài đặt hệ thống"; `api.getSettings()`/`saveSettings()`/`restoreSettings()`/
  `diffSettings()`/`validateSettings()`/`getSettingsHistory()` và `keys.settings`/`keys.settingsHistory`/
  `useSettingsOverview`/`useSettingsHistory` phục vụ mọi trang cài đặt của flow đó.

## Tests

- `apps/web/src/lib/api-client.test.ts`: header CSRF, xử lý 401 toàn cục, kiểm tra schema response, phân
  trang.
- `apps/web/src/lib/queries.test.tsx`: hook query trả đúng dữ liệu/khoá cache.
- `apps/web/src/lib/search-params.test.ts`: parse/serialize filter URL, `safeRedirect` chỉ cho path cùng gốc.
- `apps/web/src/lib/shortcuts.test.ts`: khớp phím, bỏ qua khi đang gõ/desktop-only.
- `apps/web/src/lib/format.test.ts`: định dạng ngày giờ (Asia/Ho_Chi_Minh) và tiền.
- `apps/web/src/layout/quick-search.test.tsx`: badge project trên mỗi kết quả; chip phạm vi tìm kiếm gửi
  `projectIds` và trả focus về ô input sau khi chọn, danh sách kết quả vẫn mở (lượt đóng trễ sau khi blur bị
  hủy khi ô input được focus lại).
- `apps/web/src/layout/project-sidebar.test.tsx`: `projectSectionOf()`; mục "Tài liệu" dẫn `/docs`; chuyển
  project giữ nguyên trang danh sách đang mở.
