---
title: "Crew v3 R2-3 — BMAD: cài, ghim, cách ly; đề xuất epic/story qua Trợ Lý"
description: "Mọi Mac có bản BMAD ghim (bmad-plugins d009608, 6.13.0-next) cạnh Superpowers; run chỉ nạp đúng một workflow đã chứng nhận, chặn nạp chéo qua enabledPlugins và _bmad/; dấu .in_use và GC bản cũ; crew-mac bmad stories/setup-project; Trợ Lý giao issue con crew-kind bmad cho agent BMAD, owner duyệt ở stage approval (thân H4), rồi mỗi story thành một issue con Superpowers. Không thêm hook, không sửa lõi, không đụng UI."
status: pending
priority: P1
effort: 4d
branch: r2-3
tags: [crew-v3, bmad, crew-mac, workflows, isolation, h4, assistant]
created: 2026-10-10
---

# Crew v3 R2-3 — BMAD — Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mọi Mac có bản BMAD ghim cạnh bản Superpowers ghim. Run của agent BMAD chỉ nạp BMAD ghim, run khác chỉ nạp
Superpowers ghim. Với yêu cầu cần epic/story, Trợ Lý giao một issue con cho agent BMAD; agent BMAD dùng skill chính thức
của BMAD ra file epic/story; owner duyệt; Trợ Lý biến mỗi story thành một issue con cho executor Superpowers.

**Architecture:**
- **Mac (repo Crew, `apps/crew-mac`).** Tổng quát hóa phần ghim Superpowers thành sổ workflow đã chứng nhận
  (`registry.ts`). Thêm bản ghim BMAD lắp từ hai cây skill của `bmad-plugins` thành một plugin `bmad`. `workflow-check`
  nhận thư mục ghim của đúng một workflow, chặn nạp chéo qua `enabledPlugins` và kiểm `_bmad/` cho run BMAD. Wrapper
  ghi dấu `.in_use/<runId>`; `gcWorkflowPins` dọn bản cũ. Lệnh mới `crew-mac workflows list|install|gc` và
  `crew-mac bmad stories|setup-project`.
- **Fork (`crew/r2-3`).** Thân H4: issue con do agent tạo có dòng `crew-kind bmad` nhận template
  `[review reviewer, approval owner]`. Instructions mới `crew/agents/bmad.md`; Trợ Lý có mục chọn workflow và tạo
  story; reviewer có mục duyệt commit BMAD; script vai trò nhận vai `bmad`.
- **Không đổi:** plugin `crew.core`, UI, `apps/mac-app`, lõi Paperclip, bản ghim Superpowers, luật "đúng một
  `--plugin-dir`" của wrapper.

**Tech Stack:**
- `@crew/mac`: Node ≥ 22 ESM, TypeScript 7, Vitest, Biome 2.5. Lệnh hệ thống `/usr/bin/git`, `tar`, `uv` (0.12.x, ở
  `~/.local/bin`).
- Fork Paperclip `v2026.1005.0`: Express + Drizzle; test `vitest` (server), `node --test` (`crew/agents`).
- BMAD: `https://github.com/bmad-code-org/bmad-plugins.git` @ `d009608292d8a2ea4df846de7dca2f0d78a9e22d` (6.13.0-next).

**Spec:** [2026-10-10-crew-v3-r2-3-bmad-design.md](../../docs/superpowers/specs/2026-10-10-crew-v3-r2-3-bmad-design.md).
Câu hỏi cho owner ở spec §11; plan này **tạm theo phương án khuyên** của cả 5 câu (mục "Còn chờ owner" cuối file ghi
ticket bị ảnh hưởng nếu owner đổi). Khuôn plan: [R2-2](../261009-1945-crew-v3-r2-2/plan.md).

**Hiện trạng (10/10/2026 00:42, theo `date`):**
- Repo Crew: `v3` @ `32fe7c7` (plan/spec). Nhánh tích hợp R2-2 `r2-2` @ `a0e8ed8` (đã deploy phần Mac lên Mac mini, chờ
  AC R2-2 sáng 10/10). `apps/crew-mac/src/workflows/**` ghim Superpowers 6.4.1; flow `mac-workflows`.
- Fork: `crew/r2-2` @ `f862b7b20` đang chạy prod (image `v3-f862b7b20`, mốc rollback `20261010-003110` về
  `v3-c301d7608`). Hook 5/5.
- Mac mini: `~/.claude/plugins/marketplaces/bmad` HEAD `d009608`; owner chưa cài plugin BMAD; `uv` 0.12.13.
- R3 (UI mới) đang lập kế hoạch song song ở `plans/261010-0020-crew-v3-r3/`.

## Global Constraints

- **Paperclip ghim `v2026.1005.0`.** Không nâng upstream, không chạy `crew/release/upgrade.sh`. `core-hooks.json` giữ
  `base: v2026.1005.0`.
- **Hook lõi 5/5, không thêm hook.** Fork chỉ được sửa: `server/src/crew/{issue-create-policy,issue-policy}.ts`,
  `server/src/__tests__/crew-issue-create-policy.test.ts`, `server/src/__tests__/crew-issue-gate.test.ts`,
  `crew/release/core-hooks.json` (chỉ `description` của H4), `crew/agents/**`. Việc nào buộc sửa file khác của fork thì
  dừng, ghi ledger, hỏi owner.
- **Không đụng UI:** không sửa `ui/**`, `packages/crew-plugin/**`, `apps/mac-app/**` (R3 đang lập kế hoạch; R2-3 không
  cần plugin vì `checks` của báo cáo máy đã chở check doctor mới lên thẻ máy).
- **Nhánh.**
  - Repo Crew: nhánh tích hợp `r2-3` rẽ từ `r2-2` @ `a0e8ed8`. R2-2 còn đổi (FX của AC) thì Trợ Lý `git merge r2-2`
    vào `r2-3`, không rebase nhánh dùng chung.
  - Fork: nhánh tích hợp `crew/r2-3` rẽ từ `crew/r2-2` @ `f862b7b20`.
- **Worker chỉ là agent Claude.** sonnet cho việc bám khuôn (MW-3, MW-4, AG-2). opus cho: đo (SP-0), ghim/nguồn tải
  (MW-1), cách ly (MW-2), gate (SV-1), instructions hành vi (AG-1), review (RV-1), deploy prod tạo agent mới (DP-1),
  nghiệm thu (AC-R2-3). Không Codex, không fable, không haiku.
- **SP-0 là cổng G0.** Không ticket code nào bắt đầu trước khi `probe-report.md` có kết quả A1–A5 và Trợ Lý ghi quyết
  định G0 vào ledger. Giá trị mà ticket sau chép nguyên (checksum, `executables`, dạng JSON câu hỏi của `setup.py`)
  lấy từ `probe-report.md`, không tự tính lại.
- **Deploy prod** chỉ qua `crew/ops/*` như DP-1 R2-2: `active-runs.sh` rỗng → backup → `overlay-source.sh`/
  `overlay-job.sh`/`deploy.sh` → ghi mốc rollback → kiểm `https://crew.2p-solutions.com/api/health` `status ok`, plugin
  `crew.core` `ready`, `https://2p-solutions.com` và `https://kidyschool.com` 200. Hỏng thì `rollback.sh <TS>` ngay.
  Cài `crew-mac` lên Mac mini chỉ khi 0 run active.
- **Push** repo Crew và fork chỉ khi owner nói "push". Tag fork: ứng viên `crew/v3.3-rcN`, chốt `crew/v3.3` sau AC. Không
  tag `v*`.
- **Quota Claude dùng chung với owner.**
  - SP-0: tối đa 3 lệnh `claude -p` (model `claude-sonnet-5`, `--max-turns` ≤ 3), không run Paperclip.
  - AC: đúng 2 yêu cầu thật (mục Nghiệm thu), ước 6–8 run. Không chạy `claude -p` thử ngoài các lần trên.
  - Dừng dispatch khi quota tuần còn 1% (bộ nhớ dự án), giữ quota viết bàn giao.
- **Mac mini dùng chung.** Một việc nặng một lúc. Mọi process nền, thư mục tạm, bản ghi tạm trên prod ghi vào
  [processes.md](processes.md) (lệnh, PID, cổng, worktree, cách dừng/gỡ). Thư mục tạm trên Mac không đặt dưới `/Volumes`,
  `~/Desktop`, `~/Downloads`, `~/Documents` (TCC): dùng `~/crew-r23-probe/`.
- **Bài học R2-1/R2-2 (bắt buộc).**
  - Body gửi VPS đi qua `scp` hoặc stdin; không nhúng nội dung vào chuỗi lệnh `ssh`.
  - Agent `claude_local` mới: `adapterConfig.engine = "cli"`, `model` rõ, `env: {}`, `maxConcurrentRuns = 1`, command là
    wrapper tuyệt đối `<home>/.crew/bin/crew-claude-run`.
  - Issue thử trong company có policy phải tự chốt `done`/`blocked`, nếu không workflow `crew.core` tự chạy thêm run.
    Agent/project đã có run không xóa được (FK `cost_events`): dọn bằng `terminate`/`archive`.
  - Giờ trong ledger, comment, báo cáo lấy theo `date`.
  - Trợ Lý chỉ ff nhánh tích hợp sau khi đọc log test của ticket. Output file của tool agent nền không phản ánh tiến độ
    (RV-1 R2-2): mỗi agent ghi dòng "bắt đầu" vào ledger khi nhận việc; không giao lại khi chưa hỏi.
  - Test Postgres nhúng: kiểm `ipcs -m` trước, một file một lúc.
- **Vòng mỗi ticket:** implementer (agent mới, model của ticket) → reviewer (agent mới, cùng model; đọc diff và log test,
  đối chiếu Interface, Review Focus, Global Constraints) → Trợ Lý ghi ledger và ff. Trả
  `Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`.
- **Test theo tầng.** Implementer: test phần đổi, typecheck package, `pnpm exec biome check apps/crew-mac docs` (repo
  Crew) hoặc `biome`/`tsc` trên file đổi (fork). Full suite (`pnpm -r test`, `pnpm -r typecheck`, `pnpm lint`;
  fork `crew/release/verify.sh`) chỉ ở RV-1 và DP-1. Run thật chỉ ở AC.
- **Docs repo Crew theo `crew-docs`.** File mới dưới `apps/crew-mac/src/{workflows,bmad}/**` và `src/commands/{workflows,
  bmad}.ts` vào khối `mac-workflows` của `docs/flows.yaml` rồi `node packages/docs-kit/dist/crew-docs.cjs generate`.
  Commit đổi `src/cli.ts`, `src/commands/{setup,doctor}.ts`, `src/context*.ts`, `assets/crew-claude-run.sh` sửa
  `docs/flows/mac-setup.md`; đổi `src/reaper/reap.ts` sửa `docs/flows/mac-orphan-reaper.md`; mọi commit của gói sửa
  `docs/flows/mac-workflows.md`. Không sửa mục `source`/`shared`/`unassigned`, `AGENTS.md`, `CLAUDE.md`, `.claude/**`,
  `.githooks/**` (R6). Trước commit: `crew-docs check --staged`; trước push: `crew-docs check --range r2-2..r2-3`.
- UI và docs tiếng Việt; identifier, path, route, key tiếng Anh; giờ `Asia/Ho_Chi_Minh`. Conventional Commits, không
  nhắc AI, không ghi mã ticket/plan trong code, test, commit message.

- **Phối hợp với R3** (plan R3 đang viết song song, đọc 10/10 00:55): gói `wizards` của R3 port
  `render-instructions.mjs`/`merge-agent-config.mjs` và template `crew/agents/*.md` vào UI mới; gói `security` của R3 sửa
  `server/src/crew/**` (gồm `issue-create-policy.ts`) và `description` trong `core-hooks.json`; gói `mac` của R3 đụng
  `apps/crew-mac` (wrapper stub, `status`). Luật: nhánh nào ff vào `v3`/nhánh tích hợp sau thì `git merge` nhánh kia và
  giải xung đột trên chính nhánh mình; R2-3 ghi vào ledger R3 (một dòng) khi SV-1, AG-1, AG-2, MW-2 được ff, để R3 port
  thêm vai `bmad`, danh sách `## Agent BMAD của company` và template `bmad` của H4.

## Lệch so với spec (phát hiện khi lập plan, có nguồn)

1. **Tên plugin ghim = id workflow.** `checkInitEvent` (`run-init.ts` trên `r2-2`) so tên plugin trong `system/init` với
   `pin.workflow`, nên `plugin.json` do Crew sinh phải có `"name":"bmad"` và `WorkflowPin.workflow` nhận `'bmad'`.
   Không thêm trường `pluginName`.
2. **`crew-mac workflows install`.** Trên Mac mini sshd agent do app `2P Crew` giữ (R2-1). Chạy lại cả `setup` có thể
   tranh sshd/launchd với app. DP-1 dùng lệnh hẹp `workflows install` (đã thêm vào spec §4.2).
3. **Story đầu mỗi epic chặn bởi story cuối epic trước.** BMAD xếp epic theo thứ tự xây dựng nhưng không hứa epic độc
   lập. Chặn nối tiếp là bảo thủ (chậm hơn, không sai). Trợ Lý không tự nới.
4. **AC pause executor.** Story không có blocker sẽ được executor nhận ngay khi tạo. Để nghiệm thu không tốn quota chạy
   story, AC pause executor của `repo-a` (route stock `POST /agents/:id/pause`) trước khi owner duyệt, resume sau khi
   hủy gốc.

## Review Focus

1. **Nạp chéo qua `enabledPlugins` của repo.** Repo commit `"enabledPlugins": {"superpowers@claude-plugins-official": true}`
   (như chính repo Crew) và giao issue cho agent BMAD: run phải bị chặn trước khi chạy, không được âm thầm nạp Superpowers
   từ cache owner. Ngược lại repo bật `bmad-method@bmad` thì run Superpowers bị chặn. Test: MW-2
   (`workflows-inventory.test.ts` hai ca), AC2.
2. **`_bmad/scripts` khác bản ghim hoặc lớp cá nhân.** Một byte khác trong `_bmad/scripts/resolve_config.py`, một
   `_bmad/custom/bmad-prd.user.toml` chưa commit, hay `_bmad/config.toml` sửa dở: run BMAD bị chặn kèm lệnh xử lý; còn
   `_bmad/scripts` chưa commit nhưng giống từng byte (run trước bị ngắt sau `setup-project`) thì cho qua. Test: MW-2.
3. **File epic/story lệch khuôn.** Thiếu tiêu chí nghiệm thu, số story nhảy (1.1, 1.3), story `2.1` nằm dưới `## Epic 1`,
   hơn 30 story, đường dẫn `../x.md`, `--rev` không phải commit: parser báo lỗi cố định, thoát 3 hoặc 2, Trợ Lý không
   tạo con nào. Test: MW-3 (`bmad-epics.test.ts`, `bmad-command.test.ts`).
4. **Trợ Lý tạo trùng story khi bị đánh thức lại.** Wake `issue_children_completed` tới hai lần, hoặc owner comment trên
   gốc sau khi đã tạo một phần story: không con nào trùng `child-key`, phần thiếu được tạo nốt với cùng
   `idempotencyKey`. Test: AG-1 (`instructions.test.mjs` khẳng định khóa và nhánh đối soát), AC6.
5. **GC xóa bản ghim đang chạy.** Bản cũ còn dấu `.in_use` của pid sống thì giữ dù đã quá 24 giờ; dấu hỏng (không
   parse được) coi như sống; thư mục hiện hành không bao giờ bị xóa; hai GC song song không lỗi. Test: MW-4
   (`workflows-gc.test.ts`).

---

## Gói ngữ cảnh

Luật chia: vẽ gói ngữ cảnh trước rồi cắt ticket trong gói. Mỗi ticket thuộc đúng một gói. Trong một gói, ticket làm lần
lượt, mỗi ticket một agent mới nạp cùng gói. Chỉ chạy song song giữa các gói có file ghi rời nhau.

| Gói | Phạm vi ghi | Nạp chung | Chi tiết |
|---|---|---|---|
| `probe` | `~/crew-r23-probe/` (ngoài repo), `probe-report.md`, `processes.md`, `sdd-ledger.md` | Spec §2.2, §4.2–4.6, §9; `~/.claude/plugins/marketplaces/bmad/{README.md,.claude-plugin/marketplace.json}`; `plugins/toolbox/skills/bmad/references/setup.md`; repo Crew `r2-2:docs/flows/mac-workflows.md` (thuật toán checksum, đo `extraArgs` 07/10) | [probe.md](probe.md) |
| `mac-workflows` | `apps/crew-mac/**` (trừ `src/files/**`), `docs/flows/{mac-workflows,mac-setup,mac-orphan-reaper}.md`, khối `mac-workflows` trong `docs/flows.yaml`, `docs/files.md` (sinh) | Spec §4.2–4.6; `apps/crew-mac/src/workflows/*.ts`, `src/commands/{workflow-check,setup,doctor}.ts`, `src/context.ts`, `src/context-factory.ts`, `src/paths.ts`, `src/cli.ts`, `assets/crew-claude-run.sh`, test `workflows-*.test.ts`, `workflow-check.test.ts`; `probe-report.md`; v2 `/Volumes/CORSAIR/Projects/my-crew/packages/shared/src/bmad-schemas.ts`; Interface I1–I5 | [mac-workflows.md](mac-workflows.md) |
| `policy` | Fork `server/src/crew/{issue-create-policy,issue-policy}.ts`, `server/src/__tests__/{crew-issue-create-policy,crew-issue-gate}.test.ts`, `crew/release/core-hooks.json` (description H4) | Fork `server/src/crew/{issue-create-policy,issue-policy,issue-gate,core-hooks}.ts`, test hiện có của hai file; Interface I7 | [fork.md](fork.md) |
| `agents` | Fork `crew/agents/**` | Fork `crew/agents/{assistant,executor,reviewer,integrator}.md`, `render-instructions.mjs`, `merge-agent-config.mjs`, `apply-roles.sh` + test; spec §4.7–4.8; Interface I5, I6, I8 | [fork.md](fork.md) |
| `ops` | VPS `/opt/crew-v3-spike` qua `crew/ops/*`; agent/environment/label mới trên prod; `~/.crew/app/crew-mac`, `~/crew-agents/bmad` trên Mac mini | Fork `crew/ops/*`, `crew/release/verify.sh`, `crew/agents/apply-roles.sh`; ledger R2-2 dòng DP-1; R2-2 `reports/sp-0-probe.md` mục dọn và tạo env | [fork.md](fork.md) |

## Ticket

| ID | Việc | Gói | Phụ thuộc | Model | Trạng thái |
|---|---|---|---|---|---|
| SP-0 | **Cổng G0.** Đo A1–A5 trên Mac mini (không run Paperclip, ≤ 3 `claude -p`), tính checksum và `executables` của bản lắp, ghi `probe-report.md` | `probe` | — | opus | chưa giao |
| MW-1 | Sổ workflow (`registry.ts`), `WorkflowPin` tổng quát, `BMAD_PIN`/`BMAD_SOURCE`, `installBmadPin` (git archive từ marketplace local hoặc clone https), `crew-mac workflows list|install`, `setup` cài cả hai, doctor `bmad-pin` + `agent-uv`, `ctx.bmadPin` | `mac-workflows` | G0 | opus | chưa giao |
| MW-2 | Cách ly: `workflowCheck` theo sổ, `discoverSources` chặn nạp chéo `enabledPlugins` và luật `_bmad/`, `checkInitEvent`/`runInitCheck` tự nhận pin, dòng `crew-workflow ok` mới, wrapper: câu lỗi + dấu `.in_use` | `mac-workflows` | MW-1 | opus | chưa giao |
| MW-3 | `src/bmad/{epics,answers,setup-project}.ts`, `crew-mac bmad stories|setup-project` (đọc từ đĩa hoặc `--rev`, `scriptsMatchPin`, digest, trần 30, port luật câu trả lời v2) | `mac-workflows` | MW-2 | sonnet | chưa giao |
| MW-4 | `gcWorkflowPins`, `crew-mac workflows gc`, gọi ở cuối `setup`/`workflows install` và trong `reap` tối đa mỗi giờ | `mac-workflows` | MW-3 | sonnet | chưa giao |
| SV-1 | Thân H4: `crew-kind bmad` → template `bmad` `[review reviewer, approval owner]`; test create-policy + gate; `description` H4 | `policy` | G0 | opus | chưa giao |
| AG-1 | `crew/agents/bmad.md` (mới), `assistant.md` (chọn workflow, tạo story từ BMAD), `reviewer.md` (duyệt commit BMAD); test `instructions.test.mjs` | `agents` | G0 | opus | chưa giao |
| AG-2 | `render-instructions.mjs` (danh sách agent BMAD), `merge-agent-config.mjs` (nhận pin `bmad`), `apply-roles.sh` (vai `bmad`, đối số BMAD cho assistant) + test | `agents` | AG-1 | sonnet | chưa giao |
| RV-1 | Review toàn nhánh `r2-3` + `crew/r2-3`; full suite repo Crew; `verify.sh` fork | — | MW-4, SV-1, AG-2 | opus | chưa giao |
| DP-1 | Deploy fork, tag `crew/v3.3-rc1`; cài `crew-mac` + `workflows install` trên Mac mini; dựng agent BMAD cho `repo-a` (worktree, environment, agent, `apply-roles`), nhãn `bmad`, áp instructions mới cho Trợ Lý và reviewer | `ops` | RV-1 | opus | chưa giao |
| AC-R2-3 | Nghiệm thu AC1–AC9 (spec §7) bằng đúng 2 yêu cầu thật; owner thao tác UI khoảng 10 phút | — | DP-1 | opus | chưa giao |

Không ticket nào ghi file của gói khác. Trong gói `mac-workflows`, `src/cli.ts` do MW-1 thêm nhánh `workflows`, MW-3
thêm nhánh `bmad`; MW-4 chỉ sửa `src/commands/workflows.ts` (thêm `gc`).

### Đợt chạy

| Đợt | Ticket | Ghi chú |
|---|---|---|
| 0 | SP-0 | **G0.** Trợ Lý đọc `probe-report.md`, ghi quyết định vào ledger: (a) A1 đạt → giữ nguồn plan; không đạt → dừng, hỏi owner (Q4). (b) A2 đạt → MW-3 làm `setup-project` bằng `setup.py`; không đạt → MW-3 bỏ `setup-project`, `bmad.md` dùng `bmad setup` của skill (mục "Đường dự phòng A2" trong [fork.md](fork.md)). (c) A3: superpowers từ cache owner có bị nạp trong run BMAD không — có hay không thì luật chặn vẫn giữ (fail đóng), chỉ ghi bằng chứng. (d) A4 quyết repo AC. (e) A5 không đạt → `bmad.md` bỏ bước gọi `bmad:bmad`, chạy thẳng `bmad:bmad-create-epics-and-stories` sau khi có PRD/architecture theo yêu cầu kiểm điều kiện của skill đó |
| 1 | MW-1 → MW-2 → MW-3 → MW-4 (mac-workflows) ∥ SV-1 (policy) ∥ AG-1 → AG-2 (agents) | SV-1 chạy test DB: không cùng lúc với `verify.sh` khác |
| 2 | RV-1, rồi FX-n nếu có | FX theo gói của file bị sửa, model như ticket gốc |
| 3 | DP-1 | 0 run active |
| 4 | AC-R2-3 | Hẹn owner 10 phút (duyệt epic/story trên UI, hủy gốc) |

### Nhánh và worktree

- **Repo Crew** (`~/Documents/projects/crew`): tích hợp `r2-3` (rẽ từ `r2-2` @ `a0e8ed8`); gói `r23/mac-workflows`,
  worktree `.worktrees/crew-r23-workflows`, rẽ từ `r2-3`.
- **Fork** (cùng repo fork như R2-2):

  | Nhánh | Worktree | Ghi chú |
  |---|---|---|
  | `crew/r23-policy` | `.worktrees/paperclip-r23-policy` | SV-1 |
  | `crew/r23-agents` | `.worktrees/paperclip-r23-agents` | AG-1, AG-2 |
  | `crew/r2-3` | `.worktrees/paperclip-r23-int` | `verify.sh`, deploy |

- **Thư mục đo SP-0:** `~/crew-r23-probe/` trên Mac. Xóa cuối SP-0 sau khi lưu số liệu.
- **Gộp nhánh.** Trợ Lý ff nhánh gói vào nhánh tích hợp sau khi đọc log test. Xung đột `docs/flows.yaml`/`docs/files.md`
  giải bằng hợp danh sách rồi `crew-docs generate`. Không push.

### Sở hữu file

| Ticket | Ghi |
|---|---|
| SP-0 | `probe-report.md`, `processes.md`, `sdd-ledger.md`; không file nguồn |
| MW-1 | `apps/crew-mac/src/workflows/{pin,registry,bmad-pin,bmad-install,install}.ts`, `src/commands/{workflows,setup,doctor}.ts`, `src/context.ts`, `src/context-factory.ts`, `src/index.ts` (export), 1 nhánh `case 'workflows'` + usage trong `src/cli.ts`, test `test/{workflows-pin,workflows-bmad-install,workflows-registry,workflows-command}.test.ts`, sửa `test/{setup,doctor}.test.ts` nếu ca cũ đổi, `docs/flows/{mac-workflows,mac-setup}.md`, khối `mac-workflows`, `docs/files.md` |
| MW-2 | `src/workflows/{inventory,run-init,policy}.ts`, `src/commands/workflow-check.ts`, `assets/crew-claude-run.sh`, test `test/{workflows-inventory,workflow-check,crew-claude-run}.test.ts`, `docs/flows/{mac-workflows,mac-setup}.md` |
| MW-3 | `src/bmad/{epics,answers,setup-project}.ts`, `src/commands/bmad.ts`, 1 nhánh `case 'bmad'` + usage trong `src/cli.ts`, test `test/{bmad-epics,bmad-answers,bmad-setup-project,bmad-command}.test.ts`, fixture `test/fixtures/bmad/*.md`, `docs/flows/{mac-workflows,mac-setup}.md`, khối `mac-workflows` |
| MW-4 | `src/workflows/workflow-gc.ts`, `src/commands/workflows.ts` (thêm `gc`), `src/commands/setup.ts` (1 lời gọi), `src/reaper/reap.ts` (1 lời gọi), test `test/{workflows-gc,reaper-reap}.test.ts`, `docs/flows/{mac-workflows,mac-orphan-reaper}.md`, khối `mac-workflows` |
| SV-1 | Fork `server/src/crew/{issue-create-policy,issue-policy}.ts`, `server/src/__tests__/{crew-issue-create-policy,crew-issue-gate}.test.ts`, `description` H4 trong `crew/release/core-hooks.json` |
| AG-1 | Fork `crew/agents/{bmad,assistant,reviewer}.md`, `crew/agents/instructions.test.mjs` |
| AG-2 | Fork `crew/agents/{render-instructions.mjs,merge-agent-config.mjs,apply-roles.sh}` + `*.test.mjs` tương ứng |
| DP-1, AC-R2-3 | Ledger, `processes.md`, `reports/{dp-1,ac-r2-3}-report.md`; không file nguồn |

## Interface giữa các gói

**I1. Bản ghim và sổ workflow** (MW-1 tạo; MW-2..MW-4 dùng).

```ts
// apps/crew-mac/src/workflows/pin.ts
export type WorkflowId = 'superpowers' | 'bmad';
export interface WorkflowPin {
  workflow: WorkflowId;          // cũng là tên plugin trong system/init
  version: string;
  revision: string;              // 40 hex
  checksum: string;              // treeChecksum của thư mục ghim
  executables: readonly string[];
}
export const SUPERPOWERS_PIN: WorkflowPin;          // giữ nguyên giá trị hiện có
export function pinDir(home: string, pin: WorkflowPin): string;   // ~/.crew/workflows/<workflow>/<version>-<rev12>
export function superpowersPinDir(home: string, pin?: WorkflowPin): string; // giữ, = pinDir(home, pin ?? SUPERPOWERS_PIN)
export function agentExtraArgs(pinDir: string): string[];          // giữ nguyên

// apps/crew-mac/src/workflows/bmad-pin.ts
export const BMAD_SOURCE: {
  repoUrl: 'https://github.com/bmad-code-org/bmad-plugins.git';
  marketplaceDir: '.claude/plugins/marketplaces/bmad';   // tương đối HOME
  revision: 'd009608292d8a2ea4df846de7dca2f0d78a9e22d';
  trees: readonly ['plugins/method/skills', 'plugins/toolbox/skills'];
};
export const BMAD_PLUGIN_JSON: string;  // '{"name":"bmad","version":"6.13.0-next","description":"BMAD Method (bmad-method + bmad-toolbox), Crew pin d009608292d8"}\n'
export const BMAD_PIN: WorkflowPin;     // version '6.13.0-next', revision = BMAD_SOURCE.revision, checksum + executables từ probe-report A1

// apps/crew-mac/src/workflows/registry.ts
export interface CertifiedWorkflow {
  id: WorkflowId;
  pin: WorkflowPin;
  runtimes: readonly ['claude_local'];
  isDefault: boolean;
  purpose: string;                       // 'design/plan/task, code, review, merge' | 'epic/story'
  pluginKeys: readonly RegExp[];         // key enabledPlugins thuộc workflow này
}
export function certifiedWorkflows(ctx: Pick<MacContext, 'superpowersPin' | 'bmadPin'>): readonly CertifiedWorkflow[];
export function workflowForPluginDir(ctx: Pick<MacContext, 'home' | 'superpowersPin' | 'bmadPin'>, dir: string): CertifiedWorkflow | null;
// pluginKeys: superpowers → [/^superpowers@/]; bmad → [/^bmad@/, /^bmad-method@/, /^bmad-toolbox@/]

// apps/crew-mac/src/workflows/bmad-install.ts
export interface BmadInstallResult { dir: string; source: 'existing' | 'marketplace' | 'github' }
export function installBmadPin(ctx: MacContext): BmadInstallResult;   // ném SetupError với câu tiếng Việt cố định
```

`MacContext` thêm `bmadPin: WorkflowPin` (mặc định `BMAD_PIN`, test thay được) như `superpowersPin`.

**I2. Thư mục ghim và dấu đang dùng** (MW-1, MW-2, MW-4).

```
~/.crew/workflows/                                  0700
  superpowers/6.4.1-5bf4e7801107/                   bản ghim Superpowers (không đổi)
  bmad/6.13.0-next-d009608292d8/                    bản ghim BMAD
    .claude-plugin/plugin.json                      = BMAD_PLUGIN_JSON
    skills/<tên>/…                                  hợp hai cây; trùng tên là lỗi cài
    .in_use/<runId>                                 "<pid> <started epoch giây>\n"; ngoài checksum
  <workflow>/<…>.tmp-<pid>                          bản tạm khi cài
~/.crew/state/workflows-gc.stamp                    mtime = lần GC gần nhất từ reap
```

**I3. `workflow-check` và `run-init-check`** (MW-2).
- CLI không đổi: `crew-mac workflow-check --root <dir> --plugin-dir <dir>`; `crew-mac run-init-check --root <dir>
  --log <file|->`. Mã thoát 0/2/78/1 như cũ.
- Dòng thành công: `crew-workflow ok pin=<id>@<version> rev=<rev12> sum=<checksum12> project=<n> pinned-dup=<n>`.
- `--plugin-dir` không thuộc sổ: `crew-workflow blocked: --plugin-dir <dir> không phải bản ghim của workflow nào đã
  chứng nhận (<dir superpowers>, <dir bmad>)`.
- Wrapper, khi số `--plugin-dir` ≠ 1: `crew-workflow blocked: cần đúng một --plugin-dir (bản workflow đã ghim) trong
  adapterConfig.extraArgs, có <n>; chạy "crew-mac workflows list" để xem giá trị`.
- `run-init-check` chọn pin theo plugin không phải `@builtin` có tên `superpowers` hoặc `bmad` trong `system/init`; có
  cả hai, hoặc không có cái nào → vi phạm `nạp nhiều hơn một workflow` / `không nạp workflow ghim nào`.

**I4. Luật nguồn mới** (MW-2, `inventory.ts`). Hằng số lý do (export):

| Hằng số | Câu | Áp khi |
|---|---|---|
| `CROSS_WORKFLOW_REASON` | `bật workflow <id> khác với workflow của run (nạp chéo)` | key `enabledPlugins` khớp `pluginKeys` của workflow khác pin của run |
| `BMAD_SCRIPT_MISMATCH_REASON` | `khác bản ghim BMAD; chạy crew-mac bmad setup-project hoặc checkout lại từ commit` | `_bmad/scripts/**` khác byte so với `<pin bmad>/skills/bmad/scripts/**` (run BMAD) |
| `BMAD_PERSONAL_REASON` | `lớp cá nhân của BMAD chưa commit` | `_bmad/**/*.user.toml` chưa track/ignore/sửa dở (run BMAD) |
| (dùng lại) `UNTRACKED_REASON`, `IGNORED_REASON`, `DIRTY_REASON` | như cũ | `_bmad/config.toml`, `_bmad/custom/**/*.toml` (run BMAD) |

`_bmad/scripts/**` chưa track mà giống byte → origin `pinned`. Run Superpowers không xét `_bmad/`. MW-2 export thêm
`compareBmadScripts(files: Map<string, Buffer>, pinDir: string): boolean` (tập file và từng byte trùng
`<pinDir>/skills/bmad/scripts/**`) để MW-3 dùng cho `scriptsMatchPin`.

**I5. `crew-mac bmad`** (MW-3 tạo; AG-1 mô tả cho agent; DP-1/AC dùng).

```ts
// apps/crew-mac/src/bmad/epics.ts
export const BMAD_MAX_STORIES = 30;
export interface BmadStory { key: string; epic: number; seq: number; title: string; body: string; acceptance: string[] }
export interface BmadEpic { n: number; title: string; goal: string; storyKeys: string[] }
export interface EpicsParse { epics: BmadEpic[]; stories: BmadStory[]; problems: string[] }
export function parseEpics(text: string): EpicsParse;
// apps/crew-mac/src/bmad/answers.ts (port v2 bmad-schemas.ts)
export const BMAD_PERSONAL_KEYS: readonly string[]; // ['user_name','user_skill_level','communication_language']
export interface BmadAnswer { module: string; key: string; value: string }
export function checkBmadAnswers(answers: readonly BmadAnswer[], opts?: { allowLanguage: boolean }): string[]; // rỗng = đạt
// apps/crew-mac/src/bmad/setup-project.ts
export interface SetupProjectResult { status: 'skipped' | 'ok'; files: string[] }
export function setupProject(ctx: MacContext, root: string): Promise<SetupProjectResult>;
```

- `crew-mac bmad stories --root <dir> --file <đường dẫn tương đối .md> [--rev <40 hex>] [--json]`:
  - đọc file từ đĩa, hoặc `git -C <root> show <rev>:<file>` khi có `--rev`;
  - JSON: `{"digest":"<sha256 hex của bytes file>","file":"…","rev":"<sha>|null","scriptsMatchPin":true|false|null,"epics":[…],"stories":[…],"problems":[…]}`;
    `scriptsMatchPin` = `_bmad/scripts/**` (ở `--rev` hoặc trên đĩa) giống từng byte bản ghim, `null` khi không có
    `_bmad/scripts`;
  - không `--json`: dòng `crew-bmad stories file=<file> epics=<n> stories=<m> digest=<64 hex> scripts=<match|mismatch|none>`
    rồi mỗi vấn đề một dòng `crew-bmad problem: <câu>`;
  - thoát 0 khi `problems` rỗng và `scriptsMatchPin !== false`; 3 khi có vấn đề; 2 khi đối số sai (đường dẫn tuyệt đối,
    có `..`, không `.md`, `--rev` không phải 40 hex hay không phải commit, file không có); 1 lỗi nội bộ.
- `crew-mac bmad setup-project --root <dir>`: `crew-bmad setup: skipped (đã có _bmad/scripts)` hoặc
  `crew-bmad setup: ok files=<n>` rồi mỗi file một dòng; thoát 1 với `crew-bmad setup: <câu cố định>` (thiếu `uv`,
  `setup.py` lỗi, câu trả lời không đạt `checkBmadAnswers`, script sau setup khác bản ghim).
- Comment của agent BMAD (dòng đầu, một dòng):
  `crew-bmad-result sha=<40 hex> file=<đường dẫn> epics=<n> stories=<m> digest=<64 hex>`.

**I6. Marker và kế hoạch của Trợ Lý** (AG-1).
- Dòng thứ ba của comment `crew-plan`: `crew-workflow id=<superpowers|bmad> reason=<một dòng>`.
- Con BMAD: `child-key=bmad-1`, `crew-bundle id=bmad seq=1`, dòng `crew-kind bmad`, model
  `crew-model complexity=large model=claude-opus-5 effort=high reason=lập epic/story cho toàn yêu cầu`.
- Revision story: `bmad-<identifier con BMAD>` (ví dụ `bmad-TPS-91`); `child-key=s<N>-<M>`;
  `crew-bundle id=epic-<N> seq=<M>`; dòng `crew-bmad story=<N>.<M> source=<sha12>:<file>`; blocker: `s<N>-<M-1>`, hoặc
  với M=1 và N>1 là story cuối của epic N-1.
- Khóa tạo: `crew-child:<id gốc>:bmad-<identifier>:s<N>-<M>`.

**I7. Template `bmad` của H4** (SV-1).

```ts
// server/src/crew/issue-policy.ts
export function buildCrewPolicy(kind: "root" | "child" | "research" | "bmad", roles: CrewRoles, ownerUserId?: string | null): IssueExecutionPolicy;
// "bmad" = [review reviewer, approval owner], maxReviewRounds 5 (cùng hình dạng "research")
// server/src/crew/issue-create-policy.ts
export const CREW_BMAD_KIND_RE = /^crew-kind bmad[ \t]*$/m;
// IssueCreateFields thêm description?: string | null
// CreatePolicyDecision thêm { kind: "set"; template: "bmad"; ownerUserId: string }
```

Chỉ nhánh agent tạo (`createdByAgentId`) xét marker, sau mọi luật từ chối hiện có. Board/hệ thống không đổi.

**I8. Vai trò và script** (AG-2; DP-1 dùng).
- `apply-roles.sh agent <agentId> bmad <home>/.crew/workflows/bmad/<version>-<rev12>`.
- `apply-roles.sh agent <agentId> assistant <home>/.crew/workflows/superpowers/<…> <executorIds> [<bmadIds>]`.
- Vai `executor|reviewer|integrator|assistant` bắt buộc pin Superpowers; vai `bmad` bắt buộc pin BMAD.
- `AGENTS.md` của Trợ Lý cuối file: `## Executor của company` (như cũ) rồi `## Agent BMAD của company` với danh sách
  `- \`<uuid>\`` hoặc dòng `Không có. Luôn dùng Superpowers.`.

---

## Nghiệm thu (AC-R2-3)

Làm trên Mac mini thật và Paperclip prod bản DP-1. Bằng chứng (lệnh, đầu ra rút gọn, giờ `date`) ghi
[sdd-ledger.md](sdd-ledger.md) và `reports/ac-r2-3-report.md`. **Đúng 2 yêu cầu thật.**

**Không tốn run (làm trước):**
- [ ] **AC1:** `~/.crew/bin/crew-mac workflows list --json` có `superpowers` (`isDefault: true`, installed) và `bmad`
  (installed, checksum = `BMAD_PIN.checksum`). `crew-mac doctor` `bmad-pin`, `agent-uv`, `superpowers-pin` = ok. Thẻ máy
  trên trang Crew của plugin hiện `bmad-pin`. `treeChecksum` thư mục Superpowers ghim không đổi so với trước DP-1.
- [ ] **AC2:** Script `reports/ac2-isolation.sh` (AC-R2-3 viết, chạy trong `~/crew-r23-probe/ac2`) dựng repo tạm và chạy
  `crew-mac workflow-check` 8 ca; mã thoát kỳ vọng:
  1. pin BMAD, repo sạch → 0, dòng `crew-workflow ok pin=bmad@6.13.0-next rev=d009608292d8`.
  2. `--plugin-dir ~/.claude/plugins/marketplaces/bmad/plugins/method` → 78.
  3. thư mục ghim BMAD sửa một byte (bản chép tạm dưới HOME giả) → 78 `WORKFLOW_SOURCE_MISMATCH`.
  4. pin BMAD, repo commit `enabledPlugins` `superpowers@claude-plugins-official` → 78 nạp chéo.
  5. pin Superpowers, repo commit `enabledPlugins` `bmad-method@bmad` → 78 nạp chéo.
  6. pin BMAD, `_bmad/scripts/resolve_config.py` đã commit nhưng khác một byte → 78.
  7. pin BMAD, `_bmad/config.user.toml` chưa track → 78.
  8. pin Superpowers, repo có `_bmad/` lạ chưa track → 0.
- [ ] **AC8:** HOME giả: thư mục `bmad/6.12.0-aaaaaaaaaaaa` có `.in_use/<uuid>` pid sống → còn sau
  `crew-mac workflows gc`; đổi pid thành pid đã chết và lùi mtime 25 giờ → bị xóa; thư mục hiện hành còn.
- [ ] **AC9:** `node crew/release/check-core-hooks.mjs` báo H1–H5; `base` = `v2026.1005.0`;
  `git -C <fork> diff crew/r2-2..crew/r2-3 --stat` chỉ có đường dẫn ở Global Constraints; `packages/crew-plugin` không
  đổi.

**Chuẩn bị:** `active-runs.sh` rỗng; backup; ghi `date`. Issue tạo trong project `repo-a` (company TPS), giao Trợ Lý
R1. Pause các executor của `repo-a` trước khi owner duyệt (bước 3 lượt 1), resume sau khi hủy gốc.

**Lượt 1 (yêu cầu BMAD).** Owner tạo issue gốc nhãn `bmad`, mô tả: "Lập epic và story cho tính năng: trang Giới thiệu
(tên, mô tả ngắn, ảnh đại diện) và form liên hệ (tên, email, nội dung; kiểm định dạng email; lưu vào file JSON). Không
cần giao diện đẹp. Chỉ cần epic/story, chưa làm code."

1. Trợ Lý run → comment `crew-plan` + con BMAD.
2. Agent BMAD run(s) → commit, `crew-bmad-result`, `done` → reviewer run → approve.
3. Pause executor; owner duyệt stage approval của con BMAD trên UI.
4. Trợ Lý run → kế hoạch revision `bmad-<id>` + tạo story.
5. Owner comment "kiểm lại" trên gốc → Trợ Lý run → không tạo thêm con.
6. Owner hủy gốc; resume executor.

- [ ] **AC3:** Log run BMAD có dòng `crew-workflow ok pin=bmad@6.13.0-next rev=d009608292d8 sum=<12>`. Tải log run
  (`GET /api/heartbeat-runs/<id>/log` qua `api.sh`; tách stream-json như AC-2 R1-2,
  [`ac-2-report.md`](../261007-1034-crew-v3-r1-2/ac-2-report.md)) rồi `crew-mac run-init-check --root ~/crew-agents/bmad --log -`
  thoát 0; `system/init` có plugin `bmad` path thư mục ghim, không `superpowers`.
- [ ] **AC4:** `crew-plan` có `crew-workflow id=bmad`; đúng một con `crew-kind bmad` giao agent BMAD;
  `executionPolicy.stages` của con = `[review reviewer, approval owner]`.
- [ ] **AC5:** `git -C ~/crew-agents/bmad diff --stat $(git merge-base origin/HEAD <sha>)..<sha>` chỉ có `_bmad/**`,
  thư mục artifact, `docs/**` (nếu hook đòi); `crew-mac bmad stories --root ~/crew-agents/reviewer --rev <sha> --file <file>`
  thoát 0, digest = comment; reviewer comment `crew-review sha=<sha> verdict=approved`; owner duyệt. Agent BMAD ≤ 4 run.
- [ ] **AC6:** Số con revision `bmad-<id>` = `stories`; mỗi con đúng I6 (marker, gói, blocker, `Tiêu chí nghiệm thu:`
  không rỗng), giao executor trong danh sách; sau bước 5 số con không đổi. Không run executor nào bắt đầu.
- **Lượt 2 (mặc định).** Owner tạo issue gốc không nhãn: "Sửa câu chào trên trang chủ thành 'Xin chào'". Trợ Lý run →
  comment `crew-plan`. Owner hủy gốc ngay khi thấy comment (trước khi executor nhận).
- [ ] **AC7:** `crew-plan` lượt 2 có `crew-workflow id=superpowers`, không con `crew-kind bmad`.
- [ ] **Dọn:** 0 run active; executor đã resume; `processes.md` không còn "đang chạy"; xóa `~/crew-r23-probe/ac2`; tag
  `crew/v3.3` cục bộ trên commit đã deploy. Push chỉ khi owner nói "push".

## Self-review

Trợ Lý tự review 10/10/2026 sau khi viết plan và các file chi tiết.

- **Phủ spec:**
  - §1.1 cài/ghim → MW-1 (I1, I2), DP-1, AC1. §1.2 cách ly → MW-2 (I3, I4), AC2, AC3. §1.3 công bố → MW-1
    (`workflows list`), AC1. §1.4 epic/story → MW-3 (I5), SV-1 (I7), AG-1 (I6), AC4–AC6. §1.5 mặc định → AG-1, AC7.
  - §4.2 → MW-1; §4.3 → MW-1; §4.4 → MW-2; §4.5 → MW-2 (dấu, dòng ok), MW-4 (GC), AC8; §4.6 → MW-3 (G0 b);
    §4.7 → AG-1, AG-2, DP-1; §4.8 → AG-1, SV-1, MW-3; §4.9 → SV-1, AC9.
  - §3 port v2 → MW-3 (`checkBmadAnswers`), MW-1 (`BMAD_SOURCE` chỉ https đúng repo/revision).
  - §9 A1–A5 → SP-0 và quyết định G0.
- **Mỗi ticket một gói:** cột "Gói" một giá trị; bảng "Sở hữu file" không có file chung giữa gói. `cli.ts` chỉ trong gói
  `mac-workflows`.
- **Placeholder:** đã quét `TBD`, `TODO`, `implement later`, `similar to`. Giá trị chỉ biết sau đo (`BMAD_PIN.checksum`,
  `executables`, dạng JSON câu hỏi của `setup.py`) có lệnh tính và chỗ ghi rõ trong [probe.md](probe.md).
- **Nhất quán tên:** `WorkflowId`, `WorkflowPin`, `pinDir`, `BMAD_PIN`, `BMAD_SOURCE`, `BMAD_PLUGIN_JSON`,
  `certifiedWorkflows`, `workflowForPluginDir`, `installBmadPin`, `CROSS_WORKFLOW_REASON`,
  `BMAD_SCRIPT_MISMATCH_REASON`, `BMAD_PERSONAL_REASON`, `parseEpics`, `BMAD_MAX_STORIES`, `checkBmadAnswers`,
  `setupProject`, `gcWorkflowPins`, `CREW_BMAD_KIND_RE`, `crew-bmad-result`, `crew-workflow id=`, `crew-kind bmad`,
  `crew-bmad story=` khớp giữa plan, [mac-workflows.md](mac-workflows.md), [fork.md](fork.md).
- **Review Focus:** 1 → MW-2; 2 → MW-2; 3 → MW-3; 4 → AG-1, AC6; 5 → MW-4.

**Còn chờ owner** (spec §11, plan tạm theo phương án khuyên):
1. Q1 phạm vi (story code bằng Superpowers) → đổi thì AG-1, AC6 làm lại.
2. Q2 điều kiện chọn BMAD → đổi thì chỉ sửa mục "Chọn workflow" của `assistant.md` (AG-1).
3. Q3 owner duyệt epic/story ở stage approval → đổi thì bỏ SV-1, sửa AG-1 (Trợ Lý tạo story sau reviewer), AC5.
4. Q4 bản ghim `bmad-plugins` d009608 → đổi thì MW-1 đổi `BMAD_SOURCE`/`BMAD_PIN`, SP-0 đo lại A1–A3.
5. Q5 tự chọn tiếp ở menu, hỏi một lượt, trần 30 story → đổi thì AG-1 (`bmad.md`), MW-3 (`BMAD_MAX_STORIES`).
6. Hẹn 10 phút owner thao tác UI ở AC (duyệt stage approval, hủy gốc).
7. Rủi ro app R2-1 tự cài lại `crew-mac` cũ (như R2-2): bản app kế tiếp phải build từ `r2-3` trở đi. Ghi handover, không
   sửa app.
