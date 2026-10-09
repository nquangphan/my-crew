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
3. `src/main/tray.ts` → `CrewTray`: chấm màu, số run, menu "Mở 2P Crew" và "Thoát". AP-3 gọi `update({ color, runs })`.
4. `src/main/window.ts` → `createMainWindow`: renderer sandbox, `contextIsolation`, không Node, cấm mở cửa sổ và
   điều hướng ra ngoài, từ chối mọi quyền.
5. Dòng `registerX(ctx)` của từng module. Đã bật: `registerSshd(ctx)` (bộ giám sát sshd và quit guard, flow
   `mac-app-sshd`; trả `SshdSupervisor`, ticket cần `activeRuns`/`pause`/`resume` thì đổi dòng thành
   `const sshd = registerSshd(ctx)`) và `registerPaperclip(ctx)` (đăng nhập Paperclip, flow `mac-app-paperclip`).
   Còn là chú thích: sức khỏe/run/log (AP-3), wizard và gỡ v2 (AP-5, AP-6), project (PJ-1, PJ-2), cập nhật (UPD-1).
   Mỗi `registerX` nhận `AppContext` (`src/main/app-context.ts`) và cài handler bằng `ctx.ipc.handle(kênh, fn)`.
6. Renderer: `src/renderer/app.tsx` giữ danh sách `ROUTES` của thanh bên (hash `#/<id>`), mỗi ticket thay đúng một
   dòng của mình bằng route thật. `src/renderer/lib/ipc.ts` → `invoke(kênh, ...)` gọi `window.crew.invoke`, reject
   bằng thông báo tiếng Việt của Main; `useStateChanged` nghe sự kiện `state:changed` (không payload, renderer gọi
   lại kênh đọc).

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
| `apps/mac-app/src/main/window.ts` | Cửa sổ renderer sandbox | `createMainWindow` |
| `apps/mac-app/src/preload/index.ts` | `window.crew.invoke/on`, chỉ nhận kênh hợp lệ | |
| `apps/mac-app/src/shared/ipc-contract.ts` | Hợp đồng IPC I5 | `IPC_CHANNELS`, `IpcApi` |
| `apps/mac-app/src/utility/ops.ts` | Việc chạy trong utilityProcess | `createOpsHandlers` |
| `apps/mac-app/src/renderer/**` | Màn hình (khung thanh bên) | `App`, `ROUTES` |

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
