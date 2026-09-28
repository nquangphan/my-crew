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
- `apps/desktop/src/daemon-host/index.ts` — tiến trình con "daemon host": nhận lệnh qua `MessagePort` của
  `utilityProcess`, chạy `HostService`.

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
   qua `supervisor.request()`.
4. `apps/desktop/src/main/daemon-supervisor.ts` → `DaemonSupervisor.spawn()`/`onExit()`/`startDaemon()`: fork
   `daemon-host.js` bằng `utilityProcess.fork()`; một host chết được khởi động lại với backoff nhân đôi (1 s →
   2 s → … → 30 s), backoff về lại 1 s nếu host đã sống quá 60 s (`stableMs`) trước khi chết; sau mỗi lần khởi
   động lại, nếu máy đã hoàn tất cài đặt thì daemon runtime được khởi động lại và trạng thái tạm dừng
   (`setPaused`) được áp lại. `stop('drain' | 'requeue')` dừng có kiểm soát: `drain` tạm dừng nhận job rồi chờ
   job đang chạy xong, `requeue` dừng ngay để job resume ở lần chạy sau.
5. `apps/desktop/src/daemon-host/index.ts` → `port.on('message')`, `shutdown()`: host nhận `ToHost` qua
   `process.parentPort`, validate bằng zod, gọi `HostService.handle()` rồi trả `FromHost` (`response`/
   `event`); `SIGTERM` hoặc `uncaughtException` gọi `shutdown()` và thoát với mã khác 0 để supervisor khởi
   động lại cả host lẫn daemon.
6. `apps/desktop/src/daemon-host/host-service.ts` → `HostService.startDaemon()`/`dispatch()`: gọi
   `createDaemon()` (flow `daemon-runtime`) **bên trong tiến trình host này** — daemon chạy độc lập với cửa
   sổ và renderer; `dispatch()` định tuyến method sang `setup-ops.ts` (trình cài đặt, Settings → Projects),
   `health-ops.ts` (sức khỏe), `activity.ts` (job, log) hoặc gọi thẳng `daemon.pause()/resume()`.
7. `apps/desktop/src/daemon-host/host-context.ts` → `HostContext`, `HostError`: trạng thái dùng chung của các
   thao tác host — đọc lại config từ đĩa mỗi lần gọi (để CLI `crewd` và app luôn thấy cùng cấu hình), lưu là
   áp dụng cho daemon đang chạy ngay (`ctx.save()` gọi `daemon.updateConfig()`), không cần khởi động lại.
8. `apps/desktop/src/daemon-host/setup-ops.ts` → `checkServer()`, `pairMachine()`, `applyProjects()`,
   `createProject()`, `setFolder()`, `releaseProject()`, `installProjectHooks()`, `requestTestSetup()`: các
   thao tác của trình cài đặt và Settings → Projects — `checkServer()` bắt buộc `https://` (trừ loopback) và
   gọi `GET /v1/health`; `applyProjects()`/`createProject()` dùng lại `repoFolderChecks()` (flow
   `daemon-health`) để validate thư mục trước khi claim/tạo project; `installProjectHooks()` cài hook
   crew-docs trỏ về chính binary app (`ctx.deps.runtime`, chạy với `ELECTRON_RUN_AS_NODE=1`);
   `requestTestSetup()` gọi `VpsClient.requestProjectChange()` để máy tự đề nghị đổi `platform`/`uiTestMcp`
   của project mình — dịch lỗi 403/409 của server thành thông báo tiếng Việt (máy không sở hữu project /
   đã có yêu cầu khác đang chờ), không đổi gì tới khi chủ dự án xác nhận TOTP trên web (flow `project-claims`).
9. `apps/desktop/src/daemon-host/health-ops.ts` → `HealthOps.run()`/`context()`: dựng `HealthContext` (thêm
   `daemon`, `app` facts, `crewDocs: {source, runtime}`, `probeCheckout`, `quick`) rồi gọi `runHealthChecks()`
   dùng chung với `crewd doctor` (flow `daemon-health`). `full` chạy khi mở cửa sổ và theo yêu cầu; `quick`
   chạy mỗi 5 phút, bỏ qua lượt thử đăng nhập Claude, push dry-run và probe skill checkout (giữ lại dòng kết
   quả probe gần nhất qua `known`); trạng thái đổi thì gọi `daemon.heartbeat()` ngay để trang Máy trên web
   thấy cùng trạng thái với dashboard.
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
    `dmgAssetName()`: `electron-updater` kiểm bản mới từ GitHub Releases của `nquangphan/my-crew`; build ký
    Developer ID (có `TeamIdentifier` qua `codesign`) tải và cài luôn sau khi chờ hết job (`waitForIdle()` tạm
    dừng rồi `drain` daemon); build chưa ký chỉ mở link tải đúng file dmg của kiến trúc máy này
    (`dmgAssetName(version, process.arch)` → `2P-Crew-<version>-arm64.dmg` hay `...-x64.dmg`, `UpdaterDeps.arch`
    cho test) để cài tay. Tắt hẳn khi `!app.isPackaged` hoặc ở chế độ test.
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
    chạy được): `pnpm --filter @crew/desktop package:mac` (`scripts/package-mac.mjs`) dựng **một dmg riêng cho
    mỗi kiến trúc** vào `apps/desktop/release/` (gitignored) — `2P-Crew-<version>-arm64.dmg` và
    `2P-Crew-<version>-x64.dmg` (`electron-builder.yml` → `mac.target` dmg với `arch: [arm64, x64]`,
    `dmg.artifactName`; tên này khớp với `dmgAssetName()` ở bước 15, kiểm bởi
    `apps/desktop/test/main-logic.test.ts`). `scripts/stage-app.mjs --both-archs` đóng gói app ra ngoài
    workspace pnpm với một `node_modules` phẳng chỉ chứa các gói ngoài cần lúc chạy (`better-sqlite3`, Agent
    SDK, MCP SDK, `electron-updater`) cộng cả hai binary Claude Code của Agent SDK
    (`@anthropic-ai/claude-agent-sdk-darwin-arm64` và `-x64`), tắt `asar`. Một lượt `electron-builder` dựng cả
    hai kiến trúc từ stage đó (nên `latest-mac.yml` liệt kê cả hai dmg); `afterPack` (`keepOnlyArch()` trong
    `package-mac.mjs`) chạy trước khi ký, xoá binary Claude Code của kiến trúc còn lại và mọi prebuild
    `better-sqlite3` trừ `prebuilds/darwin-<arch>.node` của chính app đó, nên mỗi app chỉ chứa đúng Electron,
    Claude Code binary và native module của kiến trúc của nó. Ký ad-hoc (`identity: "-"` trong `electron-builder.yml`), `hardenedRuntime: false`.
    `better-sqlite3` 13 nạp prebuild Node-API theo kiến trúc (`prebuilds/darwin-<arch>.node`) nên cùng một
    binary chạy được trong Electron. Chưa ký Developer ID và chưa notarize: lần đầu mở phải bấm chuột phải →
    Open (Gatekeeper), và cập nhật tự động rơi về đường link tải file dmg đúng kiến trúc; job CI phát hành
    (`.github/workflows`) chưa được tạo (thuộc Phase 8). Bước ký và notarize sau này: xin chứng chỉ Developer
    ID Application; trên CI đặt `CSC_LINK` (file `.p12` mã hoá base64) và `CSC_KEY_PASSWORD`, cùng `APPLE_ID`,
    `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; trong `electron-builder.yml` bỏ `identity: "-"` (tự dò
    identity Developer ID), bật `hardenedRuntime: true`, thêm `notarize: true` dưới `mac` cùng entitlements cho
    phép `com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`
    (Electron cần) — `afterPack` chạy trước khi ký nên app đã ký không còn binary của kiến trúc khác, và cả hai
    app kiến trúc được ký/notarize riêng trong cùng một lượt build. Squirrel.Mac (electron-updater tự cài trên
    build đã ký) cài từ file zip, không phải dmg, nên khi bật ký phải thêm target `zip` (mỗi kiến trúc) cạnh
    `dmg` trong `mac.target` — thiếu nó, bản ký vẫn không có zip để tự cài. Rồi chạy
    `node scripts/package-mac.mjs --publish` để tải lên GitHub Releases (cần `GH_TOKEN`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/desktop/src/main/index.ts` | Tiến trình main: khởi động, IPC, tray, health/update schedule | `mainHandlers`, `APP_FIXES`, `openWindow`, `runHealth`, `appInfo`, `quit` |
| `apps/desktop/src/daemon-host/index.ts` | Điểm vào tiến trình con daemon host | `port.on('message')`, `shutdown` |
| `apps/desktop/src/main/daemon-supervisor.ts` | Fork, giám sát và giao tiếp với daemon host | `DaemonSupervisor`, `HostUnavailableError` |
| `apps/desktop/src/main/ipc-handlers.ts` | Validate và định tuyến lời gọi IPC từ renderer | `dispatchDesktopRequest`, `isTrustedSender`, `MainHandlers` |
| `apps/desktop/src/main/window.ts` | Cửa sổ chính (sandbox, context isolation, không Node) | `createMainWindow` |
| `apps/desktop/src/main/tray.ts` | Icon và menu trên thanh menu bar | `CrewTray` |
| `apps/desktop/src/main/tray-view.ts` | Suy ra màu/nhãn tray từ trạng thái | `trayView`, `RGB`, `DotColor` |
| `apps/desktop/src/main/login-item.ts` | Mở cùng máy (login item macOS) | `electronLoginItem`, `fileLoginItem` |
| `apps/desktop/src/main/updater.ts` | Kiểm và cài bản mới qua electron-updater | `Updater`, `isDeveloperIdSigned`, `dmgAssetName`, `RELEASES_URL` |
| `apps/desktop/src/main/notifications.ts` | Thông báo macOS (sức khỏe đỏ, job blocked) | `Notifier` |
| `apps/desktop/src/main/terminal-launcher.ts` | Mở Terminal chạy `claude` để `/login` | `macTerminalLauncher`, `recordingTerminalLauncher` |
| `apps/desktop/src/main/quit-guard.ts` | Hỏi trước khi thoát nếu còn job chạy | `decideQuit`, `quitMessage`, `QUIT_BUTTONS` |
| `apps/desktop/src/main/shell-env.ts` | PATH của shell đăng nhập | `loginShellPath` |
| `apps/desktop/src/main/desktop-state.ts` | Trạng thái riêng của app (`desktop.json`) | `DesktopStateStore` |
| `apps/desktop/src/preload/index.ts` | Cầu nối `invoke`/`on` duy nhất cho renderer | `contextBridge.exposeInMainWorld` |
| `apps/desktop/src/daemon-host/host-service.ts` | Chạy daemon thật và định tuyến mọi thao tác host | `HostService` |
| `apps/desktop/src/daemon-host/host-context.ts` | State dùng chung của các thao tác host | `HostContext`, `HostError` |
| `apps/desktop/src/daemon-host/setup-ops.ts` | Thao tác trình cài đặt và Settings → Projects | `checkServer`, `pairMachine`, `applyProjects`, `createProject`, `installProjectHooks`, `requestTestSetup` |
| `apps/desktop/src/daemon-host/health-ops.ts` | Chạy health check dùng chung với `crewd doctor` | `HealthOps` |
| `apps/desktop/src/daemon-host/activity.ts` | Danh sách job và nhật ký daemon | `Activity` |
| `apps/desktop/src/daemon-host/test-seams.ts` | Thay SDK Claude bằng bản giả lập cho E2E | `testSeams`, `TestSeams` |
| `packages/shared/src/desktop-ipc.ts` | Hợp đồng IPC renderer↔main↔host | `DesktopRequests`, `DesktopEvents`, `HostOnlyRequests`, `ToHost`, `FromHost` |

## Dữ liệu

- Bảng: app không có bảng riêng — daemon host dùng lại `~/.crew/state.db` (`StateDb`, flow `daemon-runtime`)
  qua `HostContext.daemon`; trạng thái riêng của app (`setupCompletedAt`, `paused`) nằm ở
  `~/.crew/desktop.json` (`DesktopStateStore`), không phải bảng SQL.
- Sự kiện: kênh IPC nội bộ Electron `crew:invoke`/`crew:event` (`DESKTOP_INVOKE_CHANNEL`/
  `DESKTOP_EVENT_CHANNEL`) giữa renderer và main; giao thức `ToHost`/`FromHost` (`request`/`facts` vào,
  `ready`/`response`/`event` ra — tên sự kiện: `daemon.status`, `health.report`, `jobs.changed`, `log.line`,
  `job.blocked`) giữa main và daemon host qua `MessagePort` của `utilityProcess`.
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
  `crewd doctor` dùng.
- docs-check, docs-hooks: `installShippedCrewDocs()`/`installProjectHooks()` cài bundle crew-docs vào
  `~/.crew/bin` và hook git của từng project, chạy bằng chính binary app (`ELECTRON_RUN_AS_NODE=1`) thay vì
  cần Node cài riêng trên máy.
- project-claims: `requestTestSetup()` gọi `POST /v1/daemon/projects/:projectKey/change-requests`; kết quả và
  trạng thái đang chờ hiển thị ở Settings → Projects (flow `desktop-ui`) tới khi chủ dự án quyết định.

## Tests

- `apps/desktop/test/daemon-supervisor.test.ts`: khởi động lại host chết với backoff tăng dần và khởi động
  lại daemon kèm áp lại trạng thái tạm dừng; backoff tăng gấp đôi ở lần chết liên tiếp; request đang chờ bị
  từ chối khi host chết và được trả lời lại sau khi khởi động lại; sự kiện host và facts được chuyển tiếp
  đúng; dừng có kiểm soát theo từng chế độ không khởi động lại; `restart()` thay host ngay cho fix
  "khởi động lại daemon".
- `apps/desktop/test/main-logic.test.ts`: `decideQuit()` hỏi đúng khi có job chạy; biên IPC từ chối method lạ
  và input sai trước khi chạy gì, trả lời method của main, forward phần còn lại, biến lỗi thành message, chỉ
  nhận renderer đã bundle, tên kênh preload khớp hợp đồng dùng chung; thông báo đúng một lần khi sức khỏe
  chuyển đỏ và khi job bị chặn; tray hiện đúng chấm màu/số job/nhãn tạm dừng; trạng thái cài đặt xong và tạm
  dừng sống sót qua khởi động lại (login item test không đụng macOS thật); updater: build chưa ký chỉ mở link
  tải đúng dmg kiến trúc máy này, build đã ký tải về rồi chờ hết job mới cài, tắt ở bản dev/test và phát hiện
  thiếu Developer ID; `dmg.artifactName` của `electron-builder.yml` khớp đúng `dmgAssetName()` cho cả hai kiến
  trúc.
- `apps/desktop/test/host-service.test.ts`: kiểm tra server, ghép máy, claim project (202 chờ duyệt khi đang
  ở máy khác) rồi chạy được sau khi chủ dự án duyệt, kiểm `crew-docs.runtime` được ghi vào hook git đúng
  binary; tạo project từ thư mục, từ chối key trùng, sửa cấu hình project khi đang chạy (không cần khởi động
  lại) và trả project; `requestTestSetup()` trả về đúng `pendingChange`, chặn máy không sở hữu và yêu cầu
  trùng khi đang chờ, phản ánh đúng khi chủ dự án duyệt — tất cả chạy trên API thật.
- `apps/desktop/test/e2e/health.spec.ts` (Electron thật qua Playwright `_electron`, bộ `test:e2e`): phá một
  check cho nó chuyển đỏ rồi tự sửa cho nó xanh lại; daemon sống sót qua việc đóng/mở lại cửa sổ và tự khởi
  động lại sau khi host bị kill.
