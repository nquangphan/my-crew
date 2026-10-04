# Phase04 Task1 — review độc lập SPEC và QUALITY

Ngày 2026-10-02. Candidate **e94f2e1e992371be50e8f34adbffadd7cc8e195b**, dispatch base **8e7d313**. Review recovery thay lượt review bị usage limit trước khi có verdict; lỗi đó là infrastructure, không tính một vòng sửa semantic.

**SPEC: NOT READY. QUALITY: NOT READY. READY: NO.** Có **4 finding cần sửa**, đều tái hiện trên source candidate với PostgreSQL/HTTP fixture riêng. Không có Critical được chứng minh. Production vẫn deny/UNVERIFIED; review này không chứng nhận runtime/native isolation, Keychain hoặc observer thật.

## Phạm vi và nguồn đã đọc

- Đọc trọn `task-1-review-brief.md`, `task-1-brief.md`, `task-1-report.md` và package `task-1-review-package-e94f2e1.diff` 3.844 dòng/191.740 byte; approved Phase04 constraints và mapping/re-review round2; các DTO thực tế `SourcePin`, `ProjectionPin`, `DispatchSelection`, `GatewayAck`, `DispatchPermit`, `ServerOptions`.
- Đọc docs root/v2 trước source, flow `server-models`, `server-gateway`, `server-execution`, các flow app/journal/platform liên quan; đối chiếu producer auth/journal/claim/companion thật. Không có `.codegraph` trong worktree. CLI docs qua bundle bị hook chặn `dist`, còn `pnpm exec crew-docs` không có binary; dùng manifest/flow page hiện hành để tra phạm vi, không sửa ignore/hook.
- Package scoped 21 source/docs + 3 generated manifest/index. Commit history khác chỉ là context. So SHA của **toàn bộ 21 inventory files** với blob `git show e94f2e1:<path>` và file hiện hành: đều khớp. Không đọc/sửa unfinished registry hoặc attachments 009 để kết luận Task1.
- Review chỉ tạo file này; không sửa source/test/manifest, không stage/commit, không subagent/install/model trả phí/credential thật/shared DB.

Package SHA256: `6d7172f03661d37a5d8148749b4c14251bdb0cd5010e47e3cc899f49bf6762c1`.

008 SHA256 đã đối chiếu trực tiếp: `85c7fc4eb89fd01a951ffa36876d2c699fe97bc67830068bad6178ddc51c42b6`.

## Findings

### R1 — [P1] Fresh model dispatch nhận selection có source hash sai

**Vị trí:** `v2/server/src/models/catalog.ts:316–325`, đặc biệt phần so selection tại 322–325.

`assertModelDispatch` xác nhận command/decision chứa cùng selection, current domain Pin, probe/certificate và selected install report/revision/projection. Nhưng không so `payload.selection.sourceTreeSha256` với source hiện hành hoặc probe context. Vì vậy hai bản selection đồng nhất nhưng sai hash nguồn vẫn qua cổng này.

**Tái hiện candidate:** dùng fixture certification hiện có để tạo source/probe/cert `e…e` hợp lệ; sau normal-choice gate đầu tiên, đổi **cả** `commands.payload.selection` và `decisions.scope.selection` thành `{...s.selected, sourceTreeSha256:'a'.repeat(64)}`, giữ đúng modelChoice/report/revision/projection/permit. `db.begin(tx => assertModelDispatch(tx, permit, normalChoice))` vẫn resolve, không lỗi. Repro kiểm tra bằng assertion thật, không bỏ qua model gate.

```text
REVIEW_R1_WRONG_SOURCE_SELECTION_ACCEPTED {"selectedSource":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","currentSource":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}
```

**Hệ quả/contract:** Phase04 bắt fresh claim so exact source + projection + report + modelChoice đã ghim trong command/decision. Nếu Phase06 gọi service như hợp đồng, claim005 có thể tạo attempt/giữ guard/chuyển ticket running từ selection sai; companion007 sẽ từ chối pair sau đó. Không chứng minh model được RELEASE trái phép; đây là thiếu điều kiện **trước claim**, không được dùng sự từ chối sau claim để đóng lỗi.

**Sửa hẹp:** so selection source tree với source và receipt context trong cùng claim transaction, trước khi trả thành công. Thêm ca âm command+decision cùng sai source nhưng mọi field khác đúng; fresh claim phải rollback, không thêm attempt/guard/event. Không mở rộng DTO005/007.

### R2 — [P2] Envelope cũ có thể xoá credential đã được operation mới lưu

**Vị trí:** `v2/server/src/models/secret-envelopes.ts:201–207` (cùng vấn đề quyền ghi provider tại ACK 197–198).

`provisionSecret` cho phép nhiều operation pending của một provider/revision. `markSecretKeyLost` cập nhật provider thành `missing/credential_ref=null` vô điều kiện, không kiểm operation đó còn là operation hiện hành. Bản ghi envelope lịch sử vì thế vẫn có quyền sửa trạng thái credential mới.

**Tái hiện candidate bằng HTTP:** provision envelope A rồi B cho cùng provider/revision/key; ACK B với `credentialRef='newer-ref'` trả200, query provider xác nhận `newer-ref`. Sau đó POST key-lost của A trả200; provider trở thành `missing/null` dù B đã ACK thành công và envelope B vẫn acked.

```text
REVIEW_R2_OLDER_OPERATION_INVALIDATES_NEWER_ACK {"status":"missing","credential_ref":null}
```

**Hệ quả:** mất readiness và reference của credential đã lưu; stale loss/late ACK có thể ghi đè trạng thái operation mới mà không đổi config revision. Idempotency theo từng operation không giải quyết thứ tự giữa hai operation khác nhau. Đây là bug lifecycle server, độc lập với việc Keychain live chưa triển khai.

**Sửa hẹp:** pin operation hiện hành theo provider hoặc serialize/supersede provisioning rõ ràng; chỉ operation hiện hành được thay provider status/reference. Giữ metadata/replay ACK lịch sử. Thêm A pending → B acked → A key-lost/late ACK/replay: B phải giữ stored/reference. Nếu key bị mất thật trên máy, xử lý riêng trạng thái key ở R3, không dùng envelope cũ để vô điều kiện xoá credential mới.

### R3 — [P2] Báo mất active key nhưng server vẫn mã hoá secret mới cho key đó

**Vị trí:** `v2/server/src/models/secret-envelopes.ts:137–139, 201–208`.

`markSecretKeyLost` chỉ đổi envelope và provider; không vô hiệu `credential_keys` tương ứng. `provisionSecret` chỉ đòi `state='active'`, nên owner nhập lại secret ngay sau báo mất key vẫn được cấp envelope cho public key có private key đã mất.

**Tái hiện candidate:** tiếp nối R2 với key đang active, POST key-lost A đã200; POST owner secret với operationId mới, cùng keyId và current revision vẫn **200 pending**. Key chưa được đăng ký/confirm lại.

```text
REVIEW_R3_LOST_KEY_STILL_ACCEPTS_NEW_SECRET b79c7cde-f288-46f6-8e44-3dfc7c4bf4f2
```

**Contract:** approved secret-wire/key-loss semantics yêu cầu loss không giả stored và owner cấp lại secret; cấp lại chỉ có ích khi đích mã hoá giải được. Nếu API mang nghĩa mất private key như route/brief nêu, key đã mất không thể tiếp tục là active provisioning authority. Đây không phải yêu cầu chứng nhận Keychain ở Task1.

**Sửa hẹp:** vô hiệu key đã được báo mất cho **provisioning mới**, yêu cầu key mới đăng ký + giải challenge/confirm trước owner resend; xử lý pending envelopes của key đã mất theo policy rõ ràng và giữ historical receipts. Ca âm key-lost(active K) → new secret(K) phải409; confirm K2 rồi resend mới được nhận. Giữ rotation khác loss: retired key còn private bytes vẫn có thể hoàn tất pending ACK theo contract.

### R4 — [P2] Test admission actual005 dùng install report của boot đã retired

**Vị trí:** `v2/server/migrations/008_model_pool.sql:124–127, 138–140`.

Hook INSERT attempt buộc model inventory/applied ở current boot qua `gb`, nhưng join `gateway_install_reports ir` chỉ theo pointer/machine. Không buộc `ir.boot_generation=gb.boot_generation`. `gateway_applied` giữ pointer lịch sử khi boot đổi, nên report accepted từ boot cũ có thể mở test admission mới.

**Tái hiện candidate:** tạo accepted install report boot1 và issued challenge; đăng ký boot2, gửi inventory + full model applied của boot2, cập nhật choice sang fresh probe boot2, **không gửi install report boot2**, giữ selection trỏ report boot1. Private authorizer chỉ cấp đúng issued challenge/transaction marker như fixture. Actual `s.claim()` chạy frozen005 INSERT +008 trigger trả **201**, attempt được bind admitted.

```text
REVIEW_R4_RETIRED_INSTALL_BOOT_ADMITTED {"install_boot":"1","current_boot":"2"}
```

**Contract/hệ quả:** review brief yêu cầu actual admission kiểm current007 boot/install report. Catalogue normal path đã join current boot trong `currentPair`; bootstrap hook không được yếu hơn vì bỏ qua certificate/probe PASS cho lần đo đầu. Lỗi chỉ được chứng minh dưới explicit private fixture authority; production defaults vẫn deny, không gọi đây là production bypass hoặc native certificate proof.

**Sửa hẹp:** buộc accepted latest007 report đúng current boot trong008 admission validation; test boot1 install → boot2 inventory/applied/no install phải deny/rollback; boot2 accepted install + matching current selection mới201. Giữ001–007/claim005/companion007 nguyên byte/nghĩa, cập nhật checksum008 và evidence theo quy trình freeze của controller.

## Kết luận SPEC độc lập

**NOT READY:** R1 thiếu exact source selection trước claim; R3 không hoàn tất key-loss provisioning lifecycle; R4 thiếu current install boot trong bootstrap authority. R2 cũng phá trạng thái credential current khi nhiều operation/replay xen kẽ. Các điểm dưới đây đã được source/log chứng minh và không phải finding mở:

| Ràng buộc | Bằng chứng/đánh giá |
|---|---|
| Frozen001–007,005 guards/execution,007 DTO,ServerOptions | Diff base→candidate rỗng cho frozen migration/execution/gateway/platform contract;008 hash khớp; giữ defaults denyDispatch/denyFinalResult/denyProjectionSelection. |
| Current auth trước cache/read | Model writes dùng actual `authorizeGatewayMutation` trong journal trước lookup cache; certificate thêm current attempt/binding/fence; reads authenticate lại trong RR snapshot. Captured token-rotation race thật trả401 dù initial auth đã qua. |
| Boot/order/replay | Một sequence inventory+applied perboot; prepareReport historical exact receipt trước current checks; body đổi409; new retired boot/out-of-order409; không gia hạn TTL khi replay. Latest inventory current boot/model revision và full applied đúng digest/latest report. |
| Desired OFF và current model eligibility | Desired OFF đọc trong dispatch trước catalogue; latest inventory thay receipt cũ, gateway latest_report_id accepted/current boot/config/exact source/projection; binary/derivation/context/cert/required cap/receipt IDs kiểm trước normal dispatch. R1 là field nguồn selection bị thiếu. |
| sync_models008 | Additive type/typed read+ACK; normal completed cần same revision/current boot applied; exact SUPERSEDED cần desired revision cao hơn;008 trigger chặn generic007 bypass. Generic pending ACK503 là cost được ghi rõ; typed409; completed immutable, prior3types giữ behavior. |
| Challenge và cert | Real005 INSERT atomically issued→admitted, exact A/process/fence/command+decision, lost claim replay A, companion A qua policy thật, B deny. Surface thiếu giữ UNVERIFIED; test issuer không import trong production; trusted default verifier deny. Current install boot còn R4. |
| Secret crypto/wire | Canonical SPKI X25519, fresh ephemeral, HKDF-SHA256 +AES-GCM, context AAD, ciphertext digest, encrypted key challenge/confirm. Independent decrypt/tag/AAD tamper, wrong machine/key/digest, TTL,ACK deletion/replay có test. Lifecycle operation/key còn R2/R3. |
| Explicit API/SSRF boundary | Owner list nonempty/unique; canonical HTTPS, explicit exact loopback HTTP+port+origin; server không fetch/không mở rộng `/models`. DNS resolve/pin/redirect thực thuộc host chưa có và giữ UNVERIFIED. |
| App/events/docs | Routes trước ready, optional trusted ports, logger redact req.body.secret; metadata source events/audience/nullproject/ticket; sync_models whitelist;15new source/test/support mapped,R3 flow updates+3generated. Controller dispatch báo nested all/staged/rootstaged PASS; review không giả output staged tự chạy sau commit. |

## Kết luận QUALITY độc lập

**NOT READY:** code tách config/catalogue/certification/commands/secret rõ, fail closed mặc định, SQL constraints/immutable receipts/transaction authorization có chất lượng; lỗi còn lại nằm ở boundary identity/boot và credential state ordering, cần sửa trước consumer Task2/Phase06. Các test hiện có kiểm đường chuẩn và nhiều replay/race nhưng bỏ sót đúng bốn tổ hợp R1–R4. Không yêu cầu broaden suite hoặc live model để đóng các lỗi này; một batch sửa hẹp + negative regressions phù hợp là đủ trước review lại.

Captured evidence thực đã đọc:

| Evidence trong `task-1-evidence/` | Kết quả và giới hạn |
|---|---|
| `crew-v2-model-final-focused.log` | 15/15,0fail,5395.714875ms;10pool+2cert+3secret trước test logger mới. |
| `crew-v2-model-covering.log` | 208/208,0fail,37417.279ms, sau production source cuối; có actual prefix7 backup/restore7→migrate8→restore8/reopen/replay/drift/immutable proof. |
| `crew-v2-model-secret-redaction-final.log` | 4/4,0fail,1999.561458ms; added actual buildApp child/real HTTP/log secret proof; không đổi production source. **Không có combined209 claim.** |
| `crew-v2-model-final-types.log`, `crew-v2-model-final-biome.log` | tsc exit0 captured; Biome16files/no fixes. Review `git diff --check` source phạm vi exit0. |
| `source-inventory.json`, `frozen-migrations.json`, `cleanup.json` |21file candidate/current SHA trực tiếp khớp; frozen byte diff rỗng; captured20own container IDs absent và2umbrella deleted. Không dùng worker handback làm approval. |

## Bằng chứng narrow review và cách tái hiện

Không rerun covering. Chỉ tạo bản sao test trong scratch, thay relative imports thành absolute imports tới **candidate không sửa**, và chèn assertion tại các điểm sau. Các assertion của reviewer cố tình xác nhận behavior lỗi đang có; PASS của repro nghĩa là lỗi được quan sát, không là implementation PASS.

Scratch root: `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-model-review-uywiuy2u`.

1. `cert.test.ts`: copy candidate `model-certification.test.ts`; ngay sau normal `await db.begin(tx => assertModelDispatch(tx, permit, normalChoice))`, đổi command/decision selection source thành `a…a`, gọi lại gate và assert resolve, in R1 rồi restore selection. Toàn test certification gốc tiếp tục giữ các assertion khác.
2. `secret.test.ts`: copy candidate `model-secret.test.ts`; trong test key proof, sau đọc/decrypt envelope A và trước ACK A, provision B/ACK B, assert stored newer-ref; key-lost A, assert missing/null; resend bằng K cũ, assert200. Return khỏi callback để không trộn assertion đường ACK A gốc với nhánh lỗi mới.
3. `boot.test.ts`: copy scratch cert; trước fresh `s.claim()`, tạo boot2 + inventory/applied2/fresh choice, giữ selection/report boot1; assert201 và query install/current boot1/2, rồi return. `boot-settle.test.mjs` chỉ chờ1giây trước import để tránh PostgreSQL startup57P03, không đổi candidate/hypothesis.

Commands:

```text
pnpm --dir v2/server test --test-file <scratch>/review.test.ts --test-name-pattern='actual 008 attempt|key proof encrypted'
pnpm --dir v2/server test --test-file <scratch>/boot-settle.test.mjs --test-name-pattern='actual 008 attempt'
```

Successful narrow log1 (nguyên output chunk cuối từ tool transcript, runner exit0;2/2; UTF-8 với newline cuối):

```text
model-fixture-container {"containerId":"26ded9d259e1faaaaff7dcd08b5ab62da54cb049eeba12c881c333725cee656b","url":"postgres://postgres@127.0.0.1:50028/crew_v2_test"}
REVIEW_R1_WRONG_SOURCE_SELECTION_ACCEPTED {"selectedSource":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","currentSource":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}
✔ model challenge actual 008 attempt insert hook binds A and never authorizes B; trusted fake observer is isolated to test DB (757.116541ms)
REVIEW_R2_OLDER_OPERATION_INVALIDATES_NEWER_ACK {"status":"missing","credential_ref":null}
REVIEW_R3_LOST_KEY_STILL_ACCEPTS_NEW_SECRET b79c7cde-f288-46f6-8e44-3dfc7c4bf4f2
✔ model secret key proof encrypted provisioning and lost ACK replay erase ciphertext exactly once (351.533166ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1308.4855
```

Successful narrow log2 (`<scratch>/boot-settle.log`, exit0;1/1):

```text
model-fixture-container {"containerId":"59539c0c320f8ebc6cc7dff80b9d2c483619f009adbd75b7afd14d0afec10e05","url":"postgres://postgres@127.0.0.1:51280/crew_v2_test"}
REVIEW_R4_RETIRED_INSTALL_BOOT_ADMITTED {"install_boot":"1","current_boot":"2"}
tests1 pass1 fail0 duration_ms1926.41175
```

SHA256 nguyên output narrow log1 ở block trên: `afa2132604e634de30412453498c9bca760fd3e5ed1a0e63e4a168d35b507ab7`.

SHA256 scratch provenance trước cleanup:

| File | SHA256 |
|---|---|
| `cert.test.ts` | `dfb92d881908f9d93bb3a8ceac5efa7d4532ff3ffad79dc7abff1e23f169eccb` |
| `secret.test.ts` | `d7f87c4fa8d81cec48132dc90a0a99a54d8d99de05dc4fe55fc89018de5eefd8` |
| `review.test.ts` | `7db82c36d562519db98d7b0ad67d543e84231c221ef70f0948743843886be5be` |
| `boot.test.ts` | `f85bed1c77be362912a9e99c42a220d9b31f35c1918b940ec3a89292b2ac0941` |
| `boot-settle.test.mjs` | `dbffee4274ab89bf676c8fb6c9f0bffcff95f1b003ea418781d72bd9c38ac768` |
| `boot-settle.log` | `5f012300f8cae4e3cc868dc687ee49e23d287b2faa91b5db1cf2467e8015dafc` |
| `boot.log` (startup-only failure) | `c86594983c1a40752c047b5ff5ccf770afd7c4a639fbfada5f19e09bc1d396c5` |

Infrastructure note: một boot invocation không giữ session output nên không tính semantic evidence; captured direct boot invocation tiếp theo lỗi PostgreSQL `57P03 the database system is starting up` trước fixture assertions (exit1), không phải lỗi model implementation. Exact boot hypothesis sau scratch startup-settle wrapper chạy thành công như trên. Không đổi source để né failure, không tăng semantic fix-cycle counter do các sự kiện này.

Cleanup: hai successful container IDs ở trên đã được kiểm bằng `docker ps -a --quiet --no-trunc --filter id=EXACT`, exit0/output rỗng từng ID. DB fixture có finally close/drop; runner owns `--rm` container. Không claim exact-ID verification cho startup attempts không ghi fixture ID; không xóa container khác. Scratch files/logs sẽ bị xoá đúng root sau khi bằng chứng này được lưu; status cleanup được cập nhật ở dòng cuối.

## Retained UNVERIFIED và handoff

- Chưa có independent native/signed observer, live Claude/Codex/API capability/isolation proof hoặc process-wide Read/Bash/MCP/child/alias/network measurement. Missing actual surface không thành PASS nhờ body/fake trace; giữ Task7 gate.
- Test-only protocol admission/certificate nằm test DB. Không coi fake full-surface assertions hoặc selection policy fixture là native launcher RELEASE/certification authority. Normal certified path ở captured Task1 test trực tiếp gọi model service; production Phase06 claim/permit supplier vẫn chưa được triển khai/chứng nhận.
- Keychain write/read-back/fsync, old private-key retention, packaged signing/ACL, actual host DNS pin/redirect/SSRF behavior chưa được Task1 đo; giữ Task2/Task7/phase09 gate. Đây là ranh giới có chủ đích, không cộng finding vì thiếu live proof.
- Controller có thể dispatch **một batch FIX1** R1–R4 trong owner scope, giữ frozen001–007 và hard gates; sau sourcefreeze/checksum/evidence mới, review lại đúng batch. Không merge/deploy hoặc đánh dấu Phase04 hoàn tất từ review này.

Unresolved questions: không có câu hỏi cần owner để tái hiện/sửa bốn lỗi; lựa chọn cụ thể current provisioning operation policy ở R2 phải được chốt trong fix và docs.

Cleanup cuối: **PASS**. Xoá đúng scratch root `crew-model-review-uywiuy2u`, kiểm `exists=false`; current Docker snapshot đối chiếu20 worker IDs +2 successful reviewer IDs = **22/22 absent**. Chỉ file review này được thêm trong repo; không source/test mutation.
