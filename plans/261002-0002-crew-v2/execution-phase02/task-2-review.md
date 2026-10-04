# Task 2 — independent spec and quality review

**Scope:** `d0e6f85..41c3807`, Task 2 brief/report/diff and one focused check of `projectEventScope`. Read-only review; no source edits or test reruns.

**Spec verdict:** ⚠️ The journal, idempotency, cursor ordering, HTTP wire shape and SSE replay match the frozen contract, but machine event scope can become stale during a guarded project rebind.

**Quality gate:** **Needs fix** before integrating the guarded rebind path in Task 5.

## Finding

**P1 — Machine can receive events committed after its project binding is removed.** In `v2/server/src/journal/events.ts:55-63`, `readEvents` obtains project IDs from `EventScopeReader` and then selects events in a separate `READ COMMITTED` statement. `projectEventScope` in `v2/server/src/projects/service.ts:124-131` reads the current `machine_id`. If machine A's scope query returns project P, then an authorized guarded rebind to machine B commits before the event query, A's event query still matches P. It can return B's new `project.bound` event (and other events committed before that SELECT) although P is no longer bound to A. The SSE route repeats this window on every page/poll. This is a Task 2 read-side authorization race, not a producer payload issue. Keep scope resolution and event selection on one consistent database snapshot, or include the current binding predicate in the same event SELECT; coordinate any `EventScopeReader` interface change with Task 3. Add a deterministic two-connection test that pauses between scope resolution and event selection, commits the rebind, and checks that A receives no post-rebind event.

## Evidence and remaining integration note

- `createMutator` takes an advisory lock for the idempotency scope and locks the singleton cursor row before `work`; `appendEvent` increments that row in the same transaction. This supports single execution for concurrent retries, rollback without cursor gaps, and cursor order following commit order.
- Replay checks the canonical body hash, and the response codec is applied only after the stored actor/route/key lookup. The public event routes authenticate before `reply.hijack()`; `/v2/events` returns `{items,cursor}` and `Last-Event-ID` drives SSE replay.
- Event input has a type/payload whitelist plus recursive sensitive-key rejection. The stream bounds queued bytes to 64 KiB, destroys slow sockets, and aborts its poll timer on close. Errors after hijack are logged and the connection ends without sending SQL/stack details to the client.
- The worker reports journal **10/10**, server **28/28**, domain **14/14**, clean typecheck and Biome on six owned files. These results come from `task-2-report.md`; this independent review did not rerun suites.
- Existing SSE connections retain their initially authenticated actor. Task 3/5 integration should decide how machine revocation closes or reauthorizes a live stream; this is a separate lifecycle concern from the confirmed rebind race above.
