# Upstream: sự kiện plugin giữ invocation scope 15 phút (bản nháp issue/PR)

Ngày 10/10/2026, giờ Asia/Ho_Chi_Minh. Người viết: CORE-P. **Chưa đăng.** Trợ Lý hỏi owner trước khi mở issue/PR trên
`paperclipai/paperclip`.

- Vá trong fork: nhánh `crew/r3-core` (repo `nquangphan/crew-paperclip`), mục `C6` trong `crew/release/core-hooks.json`.
- Code host vẫn y nguyên ở `upstream/master` `9b624a110` (08/10/2026): `notify()` trong
  `server/src/services/plugin-worker-manager.ts` đăng ký invocation với TTL `MAX_RPC_TIMEOUT_MS` cho `onEvent`.
- Bằng chứng gốc: `reports/dbg-p1-scope-denied.md` (tái hiện trên T1: hủy 1 run → lời gọi không scope bị
  `INVOCATION_SCOPE_DENIED` đúng 15 phút).
- Test đi kèm PR: `server/src/__tests__/crew-plugin-event-invocation-scope.test.ts` (đổi tên khi gửi upstream, ví dụ
  `plugin-event-invocation-scope.test.ts`) và phần thêm `onEvent` vào fixture
  `server/src/__tests__/fixtures/plugin-worker-invocation-scope.cjs`, fixture mới `plugin-worker-sdk-event.ts`.

Phần dưới viết bằng tiếng Anh để dán thẳng lên GitHub.

---

## Issue

**Title:** Plugin event delivery leaves an invocation scope alive for 15 minutes, denying unscoped worker→host calls

**Body:**

### What happens

After a plugin receives any event that carries a `companyId` (for example `agent.run.cancelled` or
`agent.run.started`), every worker→host call made *outside* an invocation — a `getData` handler called without a
company, a scheduled job — that touches company data (for example `ctx.companies.list()`) fails with:

```
INVOCATION_SCOPE_DENIED (-32005): Plugin "<id>" is not allowed to perform "companies.list":
the worker referenced a missing, expired, or unknown invocation scope
```

The failure lasts exactly 15 minutes after the last event and then clears by itself. A plugin that subscribes to a
frequent event (`agent.run.started`) is effectively broken for unscoped calls while agents are running. Restarting the
server "fixes" it only because the in-memory scope is dropped.

### Why

1. `plugin-host-services.ts` `events.subscribe` delivers each event with `notifyWorker("onEvent", { event })`, which is
   `handle.notify(...)`.
2. `plugin-worker-manager.ts` `notify()` derives an invocation scope from `event.companyId` and registers it with
   `registerInvocation(scope, MAX_RPC_TIMEOUT_MS)`. A notification has no response, so the scope is only removed by
   that 15-minute TTL (see the comment "the invocation scope is GC'd by TTL").
3. `contextForWorkerMessage` treats a worker→host message without `paperclipInvocationId` as an invalid scope whenever
   `activeInvocations.size > 0`. The lingering event scope satisfies that condition.
4. `host-client-factory.ts` `requireInvocationCompanyScope` then rejects any company-touching method
   (`companies.list` included) with `InvocationScopeDeniedError`.

The handler itself finishes in milliseconds; only the bookkeeping outlives it.

### Reproduce

Host-level test with the existing fixture `plugin-worker-invocation-scope.cjs`:

1. Start a worker handle; `call("getData", { params: { mode: "none", hostMethod: "companies.list" } })` succeeds.
2. `notify("onEvent", { event: { companyId: "company-a", ... } })` and let the handler finish.
3. The same `getData` call now fails with `INVOCATION_SCOPE_DENIED` and `companies.list` is never reached, for the next
   15 minutes.

### Expected

Once the worker's event handlers have settled, the event's invocation scope is gone and unscoped calls behave exactly
as before the event.

### Note

Even with the fix, an unscoped call that overlaps *any* in-flight scoped invocation is still denied by the same
`activeInvocations.size > 0` rule. That is a separate, narrower race; plugins should still pass a company where they
have one.

---

## Pull request

**Title:** fix(plugins): deliver plugin events as a call so their invocation scope ends with the handler

**Body:**

### Summary

Plugin events (`onEvent`) were sent to the worker as JSON-RPC notifications. `notify()` registers an invocation scope
for the event's company and, because a notification has no response, can only drop it after the 15-minute TTL. While
that scope is alive, every worker→host call without an invocation id is denied with `INVOCATION_SCOPE_DENIED`, so a
single event broke unscoped data handlers and jobs for 15 minutes.

This change sends `onEvent` as a call instead (`deliverEventAsCall` inside `createPluginWorkerHandle`). Call-path
invocations are registered without a TTL and cleared on settlement, so the scope now ends when the worker's handlers
finish. The worker SDK already serves `onEvent` as a request (`dispatchMethod` → `handleOnEvent`) and runs it inside
the invocation context, so plugins need no change.

- Same ceiling as before: the call uses `MAX_RPC_TIMEOUT_MS` (15 minutes), the previous notification TTL, so a slow
  handler keeps its scope at least as long as it did.
- Delivery stays fire-and-forget for the event bus; a timeout or worker error is logged with `log.warn` and never
  thrown into the bus.
- Handler errors are still caught per handler by the SDK, so one failing handler does not fail the call.
- Every other notification (`agents.sessions.event`, ...) keeps the notification path and its TTL.

### Tests

- `getData` without a company that calls `companies.list` succeeds right after an `onEvent` whose handler has settled
  (failed before this change with `INVOCATION_SCOPE_DENIED`).
- An event handler still reaches the host inside the event company's scope (`companies.get` with the echoed
  invocation id).
- End to end with a worker bundled from the real plugin SDK: the handler runs, then an unscoped data handler listing
  companies succeeds (failed before this change).
- The fixture `plugin-worker-invocation-scope.cjs` learns `onEvent` (reads its company through the host and answers when
  delivered as a request); existing `plugin-worker-manager` tests are unchanged and pass.
