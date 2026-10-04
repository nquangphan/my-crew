## Task 5: Durable commands, fenced attempts and reconnect reconciliation

**Owner:** execution worker. **Files:** create `src/execution/{contracts,commands,attempts,reconcile,routes}.ts`, `migrations/005_execution.sql`, `test/{commands,attempts}.test.ts`; wire binding guard through function export, no edit app.ts. Docs `server-execution.md`.

**Interfaces:** `Command={id:Id,machineId:Id,ticketId:Id,type:'start'|'pause'|'cancel'|'resume'|'reconcile',payload:Record<string,unknown>,state:'queued'|'received'|'completed',result:Record<string,unknown>|null}`; `Attempt={id:Id,ticketId:Id,machineId:Id,commandId:Id,fence:string,bindingRevision:number,processInstanceId:string,state:'active'|'uncertain'|'finalizing'|'stopped',leaseExpiresAt:string,workflowPin:Pin,checkpoint:Checkpoint}`; `Checkpoint={sequence:string,step:string,artifactIds:Id[],commit:string|null,processInstanceId:string}`. `claimAttempt(tx,commandId,input:{processInstanceId:string,permit:DispatchPermit},actor,authorizeDispatch):Promise<Attempt>`; `saveCheckpoint(tx,attemptId,input:Checkpoint & {fence:string},actor):Promise<Attempt>`; `reconcileAttempt(tx,attemptId,input:{fence:string,processInstanceId:string,observation:'running'|'stopped',artifacts:Id[],stopReason:null|'pause'|'cancel'|'exit'},actor):Promise<Attempt>`; `assertNoActiveProjectExecution(tx,projectId):Promise<void>` implements Task3 BindingGuard. `CreateCommand={machineId:Id,ticketId:Id,type:Command['type'],payload:Record<string,unknown>}`; `createCommand(tx:Tx,input:CreateCommand,actor:Actor):Promise<Command>`; `ackCommand(tx:Tx,commandId:Id,input:{phase:'received'|'completed',result?:Record<string,unknown>},actor:Actor):Promise<Command>`; `listCommands(db:Db,actor:Actor,after:Id|null,limit:number):Promise<Command[]>`. Command ack result does not signal process stopped; reconcile is separate.

**Terminal contracts (I1):** `TerminalIntent='complete'|'retry'|'pause'|'cancel'|'needs_input'`; `AttemptResultInput={fence:string,processInstanceId:string,outcome:'passed'|'retry'|'needs_input',evidenceIds:Id[],reason:string|null}`; `submitAttemptResult(tx:Tx,attemptId:Id,input:AttemptResultInput,actor:Actor):Promise<Attempt>`; `requestTerminalIntent(tx:Tx,ticketId:Id,input:{intent:'pause'|'cancel'|'needs_input',reason:string,decisionId:Id},actor:Actor):Promise<Command|null>`; `finalizeAttempt(tx:Tx,attemptId:Id,verify:FinalResultVerifier):Promise<Attempt>`; `FinalResultVerifier=ServerOptions['verifyFinalResult']` rejects unverified completion/retry authority. `verifyFinalResult` is frozen in Task1 ServerOptions with primitive facts only (no import of later execution module); production default denies completion requiring unavailable trusted verifier, while phase02 research/docs owner approval explicitly references immutable evidence and fulfills research criteria; never accepts client `verified:true`. Phase08 supplies trusted merge/docs verifier. Attempt DTO adds terminalIntent, terminalReason, terminalResult, stoppedAt, finalizedAt. Result endpoint `POST /v2/machine/attempts/:id/result` accepts AttemptResultInput, target machine only, idempotent. Evidence arrives through append-only evidence record with attempt/project linkage; result cannot refer other attempt evidence.

Atomic flow (same journal mutation transaction, locked ticket+guard+attempt): (1) validate actor/fence/launch identity, (2) persist result or stopped observation independently, (3) call finalizeAttempt; if physically still running, no status change; if stopped but complete result missing/unverified, keep finalizing+guard and running/final_result_pending; (4) confirmed pause/cancel intent applies pause_confirmed/cancel_confirmed from running; needs_input applies wait_owner from running with stored reason/decision; complete with outcome passed invokes verifier and completion facts then passed; explicit retry outcome invokes verifier authorizing retry then reconciled_stopped; (5) in the same transaction update ticket revision/status/reason, attempt.state=stopped/finalized_at, clear guard only WHERE active_attempt_id matches, append terminal event. Verifier refusal/unavailability is persisted finalizing with error reason and no release (result API200 pending finalization), not rollback lost stop proof. `finalizeAttempt` catches only explicit ApiError verification-gate codes and records pending reason; unexpected DB/service errors roll transaction back safely. Late result insertion uses fenced result route; to keep minimal protocol result payload remains immutable after accepted submission: submit can reference previously reported evidenceId, verifier state may advance, same original idempotency key always returns cached response and does not rerun finalization; a new finalize mutation key below explicitly re-evaluates stored result. Use a new idempotency key for re-evaluate action `POST /v2/machine/attempts/:id/finalize` body `{fence,processInstanceId}`; exact service `recheckFinalization(tx:Tx,attemptId:Id,input:{fence:string,processInstanceId:string},actor:Actor):Promise<Attempt>` validates same reserved guard and invokes finalizeAttempt using stored result. Completion evidence records verification advancement are append-only verifier attestations linked to original evidenceId, not overwriting evidence bytes. This endpoint never creates an attempt or changes result data. Malformed evidence/other attempt422 rolls back incoming result. Result before exit persists pending, exit later finalizes; exit before result reserves until late result. Lease timeout does not block result/reconcile in finalizing; checkpoint progress writes after physical stop reject PROCESS_STOPPED. Owner cancellation dominates all results; needs_input (including fifth failed repair cycle) dominates pause/complete/retry; explicit owner pause dominates normal result; once cancelled intent committed cannot revert. Result outcome needs_input creates a scoped question decision and terminal_intent needs_input unless cancel already wins; reason required. Result changing after finalization409 except identical replay. Retry clears guard only after recorded result handled; dependency readiness is a subsequent checked mutation, never automatic ready on exit.

```ts
test('exit trước result và restart vẫn hoàn tất từ running',async()=>withDatabase(async db=>{
  const f=await executionFixture(db); const a=await f.claim('launch-result');
  await f.reconcile(a,{observation:'stopped',stopReason:'exit'});
  assert.equal((await f.readAttempt(a.id)).state,'finalizing');
  assert.equal((await f.readTicket()).status,'running');
  await assert.rejects(()=>f.claimReplacement('second'),{code:'FINAL_RESULT_PENDING'});
  await f.restart(); // close/reopen service/app pool to same own test DB
  const evidence=await f.verifiedResearchEvidence(a.id);
  await f.submitResult(a,{outcome:'passed',evidenceIds:[evidence.id],reason:null});
  assert.equal((await f.readTicket()).status,'done');
  assert.equal((await f.readAttempt(a.id)).state,'stopped');
  assert.equal(await f.activeGuard(),null);
}));
test('result trước exit không đóng khi process còn chạy',async()=>withDatabase(async db=>{
  const f=await executionFixture(db); const a=await f.claim('launch-early');
  const e=await f.verifiedResearchEvidence(a.id);
  await f.submitResult(a,{outcome:'passed',evidenceIds:[e.id],reason:null});
  assert.equal((await f.readTicket()).status,'running');
  await f.reconcile(a,{observation:'stopped',stopReason:'exit'});
  assert.equal((await f.readTicket()).status,'done');
}));
test('wait_owner và vòng sửa thứ năm giữ đúng ý định sau stop',async()=>withDatabase(async db=>{
  const f=await executionFixture(db); const a=await f.claim('launch-question');
  await f.waitOwner('Cần quyết định owner');
  await f.reconcile(a,{observation:'stopped',stopReason:'pause'});
  assert.equal((await f.readTicket()).status,'needs_input');
  const g=await executionFixture(db,{repairCycles:4}); const b=await g.claim('launch-cycle5');
  await g.reconcile(b,{observation:'stopped',stopReason:'exit'});
  await g.recordRepairFailure(b,'cycle-five'); // completed repair-review, fenced evidence
  assert.equal((await g.readTicket()).repairCycles,5);
  assert.equal((await g.readTicket()).status,'needs_input');
}));
```

```ts
test('evidence đã báo được xác minh sau stop recheck không cần attempt mới',async()=>withDatabase(async db=>{
  const f=await executionFixture(db); const a=await f.claim('launch-verify-late');
  const e=await f.reportedResearchEvidence(a.id);
  await f.submitResult(a,{outcome:'passed',evidenceIds:[e.id],reason:null});
  await f.reconcile(a,{observation:'stopped',stopReason:'exit'});
  assert.equal((await f.readAttempt(a.id)).state,'finalizing');
  await f.attestEvidence(e.id); // append verifier attestation; original report unchanged
  await f.recheckFinalization(a,'new-finalization-key');
  assert.equal((await f.readTicket()).status,'done');
  assert.equal((await f.readAttempt(a.id)).fence,a.fence);
  assert.equal(await f.activeGuard(),null);
}));
```

Test fixture extends concrete methods shown above; no production bypass. Add response-lost after terminal commit→repeat same result returns done, exactly one terminal event/fence release; cancelled/pause override passed result; unverified late evidence keeps finalizing across restart; result+stop concurrent commits produce exactly one finalize. `recordRepairResult` invokes requestTerminalIntent then finalizeAttempt in same tx if fifth failure and process already finalizing; stopped finished unrelated attempts cannot alter newer run status.

- [ ] Write RED lease concurrency test using service fixture `executionFixture(db)` in `test/support/execution.ts`, grants valid permit only test callback, creates bound machine/project/ticket/queued start:

```ts
test('lease expiry không chứng minh process đã dừng',async()=>withDatabase(async db=>{
  const f=await executionFixture(db);
  const first=await f.claim('launch-1');
  await f.expire(first.id); // UPDATE only test DB lease_expires_at, no wall-clock wait
  await assert.rejects(()=>f.claimReplacement('launch-2'),{code:'RECONCILE_REQUIRED'});
  await f.reconcile(first,{observation:'running',stopReason:null});
  await assert.rejects(()=>f.claimReplacement('launch-2'),{code:'ACTIVE_EXECUTION'});
  await f.reconcile(first,{observation:'stopped',stopReason:'exit'});
  await assert.rejects(()=>f.claimReplacement('launch-2'),{code:'FINAL_RESULT_PENDING'});
  await f.submitResult(first,{outcome:'retry',evidenceIds:[],reason:'Hạ tầng lỗi; tiến trình đã dừng'});
  const second=await f.claimReplacement('launch-2');
  assert(BigInt(second.fence)>BigInt(first.fence));
  await assert.rejects(()=>f.checkpoint(first,{sequence:'1'}),{code:'STALE_FENCE'});
}));
test('claim đồng thời chỉ một quyền thực thi',async()=>withDatabase(async db=>{
  const f=await executionFixture(db);
  const outcomes=await Promise.allSettled([f.claim('launch-a'),f.claim('launch-b')]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await db`select count(*)::int as n from attempts where state in ('active','uncertain','finalizing')`)[0]?.n,1);
}));
```

- [ ] RED `pnpm --dir v2/server test --test-name-pattern='lease expiry|claim đồng thời|checkpoint|pause'`. Add command duplicate ack received/completed→same result, different completion body409; pause/cancel request retains running until process stopped; old/revoked/wrong machine403; checkpoint lower sequence409, duplicate identical sequence replay, duplicate sequence changed data409; binding update while uncertain409; all tests durable across closing/reopening pools.
- [ ] Implement under mutation global lock then project/root/ticket guard row locks. Create guard row with `INSERT INTO execution_guards(ticket_id) VALUES (...) ON CONFLICT DO NOTHING` before locking. Initial claim: target machine authenticated + current binding matches + ticket ready + command received/queued + exact pin + authorizeDispatch validates fresh permit (same tx). Pin workflow immutable per attempt; pin change creates new command/run context, never overwrite attempt. Only after gate increment guard fence and create attempt, apply domain start, append event in transaction:

```ts
const [guard]=await tx`select * from execution_guards where ticket_id=${ticket.id} for update`;
if(guard.active_attempt_id)throw new ApiError('RECONCILE_REQUIRED',409,'Cần đối chiếu tiến trình cũ');
await authorizeDispatch(tx,actor,input.permit);
const [g]=await tx`update execution_guards set fence=fence+1 where ticket_id=${ticket.id} returning fence`;
const attemptId=randomUUID();
await tx`insert into attempts(id,ticket_id,machine_id,command_id,fence,binding_revision,
  process_instance_id,state,lease_expires_at,workflow_pin,checkpoint,checkpoint_sequence)
  values(${attemptId},${ticket.id},${actor.id},${command.id},${g.fence},${project.binding_revision},
  ${input.processInstanceId},'active',now()+interval '60 seconds',${tx.json(input.permit.workflow)},${tx.json({})},0)`;
await tx`update execution_guards set active_attempt_id=${attemptId} where ticket_id=${ticket.id}`;
```

`authorizeDispatch` production default throws503 `DISPATCH_NOT_CONFIGURED`; no request may opt into test bypass. Phase06 implementation checks telemetry age/config capacity/dependencies/model/workflow/version and persists decision IDs; Task5 checks permit shape/time and target equality before callback, TTL<=30seconds, future checkedAt >5seconds reject, expired reject; incoming permit references cannot manufacture permission. Production gate callback receives stored command/ticket actor context from service, not unchecked permit only; freeze callback extended signature `(tx,actor,permit)` and require it load command/ticket itself by IDs.

Command types start/resume require gate at claim; pause/cancel/reconcile owner allowed irrespective unavailable model. Claim existing command+same processInstanceId returns existing attempt (even after response lost), different processInstanceId409; does not manufacture new fence. Checkpoint verifies guard.active_attempt_id, fence, binding revision, processInstanceId, machine target; lease expiry blocks writes except reconciliation, records uncertain and no second launch. Reconcile stopped must come authenticated host with matching durable launch ID and fence, observation provenance stored; browser owner cannot submit stop proof. Stopped observation changes attempt to `finalizing`, records stopped_at/stop_reason, and keeps guard reserved; ticket remains running with wait_reason `final_result_pending` until terminal result handled. Only atomic `finalizeAttempt` specified above changes ticket and releases guard; no separate passed from pending. Host cannot report new attempt stopped to close different process. Network/heartbeat timestamps alone never clear guard.

Artifacts references are durable UUIDs plus source metadata in checkpoint/evidence; no raw file filesystem deletion here. To eliminate arbitrary unregistered references phase02 evidence store defines `artifact` kind with canonical locator/checksum, append-only and same project; `artifactIds` resolve evidence records. Phase05 can add attachment references without erasing these IDs.

- [ ] GREEN tests process still alive/reconnect, crash after DB commit before HTTP reply returns same attempt, restart keeps fence, two pool instances cannot claim concurrently, late old checkpoint after replacement409. Test no configured gate makes server503 and zero attempt/event/status mutation.
- [ ] Update execution docs with protocol truth limits (machine attestation, real host stopping in03) and serialized commit `feat(v2): persist fenced execution and process reconciliation`; independent review permission escalation/fence wrap/lease misconception.

