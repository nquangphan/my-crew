# Báo cáo: cửa sổ app Mac tự hiện lại

Worktree `crew-pair`, nhánh `r25-pair`. Commit: xem `git log -1` (fix(mac-app): ghi nguồn mở cửa sổ...).

## Đã làm
1. Module mới `apps/mac-app/src/main/window-controller.ts` (`createWindowController`, `sendIfAlive`). Mọi lần mở
   cửa sổ ghi info `window-show {trigger, recreate}`, trigger là `tray | second-instance | activate | startup`;
   `activate` ghi thêm `window-activate {hasVisibleWindows}`.
2. Hết lỗi tham chiếu cũ: controller đặt `window = null` ở sự kiện `closed`. `store.onChange` gửi qua `windows.send`,
   `jobs/register.ts` `onStatus` gửi qua `sendIfAlive` (kiểm `win.isDestroyed()` và `webContents.isDestroyed()`).
3. Chống mở lại ngoài ý muốn: ẩn biểu tượng Dock khi không có cửa sổ (đóng cửa sổ, hoặc khởi động từ login item), hiện
   lại khi mở cửa sổ. `activate` vẫn mở cửa sổ.
4. Test `apps/mac-app/test/window-controller.test.ts` (9 ca), cập nhật `docs/flows.yaml`, `docs/flows/mac-app.md`,
   `docs/files.md` (generate). `crew-docs check --staged` ok.

## Kiểm
vitest mac-app 627 pass; `node --test scripts/*.test.mjs` 24 pass; `tsc --noEmit` sạch; `pnpm lint` sạch.

## Lý do chọn cách ở mục 3 (và giới hạn)
- Em đã tra: macOS không có cách nào phân biệt `activate` do người dùng và do hệ thống. Electron chỉ đưa
  `hasVisibleWindows`, mà khi cửa sổ đã đóng thì nó luôn là false cho mọi nguồn. Em chưa xác minh được giả thuyết
  "hộp thoại Keychain/TCC kích hoạt `activate`" từ docs: theo nhớ của em `activate` ánh xạ từ
  `applicationShouldHandleReopen` (mở lại từ Dock, Finder, Spotlight, `open -a`), không phải từ mọi lần app thành
  frontmost. Giả thuyết này nên để log chứng minh, đừng coi là đã chốt.
- Bỏ qua `activate` hoàn toàn bị loại: khi app đang chạy, mở lại từ Finder/Spotlight CHỈ phát `activate` (không có
  `second-instance`, cái đó chỉ cho dòng lệnh), nên sẽ hỏng đường mở mà Đại Ca yêu cầu giữ.
- Ẩn hẳn Dock vĩnh viễn (`LSUIElement`) bị loại: đổi hành vi app (mất Cmd-Tab, menu) và Dock đang là điểm vào đã
  ghi trong docs. Ẩn Dock chỉ lúc không có cửa sổ thì đúng với app tray, bỏ được click Dock nhầm, vẫn giữ tray,
  Finder/Spotlight và chạy lại app.
- Hạn chế: nếu nguồn thật là một `open -a`/thông báo/updater gửi reopen thì cách này chưa chặn được. Bản log mới sẽ
  cho thấy: tìm `window-activate` với `hasVisibleWindows:false` kèm giờ, đối chiếu sự kiện khác trong `app.log` cùng
  thời điểm. Khi có bằng chứng thì chặn đúng nguồn đó.
- Chưa kiểm hành vi Dock thực trên máy (không build/cài theo yêu cầu): `app.dock.hide()` và `show()` chỉ test bằng
  giả lập. Cần Đại Ca thử tay một lần: đóng cửa sổ, Dock mất icon, mở từ tray thì icon lại hiện.

## Câu hỏi còn mở
- Lúc Dock bị ẩn, cửa sổ vẫn hiện được nhờ `app.dock.show()` trước khi tạo; cần xác nhận trên máy thật không bị
  chậm/nháy.
