# Re-review FIX2 B3b (7ffa25b..24dfc7b)

Đọc diff `tool-client.ts`/test/docs, đối chiếu mọi `new ApiError(code, status)` trong `server/src/assistant/*` (grep một lượt, gồm ba chỗ ApiError nhiều dòng). Không chạy lại test.

## Verdict
| Mục | Verdict |
|---|---|
| N1 | ADDRESSED (cơ chế đúng; bảng mã còn thiếu, xem G1) |
| N3 | ADDRESSED |
| N4 | ADDRESSED |
| R3 | ADDRESSED |
| R1 | ADDRESSED |

- N1: 400/403/404/409/422 chỉ được ghi khi `serverCode` thuộc tập của đúng status đó hoặc khớp `^(ORCHESTRATION|WORKFLOW)_[A-Z0-9_]{1,48}$`; thiếu hoặc sai mã (Fastify 404 mặc định, HTML proxy, 404 mang mã của status khác) ném `misconfigured` không ghi, không retry, operation mở; test chứng minh gọi lại hoàn tất được ("not poisoned"). Lỗ N1 đã đóng.
- N3: `sleep(max(Retry-After, backoff))` trần 60s; `Retry-After: 0` vẫn ngủ 1s/2s/4s; có test.
- N4: credential rỗng hoặc ngoài `[\x21-\x7e]` → `unauthorized` retryable, không gửi, không retry (kiểm sau khi gọi hàm bearer); có test `sent==0` và message không lộ giá trị.
- R3: nhãn test đổi thành shape check; ý "không quét secret" có test riêng (khoá `password/secret` hợp lệ).
- R1: docs flow ghi journal `assistant-tools` bản đầu không tương thích và phải xoá trước khi mount; ghi cả N2/N1/N3/N4.

## Tập mã của client so với route B3a
Khớp (đúng status): INVALID_INPUT, VALIDATION, PATH_INVALID, PROVIDER_CALL_ID_INVALID, ASSISTANT_FENCE_INVALID, ASSISTANT_ID_INVALID (400); ASSISTANT_MACHINE_REQUIRED, ASSISTANT_TOOL_NOT_IN_SCOPE (403); NOT_FOUND, ASSISTANT_SCOPE_NOT_FOUND (404); IDEMPOTENCY_CONFLICT, ASSISTANT_OPERATION_CONFLICT, ASSISTANT_INPUT_STALE, ASSISTANT_TOOL_BUDGET_EXHAUSTED, ASSISTANT_TURN_STALE (409); DOCS_ENCODING_INVALID (422). Họ ORCHESTRATION_*/WORKFLOW_* phủ mọi mã trong `orchestration.ts`, `runs.ts`, `gates.ts`, `workflows.ts` trên các status 403/409/422 (kể cả WORKFLOW_SKILL_MISSING 422, WORKFLOW_DEFINITION_UNKNOWN 422).

THIẾU nhưng route tool phát ra thật (qua `create_run`/`ask_owner`, tức thuộc tập đã phát hành):
- G1 (Important) 409 `ASSISTANT_OPERATION_CONSUMED` (orchestration.ts:106, gates.ts:770), 409 `ASSISTANT_OPERATION_STALE` (orchestration.ts:309,450, gates.ts:761), 404 `ASSISTANT_OPERATION_NOT_FOUND` (orchestration.ts:114,307, gates.ts:759), 409 `TICKET_CLOSED` (runs.ts:252, gates.ts:644,774), 409 `PROJECT_NOT_BOUND` (runs.ts:254), 403 `ASSISTANT_ADMISSION_DENIED` (authority.ts:115, khi resolver chạy lại trong consume qua port). Đây là phán quyết nghiệp vụ tất định, nhưng client coi là `misconfigured`: không ghi (không đầu độc) mà caller không phân biệt được "ticket đã đóng" với "cấu hình sai", và `execute` lặp lại mãi trả cùng lỗi mà journal không chốt. Cũng đáng chú ý `ASSISTANT_TURN_IN_USE`, `ASSISTANT_SCOPE_STALE`, `ASSISTANT_CALIBRATION_ACTIVE`... có trong bảng nhưng không phải từ tool route (vô hại).
- G2 (Minor) 503 mang mã `ORCHESTRATION_COMMAND_NOT_RELEASED`, `ASSISTANT_STORE_MISSING`, `ASSISTANT_ADMISSION_NOT_CONFIGURED` (cấu hình, tất định) bị coi là quá tải và retry tới trần (~31s ở mặc định); `notConfigured` chỉ có hai mã. Thêm vào `notConfigured` (không ghi, không retry).
- G3 (Minor) Bảng là sao chép thủ công, sẽ trôi khi route thêm mã. Test route thật đã import server nên có thể thêm test quét `new ApiError('CODE', status)` trong `server/src/assistant` và khẳng định mỗi mã 400/403/404/409/422 được client nhận (hoặc nằm trong danh sách loại trừ có chủ đích).

## Họ prefix có mở lại cửa đầu độc không
Không đáng kể. Điều kiện ghi vẫn là status thuộc {400,403,404,409,422} VÀ body JSON `error.code` khớp namespace do chính server sở hữu; proxy, Fastify mặc định, server cũ chưa có route đều không phát mã này, nên không thể bị ghi nhầm. Rủi ro còn lại chỉ là tương lai: một mã transient (hết thời gian khoá, serialization) đặt trong namespace ORCHESTRATION_/WORKFLOW_ ở status 409 sẽ bị chốt vĩnh viễn; ghi nhận trong docs rằng mã transient của consumer phải dùng 5xx. Khuyến nghị cùng nguyên tắc cho `ASSISTANT_*` (prefix thay cho liệt kê) để đóng G1 mà không tăng rủi ro, vì mọi `ASSISTANT_*` đều do server phát và bị chặn thêm bởi cổng status.

## Breakage mới
Không thấy hồi quy: đường 200, 401, 5xx, 3xx, 413 không đổi; `isRouteOutcome` chỉ siết thêm. Hệ quả duy nhất là G1/G2 (phân loại), không phải mất an toàn idempotency.

**Task quality:** Approved (nên sửa G1 trước khi mount production).
