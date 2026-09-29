# API shutdown and stream hazards — implementation report

Date: 2026-09-29 · Source: the four follow-ups proven in `daemon-stream-stop-race-debug-report.md` ("Follow-ups
(not changed; proven, outside this fix's boundary)").

## Outcome

`app.close()` of the API is now bounded and no longer waits on clients:

1. A stream request still in authentication when shutdown began is answered and ended at once (200, only the
   `retry:` hint, `connection: close`) instead of subscribing to the stopped bus and staying open forever.
2. A client that disconnects while its stream request is authenticating no longer leaves a subscriber (and,
   before this fix, a heartbeat timer) behind until shutdown.
3. Once close begins, every response closes its connection, so a request answered just after `server.close()`
   no longer holds the close for Fastify's 72 s keep-alive timeout; anything still open after a 10 s drain
   window (a stuck handler) is cut.
4. Daemon test helpers stop daemons and clients before closing the API server, run every cleanup even when one
   fails, and turn a hang into a named error instead of a silent 60 s hook timeout.

## Changes

### 1 and 2 — `apps/api/src/realtime/sse.ts`, `apps/api/src/realtime/event-bus.ts`

- `EventBus.isStopped` (new getter): true once `stop()` began.
- `openEventStream()` checks it right before subscribing (both synchronous, so no race with `stop()`). When the
  bus is stopped it does not subscribe; it writes the SSE head with `connection: close`, the `retry:` line, and
  ends the response. That matches what `bus.stop()` does to streams already open (they end; the client
  reconnects to the next server). Refusing with 503 was considered; it would have needed a new `ApiErrorCode`
  in `packages/shared` for a transient case, and ending the stream is what both clients already handle best
  (the web `EventSource` reconnects on its own; the daemon's `StreamClient` reconnects with backoff).
  `connection: close` matters: the stream ends after `server.close()`, so a keep-alive socket would be left idle
  with no one to close it.
- `res.on('close', close)` is attached right after `reply.hijack()`, before the head is written, and when
  `res.destroyed` is already true (the `close` event fired during authentication, before any listener existed)
  `close()` runs at once: the subscriber is removed and the heartbeat interval is never started. `close()` no
  longer calls `res.end()` on a destroyed response.

### 3 — `apps/api/src/app.ts`

Choice: explicit connection closing after close begins, plus a bounded drain as a backstop. Why not the other
options:

- `return503OnClosing` is already Fastify's default and only covers requests *arriving* after close began; the
  hazard is a request already past that check.
- `forceCloseConnections: 'idle'` is also already the default. Node's `server.close()` sweeps idle sockets once,
  at call time; a response finishing afterwards leaves a keep-alive socket nobody sweeps (proven by the E5/E6
  traces of the debug report).
- `forceCloseConnections: true` would cut in-flight responses immediately at every redeploy.

What was added:

- A `closing` flag, set first thing in `preClose` (Fastify has already started refusing new requests then).
- `onSend`: while closing, every response carries `connection: close`, so Node ends the socket after it and the
  client (a daemon, or nginx's pooled upstream connection) knows not to reuse it.
- `onResponse`: while closing, the socket is ended (`socket.end()`, which flushes first). This covers a response
  whose headers went out as keep-alive just before close began. `inject()` mock sockets are skipped.
- A drain timer started in `preClose` when the server listens: after `closeDrainMs` (new `BuildAppOptions`
  field, default 10 s) it logs a warning and calls `server.closeAllConnections()`. It is `unref`'d and cleared
  on the server's `close` event. 10 s sits well inside the container's `stop_grace_period: 20s`
  (`deploy/compose.yml`), so a redeploy never reaches SIGKILL because of a stuck request.

Production effect behind the shared nginx: pooled upstream connections that are idle at close are closed by
Node's sweep as before; a pooled connection whose request is in flight gets its answer with `connection: close`
and is dropped by nginx instead of held; new requests during `preClose` get Fastify's 503 as before.

### 4 — `apps/daemon/test/helpers/{api,git,daemon}.ts`

- `useApi().server()` registers the server close through `onCleanup` (it used its own `afterEach`, which vitest
  ran before the `git.ts` cleanups that halt daemons). Cleanups run newest first, so daemons and clients a test
  started after its server are stopped before the server closes.
- The cleanup `afterEach` runs every cleanup even when one throws and rethrows afterwards (`AggregateError`
  when several fail), so one failure never leaves a server or daemon running.
- `withDeadline()` (new): a daemon left running is halted with a 30 s deadline; `closeServer()` (exported)
  closes with a 5 s deadline, and past it cuts the remaining connections and fails with "the API server still
  had open connections … a daemon or stream client it started was never stopped". Both fit in the 60 s hook
  timeout.

## Tests

`apps/api/test/shutdown.test.ts` (flow `api-platform`). Requests are parked in authentication by locking
`machine_tokens` from a separate connection (the machine guard reads it), which makes the timing
deterministic:

| Test | Old code | New code |
|---|---|---|
| ends a stream still authenticating when close began, and close does not wait for it | fails: stream never ends (`stream end did not happen in 2000 ms`) | pass |
| a client that disconnects while its stream authenticates leaves no subscriber behind | fails: `streamConnected` is `true` | pass |
| a request answered after close began closes its connection, so close does not wait for keep-alive | fails: `connection: keep-alive`, close hangs | pass |
| cuts a request still stuck when the drain window ends | fails: `server close did not happen in 2000 ms` | pass |

`apps/daemon/test/test-cleanup.test.ts` (flow `daemon-runtime`):

| Test | Old helpers | New helpers |
|---|---|---|
| a daemon left running is halted before the server closes (checked by the next test) | fails: `['server closing', 'daemon halted']` | pass |
| a client still attached makes closing the server fail with a clear error, not hang | (no such path) | pass: rejects with "never stopped" in ~5 s |

The "old code" columns were produced by temporarily restoring the `HEAD` version of the file under test.

## Verification

All on isolated databases (`crew_sse_test`, `crew_sse_daemon_test`, `crew_sse_desktop_test`,
`crew_sse_e2e_test` on 127.0.0.1:55432), suites run one at a time (`--workspace-concurrency=1`):

- `pnpm -r typecheck`, `pnpm lint`, `pnpm -r build`: pass.
- `pnpm -r test`: shared 16, api 177 (21 files), web 70, docs-kit 39, daemon 161 + 4 skipped (29 files,
  245 s), desktop 41 — all pass.
- Web E2E (`pnpm --filter @crew/web test:e2e`): 14 passed.
- Each new test was run against the `HEAD` version of the file it covers and failed as listed above.
- `crew-docs check --staged` and the commit hooks: pass without an approval trailer.

## Docs

`docs/flows/api-platform.md`, `docs/flows/event-delivery.md`, `docs/flows/daemon-runtime.md` (Vietnamese,
written by a sonnet subagent per the owner's decision, checked against the code); `docs/flows.yaml` registers the
two new tests (flows section only); `docs/files.md` regenerated with `crew-docs generate`.

## Notes

- A connection a daemon opened but never sent a request on is not "idle" for Node's sweep; after the daemon
  halts it lingers until the client's own 4 s keep-alive timeout (seen in `test-cleanup.test.ts`, and bounded
  in production by the drain window). Not changed.
- Node 22 (CI) was not re-checked locally (Node 24.14 here); the `server.close()` / `closeAllConnections()`
  behaviour relied on is the same since Node 19.
