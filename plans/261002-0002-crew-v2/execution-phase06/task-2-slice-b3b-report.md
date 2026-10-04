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
