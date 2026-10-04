# Review độc lập kế hoạch Phase 04 — runtime và model pool

Ngày 2026-10-02. Chỉ review tài liệu; không đọc/sửa source, chạy test, gọi model, thay credential/global config hoặc triển khai. Đối chiếu `phase-04-runtime-models.md` với design 2026-10-01, hợp đồng Phase02/005 và Phase03/007 đã đóng băng ở e3d35aa. Các dòng dưới tính trên bản plan 168 dòng được review.

**Verdict: CHƯA READY để giao triển khai.** Không thấy Critical được chứng minh. Có **7 Important** về đường chứng nhận, wire contract và tính bất biến/freshness cần chốt; không yêu cầu mở rộng nghiệp vụ hoặc sửa hợp đồng 005/007.

## Important

### I1 — Chứng nhận runtime đầu tiên bị vòng phụ thuộc vào chính certificate PASS

**Bằng chứng:** Phase04 dòng **85, 108, 146–147, 152**. Certificate cần nonce do server cấp và test `attemptId/fence` thực; `startReleased` từ chối certificate thiếu/expired và không RELEASE khi thiếu native surface; claim authorizer cũng yêu cầu isolation certificate. Task7 yêu cầu chính runtime chưa certified chạy task thật để tạo bằng chứng. Phase03 dòng **197, 212–214** bàn giao overall UNVERIFIED/disabled, không cung cấp certificate khởi đầu.

**Hệ quả:** Không có trình tự hợp lệ để cấp certificate đầu tiên. Fixture DB-backed ở dòng145 kiểm cùng gate; chỉ cấp permit fixture vẫn không qua `startReleased`. Worker phải tự nới gate hoặc bịa certificate PASS để chạy test. Nonce issuance/record/consume cũng chưa có producer hay wire contract trong Task1.

**Sửa hẹp:** Định nghĩa riêng admission cho certification harness trên test server/machine/project, có owner authorization, nonce server-issued dùng một lần, exact pair/binary/policy, scratch/canary, thời hạn và budget. Admission chỉ cho test attempt qua launcher/fence/companion hiện có, không làm pair eligible hay bỏ kiểm tra boundary; kết quả đầu ra chỉ thành certificate sau verifier. Chốt signature/route/schema nonce và test production từ chối mọi test admission. Không dùng fake PASS để phá vòng phụ thuộc.

### I2 — Gateway chưa có đường đọc desired model config để thực hiện sync

**Bằng chứng:** Phase04 dòng **85, 90, 95, 101, 145**. `SourceConfig` là input của host; route GET model-sources được ghi rõ là **owner**; machine chỉ có POST inventory/certifications/applied. `sync_models` còn là lựa chọn “command sync riêng hoặc … mở loại”, chưa chốt payload/producer/consumer. Phase03 dòng **73, 81** chỉ có GET `GatewayConfig` với hai workflow và gateway command enum đóng băng.

**Hệ quả:** Host dùng machine bearer không có hợp đồng lấy ba switches, explicit model list, endpoint/protocol/localHttp/revision. Offline reconnect không thể chứng minh đã đọc desired revision trước applied/dispatch; mỗi worker sẽ tự chọn endpoint hoặc dùng owner credential.

**Sửa hẹp:** Chốt một machine-scoped GET trả `SourceConfig` đã redaction, cùng typed `sync_models` payload tham chiếu revision, enqueue/supersede/ACK semantics và consumer ownership. Thay đổi enum nếu cần nằm trong migration008, không sửa007. Thêm test chỉ đúng machine đọc được, reconnect lấy revision mới trước báo applied, revision cũ không ACK thay revision mới.

### I3 — Probe receipt không mang identity cần thiết để thực hiện invalidation đã hứa

**Bằng chứng:** Phase04 dòng **54–61, 90** chỉ lưu model key, model config revision, runtimeVersion và evidence digest cho probe; không lưu source/projection/derivation identity hoặc binary hash. Dòng **18** tách workflow revision khỏi model revision, trong khi dòng **97, 101** yêu cầu projection derivation/hash hoặc binary đổi làm probe hết hạn. `assertModelDispatch` được giao kiểm exact proof tại dòng **152**.

**Hệ quả:** Probe PASS của projection A vẫn có modelConfigRevision đúng và TTL còn hạn sau khi workflow config đổi sang projection B. Một certificate mới của B không chứng minh model capability đã probe trên B. Server không có field/record được định nghĩa để xác định probeReceiptId ghim vào selection là stale; việc host tự refresh không đóng cửa lost/delayed update này.

**Sửa hẹp:** Thêm immutable probe context tương ứng các yếu tố plan thực sự muốn invalidate (ít nhất exact source/projection/derivation và binary identity, hoặc một context hash có canonical definition và record server đối chiếu). Claim so context receipt với selection/certificate/current observed binary, không chỉ model key/revision/TTL. Test đổi projection mà model revision không đổi, và đổi binary cùng version string: receipt cũ phải bị từ chối.

### I4 — Model inventory/applied thiếu quyền theo boot và thứ tự quan sát

**Bằng chứng:** Phase04 dòng **85, 87, 90** dùng `{configRevision,entries}` và `{attemptedRevision,sourceStatus,observationDigest}`, không `bootId/bootGeneration` hoặc observation sequence. Điều kiện advance chỉ so desired revision. Phase03 dòng **63, 65, 77, 81** đã chốt current-boot validation cùng machine-row lock, immutable historical replay và retired-boot rejection cho các quan sát tương đương.

**Hệ quả:** Boot A gửi PASS/applied chậm sau boot B báo AUTH/UNVERIFIED, với cùng desired revision. Đây là request mới nên idempotency không chặn; server receipt clock sẽ làm bằng chứng cũ có TTL mới và có thể nâng applied/available. Một delayed earlier observation trong cùng boot cũng có thể ghi đè lỗi mới hơn nếu catalogue lấy receipt mới nhất theo received_at.

**Sửa hẹp:** Cho model report dùng boot authority007 hiện có và monotonic observation identity/order; lookup committed receipt trước để replay không mutate, chỉ nhận report mới từ current boot và không thay current state bằng observation cũ. Receipt giữ server receipt TTL nhưng không được replay để gia hạn. Test A→B late PASS, cùng boot PASS→AUTH nhưng giao mạng đảo thứ tự, và exact historical replay. Không tạo một boot protocol khác.

### I5 — Secret provisioning chưa có wire contract đầu-cuối

**Bằng chứng:** Phase04 dòng **90, 98–100** chỉ định owner POST secret, ciphertext TTL/delete-after-ACK, key trong Keychain và “làm thêm pair-key negotiation” nếu phase03 chưa có. Route/schema migration008 không có key publication, machine nhận envelope, ACK, durable envelope storage/key identity hoặc rotation. Phase03 route inventory dòng **67–81** không cung cấp kênh đó.

**Hệ quả:** Worker server và broker không có hợp đồng chung để giao secret đúng máy/provider, xác thực public key, replay an toàn sau crash hoặc biết ACK nào cho phép xóa. Đây là luồng bắt buộc của API adapter, không thể hoàn thành chỉ bằng `CredentialBroker.put`. Bỏ trống binding của envelope còn dễ gắn ciphertext cũ/sai provider vào cấu hình mới.

**Sửa hẹp:** Chốt trong008 producer/consumer, machine-authenticated key registration/rotation, envelope metadata binding machine/provider/keyId/config revision/operationId/expiry, retrieval và durable ACK idempotent sau Keychain write; DTO response status-only, ciphertext-only storage/replay. Test wrong machine/provider/key, expired envelope, lost ACK/restart và key loss. Giữ CLI subscription isolated-home auth là gate thực tế như plan đã nêu; không dùng broker fake để tuyên bố đã hỗ trợ subscription.

### I6 — `executeFallback` thiếu chính dispatch authority mà mô tả bắt buộc nhận

**Bằng chứng:** Phase04 dòng **134** khai báo `executeFallback({priorAttemptId,next:ModelKey,decisionId}):Promise<void>`, nhưng ngay sau đó nói chỉ nhận command/permit/selection mới do phase06 ghi trước claim; dòng **138** cũng yêu cầu command+selection/modelChoice+permit mới. Frozen Phase02 dòng **97–100, 145** bắt buộc đầy đủ DispatchPermit, và Phase03 dòng **57–59** buộc selection khớp command/decision trước claim.

**Hệ quả:** Caller hiện không truyền commandId/permit/modelChoice. Không có resolver API/callback được định nghĩa để tìm duy nhất fresh command/permit từ decisionId. Worker phải tự tạo quyền còn thiếu hoặc tra/đoán command; cả hai phá handoff giữa phase04 và06.

**Sửa hẹp:** Chốt một chữ ký nhận immutable dispatch envelope đã persist bởi phase06 (command, frozen permit và references tới selection/modelChoice), hoặc inject typed resolver trả đúng envelope và kiểm quan hệ IDs. Không nhận `next` như nguồn authority độc lập. Test mismatched prior/decision/command/model choice và stale envelope không claim/start. Không đổi DispatchPermit005 hoặc companion007.

### I7 — Tool-call ID chỉ chống replay cùng call, chưa bảo vệ cùng effect qua fallback

**Bằng chứng:** Phase04 dòng **108** định danh intent bằng `{attemptId,fence,toolCallId,argsHash}` và dedup cùng toolCallId; dòng **127** kiểm duplicate continuation. Dòng **136, 138, 146** đòi đổi attempt/runtime sau side effect không lặp tool và giữ artifact, nhưng checkpoint chỉ mang toolReceiptIds và không có hợp đồng nối logical effect sang call ID mới.

**Hệ quả:** Attempt A ghi side effect và done receipt, mất phản hồi; fallback B nhận Crew checkpoint nhưng model/runtime mới phát tool-call ID khác cho cùng thao tác. Ledger của B xem là call mới; việc đưa receipt vào context không phải executor enforcement. Reconcile pending xử lý crash window của A, chưa chặn replay effect đã done dưới call ID mới của B.

**Sửa hẹp:** Chốt identity/idempotency/reconcile contract cho logical tool operation cần bảo vệ xuyên attempt, gắn receipt với workflow step/artifact/effect identity server hoặc broker kiểm được; call IDs chỉ là transport IDs. Tool không thể xác định an toàn cùng effect thì fallback giữ waiting/needs_input thay vì hứa exactly-once. Thêm test A side effect done→reply lost→B dùng call ID khác cho cùng effect; executor trả receipt đã đối chiếu hoặc dừng, không gọi effect lần hai. Không dedup mù theo argsHash vì hai thao tác hợp lệ có thể cùng arguments.

## Những phần đã nhất quán, không mở finding mới

- Explicit API model list, ba switches độc lập, desired OFF chặn fresh dispatch kể cả offline, ON không đồng nghĩa available; pool key phân biệt machine/runtime/provider/model (dòng16–18,46,87–90).
- SourcePin/ProjectionPin, command+decision selection/modelChoice trước claim, gated companion và giữ005/007 nguyên nghĩa được nối đúng về ý chính (dòng48,81,138,152). Phase06 production fail-closed là phân kỳ chủ ý, không phải lỗi vì chưa triển khai.
- Same-UID/HOME/skill allowlist/fake shell không được coi là security boundary. Native Read/tool/child/alias/network cần thực chứng; thiếu proof tiếp tục UNVERIFIED và không dispatch. Không đánh đồng tài liệu UNVERIFIED trung thực với runtime PASS (dòng20,108–110,146–148).
- Cancel ACK, expired lease, lost HTTP reply không phải stop proof; pending effect chưa reconcile giữ uncertain/guard; fallback không reset repair count, không tái dùng session khác runtime (dòng17,127,136–138).
- Live acceptance bounded trên scratch và quyền model/provider được owner cho phép; unsigned Keychain fake không chứng minh ACL package cuối (dòng19,98–101,146–148). Các gate đó không bị yêu cầu chạy trong lần review này.

Không có Minor cần nâng thành điều kiện chặn. Không chạy test nên báo cáo này không xác nhận implementation, model entitlement, CLI subscription auth hoặc isolation của bất kỳ runtime nào.
