# Nhận sự kiện và lập lịch job

> Flow `daemon-scheduling`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow
> daemon-scheduling` in ra đúng danh sách đó.

## Mục đích

Giữ kết nối sự kiện realtime từ VPS (`GET /v1/daemon/stream`), biến mỗi sự kiện thành job cục bộ (hoặc gộp vào
job đang có) không mất không lặp, rồi quyết định job nào được chạy ngay theo slot máy còn trống, phụ thuộc
(`depends_on`) và ngân sách ticket.

## Điểm vào

- `apps/daemon/src/stream/stream-client.ts` → `StreamClient` — giữ kết nối SSE `/v1/daemon/stream`, resume từ
  cursor đã lưu.

## Các bước

1. `apps/daemon/src/stream/stream-client.ts` → `StreamClient.connectOnce()`: mở `GET /v1/daemon/stream` với
   header `Last-Event-ID` = cursor đã lưu (`state.getCursor()`); watchdog đóng kết nối khi im lặng quá
   `idleTimeoutMs` (mặc định 60s, server ping mỗi 20s); mất kết nối thì `run()` thử lại với backoff nhân đôi
   có jitter đầy đủ (`minBackoffMs`…`maxBackoffMs`).
2. `apps/daemon/src/stream/stream-client.ts` → `StreamClient.applyEnvelope()`: chạy `dispatchEvent()` và ghi
   cursor mới trong **cùng một transaction SQLite** — nên một crash giữ lại cả hai hoặc không giữ gì (sự kiện
   được phát lại từ cursor cũ). Sự kiện có id không mới hơn cursor bị bỏ qua (trùng lặp); sự kiện daemon
   không phân tích được vẫn dịch cursor tới qua `skipUnknown()`, nên một sự kiện lạ không bao giờ làm kẹt
   stream.
3. `apps/daemon/src/stream/dispatcher.ts` → `dispatchEvent()`: với `ticket.assigned`, `ticket.comment_added`,
   `children.all_done`, `ticket.reopened`, `ticket.unblocked`, `dependency.resolved` — nếu ticket chưa có job
   hoạt động thì tạo job mới (`enqueued`); nếu đã có job `queued`/`backoff` thì gộp id sự kiện vào job đó
   (`absorbed`); nếu job đang `running` thì ghi vào `pending_wakeups` (`folded`) chờ job kết thúc. Một job mới
   (không phải `ticket.assigned`) resume đúng loại job (`resumeKind()`): job cuối là
   `docs_init` thì tiếp tục `docs_init`; job cuối là `docs_update` từng `ask_owner` thì tiếp tục `docs_update`
   (câu trả lời của chủ dự án thuộc phiên đó); còn lại resume phiên `agent` (dev/PM/QC/assistant). `ticket.cancelled`
   hủy job `queued`/`backoff` ngay hoặc đánh dấu `cancelRequested` cho job `running`. `claim.changed` và
   `project.change_decided` (owner duyệt/từ chối máy tự đổi `platform`/`uiTestMcp`, flow `project-claims`) đều
   trả effect `refresh_projects` (không sinh job).
4. `apps/daemon/src/stream/dispatcher.ts` → `foldWakeups()`: gọi trong transaction kết thúc job, gộp mọi
   `pending_wakeups` của ticket thành đúng một job tiếp theo (hoặc nối vào job vừa được tạo trong cùng
   transaction, ví dụ job docs sau khi dev handoff).
5. `apps/daemon/src/stream/dispatcher.ts` → `wakeTicket()`: đánh thức nội bộ của daemon, không tới từ sự kiện
   VPS (ví dụ PM sau khi một subtask để lại tài nguyên, `wakePmForLeftovers()` ở flow `daemon-runtime`); áp
   đúng luật một-job-mỗi-ticket như `dispatchEvent()` (`folded`/`absorbed`/`enqueued`), gọi trong cùng
   transaction state.
6. `apps/daemon/src/daemon.ts` → `onEffect()`/`releaseLostProjects()`: sau effect `refresh_projects`, daemon
   gọi `refreshProjects()` rồi `releaseLostProjects()` — job (`running`/`queued`/`backoff`) của project không
   còn thuộc máy này bị hủy (`running`) hoặc chuyển `skipped` (`queued`/`backoff`); ghi ở flow `daemon-runtime`.
7. `apps/daemon/src/scheduler/resource-monitor.ts` → `totalSlots()`: `min(maxConcurrentJobs, floor(cpus/2))`,
   trả 0 khi RAM khả dụng dưới `minFreeMemGb` hoặc tải 1 phút trên mỗi CPU vượt `maxLoadPerCpu`; RAM khả dụng
   đọc qua `vm_stat` (macOS) hoặc `/proc/meminfo` (Linux) thay vì `os.freemem()` (bỏ sót cache có thể cấp
   phát).
8. `apps/daemon/src/scheduler/scheduler.ts` → `planSlots()`: job PM/assistant (`isCoordinatorRole`) được thêm
   một slot dự phòng ngoài `slots`, nên máy đầy vẫn nhận việc điều phối, lên kế hoạch và đóng ticket.
9. `apps/daemon/src/scheduler/scheduler.ts` → `Scheduler.pass()`: mỗi 5s (`tickMs`) xét từng job runnable
   (`runnableJobs()`: `queued` không chờ dependency, hoặc `backoff` đã tới `retryAt`); không còn slot thì ghi
   lý do chờ `no_slots` (`setWait()`) và bỏ qua job đó ở lượt này; còn slot thì gọi `decide()` (trong
   `daemon.ts`) — kiểm project còn thuộc máy và có thư mục cục bộ, trạng thái ticket, mọi `depends_on` đã
   `done` (không thì `waitingDeps: true` cộng lý do `waiting_deps` kèm khoá các ticket phụ thuộc chưa xong),
   rồi ngân sách qua `GET /v1/daemon/budget/:id` (`pm_task` vượt ngân sách cây trả `defer` với lý do
   `over_budget`, không phải `skip`, xem flow `daemon-runtime`); `decide()` ném lỗi thì lý do là `check_failed`.
   `setWait()` chỉ ghi `jobs.wait_reason`/`wait_detail` khi lý do đổi (máy bận không viết lại mỗi tick) và gọi
   `SchedulerDeps.onWaitChange` đúng một lần mỗi lần lý do đổi (`logWaitChange()` ở `daemon.ts`, flow
   `daemon-runtime`). `recheckWaiting()` xóa mọi cờ `waitingDeps` mỗi 60s và khi stream kết nối lại.
10. `apps/daemon/src/stream/stream-client.ts` → `HeartbeatLoop`: gửi heartbeat ngay khi `start()` rồi mỗi 30s
    (`intervalMs`); một lượt được yêu cầu trong khi lượt trước đang gửi được gộp và gửi ngay sau đó
    (`pause()`/`resume()` trong `daemon.ts` đều gọi `tick()` một lần để phản ánh ngay, cũng như `reportSoon()`
    mỗi khi một job đổi trạng thái hay đổi lý do chờ, flow `daemon-runtime`). Nội dung mỗi heartbeat do
    `apps/daemon/src/daemon.ts` → `heartbeat()` dựng và gửi qua `POST /v1/daemon/heartbeat`: tài nguyên máy
    (gồm `orphansCleaned`), job đang `running`/`queued`/`backoff` (kèm lý do chờ) và job vừa `failed`, cờ
    `paused`, phiên bản runtime Claude (`sdkRuntimeVersion()` lúc khởi động, cập nhật từ `system/init` của mỗi
    run), health summary tùy chọn; response lưu `tokenExpiresAt` vào `meta`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/daemon/src/stream/stream-client.ts` | Kết nối SSE, resume cursor, heartbeat | `StreamClient`, `HeartbeatLoop`, `parseSseFrames` |
| `apps/daemon/src/stream/dispatcher.ts` | Ánh xạ sự kiện → job cục bộ | `dispatchEvent`, `foldWakeups`, `wakeTicket`, `DispatchEffect` |
| `apps/daemon/src/scheduler/scheduler.ts` | Chọn job chạy trong giới hạn slot | `Scheduler`, `planSlots`, `runnableJobs`, `isCoordinatorRole`, `StartDecision` |
| `apps/daemon/src/scheduler/resource-monitor.ts` | Snapshot tài nguyên máy và số slot | `takeSnapshot`, `totalSlots`, `availableMemBytes` |

## Dữ liệu

- Bảng: đọc/ghi `meta` (cursor), `jobs`, `pending_wakeups` của `apps/daemon/src/state-db.ts` (flow
  `daemon-runtime`) trong cùng transaction với mỗi sự kiện.
- Sự kiện: tiêu thụ mọi `EventEnvelope` của `/v1/daemon/stream` (định nghĩa ở
  `packages/shared/src/event-schemas.ts`, flow `event-delivery` phía server); không tự phát sự kiện mới.
- Gọi ngoài: `GET /v1/daemon/stream` (SSE), `GET /v1/daemon/tickets/:id`, `GET /v1/daemon/budget/:id`,
  `POST /v1/daemon/heartbeat` (mỗi 30s) qua `VpsClient` (flow `daemon-runtime`).

## Flow liên quan

- daemon-runtime: `StreamClient` và `Scheduler` được tạo trong `createDaemon()`; `decide()` và
  `releaseLostProjects()` sống trong `daemon.ts`.
- agent-runs: `Scheduler.launch()` gọi `JobRunner.launch()` khi một job được phép chạy.
- agent-roles: `resumeKind()` resume đúng loại job (`docs_init`/`docs_update`/`agent`) khi một sự kiện của chủ
  dự án tạo job mới; `wakeTicket()` được `wakePmForLeftovers()` (flow `daemon-runtime`) gọi.
- daemon-api / event-delivery: nguồn sự kiện và route `/v1/daemon/stream` phía server.
- project-claims: `project.change_decided` (kết quả owner duyệt máy tự đổi `platform`/`uiTestMcp` của
  project) ánh xạ sang `refresh_projects` như `claim.changed`.

## Tests

- `apps/daemon/test/stream-client.test.ts`: phát lại từ cursor đã lưu sau khi mất kết nối không mất, không
  lặp sự kiện; `ticket.assigned` thật tạo đúng job `queued` cho đúng vai trò; token bị từ chối vẫn thử lại có
  backoff.
- `apps/daemon/test/stream-atomicity.test.ts`: crash giữa lúc chèn job và ghi cursor không giữ lại cái nào;
  trường hợp bình thường job và cursor được commit cùng nhau.
- `apps/daemon/test/dispatcher.test.ts`: `ticket.assigned` tạo đúng một job; bình luận chủ dự án đánh thức
  đúng loại job đã hỏi (`resumeKind()`: job docs resume phiên docs của chính nó, ticket `docs_init` resume
  `docs_init`, còn lại resume phiên `agent`); job `queued` hấp thụ sự kiện đến sau; hai wake-up của job đang
  chạy gộp thành đúng một job tiếp theo (kể cả khi job tiếp theo đã được tạo trong cùng transaction); bình
  luận chủ dự án resume session khi không có job hoạt động; `dependency.resolved` kiểm lại job đang chờ;
  `ticket.cancelled` hủy job `queued` ngay và đánh dấu job `running`; sự kiện không có job bị bỏ qua,
  `claim.changed` và `project.change_decided` đều yêu cầu refresh project.
- `apps/daemon/test/scheduler.test.ts`: công thức slot `min(maxConcurrentJobs, floor(cpus/2))` và 0 khi máy
  bận; PM/assistant có thêm một slot dự phòng; `runnableJobs()` liệt kê đúng job `queued` không chờ dependency
  và `backoff` đã tới hạn; `Scheduler` chạy tối đa `maxConcurrentJobs` job dev độc lập cùng lúc; job chờ
  dependency chạy khi kiểm lại thấy đã xong; job bị `skip`/`defer` được xử lý đúng; ghi đúng lý do chờ mỗi lần
  đổi (`no_slots` → `waiting_deps` → `no_local_folder` → `check_failed`) và báo `onWaitChange` đúng một lần mỗi
  lần đổi; scheduler tự tick theo timer.
