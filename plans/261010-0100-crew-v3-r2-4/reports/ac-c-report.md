# AC-C R2-4: nghiệm thu phần Codex trên prod `v3-d3ab1ef78` và Mac mini

- Thời gian: 2026-10-10 16:29 → 17:20 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Prod: `crew-v3/paperclip:v3-d3ab1ef78`. Mac mini: crew-mac `23670d7`, codex-cli 0.161.0.
- Project thử: `repo-a` (TPS, "Spike Mac" `280cf1de`). Không đụng `2ps-landing`.
- Backup DB trước khi làm: `20261010-1632` (26M, builtin ok).
- Owner đã bật công tắc Codex lúc 16:25:52 (`updated_by 8b52…`). Lúc kết thúc công tắc vẫn **BẬT** (em tắt 16:54:59 rồi bật lại 17:10:07 qua UI, có hộp xác nhận).
- Kết quả: **DONE_WITH_CONCERNS.** 10/11 AC đạt (có 3 AC đạt nhờ owner gỡ tay dữ liệu hoặc wake). AC5 chỉ đạt một phần. Tìm ra 4 lỗi cần FX, trong đó có 2 lỗi chặn hẳn đường Codex trên prod nếu không gỡ tay.

## 1. Bảng AC

| AC | Kết quả | Bằng chứng |
|---|---|---|
| **AC3** Codex executor | **Đạt** (sau khi sửa dữ liệu FX-WZ-SECRET, FX-WB-CODEX-ENGINE) | TPS-106 `f2aa501d`, owner tạo qua API, giao thẳng `repo-a-executor-codex`, marker `crew-model complexity=small model=gpt-6-luna effort=medium runtime=codex_local …`. Run `6a5a9e88` 16:54:45→16:55:58. `ps` thấy `codex exec --json --dangerously-bypass-approvals-and-sandbox --model gpt-6-luna -c model_reasoning_effort="medium" -`. Log run có `crew-workflow ok runtime=codex_local superpowers=6.4.1`. Commit `c3880d1` trên `crew/TPS-106` trong `~/crew-agents/repo-a/executor-codex`, comment `crew-commit sha=c3880d1f…`. Reviewer Claude duyệt (`2562b4d3`, `verdict=approved`). Session agent ghi `model gpt-6-luna`, effort `medium`. VPS: `find / -name auth.json` trong container = 0 file, `crew-codex-home/repo-a/executor-codex` chỉ có `config.toml` + `skills`, host `/opt/crew-v3-spike/data` = 0 `auth.json`. Log container từ 16:30: 0 dòng `"access_token"` / `"refresh_token"` / `"id_token"` (có dấu nháy). Grep không dấu nháy ra 4 dòng, đều là request quét từ internet tới `/access_tokens.db` |
| **AC4** Tắt Codex không giết run | **Đạt** | Lúc 16:54:59 tắt Codex trên trang Máy (UI, `POST …/runtime-switches`, audit `crew.runtime_switch.set before=true after=false`) khi run `6a5a9e88` đang chạy. Run vẫn xong: commit, `Executor: xong, chờ review.` lúc 16:55:58. `crew.remote_stop matched=0 killed=0`, reaper không có dòng TERM nào (log `~/.crew-mac/reaper/reaper.log` dừng ở 07/10). Run kết thúc `cancelled/issue_reassigned`, giống run Claude bình thường khi issue chuyển sang review. TPS-107 `7ba4600c` giao executor Codex tạo 16:55:17: run `c1bf4ea7` `queued`, activity `crew.runtime_gate.waiting` + `crew_runtime_waits` 16:55:58 |
| **AC5** Fallback theo công tắc + reconcile | **Đạt một phần** | Đạt: 16:57:16 (≈80 giây sau khi bị giữ) có `crew_runtime_decisions kind=fallback trigger=switch_off from codex_local → claude_local mac-claude model claude-sonnet-5`; comment `Crew: chuyển từ codex_local (repo-a-executor-codex) sang claude_local (mac-claude), model claude-sonnet-5. Lý do: runtime đang tắt trên máy…`; run Codex bị hủy `crew_runtime_fallback`; `crew_runtime_waits.handled_at` 16:57:16; trang issue hiện "Chuyển · repo-a-executor-codex · Codex → mac-claude · Claude". **Không đạt:** run Claude không tự chạy (FX-FB-WAKE). Wake `crew_runtime_fallback` `f8d8c14e` nằm `deferred_issue_execution` 13 phút. Lúc 17:07:17 em comment thay owner thì mới có run `51409e7f` trên cùng máy (`~/crew-agents/mac-claude`, commit `8708d33`, reviewer Claude duyệt). Vì run chạy theo wake comment nên **không có comment reconcile** của H1 |
| **AC6** Fallback quota (test DB) | **Đạt (test, không đo prod)** | `packages/crew-plugin` `runtime-fallback.db.test.ts` @ `d3ab1ef78`: 20/20 xanh (Postgres nhúng, `ipcs -m` trước/sau 3/3). Có ca quota: một quyết định, đổi assignee + override, đánh thức một lần, gửi lại không làm gì; ca `large` `fallback_refused`. Không tái hiện quota thật trên prod (đúng spec) |
| **AC7** Kiểm override | **Đạt (test, không đo prod)** | `crew-issue-create-policy.test.ts` + `crew-model-policy.test.ts`: 83/83 xanh, có ca 422 `crew_override_forbidden` `violations ["adapterConfig.model:claude-opus-5@opencode_local"]`. Trên prod không đo được: luật chỉ áp cho issue do **agent** tạo, mà board không đóng vai agent được, và repo-a không có executor OpenCode |
| **AC9** Hook | **Đạt** | `check-core-hooks.mjs` @ `d3ab1ef78`: "Hook một dòng: 5/5; vá lõi: 6; mục: 18; lỗi: 0" (H1–H5, C1–C6, P1–P7; chỉ cảnh báo "chưa có PR upstream"). `base` `v2026.1005.0`. `git diff crew/r3x..d3ab1ef78`: ngoài phạm vi mục 9 chỉ có đúng 3 file adapter P5–P7 + test `*.crew.test.ts`, cộng `crew/ops/**` (FX-OPS đã được Trợ Lý nhận) |
| **AC10** Bản tin + công tắc | **Đạt** | Trang Máy hiện Claude 2.1.296 / Codex `codex-cli 0.161.0 · đã đăng nhập` / OpenCode `1.18.35 · Chưa có key`. Quota Codex đổi theo run: 15% (đặt lại 07/11, xem O1) → **30%** sau AC3 → **31%** sau AC11 (đặt lại 16/10/2026 19:59, khớp `rate_limits` trong session agent `used_percent 30.0 / 31.0`, `window_minutes 10080`). Bật cần xác nhận ("Bật Codex trên Phans-Mac-mini.local? … dùng quota gói Codex của owner…"), tắt Codex không hỏi. Audit 3 dòng `crew.runtime_switch.set` (16:25:52 owner, 16:54:59 tắt, 17:10:07 bật) |
| **AC11** Reviewer Codex | **Đạt** (sau khi sửa dữ liệu và gỡ override) | (a) TPS-104 (con do Trợ Lý tạo, executor Claude `mac-claude`): `select role=reviewer runtime=codex_local model=gpt-6-sol reason "executor claude_local, Codex bật → reviewer codex_local"`, participant review = [reviewer Codex, reviewer Claude]. Run Codex đầu `54e6418e` hỏng (FX-WZ-SECRET rồi FX-WB-CODEX-ENGINE), plugin **tự chuyển** sang reviewer Claude: `fallback role=reviewer trigger=unavailable`, comment `Crew: chuyển reviewer từ codex_local … sang claude_local (reviewer)… Số vòng review giữ nguyên`, run `1433aa5a` approved. (b) TPS-109 `e455bf40` (executor `mac-claude-2`): reviewer Codex run `59c79c36` 17:12:36→17:13:52 succeeded, session `model gpt-6-sol` effort `high` (**m9 đã đo: sol chạy được**), `crew-workflow ok runtime=codex_local`, comment `crew-review sha=95ab08f3… verdict=approved`, issue `done`. (c) Ca tắt: TPS-108 (tạo 16:55:26 khi Codex tắt) `select reviewer claude_local reason "Codex đang tắt trên máy reviewer"`, đã hủy |
| Khối Runtime trang issue | **Đạt** | TPS-104/106/107/108/109 đều có khối RUNTIME đúng dòng select/chuyển (ảnh `ac-c-shots/03-TPS-*.png`) |
| Marker `runtime=codex_local` | **Đạt** | Marker trong mô tả TPS-106/107; `select executor to_runtime=codex_local model=gpt-6-luna complexity=small`; trang issue "gpt-6-luna · độ khó small · effort medium · runtime Codex" |
| M2 (`auth.json` symlink, refresh token) | **Đạt, chưa đo được ca refresh** | Sau 2 run: `test -L ~/.crew/runtimes/codex/{62d450f3,38a28c7d}/auth.json` đều là symlink → `~/.codex/auth.json`. `~/.codex/auth.json` sha256 `8f93ec61f94a` và mtime `09/10 03:00:24` trước và sau, tức **không có refresh token** trong 2 run. Luật đối chiếu FX-RM chưa bị kích hoạt |
| Reaper | **Đạt** | Không có TERM/kill nào trong khung AC. `remote_stop` của các run đều `killed=0` |

AC1, AC2, AC8 thuộc AC-O (OpenCode), chưa làm.

## 2. Số run

| Loại | Run | Ghi chú |
|---|---|---|
| **Codex có gọi model: 2** | `6a5a9e88` (executor, gpt-6-luna), `59c79c36` (reviewer, gpt-6-sol) | Đúng trần 2 |
| Codex không gọi model | `54e6418e` (adapter từ chối trước khi chạy codex), `c1bf4ea7`, `23917cd8` (không bắt đầu) | Không tốn quota |
| **Claude đã chạy: 9** | Trợ Lý `7f727d56`, `24d2a413`; executor `55d71581` (mac-claude), `51409e7f` (mac-claude, fallback), `2f5c8aff` (mac-claude-2); reviewer `1433aa5a`, `3e81a1f1` (hỏng sau 9 giây vì model gpt-6-luna), `2562b4d3`, `b17684b4` | Plan ước 6–7; thêm 1 Trợ Lý (lượt "automation" đặt gốc blocked), 1 reviewer hỏng do FX-OVR-REVIEWER, 1 executor vì phải dựng thêm TPS-109 cho AC11 |
| Claude không chạy | `77f9c5db` (Trợ Lý, em hủy sau khi hủy gốc), `97745dab` (wake bị kẹt, tự hủy) | |

## 3. Lỗi tìm ra (FX, chưa sửa code)

1. **FX-WZ-SECRET (Blocker cho agent mới tạo bằng wizard).**
   - Hiện tượng: environment `07f2fb67` (executor-codex) và `c9996efa` (reviewer-codex) do wizard DP-1 tạo trỏ secret `crew-e2e-ssh` `f8c68dce` của company **Crew E2E**. Cổng tải giữ run với lỗi `không kết nối được (Secret must belong to same company)`.
   - Nguyên nhân: `pickTemplate` (`packages/crew-web/src/features/wizards/add-project/run-step.ts:237`) chọn environment mẫu trên **toàn instance** (bảng `environments` không có `company_id`), ưu tiên bản có `crewLoadGate` và mới nhất. Environment E2E tạo 09/10 21:16 nên thắng.
   - Sửa: chỉ lấy environment mà secret thuộc company đang chạy wizard, hoặc environment của agent cùng company.
   - Em đã sửa dữ liệu: `PATCH /api/environments/<id>?companyId=TPS` đổi sang secret TPS `fa7b4847`, binding giờ là company TPS. Giá trị cũ để lui: `f8c68dce-5ba7-498a-85d0-a6601719e016`.
2. **FX-WB-CODEX-ENGINE (Blocker cho mọi agent Codex).**
   - Hiện tượng: run Codex hỏng `adapter_engine_unavailable`: "In-place workspace realization requires the Codex CLI engine…".
   - Nguyên nhân: `crewRuntimeConfigOf` của wizard không đặt `adapterConfig.engine = "cli"` cho `codex_local`, mà adapter codex mặc định `acp` (`packages/adapters/codex-local/src/server/acp.ts`).
   - SP-C không bắt được vì gọi `codex exec` trực tiếp, không qua adapter. T1 cũng không bắt được vì không chạy run Codex thật.
   - Sửa: wizard (và check readiness A1) đặt hoặc kiểm `engine: "cli"` cho Codex.
   - Em đã sửa dữ liệu: `PATCH /agents/<id>` merge `{adapterConfig:{engine:"cli"}}` cho `62d450f3` và `38a28c7d`. md5 `adapter_config` trước: `e49464c1…`, `3342b33c…`.
3. **FX-OVR-REVIEWER (Major).**
   - Hiện tượng: `assigneeAdapterOverrides` của issue con (đặt cho executor) áp luôn cho **reviewer**.
   - Bằng chứng: issue executor Codex (`{model gpt-6-luna}`) → reviewer Claude `3e81a1f1` hỏng `model_not_found` (gpt-6-luna). Ngược lại, issue executor Claude (`{model claude-sonnet-5, effort medium}`, như mọi con Trợ Lý tạo) sẽ đưa model Claude cho reviewer Codex.
   - Hệ quả: đường Codex review gần như luôn hỏng. Với con Trợ Lý tạo, reviewer Codex sẽ chạy sai model và fallback về Claude.
   - Em gỡ bằng cách owner `PATCH assigneeAdapterOverrides=null` trên TPS-106 (sau khi hỏng) và TPS-109 (trước review).
   - Sửa: khi chuyển sang stage review, server (H4 hoặc lõi) bỏ hoặc thay override theo runtime của reviewer; hoặc plugin xoá override khi issue vào `in_review`.
4. **FX-FB-WAKE (Major).**
   - Hiện tượng: sau fallback executor, wake `crew_runtime_fallback` của agent đích bị `deferred_issue_execution` và không được đẩy lên: 13 phút không có run.
   - Nguyên nhân: plugin gọi `requestWakeup` 16:57:16 trong khi run Codex bị giữ vẫn còn trên issue. Run đó bị hủy lúc 16:57:19, tức là sau wake. Recovery `todo` thì bỏ qua issue vì `hasQueuedIssueWake`.
   - Hệ quả: fallback không tự chạy tiếp, và H1 không có reconcile.
   - Sửa: hủy run bị giữ (`cancelSuperseded`) **trước** khi đánh thức, hoặc job fallback kiểm lại wake `deferred` của issue sau khi hủy rồi đẩy lên.

## 4. Quan sát khác

- **O1 quota:** trước AC trang Máy báo 15% "đặt lại 07/11/2026 22:19" (cửa sổ 30 ngày, có vẻ lấy từ session cũ). Sau run Codex đầu, trang báo 30%, đặt lại 16/10, cửa sổ 10080 phút. SP-C lúc 12:46 đã đo 19%, nên con số 15% là sai nguồn. Nên kiểm lại cách MR-4 chọn bản tin `token_count` mới nhất.
- **O2:** executor Codex tự đổi `package.json` (`node --test test/` → `node --test`) để `npm test` chạy được trên Node 24. Việc này ngoài mô tả issue, nhưng reviewer Claude chấp nhận và ghi lý do.
- **O3:** executor Claude (sonnet) ở TPS-107 ghi `crew-commit` với sha bịa (`8708d336e0c1a0a0…`) rồi tự sửa bằng comment thứ hai có sha đúng `8708d33c…`. Reviewer đọc sha đúng.
- **O4:** Trợ Lý chạy thêm lượt `24d2a413` (automation) để đặt gốc `blocked`, giống L2 của AC-R2-3.
- **O5:** cổng tải giữ run reviewer Codex thêm 15 phút vì máy tải 15–18 > 8. Nguồn tải là xcodebuild, iOS Simulator và VM của owner, không phải việc AC. Cổng chạy đúng thiết kế.
- **O6:** UI chi phí OpenCode vẫn hiện `2.9309000000000003` (FX-CR đang làm).

## 5. Thay đổi dữ liệu prod (không phải code)

| Giờ | Thay đổi | Lui |
|---|---|---|
| 16:45 | 2 environment Codex → secret TPS `fa7b4847` | PATCH lại `f8c68dce…` (không nên lui) |
| 16:53 | 2 agent Codex thêm `adapterConfig.engine=cli` | PATCH `replaceAdapterConfig` không có `engine` (không nên lui) |
| 16:56, 17:10 | `assigneeAdapterOverrides=null` trên TPS-106, TPS-109 | không cần |
| 16:54:59 / 17:10:07 | Công tắc Codex tắt rồi bật lại (UI) | đang BẬT như owner để |

## 6. Dọn

- Issue:
  - TPS-103 (gốc Trợ Lý), TPS-105 (gốc chứa) và TPS-108: `cancelled`.
  - TPS-104, TPS-106, TPS-107, TPS-109: `done`.
- `active-runs.sh` rỗng.
- Nhánh thử chỉ nằm local, chưa push: origin bare `repo-a-origin.git` chỉ có `main`. Các worktree đều sạch:

  | Nhánh | Worktree |
  |---|---|
  | `crew/TPS-104`, `crew/TPS-107` | `mac-claude` |
  | `crew/tps-109` | `mac-claude-2` |
  | `crew/TPS-106` | `repo-a/executor-codex` |

- Không còn process nền: monitor và Playwright đã thoát, không lưu state đăng nhập.
- Ảnh nằm ở `reports/ac-c-shots/`. Quét 0 file chứa mật khẩu.

Status: DONE_WITH_CONCERNS
Summary: 10/11 AC Codex đạt (AC5 đạt một phần). Run phát sinh: Codex 2 (luna executor, sol reviewer), Claude 9. Reviewer Codex chạy thật và duyệt. Fallback reviewer và fallback executor theo công tắc đều ghi đúng quyết định. Công tắc Codex để BẬT.
Concerns/Blockers: FX-WZ-SECRET và FX-WB-CODEX-ENGINE chặn mọi run Codex, đã sửa dữ liệu prod nhưng wizard vẫn sẽ tạo sai. FX-OVR-REVIEWER: override của executor áp cho reviewer. FX-FB-WAKE: run đích sau fallback không tự chạy, nên không có reconcile.
