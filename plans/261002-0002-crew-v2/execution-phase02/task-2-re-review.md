# Task 2 — fix round 1 re-review

**Scope:** `e81f08e..033a572`, only the P1 scope/event race and breakage introduced by its fix. Reviewed `task-2-fix-diff.txt` and the appended fix report; no source edits or test reruns.

**P1 verdict:** ✅ Fixed. `readEvents` now runs `EventScopeReader` and the event SELECT on one `REPEATABLE READ READ ONLY` transaction. A machine's binding query establishes the snapshot; an authorized rebind and its event committed afterward cannot appear in that read. The `Db | Tx` reader signature is carried through `projectEventScope`, and owner/deny-all readers remain compatible.

**Quality gate:** **Approved for this fix round.** No new breakage found in the changed journal, identity scope, test, or flow documentation. The deterministic two-connection regression reproduced the leak before the fix (A received cursor `1`) and passes after it (A receives none; B receives cursor `1`). The implementer reports server 39/39, clean typecheck, Biome on the three changed source/test files, and `git diff --check`; these reported checks were not rerun in this review.

The separate question of reauthorizing or closing an already open SSE stream when machine credentials are revoked remains for the identity/execution integration review; it does not reopen this snapshot race.
