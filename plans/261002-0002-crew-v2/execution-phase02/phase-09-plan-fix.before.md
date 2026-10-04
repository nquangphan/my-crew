# Crew v2 phase 09 — Signed macOS update và vận hành Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner cập nhật app/host từ web bằng gói ký bất biến, đợi công việc dừng thật, khôi phục sau crash/rollback và chuẩn bị phát hành VPS v2 với quyền deploy đúng hành động.
**Architecture:** Namespace012 quản lý release/desired/current/update operation; dùng lại auth/journal002, boot007, process/resource journal03 và admission06. Native coordinator đổi toàn bundle sau drain, giữ previous bundle và journal ngoài app; VPS deploy có artifact/backup/receipt riêng và dùng exact deploy authority004.
**Tech Stack:** Node floor≥24.12, private Node24.21.0, Electron44.5.1, TypeScript7.0.2/pnpm10.32.1; Swift/C + Security/ServiceManagement trên builder macOS, PostgreSQL18.6/Fastify theo02, node:test.
**Spec:** `docs/superpowers/specs/2026-10-01-crew-v2-design.md` §1–2,7–9,11–12; roadmap `plan.md`; reviewed02–06; research `plans/reports/research-261002-crew-v2-updates-operations.md`.
**Status:** DRAFT/PROVISIONAL; Phase08 fix-wave1 chưa re-review khi soạn. Chỉ freeze09 sau exact08 review + đối chiếu producer. Baseline native03 reviewed859d671; HEAD quan sát8707ece (peer02 đang tích hợp). Chưa implementation012, live signature/update/production PASS; Phase07 layout approval riêng.

## Global Constraints

- “App local chỉ hỗ trợ macOS”; “App cần duy trì kết nối và job khi người dùng đóng cửa sổ.” Không import runtime/DB/role prompts v1; không thay app v1 hoặc dùng chung volume/database/service.
- “Owner kích hoạt cập nhật từ web”; “chờ không còn job đang chạy trước khi chuyển phiên bản.” Máy Trợ lý lưu checkpoint và dừng nhận lượt mới; không kill job vì cần update.
- “Không coi mất heartbeat là bằng chứng tiến trình đã chết.” Active/uncertain/finalizing, live Assistant turn, chưa rõ descendant hoặc effect chưa đối chiếu đều giữ drain barrier/guard/resources.
- “Giữ định danh ký app ổn định giữa các bản”; app báo quyền macOS cần owner cấp, không tự cấp hoặc tắt Gatekeeper/TCC/ATS. Private Node/native helper đã ký sẵn; máy nhận không cần compiler, global Node/npm hay quyền root.
- “Deploy chỉ chạy khi owner duyệt hành động cụ thể trên web hoặc tạo ticket deploy.” PM mandate, tự merge, owner root khác hay source commit không cấp quyền release; deploy child luôn có approval exact definition riêng.
- Chỉ SQL012 sau reviewed011; không sửa001–011 để né dependency. Source/projection03, ModelDispatchChoice04, RuntimeCheckpoint, FinalEvidencePort06 và005 guard/terminal semantics giữ nguyên.
- UI/docs tiếng Việt, identifier/path tiếng Anh; wire UTC ISO, UI Asia/Ho_Chi_Minh. Secrets dùng env/Keychain references; log/event/manifest không chứa credential/authorization headers.
- Planning chỉ docs/research. Execution mặc định offline/fake/owned fixtures; không owner app/LaunchAgent/Keychain/shared DB/restart/deploy/model có phí. Live test cần scope/budget/identity được cho phép, thiếu là UNVERIFIED.

## Review Focus

1. Máy offline nhận update A rồi B hoặc ACK trễ: payload A bất biến, desired B không trở thành current A; không tải latest dưới ID cũ (T1/T4/T7).
2. Drain đua fresh dispatch/Assistant bootstrap, fork escaped hay finalizing chưa sync: không activation hay replacement sau timeout (T4/T5/T7).
3. Tampered ZIP/redirect/identity/architecture/schema, partial bundle và hết disk: giữ bản đang chạy, không extract/publish thiếu kiểm chứng (T2/T3).
4. Crash ở bundle swap, pointer, host boot, health ACK hoặc rollback: recover đúng operation/generation, không hai host hoặc mất checkpoint/Keychain refs (T5/T7).
5. Deploy approval sai descendant/release/target, backup có DB nhưng thiếu original blob, cert hết hiệu lực sau update: chặn thực thi và ghi lý do thật (T6/T7).

## Producer gates và ownership

| Producer | Consume nguyên trạng / gate |
|---|---|
| Actual02 | Actor/Tx/Mutator + authorize-before-replay, readDeployAuthorization/deployTicketFingerprint, attempt active/uncertain/finalizing; Task7 actual HTTP composition qua review trước wiring |
| Actual03 Task1–2 | AtomicRecords formatVersion1, ProcessLock, ProcessJournal/Launcher, HttpOperationJournal, ResourceRegistry, GatewayStatus; NativeHelper.build đang dev-only; fork→UNKNOWN không được nâng thành stopped |
| Planned03 Task3–7 | gateway_boots generation + auth, workflow registry refs và command reconciliation thực; không dùng shell hiện tại làm bằng chứng production |
| Reviewed04/05/06 | runtime/model binary/policy certificate, original/derivative refs, AssistantDriver.checkpoint/stop, turn/dispatch reservation/retirement; actual008–010 + certified producers mới được mở admission |
| Phase08 PROVISIONAL | actual accepted merge receipt/merged_commit writer,011 head authority registration/generation/binding, docs-only/merged proof, FinalEvidencePort và observer enrollment; chờ re-review F1–F4, không tự sửa08 |

| Task | Create ownership (repo-relative) | Reviewed modify/handoff |
|---|---|---|
| T1 release/control | `v2/server/migrations/012_operations.sql`; `v2/server/src/operations/{contracts,releases,updates,admission,routes}.ts`; `v2/server/test/operations-control.test.ts`; `v2/server/test/support/operations.ts` | controller app/event registration after02 review |
| T2 package/onboarding | `v2/desktop/packaging/{build,verify}.ts`, `{Info,agent,entitlements-ui,entitlements-node,entitlements-helper}.plist`; `v2/desktop/native/{service-management,launcher}.swift`; `v2/gateway/src/updates/native-loader.ts`; `v2/desktop/test/package.test.ts` |03 `journal/native.ts`, `journal/process-journal.ts`, `journal/gated-helper.ts`, `resources/registry.ts` explicit packaged helper DI; controller desktop narrow IPC/permission UI |
| T3 verified stage | `v2/gateway/src/updates/{contracts,manifest,download,stage}.ts`; `v2/gateway/test/update-stage.test.ts`; `v2/gateway/test/support/update-archives.ts` | registry borrowed, no own unsafe cleanup |
| T4 drain | `v2/gateway/src/updates/{drain,transport}.ts`; `v2/server/test/operations-drain.test.ts`; `v2/gateway/test/update-drain.test.ts` |06 fresh admission/prelaunch/Assistant bootstrap/retirement hooks through explicit owner transfer |
| T5 activation | `v2/gateway/src/updates/{journal,activation,health}.ts`; `v2/desktop/native/update-coordinator.swift`; `v2/gateway/test/update-recovery.test.ts`; `v2/desktop/test/update-native.test.ts` | controller host entry/start/stop;03 helper identity APIs only after reviewed handoff |
| T6 VPS/recovery | `v2/ops/{compose.yml,config.example.json,deploy.ts,backup.ts,restore.ts,health.ts}`; `v2/server/src/operations/{deploy,deploy-proof}.ts`; `v2/ops/test/recovery.test.ts`; `v2/server/test/deploy-operations.test.ts` |08 FinalEvidencePort composition additive deploy verifier after reviewed contract |
| T7 acceptance | `v2/server/test/operations-acceptance.test.ts`; `v2/gateway/test/update-acceptance.test.ts`; `v2/desktop/test/signed-update-live.test.ts`; `v2/ops/test/product-acceptance.test.ts` | controller only app/main/host/desktop/package-lock/docs mappings and07 API hookup |

T1 owns all012 columns and freeze checksum. T2/T3 can prepare disjoint fixtures after types freeze; T4 consumes T1+actual06; T5 waits T2–4; T6 independent preparation, assembly waits08; T7 serializes integration. Each worker preserves others; index/commit/shared manifests only controller. Flow pages created with source: `v2/docs/flows/{server-operations,macos-updates,vps-operations}.md`, every producer touched updates its flow too.

## Typed contracts: T1 server, T3 matching strict JSON

`Id=string(UUID)`, `Sha256=string(hex64 lowercase)`, `GitOid=string(hex40|hex64)`, `Generation=string(unsigned decimal)`; byte lengths safe integers. Imports Actor/Tx from actual02; gateway uses JSON conformance tests, no server runtime import. Canonical JSON002 and SHA-256; signatures Ed25519 over canonical bytes excluding signature. Release key allowlist is trusted deployment config, never supplied by a machine.

```ts
type Component={name:'app'|'host'|'node'|'process-helper'|'resource-helper'|'coordinator';
  version:string;sourceCommit:GitOid;path:string;binarySha256:Sha256;treeSha256:Sha256};
type SchemaRange={min:number;max:number};
type Release={format:1;id:Id;sequence:Generation;sourceCommit:GitOid;arch:'arm64'|'x64';
  minMacOS:string;maxMacOS:string|null;electronVersion:'44.5.1';nodeVersion:'24.21.0';
  bundleId:string;teamId:string;designatedRequirementSha256:Sha256;entitlementsSha256:Sha256;
  components:Component[];archive:{format:'zip';url:string;bytes:number;sha256:Sha256};
  notarization:{submissionId:Id;status:'Accepted';stapled:true};
  schema:{server:SchemaRange;local:SchemaRange;writesLocal:number};
  updaterProtocol:1;buildEvidenceSha256:Sha256;keyId:string;signature:string};
type EnrollmentProof={id:Id;challengeId:Id;nonce:string;machineId:Id;releaseId:Id;manifestSha256:Sha256;
  bundlePathIdentitySha256:Sha256;bundleId:string;teamId:string;designatedRequirementSha256:Sha256;
  observedAt:string;keyId:string;signature:string};
type UpdateTarget={machineId:Id;registrationId:Id;bindingSetSha256:Sha256};
type UpdateRequest={operationId:Id;target:UpdateTarget;expectedRevision:number;releaseId:Id;manifestSha256:Sha256};
type UpdateState='queued'|'received'|'staging'|'draining'|'activating'|'health_pending'|
  'succeeded'|'rolled_back'|'superseded'|'failed'|'blocked';
type UpdateCommand={id:Id;request:UpdateRequest;desiredRevision:number;state:UpdateState;
  activationGeneration:Generation|null;result:UpdateResult|null};
type UpdateResult={outcome:'succeeded'|'rolled_back'|'superseded'|'failed';
  currentReleaseId:Id|null;healthReceiptId:Id|null;code:string};
type DrainSnapshot={commandId:Id;localSequence:Generation;processRecordIds:Id[];
  checkpointArtifactIds:Id[];httpOperationIds:Id[];unresolvedEffectIds:Id[];sha256:Sha256};
type ActivationGrant={id:Id;commandId:Id;target:UpdateTarget;generation:Generation;
  releaseId:Id;manifestSha256:Sha256;previousReleaseId:Id;drainSha256:Sha256};
type UpdateReport={id:Id;commandId:Id;bootId:Id;bootGeneration:Generation;sequence:Generation;
  activationGeneration:Generation|null;state:UpdateState;code:string;manifestSha256:Sha256;
  health:HealthProof|null};
type HealthProof={releaseId:Id;processInstanceId:Id;startIdentity:string;manifestSha256:Sha256;
  componentsSha256:Sha256;localSchema:number;serverSchema:number;checkpointSha256:Sha256;
  signatureVerified:boolean;serviceStatus:'enabled'|'requiresApproval'|'notRegistered'|'notFound';
  credentialProbe:'pass'|'unverified'|'failed';observedAt:string;traceSha256:Sha256};
interface UpdateAdmission {
  assertFresh(tx:Tx,machineId:Id,kind:'execution'|'routing'|'prelaunch'):Promise<void>;
}
interface UpdateStore {
  request(tx:Tx,actor:Actor,input:UpdateRequest):Promise<UpdateCommand>;
  grant(tx:Tx,actor:Actor,input:{commandId:Id;drain:DrainSnapshot}):Promise<ActivationGrant>;
  report(tx:Tx,actor:Actor,input:UpdateReport):Promise<UpdateCommand>;
}
interface UpdateDrain {prepare(command:UpdateCommand):Promise<{state:'waiting'|'ready';snapshot:DrainSnapshot;reasons:string[]}>;}
interface BundleInstaller {stage(release:Release):Promise<{resourceId:Id;bundlePath:string;manifestSha256:Sha256}>;}
interface Activator {activate(grant:ActivationGrant):Promise<void>;recover():Promise<UpdateState>;}
```

`registrationId` is T1 immutable v2 install enrollment per current nonrevoked machine, owner-confirmed path/identity; `bindingSetSha256` hashes sorted current003 projectId+bindingRevision plus010 designationRevision for this machine, not a claim to execute those projects. No project at first install gives empty set. Machine update authority never admits cross-project work. Nonempty workflow/model pins are external refs, not app Component; updates cannot rewrite a running RuntimePin.
Health booleans are observations, not trust: T5 verifies local Security/OS results; server only accepts from current machine/boot plus enrolled trusted health verifier. `verifyUpdateHealth(proof:HealthProof,grant:ActivationGrant):Promise<void>` injected T1 defaults `UPDATE_VERIFIER_NOT_CONFIGURED`; T7 fixture verifier cannot reach production. Host health success and runtime04/routing06/observer08 certification are separate; stale certificates block admission after healthy update.

## Persistence012, wire và replay

| Table | Exact additional columns/constraints |
|---|---|
| operations_releases | id PK, sequence UNIQUE, canonical_manifest JSONB, manifest_sha256 UNIQUE, key_id, signature, created_at; immutable, no latest URL; signed revocation rows separate |
| operations_enrollment_challenges | id PK, machine_id FK, nonce_hash UNIQUE, expires_at, consumed_proof_id nullable; owner-requested, trusted verifier pinned outside machine channel |
| operations_installs | registration_id PK, machine_id FK, enrollment_proof_id UNIQUE, initial_release_id FK, highest_authorized_sequence, revision, bundle_path_identity_sha256, bundle/team/requirement hashes, enrolled_by_owner, state active/revoked; one active per machine |
| operations_desired | machine_id PK, revision, registration_id FK, release_id FK, manifest_sha256, command_id; CAS; no applied from this row |
| operations_updates | command_id PK, operation_id UNIQUE, machine/install FK, binding_set_sha256, desired_revision, immutable request_hash, cursor UNIQUE from002 event, state, activation_generation, grant_id, previous_release_id, immutable result nullable; one activating/health_pending/blocked-after-grant per machine |
| operations_drain | machine_id PK, command_id FK, generation, state held/released, snapshot_sha256, activation_grant JSONB nullable; never expiry-based release |
| operations_update_reports | report_id PK, command_id FK, boot/generation/sequence, body_sha256, exact_response JSONB, health_verifier_receipt nullable, received_at; immutable; UNIQUE(machine_id,boot_id,sequence) |
| operations_current | machine_id PK, release_id FK, manifest_sha256, activation_generation, health_report_id FK, observed_at; server-derived only after accepted health or rollback proof |
| operations_vps_releases | id PK, canonical_manifest JSONB, manifest_sha256 UNIQUE, signature/key_id, source_commit, build_receipt; immutable, trusted verifier admission |
| operations_deployments | operation_id PK, ticket_id/attempt_id FK005, fence, process_instance_id, definition_hash, target_id, release_sha256, expected_previous_sha256, effect_id UNIQUE, state prepared/applying/uncertain/succeeded/rolled_back/failed, immutable request_sha256 |
| operations_deploy_receipts | id PK, operation_id FK UNIQUE, observer_receipt_id, actual_release_sha256, backup_manifest_sha256, schema_checksum, health_trace_sha256, outcome, received_at; append-only |

Mutations use002 authorize-before-idempotency-replay with current auth/revocation/registration/binding checks; committed report replay is historical response only, cannot promote current. New report checks007 current boot under its machine lock, monotonic dedicated update sequence, exact command/hash/generation; changed same ID409. Keep007 boot protocol; no second heartbeat or ticket command enum. All writes follow reviewed02/06 lock order, then012; no network or Apple API inside Tx.

| Wire | Body/result / actor |
|---|---|
| POST `/v2/operations/releases` | owner+CSRF Release→`{id,manifestSha256}`; signature/build proof verifier must accept; permission does not publish CDN |
| POST `/v2/operations/install-challenges` | owner+CSRF `{machineId}`→`{id,nonce,expiresAt}`; nonce32bytes,15min, expected machine identity pinned |
| POST `/v2/operations/installs` | owner+CSRF `{expectedInstallRevision,proof:EnrollmentProof}`→`{registrationId,revision}`; current machine, single-use challenge, trusted signed onboarding proof required; initial current release verified separately |
| PUT `/v2/operations/machines/:id/desired` | owner+CSRF UpdateRequest→UpdateCommand; target path id immutable; desired CAS and new command/event atomic |
| GET `/v2/operations/commands?after=<cursor>`; GET `/v2/operations/commands/:id` | current machine only→`{items,nextCursor}` / UpdateCommand; durable002 cursor, distinct005 page anchor |
| POST `/v2/operations/commands/:id/drain`; POST `/v2/operations/commands/:id/activate` | machine `{operationId}`→held barrier / `{drain:DrainSnapshot}`→ActivationGrant; host journal persists exact operation before send |
| POST `/v2/operations/reports` | machine UpdateReport→UpdateCommand; received/staging ≠ installed; terminal result immutable |
| GET `/v2/operations/machines/:id/status` | owner→`{target:UpdateTarget,installRevision,desired,current,command,receivedAt,reasons:string[]}`; stale display uses server clock |
| POST `/v2/operations/vps-releases` | owner+CSRF VpsRelease→`{id,manifestSha256}`; trusted signature/build receipt; registration is not deployment |
| POST `/v2/operations/deployments`; GET `/v2/operations/deployments/:id` | current bound machine `{operationId,ticketId,attemptId,fence,processInstanceId,effectId}`→DeployPlan/current operation; all target/release args derived exact ticket, never arbitrary shell |
| POST `/v2/operations/deployments/:id/receipt` | machine signed DeployObservation→immutable receipt; actual trusted verifier, not boolean health body |

T1 services `createUpdateStore({verifyRelease,verifyUpdateHealth,verifyEnrollment}):UpdateStore`, `createUpdateAdmission():UpdateAdmission`, `registerOperationsRoutes(app,options,deps):void`; missing release/health/enrollment verifier denies. New desired B supersedes A only before activation grant, appends A terminal result once and queues B new ID; old staging never activates. Once grant exists, B waits A reconciliation. Barrier transfers under same machine lock or releases only after exact A cancellation/no-activation proof; offline/timeout never releases it. Grant retry returns original generation, not another activation.

Enrollment producer T2 native bridge verifies the manually installed signed bundle and pinned Release, signs challenge-bound EnrollmentProof with operator-enrolled health key; this key requires measured process/key protection, not a generated machine bearer key. T1 `verifyEnrollment(proof:EnrollmentProof):Promise<void>` checks pinned verifier key/build, same challenge/machine/release/identity and validity before consuming challenge. expectedInstallRevision=0 for first enrollment, then CAS current012 install revision;003 machine has no invented revision field. Owner confirms exact path/bundle/Team preview; initial current may be written only from this proof plus actual health check, never owner JSON alone. Unknown key/unsigned/dev package cannot initialize production current.

### Narrow producer handoffs before implementation

- T2 uses `type PackagedHelper={path:string;expectedSha256:Sha256;requirement:string}` and adds `NativeHelper.fromPackaged(input:PackagedHelper):Promise<NativeHelper>`, `ProcessIdentity.fromHelper(helper:NativeHelper):ProcessIdentity`. ProcessJournal.open(root,{helper}) and ResourceRegistryOptions.helper are additive constructor dependencies; packaged main and gated-helper INIT take the same validated immutable helper descriptor, so child cannot fall back to clang. Existing dev factories remain explicit. Package executables use0755/no group-other write, distinct from dev cache0700; attestation validates the appropriate mode, signed identity and inode every use.
- T4 proposal `assertFresh(tx,machineId,kind)` must be injected in06 prepareDispatch/actual AuthorizeDispatch, prelaunch, routing bootstrap and009 routing admission; retirement still uses06 proof. Review all actual producer signatures and lock order before code, transfer ownership for narrow injection only, no frozen DTO changes. Local Launcher RELEASE and drain-latch activation serialize under the same host admission lock: release wins→launch counted in drain; latch wins→no workflow RELEASE. Check after server prelaunch and before effect, not a racy boolean read.
- T6 proposes08 internal `TicketCompletionProof` extension `{kind:'deploy';mergeEvidenceId:null;deploymentReceiptId:Id;resultEvidenceIds:Id[]}` through its registered reader factory. `verifyDeployResult` derives verified004 evidence from012 trusted receipt; reader checks exact current ticket/attempt/action authorization, required workflow/task/request review, deployment health and immutable result linkage. Public005/FinalEvidencePort/SQL011 unchanged; absent reviewed extension denies deploy completion. Both005 finalization and ticket completion must exercise this branch, code/docs proofs remain distinct.

## T1 — Immutable release/control plane và admission barrier

- [ ] RED in `operations-control.test.ts`: owner CSRF/origin, unknown/revoked key, mutation under same release ID, stale desired CAS, old registration/rebound project, foreign machine and cached replay after revocation all deny; queue survives API/pool restart. Fixture owns databaseFixture(12) only after actual reviewed001–011 exist.
```ts
const a=await f.owner.requestUpdate(f.releaseA,0); await f.restartApi();
const b=await f.owner.requestUpdate(f.releaseB,1);
assert.equal((await f.machine.command(a.id)).result?.outcome,'superseded');
assert.equal((await f.owner.status()).desired.commandId,b.id);
assert.equal((await f.owner.status()).current.releaseId,f.initialRelease.id);
```
- [ ] Run `pnpm --dir v2/server test --test-file "$PWD/v2/server/test/operations-control.test.ts"` from repo root; actual runner requires an absolute path; expected missing behavior RED, absent producer migrations means dependency BLOCKED.
- [ ] GREEN implement strict schemas/signatures and012 atomic CAS/event; max manifest256KiB/components exactly six unique names (VpsRelease separately strict api+web); min/max schema monotonic integer validation; reject release sequence below installs.highest_authorized_sequence; equal sequence allowed only same immutable manifest for a fresh explicit retry, grant.previousReleaseId rollback is the sole lower-version exception; rollback only grant.previousReleaseId. Trusted key rotation requires signed old-key transition plus operator config review; unknown/revoked key never self-enrolls.
- [ ] GREEN barrier `assertFresh` rejects all new execution/routing/prelaunch admissions when held. T4 injects at06 atomic admission points and local pre-release; existing attempt/turn reconciliation/checkpoint/result/finalization continues. Owner request updates desired only; drain begins after package fully verified to avoid blocking jobs during a failed download.
- [ ] Re-run focused suite/typecheck; review012 migration/authority independently; backup private011 fixture before012 + restore checksum proof; server-operations flow, controller commit `feat(v2): persist immutable update commands` after docs checks.

## T2 — Signed full bundle, private executables và onboarding

**Produces:** `buildBundle({arch,sourceCommit,outputRoot}):Promise<{appPath:string;componentManifest:Component[]}>`; native service bridge `status|register|open-settings` returns actual SMAppService status; packaged loader `loadPackagedHelper(input:PackagedHelper):Promise<NativeHelper>`.
- [ ] RED `package.test.ts`: build layout per architecture; no global node/clang in PATH; missing/tampered/private Node/helper, changed bundle/team/requirement/entitlements, unsupported OS fail; packaged code never calls NativeHelper.build. Dev compilation remains explicit dev factory only.
```ts
const p=await f.buildUnsignedFixture('arm64');
assert.deepEqual(await f.packagedCommands(p),['node','process-helper','resource-helper','coordinator']);
await assert.rejects(()=>f.startWithMissingHelper(p),/PACKAGED_HELPER_MISSING/);
assert.equal(f.observedCompilerSpawns,0);
```
- [ ] Run `pnpm --dir v2/desktop test` RED; GREEN assemble `.app` from pinned Electron ZIP with private `Contents/Resources/node/bin/node`, built gateway entry and six-component manifest. Native executables in `Contents/MacOS`/`Contents/Helpers`, no modifications after signing. Pin upstream hashes in research; builder validates release keys+download bytes and records compiler/SDK/tool versions/hash; no new package manager needed on recipient.
- [ ] GREEN create agent plist with `BundleProgram=Contents/MacOS/crew-launcher`, label derived stable bundle ID `.host`, `RunAtLoad`, restart policy owned by launcher. `SMAppService.agent(plistName:)` only explicit onboarding action; observe requiresApproval/denied and link Settings, never treat register return as enabled. Stable install path under owner-selected writable `~/Applications/2P Crew v2.app`; administrator-owned/foreign bundle path blocked, no sudo fallback.
- [ ] GREEN producer handoff: NativeHelper gains sealed packaged constructor validating Security requirement + expected binary hash/UID/inode/no-follow and no compile fallback; ProcessIdentity/ResourceRegistry accept immutable helper factory. Test from installed bundle with minimal PATH and matching private Node, while03 UNKNOWN descendant semantics unchanged. UI remains independent, narrow origin-checked IPC exposes service action/status, never token/credential.
- [ ] Prepare unsigned archive/entitlements/identity preview first; owner-approved signing lane signs nested binaries then outer app, hardened runtime/timestamp, least entitlements (Electron/private Node JIT only when required; no blanket disable-library-validation). Submit notarization ZIP, record Accepted, staple `.app`, repackage final `crew-v2-<releaseId>-darwin-<arch>.zip`, hash final bytes and publisher-sign Release. No fabricated Team ID/private key in repo. Verify final bundle/Keychain ACL and same identity across A→B; offline stapled app test on authorized clean test account. Lack of identity/scope remains UNVERIFIED, offline tests proceed.
- [ ] Re-run package/typecheck; independent signing/entitlements/onboarding review, macos-updates + gateway-host/desktop-shell docs; controller commit `feat(v2): package signed private gateway executables` only with truthful evidence labels.

## T3 — Bounded download, verify, safe extraction và immutable stage

- [ ] RED `update-stage.test.ts`: publisher signature/key mismatch, wrong bundle/team/OS/arch/schema, redirect to other origin/private IP, oversized stream/zip bomb, path absolute/../NUL/case-NFC alias, duplicate file, hardlink/device, escaping symlink and truncated ZIP all fail before publication; partial components never current. Server auth token never forwarded to artifact CDN.
```ts
await assert.rejects(()=>f.installer.stage(f.releaseWithBadArchive),/ARCHIVE_REJECTED/);
assert.equal(await f.currentBundleHash(),f.originalBundleHash);
assert.equal(await f.stagedPublishCount(),0);
```
- [ ] Run `pnpm --dir v2/gateway exec node --test test/update-stage.test.ts` RED; GREEN use owner-configured pinned HTTPS CDN origin/path, max3 redirects each revalidated and DNS IP checked, no credentials/cookies,30s connect/5min total with resumable exact ETag+range only if expected hash still checked. Download <=1GiB; expanded<=3GiB, entries<=100000, per-file<=1GiB, ratio<=100; free disk ≥2×expanded+5GiB before stage. Limits frozen in manifest policy/build proof; fail explicit if Electron package exceeds bound.
- [ ] GREEN use audited phase05 yauzl3.4.0 pin (add exact gateway dependency via controller), validate central and actual entry lengths, write only FD-owned private staging; nested framework relative symlinks allowed only from signed build inventory and resolve inside bundle, never followed while creating files. Reject hardlinks/special files. Do not shell-extract untrusted tar/ZIP; tar format is unsupported on update wire, malicious tar gets415.
- [ ] GREEN verify signature+compatibility+archive hash before extraction, then recompute component trees/binaries and Security designated requirement/entitlements + Gatekeeper/staple assessment before fsync/atomic stage publication. Canonical component tree digest excludes declared signature envelope files and records symlink targets/modes; actual codesign validates those envelopes separately. Hash algorithm/schema pinned in buildEvidence, path order NFC UTF-8 sorted and duplicate aliases rejected.
- [ ] Retain previous release, current release, queued grant and every run binary/source/projection ref; ResourceRegistry reserves stage with operationId as runId and only cleans unused stage after exact helper stop/no refs. Interrupted or unverifiable ownership stays retained with error. Re-run tests/typecheck, independent extraction review, macos-updates docs; controller commit `feat(v2): verify update packages before staging`.

## T4 — Durable drain với actual runtime/Assistant authority

- [ ] RED `operations-drain`/`update-drain`: barrier vs fresh005 claim,06 dispatch prepare/prelaunch and Assistant bootstrap each one winner; active turn/current attempt continues; reserved unlaunched command retires only06 no-launch proof. Dropped drain reply replays key/body; finalizing/missed sync/UNKNOWN descendant cannot produce grant even after heartbeat loss/timeout.
```ts
await f.holdDrain(); await f.reportEscapedDescendant(); await f.advanceHours(24);
assert.equal((await f.drain.prepare(f.command)).state,'waiting');
await assert.rejects(()=>f.requestActivation(),/DRAIN_NOT_PROVEN/);
assert.equal(await f.activeGuardCount(),1);
```
- [ ] Run server focused file and `pnpm --dir v2/gateway exec node --test test/update-drain.test.ts` RED. T4 owns `bindUpdateAdmission(existingPorts,admission)` composition after06 owner review; actual transaction hooks lock machine barrier consistently before admitting spawn/turn. Missing hook for any path blocks rollout; a periodic status check cannot replace atomic admission.
- [ ] GREEN after server barrier receipt fsync local admission latch before reconciliation; checkpoint Assistant via06 driver and existing checkpoint route, allow current bounded turn to finish, stop only at checkpoint boundary with exact real stop proof. No timeout kill; surface “Chờ công việc dừng an toàn”. Existing attempts keep pins and complete005 finalize/docs08 normally while held.
- [ ] GREEN snapshot from ProcessJournal,005 guards,010 turn/reservations,011 unresolved integrations/effects and pending HTTP journal; server independently queries its rows, not accepts client's empty arrays. Claim/prelaunch already granted before barrier remains counted until06 retirement proof or normal finalization; host latch denies RELEASE during drain and reconciles dormant helper honestly. Current-binding/revocation changes rechecked before grant; rebind while activation unknown denied through reviewed binding guard.
- [ ] Require no active/unknown/finalizing execution or turn, no admitted dormant helper, no unresolved integration/deploy effects and all checkpoint/results durably acknowledged before ready. Grant reserves machine barrier/generation atomically; target release and current previous signed release fixed. Transport uses03 HttpOperationJournal for received/drain/grant/report each separate durable key; no rewrite of earlier operation after new boot.
- [ ] Re-run focused tests/typechecks; independent race/lock-order review with06 owner; update server-operations/macOS and06 flows; controller commit `feat(v2): drain execution before package activation`.

## T5 — Coordinator swap, health và rollback có thể phục hồi

- [ ] T2/T5 RED→GREEN minimum supported package macOS13.0 arm64/x64 per Electron44 policy, private Node/Swift deployment target and real binary headers; test13 plus current supported macOS in release matrix. Any higher actual binary floor changes manifest compatibility and blocks unsupported machine before download; no Rosetta fallback or claim from semver alone.

**Local record:** AtomicRecords version1 under host `updates/`: `{operationId,commandId,grant,stageResourceId,oldBundleIdentity,newBundleIdentity,phase,oldHostIdentity,newHostIdentity,backupManifestSha256,httpOperationIds}`; phase `prepared|old_stopped|swapped|pointer_written|new_started|healthy|rollback_pending|rolled_back|uncertain`. Active pointer `{format:1,releaseId,manifestSha256,generation,bundleIdentity}` written atomic+fsync; never embeds credentials.
- [ ] RED real owned host/native fixture kill at each record/swap/pointer/start/health/report/rollback boundary; coordinator process alive after Node/UI exit; second coordinator/launchd restart cannot spawn second host. New host timeout while process identity unknown blocks rollback; explicit actual failed startup + stopped proof allows previous compatible bundle. Test same bytes with wrong start identity/registration denied.
```ts
await f.crashAt('after-bundle-swap'); await f.restartCoordinator();
await f.activator.recover();
assert.equal(await f.liveHostCount(),1);
assert.equal(await f.checkpointHash(),f.beforeCheckpointHash);
assert.equal(await f.activationGeneration(),f.grant.generation);
```
- [ ] Run `pnpm --dir v2/gateway exec node --test test/update-recovery.test.ts` and desktop native suite RED. GREEN independent signed native coordinator starts from retained staged bundle, owns update OS lock and exact grant; old host completes drain, flushes/backs up local journal and exits; coordinator verifies exact OS stop before swapping. Do not call existing GatewayHost.stop({drain:true}) as job drain: actual03 method only drains IPC.
- [ ] GREEN stable same-filesystem app path swap via native directory-FD identity checks + `renameatx_np(RENAME_SWAP)`, keep previous bundle under attested staging; fsync dirs, update pointer, launch new stable path/private Node. Every startup first acquires coordinator/update lock and reconciles unfinished journal before host ProcessLock. Bundle swap+pointer are two durable steps; recover checks both bundle identities/hash and grant, not assumes atomic cross-file transaction. Cross-volume/unwritable target or volume without `volumeSupportsSwapRenaming` blocked at onboarding; owned filesystem fixture verifies swap and fsync behavior before enabling native updates. GUI main closes only after its exact identity exits; failure to close postpones swap.
- [ ] GREEN health within60s checks live exact host boot/start identity, package component/hash/signature,007 new boot handshake, socket/read-only server compatibility, journal recovery/checkpoint digest, background status and authorized test credential access. Missing server/network keeps health_pending/barrier and retries bounded30→300s; network alone is not failed startup. Missing privilege requires owner action; never auto-grant. New boot reports health using new HTTP operation and exact grant; old receipt replay cannot advance current. Success requires server trusted health receipt before terminal/succeeded/barrier release.
- [ ] GREEN startup crash/signature/local schema failure rolls back only after new host actual stop; journal schema writes use expand-only compatible version with prior reader range verified before activation. Keep durable checkpoint/effect/HTTP records in place; do not restore stale backup over newer receipts. Incompatible/destructive local schema or unknown new process→blocked manual recovery, no auto down-migration. Restore previous signed bundle/pointer under same generation operation, recheck health and report rolled_back; desired stays requested release and UI shows failure/current prior.
- [ ] Native bridge registration path/status verified again after swap/reboot; approval missing means waiting, not repeated register prompts. Existing permissions may persist with stable signature but tests must observe; runtime04/routing06/observer08 certificate invalidated by changed binary/policy/OS and admission stays unavailable until recertified. Re-run tests; independent crash/native review, docs; controller commit `feat(v2): recover coordinated app and host updates`.

## T6 — VPS release, exact deploy authorization và restore drills

**T6 artifact types** (T1 reserves012 table; gateway/runner validates identical strict JSON):
```ts
type VpsRelease={format:1;id:Id;sourceCommit:GitOid;images:{service:'api'|'web';digest:string}[];
  schemaFrom:number;schemaTo:number;migrationChecksums:Record<string,Sha256>;previousReadableSchemas:number[];
  configSchema:1;buildEvidenceSha256:Sha256;keyId:string;signature:string};
type BackupManifest={format:1;id:Id;databaseSnapshotSha256:Sha256;schemaVersion:number;
  migrationChecksums:Record<string,Sha256>;eventCursor:Generation;deploymentSha256:Sha256;
  blobs:{key:string;kind:'original'|'derivative'|'artifact';sha256:Sha256;bytes:number}[];
  docsSnapshotHashes:Sha256[];createdAt:string;keyReferences:string[];sha256:Sha256};
```
`images` exactly api+web with OCI `sha256:<hex64>` digests; registry origin fixed operator allowlist. Target config keyed targetId is operator-owned signed deployment config (hostname/ports/services/volumes/secret refs), not request JSON; a configuration hash is included in `inputs.deployPlan` and definition fingerprint. Backup SHA hashes canonical bytes excluding sha256; no credential bytes or secret download URL. Initial VPS deployment uses expectedPreviousSha256 of operator-approved empty-target record, never wildcard.

**Types:** `DeployPlan={operationId:Id,ticketId:Id,targetId:string,targetConfigSha256:Sha256,releaseSha256:Sha256,sourceCommit:GitOid,expectedPreviousSha256:Sha256,schemaFrom:number,schemaTo:number,backupManifestSha256:Sha256,effectId:Id,definitionHash:Sha256}`; `DeployObservation={operationId:Id,attemptId:Id,fence:string,processInstanceId:Id,planSha256:Sha256,actualReleaseSha256:Sha256,backupManifestSha256:Sha256,schemaChecksum:Sha256,healthTraceSha256:Sha256,outcome:'succeeded'|'rolled_back'|'failed',keyId:string,signature:string}`. T6 exports `prepareDeploy(tx,actor,input):Promise<DeployPlan>`, `acceptDeployReceipt(tx,actor,proof):Promise<Id>`, `verifyDeployResult(tx,input:Parameters<ServerOptions['verifyFinalResult']>[1]):Promise<void>`; server configured trusted runner key, default deny.
- [ ] RED `deploy-operations.test.ts`: exact owner-created deploy root works only its own definition; same root's child without own fingerprint approval denies, machine-created root denies, changed release/target/argv/migration/backup denies. Approved merge/PM mandate not accepted. Lost apply response marks uncertain and reconciles deployed digest/schema/receipt before retry, no duplicate migration/release switch.
```ts
await assert.rejects(()=>f.prepareDeploy(f.childWithoutApproval),/DEPLOY_OWNER_INTENT_REQUIRED/);
await f.approveExactChild(); const plan=await f.prepareDeploy(f.child);
assert.equal(plan.definitionHash,await f.storedDeployDefinitionHash(f.child.id));
```
- [ ] Run server focused test + `pnpm --dir v2/ops exec node --test test/recovery.test.ts` RED. GREEN store DeployPlan fields in immutable `CreateTicket.inputs.deployPlan` before004 fingerprint at ticket creation; readDeployAuthorization exact ticket under current005 attempt/fence+binding, verify hash from stored definition. Operator prepares manifest before owner action; owner approval is final step before production invocation, never infer from planned ticket.
- [ ] GREEN isolated compose project `crew-v2-<environment>`, service names `crew-v2-api`, `crew-v2-web`, `crew-v2-db`, private attachment/original/derivative/release/backup volumes and credentials; API loopback18787, web18080 behind explicit v2 TLS hostname, DB container5432 unpublished in production; test DB random loopback !=5432/55432. Validate collision and forbid v1 paths/database/service/container IDs. Container image digests/build source/lock hashes in release manifest; no use of v1 deploy script/env. Config includes bound origins, port/health policy, retention and secret references; compose values rendered from reviewed exact target config.
- [ ] GREEN staging runner owns restricted target allowlist and serial deployment lock; prepare→backup proof→migrate additive012→start candidate separate service→health/readiness→atomic proxy target switch→receipt. Each effect operation saved before remote action; compare expected prior deployment. Health tests actual auth/DB/SSE/blob read checksums/migration version and denied dispatch by default, never marks model certification. Failed candidate rollback binaries only with verified compatible schema; destructive DB restore requires separate explicit recovery action.
- [ ] GREEN backup captures DB custom-format snapshot plus inventory/hash of immutable docs/original/derivative blobs, active release/schema checksums, key identifiers and restore instructions. Establish write fence for compose/link/publish/GC, finish active uploads or leave journaled pending, capture snapshot, copy its referenced blobs, verify all, release fence; missing original fails backup. Secrets backed via operator encrypted vault separately, not Git/log. Owned sandbox restore into fresh DB/volumes verifies counts, every original hash, links, pending command/idempotency/guards,011 heads+attestations and server cursor before serving.
- [ ] GREEN bounded redacted logs10MiB×5/service, operational logs14d; daily backups7 + weekly4 immutable verified sets, configurable before release; referenced originals/artifacts/receipts/pins never age-deleted. Monitor health/last server receipt/disk/cleanup errors via existing06 five-minute monitor; operations health endpoint internal network only, no debugger/public DB ports. Alert once per meaningful state, report stale clock/unknown accurately.
- [ ] Update Vietnamese `v2/docs/guides/operations.md` with exact start/health/backup/restore/rollback/permission recovery steps, target config preview and owner gate. Re-run owned VPS recovery drill, independent auth/restore review; controller docs/commit `feat(v2): prepare isolated deployment and recovery operations`.

## T7 — Real HTTP/restarts, signed lane và whole-product acceptance

- [ ] RED full producer pipeline on owned001–012 DB, HTTP listeners and real host subprocesses: owner enroll→desired A offline→B→reconnect→stage→barrier→runtime/Assistant drain→grant→signed bundle health→report/current; response loss/API restart at each mutation. Wrong boot/out-of-order report/body changed, stale binding, current reversion and partial components all deny. Fixture helpers implement snippets above from actual services: `owner.requestUpdate/status`, `machine.command`, `restartApi`, `holdDrain`, `requestActivation`, `activeGuardCount`, `crashAt/restartCoordinator`, `liveHostCount`, `checkpointHash`, `activationGeneration`; direct SQL only assertions, not seeding verified evidence for integration.
- [ ] Run `pnpm --dir v2/server test --test-file "$PWD/v2/server/test/operations-acceptance.test.ts"`, gateway/desktop/ops suites RED then GREEN. T7 owns `v2/ops/package.json` scripts/tsconfig and support fixtures; scripts run TypeScript node:test with private Node floor, no install/global service side effects. Controller injects production release/health/deploy verifiers and barrier into all actual constructors; absent hook/certificate fails closed, not test fallback.
- [ ] Authorized live macOS lane uses disposable user/test app directory and exact temporary label `com.2pcrew.v2.test.<uuid>`, two final signed/notarized A/B packages, private Node, minimal PATH/no compiler. Observe codesign/Gatekeeper/SMAppService/Keychain test-service ACL, actual app quit with job retained, drain, update, failed-health rollback, reboot/reconnect and denied permission. Collect OS version/arch, package signatures/checksum, process identities, journal/HTTP IDs and actual output; cleanup only exact label/owned processes after stop proof. Not run or identity missing→UNVERIFIED, no signed release claim.
- [ ] Whole-product matrix ties every spec12 scenario to actual current commit + phase evidence: both official workflows/source isolation load+invoke/child on each enabled runtime; Claude/Codex/API tools/fallback and all quota unavailable; switches offline/OFF; Assistant PM routing/read/parallel/fresh telemetry/review5; original/scan/PDF/DOCX/XLSX/CSV attachments and comment while running; merge crash/conflict/current docs; board/list/flow chart/docs/machines07; update/rollback/cleanup and docs-only import without v1 tickets/credentials. Tests use true current producers, not invented mock PASS;07 approved layout needed for UI acceptance only.
- [ ] Record for each cell PASS/FAIL/UNVERIFIED, source commit, binary/policy/certificate IDs, command/test output/artifact hashes, runtime token/cost and failures/interventions, peak CPU/RAM/disk, recovery/drain/restore elapsed time. Fake and live rows separate; paid test uses owner-authorized bounded maxTurns/maxTools/maxCostUsd and scratch checkout. Missing runtime04/routing06/observer08 certificate blocks relevant cell and production eligibility.
- [ ] Batch final checks after fixes: each package `test` and `typecheck`; own migration012 backup/restore; map all source/test/native/plist/ops files in v2 docs flows, generate/check --all plus baseline-aware --staged mirror procedure from02, root staged check before controller commit. Run independent task reviews and final integration review exact HEAD. Preserve proof bundle before registry cleanup/worktree archive/local-main merge; no deploy merely because local merge passed.
- [ ] Deliver production preview containing exact release/source/image digests, target/ports/hostname/DB/volume isolation, required identity/permission, backup/restore drill, compatibility/rollback paths and action fingerprint. Final owner approval/owner-created exact deploy request authorizes T6 runner; current PM planning/implementation mandate does not. Actual deployment performed only under that separate scope, then observed receipt+health determines success.

## Failure outcomes and retention

| Condition | Durable outcome / owner-visible reason |
|---|---|
| Signature, manifest, component or archive mismatch | failed `PACKAGE_VERIFICATION_FAILED`; current unchanged, quarantine exact owned stage |
| Active/unknown/finalizing or undisposed reservation | draining `WORK_PENDING` / `PROCESS_TREE_UNKNOWN`; no timeout replacement |
| New desired before grant | superseded immutable old result; new command ID and pinned archive |
| Grant outcome/host death unclear | blocked `ACTIVATION_RECONCILIATION_REQUIRED`; keep barrier, both bundles and journal |
| True new startup failure, previous compatible and stopped proof | rolled_back with actual previous health receipt; desired/current differ |
| Permission/notary/certificate unavailable | blocked or UNVERIFIED with exact missing prerequisite; no pretend success |
| Unauthorized deploy or mismatched exact action |403 `DEPLOY_OWNER_INTENT_REQUIRED` /409 `DEPLOY_PLAN_MISMATCH`; no target effect |
| Backup/restore has missing or changed original | `BACKUP_INCOMPLETE`; no migration/publish or success receipt |

## External gates và self-review

- [x] Scope11→T1–5,7; scope7 deploy→T6; scope8 cleanup/monitor→T4–7; scope12 matrix→T7. Five Review Focus cases each have RED regressions and a file owner.
- [x] No duplicate heartbeat, ticket enum, model/workflow version authority, Assistant monitor or guard release; new012 update command namespace needed for non-ticket machine action, schema/config/boot revisions stay distinct.
- [x] Actual03 NativeHelper injection/IPC-only stop gap and06 admission hooks explicitly owned/reviewed; unchanged001–011, no compiler required on recipient, uncertain descendants keep barrier.
- [x] Reviewable plan/unsigned package/offline tests/staging and restore preview proceed before external asks. Genuine later gates: approved exact08 revision; actual03–08 producer integration/certificates; stable authorized signing identity/notary access + test account/permission;07 prototype for UI; bounded live model allowance; final exact production deploy authorization.
- [ ] Freeze09 after08 independent re-review and update producer/hash references; self-review is not independent acceptance. Actual release, signing/notarization, service permission, runtime certification and deployment remain UNVERIFIED until measured.
