# DP: deploy `crew/v3.5` @ `f33c11b72` (ảnh đính kèm xếp theo hàng, hết chỗ mới xuống dòng)

- Thời gian: 12/10/2026 10:35 → 10:42 (Asia/Ho_Chi_Minh). Người làm: agent.
- Kết quả: **DONE_WITH_CONCERNS** (concern nhỏ: 5 dòng lỗi 502 lúc khởi động, xem mục Concern). Prod chạy `crew-v3/paperclip:v3-f33c11b72`, plugin `healthy`. Chỉ đổi crew-web (`attachments.tsx`, `new-request-dialog.tsx`, test), không có code server, không có migration.
- Deploy ngay sau `6ef3b54b3` (`dp-report-6ef3b54b3.md`), quy trình giống hệt `dp-report-2046adf2b.md`.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-6ef3b54b3` |
| Image sau | `crew-v3/paperclip:v3-f33c11b72` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261012-103614` (về `v3-6ef3b54b3`) |
| Backup DB | `20261012-1036`, 54M, builtin ok |

## Các bước

1. Worktree `paperclip-r3-dp` sạch, `git checkout --detach f33c11b72`. Diff `6ef3b54b3..f33c11b72`: 3 file trong `packages/crew-web`.
2. `overlay-source.sh f33c11b72`: rc 0, `33 server files to transpile`, `crew-ui`=`f33c11b7241d…`.
3. `overlay-job.sh f33c11b72`: `JOB_EXIT rc=0 min_avail=5235MiB`.
4. `inspect-image.sh crew-v3/paperclip:v3-f33c11b72` rc 0: `issues crewCoreHooks=3`, `crew-ui=f33c11b7241da0a02a0aa7891276a4da5901997c`, plugin UI gzip 109325, chỉ có `WARNING host adapter check SKIPPED`.
5. Manifest `crew.core` của `v3-6ef3b54b3` và `v3-f33c11b72` cùng sha256 `271b6337ab5b` → không thêm capability.
6. `active-runs.sh` rỗng lúc 10:35:57 và kiểm lại ngay trước deploy. `deploy.sh crew-v3/paperclip:v3-f33c11b72` lúc 10:36:01: rc 0, `plugin crew.core healthy`, `deploy ok: … v3-6ef3b54b3 -> … v3-f33c11b72, rollback TS=20261012-103614`. Container khởi động 03:36:20 UTC.

## Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `ok`, commit `f33c11b7241da0a02a0aa7891276a4da5901997c` |
| `plugin-state.sh` | `healthy` (cả ngay sau deploy lẫn lúc 10:41) |
| `/` và `/paperclip/` | 200 / 200 |
| Bundle đang phục vụ | `index.html` `crew-ui`=`f33c11b7…`; `issue-detail-CoJKiAgx.js` (200) có `flex flex-wrap gap-2` ngay trước code ảnh đính kèm (`contentUrl`, `object-contain`), cùng `showMore`, `10lh`; `issues-page-nqZxltZf.js` (200) có `object-contain`, `revokeObjectURL`, `flex-wrap` |
| Log server 5 phút (293 dòng, tới 10:41) | 5 dòng level 50, xem Concern; ngoài ra không có lỗi |
| Claim việc máy | 128 lần, tất cả 204 |

## Concern

- 5 dòng level 50 đều cùng lúc 10:36:39 (0,5 giây sau khi plugin-loader bắt đầu kích hoạt): `POST /api/plugins/crew.core/data/crew.{setupRuns,roots,companies}` trả 502 `No worker registered for plugin "e29d3a17…"`. Đây là tab trình duyệt đang mở gọi vào trước khi worker plugin đăng ký xong; sau đó không còn lỗi, plugin healthy, claim 204. Lỗi chạy đua lúc khởi động, không phải do thay đổi UI này (các lần deploy trước chỉ may không có request nào rơi vào khoảng đó).
- Concern cũ như `dp-report.md` vẫn còn.

## An toàn

Không in secret, không `rm -rf`, không push/commit. Chỉ `rm -f` các file log tạm của em trong `/tmp` trên VPS. Không còn process nền của em. Worktree `paperclip-r3-dp` detached `f33c11b72`, sạch.

Status: DONE_WITH_CONCERNS
Summary: Prod chạy `v3-f33c11b72` (rollback `20261012-103614`), health ok với commit `f33c11b72`, plugin healthy, `/` và `/paperclip/` 200, bundle có `flex flex-wrap gap-2` ở ảnh đính kèm, claim 204.
Concerns/Blockers: 5 dòng 502 "No worker registered" lúc khởi động (tạm thời, tự hết).
