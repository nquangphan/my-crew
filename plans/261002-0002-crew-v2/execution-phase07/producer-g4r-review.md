## Producer P-G4r review (947ffb5)

### Spec Compliance
- ✅ Machine status bổ sung hostVersion/appVersion/observedAt/telemetry, chỉ khi heartbeat thuộc boot hiện tại (null nếu không live).
- ✅ Catalogue theo máy/workflow/runtime: so từng slot với desired hiện tại (không dùng appliedRevision); versionMismatch ở source; definition chỉ trả khi definitionMatches (slot state=current + pin khớp, hợp đồng S3b).
- ✅ Retry intent: owner + CSRF + mutator idempotency, CAS expectedRevision, fail-closed (CONFIG_NOT_CONFIGURED / CONFIG_REVISION_CONFLICT), không đụng body_hash/same()/install-report, không migration.
- ✅ Command read owner-only, keyset `before`, kèm result.
- ✅ Credential key read nằm ngoài phạm vi, không có trong diff.
- ⚠️ Retry không bị chặn khi enabled=false (xem Issues M1).
- ⚠️ Command read chỉ phủ gateway_commands của máy (đã khai báo trong report, đúng phạm vi "gateway").
- ⚠️ Không có digest pin chuẩn phía server (đã khai báo); verdict dùng canonicalJson so pin, chấp nhận được.

### Security
- ACL: 3 route dùng requireOwner; GET csrf:false, POST csrf:true; máy bị 403 (test có). Retry đi qua authorizeGatewayMutation: khóa machine `for update`, từ chối máy revoked/không tồn tại (404), kiểm tra lại credential hiện tại.
- Rò rỉ: telemetry là số/enum/shortString đã validate bằng schema; lastError bị cleanInventory ghi đè bằng code/message cố định khi lưu (service.ts:146) nên không lộ lỗi thô/đường dẫn; command.payload chỉ có configRevision; command.result đã qua validateAckDetails (chặn `/`, `\`, token/secret/credential); definition.render chỉ gồm pin + digest + đường dẫn layer cố định; official URLs là hằng công khai. Không thấy endpoint/credentialRef/env.
- Idempotency/race: ghi dưới khóa machine `for update` nên retry và PUT config tuần tự hóa; CAS revision nằm trong khóa; dedupe command mở theo configRevision; cùng key replay không nhân đôi (test có). Cursor cấp từ singleton counter (giữ khóa tới commit) nên thứ tự cursor = thứ tự commit, phân trang `before` ổn định, không trùng/sót.

### Strengths
- Tái dùng definitionMatches/mapCommand/mutator thay vì viết song song; tách officialReleases thành nguồn duy nhất cho validate + catalogue (không đổi hành vi validateOfficialSource).
- Test bao phủ CSRF, 400 schema, CAS, dedupe, replay, phân trang, ACL máy.

### Issues
**Critical:** không.

**Important**
- I1 `service.ts` requestWorkflowRetry (dòng `select ... state<>'completed'`): command `received` bị kẹt (daemon crash sau ack received, không bao giờ completed) sẽ chặn vĩnh viễn mọi retry cho revision đó, owner không có đường thoát ngoài đổi desired. Fix: chỉ coi `queued` (hoặc `received` còn trẻ, vd received_at > now-X) là "đang mở"; hoặc cho phép retry khi received quá hạn. Cần xác nhận daemon có reclaim received hay không trước khi quyết định.

**Minor**
- M1 `service.ts` requestWorkflowRetry: không kiểm tra `config.enabled`. Đánh giá: không phải bug phía server vì server không dùng `enabled` ở chỗ nào khác, và writeGatewayConfig khi bật/tắt cũng xếp sync_workflows bất kể enabled (tiền lệ); daemon quyết định hành vi. Tuy vậy fail-closed hơn nếu trả lỗi (vd CONFIG_DISABLED 409) khi enabled=false; tối thiểu UI phải ẩn/khóa nút Retry khi disabled. Cần quyết định sản phẩm; không chặn merge.
- M2 `catalogue.ts` / readGatewayStatus: đọc không từ chối máy revoked (status cũ cũng vậy); retry thì có. Nhất quán với hiện trạng, chỉ ghi nhận.
- M3 `routes.ts` commands: `limit` cho phép 1-999 qua pattern rồi mới bị 400 LIMIT_INVALID ở service (>100); cùng kiểu với route máy, chấp nhận được.

### Assessment
**Task quality:** Approved (khuyến nghị xử lý I1 hoặc xác nhận daemon reclaim `received` trước khi UI dựa vào retry).
