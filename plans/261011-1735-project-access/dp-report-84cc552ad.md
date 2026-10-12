# DP: deploy `crew/v3.5` @ `84cc552ad` (Trợ Lý thêm mục tổng kết vào mô tả gốc trước khi gửi duyệt)

- Thời gian: 12/10/2026 10:53 → 10:59 (Asia/Ho_Chi_Minh). Người làm: agent.
- Kết quả: **DONE.** Prod chạy `crew-v3/paperclip:v3-84cc552ad`, plugin `healthy`. Chỉ đổi template agent `crew/agents/assistant.md` (crew-web bundle nhúng vào), `instructions.test.mjs` và 3 fixture rendered. Không có code server, không có migration.
- Bản trước: `v3-1d68bdaa2` (`dp-report-1d68bdaa2.md`). Quy trình giống hệt.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-1d68bdaa2` |
| Image sau | `crew-v3/paperclip:v3-84cc552ad` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261012-105444` (về `v3-1d68bdaa2`) |
| Lui xa hơn | `rollback.sh 20261012-104259` (về `v3-f33c11b72`), `rollback.sh 20261012-103614` (về `v3-6ef3b54b3`) |
| Backup DB | `20261012-1054`, 54M, builtin ok |
| Lưu ý rollback | Không có migration nên lui thẳng |

## Các bước

1. `active-runs.sh` lúc 10:53:40: rỗng. Server đang chạy `v3-1d68bdaa2`.
2. Worktree `paperclip-r3-dp` sạch, `git checkout --detach 84cc552ad`. `1d68bdaa2..84cc552ad` chỉ 5 file: `crew/agents/assistant.md`, `crew/agents/instructions.test.mjs`, 3 fixture `__fixtures__/rendered/assistant*.md`.
3. `overlay-source.sh 84cc552ad`: rc 0, `33 server files to transpile`. Bundle local: `crew-ui`=`84cc552ad337…`, `assets/resume-DyJOiteq.js` chứa `Tổng kết của Trợ Lý` (UTF-8 thô, không escape).
4. `overlay-job.sh 84cc552ad`: `JOB_EXIT rc=0 min_avail=5130MiB tag=crew-v3/paperclip:v3-84cc552ad`.
5. `inspect-image.sh crew-v3/paperclip:v3-84cc552ad` rc 0: `issues crewCoreHooks=3`, mọi `crew/*.js ok`, `crew-ui=84cc552ad3378ba9f2c8b69912c8b5caf95289cd`, plugin UI gzip 109325, adapter P2–P7 ok, không MISSING/FAIL; chỉ có `WARNING host adapter check SKIPPED` như mọi lần.
6. Manifest `crew.core` của `v3-1d68bdaa2` và `v3-84cc552ad` cùng sha256 `271b6337ab5b` (cùng số với báo cáo trước) → không thêm capability.
7. `active-runs.sh` kiểm lại rỗng lúc 10:54:32, chạy ngay `deploy.sh crew-v3/paperclip:v3-84cc552ad` trong cùng lệnh: rc 0, tự backup, `plugin crew.core healthy`, `deploy ok: crew-v3/paperclip:v3-1d68bdaa2 -> crew-v3/paperclip:v3-84cc552ad, rollback TS=20261012-105444`. Container khởi động 03:54:51 UTC (10:54:51 giờ VN).

## Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` (crew.2p-solutions.com) | `ok`, commit `84cc552ad3378ba9f2c8b69912c8b5caf95289cd` |
| `plugin-state.sh` | `healthy` (ngay sau deploy và lúc 10:59) |
| `/` và `/paperclip/` | 200 / 200 |
| `index.html` đang phục vụ | `crew-ui` = `84cc552ad337…`, entry `assets/index-CgpH66JK.js` |
| `assets/resume-DyJOiteq.js` đang phục vụ | 200, có `Tổng kết của Trợ Lý` |
| Log server từ khởi động tới 10:59 (355 dòng) | 0 dòng level 50/60, 0 dòng chứa `error` |
| Claim việc máy (`/api/plugins/crew.core/api/machine-jobs/claim`) | 117 lần, tất cả 204 |
| `active-runs.sh` lúc 10:59 | rỗng |

## An toàn

- Không in secret. Không `rm -rf`, không push, không commit. Chỉ `rm -f` các file log tạm của em trong `/tmp` trên VPS.
- Không còn process nền nào em khởi tạo.
- Worktree `paperclip-r3-dp` đang detached `84cc552ad`, sạch.

## Concern

- Không có concern mới. Lần đầu em băm manifest bằng mẫu grep sai (ra hash rỗng `e3b0c44298fc` cho cả hai image); đã băm lại đúng dòng `manifest crew.core …` trước khi deploy.
- Concern cũ như `dp-report.md` vẫn còn.

Status: DONE
Summary: Prod chạy `v3-84cc552ad` (rollback `20261012-105444`), health ok với commit `84cc552ad`, plugin healthy, `/` và `/paperclip/` 200, bundle phục vụ có `Tổng kết của Trợ Lý`, log 0 lỗi, claim 204.
Concerns/Blockers: không.
