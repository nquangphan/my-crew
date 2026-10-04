# Phase04 Task2 — Inventory / credential broker / probe

Status: IMPLEMENTED CANDIDATE, đang chờ independent SPEC+QUALITY review và PM integration. Không kết luận phase04/03/09 đã đạt; runtime/certification/live/signed ACL vẫn UNVERIFIED. Không stage/commit/merge hoặc sửa flow manifest/generated files.

## Bổ sung current binding — recovery worker, trạng thái cuối

Status: **DONE_WITH_CONCERNS / IMPLEMENTED CANDIDATE**, chờ PM commit và independent full SPEC+QUALITY review. Phần own binding đã triển khai và có RED/GREEN; không kết luận toàn gateway/phase04 READY. Không stage/commit/branch mutation; read-only Git archive/show/diff được PM cho phép. Primary workflow vẫn SDD; hỗ trợ TDD/verification, systematic-debugging cho failure đã quan sát. Không spawn agent.

### Phạm vi và producer

Theo ruling PM15:34/15:39, mở rộng hẹp đúng server models contracts/routes/secret-envelopes, own model-current-credentials test, server-models R3 và own gateway resolver/transport/test/R3. Tổng own source **23 file** (16 trước +7); inventory cuối `task-2-evidence/current-credential/final-owned-source-inventory.json`. Migration008 vẫn SHA `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f`; không sửa001–009. Source gateway/core candidate lấy **reviewed556cd8d + own23**, không lấy918/native Task5 hoặc active sync/execution/retirement FIX1 của peer. Readonly archive members được kiểm path/type, không copy checkout tùy ý, không copy/install dependency; hai snapshot có cùng content đặt dưới ancestor dependency server/gateway đã có.

- `GET /v2/machine/api-credential-bindings` chỉ bearer chính machine, query rỗng, dùng wrapper current-credential reauth + repeatable-read/read-only hiện có. Snapshot đọc trực tiếp config/provider008: machineId/configRevision/apiEnabled + providerId/endpoint/protocol/status/credentialRef/currentOperationId cho provider declared. Không secret/ciphertext/history inference, mutation, pointer mới hoặc authority mới.
- Resolver đọc mới desired rồi binding; đối chiếu machine/revision/API ON/provider/model list/localHttp/endpoint/protocol/status/scoped ref, gọi `broker.assertStored`. Missing/pending/OFF/removal/ref conflict/revision mismatch từ chối. Stored ref với nullable currentOperationId hợp lệ sau revision cùng endpoint/protocol. Reconnect không cache ref; late ACK không chọn ref.
- `PinnedProviderTransport.callCurrent` consume resolver, recheck current state sau DNS trước header, sau response trước trả kết quả. Ref/currentOperation thay đổi dù credential cũ còn local cũng từ chối. Signal được truyền cho readonly reads và transport; không retry. Đây là **sampled readonly authority, không atomic network lease**; thay đổi sau snapshot hoặc giữa network có thể chưa quan sát được. Không cấp dispatch permit/certification.
- `call(explicitRef)` vẫn là low-level trusted protocol port, không được xem là đã consume current binding. Host composition phải dùng `callCurrent`. ModelReporter `sync_models` consume/ACK và applied observation vẫn là explicit later composition handoff; không fabricate applied. Native signing/Keychain/live provider/CLI subscription auth/certification giữ UNVERIFIED.

### Bằng chứng kiểm chứng cuối và các failure giữ nguyên

Thư mục evidence: `task-2-evidence/current-credential/`; mỗi snapshot có manifest, source SHA, exact argv/cwd/exit, source-stability và exact root cleanup receipts.

| Kiểm chứng | Kết quả thực tế |
|---|---|
| Prior server current-binding RED | 4/4 FAIL vì route404, `server-red.log` (worker trước tạo); giữ nguyên |
| Own server PostgreSQL/HTTP GREEN | 4/4 PASS, exit0; late old ACK/replay, reverse UUID order, reconnect, pending/key loss, null currentOp retained, revision/OFF/removal/endpoint/protocol, foreign/owner/revoked-after-preflight |
| Gateway RED có exact rejection assertion | 4/4 FAIL, `gateway-red-exact.log`: NOT_IMPLEMENTED / missing callCurrent |
| Gateway focused GREEN | 4/4 PASS, exit0; actual broker/fake Security bridge, bounded loopback HTTP, pre-header change/no extra request và in-flight change/rejected result |
| Frozen build + typecheck | Gateway build0; gateway/server typecheck0. Sau test-only assertion cleanup gateway frozen typecheck0 lần cuối |
| Full explicit server manifest25 files, migrations≤8 | **218/219 PASS, 1 FAIL**, exit1. Existing `HTTP bounded docs upload exceeds ordinary1MiB and app shutdown closes real SSE`: fetch EPIPE. Own4 đều PASS |
| Same frozen old HTTP whole case narrow reproduction | **0/1 PASS, 1 FAIL**, exit1 với cùng EPIPE |
| PM15:57 reviewed f58 test-only fixture disposition | Overlay chính xác committed `server/test/support/http.ts`, `server/test/api-acceptance.test.ts`, `docs/flows/server-docs-view.md` vào server candidate; **whole case1/1 PASS**, exit0. Valid import >1MiB, actual413 cho1MiB/24MiB và SSE shutdown đều chạy. Không overlay production/009; hashes3 context files riêng ở `final/server-fixture-overlay.json`. Không cộng số thành219PASS |
| First gateway continuation preparation error | Snapshot được tạo lại nhưng bỏ sót build của root mới: **93/104 PASS, 11 FAIL**, exit1; host/journal compiled entrypoints không tồn tại. Lỗi harness worker, không giấu log `continuation/gateway-covering.log`; root đã cleanup |
| Final rebuilt explicit gateway manifest17 files | **103/104 PASS, 1 FAIL**, exit1, 0skip/cancel,75843.82ms. Existing lifecycle `UI main exit and reopen preserve independent host boot`: ECONNREFUSED. Own27 đều PASS; source238 không đổi |
| Same frozen lifecycle whole case narrow | **1/1 PASS**, exit0, không sửa host/test/core. Chứng minh gián đoạn; stale-socket existsSync readiness chỉ là giả thuyết chưa xác minh. Không cộng thành104PASS |
| Test-only lint cleanup | Biome ban đầu exit0 nhưng12 warning non-null assertion ở own resolver test; thay bằng assert.ok fixture binding và typed handle. Focused4/4 PASS sau sửa; production không đổi. Amendment SHA ở `test-cleanup/test-only-amendment.json`; không chạy lại broad chỉ vì sửa assertion |
| Final scoped Biome | **19 TS files, exit0,0warning**, `test-cleanup/biome.log` |

Source freeze của final covering có238 files. Test-only amendment sau covering đổi duy nhất `gateway/test/current-credential-resolver.test.ts`, đã kiểm focused4/typecheck/Biome; final source inventory ghi SHA mới. Hai failure baseline và failure preparation nằm trong `verification-summary.json`; không loại test âm thầm, không claim full suite xanh. PM yêu cầu independent reviewer đánh giá own scope và giới hạn candidate. Native Objective-C không đổi so với compile/link evidence trước; không chạy signed helper hoặc owner Keychain.

### Cleanup, hạn chế và bàn giao

- Reconciled process trước chạy: không tìm thấy detached runner đúng task. Cuối cùng **8 snapshot roots** được xóa theo exact nonce+dev/ino/UID và kiểm absent; **8 fixture roots /8 fake-helper PIDs** của hai gateway cover có paired create/remove/reaped receipts. Không còn process mang exact snapshot paths. `final-resource-audit.json`, `fixture-cleanup-receipts.json` giữ identity đầy đủ.
-4 container IDs từ prior RED/current GREEN/full server/repaired narrow có actual ID trong log và inspect xác nhận absent. Old narrow HTTP baseline runner không log container ID; finally cleanup không báo lỗi, nhưng **không có initial exact create receipt để xác nhận độc lập ID của riêng lần đó**. Readonly time-bounded docker events trả0event; không suy ownership hoặc xóa container theo prefix. Không claim kiểm exact DB receipt cho lần đó.
- Hai initial unreceipted roots `crew-model-report-zQeH26` và `crew-model-crypto-DTjkSU` **RETAIN theo PM**; không prefix deletion. Không owner credentials/Keychain/live call/global HOME/config/shared DB/service changes.
- Context hook chặn direct đọc dependency directory và docs compiled bundle; không đổi hook/.ckignore/settings hay lách restriction. Dùng pnpm ordinary build/type/test và đã đọc actual docs flows; manifest/generate/docs integration do PM.
-3 f58 files là **reviewed verification context đã committed**, không là own worktree changes. All original23-owned inventory đã recheck sau cleanup; peer files giữ nguyên. Report phần dưới lưu lịch sử16-file implementation và evidence trước extension.

## Producer và ownership

- Dispatch worktree `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`, initial HEAD `d9aec4d32f2593254aeed90481031409cacd5fce`.
- Actual producer Task1 FIX1 independently READY theo PM: `e94f2e1..d249a82`,008 SHA `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f`. Đọc actual contracts/config/routes/secret-envelopes/helpers/catalog và flows server-models/server-gateway trước implementation.
- Consumes frozen007 SourcePin/ProjectionPin/WorkflowStatus, AtomicRecords/HttpOperationJournal và current boot composition port. Không sửa producer, server/v1,005/007/008/009, host composition, registry/process/HTTP journal, package/lock/manifest/generated docs.
- Registry peer FIX2 và sync/execution/attachment peers đang làm việc; không revert hay claim thay đổi peer. Committed reviewed baseline final snapshot: `556cd8d106715b0c3ccc5893e8383b44083230db`.
- Đã đọc skill TDD/writing-good-tests, SDD và verification. Không spawn subagents theo dispatch; PM chịu independent review và docs/Git integration.

## Hành vi đã làm

1. Mirror actual008 DTO trong gateway-owned contracts, dùng host frozen pin types. Inventory giữ nguyên API owner list và skip source OFF/current pair thiếu/mismatch; catalogue CLI chỉ là catalogue. Không quota/entitlement inference.
2. Context từ byte hash executable no-follow, selected source/projection/derivation/policy/OS. Refresh mỗi collect; CLI absent/auth isolated-home chưa đo giữ UNVERIFIED. Không cache/cấp certificate/available local. Offline protocol evidence không có PASS capabilities.
3. Parser Responses/Chat riêng, exact model/tool name/arguments/call IDs; SSE bounded complete framing/terminal/correlated fragments. Trusted authorized-live port bắt buộc, deadline/abort tối đa30s, một call/probe, Retry-After/backoff không retry phí ngầm. Text/tools/stream/vision được ghi riêng từ observation; không suy file MIME từ vision. Real PinnedProviderTransport có endpoint policy exact008, all-DNS address guard, socket lookup pin/all-address Node contract, no redirects,1MiB bound/idle3s/one-use credential.
4. ModelReporter GET machine desired trước reconnect collect, current boot007/generation port, sequence chung inventory/applied bền vững. Counter fsync trước report và journal HTTP exact ID/body/key/route. Replay old report không tự tạo sequence/TTL. Applied digest trỏ inventory cùng boot/revision; caller phải cung cấp actual observation, không synthesise ready. Không consume workflow commands007 hoặc tự ACK sync_models.
5. Broker scoped v2/machine/provider generic password refs; conflicting operation write rejected, write/read-back trước trả ref; local serialize/remove idempotent. Trusted callback identity pin, one-use Readable channel, return discarded, error sanitized, buffers zero/destroy. Không trả secret cho UI/API/model child.
6. Actual Security.framework helper Objective-C source tồn tại: SecItemAdd/Update/CopyMatching/Delete, data-protection keychain, nonsynchronizable accessibility, LAContext interactionNotAllowed. Dedicated FD3 ABI, empty env/no secret argv/stdout/stderr. Bridge no-follow byte hash/UID/mode/link checks,3s/8200byte bound, loaded dormant PID+expected hash signing/ACL trusted gate trước request bytes; gate thiếu mặc định UNVERIFIED. Native actual source compile+link, binary không execute. Unsigned fake native C chỉ kiểm ABI.
7. X25519 private key Keychain namespace riêng machine; journal chỉ key ID/public/state, encrypted challenge and ACK metadata. Actual008 HKDF-SHA256 info/salt, AES256GCM tag/AAD/digest/base64 strict. Own pending envelope/current revision/provider/server receipt clock checks trước decrypt. Envelope-ID put/read-back rồi fsync immutable ACK intent+journal trước HTTP. Lost ACK exact replay; rotation giữ retired private keys. Missing key/new envelope không ACK success; queue pending/re-entry.
8. `syncPending` GET own desired trước own envelope GET; durable encrypted queue trước cursor advance. OFF không đọc new secrets. ServerReceiptClock dùng server receipt + elapsed monotonic, không host wall clock. `replayAck` dùng chỉ persisted write/read-back intent, kiểm credential vẫn tồn tại, replay exact metadata kể cả expired/private-key-loss history; server008 quyết định cached receipt hay reject pending stale/expired/key_lost. Không suy provider current ref từ UUID/cursor/late ACK.

## RED/GREEN và failures được giữ

- Initial behavior RED4 (`NOT_IMPLEMENTED`) → GREEN4 (broker scope/trusted channel/protocol/endpoint).
- Report/crypto RED3 → GREEN3: real AtomicRecords/HttpOperationJournal restart, X25519/GCM protocol, server receipt clock. Initial first RED setup outside try left2 temp candidates và test eventloop; CtrlC exit130, clean RED rerun exit1 với cleanup normal. Không giấu lần lỗi này.
- Inventory/probe RED → GREEN7; SSRF/native RED → GREEN, IPv6 empty prefix và padded reserved range đã sửa có regression. C syntax first failure (`explicit_bzero` unsupported + deprecated UI constant) chuyển Objective-C LAContext và volatile wipe, actual compile+link exit0.
- Local write concurrency/bridge-error RED → GREEN; native fake FD round trip GREEN. Thử `/dev/fd/4` exec trên macOS thất bại (native-fd-executable.log); thay bằng loaded-PID signing gate trước FD request, default UNVERIFIED, không fallback unsigned actual Keychain.
- Desired/secret reconnect RED → GREEN; Node pinned DNS `all` contract RED → GREEN.
- Late own self-review: durable ACK already stored must survive transport-key loss/expiry. RED (`replayAck NOT_IMPLEMENTED`) → GREEN with unchanged intent and missing credential rejects before HTTP. Replacement snapshot build first caught unreachable `old.ack` after old-intent return; redundant dead branch removed. Evidence kept candidate-build-red-*; no test broad rerun occurred before that build correction.
- Earlier full typecheck transient peer failures preserved: first sync implicitAny, then execution-bridge-db missing now + imported server TransferListItem/picomatch. PM/peer fixed; final actual worktree typecheck0. Không weaken tsconfig hoặc sửa peer.
- Snapshot preparation first Python lacked tarfile.extractall(filter=); fallback validates captured git archive member paths/types and copies only regular/dir entries. Exact created roots removed for both infrastructure failures; không installer/dependency/package changes.

## Kiểm chứng trước khi bổ sung current binding

Final immutable candidate: committed `556cd8d:v2` + exact owned16files, source archive/files SHA in candidate-frozen-source.json.235capturedfiles unchanged before/after commands (candidate-source-stability.json). Build exit0; explicit16-file covering100/100,0fail/skip/cancel,78389ms,exit0; candidate full gateway typecheck exit0. Final scoped Biome13TSfiles exit0,no warnings/fixes. Actual native Objective-C syntax/link exit0, not executed. Exact argv/log/exit are candidate-command-results.json; test manifest is covering-test-manifest.json. Source inventory all16files still matches working tree after candidate removal.4own final fixture roots removed and4fake helper PIDs reaped; every exact identity is cleanup-receipts.json. Native link and snapshot infrastructure/final roots have separate exact removal receipts. No test file omitted silently: active peer sync/execution/pin-retirement tests are excluded explicitly because not part of captured committed candidate.

First pre-ACK working-tree covering:100/100,0fail/skip,16 explicit files (77reviewed+23own), exit0; full actual gateway typecheck0, scoped Biome13TS files0 and build0. Đây là working tree chứa unreviewed peer journal/registry diff; start/end tracked hashes có0delta nhưng không claim committed-core certification. Replacement final snapshot lấy committed HEAD:v2 + own16files và read-only existing ancestor dependencies, không chép/enable source peer. Explicit manifest loại active sync/execution/pin-retirement tests vì không thuộc frozen candidate.

## Native / secret / SSRF review và gate chưa đo

- Owner credentials, owner Keychain, global HOME/model auth, paid calls, remote installs, enable/release/runtime dispatch: không thực hiện.
- Signed application/helper identity, ACL/access-group, actual Security.framework Keychain operations, CLI subscription isolated-home auth, runtime native confinement/live certification: UNVERIFIED, phase09/Task7 gates.
- Local trusted gate/observer callbacks là composition ports, không HTTP/UI inputs. Fake boolean/signing response trong fixture không có quyền cert production. Host PASS vẫn không có authority nếu server008 trusted verifier không đo independently.
- PinnedProviderTransport hiện bounded protocol call; actual live tool-result/vision observation đến trusted probe measurement port. Không claim đã chạy tool/model/vision trên provider thật. Source offline/refreshed catalogue không suy entitlement.
- Verified derivative/provenance consumer phase05 chưa review/bind nên không fabricate derivative authority. File_pdf/docx/xlsx/csv không được infer; future verified extraction/OCR phải map text/vision tại actual producer handoff.
- Plaintext/private-key bytes không nằm trong gateway/HTTP journal, argv, lâu dài env, stdout, telemetry hoặc callback results. Provider response/error không đưa vào ProbeResult/evidence digest. JS strings/header memory và OS crypto objects sống trong bounded trusted process scope; zero owned byte buffers, không hứa xóa mọi copy do VM/OS quản lý.
- Endpoint policy mirror actual server, canonical endpoint/localHttp exact origin; DNS resolves/checks all answers each call and pins socket/TLS hostname, reserved/mapped/transition ranges fail closed. No paid retries/redirects.

## Cleanup / source freeze

- Native actual link-only root `/private/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-task2-native-link-idge8t7f`,dev16777229/ino63490097/uid501 removed. Binary SHA `c8f61542a46b0ca87088f6a2ae127ab854a34e82857d8d25b94ceb680edb1c4a`,52832bytes, NOT_EXECUTED.
- Own final test roots and fake helper PIDs emit exact create/reaped/remove receipts; final receipt inventory is task-2-evidence/cleanup-receipts.json. Snapshot root removed by exact dev/ino/UID check after commands; no global delta cleanup.
- Historical initial RED candidates retained pending ownership adjudication: `crew-model-report-zQeH26`,dev16777229/ino63474429/uid501,onlyhttp-operations; `crew-model-crypto-DTjkSU`,ino63474433,empty. Both birth14:24:56 match own failing setup, but no exact initial create receipt. Readonly initial-red-residue-inventory.json; no blanket removal/hidden cleanup success claim.
- Bản trước extension có owned source16files; PM must map runtime/test/support/native new files into gateway-models flow, generate docs, stage/check/commit and request independent full spec+quality review. Worker did not mutate flow manifest or index.

| Exact owned file cuối | SHA256 cuối |
|---|---|
| `v2/docs/flows/gateway-models.md` | `278f1eafd95a28674d46d3c27dc1b4fddeb760867ff49a875906b02a791ca579` |
| `v2/gateway/src/models/contracts.ts` | `ca9f57c7fef2bc7c8936e60a244d39dbb58e08c268e451438a9225c1709ccc05` |
| `v2/gateway/src/models/credential-broker.ts` | `b11ba5b8ff73eb6fba786ae4bb3289fea747d2b799b9c9957981937c4254552f` |
| `v2/gateway/src/models/credential-provisioning.ts` | `e96f825f90c8fb27a4d6aa82a10395f14398113d839cc12ad03f1cc22609f1b0` |
| `v2/gateway/src/models/inventory.ts` | `8ca558722a903f993e342f0fbb4fbe96d1feb67e35cb8581860be9d0497e10c3` |
| `v2/gateway/src/models/model-reporter.ts` | `cc075bc3e539a0e84f107847c643f11246103b291aad7f858131377e1e62e165` |
| `v2/gateway/src/models/probe.ts` | `9d21df4a1c689c0b371efd30b918ff846c2eb5aea1db1b7db3e346c537d28939` |
| `v2/gateway/src/models/provider-transport.ts` | `eaa58ceb17807df240e909d1be3ec270608c20bad567f85046698f3d0ab7131e` |
| `v2/gateway/src/models/security-bridge.ts` | `297dbc7b3bcd1867f7727b3cac4c3976be4581ac849c30ba519e3f0783d67a40` |
| `v2/gateway/src/models/security-keychain.m` | `4e83beb032f045553b130f9e643f4d4f4781b451a9cece6ccf971e721addb0e6` |
| `v2/gateway/test/credential-broker.test.ts` | `40c58a33c83a4369917f9bb55b77f1088f4e949202a9212dbca3690003fbeb32` |
| `v2/gateway/test/credential-provisioning.test.ts` | `860d9abc6af3293e3c8182ff725b25a206f3573b5a265fdbbeb72e1d26e679ac` |
| `v2/gateway/test/fixtures/models/security-channel.c` | `2e19ba0ffb9fa276a1f9de3b4ab78905be1c913919bb6ad941f32496ffe33610` |
| `v2/gateway/test/model-probe.test.ts` | `39002c53d185c98589195915c123f38131631a2e00a9a6130faa461629868408` |
| `v2/gateway/test/model-reporter.test.ts` | `15a1f81e7513e3af78f4ae08e000a25552d775296dacaab221638c5a769ed89e` |
| `v2/gateway/test/support/model-fixture.ts` | `083ebf9f19c1e280f6c2e63d0c95321df381d5f363b1d61fe99a04404e3ef064` |
| `v2/server/src/models/contracts.ts` | `f991a57bb4013ec5d33254bab88d7377e66cb31d9fec383f8cd378b86b197cde` |
| `v2/server/src/models/routes.ts` | `76d1433ef88ef10e48deaffd2de940fbaebbdb831f3d01f36763eed6f06315c3` |
| `v2/server/src/models/secret-envelopes.ts` | `b118ec7deff4fcbe3797a71e7eee8746d2cc144a5edef49699e0fffed2b584ad` |
| `v2/server/test/model-current-credentials.test.ts` | `42bb2269aa57f604ffe1747d481043d6b22fb576f4a4c526bdd02cfabfcb858b` |
| `v2/docs/flows/server-models.md` | `361c451aebbdf3d6dc8382c611faf3a91b2ad54a01cc6330311d8a8697f40029` |
| `v2/gateway/src/models/current-credential-resolver.ts` | `bacdcf8ba2b3570b8a9ae0698fb6cddbdad80453121abc2bf7302678aed363ef` |
| `v2/gateway/test/current-credential-resolver.test.ts` | `d8d0e8d614adfced260b0d712cdfdc959bcf8f081ad07f54281c4be2806e59a5` |

## Câu hỏi / gate còn lại

1. PM/independent review định đoạt baseline intermittent host lifecycle và giới hạn evidence; không có claim full gateway READY. HTTP legacy fixture disposition đã được PM15:57 cho phép và narrow whole-case PASS riêng.
2. Host composition consume `callCurrent` và ModelReporter consume/ACK `sync_models` chưa nằm trong scope này. Không cần suy provider-currentRef nữa: readonly endpoint/resolver đã có, nhưng end-to-end composition vẫn là handoff.
3. Phase05 derivative/provenance/live observation, signed Keychain/native isolation và paid provider gates vẫn UNVERIFIED. Hai historical unreceipted temp roots tiếp tục giữ theo ruling.

PM integration: gateway-models flow ban đầu không theo bảy heading canonical; PM chuyển nội dung nguyên trạng vào đúng Mục đích/Điểm vào/Các bước/Files/Dữ liệu/Flow liên quan/Tests, bổ sung map hai resolver files. pm-doc-heading-amendment.json giữ before/after SHA, inventory/table cập nhật doc SHA. Không đổi production/test, không chạy lại broad suite.
