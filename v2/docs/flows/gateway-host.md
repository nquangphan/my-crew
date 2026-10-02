# Host cổng macOS Crew v2

## Mục đích

Giữ cổng IPC và định danh một lần khởi động trong tiến trình Node riêng với cửa sổ Electron. Đóng hoặc crash ứng dụng giao diện không dừng host. Các tích hợp server, journal tiến trình và workflow thuộc những task kế tiếp; hiện host công bố trạng thái chưa cấu hình.

## Điểm vào

- `gateway/src/host/main.ts` tạo `GatewayHost` và xử lý SIGINT/SIGTERM.
- `gateway/src/host/gateway-host.ts` quản lý thư mục riêng, recovery và vòng đời; `gateway/src/host/process-lock.ts` giữ khóa theo tiến trình.
- `gateway/src/ipc/server.ts` phục vụ `GET status` và `POST open-ui` qua Unix socket.

## Các bước

1. `gateway/src/host/main.ts` → `new GatewayHost(...).start()`: khởi động host Node riêng. Lệnh `pnpm --dir v2/gateway build` tạo entrypoint `v2/gateway/dist/src/host/main.js` bằng Node ≥24.12.
2. `gateway/src/host/gateway-host.ts` → `GatewayHost.start`, `GatewayHost.removeProvenLegacyResidue`; `gateway/src/host/process-lock.ts` → `ProcessLock.acquire`: kiểm tra thư mục trạng thái thuộc UID hiện tại, chiếm khóa OS trên `host.guard` theo vòng đời tiến trình, rồi kiểm chứng loại/UID/mode/inode và owner cũ trước khi xóa residue `host.lock`, `host-recovery.lock`, socket và token. PID còn sống hoặc danh tính không rõ thì từ chối takeover; file lock rỗng chỉ được thu hồi khi không có handle đang mở.
3. `gateway/src/ipc/server.ts` → `GatewayRpcServer.start`, `GatewayRpcServer.handle`, `GatewayRpcServer.dispatch`: tạo token và socket mode `0600`, yêu cầu token cùng nonce mới cho từng RPC, giới hạn frame 8192 byte và deadline tuyệt đối 1500 ms từ lúc nhận connection. Mỗi socket chỉ nhận một response; lỗi client không làm host thoát. Node macOS hiện không cung cấp API peer UID trực tiếp nên host dựa vào quyền thư mục/token/socket.
4. `gateway/src/host/status.ts` → `initialStatus`; `gateway/src/ipc/server.ts` → `GatewayRpcServer.dispatch`: `GET status` trả `GatewayStatus` với boot ID mới; `POST open-ui` trả `NOT_CONFIGURED` cho tới khi có URL server được cấu hình và kiểm chứng.
5. `gateway/src/host/main.ts` → `host.stop({ drain: true })`; `gateway/src/host/gateway-host.ts` → `GatewayHost.stop`; `gateway/src/ipc/server.ts` → `GatewayRpcServer.stop`: SIGTERM/SIGINT ngừng nhận connection, đóng frame dở ngay, drain request đang xử lý tối đa 300 ms, rồi đóng socket và xóa token. `gateway/src/host/process-lock.ts` → `ProcessLock.release` thả khóa OS; file `host.guard` riêng tư có thể còn trên đĩa mà không giữ khóa sau crash.

## Files

| Đường dẫn | Vai trò |
|---|---|
| `gateway/package.json`, `gateway/pnpm-lock.yaml`, `gateway/tsconfig.json`, `gateway/tsconfig.build.json` | Gói độc lập, phiên bản Node/TypeScript và build |
| `gateway/src/host/status.ts` | `GatewayStatus`, `WorkflowStatus`, `SourcePin`, `ProjectionPin` và trạng thái ban đầu |
| `gateway/src/host/gateway-host.ts`, `gateway/src/host/process-lock.ts`, `gateway/src/host/main.ts` | Vòng đời host, khóa OS theo tiến trình, entrypoint |
| `gateway/src/ipc/server.ts` | RPC và quyền socket |
| `gateway/test/host-lifecycle.test.ts`, `gateway/test/host-failures.test.ts` | Process, crash, quyền socket, LaunchAgent thử nghiệm và hồi quy framing/recovery/deadline/drain |
| `gateway/test/support/host.ts`, `gateway/test/support/ui-client.ts` | Fixture RPC, client mới, LaunchAgent thử nghiệm và cleanup |

## Dữ liệu

`GatewayStatus` có `bootId`, `bootGeneration`, `serverConnection`, desired/applied revision, trạng thái source/projection cho BMAD và Superpowers, process đang chạy/chưa chắc chắn, thời điểm telemetry và quyền dịch vụ nền. Lúc này `bootGeneration`, cả hai revision và telemetry là `null`; connection là `unconfigured`, các slot là `missing`. Host không chứa token server, không claim ticket và không gọi model. Token IPC chỉ nằm trong thư mục riêng, không trả cho renderer.

## Flow liên quan

`desktop-shell` kết nối IPC; các flow journal, workflow và sync phase03 sẽ cung cấp dữ liệu thực cho DTO. Bản build development dùng Node của môi trường v2. Bản app ký, private Node đóng gói và đăng ký dịch vụ nền bền vững qua ServiceManagement thuộc phase09; không tự đăng ký nhãn của owner khi build/test.

## Tests

`pnpm --dir v2/gateway test` build host rồi kiểm tra boot ID giữ nguyên qua UI client exit, boot ID đổi sau restart, socket/token `0600`, client không xác thực bị từ chối, symlink token không được ghi đè, recovery sau crash và residue lock rỗng, contender sống không takeover, frame oversized hai lần không crash, drip frame hết deadline tuyệt đối, SIGTERM và active dispatch drain hữu hạn. Trên macOS, fixture dùng riêng nhãn `com.2pcrew.v2.test.<uuid>` và `launchctl bootout` chính nhãn đó sau test; non-macOS bỏ qua test launchd với lý do rõ ràng.
