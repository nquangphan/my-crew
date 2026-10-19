# RV-1 — Review toàn bộ R2-4 trước deploy

Ngày 10/10/2026, 14:36–14:47 (Asia/Ho_Chi_Minh, theo `date`). Người review: agent Claude (opus).

Phạm vi đã đọc:
- Fork: `git diff f4a8b30a6..crew/r24` @ `6ecda8ca3` (139 file).
- Repo Crew: `git diff b827114..r24` @ `2e0ad9f` (56 file).

Tiêu chí: `replan-r3.md` (I1–I11, đợt, sở hữu, §9 phạm vi ghi), `plan.md` (Review Focus 1–5, luật credential/quota), spec §12,
mục "Đại Ca đã chốt" của `plans/reports/cho-dai-ca-261010.md`, mọi dòng tự quyết trong `sdd-ledger.md`.

Không sửa code, không commit code, không push, không ghi prod, không chạy codex/opencode. Prod chỉ đọc qua `ssh nhamoiplatform`
(compose, env đã che giá trị, quyền thư mục trong container).

## Kết luận

**Cho deploy DP-1 phần Codex. Không có Blocker.** Code đúng phạm vi §9. Hook 5/5, vá lõi C1–C6 không đổi, adapter-patch
P2–P7. Không thêm capability. Mọi lời gọi host của plugin đều kèm `companyId`. Full suite hai repo xanh.

Ba Major không chặn deploy, vì Codex và OpenCode **tắt sẵn** và chưa có key OpenCode:
- **M2** phải sửa hoặc đo trước **AC-C**.
- **M1** phải sửa trước **AC-O**.
- **M3** là bước DP bắt buộc làm đúng cách.

Một Minor (m13) chặn `git push` repo Crew, vì hook pre-push của crew-docs sẽ từ chối.

| Mức | Số |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 13 |

## Major

### M1 — Chi phí OpenCode trong bản tin máy không đếm run của agent Crew

- File: `apps/crew-mac/assets/crew-opencode-run.sh:20-26` và `apps/crew-mac/src/status/runtimes.ts:78-81`, 209-211.
- Cơ chế:
  - Wrapper đặt `XDG_DATA_HOME=~/.crew/runtimes/opencode/<agentId>/data` cho mỗi agent. Dữ liệu phiên và thống kê
    của OpenCode nằm dưới `XDG_DATA_HOME`.
  - `buildRuntimesReport` lại chạy `opencode stats --days N --models` với XDG mặc định, nên chỉ đọc
    `~/.local/share/opencode`, là dữ liệu của owner.
- Kịch bản:
  - Agent OpenCode tiêu hết $12 trong ngày, nhưng bản tin vẫn báo `costDay` gần 0.
  - `runtimeHealthOf` (plugin `runtimes/choose.ts:72-87`) coi OpenCode còn dùng được, nên fallback vẫn chọn OpenCode làm đích.
  - Trang Máy cũng hiện sai quota.
  - Luật quota "chạy `opencode stats --days 1 --models` trước mỗi run" cũng đếm thiếu theo cùng cách.
- Đề xuất: `opencodeCost` cộng thêm kết quả `opencode stats` chạy với `XDG_DATA_HOME=<mỗi thư mục>/data` dưới
  `~/.crew/runtimes/opencode/*`, tức cộng cả owner lẫn từng agent. Hoặc thêm lệnh `crew-mac runtimes opencode-stats` làm
  việc đó, và luật quota đổi sang dùng lệnh này. Cần test có hai thư mục agent.
- Gói: `mac-runtimes` (MR-4/MR-1), sonnet. Hạn: trước AC-O. Không chặn DP-1.

### M2 — `auth.json` của Codex là symlink: refresh token có thể đè mất symlink

- File: `apps/crew-mac/assets/crew-codex-run.sh:36` (`ln -sfn "$HOME/.codex/auth.json" "$dest/auth.json"`).
- Cơ chế:
  - Nếu Codex 0.161 ghi `auth.json` bằng cách "ghi file tạm rồi rename" khi refresh token, thì symlink trong
    `~/.crew/runtimes/codex/<agent>/` bị thay bằng **file thường** chứa token mới.
  - Chuỗi trong binary có `failed to atomically replace secrets file at`. Em chỉ đọc bằng `strings`, chưa chạy. Vì vậy
    chưa xác minh, nhưng khả năng xảy ra là có thật.
  - SP-C chỉ thấy symlink còn nguyên sau một run **không** refresh token.
- Kịch bản:
  1. Run Codex của agent refresh token, Codex xoay refresh token. Token mới chỉ nằm trong file của agent.
  2. `~/.codex/auth.json` của owner còn refresh token cũ, đã bị thu hồi.
  3. Ở run sau, wrapper chạy `ln -sfn` và **xóa** file token mới.
  4. Agent dùng token cũ và lỗi `refresh_token_reused/invalidated`. Plugin fallback `auth`. Codex desktop của owner
     cũng bị đăng xuất.
- Không lọt lên VPS: asset chỉ có `{}`, đã kiểm `codex-auth-copyback`/SP-C.
- Đề xuất, rẻ:
  - (a) Đầu wrapper: nếu `$dest/auth.json` tồn tại mà **không** phải symlink thì không đè. Thoát 78 với dòng
    `crew-runtime blocked: Codex đã thay auth.json của agent bằng file; owner chạy "codex login"` (dòng này khớp
    `WRAPPER_AUTH_RE` nếu đổi câu cho khớp). Doctor `codex-auth` báo warn.
  - (b) Hoặc: file thường mới hơn `~/.codex/auth.json` thì `mv` nó về `~/.codex/auth.json` rồi mới tạo lại symlink.
    Cách này đụng credential của owner, cần owner duyệt.
  - Ở AC-C: sau mỗi run Codex, kiểm `test -L ~/.crew/runtimes/codex/<agent>/auth.json` (chỉ `test`/`stat`).
- Gói: `mac-runtimes` (MR-1), opus. Hạn: trước AC-C, hoặc owner chấp nhận rủi ro và AC-C kiểm `test -L`.

### M3 — Ba nguồn khóa OpenCode, và env server dễ bị deploy xóa

- File:
  - server `server/src/crew/runtime-switch.ts:54` (env `CREW_OPENCODE_IN_PLACE_PATCH`);
  - plugin `packages/crew-plugin/src/runtimes/switches.ts:33-36,83` (cấu hình plugin theo company `opencodeInPlacePatch`);
  - Mac `apps/crew-mac/src/runtimes/paths.ts:18-19` (file `~/.crew/runtimes/opencode-in-place`, chỉ doctor dùng);
  - prod `/opt/crew-v3-spike/ops/policy-env.sh` (`write_policy_override`).
- Cơ chế:
  - Mỗi lần `deploy.sh`/`rollback.sh` chạy, `write_policy_override` **ghi đè** `docker-compose.crew-policy.yml`. Đặt env vào
    overlay đó thì lần deploy sau env mất.
  - Hai nguồn lệch nhau thì trạng thái trên web và ở server khác nhau:
    - cấu hình plugin `true` mà env server không phải `"1"`: web cho bật OpenCode, server (H1) vẫn giữ run;
    - job plugin đọc công tắc là ON nên đặt `handled_at`, và run nằm `queued` mãi, không fallback, không comment.
- Đề xuất cho DP:
  - Đặt env trong `docker-compose.yml`, khối `services.server.environment`. Khối này `compose-set-image.py` chỉ đổi
    `image`.
  - Đặt **cùng lúc** với cấu hình plugin, hoặc hoãn cả hai tới AC-O.
- Đề xuất cho FX sau: plugin không tự suy khóa từ nguồn riêng. Ví dụ server ghi khóa vào bảng plugin, hoặc job coi
  "server giữ run mà plugin thấy ON" là lệch và comment.
- Gói: `ops` (DP-1) làm ngay. Phần thiết kế để FX sau, gói `plugin`.

## Minor

| # | File:dòng | Vấn đề | Kịch bản | Đề xuất | Gói |
|---|---|---|---|---|---|
| m1 | `server/src/crew/runtime-gate.ts:66-68, 78-80` | `resolveMachine` ném lỗi thì cả cổng **fail open** | Lỗi DB thoáng qua: run Codex/OpenCode được claim dù công tắc mặc định TẮT. Trái Review Focus 4 ("lỗi đọc → giữ mặc định") | Bọc riêng `resolveMachine`: lỗi thì `machineId = null` (mặc định) | policy (SV) |
| m2 | `packages/crew-web/src/features/machines/runtime-block.tsx:25, 80-83` | Tắt **Claude** trên máy không cần xác nhận | Một cú bấm giữ mọi run Claude: Trợ Lý, reviewer, integrator, BMAD. Fallback chỉ chuyển executor, phần còn lại chờ im lặng | Hộp xác nhận khi tắt Claude, nói rõ hệ quả | web (WB-1) |
| m3 | `fallback.ts:118-123`, stock `issue-execution-policy.ts:484` | Reviewer Codex bị pause/terminate **sau** khi H4 đã chọn thì stock vẫn giao cho nó | Không có run, nên không có `agent.run.failed` và không có dòng `crew_runtime_waits`. Issue kẹt `in_review` (owner chốt "Codex lỗi → tự chuyển") | Job phút: issue `in_review` có `currentParticipant` = reviewer Codex đang `paused/terminated` → `reviewerFallback(trigger "unavailable")`. Hoặc chấp nhận, owner dùng "Ép Done" | plugin (PL-3) |
| m4 | `server/src/crew/retry-progress.ts:215`, `load-gate.ts` (fallback) | Fallback `switch_off`: run cũ chưa từng chạy nên checker trả `none` và **không tách nhánh** worktree cũ | Agent cũ từng làm issue (vòng sửa) rồi công tắc tắt. Worktree cũ còn ở `crew/<ID>`, agent mới `git switch` lỗi "already checked out" | Fallback mode: run cũ chưa start thì lấy run đã start gần nhất của agent cũ trên issue (hoặc cwd environment của agent cũ) để tách nhánh | policy (SV) |
| m5 | `packages/crew-plugin/src/runtimes/fallback.ts:332-339` | Job đặt `handled_at` cả khi công tắc vừa bật lại mà run chưa được claim | Bật rồi tắt lại nhanh: run bị giữ lại, `ON CONFLICT DO NOTHING` giữ dòng đã handled, không bao giờ fallback | Chỉ đặt `handled_at` khi run không còn `queued`. Hoặc H1 đặt lại `handled_at = NULL` khi giữ lại | plugin + policy |
| m6 | `packages/crew-plugin/src/runtimes/machine.ts:26-41, 72-78` | Plugin suy máy từ refs `crew_setup_runs`, server đọc bảng `environments` | Company nhiều máy, agent/environment tạo hay sửa ngoài wizard: server ra máy X, plugin ra `null`, fallback từ chối. Hiện một Mac nên trùng | Ghi rõ giới hạn ở docs flow; về sau đọc environment qua host nếu có API | plugin |
| m7 | `apps/crew-mac/assets/crew-codex-run.sh:31-34` | `rm -f "$dest/skills"` không xóa được thư mục thật | Codex tự tạo `skills/` thật (SP-C thấy vậy), sau đó `ln -s` tạo link **lồng** `skills/skills`, và skill Paperclip không tới agent | Nếu là thư mục thật thì `mv` sang `skills.bak-<ts>` (không `rm -rf`) rồi link | mac-runtimes |
| m8 | `crew-opencode-run.sh:16-19`, `crew/agents/executor.md` | Key OpenCode nằm trong env của `opencode`, nên lệnh shell của agent kế thừa. `--print-logs` chưa kiểm nội dung | Agent chạy `env` thì key vào log run trên VPS. Cùng lớp rủi ro với `PAPERCLIP_API_KEY` | Thêm một câu cấm in env/biến `*KEY*` vào `executor.md`. AC-O grep log run theo fingerprint 12 hex | agents + AC-O |
| m9 | `server/src/crew/model-policy.ts` (I1), WB-2 reviewer cố định | `gpt-6-sol` chưa đo (A1 chỉ đạt với luna) mà reviewer Codex và Codex `medium` dùng sol | sol lỗi 400: reviewer chuyển Claude (ổn), executor medium Codex thành `other` | AC-C: run Codex đầu tiên dùng sol (reviewer) và ghi kết quả | AC-C |
| m10 | `issue-create-policy.ts` (`chooseChildReviewer`), `fallback.ts:128-188` | Reviewer chọn lúc tạo issue, fallback executor sau đó **không** xét lại | Executor Claude fallback sang Codex thì Codex review Codex, trái ý "review khác mô hình" | Chấp nhận (hiếm) hoặc reviewerFallback ngược khi executor fallback sang Codex | plugin |
| m11 | `packages/crew-plugin/src/runtimes/classify.ts:12-19, 39-40` | Regex OpenCode rộng (`exceeded`, `429`, `403`) chạy trên message mà `--print-logs` có thể làm dài | "context length exceeded" thành `quota` và fallback sang Claude (tốn quota, không hỏng) | Chờ SP-O. Giữ giả định A8/A9 | plugin (FX-O) |
| m12 | `packages/crew-web/e2e/specs/` | Không có spec Playwright cho công tắc trang Máy (plan đặt `s12-runtime-switch.spec.ts`). Route POST thật chỉ được test DB plugin | Sai dạng body/route ở host thật chỉ lộ ra ở prod | DP T1 gạt thử tay (bật/tắt Codex trên máy T1) hoặc thêm spec | web |
| m13 | `apps/mac-app/src/utility/ops.ts` (commit `b9d5814`) | `crew-docs check --range b827114..r24` **đỏ R3**: đổi file của flow `mac-app` mà không sửa `docs/flows/mac-app.md` | Hook pre-push từ chối `git push` r24 | Commit nhỏ thêm dòng `runtimesSetup` vào `docs/flows/mac-app.md` | mac-app (MA) |

Ghi chú khác (không tính vào số Minor):
- `usage/data.ts` chưa tính ô runtime (PL-1 đã ghi).
- Sau fallback, marker `crew-model` trong mô tả vẫn là model cũ. `RuntimeSlot` hiện đúng quyết định nên chấp nhận.

## Soi các điểm được yêu cầu

| Điểm | Kết quả | Bằng chứng |
|---|---|---|
| Key OpenCode không vào argv/log/file/bản tin | **Đạt (wrapper)**. Rủi ro còn lại ở m8 | `crew-opencode-run.sh` đọc `security -w` vào biến rồi `unset key`. Test `crew-opencode-run.test.ts:88` (mốc không có trong argv, stdout, stderr, file dưới HOME). `keychainKeyState` không dùng `-w`. `status-runtimes.test.ts:208`. Reaper chỉ giữ argv, phần env của `ps -E` chỉ dùng để lấy runId (`process-table.ts:85-91`) |
| Codex `auth.json` symlink + `{}` trong asset | **Đạt cho VPS**. Rủi ro refresh ở **M2** | Asset = `<worktree>/.paperclip-runtime/codex/home` (SP-C), `.paperclip-runtime/` nằm trong `info/exclude` (`mac-app/src/main/projects/folder.ts:249`). `{}` 0600 giữ lại, copy-back cho `kept-host`. CODEX_HOME thật ở `~/.crew/runtimes/codex/<agent>`, không nằm trong asset |
| P6 không còn `rm -rf ~/.claude/skills` | **Đạt** với `in_place` | `opencode-local/src/server/execute.ts:461` có `!inPlaceRoot`. Không đồng bộ/khôi phục workspace (`syncWorkspace: inPlaceRoot === null`), cwd = `authoritativeRoot`. Test `execute.in-place.crew.test.ts`. Môi trường không `in_place` vẫn chạy nhánh stock (Crew luôn `in_place`) |
| Hook chỉ đổi thân | **Đạt** | `check-core-hooks`: "Hook một dòng: 5/5; vá lõi: 6; mục: 18; lỗi: 0". Diff `core-hooks.json` chỉ đổi `description`/`tests` của H1/H2/H4 và thêm P5–P7. Không file lõi nào ngoài §9 |
| H2 guard chuyển reviewer chỉ cho hệ thống | **Đạt** | `issue-gate.ts:190-223, 266-271`: điều kiện là actor `system`, `in_review` giữ nguyên, participant cũ = reviewer Codex của project, mới = reviewer Claude có trong stage, assignee = Claude, state chỉ khác `currentParticipant`. Mọi đổi participant khác trong stage `pending` (không phải board) bị chặn `participant_changed`. Đã đối chiếu stock `issue-execution-policy.ts:700-1000`: stock không tự đổi agent→agent trong cùng stage `pending`, nên guard chung không chặn nhầm luồng stock. Một lần duyệt của participant hiện tại là xong stage, nên stage `[Codex, Claude]` không đòi Claude duyệt thêm |
| Plugin không thêm capability, gọi host kèm company | **Đạt** | Diff manifest chỉ thêm route, job, khóa cấu hình. `listAttachments` dùng `issue.attachments.read` sẵn có. `fallback.ts`/`decisions.ts`/`switches.ts`: mọi `ctx.issues.*`, `ctx.config.get`, `ctx.activity.log` có `companyId`. Job đọc `storedVerifiedCrewCompanies` |
| Migration 0012 an toàn, lui image được | **Đạt** | DDL thuần, tên constraint `crew_machine_jobs_kind_check` có sẵn từ 0011, danh sách kind là tập cha. Migrator chạy trong transaction (`pg_advisory_xact_lock`) và chỉ lặp file của gói (`plugin-database.ts:473-540`), nên image cũ bỏ qua dòng 0012 đã áp. Bảng/cột mới chỉ thêm. Test `migration-0012.db.test.ts` |
| Reaper không giết nhầm process của người dùng | **Đạt** | `isAgentPrint` đòi `PAPERCLIP_RUN_ID` trong **env** (không lấy từ argv) và subcommand `exec`/`e`/`run`. Phiên Codex/OpenCode của owner không có runId. Test `agent-print.test.ts` 24 ca |
| Hợp đồng plugin↔server↔web↔app↔crew-mac | **Đạt** | Catalog: server = nguồn; plugin, crew-web, `assistant.md` có test so nguyên văn; template mac-app chép theo sha256 (MA-2). Marker `runtime=` sau `effort=`, cùng regex ở server/plugin. `runtimes-setup`: payload `{kind}`; kết quả chỉ chép trường hợp đồng ở app và plugin. `MachineReport.runtimes`: khóa/giới hạn khớp crew-mac (version ≤50, model ≤60/120, chi phí ≤100000). 3 ô có ở plugin `jobs/types.ts`, mac-app `jobs/types.ts`, crew-web, server (cột) |
| `CODEX_HOME` `/paperclip/instances/default/crew-codex-home/...` | **Đạt** (đọc prod) | Image: `HOME=/paperclip`, `PAPERCLIP_HOME=/paperclip`, `PAPERCLIP_INSTANCE_ID=default` (Dockerfile:180-190). Container prod `v3-67b1dde8a`: biến đúng, `/paperclip/instances/default` do `node` sở hữu (700), `node` ghi được. `crew-codex-home` chưa có (adapter tự `mkdir`). **Không** có `/paperclip/.codex/auth.json`. Volume `./data/paperclip:/paperclip` |
| Reviewer Codex chỉ cho issue con | **Đạt** | `chooseReviewer` trả Claude khi template ≠ `child`. `buildCrewPolicy` chỉ thêm Codex với `child`. Research/BMAD/gốc không đi nhánh này |
| Fallback: chỉ quota/auth/key/runtime hỏng, tối đa 2, `large` chờ Claude | **Đạt** | `classify.ts` (`crew-workflow blocked` → `other`), `applyFallback` bỏ `other` cho executor, `MAX_FALLBACKS_PER_ISSUE=2` chỉ đếm executor, `large` từ chối + comment, không block. Idempotent theo `(run_id, kind)` |
| Công tắc Codex/OpenCode tắt sẵn, chỉ board | **Đạt** | Mặc định ở server/plugin. Route `auth: board` và kiểm `actorType === "user"`. Agent không environment → mặc định (giữ). OpenCode bị khóa khi thiếu vá |
| kimi-k3 chưa nhận ảnh | **Đạt** | `vision: false` ở cả 3 bản chép. `issueHasImages` đọc lỗi thì coi như có ảnh |

## Phán xét các dòng tự quyết / giả định trong ledger

| Giờ | Tự quyết | Phán xét |
|---|---|---|
| 12:42 | Nền `crew/r24` = `f4a8b30a6` (có FX-RP chưa deploy) thay `67b1dde8a` | Chấp nhận. DP-1 deploy cả FX-RP: ghi vào ledger DP |
| 12:53 SV-1 | `terminated`/`pending_approval` → "không có reviewer Codex" | Chấp nhận |
| 12:58 PL-1 | `trigger` thêm `other`; unique `(run_id, kind)`; chỉ mục select `(issue_id, role)` | Chấp nhận |
| 12:58 PL-1 | POST thay PUT (host không có PUT cho route plugin) | Chấp nhận, web dùng POST |
| 12:58 PL-1 | Khóa OpenCode ở plugin đọc từ cấu hình plugin | Chấp nhận có điều kiện: xem **M3** |
| 12:58 PL-1 | Roles API: không gửi ô runtime = giữ | Chấp nhận (client cũ không xóa ô) |
| 12:58 PL-1 | Máy của agent ở plugin suy từ `crew_setup_runs` | Chấp nhận với một máy. Giới hạn ở **m6** |
| 13:26 | Agent Codex có `env.CODEX_HOME` ngoài `companies/<id>`, không có `OPENAI_API_KEY` | Chấp nhận. Đã kiểm prod chỉ đọc. `merge-agent-config` chặn sai cấu hình |
| 13:27 MR-1 | `{}` 0600 trong asset, giữ lại khi thoát | Chấp nhận (không có bí mật, thư mục bị exclude) |
| 13:37 MR-2 | `workflow-check` thoát 78 (không phải 1); export `CREW_SUPERPOWERS_DIR` trước khi kiểm | Chấp nhận |
| 13:40 MR-3 | Subcommand = phần tử đầu không bắt đầu bằng `-` | Chấp nhận (adapter đặt `-c` sau `exec`, `--search` không có giá trị) |
| 13:42/13:43 | Agent Codex/OpenCode không có environment vẫn bị giữ theo mặc định (khác plan cũ "không giữ") | Chấp nhận: an toàn hơn và đúng "tắt sẵn" |
| 13:42 SV-2 | Reconcile fallback chỉ trên environment có cổng tải | Chấp nhận (wizard luôn đặt). Xem m4 |
| 13:56 SV-3 | Bỏ đường đổi `executionPolicy`. H2 chặn mọi đổi participant `pending` không phải board, chỉ trừ phép Codex→Claude | Chấp nhận. Đã đối chiếu stock (bảng trên) |
| 14:06 PL-2 | Lý do chọn reviewer tính lại ở plugin | Chấp nhận (có thể lệch khi công tắc vừa đổi, chỉ ảnh hưởng chữ hiển thị) |
| 14:13 PL-3 | Đổi assignee trước, comment sau (khác spec §7.3) | Chấp nhận (không có comment "đã chuyển" khi bị từ chối) |
| 14:13 PL-3 | `large` không block, chờ Claude | Chấp nhận, khớp owner "large chờ Claude" |
| 14:13 PL-3 | Wake reviewer bằng `crew_runtime_reviewer_fallback` | Chấp nhận. `isRuntimeFallbackWake` chỉ nhận `crew_runtime_fallback` nên không reconcile worktree cho reviewer. `cancelSuperseded` vẫn hủy run Codex `queued` |
| 14:13 PL-3 | Reviewer chuyển với mọi lỗi (kể cả timeout/`other`) | Chấp nhận, khớp owner "Codex lỗi → tự chuyển". Thiếu ca pause/terminate: **m3** |
| 14:35 WB-2 | `CODEX_HOME` theo `<projectKey>/<ô>` trên VPS (Mac theo agentId) | Chấp nhận |
| 14:35 WB-2 | DB T1 `plugins.package_path` trỏ worktree r24-web | Ghi cho DP: dựng lại T1 sạch trước khi chạy E2E |
| A1 | `gpt-6-sol` chưa đo | Rủi ro còn lại: **m9** |

## Full suite (máy Mac mini, tuần tự, vitest `--maxWorkers=2` khi tự đặt; server dùng cấu hình `maxWorkers: 1`)

Worktree chỉ đọc:
- `.worktrees/paperclip-r24-rv` (detached `6ecda8ca3`);
- `.worktrees/crew-r24-rv` (detached `2e0ad9f`).

`ipcs -m` trước và sau phần fork: giống nhau, chỉ khác dòng giờ.

| Repo | Lệnh | Kết quả |
|---|---|---|
| Fork | `crew/release/verify.sh` (14:36–14:41) | **XANH**. check-core-hooks 5/5 hook, 6 vá lõi, 18 mục, 0 lỗi (13/13 test). ops test 5+10+18. Server `crew-` 28 file / 613 ca. Adapter claude 17, codex 10, opencode 12. Plugin 51 file / 425 ca. `crew/agents` 136/136. tsc server/claude/codex/opencode/plugin. Build plugin. Không có `require("react")` trần |
| Fork | `pnpm --filter @crew/paperclip-web exec vitest run --maxWorkers=2` | 118 file, 966 ca xanh + 1 todo |
| Fork | crew-web `typecheck` | 0 lỗi |
| Fork | `CREW_UI_COMMIT=6ecda8ca3… pnpm --filter @crew/paperclip-web build` | OK |
| Fork | crew-web `lint` (biome) | sạch, 451 file |
| Crew | `pnpm install --frozen-lockfile --prefer-offline`, docs-kit build | OK |
| Crew | test (`--maxWorkers=2`) | crew-mac 62 file / 1058. mac-app 45 file / 559 + node 24/24. docs-kit 3 / 43. Tất cả xanh |
| Crew | `pnpm -r typecheck` | 0 lỗi |
| Crew | `pnpm lint` | sạch, 338 file |
| Crew | `crew-docs check --range b827114..HEAD` | **ĐỎ 1 vi phạm R3**: m13 |

Không chạy E2E T1 ở RV-1. WB-2 đã chạy T1 68 xanh / 4 bỏ qua. DP-1 chạy lại.

## Bước bắt buộc cho DP-1

1. **Trước deploy**
   - Sửa m13 (docs `mac-app.md`) nếu sẽ push. Không chặn deploy.
   - Ghi vào ledger câu owner duyệt P5–P7 nguyên văn (07:06: "R2-4: duyệt cả P5, P6, P7").
   - Ghi rằng image gồm FX-RP `f4a8b30a6`.
2. **T1 E2E trước prod.**
   - Dựng lại T1 sạch: `plugins.package_path` đang trỏ worktree r24-web.
   - Chạy bộ T1 có PW-R24-1.
   - Gạt tay công tắc Codex trên trang Máy T1 (bật có hộp xác nhận, tắt). Việc này bù m12.
3. **Deploy theo `crew/ops/*`**
   - Thứ tự: `active-runs.sh` rỗng → backup → deploy image từ `crew/r24` `6ecda8ca3` → mốc rollback → health → plugin
     `ready` → hai site 200.
   - A14: plugin phải `ready`, không `upgrade_pending`. Gặp `upgrade_pending` thì dừng và báo owner.
4. **Kiểm 0012**
   - `plugin_migrations` có `0012_runtimes.sql` trạng thái `applied`.
   - `pg_constraint` `crew_machine_jobs_kind_check` có `runtimes-setup`.
   - Có ba bảng `crew_runtime_*` và ba cột mới ở `crew_project_roles`.
   - Rollback image không cần gỡ 0012.
5. **Env `CREW_OPENCODE_IN_PLACE_PATCH=1`** (M3)
   - Ghi vào `docker-compose.yml` khối `services.server.environment`. **Không** ghi vào `docker-compose.crew-policy.yml`,
     vì `write_policy_override` ghi đè file đó.
   - Kiểm bằng `docker compose exec -T server printenv CREW_OPENCODE_IN_PLACE_PATCH`.
   - Có thể hoãn tới AC-O, nhưng phải đi **cùng** bước 6.
6. **Cấu hình plugin `opencodeInPlacePatch: true`** cho company Crew
   - GET cấu hình hiện có, **giữ nguyên** `companies` (webhook secret ref), gộp khóa mới rồi PUT.
   - Ghi đè thiếu `companies` thì webhook/job của company ngừng.
   - Bước này đi cùng bước 5.
7. **Mac mini**
   - Cài `crew-mac` + app 2P Crew bản `r24` `2e0ad9f` theo cách R3X DP.
   - Xếp việc `runtimes-setup` từ trang Máy, đọc kết quả: wrapper codex/opencode `true`, Codex `loggedIn`.
   - Khi server đã có env của bước 5: `touch ~/.crew/runtimes/opencode-in-place`. Chỉ doctor đọc file này.
8. **Wizard tạo agent cho `repo-a`**
   - Tạo `executor-codex`, `reviewer-codex` và `executor-opencode`.
   - Kiểm agent Codex có `env.CODEX_HOME=/paperclip/instances/default/crew-codex-home/<khóa>/<ô>`, không có
     `OPENAI_API_KEY`, `command` = `<home>/.crew/bin/crew-codex-run`.
   - Công tắc Codex/OpenCode để **TẮT**.
9. **PUT lại AGENTS.md cho agent đã có.** Template đổi ở `assistant.md`, `executor.md`, `reviewer.md`.
   - Trợ Lý: lưu lại tab Vai trò trên web (web tự render lại), hoặc chạy
     `apply-roles.sh agent <assistantId> assistant <pin> "<execId[:runtime],…>" "<bmadIds>" <codexReviewerId>`.
     Executor không ghi `:runtime` thì script đọc `adapterType`. Đối số thứ 6 là id reviewer-codex.
   - Executor Claude: `apply-roles.sh agent <id> executor <pin>`.
   - Reviewer Claude: `apply-roles.sh agent <id> reviewer <pin>`.
   - Agent Codex/OpenCode mới do wizard tạo thì đã có bản mới.
   - Readiness A1/A2 trên web phải xanh.
10. **Sau deploy**
    - Không có `auth.json` dưới `/paperclip` (chỉ dùng `find -name auth.json` + `stat`).
    - Log container không có `access_token`/`refresh_token`.
11. **Tag cục bộ** `crew/v3.3-rc1` (owner chốt tag R2-4 là `crew/v3.3`). Không push.
12. **Trước AC-C**
    - Xử lý **M2** (FX `mac-runtimes`), hoặc owner chấp nhận rủi ro và AC-C kiểm `test -L` sau mỗi run Codex.
    - Run Codex đầu tiên đo `gpt-6-sol` (m9).
13. **Trước AC-O:** FX M1 (chi phí OpenCode), m8 (câu cấm in env), SP-O cho m11.

## Dọn

- Hai worktree RV ghi ở `processes.md` (giữ để Trợ Lý gỡ bằng `git worktree remove`).
- Không còn process nền.

Status: DONE_WITH_CONCERNS
Summary: R2-4 đủ điều kiện deploy phần Codex: full suite hai repo xanh (trừ 1 vi phạm docs R3 chặn push), hook 5/5, không capability mới; 0 Blocker, 3 Major, 13 Minor.
Concerns/Blockers:
- M1: chi phí OpenCode trong bản tin không đếm run của agent. Sửa trước AC-O.
- M2: symlink `auth.json` của Codex có thể bị refresh token thay bằng file, rồi wrapper đè mất token mới. Sửa hoặc đo trước AC-C.
- M3: env/cấu hình khóa OpenCode phải đặt đúng chỗ và cùng lúc ở DP.
- m13: thiếu docs `mac-app.md` nên pre-push sẽ từ chối.
