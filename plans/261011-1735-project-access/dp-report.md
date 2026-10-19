# DP: deploy `crew/v3.5` @ `e400b719d` (quyền xem project theo thành viên, Hướng dẫn theo vai trò, nút kho UI chỉ owner)

- Thời gian: 11/10/2026 18:05 → 18:16 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent.
- Kết quả: **DONE_WITH_CONCERNS.** Prod chạy `crew-v3/paperclip:v3-e400b719d`, migration `0016` đã áp, plugin `healthy`.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-bd0ac8d5b` |
| Image sau | `crew-v3/paperclip:v3-e400b719d` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261011-181153` (về `v3-bd0ac8d5b`) |
| Backup DB | `20261011-1811` do `deploy.sh` tự tạo, 38M, builtin ok, ở `/opt/crew-v3-spike/backups/daily/` |
| Lưu ý rollback | Bảng `crew_project_access` và 0016 để nguyên (migration không lui). Bản cũ không đọc bảng này nên vô hại; grant của anh.pham chỉ mất tác dụng, không hỏng dữ liệu |

## 1. Cổng kiểm (worktree `paperclip-r3-dp`, `git checkout --detach crew/v3.5` ra `e400b719d`, sạch)

- `verify.sh` FULL: 3:13 phút, rc 0, **XANH**. Server 691 test / 34 file; adapter claude 17, codex 10, opencode 12; plugin 467 / 57 file; tsc 0 lỗi; bundle không có `require("react")` trần.
- ops `node --test crew/ops/*.test.mjs`: 75 pass, 0 fail.
- core-hooks `check-core-hooks.mjs`: `Hook một dòng: 5/5; vá lõi: 8; mục: 20; lỗi: 0`.
- crew-web: test 139 file, 1234 pass, 1 todo; `typecheck` sạch.
- crew-web `biome check src test e2e`: **ĐỎ, 1 lỗi định dạng** ở `e2e/specs/guide-shots.spec.ts` (Biome muốn gộp một mảng nhiều dòng thành một dòng quanh dòng 550). Chỉ là format, file e2e không vào image. Em không sửa (không được commit) và vẫn đi tiếp; xem Concern 1.

## 2. Deploy

1. `active-runs.sh` rỗng trước build, trước deploy (18:11:45) và sau deploy. 0 run chạy hoặc xếp hàng.
2. `overlay-source.sh e400b719d`: 33 file server, tarball 259 mục, có `migrations/0016_project_access.sql`.
3. `overlay-job.sh e400b719d` trên VPS: `JOB_EXIT rc=0`, `min_avail=5043MiB`.
4. `inspect-image.sh` rc 0: `issues crewCoreHooks=3`, `crew-ui=e400b719d…`, không MISSING/FAIL, chỉ có `WARNING host adapter check SKIPPED` như mọi lần.
5. Manifest không thêm capability: dòng `manifest crew.core …` của image cũ và mới cùng sha256 `43f3560866b0`.
6. `deploy.sh crew-v3/paperclip:v3-e400b719d`: rc 0, tự backup, plugin `healthy`, in `deploy ok: … v3-bd0ac8d5b -> … v3-e400b719d, rollback TS=20261011-181153`.

## 3. Kiểm migration 0016 (trước khi đi tiếp)

| Kiểm | Kết quả |
|---|---|
| `plugin_migrations` | `0016_project_access.sql` `applied` lúc 11:12:12 UTC (18:12 giờ VN); 0015, 0014, 0013 vẫn `applied` |
| `to_regclass('plugin_crew_core_0433ea20b6.crew_project_access')` | có bảng |
| `plugin-state.sh` | `healthy` |
| `/api/health` | `ok`, commit `e400b719d1cc…` |
| `/` và `/paperclip/` (crew.2p-solutions.com) | cả hai 200 |

## 4. Mac mini

- `~/.crew/bin/crew-mac status send` (18:12): `status-last.json` `at` 2026-10-11T11:12:32Z, `ok: true`, HTTP 200, cả hai target (`5befeb1a…`, `a7132a14…`) 200. CLI vẫn thoát rc 1 chỉ vì lỗi cũ "không gửi được ảnh chụp docs của c31226f9…" (đã biết).
- Claim việc máy (`/api/plugins/crew.core/api/machine-jobs/claim`) trong log server sau deploy: 204 (18:12:42, 18:12:47 x2).

## 5. Cấp quyền cho anh.pham

- Tài khoản board: dùng `api.sh` trên VPS (cookie phiên board owner đã có, không in credential).
- `anh.pham@2p-solutions.com` = user `WYYJR49U…` (viewer, active) của 2P Solutions. Project "2ps-landing" = `a5ed1f8a-b062-4552-b3c0-adee08e63a66`.
- Trước khi cấp, `GET …/project-access`: anh.pham `all:false, projectIds:[]` (đúng mặc định đóng). 2 owner `all:true`.
- `PUT …/project-access/WYYJR49U…` `{"projectIds":["a5ed1f8a-…"]}` → 200, `projectIds` chỉ có 2ps-landing. Không tạo nội dung nào khác trong 2P Solutions.
- Kiểm bằng anh.pham: đăng nhập bằng mật khẩu Keychain qua biến môi trường (file body tạm xóa ngay, cookie tạm xóa), `sign-in` 200. `GET …/project-access/me` = `{"all":false,"projectIds":["a5ed1f8a-b062-4552-b3c0-adee08e63a66"]}`, đúng một project. Thử thêm endpoint owner `GET …/project-access` bằng phiên anh.pham: 403 (đúng).

## 6. T2 e2e (Crew E2E, stub)

`CREW_E2E_BASE_KEY=e2e-base4 bash e2e/support/run-e2e.sh --project=t2 --grep "PW-S21|PW-S20|PW-S0-1"`: 18:13:17 → 18:14:48, **9 passed** (PW-S0-1, PW-S20-1…7, PW-S21-1), 1,5 phút. Cấp project cho tài khoản khách Crew E2E do chính spec `s20` làm trong `beforeAll` (`grantMemberProjects`), nên em không cấp tay. Quét `test-results` không có mật khẩu. Không chạy cả bộ.

## 7. agent-permissions

`ops/agent-permissions.sh --all-crew --check` trên VPS: rc 0. Hai company (2P Solutions và Crew E2E) mọi agent "(đúng)", skill-policy có rule deny, inbox owner disabled, pipeline 0, tool connection 0.

## 8. An toàn

- Không in secret. Không `rm -rf`, không push, không commit, không DELETE environment. Chỉ `rm -f` file tạm của em (body đăng nhập, cookie anh.pham).
- Log server 10 phút sau deploy: 0 dòng lỗi mức error.
- Không còn process nào em khởi tạo (Playwright, vitest, chromium đã thoát). 2P Crew Helper và Chrome Remote Desktop là của owner, em không đụng.
- Worktree `paperclip-r3-dp` đang detached `e400b719d`, sạch.

## 9. Concern

1. **Biome đỏ 1 lỗi format** ở `packages/crew-web/e2e/specs/guide-shots.spec.ts` (báo cáo của nhánh nói biome sạch). Không ảnh hưởng runtime/image; cần `biome check --write` rồi commit ở nhánh sau.
2. Ngay sau deploy, mọi thành viên không phải owner chỉ thấy project owner đã cấp: hiện mới chỉ anh.pham được cấp (2ps-landing). Viewer/admin khác của các company cần owner cấp ở trang Thành viên khi cần.
3. Concern cũ vẫn còn: dòng migration `._0001_docs.sql` `failed` (rác AppleDouble) và lỗi gửi ảnh chụp docs của Mac mini (`crew-mac status send` rc 1).

Status: DONE_WITH_CONCERNS
Summary: Prod chạy `crew-v3/paperclip:v3-e400b719d` (rollback: `ops/rollback.sh 20261011-181153`), 0016 đã áp, plugin healthy, `/` và `/paperclip/` 200, Mac mini 200 và claim 204. anh.pham chỉ thấy 2ps-landing, T2 9/9 xanh, agent-permissions đúng. Concern: biome đỏ 1 lỗi format ở một file e2e (không vào image).
