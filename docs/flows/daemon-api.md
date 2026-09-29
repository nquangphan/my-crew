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
   key, là bản thay toàn trạng thái mỗi 30s) gọi `recordHeartbeat()` — nay cũng lưu `failedJobs` và lý do chờ
   (`waitReason`/`waitDetail`) của mỗi `waitingJobs[]` (schema `HeartbeatRequest`, flow `machine-pairing`) vào
   bảng `machines` — rồi route còn ghi riêng `waitingJobs` của body (tối đa 500, job `queued`/`backoff` daemon
   đang giữ) vào `RouteDeps.waitingJobs` (`WaitingJobsRegistry`, flow `ticket-lifecycle`) theo máy, một bộ nhớ
   tạm khác phục vụ cảnh báo "ticket đứng yên"; `PUT /v1/daemon/skills` gọi `putInventory()`, cả hai từ
   `machine-service.ts` (flow `machine-pairing`).
4. `apps/api/src/routes/daemon-routes.ts` → project/claim: `GET/POST /v1/daemon/projects`,
   `POST/DELETE /v1/daemon/claims*`, `GET /v1/projects/catalog` (chỉ máy host assistant,
   `assertAssistantHost()`) gọi thẳng `claim-service.ts` (flow `project-claims`). Mỗi `DaemonProject` trong
   `GET /v1/daemon/projects` kèm `lastChange: {requestId, status} | null` (`ProjectChangeOutcome`, mặc định
   `null`) — yêu cầu đổi `platform`/MCP test UI mới nhất của chính máy đó cho project, dù trạng thái là gì
   (`pending`/`approved`/`rejected`/`withdrawn`) — và `bmadProfile: BmadProfile | null`, hồ sơ cài BMAD mới nhất
   mà một máy giữ project đã báo cáo, để bất kỳ máy nào cũng thấy được và tự cài lại qua "Cài BMAD" (flow
   `desktop-app`).
5. `apps/api/src/routes/daemon-routes.ts` → `POST /v1/daemon/projects/:projectKey/change-requests` (body
   `ProjectChangeBody`, cũng bọc `replyIdempotent()`) gọi `requestProjectChange()` — máy sở hữu project mới
   được đổi `platform`/`uiTestMcp` của nó, và chỉ có hiệu lực sau khi owner duyệt bằng TOTP (flow
   `project-claims`).
6. `apps/api/src/routes/bmad-profile-routes.ts` → `PUT /v1/daemon/projects/:projectKey/bmad-profile` (body
   `BmadProfile.strict()`, bọc `replyIdempotent()` như mọi ghi khác của daemon) gọi `putBmadProfile()` (flow
   `project-claims`) — chỉ máy sở hữu project mới ghi được (403 với máy khác), hồ sơ cũ hơn hồ sơ đã lưu không
   ghi đè.
7. `apps/api/src/routes/daemon-routes.ts` → ticket: `GET /v1/daemon/tickets/:id` đọc sau
   `assertTicketReadable()` (rộng hơn phạm vi ghi đúng một chỗ: PM đọc được ticket `request` cha của dự án
   mình, flow `machine-pairing`); `GET /v1/daemon/budget/:id` đọc sau `assertTicketInScope()`; `POST
   /v1/daemon/tickets` tạo subtask (kiểm `pm_task` chỉ được tạo bởi máy host assistant, dưới đúng `request`)
   và gọi `assertKnownCapabilities()` trước khi tạo — skill/MCP bắt buộc ngoài kho máy đã báo cáo (hoặc MCP bị
   tắt cho project) bị từ chối ngay, không tới lúc job chạy mới phát hiện; `POST .../bugs` gọi
   `assertKnownCapabilities()` cho `requiredSkills` của bug trước khi tạo (dùng cho cả QC báo lỗi lẫn PM từ
   chối một ticket dev/bug, flow `ticket-lifecycle`); các `ticketWrite()` còn lại — `POST .../comments`,
   `POST .../transition`, `PUT .../report`, `PATCH .../agent-meta` — gọi thẳng các hàm của flow
   `ticket-lifecycle` với `actor='agent'`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/daemon-routes.ts` | Toàn bộ route `/v1/daemon/*` và catalog | `daemonRoutes`, `ticketWrite` |
| `apps/api/src/routes/bmad-profile-routes.ts` | Route máy sở hữu project báo cáo hồ sơ cài BMAD | `daemonBmadProfileRoutes` |
| `apps/api/src/services/idempotency.ts` | Khoá + phát lại response ghi của daemon | `withIdempotency`, `replyIdempotent`, `readIdempotencyKey`, `purgeExpiredIdempotencyKeys` |

## Dữ liệu

- Bảng: `idempotency_keys` (sở hữu bởi flow này); đọc/ghi `tickets`, `comments`, `ticket_reports`, `projects`,
  `claim_requests`, `machines`, `machine_skills` qua các service của flow khác.
- Sự kiện: không tự định nghĩa loại sự kiện mới; mọi sự kiện phát ra là của flow `ticket-lifecycle`,
  `project-claims` hay `machine-pairing` mà route ở đây gọi tới.
- Gọi ngoài: không.

## Flow liên quan

- machine-pairing: `machineGuard`, `assertTicketInScope`, `assertTicketReadable`, `assertKnownCapabilities`,
  token/heartbeat/inventory.
- ticket-lifecycle: mọi ghi ticket của agent dùng chung hàm service với route owner; `fileBug()` phục vụ cả QC
  báo lỗi và PM từ chối (`reject_work`, flow `agent-roles`).
- project-claims: route project/claim của daemon gọi thẳng `claim-service.ts`; route change-requests gọi
  `project-change-service.ts`; route `bmad-profile` gọi `bmad-profile-service.ts` (schema `BmadProfile` ở
  `packages/shared/src/bmad-schemas.ts`, cũng thuộc flow đó).
- api-platform: `daemonRoutes` được đăng ký trong nhóm route bọc `machineGuard` tại `buildApp()`.
- ticket-lifecycle: `waitingJobs` ghi từ heartbeat được `startStuckTicketAlarm()` đọc để không báo nhầm ticket
  đang chờ thử lại là "đứng yên".
- agent-roles: PM đọc ticket `request` cha qua `GET /v1/daemon/tickets/:id`
  (`assertTicketReadable`) để lấy `ownerRequest()`; tool `create_subtask`/`file_bug` chạm
  `assertKnownCapabilities()` ở đây trước khi ghi.

## Tests

- `apps/api/test/machine-scope.test.ts`: máy B nhận 403 trên toàn bộ endpoint ticket của project máy A;
  `pm_task`/catalog chỉ máy host assistant; máy sở hữu dự án đọc được (nhưng không ghi được) ticket `request`
  phía trên `pm_task` của mình (`assertTicketReadable`); tạo ticket/bug với skill hay MCP ngoài kho máy đã báo
  cáo (hoặc MCP bị tắt cho project) bị từ chối (`assertKnownCapabilities`); retry idempotent phát lại đúng
  response đã lưu; hợp đồng chi phí; endpoint ngân sách; cảnh báo health đỏ; inventory.
- `apps/api/test/idempotency.test.ts`: khoá theo `(machine, key)`, TTL, `IDEMPOTENCY_KEY_REUSED` khi
  fingerprint khác, lưu cả lỗi có side effect đã commit.
