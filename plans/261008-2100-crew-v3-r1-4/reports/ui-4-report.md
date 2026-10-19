# UI-4 — trạng thái máy

Status: DONE

## Đã triển khai

- Migration `0002_machines.sql` tạo `machine_reports` trong namespace `plugin_crew_core_0433ea20b6`, có chỉ mục theo máy/thời gian. Handler xóa bản tin quá 24 giờ khi ghi, vì manifest stock không có job cron.
- Webhook `machine-status` dùng `authenticateCrewWebhook` với giới hạn 16 KB, kiểm schema v1 theo allowlist, từ chối trường lạ cấp 1 và `detail`/`hint` trong checks, rồi ghi bản tin.
- Data handler `crew.machines` trả trạng thái online ở biên 180 giây, bản tin mới nhất và tối đa khoảng 288 điểm tải trong 24 giờ. Không có trường `lastLoadGate` theo hợp đồng đã cập nhật.
- `MachinesSection` và `MachinesWidget` hiển thị trạng thái, tải, RAM, TCC, Claude, Superpowers, checks và biểu đồ SVG; tự làm mới mỗi 30 giây. Manifest có slot dashboardWidget và capability tương ứng.

## TDD và xác minh

- Đỏ: test mới được viết trước; lượt chạy đầu không chạy được vì thiếu `node_modules` (`vitest: command not found`). Đã chạy `corepack pnpm install --frozen-lockfile` đúng một lần. Lượt chạy sau đỏ do timeout 5 giây khi khởi động embedded PostgreSQL; tăng timeout riêng test lên 90 giây.
- Xanh: test embedded PostgreSQL cho bản tin đúng, chữ ký sai/thiếu, timestamp cũ, body 17 KB, company lạ, `machineId` sai định dạng, trường lạ và `detail`; các trường hợp từ chối không ghi DB. Kiểm online đúng tại 180 giây và offline tại 180001 ms, cùng cửa sổ tải 24 giờ; xác nhận không trả `lastLoadGate`.
- `corepack pnpm --filter @crew/paperclip-plugin typecheck`: đạt (sau khi build dependency SDK mới cài).
- `corepack pnpm --filter @crew/paperclip-plugin test`: 12/12 đạt.
- `corepack pnpm --filter @crew/paperclip-plugin build`: đạt.
- `node crew/release/check-core-hooks.mjs`: 5/5, lỗi 0.
- `git diff --check`: đạt. Trước test, `ipcs -m` có 5 segment; không cần gỡ.
- Commit `e71229c1d` — `feat(plugin): add Crew machine status views`. Không push.
- Sau commit, `git status --ignored --short packages/crew-plugin` chỉ có `dist/` và `node_modules/` bị ignore; không có file nguồn bị ignore. Working tree sạch.

## Quyết định hợp đồng

Lead đã chốt: HMAC với secret company xác thực người gửi; `machineId` chỉ cần UUID hợp lệ, không allowlist. Handler và test theo đúng quyết định này.

`activity_log` không thuộc core read allowlist của SDK, nên hợp đồng đã bỏ `lastLoadGate`; code và test đã bỏ trường này. Không sửa lõi.
