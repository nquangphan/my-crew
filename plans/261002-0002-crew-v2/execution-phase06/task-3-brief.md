# Task06/T3 — Official workflow adapters và run graph

# Crew v2 phase 06 — Trợ lý và workflow runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một Trợ lý định tuyến duy nhất đọc docs/input có provenance, điều phối workflow chính thức, chọn model có căn cứ và theo dõi công việc bền vững qua reconnect.
**Architecture:** Server giữ designation, turn fence, run/DAG, decisions và inbox; inference chạy trên máy Trợ lý owner chọn. Workflow execution vẫn chạy trên máy bind project qua claim005 + projection007 + model008 + input009; phase06 cấp các authority còn mặc định deny, không tạo scheduler/role prompts v1 thứ hai.
**Tech Stack:** Node ≥24.12, TypeScript 7.0.2, pnpm 10.32.1, Fastify 5.12.5, postgres.js 3.4.9/PostgreSQL 18.6, node:test; không thêm dependency runtime mặc định.
**Spec:** `docs/superpowers/specs/2026-10-01-crew-v2-design.md` mục 3–10,12; `plans/261002-0002-crew-v2/plan.md`; phase02–05 cùng thư mục; nghiên cứu `plans/reports/research-261002-crew-v2-assistant.md`.
**Status:** PM approved phase06-r3 sau whole-plan review và hai vòng sửa/re-review; R1–R4/R2a đều closed ở mức kế hoạch. Chưa có implementation011 hoặc live certification PASS. Actual02 Task5 COMPLETE/reviewed tại `9dca04e`; verifier production vẫn deny tới08. Phase05-r2 approved/frozen tại `fc843d2`, SHA256 `6906ca1eafaefe7472c233053a89d6ff83135d6194cb669c58d9671825caf41a`, chưa phải implementation009. Không source/install/model call/commit trong lần sửa plan.

## Global Constraints

- “Mỗi dự án gắn đúng một máy thực thi.” “Nếu máy Trợ lý offline, hệ thống chờ, không tự chuyển Trợ lý sang máy khác.” Một routing Assistant; các execution role chỉ dùng pinned official skills/templates, không viết prompt PM/dev/QC riêng.
- “Tắt nguồn không hủy attempt đang chạy”; admission mới/fallback kiểm desired ON ngay trên server. Exact Assistant turn đã admitted cũng được hoàn tất sau OFF nếu input/designation/grant/security vẫn current; không blanket-revoke vì model config revision đổi.
- “Tối đa 5 vòng sửa và kiểm tra lại cho cùng bước kiểm tra”; infrastructure/model lỗi không đếm/reset; sau thất bại thứ năm hỏi owner đúng cycle và tiêu approval một lần.
- “Trước MỖI lượt dispatch agent thực thi, reviewer hoặc agent sửa lỗi, lấy telemetry mới từ máy đích”; capacity + owner limit + active/reserved jobs + ownership cùng quyết định, không suy số agent từ CPU.
- Owner đã yêu cầu PM chạy task độc lập song song. Lưu explicit owner parallel policy khi thực thi; override quy tắc mặc định sequential chỉ trong scope được duyệt, giữ official skill bytes/templates, dependency/approval/review gates. Không coi mọi task là độc lập.
- V2 độc lập; không dùng v1 roles/business runtime/DB; prose tiếng Việt, identifier tiếng Anh, wire UTC ISO, UI Asia/Ho_Chi_Minh. UI layout/mockup approval thuộc phase07, không mở lại phỏng vấn spec backend đã duyệt.
- SQL mới duy nhất `011_assistant.sql` sau reviewed009; không sửa migration001–009 hoặc frozen DispatchPermit005/DispatchSelection007/ModelDispatchChoice008/RuntimeCheckpoint. Producer gap phải có ownership transfer và review trước consumer assembly.
- Test DB `crew_v2_test_*` trên Docker loopback random port khác5432/55432, không shared/prod/service restart/global install. Backup/restore rehearsal trước011. Paid/live calls chỉ khi có owner-approved provider + bounded budget; triển khai không tự cấp quyền chi phí.

## Review Focus

1. OFF đúng lúc admission/claim; replay response cũ sau config/input đổi không cấp lượt mới (T2/T4/T6).
2. Comment ancestor giữa assessment và claim/reply; attachment-only inbox chưa có project và model thiếu vision (T2/T4/T7).
3. Hai Trợ lý, reassignment khi máy cũ offline, lease hết nhưng process sống; event tới giữa cursor/ACK/restart (T1/T2/T6).
4. Review tự nhận PASS, tasks ghi chung file, capacity vừa thay đổi, năm lần sửa rồi đổi model/ticket để né giới hạn (T3/T4/T5).
5. Cleanup gặp symlink/dirty workspace hoặc merge/docs chưa được verify; monitor không xóa nhầm, lặp suy luận hoặc đóng request sớm (T5/T6/T7).

## Producer → consumer, dependency gate và file ownership

| Producer hiện có/kế hoạch | Phase06 consume chính xác | Gate trước GREEN tích hợp |
|---|---|---|
| 02 actual platform/journal/ticket source | `Actor,Tx,Mutator,AuthorizeDispatch`; `createTicketServices`, `recordDecision`, `recordRepairResult`, `readGraph`; sourceRefs union giữ nguyên | Task5 reviewed9dca04e; Task7 docs read/search và actual005/006 reviewed; default deny còn nguyên |
| 03 reviewed plan | `DispatchCapacity.sampleAndDecide`, `ResourceRegistry`, `HttpOperationJournal`, `ProcessJournal`, `GatewayProjectionPolicy.authorize` | actual007/source+projection/install report/stop proof có tests; host shell tồn tại không chứng minh các port này |
| 04 reviewed plan | `getPool`, `assertModelDispatch`, `ModelDispatchChoice`, `RuntimeAdapter`, `EffectLedger`, `RuntimeCheckpoint` | actual008/certified pair; routing namespace cần G2 dưới đây, không dùng test-certification production |
| 05 reviewed phase05-r2 | `InputSnapshot.comments`, `DispatchInputPin`, `assertDispatchInputsCurrent`, grant/session/admission/receipt + S1–S3/R1/R2 | actual009 trigger fanout/input counter, grant/current-session/transport reviewed; chưa có implementation ở baseline |
| 06 → 07/08/09 | DTO/API bảng dưới; failclosed `FinalEvidencePort`; durable turn drain/stop state | 07 layout duyệt riêng; 08 verifier actual; 09 signed host/drain live |

G1 producer gap: actual `requireProjectScope(tx,projectId,actor)` chỉ cho bound machine; `createTicket`, `recordDecision`, `createCommand` không nhận authority Trợ lý A thao tác metadata của B. T2 phải review extension hẹp `ProjectOrchestrationPort`, không giả `{kind:'owner'}` và không mở generic machine endpoints. G2: RuntimeAdapter04 đòi project attempt/RuntimePin; không bịa attempt cho inbox. T2 xây routing driver riêng qua certified transport/process primitives04 với routing policy receipt011; cần runtime owner handoff. G3: `DispatchCapacity` chỉ trả sample cục bộ, chưa có server receipt/reservation; T4 tạo receipt011 được machine-authenticated rồi atomic claim kiểm. G4: phase08 verifier chưa xây; T7 giữ deny, test fake không thành production completion.

| Task | Create (repo-relative) | Modify sau ownership transfer | Dependency |
|---|---|---|---|
| T1 schema/inbox | `v2/server/migrations/011_assistant.sql`; `v2/server/src/assistant/{contracts,store,inbox}.ts`; `v2/server/test/assistant-store.test.ts`; `v2/server/test/support/assistant.ts` | — | reviewed009; contract unit được chuẩn bị trước |
| T2 designation/read/turn | `v2/server/src/assistant/{authority,turns,docs,orchestration,routes,certification,protocol}.ts`; `v2/server/scripts/certify-routing.ts`; `v2/gateway/src/assistant/{driver,supervisor,transport,certification,tool-client}.ts`; `v2/server/test/{assistant-authority,assistant-turns,assistant-certification,assistant-protocol,assistant-route-integration}.test.ts`; `v2/gateway/test/assistant-driver.test.ts` | phase05 `attachments/{routing,routes,grants}.ts` injected creator/current-route authorization R3; ticket `contracts,service,decisions,dependencies`.ts; execution `commands.ts` chỉ extension G1; Create `v2/server/src/models/routing.ts`, `v2/gateway/src/runtime/routing-transport.ts` after phase04 ownership transfer G2 | T1; G1/G2 review |
| T3 official run graph | `v2/server/src/assistant/{workflows,runs,gates}.ts`; `v2/gateway/src/assistant/workflow-manifest.ts`; `v2/server/test/assistant-workflows.test.ts`; `v2/gateway/test/workflow-manifest.test.ts`; `v2/gateway/test/fixtures/workflow-definitions/*` | — | T1; pinned03 bytes |
| T4 assessment/admission | `v2/server/src/assistant/{assessment,candidates,dispatch,capacity,retirement}.ts`; `v2/gateway/src/assistant/{capacity-report,dispatch-launch}.ts`; `v2/server/test/{assistant-candidates,assistant-dispatch,assistant-retirement}.test.ts` | phase02 commands.ts internal retirement helper; phase03 execution bridge invokes prelaunch authorization R4 | T2/T3, actual03–05 |
| T5 PM/review/resources | `v2/server/src/assistant/{pm,reviews}.ts`; `v2/gateway/src/assistant/resources.ts`; `v2/server/test/assistant-pm.test.ts`; `v2/gateway/test/assistant-resources.test.ts` | — | T3/T4 |
| T6 monitor/recovery | `v2/server/src/assistant/{monitor,recovery}.ts`; `v2/server/test/assistant-monitor.test.ts` | — | T1/T2/T4/T5 |
| T7 assembly/acceptance | `v2/server/src/assistant/{assembly,final-evidence}.ts`; `v2/server/test/assistant-acceptance.test.ts`; `v2/gateway/test/assistant-live.test.ts` | controller: app/main, event-contracts, package test wiring, host entrypoint, docs mapping/generated files | T1–6 + all actual producer gates |

T2 và T3 có thể chạy song song sau T1/frozen contracts; T5 resource wrapper có thể chuẩn bị cùng T4, integration đợi T4. SQL, app wiring, Git index/commit, dependency/lockfiles và docs manifest chỉ controller serialize. Worker không revert/sửa file người khác. Fixture seeds are unit-only; R2/T7 integration must bootstrap through production work/tool routes without seeding assessment/decision/dispatch. T1 fixture exports `assistantFixture(db,clock)` với `owner`, `assistant`, `projectMachine` HTTP clients, `clock.advance(ms)`, `seedCertifiedRouting`, `seedExecutableRun`, `readRows(table)`; seeds chỉ fixture DB, production không import fixture. Mỗi task owns các helper mới nó dùng; không dùng fixture assertion làm quyền production.

## Hợp đồng typed và persistence011

Types nhập đúng producer ở bảng trên; `Id=string(UUID)`, `Sha256=string(lowercase hex64)`. Các declaration dưới nằm `assistant/contracts.ts`; runtime JSON schema strict, byte/hash/enum/revision validation bắt buộc.

```ts
export type TurnFence={turnId:Id;designationId:Id;designationRevision:number;generation:string;processInstanceId:Id};
export type AssistantConfig={designation:AssistantDesignation|null;revision:number;preferred:ModelKey|null;policy:AssistantPolicy};
export type AssistantPolicy={maxJobs:number;telemetryMaxAgeMs:number;maxLoadPerCpu:number;minMemoryBytes:string;minDiskBytes:string;
  maxTurnsPerRun:number;maxToolsPerTurn:number;maxCostUsdPerRun:number;maxTurnMs:number;maxRecoveryAttempts:number;parallelApprovalId:Id|null};
export type AssistantModelSelection={id:Id;turnId:Id;key:ModelKey;modelConfigRevision:number;probeReceiptId:Id;
  policyReceiptId:Id;required:Capability[];rationale:string;createdAt:string};
export type RoutingPolicyReceipt={id:Id;deploymentId:Id;challengeId:Id;verifierBuildSha256:Sha256;machineId:Id;key:ModelKey;osVersion:string;binarySha256:Sha256;policySha256:Sha256;
  probeContextSha256:Sha256;status:'PASS'|'FAIL'|'UNVERIFIED';evidenceIds:Id[];expiresAt:string;revokedAt:string|null};
export type AssistantTurn={fence:TurnFence;conversationId:Id;messageId:Id|null;selection:AssistantModelSelection;
  admission:AssistantTurnAdmission|null;readSessionId:Id|null;state:'reserved'|'running'|'uncertain'|'finalizing'|'stopped';checkpointArtifactId:Id|null};
export type OrchestrationProof={fence:TurnFence;scopeId:Id;operationId:Id};
export type OrchestrationAction='create_ticket'|'decision'|'dependency'|'command'|'signal';
export interface ProjectOrchestrationAuthority {
  verify(tx:Tx,actor:Actor,proof:OrchestrationProof,action:OrchestrationAction,targetSha256:Sha256):Promise<void>;
}
export interface ProjectOrchestrationPort {
  createTicket(tx:Tx,actor:Actor,proof:OrchestrationProof,input:CreateTicket):Promise<Ticket>;
  decision(tx:Tx,actor:Actor,proof:OrchestrationProof,ticketId:Id,input:DecisionInput):Promise<Id>;
  dependency(tx:Tx,actor:Actor,proof:OrchestrationProof,ticketId:Id,predecessorId:Id,expectedRevision:number):Promise<void>;
  command(tx:Tx,actor:Actor,proof:OrchestrationProof,input:CreateCommand):Promise<Command>;
  signal(tx:Tx,actor:Actor,proof:OrchestrationProof,ticketId:Id,signal:'dependencies_ready'|'wait_owner',expectedRevision:number):Promise<Ticket>;
}
export type DocRead={projectId:Id;snapshotId:Id;path:string;sha256:Sha256;sourceCommit:string|null;receivedAt:string;
  auditState:'unverified'|'invalid'|'verified';contentClass:'implemented'|'workflow_artifact';text:string;state:'current'|'stale'|'unverified'};
export type Assessment={id:Id;ticketId:Id;candidateReadOperationId:Id;input:DispatchInputPin;complexity:'bounded'|'integration'|'architectural';risk:string[];
  uncertainty:string[];required:Capability[];strengthRationale:string;sources:SourceRef[];candidateReasons:{key:ModelKey;reason:string}[]};
export type SkillStep={id:Id;ticketId:Id;skill:string;sourcePath:string;sourceSha256:Sha256;predecessorIds:Id[];
  acceptance:string[];outputKinds:string[];gateIds:Id[];ownershipKeys:string[];role:'implement'|'review'|'fix'|'research'};
export type WorkflowRun={id:Id;rootTicketId:Id;source:SourcePin;projection:ProjectionPin;definitionSha256:Sha256;
  customizationSha256:Sha256;renderedArtifactId:Id|null;path:'architectural'|'bounded'|'bug'|'spike'|'bmad-dispatch'|'bmad-oneshot';
  revision:number;steps:SkillStep[];parallelApprovalId:Id|null};
export type OwnerQuestion={id:Id;conversationId:Id;ticketId:Id|null;runId:Id|null;stepId:Id|null;gateId:Id|null;
  cycleId:Id|null;artifactSha256:Sha256|null;question:string;options:string[];scopeSha256:Sha256;revision:number;state:'open'|'answered'|'superseded'};
export type RoutingCandidate={key:ModelKey;requiredSupported:Capability[];sourceDesired:boolean;sourceApplied:boolean;
  modelConfigRevision:number;probeReceiptId:Id;probeContextSha256:Sha256;binarySha256:Sha256;probeExpiresAt:string;available:boolean;reason:string|null};
export interface RoutingModelPort {
  candidates(tx:Tx,machineId:Id):Promise<RoutingCandidate[]>;
  assertCurrent(tx:Tx,selection:AssistantModelSelection,receipt:RoutingPolicyReceipt):Promise<void>;
}
export type CapacityRequest={id:Id;machineId:Id;ticketId:Id;kind:'implement'|'review'|'fix';ownershipKeys:string[];
  bootGeneration:string;requestedAt:string;expiresAt:string};
export type AssistantTelemetry={sampleId:Id;bootGeneration:string;sampleAgeMs:number;cpuLoad1:number;cpuCount:number;
  memoryAvailableBytes:string;memoryPressure:'normal'|'warn'|'critical';diskAvailableBytes:string;activeJobs:number;configuredMaxJobs:number};
export type CapacityReceipt={id:Id;requestId:Id;machineId:Id;bootGeneration:string;ticketId:Id;kind:'implement'|'review'|'fix';
  ownershipKeys:string[];telemetry:AssistantTelemetry;receivedAt:string;expiresAt:string;allowed:boolean;reason:string};
export type PreparedDispatch={command:Command;permit:DispatchPermit;selection:DispatchSelection;modelChoice:ModelDispatchChoice;inputSnapshot:DispatchInputPin};
export interface FinalEvidencePort {
  verify(tx:Tx,input:Parameters<ServerOptions['verifyFinalResult']>[1]):Promise<void>;
  requestDocsSync(tx:Tx,input:{ticketId:Id;mergedCommit:string;operationId:Id}):Promise<{commandId:Id}>;
}
export interface AssistantDriver {
  start(turn:AssistantTurn,policy:RoutingPolicyReceipt,input:{snapshot:InputSnapshot;docs:DocRead[];executionContext:ExecutionCandidateScope|null}):AsyncIterable<RoutingEvent>;
  resolve(turn:AssistantTurn,providerCallId:string,result:RoutingToolResult):Promise<void>;
  deliver:AssistantRepresentationTransport['deliver'];
  checkpoint(turn:AssistantTurn):Promise<{artifactId:Id;sha256:Sha256}>;
  stop(turn:AssistantTurn):Promise<{state:'stopped'|'unknown';stopEvidenceId:Id|null}>;
}
```

`SourceRef` không thêm inbox kind: trước routing dùng009 `attachment_message_decisions`; sau routing ticket evidence có thật tham chiếu digest snapshot/message/receipt. `RuntimeCheckpoint.attachmentIds` vẫn originals, `artifactIds` chứa InputManifest/derivative-manifest và Assistant checkpoint artifact; không thay chúng bằng field `derivativeIds`. `stepOperationId` và `effectId` server cấp theo logical step/action/target/precondition, giữ qua tool call IDs/model/fallback; effect uncertain không được chạy lại chỉ vì lời gọi mới.

011 schema exact groups (FK restrictive; IDs UUID, revisions int/bigint >=1, JSON immutable/hash checked tại service; không credential):

| Table | Columns và constraints |
|---|---|
| `assistant_config` | singleton PK CHECK=true, revision, designation_id nullable FK, preferred_model jsonb nullable, policy jsonb, pending_designation jsonb nullable |
| `assistant_designations` | id PK, owner_id CHECK='owner', machine_id FK, revision UNIQUE, retired_at nullable; một current row partial unique(owner_id) |
| `assistant_turns` | id PK, conversation_id FK009, message_id nullable FK009, designation_id FK, designation_revision, generation bigint UNIQUE, process_instance_id UNIQUE, model_selection_id UNIQUE, admission_id nullable UNIQUE, read_session_id nullable FK009, state CHECK, checkpoint_artifact_id nullable, stop_evidence_id nullable, created_at, finalized_at; singleton live turn partial unique((true)) WHERE state<>'stopped' |
| `assistant_model_selections`, `assistant_policy_receipts` | id PK + toàn bộ fields của DTO tương ứng; selection.turn_id FK deferred và UNIQUE; receipt evidence/probe immutable, revoke separate timestamp |
| `assistant_scopes` | id PK, turn_id FK, root_ticket_id nullable FK, message_id nullable FK, project_id nullable FK (null only pre-route message scope), actions jsonb, tool_names jsonb, input_snapshot_id FK009, scope_sha256, owner_authorization_id, expires_at; exact one message/root, no wildcard |
| `assistant_work_inbox` | id PK, logical_key UNIQUE, source_cursor nullable, target_kind, target_id, input_revision nullable, state CHECK('pending','claimed','acked'), turn_id nullable FK, claim_generation nullable, next_due_at, attempts, acked_at; ACK fenced, payload IDs only |
| `assistant_monitor` | singleton PK, cursor bigint, generation bigint, lease_owner nullable, lease_expires_at nullable, next_tick_at; cursor + inbox INSERT cùng Tx |
| `workflow_runs`, `workflow_steps`, `workflow_gates` | run.id PK + WorkflowRun scalar fields; step.id PK/run_id FK/ticket_id UNIQUE + SkillStep fields; gate.id PK/run_id/step_id FK, kind, source_path/source_sha256, artifact_sha256, scope_sha256, required_actor CHECK('owner','delegated'), decision_id nullable, state; immutable approvals tied exact artifact |
| `assistant_questions`, `assistant_answers` | question.id PK + OwnerQuestion fields; answer.id PK/question_id FK/question_revision/body/actor_kind/decision_id nullable/created_at; UNIQUE(question_id,question_revision); answer scope/content immutable |
| `assistant_assessments`, `assistant_dispatches` | assessment.id PK/ticket_id FK/input_snapshot_id FK/body/hash; dispatch.command_id PK FK005/decision_id FK004/run_id/step_id FK/assessment_id FK/permit jsonb/admitted_at nullable; selection/modelChoice/input copied in existing005/004 JSON +009 row |
| `assistant_capacity_receipts`, `assistant_reservations` | receipt.id PK + CapacityReceipt, UNIQUE(machine_id,request_id); reservation.id PK/command_id UNIQUE FK005/receipt_id FK/machine_id/ownership_keys/state CHECK('reserved','active','retiring','released'); claimed release only stop+accepted finalization; unclaimed release only R4 retirement+no-launch/stop proof, never deadline alone |
| `assistant_interventions` | id PK/work_id FK/action/reason/policy_receipt_ids jsonb/state_digest/operation_id UNIQUE/next_retry_at/attempts; UNIQUE(work_id,action,state_digest) suppress unchanged action/notice |
| `assistant_operation_ids` | id PK/run_id/step_id/action_kind/target_identity/precondition_sha256/effect_id UNIQUE; UNIQUE(step_id,action_kind,target_identity,precondition_sha256); repeated intentional action uses distinct persisted operation ordinal in target_identity |

`AssistantTelemetry` là DTO normalize của G3; adapter đọc actual phase03 Telemetry và journal boot/monotonic age, không đổi007 heartbeat hay suy sampleAge từ clock client. Producer review xác nhận từng field lấy từ đâu, thiếu field thì wait. `RoutingModelPort` deliberately has no workflow SourcePin or project attempt: reads008 model desired/applied/declaration state plus011 measured routing capability receipt and validates011 routing certificate for exact binary/policy/model key. It never borrows a workflow certificate as proof of routing namespace isolation. Routing certification bootstrap/receipt deployment authority is R1 below; no machine route writes PASS receipts and normal production admission never accepts certification admission.

Capacity request created by `requestCapacity(tx,proof:OrchestrationProof,stepId:Id):Promise<CapacityRequest>` before sampling. Machine GET `/v2/assistant/capacity-requests` returns only its outstanding requests; receipt requires current request ID, matching boot/kind/ownership, a sample taken after receipt of request, sampleAgeMs<=15000 and server elapsed request age<=15000. Server stores request+receipt hash; replay immutable receipt cannot extend TTL. A fresh telemetry sample is required after a failed/expired dispatch, not a new wrapper around old sample.

Add011 `assistant_capacity_requests(id PK,machine_id FK,ticket_id FK,kind,ownership_keys,boot_generation,requested_at,expires_at,receipt_id nullable UNIQUE)` and `assistant_text_receipts(id PK,session_id FK009,snapshot_id FK009,snapshot_sha256,comments jsonb,message_sha256 nullable,transport_sha256,trust CHECK='reported_transport',created_at)`. Không tạo lại bảng attachment receipts009. Text receipt hashes là authenticated transport claims, không chứng minh semantic comprehension. Thêm011 `assistant_budget_reservations(id PK,scope_kind,scope_id,turn_id nullable,command_id nullable UNIQUE,reserved_usd numeric,spent_usd numeric,state CHECK('reserved','settled','uncertain'),receipt_sha256 nullable)`; scope là conversation/run, counter và reservation giữ qua fallback/restart, không reset theo model. Unknown provider spend giữ conservative reservation, không giải phóng quota bằng timeout; exhausted budget chuyển câu hỏi owner.

Lock order: journal idempotency/event_cursor → existing root → existing command row for claim/retire → affected tickets sorted → project → machine/config/assistant designation/turn → input revision → grant/session → capacity/reservations → task-specific rows. Inbox no-ticket starts at designation/turn; never later locks root in same Tx. Routing snapshot/read phase and mutation phase separate, latter revalidates all revisions. No network/model/telemetry sampling while SQL locks held. Reuse exact root/input order009; producer review resolves any source mismatch before adding locks.

## API cho phase07 và authority của Trợ lý

Owner mutation dùng cookie+Origin+CSRF+Idempotency-Key; máy dùng bearer + current designation/TurnFence/action scope, authorization callback trước cached reply. JSON additionalProperties:false; list limit1–100 + scoped cursor; errors400 invalid,401 auth,403 forbidden action,404 foreign scope,409 stale/fence/state,422 missing input/capability,503 unconfigured. Events chỉ IDs/revision/state, content đọc qua authorized endpoint.

| Route | Body → result; authority |
|---|---|
| GET/PUT `/v2/assistant/config` | PUT `{expectedRevision,machineId,preferred:ModelKey|null,policy:AssistantPolicy}` → AssistantConfig; owner only, non-null preferred.machineId exact and source OFF/unprobed reject; initial designation may set preferred:null for certification, normal bootstrap then waits NO_ASSISTANT_MODEL_SELECTED; reassignment pending while old process unknown |
| POST `/v2/attachment-conversations`; POST `/v2/attachment-submissions/messages` | Reuse009 `{}` / MessageSubmission → conversationId / AssistantMessage; no project required, no duplicate conversation store |
| GET `/v2/assistant/conversations/:id` | owner → `{messages:AssistantMessage[],turns:AssistantTurn[],questions:OwnerQuestion[],nextCursor}`; redact process/policy internals in UI DTO |
| GET `/v2/assistant/questions`; POST `/v2/assistant/questions/:id/answers` | `{expectedRevision,scopeSha256,artifactSha256:null|string,answer:string}` → `{question,decisionId:null|string}`; owner; wrong cycle/revision/artifact409 |
| GET `/v2/tickets/:id/assessment`; GET `/v2/assistant/runs/:id` | owner → Assessment / WorkflowRun + ticket statuses + gate/repair links; board/list/chart share ticket graph004 |
| GET `/v2/tickets/:id/decisions`; GET `/v2/events` | reuse004/002 timeline/events; no second workflow status source |
| GET `/v2/assistant/catalog`; GET `/v2/assistant/docs` | current designated machine + TurnFence; catalog `{projectId,key,name,docsState,latestSnapshotId,sourceCommit}`; docs query `{projectId,snapshotId,path}` → DocRead; no checkout/token metadata |
| GET `/v2/assistant/input-text/:snapshotId` | designated machine + exact admitted session → `{message:{id,text,sha256}|null,comments:{id,ticketId,text,sha256}[]}`; only009 canonical inherited IDs/hashes; sibling/unsubmitted text404, hash mismatch409 |
| POST `/v2/assistant/turns/reserve`; POST `/v2/assistant/turns/:id/{checkpoint,result,reconcile}` | reserve `{workId,processInstanceId,selectionId}` → AssistantTurn; checkpoint `{fence,operationId,artifactId,sha256}`, result `{fence,operationId,outcome:'reply'|'waiting'|'failed',replyDecisionId:Id|null}`, reconcile `{fence,operationId,observation:'running'|'stopped'|'unknown',stopEvidenceId:Id|null}`, server selection only; stopped proof before release |
| POST `/v2/assistant/actions` | `{proof:OrchestrationProof,action:OrchestrationAction,body}` tagged union exactly matching port signatures → matching port result; machine cannot request owner_answer/approval, bind/rebind or claim |
| POST `/v2/assistant/capacity-receipts` | bound machine `{requestId,ticketId,kind,bootGeneration,ownershipKeys,telemetry}` → CapacityReceipt; compare fresh server-issued request, boot, current host report; no client allowed=true |

Model bytes/session/grant routes remain exact009 S3; authority implements `AssistantInputAuthority`, `PreclaimSelectionAuthority`, `InputRoutingAuthority`, `RouteRetirementAuthority`. `authorizeIssue` accepts only current owner submission authorization, exact submitted originals/hashes, scope and expiry; drafts/other messages denied. `authorizeSession` persists exact selection/process/policy + immutable009 admission atomically; replay same turn returns same admission and never extends expiry. `assertSessionCurrent` checks fence/security/input/designation/revoke/expiry and exact identity, **not** current source ON/config equality for already admitted turn. Source OFF winner before admission denies; admission winner can finish current delivery/receipt/reply. New selection/turn/fallback always current ON. Text-only/no-attachment message still gets snapshot/admission; missing model understanding cannot be fabricated from transport receipt.

## T3 — Official workflow adapters, gates và run graph

**Interfaces:** `loadDefinition(source:SourcePin,projection:ProjectionPin):Promise<{sha256:Sha256;skills:{path:string;sha256:Sha256}[]}>`; `createRun(tx,proof:OrchestrationProof,input:{rootTicketId:Id;path:WorkflowRun['path'];definitionSha256:Sha256}):Promise<WorkflowRun>`; `answerGate(tx,questionId:Id,decisionId:Id):Promise<void>`. Source mapping/research links below are normative, no guessed BMAD legacy story chain.
- [ ] RED fixture pins Superpowers6.4.2 SHA8ca22dba… and BMAD6.12.0 SHA05bfbd46…; changed source/customization/rendered snapshot hash blocks resume. `assert.equal(run.steps[0].sourcePath,'skills/brainstorming/SKILL.md')`; bounded has approved short design then TDD/review/verify, no forced written spec/plan; spike requires approved question/probe, produces research artifact, no product-code completion.
- [ ] RED architectural gates: design sections→written spec approval→written plan review+execution method→implementation. Bug starts systematic-debugging evidence→pattern→hypothesis→fix; third failed fix requires architecture discussion before fourth, independently of Crew repair five. Mandatory gate cannot accept Assistant self-answer or stale artifact approval. Already valid exact approval resumes at next incomplete stage without repeat interview.
- [ ] RED BMAD build renderer unavailable/error halts, never runs raw workflow source. Dispatch route step01→02→03→04→05; step02 oneshot only no intent gap/no irreversible/small existing change, preserves official review. `bmad-spec` optional spec-kernel input `.memlog.md` single writer, headless no story breakdown. Scope/dirty tree/open questions/checkpoint preserved; step04 three configured review layers independent and joined, same capability as session; missing reviewer capability waits.
- [ ] Run `pnpm --dir v2/server test --test-name-pattern='assistant workflows'` and `pnpm --dir v2/gateway test --test-name-pattern='workflow manifest'`; expected RED.
- [ ] GREEN map immutable source nodes to step/task tickets, DAG predecessor edges and repair links; load official file just-in-time; BMAD `uv run --no-cache "{project-root}/_bmad/scripts/render_skill.py" --project-root "{project-root}" --skill "{skill-root}"` exactly once per render operation with hashed output snapshot. Snapshot references resolve only manifest paths; customization/config hash pinned; unknown gates/source/version wait.
- [ ] GREEN parallel representation: run R keeps ordered planning/gates, implementation tasks T1/T2 each get distinct `stepOperationId`, file ownership and official task brief under same run; parent review J depends on both. `parallelApprovalId` references owner decision for R/selected units/shared-input hashes overriding sequential default; source bytes unchanged. With no override BMAD step03 and SDD single plan remain sequential. Dependent T2→T1 or same path/index/migration denies parallel even with approval; independent already approved invocations can overlap only without duplicating feature/spec or bypassing joins.
- [ ] Re-run suites/typecheck; official-source/gate review; docs `assistant-workflows.md`; commit `feat(v2): derive workflow runs from pinned skills`.

## Self-review và bàn giao

- [x] Spec3–6→T2/T3/T4/T5; spec7→T4/T6/T7 failclosed08; spec8→T4/T5/T6; spec9→T2/T6/08; spec10→API009+011/07; spec12→T7. Năm Review Focus có negative tests cụ thể.
- [x] Selection/modelChoice/input snapshots persisted trước claim; frozen permit không thêm field/fence; comments inherited009 + OFF exact-turn semantics giữ nguyên; workflow pin/source/official gates có provenance.
- [x] Một designated Assistant, scoped doc/input access, fenced turn và read grants không cấp code authority; producer G1/G2/G3/G4 cùng actual03–05 dependencies được nêu rõ, không báo implementation PASS.
- [x] Owner parallel policy được biểu diễn explicit; sequencing không bị suy bỏ; reviews độc lập, resource cleanup và repair counter có owner. Không tự chọn ngân sách paid/capacity chưa được owner cấu hình.
- [x] R1–R4 có producer/consumer/schema/routes/negative acceptance: first-cert bootstrap, runtime tool chain, injected009 creator, unclaimed retirement; các sửa chờ scoped independent re-review.
- [x] Planner chỉ tạo plan/report; PM review độc lập tiếp theo. READY nghĩa kế hoạch đã self-review, không phải runtime/source-isolation/comprehension/merge/docs acceptance đã đạt.

## Bổ sung của PM — thứ tự migration 2026-10-02 16:53

Kiểm thử PostgreSQL thực tế của Task05/2a xác nhận constraint comments_text_check trong004 chặn text rỗng trước khi chạy linker attachment. Giữ nguyên byte các migration001–009 đã nghiệm thu; phần05 bổ sung010_attachment_comment_text.sql. Kế hoạch này dùng số thứ tự kế tiếp như đã cập nhật phía trên. Chỉ đổi số migration tương lai và tham chiếu; hợp đồng nghiệp vụ, quyền hạn, chứng cứ turn/effect/stop và các điều kiện nghiệm thu đã duyệt giữ nguyên. Migration010 mới và producer phải qua review độc lập Task2a trước khi tích hợp consumer. Hash phê duyệt lịch sử mô tả bản trước bổ sung; hash bản hiện tại được ghi trong ledger PM.


## Current PM gate

T1 accepted feaea55 after full/FIX1/FIX2 review;011 checksum fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841. Contracts source SHA adee25f453fa91e7498a1a300d3c7a4761147b8584e738a54818d9cb4b65412f frozen.001–010 immutable. T2 not started: trusted orchestration/input authority and routing/render integration not fabricated; absent producers remain deny. Start STATIC source/producer mapping plus behavioral regression design. No source/test execution or new support files before PM confirms narrow authority/fixture interfaces and meaningful RED recipe. Full task source ownership exact in table. New Markdown allowed docs/plans managedworktree; no children/Git/index/SQL/app wiring/locks/dependency changes. Resource telemetry+quota before each creation/dispatch; shared soleheavy slot from PM only. Superpowers SDD/TDD/verifier task loop.
