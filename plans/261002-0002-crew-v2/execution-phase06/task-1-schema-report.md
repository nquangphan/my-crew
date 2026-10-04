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


## FIX1 — trạng thái mới nhất sau review T1-S1…S5

**35 tests / 35 PASS / 0 FAIL trong một lượt `fix1-complete-cover-2`; frozen typecheck và Biome PASS. Sẵn sàng review lại, chưa acceptance/commit.** Các SHA và 29-test milestone phía trên là lịch sử; source cuối FIX1 nằm trong [source-freeze-fix1.json](task-1-evidence/source-freeze-fix1.json). Báo cáo trước FIX1 giữ nguyên tại [report-before-fix1.md](task-1-evidence/report-before-fix1.md). Review đã đọc đầy đủ, SHA `2368a0b22ab163e2bb2c3d9bf2ed28be97bbb7cde33f0a522ea7c65927bc9d40`; dùng receiving-code-review để verify trước khi sửa.

- **S1:** PM ruling: global monitor enqueue/reconcile chỉ khám phá wake. Claim/ACK kiểm message/conversation exact hoặc explicit scope còn hạn của turn đúng root/project trước replay; descendants trong cùng root. Message turn cần actual unrevoked route vào root/project; message-null monitor turn được bind explicit root scope. Scope INSERT cũng đối chiếu turn. Giữ ticket root trước authority; message path không thêm root lock.
- **S2:** Deferred relational check gắn model selection với exact policy/capability model key và designation machine; giữ circular insert transaction và fixture UNVERIFIED, không cấp PASS.
- **S3:** Assessment snapshot đúng ticket; command, step, assessment, decision cùng ticket và workflow run đúng root. Không sửa005 hoặc thêm driver/approval semantics.
- **S4:** Receipt exact request ticket/kind/boot/ownership; reservation exact command machine/ticket và receipt ownership. Theo PM, JSON array equality giữ thứ tự DTO; futureT4 mới normalize trước tạo request nếu cần, không tự sort hoặc đổi API/hash producer.
- **S5:** Deferred release guard cả INSERT/UPDATE kiểm exact durable proof. Không bắt mọi INSERT phải reserved: valid terminal released row có proof insert được và đã dump/restore thật. Unknown/artifact UUID không được coi là stop proof.

| Source hiện hành | Bytes | SHA256 |
|---|---:|---|
| `v2/server/migrations/011_assistant.sql` | 42674 | `fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841` |
| `v2/server/src/assistant/contracts.ts` | 33718 | `adee25f453fa91e7498a1a300d3c7a4761147b8584e738a54818d9cb4b65412f` |
| `v2/server/src/assistant/store.ts` | 4392 | `65034d2770a0f79d549d67d98aa779dc62dcc6b6ca54eab33cfa7ef91889564a` |
| `v2/server/src/assistant/inbox.ts` | 10153 | `c6706c71261eaba23a8b3987523ded7b5af4bdc50b88042c1014fc0bf04b498f` |
| `v2/server/test/assistant-store.test.ts` | 59752 | `5baf11e09187eee83f2e4e6ac7323b9f71d39526bf1f0183c83e2c2e6a407008` |
| `v2/server/test/support/assistant.ts` | 30622 | `aa487cbf256211029c5d5570afec9072c2f41ec962dd42a402d38f45329e2014` |
| `v2/docs/flows/server-assistant.md` | 9265 | `e3495fa0e2392d920a47827a8c2b192a223501fae9ff3398038f749baf872500` |

| Sequence | Tests/PASS/FAIL | Diễn giải | Raw log và SHA |
|---|---|---|---|
| fix1-red | 5/0/5 | Actual missing rejection S1–S5 trước sửa production | [fix1-red](task-1-evidence/logs/task-1-fix1-red.log) `6e93017aaa7aeb8430ac7858050f1ec96e6a150c10f180f1bddf8316f6b03da4` |
| fix1-cover | 35/33/2 | Assertion S1 dùng regex message thay vì ApiError.code; sửa test | [fix1-cover](task-1-evidence/logs/task-1-fix1-cover.log) `ee1bb62186b9bcbd8df99acd315ef27f5fd7b8fb9421d8daf16bc5aa5ab53495` |
| fix1-final-cover | 35/34/1 | Fixture S1 snapshot ngoài Tx scope bị unique009 khi thử lại; sửa helper nguyên tử | [fix1-final-cover](task-1-evidence/logs/task-1-fix1-final-cover.log) `5e3865eb667711e8c616fa69dd8c48d12afc15d45186be9f322fc5d694dfb0ef` |
| fix1-s1-check | 2/2/0 | Focused S1 sau sửa fixture | [fix1-s1-check](task-1-evidence/logs/task-1-fix1-s1-check.log) `11d4d5ce645712ed2fe0b08dc37b36b3fe4ab75c1cc6af6349cb6cd5dc4d6dab` |
| fix1-complete-cover-2 | 35/35/0 | Cover cuối cùng trên cùng source, không union PASS | [fix1-complete-cover-2](task-1-evidence/logs/task-1-fix1-complete-cover-2.log) `ad2bc6747344529cc8f6ca406879fee11f805c772524d7d4741e9e012afdc7ce` |

[fix1-types](task-1-evidence/logs/task-1-fix1-types.log) exit0 SHA `c9fa85e4aa6397b7fb2b2f6a8e3bd0cc9efdc93485f211cfc5ad154acc411465`; [fix1-biome](task-1-evidence/logs/task-1-fix1-biome.log) 5files/no fixes exit0 SHA `46bfe88c959dd8272ecffcca47a153403ab304b5ef546d96476b1cf321516364`. Tất cả 7 source/doc hashes khớp frozen cover/type fixture; managed flow đúng7 H2. Migrations001–010 đối chiếu nguyên bytes accepted0c. SQL011 checksum mới `fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841`; candidate vẫn cần full independent review trước chốt.

| Restore rehearsal cuối | Dump SHA256 | Source = restored data SHA256 |
|---|---|---|
| 010 trước upgrade | `2cb4b2f29368aa4766503b3177efd53cabae3f6791b0d160a322a01ba86f7d7f` | `9589f4f33f2c2ac3da12efd90bea684d0b7635b276819fcee97b7776a71e7a5d` |
| 011 inbox/data | `d8cc158c83a88527a6d828d8c136fd64b76dc0ba062809ecc1632eeaed8c84c8` | `b21ba736c233922f9dc10e4ce2178f0cf1c625946db2b9cb7d1fe7b9367da393` |
| 011 terminal released có proof | `6a35574f54dbcfdf8a986bda6d598d0742417a1899cd8260369702bb341cbf01` | `97eb9be60f22d1d41188a89023c367e8cece429cd024f059c1cf1d6011ef519f` |

Tài nguyên FIX1: quota fresh từ23→25% used (77→75% remaining), gate >25% remaining; snapshot có tuổi≤120s được kiểm lại trước root/container/runner và ghi từng receipt. Resource hardgate pressure1/2, available≥4GiB, idle≥50%, disk≥8GiB trước mỗi creation. `fix1-complete-cover` bị deny từ đầu (available3.86GiB/idle15.59%), không tạo resource. Lượt cuối before-runner pressure2/available4715102208B/idle82.95%/disk31536848896B; một PG256MiB CPU1 pids64 loopback55624, Node heap384. Node97892 exit0; PGa20c6372cb7b271359176f95a22a156a8361e7ca8e75f607bb2e60ab9d53bbf7 inspected exited/PID0/OOMfalse rồi removed; scratch `.task-1-assistant-fix1-complete-cover-2-dy90hyya` absent. Types PID99642 exit0, scratch `.task-1-assistant-fix1-types-sm6qcw4u` absent. RED/failed/focused sequences cũng có observed close/cleanup receipts; không giữ process/container, heavy slot đã trả PM.

Gate tiếp: PM full SPEC/QUALITY review FIX1, controller serialized candidate/source mapping/commit. T2–T7 authority, live certificate/telemetry/hash producer, HTTP/model/driver và executable-run vẫn deferred. Không có producer mới, child agent, Git/index, migration001–010, manifest/package/shared-service mutation trong FIX1.


## FIX2 — mới nhất: T1-F1-N1, scope hết hạn trong transaction dài

**10 tests / 10 PASS / 0 FAIL trong một lượt affected cover; frozen typecheck và Biome PASS. Chờ independent review/acceptance của PM.** Review FIX1 được đọc và đối chiếu đầy đủ, SHA `a265c7ca01c24d424c60348a81cb3b3e61127c727b91656ad667becbe2461b24`. S1–S5 đã đóng theo review; FIX2 chỉ xử lý N1. [Báo cáo trước FIX2](task-1-evidence/report-before-fix2.md) giữ nguyên lịch sử.

Production chỉ đổi một predicate trong `assertWorkScope`: `s.expires_at>now()` thành `s.expires_at>clock_timestamp()`, tại check sau root/authority lock và trước claim/ACK replay. PostgreSQL `now()` giữ mốc bắt đầu transaction, nên có thể nhận scope đã hết hạn ở thời điểm thực tế. SQL011, contracts, store và helper nguyên bytes FIX1; migrations001–010 nguyên accepted baseline. Không bổ sung producer, route hay authority.

Bốn regression dùng PostgreSQL thật trong transaction bắt đầu trước hạn: pending→claim, claimed→claim replay, claimed→ACK, acked→ACK replay. `pg_sleep_until(expires_at)` chờ đúng deadline trong DB; witness ghi đồng thời transaction start, expires_at và clock_timestamp, assert start<hạn và wall clock≥hạn. Sau rejection `ASSISTANT_WORK_SCOPE_MISMATCH`, deepEqual toàn bộ work row xác nhận state/attempts/claimed/acked receipt giữ nguyên. Không dùng thời gian ngủ phỏng đoán hoặc mock clock.

| Sequence | Tests/PASS/FAIL | Bằng chứng | Raw log SHA256 |
|---|---|---|---|
| fix2-red-2 | 4/0/4 | Bốn Missing expected rejection trước predicate fix; Node exit1 | [raw](task-1-evidence/logs/task-1-fix2-red-2.log) `d730daf091c9541bf9b9a07cd6638a5a5f8dc28a27fc9519ef55d9a60cd55ef3` |
| fix2-affected-cover | 10/10/0 | 4 expiry + 2 S1 scope + 4 fence/uncertain; Node exit0 | [raw](task-1-evidence/logs/task-1-fix2-affected-cover.log) `6c9c652164045599832d3dbc01fb6861ff05a310facf4b74191b6725e566ea92` |

[Types](task-1-evidence/logs/task-1-fix2-types.log) exit0 SHA `b884d8ddeaaaefedaa43528db434c070974b3d50e72d2593e8e79f3fb3c78569`; [Biome](task-1-evidence/logs/task-1-fix2-biome.log) 5 files/no fixes exit0 SHA `3864fb5d4a5ceaf85a38661f67b6be07139de072d5bbfd0dd7871b249c844bc5`. Lượt `fix2-red` đầu bị resource gate deny CPU idle49.24% trước tạo root/PG/Node; receipt giữ riêng, không tính test. Không chạy lại full35 hoặc backup/restore vì SQL và S2–S5 không đổi; bằng chứng FIX1 ở trên là lịch sử riêng, không cộng dồn thành PASS của FIX2.

| Source FIX2 | Bytes | SHA256 |
|---|---:|---|
| `v2/server/migrations/011_assistant.sql` | 42674 | `fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841` |
| `v2/server/src/assistant/contracts.ts` | 33718 | `adee25f453fa91e7498a1a300d3c7a4761147b8584e738a54818d9cb4b65412f` |
| `v2/server/src/assistant/store.ts` | 4392 | `65034d2770a0f79d549d67d98aa779dc62dcc6b6ca54eab33cfa7ef91889564a` |
| `v2/server/src/assistant/inbox.ts` | 10165 | `133f47e8dbb08a4c07d8a6dd371203205e3c7dc7de7991d9f1399a71c7c4bdc0` |
| `v2/server/test/assistant-store.test.ts` | 62967 | `a18ae475b36f65dc95cacf122518b7971f91f35fdc9d187f60c3f6028029b365` |
| `v2/server/test/support/assistant.ts` | 30622 | `aa487cbf256211029c5d5570afec9072c2f41ec962dd42a402d38f45329e2014` |
| `v2/docs/flows/server-assistant.md` | 9936 | `9293cf74eb0b9a000ba8761cb6622b2b138e21e2dcb1785ed049f6bee9478c9a` |

[source-freeze-fix2.json](task-1-evidence/source-freeze-fix2.json) SHA `f25ccbd54379594988b91e8b9c406c2dda417ef7a212921a775e1a7581943ef2` chứa 7 source hashes khớp cả affected-cover và types fixture, bốn witness RED/bốn witness GREEN, receipt pointers và immutable prefix hashes. Flow đúng7 H2. Mỗi fixture dùng accepted `0c838d21354bb40494a1280200ae281b2ff19e33` + own overlays; không nhập peer runtime/parser/access chưa accepted.

Tài nguyên: fresh gates trước mỗi root/PG/runner, quota71–73% remaining, pressure2; affected-cover trước runner available4931567616B/CPU63.83% idle/disk31285080064B. Một PG256MiB CPU1 pids64, Node heap384, random loopback60323. RED Node24152 exit1; GREEN Node26198 exit0; types Node33055 exit0; Biome PID35981 exit0, wait observed. RED PG `2584482ceb854e02a610267713357dc3a35122b2e22ca15cebd726122a3a8cdd` và GREEN PG `d5f9401956a2d799f3307c026f7de19219e90f61548b49878ef4b87a5299e7f8` đều observed exited/PID0/OOMfalse trước remove. Recheck read-only cả hai IDs absent; ba scratch roots RED/GREEN/types absent; inner attachment fixture roots có create/remove receipts trong rawlog. Heavy slot đã trả PM.

Gate còn lại: independent scoped FIX2 review và controller serialize candidate/acceptance. T2–T7 trusted producers, HTTP/model/driver/executable-run vẫn deferred; không sửa Git/index, dependencies, manifest hoặc shared services.
