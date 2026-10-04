# Phase03 Task 1 — gateway host và desktop shell

**Trạng thái:** READY cho review Task1 local shell/IPC. Chưa phải chứng nhận runtime/server workflow phase03/04. Không commit; controller sở hữu manifest docs/Git.

## Kết quả

- Host Node trong `v2/gateway` chạy độc lập Electron, có `GatewayHost.start():Promise<void>`, `stop({drain:boolean}):Promise<void>`, `getStatus():GatewayStatus`. Mỗi tiến trình có boot ID riêng. Unix socket và token `0600` trong thư mục UID riêng `0700`; host lock ngăn phiên đồng thời và phục hồi sau crash khi PID cũ được xác nhận đã chết.
- `GatewayRpcServer` chỉ nhận `GET status`, `POST open-ui`, token đúng và nonce chưa dùng; `open-ui` hiện trả `NOT_CONFIGURED`. Node macOS không có `Socket.getPeerCredentials`; quyền được bảo vệ bằng thư mục/socket/token cùng UID và mode. Không có credential server trong DTO/UI.
- Electron `44.5.1` chạy cửa sổ local, `contextIsolation`, sandbox, `nodeIntegration:false`, CSP, chặn navigation/window ngoài; main kiểm tra `webContents.id`, sender URL, frame URL. Preload chỉ công bố `getStatus` và `openDashboard`. Renderer hiển thị chưa cấu hình/chưa bật cho tới tích hợp thực.
- Test LaunchAgent dùng nhãn duy nhất `com.2pcrew.v2.test.<uuid>` và `launchctl bootout` nhãn đó. Không tạo nhãn owner hay đăng ký persistent service. Bản development trỏ tới Node ≥24.12 hiện tại và host entrypoint đã build; Node private trong app ký và ServiceManagement onboarding thuộc phase09.

## Files thuộc Task1

- `v2/gateway/package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `tsconfig.build.json`, `src/host/{status,gateway-host,main}.ts`, `src/ipc/server.ts`, `test/host-lifecycle.test.ts`, `test/support/{host,ui-client}.ts`.
- `v2/desktop/package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `tsconfig.build.json`, `src/main/{client,index,security}.ts`, `src/preload/{index.cjs,index.d.cts}`, `src/renderer/{index.html,index.js,style.css}`, `test/{shell,electron-lifecycle}.test.ts`.
- `v2/docs/flows/{gateway-host,desktop-shell}.md` có đủ bảy mục chuẩn. Chưa sửa `v2/docs/flows.yaml` hay generated docs vì controller sở hữu.

## Xuất giao diện cho Task2/7

- `gateway/src/host/status.ts`: `GatewayStatus`, `WorkflowStatus`, `SlotStatus<T>`, `SourcePin`, `ProjectionPin`, `Workflow`, `Runtime`, `initialStatus`.
- `gateway/src/host/gateway-host.ts`: `GatewayHost`; `gateway/src/ipc/server.ts`: `GatewayRpcServer`.
- `gateway/test/support/host.ts`: `rpc(socket,method,route,credentialPath?)`, `quitUi(ui)`, `launchUiFromFreshProcess(socket)`, `isAlive(pid)`; thêm `bootHostViaLaunchd(root,label)`. `launchUiFromFreshProcess` là client Node riêng để kiểm tra host process, **không** thay cho chứng cứ Electron thật. Chứng cứ đó nằm ở `desktop/test/electron-lifecycle.test.ts`.
- `GatewayStatus` hiện trả `bootGeneration:null`, `serverConnection:'unconfigured'`, `desiredConfigRevision:null`, `appliedConfigRevision:null`, hai workflow với source và ba projection `missing`, `activeProcesses:[]`, `uncertainProcesses:[]`, `lastTelemetryAt:null`, `backgroundService:{permission:'not_requested',enabled:false}`. Task sau cập nhật dữ liệu thật, không được coi giá trị ban đầu là khả dụng.

## RED → GREEN và lệnh đã chạy

| Lệnh | Bằng chứng |
|---|---|
| `pnpm install --ignore-workspace` trong từng package mới | Cài riêng, tạo hai lockfile riêng; TypeScript `7.0.2`, Node types `26.6.3`, Electron `44.5.1`. Không sửa lock/workspace khác. |
| `pnpm --dir v2/gateway test --test-name-pattern='host lifecycle'` trước host | RED: socket/token chưa tồn tại (`ENOENT`). |
| `pnpm --dir v2/desktop test --test-name-pattern='shell'` trước security/preload | RED: thiếu module `src/main/security.ts`. |
| Crash/restart test trước lock recovery | RED: host mới không thể lấy lại socket/lock. |
| Symlink token và socket giả trước chốt bảo vệ | RED: với cờ ghi cũ `w`, mutation check cho thấy file đích bị thay bằng token; client nhận `ENOTSOCK` thay vì từ chối trước. GREEN sau khi tạo token độc quyền `wx` và kiểm socket bằng `lstat`. |
| Electron GUI test trước sửa ESM startup | RED: main module đã nạp nhưng `app.whenReady()` không trả trong 8 giây; lặp lại bằng direct binary và `open -n` LaunchServices. Không có `ELECTRON_RUN_AS_NODE`/`NODE_OPTIONS` kế thừa. Đổi top-level `await app.whenReady()` sang callback `app.whenReady().then(...)` theo [Electron quick start](https://www.electronjs.org/docs/latest/tutorial/tutorial-first-app). |
| `pnpm --dir v2/gateway test` cuối | **5/5 pass**, gồm launchctl transient agent trên macOS; `pnpm build` chạy trong test. |
| `pnpm --dir v2/desktop test` cuối | **5/5 pass**, không skip trên macOS: cửa sổ Electron thật đọc boot ID qua renderer→preload→main→host, đóng cửa sổ và chờ main thoát, SIGKILL main, mở tiến trình mới đọc cùng boot ID; `pnpm build` của hai package chạy trong test. |
| `pnpm --dir v2/gateway typecheck`, `pnpm --dir v2/desktop typecheck` | Cả hai exit 0. |

## Tự rà soát và giới hạn

- Host lock và token đều tạo với quyền riêng; client không xác thực bị từ chối, token symlink có sẵn không bị ghi đè, socket file giả bị chặn. Preload không truyền token hoặc Electron event object cho renderer. `POST open-ui` chưa có URL đã xác thực nên từ chối.
- Test Electron có hook cục bộ `CREW_V2_TEST_LIFECYCLE=1`: báo boot ID từ renderer và nhận SIGUSR2 để gọi `BrowserWindow.close()`; hook chỉ hoạt động khi test đặt env. Dùng SIGKILL trên Electron main PID thật cho nhánh crash, không coi fixture client Node là chứng cứ GUI.
- **Chưa tích hợp:** boot handshake server/boot generation, journal launch thật, telemetry, source/projection sync, credential, dispatch; không có model call. Test `launch-record.json` chỉ chứng minh host không xóa file không thuộc mình, không chứng minh ProcessJournal của Task2. `GatewayStatus` và RPC đã sẵn cho các task đó. Onboarding ServiceManagement và private Node bundle còn cần phase09; không tuyên bố quyền dịch vụ nền đã được cấp.
- Chưa chạy `crew-docs check --all` vì manifest/generated docs đang thuộc controller và hai flow mới chưa được map. Controller phải thêm các file Task1 vào hai flow và generate/check theo luật R2/R3 trước commit.

## Tài nguyên và cleanup

- Test sở hữu socket, token, lock, temp root và nhãn `com.2pcrew.v2.test.<uuid>`; fixture gọi `launchctl bootout` đúng nhãn rồi xóa plist/root. Kiểm tra `launchctl list` không còn nhãn test; `ps` không còn host/Electron test; `find "$TMPDIR" -maxdepth 1 -name 'crew-v2-*'` rỗng. Ba temp root từ những lượt test bị ngắt đã được xóa riêng sau khi kiểm process.
- `v2/gateway/node_modules` (~33 MiB), `v2/desktop/node_modules` (~354 MiB) cùng hai `dist/` là tài nguyên cài/build do Task1 tạo, hiện giữ cho controller và Task2 xác minh; đều được Git ignore và cần cleanup sau khi tích hợp nếu không dùng nữa. Không cài runtime toàn máy, không đăng ký owner LaunchAgent, không đổi DB/shared service.

## Bổ sung docs trước review

- Đã sửa riêng `Các bước` trong hai flow để mỗi bước có đường dẫn file nguồn và symbol/hook thực hiện hành vi (`file` → `symbol`), giữ đúng thứ tự bảy heading, giới hạn tích hợp và chứng cứ Electron thật.
- Kiểm tra docs-only bằng Node script đọc hai flow: cả hai có đúng thứ tự bảy heading, mỗi flow có năm bước `file → symbol`, và mọi đường dẫn source trong bước đều tồn tại (exit 0). Đối chiếu tên symbol với source Task1; không sửa source/test, không chạy lại test, không sửa manifest/generated docs/Git trong lượt chỉnh này.

## Bổ sung precommit Biome

- Chạy `pnpm exec biome check --write v2/gateway v2/desktop` trên đúng file Task1; formatter sửa 20 file. Xử lý hai lỗi còn lại (`noImplicitAnyLet`, `noShadowRestrictedNames`) và các cảnh báo `noExplicitAny`, `noNonNullAssertion`, `useTemplate` bằng kiểu rõ ràng, biến server/pid cục bộ và tên `escapePlist`.
- `GatewayClient.openDashboard` nay kiểm tra response có `url` kiểu chuỗi trước khi dùng; đây là thay đổi logic nhỏ nên đã chạy lại cả hai suite. Không đổi quyền IPC, URL HTTPS hay vòng đời host/Electron.
- Kiểm tra cuối: `pnpm exec biome check v2/gateway v2/desktop` → 23 file, không còn diagnostic; `pnpm --dir v2/gateway typecheck` và `pnpm --dir v2/desktop typecheck` đều exit 0; `pnpm --dir v2/gateway test` → 5/5 pass; `pnpm --dir v2/desktop test` → 5/5 pass gồm cửa sổ Electron macOS thật.
- Lượt này chỉ sửa working tree file Task1 và báo cáo; **không stage/commit**. Index đang do controller giữ nên cần controller cập nhật candidate sau khi review.
