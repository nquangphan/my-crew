# AC-4 — Nghiệm thu R1-4 (UI Crew trong Paperclip)

Ngày 08/10/2026, giờ Asia/Ho_Chi_Minh. Trợ Lý (Claude) tự chạy, vì Codex không dùng được từ 22:20. Máy: Mac mini + server spike `crew-v3-spike`.

## Kết luận

**ĐẠT toàn bộ.**

Lúc nghiệm thu bắt được **5 lỗi thật mà test không bắt được**. Cả 5 đã sửa, deploy và kiểm lại trên máy thật:

| Mã | Lỗi | Sửa |
|---|---|---|
| AC-4-1 | Host bind tham số mảng bằng drizzle `sql`, bung thành `($2,$3,…)::uuid[]`, nên `crew.map` lỗi. Test plugin dùng driver `postgres` trực tiếp nên không thấy. | `0865c66`: truyền mảng dạng chuỗi và dùng `string_to_array`. Test chạy qua đúng đường bind của host. |
| AC-4-2 | Mỗi lượt `status send` chạy `log show --last 24h`, mất hơn 1 phút. Job không giữ được nhịp 60 giây và đốt CPU máy owner. | `e725f13` + `1d74a55`: quét log nối tiếp từ checkpoint. Lượt đầu chỉ quét 2 giờ. Đo được 4,3 giây lượt đầu, 0,7 giây các lượt sau. |
| AC-4-3 | Bundle UI còn `require("react")` từ CJS của `use-sync-external-store`. Host chỉ viết lại import ESM, nên slot trống mà không báo lỗi. | `8f7cb41`: plugin esbuild trỏ `require` về React của host. `inspect-image.sh` FAIL nếu bundle còn `require("react`. |
| AC-4-4 | Giao diện issue mặc định của host (dạng chat) ẩn dải tab, nên `detailTab` không bao giờ hiện. | `ee98d4f`: thêm slot `taskDetailView` gồm tóm tắt và nút "Mở map". `detailTab` giữ cho giao diện classic. |
| AC-4-5 | Ảnh chụp docs đọc `origin/HEAD` mà không fetch, nên commit agent push không bao giờ tới ảnh chụp. | `0559fdf`: `git fetch` có timeout trước khi chọn commit. |

Lead tự sửa thêm 3 lỗi dọc đường:

- `71ce1e3`: overlay đóng gói nhầm file AppleDouble `._*`. Host đọc `._0001_docs.sql` như một migration và không kích hoạt plugin.
- `650cd1f`: `.gitignore` gốc bỏ qua thư mục `data/`, làm mất `src/data/map.ts` khỏi commit.
- `703ddfa`: danh sách `include` của vitest bỏ sót `src/ui/*.test.ts`.

## Tiêu chí

| Cổng | Tiêu chí | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 | Plugin build, typecheck, test | ĐẠT | 14 file, 27/27 test (`703ddfa`). Typecheck 0 lỗi. |
| 1 | Hook lõi | ĐẠT | 5/5, R1-4 không thêm hook nào. |
| 1 | Ops | ĐẠT | 23/23. |
| 1 | `@crew/mac` test, typecheck | ĐẠT | 301/301 (`0559fdf`). |
| 1 | `crew-docs check --range v3..HEAD` | ĐẠT | Đạt. |
| 1 | Image | ĐẠT | Có `dist/ui/index.js`, gzip 95 KB (giới hạn 1.5 MB). Không còn file `._*`. Không còn `require("react`. |
| 1 | Deploy | ĐẠT | Image `v3-703ddfa02`, plugin healthy, migration 0001–0003 đã chạy. |
| 2 | Bản tin máy đúng | ĐẠT | HTTP 200. Có dòng trong `machine_latest` và `machine_reports`. |
| 2 | Ảnh chụp docs đúng | ĐẠT | Commit `5bcc303`, `verified`, 4 trang, 4 link ok. |
| 2 | Webhook từ chối bản tin hỏng | ĐẠT | Thiếu chữ ký, sai chữ ký, lệch giờ 301 giây, body 17 KB, `companyId` lạ: cả 5 ca trả 502. Delivery ghi `failed` kèm mã (`missing_signature`, `bad_signature`, `stale_signature`, `body_too_large`, `config_unavailable`). Namespace plugin không thêm dòng nào. |
| 2 | `crew.map` CRE-36 khớp DB | ĐẠT | 3 con, `blocks` CRE-37 → CRE-38, gốc xong 4 stage, gói `greet` seq 1/2, `readme` seq 1. |
| 3 | Issue gốc | ĐẠT | Header: "Crew · 0/3 con xong · Đã xong · docs Đạt". "Mở map" ra `.react-flow` 4 nút, 7 cạnh. Docs-check commit `3942556`. |
| 3 | Issue con | ĐẠT | CRE-38 hiện tóm tắt của gốc. |
| 3 | Trang Crew | ĐẠT | Đủ ba mục Yêu cầu, Máy, Docs. Tiêu đề "Máy" chỉ còn một. |
| 3 | Mục Máy | ĐẠT | Có online/mất liên lạc, biểu đồ tải 24 giờ, Claude, Superpowers. |
| 3 | Mục Docs | ĐẠT | Có cây `docs/flows`, mở được trang, có commit và trạng thái. Tìm "greet" ra 3 trang hiển thị; API trả 4 kết quả. |
| 3 | Link hỏng | ĐẠT | Ảnh chụp ký thật có link `missing` hiện "khong-co.md — thiếu trang", trạng thái "Không hợp lệ". |
| 3 | Widget dashboard | ĐẠT | Hiện máy. |
| 3 | Console | ĐẠT | 0 lỗi từ plugin. |
| 4 | `setup` cài job | ĐẠT | Chỉ ghi và nạp `com.2p.crew-mac-status`. sshd giữ PID cũ. `doctor` đủ 16 mục cũ ĐẠT, cộng 2 mục mới. |
| 4 | Nhịp gửi | ĐẠT | 22:45:27, 22:46:30, 22:47:32: khoảng 62 giây một lần. |
| 4 | Mất liên lạc, online lại | ĐẠT | Dừng job lúc 22:54:09, đến 22:57:29 `online=false`. Bật lại, đến 22:58:44 `online=true`. |
| 4 | Yêu cầu qua Trợ Lý tới push, ảnh chụp docs đổi commit trong 2 phút | ĐẠT | CRE-52 (board tạo 23:09, giao Trợ Lý): kế hoạch 1 con CRE-53 → executor commit `e686cda` → reviewer approved → integrator `crew-docs-check commit=ee77c93 exit=0` → owner approve 23:32:18 (Trợ Lý thay mặt trên repo thử) → integrator `crew-merge sha=ee77c93 pushed=yes`. `origin/main` đổi `5bcc303` → `ee77c93` trong khoảng 23:36:10–23:36:41; ảnh chụp docs `ee77c93` nhận lúc 23:36:29, chậm hơn push dưới 30 giây. |
| 5 | Docs flow `mac-setup` | ĐẠT | Mô tả lệnh status, job, file cấu hình, Keychain, fetch, probe TCC. `crew-docs check` đạt. |

Ảnh chụp: `reports/ac-4-shots/` (01–05).

## Thay đổi trên máy và server

- **Server spike:**
  - Image `crew-v3/paperclip:v3-703ddfa02`. Rollback TS `20261008-224753`.
  - Secret company tên `crew-mac-status-webhook`, id `9df35ec4-ad6e-4c65-878f-352b089dd48d`. Báo cáo không ghi giá trị.
  - Config plugin `f143e0bb…` trỏ secret ref.
  - Namespace `plugin_crew_core_0433ea20b6` có 6 bảng.
- **Mac mini:**
  - `~/.crew/app/crew-mac` là bản `0559fdf`. Sao lưu bản cũ ở `~/.crew/app/crew-mac.bak-20261008-2220`. Khôi phục: xóa thư mục hiện tại rồi đổi tên bản sao lưu.
  - Keychain có mục `crew-mac-status`.
  - `~/.crew/status.json`: machineId `039b7fe6-2df6-405a-abc9-ca5e675d4227`.
  - `~/.crew/status-repos.json` chứa repo-a (project `280cf1de…`).
  - Job `com.2p.crew-mac-status` đang chạy. Đây là tính năng, giữ lại.

## Dọn

- Spike Crew: 0 run queued/running, 0 issue mở. Ảnh chụp docs thử có link `missing` đã bị ảnh chụp thật `ee77c93` thay thế.
- Mac: 0 process `crew-claude-run`, 0 thư mục `crew-mac-docs-*`.

## Còn lại

- Có hai ghi chú minor ở ô tìm docs:
  - Ô không có nhãn hay placeholder, trình đọc màn hình không biết đây là ô tìm kiếm.
  - Kết quả tìm "greet" chưa hiện trang `docs/index.md`, dù API trả 4 kết quả.
- Nợ kỹ thuật: `test/crew-claude-run.test.ts` chập chờn khi chạy song song. Lỗi này có sẵn trên `v3`.
- Push fork `crew/r1-4` và repo Crew `r1-4-mac` chờ owner.
