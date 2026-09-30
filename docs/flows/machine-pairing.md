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

1. `apps/api/src/routes/machine-routes.ts` → `machineRoutes` (`POST /v1/machines/pairing-codes`): owner đã
   đăng nhập (session + CSRF, không cần body) gọi `createPairingCode()`.
2. `apps/api/src/services/machine-service.ts` → `createPairingCode()`: sinh mã 12 ký tự base32, hết hạn sau
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
7. `apps/api/src/auth/machine-auth.ts` → `assertTicketReadable()`/`assertTicketInScope()`: phạm vi ghi
   (`assertTicketInScope`) là ticket `request` trên máy host assistant, hoặc ticket có `projectId` thuộc dự án
   máy sở hữu — đọc lại mới mỗi request. Phạm vi đọc (`assertTicketReadable`, dùng cho
   `GET /v1/daemon/tickets/:id`) rộng hơn đúng một trường hợp: ticket `request` phía trên một `pm_task` của dự
   án máy này sở hữu cũng đọc được, để PM đọc nguyên văn yêu cầu gốc của chủ dự án (`ownerRequest()`, flow
   `agent-roles`) — ghi trên ticket `request` đó vẫn chỉ dành cho máy host assistant.
8. `apps/api/src/services/machine-service.ts` → `assertKnownCapabilities()`: skill/MCP bắt buộc của một ticket
   mới phải nằm trong kho máy đã báo cáo cho dự án đó (theo project cộng theo máy); MCP server bị chủ dự án tắt
   cho project (`disabled: true` trong `machine_skills.mcpServers`, xem bước 9) coi như không có. Kho chưa từng
   được báo cáo thì từ chối luôn (không thể kiểm tra). Không rõ tên nào trả `VALIDATION_FAILED` kèm danh sách
   trong `details`.
9. `apps/api/src/services/machine-service.ts` → `rotateToken()`: cấp token mới, token cũ còn hiệu lực thêm tối
   đa `ROTATION_GRACE_MS` (10 phút) rồi hết hạn (dùng `least()` trên `expires_at`).
10. `apps/api/src/services/machine-service.ts` → `revokeMachine()`: trong transaction — gọi
    `releaseEverything()` (flow `project-claims`) để giải phóng mọi claim (`bindScope()` cũng rút luôn mọi yêu
    cầu đổi platform/MCP test UI còn `pending` của project máy đó vừa mất, phát `project.change_decided
    {status: 'withdrawn'}` cho máy đó — một duyệt/từ chối muộn sau đó nhận `CONFLICT` 409), đặt
    `revoked_at`/`hosts_assistant = false` trên `machines`, thu hồi mọi `machine_tokens`, phát event, và đóng
    stream SSE đang mở qua `bus.revokeMachine()` trước khi transaction commit (rollback thì
    `bus.restoreMachine()`).
11. `apps/api/src/services/machine-service.ts` → `recordHeartbeat()`, `putInventory()`: heartbeat ghi đè
    `resources`/`running_jobs`/`waiting_jobs`/`failed_jobs`/`health`/`paused`, phát `machine.unhealthy` một lần
    khi health chuyển sang đỏ. Trước khi ghi đè, so `activitySignatures()` (bỏ số tải/RAM/slot, flow
    `ticket-lifecycle`) của báo cáo cũ và mới; ticket nào đổi (hoặc mọi ticket của cả hai bên, khi báo cáo cũ đã
    đọc thành `unknown` — `heartbeatFresh()`) được gộp vào đúng một `agent.activity_changed {machineId,
    ticketIds}` (owner stream). Heartbeat cũng mang `settings: MachineSettingsState` (bản cài đặt server, flow
    `server-settings`, máy áp cho job kế tiếp) — ghi vào `machines.settings_state`; đổi so với bản đã lưu thì
    phát thêm `machine.settings_applied {machineId, revision}` (owner stream), để web thấy ngay lúc máy nhận
    một bản mới mà không cần tự poll. `HeartbeatRequest.waitingJobs` còn được route daemon ở flow `daemon-api` ghi
    riêng vào `WaitingJobsRegistry` (bộ nhớ tạm, không phải cột `machines`) để nuôi cảnh báo "ticket đứng yên"
    của flow `ticket-lifecycle` — hai nơi lưu độc lập cùng dữ liệu heartbeat cho hai mục đích khác nhau.
    `putInventory()` ghi đè kho skill/MCP theo máy (`projectKey=null`) hoặc theo project mà máy đó sở hữu —
    `InventoryMcpServer.disabled` (do daemon gửi lên khi chủ dự án tắt server đó cho project, flow
    `daemon-runtime`) được lưu nguyên vào `machine_skills` và đọc lại bởi `assertKnownCapabilities()`.
    Heartbeat của app desktop còn mang `runtime: MachineRuntimeState` (tuỳ chọn, hình dạng lạ bị bỏ qua thầm
    lặng — flow `runtime-updates`): ghi vào `machines.runtime_state`; version, trạng thái cập nhật hay phiên
    bản shell đổi so với lần trước thì phát thêm `machine.runtime_changed {machineId, version, state}` (owner
    stream) — web thấy ngay app/runtime của máy vừa đổi mà không cần tự poll. `toMachineDto()` (`listMachines`/
    `getMachineDetail`) lộ nó ra là `Machine.runtime {reported, pinnedVersion}` (`pinnedVersion` đọc từ
    `machines.runtime_pinned_version`, sửa qua `PUT /v1/machines/:id/runtime` của flow đó).
12. `apps/api/src/jobs/heartbeat-sweeper.ts` → `sweepOfflineMachines()`: chạy mỗi `SWEEP_INTERVAL_MS` (1
    phút), đặt `online=false` cho máy có `last_seen_at` cũ hơn `OFFLINE_AFTER_MS` (5 phút) và phát một
    `machine.offline` mỗi máy.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/machine-routes.ts` | Route pairing, danh sách/chi tiết/thu hồi máy | `pairRoutes`, `machineRoutes` |
| `apps/api/src/auth/machine-auth.ts` | Guard bearer token, phạm vi ticket theo máy | `machineGuard`, `authenticateTokenHash`, `assertTicketInScope`, `assertTicketReadable`, `assertAssistantHost` |
| `apps/api/src/services/machine-service.ts` | Pairing, token, inventory, heartbeat, thu hồi | `pairMachine`, `rotateToken`, `revokeMachine`, `recordHeartbeat`, `putInventory`, `assertKnownCapabilities`, `listMachines`, `getMachineDetail` |
| `apps/api/src/jobs/heartbeat-sweeper.ts` | Quét máy im lặng thành offline | `sweepOfflineMachines`, `startHeartbeatSweeper` |

## Dữ liệu

- Bảng: `pairing_codes`, `machine_tokens`, `machines`, `machine_skills` (inventory).
- Sự kiện: `machine.unhealthy` (health chuyển đỏ), `machine.offline` (sweep), `agent.activity_changed` (báo
  cáo job của một ticket đổi giữa hai heartbeat, owner stream — định nghĩa và tiêu thụ ở flow
  `ticket-lifecycle`/`event-delivery`), `machine.settings_applied` (heartbeat báo một bản cài đặt server mới,
  owner stream, flow `server-settings`), `machine.runtime_changed` (heartbeat báo version/trạng thái/shell
  runtime đổi, owner stream, flow `runtime-updates`). `machine.claimed`, `machine.released` phát từ flow
  `project-claims` khi thu hồi giải phóng claim.
- Gọi ngoài: không.

## Flow liên quan

- owner-auth: `ownerGuard` (session + CSRF) xác nhận owner trước khi tạo mã pairing.
- project-claims: `revokeMachine()` gọi `releaseEverything()` để giải phóng project/assistant máy đang giữ;
  máy tự đổi `platform`/`uiTestMcp` của project mình qua `POST /v1/daemon/projects/:projectKey/change-requests`
  (chờ owner xác nhận bằng một cú nhấp trên web) dùng chung kiểu dữ liệu `ProjectChangeBody`/`PendingProjectChange` sống trong
  `packages/shared/src/machine-schemas.ts` (file dùng chung bởi flow này) — cùng file, `DaemonProject` nay có
  thêm `bmadProfile` (hồ sơ cài BMAD mới nhất do một máy giữ project báo cáo, xem flow `project-claims`).
- daemon-api: mọi route `/v1/daemon/*` dùng `machineGuard()`, `assertTicketInScope()`/`assertTicketReadable()`
  định nghĩa ở đây; `POST /v1/daemon/tickets` và `.../bugs` gọi `assertKnownCapabilities()` trước khi tạo.
- ticket-lifecycle: `recordHeartbeat()` gọi `activitySignatures()`/`changedTicketIds()`/`heartbeatFresh()` của
  `agent-activity-service.ts` để phát `agent.activity_changed`; `AgentActivity` mà owner đọc trên ticket đọc lại
  `machines.runningJobs`/`waitingJobs`/`failedJobs` ghi ở đây.
- agent-roles: PM đọc ticket `request` cha qua `assertTicketReadable()` để lấy `ownerRequest()`; đăng ký
  skill/MCP thiếu bị `assertKnownCapabilities()` chặn ngay khi tạo, không phải chờ tới lúc chạy.
- event-delivery: `revokeMachine()` đóng stream SSE qua `EventBus.revokeMachine()`.
- server-settings: `recordHeartbeat()` ghi `machines.settings_state` và phát `machine.settings_applied`;
  `Machine.settings` (đọc lại ở `toMachineDto()`) và `expectedRevisions()` thuộc flow đó.
- runtime-updates: `recordHeartbeat()` ghi `machines.runtime_state` và phát `machine.runtime_changed`;
  `Machine.runtime`/`machines.runtime_pinned_version` và mọi cơ chế ký/tải/chuyển bản runtime thuộc flow đó.
- web-admin: trang Máy hiển thị danh sách/chi tiết máy và hành động tạo mã pairing, thu hồi.

## Tests

- `apps/api/test/pairing.test.ts`: chỉ cần session owner (không cần body), giới hạn tần suất, chỉ lưu hash,
  mã dùng một lần/hết hạn, tách bearer/cookie, ân hạn khi xoay token.
- `apps/api/test/sweeper.test.ts`: đánh dấu offline một lần, quay lại online, bỏ qua máy đã bị thu hồi.

`assertTicketReadable()` và `assertKnownCapabilities()` được kiểm bởi `apps/api/test/machine-scope.test.ts`
(flow `daemon-api`, nơi các route dùng chúng sống).
