# Phase05 Task3 — Independent SPEC / QUALITY review

- **SPEC: ✅ Compliant within the approved Task3 boundary.** All planned source surfaces and the authorized jobs/messages/routing amendments are present. This is not production assembly or parser/runtime certification.
- **S/Q gate: NEEDS FIXES. Quality: Needs fixes.** One Important/P2 finding, T3-Q1. No Critical finding established.
- Candidate: `e508923..c5f9ad3`; authoritative package `.superpowers/sdd/phase-05-attachments/review-e508923..c5f9ad3.diff`. Scope: 20 files, +4440/−25 lines.

## Important — T3-Q1 / P2: Quadratic snapshot work while holding root/input locks

**Location:** `v2/server/src/attachments/snapshots.ts:126–143`, especially `:142`; locks are acquired at `:76`.

For each coverage unit, the implementation scans every derivative and searches each derivative's `unitIds`, then searches persisted derivatives and recomputes `digest(r.unit_ids) === digest(d.unitIds)`. When one valid text derivative covers N units, the same N-element arrays are canonicalized and hashed twice for every unit. This is O(N²) work even with only one derivative; multiple derivatives add further repeated scans. The approved protocol permits up to 100,000 units and 10,000 files (`phase-05-attachments.md:109`). A valid grouped text/CSV extraction can therefore monopolize the Node event loop and hold target/root locks during snapshot creation, delaying claim/publication and other HTTP work. This is a static complexity finding, not a measured latency claim.

**Fix:** Validate and compare each persisted derivative once, precompute its unit membership and provenance, and build a unit→valid-candidate index before iterating selected units. Preserve exact original/extraction identity, modality and verification checks. Avoid recomputing canonical unit-array hashes inside the unit loop. Add a focused regression with many units sharing one derivative, proving the same selected IDs/capabilities and a bounded number of validation/hash operations. The current `u1` fixtures do not exercise this shape (`server/test/support/attachment-access-publication.ts:48`). No benchmark or fixture was launched during this resource-constrained review.

## Checks and useful strengths

- Byte scope uses exact original/link identity, current machine/project binding, actual attempt guard/fence/process/state/lease; custom execution policy does not bypass persisted checks (`access.ts:24`, `:73`). Same-checksum/different-ID and derivative/original mismatches have explicit tests in `attachments-access.test.ts`.
- Credential authorization precedes mutation cache lookup (`routes.ts:228`); download authorization precedes conditional responses, then rechecks the opened stream and bounded chunks (`routes.ts:247`, `:283`). Real TCP cutoff test exists in `attachments-api.test.ts`.
- Optional attempt-input services and Assistant authority remain default-deny (`routes.ts:594`, `:664`; `grants.ts:105`). No v1/global/app wiring or SQL001–010 change appears in the authoritative diff.
- Publication wraps the existing generation/manifest/derivative CAS; the adapter takes the event cursor before scope locks and applies revision/grant/session invalidation in the same transaction (`references.ts:113`, `:120`, `:170`; `jobs.ts:273`). Direct message decisions and initial routing use the reviewed root/message/input order. Two-pool tests cover both winning orders for publication/claim, comment/claim, reply/publication/revoke, and initial route/snapshot.
- Subset selection validates persisted target/revisions/original UUID+hash/units geometry/rationale before using the trusted selection port; repeated unit IDs across originals remain distinct (`snapshots.ts:276`; `attachments-snapshots.test.ts` subset case).
- Grant/session reads revalidate current target revision, authorization expiry/revocation, designation and trusted session authority (`grants.ts:105`, `:236`). Exact admitted-session replay under source OFF and terminal-session replay denial are exercised. Receipt coverage remains reported transport, with exact selected original/unit keys (`grants.ts:380`).

## Evidence inspected and limits

- Read task-reviewer protocol, actual task brief/text/report, applicable docs and approved global/type/HTTP/S2/S3/R2 snippets; read the authoritative diff in ordered segments. Tool-truncated passages were recovered at their cut-off locations; source files were not separately reread.
- Edge-case scouting focused on dependent publication/claim/reply locks, inheritance, mid-stream revocation, subset provenance, source-OFF replay and representation/receipt modality before reaching verdict. The named legacy `scout`/`code-review` skills were not available in the supplied catalog or searched local skill locations; the explicit task-reviewer protocol governed this task gate. No subagents were dispatched.
- One focused out-of-diff producer check addressed the named risk “could a text derivative satisfy a vision unit receipt?”: current `worker-protocol.ts` unit/file validation rejects mismatched needs/kind. That file contains peer work outside this candidate, so this check is **not** acceptance of those changes or independent proof of the frozen producer. No receipt-modality defect is asserted from it; accepted Task4 producer provenance remains a controller gate.
- Read `task-3-final-cover-evidence.json` and `logs/task-3-final-cover.log`: child exit 0; **44 passed, 0 failed/cancelled/skipped/todo**, duration 22569.303917 ms (log lines 210–217). Recomputed log SHA matches `f10faf3e76813189b629b02586ff760ddcb43c7f683bc5bc45d312aba0e1907d`.
- Read `task-3-final-types-evidence.json` and its log: actual `typecheck` child exit 0; recomputed log SHA matches `85eb2c9635753b560ba5bf03f8024dd56d0e197429cf09d46c83d27ae2c5351d`. Scoped Biome log says 16 files checked, no fixes. No diagnostic warning was found in these final validation logs; fixture identity/cleanup output is expected evidence.
- Those are retained execution results, not a fresh reviewer run. The controller's 27-path/source/migration SHA verification was supplied in the dispatch; this review did not rerun Git, builds, tests, Docker, PostgreSQL, native fixtures or providers. Test/type coverage percentages are unmeasured. Build and full suite are outside this gate.
- The implementer transparently records the final-cover launch at pressure2 despite the pressure1 requirement. This remains a resource-policy lapse; it does not convert the observed child results into an authorized launch. No further resource launch occurred here.

## Follow-up and unresolved gates

1. Fix T3-Q1 and obtain a focused task re-review before S/Q READY. Preserve the current scope and migration checksums.
2. Keep production re-extraction enqueue/status invalidation unavailable/default-deny until Task7/assembly owns atomic enqueue+revision/grant invalidation. Controlled pending-version inserts and final publication tests do not certify that missing producer.
3. Task6 InputServices, Phase06 designation/selection/session/transport, production publication-wrapper capture, native stop/materialized-byte revocation and reverse-proxy handoff remain explicitly deferred gates. Fixtures do not certify parser correctness, model comprehension or production authority.
4. Plan Steps1–4 have implementation and retained focused evidence; Step5 review is **not complete** because T3-Q1 blocks quality acceptance. No plan state or TODO file was mutated.

Unresolved questions: none needed to fix T3-Q1. Runtime latency at maximum accepted coverage remains unmeasured and should not be guessed from the 44-test run.
