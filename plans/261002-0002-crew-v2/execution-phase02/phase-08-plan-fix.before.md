# Crew v2 phase 08 — Integration và docs gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chỉ tự merge kết quả hiện hành đã có workflow/test/review/docs proof; crash không merge lại và code request chỉ hoàn tất sau sync/attestation đúng commit.
**Architecture:** Gateway tạo candidate commit trước kiểm chứng, observer tin cậy ghi receipt thực tế, server011 giữ authorization/evidence/completion. Git ref CAS và journal host tạo cầu phục hồi giữa Git với transaction DB; snapshot006 giữ nguyên byte/provenance, attestation011 cấp trạng thái derived.
**Tech Stack:** Node ≥24.12, TypeScript 7.0.2, pnpm 10.32.1, PostgreSQL 18.6/Fastify của02, Git CLI dùng argv/stdin; node:test. Không dependency runtime v1 hoặc custom role prompt.
**Spec:** `docs/superpowers/specs/2026-10-01-crew-v2-design.md` §6–9,12; roadmap `plan.md`; reviewed02–06; research `plans/reports/research-261002-crew-v2-integration.md`.
**Status:** Kế hoạch chờ independent review. Baseline `6b76ead`, actual005 reviewed `9dca04e`;06-r3 plan SHA256 `547ce65c865dffd9fec9a7c71f0c38735566d314c007cb74a8f217f5f19795aa`. 006 StageB F1/F2 đang sửa/review, không coi draft/report là final producer. Native-tree handoff vẫn UNKNOWN khi không chứng minh được descendants.

## Global Constraints

- “Tự merge khi các cổng workflow, test, review và docs đạt.” Mọi gate dùng target/source hiện tại, conflict resolution nằm trong diff và validation wave mới.
- “Deploy chỉ chạy khi owner duyệt hành động cụ thể trên web hoặc tạo ticket deploy.” Merge không cấp quyền push/deploy; giữ exact004 fingerprint/action authorization tới09.
- “Không coi mất heartbeat là bằng chứng tiến trình đã chết.” Pause/cancel giữ005 guard đến actual stop/result/finalize; UNKNOWN không giải phóng reservation, target lock hay resource.
- “Tối đa 5 vòng sửa và kiểm tra lại cho cùng bước kiểm tra”; dùng004/06 cycle/checkStepId, không đếm infra/model/sync lỗi hoặc reset khi fallback.
- Mỗi project chỉ bound machine hiện tại; source/model ON/current admission do06, existing admitted attempt giữ semantics OFF đã chốt. Current fence/binding/input/workflow gate vẫn bắt buộc ở mutation.
- Official workflow skills thực thi review/verification/finishing, mandatory owner gates và explicit parallel approval06 giữ nguyên; reviewer độc lập từng task và whole-request.
- Docs tiếng Việt, identifier/path tiếng Anh, wire UTC ISO, UI Asia/Ho_Chi_Minh. Original workflow artifacts giữ format/class; không nâng chúng thành implemented docs.
- Không sửa SQL005–010 đã freeze; migration mới011. Không sửa source hiện tại trong lượt planning, không install/model/live call/credential/v1DB/shared service/stage/commit/deploy.
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
| 02 actual006 | `DocsSync`, `syncDocs`, `authorizeDocsSync`, `validateDocs`, `snapshotHash`, `sourceTreeHash`; immutable receipt `(attempt,merged_commit,input_sha256)` | F1/F2 final code/re-review + final006 checksum; chỉ handoff/report cho tới gate |
| 03 | `ResourceRegistry`, `ProcessJournal`, `HttpOperationJournal`; own target machine and007 companion | actual producer files/signatures reviewed; UNKNOWN fork/descendant không được đổi thành stopped |
| 04/05 | `EffectLedger`, `LogicalEffect`, RuntimePin;009 input revision/manifest/receipt | actual008/009 + source-isolation/runtime boundary certificate; logical effect giữ qua fallback |
| 06-r3 | `FinalEvidencePort`, run/step/gate/review/repair/monitor + current dispatch | actual010/constructor and official workflow review artifacts; plan approval không chứng minh implementation |

File ownership dùng đường dẫn từ repo root; controller duy nhất chạm shared files/manifest/index/commit. Worker không revert nhau; T2 có thể chuẩn bị fixture cùng T1, T3 đợi contracts T1/T2, T4 đợi T3, T5 đợi T1/T3/T4, T6 đợi T5, T7 serialize assembly.

| Task | Create ownership | Reviewed modify/handoff |
|---|---|---|
| T1 schema/trust | `v2/server/migrations/011_integration.sql`; `v2/server/src/integration/{contracts,authority,receipts}.ts`; `v2/server/test/integration-authority.test.ts`; `v2/server/test/support/integration.ts` | none; migration checksum frozen after review |
| T2 candidate/collector | `v2/gateway/src/integration/{contracts,git,candidate,collector}.ts`; `v2/gateway/test/integration-candidate.test.ts`; `v2/gateway/test/support/integration-git.ts` | borrowed ResourceRegistry/ProcessJournal, no source edits |
| T3 gates | `v2/server/src/integration/{gates,reviews,source-proof}.ts`; `v2/gateway/src/integration/{checks,observer}.ts`; `v2/server/test/integration-gates.test.ts`; `v2/gateway/test/integration-checks.test.ts` | official06 workflow adapter supplies review runs |
| T4 merge | `v2/server/src/integration/{merge,routes}.ts`; `v2/gateway/src/integration/{merge,journal,transport}.ts`; `v2/server/test/integration-merge.test.ts`; `v2/gateway/test/integration-recovery.test.ts` | no005 command enum alteration |
| T5 docs attestation | `v2/server/src/integration/{docs-attestation,docs-reader}.ts`; `v2/gateway/src/integration/docs-sync.ts`; `v2/server/test/integration-docs.test.ts` | constructor-injected02Task7 reader, controlled T7 handoff |
| T6 final/recovery | `v2/server/src/integration/{final-evidence,recovery}.ts`; `v2/server/test/integration-completion.test.ts`; `v2/gateway/test/integration-cleanup.test.ts` |06 monitor calls frozen FinalEvidencePort, no second monitor |
| T7 assembly | `v2/server/src/integration/assembly.ts`; `v2/server/test/integration-acceptance.test.ts`; `v2/gateway/test/integration-acceptance.test.ts` | controller app/main/host composition, ticket completion narrow selector, Task7 docs read/search, event whitelist; `v2/docs/{flows.yaml,index.md,files.md,architecture.md}` |

T1 fixture owns real HTTP server/private DB; T2 fixture owns bare repo + disposable worktrees and actual subprocesses. Helpers close only their owned handles. New docs flows `server-integration.md` (T1/3/4/6 server), `gateway-integration.md` (T2/3/4/5/6 host), `docs-attestation.md` (T5); controller updates each with each source commit, plus changed producer flows.

## Exact typed ports, canonical identities và trust

T1 exports following types from server contracts; gateway contracts validates matching versioned JSON with contract tests, never imports server runtime. `Id=string(UUID)`, `Sha256=string(hex64)`, `GitOid=string(hex40|hex64)` validated per repo object format; `Tx,Actor,ServerOptions` import actual02. Type aliases are transport constraints, not capabilities.

```ts
type Scope={projectId:Id;ticketId:Id;runId:Id;stepId:Id;attemptId:Id;fence:string;
  processInstanceId:Id;machineId:Id;bindingRevision:number;inputSha256:Sha256};
type Candidate={id:Id;scope:Scope;effectId:Id;wave:number;targetRef:string;sourceRef:string;targetOid:GitOid;
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
type CurrentTargetProof={projectId:Id;targetRef:string;oid:GitOid;reservationId:Id;generation:string;completionOperationId:Id};
type ArtifactProof={reportedEvidenceId:Id;artifactId:Id;sha256:Sha256;byteLength:number;criteriaSha256:Sha256;reviewReceiptIds:Id[]};
type Observation={version:1;id:Id;challengeId:Id;nonce:string;scope:Scope;observerBuildSha256:Sha256;
  policySha256:Sha256;sequence:string;sha256:Sha256;signature:string} & (
  {kind:'source';payload:SourceProof}|{kind:'check';payload:CheckProof}|{kind:'review';payload:ReviewProof}|
  {kind:'merge';payload:MergeReceipt}|{kind:'target';payload:CurrentTargetProof}|{kind:'artifact';payload:ArtifactProof});
type MergePermit={id:Id;candidateId:Id;candidateSha256:Sha256;scope:Scope;effectId:Id;
  receiptSetSha256:Sha256;generation:string;expiresAt:string};
type MergeReceipt={permitId:Id;candidateId:Id;effectId:Id;oldOid:GitOid;newOid:GitOid;
  treeOid:GitOid;parents:GitOid[];targetRef:string;receiptRef:string;journalSha256:Sha256};
type DocsAttestation={id:Id;projectId:Id;snapshotId:Id;attemptId:Id;mergedCommit:GitOid;
  inputSha256:Sha256;sourceTreeSha256:Sha256;sourceManifestSha256:Sha256;
  verificationEvidenceId:Id;mergeReceiptId:Id;structuralReceiptId:Id;semanticReceiptId:Id;policySha256:Sha256};
type DocsState={snapshotId:Id;storedAuditState:'unverified'|'invalid'|'verified';
  verification:'unverified'|'verified';state:'current'|'stale'|'unverified';
  sourceCommit:GitOid|null;expectedCommit:GitOid|null;attestationId:Id|null};
interface IntegrationAuthority {
  accept(tx:Tx,actor:Actor,observation:Observation):Promise<Id>;
  issue(tx:Tx,actor:Actor,candidateId:Id):Promise<MergePermit>;
  acceptMerge(tx:Tx,actor:Actor,observation:Observation):Promise<Id>;
}
interface CandidateBuilder {prepare(scope:Scope,input:{effectId:Id;targetRef:string;sourceRef:string;sourceOid:GitOid}):Promise<Candidate>;}
interface IntegrationGit {apply(permit:MergePermit):Promise<MergeReceipt>;reconcile(effectId:Id):Promise<MergeReceipt|null>;}
interface TrustedDocsReader {state(tx:Tx,projectId:Id,snapshotId:Id):Promise<DocsState>;}
```

T1 `createIntegrationAuthority({now,verifyObservation})` returns IntegrationAuthority; `verifyObservation(observation:Observation):Promise<void>` is injected immutable cryptographic verifier against server-configured trusted observer identity, not a machine callback. Default throws `INTEGRATION_VERIFIER_NOT_CONFIGURED`503. T3 implements verified receipt creation after strict payload discriminant/schema/hash and all source/process/policy checks.

Observer admission is separate from bearer auth: server-issued nonce/challenge binds exact scope/build/policy/expiry; observer signing key unavailable to model/test child. Enrollment requires controlled trusted host deployment plus measured denial of key/journal tampering, forged child output and escaped descendants. Server pins enrolled public key/build/policy via trusted deployment configuration, never self-enrolls from machine request. Missing certification remains UNVERIFIED; runtime04 certificate alone does not certify this observer. T7 test key exists only in private fixture, never production fallback/env bypass.

Sign canonical `{version,kind,id,challengeId,nonce,scope,observerBuildSha256,policySha256,sequence,payload,sha256}` excluding signature; `sha256` hashes same object excluding sha256/signature. Replay observation ID+exact hash returns same immutable receipt after current auth; changed body409, reused nonce in another scope409. Strict route schema couples kind to exactly its payload variant (no loose union accepting a check as a merge). Unknown field/kind rejected before receipt creation.

Candidate digest hashes canonical fields except id/sha256; policy digest includes required command IDs/argv/env, workflow pin/gates/input, task/request/docs review coverage and validator build. Receipt-set digest hashes sorted immutable receipt IDs+hashes. Source manifest hashes sorted NFC safe path/mode/blob/size/content SHA entries from actual candidate tree; no symlink/submodule, case alias, unsupported encoding, absolute/traversal/NUL path. Reject missing referenced manifest file. `sourceTreeSha256=sourceTreeHash(trackedSourcePaths)` stays exact006 **path-list hash**, never content-tree claim; separate sourceManifestSha256 proves content.

## Persistence011 và wire

All IDs/FKs bind project/ticket/attempt with composite scope checks; append-only evidence rows reject UPDATE/DELETE. T1 owns complete migration, every later table consumer present before freeze.

| Table | Columns/constraints in addition to id/created_at |
|---|---|
| `integration_challenges` | nonce UNIQUE, scope/kind/build/policy/key ID, request_sha256, expires_at, consumed_observation_id nullable; exact replay only |
| `integration_target_reservations` | project/target/ref PK, binding_revision, purpose apply/complete, operation_id, generation, state held/uncertain/released, current_observation_id nullable; release only acknowledged outcome/reconciled no-effect |
| `integration_candidates` | Candidate fields, canonical JSON+sha; UNIQUE(project_id,effect_id,wave); immutable; target ref allowlist from project config |
| `integration_observer_receipts` | observation ID UNIQUE, challenge ID, kind, scope, payload/hash/signature/key/build/policy, received_at; nonce+scope unique; no machine verified flag |
| `integration_permits` | MergePermit fields, state prepared/applying/applied/uncertain/rejected, receipt ID nullable; one unresolved permit per(project,target_ref); CAS generation, no TTL unlock |
| `integration_merge_receipts` | MergeReceipt+observer receipt FK, UNIQUE(project_id,effect_id), UNIQUE(permit_id); exact candidate FK |
| `integration_project_heads` | project_id PK, target_ref, expected_commit, revision, merge_receipt_id, observation_receipt_id; CAS old target/revision only after trusted observed actual ref |
| `integration_docs_jobs` | command_id PK, ticket/attempt/binding/fence/effect/merged_commit, operation_id UNIQUE, state pending/running/retry/done, next_due_at, attempts, last_error, immutable request_hash |
| `integration_docs_attestations` | DocsAttestation fields; composite FK006 receipt(attempt,merged_commit), snapshot/project; UNIQUE(attempt_id,merged_commit,input_sha256,policy_sha256); append-only |
| `integration_completions` | ticket_id, attempt_id, candidate_id, merge_receipt_id nullable, attestation_id nullable, evidence_set_hash, project_head_revision, verified_result_evidence_id, UNIQUE(attempt_id,evidence_set_hash) |

Trusted verification promotion inserts new004 evidence linked `reportedEvidenceIds`/receipt IDs, original reported payload unchanged. T5 creates exact docs_verification evidence with sourceCommit/sourceTreeSha256 and scoped attempt BEFORE006 sync; only T1/T3 trusted receipt admission can issue it. No new public “verified evidence” endpoint.

| Wire | Input/output and authority |
|---|---|
| POST `/v2/integration/candidates` | bound machine `{candidate,sourceObservation}` → candidate ID; recompute server hashes; reported until trusted observation accepted |
| POST `/v2/integration/challenges` | `{scope,kind,requestSha256}` → server nonce/id/expiry; bound machine and current reserved execution only, issuer selects pinned observer identity |
| POST `/v2/integration/observations` | bound machine Observation → receipt ID; current auth before idempotency replay; observed process/policy verified by authority |
| POST `/v2/integration/candidates/:id/permit` | `{fence,processInstanceId,receiptIds}` → MergePermit; server resolves required receipts/current gates, not caller selection alone |
| POST `/v2/integration/permits/:id/apply` | `{fence,processInstanceId}` → permit applying; current005/010/input/policy under Tx, one durable apply generation |
| POST `/v2/integration/permits/:id/result` | signed merge Observation → receipt ID; exact effect/candidate; idempotent recovery may append historic fact but cannot grant fresh execution |
| GET `/v2/integration/projects/:id/state` | scoped current read → target/expectedCommit/revision/pendingPermit/docs state; cached receipt never current authorization |
| GET `/v2/integration/docs-jobs` | current bound machine → pending own jobs; own011 command namespace, never add sync_docs to005 enum |
| POST `/v2/integration/docs-jobs/:id/result` | `{snapshotId,inputSha256,observationIds}` → attestation ID or typed error;006 existing sync endpoint first, own current auth before replay |

Mutator002 transaction lock order retains06 journal/root/command/sorted tickets/project/machine/input/guard producer order, then011 target/candidate/receipt; controller reviews actual lock graph, never introduces inverse nesting. No network/Git/model call inside DB transaction. Binding CAS must consult unresolved integration permit **and**005 guard; narrow injected guard in T7 only after producer owner review. Reject rebind while applying/uncertain even if lease expired.

### Bounded target/source authority và implementation contract tests

Target registration is server-owned project configuration `(projectId,bindingRevision,repositoryIdentity,targetRef)`; repository identity includes pinned canonical realpath/device/inode and Git common-dir/object-format. Source ref resolves from the accepted implementation report in the same root, never an arbitrary filesystem/remote argument. Neither owner credentials nor client-chosen Git URL enter merge operation.
Only trusted host integration helper may mutate the managed target while its reservation is active; runtime agents receive isolated worktrees and cannot write target refs, observer keys or journals. Prove this isolation in T7 negative process tests. An unmanaged target or boundary that cannot prevent competing writers returns `TARGET_AUTHORITY_UNVERIFIED`, never promises SQL and Git are atomic. Git old-OID CAS remains mandatory defense against observed drift.
T4 reserves target across apply/unknown recovery; T5/T6 reacquire it for current-target challenge and completion. Current-target receipt authorizes exactly one completion operation under that reservation, not future completions. Crash before acknowledgment retains reservation until current target/DB outcome reconciliation; no lease-only reclaim. Existing project binding cannot move around this reservation.

T1 owns fixture method signatures used in snippets: `rawSnapshot(id)`, `docsState(id)`, `docsCompletion(projectId,commit)`, `stopAttempt()`, `submitPassedWithoutDocs()`, `attempt()`, `guard()`, `rows(table)` and `machine.post(path,body)`; DTOs match production responses, table reads are test-only allowlisted SQL.
T2 fixture exports `readCommit(oid):Promise<{parents:GitOid[];tree:GitOid}>`, `ref(name):Promise<GitOid>`; T4 extends its owned recovery fixture with `crashAt(point)`, `restartHostAndApi()`, `resumeEffect(effectId)`, `countAppliedRefTransitions(effectId)`, `readMergeReceipt(effectId)`. Count observes durable Git ref history plus011 receipt, not a mocked call counter.
T3 fixture `runner.run(command)` wraps actual runChecks for one command and returns one signed Observation; `gates.evaluate(candidate)` invokes actual evaluateGates through normal persisted candidate/receipt setup. A malformed/incomplete candidate test must not seed a verified result. Production service signatures above remain authoritative.
T7 adds compile-time conformance `const port: FinalEvidencePort = assembleIntegration(deps).finalEvidence`; `ServerOptions['verifyFinalResult']` input is not widened. `DocsCompletionReader` remains `(tx,projectId,commit)=>Promise<string|null>`; new state data uses separate reader. Unknown consumer signatures are resolved against actual producer review, never inferred from fixture shape.

## T1 — Schema, receipt authority và fixture

**Interfaces:** produces types/authority/011 above; `issueChallenge(tx:Tx,actor:Actor,input:{scope:Scope;kind:Observation['kind'];requestSha256:Sha256}):Promise<{id:Id;nonce:string;expiresAt:string}>` and `reserveTarget(tx:Tx,input:{projectId:Id;targetRef:string;operationId:Id;purpose:'apply'|'complete'}):Promise<{id:Id;generation:string}>` are internal server methods, not client trust bypass; consumes002 Mutator,005 current attempt,010 run/gates. `integrationFixture(db,clock)` returns real HTTP clients `owner,machine,otherMachine`, trusted fixture observer, `rows(table)`, `close()`; no seeded verified production evidence.
- [ ] RED `integration-authority.test.ts`: valid signed known-process observation persists once; change scope/body/build/signature rejects; bearer-only verified:true rejects; stale fence/expired nonce/revoked machine rejects before cached response; two pools race same observation produce one receipt/event.
```ts
assert.equal((await f.machine.post('/v2/integration/observations',f.forgedObservation)).statusCode,403);
assert.equal((await f.rows('integration_observer_receipts')).length,0);
```
- [ ] Run `pnpm --dir v2/server test --test-name-pattern='integration authority'`; RED must reach assertion after existing001–010 fixture setup, missing producer is BLOCKED, not expected RED.
- [ ] GREEN strict envelope validator + signature/nonce authorization, immutable inserts and current-scope replay callback; backup private010 DB, migrate011, restore010→011 and restore011 retain receipt hashes/replay. No SQL006 trigger/index/provenance change.
- [ ] Re-run focused tests/server typecheck; independent trust/schema review; controller updates server-integration flow and commits `feat(v2): persist trusted integration receipts` only after review/docs gates.

## T2 — Candidate commit và source proof thực tế

**Interfaces:** `createCandidateBuilder({git,resources,journal}):CandidateBuilder`; `collectSourceProof(candidate:Candidate):Promise<SourceProof>`; `git(args:string[],stdin?:Buffer):Promise<{stdout:Buffer;stderr:Buffer;exitCode:number}>` executes allowlisted argv, no shell.
- [ ] RED real fixture repo: nonconflicting branch candidate has exact target/source parents and actual merge tree; target moved makes new candidate wave; conflict needs resolution branch then new candidate; tracked missing file, symlink/submodule/path escape denied. Owner checkout dirty/untracked hashes unchanged.
```ts
const c=await builder.prepare(scope,{effectId,targetRef:'refs/heads/main',sourceRef:'refs/heads/feature',sourceOid});
assert.deepEqual((await fixture.readCommit(c.mergeOid)).parents,[c.targetOid,sourceOid]);
assert.equal((await fixture.ref('refs/heads/main')),c.targetOid);
```
- [ ] Run `pnpm --dir v2/gateway test --test-name-pattern='integration candidate'` RED; GREEN reserve/createAndAttest scratch; read exact target/source OIDs; prepare detached merge checkout, resolve only owned scratch, create commit once with preserved commit metadata and refs under private run namespace before validation. Tests/docs/review consume this exact commit, not “equivalent” branch contents.
- [ ] GREEN `git ls-tree -rz --full-tree <oid>` + bounded cat-file reads prove path/blob bytes at commit; recompute both006 paths hash and full manifest hash. Disable hooks/filters/external diff/config inheritance for observer Git, isolate only subprocess config/env; preserve owner config. Reject checked-out target in any owner worktree for apply, wait explicit safe checkout arrangement; never update ref behind dirty index.
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

**Interfaces:** `createIntegrationGit({git,journal,resources,effects,http}):IntegrationGit`; authority issue/acceptMerge above. Local011 journal keyed `(projectId,effectId)` persists candidate/permit/commit OID/apply state/receipt and fsyncs before external effect;04 logical effect ID is stable through fallback.
- [ ] RED target/source/policy advanced after permit, concurrent two permits, same effect other runtime, cancel before apply, lost apply response, wrong machine/stale fence. Crash immediately before/after commit-object creation, before/after target ref, before local/server receipt, before result response; restart real host/API/pool and inspect Git/rows.
```ts
await fixture.crashAt('after-ref-update'); await fixture.restartHostAndApi();
await fixture.resumeEffect(effectId);
assert.equal(await fixture.countAppliedRefTransitions(effectId),1);
assert.equal((await fixture.readMergeReceipt(effectId)).newOid,candidate.mergeOid);
```
- [ ] Run server `integration merge` + gateway `integration recovery` RED; GREEN server `issue` checks every gate and current target observation, reserves target/effect; apply Tx rechecks current authority/input/gates/cancel and persists applying. Existing apply replay must GET current state before host effect, expiry never clears ambiguous applying.
- [ ] GREEN host exclusive managed repository lock, re-read source/target, verify permit+saved candidate, journal intent fsync, then `git update-ref --stdin` transaction: verify immutable candidate sourceRef/sourceOid; update target newOid oldOid; create immutable `refs/crew/integration/<effectId>` newOid. Commit object already tested; no post-review merge/squash/rebase. Persist outcome/ref identities, fsync journal, submit signed receipt. Git config durability support must be measured on shipped Git; power-loss uncertainty stays uncertain.
- [ ] GREEN recovery reads exact saved candidate object/tree/ordered parents, target/ref receipt and journal. Both refs match→report same result; old target with no receipt→retry same authorized CAS only after current check; different target with receipt plus proven ancestry→record historical merge, mark docs/current completion stale; mismatch/missing journal/partial refs→uncertain, retain and ask owner, never infer from commit message or call merge again.
- [ ] GREEN cancel wins before applying→reject; cancel after applying drains/reconciles actual helper and records irreversible Git fact, cannot pretend undo; no force-reset. Binding changes wait unresolved permit; offline retains target reservation. Rollback after accepted merge is explicit new reviewed revert candidate, never silent reset. Preserve backup ref/commit/artifact until retention allows cleanup.
- [ ] Re-run focused tests/typechecks; independent race/crash review; both integration flows; controller commit `feat(v2): reconcile fenced local merge effects`.

## T5 — Immutable006 snapshot, trusted011 attestation và honest reader

**Interfaces:** `attestDocs(tx:Tx,input:{jobId:Id;snapshotId:Id;inputSha256:Sha256;observationIds:Id[]}):Promise<DocsAttestation>`; `createTrustedDocsReader():TrustedDocsReader`; `createDocsCompletionReader():DocsCompletionReader`; `syncMergedDocs(jobId:Id):Promise<void>` uses actual006 DocsSync without new trust fields.
- [ ] RED real sync creates stored unverified snapshot/receipt, then accepted011 attestation makes derived state current while original rows/bytes/audit remain byte-identical. Same snapshot reused different attempt requires that attempt receipt/input; imported/unverified/artifact-only/missing required implemented page denies; forged source list/commit/tree/semantic ID denies.
```ts
assert.equal((await f.rawSnapshot(snapshotId)).audit_state,'unverified');
assert.equal((await f.docsState(snapshotId)).state,'current');
assert.equal(await f.docsCompletion(projectId,otherCommit),null);
```
- [ ] Run `pnpm --dir v2/server test --test-name-pattern='integration docs'` RED; GREEN build DocsSync from actual accepted mergeOid using T2 collector and T3 trusted docs_verification evidence. Existing006 authorize before replay + strict input hash retained. Store sync reply then independently join DB006 receipt/snapshot/files to signed source/check/review/merge receipts; cached response cannot attest itself.
- [ ] GREEN re-run structural validator on stored raw bytes, verify snapshotHash and exact docs set/class from merge tree; sourceCommit/mergedCommit, trackedSourcePaths hash, sourceManifestSha256, verificationEvidenceId, attempt/fence and inputSha256 all bind same job/candidate. Immutable011 attestation inserts only after all joins, no UPDATE006 rows or audit labels. First snapshot's audit_report evidence ID may belong prior reuse attempt: use this job's exact receipt/input and attestation, preserve original audit.
- [ ] GREEN current read returns storedAuditState plus independent derived verification/state. Old valid attestation remains verified provenance but stale if expectedCommit differs; no attestation→unverified; required pages implemented only even mixed snapshot. Do not move006 latest_verified pointer to raw-unverified row;011 reader selects trusted attestation from current project head. Task7/phase07/06 projections retain raw label and expose derived state explicitly; never silently relabel auditState.
- [ ] GREEN completion reader returns commit only when requested commit==integration_project_heads.expected_commit==merge receipt newOid==snapshot.source_commit==attestation.mergedCommit, required implemented pages current, structural/semantic policy accepted, exact sync receipt present. Null/stale/unknown target blocks. Pure docs/research uses proper result criteria, no code merge requirement added.
- [ ] Re-run focused tests/server typecheck; independent raw-provenance/reader review; docs-attestation flow + Task7 handoff; controller commit `feat(v2): attest synced docs without rewriting provenance`.

## T6 — FinalEvidencePort, durable sync retries và cleanup

**Interfaces:** `createFinalEvidencePort({now}):FinalEvidencePort` exact06 `verify(tx,input:Parameters<ServerOptions['verifyFinalResult']>[1]):Promise<void>` and `requestDocsSync(tx,{ticketId,mergedCommit,operationId}):Promise<{commandId:Id}>`; `retryDocsJobs(tx:Tx,now:Date):Promise<Id[]>` consumed by existing06 monitor.
- [ ] RED final result supplied before stop, after stop but missing sync/attestation, stale head, old verified merge evidence, missed event, reply loss/restart; no completion until exact durable joins. Research evidence requires trusted ArtifactProof plus required independent criteria review and can complete without code merge; deploy remains unavailable to08 verifier until09 concrete result authority wired.
```ts
await f.stopAttempt(); await f.submitPassedWithoutDocs();
assert.equal((await f.attempt()).state,'finalizing');
assert.equal((await f.guard()).activeAttemptId,f.attemptId);
```
- [ ] Run server `integration completion` + gateway `integration cleanup` RED; GREEN verifier creates append-only verified code/research/docs result linked original evidence IDs only after matching current receipt graph, mandatory steps and reviewers. Retry outcome verifies correct failure class/evidence; never upgrades client pass. requestDocsSync validates accepted actual merge receipt + current reserved attempt, creates/replays011 job and ID, no network inside Tx.
- [ ] GREEN event wakes existing06 inbox; five-minute tick retries missed/failed sync with same job/operation/request, bounded30s→300s backoff, exact unchanged payload; integrity mismatch stops automatic retry and records actionable reason. Unchanged merge/docs/policy reuse existing semantic proof; new target/source/docs/policy requires new wave, not stale reuse. Full rereview never triggered merely by lost sync ACK.
- [ ] GREEN resource cleanup calls03 registry after true process-tree stopped and accepted terminal/finalize; retain code/commits/docs/original attachments/receipts/review artifacts/dirty scratch. Retry only failed resource IDs after fresh identity/stop check; UNKNOWN fork, symlink/inode substitution or active references retained and monitored. No new authority from cleanup success.
- [ ] Re-run focused tests/typechecks; independent completion/retry/cleanup review; server/gateway/docs flows; controller commit `feat(v2): finalize from current integration evidence`.

## T7 — Actual assembly, producer/consumer acceptance và handoff09

**Interfaces:** `assembleIntegration({db,now,verifyObservation}):{authority:IntegrationAuthority;finalEvidence:FinalEvidencePort;docsCompletion:DocsCompletionReader;docsReader:TrustedDocsReader}`. Production absent verifier→deny; controller injects exact verify into005/06 and reader into tickets/Task7; host injects actual collector/checks/merge/docs transport into reviewed bridge. No fixture certificate/boolean escapes test composition.
- [ ] RED actual010 orchestration→005 attempt→007 companion→04 logical effect→T2 Git candidate→actual child check→official review artifact admission→011 permit/Git mutation→006 sync→011 attestation→005 finalization. Real HTTP listener+fetch, durable DB and host restart; no seeding verified receipts/merge rows or invoking verifier directly to bypass route. Deterministic review fixtures exercise admission only; live semantic quality/certification remains separately unverified.
- [ ] RED actual readCompletionFacts currently chooses earliest verified merge: two accepted waves with first stale must select exact current integration receipt, never complete from historic004 evidence. Controller narrow optional injected current-evidence selector in ticket completion (default existing deny path) plus Task7 docs-state reader and binding guard reviewed by02 owner; do not rewrite004/005 or loosen generic ACL. Proposed internal seam for producer approval: `CurrentCompletionEvidenceReader=(tx:Tx,ticketId:Id)=>Promise<{resultEvidenceIds:Id[];mergeEvidenceId:Id|null}>`; module-private server factory injects it into both ticket-service and finalization completion calls. Caller cannot submit selector output. No alteration to public FinalEvidencePort/005 DTO; if actual producer cannot accept internal injection without forbidden rewrite, stop assembly for PM's narrow producer fix. Update06 DocRead consumers through explicit additive raw/derived DTO contract review; incompatible freeze blocks assembly.
- [ ] Run focused server/gateway `integration acceptance` RED; GREEN wire constructors and strict route schemas, metadata-only journal events `integration.merged`/`docs.attested` with IDs/commit/revision. Current auth/target/attestation selection performed within same DB snapshot/Tx as completion; expected head updated only from trusted current-target observation under CAS. Target mutation and finalization require the same durable project target reservation; current signed target observation is bound to the finalization challenge and reservation generation, never an arbitrary last heartbeat. Any out-of-band ref drift retires observation and blocks completion until reconciled.
- [ ] GREEN acceptance negatives each through actual producer/consumer: wrong machine/stale fence/rebind during cached replay; target/source advanced; concurrent merge; conflict invalidating final review; path escape; spoofed observer; missing mandatory gate; review5 infra distinction; source OFF existing-versus-new admission; omitted required page; sync mismatch; cancel and UNKNOWN child; crash mid-ref; production composition missing cert503.
- [ ] Final batch after fixes: `pnpm --dir v2 test`, `pnpm --dir v2 typecheck`, `pnpm --dir v2/server test`, `pnpm --dir v2/server typecheck`, `pnpm --dir v2/gateway test`, `pnpm --dir v2/gateway typecheck`; independent whole-phase review against exact HEAD/producer hashes. Record actual outputs, no planned-command PASS claim.
- [ ] Controller map all new files/tests into three flows, update every changed producer flow with seven STANDARD headings; generate index/files in isolated v2 mirror and run check --all + baseline-aware --staged per02Task7 recipe. Blank mirror staged check cannot prove R3. Root staged check before any eventual controller commit `feat(v2): assemble integration and docs completion gates`.
- [ ] Backup own010 DB→011 migration and011 restore/restart compare raw006 bytes, receipt/hash/target/attestation/job/effect/repair counts and pending guards. Roll back binary only when schema compatibility documented; no down-migration deleting immutable evidence, no DB overwrite/shared service. Cleanup exact owned test containers/processes after proof.
- [ ] Handoff06 exact FinalEvidencePort and011 docs command namespace/current read adapter;09 gets receipt-backed actual merged commit, drain/UNKNOWN state, retained artifacts, schema/backup compatibility and unchanged exact deploy approval004. No push, deploy, signed package or production observer enrollment authorized by this plan.

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
- [x] Source-list hash is separate from actual Git content digest;006 immutable raw audit and per-attempt receipt preserved;011 derived reader explicit.
- [x] Candidate is exact pre-created tested/reviewed commit; Git mutation durable reconciliation, stable logicalEffect, no claimed distributed Git+SQL atomic transaction.
- [x] Producer gaps are gated: final006/Task7, actual03–06, observer certification, typed reader/selector/binding extensions. No unsupported native-tree PASS.
- [x] READY for independent plan review only; implementation, runtime certificate, live semantic review and deployment remain unverified until their own evidence exists.
