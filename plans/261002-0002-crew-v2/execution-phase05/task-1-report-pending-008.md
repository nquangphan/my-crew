# Task 1 — Frozen pending-gate handoff

**Trạng thái:** SOURCE_FROZEN_PENDING_008_READY. Đây là handoff công việc đang làm, chưa phải Task1 complete, chưa nghiệm thu DB/native receiver pipeline và chưa là system certification.

- Worktree: `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`.
- Original dispatch base `ccb3498`; recovery bắt đầu sau `e94f2e1`; HEAD quan sát lúc freeze `c6040be2d37e0b69e07ed6709884f74ec55f173f` (PM/peers tiến commit, worker không stage/commit).
- Freeze time: 2026-10-02 13:50 Asia/Ho_Chi_Minh / 06:50 UTC.
- Actual008 **chưa READY**. SHA quan sát hiện tại `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f` là provisional producer evidence, không phải quyền chạy009. Worker này không gọi databaseFixture(9), không áp dụng009 hay chạy covering server.
- PM báo peer covering bị ngắt đã vô tình đi vào009 private testDB: không dùng sự cố đó làm Task1 acceptance hoặc gate approval. PM đang review lại008 và sẽ serialize exact event metadata.

## Đã triển khai trong ownership

1. Config root bắt buộc, maximum/lower bound, canonical policy SHA, freeze object/limits/extensions. Accepted policy lưu riêng trong009; không đưa root tuyệt đối vào DB.
2. Storage private0600 markers/intent, root/no-symlink checks, startup fsync/exclusive hard-link probe, SHA/count/bounded write, exact UUID/generation, nonoverwrite publish, equal-digest separate original keys. Replay publication chỉ nhận cùng inode stage; guessed cleanup nonce bị từ chối. Derivative requires `persistIntent` port trước bytes; stage path thêm derivative UUID để nhiều derivative cùng generation không đụng nhau.
3. Linux writer identity field22 parser hỗ trợ comm chứa spaces/parentheses, same-host/boot/PID-namespace/PID/start ticks observation; malformed identity, unknown topology và permission failures không thành gone proof. Native register default deny trên macOS. Registry thêm internal `control.run` mà giữ public required ReceiverRegistry methods.
4. Managed native operation dùng private0600 nonce abort socket, không ACK khi work chưa settle; durable closed ACK gắn exact receiver/generation/nonce/stored identity. `proveStopped` dùng identity DB của receiver, không identity của observer thay thế.
5. Stage owner-only compose/reserve/receive/abandon, quota giữ tới submitted retention hoặc terminal deleted. Body replay ready được băm toàn bộ. Magic/UTF/control-byte validation trước publication; heartbeat/maxwall/abort/CAS, durable blob giữ khi ready commit fail. Abandon active/ready slot giữ bytes/quota và requests abort.
6. Ready event exact `{attachmentId,state,extraction}`, chỉ live link scope; draft chưa link projectId/ticketId/audienceMachineId null. Missing event registration fails closed (ready Tx rollback), không bypass.
7. Complete shared types S1–S3 và009 tables cho inbox/routing/snapshots/grants/receipts/jobs/GC/dispatch pins. R1 additive actual comments trigger fanout root/descendants/input revisions, lazy1→2; identity/retention/quota latches, immutable records. Schema được authored, **chưa migration-validated**.
8. Seven-heading `v2/docs/flows/server-attachments.md` drafted; manifests/index/generated docs do PM serialize, worker không sửa.

## TDD / verification evidence

| Command / log | Observed result |
|---|---|
| Baseline `node --test v2/server/test/attachments-storage.test.ts` | 5/5 pass; existing interrupted source baseline only |
| `logs/storage-red.log` | 5 pass / 6 fail. Wrapper had trailing tail exit0; actual RED shown by 6 behavioral failures (no false claim of captured node exit). |
| `logs/storage-green.log` | node exit0, 11/11 pass after storage/policy fixes |
| `logs/storage-intent-red.log` | exit1, 12 pass/2 fail: no required derivative journal and same-generation collision |
| `logs/storage-intent-green.log` | exit0, 14/14 pass |
| `logs/native-red.log` | exit1, 15 pass/1 fail/1 mac-only skip; malformed birth evidence yielded true gone proof |
| `logs/native-green.log` | exit0, 16 pass/1 mac-only skip |
| `logs/private-lease-red.log` | exit1, actual mutate/canonical codec returns RESPONSE_INVALID before receiver boundary |
| `logs/private-lease-green.log` | exit0, 1/1 focused regression after Date→JSON serialization |
| Final macOS pure: `logs/storage-pending-final.log` | exit0, 18 total /17 pass/0 fail/1 Linux-only skip |
| Final Linux pure: `logs/native-pending-final.log` | exit0, 18 total /17 pass/0 fail/1 mac-only skip |
| `pnpm --dir v2/server typecheck`, `logs/typecheck-pending-final.log` | exit0 |
| Scoped Biome check/write, `logs/biome-final.log` | exit0;8 files checked, no diagnostics |

The private lease regression uses a test-owned SQL boundary with complete relevant row shape and real `mutate`/canonical codec, not a migration fixture. It proves timestamp serialization, not DB acceptance. Both production code and test normalize accepted policy without an absolute storageRoot.

**Incident clarification:** source originally returned raw SQL rows with `Date` expires/created fields in private start's mutator response. `canonicalJson` rejects Date and produced RESPONSE_INVALID before receiver/event. Pure RED reproduced this directly and GREEN fixes it by returning JSON-safe data. Missing event registration remains a separate later ready-commit gate; do not attribute all observed peer RESPONSE_INVALID to event registration.

## Authored but NOT run DB/native pipeline cases

`attachments-staging.test.ts` has 14 cases (one Linux native registry case). Includes ready originals; owner/stale revision; filename/MIME/max+1/exact/empty; truncated/overrun/checksum/magic/UTF binary; split UTF16 BOM; canonical reserve replay; same digest separate IDs; concurrent owner quota; rejected/abandoned quota retention; ready PUT body replay + exact owner event scope; superseded generation + blob/intent retention; abort while upstream next is pending + premature ACK denial; actual legacy appendComment fanout/rollback; immutable accepted policy/original/snapshot; heartbeat live lease and late writer CAS; native exact stored identity/terminal close ACK. These cases are pending actual008 READY and event registration and are not reported GREEN.

DB RED/functional coverage beyond authoring remains outstanding. Before freeze this recovery added receiver/staging behavior while DB gate closed; those paths must receive real focused regressions after gate, then one final covering server run. Linux birth-process probe is genuine but does not cover the full DB/abort/socket/receiver lifecycle. Actual process-kill/multiprocess recovery/cleanup acceptance stays Task7.

## Resource inventory and cleanup

- Official immutable Node24.12.0 image approved/pulled by PM: `node:24.12.0@sha256:929c026d5a4e4a59685b3c1dbc1a8c3eb090aa95373d3a4fd668daa2493c8331`; shared image cache preserved.
- Containers network none, read-only repo, cap-drop ALL, memory256MiB, CPU1, pids32, own64MiB `/tmp` tmpfs. Initial pids16 with subprocess isolation failed before useful output; `--test-isolation=none` with pids32 provided bounded native tests. Initial --rm names `crew-v2-attachments-native-red-1313`/`native-green-1313` no longer exist.
- Earlier pure final container `4f1c8f70ebd90f0f40346db0a79e9cf95bf50f9f3f85c6216e087cbb81dc318c`: inspected exact ID exited0 then removed exact ID.
- Current frozen-source native container `23a434bc61706d3f425ca7139c6f890ebb3278899b20b1683ee54e595921ed6e`: inspected exact ID exited0 then removed exact ID. No private DB/container created by this worker.
- Final macOS and Linux logs each show 12 scratch roots created and exact same12 removed. Test helper validates persisted fixture nonce and root dev/inode/no symlink before deleting; nonce hashes and exact paths retained in logs. DB fixture additionally refuses cleanup while test receiver work active; it has not been executed.
- Native child process probe kills/awaits only PID from its own `spawn`; wrong namespace/host stays unknown. No detached stream work, no paid calls/owner credential/HOME/native permission/shared service changes.

## Export handoff / next authorized steps

- Public `BlobStore`, `StageServices`, `ReceiverRegistry` required signatures retained. `createFileBlobStore` extra trusted `persistIntent` hook is required for derivative publication; future factory must persist matching attachment_gc ownership before bytes. Upload reservation/register already journal before streaming; fixture also supplies actual GC callback.
- `createReceiverRegistry` returns `ManagedReceiverRegistry` with internal `control.run`; `createStageServices` fails503 if control unavailable. Mac test-owned port is explicitly protocol evidence, never a native gone authority.
- `prepareOwnedUpload`, `noSymlinkComponents`, `readPrivateJson`, `writePrivateJson`, `syncDirectory`, `renameOwnedStage` are owned storage helpers for exact-operation metadata and publication. They grant no route/ACL authority.
- Stage start/finalize use actual mutator; heartbeat never acquires event/project locks after upload stream. Scope locks root/target/project before compose. Absolute paths/bytes/sample never in event/errors.
- No edits by this worker to004–008, app/main/events/packages/lockfiles/manifests/generated docs; no stage/commit/subagent. Peer/PM tracked model edits observed and preserved.
- Source below frozen pending gate. PM sends actual008 READY + checksum/export handoff, registers exact attachment.changed schema, then resumes worker for owned focusedDB/native lifecycle fixes. Only after final production change: ONE covering server run, final inventory/report freeze, PM serialize docs/Git and independent full task review. Reviewed semantic fix waves consumed:0; interruption is not review failure.

## Pending questions / gates

1. Actual008 independent review READY and immutable checksum handoff — PM owned.
2. Exact event-contract registration — PM owned. No bypass if missing.
3. Focused009 DB/native receiver validation, full cover and final task acceptance — pending; cannot claim implemented tested pipeline yet.
4. Native receiver `closeAndAcknowledge` direct replay after terminal map release is not currently tested; `proveStopped` durable replay is implemented. Exercise native case after gate and fix any expected idempotency gap with RED→GREEN.

## Frozen owned inventory

| Path | SHA256 | Bytes |
|---|---|---|
| `v2/server/migrations/009_attachments.sql` | `fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a` | 20136 |
| `v2/server/src/attachments/config.ts` | `821ce0d6d8deb92c405b2bb5ab009eff4c8515c9aecc265b5c6f5b033ec36b03` | 3804 |
| `v2/server/src/attachments/contracts.ts` | `5b6a496b4c0e86298a2d69d76f4666e07cbb783d8ca153ccb4f17fc4f45eb906` | 11551 |
| `v2/server/src/attachments/receivers.ts` | `0194f328810cd7e3e7e465147db1f053135b9f949bc708b4fe1e6c23cd6c1070` | 15431 |
| `v2/server/src/attachments/staging.ts` | `1dc322e68ee2ccb23d991f0b4fd312ceb31d04ab7abcb8d21367f83aa62fcb3d` | 27550 |
| `v2/server/src/attachments/storage.ts` | `b252f6b1f97fd08359c9f369bebf2f680fce2abc0a23793cd63d8eb678c9db2c` | 15312 |
| `v2/server/test/attachments-storage.test.ts` | `47a6fefadb13c4c7f4b72da43e421c254a0003967499e89bb678bc9c936f6ad8` | 20433 |
| `v2/server/test/attachments-staging.test.ts` | `f592a8f1b80f9f0c8a9218a887c4238a6685d50d0addf2d83ee6487eda90119b` | 22869 |
| `v2/server/test/support/attachments.ts` | `932f8acddc9e1cf4e907749bf17857518a620b8ef1af3cbb82c005348ebd64ba` | 8552 |
| `v2/docs/flows/server-attachments.md` | `4c829b062367c5441145d3c4e3627f045ea5f17dc6eb4bb22c84ec2e4c20a322` | 6492 |
