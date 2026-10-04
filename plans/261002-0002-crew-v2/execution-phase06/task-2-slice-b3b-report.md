# Task 2 Slice B3b — gateway tool client

**Kết quả: DONE_WITH_CONCERNS.** `v2/gateway/src/assistant/tool-client.ts` là client máy của `POST /v2/assistant/turns/:id/tools` (B3a, c348950). Typecheck gateway sạch, `assistant-tool-client.test.ts` 14/14, hồi quy `http-operations.test.ts` 4/4; Biome 0 lỗi (5 warning `noExplicitAny` trong fixture test, cùng kiểu các test gateway khác). `crew-docs generate`, `check --all`, `check --staged` ok trên mirror (v2 là Git root giả lập); mirror đã xóa.

## Thiết kế
- API: `createToolClient({root, baseUrl, bearer, fetch?, maxAttempts?, now?, sleep?})` trả `{execute(turn, event, options?), close()}`; `toolOperationId(turnId, providerCallId, sequence)` là UUID layout v5 từ SHA-256 canonical `['crew-v2:assistant-tool-operation:1', turnId, providerCallId, sequence]`.
- Kiểm union tool viết tay (gateway không có ajv/zod, không import server) trước mọi I/O; payload sâu (`ticket`) chỉ kiểm JSON thuần, server kiểm sâu.
- Journal: dùng nguyên `HttpOperationJournal` (phase03), thư mục riêng `<root>/assistant-tools` vì `AtomicRecords` khóa một writer mỗi thư mục. `providerCallId` nằm trong `phase` (`assistant-tool:<id>`) để carrier header sống qua restart mà không đổi định dạng journal; transport riêng (cùng guard URL/redirect/timeout với `machineTransport`) gửi header đúng một lần. Không gửi `idempotency-key` vì server khóa theo `operationId`.
- Gửi lại: mạng/timeout/500/502/503/504 gửi đúng body+ID qua `retryTransient`, lịch 1s nhân đôi tới 60s, tối đa `maxAttempts` (mặc định 6); hết lượt trả `unavailable` retryable, gọi lại tiếp tục đúng operation. 4xx là terminal, được journal giữ nên phát lại sau restart không I/O.
- Phản hồi: envelope chính xác, operationId khớp, `completed` chỉ nhận đúng kind của tool và đúng tập field; `pending` trả nguyên; `rejected` cần `errorCode`.
- Không log; bearer chỉ trong closure transport; lỗi chỉ mang kind/status/mã server.

## Test
Server giả `node:http` trong process, dựng đúng hợp đồng route (header một lần/ASCII/không dấu phẩy, body năm field, idempotency theo operationId, 409 khi khác body hoặc trùng provider call/sequence, trả byte kết quả đã lưu, commit-then-drop). KHÔNG phải route Fastify/PostgreSQL thật: route thật đã có `server/test/assistant-tools-route.test.ts`; dựng lại fixture đó trong gateway cần sao chép ~150 dòng fixture không export (ngoài ownership). Test được viết trước source nhưng chưa chạy được bản đỏ trước (module chưa tồn tại thì import lỗi); lần chạy đầu sau khi viết source đã xanh.

## Files
`v2/gateway/src/assistant/tool-client.ts`, `v2/gateway/test/assistant-tool-client.test.ts`, `v2/docs/flows.yaml` (2 dòng), `v2/docs/flows/assistant-workflows.md` (bước 19–21, Files, Tests), `v2/docs/files.md` (generate, 2 dòng).

## Concerns
1. Không có test chéo với route thật (xem trên); đề xuất slice mount/integration T7 chạy client này với `buildApp`.
2. Retry sau restart: nếu history của journal có `retryAt` xa hơn lịch ngủ của client, một vòng gọi bị tiêu hao mà không gửi; vẫn bị chặn bởi `maxAttempts`.
3. fence/pin đổi giữa hai lần chạy cùng lời gọi trả `conflict` cục bộ (cùng operationId khác body), caller phải coi lời gọi đó là hỏng.
4. Chưa có GET `/v2/assistant/turns/:id/tools/:operationId`, ghi fsync kết quả rồi `driver.resolve`, mount production (slice sau, theo W4/T7).
5. Phụ thuộc ngầm vào việc journal `phase` không bị giới hạn độ dài/ký tự; nếu journal siết sau này cần field riêng.

# FIX1 (I1, I2, I3, M1, M2, M4)

**Kết quả: DONE_WITH_CONCERNS.** RED trước cho từng mục: `task-2-slice-b3b-fix1-red.log` (lượt 1: 35 test, 25 fail trên client 97737a1; lượt bổ sung dùng bearer chuỗi để tách lỗi hành vi khỏi API bearer-hàm mới: 9/27 fail đúng các mục I1/I3/M1/M2/M4/not-configured). GREEN: `task-2-slice-b3b-fix1-green.log`, 39/39 (14 cũ + 12 mới ở file fake, 8 ở file route thật, cộng hồi quy `http-operations` 4/4); typecheck gateway sạch; Biome 0 lỗi. `crew-docs generate/check --all/check --staged` ok trên mirror.

- **I1:** journal giữ phản hồi đầu vĩnh viễn nên transport chỉ trả về (để ghi) các kết quả nghiệp vụ 200/400/403/404/409/422; mọi trạng thái khác được ném (`SendFailure`) và KHÔNG ghi, operation giữ mở. 401: kind `unauthorized`, retryable, không tự thử lại; `bearer` nhận hàm gọi mỗi lần gửi nên credential làm mới đến lần gọi lại cùng operationId/body. 408/425/429/5xx (kể cả 503 `SERVICE_UNAVAILABLE`) và mất mạng: thử lại có giới hạn, `Retry-After` của 429 được tôn trọng (trần 60s). 503 `ASSISTANT_TOOLS_NOT_CONFIGURED` và `ASSISTANT_POLICY_INVALID`: kind `not_configured`, dừng, giữ operation. 413 và 4xx không liệt kê: `rejected`, không ghi. Mỗi mã có test.
- **I2:** ánh xạ theo route thật: 403 `forbidden`, 404 một hình dạng `not_found` (turn/máy khác/fence cũ), 409 `ASSISTANT_INPUT_STALE` `stale`, budget, `IDEMPOTENCY_CONFLICT`/`ASSISTANT_OPERATION_CONFLICT`/workflow `conflict`; bỏ `ASSISTANT_TURN_STALE` (route không phát ra). Fake sửa: mã `INVALID_INPUT`/`IDEMPOTENCY_CONFLICT`, authorize trước replay, idempotency và clash theo turn, so turnId lowercase, completed cho docs/run/question. Thêm `assistant-tool-client-route.test.ts`: client qua TCP vào route thật (`registerAssistantRoutes` + `createAssistantTools`, Fastify lấy từ package server bằng `createRequire`, authenticator/mutator thật, PostgreSQL 18.6 riêng loopback ngẫu nhiên, container đã xóa). Phủ: catalog và docs completed + phát lại, tool chưa phát hành, 401, 404 máy khác và fence cũ, 409 pin cũ, 403 ngoài scope, ngân sách, trùng sequence, UUID hoa. Chưa phủ trên route thật: `create_run`/`ask_owner` completed (fixture cần binding máy B và report cài đặt, ~100 dòng nữa); các kind này được kiểm ở fake.
- **I3:** không còn dùng `retryTransient`; mỗi vòng gọi `journal.replay`, nên một vòng = đúng một request thật. Test đếm: `maxAttempts` N gửi đúng N request (và 1 gửi đúng 1). Không sửa `http-operations.ts`.
- **M1:** fence UUID và `snapshotId` lowercase trước khi dẫn xuất ID và ghi journal; test cả fake và route thật.
- **M4:** `redirect:'manual'`, 3xx là `misconfigured`, không retry, không ghi.
- **M2:** body journal giữ `call` dạng canonical JSON text (`callJson`) nên `rejectSecrets` chỉ quét envelope cố định; transport dựng lại body đúng năm field. Cách này tránh sửa journal phase03 (ngoài ownership). Bearer vẫn không vào journal (test).

Concerns: (1) journal tạo bởi 97737a1 có thể đã chứa 4xx hạ tầng bị ghi; chưa có migration vì chưa mount production. (2) `callJson` làm bản ghi journal khác định dạng body gửi đi; transport là nơi duy nhất đọc nó. (3) 408/425/429 dùng chung kind `unavailable` với 5xx.

# FIX2 (N1, N3, N4, R3, R1)

**Kết quả: DONE_WITH_CONCERNS.** RED trước: `task-2-slice-b3b-fix2-red.log` (3 test mới fail trên 7ffa25b, 27/30 còn lại pass). GREEN: `task-2-slice-b3b-fix2-green.log`, 42/42 (39 cũ cộng 3 mới, gồm route thật trên PostgreSQL 18.6 riêng đã xóa và hồi quy `http-operations` 4/4); typecheck sạch; Biome 0 lỗi. Lần chạy GREEN đầu còn 2 fail do chính em (một nhánh sửa credential không áp được, và tập mã quá rộng cho 404); đã sửa rồi chạy lại, log là lần cuối.

- **N1:** chỉ ghi journal khi 200 hợp lệ hoặc status 400/403/404/409/422 mang đúng mã route cho status đó (bảng mã theo `tools.ts`, `store.ts`, `authority.ts`, cộng namespace `ORCHESTRATION_*`/`WORKFLOW_*` của consumer). Thiếu hoặc sai mã (404 mặc định của Fastify, 400 HTML của proxy, 403 không body, 409 mã lạ, 404 kèm mã của status khác) là `misconfigured`, không ghi, không retry, operation giữ mở và gọi lại được.
- **N3:** độ trễ = max(Retry-After, backoff hiện tại), trần 60s; `Retry-After: 0` vẫn ngủ 1s, 2s, 4s.
- **N4:** credential rỗng hoặc ngoài `[\x21-\x7e]` (CR/LF, khoảng trắng, ký tự ngoài ASCII) trả `unauthorized` (retryable sau khi sửa), không gửi, không retry.
- **R3:** đổi nhãn case thành "unexpected key `token` outside the ask_owner shape (shape check, not a secret scan)"; ý "không còn quét secret trong payload" đã có test riêng (khóa `password`/`secret` hợp lệ).
- **R1:** docs flow ghi journal `assistant-tools` của bản đầu không tương thích, phải xóa thư mục cũ trước khi mount; cũng ghi N2 (execute đồng thời có thể gửi hai request song song, server idempotent) và quy tắc N1/N3/N4.

Concerns: bảng mã 400/403/404/409/422 phải cập nhật khi route thêm mã mới (mã thiếu bị coi là `misconfigured`, không đầu độc journal nhưng chặn lời gọi tới khi sửa bảng). N5 (test route thật dùng error handler tự viết thay `buildApp`) PM đã ghi ledger.
