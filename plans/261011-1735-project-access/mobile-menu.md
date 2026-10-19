# Menu ☰ trên điện thoại (crew-web)

- Commit: `6e249660b` trên `crew/project-access` (chưa push, chưa deploy).
- Kết quả: **DONE_WITH_CONCERNS** (concern: PW-S0-3 đỏ sẵn vì dữ liệu T1, xem cuối).

## Đã làm

- `src/ds/components/app-frame.tsx`: dưới `md` (768px) ẩn sidebar cố định, hiện thanh trên (nút ☰ "Mở menu"/"Open
  menu", logo, tên company). Bấm ☰ mở chính nội dung sidebar thành ngăn kéo trái bằng `Sheet` sẵn có (role dialog,
  tiêu đề ẩn "Menu điều hướng", nền mờ). Đóng bằng nền mờ, Escape, nút Đóng, khi cửa sổ rộng qua `md`; focus trả về
  ☰. Từ `md` trở lên giữ nguyên (ảnh desktop trước/sau giống nhau từng pixel).
- `src/app/shell/mobile-menu.ts` (mới) + `shell.tsx`: đóng ngăn kéo khi đổi route (theo `location.key`, nên bấm lại
  trang đang mở cũng đóng) và khi bấm Tìm nhanh.
- `src/ds/widgets/issue-detail.tsx`: ở 390px nút Copy mã/Copy link đè lên mã yêu cầu; nay xuống dòng khi breadcrumb
  hẹp hơn 10rem (desktop không đổi).
- Khóa locale `nav.openMenu`, `nav.menu` (vi, en). Ghi chú trong `src/ds/README.md`.

## Kiểm

- Vitest `test/app/mobile-menu.test.tsx` (9 ca: mở, Escape + focus, nút Đóng, nền mờ, link, bấm lại trang hiện tại,
  rộng qua md, class ẩn/hiện, tự giữ trạng thái). Cả gói: 1280 đạt.
- `typecheck`, `biome check src test e2e`, `vite build` (`CREW_UI_COMMIT=e52fd0ecf…`, ra thư mục scratch): đạt.
- E2E T1 (`~/crew-ga-t1`, server từ worktree này): ca mới `PW-S0-7` (390px: ☰, Escape, link Docs đóng ngăn kéo,
  không cuộn ngang ở Docs, Yêu cầu, chi tiết yêu cầu) đạt; PW-S0-1, 2, 4, 5 đạt.
- Ảnh: `mobile-menu-phone-closed.png`, `mobile-menu-phone-open.png` (390×844), `mobile-menu-desktop.png` (1440×900).
  Không ảnh hướng dẫn nào phải chụp lại.
- Đã dừng vite (5183) và server T1 (3199) bằng SIGTERM; cổng 3199, 5183, 54329 trống.

## Concern

- `PW-S0-3` đỏ ở T1: bản EN còn chữ "Nguyễn Quang" — đó là tên tài khoản ở chân sidebar (dữ liệu, `AccountMenu` không
  đổi), ca chưa loại tên tài khoản khi quét. Không do thay đổi này; chưa sửa.
