# Phase06 T2 Slice B — G1 và input/docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans after PM releases an exact chunk. Hiện chỉ STATIC PREFLIGHT; không delegation hoặc implementation.

**Goal:** Chốt producer G1 và thứ tự khóa input009/authority011 trước khi mở scoped orchestration/docs; tách phần kiểm được bằng producer hiện có khỏi admission cần native G2.
**Architecture:** Public ACL giữ nguyên. Factory nội bộ capture authority mặc định deny; scoped entry kiểm exact persisted request/action rồi mới gọi chung business invariants với actor máy A. Mọi khóa root/ticket/project có trước guard011; callback009 muộn chỉ kiểm context đã khóa trong cùng Tx.
**Tech Stack:** Node ≥24.12, TypeScript 7.0.2, pnpm 10.32.1, Fastify 5.12.5, postgres.js 3.4.9/PostgreSQL 18.6; không dependency mới.
**Spec:** `docs/superpowers/specs/2026-10-01-crew-v2-design.md`; approved `execution-phase06/task-2-brief.md` G1/T2/R2/R2a/R3; current rulings trong `task-2-report.md`.
**Baseline:** PM báo commit `a96c932`, Slice A FIX1 độc lập Approved/A1–A2 CLOSED. Không dùng Git trong lượt này. Đã đọc root/v2 index rồi flows server-assistant, server-identity, server-tickets, server-execution, server-attachments, server-docs-view trước source. `.codegraph/` không có.

## Giới hạn và trạng thái

- Một routing Assistant; A điều phối metadata của project bind B không có quyền claim/code/token/checkout của B. Không synthetic owner, không nâng `requireProjectScope` hoặc `tickets/authorization.ts`.
- SQL001–011, DTO `assistant/contracts.ts`, `attachments/contracts.ts`, DispatchPermit005/DispatchSelection007/ModelDispatchChoice008 giữ nguyên. Constructor/internal helper mới cần exact transfer của PM; không âm thầm đổi wire shape.
- Source OFF không tự hủy exact admitted turn. Admission mới/fallback phải kiểm current ON; revoke/input/designation/expiry vẫn chặn cả replay. Không dùng receipt `reported_transport` làm comprehension/certification PASS.
- G2/R1 chưa có measured producer hợp lệ; `createPersistedAssistantActorResolver()` hiện vẫn deny. Không seed PASS/admission/transport/text receipt để gọi đó là production success. Không nối app/host/model/native trong Slice B.
- Mọi future test cần slot riêng: PG256MiB/CPU1/pids64, random loopback khác5432/55432, Nodeheap384/concurrency1; fresh pressure1/2, available≥4GiB, idle≥50%, disk≥8GiB. Lượt này không chạy Node/tests/DB/deps/Git/children.

## 1. Source/caller thực và khoảng trống

| Producer hiện hành | Bằng chứng và ảnh hưởng |
|---|---|
| `tickets/service.ts` `createTicket`, `signalTicketWithDependencies`, `createTicketServices` | Scope là máy bind project; chưa có assistant dependency/method. Validation JSON/hierarchy/closed root/parent pin/deploy fingerprint/audit/event nằm trong cùng implementation, phải dùng chung. Scoped signal chỉ `dependencies_ready` hoặc `wait_owner`; không tận dụng `internal=true` để vượt execution proof. |
| `tickets/decisions.ts` `recordDecision` | `requireTicket` chặn A≠B; kiểm owner answer/approval, source cùng root, deploy hash phải giữ sau scoped entry. Không cho machine ghi owner kinds dù authority test trả thành công. |
| `tickets/dependencies.ts` `addDependency` | Chữ ký hiện tại không actor; HTTP caller mới cấp ACL. Scoped wrapper phải verify trước khi gọi chung DAG/root/CAS/closed/state checks. Không tuyên bố direct actorless function là authenticated API. |
| `execution/commands.ts` `createCommand` | Khóa root rồi ticket/project, kiểm bound machine/revocation/start-ready/payload. Separate assistant entry chỉ bỏ hạn chế actorA=B sau proof; giữ target B/binding. Commands không có actor column: journal vẫn actorA; không đổi schema để thêm audit giả. Claim/read/ACK generic vẫn chỉ B. T4 cũng sẽ sửa commands.ts cho R4: serialize handoff. |
| `attachments/routing.ts` | API thực là `createRoutingServices({authority,retire,now})` trả `authorize`/`routeAssistantMessage`; không có exported standalone `routeAssistantMessage` hay `createMessageRouter`. `authorizeMessageRouting` kiểm project bound A **trước** authority callback. Trong work còn `authorizeTicketMutation` và `tickets.createTicket`. Chỉ inject creator chưa đủ A≠B. |
| `attachments/routes.ts:650+` | `registerInputScopeRoutes` tự tạo routing factory, capture optional message services. Decision authorize, snapshot, bind, session, stream từng chunk và receipt gọi009 trực tiếp. Chỉ sửa bootstrap không sửa được các đường late callback này. |
| `attachments/grants.ts` | `assertGrantCurrent`: target/input → grant → `designation`; `startAssistantReadSession`: grant → `authorizeSession`; `readAssistantSession`: grant → `assertSessionCurrent`. Nếu callback gọi full T1 fence thì input→guard đảo với guard→input. |
| `attachments/messages.ts` | Decision service tự `lockInputTarget` trước callback. Machine cần receipt009 có coverage `all_selected`; decision `receipt_id` FK sang **attachment_assistant_receipts**. Không thể nhét ID `assistant_text_receipts`011 vào đó. |
| `attachments/submissions.ts:204–223` | Owner selected-inputs đã lưu consent `originals=[]` cho message text-only. Canonical consent hash là `{ownerId,targetKind,targetId,originals,allowOriginal:false,scope:'submitted-inputs',expiresAt}`. Khác hash DTO của generic createInputReadAuthorization; phải nhận diện producer, không áp một công thức cho mọi lịch sử. |
| `attachments/grants.ts` empty boundary | Generic authorization endpoint minItems1 và `exactOriginals` yêu cầu nonempty. Scoped text grant cần provenance riêng; không xóa điều kiện length để mở mọi grant rỗng. Empty attachment receipt hiện coverage `none`, không `all_selected`. |
| `references.ts`, SQL009 | `lockInputTarget`: root→ticket→project→message nếu cần→input. Comment trigger root→affected tickets→input; publication event_cursor→roots/tickets/projects→messages→input→grant/session. Không đường nào được thêm guard sau input. |
| SQL011 scope/consent | `assistant_scopes` có snapshot/owner_authorization/hash nhưng **không routing_decision_id hay target hash column**. `assistant_route_authorizations` kiểm subset/expiry/parent hash tại INSERT, không tự cascade parent revocation về derived grants. Producer phải kiểm parent/current route lại hoặc revoke đúng lineage. |
| Docs006 | `readDocsPage(Db,...)` mở Tx riêng và generic ACL; không gọi nó bằng synthetic owner hoặc nested transaction. `readProjectDocsState` đọc latest; không gán state đó cho một pinned snapshot khác. |

`assistantProtocolAuthority` của test009 dùng Map và sinh UUID admission; `admittedInboxFixture` dùng nó. Chúng chứng minh protocol009 trong test, không được dùng để nghiệm thu positive production authority011. `assistantFixture(db)` có UNVERIFIED relational turn, phù hợp negative/default-deny/lock tests; không có advertised live HTTP certified helper như plan lịch sử mô tả.

## 2. G1 contract và private capability

Giữ nguyên `ProjectOrchestrationAuthority.verify(tx,actor,proof,action,targetSha256):Promise<void>` và toàn bộ `ProjectOrchestrationPort`. Đề nghị additive producer methods:

```ts
// Frozen assistant/contracts.ts, giữ nguyên từng tham số và kết quả:
export interface ProjectOrchestrationAuthority {
  verify(tx: Tx, actor: Actor, proof: OrchestrationProof,
    action: OrchestrationAction, targetSha256: Sha256): Promise<void>;
}

// tickets/contracts.ts: optional captured dependency, missing => named 503 deny
assistant?: ProjectOrchestrationAuthority;

// createTicketServices(deps), alongside unchanged generic methods
assistantCreateTicket(tx: Tx, actor: Actor, proof: OrchestrationProof, input: CreateTicket): Promise<Ticket>;
assistantRecordDecision(tx: Tx, actor: Actor, proof: OrchestrationProof, ticketId: Id, input: DecisionInput): Promise<Id>;
assistantAddDependency(tx: Tx, actor: Actor, proof: OrchestrationProof, ticketId: Id, predecessorId: Id, expectedRevision: number): Promise<void>;
assistantSignalTicket(tx: Tx, actor: Actor, proof: OrchestrationProof, ticketId: Id, signal: 'dependencies_ready'|'wait_owner', expectedRevision: number): Promise<Ticket>;

// execution/commands.ts: separate entry, no generic authorize/claim changes
createAssistantCommand(tx: Tx, input: CreateCommand, actor: Actor,
  proof: OrchestrationProof, authority?: ProjectOrchestrationAuthority): Promise<Command>;
```

Đầu vào qua runtime validation hiện có; UUID chỉ canonicalize để lookup/compare, không tự rewrite payload dùng cho request hash. Proposed target hash: SHA256(canonicalJson(['crew-v2:orchestration-target:1', action, exactPayload])). Payload create là CreateTicket đầy đủ trước defaults nghiệp vụ; decision gồm ticketId+input; dependency gồm hai IDs+expectedRevision; command là toàn bộ CreateCommand; signal gồm ticketId+signal+expectedRevision. Khác target/revision/actor/operation không reuse quyền. Công thức này cần PM freeze trước producer code, không đổi journal raw-body semantics.

Shared invariant core nhận capability nội bộ có module-private brand/identity registry, bound đúng Tx+actor+action+target hash. Wrapper khóa entity prefix rồi await captured authority.verify; chỉ sau đó mới mint capability. Plain object/cast/boolean không qua runtime identity check. Generic wrapper vẫn dùng ACL cũ; không thêm tham số bypass public. Dependency dùng chung hàm invariant hiện có; quyết định/ticket/command cần tách authorization khỏi core, không copy SQL/business logic. Capture dependency methods bất biến khi factory tạo; thay deps sau đó không mở quyền.

**DTO/hash B1 cụ thể:** assistantCreateTicket trả `Promise<Ticket>` (Ticket extends CreateTicket), không trả proof/capability. Serialized input phải có workflowPin:null hoặc Pin; không dùng default của HTTP004 để hợp thức hóa field thiếu. Optional deployApprovalDecisionId omitted và null vẫn là hai payload hash khác nhau; undefined/accessor/prototype/cycle không phải JSON wire hợp lệ. Snapshot input bằng canonicalJson→parse thành owned immutable DTO **trước await đầu tiên**; hash và invariant core cùng dùng snapshot đó, không đọc object caller bị đổi trong lúc verify chờ. Không sửa body journal ở caller.

| Thao tác | Normalization đã có, giữ nguyên trong shared core |
|---|---|
| Request mới | ID/rootId server sinh; criteria lưu `{workflowChoice:'superpowers',...input.criteria}`; status pending/revision1. Target hash dùng input trước default này, không hash Ticket response. |
| Step/task | Root/project/parent level/closed state kiểm từ DB dưới root lock; workflowPin kế thừa parent sau samePin check. Target hash vẫn pin exact submitted CreateTicket; capability còn bind discovered root/project để không chuyển cây trong cùng Tx. |
| Return | Giữ `mapTicket`: DB fields/id/root/status/revision/wait/repair/mergedCommit; hiện không map deployApprovalDecisionId trở lại response, dù type là optional. Không tự thêm field để “sửa” DTO trong B1. Provenance/approval kiểm actual persisted columns. |
| UUID | Lookup canonical identity nếu cần; hash giữ exact serialized spelling. Same logical ID khác case không được reuse target hash đã cấp. |

**Caller/type compatibility inventory** (đã search toàn `v2/**/*.ts`, không chỉ consumer dự kiến):

- Production direct factory: `tickets/service.ts` hai default exports; `tickets/routes.ts:177` dependency branch; `execution/attempts.ts:204,530` execution/completion factory; `attachments/routing.ts:86` default generic factory. Không caller nào hiện truyền assistant.
- Factory passed as value: `attachments/submissions.ts:321,342` nhận `typeof createTicketServices`, gọi với commentAttachments; `test/attachments-submissions.test.ts:31,363,374` và `test/support/attachment-access.ts:85` truyền chính factory. Giữ parameter optional/dependency fields hiện tại và tất cả generic method signatures; additive method không đổi lời gọi này.
- Types: `tickets/routes.ts:148,172` dùng ReturnType union TicketServiceDependencies và phân nhánh bằng `'createTicket' in ...`; `test/attachments-comment-factory.test.ts:155,167` dùng Parameters<typeof factory>[0]. Actual current callers không có handcrafted full TicketServices object thiếu method mới. Optional assistant field không biến dependency object thành service object; không sửa route dispatch predicate.
- Test direct factory: `test/{repair,dependencies,completion,deploy,attempts,attachments-comment-factory}.test.ts`, `test/support/tickets.ts`; tests attachment-submissions gọi qua factory value như trên. Indirect routes: `src/app.ts:74` chỉ truyền execution/docs dependencies; `test/tickets.test.ts:92` dùng default. Không gateway/domain caller hiện hành. Không sửa các caller/fixture này để ép compatibility; scoped typecheck phải kiểm imported closure, covering dùng các producer suites liên quan.

**Nhỏ nhất để release:** chỉ `assistantCreateTicket` và shared create core trong service.ts + optional dependency contracts.ts + test mới. Brand nằm private trong service.ts, chưa cần helper cross-module. Chưa tạo port có các method giả hoặc nối production resolver. Các method còn lại là chunk G1 tiếp theo sau review; khi cần chia sẻ capability giữa decisions/service, đề nghị riêng path `v2/server/src/tickets/assistant-access.ts` (opaque brand + prepare/assert), không tự tạo sớm.

Constructor seam của orchestration cần PM chốt: brief deps `{inputAuthority,tickets,models}` không chứa authority để gọi separate `createAssistantCommand(...authority)`. Đề nghị thêm **internal-only** `authority?:ProjectOrchestrationAuthority` vào constructor deps, missing default deny; tickets factory và command closure capture cùng object từ composition. Không sửa frozen public port/DTO và không biến AssistantInputAuthority thành orchestration boolean.

### Điều kiện positive authority sau này

- Actual authenticated actor phải là machineA khớp current persisted designation/turn; actor resolver không thay authentication và không trả owner.
- New root: exact owner-submitted message/canonical payload hash, consent, current input snapshot/revision, persisted routing decision với actorA/kind routing/body `{ticket,expectedRouteRevision}`/digest, exact CreateTicket target hash và chosen project. Confidence không cấp quyền; decision khác body/input/session không dùng được.
- Descendant: exact scope.root_ticket_id/project_id; target/parent/predecessor cùng root; snapshot thuộc đúng target/current input; owner authorization/current route lineage; allowed action/tool và expiry. Không dùng discovery toàn hệ thống làm scope.
- **Linkage chưa đủ để bật verify:** frozen verify chỉ nhận target hash; scope không có decision ID. R3 callback có context.decisionId và có thể kiểm exact row, nhưng standalone `/actions create_ticket` không được đoán “latest decision”. Đề nghị private exact-route verifier nhận explicit context trước scoped creator; positive new-root authority chỉ được phát trong cùng trusted R2 route operation. Nếu cần standalone new-root verify, PM phải chốt persistence linkage bằng existing operation/scope digest có thể reconstruct chính xác; hiện default deny. Không dùng scopeId=decisionId convention, scan-latest hoặc thêm JSON field ngoài DTO để lách khoảng trống.

## 3. Prelock recipe009/011

Đề nghị helper mới `assistant/input-locks.ts`, chỉ có internal composition import; API không thêm proof từ HTTP:

```ts
type AssistantInputSelector =
 | { kind:'issue'; authorizationId:Id; target:InputTarget; inputRevision:string }
 | { kind:'grant'; grantId:Id }
 | { kind:'session'; sessionId:Id }
 | { kind:'route'; input:RouteMessageInput };
prepareAssistantInput(tx:Tx, actor:Actor, selector:AssistantInputSelector):Promise<void>;
```

Hàm chuẩn bị resolve identity từ DB, không tin client designation/root. Prepared context frozen lưu trong private WeakMap theo **Tx**, bound selector/actor/fence/target/revisions, không mutable “current request” closure hoặc cross-Tx cache. Late callbacks thiếu context trả named deny; không tự fallback lấy guard. `createAssistantInputAuthority(db,clock)` giữ frozen interface; composition lấy prepare từ cùng internal implementation, không nhận callback từ request. Bootstrap trước turn dùng nhánh riêng chỉ designation/consent, không giả một turn đã admitted.

| Operation | Khóa trước authority | Sau guard011 | Điểm kiểm cuối |
|---|---|---|---|
| G1 child/decision/dependency/signal/command | journal event_cursor; discover rồi sorted roots→tickets→projects | guard→machineA→config→designation→turn→monitor; rồi target input/grant/session theo scope | actor/fence/scope/action/hash/current input/expiry sau mọi wait, trước cached result và effect |
| Issue/bootstrap unrouted message | event_cursor; không existing root; project chỉ nếu scope đã pin project | guard/designation prefix; message→input→consent→grant; fresh selection/model gates trước admission | consent exact submitted hash; no model launch/admission nếu missing measured producer |
| Grant/snapshot/bind/session/receipt/bytes | event_cursor; resolve grant/session→target; current routed root→ticket→project trước guard | full fence; message→input→authorization→grant→session |009 callbacks chỉ recheck prepared rows/time; không lấy guard muộn |
| R3 route/correction | event_cursor; union old/new roots, affected descendants, parent, projects sorted | full fence; sorted messages/input targets→consent/grant/session; old execution/session retirement checks | persisted decision/hash/current route/revision trước creator; new rows chưa visible không cần khóa trước khi INSERT |
| Owner revoke/publication/comment | Giữ existing009 root/ticket/project/input ordering; không gọi Assistant guard | revoke/update grants/sessions sau input | nếu cascade derived consent phải discover **toàn bộ** affected roots/targets trước khóa input đầu tiên |

Short read transactions của snapshot/byte chunk hiện không có event_cursor. Đề nghị initial safe composition lấy event_cursor trước entity discovery để routing không đổi root giữa discovery và input lock; giải phóng sau mỗi bounded authorize, không giữ suốt byte stream. Đây là serialization trade-off cần PM duyệt, không khẳng định journal tự bảo vệ các read hiện tại. Không lock root mới sau guard: nếu recheck thấy topology khác, rollback409 và retry bằng Tx mới.

`createRoutingServices` hiện có authority callback đủ sớm **so với work locks**, nhưng project ACL đã chạy trước callback và callback có thể bắt đầu guard trước root. Vì vậy callback hiện tại chưa tự tạo safe recipe. Scoped factory phải chạy prepare prefix trước lần authorize đầu (và trước replay); lần work gọi lại chỉ dùng locks/context đã giữ. R3 creator nằm sau input, chỉ gọi G1 bằng capability cùng Tx đã chuẩn bị; không gọi một full fence mới. Generic router/`authorizeTicketMutation` giữ nguyên.

Mọi session/scope expiry dùng clock_timestamp sau lock waits (bài học Slice A); field expired tại transaction start không thay current wall time. Source config gate của admission mới phải được khóa/đối chiếu trong prefix đã định, không query nguồn ngoài mạng dưới SQL lock. Đường admitted replay không re-gate source ON hoặc blanket config revision.

## 4. R3, text-only và docs: seam tiếp theo

**R3:** thêm `createMessageRouter({createTicket:RouteTicketCreator,authorizeRoutedInput?:RouteInputAuthorizationBridge,...trustedPreparation})` trả cùng service shape `{authorize,routeAssistantMessage}` như producer thực. `createRoutingServices` mặc định vẫn generic. `registerInputScopeRoutes` thêm optional captured `messageRouter`, mặc định tạo factory cũ. Private scoped branch thay đúng project-machine check đầu và `authorizeTicketMutation` check sau; cả hai dựa exact prepared authority, không boolean skip. Creator/bridge giữ signatures trong brief, actual actorA và caller Tx. Không pre-create ticket bên ngoài009.

**Consent derivation:** new internal grants helper `deriveRoutedInputAuthorization(tx,actor,input:{route:MessageRoute;parentAuthorizationId:Id}):Promise<OwnerInputAuthorization|null>` kiểm exact parent message/owner hash/current route/submitted originals, expiry≤parent và allowOriginal không tăng; ghi derived authorization +011 linkage trong cùng Tx với ticket/route/links. Parent revoke/current-route invalidation phải được kiểm ở mọi derived-grant use; planned cascade phải prelock tất cả lineage trước input, không trông chờ insert-only SQL trigger. Missing bridge/proof rollback toàn route. Route bump input làm old turn stale: chỉ durable route result/stop reconciliation, không dùng old session để assess tiếp.

**Text-only:** new internal `issueSubmittedTextReadGrant(tx,actor,input:{authorizationId:Id;target:InputTarget;inputRevision:string},authority):Promise<AssistantReadGrant>` chỉ mint sau exact persisted selected-inputs submission/derived-route consent. Phải kiểm `originals=[]`, submitted refs=[] thật, message text có nội dung, immutable message hash recompute với selected-inputs, producer-specific consent hash, no original permission. Generic createInputReadAuthorization/issue path vẫn không nhận empty tùy ý. Read-current branch chỉ nhận grant rỗng có provenance này và kiểm lại lineage mỗi lần.

011 text receipt chỉ pin exact admitted session/snapshot + message SHA + canonical ancestor comment IDs/hashes; text đọc từ những IDs này, recompute SHA trước delivery. Với ticket được route từ text-only message, message phải derive từ live route/parent consent, không lấy mọi conversation text hoặc sửa InputSnapshot DTO để chèn body. SourceRef/sibling/draft không tự thành input.

**Text decision conflict:** giữ `MessageDecisionInput.receiptId` nullable và FK009. Không ghi receipt text vào attachment table hoặc tự đổi coverage none thành all_selected. Đề nghị captured **separate text-decision verifier** cho exact submitted-text branch trong messages.ts/routes.ts: attachment refs phải rỗng; receiptId=null; verify actual current admitted session +011 text receipt đúng scope/hash, còn file branch vẫn bắt009 all_selected và thêm text coverage. Generic factory thiếu verifier vẫn deny. Positive branch chờ admission/native delivery producer; hiện chỉ contract/negative và real owner-consent test có thể được nghiệm thu.

**Docs:** `assistant/docs.ts` dùng caller Tx và exact authenticated current turn/input authority, `validPath`, bounded SQL trên project/snapshot/path, strict UTF-8/raw-byte SHA và allowlisted catalog. Không gọi generic readDocsPage bằng owner. Derive state từ **selected** snapshot và project.expected_commit; invalid audit giữ `auditState:'invalid'`, state không được current (DocRead state chỉ current/stale/unverified). Protocol caller ghi011 doc-read receipt và trả ID; page function giữ DocRead signature. Generic docs A→B vẫn404, catalog không lộ repository/checkout/token/endpoints. Chỉ invariant/read-projection tests trước coherent admission; production live success pending.

## 5. Exact ownership transfer và thứ tự TDD đề nghị

| Chunk | Paths cần release/transfer | Deliverable và gate |
|---|---|---|
| **B1 nhỏ nhất, đề nghị release trước** | MODIFY `v2/server/src/tickets/contracts.ts`, `v2/server/src/tickets/service.ts`; CREATE `v2/server/test/assistant-orchestration.test.ts` | assistantCreateTicket + private brand + shared create invariants; constructor default deny. Test-only captured authority rõ nhãn; không positive persisted admission/port/router. |
| B2 full G1 | MODIFY `v2/server/src/tickets/decisions.ts`, `v2/server/src/tickets/dependencies.ts`, `v2/server/src/execution/commands.ts`; CREATE `v2/server/src/tickets/assistant-access.ts`, `v2/server/src/assistant/orchestration.ts`; extend B1 tests | Các signatures G1 ở mục2, same-root/DAG/deploy/signal/command invariants. Commands ownership serialize với T4. Constructor authority seam/hash phải frozen trước code. |
| B3 input locks/consent | CREATE `v2/server/src/assistant/input-locks.ts`, `v2/server/src/assistant/input.ts`, `v2/server/test/assistant-input.test.ts`; MODIFY `v2/server/src/attachments/grants.ts`, `v2/server/src/attachments/routes.ts` | Cùng-Tx prepared context/early locks, real submitted text consent and exact-empty grant. Không sửa references/snapshots nếu wrapper prelock/recheck đủ; nếu không đủ phải xin đúng path trước, không sửa ngầm. Positive session vẫn deny tới producer admission. |
| B4 R3/text decision | MODIFY `v2/server/src/attachments/routing.ts`, `v2/server/src/attachments/messages.ts` và B3 paths; CREATE `v2/server/test/assistant-route-integration.test.ts` | Scoped router/creator/derivation/nullable text proof branch. Đây là transfer thêm messages.ts ngoài R3 list ban đầu, cần PM ruling explicit. Exact routing-decision linkage và text verifier phải chốt trước positive code. |
| B5 docs/current authority | CREATE `v2/server/src/assistant/docs.ts`, `v2/server/test/assistant-docs.test.ts`; future MODIFY frozen `assistant/authority.ts` chỉ khi PM release mới | Raw docs projection/allowlist/negative scopes. Positive resolver/admission không release cùng B1. Không đổi frozen Slice A source trong preflight này. |

Không cần sửa `tickets/authorization.ts`, generic docs/read.ts, SQL, contracts DTO, app, package, manifests hoặc fixture files hiện hữu. New helper/test paths là **proposal**, chưa được sở hữu để viết source. Docs flow delta do PM serialize: server-tickets/execution/attachments/assistant/docs-view; worker chỉ draft đúng flow có source thay đổi.

### B1 behavioral RED → GREEN

- [ ] Chuẩn bị minimal loadable scoped method delegating current generic producer; test fail bằng HTTP/service outcome404 thay ticket actorA, không dùng import/compiler error làm RED. Ghi riêng scaffolding baseline.
- [ ] Private PostgreSQL11: actual machine provisioning + project bind B; `ticketFixture`/`inputTicket`/real mutator dựng hierarchy. Captured test-only authority kiểm exact actorA/action/hash/operation allowlist và DB target, không simply `async()=>true`, không policy receipt/admission rows. Cùng equivalent generic createTicket/HTTP vẫn404; default absent authority503.
- [ ] Có ticket tạo qua scoped path với `created_actor_kind='machine',created_actor_id=A`; journal actorA; B offline không cản metadata. Trust fixture kiểm action/hash/root/project/operation đúng allowlist và exact Tx. Wrong action/hash/root/project/operation, đổi input khi verify đang await, changed dependency object sau factory, owner actor substitution đều deny hoặc giữ exact originally validated input. Cùng proof thử ở Tx thứ hai phải gọi verify mới và bị fixture từ chối nếu không được cấp; không reuse private token của Tx đầu. Không export brand constructor/token chỉ để test; generic public input có forged capability field không thể mở scoped path.
- [ ] Shared-invariant negatives: closed parent/root, wrong level/project, workflow pin mismatch, invalid JSON, deploy root by A403, deploy child thiếu/sai exact owner approval403. Real same-root approval hợp lệ chỉ giữ quyền đúng input; không kế thừa blanket owner intent.
- [ ] Sau semantic RED mới extract shared core/mint capability; chạy affected B1 tests và existing tickets/deploy/dependencies cover phù hợp, scoped strict/Biome theo slot. Report rõ test-only port; production persisted resolver vẫn deny. Independent review B1 trước B2/B3.

### Regression bắt buộc cho các chunk sau

| Boundary | Behavioral assertion |
|---|---|
| B2 G1 parity | two-connection opposite DAG edges chỉ một commit; revisions/closed root giữ; forbidden owner_answer/approval/execution signals; command target/bindingB đúng, A claim/read/ACKB vẫn404; wrong proof/replay không thêm effect. |
| B3 order | Hai real DB connections, handshake+pg_blocking_pids: prepare→input trong grant/snapshot/session/byte và guard reassign→read; publication/comment/revoke/reroute thắng cả hai thứ tự. Query lock_timeout bounded; không chỉ sleeps. Expiry sau input wait và thiếu prepared context deny, rows không đổi. |
| B3 consent | Actual owner text submission selected-inputs tạo auth[]; none/draft/unsubmitted/wrong message/forged hash/allowOriginal/expired deny; bind ready exact-empty snapshot không cấp model admission. Nonempty selected refs/derivatives vẫn giữ accepted009 behavior. |
| B4 route | Test-only explicit authority boundary + actual009 transaction: A≠B one ticket/route/links/auditA; same replay one; injected link/derived-consent failure rollback tất cả. Generic factories old ACL404. Parent revoke/route change deny derived grant; unsafe old attempt/session deny correction. |
| B4 text/FK | Không thể dùng011 receipt ID làm009 receipt; null branch thiếu text verifier/current admitted session deny; selected image không thể đi text-only; wrong message/ancestor hash, sibling text và stale snapshot deny. Positive native delivery còn pending. |
| B5 docs | Exact project/snapshot/path, UTF-8/SHA, current/stale/unverified/invalid audit giữ provenance; catalog redaction; forged fence/foreign scope deny; generic docs/claim negative giữ. Missing admission never yields successful docs response. |

R2 end-to-end tools→route→new bootstrap→run/candidates→capacity→claimB vẫn pending T3/T4/G2/T7; không seed quyết định/assessment/dispatch để gọi đó là integration. Public Codex/Claude protocol acquisition hiện có không thay measured certifier.

## PM rulings cần trước source release

1. Release riêng B1 exact ba paths; chốt target-hash tuple và test-only captured authority boundary. Không mở toàn Slice B một lượt.
2. Chấp thuận internal constructor authority seam B2; private brand không thay public ACL/DTO.
3. Chấp thuận early event_cursor trên bounded input reads, prepared same-Tx context và route prelock union trước guard; không late fence. Nếu không dùng event_cursor, cần phương án topology discovery/retry chứng minh hai winning orders trước code.
4. Chốt explicit persisted routing-decision linkage cho positive new-root verifier; direct new-root actions vẫn deny tới lúc chốt. Chốt nullable text decision verifier độc lập với009 receipt FK; transfer thêm messages.ts khi cần.

Static freeze đã đối chiếu: authority `9fea4d72fb779daba72d39fc748eb24ed6401301955b369944ccce1e4c5b19cf`; routes `7ee13c26003aaf83cdaf18a887a96e8580012a7925a7135b35d61cf25e292df1`; test `0366f1b7412c7534ec6b10ce25905d9116d6668fb6b7aecdb8839bf763711c90`; contracts `adee25f453fa91e7498a1a300d3c7a4761147b8584e738a54818d9cb4b65412f`; SQL009 `fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a`; SQL011 `fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841`. Không sửa các file/evidence đã hash. **STATIC READY FOR PM RULING**, chưa implementation/test PASS cho Slice B.
