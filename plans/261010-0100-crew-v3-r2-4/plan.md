---
title: "Crew v3 R2-4 — Runtime codex_local, opencode_local (OpenCode Go), công tắc theo máy, chọn model, fallback cùng máy"
description: "Executor Crew chạy được Codex (tài khoản ChatGPT trên Mac) và OpenCode Go (key trong Keychain) in_place qua SSH như claude_local. Công tắc runtime theo máy giữ run ở queued, không kill run đang chạy. Trợ Lý chọn runtime/model theo độ khó, lý do lưu ở marker và bảng plugin. Plugin chuyển runtime cùng máy khi hết quota, mất đăng nhập hoặc công tắc OFF; H1 reconcile trước run mới. Không thêm hook; vá adapter P5–P7 chờ owner duyệt."
status: pending
priority: P1
effort: 5d
branch: r2-4
tags: [crew-v3, runtimes, codex, opencode, model-policy, fallback, h1, crew-plugin, crew-mac]
created: 2026-10-10
---

# Crew v3 R2-4 — Runtime, công tắc theo máy, chọn model, fallback — Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executor Crew trên Mac chạy được `codex_local` và `opencode_local` (OpenCode Go) trong worktree riêng như
`claude_local`. Owner bật/tắt từng runtime theo máy. Trợ Lý chọn runtime/model theo độ khó và ghi lý do. Run hỏng vì
quota, đăng nhập, runtime hỏng, hoặc bị giữ vì công tắc OFF thì chuyển sang runtime khác cùng máy sau khi reconcile.

**Architecture:**
- **Mac (repo Crew, `apps/crew-mac`).**
  - Hai wrapper mới `crew-codex-run`, `crew-opencode-run`, dùng chung `crew-run-mark.sh` (ghi `pgid`/`started` cho H3
    và bộ dọn).
  - Codex: `CODEX_HOME` riêng của agent, `auth.json` symlink tới đăng nhập của owner, không bao giờ nằm trong asset
    adapter gửi.
  - OpenCode: key đọc từ Keychain vào env của process, XDG riêng của agent.
  - `workflow-check --runtime`; lệnh `runtimes key opencode`; doctor; bộ dọn nhận `codex exec`/`opencode run`; bản tin
    máy có trường `runtimes`.
- **Fork (`crew/r2-4`).**
  - Vá adapter P5 (codex `sessionCodec`), P6 (opencode `in_place` + không ghi `$HOME/.claude/skills`), P7 (opencode
    `sessionCodec`), đều `adapter-patch` trong `core-hooks.json`.
  - Server: `CREW_RUNTIME_CATALOG`, kiểm override theo runtime của assignee (thân H2/H4); thân H1 thêm cổng công tắc
    và reconcile trước run fallback.
  - Plugin: migration `0006` (công tắc, quyết định, executor 1–3), route `runtime-switches`, data
    `crew.runtimeDecisions`, nút gạt trên thẻ máy, fallback theo `agent.run.failed` và job mỗi phút.
  - Instructions: Trợ Lý chọn runtime, executor ngoài Claude đọc `SKILL.md` ghim.
- **Không đổi:** lõi Paperclip ngoài vá adapter, hook 5/5, `apps/mac-app`, `crew-claude-run.sh`, UI stock.

**Tech Stack:**
- `@crew/mac`: Node ≥ 22 ESM, TypeScript 7, Vitest, Biome 2.5. Lệnh hệ thống `security`, `/usr/bin/git`, `ps`.
  CLI `codex` 0.161.0 (`~/.local/bin`), `opencode` 1.18.35 (`/opt/homebrew/bin`).
- Fork Paperclip `v2026.1005.0`: Express + Drizzle, vitest (server, adapters, plugin), `node --test` (`crew/agents`),
  plugin SDK (`ctx.events`, `ctx.jobs`, `ctx.issues.{update,requestWakeup,createComment,listAttachments}`,
  `ctx.agents.get/list`, `ctx.db`, api routes).

**Spec:** [2026-10-10-crew-v3-r2-4-runtimes-design.md](../../docs/superpowers/specs/2026-10-10-crew-v3-r2-4-runtimes-design.md).
Câu hỏi owner ở spec §11. Plan **tạm theo phương án khuyên** của cả 5 câu; mục "Còn chờ owner" ghi ticket bị ảnh hưởng.
Khuôn plan: [R2-2](../261009-1945-crew-v3-r2-2/plan.md), [R2-3](../261010-0030-crew-v3-r2-3/plan.md).

**Hiện trạng (10/10/2026 01:09, theo `date`):**
- Repo Crew: `v3` @ `ed2ec08`; `r2-2` = `r2-3` @ `204794c` (R2-3 mới chạy SP-0, chưa ticket code nào xong).
- Fork: `crew/r2-2` = `crew/r2-3` @ `f862b7b20` (prod, image `v3-f862b7b20`). Hook 5/5, vá P1–P4.
- Mac mini: `codex` 0.161.0 (đăng nhập ChatGPT owner, từng trả 400 ngày 08/10), `opencode` 1.18.35 (credential
  OpenCode Go đang ở file `~/.local/share/opencode/auth.json`; key Keychain owner nạp sau). `opencode models
  opencode-go` có 30 model.

## Global Constraints

- **Paperclip ghim `v2026.1005.0` tới hết R3.** Không nâng upstream, không `upgrade.sh`. `core-hooks.json` giữ
  `base: v2026.1005.0`.
- **Hook lõi 5/5, không thêm hook.**
  - Thân H1 mở rộng qua `server/src/crew/{load-gate,runtime-gate,runtime-fallback,retry-progress,runtime-switch}.ts`.
  - Thân H2/H4 đổi qua `model-policy.ts`, `issue-gate.ts`, `issue-create-policy.ts`.
  - Cập nhật `description` của H1 (và H2/H4 nếu ý nghĩa đổi); không đổi `anchor`/`head`/`file`.
- **Vá adapter chỉ P5, P6, P7** (spec §6.5).
  - Mỗi vá một mục `kind: "adapter-patch"` trong `crew/release/core-hooks.json`, có test `*.crew.test.ts`, và
    `verify.sh` chạy test + `tsc` của hai adapter.
  - **DP-1 chỉ deploy vá khi owner đã duyệt Q1** (ghi nguyên văn vào ledger).
  - Không vá chỗ nào khác của adapter/lõi. Cần thêm thì dừng, ghi ledger, hỏi owner.
- **Fork chỉ sửa:**
  - `server/src/crew/**`, `server/src/__tests__/crew-*`;
  - `packages/crew-plugin/**`, `crew/agents/**`, `crew/ops/**` (script tạo agent);
  - `crew/release/{core-hooks.json,verify.sh}`;
  - đúng 3 file nguồn adapter của P5–P7 cùng test `*.crew.test.ts` của chúng.
- **Repo Crew chỉ sửa:**
  - `apps/crew-mac/**`;
  - `docs/flows/{mac-runtimes,mac-setup,mac-workflows,mac-orphan-reaper}.md`, khối `mac-runtimes` trong
    `docs/flows.yaml`, `docs/files.md` (sinh);
  - `pnpm-lock.yaml` nếu cần.

  Không đụng `apps/mac-app`, `assets/crew-claude-run.sh`.
- **Credential.**
  - Agent (worker phát triển và agent Crew) không đọc, in, ghi, truyền key hay token.
  - Wrapper đọc key bằng `security … -w` vào biến môi trường của process con. Không `echo`, không file, không argv.
  - Test dùng Keychain giả (`CREW_SECURITY_BIN` trỏ script giả, chỉ cho test) và HOME tạm.
  - Không mở `~/.codex/auth.json`, `~/.local/share/opencode/auth.json` bằng công cụ đọc nội dung. Chỉ `test -e`/`stat`.
- **Worker phát triển chỉ là agent Claude** (owner 08/10).
  - Không Codex/OpenCode làm worker, không fable.
  - opus cho: SP-0, AD-2, SV-1, SV-2, PL-2, MR-1, MR-2, AG-1, RV-1, DP-1, AC.
  - sonnet cho: AD-1, PL-1, MR-3, MR-4, AG-2.
- **Quota dùng chung.**
  - SP-0: đúng 1 `opencode run` (`deepseek-v4-flash`, prompt 1 dòng); 0 run Codex, 0 run Paperclip.
  - AC: Codex đúng 1 run, OpenCode đúng 1 run, Claude: 1 Trợ Lý + 2 reviewer + 1 executor fallback.
  - Trước mỗi run OpenCode chạy `opencode stats --days 1 --models` và ghi chi phí vào ledger.
  - Dừng dispatch khi quota tuần Claude còn 1% (bộ nhớ dự án).
- **Mac mini dùng chung.**
  - Một việc nặng một lúc: test Postgres nhúng (kiểm `ipcs -m` trước), `verify.sh`, run thật.
  - Mọi process nền, thư mục tạm, agent/environment/issue tạm ghi [processes.md](processes.md).
  - Thư mục tạm không đặt dưới `/Volumes`, `~/Desktop`, `~/Downloads`, `~/Documents` (TCC).
- **Bài học R2-1/R2-2/R2-3 (bắt buộc).**
  - Body gửi VPS đi qua `scp` hoặc stdin, không nhúng vào chuỗi `ssh`.
  - Test nhận diện process dùng chuỗi `ps` lấy từ máy thật (SP-0 chụp `ps -E -ww` của `codex exec`/`opencode run`).
  - Giờ lấy theo `date`.
  - Trợ Lý chỉ ff nhánh tích hợp sau khi đọc log test.
  - Issue thử trong company TPS phải tự chốt `done`/`blocked`. Agent có `cost_events` thì terminate, không xóa.
  - Agent mới: `env: {}`, `maxConcurrentRuns = 1`, `model` rõ, `runtimeConfig.heartbeat.enabled = false`.
- **Vòng mỗi ticket:**
  1. implementer (agent mới, model của ticket) làm;
  2. reviewer (agent mới, cùng model) đọc diff + log test, đối chiếu Interface, Review Focus, Global Constraints,
     trả `Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`;
  3. Trợ Lý ghi ledger và ff.
- **Test theo tầng.**
  - Implementer chạy test phần đổi, typecheck package đó, `pnpm lint` (repo Crew) hoặc `biome`/`tsc` trên file đổi
    (fork).
  - Full suite chỉ ở RV-1 và DP-1:
    - repo Crew: `pnpm -r test`, `pnpm -r typecheck`, `pnpm lint`;
    - fork: `crew/release/verify.sh`.
- **Docs repo Crew theo `crew-docs`.**
  - File mới dưới `apps/crew-mac/src/runtimes/**` và `assets/crew-{codex,opencode}-run.sh`, `assets/crew-run-mark.sh`
    vào flow mới `mac-runtimes`.
  - Commit đổi file đã thuộc flow khác sửa `docs/flows/<flow>.md` tương ứng (R3).
  - `crew-docs check --staged` trước mỗi commit. Không sửa `source`/`shared`/`unassigned`, `AGENTS.md`, `CLAUDE.md`,
    `.claude/**`, `.githooks/**` (R6).
- **Push** chỉ khi owner nói "push". Tag fork cục bộ `crew/v3.4-rcN`, chốt `crew/v3.4` sau AC.
- **Deploy prod** chỉ qua `crew/ops/*`:
  1. `active-runs.sh` rỗng;
  2. backup;
  3. overlay/deploy;
  4. mốc rollback;
  5. health + plugin `ready`;
  6. `https://2p-solutions.com`, `https://kidyschool.com` 200.

  Hỏng thì `rollback.sh <TS>` ngay. R2-3 DP-1 phải xong trước R2-4 DP-1.
- UI/docs tiếng Việt. Identifier/path tiếng Anh. Giờ `Asia/Ho_Chi_Minh`. Conventional Commits, không nhắc AI, không mã
  ticket/plan trong code/test/commit.

## Lệch so với spec (phát hiện khi lập plan, có nguồn)

1. **`opencode_local` stock xóa `~/.claude/skills` của owner** trên target SSH (`opencode-local/src/server/execute.ts`
   `:455–462`). P6 xử lý. Tới khi P6 được duyệt và deploy:
   - công tắc `opencode_local` bị server ép OFF: `runtime-switch.ts` trả `false` khi env
     `CREW_OPENCODE_IN_PLACE_PATCH` khác `"1"`;
   - doctor báo lỗi.
2. **Codex `restore` chạy cả trên SSH** (`adapter-utils/src/remote-managed-runtime.ts:250`), có thể chép `auth.json`
   lên VPS. Wrapper bảo đảm asset `home` không bao giờ có `auth.json` (I6). SP-0 C2 kiểm `restore` khi file thiếu.
3. **Fallback chạy trong plugin, không ở H1.** Retry quota của stock hẹn `retryNotBefore` (có thể hàng giờ), nên H1
   chỉ thấy run lúc tới hạn. Plugin nghe `agent.run.failed` ngay. H1 chỉ giữ run (công tắc) và reconcile. Plugin cần
   thêm capability `issues.wakeup`, `agents.read`.
4. **Hủy run cũ của agent bị chuyển đi** phụ thuộc G0 P2. Stock không tự hủy thì SV-2 thêm nhánh hủy trong thân H1
   (Interface I4 `cancelSuperseded`).
5. **OpenCode chỉ có chi phí theo ngày.** `opencode stats` không có cửa sổ 5 giờ. Bản tin dùng `costDay` (1 ngày) làm
   chặn trên cho hạn $12/5 giờ, cùng `costWeek` (7 ngày), `costMonth` (30 ngày). Quá một trong ba (≥ 12, ≥ 30,
   ≥ 60) thì coi như hết quota khi chọn đích fallback. Bảo thủ, có thể bỏ sót đích còn dùng được.
6. **Bảng `crew_project_roles` có CHECK 1–2 executor không đặt tên.** Migration `0006` tìm tên bằng `pg_constraint`
   rồi thay bằng CHECK có tên `crew_project_roles_executor_count` (1–3). PL-1 Step 1 thử trên Postgres nhúng xem
   migrator plugin có nhận khối `DO $$…$$` không. Không nhận thì dùng hai câu `ALTER … DROP CONSTRAINT IF EXISTS
   crew_project_roles_check`/`_check1` theo tên đo được, kèm test.

## Review Focus

1. **Credential lọt lên VPS hoặc vào log/transcript.**
   - `auth.json` của Codex không được nằm trong asset `home`.
   - Key OpenCode chỉ trong env của process `opencode`: không argv, không file, không stdout/stderr của wrapper, không
     bản tin máy.
   - Test:
     - MR-1 `crew-codex-run.test.ts` (asset `home` sau wrapper không có `auth.json`, `CODEX_HOME` mới có symlink);
     - MR-1 `crew-opencode-run.test.ts` (Keychain giả trả chuỗi mốc → mốc không có trong stdout/stderr/argv/file nào
       dưới HOME tạm);
     - MR-4 `status-runtimes.test.ts` (bản tin không có mốc).
2. **OpenCode ghi đè thư mục ngoài worktree.** Với `in_place`, adapter không đồng bộ/restore workspace và không chạy
   lệnh `rm -rf`/`cp` nào nhắm `$HOME/.claude/skills`. Test: AD-2 `execute.in-place.crew.test.ts` ghi lại mọi lệnh
   shell gửi target giả và khẳng định không có lệnh đó, cwd = `authoritativeRoot`.
3. **Fallback lặp, chạy hai lần, hoặc chạy khi không được phép.**
   - Cùng `run_id` hai sự kiện thì một quyết định.
   - Lỗi `other` (code/test/timeout/422/`crew-workflow blocked`) thì không fallback.
   - `large` thì `fallback_refused`.
   - Đã 2 lần thì `refused`.
   - Runtime đích OFF/chưa đăng nhập/hết quota thì bỏ qua.
   - Issue có ảnh thì không chọn model không `vision`.
   - Test: PL-2 `runtime-fallback.test.ts` (bảng ca `chooseFallback`, `classifyRuntimeFailure`) và
     `runtime-fallback.db.test.ts` (idempotent, đổi assignee, `requestWakeup` gọi đúng một lần).
4. **Công tắc OFF làm hỏng run đang chạy hoặc chặn nhầm.**
   - H1 chỉ giữ run `queued` của agent đúng runtime trên đúng environment.
   - Run không có `defaultEnvironmentId`, agent ngoài ba runtime, company không phải Crew thì không bị giữ.
   - Bảng plugin chưa có thì dùng mặc định.
   - Lỗi đọc bảng thì giữ mặc định, không ném.
   - Test: SV-2 `crew-runtime-gate.test.ts`, `crew-runtime-switch.db.test.ts`.
5. **Reconcile trước run fallback sai worktree hoặc làm mất việc.**
   - Lệnh SSH nhắm cwd của **run cũ**.
   - Chỉ `git switch --detach` khi worktree cũ sạch và đang ở `crew/<identifier>`.
   - Bẩn thì block, không xóa gì.
   - Comment không lặp sau restart (marker activity).
   - Test: SV-2 `crew-runtime-fallback-reconcile.test.ts` (lệnh dựng ra, parse đầu ra sạch/bẩn, marker).

---

## Gói ngữ cảnh

Luật chia: vẽ gói ngữ cảnh trước rồi cắt ticket trong gói. Mỗi ticket thuộc đúng một gói. Trong một gói ticket làm lần
lượt, mỗi ticket một agent mới nạp cùng gói. Chỉ chạy song song giữa các gói có file ghi rời nhau.

| Gói | Phạm vi ghi | Nạp chung | Chi tiết |
|---|---|---|---|
| `probe` | `~/crew-r24-probe/` (ngoài repo), `reports/sp-0-probe.md`, `processes.md`, `sdd-ledger.md` | Spec §2, §4.2, §7, §9; fork `packages/adapters/{codex,opencode}-local/src/server/{execute,index}.ts`, `adapter-utils/src/remote-managed-runtime.ts`, `codex-local/src/server/codex-auth-copyback.ts`; `server/src/services/{heartbeat.ts (l.1090–1145, 15300–15560), plugin-host-services.ts (l.1951–2260), issues.ts (update)}`; `packages/plugins/sdk/src/types.ts` (events, `requestWakeup`) | [probe.md](probe.md) |
| `adapters` | Fork `packages/adapters/codex-local/src/server/{index.ts,session-codec.crew.test.ts}`, `packages/adapters/opencode-local/src/server/{execute.ts,index.ts,execute.in-place.crew.test.ts,session-codec.crew.test.ts}`, `crew/release/{core-hooks.json,verify.sh}` | Fork mục P2/P3 trong `core-hooks.json`; `packages/adapters/claude-local/src/server/{index.ts (l.90–135),execute.remote.crew.test.ts,session-codec.crew.test.ts}`; `codex-local/src/server/execute.ts` l.625–860 (mẫu `in_place`); `opencode-local/src/server/{execute.ts,execute.remote.test.ts}`; `crew/release/check-core-hooks.mjs`; Interface I7 | [fork.md](fork.md) |
| `policy` | Fork `server/src/crew/{model-policy,issue-gate,issue-create-policy,load-gate,retry-progress,runtime-gate,runtime-switch,runtime-fallback}.ts`, `server/src/__tests__/crew-{model-policy,issue-gate,issue-create-policy,runtime-gate,runtime-switch.db,runtime-fallback-reconcile,load-gate}.test.ts`, `crew/release/core-hooks.json` (chỉ `description` H1/H2/H4) | Fork `server/src/crew/{core-hooks,load-gate,retry-progress,remote-stop,project-roles,model-policy,issue-gate,issue-create-policy}.ts` + test hiện có; spec §5–§7; Interface I1, I3, I4 | [fork.md](fork.md) |
| `plugin` | Fork `packages/crew-plugin/**` | Fork `packages/crew-plugin/src/{manifest.ts,worker.ts,run-cancelled.ts,roles/{api,data}.ts,machines/{webhook,data}.ts,shared/{db,webhook}.ts,ui/machines/**}`, `migrations/0004_project_roles.sql`, test `roles.db.test.ts`, `machines.test.ts`; SDK `types.ts` (`PluginIssuesClient.update/requestWakeup`, `PluginAgentsClient`, events); Interface I1, I2, I3, I5, I8 | [fork.md](fork.md) |
| `agents` | Fork `crew/agents/**`, `crew/ops/create-runtime-executor.sh` (+ test) | Fork `crew/agents/{assistant,executor}.md`, `render-instructions.mjs`, `merge-agent-config.mjs`, `apply-roles.sh`, `instructions.test.mjs` (sau khi R2-3 AG-2 đã vào `crew/r2-3`); spec §4.1, §4.3, §6.2; Interface I1, I6 | [fork.md](fork.md) |
| `mac-runtimes` | `apps/crew-mac/**` (trừ `src/files/**`, `assets/crew-claude-run.sh`), `docs/flows/{mac-runtimes,mac-setup,mac-workflows,mac-orphan-reaper}.md`, khối `mac-runtimes` trong `docs/flows.yaml`, `docs/files.md` | Repo Crew (sau R2-3 MW-4) `apps/crew-mac/{assets/crew-claude-run.sh,src/wrapper.ts,src/commands/{setup,doctor,workflow-check}.ts,src/workflows/{registry,pin,inventory}.ts,src/reaper/{run-members,select}.ts,src/status/report.ts,src/install-cli.ts,src/cli.ts,src/system.ts}`; `reports/sp-0-probe.md`; Interface I6, I7, I8 | [mac-runtimes.md](mac-runtimes.md) |
| `ops` | VPS `/opt/crew-v3-spike` qua `crew/ops/*`; agent executor codex/opencode cho `repo-a` trên prod; `~/.crew/app/crew-mac` trên Mac mini | Fork `crew/ops/*`, `crew/release/verify.sh`; ledger R2-2 DP-1, R2-3 DP-1; `apps/crew-mac/src/install-cli.ts` | [fork.md](fork.md) |

## Ticket

| ID | Việc | Gói | Phụ thuộc | Model | Trạng thái |
|---|---|---|---|---|---|
| SP-0 | **Cổng G0.** Đo C1–C3, O1–O4, P1–P2 (spec §9) + chụp `ps -E -ww` của `codex exec`/`opencode run`; đúng 1 `opencode run`; viết `reports/sp-0-probe.md`; điền giá trị chờ đo vào Interface (vision, biến key, mẫu lỗi, P2) | `probe` | owner nạp key OpenCode Go vào Keychain | opus | chưa giao |
| AD-1 | P5: `codex_local` `sessionCodec` giữ `remoteExecution`; test; mục P5 `core-hooks.json`; `verify.sh` thêm test + `tsc` codex-local | `adapters` | — | sonnet | chưa giao |
| AD-2 | P6 + P7: `opencode_local` chạy `in_place` (không sync/restore workspace, không chép skills vào `$HOME`), `sessionCodec` giữ `remoteExecution`; test lệnh shell gửi target; mục P6, P7; `verify.sh` | `adapters` | AD-1 | opus | chưa giao |
| SV-1 | `CREW_RUNTIME_CATALOG`, `CREW_RUNTIME_ORDER`, `checkAgentAdapterOverrides(value, adapterType)`; H2/H4 tra `adapterType` của assignee; test | `policy` | G0 (vision), R2-3 SV-1 đã vào `crew/r2-3` | opus | chưa giao |
| SV-2 | Thân H1: `runtime-switch.ts` (đọc bảng plugin, mặc định, ép OFF opencode khi chưa có P6), `runtime-gate.ts` (giữ run, activity `crew.runtime_gate.waiting`), reconcile trước run fallback (`runtime-fallback.ts` + mở rộng `retry-progress.ts`: detach/bẩn), `cancelSuperseded` nếu G0 P2 cần; `description` H1 | `policy` | SV-1, G0 (P2) | opus | chưa giao |
| PL-1 | Migration `0006`; route `GET/PUT /runtime-switches` (board); `roles/api.ts` nhận 1–3 executor, mỗi runtime tối đa 1; bản chép catalog + test so khớp; `MachineReport.runtimes` tùy chọn; data `crew.runtimeDecisions`; nút gạt trên thẻ máy; ghi quyết định `select` khi `issue.created` có marker; capability `issues.wakeup`, `agents.read` | `plugin` | G0 (vision) | sonnet | chưa giao |
| PL-2 | `classifyRuntimeFailure`, `chooseFallback`, `applyFallback`; handler `agent.run.failed`; job `runtime-fallback` mỗi phút (audit `crew.runtime_gate.waiting`); test thuần + DB | `plugin` | PL-1, G0 (O4, P1) | opus | chưa giao |
| MR-1 | `assets/crew-run-mark.sh`, `assets/crew-codex-run.sh`, `assets/crew-opencode-run.sh`; `src/runtimes/{keychain,paths,command}.ts`; lệnh `crew-mac runtimes key opencode` + `runtimes status`; `setup` cài 2 wrapper; doctor `codex-auth`, `opencode-key`, `wrapper-codex`, `wrapper-opencode`; flow `mac-runtimes` | `mac-runtimes` | G0 (O2, C2), R2-3 MW-4 đã vào `r2-3` | opus | chưa giao |
| MR-2 | `workflow-check --runtime codex_local\|opencode_local`: chặn `.codex/**`, `.opencode/**`, `opencode.json[c]` không theo dõi, kiểm `CREW_SUPERPOWERS_DIR` checksum; `registry.ts` thêm runtime cho `superpowers` | `mac-runtimes` | MR-1 | opus | chưa giao |
| MR-3 | Bộ dọn: `isAgentPrint` (claude/codex/opencode) theo chuỗi `ps` thật từ SP-0; `select.ts` dùng hàm mới | `mac-runtimes` | MR-2 | sonnet | chưa giao |
| MR-4 | Bản tin `runtimes` (`src/status/runtimes.ts`): phiên bản, `codex login status`, quota Codex từ session jsonl, key có/không, `opencode stats` 1/7/30 ngày, model list; giới hạn kích thước | `mac-runtimes` | MR-3 | sonnet | chưa giao |
| AG-1 | `assistant.md`: bảng runtime/model, luật chọn, marker có `runtime=`, executor theo runtime; `executor.md`: mục runtime ngoài Claude (đọc `SKILL.md` ghim, comment fallback); test `instructions.test.mjs` (bảng khớp catalog, regex marker mới) | `agents` | SV-1, R2-3 AG-2 đã vào `crew/r2-3` | opus | chưa giao |
| AG-2 | `render-instructions.mjs` liệt kê executor kèm runtime; `merge-agent-config.mjs` nhận cấu hình codex/opencode; `crew/ops/create-runtime-executor.sh` tạo executor codex/opencode (body qua scp) + test | `agents` | AG-1 | sonnet | chưa giao |
| RV-1 | Review toàn nhánh `r2-4` + `crew/r2-4`; full suite repo Crew; `verify.sh` fork | — | AD-2, SV-2, PL-2, MR-4, AG-2 | opus | chưa giao |
| DP-1 | Deploy fork (vá chỉ khi Q1 duyệt), tag `crew/v3.4-rc1`; cài `crew-mac`, `setup` cài wrapper; tạo executor codex + opencode cho `repo-a`; `crew_project_roles` 3 executor; áp instructions; env `CREW_OPENCODE_IN_PLACE_PATCH=1` khi P6 đã deploy | `ops` | RV-1, R2-3 DP-1 | opus | chưa giao |
| AC-R2-4 | AC1–AC10 (spec §8); owner bật/tắt công tắc khoảng 5 phút | — | DP-1 | opus | chưa giao |

Không ticket nào ghi file của gói khác. Điểm nối chung:
- `apps/crew-mac/src/cli.ts`: MR-1 thêm nhánh `runtimes`; MR-2 thêm cờ `--runtime` trong nhánh `workflow-check` có
  sẵn.
- `crew/release/core-hooks.json`:
  - AD-1/AD-2 thêm mục P5–P7;
  - SV-1/SV-2 chỉ sửa `description` H1/H2/H4;
  - hai gói chạy tuần tự trên file này (AD trước, SV sau, Trợ Lý merge).

### Đợt chạy

| Đợt | Ticket | Ghi chú |
|---|---|---|
| 0 | SP-0 | **G0.** Trợ Lý đọc `reports/sp-0-probe.md`, ghi quyết định vào ledger: (a) C2 đạt → wrapper codex như I6; không đạt (restore lỗi khi thiếu file) → MR-1 tạo `auth.json` rỗng `{}` 0600 trong asset rồi xóa lúc thoát, và hỏi owner. (b) O2: biến/đường key chốt cho MR-1. Không cách nào đạt → OpenCode dừng ở R2-4, báo owner. (c) O3 không đạt → `opencode_local` chỉ nhận issue research (không commit), ghi `CREW_RUNTIME_ORDER` bỏ opencode khỏi mức code, hỏi owner. (d) O1: điền `vision` vào I1. (e) O4: mẫu quota/auth vào I5. (f) P1: nguồn `errorFamily`. (g) P2: có cần `cancelSuperseded`. Owner chưa nạp key → chạy C1–C3, O1, O4, P1, P2 trước; O2–O3 chờ |
| 1 | AD-1 → AD-2 (adapters) ∥ PL-1 → PL-2 (plugin) ∥ SV-1 → SV-2 (policy, khi R2-3 SV-1 đã vào `crew/r2-3`) | Test DB của PL và SV không chạy cùng lúc (Postgres nhúng). AD không cần DB |
| 2 | MR-1 → MR-2 → MR-3 → MR-4 (mac-runtimes) ∥ AG-1 → AG-2 (agents) | Bắt đầu khi R2-3 đã ff MW-4 vào `r2-3` và AG-2 vào `crew/r2-3`; Trợ Lý merge `r2-3`→`r2-4`, `crew/r2-3`→`crew/r2-4` trước |
| 3 | RV-1, rồi FX-n | FX theo gói của file bị sửa, model như ticket gốc |
| 4 | DP-1 | 0 run active. R2-3 DP-1 đã xong. Owner đã trả lời Q1 (không thì deploy không kèm P5–P7; OpenCode giữ OFF) |
| 5 | AC-R2-4 | Hẹn owner 5 phút (bật/tắt công tắc, xem thẻ máy) |

### Nhánh và worktree

- **Repo Crew** (`~/Documents/projects/crew`):
  - tích hợp `r2-4`, rẽ từ `r2-3` lúc bắt đầu Đợt 2;
  - gói `r24/mac-runtimes`, worktree `.worktrees/crew-r24-runtimes`.
- **Fork:**

  | Nhánh | Worktree | Rẽ từ | Ghi chú |
  |---|---|---|---|
  | `crew/r2-4` | `.worktrees/paperclip-r24-int` | `crew/r2-3` @ `f862b7b20` | tích hợp, `verify.sh`, deploy; Trợ Lý `git merge crew/r2-3` mỗi khi R2-3 ff |
  | `crew/r24-adapters` | `.worktrees/paperclip-r24-adapters` | `crew/r2-4` | AD-1, AD-2 |
  | `crew/r24-plugin` | `.worktrees/paperclip-r24-plugin` | `crew/r2-4` | PL-1, PL-2 |
  | `crew/r24-policy` | `.worktrees/paperclip-r24-policy` | `crew/r2-4` sau khi có R2-3 SV-1 | SV-1, SV-2 |
  | `crew/r24-agents` | `.worktrees/paperclip-r24-agents` | `crew/r2-4` sau khi có R2-3 AG-2 | AG-1, AG-2 |

- **Thư mục đo SP-0:** `~/crew-r24-probe/` trên Mac. Xóa cuối SP-0.
- **Gộp nhánh.**
  - Trợ Lý ff nhánh gói vào nhánh tích hợp sau khi đọc log test.
  - Merge (không rebase) khi nhánh tích hợp đã tiến.
  - Xung đột `docs/flows.yaml`/`docs/files.md` giải bằng hợp danh sách rồi `crew-docs generate`.
  - Xung đột `core-hooks.json` giữ cả hai mục.

### Phối hợp với R2-3 và R3

- **R2-3 sửa trước, R2-4 theo sau:**
  - repo Crew: `workflows/registry.ts`, `workflow-check`, `setup`, `doctor`, `cli.ts`, `reap.ts`;
  - fork: `issue-create-policy.ts`, `issue-policy.ts`, `crew/agents/{assistant,executor?,reviewer}.md`,
    `render-instructions.mjs`, `merge-agent-config.mjs`, `apply-roles.sh`.

  Các ticket R2-4 chạm những file này chỉ bắt đầu sau khi ticket R2-3 tương ứng đã ff vào nhánh tích hợp R2-3, và
  Trợ Lý đã merge sang nhánh R2-4. `CertifiedWorkflow.runtimes` của R2-3 (`readonly ['claude_local']`) được MR-2 nới
  thành `readonly CrewRuntime[]`.
- **Deploy:** R2-3 DP-1 trước, R2-4 DP-1 sau (deploy `crew/r2-4` chứa R2-3).
- **R3 (UI mới):**
  - R3 đọc `CREW_COMPLEXITY_MODEL`. SV-1 giữ export này (cột `claude_local` của catalog) nên WZ-1 không vỡ.
  - R3 nên dùng `CREW_RUNTIME_CATALOG`, route `GET/PUT /runtime-switches`, data `crew.runtimeDecisions` và
    `MachineReport.runtimes` cho trang máy và trang agent.
  - Wizard R3 hiện chỉ tạo `claude_local`. Thêm executor codex/opencode là việc của R3 sau R2-4.
  - Trợ Lý ghi các điểm này vào ledger R3 khi R2-4 DP-1 xong.

### Sở hữu file

| Ticket | Ghi |
|---|---|
| SP-0 | `reports/sp-0-probe.md`, `processes.md`, `sdd-ledger.md`; không file nguồn |
| AD-1 | Fork `packages/adapters/codex-local/src/server/index.ts` (P5), `packages/adapters/codex-local/src/server/session-codec.crew.test.ts`, mục P5 trong `crew/release/core-hooks.json`, 2 dòng `crew/release/verify.sh` |
| AD-2 | Fork `packages/adapters/opencode-local/src/server/{execute.ts,index.ts}` (P6, P7), `packages/adapters/opencode-local/src/server/{execute.in-place.crew.test.ts,session-codec.crew.test.ts}`, mục P6/P7, 2 dòng `verify.sh` |
| SV-1 | Fork `server/src/crew/{model-policy,issue-gate,issue-create-policy}.ts`, `server/src/__tests__/crew-{model-policy,issue-gate,issue-create-policy}.test.ts`, `description` H2/H4 |
| SV-2 | Fork `server/src/crew/{runtime-switch,runtime-gate,runtime-fallback}.ts` (mới), `server/src/crew/{load-gate,retry-progress}.ts`, `server/src/__tests__/crew-{runtime-gate,runtime-switch.db,runtime-fallback-reconcile,load-gate,retry-progress}.test.ts`, `description` H1 |
| PL-1 | Fork `packages/crew-plugin/migrations/0006_runtimes.sql`, `src/runtimes/{catalog,switches,decisions,api}.ts`, `src/roles/{api,data}.ts`, `src/machines/webhook.ts`, `src/ui/machines/**`, `src/manifest.ts`, 1 dòng `src/worker.ts`, test `src/__tests__/{runtimes-catalog,runtime-switches.db,runtime-decisions.db,roles.db,machines}.test.ts` |
| PL-2 | Fork `packages/crew-plugin/src/runtimes/{classify,choose,fallback}.ts`, 1 dòng `src/worker.ts`, `src/manifest.ts` (`jobs`), test `src/__tests__/{runtime-fallback,runtime-fallback.db}.test.ts` |
| MR-1 | `apps/crew-mac/assets/{crew-run-mark.sh,crew-codex-run.sh,crew-opencode-run.sh}`, `src/runtimes/{keychain,paths,command}.ts`, `src/wrapper.ts` (thêm 3 hằng nguồn), `src/commands/{setup,doctor}.ts`, 1 nhánh `case 'runtimes'` trong `src/cli.ts`, `src/index.ts`, test `test/{crew-codex-run,crew-opencode-run,runtimes-keychain,runtimes-command,setup,doctor}.test.ts`, `docs/flows/{mac-runtimes,mac-setup}.md`, khối `mac-runtimes`, `docs/files.md` |
| MR-2 | `src/workflows/{registry,runtime-sources}.ts`, `src/commands/workflow-check.ts`, `src/cli.ts` (cờ `--runtime` trong nhánh có sẵn), test `test/{workflow-check-runtime,workflows-registry}.test.ts`, `docs/flows/{mac-runtimes,mac-workflows}.md` |
| MR-3 | `src/reaper/{run-members,select}.ts`, test `test/{reaper-select,run-members}.test.ts`, fixture `test/fixtures/ps/{codex-exec,opencode-run}.txt`, `docs/flows/mac-orphan-reaper.md` |
| MR-4 | `src/status/{runtimes,report}.ts`, test `test/status-runtimes.test.ts`, `test/status-report.test.ts`, `docs/flows/mac-runtimes.md` |
| AG-1 | Fork `crew/agents/{assistant,executor}.md`, `crew/agents/instructions.test.mjs` |
| AG-2 | Fork `crew/agents/{render-instructions,merge-agent-config}.mjs` + `*.test.mjs`, `crew/ops/create-runtime-executor.sh`, `crew/ops/create-runtime-executor.test.mjs` |
| DP-1, AC-R2-4 | Ledger, `processes.md`, `reports/{dp-1,ac-r2-4}-report.md`; không file nguồn |

## Interface giữa các gói

**I1. Catalog runtime/model** (SV-1 tạo ở server; PL-1 chép sang plugin; AG-1 chép bảng vào `assistant.md`; mỗi bản có
test so khớp nguyên văn với bảng dưới).

```ts
// server/src/crew/model-policy.ts (giữ export cũ: CREW_COMPLEXITY_MODEL = cột claude_local, CREW_ALLOWED_MODELS, CREW_ALLOWED_EFFORTS)
export type CrewRuntime = "claude_local" | "codex_local" | "opencode_local";
export const CREW_RUNTIMES: readonly CrewRuntime[] = ["claude_local", "codex_local", "opencode_local"];
export type CrewComplexity = "trivial" | "small" | "medium" | "large";
export type CrewEffort = "low" | "medium" | "high";
export interface CrewRuntimeSpec {
  effortKey: "effort" | "modelReasoningEffort" | null;
  models: Readonly<Record<string, { vision: boolean }>>;
  byComplexity: Readonly<Partial<Record<CrewComplexity, { model: string; effort: CrewEffort | null }>>>;
}
export const CREW_RUNTIME_CATALOG: Readonly<Record<CrewRuntime, CrewRuntimeSpec>> = Object.freeze({
  claude_local: {
    effortKey: "effort",
    models: { "claude-sonnet-5": { vision: true }, "claude-opus-5": { vision: true } },
    byComplexity: {
      trivial: { model: "claude-sonnet-5", effort: "low" },
      small: { model: "claude-sonnet-5", effort: "medium" },
      medium: { model: "claude-sonnet-5", effort: "high" },
      large: { model: "claude-opus-5", effort: "high" },
    },
  },
  codex_local: {
    effortKey: "modelReasoningEffort",
    models: { "gpt-6-luna": { vision: true }, "gpt-6-sol": { vision: true } },
    byComplexity: {
      trivial: { model: "gpt-6-luna", effort: "low" },
      small: { model: "gpt-6-luna", effort: "medium" },
      medium: { model: "gpt-6-sol", effort: "high" },
    },
  },
  opencode_local: {
    effortKey: null,
    // vision theo SP-0 O1; mặc định false tới khi G0 ghi giá trị
    models: { "opencode-go/deepseek-v4-flash": { vision: false }, "opencode-go/kimi-k3": { vision: false }, "opencode-go/glm-5.3": { vision: false } },
    byComplexity: {
      trivial: { model: "opencode-go/deepseek-v4-flash", effort: null },
      small: { model: "opencode-go/kimi-k3", effort: null },
      medium: { model: "opencode-go/glm-5.3", effort: null },
    },
  },
});
export const CREW_RUNTIME_ORDER: Readonly<Record<CrewComplexity, readonly CrewRuntime[]>> = Object.freeze({
  trivial: ["opencode_local", "claude_local", "codex_local"],
  small: ["opencode_local", "claude_local", "codex_local"],
  medium: ["claude_local", "codex_local", "opencode_local"],
  large: ["claude_local"],
});
export function isCrewRuntime(value: unknown): value is CrewRuntime;
/** adapterType = adapter của assignee; null/khác ba runtime → luật claude_local như cũ. */
export function checkAgentAdapterOverrides(value: unknown, adapterType?: string | null): string[];
```

- Vi phạm model ghi `adapterConfig.model:<id>@<runtime>`. Key effort sai runtime ghi `adapterConfig.<key>`. Giá trị
  effort sai ghi `adapterConfig.<key>:<giá trị>`.
- Marker (AG-1 dạy Trợ Lý; PL-1 parse):
  `crew-model complexity=<c> runtime=<r> model=<m> effort=<low|medium|high|default> reason=<một dòng>`.
- Regex chung (server, plugin, test agents dùng đúng chuỗi này):

```ts
export const CREW_MODEL_LINE_RE =
  /^crew-model complexity=(trivial|small|medium|large)(?: runtime=(claude_local|codex_local|opencode_local))? model=(\S+) effort=(low|medium|high|default) reason=(.+)$/m;
```

**I2. Bảng plugin** (PL-1, migration `0006_runtimes.sql`).

```sql
CREATE TABLE plugin_crew_core_0433ea20b6.crew_runtime_switches (
  company_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  runtime text NOT NULL CHECK (runtime IN ('claude_local', 'codex_local', 'opencode_local')),
  enabled boolean NOT NULL,
  updated_by_user_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, environment_id, runtime)
);
CREATE TABLE plugin_crew_core_0433ea20b6.crew_runtime_decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('select', 'fallback', 'fallback_refused')),
  run_id uuid,
  from_agent_id uuid,
  to_agent_id uuid,
  from_runtime text,
  to_runtime text,
  model text,
  complexity text,
  trigger text CHECK (trigger IS NULL OR trigger IN ('quota', 'auth', 'unavailable', 'switch_off')),
  reason text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crew_runtime_decisions_run_kind_uq ON plugin_crew_core_0433ea20b6.crew_runtime_decisions (run_id, kind) WHERE run_id IS NOT NULL;
CREATE UNIQUE INDEX crew_runtime_decisions_select_uq ON plugin_crew_core_0433ea20b6.crew_runtime_decisions (issue_id) WHERE kind = 'select';
CREATE INDEX crew_runtime_decisions_issue_idx ON plugin_crew_core_0433ea20b6.crew_runtime_decisions (company_id, issue_id, decided_at);
-- executor 1–3 (lệch 6): thay CHECK cardinality cũ bằng CHECK có tên
```

**I3. Công tắc** (PL-1 ghi; SV-2 đọc).
- Plugin route, chỉ board, theo khuôn `roles/api.ts`:

```
GET  /runtime-switches?companyId=<uuid>
  → 200 { environments: Array<{ environmentId: string; runtimes: Record<CrewRuntime, { enabled: boolean; updatedAt: string | null; updatedByUserId: string | null }> }> }
     environmentId lấy từ defaultEnvironmentId của agent executor trong crew_project_roles của company (agents.read)
PUT  /runtime-switches  body { companyId, environmentId, runtime, enabled }
  → 200 { ok: true }; 403 "Chỉ board được bật/tắt runtime"; 400 khi sai dạng
     audit `crew.runtime_switch.set` { environmentId, runtime, before, after, actorUserId }
```

- Server:

```ts
// server/src/crew/runtime-switch.ts
export const CREW_RUNTIME_SWITCH_DEFAULTS: Readonly<Record<CrewRuntime, boolean>> = { claude_local: true, codex_local: false, opencode_local: false };
export const CREW_OPENCODE_IN_PLACE_PATCH_ENV = "CREW_OPENCODE_IN_PLACE_PATCH";
export function crewRuntimeSwitchesTable(): string; // `${derivePluginDatabaseNamespace("crew.core")}.crew_runtime_switches`
export async function readRuntimeSwitch(db: CrewRolesDb, input: { companyId: string; environmentId: string; runtime: CrewRuntime }): Promise<boolean>;
// opencode_local luôn false khi process.env[CREW_OPENCODE_IN_PLACE_PATCH_ENV] !== "1".
// to_regclass null hoặc lỗi SQL → mặc định, log warn tối đa 1 lần/phút/company.
```

**I4. Thân H1** (SV-2).

```ts
// server/src/crew/runtime-gate.ts
export interface RuntimeGateDeps {
  loadAgent(agentId: string): Promise<{ companyId: string; adapterType: string; defaultEnvironmentId: string | null } | null>;
  isCrewCompany(companyId: string): Promise<boolean>;          // loadCrewCompanyConfig(...).kind === "ok"
  switchOn(input: { companyId: string; environmentId: string; runtime: CrewRuntime }): Promise<boolean>;
  hasWaitingMarker(runId: string): Promise<boolean>;
  recordWaiting(run: BeforeClaimInput["run"], details: { runtime: CrewRuntime; environmentId: string; issueId: string | null }): Promise<void>; // activity crew.runtime_gate.waiting
  cancelSuperseded?(run: BeforeClaimInput["run"]): Promise<boolean>; // chỉ khi G0 P2 = stock không tự hủy
}
export async function evaluateRuntimeGate(input: BeforeClaimInput, deps: RuntimeGateDeps): Promise<boolean>; // true = giữ queued
export function defaultRuntimeGateDeps(db: Db): RuntimeGateDeps;

// server/src/crew/runtime-fallback.ts
export const CREW_RUNTIME_FALLBACK_WAKE_REASON = "crew_runtime_fallback";
/** Run của agent đích sau fallback: run cũ lấy từ crew_runtime_decisions (kind 'fallback', to_agent_id = run.agentId, issue = run.contextSnapshot.issueId, mới nhất). */
export async function fallbackPreviousRunId(db: CrewRolesDb, run: BeforeClaimInput["run"]): Promise<string | null>;
```

- `crewBeforeClaim` mới, theo thứ tự:
  1. load gate (giữ nguyên);
  2. `evaluateRuntimeGate`;
  3. retry/fallback progress.

  Bước 3: `previousRunId = run.retryOfRunId ?? (wakeReason === CREW_RUNTIME_FALLBACK_WAKE_REASON ? await fallbackPreviousRunId(...) : null)`.
- `retry-progress.ts`:
  - `buildRetryProgressCommand(previousRunId, cwd, { detachBranch?: string })`. Khi có `detachBranch`, thêm bước:
    nếu `git -C cwd symbolic-ref --short HEAD` = `detachBranch` và `git status --porcelain` rỗng thì
    `git switch --detach`.
  - In `crew-retry-detach=done|dirty|other-branch`.
  - `RetryProgress.checked` thêm `detach: "done" | "dirty" | "other-branch" | null`.
- Comment fallback bắt đầu bằng `Crew: chuyển runtime sau run \`<id>\``, phần commit cùng dạng retry-progress.
- `dirty` → comment câu trong spec §7.4, `blockIssue`, `scheduleCancel(run.id, "crew_runtime_fallback_dirty")`, trả
  `true`.
- Marker activity: `crew.runtime_fallback.checked`, `crew.runtime_fallback.comment`.

**I5. Fallback trong plugin** (PL-2).

```ts
// packages/crew-plugin/src/runtimes/classify.ts
export type FailureClass = "quota" | "auth" | "unavailable" | "other";
export function classifyRuntimeFailure(input: { adapterType: string; errorCode: string | null; errorFamily: string | null; message: string | null }): FailureClass;
// quota: errorFamily === "provider_quota" || errorCode === "provider_quota" || (adapterType === "opencode_local" && OPENCODE_QUOTA_RE.test(message))
// auth: /_auth_required$|_auth_failed$/.test(errorCode) || /crew-runtime blocked: thiếu key/.test(message) || OPENCODE_AUTH_RE.test(message) (opencode)
// unavailable: errorCode === "adapter_engine_unavailable" || /command not found|ENOENT/.test(message)
// còn lại: other.
// OPENCODE_QUOTA_RE, OPENCODE_AUTH_RE: điền theo SP-0 O4 (chuỗi nguyên văn trong reports/sp-0-probe.md).

// packages/crew-plugin/src/runtimes/choose.ts
export type FallbackTrigger = "quota" | "auth" | "unavailable" | "switch_off";
export interface FallbackCandidate { agentId: string; name: string; runtime: CrewRuntime; environmentId: string | null; status: string }
export interface RuntimeHealth { usable: boolean }   // từ MachineReport.runtimes (I8); thiếu bản tin → usable true
export const MAX_FALLBACKS_PER_ISSUE = 2;
export type FallbackChoice =
  | { kind: "fallback"; toAgentId: string; toAgentName: string; toRuntime: CrewRuntime; model: string; effort: CrewEffort | null; reason: string }
  | { kind: "refused"; reason: string };
export function chooseFallback(input: {
  complexity: CrewComplexity; hasImages: boolean; trigger: FallbackTrigger;
  from: { agentId: string; runtime: CrewRuntime; environmentId: string };
  candidates: FallbackCandidate[];
  switches: Readonly<Record<CrewRuntime, boolean>>;
  health: Readonly<Partial<Record<CrewRuntime, RuntimeHealth>>>;
  tried: readonly CrewRuntime[];            // runtime đã chạy issue này (from + to của các quyết định fallback trước)
  fallbacksSoFar: number;
}): FallbackChoice;

// packages/crew-plugin/src/runtimes/fallback.ts
export async function applyFallback(ctx: PluginContext, input: { companyId: string; issueId: string; runId: string; agentId: string; trigger: FallbackTrigger }): Promise<"applied" | "duplicate" | "refused" | "skipped">;
export function registerRuntimeFallback(ctx: PluginContext): void; // events.on("agent.run.failed") + job "runtime-fallback" mỗi phút
```

- Câu `reason` (tiếng Việt cố định), theo `trigger`:
  - `quota` → `hết quota`;
  - `auth` → `chưa đăng nhập hoặc thiếu key`;
  - `unavailable` → `runtime không chạy được trên máy`;
  - `switch_off` → `runtime đang tắt trên máy`.
- Comment fallback:
  `Crew: chuyển từ <from_runtime> (<from_agent>) sang <to_runtime> (<to_agent>), model <model>. Lý do: <reason>. Nhánh và commit của run trước được giữ.`
- Comment từ chối:
  `Crew: không chuyển runtime cho run \`<runId>\`: <lý do>.`. Lý do là một trong:
  - `mức large chỉ chạy Claude`;
  - `đã chuyển 2 lần`;
  - `không còn runtime nào bật, đã đăng nhập và đủ quota trên máy này`;
  - `issue có ảnh, không còn model đọc được ảnh`.
- Sau khi từ chối:
  - trigger ≠ `switch_off` → `issues.update(status "blocked")`;
  - `switch_off` → giữ `queued`, comment một lần (`fallback_refused` có `run_id`).
- `applyFallback` dừng (`skipped`) khi:
  - issue không có policy Crew;
  - issue `done`/`cancelled`;
  - `assigneeAgentId ≠ agentId`;
  - agent không thuộc `executor_agent_ids` của project;
  - `adapterType` ngoài ba runtime.

**I6. Wrapper trên Mac** (MR-1 tạo; AG-2 ghi `command` vào agent; SP-0 chốt chi tiết O2).
- Đường cài:
  - `~/.crew/bin/crew-codex-run`, `~/.crew/bin/crew-opencode-run`;
  - `~/.crew/bin/crew-run-mark.sh` (hai wrapper `.` nạp bằng đường tuyệt đối tính từ `$0`).
- Thoát 78 với dòng stderr bắt đầu `crew-runtime blocked:` hoặc `crew-workflow blocked:`. Không in giá trị env nào.
- `PAPERCLIP_AGENT_ID` phải khớp UUID, không thì thoát 78 `crew-runtime blocked: thiếu PAPERCLIP_AGENT_ID`.
- **Codex:**
  - `CODEX_HOME` mới `~/.crew/runtimes/codex/<agentId>/` (0700), gồm:
    - `config.toml` (chép, 0600);
    - `skills` → symlink asset;
    - `auth.json` → symlink `$HOME/.codex/auth.json`;
    - `sessions/` giữ lại.
  - Asset gốc (`$CODEX_HOME` adapter đưa vào) **không bị thêm file nào**.
  - Thiếu `$HOME/.codex/auth.json` → 78 `crew-runtime blocked: Codex chưa đăng nhập trên máy (chạy "codex login" trong phiên desktop)`.
- **OpenCode:**
  - Keychain service `crew.opencode-go`, account `crew`.
  - Đọc qua `${CREW_SECURITY_BIN:-/usr/bin/security} find-generic-password -s crew.opencode-go -a crew -w`. Biến
    `CREW_SECURITY_BIN` chỉ cho test.
  - Key vào env `CREW_OPENCODE_GO_KEY`, hoặc biến khác do G0 O2 chốt.
  - `OPENCODE_CONFIG_CONTENT` như spec §4.2.
  - `XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME` = `~/.crew/runtimes/opencode/<agentId>/{data,state,cache}`.
- Cả hai export `CREW_SUPERPOWERS_DIR` = thư mục ghim Superpowers hiện hành (`superpowersPinDir(home)`), ghi lúc
  `setup` vào `~/.crew/runtimes/superpowers-dir`.

**I7. Vá adapter** (AD-1, AD-2). Mục mới trong `crew/release/core-hooks.json`:

```json
{ "id": "P5", "kind": "adapter-patch", "file": "packages/adapters/codex-local/src/server/index.ts", "symbol": "sessionCodec.serialize/deserialize",
  "anchor": "      ...(remoteExecution ? { remoteExecution } : {}),", "occurrences": 2,
  "description": "Session codec keeps remoteExecution so SSH runs can resume their Codex session.", "upstreamPr": null,
  "tests": ["packages/adapters/codex-local/src/server/session-codec.crew.test.ts"] },
{ "id": "P6", "kind": "adapter-patch", "file": "packages/adapters/opencode-local/src/server/execute.ts", "symbol": "execute (inPlaceRoot)",
  "anchor": "  const inPlaceRoot = executionTarget?.workspaceRealization?.mode === \"in_place\"",
  "description": "opencode_local runs in the authoritative root for in_place realization: no workspace upload/restore and no copy into the remote $HOME/.claude/skills.", "upstreamPr": null,
  "tests": ["packages/adapters/opencode-local/src/server/execute.in-place.crew.test.ts"] },
{ "id": "P7", "kind": "adapter-patch", "file": "packages/adapters/opencode-local/src/server/index.ts", "symbol": "sessionCodec.serialize/deserialize",
  "anchor": "      ...(remoteExecution ? { remoteExecution } : {}),", "occurrences": 2,
  "description": "Session codec keeps remoteExecution so SSH runs can resume their OpenCode session.", "upstreamPr": null,
  "tests": ["packages/adapters/opencode-local/src/server/session-codec.crew.test.ts"] }
```

**I8. Bản tin máy `runtimes`** (MR-4 gửi; PL-1 kiểm và lưu; PL-2 đọc `usable`).

```ts
export interface RuntimesReport {
  codex: { version: string | null; loggedIn: boolean | null; primaryUsedPct: number | null; resetsAt: string | null };
  opencode: { version: string | null; keyPresent: boolean | null; costDay: number | null; costWeek: number | null; costMonth: number | null; models: string[] };
}
// MachineReport.runtimes?: RuntimesReport — tùy chọn như `app`: sai dạng thì bỏ riêng trường này.
// Giới hạn: version ≤ 50 ký tự, models ≤ 60 phần tử, mỗi id ≤ 120 ký tự, ^[a-z0-9._/-]+$; số ≥ 0, ≤ 100000; primaryUsedPct 0..100.
// usable (plugin): codex = loggedIn !== false && (primaryUsedPct ?? 0) < 99;
//                  opencode = keyPresent !== false && (costDay ?? 0) < 12 && (costWeek ?? 0) < 30 && (costMonth ?? 0) < 60;
//                  claude = report.claude.loggedIn !== false.
```

---

## Nghiệm thu (AC-R2-4)

- Làm trên Mac mini thật với Paperclip prod bản DP-1, project `repo-a`.
- Bằng chứng (lệnh, đầu ra rút gọn, giờ theo `date`) ghi [sdd-ledger.md](sdd-ledger.md) và
  `reports/ac-r2-4-report.md`.
- Trước mỗi run OpenCode/Codex ghi `opencode stats --days 1 --models` và `crew-mac runtimes status`.

**Chuẩn bị (không tốn run):**
- `active-runs.sh` rỗng; backup.
- Owner bật `opencode_local` và `codex_local` cho environment của Mac mini (route I3 qua UI plugin).
- `crew-mac doctor` có `codex-auth`, `opencode-key`, `wrapper-codex`, `wrapper-opencode` đạt.
- Checksum `~/.claude/skills`: `crew-mac runtimes skills-checksum` (MR-1 thêm, in sha256 cây, không in nội dung). Ghi
  giá trị.

**Lượt 1 (Trợ Lý 1 run Claude → executor OpenCode 1 run → reviewer Claude 1 run).** Owner tạo yêu cầu trong `repo-a`:
"Thêm dòng `Crew R2-4 OpenCode` vào cuối README.md. Một việc, không làm gì khác."
- [ ] **AC1:**
  - Issue con có marker `crew-model complexity=trivial runtime=opencode_local model=opencode-go/deepseek-v4-flash effort=default reason=…`.
  - `crew_runtime_decisions` có dòng `select`.
  - Executor OpenCode commit trên `crew/<id>` trong worktree **của executor OpenCode** (`git -C <worktree> log -1`),
    có comment `crew-commit … result=pass`.
  - Reviewer Claude duyệt.
  - Owner hủy gốc sau review để khỏi chạy integrator.
- [ ] **AC2:** `crew-mac runtimes skills-checksum` sau lượt 1 bằng giá trị trước.

**Lượt 2 (Codex 1 run → reviewer Claude 1 run).** Ops script tạo issue gốc trong `repo-a` giao thẳng executor codex:
mô tả "Thêm dòng `Crew R2-4 Codex` vào cuối README.md", có marker
`crew-model complexity=trivial runtime=codex_local model=gpt-6-luna effort=low reason=nghiệm thu codex`.
- [ ] **AC3:**
  - Run xong, có `crew-commit`.
  - `docker exec <server> sh -c 'ls -la ~/.codex 2>/dev/null; find / -name auth.json -path "*codex*" 2>/dev/null | head'`
    không có file mới trong khung giờ AC.
  - `docker logs --since <bắt đầu>` không có `access_token`/`refresh_token`.
- [ ] **AC4:**
  - Khi run lượt 2 đang chạy, owner tắt `codex_local`. Run vẫn xong.
  - Ops script tạo issue thứ hai giao executor codex, marker `complexity=medium runtime=codex_local model=gpt-6-sol`.
  - Run của nó nằm `queued`, có activity `crew.runtime_gate.waiting`.
- [ ] **AC5:**
  - Trong ≤ 2 phút, issue thứ hai được chuyển sang executor Claude (thứ tự medium: claude trước).
  - Có comment `Crew: chuyển từ codex_local …`, dòng `fallback` `trigger=switch_off`, comment
    `Crew: chuyển runtime sau run …`.
  - Run Claude chạy trên Mac mini (1 run). Owner hủy issue sau khi run bắt đầu commit, hoặc để xong.
- [ ] **AC6:** `pnpm --filter @crew/paperclip-plugin exec vitest run src/__tests__/runtime-fallback.db.test.ts` xanh
  trên `crew/r2-4` (ca quota, idempotent, large refused). Báo cáo ghi rõ quota thật không tái hiện trên prod.
- [ ] **AC7:**
  - `POST /api/companies/<c>/issues` (actor agent Trợ Lý, qua `api.sh`, body qua stdin) giao executor OpenCode với
    `assigneeAdapterOverrides.adapterConfig.model = "claude-opus-5"` trả 422.
  - `violations` có `adapterConfig.model:claude-opus-5@opencode_local`.
- [ ] **AC8:**
  - Owner chạy `crew-mac runtimes key-fingerprint opencode`: MR-1 in sha256 rút gọn 12 ký tự của key, không in key.
  - Trợ Lý không thấy key. Owner tự grep key trên `~/.crew/logs`, `~/.crew/runtimes/opencode`, transcript run lượt 1
    tải về, log container VPS khung giờ AC, rồi báo số dòng: phải là 0.
  - `ps -E -ww` chụp lúc run lượt 1 không có `CREW_OPENCODE_GO_KEY=` trong argv. Env thì có, đúng thiết kế; ảnh chụp
    chỉ ghi tên biến.
- [ ] **AC9:**
  - `node crew/release/check-core-hooks.mjs` báo H1–H5, P1–P7. `base` = `v2026.1005.0`.
  - `git diff crew/r2-3..crew/r2-4 --stat` chỉ trong phạm vi Global Constraints.
- [ ] **AC10:**
  - Thẻ máy hiện ba runtime (phiên bản, đăng nhập/key, quota ước tính).
  - Owner gạt `opencode_local` OFF rồi ON. Audit có 2 dòng `crew.runtime_switch.set`.
- [ ] **Dọn:**
  - Hủy các issue AC. 0 run active. `processes.md` không còn `đang chạy`.
  - Công tắc để theo ý owner (mặc định Q4: tắt codex/opencode sau AC nếu owner không nói khác).
  - Tag `crew/v3.4` cục bộ. Push chỉ khi owner nói "push".

## Self-review

Trợ Lý tự review 10/10/2026 sau khi viết plan và các file chi tiết.

- **Phủ spec:**

  | Mục spec | Ticket |
  |---|---|
  | §1.1 | AD-1, AD-2, MR-1, AG-2, DP-1 |
  | §1.2 | PL-1 (I2, I3), SV-2 (I4) |
  | §1.3 | SV-1 (I1), AG-1, PL-1 (`select`) |
  | §1.4 | PL-2 (I5), SV-2 (reconcile) |
  | §1.5 | Global Constraints, I7 |
  | §4.1 | PL-1 (executor 1–3), AG-2 |
  | §4.2 | MR-1 (I6) |
  | §4.3 | MR-2, AG-1 |
  | §4.4 | MR-3 |
  | §5 | PL-1, SV-2 |
  | §6.1–6.4 | SV-1, PL-1, AG-1 |
  | §6.5 | AD-1, AD-2 |
  | §7 | PL-2, SV-2 |
  | §8 | mục Nghiệm thu |
  | §9 | SP-0 |
  | §11 Q1–Q5 | "Còn chờ owner" |

- **Mỗi ticket một gói:** cột "Gói" có đúng một giá trị.
  - `core-hooks.json` do `adapters` (mục P) và `policy` (`description`) sửa tuần tự, có ghi ở điểm nối chung.
  - `cli.ts` do MR-1, MR-2 cùng gói sửa.
- **Placeholder:** giá trị chỉ biết sau G0 (`vision`, biến key OpenCode, `OPENCODE_QUOTA_RE`/`OPENCODE_AUTH_RE`,
  nguồn `errorFamily`, `cancelSuperseded`) đều có luật điền ở SP-0 và Đợt 0. Không còn `TBD`/`TODO`.
- **Nhất quán tên giữa plan, `probe.md`, `fork.md`, `mac-runtimes.md`:**
  - catalog: `CREW_RUNTIME_CATALOG`, `CREW_RUNTIME_ORDER`, `CREW_MODEL_LINE_RE`, `checkAgentAdapterOverrides(value, adapterType)`;
  - công tắc: `readRuntimeSwitch`, `CREW_RUNTIME_SWITCH_DEFAULTS`;
  - H1: `evaluateRuntimeGate`, `fallbackPreviousRunId`, `CREW_RUNTIME_FALLBACK_WAKE_REASON`;
  - plugin: `classifyRuntimeFailure`, `chooseFallback`, `applyFallback`, `registerRuntimeFallback`,
    `MAX_FALLBACKS_PER_ISSUE`;
  - Mac: `RuntimesReport`, wrapper `crew-codex-run`/`crew-opencode-run`/`crew-run-mark.sh`, Keychain
    `crew.opencode-go`/`crew`;
  - bảng: `crew_runtime_switches`, `crew_runtime_decisions`.
- **Review Focus:**

  | Mục | Ticket |
  |---|---|
  | 1 | MR-1, MR-4 |
  | 2 | AD-2 |
  | 3 | PL-2 |
  | 4 | SV-2 |
  | 5 | SV-2 |

## Còn chờ owner

1. **Q1 vá P5–P7.** Plan làm AD-1/AD-2, DP-1 chỉ deploy khi owner duyệt.
   - Không duyệt P6 → `opencode_local` khóa OFF (env `CREW_OPENCODE_IN_PLACE_PATCH` không đặt), bỏ AC1, AC2, AC8,
     không có OpenCode ở R2-4.
   - Không duyệt P5/P7 → bỏ vá đó, executor codex/opencode chạy session mới mỗi issue. Ghi rõ trong instructions:
     không gói nhiều issue cho runtime đó.
2. **Q2 bảng model.** Đổi thì sửa I1 (SV-1, PL-1, AG-1 và ba test so khớp).
3. **Q3 fallback.** Đổi thì sửa `chooseFallback`, `classifyRuntimeFailure`, `MAX_FALLBACKS_PER_ISSUE` (PL-2), AC5,
   AC6.
4. **Q4 mặc định công tắc.** Đổi thì sửa `CREW_RUNTIME_SWITCH_DEFAULTS` (SV-2) và mặc định GET (PL-1).
5. **Q5 vai trò/số executor.** Đổi thì sửa migration `0006`, `roles/api.ts` (PL-1), `assistant.md` (AG-1), DP-1.
6. **Key OpenCode Go vào Keychain** (`crew-mac runtimes key opencode` có sau MR-1; SP-0 cần trước đó). SP-0 dùng
   `security add-generic-password -U -s crew.opencode-go -a crew -w`, owner tự gõ trong Terminal. Chưa có thì SP-0
   chạy phần không cần key, O2/O3 chờ.
7. **Tài khoản Codex** từng trả 400 ngày 08/10. SP-0 C1 chỉ kiểm đăng nhập, không chạy model. Nếu AC3 vẫn 400 thì
   AC3/AC4 dừng, ghi nguyên văn lỗi, hỏi owner.
