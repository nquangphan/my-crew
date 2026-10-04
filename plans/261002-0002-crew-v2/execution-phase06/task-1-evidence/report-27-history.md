# Phase06/T1 — Schema và durable Assistant inbox

Trạng thái: **source T1 đã kiểm chứng trong phạm vi; chờ PM chốt runtime-schema boundary và independent SPEC/QUALITY review, chưa nghiệm thu/integrate**. Lượt cuối `final-cover-2`: **27 tests / 27 PASS / 0 FAIL**, actual PostgreSQL18.6; frozen typecheck và Biome PASS. Không gọi live model, không tạo certificate/admission production. Không Git/index/commit/manifests/packages/shared service mutation.

## Phạm vi và source freeze

Baseline fixture luôn `0c838d21354bb40494a1280200ae281b2ff19e33`, archive readonly cộng đúng sáu source/test T1; loại parser/runtime/access chưa review. [source-freeze.json](task-1-evidence/source-freeze.json) ghi SHA/bytes và prefix001–010 đối chiếu bytes với accepted archive. Doc theo PM ruling ở canonical main-project path; worker không tạo managed `v2/docs/flows/server-assistant.md`. Controller sẽ copy/mapping sau review.

| Path | Bytes | SHA256 |
|---|---:|---|
| `v2/server/migrations/011_assistant.sql` | 38093 | `9dc10ce01e2e2db4e83185f6ca0bd0b0e897ac5daebb2949c446d0480fb649c0` |
| `v2/server/src/assistant/contracts.ts` | 18353 | `31061cb45d6be0cf2b8df93c13abe2297bb18c5f2c347201993e201985b5112c` |
| `v2/server/src/assistant/store.ts` | 4392 | `65034d2770a0f79d549d67d98aa779dc62dcc6b6ca54eab33cfa7ef91889564a` |
| `v2/server/src/assistant/inbox.ts` | 8791 | `3d177b0fe645657179985c22c7698206b1be51e922734a127f868255d11e1d4e` |
| `v2/server/test/assistant-store.test.ts` | 41450 | `d874d1a41028261bb0c7a7c08f9a0d9703f0d4a329991e2223f9ff144951209e` |
| `v2/server/test/support/assistant.ts` | 16877 | `f4cc7ab6998794e209db495662cf1936cb3af5a39a249e42c63d470149a7735c` |
| `/Users/phannhatquang/Documents/projects/crew/docs/v2/server-assistant-draft.md` | 6553 | `638b1feec8d4fc2b82fb9768493aa72ae98b83fee1965a8f830926b82ceb0cda` |

## Hành vi và ruling đã thực hiện

- Event cursor/work cùng transaction; ingest giữ cursor monotonic, đọc trang200, offline/no designation vẫn tích lũy. Reconcile scan actual009 message/ticket revision; non-null revision dedup trên target+revision kể cả claimed/acked, giữ source cursor/logical key gốc. Lifecycle wake revision null giữ cursor riêng. Comment fanout descendant, không tăng lại counter009.
- Claim/ACK kiểm exact persisted designation/process/generation/current state; uncertain giữ live-turn guard. Shared generation allocator chỉ persistence trong cùng admission transaction T2; không tự mint authority, không reset/overflow.
- Whole011 gồm R1 challenge/certification/capability receipts/calibration guard; R2 tool operations/sequence/immutable response, doc receipt; R3 parent→derived consent linkage; R4 prelaunch attempt hook/retirement/reservation. UUID/FK restricted, state/revision/hash constraints, immutable conversation/message linkage, stable hex64 effect+persisted ordinal. Không sửa001–010.
- Artifact UUID nullable không có invented generic evidence FK: accepted001–010 không có generic pre-route registry. T2/native producer phải verify identity/hash/current turn/scope và stop evidence; pointer không đủ giải phóng unknown turn/reservation. Test SQL seeds là relational precondition và UNVERIFIED receipt, không cert/admission production.
- PM capacity ruling: immutable NOT NULL `request_sha256`/`receipt_sha256`, lowercase hex64 của canonicalJson toàn DTO, loại hash tự thân và request receipt_id linkage. T4 requestCapacity/record-capacity producer tính ở insert, T5 consume; DTO wire không thêm fields, hash không cấp admission. Fixture tính exact canonical DTO; tests kiểm shape/non-null/immutability/latch.
- Policy default paid budget0; uncertain budget không reset/release theo TTL. Producer thiếu thông tin phải từ chối; authority/HTTP/driver/model execution thuộc T2–T7.

## Kiểm chứng cuối và backup/restore

- [final-cover-2 raw log](task-1-evidence/logs/task-1-final-cover-2.log): 27/27 PASS, exit0, SHA `156648c32d6e9915d18427a95d60259ba81861c6adcd51ca61f74b7759393cdd`. Đây là một lượt cover sau source cuối, không cộng dồn PASS từ các lượt trước.
- [final-types raw log](task-1-evidence/logs/task-1-final-types.log): frozen accepted archive+own overlays `tsc --noEmit` exit0, SHA `dd0893941bf1e767ed8576a765b31e2c6a7be15d201ddf18b79edb11eca04ecc`.
- [final-biome raw log](task-1-evidence/logs/task-1-final-biome.log): 5 files, no fixes, exit0, SHA `467db51b1c3d95ca71621c8976d68bca2f470b0406dbad2645abe429a7a4105a`.
- Canonical Vietnamese draft có đúng7 H2: Mục đích, Điểm vào, Các bước, Files, Dữ liệu, Flow liên quan, Tests. R2 manifest/full staged R3 check thuộc controller integration; không tự đổi manifest.
- Thực hành pg_dump/pg_restore prefix010 **trước** migration011, rồi restore prefix011 có dữ liệu. Tất cả bảng đối chiếu canonical data SHA giống nhau và từng migration checksum giữ nguyên; restore DB đã close/drop. SQL011 checksum `9dc10ce01e2e2db4e83185f6ca0bd0b0e897ac5daebb2949c446d0480fb649c0`.

| Prefix | Dump SHA256 | Source = restored data SHA256 |
|---|---|---|
| 10 | `268ea1c84a1875a9730495a3a1ac2e24064ce2a8ba53055ba15fbdc913399480` | `11287a4cd2e2838db348a5b41320805f08f6a6c01b5294bd9cf5a25bb4692a7b` |
| 11 | `5d7074663a5790993fc72aeeaea62eeba4a9740b8b90bda8df9d5864cd5acc68` | `aa54f0ce6d75ce2bc54784d65c7ca28698da6f5fbacab6068fa9a8a4e138d540` |

## RED/lỗi được giữ nguyên

| Sequence | Tests/PASS/FAIL | Kết quả | Raw log và SHA256 |
|---|---|---|---|
| initial-red | 1/0/1 | 42P01 thiếu assistant_work_inbox; trước implementation | [initial-red.log](task-1-evidence/initial-red.log) `c23e305f6fcf2a7314f4541da3c73ff4f570c31b239d9214deab359af7349de2` |
| first-cover-2 | 20/19/1 | TG_ARGV NULL làm no-arg immutable trigger bỏ qua guard; đã sửa coalesce | [logs/task-1-first-cover-2.log](task-1-evidence/logs/task-1-first-cover-2.log) `19623c7f7a420dd22af7ea94a44d973636b452b93e8702befa8aa11dedd95072` |
| r3-red | 1/0/1 | Thiếu guard derived expiry/allowOriginal; đã thêm | [logs/task-1-r3-red.log](task-1-evidence/logs/task-1-r3-red.log) `10fd53a7c00f08487c1df0e087f52596809b95e323ad5cc1fbc191ba7ecf9944` |
| constraint-cover | 26/24/2 | TICKET_NOT_READY ở fixture trước hook; sửa bằng actual dependencies_ready | [logs/task-1-constraint-cover.log](task-1-evidence/logs/task-1-constraint-cover.log) `7e3d481debdc9f7b90ab044b423a7195414808a5ad51877d1f963c0421f9e147` |
| r3-exact-red | 3/2/1 | Partial original thiếu sha/owner vượt JSONB subset; sửa exact element | [logs/task-1-r3-exact-red.log](task-1-evidence/logs/task-1-r3-exact-red.log) `8609cc09c1dd18cf945cc6100ff73a8f26484e4beb59555020966fe2119ff657` |
| capacity-hash-red | 1/0/1 | 42703 thiếu request_sha256; thêm exact PM hash representation | [logs/task-1-capacity-hash-red.log](task-1-evidence/logs/task-1-capacity-hash-red.log) `54476a21fff8fa633a9a5706f55e58e73759e2ba74c04c8549edc36e699ae8c8` |

`first-cover` và `final-cover-1` bị resource gate từ chối (CPU idle<50), không tạo PG/Node; final-cover-1 readonly scratch đã dọn. Biome authoring từng có format failure rồi sửa; không ghi static check là test PASS. [historical-red-report.md](task-1-evidence/historical-red-report.md) và [pre-freeze-history-report.md](task-1-evidence/pre-freeze-history-report.md) giữ handback cũ; các SHA/history trong đó không phải source hiện hành.

## Tài nguyên và cleanup

Mọi container/runner đều có own fresh gate pressure1/2, available estimate≥4GiB, CPU idle≥50%, disk≥8GiB. Một PG256MiB/CPU1/pids64, Node heap384, random loopback port khác5432/55432. Evidence ghi intended/actual PID/argv/container/port, scratch nonce/dev/inode/UID; close observed trước cleanup. Không đụng shared DB hoặc resource không thuộc fixture.

Final cover: Node75609 exit0; container `c471035605b74485015fa4a21a1b9963573072e35a60d6bd3b24718c56aa994a` inspected exited/PID0/OOMfalse rồi removed; scratch `.task-1-assistant-final-cover-2-byjuptcd` absent. Final types: PID76851 exit0, scratch `.task-1-assistant-final-types-r7qdgps6` absent. Mỗi sequence có `*-child-closed.json`, `*-container-closed.json` khi có PG, `*-cleanup.json` và actual source manifest trong `*-evidence.json`; raw stdout nằm thư mục **logs/**. Tất cả sequence đã đóng; trả heavy slot PM.

## Gate còn lại

1. PM chốt runtime JSON schema boundary: tất cả DTO/ports approved đã typed, schema strict hiện có cho fence/config/policy/selection/routing context+receipt/input pin/telemetry/capacity request/launch. Nested R2 tool request/result, assessment/workflow schemas chưa đầy đủ; CreateTicket/SourceRef producer chưa export reusable runtime schemas. Không giả validator producer hay fake HTTP route. Chưa claim mọi JSON boundary hoàn tất.
2. Controller canonical docs copy + managed manifest mapping/staged R2/R3, serialized candidate exact prefix011 checksum; full independent SPEC và QUALITY review trước acceptance/commit.
3. T2–T7 trusted certificate/admission/artifact-stop/grant/telemetry/route/orchestration/driver producers và actual HTTP/executable-run acceptance chưa thuộc T1. Fixtures không chứng minh các gate này. Không live credentials/cert/model/paid calls.
