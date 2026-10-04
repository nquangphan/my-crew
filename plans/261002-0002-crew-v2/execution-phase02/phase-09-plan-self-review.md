# Phase09 plan self-review — 2026-10-02

Disposition: **READY for independent plan review as a provisional draft**, not frozen09 or implementation/signing/runtime/deployment PASS. No subagent spawned. Only the three owned planning/report files were written; no source/SQL/install/Keychain/codesign/service/DB/deploy/model calls/stage/commit.

## Spec coverage

| Spec scope | Owning tasks / evidence planned |
|---|---|
|1–2 independent v2/local host | T2 signed separate bundle/private Node, T6 isolated VPS/config/DB/blob volumes |
|7 actual owner deploy + command/recovery | T1 immutable012 CAS/report/replay, T4 guard/drain, T5 crash/rollback, T6 exact004 fingerprint + trusted receipt |
|8 capacity/monitor/resource preservation | T4 uses actual06 admission/retirement, T3 owned stages, T5 refs/checkpoints, T6 existing06 monitor, T7 resource/intervention matrix |
|9 actual docs/merge/finalization | T4 requires011 unresolved work drained, T6 provisional08 registered deploy proof branch, T7 exact commit and baseline-aware docs checks |
|11 web signed update/drain/permissions/rollback | T1–5 with fake/native/signed lanes; no window-owned host; no end-user compiler |
|12 product acceptance/import/attachments/UI | T7 each scenario references true producer/version/certificate, fake/live labels separate;07 UI layout approval retained |

Five Review Focus cases have explicit RED regressions in their owning tasks. Plan contains seven independently reviewable task units, typed contracts/wire/persistence/ownership, test snippets, commands and concrete failure outcomes.

## Producer checks and self-corrections

- Read approved spec/roadmap,02–06 relevant contracts,03 actual gateway-host/desktop-shell flow,02 journal/tickets/execution flow and current native/source symbols. No `.codegraph/` in worktree. Actual NativeHelper.build, ProcessIdentity.open, ProcessJournal.open, gated-helper INIT and ResourceRegistry.open all compile-route dependencies were traced; T2 now covers every call site, including child helper and packaged0755 versus dev0700 attestation.
- Actual GatewayHost.stop({drain:true}) only drains IPC, not jobs. T4 explicit06/005/011 drain plus T5 actual host exit required before using it. macOS fork/escaped descendant remains UNKNOWN; no fabricated NOTE_TRACK capability or lease-based stop.
- Fixed initial enrollment circularity by adding owner-issued challenge + trusted EnrollmentProof and first-installed-release health proof. Machine bearer/owner-entered signature booleans cannot self-certify current. No invented003 machine revision: initial expectedInstallRevision0 and012 CAS are explicit.
- Added narrow06 barrier hooks across execution prepare/claim/prelaunch, routing bootstrap and009 admission; local latch/RELEASE serialize to avoid race. Types and immutable grant bind command/install/binding set/release/generation. Existing attempts retain frozen pins and finish normally.
- Phase08 read at fixed draft SHA below: F1 exact actual merged_commit writer+job before006 sync; F2 separate docs-only snapshot+registered reader; F3 explicit managed target activation; F4 single011 head+003 projection/binding invalidation. Phase09 does not change08. T6 proposed additive internal deploy proof through registered completion factory needs08/02 owner review; public005/FinalEvidencePort/SQL011 remain unchanged.
- Separated strict macOS Release from VpsRelease to avoid treating OCI deployment as a six-component app ZIP. BackupManifest includes DB/schema/docs/blob/current release hashes; missing original fails restore readiness.
- Corrected server focused test commands after inspecting actual `scripts/test-db.ts`: --test-file requires absolute path; use "$PWD/v2/server/test/..." from repo root. Ops package/test wiring owned T7; absent producer012 fixture is dependency BLOCKED, not expected failing test.

## Research quality / real gates

Official Electron44.5.1 GitHub tag/API and stable index, Node24.21.0 release/checksums, Electron updater/signing/macOS13 support, Apple SMAppService/helper layout/notarization/TN2206/APFS swap, PostgreSQL18 dump/restore and Docker isolation/secrets were checked read-only. Upstream metadata SHA pins recorded; binary download/signature verification has not run. Custom bundle coordination is a Crew design inference, not an Apple guarantee.

External gates are explicit:08 independent re-review; actual03–08 implementation/constructors; exact runtime/routing/observer/health-key protection certification; authorized stable signing identity/notary/test account/permissions; bounded paid test allowance;07 layout approval for UI; final exact production action. Useful unsigned/offline/config/backup preview work precedes those asks. No key material/credentials or claimed live PASS in the documents.

## Validation and freeze handoff

- Structural validation run: seven task headings; balanced code fences; no trailing whitespace; no TODO/TBD/implement-later placeholders. Plan282 lines at initial check, within250–350 target.
- No application tests run: this task writes plans only. `git diff --check` was clean for tracked workspace changes; separate text checks cover the owned untracked documents.
- Baseline native03 review859d671; unrelated peer commits moved worktree HEAD through8707ece to4ae9ed9 during drafting. No peer changes reverted.
- Phase08 fixed draft observed SHA256 `5d486a5c3e975edec99049608809dd85c635c3567472c1667682b22e50aae870`; independent re-review not yet observed. Do not freeze09 against this merely because author marked self-review ready. Re-read exact08 after review, update09 status/hash then independent09 review.
