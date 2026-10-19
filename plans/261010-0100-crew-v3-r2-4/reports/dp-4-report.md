# DP-4 R2-4: deploy `crew/r24` @ `d58730c70` (FX-CR, FX-WZC, FX-RT), chạy lại AC5, kiểm FX-OVR-REVIEWER và FX-WZC

- Thời gian: 2026-10-10 17:37 → 17:58 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Phạm vi:
  - FX-CR `ea25675e7`: trang Máy làm tròn chi phí OpenCode.
  - FX-WZC `2e2589134`: wizard chọn environment mẫu đúng company, agent Codex có `engine=cli`, readiness A1 kiểm `engine`.
  - FX-RT `8f3b74278` + `6ce688841`: plugin chỉ đánh thức agent đích sau khi run cũ rời issue; H2 đặt override theo vai trò khi issue đổi giữa executor và agent của stage.
  - Merge `d58730c70`.
  - Không có migration mới. Không cài lại app hay crew-mac: `git diff 23670d7..r24` của repo Crew rỗng.
- Kết quả: **DONE_WITH_CONCERNS.**
  - Prod chạy `crew-v3/paperclip:v3-d58730c70`, không phải rollback.
  - AC5 đạt về hành vi: run Codex bị giữ, sau đó fallback sang Claude, và Claude **tự chạy** khoảng 33 giây sau quyết định, không ai comment đánh thức. Khối Runtime hiện đúng quyết định. Nhưng **không có comment reconcile của H1**, xem mục 3.
  - FX-OVR-REVIEWER đạt ở bước sang reviewer.
  - FX-WZC đạt mà không phải tạo agent.
  - Công tắc Codex đã trả về **BẬT**.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-d3ab1ef78` |
| Image sau | `crew-v3/paperclip:v3-d58730c70` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-174310`, đưa về `v3-d3ab1ef78`. Không có migration mới |
| Backup DB | `20261010-1741` (trước deploy), `20261010-1743` (`deploy.sh`), `20261010-1745` (trước AC5). Đều 27M, builtin ok |
| Script ops VPS | Không đổi: mọi file `ops/*` trên VPS trùng sha256 với fork, nên không scp |
| Tag cục bộ | `crew/v3.3-rc5` (annotated) trên `d58730c70`. Chưa push |

## 1. Deploy

**Cổng kiểm.** Worktree `.worktrees/paperclip-r3-dp` chạy `git checkout --detach crew/r24` (`d58730c70`, sạch).

`verify.sh` chạy 17:38:16 → 17:40:53, rc 0, **XANH**:

| Mục | Kết quả |
|---|---|
| Server crew | 621 (29 file) |
| Adapter claude / codex / opencode | 17 / 10 / 12 |
| Plugin | 432 (51 file) |
| Agents | 136 |
| tsc | 0 lỗi |
| Bundle | không có `require("react")` trần |
| check-core-hooks | ok, chỉ có cảnh báo "chưa có PR upstream" |

Kiểm thêm:
- ops `node --test crew/ops/*.test.mjs`: 75/75.
- crew-web `vitest`: 118 file, 981 ca xanh (1 todo). `tsc -b`: 0 lỗi.
- `ipcs -m` trước và sau: 6 → 6.

**Các bước:**
1. **Chuẩn bị.** `active-runs.sh` rỗng, image `v3-d3ab1ef78`. `backup.sh` → `20261010-1741` ok.
2. **overlay-source.sh.** `crew/ops/overlay-source.sh d58730c70`, rc 0, 17:42:00 → 17:42:05, upload 26 file server. Tarball có 149 mục, trong đó có `crew-adapter-expect.json`, `crew-commit.txt` = `d58730c70a9c…`, và `server/src/crew/issue-gate.ts`.
3. **Build.** `overlay-job.sh d58730c70` chạy 17:42:09 → 17:42:22, `JOB_EXIT rc=0`, `min_avail=5217MiB`.
4. **inspect-image.sh trên VPS:** rc 0.
   - `issues crewCoreHooks=3`, đủ 12 file crew ok, `plugin events delivered as call ok`, `crew-ui=d58730c70a9c…`.
   - Vá adapter P2–P7 kiểm trong image đều ok, hash giống DP-3.
   - Chỉ có cảnh báo `WARNING … host adapter check SKIPPED`, đúng như mong đợi.
5. **inspect-image.sh từ Mac** (`DOCKER_HOST=ssh://nhamoiplatform`, theo commit): rc 0, 0 MISSING/FAIL/WARN.
6. **Deploy.** `deploy.sh crew-v3/paperclip:v3-d58730c70` chạy 17:43:03 → 17:43:42, rc 0, in `deploy ok: … v3-d3ab1ef78 -> … v3-d58730c70, rollback TS=20261010-174310`. Log nằm ở `ops/deploy-d58730c70.log`.

**Kiểm sau deploy:**

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `ok`, commit `d58730c70a9c…` |
| Plugin | `plugin-state.sh` trả `healthy` |
| Site | Đều 200: crew `/` (mốc `crew-ui=d58730c70a9c…`), `/cli-auth/x`, `/paperclip/` (title Paperclip), `2p-solutions.com`, `kidyschool.com` |
| `check-crew-companies.sh` | `ok 2 company` |
| `agent-permissions.sh` | TPS `--check --assistant 6c27410e…`: rc 0. `--all-crew --check`: rc 0 |
| Log server từ lúc deploy (195 dòng) | 0 `"access_token"`/`"refresh_token"`/`"id_token"`. 0 `config.get`, `host refused`, `INVOCATION_SCOPE_DENIED`. 0 error, 0 warn. claim 12 lần |

## 2. FX-WZC: kiểm mà không tạo agent

Wizard Tạo agent không có bước xem trước: chạy là tạo thật. Vì vậy em kiểm bằng cách chạy **đúng code đã deploy** trên dữ liệu prod.

- **Bundle prod có bản sửa.** Chunk `assets/resume-DdnjoB-E.js` có `pickCompanyTemplate`, hàm này gọi `e.secrets.list(t)` rồi lọc theo id secret.
- **Chạy hàm thật.** Em dùng esbuild bundle `pickCompanyTemplate` và `crewRuntimeConfigOf` từ worktree `d58730c70` vào scratchpad (worktree vẫn sạch), rồi chạy trên `GET /companies/TPS/environments` (62 environment của cả instance) và `GET /companies/TPS/secrets` (2 secret: `9df35ec4` webhook, `fa7b4847` SSH Mac mini).
  - Với dữ liệu hiện tại, mẫu được chọn là `repo-a-reviewer-codex` `c9996efa`, secret TPS `fa7b4847`.
  - Bỏ 2 environment repo-a để mô phỏng lúc DP-1: mẫu được chọn là `mac-mini-bmad` `e0444a48`, secret `fa7b4847`. `crew-e2e-template` `5b825e93` (vẫn `active`, secret E2E `f8c68dce`, chính bản gây FX-WZ-SECRET) **bị loại** vì secret không thuộc TPS.
  - `crewRuntimeConfigOf`:

    | Ô | engine | command | effort | Khác |
    |---|---|---|---|---|
    | `executor-codex` | `cli` | `crew-codex-run` | medium | bypass true, env chỉ có `CODEX_HOME` |
    | `reviewer-codex` | `cli` | `crew-codex-run` | high | bypass true, env chỉ có `CODEX_HOME` |
    | `executor-opencode` | (không đặt) | `crew-opencode-run` | — | env rỗng |
- **API 2 agent Codex sau deploy:**
  - `repo-a-executor-codex`: `engine cli`, `gpt-6-luna`/medium, environment `07f2fb67`.
  - `repo-a-reviewer-codex`: `engine cli`, `gpt-6-sol`/high, environment `c9996efa`.
  - Cả hai environment đều trỏ secret TPS `fa7b4847`.
- **Không tạo hay gỡ agent nào.**

## 3. AC5 chạy lại: tắt Codex → fallback Claude

Project `repo-a` (TPS, "Spike Mac" `280cf1de`). Tải Mac lúc bắt đầu là 3.1. Backup `20261010-1745`.

| Giờ | Sự kiện |
|---|---|
| 17:45:42 | Tạo gốc TPS-110 `462f47e6`. Không giao ai. Có quyết định `select reviewer claude_local` "chỉ issue con được reviewer Codex" |
| 17:45:51 | **Tắt Codex trên trang Máy** (UI, `POST …/runtime-switches`). DB: `codex_local enabled=f`. Ảnh `01-tat-*` |
| 17:46:16 | TPS-111 `7221a993` (con của TPS-110) giao thẳng `repo-a-executor-codex`, override `{gpt-6-luna, medium}`, marker `runtime=codex_local`. Có `select executor codex_local gpt-6-luna` và `select reviewer claude_local "executor đã là Codex"`. Run `30aad859` `queued` |
| 17:46:17 | Run bị **giữ**: `crew.runtime_gate.waiting`, có dòng `crew_runtime_waits` |
| 17:48:03 | **Fallback**: `crew_runtime_decisions #18 executor fallback trigger=switch_off → claude_local mac-claude claude-sonnet-5`, lý do "runtime đang tắt trên máy". Issue giao cho `mac-claude`, override `{claude-sonnet-5, medium}`. Comment "Crew: chuyển từ codex_local (repo-a-executor-codex) sang claude_local (mac-claude)… Nhánh và commit của run trước được giữ." Activity `crew.assignee_overrides.handoff` cất `executorOverrides {gpt-6-luna, medium}` cho executor Codex |
| 17:48:07 | Run Codex `30aad859` `cancelled` (`crew_runtime_fallback`). Run này chưa bắt đầu, nên không gọi model |
| **17:48:36** | **Run Claude `4e6654e0` tự chạy** (bắt đầu 17:48:37), 33 giây sau quyết định. Không có comment đánh thức của owner. Wake `issue_assignment_recovery` (nguồn `automation`) |
| 17:49:03 | Job plugin đặt `handled_at` cho dòng chờ. FX-RT thấy agent đích đã có run nên không đánh thức lần hai: chỉ có **1 run Claude** |
| 17:50:54 | `crew-commit sha=e277f092… branch=crew/TPS-111` (commit `e277f09` trong `~/crew-agents/mac-claude`) |
| 17:51:04 | "Executor: xong, chờ review." Issue chuyển `in_review` và giao `reviewer`. `assignee_adapter_overrides` = **null** |
| 17:51:07–17:52:26 | Reviewer Claude `bb9a6da5` chạy `claude-sonnet-5` (cấu hình agent): `crew-review … verdict=approved`. Issue `done` |
| 17:54:48 | **Bật lại Codex** qua UI. Hộp xác nhận hiện "Bật Codex trên Phans-Mac-mini.local? Run mới của runtime này sẽ dùng quota gói Codex của owner…", em bấm "Bật Codex". DB: `enabled=t`. Ảnh `02-bat-*` |

**Khối Runtime trang TPS-111** (ảnh `dp4-shots/03-TPS-111.png`): "Chuyển · repo-a-executor-codex · Codex → mac-claude · Claude · claude-sonnet-5 · độ khó small · công tắc runtime đang tắt". Reviewer: "reviewer · Claude · executor đã là Codex". Đạt.

**Kết luận AC5:**
- **Đạt:** run bị giữ, fallback trong khoảng 2 phút sau khi tắt (106 giây sau khi bị giữ), agent đích tự chạy, quyết định `fallback` có trong khối Runtime, không đánh thức hai lần.
- **Không có comment reconcile** "Crew: chuyển runtime sau run …". Có hai lý do:
  1. Run Claude do core `issue_assignment_recovery` khởi động, không phải wake `crew_runtime_fallback` của plugin. H1 chỉ kiểm tiến độ run cũ khi `wakeReason = crew_runtime_fallback` (`load-gate.ts:372`). Vì vậy không có bước kiểm tiến độ, không có activity `…checked` và không tách worktree cũ.
  2. Dù wake đúng lý do, comment chỉ đăng khi run cũ **có commit** (`load-gate.ts:743`). Run Codex bị giữ trước khi bắt đầu nên có 0 commit, và theo thiết kế sẽ chỉ có activity, không có comment. Trong kịch bản tắt công tắc trước khi chạy, comment reconcile không bao giờ xuất hiện.

  Với issue mới này hậu quả bằng 0: Claude tạo nhánh `crew/TPS-111` mới và commit bình thường. Rủi ro nằm ở FX-FB-RECOVERY bên dưới.

## 4. FX-OVR-REVIEWER

- **Executor Codex → executor Claude** (fallback, override ghi tường minh): đúng. Override của executor Codex `{gpt-6-luna, medium}` được cất vào activity `crew.assignee_overrides.handoff`.
- **Executor Claude → reviewer Claude:** cột `assignee_adapter_overrides` của issue là **null** lúc `in_review` (theo dõi 17:51:18). Run reviewer chạy `claude-sonnet-5`, đúng cấu hình agent, không có model Codex. Override của executor `{claude-sonnet-5, medium}` được cất cho `mac-claude`. **Đạt.**
- **Trả về executor:** không tới bước này, vì reviewer duyệt ngay lần đầu. Em không ép thêm vòng để giữ số run thấp. Ca này có trong test DB của FX-RT (`crew-runtime-handoff.db.test.ts`).
- **Ghi chú nhỏ (FX-OVR-AUDIT):** activity handoff lúc 17:51:04 ghi `assigneeAdapterOverrides: {claude-sonnet-5, medium}`, trong khi cột thật là null. Nguyên nhân: `issue-gate.ts` ghi `next ?? locked.assigneeAdapterOverrides`, nên khi `next === null` thì activity lấy giá trị cũ. Lỗi này chỉ làm sai nhật ký, không đổi hành vi.

## 5. Số run

| Loại | Run |
|---|---|
| Codex có gọi model | **0** (`30aad859` bị giữ rồi hủy, chưa bắt đầu) |
| Claude | **2**: executor `4e6654e0` (mac-claude), reviewer `bb9a6da5` |

Quota Codex trên trang Máy vẫn 31%.

## 6. FX-CR

Trang Máy hiện "Chi phí OpenCode: ngày $chưa rõ/$12,00 · tuần $2,93/$30,00 · tháng $2,93/$60,00 (USD)". **Đạt**: không còn `2.9309000000000003`.

## 7. Dọn

- Issue: TPS-110 `cancelled`, TPS-111 `done`.
- `active-runs.sh` rỗng. Trên Mac không có `codex exec` hay `claude --print`.
- Nhánh thử `crew/TPS-111` (`e277f09`) chỉ có ở worktree local `~/crew-agents/mac-claude`. Origin `~/crew-spike/repo-a-origin.git` chỉ có `main`. Không push gì.
- Công tắc Codex: **BẬT** (17:54:48).
- Playwright Node: mật khẩu `.env` VPS truyền qua stdin, không trace, không lưu state, có sign-out (200). Request ghi gồm sign-in, sign-out, 2 lần `POST …/runtime-switches` (tắt, bật), `POST /api/issues/7221a993…/read` (mở trang issue), còn lại là `POST …/data/*` để đọc dữ liệu plugin.
- Quét scratchpad, ảnh và ledger: 0 file chứa mật khẩu. File mật khẩu tạm đã `rm -f`.
- Không còn process nền: monitor và lệnh chờ đã dừng.
- Ảnh nằm ở `reports/dp4-shots/`.

## FX đề xuất (chưa sửa code)

1. **FX-FB-RECOVERY (Major).**
   - Hiện tượng: sau fallback, core `issue_assignment_recovery` đánh thức agent đích (17:48:36) trước job phút của plugin (17:49:03). Run đó không mang `wakeReason = crew_runtime_fallback`, nên H1 bỏ qua kiểm tiến độ và tách worktree của run cũ.
   - Lần này vô hại vì run cũ chưa chạy và nhánh còn mới. Nhưng nếu executor Codex đã từng giữ nhánh `crew/<issue>` (ví dụ issue quay lại executor sau review khi Codex tắt), run Claude có thể không `git switch` được hoặc làm lại phần đã commit.
   - Hướng sửa: H1 coi run đầu tiên của `to_agent_id` trên issue sau một quyết định `fallback` (bất kể `wakeReason`) là run fallback. Hoặc plugin chặn recovery bằng cách đánh thức ngay khi run cũ vừa bị hủy.
2. **FX-OVR-AUDIT (Minor).** Activity `crew.assignee_overrides.handoff` ghi override cũ khi override mới là `null`, vì dùng `next ?? locked…`. Cần phân biệt `undefined` với `null`.
3. **Ghi chú spec AC5.** Comment reconcile chỉ có khi run cũ có commit. Với ca tắt công tắc trước khi run chạy, không bao giờ có comment này, nên AC5 nên kiểm activity `…checked` thay cho comment.

Status: DONE_WITH_CONCERNS
Summary: Prod v3-d58730c70 (rollback `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-174310` → v3-d3ab1ef78), health, plugin và 5 site ok, tag cục bộ crew/v3.3-rc5. AC5: run Codex bị giữ rồi fallback sang mac-claude, Claude tự chạy sau 33 giây và reviewer Claude duyệt. FX-OVR-REVIEWER đạt (override null ở reviewer). FX-WZC và FX-CR đạt. Run: Codex 0, Claude 2. Codex BẬT lại.
Concerns/Blockers: Không có comment reconcile H1, vì run đích do core recovery đánh thức (FX-FB-RECOVERY) và run cũ không có commit. FX-OVR-AUDIT là lỗi nhỏ ở nhật ký.
