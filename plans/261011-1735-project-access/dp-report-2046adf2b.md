# DP: deploy `crew/v3.5` @ `2046adf2b` (đính kèm file không gửi yêu cầu, dán ảnh vào mô tả yêu cầu mới)

- Thời gian: 12/10/2026 09:27 → 10:22 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent.
- Kết quả: **DONE.** Prod chạy `crew-v3/paperclip:v3-2046adf2b`, plugin `healthy`. Thay đổi chỉ ở crew-web, không có code server, không có migration.
- Quy trình giống hệt `dp-report.md` (deploy `e400b719d`).

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-e400b719d` |
| Image sau | `crew-v3/paperclip:v3-2046adf2b` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261012-101646` (về `v3-e400b719d`) |
| Backup DB | `20261012-1016` do `deploy.sh` tự tạo, 52M, builtin ok |
| Lưu ý rollback | Không có migration nên lui thẳng, không để lại gì |

## 1. Worktree

- `~/Documents/projects/crew/.worktrees/paperclip-r3-dp` trước đó detached `e400b719d` và sạch (không có việc dở). Em chạy `git checkout --detach 2046adf2b`, vẫn sạch.
- Diff `e400b719d..2046adf2b`: 6 file, tất cả trong `packages/crew-web` (thêm `0d5c84bac`, chỉ format spec e2e `guide-shots.spec.ts`, file đó không vào image).
- Không chạy lại test/biome/tsc (đã chạy local rồi theo giao việc). Không chạy Playwright/E2E.

## 2. Deploy

1. `active-runs.sh` lúc 09:27: **có 1 run `running`** (2P Solutions). Em vẫn build (build không restart server) nhưng chờ tới khi rỗng mới deploy. Hết run lúc 10:16:30; ngay trước `deploy.sh` (10:16:34) vẫn rỗng.
2. `overlay-source.sh 2046adf2b`: rc 0, `33 server files to transpile` (như lần trước). Bundle local có marker `crew-ui` = `2046adf2b50f…`, có `anh-dan-` và `pastedImage`.
3. `overlay-job.sh 2046adf2b` trên VPS: `JOB_EXIT rc=0 min_avail=5065MiB tag=crew-v3/paperclip:v3-2046adf2b`.
4. `inspect-image.sh crew-v3/paperclip:v3-2046adf2b` rc 0: `issues crewCoreHooks=3`, `crew-ui=2046adf2b50f14b70c359874532713444906a231`, plugin UI gzip 109325 byte, không MISSING/FAIL, chỉ có `WARNING host adapter check SKIPPED` như mọi lần.
5. So manifest: dòng `manifest crew.core …` của image cũ (`v3-e400b719d`) và mới cùng sha256 `13053b4b045e` → không thêm capability. (Số này khác `43f3560866b0` ở báo cáo trước chỉ vì cách băm của em không có ký tự xuống dòng; cũ và mới băm cùng cách nên so được.)
6. `deploy.sh crew-v3/paperclip:v3-2046adf2b`: rc 0, tự backup, `plugin crew.core healthy`, in `deploy ok: crew-v3/paperclip:v3-e400b719d -> crew-v3/paperclip:v3-2046adf2b, rollback TS=20261012-101646`. Container khởi động lại lúc 03:16:54 UTC (10:16:54 giờ VN).

## 3. Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `ok`, commit `2046adf2b50f14b70c359874532713444906a231` |
| `plugin-state.sh` | `healthy` |
| `/` và `/paperclip/` (crew.2p-solutions.com) | cả hai 200 |
| Bundle crew-web đang phục vụ | `index.html` có `crew-ui` = `2046adf2b50f…`; `assets/issues-page-DWrMOyNd.js` (200) có `anh-dan-` x1 và `pastedImage` x1; `assets/stage-badge-dnbFcABG.js` (200) có `pastedImage` x2 |
| Log server từ lúc khởi động tới 10:22 (~5 phút, 377 dòng) | 0 dòng level 50/60, 0 dòng có chữ `error` |
| Claim việc máy (`/api/plugins/crew.core/api/machine-jobs/claim`) | 146 lần, tất cả 204 |

## 4. An toàn

- Không in secret. Không `rm -rf`, không push, không commit. Chỉ xóa file log tạm của em trên VPS bằng `rm -f`.
- Không còn process nền nào em khởi tạo (vòng chờ active-runs và hẹn giờ 5 phút đều đã thoát).
- Worktree `paperclip-r3-dp` đang detached `2046adf2b`, sạch.

## 5. Concern

Không có concern mới. Concern cũ vẫn như `dp-report.md` (dòng migration `._0001_docs.sql` `failed` là rác AppleDouble; lỗi gửi ảnh chụp docs của Mac mini).

Status: DONE
Summary: Prod chạy `crew-v3/paperclip:v3-2046adf2b` (rollback: `ops/rollback.sh 20261012-101646`), health ok với commit `2046adf2b`, plugin healthy, `/` và `/paperclip/` 200, bundle có `anh-dan-`/`pastedImage`, log 0 lỗi, claim 204.
Concerns/Blockers: không.
