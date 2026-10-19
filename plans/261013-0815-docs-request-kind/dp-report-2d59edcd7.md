# DP: deploy `crew/v3.5` @ `2d59edcd7` (yêu cầu sửa ở stage owner không làm cũ bằng chứng docs)

- Thời gian: 13/10/2026 20:56 → 21:25 (Asia/Ho_Chi_Minh). Người làm: agent. Chờ run đang chạy từ 21:04:21 tới 21:13:00.
- Kết quả: **DONE.** Prod chạy `crew-v3/paperclip:v3-2d59edcd7` từ 21:14:00 (container start), plugin `healthy`. Không migration, không đổi dependency, manifest `crew.core` không đổi. Đã báo phiên chính ngay khi deploy xong (21:14:25, `DEPLOY_RC=0`).
- Bản trước: `v3-86abc46ab` (`dp-report-86abc46ab.md`).

## Nội dung `86abc46ab..2d59edcd7` (1 commit)

| Commit | Nội dung |
|---|---|
| `2d59edcd7` | `server/src/crew/issue-gate.ts`: yêu cầu sửa (`changes_requested`) ở stage sau stage docs (owner, push) không còn làm cũ bằng chứng docs; chỉ yêu cầu sửa ở stage docs hoặc trước nó mới tính. Thêm test DB `server/src/__tests__/crew-issue-gate.db.test.ts` |

Không đổi `package.json`, `pnpm-lock.yaml`, migration, crew-web hay plugin. Script ops trên VPS (`deploy.sh`, `rollback.sh`, `inspect-image.sh`, `active-runs.sh`, `overlay-job.sh`, `plugin-state.sh`, `inspect-adapters.mjs`) trùng sha256 với repo.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-86abc46ab` |
| Image sau | `crew-v3/paperclip:v3-2d59edcd7` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261013-211353` (về `v3-86abc46ab`) |
| Lui xa hơn | `rollback.sh 20261013-182619` (về `v3-a2b2921ec`), `rollback.sh 20261013-015546` (về `v3-a1660e3ac`) |
| Backup DB | `20261013-2113`, 432M, builtin ok (`backups/daily/paperclip-data-20261013-2113.tar.gz` 385M, `db-20261013-2113.dump` 67M) |
| Lưu ý rollback | Không migration nên lui thẳng được. Lui thì yêu cầu sửa ở stage owner lại làm cũ bằng chứng docs như trước |

## 1. Đẩy nhánh

- Fork `paperclip-issues-ui`, nhánh `crew/project-access`, sạch, HEAD `2d59edcd71bcaac14d61ffa8ee195afc21c138fd`; `86abc46ab` là tổ tiên.
- `git push origin <sha>:refs/heads/crew/v3.5`: `86abc46ab..2d59edcd7`, lần đầu đã được (không lỗi thoáng qua như hai lần trước). `ls-remote` xác nhận `crew/v3.5` = `2d59edcd7…`. Không push nhánh khác, không commit gì.

## 2. Cổng kiểm (worktree `paperclip-r3-dp`, detached `2d59edcd7`, sạch)

- `verify.sh` FULL: **XANH**, 20:56:57 → 21:02:00 (5:03 phút). Server 726 test / 39 file (trước 724, thêm test DB mới), adapter claude 17/3, codex 10/2, opencode 12/3, plugin 467/57, agents 158, `tsc --noEmit` 5 package 0 lỗi, build plugin ok, không `require("react")` trần.
- `check-core-hooks.mjs` (bước đầu của verify): `Hook một dòng: 5/5; vá lõi: 10; mục: 23; lỗi: 0`; test 13/13.
- ops `node --test crew/ops/*.test.mjs`: 115 pass, 0 fail.
- crew-web: `pnpm test` 161 file, 1495 pass, 1 todo; `typecheck` rc 0; `biome check src test e2e` sạch (586 file).
- Không chạy e2e.

## 3. Build, kiểm image, deploy

1. `overlay-source.sh 2d59edcd71bcaac14d61ffa8ee195afc21c138fd` (`CREW_UI_COMMIT` = 40 hex): rc 0, `36 server files to transpile`. Bundle local `crew-ui=2d59edcd71bc…`.
2. `overlay-job.sh 2d59edcd7`: `JOB_EXIT rc=0 min_avail=4861MiB tag=crew-v3/paperclip:v3-2d59edcd7` (nhanh, khoảng 1 phút dù build cache đã prune).
3. `inspect-image.sh` rc 0: `heartbeat crewCoreHooks=2`, `environment-runtime crewCoreHooks=2`, `issues crewCoreHooks=3`, `plugin events delivered as call ok`, 17 dòng `crew/*.js ok`, 6 adapter ok, `crew-ui=2d59edcd71bc…`, plugin UI gzip 109477, không MISSING/FAIL; chỉ `WARNING host adapter check SKIPPED` như mọi lần.
4. Manifest `crew.core` (import `dist/manifest.js` trong image, sha256 của JSON): `v3-a2b2921ec`, `v3-86abc46ab`, `v3-2d59edcd7` cùng `315343410596`, capabilities 28, hash capabilities cùng `7ca03b0ae4df`, tức không thêm capability. (Cách băm khác lần trước nên số khác `43f3560866b0`; so sánh cùng cách thì ba image trùng nhau.)
5. Waiter: `ops/deploy-wait-2d59edcd7.sh` (chép từ waiter `86abc46ab`, chỉ đổi tag; setsid nohup, pid 620587, log `ops/deploy-2d59edcd7.log`). Cứ 2 giây gọi `active-runs.sh`; rỗng thì gọi `deploy.sh`, rc 2 thì chờ tiếp; hạn tới 06:00 14/10. Chạy từ 21:04:21 khi còn 1 run. Chỉ một waiter (kiểm bằng `ps`; shell bọc ssh còn treo, pid 620585, em đã `kill -TERM`, waiter không bị ảnh hưởng). Run về 0 lúc 21:13:00.
6. `deploy.sh crew-v3/paperclip:v3-2d59edcd7` rc 0: backup `20261013-2113` ok (432M, builtin=ok), `plugin crew.core healthy`, `deploy ok: crew-v3/paperclip:v3-86abc46ab -> crew-v3/paperclip:v3-2d59edcd7, rollback TS=20261013-211353`, `DEPLOY_RC=0` 21:14:25. Waiter đã thoát.

## 4. Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `ok`, commit `2d59edcd71bcaac14d61ffa8ee195afc21c138fd` |
| `plugin-state.sh` | `healthy` (21:15, 21:24) |
| Container | `running`, restarts 0 |
| `/` và `/paperclip/` | 200 / 200; `https://crew.2p-solutions.com/` 200; `index.html` có `crew-ui` = `2d59edcd71bc…` |
| Bản vá trong container | `/app/server/dist/crew/issue-gate.js` có `afterDocsStageIds` (2 chỗ) |
| Log server 21:14:00 → 21:24:00 (1481 dòng) | 1413 dòng level 30, 20 dòng level 40, 14 dòng level 50 (chi tiết dưới) |
| Claim việc máy | 189 lần: 188 là 204, **1 là 503** lúc 21:14:20 (lúc worker plugin chưa đăng ký, xem dưới) |

Chi tiết log level 40/50:

- 13 dòng level 50 `POST /api/plugins/crew.core/data/{crew.companies ×7, crew.roots ×2, crew.setupRuns ×2, crew.map, crew.runtimeDecisions, crew.docsCheck} 502 — No worker registered for plugin …` trong 21:14:18–21:14:19, cùng hiện tượng lần trước (lần trước 8 dòng): UI gọi data plugin trước khi worker đăng ký xong. Sau đó không lặp lại.
- 1 dòng level 50 `POST /machine-jobs/claim 503` lúc 21:14:20, cùng nguyên nhân khởi động. Mọi claim sau đó 204.
- 9 dòng level 40 404 kiểu quét bot (`/_next/server-components`, `/_next/redirect`, `/_next/rsc`, `/_next/refresh`, `/_react/flight`, `/account`, `/sign-in`, `POST /api` ×2) trong 21:14:19–21:14:29. Không liên quan bản deploy.
- 1 dòng level 40 `periodic heartbeat recovery changed assigned issue state` 21:14:57 (hồi phục sau restart).
- 10 dòng level 40 `/mcp/runtime-tools` 404 ×3, 409 ×4 và `GET /api/mcp/project-tools` 404 ×3, trong 21:15:03–21:18:37, thuộc run agent đang chạy. Lần trước không có run trong cửa sổ log nên không có so sánh; bản vá chỉ đổi `issue-gate.ts`, không chạm route MCP.

## An toàn

- Không in secret: log phân tích bằng script chỉ in level/msg/method/url/status, id thay bằng `<id>`. Không đọc key/cookie.
- Không ghi dữ liệu DB, không tạo API key, không DELETE environment, không áp instruction agent, không bình luận issue. Không chạy e2e. Không `rm -rf` (chỉ `rm -f` script tạm `/tmp/loga-2d59.py`, `/tmp/inspect-2d59.out` em tạo trên VPS).
- Push duy nhất: `crew/v3.5`. Không commit gì.
- Không còn process em khởi tạo: waiter VPS tự thoát sau deploy, shell bọc ssh đã dừng, vòng theo dõi local đã xong.
- Worktree `paperclip-r3-dp` detached `2d59edcd7`, sạch. Fork `paperclip-issues-ui` ở `2d59edcd7`, sạch.

## Concern

- Lỗi khởi động lặp lại và nhiều hơn lần trước: 13 lỗi 502 `No worker registered` (trước 8) và lần này có 1 claim máy 503, đều trong khoảng 2 giây sau khi container lên. Tự hết, nhưng nên cho deploy chờ worker plugin trước khi nhận traffic hoặc cho UI/daemon thử lại.
- 10 dòng 404/409 `/mcp/runtime-tools`, `/api/mcp/project-tools` từ run agent đang chạy. Không do bản này, nhưng chưa rõ có phải lỗi sẵn có không; nên xem nếu agent báo thiếu tool.
- Backup tiếp tục tăng: 414M (18:25) lên 432M (21:13).
- Rác trên VPS như lần trước, thêm `ops/overlay-2d59edcd7.tar.gz`, `ops/overlay-job-2d59edcd7.out`, `ops/deploy-wait-2d59edcd7.sh`. Dọn hay không tuỳ Đại Ca.

Status: DONE
Summary: Prod chạy `v3-2d59edcd7` từ 21:14 (rollback `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261013-211353`). Health trả đúng commit, plugin healthy, trang 200, bản vá `issue-gate` có trong container, claim 188/189 là 204.
Concerns/Blockers: 13 lỗi 502 `No worker registered` và 1 claim 503 trong ~2 giây ngay sau restart rồi hết; vài 404/409 `/mcp/runtime-tools` từ run agent, không liên quan bản vá.
