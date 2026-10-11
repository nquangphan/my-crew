# DP-2: deploy `crew/guest-approval` @ `286820b18` và chạy lại T2

- Thời gian: 11/10/2026 12:38 → 13:05 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent.
- Kết quả: **DONE.** Prod chạy `crew-v3/paperclip:v3-286820b18`. T2 đầy đủ xanh, `agent-permissions.sh --check` xanh cho cả 2 company Crew.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-33d7e2242` (tag `crew/v3.4`) |
| Image sau | `crew-v3/paperclip:v3-286820b18` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261011-124356` (về `v3-33d7e2242`) |
| Backup DB | `20261011-1243` (do `deploy.sh` tự tạo, 37M, builtin ok) |
| Backup compose | `docker-compose.yml.bak-20261011-124356`; ghi image cũ ở `ops/previous-image-20261011-124356` |
| Script ops VPS | Chỉ `inspect-image.sh` khác fork. Bản cũ lưu ở `ops/inspect-image.sh.bak-dp2`. Các file `*.test.mjs` không có trên VPS (đúng như trước) |

Không có migration mới. Manifest plugin (version + capabilities) của hai image trùng hash (`5a7b6c82…`).

## 1. Cổng kiểm

Worktree `.worktrees/paperclip-r3-dp` chạy `git checkout --detach crew/guest-approval`, ra `286820b18`, sạch.

- `crew/release/verify.sh` FULL (12:38 → ~12:42): rc 0, **XANH**.
  - check-core-hooks: `Hook một dòng: 5/5; vá lõi: 8; mục: 20; lỗi: 0`.
  - Server crew 684 test / 33 file; adapter claude 17, codex 10, opencode 12; plugin 434 test / 53 file; agents 136; tsc 0 lỗi; bundle plugin không có `require("react")` trần.
- ops `node --test crew/ops/*.test.mjs`: 75/75.
- crew-web: `test` 135 file, 1140 pass, 1 todo; `typecheck` sạch; `biome check src e2e test` sạch (498 file).
  - `pnpm lint` ở gốc package báo lỗi format ở `test-results/.last-run.json`, là artifact Playwright chưa theo dõi của lượt T2 trước, không phải mã nguồn.
- `packages/shared` đã có `dist` sẵn (build lại không cần). Chạy `pnpm --filter @crew/shared build` báo không có package khớp tên đó; không ảnh hưởng vì typecheck và test đều qua.

## 2. Deploy

1. Đưa `inspect-image.sh` mới lên VPS (`scp`, sha256 trùng fork `b89db403…`).
2. `overlay-source.sh 286820b18`: 31 file server, tarball đã tải lên.
3. `overlay-job.sh 286820b18` trên VPS: `JOB_EXIT rc=0`, `min_avail=5315MiB`.
4. `inspect-image.sh` trên VPS: rc 0. Dòng mới `crew/contributions.js`, `crew/contribution-routes.js`, `crew/plugin-data-scope.js` đều `ok` (bản script cũ không in ba dòng này). `crew-ui=286820b18…`, vá adapter P2–P7 ok, chỉ có `WARNING host adapter check SKIPPED` như mọi lần.
5. `inspect-image.sh` từ Mac (`DOCKER_HOST=ssh://nhamoiplatform`, commit `286820b18`): rc 0, 0 MISSING, FAIL hay WARN.
6. Điều kiện chạy: `active-runs.sh` rỗng (0 run running hoặc queued) trước build và trước deploy.
7. `deploy.sh crew-v3/paperclip:v3-286820b18`: 12:43:48 → 12:44:23, rc 0. Tự backup DB, kiểm cấu hình policy, plugin `healthy`, in `deploy ok … rollback TS=20261011-124356`.

## 3. Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `ok`, commit `286820b18…`, databaseBackup ok |
| Plugin `crew.core` | `plugin-state.sh` trả `healthy` |
| `https://crew.2p-solutions.com/` | 200, meta `crew-ui=286820b18…` |
| `/paperclip/` | 200 |
| `check-crew-companies.sh` | `ok 2 company` |
| Đăng ký | Vẫn đóng: `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true` trong container |
| Log 3 phút sau deploy và 20 phút sau T2 | 0 token, 0 `INVOCATION_SCOPE_DENIED`, 0 `host refused` |

## 4. T2 (Playwright prod, Crew E2E, stub, `CREW_E2E_BASE_KEY=e2e-base4`)

Lượt đầy đủ chạy 12:44:43 → 13:00:41 (15,9 phút): **80 passed, 18 skipped, 0 failed**, rc 0. Quét kết quả: không chứa mật khẩu.

- **PW-S20-1..7: cả 7 ca xanh** (kể cả S20-6 và S20-7, mà DP-1 bị chặn bởi guard ghi). Chứng tỏ sửa guard hiệu quả.
- **`no-dead-controls` `/machines`: xanh** (14,9 giây). Cũng xanh: `/contributions`, `/members`, `/dashboard`, `/agents`, `/docs` và các trang khác.
- 18 ca skipped là những ca đã bị bỏ sẵn (`@shots`, một số ca `@t3` hoặc ca cần điều kiện riêng như `/agents/:agentRef/runs/:runId`, PW-S3-1, PW-S6-STALE), cùng danh mục như các lượt trước.
- Không có lỗi sản phẩm, lỗi test hay lỗi môi trường nào.

Về yêu cầu của điều phối giữa chừng ("chỉ chạy s20-contributions và no-dead-controls /machines, nếu bộ đầy đủ đang chạy thì dừng"): lúc nhận được, lượt đầy đủ **đã kết thúc** (rc 0), nên không còn gì để dừng. Hai spec đó đã nằm trong lượt đầy đủ và đều xanh, nên em không chạy lại để khỏi tốn thêm thời gian.

## 5. `agent-permissions.sh --check`

Chạy trên VPS (`ops/agent-permissions.sh --all-crew --check`), rc 0. Hai company Crew: `5befeb1a…` (2P Solutions) và `a7132a14…` (Crew E2E). Mọi agent đều `(đúng)`; không có dòng lệch. Rule skill-policy `crew-deny-agent-skill-writes` đã có, inbox policy của owner `disabled`, pipeline 0, tool connection 0.

Ghi chú: chạy script từ Mac không được vì thiếu `CREW_POLICY_FILE` cục bộ; chạy trên VPS đúng như thiết kế.

## Dọn và an toàn

- Không in mật khẩu. Không sửa mã. Không commit, không push, không tạo tag mới.
- Không tạo nội dung ở 2P Solutions (T2 chỉ chạy ở Crew E2E). Mục góp ý mới của T2 nằm ở Crew E2E, issue sinh ra do stub.
- `active-runs` rỗng khi kết thúc. Không còn process nền nào do em khởi tạo (Playwright, vitest đã thoát).
- Worktree `paperclip-r3-dp` đang detached `286820b18`, sạch (chỉ có `test-results/` không theo dõi).
- Gợi ý: nếu owner muốn, gắn tag `crew/v3.5` lên `286820b18` (chưa làm, vì không được yêu cầu).

Status: DONE
Summary: Prod chạy `crew-v3/paperclip:v3-286820b18` (rollback: `ops/rollback.sh 20261011-124356` về `v3-33d7e2242`), plugin healthy, `/` và `/paperclip/` đều 200. T2 đầy đủ 80 pass / 0 fail, gồm PW-S20-1..7 và no-dead-controls `/machines`. `agent-permissions.sh --all-crew --check` rc 0.
