# Phase06/T2 — Preflight tĩnh scoped Assistant

Trạng thái: STATIC PREFLIGHT, cần ruling PM trước source/RED. Chưa triển khai T2, chưa chạy Node, PostgreSQL, CLI runtime, model, certification hoặc test. Không commit/index/app/package/manifest/SQL thay đổi. Báo cáo được viết trong managed worktree được giao; không tạo worker con, không sửa file peer.

## 1. Căn cứ đã đọc và kiểm checksum

- Brief đọc đầu tiên: `plans/261002-0002-crew-v2/execution-phase06/task-2-brief.md`, SHA256 `a5410973c8ef4cc8b0ab5f61693c72eba9505c53d72d632f07e82e82e95c5dd9`.
- Spec: `docs/superpowers/specs/2026-10-01-crew-v2-design.md`, SHA256 `14085723bba15c1c00de52eab437cf83af58efef8943b761fd029f36f2523165`; đã đọc mục3–9,12. Luồng backend này không mở lại approval UI07.
- T1 baseline theo dispatch PM: `feaea55`. Kiểm bytes hiện tại011 `fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841`; contracts `adee25f453fa91e7498a1a300d3c7a4761147b8584e738a54818d9cb4b65412f`. Không dùng Git để tái xác nhận HEAD vì PM giữ Git.
- Đã đọc root `docs/index.md`, `v2/docs/index.md`, các flow server-assistant, server-identity, server-tickets, server-attachments, server-execution, gateway-models, gateway-runtime, thêm server-docs-view/server-models cho producer thực tế.
- `.codegraph/` không có ở worktree được giao; dùng tìm kiếm hẹp theo các file đã được flow liệt kê. Không chạy codegraph/indexing.
- Áp dụng Superpowers SDD implementer-template, TDD và verification-before-completion; giai đoạn này chỉ thiết kế RED, không gán test PASS. Memory pass không có bằng chứng v2 thay thế source hiện tại.
- `v2/docs/index.md` còn mô tả T1 FIX2 đang review; dispatch PM đã chốt accepted. Report giữ source/checksum thực và ghi docs trạng thái này cho controller đồng bộ khi serialize docs.

## 2. Producer/caller thực và khác biệt với brief

| Cụm | Source hiện tại đã kiểm | Kết luận tiêu thụ |
|---|---|---|
| Fence011 | `assistant/store.ts:42` `assertCurrentTurnFence(tx,fence,purpose)` khóa calibration guard → machine → config → designation → turn → monitor; claim chỉ reserved/running, ack running/finalizing/stopped | Primitive này không kiểm actor, input, scope, admission, certificate hoặc target hash; không thể dùng riêng làm ProjectOrchestrationAuthority |
| G1 ticket | `tickets/service.ts:45,109,312`; `tickets/contracts.ts:83` | Generic scope chỉ bound machine; factory chưa có assistant methods/dependency. Giữ generic ACL/signature. Tạo scoped methods cùng shared business invariants, không nhân đôi ticket implementation |
| G1 decision | `tickets/decisions.ts:103` | Existing requireTicket chặn A≠B. Các kiểm owner_answer/approval, source cùng root, deploy hash vẫn bắt buộc sau scoped entry. Không biến actor thành owner |
| G1 dependency | `tickets/dependencies.ts:7` | Public function không nhận actor; HTTP authorize ở caller. Scoped wrapper phải verify action/target rồi dùng chung DAG/root/CAS/state logic, giữ generic signature |
| G1 command | `execution/commands.ts:22` | Current createCommand giữ binding/status/payload, cấm actorA≠machineB. Add riêng createAssistantCommand; generic routes và claim vẫn denyA. Journal giữ actorA; commands không có actor column riêng |
| R3 router | `attachments/routing.ts:26,80,120,148` | Producer thật là createRoutingServices factory; không có exported standalone routeAssistantMessage như chữ ký minh họa brief. Factory authorize còn chặn foreign binding trước trusted callback; mutation còn gọi generic authorizeTicketMutation trước createTicket. Chỉ inject creator tại dòng148 chưa đủ |
| R3 HTTP | `attachments/routes.ts:650,672` | registerInputScopeRoutes tự tạo generic routing factory. Cần constructor injection captured, không closure theo request hoặc app global |
| Input009 | `attachments/grants.ts:105,150,258`; `attachments/references.ts:8` | assertGrantCurrent khóa input target rồi grant trước designation callback. startSession replay đứng trước authorizeSession fresh; OFF semantics đã đúng ở producer và phải giữ |
| Text-only consent | `attachments/submissions.ts:201–223`, `messages.ts:147–153`, `grants.ts:44` | Owner selected-inputs đã lưu authorization originals=[] cho text-only; không thiếu producer consent. Nhưng exactOriginals bắt refs.length>0 nên issue/read grant từ chối. Không cần sửa messages/submissions hay SQL; đề xuất hẹp trong grants |
| Docs006 | `docs/read.ts:33,108,141,171` | Generic reader nhận Db, tự begin và bound machine. T2 dedicated tx reader phải kiểm authority rồi đọc snapshot/file composite và bytes/hash; không gọi generic bằng owner giả hoặc nested transaction. docsSourceReader Tx có thể giữ dùng cho provenance |
| Model008 | `models/catalog.ts:174,275` | Actual getPool nhận Db\|Tx, source, optional now; brief R2a mô tả Db-only đã cũ. Giữ two-phase capture/read/Tx recheck theo approved plan; không cần thêm overload. Không dùng workflow probe làm routing receipt |
| Runtime04 | `gateway/src/runtime/contracts.ts`, flow gateway-runtime | RuntimeAdapter/RuntimePin gắn attempt/project. Không tạo fake attempt cho inbox. Routing transport riêng đợi transfer/producer measured trust; native method schema không phải authority |
| Fixture011 | `server/test/support/assistant.ts:490,634,685` | Actual assistantFixture(db) không có clock argument, HTTP clients A/B, seedCertifiedRouting hoặc seedExecutableRun. seedTurn lưu UNVERIFIED và submitMessage chọn assistantRead:none. Chỉ relational/service fixture, không production bootstrap |
| R2 tool identity | `assistant/contracts.ts:457`; `011:244` | RoutingToolRequest không có providerCallId nhưng SQL provider_call_id NOT NULL. Cần PM chốt transport metadata carrier; không sửa frozen contract hoặc tự bịa provider ID |

Caller cần regression: `tickets/routes.ts` tạo factory generic và pre-cache authorization; `execution/routes.ts:217` gọi generic createCommand; `execution/attempts.ts:204,530,574` dùng generic ticket/execution factory và command; `attachments/routing.ts` factory; `attachments/routes.ts` constructor; app composition chỉ PM/T7 sửa.

## 3. Lock map và phương án authority hẹp

Order phải xuất phát từ producer thật, không chỉ từ enum/prompt:

1. `journal/mutation.ts` giữ advisory idempotency → event_cursor rồi context.authorize trước cache.
2. Ticket metadata chuẩn: discover root/targets không khóa, lock root → affected tickets sorted → project(s) → machine. G1 shared invariant không được bắt đầu bằng fence rồi mới khóa root.
3. T1 fence dùng calibration guard → machine → config → designation → turn → monitor. Khi scope là ticket, target/root/project phải được khóa trước khi gọi fence. Actor resolver không được âm thầm gọi root-lock sau khi đã giữ guard.
4.009 `lockInputTarget` ticket: root → ticket → project → input; message đã route: root → route ticket → project → message → input; unrouted: message → input. `assertGrantCurrent` tiếp tục grant → callback designation. Truyền callback gọi full T1 fence ở đây sẽ đảo authority/input đối với bootstrap hoặc G1 nếu không có thống nhất prelock.
5.009 router hiện gọi authority trước discovery/lock roots; vì vậy inject InputRoutingAuthority có full fence locks trực tiếp sẽ tạo authority→root. Cần tách validation thuần/read-only với ordered authorization trong factory trusted hoặc prelock toàn scope trước callback; callback lặp chỉ recheck các khóa đã giữ. Giữ raw generic route behavior.
6. Ticket input/comment fanout009 giữ root trước revision; không có network/model/telemetry trong Tx. Split input snapshot read và routing mutation; mutation revalidate exact revisions.

Đề xuất contract nội bộ (chưa source): T2 resolver nhận Tx+proof sau root/project prelock, xác minh persisted designation/fence/scope/current snapshot/read session/security, trả đúng `{kind:'machine',id:<designation.machine_id>}`. HTTP caller vẫn authenticate actorA và đối chiếu với resolver; resolver không thay request authentication. G1 verify thêm action, exact canonical target hash, operation và scope root/project/authorization. Chỉ current stored message routing decision cho phép root create; child chỉ thuộc root đã cấp. Scope mới không đồng nghĩa có quyền approve/owner answer, code/claim hoặc binding.

Token business-invariant phải module-private, minted sau authority.verify; không boolean hoặc JSON skipAcl. Có thể giữ từng module factory/shared private routine trong các producer files đã liệt kê; chưa đề xuất thêm helper path. Constructor capture functions/dependencies bất biến; missing authority default deny.

**Ruling cần PM:** khóa009 input-first và T1 guard-first cần một prelock recipe được review trước GREEN. Đề xuất producer009 entrypoints grants/router dùng captured internal preauthorization/prelock; shape AssistantInputAuthority/RouteMessageInput và SQL giữ nguyên. Nếu không thể giải trong đúng owned files, báo exact extension trước sửa. Chưa tuyên bố loại hết deadlock chỉ bằng event_cursor vì byte/read session paths không nhất thiết đi journal.

## 4. Seam T2 ↔ T3

T3 giữ public createRun(tx,proof,input), answerGate(tx,questionId,decisionId); không thêm actor vào frozen DTO/port. Đề xuất constructor nội bộ capture:

- `resolveActor(tx,proof)` của T2: persisted current Actor A, current exact scope/admission; gọi sau root/project locks của T3.
- `orchestration: ProjectOrchestrationPort`: G1 implementation thật, methods reverify target/action trong cùng Tx. Không inject generic ticket services với ownerA giả.
- Definition/render artifact reader riêng do T3 sở hữu, default deny thiếu bytes/provenance; không xem literal fixture map là producer network/registry thật.

create_run operation khác các child create_ticket operations: derive/persist exact child operation identity theo run/step/action/target/precondition; không tái dùng một operationId cho nhiều target hashes. Cần giữ response/replay/collision invariant với011 operation IDs và tools. OrchestrationAction không có create_run, nên T2 tool authorization phải kiểm tool_names riêng trước gọi T3; không mở rộng enum để tiện gọi.

SQL011 workflow_gates.artifact_sha256 NOT NULL hex64 (`011:134`), identity immutable (`011:283`); không null/zero SHA/definition hash thay artifact. Có thể giữ gate UUID trong step.gate_ids rồi materialize row khi trusted artifact bytes/hash thực đã có. Mọi gate check thiếu row phải deny. assistant_questions.gate_id có FK tới actual gate, nên chỉ tạo gate-bound question sau materialization; pending design input question không được gán fake gate row. answerGate consume exact persisted owner/delegated decision theo required_actor, revision/artifact/scope; UUID hoặc reported hash không tự chứng minh artifact.

## 5. Ownership transfer đề nghị, chưa sửa source

T2 new paths theo brief (đã được phân trách nhiệm, chưa release implementation):

- `v2/server/src/assistant/authority.ts`, `turns.ts`, `docs.ts`, `orchestration.ts`, `routes.ts`, `certification.ts`, `protocol.ts`.
- `v2/server/scripts/certify-routing.ts`.
- `v2/gateway/src/assistant/driver.ts`, `supervisor.ts`, `transport.ts`, `certification.ts`, `tool-client.ts`.
- `v2/server/test/assistant-authority.test.ts`, `assistant-turns.test.ts`, `assistant-certification.test.ts`, `assistant-protocol.test.ts`, `assistant-route-integration.test.ts`; `v2/gateway/test/assistant-driver.test.ts`.

Yêu cầu PM chuyển quyền producer rõ ràng trước viết:

| Exact path | Thay đổi hẹp và gate |
|---|---|
| `v2/server/src/tickets/contracts.ts` | Optional captured assistant ProjectOrchestrationAuthority; giữ existing deps |
| `v2/server/src/tickets/service.ts` | G1 create/signal shared invariant + scoped methods; generic requireProjectScope unchanged |
| `v2/server/src/tickets/decisions.ts` | Shared validated/source-checked decision routine; scoped wrapper, actorA audit |
| `v2/server/src/tickets/dependencies.ts` | Shared DAG invariant/scoped wrapper; public signature giữ |
| `v2/server/src/execution/commands.ts` | Chỉ createAssistantCommand G1; R4 retirement helper T4 phải serialize riêng |
| `v2/server/src/attachments/routing.ts` | Captured scoped preauthorization+creator+derived-consent bridge; handle cả pre-callback foreign-project check và generic authorizeTicketMutation callsite; giữ defaults |
| `v2/server/src/attachments/routes.ts` | Constructor router injection và ordered pre-cache check; không global ACL |
| `v2/server/src/attachments/grants.ts` | R3 derived authorization helper/current parent-route revoke; narrow text-only originals=[] consent; ordered preauthorization seam nếu PM duyệt |
| `v2/server/src/models/routing.ts` (new) | RoutingModelPort exact008 desired/applied +011 routing receipts; missing measured trust deny; cần phase04 transfer |
| `v2/gateway/src/runtime/routing-transport.ts` (new) | Separate routing namespace, certified primitive bridge; native constructor/default deny; cần phase04 transfer |

Không yêu cầu sửa tickets/authorization.ts, docs/read.ts, attachments/messages.ts/submissions.ts/references.ts, assistant/contracts.ts/store.ts/inbox.ts hoặc fixture T1. Nếu caller-map sau này chứng minh cần, dừng mở rộng và xin exact transfer. Không tự tạo support helper mới; test-local helpers ban đầu nằm owned test file. T3 workflows/runs/gates/workflow-manifest hoàn toàn ngoài ownership T2.

## 6. R1–R4/G1/G2 không được lược bỏ

- R1: deployment ID + pinned verifier build + exact binary/policy/observer/OS/key, current ON và bounded owner-authorized calibration; shared guard/generation chặn normal turn đồng thời. Missing measured trace/stop/capability => UNVERIFIED/deny; seedTurn UNVERIFIED không nâng thành PASS. Script certifier là composition riêng, không route production/env bypass. Zero default budget không tự được nâng.
- R2: work/bootstrap persist grant/snapshot/selection/turn before host admission/start; scope and input recheck trước tool result cache; mutation/result/event atomic. Route thay input => persist result rồi stop old turn/rebootstrap, không tiếp tục stale admission. Provider response/free text không tạo decision hoặc completion. Candidate B phải đến reader T4 của scoped real run, không từ routing poolA hoặc prompt fixture.
- R2 transport ruling: đề xuất `X-Crew-Provider-Call-Id` bounded header cho actual provider correlation, được đưa vào effective request hash/idempotency comparison và stored row; payload giữ frozen RoutingToolRequest. Không coi header là authority; authenticated current fence/input/tool scope vẫn bắt buộc. GET result cần mapping persisted, không từ provider ID tự nhận.
- R3: existing Tx creator; decision body digest exact; parent consent narrowing original/hash/expiry/allowOriginal, current parent+route checks trên mỗi grant/session use và revoke propagation. SQL trigger chỉ kiểm INSERT lineage, không tự cascade later revocation. Link failure rollback cả ticket/decision/route/consent/event. Correction unknown old process/read session => deny.
- R4: T2 không sửa command retirement/claim hook. T2 supervisor phải giữ unknown stop/finalization; không expire turn/guard để chuyển designation. T4/T6 sở hữu retirement/prelaunch protocol; no-launch proof thực mới release, UUID stop evidence không đủ.
- G2: public Codex method schemas đã có theo PM nhưng dynamicTools/default capability mismatch và Claude declarations thiếu; chưa chạy initialization/provider/native connector. Routing driver supervisor thiếu measured boundary phải từ chối start, không chế fake native adapter để GREEN.

## 7. Slice tiếp theo đề nghị và meaningful RED

Đề nghị PM release nhỏ theo thứ tự, không release toàn future T3–T7:

**Slice A: designation + metadata-only authority/doc reader và generic ACL regression.** Owner config select machine với preferred:null; persisted current actor/fence/scope reader; catalog allowlist và docs source/audit/current labeling; default-deny admission khi receipts UNVERIFIED. Chưa bootstrap success hoặc live inference. Existing T1 seedTurn chỉ được dùng làm input relational negative test, không gọi đó là admissible session. Nếu metadata reader đòi admitted session theo final ruling, positive docs test đợi trusted service-test observer (deployment-isolated) và không bỏ gate để test xanh.

**Slice B: G1 producer shared invariants + T3 resolver seam**, sau approved lock recipe/transfer; **Slice C:009 R3/text-only/current session + protocol**; **Slice D:G2/R1 driver** khi actual measured transport boundary available. Unavailable later consumers return503/409 theo contract, không fake dispatch/completion.

Recipe RED có hành vi thực, không missing import/stub:

1. Existing grant producer là executable accepted target cho regression rõ nhất: trong private databaseFixture(11), actual createMessageServices.submitAssistantMessage với owner selected-inputs và no files tạo authorization originals=[] thật; current persisted designation+exact owner scope qua service test authority giới hạn chỉ authorizeIssue (không session/admission). Gọi existing issueAssistantReadGrant rồi bind/read snapshot thật; mong grant exact empty originals và expiry narrowed. Baseline reject tại exactOriginals. Assertion này chứng minh narrow text-only producer defect; không có fake future RoutingModelPort/PASS. Negative consent none/wrong message/nonempty unmatched originals phải giữ deny. Chỉ chạy khi grants.ts transfer và PM cấp PG slot.
2. Designation mutation: test-owned Fastify app ghép actual new routes factory, actual identity/mutator; scaffold registration không có handler behavior trước RED. Owner PUT preferred:null mong persisted config/designation revision; machine PUT403, expectedRevision stale409, invalid target404. Baseline route404 so expected200 là thiếu hành vi, không import/compiler failure. Không sửa buildApp do PM giữ.
3. Metadata/actor gate: dùng persisted T1 fixture negative UNVERIFIED/current/noncurrent scopes; baseline callback cannot authorize cross-project. Positive behavior sau PM chốt service authority trust boundary, exact A≠B docs200 và generic project docs/claim404. Read back audit, bytes SHA/audit state; không seed artificial current/verified label.
4. G1 behavioral RED từ existing consumer harness: actual owner-submitted message decision hoặc root scope, creator calls actual generic producer as actorA, A≠B yields404; desired scoped production factory expected ticket with created_actor_kind=machine/id=A. Generic equivalent remains404. Run two real DB connections DAG/create/closed-parent/approval conflicts and input/fence revoke-before-replay. Không tạo future T3 run/assessment/dispatch rows để vượt producer gate.

Trước mỗi test file thêm, ghi production mutation mà test bắt được. Typecheck/import lỗi không tính RED. Full source không viết trước RED; PM có thể cấp scaffold declaration tối thiểu để load new-module test, còn RED phải failure assertion của missing behavior. Report test tương lai ghi exact command/exits/failures; static pass này không có RED/GREEN.

## 8. Regression matrix cho task đầy đủ

| Phạm vi | Owned test | Phép đo chính |
|---|---|---|
| owner designation/current actor/scope/docs | assistant-authority | machine self-designate deny, A≠B scoped metadata only, docs/hash/state, foreign/draft/wildcard deny, source security revoke before replay |
| G1 invariant parity | assistant-authority | hierarchy/pin/closed root, DAG cycle/CAS, owner/deploy decisions, actorA journal/ticket/decision provenance, command bindingB, generic A remains404 |
| bootstrap/turn/admission | assistant-turns | single live reservation race, current generation, OFF-before denies/OFF-after admitted continues, unrelated revision does not cancel, stale input/grant/designation expiry denies, unknown process holds |
| input/text | assistant-authority + turns | canonical ancestor comments hashes, selected images required, reported_transport never comprehension, text-only consent/grant, comment revision invalidates publication |
| certification | assistant-certification | one bounded challenge/nonce exact replay, wrong identity/expiry deny, no trace UNVERIFIED, measured full proof only PASS, deployment separation and no production calibration route |
| tool replay | assistant-protocol | unknown/extra fields/forged approval, current auth before cached result, logical IDs/transport correlation conflicts, before/after commit lost response exactly once, pending uncertainty remains |
| route009 | assistant-route-integration | A≠B/B offline, actual creator/link/consent Tx rollback, parent revoke and stale route, correction active/unknown sessions hold, generic endpoint denial |
| driver/G2 | assistant-driver | no start before actual admission; no routing workflow/shell/child bypass; selected modality coverage; exact durable resolve/checkpoint/stop, missing certificate default deny |
| R2a/T4–T7 integration | assistant-protocol + T7 | real candidate reader poolB≠poolA, no preseed assessment/decision/dispatch, observed choice then capacity/prepare/actual claim, owner/review continuation |

Cover producer affected suites after final relevant source change: tickets/dependencies/deploy/completion/repair, commands/attempts, attachments grant/routing/message/access HTTP suites, assistant-store and frozen-schema contracts. Controller selects exact accepted test wrappers and grants sole heavy slot; no concurrent Node/PG test execution. Full task acceptance remains pending all producer gates and independent review.

## 9. PM rulings cần trả lời trước source

1. Cho phép narrow producer changes/paths ở mục5 và chốt prelock recipe009/T1; chưa có authorization tự động mở rộng callback lock order.
2. Chọn internal T3 constructor capture persisted resolveActor + orchestration, keeping public signatures; gate late-materialization và required missing gate deny.
3. Chốt providerCallId transport header hoặc carrier khác giữ frozen DTO/SQL.
4. Chọn slice A designation-first hoặc regression text-only producer trước; cấp exact source/test release và test resource slot riêng. T1 fixture thực không có advertised HTTP/certified helpers; không sửa nó hoặc fabricating PASS.
5. G2 measured producer unavailable giữ default deny; ghi rõ eventual runtime/live acceptance pending, không yêu cầu worker fake implementation để hoàn tất full T2.

Chỉ file report này được tạo bởi preflight. Các findings trên là đối chiếu source tĩnh, không runtime/deadlock/certification verification.
