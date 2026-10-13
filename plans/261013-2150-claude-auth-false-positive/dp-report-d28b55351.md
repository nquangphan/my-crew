# DP: deploy `crew/v3.5` @ `d28b55351` (sửa nhãn `claude_auth_required` sai, chờ worker plugin khi khởi động, backoff lỗi Claude, owner yêu cầu sửa chạy lại từ reviewer)

- Thời gian: 13/10/2026 22:07 → 22:58 (Asia/Ho_Chi_Minh). Người làm: agent. Waiter chờ run đang chạy từ 22:16:07 tới 22:46:00.
- Kết quả: **DONE.** Prod chạy `crew-v3/paperclip:v3-d28b55351` từ 22:47:03 (container start), plugin `healthy`, migration plugin `0017_runtime_retries.sql` `applied`. Manifest `crew.core` không đổi, không thêm capability. Đã báo phiên chính ngay sau khi deploy xong (22:48, `DEPLOY_RC=0` lúc 22:47:28).
- Bản trước: `v3-2d59edcd7` (`plans/261013-0815-docs-request-kind/dp-report-2d59edcd7.md`).

## Nội dung `2d59edcd7..d28b55351` (5 commit)

| Commit | Nội dung |
|---|---|
| `9529157c1` | `server/src/crew/issue-gate.ts`: owner yêu cầu sửa ở stage duyệt thì issue gốc chạy lại từ reviewer (hook H2), ghi `crew.gate.owner_changes_restart`; test `crew-issue-gate*.test.ts` |
| `a057f68f7` | Docs agent `assistant.md`, `integrator.md` (+ fixture render) |
| `706ac5b4d` | Plugin: `runtimes/claude-retry.ts`, `fallback.ts`, đánh thức lại issue lỗi đăng nhập/engine Claude theo backoff. **Migration plugin `0017_runtime_retries.sql`** (chỉ tạo bảng mới `crew_runtime_retries` + index) |
| `3ae84a0a0` | `server/src/crew/plugin-startup-wait.ts` (mới), mount trong `contribution-routes.ts`: request `/api/plugins/...` trong lúc nạp plugin khởi động (tối đa 10 giây) chờ worker đăng ký. C7 trong `core-hooks.json`; `inspect-image.sh` kiểm thêm `plugin-startup-wait` |
| `d28b55351` | Vá adapter P9 `packages/adapters/claude-local/src/server/parse.ts`: run Claude `success`/`is_error=false` không bị gắn `claude_auth_required`; test `parse.auth.crew.test.ts`, thêm vào `verify.sh` |

Không đổi `package.json`, `pnpm-lock.yaml`. Có đổi crew-web (`history-format.ts`, locale, guide).

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-2d59edcd7` |
| Image sau | `crew-v3/paperclip:v3-d28b55351` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261013-224654` (về `v3-2d59edcd7`) |
| Lui xa hơn | `rollback.sh 20261013-211353` (về `v3-86abc46ab`), `rollback.sh 20261013-182619` (về `v3-a2b2921ec`) |
| Backup DB | `20261013-2246`, 456M tổng, builtin ok (`paperclip-data-20261013-2246.tar.gz` 390M, `db-20261013-2246.dump` 66M) |

**Migration và rollback:** lui thẳng được, không cần thao tác DB. `0017` chỉ `CREATE TABLE`/`CREATE INDEX` trong schema plugin, không sửa bảng cũ. Runner migration plugin (`server/src/services/plugin-database.ts`) chỉ duyệt các file trong bundle, nên image cũ (bundle tới `0016`) bỏ qua dòng `0017` trong `plugin_migrations` và không đụng bảng `crew_runtime_retries`. Bảng đó nằm lại, không ai dùng. Khi deploy lại bản có `0017`, migration đã `applied` cùng checksum nên được bỏ qua. Lui về thì mất backoff Claude, mất H2 chạy lại từ reviewer, mất chờ worker khi khởi động và nhãn `claude_auth_required` sai quay lại.

## 1. Đẩy nhánh

- Fork `paperclip-issues-ui`, nhánh `crew/project-access`, sạch, HEAD `d28b5535145b43a2130fabdd24e780b2d31adbc0`; `origin/crew/v3.5` (`2d59edcd7`) là tổ tiên.
- `git push origin <sha>:refs/heads/crew/v3.5` lúc 22:07:15: `2d59edcd7..d28b55351`, lần đầu đã được. `ls-remote` xác nhận `crew/v3.5` = `d28b5535…`. Không push nhánh khác, không commit gì.

## 2. Cổng kiểm (worktree `paperclip-r3-dp`, detached `d28b55351`, sạch)

- `verify.sh` FULL: **XANH**, 22:07:39 → 22:14:04 (6:25 phút). `check-core-hooks` 5/5, test 13/13; ops plugin-state/policy-config/upgrade 5/10/18; server 736 test / 40 file (trước 726/39); adapter claude 25/4 (trước 17/3, thêm `parse.auth.crew.test.ts`), codex 10/2, opencode 12/3; plugin 473/57 (trước 467); agents 158; `tsc --noEmit` 5 package 0 lỗi; build plugin ok; không `require("react")` trần.
- `check-core-hooks.mjs`: `Hook một dòng: 5/5; vá lõi: 10; mục: 24; lỗi: 0` (trước 23 mục; thêm P9, C7 đổi mô tả và thêm test `crew-plugin-startup-wait.test.ts`). Chỉ cảnh báo "chưa có PR upstream" như mọi lần.
- ops `node --test crew/ops/*.test.mjs`: 115 pass, 0 fail.
- crew-web: `pnpm test` 161 file, 1496 pass, 1 todo (trước 1495); `typecheck` rc 0; `biome check src test e2e` sạch (586 file).
- Không chạy e2e.

## 3. Build, kiểm image, deploy

1. `overlay-source.sh d28b5535145b43a2130fabdd24e780b2d31adbc0` (`CREW_UI_COMMIT` = 40 hex): rc 0, `37 server files to transpile` (trước 36, thêm `plugin-startup-wait`). Bundle local `crew-ui=d28b5535145b…`.
2. `overlay-job.sh d28b55351`: `JOB_EXIT rc=0 min_avail=4994MiB tag=crew-v3/paperclip:v3-d28b55351` (22:15:29 → 22:15:41).
3. Script ops VPS: so sha256 với fork, chỉ `inspect-image.sh` lệch (đúng như commit `3ae84a0a0`). Sao lưu bản cũ thành `ops/inspect-image.sh.bak-2d59edcd7`, chép bằng `scp -p`; sha256 trùng fork (`f7c5c874…`). 20 script còn lại trùng.
4. `inspect-image.sh crew-v3/paperclip:v3-d28b55351` rc 0: `heartbeat crewCoreHooks=2`, `environment-runtime crewCoreHooks=2`, `issues crewCoreHooks=3`, `plugin events delivered as call ok`, 18 dòng `crew/*.js ok` (trước 17) gồm **`crew/plugin-startup-wait.js ok`**, adapter P2–P7 ok và **`adapter P9 packages/adapters/claude-local/src/server/parse.ts ok (sha256 73b0fd16ae14, anchor 1x)`**, `crew-ui=d28b5535145b…`, plugin UI gzip 109477. Không MISSING/FAIL; chỉ `WARNING host adapter check SKIPPED` như mọi lần.
5. Manifest `crew.core` (import `dist/manifest.js` trong image, cùng cách băm lần trước): `v3-2d59edcd7` và `v3-d28b55351` cùng `315343410596`, capabilities 28, hash capabilities cùng `7ca03b0ae4df`. **Không đổi capability.** Image mới có thêm `migrations/0017_runtime_retries.sql`.
6. Waiter: `ops/deploy-wait-d28b55351.sh` (chép từ waiter `2d59edcd7`, chỉ đổi tag và hạn tới **07:00 14/10**; setsid nohup, pid 695375, log `ops/deploy-d28b55351.log`). Cứ 2 giây gọi `active-runs.sh`; rỗng thì gọi `deploy.sh`, rc 2 thì chờ tiếp. Chạy từ 22:16:07 khi còn 1 run. Chỉ một waiter (kiểm `pgrep`). Run về 0 lúc 22:46:00.
7. `deploy.sh crew-v3/paperclip:v3-d28b55351` rc 0: inspect lại trong deploy ok, backup `20261013-2246` ok (456M, builtin=ok), `plugin crew.core healthy`, `deploy ok: crew-v3/paperclip:v3-2d59edcd7 -> crew-v3/paperclip:v3-d28b55351, rollback TS=20261013-224654`, `DEPLOY_RC=0` 22:47:28. Waiter đã thoát.

## 4. Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` (public) | `ok`, commit `d28b5535145b43a2130fabdd24e780b2d31adbc0` |
| `plugin-state.sh` | `healthy` (22:48, 22:57) |
| Container | `running`, restarts 0 |
| `plugin_migrations` | `0017_runtime_retries.sql` `applied` lúc 15:47:23 UTC (22:47 VN); 0016, 0015 vẫn `applied`. Bảng `plugin_crew_core_0433ea20b6.crew_runtime_retries` có |
| `/` và `/paperclip/` | 200 / 200; `https://crew.2p-solutions.com/` 200, `crew-ui` = `d28b5535145b…` |
| Bản vá trong container | `/app/server/dist/crew/plugin-startup-wait.js` có; adapter claude-local chạy từ `src/` (image không có `dist/`), `parse.ts` có `isClaudeSuccessResult`, sha khớp P9 |
| Log server 22:47:00 → 22:57:03 (1480 dòng) | 1441 dòng level 30, **5 dòng level 40, 0 dòng level 50** |
| `No worker registered` 502 | **0** (lần trước 13, lần trước nữa 8) |
| Claim việc máy | 186 lần, **186 là 204** (lần trước 1 lần 503 lúc khởi động) |

Chi tiết 5 dòng level 40:

- 22:47:59 `periodic heartbeat recovery changed assigned issue state` (hồi phục sau restart, như lần trước).
- 22:48:04 `POST /mcp/runtime-tools 404`, 22:48:05 `GET /api/mcp/project-tools 404`, 22:56:24–22:56:25 `GET /mcp/runtime-tools 403` ×2: từ run agent, cùng loại như lần trước (lần trước 10 dòng 404/409). Bản này không chạm route MCP.
- Không có 404 quét bot trong cửa sổ này.

## An toàn

- Không in secret: log phân tích bằng script chỉ in level/msg/method/url/status, id thay bằng `<id>`. Không đọc key/cookie.
- Không ghi dữ liệu DB (chỉ `SELECT`; bảng mới do migration của deploy tạo), không tạo API key, không DELETE environment, không áp instruction agent, không bình luận issue. Không chạy e2e. Không `rm -rf` (chỉ `rm -f` script tạm `/tmp/loga-d28b.py`, `/tmp/inspect-d28b.out` em tạo trên VPS).
- Push duy nhất: `crew/v3.5`. Không commit gì.
- Không còn process em khởi tạo: waiter VPS tự thoát sau deploy, monitor/vòng chờ local đã dừng.
- Worktree `paperclip-r3-dp` detached `d28b55351`, sạch. Fork `paperclip-issues-ui` ở `d28b55351`, sạch.

## Concern

- Lúc deploy xong (22:47:50) có 1 run `scheduled_retry` của 2P Solutions, tới 22:57 là 1 run `queued`. Không rõ là retry sinh từ restart hay từ backoff mới; không ảnh hưởng deploy, nhưng nên để ý run này có chạy tiếp bình thường không.
- 404/403 `/mcp/runtime-tools`, `/api/mcp/project-tools` từ run agent vẫn còn (không do bản này).
- Backup tiếp tục tăng: 432M (21:13) lên 456M (22:46).
- Rác thêm trên VPS: `ops/overlay-d28b55351.tar.gz`, `ops/overlay-job-d28b55351.out`, `ops/deploy-wait-d28b55351.sh`, `ops/inspect-image.sh.bak-2d59edcd7`. Dọn hay không tuỳ Đại Ca.

Status: DONE
Summary: Prod chạy `v3-d28b55351` từ 22:47 (rollback `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261013-224654`, lui thẳng được dù có migration). Health đúng commit, plugin healthy, `0017` applied, trang 200, claim 186/186 là 204, 0 lỗi `No worker registered` sau khởi động.
Concerns/Blockers: 1 run 2P Solutions chuyển `scheduled_retry` rồi `queued` sau restart, nên theo dõi; vài 404/403 MCP từ run agent như trước.
