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
   `setCsrfToken()` rồi mọi route con render trong `AppShell`. Toàn bộ path (`/`, `/requests`,
   `/projects/$projectKey/board|list|docs|settings`, `/tickets/$ticketKey`, `/projects`, `/inbox`,
   `/machines`, `/login`) khai báo tại đây; `search` của mỗi route được validate bằng schema ở
   `lib/search-params.ts`.
3. `apps/web/src/layout/app-shell.tsx` → `AppShell()`: dựng top bar (logo, `QuickSearch`, nút "Tạo", chuông
   Inbox, menu owner), chọn `ProjectSidebar` theo `useViewport()` (full/rail/drawer), gắn `useShortcuts()`
   toàn cục, và `useEffect` gọi `startLiveEvents()` (flow `event-delivery`) — khi stream đóng hẳn, kiểm tra lại
   session và điều hướng về login nếu mất.
4. `apps/web/src/layout/project-sidebar.tsx` → `ProjectSidebar()`, `useCurrentProjectKey()`: sidebar chọn
   project, "Tất cả request của tôi", Board/Danh sách/Docs/Cài đặt, rồi Inbox/Dự án/Máy; suy ra project hiện
   tại từ route param.
5. `apps/web/src/layout/quick-search.tsx` → `QuickSearch`: gọi `GET /v1/search`, điều hướng tới ticket hoặc
   trang docs (`docsPage()`, flow `docs-sync-viewer`).
6. `apps/web/src/lib/shortcuts.ts` → `useShortcuts()`/`matchShortcut()`: bắt phím `/`, `c`, `g b`, `g l`,
   `g d`, `g i`, `j`/`k`, `Enter`, `Esc`, `?`; chỉ hoạt động ở độ rộng desktop (`isDesktop()`), bỏ qua khi đang
   gõ trong input (`isTypingTarget()`) hoặc dialog đang mở.
7. `apps/web/src/lib/api-client.ts` → `api`, `ApiRequestError`: mọi lời gọi kiểm tra response bằng schema zod
   dùng chung, tự gắn header CSRF (`setCsrfToken()`) trên request ghi, gọi `onUnauthorized()` khi gặp 401.
8. `apps/web/src/lib/queries.ts` → `keys`, `sessionQuery`, `useTickets`/`useTicket`/`useProjects`/…: định
   nghĩa toàn bộ query key và hook TanStack Query dùng chung cho các trang khác.
9. `apps/web/src/lib/ui-state.ts` → `useViewport()`, `useTheme()`, `useStoredState()`: phát hiện breakpoint
   (phone/tablet/desktop), theme sáng/tối lưu cục bộ, state lưu localStorage dùng chung.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/web/src/main.tsx` | Bootstrap ứng dụng | — |
| `apps/web/src/router.tsx` | Route tree, query client | `createAppRouter`, `createAppQueryClient`, `routeTree`, `docsRoute` |
| `apps/web/src/layout/app-shell.tsx` | Khung ứng dụng chính | `AppShell` |
| `apps/web/src/layout/project-sidebar.tsx` | Sidebar project | `ProjectSidebar`, `useCurrentProjectKey` |
| `apps/web/src/layout/breadcrumbs.tsx` | Breadcrumb dùng chung | `Breadcrumbs` |
| `apps/web/src/layout/quick-search.tsx` | Tìm kiếm nhanh | `QuickSearch` |
| `apps/web/src/layout/shell-context.ts` | Context hành động của shell | `ShellContext`, `useShell` |
| `apps/web/src/routes/home.tsx` | Điều hướng trang chủ | `HomeRedirect` |
| `apps/web/src/lib/api-client.ts` | API client kiểm tra schema + CSRF | `api`, `ApiRequestError`, `setCsrfToken`, `onUnauthorized` |
| `apps/web/src/lib/queries.ts` | Query key + hook TanStack Query dùng chung | `keys`, `sessionQuery`, `useTickets`, `useProjects`, `useMachines` |
| `apps/web/src/lib/search-params.ts` | Schema search URL theo route | `BoardSearch`, `ListSearch`, `DocsSearch`, `safeRedirect` |
| `apps/web/src/lib/shortcuts.ts` | Phím tắt bàn phím | `useShortcuts`, `matchShortcut`, `SHORTCUT_HELP` |
| `apps/web/src/lib/ui-state.ts` | Viewport, theme, state cục bộ | `useViewport`, `useTheme`, `useStoredState` |
| `apps/web/src/lib/format.ts` | Nhãn/màu trạng thái, định dạng ngày/tiền | `STATUS_LABEL`, `TYPE_META`, `formatDateTime`, `formatUsd` |
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
- docs-sync-viewer: route `docsRoute`, `QuickSearch` và phím `g d` dẫn tới docs space.
- web-tickets, web-admin: dùng lại `queries.ts`, `format.ts`, `ui-state.ts`, component `ui/*` và
  `ShellContext` của flow này.

## Tests

- `apps/web/src/lib/api-client.test.ts`: header CSRF, xử lý 401 toàn cục, kiểm tra schema response, phân
  trang.
- `apps/web/src/lib/queries.test.tsx`: hook query trả đúng dữ liệu/khoá cache.
- `apps/web/src/lib/search-params.test.ts`: parse/serialize filter URL, `safeRedirect` chỉ cho path cùng gốc.
- `apps/web/src/lib/shortcuts.test.ts`: khớp phím, bỏ qua khi đang gõ/desktop-only.
- `apps/web/src/lib/format.test.ts`: định dạng ngày giờ (Asia/Ho_Chi_Minh) và tiền.
