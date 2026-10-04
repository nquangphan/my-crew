# Báo cáo Task 7 S7basic và A7basic: onboarding owner trên web

**Kết quả: DONE.** BASE `589bfaf94936bb24c4b9ae0ae6a0a918d3ebca86`. Owner đăng ký máy, tạo dự án và gắn checkout hoàn toàn qua UI trên các API server đã nghiệm thu, không phụ thuộc G3/G4.

## Đã làm

- `v2/web/src/machines/onboarding.tsx` (trang `/machines`, mục “Máy” → “Đăng ký máy”) và `onboarding-state.ts` (luật tên, danh sách máy, `submitIntent`, thông báo lỗi tiếng Việt).
- `v2/web/src/projects/setup.tsx` (trang `/setup/projects`, mục “Tạo dự án/Gắn máy”) và `setup-state.ts` (luật mã, tên, URL repository, đường dẫn).
- `router.tsx`, `shell.tsx`: chỉ thêm hai route và hai link nav theo license hẹp của PM.
- Docs: flow mới `web-machines` (`flows.yaml`, `docs/flows/web-machines.md`), cập nhật `web-shell.md`, `index.md`/`files.md` sinh lại.

## Quyết định

- Token chỉ ở state component; xóa khi đóng, unmount, hết phiên/đăng xuất, `pagehide`. Không dùng `useMutation` nên không có mutation cache; response không vào query cache hay pending store.
- Mỗi hành động có intent cố định (`machine:create`, `project:create`, `project-bind:<id>`). Yêu cầu còn treo khóa các trường, hiện nút “Gửi lại đúng yêu cầu cũ” gửi đúng khóa và byte; tombstone dùng lại khóa với nội dung nhập lại.
- 409 giữ mọi trường đã nhập; `expectedRevision` luôn lấy từ Project vừa đọc, nên sau refetch bấm lại gửi revision mới bằng khóa mới. `ACTIVE_EXECUTION` chỉ giải thích, không gọi route dừng/hủy.
- Đường dẫn checkout chấp nhận dạng POSIX, ổ đĩa Windows và UNC ở client; server (`isAbsolute`) vẫn là nguồn quyết định cuối.
- Tên spec e2e là `onboarding.spec.ts` (tránh đụng `machines.spec.ts` của S7full).

## Kiểm chứng

- RED: `test/onboarding.test.ts` chạy trước khi có source, fail vì thiếu module (exit 1). GREEN: 11/11.
- Toàn bộ unit web `--test-concurrency=1`: 243/243. `tsc --noEmit` sạch. Biome sạch trên các file đã sửa.
- E2E thật (API/PostgreSQL/Vite fixture) `onboarding.spec.ts` + `app-router.spec.ts`: 5/5 hai lượt liên tiếp. Gồm hành trình đăng nhập UI → đăng ký máy → tạo dự án → gắn → tải lại giữ máy/đường dẫn/revision; không có token hay mật khẩu trong storage, console, DOM, body ghi; hai tab 409 thật (route chỉ làm chậm GET của tab thứ hai) rồi áp dụng lại bằng khóa mới; attempt `uncertain` và `active` chèn vào DB fixture làm rebind 409 `ACTIVE_EXECUTION` và binding DB không đổi.
- `crew-docs generate`, `check --all`, `check --staged` ok trên mirror tạm (đã xóa).
- Slot nặng giữ cho mọi lệnh Node/E2E và đã nhả; screenshot setup lưu ở scratch `$TMPDIR/crew-v2-web-s7basic/` (không commit, không có token).

## Hạn chế

- Một yêu cầu treo mà lần gửi lại cũng trả 4xx không-chứng-minh (ví dụ 409) vẫn giữ khóa theo luật của `api.ts`; không có nút bỏ khóa trong slice này.
- Token máy đã nhận mà phản hồi mất sau khi server commit: gửi lại cùng khóa cho server phát lại; sau khi token đã đóng thì không xem lại được (đúng một lần hiển thị).
- Chưa có online/telemetry máy, công tắc nguồn, model pool, cài workflow (S7full, chờ G3/G4).
