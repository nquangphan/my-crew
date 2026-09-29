# Ứng dụng máy local 2P Crew (Electron)

> Flow `desktop-app`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow desktop-app` in
> ra đúng danh sách đó.

## Mục đích

App Electron chạy trên máy của chủ dự án, thay cho `crewd` dòng lệnh: một tiến trình main quản lý cửa sổ,
tray, mở cùng máy và cập nhật, và một tiến trình con (Electron `utilityProcess`) chạy daemon thật
(`createDaemon()`, flow `daemon-runtime`) cùng các thao tác trình cài đặt và sức khỏe máy. Tách daemon khỏi
main để một UI crash hoặc đóng cửa sổ không bao giờ dừng job agent đang chạy.

## Điểm vào

- `apps/desktop/src/main/index.ts` — tiến trình main: cửa sổ, tray, mở cùng máy, cập nhật, thông báo, mở
  Terminal, IPC với renderer.
- `apps/desktop/src/daemon-host/index.ts` — điểm vào tiến trình con "daemon host": chỉ cài crash handler rồi
  nạp `host-main.ts`, nơi host thật nhận lệnh qua `MessagePort` của `utilityProcess` và chạy `HostService`.

## Các bước

1. `packages/shared/src/desktop-ipc.ts` → `DesktopRequests`, `HostOnlyRequests`, `ToHost`, `FromHost`: hợp
   đồng IPC dùng chung. Renderer chỉ gọi được các method trong `DesktopRequests` (mỗi method có schema zod
   input/output); main ↔ host nói thêm `HostOnlyRequests` (`host.startDaemon`, `host.stopDaemon`,
   `host.status`, `host.appState`) qua khung `ToHost`/`FromHost` (`request`/`facts` đi vào, `ready`/
   `response`/`event` đi ra).
2. `apps/desktop/src/main/ipc-handlers.ts` → `dispatchDesktopRequest()`, `isTrustedSender()`: mọi lời gọi từ
   renderer được validate lại bằng schema (renderer là input không tin cậy) trước khi chạy; chỉ frame của
   renderer đã bundle (hoặc dev server) mới được xử lý, người gọi khác nhận lỗi thay vì bị throw.
3. `apps/desktop/src/main/index.ts` → `mainHandlers`, `APP_FIXES`: các method cần chính app (`app.info`,
   `setup.*`, `folder.pick`, `daemon.pause/resume/restart`, 4 fix `open-claude-login`/`enable-login-item`/
   `install-update`/`restart-daemon`) được trả lời ngay trong main; mọi method khác forward sang daemon host
   qua `supervisor.request()`. Main dựng một `AppLog` (`apps/desktop/src/main/app-log.ts`) ghi
   `~/.crew/logs/app.log` — chỉ tiến trình main viết trực tiếp file này (host gửi dòng của nó qua port, xem
   bước 4/5); mỗi lời gọi IPC từ renderer được bọc qua `ipcLogEntry()` (`ipc-handlers.ts`) thành một dòng
   `event: 'ipc'` (method, `outcome: 'ok'|'error'`, ms, message lỗi nếu có — không log input vì có thể chứa
   mã ghép); `app.openLogFolder` mở `~/.crew/logs` bằng `shell.openPath`, `app.reportError` nhận lỗi chưa bắt/
   promise bị reject từ renderer (`reportRendererErrors()`, flow `desktop-ui`) và ghi thẳng vào log; sự kiện
   khác được ghi: `app-start` (kèm `temporaryLocation: true` khi exe đang chạy từ dmg gắn tạm hay macOS App
   Translocation — `/Volumes/`/`AppTranslocation/`), `daemon-host` (đổi trạng thái từ sự kiện `runtime` của
   supervisor), `daemon-host-ready-timeout` (host không báo `ready` kịp, từ sự kiện `ready-timeout` của
   supervisor — pid, ms, xem bước 4), `host-stdout`/`host-stderr` (mỗi dòng stdout/stderr của host — host được
   fork với `stdio: 'pipe'` vì mở từ Finder hay login item thì stdio riêng của app không đi đâu cả, xem bước 4),
   `updater-error`/`updater-unpublished`, `health-run-failed` (khi `runHealth()` không gọi được host), và
   `uncaught-exception`/`unhandled-rejection` của chính main.
4. `apps/desktop/src/main/daemon-supervisor.ts` → `DaemonSupervisor.spawn()`/`onExit()`/`startDaemon()`: fork
   `daemon-host.js` bằng `utilityProcess.fork()`; một host chết được khởi động lại với backoff nhân đôi (1 s →
   2 s → … → 30 s), backoff về lại 1 s nếu host đã sống quá 60 s (`stableMs`) trước khi chết; sau mỗi lần khởi
   động lại, nếu máy đã hoàn tất cài đặt thì daemon runtime được khởi động lại và trạng thái tạm dừng
   (`setPaused`) được áp lại. Một host không báo `ready` trong `readyTimeoutMs` (mặc định 30 s) bị coi là kẹt
   (event loop bị chặn) — sự kiện `ready-timeout` phát ra, host bị kill (SIGTERM) rồi khởi động lại theo backoff
   như trên; nếu SIGTERM không có tác dụng trong `killGraceMs` (mặc định 5 s) thì `forceKill()` (SIGKILL) chấm
   dứt hẳn — chỉ áp dụng cho host chưa từng báo `ready` (nên chưa chạy daemon nào), một host đã `ready` không
   bao giờ bị force-kill hay tính timeout nữa. `bootDaemon()` gọi `host.startDaemon` với timeout 30 phút vì lần
   khởi động daemon đầu tiên có thể phải chờ chủ dự án trả lời hộp thoại quyền macOS (xem bước 7).
   `stop('drain' | 'requeue')` dừng có kiểm soát: `drain` tạm dừng nhận job rồi chờ
   job đang chạy xong, `requeue` dừng ngay để job resume ở lần chạy sau. Sự kiện `host-log` chuyển tiếp mỗi
   dòng `app.log` mà host gửi (`kind: 'log'`) cho main ghi vào `AppLog`.
5. `apps/desktop/src/daemon-host/index.ts` là điểm vào tối thiểu của tiến trình host: đăng ký
   `uncaughtException`/`unhandledRejection` (`handlers`) trước khi nạp bất cứ gì khác, tính `./prompts/` cạnh
   chính nó rồi nạp `host-main.js` bằng `import()` động — lỗi lúc nạp hay crash trước khi host chạy được ghi
   thẳng ra stderr bằng `toStderr()` (`writeSync(2, …)`, vì trên macOS một write qua `process.stderr` vào pipe
   bị mất nếu theo ngay sau bởi `process.exit`) rồi thoát mã 1 để supervisor khởi động lại. `host-main.ts` →
   `runHost(promptsDir)` là host thật: gọi `setPromptsDir(promptsDir)` với thư mục do entry tính ở trên (vì
   code planner có thể nằm ở chunk khác với entry), dựng `HostService`, lắng nghe `port.on('message')` để
   nhận `ToHost` qua `process.parentPort`, validate bằng zod, gọi `HostService.handle()` rồi trả `FromHost`
   (`response`/`event`); `SIGTERM` gọi `shutdown()` và thoát mã 0. Host báo `post({kind: 'ready'})` **trước
   khi** có bất kỳ thao tác đĩa hay repo nào — `void service.start()` chạy sau, không chờ nó xong — để một
   hộp thoại quyền macOS còn treo (xem bước 7) không bao giờ chặn dòng báo `ready`; `deps.log` gửi mỗi dòng
   log của host (`HostContext.log()`) thành message `{kind: 'log', entry}` qua `parentPort`. `runHost()` trả
   về cặp handler crash/rejection thay cho handler tối thiểu của entry: `crash` ghi qua
   `service.activity.logger` và `service.host.log` rồi `shutdown(1)` (mã khác 0 để supervisor khởi động lại
   cả host lẫn daemon); `rejection` chỉ ghi log, không thoát. Prompt vai trò của flow `agent-roles` là file
   Markdown, không phải code nên `electron-vite` không tự bundle: `apps/desktop/electron.vite.config.ts`
   (plugin `copyRolePrompts`, hook `writeBundle` của build main) chép `apps/daemon/src/roles/prompts/*.md`
   vào `out/main/prompts/` cạnh bundle main.
6. `apps/desktop/src/daemon-host/host-service.ts` → `HostService`: constructor không đụng đĩa hay repo — chỉ
   dựng `HostContext`/`HealthOps`/`Activity` — để host báo `ready` (bước 5) trước khi làm gì tốn thời gian.
   `start()` (chạy một lần, nhớ lại promise) là việc dọn dẹp lúc khởi động, chạy sau khi đã báo `ready`: cài
   lại crew-docs (`installShippedCrewDocs()`), rồi `await this.host.repoAccess()` (chờ quyền đọc thư mục
   macOS, xem bước 7), rồi `repairBrokenHooks()` (`setup-ops.ts`) sửa hook của project nào có runtime/bundle
   không còn chạy được (ví dụ app đã bị chuyển chỗ), giữ nguyên hook đang chạy tốt của project khác.
   `startDaemon()`/`dispatch()`: `startDaemon()` cũng `await repoAccess()` trước (daemon khởi động chạy git
   đồng bộ trong repo) rồi mới gọi `createDaemon()` (flow `daemon-runtime`) **bên trong tiến trình host
   này** — daemon chạy độc lập với cửa sổ và renderer; `dispatch()` định tuyến method sang `setup-ops.ts`
   (trình cài đặt, Settings → Projects), `health-ops.ts` (sức khỏe), `activity.ts` (job, log) hoặc gọi thẳng
   `daemon.pause()/resume()`. `createDaemon()` nhận `onApiError: this.host.logApiError` nên mọi lỗi API của
   daemon (không riêng của setup-ops) cũng vào `app.log`. `handle()` bọc `dispatch()`: lỗi nào cũng ghi một
   dòng `host-op-failed` (method, ms, message, `errorCode`, `status`) trước khi ném lại cho main. Health chạy
   sau một đổi project (`afterProjectChange()`) không chờ trả lời (`this.background`, một `Set<Promise>`) —
   `settled()` chờ mọi lượt health nền đã bắt đầu xong, gọi khi `shutdown()` để không rớt báo cáo giữa đường.
7. `apps/desktop/src/daemon-host/host-context.ts` → `HostContext`, `HostError`: trạng thái dùng chung của các
   thao tác host — đọc lại config từ đĩa mỗi lần gọi (để CLI `crewd` và app luôn thấy cùng cấu hình), lưu là
   áp dụng cho daemon đang chạy ngay (`ctx.save()` gọi `daemon.updateConfig()`), không cần khởi động lại.
   `ctx.log(level, event, fields)` gửi một dòng `app.log` nguồn `host` qua `deps.log`; `ctx.logApiError`
   (lắp vào mọi `VpsClient` mà host dựng, kể cả của `ctx.vps()`) chuyển `ApiFailure` (flow `daemon-runtime`)
   thành dòng `api-error` — đổi tên trường `code` (mã lỗi API) thành `errorCode` vì `code` khớp mẫu tên trường
   bị ẩn (mã ghép máy). `ctx.repoAccess()` chờ mọi thư mục repo của project đang cấu hình được đọc xong (một
   lần cho đời host, chia sẻ qua Map `folderReads` cho các lời gọi đồng thời) trước khi có ai gọi git đồng bộ
   trong repo — macOS bảo vệ quyền riêng tư (TCC) chặn lần đọc đầu tiên của một thư mục dưới
   `~/Documents`/`~/Desktop`/`~/Downloads`/iCloud/ổ rời tới khi chủ dự án bấm "Allow" trên hộp thoại (quyền
   gắn với chữ ký app, nên app ký ad-hoc bị hỏi lại mỗi lần build lại); gọi git đồng bộ trong lúc hộp thoại
   còn treo sẽ chặn cả event loop của host. `apps/desktop/src/daemon-host/folder-access.ts` →
   `awaitFolderAccess(paths, hooks)` làm việc đọc đó bất đồng bộ (`readdir` tuần tự, một thư mục một lúc) để
   cái treo rơi vào một worker thread của libuv chứ không phải event loop; quá 5 giây chưa xong thì gọi
   `onWaiting` (host ghi dòng `folder-access-waiting`, mức `warn`, kèm gợi ý bấm Allow), xong rồi thì gọi
   `onResolved(path, ms, errorCode|null)` (host ghi `folder-access-resolved`) — bị từ chối trả lời ngay bằng
   mã lỗi (ví dụ `EPERM`) và các lệnh git gọi sau đó báo đúng lỗi ấy.
8. `apps/desktop/src/daemon-host/setup-ops.ts` → `checkServer()`, `pairMachine()`, `applyProjects()`,
   `createProject()`, `setFolder()`, `releaseProject()`, `ensureHooks()`, `repairBrokenHooks()`,
   `installProjectHooks()`, `requestTestSetup()`: các thao tác của trình cài đặt và Settings → Projects —
   `checkServer()` bắt buộc `https://` (trừ loopback) và gọi `GET /v1/health`; `applyProjects()`/
   `createProject()` dùng lại `repoFolderChecks()` (flow `daemon-health`) để validate thư mục trước khi
   claim/tạo project. `createProject()` tạo project mới xong luôn lưu thư mục và gọi `ensureHooks()`
   (`inspectHooks()` của flow `daemon-health`) để cài hook crew-docs ngay, trừ khi hook đang chạy tốt; hook
   cài lỗi thì nối lý do vào message của outcome, không chặn việc tạo project. Tạo lại một key máy này đã sở
   hữu với cùng repo (server trả 409 nhưng `ownerState: 'mine'` và cùng `repoUrl`, `sameRepo()`) là cùng một
   thành công (`status: 'already_owned'`, giữ idempotent cho câu trả lời bị mất mạng hoặc bấm hai lần); key đã
   có ở project/repo khác vẫn là lỗi 409 rõ ràng. `applyProjects()`/`setFolder()` cũng gọi `ensureHooks()` sau
   khi lưu thư mục — `setFolder()` thất bại thì thêm một dòng `folder.hooks` vàng vào kết quả validate thay
   vì ném lỗi. `ensureHooks()` không bao giờ ghi lại hook đang `ok`, và giữ nguyên runtime của một hook
   `stale` (chạy được nhưng bằng crew-docs cũ) khi cài lại. `hookView()`/`listHooks()` dùng `inspectHooks()`
   nên `HookView.detail` (schema `@crew/shared`) luôn có lý do hook chưa chạy hoặc bản đang chạy.
   `requestTestSetup()` gọi `VpsClient.requestProjectChange()` để máy tự đề nghị đổi `platform`/`uiTestMcp`
   của project mình — dịch lỗi 403/409 của server thành thông báo tiếng Việt (máy không sở hữu project /
   đã có yêu cầu khác đang chờ), không đổi gì tới khi chủ dự án xác nhận TOTP trên web (flow `project-claims`).
   (`ensureHooks()`/idempotent `createProject()` vá đúng sự cố từng gặp: chủ dự án bấm "Lưu và nhận project"
   ở bước cài đặt trong khi mới điền form "Thêm project mới từ thư mục" — nút đó khi đó chỉ áp dụng project
   đã tick sẵn, không tạo project vừa nhập, nên trình cài đặt xong mà máy chưa nhận project nào; tạo lại từ
   Settings → Projects khi đó không cài hook, dashboard sức khỏe đỏ ngay lượt chạy kế tiếp và bấm lại gặp
   409.)
9. `apps/desktop/src/daemon-host/health-ops.ts` → `HealthOps.run()`/`context()`: `run()` cũng
   `await host.repoAccess()` trước tiên vì các check repo chạy git đồng bộ; rồi dựng `HealthContext` (thêm
   `daemon`, `app` facts, `crewDocs: {source, runtime}`, `probeCheckout`, `quick`) rồi gọi `runHealthChecks()`
   dùng chung với `crewd doctor` (flow `daemon-health`). `full` chạy khi mở cửa sổ và theo yêu cầu; `quick`
   chạy mỗi 5 phút, bỏ qua lượt thử đăng nhập Claude, push dry-run và probe skill checkout (giữ lại dòng kết
   quả probe gần nhất qua `known`); trạng thái đổi thì gọi `daemon.heartbeat()` ngay để trang Máy trên web
   thấy cùng trạng thái với dashboard. Các lượt chạy chồng lên nhau (một fix, lịch 5 phút, một đổi project) —
   `runsStarted`/`newestApplied` đảm bảo một lượt cũ không bao giờ ghi đè báo cáo của một lượt mới hơn.
   `logChanges()` ghi một dòng `app.log` (`health-change`) cho mỗi check đổi trạng thái so với lần trước (lần
   đầu: mọi check không xanh) và một dòng `health-summary` khi trạng thái tổng đổi.
10. `apps/desktop/src/daemon-host/activity.ts` → `Activity.jobs()`/`tail()`/`logger`: danh sách job đang
    chạy/chờ/chờ thử lại (kèm tên và tiêu đề ticket) và nhật ký daemon (`~/.crew/logs/daemon.log`, JSON
    Lines, xoay vòng ở 10 MB); `logger` vừa ghi file vừa phát sự kiện `log.line` cho renderer.
11. `apps/desktop/src/main/quit-guard.ts` → `decideQuit()`: thoát app khi có job đang chạy hỏi trước — "Chờ
    job xong rồi thoát" (`drain`), "Dừng ngay, chạy tiếp lần sau" (`requeue`) hoặc "Huỷ"; không có job nào thì
    thoát ngay.
12. `apps/desktop/src/main/login-item.ts` → `electronLoginItem()`: mở cùng máy dùng
    `app.setLoginItemSettings`; khi launch tới từ login item, app chỉ hiện tray, không mở cửa sổ
    (`openedAtLogin()`), rồi báo sức khỏe qua heartbeat sau 15 giây.
13. `apps/desktop/src/main/tray.ts`, `apps/desktop/src/main/tray-view.ts` → `CrewTray.update()`, `trayView()`:
    icon tray là một chấm màu vẽ trực tiếp vào bitmap BGRA (không cần file ảnh) — xám khi chưa cài đặt xong,
    đỏ khi daemon không chạy, hoặc theo màu sức khỏe; tiêu đề hiện số job đang chạy.
14. `apps/desktop/src/main/notifications.ts` → `Notifier.onHealth()`/`onJobBlocked()`: thông báo macOS khi
    sức khỏe chuyển đỏ (liệt kê tối đa 3 mục lỗi) hoặc khi một job chuyển `blocked`.
15. `apps/desktop/src/main/updater.ts` → `Updater.check()`/`install()`, `isDeveloperIdSigned()`,
    `dmgAssetName()`, `isUnpublished()`: `electron-updater` kiểm bản mới từ GitHub Releases của
    `nquangphan/my-crew`; build ký Developer ID (có `TeamIdentifier` qua `codesign`) tải và cài luôn sau khi
    chờ hết job (`waitForIdle()` tạm dừng rồi `drain` daemon); build chưa ký chỉ mở link tải đúng file dmg của
    kiến trúc máy này (`dmgAssetName(version, process.arch)` → `2P-Crew-<version>-arm64.dmg` hay
    `...-x64.dmg`, `UpdaterDeps.arch` cho test) để cài tay. `isUnpublished()` phân loại lỗi của
    `electron-updater` khi repo GitHub chưa có bản phát hành nào (mã `ERR_UPDATER_NO_PUBLISHED_VERSIONS`/
    `ERR_UPDATER_LATEST_VERSION_NOT_FOUND`/`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`, hoặc thông báo chứa "No
    published versions"/404) thành `state: 'unpublished'` — không phải lỗi, khác lỗi mạng/TLS thật vẫn
    `state: 'error'`. Tắt hẳn khi `!app.isPackaged` hoặc ở chế độ test.
16. `apps/desktop/src/main/shell-env.ts` → `loginShellPath()`: app mở từ Finder hoặc login item nhận PATH tối
    thiểu của `launchd`; hàm này chạy shell đăng nhập một lần lúc khởi động để lấy PATH đầy đủ (nơi
    Homebrew/`~/.local/bin` cài `git`, `claude`, `npx`, `maestro`), gộp với fallback các thư mục thường gặp.
17. `apps/desktop/src/main/desktop-state.ts` → `DesktopStateStore`: trạng thái riêng của app
    (`~/.crew/desktop.json`, ghi atomic 0600) — đã hoàn tất cài đặt lúc nào, có đang tạm dừng nhận job không;
    sống sót qua khởi động lại app/host.
18. `apps/desktop/src/daemon-host/test-seams.ts` → `testSeams()`: chỉ bật khi
    `CREW_DESKTOP_TEST_MODE=1` (bộ E2E) — thay lượt thử đăng nhập Claude và probe kho skill bằng bản giả lập
    đọc/ghi file trong crew home của test; mọi phần khác (API, git, hook, config, daemon) vẫn chạy thật.
19. Đóng gói và phát hành (ngoài `apps/*/src/**` nên không thuộc file nguồn của flow, nhưng là nơi lắp app
    chạy được): `pnpm --filter @crew/desktop package:mac` (`scripts/package-mac.mjs`) dựng **một dmg và một
    zip riêng cho mỗi kiến trúc** vào `apps/desktop/release/` (gitignored) — `2P-Crew-<version>-arm64.dmg`,
    `2P-Crew-<version>-x64.dmg`, `2P-Crew-<version>-arm64-mac.zip` và `2P-Crew-<version>-x64-mac.zip`
    (`electron-builder.yml` → `mac.target` gồm `dmg` và `zip`, cả hai với `arch: [arm64, x64]`;
    `dmg.artifactName` cho dmg, `mac.artifactName` cho zip — tên dmg khớp `dmgAssetName()` ở bước 15, cả hai
    tên kiểm bởi `apps/desktop/test/main-logic.test.ts`). `scripts/stage-app.mjs --both-archs` đóng gói app ra
    ngoài workspace pnpm với một `node_modules` phẳng chỉ chứa các gói ngoài cần lúc chạy (`better-sqlite3`,
    Agent SDK, MCP SDK, `electron-updater`) cộng cả hai binary Claude Code của Agent SDK
    (`@anthropic-ai/claude-agent-sdk-darwin-arm64` và `-x64`), tắt `asar`. Một lượt `electron-builder` dựng cả
    hai kiến trúc và cả hai target từ stage đó (nên `latest-mac.yml` liệt kê mọi dmg và zip); `afterPack`
    (`keepOnlyArch()` trong `package-mac.mjs`) chạy một lần cho mỗi kiến trúc, trước khi ký và trước khi dmg
    hay zip được dựng từ app đó, xoá binary Claude Code của kiến trúc còn lại và mọi prebuild `better-sqlite3`
    trừ `prebuilds/darwin-<arch>.node` của chính app đó, nên mỗi app — và cả dmg, zip dựng từ nó — chỉ chứa
    đúng Electron, Claude Code binary và native module của kiến trúc của nó. Ký ad-hoc (`identity: "-"` trong
    `electron-builder.yml`), `hardenedRuntime: false`.
    `better-sqlite3` 13 nạp prebuild Node-API theo kiến trúc (`prebuilds/darwin-<arch>.node`) nên cùng một
    binary chạy được trong Electron. Chưa ký Developer ID và chưa notarize: lần đầu mở phải bấm chuột phải →
    Open (Gatekeeper), và cập nhật tự động vẫn chỉ mở link tải file dmg đúng kiến trúc (`Updater.check()`, bước
    15) — zip đã được dựng và đăng cùng dmg, chỉ chưa dùng tới vì app chưa ký. Job CI phát hành trên tag `v*`
    (`.github/workflows/ci.yml`, xem flow `deployment`) chạy chính `package:mac --publish` này. Bước ký và
    notarize sau này: xin chứng chỉ Developer ID Application; trên CI đặt `CSC_LINK` (file `.p12` mã hoá
    base64) và `CSC_KEY_PASSWORD`, cùng `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; trong
    `electron-builder.yml` bỏ `identity: "-"` (tự dò identity Developer ID), bật `hardenedRuntime: true`, thêm
    `notarize: true` dưới `mac` cùng entitlements cho phép `com.apple.security.cs.allow-jit`,
    `allow-unsigned-executable-memory`, `disable-library-validation` (Electron cần) — zip đã có sẵn cho mỗi
    kiến trúc từ trước, không cần đổi `mac.target` khi bật ký; `afterPack` chạy trước khi ký nên app đã ký (và
    cả dmg, zip dựng từ nó) không còn binary của kiến trúc khác, và cả hai kiến trúc được ký/notarize riêng
    trong cùng một lượt build. Squirrel.Mac (electron-updater tự cài trên build đã ký) cài từ file zip, không
    phải dmg — dmg vẫn là file cho người tải tay. Rồi chạy `node scripts/package-mac.mjs --publish` (hoặc job
    CI ở trên) để tải mọi dmg, zip, blockmap và `latest-mac.yml` lên GitHub Releases (cần `GH_TOKEN`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/desktop/src/main/index.ts` | Tiến trình main: khởi động, IPC, tray, health/update schedule | `mainHandlers`, `APP_FIXES`, `openWindow`, `runHealth`, `appInfo`, `quit` |
| `apps/desktop/src/daemon-host/index.ts` | Điểm vào tiến trình con daemon host: cài crash handler rồi nạp host-main | `handlers`, `toStderr` |
| `apps/desktop/src/main/daemon-supervisor.ts` | Fork, giám sát và giao tiếp với daemon host | `DaemonSupervisor`, `HostUnavailableError`, `HostProcess` |
| `apps/desktop/src/main/ipc-handlers.ts` | Validate và định tuyến lời gọi IPC từ renderer | `dispatchDesktopRequest`, `isTrustedSender`, `ipcLogEntry`, `MainHandlers` |
| `apps/desktop/src/main/window.ts` | Cửa sổ chính (sandbox, context isolation, không Node) | `createMainWindow` |
| `apps/desktop/src/main/tray.ts` | Icon và menu trên thanh menu bar | `CrewTray` |
| `apps/desktop/src/main/tray-view.ts` | Suy ra màu/nhãn tray từ trạng thái | `trayView`, `RGB`, `DotColor` |
| `apps/desktop/src/main/login-item.ts` | Mở cùng máy (login item macOS) | `electronLoginItem`, `fileLoginItem` |
| `apps/desktop/src/main/updater.ts` | Kiểm và cài bản mới qua electron-updater | `Updater`, `isDeveloperIdSigned`, `dmgAssetName`, `isUnpublished`, `RELEASES_URL` |
| `apps/desktop/src/main/app-log.ts` | Ghi `~/.crew/logs/app.log` (JSON Lines, ẩn credential, xoay vòng) | `AppLog`, `formatEntry`, `redactFields`, `localTimestamp`, `lineSplitter` |
| `apps/desktop/src/main/notifications.ts` | Thông báo macOS (sức khỏe đỏ, job blocked) | `Notifier` |
| `apps/desktop/src/main/terminal-launcher.ts` | Mở Terminal chạy `claude` để `/login` | `macTerminalLauncher`, `recordingTerminalLauncher` |
| `apps/desktop/src/main/quit-guard.ts` | Hỏi trước khi thoát nếu còn job chạy | `decideQuit`, `quitMessage`, `QUIT_BUTTONS` |
| `apps/desktop/src/main/shell-env.ts` | PATH của shell đăng nhập | `loginShellPath` |
| `apps/desktop/src/main/desktop-state.ts` | Trạng thái riêng của app (`desktop.json`) | `DesktopStateStore` |
| `apps/desktop/src/preload/index.ts` | Cầu nối `invoke`/`on` duy nhất cho renderer | `contextBridge.exposeInMainWorld` |
| `apps/desktop/src/daemon-host/host-main.ts` | Host thật: nhận lệnh qua MessagePort, báo `ready` rồi mới chạy startup | `runHost`, `HostHandlers` |
| `apps/desktop/src/daemon-host/host-service.ts` | Chạy daemon thật và định tuyến mọi thao tác host | `HostService` |
| `apps/desktop/src/daemon-host/host-context.ts` | State dùng chung của các thao tác host | `HostContext`, `HostError` |
| `apps/desktop/src/daemon-host/folder-access.ts` | Chờ quyền đọc thư mục macOS trước khi git đồng bộ chạy | `awaitFolderAccess`, `FolderAccessHooks` |
| `apps/desktop/src/daemon-host/setup-ops.ts` | Thao tác trình cài đặt và Settings → Projects | `checkServer`, `pairMachine`, `applyProjects`, `createProject`, `ensureHooks`, `repairBrokenHooks`, `installProjectHooks`, `requestTestSetup` |
| `apps/desktop/src/daemon-host/health-ops.ts` | Chạy health check dùng chung với `crewd doctor` | `HealthOps` |
| `apps/desktop/src/daemon-host/activity.ts` | Danh sách job và nhật ký daemon | `Activity` |
| `apps/desktop/src/daemon-host/test-seams.ts` | Thay SDK Claude bằng bản giả lập cho E2E | `testSeams`, `TestSeams` |
| `packages/shared/src/desktop-ipc.ts` | Hợp đồng IPC renderer↔main↔host | `DesktopRequests`, `DesktopEvents`, `HostOnlyRequests`, `ToHost`, `FromHost` |
| `apps/desktop/electron.vite.config.ts` | Build electron-vite (main/preload/renderer); chép prompt vai trò cạnh bundle main | `copyRolePrompts`, `ROLE_PROMPTS_SOURCE` |

## Dữ liệu

- Bảng: app không có bảng riêng — daemon host dùng lại `~/.crew/state.db` (`StateDb`, flow `daemon-runtime`)
  qua `HostContext.daemon`; trạng thái riêng của app (`setupCompletedAt`, `paused`) nằm ở
  `~/.crew/desktop.json` (`DesktopStateStore`), không phải bảng SQL.
- Log: `~/.crew/logs/app.log` (`AppLog`, JSON Lines, mode 0600, thư mục 0700, xoay vòng ở 2 MB giữ `app.log.1`/
  `app.log.2`) — chỉ tiến trình main viết; ghi thao tác IPC, lỗi gọi VPS API, đổi trạng thái sức khỏe/daemon
  host, lỗi updater, dòng stdout/stderr của host (`host-stdout`/`host-stderr`), host không báo `ready` kịp
  (`daemon-host-ready-timeout`), quyền đọc thư mục macOS đang chờ hay đã xong
  (`folder-access-waiting`/`folder-access-resolved`), và lỗi chưa bắt của main/host/renderer; đứng cạnh
  `daemon.log` (hoạt động job, bước 10) chứ không thay nó.
- Sự kiện: kênh IPC nội bộ Electron `crew:invoke`/`crew:event` (`DESKTOP_INVOKE_CHANNEL`/
  `DESKTOP_EVENT_CHANNEL`) giữa renderer và main; giao thức `ToHost`/`FromHost` (`request`/`facts` vào,
  `ready`/`response`/`event`/`log` ra — tên sự kiện: `daemon.status`, `health.report`, `jobs.changed`,
  `log.line`, `job.blocked`) giữa main và daemon host qua `MessagePort` của `utilityProcess`.
- Gọi ngoài: VPS API và Agent SDK qua daemon thật (xem `daemon-runtime`, `daemon-health`); GitHub Releases
  của `nquangphan/my-crew` qua `electron-updater` (kiểm và tải bản mới) và `npm pack`/`gh`-style publish lúc
  đóng gói; `/usr/bin/osascript` mở Terminal; `/usr/bin/codesign` kiểm chữ ký lúc quyết định tự cài bản mới;
  `app.setLoginItemSettings` (launchd login item); shell đăng nhập của owner để đọc PATH.

## Flow liên quan

- desktop-ui: renderer gọi đúng các method của `DesktopRequests` qua preload và nhận sự kiện của
  `DesktopEvents`; điều hướng bằng `Navigate` (route/section/projectKey).
- daemon-runtime: `HostService.startDaemon()` gọi `createDaemon()`; `setup-ops.ts`/`health-ops.ts`/
  `activity.ts` dùng lại mọi export của `apps/daemon/src/library.ts` (config, secrets, state DB, VPS client).
- daemon-health: `health-ops.ts` chạy `HEALTH_CHECKS`/`runHealthChecks()`/`applyHealthFix()` với
  `HealthContext` có thêm `daemon`, `app`, `crewDocs`, `probeCheckout`, `quick` — cùng danh sách check
  `crewd doctor` dùng; `setup-ops.ts` cũng gọi trực tiếp `inspectHooks()` của flow đó để cài/sửa hook ngay
  khi tạo/nhận project, không chờ tới lượt health chạy.
- docs-check, docs-hooks: `installShippedCrewDocs()`/`installProjectHooks()` cài bundle crew-docs vào
  `~/.crew/bin` và hook git của từng project, chạy bằng chính binary app (`ELECTRON_RUN_AS_NODE=1`) thay vì
  cần Node cài riêng trên máy.
- project-claims: `requestTestSetup()` gọi `POST /v1/daemon/projects/:projectKey/change-requests`; kết quả và
  trạng thái đang chờ hiển thị ở Settings → Projects (flow `desktop-ui`) tới khi chủ dự án quyết định.

## Tests

- `apps/desktop/test/daemon-supervisor.test.ts`: khởi động lại host chết với backoff tăng dần và khởi động
  lại daemon kèm áp lại trạng thái tạm dừng; backoff tăng gấp đôi ở lần chết liên tiếp; request đang chờ bị
  từ chối khi host chết và được trả lời lại sau khi khởi động lại; sự kiện host và facts được chuyển tiếp
  đúng, kể cả dòng `app.log` của host qua sự kiện `host-log`; dừng có kiểm soát theo từng chế độ không khởi
  động lại; `restart()` thay host ngay cho fix "khởi động lại daemon"; một host không báo `ready` kịp bị kill
  rồi force-kill (SIGKILL) khi SIGTERM không có tác dụng, và được khởi động lại vẫn trả lời được request đang
  chờ; một host đã báo `ready` thì không bao giờ bị force-kill hay tính ready-timeout.
- `apps/desktop/test/main-logic.test.ts`: `decideQuit()` hỏi đúng khi có job chạy; biên IPC từ chối method lạ
  và input sai trước khi chạy gì, trả lời method của main, forward phần còn lại, biến lỗi thành message, chỉ
  nhận renderer đã bundle, tên kênh preload khớp hợp đồng dùng chung; `ipcLogEntry()` ghi đúng outcome/ms/lỗi
  của mỗi lời gọi mà không log input; thông báo đúng một lần khi sức khỏe chuyển đỏ và khi job bị chặn; tray
  hiện đúng chấm màu/số job/nhãn tạm dừng; trạng thái cài đặt xong và tạm dừng sống sót qua khởi động lại
  (login item test không đụng macOS thật); updater: build chưa ký chỉ mở link tải đúng dmg kiến trúc máy này,
  build đã ký tải về rồi chờ hết job mới cài, tắt ở bản dev/test, phát hiện thiếu Developer ID, và
  `isUnpublished()` phân biệt đúng "chưa có bản phát hành" (mã lỗi hoặc thông báo 404 của electron-updater)
  với lỗi mạng thật; `mac.target` của `electron-builder.yml` có cả `dmg` và `zip` cho hai kiến trúc,
  `dmg.artifactName` khớp đúng `dmgAssetName()` và `mac.artifactName` đặt đúng tên zip
  (`2P-Crew-<version>-<arch>-mac.zip`) cho cả hai kiến trúc.
- `apps/desktop/test/host-service.test.ts`: kiểm tra server, ghép máy, claim project (202 chờ duyệt khi đang
  ở máy khác) rồi chạy được sau khi chủ dự án duyệt, kiểm `crew-docs.runtime` được ghi vào hook git đúng
  binary; tạo project từ thư mục cài hook ngay và không đỏ dashboard, từ chối key trùng của repo khác, tạo lại
  đúng key + repo máy này đã sở hữu là `already_owned` không phải lỗi, sửa cấu hình project khi đang chạy
  (không cần khởi động lại) và trả project; dựng `HostService` không đụng repo nào, hook có runtime đã biến
  mất chỉ được sửa lại sau khi gọi `start()`, hook đang chạy tốt bằng runtime khác (mô phỏng CLI node cạnh
  binary app) được giữ nguyên; mọi lỗi gọi API và lỗi
  thao tác host vào `app.log` không kèm token; `requestTestSetup()` trả về đúng `pendingChange`, chặn máy
  không sở hữu và yêu cầu trùng khi đang chờ, phản ánh đúng khi chủ dự án duyệt, và tự rút
  (`lastChange.status: 'withdrawn'`) khi máy trả project trong lúc yêu cầu còn chờ — tất cả chạy trên API
  thật.
- `apps/desktop/test/folder-access.test.ts`: đọc một thư mục chậm không chặn tick của event loop và vẫn ghi
  đúng thứ tự sự kiện chờ/xong, đọc từng thư mục một lúc (thư mục sau chỉ bắt đầu khi thư mục trước xong); một
  thư mục bị từ chối báo đúng mã lỗi (`EPERM`) qua `onResolved`, một thư mục đọc được báo `null`.
- `apps/desktop/test/app-log.test.ts`: ẩn field tên giống credential và mọi mẫu credential trong dòng, giữ
  thứ tự field cố định trước, giới hạn độ dài chuỗi/độ sâu object, giờ local kèm offset đúng; ghi JSON Lines
  mode 0600, xoay vòng đúng ở giới hạn kích thước giữ hai bản cũ, siết lại mode của file cũ và không ném lỗi
  khi đĩa từ chối ghi.
- `apps/desktop/test/role-prompts-bundle.test.ts`: chạy `copyRolePrompts.writeBundle()` vào một thư mục tạm
  rồi nạp mọi prompt của từng stage (`STAGES`, flow `agent-roles`) và các partial nó `{{> ... }}` từ thư mục
  đó, đúng như bundle đã đóng gói sẽ làm.
- `apps/desktop/test/e2e/health.spec.ts` (Electron thật qua Playwright `_electron`, bộ `test:e2e`): phá một
  check cho nó chuyển đỏ rồi tự sửa cho nó xanh lại; daemon sống sót qua việc đóng/mở lại cửa sổ và tự khởi
  động lại sau khi host bị kill.
- `apps/desktop/test/e2e/first-project.spec.ts` (Electron thật, bộ `test:e2e`): một project mobile chưa có
  docs được điền ở khung "Thêm project mới từ thư mục" trong trình cài đặt và lưu bằng nút của bước ("Lưu và
  nhận project" tự tạo project đang nháp trước khi áp dụng phần đã tick, "Tiếp" bị khoá tới khi tạo xong);
  commit của chủ dự án đi qua trước docs-init với một dòng cảnh báo; dashboard không đỏ (hook xanh, docs xanh
  kèm ghi chú); tạo lại đúng project từ trang Project là thành công, key trùng của project khác vẫn báo lỗi rõ
  ràng; "Mở thư mục log" gọi đúng `shell.openPath`; `app.log` có đủ các dòng mong đợi, không lộ mã ghép hay
  token, và file ở mode 0600.
- `pnpm --filter @crew/desktop smoke:mac` (`scripts/smoke-packaged.mjs`, thủ công, chỉ macOS): mở app đã
  đóng gói qua LaunchServices (`open -n`, giống Finder/login item nên stdio đi vào `/dev/null`) với
  `CREW_HOME`/`CREW_DESKTOP_USER_DATA` tạm, chờ tới 60 s cho `app.log` báo `daemon-host` ở trạng thái
  `running` rồi dừng tiến trình và xoá thư mục tạm — không đụng app hay `~/.crew` thật của chủ máy.
