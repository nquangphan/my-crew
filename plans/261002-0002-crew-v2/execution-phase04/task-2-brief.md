# Crew v2 phase 04 — Runtime và model pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Plan review:** `phase04-r2-2026-10-02` được review độc lập; chưa triển khai hay chứng nhận runtime.

**Goal:** Một máy có thể chạy Claude Code, Codex và OpenAI-compatible API qua cùng pool có công tắc riêng, chứng nhận cách ly nguồn workflow trước khi dispatch, và đổi model sau lỗi mà không chạy trùng hoặc mất artifact.

**Architecture:** Server v2 lưu cấu hình nguồn model mong muốn, catalogue quan sát và quyết định chặn dispatch; gateway giữ credential trong Keychain, probe capability, chạy mỗi adapter qua process và policy cách ly đã ghim. Một attempt ghim source workflow chung cộng đúng một projection Claude/Codex/API, model và launch; fallback tạo attempt mới sau khi process cũ đã dừng, terminal result đã được xác minh và guard phase02 được thả. Phase06 làm Trợ lý chọn và xếp hạng model, đánh giá ticket, lưu selection trước claim và phát DispatchPermit thật; phase04 chỉ cung cấp ứng viên đủ khả năng, adapter, chứng cứ và cơ chế chuyển an toàn.

**Tech Stack:** v2 Node >=24.12, TypeScript 7.0.2, pnpm 10.32.1, Fastify/PostgreSQL theo phase02, macOS gateway theo phase03, node:test; Claude Agent SDK/CLI và Codex app-server được ghim theo binary thực tế khi triển khai, Keychain Services cho credential API. Không thêm phụ thuộc trước khi khóa phiên bản và kiểm API thực tế.

**Spec:** docs/superpowers/specs/2026-10-01-crew-v2-design.md, mục 4–8 và 12; plans/261002-0002-crew-v2/plan.md; plans/261002-0002-crew-v2/phase-02-server-docs.md (contract 005 đã đóng băng); plans/261002-0002-crew-v2/phase-03-macos-workflows.md (contract 007 đã đóng băng ở e3d35aa); plans/261002-0002-crew-v2/execution-phase02/phase-03-plan-fix.md và phase-03-plan-re-review.md; plans/reports/research-261002-crew-v2-gateway.md. Đọc docs/index.md, v2/docs/index.md, crew-docs where/flow liên quan trước source. Worktree này chưa có .codegraph nên không cần CodeGraph.

## Global Constraints

- V2 độc lập trong v2/; không import daemon, prompt role, schema nghiệp vụ hoặc credential v1. Nội dung UI/docs tiếng Việt; identifier/path tiếng Anh; API timestamp UTC ISO, UI Asia/Ho_Chi_Minh.
- Chỉ chạy trên máy đã bind project; không chuyển checkout sang máy khác để tìm model. Cùng model ID ở hai runtime/provider là hai pool entry riêng. Superpowers mặc định, BMAD tùy yêu cầu; process chỉ nạp cặp SourcePin + ProjectionPin của workflow/run đã ghim, không viết prompt role PM/dev/QC riêng. Slot projection null/chưa audit/không certified thì chỉ cặp runtime×workflow đó unavailable.
- Phase02 migration 005, semantics active/uncertain/finalizing/stopped và active_attempt_id guard không sửa. Mất heartbeat/lease/HTTP reply không chứng minh process chết. Claim lại đúng command/processInstanceId hoặc chờ reconcile; không tạo process thứ hai sau lost claim.
- Phase03 GatewayConfig revision áp dụng **hai workflow source và mọi projection non-null**; source switches/model catalogue ở migration 008 và revision riêng. Không nâng applied workflow revision chỉ vì nguồn model đổi. Desired OFF chặn dispatch mới ở server ngay cả khi máy offline; OFF không kill attempt đang chạy. Phase06 permit phải đọc desired source state cùng exact source/projection/report và model choice trong transaction claim.
- Không chạy model có phí, probe credential thật hoặc thay global app/CLI/home trong lúc lập kế hoạch. Khi thực thi phase04, test live chỉ trên checkout scratch, model/provider do owner cho phép, giới hạn số lượt/cost; test mặc định fake/offline.
- Không coi HOME riêng, skills/list, một shell sandbox probe, permissions prompt hoặc allowlist skill là chứng nhận. Claude SDK ghi rõ danh sách skills không ngăn slash-command hay đọc file qua Read/Bash ([skills](https://code.claude.com/docs/en/agent-sdk/skills)). Cần bằng chứng process-wide cho native Read, child, tool, path alias và network.
- Contract phase03 e3d35aa đã sửa tám điểm Important trong plans/261002-0002-crew-v2/execution-phase02/phase-03-plan-review.md ở mức **kế hoạch**: boot-generation heartbeat replay; applied source/projection CAS; launcher spawn handshake; durable HTTP operation journal; sync retry; isolation honest UNVERIFIED; deterministic provenance; owned-path create/delete. Khi phase03 triển khai, phase04 kiểm producer thực tế khớp contract trước khi dùng; không coi review plan là test runtime PASS.
- Không tự phát lệnh deploy/merge; phase08/09 sở hữu merge/deploy/update. Mọi file nguồn mới thuộc v2/docs/flows.yaml và sửa flow page cùng commit; controller serialize manifest/lockfile/index và chạy crew-docs check --staged.

## Review Focus

1. OFF lúc máy offline hoặc ngay sau khi chọn model, trong khi attempt cũ đang chạy: server từ chối claim mới; attempt cũ vẫn hoàn tất, UI phân biệt pending/applied (Task 1, 7).
2. Catalogue quảng cáo model nhưng auth/quota/tool/vision/stream hỏng: entry không eligible; input ảnh/file không bị âm thầm bỏ, API list là khai báo owner chứ không suy từ GET /models (Task 1, 2, 5).
3. Lost claim response, lease hết hạn, model timeout sau tool side effect, cancel ACK đến trước OS exit: không process/attempt thứ hai, không lặp tool, guard giữ đến terminal (Task 3, 6).
4. Cùng UID dùng absolute path, native Read, symlink/hardlink, Bash/script, MCP hoặc child để nạp bộ workflow kia: probe phải deny thực sự hoặc adapter UNVERIFIED (Task 3, 4, 7).
5. Fallback khác runtime khi session cũ không tương thích, artifact/attachment còn tồn tại và reviewer đang chạy: checkpoint Crew xác định phần đã làm; không reset repair count/gates hay làm mất chứng cứ (Task 6, 7).

## Ownership và hợp đồng không đổi

| Unit | Files do worker sở hữu | Phụ thuộc |
|---|---|---|
| 1 server model config | v2/server/migrations/008_model_pool.sql; v2/server/src/models/{contracts,config,catalog,certification,secret-envelopes,routes}.ts; v2/server/test/{model-pool,model-certification,model-secret}.test.ts; v2/docs/flows/server-models.md | phase02 + 03 migration 007 |
| 2 host inventory/secret/probe | v2/gateway/src/models/{inventory,probe,credential-broker}.ts; test/{model-probe,credential-broker}.test.ts; v2/docs/flows/gateway-models.md | 1, phase03 host |
| 3 runtime boundary | v2/gateway/src/runtime/{contracts,launch,tool-policy,effect-ledger,isolation}.ts; test/{runtime-boundary,effect-ledger,isolation-runtime}.test.ts; v2/docs/flows/gateway-runtime.md | phase03 journal/isolation/registry |
| 4 Claude/Codex adapters | v2/gateway/src/runtime/{claude,codex}.ts; test/{claude-adapter,codex-adapter}.test.ts | 2/3 |
| 5 API adapter | v2/gateway/src/runtime/{api-protocol,api-loop}.ts; test/{api-protocol,api-loop}.test.ts | 2/3 |
| 6 fallback bridge | v2/gateway/src/runtime/{checkpoint,fallback}.ts; test/{checkpoint,fallback}.test.ts | 1–5, phase02 execution |
| 7 real acceptance/docs | v2/gateway/test/runtime-live.test.ts, test/fixtures/runtime-scratch/*; v2/server/test/model-pool-acceptance.test.ts; flow pages + v2/docs/architecture.md | 1–6 |

Task 4 Claude/Codex có file và fixture tách biệt để triển khai độc lập; không worker nào sửa file của unit khác. Controller duy nhất sửa v2/server/src/app.ts để đăng ký route, v2/gateway/src/host/* để nối adapter, v2/pnpm-lock.yaml, v2/docs/flows.yaml và generated docs. Không sửa 005_execution.sql, phase02 contract, phase03 007 hoặc source v1 để né lỗi. Nếu implementation phase02/03 lệch hợp đồng đã đóng băng, ghi diff và review lại ở phase sở hữu trước khi đổi consumer phase04.

Hợp đồng phase01 giữ nguyên: Runtime='claude'|'codex'|'api'; eligibleModels(Model[],Selection) chỉ lọc, không xếp hạng. Khoá pool bền vững là (machineId,runtime,providerId,modelId), không chỉ Model.id; ánh xạ entry sang phase01 Model dùng id chuỗi canonical có escaping/version, kiểm uniqueness trong DB. Model.capabilities là tập capability đã **probe PASS** và còn fresh theo server receipt clock, không là lời tự khai. Phase06 lấy danh sách qua service này, lưu assessment/rationale trong decisions, không để phase04 tự quyết độ mạnh.

Hợp đồng phase03 chính xác: SourcePin={name,version,sourceRevision,sourceUrl,payloadSha256,packageIntegrity,sourceManifestSha256,sourceTreeSha256}; ProjectionPin={runtime,sourceTreeSha256,manifestSha256,treeSha256,derivation}. DesiredWorkflow có một source và ba slot projection độc lập. Domain Pin phase01/02 vẫn là toDomainPin(source) với checksum=sourceTreeSha256. DispatchSelection={runtime,sourceTreeSha256,projectionManifestSha256,projectionTreeSha256,installReportId,configRevision,decisionId} được phase06 lưu giống hệt ở commands.payload.selection và decisions.scope.selection **trước claim**. Phase03 gateway_attempt_projections lưu cặp source+chosen projection bất biến sau claim, GatewayProjectionPolicy mặc định SELECTION_NOT_CONFIGURED đến phase06. Adapter chỉ được khởi chạy sau companion POST được chấp nhận và Launcher.release gated; install report lịch sử là bằng chứng integrity, không là quyền dispatch mới. Cùng attempt/cặp pin được replay sau config đổi; attempt mới phải qua current policy. Server-authoritative source/projection hash đến từ accepted install report, không suy từ domain Pin một mình.

~~~
type Source = 'claude'|'codex'|'api';
type Capability = 'tools'|'vision'|'text'|'stream'|'file_pdf'|'file_docx'|'file_xlsx'|'file_csv';
type ModelKey = {machineId:Id; runtime:Source; providerId:string; modelId:string};
type ProbeContext = {sourceTreeSha256:string;projectionManifestSha256:string;
  projectionTreeSha256:string;derivationSha256:string;binarySha256:string;
  policySha256:string;osVersion:string};
type ProbeResult = {key:ModelKey; context:ProbeContext; observedAt:string;
  status:'pass'|'fail'|'unverified';
  capabilities:Capability[]; evidenceDigest:string; errorCode:string|null; runtimeVersion:string|null};
type PoolEntry = ModelKey & {source:SourcePin;projection:ProjectionPin|null;installReportId:Id|null;
  declared:Capability[]; probe:ProbeResult|null;probeReceiptId:Id|null;
  probeContextSha256:string|null;probeReceivedAt:string|null; probeExpiresAt:string|null;
  sourceDesired:boolean; sourceApplied:boolean; available:boolean; reason:string|null};
type ModelDispatchChoice = {model:ModelKey;modelConfigRevision:number;probeReceiptId:Id;
  probeContextSha256:string;certificationReceiptId:Id|null;required:Capability[]};
type ModelReportEnvelope<T> = {reportId:Id;bootId:Id;bootGeneration:string;
  sequence:string;configRevision:number;body:T};
type ModelInventoryBody = {entries:ProbeResult[]};
type ModelAppliedBody = {inventoryReportId:Id;sourceStatus:Record<Source,
  {state:'disabled'|'ready'|'error';errorCode:string|null}>;observationDigest:string};
type CertificationChallenge = {id:Id;nonce:string;machineId:Id;projectId:Id;
  sourceTreeSha256:string;projectionManifestSha256:string;projectionTreeSha256:string;
  derivationSha256:string;binarySha256:string;policySha256:string;osVersion:string;
  expiresAt:string;maxTurns:number;maxTools:number;maxCostUsd:number};
type CertificationEvidence = {challengeId:Id;attemptId:Id;fence:string;
  processInstanceId:Id;context:ProbeContext;surfaceResults:{surface:string;
  selectedWorked:boolean;unselectedDenied:boolean;traceSha256:string}[];
  artifactIds:Id[];traceSha256:string};
type RuntimeAdmission = {kind:'certified';receiptId:Id} |
  {kind:'test-certification';challengeId:Id;nonce:string};
type DispatchEnvelope = {commandId:Id;priorAttemptId:Id;permit:DispatchPermit;
  selection:DispatchSelection;modelChoice:ModelDispatchChoice;decisionId:Id};
type CredentialKeyRegistration = {keyId:Id;publicKeyX25519:string};
type CredentialKeyConfirmation = {challengeId:Id;challengeSha256:string};
type SecretEnvelope = {id:Id;machineId:Id;providerId:Id;keyId:Id;
  configRevision:number;operationId:Id;expiresAt:string;
  ephemeralPublicKey:string;nonce:string;ciphertext:string;tag:string;
  ciphertextSha256:string};
type SecretAck = {operationId:Id;keyId:Id;ciphertextSha256:string;credentialRef:string};
type RuntimePin = {runId:Id; attemptId:Id; commandId:Id; processInstanceId:Id; fence:string;
  source:SourcePin; projection:ProjectionPin; attemptProjection:AttemptProjectionPin;
  selection:DispatchSelection; modelChoice:ModelDispatchChoice;admission:RuntimeAdmission;
  isolationPolicyHash:string; workspaceCommit:string; credentialRef:string|null};
type RuntimeCheckpoint = {sequence:string; step:string; artifactIds:Id[]; commit:string|null;
  processInstanceId:string; sourceTreeSha256:string; projectionTreeSha256:string;
  toolReceiptIds:Id[];logicalEffectIds:Id[];attachmentIds:Id[];
  runtimeSession:{runtime:Source;id:string}|null};
type LogicalEffect = {effectId:Id;runId:Id;stepId:Id;stepOperationId:Id;
  actionKind:string;targetIdentity:string;preconditionSha256:string;
  state:'pending'|'done'|'uncertain';receiptSha256:string|null;artifactIds:Id[]};
type ToolInvocation = {attemptId:Id;fence:string;toolCallId:string;argsSha256:string;
  effectId:Id;stepOperationId:Id};
interface EffectLedger {
  reserve(effect:LogicalEffect,call:ToolInvocation):Promise<'execute'|'return-receipt'|'reconcile'|'wait'>;
  complete(effectId:Id,call:ToolInvocation,receipt:{sha256:string;artifactIds:Id[]}):Promise<void>;
  reconcile(effectId:Id):Promise<'done'|'pending'|'uncertain'>;
}
interface RuntimeAdapter {
  readonly runtime:Source;
  inventory(source:SourcePin,projection:ProjectionPin):Promise<ProbeResult[]>;
  prepareIsolation(pin:RuntimePin):Promise<{policyHash:string; evidenceDigest:string; certified:boolean}>;
  start(pin:RuntimePin, input:{skillName:string;skillPath:string;checkpoint:RuntimeCheckpoint|null}):Promise<{sessionId:string; processIdentity:string}>;
  sendInput(pin:RuntimePin, input:{text:string;attachmentIds:Id[]}):Promise<void>;
  checkpoint(pin:RuntimePin):Promise<RuntimeCheckpoint>;
  cancel(pin:RuntimePin,reason:'pause'|'cancel'|'timeout'):Promise<{requested:boolean;stopped:boolean}>;
  reconcile(pin:RuntimePin):Promise<{observation:'running'|'stopped'|'unknown';checkpoint:RuntimeCheckpoint|null}>;
}
~~~

Adapter không tự cấp DispatchPermit, thả phase02 guard hoặc khởi động trước claim. Phase03 ProcessJournal.reserve({commandId,ticketId,processInstanceId,source,projection}), Launcher.spawnGated/claim/companion/Launcher.release, durable HttpOperationJournal và phase02 checkpoint/result/finalize vẫn là authority. Phase03 journal fsync source+projection trước dormant spawn; phase04 chỉ thêm immutable RuntimePin/model/cert companion record gắn cùng launch UUID trước RELEASE, không đổi phase03 journal record hay migration005/007. credentialRef là tham chiếu Keychain, không phải secret. Phase02 DispatchPermit đã đóng băng và không có model key: phase06 giữ exact DispatchSelection phase03 trong payload/scope.selection, đồng thời ghi ModelDispatchChoice giống hệt vào payload/scope.modelChoice trước claim. AuthorizeDispatch dùng permit.commandId/decisionId đọc và so khớp **cả hai** trong cùng transaction claim, gọi assertModelDispatch; GatewayProjectionPolicy phase03 chỉ kiểm selection source/projection/attempt theo contract của nó. Không gắn model choice vào client companion request hoặc đổi DispatchSelection/005.

ProbeContext hash là SHA-256 của canonical JSON theo thứ tự field ở trên, hex lowercase, với derivationSha256 là hash của canonical ProjectionPin.derivation; binarySha256 là byte hash executable/adapter thực, không là version string. Server lưu cả object lẫn context hash trong receipt bất biến và so context của receipt, current observed binary, selected projection, certificate, modelChoice trong cùng claim. ModelReportEnvelope dùng **một** sequence tăng đơn điệu cho inventory và applied của mỗi boot phase03; reportId/boot/sequence/body hash đã commit replay response cũ trước mọi mutation, không gia hạn TTL. Report mới chỉ từ current gateway_boots generation dưới machine row lock và sequence lớn hơn lần cuối; older/out-of-order 409. Không mở boot protocol thứ hai.

## Task 2: Inventory, credential broker và capability probe

**Files:** unit 2. **Consumes:** machine GET SourceConfig, phase03 boot generation/HttpOperationJournal, DesiredWorkflow/WorkflowStatus/SourcePin/ProjectionPin và host IPC. **Produces:** collectInventory(config,workflows:Record<Workflow,WorkflowStatus>):Promise<ProbeResult[]>; probeModel(modelKey,pair:{source:SourcePin,projection:ProjectionPin},mode:'offline'|'authorized-live'):Promise<ProbeResult>; ModelReporter.sendInventory(body:ModelInventoryBody):Promise<Id>; ModelReporter.sendApplied(body:ModelAppliedBody):Promise<Id>; CredentialBroker.put(providerId,secret):Promise<credentialRef>, withSecret(ref,callback):Promise<void>, remove(ref):Promise<void>. ModelReporter tạo ModelReportEnvelope bằng bootId/bootGeneration hiện hành và một sequence bền vững tăng qua inventory/applied, gửi qua HttpOperationJournal exact key/body. withSecret không trả secret ra caller API/UI, chỉ cấp cho transport process/broker đã ghim.

- [ ] RED fake transports: Claude/Codex CLI absent→UNVERIFIED, binary version hoặc selected projection derivation/hash đổi→hết hạn certificate/probe; Codex model/list là catalogue, không là entitlement; Claude model list/inventory không suy quota; API owner model list giữ nguyên dù /models liệt kê khác. Probe offline kiểm protocol shape, tool-result correlation, stream framing, timeout/abort; probe live có giới hạn một model call riêng theo authorization, kiểm text+tool execution+image fixture nếu declared vision; trả PASS theo từng capability, không suy file_pdf/docx/xlsx/csv từ vision. Verified derivative từ phase05 được tiêu thụ đầy đủ thì yêu cầu model chuyển thành text/vision tương ứng với derivative; không bắt model hỗ trợ MIME native khi đã có extraction/OCR có provenance. 401→AUTH, 429/quota→QUOTA, 5xx/network→TRANSIENT, malformed tool→TOOL_PROTOCOL, unsupported image→VISION_UNSUPPORTED, không leak body/key. Host clock nhảy tới tương lai không gia hạn probe; server receipt TTL hết hạn thì unavailable.
- [ ] RED Keychain tests: fake Security bridge nhận generic password service scoped v2/machine/provider, update/remove idempotent; gateway DB chỉ credentialRef; secret không trong argv/env dài hạn, stdout, telemetry, exception, journal, HTTP response hay test snapshot. Broker cấp credential cho runtime qua one-use channel/FD; nếu Claude/Codex CLI subscription cần credential discovery riêng, phải chứng minh path được hỗ trợ với home cô lập; không copy toàn bộ owner home hoặc token.
- [ ] RED host report/secret tests: reconnect lấy machine GET desired revision trước khi probe, source OFF không gửi model mới vào pool; boot B report AUTH sau boot A PASS thắng, host journal không cấp trùng sequence sau restart và replay reportId cũ không đổi TTL. Broker tạo X25519 private key trong test-owned Keychain namespace, đăng ký public key/giải challenge, chỉ nhận own pending envelopes; ghi secret theo envelope ID rồi đọc lại trước ACK. Crash/lost ACK sau Keychain write replay cùng operation/body; wrong AAD/key/config/expiry và key loss không ACK, UI trạng thái credential pending.
- [ ] Run: pnpm --dir v2/gateway test --test-name-pattern='model probe|credential broker'; expected RED.
- [ ] GREEN Keychain adapter dùng Security.framework generic password; test mặc định fake Security bridge trong unsigned dev, còn ACL theo app/helper đã ký là gate phase09, không tuyên bố đã kiểm bằng fake. Gateway tạo X25519 keypair theo machine trong Keychain, POST public key và confirm encrypted challenge như Task1; private key không ra server/renderer/model child. ModelReporter dùng desired machine GET và boot/operation journals phase03, gán reportId/sequence trước HTTP, không lấy revision từ owner session. SecretEnvelope nhận từ own machine GET, kiểm metadata/AAD/ciphertext digest, expiry và current config revision; Keychain put/read-back idempotent theo envelope ID/provider, fsync ACK operation rồi gọi ACK route. Lost ACK replay exact body/key; key loss/expired/stale envelope giữ pending, báo owner cấp lại, không tự nhận đã lưu. Local provider token lưu cùng broker; CLI subscription isolated-home auth phải được thử thật, không suy từ fake Keychain.
- [ ] GREEN protocol probe: Responses và Chat Completions parser riêng, enforce exact provider/model, bounded response bytes, request deadline và idle deadline, Retry-After/backoff; capability record kèm host observedAt/evidence digest, server tự gán receipt/expiry bounded như Task1. Probe không chạy phí mặc định; live dùng cấu hình test được ủy quyền và giới hạn call/cost. Catalogue refreshed on config/binary/projection change, auth/quota event, expiry và explicit probe; available đòi model source ON + applied revision, exact workflow source+chosen projection đã applied, isolation certified cho pair và fresh PASS requirements.
- [ ] Re-run focused tests/typecheck; ghi trong gateway-models.md cách sửa AUTH/QUOTA, expiry và secret flow. Security review secret lifetime, SSRF và auth path.


## Controller handoff — prepared, not dispatched

Producer gate: Task1 migration008/models/report+crypto routes must have independent spec and quality READY first. Compare actual reviewed exports, wire DTOs, authentication and receipt authority before implementing; do not infer source equivalence from plan prose. Phase03 Tasks1/2/3 are reviewed; registry Task4 fix is active. Inventory/probe consumes exact frozen SourcePin/ProjectionPin; no registry/process/host source edits. If reviewed registry/status producer is still unavailable, keep that dependent consumer unavailable and report exact mismatch; do not fabricate applied state.

Ownership: gateway/src/models/{inventory,probe,credential-broker}.ts and necessary own model-reporter, native Security bridge/support files; gateway/test/{model-probe,credential-broker}.test.ts, own fixtures/support, v2/docs/flows/gateway-models.md. New helpers require explicit inventory in report and mapping by PM. No modification of host composition, runtime unit, server, source v1, package/lock, manifest/generated indexes, or frozen journals/types. Additional dependency proposal goes to PM before install. No worker-spawned subagents; you are not alone and must preserve peers' changes.

No paid calls, real owner credential/Keychain/global-home mutation, subscription auth copying, real install/enable. The actual Security.framework adapter must exist and be testable under a fake injected bridge; unsigned fake protocol tests do not prove production ACL. If isolated CLI auth discovery is unmeasured, remain UNVERIFIED. Offline shape tests cannot grant PASS capabilities or runtime certificates. Secret bytes must never enter local generic HTTP journal; journal only encrypted envelope/ACK metadata and credentialRef.

RuntimePin/selection/certification authority stays with actual server and later04/06. Shared boot identity comes from reviewed007; model inventory/applied use a dedicated durable monotonic sequence shared by those two kinds (not second boot protocol, not UUID ordering). Desired revision GET before reconnect work; every report replay uses exact stored ID/key/body and never changes server expiry. Server-authoritative time for envelope expiry is required; do not trust host future clock.

SSRF/crypto context MUST match actual reviewed008 contract and endpoint normalization exactly. Native Security bridge handles generic-password operations without secret argv, long-lived env, output/logs. One-use secret FD callback restricted to trusted transport; cannot leak value through callback result or error. X25519 keys/rotation pending envelopes are durable in owned namespace and never renderer/model child. Key loss is pending/re-entry, not success.

Meaningful RED/GREEN for own tests; one covering gateway test/typecheck/Biome after final change; focused repeats only following changes/failures. Exact-owned resource cleanup with receipts, no global delta cleanup. Freeze own source inventory and report commands/exit counts/SHA/evidence/unsupported live surfaces. Controller integrates docs/Git, then independent spec+quality review. Max five semantic fix rounds, infrastructure fallback does not reset count.

## Actual producer FIX1 handoff — dispatch still review-gated

Candidate d249a82,008 SHA d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f. Read actual server-models flow + contracts/routes/commands/secret-envelopes, not plan-only guessed paths. Pending scoped review task-1-re-review.md; this section alone is NOT permission to start.

Current provisioning operation is durable server-accepted order, not envelope cursor/UUID/time. Current provider pending may detach prior ref; historical ACK/loss remains per-operation receipt and must not overwrite newer current ref. Host must use exact envelope operation/key/digest and immutable ACK intent, not substitute latest provider state under old key. Key-loss retires only lost key and invalidates its pending envelopes; already ACK-stored secret is distinct. Normal rotation of retired-but-held key can finish pending; loss cannot. Old confirmation replay must not reactivate lost key.

Actual source config/report boot authority is reviewed007 plus008 dedicated model sequence and typed model command adapter (GET model-commands includes prior3types; ACK endpoint onlysync_models). Model reporter must not duplicate consumption of workflow007 commands; persist its own model report sequence and actual operation IDs under reviewed journal. GET desired before reconnect, exact current boot generation, no fabricated applied report or ready capability. Server receipt clock/TTL governs availability, observedAt cannot extend it.

Offline protocol evidence remains UNVERIFIED; no live calls, owner keychain/private keys, remote install or paid probes in this dispatch. Genuine Security.framework adapter code may use fake bridge to test unsigned dev; real signed ACL gates09. Source OFF blocks fresh admissions, does not falsely finalize old turn. Registry bind authority FIX2 remains pending03 review: this task owns no ProcessJournal/registry/host composition edits, no source-diff race with Task4.
