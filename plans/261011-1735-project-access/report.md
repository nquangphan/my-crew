# Quyền xem project theo thành viên — thiết kế ngắn và báo cáo

Ngày 11/10/2026 (Asia/Ho_Chi_Minh). Worktree `~/Documents/projects/crew/.worktrees/paperclip-issues-ui`, nhánh
`crew/project-access` (từ `crew/v3.5`). Hai commit, chưa push:

- `546d92595` feat(crew): quyền xem project theo thành viên ở server và plugin
- `e400b719d` feat(crew-web): lọc project và yêu cầu theo quyền xem, owner chọn ở trang Thành viên

## Luật

- Owner của company thấy mọi project và mọi yêu cầu.
- Mọi thành viên người khác (admin, operator, viewer, Phòng Marketing) chỉ thấy project owner đã cấp. Mặc định không
  thấy project nào. Yêu cầu không thuộc project nào chỉ owner thấy.
- Agent không bị ảnh hưởng. API lõi Paperclip không đổi: đọc thẳng `/api/...` hay `/paperclip/` vẫn thấy (đúng quyết
  định 1 của owner).
- Server chỉ chặn ở route Crew: góp ý Phòng Marketing (gửi yêu cầu, bình luận, và bước duyệt của owner).

## Mô hình dữ liệu

Migration plugin `packages/crew-plugin/migrations/0016_project_access.sql`:

```sql
plugin_crew_core_0433ea20b6.crew_project_access (
  company_id uuid, user_id text, project_id uuid,
  granted_by_user_id text, granted_at timestamptz DEFAULT now(),
  PRIMARY KEY (company_id, user_id, project_id))
+ index crew_project_access_project_idx (company_id, project_id)
```

Chỉ server đọc/ghi bảng này (raw SQL, như `crew_contributions`); test cô lập của plugin cấm file nguồn plugin nhắc tới
nó. Grant giữ nguyên khi đổi role; role được đọc từ `company_memberships` mỗi lần, nên người được nâng lên owner tự thấy
hết. Bảng chưa có thì người bị giới hạn không thấy project nào (đóng khi lỗi), PUT trả 503.

`crew.roots` (plugin) trả thêm `projectId` để UI lọc yêu cầu gốc.

## Endpoint (router Crew, không có vá lõi mới)

Router `server/src/crew/project-access-routes.ts` gắn bên trong `crewContributionRoutes` (vá C7 có sẵn); mục C7 trong
`crew/release/core-hooks.json` chỉ cập nhật mô tả và danh sách test. Cùng luật người gọi với router góp ý: chỉ board
phiên trình duyệt, role đọc từ DB.

| Endpoint | Ai | Trả |
|---|---|---|
| `GET /api/crew/companies/:cid/project-access/me` | mọi thành viên | `{ all: true, projectIds: [] }` cho owner, còn lại `{ all: false, projectIds }` |
| `GET /api/crew/companies/:cid/project-access` | owner | `{ items: [{ userId, all, projectIds }] }` cho mọi thành viên `active` |
| `PUT /api/crew/companies/:cid/project-access/:userId` `{ projectIds }` | owner | thay cả danh sách; 409 `crew_project_access_not_member` (owner/người lạ), 422 `crew_project_access_invalid` (project company khác), 400 body sai, 503 chưa có bảng |

Chặn ở góp ý (`server/src/crew/contributions.ts`), mã `crew_project_not_visible`:

- tạo yêu cầu vào project không được xem: 403;
- bình luận vào issue của project không được xem, hoặc issue không có project: 403;
- owner duyệt góp ý của người đã mất quyền project đó: 409 (mục giữ `pending`, owner từ chối hoặc cấp lại).

## UI Crew: mọi chỗ lọc

Một hook `useVisibleProjects()` (`src/features/access/use-visible-projects.ts`) đọc `/project-access/me` và cấp
`filterProjects`/`filterIssues`/`canSeeProject`/`canSeeIssue`. Lọc bằng `select` của TanStack Query nên cache gốc không
bị đổi. `AccessGuard` đợi tải xong quyền trước khi hiện trang (lỗi thì báo kèm Thử lại).

| Chỗ | File | Cách |
|---|---|---|
| Danh sách project | `features/projects/list/projects-page.tsx` | lọc; chưa được cấp gì thì "Bạn chưa được cấp project nào" |
| Chi tiết project | `features/projects/detail/project-page.tsx` | "Bạn không có quyền xem project này", không hiện tab |
| Danh sách yêu cầu (gồm yêu cầu gốc, ô lọc project, chip góp ý chờ) | `features/issues/list/use-issues.ts`, `issues-page.tsx` | lọc |
| Popup/trang yêu cầu mở bằng URL, yêu cầu con | `features/issues/detail/issue-detail.tsx`, `use-issue.ts` | "Bạn không có quyền xem yêu cầu này", không đánh dấu đã đọc |
| Tổng quan | `features/dashboard/use-dashboard.ts`, `dashboard-page.tsx`, `dashboard-logic.ts` | người bị giới hạn: số đang làm/kẹt/mở đếm từ yêu cầu đã lọc, bỏ biểu đồ Run theo ngày và Tỉ lệ thành công, thẻ run chỉ của yêu cầu thấy được (và run không gắn yêu cầu), hoạt động chỉ yêu cầu/project thấy được và agent, yêu cầu gốc lọc |
| Hộp thư, badge Hộp thư, thẻ Chờ bạn duyệt | `features/inbox/use-inbox-issues.ts`, `use-inbox-badge.ts` | lọc; badge của người bị giới hạn chỉ đếm yêu cầu chưa đọc đã lọc (bỏ số sidebar-badges toàn company) |
| Tìm kiếm | `features/search/search-page.tsx` (`resultVisible`) | theo project của yêu cầu/tài liệu/project; agent luôn thấy |
| Bảng lệnh | `app/shell/command-palette.tsx` | lọc |
| Thanh bên (project gắn sao) | `app/shell/sidebar.tsx` | lọc |
| Hộp thoại Yêu cầu mới, Gửi góp ý (ô project) | `features/issues/new/new-request-dialog.tsx`, `features/contributions/new-contribution-dialog.tsx` | lọc |
| Góp ý của tôi, popup góp ý | `features/contributions/contributions-page.tsx`, `contribution-popup.tsx` | ẩn yêu cầu góp ý vào project bị ẩn, số tab đếm từ danh sách đã lọc, tên project chỉ khi thấy được |
| Docs | `features/docs/docs-page.tsx` | lọc project |
| Trang agent (yêu cầu đang giữ, vai trò ở project) | `features/agents/detail/overview-tab.tsx`, `use-agent-roles.ts` | lọc |
| Trang run (yêu cầu run đã chạm) | `features/runs/run-page.tsx` | chỉ yêu cầu có trong danh sách thấy được |
| Wizard Tạo agent (chọn project) | `features/wizards/add-agent/add-agent-page.tsx` | lọc |
| Hướng dẫn | nội dung tĩnh; ảnh chụp | không cần lọc; tài khoản ảnh được cấp cả hai project mẫu |

Trang Thành viên (`features/members/members-section.tsx`, `project-access-cell.tsx`): cột "Project được xem". Owner hiện
**Tất cả**; người khác có nút ghi tên project đã cấp (hoặc "Chưa có project"), mở danh sách hộp chọn project đang dùng và
nút Lưu (PUT cả danh sách; grant ở project đã gỡ được giữ).

## Test

- Server, chạy từng file DB: `crew-project-access.db.test.ts` (7 ca mới: chưa có bảng, mặc định không thấy, chỉ owner
  quản lý, kiểm dữ liệu, cấp/thay/thu hồi, chặn góp ý và bình luận kể cả issue không có project, duyệt 409 khi mất quyền),
  `crew-contributions.db.test.ts` 41 ca, `crew-contributions-agent-blind.test.ts` 5 ca: đạt. Hai file cũ áp thêm 0016 và
  cấp project cho khách.
- Plugin: `migration-0016.db.test.ts` (mới), `migration-0013.db.test.ts`, `roots.data.test.ts`,
  `contributions-isolation.test.ts`: đạt.
- crew-web: 139 file, 1234 ca đạt. Mới: `test/features/access/use-visible-projects.test.tsx` (hàm thuần, hook, đếm Tổng
  quan, lọc tìm kiếm); thêm ca ở `projects-page`, `project-page`, `issues-page`, `issue-popup`, `dashboard-page`,
  `members-page` (Tất cả, chọn rồi Lưu gửi đúng body, lỗi có mã hiện câu đã dịch).
- `tsc`: server 0 lỗi (sau `pnpm run typecheck` dựng vendor runner; bước `cargo` của runner thiếu trên máy nhưng không
  ảnh hưởng tsc), plugin, crew-web, e2e: đạt. Biome crew-web (`src`, `test`, `e2e`): sạch.
- `node crew/release/check-core-hooks.mjs`: 0 lỗi (hook 5/5, vá lõi 8); `check-core-hooks.test.mjs`: đạt.
- `vite build` với `CREW_UI_COMMIT=e400b719d1ccf325cee301d257c52a8f25542b35` ra thư mục scratch: đạt, commit có trong
  `index.html`.
- E2E T1 (`~/crew-ga-t1`, `FORK` trỏ worktree này, plugin build lại, migration 0016 đã áp):
  `--grep "PW-S21|PW-S20"` (PW-S20-7 là ca trang Thành viên): 8/8 đạt lần đầu.
- Ảnh hướng dẫn: `CREW_GUIDE_SHOTS_ONLY=members,project-access,dashboard` (vi và en): đạt. Ảnh mới
  `img/{vi,en}/project-access.webp`; chụp lại `members` và `dashboard.*` (cột mới, Tổng quan của vai trò bị giới hạn chỉ
  còn một biểu đồ).
- Đã dừng server T1 và web dev bằng SIGTERM; cổng 3199, 5183, 54329 trống.

## Ghi chú triển khai

1. **Thứ tự: server + plugin trước, web sau.** Web mới gọi `GET …/project-access/me` và `AccessGuard` chặn trang khi lời
   gọi lỗi, nên nếu web lên trước server thì mọi người (cả owner) thấy lỗi "Không tải được danh sách project bạn được xem".
2. **Migration 0016** nằm trong plugin `crew.core`: cập nhật plugin (build `packages/crew-plugin`) rồi khởi động lại
   server để plugin kích hoạt và áp migration. Server và plugin đi cùng một bản fork. Kiểm:
   `SELECT to_regclass('plugin_crew_core_0433ea20b6.crew_project_access')`.
3. **Ngay sau khi lên prod, mọi thành viên không phải owner không thấy project nào** (đúng quyết định 2). Owner cần vào
   Thành viên cấp project cho từng người, nhất là tài khoản Phòng Marketing (không cấp thì không gửi được góp ý nào).
4. E2E T2 trên Crew E2E: `s20` tự cấp project nền cho tài khoản khách trong `beforeAll`; `PW-S21-1` chỉ chạy T1.

## Giới hạn đã biết

- Chỉ là lớp ẩn của UI Crew; API lõi và giao diện Paperclip gốc vẫn trả đủ (đã chấp nhận).
- Admin/operator vẫn bình luận, đổi trạng thái qua route lõi; server chỉ chặn route góp ý của Crew.
- Nội dung transcript/log của trang run vẫn hiện nếu người dùng mở đúng URL run; chỉ danh sách yêu cầu run đã chạm được
  lọc. Thẻ run ở Tổng quan đã lọc.
- Danh sách lọc ở máy khách nên giới hạn số dòng của server (500 ở Tổng quan, 1000 ở Yêu cầu) tính trước khi lọc.
- Số chờ duyệt của khách ở thanh bên vẫn là số của server (chỉ mục của chính họ).
- Admin/operator tạo project bằng wizard sẽ không thấy project đó cho tới khi owner cấp.

Status: DONE
