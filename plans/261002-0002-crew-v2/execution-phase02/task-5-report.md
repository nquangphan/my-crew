# Task 5 — durable commands, fenced attempts, reconciliation

## Trạng thái

READY for integration review. Two cross-owner gaps found during review were fixed with PM-approved narrow extensions. No commit, no shared DB, no app/main/manifest edit. Migration fixture used prefix 005 on isolated Docker test DB.

## RED → GREEN evidence

| Behavior | RED observed | GREEN observed |
|---|---|---|
| Initial claim, crash/lost reply, concurrent claim, stop/result ordering | `ERR_MODULE_NOT_FOUND` for unimplemented execution service; then whitelist `EVENT_INVALID` | `attempts.test.ts` claim only one launch; same launch returns same attempt; stopped guard stays reserved; result before stop stays running |
| Execution event metadata | `EVENT_INVALID` on valid `command.created` | `execution-events.unit.test.ts` accepts exact metadata, rejects token extra field |
| Binding revision after rebind | checkpoint returned success after changing project binding | stale binding gives `STALE_BINDING`; read gets scoped 404 |
| Lease expired | update `uncertain` rolled back with thrown `LEASE_EXPIRED` | state persists `uncertain`, sequence unchanged, guard reserved; route returns 409 `LEASE_EXPIRED` |
| Needs-input question | no scoped decision existed after machine result | append-only `assessment` decision records action/attempt ID |
| Reconciliation provenance | `reconciliation_observations` table absent | running/stopped observations persist machine, launch ID, fence, reason; conflicting stop reason 409 |
| Fence bigint exhaustion | raw PostgreSQL `22003` | explicit `FENCE_EXHAUSTED` before permit callback/attempt/status mutation |
| Finalizing replacement | second queued command got generic `TICKET_NOT_READY` | `FINAL_RESULT_PENDING` while stopped result awaits verification |
| Fifth-cycle/internal needs-input after stop | callback left ticket `running`; after permitting finalizing proof, Task 4 repair write reverted status to `running` | authority finalizes to `needs_input`; repair write preserves status, `repair_limit` and monotonic revision |
| Cached reply after same-machine rebind | ACK replay 200; create-command replay 202 | both scoped 404 after binding revision changes |
| Transactional replay ACL | journal replay ignored `authorize` hook | hook runs under `event_cursor` transaction lock before cache/work; project lock blocks concurrent rebind in barrier test |
| JSONB duplicate replay | identical checkpoint returned `CHECKPOINT_CONFLICT` due object key order | canonical JSON comparison accepts identical checkpoint/result, still rejects changed values |
| Artifact producer and scoped references | route returned 404; checkpoint could only refer to records inserted by test setup | authenticated `POST /v2/machine/attempts/:id/artifacts` creates append-only, same-attempt reported evidence; returned ID works in checkpoint, foreign ID rejected; exact response replay remains scoped after rebind |

## Files

- New: `v2/server/migrations/005_execution.sql`; `v2/server/src/execution/{contracts,commands,attempts,reconcile,routes}.ts`; `v2/server/test/{attempts,commands,execution-events.unit}.test.ts`; `v2/server/test/support/execution.ts`; `v2/docs/flows/server-execution.md`.
- PM-approved narrow extensions: `v2/server/src/journal/{event-contracts,mutation}.ts`, `v2/server/src/platform/contracts.ts`, `v2/server/src/tickets/repair.ts`, and R3 docs `v2/docs/flows/{server-journal,server-platform,server-tickets}.md`.

## Exported integration hooks

- `registerExecutionRoutes(app,options,deps,{docsCompletion?})` supplies machine routes and optional verified snapshot reader for Task 7. Production `ServerOptions.authorizeDispatch` must be `denyDispatch` until Phase 06 authorizer loads and verifies persisted command/ticket/telemetry/decision under the same Tx. `ServerOptions.verifyFinalResult` must be `denyFinalResult` until a trusted verifier is installed. Neither public request can set a `verified` boolean.
- `assertNoActiveProjectExecution(tx,projectId)` is the Task 3 `BindingGuard`; controller/Task 7 should pass it to `registerProjectRoutes`. It blocks active/uncertain/finalizing attempts, including expired leases.
- `createExecutionAuthority()` is for `createTicketServices({execution,...})` and `registerTicketRoutes` dependency injection. It verifies current guard/attempt/fence for internal signals and repair results. Task 7 must wire the same authority so ticket endpoints can request needs-input while running. `requestTerminalIntent` creates pause/cancel commands from owner decisions and finalizes an already stopped attempt.
- `createCommand`, `ackCommand`, `listCommands`, `readCommand`, `claimAttempt`, `saveCheckpoint`, `reconcileAttempt`, `readAttempt`, `submitAttemptResult`, `recheckFinalization`, `finalizeAttempt` are Tx-scoped/service exports for gateway bridge. Gateway polls command pages from `after:null` each pass; page anchor is not Phase 03 journal cursor. Fresh scoped GETs recover ambiguous mutation replies; exact mutation key/body is replayed.
- `registerArtifactEvidence(tx,attemptId,{fence,processInstanceId,locator,sha256,sourceCommit},actor)` is exported, and the remote host uses `POST /v2/machine/attempts/:id/artifacts` with `Idempotency-Key` and that exact body. A 201 response is `{id,locator,sha256}`; exact key/body replay returns the same 201 response after current ACL check. The locator is run-relative NFC, 1–4096 chars, with no absolute path, traversal, empty segment, backslash, colon, control character or URI marker; SHA-256 is 64 lowercase hex; source commit is 40/64 lowercase hex or null. The server records `verification:'reported'` and does not open the locator/read bytes/fetch network. Same guard/fence/process can register while finalizing; finalized attempts reject new registration but allow scoped durable replay. Phase 03 materializes artifacts; Phase 08 verifies receipts. Checkpoint IDs must resolve to same-attempt evidence.
- `MutationContext.authorize?: (tx:Tx)=>Promise<void>` runs after `event_cursor` lock and before both cached response lookup and new work. Task 5 machine mutation routes supply immutable callbacks (`authorizeCreateCommandMutation`, `authorizeCommandMutation`, `authorizeAttemptMutation`) that lock root/ticket/project, then check current binding and revocation. Owner/internal callers without a hook retain prior behavior. Task 7 must add equivalent callbacks to other machine mutation routes that can replay after binding changes.
- Migration 005 adds `commands.binding_revision` (internal only; PM approved) and `reconciliation_observations` (host proof provenance) beyond the initial compact column summary.

## Verification

- `pnpm --dir v2/server test -- attempts.test.ts`: 117/117 in the test runner (all files; 18 attempt cases).
- `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/commands.test.ts`: 7/7.
- `pnpm --dir v2/server test`: 117/117, final stable gate after artifact route and reference checks.
- `pnpm --dir v2/server test:unit`: 26/26.
- `pnpm --dir v2/server typecheck`: pass, final gate.
- `pnpm exec biome check` on owned source/test plus PM-approved extensions: pass, 13 files, no fixes needed. Formatting was applied with `biome check --write` before final gate.

## Self-review and remaining integration concerns

- Scope, revocation, immutable binding revision and target machine are checked on service reads/ACK/claim and in the journal transaction before cached response lookup. Root/ticket/project locks serialize a concurrent rebind. The barrier test proves a second connection cannot acquire the project lock while a cached replay is authorized.
- Fifth repair result after confirmed stop now leaves ticket `needs_input` with `repair_limit` and clears guard. The producer's final repair update no longer writes stale status and still increments revision/cycles in the same transaction.
- Host attestation is only authenticated machine identity plus durable launch/fence in Phase 02. Real process observation and owned artifact materialization come with Phase 03 host. This phase provides the remote registration port, but client locator/hash remain reported claims, not verified bytes or completion proof. Phase 06/08 gates remain fail closed.
- No destructive migration/deploy performed. Fixture creates and drops disposable logical DBs inside its private Docker container; no leftover container from the test runner.
