# Daemon cục bộ (crewd)

> Flow `daemon-runtime`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow daemon-runtime`
> in ra đúng danh sách đó.

## Mục đích

`crewd` là daemon TypeScript chạy trên máy cục bộ của chủ dự án: ghép máy với VPS, giữ cấu hình và token máy,
lưu trạng thái job trong SQLite, và là nơi lắp ráp mọi flow khác của daemon (nhận sự kiện, lập lịch, chạy
agent, dọn tài nguyên, kiểm tra sức khỏe) thành một tiến trình sống. `createDaemon()` là điểm lắp ráp dùng
chung: cả lệnh `crewd start` và app desktop (flow `desktop-app`) đều dựng daemon từ đây.

## Điểm vào

- `apps/daemon/src/cli.ts` → `main()` — lệnh `crewd`: `pair`, `start`, `status`, `rotate-token`, `doctor`,
  `install-service`, `project add|create|release`, `assistant on|off`.
- `apps/daemon/src/daemon.ts` → `createDaemon()` — thư viện daemon dùng chung bởi CLI `start` và app desktop.

## Các bước

1. `apps/daemon/src/cli.ts` → `pair()`: gọi `POST /v1/machines/pair` (không cần token), lưu token vào
   `TokenStore`, ghi `apiUrl`/`machineName`/`machineId` vào config.
2. `apps/daemon/src/config.ts` → `loadConfig()`/`saveConfig()`: schema zod `DaemonConfig` (bắt buộc `sonnet`
   nằm trong `models.allow` vì docs-init/docs-update luôn chạy sonnet), ghi atomic (file tạm + rename) với
   quyền 0600, đọc dưới `crewHome()` (`$CREW_HOME` hoặc `~/.crew`). Fable không được dùng (quyết định của chủ
   dự án) nhưng một config ghi từ trước còn đặt nó vẫn hợp lệ: `fable` trong `models.allow` bị bỏ khi parse,
   một mục `complexityMap` đặt `fable` đọc thành `opus`; `loadConfig()` cảnh báo đúng một lần mỗi file (mặc
   định một dòng JSON ra stderr, app desktop truyền `ConfigWarn` riêng ghi vào `app.log` sự kiện
   `config-legacy-model`, flow `desktop-app`), rồi lần `saveConfig()` kế tiếp ghi lại file đã sạch `fable`.
3. `apps/daemon/src/secrets.ts` → `defaultTokenStore()`: Keychain macOS qua `KeychainTokenStore` (ghi bằng
   `security -i` nhận lệnh trên stdin, token không bao giờ nằm trong argv của tiến trình) hoặc
   `FileTokenStore` (file 0600, atomic) khi `CREW_TOKEN_STORE=file` hoặc không phải macOS.
4. `apps/daemon/src/state-db.ts` → `StateDb`: SQLite `~/.crew/state.db` (`better-sqlite3`, `journal_mode=WAL`,
   `synchronous=FULL`), bảng `meta` (cursor sự kiện, `tokenExpiresAt`, `inventory:<key>`), `jobs` (index unique
   một phần `jobs_one_active_per_ticket` — một ticket chỉ giữ nhiều nhất một job đang `queued`/`running`/
   `backoff`; cột `stage`, `failed_attempts`, `capabilities`, `return_to_dev` của flow `agent-roles`, cột
   `wait_reason`/`wait_detail` mà `Scheduler` ghi qua `updateJob()` (flow `daemon-scheduling`)),
   `pending_wakeups`, `tool_log`, `job_cleanup`. Mọi thao tác đồng bộ nên `transaction()` gộp nhiều ghi thành
   một. `StateDb.latestFailures(since)` trả job `failed` mới nhất mỗi ticket kể từ `since` (bỏ qua ticket đã có
   job mới hơn), dùng bởi `heartbeat()` (bước 7 dưới) để báo `failedJobs`. `StateDb.migrate()` chạy sau
   `SCHEMA` mỗi lần mở: `pragma table_info(jobs)` rồi `alter table … add column` cho cột nào một state DB được
   ghi bởi daemon cũ còn thiếu (SQLite không có `add column if not exists`), nên nâng cấp tại chỗ không mất
   job đang chờ.
5. `apps/daemon/src/api/vps-client.ts` → `VpsClient.request()`: mọi response được validate bằng schema
   `@crew/shared`, lỗi transient (mạng, 502/503/504) được thử lại với backoff nhân đôi, mọi ghi kèm header
   `Idempotency-Key` — ví dụ `requestProjectChange(projectKey, body, idempotencyKey)` (flow `project-claims`,
   dùng bởi `setup-ops.ts` → `requestTestSetup()` của app desktop). Tuỳ chọn `onError(failure: ApiFailure)`
   được gọi đúng một lần cho mỗi request cuối cùng thất bại (sau khi hết lượt thử lại) với `method`, `path`,
   `status` (`0` khi request không có phản hồi — mạng/TLS/timeout), `code`, `message`, `attempts` — không bao
   giờ có header hay body; lỗi của chính `onError` không đổi kết quả request. `CreateDaemonOptions.onApiError`
   (`daemon.ts` → `createDaemon()`) truyền tuỳ chọn này xuống `VpsClient` nội bộ; app desktop lắp
   `HostContext.logApiError` (flow `desktop-app`) vào đây để mọi lỗi gọi VPS API của daemon lẫn của các
   `VpsClient` khác app desktop tự dựng (ghép máy, kiểm server) đều thành một dòng `app.log`.
6. `apps/daemon/src/daemon.ts` → `createDaemon()`: `planner` mặc định là `rolePlanner` (flow `agent-roles`,
   trước đây là `defaultPlanner` tối giản); sau khi cài `crew-docs` (`installCrewDocs()`), `packagedStandard()`
   tìm `STANDARD.md` của `@crew/docs-kit` mà daemon này được build cùng và chép nó vào `~/.crew/bin` cạnh
   bundle — `standardPath` (cấp cho `JobRunnerDeps.standardPath`) là đường dẫn agent `docs_init` đọc chuẩn docs
   từ đó. `contextBlock()` (cấp cho tool `get_ticket`) giờ có thêm trường `stage` của job đang chạy. Khi
   `putSkills()` gửi inventory lên server, MCP server bị chủ dự án tắt cho project đó được đánh dấu
   `disabled: true` trong danh sách gửi đi (server dùng cờ này để từ chối ticket yêu cầu nó, flow
   `machine-pairing`/`daemon-api`), dù `inventoryFor()` cục bộ (cấp cho `allowedToolsFor()`) vẫn giữ danh sách
   gốc.
7. `apps/daemon/src/daemon.ts` → `createDaemon().start()`: `takePidLock()` chặn hai daemon cùng chạy trên một
   home; `reconcileRestart()` dọn rồi re-queue job còn `running` từ lần chạy trước (`resumeMode` =
   `restart_resume` nếu có `sessionId`, ngược lại `restart_fresh`); `refreshProjects()`; `sweep()`; probe
   inventory máy và từng project (mỗi lần probe một project gọi `ProbeWorktreeKeeper.used()`, flow
   `agent-workspace`, để giữ worktree `_probe` của nó thêm một giờ); rồi khởi động stream, heartbeat, scheduler
   và timer sweep mỗi 10 phút. `decide()` (dùng bởi `Scheduler`, flow `daemon-scheduling`): `pm_task` vượt ngân
   sách cây trả `defer` (job ở nguyên `queued`, thử lại ở lượt sau) thay vì `skip` (kết thúc hẳn) — chủ dự án
   duyệt xong thì job tự chạy mà không cần một sự kiện đánh thức mới.
   `sweep()` cũng gọi `ProbeWorktreeKeeper.expire()` cho mọi project đã cấu hình — dọn worktree probe quá một
   giờ (không tính vào `orphansCleaned`); `timings.probeWorktreeTtlMs`/`timings.probeClock` cho test kiểm soát
   thời gian này.
   `heartbeat()` gửi `runningJobs` kèm `stage`/`model`/`effort` của lượt đang chạy, `waitingJobs` cho mọi job
   `queued`/`backoff` kèm `role`/`kind`/`stage`/`since` và lý do chờ hiện tại (`waitOf()`: tạm dừng máy hoặc
   `retryAt` còn hạn thắng quyết định cuối của scheduler; `no_slots` mang số tải/RAM/slot sống ngay lúc gửi,
   không phải lúc scheduler quyết định) — để cảnh báo "ticket đứng yên" trên server (`startStuckTicketAlarm()`,
   flow `ticket-lifecycle`) không báo nhầm ticket máy này đang giữ chờ tới lượt hoặc chờ thử lại, và để owner
   thấy vì sao mỗi job chờ (`AgentActivity`, cùng flow). Cùng heartbeat gửi `failedJobs`: job `failed` mới nhất
   mỗi ticket trong `FAILED_JOB_REPORT_MS` (24 giờ, qua `StateDb.latestFailures()`), báo tới khi một job mới
   của ticket đó bắt đầu. `logWaitChange()` (móc `onWaitChange` của `Scheduler`, flow `daemon-scheduling`) ghi
   một dòng log "job waiting" mỗi lần lý do chờ đổi, tra `ticket.key` qua VPS khi chưa biết. `pause()` ghi
   thêm một dòng log số job đang giữ chờ khi tạm dừng máy. `reportSoon()` gửi một heartbeat ngay (qua
   `HeartbeatLoop.tick()`, gộp như mọi lượt gọi chồng nhau, flow `daemon-scheduling`) mỗi khi trạng thái một
   job đổi (`events.on('job')`) hay `logWaitChange()` chạy, miễn daemon đã `start()` và chưa dừng/halt — owner
   thấy job được nhận, bắt đầu, chờ vì lý do mới, hay kết thúc mà không phải chờ tới nhịp 30s;
   `releaseLostProjects()` không phát sự kiện `job` nên thay đổi của nó vẫn chờ nhịp định kỳ.
8. `apps/daemon/src/daemon.ts` → `releaseLostProjects()`: sau khi `refreshProjects()` trả lời sự kiện
   `claim.changed`, job của project máy này không còn sở hữu bị hủy (đang chạy) hoặc chuyển `skipped`
   (`queued`/`backoff`) — chi tiết dispatch sự kiện thuộc flow `daemon-scheduling`.
9. `apps/daemon/src/daemon.ts` → `wakePmForLeftovers()`: móc `onCleaned` của `JobRunner` (flow `agent-runs`) —
   một subtask (`dev`/`bug`/`qc`/`docs_init`) mà việc dọn dẹp phải dừng tiến trình/cổng/container thật sự đánh
   thức PM của `pm_task` cha (`wakeTicket()`, flow `daemon-scheduling`), để `pm_monitor` thấy và bình luận
   ngay, không phải chờ lượt kiểm tra định kỳ tiếp theo.
10. `apps/daemon/src/daemon.ts` → `cancelDescendants()`: sự kiện `ticket.cancelled` chỉ nêu gốc cây bị huỷ
    (server đã tự huỷ mọi ticket con); hàm này quét mọi job cục bộ đang hoạt động, với job nào có ticket đã
    `cancelled` thì huỷ job đó (`running` → abort, `queued`/`backoff` → `cancelled` tại chỗ) và gỡ worktree của
    nó, nên không job con nào của một cây bị huỷ còn sống sót trên máy.
11. `apps/daemon/src/daemon.ts` → `createDaemon().stop()`/`halt()`: `stop()` dừng nhẹ nhàng (abort job đang
    chạy để chúng tự re-queue nhờ `stopping()`), `halt()` là mô phỏng crash cho test (dừng ngay, không ghi
    thêm gì); cả hai đều gọi `ProbeWorktreeKeeper.stop()` để huỷ timer dọn worktree probe đang chờ. Trước
    khi đóng state DB, cả hai còn đợi `backgroundIdle()` cho các cuộc gọi API mà daemon tự bắn đi không chờ
    (`inBackground()`): refresh project khi stream kết nối, refresh project sau effect `refresh_projects`
    (sự kiện `claim.changed`), `wakePmForLeftovers()` từ `onCleaned`, `cancelDescendants()` và `getTicket`
    dọn worktree khi huỷ — nên khi `stop()`/`halt()` trả về, daemon không còn request nào bỏ ngỏ và không
    có ghi nào rơi vào state DB đã đóng.
12. `apps/daemon/src/service/systemd.ts` → `installService()`/`systemdUnit()`: sinh và cài một **systemd user
    unit** (`crewd.service`) chạy trong phiên của chủ dự án, luôn `UnsetEnvironment=ANTHROPIC_API_KEY` để
    billing ở lại đăng nhập gói đăng ký; `crewd install-service` chỉ chạy trên Linux (macOS dùng app desktop).
13. `apps/daemon/src/daemon.ts` → `CreateDaemonOptions.crewDocsRuntime`: đường dẫn tuyệt đối của runtime mà
    wrapper `crew-docs` và hook git sẽ gọi (mặc định `process.execPath`); app desktop truyền chính binary của
    nó (chạy với `ELECTRON_RUN_AS_NODE=1`) nên máy không cần cài Node riêng cho hook.
14. `apps/daemon/src/library.ts`: re-export toàn bộ API công khai của daemon (`createDaemon`, `VpsClient`,
    `VpsError`, `ApiFailure`, `StateDb`, mọi health check và helper của flow `daemon-health` — `HEALTH_CHECKS`,
    `runHealthChecks`, `applyHealthFix`, `repoFolderChecks`, `inspectFolder`, `inspectHooks`, `HookInspection`,
    `HookState`, `serverProjects`, `storedInventory`…, runner, tool scopes, cộng
    `rolePlanner`/`resolveModel`/`renderPrompt`/`setPromptsDir`/`resolveStage`/`STAGES` của flow `agent-roles`)
    cho CLI và app desktop (`setup-ops.ts`, `health-ops.ts`, `activity.ts`, flow `desktop-app`) dùng chung một
    nguồn.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/daemon/src/cli.ts` | Lệnh `crewd` | `main`, `pair`, `status`, `rotateToken`, `runDoctor`, `runInstallService`, `project`, `assistant` |
| `apps/daemon/src/daemon.ts` | Lắp ráp daemon: vòng đời, sweep, heartbeat, dispatch effect | `createDaemon`, `CreateDaemonOptions`, `Daemon`, `releaseLostProjects`, `reconcileRestart`, `wakePmForLeftovers`, `cancelDescendants` |
| `apps/daemon/src/library.ts` | Điểm export thư viện dùng chung CLI/app desktop | (re-export) |
| `apps/daemon/src/config.ts` | Cấu hình `~/.crew/config.yaml` | `DaemonConfig`, `loadConfig`, `saveConfig`, `crewHome`, `homePaths` |
| `apps/daemon/src/secrets.ts` | Lưu token máy | `TokenStore`, `FileTokenStore`, `KeychainTokenStore`, `defaultTokenStore` |
| `apps/daemon/src/state-db.ts` | Trạng thái cục bộ SQLite | `StateDb`, `JobRow`, `ACTIVE_JOB_STATUSES` |
| `apps/daemon/src/api/vps-client.ts` | Client HTTP typed tới VPS | `VpsClient`, `VpsError`, `ApiFailure` |
| `apps/daemon/src/service/systemd.ts` | Cài đặt systemd user unit (Linux) | `systemdUnit`, `installService` |

## Dữ liệu

- Bảng SQLite (`~/.crew/state.db`, sở hữu bởi flow này, dùng chung bởi mọi flow daemon khác): `meta`, `jobs`,
  `pending_wakeups`, `tool_log`, `job_cleanup`.
- Sự kiện: không phát sự kiện; nhận effect `refresh_projects` từ flow `daemon-scheduling` để chạy
  `releaseLostProjects()`.
- Gọi ngoài: VPS API (mọi route `/v1/daemon/*`, `/v1/machines/pair`) qua `VpsClient`; Keychain macOS qua binary
  `security`; `systemctl --user` trên Linux.

## Flow liên quan

- daemon-scheduling: `StreamClient` và `Scheduler` được tạo và nối dây trong `createDaemon()`; `wakePmForLeftovers()`
  gọi `wakeTicket()`; `decide()` (dùng bởi `Scheduler.pass()`) trả thêm lý do chờ máy đọc được (`wait`/`detail`)
  và khoá các ticket phụ thuộc chưa xong; `onWaitChange` gọi `logWaitChange()` ở đây.
- agent-runs: `JobRunner` được tạo trong `createDaemon()` với `workspace`, `contextBlock`, `resourceOps`,
  `standardPath`, `onCleaned` lấy từ các flow khác.
- agent-roles: `rolePlanner` là `RolePlanner` mặc định của `JobRunner`; cột `jobs` mới (`stage`,
  `failed_attempts`, `capabilities`, `return_to_dev`) thuộc flow đó nhưng sống trong `state-db.ts` ở đây.
- agent-workspace: `createDaemon()` gọi `ensureWorktree`/`detectSharedPaths`/`probeInventory` để chuẩn bị
  worktree và kho skill/MCP; `ProbeWorktreeKeeper` (sở hữu bởi flow đó) được lắp và điều khiển từ `daemon.ts`
  (`used()` sau mỗi probe, `expire()` trong `sweep()`, `stop()` khi dừng daemon).
- resource-hygiene: `createDaemon().sweep()` gọi `sweepOrphans()`; `ResourceOps` được lắp trong
  `JobRunnerDeps.resourceOps`.
- daemon-health: `crewd doctor` (`runDoctor()` trong `cli.ts`) gọi `doctor()` của flow `daemon-health`.
- daemon-api: `VpsClient` gọi các route đó (xem flow `daemon-api` ở phía server).
- ticket-lifecycle: `waitingJobs` và `failedJobs` trong mỗi heartbeat nuôi cả `WaitingJobsRegistry`/
  `startStuckTicketAlarm()` phía server và `AgentActivity` mà owner đọc trên ticket
  (`agent-activity-service.ts`, qua bảng `machines`).
- desktop-app: `HostService.startDaemon()` gọi `createDaemon()` với `crewDocsRuntime` là binary của app; mọi
  export của `library.ts` (config, secrets, state DB, VPS client, health) được `setup-ops.ts`/`health-ops.ts`/
  `activity.ts` dùng lại thay vì định nghĩa riêng.

## Tests

- `apps/daemon/test/cli.test.ts`: ghép máy rồi claim project với thư mục cục bộ, tạo project mới (sở hữu
  ngay), `status` hiển thị đúng, `rotate-token` đổi token, `project release`; lỗi cú pháp trả exit code 2.
- `apps/daemon/test/units.test.ts`: `config` điền mặc định và validate, từ chối `models.allow` thiếu `sonnet`,
  từ chối đường dẫn tương đối/trùng key/đường dẫn thoát khỏi repo, lưu atomic mode 0600 và đọc lại đúng; một
  config cũ còn đặt `fable` ở `models.allow`/`complexityMap` đọc thành `opus` và cảnh báo đúng một lần mỗi
  file;
  `secrets` giữ token trong file 0600 và ghi Keychain qua `security -i` (token không lộ trong argv);
  `onError` của `VpsClient` được gọi đúng một lần cho mỗi request cuối cùng thất bại, sau khi hết lượt thử
  lại, không kèm header/body và không lộ token.
- `apps/daemon/test/daemon-extras.test.ts`: probe inventory trong worktree kiểu job rồi gửi lên server và cấp
  cho run quyền dùng đúng MCP server đã bật; gửi heartbeat kèm job đang chạy và số đã sweep; báo đúng lý do chờ
  của job `queued`/`backoff` (`retry_at` kèm giờ, `no_slots` kèm số tải/RAM/slot sống) và `failedJobs` của job
  vừa lỗi, cùng mọi job chờ đọc thành `paused` khi daemon tạm dừng; job trợ lý chạy trong thư mục
  `assistantDir` do daemon quản lý; công cụ docs chạy `crew-docs` trong worktree và đồng bộ snapshot docs lên
  server; worktree QC bắt đầu đúng `head_sha` của report dev đã ghép cặp; cài `crew-docs` vào `~/.crew/bin`
  kèm wrapper trên PATH của agent; giữ worktree probe một giờ sau lần probe rồi xoá, và một daemon khởi động
  lại xoá worktree probe đã quá hạn (đồng hồ giả kiểm soát được thời gian); và `stop()` không trả về khi một
  cuộc gọi API daemon tự bắn đi lúc chạy (refresh project khi stream kết nối, bị giữ lại trong test) còn mở.
- `apps/daemon/test/test-cleanup.test.ts`: một daemon còn chạy khi test kết thúc bị `halt()` trước khi server
  đóng, nên đóng server diễn ra ngay; một client vẫn còn giữ kết nối khiến đóng server thất bại với lỗi rõ
  ràng ("... never stopped") thay vì treo tới hết deadline của hook.
