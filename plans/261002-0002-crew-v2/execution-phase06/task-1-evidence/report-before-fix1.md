# Phase06/T1 — Schema và durable Assistant inbox

Trạng thái: **source T1 sẵn sàng independent SPEC/QUALITY review; chưa nghiệm thu/integrate**. Lượt cuối `complete-cover`: **29 tests / 29 PASS / 0 FAIL**, actual PostgreSQL18.6; frozen typecheck và Biome PASS. Không gọi live model, không tạo certificate/admission production. Không Git/index/commit/manifests/packages/shared service mutation.

## Phạm vi và source freeze

Baseline fixture luôn `0c838d21354bb40494a1280200ae281b2ff19e33`, archive readonly cộng đúng sáu source/test T1; loại parser/runtime/access chưa review. [source-freeze.json](task-1-evidence/source-freeze.json) ghi SHA/bytes và prefix001–010 đối chiếu bytes với accepted archive. Doc theo PM ruling ở canonical main-project path; worker không tạo managed `v2/docs/flows/server-assistant.md`. Controller sẽ copy/mapping sau review.

| Path | Bytes | SHA256 |
|---|---:|---|
| `v2/server/migrations/011_assistant.sql` | 38093 | `9dc10ce01e2e2db4e83185f6ca0bd0b0e897ac5daebb2949c446d0480fb649c0` |
| `v2/server/src/assistant/contracts.ts` | 33718 | `adee25f453fa91e7498a1a300d3c7a4761147b8584e738a54818d9cb4b65412f` |
| `v2/server/src/assistant/store.ts` | 4392 | `65034d2770a0f79d549d67d98aa779dc62dcc6b6ca54eab33cfa7ef91889564a` |
| `v2/server/src/assistant/inbox.ts` | 8791 | `3d177b0fe645657179985c22c7698206b1be51e922734a127f868255d11e1d4e` |
| `v2/server/test/assistant-store.test.ts` | 46966 | `f4811318a10f403ed50edc7c48b540cb31eba0b57573183d0417a4811f0d0513` |
| `v2/server/test/support/assistant.ts` | 30214 | `0b2c1304228a26f2a2a6dd85ef657edff587a54fa3aa2caecfd49bcbaee8c748` |
| `/Users/phannhatquang/Documents/projects/crew/docs/v2/server-assistant-draft.md` | 7583 | `91f8862eaef4570fa75c25d4bec5a5514de914eb761abb925eccbe89a0f6d002` |

## Hành vi và ruling đã thực hiện

- Event cursor/work cùng transaction; ingest giữ cursor monotonic, đọc trang200, offline/no designation vẫn tích lũy. Reconcile scan actual009 message/ticket revision; non-null revision dedup trên target+revision kể cả claimed/acked, giữ source cursor/logical key gốc. Lifecycle wake revision null giữ cursor riêng. Comment fanout descendant, không tăng lại counter009.
- Claim/ACK kiểm exact persisted designation/process/generation/current state; uncertain giữ live-turn guard. Shared generation allocator chỉ persistence trong cùng admission transaction T2; không tự mint authority, không reset/overflow.
- Whole011 gồm R1 challenge/certification/capability receipts/calibration guard; R2 tool operations/sequence/immutable response, doc receipt; R3 parent→derived consent linkage; R4 prelaunch attempt hook/retirement/reservation. UUID/FK restricted, state/revision/hash constraints, immutable conversation/message linkage, stable hex64 effect+persisted ordinal. Không sửa001–010.
- Artifact UUID nullable không có invented generic evidence FK: accepted001–010 không có generic pre-route registry. T2/native producer phải verify identity/hash/current turn/scope và stop evidence; pointer không đủ giải phóng unknown turn/reservation. Test SQL seeds là relational precondition và UNVERIFIED receipt, không cert/admission production.
- PM capacity ruling: immutable NOT NULL `request_sha256`/`receipt_sha256`, lowercase hex64 của canonicalJson toàn DTO, loại hash tự thân và request receipt_id linkage. T4 requestCapacity/record-capacity producer tính ở insert, T5 consume; DTO wire không thêm fields, hash không cấp admission. Fixture tính exact canonical DTO; tests kiểm shape/non-null/immutability/latch.
- Policy default paid budget0; uncertain budget không reset/release theo TTL. Producer thiếu thông tin phải từ chối; authority/HTTP/driver/model execution thuộc T2–T7.

## Kiểm chứng cuối và backup/restore

- [complete-cover raw log](task-1-evidence/logs/task-1-complete-cover.log): 29/29 PASS, exit0, SHA `dcc17c3a3dc5f0be9bd7153fd61fb6f4a457669b8b29b40b0fd84d6d9d7accd4`. Đây là một lượt cover sau source cuối, không cộng dồn PASS từ các lượt trước.
- [complete-types raw log](task-1-evidence/logs/task-1-complete-types.log): frozen accepted archive+own overlays `tsc --noEmit` exit0, SHA `64701009df5162d8801c5450a1c44cad8d97c7a204d680cd70b2991963a23bfe`.
- [complete-biome raw log](task-1-evidence/logs/task-1-complete-biome.log): 5 files, no fixes, exit0, SHA `5fcdeaba39959b0d62f52e621fdd2406a07d36cbbd775c64540e5d3247401b5c`.
- Canonical Vietnamese draft có đúng7 H2: Mục đích, Điểm vào, Các bước, Files, Dữ liệu, Flow liên quan, Tests. R2 manifest/full staged R3 check thuộc controller integration; không tự đổi manifest.
- Thực hành pg_dump/pg_restore prefix010 **trước** migration011, rồi restore prefix011 có dữ liệu. Tất cả bảng đối chiếu canonical data SHA giống nhau và từng migration checksum giữ nguyên; restore DB đã close/drop. SQL011 checksum `9dc10ce01e2e2db4e83185f6ca0bd0b0e897ac5daebb2949c446d0480fb649c0`.

| Prefix | Dump SHA256 | Source = restored data SHA256 |
|---|---|---|
| 10 | `3319a446a2e73558e9d3bb566a8f14e037f51b3975e35daab73ebd4becea3293` | `04c7826154cb9c95cc66be37fff9fb9e73c1b9ee5c9f6dc581e944eb0d5ae7a6` |
| 11 | `e6f3f3e104fed598ba32e045dd925e3d063d1e6cbbb25ec59e3baa53dad51cf2` | `94acef56f3c4a9ca7e0a8f9324a26271c8e1a0f20ec41365f036d073369ba363` |

Toàn bộ DTO serializable đã có schema strict (function ports không cần schema). SourcePin/ProjectionPin reuse accepted exports; CreateTicket/SourceRef shape đúng types và route limits. Các field Record producer có recursive JSON schema; business semantics/depth/authority vẫn do producer. Tests dùng public @fastify/ajv-compiler thực, không HTTP server/route, không coercion/removeAdditional/default. Phủ mọi DTO, 10 tool variants, 11 result variants, driver events và proof unions; negative nested UUID/hash/enum/revision/byte overflow/extra fields/discriminator.

## RED/lỗi được giữ nguyên

| Sequence | Tests/PASS/FAIL | Kết quả | Raw log và SHA256 |
|---|---|---|---|
| initial-red | 1/0/1 | 42P01 thiếu assistant_work_inbox; trước implementation | [initial-red.log](task-1-evidence/initial-red.log) `c23e305f6fcf2a7314f4541da3c73ff4f570c31b239d9214deab359af7349de2` |
| first-cover-2 | 20/19/1 | TG_ARGV NULL làm no-arg immutable trigger bỏ qua guard; đã sửa coalesce | [logs/task-1-first-cover-2.log](task-1-evidence/logs/task-1-first-cover-2.log) `19623c7f7a420dd22af7ea94a44d973636b452b93e8702befa8aa11dedd95072` |
| r3-red | 1/0/1 | Thiếu guard derived expiry/allowOriginal; đã thêm | [logs/task-1-r3-red.log](task-1-evidence/logs/task-1-r3-red.log) `10fd53a7c00f08487c1df0e087f52596809b95e323ad5cc1fbc191ba7ecf9944` |
| constraint-cover | 26/24/2 | TICKET_NOT_READY ở fixture trước hook; sửa bằng actual dependencies_ready | [logs/task-1-constraint-cover.log](task-1-evidence/logs/task-1-constraint-cover.log) `7e3d481debdc9f7b90ab044b423a7195414808a5ad51877d1f963c0421f9e147` |
| r3-exact-red | 3/2/1 | Partial original thiếu sha/owner vượt JSONB subset; sửa exact element | [logs/task-1-r3-exact-red.log](task-1-evidence/logs/task-1-r3-exact-red.log) `8609cc09c1dd18cf945cc6100ff73a8f26484e4beb59555020966fe2119ff657` |
| capacity-hash-red | 1/0/1 | 42703 thiếu request_sha256; thêm exact PM hash representation | [logs/task-1-capacity-hash-red.log](task-1-evidence/logs/task-1-capacity-hash-red.log) `54476a21fff8fa633a9a5706f55e58e73759e2ba74c04c8549edc36e699ae8c8` |

`runtime-schema-red-2`: 2 tooling TypeError do gọi compileValidationSchema trên FastifyInstance (API thuộc request), không tính meaningful RED. Đã sửa helper execute public @fastify/ajv-compiler. `runtime-schema-red-3`: 2 actual validation FAIL (bigint overflow được nhận và thiếu assistantTurnSchema), trước khi thêm guard. [Raw log](task-1-evidence/logs/task-1-runtime-schema-red-3.log) SHA `8e53dd4a2e355c122f7105bc1f66b0b090a8225a7175963ac4e8a31d2a16808a`. `runtime-schema-green-1` 2/2 PASS là lượt riêng trước complete-cover29; không cộng dồn.

`first-cover` và `final-cover-1` và `runtime-schema-red` bị resource gate từ chối (CPU idle<50), không tạo PG/Node; final-cover-1 readonly scratch đã dọn. Biome authoring từng có format failure rồi sửa; không ghi static check là test PASS. [historical-red-report.md](task-1-evidence/historical-red-report.md) và [pre-freeze-history-report.md](task-1-evidence/pre-freeze-history-report.md) giữ handback cũ; các SHA/history trong đó không phải source hiện hành.

## Tài nguyên và cleanup

Mọi container/runner đều có own fresh gate pressure1/2, available estimate≥4GiB, CPU idle≥50%, disk≥8GiB. Một PG256MiB/CPU1/pids64, Node heap384, random loopback port khác5432/55432. Evidence ghi intended/actual PID/argv/container/port, scratch nonce/dev/inode/UID; close observed trước cleanup. Không đụng shared DB hoặc resource không thuộc fixture.

Final cover: Node15273 exit0; container `44df5ce11ad8844092ec47f70c0269a2e12a34ced490c11b2163909a963a926b` inspected exited/PID0/OOMfalse rồi removed; scratch `.task-1-assistant-complete-cover-n0gzw0qm` absent. Final types: PID19623 exit0, scratch `.task-1-assistant-complete-types-njwcmb4i` absent. Mỗi sequence có `*-child-closed.json`, `*-container-closed.json` khi có PG, `*-cleanup.json` và actual source manifest trong `*-evidence.json`; raw stdout nằm thư mục **logs/**. Tất cả sequence đã đóng; trả heavy slot PM.

## Gate còn lại

1. Runtime schema gate đã hoàn tất trong complete-cover29 và complete-types. [source-freeze-27-history.json](task-1-evidence/source-freeze-27-history.json) và [report-27-history.md](task-1-evidence/report-27-history.md) là milestone lịch sử trước bổ sung; không dùng làm source cuối.
2. Controller canonical docs copy + managed manifest mapping/staged R2/R3, serialized candidate exact prefix011 checksum; full independent SPEC và QUALITY review trước acceptance/commit.
3. T2–T7 trusted certificate/admission/artifact-stop/grant/telemetry/route/orchestration/driver producers và actual HTTP/executable-run acceptance chưa thuộc T1. Fixtures không chứng minh các gate này. Không live credentials/cert/model/paid calls.
