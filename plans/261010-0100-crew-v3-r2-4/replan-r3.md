# R2-4 lập lại trên nền R3X — Runtime Codex/OpenCode, công tắc theo máy, reviewer Codex, fallback

Ngày: 10/10/2026 12:37 (Asia/Ho_Chi_Minh, theo `date`).

Bản này **thay phần Ticket, Đợt chạy, Nhánh/worktree, Sở hữu file và các Interface I1–I8** của [plan.md](plan.md).
Phần còn đúng của plan cũ vẫn dùng: Goal, Review Focus 1–5, luật credential, luật quota, khuôn vòng ticket,
`probe.md`/`fork.md`/`mac-runtimes.md` (đọc để biết chi tiết từng bước, nhưng file/nhánh/ID theo bản này).
Spec: [2026-10-10-crew-v3-r2-4-runtimes-design.md](../../docs/superpowers/specs/2026-10-10-crew-v3-r2-4-runtimes-design.md),
mục §12 "Đổi theo owner 10/10".

## 0. Lệnh owner và quyết định đã chốt

- Owner 10/10: **"code sẵn đi, test sau"**. Chưa có key OpenCode Go. Codex dùng tài khoản đang đăng nhập trên Mac.
- Owner chốt 07:06 (`plans/reports/cho-dai-ca-261010.md`):
  - duyệt vá adapter **P5, P6, P7**;
  - bảng runtime/model theo khuyên (spec §6.1);
  - fallback theo khuyên (quota/auth/unavailable/switch_off; trần 2; `large` không fallback);
  - công tắc `codex_local`, `opencode_local` **TẮT sẵn**, chỉ board bật;
  - **reviewer được chạy Codex** (thêm vào khuyên "chỉ executor"). Trợ Lý, integrator, BMAD vẫn Claude. OpenCode chỉ
    làm executor.

Hệ quả:
- Mọi ticket code chạy được ngay. Giá trị chưa đo được thì dùng **giả định an toàn** (mục 4), có chỗ kiểm ghi rõ.
- Codex đo được ngay: ticket đo Codex (SP-C) chạy ở Đợt 1.
- Phần cần key OpenCode (SP-O, AC-O) đứng riêng ở cuối, không chặn deploy phần Codex.

## 1. Nền mới và những gì R3/R3X đã đổi

| Nền | Giá trị |
|---|---|
| Fork Paperclip | `crew/r3x` @ `67b1dde8a` = prod image `v3-67b1dde8a`, tag `crew/v3.2` |
| Repo Crew | `r3x` @ `b827114` |
| Paperclip ghim | `v2026.1005.0` (không đổi) |

Plan cũ viết trên `crew/r2-2`/`r2-2`. Những điểm sau làm plan cũ sai, bản này đã sửa:

1. **Migration plugin đã tới `0011`** (`0006_machine_jobs` … `0011_removal_kinds`). R2-4 dùng **`0012_runtimes.sql`**.
   Plan cũ đặt `0006`, nay trùng tên với hàng đợi việc máy.
2. **Vai trò project theo ô (slot).**
   - `roles/api.ts` nhận `executorAgentIds` 1–2. Bảng `crew_project_roles` có CHECK không tên 1–2.
   - Mỗi agent có checkout riêng `~/crew-agents/<khóa>/<ô>` và environment riêng tên `<khóa>-<ô>`
     (`CrewRoleSlot` = `assistant | executor | executor-2 | reviewer | integrator`, ở plugin `jobs/types.ts`,
     mac-app `main/jobs/types.ts`, crew-web `api/crew/types.ts`).
   - Mảng `executor_agent_ids` dùng chỉ số làm ô (0 → `executor`, 1 → `executor-2`). Không nhét thêm agent runtime vào
     mảng này.
   - → R2-4 **thêm 3 cột tùy chọn** và **3 ô mới** (mục 3, I2, I11), không nới CHECK 1–2.
3. **Environment theo agent, không theo máy.**
   - "Công tắc theo environment" của plan cũ không còn nghĩa là "theo máy".
   - Máy của agent được tra như crew-web `use-agent-environment.ts` đang làm: bản tin máy mới nhất có `checkouts[].path`
     = `environment.config.remoteWorkspacePath`; company chỉ có một máy thì lấy máy đó.
   - → Công tắc khóa theo **`machine_id`** (I3).
4. **Hàng đợi việc máy + app Mac nhận việc** (MC-1/MC-2/R3X).
   - Board xếp việc, app 2P Crew claim bằng board key, chạy, báo kết quả. Có loại `check` chạy `crew-mac doctor`.
   - R2-4 dùng hàng đợi cho việc **cài wrapper và kiểm runtime** (loại mới `runtimes-setup`, I9).
   - **Key OpenCode KHÔNG đi qua hàng đợi** (payload/result nằm trên VPS). Owner nạp key tại Mac.
5. **Vá lõi C1–C6** (`kind: "core-patch"`) đã có trong `core-hooks.json`, cạnh H1–H5, P1–P4.
   - P5–P7 vẫn là `adapter-patch`.
   - File adapter codex/opencode **không đổi** từ `f862b7b20` tới `67b1dde8a` (đã `git diff`): anchor của I7 còn đúng.
6. **UI Crew mới `packages/crew-web`** (fork) thay UI Paperclip ở `crew.2p-solutions.com`.
   - Công tắc runtime có UI ở **trang Máy** (`features/machines`).
   - Thêm agent runtime qua **wizard add-agent** (`features/wizards/add-agent`).
   - UI plugin cũ (`packages/crew-plugin/src/ui/machines`) **không** sửa.
   - UI hai thứ tiếng: chuỗi mới vào cả `locales/vi.json` và `locales/en.json`.
   - `properties-panel.tsx` parse `^crew-model complexity=(\S+) model=(\S+) effort=(\S+)`. Marker mới phải giữ
     thứ tự này (I1).
7. **SEC-2 / CORE-P.**
   - Agent không tạo/sửa agent, skill, hướng dẫn (`agent-config-gate.ts`, `crew_agent_create_forbidden`/
     `crew_agent_config_forbidden`).
   - Plugin tự pause agent không do board tạo (`security/guards.ts`).
   - → Agent codex/opencode/reviewer-codex **chỉ board tạo** (wizard web). Fallback chỉ đổi assignee/override của
     issue, không sửa agent.
   - Luật giao việc `agentAssignmentAllowed` (`project-roles.ts`): agent thường chỉ giao cho executor của project.
     Executor runtime mới phải vào tập executor. Reviewer Codex phải vào tập reviewer/integrator bị cấm giao.
8. **FX-SCOPE.**
   - Plugin gọi host luôn kèm `companyId` (`ctx.issues.update(…, companyId)`, `ctx.agents.get(id, companyId)`,
     `requestWakeup(…, companyId)`).
   - Job chạy theo company đọc danh sách đã lưu `crew_companies` (0010), không gọi `companies.list` không scope.
   - C6 (sự kiện plugin giao bằng `call`) đã lên prod.
9. **Bài học plugin (bắt buộc cho mọi ticket `packages/crew-plugin/**`).**
   - Cột JSON là `jsonb`.
   - `ctx.db` một lệnh mỗi lần, **không transaction nhiều lệnh**, `execute` chỉ trả `rowCount` (không `RETURNING`).
     Idempotent bằng UNIQUE + `INSERT … ON CONFLICT DO NOTHING` và đọc `rowCount`. Khóa bằng `UPDATE … WHERE` có điều
     kiện.
   - Test DB chạy **từng file** (`corepack pnpm exec vitest run --config vitest.config.ts <file>`), helper
     `src/__tests__/plugin-host-db.ts`. Kiểm `ipcs -m` trước/sau.
   - Tên constraint tự sinh chốt bằng `pg_constraint` trên Postgres nhúng (như 0011).
   - **Không thêm capability mới.** Capability cần đều đã có: `issues.update`, `issues.wakeup`, `agents.read`,
     `events.subscribe`, `jobs.schedule`, `activity.log.write`. Thêm capability có thể làm plugin `upgrade_pending` khi
     deploy.
   - Host **không cho plugin đọc `activity_log`**. Plan cũ cho job fallback đọc activity `crew.runtime_gate.waiting`,
     nay không làm được. → H1 ghi hàng chờ vào bảng plugin `crew_runtime_waits` (I2, I4).
10. **`bundle-resume.ts`** đã biết `codex_local` (session theo adapter). Không cần sửa cho R2-4.

## 2. Nhánh và worktree (rẽ mới, không dùng nhánh R2-4 cũ)

Nhánh `crew/r2-4`, `r2-4` cũ chưa có commit code. Không dùng lại.

**Fork** (`~/Documents/projects/crew/.worktrees/paperclip-v3` là kho chung):

| Nhánh | Worktree | Rẽ từ | Ticket |
|---|---|---|---|
| `crew/r24` | `.worktrees/paperclip-r24-int` | `crew/r3x` @ `67b1dde8a` | tích hợp, `verify.sh`, RV-1, DP |
| `crew/r24-adapters` | `.worktrees/paperclip-r24-adapters` | `crew/r24` | AD-1, AD-2 |
| `crew/r24-policy` | `.worktrees/paperclip-r24-policy` | `crew/r24` | SV-1, SV-2, SV-3 |
| `crew/r24-plugin` | `.worktrees/paperclip-r24-plugin` | `crew/r24` | PL-1, PL-2, PL-3 |
| `crew/r24-agents` | `.worktrees/paperclip-r24-agents` | `crew/r24` | AG-1, AG-2 |
| `crew/r24-web` | `.worktrees/paperclip-r24-web` | `crew/r24` | WB-1, WB-2, WB-3 |

**Repo Crew** (`~/Documents/projects/crew`):

| Nhánh | Worktree | Rẽ từ | Ticket |
|---|---|---|---|
| `r24` | `.worktrees/crew-r24-int` | `r3x` @ `b827114` | tích hợp, full suite |
| `r24-runtimes` | `.worktrees/crew-r24-runtimes` | `r24` | MR-1 … MR-4 |
| `r24-app` | `.worktrees/crew-r24-app` | `r24` | MA-1 |

- Worktree mới: `corepack pnpm install` (fork cần build `plugin-sdk` trước typecheck; R3 gặp thiếu `ts-api` sau merge).
- Trợ Lý ff nhánh gói vào nhánh tích hợp sau khi đọc log test.
  - Merge (không rebase) khi nhánh tích hợp đã tiến.
  - Xung đột `core-hooks.json` giữ cả hai mục. Xung đột `docs/flows.yaml` hợp danh sách rồi `crew-docs generate`.
- Nếu `crew/r3x`/`r3x` có FX mới sau mốc trên, Trợ Lý `git merge` vào `crew/r24`/`r24` trước khi gói kế bắt đầu.
- Docs plan/ledger R2-4 ghi trên nhánh `v3` (worktree chính), như các bản R2/R3.

## 3. Thiết kế mới cần biết trước khi đọc ticket

### 3.1. Ô vai trò và agent runtime

| Ô (`CrewRoleSlot`) | Cột `crew_project_roles` | Runtime agent | Ai tạo |
|---|---|---|---|
| `executor`, `executor-2` | `executor_agent_ids[0..1]` (như R3) | `claude_local` | wizard (như R3) |
| `executor-codex` (mới) | `codex_executor_agent_id` (mới, NULL được) | `codex_local` | wizard add-agent |
| `executor-opencode` (mới) | `opencode_executor_agent_id` (mới, NULL được) | `opencode_local` | wizard add-agent |
| `reviewer` | `reviewer_agent_id` | `claude_local` | như R3 |
| `reviewer-codex` (mới) | `codex_reviewer_agent_id` (mới, NULL được) | `codex_local` | wizard add-agent |

- Ô quyết định runtime. Roles API từ chối agent có `adapterType` khác runtime của ô.
- Mỗi runtime tối đa một executor mỗi project (khuyên Q5). Claude giữ 1–2 như R3.
- "Executor của project" (luật giao việc, fallback, `render-instructions`) =
  `executor_agent_ids ∪ {codex_executor, opencode_executor}`.
- "Reviewer/integrator của company" (luật cấm giao) thêm `codex_reviewer_agent_id`.
- Cùng một agent không giữ hai ô (luật cũ "mỗi agent một vai trò" áp cho cả ô mới).

### 3.2. Luật chọn reviewer (H4, khi tạo issue con)

`chooseReviewer` là hàm thuần ở server (I1). Đầu vào:
- loại issue (`con`/`gốc`/`research`/`bmad`);
- runtime của executor: từ marker `runtime=`, không có thì `adapterType` của assignee;
- ô `reviewer-codex` có agent không, agent đó có `paused`/`terminated` không;
- công tắc `codex_local` trên máy của reviewer Codex.

Luật:
1. Chỉ **issue con code** (template `con`) được reviewer Codex. Gốc, research, bmad giữ reviewer Claude.
2. Executor runtime ≠ `codex_local` **và** có reviewer Codex dùng được **và** công tắc `codex_local` của máy reviewer
   đang ON → reviewer Codex ("review khác mô hình").
3. Còn lại → reviewer Claude (`reviewer_agent_id`).

H4 đặt participant của stage review theo kết quả. Plugin ghi dòng `select` `role=reviewer` vào `crew_runtime_decisions`
khi thấy issue mới (PL-2). Reviewer Codex dùng model cố định ở agent: `gpt-6-sol`, `modelReasoningEffort=high`. Không
override theo issue.

### 3.3. Reviewer Codex hỏng hoặc bị tắt

- H1 giữ run của reviewer Codex khi công tắc OFF, như executor.
- Plugin fallback (PL-3) xử lý run reviewer giống executor, nhưng đích luôn là reviewer Claude của project. Cách đổi
  tùy kết quả SP-K P3:
  - plugin đổi được participant stage review (đổi `executionPolicy` qua `issues.update` mà H2 cho) → đổi participant +
    assignee sang reviewer Claude, comment, wake;
  - **không đổi được (giả định an toàn mặc định)** → `fallback_refused`, comment
    `Crew: reviewer Codex không chạy được (<lý do>); owner bật lại Codex hoặc dùng "Ép Done"/sửa reviewer trên web.`
    Với `switch_off` giữ `queued`. Lý do khác thì `blocked`.
- Số vòng review giữ nguyên (cùng issue).

### 3.4. Công tắc theo máy

- Khóa `(company_id, machine_id, runtime)`.
- Máy của agent:
  1. `defaultEnvironmentId` → `environment.config.remoteWorkspacePath`;
  2. bản tin mới nhất của từng máy trong company có `report->'checkouts'` chứa path đó;
  3. không thấy và company có đúng một máy → máy đó;
  4. không xác định → **dùng mặc định** (`claude` ON, `codex`/`opencode` OFF).
- Server (H1, H4) và plugin (fallback, route) dùng **cùng** luật. Có test bảng ca chung số liệu.

## 4. Giá trị chưa đo: giả định an toàn và chỗ kiểm

| # | Giá trị | Giả định khi code | Vì sao an toàn | Kiểm ở | Sửa ở đâu nếu khác |
|---|---|---|---|---|---|
| A1 | Model Codex `gpt-6-luna`, `gpt-6-sol` chạy được với tài khoản ChatGPT | Như bảng | SP-C đo trước khi deploy | SP-C (1 `codex exec` thật) | I1 (SV-1, PL-1 catalog, AG-1 bảng): 3 bản chép + test so khớp |
| A2 | `restore` asset `home` khi thiếu `auth.json` (C2) | Không làm hỏng run, không ghi lên VPS | Wrapper không bao giờ đặt `auth.json` trong asset | SP-C (đọc code + test đơn vị fork) | Không đạt → MR-1 tạo `{}` 0600 trong asset rồi xóa lúc thoát, báo owner |
| A3 | Quota Codex đọc từ `~/.codex/sessions/**/*.jsonl` (`rate_limits.primary.used_percent`, `resets_at`) | Thiếu/không parse được → `null` (coi như dùng được) | Chỉ ảnh hưởng chọn đích fallback; run hỏng quota thật vẫn có `errorFamily` | SP-C | MR-4 parser |
| A4 | Chuỗi `ps -E -ww` của `codex exec` | Khớp argv có phần tử basename `codex` và phần tử kế `exec`, **và** env `PAPERCLIP_RUN_ID` = runId | Điều kiện env đã đủ để không bắt nhầm | SP-C chụp fixture thật | MR-3 fixture `test/fixtures/ps/codex-exec.txt` |
| A5 | Chuỗi `ps` của `opencode run` | Basename `opencode` hoặc `.opencode` (bản Homebrew có thể là shim), phần tử kế `run`, **và** env runId | Như A4 | SP-O | MR-3 fixture `opencode-run.txt` (đánh dấu "giả định" trong tên ca test) |
| A6 | Biến/đường key OpenCode Go | `OPENCODE_CONFIG_CONTENT` = `{"provider":{"opencode-go":{"options":{"apiKey":"{env:CREW_OPENCODE_GO_KEY}"}}},"permission":{"edit":"allow","bash":"allow","external_directory":"allow"}}`, key ở env `CREW_OPENCODE_GO_KEY` | Không argv, không file; sai thì run lỗi `auth` → fallback | SP-K đọc mã nguồn OpenCode 1.18.35 (thay `{env:}`, tên biến env của provider); SP-O chạy thật | MR-1 `crew-opencode-run.sh` (một hằng) |
| A7 | `permission.external_directory=allow` đủ cho `git commit` (gitdir ngoài worktree) | Có | Sai thì run lỗi commit → `other`, không fallback, executor comment | SP-O O3 | MR-1 config; không đạt → opencode chỉ nhận research, hỏi owner |
| A8 | Mẫu lỗi quota OpenCode Go | `OPENCODE_QUOTA_RE = /\b(429\|rate[ _-]?limit\|quota\|usage limit\|insufficient[ _-]?(credit\|balance\|funds)\|exceeded)\b/i` | Bắt thừa → fallback sớm (tốn Claude, không hỏng). Bắt thiếu → `other`, stock retry | SP-K (mã nguồn + log cũ `~/.local/share/opencode/log`, chỉ dòng lỗi); SP-O (lỗi thật nếu có) | PL-3 `classify.ts` (một hằng + bảng ca) |
| A9 | Mẫu lỗi auth OpenCode | `OPENCODE_AUTH_RE = /\b(401\|403\|unauthori[sz]ed\|invalid[ _-]?api[ _-]?key\|missing[ _-]?api[ _-]?key\|no api key)\b/i` + `crew-runtime blocked: thiếu key` | Như A8 | Như A8 | Như A8 |
| A10 | Cờ `vision` model OpenCode Go | Cả ba `false` | Issue có ảnh không bao giờ sang OpenCode | SP-K thử `opencode models opencode-go --verbose` (có thể không cần key); không được thì SP-O | I1 (3 bản chép) |
| A11 | Payload `agent.run.failed` có `errorFamily` (P1) | Có thể thiếu → dùng `errorCode` + `message`; thiếu cả hai → `other` | Không fallback nhầm | SP-K | PL-3 |
| A12 | Đổi assignee có hủy run `queued`/`scheduled_retry` của agent cũ (P2) | Không chắc → **luôn** có `cancelSuperseded` ở H1 (không tìm thấy gì thì no-op) | Idempotent, không phụ thuộc kết quả | SP-K (ghi lại để biết) | Không cần sửa |
| A13 | Plugin đổi participant stage review đang chạy (P3) | **Không** → reviewer Codex hỏng thì `fallback_refused` | Không động tới chính sách review | SP-K (đọc `issues.ts` update + H2; nếu cần thì test DB) | PL-3 thêm nhánh đổi participant; SV-3 cho H2 nhận đổi đó, chỉ giữa hai reviewer của cùng project |
| A14 | Thêm job `runtime-fallback` vào `manifest.jobs` làm plugin `upgrade_pending`? | Không (chỉ capability mới mới cần duyệt; RV-X m1: plugin cài đường local nạp manifest mới khi activate) | DP kiểm `plugin-state.sh` = `ready`; gặp `upgrade_pending` thì dừng báo owner | SP-K đọc `plugin-lifecycle.ts`; DP-1 | DP-1 |
| A15 | `codex login status` qua sshd agent báo đúng (C1) | Đúng; sai thì doctor `codex-auth` = warn, công tắc vẫn do board | Không chặn Claude | SP-C | MR-1 doctor |

Luật: ticket code **không chờ** các dòng trên. Gặp chỗ cần giá trị thì dùng cột "Giả định", đặt thành hằng có tên, ghi
một dòng chú thích `// Giá trị giả định, kiểm ở <SP-x>` (không ghi mã ticket vào code: ghi "kiểm khi có key OpenCode").
Trợ Lý giao FX nhỏ khi SP trả giá trị khác.

## 5. Interface (thay I1–I8 cũ; tên giữ nguyên nếu không ghi "đổi")

**I1. Catalog** (SV-1 tạo ở `server/src/crew/model-policy.ts`; PL-1 chép sang `packages/crew-plugin/src/runtimes/catalog.ts`;
WB-2 chép phần model sang `packages/crew-web/src/lib/instructions/agent-config.ts`; AG-1 chép bảng vào `assistant.md`; mỗi
bản có test so khớp nguyên văn).
- Giữ nguyên nội dung `CREW_RUNTIME_CATALOG`, `CREW_RUNTIME_ORDER`, `CrewRuntime`, `CrewComplexity`, `CrewEffort`,
  `isCrewRuntime`, `checkAgentAdapterOverrides(value, adapterType)` như plan cũ I1. Giữ export cũ
  `CREW_COMPLEXITY_MODEL`, `CREW_ALLOWED_MODELS` (cột Claude) cho crew-web.
- **Đổi:** marker, `runtime=` đặt **sau** `effort=` để regex cũ của crew-web vẫn khớp:

```ts
export const CREW_MODEL_LINE_RE =
  /^crew-model complexity=(trivial|small|medium|large) model=(\S+) effort=(low|medium|high|default)(?: runtime=(claude_local|codex_local|opencode_local))? reason=(.+)$/m;
// Marker không có runtime= là claude_local.
```

- **Mới (reviewer):**

```ts
export const CREW_REVIEWER_RUNTIMES: readonly CrewRuntime[] = ["claude_local", "codex_local"];
export const CREW_CODEX_REVIEWER_MODEL = { model: "gpt-6-sol", effort: "high" } as const;
export type CrewIssueTemplate = "child" | "root" | "research" | "bmad";
export interface ReviewerChoice { agentId: string; runtime: "claude_local" | "codex_local"; reason: string }
export function chooseReviewer(input: {
  template: CrewIssueTemplate;
  executorRuntime: CrewRuntime;
  claudeReviewerAgentId: string;
  codexReviewer: { agentId: string; status: string } | null;
  codexSwitchOn: boolean;
}): ReviewerChoice;
// reason: "executor <r>, Codex bật → reviewer codex_local" | "chỉ issue con được reviewer Codex" | "executor đã là Codex" | "không có reviewer Codex" | "reviewer Codex đang pause" | "Codex đang tắt trên máy reviewer"
```

**I2. Migration `0012_runtimes.sql`** (PL-1; namespace `plugin_crew_core_0433ea20b6`).

```sql
CREATE TABLE …crew_runtime_switches (
  company_id uuid NOT NULL, machine_id uuid NOT NULL,
  runtime text NOT NULL CHECK (runtime IN ('claude_local','codex_local','opencode_local')),
  enabled boolean NOT NULL, updated_by_user_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, machine_id, runtime));
CREATE TABLE …crew_runtime_decisions (
  -- như plan cũ I2, thêm:
  role text NOT NULL DEFAULT 'executor' CHECK (role IN ('executor','reviewer')),
  machine_id uuid,
  … );
-- giữ 3 chỉ mục cũ; chỉ mục select đổi thành (issue_id, role) WHERE kind = 'select'
CREATE TABLE …crew_runtime_waits (            -- H1 ghi, plugin job đọc (host không cho plugin đọc activity_log)
  run_id uuid PRIMARY KEY, company_id uuid NOT NULL, issue_id uuid, agent_id uuid NOT NULL,
  machine_id uuid, runtime text NOT NULL, first_seen_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz);
CREATE INDEX crew_runtime_waits_open_idx ON …crew_runtime_waits (company_id, first_seen_at) WHERE handled_at IS NULL;
ALTER TABLE …crew_project_roles
  ADD COLUMN codex_executor_agent_id uuid, ADD COLUMN opencode_executor_agent_id uuid, ADD COLUMN codex_reviewer_agent_id uuid;
ALTER TABLE …crew_machine_jobs DROP CONSTRAINT crew_machine_jobs_kind_check;
ALTER TABLE …crew_machine_jobs ADD CONSTRAINT crew_machine_jobs_kind_check CHECK (kind IN (…7 loại cũ…,'runtimes-setup'));
```

- Test migration: chạy 0001–0011 có dữ liệu rồi áp 0012. Chốt tên constraint bằng `pg_constraint`. Dòng roles cũ
  giữ nguyên, ba cột mới NULL.
- Không có trigger, không transaction.

**I3. Công tắc** (PL-1 route + data; SV-2 đọc; WB-1 gọi). **Đổi:** theo máy.

```
GET  /api/plugins/crew.core/api/runtime-switches?companyId=<uuid>                (auth board)
  → 200 { machines: Array<{ machineId; hostname; runtimes: Record<CrewRuntime, { enabled; updatedAt|null; updatedByUserId|null; locked: null | "opencode-patch-missing" }> }> }
     machines = mọi máy có bản tin trong company (bảng machine_reports), chưa có dòng → mặc định.
PUT  /api/plugins/crew.core/api/runtime-switches  body { companyId, machineId, runtime, enabled }   (auth board, companyResolution body)
  → 200 { ok: true, runtimes } | 403 "Chỉ board được bật/tắt runtime" | 400 sai dạng/máy lạ | 409 "OpenCode chưa có vá chạy đúng worktree trên server"
     ghi ctx.activity.log "crew.runtime_switch.set" { machineId, runtime, before, after, actorUserId } (kèm companyId)
```

- `locked`: route đọc env worker `CREW_OPENCODE_IN_PLACE_PATCH`. Không đọc được env trong worker thì lấy từ cấu hình
  plugin. PL-1 chọn cách và ghi lại.
- Server (`server/src/crew/runtime-switch.ts`):
  - `CREW_RUNTIME_SWITCH_DEFAULTS` như cũ.
  - `readRuntimeSwitch(db, { companyId, machineId: string | null, runtime })`: `machineId` null → mặc định.
  - `resolveAgentMachine(db, { companyId, agentId }) → string | null` theo §3.4.
  - opencode luôn false khi `CREW_OPENCODE_IN_PLACE_PATCH !== "1"`.

**I4. Thân H1** (SV-2). Như plan cũ I4, **đổi**:
- `RuntimeGateDeps.switchOn` nhận `{ companyId, machineId, runtime }`. Thêm `resolveMachine(agentId)`.
- `hasWaitingMarker`/`recordWaiting` ghi `INSERT … ON CONFLICT (run_id) DO NOTHING` vào `crew_runtime_waits`, kèm
  activity `crew.runtime_gate.waiting` cho người xem.
- `cancelSuperseded` **luôn có** (A12): hủy run `queued`/`scheduled_retry` của agent ≠ assignee hiện tại khi quyết
  định `fallback` mới nhất của issue có `from_agent_id = run.agentId`.
- Áp cho agent ô executor và ô reviewer-codex.

**I5. Fallback plugin** (PL-3). Như plan cũ I5, **đổi/thêm**:
- Ứng viên lấy từ ba cột mới + `executor_agent_ids`, lọc cùng `machine_id` (§3.4) thay vì cùng `defaultEnvironmentId`.
- `role` của run hỏng:
  - assignee là reviewer Codex của project → `reviewer`, xử lý theo §3.3;
  - executor → như cũ.
- Job `runtime-fallback` mỗi phút:
  - duyệt company trong `crew_companies`;
  - đọc `crew_runtime_waits` chưa `handled_at`, quá 60 giây, run vẫn `queued` (đọc qua `ctx.issues`/run của issue,
    kèm `companyId`);
  - xử lý `switch_off`, rồi đặt `handled_at`.
- `OPENCODE_QUOTA_RE`, `OPENCODE_AUTH_RE` theo A8/A9.
- Mọi lời gọi host kèm `companyId`.

**I6. Wrapper Mac** (MR-1). Như plan cũ I6. Reviewer Codex dùng **cùng** `crew-codex-run`. `CODEX_HOME` theo agentId
nên reviewer và executor không chung session.

**I7. Vá adapter** (AD-1, AD-2): như plan cũ I7, nguyên văn. `check-core-hooks.mjs` sau R2-4 báo: hook 5/5, core-patch
6, adapter-patch P2–P7.

**I8. Bản tin `runtimes`** (MR-4 gửi; PL-2 kiểm và lưu; PL-3, WB-1 đọc): `RuntimesReport` như plan cũ I8. Cỡ body vẫn
≤ `MACHINE_REPORT_MAX_BYTES` (64 KiB). MR-4 kiểm cỡ khi `models` đầy 60 phần tử.

**I9. Việc máy `runtimes-setup` (mới)** (PL-1 kiểu + validate; MA-1 chạy; WB-1 nút).
- `JobPayload`: `{ kind: "runtimes-setup" }`, không có trường khác.
- App: `ops.call('setup', {})` (cài/cập nhật `crew-codex-run`, `crew-opencode-run`, `crew-run-mark.sh`), rồi
  `crew-mac runtimes status --json`.
- `JobResult`:

  ```ts
  { kind: "runtimes-setup";
    wrappers: { codex: boolean; opencode: boolean };
    codex: { version: string | null; loggedIn: boolean | null };
    opencode: { version: string | null; keyPresent: boolean | null } }
  ```

- Không chứa key, token, path `auth.json`. Lỗi → `failed` `app_error` qua `sanitizeJobError`.
- Owner nạp key: chạy `crew-mac runtimes key opencode` trong Terminal của Mac (gõ key vào stdin). Thẻ máy hiện câu
  hướng dẫn này khi `keyPresent === false`. Không có nút nhập key trên web.

**I10. UI crew-web** (WB-1 … WB-3).
- **Trang Máy** (`features/machines`): mỗi thẻ máy thêm khối "Runtime" gồm:
  - ba dòng `claude_local`/`codex_local`/`opencode_local`;
  - mỗi dòng: phiên bản, đăng nhập/key có hay không, quota ước tính (Codex `primaryUsedPct`%, OpenCode $ ngày/tuần/tháng
    so với 12/30/60), nút gạt (`ToggleSwitch` của DS);
  - dòng khóa thì tắt nút, kèm lý do;
  - nút "Cài runtime trên máy" xếp việc `runtimes-setup`;
  - gạt có hộp xác nhận khi **bật** Codex/OpenCode ("Run mới của runtime này sẽ dùng quota …").
- **Wizard add-agent**: ô mới `executor-codex`, `executor-opencode`, `reviewer-codex`. Tạo agent với `adapterType` và
  `adapterConfig` theo I6/spec §4.1.
- **Trang agent**: chọn model theo runtime của agent (catalog I1).
- **Trang issue** (`properties-panel`): parse marker mới, hiện runtime. Khối "Runtime" liệt kê `crew.runtimeDecisions`
  (chọn/chuyển/từ chối, lý do, giờ `Asia/Ho_Chi_Minh`).

**I11. Ô vai trò mới** — `CrewRoleSlot` thêm `executor-codex | executor-opencode | reviewer-codex` ở **bốn nơi**,
mỗi nơi một ticket:

| Nơi | Ticket |
|---|---|
| plugin `jobs/types.ts` | PL-1 |
| mac-app `main/jobs/types.ts` + `validate.ts` | MA-1 |
| crew-web `api/crew/types.ts`, `lib/instructions/agent-config.ts` (`roleOfSlot`) | WB-2 |
| server (không có kiểu ô; chỉ đọc cột) | SV-3 |

Checkout: `~/crew-agents/<khóa>/<ô>`. Nhánh theo mẫu wizard hiện có (`crew/<khóa>/<ô>`).

## 6. Ticket

Cột "Khi nào":
- **ngay**: code/đo được bây giờ;
- **chờ key**: cần key OpenCode Go;
- **chờ deploy**: cần bản đã lên prod.

| ID | Việc | Gói | File ghi (chính) | Phụ thuộc | Model | Khi nào |
|---|---|---|---|---|---|---|
| SP-C | Đo Codex: C1, C2, C3, A1, A4, A15; đúng 1 `codex exec` | `probe` | `reports/sp-c-codex.md`, `processes.md` (dòng của mình) | — | opus | ngay |
| SP-K | Đọc mã/không tốn run: P1, P2, P3, A6, A8–A10, A14 | `probe` | `reports/sp-k-code.md` | — | opus | ngay |
| AD-1 | P5 codex `sessionCodec` | `adapters` | fork `codex-local/src/server/{index.ts,session-codec.crew.test.ts}`, mục P5 `core-hooks.json`, `verify.sh` | — | sonnet | ngay |
| AD-2 | P6 + P7 opencode `in_place` + `sessionCodec` | `adapters` | fork `opencode-local/src/server/{execute.ts,index.ts,execute.in-place.crew.test.ts,session-codec.crew.test.ts}`, mục P6/P7, `verify.sh` | AD-1 | opus | ngay |
| SV-1 | Catalog I1, override theo runtime assignee (H2/H4), `chooseReviewer` thuần | `policy` | fork `server/src/crew/model-policy.ts`, `issue-gate.ts`, `issue-create-policy.ts` (chỉ chỗ gọi override), test `crew-model-policy`, `crew-issue-gate`, `crew-issue-create-policy` | — | opus | ngay |
| SV-2 | H1: `runtime-switch.ts`, `runtime-gate.ts`, `runtime-fallback.ts`, mở `retry-progress.ts`, `load-gate.ts` (`crewBeforeClaim`), `cancelSuperseded`, ghi `crew_runtime_waits` | `policy` | fork `server/src/crew/{runtime-switch,runtime-gate,runtime-fallback,retry-progress,load-gate}.ts` + test `crew-runtime-gate`, `crew-runtime-switch.db`, `crew-runtime-fallback-reconcile`, `crew-retry-progress`, `crew-before-claim`; `description` H1 | SV-1; bảng I2 (tạo bảng trong test theo DDL I2) | opus | ngay |
| SV-3 | Reviewer Codex ở H4/H2: đọc 3 cột mới (`project-roles.ts`), executor set + role set mới, H4 gọi `chooseReviewer` cho issue con, H2 nhận participant reviewer Codex; nhánh đổi participant chỉ khi SP-K P3 = được | `policy` | fork `server/src/crew/{project-roles,issue-create-policy,issue-gate,issue-policy}.ts` + test `crew-project-roles(.db)`, `crew-issue-create-policy`, `crew-issue-gate(.db)`, `crew-agent-assignment.db`; `description` H2/H4 | SV-2, SP-K (P3) | opus | ngay (nhánh P3 theo kết quả) |
| PL-1 | Migration 0012; roles API/data nhận 3 ô mới + kiểm `adapterType`; route + data công tắc (I3); catalog chép (I1); kiểu + validate việc `runtimes-setup` (I9); `CrewRoleSlot` mới | `plugin` | fork `packages/crew-plugin/migrations/0012_runtimes.sql`, `src/runtimes/{catalog,switches,machine}.ts`, `src/roles/{api,data}.ts`, `src/jobs/{types,validate}.ts`, `src/manifest.ts` (route), `src/worker.ts` (nhánh), test `runtimes-catalog`, `runtime-switches.db`, `roles.db`, `machine-jobs-validate`, `migration-0012.db` | — | opus | ngay |
| PL-2 | `MachineReport.runtimes` (webhook kiểm, bỏ riêng khi sai); data `crew.runtimeDecisions`; ghi `select` (executor theo marker, reviewer theo participant) ở `issue.created` | `plugin` | fork `src/machines/{webhook,data}.ts`, `src/runtimes/decisions.ts`, `src/worker.ts` (1 dòng), test `machines`, `webhook`, `runtime-decisions.db` | PL-1 | sonnet | ngay |
| PL-3 | Fallback: `classify`, `choose`, `fallback` (executor + reviewer §3.3); handler `agent.run.failed`; job `runtime-fallback` đọc `crew_runtime_waits` | `plugin` | fork `src/runtimes/{classify,choose,fallback}.ts`, `src/manifest.ts` (`jobs`), `src/worker.ts`, test `runtime-fallback`, `runtime-fallback.db` | PL-2, SP-K (P1, P3) | opus | ngay (regex theo A8/A9) |
| AG-1 | `assistant.md` (bảng I1, luật chọn, marker mới, executor theo runtime); `executor.md` (mục runtime ngoài Claude: đọc `$CREW_SUPERPOWERS_DIR/skills/<tên>/SKILL.md`, comment fallback); `reviewer.md` (mục "Chạy bằng Codex": cùng luật, đọc SKILL.md ghim, không dùng công cụ riêng Claude); test `instructions.test.mjs` | `agents` | fork `crew/agents/{assistant,executor,reviewer}.md`, `crew/agents/instructions.test.mjs` | — (I1 đã chốt ở đây) | opus | ngay |
| AG-2 | `merge-agent-config.mjs` nhận wrapper `crew-codex-run`/`crew-opencode-run` theo `adapterType`; `render-instructions.mjs` liệt kê executor kèm runtime + reviewer Codex; `apply-roles.sh` biết 3 cột mới | `agents` | fork `crew/agents/{merge-agent-config,render-instructions}.mjs`, `apply-roles.sh` + `*.test.mjs` | AG-1 | sonnet | ngay |
| MR-1 | `crew-run-mark.sh`, `crew-codex-run.sh`, `crew-opencode-run.sh`; `src/runtimes/{keychain,paths,command}.ts`; `crew-mac runtimes key opencode \| status [--json] \| skills-checksum \| key-fingerprint opencode`; `setup` cài wrapper; doctor `codex-auth`, `opencode-key`, `wrapper-codex`, `wrapper-opencode` (mức **warn**, không làm `check` thất bại); flow `mac-runtimes` | `mac-runtimes` | repo Crew `apps/crew-mac/{assets,src/runtimes,src/commands/{setup,doctor}.ts,src/cli.ts,src/wrapper.ts,src/index.ts}`, test, `docs/flows/{mac-runtimes,mac-setup}.md`, khối `mac-runtimes` `docs/flows.yaml`, `docs/files.md` | — (A2, A6 theo giả định) | opus | ngay |
| MR-2 | `workflow-check --runtime`; `registry.ts` thêm `codex_local`, `opencode_local` cho `superpowers` | `mac-runtimes` | `src/workflows/{registry,runtime-sources}.ts`, `src/commands/workflow-check.ts`, `src/cli.ts`, test, `docs/flows/{mac-runtimes,mac-workflows}.md` | MR-1 | opus | ngay |
| MR-3 | Bộ dọn `isAgentPrint` (claude/codex/opencode) | `mac-runtimes` | `src/reaper/{run-members,select}.ts`, fixture `test/fixtures/ps/{codex-exec,opencode-run}.txt`, test, `docs/flows/mac-orphan-reaper.md` | MR-2, SP-C (A4) | sonnet | ngay (opencode theo A5) |
| MR-4 | Bản tin `runtimes` (I8) | `mac-runtimes` | `src/status/{runtimes,report}.ts`, test, `docs/flows/{mac-runtimes,mac-setup}.md` | MR-3, SP-C (A3) | sonnet | ngay |
| MA-1 | App Mac: ô mới (I11), chạy việc `runtimes-setup` (I9), mục doctor runtime không làm `check` thất bại | `mac-app` | repo Crew `apps/mac-app/src/main/jobs/{types,validate,executors}.ts`, `src/main/ops-bridge` (nếu cần lệnh `runtimes status`), test `test/jobs/*`, `docs/flows/mac-app-paperclip.md` | MR-1 (hợp đồng `runtimes status --json` ở I9) | sonnet | ngay |
| WB-1 | Trang Máy: khối Runtime, nút gạt, xác nhận, nút "Cài runtime trên máy" (I10); `api/crew/runtimes.ts`; i18n vi/en | `web` | fork `packages/crew-web/src/{api/crew/{runtimes,types}.ts,api/queryKeys.ts,ds/widgets/crew/machine-card.tsx,features/machines/**}` + test | PL-1 (hợp đồng I3/I9, test dùng API giả) | sonnet | ngay |
| WB-2 | Ô mới trong wizard add-agent/remove/roles tab/readiness; cấu hình agent codex/opencode (I6, spec §4.1); chọn model theo runtime; catalog chép | `web` | fork `packages/crew-web/src/{lib/instructions/agent-config.ts,features/wizards/**,features/projects/detail/roles-tab.tsx,features/readiness/**,features/agents/detail/model-select.tsx}` + test + e2e spec mới | WB-1, PL-1, AG-2 (dạng adapterConfig) | opus | ngay |
| WB-3 | Trang issue: marker mới, khối "Runtime" (`crew.runtimeDecisions`); Hướng dẫn vi/en: marker `runtime=`, công tắc, reviewer Codex | `web` | fork `features/issues/detail/{properties-panel.tsx,crew/runtime-slot.tsx}`, `features/guide/content/*`, `features/issues/locales/*` + test | WB-2, PL-2 | sonnet | ngay |
| RV-1 | Review cả hai nhánh tích hợp; full suite: fork `verify.sh` + crew-web (`typecheck`, `vitest`, `build`, `biome`); repo Crew `pnpm -r test`, `pnpm -r typecheck`, `pnpm lint` | — | `reports/rv-1-review.md` | mọi ticket code | opus | ngay |
| DP-1 | Deploy fork (P5–P7 đã duyệt, 0012, env `CREW_OPENCODE_IN_PLACE_PATCH=1`); cài `crew-mac` + app Mac bản mới; việc `runtimes-setup`; wizard tạo `executor-codex`, `reviewer-codex` (và `executor-opencode`, để công tắc OFF) cho `repo-a`; T1 E2E trước prod | `ops` | ledger, `processes.md`, `reports/dp-1-report.md` | RV-1 + FX | opus | chờ code xong |
| AC-C | Nghiệm thu phần Codex: AC3, AC4, AC5, AC6, AC7, AC9, AC10, **AC11** (mục 8) | — | `reports/ac-c-report.md` | DP-1, SP-C đạt | opus | chờ deploy |
| SP-O | Đo OpenCode: O1/A10 (nếu SP-K chưa có), O2 (A6), O3 (A7), A5 (`ps`), lỗi thật nếu gặp; đúng 1 `opencode run` | `probe` | `reports/sp-o-opencode.md` | owner nạp key | opus | chờ key |
| FX-O | Sửa hằng theo SP-O (A5–A10): MR-1 config, MR-3 fixture, PL-3 regex, I1 `vision` (3 bản chép) | theo file | theo file | SP-O | sonnet | chờ key |
| AC-O | AC1, AC2, AC8 (OpenCode) + bật thử công tắc OpenCode | — | `reports/ac-o-report.md` | FX-O deploy (DP-2 nhỏ, hoặc gộp DP-1 nếu key có trước) | opus | chờ key |

Đối chiếu ID cũ:

| ID cũ | ID mới |
|---|---|
| SP-0 | SP-C + SP-K + SP-O |
| PL-1 | PL-1 + PL-2 |
| PL-2 | PL-3 |
| `crew/ops/create-runtime-executor.sh` | **Bỏ.** Wizard web (WB-2) thay, đúng luật "chỉ board tạo agent" |
| AC-R2-4 | AC-C + AC-O |

## 7. Chi tiết giao việc (đọc cùng mục 1, 3, 4, 5)

Mọi ticket:
- Ghi dòng "bắt đầu" (giờ `date`) vào `sdd-ledger.md` qua Trợ Lý.
- Test đỏ trước rồi mới cài. Commit Conventional Commits tiếng Việt, không mã ticket/plan trong code, test, commit.
- Không push.
- Worker phát triển chỉ là agent Claude (không Codex/OpenCode/fable làm worker).
- Agent không đọc/in key, token. Không mở `~/.codex/auth.json`, `~/.local/share/opencode/auth.json` bằng công cụ đọc
  nội dung (chỉ `test -e`/`stat`).
- Kết bằng khối `Status/Summary/Concerns`.

### SP-C — Đo Codex (ngay, opus)

- Ở `~/crew-r24-probe/` (tạo mới). Không đặt dưới `/Volumes`, `~/Desktop`, `~/Documents`.
- **C1:** `ssh` vào Mac qua sshd của Crew (như run thật), chạy `codex login status`. Ghi mã thoát và câu trạng thái, không
  in token. Ghi phiên bản `codex --version`.
- **C2:** đọc `packages/adapter-utils/src/remote-managed-runtime.ts` (`restore`, khoảng l.238–256) và
  `codex-local/src/server/codex-auth-copyback.ts`. Viết test đơn vị **tạm** trong scratchpad (không commit) hoặc chạy test
  sẵn có: asset `home` không có `auth.json` thì `restore` không ném, không ghi gì.
- **A1 + A4 + C3:** đúng **1** lệnh trong HOME/`CODEX_HOME` tạm có symlink `auth.json` →
  `~/.codex/auth.json`, đúng dạng wrapper sẽ làm:

  `PAPERCLIP_RUN_ID=<uuid thử> codex exec -m gpt-6-luna -c model_reasoning_effort=low "Trả lời đúng một chữ: ok"`

  - Trong lúc chạy chụp `ps -E -ww -o pid,ppid,pgid,command` các process con. Chỉ giữ argv và **tên** biến env; xóa giá
    trị env trước khi ghi fixture.
  - Sau run đọc `CODEX_HOME/sessions/**/*.jsonl` tìm `rate_limits` (ghi tên trường, ví dụ giá trị phần trăm, không chép
    token).
  - Nếu lỗi (400 như 08/10): ghi nguyên văn lỗi đã lọc token, **không** thử lần 2. Thử `-m gpt-6-sol` chỉ khi owner cho
    (ghi Concern).
- **A15:** `codex login status` qua sshd khớp phiên desktop?
- **Đầu ra:**
  - `reports/sp-c-codex.md`: bảng A1, A2, A3, A4, A15 = đạt/không + bằng chứng;
  - fixture `ps` đề xuất (văn bản cho MR-3 chép);
  - dọn `~/crew-r24-probe` bằng `trash` (không `rm -rf`), ghi `processes.md`.

### SP-K — Đọc mã (ngay, opus, không tốn run)

- Fork `crew/r3x`, chỉ đọc. Test DB chỉ khi bắt buộc cho P3, và không chạy cùng lúc test DB của PL/SV (kiểm `ipcs -m`).
- **P1:** payload `agent.run.failed` (`server/src/services/heartbeat.ts` chỗ phát sự kiện, SDK `types.ts`): có `errorCode`,
  `errorFamily`, `issueId`, `message`? Plugin lấy thêm qua đường nào nếu thiếu (có kèm `companyId`)?
- **P2:** `issueService.update` đổi `assigneeAgentId` có hủy run `queued`/`scheduled_retry` của agent cũ không.
- **P3:** plugin `ctx.issues.update` có đổi được `executionPolicy` (participant stage review đang hoạt động) không? H2
  (`issue-gate.ts`) và stock có chặn không? Nếu được thì cách làm tối thiểu, và rủi ro (stage đang `in_review` có reset
  không).
- **A6:** mã nguồn OpenCode **1.18.35** (GitHub `sst/opencode` tag tương ứng, chỉ đọc). Tìm:
  - `OPENCODE_CONFIG_CONTENT` có được gộp không, `{env:VAR}` có được thay không;
  - provider `opencode-go` đọc key từ biến env nào.
- **A8/A9:** câu lỗi quota/auth trong mã nguồn OpenCode và trong log cũ `~/.local/share/opencode/log` (chỉ `grep -i`
  dòng `error`/`429`/`quota`/`401`, không chép dòng có key).
- **A10:** thử `opencode models opencode-go --verbose` (không có key cũng có thể chạy; không chạy `opencode run`). Ghi cờ
  ảnh/tool của 3 model I1.
- **A14:** `server/src/services/plugin-lifecycle.ts`, `plugin-loader.ts`: đổi `manifest.jobs` có làm `upgrade_pending`
  không.
- **Đầu ra:** `reports/sp-k-code.md`, bảng P1, P2, P3, A6, A8–A10, A14 + file:dòng. Đề xuất giá trị thay giả định.

### AD-1, AD-2 — Vá adapter (ngay)

- Nguyên như plan cũ `fork.md` (AD-1, AD-2) và I7. Đổi:
  - nhánh `crew/r24-adapters`;
  - `verify.sh`, `core-hooks.json` của `crew/r3x` (đã có C1–C6; thêm mục P5–P7 **sau** P4, trước C1, hoặc cuối
    mảng — giữ thứ tự `check-core-hooks.mjs` chấp nhận).
- `check-core-hooks.mjs` + test xanh: báo 5 hook, 6 core-patch, adapter P2–P7.
- AD-2 test ghi mọi lệnh shell gửi target giả. Khẳng định:
  - không có `rm -rf`/`cp -a` nhắm `$HOME/.claude/skills`;
  - cwd = `authoritativeRoot`;
  - không upload/restore workspace khi `in_place`.

### SV-1 — Catalog, override, `chooseReviewer` (ngay, opus)

- I1 nguyên văn (bảng plan cũ + mục mới), test so khớp bảng.
- `checkAgentAdapterOverrides(value, adapterType)`. H2/H4 đọc `adapterType` của assignee (cùng truy vấn đang đọc agent).
  Agent ngoài ba runtime giữ luật Claude.
- `chooseReviewer` là hàm thuần, bảng ca đủ 6 lý do. Chưa nối vào H4 (SV-3 nối).
- Giữ `CREW_COMPLEXITY_MODEL`, `CREW_ALLOWED_MODELS` (crew-web import ý nghĩa này).

### SV-2 — Thân H1 (ngay, opus)

- Như plan cũ SV-2 + I4 bản này.
- Bảng plugin trong test tạo bằng DDL I2 (chép đúng). Thiếu bảng (`to_regclass` null) → mặc định, warn tối đa 1 lần/phút
  mỗi company.
- `resolveAgentMachine` §3.4: test bảng ca với bản tin có `checkouts`, một máy, hai máy không khớp.
- Ghi `crew_runtime_waits` bằng `INSERT … ON CONFLICT DO NOTHING`. Server được ghi bảng này. Đây là bảng duy nhất server
  ghi trong namespace plugin. Ghi chú vào `description` H1.

### SV-3 — Reviewer Codex ở H2/H4 (ngay, opus)

- `project-roles.ts`:
  - `loadCrewRoles`/`loadProjectAgentRoles`/`loadCompanyRoleAgentIds` đọc 3 cột mới khi có (cột chưa có → như cũ;
    kiểm bằng `information_schema` hoặc bắt lỗi cột);
  - `executorAgentIds` gồm executor runtime;
  - role set gồm reviewer Codex.
- `issue-policy.ts`: hàm dựng stage nhận `reviewerAgentId` truyền vào cho template `con`.
- `issue-create-policy.ts`: H4 gọi `chooseReviewer` với `readRuntimeSwitch` (SV-2) cho máy của reviewer Codex.
- `issue-gate.ts`: participant reviewer Codex được coi như reviewer (luật mở lại issue giao executor, luật cấm giao).
- Nhánh "plugin đổi participant giữa hai reviewer cùng project" chỉ khi SP-K P3 = được. Không thì không làm, ghi Concern.
- Test DB: `crew-agent-assignment.db`, `crew-issue-gate.db` thêm ca reviewer Codex.

### PL-1 — Migration, roles, công tắc, việc máy (ngay, opus)

- `0012_runtimes.sql` theo I2. Test `migration-0012.db.test.ts`: áp 0001–0011 có dữ liệu, rồi 0012. Chốt tên constraint
  `crew_machine_jobs_kind_check`.
- `roles/api.ts`:
  - `BODY_KEYS` thêm `codexExecutorAgentId`, `opencodeExecutorAgentId`, `codexReviewerAgentId` (tùy chọn, `null`
    xóa);
  - kiểm `adapterType` khớp ô qua `ctx.agents.get(id, companyId)`;
  - luật không trùng, `crossProjectConflict` tính cả ba;
  - audit log như cũ.
- Route công tắc I3 (manifest `api.routes` mới, **không** capability mới). Data `crew.runtimeSwitches` cho UI nếu cần.
- `runtimes/machine.ts`: `resolveAgentMachine` cùng luật §3.4 (test cùng bảng ca SV-2).
- `jobs/types.ts`, `validate.ts`: `runtimes-setup` (I9) và 3 ô mới (I11).
- Test `roles.db` (ô mới, sai `adapterType` → 400), `runtime-switches.db` (403 agent, mặc định, PUT/GET, khóa opencode),
  `machine-jobs-validate`.

### PL-2 — Bản tin runtimes, quyết định (ngay, sonnet)

- `webhook.ts`: `runtimes` tùy chọn kiểm như `app` (sai dạng thì bỏ riêng trường). Lưu trong `report` jsonb.
- `runtimes/decisions.ts`:
  - `recordSelect` khi `issue.created`. Executor theo `CREW_MODEL_LINE_RE`. Reviewer theo participant stage review +
    `adapterType`;
  - `INSERT … ON CONFLICT DO NOTHING` theo chỉ mục `(issue_id, role)`.
- Data `crew.runtimeDecisions` `{ companyId, issueId }` → danh sách dòng, mới nhất trước, ≤ 50.

### PL-3 — Fallback (ngay, opus)

- Như plan cũ PL-2 + I5 bản này + §3.3.
- Bảng ca `chooseFallback` thêm:
  - ứng viên khác máy bị loại;
  - reviewer Codex → reviewer Claude (khi P3 được) hoặc `refused`.
- `classifyRuntimeFailure` theo A8/A9/A11.
- Test DB: idempotent theo `run_id`, `requestWakeup` đúng một lần, `large` → `refused`, trần 2, job đọc
  `crew_runtime_waits` rồi đặt `handled_at`.

### AG-1, AG-2 — Instructions (ngay)

- AG-1:
  - bảng trong `assistant.md` chép nguyên I1;
  - marker mẫu theo regex mới (thứ tự `complexity model effort runtime reason`);
  - luật: issue chạm bảo mật/phân quyền, migration, hợp đồng công khai là `large`; có ảnh chỉ model `vision`; chọn
    runtime đầu tiên theo thứ tự mà project có executor;
  - Trợ Lý **không** chọn reviewer (server chọn).
- `reviewer.md` mục "Khi chạy bằng Codex":
  - mỗi lệnh shell là shell mới, dùng nguyên mẫu `curl` đang có;
  - skill Superpowers đọc ở `$CREW_SUPERPOWERS_DIR/skills/<tên>/SKILL.md`;
  - cùng luật duyệt `crew-commit`, cùng "PATCH là lệnh ghi cuối".
- `executor.md`: mục tương tự cho Codex/OpenCode, kèm cách đọc comment `Crew: chuyển runtime sau run …`.
- AG-2:
  - `merge-agent-config.mjs`: `WRAPPER_RE` theo `adapterType`:
    - `claude_local` → `crew-claude-run` + `--plugin-dir`;
    - `codex_local` → `crew-codex-run`, không `extraArgs`, có `dangerouslyBypassApprovalsAndSandbox: true`;
    - `opencode_local` → `crew-opencode-run`, model `opencode-go/<id>`, không `managedAiConnection`;
  - `render-instructions.mjs`: danh sách executor kèm runtime; dòng reviewer Codex.

### MR-1 … MR-4 — Mac (ngay)

- Như plan cũ `mac-runtimes.md` (MR-1 … MR-4) và I6, I8. Đổi:
  - nhánh `r24-runtimes` từ `r3x`;
  - doctor runtime ở mức **warn** (check job của app chỉ fail theo mục bắt buộc của Claude);
  - `runtimes status --json` đúng hợp đồng I9 cho MA-1;
  - thêm lệnh `skills-checksum`, `key-fingerprint opencode` (AC2, AC8).
- Test Keychain giả qua `CREW_SECURITY_BIN`, HOME tạm. Mốc key không xuất hiện trong stdout, stderr, argv, file.
- MR-3 dùng fixture Codex thật từ SP-C. Nếu SP-C chưa xong khi MR-3 bắt đầu thì làm opencode trước, Codex sau.
- Docs:
  - flow mới `mac-runtimes` trong `docs/flows.yaml` (khối riêng; không sửa `source`/`shared`/`unassigned`);
  - `crew-docs generate` (bundle `packages/docs-kit/dist/crew-docs.cjs`), rồi `crew-docs check --staged`.

### MA-1 — App Mac (ngay, sonnet)

- `CrewRoleSlot` + `validate.ts` nhận 3 ô mới. Checkout `~/crew-agents/<khóa>/<ô>`.
- Executor `runtimes-setup`:
  1. `ops.call('setup', {})`;
  2. `crew-mac runtimes status --json`;
  3. dựng `JobResult` I9 (chỉ trường cho phép, lọc qua `sanitize`).
- `checkJob`: mục doctor `codex-auth`, `opencode-key`, `wrapper-codex`, `wrapper-opencode` không vào danh sách lỗi chặn.
- Docs `docs/flows/mac-app-paperclip.md`.
- Cách cài app lên Mac ở DP theo đúng cách R3X đã làm (đọc ledger R3X DP trên nhánh `r3x`). Không phát hành bản ký
  (chờ chứng chỉ của owner).

### WB-1 … WB-3 — crew-web (ngay)

- Theo DS hiện có (`@/ds`: `ToggleSwitch`, `ConfirmDialog`, `Badge`, `Card`). Chuỗi vi + en. Giờ `Asia/Ho_Chi_Minh`.
- Gọi API kèm `companyId` (FX-SCOPE).
- Test vitest cho logic (hiển thị quota, khóa, xác nhận bật). Một spec Playwright mới `s12-runtime-switch.spec.ts`,
  chạy ở RV-1/T1, không chạy prod.
- WB-2 tạo agent bằng đúng `adapterConfig` của AG-2 (chép hằng, test so khớp như `CREW_WRAPPER_SUFFIX`).

### RV-1, DP-1 (opus)

- RV-1: đối chiếu Review Focus 1–5 của plan cũ, thêm:
  - (6) reviewer Codex chỉ cho issue con, không lọt sang gốc/research/bmad;
  - (7) ô mới không làm vỡ wizard/gỡ R3X;
  - (8) không capability mới;
  - (9) mọi lời gọi host của plugin kèm `companyId`.
- DP-1: quy trình `crew/ops/*` như cũ (active-runs rỗng → backup → overlay/deploy → mốc rollback → health + plugin
  `ready` → hai site 200).
  - Chạy **T1 E2E** (stack T1 như R3) trước prod.
  - Sau deploy:
    1. xếp `runtimes-setup` cho Mac mini, đọc kết quả;
    2. wizard tạo `executor-codex`, `reviewer-codex` cho `repo-a`;
    3. tạo `executor-opencode` nhưng **để công tắc OFF**;
    4. công tắc mặc định OFF (owner bật ở AC).
  - Tag cục bộ `crew/v3.3-rc1` (xem câu hỏi owner). Không push.

## 8. Nghiệm thu

Giữ AC1–AC10 của spec §8 / plan cũ, chia hai đợt.

**AC-C (Codex, sau DP-1).** AC3, AC4, AC5, AC6, AC7, AC9, AC10, thêm **AC11 — reviewer Codex**:
- Owner bật `codex_local` trên Mac mini ở trang Máy.
- Owner tạo yêu cầu nhỏ trong `repo-a`. Trợ Lý tách issue con chạy executor **Claude** (`trivial`).
- Issue con có participant review = reviewer Codex. `crew_runtime_decisions` có `select role=reviewer runtime=codex_local`.
- Reviewer Codex chạy 1 run: đọc `crew-commit`, duyệt hoặc yêu cầu sửa bằng API.
- Không có `auth.json` trên VPS. Log container không có `access_token`/`refresh_token`.
- Thêm một ca: owner tắt Codex trước khi tạo issue con thứ hai → reviewer là Claude (`reason` "Codex đang tắt trên máy
  reviewer").
- Quota AC-C: Codex **2** run (AC3, AC11). Claude: Trợ Lý 2, reviewer 1–2, executor 2 (AC5, AC11).

**AC-O (OpenCode, sau khi có key + SP-O + FX-O):** AC1, AC2, AC8. OpenCode **1** run AC + **1** run SP-O. Trước mỗi
run ghi `opencode stats --days 1 --models`.

AC9 cập nhật: `check-core-hooks.mjs` báo H1–H5, C1–C6, P1–P7. Diff `crew/r3x..crew/r24` chỉ trong phạm vi mục 9.

## 9. Phạm vi ghi (thay Global Constraints "Fork chỉ sửa / Repo Crew chỉ sửa")

- **Fork:**
  - `server/src/crew/**`, `server/src/__tests__/crew-*`;
  - `packages/crew-plugin/**`, `packages/crew-web/**`;
  - `crew/agents/**`;
  - `crew/release/{core-hooks.json,verify.sh}`;
  - đúng 3 file nguồn adapter P5–P7 + test `*.crew.test.ts`.

  Không sửa lõi khác. Không đổi C1–C6. Không thêm hook. Không thêm capability plugin.
- **Repo Crew:**
  - `apps/crew-mac/**` (trừ `src/files/**`, `assets/crew-claude-run.sh`);
  - `apps/mac-app/src/main/jobs/**` (+ test, + chỗ gọi `crew-mac` nếu cần);
  - `docs/flows/{mac-runtimes,mac-setup,mac-workflows,mac-orphan-reaper,mac-app-paperclip}.md`;
  - khối `mac-runtimes` trong `docs/flows.yaml`, `docs/files.md`, `pnpm-lock.yaml` nếu cần.

  Không sửa `.claude/**`, `.githooks/**`, `AGENTS.md`, `CLAUDE.md`, mục `source`/`shared`/`unassigned` (R6).

## 10. Đợt chạy (song song theo sở hữu file)

Luật:
- Hai ticket chạy cùng lúc chỉ khi file ghi rời nhau (bảng mục 6).
- **Test DB** (Postgres nhúng) của `policy` và `plugin` không chạy cùng lúc: Trợ Lý xếp lượt, kiểm `ipcs -m` trước/sau.
- `verify.sh` và run thật trên Mac mini mỗi lúc một việc.

| Đợt | Song song | Ghi chú |
|---|---|---|
| **1 (ngay)** | SP-C ∥ SP-K ∥ AD-1→AD-2 ∥ SV-1 ∥ PL-1 ∥ MR-1 ∥ AG-1 | 7 luồng, file rời nhau. Chỉ SP-C dùng Codex thật (1 run). Test DB: PL-1 và SV-1 (SV-1 thường không cần DB) xếp lượt. AD không cần DB |
| **2** | SV-2→SV-3 ∥ PL-2→PL-3 ∥ MR-2→MR-3→MR-4 ∥ AG-2 ∥ MA-1 ∥ WB-1 | Bắt đầu từng luồng khi ticket trước trong gói xong. SV-3, PL-3 đọc SP-K. MR-3, MR-4 đọc SP-C. WB-1 code theo hợp đồng I3/I9 (API giả), nối thật ở T1 |
| **3** | WB-2→WB-3 | Cần PL-1, PL-2, AG-2 đã ff vào `crew/r24` |
| **4** | RV-1, rồi FX-n | FX theo gói của file, model như ticket gốc |
| **5** | DP-1 | 0 run active, T1 trước prod |
| **6** | AC-C | Hẹn owner ~10 phút (bật/tắt Codex trên trang Máy) |
| **Chờ key** | SP-O → FX-O → (DP-2 nhỏ nếu có code đổi) → AC-O | Owner nạp key bằng `crew-mac runtimes key opencode` (có sau MR-1 + DP-1) hoặc `security add-generic-password -U -s crew.opencode-go -a crew -w` |

Điểm nối chung:

| File | Ai ghi | Cách |
|---|---|---|
| `core-hooks.json` | AD (mục P5–P7), SV-2/SV-3 (`description` H1/H2/H4) | Tuần tự theo thứ tự ff: AD-2 ff trước SV-2 |
| `packages/crew-plugin/src/{manifest,worker}.ts` | PL-1, PL-2, PL-3 | Cùng gói, tuần tự |
| `apps/crew-mac/src/cli.ts` | MR-1, MR-2 | Cùng gói, tuần tự |
| `docs/flows.yaml`, `docs/files.md` | MR-* (khối `mac-runtimes`), MA-1 (khối `mac-app-paperclip`) | Hợp danh sách khi merge rồi `crew-docs generate` |
