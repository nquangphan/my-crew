# Task 1 — Source freeze và bàn giao kiểm thử

**Trạng thái:** SOURCE_FROZEN_FOR_INDEPENDENT_REVIEW; verification Task1 GREEN, covering server có một lỗi HTTP baseline chưa đóng. Chưa Task1 accepted, chưa system certification.

- Worktree `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`; original dispatch base `ccb3498`, recovery sau `e94f2e1`; HEAD khi freeze `0e3d1d22ac660d374f64dde95107a7a6bab21332` do PM/peers commit. Worker không stage/commit.
- Source freeze 2026-10-02 14:39:27 Asia/Ho_Chi_Minh; report freeze 14:43. `task-1-inventory-final.json` giữ 13 file nguồn/test/flow và SHA256/size. Hash tất cả13 không đổi sau covering. Manifest/index/generated docs và independent review do PM serialize.
- Actual008 độc lập SPEC+QUALITY READY tại `execution-phase04/task-1-re-review.md`, candidate `d249a820c744b3e61853f09caa4363be4e4f0d9e`, SHA256 `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f`. PM mở DB009 gate khi resume14:18 và giao ownership narrow additive event whitelist + metadata regression + R3 server-journal. Không dùng accidental peer009 run làm acceptance/cleanup proof.
- SQL009 frozen `fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a`, 20136bytes. Không sửa001–008; prefix008/009 checksum được assert trước migration/restore driver. Reviewed semantic fix waves consumed0; các RED/fix trước independent review không là review waves.

## Đầu ra đã triển khai

1. Config root tuyệt đối bắt buộc, maximum chỉ giảm, lower bound, canonical policy SHA và freeze nested limits/extensions. Accepted policy DB không có absolute storageRoot.
2. Original mỗi UUID riêng dù digest giống nhau; private0600 ownership/operation/intent/ACK markers, no-symlink checks và startup fsync/exclusive-link probe. Stream count/hash, write tối đa64KiB; fsync/close stage→fsync directory→exclusive hard link→fsync/unlink/fsync. Foreign destination kể cả same digest bị từ chối; replay chỉ cùng inode stage. Cleanup kiểm nonce. Derivative đòi trusted persistIntent journal trước bytes và key stage có derivativeUUID.
3. Exact Linux writer identity host/boot/PID namespace/PID/startTicks; field22 parser xử lý comm có space/parenthesis. Permission/topology/malformed identity fail closed, không biến TTL thành process-gone. Registry internal control.run chờ work và control socket terminal rồi mới fsync close ACK gắn storedreceiver/generation/nonce/identity. ACK replay sau release local map đọc durable exact proof. Mac production register default deny.
4. Stage owner-only compose/reserve/receive/replay/abandon, scope/session/root lock và owner quota accounting. Reservation ghi policy/nonce/UUID trước bytes; private lease mutator serialize SQL Date thành JSON-safe row. Stream không giữ SQL Tx, heartbeat/generation/maxwall/abort kiểm trước publication. MIME magic/text UTF/control-byte checks trước ready; body ready replay băm toàn bộ.
5. Ready CAS kiểm generation/receiver/current compose/abort/closed proof và verified original. Exact `attachment.changed {attachmentId,state,extraction}` whitelist enum/UUID/string/exactKeys. Draft/inbox chưa live link projectId/ticketId/audienceMachineId đều null; live link scope project+ticket cùng có, audience máy null. Không composeSessionId/path/content/bytes. Failed ready transaction giữ blob+intent, không bypass event validation. Failed settled operation vẫn ghi close ACK kể cả blob đã publish; quota vẫn giữ.
6. Abandon yêu cầu actual terminal proof trước reclaim; không release quota/bytes. Active pending producer không ACK hoặc takeover chỉ vì lease hết; late generation không ready. Original once-linked không automatic GC ở phase05.
7. Complete shared types và schema009 inbox/routes/messages/immutable snapshots/manifests/receipts/scopedauthorizations/grants/sessions/extractions/derivatives/GC/dispatchpins cho task sau. Actual legacy appendComment trigger009 fanout root/affected descendants/input revisions đúng một lần, lazy1→2 và rollback cùng comment. Consumer claim/reply/CAS thuộc Task2/3/6, không tuyên bố consumer integration đã chạy.

## TDD và evidence

Evidence pure trước gate và incident Date codec được giữ nguyên trong `task-1-report-pending-008.md` (SHA5956a134219fb1fa82134c641d01f4bfb7a5977fa1d4d7d3f8893cfbc26c9162) và logs. Pure final lúc pending18total17pass1platformskip trên cả macOS và Linux. Pure suite cũng được chạy lại trong covering cuối.

| Log / command | Exit / counts / ý nghĩa |
|---|---|
| `logs/event-red.log`, `logs/event-enum-red.log` | exit1: missing event case; then coercible enum array accepted incorrectly; negative regression caught it |
| `node --test v2/server/test/attachment-event.test.ts`; `logs/event-green.log` | exit0,3/3; positive exact metadata + negative extras/invalid scopes/enums/types |
| `pnpm --dir v2/server test --test-file <absolute attachments-staging.test.ts>`; `logs/db-staging-first.log` | exit1,14total11pass2fail1skip. Actual009 migration and receive/Date codec passed; own event assertion incorrectly selected events.id, corrected only to actual cursor |
| same focused native pattern; `logs/native-db-red.log` | exit1,1fail: direct terminal closeACK replay returned RECEIVER_WRITER_STILL_ACTIVE |
| `logs/native-db-green.log` | exit0,1/1 after durable proof replay fix; actual private PG + Linux writer |
| focused `publication failure preserves`; `logs/published-terminal-red.log` | exit1,1fail: published original retained but no terminal proof after injected after-publish fault |
| `logs/db-staging-green.log` | exit0,16total15pass0fail1hostskip after settled-error ACK fix; includes actual private socket abort, heartbeat, no lease-only takeover |
| focused `migration restores reviewed`; `logs/migration-restore-first.log` | exit1,1fail: own seed used nonexistent ticket instead of fixture.request; own verification fixed, source schema untouched |
| `logs/migration-restore-green.log` | exit0,1/1: actual008 pg_dump→restore→009, actual009 pg_dump→restore reserved original identity, marker, immutable checksum/replay, correct-hash altered009 rejected MIGRATION_DRIFT |
| Scoped `pnpm exec biome check --write` on10 owned TS files; `logs/biome-final.log` | exit0,10files,0diagnostics |
| `pnpm --dir v2/server typecheck`; `logs/typecheck-final.log` | exit0 |
| Final explicit covering below; `logs/server-cover-final.log` | exit1,253total250pass1fail2platformskips,45.812s. All38 Task1 registered tests:36pass2platformskips |
| Narrow baseline `pnpm --dir v2/server test --test-file <absolute api-acceptance.test.ts> --test-name-pattern='HTTP bounded docs upload'`; `logs/api-baseline-focused.log` | exit1,1fail; EPIPE reproduced without any Task1 test import, migrationprefix6 |

Final covering exact command:

```sh
pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/plans/261002-0002-crew-v2/execution-phase05/task-1-cover.test.mjs
```

Owned wrapper imports exactly24 committed server test filenames from candidate d249a82 (byte-identical to HEAD) plus attachments-storage, attachments-staging, attachment-event. No peer unfinished tests discovered by glob, no test runner edits. Node registers these tests in one test-file process. `task-1-cover-inventory.json` pins all27 bytes, wrapperSHA, HEAD and migration008/009. Existing baseline fixtures use their own reviewed prefix; every Task1 DB integration uses actual009 except deliberate008 backup upgrade. No source mutation during covering.

**Outstanding covering failure:** unchanged `v2/server/test/api-acceptance.test.ts:799` HTTP bounded docs upload/SSE case fails client fetch with write ECONNRESET. A focused actual HTTP reproduction on unchanged file and databaseFixture6 fails write EPIPE. Test posts ordinary1MiB and docs24MiB bodies expecting413; helper uses native fetch, and app's existing bodyLimit rejects oversized requests. Early server rejection while client writes is a hypothesis, not an established root cause. No Task1 HTTP route was registered and case never calls attachment service. Worker made no unowned app/helper/test fix and no broad repeat. PM must route baseline diagnosis/repair and require a new final cover if production changes; current cover is not reported green.

## Resource identity và cleanup

- PM-authorized official image `node:24.12.0@sha256:929c026d5a4e4a59685b3c1dbc1a8c3eb090aa95373d3a4fd668daa2493c8331`; cache retained. Native256MiB/1CPU/pids32/read-only repo/cap-dropALL/tmpfs64MiB. Pure driver networknone; actual DB lifecycle driver network=container:<exact ownPGID> with loopback random private proxy. This test connectivity is not the production extraction sandbox/isolation certificate.
- Fresh14:38 observed CPU88.40%idle, load3.21/2.81/2.82, disk38GiB available. OS raw VM sample recorded in tool output; no inferred RAM-free percentage claim. No ownersecret/provider/model calls, sharedDB/55432/globalHOME/native permissions or image pruning.
- Exact11 logged resumed-run container IDs inspected after completion: every inspect exit1 with **no such object**. `task-1-cleanup-final.json` records IDs/errors, not a global docker delta. Native create/start/exit0/remove exact ID logged; failed native regression also removed exact ID. PostgreSQL runner validates own name/random127.0.0.1port and cleans exact ID in finally; logical DBs dropped in fixturefinally.
- Across resumed own evidence logs48distinct scratch roots have matching created/removed records; all local mac roots verified absent. Fixture cleanup checked persisted nonce, dev/inode and no symlink first; Linux roots were removed before exact tmpfs-container removal. Actual private restore database names/prefix/container IDs and drop logs are retained. Backup buffers only in memory, no leftover dumpfiles.
- Narrow frozen API reproduction's runner created/stopped its own private PG internally but did not print its ID because case has no attachmentfixture; it is not included in11 exact external absence inspections. No cleanup claim based on accidental peer run.

## Export handoff và giới hạn

`BlobStore`, `StageServices`, `ReceiverRegistry` required public signatures retained. `createFileBlobStore` trusted persistIntent required for derivative publication; future factory must persist matching GC ownership before bytes. Upload reservation/register already durable before write. `ManagedReceiverRegistry.control.run` is internal lifecycle proof; createStageServices fails closed503 without it. readLocalWriterIdentity Linux only; mac test-owned receiverport explicitly protocol-only, no native gone proof. Store helpers prepareOwnedUpload/readPrivateJson/writePrivateJson/noSymlinkComponents/syncDirectory/renameOwnedStage expose storage mechanics, no route/access authority.

Native actual PG test binds proof to DB stored receiverID/generation/birthidentity and tests real socket abort, awaited in-flight producer, heartbeat/no lease takeover, successful ready and direct closedACK replay after maprelease. Pure spawned process probes prove exact birth disappearance; actual process-kill→recoverTask7 multi-process/reconcile gate remains. Atomic submit/access/snapshots/extraction/download/currentgrant/consumer claim+reply acceptance belongs later owners. No public app/route wiring, UI, extractor, paid provider, dispatch or isolation certification claimed.

Owned docs server-attachments and server-journal updated; PM maps three newtests/newmodule in manifests/generated index and runs staged docs checks. Worker did not edit packages/lockfiles/manifests/app/events/frozen001–008, stage/commit or spawn agents. Peer gateway/model/workflow files preserved. PM independent full Task1 review plus baseline covering repair remains required before acceptance.

## Frozen owned inventory

| Path | SHA256 | Bytes |
|---|---|---|
| `v2/server/migrations/009_attachments.sql` | `fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a` | 20136 |
| `v2/server/src/attachments/config.ts` | `821ce0d6d8deb92c405b2bb5ab009eff4c8515c9aecc265b5c6f5b033ec36b03` | 3804 |
| `v2/server/src/attachments/contracts.ts` | `5b6a496b4c0e86298a2d69d76f4666e07cbb783d8ca153ccb4f17fc4f45eb906` | 11551 |
| `v2/server/src/attachments/receivers.ts` | `44a5e3bd1ef62e73c773a1c0531b21569da9ad8b3e94b473a11d91f268eeb21b` | 15805 |
| `v2/server/src/attachments/staging.ts` | `99ee1d12a5e8822904c9112850b563a8fa03dbd0ea500c726cb54de9345fec03` | 27544 |
| `v2/server/src/attachments/storage.ts` | `b252f6b1f97fd08359c9f369bebf2f680fce2abc0a23793cd63d8eb678c9db2c` | 15312 |
| `v2/server/test/attachments-storage.test.ts` | `47a6fefadb13c4c7f4b72da43e421c254a0003967499e89bb678bc9c936f6ad8` | 20433 |
| `v2/server/test/attachments-staging.test.ts` | `b8320235ba20eeddda18be109d09f7775ee7471e1b5a450305d3b7cd63cd742f` | 24597 |
| `v2/server/test/attachment-event.test.ts` | `56cc3a520b31ff527dc51e0a56d8e09d1c2395cb5dd3202d92b2396cb3985e50` | 2166 |
| `v2/server/test/support/attachments.ts` | `2a2aad2d4b45f3bbe653b87240e91953583b2cec49905945d3446a9115e50ba9` | 24396 |
| `v2/server/src/journal/event-contracts.ts` | `bdfdc2849819f428e765fd5f00fdeb74bbb470de7c41c8741fe83e27cc866c9c` | 12100 |
| `v2/docs/flows/server-attachments.md` | `5511c6e55c6f86875bfd58ab2acaeb56233ee33b847c3d093e268d1c7038d19f` | 7830 |
| `v2/docs/flows/server-journal.md` | `4beecd1904266683ae16317317c9930de7017a6b9f5362faaf60f576a19f18db` | 9183 |

## Exact covering inventory

- `v2/server/test/api-acceptance.test.ts`
- `v2/server/test/attempts.test.ts`
- `v2/server/test/auth.test.ts`
- `v2/server/test/commands.test.ts`
- `v2/server/test/completion.test.ts`
- `v2/server/test/dependencies.test.ts`
- `v2/server/test/deploy.test.ts`
- `v2/server/test/docs-events.unit.test.ts`
- `v2/server/test/docs-import-cli.unit.test.ts`
- `v2/server/test/docs-import.test.ts`
- `v2/server/test/docs-read.test.ts`
- `v2/server/test/docs-validator.unit.test.ts`
- `v2/server/test/execution-events.unit.test.ts`
- `v2/server/test/gateway.test.ts`
- `v2/server/test/journal-scope.test.ts`
- `v2/server/test/journal.test.ts`
- `v2/server/test/model-certification.test.ts`
- `v2/server/test/model-pool.test.ts`
- `v2/server/test/model-secret.test.ts`
- `v2/server/test/platform.test.ts`
- `v2/server/test/projects.test.ts`
- `v2/server/test/repair.test.ts`
- `v2/server/test/ticket-events.unit.test.ts`
- `v2/server/test/tickets.test.ts`
- `v2/server/test/attachments-storage.test.ts`
- `v2/server/test/attachments-staging.test.ts`
- `v2/server/test/attachment-event.test.ts`
