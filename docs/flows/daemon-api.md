# REST API cho daemon

> Flow `daemon-api`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow daemon-api` in ra
> đúng danh sách đó.

## Mục đích

Tập hợp mọi route `/v1/daemon/*` (và `/v1/projects/catalog`) mà daemon trên máy cục bộ gọi thay cho agent:
token, heartbeat, inventory, project/claim, và ghi ticket (`actor='agent'`). Route này là nơi hợp nhất
`machineGuard`, kiểm tra phạm vi ticket theo máy, và bọc idempotency cho mọi request ghi.

## Điểm vào

- `apps/api/src/routes/daemon-routes.ts` — đăng ký trong nhóm route daemon của `buildApp()` (bọc
  `machineGuard`, xem flow `api-platform`).

## Các bước

1. `apps/api/src/routes/daemon-routes.ts` → `ticketWrite()`: helper dựng route ghi trên một ticket trong
   phạm vi máy — lấy `machine` từ `requireMachine()`, parse body, rồi bọc toàn bộ trong
   `replyIdempotent()`; bên trong transaction mới `getTicketRow()` rồi `assertTicketInScope()`, để phạm vi
   luôn được đọc mới nhất ngay trước khi ghi.
2. `apps/api/src/services/idempotency.ts` → `replyIdempotent()` → `withIdempotency()`: đọc header
   `Idempotency-Key` bắt buộc (`readIdempotencyKey`), tính fingerprint (method + path cụ thể + hash body),
   khoá advisory theo `(machineId, key)`, chạy handler trong cùng transaction lưu response — nên một crash
   giữa chừng không bao giờ để lại ghi mà thiếu response đã lưu. Response được thay thế (replay) khi key dùng
   lại với cùng fingerprint; dùng lại với fingerprint khác trả `IDEMPOTENCY_KEY_REUSED` (422). Lỗi thường thì
   rollback và không lưu; lỗi có `sideEffectsCommitted=true` (ví dụ `CHILD_CAP_EXCEEDED`) vẫn được lưu và phát
   lại.
3. `apps/api/src/routes/daemon-routes.ts` → token/heartbeat/inventory: `POST /v1/daemon/token/rotate` (không
   cần Idempotency-Key vì response là secret) gọi `rotateToken()`; `POST /v1/daemon/heartbeat` (không cần
   key, là bản thay toàn trạng thái mỗi 30s) gọi `recordHeartbeat()`; `PUT /v1/daemon/skills` gọi
   `putInventory()`, cả hai từ `machine-service.ts` (flow `machine-pairing`).
4. `apps/api/src/routes/daemon-routes.ts` → project/claim: `GET/POST /v1/daemon/projects`,
   `POST/DELETE /v1/daemon/claims*`, `GET /v1/projects/catalog` (chỉ máy host assistant,
   `assertAssistantHost()`) gọi thẳng `claim-service.ts` (flow `project-claims`).
5. `apps/api/src/routes/daemon-routes.ts` → ticket: `GET /v1/daemon/tickets/:id`,
   `GET /v1/daemon/budget/:id` đọc trực tiếp sau khi kiểm tra scope; `POST /v1/daemon/tickets` tạo subtask
   (kiểm `pm_task` chỉ được tạo bởi máy host assistant, dưới đúng `request`); các `ticketWrite()` còn lại —
   `POST .../comments`, `POST .../transition`, `PUT .../report`, `POST .../bugs`, `PATCH .../agent-meta` — gọi
   thẳng các hàm của flow `ticket-lifecycle` với `actor='agent'`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/daemon-routes.ts` | Toàn bộ route `/v1/daemon/*` và catalog | `daemonRoutes`, `ticketWrite` |
| `apps/api/src/services/idempotency.ts` | Khoá + phát lại response ghi của daemon | `withIdempotency`, `replyIdempotent`, `readIdempotencyKey`, `purgeExpiredIdempotencyKeys` |

## Dữ liệu

- Bảng: `idempotency_keys` (sở hữu bởi flow này); đọc/ghi `tickets`, `comments`, `ticket_reports`, `projects`,
  `claim_requests`, `machines`, `machine_skills` qua các service của flow khác.
- Sự kiện: không tự định nghĩa loại sự kiện mới; mọi sự kiện phát ra là của flow `ticket-lifecycle`,
  `project-claims` hay `machine-pairing` mà route ở đây gọi tới.
- Gọi ngoài: không.

## Flow liên quan

- machine-pairing: `machineGuard`, `assertTicketInScope`, token/heartbeat/inventory.
- ticket-lifecycle: mọi ghi ticket của agent dùng chung hàm service với route owner.
- project-claims: route project/claim của daemon gọi thẳng `claim-service.ts`.
- api-platform: `daemonRoutes` được đăng ký trong nhóm route bọc `machineGuard` tại `buildApp()`.

## Tests

- `apps/api/test/machine-scope.test.ts`: máy B nhận 403 trên toàn bộ 9 endpoint ticket của project máy A;
  `pm_task`/catalog chỉ máy host assistant; retry idempotent phát lại đúng response đã lưu; hợp đồng chi phí;
  endpoint ngân sách; cảnh báo health đỏ; inventory.
- `apps/api/test/idempotency.test.ts`: khoá theo `(machine, key)`, TTL, `IDEMPOTENCY_KEY_REUSED` khi
  fingerprint khác, lưu cả lỗi có side effect đã commit.
