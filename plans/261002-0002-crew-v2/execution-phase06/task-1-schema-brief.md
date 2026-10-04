# Phase06/T1 — schema and durable Assistant work inbox (dispatched static preparation; DB validation awaits PM slot)

PM durable-effect ruling: effectId là SHA256 lowercase hex64, không phải UUID.
011 assistant_operation_ids.effect_id dùng TEXT với CHECK đúng hex64 và UNIQUE.
operationId/stepOperationId giữ UUID; effect giữ cùng định danh qua fallback.
Ordinal cho hành động cố ý lặp phải được persist, không suy từ provider tool-call ID hay argsHash.

Read this full embedded task contract, approved spec and v2/docs/index before code. Actual009 accepted ec02ac0; actual010 accepted f6d3728; migration011 may follow immutable001–010. Actual MessageSubmission/InputSnapshot/DispatchInputPin types exist in reviewed attachments/contracts.ts; do not consume unfinished phase05 submission/access/transport or unreviewed gateway/isolation/runtime boundaries. Fresh PM telemetry and explicit task dispatch required. Primary Superpowers SDD/TDD; no subagents/Git/shared index/manifests/packages. Not alone; preserve all peer edits.

Own ONLY migration011_assistant.sql, server/src/assistant/{contracts,store,inbox}.ts, server/test/assistant-store.test.ts and new support/assistant.ts, new server-assistant.md R3. Implement whole approved011 persistence contract, constraints, queues, durable cursor and conversation linkage. Schema includes approved R1 routing authority/certification, R2 routing actions, R3 derived parent-consent route authority, R4 prelaunch/tombstones/reservations; source011 cannot weaken frozen001–010,005permit/007selection/008model choice. Typed contracts must import actual reviewed exported producer types; missing actual producer services must be reported to PM, not fabricated with any/plan-only fake module. Pure independent contract work allowed; GREEN integration depends on reviewed real producers. No live/runtime/signing certificates from fixture seeds.

Exactly T1 tests from approved plan, actual private PG18.6 prefix11 migrations checksum, duplicate event/restart, conversation/message immutable link and cursor order, unknown turn guard retained, exact route/certification scope, constraints backup/restore rehearsal with hashes before acceptance. Unit-only assistantFixture seed helpers cannot be production authority. No app/host/route wiring from laterT2. No default production model/inference/network calls or owner credentials.

Before fixture create exact root nonce/dev/inode/UID, child/container PID/argv/port; exclude peer sources from frozen manifest. Single meaningful final appropriate cover after last source, type/Biome/R3, actual result logs incl failed REDs; no unionPASS. Close children then identity-check own roots; unknown retain noTTL/prune/fakeSTOP. Report all source SHA/bytes and evidence/cleanup before controller candidate/docsmapping/full independent SPEC/QUALITYreview. PM authorizes this T1 static implementation dispatch; no plan changes or heavy fixtures until PM resource-slot release.


## Embedded exact approved T1 and shared schema requirements

## Global Constraints

- “Mỗi dự án gắn đúng một máy thực thi.” “Nếu máy Trợ lý offline, hệ thống chờ, không tự chuyển Trợ lý sang máy khác.” Một routing Assistant; các execution role chỉ dùng pinned official skills/templates, không viết prompt PM/dev/QC riêng.
- “Tắt nguồn không hủy attempt đang chạy”; admission mới/fallback kiểm desired ON ngay trên server. Exact Assistant turn đã admitted cũng được hoàn tất sau OFF nếu input/designation/grant/security vẫn current; không blanket-revoke vì model config revision đổi.
- “Tối đa 5 vòng sửa và kiểm tra lại cho cùng bước kiểm tra”; infrastructure/model lỗi không đếm/reset; sau thất bại thứ năm hỏi owner đúng cycle và tiêu approval một lần.
- “Trước MỖI lượt dispatch agent thực thi, reviewer hoặc agent sửa lỗi, lấy telemetry mới từ máy đích”; capacity + owner limit + active/reserved jobs + ownership cùng quyết định, không suy số agent từ CPU.
- Owner đã yêu cầu PM chạy task độc lập song song. Lưu explicit owner parallel policy khi thực thi; override quy tắc mặc định sequential chỉ trong scope được duyệt, giữ official skill bytes/templates, dependency/approval/review gates. Không coi mọi task là độc lập.
- V2 độc lập; không dùng v1 roles/business runtime/DB; prose tiếng Việt, identifier tiếng Anh, wire UTC ISO, UI Asia/Ho_Chi_Minh. UI layout/mockup approval thuộc phase07, không mở lại phỏng vấn spec backend đã duyệt.
- SQL mới duy nhất `011_assistant.sql` sau reviewed009; không sửa migration001–009 hoặc frozen DispatchPermit005/DispatchSelection007/ModelDispatchChoice008/RuntimeCheckpoint. Producer gap phải có ownership transfer và review trước consumer assembly.
- Test DB `crew_v2_test_*` trên Docker loopback random port khác5432/55432, không shared/prod/service restart/global install. Backup/restore rehearsal trước011. Paid/live calls chỉ khi có owner-approved provider + bounded budget; triển khai không tự cấp quyền chi phí.



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



## R1 — Routing certification bootstrap và deployment authority (T2/runtime, T7 assembly)

```ts
export type RoutingCertificationContext={deploymentId:Id;machineId:Id;key:ModelKey;binarySha256:Sha256;policySha256:Sha256;observerSha256:Sha256;osVersion:string};
export type RoutingCertificationChallenge={id:Id;context:RoutingCertificationContext;nonce:string;expiresAt:string;maxTurns:number;maxTools:number;maxCostUsd:number;maxMs:number;fixtureSha256:Sha256};
export type RoutingCertificationLaunch={challengeId:Id;turnId:Id;generation:string;processInstanceId:Id;context:RoutingCertificationContext};
export type RoutingCertificationEvidence={launch:RoutingCertificationLaunch;traceArtifactIds:Id[];stopEvidenceId:Id;surfaces:{name:'docs'|'input'|'tool'|'native-read'|'child'|'absolute-path'|'symlink'|'network';allowedTrace:Sha256;deniedTrace:Sha256}[];usage:{turns:number;tools:number;costUsd:number;elapsedMs:number}};
export interface CertificationSupervisor {launch(launch:RoutingCertificationLaunch,challenge:RoutingCertificationChallenge):AsyncIterable<RoutingEvent>;stop(launch:RoutingCertificationLaunch):Promise<{state:'stopped'|'unknown';stopEvidenceId:Id|null}>;}
export interface RoutingCertificationAuthority {
  issue(tx:Tx,actor:Actor,input:{context:RoutingCertificationContext;maxTurns:number;maxTools:number;maxCostUsd:number;maxMs:number}):Promise<RoutingCertificationChallenge>;
  admit(tx:Tx,actor:Actor,input:{challengeId:Id;nonce:string;processInstanceId:Id}):Promise<RoutingCertificationLaunch>;
  verify(tx:Tx,actor:Actor,evidence:RoutingCertificationEvidence):Promise<RoutingPolicyReceipt>;
}
```

T1 schema owns all011 additions/hooks in R1–R4 before checksum freeze; T2 implements services. Schema includes immutable deployment_id to011 assistant_config and `assistant_calibration_guard(singleton PK,challenge_id nullable)`; certifier admission and normal bootstrap lock this guard with the singleton turn authority. Certification starts only after every normal turn is stopped; normal turns wait while calibration active. Shared monotonic generation allocator covers both kinds; calibration release requires verified stop, not expiry. Schema includes011 `routing_certification_challenges(id PK,deployment_id,context,nonce_hash,expires_at,budgets,fixture_sha256,state CHECK('issued','admitted','verified','failed'),launch jsonb UNIQUE,receipt_id nullable)` and immutable `routing_certification_evidence(id PK,challenge_id,body_hash,body,created_at)`. Server assigns launch.turnId/generation and binds machine/model/binary/policy/observer/OS/process atomically issued→admitted; exact identity+body replay returns same launch without renewing budget/expiry. Different launch, nonce, context or expiry rejects. Expiry capped15min; budgets finite positive and bounded by owner-authorized policy; nonce random32 bytes, stored hash only, returned once through encrypted idempotency codec; never log.



## R2 — Local inference → durable production tool protocol (T2/T4/T5/T7)

```ts
export type ExecutionCandidateScope={ticketId:Id;projectId:Id;machineId:Id;bindingRevision:number;runId:Id;runRevision:number;definitionSha256:Sha256;input:DispatchInputPin;source:Pick<SourcePin,'name'|'version'|'sourceRevision'|'sourceManifestSha256'|'sourceTreeSha256'>};
export type ExecutionCandidate={key:ModelKey;declared:Capability[];capabilities:Capability[];available:boolean;reason:string|null;sourceDesired:boolean;sourceApplied:boolean;probe:{receiptId:Id|null;contextSha256:Sha256|null;status:'pass'|'fail'|'unverified';receivedAt:string|null;expiresAt:string|null};projection:(Pick<ProjectionPin,'runtime'|'sourceTreeSha256'|'manifestSha256'|'treeSha256'> & {derivationSha256:Sha256})|null;installReportId:Id|null;certificationReceiptId:Id|null};
export type ExecutionCandidateSnapshot={scope:ExecutionCandidateScope;observedAt:string;sha256:Sha256;modelConfigRevision:number;modelAppliedRevision:number|null;gatewayConfigRevision:number;gatewayAppliedRevision:number|null;inventoryReportId:Id|null;bootGeneration:string;entries:ExecutionCandidate[]};
export interface ExecutionCandidateReader {read(actor:Actor,request:RoutingToolRequest & {call:{name:'read_execution_candidates';input:{ticketId:Id;runId:Id}}}):Promise<RoutingToolResult>;}
export type AssessmentProposal=Omit<Assessment,'id'> & {chosen:ModelKey;choiceRationale:string};
export type QuestionProposal=Omit<OwnerQuestion,'id'|'revision'|'state'>;
export type RoutingTool= {name:'read_catalog';input:{}} | {name:'read_docs';input:{projectId:Id;snapshotId:Id;path:string}}
 | {name:'route_message';input:{messageId:Id;expectedInputRevision:string;expectedRouteRevision:number;ticket:CreateTicket;confidence:number;rationale:string;docReadIds:Id[]}}
 | {name:'read_execution_candidates';input:{ticketId:Id;runId:Id}} | {name:'assess_ticket';input:AssessmentProposal} | {name:'ask_owner';input:QuestionProposal}
 | {name:'create_run';input:{rootTicketId:Id;path:WorkflowRun['path'];definitionSha256:Sha256}}
 | {name:'request_dispatch';input:{stepId:Id;assessmentId:Id;chosen:ModelKey;priorAttemptId:Id|null}}
 | {name:'request_review';input:{runId:Id;implementationStepId:Id;implementationAttemptId:Id}}
 | {name:'publish_reply';input:{messageId:Id;inputRevision:string;snapshotId:Id;receiptIds:Id[];text:string;sources:SourceRef[]}};
export type RoutingEvent={kind:'tool';providerCallId:string;sequence:string;call:RoutingTool}|{kind:'finished';outcome:'completed'|'failed'|'interrupted'};
export type RoutingToolValue={kind:'catalog';items:{projectId:Id;key:string;name:string;latestSnapshotId:Id|null;sourceCommit:string|null}[]}
 | {kind:'execution_candidates';snapshot:ExecutionCandidateSnapshot} | {kind:'docs';page:DocRead;readReceiptId:Id} | {kind:'route';route:MessageRoute} | {kind:'assessment';assessment:Assessment}
 | {kind:'question';question:OwnerQuestion} | {kind:'run';run:WorkflowRun} | {kind:'review';step:SkillStep}
 | {kind:'capacity';request:CapacityRequest} | {kind:'dispatch';dispatch:PreparedDispatch} | {kind:'reply';decisionId:Id};
export type RoutingToolResult={operationId:Id;state:'completed'|'pending'|'rejected';result:RoutingToolValue|null;errorCode:string|null};
export type RoutingToolRequest={fence:TurnFence;operationId:Id;clientSequence:string;inputSnapshot:DispatchInputPin;call:RoutingTool};
export type RoutingToolConsumer=(tx:Tx,actor:Actor,request:RoutingToolRequest)=>Promise<RoutingToolResult>;
export interface AssistantWorkService {bootstrap(tx:Tx,actor:Actor,input:{workId:Id;processInstanceId:Id}):Promise<{turn:AssistantTurn;snapshot:InputSnapshot;grantId:Id;scopeId:Id|null;executionContext:ExecutionCandidateScope|null}>;}
```



## R3 — Inject scoped ticket creator vào chính transaction009 (T2 + phase05 owner)

```ts
export type RouteTicketCreator=(tx:Tx,input:CreateTicket,actor:Actor,context:{messageId:Id;inputRevision:string;routeRevision:number;decisionId:Id})=>Promise<Ticket>;
export type RouteInputAuthorizationBridge=(tx:Tx,actor:Actor,input:{route:MessageRoute;parentAuthorizationId:Id} )=>Promise<OwnerInputAuthorization|null>;
export function createMessageRouter(deps:{createTicket:RouteTicketCreator;authorizeRoutedInput?:RouteInputAuthorizationBridge}):typeof routeAssistantMessage;
```

Explicit transfer `v2/server/src/attachments/{routing,routes,grants}.ts` from phase05 owner after actual009 review: router factory invokes injected creator at **existing createTicket callsite**, within unchanged caller mutator Tx, before route/link inserts. Exported default `routeAssistantMessage` retains frozen S1 signature using generic creator; production attachment route registration accepts factory router injection, default remains generic/deny for cross-project machine. No SQL001–009 or RouteMessageInput/InputRoutingAuthority/RouteRetirementAuthority shape change.

Owner branch calls existing generic createTicket with owner actor. Assistant branch resolves context.decisionId→persisted message decision→exact active TurnFence/OrchestrationProof, verifies snapshot/routing decision/exact CreateTicket hash and calls ProjectOrchestrationPort.createTicket(tx,actorA,proof,input); no per-request mutable closure, actor substitution, separate pre-created ticket or nested transaction. After route/link inserts but before commit, injected authorizeRoutedInput derives only same selected originals/hashes for the new ticket from the live owner-submission authorization; no parent consent means null/no Assistant grant. Add011 `assistant_route_authorizations(route_id PK,parent_authorization_id FK009,derived_authorization_id UNIQUE FK009,parent_scope_sha256)`; expiry never exceeds parent, allowOriginal cannot increase, route/revoke invalidation cascades. Internal009 grants helper verifies this parent consent/route in caller Tx, keeps machineA actor in audit and owner provenance on original authorization; never calls owner route as synthetic owner. Missing required bridge fails entire Assistant route transaction. This narrowly reviewed handoff changes no009 DTO or SQL and grants no drafts/sibling inputs/code authority. Same injected creator handles re-route; retirement callback checks old route process/read sessions and applies scoped old-ticket terminal intent through service. Missing callback or stop proof fails whole Tx. Assembly owns constructor wiring, not global ACL widening.
- [ ] R3 RED→GREEN actual009 route +06 creator: A≠B and B offline, exactly one request audit actorA + route + inherited original links; same request replay one ticket; injected link failure rolls back ticket/decision/route/links; generic createTicket/claimB from A remains404; re-route with old active/unknown session or stale input409, safe re-route preserves history and narrows grants; fresh ticket authorization retains exact parent IDs/hashes/expiry, parent revoke invalidates derived grant, route→new bootstrap observes current snapshot. `assistant-route-integration.test.ts`, changed producer flow pages updated with source.



## R4 — Retire unclaimed dispatch và giải phóng reservation an toàn (T4/T6 +03 bridge)

```ts
export type LaunchAuthorization={id:Id;commandId:Id;processInstanceId:Id;bootGeneration:string;generation:string;expiresAt:string};
export type UnclaimedStopProof={kind:'never-authorized';commandId:Id;retirementId:Id}|{kind:'journal-no-launch'|'process-stopped';commandId:Id;launchAuthorizationId:Id;processInstanceId:Id;bootGeneration:string;generation:string;journalSha256:Sha256;stopEvidenceId:Id};
export function authorizePrelaunch(tx:Tx,actor:Actor,input:{commandId:Id;processInstanceId:Id;bootGeneration:string}):Promise<LaunchAuthorization>;
export function retireUnclaimedDispatch(tx:Tx,commandId:Id,reason:'expired'|'input_changed'|'source_off'|'superseded'):Promise<{retirementId:Id;state:'held'|'released'|'claimed'}>;
export function acceptUnclaimedStop(tx:Tx,actor:Actor,proof:UnclaimedStopProof):Promise<'held'|'released'>;
```

011 `assistant_dispatch_retirements(command_id PK,retirement_id UNIQUE,reason,retired_at,proof jsonb nullable,released_at nullable)` and `assistant_launch_authorizations(command_id PK,id UNIQUE,machine_id,process_instance_id,boot_generation,generation,expires_at,state CHECK('issued','retired','claimed','closed'),attempt_id nullable UNIQUE)`; all claim/retire/prelaunch paths lock journal→root→command→ticket→project→guard→machine→011 reservation/launch in identical order. `AuthorizeDispatch` denies retired commands; additive011 AFTER INSERT attempts hook, only for commands with assistant_dispatches row, validates matching launch process/machine/token-state and binds attempt_id/reservation active atomically, rollback on mismatch. Normal production authorizer requires assistant_dispatches row; earlier008 test-certification in isolated test composition keeps its own admission and cannot enter production. Existing005 claim signature/permit unchanged; existing-attempt replay still returns its attempt and cannot free reservation.



## T1 — Schema, durable work inbox và conversation linkage

**Interfaces:** consumes `Mutator,appendEvent,MessageSubmission`009; produces `enqueueWork(tx,event:Event):Promise<void>`, `ingestEvents(tx,through:string):Promise<void>`, `claimWork(tx,workId:Id,fence:TurnFence):Promise<void>`, `ackWork(tx,workId:Id,fence:TurnFence):Promise<void>`; each checks persisted turn. Event fanout chạy server-side; không cấp stream project toàn hệ thống cho machine. T1 fixture định nghĩa `pendingCount(tx:Tx,eventId:string):Promise<number>` bằng inbox logical_key của cursor/target, phục vụ assertion sau.
- [ ] RED schema/inbox test: `await ingestEvents(tx,cursor); await ingestEvents(tx,cursor); assert.equal(await pendingCount(tx,eventId),1);` crash transaction rolls back cursor and insert; stale designation ACK409 leaves pending. Legacy root comment resolves current descendants and009 counters, child comment excludes sibling; bootstrap scans revisions to recover missed wakes. Inbox message without ticket remains pending across restart.
- [ ] Run `pnpm --dir v2/server test --test-name-pattern='assistant store'`; expected missing schema/service failure, record actual RED.
- [ ] GREEN SQL011 + store: `INSERT ... ON CONFLICT(logical_key) DO NOTHING`, logical key event cursor/target revision; advance cursor only same Tx. Monotonic fence allocated on reserve; no ACK merely because work was delivered. Resumed work references durable turn checkpoint/receipt, never new message or root duplicate.
- [ ] Re-run focused test + server typecheck; backup/restore011 in own DB; docs `server-assistant.md`; independent schema/replay review then controller commit `feat(v2): persist assistant turns and work inbox`.



## R1 capability receipt schema and immutable authority context

Verifier reads trace bytes/artifact hashes through trusted observer channel, checks server challenge/launch/nonce-bound expected canary effects, positive+negative pairs for every listed surface, actual usage and exact stop identity; machine-provided PASS booleans are ignored. Missing evidence⇒UNVERIFIED, observed escape⇒FAIL. Only full measurements create immutable PASS receipt and linked011 `routing_capability_receipts(id PK,certification_receipt_id FK,key,context_sha256,capabilities,received_at,expires_at)` from measured canary capabilities. RoutingModelPort uses this routing-only probeReceiptId with context_sha256=SHA256(canonical RoutingCertificationContext), current008 switches/applied model declaration/binary and current011 certificate; no workflow008 probe/certificate is manufactured or borrowed. Receipt limits are server-clock bounded. Both receipts bind same deploymentId/context; binary/policy/OS changes invalidate fresh admission. Normal assembly trusts receipts issued by its pinned verifier and deployment ID in the same DB; fixture/test DB receipts cannot be copied/imported as production authority. No owner web operation can manufacture PASS. Default issuer/verifier deny until this measured implementation is wired.

## R2 durable tool-operation schema

Driver emits RoutingEvent; `tool-client.ts` validates union, maps providerCallId/sequence to durable operationId before HTTP and POSTs `/v2/assistant/turns/:id/tools` with RoutingToolRequest. Server authenticates machineA, turn/process/generation/designation, exact current snapshot/receipts, stored tool_names/action scope and budgets before idempotency replay. Consumer derives OrchestrationProof from persisted turn/message/root scope and operationId; model cannot mint scopeId or widen permissions. Each tool accepts only its matching RoutingToolValue response kind, not arbitrary JSON. Unknown name/extra fields/forged approval rejects. `assistant_tool_operations(operation_id PK,turn_id FK,client_sequence,provider_call_id,request_hash,input_snapshot_id,state,response, UNIQUE(turn_id,client_sequence))`011 stores operation+service mutation+event+result in one Tx. Same ID/body replay returns stored result after current authorization; different body409. Gateway fsyncs result then `driver.resolve(turn,providerCallId,result)`. Timeout replays exact HTTP operation, GET `/v2/assistant/turns/:id/tools/:operationId` for current RoutingToolResult; pending external effect stays pending/uncertain, never duplicate model-driven effect. Free text or finished event alone cannot create ticket/decision or mark work done; result route references committed reply/question operation and waits stop before turn finalization.

## R2 doc read receipt schema

011 read receipt `(id,turn_id,snapshot_id,path,sha256)`; service owns actual validated snapshot/content hash. T1 persists schema only; T2 reader/authority remains unimplemented.


## Current PM producer gate

Current controller HEAD0c838d2. Migrations001–010 reviewed/immutable. Phase05 Task3 fullreview/fix1 known performance issue closed independently, FIX2 subsetperformance pending; Task5 parsers unreviewed. T1 does not consume those access/parser/runtime changes. Freeze executable fixture from accepted HEAD with only own T1 overlays; actual reviewed contracts/MessageSubmission009 and event metadata types only. Own contracts may define T1/011 DTOs but do not fabricate missing runtime/authority services. Schema R1–R4 hooks required, services T2–7 excluded. Source/prod application wiring remains controller-owned.

Native task-brief extractor did not recognize approved T1 heading; controller extracted exact task+all shared schema/R1–R4 requirements here without changing approved plan. Primary Superpowers SDD/TDD, fresh implementer/no children. Report task-1-schema-report.md with source/evidence/cleanup SHA inventories. No live/paid calls, no credential reads/global installs. Resource dispatch static only.
