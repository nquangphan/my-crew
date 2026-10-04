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


## Handoff phase06 và authority

Phase06 sở hữu assessment độ khó/rủi ro/thiếu thông tin, xếp hạng candidate theo khả năng thực tế và chi phí/sức mạnh phù hợp ticket, lưu rationale và SourceRef; không hard-code hãng/model cho role. Trước claim, nó ghi exact DispatchSelection phase03 vào command.payload.selection/decisions.scope.selection, ModelDispatchChoice vào payload/scope.modelChoice và priorAttemptId vào payload/scope; các bản phải khớp, kèm DispatchPermit khớp command/decision. Nó phát stepOperationId ổn định per logical tool operation trong step để phase04 giữ effectId qua fallback; không phát ID thì effectful tool phải wait. Phase06 implement AuthorizeDispatch transactionally: machine binding, ticket/dependency, toDomainPin(SourcePin), current desired/applied SourcePin + chosen ProjectionPin + fully applied installReportId, model source ON/current applied revision, server-fresh capability probe + pair isolation certificate, runtime/model key, telemetry mới trước **mỗi** implement/review/fix, ownership/concurrency và permit expiry. Nó cũng cung cấp GatewayProjectionPolicy fail-closed phase03, chỉ đọc selection server-stored của attempt đã claim, không dùng report lịch sử làm quyền mới. Phase04 assertModelDispatch là một thành phần gate, không cấp permit. Trợ lý riêng nếu model source đang chọn OFF hoàn tất lượt hiện tại, sau đó phase06 chọn nguồn còn bật cùng máy hoặc wait; không chạy đồng thời hai Trợ lý. Event/five-minute monitor và backoff scheduling cũng phase06; phase07 web hiển thị switches/catalogue/pending reason, phase05 extractor/attachment, phase08 merge evidence, phase09 packaged helper/signing/deploy.

## Sources và giới hạn nghiên cứu

- [Claude Agent SDK skills](https://code.claude.com/docs/en/agent-sdk/skills): settingSources, skills allowlist, init inventory; allowlist không bảo vệ Read/Bash/slash command.
- [Claude sessions](https://code.claude.com/docs/en/agent-sdk/sessions): resume cục bộ cùng runtime; checkpoint ứng dụng vẫn cần riêng.
- [Codex app-server](https://learn.chatgpt.com/docs/app-server): model/list/skills/list, thread/start/resume, turn/start/completed; catalog không chứng nhận entitlement.
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses), [vision](https://developers.openai.com/api/docs/guides/images-vision), [API errors](https://developers.openai.com/api/docs/guides/error-codes): đây là chuẩn tham chiếu; endpoint tương thích cần probe riêng.
- [Apple Keychain Services](https://developer.apple.com/documentation/security/keychain-services) và [generic password](https://developer.apple.com/documentation/security/adding-a-password-to-the-keychain): secret local; ACL/signing của helper phải đo trên bản phân phối phase09.

## Self-review trước handoff

- [ ] Mọi yêu cầu spec mục 4 có Task1/2/5/6/7, mục 5 có Task3/4/5/7, mục 7 có Task6/7; phase05/06/07/08/09 authority được ghi rõ.
- [ ] Năm Review Focus đều có RED tương ứng; không có trạng thái PASS dựng từ inventory hay fake test.
- [ ] RuntimeAdapter, RuntimePin, ModelKey, Checkpoint dùng cùng field/signature ở các task; exact SourcePin+ProjectionPin+DispatchSelection/AttemptProjectionPin theo phase03, domain Pin/005/finalizing/guard không bị thay nghĩa.
- [ ] Không có nguồn secret trong catalogue, transcript, journal, argv/env dài hạn hoặc web GET; API model list owner explicit.
- [ ] Nếu native Read/child/tool isolation không đạt, chỉ giữ adapter UNVERIFIED và báo blocker + phương án OS-principal/VM đã đo; không hạ tiêu chuẩn.

## Reviewed addendum — Superpowers Codex native artifact (2026-10-02)

Independent contract review READY: execution-phase03/superpowers-codex-native-recipe-review.md; primary/static evidence and proposal are in the adjacent native-skills research and native-recipe proposal. Task4 may implement a Crew-audited native projection of exact official Superpowers6.4.2 source. This is a standalone artifact recipe, not an upstream-recommended native installer or official marketplace package receipt. Existing marketplace gate (missing immutable6.4.2package/15th metadata) remains separate.

Producer layoutSchema=superpowers-codex-native-skills-v1: preserve full upstream tree byte/mode unchanged; upstream already contains .agents directory/marketplace manifest, so add only missing .agents/skills directory and15 internal relative links <name> -> ../../skills/<name>. No duplicate parent directory, overwrite, frontmatter/YAML/name/instruction/role/hook rewrite. Bind mapping/all15 entrypoints/ancillary geometry/executable allowlist/bootstrap/namespace/protocol provenance in audited derivation policy. Two builds in distinct owned roots must produce identical actual canonical tree/manifest pins and re-resolve each link to same selected immutable projection; no publish on collision/hash/mode/path mismatch. SourcePin/ProjectionPin/005/007 unchanged. Actual runtime remains UNVERIFIED.

Task6/7 and Phase04 consumer layout is fixed, with no silent fallback: selected immutable projection P is outside the attempt project CWD and all its ancestors (separate sibling under owned run root). Own scratch project .agents/skills is a directory symlink to P/.agents/skills, preserving original P link resolution and sibling resources; do not transplant15 relative links into scratch root. Resolve from the actual discovery path and certify all15 canonical targets and scripts/resource paths under P. If this fixed discovery view is unsupported, keep pair unavailable and review a new layout before modifying it. P root AGENTS.md, marketplace/harness manifests, Claude hooks are provenance bytes only; no automatic instruction/plugin/hook registration from P. Probe those surfaces explicitly, including explicit skill-path instruction discovery. No copy of full P to project root or use of P as CWD/ancestor.

Exactly15 refers to selected workflow inventory. Any additional bundled/admin/user/system/plugin source must be denied or separately enumerated in an audited required-system allowlist with provenance/certificate; do not hide entries to claim15. Owned HOME/discovery inventory is not OS proof. Actual CLI0.159.3 schema supports cwds/forceReload only; no undocumented perCwdExtraUserRoots. First work turn requires original $using-superpowers plus exact verified native skill item type/name/path, original Codex reference, actual trace of bootstrap-before-work and original SUBAGENT-STOP context. Namespaced superpowers:* cross-skill transitions, tool availability, scripts/interpreters/cwd, nativeRead/Bash/MCP/child/SDD, reconnect/reload/compaction and immutable pin inheritance must be measured. No alias router or source rewrite to bypass mismatch.

No-model artifact/discovery checks and fake integration cannot certify native runtime. Genuine Phase04 positive selected + negative unauthorized-source load/invoke evidence on exact binary/OS/policy/source/projection and complete process tree remains mandatory; missing surfaces retain UNVERIFIED/unavailable. No model/live/signing/UI/deploy approval follows from this addendum.
