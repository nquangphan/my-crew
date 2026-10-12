# DP: deploy `crew/v3.5` @ `6ef3b54b3` (bình luận dài thu gọn 10 dòng; gồm cả `52c2a738a` ảnh đính kèm hiện thành hình)

- Thời gian: 12/10/2026 10:26 → 10:35 (Asia/Ho_Chi_Minh). Người làm: agent.
- Kết quả: **DONE.** Prod chạy `crew-v3/paperclip:v3-6ef3b54b3`, plugin `healthy`. Chỉ đổi crew-web, không có code server, không có migration.
- Đích ban đầu là `52c2a738a`; em đã build `v3-52c2a738a` (overlay-job rc 0, inspect rc 0) nhưng **chưa deploy** thì điều phối đổi đích sang `6ef3b54b3`, nên không có báo cáo riêng cho `52c2a738a`. Image `v3-52c2a738a` vẫn nằm trên VPS, không dùng.
- Sau đó prod đã lên tiếp `f33c11b72`, xem `dp-report-f33c11b72.md`.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-2046adf2b` |
| Image sau | `crew-v3/paperclip:v3-6ef3b54b3` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261012-103005` (về `v3-2046adf2b`) |
| Backup DB | `20261012-1029`, 54M, builtin ok |

## Các bước

1. Worktree `paperclip-r3-dp` sạch, `git checkout --detach 6ef3b54b3`. Diff `2046adf2b..6ef3b54b3` chỉ trong `packages/crew-web`.
2. `active-runs.sh` lúc 10:26: 1 run `running` (2P Solutions). Em build trong lúc chờ; hết run lúc 10:29:49, kiểm lại ngay trước `deploy.sh` vẫn rỗng.
3. `overlay-source.sh 6ef3b54b3`: rc 0, `33 server files to transpile`. Bundle local: `crew-ui`=`6ef3b54b3c37…`.
4. `overlay-job.sh 6ef3b54b3`: `JOB_EXIT rc=0 min_avail=5138MiB`.
5. `inspect-image.sh` rc 0: `issues crewCoreHooks=3`, `crew-ui=6ef3b54b3c37…`, plugin UI gzip 109325, chỉ có `WARNING host adapter check SKIPPED` như mọi lần.
6. Manifest: chuỗi `manifest crew.core …` (lấy bằng `grep -o`) của image cũ `v3-2046adf2b` và mới cùng sha256 `271b6337ab5b`. Số này khác `13053b4b045e` ở báo cáo trước vì cách cắt dòng khác; cũ và mới băm cùng cách.
7. `deploy.sh crew-v3/paperclip:v3-6ef3b54b3` lúc 10:29:53: rc 0, `deploy ok: … v3-2046adf2b -> … v3-6ef3b54b3, rollback TS=20261012-103005`.

## Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `ok`, commit `6ef3b54b3c377f6de7c574a06945926776239126` |
| `plugin-state.sh` | `healthy` |
| `/` và `/paperclip/` | 200 / 200 |
| Bundle đang phục vụ | `issue-detail-Bowx8kFB.js` có `object-contain`, `showMore`, `10lh`; `issues-page-CJQMigwm.js` có `object-contain` + `revokeObjectURL`; `stage-badge-C7YqG7tD.js` có `showMore` |
| Log server 5 phút (304 dòng) | 0 dòng level 50/60, 0 dòng chứa `error` |
| Claim việc máy | 127 lần, tất cả 204 |

Status: DONE
Summary: Prod lên `v3-6ef3b54b3` (rollback `20261012-103005`), mọi kiểm đạt; sau đó đã lên tiếp `f33c11b72`.
Concerns/Blockers: không.
