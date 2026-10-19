# DP: deploy `crew/v3.5` @ `86abc46ab` (Viết tài liệu, hộp xem đính kèm, integrator mở PR, Thêm việc con, ảnh và thứ tự bình luận)

- Thời gian: 13/10/2026 16:00 → 18:40 (Asia/Ho_Chi_Minh). Người làm: agent. Chờ run đang chạy từ 16:02 tới 18:25:27.
- Kết quả: **DONE.** Prod chạy `crew-v3/paperclip:v3-86abc46ab` từ 18:26:26 (container start), plugin `healthy`. Không migration, không đổi dependency, manifest không thêm capability. Đã báo quản đốc ngay khi deploy xong (18:27) để áp instruction agent.
- Bản trước: `v3-a2b2921ec` (`plans/261012-2240-phone-composer/dp-report-a2b2921ec.md`).
- Chuỗi đổi đích trong ngày (không cái nào lên prod): `40f54672a` → `cbee2a632` (`dp-report-cbee2a632.md`) → `dd1e4fcca` (`dp-report-dd1e4fcca.md`, BLOCKED vì 2 test crew-web đỏ) → `86abc46ab` (sửa test đó).

## Nội dung `a2b2921ec..86abc46ab` (17 commit)

| Commit | Nội dung |
|---|---|
| `65780f38f`, `b0d287164`, `2b98be7eb` | loại yêu cầu "Viết tài liệu" (`crew-kind docs`): agents, crew-web, test server |
| `2012d57eb` | agents: Trợ Lý ghi rõ từng điểm cần owner chốt |
| `40f54672a` | crew-web: hộp xem file đính kèm ngay trong trang |
| `4af5f3f20` | ops: auto-deploy chờ PR merge (`crew/ops/auto-deploy.mjs`, không chạy trên VPS) |
| `c97590940`, `cbee2a632` | integrator mở PR sau khi owner duyệt (`server/src/crew/issue-policy.ts`, `issue-gate.ts`) + hướng dẫn |
| `96cb824cc` | server: việc con board thêm vào yêu cầu Crew nhận reviewer, giữ gốc tới khi xong (`issue-create-policy.ts`, `issue-gate.ts`) |
| `60f3ab83a`, `d481c9c40`, `495d1d2b6` | "Thêm việc con": agents, crew-web, hướng dẫn |
| `02756e5ee`, `f5f682ced`, `81a4c5ed2` | crew-web: ảnh trong bình luận/mô tả (chặn `data:` không an toàn), bình luận mới nhất ở trên, hướng dẫn |
| `dd1e4fcca` | agents: ảnh phải là file đính kèm, cấm base64 |
| `86abc46ab` | crew-web: sửa `pending-comments.test.tsx` theo thứ tự mới nhất trước |

Không đổi `package.json`, `pnpm-lock.yaml`, migration. Script ops dùng trên VPS trùng sha256 với repo.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-a2b2921ec` |
| Image sau | `crew-v3/paperclip:v3-86abc46ab` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261013-182619` (về `v3-a2b2921ec`) |
| Lui xa hơn | `rollback.sh 20261013-015546` (về `v3-a1660e3ac`) |
| Backup DB | `20261013-1825`, 414M, builtin ok (`backups/daily/paperclip-data-20261013-1825.tar.gz` 375M, `db-20261013-1825.dump` 58M) |
| Lưu ý rollback | Không migration nên lui thẳng được. Lui thì mất: loại Viết tài liệu, hộp xem đính kèm, Thêm việc con, ảnh/thứ tự bình luận, luật gate mới cho việc con board và PR integrator. Instruction agent đã áp (nếu quản đốc áp) sẽ nhắc tới tính năng không còn |

## 1. Đẩy nhánh

- Fork `paperclip-issues-ui`, nhánh `crew/project-access`, sạch, HEAD `86abc46ab6dd206a905e78e59efaf7a3f3eab942`; `dd1e4fcca` là tổ tiên.
- `git push origin <sha>:refs/heads/crew/v3.5`: `dd1e4fcca..86abc46ab`. Lần đầu báo `failed to push some refs` không rõ lý do, thử lại ngay thì ok (lần trước với `dd1e4fcca` cũng y vậy). Không push nhánh khác, không commit gì.

## 2. Cổng kiểm (worktree `paperclip-r3-dp`, detached `86abc46ab`, sạch)

- `verify.sh` FULL: dùng lại kết quả xanh của `dd1e4fcca` (15:5x, 4:39 phút: server 724/39 file, adapter 17/10/12, plugin 467/57, agents 158, tsc 0 lỗi, build plugin ok, không `require("react")` trần). `dd1e4fcca..86abc46ab` chỉ đổi một file test crew-web.
- `check-core-hooks.mjs`: `Hook một dòng: 5/5; vá lõi: 10; mục: 23; lỗi: 0`; test 13/13.
- ops `node --test crew/ops/*.test.mjs`: 115 pass, 0 fail.
- crew-web: `pnpm test` 161 file, 1495 pass, 1 todo; `typecheck` rc 0; `biome check src test e2e` sạch (586 file).
- Không chạy e2e.

## 3. Build, kiểm image, deploy

1. `overlay-source.sh 86abc46ab6dd206a905e78e59efaf7a3f3eab942` (`CREW_UI_COMMIT` = 40 hex): rc 0, `36 server files to transpile`. Bundle local `crew-ui=86abc46ab6dd…`.
2. `overlay-job.sh 86abc46ab`: `JOB_EXIT rc=0 min_avail=4932MiB tag=crew-v3/paperclip:v3-86abc46ab`.
3. `inspect-image.sh` rc 0: `heartbeat crewCoreHooks=2`, `environment-runtime crewCoreHooks=2`, `issues crewCoreHooks=3`, 17 dòng `crew/*.js ok`, `crew-ui=86abc46ab6dd…`, plugin UI gzip 109477, 6 adapter ok, không MISSING/FAIL; chỉ `WARNING host adapter check SKIPPED` như mọi lần.
4. Manifest `crew.core`: `v3-a2b2921ec` và `v3-86abc46ab` cùng `43f3560866b0`, tức không thêm capability.
5. Waiter: `ops/deploy-wait-86abc46ab.sh` (setsid nohup, pid 175070, log `ops/deploy-86abc46ab.log`). Cứ 2 giây gọi `active-runs.sh`; rỗng thì gọi `deploy.sh`, rc 2 thì chờ tiếp; hạn tới 06:00 14/10. Chạy từ 16:02:09, lúc đó `queued 1, running 2`. Chỉ một waiter (kiểm bằng `pgrep -af "^/bin/bash /opt/crew-v3-spike/ops/deploy-wait"`). Run về 0 lúc 18:25:27.
6. `deploy.sh crew-v3/paperclip:v3-86abc46ab` rc 0: backup `20261013-1825` ok (414M, builtin=ok), `plugin crew.core healthy`, `deploy ok: crew-v3/paperclip:v3-a2b2921ec -> crew-v3/paperclip:v3-86abc46ab, rollback TS=20261013-182619`, `DEPLOY_RC=0` 18:26:51. Waiter đã thoát.

## 4. Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `ok`, commit `86abc46ab6dd206a905e78e59efaf7a3f3eab942` |
| `plugin-state.sh` | `healthy` (18:27, 18:38) |
| `/` và `/paperclip/` | 200 / 200; `https://crew.2p-solutions.com/` 200 |
| `index.html` đang phục vụ | `crew-ui` = `86abc46ab6dd…`, entry `assets/index-yCfoBuWP.js`, css `index-b1k-uKDs.css` |
| Bundle đang phục vụ (đều 200) | `i18n-DyF65euC.js`: "Viết tài liệu" ×2, "Thêm việc con" ×1, "Chưa xem trước được loại file này trong trang" ×1, "Tải về" ×1; `guide-page-zqxSfOgw.js`: "Viết tài liệu" ×4, "Thêm việc con" ×4; `resume-CSgE5wGP.js`: "Thêm việc con"; `hooks-BeWyICHE.js`: `attachment-viewer-counter` (testid của hộp xem) |
| Log server 18:26:26 → 18:36:26 (663 dòng) | 623 dòng level 30, 0 dòng level 40. **8 dòng level 50**, đều `POST /api/plugins/crew.core/data/{crew.companies ×6, crew.roots, crew.setupRuns} 502 — No worker registered for plugin …`, cùng trong 18:26:45–18:26:46, tức ~20 giây sau khi container lên và trước khi worker plugin đăng ký xong. Sau đó không lặp lại; `plugin-state` healthy |
| Claim việc máy | 190 lần, tất cả 204 |

## An toàn

- Không in secret: log phân tích bằng script chỉ in level/msg/method/url/status. Không đọc key/cookie.
- Không ghi dữ liệu DB, không tạo API key, không DELETE environment, không áp instruction agent, không tạo nhãn. Không chạy e2e. Không `rm -rf` (chỉ `rm -f` file tạm em tạo trong `/tmp` trên VPS).
- Push duy nhất: `crew/v3.5`. Không commit gì.
- Không còn process em khởi tạo: mọi waiter VPS trong ngày (`40f54672a` ×2, `cbee2a632` đã dừng trước khi deploy; `86abc46ab` tự thoát sau deploy) và vòng theo dõi local đã xong.
- Worktree `paperclip-r3-dp` detached `86abc46ab`, sạch. Fork `paperclip-issues-ui` ở `86abc46ab`, sạch.

## Concern

- 8 lỗi 502 `No worker registered` ngay sau restart (UI gọi data plugin trước khi worker lên). Lần trước không có, nhưng chỉ kéo dài khoảng 1 giây và không lặp lại. Nên để ý ở lần deploy sau.
- Backup tăng từ 141M (`20261013-0155`) lên 414M (data tar 375M) chỉ trong 16 giờ, có thể do file đính kèm/ảnh. Nên theo dõi dung lượng đĩa.
- Push đầu tiên lên GitHub lỗi thoáng qua 2 lần liền (`dd1e4fcca`, `86abc46ab`), thử lại thì được.
- Rác trên VPS (không dùng): image `v3-781a5c3af`, `v3-40f54672a`, `v3-cbee2a632`, `ops/overlay-*.tar.gz` tương ứng, script/log `deploy-wait-*`. Dọn hay không tuỳ Đại Ca.

Status: DONE
Summary: Prod chạy `v3-86abc46ab` từ 18:26 (rollback `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261013-182619`). Health trả đúng commit, plugin healthy, bundle đang phục vụ có "Viết tài liệu", "Thêm việc con" và chuỗi hộp xem đính kèm, claim 190/190 là 204.
Concerns/Blockers: 8 lỗi 502 `No worker registered` trong ~1 giây ngay sau restart, rồi hết; backup tăng lên 414M.
