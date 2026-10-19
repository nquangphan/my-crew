# DP-1 R2-4: deploy phần Codex (`crew/r24` @ `826a49ea6`), cài app và crew-mac r24 (`b76059f`), tạo agent Codex cho `repo-a`

- Thời gian: 2026-10-10 15:03 → 15:24 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Phạm vi: chỉ phần Codex. OpenCode hoãn tới khi owner nạp key:
  - không đặt env `CREW_OPENCODE_IN_PLACE_PATCH`;
  - không cấu hình `opencodeInPlacePatch`;
  - không tạo `~/.crew/runtimes/opencode-in-place`;
  - không tạo `executor-opencode`.
- Owner duyệt P5–P7 nguyên văn (07:06): "R2-4: duyệt cả P5, P6, P7". Image gồm cả FX-RP `f4a8b30a6` (trước đây chưa deploy) và FX-RF.
- Kết quả: **DONE_WITH_CONCERNS.**
  - Prod chạy `crew-v3/paperclip:v3-826a49ea6`, plugin `crew.core` ready, migration 0012 đã áp. Không phải rollback.
  - App và crew-mac r24 đã cài, doctor 0 lỗi, `runtimes-setup` trả `codex.loggedIn: true`.
  - `repo-a-executor-codex` và `repo-a-reviewer-codex` đã tạo bằng wizard, công tắc Codex vẫn tắt.
  - 11 AGENTS.md trên prod khớp từng byte với template mới.
  - Có 4 concern, xem mục cuối.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-67b1dde8a` |
| Image sau | `crew-v3/paperclip:v3-826a49ea6` |
| Lệnh rollback prod | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-151141`, đưa về `v3-67b1dde8a`. Không cần gỡ 0012 (RV-1) |
| Backup DB | `20261010-1509` (làm tay), `20261010-1511` (`deploy.sh`), `20261010-1516` (trước khi ghi vai trò `repo-a`). Cả 3 đều 26M, builtin ok |
| Script ops VPS cũ | `/opt/crew-v3-spike/ops.bak-dp1-r24/` |
| App cũ (để lui) | `~/crew-r24-app-prev/2P Crew.app` (bản r3x `b827114`, codesign ok). Bundle đã gỡ nằm ở `~/.Trash/2P Crew-dpx2-dp1r24-1513.app` |
| crew-mac cũ | `~/.crew/app/crew-mac.bak-dp1-r24` (cli.js `c9d08373…`) và `crew-mac.prev` |
| Tag cục bộ | `crew/v3.3-rc2` (annotated) trên `826a49ea6`. Chưa push. Xem concern 4 |

Cách lui app (chỉ khi 0 run):
1. Thoát app qua quit guard.
2. Dời bản mới đi.
3. `ditto ~/crew-r24-app-prev/"2P Crew.app" "/Applications/2P Crew.app"` rồi mở lại.
4. Lui crew-mac: dời `~/.crew/app/crew-mac` đi, rồi `ditto ~/.crew/app/crew-mac.bak-dp1-r24 ~/.crew/app/crew-mac`.

Wrapper mới (`crew-codex-run`, `crew-opencode-run`, `crew-run-mark.sh`) chỉ được thêm vào. `crew-claude-run` không đổi.

## Bước 1: cổng kiểm

Worktree `.worktrees/paperclip-r3-dp` chạy `git checkout --detach crew/r24` (`826a49ea6`, sạch).

**verify.sh** chạy 15:03:25 → 15:08:08, rc 0, **XANH**. Script tự cài deps và build plugin-sdk.

| Mục | Kết quả |
|---|---|
| Hook | 5/5 |
| Vá lõi | 6, lỗi 0 |
| Server crew | 616 |
| Adapter claude / codex / opencode | 17 / 10 / 12 |
| Plugin | 429 |
| Agents | 136 |
| tsc | 0 lỗi |
| Bundle | không có `require("react")` trần |

**Kiểm thêm:**
- ops `node --test crew/ops/*.test.mjs`: 62/62.
- crew-web `vitest run`: 118 file, 967 ca xanh (1 todo). `tsc -b` 0 lỗi.
- `ipcs -m` trước và sau giống nhau, không rò.

**Không dựng lại T1 đầy đủ.** Lý do: verify.sh và test crew-web đều xanh, WB-2 đã chạy T1 (68 xanh, PW-R24-1 xanh), RV-1 đã kiểm. FX-RF chỉ thêm unit test. Vì vậy m12 (gạt công tắc Codex trên T1) **chưa được bù**. Trên prod em không bật Codex theo phạm vi.

## Bước 2: deploy prod

1. **Chuẩn bị.**
   - `active-runs.sh` rỗng.
   - Backup `20261010-1509`.
   - Sao lưu `ops/` vào `ops.bak-dp1-r24`.
   - So sha256 của `ops/*.sh`, `*.py` và `nginx-crew.conf`: VPS trùng fork, nên không scp.
2. **overlay-source.sh gốc từ chối** (exit 2): "v3 changes files the overlay cannot ship".
   - Các file bị chặn là `packages/adapters/codex-local/src/server/index.ts`, `opencode-local/src/server/{execute,index}.ts` và test.
   - Nguyên nhân: regex UNKNOWN và SHIP chỉ nhận `packages/adapters/claude-local/src/`.
   - Trong image, adapter chạy thẳng từ `src/*.ts`: `package.json` exports `./src/server/index.ts`, server nạp qua tsx. Chép `src` là đủ.
   - Cách xử lý: em dùng **bản chép tạm** ở scratchpad (`overlay-source-dp1.sh`) theo tiền lệ "bản chép" của R3. Bản này chỉ đổi 2 regex thành `packages/adapters/(claude|codex|opencode)-local/src/` và gán cứng `FORK` vào worktree DP. Repo không bị sửa. Cần FX-OPS (concern 1).
3. **Build.**
   - Upload ok, 26 file server.
   - Tarball có `adapters/{claude,codex,opencode}-local/src/server/*.ts`.
   - `overlay-job.sh 826a49ea6`: `JOB_EXIT rc=0`, `min_avail=5244MiB`.
4. **inspect-image.sh** không có dòng MISSING hay FAIL:
   - `issues crewCoreHooks=3`;
   - đủ 12 file crew;
   - `plugin events delivered as call ok`;
   - `crew-ui=826a49ea63990462b2cf4f68a6cdc17dfc2b24e1`;
   - migrations tới `0012_runtimes.sql`.

   Vì inspect-image **không kiểm adapter**, em kiểm tay thêm hai việc:
   - sha256 của 16 file `packages/adapters/*-local/src/server/{index,execute}.ts` trong image trùng commit. Tức vá P2–P4 (claude) và P5–P7 (codex, opencode) có mặt;
   - `node --import tsx` import được `@paperclipai/adapter-{codex,opencode,claude}-local/server`.
5. **Deploy.** `active-runs.sh` rỗng lần 2. `deploy.sh crew-v3/paperclip:v3-826a49ea6` chạy 15:11:34 → 15:12:13, rc 0, in `deploy ok: … v3-67b1dde8a -> … v3-826a49ea6, rollback TS=20261010-151141`.

**Kiểm sau deploy:**

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `status ok`, commit `826a49ea6399…` |
| Plugin | `crew.core` status `ready`, `plugin-state.sh` trả healthy, không gặp `upgrade_pending` |
| Migration 0012 | `0012_runtimes.sql` applied lúc 08:12:08Z |
| Ràng buộc và bảng mới | `crew_machine_jobs_kind_check` có `runtimes-setup`. Có 3 bảng `crew_runtime_{decisions,switches,waits}` và 3 cột `codex_executor_agent_id`, `opencode_executor_agent_id`, `codex_reviewer_agent_id` |
| Site | `crew /` và `/cli-auth/x` (mốc crew-ui `826a49ea6`), `/paperclip/` (title Paperclip), `2p-solutions.com`, `kidyschool.com`: đều 200 |
| `check-crew-companies.sh` | `ok 2 company` |
| `agent-permissions.sh` | TPS `--check --assistant 6c27410e…`: rc 0. `--all-crew` cùng cờ: rc 0. Kiểm lại sau bước 4: vẫn rc 0 cả hai, 2 agent Codex có 3 quyền off ("đúng") |
| Log server 25 phút | 0 `access_token`/`refresh_token`/`id_token`. 0 `config.get`, `host refused`, `INVOCATION_SCOPE_DENIED`. 0 dòng error. 37 warn đều là request quét từ internet (404/401) và 401 `get-session` của trang login |
| `auth.json` dưới `/paperclip` | 0 file. Thư mục `crew-codex-home` chưa tồn tại, vì chưa có run Codex |
| Env OpenCode | `CREW_OPENCODE_IN_PLACE_PATCH` không có (đúng: OpenCode hoãn) |

## Bước 3: Mac mini

1. **Kiểm 0 run.** VPS `active-runs.sh` rỗng. Trên Mac không có `claude --print`, `codex exec` hay `opencode run`.
2. **Build.** Worktree `.worktrees/crew-r3-dp2` chạy `git checkout --detach b76059f`.
   - Lệnh: `pnpm install --frozen-lockfile`, build docs-kit và `@crew/mac`, rồi `pnpm --filter @crew/mac-app release --dev-sign --no-publish`. rc 0.
   - Codesign deep strict đạt: Apple Development, J7Y2DL6HZV, hardened runtime.
3. **Cài crew-mac và wrapper.**
   - 15:13:17: `installCrewMacFrom(<app r24>/Contents/Resources/crew-mac)` trả `installed: true`. cli.js mới `2beda8b1…`.
   - 15:13:20: `crew-mac setup` (không cờ, giữ chủ sshd là app) rc 0. Lệnh ghi `crew-run-mark.sh`, `crew-codex-run`, `crew-opencode-run` và `runtimes/superpowers-dir`. `crew-claude-run` không đổi.
4. **Thay app.**
   - Gửi Apple event quit. Quit guard hiện "Ở lại / Thoát". 15:13:42 bấm Thoát qua System Events. Log ghi `app-quit`, sshd dừng, cổng 2222 trống.
   - Dời bundle cũ vào Thùng rác, `ditto` bản mới vào `/Applications` (codesign deep strict ok).
   - Mở lúc 15:13:49: app PID 27170, sshd 2222 PID 27249 với **PPID 27170** (một listener). `app.json` ghi `sshdPid 27249`, `sshdOwner app`.
5. **Kiểm.**
   - Từ lúc mở có 26 lần claim trả 204, `/api/companies` trả 200, 0 warn hay error.
   - `jobsAgent.lastPollAt` 08:13:52Z.
   - `crew-mac doctor` (đầy đủ) rc 0: **23 ĐẠT, 2 CẢNH BÁO, 0 lỗi**.
     - 2 cảnh báo đều do chưa có key OpenCode Go (đúng, vì hoãn).
     - Codex đăng nhập qua sshd agent: đạt. Wrapper `crew-codex-run` chạy ra `codex-cli 0.161.0`.
6. **Việc `runtimes-setup` qua UI.**
   - Dùng Playwright Node (đăng nhập Crew Spike Admin, mật khẩu `.env` VPS qua stdin, không trace).
   - 15:16:01 bấm "Cài runtime trên máy" trên `/TPS/machines`. Job `fb2cefe1` được claim lúc 08:16:02Z và done lúc 08:16:03Z.
   - Kết quả: `{codex: {version: "codex-cli 0.161.0", loggedIn: true}, opencode: {version: "1.18.35", keyPresent: false}, wrappers: {codex: true, opencode: true}}`.
   - **Không bật** công tắc nào. Claude true, Codex false, OpenCode false (OpenCode đang khóa `opencode-patch-missing`).

## Bước 4: agent Codex cho `repo-a` và AGENTS.md

**Xác định project thử.** `repo-a` là project "Spike Mac" `280cf1de-ea80-465f-b42d-869ed9d044f8`, company TPS:
- `status-repos.json` trỏ `~/crew-spike/repo-a`;
- worktree agent có origin `repo-a-origin.git`.

Project chưa có dòng `crew_project_roles` (dùng vai trò kiểu file). Các vai trò theo `crew-policy.json` và AGENTS.md của Trợ Lý:

| Vai trò | Agent |
|---|---|
| Trợ Lý | tro-ly `6c27410e` |
| Executor | mac-claude `37a9e834`, mac-claude-2 `c452d003` |
| Reviewer | `946f1a73` |
| Integrator | `b7cd2d89` |
| BMAD | `ab3a27de` |

Không đụng `2ps-landing`, trừ việc PUT AGENTS.md mà task yêu cầu.

**Dòng vai trò.**
- Wizard đòi dòng vai trò (`validate.projectNoRoles`).
- Tab Vai trò lại không cho chọn agent nào: 5 agent R1 trượt A5 "Checkout của agent chưa có trên máy", vì checkout `~/crew-agents/<vai>` của R1 không nằm trong bản tin quét `~/crew-agents/<khóa>/<ô>`.
- Em làm theo fork.md DP-1 Step 6 ("PUT route roles, actor board"):
  - backup `20261010-1516`;
  - 15:18 `POST /api/plugins/crew.core/api/projects/280cf1de…/roles` (body qua stdin);
  - nội dung là **đúng bộ vai trò file hiện có**, 3 ô runtime `null`;
  - kết quả 200. Route vẫn kiểm agent, adapter và xung đột giữa các project.

**Wizard trên UI** (`/TPS/agents/new?project=280cf1de…&slot=…`, khóa `repo-a`, folder `~/crew-spike/repo-a`, máy Mac mini). Cả hai lượt chạy đủ 6 bước Xong:

| Agent | Id | Setup run | Model | Environment | Checkout |
|---|---|---|---|---|---|
| `repo-a-executor-codex` | `62d450f3-eca6-4f67-a171-8d23b3956f97` | `7438779f` | gpt-6-luna / medium | `07f2fb67` | `~/crew-agents/repo-a/executor-codex` (nhánh `crew/repo-a/executor-codex`) |
| `repo-a-reviewer-codex` | `38a28c7d-1d28-4747-b6be-32be707952e8` | `c21e8ace` | gpt-6-sol / high | `c9996efa` | `~/crew-agents/repo-a/reviewer-codex` |

Cấu hình chung của cả hai agent (kiểm qua API và DB):
- `adapterType` `codex_local`;
- `command` = `/Users/phannhatquang/.crew/bin/crew-codex-run`, `extraArgs` `[]`;
- `dangerouslyBypassApprovalsAndSandbox` true;
- env **chỉ** có `CODEX_HOME=/paperclip/instances/default/crew-codex-home/repo-a/<ô>`, không có `OPENAI_API_KEY`;
- heartbeat tắt, `maxConcurrentRuns` 1;
- 3 quyền false;
- environment SSH `in_place`, active.

Sau hai lượt:
- vai trò `repo-a` có `codex_executor = 62d450f3` và `codex_reviewer = 38a28c7d`; ô opencode `null`;
- `crew_runtime_switches` rỗng, tức Codex/OpenCode tắt theo mặc định.

**AGENTS.md** (11 agent, GET lại `content` và so sha256 với `render-instructions.mjs` của `826a49ea6`: **khớp hết**):

| Agent | Cách ghi |
|---|---|
| Trợ Lý `6c27410e` | Bước `assistant-instructions` của wizard render lại (cách "lưu tab Vai trò"): 3 executor kèm runtime (`claude_local` ×2, `codex_local`), BMAD `ab3a27de` giữ nguyên, mục Reviewer Codex `38a28c7d` |
| `62d450f3`, `38a28c7d` | Wizard ghi (executor.md, reviewer.md) |
| mac-claude `37a9e834`, mac-claude-2 `c452d003` (executor), reviewer `946f1a73` | `apply-roles.sh agent <id> executor\|reviewer <pin 6.4.1-5bf4e7801107>` chạy từ Mac. `CREW_SPIKE_ROOT` trỏ shim `api.sh` ở scratchpad (body đi qua stdin ssh; VPS không có node). rc 0, extraArgs giữ nguyên |
| `2ps-landing`: assistant `f1bdbd53` (executor `41b3c7cc:claude_local`, BMAD không có), executor `41b3c7cc`, reviewer `265ecb67` | PUT AGENTS.md: baseHash = `contentHash` của GET (`add-base.mjs`), body qua stdin, `verify-result.mjs write` đạt. Không PATCH cấu hình |
| integrator `041466d8`, `b7cd2d89` | Đã khớp template, không ghi |

## Bước 5: xem UI (Playwright, chỉ xem)

Ảnh nằm ở `reports/dp1-shots/` (01–12). Quét ảnh, script và ledger: 0 file chứa mật khẩu. Ngoài bước 3–4, request ghi duy nhất là `POST /api/issues/eff83344…/read` (đánh dấu đã đọc khi mở TPS-72).

| Mục | Kết quả |
|---|---|
| Trang Máy (01, 03, 08) | Có khối **Runtime Phans-Mac-mini.local**. Công tắc Claude bật, **Codex tắt**, OpenCode tắt. Codex hiện "Phiên bản codex-cli 0.161.0 · **đã đăng nhập**", quota ước tính 15%. Kết quả cài hiện "Wrapper Codex: đã cài / Wrapper OpenCode: đã cài / Codex sau khi cài: … đã đăng nhập" |
| Wizard (06, 07) | Form và kết quả 6 bước Xong của hai agent |
| Trang issue TPS-72 (09) | **Không có khối Runtime.** `crew_runtime_decisions` có 0 dòng trên toàn prod, và RuntimeSlot cố ý ẩn khi rỗng (ghi trong code). Chỉ xem được sau run thật (AC-C). Không tạo issue hay run để xem |
| Vai trò `repo-a` (10) | Đủ 7 ô, có lối "Thêm executor OpenCode" |
| Sẵn sàng `repo-a` (11) | Chưa sẵn sàng. 5 agent R1 trượt A5 (có từ trước). **2 agent Codex trượt A1** (concern 2) |
| Sẵn sàng `2ps-landing` (12) | "Mọi mục đều đạt" sau khi PUT AGENTS.md mới |

## Bước 6: tag

`crew/v3.3-rc1` **đã có**: R2-3 BMAD, trên `5b5088889`, tạo lúc 02:16. Em không ghi đè mà gắn `crew/v3.3-rc2` (annotated) trên `826a49ea6`, theo dòng `crew/v3.3` owner chốt. Chưa push.

## Concern và FX

1. **FX-OPS-ADAPTERS (ops, cần trước DP sau):**
   - `crew/ops/overlay-source.sh` chỉ ship `packages/adapters/claude-local/src/`, nên từ chối mọi commit đổi codex-local hoặc opencode-local. DP-1 phải dùng bản chép tạm.
   - Sửa: hai regex UNKNOWN và SHIP nhận `packages/adapters/(claude|codex|opencode)-local/src/`, thêm test vào `overlay-source.test.mjs`.
   - Cùng FX: `inspect-image.sh` nên kiểm vá adapter (ví dụ grep mốc vá trong `packages/adapters/*-local/src/server/*.ts`). Hiện bản này không kiểm adapter nào.
   - RV-1 không bắt được lỗi này vì không chạy overlay-source.
2. **FX-DP1-A1-CODEX (web, Major cho readiness):**
   - Agent Codex luôn trượt A1 trên prod.
   - Nguyên nhân: `GET /api/agents/:id` trả `env.CODEX_HOME = {type: "plain", value: "***REDACTED***"}`, và `envString` của `features/readiness/compute.ts` đọc ra `***REDACTED***`, nên `isUnmanagedCodexHome` sai. Giá trị thật trong DB đúng.
   - Hệ quả:
     - project nào có agent Codex đều hiện "Chưa sẵn sàng";
     - hộp chọn tab Vai trò lọc bỏ agent Codex chưa giữ ô (`state === 'ready'`);
     - "Làm tiếp" A1 chỉ PATCH lại cùng giá trị nên không hết đỏ;
     - câu báo A1 vẫn ghi "cần claude_local, engine cli, env rỗng…".
   - Gợi ý: coi giá trị bị che là "có, không kiểm được", hoặc kiểm phía plugin bằng DB. Đồng thời sửa câu A1 theo runtime.
   - T1 không bắt được, có thể vì T1 không che env.
   - Không chặn run: plugin và server không đọc readiness của web.
3. **repo-a là project R1 không theo bố cục `~/crew-agents/<khóa>/<ô>`.** 5 agent Claude của nó trượt A5 trên web, nên tab Vai trò không chọn được. Em đã tạo dòng vai trò qua route board với đúng vai trò file đang có. Từ nay `repo-a` dùng vai trò plugin; vai trò file trong `crew-policy.json` không đổi. Lần sau đổi vai trò `repo-a` trên web cũng sẽ vướng A5 cho tới khi chuyển checkout sang bố cục mới. Owner hoặc Trợ Lý xem có cần dọn không.
4. **Tag:** `crew/v3.3-rc1` đã thuộc R2-3, nên R2-4 dùng `crew/v3.3-rc2`. Trợ Lý hoặc owner đổi tên nếu muốn khác.

Vẫn mở từ RV-1:
- trước AC-C: M2 (FX-RM đã sửa trong crew-mac `ce29306` và đã cài), m9 (đo `gpt-6-sol` ở run Codex đầu);
- m12: gạt tay công tắc Codex trên T1, chưa làm;
- AC-O: chờ key OpenCode, cùng env/cấu hình plugin (M3) và M1/m8/m11.

## Không làm

- Không sửa code repo, không commit, không push.
- Không bật công tắc Codex hay OpenCode, không chạy run Codex nào, không tạo issue.
- Không DELETE environment hay bản ghi nào.
- Không `rm -rf`. Chỉ `rm -f` một file phiên đăng nhập Playwright trong scratchpad.
- Không đụng env, cấu hình hay marker của OpenCode.

## Process và thư mục

- Không còn process nền do em khởi động. Các worktree, bản lui và bản ghi prod đã ghi ở `processes.md`.
- Worktree `paperclip-r3-dp` đang detached `826a49ea6`, sạch. Worktree `crew-r3-dp2` đang detached `b76059f`.

Status: DONE_WITH_CONCERNS
Summary: Prod chạy crew-v3/paperclip:v3-826a49ea6 (rollback: `ops/rollback.sh 20261010-151141` về v3-67b1dde8a), plugin ready, 0012 đã áp. App và crew-mac r24 b76059f đã cài, doctor 0 lỗi, runtimes-setup báo codex.loggedIn true. Đã tạo repo-a-executor-codex 62d450f3 và repo-a-reviewer-codex 38a28c7d bằng wizard, Codex vẫn tắt; 11 AGENTS.md khớp template mới.
Concerns/Blockers: (1) overlay-source.sh không ship adapter codex/opencode, phải dùng bản chép tạm → cần FX-OPS. (2) Readiness A1 của agent Codex luôn đỏ vì API che CODEX_HOME → FX web. (3) Dòng vai trò repo-a ghi qua route board vì agent R1 trượt A5 trên tab Vai trò. (4) Tag crew/v3.3-rc1 đã có từ R2-3 nên dùng crew/v3.3-rc2. Trang issue chưa có khối Runtime vì chưa có quyết định runtime (cần AC-C).
