# Phase00-02 — Findings tận dụng v2

Ngày kiểm tra: 05/10/2026, Asia/Saigon. Worker `v3_reuse`; khảo sát đọc source. Ownership chỉ file này và `implementation-map.md`; không sửa ledger, source, manifest hoặc branch.

Source checkout: `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`, full HEAD `51907858d0c8cdb7329759f22104f0727dbe6751`, đã đọc trực tiếp. `.codegraph/` không tồn tại; dùng tìm kiếm theo thư mục/file. Đã đọc root `docs/index.md`, flow docs-check, `v2/docs/index.md` và flow domain/gateway/desktop/workflow/runtime/model/assistant/docs/attachment/web tương ứng. Root manifest chỉ phủ apps/packages; v2 có manifest riêng `v2/docs/flows.yaml`.

Verdict: giữ logic đã có, đổi connection/identity/authority. Không sao chép scheduler hoặc execution DB chain thành authority thứ hai. Test dưới đây có source; **chưa chạy trên v3**. Đường dẫn đích và adapter signature chờ review00-01/core baseline.

## Gap xác minh trực tiếp

- `v2/server/src/main.ts:10` chỉ cấp DB/origin/cookie/key/time cho `buildApp`; không cấp attachment/runtime/assistant assembly. `v2/server/src/app.ts:92` export `buildApp` (composition comment ở91), default `denyDispatch`/`denyFinalResult` ở95–96; optional `AttachmentAssembly`, không import/mount assistant route.
- `v2/gateway/src/host/gateway-host.ts:13` có `GatewayHost`; imports chỉ IPC/lock/status và Node, chưa nối sync/broker/workflow/runtime. Host khởi động được không chứng minh remote execution.
- `v2/server/src/assistant/tools.ts:270–279` còn `TOOL_NOT_RELEASED`;404 còn `ASSISTANT_TOOLS_NOT_CONFIGURED`. Orchestration port không chứng minh driver/admission/dispatch/monitor T4–T7 hoàn thiện.
- `v2/gateway/src/isolation/preflight.ts:432–434` export legacy `preflightSourceIsolation(...): Promise<never>` luôn throw `ISOLATION_NOT_BOUND`. Factory `createIsolationPreflight` ở53 có implementation; không dùng stub legacy làm capability.
- `v2/gateway/src/runtime/contracts.ts:14–16` còn nhánh `test-certification`; `RuntimeAdapter` ở76 là interface. Interface/test transport không chứng nhận native Claude/Codex/API loop. Flow gateway-runtime còn ghi SIGKILL giữa logical effect/receipt pending.
- Gateway **đã có** prerequisites hook (`sync/gateway-sync.ts:59–63,241–243`) và `beforeRelease` (`execution/ticket-command-bridge.ts:61,279`). Gap là nối/bật cùng server receipt/prerequisite witness/latch/reconcile, không phải thiếu gateway hook. `reclaimRenderStage` (`assistant/render-executor.ts:587`) dọn qua helper, không thay reconcile server. Integration uv thật vẫn pending.

## Inventory source, implementation export và test

Tất cả path dưới đây tương đối source checkout pinned. Symbol có line refs được đọc trực tiếp source; supporting files/test path đã thấy qua inventory source. Đây là các seam đại diện đủ định hướng port, không phải full security audit từng file.

Mức kiểm: đã đọc toàn bộ bốn policy và test model/completion; source entrypoints/app/host và các representative imports/exports của journal, resources, capacity, sync/bridge, registry, isolation preflight, manifest/render, credential broker, runtime contracts/effect ledger, assistant authority/gates/hash/tools, docs validator/manifest/links/checksum, extractor index, graph layout/state. Supporting files khác trong từng nhóm chỉ kiểm path và flow/manifest dependency; **chưa đọc implementation đầy đủ**. Native helper, toàn parser formats, mọi UI component, SQL migrations và cả hai ledger deferred chưa audit sâu. Không suy luận category hoàn thiện từ representative export.

| ID / capability | Source implementation/export | Regression tồn tại | Dependency và verdict |
|---|---|---|---|
| P1 policy | `v2/src/model-policy.ts:16` eligibleModels; `workflow-policy.ts:3,11,18` samePin/workflowsReady/assertSkillAllowed; `ticket-policy.ts:12,42` transition/recordRepairFailure; `completion-policy.ts:9,16` canComplete/canDeploy | `v2/test/{model-policy,workflow-policy,ticket-policy,completion-policy,workspace}.test.ts` | Không import/runtime dependency. Giữ predicate và repair cap; lifecycle graph dùng core. |
| G1 host/desktop | `v2/gateway/src/host/{gateway-host,process-lock,status}.ts`, `ipc/server.ts`; `v2/desktop/src/main/{index,client,security}.ts` | `v2/gateway/test/{host-lifecycle,host-failures}.test.ts`; `v2/desktop/test/{shell,electron-lifecycle}.test.ts` | Node filesystem/process/socket + native lock; desktop Electron/preload sender policy. Port host ownership và IPC, thay config/dashboard/runtime assembly. |
| G2 journal/resources | `v2/gateway/src/journal/{atomic-records,process-journal,http-operations,native}.ts`; ProcessJournal:95, Launcher:454; `resources/registry.ts:51` ResourceRegistry | `v2/gateway/test/{journal,execution-crash,resources,http-operations,stop-control}.test.ts` | AtomicRecords/native identity→journal→resource cleanup. Port durable identity/replay/cleanup; thay binding ticket/attempt/fence/command bằng core run + grant. |
| G2 capacity | `v2/gateway/src/telemetry/{capacity,macos-provider}.ts`; DispatchCapacity:32 | `v2/gateway/test/telemetry.test.ts` | Capacity không import; monotonic/wall-clock freshness, ownershipKeys, limits. Local decision không là scheduler authority. |
| G3 delivery/STOP | `v2/gateway/src/sync/{connection,event-pump,gateway-sync}.ts`; GatewaySync:69; `commands/{contracts,http-client}.ts`; `execution/ticket-command-bridge.ts:63` TicketCommandBridge | `v2/gateway/test/{connection,event-pump,sync,execution-bridge,execution-bridge-db}.test.ts` | HTTP journal + workflow/process registry, Crew `/v2` DTOs. Port ACK/replay/no-duplicate logic; thay transport/identity/lease authority, không giữ scheduler riêng. |
| W1 registry | `v2/gateway/src/workflows/{fetch,stage,pins,registry,retention,native-projection,operations,builder}.ts`; WorkflowRegistry:98 | `v2/gateway/test/{workflow-registry,workflow-build,workflow-operations,pin-retirement,retirement-crash}.test.ts` | tar-stream, atomic/process journal, builder/native projection. Port checksum/stage/ref/retention, audit nguồn chính thức ở exact candidate. |
| W1 isolation | `v2/gateway/src/isolation/{workspace,policy,inventory,preflight}.ts`; createIsolationPreflight:53 | `v2/gateway/test/{isolation,isolation-workspace,isolation-runtime,isolation-render}.test.ts` | Pin/workspace/fs inventory/audit; entry/tool sources upstream cũng phải audit. Native confinement chưa được chứng nhận từ fixtures. |
| W2 definition/render | `v2/gateway/src/assistant/{workflow-manifest,render-executor,render-artifacts}.ts`; createWorkflowManifest:226; createRenderExecutor:619; probeRenderPrerequisites:1058 | `v2/gateway/test/{workflow-manifest,render-executor,render-artifacts}.test.ts` | WorkflowRegistry/pins/stage, AtomicRecords/OwnedOperations, uv/Python process identity. Port definition/provenance; xây server receipt/latch/reconcile và nối beforeRelease. |
| M1 models | `v2/gateway/src/models/{inventory,probe,credential-broker,current-credential-resolver,provider-transport,security-bridge,credential-provisioning,model-reporter}.ts`; CredentialBroker:7 | `v2/gateway/test/{model-probe,credential-broker,current-credential-resolver,credential-provisioning,model-reporter}.test.ts` | Crypto/streams + local Security bridge, config pin/probe/catalogue/report DTO. Port local secret boundary; thay core transport/auth. Broker test fake Security không cert signed Keychain ACL/provider live. |
| R1 runtime | `v2/gateway/src/runtime/{contracts,launch,tool-policy,isolation,effect-ledger}.ts`; deriveEffectId:18, DurableEffectLedger:68 | `v2/gateway/test/{runtime-boundary,runtime-crash,runtime-workspace,effect-ledger}.test.ts` | Pin binds run/attempt/command/fence/model/certificate/workspace; effect ledger uses AtomicRecords. Port logical effect identity/receipt, replace attempt chain; native launcher/API loop/fallback mới hoặc chưa hoàn thiện. |
| A1 assistant | `v2/server/src/assistant/{contracts,authority,gates,operation-request,orchestration,tools,runs,workflows}.ts`; createPersistedAssistantActorResolver:124; createWorkflowGates:407; operationRequestSha256:35; `v2/gateway/src/assistant/tool-client.ts` | `v2/server/test/{assistant-authority,assistant-workflows,assistant-orchestration-port,assistant-tools-route,assistant-mutations}.test.ts`; `v2/gateway/test/{assistant-tool-client,assistant-tool-client-route}.test.ts` | SQL Actor/Tx/Id/config/fence/store, ticket assistant-access/decisions, docs/project reads, canonical hash. Giữ schema/predicate/hash/negative authorization, thay repositories/routes/actor resolver; driver/admission/monitor không gọi là đã giữ. |
| D1 docs standards | `packages/docs-kit/src/{cli,manifest,tree,generate}.ts`, `rules/r1-manifest.ts`…`r7-secrets.ts`; `v2/server/src/docs/{validator,manifest,links,checksum,contracts}.ts`; validateDocs:58; parseManifest:91; auditLinks:84; snapshotHash:18 | `packages/docs-kit/test/rules.test.ts`; `v2/server/test/{docs-validator,docs-import-cli}.unit.test.ts` | CLI uses @crew/shared/YAML/picomatch/Git; v2 parser YAML/picomatch; checksum imports journal/canonical. Giữ byte/structural validation, R2/R3 freshness; semantic/merged-result review thêm mới. |
| D2 docs read/import | `v2/server/src/docs/{import,read,search,routes}.ts` | `v2/server/test/{docs-import,docs-read}.test.ts`, `docs-events.unit.test.ts` | Pool/Tx/auth/event/canonical + migration006 snapshot/receipt SQL. Port byte/snapshot/checksum/trust/search semantics; đổi namespace/repository/core ACL, graph/dedup là mới. |
| F1 files R2 | `v2/server/src/attachments/extract/{index,formats,zip,xml,text,csv,image,pdf,docx,xlsx,verify}.ts`; extractAttachment:165, extractToFrames:202; `attachments/{worker-protocol,worker-runner,worker-diagnostic}.ts` | `v2/server/test/{attachments-formats,attachments-text-csv,attachments-pdf-image,attachments-ooxml}.unit.test.ts`; `{attachments-worker,attachments-worker-live}.test.ts`; `test/fixtures/attachments/{make-fixtures.ts,README.md}` | config/attachment IDs/storage/jobs/leases + pdfjs/canvas/yauzl/saxes. Port bounded parsers/provenance/corpus; replace storage/core ACL/job binding, certification và input/checkpoint/file E2E pending. |
| U1 graph/ticket UI | `v2/web/src/graph/{layout,project,state,ticket-map,ticket-map-route,ticket-node,ticket-edge}.ts*`; layoutHierarchy:38; chooseRealtimeAnchor:147; `tickets/{dialog,detail,list,board,create-request}.tsx` | `v2/web/test/{graph,graph-state,ticket-detail-dom}.test.ts`; `web/e2e/{ticket-map,tickets,ticket-routes}.spec.ts` | React/XYFlow/Radix, ticket/graph DTO, pending-operation/query/router. Port layout/view/dialog interactions; core board/list shell ưu tiên upstream, không làm hệ song song. |
| U2 composer/docs/machine UI | `v2/web/src/compose/{state,controller,file-hash}.ts`, `composer.tsx`; `docs/{links,queries}.ts`, `{space,page,search}.tsx`; `machines/{onboarding-state.ts,onboarding.tsx}` | `v2/web/test/{compose,compose-submit,docs-links,onboarding}.test.ts`; `web/e2e/{compose,docs-assistant,onboarding}.spec.ts` | Query/auth/router/attachment/docs/machine DTO + hash worker. R1 docs/onboarding cơ bản; R2 composer/files đầy đủ. Giữ UX/evidence scenarios, đổi routes/token/core ID/theme và pending-key namespace. |

## Manifest/toolchain thật

Không package v2/domain/gateway/server/web/desktop nào khai báo package `exports` trong manifest đã đọc; exports nằm trực tiếp file, không giả barrel. `v2/src/index.ts` không tồn tại. Docs-kit công bố CLI bin `dist/crew-docs.cjs`.

| Manifest | Dependencies/test setup đã đọc |
|---|---|
| `v2/package.json` | No runtime dependencies; Node>=24.12, TS7.0.2, pnpm10.32.1; node:test `test/*.test.ts`. |
| `v2/gateway/package.json` | tar-stream3.1.7; test build trước node:test; native/macOS helper fixtures. |
| `v2/desktop/package.json` | Electron44.5.1 dev dependency; test build gateway+desktop trước node:test; GUI lifecycle macOS. |
| `v2/server/package.json` | Fastify5.12.5, postgres3.4.9, YAML2.9.1, picomatch4.0.7, pdfjs-dist6.3.289, @napi-rs/canvas1.0.3, yauzl3.4.0, saxes6.0.0; DB runner `scripts/test-db.ts`, unit script riêng. |
| `v2/web/package.json` | React19.3.0, Router1.170.41, Query5.104.1, XYFlow12.12.0, Radix1.1.23, Markdown10.1.0; Playwright1.63.0, RTL16.3.3/jsdom30.1.1. |
| `packages/docs-kit/package.json` | @crew/shared workspace, YAML/picomatch; esbuild CJS CLI, vitest tests. Tách manifest schema nếu fork không có @crew/shared. |

Không ép version này lên upstream trước baseline. Manifest khai báo dependencies không chứng minh đã install/typecheck GREEN.

## Backlog lịch sử phải giữ và đối chiếu

Nguồn đã đọc: `plans/reports/handover-261004-1435-crew-v2-pm-checkpoint.md`, gồm cập nhật21:40; audit `plans/reports/audit-261005-2148-crew-paperclip-readiness.md` ở primary. Executor cần triage từng finding trong `plans/261002-0002-crew-v2/execution-phase06/progress.md` và `execution-phase07/pm-ledger.md` trước port; chưa audit toàn bộ hai ledger lượt này.

- S6b-iii server receipt/route/latch, witness gateway_applied/prerequisite schema, beforeRelease assembly, reconcile unknown render stage; S6b-iv uv integration thật.
- Assistant T4 assessment/admission, T5–T7 driver/dispatch/monitor/assembly; web S6assistant/G3, S7full, Task8/G5/G6, A3/A5 có file chờ extractor certification.
- Triage minor deferred: composer C1–C3/D1–D4, S3b N1–N5, checklist S6b/T7. Không tự coi finding lịch sử đã fix hoặc hiện vẫn lỗi nếu chưa trace candidate.
- Native/source confinement, Keychain signed helper/ACL, CLI auth, API loop/fallback, logical effect SIGKILL uncertainty, corpus/boundary certification, signed installer/updater/restore.
- Audit trước ghi historical domain14/14 và typecheck, server missing parser dependencies/type errors, web missing RTL; **không chạy lại** và không kế thừa PASS cho v3.

## Candidate pure-policy đầu tiên

Chọn `eligibleModels(models: Model[], policy: Selection): Model[]`, `samePin/workflowsReady/assertSkillAllowed` và `canComplete/canDeploy`: no runtime dependencies, tests độc lập. Giữ `recordRepairFailure` như predicate riêng; state graph v2 dùng làm regression requirements, không authority thứ hai.

Wrapper đọc machine/project/model revisions và approval từ core+namespace Crew; client không cấp bool authority. Negative tests giữ: cross-machine, source OFF/config mismatch, missing tools/vision, duplicate/missing workflow target, pin mismatch, stale merged/docs commit, missing approval. Integration mới phải chứng minh direct core mutation/spawn không vượt gate. Runtime enum claude/codex/api không là tier/quota/price registry.

Sau policy: docs validate/manifest/link/checksum (kèm contracts/canonicalJson), rồi DispatchCapacity/telemetry/AtomicRecords/host identity. Capacity decision không tự spawn job.

## Verification và giới hạn

Đã đọc full SHA, inventory paths, exports/imports/manifest và source gap. Không chạy tests, install/build, DB/browser/native/live provider, không process/service/container/commit. Một lệnh tạo report bằng shell bị hook chặn vì prose chứa từ build; chưa thực thi hay đọc build output, chuyển sang normal file patch cho artifact. Không đổi hook/config.

Câu hỏi còn mở: issue/run/session/approval mapping và core gates (00-01); grant/fence/session remote (00-04); exact destination package/test harness/toolchain (00-03/05). Reviewer độc lập cần kiểm inventory trước dùng làm implementation brief.

## Fix evidence — reference P3

Follow-up05/10/2026 23:01 Asia/Saigon: chỉ sửa source line refs sau review. `git -C /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew rev-parse HEAD` xác nhận lại `51907858d0c8cdb7329759f22104f0727dbe6751`; `nl -ba /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/src/app.ts | sed -n '88,99p'` cho composition comment91, export `buildApp`92, default `authorizeDispatch ?? denyDispatch`95 và `verifyFinalResult ?? denyFinalResult`96. Refs cũ99/108–109 được thay92/95–96; không đổi conclusion hoặc source, không chạy tests/install/DB/agents/commit.
