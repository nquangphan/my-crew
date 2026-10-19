# FX-3: ba lỗi nhỏ DP-1 tìm thấy

Worktree `.worktrees/paperclip-ga-fx3`, nhánh `crew/ga-fx3`, dựa trên `33d7e2242`. Chưa push, chưa deploy, không chạy Playwright.

## Commit

| Commit | Nội dung |
|---|---|
| `d2ab20eab` | Guard ghi prod (`assertWriteAllowed`, nay `export`) cho phép `/api/crew/companies/<E2E>/` chỉ với id Crew E2E. Thứ tự kiểm giữ nguyên: chặn `..`, chặn TPS trong đường và body, rồi mới tới allowlist, nên độ chặt như đường `/api/companies/<E2E>/`. Thêm 14 ca vào `test/e2e-support.test.ts` (cho phép, từ chối TPS, company khác, tiền tố `E2Ex`, `..` và `%2e%2e`, body nhắc TPS, ngoài prod không chặn) |
| `6c8e5a8be` | `/machines`: công tắc runtime bị khóa có `title` nêu lý do (checker `no-dead-controls` đọc title hoặc aria-describedby). Lý do lấy từ `locked` của server và, với OpenCode, "Chưa nạp key OpenCode trên máy." chỉ khi bản tin máy báo `keyPresent === false`. Thiếu trạng thái công tắc thì nêu "Chưa tải được trạng thái công tắc". Thêm khóa vi và en, 2 test trong `runtime-block.test.tsx` |
| `286820b18` | `crew/ops/inspect-image.sh` kiểm thêm `contributions`, `contribution-routes`, `plugin-data-scope` trong `/app/server/dist/crew/`. Manifest `crew/release/core-hooks.json` đã có sẵn các mục C7 và C8 cho cả 3 file nên không cần sửa |

## Kết quả kiểm

- `pnpm --filter @crew/paperclip-web test`: 135 file, 1140 pass, 1 todo.
- `typecheck`: sạch. Cần `dist` của `packages/shared` (build trong worktree, đã gitignore) vì worktree mới chưa có.
- `lint` (biome): 505 file sạch.
- `node --test crew/ops/*.test.mjs`: 75/75.

## Lưu ý

- Lý do khóa OpenCode trên prod: code hiện chỉ khóa công tắc khi server báo `locked` (hoặc chưa có trạng thái). Em không đổi điều kiện khóa, chỉ nối lý do vào title. Dòng "chưa nạp key" chỉ hiện kèm khi công tắc thật sự đang khóa. Nếu prod không có `locked` mà vẫn khóa, T2 sẽ cho biết; nguyên nhân khi đó nằm ở `!state`, đã có lý do riêng.
- `inspect-image.sh` chỉ in `MISSING`, không fail, giống các file crew khác. Em không có test riêng cho dòng này vì test hiện có dùng docker giả.

Status: DONE
Summary: Ba commit trên `crew/ga-fx3` (chưa push). Guard e2e nhận router góp ý của Crew E2E, công tắc runtime khóa có lý do, `inspect-image.sh` kiểm 3 file mới. Test, typecheck, lint và ops (75/75) đều xanh.
