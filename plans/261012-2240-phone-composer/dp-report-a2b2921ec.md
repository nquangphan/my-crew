# DP: deploy `crew/v3.5` @ `a2b2921ec` (ô bình luận điện thoại, phát lại wake reviewer bị bỏ, ảnh nghiệm thu, form Tạo agent)

- Thời gian: 12/10/2026 22:46 → 13/10/2026 02:08 (Asia/Ho_Chi_Minh). Người làm: agent. Chờ run đang chạy từ 23:05 tới 01:55:24.
- Kết quả: **DONE.** Prod chạy `crew-v3/paperclip:v3-a2b2921ec`, plugin `healthy`. Không migration, không đổi dependency, manifest không thêm capability.
- Bản trước: `v3-a1660e3ac` (`plans/261012-1720-ticket-map-roadmap-style/dp-report-a1660e3ac.md`). Quy trình giống bản đó.
- Đổi mục tiêu giữa chừng: ban đầu deploy `781a5c3af` (chỉ web). Quản đốc đổi sang `b8d148b16` rồi `a2b2921ec`. Vòng chờ deploy `781a5c3af` trên VPS bị em dừng lúc 23:56 (16:56:14Z) **trước khi** gọi `deploy.sh`; prod lúc đó vẫn là `v3-a1660e3ac`. Image `crew-v3/paperclip:v3-781a5c3af` đã build nhưng không dùng (để lại trên VPS). Không deploy `b8d148b16` riêng vì thiếu commit fixture thì 2 test crew-web đỏ.

## Nội dung `a1660e3ac..a2b2921ec` (7 commit)

| Commit | Nội dung |
|---|---|
| `781a5c3af` | crew-web: ô soạn bình luận ở chi tiết ticket không dính đáy dưới `md` (điện thoại), hết che bản đồ Crew |
| `3efda862b` | server: phát lại wake reviewer bị bỏ khi lease nhả ngoài hook H3 (`server/src/crew/handoff-rewake.ts`, vòng quét định kỳ), vá lõi C10 ở `server/src/index.ts`, `crew/release/core-hooks.json` |
| `5d1b2df3f` | crew-web: dialog mô tả dài vẫn cuộn tới nút Tạo |
| `b8d148b16` | `crew/agents/executor.md`, `reviewer.md`: executor chỉ chạy test liên quan, phải đính "Ảnh nghiệm thu"; reviewer kiểm ảnh (web nhúng làm template) |
| `43b2e6f2c` | crew-web: environment SSH của agent chép mẫu đúng máy đã chọn |
| `ce5e426c3` | crew-web: form Tạo agent tự điền máy và folder repo |
| `a2b2921ec` | crew-web: sinh lại fixture render executor/reviewer |

Ngoài `packages/crew-web/` chỉ đổi: `crew/agents/{executor,reviewer}.md`, `crew/release/core-hooks.json`, `server/src/crew/handoff-rewake.ts`, `server/src/index.ts`, test mới `server/src/__tests__/crew-handoff-rewake-sweep.db.test.ts`. Không đổi `package.json`, `pnpm-lock.yaml`, migration.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-a1660e3ac` |
| Image sau | `crew-v3/paperclip:v3-a2b2921ec` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261013-015546` (về `v3-a1660e3ac`) |
| Lui xa hơn | `rollback.sh 20261012-175515` (về `v3-833913393`) |
| Backup DB | `20261013-0155`, 141M, builtin ok (`backups/daily/paperclip-data-20261013-0155.tar.gz`) |
| Lưu ý rollback | Không migration nên lui thẳng. Lui thì mất vòng quét phát lại wake reviewer (C10), ô bình luận lại dính đáy trên điện thoại, mất các sửa form/dialog. Activity `crew.handoff_rewake` đã ghi vẫn hợp lệ với bản cũ |

## 1. Đẩy nhánh

- Fork `paperclip-issues-ui`, nhánh `crew/project-access`. `merge-base --is-ancestor crew/v3.5 <đích>` đúng cả hai lần.
- `git push origin crew/v3.5`: `a1660e3ac..781a5c3af` (22:46), rồi `781a5c3af..a2b2921ec` (23:56). Không push nhánh khác, không commit gì.
- Script trên VPS (`deploy.sh`, `active-runs.sh`, `overlay-job.sh`, `inspect-image.sh`, `inspect-adapters.mjs`, `rollback.sh`, `plugin-state.sh`) trùng sha256 với repo (các commit mới không đổi `crew/ops`). `inspect-image.sh` đã có sẵn `handoff-rewake` trong vòng kiểm.
- Lúc build `781a5c3af`, worktree fork có thay đổi chưa commit của agent khác (`server/src/crew/handoff-rewake.ts`…) nên `overlay-source.sh` từ chối; em build từ worktree sạch `paperclip-r3-dp` (script tự lấy worktree chứa nó). Bản `a2b2921ec` cũng build ở `paperclip-r3-dp`, detached, sạch.

## 2. Cổng kiểm (worktree `paperclip-r3-dp`, `git checkout --detach a2b2921ec…`, sạch)

- `crew/release/verify.sh` FULL: 4:50 phút, rc 0, **XANH**.
  - `check-core-hooks.mjs`: `Hook một dòng: 5/5; vá lõi: 10; mục: 23; lỗi: 0` (+1 vá lõi C10, +1 mục); test của nó 13/13.
  - plugin-state 5/5, policy-config 10/10, upgrade/compose-set-image/pull-backup 18/18.
  - Server **713 test / 38 file** (trước 708/37: +5 test của file mới); adapter claude 17, codex 10, opencode 12; plugin 467 / 57 file; agents 138/138; tsc 0 lỗi; build plugin ok; bundle không có `require("react")` trần.
  - Chạy riêng `crew-handoff-rewake-sweep.db.test.ts` (verbose): 5/5 pass, không skip (TPS-133 được đánh thức đúng một lần; issue kẹt lâu được cứu ở tick đầu; không phát lại khi lease còn giữ / stage đổi / issue bị chặn / reviewer đã có run / wake của recovery).
  - Không có test flaky đỏ, không chạy lại.
- ops `node --test crew/ops/*.test.mjs`: 107 pass, 0 fail.
- crew-web: `pnpm test` 154 file, 1399 pass, 1 todo; `typecheck` rc 0; `biome check src test e2e` sạch (567 file).
- (Bản `781a5c3af` trước đó cũng đã qua verify FULL 5:42 phút xanh, 708/37; crew-web 151 file 1363 pass.)
- Không chạy e2e.

## 3. Deploy

1. `overlay-source.sh a2b2921ecc1c2be5b4d3cc04561cf6e2b3c2e609` (script đặt `CREW_UI_COMMIT` = commit 40 hex): rc 0, `36 server files to transpile` (trước 35: +`handoff-rewake`). Bundle local `crew-ui=a2b2921ecc1c2be5b4d3cc04561cf6e2b3c2e609`; "Ảnh nghiệm thu" trong `resume-CYWDOznA.js`; class `md:sticky md:bottom-0 md:z-10` trong `hooks-JH3vAmBw.js`.
2. `overlay-job.sh a2b2921ec`: `JOB_EXIT rc=0 min_avail=5041MiB tag=crew-v3/paperclip:v3-a2b2921ec`.
3. `inspect-image.sh crew-v3/paperclip:v3-a2b2921ec` rc 0: `heartbeat crewCoreHooks=2`, `environment-runtime crewCoreHooks=2`, `issues crewCoreHooks=3`, 17 dòng `crew/*.js ok` (có `crew/handoff-rewake.js ok`), `crew-ui=a2b2921ecc1c…`, plugin UI gzip 109325, adapter ok, không MISSING/FAIL; chỉ `WARNING host adapter check SKIPPED` như mọi lần. Kiểm thêm trong image: `replayStrandedSkippedWakes` có trong `server/dist/index.js` (2) và `server/dist/crew/handoff-rewake.js` (2), tức vá C10 đã vào.
4. Manifest `crew.core` (sha256 dòng `manifest crew.core`, băm cùng cách): `v3-a1660e3ac` và `v3-a2b2921ec` cùng `43f3560866b0` → không thêm capability.
5. `active-runs.sh` lúc 00:03: `queued 3, running 1`. Vòng chờ trên VPS (setsid nohup, log `ops/deploy-a2b2921ec.log`): 2 giây gọi `active-runs.sh`, rỗng thì `deploy.sh` (rc 2 thì chờ tiếp), giới hạn 3 giờ. Rỗng lúc 01:55:24.
6. `deploy.sh crew-v3/paperclip:v3-a2b2921ec` rc 0: backup `20261013-0155` ok (141M, builtin=ok), `plugin crew.core healthy`, `deploy ok: crew-v3/paperclip:v3-a1660e3ac -> crew-v3/paperclip:v3-a2b2921ec, rollback TS=20261013-015546`. Container khởi động 18:55:53Z (01:55:53 giờ VN). Vòng chờ đã thoát.

## 4. Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `ok`, commit `a2b2921ecc1c2be5b4d3cc04561cf6e2b3c2e609` |
| `plugin-state.sh` | `healthy` (01:56, 02:07) |
| `/` và `/paperclip/` | 200 / 200 |
| `index.html` đang phục vụ | `crew-ui` = `a2b2921ecc1c…`, entry `assets/index-VdRkfaxQ.js`, css `index-BVM20n4D.css` |
| Bundle đang phục vụ | `resume-CYWDOznA.js` 200, có "Ảnh nghiệm thu" (2 chỗ); `hooks-JH3vAmBw.js` có `md:sticky md:bottom-0 md:z-10`; css có `md\:sticky` |
| Log server 01:55:53 → 02:05:53 (1931 dòng) | 0 dòng level 50/60, 0 dòng chứa `error` (kể cả 233 dòng không phải JSON). 12 dòng level 40, đều là phiên MCP cũ sau restart: `/mcp/runtime-tools` 404 ×4, 409 ×2, 403 ×2; `/api/mcp/project-tools` 404 ×4 (lần trước cũng có 404/409 kiểu này; 403 là mới nhưng cùng nhóm phiên cũ) |
| Vòng quét mới | 2 dòng `crew: replayed a stranded skipped wake` (level 30), không có lỗi hay `crew.handoff_rewake.failed` |
| Claim việc máy | 113 lần, tất cả 204 |

## 5. Activity `crew.handoff_rewake` (SQL chỉ đọc, `default_transaction_read_only=on`)

- Trước deploy (00:03): 76 dòng `crew.handoff_rewake` từ đường H3 cũ, mới nhất 16:57:13Z. TPS-133 `in_review`.
- Sau deploy (tính từ 18:55:53Z):

| Giờ VN | source | Issue | Trạng thái issue lúc 02:07 |
|---|---|---|---|
| 01:56:48 | `sweep` (vòng quét mới, `execution_review_requested`) | TPS-133 | `done` (cập nhật 01:57:55) |
| 01:56:48 | `sweep` (`execution_review_requested`) | TPS-138 | `in_progress` |
| 02:01:34 | `lease_release` (đường H3, `execution_changes_requested`) | TPS-138 | `in_progress` |

- `crew.handoff_rewake.failed` sau deploy: 0.
- TPS-133 đúng là bị phát lại ở tick đầu (không ai huỷ trước); reviewer chạy và issue sang `done` lúc 01:57:55. Em không đụng gì thêm.

## An toàn

- Không in secret: log phân tích bằng script chỉ in level/msg/method/url/status. Không đọc key/cookie.
- Không `rm -rf` của em (chỉ `rm -f` file tạm `/tmp/insp-*.txt`, `/tmp/crew-q-ro.sql`, `/tmp/crew-loga.py` do em tạo trên VPS, đã hết). Không DELETE environment, không ghi dữ liệu DB (mọi SQL chỉ SELECT trong phiên read-only), không tạo API key, không sửa instruction agent. Không chạy e2e.
- Push duy nhất: `crew/v3.5`. Không commit gì.
- Không còn process em khởi tạo: hai vòng chờ trên VPS đã thoát (vòng `781a5c3af` bị dừng bằng SIGTERM, ghi `STOPPED_BY_OPERATOR` vào `ops/deploy-781a5c3af.log`), các vòng đợi local đã xong/dừng.
- Worktree `paperclip-r3-dp` detached `a2b2921ec`, sạch. Fork `paperclip-issues-ui` ở `a2b2921ec`, sạch.

## Concern

- TPS-133 bị vòng quét phát lại ngay tick đầu như dự đoán, và đã `done`.
- Image thừa `crew-v3/paperclip:v3-781a5c3af` và file `ops/overlay-781a5c3af.tar.gz` còn trên VPS (không dùng; dọn hay không tuỳ Đại Ca).
- 2 lần 403 ở `/mcp/runtime-tools` sau restart là kiểu mới (trước chỉ thấy 404/409), mức warn, có vẻ là phiên MCP cũ; nên để ý nếu lặp lại.
- Concern cũ vẫn còn (không kiểm lại lần này): Mac mini lỗi gửi ảnh chụp docs, dòng migration rác `._0001_docs.sql` `failed`.

Status: DONE
Summary: Prod chạy `v3-a2b2921ec` (rollback `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261013-015546`), verify FULL xanh (10 vá lõi, 713 test server), health commit đúng, plugin healthy, `/` và `/paperclip/` 200, bundle có "Ảnh nghiệm thu", claim 113/113 là 204, log 10 phút 0 lỗi. Vòng quét mới phát lại TPS-133 (giờ `done`) và TPS-138, 0 lần lỗi.
