---
title: "Crew v3 R1-2 — Workflow Superpowers và gate"
description: "Ép review/integrator/owner/docs bằng H2 và H4, ghim Superpowers trên Mac, retry không làm lại việc đã commit."
status: pending
priority: P1
effort: 6d
branch: v3
tags: [crew-v3, paperclip, execution-policy, superpowers, crew-mac]
created: 2026-10-07
---

# Crew v3 R1-2 — Workflow Superpowers và gate — Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent trên Mac làm việc theo Superpowers đã ghim, và không agent nào bỏ qua được review, integrator, owner hay docs qua bất kỳ đường ghi nào của Paperclip; retry sau mất kết nối không làm lại việc đã commit.

**Architecture:** Gate dùng execution policy stock của Paperclip (stage review/approval, `maxReviewRounds`). Crew chỉ thêm hai điểm chặn đồng bộ trong lõi: H2 (đầu `runUpdate`, logic thật) chặn agent/hệ thống sửa policy và chặn `done` khi thiếu stage hay thiếu bằng chứng docs; H4 mới (đầu `issueService.create`) gắn template policy cho mọi issue, ép issue do agent tạo phải là issue con. Superpowers được copy ghim dưới `~/.crew/workflows/` trên Mac, bật cho agent bằng `--plugin-dir` trong `adapterConfig.extraArgs`, và wrapper `crew-claude-run` từ chối chạy khi pin sai hoặc có nguồn skill lạ.

**Tech Stack:** Paperclip fork `v2026.1001.0` nhánh `v3` (`e1c3dd2db`), Node ≥ 24.11, pnpm 9.15.4 qua Corepack, vitest + embedded PostgreSQL cho test fork, esbuild (đã có ở `package.json` gốc fork) cho bundle plugin, TypeScript + vitest cho `apps/crew-mac` (repo Crew), Claude Code CLI 2.1.x (`--plugin-dir`, `--setting-sources`), Superpowers `6.4.1` (`5bf4e780…`), `crew-docs` (`packages/docs-kit`).

**Spec:** [R1-2 gates](../../docs/superpowers/specs/2026-10-07-crew-v3-r1-2-gates.md) (bổ sung), [thiết kế v3](../../docs/superpowers/specs/2026-10-05-crew-v3-paperclip-design.md) §3–§4, [stock-first](../261006-0805-crew-v3-stock-first/plan.md) Phần 2 mục R1-2 và "Chính sách test theo tầng", [R1-1](../261006-1355-crew-v3-r1-1/plan.md) mục "Việc bắt buộc đầu R1-2", [gói ngữ cảnh](goi-ngu-canh.md). Quyết định và ruling: [sdd-ledger.md](sdd-ledger.md).

## Global Constraints

Kế thừa nguyên văn R1-1, cộng các dòng đánh dấu (mới):

- Không sửa file lõi Paperclip, trừ hook một dòng ở đầu hàm. Mỗi hook có mục trong `crew/release/core-hooks.json` và có test kiểm hook còn tồn tại. Import của hook đặt ở cuối file.
- Ngân sách tối đa 5 chỉ đếm hook một dòng có registry. Sau R1-2: H1 `claimQueuedRun`, H2 `runUpdate`, H3 `releaseRunLease`, H4 `issueService.create` = **4/5** (mới, owner chốt O4).
- Không tạo scheduler, queue hay bảng ticket thứ hai. Paperclip là nguồn trạng thái duy nhất cho issue/run/session. Không thêm migration/bảng mới (mới: cấu hình vai trò nằm ở `agents.metadata.crewRole`, bằng chứng docs là comment issue).
- Credential AI chỉ nằm trên Mac. Agent dùng đăng nhập Keychain sẵn có, không token.
- Agent chạy `claude` với `--setting-sources project,local`; được nạp `~/.claude/CLAUDE.md` cá nhân (owner chốt).
- Repo agent làm việc là git worktree riêng dưới `~/crew-agents`; `.paperclip-runtime/` nằm trong `info/exclude`.
- sshd của agent chạy trong phiên desktop.
- UI/docs tiếng Việt, identifier/path tiếng Anh, giờ hiển thị Asia/Ho_Chi_Minh.
- Backup DB trước mọi migration hoặc thay đổi dữ liệu. Không dùng cổng 5432.
- VPS `nhamoiplatform`: chỉ đụng compose project `crew-v3-spike` và `/opt/crew-v3-spike`; không build full image trên VPS.
- Không deploy, không push fork khi chưa có approval của owner. Repo Crew: chỉ push khi owner bảo "push".
- Mỗi process nền ghi lệnh/PID/cổng/worktree vào [processes.md](processes.md) và dừng khi xong task.
- (mới) Phiên làm việc của Trợ Lý/worker không bao giờ đặt `PAPERCLIP_RUN_ID` và không ghi vào `~/crew-agents` ngoài bước AC-2 có owner duyệt.
- (mới) Không gọi `kongming` hay model `fable` (owner cấm). Kẹt thì opus góc nhìn mới, rồi ghi ruling.
- (mới) Repo Crew: commit đổi file nguồn phải sửa `docs/flows/<id>.md` (R3), file nguồn mới phải có trong `docs/flows.yaml` (R2), chạy `crew-docs check --staged` trước commit. Không sửa mục `source`/`shared`/`unassigned` của `flows.yaml`.
- (mới) Không để mã plan/ticket (PL-1, AC-2, R1-2…) trong code, test, chuỗi hiển thị hay commit message.

## Review Focus

1. Plugin hoặc service nội bộ (không có actor) gọi `issueService.update(id, { status: "done" })` khi stage review còn chờ: phải bị 422, không chỉ đường REST. Test: PL-1 Step "system done".
2. Agent đổi `monitor` trong `executionPolicy` (tính năng stock, hợp lệ) vẫn phải được phép; chỉ đổi stage/participant/`maxReviewRounds` mới bị chặn. Test: PL-1 Step "monitor".
3. Executor tự chuyển issue sang chính reviewer rồi `done` (stage bị auto-skip, 0 decision) hoặc agent PATCH `executionPolicy: null`: issue không được `done`. Test: PL-1 Step "auto-skip" và "policy null".
4. Retry khi Mac vào được nhưng `git log` lỗi (worktree bị xóa, thư mục khác): run giữ `queued` có hạn chót, không mở cổng chạy lại mù. Test: RR-2 Step "git lỗi".
5. Owner tự nâng Superpowers của mình lên bản khác pin, hoặc repo dự án bật `superpowers@…` bản khác trong `.claude/settings.json`: agent vẫn chỉ dùng bản ghim, bản lạ bị từ chối rõ. Test: SP-3 Step "plugin project lệch pin".

---

## Gói ngữ cảnh và ticket

Luật chia theo [nhan-viec](../../.agents/skills/tro-ly/references/nhan-viec.md): vẽ gói trước, ticket chỉ nằm trong một gói, ticket cùng gói chạy nối tiếp trên một worker.

| Gói | Nạp gì | Model | Worker |
|---|---|---|---|
| `policy` | Fork: `server/src/crew/core-hooks.ts`; `server/src/services/issues.ts` (symbol `update`/`runUpdate`, `create`, `resolveResponsibleUserIdForIssueCreate`); `server/src/services/issue-execution-policy.ts` (`normalizeIssueExecutionPolicy`, `canAutoSkipPendingStage`, `reviewEscalationUserId`, `buildCompletedState`); `server/src/routes/issues.ts` (PATCH insert decision sau `updateIssue`); `packages/db/src/schema/{issues,issue_execution_decisions,issue_comments,agents,companies}.ts`; `crew/release/{core-hooks.json,check-core-hooks.mjs}`; [policy.md](policy.md) | opus | |
| `runtime-retry` | Fork: `server/src/crew/{load-gate.ts,remote-stop.ts}`; `packages/db/src/schema/{heartbeat_runs,environment_leases}.ts`; test `crew-load-gate`, `crew-remote-stop`; [runtime-retry.md](runtime-retry.md) | opus | |
| `plugin` | Fork: `packages/crew-plugin/`, `server/src/services/plugin-loader.ts` (`DEV_TSX_LOADER_PATH`), `server/src/routes/plugins.ts` (`PluginHealthCheckResult`), `crew/ops/{overlay-source,overlay-job,inspect-image,deploy,rollback}.sh`, `crew/release/verify.sh`; [plugin.md](plugin.md) | sonnet | |
| `mac-cli` | Repo Crew: `apps/crew-mac/src/{cli.ts,commands/uninstall.ts,commands/doctor.ts,reaper/process-table.ts,reaper/run-members.ts}`, test `uninstall`/`doctor`/`cli`, `docs/flows/mac-setup.md`, `packages/docs-kit/src/{cli.ts,hook-installer.ts}`; [mac-cli.md](mac-cli.md) | sonnet (reviewer opus) | |
| `superpowers-mac` | Repo Crew: `apps/crew-mac/src/{paths.ts,commands/setup.ts,commands/doctor.ts,cli.ts}`, `assets/crew-claude-run.sh`; V2 `src/workflow-policy.ts`, `gateway/src/isolation/inventory.ts` (`classifyOrigin`); Mac mini `~/.claude/plugins/installed_plugins.json`; [superpowers-mac.md](superpowers-mac.md) | opus | |
| `roles` | Fork: `docs/guides/execution-policy.md` (mục API Usage), `server/src/routes/agents.ts` (`PATCH /agents/:id`, `PUT /agents/:id/instructions-bundle/file`); interface của `policy`, `superpowers-mac`, `mac-cli`; [roles.md](roles.md) | sonnet | |

| ID | Việc | Gói | Nạp gì (thêm so với gói) | Phụ thuộc | Model | Worker · trạng thái |
|---|---|---|---|---|---|---|
| PL-1 | H2 logic thật: `server/src/crew/issue-policy.ts` (vai trò, template, fingerprint, bằng chứng docs) + `issue-gate.ts` (`evaluateIssueGate`, `crewBeforeIssueWrite`); chặn agent/hệ thống đổi policy, chặn `done`/hoàn tất stage integrator khi thiếu stage, tự duyệt hay docs lỗi; board ép được nhưng ghi activity `crew.policy.board_override`; agent không được chuyển `cancelled` (O7) | `policy` | `issue-execution-policy.ts` 505–600, 650–660, 840–900 | — | opus | worker-policy (opus) · review đạt (`20a620c`, sửa `1e72138`, `c32d59f`) |
| PL-2 | H4 `beforeIssueCreate` ở dòng đầu `issueService.create`: agent tạo issue phải có `parentId`, policy bị thay bằng template con; board/hệ thống tạo issue không policy thì gắn template gốc/con; mục H4 trong `core-hooks.json` | `policy` | `issues.ts` `create` (9634–9700), `createChild` (9124–9230), `routes/issues.ts` tạo issue (11800–11845) | PL-1 | opus | worker-policy (opus) · review đạt (`66e1ee6`, sửa đến `2db8aaf`) |
| RR-1 | (2) script fallback khi `crew-mac stop-run` thoát 2; (3) cổng tải ghi mốc chờ bền (activity trước, comment sau, comment lỗi thì thử lại) | `runtime-retry` | `CREW_REMOTE_STOP_SCRIPT`, `evaluateBeforeClaim`, `defaultBeforeClaimDeps` | — | opus | worker-retry (opus) · review đạt (`68bf812`) |
| RR-2 | (1) retry kiểm tiến độ: H1 với run có `retryOfRunId` đếm commit trong `remoteCwd` của lease run trước kể từ `startedAt − 30s`, có commit thì comment "kiểm tra và tiếp tục", lỗi kiểm thì giữ `queued` theo hạn chót cổng tải | `runtime-retry` | `heartbeat_runs.retryOfRunId/startedAt`, `environment_leases.metadata.remoteCwd`, `readRemoteCwd` | RR-1 | opus | worker-retry (opus) · review đạt (`d5630e6`, sửa `2ae7d77`, `8b800e3`) |
| PG-1 | (6) bundle `crew.core` bằng esbuild (không cần tsx loader), `inspect-image.sh` bỏ điều kiện loader và kiểm file crew mới, `deploy.sh`/`rollback.sh` kiểm `/plugins/crew.core/health`, sửa đường dẫn cứng `overlay-source.sh`, đổi tên test `crew-run-cancelled` cho đúng `blocked` | `plugin` | — | — | sonnet | worker-plugin (sonnet) · review đạt (`e02e83f`, sửa m1 `d9ff72d`); sửa hoa thường verify `5956d62` |
| MC-1 | (4) `crew-mac uninstall` từ chối khi còn run Paperclip sống (trừ `--force`); (5) doctor `tcc-pending` chỉ fail với claude/node, app khác warn; `sysctl`/`memory_pressure` theo đường dẫn tuyệt đối | `mac-cli` | `listProcesses`, `isClaudePrint`, `parsePendingTccPrompts`, `checkTccPending`, `checkLoad` | — | sonnet | worker-mac (sonnet) · review đạt (`811e0c9`, sửa `deb8503`, `a15e4fc`) |
| MC-2 | doctor `crew-docs`: mỗi worktree agent có `docs/flows.yaml` phải có `git config crew-docs.bundle` chạy được (integrator dùng) | `mac-cli` | `hook-installer.ts` (`BUNDLE_KEY`) | MC-1 | sonnet | worker-mac (sonnet) · review đạt (`bf5114a`, sửa `deb8503`, `a15e4fc`) |
| SP-1 | Spike trên Mac mini (haiku, 1–3 lượt): `--plugin-dir` có nạp Superpowers dưới `--setting-sources project,local` không; skill user/project nào lọt; ghi `spike-superpowers.md` | `superpowers-mac` | `claude --help`, stream-json `system/init` | — | opus (lượt chạy dùng `--model haiku`) | worker-sp (opus) · xong (`spike-superpowers.md`) |
| SP-2 | Pin + cài: `src/workflows/{pin,policy,tree-checksum,install}.ts`, `setup` copy Superpowers 6.4.1 vào `~/.crew/workflows/superpowers/6.4.1-5bf4e7801107/` và in `extraArgs`; doctor `superpowers-pin`; flow mới `mac-workflows` | `superpowers-mac` | V2 `workflow-policy.ts` | SP-1, MC-2 | opus | worker-sp (opus) · review đạt (`3adaeb6`, sửa `3a4b374`) |
| SP-3 | Chặn nạp chéo: `src/workflows/inventory.ts` (`classifyOrigin`, `discoverSources`), lệnh `crew-mac workflow-check`, wrapper `crew-claude-run` từ chối run thiếu/sai pin hoặc có nguồn `blocked` (exit 78) | `superpowers-mac` | V2 `inventory.ts` `classifyOrigin` | SP-2 | opus | worker-sp (opus) · review đạt (`efd03c5`, sửa đến `a520c16`) |
| RO-1 | Instructions executor/reviewer/integrator theo Superpowers trong fork `crew/agents/{executor,reviewer,integrator}.md`, script `crew/agents/apply-roles.sh` (đặt `metadata.crewRole`, `extraArgs`, upload `AGENTS.md`) | `roles` | — | PL-2, SP-3, MC-2 | sonnet | worker-roles (sonnet) · review đạt (`99b49c7`, sửa `4f9dfc5`) |
| RO-2 | (O5) Sau khi owner duyệt issue gốc, integrator được đánh thức, merge `crew/req/<identifier>` vào nhánh mặc định và push, ghi comment `crew-merge sha=<40 hex> branch=<nhánh mặc định> pushed=<yes|no>`; push lỗi thì issue `blocked` kèm lý do | `roles` | `plugin` event issue đã `done` (nếu cần plugin đánh thức thì ghi delta vào `packages/crew-plugin/`, phối hợp PG-1) | RO-1, PG-1 | sonnet | worker-roles (sonnet) · review đạt (`6cbddea`, sửa đến `8178de7`, vòng 4/5 Trợ Lý tự đọc diff); phần plugin review đạt (`2b382bb`, sửa `e346fb1`) |
| AC-2 | Nghiệm thu R1-2 (cổng 1, 2, 4, 5 của nghiem-thu) trên Mac mini + server spike; deploy kiểu RT-4 | Trợ Lý | mục "Nghiệm thu" bên dưới | tất cả | opus | |

**Song song được:** ba gói fork `policy`, `runtime-retry`, `plugin` chạy song song trên ba worktree riêng (file ghi rời nhau, xem bảng sở hữu). `mac-cli` chạy song song với ba gói fork; SP-1 (spike, không sửa code) chạy song song với MC-1. SP-2 chờ MC-2 vì cùng sửa `setup.ts`/`doctor.ts`/`cli.ts`. RO-1 chờ PL-2, SP-3, MC-2. AC-2 cuối cùng.

**Sở hữu file (không hai gói song song cùng ghi một file):**

| Gói | Ghi |
|---|---|
| `policy` | `server/src/crew/{core-hooks.ts,issue-policy.ts,issue-gate.ts,issue-create-policy.ts}`, một dòng trong `server/src/services/issues.ts`, `server/src/__tests__/{crew-core-hooks,crew-issue-gate,crew-issue-create-policy}.test.ts`, `crew/release/core-hooks.json` |
| `runtime-retry` | `server/src/crew/{load-gate.ts,remote-stop.ts,retry-progress.ts}`, `server/src/__tests__/{crew-load-gate,crew-remote-stop,crew-retry-progress,crew-before-claim}.test.ts` |
| `plugin` | `packages/crew-plugin/**`, `crew/ops/**`, `crew/release/verify.sh`, `server/src/__tests__/{crew-plugin-manifest,crew-run-cancelled}.test.ts` |
| `roles` | `crew/agents/**` |
| `mac-cli` → `superpowers-mac` (nối tiếp) | `apps/crew-mac/**`, `docs/flows/{mac-setup,mac-workflows}.md`, mục flow `mac-workflows` trong `docs/flows.yaml`, `docs/index.md` nếu `crew-docs generate` đổi |

**Worktree:** fork `.worktrees/paperclip-r12-policy` (`crew/r12-policy`), `.worktrees/paperclip-r12-retry` (`crew/r12-retry`), `.worktrees/paperclip-r12-plugin` (`crew/r12-plugin`), `.worktrees/paperclip-r12-roles` (`crew/r12-roles`), cùng gốc `v3` `e1c3dd2db`; tích hợp vào `crew/r1-2` trước AC-2. Repo Crew `.worktrees/crew-r12-mac` (`r1-2/crew-mac`) từ `v3`. Tạo worktree bằng `superpowers:using-git-worktrees`; kiểm `git rev-parse --show-toplevel` trước khi làm.

## Interface giữa các gói

- **Vai trò agent** (O8, PL-1 định nghĩa ở `server/src/crew/issue-policy.ts`, PL-2/RO-1/AC-2 dùng): file JSON chỉ đọc do env `CREW_POLICY_CONFIG` trỏ tới, dạng `{ "companies": { "<companyId>": { "reviewerAgentId", "integratorAgentId", "ownerUserId" } } }`, đọc lại mỗi lần gọi. `loadCrewCompanyConfig(companyId): Promise<CrewCompanyConfig>` trả `{kind:"absent"}` (company không có trong file hoặc không đặt env → hành vi stock, kể cả O7), `{kind:"invalid",reason}` (entry sai hoặc cả file lỗi → company đó fail-closed) hoặc `{kind:"ok",roles,ownerUserId}`. Không dùng `agents.metadata.crewRole`. Owner của template gốc lấy từ file. Executor và Trợ Lý không có trong file. RO-1 ghi file này (không PATCH metadata); deploy mount file read-only vào container.
- **Template policy** (PL-1 định nghĩa trong `issue-policy.ts`, PL-2 gắn, R1-3 Trợ Lý dùng lại qua H4 chứ không tự dựng):
  - `buildCrewPolicy("child", roles)` = stages `[review: agent reviewer]`, `maxReviewRounds: 5`.
  - `buildCrewPolicy("root", roles, ownerUserId)` = stages `[review: agent reviewer, review: agent integrator (merge + docs), approval: user owner, review: agent integrator (push)]`, `maxReviewRounds: 5` (O9 — 4 stage; stage 4 cần `crew-merge … pushed=yes`).
  - Kết quả đã qua `normalizeIssueExecutionPolicy` (có `id` stage/participant).
- **Bằng chứng docs** (PL-1 parse, RO-1 integrator ghi): comment issue do agent integrator viết, **dòng đầu** đúng regex `^crew-docs-check commit=([0-9a-f]{40}) range=([0-9a-f]{7,40})\.\.([0-9a-f]{40}) exit=([0-3])$`, với `commit` = đầu range = merged commit. Hợp lệ khi `exit=0`; `exit=3` (repo chưa `crew-docs init`) được qua kèm activity `crew.docs_gate.uninitialized`; comment phải mới hơn quyết định `changes_requested` gần nhất của issue.
- **Báo commit của executor** (RO-1 định nghĩa, reviewer/integrator đọc): comment có dòng `crew-commit sha=<40 hex> branch=<tên nhánh> tests=<lệnh> result=<pass|fail>`.
- **Mã lỗi H2/H4** (PL-1/PL-2 ném, RO-1 instructions giải thích): `unprocessable(message, { code, violations })` với `code ∈ {"crew_gate_blocked","crew_policy_locked","crew_agent_root_issue","crew_roles_unconfigured","crew_role_assignee"}`.
- **Registry hook** (PL-2 mở rộng `core-hooks.ts`): `beforeIssueCreate<T extends IssueCreateLike>(input: { db: Db; companyId: string; data: T }): Promise<T>`; dòng hook `data = await crewCoreHooks.beforeIssueCreate({ db, companyId, data });`.
- **Comment retry** (RR-2 ghi, RO-1 executor đọc): comment hệ thống bắt đầu bằng `Crew: lần chạy lại` liệt kê commit; activity `crew.retry_progress.checked` trên run mới (một lần mỗi run).
- **File crew mới trong image** (policy/runtime-retry tạo, PG-1 kiểm ở `inspect-image.sh`): `server/dist/crew/{core-hooks,remote-stop,load-gate,ssh-in-place,issue-policy,issue-gate,issue-create-policy,retry-progress}.js`.
- **Pin Superpowers trên Mac** (SP-2 cài, SP-3 kiểm, RO-1 cấu hình agent): thư mục `$HOME/.crew/workflows/superpowers/6.4.1-5bf4e7801107`, checksum cây `3f0ff8c82c0795dae8de3cc3ef358364d4f3de81e78b86e1d64b03ac2f9cbd9a` (231 file, thuật toán ở [superpowers-mac.md](superpowers-mac.md) SP-2). `adapterConfig.extraArgs = ["--setting-sources","project,local","--plugin-dir","<thư mục pin>"]`. Wrapper thoát **78** khi pin thiếu/sai hoặc có nguồn `blocked`.
- **crew-docs cho integrator** (MC-2 kiểm, RO-1 dùng): `node "$(git config --get crew-docs.bundle)" check --range <base>..<head>` trong worktree integrator; không có config mà repo không có `docs/flows.yaml` thì coi là exit 3.
- **Cho R1-3 (Trợ Lý, không làm ở đây):** Trợ Lý tạo issue con qua `POST /issues/:parentId/children` hoặc `POST /companies/:companyId/issues` có `parentId`; không gửi `executionPolicy` (H4 tự gắn template con, gửi gì cũng bị thay); gán executor không phải reviewer/integrator; dùng `blockedByIssueIds` để nối tiếp; issue gốc của yêu cầu do owner tạo (template gốc), Trợ Lý là assignee/executor của issue gốc và chuyển `done` khi các con xong để mở stage reviewer → integrator → owner.

## Nghiệm thu (AC-2)

- [ ] Cổng 2: board ép `done` issue gốc → `executionState` không thành `completed`, integrator được đánh thức nhưng KHÔNG push (review roles).

- [ ] Cổng 4, run thật đầu tiên: so sha256 `~/.claude/plugins/installed_plugins.json` trước/sau (Claude không tự cài plugin), chạy `crew-mac run-init-check` trên log run; chạy lệnh kiểm tiến độ retry khi có run khác cùng worktree đang chạy — run đó không bị dừng (review SP N2, RR).

- [ ] Trước D1: chép `crew/ops/` mới (gồm `plugin-state.sh`, `plugin-state.py`, chmod +x) lên `/opt/crew-v3-spike/ops/`, chạy tay `./api.sh GET /plugins/crew.core/health` để xác nhận cú pháp `api.sh` (review PG-1 m2, m5).

Chạy một lần trên nhánh tích hợp `crew/r1-2` + `r1-2/crew-mac`, theo [nghiem-thu](../../.agents/skills/tro-ly/references/nghiem-thu.md). Cổng 3 (trình duyệt) **không áp dụng**: R1-2 không đổi UI. Mỗi tiêu chí ghi lệnh, ID issue/run và số liệu DB vào ledger.

**Điểm dừng hỏi owner (bắt buộc, không tự làm):**
- (D1) Trước deploy lên server spike: báo commit, sha256 overlay, kết quả `inspect-image.sh`, danh sách run đang chạy (phải rỗng). Chờ owner duyệt rồi mới `crew/ops/deploy.sh`.
- (D2) Trước khi tạo worktree reviewer/integrator dưới `~/crew-agents`, cài lại gói `crew-mac` và đổi `adapterConfig` agent: báo lệnh, chờ owner duyệt (có thể owner tự chạy `crew-mac setup` trên màn hình Mac).
- (D3) Trước mọi lần push fork/repo Crew: chờ owner nói "push".

**Các bước:**
- [ ] **Cổng 1 (artifact chạy được).** Fork: `crew/release/verify.sh` xanh trên `crew/r1-2`; `node crew/release/check-core-hooks.mjs` in `Hook một dòng: 4/5`. Repo Crew: `pnpm --filter @crew/mac test`, `pnpm --filter @crew/mac typecheck`, `pnpm --filter @crew/mac build`, `pnpm lint`. Dựng overlay (`crew/ops/overlay-source.sh crew/r1-2` rồi `overlay-job.sh` trên VPS), `inspect-image.sh` không có `MISSING|FAIL` và in `plugin bundle ok`.
- [ ] **D1 → deploy.** `deploy.sh <tag>` thoát 0, in `plugin crew.core healthy`; `./api.sh GET /plugins/crew.core/health` có `"healthy": true`.
- [ ] **D2 → Mac.** Owner chạy (hoặc duyệt) `crew-mac setup` bản mới: in thư mục pin và `extraArgs`; `crew-mac doctor` đạt cả `superpowers-pin` và `crew-docs`. Tạo agent `reviewer`, `integrator` (claude_local, environment mac-mini, worktree riêng `~/crew-agents/reviewer`, `~/crew-agents/integrator`), chạy `crew/agents/apply-roles.sh` cho cả ba agent.
- [ ] **Cổng 2a — không bỏ qua review/owner qua API.** Trên issue gốc template (board tạo, kiểm DB `execution_policy` có 3 stage, `maxReviewRounds` 5): bằng token/run của executor (header `X-Paperclip-Run-Id` của run thật) thử lần lượt `PATCH executionPolicy: null`, `PATCH executionPolicy` bỏ stage owner, `PATCH status done` khi stage reviewer đang chờ, `PATCH assigneeAgentId=<reviewer>` rồi `done`. Kỳ vọng: 422 `crew_policy_locked`/`crew_gate_blocked` hoặc chuyển `in_review`; truy vấn `select status, execution_policy from issues` và `select stage_id, outcome, actor_agent_id from issue_execution_decisions where issue_id=…` khớp (không `done`, policy nguyên).
- [ ] **Cổng 2b — issue con agent tạo không thoát policy.** Executor `POST /companies/:id/issues` không `parentId` → 422 `crew_agent_root_issue`; có `parentId` và gửi `executionPolicy: { stages: [] }` → 201, DB cho thấy policy = template con (1 stage reviewer, `maxReviewRounds` 5) và `responsible_user_id` khác null. (O8) Vai trò đọc từ `CREW_POLICY_CONFIG`: kiểm file mount read-only vào container (`docker inspect` Mounts `RW=false`), nằm ngoài thư mục dữ liệu Paperclip, và agent đổi `metadata.crewRole` của chính nó không làm đổi vai trò (gate vẫn theo file).
- [ ] **Cổng 2c — vòng 6 chuyển owner.** Issue con có executor + reviewer agent: reviewer `PATCH status in_progress` + comment 5 lần liên tiếp (executor `done` lại giữa các lần). Kỳ vọng: sau lần thứ 5, issue `in_review`, `assignee_user_id` = owner, `execution_state.changesRequestedCount` = 5; lần thứ 6 của reviewer → 422. 5 dòng `changes_requested` trong `issue_execution_decisions`.
- [ ] **Cổng 2d — merge mà docs lỗi thì chưa `done`.** Issue gốc tới stage integrator: integrator comment `crew-docs-check … exit=1` rồi `PATCH status done` → 422 `crew_gate_blocked` (`docs_failed`); không comment → 422 (`docs_missing`); comment `exit=0` đúng merged commit → chuyển stage owner; owner (board) approve → `done`, không có activity `crew.policy.board_override`. Board ép `done` một issue khác còn stage chờ → `done` và có đúng một activity `crew.policy.board_override`.
- [ ] **Cổng 4 — chạy thật trên Mac.** Một yêu cầu nhỏ thật (issue gốc, executor `claude_local`): executor commit trong worktree, comment `crew-commit`; reviewer (agent riêng) approve; integrator merge vào `crew/req/<identifier>` trong worktree của nó, chạy `crew-docs check --range`, comment bằng chứng, approve; owner approve → `done`. Log run cho thấy skill `superpowers:*` từ thư mục pin (stream-json `system/init`), không có skill/plugin cá nhân. Checkout của owner và file chưa commit nguyên. Wrapper với `--plugin-dir` sai: run fail, log có `crew-workflow blocked`.
- [ ] **Cổng 4 — retry không làm lại.** Lặp kịch bản mất mạng S3 của R1-1 (issue `sleep 120` rồi commit, tắt Tailscale VPS 60 giây sau khi process kịp commit): run retry có comment `Crew: lần chạy lại…` liệt kê commit, và sau run retry `git log` trong worktree không có commit trùng nội dung. Mac tắt hẳn khi retry tới hạn: run giữ `queued`, có activity `crew.load_gate.waiting`, hết `maxWaitMinutes` thì `blocked`.
- [ ] **Cổng 4 — H3 fallback.** Gọi H3 cho run có root ngoài `worktreeRoot` (environment trỏ thư mục spike cũ): activity remote-stop ghi `via=fallback`, process dừng.
- [ ] **Cổng 5 — docs khớp code.** Repo Crew: `crew-docs check --range <v3 gốc>..HEAD` đạt trên `r1-2/crew-mac`.
- [ ] **Dọn:** dừng mọi process trong [processes.md](processes.md); issue thử chuyển `cancelled`; ghi kết quả từng tiêu chí (đạt/không, bằng chứng) vào ledger; rồi `superpowers:finishing-a-development-branch` (gộp cục bộ, không push khi chưa có D3).

## Self-review

- **Phủ phạm vi:** 7 việc bắt buộc đầu R1-2: (1) RR-2, (2) RR-1, (3) RR-1, (4) MC-1, (5) MC-1, (6) PG-1, (7) PL-1. Stock-first R1-2: Superpowers ghim + chặn nạp chéo (SP-1..3), template reviewer/integrator/owner (PL-1/PL-2), rule 5 vòng (template `maxReviewRounds: 5` + `responsibleUserId`, Cổng 2c), integrator merge + docs-kit trên merged commit (RO-1 + H2 docs gate). O1 (RO-1 agent riêng; PL-1 chặn tự duyệt), O2 (template con không có owner), O3 (PL-1 docs gate, exit 3 cho qua kèm activity), O4 (PL-2). Nghiệm thu: Cổng 2a–2d + 4.
- **Placeholder:** đã quét `TBD`, `TODO`, `implement later`, `similar to task` trên mọi file của plan: không có.
- **Nhất quán interface:** tên `loadCrewCompanyConfig` (thay `loadCrewRoles` theo O8), `buildCrewPolicy`, `policyGateFingerprint`, `parseDocsCheckEvidence`, `evaluateIssueGate`, `crewBeforeIssueWrite`, `crewBeforeIssueCreate`, mã lỗi, regex docs, đường dẫn pin, mã thoát 78 đã đối chiếu giữa `policy.md`, `roles.md`, `superpowers-mac.md`, `plugin.md`.
- **Review Focus:** 1–3 → PL-1, 4 → RR-2, 5 → SP-3.
- **R1-3:** chỉ ghi interface (mục trên), không có ticket.

Câu hỏi còn mở cho owner nằm cuối [sdd-ledger.md](sdd-ledger.md).

## Kết quả (07/10/2026)

Bàn giao cho R1-3: [handover.md](handover.md). Nghiệm thu chi tiết: [ac-2-report.md](ac-2-report.md); quyết định và ruling: [sdd-ledger.md](sdd-ledger.md).

- Mọi ticket đạt review riêng (PL-1/2, RR-1/2, PG-1/2, MC-1/2, SP-1/2/3, RO-1/2) và review toàn nhánh (opus) cùng các đợt sửa. Owner chốt thêm O5–O11 trong ngày (integrator tự push qua **stage 4** của template gốc 4 stage; vai trò trong file `CREW_POLICY_CONFIG`; agent không cancel; tự giao lại executor khi mở lại issue; agent thật chạy sonnet).
- Fork `crew/r1-2` → `v3`: hook một dòng 4/5 (H1, H2, H3, H4). Verify cuối `6c20d40`: server crew 238/238, adapter 14/14, `crew/agents` 43/43, ops+release 40/40. Server spike chạy `crew-v3/paperclip:v3-6c20d406c`.
- Repo Crew `r1-2/crew-mac` → `v3` (`42a2503`): `crew-mac` ghim Superpowers 6.4.1, chặn nạp chéo (wrapper thoát 78), doctor 16/16 trên Mac mini.
- AC-2 trên máy thật: Cổng 1 (test/typecheck đạt; `pnpm lint` đỏ vì file có sẵn trên `v3`, ngoài diff), Cổng 2a–2d đạt, Cổng 3 không áp dụng, Cổng 4 đạt sau ba lần chạy (lần 1 đỏ: L1–L7; lần 2 đạt có điều kiện; lần 3 đạt ca push lỗi → push lại và H3 fallback), Cổng 5 đạt.
- Rủi ro đã biết (ledger): khe A1/A3 của cổng tải, retry ≥2 bị stock hủy khi chờ, L6 recovery stock vẫn đổi status sang `blocked` (không còn chặn luồng), board override làm mất `returnAssignee`. Chưa chạy lại ca "Mac tắt → `blocked` sau `maxWaitMinutes`" (đã đạt ở R1-1).
