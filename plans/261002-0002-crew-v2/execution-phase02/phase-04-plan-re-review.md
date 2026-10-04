# Phase 04 — independent plan re-review, fix round 1

Ngày 2026-10-02. Phạm vi chỉ tài liệu: đối chiếu bảy Important của `phase-04-plan-review.md`, mapping `phase-04-plan-fix.md` và bản `phase-04-runtime-models.md` 225 dòng. Nguồn ràng buộc là spec `docs/superpowers/specs/2026-10-01-crew-v2-design.md`, hợp đồng kế hoạch Phase02/005 và Phase03/007; đã tính addendum reconnect read routes của cb32f79. Không đọc/sửa source, chạy test, gọi runtime/model hoặc thay credential. Báo cáo này không chứng nhận implementation upstream hay runtime.

**Verdict: CHƯA READY để freeze/giao triển khai.** Năm finding gốc **ADDRESSED**, hai finding **NOT ADDRESSED** hoàn toàn; còn **3 Important** cần sửa hẹp, gồm một mâu thuẫn hợp đồng mới do fix. Không có Critical được chứng minh.

## Đối chiếu I1–I7

Các dòng Phase04 bên dưới thuộc `plans/261002-0002-crew-v2/phase-04-runtime-models.md`.

| Finding gốc | Kết quả | Contract và ca âm đã kiểm |
|---|---|---|
| I1 — certification bootstrap | **NOT ADDRESSED** | Đã có challenge, scope/budget, admission riêng và production deny (71–80, 126–131, 139, 162, 202–204), nhưng companion policy vẫn bị ràng buộc challenge chưa dùng sau khi claim tiêu nonce. Xem R1. |
| I2 — machine desired config/sync | **ADDRESSED** | GET machine-scoped trả redacted SourceConfig; owner PUT enqueue `sync_models`, migration008 mở enum, consumer GET trước sync/reconnect, received/completed/supersede rõ (126, 132, 138, 141, 148, 152). Ca âm wrong/revoked machine, stale revision ACK, partial retry và reconnect đọc mới có ở132. |
| I3 — probe identity/invalidation | **ADDRESSED** | ProbeContext chứa exact source/projection/derivation/binary/policy/OS, canonical hash cùng immutable receipt; claim đối chiếu selected pair/cert/current observed binary (54–65, 122, 133, 138, 140). Có ca âm projection đổi mà model revision giữ nguyên, binary bytes đổi mà version string giữ nguyên và hash/object mismatch ở133. |
| I4 — boot/order authority | **NOT ADDRESSED** | Report envelope/current boot lock/shared sequence/immutable replay và TTL đã rõ (66–70, 122, 134, 139–140, 148, 152). Tuy nhiên applied có thể tham chiếu một inventory cũ trong cùng boot/config; hai GREEN còn mâu thuẫn việc error có advance applied. Xem R2. |
| I5 — secret provisioning wire | **ADDRESSED** | Có key registration/challenge/confirm, envelope metadata/AAD, machine retrieval, durable Keychain write/read-back và ACK, ciphertext deletion cùng immutable replay, rotation/key loss (83–89, 135, 142–143, 151–154). Ca âm wrong machine/provider/key/revision/AAD/expiry, lost ACK/restart, key loss và plaintext leak đều được chỉ định. Đây là contract/test plan; chưa chứng nhận crypto hoặc packaged Keychain ACL. |
| I6 — fallback dispatch authority | **ADDRESSED** | `DispatchEnvelope` thay raw next/decisionId; phase06 persist command/decision/selection/modelChoice/priorAttemptId và permit, consumer đọc lại trong transaction (81–82, 120, 190, 193, 195, 209). Có ca âm missing/mismatched/stale envelope và không claim/start ở193. Riêng phép kiểm `permit.fence` mới được thêm là structural breakage N1 bên dưới. |
| I7 — logical effect xuyên attempt | **ADDRESSED** | Có server stepOperationId per logical operation, canonical effectId, durable ledger/transport binding, target idempotency/reconcile và fail-closed khi không định danh/chứng minh được effect (94–106, 160, 163, 166, 181–185, 194–195, 209). Ca âm A done→reply lost→B call ID mới vẫn counter1; pending không replay; logical operation khác cùng args vẫn chạy; thiếu stable ID thì wait. |

## Important còn lại

### R1 — I1: chưa tách nonce admission một lần khỏi companion authorization sau claim

**Bằng chứng:** Phase04 **128** yêu cầu cả “Test-only AuthorizeDispatch và GatewayProjectionPolicy” chấp nhận duy nhất command/decision mang cùng challenge **chưa dùng**, rồi “Consume nonce atomically khi claim”. Phase03 **59, 78, 83** gọi GatewayProjectionPolicy để tạo companion **sau claim**, trước RELEASE. Phase04 **162** lại cho launcher nhận nonce đã consume ở claim; migration008 **139** đã có `state='admitted'` và `attempt_id` nhưng chưa quy định companion dùng trạng thái này thay điều kiện chưa dùng.

**Đường lỗi:** challenge issued → claim tiêu nonce và tạo attempt A → POST companion chưa có row → policy nhìn challenge đã dùng và từ chối. Test full path ở131/202 đang kỳ vọng RELEASE, trong khi hợp đồng policy ở128 không cho phép đường đó. Worker sẽ phải tự chọn bỏ một điều kiện mới chạy được bootstrap.

**Sửa hẹp:** Chốt state machine: chỉ authorizer của **fresh claim** nhận `issued`, chuyển atomically sang `admitted` và bind exact command/decision/attempt/process identity; companion của **chính attempt đã admitted** kiểm binding/evidence claim, không tiêu nonce lần nữa và không yêu cầu issued. Replay claim/companion đúng identity trả original result; challenge admitted không cấp attempt khác. Giữ production deny và 005/007 nguyên nghĩa.

**Ca âm/acceptance cần ghi rõ:** Sau lost claim reply, replay lấy A rồi companion+RELEASE của A thành công với nonce đã consume; dùng cùng challenge cho command/attempt/process khác bị deny. Test phải đi qua policy hook thật của fixture, không bỏ qua companion.

### R2 — I4: sequence của applied không bảo đảm inventory tham chiếu là quan sát mới nhất

**Bằng chứng:** Phase04 **139** chỉ buộc `inventoryReportId` là accepted report cùng current boot/config, digest/sourceStatus khớp. Các test **134** chỉ từ chối inventory thuộc boot cũ, revision khác hoặc digest khác; chưa có report cũ cùng boot/config. Đồng thời **138** nói enabled nhưng lỗi vẫn báo applied config, trong khi **139** nói partial/**error** giữ applied revision cũ; **141** chỉ completed sau accepted applied revision.

**Đường lỗi:** Trong cùng boot/config, inventory seq1 PASS đã accepted; seq2 AUTH đã accepted; applied seq3 tham chiếu seq1, digest và sourceStatus đều khớp seq1. Applied seq3 có sequence lớn nhất, nên không vi phạm monotonic check, nhưng có thể báo ready/applied và ACK sync từ observation đã bị seq2 thay thế. `getPool` lấy inventory mới nhất ở140 giúp không chọn AUTH thành available, nhưng không sửa sự sai lệch applied/ACK, và không thay thế hợp đồng chặn old inventory.

**Sửa hẹp:** Dưới machine-row transaction, fresh applied phải bind **latest accepted inventory của current boot/config**, không chỉ một accepted inventory bất kỳ. Một inventory mới làm applied dựa trên inventory cũ không còn là current sync evidence; historical replay vẫn trả response cũ không mutate. Chốt duy nhất semantics enabled+error: cấu hình đã áp dụng nhưng source unavailable, hoặc giữ pending; đồng bộ quy tắc này ở138/139/141 và test. Spec **79–82** yêu cầu phân biệt chờ áp dụng với nguồn bật nhưng lỗi.

**Ca âm/acceptance cần thêm:** seq1 PASS → seq2 AUTH → seq3 applied(seq1) bị409, không đổi applied và không completed sync; seq4 applied(seq2) cho kết quả duy nhất theo semantics đã chọn, source vẫn unavailable. Nếu command/modelChoice được tạo từ seq1 trước seq2, claim sau seq2 cũng phải kiểm current eligibility và deny, không chỉ so TTL/context/binary của receipt cũ.

### N1 — mới từ fix I6: yêu cầu đọc fence từ frozen DispatchPermit không có field đó

**Bằng chứng:** Phase04 **190** yêu cầu consumer kiểm “permit commandId/decisionId/machine/ticket/expiry/**fence**”. DispatchEnvelope **81–82** chứa `permit:DispatchPermit`; frozen Phase02 **97–100** và Phase03 **57** định nghĩa permit không có fence. Phase02 **471** chỉ cấp fence khi fresh claim đã qua authorize gate. Phase04 **120, 223** vẫn yêu cầu giữ nguyên 005.

**Hệ quả:** Consumer không thể thực hiện phép so khớp được ghi trong plan. Thêm fence vào permit phá frozen contract; lấy fence của prior attempt làm fence mới cũng sai thời điểm/identity.

**Sửa hẹp:** Bỏ yêu cầu `permit.fence` khỏi pre-claim validation; dùng đủ field thực của permit, gồm bindingRevision/ticketRevision/workflow/telemetry/checkedAt/expiry. Fence mới lấy từ kết quả claim005, sau đó so exact attempt/fence/process trong RuntimePin/companion/launcher theo007. Khi reconcile prior attempt, đọc fence từ prior Attempt riêng.

**Ca âm/acceptance cần ghi rõ:** Envelope dùng đúng frozen permit, không có field fence, vẫn qua authorizer khi mọi điều kiện hợp lệ; companion/runtime mang fence của prior attempt hoặc fence sai bị deny. Không sửa DispatchPermit hay suy trước fence mới.

## Ranh giới nghiệm thu

- Addendum cb32f79 đã cung cấp machine-scoped command/attempt reads cần cho Phase04 dòng192; không mở lại finding reconnect endpoint và không trộn cursor journal007 với page anchor005.
- Test-only admission, DB-backed fixture và report live đã được phân biệt khỏi production authority. Runtime chưa đo đủ surface vẫn UNVERIFIED; đánh giá này không yêu cầu chạy model hoặc chứng nhận runtime trong lượt review.
- I2/I3/I5/I6/I7 được đóng ở mức **kế hoạch**. Chỉ freeze sau khi R1/R2/N1 được khóa bằng một contract nhất quán và các ca âm nêu trên; sau đó upstream producer vẫn phải được kiểm chứng khi triển khai.

Không có finding mới ngoài các tương tác cấu trúc do fix đang review. Không chạy test; chỉ tạo báo cáo này.

## Re-review round 2 — R1/R2/N1

Ngày 2026-10-02. Review giới hạn ba finding còn mở và structural breakage do bản sửa vòng 2. Đọc lại contract, RED/acceptance và mapping vòng 2; số dòng vẫn theo `phase-04-runtime-models.md` 225 dòng. Phần này **thay thế verdict CHƯA READY của round 1**; phần trên được giữ làm lịch sử đối chiếu.

**Verdict hiện tại: READY ở mức kế hoạch để freeze/giao triển khai.** R1, R2 và N1 đều **ADDRESSED** ở mức contract cùng ca âm; không thấy Critical/Important mới trong phạm vi sửa vòng 2. Tổng kết finding gốc: **I1–I7 đều ADDRESSED** ở mức kế hoạch.

| Finding vòng 1 | Kết quả | Bằng chứng contract và negative case vòng 2 |
|---|---|---|
| R1 — nonce claim/companion | **ADDRESSED** | Dòng128 chia rõ fresh claim chỉ nhận `issued`, khóa challenge và bind `admitted` atomically với command/decision/attempt/process/fence qua hook INSERT attempt; companion sau claim chỉ nhận đúng admitted A, không đòi issued/tiêu nonce lần nữa. Dòng139 thêm các admitted identity fields và cùng transaction; dòng162 kiểm admitted binding trước RELEASE. Dòng131 và202 đi qua policy hook thật: lost claim reply replay A, companion/RELEASE A thành công; command/attempt/process B hoặc sai fence/selection bị deny. Hook chỉ ghi admission008 từ identity claim005 cấp, không thêm quyền claim hoặc đổi wire005/007. |
| R2 — latest inventory/applied | **ADDRESSED** | Dòng138–139 buộc fresh applied tham chiếu latest accepted inventory current boot/config dưới machine-row transaction. Dòng130/138/139/141 thống nhất đủ ba observation dù AUTH/error thì config applied, source unavailable; thiếu observation thì pending, không advance. Dòng140 yêu cầu receipt thuộc latest inventory khi claim, nên TTL/context hợp lệ của PASS cũ không đủ quyền. Dòng134/202 khóa chuỗi PASS seq1 → AUTH seq2 → applied(seq1) seq3 bị409 → applied(seq2) seq4 advance config nhưng source unavailable; choice từ seq1 claim sau seq2 bị deny. Historical replay vẫn không mutate. |
| N1 — permit.fence không tồn tại | **ADDRESSED** | Dòng190 chỉ kiểm các field thật của frozen DispatchPermit005 trước claim; prior reconciliation lấy prior Attempt riêng, fence mới lấy claim result rồi so RuntimePin/companion/Launcher. Dòng193/202 yêu cầu valid permit không có fence qua authorizer, companion/runtime dùng prior hoặc wrong fence bị deny. Không còn yêu cầu suy fence mới trước claim hoặc mở rộng permit. |

**Kiểm tra tương tác do fix:** Thứ tự READY → fresh claim/bind admission → companion admitted A → RELEASE nhất quán với frozen launcher007 và replay005. Config applied với source AUTH không được biến thành model eligible; fresh claim kiểm latest inventory độc lập ACK. Post-claim fence được dùng tại companion/runtime đúng thời điểm; không dùng làm pre-claim authority. Không mở lại các finding I2/I3/I5/I6/I7 đã đóng ở vòng 1.

**Giới hạn của verdict:** Đây là review tài liệu, không phải kết quả test hoặc xác nhận con số structural assertions do implementer báo. Không chạy source/test/model, không chứng nhận producer Phase02/03, credential, isolation hay runtime thực tế. Production authorizer Phase06, producer validation và bounded live evidence vẫn là các gate triển khai/nghiệm thu đã ghi trong kế hoạch; không phải finding còn mở của vòng review này.
