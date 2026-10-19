# DP: deploy `crew/v3.5` @ `539ee5fe5` (danh sách yêu cầu có chế độ Bảng kanban, refactor ảnh/bình luận)

- Thời gian: 12/10/2026 11:11 → 11:16 (Asia/Ho_Chi_Minh). Người làm: agent.
- Kết quả: **DONE_WITH_CONCERNS** (concern nhỏ, xem cuối). Prod chạy `crew-v3/paperclip:v3-539ee5fe5`, plugin `healthy`. Chỉ đổi UI crew-web (+ thêm `@dnd-kit/*` vào `packages/crew-web/package.json`, `pnpm-lock.yaml`). Không đổi code server, không migration.
- Bản trước: `v3-84cc552ad` (`dp-report-84cc552ad.md`). Quy trình giống hệt, thêm bước `pnpm install --frozen-lockfile`.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-84cc552ad` |
| Image sau | `crew-v3/paperclip:v3-539ee5fe5` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261012-111232` (về `v3-84cc552ad`) |
| Lui xa hơn | `rollback.sh 20261012-105444` (về `v3-1d68bdaa2`), `rollback.sh 20261012-104259` (về `v3-f33c11b72`) |
| Backup DB | `20261012-1112`, 54M, builtin ok |
| Lưu ý rollback | Không có migration nên lui thẳng |

## Các bước

1. `active-runs.sh` lúc 11:11:26: rỗng. Server đang chạy `v3-84cc552ad`.
2. Worktree `paperclip-r3-dp` sạch, `git checkout --detach 539ee5fe5`. `84cc552ad..539ee5fe5`: 17 file, toàn bộ trong `packages/crew-web/` cộng `pnpm-lock.yaml`.
3. `corepack pnpm install --frozen-lockfile`: thành công (3.2s), lockfile không đổi, worktree vẫn sạch. `packages/crew-web/node_modules/@dnd-kit/{core 6.3.1, sortable 10.0.0, utilities 3.2.2}` đã được link.
4. `overlay-source.sh 539ee5fe5`: rc 0, `33 server files to transpile`. Bundle local: `crew-ui`=`539ee5fe5765…`; chuỗi bảng (`Thu cột lạnh`, `Thẻ gọn`, `Đặt lại mật độ bảng`) nằm ở `assets/stage-badge-B4nJo-1u.js`, icon `square-kanban` ở `assets/hooks-BN4AwHpu.js`.
5. `overlay-job.sh 539ee5fe5`: `JOB_EXIT rc=0 min_avail=5275MiB tag=crew-v3/paperclip:v3-539ee5fe5`.
6. `inspect-image.sh crew-v3/paperclip:v3-539ee5fe5` rc 0: `issues crewCoreHooks=3`, 15/15 `crew/*.js ok`, `crew-ui=539ee5fe576522af9fd654e9949e9b4bae862d6f`, plugin UI gzip 109325, adapter P2–P7 ok, không MISSING/FAIL; chỉ có `WARNING host adapter check SKIPPED` như mọi lần.
7. Manifest `crew.core` của `v3-84cc552ad` và `v3-539ee5fe5`: băm cùng một cách (`grep "^manifest crew.core" | sha256sum`) cho hai image đều ra `24b39e967f2a` → không thêm capability. (Số khác `271b6337ab5b` của báo cáo trước chỉ vì cách băm khác; điều quan trọng là hai image bằng nhau.)
8. `active-runs.sh` kiểm lại rỗng lúc 11:12:20, chạy ngay `deploy.sh crew-v3/paperclip:v3-539ee5fe5` trong cùng lệnh: rc 0, tự backup, `plugin crew.core healthy`, `deploy ok: crew-v3/paperclip:v3-84cc552ad -> crew-v3/paperclip:v3-539ee5fe5, rollback TS=20261012-111232`. Container khởi động 04:12:39 UTC (11:12:39 giờ VN).

## Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` (crew.2p-solutions.com) | `ok`, commit `539ee5fe576522af9fd654e9949e9b4bae862d6f` |
| `plugin-state.sh` | `healthy` (ngay sau deploy, 11:13 và 11:16) |
| `/` và `/paperclip/` | 200 / 200 |
| `index.html` đang phục vụ | `crew-ui` = `539ee5fe5765…`, entry `assets/index-Y-gOHxWJ.js` |
| Bundle bảng đang phục vụ | `assets/stage-badge-B4nJo-1u.js` 200, có `Thu cột lạnh`, `Thẻ gọn`, `Đặt lại mật độ bảng`, `boardView`; `assets/hooks-BN4AwHpu.js` có icon `square-kanban` |
| Log server từ khởi động tới 11:16 (405 dòng) | 1 dòng level 50, 0 dòng level 60 (xem concern) |
| Claim việc máy (`/api/plugins/crew.core/api/machine-jobs/claim`) | 82 lần: 81 lần 204, 1 lần 503 lúc 11:12:57 |
| `active-runs.sh` lúc 11:16 | rỗng |

## An toàn

- Không in secret (header `authorization` đã che khi đọc dòng log lỗi). Không `rm -rf`, không push, không commit. Chỉ `rm -f` các file log tạm của em trong `/tmp` trên VPS và scratchpad.
- Không chạy Playwright. Không còn process nền nào em khởi tạo.
- Worktree `paperclip-r3-dp` đang detached `539ee5fe5`, sạch.

## Concern

- Dòng level 50 duy nhất là `POST /machine-jobs/claim 503` lúc 11:12:57, 18 giây sau khi container khởi động: plugin-loader bắt đầu `starting plugin worker` lúc 11:12:56 và `worker started` lúc 11:12:58, nên một lần claim của Mac mini rơi đúng khe worker chưa sẵn. Từ 11:12:58 trở đi mọi claim đều 204 (81/81). Đây là race lúc khởi động, không liên quan thay đổi UI lần này; các lần deploy trước tình cờ không trúng khe này. Nếu muốn sạch hẳn thì route claim nên trả 503 mà không log level 50, hoặc daemon coi 503 lúc khởi động là bình thường.
- Concern cũ như `dp-report.md` vẫn còn.

Status: DONE_WITH_CONCERNS
Summary: Prod chạy `v3-539ee5fe5` (rollback `20261012-111232`), health ok với commit `539ee5fe5`, plugin healthy, `/` và `/paperclip/` 200, bundle phục vụ có code bảng kanban, claim 81/82 là 204.
Concerns/Blockers: 1 dòng lỗi server (claim 503 lúc 11:12:57, khi plugin worker đang khởi động); sau đó claim đều 204.
