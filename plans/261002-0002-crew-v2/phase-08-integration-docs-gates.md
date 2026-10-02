# Crew v2 phase 08 — Integration và docs gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chỉ tự merge kết quả hiện hành đã có workflow/test/review/docs proof; crash không merge lại và code request chỉ hoàn tất sau sync/attestation đúng commit.
**Architecture:** Gateway tạo candidate commit trước kiểm chứng trên managed target được owner chọn; server012 giữ authorization/evidence/head authority. Git ref CAS + journal phục hồi qua DB, factual merge được ghi trước006 sync; snapshot006 giữ nguyên provenance,012 attestation/reader phân biệt merged docs với ticket-scoped docs-only.
**Tech Stack:** Node ≥24.12, TypeScript 7.0.2, pnpm 10.32.1, PostgreSQL 18.6/Fastify của02, Git CLI dùng argv/stdin; node:test. Không dependency runtime v1 hoặc custom role prompt.
**Spec:** `docs/superpowers/specs/2026-10-01-crew-v2-design.md` §6–9,12; roadmap `plan.md`; reviewed02–06; research `plans/reports/research-261002-crew-v2-integration.md`.
**Status:** phase08-r2 đã qua independent scoped re-review: F1–F4 closed, spec/quality READY YES ở mức kế hoạch (reviewed body SHA2565d486a5c3e975edec99049608809dd85c635c3567472c1667682b22e50aae870). Actual HEAD `832c9a3d015fd750a489f49ff48db36a1501ae62`,005 reviewed `9dca04e`,006 reviewed checksum `8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae`.06-r3 SHA256 `547ce65c865dffd9fec9a7c71f0c38735566d314c007cb74a8f217f5f19795aa`; native descendants chưa chứng minh vẫn UNKNOWN. Approved final08 SHA `54452166e7acab5d139f86b7f4d302d257a5f07c9f002a0bcff12645576a8eec` là lịch sử; sửa hẹp EffectId cùng09 N1 đã qua joint scoped review: N1 CLOSED, spec/quality READY YES; reviewed correction SHA `1aa930e91b11c43d784eb89ffbf9a35d10a0f53e99d0f28a45c33eac1a7beb08`, không mở lại F1–F4.

## Global Constraints

- “Tự merge khi các cổng workflow, test, review và docs đạt.” Mọi gate dùng target/source hiện tại, conflict resolution nằm trong diff và validation wave mới.
- “Deploy chỉ chạy khi owner duyệt hành động cụ thể trên web hoặc tạo ticket deploy.” Merge không cấp quyền push/deploy; giữ exact004 fingerprint/action authorization tới09.
- “Không coi mất heartbeat là bằng chứng tiến trình đã chết.” Pause/cancel giữ005 guard đến actual stop/result/finalize; UNKNOWN không giải phóng reservation, target lock hay resource.
- “Tối đa 5 vòng sửa và kiểm tra lại cho cùng bước kiểm tra”; dùng004/06 cycle/checkStepId, không đếm infra/model/sync lỗi hoặc reset khi fallback.
- Mỗi project chỉ bound machine hiện tại; source/model ON/current admission do06, existing admitted attempt giữ semantics OFF đã chốt. Current fence/binding/input/workflow gate vẫn bắt buộc ở mutation.
- Official workflow skills thực thi review/verification/finishing, mandatory owner gates và explicit parallel approval06 giữ nguyên; reviewer độc lập từng task và whole-request.
- Docs tiếng Việt, identifier/path tiếng Anh, wire UTC ISO, UI Asia/Ho_Chi_Minh. Original workflow artifacts giữ format/class; không nâng chúng thành implemented docs.
- Không sửa SQL005–011 đã freeze; migration mới012. Không sửa source hiện tại trong lượt planning, không install/model/live call/credential/v1DB/shared service/stage/commit/deploy.
- Implement/test dùng run-owned repo/checkouts, own DB `crew_v2_test_*` random loopback port khác5432/55432; không discard owner dirty/untracked, reset/clean/global Git config.

## Review Focus

1. Target/source đổi sau review hoặc trước ref CAS: không áp dụng candidate cũ, tạo validation wave mới (T2/T3/T4).
2. Crash giữa Git ref mutation và server receipt, kể cả fallback khác runtime: reconcile exact persisted commit/ref/tree/parents, không merge hai lần (T4/T7).
3. Máy tự khai hash/pass, reviewer cùng process, nguồn file escape hoặc snapshot cùng byte khác provenance: giữ reported/unverified, không hoàn tất (T1/T3/T5).
4. Sync response cache, attestation cũ, project expectedCommit mới hoặc required page chỉ là artifact: hiển thị stale/unverified và chặn completion (T5/T6).
5. Cancel/rebind/UNKNOWN child trong validation/merge/cleanup: giữ authority/resource cần đối chiếu, chỉ dọn exact owned resources sau proof (T4/T6/T7).

## Producer gates và ownership

| Producer | Hợp đồng tiêu thụ nguyên trạng | Gate trước integration |
|---|---|---|
| 02 actual005 | `ServerOptions.verifyFinalResult`, `DocsCompletionReader`, `readCompletionFacts`; artifact registration chỉ reported | task5 reviewed9dca04e; actual app/Task7 constructors reviewed |
| 02 actual006 | `DocsSync`, `syncDocs`, `authorizeDocsSync`, `validateDocs`, `snapshotHash`, `sourceTreeHash`; immutable receipt `(attempt,merged_commit,input_sha256)` | 006 F1/F2 đã closed tại832c9a3; Task7 actual constructors/readers còn owner review, không đọc peer files đang sửa |
| 03 | `ResourceRegistry`, `ProcessJournal`, `HttpOperationJournal`; own target machine and007 companion | actual producer files/signatures reviewed; UNKNOWN fork/descendant không được đổi thành stopped |
| 04/05 | `EffectLedger`, `LogicalEffect`, RuntimePin;009 input revision/manifest/receipt | actual008/009 + source-isolation/runtime boundary certificate; logical effect giữ qua fallback |
| 06-r3 | `FinalEvidencePort`, run/step/gate/review/repair/monitor + current dispatch | actual011/constructor and official workflow review artifacts; plan approval không chứng minh implementation |

File ownership dùng đường dẫn từ repo root; controller duy nhất chạm shared files/manifest/index/commit. Worker không revert nhau; T2 có thể chuẩn bị fixture cùng T1, T3 đợi contracts T1/T2, T4 đợi T3, T5 đợi T1/T3/T4, T6 đợi T5, T7 serialize assembly.

| Task | Create ownership | Reviewed modify/handoff |
|---|---|---|
| T1 schema/trust | `v2/server/migrations/012_integration.sql`; `v2/server/src/integration/{contracts,authority,receipts,targets,heads}.ts`; `v2/server/test/integration-authority.test.ts`; `v2/server/test/support/integration.ts` | none; migration checksum frozen after review |
| T2 candidate/collector | `v2/gateway/src/integration/{contracts,git,candidate,collector,onboarding,object-transfer}.ts`; `v2/gateway/test/integration-candidate.test.ts`; `v2/gateway/test/support/integration-git.ts` | borrowed ResourceRegistry/ProcessJournal, no source edits |
| T3 gates | `v2/server/src/integration/{gates,reviews,source-proof}.ts`; `v2/gateway/src/integration/{checks,observer}.ts`; `v2/server/test/integration-gates.test.ts`; `v2/gateway/test/integration-checks.test.ts` | official06 workflow adapter supplies review runs |
| T4 merge | `v2/server/src/integration/{merge,merge-facts,routes}.ts`; `v2/gateway/src/integration/{merge,journal,transport}.ts`; `v2/server/test/integration-merge.test.ts`; `v2/gateway/test/integration-recovery.test.ts` | no005 command enum alteration |
| T5 docs attestation | `v2/server/src/integration/{docs-attestation,docs-reader,docs-results}.ts`; `v2/gateway/src/integration/{docs-sync,docs-result}.ts`; `v2/server/test/integration-docs.test.ts` | constructor-injected02Task7 reader, controlled T7 handoff |
| T6 final/recovery | `v2/server/src/integration/{final-evidence,recovery}.ts`; `v2/server/test/integration-completion.test.ts`; `v2/gateway/test/integration-cleanup.test.ts` |06 monitor calls frozen FinalEvidencePort, no second monitor |
| T7 assembly | `v2/server/src/integration/assembly.ts`; `v2/server/test/integration-acceptance.test.ts`; `v2/gateway/test/integration-acceptance.test.ts` | controller app/main/host composition, create `v2/server/src/tickets/completion-readers.ts` + modify completion.ts only after02 review, project-binding/revocation hooks, Task7 docs read/search, event whitelist; `v2/docs/{flows.yaml,index.md,files.md,architecture.md}` |

T1 fixture owns real HTTP server/private DB; T2 fixture owns bare repo + disposable worktrees and actual subprocesses. Helpers close only their owned handles. New docs flows `server-integration.md` (T1/3/4/6 server), `gateway-integration.md` (T2/3/4/5/6 host), `docs-attestation.md` (T5); controller updates each with each source commit, plus changed producer flows.

## Exact typed ports, canonical identities và trust

T1 exports following types from server contracts; gateway contracts validates matching versioned JSON with contract tests, never imports server runtime. `Id=string(UUID)`, `Sha256=string(hex64)`, `EffectId=Sha256` exact04 lowercase hex64 canonical logical-effect digest, `GitOid=string(hex40|hex64)` validated per repo object format; `Tx,Actor,ServerOptions,Ticket,DocsCompletionReader,DocsFile` import exact actual02 exports. Type aliases are transport constraints, not capabilities; operation/run/step/ticket/attempt/candidate/permit/receipt IDs stay UUID, effect parsers accept only lowercase hex64 without coercion to UUID.

```ts
type Scope={projectId:Id;ticketId:Id;runId:Id;stepId:Id;attemptId:Id;fence:string;
  processInstanceId:Id;machineId:Id;bindingRevision:number;inputSha256:Sha256};
type TargetPin={registrationId:Id;generation:string;bindingRevision:number};
type TargetSetupScope={projectId:Id;machineId:Id;bindingRevision:number;requestId:Id};
type Candidate={id:Id;scope:Scope;target:TargetPin;effectId:EffectId;wave:number;targetRef:string;sourceRef:string;targetOid:GitOid;
  sourceOid:GitOid;mergeOid:GitOid;treeOid:GitOid;parents:GitOid[];sourceManifestSha256:Sha256;
  diffSha256:Sha256;docsSha256:Sha256;policySha256:Sha256;workflowSha256:Sha256;sha256:Sha256};
type SourceEntry={path:string;mode:'100644'|'100755';blobOid:GitOid;size:number;sha256:Sha256};
type SourceProof={candidateId:Id;commit:GitOid;treeOid:GitOid;entries:SourceEntry[];
  trackedSourcePaths:string[];sourceTreeSha256:Sha256;sourceManifestSha256:Sha256};
type CheckProof={candidateId:Id;commandId:Id;argv:string[];cwdRelative:string;binarySha256:Sha256;
  environmentSha256:Sha256;startedAt:string;finishedAt:string;exitCode:number|null;signal:string|null;
  stdoutArtifactId:Id;stderrArtifactId:Id;beforeTree:GitOid;afterTree:GitOid;resultSha256:Sha256};
type ReviewProof={candidateId:Id;reviewAttemptId:Id;implementationAttemptIds:Id[];
  scope:'task'|'request'|'docs';stepId:Id;sourceSkillSha256:Sha256;diffSha256:Sha256;
  docsSha256:Sha256;findingsArtifactId:Id;resolvedFindingIds:Id[];verdict:'accepted'|'changes_required'};
type CurrentTargetProof={projectId:Id;target:TargetPin;targetRef:string;oid:GitOid;reservationId:Id;generation:string;completionOperationId:Id};
type ArtifactProof={reportedEvidenceId:Id;artifactId:Id;sha256:Sha256;byteLength:number;criteriaSha256:Sha256;reviewReceiptIds:Id[]};
type Observation={version:1;id:Id;challengeId:Id;nonce:string;scope:Scope;observerBuildSha256:Sha256;
  policySha256:Sha256;sequence:string;sha256:Sha256;signature:string} & (
  {kind:'source';payload:SourceProof}|{kind:'check';payload:CheckProof}|{kind:'review';payload:ReviewProof}|
  {kind:'merge';payload:MergeReceipt}|{kind:'target';payload:CurrentTargetProof}|{kind:'artifact';payload:ArtifactProof}|
  {kind:'docs_snapshot';payload:DocsOnlyProof}|{kind:'docs_review';payload:DocsOnlyReview});
type MergePermit={id:Id;candidateId:Id;candidateSha256:Sha256;scope:Scope;effectId:EffectId;
  receiptSetSha256:Sha256;generation:string;expiresAt:string};
type MergeReceipt={permitId:Id;candidateId:Id;effectId:EffectId;oldOid:GitOid;newOid:GitOid;
  treeOid:GitOid;parents:GitOid[];targetRef:string;receiptRef:string;journalSha256:Sha256};
type MergedDocsAttestation={kind:'merged';id:Id;projectId:Id;target:TargetPin;snapshotId:Id;attemptId:Id;mergedCommit:GitOid;
  inputSha256:Sha256;sourceTreeSha256:Sha256;sourceManifestSha256:Sha256;
  verificationEvidenceId:Id;mergeReceiptId:Id;structuralReceiptId:Id;semanticReceiptId:Id;policySha256:Sha256};
type DocsOnlyProof={snapshotId:Id;snapshotSha256:Sha256;artifactIds:Id[];criteriaSha256:Sha256;inputSha256:Sha256;
  requiredImplementedPages:string[];basis:(TargetPin & {headRevision:number;sourceCommit:GitOid;sourceManifestSha256:Sha256})|null};
type DocsOnlyReview={snapshotId:Id;snapshotSha256:Sha256;criteriaSha256:Sha256;inputSha256:Sha256;reviewAttemptId:Id;
  implementationAttemptId:Id;sourceSkillSha256:Sha256;findingsArtifactId:Id;verdict:'accepted'|'changes_required'};
type DocsOnlyAttestation={kind:'docs_only';id:Id;projectId:Id;ticketId:Id;attemptId:Id;bindingRevision:number;
  proof:DocsOnlyProof;sourceReceiptId:Id;structuralReceiptId:Id|null;semanticReceiptId:Id;policySha256:Sha256};
type DocsAttestation=MergedDocsAttestation|DocsOnlyAttestation;
type DocsState={snapshotId:Id;storedAuditState:'unverified'|'invalid'|'verified';
  verification:'unverified'|'verified';state:'current'|'stale'|'unverified';
  sourceCommit:GitOid|null;expectedCommit:GitOid|null;attestationId:Id|null};
interface IntegrationAuthority {
  accept(tx:Tx,actor:Actor,observation:Observation):Promise<Id>;
  issue(tx:Tx,actor:Actor,candidateId:Id):Promise<MergePermit>;
  acceptMerge(tx:Tx,actor:Actor,observation:Observation):Promise<Id>;
}
interface CandidateBuilder {prepare(scope:Scope,input:{effectId:EffectId;targetRef:string;sourceRef:string;sourceOid:GitOid}):Promise<Candidate>;}
interface IntegrationGit {apply(permit:MergePermit):Promise<MergeReceipt>;reconcile(effectId:EffectId):Promise<MergeReceipt|null>;}
type DocsResultState={kind:'docs_only';ticketId:Id;snapshotId:Id;sourceCommit:GitOid|null;expectedCommit:GitOid|null;
  storedAuditState:'unverified';verification:'unverified'|'verified';state:'current'|'stale'|'unverified';attestationId:Id|null};
interface TrustedDocsReader {state(tx:Tx,projectId:Id,snapshotId:Id):Promise<DocsState>;
  resultState(tx:Tx,ticketId:Id,snapshotId:Id):Promise<DocsResultState>;}
```

T1 `createIntegrationAuthority({now,verifyObservation})` returns IntegrationAuthority; `verifyObservation(observation:Observation|TargetRegistrationObservation):Promise<void>` is injected immutable cryptographic verifier against server-configured trusted observer identity, not a machine callback. Default throws `INTEGRATION_VERIFIER_NOT_CONFIGURED`503. T3 implements verified receipt creation after strict payload discriminant/schema/hash and all source/process/policy checks.

Observer admission is separate from bearer auth: server-issued nonce/challenge binds exact scope/build/policy/expiry; observer signing key unavailable to model/test child. Enrollment requires controlled trusted host deployment plus measured denial of key/journal tampering, forged child output and escaped descendants. Server pins enrolled public key/build/policy via trusted deployment configuration, never self-enrolls from machine request. Missing certification remains UNVERIFIED; runtime04 certificate alone does not certify this observer. T7 test key exists only in private fixture, never production fallback/env bypass.

Sign canonical `{version,kind,id,challengeId,nonce,scope,observerBuildSha256,policySha256,sequence,payload,sha256}` excluding signature; `sha256` hashes same object excluding sha256/signature. Replay observation ID+exact hash returns same immutable receipt after current auth; changed body409, reused nonce in another scope409. Strict route schema couples kind to exactly its payload variant (no loose union accepting a check as a merge). Unknown field/kind rejected before receipt creation.

Candidate digest hashes canonical fields except id/sha256; policy digest includes required command IDs/argv/env, workflow pin/gates/input, task/request/docs review coverage and validator build. Receipt-set digest hashes sorted immutable receipt IDs+hashes. Source manifest hashes sorted NFC safe path/mode/blob/size/content SHA entries from actual candidate tree; no symlink/submodule, case alias, unsupported encoding, absolute/traversal/NUL path. Reject missing referenced manifest file. `sourceTreeSha256=sourceTreeHash(trackedSourcePaths)` stays exact006 **path-list hash**, never content-tree claim; separate sourceManifestSha256 proves content.

## Persistence012 và wire

All IDs/FKs bind project/ticket/attempt with composite scope checks; append-only evidence rows reject UPDATE/DELETE. Every012 effect_id/effect field in candidate/permit/merge receipt/docs job and canonical JSON is EffectId stored text CHECK `^[0-9a-f]{64}$`, never UUID; ordinary ID/FK columns stay UUID. T1 owns complete migration, every later table consumer present before freeze. This is plan typing only; do not edit frozen SQL001–012.

| Table | Columns/constraints in addition to id/created_at |
|---|---|
| `integration_challenges` | nonce UNIQUE, discriminated attempt-scope OR target-request-scope/kind/build/policy/key ID, request_sha256, expires_at, consumed_observation_id nullable; exact replay only |
| `integration_target_reservations` | project/target/ref PK, registration_id/registration_generation/binding_revision, purpose apply/complete, operation_id, generation, state held/uncertain/released, current_observation_id nullable; release only acknowledged outcome/reconciled no-effect |
| `integration_target_requests` | owner request/selection hash, project/machine/binding, selected bound checkout/ref, prepared origin identity/OID, mode managed_copy, activation decision ID, state requested/prepared/active/revoked; original request immutable |
| `integration_targets` | registration ID, project/machine/binding/generation, request/proof IDs, managed repository identity/ref, transfer policy/hash, state active/revoked; only one active per project; identity and selection immutable |
| `integration_candidates` | Candidate fields, canonical JSON+sha; UNIQUE(project_id,effect_id,wave); immutable; target ref allowlist from project config |
| `integration_observer_receipts` | observation ID UNIQUE, challenge ID, kind, scope, payload/hash/signature/key/build/policy, received_at; nonce+scope unique; scope discriminates attempt from target setup; no machine verified flag |
| `integration_permits` | MergePermit fields, state prepared/applying/applied/uncertain/rejected, receipt ID nullable; one unresolved permit per(project,target_ref); CAS generation, no TTL unlock |
| `integration_merge_receipts` | MergeReceipt+observer receipt FK, UNIQUE(project_id,effect_id), UNIQUE(permit_id); exact candidate FK |
| `integration_project_heads` | project_id PK, registration_id nullable, generation, binding_revision, state unverified/current/stale/revoked, target_ref nullable, expected_commit nullable, revision, merge_receipt_id nullable, observation_receipt_id nullable; sole head authority;003 expected_commit is same-Tx projection |
| `integration_docs_jobs` | command_id PK, ticket/attempt/registration/generation/binding/fence/effect/merged_commit, operation_id UNIQUE, UNIQUE(ticket_id,attempt_id,merged_commit), state pending/running/retry/done, next_due_at, attempts, last_error, immutable request_hash |
| `integration_docs_job_operations` | operation_id PK, job_id FK, request_hash; alternate monitor operation maps to same logical job, changed payload409 |
| `integration_docs_attestations` | MergedDocsAttestation fields; composite FK006 receipt(attempt,merged_commit), snapshot/project; UNIQUE(attempt_id,merged_commit,input_sha256,policy_sha256); append-only |
| `integration_docs_only_snapshots`, `integration_docs_only_files` | immutable ticket/attempt/project/binding/input/criteria scope, snapshot_sha, source_kind=task_docs_result, raw_audit_state=unverified, basis nullable; files(snapshot_id,path PK,bytes,sha,class), same006 bounds; never006 imported/sync rows |
| `integration_docs_only_attestations` | DocsOnlyAttestation fields + immutable proof hash, UNIQUE(ticket_id,attempt_id,snapshot_id,criteria_sha256,input_sha256,policy_sha256); ticket/attempt composite scope, no merge FK |
| `integration_completions` | ticket/attempt, kind code/docs_merged/docs_only/research, candidate/merge/merged_attestation nullable, docs_only_attestation nullable, evidence_set_hash, head_revision nullable, verified_result_evidence_id; CHECK code/docs_merged require merge+merged_attestation only, docs_only requires docs_only_attestation only, research neither; UNIQUE(attempt_id,evidence_set_hash) |

Trusted verification promotion inserts new004 evidence linked `reportedEvidenceIds`/receipt IDs, original reported payload unchanged. T5 creates exact docs_verification evidence with sourceCommit/sourceTreeSha256 and scoped attempt BEFORE006 sync; only T1/T3 trusted receipt admission can issue it. No new public “verified evidence” endpoint.

| Wire | Input/output and authority |
|---|---|
| POST `/v2/integration/projects/:id/target-requests` | owner+CSRF `{expectedBindingRevision,targetRef,mode:"managed_copy"}` → requestId; bound machine only reads scoped request |
| GET `/v2/integration/target-setup-jobs` | current bound machine → own pending target request IDs + server-derived binding/checkout/ref; durable replay, no model attempt required |
| POST `/v2/integration/target-requests/:id/prepared` | bound machine signed TargetRegistrationObservation → prepared preview; no activation from machine |
| POST `/v2/integration/target-requests/:id/activate` | owner+CSRF `{expectedBindingRevision,preparedSha256,acceptManagedTarget:true}` → TargetPin; exact preview/repo/ref intent + current trusted registration proof |
| POST `/v2/integration/candidates` | bound machine `{candidate,sourceObservation}` → candidate ID; recompute server hashes; reported until trusted observation accepted |
| POST `/v2/integration/challenges` | `{scope,kind,requestSha256}` → server nonce/id/expiry; bound machine and attempt scope requires current reserved execution; target_registration scope requires current binding+owner request (no fabricated attempt), issuer selects pinned observer identity |
| POST `/v2/integration/observations` | bound machine Observation → receipt ID; current auth before idempotency replay; observed process/policy verified by authority |
| POST `/v2/integration/candidates/:id/permit` | `{fence,processInstanceId,receiptIds}` → MergePermit; server resolves required receipts/current gates, not caller selection alone |
| POST `/v2/integration/permits/:id/apply` | `{fence,processInstanceId}` → permit applying; current005/011/input/policy under Tx, one durable apply generation |
| POST `/v2/integration/permits/:id/result` | signed merge Observation → receipt ID; exact effect/candidate; idempotent recovery may append historic fact but cannot grant fresh execution |
| GET `/v2/integration/projects/:id/state` | scoped current read → target/expectedCommit/revision/pendingPermit/docs state; cached receipt never current authorization |
| POST `/v2/integration/tickets/:id/docs-results` | bound attempt `{scope,files,snapshotSha256,proofObservation,reviewObservation}` → DocsOnlyAttestation; same strict file limits006, no merge field/006 sync required |
| GET `/v2/integration/tickets/:id/docs-results/:snapshotId?path=...` | current scoped actor → DocsResultState + path/hash/class page list or selected UTF8 page; ticket snapshot ACL, no promotion into006 project catalog |
| GET `/v2/integration/docs-jobs` | current bound machine → pending own jobs; own012 command namespace, never add sync_docs to005 enum |
| POST `/v2/integration/docs-jobs/:id/result` | `{snapshotId,inputSha256,observationIds}` → attestation ID or typed error;006 existing sync endpoint first, own current auth before replay |

Mutator002 transaction lock order retains06 journal/root/command/sorted tickets/project/machine/input/guard producer order, then012 target/candidate/receipt; controller reviews actual lock graph, never introduces inverse nesting. No network/Git/model call inside DB transaction. Binding CAS must consult unresolved integration permit **and**005 guard; narrow injected guard in T7 only after producer owner review. Reject rebind while applying/uncertain even if lease expired.

### Bounded target/source authority và implementation contract tests

Target registration is produced by T1 targets/heads + T2 onboarding/object-transfer + T4 routes (F3 below), not inferred from003 binding. Identity includes canonical realpath/device/inode, Git common-dir/object-format and origin OID lineage. Accepted implementation report supplies source ref. Neither owner credential nor arbitrary URL is available to the transfer helper.
Only trusted host integration helper may mutate the managed target while its reservation is active; runtime agents receive isolated worktrees and cannot write target refs, observer keys or journals. Prove this isolation in T7 negative process tests. An unmanaged target or boundary that cannot prevent competing writers returns `TARGET_AUTHORITY_UNVERIFIED`, never promises SQL and Git are atomic. Git old-OID CAS remains mandatory defense against observed drift.
T4 reserves target across apply/unknown recovery; T5/T6 reacquire it for current-target challenge and completion. Current-target receipt authorizes exactly one completion operation under that reservation, not future completions. Crash before acknowledgment retains reservation until current target/DB outcome reconciliation; no lease-only reclaim. Existing project binding cannot move around this reservation.

T1 owns fixture method signatures used in snippets: `rawSnapshot(id)`, `docsState(id)`, `docsCompletion(projectId,commit)`, `stopAttempt()`, `submitPassedWithoutDocs()`, `attempt()`, `guard()`, `rows(table)` and `machine.post(path,body)`; DTOs match production responses, table reads are test-only allowlisted SQL.
T2 fixture exports `readCommit(oid):Promise<{parents:GitOid[];tree:GitOid}>`, `ref(name):Promise<GitOid>`; T4 extends its owned recovery fixture with `crashAt(point)`, `restartHostAndApi()`, `resumeEffect(effectId)`, `countAppliedRefTransitions(effectId)`, `readMergeReceipt(effectId)`. Count observes durable Git ref history plus012 receipt, not a mocked call counter.
T3 fixture `runner.run(command)` wraps actual runChecks for one command and returns one signed Observation; `gates.evaluate(candidate)` invokes actual evaluateGates through normal persisted candidate/receipt setup. A malformed/incomplete candidate test must not seed a verified result. Production service signatures above remain authoritative.
T7 adds compile-time conformance `const port: FinalEvidencePort = assembleIntegration(deps).finalEvidence`; public005/FinalEvidencePort unchanged. `DocsCompletionReader(tx,projectId,commit)` stays commit-or-null and returns null when commit is null; ticket-scoped docs-only proof uses the internal registered reader adapter below, never a fake Git commit or project-wide fallback.

## F1–F4 — Producer seams bắt buộc trước assembly

**F1 factual merge writer (T4 `merge-facts.ts`, owner02 review):** `acceptVerifiedMergeFact(tx:Tx,input:{receiptId:Id;target:TargetPin;reservationId:Id;completionOperationId:Id}):Promise<{disposition:'current'|'historic';jobId:Id|null}>` is module-internal, called only by acceptMerge after trusted receipt admission. It derives commit/scope from accepted012 receipt, never a client commit parameter. Integration for code-request completion uses that request's current attempt; child-only effects cannot stamp unrelated/root tickets.
Under journal→root→attempt ticket/guard/attempt/command→project/machine→target reservation locks, verify permit/effect/receipt/candidate/current registration+binding/fence/target observation, then in ONE Tx append accepted012 receipt + verified004 merge evidence, call `writeExpectedHead`, write `tickets.merged_commit=newOid` for the attempt's exact ticket and enqueue/reuse012 docs job. Guard, status, ticket revision, terminal result and terminal intent are unchanged; factual projection must not invalidate the attempt's dispatch revision. Event contains fact/receipt IDs; observed ticket row remains running/finalizing, not done. Actual006 can now authorize the matching DocsSync.
`terminal_intent` already defaults complete in005: do not reset pause/cancel/retry/needs_input. Current+complete gives pre-sync ticket fact/job; canceled/paused/retry or superseded wave records historical Git fact only, no ticket-current write/job. If actual target changed despite cancellation, head authority still records observed truth, without granting completion. Drift/old target generation never overwrites newer head/ticket fact. A later wave supersedes ticket fact only after a fresh verified current merge and matching attempt authorization.
Same exact receipt replay rechecks current scope before cached reply, returns immutable historic receipt without replaying projection/job writes; altered hash409. Crash after Git before Tx retries same acceptMerge and applies fact exactly once. Crash after Tx before reply reads current state and same job; stale/revoked machine cannot bootstrap a fresh write from cached acceptance. No006/public005 or terminal-state bypass.

**F2 ticket-scoped docs-only proof (T5 + owner02 internal adapter):** `attestDocsOnly(tx:Tx,input:{scope:Scope;files:DocsFile[];proof:DocsOnlyProof;sourceObservationId:Id;reviewObservationId:Id}):Promise<DocsOnlyAttestation>` persists own012 task-produced immutable snapshot/files and attestation atomically, never inserts fake006 checkout_sync/sourceCommit/merge receipt. Signed trusted producer links artifact IDs to exact raw file bytes/hash/class, current input/criteria/workflow, same attempt and ticket. Existing006 imported/unverified rows cannot be selected as docs-only proof.
Criteria decide classes: standalone requested design/report artifact keeps workflow format; criteria requiring implemented pages requires those exact paths/classes, actual structural validator and SourceProof for `basis.sourceCommit` at current registered target. Source basis is real existing code, not a claimed docs merge. Artifact-only cannot satisfy implemented-page criteria. Semantic DocsOnlyReview comes from independent official reviewer, binds snapshot/criteria/input, no candidateId needed. A stale criterion/input/binding/basis/policy revokes current eligibility while immutable snapshot remains.
```ts
type TicketCompletionProof={resultEvidenceIds:Id[]} & (
  {kind:'merged';mergeEvidenceId:Id;commit:GitOid;attestationId:Id}|
  {kind:'docs_only';mergeEvidenceId:null;snapshotId:Id;attestationId:Id}|
  {kind:'research';mergeEvidenceId:null});
type TicketCompletionReader=(tx:Tx,ticket:Ticket)=>Promise<TicketCompletionProof|null>;
```
T7 controller creates `tickets/completion-readers.ts`: `bindCompletionReader(publicReader:DocsCompletionReader,scoped:TicketCompletionReader):DocsCompletionReader` returns a fresh callable and stores its immutable scoped reader in a module-private WeakMap; `readTicketProof(tx,ticket,publicReader)` resolves only server-created associations. This passes unchanged through existing005 finalize and createTicketServices paths; no DTO/new public callback parameter or caller-injected marker. `readCompletionFacts` uses scoped evidence IDs for every kind; default unregistered production adapter denies these new proofs. Wrapping/replacing the callable requires rebinding through the factory; test both005 finalization calls preserve the same registered reader rather than accepting a lost association.
For commit=null public DocsCompletionReader still returns null; no snapshot from another ticket/project fallback. For docs request with valid `docs_only` proof, internal completion predicate is mandatoryStepsPassed && evidenceReady && current ticket-scoped snapshot proof; return `{mergedCommit:null,docsCommit:null,ready:true}`. Do not feed fabricated string into domain canComplete or call its current docs branch with null and pretend true: that branch models only commit-backed docs. This explicit internal snapshot branch implements the same required-docs condition with different provenance; code still uses unchanged domain equality and can NEVER consume docs_only. Final status writer leaves merged_commit null. Factory + this narrow completion adapter need02 review before012/T5 freeze.

**F3 onboarding (T1/T2, route owner T4):** owner request selects existing bound checkout repository via current bindingRevision plus exact targetRef; helper discovers its actual identity/OID for owner to approve in activation, so onboarding requires no pre-existing identity service. Machine preparation reads origin objects only, creates ResourceRegistry-owned private bare repo (no shared alternates/hardlinks), preserves branch name and ancestry, and returns signed preview of origin→managed target identity/ref/OID. Owner activation explicitly accepts that managed repo as project's auto-merge destination; never claim original checkout's main was merged. No default branch substitution. UI/API state includes registration and target label so this authorization is reviewable.
`TargetRegistrationObservation={version:1;kind:'target_registration';id:Id;challengeId:Id;nonce:string;scope:TargetSetupScope;sequence:string;payload:{originIdentitySha256:Sha256;originRef:string;originOid:GitOid;managedIdentitySha256:Sha256;managedRef:string;managedOid:GitOid;transferPolicySha256:Sha256};observerBuildSha256:Sha256;policySha256:Sha256;sha256:Sha256;signature:string}`. T1 challenge/verify accepts this distinct onboarding scope only for an exact owner-requested target, without inventing an execution attempt. Normal Observation scope remains unchanged. Preparation proof cannot activate itself; trusted helper/observer certification still mandatory.
T1 `requestManagedTarget(tx:Tx,actor:Actor,input:{projectId:Id;expectedBindingRevision:number;targetRef:string;mode:"managed_copy"}):Promise<Id>` / `activateManagedTarget(tx:Tx,actor:Actor,input:{requestId:Id;preparedSha256:Sha256;expectedBindingRevision:number;acceptManagedTarget:true}):Promise<TargetPin>`; T2 `prepareManagedTarget(requestId:Id):Promise<TargetRegistrationObservation>` / `transferSource(target:TargetPin,input:{attemptId:Id;sourceOid:GitOid;sourceRef:string}):Promise<Id>`; T1 `acceptPreparedTarget(tx:Tx,actor:Actor,proof:TargetRegistrationObservation):Promise<{preparedSha256:Sha256}>` verifies and persists preparation; T4 wires owner/current-machine routes above. Persistence includes immutable request/proof/activation/identity/generation; response loss/restart resolves same IDs and exact filesystem identity, never makes another managed repo silently.
Initial copy and subsequent source transfer use locally generated bounded object bundles from exact accepted origin/implementation OIDs (max512MiB per operation, no network protocol/credential/helper/hooks). Trusted helper validates object format, bundle SHA/manifest, required ancestry, `git fsck --strict` and accepted report scope; imports only under a staging ref then approved source ref in registered repo. Never copy owner untracked/index state. When unavailable/too large/divergent origin returns `TARGET_SETUP_REQUIRED` or `SOURCE_TRANSFER_REJECTED` with exact failed step; owner can submit corrected explicit request. Onboarding performs no stash/reset/checkout/branchswitch or origin ref write, whether origin is clean or dirty.
Rebind/revoke/inode/common-dir substitution invalidates registration and transfer permission; no unchecked path fallback. Cleanup never removes active managed target: retained project resource outlives a run, later disposal requires no referenced receipts/jobs/attempts and explicit target retirement. Current normal checkout at main is supported by the managed-copy flow; direct apply against its checked-out ref remains denied.

**F4 sole head authority (T1 heads.ts, T4 merge, T7 binding hooks):** `writeExpectedHead(tx:Tx,input:{projectId:Id;expected:{target:TargetPin|null;headRevision:number};next:{target:TargetPin|null;bindingRevision:number;generation:string;oid:GitOid|null;observationId:Id|null;state:"unverified"|"current"|"stale"|"revoked"};cause:'initialize'|'activate'|'observe'|'merge'|'drift'|'invalidate'}):Promise<number>` is the only head writer; it checks actor/receipt authority at caller and CAS registration+binding+head revision. In the SAME Tx update012 authority and existing003 `projects.expected_commit` projection (nullable), append metadata event. No SQL003/006 rewrite, no second independent expectedCommit truth. All project/docs/Assistant/Web readers call `readExpectedHead(tx,projectId)` returning `{target:TargetPin|null,bindingRevision:number,generation:string,revision:number,expectedCommit:GitOid|null,state:"unverified"|"current"|"stale"|"revoked"}`; raw003 field exposed only as asserted-equal compatibility projection.
First target request initializes absent012 head with current binding, generation1/state unverified/commit null and clears003 projection in same Tx; no head row reads unverified/null, never falls back to cached003 commit. Activation sets both heads from current signed exact managed-target proof, generation new; T1 targets accepts request-provenance observation and owns activation writer, T2 observer owns actual identity/object-byte evidence, neither machine self-report nor owner click alone proves it. Observe refreshes matching registration; identical pin/OID/state keeps head revision (only proof freshness changes), so unchanged docs do not become stale on every poll; accepted merge updates both plus F1 facts/job atomically. Observed external drift updates both to actual OID with stale evidence; unknown/substituted identity sets both null/unverified. Unmerged docs-only with no source basis never changes project head. Historic attestations keep bytes/provenance and cannot advance head.
`invalidateIntegrationBinding(tx:Tx,projectId:Id,nextBindingRevision:number):Promise<void>` calls writeExpectedHead with null next target/commit and new generation, and runs in reviewed bindProject/revoke transaction after existing execution+012 reservation guards, BEFORE003 binding write clears expected_commit: retire012 active registration, increment generation/head revision, clear012 expected_commit/observation and003 projection, invalidate current proof eligibility. Any binding revision change, including same machine AND same checkoutPath, requires new onboarding/observation. Machine revoke invalidates all affected project authorities in deterministic project order; denied unresolved execution follows existing guard policy, never silently frees reservations. Reader additionally requires equality to current003 binding and nonrevoked machine, so missed/out-of-band mismatch denies instead of exposing old current.
T7 hands02Task7/06/07 the same reader with raw snapshot audit versus derived attestation and one expectedCommit. Projection update, docs reader, completion and rebind race use same Tx snapshot/locks. Backup/restart restores registration generation+head/projection together; mismatch is corruption/503, not independent fallback. Freeze012 and T4/T5 only after owner02 signs these fact/reader/binding seams; implementation certification is still a separate gate.

## T1 — Schema, receipt authority và fixture

**Interfaces:** produces types/authority/012 above; `issueChallenge(tx:Tx,actor:Actor,input:({scope:Scope;kind:Observation['kind']}|{scope:TargetSetupScope;kind:'target_registration'}) & {requestSha256:Sha256}):Promise<{id:Id;nonce:string;expiresAt:string}>` and `reserveTarget(tx:Tx,input:{projectId:Id;targetRef:string;operationId:Id;purpose:'apply'|'complete'}):Promise<{id:Id;generation:string}>` are internal server methods, not client trust bypass; consumes002 Mutator,005 current attempt,011 run/gates. `integrationFixture(db,clock)` returns real HTTP clients `owner,machine,otherMachine`, trusted fixture observer, `rows(table)`, `close()`; no seeded verified production evidence.
- [ ] RED `integration-authority.test.ts`: valid signed known-process observation persists once; change scope/body/build/signature rejects; bearer-only verified:true rejects; stale fence/expired nonce/revoked machine rejects before cached response; two pools race same observation produce one receipt/event.
```ts
assert.equal((await f.machine.post('/v2/integration/observations',f.forgedObservation)).statusCode,403);
assert.equal((await f.rows('integration_observer_receipts')).length,0);
```
- [ ] Run `pnpm --dir v2/server test --test-name-pattern='integration authority'`; RED must reach assertion after existing001–011 fixture setup, missing producer is BLOCKED, not expected RED.
- [ ] RED F3/F4 authority: owner-only request/activate, mismatched prepared hash/binding/ref/identity deny; machine cannot self-activate. Two pools race head projection/rebind:003 and012 equal at each committed snapshot; revoked/current mismatches deny reads and writes.
- [ ] GREEN strict envelope validator + signature/nonce authorization, immutable inserts and current-scope replay callback; backup private011 DB, migrate012, restore011→012 and restore012 retain receipt hashes/replay. No SQL006 trigger/index/provenance change.
- [ ] Re-run focused tests/server typecheck; independent trust/schema review; controller updates server-integration flow and commits `feat(v2): persist trusted integration receipts` only after review/docs gates.

## T2 — Candidate commit và source proof thực tế

**Interfaces:** F3 prepareManagedTarget/transferSource produce reviewed registration/object-transfer receipts, consumed by `createCandidateBuilder({git,resources,journal}):CandidateBuilder`; `collectSourceProof(candidate:Candidate):Promise<SourceProof>`; `git(args:string[],stdin?:Buffer):Promise<{stdout:Buffer;stderr:Buffer;exitCode:number}>` executes allowlisted argv, no shell.
- [ ] RED F3 begin with bound original checkout at main, separately clean and dirty/untracked: direct apply denied, owner request→trusted managed preparation→owner activate→source bundle transfer→candidate works. Assert origin index bytes, HEAD/ref and tracked/untracked bytes identical; no remote calls. Restart finds same managed identity; rebind, symlink/inode replacement or foreign source transfer rejects.
- [ ] RED real fixture repo: nonconflicting branch candidate has exact target/source parents and actual merge tree; target moved makes new candidate wave; conflict needs resolution branch then new candidate; tracked missing file, symlink/submodule/path escape denied. Owner checkout dirty/untracked hashes unchanged.
```ts
const c=await builder.prepare(scope,{effectId,targetRef:'refs/heads/main',sourceRef:'refs/heads/feature',sourceOid});
assert.deepEqual((await fixture.readCommit(c.mergeOid)).parents,[c.targetOid,sourceOid]);
assert.equal((await fixture.ref('refs/heads/main')),c.targetOid);
```
- [ ] Run `pnpm --dir v2/gateway test --test-name-pattern='integration candidate'` RED; GREEN reserve/createAndAttest scratch; read exact target/source OIDs; prepare detached merge checkout, resolve only owned scratch, create commit once with preserved commit metadata and refs under private run namespace before validation. Tests/docs/review consume this exact commit, not “equivalent” branch contents.
- [ ] GREEN implement F3 onboarding/registration recovery/object-transfer in owned files and routes; active managed repo retained beyond run; rejection explains exact missing owner activation/current proof/transfer reason.
- [ ] GREEN `git ls-tree -rz --full-tree <oid>` + bounded cat-file reads prove path/blob bytes at commit; recompute both006 paths hash and full manifest hash. Disable hooks/filters/external diff/config inheritance for observer Git, isolate only subprocess config/env; preserve owner config. Direct apply rejects checked-out origin target; F3 managed_copy + exact owner activation provides supported safe destination without touching origin index/ref/bytes. All candidate/source/apply calls require active TargetPin and accepted source-transfer receipt.
- [ ] Re-run test/gateway typecheck; independent candidate/provenance review; gateway-integration docs; controller commit `feat(v2): build immutable integration candidates`.

## T3 — Actual checks, independent review và docs semantic gates

**Interfaces:** `runChecks(candidate:Candidate,commands:ReadonlyArray<{id:Id;argv:string[];cwdRelative:string}>):Promise<Observation[]>`; `evaluateGates(tx:Tx,candidateId:Id):Promise<{receiptIds:Id[];sha256:Sha256}>`; `acceptReview(tx:Tx,proof:ReviewProof,observationId:Id):Promise<Id>`.
- [ ] RED run real child exit0/exit1/signal/missing command, mutate tracked file during test, omit required command, replace binary/stdout artifact, old diff/docs digest; none yields gate receipt. Exact candidate uses fresh detached checkout; command config pinned server policy, client cannot choose `true`.
```ts
const observed=await runner.run(fixture.failingCommand);
assert.equal(observed.kind,'check'); if(observed.kind==='check') assert.equal(observed.payload.exitCode,1);
await assert.rejects(()=>gates.evaluate(candidateWithMissingRequiredCommand),/CHECKS_INCOMPLETE/);
```
- [ ] RED self-review/same process or reviewer implementation write ownership, wrong task scope, task-only without final request review, unresolved important finding, stale source skill/policy/input; docs flow merely touched and conflict text semantically wrong require changes. Official review artifact transport alone is not evidence of quality.
- [ ] Run gateway `integration checks` and server `integration gates` patterns RED; GREEN observer records actual child start/exit/output hashes, tree before/after and executable/env digest, signed scoped receipt; process UNKNOWN cannot attest completed check or release resources. Exact binary/argv/output absence fails closed.
- [ ] GREEN invoke actual02 `validateDocs` on candidate bytes/classes + trusted tracked list and pinned STANDARD; missing headings, bad manifest/coverage/generated/link errors block. Derive impacted flows from union old/new mappings, include deletes/renames/conflict diff despite merge R3 exemption. Official06 reviewer inspects code/docs diff, tests, claims, required pages; record findings/evidence and explicit unresolved limits, no Crew docs role prompt.
- [ ] GREEN join each mandatory step/task review plus whole-request review and docs semantic review; required workflow owner approvals match current artifacts. Gate computes receipt digest itself; any source/target/input/policy change invalidates candidate checks/reviews. Model/infra failure follows06 recovery; real failed repair review invokes004 counter once.
- [ ] Re-run focused tests/typechecks; independent source/test/semantic-gate review; docs flows; controller commit `feat(v2): verify candidate checks and independent reviews`.

## T4 — Fenced local merge và crash reconciliation

**Interfaces:** `createIntegrationGit({git,journal,resources,effects,http}):IntegrationGit`; authority issue/acceptMerge and F1 acceptVerifiedMergeFact above. Local012 journal keyed `(projectId,effectId)` persists candidate/permit/commit OID/apply state/receipt and fsyncs before external effect;04 logical effect ID is stable through fallback. Journal keys, effect locks and `refs/crew/integration/<effectId>` use the exact lowercase hex64 digest, never UUID parsing/truncation/rehashing; target lock semantics unchanged. Server transactionally reads011 assistant_operation_ids by effect_id, matches id=stepOperationId/run/step/action/target/precondition and recomputes unchanged04 canonical digest, checks scope via workflow_steps/assistant_dispatches; local04 EffectLedger owns execution/reconcile, is not a SQL ledger.
- [ ] RED F1 actual HTTP with tickets.merged_commit initially null: trusted merge result transaction writes fact+verified evidence+same head projections+one job while status/guard/intent unchanged; failing last job insert rolls whole Tx back, retry after restart writes once. Cancel/pause/retry, historic/superseded wave and cached response cannot reset intent or overwrite current fact.
- [ ] RED target/source/policy advanced after permit, concurrent two permits, same effect other runtime, cancel before apply, lost apply response, wrong machine/stale fence. Crash immediately before/after commit-object creation, before/after target ref, before local/server receipt, before result response; restart real host/API/pool and inspect Git/rows.
- [ ] RED EffectId conformance: actual04 canonical derive + actual011 operation producer mapping→real HTTP candidate/permit/apply/signed receipt→restart/reconcile preserves the same hex64 in012, journal and receipt ref. UUID-looking effect, changed digest/action/target/precondition or foreign run/ticket mapping deny before effect; no synthetic UUID fixture or parser bypass. Fact writer/reader/onboarding/head tests and authority stay unchanged.
```ts
await fixture.crashAt('after-ref-update'); await fixture.restartHostAndApi();
await fixture.resumeEffect(effectId);
assert.equal(await fixture.countAppliedRefTransitions(effectId),1);
assert.equal((await fixture.readMergeReceipt(effectId)).newOid,candidate.mergeOid);
```
- [ ] Run server `integration merge` + gateway `integration recovery` RED; GREEN server `issue` checks every gate and current target observation, reserves target/effect; apply Tx rechecks current authority/input/gates/cancel and persists applying. Existing apply replay must GET current state before host effect, expiry never clears ambiguous applying.
- [ ] GREEN host exclusive managed repository lock, re-read source/target, verify permit+saved candidate, journal intent fsync, then `git update-ref --stdin` transaction: verify immutable candidate sourceRef/sourceOid; update target newOid oldOid; create immutable `refs/crew/integration/<effectId>` newOid. Commit object already tested; no post-review merge/squash/rebase. Persist outcome/ref identities, fsync journal, submit signed receipt. Git config durability support must be measured on shipped Git; power-loss uncertainty stays uncertain.
- [ ] GREEN acceptMerge invokes F1 fact writer and F4 head writer before exposing successful current result; never wait for006 sync/final passed to write factual commit.
- [ ] GREEN recovery reads exact saved candidate object/tree/ordered parents, target/ref receipt and journal. Both refs match→report same result; old target with no receipt→retry same authorized CAS only after current check; different target with receipt plus proven ancestry→record historical merge, mark docs/current completion stale; mismatch/missing journal/partial refs→uncertain, retain and ask owner, never infer from commit message or call merge again.
- [ ] GREEN cancel wins before applying→reject; cancel after applying drains/reconciles actual helper and records irreversible Git fact, cannot pretend undo; no force-reset. Binding changes wait unresolved permit; offline retains target reservation. Rollback after accepted merge is explicit new reviewed revert candidate, never silent reset. Preserve backup ref/commit/artifact until retention allows cleanup.
- [ ] Re-run focused tests/typechecks; independent race/crash review; both integration flows; controller commit `feat(v2): reconcile fenced local merge effects`.

## T5 — Immutable006 snapshot, trusted012 attestation và honest reader

**Interfaces:** `attestDocs(tx:Tx,input:{jobId:Id;snapshotId:Id;inputSha256:Sha256;observationIds:Id[]}):Promise<MergedDocsAttestation>` + F2 `attestDocsOnly`; `createTrustedDocsReader():TrustedDocsReader`; `createDocsCompletionReader():DocsCompletionReader`; `syncMergedDocs(jobId:Id):Promise<void>` uses actual006 DocsSync without new trust fields.
- [ ] RED F2 docs-only HTTP: no merge evidence/job/ticket commit; task-produced snapshot+independent criteria review→stored012 proof→stop/result/finalize done, reported commit fields remain null. Wrong ticket/attempt/input/criteria/binding, stale source basis, imported proof, missing implemented pages or artifact-only for implemented criteria deny; same valid docs-only proof cannot complete code.
- [ ] RED real sync creates stored unverified snapshot/receipt, then accepted012 attestation makes derived state current while original rows/bytes/audit remain byte-identical. Same snapshot reused different attempt requires that attempt receipt/input; imported/unverified/artifact-only/missing required implemented page denies; forged source list/commit/tree/semantic ID denies.
```ts
assert.equal((await f.rawSnapshot(snapshotId)).audit_state,'unverified');
assert.equal((await f.docsState(snapshotId)).state,'current');
assert.equal(await f.docsCompletion(projectId,otherCommit),null);
```
- [ ] Run `pnpm --dir v2/server test --test-name-pattern='integration docs'` RED; GREEN build DocsSync from actual accepted mergeOid using T2 collector and T3 trusted docs_verification evidence. Existing006 authorize before replay + strict input hash retained. Store sync reply then independently join DB006 receipt/snapshot/files to signed source/check/review/merge receipts; cached response cannot attest itself.
- [ ] GREEN re-run structural validator on stored raw bytes, verify snapshotHash and exact docs set/class from merge tree; sourceCommit/mergedCommit, trackedSourcePaths hash, sourceManifestSha256, verificationEvidenceId, attempt/fence and inputSha256 all bind same job/candidate. Immutable012 attestation inserts only after all joins, no UPDATE006 rows or audit labels. First snapshot's audit_report evidence ID may belong prior reuse attempt: use this job's exact receipt/input and attestation, preserve original audit.
- [ ] GREEN implement F2 immutable docs-only producer/discriminated attestation, scoped result reader and registered completion adapter; standalone workflow format preserved, current project implemented docs still use required-page/source proof; no006 snapshot promotion.
- [ ] GREEN current read returns storedAuditState plus independent derived verification/state. Old valid attestation remains verified provenance but stale if expectedCommit differs; no attestation→unverified; required pages implemented only even mixed snapshot. Do not move006 latest_verified pointer to raw-unverified row;012 reader selects trusted attestation from current project head. Task7/phase07/06 projections retain raw label and expose derived state explicitly; never silently relabel auditState.
- [ ] GREEN completion reader returns commit only when requested commit==integration_project_heads.expected_commit==merge receipt newOid==snapshot.source_commit==attestation.mergedCommit, required implemented pages current, structural/semantic policy accepted, exact sync receipt present. Null/stale/unknown target blocks this merged path. F2 docs_only reader instead proves same-ticket snapshot/criteria without merge, reports commit fields null and uses the explicit internal snapshot predicate; code cannot take that branch.
- [ ] Re-run focused tests/server typecheck; independent raw-provenance/reader review; docs-attestation flow + Task7 handoff; controller commit `feat(v2): attest synced docs without rewriting provenance`.

## T6 — FinalEvidencePort, durable sync retries và cleanup

**Interfaces:** `createFinalEvidencePort({now}):FinalEvidencePort` exact06 `verify(tx,input:Parameters<ServerOptions['verifyFinalResult']>[1]):Promise<void>` and `requestDocsSync(tx,{ticketId,mergedCommit,operationId}):Promise<{commandId:Id}>`; `retryDocsJobs(tx:Tx,now:Date):Promise<Id[]>` consumed by existing06 monitor.
- [ ] RED final result supplied before stop, after stop but missing sync/attestation, stale head, old verified merge evidence, missed event, reply loss/restart; no completion until exact durable joins. Research evidence requires trusted ArtifactProof plus required independent criteria review and can complete without code merge; deploy remains unavailable to08 verifier until09 concrete result authority wired.
```ts
await f.stopAttempt(); await f.submitPassedWithoutDocs();
assert.equal((await f.attempt()).state,'finalizing');
assert.equal((await f.guard()).activeAttemptId,f.attemptId);
```
- [ ] Run server `integration completion` + gateway `integration cleanup` RED; GREEN verifier creates append-only verified code/research/docs result linked original evidence IDs only after matching current receipt graph, mandatory steps and reviewers. Retry outcome verifies correct failure class/evidence; never upgrades client pass. requestDocsSync validates F1 accepted current merge/factual ticketcommit + current reserved complete-intent attempt, reuses its existing012 job (or creates only if same accepted fact has no job), no network inside Tx. Logical job uniqueness `(ticket_id,attempt_id,merged_commit)` plus operation aliases prevents monitor06 creating a second job with another operationId. Docs-only submission uses F2 route and has no merge docs-sync job.
- [ ] GREEN event wakes existing06 inbox; five-minute tick retries missed/failed sync with same job/operation/request, bounded30s→300s backoff, exact unchanged payload; integrity mismatch stops automatic retry and records actionable reason. Unchanged merge/docs/policy reuse existing semantic proof; new target/source/docs/policy requires new wave, not stale reuse. Full rereview never triggered merely by lost sync ACK.
- [ ] GREEN resource cleanup calls03 registry after true process-tree stopped and accepted terminal/finalize; retain code/commits/docs/original attachments/receipts/review artifacts/dirty scratch. Retry only failed resource IDs after fresh identity/stop check; UNKNOWN fork, symlink/inode substitution or active references retained and monitored. No new authority from cleanup success.
- [ ] Re-run focused tests/typechecks; independent completion/retry/cleanup review; server/gateway/docs flows; controller commit `feat(v2): finalize from current integration evidence`.

## T7 — Actual assembly, producer/consumer acceptance và handoff09

**Interfaces:** `assembleIntegration({db,now,verifyObservation}):{authority:IntegrationAuthority;finalEvidence:FinalEvidencePort;docsCompletion:DocsCompletionReader;docsReader:TrustedDocsReader}`. Production absent verifier→deny; controller injects exact verify into005/06 and reader into tickets/Task7; host injects actual collector/checks/merge/docs transport into reviewed bridge. No fixture certificate/boolean escapes test composition.
- [ ] RED F1 full HTTP begins merged_commit=null, no seeded commit/verified receipt: onboard target→actual011 orchestration→005 attempt→007 companion→04 logical effect→T2 Git candidate→actual child check→official review artifact admission→012 permit/Git mutation→006 sync→012 attestation→005 finalization. Real HTTP listener+fetch, durable DB and host restart; no seeding verified receipts/merge rows or invoking verifier directly to bypass route. Deterministic review fixtures exercise admission only; live semantic quality/certification remains separately unverified.
- [ ] RED readCompletionFacts earliest historical merge is replaced only through F2 server-held registered adapter: two waves select exact current012 result; same public DocsCompletionReader callable reaches both ticket-service and005 finalize. Controller owns completion-readers.ts/completion.ts, calls existing factory paths unchanged, verifies code/docs-only branch and default deny; no public005/FinalEvidencePort change. F1 factual writer, F3 target producer and F4 binding/revocation hook need owner02 review before assembly; no unapproved frozen producer rewrite.
- [ ] Run focused server/gateway `integration acceptance` RED; GREEN wire constructors and strict route schemas, metadata-only journal events `integration.merged`/`docs.attested` with IDs/commit/revision. Current auth/target/attestation selection performed within same DB snapshot/Tx as completion; expected head updated only from trusted current-target observation under CAS. Target mutation and finalization require the same durable project target reservation; current signed target observation is bound to the finalization challenge and reservation generation, never an arbitrary last heartbeat. Any out-of-band ref drift retires observation and blocks completion until reconciled.
- [ ] RED F4 bind A→merge+attest→release→bind B and separate same machine/same path revision increment:003/012 both null, old proof historical/not current in Task7/06/07 and completion; fresh owner activation+trusted target observation required. Race merge/head update with rebind/revoke from two pools and restart cannot yield divergent expectedCommit or resurrect old generation.
- [ ] GREEN acceptance negatives each through actual producer/consumer: wrong machine/stale fence/rebind during cached replay; target/source advanced; concurrent merge; conflict invalidating final review; path escape; spoofed observer; missing mandatory gate; review5 infra distinction; source OFF existing-versus-new admission; omitted required page; sync mismatch; cancel and UNKNOWN child; crash mid-ref; production composition missing cert503.
- [ ] Final batch after fixes: `pnpm --dir v2 test`, `pnpm --dir v2 typecheck`, `pnpm --dir v2/server test`, `pnpm --dir v2/server typecheck`, `pnpm --dir v2/gateway test`, `pnpm --dir v2/gateway typecheck`; independent whole-phase review against exact HEAD/producer hashes. Record actual outputs, no planned-command PASS claim.
- [ ] Controller map all new files/tests into three flows, update every changed producer flow with seven STANDARD headings; generate index/files in isolated v2 mirror and run check --all + baseline-aware --staged per02Task7 recipe. Blank mirror staged check cannot prove R3. Root staged check before any eventual controller commit `feat(v2): assemble integration and docs completion gates`.
- [ ] Backup own011 DB→012 migration and012 restore/restart compare raw006 bytes, receipt/hash/target/attestation/job/effect/repair counts and pending guards. Roll back binary only when schema compatibility documented; no down-migration deleting immutable evidence, no DB overwrite/shared service. Cleanup exact owned test containers/processes after proof.
- [ ] Handoff06 exact FinalEvidencePort and012 docs command namespace/current read adapter;09 gets receipt-backed actual merged commit, drain/UNKNOWN state, retained artifacts, schema/backup compatibility and unchanged exact deploy approval004. No push, deploy, signed package or production observer enrollment authorized by this plan.

## Failure outcomes được test ở T7

| Condition | Durable response / next action |
|---|---|
| Invalid proof/signature/scope | 403 `INTEGRATION_PROOF_REJECTED`; no verified receipt, preserve reported artifacts |
| Stale source/target/input/review | 409 `INTEGRATION_CANDIDATE_STALE`; new wave after current checkout/authority read |
| Unconfigured verifier/unproved boundary | 503 `INTEGRATION_VERIFIER_NOT_CONFIGURED` or `TARGET_AUTHORITY_UNVERIFIED`; wait with exact dependency |
| Merge outcome unknown | 409 `MERGE_RECONCILIATION_REQUIRED`; retain permit/guard/registry, no retry merge |
| Snapshot/receipt/provenance mismatch | 409 `DOCS_ATTESTATION_MISMATCH`; retain raw rows, no automated integrity retry |
| Transport-only docs failure | stored retry job with unchanged request hash/operation;06 monitor resumes, no new semantic review |
| Confirmed cancel | preserve applied Git fact if any; ticket cancellation only via005 stop/result/finalize |

## Self-review và release gate

- [x] Spec6–7→T3/T4/T6; spec8→T6; spec9→T2/T3/T5; spec12→T7. Five Review Focus cases assigned RED regressions.
- [x] Source-list hash is separate from actual Git content digest;006 immutable raw audit and per-attempt receipt preserved;012 derived reader explicit.
- [x] Candidate is exact pre-created tested/reviewed commit; Git mutation durable reconciliation, stable logicalEffect, no claimed distributed Git+SQL atomic transaction.
- [x] Producer gaps are gated: Task7/actual03–06, observer certification, F1–F4 internal fact/reader/onboarding/head+binding seams;006 reviewed832c9a3 preserved. No unsupported native-tree PASS.
- [x] F1–F4 mapped to typed producers, persistence, current authority and actual positive/negative tests; initial review remains historical; independent fixwave re-review đã đóng F1–F4. Kế hoạch được duyệt; implementation, runtime certificate, live semantic review and deployment remain unverified until their own evidence exists.

## Bổ sung của PM — thứ tự migration 2026-10-02 16:53

Kiểm thử PostgreSQL thực tế của Task05/2a xác nhận constraint comments_text_check trong004 chặn text rỗng trước khi chạy linker attachment. Giữ nguyên byte các migration001–009 đã nghiệm thu; phần05 bổ sung010_attachment_comment_text.sql. Kế hoạch này dùng số thứ tự kế tiếp như đã cập nhật phía trên. Chỉ đổi số migration tương lai và tham chiếu; hợp đồng nghiệp vụ, quyền hạn, chứng cứ turn/effect/stop và các điều kiện nghiệm thu đã duyệt giữ nguyên. Migration010 mới và producer phải qua review độc lập Task2a trước khi tích hợp consumer. Hash phê duyệt lịch sử mô tả bản trước bổ sung; hash bản hiện tại được ghi trong ledger PM.
