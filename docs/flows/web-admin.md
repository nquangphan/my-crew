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

1. `apps/web/src/lib/inbox.ts` → `useInboxSummary()`: gộp claim đang chờ, ticket `needs_input` (tách riêng
   loại chờ trả lời với loại chờ duyệt ngân sách qua `budgetHold`), máy offline/lỗi health, project chưa có
   máy, và thông báo (`GET /v1/notices`); đếm chưa đọc bằng mốc `seq` lớn nhất lưu trong localStorage
   (`LAST_READ_KEY`, qua `useStoredState`); `badge` = số việc cần làm + số thông báo chưa đọc.
2. `apps/web/src/routes/inbox.tsx` → `InboxPage()`: render từng nhóm (`Group`), tự đánh dấu đã đọc khi mở
   trang (giữ nguyên chấm chưa đọc cho các thông báo đã có lúc mở, qua `readBefore`); `ClaimItem` mở
   `TotpDialog` để duyệt/từ chối yêu cầu chuyển máy (gọi `api.decideClaim`, flow `project-claims`);
   `describeNotice()` diễn giải từng loại sự kiện thông báo (`machine.claimed`, `claim.requested`,
   `machine.released`, `project.created`, `machine.offline`, `machine.unhealthy`, `budget.exceeded`) thành câu
   tiếng Việt.
3. `apps/web/src/routes/projects.tsx` → `ProjectsPage()`, `ProjectCard`: danh sách project (badge trạng thái
   docs qua `DocsStatusLozenge`), dialog tạo/sửa dùng `ProjectForm`, dialog chuyển máy dùng `ReassignDialog`.
4. `apps/web/src/components/project-form.tsx` → `ProjectForm()`: form tên/mô tả (gợi ý "mô tả quyết định định
   tuyến"), repo URL, platform, tên MCP test UI, giới hạn con/ngân sách cây/ngân sách ngày; `ReassignDialog()`
   gọi `api.assignToMachine()` (flow `project-claims`) kèm xác nhận.
5. `apps/web/src/routes/project-settings.tsx` → `ProjectSettingsPage()`: cùng `ProjectForm` cho project hiện
   tại (từ sidebar "Cài đặt project").
6. `apps/web/src/routes/machines.tsx` → `MachinesPage()`, `MachineCard()`: danh sách máy (online/paused/health
   với các check lỗi, tài nguyên, job đang chạy liên kết ticket, project sở hữu, phiên bản app/CLI, hạn token —
   đỏ khi dưới `TOKEN_WARN_DAYS=14`), nút "Ghép máy mới" (`PairingDialog`), "Đặt làm máy trợ lý"/"Thu hồi" (xác
   nhận rồi gọi `api.assignToMachine`/`api.revokeMachine`, flow `machine-pairing`).
7. `apps/web/src/routes/machines.tsx` → `Inventory()`: xổ danh sách skill/MCP theo từng project (và cấp máy)
   từ `MachineDetailResponse.inventories`, mỗi skill có tooltip chạm (`InfoTip`, flow `web-shell`) hiện nguồn
   và mô tả.
8. `apps/web/src/components/pairing-dialog.tsx` → `PairingDialog()`: yêu cầu TOTP, tạo mã pairing một lần
   (hiện kèm đếm ngược), gọi `POST /v1/machines/pairing-codes` (flow `machine-pairing`).
9. `apps/web/src/components/totp-dialog.tsx` → `TotpDialog()`: hộp thoại xác nhận hành động nhạy cảm bằng mã
   TOTP, dùng chung cho duyệt claim và tạo mã pairing.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/web/src/routes/inbox.tsx` | Trang Inbox | `InboxPage` |
| `apps/web/src/routes/projects.tsx` | Danh sách/tạo/sửa project | `ProjectsPage`, `DocsStatusLozenge` |
| `apps/web/src/routes/project-settings.tsx` | Cài đặt project hiện tại | `ProjectSettingsPage` |
| `apps/web/src/routes/machines.tsx` | Danh sách/chi tiết máy | `MachinesPage`, `MachineCard`, `Inventory` |
| `apps/web/src/lib/inbox.ts` | Gộp dữ liệu Inbox + đếm chưa đọc | `useInboxSummary`, `InboxSummary` |
| `apps/web/src/components/project-form.tsx` | Form project + chuyển máy | `ProjectForm`, `ReassignDialog`, `PLATFORM_LABEL` |
| `apps/web/src/components/pairing-dialog.tsx` | Tạo mã pairing | `PairingDialog` |
| `apps/web/src/components/totp-dialog.tsx` | Xác nhận TOTP dùng chung | `TotpDialog` |

## Dữ liệu

- Bảng: không trực tiếp (qua API các flow `project-claims`, `machine-pairing`, `event-delivery`).
- Sự kiện: tiêu thụ `claim.requested`, `machine.claimed`, `machine.released`, `project.created`,
  `machine.offline`, `machine.unhealthy`, `budget.exceeded` (danh sách `NOTICE_EVENT_TYPES`) qua
  `GET /v1/notices` và qua `invalidationsFor()` (flow `event-delivery`) để làm mới trực tiếp.
- Gọi ngoài: gọi API qua `lib/api-client.ts` (flow `web-shell`).

## Flow liên quan

- project-claims: duyệt/từ chối claim, tạo/sửa project, chuyển máy sở hữu.
- machine-pairing: tạo mã pairing, thu hồi máy, đặt máy trợ lý, đọc inventory skill/MCP.
- event-delivery: nguồn thông báo (`/v1/notices`) và làm mới trực tiếp qua SSE.
- web-shell: dùng chung `Breadcrumbs`, `StatusLozenge`, `ui/*`, `useStoredState`.

## Tests

- `apps/web/src/routes/inbox.test.tsx`: duyệt claim kèm TOTP (và mã sai), đếm badge, nhóm hiển thị đúng.
- `apps/web/src/components/pairing-dialog.test.tsx`: tạo mã, đếm ngược, lỗi TOTP.
- `apps/web/e2e/owner-admin.spec.ts`: phím tắt (kể cả "Tạo thêm"), quick search, kéo-thả bị từ chối, đổi ưu
  tiên hàng loạt, ghép máy bằng TOTP, duyệt chuyển máy từ máy B trong Inbox rồi chuyển project về từ trang Dự
  án, chế độ tối.
