# DP-X1 và DP-X2 R3X: deploy `crew/r3x` @ `c55a16a0c` lên prod, cài app `r3x` @ `b827114` lên Mac mini

- Thời gian: 2026-10-10 10:29 → 10:44 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Kết quả: **DONE_WITH_CONCERNS.** Prod chạy `crew-v3/paperclip:v3-c55a16a0c`, plugin `crew.core` về `ready` (không gặp
  `upgrade_pending`). App mới đã cài, sshd 2222 là con của app, doctor 0 lỗi, claim 204. Không phải rollback.
  Concern duy nhất: trên prod không xem được nút "Ép Done" ở TPS-72, vì yêu cầu này đã Hoàn thành (xem bước X1-6).

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-06e04053b` |
| Image sau | `crew-v3/paperclip:v3-c55a16a0c` |
| Lệnh rollback prod | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-103323` (đưa về `v3-06e04053b`) |
| Backup DB | `20261010-1032` (làm tay, 25M, builtin ok); `deploy.sh` backup thêm `20261010-1033` |
| Script ops VPS cũ | `/opt/crew-v3-spike/ops.bak-dpx1-r3x/` |
| Tag cục bộ | `crew/v3.5-rc3` (annotated) trên `c55a16a0c`. Chưa push |
| App cũ (lui) | `~/crew-r3x-app-prev/2P Crew.app` (bản FX-M3 `d3cc389`, codesign ok); bản đã gỡ ở `~/.Trash/2P Crew-fxm3-dpx2-1042.app` |

Migration plugin `0011_removal_kinds.sql` chỉ nới check constraint `kind` và thêm 2 chỉ mục duy nhất một phần. RV-X đã
xác nhận image cũ chạy được với schema mới, nên lui chỉ cần đổi image, không phải restore DB.

## DP-X1

### X1-1. Cổng kiểm

Worktree chỉ đọc `.worktrees/paperclip-r3-dp`, chạy `git checkout --detach crew/r3x` (`c55a16a0c`, sạch), rồi
`pnpm install --frozen-lockfile`.

- `crew/release/verify.sh` (tự build plugin-sdk) chạy 10:29:17 → 10:31:25, rc 0, **XANH**:
  - hook 5/5, vá lõi 6, lỗi 0;
  - server crew 25 file / 508 ca, adapter 3 / 17, plugin 44 / 327, agents xanh;
  - tsc 0 lỗi; build plugin không có `require("react")` trần.
- `node --test crew/ops/*.test.mjs`: 62/62.
- `ipcs -m` trước và sau đều chỉ 1 đoạn cũ (`0x5110a261`), không rò.

### X1-2. Chuẩn bị

1. `active-runs.sh` rỗng; image đang chạy `v3-06e04053b`.
2. `backup.sh` → `20261010-1032 ok: 25M total, builtin=ok`.
3. Sao lưu `ops/` VPS vào `ops.bak-dpx1-r3x`. So sha256: chỉ `overlay-source.sh` lệch (bản FX-OPS3 cho phép `ui/`).
   Chép bằng `scp -p`, sau đó sha256 của mọi `ops/*.sh`, `*.py` và `nginx-crew.conf` trên VPS trùng fork.

### X1-3. Build và deploy

1. Lần này dùng `overlay-source.sh c55a16a0c` **gốc**, không phải bản chép: rc 0, 23 file server được transpile, upload ok.
2. `overlay-job.sh c55a16a0c`: `JOB_EXIT rc=0`, `min_avail=5433MiB`.
3. `inspect-image.sh` không có dòng MISSING hay FAIL:
   - `issues crewCoreHooks=3`;
   - đủ 12 file crew;
   - `plugin events delivered as call ok`;
   - **`crew-ui=c55a16a0c8bdb145a8471886433ef057dec9cb39`**;
   - manifest có thêm `issues.wakeup` và `issue.comments.create_human_attributed`;
   - image có `migrations/0011_removal_kinds.sql`.
4. `active-runs.sh` rỗng lần 2. `deploy.sh` chạy 10:33:17 → 10:33:50, rc 0, in
   `deploy ok: v3-06e04053b -> v3-c55a16a0c, rollback TS=20261010-103323`, plugin healthy.

### X1-4. Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `status ok`, commit `c55a16a0c8bd…`, version `v2026.1005.0-crew-c55a16a0c` |
| Plugin `crew.core` | **ready**, `lastError` null, `plugin-state.sh` healthy. Loader local tự nạp manifest mới, **không** vào `upgrade_pending`, không phải duyệt quyền |
| Migration | `plugin_migrations`: `0011_removal_kinds.sql` applied lúc 03:33:46Z. Dòng `._0001_docs.sql failed` là dòng cũ từ 08/10, không liên quan |
| Job `attachments-audit` | succeeded 4/4 lượt từ 03:34:15Z |
| Log từ khi deploy | 0 dòng `config.get`, 0 `host refused` hay `INVOCATION_SCOPE_DENIED`. Mức warn trở lên chỉ có 2 dòng 401 `get-session` do Playwright mở `/login`. Không còn warn `single-tenant plugin configured for multiple companies`. Có `crew policy config enabled` |
| Các site | `crew /`, `/cli-auth/x`, `/paperclip/` (title Paperclip), `/paperclip/TPS/issues/TPS-72`, `2p-solutions.com`, `kidyschool.com` đều 200. `/` và `/cli-auth/x` có mốc `crew-ui=c55a16a0c…` |
| `check-crew-companies.sh` | `ok 2 company`, rc 0 |
| `agent-permissions.sh --all-crew --check --assistant 6c27410e…` | **rc 0** |
| App Mac (bản cũ, trước DP-X2) | 26 lần claim trả 204 từ 10:33:50. Có 502 chỉ trong lúc restart (10:33:25–36). `jobsAgent.lastPollAt` 03:34:58Z |

Ghi chú: log của container cũ mất khi container được tạo lại, nên không đếm được lỗi `config.get` trước deploy trên
prod. DP-3 đã ghi lỗi này xuất hiện mỗi phút; sau deploy là 0 dòng qua 4 lượt audit.

### X1-5. 5 luồng chặn (luật 30 phút)

- Đăng nhập: đạt (Playwright: `sign-in` 200, vào `/TPS/dashboard`; đăng xuất 200).
- Cli-auth: `/cli-auth/x` trả 200 và có mốc đúng commit. App claim 204 bằng key `ad00ffab`.
- Tạo yêu cầu, duyệt, hủy: không thử trên prod (phạm vi chỉ xem TPS). T1 của E2E-X1 và FX-DB đã chạy 68 xanh / 0 đỏ.

Không có lỗi chặn nên giữ bản deploy.

### X1-6. Xem UI Crew trên prod (chỉ xem TPS)

Chạy Playwright Node trên Mac. Email và mật khẩu đọc từ `.env` VPS qua stdin, không in, không trace. Ảnh và
`dpx1-view.json` ở `reports/dpx1-shots/`.

| Mục | Kết quả |
|---|---|
| Mốc | `crew-ui=c55a16a0c…` |
| TPS-72 (ảnh 01, 02) | Có khối **Lịch sử** (19 mục, mở đầu bằng "Bình luận"). **Không có nút "Ép Done"**: TPS-72 đang `done`, và `forceDoneAvailable` ẩn nút ở `done`/`cancelled` (đúng thiết kế, route trả 409 `issue_terminal`). TPS không có yêu cầu nào đang mở (lọc backlog/todo/in_progress/in_review/blocked ra 0), nên trên prod không xem được nút nếu không tạo yêu cầu mới. Nút đã được T1 kiểm (s6-force-done) |
| Skills (ảnh 04) | Có khối "Skill ghim (Superpowers)": ghi "bản Superpowers 6.4.1 đã ghim…", liệt kê 15 skill, **0 nút** (chỉ đọc) |
| Project `2ps-landing` (ảnh 05) | Có nút **"Gỡ project"** đang bật. Không bấm |
| Agent `bmad` (ảnh 06) | Có nút **"Gỡ agent"** đang bật. Không bấm |
| Hướng dẫn (ảnh 07, 08) | Có mục **6.1 Ép Done** và **10.1 Gỡ project và gỡ agent** |

- Console chỉ có 1 lỗi 401 `get-session` ở `/login`, trước khi đăng nhập (đúng như mong đợi).
- Về request ghi: UI chỉ gọi các POST đọc dữ liệu plugin (`/api/plugins/crew.core/data/*`). Ngoài ra, khi mở TPS-72,
  UI tự gửi `POST /api/issues/eff83344…/read`, tức đánh dấu "đã đọc" cho phiên Crew Spike Admin. Đây là hành vi sẵn có
  khi mở yêu cầu, không đổi dữ liệu yêu cầu.

## DP-X2

1. Worktree `.worktrees/crew-r3-dp2` sạch, chạy `git checkout --detach r3x` (`b827114`). So với `d3cc389`, chỉ
   `apps/mac-app` đổi (jobs remove/validate/executors, utility ops). `apps/crew-mac` không đổi, nên không cài lại
   crew-mac và wrapper.
2. Build: `pnpm install --frozen-lockfile`, build docs-kit và `@crew/mac`, rồi
   `pnpm --filter @crew/mac-app release --dev-sign --no-publish`, rc 0.
   - Tự kiểm codesign deep strict đạt (Apple Development, J7Y2DL6HZV, hardened runtime).
   - `app.asar` có `remove-checkouts` và `skill-remove`.
   - zip sha `e3b8a7d7…` (electron-builder báo "Archive file is up to date"; cài từ `.app`, không dùng zip).
3. Kiểm 0 run: VPS `active-runs.sh` rỗng, trên Mac không có `claude --print`. Chép bản đang cài sang
   `~/crew-r3x-app-prev/` (codesign ok).
4. Thoát app cũ:
   - gửi Apple event quit; hộp thoại quit guard hiện "Ở lại / Thoát";
   - bấm Thoát qua System Events lúc 10:42:24, log ghi `app-quit`;
   - sshd dừng, cổng 2222 trống.
5. Cài và mở app mới:
   - dời bundle cũ vào Thùng rác;
   - `ditto` bản mới vào `/Applications` (codesign deep strict ok);
   - mở lúc 10:42:29: app PID 51536, sshd 2222 PID 51614 với **PPID 51536** (đúng một listener). `app.json` có
     `sshdPid 51614`, `sshdOwner app`.
6. Kiểm:
   - app không đòi đăng nhập lại (key `ad00ffab`);
   - từ 10:42:29: 28 lần claim trả 204, `/api/companies` trả 200, 0 warn hay error;
   - vòng poll đi qua 2 company TPS `5befeb1a` và Crew E2E `a7132a14`. Đây cũng là 2 companyId thấy trong warn 502 lúc
     restart prod;
   - `jobsAgent.lastPollAt` 03:42:31Z, rồi 03:43:33Z;
   - `crew-mac doctor` (đầy đủ, có probe) rc 0: **21 ĐẠT, 0 lỗi**.

Cách lui app (chỉ khi 0 run): thoát app qua quit guard, dời bản mới đi, chạy
`ditto ~/crew-r3x-app-prev/"2P Crew.app" "/Applications/2P Crew.app"`, rồi mở lại. crew-mac và wrapper không đổi.

## Cần FX hoặc lưu ý (không chặn)

1. Muốn xem nút "Ép Done" trên prod thì cần một yêu cầu đang mở (ví dụ ở Crew E2E). Hiện TPS không có yêu cầu nào đang
   mở, và theo phạm vi thì không tạo.
2. Ảnh crop `02-tps-72-lich-su.png` chỉ chụp phần đầu khối (crop theo ancestor quá hẹp). Ảnh `01-tps-72.png` chụp toàn
   trang nên có đủ khối.

## Không làm

- Không sửa code, không push (tag `crew/v3.5-rc3` chỉ cục bộ), không DELETE, không `rm -rf`.
- Không bấm Ép Done hay Gỡ, không tạo issue hay run, không duyệt quyền plugin (không cần).
- Không chạy `stock-ui.sh reapply`: container nginx không bị tạo lại, `/paperclip/` vẫn 200.

Worktree `paperclip-r3-dp` đang detached `c55a16a0c`, sạch. Worktree `crew-r3-dp2` đang detached `b827114`, sạch. Không
còn process nền nào do em khởi động.
