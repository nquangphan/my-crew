# Daemon stop / API close hang — debug report

Date: 2026-09-29 · Flaky test: `apps/daemon/test/daemon.test.ts › daemon › stops what a job started when it
ends and leaves untagged processes alone` · Symptom: `Hook timed out in 60000ms` in `useApi`'s `afterEach`
(`apps/daemon/test/helpers/api.ts:28`, `server.app.close()`), CI run 36515576063 (commit `ae9c8d2`).

## Outcome

The root cause is in the daemon, not in the SSE stream client. `createDaemon().stop()`/`halt()` returned while
API calls the daemon had fired without awaiting them were still in flight. In the flaky test that is
`wakePmForLeftovers()` (a `GET /v1/daemon/tickets/:parent` fired from `onCleaned` the moment the job's cleanup
record is written, which is exactly what the test waits for before it calls `stop()`). When that response was
still being written at the instant Fastify called `server.close()`, Node's one-shot idle-connection sweep
skipped the socket; the response then finished and the socket stayed open as an idle keep-alive connection
(Fastify's `keepAliveTimeout` is 72 s), so `app.close()` outlived the 60 s hook timeout. The same late calls
also wrote to the already closed SQLite state DB ("The database connection is not open").

Fix: the daemon tracks its fire-and-forget API work and `stop()`/`halt()` wait for it before closing the state
DB. No timeout or retry was changed.

## Evidence

CI log: the test body took ~1.65 s and the hook the remaining 60 s (`61650ms` total); only the hook error was
reported, so the body (including its final `await t.daemon.stop()`) had passed. `daemon.test.ts` is unchanged
since `ae9c8d2`.

Reproduction (temporary probes, since removed; isolated `crew_daemon_probe_test` database):

| Probe | Scenario | Before fix | After fix |
|---|---|---|---|
| E | real daemon: `start()`, stop 0–38 ms later, then `app.close()` (5 s watchdog) | 8, 6, 2, 2 of 20 hung (4 runs) | 0/20 |
| D | real daemon: wait until connected, stop at random 0–1.2 s, close | 0/20 | 0/20 |
| F | server closes while the daemon is live, then halt | 0/20 | 0/20 |

Captured at a hang (server-side request/socket tracking, wall-clock ms):

```
E5  GET /v1/daemon/projects arrives …500   (daemon.stop() had already returned)
    app.close() …505 → bus.stop() …505 → server.close() …507 → response finish …508
    open after 8 s: 1 connection (the keep-alive socket of that request), 0 open requests
E6  request …794 → server.close() …800 → finish …811 → same result
```

Daemon-side fetch trace of E5 (ms from test start): stream connects at 168 → `onConnected` fires
`refreshProjects()` at 168 → `stop()` at 170 aborts the stream → `stop()` returns at 177 → the project refresh
answers at 180, after `stop()`; its follow-up (`scheduler.recheckWaiting()`) then hit the closed state DB
(vitest reported 8 unhandled "The database connection is not open" rejections in the same run).

In the flaky test the late call is `wakePmForLeftovers()`: the job leaves pids and port 4321 (the test asserts
both), so the guard passes and `vps.getTicket(parent)` is fired from `onCleaned` right as the cleanup record the
test polls for is written.

## Hypotheses and how each was settled

1. **Stream client connects after `stop()` (no abort / reconnect timer left).** Eliminated.
   `StreamClient.connectOnce()` assigns its `AbortController` synchronously before `fetch`, `stop()` aborts it
   and wakes the backoff sleep; a bare `StreamClient` stopped 0–40 ms after `start()` never left a connection
   (9/9), and with the daemon fix the real daemon stopped mid-connect never hangs (probe E 0/20). The stream
   client was not changed.
2. **API SSE route keeps the socket open on close.** Not the cause of this flake: at every captured hang the
   open socket belonged to a plain JSON request and no SSE request was open. Two separate SSE defects were
   proven along the way (see "Follow-ups"); they are not fixed here because the file boundary allows API edits
   only when the SSE side is part of the cause.
3. **In-flight request at close leaves a keep-alive socket.** Confirmed as the server-side mechanism. A first
   probe looked like it disproved this (close in 8 ms), but that request finished during `preClose`, before
   `server.close()`; the hang needs the response to finish just after `server.close()`, which the E traces show.
4. **Shared test DB.** Eliminated for this symptom: the hang reproduces on an isolated `_test` database with
   one server and one daemon; `pump()`/`unlisten()` in `preClose` finished promptly in every trace (`bus.stop`
   and `server.close` are 1–2 ms apart).
5. **Leaks from the previous test file.** Eliminated: vitest runs each file in its own process (two files
   printed different PIDs).

## Fix

`apps/daemon/src/daemon.ts`:

- `inBackground(work)` records a fire-and-forget promise (rejections already handled by each caller);
  `backgroundIdle()` waits until the set is empty.
- Wrapped: the project refresh on stream connect, the `refresh_projects` effect chain, `cancelDescendants()`,
  the cancel worktree cleanup, and `wakePmForLeftovers()` from `onCleaned`.
- `stop()` waits after `heartbeatLoop.stop()`, `halt()` after `jobs.idle()` — both before the probe wait and
  `state.close()`. This matches the existing contract (`heartbeatLoop.stop()` and `jobs.idle()` already wait
  for in-flight calls). Offline, the extra wait is bounded by the client's retries.

Test: `apps/daemon/test/daemon-extras.test.ts` › "stop waits for the API calls it started in the background, so
none outlives it" — holds the project refresh fired on stream connect at the fetch layer, asserts `stop()` has
not returned 300 ms later, releases it, then asserts no daemon request is open. It fails deterministically on
the old code (`expected true to be false`) and passes with the fix.

Docs: `docs/flows/daemon-runtime.md` step 11 and the `daemon-extras.test.ts` test entry (Vietnamese, written by
a sonnet subagent, checked).

## Verification

- Before the fix, a loop of the whole `daemon.test.ts` file (25 runs, shuffled) did not reproduce the flake on
  this machine; the targeted probe E above did, which is why the verification relies on both.
- New test: fails on the old `daemon.ts` (`expected true to be false`), passes with the fix.
- Probes D/E/F with the fix: 60/60 passed, no hang, no "database connection is not open".
- `daemon.test.ts`: 30/30 consecutive passes (15 default order, 15 `--sequence.shuffle`; 21–37 s each).
- `pnpm --filter @crew/daemon test`: 3/3 full passes (26 files, 156 passed, 4 skipped; 238 s, 240 s, 282 s).
- `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm -r build`: pass (shared 16, web 65, docs-kit 39,
  api 168, daemon 156 + 4 skipped, desktop 36).
- `crew-docs check --staged` and `--commit-msg` on a temporary index of HEAD + this change: ok, no approval
  trailer.
- Loops and probes ran on an isolated `crew_daemon_probe_test` database (both `TEST_DATABASE_URL` and
  `DAEMON_TEST_DATABASE_URL` set, since global setup reads the former in the main process); it was dropped
  afterwards. All temporary diagnostics were removed.

## Follow-ups (not changed; proven, outside this fix's boundary)

1. **SSE stream opened during API shutdown is never ended.** A `/v1/daemon/stream` request that is in
   `machineGuard` when `preClose` runs `bus.stop()` subscribes afterwards to the stopped bus (`subscribe()` does
   not check `stopped`); nothing ever ends it, so `app.close()` waits as long as the client stays connected.
   Deterministic repro: `app.close()` 2–3 ms after a `StreamClient.start()` hung 2/2 (bus log: `bus.stop
   subscribers=0` then `subscribe after bus.stop` 4 ms later). Suggested fix: in `openEventStream()`, end the
   response right after setup when the bus is stopped (expose a `stopped` getter on `EventBus`).
2. **Zombie subscriber after a client disconnects during auth.** `openEventStream()` attaches
   `res.on('close')` after the async auth/subscribe; if the client aborted meanwhile, the `close` event already
   fired, so the subscriber and its heartbeat interval live until server shutdown (seen as `subscribers=1` at
   `bus.stop` after the client had stopped). Suggested fix: after attaching the listener, call `close()` when
   `res.destroyed`.
3. **Keep-alive sockets of responses finishing after `server.close()`.** Any client with a request in flight
   at close (a live daemon, Caddy's upstream pool in production) can hold `app.close()` for up to Fastify's
   72 s `keepAliveTimeout`. Suggested fix: when closing, close the connection after each finished response
   (for example an `onResponse` hook calling `server.closeIdleConnections()` once close has begun).
4. **Test teardown order.** `useApi`'s `afterEach` closes servers before `helpers/git.ts` cleanups halt
   daemons that a test did not stop itself (vitest runs `afterEach` hooks in reverse registration order), so a
   test that fails midway closes the server under a live daemon. Closing servers after daemon cleanup would
   keep a real failure from being masked by a hook timeout.

## Unresolved questions

- CI runs Node 22; the reproduction ran on Node 24.14 (Node 22 is not installed locally). The close/keep-alive
  behaviour involved has been the same since Node 19, but it was not re-checked on 22.
