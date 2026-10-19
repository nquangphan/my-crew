# Crew v3 R2-4 — Runtime `codex_local`, `opencode_local` (OpenCode Go), công tắc theo máy, chọn model, fallback cùng máy

Ngày: 10/10/2026, Asia/Ho_Chi_Minh (bắt đầu 00:58 theo `date`).
Trạng thái: bản thiết kế viết khi owner vắng. Mục 11 có 5 câu hỏi. Owner đã trả lời ngày 10/10 07:06, xem **§12 "Đổi
theo owner 10/10"**: §12 thắng mọi chỗ khác trong spec này. Kế hoạch thi công hiện hành là
[`plans/261010-0100-crew-v3-r2-4/replan-r3.md`](../../../plans/261010-0100-crew-v3-r2-4/replan-r3.md), lập lại trên nền
R3X. [`plan.md`](../../../plans/261010-0100-crew-v3-r2-4/plan.md) chỉ còn làm tham chiếu.

Đầu vào:
- Spec v3 §4: Claude Code, Codex và API OpenAI-compatible chung pool theo máy; ba switch độc lập; OFF chặn dispatch và
  fallback mới, không kill lượt đã nhận; chọn model theo độ khó, rủi ro, context, input; lưu rationale; fallback cùng
  máy, reconcile trước retry, giữ artifact và capability ảnh/file.
- Mục R2 trong `plans/261006-0805-crew-v3-stock-first/plan.md`.
- Owner chốt 10/10/2026 00:20:
  - API OpenAI-compatible là gói **OpenCode Go** đang có. Quota $12/5 giờ, $30/tuần, $60/tháng. Kiểm bằng
    `opencode stats`, model list lấy từ `opencode models`.
  - Nghiệm thu `codex_local` bằng **tài khoản Codex hiện có**, một run nhỏ thật.
  - Key do owner tự nạp vào Keychain. Agent không cầm, không in key.
- Ghi chú lịch sử: owner từng cấm dùng Codex/OpenCode làm **worker phát triển** (08/10). R2-4 là tính năng sản phẩm
  cho agent Crew. Worker phát triển R2-4 vẫn chỉ là agent Claude.

## 1. Mục tiêu

1. Mỗi Mac chạy được ba runtime cho agent Crew:
   - `claude_local` (đã có);
   - `codex_local` (tài khoản ChatGPT của owner trên Mac);
   - `opencode_local` với provider `opencode-go` (gói OpenCode Go, endpoint kiểu OpenAI, tool loop thật của OpenCode).

   Cả ba chạy `in_place` trong worktree riêng của agent qua SSH environment như R1. Credential chỉ nằm trên Mac.
2. Mỗi máy (environment SSH) có ba công tắc độc lập, một cho mỗi runtime:
   - OFF giữ run mới của runtime đó ở `queued` và không cho fallback mới vào runtime đó;
   - run đang chạy không bị dừng.
3. Trợ Lý chọn runtime và model cho từng issue con theo bảng độ khó. Lý do được lưu ở marker `crew-model` trong mô tả
   issue và ở bảng quyết định của plugin.
4. Run hỏng vì quota, đăng nhập hoặc runtime không dùng được, hoặc run bị giữ vì công tắc OFF, thì chuyển sang runtime
   khác **trên cùng máy**:
   - trước run mới, Crew reconcile: dừng phần còn lại của run trước, liệt kê commit, nhả nhánh;
   - giữ nhánh và commit, giữ nguyên số vòng review;
   - không chọn model không đọc được ảnh khi issue có ảnh.
5. Không thêm hook lõi (5/5). Vá adapter mới chỉ theo quy trình `adapter-patch` trong `crew/release/core-hooks.json`
   và chờ owner duyệt (mục 6.7).

## 2. Hiện trạng (đọc ngày 10/10/2026, fork `crew/r2-2` @ `f862b7b20`, repo Crew `r2-2` @ `204794c`)

### 2.1. Adapter stock trong fork

| Điểm | `codex_local` | `opencode_local` |
|---|---|---|
| `in_place` qua SSH | Có. `execute.ts:632`, `:795–823`: chạy ở `authoritativeRoot`, `syncWorkspace: false` | **Không.** `execute.ts:384–416`: luôn đồng bộ workspace từ cwd phía VPS sang Mac rồi `restoreWorkspace` ngược lại. Với Crew, cwd thật nằm trên Mac, nên run sẽ chạy trên bản chép, không phải worktree của agent |
| Home của runtime | Dựng `CODEX_HOME` trên VPS, chép sang Mac thành asset `home` (`execute.ts:803–860`). Khi trả lease, `restore` của asset đọc `auth.json` phía Mac. Nếu "mới hơn, cùng identity" thì **chép ngược lên VPS** (`copyBackCodexAuth`). Trên SSH, `restore` có chạy thật (`adapter-utils/src/remote-managed-runtime.ts:238–256`) | Khi target là SSH và không có `managedAiConnection`, adapter đọc HOME thật của Mac rồi chạy `rm -rf "$HOME/.claude/skills" && cp -a <skills của Paperclip> "$HOME/.claude/skills"` (`execute.ts:445–462`). **Lệnh này xóa thư mục skill của owner trên Mac.** `managedAiConnection` tránh được việc xóa nhưng đó là tính năng credential do server quản lý (`server/src/services/ai-connection-runtime.ts`), trái nguyên tắc credential chỉ ở Mac |
| Resume session qua SSH | `sessionCodec` (`codex-local/src/server/index.ts:73–110`) bỏ mất `remoteExecution`. `adapterExecutionTargetSessionMatches` cho SSH đòi trường này (`adapter-utils/src/execution-target.ts:1327–1334`), nên mỗi run là session mới. Đây đúng là lỗi vá P3 đã sửa cho claude | Như codex (`opencode-local/src/server/index.ts:7–40`) |
| Model | Bảng `models` (`codex-local/src/index.ts:109`). Effort qua `modelReasoningEffort` | `provider/model` bắt buộc. Kiểm model trên Mac bằng `opencode models` trước run (`execute.ts:106–170`). Effort qua `variant` |
| Lỗi quota | `errorFamily: "provider_quota"` / `"transient_upstream"` (`execute.ts:1492–1534`). Stock retry có hẹn `retryNotBefore` (`server/src/services/heartbeat.ts:1090–1145`, `:15300+`) | Không phân loại. Chỉ có `errorCode` của process (`execute.ts:720`) |

### 2.2. Phần Crew đã có

- **Chọn model theo độ khó.**
  - `server/src/crew/model-policy.ts`: `CREW_COMPLEXITY_MODEL` cho `trivial`/`small`/`medium` là `claude-sonnet-5`,
    `large` là `claude-opus-5`.
  - `checkAgentAdapterOverrides` chỉ cho key `adapterConfig.model` và `adapterConfig.effort`, model thuộc tập Claude.
    Được gọi ở H4 (`issue-create-policy.ts:79`) và H2 (`issue-gate.ts:307`).
  - Trợ Lý ghi `crew-model complexity=… model=… effort=… reason=…` vào mô tả issue con (`crew/agents/assistant.md:73–101`).
    Lý do lựa chọn **đã được lưu** ở đây, nhưng chỉ cho Claude.
- **H1 `crewBeforeClaim`** (`load-gate.ts`):
  - giữ run khi máy quá tải hoặc không vào được (`environment.metadata.crewLoadGate`);
  - hủy và block khi quá hạn;
  - retry-progress: với run có `retryOfRunId`, một lệnh SSH dừng phần còn lại của run trước rồi liệt kê commit, sau đó
    comment cho agent (`retry-progress.ts`). Đây chính là "reconcile trước retry".
- **H3:** dừng process của run theo file `pgid`/`started` do wrapper ghi
  (`remote-stop.ts`, `apps/crew-mac/assets/crew-claude-run.sh`).
- **Bộ dọn process mồ côi** (`apps/crew-mac/src/reaper/*`) chỉ nhận `claude --print` (`run-members.ts`, `isClaudePrint`).
- **Vai trò project** `crew_project_roles` (`packages/crew-plugin/migrations/0004_project_roles.sql`):
  `executor_agent_ids` 1–2 agent. Server đọc bảng plugin qua `server/src/crew/project-roles.ts`.
- **Bản tin máy:**
  - `apps/crew-mac/src/status/report.ts` gửi `MachineReport` mỗi 60 giây;
  - plugin kiểm chặt từng trường; trường tùy chọn `app` được bỏ riêng khi sai dạng
    (`packages/crew-plugin/src/machines/webhook.ts`). Đây là khuôn để thêm `runtimes`.
- **Plugin:**
  - đã có `issues.update`, `issue.comments.create`, `events.subscribe`, `jobs.schedule`, `authorization.audit.read`;
  - **chưa có** `issues.wakeup`, `agents.read`;
  - đổi assignee qua plugin **không** tự đánh thức agent (`run-cancelled.ts`). `issues.requestWakeup` tạo run có ngữ
    cảnh issue (`server/src/services/plugin-host-services.ts:2164–2230`).

### 2.3. Trên Mac mini

- `codex-cli 0.161.0` ở `~/.local/bin/codex`. Đăng nhập ChatGPT của owner ở `~/.codex/auth.json`. Ngày 08/10 tài khoản
  này từng trả 400. Owner chốt dùng lại tài khoản này cho nghiệm thu.
- `opencode 1.18.35` ở `/opt/homebrew/bin/opencode`. Credential hiện ở `~/.local/share/opencode/auth.json` (file).
  Owner sẽ nạp key vào Keychain.
- `opencode models opencode-go` (01:03): 30 model, gồm `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`,
  `deepseek-v4-pro`, `glm-5.3`, `kimi-k3`, `kimi-k2.7-code`, `qwen3.8-max`, `minimax-m3`, `gpt-6-luna`…
- `opencode stats --days 7`: `kimi-k3` $2,72, `kimi-k2.6` $0,21.

## 3. Ranh giới

| Việc | Ai làm | Ở đâu |
|---|---|---|
| Chạy runtime, giữ credential, cách ly config người dùng, ghi `pgid` | Wrapper trên Mac | `apps/crew-mac/assets/crew-{codex,opencode}-run.sh` |
| Kiểm nguồn nạp chéo theo runtime | `crew-mac workflow-check --runtime` | `apps/crew-mac/src/workflows/*` |
| Báo runtime đã cài, đã đăng nhập, quota ước tính | Bản tin máy | `apps/crew-mac/src/status/runtimes.ts` → plugin |
| Lưu công tắc, quyết định (chọn, fallback), API cho UI | Plugin `crew.core` | migration `0006`, `src/runtimes/*` |
| Giữ run khi công tắc OFF; reconcile trước run fallback | Thân H1 | `server/src/crew/{runtime-gate,load-gate,retry-progress}.ts` |
| Kiểm model/effort theo runtime của assignee | Thân H2/H4 | `server/src/crew/model-policy.ts` |
| Chọn runtime/model cho issue con | Trợ Lý (instructions) | `crew/agents/assistant.md` |
| Chuyển runtime khi hỏng hoặc bị giữ | Plugin (sự kiện + job mỗi phút) | `packages/crew-plugin/src/runtimes/fallback.ts` |
| Chạy trong `in_place`, resume session | Adapter (vá P5–P7, chờ owner) | `packages/adapters/{codex,opencode}-local/**` |

Paperclip vẫn là scheduler duy nhất. Crew không tạo queue riêng. Fallback chỉ đổi assignee của issue và nhờ stock đánh
thức agent mới.

## 4. Runtime và agent

### 4.1. Agent theo runtime

Mỗi project có tối đa **một executor cho mỗi runtime** trên cùng máy (khuyên ở Q5):
- cùng `defaultEnvironmentId`;
- worktree riêng (các worktree chung một repo git nên chung ref nhánh `crew/<identifier>`);
- `maxConcurrentRuns = 1`.

Trợ Lý, reviewer, integrator, agent BMAD vẫn là `claude_local`. Bảng `crew_project_roles` nới `executor_agent_ids` lên
1–3 (migration `0006`). **Đã đổi ở §12:** reviewer được chạy Codex; executor/reviewer runtime nằm ở cột và ô riêng,
migration là `0012`.

| Runtime | `adapterConfig` khi tạo agent (H5 khóa `command`, `extraArgs`, `env`, `model`) |
|---|---|
| `claude_local` | Như R1 (`engine: "cli"`, wrapper `crew-claude-run`, đúng một `--plugin-dir`) |
| `codex_local` | `{ command: "<HOME>/.crew/bin/crew-codex-run", model, modelReasoningEffort, dangerouslyBypassApprovalsAndSandbox: true, env: {} }`. Bỏ sandbox vì gitdir của worktree nằm ngoài worktree: seatbelt `workspace-write` chặn `git commit` và test Postgres nhúng (ghi chú 08/10 của owner) |
| `opencode_local` | `{ command: "<HOME>/.crew/bin/crew-opencode-run", model: "opencode-go/<id>", env: {} }`. Không đặt `managedAiConnection` |

### 4.2. Wrapper trên Mac

Phần chung (`assets/crew-run-mark.sh`, hai wrapper mới `.` nạp):
- khi có `PAPERCLIP_RUN_ID` hợp lệ, ghi `<PWD>/.paperclip-runtime/runs/<runId>/{started,pgid}` theo đúng cách của
  `crew-claude-run.sh`;
- H3 và `crew-mac stop-run` dùng file này nên không phải đổi.

Không đụng `crew-claude-run.sh` (R2-3 sở hữu).

**`crew-codex-run`:**
1. Chạy `crew-mac workflow-check --runtime codex_local --root "$PWD"`. Bị từ chối thì thoát 78, không chạy agent.
2. Dựng `CODEX_HOME` riêng của agent ở `~/.crew/runtimes/codex/<PAPERCLIP_AGENT_ID>/` (0700):
   - chép `config.toml` từ `CODEX_HOME` adapter truyền vào (asset `home` đã chép sang Mac);
   - `skills` → symlink tới `skills` của asset;
   - `auth.json` → symlink tới `~/.codex/auth.json`;
   - giữ `sessions/` qua các run để resume.

   Asset `home` của adapter không bao giờ chứa `auth.json`. Vì vậy `restore` lúc trả lease không đọc được gì, và
   credential không lên VPS. G0 kiểm C2: `restore` gặp file thiếu thì không làm hỏng run.
3. Export `CREW_SUPERPOWERS_DIR=<thư mục ghim Superpowers>`, rồi `exec codex "$@"`.

**`crew-opencode-run`:**
1. `workflow-check --runtime opencode_local`.
2. Đọc key bằng `security find-generic-password -s crew.opencode-go -a crew -w` vào biến môi trường chỉ của process
   (`CREW_OPENCODE_GO_KEY`). Không echo, không ghi file, không truyền qua đối số. Thiếu key thì thoát 78:
   `crew-runtime blocked: thiếu key OpenCode Go trong Keychain (service crew.opencode-go); owner chạy "crew-mac runtimes key opencode"`.
3. Đặt `XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME` về `~/.crew/runtimes/opencode/<agentId>/…`:
   - session được giữ cho resume;
   - không đọc `auth.json` của owner;
   - nếu adapter đã đặt `XDG_CONFIG_HOME` (asset `xdgConfig`) thì giữ nguyên, nếu chưa thì đặt về thư mục riêng.
4. Truyền key và quyền cho OpenCode bằng `OPENCODE_CONFIG_CONTENT` (G0 kiểm O2), dạng
   `{"provider":{"opencode-go":{"options":{"apiKey":"{env:CREW_OPENCODE_GO_KEY}"}}},"permission":{"edit":"allow","bash":"allow","external_directory":"allow"}}`.
   `external_directory` cần cho `git commit` vì gitdir của worktree nằm ngoài (G0 O3).
5. Export `CREW_SUPERPOWERS_DIR`, rồi `exec opencode "$@"`.

Lệnh `crew-mac runtimes key opencode` cho owner nạp key:
- gọi `security add-generic-password -U -s crew.opencode-go -a crew -w` với key đọc từ stdin;
- in `đã lưu` hoặc lỗi, không in key;
- agent không chạy lệnh này.

### 4.3. Workflow cho runtime ngoài Claude

Superpowers là plugin của Claude Code. Codex và OpenCode không nạp `--plugin-dir`.

Executor chạy `codex_local`/`opencode_local` theo **cùng quy trình Superpowers** bằng cách đọc thẳng file skill đã ghim:
- `"$CREW_SUPERPOWERS_DIR/skills/<tên>/SKILL.md"` khi instructions yêu cầu skill;
- instructions executor có mục riêng cho runtime ngoài Claude.

Bản ghim là bản R2-1/R2-3 đã ghim, không cài thêm gì.

`crew-mac workflow-check --runtime <r>` (mới) kiểm worktree và môi trường:
- chặn `.codex/**`, `.opencode/**`, `opencode.json`, `opencode.jsonc` trong worktree, trừ file được repo theo dõi bằng
  git và có trong allow-list của R2-3;
- kiểm `CREW_SUPERPOWERS_DIR` trỏ đúng bản ghim (checksum).

Sổ workflow của R2-3 (`registry.ts`) thêm `codex_local`, `opencode_local` vào `runtimes` của `superpowers`. BMAD giữ
`['claude_local']`.

### 4.4. Bộ dọn và dừng run

- `run-members.ts` thêm `isAgentPrint(p)`: `claude --print|-p`, `codex exec`, `opencode run`, kèm `runId` lấy từ env
  như hiện có.
- `select.ts` dùng `isAgentPrint` thay `isClaudePrint`.
- H3 không đổi, vì dừng theo `pgid` của wrapper.

## 5. Công tắc runtime theo máy

- **Bảng plugin `crew_runtime_switches`** `(company_id, environment_id, runtime, enabled, updated_by_user_id, updated_at)`,
  khóa `(company_id, environment_id, runtime)`.
- **Khi chưa có dòng:**
  - `claude_local` = ON;
  - `codex_local`, `opencode_local` = OFF (Q4).

  Bảng chưa tồn tại (plugin chưa migrate) cũng tính như vậy.
- **Ghi:** route plugin `PUT /runtime-switches`, chỉ board (`actor.actorType === "user"`), theo khuôn
  `roles/api.ts`. Mỗi lần đổi:
  - ghi audit `crew.runtime_switch.set` (trước/sau, user);
  - cập nhật thẻ máy trong UI plugin: ba nút gạt cho mỗi environment SSH.

  R3 dùng lại đúng route này.
- **Thân H1** (`runtime-gate.ts`, gọi sau load gate, trước bundle resume):
  - run của agent có `adapterType` ∈ ba runtime và `defaultEnvironmentId` có công tắc OFF thì trả `true` (giữ
    `queued`);
  - lần đầu bị giữ, ghi activity `crew.runtime_gate.waiting` với `{runtime, environmentId, issueId}`.

  H1 không comment, không hủy: plugin lo fallback (mục 7). Run đang chạy không bị đụng.
- **Pool theo máy.** Load gate H1 (`crewLoadGate`) áp cho mọi agent của environment bất kể runtime. Ba runtime chung
  ngưỡng tải của máy, không có pool riêng.

## 6. Chọn model theo độ khó và lưu lý do

### 6.1. Bảng runtime/model (`CREW_RUNTIME_CATALOG`, tạm theo Q2)

| complexity | Thứ tự runtime (chọn và fallback) | `claude_local` | `codex_local` | `opencode_local` |
|---|---|---|---|---|
| `trivial` | opencode → claude → codex | `claude-sonnet-5` / `low` | `gpt-6-luna` / `low` | `opencode-go/deepseek-v4-flash` |
| `small` | opencode → claude → codex | `claude-sonnet-5` / `medium` | `gpt-6-luna` / `medium` | `opencode-go/kimi-k3` |
| `medium` | claude → codex → opencode | `claude-sonnet-5` / `high` | `gpt-6-sol` / `high` | `opencode-go/glm-5.3` |
| `large` | claude | `claude-opus-5` / `high` | — | — |

- **Key effort theo runtime:** `effort` (claude), `modelReasoningEffort` (codex), không có (opencode; marker ghi
  `effort=default`).
- **Ảnh:** mỗi model có cờ `vision`.
  - Claude và Codex `true`.
  - OpenCode Go lấy từ `opencode models opencode-go --verbose` ở G0 (O1). Model không có `vision` bị bỏ qua khi
    issue có ảnh.

  Bảng chép ở ba nơi, mỗi nơi có test so khớp nguyên văn:
  - server `model-policy.ts`;
  - plugin `src/runtimes/catalog.ts`;
  - bảng trong `assistant.md`.

### 6.2. Trợ Lý chọn

Trợ Lý chọn runtime cho từng gói:
1. Lấy mức `complexity` như hiện nay, thêm hai luật:
   - issue chạm bảo mật/phân quyền, migration, hợp đồng công khai là `large`;
   - gói có ảnh thì chỉ chọn model `vision`.
2. Chọn runtime đầu tiên theo thứ tự của mức đó mà project có executor runtime ấy.
3. Marker đổi thành:

   `crew-model complexity=<mức> runtime=<claude_local|codex_local|opencode_local> model=<model> effort=<effort|default> reason=<một dòng lý do>`

   Marker cũ không có `runtime=` vẫn hợp lệ, hiểu là `claude_local`.
4. `assigneeAgentId` là executor của runtime đó. `assigneeAdapterOverrides.adapterConfig` chỉ có `model` và key effort
   của runtime.

Trợ Lý không biết công tắc. Nếu runtime đang OFF thì H1 giữ run, rồi plugin fallback (mục 7). Như vậy chỉ có một chỗ
quyết định theo công tắc.

### 6.3. Kiểm ở server (thân H2/H4)

`checkAgentAdapterOverrides(value, adapterType)`:
- `adapterType` là của assignee, đọc theo `assigneeAgentId` trong cùng transaction;
- model phải thuộc `CREW_RUNTIME_CATALOG[adapterType].models`;
- key effort phải đúng key của runtime, giá trị thuộc tập cho phép;
- assignee ngoài ba runtime thì giữ luật Claude cũ.

Mã lỗi giữ `CREW_OVERRIDE_FORBIDDEN_MESSAGE`, `violations` ghi rõ `adapterConfig.model:<id>@<runtime>`.

### 6.4. Lưu lý do

- **Lựa chọn ban đầu:** dòng `crew-model … reason=` trong mô tả issue (đã có). Plugin ghi thêm một dòng `select`
  vào `crew_runtime_decisions` khi thấy issue con mới có marker:
  - đọc ở event `issue.created`;
  - chỉ lấy trường đã parse, không lưu mô tả.
- **Fallback:** dòng `fallback` hoặc `fallback_refused` gồm:
  - `from_agent_id`, `to_agent_id`, `from_runtime`, `to_runtime`, `model`;
  - `trigger` (`quota` | `auth` | `unavailable` | `switch_off`);
  - `reason` (câu tiếng Việt);
  - `run_id` của run hỏng.

  Kèm một comment trên issue.
- **Đọc lại:** data `crew.runtimeDecisions` (theo issue) cho UI plugin hiện tại và R3.

### 6.5. Vá adapter cần owner duyệt

| ID | File | Vì sao bắt buộc | Mẫu |
|---|---|---|---|
| P5 | `packages/adapters/codex-local/src/server/index.ts` (`sessionCodec`) | Không vá thì codex qua SSH không bao giờ resume. Gói nhiều issue cùng executor mất session chung (spec v3 §4) | P3 của claude: giữ `remoteExecution` khi serialize/deserialize |
| P6 | `packages/adapters/opencode-local/src/server/execute.ts` | Không vá thì OpenCode (1) chạy trên bản chép workspace, commit không về worktree, và (2) **xóa `~/.claude/skills` của owner** mỗi run | P2 + `codex_local`: khi `workspaceRealization.mode === "in_place"` thì chạy ở `authoritativeRoot`, `syncWorkspace: false`, bỏ chép skills vào `$HOME/.claude/skills` |
| P7 | `packages/adapters/opencode-local/src/server/index.ts` (`sessionCodec`) | Như P5 | P3 |

- Mỗi vá:
  - có mục `kind: "adapter-patch"` trong `crew/release/core-hooks.json` với anchor, mô tả, test;
  - có test `*.crew.test.ts` cạnh file;
  - có ghi chú gửi upstream.
- Hook lõi vẫn 5/5. Thân H1 mở rộng, cập nhật `description` của H1. Thân H2/H4 đổi hàm kiểm, giữ `anchor`.
- Không duyệt P6 thì `opencode_local` **không** được bật trên máy nào. Doctor báo lỗi `opencode-in-place`, và công tắc
  bị khóa OFF.

## 7. Fallback cùng máy

### 7.1. Khi nào

- **Theo sự kiện `agent.run.failed`** (plugin). Phân loại bằng `classifyRuntimeFailure`:
  - `quota`: `errorFamily === "provider_quota"`; hoặc opencode có thông điệp khớp bảng mẫu quota (G0 O4 chốt mẫu
    từ mã nguồn và log thật);
  - `auth`: mã lỗi đăng nhập của adapter (`*_auth_required`, thông điệp đăng nhập), hoặc wrapper thoát 78 với
    `crew-runtime blocked: thiếu key`;
  - `unavailable`: `adapter_engine_unavailable`, lệnh không tìm thấy, `opencode-in-place` thiếu;
  - `other` (lỗi code, test, timeout, 422, `crew-workflow blocked`): **không fallback**, để stock và Crew xử lý như
    hiện nay.
- **Theo job `runtime-fallback` mỗi phút** (plugin):
  - đọc audit `crew.runtime_gate.waiting` mới;
  - với issue mà run vẫn đang bị giữ vì công tắc OFF thì trigger là `switch_off`.

### 7.2. Chọn đích

`chooseFallback` là hàm thuần.
- **Ứng viên:** executor khác của cùng project (`crew_project_roles`) có:
  - cùng `defaultEnvironmentId`;
  - agent không `paused`/`terminated`;
  - công tắc runtime ON;
  - bản tin máy mới nhất không báo runtime chưa đăng nhập, thiếu key hay vượt quota:
    - codex: `primaryUsedPct ≥ 99`;
    - OpenCode Go: chi phí ước tính 5 giờ ≥ $12, tuần ≥ $30 hoặc tháng ≥ $60.
- **Thứ tự:** theo `complexity` của marker, bỏ runtime đã thử trong `crew_runtime_decisions` của issue.
- **Model:** theo bảng §6.1 cho runtime đích. Issue có ảnh thì chỉ model `vision`.
- **Trần:** tối đa 2 lần fallback mỗi issue (Q3). `large` không fallback (chỉ Claude): ghi `fallback_refused`,
  comment, rồi để stock tự retry khi hết hẹn quota.
- **Không có đích:**
  - với `switch_off`: comment một lần
    `Runtime <r> đang tắt trên máy <env> và không có runtime khác bật cho mức <c>; run chờ tới khi owner bật lại.`
    Run giữ `queued`, không block;
  - với trigger khác: chuyển issue sang `blocked` và comment.

### 7.3. Thực hiện (plugin, idempotent theo `run_id`)

1. Insert `crew_runtime_decisions` (`ON CONFLICT (run_id, kind) DO NOTHING`). Dòng đã có thì dừng.
2. Comment:
   `Crew: chuyển từ <runtime> (<agent>) sang <runtime> (<agent>), model <model>. Lý do: <trigger tiếng Việt>. Nhánh và commit của run trước được giữ.`
3. `issues.update(issue, { assigneeAgentId: to, assigneeAdapterOverrides: { adapterConfig: { model, [effortKey]: effort } } })`.
   H2 kiểm override theo runtime mới.
4. `issues.requestWakeup(issue, { reason: "crew_runtime_fallback" })`.

Lượt chạy cũ:
- run cũ đã kết thúc (`failed`);
- retry hẹn giờ của agent cũ, hoặc run của agent cũ còn `queued` vì công tắc OFF, bị hủy theo kết quả G0 P2:
  - stock tự hủy khi đổi assignee thì không làm gì thêm;
  - stock không tự hủy thì thân H1 hủy run có `agentId ≠ issue.assigneeAgentId` mà quyết định `fallback` mới nhất của
    issue có `from_agent_id = run.agentId` (`scheduleCancel`, lý do `crew_runtime_fallback`).

### 7.4. Reconcile trước run fallback (thân H1)

Run của agent đích có `contextSnapshot.wakeReason === "crew_runtime_fallback"`.
1. H1 tìm `run_id` cũ trong `crew_runtime_decisions`.
2. H1 chạy **một** lệnh SSH như retry-progress, nhắm worktree của run cũ (`buildRetryProgressCommand(prevRunId, prevCwd)`).
   Lệnh này:
   - dừng phần còn lại của run cũ;
   - liệt kê commit từ lúc run cũ bắt đầu;
   - nếu worktree cũ đang ở `crew/<identifier>` và sạch thì `git switch --detach`, để worktree mới `git switch` được.
3. Comment `Crew: chuyển runtime sau run <id> …` liệt kê commit (cùng dạng comment retry-progress để executor đã biết
   cách xử lý).
4. Worktree cũ bẩn thì H1 comment
   `Worktree của run trước còn thay đổi chưa commit; Crew không mang sang. Owner xem rồi chuyển issue về todo.`,
   block issue, giữ run mới `queued` rồi hủy.

Không mang session giữa runtime (spec v3 §4: không giả chuyển session). Số vòng review giữ nguyên vì cùng issue.

## 8. Nghiệm thu (đo được, ít run)

Quota chung:
- Codex đúng **1** run;
- OpenCode đúng **1** run nghiệm thu và **1** run thử ở G0;
- Claude: Trợ Lý 1, reviewer 2, executor fallback 1.

| AC | Cách đo |
|---|---|
| AC1 OpenCode `in_place` | Issue `trivial` (đổi một dòng README `repo-a`), Trợ Lý chọn `opencode_local`/`deepseek-v4-flash`, marker có `reason`. Executor OpenCode commit trên `crew/<id>` trong **worktree của agent đó** (`git -C <worktree> log`), có `crew-commit`. Reviewer Claude duyệt |
| AC2 Skill owner còn nguyên | `crew-mac` tính checksum cây `~/.claude/skills` trước và sau AC1: bằng nhau |
| AC3 Codex | Owner (qua script ops) tạo issue giao thẳng executor codex có marker `runtime=codex_local model=gpt-6-luna`. Run qua tài khoản ChatGPT trên Mac, commit, `crew-commit`. Sau run, `~/.codex` của container VPS không có `auth.json` và log VPS không có chuỗi token (grep `"access_token"`, `refresh_token`) |
| AC4 OFF không kill | Trong lúc run AC3 đang chạy, owner tắt `codex_local` trên máy: run AC3 vẫn xong. Issue thứ hai giao executor codex nằm `queued`, có activity `crew.runtime_gate.waiting` |
| AC5 Fallback theo công tắc + reconcile | Issue thứ hai của AC4 được plugin chuyển sang `claude_local` trong ≤ 2 phút. Có comment `Crew: chuyển từ codex_local …`, có dòng `fallback` (`trigger=switch_off`), run Claude chạy trên cùng máy. Run Claude đầu tiên có activity kiểm tiến độ `crew.runtime_fallback.checked` với `previousRunId` của run cũ, dù run Claude do plugin hay recovery của lõi đánh thức. Comment reconcile `Crew: chuyển runtime sau run …` chỉ bắt buộc khi run cũ có commit; run Codex bị giữ trước khi chạy (0 commit) thì chỉ cần activity này |
| AC6 Fallback quota | Test DB (Postgres nhúng) của plugin: sự kiện `agent.run.failed` với `errorFamily: "provider_quota"` tạo đúng một quyết định, đổi assignee, gọi `requestWakeup`. Gửi lại sự kiện không tạo thêm. `large` thì `fallback_refused`. Không tái hiện quota thật trên prod (ghi rõ trong báo cáo) |
| AC7 Kiểm override | `POST` issue con với `runtime` opencode mà model `claude-opus-5` cho executor opencode: 422, có `violations` |
| AC8 Credential | `grep` key OpenCode (lấy độ dài và 4 ký tự đầu từ Keychain **bằng script owner chạy**, không in ra transcript) trên `~/.crew/logs`, transcript run AC1, log container VPS khung giờ AC: 0 dòng. `ps -E` lúc run không thấy key trong argv |
| AC9 Hook | `check-core-hooks.mjs` báo H1–H5 và P1–P7. `base` = `v2026.1005.0`. Diff fork chỉ trong phạm vi plan |
| AC10 Bản tin | Thẻ máy hiện ba runtime: phiên bản, đăng nhập/key có hay không, quota ước tính. Ba nút gạt đổi được, có audit |

## 9. Giả định đo ở SP-0 (cổng G0, không tốn run Paperclip)

- **C1** `codex login status` chạy qua sshd agent (phiên desktop) báo đã đăng nhập. Không in token.
- **C2** Đọc code và chạy test đơn vị trong fork:
  - với SSH `in_place`, `restore` của asset `home` gặp `auth.json` thiếu thì không làm hỏng run và không ghi gì lên
    VPS;
  - `CODEX_HOME` adapter truyền qua env tới wrapper là đường tuyệt đối trên Mac.
- **C3** Đọc được quota Codex từ `~/.codex/sessions/**/*.jsonl` (`rate_limits.primary.used_percent`, `resets_at`)
  không cần token.
- **O1** `opencode models opencode-go --verbose` cho cờ ảnh/tool cho từng model trong bảng §6.1. Model nào không có
  tool call thì loại.
- **O2** Một `opencode run` rẻ nhất (`deepseek-v4-flash`, prompt một dòng):
  - HOME/XDG tạm, không có `auth.json`;
  - key chỉ từ Keychain qua `OPENCODE_CONFIG_CONTENT` `{env:…}`.

  Đạt khi run trả lời. Không đạt thì thử biến môi trường provider mà mã nguồn OpenCode dùng và ghi lại. Key nạp vào
  Keychain do owner làm trước. Chưa có thì SP-0 dùng một mục Keychain thử do owner tạo sáng mai, và G0 chờ.
- **O3** Cùng run O2, trong một worktree thử có gitdir ngoài: `git commit --allow-empty` qua tool bash của OpenCode
  thành công với `permission.external_directory = allow`.
- **O4** Mẫu thông điệp quota/đăng nhập của OpenCode Go lấy từ mã nguồn `opencode` (bản 1.18.35) và log
  `~/.local/share/opencode/log` cũ (chỉ đọc dòng lỗi, không chép key).
- **P1** Payload `agent.run.failed` có `errorCode`, `errorFamily`, `issueId`. Nếu thiếu `errorFamily` thì plugin đọc
  `resultJson` qua đường nào; không có đường nào thì ghi lệch và dùng `errorCode`.
- **P2** Đổi `assigneeAgentId` qua `issueService.update` có hủy run `queued`/`scheduled_retry` của agent cũ hay
  không.

## 10. Không làm

- Chọn model bằng LLM riêng hay router. Trợ Lý chọn theo bảng.
- Chuyển session giữa runtime.
- Trợ Lý, integrator, BMAD chạy ngoài Claude. Reviewer được chạy Codex (§12.2).
- Chạy song song hai runtime cho một issue.
- Đổi máy khi fallback (spec v2/v3: mỗi project một máy).
- Dùng `managedAiConnection` hay đặt credential AI trên VPS.
- Đo quota bằng gọi API nhà cung cấp. Chỉ đọc dữ liệu local.
- UI mới (R3 làm). **Đã đổi ở §12.4:** công tắc và wizard agent runtime làm trong `packages/crew-web`.
- Đổi `apps/mac-app`.

## 11. Câu hỏi cho owner

Plan R2-4 tạm theo phương án khuyên của từng câu. Ticket bị ảnh hưởng ghi cuối câu.

1. **Duyệt vá adapter P5, P6, P7** (§6.5).
   - Khuyên: duyệt cả ba. Cả ba nhỏ, cùng khuôn P2/P3 đã duyệt, có test và mục `core-hooks.json`.
   - P6 bắt buộc để OpenCode chạy đúng worktree và **không xóa `~/.claude/skills`** của owner.
   - Phương án khác:
     - chỉ P6 (codex và OpenCode không resume session qua SSH, mỗi issue một session mới);
     - không vá (chỉ có `codex_local`, không resume; OpenCode khóa OFF).
   - Plan làm AD-1/AD-2 nhưng DP-1 chỉ deploy vá khi owner đã duyệt.
   - Ảnh hưởng: AD-1, AD-2, DP-1, AC1, AC2.
2. **Bảng runtime/model theo độ khó** (§6.1).
   - Khuyên:
     - `large` chỉ Claude Opus;
     - `medium` ưu tiên Claude Sonnet, rồi `gpt-6-sol`, rồi `glm-5.3`;
     - `trivial`/`small` ưu tiên OpenCode Go (`deepseek-v4-flash`/`kimi-k3`) để đỡ quota Claude, rồi Claude, rồi
       `gpt-6-luna`;
     - model OpenCode Go chỉ lấy từ danh sách đó.
   - Phương án khác:
     - Claude luôn đứng đầu, codex/OpenCode chỉ làm fallback;
     - owner tự đưa danh sách model OpenCode Go khác.
   - Ảnh hưởng: SV-1, PL-1, AG-1.
3. **Điều kiện và trần fallback** (§7).
   - Khuyên:
     - chỉ fallback khi quota, đăng nhập/key, runtime không dùng được, hoặc công tắc OFF;
     - không fallback khi lỗi code/test/timeout;
     - tối đa 2 lần mỗi issue;
     - `large` không fallback, chờ Claude.
   - Phương án khác:
     - fallback cả timeout;
     - trần 1;
     - `large` được xuống `gpt-6-sol`.
   - Ảnh hưởng: PL-2, AC5, AC6.
4. **Mặc định công tắc và ai bật.**
   - Khuyên:
     - `claude_local` ON;
     - `codex_local`, `opencode_local` OFF trên mọi máy cho tới khi owner tự bật;
     - chỉ board bật/tắt;
     - AC bật tạm trên Mac mini rồi để nguyên trạng thái owner chọn sau AC.
   - Phương án khác: bật cả ba ngay khi máy có runtime đăng nhập.
   - Ảnh hưởng: PL-1, SV-2, DP-1.
5. **Vai trò được chạy Codex/OpenCode và số executor.**
   - Khuyên:
     - chỉ executor;
     - mỗi project tối đa một executor mỗi runtime (`executor_agent_ids` 1–3);
     - Trợ Lý, reviewer, integrator, BMAD giữ Claude.
   - Phương án khác:
     - reviewer chạy Codex để review "khác mô hình";
     - tối đa 2 executor mỗi runtime.
   - Ảnh hưởng: PL-1, AG-1, AG-2, DP-1.

## 12. Đổi theo owner 10/10

Owner chốt 10/10/2026 07:06 (`plans/reports/cho-dai-ca-261010.md`, mục "Đại Ca đã chốt"). Thêm lệnh "code sẵn đi, test
sau": chưa có key OpenCode Go, Codex dùng tài khoản đang đăng nhập trên Mac. Mục này thắng các mục trước khi khác nhau.
Chi tiết thi công ở `replan-r3.md`.

### 12.1. Trả lời §11

| Câu | Owner chốt |
|---|---|
| Q1 vá P5, P6, P7 | Duyệt cả ba |
| Q2 bảng runtime/model | Theo khuyên (§6.1 giữ nguyên) |
| Q3 fallback | Theo khuyên: quota/auth/unavailable/switch_off, tối đa 2 lần mỗi issue, `large` không fallback |
| Q4 công tắc | `codex_local`, `opencode_local` TẮT sẵn trên mọi máy, chỉ board bật |
| Q5 vai trò | Theo khuyên cho executor (mỗi runtime tối đa một executor mỗi project), **thêm: reviewer được chạy Codex**. OpenCode chỉ làm executor. Trợ Lý, integrator, BMAD giữ Claude |

### 12.2. Reviewer chạy Codex

**Vai trò.**
- Mỗi project có thể thêm **một** reviewer Codex (ô `reviewer-codex`, cột `codex_reviewer_agent_id`), cạnh reviewer
  Claude bắt buộc (`reviewer_agent_id`).
- Reviewer Codex là agent `codex_local`:
  - model cố định `gpt-6-sol`, `modelReasoningEffort=high`;
  - wrapper `crew-codex-run` như executor Codex;
  - `CODEX_HOME` riêng theo agent;
  - chỉ board tạo (wizard web).
- Reviewer Codex thuộc tập reviewer/integrator: agent không được giao việc cho nó (luật SEC-2).

**Luật chọn** (server, thân H4, khi tạo issue con, hàm thuần `chooseReviewer`):
1. Chỉ **issue con code** được reviewer Codex. Issue gốc, research, bmad giữ reviewer Claude.
2. Executor của issue không chạy `codex_local`, project có reviewer Codex không `paused`/`terminated`, và công tắc
   `codex_local` trên máy của reviewer Codex đang bật → participant stage review là reviewer Codex.
3. Còn lại → reviewer Claude.

Trợ Lý không chọn reviewer. Lý do chọn được ghi vào `crew_runtime_decisions` (`kind=select`, `role=reviewer`).

**Khi reviewer Codex không chạy được.**
- Công tắc tắt sau khi đã giao: H1 giữ run.
- Hết quota hay mất đăng nhập: run hỏng.
- Plugin xử lý như fallback executor, nhưng đích duy nhất là reviewer Claude của project:
  - đổi participant + assignee nếu đo được rằng plugin đổi participant stage review an toàn (SP-K P3);
  - nếu không thì không đổi chính sách review. Plugin comment lý do, `switch_off` giữ `queued`, lý do khác `blocked`.
    Owner bật lại Codex hoặc dùng "Ép Done" của R3X.
- Số vòng review giữ nguyên.

**Instructions.** `reviewer.md` thêm mục "Khi chạy bằng Codex":
- cùng luật duyệt `crew-commit`, cùng mẫu gọi API;
- `PATCH` là lệnh ghi cuối;
- skill Superpowers đọc ở `$CREW_SUPERPOWERS_DIR/skills/<tên>/SKILL.md`.

**H2/H4.**
- H4 đặt participant stage review theo `chooseReviewer` cho issue con.
- H2 coi reviewer Codex như reviewer: cấm agent giao việc cho nó, issue mở lại thì giao về executor.
- `checkAgentAdapterOverrides` không áp cho reviewer (không có override theo issue).

**Roles.**
- Bảng `crew_project_roles` **thêm ba cột NULL được**:
  - `codex_executor_agent_id`;
  - `opencode_executor_agent_id`;
  - `codex_reviewer_agent_id`.
- Không nới CHECK `executor_agent_ids` 1–2 của R3: chỉ số mảng là ô `executor`/`executor-2`.
- Ô mới: `executor-codex`, `executor-opencode`, `reviewer-codex`. Ô quyết định runtime, roles API từ chối agent sai
  `adapterType`.
- "Executor của project" = `executor_agent_ids` ∪ hai cột executor mới.

### 12.3. Đổi do nền R3/R3X (không phải owner chốt, ghi để spec khớp code)

- Migration plugin R2-4 là `0012_runtimes.sql` (0006–0011 đã dùng).
- **Công tắc theo máy (`machine_id`)**, không theo environment, vì R3 cho mỗi agent một environment. Máy của agent là
  máy có bản tin chứa checkout = `remoteWorkspacePath` của environment; company một máy thì lấy máy đó; không xác định
  thì dùng mặc định.
- H1 ghi run bị giữ vào bảng plugin `crew_runtime_waits` cho job fallback đọc, vì host không cho plugin đọc
  `activity_log`.
- Việc trên máy đi qua hàng đợi việc máy của R3: loại mới `runtimes-setup` (cài wrapper, báo trạng thái runtime). Key
  OpenCode **không** đi qua hàng đợi; owner nạp tại Mac.
- Marker: `runtime=` đặt sau `effort=`:

  `crew-model complexity=<c> model=<m> effort=<e> runtime=<r> reason=<…>`

  Parser cũ của crew-web vẫn đọc được.
- Không thêm capability plugin (đều đã có). Mọi lời gọi host của plugin kèm `companyId` (FX-SCOPE).

### 12.4. UI

- Công tắc runtime ở **trang Máy** của `packages/crew-web`:
  - ba nút gạt mỗi máy;
  - trạng thái phiên bản, đăng nhập/key, quota ước tính;
  - nút "Cài runtime trên máy";
  - hỏi xác nhận khi bật.
- Thêm agent runtime bằng wizard add-agent (ô mới).
- Trang issue hiện runtime và các quyết định chọn/chuyển.
- UI plugin cũ không sửa.

### 12.5. Nghiệm thu

§8 chia hai đợt:
- **AC-C** (Codex, làm sau deploy): AC3–AC7, AC9, AC10, thêm **AC11** reviewer Codex (một run review thật, một ca tắt
  Codex thì reviewer Claude). Codex tổng **2** run.
- **AC-O** (OpenCode, khi có key): AC1, AC2, AC8.

Giá trị §9 chưa đo được thì code theo giả định an toàn ở `replan-r3.md` mục 4, kiểm lại ở SP-C/SP-K/SP-O.
