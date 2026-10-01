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
   `homePaths()` cấp một đường dẫn nằm ngoài `home`: `tmp` là `jobTmpRoot(home)` = `/tmp/crew-<uid>/<8 hex
   sha256(home)>` (flow `resource-hygiene`) — ngắn cho giới hạn socket Unix của macOS, và riêng theo user hệ
   điều hành cộng home của daemon nên hai daemon không đụng thư mục tạm của nhau; cùng hàm cũng cấp
   `settingsCache` = `<home>/settings-cache.json` (bản cài đặt server tốt gần nhất, flow `server-settings`).
   `DaemonConfig` (resources/models/budgets/`disabledMcpServers` mỗi project) từ giờ chỉ còn là **giá trị cục
   bộ**: cấu hình một job thực sự chạy với là `effectiveConfig()` (chồng cài đặt server lên trên, flow
   `server-settings`), không phải `loadConfig()` trực tiếp. `DaemonConfig.backgroundWaitMinutes` (số phút,
   mặc định 30, tối đa 1440) là trần chờ một lượt chạy giữ phiên mở cho tác vụ nền của agent trước khi daemon
   nhắc agent hoàn tất hay tự dừng tác vụ (flow `agent-runs`, bước 4); khóa cục bộ — `effectiveConfig()` không
   chồng cài đặt server lên nó, không có cài đặt tương ứng trên server hay web.
3. `apps/daemon/src/secrets.ts` → `defaultTokenStore()`: Keychain macOS qua `KeychainTokenStore` (ghi bằng
   `security -i` nhận lệnh trên stdin, token không bao giờ nằm trong argv của tiến trình) hoặc
   `FileTokenStore` (file 0600, atomic) khi `CREW_TOKEN_STORE=file` hoặc không phải macOS.
4. `apps/daemon/src/state-db.ts` → `StateDb`: SQLite `~/.crew/state.db` (`better-sqlite3`, `journal_mode=WAL`,
   `synchronous=FULL`), bảng `meta` (cursor sự kiện, `tokenExpiresAt`, `inventory:<key>`), `jobs` (index unique
   một phần `jobs_one_active_per_ticket` — một ticket chỉ giữ nhiều nhất một job đang `queued`/`running`/
   `backoff`; cột `stage`, `failed_attempts`, `capabilities`, `return_to_dev` của flow `agent-roles`, cột
   `run_trace` (JSON, flow `agent-runs`: số lượt/thời gian/chi phí, kết quả SDK, tin nhắn cuối và các bước cuối
   của agent, ghi sau mọi lượt chạy dù thành hay bại) đọc bởi `failedJobText()` (flow `agent-roles`) cho
   heartbeat, cột `wait_reason`/`wait_detail` mà `Scheduler` ghi qua `updateJob()` (flow `daemon-scheduling`),
   cột `settings_revision` (flow `server-settings`/`agent-runs`: bản cài đặt server job đó snapshot lúc bắt
   đầu, ghi bởi `JobRunner.execute()`, đọc lại bởi bình luận lỗi/crash và bởi heartbeat), cột
   `session_abandoned` (`AbandonReason | null`, flow `agent-runs`: `run_started`/`background_tasks`/
   `aborted`/`daemon_stopped`/`no_result`/`daemon_restart` — khác `null` nghĩa là lượt chạy để lại phiên bỏ
   dở, không lượt chạy nào sau còn resume được nó; `null`, kể cả trên một job cũ chưa từng có cột này, là
   phiên sạch)),
   `pending_wakeups`, `pm_mentions` (khoá chính `event_id`; `pm_task_id`, `source_ticket_id`,
   `source_ticket_key`, `comment_id`, `created_at` — mỗi owner tag `@pm` nhận được, ghi bởi
   `recordPmMention()`/đọc bằng `pmMentions(eventIds)`, dùng bởi flow `daemon-scheduling`/`agent-roles`),
   `tool_log`, `job_cleanup`. Mọi thao tác đồng bộ nên `transaction()` gộp nhiều ghi thành
   một. `StateDb.latestFailures(since)` trả job `failed` mới nhất mỗi ticket kể từ `since` (bỏ qua ticket đã có
   job mới hơn), dùng bởi `heartbeat()` (bước 7 dưới) để báo `failedJobs`. `StateDb.getJobByIdPrefix(prefix)`
   trả job mới nhất có id bắt đầu bằng `prefix` — dùng bởi flow `resource-hygiene` để tra ngược tên thư mục tạm
   ngắn (8 ký tự đầu id) về đúng job. `StateDb.migrate()` chạy sau
   `SCHEMA` mỗi lần mở: `pragma table_info(jobs)` rồi `alter table … add column` cho cột nào một state DB được
   ghi bởi daemon cũ còn thiếu (SQLite không có `add column if not exists`), nên nâng cấp tại chỗ không mất
   job đang chờ — `session_abandoned` (trên) là một cột như vậy, một state DB cũ thiếu cột này đọc mọi job đã
   có thành phiên sạch (`sessionAbandoned: null`).
   `StateDb.abandonedBy(sessionId)` trả job mới nhất (nếu có) đã đánh dấu phiên đó bỏ dở.
   `StateDb.resumeChoice(ticketId, candidate, next)` là điểm quyết định phiên resume hay mở mới **duy nhất**
   của daemon (flow `agent-runs`/`agent-roles`/`daemon-scheduling` đều gọi vào đây, không tự suy luận): trả
   `{ sessionId: candidate, interrupted: null }` (resume) trừ ba trường hợp đều trả `{ sessionId: null,
   interrupted: <job bị bỏ dở> }` (mở phiên mới kèm lượt cần tóm tắt) — `next.resumeMode` đã đặt (job này bị
   daemon dừng/crash dẫn tới lượt này), `abandonedBy(candidate)` tìm thấy một job đã đánh dấu bỏ dở trên
   `candidate`, hoặc `next.trigger === 'ticket.unblocked'` và job kết thúc gần nhất của ticket (bỏ qua
   `skipped` và job đang hoạt động) lỗi `no_handoff`/`not_finished` — cách một phiên hỏng từ trước khi có cột
   này trông như vậy. `StateDb.resumableSession(ticketId, kind, trigger)` là bản rút gọn chỉ trả `sessionId`,
   lấy ứng viên từ `latestSession(ticketId, kind)` rồi đưa qua `resumeChoice()` — dùng ở nơi chưa cần tóm tắt
   lượt bị bỏ dở (dispatcher ghi `sessionId` ban đầu của job, flow `daemon-scheduling`); việc tóm tắt luôn
   được tính lại đúng ở `resumeSession()`/`defaultPlanner` (flow `agent-runs`) ngay trước khi job đó chạy, nên
   cả sáu nơi chọn phiên ra cùng kết quả dù gọi hàm đầy đủ hay hàm rút gọn này.
5. `apps/daemon/src/api/vps-client.ts` → `VpsClient.request()`: mọi response được validate bằng schema
   `@crew/shared`, lỗi transient (mạng, 502/503/504) được thử lại với backoff nhân đôi, mọi ghi kèm header
   `Idempotency-Key` — ví dụ `requestProjectChange(projectKey, body, idempotencyKey)` (flow `project-claims`;
   hiện không còn nơi gọi, app desktop từng dùng nó qua `requestTestSetup()` trước khi bỏ màn đó),
   `putBmadProfile(projectKey, profile, idempotencyKey)` (`PUT /v1/daemon/projects/:projectKey/bmad-profile`,
   cũng flow `project-claims`), `startCommand`/`finishCommand` (flow `machine-control`), hay
   `retrySubtask(pmTaskId, body, idempotencyKey)` (`POST .../retry-subtask`, gọi bởi tool PM cùng tên, flow
   `agent-runs`/`ticket-lifecycle`), hay `runtime()`/`runtimeBundle(version, maxBytes)` (`GET
   /v1/daemon/runtime`/`GET /v1/daemon/runtime/:version/bundle`, flow `runtime-updates` — bản runtime này máy
   nên chạy, và tải tarball chưa kiểm để app desktop tự verify trước khi cài; `runtimeBundle()` từ chối câu
   trả lời lớn hơn `maxBytes` mà không tải hết). Tuỳ chọn `onError(failure: ApiFailure)`
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
   gốc. `createDaemon()` cũng dựng một `SettingsStore` (flow `server-settings`) cạnh `VpsClient`; `config`
   (biến `JobRunnerDeps`/`Daemon` dùng, khác `localConfig` đọc từ đĩa) luôn là
   `effectiveConfig(localConfig, settingsStore.current(), localImported())` — được tính lại (`applyConfig()`)
   mỗi khi cài đặt server đổi hay `updateConfig()`/`updateProjects()` được gọi, và re-probe inventory của
   project nào có MCP tắt vừa đổi. `refreshSettings()` (fetch cài đặt server rồi `applyConfig()`, gọi lúc
   `start()` trước khi job đầu tiên chạy, khi nhận effect `refresh_settings` của dispatcher — sự kiện
   `settings.changed`, flow `daemon-scheduling` — khi stream kết nối lại, khi project đổi chủ, và mỗi giờ qua
   `settingsTimer`/`timings.settingsMs`) gọi tiếp `importLocalSettings()`: tải một lần giá trị `config.yaml`
   cục bộ lên làm cài đặt máy/project trên server (chỉ nơi server chưa có gì, đánh dấu xong qua meta
   `settings-imported:<machineId>`) rồi refresh lại. `Daemon.settings()`/`effectiveConfig()` lộ trạng thái này
   cho CLI/app desktop (`crewd doctor`, dashboard); `setProjectMcp(projectKey, disabled, note)` gọi
   `VpsClient.putProjectMcp()` rồi `refreshSettings()` ngay để áp cho job kế tiếp — dùng bởi fix sức khỏe
   (flow `daemon-health`) và công tắc MCP của app desktop (flow `desktop-app`).
   `CreateDaemonOptions.runtime`/`onRuntimeChanged` (tuỳ chọn, app desktop cấp: `runtime` đọc trạng thái cập
   nhật runtime hiện tại để gửi kèm heartbeat, `onRuntimeChanged` được gọi khi dispatcher trả effect
   `runtime_changed` từ sự kiện `runtime.published`/`runtime.pinned` — app desktop phát tiếp một sự kiện host
   để main tự kiểm lại runtime, flow `runtime-updates`). `CreateDaemonOptions.commandHandlers`
   (tuỳ chọn, `MachineCommandHandlers` của flow `machine-control`): daemon tự có sẵn `pause`/`resume`/
   `inventory.refresh`/`jobs.list`/`project.release`/`assistant.release` (bảng `commandHandlers()`, cạnh
   `pause()`/`resume()` dưới đây); app desktop thêm `health.run`/`health.fix`/`bmad.install`/`logs.tail` qua
   tuỳ chọn này. Effect `run_command` của dispatcher (flow `daemon-scheduling`, từ sự kiện `machine.command`)
   chạy `runMachineCommand()` ngay trong `inBackground()`, không qua `Scheduler` và không chiếm slot job.
7. `apps/daemon/src/daemon.ts` → `createDaemon().start()`: `takePidLock()` chặn hai daemon cùng chạy trên một
   home; `ensureTmpRoot(paths.tmp)` (flow `resource-hygiene`) dựng an toàn gốc thư mục tạm ngắn rồi xóa
   `<home>/tmp` cũ (thư mục tạm của bản daemon trước — pid lock vừa lấy coi nó thuộc daemon này để dọn);
   `reconcileRestart()` dọn rồi re-queue job còn `running` từ lần chạy trước — nó chết giữa lượt (kể cả chết
   trước khi agent chạy), nên luôn ghi `resumeMode: 'restart_fresh'` cộng `sessionAbandoned: 'daemon_restart'`
   (flow `agent-runs`): job đó chạy lại ở phiên mới kèm tóm tắt lượt bị crash, không bao giờ resume;
   `refreshProjects()`; `sweep()`; probe
   inventory máy và từng project (mỗi lần probe một project gọi `ProbeWorktreeKeeper.used()`, flow
   `agent-workspace`, để giữ worktree `_probe` của nó thêm một giờ); rồi khởi động stream, heartbeat, scheduler
   và timer sweep mỗi 10 phút. `refreshInventory(projectKey)` gọi `reportBmadProfile()` trước probe: khi máy
   này sở hữu project (`projectsView` đọc `ownerState: 'mine'`) và hồ sơ BMAD đọc được (`readBmadProfile()`,
   flow `agent-workspace`) khác lần báo trước (so JSON với meta `bmad-profile:<key>`), gửi lên server qua
   `VpsClient.putBmadProfile()`; lỗi chỉ ghi log, không chặn probe. `decide()` (dùng bởi `Scheduler`, flow
   `daemon-scheduling`): `pm_task` vượt ngân sách cây trả `defer` (job ở nguyên `queued`, thử lại ở lượt sau)
   thay vì `skip` (kết thúc hẳn) — chủ dự án duyệt xong thì job tự chạy mà không cần một sự kiện đánh thức mới.
   `sweep()` cũng gọi `ProbeWorktreeKeeper.expire()` cho mọi project đã cấu hình — dọn worktree probe quá một
   giờ (không tính vào `orphansCleaned`); `timings.probeWorktreeTtlMs`/`timings.probeClock` cho test kiểm soát
   thời gian này.
   `heartbeat()` gửi thêm `settings: settingsStore.state()` (`revision`, `source`: server/cache/bundled,
   `rejected[]` — flow `server-settings`) mỗi lượt, cộng `runtime: options.runtime?.()` khi app desktop cấp
   tuỳ chọn đó (`MachineRuntimeState` — version/trạng thái cập nhật runtime, flow `runtime-updates`; CLI trần
   không cấp nên không gửi trường này), và `settingsRevision` trên mỗi `runningJobs[]`/
   `waitingJobs[]` (bản cài đặt job đó bắt đầu với). `heartbeat()` gửi `runningJobs` kèm `stage`/`model`/`effort` của lượt đang chạy, `waitingJobs` cho mọi job
   `queued`/`backoff` kèm `role`/`kind`/`stage`/`since` và lý do chờ hiện tại (`waitOf()`: tạm dừng máy hoặc
   `retryAt` còn hạn thắng quyết định cuối của scheduler; `no_slots` mang số tải/RAM/slot sống ngay lúc gửi,
   không phải lúc scheduler quyết định) — để cảnh báo "ticket đứng yên" trên server (`startStuckTicketAlarm()`,
   flow `ticket-lifecycle`) không báo nhầm ticket máy này đang giữ chờ tới lượt hoặc chờ thử lại, và để owner
   thấy vì sao mỗi job chờ (`AgentActivity`, cùng flow). Cùng heartbeat gửi `failedJobs`: job `failed` mới nhất
   mỗi ticket trong `FAILED_JOB_REPORT_MS` (24 giờ, qua `StateDb.latestFailures()`), báo tới khi một job mới
   của ticket đó bắt đầu — `error` của mỗi mục là `failedJobText()` (flow `agent-roles`): lớp lỗi, lý do bằng
   lời và một dòng chẩn đoán ngắn (số lượt/thời gian/chi phí, bước cuối, tin nhắn cuối, từ `run_trace` của
   job) tối đa 500 ký tự, không đổi schema heartbeat. `logWaitChange()` (móc `onWaitChange` của `Scheduler`,
   flow `daemon-scheduling`) ghi một dòng log "job waiting" mỗi lần lý do chờ đổi, tra `ticket.key` qua VPS
   khi chưa biết. `pause()` ghi
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
    chạy để chúng tự re-queue nhờ `stopping()`), rồi (khác `halt()`) xóa gốc thư mục tạm (`paths.tmp`, nằm
    ngoài home dưới `/tmp`) khi nó đã rỗng, bỏ qua lỗi nếu còn sót gì; `halt()` là mô phỏng crash cho test (dừng
    ngay, không ghi/dọn thêm gì); cả hai đều gọi `ProbeWorktreeKeeper.stop()` để huỷ timer dọn worktree probe
    đang chờ. Trước khi đóng state DB, cả hai còn đợi `backgroundIdle()` cho các cuộc gọi API mà daemon tự bắn đi không chờ
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
    `rolePlanner`/`resolveModel`/`renderPrompt`/`setPromptsDir`/`resolveStage`/`STAGES` của flow `agent-roles`,
    và `readBmadInstall`/`readBmadProfile`/`BMAD_DIR`/`BMAD_MANIFEST`/`BmadInstall` của flow `agent-workspace`) cho CLI và
    app desktop (`setup-ops.ts`, `health-ops.ts`, `activity.ts`, `bmad-install.ts`, flow `desktop-app`) dùng
    chung một nguồn.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/daemon/src/cli.ts` | Lệnh `crewd` | `main`, `pair`, `status`, `rotateToken`, `runDoctor`, `runInstallService`, `project`, `assistant` |
| `apps/daemon/src/daemon.ts` | Lắp ráp daemon: vòng đời, sweep, heartbeat, dispatch effect, hành động từ xa | `createDaemon`, `CreateDaemonOptions`, `Daemon`, `releaseLostProjects`, `reconcileRestart`, `wakePmForLeftovers`, `cancelDescendants` |
| `apps/daemon/src/library.ts` | Điểm export thư viện dùng chung CLI/app desktop (kể cả `ActiveSettings`/`SettingsStore`/`effectiveConfig` của flow `server-settings`) | (re-export) |
| `apps/daemon/src/config.ts` | Cấu hình `~/.crew/config.yaml` | `DaemonConfig`, `loadConfig`, `saveConfig`, `crewHome`, `homePaths` |
| `apps/daemon/src/secrets.ts` | Lưu token máy | `TokenStore`, `FileTokenStore`, `KeychainTokenStore`, `defaultTokenStore` |
| `apps/daemon/src/state-db.ts` | Trạng thái cục bộ SQLite | `StateDb`, `JobRow`, `ACTIVE_JOB_STATUSES`, `PmMention`, `AbandonReason`, `ResumeChoice` |
| `apps/daemon/src/api/vps-client.ts` | Client HTTP typed tới VPS | `VpsClient`, `VpsError`, `ApiFailure` |
| `apps/daemon/src/service/systemd.ts` | Cài đặt systemd user unit (Linux) | `systemdUnit`, `installService` |

## Dữ liệu

- Bảng SQLite (`~/.crew/state.db`, sở hữu bởi flow này, dùng chung bởi mọi flow daemon khác): `meta`, `jobs`,
  `pending_wakeups`, `pm_mentions`, `tool_log`, `job_cleanup`.
- Sự kiện: không phát sự kiện; nhận effect `refresh_projects` từ flow `daemon-scheduling` để chạy
  `releaseLostProjects()`.
- Gọi ngoài: VPS API (mọi route `/v1/daemon/*`, `/v1/machines/pair`) qua `VpsClient`; Keychain macOS qua binary
  `security`; `systemctl --user` trên Linux.

## Flow liên quan

- machine-control: `CreateDaemonOptions.commandHandlers` và `commandHandlers()` mặc định của `createDaemon()`
  cấp hành động cho lệnh từ xa owner gửi từ web; `dispatchEvent()` (flow `daemon-scheduling`) trả effect
  `run_command` xử lý ở đây, ngoài `Scheduler`.
- daemon-scheduling: `StreamClient` và `Scheduler` được tạo và nối dây trong `createDaemon()`; `wakePmForLeftovers()`
  gọi `wakeTicket()`; `decide()` (dùng bởi `Scheduler.pass()`) trả thêm lý do chờ máy đọc được (`wait`/`detail`)
  và khoá các ticket phụ thuộc chưa xong; `onWaitChange` gọi `logWaitChange()` ở đây.
- agent-runs: `JobRunner` được tạo trong `createDaemon()` với `workspace`, `contextBlock`, `resourceOps`,
  `standardPath`, `onCleaned` lấy từ các flow khác; `JobRunner.execute()` ghi/chốt cột `session_abandoned` của
  flow này (`run_started` rồi `abandonReason()`), và `defaultPlanner` gọi `StateDb.resumeChoice()`.
- agent-roles: `rolePlanner` là `RolePlanner` mặc định của `JobRunner`; cột `jobs` mới (`stage`,
  `failed_attempts`, `capabilities`, `return_to_dev`) thuộc flow đó nhưng sống trong `state-db.ts` ở đây.
- agent-workspace: `createDaemon()` gọi `ensureWorktree`/`detectSharedPaths`/`probeInventory` để chuẩn bị
  worktree và kho skill/MCP; `ProbeWorktreeKeeper` (sở hữu bởi flow đó) được lắp và điều khiển từ `daemon.ts`
  (`used()` sau mỗi probe, `expire()` trong `sweep()`, `stop()` khi dừng daemon); `reportBmadProfile()` gọi
  `readBmadProfile()` của flow đó để đọc `_bmad/` trong checkout chính trước mỗi probe.
- resource-hygiene: `createDaemon().sweep()` gọi `sweepOrphans()`; `ResourceOps` được lắp trong
  `JobRunnerDeps.resourceOps`.
- daemon-health: `crewd doctor` (`runDoctor()` trong `cli.ts`) gọi `doctor()` của flow `daemon-health`, với
  `config` là `loadEffectiveConfig()` (flow `server-settings`: cài đặt server chồng lên `config.yaml` cục bộ,
  không cần daemon đang chạy) thay vì `loadConfig()` thẳng.
- daemon-api: `VpsClient` gọi các route đó (xem flow `daemon-api` ở phía server).
- ticket-lifecycle: `waitingJobs` và `failedJobs` trong mỗi heartbeat nuôi cả `WaitingJobsRegistry`/
  `startStuckTicketAlarm()` phía server và `AgentActivity` mà owner đọc trên ticket
  (`agent-activity-service.ts`, qua bảng `machines`).
- desktop-app: `HostService.startDaemon()` gọi `createDaemon()` với `crewDocsRuntime` là binary của app; mọi
  export của `library.ts` (config, secrets, state DB, VPS client, health) được `setup-ops.ts`/`health-ops.ts`/
  `activity.ts` dùng lại thay vì định nghĩa riêng.
- server-settings: `SettingsStore` được dựng và điều khiển bên trong `createDaemon()`; `VpsClient.settings()`/
  `importSettings()`/`putProjectMcp()` sống ở `vps-client.ts` (file của flow này) nhưng phục vụ flow đó; cột
  `jobs.settings_revision` sống trong `state-db.ts` ở đây.
- runtime-updates: `VpsClient.runtime()`/`runtimeBundle()` sống ở `vps-client.ts` (file của flow này) nhưng
  phục vụ flow đó; `CreateDaemonOptions.runtime`/`onRuntimeChanged` là điểm nối app desktop truyền trạng thái
  runtime vào heartbeat và nhận lại hiệu ứng `runtime_changed` của dispatcher (flow `daemon-scheduling`).

## Tests

- `apps/daemon/test/cli.test.ts`: ghép máy rồi claim project với thư mục cục bộ, tạo project mới (sở hữu
  ngay), `status` hiển thị đúng, `rotate-token` đổi token, `project release`; lỗi cú pháp trả exit code 2.
- `apps/daemon/test/units.test.ts`: `config` điền mặc định và validate, từ chối `models.allow` thiếu `sonnet`,
  từ chối đường dẫn tương đối/trùng key/đường dẫn thoát khỏi repo, lưu atomic mode 0600 và đọc lại đúng; một
  config cũ còn đặt `fable` ở `models.allow`/`complexityMap` đọc thành `opus` và cảnh báo đúng một lần mỗi
  file; `backgroundWaitMinutes` mặc định 30 phút, nhận giá trị hợp lệ (kể cả số lẻ) trong khoảng `(0, 1440]`
  và từ chối giá trị ngoài khoảng hay không phải số, `effectiveConfig()` giữ nguyên khóa cục bộ này (cài đặt
  server không đổi nó), lưu rồi đọc lại đúng qua `saveConfig()`/`loadConfig()`;
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
