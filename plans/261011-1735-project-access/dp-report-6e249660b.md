# DP: deploy `crew/v3.5` @ `6e249660b` (trang Docs ba cột, menu ☰ trên màn hẹp)

- Thời gian: 12/10/2026 14:00 → 14:50 (Asia/Ho_Chi_Minh). Người làm: agent. Phần lớn thời gian là chờ run đang chạy (14:01 → 14:38).
- Kết quả: **DONE_WITH_CONCERNS** (concern nhỏ ở phía Mac mini, xem cuối). Prod chạy `crew-v3/paperclip:v3-6e249660b`, plugin `healthy`. Chỉ đổi UI crew-web: `e52fd0ecf` (trang Docs ba cột có cây thư mục và mục lục) và `6e249660b` (thu sidebar vào nút ☰ trên màn hẹp). Không đổi code server, không migration, không đổi dependency.
- Bản trước: `v3-539ee5fe5` (`dp-report-539ee5fe5.md`). Quy trình giống hệt.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-539ee5fe5` |
| Image sau | `crew-v3/paperclip:v3-6e249660b` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261012-143905` (về `v3-539ee5fe5`) |
| Lui xa hơn | `rollback.sh 20261012-111232` (về `v3-84cc552ad`), `rollback.sh 20261012-105444` (về `v3-1d68bdaa2`) |
| Backup DB | `20261012-1438`, 67M, builtin ok |
| Lưu ý rollback | Không có migration nên lui thẳng |

## Các bước

1. Worktree `paperclip-r3-dp` sạch, `git fetch origin crew/v3.5` (= `6e249660b5a6…`, khớp nhánh local), `git checkout --detach 6e249660b`. `539ee5fe5..6e249660b`: 30 file, toàn bộ trong `packages/crew-web/` (không đổi `package.json`/`pnpm-lock.yaml` nên không cần `pnpm install`).
2. Cổng kiểm crew-web: `pnpm test` 143 file, 1280 pass, 1 todo; `typecheck` rc 0; `biome check src test e2e` rc 0 (532 file, sạch). Không chạy e2e (đã chạy ở local trước đó).
3. `active-runs.sh` lúc 14:01: có 1 run `running` của 2P Solutions. Vẫn build image trong lúc chờ (không động tới server).
4. `overlay-source.sh 6e249660b`: rc 0, `33 server files to transpile`. Bundle local: `crew-ui`=`6e249660b5a648b0b0ea0791131dd90da1574025`; `Trên trang này` ở `assets/stage-badge-N-LUaGLt.js` và `assets/guide-page-Dz6Vf_mv.js`, `Mở menu` ở `assets/stage-badge-N-LUaGLt.js`. Worktree vẫn sạch sau build.
5. `overlay-job.sh 6e249660b`: `JOB_EXIT rc=0 min_avail=5062MiB tag=crew-v3/paperclip:v3-6e249660b`.
6. `inspect-image.sh crew-v3/paperclip:v3-6e249660b` rc 0: `issues crewCoreHooks=3`, 15/15 `crew/*.js ok`, `crew-ui=6e249660b5a648b0b0ea0791131dd90da1574025`, plugin UI gzip 109325, adapter P2–P7 ok, không MISSING/FAIL; chỉ có `WARNING host adapter check SKIPPED` như mọi lần.
7. Manifest `crew.core` (băm phần `manifest crew.core …` của output inspect) của `v3-539ee5fe5` và `v3-6e249660b` cùng `24b39e967f2a` (cùng số báo cáo trước) → không thêm capability.
8. Chờ hết run: run nối tiếp nhau (một run mới bắt đầu 14:08, một run khác 14:26). Lần thử 14:36:18 vẫn có run nên không deploy. Sau đó em chạy vòng lặp trên VPS: cứ 2 giây gọi `active-runs.sh`, rỗng thì gọi ngay `deploy.sh` (bản thân `deploy.sh` cũng tự từ chối nếu có run, rc 2). Rỗng lúc 14:38:50, `deploy.sh crew-v3/paperclip:v3-6e249660b`: rc 0, tự backup, `plugin crew.core healthy`, `deploy ok: crew-v3/paperclip:v3-539ee5fe5 -> crew-v3/paperclip:v3-6e249660b, rollback TS=20261012-143905`. Container khởi động 07:39:12 UTC (14:39:12 giờ VN).

## Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` (crew.2p-solutions.com) | `ok`, commit `6e249660b5a648b0b0ea0791131dd90da1574025` |
| `plugin-state.sh` | `healthy` (14:39 và 14:49) |
| `/` và `/paperclip/` | 200 / 200 |
| `index.html` đang phục vụ | `crew-ui` = `6e249660b5a6…`, entry `assets/index-BZdnB9PI.js` |
| Bundle UI mới đang phục vụ | `assets/stage-badge-N-LUaGLt.js` 200, có `Trên trang này` và `Mở menu`; `assets/guide-page-Dz6Vf_mv.js` 200, có `Trên trang này` |
| Log server 14:39 → 14:49 (432 dòng) | 0 dòng level 40/50/60, 0 dòng chứa `error` |
| Claim việc máy (`/api/plugins/crew.core/api/machine-jobs/claim`) | 115 lần, tất cả 204; không có 503 lúc khởi động lần này |
| Mac mini `~/.crew/bin/crew-mac status send` (14:40) | `status-last.json` `at` 2026-10-12T07:40:04Z, `ok: true`, HTTP 200, cả hai target 200. CLI rc 1 vì lỗi gửi ảnh chụp docs (xem concern) |
| `active-runs.sh` lúc 14:49 | rỗng |

## An toàn

- Không in secret (lọc `authorization`/`cookie` khi đọc log). Không `rm -rf`, không push, không commit trong fork, không DELETE environment. Không chạy Playwright/e2e.
- Không còn process nền nào em khởi tạo (các vòng chờ đã thoát).
- Worktree `paperclip-r3-dp` đang detached `6e249660b`, sạch.

## Concern

- `crew-mac status send` báo "không gửi được ảnh chụp docs" cho **hai** id: `c31226f9…` (lỗi cũ đã biết) và thêm `90c19d56-5c3f-4e80-930b-6e36e4fe6989` (chưa thấy trong các báo cáo trước). Không có request docs nào tới server trong khung giờ đó và lần deploy này không đổi code server, nên lỗi nằm ở phía Mac mini (giống lỗi cũ), không do bản deploy. Status chính vẫn gửi 200. Nên xem riêng vì sao thêm một id mới bị lỗi.
- Run ở 2P Solutions chạy nối tiếp gần như liên tục nên phải chờ ~37 phút mới có khe trống để deploy.
- Concern cũ như `dp-report.md` vẫn còn.

Status: DONE_WITH_CONCERNS
Summary: Prod chạy `v3-6e249660b` (rollback `20261012-143905`), health ok với commit `6e249660b`, plugin healthy, `/` và `/paperclip/` 200, bundle phục vụ có `Trên trang này` và `Mở menu`, log 0 lỗi, claim 115/115 là 204.
Concerns/Blockers: Mac mini lỗi gửi ảnh chụp docs thêm một id mới `90c19d56…` (phía Mac, không do deploy).
