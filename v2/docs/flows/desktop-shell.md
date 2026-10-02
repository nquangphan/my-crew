# Giao diện cổng Crew v2 trên macOS

## Mục đích

Cho chủ máy xem trạng thái host và mở bảng điều khiển web khi được cấu hình. Electron chỉ là client; thoát hoặc crash main không dừng host độc lập.

## Điểm vào

- `desktop/src/main/index.ts` tạo cửa sổ Electron từ file cục bộ và nối IPC.
- `desktop/src/preload/index.cjs` chỉ công bố `getStatus` và `openDashboard`.
- `desktop/src/renderer/index.html` hiển thị tình trạng kết nối, dịch vụ nền và workflow bằng tiếng Việt.

## Các bước

1. `desktop/src/main/index.ts` → `app.whenReady().then(...)`: tạo `BrowserWindow` từ trang local sau khi Electron sẵn sàng. `pnpm --dir v2/desktop start` build và mở app; `pnpm --dir v2/desktop test` build hai package rồi kiểm thử.
2. `desktop/src/main/security.ts` → `secureWindowOptions`; `desktop/src/renderer/index.html` → thẻ `Content-Security-Policy`: bật `contextIsolation`, sandbox, tắt Node trong renderer và chặn nội dung ngoài.
3. `desktop/src/main/security.ts` → `createShellHandlers`, `navigationAllowed`; `desktop/src/main/index.ts` → `webContents.setWindowOpenHandler`: kiểm tra `webContents.id`, URL trang và `senderFrame.url`, chặn điều hướng khác trang và cửa sổ mới trước khi gọi host.
4. `desktop/src/preload/index.cjs` → `createPreloadApi`; `desktop/src/main/client.ts` → `GatewayClient.request`: preload chỉ gửi `getStatus` và `openDashboard`, còn main giữ token IPC và kiểm tra quyền socket. Renderer chỉ nhận DTO trạng thái; URL mở ngoài phải là HTTPS được host cung cấp khi đã cấu hình.
5. `desktop/src/renderer/index.js` → `refresh`: hiển thị host chưa chạy hoặc server chưa cấu hình đúng trạng thái, khóa nút web khi chưa cấu hình và giải thích quyền dịch vụ nền cần chủ máy cấp trong macOS.

## Files

| Đường dẫn | Vai trò |
|---|---|
| `desktop/package.json`, `desktop/pnpm-lock.yaml`, `desktop/tsconfig.json`, `desktop/tsconfig.build.json` | Gói Electron `44.5.1` và build riêng |
| `desktop/src/main/index.ts`, `desktop/src/main/security.ts`, `desktop/src/main/client.ts` | Cửa sổ, giới hạn IPC/URL và socket client |
| `desktop/src/preload/index.cjs`, `desktop/src/preload/index.d.cts` | API preload hẹp và khai báo kiểu |
| `desktop/src/renderer/index.html`, `desktop/src/renderer/index.js`, `desktop/src/renderer/style.css` | Trang local hiển thị status |
| `desktop/test/shell.test.ts`, `desktop/test/electron-lifecycle.test.ts` | Kiểm tra quyền IPC và cửa sổ Electron thật |

## Dữ liệu

Renderer chỉ nhìn thấy trạng thái được host trả về; không đọc token IPC, credential server hoặc Node API. `openDashboard` hiện nhận `NOT_CONFIGURED` vì host chưa có URL server đã xác minh. Màn hình dịch vụ nền ghi quyền `not_requested` và `enabled:false` cho đến onboarding có thật.

## Flow liên quan

`gateway-host` sở hữu socket và boot ID. Tích hợp server, cài workflow và quyền đăng ký persistent background item sẽ đi qua các phase tiếp theo; đóng cửa sổ không gửi `GatewayHost.stop`.

## Tests

`shell.test.ts` chặn sender/origin giả, kiểm tra preload hai lệnh và cấu hình cửa sổ không có Node. `electron-lifecycle.test.ts` trên macOS mở cửa sổ Electron thật, đọc boot ID qua renderer→preload→main→host, đóng cửa sổ và chờ main thoát, SIGKILL main ở lần mở khác, rồi mở lại và đọc cùng boot ID. Trên nền tảng khác test GUI được bỏ qua với lý do cụ thể.
