# DP fork 2: deploy `crew/v3.5` @ `bd0ac8d5b` (nút "Gỡ máy" cho máy chưa ghép, migration 0015)

- Thời gian: 11/10/2026 15:12 → 15:21 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent.
- Kết quả: **DONE_WITH_CONCERNS.** Prod chạy `crew-v3/paperclip:v3-bd0ac8d5b`, migration `0015` đã áp, plugin `healthy`. Concern nhỏ nằm ở mục 7.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-e80352848` |
| Image sau | `crew-v3/paperclip:v3-bd0ac8d5b` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261011-151739`, đưa về `v3-e80352848` |
| Backup DB | `20261011-1517`, do `deploy.sh` tự tạo: `db-20261011-1517.dump` 9,5M, `paperclip-data` 29,5M, `config` tar.gz, nằm ở `/opt/crew-v3-spike/backups/daily/` (`LATEST` trỏ tới bản này) |
| Backup compose | `docker-compose.yml.bak-20261011-151739`; image cũ ghi ở `ops/previous-image-20261011-151739` |
| Lưu ý rollback | Bảng `machine_pairings` và 0015 để nguyên (migration không lui). Plugin cũ (`e80352848`) không có đường `unpair` cho máy chưa ghép; dòng đã gỡ sẵn (nếu có) có `NOT NULL` đã bỏ, plugin cũ vẫn đọc được. Hiện chưa có dòng nào như vậy vì chưa ai bấm Gỡ máy. Theo spec §12 máy đã gỡ khi còn dùng secret company sẽ được nhận lại bằng secret company sau rollback |
| Config plugin | Không đổi trong lượt này, `paperclipSshPublicKey` giữ nguyên |

## 1. Cổng kiểm (worktree `paperclip-r3-dp`, `git checkout --detach crew/v3.5` ra `bd0ac8d5b`, sạch)

- `crew/release/verify.sh` FULL: 2:59 phút, rc 0, **XANH**.
  - check-core-hooks: `Hook một dòng: 5/5; vá lõi: 8; mục: 20; lỗi: 0`.
  - Server crew 684 test / 33 file; adapter claude 17, codex 10, opencode 12; plugin **466 test / 56 file** (trước 462 / 55: thêm ca 0015); agents 136/136.
  - tsc 0 lỗi (server, 3 adapter, plugin); bundle plugin build xong, không có `require("react")` trần.
- ops `node --test crew/ops/*.test.mjs`: 13 + 5 + 10 + 18 + 136 + 75, **0 fail** (các file test ops, plugin-state, policy-config, upgrade/compose/pull-backup, agent-permissions và còn lại).
- crew-web: `test` 137 file, 1171 pass, 1 todo; `typecheck` sạch; `biome check src test e2e` 505 file sạch.

## 2. Deploy

1. `active-runs.sh` rỗng trước build, trước deploy (15:17:30) và lúc kết thúc. 0 run chạy hoặc xếp hàng.
2. `overlay-source.sh bd0ac8d5b`: 31 file server, tarball 166 mục, có cả `migrations/0014` và `0015_machine_pairings_unpaired_removal.sql`.
3. `overlay-job.sh bd0ac8d5b` trên VPS: `JOB_EXIT rc=0`, `min_avail=5153MiB`.
4. `inspect-image.sh` trên VPS rc 0 (`issues crewCoreHooks=3`, `crew-ui=bd0ac8d5b…`, chỉ có `WARNING host adapter check SKIPPED` như mọi lần) và chạy từ Mac (`DOCKER_HOST=ssh://nhamoiplatform`) không MISSING, FAIL hay WARN.
5. **Manifest không thêm capability:** dòng `manifest crew.core …` của image cũ và mới cùng sha256 `43f3560866b0`.
6. `deploy.sh crew-v3/paperclip:v3-bd0ac8d5b` chạy 15:17:30 → 15:18:05, rc 0, tự backup, plugin `healthy`, in `deploy ok: … v3-e80352848 -> … v3-bd0ac8d5b, rollback TS=20261011-151739`.

## 3. Kiểm migration 0015 (trước khi đi tiếp)

| Kiểm | Kết quả |
|---|---|
| `plugin_migrations` | `0015_machine_pairings_unpaired_removal.sql` `applied` lúc 08:18:02 UTC (15:18:02 giờ VN); `0014` và `0013` vẫn `applied` |
| `plugin-state.sh` | `healthy` |
| `/api/health` | `ok`, commit `bd0ac8d5b839…` |

0015 đã áp, nên em đi tiếp.

## 4. Kiểm ngay sau deploy

| Kiểm | Kết quả |
|---|---|
| Bản tin Mac mini (`~/.crew/bin/crew-mac status send`, 15:18:44 và 15:19:04) | Log server cho thấy cả hai target nhận `POST …/webhooks/machine-status` **HTTP 200** (host `100.105.105.12:3100` và `crew.2p-solutions.com`, các request 45/46, 52/53/54 đều 200). 8 phút log không có `pairing_unavailable`, `machine_revoked`, `bad_signature`. CLI thoát rc 1 chỉ vì dòng cũ "không gửi được ảnh chụp docs của c31226f9…" (xem mục 7), không liên quan bản tin máy |
| Fingerprint host key Mac mini | `SHA256:UeSt0eAbsCJuudADVkJAxsutlwIPccY70RE4lMn4FKQ`, trùng mốc, đọc trước và sau deploy |
| `pair-info` 2P Solutions (`5befeb1a…`) | Còn trả key: chỉ có trường `paperclipSshPublicKey`, loại `ssh-ed25519`, fingerprint `SHA256:E13Uaf2qTo+cFsRw3AXkJqLroyyZwoYxOW2FC1+Agu0`, trùng key đã đặt ở lượt DP trước |
| Config plugin `paperclipSshPublicKey` (chỉ đọc `GET`) | Còn. Các khóa là `companies` (1 mục) và `paperclipSshPublicKey`; `lastError` null. Không POST gì |

## 5. T2 (Playwright prod, Crew E2E, stub)

`CREW_E2E_BASE_KEY=e2e-base4 bash e2e/support/run-e2e.sh --project=t2 --grep "PW-S2-3"`: 15:21:08 → 15:21:15, **1 passed** (PW-S2-3 widget Máy khớp `crew.machines`). Run-e2e quét `test-results` không có mật khẩu. Không chạy cả bộ.

## 6. An toàn

- Không in secret. Public key chỉ in loại và fingerprint. Tài khoản board đi qua pipe vào biến môi trường như thường lệ.
- Log server 8 phút sau deploy: 0 token, 0 chuỗi public key, 0 từ chối pairing.
- Không unpair hay sửa máy nào, không POST config, không sửa mã, không commit, không push, không DELETE environment, không `rm -rf` (chỉ `rm -f` file tạm của em).
- Không còn process nào em khởi tạo (Playwright, vitest, chromium đã thoát). Các tiến trình 2P Crew Helper và Chrome Remote Desktop đang thấy là của owner, em không đụng.
- Worktree `paperclip-r3-dp` đang detached `bd0ac8d5b`, sạch.

## 7. Concern

1. **Dòng `._0001_docs.sql` trạng thái `failed` trong `plugin_migrations` của `crew.core`** (có `error_message`, `applied_at` null). Đây là tên file kiểu AppleDouble (`._`), có vẻ do một lần đóng gói cũ, không phải do bản này. Plugin vẫn `healthy` và 0013–0015 `applied`. Em không chạm tới và không xác định được thời điểm sinh ra, nên nên xem riêng và dọn nếu cần.
2. **Ảnh chụp docs của Mac mini** (`c31226f9…`) vẫn báo lỗi gửi, có từ trước (đã ghi ở lượt DP trước). Làm `crew-mac status send` thoát rc 1 dù bản tin máy 200.
3. **Chỉ chạy PW-S2-3 trên T2** theo yêu cầu, nên nút "Gỡ máy" cho máy chưa ghép chỉ được kiểm bằng T1 (PW-S15-PAIR 2/2 ở FX2) và chưa có kiểm UI trên prod. Owner sẽ thử khi nghiệm thu.
4. Việc kế tiếp của owner: bấm "Gỡ máy" trên web cho MacBook, rồi app bấm "Ghép lại" (gọi `pair` kèm `allowRepair: true`).

Status: DONE_WITH_CONCERNS
Summary: Prod chạy `crew-v3/paperclip:v3-bd0ac8d5b` (rollback: `ops/rollback.sh 20261011-151739` về `v3-e80352848`), migration 0015 đã áp, plugin healthy. Mọi cổng xanh, bản tin Mac mini 200, host key và `pair-info` và `paperclipSshPublicKey` còn nguyên, PW-S2-3 xanh trên T2. Concern: có dòng migration `._0001_docs.sql` failed (rác AppleDouble, có từ trước) và lỗi ảnh chụp docs Mac mini cũ.
