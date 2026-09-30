# Điều khiển máy từ web (thao tác từ xa trong danh sách cho phép)

> Flow `machine-control`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow
> machine-control` in ra đúng danh sách đó.

## Mục đích

Chủ dự án điều khiển một máy đang sống ngay từ web, không cần mở app hay SSH vào máy: tạm dừng/cho chạy tiếp,
chạy kiểm tra sức khỏe và bấm fix, dò lại skill/MCP, cài BMAD lên máy đang giữ project, xem job gần đây, xem
log gần nhất, và gỡ project hoặc vai trò trợ lý khỏi máy. Chỉ đúng danh sách thao tác cố định này tồn tại
(kiểm ở cả server và daemon) — web không bao giờ chạy được một lệnh tuỳ ý trên máy. Daemon (hoặc app desktop
đang chạy daemon đó) thực thi và báo kết quả; web theo dõi tới khi xong.

## Điểm vào

- `apps/api/src/routes/machine-command-routes.ts` → `machineCommandRoutes` (owner: `POST/GET
  /v1/machines/:id/commands`, `GET /v1/machines/:id/commands/:commandId`) và `daemonCommandRoutes` (daemon:
  `POST /v1/daemon/commands/:commandId/start`, `POST /v1/daemon/commands/:commandId/result`).
- `apps/web/src/components/machine-control.tsx` → `MachineControl` — nút "Điều khiển" trên mỗi thẻ máy ở
  `/machines` (flow `web-admin`) mở khung này.

## Các bước

1. `packages/shared/src/machine-command-schemas.ts`: `MachineCommandRequest` là discriminated union theo
   `action` — `pause`, `resume`, `health.run {quick}`, `health.fix {group, fixId}`, `inventory.refresh
   {projectKey|null}`, `bmad.install {projectKey}`, `jobs.list`, `logs.tail {limit≤500, ticket?}`,
   `project.release {projectKey}`, `assistant.release` — mỗi action có schema kết quả riêng
   (`MACHINE_COMMAND_RESULT`, ví dụ `health.run`/`health.fix` trả `HealthReport`, `jobs.list` trả
   `JobView[]`) và hạn thời gian chạy riêng (`MACHINE_COMMAND_TIMEOUT_MS`, từ 30s cho `pause`/`resume` tới 20
   phút cho `bmad.install`). `MACHINE_COMMAND_TTL_MS` = 10 phút: một lệnh máy không nhận kịp trong 10 phút
   (máy tắt hoặc mất mạng) không bao giờ được chạy nữa, kể cả khi máy nối lại sau đó.
   `MachineCommandStatus`: `pending` (chờ máy nhận) → `running` (daemon đã nhận) → `done`/`failed` (có kết
   quả hoặc lỗi) hoặc `expired` (không nhận kịp).
2. `apps/api/drizzle/0008_server_settings_and_machine_commands.sql` (phần liên quan tới flow này): bảng
   `machine_commands` (`machine_id`, `action`, `params` jsonb, `status`, `result` jsonb nullable, `error`,
   `requested_by`, `created_at`/`started_at`/`finished_at`) — cùng migration này còn có bảng
   `settings_revisions` của flow `server-settings`, ngoài phạm vi flow này.
3. `apps/api/src/services/machine-command-service.ts` → `createMachineCommand()`: kiểm máy còn sống (chưa bị
   thu hồi), `expireStale()` đánh dấu mọi lệnh `pending` quá hạn của máy đó thành `expired` trước, rồi insert
   lệnh mới và phát `machine.command` hai lần trong cùng transaction — một bản owner stream, một bản nhắm
   đúng máy (`targetMachineId`) để daemon đang nghe `/v1/daemon/stream` thấy ngay. `startMachineCommand()`:
   daemon nhận lệnh (`pending` → `running`); lệnh đã `running` (start lại do mất phản hồi) trả nguyên trạng;
   quá `MACHINE_COMMAND_TTL_MS` thì chuyển `expired` và ném lỗi 409 (đã commit, để owner thấy đúng trạng thái
   hết hạn). `finishMachineCommand()`: validate `result` đúng schema của action đó
   (`MACHINE_COMMAND_RESULT[action]`) — sai dạng thì lưu thành `failed` với thông báo chung, không tin dữ
   liệu daemon gửi lên mù quáng; lệnh đã `done`/`failed` (báo lại do mất phản hồi) trả nguyên trạng, idempotent
   như mọi ghi của daemon. Mỗi lần đổi trạng thái đều phát `machine.command_updated` (owner stream).
4. `apps/api/src/routes/machine-command-routes.ts`: route owner validate `MachineCommandRequest` rồi gọi
   `createMachineCommand()`/`listMachineCommands()`/`getMachineCommand()`; route daemon bọc
   `replyIdempotent()` (flow `daemon-api`) quanh `startMachineCommand()`/`finishMachineCommand()` — một
   `POST .../start` hay `.../result` gọi lại vì mất mạng chỉ phát lại đúng response cũ, không chạy hai lần.
5. `apps/daemon/src/stream/dispatcher.ts` → `dispatchEvent()`: sự kiện `machine.command` (nhắm đúng máy) ánh
   xạ sang effect `run_command {commandId}` (không sinh job) — khác mọi sự kiện ticket khác của flow
   `daemon-scheduling`. `apps/daemon/src/daemon.ts` xử lý effect này bằng `inBackground(runMachineCommand(...))`
   ngay khi nhận được, không phải qua `Scheduler`.
6. `apps/daemon/src/remote/machine-commands.ts` → `runMachineCommand()`: `vps.startCommand()` (idempotency
   key theo `commandId`) — lệnh đã hết hạn hay đã kết thúc thì bỏ qua êm; validate lại **toàn bộ** bằng
   `MachineCommandRequest` (danh sách cho phép của chính máy này, không tin whitelist server đã kiểm là đủ);
   tra `handlers()[action]` — không có handler (action chỉ app desktop mới làm được, ví dụ `health.run` trên
   một daemon CLI trần) thì báo lỗi rõ bằng `MACHINE_COMMAND_LABEL`; có handler thì chạy với hạn thời gian của
   action (`withTimeout()`), rồi báo kết quả hoặc lỗi (`scrubSecrets()`, cắt 2000 ký tự) qua
   `vps.finishCommand()`. Không bao giờ throw ra ngoài `runMachineCommand()`.
7. `apps/daemon/src/daemon.ts` → `commandHandlers()`: daemon tự làm được `pause`/`resume` (gọi
   `daemon.pause()`/`resume()` — cùng cơ chế nút tạm dừng của CLI/app), `inventory.refresh` (re-probe skill/MCP
   máy hoặc một project, đòi máy đã có thư mục project đó), `jobs.list` (50 job gần nhất qua `jobView()`),
   `project.release`/`assistant.release` (gọi `VpsClient.release()` rồi làm mới project/cài đặt cục bộ, giống
   `crewd project release`/`crewd assistant off`). `options.commandHandlers` (spread sau cùng) cho phần chạy
   host (app desktop) thêm handler mà `crewd` CLI trần không có.
8. `apps/desktop/src/daemon-host/host-service.ts` → `commandHandlers` truyền vào `createDaemon()`: `health.run`/
   `health.fix` chạy đúng `HealthOps` dùng chung với `crewd doctor` (flow `daemon-health`) —
   `remoteFix()` định tuyến riêng: fix chỉ main process làm được (`APP_HEALTH_FIXES`, ví dụ mở Terminal đăng
   nhập Claude, bật login item, cài bản mới) được chuyển qua sự kiện host `app.fix` cho main xử lý rồi chạy lại
   health; fix `restart-daemon` bị từ chối hẳn khi gọi từ xa (`HostError`, "chỉ làm được trên máy") vì chính
   tiến trình host đang xử lý lệnh này sẽ không sống sót để báo kết quả. `bmad.install` gọi lại
   `installBmad()` (flow `desktop-app`). `logs.tail` đọc `Activity.tail()` rồi bọc từng dòng
   (`boundedLogLine()`: `scrubSecrets()` message/field, cắt độ dài) trước khi trả về.
9. `apps/desktop/src/main/index.ts`: nhận sự kiện host `app.fix` (`{fixId}`) và chạy fix đó nếu nằm trong
   `APP_FIXES` (`applyAppFix()`). Một pause/resume tới từ web (qua `daemon.status.paused` khác
   `supervisor.isPaused()`, chỉ khi daemon runtime đã khởi động hẳn) được giữ lại như một pause bấm từ tray
   (`supervisor.setPaused()`, `desktopState.update()`) — nên nó sống sót qua một lần daemon host khởi động lại,
   không bị âm thầm huỷ bởi lần khởi động lại kế tiếp.
10. `apps/web/src/components/machine-control.tsx` → `useMachineCommand()`: `api.createMachineCommand()` rồi
    poll `GET .../commands/:id` mỗi giây tới khi `done`/`failed`/`expired` hoặc hết hạn (thời gian chạy của
    action cộng 60 giây chờ máy nhận). `webFixFor()` phân loại một fix sức khỏe theo tiền tố id: chạy từ xa
    được (`adjust-limits`/`repick-folder` dẫn tới trang "Cài đặt máy" của flow `server-settings` thay vì chạy
    lệnh; `repair`/`api-key-help`/`restart-daemon` chỉ làm được trên máy — hiện chú thích, không có nút),
    còn lại (`mcp-disable`, `install-hooks`, …) chạy thẳng qua `health.fix`. `MachineControl`: nút tạm
    dừng/chạy tiếp theo `machine.paused`, kiểm tra nhanh/đầy đủ, dò lại skill/MCP, job gần đây, form xem log
    (số dòng, lọc theo ticket), và với mỗi project/vai trò trợ lý máy đang giữ — nút gỡ có hộp xác nhận
    (`project.release`/`assistant.release`). Máy offline thì mọi nút bị khoá kèm chú thích lệnh sẽ chạy khi máy
    nối lại. `CommandResult` hiện kết quả theo action (bảng sức khỏe, danh sách job, log, số skill/MCP dò
    được).
11. `apps/web/src/routes/project-settings.tsx`: nút "Cài BMAD trên máy `<tên máy>`" (`bmad.install`) cạnh
    `BmadProfileSection` — chỉ hiện khi project có máy đang giữ; dùng lại `useMachineCommand()` như
    `MachineControl`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/machine-command-routes.ts` | Route owner + daemon của lệnh từ xa | `machineCommandRoutes`, `daemonCommandRoutes` |
| `apps/api/src/services/machine-command-service.ts` | Tạo, hết hạn, nhận, báo kết quả một lệnh | `createMachineCommand`, `listMachineCommands`, `getMachineCommand`, `startMachineCommand`, `finishMachineCommand`, `toCommandDto` |
| `packages/shared/src/machine-command-schemas.ts` | Danh sách action cho phép, schema kết quả, hạn thời gian | `MachineCommandRequest`, `MachineCommandAction`, `MACHINE_COMMAND_RESULT`, `MACHINE_COMMAND_TIMEOUT_MS`, `MACHINE_COMMAND_TTL_MS`, `MachineCommand`, `MachineCommandStatus` |
| `apps/daemon/src/remote/machine-commands.ts` | Chạy một lệnh trên daemon, báo kết quả | `runMachineCommand`, `MachineCommandHandlers`, `jobView` |
| `apps/web/src/components/machine-control.tsx` | Khung điều khiển máy trên web | `MachineControl`, `useMachineCommand`, `webFixFor`, `HealthReportView` |

## Dữ liệu

- Bảng: `machine_commands` (sở hữu bởi flow này; migration
  `apps/api/drizzle/0008_server_settings_and_machine_commands.sql`, flow `api-platform` sở hữu việc migrate —
  cùng migration còn có bảng `settings_revisions` của flow `server-settings`, ngoài phạm vi flow này).
- Sự kiện: `machine.command {commandId, machineId, action}` (owner stream cộng đúng máy đó, phát khi tạo
  lệnh, flow `event-delivery` định nghĩa và phát qua `appendEvents()`) → daemon `run_command` (flow
  `daemon-scheduling`); `machine.command_updated {commandId, machineId, status}` (owner stream, phát mỗi lần
  đổi trạng thái).
- Gọi ngoài: daemon gọi `POST /v1/daemon/commands/:id/start|result` qua `VpsClient` (flow `daemon-runtime`);
  web gọi `/v1/machines/:id/commands*` qua `lib/api-client.ts` (flow `web-shell`).

## Flow liên quan

- api-platform: `machineCommandRoutes`/`daemonCommandRoutes` đăng ký vào nhóm route owner/daemon của
  `buildApp()`; migration `0008_server_settings_and_machine_commands.sql` migrate ở đó.
- event-delivery: `machine.command`/`machine.command_updated` định nghĩa ở `event-schemas.ts`, phát qua cùng
  outbox `events`.
- daemon-scheduling: `dispatchEvent()` ánh xạ `machine.command` sang effect `run_command`, xử lý ngay ngoài
  `Scheduler` (không sinh job, không chiếm slot).
- daemon-runtime: `createDaemon()` nhận `commandHandlers` tuỳ chọn và tự có `pause`/`resume`/
  `inventory.refresh`/`jobs.list`/`project.release`/`assistant.release`; `VpsClient.startCommand()`/
  `finishCommand()` sống ở `vps-client.ts` của flow đó.
- daemon-health: `health.run`/`health.fix` từ xa chạy đúng `HealthOps`/`runHealthChecks()`/`applyHealthFix()`
  dùng chung với `crewd doctor`; fix chỉ máy làm được (`restart-daemon`) bị từ chối khi gọi từ xa.
- desktop-app: `HostService.commandHandlers` thêm `health.run`/`health.fix`/`bmad.install`/`logs.tail`; sự
  kiện host `app.fix` và việc giữ trạng thái tạm dừng qua một lần khởi động lại host sống ở
  `apps/desktop/src/main/index.ts`/`daemon-supervisor.ts` của flow đó.
- project-claims: `project.release`/`assistant.release` gọi lại `VpsClient.release()` (service `claim-service`
  của flow đó) — cùng hành vi với `crewd project release`/`crewd assistant off`.
- server-settings: fix `adjust-limits`/`repick-folder` không chạy từ xa mà dẫn tới trang "Cài đặt máy" của
  flow đó (tài nguyên, thư mục dự án).
- web-admin: `machines.tsx` (nút "Điều khiển" mỗi thẻ máy) và `project-settings.tsx` (nút "Cài BMAD trên máy
  …") dựng `MachineControl`/gọi `bmad.install`.

## Tests

- `apps/api/test/machine-commands.test.ts`: chỉ nhận action/tham số trong whitelist; gửi đúng một máy, chạy
  đúng một lần, lưu kết quả đúng dạng của action; lưu thất bại và một kết quả sai dạng cũng thành thất bại;
  hết hạn khi máy không nhận trong 10 phút; từ chối lệnh cho máy đã thu hồi; route owner và route daemon tách
  biệt.
- `apps/daemon/test/machine-commands.test.ts`: tạm dừng/cho chạy tiếp, liệt kê job, báo lỗi rõ khi action chỉ
  app mới làm được; chạy đúng handler do app thêm vào và báo lỗi đã lọc bí mật; gỡ project khi owner yêu cầu từ
  web.
- `apps/web/src/components/machine-control.test.tsx`: chạy kiểm tra sức khỏe từ xa rồi áp đúng fix mà báo cáo
  đề nghị; tạm dừng máy và hiện đúng thao tác không làm được; máy đã tạm dừng thì đề nghị chạy tiếp, máy
  offline thì không đề nghị gì.
