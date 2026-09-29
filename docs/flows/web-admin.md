# Inbox, dự án và máy trên web

> Flow `web-admin`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow web-admin` in ra
> đúng danh sách đó.

## Mục đích

Màn hình quản trị của owner: Inbox tổng hợp mọi việc cần xử lý (duyệt chuyển máy, ticket chờ trả lời, vượt
ngân sách, máy offline/lỗi health, dự án chưa có máy) cộng nhật ký thông báo; quản lý project (tạo/sửa, ngân
sách, chuyển máy); quản lý máy (ghép máy, thu hồi, đặt máy trợ lý, xem inventory skill/MCP, job đang chạy).

## Điểm vào

- `apps/web/src/routes/inbox.tsx` → `InboxPage` — `/inbox`.
- `apps/web/src/routes/projects.tsx` → `ProjectsPage` — `/projects`.
- `apps/web/src/routes/project-settings.tsx` → `ProjectSettingsPage` — `/projects/$projectKey/settings`.
- `apps/web/src/routes/machines.tsx` → `MachinesPage` — `/machines`.

## Các bước

1. `apps/web/src/lib/inbox.ts` → `useInboxSummary()`: gộp claim đang chờ, yêu cầu đổi loại project đang chờ
   (`pendingChanges`, flow `project-claims`), ticket `needs_input` (tách riêng loại chờ trả lời với loại chờ
   duyệt ngân sách qua `budgetHold`), máy offline/lỗi health, project chưa có máy, và thông báo (`GET
   /v1/notices` → `{items, unread}`); `unread` và trạng thái đã đọc từng thông báo do server giữ (bảng
   `notice_reads`, flow `event-delivery`) — không còn lưu mốc đã đọc ở localStorage, nên mọi thiết bị của
   owner thấy cùng số chưa đọc; `markRead(ids)`/`markAllRead(throughId?)` gọi `POST /v1/notices/read`/
   `read-all`. `badge` = số việc cần làm (gồm cả `pendingChanges`) + số thông báo chưa đọc.
2. `apps/web/src/routes/inbox.tsx` → `InboxPage()`: render từng nhóm (`Group`); mở trang tự đánh dấu đã đọc
   tới thông báo mới nhất đang hiển thị (`markAllRead(newest.id)`, để thông báo tới trong lúc đang mở không bị
   đánh dấu hụt), thông báo chưa đọc lúc mở giữ chấm chưa đọc suốt lượt xem đó (`openedUnread`); thông báo còn
   chưa đọc trên server có nút "Đã đọc" (`markRead([id])`), có nút "Đánh dấu tất cả đã đọc" và đếm "N chưa đọc"
   khi còn thông báo chưa đọc. `ClaimItem` mở `TotpDialog` để duyệt/từ chối yêu cầu chuyển máy (gọi
   `api.decideClaim`, flow `project-claims`); `ProjectChangeItem` cũng mở `TotpDialog` để duyệt/từ chối yêu
   cầu đổi loại project (gọi `api.decideProjectChange`); `describeNotice()` diễn giải từng loại sự kiện thông
   báo (`machine.claimed`, `claim.requested`, `machine.released`, `project.created`, `machine.offline`,
   `machine.unhealthy`, `budget.exceeded`, `project.change_requested`, `ticket.stuck`) thành câu tiếng Việt —
   riêng `budget.exceeded` và `ticket.stuck` (flow `ticket-lifecycle`) kèm link "mở ticket". Bộ lọc "Dự án"
   (`ProjectFilterMenu`, URL `project=KEY,KEY`, flow `web-tickets`) thu hẹp mọi nhóm: yêu cầu chuyển máy (theo
   `projectKey`, ẩn yêu cầu nhận vai trò trợ lý vì không thuộc project nào), yêu cầu đổi loại project, ticket
   `needs_input` (server nạp lại kèm `projectIds` khi có lọc, cùng bộ lọc project của board/danh sách), máy
   offline/lỗi health (theo `projectKeys`), project chưa có máy, và thông báo (theo `event.projectId`, kèm dòng
   "Ẩn N thông báo không thuộc dự án đã chọn."); `ProjectBadge` hiện trên dòng ticket và thông báo; chuông
   Inbox và trạng thái đã đọc vẫn tính trên toàn bộ (không theo bộ lọc).
3. `apps/web/src/routes/projects.tsx` → `ProjectsPage()`, `ProjectCard`: danh sách project (badge trạng thái
   docs qua `DocsStatusLozenge`, link "Xem docs" tới docs space của project, flow `docs-sync-viewer`), dialog
   tạo/sửa dùng `ProjectForm`, dialog chuyển máy dùng `ReassignDialog`.
4. `apps/web/src/components/project-form.tsx` → `ProjectForm()`: form tên/mô tả (gợi ý "mô tả quyết định định
   tuyến"), repo URL, platform, tên MCP test UI, giới hạn con/ngân sách cây/ngân sách ngày; `ReassignDialog()`
   gọi `api.assignToMachine()` (flow `project-claims`) kèm xác nhận.
5. `apps/web/src/routes/project-settings.tsx` → `ProjectSettingsPage()`: cùng `ProjectForm` cho project hiện
   tại (từ sidebar "Cài đặt project"). `BmadProfileSection()` hiện hồ sơ cài BMAD mới nhất mà một máy giữ
   project báo cáo (`Project.bmadProfile`, flow `project-claims`) — phiên bản và giờ cài (`Asia/Ho_Chi_Minh`),
   module, công cụ, ngôn ngữ, thư mục kết quả, số cấu hình module — chỉ đọc, không sửa được trên web; chưa máy
   nào báo thì hiện "Chưa có cấu hình BMAD (máy đang giữ project chưa có BMAD)".
6. `apps/web/src/routes/machines.tsx` → `MachinesPage()`, `MachineCard()`: danh sách máy (online/paused/health
   với các check lỗi, tài nguyên, mục "Job" (`MachineJobs`) liệt kê job đang chạy (kèm model/effort), đang chờ
   (lý do qua `describeWait()` của flow `web-tickets`) và lỗi gần nhất của máy — mỗi dòng liên kết ticket khi
   đã biết key kèm `ProjectBadge` của ticket đó —, project sở hữu (hiện bằng badge), phiên bản app/CLI, hạn
   token — đỏ khi dưới `TOKEN_WARN_DAYS=14`), nút "Ghép máy mới" (`PairingDialog`), "Đặt làm máy trợ
   lý"/"Thu hồi" (xác nhận rồi gọi `api.assignToMachine`/`api.revokeMachine`, flow `machine-pairing`). Bộ lọc
   "Dự án" (`ProjectFilterMenu`, URL `project=KEY,KEY`, flow `web-tickets`) chỉ giữ máy có `projectKeys` chứa
   một project đã chọn (kèm dòng "Ẩn N máy không giữ dự án đã chọn."); `MachineJobs` chỉ liệt kê job có ticket
   thuộc project đã chọn (job có ticket chưa tải xong vẫn hiện tạm tới khi biết project).
7. `apps/web/src/routes/machines.tsx` → `Inventory()`: xổ danh sách skill/MCP theo từng project (và cấp máy)
   từ `MachineDetailResponse.inventories`, mỗi skill có tooltip chạm (`InfoTip`, flow `web-shell`) hiện nguồn
   và mô tả.
8. `apps/web/src/components/pairing-dialog.tsx` → `PairingDialog()`: yêu cầu TOTP, tạo mã pairing một lần
   (hiện kèm đếm ngược), gọi `POST /v1/machines/pairing-codes` (flow `machine-pairing`).
9. `apps/web/src/components/totp-dialog.tsx` → `TotpDialog()`: hộp thoại xác nhận hành động nhạy cảm bằng mã
   TOTP, dùng chung cho duyệt claim, duyệt đổi loại project và tạo mã pairing.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/web/src/routes/inbox.tsx` | Trang Inbox | `InboxPage` |
| `apps/web/src/routes/projects.tsx` | Danh sách/tạo/sửa project | `ProjectsPage`, `DocsStatusLozenge` |
| `apps/web/src/routes/project-settings.tsx` | Cài đặt project hiện tại | `ProjectSettingsPage` |
| `apps/web/src/routes/machines.tsx` | Danh sách/chi tiết máy | `MachinesPage`, `MachineCard`, `Inventory`, `MachineJobs` |
| `apps/web/src/lib/inbox.ts` | Gộp dữ liệu Inbox + đếm chưa đọc | `useInboxSummary`, `InboxSummary` |
| `apps/web/src/components/project-form.tsx` | Form project + chuyển máy | `ProjectForm`, `ReassignDialog`, `PLATFORM_LABEL` |
| `apps/web/src/components/pairing-dialog.tsx` | Tạo mã pairing | `PairingDialog` |
| `apps/web/src/components/totp-dialog.tsx` | Xác nhận TOTP dùng chung | `TotpDialog` |

## Dữ liệu

- Bảng: không trực tiếp (qua API các flow `project-claims`, `machine-pairing`, `event-delivery`).
- Sự kiện: tiêu thụ `claim.requested`, `machine.claimed`, `machine.released`, `project.created`,
  `machine.offline`, `machine.unhealthy`, `budget.exceeded`, `project.change_requested`, `ticket.stuck` (danh sách
  `NOTICE_EVENT_TYPES`) qua `GET /v1/notices` cùng `unread` do server tính; `inbox.read` và
  `project.change_decided` làm mới Inbox qua `invalidationsFor()` (flow `event-delivery`).
- Gọi ngoài: gọi API qua `lib/api-client.ts` (flow `web-shell`).

## Flow liên quan

- project-claims: duyệt/từ chối claim, tạo/sửa project, chuyển máy sở hữu, duyệt/từ chối yêu cầu đổi loại
  project và MCP test UI mà một máy tự đề nghị; `BmadProfileSection` hiện `Project.bmadProfile` chỉ đọc — cài
  đặt BMAD trên máy khác chỉ làm được ở app desktop (flow `desktop-app`/`desktop-ui`), không phải trên web.
- machine-pairing: tạo mã pairing, thu hồi máy, đặt máy trợ lý, đọc inventory skill/MCP.
- ticket-lifecycle: nguồn thông báo `ticket.stuck` (báo ticket không máy nào đang xử lý).
- event-delivery: nguồn thông báo (`/v1/notices`) và làm mới trực tiếp qua SSE.
- web-tickets: `MachineJobs` (`machines.tsx`) dùng lại `describeWait()`/`formatClock()` của
  `agent-activity.tsx` để hiện lý do chờ và giờ nhận job; bộ lọc "Dự án" của Inbox và Máy dùng chung
  `ProjectFilterMenu`/`selectedProjects()` (`components/project-filter.tsx`) và `ProjectBadge`.
- docs-sync-viewer: `ProjectsPage` có link "Xem docs" tới docs space của mỗi project.
- web-shell: dùng chung `Breadcrumbs`, `StatusLozenge`, `ui/*`, `useStoredState`.

## Tests

- `apps/web/src/routes/inbox.test.tsx`: duyệt claim kèm TOTP (và mã sai), đếm badge, nhóm hiển thị đúng, đánh
  dấu đã đọc (một thông báo và tất cả) phản ánh đúng số chưa đọc; bộ lọc "Dự án" ẩn claim/ticket/máy/project
  chưa có máy/thông báo không thuộc project đã chọn, gửi `projectIds` cho server, hiện `ProjectBadge`.
- `apps/web/src/components/pairing-dialog.test.tsx`: tạo mã, đếm ngược, lỗi TOTP.
- `apps/web/src/routes/project-settings.test.tsx`: hiện đúng hồ sơ BMAD chỉ đọc trên trang cài đặt project;
  báo đúng câu khi chưa máy nào báo cáo hồ sơ.
- `apps/web/src/routes/machines.test.tsx`: badge project trên mỗi job; bộ lọc "Dự án" giữ đúng máy và chỉ job
  của project đã chọn, ghi lại `project=` trong URL.
- `apps/web/e2e/owner-admin.spec.ts`: phím tắt (kể cả "Tạo thêm"), quick search, kéo-thả bị từ chối, đổi ưu
  tiên hàng loạt, ghép máy bằng TOTP, duyệt chuyển máy từ máy B trong Inbox rồi chuyển project về từ trang Dự
  án, chế độ tối.
