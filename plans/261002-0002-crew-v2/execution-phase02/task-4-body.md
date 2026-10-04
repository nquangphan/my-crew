## Task 4: Ticket hierarchy, DAG, timeline and honest completion gates

**Owner:** tickets worker. **Files:** create `src/tickets/{contracts,service,dependencies,decisions,completion,repair,routes}.ts`, `migrations/004_tickets.sql`, `test/{tickets,dependencies,completion,repair}.test.ts`. Docs `server-tickets.md`.

**Interfaces:**

```ts
export type CreateTicket={projectId:Id;parentId:Id|null;level:'request'|'step'|'task';
  kind:'code'|'research'|'docs'|'deploy';title:string;description:string;mandatory:boolean;
  criteria:Record<string,unknown>;inputs:Record<string,unknown>;outputs:Record<string,unknown>;
  skill:string|null;workflowPin:Pin|null};
export type Ticket=CreateTicket & {id:Id;rootId:Id;status:Status;revision:number;
  waitReason:string|null;repairCycles:number;mergedCommit:string|null};
export type Dependency={ticketId:Id;predecessorId:Id};
export type RepairLink={checkStepId:Id;fixTicketId:Id;cycleId:Id};
export type SourceRef={kind:'docs'|'ticket'|'artifact'|'owner_decision';id:Id;path?:string;locator?:string};
export type DecisionInput={kind:'assessment'|'delegated'|'owner_answer'|'approval'|'intervention'|'dispatch';
  content:string;rationale:string;sources:SourceRef[];scope:Record<string,unknown>};
```

Service signatures `createTicket(tx:Tx,input:CreateTicket,actor:Actor):Promise<Ticket>`, `addDependency(tx:Tx,ticketId:Id,predecessorId:Id,expectedRevision:number):Promise<Dependency>`, `signalTicket(tx:Tx,ticketId:Id,signal:Signal,expectedRevision:number,evidenceId:Id|null,actor:Actor):Promise<Ticket>`, `recordDecision(tx:Tx,ticketId:Id,input:DecisionInput,actor:Actor):Promise<Id>`, `recordRepairResult(tx:Tx,input:RepairResultInput,actor:Actor):Promise<Ticket>`. `RepairResultInput={ticketId:Id,attemptId:Id,fence:string,cycleId:Id,classification:'initial_review'|'repair_review'|'infrastructure'|'model',passed:boolean,evidence:Record<string,unknown>}`; `Comment={id:Id,ticketId:Id,actor:Actor,text:string,createdAt:string}`; `appendComment(tx:Tx,ticketId:Id,text:string,actor:Actor):Promise<Comment>`; `readGraph(db:Db,ticketId:Id,actor:Actor):Promise<{nodes:Ticket[],dependencies:Dependency[],repairLinks:RepairLink[]}>`. Completion consumes persisted evidence + descendants + verified docs, never boolean input submitted by client. `createTicket` default workflow for request if caller omission: store workflow choice `superpowers` in `criteria.workflowChoice`; no fabricated version/revision pin. Request may workflowPin=null until run is created; step/task inherit exact parent pin once set and reject mismatches.

- [ ] RED tests tree and DAG:

```ts
test('concurrent opposite edges không tạo cycle',async()=>withDatabase(async db=>{
  const f=await ticketFixture(db); // creates project + request + two sibling steps a,b
  const add=(ticketId:Id,predecessorId:Id,key:string)=>f.mutation(key,tx=>
    addDependency(tx,ticketId,predecessorId,1));
  const results=await Promise.allSettled([add(f.a,f.b,'a-b'),add(f.b,f.a,'b-a')]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const failed=results.find(x=>x.status==='rejected') as PromiseRejectedResult;
  assert.equal(failed.reason.code,'DEPENDENCY_CYCLE');
  assert.equal((await db`select * from dependencies`).length,1);
}));
test('docs cũ không đóng request code',async()=>withDatabase(async db=>{
  const f=await completedStepsFixture(db,{kind:'code',mergedCommit:'a'.repeat(40)});
  await assert.rejects(()=>f.signal('passed'),{code:'COMPLETION_GATE'});
  assert.equal((await f.read()).status,'running');
}));
```

Fixtures `ticketFixture` and `completedStepsFixture` local `test/support/tickets.ts` defined in this task; functions create through services/mutator, no v1 fixture imports; completion test initially no docs tables uses `DocsCompletionReader` injectable returns null, Task7 supplies DB implementation. Tests also task under request400, cross-project parent409, cross-root dependency409, dependency prerequisite ready denied, mandatory descendant incomplete deny, research evidence allows no merge, deployed action approval machine403, comments during running create event but do not start second execution.

- [ ] RED `pnpm --dir v2/server test --test-name-pattern='cycle|hierarchy|docs cũ|repair'`.
- [ ] Implement root row lock for graph mutations; require request→step→task only, same project/root, graph immutable parent once created; recursive CTE traverse predecessor edges to detect new cycle. Global mutation cursor lock also serializes graph writes. Signal resolves domain transition with optimistic revision; `dependencies_ready` checks all predecessor.status=done, not arbitrary client bool. `start`, `pause_confirmed`, `cancel_confirmed`, `reconciled_stopped` cannot be called public signal route; Task5 uses internal `applyExecutionSignal(tx,...)` after process/lease proof. `wait_owner` from active/finalizing attempt persists terminal_intent needs_input+reason and queues existing pause command `{terminalIntent:'needs_input'}` (no undefined wait command); retains running until process stopped confirmation then atomic finalize applies domain wait_owner; cannot relabel running and re-dispatch. `passed` is internal-only via Task5 finalizeAttempt after confirmed stopped and persisted verified result/evidence. Public signals route rejects passed for active/finalizing execution, does not directly finalize from a browser status request. Owner cannot force done by update status.

```ts
const next=transition(ticket.status,signal);
if(signal==='passed' && ticket.level==='request'){
  const facts=await readCompletionFacts(tx,ticket.id);
  if(!canComplete(facts))throw new ApiError('COMPLETION_GATE',409,'Thiếu bằng chứng hoàn tất');
}
await tx`update tickets set status=${next},revision=revision+1 where id=${ticket.id}`;
```

`readCompletionFacts(tx,id)` computes mandatoryStepsPassed over all mandatory descendants, evidenceReady requiring evidence records of required criteria, mergedCommit from merge evidence event (phase08 trusted verifier later; phase02 don't accept arbitrary web commit), docsCommit only verified snapshot matching merge. `DocsCompletionReader(tx,projectId,commit):Promise<string|null>` fail-closed untilTask7. Non-request completion checks its own criteria/evidence; repair initial review zero cycles, only completed repair_review failure calls `recordRepairFailure`, infrastructure/model retain counter, duplicate cycle returns same result; fifth failure persists needs_input terminal intent and becomes needs_input through atomic finalize after execution stopped, next retry requires owner decision with kind owner_answer and scope `{repairStepId,continueAfterFive:true}`; count remains5. Fix-ticket relation created under same check-step root, no reset via new model/ticket.

- [ ] GREEN tests all domain signal invalid cases + inherited keys400; timeline decision sources require existing accessible docs/ticket or recorded external artifact locator, unknown sources422; server never claims evidence truthful merely because record exists: store `verification:'reported'|'verified'` in evidence.data, completion requires verified output type. Phase08 adds merge verification authority; until then code completion blocked.
- [ ] Docs ticket flow with seven statuses, process uncertainty, repair loop semantics; serialized commit `feat(v2): persist ticket hierarchy dependencies and decisions`; independent review graph concurrency/completion spoofing.

