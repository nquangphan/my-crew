# Review S3b: install report mang `definition` (c184944)

Phạm vi: diff `c184944^..c184944` (`task-s3b-review-package.diff`), cộng các kiểm tra đích: công thức `definition()` ở `v2/gateway/src/assistant/workflow-manifest.ts:141–163`, `canonicalJson` server (`v2/server/src/journal/canonical.ts`) và gateway (`v2/gateway/src/journal/atomic-records.ts:7`), reader của `workflow_status` (`readGatewayApplied`, `readGatewayStatus`, `GET /v2/gateway/config`), error handler `v2/server/src/app.ts:51`, nơi gọi `GatewaySync.open`. Không chạy lại test (theo yêu cầu); có chạy một lệnh node để xác nhận `canonicalJson(undefined)` ném lỗi.

### Spec Compliance

- ✅ Report không có `definition` vẫn được nhận: nhánh mới chỉ chạy khi `slot.definition` tồn tại (`service.ts:315`); schema chỉ mở rộng thêm, test `plain` khẳng định không có trường thêm vào.
- ✅ Server lưu nguyên bản vào `gateway_applied.workflow_status[...].projections[runtime].definition` và `gateway_install_reports.report` (qua `cleanInventory` = `structuredClone`, không lọc). Test `deepEqual` cả hai nơi.
- ✅ `definition.sha256` lệch pin thì không accepted: `definitionMatches` đòi slot `current`, `installed` đúng pin, source đã cài đúng pin mong muốn, render (nếu có) cùng source/projection, và sha256 bằng `hash({source, projection, skills, customizationSha256, render|null})`. Công thức khớp đúng `definition()` của gateway (`workflow-manifest.ts:158`); hai bản `canonicalJson` cho kết quả giống nhau với dữ liệu JSON thuần.
- ✅ Ngữ nghĩa `body_hash` (`hash(input)`) và so sánh pin `same()` giữ nguyên; chỉ thêm một nhánh sau phép so pin. Không có migration, không có route mới. Heartbeat schema vẫn đóng.
- ✅ Không giả định có definition BMAD cho Codex/api: lỗi loader thì bỏ trường, slot vẫn `current`.
- ✅ Sửa `v2/server/src/gateway/contracts.ts` (đã được PM chấp nhận): nội dung đúng tối thiểu (tách schema heartbeat/report, thêm `definitionSchema` đóng). Có một lỗ hổng là `render` để mở, xem I1.
- ⚠️ Hình dạng lưu có thêm `render` (BMAD claude) ngoài `{sha256, skills, customizationSha256}` mà memo nêu. Điều này hợp lý vì `render` nằm trong preimage của sha256 (bỏ đi thì server không kiểm được hash), nhưng đó là mở rộng so với chữ của memo.
- ⚠️ Memo A5 viết `definitions` (số nhiều), S3b viết `definition`. Bản cài đặt theo S3b. S4 cần đọc `definition`.
- ⚠️ `definitions` trong `SyncOptions` chưa được nối ở đâu cả trong production: `GatewaySync.open` không có caller nào trong `v2/gateway/src`. Report thật hiện chưa mang definition nên lookup của S4 sẽ trượt cho tới khi host assembly cấp `createWorkflowManifest(registry)`. Việc này nằm ngoài S3b nhưng cần một chủ sở hữu.

### Phase03-owner verdict

**Chấp thuận chuyển giao, kèm điều kiện sửa I1.**

- Acceptance của gateway hiện có: không đổi. Gateway cũ không gửi `definition`; mọi đường đi không có trường này giống hệt trước.
- Idempotency: không đổi. `body_hash` phủ toàn body, kể cả definition; replay cùng body trả response cũ, bỏ definition dưới cùng reportId thì nhận `INSTALL_REPORT_CONFLICT` (có test). Definition do gateway tính trước khi `record.report` được persist, nên report mất reply được replay đúng byte cũ.
- Tính `current`/`mismatch`: phép so pin không đổi. Thay đổi duy nhất là một slot khớp pin nhưng có definition không chứng minh được sẽ bị hạ xuống `mismatch` và kéo `accepted=false`. Đây là hành vi spec yêu cầu. Lưu ý thêm: slot `!pin` + `current` + definition giờ cũng làm `accepted=false` (trước đây chỉ hạ `mismatch`). Gateway thật không tạo được trường hợp này vì nó `continue` khi `!pin` (`gateway-sync.ts:187`).
- Definition không khớp pin đã cài có thể được lưu không? Qua kiểm tra hash thì không: definition được lưu chỉ khi slot là `current`, `installed` bằng pin mong muốn của config hiện tại, source đã cài bằng source mong muốn, và sha256 ràng `source`/`projection`. Giới hạn đã biết, đúng như implementer tự nêu: `skills`/`customizationSha256`/`render` chỉ được ràng buộc qua hash do chính gateway tạo. Một máy đã xác thực vẫn có thể khai báo skills tùy ý kèm hash khớp. Đây là tin cậy máy, nằm ngoài S3b.
- ⚠️ Hợp đồng cho S4: definition có thể được lưu từ một report **không accepted** (ví dụ superpowers khớp còn bmad lệch). Lúc đó `workflow_status` phản ánh pin của config hiện tại, nhưng `gateway_applied.revision` vẫn là revision cũ. S4 phải đọc definition chỉ từ slot `state=current` và so pin của slot với pin của run, không được suy ra từ `appliedRevision`. Thêm nữa, một report sau mà loader lỗi tạm thời sẽ ghi đè và làm mất definition trước đó, nên lookup có thể chập chờn.

### Strengths

- Phép kiểm tra hash đặt ngay sau phép so pin hiện có, không chạm `hash`/`same`, nên diff nhỏ và dễ kiểm.
- Definition không hợp lệ bị xóa trước khi persist. Nhờ đó lookup không bao giờ thấy một definition chưa được chứng minh.
- Test server đủ các nhánh: lưu nguyên bản, backward, replay/conflict, bốn kiểu giả mạo, pin drift, slot không có pin, schema đóng, heartbeat đóng.

### Issues

**Critical:** không có.

**Important**

- **I1** `v2/server/src/gateway/contracts.ts:236` cùng `v2/server/src/gateway/service.ts:265–268`
  - **Vấn đề:** `render: { type: 'object' }` nhận object bất kỳ. Khi `render` thiếu `source` hoặc `projection` (ví dụ `render: {}`), `same(definition.render.source, source)` gọi `canonicalJson(undefined)`, hàm này ném `Error('JSON_CANONICAL_INVALID')` (đã xác nhận bằng node). Lỗi không phải `ApiError` và không phải lỗi validation, nên error handler (`app.ts:51`) trả 500 thay vì `accepted=false`/400.
  - **Vì sao quan trọng:** đầu vào ở trust boundary gây lỗi 500. Theo `server-gateway.md`/`gateway-host.md`, gateway coi 500 là lỗi tạm thời và gửi lại cùng body/key với lịch chờ tăng dần, nên một report hỏng sẽ bị retry mãi mà không có kết quả xác định. Ngoài ra `render` lưu vào jsonb và trả qua owner status mà không có giới hạn cấu trúc nào (chỉ có body limit 1 MiB). Test "render thuộc pin khác" có đủ `source`/`projection` nên không chạm nhánh này.
  - **Cách sửa:** đóng schema `render` theo `RenderDefinition`: `objectSchema({source: sourceSchema, projection: projectionSchema, selectedProjectionSha256: {type:'object', maxProperties, additionalProperties: digestSchema}, layers: {type:'object', maxProperties: 7, additionalProperties: nullable(digestSchema)}})`. Có thể thêm guard `'source' in render && 'projection' in render` trong `definitionMatches`. Thêm test `render: {}` → 400 (hoặc `accepted=false`), không được 500.

**Minor**

- **M1** `v2/gateway/src/sync/gateway-sync.ts:131–137`
  - **Vấn đề:** `catch {}` nuốt mọi lỗi của loader. Cùng một đường xử lý cho "BMAD ngoài claude" (đúng thiết kế) và cho lỗi toàn vẹn (`WORKFLOW_SKILL_MISMATCH`, hash file lệch, `SOURCE_PROJECTION_MISMATCH`) trên một projection vừa được báo `current`.
  - **Vì sao quan trọng:** lỗi toàn vẹn biến mất không dấu vết; slot vẫn `current` và S4 chỉ thấy "không có definition".
  - **Cách sửa:** chỉ nuốt `WORKFLOW_DEFINITION_UNAVAILABLE`. Với lỗi khác thì ít nhất ghi lại mã lỗi đã sanitize (hoặc hạ slot), theo quyết định của PM.
- **M2** `v2/server/src/gateway/service.ts:315–319`
  - **Vấn đề:** slot bị hạ `mismatch` vì definition nhưng không có `lastError` để phân biệt với lệch pin.
  - **Vì sao quan trọng:** owner/operator không biết vì sao một máy khớp pin lại không accepted.
  - **Cách sửa:** đặt `lastError = {code: 'DEFINITION_MISMATCH', message: <cố định>}` (sau `cleanInventory`, nên không lộ dữ liệu thô).
- **M3** `v2/server/test/gateway.test.ts` (`definitionFor`) và `v2/gateway/test/sync.test.ts` (loader giả)
  - **Vấn đề:** công thức hash được chép lại trong test server, còn test gateway dùng sha256 giả. Không có vector chung nào chứng minh `definition()` của gateway và `definitionMatches` của server cho cùng digest.
  - **Vì sao quan trọng:** nếu hai phía lệch nhau (thứ tự field, `render` undefined/null, khác biệt `canonicalJson`), mọi install có definition sẽ bị từ chối vĩnh viễn ngay khi được nối vào production.
  - **Cách sửa:** thêm một golden vector (fixture JSON + digest) cho cả hai package cùng kiểm, gồm một case BMAD có `render`.

### Assessment

**Task quality:** Needs fixes. Sửa I1 (đóng schema `render`, thêm test cho 500); M1–M3 không chặn nhưng nên xử lý trước khi S4 tiêu thụ.
