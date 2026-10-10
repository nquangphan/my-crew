# DP-X3 và AC-X2 R3X: deploy `crew/r3x` @ `39a91bd90` lên prod, chạy lại T2 trên Crew E2E

- Thời gian: 2026-10-10 11:23 → 12:01 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Kết quả: **DONE_WITH_CONCERNS.**
  - Prod chạy `crew-v3/paperclip:v3-39a91bd90`. Plugin `crew.core` ready, không có quyền hay migration mới. Không phải rollback.
  - T2 đủ (89 ca): lượt đầy đủ cho 65 xanh, 6 đỏ, 18 bỏ qua. Cả 6 ca đỏ là lỗi spec hoặc harness. Sửa spec xong, chạy lại 6 ca này thì xanh hết. Kết quả cuối: **71 xanh, 0 đỏ, 18 bỏ qua**.
  - **AX10 Đạt**: `no-dead-controls` trên prod cho 18 xanh, 4 bỏ qua, 0 đỏ.
  - Run phát sinh: **12**, đều chạy stub (`crew-e2e-stub`, cost 0). 0 run Claude thật.
  - Concern: tìm thấy 2 lỗi sản phẩm (FX-AC2-P1, FX-AC2-P2) quanh việc dùng lại khóa project đã gỡ. Còn 1 dòng mồ côi trong `~/.crew/status-repos.json`.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-c55a16a0c` |
| Image sau | `crew-v3/paperclip:v3-39a91bd90` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-112827` (đưa về `v3-c55a16a0c`) |
| Backup DB | `20261010-1127` (làm tay, 26M, builtin ok); `deploy.sh` backup thêm `20261010-1128` |
| Script ops VPS cũ | `/opt/crew-v3-spike/ops.bak-dpx3-r3x/` |
| Tag cục bộ | `crew/v3.5-rc4` (annotated) trên `39a91bd90`. Chưa push |

## DP-X3

1. **Cổng kiểm.** Worktree `.worktrees/paperclip-r3-dp` chạy `git checkout --detach crew/r3x` (`39a91bd90`, sạch), rồi `pnpm install --frozen-lockfile`.
   - Diff `c55a16a0c..39a91bd90` chỉ đụng `packages/crew-web` (src, test, e2e). Không đổi server, plugin hay migration.
   - `crew/release/verify.sh` chạy 11:24:08 → 11:26:15, rc 0, **XANH**: hook 5/5, vá lõi 6, lỗi 0; server 25 file / 508 ca; adapter 3 / 17; plugin 44 / 327; tsc 0.
   - Test ops 62/62. crew-web vitest 114 file, 878 ca xanh; `tsc -b` 0 lỗi.
   - `ipcs -m` trước và sau chỉ có 1 đoạn cũ.
2. **Chuẩn bị.**
   - `active-runs.sh` rỗng.
   - Backup `20261010-1127`.
   - Sao lưu `ops/` vào `ops.bak-dpx3-r3x`. So sha256 của 21 file (`ops/*.sh`, `*.py`, `nginx-crew.conf`): VPS trùng fork, nên không scp.
3. **Build.**
   - `overlay-source.sh 39a91bd90` rc 0 (23 file server).
   - `overlay-job.sh`: `JOB_EXIT rc=0`, `min_avail=5175MiB`.
   - `inspect-image.sh` không có dòng MISSING hay FAIL: `issues crewCoreHooks=3`, đủ 12 file crew, events as call ok, `crew-ui=39a91bd904848d…`. Manifest có đúng các quyền như `c55a16a0c`.
4. **Deploy.** `deploy.sh` chạy 11:28:20 → 11:28:54, rc 0, in `deploy ok: v3-c55a16a0c -> v3-39a91bd90, rollback TS=20261010-112827`. Plugin healthy.
5. **Kiểm sau deploy.**

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `status ok`, commit `39a91bd904848d…` |
| Plugin | `plugin-state.sh` trả `healthy` (ready, không `upgrade_pending`) |
| Các site | crew `/`, `/cli-auth/x` (`crew-ui=39a91bd90…`), `/paperclip/` (title Paperclip), `/paperclip/TPS/issues/TPS-72`, `2p-solutions.com`, `kidyschool.com` đều 200 |
| `check-crew-companies.sh` | `ok 2 company` |
| `agent-permissions.sh --all-crew --check --assistant 6c27410e…` | rc 0 |
| Log | 0 dòng `config.get`, `host refused` hay `INVOCATION_SCOPE_DENIED` |
| App Mac | 80 lần claim trả 204. Có 4 lần 502, chỉ trong lúc restart |

## AC-X2: T2 trên Crew E2E

Cách chạy:

- Lệnh: `run-e2e.sh --project=t2 --retries=0` trong worktree `paperclip-r3-e2e` (nhánh `crew/r3x-e2e`).
- Mật khẩu đọc từ `.env` VPS qua stdin. Trace tắt ở 3 spec có điền mật khẩu.
- Lượt nào script quét `test-results` cũng báo "không chứa mật khẩu".
- TPS chỉ đọc.

### Khóa `e2e-base` không dùng lại được

Lượt 1 (11:30 → 11:35) dừng ngay ở global-setup. Wizard dựng lại `e2e-base` (setup run `f5f92f17`):

- các bước `inspect`, `project`, `checkouts` xong;
- bước `environments` failed với lỗi `An environment named "e2e-base-assistant" already exists for this instance`. Environment này là bản đã archive của AC-X, vẫn giữ tên, mà tên environment là duy nhất trong cả instance.

Lần thử hỏng để lại project mồ côi `031a121f` "E2E base 2" và 5 checkout sạch, không có environment hay agent nào. Gỡ project này qua luồng gỡ thì bị từ chối với lời báo "Không bắt đầu được lần gỡ: Khóa project đã thuộc project khác" (FX-AC2-P2).

Em dọn tay như sau:

- dùng cách `parkProject` của harness (PATCH `archivedAt`, 200, không DELETE);
- chạy `git worktree remove` cho 5 checkout sạch;
- `rmdir ~/crew-agents/e2e-base`.

Spec sửa để khóa nền đọc `CREW_E2E_BASE_KEY`. Lượt 2 dùng `e2e-base2`: wizard dựng xong (project "E2E base 3"), stub bật 5 giây cho cả 5 checkout.

### Bảng ca T2

Lượt 2 chạy đủ 89 ca (11:42 → 11:53): 65 xanh, 6 đỏ, 18 bỏ qua. Sau khi sửa spec, lượt 3 chạy lại 6 ca đỏ (11:57 → 11:59) và cả 6 xanh.

| Nhóm / ca | Lượt 2 | Lượt 3 | Ghi chú |
|---|---|---|---|
| **AX10** `no-dead-controls` AC5 (22 route) | 18 xanh, 4 bỏ qua | — | **Đạt.** Nút EN ở chân sidebar hết bị che (FX-ACW). 4 ca bỏ qua vì route thiếu tham số (`runs/:runId` ×2, `issues/:ref`, `skills/:skillId`) |
| AX1 PW-S6-17a, 17b, 18 | xanh | — | |
| **PW-S6-17c** | đỏ | **xanh** | Spec: kỳ vọng 0 `board_override`. Trên T2, project Crew áp workflow 4 stage nên Ép Done luôn ghi 1 override `stage_unapproved:*`, như AC-X đã chấp nhận. Đã sửa kỳ vọng theo tầng |
| **PW-S6-17d** (AX2 con cuối) | **xanh** | — | Harness FX-ACE đã sửa |
| PW-S6-17e, 17f, 17g, 7R (AX2, AX3) | xanh | — | |
| AX4/AX5 PW-S14-5, 5b, 5c, 6, 7 | xanh | — | **`removeSkillViaUi` sinh việc máy `skill-remove` thật**: 3 việc `done` với `removed: true` (`e2e-edit-*`, `first-task-fork`, `e2e-del-*`). `~/.crew/skills/<Crew E2E>/` rỗng |
| AX6/AX9 PW-X-AX6, 6b, AX9, 9b | xanh | — | |
| **PW-S8-7 / F10** (gỡ project qua wizard) | đỏ | **xanh** | Spec: mở dialog ngay sau wizard, lúc máy chưa báo checkout ("Máy chưa báo checkout nào."). Đã sửa để mở lại dialog tới khi báo cáo máy có checkout bẩn. Lượt 3: `remove-checkouts` cho `kept [executor]`, các checkout sạch đã gỡ |
| **PW-S11-9** (gỡ agent qua wizard) | đỏ | **xanh** | Spec: đọc `AGENTS.md` của repo trong checkout, không phải AGENTS.md của Trợ Lý. Đã sửa để đọc instructions bundle qua API: trước khi gỡ có id executor-2, sau khi gỡ thì không. Lượt 3: `remove-checkouts` gỡ `executor-2` |
| **PW-S0-2** | đỏ | **xanh** | Harness: hàm chặn ghi TPS chặn luôn `POST …/data/crew.companies`, vốn là lệnh đọc. Đã cho data plugin đi qua; lệnh ghi có id TPS vẫn bị chặn |
| **PW-S3-3** | đỏ | **xanh** | Spec bấm quá nhanh: bấm "Đánh dấu tất cả đã đọc" trước khi danh sách tải lại kịp có mục vừa đánh dấu chưa đọc. Nút này chỉ đánh dấu các mục đang hiện trong tab. Đã sửa để chờ dòng hiện ra rồi mới bấm |
| **PW-S5-5** | đỏ | **xanh** | Spec lấy run mới nhất của issue, đó là run `issue_disposition_repair` ở `scheduled_retry` (hành vi stock khi chạy stub). Run giao việc `4d7736bc` đã `succeeded`. Đã sửa để kiểm run đầu tiên |
| Các ca còn lại (s0, s1, s2, s3, s4, s5, s6-popup, s19, f5, t1-smoke…) | xanh | — | |
| Bỏ qua (18) | — | — | 12 ca `@shots` (cần `CREW_E2E_SHOTS=1`); 4 route AC5 thiếu tham số; PW-S3-1 và PW-S6-STALE tự bỏ qua theo điều kiện của chính ca |

Commit spec trên `crew/r3x-e2e`: **`629357fa2`** "test(e2e): sửa harness T2 sau lượt chạy trên prod".

- 8 file, `git add` đúng path: `e2e/README.md`, `support/{env,api}.ts`, `specs/{s3-inbox,s5-new-request,s6-force-done,s8-remove-project,s11-remove-agent}.spec.ts`.
- Kiểm: `tsc -p e2e` sạch, `biome check e2e` sạch, `vitest test/e2e-coverage.test.ts` 4 xanh.
- Không sửa code sản phẩm. Chưa push.

## FX

- **FX-AC2-P1 (sản phẩm, wizard Thêm project).** Kiểm khóa ở `add-project/validate.ts` chỉ xét project còn sống. Khóa của project đã gỡ vì vậy lọt qua, rồi hỏng ở bước `environments`: tên `<khóa>-<vai trò>` đã có ở environment archive, mà tên là duy nhất trong instance (`run-step.ts:345-372`, chỉ nhận lại env `active`). Lần hỏng để lại project mồ côi và checkout. Gợi ý: chặn ngay ở bước nhập ("khóa đã dùng cho project đã gỡ"), hoặc đặt tên environment có hậu tố.
- **FX-AC2-P2 (sản phẩm, luồng gỡ).** Project mồ côi từ một lần add-project hỏng, dù dùng lại khóa, không gỡ được. Luồng gỡ báo "Khóa project đã thuộc project khác", vì khóa vẫn gắn với project đã gỡ trước đó (`0143506c`). Người dùng không có cách dọn trên UI.
- **FX-AC2-H1 (harness, nhỏ).** Khi s11 xanh, khối `finally` vẫn gọi `parkProject`, nên project `e2e-rm-*` bị archive mà 4 environment còn `active` và checkout vẫn còn trên Mac. Lần này em dọn bằng cách bỏ archive rồi gỡ qua luồng gỡ. Nên đổi `finally` thành gỡ qua UI khi ca xanh.
- **Ghi nhận (không phải lỗi):** nút "Đánh dấu tất cả đã đọc" của Hộp thư chỉ đánh dấu các mục đang hiện; danh sách tải lại sau mỗi lần đánh dấu chứ không cập nhật trước (không optimistic).

## Dọn dẹp (cuối phiên 12:01)

- **Issue Crew E2E:** 65 issue, 21 `done`, 44 `cancelled`. 0 issue mở.
- **Project:**
  - `E2E base 3` (`e2e-base2`) gỡ qua luồng gỡ.
  - `e2e-rm-mv1xc53` do s8 gỡ qua luồng gỡ.
  - 3 project `e2e-rm-*` bị `parkProject` archive (của s11 lượt 2 và 3, s8 lượt 2): bỏ archive (PATCH `archivedAt: null`), rồi gỡ qua luồng gỡ trên UI.
  - Mồ côi `031a121f`: chỉ archive (FX-AC2-P2).
  - Còn 0 project sống. `crew_project_roles` còn 0 dòng.
  - Request DELETE duy nhất là DELETE roles (đúng thiết kế).
- **Environment:** 30 environment `e2e-base*` và `e2e-rm-*` đều `archived`, không DELETE. 13 environment khác vẫn `active`, đúng bằng số lúc AC-X.
- **Agent:** 30 `paused`; 4 agent giữ chỗ vẫn `idle`.
- **Mac:**
  - `~/crew-agents/e2e-*` trống.
  - Hai checkout bẩn `executor` (của s8 lượt 2 và 3) được giữ đúng thiết kế. Em xóa tệp thử `dirty-e2e.txt` do spec tạo, kiểm `git status` sạch, rồi chạy `git -C <path> worktree remove <path>` (không `--force`) và `rmdir`.
  - `~/crew-e2e/repo`: `worktree list` chỉ còn `main`, repo sạch.
  - Stub: 0 marker, vì không còn checkout `e2e-*`.
- **Skill:** 8 skill bundled. `~/.crew/skills/<Crew E2E>/` rỗng.
- **Còn lại:** `~/.crew/status-repos.json` vẫn có dòng `031a121f` (project mồ côi, repo `~/crew-e2e/repo`). Đây là tệp app quản lý nên em không sửa tay. Dòng này sẽ mất khi FX-AC2-P2 có lối gỡ.
- **Run:** Crew E2E có 12 run mới (8 `cancelled`, 4 `succeeded`), mọi run có phiên `crew-e2e-stub`, cost 0. Tổng Crew E2E là 16 run. 0 run queued/running/scheduled_retry trên toàn prod.
- **Process:** không còn process nền nào do em khởi động. Chrome của Playwright MCP đang chạy là của phiên khác.
- **An toàn:** không `rm -rf`, không DELETE environment/project/agent, không push, không sửa code sản phẩm.
- **File tạm:** spec tạm, log và bản lưu error-context để ở scratchpad phiên, ngoài repo.
