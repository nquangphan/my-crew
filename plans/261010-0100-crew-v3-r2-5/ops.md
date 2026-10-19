# R2-5 — Gói `ops` (DP-1, AC-R2-5)

Đọc trước: [plan.md](plan.md) (Global Constraints mục "DB prod" và "Deploy prod", mục Nghiệm thu), ledger R2-2 dòng
DP-1 (trình tự deploy, shim `api.sh`, cách cài `crew-mac` bằng `installCrewMacFrom`).

## DP-1: deploy plugin có migration, rồi cài `crew-mac` (opus)

**Files:** `sdd-ledger.md`, `processes.md`, `reports/dp-1.md`. Không sửa file nguồn nào.

**Interfaces:**
- Consumes: nhánh `crew/r2-5` (fork) và `r2-5` (repo Crew) đã qua RV-1; `crew/ops/*`.
- Produces: prod chạy plugin có `0008` đã áp; Mac mini chạy `crew-mac` bản `r2-5`; mốc rollback trong ledger.

- [ ] **Bước 1: Ghi bắt đầu** vào ledger. Kiểm quota tuần còn > 5 %; không đạt thì dừng, báo owner.
- [ ] **Bước 2: Không có run.**
  - `ssh nhamoiplatform /opt/crew-v3-spike/ops/active-runs.sh` phải rỗng.
  - Trên Mac mini `pgrep -fl 'claude --print'` phải rỗng.
  - Có run thì chờ (poll 60 giây, tối đa 30 phút), không hủy run của người khác.
- [ ] **Bước 3: Backup và diễn tập restore.**
  - `ssh nhamoiplatform /opt/crew-v3-spike/ops/backup.sh`, ghi `TS` (đọc `backups/daily/LATEST`).
  - `ssh nhamoiplatform /opt/crew-v3-spike/ops/restore-drill.sh <TS>`. Phải thoát 0.
  - Script đòi RAM trống ≥ 3 GiB. Thiếu thì dừng và ghi ledger, không bỏ qua bước này.
- [ ] **Bước 4: Gộp đúng bản prod.**
  - Đọc tag image đang chạy (cách R2-2 DP-1: `crew/ops/inspect-image.sh` hoặc `docker ps` qua ssh) → `<sha>` fork.
  - Nếu `git -C <fork> merge-base --is-ancestor <sha> crew/r2-5` sai thì trong `.worktrees/paperclip-r25-int` chạy
    `git merge --no-edit <sha>`.
  - Có xung đột thì chỉ giải trong `packages/crew-plugin/**`. Xung đột ở chỗ khác thì dừng và hỏi Trợ Lý.
  - Chạy `crew/release/verify.sh` (xanh), ghi commit deploy `D`.
- [ ] **Bước 5: Deploy fork `D`** bằng `overlay-source.sh` → `overlay-job.sh` → `deploy.sh` (tham số như R2-2 DP-1).
  Ghi mốc rollback.
- [ ] **Bước 6: Kiểm sau deploy.**
  - `/api/health` `status ok`.
  - Plugin `crew.core` `ready` (`plugin-state.sh`).
  - SQL qua stdin: `SELECT migration_key, status FROM plugin_migrations WHERE migration_key LIKE '0008%'` có `applied`;
    `SELECT count(*) FROM plugin_crew_core_0433ea20b6.docs_blobs` > 0 (nếu SP-0 G-d có trang);
    `SELECT count(*) FROM plugin_crew_core_0433ea20b6.docs_snapshots WHERE completed_at IS NOT NULL` ≥ số project có
    docs.
  - `https://2p-solutions.com` và `https://kidyschool.com` trả 200.
  - Hỏng ở bất kỳ bước nào thì `rollback.sh <TS>` ngay, ghi ledger. Migration không lui bằng code: restore DB từ backup
    bước 3 theo hướng dẫn của `rollback.sh` và chỉ làm khi owner đồng ý (Global Constraints).
- [ ] **Bước 7: Mac cũ vẫn gửi được.** Chờ tới khi có một snapshot hoặc bản tin máy mới từ Mac mini (`crew-mac` R2-2)
  sau deploy: `SELECT max(received_at) FROM …machine_latest`. Ghi giờ. Đây là bằng chứng AC9 "Mac cũ".
- [ ] **Bước 8: Cài `crew-mac` bản `r2-5`.**
  - Trong `.worktrees/crew-r25-mac` (đã ff bằng `r2-5`): `pnpm --filter @crew/mac build`.
  - Đóng gói như R2-2 DP-1: chép `package.json`, `dist`, `assets` vào scratchpad, rồi gọi `installCrewMacFrom`.
  - Chỉ cài khi 0 run. **Không** chạy `setup`, không đụng sshd 2222 hay app.
- [ ] **Bước 9: Kiểm Mac.**
  - Chạy `"$HOME/.crew/bin/crew-mac" status send` một lần (hoặc chờ job phút).
  - Mỗi repo trong `status-repos.json` có `format: 2`.
  - `SELECT project_id, format, manifest_state, completed_at FROM …docs_snapshots WHERE format = 2` có một dòng cho mỗi
    repo.
  - `machine_latest.report ? 'attachmentCache'` đúng với Mac mini.
- [ ] **Bước 10: Ghi** `reports/dp-1.md` và ledger: TS backup, kết quả restore-drill, `D`, mốc rollback, giờ các bước.
  Tag `crew/v3.5-rc1` cục bộ trên `D`.

## AC-R2-5: nghiệm thu không run Claude (opus)

**Files:** `reports/ac-r2-5-report.md`, `reports/ac-shots/*.png`, `sdd-ledger.md`, `processes.md`; script tạm trong
scratchpad.

Làm đúng mục **Nghiệm thu** của [plan.md](plan.md), theo thứ tự AC1 → AC10 rồi Dọn. Ghi chú thực thi:

- **Gọi data key và route bằng board API**, phiên đăng nhập của owner trên VPS (shim `api.sh` của R2-1/R2-2).
  - Data key: `POST /api/plugins/crew.core/data/<key>` với body `{"companyId":…, "params":{…}}`. Trước khi gọi, đọc
    `server/src/routes/plugins.ts` l.1561 để lấy đúng tên trường body.
  - Route agent: `GET /api/plugins/crew.core/api/docs/graph?...`.
  - So hai JSON bằng `jq -S . a.json > a.s; jq -S . b.json > b.s; diff a.s b.s`.
- **SQL độc lập:**
  - Viết sẵn `<scratchpad>/r25-ac.sql`, gửi qua stdin.
  - AC6: tính lại logic/vật lý docs bằng SQL tách rời code plugin, dùng `refs` như ST-1 nhưng viết lại tay.
  - AC7: run của cây bằng `WITH RECURSIVE` + `cost_events` group theo `heartbeat_run_id`.
- **Repo thử AC trên Mac mini:**
  - Đặt ở `~/crew-r25-ac/` (không dưới `~/Documents`).
  - `git config crew-docs.bundle` trỏ bundle `crew-docs` đã cài (đọc từ một repo đang đăng ký, ví dụ
    `git -C <repo-a> config --get crew-docs.bundle`).
- **AC5 `invalid`:**
  - Xóa `docs/index.md` khỏi index rồi commit, `crew-docs check --all` phải thoát 1. Nếu bundle trả mã khác thì ghi
    nguyên mã và trạng thái nhận được.
  - Khôi phục rồi gửi lại để `r25-ac` về `current`.
- **AC8 Playwright:**
  - Script `<scratchpad>/r25-ac8.mjs`, chạy bằng `npx playwright@1.60.0` (Chromium đã cài cho R3/R2-2).
  - Đăng nhập bằng form. Mật khẩu lấy theo cách R2-2 AC (không in ra log).
  - Chụp 4 ảnh vào `reports/ac-shots/` và ghi `page.on('console')` mức `error`.
  - Kiểm bàn phím: `page.keyboard.press('Tab')` tới khi `document.activeElement` có chữ "Đồ thị", tối đa 60 lần.
- **Mọi thứ tạo ra** (project thử, repo thử, file tạm) ghi vào processes.md ngay khi tạo, gỡ ở bước Dọn.
- Tiêu chí nào không làm được trên dữ liệu thật (ví dụ không có issue có `crew-commit`) thì ghi "không có dữ liệu", dẫn
  test DB tương ứng. **Không** tạo run để có dữ liệu.
- Kết thúc: ghi ledger dòng tổng kết AC (đạt/không đạt từng AC), tag `crew/v3.5` cục bộ nếu mọi AC đạt hoặc chỉ thiếu dữ
  liệu. Không push.
