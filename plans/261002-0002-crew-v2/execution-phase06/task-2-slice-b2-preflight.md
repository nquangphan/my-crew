# T2 B2 — bounded producer preflight

**STATIC ONLY, baseline B1 accepted/committed `340851c` (PM). Đề nghị release B2a: scoped decision + dependency.** Signal/command được khảo sát dưới đây nhưng cần execution seam riêng; không mở chúng trong cùng batch nhỏ. Đã đọc current server-tickets/server-execution/server-assistant flows, approved T2 brief G1 và Slice B preflight. Không sửa source, chạy Node/PG/tests/types/Biome/Git/native/model hoặc tạo subagent.

## 1. Actual producers và invariants phải giữ

| Producer hiện tại | Contract và hành vi thực tế |
|---|---|
| `tickets/decisions.ts:103–167` | `recordDecision(tx,ticketId,input:DecisionInput,actor,docsSource?):Promise<Id>`. `owner_answer` mới khóa root/ticket; các kind khác gọi generic `requireTicket` không lock. Validate kind/content/rationale≤32768, sources≤100, JSON scope/sources; machine không ghi approval/owner_answer. Deploy approval pin đúng ticket/root/hash. `sourceExists(:68–101)` kiểm ticket/owner-decision/artifact cùng root/project, artifact locator và docs callback. INSERT lưu actual actor. |
| `tickets/dependencies.ts:7–53` | `addDependency(tx,ticketId,predecessorId,expectedRevision):Promise<Dependency>` **không có Actor/ACL**. Revision safe integer, same root/project, root chưa closed, target revision/status pending/needs_input/paused, recursive CTE chống cycle, duplicate409, increment revision/event. Locks root→target; predecessor đọc không lock. Generic ACL nằm ở `tickets/routes.ts:253–276`: authorizeTicketMutation trước cache rồi requireTicket trước producer. Không được giả rằng direct generic function A→B trả404. |
| `tickets/service.ts:370–474` | `signalTicketWithDependencies` khóa root→target rồi generic scope; revision CAS; dependencies_ready kiểm predecessor done. Execution signals cần internal+execution proof; public HTTP chỉ nhận3 signals qua route. Running wait_owner gọi `execution.requestTerminalIntent` rồi update reason/revision, giữ status từ row sau callback. Resume repair5 tiêu exact owner decision; passed cần completion facts. Scoped port chỉ cho dependencies_ready/wait_owner, không resume/start/passed. |
| `execution/commands.ts:22–56` | `createCommand(tx,input:CreateCommand,actor):Promise<Command>`. Validate type/payload JSON; root→joined ticket/project FOR UPDATE; actual binding/machine revocation; generic machine actor phải là target machine; start cần ready. INSERT queued command pin binding_revision, event audience là machine B. **Không actor column trong command DTO/INSERT**; audit A phải là journal actor của caller, không bịa created_actor_id. |
| `execution/commands.ts:131–182`, `tickets/authorization.ts:4–29` | Existing HTTP replay ACL khóa root/ticket/project, ticket helper giữ current machine FOR SHARE. Không sửa helper/route generic để cấp A→B. |

`docs/read.ts:137–141` current DocsSourceReader chỉ SELECT exact project/snapshot/path, không khóa authority/input và không đọc byte native. Source validation giữ trong cùng caller Tx; reader absent phải SOURCE_UNVERIFIED. Generic decision vẫn cho timeline decision ở closed tree nếu invariants hiện hành cho phép, không tự áp dependency closed-tree rule cho decision.

## 2. B2a smallest coherent release và exact contracts

Giữ nguyên frozen `assistant/contracts.ts:89–119` (OrchestrationProof, actions, authority.verify và ProjectOrchestrationPort), generic method signatures/ACL và optional dependency đã có từ B1. Additive factory methods:

```ts
assistantRecordDecision(tx: Tx, actor: Actor, proof: OrchestrationProof,
  ticketId: Id, input: DecisionInput): Promise<Id>;
assistantAddDependency(tx: Tx, actor: Actor, proof: OrchestrationProof,
  ticketId: Id, predecessorId: Id, expectedRevision: number): Promise<void>;
```

Exact target hash kế thừa B1: SHA256(canonicalJson(['crew-v2:orchestration-target:1', action, exactPayload])). B2a payload đề nghị freeze: decision `{ticketId,input}`; dependency `{ticketId,predecessorId,expectedRevision}`. UUID spelling/omitted/null không normalize trong payload; canonical UUID chỉ dùng DB identity comparisons. Snapshot descriptor-safe input+actor+proof trước first await, guard array getter/iterator/prototype giống accepted FIX1. Capture authority/docsSource methods khi factory tạo; absent assistant503; scoped machine-only; actor trong decisions/journal vẫn A.

**Private prepared context proposal, internal-only:** tạo `tickets/assistant-access.ts` để dùng chung snapshot/hash/prefix/capability thay copy B1 guard. API nội bộ đề nghị (opaque types, không frozen/public DTO):

```ts
captureAssistantOperation<T>(actor:Actor, proof:OrchestrationProof,
  action:OrchestrationAction, payload:T): CapturedAssistantOperation<T>; // synchronous immutable
createAssistantAccess(authority?:ProjectOrchestrationAuthority): {
  prepare<T>(tx:Tx, operation:CapturedAssistantOperation<T>, ticketIds:readonly Id[]):
    Promise<PreparedAssistantTarget<T>>;
  authorize<T>(tx:Tx, prepared:PreparedAssistantTarget<T>): Promise<VerifiedAssistantScope<T>>;
};
consumeAssistantScope<T>(tx:Tx, scope:VerifiedAssistantScope<T>,
  operation:CapturedAssistantOperation<T>, prepared:PreparedAssistantTarget<T>): void;
```

Capture/prepare/verified types có module-private unique brand + WeakMap identity, không exported brand constructor/mint-from-object. `prepare` tự đọc/khóa actual root/tickets/project và bind exact operation/Tx/canonical target set; JSON hoặc cast không tạo được context. `authorize` chỉ mint verified identity sau captured verify(tx,actualActor,proof,action,targetHash); consume một lần kiểm exact Tx/actor/proof/action/hash/root/project/target IDs. `prepare` nhận IDs derive từ captured payload trong producer closure; validate correspondence và canonicalize/dedup/sort trước queries, không lấy IDs từ object caller sau await. Public methods không nhận prepared context/token/boolean. Generic core branch giữ old ACL; scoped core branch chỉ nhận token qua runtime registry.

B1 không cần đổi public behavior: trích descriptor-safe snapshot/hash primitive sang helper rồi service dùng lại; giữ current private create token trong service để tránh refactor B1 brand ngoài nhu cầu B2. Không phải redo B1 acceptance; cover47 current B1 khi helper được extraction. B2 decision/dependency token nằm private helper và chỉ các invariant core được consume. Shared `prepareDecision`/`persistDecision` và `prepareDependency`/`persistDependency` tách existing logic một lần, không copy INSERT/CTE hoặc mở thêm bypass argument trong exported generic functions.

### Exact ownership proposal (chưa release)

| B2a path | Thay đổi cần thiết |
|---|---|
| MODIFY `v2/server/src/tickets/service.ts` | Add2 scoped factory methods, capture authority, dùng extracted safe snapshot primitive; generic create/signal giữ behavior |
| MODIFY `v2/server/src/tickets/decisions.ts` | Shared validate/source/owner/deploy invariant preparation và single INSERT core; internal scoped factory/entry dùng opaque scope |
| MODIFY `v2/server/src/tickets/dependencies.ts` | Shared root/status/revision/cycle preparation và single insert/revision/event core; scoped entry returnvoid, generic vẫn Dependency |
| CREATE `v2/server/src/tickets/assistant-access.ts` | Descriptor-safe snapshot/hash extraction và private captured/prepared/verified identity helper ở trên |
| CREATE `v2/server/test/assistant-mutations.test.ts` | B2a trust-port/real-DB/security/invariant tests; không sửa shared test fixture |

`tickets/contracts.ts` không cần field mới cho B2a vì assistant/docsSource đã có; không xin transfer execution/commands.ts hoặc attempts.ts trong batch này. PM tích hợp docs/manifest sau review; worker chỉ draft flow dưới plans nếu được release. No changes authorization.ts/routes/app/SQL/frozen DTO/global canonicalizer/native producers.

## 3. Lock order và callback boundary

| Operation | Trước captured authority.verify | Sau verify / same-Tx core |
|---|---|---|
| Scoped decision | caller journal/event_cursor; discover root; root FOR UPDATE→target ticket→project; immutable validation+owner-kind checks+source validation. DocsSourceReader gọi ở preparation trước authority (current actual reader SELECT-only). | Consume prepared token; INSERT decision +metadata event. Không acquire thêm root/project/guard/input hoặc gọi docs source lại. Exact source/target canonical root bind trong prepared context. |
| Scoped dependency | journal/event_cursor; discover cả2 IDs, reject cross-root/project; root→sorted canonical target+predecessor→project; re-read membership/status/revision dưới locks, CTE cycle/duplicate validation | Consume token; existing dependency INSERT +revision update+event. Root lock serialize opposite edges; không gọi generic wrapper để mở khóa entity khác sau authority. |
| Future authority suffix | Chỉ sau toàn entity prefix: calibration guard→machine A→config→designation→turn→monitor; input/consent suffix thuộc producer B3 chưa release | Current production authority vẫn deny. Không dựng guard check trong callback muộn hoặc pretend prepared context chứng nhận input/admission. |

Không ngầm xác nhận docs callback bất kỳ là lock-free: chỉ actual reader được inspected là SELECT-only; producer callback phải hoàn tất trước verify. Việc source chuẩn bị trước verify chỉ đọc metadata, không trả docs content hoặc mint scope. Decision immutable append và source FK/IDs hiện có dùng cùng Tx; source failure rollback trước authority. Không sửa frozen011 scope để bù missing root/routing-decision linkage.

## 4. Signal/command seam cần ruling riêng trước B2b

Giữ signatures dự kiến từ approved G1:

```ts
assistantSignalTicket(tx:Tx,actor:Actor,proof:OrchestrationProof,ticketId:Id,
  signal:'dependencies_ready'|'wait_owner',expectedRevision:number):Promise<Ticket>;
createAssistantCommand(tx:Tx,input:CreateCommand,actor:Actor,proof:OrchestrationProof,
  authority?:ProjectOrchestrationAuthority):Promise<Command>;
```

Hash future signal `{ticketId,signal,expectedRevision}`, command exact full CreateCommand. Do not pass owner substitute. `createAssistantCommand` separate entry captures supplied method before first await; future orchestration composition must capture that authority at constructor creation. Brief `createProjectOrchestrationPort({inputAuthority,tickets,models})` chưa có command authority dependency: internal-only captured command closure/authority addition vẫn là proposal, không silently đổi frozen port.

**Running wait_owner blocker cụ thể:** `execution/attempts.ts:389–393` existing createExecutionAuthority callback gọi setTerminalIntent với `{kind:'owner',id:'owner'}`; `:560–577` lock attempt, update terminal intent, có thể call generic createCommand; callback còn finalize ngay nếu stopped (`:393`), dẫn tới execution guard/attempt updates và shared internal signals (`:530–541`). Scoped A→B **không reuse callback này**. `lockedAttempt(:78–87)` giữ root rồi t/g/a; claim(:149–175) root→command→ticket→project→execution_guard. Vì vậy full safe B2b cần transfer chính xác `v2/server/src/execution/attempts.ts` ngoài G1 commands allowance để thêm private prepared terminal-intent producer: prelock root/target/project/guard/attempt/current command set trước Assistant verify, giữ actual A provenance và B target; apply chỉ dùng same-Tx prepared context, không mở late generic command/finalize lock chain. Chưa chốt thứ tự union của command/attempt với T4/T5, nên đề nghị defer whole signal method thay giả thành công branch running.

**Command:** existing createCommand queue không cấp claim/admission/stop proof; start ready check và binding revision vẫn bắt buộc. Pause/cancel owner HTTP có decision/terminal-intent semantics riêng ở `execution/routes.ts:176–217`; scoped queue không được coi là owner intervention. Target B revocation/binding phải kiểm hiện hành, cần recipe bảo vệ B row tương thích guard→machine A ordering; không thêm B FOR SHARE trước011guard hoặc acquire B trong late callback. Future actorA journal/operation receipt là provenance; schema không có command actor column. Command method cũng defer cùng B2b cho tới concrete lock/constructor ruling; không xin SQL hoặc positive producer override.

## 5. Meaningful B2a RED và regressions

- Scaffold loadable2 methods gọi existing generic producers: decision positive A→B fail404; dependency may already insert (generic has noActor), nên semantic RED chính là absent/wrong proof/action/hash/Tx/scope vẫn insert thay deny. Không dùng import/compiler/setup failure làm RED.
- Actual prefix11 fixture từ provisionMachine/bindProject/ticketFixture/mutate; test-only captured authority explicit allowlist exact actorA/proof/action/hash/Tx/canonical root/project/target IDs. Không mint scope/certifier/native receipt. Generic **route/caller ACL** A→B negative, không viết misleading direct addDependency404 test. Journal actorA giữ raw body; actual decision actorA; dependency bảng không có actor column.
- Default503, owner substitution403; forged JSON/cast context không authorizes. Cross-root/project, stale revision, duplicate/self edge/cycle, root closed, ready/running target deny. Opposite edges qua2 DBconnections serialize root, một edge thắng một cycle409; missing target rollback.
- Decision machine owner_answer/approval luôn403 kể cả trust port exact grant; invalid/empty/oversized content/rationale, sources>100/unsafe JSON, cross-root ticket/ownerdecision/artifact source, wrong locator, docs missing reader/wrong snapshot/path deny; actual matching sources pass qua existing producer fixture, không fake verified receipt. Closed-tree generic timeline semantics giữ nguyên.
- Immediate/deferred mutation input/actor/proof, array getter/iterator/prototype, uppercase target/predecessor/source UUID exact hash versus lowercase allowance; dependency expectedRevision included in hash. Capture method replacement không mở quyền; Tx2 không reuse Tx1 token. Prefix NOWAIT peer witnesses trước authority; docs callback witness chạy trước verify và không gọi lại sau verify. Failure leaves decisions/dependencies/revision/events unchanged.
- GREEN only after actual semantic RED and scheduler grant: new focused file + accepted B1 file (helper extraction) + existing tickets/dependencies/deploy relevant; scoped strict/Biome exact transferred files, no full-server/native PASS. No test work started in this static phase.

**PM ruling requested:** release only B2a exact5 paths và freeze2 payload objects/private helper seam; retain B2b signal/commands+attempts ownership/constructor/lock recipe pending. Existing production persisted resolver và scope/routing-decision linkage vẫn default-deny. Không cần hỏi owner về scope đã có; proposal này reversible và reviewable trước authoring.
