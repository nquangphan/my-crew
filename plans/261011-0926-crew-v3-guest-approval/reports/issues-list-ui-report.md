# Báo cáo: trang Yêu cầu theo giao diện danh sách gốc của Paperclip

- Worktree: `~/Documents/projects/crew/.worktrees/paperclip-issues-ui`, nhánh `crew/issues-list-ui`
- Commit: `6a7ca7659f00d4b2fe6c49914e822c2fd0f03f4c` feat(crew-web): trang Yêu cầu theo giao diện danh sách gốc của Paperclip (chưa push)
- Ảnh trước/sau: `issues-list-ui/` cùng thư mục báo cáo này (`before-*.png`, `after-*.png`)

## Kết quả

Trang Yêu cầu giờ dựng theo `IssuesList` bản streamlined (mặc định) của Paperclip, dùng design system của crew-web (không import `ui/`):

- Tiêu đề nhỏ "Yêu cầu" giống breadcrumb của Paperclip. Thanh công cụ một hàng gồm nút **Yêu cầu mới** (viền), ô tìm có kính lúp, và bên phải là chip **Chờ duyệt (n)** cùng bốn nút biểu tượng: **Cột**, **Lọc** (có số đếm), **Sắp xếp**, **Nhóm**.
- Dòng task không kẻ: mũi tên mở/thu con hoặc chỗ trống, glyph trạng thái, tiêu đề (cả dòng là link phủ). Bên phải là nhãn **Đang chạy** khi có run sống, cột Giai đoạn Crew, x/y con xong, người làm (avatar + tên), nhãn, mã yêu cầu và thời gian tương đối (tooltip là giờ Asia/Ho_Chi_Minh).
- Yêu cầu con có vạch cây theo cấp. Nhánh đang thu ghi "(n yêu cầu con)" sau tiêu đề cha.
- Nhóm có tiêu đề viết hoa và thu gọn được. Nhóm theo trạng thái đi theo thứ tự của Paperclip; project xếp theo tên, nhóm "không có project" ở cuối. Như Paperclip, danh sách được chia nhóm trước rồi mới dựng cây trong từng nhóm.
- Khi sắp theo ngày cập nhật hoặc ngày tạo, giữa các yêu cầu gốc có vạch **Hôm nay / Hôm qua / Trước đó**, tính theo lịch Asia/Ho_Chi_Minh.
- Popover Lọc có bốn mục: trạng thái (kèm glyph), người làm, dự án và loại. Mỗi mục chọn một giá trị, bấm lại để bỏ, nút **Xóa** bỏ hết bộ lọc nhưng giữ từ khóa tìm.
- Menu Cột có mô tả cho từng cột và nút **Đặt lại mặc định**.

Phần Crew vẫn giữ nguyên:

- Bấm dòng mở popup `?issue=`; Cmd/Ctrl+click mở trang đầy đủ.
- Viewer thuần không có nút ghi. Khách Phòng Marketing có **Yêu cầu mới**, nút này mở dialog góp ý.
- Nhóm **Chờ duyệt** đầu danh sách (nay thu gọn được, kiểu dòng như list) có Duyệt/Từ chối cho owner; chip `?pending=1` vẫn chạy như cũ.
- Các tham số URL vẫn giữ: `q`, `status`, `project`, `assignee`, `kind`, `sort`, `group`, `hide`, `new`, `pending`.
- Hook `use-issues.ts`, `tree.ts` và cơ chế cập nhật trực tiếp không đổi.

## File

| File | Thay đổi |
|---|---|
| `packages/crew-web/src/ds/widgets/issue-list.tsx` (mới) | Widget clone có ghi nguồn: `CollectionTitle`, `CollectionToolbar`, `ToolbarSearch`, `ToolbarIconButton`, `ToolbarChoiceMenu`, `ToolbarFilterMenu`, `ToolbarColumnsMenu`, `IssueGroup`, `DateSeparator`, `IssueListRow`, `TreeToggle`, `TreeSpacer`, `RowNote`, `RowCell`, `LiveBadge`, `LabelPill`, `ListItemRow` |
| `packages/crew-web/src/ds/index.ts` | Export widget mới |
| `packages/crew-web/src/features/issues/list/issues-page.tsx` | Dựng lại trang, chỉ dùng class bố cục |
| `packages/crew-web/src/features/issues/list/list-view.ts` (mới) | Logic thuần: gom nhóm, vạch ngày theo giờ VN, thời điểm hoạt động, id yêu cầu có run sống |
| `packages/crew-web/src/features/issues/list/use-issues.ts` | Thêm cột `labels`, `id`, `updated` và tham số `?show=`; cột Project ẩn sẵn như Paperclip; thứ tự trạng thái theo Paperclip; thêm query `live-runs` (khóa con của `liveRuns`) |
| `packages/crew-web/src/features/issues/locales/{vi,en}.json` | Thêm chuỗi mới cho cả hai ngôn ngữ, bỏ chuỗi không còn dùng |
| `packages/crew-web/src/features/guide/content/{huong-dan.vi,guide.en}.md` | Cập nhật đoạn mô tả trang Yêu cầu trong Hướng dẫn |
| `packages/crew-web/test/features/issues/issues-page.test.tsx` | Sửa theo tương tác mới, thêm ca nhóm/thu gọn, vạch ngày, Đang chạy, `?show=`, popup |
| `packages/crew-web/test/features/issues/list-view.test.ts` (mới) | Ca cho logic thuần và `columnPatch`/`isColumnVisible` |
| `packages/crew-web/e2e/specs/s4-issues.spec.ts` | PW-S4-2/3 đổi sang popover Lọc, menu Sắp xếp/Nhóm/Cột và ô `task-row-cell`; giữ nguyên tên ca nên `coverage.json` không đổi |

## Kiểm tra

- `corepack pnpm --filter @crew/paperclip-web test`: 136 file, 1157 ca qua (1 todo). Guard design system cũng qua.
- `corepack pnpm --filter @crew/paperclip-web typecheck`: sạch. Trước đó phải build `@paperclipai/plugin-sdk` và các gói nó phụ thuộc (gồm `packages/shared`).
- `biome check src test e2e`: sạch.
- `vite build` với `CREW_UI_COMMIT=6a7ca7659f00d4b2fe6c49914e822c2fd0f03f4c`, ra thư mục scratch: build thành công.
- E2E trên T1 cục bộ, chỉ chạy các spec liên quan:
  - `s4-issues.spec.ts` (4 ca) và `s6-issue-popup.spec.ts` (2 ca): 6/6 qua.
  - `s20-contributions.spec.ts` ca PW-S20-1..3 (phần chip và nhóm Chờ duyệt ở danh sách; S20 chạy nối tiếp nên phải có S20-1, S20-2): 3/3 qua.
  - Chạy thêm `s0-shell.spec.ts` vì trang đổi heading và có quét chuỗi khi ở EN: 5/5 qua.

## Ghi chú về stack T1

`~/crew-r3-t1` trỏ tới worktree `paperclip-r3-e2e` (nhánh cũ), còn `~/crew-ga-t1` trỏ tới `paperclip-ga-e2e`, worktree này đã bị xóa. Vì vậy em làm như sau:

- Chạy server bằng `env.sh` của `~/crew-ga-t1` với `FORK` là worktree này, sau khi build `@crew/paperclip-plugin`.
- Sửa `plugins.package_path` của `crew.core` trong DB nhúng (cổng 54329) sang `paperclip-issues-ui/packages/crew-plugin` và đặt `status = 'ready'`, rồi khởi động lại.
- Chạy e2e bằng `CREW_E2E_T1_ENV=~/crew-ga-t1/board.env`.

Đường dẫn plugin trong DB T1 hiện vẫn trỏ vào worktree này. Nếu worktree bị xóa thì phải trỏ lại như mục "Stack T1" trong `e2e/README.md`.

Log nằm ở `~/crew-ga-t1/logs/server-ilui*.log` và `web-ilui.log`. Server (kéo theo Postgres nhúng) và vite đã dừng bằng SIGTERM; các cổng 3199, 5183, 54329 đã trống. Script tạm dùng để sửa DB đã xóa và không được commit.

## Khác với Paperclip gốc (cố ý)

- Không có chế độ bảng Kanban, nút bật/tắt lồng cha-con, tùy chọn tắt vạch ngày hay chiều sắp xếp tăng/giảm. Các phần này cần thêm tham số URL mới hoặc là tính năng riêng, ngoài phạm vi yêu cầu.
- Không đổi trạng thái hay người làm ngay tại dòng, không có nút "+" tạo việc trong từng nhóm. BA Crew đã bỏ control sửa của Paperclip, và dialog Yêu cầu mới chưa nhận giá trị mặc định theo nhóm.
- Lọc chọn một giá trị cho mỗi mục (Paperclip cho chọn nhiều), để giữ đúng tham số URL mà app đang dùng.
- Cột mặc định: Giai đoạn Crew, x/y con xong, người làm, nhãn, mã, thời gian. Paperclip mặc định chỉ có trạng thái, mã, thời gian. Ở đây giữ thêm cột Crew và người làm theo yêu cầu; Project ẩn sẵn như Paperclip.
- Nhãn "Đang chạy" lấy từ `GET /companies/:id/live-runs`. Nếu vai trò không xem được run thì chỉ thiếu nhãn, danh sách vẫn hiện.

## Câu hỏi còn mở

- Có cần thêm chiều sắp xếp tăng/giảm và nút bật/tắt lồng cha-con như Paperclip không? Cả hai cần thêm tham số URL mới.

Status: DONE
Summary: Trang Yêu cầu đã dựng lại theo bố cục danh sách gốc của Paperclip và vẫn giữ đủ hành vi Crew; unit, typecheck, biome, vite build và các e2e liên quan trên T1 đều qua. Đã commit `6a7ca7659`, chưa push.
