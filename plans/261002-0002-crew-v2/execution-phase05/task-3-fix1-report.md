# Phase05/Task3 FIX1/5 — T3-Q1 source freeze

**FROZEN; PENDING FULL INDEPENDENT FIX1 SPEC/QUALITY REVIEW.** Đây là một wave sửa finding T3-Q1, không phải acceptance/assembly/certification/deployment. Actual focused GREEN3/3, strict source types và Biome4 clean. Original44 được giữ như lịch sử của source trước FIX1; không union thành PASS của source hiện tại. Không Git/index/stage/commit, subagents, schema/app/package/mapping/global/shared-service edits.

## Review và approved boundary

Đã đọc full `task-3-review.md`, SHA `f3574ac85c96c8f7ba8540e5eed1cac26f4f2c5fb32ff89d0aa9bfa246eec352`, candidate `c5f9ad352e02a991c84e69f8500208814e895b5d`. Review finding P2 T3-Q1: grouped derivative unit-array bị scan/hash lại theo mỗi unit trong root/input locks. SPEC được đánh giá compliant trong boundary đã duyệt; quality NEEDS FIXES trước wave này. FIX1 chỉ sửa `snapshots.ts` và affected own test/support/R3. Producer/schema/signature/authority gates ngoài scope được giữ frozen trong executable snapshots.

Original report immutable copy `task-3-report-before-fix1.md`:16263 bytes, SHA `f658ad3a8c2c4f96bf35650ed800713eb0d0f72a1fda967ced03b35af543bb90`. Current `task-3-report.md` header ghi source cũ superseded và pending FIX1 independent review; original content/evidence không bị diễn giải thành new-source acceptance. Workflow receiving-code-review + TDD: đọc actual source/finding, tạo real bounded-work regression, chạy RED khi snapshots source vẫn byte-identical candidate, sửa một lần, chạy affected GREEN/types/Biome.

## Change và invariants

Actual derivative SQL vẫn giới hạn exact extraction/original; thêm hai identity columns để kiểm provenance rõ. Persisted row map theo derivative UUID tính canonical unit-array digest một lần mỗi row. Manifest derivative được prevalidate một lần: verified, exact attachment UUID/hash/owner, extraction UUID, extractor version/config, actual persisted SHA/length/MIME/kind/verification và identical canonical unit-array hash. Chỉ valid candidates được index theo text/vision và unit ID; giữ candidate hợp lệ đầu tiên theo manifest order. Vòng unit chỉ lookup exact needs, kiểm available, và dùng unchanged problem/selected ID/capability behavior.

Index nằm trong mỗi original/extraction loop: cùng `u1` ở nhiều originals không cấp quyền chéo. Không thay canonical snapshot/revision, trusted selection shape, required projection, authority/grant/read-byte gate hoặc byte publication semantics. Complexity của coverage là một traversal mỗi persisted/manifest derivative unit-array + unit lookup; không claim mọi đường subset đều tuyến tính. IDs vẫn deduplicate/sort như trước, capabilities chỉ từ actual selected coverage.

## Actual regression và RED → GREEN

Fixture owner uploads/link qua accepted API/services, private PostgreSQL001–010; grouped2.048 text units và một derivative được publish qua actual accepted `createExtractionJobs`, framed controlled typed runner, actual BlobStore/generation/CAS/manifest SQL và closed publisher ACK. Một derivative chứa exact 2.048 unique text locators và unit IDs. Đây là inert protocol/publication fixture, không production parser/provider/comprehension certificate.

New `attachment-snapshot-work.ts` Proxy quan sát actual SQL-returned rows, giữ real query/values: SHA property reads đo real persisted validation; numeric unit-array reads đo actual canonical hash traversal. Không production counter, synthetic DB response, timer threshold hoặc mirrored coverage implementation. Regression bắt buộc ready/text capability/exact selected derivative/exact original/full2.048 unique coverage trước bounded assertions; còn bắt buộc ít nhất một validation và một traversal nên bỏ validation thành no-op không PASS.

| Actual run | Child result | Real grouped-work observation |
|---|---|---|
| `fix1-red` source snapshots unchanged | exit1;0/1; bounded validation assertion fail sau các coverage positives | queries1/rows1; validations2.048; numeric reads4.194.304 |
| `fix1-green` last production source | exit0;3/3;0 fail/cancel/skip/todo | same queries1/rows1; validations1; numeric reads2.048 |
| `fix1-types` | exit0; ordinary strict `tsc --noEmit`, source scope | no PG |
| scoped Biome4 | exit0; no diagnostics/fixes | four changed TS paths |

RED diagnostic chỉ có counts; GREEN bổ sung PID/argv/NODE_OPTIONS diagnostic, không đổi bounded assertion hay positive contract. Counts chứng minh actual repeated hash/validation được loại; durations trong log không dùng làm benchmark latency. GREEN test2 kiểm tám actual persisted tamper fields riêng: SHA, byte length, MIME, kind, verification, unit IDs, original UUID, extraction UUID ⇒ waiting/no selected ID/no capabilities/MISSING_REPRESENTATION; restore captured exact row rồi snapshot equal baseline. Test3 là existing exact original subset regression: imageA/textB cùng `u1`, selectA ⇒ chỉ visionA; stale/zero/unknown/hash/wrongtarget/original negatives giữ fail-closed. Không direct SQL verified flag/manifest để dựng positive coverage; negative tamper là deliberate corrupted persisted state.

Exact commands (expanded snapshot argv/PIDs/source SHA/logs trong per-run evidence):

```sh
python3 plans/261002-0002-crew-v2/execution-phase05/task-3-fix1-test-snapshot.py fix1-red attachments-snapshots.test.ts --test-isolation=none --test-concurrency=1 --test-name-pattern='grouped derivative coverage'
python3 plans/261002-0002-crew-v2/execution-phase05/task-3-fix1-test-snapshot.py fix1-green attachments-snapshots.test.ts --test-isolation=none --test-concurrency=1 --test-name-pattern='grouped derivative coverage|indexed snapshot candidates|attachment subset selection'
python3 plans/261002-0002-crew-v2/execution-phase05/task-3-fix1-test-snapshot.py fix1-types types
pnpm --dir v2/server exec biome check --error-on-warnings src/attachments/snapshots.ts test/attachments-snapshots.test.ts test/support/attachment-access-publication.ts test/support/attachment-snapshot-work.ts
```

Outer launcher exit0 không phải test PASS: child exit1 RED được giữ trong evidence. Node24.14.0 strip-types executes test; strict source tsconfig không claim test files riêng đã typechecked. Không broad44 rerun vì thay đổi localized coverage, named focused cases kiểm actual complexity/identity/modality/subset boundary. Source TS last hashes khớp GREEN và types manifest; R3 prose thêm sau GREEN và có trong final types manifest, không thay executable TS sau checks.

## Source / evidence freeze

Owned paths duy nhất so với candidate:

| Path | Bytes | SHA256 |
|---|---:|---|
| `v2/server/src/attachments/snapshots.ts` | 16398 | `c498e9e953c7eae2aa840c9fc97cef0e0b5bcf88071315be60ebb9bf918f3969` |
| `v2/server/test/attachments-snapshots.test.ts` | 31643 | `14cd2467cca851ecbfce4aaaa71b892b8b8002e59e22106d59f2de0fd1b7b464` |
| `v2/server/test/support/attachment-access-publication.ts` | 5388 | `579fc484af1bf8bfc8b2931f3de7342a324d4a42e48f433a77b13e5f63df10a4` |
| `v2/server/test/support/attachment-snapshot-work.ts` | 1689 | `577ea7bfc40f8bc86965c3babd353e4c77638d2f338b6e3183cfb2191ceb4c3a` |
| `v2/docs/flows/server-attachments.md` | 24646 | `43c9ae3c71245987ba51379e096af99a37ef386d5ef4cca2307d07877cf3b9a0` |

`task-3-fix1-source-inventory.json` SHA `1d86505c6662fae81a07b21e962a322415b5ebcbbc85f9671b2e23c27a543142`; `task-3-fix1-source.patch` SHA `86db1a014ef8ca4f20e5173f5e5be8c4cad0a3c7af0d4d2b9d906e402b22a47a`. Actual GREEN/types manifest frozen contracts/jobs/messages/routing/worker protocol/runner/entry/app/package và001–010 khớp accepted c5 Git objects. Current peer contracts/protocol/runner/entry có divergence (Task5), được ghi current SHA trong inventory và loại khỏi test snapshot; không restore, edit, review hoặc nhận những bytes này làm FIX1 evidence. No schema001–010 edit. New helper R2 mapping/generate thuộc PM serialization; worker chỉ R3 đã duyệt.

`task-3-fix1-evidence-inventory.json` (35 files) SHA `c08157a84110a933ed72d9839150e7084b7e45ca49f84d80eb49b3fb955b17be`, có bytes/SHA của launcher, per-run raw pressure/preflight/intended/created/closed/cleanup/source manifests, four logs, source patch/inventory, cleanup inventory và original/current reports. FIX1 report tự excluded để tránh self-hash cycle; report SHA được handback riêng. GREEN log SHA `5a8ea3f3497bf7b09f447778e1dc212e82c9b3d110426c19709866509586eb00`; RED `67804e79b889df20a31ab106cc5aaedb4cbb3814a5a682236e9e5f320b5c0503`; strict types `5815a471862da02ac019cf69b0af359b0d4642cb779015db4ca3ed44de8c3bdb`.

## Resource admission và actual closure

Static edits chỉ trong lúc parser giữ heavy slot. PM20:25 explicit refined ruling sau parser76/76 + strict closure: ONE serial private PG256MiB/cpu1/pids64 + host Node test child heap384MiB; pressure1 hoặc2, estimated available>=4GiB, idle>=50%, disk>=8GiB; critical deny, không other heavy/native/provider canary. Launcher kiểm trước any snapshot/container creation và lưu exact ruling/raw telemetry. Free+inactive+speculative là reclaimability estimate, không hard resident memory limit. `NODE_OPTIONS=--max-old-space-size=384` chỉ cap JS heap, không claim full process tree RSS isolation. Test isolation none + concurrency1 tránh additional test-file worker; pnpm wrapper process vẫn hiện trong exact argv evidence.

Actual RED20:26:56 pressure2/estimated5.793.644.544 bytes/idle86.36%/disk37.778.345.984; GREEN20:29:38 pressure2/5.381.832.704/61.18%/37.701.169.152; source types20:33:05 pressure2/5.333.090.304/86.54%/37.631.352.832. Tất cả vào explicit refined thresholds. Không hiểu pressure2 là tự động consent; admission dựa PM ruling đã ghi trước tạo. Hai PG runs serial, types noPG. Root notified ngay khi heavy sequence closed để release slot.

Creation/closure receipts giữ nonce SHA + dev/inode/UID trước tạo/xóa snapshot, intended child argv trướcstart, actual PID/lstart/argv và observed waitexit; Docker create fullCID/name/nonce label inspected in created state trướcstart, exact identity trướcstop, exited-state trướcrm, absence sau. RED PG CID `17963fa2b0e17fe2d98f32443e70934d23c6315a77491c12fe9d1ae0b3811f03`, port127.0.0.1:63333, wrapperPID59290/testNode59324; GREEN CID `c550eab9f36b0737b5e351e3668e19d4de160bc5232c9debfee8add546c39f63`, port127.0.0.1:64031, wrapper63479/testNode63514; typesPID66066. No shared55432/defaulthost5432/prodDB/services/globalchanges/secrets/live models.

`task-3-fix1-cleanup-inventory.json` SHA `02af122dd42ef7653f9cdcd1624393d23d2089b305c3313b52586cf974aa2ae1`: three exact snapshot roots absent, two full PG IDs actual `no such object`, four unique attachment scratchroots actual nonce/devinoUID/PID logged and removed, all recorded child PIDs absent on final observation. Current identity checks and historical closure separate. No unknown prefix cleanup/native STOP inference. Inventory first read-only absence assertion had capitalized-string mismatch (`No` versus actual `no`) and was corrected case-insensitively; no resource deletion/extra fixture/test-source fix occurred from this diagnostic error.

## Limits và handoff

Only T3-Q1 derivative coverage block changed. Worker separately reported large-subset `.includes` in unit filtering and `.find` per requested unit in `resolveInputSelection` as additional possible quadratic work outside named finding; left untouched pending PM scope disposition. This report certifies neither their complexity nor full snapshot-path linearity. No implicit scope widening or additional fixes.

Default production-deny gates từ original Task3 unchanged: Task6 InputServices/receipt authority absent, Phase06 Assistant designation/admission/decision authority absent, generic cross-machine consent routing deferred. Controlled fixture ports chỉ protocol evidence. Production ready-input re-extraction enqueue + revision/grant invalidator absent; queued/running/failed supersession coherence chưa được certify. Actual initial-pending final wrapper và defensive preclaim evidence remain original scope; no producer edit in FIX1. Native containment/corpus/provider/comprehension/model receipt/local materialized byte revoke vẫn cần later review.

PM full FIX1 review cần source patch + observational helper + grouped/tamper/subset tests + frozen manifests/cleanup. Candidate creation/R2 mapping/generate/assembly chỉ sau full independent review; chưa worker acceptance claim. Source frozen; further changes phải là explicit subsequent review wave và evidence supersession.
