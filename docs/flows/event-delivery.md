# Phát sự kiện và SSE

> Flow `event-delivery`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow event-delivery`
> in ra đúng danh sách đó.

## Mục đích

Outbox sự kiện trong cùng transaction với thay đổi dữ liệu, phát tin cậy qua SSE tới daemon (`/v1/daemon/stream`,
chỉ sự kiện nhắm vào máy đó) và owner (`/v1/stream`, mọi sự kiện), với cursor resume không mất/không lặp sự
kiện, và ánh xạ sự kiện sang việc làm mới dữ liệu trên web.

## Điểm vào

- `apps/api/src/routes/stream-routes.ts` — `GET /v1/daemon/stream` (daemon), `GET /v1/stream`,
  `GET /v1/notices`, `POST /v1/notices/read`, `POST /v1/notices/read-all` (owner).
- `apps/web/src/lib/live-events.ts` → `startLiveEvents()` — mở kết nối SSE từ trình duyệt.

## Các bước

1. Mọi service khác (ticket-lifecycle, project-claims, machine-pairing…) gọi
   `apps/api/src/services/event-service.ts` → `appendEvents()`: validate từng payload bằng `EventPayload`
   (schema hợp đồng), insert vào bảng `events` trong transaction hiện tại, rồi `pg_notify('events_new')` —
   NOTIFY chỉ thật sự đến khi transaction đó commit.
2. Migration `0001_machine_auth_and_delivery.sql` gắn một deferred constraint trigger gán `events.seq`
   (bigserial riêng, khác `id`) tại thời điểm commit, dưới một advisory lock theo transaction. Vì vậy thứ tự
   `seq` luôn là thứ tự commit thật, kể cả khi các transaction bắt đầu insert không theo đúng thứ tự đó.
3. `apps/api/src/realtime/event-bus.ts` → `EventBus.start()`: đọc `latestEventSeq()` làm mốc, `LISTEN
   events_new` (tự nối lại nhờ postgres.js; mỗi lần nối lại đều gọi `wake()` để bắt kịp sự kiện đã lỡ), cộng
   thêm vòng poll dự phòng mỗi `pollMs` (mặc định 5s).
4. `apps/api/src/realtime/event-bus.ts` → `wake()` → `pump()`: gọi `listEventsAfter(cursor=lastSeq)`, phát
   từng sự kiện qua `dispatch()` — sự kiện tới toàn bộ subscriber owner (`machineId=null`), và chỉ tới
   subscriber của đúng `targetMachineId`.
5. `apps/api/src/realtime/sse.ts` → `openEventStream()`: (1) subscribe vào bus trước và đệm sự kiện live vào
   `buffer`; (2) replay các sự kiện đã commit có `seq > cursor` từ DB (`listEventsAfter`, phân trang 500); (3)
   flush `buffer`, bỏ qua phần đã gửi trùng nhờ so `seq`, rồi chuyển sang gửi trực tiếp — nhờ thứ tự này không
   sự kiện nào bị mất dù xen giữa bước 1 và 2. Client chậm hơn `MAX_BUFFERED_BYTES` (8MB) bị đóng kết nối để tự
   resume bằng cursor. Heartbeat (`: ping`) mỗi `heartbeatMs` re-check `stillAuthorized()`; false thì đóng.
   Xác thực chạy bất đồng bộ, nên bus có thể đã `bus.stop()` (`isStopped`) trước khi route này chạy tới; khi đó
   route không subscribe, trả 200 kèm header `connection: close`, chỉ ghi dòng `retry:` rồi đóng stream ngay —
   giống các stream mà `bus.stop()` đã đóng — để client tự reconnect. `res.on('close', close)` được gắn ngay
   sau `reply.hijack()`, trước `writeHead`; nếu `res.destroyed` đã `true` lúc đó (client ngắt kết nối trong lúc
   xác thực, trước khi listener tồn tại) thì gọi `close()` ngay — gỡ subscriber, không khởi động heartbeat —
   và `close()` không tự gọi `res.end()` trên một response đã destroyed.
6. `apps/api/src/routes/stream-routes.ts` → `daemonStreamRoutes`/`ownerStreamRoutes`: đọc cursor qua
   `readCursor()` (`Last-Event-ID` hoặc `?cursor=`; daemon mặc định 0, owner mặc định `bus.currentSeq` — chỉ
   nhận sự kiện mới); daemon dùng `stillAuthorized = authenticateTokenHash`, owner dùng
   `sessionStillValid()`.
7. `apps/web/src/lib/live-events.ts` → `startLiveEvents()`: mở `EventSource` tới `/v1/stream`, map mỗi
   `EventEnvelope` sang danh sách query key cần invalidate (`invalidationsFor()`; sự kiện ticket
   (`TICKET_KEYS`) làm mới `keys.tickets`/`['ticket']`/`['descendants']`/`['report']` cộng
   `keys.docsOverview` — vì trạng thái ticket `docs_init` là lý do trang chủ docs của flow `docs-sync-viewer`
   còn hiện "Chưa có docs"; `budget.exceeded` và `ticket.stuck` làm mới thêm danh sách thông báo của inbox,
   `agent.activity_changed` làm mới thêm ticket và máy liên quan, `ticket.pm_mentioned` làm mới ticket như
   `ticket.comment_added`/`ticket.status_changed`, `settings.changed` làm mới `keys.settings` cộng
   `keys.machines`/`['machine']` — vì trang cài đặt và trạng thái "đã nhận" của máy đều đổi,
   `machine.settings_applied` làm mới `keys.machines`/`['machine']` — flow `server-settings`;
   `machine.command`/`machine.command_updated` làm mới `['machineCommands']` cộng `keys.machines`/`['machine']`
   — một lệnh tạm dừng hay dò lại inventory cũng đổi hiện trạng máy, flow `machine-control`; `runtime.published`
   làm mới `keys.runtimeReleases` cộng `keys.machines`/`['machine']` — danh sách bản runtime và cột runtime
   của mỗi máy đều có thể đổi; `runtime.pinned`/`machine.runtime_changed` làm mới `keys.machines`/`['machine']`
   — cả ba của flow `runtime-updates`), gộp theo lô 100ms (`batchMs`). Khi trình duyệt tự đóng hẳn stream (`readyState CLOSED`), mở lại với
   `?cursor=<lastEventId>` sau `retryMs`, và invalidate toàn bộ query sau mỗi lần nối lại (vì có thể đã lỡ sự
   kiện lúc mất kết nối).
8. `apps/api/src/services/notice-read-service.ts` → `listOwnerNotices()`: mỗi thông báo (loại sự kiện trong
   `NOTICE_EVENT_TYPES`) kèm cờ `read` của owner (tra bảng `notice_reads` theo `seq`), cộng `unread` là số
   thông báo chưa đọc trong **toàn bộ lịch sử**, không chỉ trang đang lấy — đây là số cho badge Inbox.
   `markNoticesRead(ids)`/`markAllNoticesRead(throughId?)` ghi `notice_reads` (bỏ qua id không phải thông
   báo), rồi phát `inbox.read {unread}` trên owner stream để các thiết bị khác của owner làm mới ngay.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/stream-routes.ts` | Route SSE daemon/owner + notices | `daemonStreamRoutes`, `ownerStreamRoutes` |
| `apps/api/src/services/event-service.ts` | Outbox: ghi, đọc theo cursor, envelope | `appendEvents`, `listEventsAfter`, `latestEventSeq`, `toEventEnvelope`, `listNotices`, `listTicketEvents` |
| `apps/api/src/services/notice-read-service.ts` | Trạng thái đã đọc thông báo của owner | `listOwnerNotices`, `markNoticesRead`, `markAllNoticesRead` |
| `apps/api/src/realtime/event-bus.ts` | Fan-out trong tiến trình, LISTEN/NOTIFY + poll | `EventBus`, `wake`, `subscribe`, `revokeMachine`, `isStopped` |
| `apps/api/src/realtime/sse.ts` | Phục vụ một kết nối SSE, replay không mất sự kiện | `openEventStream`, `readCursor` |
| `packages/shared/src/event-schemas.ts` | Schema `EventPayload`/`EventEnvelope`, hằng số cursor/heartbeat | `EventPayload`, `EventEnvelope`, `STREAM_HEARTBEAT_MS`, `NOTICE_EVENT_TYPES` |
| `apps/web/src/lib/live-events.ts` | Kết nối SSE phía web, map sang invalidate query | `startLiveEvents`, `invalidationsFor` |

## Dữ liệu

- Bảng: `events` (outbox, sở hữu bởi flow này — cột `seq` là cursor phát); `notice_reads` (owner đã đọc
  thông báo nào, khoá `owner_id`+`event_seq`, cũng sở hữu bởi flow này qua `notice-read-service.ts`).
- Sự kiện: đây là hạ tầng phát mọi loại sự kiện định nghĩa ở `packages/shared/src/event-schemas.ts`, kể cả
  `ticket.stuck` (thêm vào `NOTICE_EVENT_TYPES`, chỉ owner stream — `targetMachineId=null`); các flow
  khác (ticket-lifecycle, project-claims, machine-pairing) là nguồn phát thật. `ticket.pm_mentioned` (owner tag
  `@pm` trên một ticket của cây pm_task, flow `ticket-lifecycle` → `addComment()`) nhắm đúng một máy
  (`targetMachineId` của chủ dự án, `targetRole: 'pm'`) như mọi sự kiện đánh thức daemon khác — nó thay hẳn
  `ticket.comment_added` của cùng bình luận đó, không phát cả hai. `inbox.read {unread}` (owner
  stream) là sự kiện riêng của flow này, phát mỗi lần `markNoticesRead()`/`markAllNoticesRead()` chạy, để mọi
  thiết bị của owner thấy cùng số chưa đọc. `agent.activity_changed {machineId, ticketIds}` (owner stream,
  không phải notice) phát bởi `recordHeartbeat()` (flow `machine-pairing`) khi báo cáo job của một ticket đổi.
  `settings.changed` (owner stream cộng mọi máy bị ảnh hưởng, không phải notice) phát bởi `saveRevision()` khi
  lưu/khôi phục một bản cài đặt; `machine.settings_applied {machineId, revision}` (owner stream) phát bởi
  `recordHeartbeat()` khi một máy báo bản mới — cả hai của flow `server-settings`. `machine.command
  {commandId, machineId, action}` (owner stream cộng đúng máy đó, không phải notice) phát bởi
  `createMachineCommand()` khi owner gửi một hành động từ web; `machine.command_updated {commandId, machineId,
  status}` (owner stream) phát mỗi lần lệnh đó đổi trạng thái — cả hai của flow `machine-control`.
  `runtime.published {version}` (owner stream cộng mọi máy còn sống, không phải notice) phát bởi
  `publishRelease()` khi một bản runtime đã ký được lưu; `runtime.pinned {machineId, version}` (owner stream
  cộng đúng máy đó) phát bởi `pinRuntime()` khi owner ghim/bỏ ghim; `machine.runtime_changed {machineId,
  version, state}` (owner stream) phát bởi `recordHeartbeat()` khi version/trạng thái/shell runtime một máy
  báo đổi — cả ba của flow `runtime-updates`.
- Gọi ngoài: không (chỉ Postgres LISTEN/NOTIFY nội bộ).

## Flow liên quan

- api-platform: `EventBus` được tạo/khởi động/dừng theo vòng đời `buildApp()`.
- machine-pairing: `EventBus.revokeMachine()`/`restoreMachine()` gọi từ `revokeMachine()` khi thu hồi máy;
  `recordHeartbeat()` phát `agent.activity_changed` qua `appendEvents()` khi báo cáo job của ticket đổi.
- ticket-lifecycle, project-claims: nguồn phát sự kiện chính qua `appendEvents()`; `project.change_requested`
  là một loại thông báo (`NOTICE_EVENT_TYPES`); `project.change_decided {status: approved/rejected/withdrawn}`
  nhắm đúng máy đã hỏi (`withdrawn` khi `withdrawProjectChanges()` tự rút yêu cầu vì máy đó mất project) —
  owner stream vẫn nhận vì không lọc theo `targetMachineId` (`invalidationsFor()` phía web làm mới
  `projectChanges`), chỉ là không phải loại thông báo trong `/v1/notices`.
- docs-sync-viewer: sự kiện `docs.synced` (định nghĩa ở event-schemas) khiến web làm mới `['docs']`; sự kiện
  ticket cũng làm mới `keys.docsOverview` của trang chủ docs (`/docs`).
- web-shell: `startLiveEvents()` được gắn vào app shell để mọi trang nhận cập nhật realtime.
- web-admin: trang Inbox gọi `markRead()`/`markAllRead()` (qua `useInboxSummary()`) và làm mới khi nhận
  `inbox.read` từ thiết bị khác của owner.
- server-settings: `settings.changed`/`machine.settings_applied` phát từ đó qua cùng `appendEvents()`;
  `invalidationsFor()` làm mới `keys.settings`/máy khi nhận.
- machine-control: `machine.command`/`machine.command_updated` phát từ đó qua cùng `appendEvents()`; daemon
  đang nghe `/v1/daemon/stream` nhận `machine.command` khi nhắm đúng máy (ánh xạ sang effect `run_command`,
  flow `daemon-scheduling`).
- runtime-updates: `runtime.published`/`runtime.pinned`/`machine.runtime_changed` phát từ đó qua cùng
  `appendEvents()`; daemon nghe được `runtime.published`/`runtime.pinned` (ánh xạ sang effect
  `runtime_changed`, flow `daemon-scheduling`) và báo main process kiểm lại runtime.

## Tests

- `apps/api/test/daemon-stream.test.ts`: kill/append 5 sự kiện/reconnect đủ cả 5 đúng thứ tự; chỉ sự kiện nhắm
  đúng máy được gửi; poll dự phòng hoạt động; LISTEN bị ngắt vẫn hồi phục; không mất sự kiện khi transaction
  commit không theo thứ tự id; `?cursor` được chấp nhận; request owner web tới assistant host dưới 1s; owner
  stream xử lý `Last-Event-ID` và auth.
- `apps/api/test/revoke-stream.test.ts`: thu hồi đóng stream đang mở ngay lập tức, token hết hạn đóng trong một
  heartbeat, đăng xuất đóng owner stream.
- `apps/web/src/lib/live-events.test.ts`: ánh xạ sự kiện (gồm sự kiện ticket cũng invalidate
  `keys.docsOverview`), resume theo cursor, invalidate sau khi nối lại.

`listOwnerNotices()`/`markNoticesRead()`/`markAllNoticesRead()` được kiểm bởi
`apps/api/test/owner-web-support.test.ts` (flow `ticket-lifecycle`, nơi test đó sống): đánh dấu một hay tất cả
đã đọc, dùng chung giữa các phiên đăng nhập của owner, phát đúng `inbox.read`.

Hai trường hợp `openEventStream()` đóng stream ngay khi bus đã dừng (subscribe sau khi shutdown, và client
ngắt kết nối trong lúc xác thực) được kiểm bởi `apps/api/test/shutdown.test.ts` (flow `api-platform`, nơi test
đó sống).
