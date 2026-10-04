# Re-review FIX1 B3b (97737a1..7ffa25b)

Đọc `tool-client.ts` (sau sửa), hai file test, `http-operations.ts`, `app.ts`, `tools.ts`. Không chạy lại test.

## Verdict
| Mục | Verdict | Ghi chú |
|---|---|---|
| I1 | ADDRESSED | 401/408/425/429/413/5xx/3xx không còn ghi journal; còn lỗ nhỏ N1 (404/403/400 ghi theo status, không theo mã) |
| I2 | ADDRESSED | ánh xạ khớp route thật; 404 một hình dạng; bỏ TURN_STALE; có test route thật |
| I3 | ADDRESSED | `journal.replay` mỗi vòng = đúng một request; bỏ `retryTransient` |
| M1 | ADDRESSED | lowercase `turnId/designationId/processInstanceId/snapshotId`; ID bên trong `call` không chuẩn hoá (đúng phạm vi) |
| M2 | ADDRESSED | `callJson` ổn định khi replay; xem rủi ro R1-R3 |
| M4 | ADDRESSED | `redirect:'manual'`, 3xx là `misconfigured`, không retry, không ghi |

## Kiểm theo yêu cầu
- Bảng ghi journal: chỉ `200,400,403,404,409,422` (transport trả về nên `replay` ghi). Mọi mã khác ném `SendFailure` trước `recordResponse` nên operation mở: 401, 3xx, 408/425/429, 5xx kể cả 503 not-configured/policy-invalid, 413, 2xx khác 200, các 4xx khác. 200 sai envelope/kind cũng ném trước khi ghi (đúng, tránh ghi phản hồi hỏng).
- 401: `retry=false`, kind `unauthorized`, `retryable:true`; bearer là hàm được gọi mỗi lần gửi (trong transport, trong `replay`), nên lần `execute` sau lấy credential mới cùng operationId/body. Hàm bearer ném lỗi → `unauthorized` retryable, không gửi, không ghi. Đúng.
- 429: `Retry-After` (giây hoặc HTTP date) → ms, kẹp `[0, 60000]`; nếu thiếu/không hợp lệ dùng 1s·2^n tối đa 60s. Đúng, nhưng xem N3.
- Đếm request: `replay` trả bản ghi đã lưu không I/O, ngược lại gọi transport đúng một lần; `send` tăng `attempt` mỗi lần; lần cuối ném mà không ngủ. Mỗi attempt = một request thật.
- Test route thật: ranh giới package. `assistant-tool-client-route.test.ts` import `../../server/src/**` và `../../server/test/support/**` bằng đường dẫn tương đối, Fastify qua `createRequire` từ package server. Không phá ranh giới sản phẩm: chỉ ở `test/`, `tsconfig.build.json` loại `test` và chỉ build `src`, `src/` không import server. Đã có tiền lệ `execution-bridge-db.test.ts` (import `buildApp`, `test/support`). Hệ quả cần biết: `tsc --noEmit` của gateway nay biên dịch cả server src và test cần `CREW_V2_TEST_DATABASE_URL` + Docker (như tiền lệ).

## Findings mới / breakage
- N1 (Important) `tool-client.ts` `recordedStatuses` + `terminalError`: ghi theo status, không theo mã. 404 mặc định của Fastify ("Route POST:... not found", `app.ts` không có `setNotFoundHandler`; `serverCode` null) hoặc 404/403/400 từ proxy/WAF/server cũ chưa có route bị ghi vĩnh viễn như `not_found`/`forbidden`/`invalid`, đúng kiểu đầu độc của I1. Fix: chỉ ghi khi `serverCode` thuộc tập mã route phát ra (ASSISTANT_SCOPE_NOT_FOUND, NOT_FOUND, ASSISTANT_TOOL_NOT_IN_SCOPE, INVALID_INPUT, PROVIDER_CALL_ID_INVALID, PATH_INVALID, IDEMPOTENCY_CONFLICT, ASSISTANT_OPERATION_CONFLICT, ASSISTANT_INPUT_STALE, ASSISTANT_TOOL_BUDGET_EXHAUSTED, DOCS_ENCODING_INVALID...); status ghi được mà thiếu/lạ mã → `SendFailure` không ghi. Thêm test 404 body Fastify mặc định.
- N2 (Minor) `send` không còn `retries.transaction`: hai `execute` đồng thời cùng operation có thể gửi hai request song song (server idempotent và khoá advisory nên an toàn; `recordResponse` bằng nhau). Test "concurrent" chỉ kiểm cùng kết quả, không kiểm số request. Ghi nhận trong docs.
- N3 (Minor) `Retry-After` thay thế thay vì lấy max với backoff: `Retry-After: 0` cho phép vòng lặp không ngủ tới trần attempt. Dùng `max(retryAfter, backoff)` hoặc sàn nhỏ.
- N4 (Minor) Bearer hàm trả chuỗi chứa CR/LF/ký tự cấm làm `fetch` ném TypeError, bị coi là mất mạng và retry vô ích tới trần; nên kiểm credential (`/^[\x21-\x7e]+$/`) và trả `unauthorized` không retry.
- N5 (Minor) Test route thật tự viết `setErrorHandler`, không dùng `buildApp`: `'statusCode' in error` → 400 cho mọi lỗi có statusCode (app.ts chỉ 400/413 riêng), nên 413 `BODY_TOO_LARGE` và 404 route-not-found không thể kiểm trên route thật; trôi lệch so với `app.ts`. Dùng `buildApp` như `execution-bridge-db.test.ts` hoặc export handler.
- R1 (M2, Minor, đã khai) Journal tạo bởi 97737a1 (body có `call` trực tiếp, có thể chứa 4xx hạ tầng đã ghi): `prepare` cùng operationId ra `OPERATION_CONFLICT` → `conflict`, hoặc replay đọc `callJson` undefined → `JSON.parse` lỗi → `journal`. Chưa mount production nên chấp nhận; cần ghi vào docs là không tương thích ngược, xoá thư mục `assistant-tools` cũ.
- R2 (M2) Replay an toàn: lần gửi đầu cũng đi qua cùng transport từ bản ghi, nên body gửi lần đầu và mọi lần replay đều là `JSON.parse(callJson)` (thứ tự khoá canonical, `-0` thành `0` nhất quán); server băm canonicalJson của body đã parse nên không lệch hash; `prepare` so `callJson` chuỗi canonical nên tất định. Không thấy rủi ro idempotency.
- R3 (M2) Đổi lại: `rejectSecrets` không còn quét nội dung `call` (đúng ý), nên tên khoá bí mật trong payload nay không bị chặn; test 'secret-named key' ở nhánh invalid (dòng 339-353) giờ chỉ còn thất bại vì khoá thừa `token` ngoài shape, không còn chứng minh quét bí mật. Bearer vẫn không vào journal (có test). Chấp nhận, nhưng đổi tên/giải thích test cho đúng.
- Minor: kind mới `forbidden`/`misconfigured`/`not_configured` và 403 không còn là `unauthorized` là thay đổi API; chưa có consumer nên không vỡ. Concern 3 (408/425/429 dùng chung `unavailable` với 5xx) không nguy hiểm.

## Phần chưa phủ trên route thật (đã khai)
`create_run`/`ask_owner` completed chỉ kiểm bằng fake; shape `run`/`question` chưa được chứng minh với route thật.

**Task quality:** Approved (kèm N1 nên sửa trước khi mount production; không chặn slice).
