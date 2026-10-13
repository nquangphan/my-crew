# DP: deploy `crew/v3.5` @ `cbee2a632` (loại yêu cầu Viết tài liệu, hộp xem file đính kèm, integrator mở PR, auto-deploy chờ merge)

- Thời gian: 13/10/2026 08:42 → 15:50 (Asia/Ho_Chi_Minh). Người làm: agent.
- Kết quả: **KHÔNG DEPLOY (bị thay đích).** Image `crew-v3/paperclip:v3-cbee2a632` đã build và qua kiểm; 15:50:51 quản đốc đổi đích sang `dd1e4fcca`, em dừng vòng chờ trước khi gọi `deploy.sh`. Prod vẫn `v3-a2b2921ec`. Xem tiếp `dp-report-dd1e4fcca.md`.
- Bản trước: `v3-a2b2921ec` (`plans/261012-2240-phone-composer/dp-report-a2b2921ec.md`). Quy trình giống bản đó.
- Đổi mục tiêu giữa chừng: ban đầu deploy `40f54672a`. Image `crew-v3/paperclip:v3-40f54672a` đã build, qua `inspect-image.sh` rc 0, manifest trùng; vòng chờ chạy từ 08:51. 11:28 thay vòng 3 giờ bằng vòng dài (theo owner: chờ 0 run, không ép, không drain). 11:57:53 quản đốc đổi đích sang `cbee2a632`, em dừng vòng chờ `40f54672a` bằng SIGTERM **trước khi** gọi `deploy.sh` (log không có dòng `EMPTY`; ghi `STOPPED_BY_OPERATOR` vào `ops/deploy-40f54672a.log`). Prod lúc đó vẫn `v3-a2b2921ec`. Image `v3-40f54672a` và `ops/overlay-40f54672a.tar.gz` để lại trên VPS, không dùng.

## Nội dung `a2b2921ec..cbee2a632` (8 commit)

| Commit | Nội dung |
|---|---|
| `65780f38f` | agents: loại yêu cầu viết tài liệu (`crew-kind docs`) cho Trợ Lý, executor, reviewer |
| `b0d287164` | crew-web: loại yêu cầu "Viết tài liệu" theo nhãn `docs` |
| `2b98be7eb` | server: chỉ test (`crew-issue-create-policy.test.ts`) |
| `2012d57eb` | agents: Trợ Lý viết rõ từng điểm cần owner chốt trong tổng kết |
| `40f54672a` | crew-web: hộp xem file đính kèm trong trang thay vì tab mới |
| `4af5f3f20` | ops: auto-deploy chờ PR merge rồi mới deploy merge commit (`crew/ops/auto-deploy.mjs` + test) |
| `c97590940` | agents + server: integrator mở PR thay vì push nhánh mặc định; `server/src/crew/issue-policy.ts`, `issue-gate.ts` + test |
| `cbee2a632` | crew-web + plugin guide: hướng dẫn luồng PR sau khi owner duyệt |

Server source đổi: `server/src/crew/issue-policy.ts`, `server/src/crew/issue-gate.ts` → chạy verify FULL. Không đổi `package.json`, `pnpm-lock.yaml`, migration. Script ops dùng trên VPS (`deploy.sh`, `active-runs.sh`, `overlay-job.sh`, `inspect-image.sh`, `inspect-adapters.mjs`, `rollback.sh`, `plugin-state.sh`, `plugin-state.py`) trùng sha256 với repo (commit `4af5f3f20` chỉ đổi `auto-deploy.mjs`, không chạy trên VPS).

## 1. Đẩy nhánh

- Fork `paperclip-issues-ui`, nhánh `crew/project-access`, sạch. `merge-base --is-ancestor` đúng cả hai lần.
- `git push origin <sha>:refs/heads/crew/v3.5`: `a2b2921ec..40f54672a` (08:42), rồi `40f54672a..cbee2a632` (11:59). Không push nhánh khác, không commit gì.

## 2. Cổng kiểm (worktree `paperclip-r3-dp`, detached `cbee2a632…`, sạch)

- `crew/release/verify.sh` FULL: 6:26 phút, rc 0, **XANH**.
  - `check-core-hooks.mjs`: `Hook một dòng: 5/5; vá lõi: 10; mục: 23; lỗi: 0`; test của nó 13/13.
  - plugin-state 5/5, policy-config 10/10, upgrade/compose-set-image/pull-backup 18/18.
  - Server **718 test / 38 file** (trước 713; bản `40f54672a` là 714); adapter claude 17, codex 10, opencode 12; plugin 467 / 57 file; agents 153/153; tsc 0 lỗi; build plugin ok; bundle không có `require("react")` trần.
- ops `node --test crew/ops/*.test.mjs`: 115 pass, 0 fail (bản `40f54672a`: 107).
- crew-web: `pnpm test` 157 file, 1441 pass, 1 todo; `typecheck` rc 0; `biome check src test e2e` sạch (575 file).
- (Bản `40f54672a` cũng qua: verify FULL 5:50 phút xanh, server 714/38, agents 142; crew-web giống trên.)
- Không chạy e2e.

## 3. Build và kiểm image

1. `overlay-source.sh cbee2a6324ff52ba0721d598f36e8d9445ee442a` (`CREW_UI_COMMIT` = 40 hex): rc 0, `36 server files to transpile`. Bundle local `crew-ui=cbee2a6324ff…`; "Viết tài liệu" trong `roadmap-node-C8_DYMS7.js`, `guide-page-BmZ59HAP.js`; chuỗi hộp xem "Chưa xem trước được loại file này trong trang", "Tải về" trong `roadmap-node-C8_DYMS7.js`; `attachment-viewer-counter` trong `hooks-Cc4NXtnw.js`.
2. `overlay-job.sh cbee2a632`: `JOB_EXIT rc=0 min_avail=4900MiB tag=crew-v3/paperclip:v3-cbee2a632`.
3. `inspect-image.sh crew-v3/paperclip:v3-cbee2a632` rc 0: `heartbeat crewCoreHooks=2`, `environment-runtime crewCoreHooks=2`, `issues crewCoreHooks=3`, 17 dòng `crew/*.js ok`, `crew-ui=cbee2a6324ff…`, plugin UI gzip 109477, 6 adapter ok, không MISSING/FAIL; chỉ `WARNING host adapter check SKIPPED` như mọi lần.
4. Manifest `crew.core`: `v3-a2b2921ec` và `v3-cbee2a632` cùng `43f3560866b0` → không thêm capability.

## 4. Chờ và deploy

- Vòng chờ trên VPS: `ops/deploy-wait-cbee2a632.sh` (setsid nohup, pid 3866233, log `ops/deploy-cbee2a632.log`), 2 giây gọi `active-runs.sh`, rỗng thì `deploy.sh crew-v3/paperclip:v3-cbee2a632`, rc 2 thì chờ tiếp, hạn tới 06:00 14/10 giờ VN. Bắt đầu 12:07:29. Chỉ một waiter (kiểm bằng `pgrep -af "^/bin/bash /opt/crew-v3-spike/ops/deploy-wait"`).
- Active run lúc 12:07: `running 4`; 12:36: `queued 4, running 3`.

- 13:06 `queued 3, running 2`; 14:33 `running 4`; 15:31 `queued 1, running 2` — chưa lúc nào về 0.
- 15:50:51: dừng vòng chờ bằng SIGTERM (log không có dòng `EMPTY`, ghi `STOPPED_BY_OPERATOR (đổi đích sang dd1e4fcca)`). Không có waiter nào còn chạy. Image `v3-cbee2a632` và `ops/overlay-cbee2a632.tar.gz` để lại trên VPS.
