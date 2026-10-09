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
  wizard (AP-5) bật ở bước `done`.

## Các bước

1. `src/main/index.ts` → `start`: `requestSingleInstanceLock`, đặt `userData` = `~/Library/Application Support/2P Crew`
   (cùng thư mục với `app.json`; HOME lấy từ biến `HOME`), dựng `AppStateStore` và `AppLog`, chờ `app.whenReady()`.
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
   (đăng nhập Paperclip, flow `mac-app-paperclip`). Còn là chú thích: wizard và gỡ v2 (AP-5, AP-6), project (PJ-1,
   PJ-2), cập nhật (UPD-1).
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

## Cầu nối crew-mac

`src/main/ops-bridge.ts` → `UtilityOpsBridge.call(op, ...args)` gửi `{ id, op, args }` tới `src/utility/ops.ts` và nhận
`{ id, ok, result | error }`. Utility chết giữa chừng thì mọi lời gọi đang chờ bị reject
`Tiến trình phụ dừng bất thường` và lần gọi sau tự `fork` lại. `createOpsHandlers` dựng `MacContext` mới mỗi lời gọi
bằng `createMacContext` với `cliPath = ~/.crew/app/crew-mac/dist/cli.js` (đường dẫn đã cài, không phải đường dẫn trong
bundle). Lỗi được ném lại ở Main với cùng `name` (ví dụ `SetupError`). Tham số không bao giờ vào log vì
`setStatusSecret` mang secret. Renderer không có đường tới `@crew/mac`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/mac-app/src/main/index.ts` | Khởi động, thứ tự đăng ký module | `start` |
| `apps/mac-app/src/main/app-context.ts` | Những gì mỗi `registerX` nhận | `AppContext` |
| `apps/mac-app/src/main/app-state.ts` | `app.json` (kiểu và kho ghi atomic, nối tiếp) | `AppStateStore`, `AppState` |
| `apps/mac-app/src/main/app-log.ts` | `app.log`: ẩn secret, xoay 10 MB, giờ `Asia/Ho_Chi_Minh` | `AppLog`, `redactFields` |
| `apps/mac-app/src/main/ipc.ts` | Đăng ký IPC theo danh sách kênh | `registerIpc`, `isTrustedSender` |
| `apps/mac-app/src/main/ops-bridge.ts` | Cầu nối tới utilityProcess | `UtilityOpsBridge`, `OpsApi` |
| `apps/mac-app/src/main/login-item.ts` | Login item macOS | `electronLoginItem` |
| `apps/mac-app/src/main/tray.ts` | Biểu tượng menu bar | `CrewTray` |
| `apps/mac-app/src/main/tray-state.ts` | Trộn trạng thái tray từ nhiều nguồn, nhãn menu | `mergeTrayState`, `effectiveColor`, `trayStatusLabel` |
| `apps/mac-app/src/main/register-health.ts` | Nối sức khỏe, run, log và vòng cập nhật tray | `registerHealth` |
| `apps/mac-app/src/main/health.ts` | Lịch doctor 15 phút, hàng đợi, thông báo khi đổi đỏ | `createHealth`, `worstStatus` |
| `apps/mac-app/src/main/runs.ts` | Danh sách run, hủy run qua REST, mở link web | `createRuns` |
| `apps/mac-app/src/main/logs.ts` | Đuôi bốn file log, lọc run id | `createLogs`, `tailFile`, `logPaths` |
| `apps/mac-app/src/main/notifications.ts` | Thông báo hệ thống | `createNotifier` |
| `apps/mac-app/src/main/window.ts` | Cửa sổ renderer sandbox | `createMainWindow` |
| `apps/mac-app/src/preload/index.ts` | `window.crew.invoke/on`, chỉ nhận kênh hợp lệ | |
| `apps/mac-app/src/shared/ipc-contract.ts` | Hợp đồng IPC I5 | `IPC_CHANNELS`, `IpcApi` |
| `apps/mac-app/src/utility/ops.ts` | Việc chạy trong utilityProcess | `createOpsHandlers` |
| `apps/mac-app/src/renderer/**` | Màn hình: thanh bên, Sức khỏe, Run đang chạy, Log (`routes/`), `CheckRow` | `App`, `ROUTES`, `HealthScreen`, `RunsScreen`, `LogsScreen` |

## Dữ liệu

- `~/Library/Application Support/2P Crew/app.json`: trạng thái bền (mode 600, ghi atomic bằng file tạm rồi `rename`,
  chỉ Main ghi, `update(fn)` nối tiếp). File hỏng thì đổi tên thành `app.json.broken-<giờ>` và dùng mặc định.
  `appVersion` luôn là bản đang chạy. `crew-mac` chỉ đọc `appVersion`, `sshdOwner`, `updateState` (flow `mac-setup`).
- `~/Library/Application Support/2P Crew/app.log`: JSON lines, mode 600, xoay một bản `app.log.1` khi vượt 10 MB. Field
  tên nhạy cảm (`token`, `secret`, `authorization`...) ghi `[đã ẩn]`, chuỗi `Bearer ...` và các dạng token quen thuộc
  trong cả dòng bị ẩn.
- App không ghi, xóa hay đổi tên file nào trong `~/.crew` ngoài việc gọi hàm `@crew/mac`.
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
- Danh tính ký lấy từ biến `CSC_NAME` lúc chạy, không ghi vào file. Build thử không ký:
  `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @crew/mac-app exec electron-builder --mac dir --arm64`.
  Notarize do `scripts/release.mjs` (ticket UPD-2).
- `safeStorage` chỉ dùng để mã hóa board API key Paperclip trước khi vào Keychain (flow `mac-app-paperclip`: khóa
  giải mã ở mục "2P Crew Safe Storage" chỉ app đọc được). Secret không đi qua renderer. Renderer: `sandbox`, `contextIsolation`, không
  `nodeIntegration`.

## Flow liên quan

- `mac-setup`: thư viện `@crew/mac` mà app gọi (setup, doctor, status, `installCrewMacFrom`).
- `mac-app-sshd`: bộ giám sát sshd agent và quit guard.
- `mac-app-paperclip`, `mac-app-update`: các flow của app do ticket sau tạo.

## Tests

- `apps/mac-app/test/app-state.test.ts`: tạo file mode 600, ghi nối tiếp, file hỏng, `appVersion`, bản sao.
- `apps/mac-app/test/app-log.test.ts`: ẩn secret, giờ Việt Nam, xoay file, ghi lỗi không ném.
- `apps/mac-app/test/ipc-contract.test.ts`: danh sách kênh, preload chỉ nhận kênh hợp lệ, `registerIpc`.
- `apps/mac-app/test/ops-bridge.test.ts`: cầu nối với utility giả, và `createOpsHandlers` với HOME giả.
- `apps/mac-app/test/renderer/app.test.tsx`: thanh bên và điều hướng hash.
- `apps/mac-app/test/health.test.ts`: lịch 15 phút, probe khi bấm, không chạy chồng, thông báo khi đổi đỏ/ổn.
- `apps/mac-app/test/runs.test.ts`: danh sách, hủy qua REST (không kill), 401, mở link web.
- `apps/mac-app/test/logs.test.ts`: đuôi file, lọc run id, giới hạn 512 KB, file ngoài danh sách bị từ chối.
- `apps/mac-app/test/notifications.test.ts`, `apps/mac-app/test/tray-state.test.ts`: thông báo và nhãn/màu tray.
- `apps/mac-app/test/renderer/health.test.tsx`: dòng LỖI/gợi ý, nút hành động, màn Run và Log, giờ Việt Nam.
