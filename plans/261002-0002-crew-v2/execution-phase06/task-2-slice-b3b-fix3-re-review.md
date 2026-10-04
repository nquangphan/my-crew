# Re-review FIX3 B3b (24dfc7b..586da9c)

Đọc diff `tool-client.ts`, test, docs; đối chiếu `server/src/{assistant,tickets,docs,journal}` bằng grep. Không chạy lại test.

## Verdict
| Mục | Verdict |
|---|---|
| G1 | ADDRESSED |
| G2 | ADDRESSED |
| G3 | ADDRESSED (kèm giới hạn G3a-G3c) |
| Docs | ADDRESSED |

- G1: `ASSISTANT_*`/`ORCHESTRATION_*`/`WORKFLOW_*` trên 400/403/404/409/422 và danh sách mã không prefix (TICKET_CLOSED, PROJECT_NOT_BOUND, REVISION_CONFLICT, các mã dependency/repair/completion...) được ghi; sáu mã bị thiếu có kind đúng và test bảng: OPERATION_CONSUMED/STALE, TICKET_CLOSED, PROJECT_NOT_BOUND → `conflict`, OPERATION_NOT_FOUND → `not_found`, ADMISSION_DENIED → `forbidden`.
- G2: `ASSISTANT_STORE_MISSING`, `ASSISTANT_ADMISSION_NOT_CONFIGURED`, `ORCHESTRATION_COMMAND_NOT_RELEASED` vào `notConfigured`, kind `not_configured`, không retry, không ghi; có test từng mã. Cổng đổi từ `status===503` sang `status>=500` (rộng hơn, hợp lý).
- G3: `classifyError(status, code) -> {kind, record, retry}` là điểm duy nhất; test quét `new ApiError('CODE', status)` trong `server/src/{assistant,tickets,docs}` khẳng định không cặp nào ra `misconfigured`, và kiểm các loại trừ còn tồn tại.
- Docs: mục 20/21 cập nhật tập mã, nhóm `not_configured` mới và quy tắc "mã transient phải 5xx"; khớp code.

## Ba điểm kiểm thêm
1. `classifyError` dùng chung có đổi hành vi đường đã duyệt không: không.
   - 200 xử lý trước, không qua `classifyError` (parse envelope, ghi). Không đổi.
   - 401: `open('unauthorized')`, `retry=false`, `retryable` vẫn true (nhờ `|| kind==='unauthorized'`). Không đổi.
   - 5xx thường/408/425/429: `unavailable`, retry, `Retry-After` chỉ đọc khi `retry`. Không đổi.
   - 3xx: `misconfigured`, không retry, không ghi. Không đổi.
   - 413 và 4xx/2xx không liệt kê: `rejected`, không ghi. Không đổi.
   - Khác biệt có chủ ý: 5xx (không chỉ 503) mang mã cấu hình giờ là `not_configured`; 4xx nghiệp vụ không còn đi nhánh `if status in {...}` riêng mà qua `isRouteOutcome` (cùng tập status).
   - `terminalError` khi replay: bản ghi mà `classifyError` không còn coi là verdict (vd 404/403 không mã do journal bản fix1 ghi) trả `response_invalid` thay vì kind cũ; chỉ ảnh hưởng journal tiền-mount đã yêu cầu xoá.
2. Năm mã loại khỏi test chống trôi: chính đáng cho tool đã phát hành, với một lưu ý.
   - `CURSOR_INVALID` (history.ts, search.ts), `LIMIT_INVALID` (tickets/routes.ts, search.ts), `QUERY_INVALID` (search.ts) là validate query list, `create_run`/`ask_owner`/`read_*` không tới. `MACHINE_REQUIRED` (repair.ts, import.ts) là route repair/docs import. `DEPLOY_OWNER_INTENT_REQUIRED` (tickets/service.ts) là duyệt deploy. Test còn kiểm mỗi loại trừ vẫn tồn tại.
   - Lưu ý G3a (Minor): `DEPLOY_OWNER_INTENT_REQUIRED` (ticket service, qua port action `decision`) và `MACHINE_REQUIRED` (repair, `request_review`) sẽ TRỞ NÊN tới được khi các tool chưa phát hành (`route_message`, `request_review`...) được mở. Loại trừ nên ghi rõ "hợp lệ chỉ với bốn tool phát hành" để người mở tool buộc phải bỏ loại trừ và phân loại mã.
3. Case 404 → `IDEMPOTENCY_CONFLICT`: còn chứng minh được một phần ý định.
   - Ý định gốc: mã thuộc status khác không được ghi trên status này. Sau G1, `ASSISTANT_*` hợp lệ trên mọi status nghiệp vụ nên không thể dùng làm phản ví dụ; `IDEMPOTENCY_CONFLICT` (không prefix, chỉ ở 409) vẫn kiểm bảng theo status cho nhóm không prefix. Cách đổi hợp lý.
   - Mất: không còn khẳng định theo-status cho ba họ prefix (cố ý). Không có test ASSISTANT_* ở status ngoài tập nghiệp vụ nào bị ghi; được phủ gián tiếp bởi test `classifyError` (503 + mã `ASSISTANT_LOCK_TIMEOUT/ORCHESTRATION_BUSY/WORKFLOW_BUSY` không ghi, retry).

## Giới hạn / findings mới (đều Minor)
- G3a: xem điểm 2.
- G3b: bộ quét chỉ thấy `new ApiError('LITERAL', status)` trong ba thư mục: bỏ sót `fail('CODE', status)` (docs/import.ts:379), mã dựng từ biến, và `journal/mutation.ts` (`BODY_INVALID` 400, `IDEMPOTENCY_KEY_INVALID` 400; hiện không tới được vì ID tất định ASCII và body canonical, nhưng nếu tới sẽ là `misconfigured`, không ghi). Chấp nhận, ghi nhận trong report (đã nêu một phần).
- G3c: quy tắc docs "4xx trong namespace ASSISTANT_ là phán quyết tất định" không đúng với một số mã server hiện hữu mang tính trạng thái thời gian (`ASSISTANT_WORK_HELD`, `ASSISTANT_WORK_NOT_DUE`, `ASSISTANT_TURN_IN_USE`, `ASSISTANT_CALIBRATION_ACTIVE`, `ASSISTANT_REASSIGNMENT_PENDING`, đều 409). Không nằm trên đường tool (authorize gom lỗi resolver thành 404; các mã này thuộc route work/config), nên không đầu độc journal ở hiện tại; nhưng docs nên nói rõ phạm vi "đường tool" hoặc server đổi các mã đó sang 5xx/423 trước khi cho tool gọi chúng.
- Không thấy hồi quy an toàn idempotency hay lộ bí mật.

**Task quality:** Approved
