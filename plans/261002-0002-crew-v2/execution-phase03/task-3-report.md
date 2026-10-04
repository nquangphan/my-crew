# Phase03 Task3 — Gateway server

Status: DONE, implementation frozen for PM candidate and independent review. No stage/commit/push.
Baseline dispatch `c6f9b60`; PM current HEAD at freeze `4cbf581` (unrelated registry candidate). Ownership preserved.

## Files

New source/test (6 files, to map into `server-gateway`):

- `v2/server/migrations/007_gateway.sql`
- `v2/server/src/gateway/contracts.ts`
- `v2/server/src/gateway/service.ts`
- `v2/server/src/gateway/routes.ts`
- `v2/server/test/gateway.test.ts`
- `v2/server/test/support/gateway.ts`

Narrow serialized producer edits:

- `v2/server/src/app.ts`: gateway factory registration; optional composition-level `AppOptions.gatewayProjectionPolicy`. No `ServerOptions` or frozen `DispatchPermit` edit; `denyDispatch`/`denyFinalResult` unchanged.
- `v2/server/src/journal/event-contracts.ts`: metadata-only gateway config/boot/report/command whitelist, machine-specific audience, project/ticket null.

Docs:

- New `v2/docs/flows/server-gateway.md`
- Existing `server-docs-view.md`, `server-platform.md`, `server-journal.md` updated with corresponding producer changes.
- PM owns manifest, generated index/files, architecture and Git. Architecture integration note: additive007 stores boot/heartbeat/desired/applied/management/companion records, latest-report pointer and immutable receipts; defaults preserve unconfigured execution authority. No auto-migration. No model invocation.

## Delivered protocol

All nine routes are registered in `buildApp`, strict nested schemas preserve/reject additional properties:

| Route | Principal | Behavior |
|---|---|---|
| POST `/v2/gateway/boots` | Machine | Machine-row CAS generation; current retry; durable retired boot history |
| POST `/v2/gateway/heartbeat` | Machine | Receipt/hash lookup before boot/sequence check; historic replay never changes current status; server clock |
| GET `/v2/gateway/config` | Machine | Config and applied summary; before owner config `{desiredConfig:null,applied:null}` |
| PUT `/v2/gateway/machines/:id/config` | Owner + Origin/CSRF | Revision CAS, two mandatory source pins, nullable runtime slots, strict official URL allowlist, durable sync command |
| GET `/v2/gateway/commands` | Machine | Decimal cursor ordered by commit; default50/max100; completed history retained |
| POST `/v2/gateway/commands/:id/ack` | Target machine | received/completed monotonic; completed result conflict409; received after completed no-op |
| POST `/v2/gateway/install-reports` | Machine | Immutable report-ID/body-hash replay first; new current boot/config required; exact source/projection/derivation; partial keeps prior applied |
| POST `/v2/gateway/attempts/:id/projection` | Bound current machine | Current005 guard/fence/process check before cache; server command/decision selection; immutable companion pair |
| GET `/v2/gateway/machines/:id/status` | Owner | Current boot/receipt, desired/applied/source+runtime slots, pending commands and reported process observations |

Mutation authorization uses actual request credential in the same transaction before idempotency cache/new work. Machine lock blocks token/revocation changes while authorized. Projection takes reviewed005 root/ticket/project/attempt/guard locks first, then machine, then007; no inverted machine→project claim lock. Owner holds session read lock/rechecks expiry. Reads recheck actual credential in repeatable-read snapshot. Unbound machine can boot/sync its own workflows; existing project ACL remains unchanged.

Production companion policy defaults `SELECTION_NOT_CONFIGURED`503. Private test authorizer loads command selection and matching dispatch decision, current config/applied/latest accepted report; it persists a private DB proof only when005 claim authorizer accepts. Companion policy requires that proof. Service separately compares returned selection with stored command/decision, accepted report pair and immutable attempt domain Pin. Config change after authorized claim retains the accepted pair, including before the first companion insert. Old accepted report alone never authorizes a fresh claim.

Heartbeat/report never write005 attempts/commands/execution_guards, even a `stopped` process observation or offline status. Offline is presentation after60s server receipt age, not stop proof. Raw lastError is normalized in stored report and public state. Reported source URL must satisfy the fixed release allowlist; server performs no network fetch/redirect. Host Task4 owns byte/tree verification and redirect validation each hop.

`gateway_applied.latest_report_id` is an internal same-machine FK, added to distinguish the actual latest report when timestamps tie; partial latest report preserves old revision without becoming selection authority. Public frozen DTO is unchanged. No default desired pins are fabricated before owner configuration. ACK `details` accepts nested object/string/array (max depth4,20 items per collection,string200), rejects control/path/credential values/keys; this corrects an initially over-narrow numeric-only schema.

## DTO/API exports

Contracts: `Workflow`, `Runtime`, `SourcePin`, `ProjectionPin`, `DesiredWorkflow`, `GatewayConfig`, `ConfigInput`, `BundleState`, `SlotStatus`, `WorkflowStatus`, `WorkflowInventory`, `GatewayHeartbeat`, `InstallReport`, `InstallReportResponse`, `DispatchSelection`, `AttemptProjectionPin`, `ProjectionInput`, `GatewayProjectionPolicy`, `GatewayAck`, `GatewayCommand`, `GatewayApplied`, `GatewayStatus`, `toDomainPin`, bounded JSON schemas.

Factory: `registerGatewayRoutes(app,options,deps,projectionPolicy=denyProjectionSelection):void`. Composition injection uses `AppOptions` only.

Service: `authorizeGatewayMutation`, `validateOfficialSource`, `readGatewayConfig`, `readGatewayApplied`, `writeGatewayConfig`, `registerBoot`, `saveHeartbeat`, `saveInstallReport`, `listGatewayCommands`, `ackGatewayCommand`, `readGatewayStatus`, `saveAttemptProjection`, `denyProjectionSelection`.

Private test support: `bootId`, `source`, `projection`, `nextConfig`, `inventory`, `heartbeat`, `report`, `countExecutionRows`, `gatewayFixture` (authenticated owner/machine clients + machineId), `selectionAuthorityFixture`, `prepareSelection`. No permissive test flag or fixture import in production.

## Verification evidence

TDD:

1. Real prefix6/bootstrap/login/machine fixture reached missing gateway route404, expected200.
2. `captureMigrations(7)` initially failed `MIGRATION_SEQUENCE_INVALID`; after007 prefix setup/checksum replay passed and route test remained RED404. Thus protocol RED was observed after successful fixture prerequisites.
3. Boot/config/report/ACK/heartbeat tests RED with absent routes, then GREEN6/6.
4. Fenced companion tests reached successful005 private authorized claim; missing projection route RED404 vs required503/selection response, then GREEN9/9.
5. Raw-error storage and credential-bearing inventory URL negative tests RED, corrected to sanitized stored report/rejected URL.
6. Valid nested/string ACK details RED400 vs200, corrected and focused verification GREEN.

Final focused command (absolute one-file runner):

`pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/gateway.test.ts`

Result **22 tests,22 pass,0 fail/cancelled/skipped**,7125.141375ms. Covers all desired non-null Claude/Codex/API slots, partial-old-report replay, boot CAS and receipt concurrency/order, config/URL/CSRF/schema, current auth, five-family cached replay race, owner session expiry race, restart, ACKs, projection authority/default deny/current fence, disabled/null runtime, old/current reports and guard isolation.

One covering server run completed **191/191,0 failures**,32374.126333ms before the narrow ACK-details schema/validation correction and two final ACK/all-runtime tests. Command used one owned temporary umbrella `.test.mjs` importing every `v2/server/test/*.test.ts`, passed as one absolute `--test-file` to the unmodified runner. It was outside server/test and deleted after completion. Whole191 was intentionally not repeated after the scoped wire correction; final covering gateway22 + types/Biome verified that correction. Logs: `/tmp/crew-v2-gateway-cover.log`, `/tmp/crew-v2-gateway-final.log`, `/tmp/crew-v2-gateway-ack-red.log` (scratch diagnostics, not product artifacts).

`pnpm --dir v2/server typecheck` exit0; owned `pnpm exec biome check` on gateway3/source app/event-contracts + gateway test/support:7 files, no fixes/errors; `git diff --check` exit0. Structural headings check: new server-gateway and three affected flows each7/7. `git diff --exit-code c6f9b60 -- migrations001–006 src/execution src/platform/contracts.ts` empty/exit0. No domain/gateway/desktop broad suites repeated.

## Migration, backup and cleanup

007 has9 tables; positive revision/fence/generation/sequence, bounded maxJobs, enum/hash checks, FK restrict, current-boot unique index and composite heartbeat `(machine,bootId,generation)` FK. Immutable triggers protect heartbeat receipts, reports and attempt projection rows from update/delete; boot allows only one-way retirement. New tables use their own management command cursor/types, no005 ticket command reuse. API checksum/restart fixtures exercise real PostgreSQL18.6.

Backup rehearsal: own logical prefix6 DB → pg_dump → restore6 into second own DB → apply captured prefix7 only to own source → create gateway rows → pg_dump/restore7 → migrate7 checksum replay → compare durable receipts → HTTP historic receipt replay from restored pool. Both DB pools/app listeners close in finally; restored DB explicitly dropped and databaseFixture drops source logical DB. FK23503/CHECK23514/UNIQUE23505 failures were asserted. No shared/prod/phase02 worker DB used.

Exact final owned runner container:

- ID `850426b09f6348d61e46a5ee8a2545879bbf57f92f0c2e7763bba36142da7ced`
- loopback port53747 (not5432/55432)
- backup fixture source `crew_v2_test_ede2e2a4c9f9402e9e20c5e94a412ec5`

Covering runner: ID `9b342759730242d3140825022383364864e38e972fd9b4dff3ca5ee0aac040db`, loopback51032, backup source `crew_v2_test_0459c5727ecb41a1b851b38d82712eaa`. Prior scoped ACK/final21 runner ID `1bb11e2dad63ca91ae0ec5b455401f4ba6e5576b2f06d5fff0d48700c57e4022`, port52988.

`docker container ls --all --quiet --filter id=<each exact ID>` returned empty, exit0 after completion for all three. Temporary umbrella `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-gateway-cover-e1s0i74w/cover.test.mjs` and owned parent directory removed. No global prune, service restart, global install, persistent launchd or model calls.

## Frozen hashes

- 007 SQL `9a5542b2a58dd151d1ad78a7dc799ba7bee157abfd094c3c1ebfebf1a2d49eb4`
- contracts `546ee14da64b367a95d70943bfb2394ca11ee643905391ab7fa53a0797fa38eb`
- service `07cfebeebc7ae0f57534cd4d9b478e0e45e363c094e8a2d2d6b11ae0cfe2f605`
- routes `27f551e751766b8a4ecba5f2c24f21170fd40b11076b4868d9439521af58f348`
- support `e76fa45ec525922c16e6d3351b1d15dfbd5300c2c7a260fe32df31bc3424d29a`
- test `fbad7ca2ce5bc1b8db6867953968fb6ca798e4af41b8a996483124431f06451f`

Source/migration/test hashes above are current; source freeze means no further edits by this implementer until review findings. Initial inventory: none of the six new source/test files or server-gateway flow existed; existing app.ts and event-contracts.ts matched reviewed phase02 baseline. Final inventory: six new source/test files, new flow, narrow two shared source edits and three existing flow updates (twelve files excluding this report). Other agents and PM changes are outside this inventory.

## Limits and remaining controller gates

- Production dispatch/projection/final verification remain unavailable by design until later authority composition. Private DB fixture is not real runtime certification or process-stop evidence.
- Docs manifest/generated/architecture integration and independent review are PM-owned. Direct bundle command was rejected by PreToolUse `.ckignore` rule for `dist`; `pnpm exec crew-docs` command unavailable in this checkout. No bypass/config change made. Structural docs verification is done; PM must run the final manifest/docs gate through its allowed tool path.
- Unexpected intermediate failures were confined to test fixture parsing/route assertion/type/format corrections; all final owned checks green. Intentional TDD RED cycles are recorded above; no unresolved repeated infrastructure failure, no review fix round yet.
- No unresolved implementation questions. Owner services and other workers' files preserved. No source beyond explicit ownership changed.
