# Nguồn model, catalogue và cấp secret Crew v2

## Mục đích

Server quản lý ba công tắc Claude/Codex/API theo máy, danh sách API do owner khai báo, receipt probe và certificate bất biến. OFF chặn lựa chọn mới ngay; không dừng attempt hoặc thả guard 005. Catalogue chỉ lọc ứng viên, phase06 chịu trách nhiệm đánh giá, xếp hạng và phát permit. Chưa có observer native/live nên composition production mặc định giữ UNVERIFIED.

## Điểm vào

- `server/src/models/routes.ts` → `registerModelRoutes(app,options,deps,ports)`, được `app.ts` đăng ký trước ready.
- `server/src/models/config.ts` → `setSourceConfig`, `readSourceConfig`, `readModelApplied`, `validateApiEndpoint`.
- `server/src/models/catalog.ts` → `reportModelInventory`, `reportModelApplied`, `getPool`, `assertModelDispatch`.
- `server/src/models/certification.ts` → `issueCertificationChallenge`, `verifyCertification`; issuer không có route production.
- `server/src/models/secret-envelopes.ts` → key registration/confirmation, envelope provisioning/read/ACK/key-lost.

## Các bước

1. Owner GET/PUT `/v2/machines/:id/model-sources` đọc desired/applied hoặc CAS expectedRevision. PUT cần session, Origin/CSRF và idempotency. Máy GET `/v2/machine/model-sources` nhận desired DTO redacted cho chính mình. Mutation dùng authorization 007 trong cùng transaction trước journal cache: cursor 002 → scope 005 nếu certificate có attempt → máy → state 008; recheck actual credential/session. Certificate replay vẫn cần current binding/fence. Máy chưa bind có thể quản lý own config/report; secret cần một project bound và dispatch vẫn theo scope 005.
2. API endpoint canonical HTTPS, không credential/query/hash/literal IP/localhost; HTTP chỉ origin `127.0.0.1` hoặc `[::1]` với port canonical và localHttp explicit khớp tuyệt đối. Danh sách model nonempty/unique trong provider, cùng ID ở provider/runtime khác vẫn riêng. Server không fetch provider hay suy model từ `/models`; host phải resolve/pin IP mỗi request, không redirect, chặn DNS rebinding/private destination. Provider bỏ khỏi desired vẫn giữ row lịch sử FK nhưng không xuất hiện catalogue; endpoint/protocol đổi làm credential cũ missing và pending envelope expired.
3. Config thực sự đổi tăng revision riêng, supersede command model cũ một lần bằng `{ok:false,code:'SUPERSEDED'}`, phát metadata và queue `sync_models {configRevision}` trên cursor 007. Adapter typed `ModelCommand` tại GET `/v2/machine/model-commands?after=&limit=` nhận cả bốn loại; POST `/v2/machine/model-commands/:id/ack` nhận riêng sync_models. Received giữ pending; completed cần accepted applied đúng command revision/current boot. Trigger 008 cũng bảo vệ đường generic 007; generic ACK sớm trả 503 theo errorhandler cũ, adapter trả 409. Ba loại 007 cũ giữ semantics. Replay completed giữ result; đổi result 409. SUPERSEDED exception chỉ exact result trên và desired revision cao hơn.
4. POST `/v2/machine/models/inventory` và `/applied` dùng ModelReportEnvelope: một sequence tăng chung mỗi boot 007, không protocol boot mới. Receipt ID/hash đã commit replay response gốc trước current boot/sequence checks, không đổi TTL/state. New report phải current boot/current model revision, sequence mới. Inventory lấy server receivedAt/expiry 5 phút; observedAt/version string chỉ chẩn đoán. Trusted probe port trả **capabilities đã đo**; host PASS hay capability tự khai không cấp quyền. Full model key + source context giữ hai workflow riêng. Applied phải trỏ latest inventory cùng current boot/config và digest canonical body; đủ ba observation advance config kể cả AUTH/error, thiếu giữ pending. Config applied và model ready là hai thông tin riêng.
5. GET owner `/v2/machines/:id/models?workflow=` hoặc machine `/v2/machine/models?workflow=` trả PoolEntry redacted và reason. Pool đối chiếu full SourcePin, desired projection/derivation, applied gateway revision và accepted `gateway_applied.latest_report_id` của current boot; null/old slot unavailable. Probe phải latest inventory/current model revision, fresh theo clock server; certificate phải exact runtime/source/projection/derivation/binary/policy/OS. AUTH mới loại PASS cũ dù TTL còn. `assertModelDispatch` giữ khóa máy sau scope 005 của caller, đối chiếu command/decision selection và modelChoice, domain Pin, required capability và exact pinned receipt IDs; OFF chặn ngay. Hàm này không cấp permit hay thay authorizer mặc định.
6. Scratch issuer là explicit trusted port; production không đăng ký `/v2/test/*`, không có env/test flag. Test fixture owner route kiểm current session/CSRF, test scope/budget, trả nonce một lần, DB challenge chỉ giữ hash. Private authorizer khóa challenge và đặt marker transaction; trigger INSERT attempt 008 kiểm current desired/applied/report/probe context, matching command/decision/modelChoice/nonce rồi bind issued→admitted đúng attempt/process/fence. Lost claim replay A đi qua 005; challenge không cấp B. Companion policy đọc admitted A, không tiêu nonce lần nữa. Certificate so attempt/guard/binding/context/companion, đủ positive selected và negative unselected init/invocation/native Read/Bash/MCP/child/absolute/symlink/hardlink/network; verifier phải đối chiếu observer độc lập. Missing proof giữ UNVERIFIED không mint authority receipt; full accepted PASS/FAIL bất biến theo challenge/body hash. Protocol fake trong test DB không chứng nhận runtime thật.
7. Máy POST `/v2/machine/credential-keys`, giải encrypted challenge rồi POST `/:keyId/confirm`. Active key duy nhất; rotate retire key cũ nhưng host giữ private key tới pending ACK. Owner POST `/v2/machines/:id/api-providers/:providerId/secret` cần current revision/active key/binding; plaintext chỉ ở request memory, log redact `req.body.secret`. Ephemeral X25519 ECDH + HKDF-SHA256 + AES-256-GCM, info `crew-v2-secret-envelope-v1`, salt nonce 12 bytes, AAD canonical `{machineId,providerId,keyId,configRevision,operationId,expiresAt}`. Public key là base64 DER SPKI; tag 16 bytes, digest SHA256 ciphertext bytes. GET `/v2/machine/api-secret-envelopes?after=<decimal>` dùng cursor 008 riêng, không UUID ordering. POST `/:id/ack` so operation/key/digest/ref/current revision/expiry rồi xoá ciphertext/tag một lần, giữ metadata/hash cho replay. `/:id/key-lost` xoá bytes, giữ pending presentation/missing credential để owner cấp lại; không fake Keychain success. Key challenge có AAD `{machineId,keyId,challengeId,expiresAt}` với cùng crypto. Host kiểm AAD/key/revision/expiry, fsync operation, Keychain write/read-back và ACK intent trước HTTP; phần host/Keychain/signing thuộc task sau.

## Files

| Đường dẫn từ `v2/` | Vai trò |
|---|---|
| `server/migrations/008_model_pool.sql` | Model state, receipts, encrypted envelopes, additive command/claim hooks |
| `server/src/models/contracts.ts` | DTO, trusted proof ports và closed schemas |
| `server/src/models/helpers.ts` | Hash/context canonical, errors/time/events |
| `server/src/models/config.ts` | Desired CAS, provider policy và sync queue |
| `server/src/models/catalog.ts` | Inventory/applied receipt, pool và claim gate |
| `server/src/models/commands.ts` | Additive typed command read/ACK |
| `server/src/models/certification.ts` | Bound scratch challenge và verified immutable receipt |
| `server/src/models/secret-envelopes.ts` | X25519/GCM wire, key confirmation, envelope lifecycle |
| `server/src/models/routes.ts` | Owner/machine auth và route composition |
| `server/test/model-pool.test.ts` | CAS/order/auth/ACK/capability/provider/backup HTTP/DB proofs |
| `server/test/model-certification.test.ts` | Default deny, actual claim hook/replay/receipt/context/OFF |
| `server/test/model-secret.test.ts` | Crypto client, rotation/scope/redaction/ACK/cursor |
| `server/test/support/model-http.ts` | Private real HTTP fixture, separate authorities |
| `server/test/support/model-observer.ts` | Fake loopback provider observer, protocol only |
| `server/test/support/model-certification.ts` | Test-only scoped issuer route, nonce not journaled |

## Dữ liệu

Migration 008 tạo 11 bảng riêng; SQL 001–007, 005 execution và frozen public contracts không đổi. FK giữ boot/report/machine lineage, immutable report/probe/cert receipts và CHECK/UNIQUE kiểm key/state/sequence. Binary hash là bytes, không runtimeVersion. Secret responses/journal/events/catalogue không chứa plaintext hoặc encrypted secret payload; ciphertext chỉ ở riêng envelope pending, GET bearer đúng máy. PostgreSQL 18.6 test chạy cổng loopback random khác 5432/55432, backup prefix7→restore7→migrate8→restore8 với DB/container IDs riêng.

## Flow liên quan

`server-platform` composition/migration; `server-identity` credential/binding; `server-journal` atomic mutation/event; `server-gateway` current boot/workflow/command/companion; `server-execution` authoritative claim/guard. Phase06 supply trusted current selection/modelChoice and permit; phase04 host/runtime tasks supply independent measured observer and secret broker. Không kết luận toàn phase03/04 hoặc native isolation đã đạt từ protocol này.

## Tests

Focused ba model test files chạy bằng một absolute runner fixture hoặc riêng từng file; một covering server sau final source. Assertions dùng DB thật/HTTP listener riêng, fake provider loopback và private observer tables; capability/protocol PASS trong fixture không là live certification. Backup/restore, drift/immutable constraints, revoked/rotated actual token, historical replay, superseded inventory, exact command completion, crypto tag/AAD tampering và source OFF đều có bằng chứng. Native sandbox, paid credential/call, signed Keychain ACL và gated runtime RELEASE live chưa chạy, giữ UNVERIFIED đến gate Task7/phase09.

Kiểm cuối dùng app production thật trong child process và HTTP secret route: request lỗi thiếu active key trả 409, structured logger của app redact secret, không có plaintext trong response/journal/events/envelope DB. Test này bổ sung sau covering 208; scoped secret run 4/4, không đổi nguồn production và không lặp covering.
