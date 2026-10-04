# Independent scoped re-review — Task04/2 FIX1/5

**Candidate:** dd2a0e1ac78d06b75a1271100419c4b8cbe1c923. **Original:** f687fe3. **SPEC: NOT READY. QUALITY: NOT READY.** R1/R3/R4/R5/R6 CLOSED; R2 recovery core được sửa nhưng còn **một residual P2** trong state amendment. Không phát hiện P1. Đây là kết luận toàn batch FIX1 sau đọc đủ8file, không yêu cầu sửa từng phần khi review còn dở.

## Scope và binding

Đã đọc toàn bộ `task-2-review.md`, `task-2-fix1-report.md`, eight-file diff production/test/R3, protocol evidence,23-owned inventory và PM ledger (đặc biệt ruling16:31,16:50,16:57). Source scope là exact `task-only.patch`, không phải mọi thay đổi của toàn range chứa peer commits. Patch SHA256 **f9d1790ed346d1f5b0a050ce38c756750b1d13bf59cd4ccff8110107a8a9979b** khớp byte-for-byte `git diff f687fe3..dd2a0e1 -- <8 owned changed paths>`.

23/23 owned SHA khớp working files và `git show dd2a0e1:<path>`, kiểm lại sau canary còn nguyên.15own files khác không đổi. Migration008 vẫn checksum accepted `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f`. Producer server/native/current resolver không đổi trong FIX1. Reviewed frozen core556 và actual AtomicRecords/ProcessLock được đối chiếu byte không đổi. Không dùng peer7c7c719 HTTP retry hoặc attachment/ticket/010 trong canary hay suy kết quả từ chúng. Primary workflow giữ requesting-code-review template; không subagent, implementation hay Git mutation.

## Disposition từng finding

| Finding | Disposition | Evidence/giới hạn |
|---|---|---|
| R1 clock upper TTL | **CLOSED** | Upper bound giờ là anchor+elapsed+300000, lower/stale/backwards checks còn nguyên. Pure-clock regression và actual-crypto registration trả challenge trễ50ms; expired vẫn bị từ chối. Không đổi wall clock máy. |
| R2 automatic immutable ACK | **PARTIAL / OPEN** | Immutable hash/intent lookup trước fresh revision/expiry/provider checks; broker.assertStored vẫn trước HTTP; restart public sync có same body/key/ref và không rewrite secret. Current pending không còn được promote bởi historical ACK. Nhưng amendment bỏ lỗi mất current local ref ở public sync, finding bên dưới. |
| R3 config/boot snapshot | **CLOSED** | Snapshot config+boot trước collect; cloned input/workflow, captured canonical body trước journal await; sendApplied cũng capture trước read. Barrier tests giữ revision1/boot1 khi revision2/boot2 thắng, sequence vẫn monotonic per boot và replay không đổi body. |
| R4 SSE framing | **CLOSED** | Raw1MiB bound trước BOM/newline normalization, LF/CRLF/bareCR/mixed accepted cho cả protocol, thiếu blank-frame vẫn fail. |
| R5 Responses correlation | **CLOSED trong subset probe** | Bounded4096events/64indexes, lifecycle,response/item/call identifiers, function/text fragments và done đối chiếu completed; failed/incomplete/error từ chối; orphan/conflict/duplicates/missing-done negatives. Optional function status + response_id và nullable annotations được test riêng. Unsupported modalities vẫn fail closed; không claim full provider interoperability. |
| R6 safe transport codes | **CLOSED** | Closed TransportCode giữ outcome trong controlled send boundary rồi ném sau broker; arbitrary callback vẫn fixed/redacted. Actual broker/transport/prober offline loopback tests tool/model/size,401/429/503/network, DNS SSRF, single request và zero buffers. Không mở raw callback error escape. |

Đối chiếu primary protocol docs xác nhận function streaming variant có `response_id` và item không bắt buộc status ở ví dụ chính thức: [Function calling streaming](https://developers.openai.com/api/docs/guides/function-calling#streaming). Nullable annotation là variant được tài liệu liệt kê: [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events). Những checks này hỗ trợ đánh giá tương thích của parser, không chứng nhận model/runtime thật.

## Finding còn lại — R2-FIX1 [P2] Không được biến lỗi mất current local credential thành stored

**Exact location:** `v2/gateway/src/models/credential-provisioning.ts:342`–345, return348; pending khởi tạo330. Đây là changed lines của FIX1.

Sau lost ACK, server có thể đã commit chính operationA và GET desired báo provider `stored`, còn host giữ queued envelope/ACK intent vì chưa nhận receipt. Nếu local generic-password của **chính current refA** mất trước reconnect, `accept` gọi `replayAck` rồi `broker.assertStored` ném `CREDENTIAL_MISSING` đúng. Catch mới tại342–345 chỉ đặt pending khi server status khác stored, nên bỏ lỗi local vừa quan sát, giữ queue và vẫn trả `{state:'stored'}`. Mục đích không để historicalA demote currentB là đúng, nhưng implementation chỉ biết provider status nên không phân biệt historical ref khác với **current ref đang thiếu**.

Ảnh hưởng: đường reconnect public báo sync credential thành công thay vì pending/error/re-entry dù credential cần dùng không còn local và ACK recovery chưa hoàn tất. `CurrentCredentialResolver` vẫn chặn request vì assertStored; **không phải dispatch/secret leak bypass**. Lỗi là trạng thái phục hồi và chẩn đoán sai, đủ P2, không P1. Nó liên quan trực tiếp invariant R2 “missing local ref must reject”; test FIX1 chỉ kiểm `accept` trực tiếp sau remove và chưa kiểm kết quả public sync cho cùng current lost ref.

**Proof mới, bounded offline:** `task-2-fix1-review-canary.mjs` dùng actual CredentialProvisioning/CredentialBroker/unchanged556 AtomicRecords/ProcessLock, fake SecurityBridge chỉ giữ provisioning key hợp lệ. Fixture seed đúng dạng persisted pending envelope + immutable ACK intent + confirmed key để biểu diễn post-write/lost-receipt history; generic current credential không còn. Không decrypt fixture ciphertext, không tạo ACK intent từ network, không server/PG test trong lượt này. Direct replay cho `CREDENTIAL_MISSING`; cùng state qua **syncPending** trả `stored`, queued envelope vẫn còn, HTTP calls=0. Log `task-2-fix1-review-canary.log` giữ exact output/cleanup.

**Exact tuple và negative control:** cả hai nhánh dùng machine `6df206a7-d467-4ec0-a439-90300cacbb35`, provider `c401408c-2b16-4bb9-8e94-8e59ff4ac77d`, revision1, endpoint `https://fixture.example/v1/`, protocol `responses`. Ref là exact `machineId_providerId_envelopeId` theo bảng:

| Nhánh | Queued envelopeA / operationA | Current binding | Local | Actual public result |
|---|---|---|---|---|
| Same-current bị mất | `ae1ce21f-d1ce-4220-8466-a4707575fc30` / `c6e25e17-4432-4c06-a8b1-4a785819d410` | Chính refA / operationA | A thiếu | `stored`, queue còn,0HTTP — sai |
| Negative historicalA/currentB | Cùng A và operationA | EnvelopeB `75fde2c9-893b-4dc4-a1c4-efc7b536fdf0`, operationB `4d6ac854-5ed2-46ed-932d-6ff9944be706` | A thiếu; `broker.assertStored(refB)` PASS | `stored`, queueA còn,0HTTP — cần giữ |

Current-binding object là fixture của read port có cùng public contract, **không là live server evidence**. Log giữ full exact refs. Actual `syncPending` chỉ đọc `/v2/machine/model-sources` và `/v2/machine/api-secret-envelopes?after=1`; không đọc current-binding port ở cả hai nhánh. Vì vậy hai trạng thái authority khác nhau nhưng public method hiện chỉ thấy cùng server `stored`. Negative control ngăn sửa bằng cách blanket-demote mọi historical replay failure. Có thể dùng readonly current-binding producer/resolver đã thuộc Task2; không cần server authority/schema mới.

**Correction direction:** phân biệt failed historical ref và current binding bằng authority metadata hiện có; chỉ bỏ lỗi historyA khi currentB được xác nhận đủ (bao gồm local availability phù hợp), không suy current từ UUID/cursor/ACK success. Với same-current ref missing, public result phải pending/error hoặc ném mã an toàn; queue/history vẫn giữ, không mint receipt hay tự xoá server state. Không cần sửa008/009/010, producer schema hay quyền dispatch. Không bỏ amendment current-pending: historical ACK thành công không được promote credential mới.

**Regression bắt buộc:** (1) server storedA + local refA mất + lost ACK queueA → public sync báo pending/error, HTTP ACK không được gửi, history giữ; (2) stale/lost historyA + currentB stored và localB có thật → không hạ B; (3) pendingB + historical ACKA thành công vẫn pending tới fresh current authority xác nhận B. Kèm restart/same-key/body replay và altered-envelope/missing-intent negatives đã có.

## Captured verification và giới hạn

Đọc command JSON/log/stability, không chỉ dựa report:

- RED24:18pass/6fail,exit1; GREEN24/24,exit0.
- Compat RED25:24pass/1fail; compat GREEN25/25.
- State RED25:24pass/1fail; preflight26/26 + types0.
- **Final frozen556+own23:113/113 PASS**,0fail/cancel/skip,75087.122792ms; explicit17-test-file manifest. Build/typecheck/Biome15TS exit0. Source stability238files0delta; final own23 SHA exact. Đây là một standalone run, không cộng kết quả cũ.
- Không chạy lại full server; current-binding4test/PG thuộc evidence candidate trước, không gọi fresh FIX1 PG PASS. Replay tests mới dùng baseline556 HTTP journal và fake authenticated wire, actual crypto/journal fsync; không là newly executed server integration.
- Original server218/219 EPIPE và repaired f58 whole-case1/1 vẫn riêng. Original gateway103/104 ECONNREFUSED và unchanged narrow1/1 vẫn lịch sử; final113PASS không chứng minh root cause baseline đã sửa.93/104 build-preparation failure vẫn giữ.
- PM docs all/staged/root/canonical checks đã ghi trong ledger; reviewer kiểm own R3 diff không mở manifest/source ngoài scope.

## Cleanup và quyền thao tác

Worker ghi7nonce snapshot roots đã removed với device/inode/uid receipts; fixture verification ghi5roots mỗi lượt đầu, final6roots và4fake helper reaped. Historical zQeH26/DTjkSU vẫn RETAIN. Lượt review không tạo container/native helper/provider call hay sửa owner/global/shared state.

Reviewer tạo report/canary/log với hai lượt bounded: initial nonce `e1d53d45-ca9e-41d0-aef0-bc8208e8fce8`, dev16777229/ino63860327/uid501, lock PID53483; lượt bổ sung exact current tuple và negative control nonce `2c449801-f697-43ad-b5c8-f14e4ef027e0`, dev16777229/ino63863047/uid501, lock PID64412. Cả hai lock release/reaped rồi ESRCH; từng root kiểm đúng identity trước remove và ENOENT sau remove. Bản đầu được giữ nguyên ở `task-2-fix1-review-canary-initial.mjs/.log`; bản cuối ở `task-2-fix1-review-canary.mjs/.log`. Không network listener,0HTTP trong cả hai lượt; source23SHA còn nguyên sau canary. Không dùng broad rerun.

Evidence SHA256 sau lượt cuối;23/23 owned current/candidate SHA đều khớp:

- `task-2-fix1-review-canary-initial.mjs`: `dcbcaff5da407ef1e0cde4082b2d35118b27b4a6c057b55b3e6662a8c2bf6df8`.
- `task-2-fix1-review-canary-initial.log`: `cbe2b337ada6706b05ca42d06a5ade5d45c6f435ac90598d67ff7805de958688`.
- `task-2-fix1-review-canary.mjs`: `ddc83fc868226789e38506835db1deb2358df41630c5dc9f8aab92e725052583`.
- `task-2-fix1-review-canary.log`: `6b8a5cdf9ca2cd9657c5a8ba73b30aba5df27df51337e4440deb6bd98003b406`.

## Declined to judge / handoffs

- Chưa cấp chứng nhận signed Keychain/native helper/fulltree/CLI auth/live tools/vision/cost; ports và offline fixtures không đủ authority. Giữ gate phase09/runtime như original review.
- sync_models command composition và callCurrent integration vẫn later approved handoff, không lấy report/provisioning state làm permit.
- Completed-only Responses compatibility giữ hành vi cũ theo FIX1 scope; parser text/function subset không được quảng cáo là hỗ trợ mọi modality/provider event. Không mở requirement mới về multimodal stream ở vòng scoped này.
- Current binding là sampled snapshot, không atomic network lease; không yêu cầu lease ngoài scope.
- Peer transient-retry producer, attachments/tickets/010 không thuộc candidate canary, không xét nghiệm thu ở đây.
- Baseline flake/root-cause và cleanup thiếu initial receipts giữ disposition cũ, không đổi thành own finding.

**Cần tiếp theo:** sửa duy nhất residual R2-FIX1 trên cùng semantic review history, giữ năm finding đã CLOSED và các regression hiện có; scoped re-review trước acceptance. Không có câu hỏi cần owner; PM phân xử state distinction theo authority hiện có.
