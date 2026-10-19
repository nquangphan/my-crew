# DP: deploy `crew/v3.5` @ `dd1e4fcca` — DỪNG ở cổng kiểm crew-web

- Thời gian: 13/10/2026 15:50 → 15:58 (Asia/Ho_Chi_Minh). Người làm: agent.
- Kết quả: **BLOCKED.** Test crew-web đỏ 2 test (do commit `f5f682ced`), nên em không build overlay, không dựng waiter, không deploy. **Prod vẫn `crew-v3/paperclip:v3-a2b2921ec`.** Trên VPS không còn waiter nào.
- Chuỗi trước: `dp-report-40f54672a` (gộp vào) → `dp-report-cbee2a632.md` (bị thay đích, không deploy) → bản này.

## 1. Dừng waiter `cbee2a632`

- 15:50:51: SIGTERM pid 3866233 (`ops/deploy-wait-cbee2a632.sh`). Log `ops/deploy-cbee2a632.log` không có dòng `EMPTY`, tức chưa từng gọi `deploy.sh`; đã ghi `STOPPED_BY_OPERATOR (đổi đích sang dd1e4fcca)`. `pgrep -af "^/bin/bash /opt/crew-v3-spike/ops/deploy-wait"` → không còn waiter. Container vẫn chạy `v3-a2b2921ec`.

## 2. Đẩy nhánh

- Fork `paperclip-issues-ui` (`crew/project-access`) sạch, HEAD `dd1e4fcca73369bb050af6f8ad22de9138c56146`. `cbee2a632` là tổ tiên (fast-forward được).
- `git push origin <sha>:refs/heads/crew/v3.5`: lần 1 bị lỗi `failed to push some refs` (không có chi tiết, có vẻ lỗi mạng thoáng qua); lần 2 ok `cbee2a632..dd1e4fcca`. **`origin/crew/v3.5` hiện là `dd1e4fcca`** dù chưa deploy. Không push nhánh khác, không commit gì.
- Ngoài `packages/crew-web/` đổi: `crew/agents/{assistant,executor,integrator,reviewer}.md`, `crew/agents/instructions.test.mjs`, `server/src/crew/issue-create-policy.ts`, `server/src/crew/issue-gate.ts` và test server. Không đổi `package.json`, lockfile, migration hay `crew/ops`.

## 3. Cổng kiểm (worktree `paperclip-r3-dp`, detached `dd1e4fcca`, sạch)

| Cổng | Kết quả |
|---|---|
| `verify.sh` FULL | **XANH**, 4:39 phút. `check-core-hooks`: `Hook một dòng: 5/5; vá lõi: 10; mục: 23; lỗi: 0`, test 13/13; plugin-state 5, policy-config 10, upgrade/compose/pull-backup 18; server **724 test / 39 file**; adapter claude 17, codex 10, opencode 12; plugin 467/57; agents 158/158; tsc 0 lỗi; build plugin ok |
| ops `node --test crew/ops/*.test.mjs` | 115 pass, 0 fail |
| crew-web `typecheck` | rc 0 |
| crew-web `biome check src test e2e` | sạch (586 file) |
| crew-web `pnpm test` | **ĐỎ: 1 file / 2 test fail**, 1493 pass, 1 todo (161 file) |

Test đỏ, chạy lại riêng file vẫn đỏ (lỗi chắc chắn, không phải flaky):

- `test/features/contributions/pending-comments.test.tsx`
  - `xếp xen theo giờ, có badge, không có nút Duyệt cho khách`: `Unable to find an element with the text: Chờ duyệt` (dòng 73, `within(pending[0])`).
  - `bình luận thật sinh từ góp ý có chip tên người góp ý`: `Unable to find an element by: [data-testid="contribution-chip"]` (dòng 96, `findAllByTestId('comment')[1]`).

Tìm commit gây lỗi: ở `02756e5ee` file này 3/3 pass; ở `f5f682ced` ("bình luận mới nhất ở trên") 2 fail / 1 pass. Nguyên nhân gần như chắc chắn: `f5f682ced` đảo thứ tự luồng bình luận sang mới nhất trước, nhưng test này vẫn khẳng định thứ tự cũ (cũ nhất trước, `pending[0]` là "Chờ duyệt", `comment[1]` là bình luận muộn). Commit đó không sửa file test này. Cần sửa test (đổi kỳ vọng thứ tự) hoặc sửa code — việc của executor, không phải của em.

Sau khi dò, worktree `paperclip-r3-dp` đã về lại `dd1e4fcca`, sạch.

## 4. Chưa làm (vì cổng đỏ)

- Không chạy `overlay-source.sh`, `overlay-job.sh`, `inspect-image.sh`, so manifest cho `dd1e4fcca`.
- Không dựng waiter trên VPS, không deploy, không post-check.

## Mốc lui

Không đổi gì trên prod nên chưa có rollback mới. Prod `v3-a2b2921ec`; nếu cần lui về bản trước nữa vẫn là `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261013-015546` (về `v3-a1660e3ac`).

## Để tiếp tục

1. Executor sửa `pending-comments.test.tsx` (hoặc code) cho khớp thứ tự mới nhất trước, commit lên `crew/project-access`.
2. Quản đốc giao lại deploy cho commit mới: chạy lại đủ cổng (server có đổi → verify FULL), build overlay, inspect, so manifest, dựng một waiter tới 06:00.
- Phương án tạm nếu cần gấp: `v3-cbee2a632` đã build và qua `inspect-image.sh` rc 0, manifest trùng `43f3560866b0`, các cổng của nó xanh, có thể dựng waiter cho nó ngay. Nhưng `origin/crew/v3.5` đã ở `dd1e4fcca`, nên prod sẽ lệch với nhánh.

## An toàn

- Không in secret, không ghi DB, không tạo API key, không DELETE environment, không áp instruction agent, không tạo nhãn, không chạy e2e, không `rm -rf` (chỉ `rm -f` file tạm `/tmp/insp-*.txt` em tạo trên VPS).
- Không còn process em khởi tạo: waiter VPS của `40f54672a` (2 lần) và `cbee2a632` đã dừng bằng SIGTERM trước khi deploy; các vòng theo dõi local đã thoát.
- Rác để lại trên VPS (không dùng): image `v3-781a5c3af`, `v3-40f54672a`, `v3-cbee2a632`; file `ops/overlay-{781a5c3af,40f54672a,cbee2a632}.tar.gz`, script `ops/deploy-wait-{40f54672a,cbee2a632}.sh` và log tương ứng.

Status: BLOCKED
Summary: Đã dừng waiter `cbee2a632` trước khi deploy và đẩy `crew/v3.5` lên `dd1e4fcca`; verify FULL, ops, typecheck và biome xanh, nhưng crew-web test đỏ 2 test trong `pending-comments.test.tsx` (do `f5f682ced` đảo thứ tự bình luận mà không sửa test), nên em không build và không deploy; prod vẫn `v3-a2b2921ec`.
Concerns/Blockers: Cần sửa test thứ tự bình luận rồi giao deploy lại. `origin/crew/v3.5` đã đi trước prod.
