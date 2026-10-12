# DP: deploy `crew/v3.5` @ `1d68bdaa2` (tab mở từ trước bản deploy mới tự tải lại một lần khi gặp `vite:preloadError`)

- Thời gian: 12/10/2026 10:42 → 10:48 (Asia/Ho_Chi_Minh). Người làm: agent.
- Kết quả: **DONE.** Prod chạy `crew-v3/paperclip:v3-1d68bdaa2`, plugin `healthy`. Chỉ đổi crew-web (`src/lib/stale-chunk-reload.ts` mới, `src/main.tsx`, test), không có code server, không có migration.
- Đây là bản cuối của chuỗi deploy hôm nay: `v3-2046adf2b` → `v3-6ef3b54b3` (`dp-report-6ef3b54b3.md`, gồm `52c2a738a`) → `v3-f33c11b72` (`dp-report-f33c11b72.md`) → `v3-1d68bdaa2`. Quy trình giống hệt `dp-report-2046adf2b.md`.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-f33c11b72` |
| Image sau | `crew-v3/paperclip:v3-1d68bdaa2` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261012-104259` (về `v3-f33c11b72`) |
| Lui xa hơn | `rollback.sh 20261012-103614` (về `v3-6ef3b54b3`), `rollback.sh 20261012-103005` (về `v3-2046adf2b`) |
| Backup DB | `20261012-1042`, 54M, builtin ok |
| Lưu ý rollback | Không có migration nên lui thẳng |

## Các bước

1. Worktree `paperclip-r3-dp` sạch, `git checkout --detach 1d68bdaa2`. `f33c11b72..1d68bdaa2` chỉ có 1 commit, 3 file trong `packages/crew-web`.
2. `overlay-source.sh 1d68bdaa2`: rc 0, `33 server files to transpile`. Bundle local: `crew-ui`=`1d68bdaa2fca…`, `assets/index-*.js` có `staleChunkReloadAt`.
3. `overlay-job.sh 1d68bdaa2`: `JOB_EXIT rc=0 min_avail=5224MiB`.
4. `inspect-image.sh crew-v3/paperclip:v3-1d68bdaa2` rc 0: `issues crewCoreHooks=3`, `crew-ui=1d68bdaa2fca2ab703e4d3f0f668450caeb7a924`, plugin UI gzip 109325, chỉ có `WARNING host adapter check SKIPPED` như mọi lần.
5. Manifest `crew.core` của `v3-f33c11b72` và `v3-1d68bdaa2` cùng sha256 `271b6337ab5b` → không thêm capability.
6. `active-runs.sh` rỗng lúc 10:42:45 và kiểm lại ngay trước deploy. `deploy.sh crew-v3/paperclip:v3-1d68bdaa2` lúc 10:42:49: rc 0, tự backup, `plugin crew.core healthy`, `deploy ok: … v3-f33c11b72 -> … v3-1d68bdaa2, rollback TS=20261012-104259`. Container khởi động 03:43:05 UTC (10:43:05 giờ VN).

## Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `ok`, commit `1d68bdaa2fca2ab703e4d3f0f668450caeb7a924` |
| `plugin-state.sh` | `healthy` (ngay sau deploy và lúc 10:48) |
| `/` và `/paperclip/` | 200 / 200 |
| `index-_2xInEAJ.js` đang phục vụ | 200, có `staleChunkReloadAt` |
| Tính năng của các commit trước vẫn còn | `issue-detail-CoJKiAgx.js`: `object-contain`, `flex flex-wrap gap-2`, `showMore`, `10lh`; `issues-page-nqZxltZf.js`: `object-contain`, `revokeObjectURL`, `flex flex-wrap gap-2` |
| Log server 5 phút (337 dòng, tới 10:48) | 0 dòng level 50/60, 0 dòng chứa `error` |
| Claim việc máy | 124 lần, tất cả 204 |
| `active-runs.sh` lúc 10:48 | rỗng |

## An toàn

- Không in secret. Không `rm -rf`, không push, không commit. Chỉ `rm -f` các file log tạm của em trong `/tmp` trên VPS.
- Không còn process nền nào em khởi tạo.
- Worktree `paperclip-r3-dp` đang detached `1d68bdaa2`, sạch.
- Image `v3-52c2a738a` đã build nhưng không deploy (đích đổi giữa chừng), vẫn nằm trên VPS.

## Concern

- Không có concern mới ở lần này. Lần deploy `f33c11b72` có 5 dòng 502 `No worker registered` trong 0,5 giây đầu khi khởi động (tab đang mở gọi vào trước khi worker plugin sẵn sàng); lần này không lặp lại.
- Concern cũ như `dp-report.md` vẫn còn.

Status: DONE
Summary: Prod chạy `v3-1d68bdaa2` (rollback `20261012-104259`), health ok với commit `1d68bdaa2`, plugin healthy, `/` và `/paperclip/` 200, `index-*.js` có `staleChunkReloadAt`, log 0 lỗi, claim 204.
Concerns/Blockers: không.
