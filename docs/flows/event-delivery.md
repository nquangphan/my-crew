# Phát sự kiện và SSE

> Flow `event-delivery`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow event-delivery`
> in ra đúng danh sách đó.

## Mục đích

Outbox sự kiện trong cùng transaction với thay đổi dữ liệu, phát tin cậy qua SSE tới daemon (`/v1/daemon/stream`,
chỉ sự kiện nhắm vào máy đó) và owner (`/v1/stream`, mọi sự kiện), với cursor resume không mất/không lặp sự
kiện, và ánh xạ sự kiện sang việc làm mới dữ liệu trên web.

## Điểm vào

- `apps/api/src/routes/stream-routes.ts` — `GET /v1/daemon/stream` (daemon), `GET /v1/stream` và
  `GET /v1/notices` (owner).
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
6. `apps/api/src/routes/stream-routes.ts` → `daemonStreamRoutes`/`ownerStreamRoutes`: đọc cursor qua
   `readCursor()` (`Last-Event-ID` hoặc `?cursor=`; daemon mặc định 0, owner mặc định `bus.currentSeq` — chỉ
   nhận sự kiện mới); daemon dùng `stillAuthorized = authenticateTokenHash`, owner dùng
   `sessionStillValid()`.
7. `apps/web/src/lib/live-events.ts` → `startLiveEvents()`: mở `EventSource` tới `/v1/stream`, map mỗi
   `EventEnvelope` sang danh sách query key cần invalidate (`invalidationsFor()`; `budget.exceeded` và
   `ticket.stuck` làm mới cả ticket lẫn danh sách thông báo của inbox), gộp theo lô 100ms
   (`batchMs`). Khi trình duyệt tự đóng hẳn stream (`readyState CLOSED`), mở lại với `?cursor=<lastEventId>`
   sau `retryMs`, và invalidate toàn bộ query sau mỗi lần nối lại (vì có thể đã lỡ sự kiện lúc mất kết nối).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/stream-routes.ts` | Route SSE daemon/owner + notices | `daemonStreamRoutes`, `ownerStreamRoutes` |
| `apps/api/src/services/event-service.ts` | Outbox: ghi, đọc theo cursor, envelope | `appendEvents`, `listEventsAfter`, `latestEventSeq`, `toEventEnvelope`, `listNotices`, `listTicketEvents` |
| `apps/api/src/realtime/event-bus.ts` | Fan-out trong tiến trình, LISTEN/NOTIFY + poll | `EventBus`, `wake`, `subscribe`, `revokeMachine` |
| `apps/api/src/realtime/sse.ts` | Phục vụ một kết nối SSE, replay không mất sự kiện | `openEventStream`, `readCursor` |
| `packages/shared/src/event-schemas.ts` | Schema `EventPayload`/`EventEnvelope`, hằng số cursor/heartbeat | `EventPayload`, `EventEnvelope`, `STREAM_HEARTBEAT_MS`, `NOTICE_EVENT_TYPES` |
| `apps/web/src/lib/live-events.ts` | Kết nối SSE phía web, map sang invalidate query | `startLiveEvents`, `invalidationsFor` |

## Dữ liệu

- Bảng: `events` (outbox, sở hữu bởi flow này — cột `seq` là cursor phát).
- Sự kiện: đây là hạ tầng phát mọi loại sự kiện định nghĩa ở `packages/shared/src/event-schemas.ts`, kể cả
  `ticket.stuck` (thêm vào `NOTICE_EVENT_TYPES`, chỉ owner stream — `targetMachineId=null`); các flow khác
  (ticket-lifecycle, project-claims, machine-pairing) là nguồn phát thật.
- Gọi ngoài: không (chỉ Postgres LISTEN/NOTIFY nội bộ).

## Flow liên quan

- api-platform: `EventBus` được tạo/khởi động/dừng theo vòng đời `buildApp()`.
- machine-pairing: `EventBus.revokeMachine()`/`restoreMachine()` gọi từ `revokeMachine()` khi thu hồi máy.
- ticket-lifecycle, project-claims: nguồn phát sự kiện chính qua `appendEvents()`.
- docs-sync-viewer: sự kiện `docs.synced` (định nghĩa ở event-schemas) khiến web làm mới `['docs']`.
- web-shell: `startLiveEvents()` được gắn vào app shell để mọi trang nhận cập nhật realtime.

## Tests

- `apps/api/test/daemon-stream.test.ts`: kill/append 5 sự kiện/reconnect đủ cả 5 đúng thứ tự; chỉ sự kiện nhắm
  đúng máy được gửi; poll dự phòng hoạt động; LISTEN bị ngắt vẫn hồi phục; không mất sự kiện khi transaction
  commit không theo thứ tự id; `?cursor` được chấp nhận; request owner web tới assistant host dưới 1s; owner
  stream xử lý `Last-Event-ID` và auth.
- `apps/api/test/revoke-stream.test.ts`: thu hồi đóng stream đang mở ngay lập tức, token hết hạn đóng trong một
  heartbeat, đăng xuất đóng owner stream.
- `apps/web/src/lib/live-events.test.ts`: ánh xạ sự kiện, resume theo cursor, invalidate sau khi nối lại.
