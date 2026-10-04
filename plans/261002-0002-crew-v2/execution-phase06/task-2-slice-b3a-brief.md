# Brief B3a — Route tool của Trợ lý (server) — 04/10/2026

Nguồn chuẩn: `phase-06-assistant-workflows.md` mục "## R2 — Local inference → durable production tool protocol" (RoutingTool, RoutingToolRequest, RoutingToolResult, RoutingToolConsumer, đoạn "Driver emits RoutingEvent…" và "Consumer mapping"). Ruling PM nằm ở `execution-phase06/progress.md` và `pm-next-slices-memo-261004.md` (A2, A3, A7). Brief này chỉ gom các ràng buộc đã chốt; khi mâu thuẫn, spec `docs/superpowers/specs/2026-10-01-crew-v2-design.md` thắng, rồi tới phase-06, rồi tới brief.

## Phạm vi B3a

Server route `POST /v2/assistant/turns/:id/tools` nhận `RoutingToolRequest`, trả `RoutingToolResult`, cùng consumer cho các tool đã có producer được nghiệm thu:

- `read_catalog`, `read_docs` → dịch vụ docs/catalog hiện có + read receipt 011 `(id, turn_id, snapshot_id, path, sha256)`.
- `create_run` → `runs.createRunRequest` rồi `createRun` (S4, `01367a9`).
- `ask_owner` → `createOwnerQuestion` (S5, `cb02a7d`).

Mọi tool khác trong union (`route_message`, `read_execution_candidates`, `assess_ticket`, `request_dispatch`, `request_review`, `publish_reply`) trả `state:'rejected'`, `errorCode:'TOOL_NOT_RELEASED'`, không ghi effect. Gateway `tool-client.ts`/driver không thuộc B3a.

Production assembly không inject port/resolver (vẫn 503) trừ khi PM release riêng; test dùng `seedAdmittedTurn` thật, không test-trust port.

## Ràng buộc bắt buộc (đã chốt qua review)

1. Xác thực trước mọi thứ: machine A đã xác thực, turn/process/generation/designation/fence, exact current snapshot/receipts, `tool_names`/action scope và budget — **trước** idempotency replay. Model không mint được scopeId hay nới quyền.
2. Chống dò tồn tại: resolve proof → scope **trước** mọi query ticket; mọi lỗi trước bước này trả cùng một mã/hình dạng (B2a ⚠️, S2 W9, S4 W9).
3. Binding: mọi row `assistant_tool_operations` mang `request_hash = operationRequestSha256({action, payload})` (tag `crew-v2:operation-request:1`, `v2/server/src/assistant/operation-request.ts`). Mọi tool, kể cả tool chưa release, phải băm bằng đúng hàm này. `create_run` dùng canonical input của createRun với graphSha256 server tự tính.
4. Thứ tự ghi: row operation pending được ghi **trong cùng Tx, trực tiếp (không trong savepoint), trước khi gọi port**; caller giữ `event_cursor` trước root như `mutate()` (S2 W4/W5, S5 M1). B3a chỉ gọi `createRunRequest` sau khi resolve proof → scope bên trong `mutate()` (S4 N2).
5. Replay: idempotency theo `(turn, providerCallId/clientSequence, operationId)`; replay **chỉ đọc kết quả đã lưu**, không UPDATE/upsert lại row pending cũ (S2 N2). Duplicate provider/operation ID với payload khác → 409.
6. Một port mỗi assembly (S2 N1).
7. Actor: so máy đã xác thực với actor resolver trả về (S4 W2); dependency/ticket do tool tạo mang actor A + provenance tool-operation (B2a ⚠️).
8. All-or-nothing: lỗi sau lần ghi đầu → rollback toàn Tx (S4 W4).
9. Mỗi tool chỉ nhận đúng kind `RoutingToolValue` tương ứng; tool lạ → rejected, không lưu JSON tùy ý.
10. `ask_owner`: câu hỏi không có ticket hiện trả 422 (S5); wait intent (phase-06:226) chưa làm — ghi rõ pending.

## RED tối thiểu

Unknown tool; sai fence/process/generation/designation; sai/stale input snapshot; scope/tool_names không cho phép; budget vượt; hash lệch payload; replay trả đúng kết quả cũ không ghi thêm; duplicate operationId payload khác 409; response mất trước/sau commit (đếm effect đúng 1); tool chưa release trả rejected không effect; create_run và ask_owner thành công qua route thật với DB riêng; mọi lỗi trước resolve có cùng hình dạng (không dò được tồn tại).

## Ownership

Tạo `v2/server/src/assistant/tools.ts` (consumer + route), `v2/server/test/assistant-tools-route.test.ts`; sửa hẹp `v2/server/src/assistant/routes.ts` để đăng ký route; docs flow `server-assistant`. Không sửa authority/orchestration/runs/gates/operation-request (đã nghiệm thu) — cần đổi thì NEEDS_CONTEXT. Không migration, không app.ts/main.ts (production chưa mount; test qua buildApp với cấu hình test riêng nếu harness cho phép, nếu không thì Fastify instance test với route thật).
