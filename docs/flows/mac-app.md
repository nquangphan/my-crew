# App macOS 2P Crew (khung, tray, cửa sổ, trạng thái)

> Flow `mac-app`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-app` in ra đúng danh sách đó.

## Mục đích

App Electron "2P Crew" (bundle `com.2p-solutions.crew.mac`) chạy nền trên Mac mini, bọc thư viện `@crew/mac` (flow
`mac-setup`) để owner cài, kiểm sức khỏe và theo dõi run bằng màn hình. Gói này là khung: một instance, tray, một cửa
sổ, login item, nhật ký, trạng thái bền, hợp đồng IPC cho mọi màn hình và cầu nối gọi `@crew/mac` trong
`utilityProcess`. Các màn hình và việc cụ thể (sshd, sức khỏe, wizard, Paperclip, project, cập nhật) do ticket sau
cắm vào các điểm đã chừa.

## Điểm vào

- Mở `2P Crew.app` (Finder, Dock hoặc login item). `apps/mac-app/src/main/index.ts` → `start`.
- Lần mở thứ hai chỉ đưa cửa sổ lên (`second-instance`). Đóng cửa sổ không thoát app (`window-all-closed` rỗng);
  thoát bằng menu tray "Thoát" (qua quit guard của flow `mac-app-sshd`: còn run thì hỏi).
- Mở từ login item (`wasOpenedAtLogin`) thì chỉ hiện tray, không mở cửa sổ. Login item không tự bật lúc khởi động:
  wizard bật ở bước `done`.

## Các bước

1. `src/main/index.ts`: đặt `userData` của Chromium = `~/Library/Application Support/2P Crew/chromium` TRƯỚC khi gọi
   `requestSingleInstanceLock` (`chromiumUserDataDir`: thư mục con cạnh `app.json`/`app.log`, để không đụng Local State, Preferences,
   Local Storage của app v2 nằm ngay trong thư mục cha; HOME lấy từ biến `HOME`). Khóa một instance nằm trong `userData`: xin khóa
   trước khi đổi thư mục thì app mới đụng khóa của app v2 đang mở và tự thoát im lặng. Rồi `start` dựng `AppStateStore` và `AppLog`, chờ `app.whenReady()`.
2. `src/main/ipc.ts` → `registerIpc`: `ipcMain.handle` cho đúng các kênh trong `IPC_CHANNELS`; kiểm URL frame gửi
   (`isTrustedSender`), kênh chưa có handler trả `Chưa hỗ trợ: <kênh>`, lỗi handler thành `{ ok: false, error }`.
3. `src/main/tray.ts` → `CrewTray`: chấm màu, số run, menu "Mở 2P Crew" và "Thoát". Nhiều nguồn cùng cập nhật bằng
   `update(patch)` (trộn từng phần, `src/main/tray-state.ts`): doctor đặt màu (xanh/vàng/đỏ theo `worstStatus`), vòng
   đếm run đặt số run, quit guard đặt `waiting`. Đang chờ run để thoát thì nhãn menu là "Đang chờ N run" và chấm vàng
   (trừ khi máy đỏ).
4. `src/main/window.ts` → `createMainWindow`: renderer sandbox, `contextIsolation`, không Node, cấm mở cửa sổ và
   điều hướng ra ngoài, từ chối mọi quyền.
5. Dòng `registerX(ctx)` của từng module. Đã bật: `const sshd = registerSshd(ctx)` (bộ giám sát sshd và quit guard,
   flow `mac-app-sshd`), `registerHealth(ctx, sshd)` (sức khỏe, run, log; xem mục dưới) và `registerPaperclip(ctx)`
   (đăng nhập Paperclip, flow `mac-app-paperclip`), `registerProjects` (thêm/gỡ project, flow `mac-app-paperclip`),
   `registerJobs(ctx)` ngay sau `registerSshd` (nhận việc từ hàng đợi máy, flow `mac-app-paperclip` mục "Nhận việc
   trên máy"; chạy utilityProcess riêng "2P Crew jobs", dừng ở `will-quit`).
   Đã bật: `registerSetup(ctx, sshd, health)` (wizard cài lần đầu, mục dưới, gồm gỡ app v2) và
   `registerUpdate(ctx, sshd)` (updater và màn hình Cập nhật, flow `mac-app-update`).
   Mỗi `registerX` nhận `AppContext` (`src/main/app-context.ts`) và cài handler bằng `ctx.ipc.handle(kênh, fn)`.
6. Renderer: `src/renderer/app.tsx` giữ danh sách `ROUTES` của thanh bên (hash `#/<id>`), mỗi ticket thay đúng một
   dòng của mình bằng route thật. `src/renderer/lib/ipc.ts` → `invoke(kênh, ...)` gọi `window.crew.invoke`, reject
   bằng thông báo tiếng Việt của Main; `useStateChanged` nghe sự kiện `state:changed` (không payload, renderer gọi
   lại kênh đọc).

## Sức khỏe, Run đang chạy, Log

`src/main/register-health.ts` → `registerHealth(ctx, sshd)` nối ba màn hình vào Electron và chạy vòng cập nhật tray.

- **Sức khỏe** (`health.ts` → `createHealth`): khi mở app và mỗi 15 phút gọi `doctor` qua `ops-bridge` với
  `{ probe: false, tccWindow: '24h', probeTimeoutSec: 90 }`. Nút "Kiểm lại có thử claude" (`health:run(true)`) chạy
  `probe: true` ngay. Các lần kiểm xếp hàng nối tiếp, không chạy song song. Kết quả đổi từ không có `fail` sang có
  `fail` thì một thông báo "2P Crew: máy có lỗi" (body là `title` của check `fail` đầu tiên); còn `fail` ở lần sau thì
  không báo lại; hết `fail` thì "2P Crew: máy đã ổn". Lần kiểm đầu tiên coi như trước đó chưa lỗi, nên máy đỏ ngay lúc
  mở app vẫn báo một lần. Thông báo hệ thống tạo ở `notifications.ts` (`createNotifier`, lỗi hiện thông báo bị nuốt).
  Màn hình `routes/health.tsx` liệt kê `CheckRow` (ĐẠT/CẢNH BÁO/LỖI, chi tiết, gợi ý) và nút theo id check:
  `tcc-pending` mở pane Quyền riêng tư (`health:action` `open-privacy`), `sshd-agent` về wizard (`#/setup`), còn lại
  "Mở Terminal" (`open-terminal`).
- **Run đang chạy** (`runs.ts` → `createRuns`): `runs:list` = `sshd.activeRuns()` (đọc bảng process, flow
  `mac-app-sshd`). "Hủy run" (có hỏi xác nhận) gọi `runs:cancel` → `paperclipClient(ctx).cancelRun(runId)` (REST,
  flow `mac-app-paperclip`); app không bao giờ `kill` process của run. 401 hoặc chưa đăng nhập thì báo "Cần đăng nhập
  lại Paperclip (mục Cài đặt)." "Mở trên web" gọi `runs:openWeb` → `runWebUrl(runId)` rồi `shell.openExternal`. Thời
  điểm bắt đầu hiển thị theo `Asia/Ho_Chi_Minh`.
- **Log** (`logs.ts` → `createLogs`): bốn file `app` (`~/Library/Application Support/2P Crew/app.log`), `sshd`,
  `reaper`, `status` (ba file sau lấy từ `macPaths`). Chỉ đọc tối đa 512 KB cuối, lọc dòng chứa run id rồi mới lấy N
  dòng cuối; file chưa có thì rỗng; tên file ngoài bốn giá trị bị từ chối. "Mở trong Finder" gọi
  `shell.showItemInFolder`.
- **Tray**: số run làm mới mỗi 30 giây và mỗi khi `sshd.onChange`; màu theo kết quả doctor gần nhất.

## Cài đặt lần đầu (wizard)

`src/main/setup/register.ts` → `registerSetup(ctx, sshd, health)` cài các kênh `setup:state`, `setup:step`, `setup:detect`, `setup:v2Detect`.
Màn hình `#/setup` (`routes/setup.tsx`) cũng là chỗ chạy lại một bước khi màn Sức khỏe báo lỗi ("Chạy lại cài đặt").

- **Thứ tự bước** (`wizard.ts` → `STEP_ORDER`): `check → v2 → move → paperclip → machine → disk-access → sshd → doctor →
  done`. Bước xong `ok` thì `setup.step` trong `app.json` là bước kế tiếp, nên đóng app giữa chừng rồi mở lại sẽ tiếp từ
  bước dở. Chỉ chạy được bước đã tới lượt hoặc bước cũ (chạy lại không lùi tiến độ; đã `done` thì chạy lại không đổi
  tiến độ). Bước ném lỗi thành kết quả `ok: false`. `v2` phải xong trước `move` vì app v2 và app này cùng tên
  `2P Crew.app` (bundle khác nhau: `com.2p-solutions.crew` và `com.2p-solutions.crew.mac`).
- **`v2`** (`v2-removal.ts`, "Gỡ app 2P Crew cũ"): CHỈ GỠ APP v2, GIỮ NGUYÊN DỮ LIỆU v2 (quyết định owner Q5).
  `setup:v2Detect` (chỉ đọc) tìm `/Applications/2P Crew.app`, đọc `CFBundleIdentifier` bằng `PlistBuddy` và hỏi
  `pgrep -f '<app>/Contents/MacOS/'` xem app v2 có đang chạy không (bỏ pid của chính app mới). Mỗi việc dưới đây chỉ
  chạy khi owner tích trong UI và bấm "Gỡ các mục đã chọn" (Main bỏ qua `setup:step` thiếu `confirm`):
  1. gỡ mục đăng nhập kiểu cũ: `osascript` xóa login item có đường dẫn `/Applications/2P Crew.app` (thử trước khi
     chuyển app đi);
  2. chuyển app v2 vào Thùng rác bằng `shell.trashItem` (khôi phục được, không `rm`);
  3. `tccutil reset All com.2p-solutions.crew` (chỉ bundle v2, không đụng quyền của app mới).
  App v2 đang chạy thì không làm gì và nhắc "Thoát app 2P Crew cũ (menu → Thoát) rồi bấm Thử lại" (app mới không tự
  kill). Bundle trong Applications mang id của chính app mới (kéo dmg đè lên) thì không vào Thùng rác và không đụng
  login item, chỉ còn việc xóa quyền của bundle v2. Login item kiểu `SMAppService` của app v2 không gỡ được từ app
  khác, nên sau khi gỡ luôn có hướng dẫn "Mở Cài đặt hệ thống → Cài đặt chung → Mục đăng nhập, tắt "2P Crew" cũ nếu
  còn" kèm nút mở `x-apple.systempreferences:com.apple.LoginItems-Settings.extension` (`health:action`
  `open-login-items`). Làm xong thì ở lại bước để hiện hướng dẫn; bấm Tiếp thì dò lại và đi. Không có app v2 thì chỉ
  có nút Tiếp.
  **Dữ liệu v2 được giữ nguyên:** toàn bộ thư mục `~/.crew` của v2 (`config.yaml`, `desktop.json`, `settings-cache.json`,
  `state.db`, `runtime/`, `assistant/`, `logs/` gồm `daemon.log` và `app.log`, `bin/`, file pid của `crewd`...) không bị
  xóa, sửa, di chuyển hay nén; `v2-removal.ts` không nhận đường dẫn HOME và không đưa đường dẫn dữ liệu vào đối số lệnh
  nào (test băm cây thư mục trước và sau, và kiểm nguồn không nhắc thư mục đó). Plan cũ có bước "sao lưu tar rồi xóa
  dữ liệu v2": đã bỏ.
- **`move`** (`createMoveStep`, "Chuyển vào Applications"): `isPackaged` sai (chạy thử) hoặc
  `app.isInApplicationsFolder()` đúng thì `ok`. Còn app v2 trong Applications thì từ chối "Gỡ app 2P Crew cũ ở bước
  trước" (`productName` của cả hai đều `2P Crew`); có một `2P Crew.app` lạ khác cũng từ chối. Chưa có `confirm: true` thì
  không chuyển. Có thì `app.moveToApplicationsFolder({ conflictHandler })` với `conflictHandler` trả sai riêng cho
  `existsAndRunning` ("Thoát bản 2P Crew đang chạy trong Applications rồi thử lại"). Thành công thì app tự mở lại từ
  Applications và wizard tiếp tục theo `app.json`.
- **`check`** (`machine-check.ts`): macOS 15 trở lên (`sw_vers`), Tailscale có IP 100.x
  (`/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4`), Claude Code đã đăng nhập
  (`/bin/zsh -lc 'claude auth status'` có `"loggedIn": true`). Chỉ đọc. Ghim Superpowers do `setup` cài và check
  `superpowers-pin` của doctor kiểm ở bước `doctor`.
- **`paperclip`** (`createPaperclipStep`): đăng nhập `cli-auth` chạy ở kênh `paperclip:*` (flow `mac-app-paperclip`: app
  tự mở trình duyệt, renderer hỏi `paperclip:loginStatus` mỗi 2 giây); bước này xác nhận company chọn có trong tài khoản
  rồi ghi `setup.companyId`.
- **`machine`** (`machine-step.ts`, `import-existing.ts`): `setup:detect` đọc manifest crew-mac, `~/.crew/status.json` và
  hỏi Keychain có mục `crew-mac-status` hay không (không đọc giá trị). Ba loại máy:
  - `existing` ("Nhận cài đặt có sẵn", chỉ có nút Tiếp): `installCrewMacFrom(<resources>/crew-mac)` → `configureStatus`
    giữ nguyên `url` đang có trong `~/.crew/status.json` (có thể là đường Tailscale đang chạy 200), chỉ đổi company; không có `url` thì
    dùng origin Paperclip đã đăng nhập → `setup({})` không cờ, giữ chủ sshd hiện có; không sinh key, không hỏi lại secret. Cài crew-mac
    bị từ chối vì còn run thì bước lỗi, thử lại khi rảnh.
  - `fresh`: bắt buộc key `ssh-ed25519 …` và secret webhook (một dòng); cổng mặc định 2222, thư mục mặc định
    `~/crew-agents` (`forbiddenRootReason` khác null thì lỗi đúng lý do, chưa gọi gì). Secret đi một lần tới
    `setStatusSecret` rồi bị xóa khỏi input; renderer xóa ô nhập khi xong. Thứ tự `installCrewMacFrom` →
    `setStatusSecret` → `configureStatus` (url theo origin Paperclip đã đăng nhập, vì máy mới chưa có url) → `setup`.
  - `broken` (manifest hỏng): hiện thông báo của `SetupError` và nút "Đã xử lý, kiểm tra lại". App không xóa file trong
    `~/.crew-mac` hay `~/.crew` (chỉ gọi hàm `@crew/mac`), nên owner tự xử lý theo thông báo.
  Sau `installCrewMacFrom`, `setup` luôn dùng `cliPath = ~/.crew/app/crew-mac/dist/cli.js` (utility dựng context).
- **`disk-access`** (`disk-access.ts`, "Quyền ổ đĩa"): owner chốt cấp Truy cập toàn bộ ổ đĩa (FDA) một lần cho 2P Crew
  và phải xong trước khi nhận run, vì hộp thoại quyền chưa bấm làm `claude` treo (spike SP-1). Dò bằng hai lần đọc chỉ FDA
  mới mở được (`~/Library/Safari`, `TCC.db`): đọc được `granted`, EPERM/EACCES `denied`, còn lại `unknown`; các nơi này
  không bao giờ nằm trong hộp thoại xin quyền nên dò không gây hộp thoại. Màn hình dò lúc mở bước và mỗi lần cửa sổ
  focus lại (`recheck`: chỉ báo trạng thái, không đi tiếp); nút "Mở Cài đặt hệ thống" dùng `health:action`
  `open-privacy`. Nút Tiếp khóa tới khi dò ra `granted`; `denied`/`unknown` bấm Tiếp cũng không đi tiếp (kèm giải thích). Đã bật mà vẫn báo
  chưa cấp thì thoát và mở lại 2P Crew.
- **`sshd`** (`sshd-handoff.ts` → `handoffSshd`): Full Disk Access (`deps.diskAccess()`) khác `granted` thì từ chối, không gọi `setup`, không start supervisor
  (màn hình dò lại như bước trước và khóa nút "Chuyển sshd" kèm giải thích). Còn run đang chạy (`supervisor.activeRuns()`) thì từ chối
  "Có N run đang chạy; chờ run xong rồi chuyển." Không thì `setup({ sshdOwner: 'app' })` → `supervisor.start()` → chờ tối
  đa 15 giây cho `status().state === 'running'` và `lsof -nP -iTCP:<cổng> -sTCP:LISTEN -t` chỉ có đúng pid của
  supervisor (có chủ thứ hai thì coi như chưa lên). **Tự lui**: listener không lên (hoặc `setup` sang app lỗi) thì `supervisor.pause()` (không để supervisor đang backoff giành cổng) rồi
  `setup({ sshdOwner: 'launchd', force: true })`, ghi `sshdOwner: 'launchd'` vào `app.json`, bước lỗi với lý do
  (`lastError` của supervisor) và 20 dòng cuối `sshd.log`, nói rõ đã tự chuyển về LaunchAgent; nếu lui cũng lỗi thì chỉ
  owner chạy `crew-mac setup --sshd-owner launchd`. Đã ở chế độ app và listener đang chạy thì `ok`, không gọi `setup`.
  Xong (thành công hay tự lui) thì làm mới sức khỏe để chấm màu tray cập nhật ngay. `registerSetup` bọc cả bước trong
  `sshd.holdQuit(...)` (flow `mac-app-sshd`): bấm Thoát giữa lúc đang đổi chủ sshd thì quit guard chờ bước này xong rồi mới hỏi.
- **`doctor`** (`createDoctorStep`): `doctor` có thử `claude` (`probe: true`, 90 giây); `ok` khi 0 `fail` (`warn` vẫn
  qua), thông báo liệt kê từng lỗi.
- **`done`**: chỉ chạy khi tiến độ đã tới `done` (mọi bước trước `ok`); bật login item (`loginItem.set(true)`). macOS
  còn chờ owner cho phép trong Mục đăng nhập thì vẫn xong, kèm hướng dẫn.

## Cầu nối crew-mac

`src/main/ops-bridge.ts` → `UtilityOpsBridge.call(op, ...args)` gửi `{ id, op, args }` tới `src/utility/ops.ts` và nhận
`{ id, ok, result | error }`. Utility chết giữa chừng thì mọi lời gọi đang chờ bị reject
`Tiến trình phụ dừng bất thường` và lần gọi sau tự `fork` lại. `createOpsHandlers` dựng `MacContext` mới mỗi lời gọi
bằng `createMacContext` với `cliPath = ~/.crew/app/crew-mac/dist/cli.js` (đường dẫn đã cài, không phải đường dẫn trong
bundle). Lỗi được ném lại ở Main với cùng `name` (ví dụ `SetupError`). Tham số không bao giờ vào log vì
`setStatusSecret` mang secret. Renderer không có đường tới `@crew/mac`. `addStatusRepo(projectId, path, companyId?)`
truyền company nhận ảnh chụp docs. Hai op của hàng đợi máy: `jobTargets()` (`machineId` và đích `{url, companyId}` của
bản tin, từ `readStatusConfig`/`listTargets`) `cancelMachineJob()` (giết nhóm tiến trình `git` đang chạy khi việc quá giờ) và `runMachineJob(job, extras)` (`runJob` của `src/main/jobs/executors.ts`
với `@crew/mac` thật: `addStatusRepo`, `listStatusRepos`, `doctor` không probe, `workflowCheck` với
`superpowersPinDir`); hàng đợi dùng một `UtilityOpsBridge` riêng để hủy việc quá giờ bằng `dispose()`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/mac-app/src/main/index.ts` | Khởi động, thứ tự đăng ký module | `start` |
| `apps/mac-app/src/main/app-context.ts` | Những gì mỗi `registerX` nhận | `AppContext` |
| `apps/mac-app/src/main/app-state.ts` | `app.json` (kiểu và kho ghi atomic, nối tiếp) | `AppStateStore`, `AppState` |
| `apps/mac-app/src/main/app-log.ts` | `app.log`: ẩn secret, xoay 10 MB, giờ `Asia/Ho_Chi_Minh` | `AppLog`, `redactFields` |
| `apps/mac-app/src/main/ipc.ts` | Đăng ký IPC theo danh sách kênh | `registerIpc`, `isTrustedSender` |
| `apps/mac-app/src/main/ops-bridge.ts` | Cầu nối tới utilityProcess (kể cả hai op của hàng đợi máy) | `UtilityOpsBridge`, `OpsApi` |
| `apps/mac-app/src/main/login-item.ts` | Login item macOS | `electronLoginItem` |
| `apps/mac-app/src/main/tray.ts` | Biểu tượng menu bar | `CrewTray` |
| `apps/mac-app/src/main/tray-state.ts` | Trộn trạng thái tray từ nhiều nguồn, nhãn menu | `mergeTrayState`, `effectiveColor`, `trayStatusLabel` |
| `apps/mac-app/src/main/register-health.ts` | Nối sức khỏe, run, log và vòng cập nhật tray | `registerHealth` |
| `apps/mac-app/src/main/health.ts` | Lịch doctor 15 phút, hàng đợi, thông báo khi đổi đỏ | `createHealth`, `worstStatus` |
| `apps/mac-app/src/main/runs.ts` | Danh sách run, hủy run qua REST, mở link web | `createRuns` |
| `apps/mac-app/src/main/logs.ts` | Đuôi bốn file log, lọc run id | `createLogs`, `tailFile`, `logPaths` |
| `apps/mac-app/src/main/notifications.ts` | Thông báo hệ thống | `createNotifier` |
| `apps/mac-app/src/main/setup/register.ts` | Nối wizard vào Electron (`setup:*`) | `registerSetup` |
| `apps/mac-app/src/main/setup/wizard.ts` | Máy trạng thái các bước, bước `paperclip`, `doctor`, `done` | `createWizard`, `STEP_ORDER`, `createPaperclipStep`, `createDoctorStep` |
| `apps/mac-app/src/main/setup/types.ts` | Kiểu kết quả một bước | `StepOutcome`, `StepRun` |
| `apps/mac-app/src/main/setup/machine-check.ts` | Bước `check`: macOS, Tailscale, Claude Code | `checkMachine` |
| `apps/mac-app/src/main/setup/import-existing.ts` | Nhận cài đặt có sẵn của máy | `detectExisting` |
| `apps/mac-app/src/main/setup/machine-step.ts` | Bước `machine` (máy có sẵn, máy mới) | `createMachineStep` |
| `apps/mac-app/src/main/setup/disk-access.ts` | Dò quyền ổ đĩa (FDA) không hộp thoại | `detectFullDiskAccess`, `diskAccessOutcome` |
| `apps/mac-app/src/main/setup/sshd-handoff.ts` | Chuyển sshd sang app, tự lui | `handoffSshd`, `listenerPids` |
| `apps/mac-app/src/main/setup/v2-removal.ts` | Bước `v2` (gỡ app v2, giữ dữ liệu) và `move` (vào Applications) | `detectV2`, `removeV2`, `createV2Step`, `createMoveStep` |
| `apps/mac-app/src/main/window.ts` | Cửa sổ renderer sandbox | `createMainWindow` |
| `apps/mac-app/src/preload/index.ts` | `window.crew.invoke/on`, chỉ nhận kênh hợp lệ | |
| `apps/mac-app/src/shared/ipc-contract.ts` | Hợp đồng IPC I5 | `IPC_CHANNELS`, `IpcApi` |
| `apps/mac-app/src/utility/ops.ts` | Việc chạy trong utilityProcess | `createOpsHandlers` |
| `apps/mac-app/src/renderer/**` | Màn hình: thanh bên, Sức khỏe, Run đang chạy, Log, Cài đặt (`routes/`), `CheckRow`, `WizardStep` | `App`, `ROUTES`, `HealthScreen`, `RunsScreen`, `LogsScreen`, `SetupScreen` |

## Dữ liệu

- `~/Library/Application Support/2P Crew/app.json`: trạng thái bền (mode 600, ghi atomic bằng file tạm rồi `rename`,
  chỉ Main ghi, `update(fn)` nối tiếp). File hỏng thì đổi tên thành `app.json.broken-<giờ>` và dùng mặc định.
  `appVersion` luôn là bản đang chạy. `crew-mac` chỉ đọc `appVersion`, `sshdOwner`, `updateState` và `jobsAgent`
  (flow `mac-setup`). `jobsAgent: {version, lastPollAt}` do vòng hỏi hàng đợi máy ghi (tối đa 30 giây một lần; flow
  `mac-app-paperclip`); thiếu nghĩa là app chưa nhận việc.
  `projects[key]` (`ProjectProgress`) là tiến độ thêm project của flow `mac-app-paperclip`: có `folder` (repo owner
  chọn); tiến độ bản cũ có `origin` thay cho `folder` vẫn đọc được. Kênh `projects:pickFolder` (hộp thoại chọn thư mục)
  khai trong `src/shared/ipc-contract.ts` cùng kiểu `FolderChoice`; `AddProjectInput` nhận `folder` thay cho `origin`.
- `~/Library/Application Support/2P Crew/app.log`: JSON lines, mode 600, xoay một bản `app.log.1` khi vượt 10 MB. Field
  tên nhạy cảm (`token`, `secret`, `authorization`...) ghi `[đã ẩn]`, chuỗi `Bearer ...` và các dạng token quen thuộc
  trong cả dòng bị ẩn.
- App không ghi, xóa hay đổi tên file nào trong `~/.crew` ngoài việc gọi hàm `@crew/mac`, trừ việc `skill-sync` của
  hàng đợi máy ghi `~/.crew/skills/<company>/<slug>/` (flow `mac-app-paperclip`).
- Gói đóng gói mang theo `Contents/Resources/crew-mac/` (bản `crew-mac` đã build) để cài ra `~/.crew/app/crew-mac`
  bằng `installCrewMacFrom`.

## Lưu ý quyền macOS

- Bundle id `com.2p-solutions.crew.mac`, chỉ arm64, `hardenedRuntime: true`, entitlements đúng hai khóa
  `allow-jit` và `allow-unsigned-executable-memory` (không `disable-library-validation`).
- `Info.plist` (`extendInfo` trong `apps/mac-app/electron-builder.yml`) có bốn chuỗi tiếng Việt:
  `NSDocumentsFolderUsageDescription`, `NSDesktopFolderUsageDescription`, `NSDownloadsFolderUsageDescription`,
  `NSRemovableVolumesUsageDescription` (spike SP-1: lần đầu `claude` chạy dưới app, macOS hỏi quyền ổ đĩa ngoài).
- Electron fuses (`electronFuses` trong `electron-builder.yml`, lật trong binary lúc đóng gói): `runAsNode: false`,
  `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`,
  `enableEmbeddedAsarIntegrityValidation: true`, `onlyLoadAppFromAsar: true`. Lý do: board key Paperclip nằm trong
  Keychain qua `safeStorage` mà ACL tin chính app này, nên agent cùng user mà chạy được binary app như node
  (`ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect`) là chạy mã dưới danh tính app và giải mã được key. App chỉ dùng
  `utilityProcess` (không fork vào chính binary) nên tắt `runAsNode` an toàn. Không đặt `grantFileProtocolExtraPrivileges`
  (renderer nạp bằng `file://`), `enableCookieEncryption` và `loadBrowserProcessSpecificV8Snapshot` (không cần).
  Đọc fuse: `node node_modules/.pnpm/@electron+fuses@*/node_modules/@electron/fuses/dist/bin.js read --app "<.app>"`.
  Lật fuse làm hỏng chữ ký ad-hoc của binary: bản không ký (`CSC_IDENTITY_AUTO_DISCOVERY=false`) bị kernel giết (mã 137);
  muốn chạy thử phải ký ad-hoc lại (`codesign --force --deep --sign -`) trên bản chép đã bỏ xattr (`ditto --noextattr`).
- Danh tính ký lấy từ biến `CSC_NAME` lúc chạy, không ghi vào file. Đóng gói thử:
  `pnpm --filter @crew/mac-app release --dev-sign --no-publish` (ký Apple Development) hoặc `--dry-run` (không ký);
  không gọi `electron-builder` trực tiếp (bản không ký đã lật fuse bị kernel giết, và nó không build lại `@crew/mac`).
  Notarize do `scripts/release.mjs` (`scripts/release.mjs`).
- `safeStorage` chỉ dùng để mã hóa board API key Paperclip trước khi vào Keychain (flow `mac-app-paperclip`: khóa
  giải mã ở mục "2P Crew Safe Storage" chỉ app đọc được). Secret không đi qua renderer. Renderer: `sandbox`, `contextIsolation`, không
  `nodeIntegration`.

## Flow liên quan

- `mac-setup`: thư viện `@crew/mac` mà app gọi (setup, doctor, status, `installCrewMacFrom`).
- `mac-app-sshd`: bộ giám sát sshd agent và quit guard.
- `mac-app-paperclip`: đăng nhập Paperclip, project. `mac-app-update`: phát hành, updater, màn hình Cập nhật.

## Tests

- `apps/mac-app/test/app-state.test.ts`: tạo file mode 600, ghi nối tiếp, file hỏng, `appVersion`, bản sao; `jobsAgent`
  ghi qua store thì `readJobsAgent` của crew-mac đọc được.
- `apps/mac-app/test/app-log.test.ts`: ẩn secret, giờ Việt Nam, xoay file, ghi lỗi không ném.
- `apps/mac-app/test/ipc-contract.test.ts`: danh sách kênh, preload chỉ nhận kênh hợp lệ, `registerIpc`.
- `apps/mac-app/test/ops-bridge.test.ts`: cầu nối với utility giả, và `createOpsHandlers` với HOME giả (kể cả
  `jobTargets` đọc `status.json`, `runMachineJob` từ chối payload sai).
- `apps/mac-app/test/renderer/app.test.tsx`: thanh bên và điều hướng hash.
- `apps/mac-app/test/health.test.ts`: lịch 15 phút, probe khi bấm, không chạy chồng, thông báo khi đổi đỏ/ổn.
- `apps/mac-app/test/runs.test.ts`: danh sách, hủy qua REST (không kill), 401, mở link web.
- `apps/mac-app/test/logs.test.ts`: đuôi file, lọc run id, giới hạn 512 KB, file ngoài danh sách bị từ chối.
- `apps/mac-app/test/notifications.test.ts`, `apps/mac-app/test/tray-state.test.ts`: thông báo và nhãn/màu tray.
- `apps/mac-app/test/renderer/health.test.tsx`: dòng LỖI/gợi ý, nút hành động, màn Run và Log, giờ Việt Nam.
- `apps/mac-app/test/setup-wizard.test.ts`: `check`, bước `machine` (máy có sẵn giữ url cũ, máy mới, thư mục bị cấm, manifest hỏng), máy trạng thái, `paperclip`, `doctor`, `done` (HOME và runner giả).
- `apps/mac-app/test/setup-import.test.ts`, `apps/mac-app/test/setup-disk-access.test.ts`: nhận cài đặt có sẵn, dò quyền ổ đĩa.
- `apps/mac-app/test/setup-v2-removal.test.ts`: dò app v2, gỡ chỉ việc được xác nhận, dữ liệu v2 nguyên vẹn (băm cây), app đang chạy, bundle của chính app mới, bước `move`.
- `apps/mac-app/test/setup-sshd-handoff.test.ts`: từ chối khi còn run hoặc chưa có quyền ổ đĩa, chuyển thành công, tự lui (dừng supervisor trước), đã ở chế độ app.
- `apps/mac-app/test/renderer/setup.test.tsx`: danh sách bước, từng bước, dò lại quyền khi focus, nút Tiếp và nút sshd khóa khi chưa cấp quyền, chạy lại bước.
