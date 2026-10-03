# T2 Slice B1 — review package

**Hiện tại: B1 FIX1 READY FOR SCOPED RE-REVIEW.** Hai findings Important đã có targeted RED8 (1 pass/7 fail), sau sửa final GREEN63/63 (47 B1 +16 existing), scoped strict/Biome exit0. Source freeze FIX1 cuối ở mục cuối; Node/PG đã đóng và heavy slot đã trả PM. Đây không phải nghiệm thu full T2 hoặc production admission. Các mục phía trước FIX1 giữ lịch sử baseline và lượt kiểm riêng.

Baseline tích hợp: `a96c932` do PM xác nhận; Slice A và SQL001–011 giữ nguyên. B1 được PM release đúng ba paths sau full-read preflight `89096d3082c30504e84c4fa27dd3329c04874b19c8cba49589d227337e50006b`. Trạng thái hiện tại: **chỉ author regression + scaffold; chưa chạy RED, chưa implementation hoặc PASS**. Web đang giữ sole heavy slot; worker chưa tạo Node/PostgreSQL/scratch.

## Thay đổi trong phạm vi

- `v2/server/src/tickets/contracts.ts`: thêm optional `assistant?: ProjectOrchestrationAuthority`; frozen interface/DTO ở assistant/contracts không đổi.
- `v2/server/src/tickets/service.ts`: minimal loadable `assistantCreateTicket(tx, actor, proof, input)` gọi nguyên generic `createTicket(tx,input,actor)`. Chưa verify, snapshot, prefix lock, private token hoặc ACL exception. Baseline phải thất bại hành vi A→B với404; không tính lỗi import/compiler/setup là RED.
- `v2/server/test/assistant-orchestration.test.ts`: **39 cases** khi expand các vòng lặp; actual prefix11 DB, provisionMachine, bindProject, ticketFixture, mutate và owner approval producer. Trust port có allowlist riêng theo Tx/actor/proof/action/hash/root/project/binding, không phải production admission/certifier/receipt.

## Matrix dự kiến

| Cases | Nội dung |
|---|---|
| 4 | Scoped A→B success giữ audit/journal actorA và raw hash; generic A→B vẫn404 dù forged JSON capability; missing port503 kể cả bound machine; owner không vào machine-only entry403 |
| 8 | Exact actor/operation/fence/hash/action/root/project/Tx mismatch bị test trust port từ chối |
| 2 | Proof ở Tx mới phải verify lại; factory capture method và absent dependency không bị đổi sau construction |
| 4 | Input/actor/proof đổi trong deferred verify vẫn dùng snapshot; đổi cả ba ngay sau call return chứng minh snapshot trước first await |
| 1 | Peer DB connection `FOR UPDATE NOWAIT` báo55P03 trên root/parent/project ngay trong authority hook; không sleep ordering |
| 2 | Request hash trước business defaults; optional omitted khác null; pin kế thừa nhưng hash giữ submitted pin |
| 6 | Wrong parent project/level, missing parent, closed root/parent, pin mismatch |
| 10 | Missing/bad workflow pin, title, level/kind, nonfinite/cycle/accessor/prototype/undefined JSON; no ticket writes |
| 2 | Deploy root/unapproved child không nhận owner intent; exact persisted approval và changed title/body denial |

Named errors dự kiến: `ORCHESTRATION_UNAVAILABLE`503 và `ORCHESTRATION_MACHINE_REQUIRED`403. `TEST_TRUST_DENIED`403 chỉ tồn tại trong test port. Deferred tests race entry handshake với operation settlement và finally release/await; scaffold không gọi verify sẽ fail assertion ngay, không chờ vô hạn.

## RED recipe chờ scheduler

Chỉ sau explicit grant: fresh `sysctl kern.memorystatus_vm_pressure_level`, `vm_stat`, `top -l 1 -n 0`, `df -k .` trước container create và trước Node; calculate available=(free+inactive+speculative)×pageSize. Gate pressure1/2, available≥4GiB, idle≥50%, disk≥8GiB; quota cần trên25% remaining. Ghi raw telemetry/intent trước create.

Own container `crew-v2-test-<fresh uuid>`, local image PostgreSQL18.6 (inspect image trước; không pull/network), `--memory=256m --cpus=1 --pids-limit=64`, `-p 127.0.0.1::5432`, trust auth và DB `crew_v2_test`. Inspect actual64hex ID/resources/port; reject5432/55432. Poll pg_isready giới hạn, không tính setup failure làm RED. Command thực thi duy nhất cho RED:

```sh
NODE_OPTIONS=--max-old-space-size=384 \
CREW_V2_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:<actual-random-port>/crew_v2_test \
CREW_V2_TEST_CONTAINER_ID=<actual-64hex-id> \
node --test --test-concurrency=1 v2/server/test/assistant-orchestration.test.ts
```

Ghi raw stdout/stderr/exit và39 outcomes riêng; không cộng lượt khác thành suite. RED phải quan sát lỗi semantic phù hợp; sau RED đóng exact own PG/process/scratch, giữ raw docker/ps/absence witness rồi trả heavy slot **trước** implementation Node-free. Không broader test/typecheck/Biome trước RED nếu chưa PM grant. GREEN sau implementation sẽ cần grant mới; giữ giới hạn full-server typecheck từ Slice A, không cài/sửa deps.

## Source scaffold freeze trước RED

| Path | SHA256 |
|---|---|
| tickets/contracts.ts | `c09baf6dd6c866747a491f2846a3338b0a9ba38aa10719af933119dbc8128f03` |
| tickets/service.ts | `58e3811e833ee2d74bffb95375c7448c4270c289a87418d4983df06eb5c01c95` |
| test/assistant-orchestration.test.ts | `52c241e4d8b76e869cddfb785764e11ee1d9a79e4694057c5fd3669389a83ad7` |

B2–B5/G1 extension, input/text/native admission, routing decision linkage và production positive resolver đều pending. Không source ngoài ba paths, Git/index/SQL/package/app/manifest/HTTP route. Docs draft chỉ nằm trong plans, chưa tích hợp flow.

## Actual RED và implementation chờ GREEN

PM cấp RED lúc21:08:45 VN. Chạy đúng baseline hashes nêu trên, không sửa test diagnostic: **39 tests, 12 pass, 27 fail, skip0, exit1, 7074.357833ms**. A→B creation bị generic404; missing authority/owner entry fail vì scaffold còn cho generic success; deferred verify assertions thấy operation settled trước entry. Không setup/compiler/import failure. Case missing-parent pass ở baseline chỉ chứng minh404 outcome (generic scope đã chặn trước lookup), không được diễn giải thành kiểm chứng branch hierarchy. Không có positive test-only authority success trước implementation.

Container `crew-v2-test-388891ec-e008-4d30-a945-6d5ca195f574`, ID `dcec6d0439544a28d17fada5ef6bd38e65491cc253c9dfe901b6c7cdba82726b`, local postgres18.6 image `sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`, loopback51301, actual memory268435456/nanoCPUs1000000000/pids64. Fresh gates: create5.28682GiB/pressure1/idle84.35%/disk26.3747GiB; run5.09741GiB/pressure1/idle88.17%/disk26.2823GiB. Node PID44036 heap384/concurrency1 exited. Cleanup14:11:42UTC: logical fixture DB query zero rows; exact docker stop done, docker ps -a filtered container absent, ps exact PID/pattern absent; no host scratch created. Sole heavy returned to PM before source implementation.

| Raw evidence | SHA256 |
|---|---|
| task-2-slice-b1-red.log | `e4d2b623a4557ed8e944d1114877baa94463f755ab0a63b7b3aee72700fd047f` |
| task-2-slice-b1-red-resource.log | `896ae5da9849f2ea2bf69a284bf3997ab1a0c85dd4cef9f8e9657545ef6ea0eb` |
| task-2-slice-b1-red-cleanup.log | `88099fc08a53bc0a2b016203819b4a82025fb54af6fc7c648a5b1485457197c0` |

Node-free implementation sau RED: tách shared validation/prepare/insert core; generic wrapper giữ requireProjectScope trước hierarchy và không nhận bypass parameter. Scoped entry snapshot/freeze input+actor+proof trước await, capture verify method khi factory tạo, machine-only/default503, prefix root→parent→project trước verify. Hash tuple exact submitted input; private WeakMap identity được mint sau verify, bound Tx/actor/input/proof/action/hash/project/discovered root và consumed trước insert. Core reuse prepared invariants, không thêm guard/input locks sau verify. SQL INSERT và actor audit dùng cùng snapshots; deploy checks luôn dùng actorA. Chưa nối production positive authority.

Pre-GREEN source hashes: contracts `c09baf6dd6c866747a491f2846a3338b0a9ba38aa10719af933119dbc8128f03`; service `16a5e8e5a7524949305b99488ccb262e904b4f126ecb06342b1eb78e4124bcb7`; tests `52c241e4d8b76e869cddfb785764e11ee1d9a79e4694057c5fd3669389a83ad7`. Đây là static self-review, chưa typecheck/Biome/GREEN. Đề nghị GREEN grant cho affected39 + existing tickets/deploy/dependencies (shared create regression), scoped strict external skipLibCheck và scoped Biome đúng ba files. Full-server typecheck vẫn không được gọi PASS từ scoped result.

## Final GREEN, self-review và handoff

PM cấp sole heavy GREEN21:16:44VN, weekly55% used/45% remaining. Biome check --write đúng3 files exit0 (`Checked 3 files in 28ms. Fixed 2 files.`), trước final test run. Không behavioral sửa đổi sau RED implementation; test chỉ format. Một actual affected run **55/55 PASS, fail0/skip0/cancelled0, exit0, 9797.940292ms**:39 B1 +6 dependencies +4 deploy +6 tickets. Không cộng với RED hoặc suite trước.

```sh
NODE_OPTIONS=--max-old-space-size=384 \
CREW_V2_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54532/crew_v2_test \
CREW_V2_TEST_CONTAINER_ID=292f5b8763bce90608ec65cf18e178fd185dc8c5869042a95161ad0d7b41c1fe \
node --test --test-concurrency=1 \
  v2/server/test/assistant-orchestration.test.ts v2/server/test/tickets.test.ts \
  v2/server/test/deploy.test.ts v2/server/test/dependencies.test.ts

NODE_OPTIONS=--max-old-space-size=384 pnpm --dir v2/server exec tsc \
  --noEmit --ignoreConfig --skipLibCheck --target ESNext --module NodeNext \
  --strict --allowImportingTsExtensions --erasableSyntaxOnly --verbatimModuleSyntax \
  --types node src/tickets/contracts.ts src/tickets/service.ts test/assistant-orchestration.test.ts
```

Scoped tsc exit0/raw stdout rỗng; own files và dependency closure strict, skipLibCheck chỉ external declarations theo PM ruling. Không chạy full-server hoặc install deps. Giới hạn full-server typecheck trước đây (extractor dependencies và external thread-stream declaration) vẫn được ghi tại Slice A report, không gọi full-server PASS.

Fresh gate mỗi launch (Biome/create/test/tsc) pressure1, available min5.29387GiB, idle min79.2%, disk min26.2067GiB. Own container `crew-v2-test-10fe7a3c-ffb9-480f-8d65-b14d1db4bdf4`, ID `292f5b8763bce90608ec65cf18e178fd185dc8c5869042a95161ad0d7b41c1fe`, postgres18.6, loopback54532, memory268435456/nanoCPUs1000000000/pids64. Node PID61385 và tsc wrapper63665 đã exit. Cleanup14:19:31UTC: DB-prefix query0rows; exact docker stop xong, docker ps -a filtered không còn container; psPID61385/63665 và scoped Node/tsc/Biome pattern không còn process. Không host scratch. Đã gửi trả sole heavy ngay sau cleanup, trước report.

| Final evidence | SHA256 |
|---|---|
| task-2-slice-b1-green.log | `6127dc907d280fbd4ddbe50de21f98b952600972ebda2f1cb5b35998f47a8cb7` |
| task-2-slice-b1-green-resource.log | `507e2e00b64f52860a9c166ed4c32edf9e1f7d1aab2369b3bb03b32e69a541a9` |
| task-2-slice-b1-green-cleanup.log | `ed9796edd6af7cf18d2d31801720a19948386a499218686d34e83553de0fb9e5` |
| task-2-slice-b1-typecheck.log | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| task-2-slice-b1-biome.log | `fa429748873e25b4a775463be9f5c7605db8f086ef98b97912f7ab247672fbe6` |

**Final frozen source:**

| Exact path | SHA256 |
|---|---|
| v2/server/src/tickets/contracts.ts | `c09baf6dd6c866747a491f2846a3338b0a9ba38aa10719af933119dbc8128f03` |
| v2/server/src/tickets/service.ts | `5b86e667024048818f38ab173f8a47b4d4bc6ff2b63d31a9043763a766dc1911` |
| v2/server/test/assistant-orchestration.test.ts | `407ef38ad38b673efb0042c7ea2092cfa384a4fa8b5034523ae7e3658fc8ebff` |

Self-review: same public generic signature/ACL; single shared validation, hierarchy/pin/deploy and INSERT; no synthetic owner, copied producer SQL or exported capability constructor. Prefix locks execute before captured verify; grant/fence/input producers chưa được nối, core không acquire late guard/input. Hash uses exact submitted complete payload before defaults; freeze prevents caller mutation both immediately after call and during deferred verify. Token's runtime identity/Tx/input/actor/action/hash/project/root checks cannot be supplied via extra JSON. Test-only authority allowlist is tied to actual machine/project/tree fixtures; native/model receipts không được mint. Scoped A→B metadata creation vẫn lưu actorA và raw journal hash; existing generic/deploy/tree concurrency regressions pass.

Static hashes Slice A authority/routes/test và frozen assistant/contracts đối chiếu lại khớp baseline. Không sửa SQL001–011, app, routes, ACL module, frozen DTO, manifests hoặc producer khác; no Git/index/children/network/dependencies. Independent reviewer cần đọc cả full B1 source/tests, exact preflight/rulings và raw evidence; docs draft chỉ được PM tích hợp sau review. **B2–B5/full T2, G2/native admission, current input/text/routing decision linkage và production positive resolver vẫn pending/default-deny.**

## FIX1/5 — B1-F1/B1-F2 regression readiness

Independent report `task-2-slice-b1-review.md` SHA`0a2c3a740a6b1a9ddb197c95429b2b9fc092b8fe52eef99355e8e4e79edd6518` yêu cầu sửa hai Important findings. F1: parent project UUID so sánh spelling thay identity. F2: array branch của imported canonicalizer thực thi getter/iterator hoặc bỏ qua prototype trước validation, có thể sửa actor/proof trước snapshot. Đã đọc full review và đúng canonical helper; không sửa global helper/frozen DTO/SQL.

Author8 regression trong owned test, production service giữ reviewed SHA`5b86e667024048818f38ab173f8a47b4d4bc6ff2b63d31a9043763a766dc1911` và contracts giữ nguyên. Test pre-RED SHA`98b18605bca0d2782d05f36d3eb039854f45454ea76f6d160136c2e2f74a716c`: uppercase step+task exact hash success, lower-hash replay deny cho cả hai, index getter/custom iterator/custom prototype deny trước verify và không user-code/identity mutation/write, ordinary nested JSON arrays control. Allowlist fixture tách canonical DB project identity khỏi exact submitted input. Hostile array tests gọi service qua mutation body{} và reject-only authority observer, nên journal/test helper không serialize dữ liệu độc hại trước boundary.

Targeted RED chờ grant: `node --test --test-concurrency=1 --test-name-pattern='B1 FIX1' v2/server/test/assistant-orchestration.test.ts`, heap384/private PG256MiB CPU1 pids64/randomloopback/fresh4/50/8 gates như trước.8 selected cases;39 existing không chọn, không gộp counts. Chưa chạy Node/PG/types/Biome hay sửa implementation FIX1.

### FIX1 actual RED và narrow source fix

PM grant21:37:09VN; actual selected **8 tests,1 pass/7 fail,skip0,exit1,1775.430458ms**,39 existing unselected và không hiện trong runner summary. F1 actual `TICKET_HIERARCHY`409 cho uppercase step/task và lower-hash denial assertion. F2 getter/iterator mỗi loại executions1, verifications1, actor.id và proof.operationId bị đổi; custom prototype cũng reach verify. Ordinary nested arrays control pass. Đây là semantic RED trên reviewed service `5b86e667…`, không lỗi setup/import/compiler và không test diagnostic sửa giữa run.

PG `crew-v2-test-ac0a24ae-6c0e-44af-9bca-39a36de2faf7`, ID`7b5240e5a8d2e69fa6217e956a06d4a0ad41a6ce232db0b04cdc2305ae7f2761`, loopback54120, actual256MiB/CPU1/pids64. Create gate6.15994GiB/pressure1/idle65.42%/disk24.7544GiB; Node gate6.2146GiB/pressure1/idle78.43%/disk24.6947GiB. Node17482 exited. Cleanup14:38:53UTC DBprefix0rows; exact stop/docker absent/ps absent; no scratch. Trả slot trước feature edits.

| FIX1 RED evidence | SHA256 |
|---|---|
| task-2-slice-b1-fix1-red.log | `ba8d935bb118ba40e934ff78b77db5db2568314cd4c939854bdba78acf6925a9` |
| task-2-slice-b1-fix1-red-resource.log | `9b829d7a646c03f732e512eb41db833413142731cba9f42a47bae3576db41ffc` |
| task-2-slice-b1-fix1-red-cleanup.log | `8137d2db1748de65a2a9c22dbe8e32aa2e457cc23a47cc6f667335ebf21a2835` |

Narrow fix sau actual RED, Node-free: shared parent/project identity compare dùng lowercase UUID mà không rewrite captured input/hash/journal. B1-only assertSnapshotData kiểm nguyên source bằng data descriptors, exact object/array prototypes và symbols; array chỉ có dense indexed data +length, không gọi iterator/index getter. Cycles/nonJSON/proxies từ chối trước source serialization; proxy rejection tránh reflection trap. Existing safeTicketJson/global canonicalizer không đổi. Hash/snapshot vẫn dùng canonical exact submitted JSON sau guard. Pre-GREEN service SHA`19b30da7cfc0bebfb33181827dc2554d6336925a7a9a9cbde54aa041c847784d`; global canonical SHA`dbb85d4a8a70035bb5934bb42a1a1f3cb21f4ad36fefc7f35e18febda5b9af79` chỉ đọc. Contracts giữ nguyên; test SHA98b18605… giữ nguyên từ RED. GREEN47 B1 +16 existing relevant và scoped strict/Biome cần grant riêng.

### FIX1 final GREEN và frozen delta cho scoped re-review

Grant PM21:44:44VN, quota60%used/40%remaining. Format own3 trước test: Biome exit0, `Checked 3 files in 31ms. Fixed 2 files.` Một final actual run **63/63 PASS, fail0/cancelled0/skip0, exit0,10572.280667ms** (47 B1 gồm8 FIX1 +16 existing shared-create regressions). Không sửa behavior/test expectation sau targeted RED; chỉ source fix đã mô tả và Biome formatting. Không cộng với RED8 hoặc initial GREEN55.

Command giữ4 files của final GREEN trước, thêm `--test-timeout=60000`; env actual `CREW_V2_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:57698/crew_v2_test`, `CREW_V2_TEST_CONTAINER_ID=a1635648be388a255d41bfcf9ddf8c697a919a2c01c89628e09f004055931fd1`, `NODE_OPTIONS=--max-old-space-size=384`, concurrency1. Scoped strict command/own3/import closure và external skipLibCheck giống lượt trước: exit0, raw empty. Không install/peer/global/full-server check; full-server limitations giữ nguyên.

Fresh gate từng Biome/create/test/tsc: pressure1, available min5.63383GiB, idle min70.91%, disk min24.5641GiB. Own PG18.6 `crew-v2-test-835dd428-7d74-46b2-bb34-40b3b2ab55d3`, actual ID`a1635648be388a255d41bfcf9ddf8c697a919a2c01c89628e09f004055931fd1`, loopback57698, memory268435456/CPU1000000000nano/pids64. Node43516 và tsc wrapper46714 exit. Cleanup14:47:25UTC logicalDB0rows, exact stop và docker/ps absence raw; no scratch. Trả sole-heavy trước report.

| FIX1 final evidence | SHA256 |
|---|---|
| task-2-slice-b1-fix1-green.log | `25597ed3561811ff2a6488651161cd9b775b727609bf0fc3f3a6b29c451e1fe5` |
| task-2-slice-b1-fix1-green-resource.log | `48d482b9b35cb3fbd3431d294f172e8f81dbaab2c34166739f1c9dda8073ed9d` |
| task-2-slice-b1-fix1-green-cleanup.log | `845c12b8e29d6f16ff4587c3778e926c3f18ca81465a9bfc00d5f0d510726387` |
| task-2-slice-b1-fix1-typecheck.log | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| task-2-slice-b1-fix1-biome.log | `81557f6e036b55aa02d630b9601eafb58c9ebaa8067a0c41088d0175129cf383` |

| Final FIX1 exact source freeze | SHA256 |
|---|---|
| v2/server/src/tickets/contracts.ts | `c09baf6dd6c866747a491f2846a3338b0a9ba38aa10719af933119dbc8128f03` |
| v2/server/src/tickets/service.ts | `bd35870151d52fc568ce6d4c4d6fa783b3f2c89b8c2f019ec4ef0b3e7b1d5189` |
| v2/server/test/assistant-orchestration.test.ts | `ddb24cbcc968b134294502f832c25b8247bb8611416d99b70fc4d2d6daca7e76` |

Self-review FIX1: UUID comparison chỉ canonicalize identity operand; submitted snapshot/hash/journal giữ spelling, test lower-hash replay deny và exact uppercase step/task pass. Descriptor guard ở scoped snapshot trước serialization, không gọi array getter/iterator; tests chứng minh400 trướcverify, không đổi actor/proof hoặc ghi ticket; ordinary arrays vẫn giữ exact hash. No global canonicalizer/ACL/DTO/SQL/peer changes. Delta so với `task-2-slice-b1-reviewed-baseline` chỉ F1/F2 và8 regression plus test fixture canonical DB identity; original reviewer cần scoped re-review hai findings. Source frozen, không heavy process còn lại. B2–B5/full T2/production positive authority vẫn pending.
