# Host cổng macOS Crew v2

## Mục đích

Giữ cổng IPC và định danh một lần khởi động trong tiến trình Node riêng với cửa sổ Electron. Đóng hoặc crash ứng dụng giao diện không dừng host. Các tích hợp server, journal tiến trình và workflow thuộc những task kế tiếp; hiện host công bố trạng thái chưa cấu hình.

## Điểm vào

- `gateway/src/host/main.ts` tạo `GatewayHost` và xử lý SIGINT/SIGTERM.
- `gateway/src/host/gateway-host.ts` quản lý thư mục riêng, một lock cho mỗi host, socket và vòng đời.
- `gateway/src/ipc/server.ts` phục vụ `GET status` và `POST open-ui` qua Unix socket.

## Các bước

1. `gateway/src/host/main.ts` → `new GatewayHost(...).start()`: khởi động host Node riêng. Lệnh `pnpm --dir v2/gateway build` tạo entrypoint `v2/gateway/dist/src/host/main.js` bằng Node ≥24.12.
2. `gateway/src/host/gateway-host.ts` → `GatewayHost.start`, `GatewayHost.acquireLock`: kiểm tra thư mục trạng thái thuộc UID hiện tại và mode riêng, rồi chiếm `host.lock` độc quyền; chỉ thu hồi lock/socket/token cũ sau khi xác nhận PID đã chết và đúng loại/UID.
3. `gateway/src/ipc/server.ts` → `GatewayRpcServer.start`, `GatewayRpcServer.dispatch`: tạo token và socket mode `0600`, yêu cầu token cùng nonce mới cho từng RPC và giới hạn thời gian. Node macOS hiện không cung cấp API peer UID trực tiếp nên host dựa vào quyền thư mục/token/socket.
4. `gateway/src/host/status.ts` → `initialStatus`; `gateway/src/ipc/server.ts` → `GatewayRpcServer.dispatch`: `GET status` trả `GatewayStatus` với boot ID mới; `POST open-ui` trả `NOT_CONFIGURED` cho tới khi có URL server được cấu hình và kiểm chứng.
5. `gateway/src/host/main.ts` → `host.stop({ drain: true })`; `gateway/src/host/gateway-host.ts` → `GatewayHost.stop`: SIGTERM/SIGINT đóng socket, xóa token và lock của host. Lần khởi động sau xử lý lock còn lại khi tiến trình trước crash.

## Files

| Đường dẫn | Vai trò |
|---|---|
| `gateway/package.json`, `gateway/pnpm-lock.yaml`, `gateway/tsconfig.json`, `gateway/tsconfig.build.json` | Gói độc lập, phiên bản Node/TypeScript và build |
| `gateway/src/host/status.ts` | `GatewayStatus`, `WorkflowStatus`, `SourcePin`, `ProjectionPin` và trạng thái ban đầu |
| `gateway/src/host/gateway-host.ts`, `gateway/src/host/main.ts` | Vòng đời host, lock, entrypoint |
| `gateway/src/ipc/server.ts` | RPC và quyền socket |
| `gateway/test/host-lifecycle.test.ts` | Process, crash, quyền socket và LaunchAgent thử nghiệm |
| `gateway/test/support/host.ts`, `gateway/test/support/ui-client.ts` | Fixture RPC, client mới, LaunchAgent thử nghiệm và cleanup |

## Dữ liệu

`GatewayStatus` có `bootId`, `bootGeneration`, `serverConnection`, desired/applied revision, trạng thái source/projection cho BMAD và Superpowers, process đang chạy/chưa chắc chắn, thời điểm telemetry và quyền dịch vụ nền. Lúc này `bootGeneration`, cả hai revision và telemetry là `null`; connection là `unconfigured`, các slot là `missing`. Host không chứa token server, không claim ticket và không gọi model. Token IPC chỉ nằm trong thư mục riêng, không trả cho renderer.

## Flow liên quan

`desktop-shell` kết nối IPC; các flow journal, workflow và sync phase03 sẽ cung cấp dữ liệu thực cho DTO. Bản build development dùng Node của môi trường v2. Bản app ký, private Node đóng gói và đăng ký dịch vụ nền bền vững qua ServiceManagement thuộc phase09; không tự đăng ký nhãn của owner khi build/test.

## Tests

`pnpm --dir v2/gateway test` build host rồi kiểm tra boot ID giữ nguyên qua UI client exit, boot ID đổi sau restart, socket/token `0600`, client không xác thực bị từ chối, symlink token không được ghi đè, lock phục hồi sau crash. Trên macOS, fixture dùng riêng nhãn `com.2pcrew.v2.test.<uuid>` và `launchctl bootout` chính nhãn đó sau test; non-macOS bỏ qua test launchd với lý do rõ ràng.
