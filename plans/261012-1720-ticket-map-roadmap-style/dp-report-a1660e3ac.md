# DP: deploy `crew/v3.5` @ `a1660e3ac` (nút "Bắt đầu làm" cho yêu cầu nháp, bản đồ Crew ở chi tiết ticket vẽ kiểu Roadmap)

- Thời gian: 12/10/2026 17:43 → 18:06 (Asia/Ho_Chi_Minh). Người làm: agent.
- Kết quả: **DONE.** Prod chạy `crew-v3/paperclip:v3-a1660e3ac`, plugin `healthy`. Không có migration, không đổi dependency, manifest không thêm capability.
- Bản trước: `v3-833913393` (`plans/261012-1410-roadmap-map/dp-report-833913393.md`). Quy trình giống bản đó.
- Nội dung `833913393..a1660e3ac` (4 commit, 34 file): ngoài `packages/crew-web/` chỉ có 1 file test server mới `server/src/__tests__/crew-draft-start-work.db.test.ts`. Không đổi mã nguồn server, `crew/ops`, `crew/release`, `package.json`, `pnpm-lock.yaml`.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-833913393` |
| Image sau | `crew-v3/paperclip:v3-a1660e3ac` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261012-175515` (về `v3-833913393`) |
| Lui xa hơn | `rollback.sh 20261012-162246` (về `v3-6e249660b`, mất fix nhả lease SSH, xem report trước) |
| Backup DB | `20261012-1754`, 94M, builtin ok (`backups/daily/paperclip-data-20261012-1754.tar.gz`, `db-20261012-1754.dump`) |
| Lưu ý rollback | Không migration, server không đổi, nên lui thẳng; chỉ mất nút "Bắt đầu làm" và bản đồ kiểu mới |

## 1. Đẩy nhánh

- Fork `paperclip-issues-ui`, nhánh `crew/project-access` @ `a1660e3ac`. `merge-base --is-ancestor crew/v3.5 a1660e3ac` đúng → `git branch -f crew/v3.5 a1660e3ac…` (fast-forward `833913393 → a1660e3ac`).
- `git push origin crew/v3.5`: `833913393..a1660e3ac`. Không push nhánh khác.
- Các script trên VPS (`deploy.sh`, `active-runs.sh`, `overlay-job.sh`, `inspect-image.sh`, `inspect-adapters.mjs`, `rollback.sh`, `plugin-state.sh`) trùng sha256 với repo, không cần cài lại.

## 2. Cổng kiểm (worktree `paperclip-r3-dp`, `git checkout --detach a1660e3ac`, sạch)

- `crew/release/verify.sh` FULL: 4:34 phút, rc 0, **XANH**.
  - `check-core-hooks.mjs`: `Hook một dòng: 5/5; vá lõi: 9; mục: 22; lỗi: 0`; test của nó 13/13.
  - plugin-state 5/5, policy-config 10/10, upgrade/compose-set-image/pull-backup 18/18.
  - Server **708 test / 37 file** (trước 705/36: +3 test của file mới); adapter claude 17, codex 10, opencode 12; plugin 467 / 57 file; agents 138/138; tsc 0 lỗi (server, 3 adapter, plugin); build plugin ok; bundle không có `require("react")` trần.
  - Chạy riêng `crew-draft-start-work.db.test.ts` (verbose) để chắc nó không bị skip: 3/3 pass (owner, operator, PATCH todo lần hai không đánh thức thêm).
  - Không có test flaky đỏ, không phải chạy lại.
- ops `node --test crew/ops/*.test.mjs`: 107 pass, 0 fail.
- crew-web: `pnpm test` 150 file, 1361 pass, 1 todo; `typecheck` rc 0; `biome check src test e2e` sạch (560 file).
- Không chạy e2e.

## 3. Deploy

1. `overlay-source.sh a1660e3ac…` (script tự đặt `CREW_UI_COMMIT` = commit 40 hex khi build crew-web): rc 0, `35 server files to transpile` (như lần trước). Bundle local: `crew-ui=a1660e3acd313c7f7f5aa3b4f16a0e73f7537b04`, "Bắt đầu làm" và "Vòng sửa" có trong `roadmap-node-D4L2LPLp.js` và `guide-page-D5OX9fIz.js`.
2. `overlay-job.sh a1660e3ac`: `JOB_EXIT rc=0 min_avail=5139MiB tag=crew-v3/paperclip:v3-a1660e3ac`.
3. `inspect-image.sh crew-v3/paperclip:v3-a1660e3ac` rc 0: `heartbeat crewCoreHooks=2`, `environment-runtime crewCoreHooks=2`, `issues crewCoreHooks=3`, 17 dòng `crew/*.js ok`, `crew-ui=a1660e3acd313c7f7f5aa3b4f16a0e73f7537b04`, plugin UI gzip 109325 (y như trước), adapter P2–P7 ok, không MISSING/FAIL; chỉ `WARNING host adapter check SKIPPED` như mọi lần.
4. Manifest `crew.core` (sha256 của dòng `… manifest crew.core …`): `v3-833913393` và `v3-a1660e3ac` cùng `43f3560866b0` → không thêm capability. (Số băm khác con số `24b39e967f2a` ghi ở report trước chỉ vì cách cắt dòng khi băm; lần này băm cả hai image cùng một cách.)
5. `active-runs.sh` lúc 17:54:53: rỗng (0 run chạy/xếp hàng), nên deploy ngay, không cần vòng chờ.
6. `deploy.sh crew-v3/paperclip:v3-a1660e3ac` (log VPS `ops/deploy-a1660e3ac.log`): rc 0, backup `20261012-1754` ok, `plugin crew.core healthy`, `deploy ok: crew-v3/paperclip:v3-833913393 -> crew-v3/paperclip:v3-a1660e3ac, rollback TS=20261012-175515`. Container khởi động 10:55:22 UTC (17:55:22 giờ VN).

## 4. Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` (crew.2p-solutions.com) | `ok`, commit `a1660e3acd313c7f7f5aa3b4f16a0e73f7537b04` |
| `plugin-state.sh` | `healthy` (17:55, 18:06) |
| `/` và `/paperclip/` | 200 / 200 |
| `index.html` đang phục vụ | `crew-ui` = `a1660e3acd31…`, entry `assets/index-D5JUVzgD.js` (61 chunk) |
| Bundle đang phục vụ | `roadmap-node-D4L2LPLp.js` 200, có `startWork:{button:"Bắt đầu làm",sending:"Đang bắt đầu…"…}`, `draftBody:"Bấm Bắt đầu làm khi bạn muốn đội bắt đầu…"`, `round:"Vòng sửa {{round}}/{{max}}"`, `repair:"Vòng sửa"`; `guide-page-D5OX9fIz.js` cũng có cả hai chuỗi |
| Log server 17:55:22 → 18:05:22 (366 dòng) | 0 dòng level 50/60, 0 dòng chứa `error`. 5 dòng level 40, đều là 404 do bot quét từ ngoài (`POST /index.php` ×2, `POST /`, `POST /test.hello`, `GET /api/vendor/phpunit/…/eval-stdin.php`), không liên quan bản này |
| Claim việc máy (`/api/plugins/crew.core/api/machine-jobs/claim`) | 114 lần, tất cả 204 |

## 5. Kiểm prod chỉ đọc (yêu cầu `backlog`)

Truy vấn read-only `psql` trong `crew-v3-spike-db-1` (chỉ SELECT, không ghi):

| Company | Số issue `backlog` | Identifier |
|---|---|---|
| 2P Solutions | 1 | TPS-134 (tạo 10:20 UTC = 17:20 giờ VN) |
| Crew E2E | 0 | |
| Crew Spike Policy | 0 | |

Trước deploy (17:50) cũng đúng 1 (TPS-134). Em không bấm nút, không PATCH gì; phần thử nút "Bắt đầu làm" để quản đốc làm.

## An toàn

- Không in secret: phân tích log bằng script chỉ in level/msg/method/url/status, không in header. Không đọc key/cookie.
- Không `rm -rf` (chỉ `rm -f` file tạm `/tmp/insp-*.txt` do em tạo trên VPS, đã hết). Không DELETE environment, không ghi dữ liệu DB, không tạo API key, không sửa instruction agent. Không chạy e2e.
- Push duy nhất: `crew/v3.5`. Không commit gì.
- Không còn process nền em khởi tạo (verify, monitor, vòng chờ đều đã thoát).
- Worktree `paperclip-r3-dp` detached `a1660e3ac`, sạch. Fork `paperclip-issues-ui` ở `a1660e3ac`, sạch.

## Concern

- Không có concern mới. Concern cũ vẫn còn (không kiểm lại lần này): Mac mini lỗi gửi ảnh chụp docs (`c31226f9…`, `90c19d56…`), dòng migration rác `._0001_docs.sql` `failed`.

Status: DONE
Summary: Prod chạy `v3-a1660e3ac` (rollback `ops/rollback.sh 20261012-175515`), verify FULL xanh (có 3 test mới của Bắt đầu làm), health commit đúng, plugin healthy, `/` và `/paperclip/` 200, bundle có "Bắt đầu làm" và "Vòng sửa", claim 114/114 là 204, log 10 phút 0 lỗi. Backlog: 2P Solutions 1 (TPS-134), hai company còn lại 0.
