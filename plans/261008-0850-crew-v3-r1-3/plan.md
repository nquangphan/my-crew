---
title: "Crew v3 R1-3 — Trợ Lý"
description: "Trợ Lý tách yêu cầu thành issue con theo gói, chọn model, hỏi owner; hai executor; chung session trong gói; research không qua integrator."
status: pending
priority: P1
effort: 6d
branch: v3
tags: [crew-v3, paperclip, assistant, execution-policy, session, superpowers]
created: 2026-10-08
---

# Crew v3 R1-3 — Trợ Lý — Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner gõ yêu cầu trên web, giao cho agent Trợ Lý; Trợ Lý tách thành issue con có blocker theo gói ngữ cảnh, chọn model từng con, hỏi owner khi thiếu thông tin, giao cho hai executor; issue con cùng gói chạy nối tiếp trên một executor và run sau resume session của run trước; research đi template reviewer → owner.

**Architecture:** Không thêm hook (giữ 4/5) nếu spike SP-1 đạt: H1 `crewBeforeClaim` sau cổng tải ghi `resumeFromRunId`/`resumeSessionParams` vào `contextSnapshot` của run issue con kế trong gói. H4/H2 lọc `assigneeAdapterOverrides` của agent (chỉ `model`/`effort` trong danh sách). H4 thêm template `research` chọn theo nhãn `research` của issue gốc board tạo. Trợ Lý là một agent `claude_local` với instructions `crew/agents/assistant.md`; mọi điều phối đi qua REST stock (`/children`, `blockedByIssueIds`, `blockParentUntilDone`, interaction `ask_user_questions`). Không scheduler/bảng mới.

**Tech Stack:** Paperclip fork nhánh `v3` (`6c20d406c`), Node ≥ 24.11, pnpm 9.15.4 qua Corepack, vitest + embedded PostgreSQL, `node --test` cho `crew/agents`, Claude Code CLI 2.1.x, Superpowers `6.4.1` ghim, `crew-mac`, server spike `crew-v3-spike`.

**Spec:** [R1-3 Trợ Lý](../../docs/superpowers/specs/2026-10-08-crew-v3-r1-3-assistant.md) (bổ sung), [R1-2 gates](../../docs/superpowers/specs/2026-10-07-crew-v3-r1-2-gates.md), [stock-first](../261006-0805-crew-v3-stock-first/plan.md) mục R1-3 và "Chính sách test theo tầng", [spike-policy Step 6](../261006-0805-crew-v3-stock-first/spike-policy.md), [gói ngữ cảnh](goi-ngu-canh.md), [handover R1-2](../261007-1034-crew-v3-r1-2/handover.md). Quyết định và ruling: [sdd-ledger.md](sdd-ledger.md).

## Global Constraints

Kế thừa nguyên văn R1-2 (mục Global Constraints của [plan R1-2](../261007-1034-crew-v3-r1-2/plan.md)), cộng các dòng (mới):

- Không sửa file lõi Paperclip, trừ hook một dòng ở đầu hàm có mục trong `crew/release/core-hooks.json` và test tồn tại. Ngân sách: **4/5** (H1–H4). H5 `beforeWakeup` chỉ dùng khi SP-1 kết luận no-go (owner đã duyệt O12); khi đó 5/5.
- Không scheduler, queue, bảng hay migration mới. Paperclip là nguồn trạng thái duy nhất. Marker gói là dòng trong mô tả issue, không cột mới.
- Credential AI chỉ trên Mac. Agent dùng Keychain. `--setting-sources project,local`. Worktree agent dưới `~/crew-agents`. sshd agent trong phiên desktop.
- UI/docs tiếng Việt, identifier/path tiếng Anh, giờ Asia/Ho_Chi_Minh. Không dùng cổng 5432. Backup DB trước thay đổi dữ liệu.
- VPS: chỉ compose project `crew-v3-spike` và `/opt/crew-v3-spike`; không build full image trên VPS.
- Không push fork, không push repo Crew khi owner chưa nói "push". (mới) Deploy lên server spike, tạo agent/environment, sửa `~/crew-agents` và cấu hình agent cho AC-3: owner đã duyệt kiểu R1-2, không hỏi lại, nhưng ghi từng bước vào ledger.
- Mỗi process nền ghi lệnh/PID/cổng/worktree vào `processes.md` (tạo khi cần) và dừng khi xong.
- Phiên Trợ Lý/worker không đặt `PAPERCLIP_RUN_ID`; không ghi `~/crew-agents` ngoài EN-1/AC-3.
- Không gọi model `fable` ở bất kỳ đâu (owner cấm); không gọi `kongming` trừ khi kẹt thật (nó chạy opus). Kẹt thì opus góc nhìn mới rồi ghi ruling.
- Repo Crew: commit đổi file nguồn phải sửa `docs/flows/<id>.md` (R3), file mới phải có trong `docs/flows.yaml` (R2), `crew-docs check --staged` trước commit. R1-3 dự kiến không đổi nguồn repo Crew.
- Không để mã plan/ticket (SP-1, AC-3, R1-3…) trong code, test, chuỗi hiển thị hay commit message.
- (mới) Tài nguyên: Mac mini đang tải cao (load 17–21 lúc 08:50, emulator/simulator/Orca của owner), cổng tải 8 sẽ giữ run; quota Claude dùng chung với owner. Nghiệm thu dùng prompt nhỏ trên repo thử `~/crew-spike/repo-a`; một việc nặng một lúc (typecheck/test fork, overlay build); xem `memory_pressure` trước việc nặng.

## Review Focus

1. Agent gửi `assigneeAdapterOverrides` có `adapterConfig.extraArgs`/`command`/`env`/`useProjectWorkspace`, hoặc `model: "claude-fable-5"`, qua **cả** tạo issue (H4, mọi đường gọi `issueService.create`) lẫn `PATCH` (H2): 422 `crew_override_forbidden`, DB không đổi. Board vẫn đặt được. Test: PO-1.
2. H1 chỉ nối session khi đủ mọi điều kiện (B chưa có session riêng, blocker cùng gói đã `done`, agent của run có session trên A); thiếu một điều kiện thì claim như stock; lỗi DB thì fail open (session mới), không giữ run. Ghi `contextSnapshot` có điều kiện `status = 'queued'`. Test: BR-1.
3. Run thứ hai của gói với wake `issue_assigned` (lý do reset session của stock) vẫn resume đúng session (explicit thắng reset). Test: SP-1, BR-1.
4. Issue gốc nhãn `research`: H2 không đòi bằng chứng docs/push (template 2 stage), executor không commit, reviewer duyệt được không cần `crew-commit`; issue gốc code vẫn 4 stage. Test: PO-2, RA-3.
5. Trợ Lý không bao giờ `in_review`/`done` issue gốc khi còn chờ owner hoặc còn con chưa xong; không hỏi owner sau khi đã tạo con (run trên gốc bị stock hủy vì blocker). Test: RA-1 (instructions) + AC-3 Cổng 4.

---

## Gói ngữ cảnh và ticket

Luật chia theo [nhan-viec](../../.agents/skills/tro-ly/references/nhan-viec.md): ticket chỉ nằm trong một gói, ticket cùng gói chạy nối tiếp trên một worker. Gói D của scout (port policy v2) nhỏ nên gộp vào `policy`; gói C là `roles`.

| Gói | Nạp gì | Model | Worker |
|---|---|---|---|
| `session` | Fork: `server/src/services/heartbeat.ts` (symbol `claimQueuedRun` l.17124, `resolveExplicitResumeSessionOverride` l.12156, `buildExplicitResumeSessionOverride` l.5275, `shouldResetTaskSessionForWake` l.5588, `executeRun` đọc `context.resumeSessionParams` l.20558, `enqueueWakeup` l.26076); `server/src/crew/{core-hooks.ts,load-gate.ts}` (`crewBeforeClaim` l.706); `packages/db/src/schema/{agent_task_sessions,heartbeat_runs,issue_relations}.ts`; `server/src/__tests__/crew-before-claim.test.ts` (harness mock `execute`); `crew/release/core-hooks.json`; [session.md](session.md) | opus (claim/scheduler) | |
| `policy` | Fork: `server/src/crew/{issue-create-policy,issue-gate,issue-policy}.ts`; `packages/shared/src/validators/issue.ts` (`issueAssigneeAdapterOverridesSchema` l.296, `createIssueBaseSchema` l.680, `updateIssueSchema` l.846); `packages/db/src/schema/labels.ts`; test `crew-issue-create-policy`, `crew-issue-gate.db`; V2 `apps/daemon/src/roles/model-policy.ts`, `packages/shared/src/settings-schemas.ts` l.251; [policy.md](policy.md) | opus (execution policy, bảo mật) | |
| `roles` | Fork: `crew/agents/{executor,reviewer,integrator}.md`, `apply-roles.sh`, `instructions.test.mjs`; `docs/api/issues.md` l.180–236 (interaction); `packages/shared/src/validators/issue.ts` l.1347 (`askUserQuestionsPayloadSchema`); `.agents/skills/tro-ly/references/nhan-viec.md`; interface mục dưới; [roles.md](roles.md) | sonnet | |
| `env` | Server spike (`/opt/crew-v3-spike/api.sh`), Mac mini (`~/crew-agents`, `~/crew-spike/repo-a`), [ac-2-report.md](../261007-1034-crew-v3-r1-2/ac-2-report.md) mục "Dựng vai trò"; [env.md](env.md) | Trợ Lý · sonnet | |

| ID | Việc | Gói | Nạp gì (thêm so với gói) | Phụ thuộc | Model | Worker · trạng thái |
|---|---|---|---|---|---|---|
| SP-1 | Spike O12 (chỉ test, không code sản phẩm): override H1 trong test ghi `resumeSessionParams` vào run B rồi claim; kỳ vọng `execute` nhận `runtime.sessionId` của A, kể cả wake `issue_assigned`. Kết luận go (H1) / no-go (H5) vào `spike-session.md` | `session` | `resolveRuntimeSessionParamsForWorkspace` l.5447, `runtimeForAdapter` l.22534 | — | opus | |
| BR-1 | `server/src/crew/bundle-resume.ts` (`parseCrewBundle`, `findBundlePredecessor`, `applyBundleResume`), nối vào `beforeClaim` trong `core-hooks.ts` sau cổng tải; mục H1 trong `core-hooks.json`; test DB | `session` | `issueRelations` (issueId = blocker), `agentTaskSessions` | SP-1 | opus | |
| PO-1 | `server/src/crew/model-policy.ts` (bảng `CREW_COMPLEXITY_MODEL`, `checkAgentAdapterOverrides`); H4 từ chối override sai của agent; H2 từ chối `PATCH` override sai của agent; mã `crew_override_forbidden` | `policy` | `heartbeat.ts` l.21128 (merge nông, chỉ đọc) | — | opus | |
| PO-2 | Template `research` (`buildCrewPolicy("research")` = `[review reviewer, approval owner]`); H4 chọn khi board tạo issue gốc có nhãn tên `research` (không phân biệt hoa thường) | `policy` | `labels` (`companyId`, `name`) | PO-1 | opus | |
| RA-1 | `crew/agents/assistant.md` (Trợ Lý: đọc docs, Superpowers, gói, model, marker, hỏi owner, research, chốt issue gốc) + test trong `instructions.test.mjs` | `roles` | interface mục dưới | — | sonnet | |
| RA-2 | `apply-roles.sh agent <id> assistant <pin> <executorIds>` + `render-instructions.mjs` (nối danh sách executor vào AGENTS.md) + test | `roles` | `merge-agent-config.mjs`, `verify-result.mjs` | RA-1 | sonnet | |
| RA-3 | `executor.md` (research, `crew-stack`, `crew_override_forbidden`), `reviewer.md` (duyệt research, diff `crew-stack`), `integrator.md` (mã lỗi mới) + test | `roles` | — | RA-1 | sonnet | |
| EN-1 | Dựng trên spike: agent Trợ Lý + executor thứ hai, environment + worktree riêng, `maxConcurrentRuns 1`, nhãn `research`; không đổi `crew-policy.json` | `env` | — | — (Step 5 áp vai trò chờ AC-3 Cổng 1 deploy) | Trợ Lý · sonnet | |
| AC-3 | Nghiệm thu R1-3 (cổng 1–5 bên dưới) trên Mac mini + server spike; deploy image `crew/r1-3` | Trợ Lý | mục "Nghiệm thu" | tất cả | opus (điều phối), agent thật sonnet/opus theo O14 | |

**Song song được:** `session`, `policy`, `roles` chạy song song trên ba worktree fork riêng (file ghi rời nhau, xem bảng sở hữu). EN-1 không sửa code, chạy song song với cả ba (chỉ đụng server spike và Mac; một việc nặng một lúc trên Mac). Trong gói: SP-1 → BR-1; PO-1 → PO-2; RA-1 → RA-2 → RA-3. AC-3 cuối cùng, sau khi gộp ba nhánh vào `crew/r1-3`.

**Sở hữu file (không hai gói song song cùng ghi một file):**

| Gói | Ghi |
|---|---|
| `session` | `server/src/crew/{bundle-resume.ts,core-hooks.ts}`, `server/src/__tests__/{crew-bundle-resume.test.ts,crew-claim-resume-contract.test.ts}`, `crew/release/core-hooks.json`, `crew/ops/inspect-image.sh` (thêm cả `bundle-resume` lẫn `model-policy` của gói `policy` vào danh sách file kiểm); nếu no-go: thêm một dòng hook trong `server/src/services/heartbeat.ts` (`enqueueWakeup`) |
| `policy` | `server/src/crew/{model-policy.ts,issue-create-policy.ts,issue-gate.ts,issue-policy.ts}`, `server/src/__tests__/{crew-model-policy.test.ts,crew-issue-create-policy.test.ts,crew-issue-gate.db.test.ts}` |
| `roles` | `crew/agents/**` |
| `env` | không file repo; ghi ledger (Trợ Lý giữ ledger) |

`policy` **không** sửa `core-hooks.ts`: trường mới của `IssueCreateFields` khai báo kiểu `unknown`/tùy chọn, nên `IssueCreateLike` của registry vẫn gán được (trường tùy chọn thiếu không làm hỏng kiểu).

**Worktree:** fork `.worktrees/paperclip-r13-session` (`crew/r13-session`), `.worktrees/paperclip-r13-policy` (`crew/r13-policy`), `.worktrees/paperclip-r13-roles` (`crew/r13-roles`), cùng gốc `v3` `6c20d406c`; gộp vào `crew/r1-3` trước AC-3. Tạo bằng `superpowers:using-git-worktrees`; kiểm `git rev-parse --show-toplevel` trước mọi lệnh git ghi. Test tầng implementer: chỉ file test của ticket + `corepack pnpm --filter @paperclipai/server typecheck` (fork) hoặc `node --test crew/agents/*.test.mjs` (roles); không full suite.

## Interface giữa các gói

- **Marker gói** (RA-1 Trợ Lý ghi, BR-1 parse, RA-3 executor đọc): một dòng riêng trong `description`, regex (cờ `m`) `CREW_BUNDLE_RE = /^crew-bundle id=([a-z0-9][a-z0-9-]{0,39}) seq=([1-9][0-9]{0,2})$/m`. `parseCrewBundle(description: string | null): { id: string; seq: number } | null` (export từ `server/src/crew/bundle-resume.ts`). Nhiều dòng khớp → lấy dòng đầu.
- **Nối session** (BR-1): `applyBundleResume(input: { db: Db; run: typeof heartbeatRuns.$inferSelect }): Promise<"applied" | "skipped">`. Gọi trong `implementations.beforeClaim` của `core-hooks.ts`: `if (await crewBeforeClaim(input)) return true; await applyBundleResumeSafely(input); return false;`. Ghi `contextSnapshot = contextSnapshot || {"resumeFromRunId","resumeSessionDisplayId","resumeSessionParams","crewBundleResume":{"bundle","fromIssueId"}}` với `WHERE id = run.id AND status = 'queued'`, rồi gán lại `run.contextSnapshot` bằng giá trị trả về. Activity `crew.bundle_resume` (`entityType: "heartbeat_run"`, `details: { bundle, fromIssueId, toIssueId, resumeFromRunId }`). Lỗi: log `crew-bundle-resume: failed open`, không ném.
- **Bảng model** (PO-1 định nghĩa, RA-1 chép vào `assistant.md`, test RA-1 đối chiếu): `CREW_COMPLEXITY_MODEL: Readonly<Record<"trivial"|"small"|"medium"|"large", { model: string; effort: "low"|"medium"|"high" }>>` = trivial `claude-sonnet-5`/`low`, small `claude-sonnet-5`/`medium`, medium `claude-sonnet-5`/`high`, large `claude-opus-5`/`high`. `CREW_ALLOWED_MODELS` = tập model của bảng; `CREW_ALLOWED_EFFORTS = ["low","medium","high"]`. Dòng trong `assistant.md` đúng dạng `| \`<complexity>\` | \`<model>\` | \`<effort>\` |` ở đầu dòng bảng.
- **Lọc override** (PO-1): `checkAgentAdapterOverrides(value: unknown): string[]` trả danh sách vi phạm (rỗng = hợp lệ). Hợp lệ: `undefined`, `null`, `{}` hoặc `{ adapterConfig: { model?: <CREW_ALLOWED_MODELS>, effort?: <CREW_ALLOWED_EFFORTS> } }`. Vi phạm dạng `"<key>"` cho key lạ cấp 1 (ví dụ `useProjectWorkspace`), `"adapterConfig.<key>"` cho key lạ trong `adapterConfig`, `"adapterConfig.model:<giá trị>"`, `"adapterConfig.effort:<giá trị>"`, `"shape"` khi không phải object. Lỗi: `unprocessable("Crew: agent chỉ được đặt model và effort trong assigneeAdapterOverrides.", { code: "crew_override_forbidden", violations })`. Áp khi actor là agent (H4: `data.createdByAgentId`; H2: `actorAgentId`) và company không `absent`.
- **Template research** (PO-2): `buildCrewPolicy("research", roles, ownerUserId)` = stages `[review: agent reviewer, approval: user owner]`, `maxReviewRounds: 5`. `CREW_RESEARCH_LABEL = "research"`. H4: board tạo issue **gốc** không gửi `executionPolicy`, có `labelIds` chứa nhãn cùng company tên `research` (so `lower(name)`) → template research. Không áp cho issue con, agent hay hệ thống. Đổi nhãn sau khi tạo không đổi policy.
- **Mã lỗi** (bổ sung danh sách R1-2): `crew_override_forbidden` (PO-1 ném; RA-1/RA-3 giải thích).
- **Dòng giao tiếp mới** (RA-1/RA-3 định nghĩa; chỉ agent đọc, server không parse):
  - `crew-model complexity=<trivial|small|medium|large> model=<id> effort=<low|medium|high> reason=<một dòng>` trong mô tả con.
  - `crew-stack on=<identifier>` trong mô tả con: regex `^crew-stack on=([A-Z][A-Z0-9]*-[0-9]+)$`.
  - `crew-kind research` trong mô tả con.
  - `crew-plan root=<identifier gốc> children=<số con> bundles=<số gói>` dòng đầu comment kế hoạch của Trợ Lý trên issue gốc.
  - `crew-report` dòng đầu comment báo cáo research của executor.
  - `crew-review research verdict=approved` dòng đầu comment duyệt của reviewer cho con research.
  - `crew-assistant done children=<identifier,…>` dòng đầu comment khi Trợ Lý chuyển issue gốc `done`.
- **Instructions Trợ Lý** (RA-2): `apply-roles.sh agent <agentId> assistant <pinDir> <executorId,executorId>`; AGENTS.md = `assistant.md` + mục cuối `## Executor của company` liệt kê id (sinh bởi `render-instructions.mjs <role> <file .md> <agentId> [executorId,executorId]`, hàm `renderInstructions(role, text, agentId, executorIds)`). Từ chối id không phải uuid, danh sách rỗng, trùng `agentId` của Trợ Lý.
- **Hỏi owner** (RA-1): `POST /api/issues/<gốc>/interactions` body `{"kind":"ask_user_questions","resolverPolicy":"human_only","continuationPolicy":"wake_assignee","idempotencyKey":"crew-ask:<id gốc>:<n>","title":"Trợ Lý cần thêm thông tin","payload":{"version":1,"questions":[{"id":"q1","prompt":"…","selectionMode":"single","required":true,"options":[{"id":"a","label":"…"},{"id":"other","label":"Khác","freeText":true}]}]}}`, rồi `PATCH` gốc `{"status":"blocked","comment":"Trợ Lý: chờ owner trả lời câu hỏi …"}`.

## Nghiệm thu (AC-3)

Theo [nghiem-thu](../../.agents/skills/tro-ly/references/nghiem-thu.md). Chạy một lần trên nhánh tích hợp `crew/r1-3`, image deploy lên spike. Ghi đạt/không + bằng chứng vào ledger và `ac-3-report.md`.

- [ ] **Cổng 1 — artifact chạy được.** Fork `crew/r1-3`: `corepack pnpm --filter @paperclipai/server typecheck` rc 0; `crew/release/verify.sh` (gồm `check-core-hooks.mjs`, `vitest run src/__tests__/crew-`, test adapter, typecheck) đạt; `node --test crew/agents/*.test.mjs` đạt (verify.sh không chạy thư mục này); overlay build image `crew-v3/paperclip:v3-<sha>`, `inspect-image.sh` thấy `server/dist/crew/{bundle-resume,model-policy}.js`; deploy, `/api/health` trả đúng commit, `/plugins/crew.core/health` healthy. Hook đếm 4 (go) hoặc 5 (no-go, mục H5 trong `core-hooks.json`).
- [ ] **Cổng 2 — API thật + DB thật.**
  - 2a: bằng key agent Trợ Lý, `POST /api/issues/<gốc>/children` có `assigneeAdapterOverrides.adapterConfig.extraArgs` → 422 `crew_override_forbidden`; `model: "claude-fable-5"` → 422; `{"adapterConfig":{"model":"claude-opus-5","effort":"high"}}` → 201 và `issues.assignee_adapter_overrides` trong DB đúng giá trị đó. `PATCH` con với `useProjectWorkspace` → 422, DB không đổi. Board `PATCH` `extraArgs` → 200.
  - 2b: board tạo issue gốc có nhãn `research` → `execution_policy.stages` trong DB 2 stage (review reviewer, approval owner); không nhãn → 4 stage.
  - 2c: kiểm (không sửa): bằng key executor gọi `PATCH /api/agents/<chính nó>` đổi `adapterConfig.extraArgs`. Kỳ vọng 403/422. Nếu 200: hoàn tác bằng `apply-roles.sh`, ghi ledger, **dừng hỏi owner** (lối vượt ghim ngang hàng lọc override).
- [ ] **Cổng 3 — trình duyệt.** Không áp dụng cho R1-3: UI Crew là R1-4. Owner trả lời câu hỏi qua card interaction của UI stock Paperclip (thao tác tay, ghi ảnh/ghi chú vào report), không Playwright.
- [ ] **Cổng 4 — chạy thật trên Mac.** Repo thử `~/crew-spike/repo-a` (đã `crew-docs init`, `origin` bare). Ba yêu cầu nhỏ, owner (board) tạo trên web, giao Trợ Lý:
  - 4a **Yêu cầu nhỏ + hỏi owner + chung session + song song:** "Thêm lời chào theo ngôn ngữ cho `greet` (hàm và test) và ghi cách dùng vào README" (cố ý không nói ngôn ngữ nào; hai vùng để có hai gói). Nếu Trợ Lý gom hết vào một gói (hợp lệ theo luật gói), ca song song chưa đo: chạy thêm một yêu cầu nhỏ chạm hai flow khác nhau. Kỳ vọng: Trợ Lý tạo interaction `ask_user_questions`, gốc `blocked`, không có con. Owner trả lời ("vi, en") → Trợ Lý được đánh thức, đăng `crew-plan`, tạo ≥ 3 con: 2 con cùng `crew-bundle id=greet` (seq 1, 2; con 2 có `blockedByIssueIds=[con 1]` và `crew-stack on=<con 1>`) giao executor X, 1 con gói khác (ví dụ README) giao executor Y; mỗi con có `crew-model` và `assignee_adapter_overrides.adapterConfig.model` khớp. Run của Y chạy chồng thời gian với run của X (DB `heartbeat_runs.started_at/finished_at`). Run đầu của con 2: `context_snapshot.resumeFromRunId` = `agent_task_sessions(task_key=<con 1>).last_run_id`; event `adapter.invoke` có `--resume <session con 1>`; `session_id_before` = `session_id_after` = session con 1; activity `crew.bundle_resume` đúng một lần. Đối chứng: run đầu con gói khác không có `--resume`. Cả 3 con qua reviewer; mọi con `done` → Trợ Lý `crew-assistant done …` → reviewer → integrator (`crew-docs-check … exit=0`) → owner approve → integrator push (`crew-merge … pushed=yes`), `origin/main` chứa commit của cả 3 con.
  - 4b **Bug:** seed trước một lỗi nhỏ trong repo thử (`greet("")` trả `"Hello, !"`), owner mô tả triệu chứng. Kỳ vọng: Trợ Lý tạo 1 con (không hỏi), executor dùng `superpowers:systematic-debugging` (thấy trong transcript), test đỏ trước rồi xanh, luồng 4 stage tới push.
  - 4c **Research:** issue gốc nhãn `research` "So sánh hai cách định dạng tên trong `greet`, đề xuất một". Kỳ vọng: policy 2 stage; Trợ Lý tạo con có `crew-kind research`; executor comment `crew-report`, không commit (`git log` worktree executor không có commit mới từ run đó); reviewer `crew-review research verdict=approved`; Trợ Lý `done` gốc → reviewer → owner approve → `done`; không có run integrator nào trên gốc, không có activity `crew.policy.board_override`.
  - Chung: file chưa commit của owner trong `repo-a` còn nguyên; không còn process `claude` mồ côi (`ps`) sau cùng; mọi run giữ cổng tải có activity `crew.load_gate.*`.
- [ ] **Cổng 5 — docs khớp code.** Repo thử: bằng chứng `crew-docs-check … exit=0` của integrator trên merged commit (4a, 4b). Repo Crew: R1-3 không đổi nguồn ⇒ không áp dụng (ghi rõ); nếu có đổi thì `crew-docs check --range <v3 gốc>..HEAD` đạt.
- [ ] **Dọn:** issue thử còn mở chuyển `cancelled` bằng board; dừng mọi process trong `processes.md`; giữ agent/environment mới (dùng tiếp R1-4) và ghi id vào ledger; `superpowers:finishing-a-development-branch` gộp `crew/r1-3` → `v3` cục bộ, không push.

**Điểm dừng owner:** chỉ khi Cổng 2c thấy agent tự sửa được `adapterConfig`, khi muốn push, hoặc khi cổng tải giữ run quá 60 phút liền vì Mac tải cao (hỏi owner tạm tắt emulator). Deploy spike, tạo agent/environment, `~/crew-agents`: không hỏi lại (đã duyệt), ghi ledger.

## Self-review

- **Phủ phạm vi:** agent Trợ Lý là assignee gốc (RA-1, EN-1); đọc docs + Superpowers brainstorm/plan (RA-1); issue con có blocker + policy H4 (RA-1 dùng REST, H4 sẵn có); gói → cùng executor nối tiếp + chung session O12 (RA-1 marker, SP-1/BR-1); chọn model O14 + port bảng v2 (PO-1, RA-1); hỏi owner `ask_user_questions` + `blocked` (RA-1, Cổng 4a); research O15 bằng nhãn → template (PO-2, RA-1, RA-3, Cổng 4c); `assistant.md` + `apply-roles.sh` (RA-1, RA-2); `CREW_POLICY_CONFIG` không cần vai trò `assistant` (ruling); lọc override (PO-1, Cổng 2a); 2 executor O13 (EN-1, RA-1 phân gói, Cổng 4a); AC-3 (Cổng 1–5); tài nguyên (Global Constraints). `workflow-policy`/`completion-policy` v2 không port (đã thay bằng ghim R1-2 và H2) — ruling.
- **Placeholder:** đã quét `TBD`, `TODO`, `implement later`, `similar to` trên mọi file của plan: không có. Nhánh no-go của SP-1 có bước cụ thể trong [session.md](session.md).
- **Nhất quán interface:** `CREW_BUNDLE_RE`, `parseCrewBundle`, `applyBundleResume`, `CREW_COMPLEXITY_MODEL`, `CREW_ALLOWED_MODELS`, `checkAgentAdapterOverrides`, `crew_override_forbidden`, `buildCrewPolicy("research")`, `CREW_RESEARCH_LABEL`, các dòng `crew-*` đã đối chiếu giữa spec, `session.md`, `policy.md`, `roles.md`.
- **Review Focus:** 1 → PO-1; 2–3 → SP-1, BR-1; 4 → PO-2, RA-3; 5 → RA-1, Cổng 4.
- **Sở hữu file:** ba gói fork ghi tập file rời nhau; `core-hooks.ts` chỉ `session` ghi.

Câu hỏi còn mở cho owner nằm cuối [sdd-ledger.md](sdd-ledger.md).
