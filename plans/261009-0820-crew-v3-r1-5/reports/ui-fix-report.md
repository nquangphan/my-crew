# Sửa 2 lỗi giao diện trang Crew (09/10/2026, 11:00–11:14 giờ Asia/Ho_Chi_Minh)

## Lỗi 1: tiêu đề "Docs" lặp
- Nguyên nhân (đọc mã + test đỏ trước khi sửa): `page.tsx` đã vẽ `<section aria-label><h2>` cho mỗi mục đăng ký; `DocsSection` tự bọc thêm `section[aria-label=Docs]` + `h2 "Docs"`. `MachinesSection` bọc thêm `section[aria-label=Máy]` (trùng nhãn, không trùng h2).
- Sửa: cả hai mục trả `div`, không tự vẽ tiêu đề. File: `packages/crew-plugin/src/ui/docs/index.ts`, `src/ui/machines/index.ts`.
- Test mới `src/ui/page-headings.test.ts`: dựng cả `CrewPage` (SDK host giả), đòi h2 = [Yêu cầu, Máy, Docs] và mỗi aria-label một lần. Đỏ trên code cũ (`Docs` xuất hiện 2 lần), xanh sau sửa.
- Commit fork `4dca97106` (trên `v3`, chưa push).

## Lỗi 2: "Lỗi: Tailscale" dù doctor trong Terminal đạt
- Bằng chứng: LaunchAgent `com.2p.crew-mac-status` có PATH mặc định `/usr/bin:/bin:/usr/sbin:/sbin` (`launchctl print`). Chạy `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin node ~/.crew/app/crew-mac/dist/cli.js doctor --no-probe` tái hiện đúng: `[LỖI] Tailscale: không lấy được IP`. Lý do: `tailscale` (/usr/local/bin) không có trên PATH đó; ứng viên thứ hai là file GUI `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, chạy không có `TAILSCALE_BE_CLI=1` thì in "The Tailscale GUI failed to start" và thoát mã 0, không in IP. Có `TAILSCALE_BE_CLI=1` thì in `100.102.189.67`.
- Sửa (crew-mac): `TAILSCALE_CANDIDATES` thêm `/usr/local/bin/tailscale`, `/opt/homebrew/bin/tailscale`; `tailscaleIpv4` đặt `TAILSCALE_BE_CLI=1`; `RunOptions.env` mới trong `system.ts`.
- Lỗi "gửi thất bại" xen kẽ: KHÔNG cùng gốc. Nguyên nhân chưa chứng minh được: thông báo cũ chung chung, không giờ, không nói bước nào; log server trước 10:39 đã mất do khởi động lại container khi deploy; các dòng nằm trong khoảng 10:11–10:32 lúc tải máy 10–11 (Keychain/dựng bản tin/kết nối đều có giới hạn 10 giây), nên nghi quá hạn do tải nhưng chỉ là giả thuyết. Đã sửa phần nhỏ: thông báo giờ ghi bước (Keychain quá hạn/mã, dựng bản tin, kết nối tới Paperclip kèm mã lỗi), không lộ message có thể chứa secret. Từ sau khi cài, `status.log` chưa có dòng thất bại mới; lần sau có thì biết bước nào.
- Test: `system-wrappers.test.ts` (2 ca Tailscale dưới PATH tối thiểu), `system.test.ts` (env), `status.test.ts` (Keychain quá hạn, bước kết nối). Docs: `docs/flows/mac-setup.md`.
- Commit repo Crew `35c5032` (nhánh `v3`, chưa push).
- Cài: `pnpm --filter @crew/mac build`, rồi rsync `dist/` `assets/` + `package.json` vào `~/.crew/app/crew-mac` (đường dẫn plist/launcher trỏ vào đây; `setup` không sao chép bundle), `.pkg-sha`=`35c5032`. Bản cũ giữ ở `~/.crew/app/crew-mac.bak-20261009`. Sau cài: doctor dưới `env -i` đạt Tailscale `100.102.189.67`; `crew-mac doctor` 0 LỖI; `status-last.json` ok HTTP 200.

## Test (theo tầng)
- Repo Crew: `pnpm --filter @crew/mac typecheck` sạch; `pnpm --filter @crew/mac test` 22 file / 305 test xanh; biome sạch (đã format lại 1 file).
- Fork: `corepack pnpm install --frozen-lockfile` (node_modules của package thiếu react), build plugin-sdk, `corepack pnpm --filter @crew/paperclip-plugin test` 17 file / 37 test xanh, `exec tsc --noEmit` sạch, build plugin sạch, bundle 0 `require("react`.

## Deploy
- `overlay-source.sh` -> `overlay-job.sh 4dca97106` (rc=0) -> `deploy.sh crew-v3/paperclip:v3-4dca97106`: backup 20261009-1110, 0 run active, plugin crew.core healthy, image `v3-c84154c5a` -> `v3-4dca97106`.
- Mốc rollback: `TS=20261009-111029` (`ops/rollback.sh 20261009-111029`).
- `/api/health`: ok, public, commit `4dca9710625b5c840b10e2f42c13e7ee65b53196`. `2p-solutions.com` 200, `kidyschool.com` 200.

## Trình duyệt (qua domain, đăng nhập bằng form, chỉ xem)
- Playwright MCP không đọc được file/ssh trong sandbox của nó, nên không nạp được mật khẩu mà không in ra; thay vào đó chạy script Playwright (chromium cài sẵn) từ Bash, mật khẩu đọc từ `.env` VPS vào biến, không in.
- `/TPS/crew`: h2 trong trang Crew = Yêu cầu, Máy, Docs (một "Docs"; Mục đích, Stack… là nội dung tài liệu); không có "Lỗi: Tailscale", không dòng Lỗi/Cảnh báo nào ở mục Máy; console 0 lỗi. Ảnh: `reports/ui-fix-shots/crew-page.png`.
- Ghi nhận ngoài phạm vi: DOM có hai `main` lồng nhau (host `#main-content` và trang Crew).

## Dọn
Không process nền còn lại; script kiểm tra ở thư mục tạm của phiên.
