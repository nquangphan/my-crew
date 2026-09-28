# Ghép máy và xác thực máy

> Flow `machine-pairing`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow machine-pairing`
> in ra đúng danh sách đó.

## Mục đích

Ghép một máy cục bộ mới (desktop app hoặc CLI) với hệ thống bằng mã pairing một lần do owner tạo, cấp và xoay
token bearer cho máy, xác thực mọi request `/v1/daemon/*`, và thu hồi máy (kèm dọn token/claim). Cũng gồm
heartbeat và kho skill/MCP inventory theo máy/project, và việc quét máy im lặng thành offline.

## Điểm vào

- `apps/api/src/routes/machine-routes.ts` — `pairRoutes` (`POST /v1/machines/pair`, public) và `machineRoutes`
  (owner: `POST /v1/machines/pairing-codes`, `GET /v1/machines`, `GET /v1/machines/:id`,
  `POST /v1/machines/:id/revoke`, cùng các route claim mô tả ở flow `project-claims`).

## Các bước

1. `apps/api/src/routes/machine-routes.ts` → `machineRoutes` (`POST /v1/machines/pairing-codes`): owner gửi mã
   TOTP, gọi `createPairingCode()`.
2. `apps/api/src/services/machine-service.ts` → `createPairingCode()`: xác nhận lại TOTP bằng
   `verifyOwnerTotp()` (từ flow owner-auth), sinh mã 12 ký tự base32, hết hạn sau
   `PAIRING_CODE_TTL_MINUTES`, chỉ lưu SHA-256 của mã vào bảng `pairing_codes`.
3. `apps/api/src/routes/machine-routes.ts` → `pairRoutes` (`POST /v1/machines/pair`): route public, giới hạn
   10 lần/phút, nhận `PairMachineRequest`, gọi `pairMachine()`.
4. `apps/api/src/services/machine-service.ts` → `pairMachine()`: trong một transaction — đánh dấu mã đã dùng
   (`used_at`, chỉ chấp nhận mã chưa dùng và chưa hết hạn), tạo hàng `machines` mới, lưu inventory ban đầu nếu
   có (`saveInventory`), rồi `issueToken()` cấp token `crew_mt_...` một lần duy nhất (chỉ lưu hash).
5. `apps/api/src/auth/machine-auth.ts` → `machineGuard()`: hook `onRequest` cho mọi route daemon — đọc header
   `Authorization: Bearer`, gọi `authenticateTokenHash()`.
6. `apps/api/src/auth/machine-auth.ts` → `authenticateTokenHash()`: kiểm tra token chưa bị `revoked_at`, chưa
   hết hạn và máy chưa bị thu hồi trong một câu truy vấn, rồi cập nhật `last_seen_at`/`online=true` (throttle
   theo `TOUCH_INTERVAL_SECONDS=30`) — đây là cách một máy offline tự "sống lại".
7. `apps/api/src/services/machine-service.ts` → `rotateToken()`: cấp token mới, token cũ còn hiệu lực thêm tối
   đa `ROTATION_GRACE_MS` (10 phút) rồi hết hạn (dùng `least()` trên `expires_at`).
8. `apps/api/src/services/machine-service.ts` → `revokeMachine()`: trong transaction — gọi
   `releaseEverything()` (flow `project-claims`) để giải phóng mọi claim, đặt `revoked_at`/`hosts_assistant
   = false` trên `machines`, thu hồi mọi `machine_tokens`, phát event, và đóng stream SSE đang mở qua
   `bus.revokeMachine()` trước khi transaction commit (rollback thì `bus.restoreMachine()`).
9. `apps/api/src/services/machine-service.ts` → `recordHeartbeat()`, `putInventory()`: heartbeat ghi đè
   `resources`/`running_jobs`/`health`/`paused`, phát `machine.unhealthy` một lần khi health chuyển sang đỏ;
   `putInventory()` ghi đè kho skill/MCP theo máy (`projectKey=null`) hoặc theo project mà máy đó sở hữu.
10. `apps/api/src/jobs/heartbeat-sweeper.ts` → `sweepOfflineMachines()`: chạy mỗi `SWEEP_INTERVAL_MS` (1
    phút), đặt `online=false` cho máy có `last_seen_at` cũ hơn `OFFLINE_AFTER_MS` (5 phút) và phát một
    `machine.offline` mỗi máy.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/machine-routes.ts` | Route pairing, danh sách/chi tiết/thu hồi máy | `pairRoutes`, `machineRoutes` |
| `apps/api/src/auth/machine-auth.ts` | Guard bearer token, phạm vi ticket theo máy | `machineGuard`, `authenticateTokenHash`, `assertTicketInScope`, `assertAssistantHost` |
| `apps/api/src/services/machine-service.ts` | Pairing, token, inventory, heartbeat, thu hồi | `pairMachine`, `rotateToken`, `revokeMachine`, `recordHeartbeat`, `putInventory`, `listMachines`, `getMachineDetail` |
| `apps/api/src/jobs/heartbeat-sweeper.ts` | Quét máy im lặng thành offline | `sweepOfflineMachines`, `startHeartbeatSweeper` |

## Dữ liệu

- Bảng: `pairing_codes`, `machine_tokens`, `machines`, `machine_skills` (inventory).
- Sự kiện: `machine.unhealthy` (health chuyển đỏ), `machine.offline` (sweep). `machine.claimed`,
  `machine.released` phát từ flow `project-claims` khi thu hồi giải phóng claim.
- Gọi ngoài: không.

## Flow liên quan

- owner-auth: `verifyOwnerTotp()` xác nhận owner trước khi tạo mã pairing.
- project-claims: `revokeMachine()` gọi `releaseEverything()` để giải phóng project/assistant máy đang giữ.
- daemon-api: mọi route `/v1/daemon/*` dùng `machineGuard()` và `assertTicketInScope()` định nghĩa ở đây.
- event-delivery: `revokeMachine()` đóng stream SSE qua `EventBus.revokeMachine()`.
- web-admin: trang Máy hiển thị danh sách/chi tiết máy và hành động tạo mã pairing, thu hồi.

## Tests

- `apps/api/test/pairing.test.ts`: bắt buộc TOTP, giới hạn tần suất, chỉ lưu hash, mã dùng một lần/hết hạn,
  tách bearer/cookie, ân hạn khi xoay token.
- `apps/api/test/sweeper.test.ts`: đánh dấu offline một lần, quay lại online, bỏ qua máy đã bị thu hồi.
