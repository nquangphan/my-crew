# Inventory model, probe và broker credential của gateway

## Mục đích

Gateway tiêu thụ SourceConfig của machine, SourcePin/ProjectionPin phase03 và protocol model/secret đã review của migration008. Module này chưa nối vào host entrypoint và không cấp dispatch permit, runtime certificate hoặc trạng thái available. Probe offline luôn UNVERIFIED với capabilities rỗng; source OFF không gửi entry mới. Server giữ quyền receipt clock, TTL và pool admission.

## Điểm vào

- `ModelInventory.collectInventory(config,workflows)` giữ nguyên API model list của owner, chỉ quan sát pair đang current và cùng source tree. Catalogue CLI từ trusted composition port chỉ là catalogue; thiếu binary hay isolated-home authentication chưa đo vẫn UNVERIFIED. Không thực thi CLI hoặc đọc/copy HOME owner.
- `ModelProber.probeModel(key,pair,mode)` đối chiếu context với runtime/source/projection/derivation/policy. `executableContext` hash byte executable qua no-follow FD, không hash version string. Mỗi lần collect đọc lại context, không reuse PASS/certificate local. Thay binary/projection/derivation dẫn context mới; server008 đối chiếu receipt/certificate exact context.
- `ModelReporter.reconnect` gọi machine GET desired rồi chụp bất biến config và boot trước collect; collection chồng nhau hoặc boot đổi trong await không gắn revision/boot mới lên observation cũ. Body cũng được chụp trước await journal; server vẫn quyết định chấp nhận context lịch sử. `currentBoot` là bootId/generation của producer007; module không đăng ký boot khác. AtomicRecords riêng cấp một sequence tăng chung inventory/applied mỗi boot. Counter fsync trước report: crash có thể bỏ qua số nhưng không cấp lại số. Report và HttpOperationJournal giữ reportId, operation ID, route, key và body trước HTTP; `replay(reportId)` dùng nguyên input lịch sử. Source status applied là observation caller, không tự suy ready. Digest applied phải khớp inventory body của cùng boot/revision. Reporter không đọc/ACK ba command workflow007 hoặc tạo sync_models completion; composition Task03 giữ command routing chung.

## Các bước

### Credential và native bridge

`CredentialBroker` dùng generic-password service `com.2pcrew.v2.<machine>.<provider>`, account là UUID operation/envelope; ref gồm machine/provider/operation, không chứa secret. Put cùng operation đọc old/write/read-back; bytes khác bị conflict. Local writes serialize, remove idempotent. `withSecret` chỉ chấp nhận callback đã ghim trong trusted composition, cung cấp Readable channel một lần; kết quả callback không được trả ra API. Callback error được thay bằng mã cố định, channel bị destroy và owned buffer được zero. Callback là code trusted của broker/transport, không là renderer hay model child.

`SecurityFrameworkBridge` yêu cầu helper macOS đã pin byte SHA-256, no-follow regular file, UID/mode/link count đúng và trusted signing/ACL verifier. Sau spawn, verifier nhận actual dormant PID + expected binary hash trước khi request bytes được gửi. Thiếu verifier mặc định `SECURITY_BRIDGE_UNVERIFIED`. Helper Objective-C gọi Security.framework SecItemAdd/Update/CopyMatching/Delete cho generic password trong data-protection keychain, không synchronizable, AfterFirstUnlockThisDeviceOnly và LAContext interactionNotAllowed. Đóng gói/signing/ACL proof thuộc phase09; callback boolean của fixture không chứng minh signing thật.

ABI: dedicated FD3, bốn uint32 network-endian `{operation,serviceLength,accountLength,valueLength}` rồi bytes; operation 1=put, 2=read, 3=remove. Reply `{status,valueLength}` rồi bytes; 0=success, 1=not-found, -1=failure. Một operation/process, không secret argv/env/stdout/stderr; tối đa secret8192 bytes, reply8200 bytes, deadline3 giây. Source có thật và đã compile syntax/link development; chưa chạy helper Security.framework trên Keychain owner. Test mặc định fake SecurityBridge; fake native C helper chỉ kiểm FD ABI và không link Security.framework.

`CredentialProvisioning` lưu X25519 PKCS8 private bytes trong Keychain namespace riêng machine, journal chỉ giữ keyId/public SPKI/state. Registration/confirmation dùng actual008 routes, encrypted challenge/AAD canonical và SHA-256 clear challenge. Rotation giữ retired private keys để hoàn tất pending envelope cũ; key loss không tự tạo ACK thành công. Secret envelope kiểm own machine/provider/current revision, canonical base64, X25519, nonce12/tag16, ciphertext SHA256 và AAD `{machineId,providerId,keyId,configRevision,operationId,expiresAt}`. HKDF info `crew-v2-secret-envelope-v1`, salt nonce12, AES-256-GCM. Put theo envelope ID và read-back hoàn tất trước fsync ACK intent và HTTP operation. Automatic `syncPending` tìm immutable ACK intent trước kiểm revision/expiry/decrypt của provisioning mới. Lost ACK replay cùng key/body/ref/operation; `replayAck(envelopeId)` chỉ dùng ACK intent đã fsync sau write/read-back, kiểm credentialRef vẫn còn trong Keychain rồi replay metadata, không cần transport private key hoặc gia hạn expiry. Server008 quyết định ACK lịch sử hay từ chối pending expired/key_lost/stale; không có intent thì không được ACK. không thay bằng provider state mới nhất hoặc UUID order. Host không lưu current provider ref pointer; authority current provisioning operation thuộc server008.

`syncPending(readMachine)` GET own desired trước GET own pending envelopes, dùng decimal cursor008 và serverTime response. Mọi encrypted envelope durable trước cursor advance; failed ACK giữ queue. ACK lịch sử thành công chỉ dọn đúng queue cũ; desired còn pending thì state vẫn pending đến GET xác nhận stored. `syncPending` chỉ trả stored sau dùng nguyên `CurrentCredentialResolver.resolve` và `assertCurrent` đọc current metadata cùng revision/provider/endpoint/protocol/ref/operation, rồi xác nhận local ref bằng broker. Lịch sửA stale/mất local không hạ currentB khi bindingB và localB thật đều được xác minh. Nếu chính currentA mất local, metadata thiếu/sai hoặc observed ref/operation đổi thì trả pending, không lộ raw error; queue ACK lỗi và immutable history vẫn giữ. Read-only metadata GET không phải ACK HTTP; không tạo lease/admission. Thiếu intent hoặc local ref vẫn từ chối; owner cần cấp lại khi pending key mất/expired/stale. Source API OFF trả disabled trước đọc envelope. ServerReceiptClock dùng server receipt + elapsed monotonic cho cả now và upper TTL bound 5 phút; challenge phát hành sau GET vẫn hợp lệ, còn receipt quá 5 phút hoặc actual expiry vẫn bị từ chối; host wall clock không kéo dài expiry, replay/backwards receipt không quay estimate lùi. Không có server receipt thì từ chối secret/challenge. TTL/admission cuối cùng vẫn do server quyết định. Plaintext/private key không đi vào generic HTTP journal, gateway journal, renderer, exception hay model child.

### Protocol và HTTP

Responses và Chat Completions có parser riêng: exact model ID, terminal protocol, function name/arguments và call ID không trùng. SSE kiểm raw UTF-8 bound 1 MiB trước bỏ BOM và chuẩn hóa LF/CRLF/bare CR, rồi yêu cầu frame cuối hoàn chỉnh và terminal event/[DONE]. Responses giữ tối đa4096 event,64 item/part; đối chiếu response/item/output index, call ID/name, toàn bộ argument/text fragments và done với completed. failed/incomplete/error kết thúc thất bại ngay. Metadata lifecycle, logprobs/usage, annotation nullable và function item thiếu status theo tài liệu được xử lý; event/modality ngoài subset text/function bị từ chối. completed-only body vẫn hỗ trợ như trước; khi đã có lifecycle/fragments thì phải hoàn tất và khớp toàn bộ tracked output. Offline shape evidence không cấp PASS. Authorized-live chỉ qua trusted authorization + call port; một call/probe, deadline tối đa30 giây, không retry model call ngầm. Capabilities chỉ đến từ observation đã đo: text riêng, tools cần execution/result correlation, stream cần observed framing, vision cần explicit measured image observation. Không suy file_pdf/docx/xlsx/csv từ vision. Producer verified derivative/provenance phase05 chưa nối vào module; không tự nhận đã consume hay ép native MIME khi extraction/OCR tương lai đã được review.

`PinnedProviderTransport` ghim provider/model/protocol, request token cap128, một request in flight, nhận credential qua trusted one-use callback. Endpoint normalization khớp server008. HTTPS không literal-IP/localhost/credential/query/hash; HTTP chỉ loopback origin exact có localHttp explicit. Mỗi request resolve toàn bộ DNS answers, từ chối private/reserved/mapped/transition/documentation addresses, pin lookup socket về một allowed address và giữ hostname TLS. Không follow redirect. Body bound1 MiB, idle3 giây; caller ModelProber cấp absolute deadline/abort. DNS callback giữ đúng Node `all` contract. Transport thực hiện bounded protocol call; live tool/vision observation phải được trusted probe port cấp bằng measurement, không lấy catalogue/declared flag làm proof.

AUTH (401/403): owner kiểm endpoint/token rồi cấp secret mới; gateway giữ pending nếu không lưu/ACK được. QUOTA (429): dừng admission mới và chờ Retry-After/backoff bounded1s–5min, không suy quota từ CLI catalogue hoặc tự gọi lại phí. 5xx/network/timeout → TRANSIENT; malformed tool → TOOL_PROTOCOL. Trusted transport giữ kết quả lỗi bằng closed union TOOL_PROTOCOL/MODEL_MISMATCH/PROTOCOL/STREAM_PROTOCOL/RESPONSE_TOO_LARGE/SSRF_DENIED/TRANSIENT bên trong operation trước broker; arbitrary callback vẫn chỉ ra CREDENTIAL_TRANSPORT_FAILED. Body/key/error provider không nằm trong ProbeResult/evidence digest. Probe receipt hết hạn theo server clock → unavailable dù host observedAt đi tới tương lai; explicit probe/config/binary/pin/auth/quota changes phải collect/report observation mới. Không mint certificate hoặc dispatch choice từ observation local.

### Binding credential hiện hành

`CurrentCredentialResolver.resolve(provider,revision,signal)` đọc mới cả `/v2/machine/model-sources` và `/v2/machine/api-credential-bindings`; kiểm machine/revision/API ON, provider duy nhất còn declared, endpoint/protocol/models/localHttp khớp provider đã chọn, status stored và scoped credentialRef còn tồn tại qua `broker.assertStored`. Thiếu/pending/OFF/removal/ref sai scope hoặc revision lệch đều từ chối. currentOperationId=null hợp lệ với stored ref được giữ qua revision; không suy ref từ operation ID hay lịch sử ACK. Không cache binding qua reconnect.

Composition dùng `PinnedProviderTransport.callCurrent`, resolver cấp ref và closure kiểm lại đúng ref/currentOperationId cùng desired hiện hành. Transport kiểm lại sau resolve DNS và trước tạo header, rồi sau response trước khi trả kết quả; thay đổi quan sát được dẫn từ chối, response không trở thành probe thành công. `call` với explicit ref vẫn là port thấp cấp cho trusted protocol harness; caller đó tự chịu authority, không được xem như đã consume current binding. Các read có abort signal, không tự retry. Snapshot read là sampled authority: config có thể đổi sau snapshot hoặc trong lúc network đang chạy; không hứa atomic network lease, không tạo dispatch permit hoặc kill attempt đang chạy.

File bổ sung: `gateway/src/models/current-credential-resolver.ts` và `gateway/test/current-credential-resolver.test.ts`. Test dùng broker thật với fake Security bridge và HTTP loopback protocol riêng: stored/null operation, reconnect, OFF/removal/status/revision/endpoint/protocol/ref conflicts, ref mới cùng tồn tại, thay đổi trước header và trong response. Không đọc owner Keychain hoặc gọi provider thật. ModelReporter consume/ACK `sync_models` vẫn là composition handoff chưa triển khai; không suy applied từ endpoint read hay probe response.

## Files

| File từ v2/ | Vai trò |
|---|---|
| gateway/src/models/contracts.ts | Mirror DTO actual008, dùng frozen host SourcePin/ProjectionPin |
| gateway/src/models/inventory.ts | Catalogue và current-pair collection |
| gateway/src/models/probe.ts | Context byte hash, protocol/SSE parser, offline/live gates |
| gateway/src/models/provider-transport.ts | Endpoint/DNS/socket pinning và one-use credential transport |
| gateway/src/models/model-reporter.ts | Shared durable report sequence và exact HTTP replay |
| gateway/src/models/credential-broker.ts | Scoped credentialRef, put/read-back/channel/remove |
| gateway/src/models/credential-provisioning.ts | Server clock, key/challenge/envelope/ACK/queue |
| gateway/src/models/security-bridge.ts | Attested helper/signing gate và FD3 bridge |
| gateway/src/models/security-keychain.m | Actual Security.framework generic-password adapter |
| gateway/test/model-probe.test.ts | Protocol, offline/live authority, SSRF, stream và local HTTP |
| gateway/test/model-reporter.test.ts | Desired GET, boot/revision/shared sequence/restart replay |
| gateway/test/credential-broker.test.ts | Scoped refs, conflict/read-back, trusted channel và fake native FD |
| gateway/test/credential-provisioning.test.ts | Actual008 crypto, lost ACK, stale/AAD/expiry/key loss |
| gateway/test/support/model-fixture.ts | Exact test-root identity và cleanup receipts |
| gateway/test/fixtures/models/security-channel.c | Unsigned FD fake, không Keychain |
| gateway/src/models/current-credential-resolver.ts | Fresh current binding và recheck sampled authority |
| gateway/test/current-credential-resolver.test.ts | Current ref, status/revision và network boundary regressions |

## Dữ liệu

Journal lưu metadata key/report/operation, encrypted pending envelope và immutable ACK intent; credential plaintext/private key giữ tại broker/Keychain, không trả cho renderer/model child. Snapshot current binding chỉ có metadata machine/provider/revision/ref; không là lease network hay dispatch permit.

## Flow liên quan

`server-models` cấp current desired, credential snapshot, provisioning và admission; `server-gateway` cấp boot/report context; `gateway-host` cấp AtomicRecords/HTTP journal. `gateway-workflows` cấp source/projection đã ghim. Phase05 cung cấp derivative/provenance về sau; host composition và runtime/signing certification còn là gates riêng.

## Tests

Focused tests dùng fake in-memory Security bridge, actual crypto, actual AtomicRecords/HttpOperationJournal restart và fake loopback HTTP listener; native FD fake compiled riêng trong fixture. Native source compile syntax bằng SDK hiện hành. Signed app/helper ACL, CLI subscription isolated-home authentication, paid/provider live calls, native runtime isolation và server dispatch authority đều UNVERIFIED. Không sửa host composition, journals007/005, migration008/009, dependencies, global HOME hoặc source v1. PM ánh xạ các file mới vào flow manifest và chạy generate/check sau khi tích hợp, rồi review spec/quality độc lập.

Apple primary references: [generic password](https://developer.apple.com/documentation/security/ksecclassgenericpassword), [AfterFirstUnlockThisDeviceOnly](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly); local SDK LAContext.h dòng350 xác nhận interactionNotAllowed available macOS10.13.

FIX1 protocol references: [WHATWG SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation), [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events), [function calling streaming](https://developers.openai.com/api/docs/guides/function-calling#streaming), [Chat streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events). Fixtures dùng protocol nội bộ bounded, không gọi provider thật.
