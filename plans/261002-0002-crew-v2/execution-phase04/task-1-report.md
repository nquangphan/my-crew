# Phase04 Task1 — server model pool implementation report

Trạng thái: **implementation đóng băng để PM stage và review độc lập**, chưa coi Phase04 hay toàn Phase03 hoàn tất. Task1 dựa vào Phase02 và actual007 đã review READY YES (`202233e..8347bd6`). Baseline dispatch `8e7d313`; HEAD tại final checks `ccb349895c254d5b0dc944c08bfa5f104f74c391` gồm commit PM/peer, worker không stage/commit. Không subagent, cài package, global tool, shared DB, owner secret, Keychain hay model có phí.

## Kết quả và ranh giới authority

Source config revision riêng trong008, ba công tắc độc lập và danh sách API model explicit của owner. OFF chặn lựa chọn mới ngay theo desired; không kill attempt cũ và không nâng workflow applied007. Inventory/applied dùng cùng sequence cho mỗi boot007, machine lock/current credential trước journal cache, historic exact replay trả response gốc không gia hạn receipt. Pool/dispatch kiểm current model desired/applied, latest inventory, exact current workflow source/projection/report, context/binary/policy/OS, capability đo được và certification immutable fresh. Cùng model ID ở runtime/provider khác vẫn khác ModelKey; `modelKeyId` encode từng component với prefix version.

Production `denyModelProof` trả unverified/capability rỗng và `denyCertification` trả UNVERIFIED. Host body PASS, future observedAt và capability vision tự khai không thành authority. App optional typed `modelVerifiers` chỉ là composition port cho observer độc lập; không env flag hoặc test route. Private observer fake HTTP text/tool và fake isolation trace trong **test DB** kiểm protocol/transaction, không chứng nhận native Claude/Codex/API hoặc process-wide isolation. Live gate vẫn UNVERIFIED.

008 hook AFTER INSERT actual005attempt binds issued→admitted cùng transaction, exact command/decision/selection/modelChoice/nonce/project/machine/probe/current007report và008applied. Lost claim replay giữ A; challenge A không mở B. Hook chỉ hoạt động khi command có certificationAdmission và trusted port đặt transaction-local marker; không thay005claim/guards/companion007. `assertModelDispatch` không cấp DispatchPermit: Phase06 phải gọi trong claim transaction sau locks/005scope/telemetry/binding gates rồi giữ deny defaults tới khi producer thật được review.

## Inventory trước và sau

Trước: 16 file mới dưới models/migration/test/support/newflow chưa tồn tại; 5 producer/flow files đã tồn tại. Sau: 21 file thuộc scope dưới đây. JSON inventory ghi presence và SHA từng file; snapshot trước test redaction cuối cũng lưu riêng. Các gateway/workflows file của peer không thuộc inventory và không bị worker sửa.

- `v2/server/migrations/008_model_pool.sql` — thêm mới
- `v2/server/src/models/catalog.ts` — thêm mới
- `v2/server/src/models/certification.ts` — thêm mới
- `v2/server/src/models/commands.ts` — thêm mới
- `v2/server/src/models/config.ts` — thêm mới
- `v2/server/src/models/contracts.ts` — thêm mới
- `v2/server/src/models/helpers.ts` — thêm mới
- `v2/server/src/models/routes.ts` — thêm mới
- `v2/server/src/models/secret-envelopes.ts` — thêm mới
- `v2/server/test/model-pool.test.ts` — thêm mới
- `v2/server/test/model-certification.test.ts` — thêm mới
- `v2/server/test/model-secret.test.ts` — thêm mới
- `v2/server/test/support/model-http.ts` — thêm mới
- `v2/server/test/support/model-observer.ts` — thêm mới
- `v2/server/test/support/model-certification.ts` — thêm mới
- `v2/server/src/app.ts` — sửa hẹp
- `v2/server/src/journal/event-contracts.ts` — sửa hẹp
- `v2/docs/flows/server-models.md` — thêm mới
- `v2/docs/flows/server-journal.md` — sửa hẹp
- `v2/docs/flows/server-platform.md` — sửa hẹp
- `v2/docs/flows/server-docs-view.md` — sửa hẹp

R2 handoff: PM thêm đúng 15 source/migration/test/support mới của flow `server-models` vào `v2/docs/flows.yaml`, giữ manifest/generate/index/architecture/Git serialize. Page `server-models.md` đủ 7 heading bắt buộc. R3 đã sửa server-journal/server-platform/server-docs-view cho event/app integration. Docs CLI staged gate thuộc PM, worker không bypass hay claim đã chạy staged check.

## Migration và checksum

008 SHA-256: `85c7fc4eb89fd01a951ffa36876d2c699fe97bc67830068bad6178ddc51c42b6`.

11 tables: model_source_configs, api_providers, model_report_receipts, model_source_applied, model_probe_receipts, model_certification_challenges, runtime_certification_receipts, credential_keys, credential_key_challenges, api_secret_cursor, api_secret_envelopes. SAME-machine boot/history FK, shared ordered report uniqueness, deferred receipt/applied FK, immutable receipts, active-key uniqueness, own decimal secret cursor và accepted-applied ACK trigger được kiểm trên PostgreSQL thật. Provider removal dùng declared tombstone để giữ envelope/key history, không xóa receipt. 008 ALTER gateway_commands CHECK chỉ thêm sync_models, giữ prior3types.

001–007 bytes giống hệt baseline8e7d313; diff execution/gateway/platform/contracts rỗng:

| Migration | SHA-256 |
|---|---|
| `001_platform.sql` | `dda56a23030e01ee5025d61578969b53157f96fd19ffe6172108b652f6adfa76` |
| `002_journal.sql` | `11806e8bb34e6aefb2f225d1499052d66d76c06f1ccd278021353fcc7fed78e9` |
| `003_identity.sql` | `0949541124c0ff26fec05030b8693afe65705ff2d63887f7e452fa6d37487d5d` |
| `004_tickets.sql` | `1149012423551fb847c6a9adf3784906d466a6026d8edb67e079d433dcf8af4f` |
| `005_execution.sql` | `b8351b54e99ae91a3d2476df812b8fc374860ae472cfe8b7459a4dfc61e41027` |
| `006_docs.sql` | `8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae` |
| `007_gateway.sql` | `9a5542b2a58dd151d1ad78a7dc799ba7bee157abfd094c3c1ebfebf1a2d49eb4` |

## Route và DTO handoff cho Task2/Phase06

Mọi machine write yêu cầu bearer hiện hành + idempotency-key; owner write cần cookie/Origin/CSRF + idempotency-key. Chỉ read không cần idempotency-key. Machine tự quản lý bản thân; ACL project cũ không đổi.

| Method | Route | Wire response/body |
|---|---|---|
| GET/PUT | /v2/machines/:id/model-sources | owner: GET SourceConfig + applied metadata (hoặc desiredConfig:null); PUT SourceConfigInput → SourceConfig |
| GET | /v2/machine/model-sources | SourceConfig hoặc null |
| GET | /v2/machines/:id/models?workflow=bmad hoặc superpowers | owner {items:PoolEntry[],reason} |
| GET | /v2/machine/models?workflow=bmad hoặc superpowers | own {items:PoolEntry[],reason} |
| POST | /v2/machine/models/inventory | ModelReportEnvelope<ModelInventoryBody> → {accepted,reportId,serverTime,observationDigest} |
| POST | /v2/machine/models/applied | ModelReportEnvelope<ModelAppliedBody> → {accepted,applied,reportId,serverTime} |
| POST | /v2/machine/models/certifications | CertificationEvidence → {status} |
| GET | /v2/machine/model-commands?after=0&limit=50 | {items:ModelCommand[],nextCursor}; all4types; cursor decimal |
| POST | /v2/machine/model-commands/:id/ack | GatewayAck; own adapter only sync_models |
| POST | /v2/machine/credential-keys | CredentialKeyRegistration → encrypted challenge metadata |
| POST | /v2/machine/credential-keys/:keyId/confirm | CredentialKeyConfirmation → keyId/status |
| GET | /v2/machine/api-secret-envelopes?after=0 | {items:SecretEnvelope[],nextCursor,serverTime}; separate decimal cursor |
| POST | /v2/machine/api-secret-envelopes/:id/ack | SecretAck → operationId/status |
| POST | /v2/machine/api-secret-envelopes/:id/key-lost | {} → operationId/status |
| POST | /v2/machines/:id/api-providers/:providerId/secret | owner SecretInput → operationId/status; no blob/plaintext |

Exports contracts.ts: Source, Capability, ModelKey, ProbeContext, ProbeResult, PoolEntry, ModelDispatchChoice, ModelReportEnvelope, ModelInventoryBody, ModelAppliedBody, ApiProviderConfig, SourceConfig, SourceConfigInput, CertificationChallenge, CertificationEvidence, RuntimeAdmission, CredentialKeyRegistration, CredentialKeyConfirmation, SecretEnvelope, SecretAck, SecretInput, ModelCommand, ModelProofVerifier, CertificationVerifier, ModelRouteOptions và closed nested schema constants. Frozen gateway DTO không sửa.

Service exports: getPool, latestInventory, reportModelInventory, reportModelApplied, assertModelDispatch, modelKeyId; readSourceConfig, readModelApplied, setSourceConfig, validateApiEndpoint; issueCertificationChallenge, verifyCertification, requiredCertificationSurfaces, denyCertification; register/confirmCredentialKey, provisionSecret, readSecretEnvelopes, ackSecret, markSecretKeyLost, sealSecret; readModelCommands, ackModelCommand; registerModelRoutes. Hàm getPool nhận Db hoặc Tx; API read dùng repeatable-read snapshot, claim phải dùng Tx có machine/current authority locks.

`ProbeContext` hash SHA256 JSON theo đúng thứ tự sourceTreeSha256, projectionManifestSha256, projectionTreeSha256, derivationSha256, binarySha256, policySha256, osVersion. Derivation hash dùng sorted canonical JSON; policy hash là isolation policy, không nhầm builder policy. Receipt TTL server5phút (DB bound≤15), không dùng host clock để gia hạn. Inventory/applied sequence decimal string tăng chung; reportId immutable replay, changedbody409. Applied lỗi AUTH vẫn có thể applied=true nếu cả3source đã quan sát đủ; pool sourceApplied phản ánh config, entry unavailable với AUTH. Partial observation không nâng applied.

## Secret wire và bảo mật dữ liệu

X25519 public key SPKI DER base64 canonical, fresh ephemeral X25519 cho mỗi envelope, HKDF-SHA256 info `crew-v2-secret-envelope-v1`, salt nonce12bytes, AES256GCM tag16bytes. AAD challenge canonical `{machineId,keyId,challengeId,expiresAt}`; AAD secret canonical `{machineId,providerId,keyId,configRevision,operationId,expiresAt}`. ciphertextSha256 hash decoded ciphertext bytes. Challenge plaintext random chỉ tồn tại tạm; DB lưu hash+encryptedChallenge, phải confirm SHA256 plaintext trước active key. One active key/machine; rotation retire key cũ, pending envelope không được ACK bằng key mới. Host Task2 giải mã trong bộ nhớ và chỉ ACK sau Keychain thật.

Plaintext chỉ qua TLS/request-memory; Buffer được wipe nhưng JS string không thể bảo đảm wipe. Generic idempotency chỉ body hash và response operation/status, không encrypted blob; blob chỉ dedicated table, ciphertext/tag xóa sau accepted ACK/key_lost/expiry-invalidated config. Exact logical ACK replay trả bản gốc khi state đã acked, không xóa lại; wrongoperation/key/digest/revision/TTL từ chối. Owner GET, response, event và idempotency không có plaintext; live key-store durability chưa kiểm ở Task1.

Endpoint canonical HTTPS không credentials/query/hash/literal IP/localhost/private-name shortcuts. Local HTTP chỉ exact127.0.0.1 hoặc[::1], explicitport+allowedOrigin. Server không fetch endpoint. Task2 phải DNS resolve/pin address và chặn private addresses/redirect/downgrade thực tế; không suy list API từ GET/models.

## Producer integration thực tế

app.ts chỉ thêm models imports, optional AppOptions.modelVerifiers, đăng ký routes trước ready, req.body.secret logger redact. ServerOptions, disableRequestLogging/errorhandlercodeonly/denyDispatch/denyFinalResult/007selection defaults giữ nguyên; không auto migrate/listen/test switch.

event-contracts.ts chỉ thêm source.desired exact{revision}, source.applied exact{revision,reportId}, positiveint/UUID/nullproject+ticket/requiredmachineaudience; gateway.command.created thêm sync_models. Metadata không nhận endpoint/catalogue/evidence/secret. Superseded old model commands có acknowledged event một lần. Các case cũ không thay.

Own typed model ACK adapter trả409 MODEL_CONFIG_PENDING trước acceptedexactrevision/currentboot. 008 trigger cũng chặn generic007ACK bypass, không để completed row/event/idempotency-response commit trước applied. Generic007handler phân loại SQLguard thành503 SERVICE_UNAVAILABLE; đây là cost của giữ007frozen, không bypass. Prior3commandtypes giữ behavior. SUPERSEDED chỉ exact{ok:false,code:SUPERSEDED} và desiredrevision>commandrevision; không clientphrase hoặc lineage shortcut.

## TDD và kiểm chứng

Durable logs: `task-1-evidence/`. RED được chạy trên DB đúng prefix trước implementation: migration absence; HTTP config400/200 kỳ vọng nhưng404; inventory/key/cert/privateissuer/ownmodelACK404; decimal after=0 bị400; provider removal409; sourceApplied AUTHfalse; tự khai vision được lọt vào capabilities. GREEN tương ứng ghi riêng. Một PG startup57P03 ban đầu là infra, rerun exact test; lỗi fixture slug/partial alias/201claim/Bready/duplicate seq được sửa fixture, không source bypass.

| Final gate | Command/scope | Kết quả |
|---|---|---|
| focused model | pnpm --dir v2/server test --test-file absolute models.test.ts; import3files | exit0, 15/15 (10pool+2cert+3secret), duration5395.715ms |
| one covering server | pnpm --dir v2/server test --test-file absolute server.test.ts; import24files | exit0,208/208, duration37417.279ms |
| added redaction proof after covering | pnpm --dir v2/server test --test-file absolute v2/server/test/model-secret.test.ts | exit0,4/4, duration1999.561ms |
| final types | pnpm --dir v2/server typecheck | exit0 |
| owned Biome | models +3tests +3supports +app/event (16files) | exit0, nofix |
| whitespace | git diff --check | exit0 |
| flow structure/frozen bytes | exact7headings;001–007compare8e7d313 | PASS |

Covering208 là sau thay đổi nguồn production cuối. Sau covering chỉ thêm một test actualbuildApp child+realHTTP để chứng minh logger redact và DB/event/journal rejection, cập nhật prose flow; không đổi nguồn production và không lặp covering. Final owned tests inventory16; freshcombined15 trước test thêm + focusedsecret4 sau đó. Không claim đã chạy combined209. Typecheck/Biome/diff check được chạy lại sau test thêm. Không broad domain/desktop/gateway suite repeat.

Critical assertions: CAS race one200/one409; stalecredential bị rotate ngay sau initialauth nhưng trước journalcache thì401 và không cached mutation; same-machine currentboot+sharedseq; retired immutable replay currentcredential; allOFF/immediateOFF; fakeHTTPprobe caps chỉ independent observed text/tools; binary change cùng version/projection rotation làm unavailable; currentreport/projectionexact; incomplete surface UNVERIFIED không mint cert; actual008binding A/replay-notB/companionstale fence; fresh choicecapability mismatch denied; pending ACK generic/ownrollback noevent/idempotency; endpoint/model explicit constraints; crypto independent decrypt/AADtagtamper/keyconfirm/rotation/foreignscope/staleACK/keylost/lostACK; metadata secrets/wrongaudience rejection.

## Backup/restore và cleanup

Focused container `640eb2326e7e882a32b2337b4d1e0d13b96e989ee808195b0ac6090725d1361c`,127.0.0.1:57232. Backupsource crew_v2_test_70bf8d4f3f6b4c8fa7b3ea7239bed4e8, restore crew_v2_test_9c9e30741373419f8de460d6779073dc.

Covering container `1da067080c979c1d916d05ec0ea470e258dad2fc62fd5d1b7cf95e61034f81a8`,127.0.0.1:57669. Backupsource crew_v2_test_37148cdf40c74659bb58efb8c4f3602f, restore crew_v2_test_0dc1d780f17c4a1e9f22da7f1d090f6a. Test pg_dump prefix7→restore7→captureMigrations8+migrate→immutable reports→dump/restore8→restart HTTP/replay/checksumdrift/FK/immutable checks; logical DB names cleanup in finally, exact container registered runner cleanup.

Redaction final container `63c11c368d1f564e0cc04d59f43f4b12906bfaa1817744d6cca46e0fab699eef`,127.0.0.1:59414; own child app/db/listener closed finally. All20 observed own containerIDs verified absent by docker ps -a --quiet --no-trunc --filter id=EXACT; cleanup.json includes exact IDs/checkexit/remains. No shared production/dev5432/55432, prune, unrelated container deletion.

Own final umbrella paths `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-model-focused-10pk52xi/models.test.ts` và `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-model-cover-qpfyz31a/server.test.ts` đã unlink và xóa đúng parentdir, remainingfalse. Đường dẫn test source thật giữ nguyên. Dump bytes tồn tại trong container riêng đã xóa cùng container.

## Giới hạn và review handoff

Chưa live/native capability/isolation/network/filesystem certification, không signed native observer producer, không paid API/Keychain, không host RELEASE/fallback/adapter. Test-only observer PASS chỉ fakeprotocol; production UNVERIFIED. Challenge private route không trong buildApp; issuer trusted phải chứng minh scratch scope/budget, không được expose trong prod composition. Phase06 giữ exact selection+modelChoice trong command/decision và actual005claimTx, không tạo permit từ catalogue.

Có reason codes409/400/401/403/404, generic007ACKguard503 đã nêu. Query API list owner/machine chỉ publication metadata; source configs khác machine không nhận inventory/challenge/envelope. Provider tombstone giữhistory và host phải nhập secret lại khi endpoint/protocol đổi/keylost. Worker không sửa frozen bytes, không touch peerworkflow sources, không markplan/taskreviewcomplete.

Semantic independent fix waves: 0 ở thời điểm handoff; TDD implementation/debug fixture không coi là review approval. PM stage explicit inventory, R2manifest/generated, then independent fullspec+quality review đặc biệt008trigger/authbeforecache/secretwire/challengeauthority. Không cần broader rerun sau cùng covering nếu review không đổi nguồn hoặc phát hiện failure mới.


## FIX1 — semantic wave1/5 (2026-10-02)

Bốn confirmed findings R1–R4 đã sửa trong một batch; original reviewer gate vẫn pending, không mở Task2/009 hoặc chứng nhận runtime. Durable provider.current_operation_id/FK dưới machine/provider locks; historical ACK/loss không rewind credential mới. lost_at phân biệt private-key loss với normal rotation, invalidate tất cả affected pending/retire đúng key, giữ newer ACK credentialRef và unrelated active key. Model selection source exact gate trước fresh005claim và current007 install boot join trong008 đã có actual PG/HTTP rollback proofs.

Final corrected candidate-scoped24file covering **215/215**, exit0,40607.3265ms sau final source/tests; typecheck0/Biome14files0/diff0, frozen001–007 unchanged, protected005/007/app/events/ServerOptions diff0. 008 SHA256 mới `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f`; chỉ7 owned files đổi trong21 originalinventory. Five own containers exact-ID absent và one umbrella root deleted; full freeze tại task-1-fix1-evidence/.

Scope error ghi đầy đủ: first26file umbrella nhầm peer attachments tests, đã áp009 trong private test DB rồi interrupted exact own runner exit143; đây **không phải approval009**, không FIX2/reset. Giữ7 failures/1cancel log, six RESPONSE_INVALID peer failures và docs EPIPE (corrected PASS). Không sửa peer; interrupted attachment scratch exact-path cleanup không được captured. Xem task-1-fix-report.md cho ruling/cost/commands/counts/checksums/cleanup/limitations và review handoff.
