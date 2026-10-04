# Task 7 independent review — 8707ece..4ae9ed9

## Spec Compliance

- **Spec compliance: NO.** F1 below misses the finite SQL deadline required by the reviewed docs-import → Task7 search contract. Other reviewed Task7 requirements match the diff, including the approved fail-closed boundary for future production authority.
- **Code quality: NO — Needs fixes.** One Important finding, no Critical findings; two Minor findings.
- Reviewed the full 2,705-line review package, official extracted Task7 brief, PM execution addendum, full worker report, root/v2 index and relevant flow pages. An initially truncated tool display was reread in bounded chunks; changed source was evaluated from the package, not reread wholesale.

## Strengths

- `v2/server/src/docs/read.ts:112` and `:119`: strict UTF-8 page decoding uses original bytea, preserves BOM/CRLF/NUL, and returns original SHA/provenance; same-snapshot project scope and per-file class avoid replacing byte truth with the search projection.
- `v2/server/src/docs/search.ts:76`: parameterized prefix-vector search OR escaped full literal text correctly covers words beyond the 8192-character index prefix. Tuple order/cursor includes project, snapshot and path; `v2/server/test/docs-read.test.ts:65` checks zero-rank ties, escaping, historical selection and filter hash changes.
- `v2/server/src/docs/read.ts:154`: completion requires latest verified checkout snapshot, expected/merged commit equality, project-scoped receipt and implemented standard/flow pages. Mixed aggregate does not automatically reject valid implemented pages or promote artifact pages. Positive fixtures explicitly create new immutable test snapshots; imported snapshots remain unverified.
- `v2/server/src/tickets/authorization.ts:12` and `v2/server/src/tickets/routes.ts:191`: all seven machine mutation families receive a transaction guard before cached replay. The helper holds root/ticket/project locks and rechecks machine revocation under a share lock. HTTP race assertions cover rebind/revoke after initial authentication.
- `v2/server/src/journal/routes.ts:46` and `v2/server/src/app.ts:73`: actual request credential, project scope and event data are read in the same repeatable-read transaction; each backlog page/poll reauthenticates. Real SSE expiry/revocation, shutdown and two-pool snapshot races are covered.
- `v2/server/src/app.ts:24`: missing dispatch/final-verification callbacks use deny authorities; the explicit test authorities do not claim production Phase06/08 evidence. HTTP acceptance verifies ACK does not prove stop, finalizing guard retention, fifth repair behavior, restart/replay and private backup/restore.

## Issues

### Critical

None identified within Task7.

### Important

**F1 — Bound the complete search transaction with a finite SQL deadline.** `v2/server/src/docs/search.ts:68`–`:82` enters the read transaction and executes a potentially global full `ILIKE` scan/rank/sort without setting `statement_timeout`. The named producer contract in `v2/docs/flows/server-docs-import.md`, section “Flow liên quan”, explicitly requires a finite statement timeout and an explicit deadline failure. The focused supporting check of unchanged `v2/server/src/db/client.ts:19` found only pool size, idle timeout and connection timeout; no query deadline is inherited, and a scoped search for SQL timeout configuration under server/src found none. LIMIT bounds returned rows, not lock wait or scan/sort work. A blocked or expensive search can retain a pool connection indefinitely; eight such requests exhaust this app's pool and interfere with SSE/auth/mutations. Set a transaction-local finite statement timeout before the scope/search queries, preserve rollback/cleanup, and map cancellation to a deliberate bounded-search error (never empty results). Add one narrow regression that holds a conflicting lock or otherwise deterministically crosses the deadline, then proves a subsequent query can use the pool. No large data stress run is needed.

### Minor

**M1 — Validate cursor UUID field types before regex coercion.** `v2/server/src/docs/search.ts:62`–`:63` calls `RegExp.test` on parsed JSON values without checking `typeof ... === 'string'`. A singleton array containing a UUID passes the regex through string coercion although it is not a valid cursor tuple field; it reaches PostgreSQL binding instead of the intended `CURSOR_INVALID` 400 path. Validate both UUID fields as strings first (and apply the existing path validator to the cursor path). This is an input/error-contract defect, not an SQL-injection finding; parameters remain bound.

**M2 — Remove remaining new fixture lint warnings.** `v2/server/test/api-acceptance.test.ts:131`, `:133`, `:137` and `v2/server/test/docs-read.test.ts:23` exemplify the 22 `noNonNullAssertion` warnings recorded by `task-7-evidence/biome-last.log`. Add assertions that narrow required fixtures/env/rows rather than relying on compile-only `!`. The worker correctly disclosed these warnings; they do not invalidate the successful functional runs.

## Checks and limitations

- Read existing evidence rather than rerunning covering suites: domain 14/14; server 169/169 with zero fail/cancel/skip; both typecheck logs complete without errors. Read security RED showing missing guard returned 201 instead of 404 and missing owner reauth timed out, followed by final GREEN for the actual guarded paths.
- Read final HTTP evidence with first/reopened real listener ports 49167/49216, private container `e6359369e174b1d86f23ec3da25143315b65245cb30248611272ab49913a01b6`, dump 75009 bytes and exact restore DB; test compares counts/cursor/bytes/SHA/command results. Read cleanup.json showing the three recorded exact container IDs absent. These are worker-run artifacts, not new reviewer executions.
- Focused outside-diff checks were only for named risks: database client/configuration for inherited query deadline; event reader for same-transaction credential/scope integration; completion consumer for the new reader callback contract; installed Fastify hook lifecycle for a startup suspicion.
- One no-DB targeted probe invoked actual `main` with synthetic local configuration to test that startup suspicion. It successfully listened on its own 127.0.0.1:65534, disproving the suspicion. The probe's expected-error assertion consequently failed and exited process 85872; a subsequent exact PID/port check found no remaining process/listener. No DB query/container, migration, source mutation or shared-service operation occurred. This is a disproved hypothesis, not a startup finding or a passing acceptance test.
- No new covering suite, DB runner, load test, source edit, stage, commit or subagent was used. Only this owned review file was written.
- Manifest/generated/staged checks are reported by the PM separately; this review confirms their relevant mapping hunks but does not rerun those checks. No migration 001–006 hunk exists in the candidate diff.
- Actual planner/dispatch Phase06, trusted merge/docs attestation Phase08, host/native and production deployment gates remain deferred as explicitly approved. Neither the 169 passing tests nor test-created verified snapshots constitute those production gates.

## Assessment

**Task quality: Needs fixes.** Close F1 and recheck the narrowly affected search behavior before accepting Task7. The core transaction/auth/provenance integration is coherent and has meaningful HTTP evidence; the remaining blocking issue is the unbounded search execution time, not missing future production authority.
