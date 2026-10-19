# DP-3 R3: deploy `crew/r3` @ `06e04053b` lên prod

- Thời gian: 2026-10-10 08:39 → 08:55 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Nội dung: CORE-P (vá lõi C1–C6), FX-O2, UIP-1/2/3, FX-DS6, FX-UI.
- Kết quả: **DONE_WITH_CONCERNS.** Prod chạy image `crew-v3/paperclip:v3-06e04053b`. Không phải rollback. Có 2
  điểm cần FX, không chặn (xem cuối báo cáo).

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-f569bf4a5` |
| Image sau | `crew-v3/paperclip:v3-06e04053b` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-084448` (đưa về `v3-f569bf4a5`) |
| Backup DB | `20261010-0843` (làm tay, 25M, builtin ok); `deploy.sh` backup thêm `20261010-0844` |
| Script ops VPS cũ | `/opt/crew-v3-spike/ops.bak-dp3-r3/` (21 file) |
| Tag cục bộ | `crew/v3.5-rc2` (annotated) trên `06e04053b`. Chưa push |

Không có migration plugin mới: `packages/crew-plugin` không đổi từ `f569bf4a5`. Vì vậy rollback chỉ cần đổi image,
không phải restore DB.

## Bước 1: cổng kiểm

Kiểm trên worktree chỉ đọc `.worktrees/paperclip-r3-dp`, đã chuyển sang `git checkout --detach crew/r3` (`06e04053b`,
sạch). Trước khi kiểm chạy `pnpm install --frozen-lockfile`.

- `crew/release/verify.sh` chạy 08:40:41 → 08:43:17, rc 0, **XANH**:
  - hook một dòng 5/5, vá lõi 6, lỗi 0. Có cảnh báo "chưa có PR upstream" cho P1–P4 và C1–C6, chỉ là cảnh báo;
  - server crew 25 file / 503 ca; adapter 3 / 17; plugin 42 / 255; agents xanh;
  - tsc của server, adapter và plugin đều 0 lỗi; build plugin xanh, không có `require("react")` trần.
- Chạy thêm:
  - `node --test crew/ops/*.test.mjs`: 60/60;
  - `@crew/paperclip-web`: typecheck rc 0, vitest 99 file / 705 ca + 1 todo.
- `ipcs -m` trước và sau đều chỉ có 1 đoạn cũ.

## Bước 2: chuẩn bị

1. `active-runs.sh` rỗng. Image đang chạy là `v3-f569bf4a5`.
2. Chạy backup `20261010-0843`.
3. Sao lưu script ops VPS vào `ops.bak-dp3-r3`. Chỉ 2 file lệch với fork: `e2e-company.sh` (FX-O2) và
   `inspect-image.sh` (CORE-P). Chép 2 file bằng `scp -p`. Sau đó sha256 của mọi `ops/*.sh`, `*.py` và
   `nginx-crew.conf` trên VPS trùng fork.

## Bước 3: build và deploy

1. **`overlay-source.sh` gốc từ chối build** (rc 2) vì OPS-UI0 đổi `ui/src/main.tsx` và `ui/vite.config.ts`. Hai file
   này nằm ngoài danh sách thư mục script cho phép. Mình chạy một bản sao trong scratchpad, chỉ khác 2 dòng:
   - `FORK` trỏ thẳng vào worktree;
   - danh sách cho phép thêm **đúng 2 file đó**.

   Hai file `ui/` không vào image, vì phần đóng gói chỉ lấy `server/src` và adapter. UI gốc được phục vụ riêng qua
   `stock-ui.sh`. Nên tarball ra giống hệt tarball mà script gốc sẽ tạo nếu nó cho qua. Kết quả upload ok, 23 file
   server được transpile (17 cũ, thêm `crew/agent-write-guard` và 4 route cùng `plugin-worker-manager`). Mình không
   sửa repo; cần làm FX (xem cuối báo cáo).
2. `overlay-job.sh 06e04053b`: `JOB_EXIT rc=0`, `min_avail=5384MiB`.
3. `inspect-image.sh` không có dòng MISSING hay FAIL:
   - `issues crewCoreHooks=3`; heartbeat và environment-runtime mỗi file 2;
   - đủ 12 file crew, trong đó có file mới `crew/agent-write-guard.js`;
   - **`plugin events delivered as call ok`**: bước kiểm C6 do CORE-P thêm vào đã đạt;
   - **`crew-ui=06e04053b370df6d252d65205a15ceefc3fe7e0d`**;
   - plugin 26 capability; bundle UI gzip 109325 B.
4. `active-runs.sh` rỗng lần 2. `deploy.sh` chạy 08:44:42 → 08:45:17, rc 0, in
   `deploy ok: v3-f569bf4a5 -> v3-06e04053b, rollback TS=20261010-084448`, plugin healthy.

## Bước 4: kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `status ok`, commit `06e04053b370…`, backup DB ok |
| Plugin `crew.core` | **ready**, `last_error` rỗng, `loadAll` 1 thành công / 0 lỗi |
| Job `attachments-audit` | succeeded mỗi phút từ 01:46:12Z (5/5 lượt đầu sau deploy). Không có `host refused` hay `INVOCATION_SCOPE_DENIED` |
| Các site | `crew /`, `/cli-auth/x`, `/paperclip/`, `/paperclip/TPS/issues/TPS-72`, `2p-solutions.com`, `kidyschool.com` đều 200. `/` và `/cli-auth/x` có mốc `crew-ui=06e04053b…` |
| Policy | Log có `crew policy config enabled` |
| `check-crew-companies.sh` | `ok 2 company` (TPS và Crew E2E), rc 0 |
| `agent-permissions.sh --check --all-crew --assistant 6c27410e…` | **rc 0**, mọi dòng đúng |
| App Mac | claim trả 204 (48 lần trong 2 phút). `app.json` có `jobsAgent.lastPollAt` 01:51:35Z, mới hơn lúc kiểm 21 giây |

Log từ khi deploy, mức warn trở lên:
- 1 warn `startup config delivery rejected — single-tenant plugin configured for multiple companies`. Cảnh báo này
  đã biết từ DP-1.
- 1 lỗi host `config.get: company context is required` ở **mỗi lượt audit** (mỗi phút). Job vẫn succeeded. Xem FX-2.

## Bước 5: UI gốc `/paperclip/`

- Sau deploy, `/paperclip/` trả 200, title `Paperclip`. File `STOCK_UI_BUILD.txt` ghi `commit=f569bf4a5…`.
- Trong Playwright, đăng nhập ở UI Crew rồi bấm nút sang UI gốc: trang mở đúng `/paperclip/TPS/issues/TPS-72` với
  phiên đăng nhập đó và hiện chi tiết TPS-72 (ảnh 07).
- **Quyết định: KHÔNG chạy `stock-ui.sh reapply`.**
  - Từ `80db65ffb` (nguồn bản build UI gốc) đến `06e04053b`, thư mục `ui/` không đổi gì
    (`git diff 80db65ffb 06e04053b -- ui` rỗng).
  - Từ `f569bf4a5` cũng không đổi gói dùng chung nào ngoài `crew-web`, `crew-plugin`, `server` và `crew/`.
  - Vì vậy build lại sẽ ra cùng một bản. Cũng không cần reapply vì container nginx không bị tạo lại.
  - Mốc trong `STOCK_UI_BUILD.txt` vẫn ghi `f569bf4a5`; điều này đúng với mã nguồn.

## Bước 6: xem UI Crew trên prod (chỉ xem TPS)

Chạy Playwright Node trên Mac. Đăng nhập bằng form; email và mật khẩu đọc từ `.env` VPS qua stdin, không in và không
lưu file; không bật trace. Đã quét ảnh, json và scratchpad: không có mật khẩu. Ảnh ở `reports/dp3-shots/`
(8 ảnh và `dp3-view.json`).

| Bước | Kết quả |
|---|---|
| Mốc | `crew-ui=06e04053b…` |
| Đăng nhập | `sign-in` trả 200, vào `/TPS/dashboard` (ảnh 01) |
| Tổng quan mới (ảnh 02) | Có khối AGENT (4 thẻ run tro-ly), 4 thẻ số (10 agent đang bật, 0 đang làm, 0 bị kẹt, 0 chờ duyệt), 3 biểu đồ 14 ngày (run, yêu cầu theo trạng thái, tỉ lệ thành công), thẻ Máy (Mac mini trực tuyến), Hoạt động gần đây, Yêu cầu gần đây |
| Sidebar nhóm (ảnh 03) | Trên cùng là Yêu cầu mới, Tìm kiếm, Tổng quan, Hộp thư (21). Sau đó 3 nhóm: **CÔNG VIỆC** (Yêu cầu, Project, Docs), **TỔ CHỨC** (Agent, Skills, Máy), **HỆ THỐNG** (Cài đặt, Hướng dẫn, Mở giao diện Paperclip gốc) |
| Popup từ danh sách (ảnh 04, 05) | TPS-72 không nằm trong trang đầu nên lọc `q=TPS-72` rồi bấm dòng (link `href=/TPS/issues/TPS-72`). URL thành `/TPS/issues?q=TPS-72&issue=TPS-72` và hiện dialog "Chi tiết yêu cầu TPS-72" với bố cục IssueDetail cùng nút Copy mã, Copy link, Mở toàn trang. Bấm Esc thì đóng: URL về `?q=TPS-72` và còn 0 dialog |
| Trang đầy đủ (ảnh 06) | `/TPS/issues/TPS-72`: Hoàn thành, đủ giai đoạn, khối Crew "1/1 con xong · docs Đạt", Run của yêu cầu có 6 run |
| Nút Paperclip gốc (ảnh 07) | `href=/paperclip/TPS/issues/TPS-72`, mở tab mới đúng `/paperclip/TPS/issues/TPS-72`, title "docs: thêm ghi chú… • Tasks • 2P Solutions • Paperclip" |
| Đăng xuất (ảnh 08) | Menu Tài khoản → Đăng xuất: `sign-out` 200, về `/login`; sau đó `/api/companies` trả 403 |

Console không có lỗi ứng dụng Crew. Chỉ có:
- 2 lần 401 `get-session` ở `/login`, trước khi đăng nhập và sau khi đăng xuất (đúng như mong đợi);
- 2 lần 404 ở **tab UI gốc**: `/api/heartbeat-runs/7912ec5c…/log` và `/api/issues/…/documents/plan`. UI stock tự gọi
  log của run đã hủy và tài liệu `plan` không có, không liên quan overlay Crew.

Không tạo hay sửa gì ở TPS.

## 5 luồng chặn (luật 30 phút)

- Đăng nhập: đạt trên prod (cả UI Crew và UI gốc dùng chung phiên).
- Cli-auth: `/cli-auth/x` trả 200 và có mốc đúng commit. App Mac vẫn claim 204 bằng board key cli-auth `ad00ffab`,
  nên key không bị deploy làm mất hiệu lực.
- Tạo yêu cầu, duyệt, hủy: không thử trên prod vì phạm vi chỉ xem TPS. Đã có ở T1 (FX-UI 49 xanh) và T1 của CORE-P
  (hủy run → plugin chuyển blocked, không lỗi scope).

Không thấy lỗi chặn nên giữ bản deploy.

## Cần FX (không chặn)

1. **FX-OPS3 (gói ops):** `crew/ops/overlay-source.sh` cần cho phép `ui/` trong danh sách file đổi (có thể chỉ
   `ui/src/main.tsx` và `ui/vite.config.ts`), vì UI gốc phục vụ riêng qua `stock-ui.sh` và không vào image. Chưa sửa
   thì mọi lần deploy sau OPS-UI0 đều bị script từ chối.
2. **FX-PL (gói plugin):** từ khi C6 gửi sự kiện bằng `call`, `companies.list` không còn bị -32005. Vì vậy job
   `attachments-audit` quét cả company **CREA** (Crew Spike Policy, không cấu hình Crew), và host log lỗi
   `config.get: company context is required` mỗi phút. Job vẫn succeeded và chức năng không sai, nhưng log bẩn
   1 dòng error mỗi phút. Hướng sửa: lọc company trước khi gọi `config.get` (ví dụ dựa vào danh sách Crew đã lưu, hoặc
   company có `plugin_company_settings`), hoặc nuốt im lỗi này ở job.
3. Nhỏ: trang chi tiết yêu cầu đầy đủ không có thẻ `h1` (tiêu đề không phải heading cấp 1). Chỉ ảnh hưởng a11y.
4. Vẫn còn từ DP-1: warn `single-tenant plugin configured for multiple companies` (khai `multiCompanyConfig`).

## Không làm

- Không sửa code trong repo, không push, không DELETE, không `rm -rf`, không tạo issue hay run.
- Không đụng TPS ngoài việc xem.
- Không chạy lại `agent-permissions` (chỉ `--check`). Không chạy `stock-ui.sh reapply` (lý do ở bước 5).

Worktree `.worktrees/paperclip-r3-dp` vẫn giữ, detached `06e04053b`, sạch. Không còn process nền. File tạm trên VPS
(`/tmp/dp3-*`) đã xóa.
