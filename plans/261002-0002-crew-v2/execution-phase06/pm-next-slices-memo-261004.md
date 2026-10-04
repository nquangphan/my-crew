# Memo PM — rulings và lát cắt kế tiếp phase06 (04/10/2026)

Tác giả: Kongming (advisory, chạy trên Claude Fable 5.1). Memo này là tư vấn để PM ban hành ruling; không sửa source. Mọi trích dẫn `file:line` đọc trực tiếp trên worktree `/Volumes/CORSAIR/Projects/my-crew-v2`, nhánh `codex/crew-v2-server`, HEAD `711cf6f` (B2a đã nghiệm thu tại `213cc5d`).

Nguồn đã đọc: handover `plans/reports/handover-261004-0913-crew-v2.md`; spec §3, §5, §6, §8, §12; `phase-06-assistant-workflows.md` (Global Constraints, G1–G4, bảng ownership T1–T7, R1–R4, T2/T3/T4/T5 checklists); `execution-phase06/progress.md`; `task-2-slice-b-preflight.md`, `task-2-slice-b2-preflight.md`, `task-2-slice-b2a-review.md`, `task-3-next-slice-preflight.md`, `task-3-d1-render-inspection-plan.md`, `task-3-d1-report.md`; source `tickets/service.ts`, `tickets/contracts.ts`, `execution/attempts.ts`, `execution/commands.ts`, `assistant/authority.ts`, `assistant/contracts.ts`, `attachments/routing.ts`, `attachments/grants.ts`, `gateway/src/assistant/{workflow-manifest,render-artifacts}.ts`, `gateway/src/isolation/{workspace,inventory}.ts`, `gateway/src/workflows/registry.ts`, `server/src/gateway/service.ts`, migrations 004/005/007/009/011, `test/support/assistant.ts`, `phase07/task-2-brief.md`.

## TL;DR

1. Tách B2b: release ngay **B2b-i** = `assistantSignalTicket` cho `dependencies_ready` và `wait_owner` trên ticket **không** running; nhánh running `wait_owner` fail-closed 409 `EXECUTION_PROOF_REQUIRED`, không chạm `attempts.ts`/`commands.ts`. **B2b-ii** (running `wait_owner`, `createAssistantCommand`) gộp vào lát T4 dispatch/retirement; từ nay `execution/commands.ts` chỉ có một writer là T4.
2. Linkage B3/B4 chốt bằng rows đã có (009 + 011), không SQL mới: `fence → assistant_turns`, `scopeId → assistant_scopes`, `operationId → assistant_tool_operations` (ghi cùng Tx, trước port), new-root bind qua `attachment_message_decisions.kind='routing'` body chứa `ticketSha256 == targetSha256`.
3. Positive Actor resolver (B5) làm **ngay** như pure persisted-row verification (scope→turn→admission session→selection→policy receipt PASS cùng deployment + pinned verifier); production vẫn deny vì **không có row**, không vì stub. Đây là producer mà T3/T4/T5 đang chờ.
4. T3: `{project-root}` ≡ execution workspace của attempt trên máy B; BMAD definition tách hai tầng (definition từ registry, render receipt latch sau); receipt lưu bằng `evidence.data` (004) qua kênh attempt artifact hiện có, latch vào `workflow_runs.rendered_artifact_id`; customization digest là một canonical context chung cho cả hai workflow; gate answer route là composition mỏng trên `gates.ts` của T3.
5. Không ruling nào cần owner duyệt. Owner chỉ cần **biết** hai việc vận hành: máy dự án phải cài `uv` để chạy BMAD, và integration test chạy `uv` thật cần slot nặng + pinned archive (không chi phí, không provider).

## A. Rulings

### A1. B2b seam signal/command

**Ruling.** Tách B2b thành hai:

- **B2b-i (release ngay):** `assistantSignalTicket(tx, actor, proof, ticketId, signal:'dependencies_ready'|'wait_owner', expectedRevision)` theo đúng signature G1 (`phase-06:79`, `task-2-slice-b2-preflight.md:75–76`). Hash payload freeze `{ticketId, signal, expectedRevision}` theo cùng tuple `['crew-v2:orchestration-target:1', 'signal', payload]` của B1/B2a. Tách `signalTicketWithDependencies` (`tickets/service.ts:360–430`) thành `prepareSignal` (lock root→target, CAS revision, dependencies_ready kiểm predecessor done, repair-limit check) và `persistSignal` (UPDATE + event) dùng chung cho generic và scoped, như `prepareDecision`/`persistDecision` ở B2a. Nhánh `signal==='wait_owner' && status==='running'` trong scoped entry **luôn** ném 409 `EXECUTION_PROOF_REQUIRED` (mã sẵn có tại `service.ts:379–380`), bất kể `deps.execution`; test phải khẳng định không có row `commands` mới, `attempts.terminal_intent` không đổi, revision không đổi. `resume`/`start`/`passed` không nằm trong union kiểu và bị 400 ở runtime. Repair-limit continuation (`service.ts:360–377`) chỉ owner tiêu được, scoped không chạm.
- **B2b-ii (defer, gộp vào lát T4 dispatch):** `createAssistantCommand` và running `wait_owner` qua prepared terminal-intent. Từ ruling này `execution/commands.ts` **chỉ T4 sửa** (retirement helper `retireUnclaimedCommand`, `phase-06:258`, và `prepareDispatch` "atomically writes decision + command + ...", `phase-06:306`); T2 không mở lát riêng cho `createAssistantCommand`. `attempts.ts` chỉ transfer trong lát R4 của T4 vì lock union command/attempt/reservation/launch-authorization (`phase-06:254`) do T4 định nghĩa.

**Vì sao.** Nhánh running hiện đi `service.ts:383` → `deps.execution.requestTerminalIntent(tx, ticketId, 'needs_input', reason)` — contract **không có Actor** (`tickets/contracts.ts:77–80`) → `attempts.ts:389–393` gọi `setTerminalIntent(..., { kind:'owner', id:'owner' })` → `attempts.ts:553–577` khóa attempt rồi gọi generic `createCommand` với actor owner để vượt check `actor.kind==='machine' && actor.id!==input.machineId` (`commands.ts:39`). Scoped A→B không thể reuse callback này (synthetic owner) và cũng không thể sửa `attempts.ts` mà không chồng T4. Kiểm tra consumer: T3 `createRun` cần `create_ticket`/`dependency`/`decision`; T5 `nextReadyTasks` cần `dependencies_ready`; không consumer nào trước T4/T6 cần running `wait_owner` hay `command`. Lock order kế hoạch (`phase-06:144`) đặt "existing command row for claim/retire" ngay sau root — đúng union mà T4 sở hữu.

**Chi phí nếu sai.** Nếu sau này Trợ lý cần dừng ticket đang chạy trước khi T4 xong: scoped trả 409, Trợ lý tạo câu hỏi owner, owner dùng route pause hiện có (`execution/routes.ts:176–217`). Suy giảm chức năng, không mất an toàn, không rework schema. **Owner:** không cần.

### A2. B3 input / B4 routing — exact persisted decision/input/turn linkage

**Ruling.** Linkage là quy tắc derivation mà `ProjectOrchestrationAuthority.verify` (lát S2) và router scoped (B4) phải thực thi, dùng toàn rows đã có:

| Thành phần proof | Row bắt buộc | Điều kiện |
|---|---|---|
| `fence` | `assistant_turns` + designation | `assertCurrentTurnFence(tx, fence, 'claim')` (`assistant/store.ts:42`, đã có từ T1). Actor A **suy từ** `assistant_designations.machine_id` của `fence.designationId`; caller actor phải bằng; không bao giờ lấy từ body. |
| `scopeId` | `assistant_scopes` (011:91–101) | `turn_id = fence.turnId`, `expires_at > clock_timestamp()`, `actions ∋ action`; đã có ở Slice A (`authority.ts:119–126`). |
| `operationId` | `assistant_tool_operations` (011:244–252) | Row `state='pending'` của cùng `turn_id`, `input_snapshot_id = scope.input_snapshot_id`, ghi **cùng Tx, trước khi gọi port** bởi tools route (R2, `phase-06:224`). `request_hash` ràng buộc bền toàn bộ request (kể cả `CreateTicket`). Mọi hành động ngoài tools route (vd. `/v2/assistant/actions`) cũng phải tạo row này trước. |
| Input ↔ turn | `attachment_assistant_sessions` (009:172–182) | `assistant_turns.read_session_id → session`; `session.snapshot_id = scope.input_snapshot_id`; `turn.admission_id = session.admission_id`; `session.process_instance_id = fence.processInstanceId`. Đây là linkage input/turn cho B3. |
| New root (`create_ticket`, `scope.message_id` non-null) | `attachment_message_decisions` (009:91–97) | Router B4 ghi decision `kind='routing'` **cùng Tx** với `body = {operationId, scopeId, ticketSha256}` và `sha256`; `decision.snapshot_id = scope.input_snapshot_id`, `decision.input_revision` = current. `verify` so `ticketSha256 == targetSha256` (hash B1). Child ticket: membership `scope.root_ticket_id` (đã có trong `prepare` B1/B2a). |
| Derived consent (R3) | `assistant_route_authorizations` (011:223–229) | Giữ nguyên thiết kế R3 (`phase-06:241`); không mở rộng ở memo này. |

Hai ⚠️ carried từ B2a (`task-2-slice-b2a-review.md:36–38`):

- Dependency không có actor column → provenance = row `assistant_tool_operations` (turn→designation→machine A) + journal actor A của mutator. Không thêm cột. Brief B3/S2 ghi rõ là yêu cầu bắt buộc.
- Lỗi 404/409/422 trước `verify` cho phép dò tồn tại → **transport** (`/v2/assistant/actions`, `/v2/assistant/turns/:id/tools`) phải resolve `proof → scope` (404 `ASSISTANT_SCOPE_NOT_FOUND` / 409 stale / 503) **trước** mọi truy vấn ticket. Trong port giữ thứ tự prepare-trước-verify theo lock order kế hoạch.

**Vì sao.** `phase-06:283` ("New root only persisted routing message decision authorizes exact CreateTicket hash; children inherit exact root scope"), `phase-06:241` (R3: `context.decisionId → persisted message decision → exact active TurnFence/OrchestrationProof`), `phase-06:224` (consumer derives proof từ persisted turn/scope/operationId; "model cannot mint scopeId"). Migration 011 đã freeze, `assistant_operation_ids` có `run_id NOT NULL` (011:201–208) nên không dùng được trước khi có run; `assistant_tool_operations` là chỗ đúng.

**Chi phí nếu sai.** Chỉ logic verify + tests; rows không đổi. Reversible. **Owner:** không cần.

### A3. B5 — positive persisted Actor resolver (production default-deny)

**Ruling.** Implement positive resolver **ngay** (lát S2), là pure persisted-row verification, không stub, không test-trust port: thay `throw ASSISTANT_ADMISSION_NOT_CONFIGURED` cuối `createPersistedAssistantActorResolver` (`authority.ts:127`) bằng chuỗi:

1. `turn.admission_id` null → giữ 503 `ASSISTANT_ADMISSION_NOT_CONFIGURED` (đây là trạng thái production hôm nay).
2. `attachment_assistant_sessions` theo `admission_id`: `state in ('reserved','running')`, `expires_at > clock_timestamp()` (sau lock, bài học Slice A), `machine_id = designation.machine_id`, `process_instance_id = fence.processInstanceId`, `designation_revision = fence.designationRevision`, `model_selection_id = turn.model_selection_id`.
3. `assistant_model_selections` → `assistant_policy_receipts`: `status='PASS'`, `revoked_at is null`, `expires_at > now`, `deployment_id = assistant_config.deployment_id`, `verifier_build_sha256 =` hằng pinned inject lúc assembly (`createPersistedAssistantActorResolver({verifierBuildSha256})`); `routing_capability_receipts` current.
4. UNVERIFIED/FAIL/expired/revoked/sai deployment/sai verifier → 403; không bao giờ fallback.
5. Trả `{kind:'machine', id: designation.machine_id}`.

Test: fixture `seedTurn` hiện cố ý ghi receipt UNVERIFIED và không có admission (`test/support/assistant.ts:631–684`). Thêm `seedAdmittedTurn` (test-only, ghi session + PASS receipt với verifier hằng của fixture). File fixture do T1 sở hữu → PM re-release để S2 sửa.

**Vì sao.** `phase-06:187`: "Normal assembly trusts receipts issued by its pinned verifier and deployment ID in the same DB; fixture/test DB receipts cannot be copied/imported as production authority." Deny production phải đến từ **không có PASS receipt** (R1 live chưa chạy), không từ `throw` cố định. Mọi consumer T3/T4/T5 đang bị chặn bởi "Positive resolver and orchestration producer absent" (`task-3-next-slice-preflight.md:35`). Nếu không làm, mỗi test T3/T4 lại tạo test-trust allowlist riêng — chính là trap C5.

**Chi phí nếu sai.** Nếu check deployment/verifier lỏng, DB copy có thể cấp quyền — mitigated bằng hai so sánh trên. Sửa lại chỉ chạm `authority.ts` + tests. **Owner:** không cần. Modify frozen Slice A `authority.ts` nằm trong quyền PM re-release.

### A4. T3 — operational render root / path equivalence

**Ruling.** `{project-root}` **≡ đường dẫn tuyệt đối của execution workspace đã prepare cho attempt trên máy B**. Không scratch root, không pre-render trên máy Trợ lý hay server. Materialize `_bmad/` (scripts + `config.toml`) và `.claude/skills/bmad-build/` từ projection đã pin vào workspace **dưới dạng file thường (copy, không symlink)**, ghi vào `record.entries` như injected entries để `auditWorkspace` sau không coi là blocker; renderer được Crew chạy có giới hạn **trong workspace đó trước khi runtime khởi động**; lệnh `uv run` mà runtime tự gọi theo SKILL sau đó gặp generation byte-identical (renderer kiểm byte, không ghi đè — `task-3-next-slice-preflight.md:9`).

**Vì sao.** `root_hash = sha256(UTF8(projectRoot))[:12]` và nằm trong destination path (`task-3-d1-render-inspection-plan.md`, "Exact official format evidence"); bất kỳ root nào khác cho generation khác → receipt không khớp runtime. `inventory.ts:107` liệt `_bmad` là discovery directory bị loại khỏi workspace; `workspace.ts:503–515` đã có pattern inject (`.agents/skills` cho codex) và audit `after` chỉ chấp nhận entry đã khai báo. Copy thay vì symlink vì renderer ghi `_bmad/render/` và registry publication là immutable (`runBmadInstaller` publish immutable, `task-3-next-slice-preflight.md:11`).

**Ownership.** Cần transfer `v2/gateway/src/isolation/workspace.ts` (+ `inventory.ts` nếu cần khai báo injected entries) từ phase03 cho lát S6 với phase03-owner review — PM quyết, không cần owner.

**Chi phí nếu sai.** Nếu cwd của runtime ≠ workspace root, receipt lệch → T4 admission deny, run chờ; không hỏng dữ liệu; reversible. **Owner:** không cần.

### A5. T3 — bounded `uv` execution, receipt transport/storage, definition lookup

**Ruling (ba phần, không SQL mới, không route mới):**

1. **BMAD definition hai tầng.** `loadDefinition(source, projection)` nhánh BMAD không còn ném `RENDER_ARTIFACT_REQUIRED` (`workflow-manifest.ts:51`); nó resolve registry, chọn cây `bmad-build` (`.md` trừ `SKILL.md`, `customize.toml`), `_bmad/scripts/{render_skill,config_utils}.py` và 7 layer paths (`render-artifacts.ts:11–18`) từ projection, trả `{sha256, skills, customizationSha256, render: Omit<CapturedRenderExpectation,'projectRoot'|'generationRoot'>}`. Deny BMAD chuyển xuống server: `createRun` path `bmad-*` insert `rendered_artifact_id = null`; T4 admission từ chối dispatch BMAD khi null. Việc này tháo vòng lặp render→workspace→attempt→run.
2. **Receipt = `evidence` row 004** (`004:78–85`, `data jsonb`), `kind='workflow_render_receipt'`, `attempt_id` non-null, `data = {definitionSha256, customizationSha256, projectRoot, generationPath, inspection: RenderArtifactInspection, witness: {uvPath, uvSha256, uvVersion, argv, exitCode, stdoutPath, startedAt, endedAt, operationId}}`. Máy B đăng ký qua đúng lock recipe của `registerArtifactEvidence` (`attempts.ts:285–300`: `lockedAttempt` + `assertCurrent` + fence) — thêm hàm chị em `registerRenderReceipt` trong lát S6 (transfer `attempts.ts` giới hạn hàm mới, không chạm callback 389–393). Server T3 `latchRenderedArtifact(tx, runId, evidenceId)` kiểm: evidence thuộc attempt của step ticket trong run, máy = binding hiện tại, `definitionSha256`/`customizationSha256`/`projectRoot` khớp run và workspace record, rồi set `workflow_runs.rendered_artifact_id` (cột duy nhất trigger cho đổi, `011:118`, `task-3-next-slice-preflight.md:24`) và tăng revision.
3. **Definition lookup bền và authenticated = install report 007.** Gateway sync (`v2/gateway/src/sync/gateway-sync.ts`) thêm field additive `definitions` vào `workflow_status[workflow].projections[runtime]` (sha256 + skills + customizationSha256) khi báo cáo cài đặt; server đã lưu `gateway_applied.workflow_status` và `gateway_install_reports.report` (`server/src/gateway/service.ts:287–291`). `createRun` lookup `DefinitionLookup(tx, machineId, definitionSha256)` đọc `gateway_applied` của máy B; `definitionSha256` từ tool `create_run` chỉ là khóa tra cứu (`task-3-next-slice-preflight.md:18`). Frozen RoutingTool `create_run` không đổi.
4. **Executor `uv`.** Chạy trên B trong lát S6 qua `OwnedOperations` (`gateway/src/workflows/operations.ts:32`) — cùng primitive với `runBmadInstaller`; private env, không network, bounded time/output/process closure; ghi `uv` path/sha256/version; nonzero/unavailable/unknown child/stdout path lệch → không receipt, HALT. `uv` là prerequisite owner cài trên máy dự án (như Node/Claude/Codex); install report ghi uv identity; receipt phải khớp install report.

**Vì sao.** Migration 001–011 freeze; `workflow_runs.rendered_artifact_id` là uuid trần (011:118) đúng để trỏ `evidence.id`; kênh evidence đã machine-authenticated và fence-bound; install report đã machine-authenticated với `body_hash`. Spec §5: "Mỗi run ghim workflow, version và revision ngay từ đầu" — definition hai tầng giữ đúng điều đó (pins immutable lúc tạo run, artifact latch sau).

**Chi phí nếu sai.** Nếu evidence-as-receipt về sau không đủ, thêm migration 012 bảng receipt và backfill từ `evidence.data` — reversible. Nếu `uv run --no-cache` cần network để lấy Python, executor HALT và báo; không retry, không hạ sandbox; khi đó cần ruling riêng về prerequisite Python trên B. **Owner:** không cần duyệt; cần **thông báo** prerequisite `uv` cho máy dự án.

### A6. Superpowers no-customization digest

**Ruling.** Một canonical context chung cho cả hai workflow:

```ts
customizationSha256 = sha256(canonicalJson({
  schema: 'crew-v2:workflow-customization:1',
  workflow: source.name,                 // 'superpowers' | 'bmad'
  sourceTreeSha256: source.sourceTreeSha256,
  projectionTreeSha256: projection.treeSha256,
  layers,                                // BMAD: 7 layer → sha256|null (đo từ projection); Superpowers: {}
}))
```

Superpowers `layers = {}` là **phát biểu đo được** (projection đã pin không chứa layer tùy biến nào) và được ràng vào `projectionTreeSha256`, nên không phải hằng placeholder; đổi projection → đổi digest. Tại dispatch, T4 đối chiếu `record.exclusions` của workspace (`workspace.ts:496–504`; `inventory.ts:99–116` loại `.claude`, `.codex`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json`…) để chứng minh không customization cấp project lọt vào runtime.

**Chi phí nếu sai.** Digest đổi chỉ ảnh hưởng run mới (cột immutable). **Owner:** không cần.

### A7. T2 positive Actor/G1 và owner gate approval route

**Ruling.** Positive Actor: A3. G1 còn thiếu `command` → A1 (gộp T4). Gate approval:

- T3 `gates.ts` sở hữu `createOwnerQuestion(tx, proof, proposal)` và `recordGateAnswer(tx, ownerActor, {questionId, expectedRevision, scopeSha256, artifactSha256, answer})` làm **một Tx**: lock root → step ticket → gate → question; gọi generic `recordDecision` với actor owner, `kind` theo `required_actor` của gate (`approval` cho mandatory owner gate, `owner_answer` cho câu hỏi), `scope = {questionId, questionRevision, gateId, runId, stepId, artifactSha256, scopeSha256}`; insert `assistant_answers`; gọi `answerGate(tx, questionId, decisionId)` (signature frozen `phase-06:289`). Machine actor 403; sai revision/scope/artifact 409.
- Route `POST /v2/assistant/questions/:id/answers` (`phase-06:155`) là edit controller mỏng vào `assistant/routes.ts` sau khi S5 được review; không mở trong lát worker.

**Vì sao.** `decisions.ts` đã giới hạn `approval`/`owner_answer` cho owner (`task-2-slice-b2-preflight.md:9`); `answerGate` cần so decision kind/actor/root/scope/revision/artifact (`task-3-next-slice-preflight.md:25`). **Owner:** không cần.

## B. Lát cắt kế tiếp (thứ tự phụ thuộc)

Quy ước chung cho mọi lát: RED semantic thật trước source; một job PG/Node nặng tại một thời điểm qua lock `$TMPDIR/crew-v2-heavy-slot.lock`; typecheck/Biome scoped; PM serialize `v2/docs/flows.yaml` + flow docs + commit; worker không chạm file peer. Web phase07 Task2 sở hữu `v2/web/src/{contracts,lib,auth}/*`, `v2/web/test/*`, `v2/web/e2e/{auth,events}.spec.ts` — **không giao với bất kỳ lát nào dưới đây**; chỉ tranh slot nặng.

### S1 — T2-B2b-i: scoped signal (dependencies_ready, non-running wait_owner)

- **Ownership.** MODIFY `v2/server/src/tickets/service.ts` (tách `prepareSignal`/`persistSignal`, thêm `createAssistantSignalWriter`, nối `assistantSignalTicket` vào `createTicketServices`); MODIFY `v2/server/test/assistant-mutations.test.ts` (dùng lại `testTrust()`); không chạm `assistant-access.ts` trừ khi cần export `invalidScope`/`uuid` (M2 deferred — cho phép làm nhân tiện, nhỏ).
- **Produces.** `assistantSignalTicket(tx, actor, proof, ticketId, signal, expectedRevision): Promise<Ticket>`; hash payload `{ticketId, signal, expectedRevision}`.
- **Consumes.** `ProjectOrchestrationAuthority` (test-trust), core B1/B2a helper.
- **RED có nghĩa.** (1) A→B qua HTTP generic `/v2/tickets/:id/signals` 404; (2) không authority 503, không đổi revision; (3) sai proof/hash/action/Tx deny, state không đổi; (4) `dependencies_ready` với predecessor chưa done 409, với tất cả done → `ready`, revision+1, event; (5) `wait_owner` trên pending/ready → `needs_input`, `wait_reason='owner_input'`, revision+1; (6) **`wait_owner` trên running → 409 `EXECUTION_PROOF_REQUIRED`, `count(commands)` không đổi, `attempts.terminal_intent` null, không event** — test chốt "không synthetic owner"; (7) stale revision 409; (8) `resume`/`start`/`passed` 400; (9) repair-limit ticket: scoped `wait_owner` không tiêu decision continuation; (10) hai connection: signal và dependency opposite edge serialize trên root.
- **Acceptance.** Raw RED/GREEN logs + hash; affected tests (B1 47 + B2a 55 + mới) PASS; scoped strict tsc + Biome; full independent review (spec + quality); flow `server-tickets.md` chỉ mô tả hành vi (M5).
- **Heavy.** 2 slot PG (RED, GREEN) + 1 slot checks.
- **Song song.** Với web Task2: có. Với S3: có (gateway). Với S2: S2 chờ S1 commit để compose `signal`.

### S2 — T2-C: positive persisted Actor resolver + `assistant/orchestration.ts`

- **Ownership.** MODIFY `v2/server/src/assistant/authority.ts` (re-release Slice A, chỉ hàm resolver + deps `verifierBuildSha256`); CREATE `v2/server/src/assistant/orchestration.ts` (`createProjectOrchestrationPort({tickets, resolver}): ProjectOrchestrationPort` + `createPersistedOrchestrationAuthority(resolver): ProjectOrchestrationAuthority` thực thi A2); MODIFY `v2/server/test/support/assistant.ts` (thêm `seedAdmittedTurn`, `seedToolOperation`); MODIFY `v2/server/test/assistant-authority.test.ts`; CREATE `v2/server/test/assistant-orchestration-port.test.ts`.
- **Produces.** `ProjectOrchestrationPort` thật (createTicket/decision/dependency/signal; `command` ném 503 `ORCHESTRATION_COMMAND_NOT_RELEASED` tới T4); `PersistedAssistantActorResolver` positive.
- **Consumes.** S1 (`assistantSignalTicket`), B1/B2a methods, 009 sessions, 011 turns/scopes/tool_operations/receipts.
- **RED có nghĩa.** (1) Turn không admission → 503 như hôm nay; (2) seeded admission + PASS receipt cùng deployment + đúng verifier → port `createTicket` A→B thành công, journal/created_actor = A, **không test-trust port**; (3) receipt UNVERIFIED/FAIL/expired/revoked, sai deployment, sai verifier, session expired (đo sau lock), sai processInstanceId, sai designation revision → 403, rows không đổi; (4) `operationId` không có row pending cùng turn, hoặc snapshot lệch scope → 404/409; (5) action ∉ `scope.actions` → 403; (6) new-root `create_ticket` không có routing decision cùng Tx hoặc `ticketSha256 ≠ targetSha256` → 403; child ngoài `root_ticket_id` → 404; (7) caller actor ≠ designation machine → 403 dù proof hợp lệ; (8) generic routes vẫn 404; (9) `command` → 503.
- **Acceptance.** Như S1 + review bảo mật G1 (đọc toàn bộ caller/lock order); ghi rõ production assembly chưa inject (vẫn 503 trong app).
- **Heavy.** 2–3 slot PG.
- **Song song.** Với web Task2 và S3: có.

### S3 — T3-D2: gateway definition v2 (BMAD hai tầng + customization context)

- **Ownership.** MODIFY `v2/gateway/src/assistant/workflow-manifest.ts` (re-release), MODIFY `v2/gateway/test/workflow-manifest.test.ts`, CREATE/MODIFY `v2/gateway/test/fixtures/workflow-definitions/*` (T3 đã sở hữu). Không chạm `render-artifacts.ts`, `registry.ts`, `builder.ts`, workspace, sync.
- **Produces.** `WorkflowDefinition = {sha256, skills, customizationSha256, render?: {source, projection, selectedProjectionSha256, layers}}`; hàm thuần `customizationContext(source, projection, layers)` dùng chung.
- **Consumes.** `WorkflowRegistry.resolve`, D1 types `CapturedRenderExpectation`/`RenderLayerPath`.
- **RED có nghĩa.** (1) Superpowers digest đổi khi `projection.treeSha256` đổi, giữ nguyên khi chỉ đổi ordering; (2) BMAD: `loadDefinition` trả render expectation với đúng 7 layer từ projection, required layer thiếu → `WORKFLOW_SKILL_MISMATCH`; (3) layer optional có/không → digest khác dù resolved tokens bằng nhau; (4) BMAD skills = đúng tập `.md` của `bmad-build` trừ `SKILL.md`, phải có `workflow.md`; (5) pin lệch source/projection → `SOURCE_PROJECTION_MISMATCH`; (6) không có uv/renderer/process nào được spawn (assert không child).
- **Acceptance.** Gateway affected tests, full gateway tsc, scoped Biome; independent review; flow `assistant-workflows.md`.
- **Heavy.** Node gateway, không PG, 1–2 slot ngắn.
- **Song song.** Với S1/S2/web: có (khác package).

### S3b — phase03 transfer nhỏ: install report mang `definitions`

- **Ownership.** MODIFY `v2/gateway/src/sync/gateway-sync.ts` (+ contract type ở `v2/gateway/src/commands/contracts.ts` nếu DTO report nằm đó), MODIFY `v2/server/src/gateway/service.ts` (chấp nhận field additive, lưu vào `workflow_status`), tests tương ứng hiện có. Phase03-owner review bắt buộc; không đổi `body_hash` semantics.
- **Produces.** `gateway_applied.workflow_status[...].projections[runtime].definition = {sha256, skills, customizationSha256}`.
- **RED.** Report thiếu `definition` vẫn accepted (backward); server lưu nguyên; `definition.sha256` lệch pin → không accepted.
- **Heavy.** 1 slot PG. **Song song.** Với S4 authoring (S4 inject `DefinitionLookup`, test seed row 007).

### S4 — T3-S1: server `createRun` graph (Superpowers 4 path + BMAD 2 path chưa artifact)

- **Ownership.** CREATE `v2/server/src/assistant/workflows.ts` (`DefinitionLookup`, mapping source → steps/gates theo `phase-06:290–295`, `task-3-next-slice-preflight.md:23`), CREATE `v2/server/src/assistant/runs.ts` (`createRun(tx, proof, input)`, `latchRenderedArtifact`), CREATE `v2/server/test/assistant-workflows.test.ts`. Không chạm `gates.ts` HTTP.
- **Produces.** `createRun` frozen signature → `WorkflowRun`; steps/tickets/dependencies qua port S2 với `assistant_operation_ids` riêng từng child (`011:201–208`); gate UUID reserve trong `workflow_steps.gate_ids`, **không** insert `workflow_gates` khi chưa có artifact.
- **Consumes.** S2 port + resolver, S3b lookup (fixture seed 007 trong unit), 011 workflow tables.
- **RED có nghĩa.** (1) Hash không có trong lookup của máy B hiện tại → 422, không row; (2) resolver 503 → không row; (3) `architectural`: `steps[0].sourcePath === 'skills/brainstorming/SKILL.md'`, chuỗi design→spec approval→plan→implementation với gate reserved; `bounded`/`bug`/`spike` đúng mapping; (4) `bmad-dispatch`/`bmad-oneshot`: run tạo với `rendered_artifact_id=null`, `latchRenderedArtifact` sai máy/attempt/definition/projectRoot → 409, đúng → set và revision+1, latch lần hai → 409; (5) SQL immutability: UPDATE source/projection/definition/customization bị trigger từ chối; (6) child tickets có `created_actor = A`, dependency DAG đúng, mặc định sequential (không parallel approval → implementation tasks nối tiếp); (7) `parallelApprovalId` trỏ decision không phải owner → 403.
- **Acceptance.** Như S1; review official-source mapping (đối chiếu bytes Superpowers 6.4.2 đã pin).
- **Heavy.** 2–3 slot PG.
- **Song song.** Với web Task2 và S3/S3b: có. Chờ S2.

### S5 — T3-S2: gates (`createOwnerQuestion`, `recordGateAnswer`, `answerGate`)

- **Ownership.** CREATE `v2/server/src/assistant/gates.ts`, MODIFY `v2/server/test/assistant-workflows.test.ts` (hoặc CREATE `assistant-gates.test.ts`). Route HTTP là edit controller sau review.
- **RED có nghĩa.** Machine self-answer 403; stale/superseded question 409; sai artifact/scope/revision 409; decision kind sai hoặc actor không owner 403; đúng owner answer advance gate một lần, lần hai 409; gate chưa materialize (artifact chưa có) → câu hỏi gate-bound bị từ chối; parallel approval cho unit phụ thuộc/same path → deny.
- **Heavy.** 2 slot PG. **Song song.** Chờ S4; với web: có.

### S6 — T3-D3: render executor + receipt trên máy B (uv) + workspace materialization

- **Ownership (transfer phase03/02 giới hạn).** MODIFY `v2/gateway/src/isolation/workspace.ts` (+`inventory.ts`) nhánh BMAD materialize; CREATE `v2/gateway/src/assistant/render-executor.ts` (OwnedOperations + D1 inspector + receipt builder); MODIFY `v2/gateway/src/execution/ticket-command-bridge.ts` hoặc `runtime/launch.ts` (gọi executor trước launch cho run BMAD); MODIFY `v2/server/src/execution/attempts.ts` **chỉ thêm** `registerRenderReceipt` + route nhỏ; tests gateway `render-executor.test.ts`, `isolation-workspace.test.ts` (affected).
- **RED có nghĩa.** Unit: executor không spawn khi definition không phải BMAD; manifest/path lệch → không receipt; nonzero/timeout/unknown → HALT không receipt; projectRoot ≠ workspace → deny. Integration (grant riêng, slot nặng, pinned archive, uv local): chạy `uv run --no-cache` **đúng một lần** trong workspace owned, generation xuất hiện ở đúng `{root}/_bmad/render/bmad-build/{slug}-{root12}/{gen20}`, D1 inspect PASS, lần chạy thứ hai không ghi đè, cleanup đúng owned root.
- **Heavy.** Cao nhất: uv + Python + archive install; cần resource gate đầy đủ và báo cáo child closure. Không provider/network.
- **Song song.** Chỉ static authoring song song; execution tuần tự sau S3. Chờ A4 transfer + phase03-owner review.

**Phụ thuộc producer phase04/05 cần nêu:** S1–S5 không cần phase04 native hay phase05 parser corpus. S6 cần phase03 workspace transfer (không phải 04/05). Live admission thật (R1 certifier) vẫn thuộc phase04 native + owner provider/budget — ngoài 6 lát này; các lát trên chỉ dùng seeded rows trong test DB.

**Thứ tự đề nghị:** S1 ∥ S3 → S2 ∥ S3b → S4 → S5 → S6. Slot nặng là tài nguyên hiếm duy nhất; luân phiên S1/S3/web theo lock.

## C. Trap trong cách làm hiện tại và cách gỡ

1. **`createAssistantCommand` như lát độc lập — không có consumer.** Chỉ `prepareDispatch` (T4) tạo lệnh `start` hợp lệ cùng permit/receipt (`phase-06:306`); pause/cancel là owner-intervention (`execution/routes.ts:176–217`). Lát standalone sẽ GREEN trên một half-authority rồi bị T4 bọc lại. Gỡ: A1 — gộp vào T4.
2. **Running `wait_owner` kéo theo `attempts.ts` và synthetic owner.** Reuse callback = fake owner; sửa callback = chồng R4/T4 lock union. Gỡ: fail-closed trong S1, B2b-ii sau T4.
3. **BMAD `loadDefinition` chờ render → vòng lặp render→workspace→attempt→run.** Không lát nào GREEN được nếu giữ `RENDER_ARTIFACT_REQUIRED` ở gateway. Gỡ: A5.1 hai tầng, deny chuyển xuống server admission.
4. **"Durable receipt store" không ai sở hữu vì 011 freeze.** Gỡ: A5.2 dùng `evidence.data` + latch; A5.3 dùng install report cho definition lookup. Không migration mới.
5. **Positive resolver bị khóa sau R1 live.** Nếu coi positive admission = "chờ certifier thật", T3/T4/T5 phải nhân bản `testTrust()` mãi và T7 integration không bao giờ bootstrap qua production route. Gỡ: A3 — resolver là row verification; deny production do thiếu PASS receipt. Sau S2, **cấm** thêm test-trust allowlist mới ở test T3/T4/T5 (B1/B2a giữ nguyên).
6. **Hai writer `commands.ts`** (T2 G1 extension `phase-06:45` vs T4 retirement `phase-06:47,258`). Gỡ: A1 — T4 là writer duy nhất.
7. **Owner `wait_owner` HTTP hiện cũng đi synthetic owner (phase02 behavior).** Không sửa trong phase06 (scope creep); đưa vào whole-branch triage trước merge cùng M1–M6, nêu rõ actor thật là owner nên audit không sai, chỉ xấu về cấu trúc.
8. **Flow docs mang trạng thái tạm** (M5) lặp lại ở mọi lát. Gỡ: brief yêu cầu flow chỉ mô tả hành vi/invariant; count/review state ở report.

## D. Giả định (thay cho câu hỏi)

- Tool route R2 (`/v2/assistant/turns/:id/tools`) sẽ ghi `assistant_tool_operations` row pending trước khi gọi port trong cùng Tx — **cao**; nếu T2 protocol chọn ghi sau, A2 phải đổi sang bind bằng `request_hash` truyền trong prepared context.
- `uv run --no-cache` với `render_skill.py` (stdlib Python) không cần network khi Python đã có trên B — **trung bình**; nếu sai, S6 HALT và cần ruling prerequisite Python.
- Claude Code/Codex chạy BMAD với cwd = workspace root (nên `{project-root}` runtime = workspace) — **cao** (phase03 launch dùng workspace làm cwd); nếu sai, A4 phải map path, không đổi receipt.
- Field additive trong install report không phá `body_hash`/`same()` so pins ở `gateway/service.ts:270–285` — **cao** (so sánh theo `installed` pin, không toàn body).
- Fixture seed PASS receipt trong test DB được chấp nhận theo `phase-06:52,187` — **cao**; nếu PM coi là "allowlist", thay bằng in-process certifier giả lập cũng chỉ là seed khác tên.
