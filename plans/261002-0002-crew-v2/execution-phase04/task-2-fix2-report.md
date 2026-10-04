# Phase04 Task2 — FIX2/5, residual R2

2026-10-02. Previous candidate `dd2a0e1`, reviewed verification core `556cd8d`. Implementation chờ original scoped independent review; không tự nhận SPEC/QUALITY READY. FIX1 năm finding R1/R3/R4/R5/R6 đã CLOSED được giữ nguyên; chỉ sửa residual R2 theo brief/canary và ruling17:10.

## Thay đổi và authority

Chỉ ba owned files: credential-provisioning.ts, credential-provisioning.test.ts và gateway-models R3. `fix2-source-inventory.json` ghi SHA trước/sau so với dd2a0e1 và toàn own23. Không sửa resolver, broker, server, schema001–010, native, HTTP journal, manifest/dependencies/generated hay producer khác; không Git mutation/subagent.

`syncPending` trước khi trả stored dùng nguyên actual CurrentCredentialResolver.resolve(provider, revision, signal) và assertCurrent(). Các read xác minh fresh desired/current binding đúng machine/revision/provider/endpoint/protocol/ref, local broker.assertStored và ref/currentOperationId không đổi giữa hai mẫu. Nullable currentOperationId vẫn hợp lệ theo existing producer. Metadata sai/thiếu, read error, current local ref mất hoặc observed change đều trả pending; raw error không thoát. Signal timeout30s bound phần resolver, không mở retry.

Vì vậy currentA stored nhưng localA mất không còn bị báo stored. HistoricalA mất ref vẫn giữ queued envelope và immutable intent, nhưng không hạ currentB nếu bindingB/localB thật được xác minh. Replay ACK thành công chỉ dọn queueA có receipt; current desired pendingB vẫn pending đến fresh metadata/localB xác nhận. Không suy current từ UUID/cursor/ACK success, không secret rewrite, không cấp server mutation mới. Current snapshot vẫn sampled read, không lease network hay admission.

## Regression và evidence

- RED `red/focused.log`: provisioning6 test,5pass/1fail, exit1; public same-current storedA/localA missing trả stored thay vì pending, đúng residual review.
- GREEN `green/focused.log`:6/6 PASS, exit0; sau sửa production và trước format/docs. Original expiry/crypto/lost-receipt/restart/same-key/body/altered-envelope/missing-intent negatives vẫn chạy.
- New public test seed exact durable post-write/lost-ACK state qua actual AtomicRecords public API, actual X25519/AES crypto, actual CredentialBroker và baseline556 HttpOperationJournal. Fake Security bridge chỉ giữ fixture memory; fake machine reads dùng full actual desired/binding DTO. Không chạm private field sản phẩm.
- Case1: server currentA stored/localA missing/queueA → pending,0 ACK HTTP,0 secret rewrite; close/reopen rồi cùng kết quả, queueA/envelope/intent exact retained.
- Case2: historyA missing + currentB/localB thật → stored,0 ACK HTTP, historyA/queueA còn. Mutation negatives gồm machine/revision/API flag/provider missing/duplicate/foreign/endpoint/protocol/status/ref foreign/refA missing, thrown read error và operation đổi giữa reads → pending. Stored refB + currentOperationId=null vẫn hợp lệ.
- Case3: localA khôi phục bằng fixture owner setup để replay exact intentA; pendingB + successful historical ACKA → pending,1 ACK HTTP exact body,0 secret rewrite trong sync. QueueA được settle, immutable intentA giữ. Fresh desired/binding storedB/localB thật mới trả stored, không thêm ACK.

Read-only metadata GET khác ACK HTTP; 0 ACK không có nghĩa 0 read. Fixture chỉ mô phỏng authenticated machine port, không là live-server/PG chứng nhận. Current resolver schema/authority và server routes unchanged; không chạy duplicate server/PG cover. Original current-binding4 actualPG tests là evidence cũ, không gọi fresh FIX2 PASS.

## Final frozen verification

**114/114 PASS**,0 fail/cancel/skip, exit0,75899ms. Build/typecheck/scoped Biome15TS exit0. Exact explicit17 gateway test files, frozen archive556 + current own23; không peer retry/isolation/attachments/tickets/010. Source hashes kiểm trước/sau và exact argv/cwd/exit ở final/commands.json. Không wildcard tests hay union với lịch sử. `final-verification.json`:238 snapshot files0delta, own23 hashes giữ nguyên, ba nonce snapshot roots removed; RED/GREEN mỗi4 fixture roots và final7 roots identity-match/absent, final4 fake helper created/reaped, read-only ps không còn process theo exact recorded roots. AtomicRecords close được await trước root removal; không tự suy lock PID nếu fixture không ghi riêng.

## Cleanup và giới hạn

Mọi snapshot dùng nonce/dev/ino/uid receipt trước copy, archive path/member validation và exact identity trước removal. Fixture helper ghi owned root creation/removal; public AtomicRecords close/reopen release lock trước inspection/restart. Không Docker/server shared/provider live/Keychain owner/global config/service mutation. Hai old unreceipted zQeH26/DTjkSU tiếp tục RETAIN; không sweep prefix.

FIX1 standalone113/113, initial24RED/24GREEN/compat/state evidence và reviewer canary/log vẫn nguyên. Original server218/219 + repaired wholecase1/1, gateway93/104 infra rồi103/104 baselineflake + unchanged narrow1/1 vẫn giữ riêng, không cộng PASS. Không suy baseline flake root cause đã sửa.

Signed native/runtime/tool/live certification, sync_models host composition và sampled authority limits không thay đổi. PM cần scoped re-review residual R2 cùng ba-file diff/frozen context trước commit acceptance. Semantic wave2/5.
