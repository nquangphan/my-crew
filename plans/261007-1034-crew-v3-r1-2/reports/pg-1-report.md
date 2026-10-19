# Báo cáo gói plugin (bundle crew.core, kiểm health sau deploy)

- Ngày: 07/10/2026 (Asia/Ho_Chi_Minh). Worktree `.worktrees/paperclip-r12-plugin`, nhánh `crew/r12-plugin` từ `v3` (`e1c3dd2db`).
- SHA: `e02e83f0030548cf402cbe4170b81e6e38be951b`.

## File đổi
- Mới: `packages/crew-plugin/build.mjs` (esbuild, bundle `src/manifest.ts` và `src/worker.ts` thành ESM tự đủ).
- Sửa: `packages/crew-plugin/package.json` (`build` = `node build.mjs`), `crew/ops/{inspect-image,overlay-job,overlay-source,deploy,rollback}.sh`, `crew/release/verify.sh`, `server/src/__tests__/{crew-plugin-manifest,crew-run-cancelled}.test.ts`.
- `inspect-image.sh` kiểm các file `server/dist/crew/{core-hooks,remote-stop,load-gate,ssh-in-place,issue-policy,issue-gate,issue-create-policy,retry-progress}.js` (chỉ kiểm có mặt) và in `plugin bundle ok; manifest crew.core <capabilities>`.
- `deploy.sh`: thoát 4 khi `issues crewCoreHooks` là 0 hoặc 1; sau health server chờ tối đa 60 giây `/plugins/crew.core/health`, thoát 6 nếu không healthy, in `plugin crew.core healthy`. `rollback.sh` in trạng thái plugin.
- `overlay-source.sh`: `FORK` tính theo vị trí script, commit mặc định `HEAD`.

## Lệnh test
- `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-plugin-manifest.test.ts src/__tests__/crew-run-cancelled.test.ts`: lần đầu (chưa có build.mjs) FAIL đúng kỳ vọng; sau khi thêm: `Test Files 2 passed (2) / Tests 8 passed (8)`.
- `corepack pnpm --filter @crew/paperclip-plugin typecheck`: sạch (`tsc --noEmit`).
- `sh -n inspect-image.sh`, `bash -n deploy.sh rollback.sh overlay-job.sh overlay-source.sh verify.sh`: không lỗi.
- Kiểm tay: `dist/worker.js` (1,3 MB) không còn `@paperclipai`; import `dist/manifest.js` bằng node thường ra `crew.core`. `dist/` không nằm trong commit.
- Không chạy deploy, rollback, overlay, SSH.

## Giả định
- Cú pháp `./api.sh GET /plugins/crew.core/health` (không tiền tố `/api`, chạy trong `/opt/crew-v3-spike`) lấy từ lệnh đã dùng ở R1-1, không đọc `api.sh` trên VPS vì luật cấm SSH.
- Danh sách file crew mới theo Interface của plan; chưa kiểm được vì file của gói policy/runtime-retry chưa gộp.

## Lệch plan
- Bundle cần `dist` của `@paperclipai/plugin-sdk` (worktree mới chưa có, esbuild báo không resolve). Thêm `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` vào `overlay-source.sh` trước bước build plugin; `verify.sh` đã có bước này. Test bundle chỉ xanh khi SDK đã build (đã chạy `ensure-build-deps` trong worktree).
- `inspect-image.sh` dò import bằng `from ?["]@paperclipai/` thay vì `\x27` của plan, để portable. Chỉ một test trong `crew-run-cancelled.test.ts` có chữ `todo` và đã đổi tên.
- Chưa bỏ comment/step "chuẩn bị" nào khác; ruling đã ghi vào `sdd-ledger.md`.

## Sửa sau review
- SHA: `d9ff72dee722ae61e4b952b3e7ea0e4e0d945fd4` (commit mới trên `crew/r12-plugin`, không push).
- m1 đã sửa: `deploy.sh` (vòng chờ plugin) và `rollback.sh` gọi `crew/ops/plugin-state.sh`. Script này lấy thời điểm start của container server, đọc `/plugins/crew.core/health` và `/plugins/crew.core/dashboard`, rồi `plugin-state.py` chỉ in `healthy` khi health `healthy` và worker đang `running`, có pid, và uptime cho thấy worker khởi động sau container start (dung sai 5 giây). Trạng thái `ready` cũ trong DB không còn đủ; ca khác in lý do (`worker not running`, `stale worker …`, `no answer`).
- Test: `node --test crew/ops/plugin-state.test.mjs` — `tests 5 / pass 5 / fail 0`. Đã thêm vào `verify.sh`. `bash -n` đạt cho `deploy.sh rollback.sh plugin-state.sh verify.sh`. Parse `StartedAt` kiểm tay với chuỗi dạng Docker (`…123456789Z`).
- Không chạy deploy/rollback/SSH; `plugin-state.sh` chưa chạy được ngoài VPS (cần docker và `api.sh`), AC-2 chạy lần đầu ở D1.
- m2 (cú pháp `api.sh` chưa xác nhận), m3 (`inspect-image.sh` chưa dò `import(` động), m4 (test bundle cần SDK đã build): không sửa theo chỉ đạo, ghi nhận để xác nhận tại D1 hoặc khi chạy lẻ test.
