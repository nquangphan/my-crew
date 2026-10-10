# DP-1 R3: deploy `crew/r3` @ `f569bf4a5` lên prod

- Thời gian: 2026-10-10 06:55 → 07:03 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Kết quả: **DONE.** Prod chạy image `crew-v3/paperclip:v3-f569bf4a5`. Không phải rollback.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-eef987b01` |
| Image sau | `crew-v3/paperclip:v3-f569bf4a5` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-070026` (đưa về `v3-eef987b01`) |
| Backup DB trước migration 0006/0007/0009/0010 | `20261010-0659` (25M, builtin ok); `deploy.sh` backup thêm `20261010-0700` |
| Backup trước khi áp quyền agent | `20261010-0701` |
| Script ops VPS cũ | `/opt/crew-v3-spike/ops.bak-dp1-r3/` (17 file) |
| Tag cục bộ | `crew/v3.5-rc1` trên `f569bf4a5`. Tag `crew/v3.3-rc1` đã có sẵn trên `5b5088889` nên không dùng. Chưa push |

Các migration mới chỉ thêm bảng hoặc cột, nên image cũ vẫn chạy được trên DB mới. Muốn về đúng dữ liệu trước migration thì restore backup `20261010-0659`, và chỉ làm khi owner đồng ý.

## Bước 1: cổng kiểm

Kiểm trên worktree chỉ đọc `.worktrees/paperclip-r3-dp` (detached, `f569bf4a5`, sạch).

- `crew/release/verify.sh` chạy 06:55 → 06:58:25, rc 0, **XANH**:
  - hook 5/5;
  - server crew 23 file/477 ca; adapter 3 file/17 ca; plugin 42 file/255 ca; agents xanh;
  - tsc server, adapter, plugin đều 0 lỗi. Không có lỗi tsc nào trong server, nên không cần so với nền `crew/r2-5`;
  - build plugin xanh, bundle không có `require("react")` trần.
- Chạy thêm:
  - `node --test crew/ops/*.test.mjs`: 58/58;
  - `@crew/paperclip-web`: typecheck rc 0, test 92 file / 652 ca + 1 todo;
  - build web chạy trong `overlay-source.sh`.
- `ipcs -m` trước và sau: chỉ 1 đoạn cũ.

## Bước 2–3: deploy

1. `active-runs.sh` rỗng, chạy backup `20261010-0659`.
2. Chép 7 file bằng `scp -p` sang VPS: `agent-permissions.sh`, `check-crew-companies.sh`, `e2e-company.sh`, `inspect-image.sh`, `overlay-job.sh`, `overlay-source.sh`, `policy-config.py`. Sau đó sha256 của mọi `ops/*.sh` và `*.py` trên VPS trùng với fork.
3. `overlay-source.sh f569bf4a5`: transpile 17 file server, build plugin và crew-web với `CREW_UI_COMMIT`, upload xong.
4. `overlay-job.sh`: `JOB_EXIT rc=0`, `min_avail=5431MiB`. Đây là lần đầu build docker thật có overlay UI, và bước `RUN test ui-dist` qua.
5. `inspect-image.sh` không có dòng MISSING hay FAIL:
   - `issues crewCoreHooks=3`; đủ 11 file crew;
   - **`crew-ui=f569bf4a5c4d534810c762deb0cad2ef15fec73f`**;
   - plugin 26 capability; bundle UI gzip 109325 B;
   - migrations 0001–0010.
6. `active-runs.sh` rỗng lần 2. `deploy.sh` chạy 07:00:21 → 07:00:48, rc 0, in `deploy ok: v3-eef987b01 -> v3-f569bf4a5, rollback TS=20261010-070026`.

## Bước 4: kiểm sau deploy (đạt hết)

- `/api/health`: `status ok`, commit `f569bf4a5c4d…`.
- Plugin `crew.core`:
  - trạng thái **ready**, `last_error` rỗng, `loadAll` 1 thành công / 0 lỗi;
  - host **không** đòi duyệt 3 quyền mới (`agents.read`, `agents.pause`, `activity.log.write`); manifest lưu 26 capability.
- `plugin_migrations`: 0006, 0007, 0009, 0010 applied lúc 00:00:45Z; 0008 vẫn là bản cũ. Có đủ bảng `crew_machine_jobs`, `crew_setup_runs`, `crew_companies`.
- Trang `2p-solutions.com` và `kidyschool.com` trả 200. `GET /` và `/cli-auth/x` đều có mốc `crew-ui` đúng commit.
- Log server có `crew policy config enabled`. `check-crew-companies.sh` in `ok 2 company`, rc 0.
- Job `attachments-audit` chạy thành công mỗi phút sau deploy. Bảng `crew_companies` có TPS và Crew E2E.

## Bước 5: quyền agent

1. Backup `20261010-0701`, sau đó chạy `--check --all-crew --assistant 6c27410e-7a14-4439-9e07-cbbfa2a743fd`, trả rc 1.
2. Chạy áp, rc 0.
3. Chạy `--check` lần nữa, **rc 0**.

Trạng thái trước khi áp, dùng khi cần lui:
- TPS có 10 agent, Crew E2E có 2 agent (giữ chỗ). Tất cả đều bật tạo-agent, tạo-skill và `tasks:assign`.
- Skill policy revision 0, mặc định allow.
- Inbox của owner: `open`.
- Không có agent `ceo`, trust đều `standard`, 0 pipeline, 0 tool connection.

Trạng thái sau khi áp:
- Chỉ Trợ Lý giữ `tasks:assign`: `tro-ly` 6c27410e và `p-2ps-landing-assistant` f1bdbd53. GET từng agent trả `access.taskAssignSource=explicit_grant`.
- Mọi agent có `canCreateAgents=false` và `canCreateSkills=false`.
- Cả 2 company có rule `crew-deny-agent-skill-writes`, deny mọi `skills.*` cho agent (revision 1).
- Inbox của owner: `disabled`.

Cách lui:
1. Gọi `PATCH /agents/:id/permissions` theo trạng thái trước ở trên.
2. Bỏ rule skill policy.
3. Đặt inbox của owner về `open`.

## Bước 6: xem UI trên prod (chỉ xem)

Chạy Playwright Node trên Mac. Đăng nhập bằng form; mật khẩu đọc từ `.env` VPS qua stdin, không in và không lưu file; không bật trace. Ảnh nằm ở `reports/dp1-shots/` (12 ảnh và `dp1-view.json`). Đã quét ảnh và output, không thấy mật khẩu.

| Trang | URL | Tiêu đề |
|---|---|---|
| Đăng nhập | `/login` → sign-in 200 → `/TPS/dashboard` | Tổng quan |
| Hộp thư | `/TPS/inbox` | Hộp thư (badge 21) |
| Yêu cầu | `/TPS/issues` | Yêu cầu |
| TPS-72 | `/TPS/issues/TPS-72` | TPS-72 (Hoàn thành, đủ giai đoạn duyệt) |
| Project | `/TPS/projects/2ps-landing` | 2ps-landing |
| Agent | `/TPS/agents/bmad` | bmad |
| Máy | `/TPS/machines` | Máy (Mac mini trực tuyến) |
| Đăng xuất | sign-out 200, sau đó `/api/companies` trả 403 | về `/login` |

Console không có lỗi ứng dụng. Chỉ có:
- `401 get-session` trước khi đăng nhập và sau khi đăng xuất (đúng như mong đợi);
- cảnh báo react-router `No HydrateFallback element` ở mỗi trang (mức warning).

Không tạo hay sửa gì ở TPS.

## 5 luồng chặn (luật 30 phút)

- Đăng nhập: đạt trên prod.
- Cli-auth: trang `/cli-auth/x` trả HTML đúng mốc. Chưa bấm Cho phép trên prod; việc đó để DP-2 làm khi app đăng nhập lại.
- Tạo yêu cầu, duyệt, hủy: không thử trên prod vì DP-1 chỉ xem TPS. Ba luồng này đã có ở T1-GATE và ca component T0; ca thật để AC-A làm trong Crew E2E.

Không thấy lỗi chặn nên giữ bản deploy.

## Ghi chú (không chặn)

1. Lúc khởi động, log có một cảnh báo `configChanged: refusing ... single-tenant plugin configured for multiple companies`, code -32006. Worker từ chối phát lại config của Crew E2E vì plugin không khai `multiCompanyConfig`. Mọi lời gọi `ctx.config.get` của plugin đều kèm `companyId` và đọc từ host, nên chức năng không bị ảnh hưởng. Cảnh báo này có lẽ đã có từ khi OP-2 thêm Crew E2E. Có thể làm FX nhỏ: khai `multiCompanyConfig: true` để log sạch.
2. Lúc 00:01:14Z có một lỗi `config.get: company context is required`. Thời điểm này trùng lượt job audit đầu tiên, khi job duyệt cả 3 company, trong đó 1 company không có cấu hình Crew. Job vẫn `succeeded`. Hiện tượng này giống ghi chú "config unreadable" FX-SCOPE đã biết.
3. Lúc 00:02:14Z có một cảnh báo `host refused companies.list, using the stored Crew companies`. Đây là đường dự phòng của FX-SCOPE chạy đúng thiết kế, job vẫn thành công.
4. Cảnh báo react-router `HydrateFallback` trên mọi trang: chỉ làm bẩn console, có thể thêm vào FX gói ds.

## Không làm

Không sửa code, không push, không DELETE, không tạo issue hay run, không đụng TPS ngoài việc áp quyền theo kế hoạch.

Worktree `.worktrees/paperclip-r3-dp` vẫn giữ (chỉ đọc) để dùng cho DP-3. Không còn process nền nào.
