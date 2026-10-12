# Kế hoạch: deploy tự động sau khi owner duyệt (Crew v3 tự phát triển chính nó)

- Lập: 12/10/2026 15:00 (Asia/Ho_Chi_Minh). Trạng thái: đã cài đặt và chạy thử (dry-run) 12/10/2026 15:20; chờ foreman rollout (xem `implement-report.md`).
- Repo: fork `nquangphan/crew-paperclip`, nhánh làm `crew/project-access` (worktree
  `.worktrees/paperclip-issues-ui`). Nhánh deploy: `crew/v3.5`.
- Phạm vi file: `crew/agents/**`, `crew/ops/**`, `crew/release/**` và fixture render của integrator
  (`packages/crew-web/test/lib/instructions/__fixtures__/rendered/integrator.md`, chỉ file này).

## 1. Kết quả mong muốn

Owner duyệt yêu cầu của project "paperclip" → integrator stage 4 push vào `crew/v3.5` như cũ → **thêm**: một job
riêng trên Mac mini tự kiểm, build, chờ hết run, deploy lên prod, kiểm sau deploy, tự rollback khi kiểm sau deploy
xấu, và comment kết quả vào issue gốc. Giống hệt quy trình tay trong `dp-report*.md`.

Không làm: deploy cho repo khác (mặc định tắt), e2e Playwright trong job, migration lui, đổi code server/plugin.

## 2. Thiết kế

### 2.1 Bật theo repo

`crew/release/auto-deploy.json` (đọc ở đúng commit được deploy, không ở cây làm việc):

```json
{ "version": 1, "enabled": true, "repoKey": "paperclip", "branch": "crew/v3.5",
  "worktree": "~/crew-deploy/paperclip", "vps": "nhamoiplatform", "root": "/opt/crew-v3-spike",
  "publicUrl": "https://crew.2p-solutions.com", "maxWaitMinutes": 180 }
```

`integrator.md` dùng chung cho mọi project: bước deploy chỉ chạy khi `git cat-file -e "$T:crew/release/auto-deploy.json"`
thành công. Repo không có file → bỏ qua hẳn, không comment.

### 2.2 Luồng

1. Integrator stage 4, sau `crew-merge … pushed=yes` (bước 7) và **trước** `PATCH done` (bước 8): lấy đúng
   `crew/ops/auto-deploy.mjs` của commit `T` (`git show "$T:…"`) rồi chạy `enqueue --issue <id> --sha "$T"`.
   Lệnh ghi yêu cầu vào hàng đợi, khởi worker nền, và viết sẵn body JSON; integrator đăng nguyên body đó
   (`crew-deploy sha=<T> status=queued`) bằng JWT của run (còn hạn lúc này). Lỗi enqueue không chặn bước 8.
2. Worker chạy dưới launchd (`launchctl bootstrap gui/<uid>`, label `com.2p.crew.auto-deploy.<repoKey>`,
   `RunAtLoad`, không `KeepAlive`, `AbandonProcessGroup`), từ bản sao script trong `~/.crew/auto-deploy/<repoKey>/bin/`.
3. Mỗi vòng: lấy commit mới nhất trong hàng đợi → kiểm hợp lệ → chuẩn bị worktree deploy → cổng kiểm → build image
   → inspect → chờ hết run → deploy → kiểm sau deploy → (rollback) → comment → lặp nếu còn yêu cầu mới hơn.

### 2.3 Vì sao launchd (vấn đề 1)

- Deploy khởi động lại server điều phối run của integrator, nên không chạy trong run.
- Reaper `crew-mac reap` (apps/crew-mac/src/reaper) chỉ nhắm process chính của run (claude/codex/opencode có
  `PAPERCLIP_RUN_ID` trong env) đã mồ côi, rồi gom thành viên theo (a) con cháu theo PPID, (b') cwd dưới worktree của
  run, (c) pgid wrapper ghi ở `.paperclip-runtime/runs/<id>/pgid`. Server (H3) cũng dừng theo pgid đó.
- Job launchd có PPID 1, pgid/session riêng, cwd ngoài worktree agent, env tự dựng (không có `PAPERCLIP_*`) → không
  khớp nhánh nào ở trên.
- Đã đo từ phiên sshd của app (cổng 2222, `launchctl managername` = `Aqua`): `launchctl submit` **chạy lại liên tục**
  (KeepAlive ngầm, 3 lần trong 25 giây) nên loại; `launchctl bootstrap gui/501 <plist>` chạy đúng một lần, sống sau
  khi phiên SSH thoát (ppid=1, pgid riêng), đọc được `/Volumes/CORSAIR`, chạy `git`, `ssh nhamoiplatform` ok.
- TCC của job launchd theo file chạy chính của job: `node` làm main thì đọc được `/Volumes/CORSAIR`, `bash` làm main
  thì bị từ chối; `~/Documents` bị từ chối. Vì vậy worker luôn là `node`, worktree deploy ở `~/crew-deploy/…`, không
  dùng `paperclip-r3-dp` dưới `~/Documents`.

### 2.4 Chờ hết run (vấn đề 2)

Chờ chạy trên VPS theo từng lượt 600 giây: cứ 2 giây gọi `ops/active-runs.sh`; rỗng là **ngay trong cùng lệnh**
khởi `deploy.sh` tách khỏi phiên SSH (`setsid nohup`, ghi `ops/auto-deploy-<short>.log` và `.rc`), giống vòng 2 giây
foreman đã làm. Giữa các lượt kiểm hàng đợi (có commit mới hơn thì làm lại cho commit đó). Tổng chờ tối đa
`maxWaitMinutes` (180) → comment `status=failed` nêu lý do. `deploy.sh` vẫn tự từ chối khi có run (rc 2) → quay lại chờ.

### 2.5 Cổng kiểm, build, deploy, kiểm sau (vấn đề 3)

- Commit đang chạy trên prod lấy từ `/api/health` `commit`. Mọi file đổi so với commit đó nằm trong
  `packages/crew-web/` hoặc là `*.md` → cổng crew-web; khác (hoặc không xác định) → thêm `crew/release/verify.sh`
  và `node --test crew/ops/*.test.mjs`.
- Cổng crew-web: `pnpm --filter @crew/paperclip-web test`, `typecheck`, `exec biome check src test e2e`.
- Build: image `crew-v3/paperclip:v3-<short>` đã có trên VPS thì dùng lại; không thì `overlay-source.sh <sha>` (từ
  worktree deploy, `CREW_UI_COMMIT` là 40 hex do script tự đặt) rồi `ssh … ops/overlay-job.sh <short>`.
- `ops/inspect-image.sh` trên VPS: rc 0, không `MISSING`/`FAIL`, có `issues crewCoreHooks=3`, `crew-ui=<sha>`;
  dòng `manifest crew.core …` phải giống image đang chạy (capability mới → dừng, để foreman làm tay).
- Kiểm sau deploy (thử lại tới 3 phút): health `ok` và `commit` = sha; plugin `healthy`; `/` và `/paperclip/` 200;
  `index.html` có `crew-ui` = sha; có ít nhất một claim `machine-jobs/claim` 2xx sau lúc container khởi động.
- `deploy.sh` rc 3/6/8 hoặc kiểm sau xấu → `ops/rollback.sh <TS>` tự động → `status=rolled_back` (rollback lỗi →
  `status=failed`, nêu rõ cần foreman xử lý).

### 2.6 Báo kết quả (vấn đề 4)

- Dòng đầu: `crew-deploy sha=<40hex> status=<queued|deployed|failed|rolled_back>`.
- **Không dùng phiên board** để comment sau khi issue đã `done`: comment của user trên issue đóng có
  `assigneeAgentId` bị server tự mở lại về `todo` (`shouldImplicitlyMoveCommentedIssueToTodo`, routes/issues.ts) và
  đánh thức integrator. Comment của agent không bao giờ tự mở lại.
- Vì vậy kết quả cuối được đăng bằng **API key dài hạn của agent integrator**, giữ trên VPS ở
  `/opt/crew-v3-spike/.deploy-agent-key` (0600, cạnh cookie board sẵn có), gửi bằng `curl -H @file` (key không nằm
  trên dòng lệnh, không in ra). Thiếu key → không comment, chỉ ghi log và `status.json` trên Mac.
- Đọc comment để kiểm `crew-merge` dùng `api.sh GET` (chỉ đọc) và chỉ trả về tác giả + dòng đầu.

### 2.7 Bật theo repo, khóa, commit mới nhất, commit hợp lệ (vấn đề 5–7)

- Một worker cho mỗi `repoKey` (label launchd là duy nhất) + khóa thư mục cho hàng đợi + `flock` trên VPS quanh lúc
  khởi deploy.
- Hàng đợi giữ commit đích mới nhất (con cháu thay cha) và danh sách issue; deploy một lần cho commit mới nhất rồi
  comment cho mọi issue có commit nằm trong bản đó.
- Trước khi làm: `git fetch origin <branch>`, sha phải là tổ tiên (hoặc bằng) `origin/<branch>`, và issue phải có
  comment của agent với dòng đầu đúng `crew-merge sha=<sha> branch=<branch> pushed=yes`.

### 2.8 Dry-run

`enqueue --dry-run`: hàng đợi, label và log riêng (`<repoKey>-dry`). Bước đọc (fetch, kiểm tổ tiên, đọc comment,
`active-runs`, health) chạy thật; bước ghi (worktree, cổng kiểm, build, scp, deploy, rollback, comment) chỉ in ra
lệnh/nội dung. `--simulate-merge-ok` (chỉ đi cùng `--dry-run`) bỏ kiểm comment `crew-merge` để mô phỏng trọn luồng.

## 3. Việc cần làm

1. `crew/ops/auto-deploy.mjs` (+ test): config, hàng đợi, enqueue (launchd), worker, soạn comment, che secret.
2. `crew/ops/auto-deploy-vps.sh` (+ test với ROOT giả): active-runs, image, inspect, deploy-when-idle, deploy-status,
   rollback, post-check, đọc comment, đăng comment bằng key agent.
3. `crew/release/auto-deploy.json`.
4. `crew/agents/integrator.md` bước 7b + sửa bước 1 (đã push) và bước 8; test trong `instructions.test.mjs`; sinh
   lại fixture `integrator.md`.
5. Dry-run từ phiên sshd cổng 2222 trên Mac mini; báo cáo `implement-report.md` kèm bước rollout cho foreman.

## 4. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Comment board mở lại issue đã đóng | Dùng key agent; không có key thì không comment |
| Key agent dài hạn bị lộ | Chỉ ở VPS 0600, gửi qua file header; thu hồi bằng `DELETE /api/agents/:id/keys/:keyId` |
| Run 2P Solutions chạy nối tiếp, không có khe | Poll 2 giây trên VPS, deploy ngay trong cùng lệnh; tối đa 180 phút |
| Chờ xong thì có run chen vào | `deploy.sh` tự từ chối (rc 2) → chờ tiếp |
| Kiểm sau deploy xấu | Rollback tự động theo TS `deploy.sh` in ra |
| Capability plugin mới cần duyệt tay | So dòng manifest, khác thì dừng `failed` |
| Máy Mac nặng do cổng kiểm | Worker chạy tuần tự, một việc nặng một lúc |
| Worktree deploy bẩn | Dừng `failed`, không tự xóa |
| launchd job treo | Foreman `launchctl bootout gui/501/com.2p.crew.auto-deploy.paperclip` |

## 5. Rollback của chính tính năng

- Tắt nhanh: `"enabled": false` trong `crew/release/auto-deploy.json` (commit mới) hoặc trả `integrator.md` live về
  bản trước (`PUT /api/agents/:id/instructions-bundle/file` với bản cũ).
- Dừng job đang chạy: `launchctl bootout gui/$(id -u)/com.2p.crew.auto-deploy.paperclip` trên Mac mini.
- Thu hồi key agent: `DELETE /api/agents/<integrator id>/keys/<keyId>` và xóa file key trên VPS.

## 6. Tiêu chí nghiệm thu

1. Repo không có `crew/release/auto-deploy.json`: integrator không chạy gì thêm, không comment thêm.
2. Repo có file: sau `crew-merge … pushed=yes`, có comment `crew-deploy sha=<T> status=queued` trước `PATCH done`.
3. Worker sống sau khi run integrator kết thúc và phiên SSH đóng; reaper không nhắm tới nó (chứng minh bằng dry-run
   từ sshd cổng 2222: ppid=1, pgid riêng, env không có `PAPERCLIP_RUN_ID`).
4. Chỉ deploy commit trên `origin/crew/v3.5` có `crew-merge … pushed=yes` của agent; commit mới hơn tới khi đang chờ
   thì chỉ deploy bản mới nhất một lần.
5. Một deploy một lúc; chờ hết run tối đa 180 phút rồi báo `failed`.
6. Kiểm sau xấu → rollback tự động → `status=rolled_back`; tốt → `status=deployed` kèm lệnh rollback.
7. Không in secret ở log, comment hay output.
8. `node --test crew/ops/*.test.mjs` và `node --test crew/agents/*.test.mjs` xanh.
