# Task7 fix round1 scoped re-review — afe36f3..c6f9b60

## Verdict

- **Spec compliance: YES — READY.** F1 Important and M1 Minor are addressed.
- **Code quality: YES — READY for this fix scope.** No new Critical/Important finding in the fix diff.
- Scope: full four-file fix diff, original F1/M1, worker fix report and attached evidence. Original Task7 security/provenance review was not reopened. M2 remains explicitly deferred in the PM ledger.

## Findings disposition

**F1 — Addressed.** `v2/server/src/docs/search.ts:77` starts a 2000 ms monotonic budget after transaction acquisition. `:83` applies transaction-local `statement_timeout` from the remaining budget before scope and subsequent SQL; related-ticket queries also refresh the decreasing remainder. `:136` refuses a success response after budget expiry. `:140` converts PostgreSQL 57014 to `ApiError SEARCH_DEADLINE_EXCEEDED`/503 after the rejected transaction unwinds, while unrelated errors propagate. The change preserves repeatable-read scope and parameterized FTS/literal query behavior. It bounds SQL execution/lock waits, not authentication, network transport or time waiting to acquire a pool connection; the report states that limitation accurately.

`v2/server/test/docs-read.test.ts:280` is meaningful regression evidence: it acquires a real ACCESS EXCLUSIVE lock, observes the search backend waiting on that lock, checks direct and HTTP deadline errors, and checks pool recovery before releasing the conflicting lock. `:358` verifies the exact original backend PID is reused; `:359` verifies the pre-transaction timeout setting is restored. The finite watchdog and finally release prevent the intentionally unbounded old implementation from leaving a blocked test resource.

**M1 — Addressed.** `v2/server/src/docs/search.ts:66` validates the cursor path with producer `validPath`; `:67` checks both UUID fields are strings before regex matching. `v2/server/test/docs-read.test.ts:381` verifies both singleton UUID arrays and empty/traversal/encoded-traversal paths return `CURSOR_INVALID`/400. One focused outside-diff check of `v2/server/src/docs/manifest.ts:36` confirmed reusing validPath also preserves the previous 1024-character cap and rejects NUL/backslash/unsafe paths.

**M2 — Unaddressed by design, nonblocking for this scoped fix.** The original 22 fixture non-null warnings remain deferred by PM. This two-file Biome evidence reports 12 existing warnings in docs-read, zero errors and no added warning from the new regressions. No warning-free claim is made.

## Evidence reviewed

- `task-7-fix-evidence/red.log`: 0/2 pass; old search crossed the finite watchdog and the malformed cursor returned 200 instead of 400.
- `task-7-fix-evidence/green.log`: 2/2 pass; same backend PID 95 recovered after cancellation.
- `task-7-fix-evidence/final-search.log`: all five docs-read tests pass, no failures/skips/cancellations; backend PID 101 reused on final run. Existing Unicode, full literal fallback, tied cursor, source/class and completion tests remain green.
- `task-7-fix-evidence/final-types.log`: server typecheck completed without diagnostics. `final-biome.log`: zero errors, 12 disclosed existing warnings.
- `task-7-fix-evidence/cleanup.json`: exact recorded RED/GREEN/final container IDs are absent. No reviewer container/process/test suite was created or rerun.
- Both changed flow pages describe the actual deadline/error and cursor contracts; no migration, authority, ACL, idempotency or protocol-version hunk exists in this fix package. PM manifest/staged checks are separate PM evidence, not rerun by this reviewer.

## Assessment

**READY.** F1 and M1 are closed with matching code and real regression evidence. Production Phase06/08 authority remains outside this fix and no new production-readiness claim is inferred. Only this owned re-review file was written; no source/index/HEAD/shared-service mutation or subagent was used.
