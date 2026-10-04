# Independent review — Phase04 Task2 / candidate f687fe3

## Kết luận

**SPEC: NOT READY. QUALITY: NOT READY. Ready to merge: No.** Có **6 finding P2, 0 P1** trong source Task2, đã gom thành một batch hoàn chỉnh R1–R6 dưới đây. Không triển khai sửa trong lượt review. Không suy cả phase04, gateway production, Keychain/signing hoặc live runtime READY từ các test protocol.

Candidate có ranh giới authority rõ: current credential metadata đọc trực tiếp snapshot008; resolver so desired/binding/ref mới; OFF và thiếu proof mặc định từ chối; credential qua callback trusted với buffer cleanup; server vẫn sở hữu admission/certificate/clock. Các lỗi còn lại nằm ở kết nối giữa các phần đã có: thời gian challenge, automatic replay, concurrency report và validation/error propagation của stream/transport.

## Phạm vi và source binding

- Worktree: `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`; candidate **8035453..f687fe3**, chưa nghiệm thu. Đã đọc full source/test của original16 và extension7, cùng manifest/generated additions, không chỉ endpoint mới.
- `task-2-evidence/current-credential/pm-task2.diff` **khớp byte-for-byte** `git diff 8035453..f687fe3 -- <23 owned paths>`; full commit có thêm ba mapping/generated files, tổng26. Diff không bao gồm active Task5 FIX1/attachment peer changes.
- 23/23 SHA trong `final-owned-source-inventory.json` khớp working files **và** `git show f687fe3:<path>` đầu review, còn khớp sau canary. Migration008 còn `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f`.
- Đọc actual approved Task2/common phase04 contracts, spec mục4–8/12, `task-2-brief.md`, `progress.md`, **toàn bộ** `task-2-report.md` (current binding + original16 history), root/v2 docs index, gateway-models/server-models flows và PM ledger rulings15:34/15:39/15:57/16:14. `.codegraph` không có tại worktree này. Workflow review theo `requesting-code-review/SKILL.md` và `code-reviewer.md`; không spawn subagent.
- Dependency inspection dùng **556cd8d** cho HttpOperationJournal qua readonly `git show`; AtomicRecords, ProcessLock, host status được đối chiếu không đổi giữa556 và candidate. Không đọc/tiêu thụ active Task5 HTTP journal/bridge/sync implementation như phần candidate.
- PM doc-heading amendment chỉ đưa gateway-models về bảy heading canonical, giữ nội dung; after SHA `278f1e...579` khớp inventory/report. Manifest có toàn bộ new model source/test/native fake C/resolver, server current-binding test. Không phát hiện production change ẩn trong amendment.

## Findings — một batch sửa đầy đủ

### R1 [P2] So upper expiry với thời điểm receipt cũ làm challenge hợp lệ bị từ chối

**Vị trí:** `v2/gateway/src/models/credential-provisioning.ts:40` (`assertFresh`, context30–42); caller registerKey174 / syncPending315,330. Producer accepted `v2/server/src/models/secret-envelopes.ts:91` và `helpers.ts:33` phát challenge expiry bằng thời điểm registration +300000ms.

`assertFresh` dùng `anchor.server + elapsed` cho lower bound nhưng upper bound lại dùng `anchor.server +300000` không cộng elapsed. Luồng thật `syncPending` GET batch/serverTime rồi mới POST register key. Challenge sinh sau GET vài ms có expiry vượt upper bound dù còn đúng TTL5phút, nên registration/rotation báo `SECRET_EXPIRED`; sync trả pending cho một key hợp lệ. Receipt mới ở lần sync sau có thể cứu được, nên không gọi đây là lỗi vĩnh viễn/P1, nhưng lần đăng ký bình thường bị báo sai và phải retry không cần thiết.

**Proof:** canary `clock`: receipt T, elapsed50ms, expiry T+300050ms (còn300000ms) → `SECRET_EXPIRED`. Đây là pure actual `ServerReceiptClock`, không sửa clock toàn máy. Test hiện tại cố định receipt/challenge cùng timestamp nên bỏ sót.

**Sửa/Regression:** tính upper bound từ ước lượng server hiện tại hoặc dùng receipt thời gian authenticated của registration đúng semantics, vẫn từ chối expired/invalid/stale anchor, không dựa wall clock host. Regression mô phỏng GET→registration có độ trễ, fresh challenge thành công ngay; giữ tests backwards receipt, expiry thật và không gia hạn bằng replay.

### R2 [P2] Reconnect không gọi đường replay ACK đã durable khi envelope hết hạn/đổi revision

**Vị trí:** `v2/gateway/src/models/credential-provisioning.ts:213`–219 và `:338`.

`accept` kiểm current revision/expiry trước khi đọc persisted AckIntent. `syncPending` luôn gọi `accept` cho queued envelope, không chọn `replayAck`. Nếu secret đã write/read-back, ACK đã được server commit nhưng reply bị mất, host reconnect sau expiry hoặc revision đổi sẽ từ chối tại213/214 trước mọi replay HTTP. Queue cũ tiếp tục pending dù explicit `replayAck(envelopeId)` đã được triển khai đúng và có thể nhận immutable historical receipt. Khi server không trả envelope đã ACK nữa, queue là nguồn hồi phục duy nhất, nên public reconnect path phải dùng intent đó. Lỗi này khác trường hợp envelope mới chưa từng có intent: trường hợp ấy vẫn cần fail closed.

**Proof:** canary dùng actual provisioning/AtomicRecords, actual X25519/HKDF/GCM với fake bridge và in-memory HTTP port: lần sync đầu lưu intent rồi mất reply; elapsed300001; sync tiếp theo trả pending và tổng ACK calls vẫn1; gọi explicit `replayAck` gửi call2 thành công. Không claim canary đã chạy DB/server HTTP; việc không phát request ở reconnect được chứng minh độc lập với server. Captured tests chỉ gọi replayAck trực tiếp sau expiry, không qua syncPending.

**Sửa/Regression:** lookup/validate immutable intent cho queue trước fresh-envelope checks, replay đúng original operation/body/key/ref và để server quyết định receipt lịch sử/current reauth; chỉ xóa queued ciphertext sau accepted ACK. Không giải lại/ghi lại secret, không mint intent hoặc tự đổi current provider. Test lost committed ACK→close/reopen→expiry/revision change→**syncPending** tự recover; intent thiếu, altered envelope và credentialRef không còn phải từ chối. Giữ lịch sử expired/key-lost chưa ACK để owner re-entry có nghĩa, đừng cho history cũ chặn state của current credential mới mãi.

### R3 [P2] Hai reconnect chồng nhau gắn observation cũ vào desired revision mới

**Vị trí:** `v2/gateway/src/models/model-reporter.ts:39`–44, `:47`, `:82`–83.

`reconnect` lưu desired vào mutable field, clone cho collect, nhưng sau `await collect` lại gọi sendInventory/send lấy **field hiện tại**. Một reconnect thứ hai có thể đổi field sang revision2 và gửi observation mới; khi collect revision1 hoàn tất, nó được đóng envelope revision2/sequence mới hơn. Điều này phá quan hệ observation↔config: ví dụ endpoint/auth đổi nhưng model ID giữ nguyên thì membership check vẫn qua, observation trước thay đổi bị gắn nhãn current và có thể thay latest report. AtomicRecords chỉ serialize sequence allocation, không serialize vòng GET/collect/config binding.

**Proof:** canary reporter dùng real AtomicRecords và barrier: collect1 nhận revision1; reconnect2 revision2 gửi trước; nhả collect1 → body `old-observation` được journal/send với `configRevision:2, sequence:2`. HTTP port fake chỉ capture wire; không claim report với fixture context tối giản được server accept. Source path chứng minh không có revision binding còn lại.

**Sửa/Regression:** serialize whole reconnect/report scope hoặc truyền immutable config+boot snapshot xuyên collect/validation/envelope; stale collection phải gửi đúng revision cũ để server reject hoặc bị superseded rõ ràng, không relabel thành mới. Barrier test với valid actual model/pair và same model ID nhưng endpoint/revision đổi; thêm boot change trong lúc collect và giữ exact replay identity/shared monotonic sequence.

### R4 [P2] Parser từ chối SSE hợp lệ dùng CRLF trước khi normalize

**Vị trí:** `v2/gateway/src/models/probe.ts:322`, normalization tại332.

Guard `text.endsWith('\n\n')` chạy trên raw text, trong khi normalization `\r\n`→`\n` chỉ làm sau đó. Stream kết thúc frame bằng CRLF CRLF luôn bị `STREAM_PROTOCOL`; compatible provider gửi framing này không thể hoàn tất probe mặc dù nội dung/model/terminal hoàn toàn giống bản LF.

**Proof:** canary `sse-crlf`: cùng completed Responses event, LF được parse đúng; đổi toàn bộ line ending sang CRLF thì bị từ chối. Không network/provider/live call.

**Sửa/Regression:** normalize accepted SSE line endings trước framing checks (vẫn giữ raw byte bound), kiểm LF và CRLF cho cả Responses/Chat, mixed chunks nếu parser nhận chunked input về sau, thiếu blank terminator và oversized input vẫn fail. Không bỏ terminal/model/tool validation để nhận CRLF.

### R5 [P2] Responses stream bỏ qua failed event và mọi tool-fragment correlation

**Vị trí:** `v2/gateway/src/models/probe.ts:350`–356.

Ở nhánh Responses, mọi type bắt đầu `response.` ngoài completed đều bị bỏ qua. Parser không correlate response/item/output indexes, không kiểm tool argument fragments, không nhận failed/incomplete làm terminal lỗi. Một stream có orphan tool delta và `response.failed` cho model khác vẫn được coi hợp lệ nếu cuối cùng có một `response.completed` có body đúng. Trái contract strict framing/model/tool correlation; transport sau đó trả `streamed:true`, nên downstream measurement có thể xem stream hỏng là stream đã kiểm thành công. Đây chưa phải chứng nhận dispatch: server/live trusted observer gate vẫn riêng.

**Proof:** canary `sse-correlation`: `response.function_call_arguments.delta` với item_id unknown/output_index99/invalid delta, tiếp theo `response.failed` model wrong, rồi completed body chosen → parser trả success. Test hiện có chỉ completed-only/thiếu terminator/wrong model ở completed; chưa kiểm chuỗi event Responses.

**Sửa/Regression:** state machine bounded correlate response và output item/function call, so fragments với completed result; failure/incomplete/error terminal phải reject success tiếp theo, unknown/orphan/conflicting fragment fail. Giữ các event metadata hợp lệ được allowlist rõ, không reject mọi provider event tùy tiện. Positive multi-fragment tool/text + negative orphan/duplicate/mismatched response/model/failed→completed tests.

### R6 [P2] Broker làm mất error code an toàn của pinned transport

**Vị trí:** `v2/gateway/src/models/credential-broker.ts:94`–95; consumer `provider-transport.ts:233` và `probe.ts:265`–280.

`PinnedProviderTransport.deliver` ném các mã đã đóng như TOOL_PROTOCOL/MODEL_MISMATCH/RESPONSE_TOO_LARGE/SSRF_DENIED, nhưng đi xuyên `withSecret` bị thay tất cả bằng CREDENTIAL_TRANSPORT_FAILED. ModelProber không nhận mã này nên đổi thành TRANSIENT/unverified. Thực tế malformed tool không ra TOOL_PROTOCOL như spec/docs; lỗi protocol/SSRF bị biểu diễn thành lỗi mạng tạm thời, mất nguyên nhân xử lý và có thể khiến scheduler tương lai retry sai. Cần giữ redaction chặt cho arbitrary callback/bridge messages, không đơn giản rethrow Error từ callback.

**Proof:** canary `transport-classification` gọi **actual PinnedProviderTransport + CredentialBroker + ModelProber offline**, một owned loopback HTTP reply200 có invalid tool arguments. Kết quả `errorCode:TRANSIENT,status:unverified`, expected TOOL_PROTOCOL; đúng1request. Không dùng authorized-live port, credential chỉ fixture map.

**Sửa/Regression:** phân tách transport outcome bằng typed/closed result hoặc giữ safe error trong trusted transport operation rồi trả sau broker callback; arbitrary callback errors vẫn mã cố định và không leak body/key. Integration regression actual broker/transport/prober cho malformed tool, wrong model, size limit và safe SSRF outcome; 401/429/network vẫn classification đúng, no retry và cleanup buffer giữ nguyên.

## Evidence đã kiểm và giới hạn

| Capture | Kết luận chính xác |
|---|---|
| Original16 frozen235source |100/100,0fail/skip/cancel; build/typecheck0. Đọc command manifest/log/stability; không chạy lại broad |
| Extension focused server/gateway |4/4 mỗi phía; original server RED404 và gateway RED NOT_IMPLEMENTED được giữ |
| Frozen server25files through008 |218/219,1existing HTTP upload EPIPE. Narrow old whole case cũng fail; không quy lỗi này cho current-binding |
| Reviewed f58 context overlay |3 helper/test/doc hashes khớp f58f27d, actual >1MiB valid import/both413/SSE whole case1/1. Không biến thành219PASS |
| Gateway preparation error |93/104 với11 missing compiled entrypoint failures được ghi rõ; là infrastructure preparation, không bị che |
| Final compiled gateway17files |103/104,1existing host lifecycle ECONNREFUSED; own27PASS. Whole unchanged lifecycle narrow1/1 chỉ chứng minh intermittency, chưa xác minh stale-socket root cause; không biến thành104PASS |
| Final assertion-only cleanup |focused4/4 + gateway strict types0;19TS Biome0warning. Final test SHA đã cập nhật; không cần broad lặp chỉ vì assertion cleanup |
| Current source stability |238source gateway unchanged; server chỉ exact3f58 context overlay; working owned files unchanged.23final SHA kiểm lại sau review |
| Native |Objective-C syntax/link evidence đã có, source không đổi; binary signed/actual Security.framework/owner Keychain execution chưa kiểm |

Reporter/provisioning canary dùng actual new Task2 classes, actual unchanged556 AtomicRecords/ProcessLock, fake HTTP/Keychain ports; không dùng active peer HttpOperationJournal source. Canary parser/clock thuần và một bounded HTTP loopback riêng; không paid call/remote model/owner Keychain. File `task-2-review-canary.mjs`, log `task-2-review-canary.log`, command `node plans/261002-0002-crew-v2/execution-phase04/task-2-review-canary.mjs`; log có6 confirmed defect observations và complete. Đây là chứng minh lỗi có chủ đích, không là bộ regression GREEN của candidate.

Canary SHA256 `6c7f1d40d6b02f4f6b4f05b7c67f53516ed7ff3055135e8be9efad0e7fcaa28b`; log SHA256 `6826edb206fd39cd3d61e0bbc3a0fad658917e5d5d858db8ab6d98aba5afa3fe`.

## Cleanup và quyền ghi

Reviewer chỉ tạo report/canary/log này trong execution-phase04 và một tmp root nonce `dd9bd0c1-e1e3-4621-81a3-b66e9f8f605b`. Root exact dev16777229/ino63741507/uid501 đã kiểm identity, xóa sau đóng journals và kiểm ENOENT. Two lock-holder PIDs30620/30622 đã release/ESRCH; listener127.0.0.1:58812 đóng, không request khác. Không tạo DB/container/helper native, không sửa source/index/HEAD/branch/global config/shared service.

Worker evidence giữ8snapshot removed/8fixture roots removed/8fake helper reaped; review kiểm lại8snapshot paths absent. Four known container absence receipts đã đọc, không tự chạy docker prune/khẳng định scope không có receipt. Old narrow HTTP container không có initial exact ID receipt vẫn UNKNOWN. Hai initial RED roots zQeH26/DTjkSU giữ nguyên theo PM; reviewer không xóa theo prefix. Không suy PID absence hiện tại là creation provenance của quá khứ.

## Handoffs / advisories / Declined to judge

Những mục dưới đây đã xem xét nhưng không tính thành finding own Task2; PM cần giữ gate tương ứng:

- **Host composition + sync_models routing/applied ACK:** explicit later handoff đã duyệt. Module chưa wired, không fake applied. Composition phải dùng callCurrent, không dùng explicit-ref call để giả current authority.
- **Live tool/vision/cost observation, CLI isolated subscription auth và full native isolation:** trusted measurement ports/default UNVERIFIED hợp scope; fake fixtures không chứng nhận actual entitlement, live tool execution, image input hay dispatch.
- **Phase05 verified derivative/provenance:** producer chưa accepted, nên không ép MIME native/không fabricate extraction authority; integration phải được review sau producer.
- **Phase09 signing/helper ACL:** helper default-deny và loaded-PID gate hợp boundary; chưa chạy actual Keychain/native signed package, không coi boolean fixture là proof. Packaging needs genuine identity/signing verification, không thay bằng caller-controlled boolean.
- **Current credential snapshot races sau read:** sampled authority đã PM chấp thuận15:39; rechecks trước header/sau response hữu ích nhưng không atomic network lease. Không yêu cầu triển khai lease mới ngoài scope.
- **Low-level explicit-ref call:** trusted harness port đã được PM nêu rõ; fresh consumer phải đi resolver/callCurrent. Không đánh đồng tồn tại port đó với một renderer/child bypass đã chứng minh.
- **Known baseline transient HTTP journal response caching:** inspected556 replay trả cached non2xx; PM đã giao Task5F2 additive retry history riêng. Không quy producer defect đó thành seventh own Task2 finding. Integration phải consume producer đã reviewed và quyết định bounded retry cho model register/confirm/report/ACK; không claim active peer fix đã giải quyết ở candidate này.
- **HTTP EPIPE + host ECONNREFUSED:** captured baseline limitations như bảng trên; không có bằng chứng do Task2 gây ra. Full host acceptance vẫn chưa đóng, narrow PASS không là root-cause resolution.
- **Historical cleanup lacking original receipt:** đúng retention ruling; không tự dọn hay thêm finding source khi ownership chưa chứng minh.
- **Documents:** new canonical headings/map phù hợp; docs mô tả intent chính xác về gate, nhưng các claim strict SSE, malformed tool classification và automatic recovery cần theo R1–R6 rồi cập nhật cùng sửa. Không có finding riêng chỉ vì report ghi IMPLEMENTED CANDIDATE.

## Gate sau sửa

Trả R1–R6 cùng lúc cho implementer, một semantic fix batch; meaningful focused regressions theo từng trigger và một covering đúng frozen candidate sau last production edit. Giữ source/evidence binding, không mang unfinished peer source hoặc baseline failure thành union PASS. Re-review phải đóng cả SPEC lẫn QUALITY trước Task2 accepted.

Câu hỏi chưa giải quyết: không có câu hỏi cần owner để thực hiện batch. Handoff/gate ngoài scope ở trên vẫn chờ PM/producer tương ứng.
