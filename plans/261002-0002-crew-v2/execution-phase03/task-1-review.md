# Review độc lập phase03 Task 1

**Ready: No.** Cần sửa ba lỗi vòng đời RPC/lock bên dưới trước khi dùng Task1 làm dependency cho Task2. Phần desktop đạt phạm vi local shell đã giao; không có kết luận về server, journal hoặc readiness runtime.

## Phạm vi và bằng chứng

- Candidate: `e4fa9a1..163c37c`, branch `codex/crew-v2-server`; toàn bộ diff Task1 gateway/desktop source, tests, package metadata/lockfiles, hai flow, manifest và generated docs. Các file nguồn Task1 không có thay đổi working tree khi review.
- Đọc `docs/index.md`, hai flow `gateway-host`/`desktop-shell`, `execution-phase03/task-1-brief.md` và `task-1-report.md` trước khi review nguồn. Repo worktree không có `.codegraph/`.
- Chấp nhận bằng chứng worker cuối: gateway **5/5**, desktop **5/5** gồm Electron macOS thật, hai typecheck exit 0, Biome 23 file sạch. Chấp nhận bằng chứng controller cho nested docs `--all`/`--staged` và root staged check. Không chạy lại broad suite.
- Có ba targeted reproduction bằng Node **v24.14.0**, chạy entrypoint nguồn `v2/gateway/src/host/main.ts` bằng type stripping, mỗi host dùng `mkdtemp('crew-v2-review-')` riêng. Kết quả trực tiếp dưới đây bổ sung các nhánh chưa có trong suite, không phủ nhận kết quả 5/5 của worker.

## Findings

### F1 — P1: Client chưa xác thực có thể làm crash host bằng frame quá dài lần thứ hai

**File/line:** `v2/gateway/src/ipc/server.ts:57-61`, cùng thiếu listener `error` trong `handle` tại dòng 54-75.

Sau frame dài hơn 8192 ký tự, server gọi `socket.end(BAD_REQUEST)` nhưng vẫn giữ listener `data`. Client Unix socket dùng `allowHalfOpen:true`, gửi 9000 byte không có newline, rồi gửi thêm 9000 byte khi nhận `BAD_REQUEST`. Listener chạy lại và gọi `end` trên writable đã kết thúc. Socket phát `ERR_STREAM_WRITE_AFTER_END` không được xử lý, làm toàn bộ host thoát **exit 1**. Không cần biết token hoặc gửi request hợp lệ. Đây là client local có thể tới socket của cùng UID; quyền `0700/0600` vẫn chặn UID khác nhưng không bảo vệ host trước lỗi framing này.

**Bằng chứng trực tiếp:** `hostAlive:false`, `exit:1`; stderr có `Unhandled 'error' event`, `Error [ERR_STREAM_WRITE_AFTER_END]: write after end`, stack trỏ `server.ts:60:16`.

**Fix hẹp:** Kết thúc việc đọc request đúng một lần ở mọi nhánh terminal, gồm frame quá dài; bỏ listener hoặc chuyển sang trạng thái terminal và đóng/destroy socket. Gắn handler lỗi socket để lỗi của một client không thoát host; xử lý rejection của dispatch theo cùng nguyên tắc. Thêm test gửi hai chunk oversized, chờ client đóng và xác nhận host vẫn trả status với boot ID cũ.

### F2 — P2: Crash trong bước recovery để lại lock không thể phục hồi

**File/line:** `v2/gateway/src/host/gateway-host.ts:59-60`; chỉ xóa recovery lock trong `finally` tại dòng 93-95.

`host-recovery.lock` được tạo độc quyền nhưng không có owner/process identity hoặc nhánh khôi phục khi tồn tại. Nếu tiến trình bị SIGKILL hoặc máy tắt sau `open(...,'wx')` và trước `finally`, file còn lại vĩnh viễn. Mọi lần mở host sau đó lỗi `EEXIST` ngay tại dòng 60, dù PID trong `host.lock` chắc chắn đã chết. UI mở lại không thể kết nối nếu chưa xóa file thủ công. Nhánh tương tự ở startup còn có khoảng trống giữa tạo `host.lock` và ghi PID; hiện file PID rỗng cũng không phục hồi được, nhưng bằng chứng trực tiếp của review tập trung vào recovery lock.

**Bằng chứng trực tiếp:** Boot một host riêng, SIGKILL và await exit để tạo stale host lock/socket/token với PID đã chết; đặt file `host-recovery.lock` mode `0600` rỗng để mô phỏng chính residue do crash trong recovery. Boot mới thoát **exit 1**, stderr `EEXIST ... host-recovery.lock`, stack `GatewayHost.acquireLock ... gateway-host.ts:60:22`. Đây là fault injection vào trạng thái crash có thể đạt tới trong nguồn, không phải chứng cứ đã kill đúng instruction recovery ngoài thực tế.

**Fix hẹp:** Làm giao thức khóa chịu được crash cả khi tạo host lock lẫn recovery lock: ưu tiên khóa có vòng đời theo tiến trình, hoặc owner record được commit nguyên tử với cơ chế phục hồi identity/PID và kiểm tra UID/type. Vẫn phải từ chối takeover nếu owner sống hoặc không chứng minh được death; không sửa bằng cách xóa recovery file mù khi `EEXIST`. Thêm fault-injection tests cho residue recovery và gián đoạn khởi tạo, cùng test contender không chiếm lock của host sống.

### F3 — P2: Client gửi frame dở giữ SIGTERM shutdown quá thời hạn RPC

**File/line:** `v2/gateway/src/ipc/server.ts:39-45` và dòng 55.

`socket.setTimeout(1500)` là timeout khi socket không hoạt động; mỗi byte mới reset timeout. `stop()` chỉ đợi `server.close()` và không theo dõi/đóng các connection đang mở. Một client chưa xác thực gửi một byte mỗi 200 ms, không có newline, vẫn giữ host sống sau SIGTERM vì `close` chưa trả. Client có thể kéo dài shutdown hàng giờ trước khi chạm giới hạn 8192 ký tự. Trong thời gian đó host giữ lock/token và host mới bị chặn bởi PID cũ còn sống. Điều này làm thao tác dừng/restart không có thời hạn như hợp đồng RPC hiện ghi.

**Bằng chứng trực tiếp:** Kết nối client riêng, mỗi 200 ms ghi `x`, gửi SIGTERM cho host và chờ **2100 ms**: `hostAlive:true`, stderr rỗng. Sau khi đóng client, teardown của review kill/await chỉ các host của review và dọn root.

**Fix hẹp:** Áp deadline tuyệt đối cho một frame/request, không chỉ idle timeout. Theo dõi socket đang hoạt động; khi stop thì ngừng nhận connection, đóng các frame dở và giới hạn drain hữu hạn cho request đang xử lý. Cleanup socket/token/lock chỉ sau khi connection đã dừng. Thêm test slow frame + SIGTERM và xác nhận host exit, tài nguyên của host được dọn, host mới boot được.

## Đối chiếu yêu cầu

| Yêu cầu Task1 | Kết luận và giới hạn |
|---|---|
| Host tách Electron; macOS đóng cửa sổ/main crash/fresh reopen giữ boot ID | **Đạt trong phạm vi Task1.** `desktop/test/electron-lifecycle.test.ts:39-99` dùng Electron binary thật, renderer gọi preload/main/socket, SIGUSR2 đóng `BrowserWindow` rồi await main exit, SIGKILL main và await exit, spawn tiến trình mới đọc boot ID cũ. Host được spawn độc lập. Test launchd riêng dùng cùng host entrypoint và nhãn test riêng. Không nhầm Node UI fixture là chứng cứ Electron. |
| Singleton và crash recovery | **Chưa đạt đầy đủ:** exclusive host lock, PID death check và stale socket/type/UID check đúng hướng; F2 chặn recovery sau crash ngay trong giao thức khóa. |
| RPC local/token/socket/deadline | **Chưa đạt đầy đủ:** root `0700`, token/socket `0600`, random token, constant-time token check, nonce chống trùng trong cache, API hai route và rejection client sai token có bằng chứng. F1 làm framing crash host, F3 thiếu deadline/drain hữu hạn. Không có peer-UID API trên Node macOS; fallback quyền thư mục/token/socket được tài liệu công bố. |
| Renderer/preload/sender/navigation/URL authority | **Đạt.** `contextIsolation`, sandbox, Node tắt, CSP chỉ nguồn local, navigation chính xác URL và new-window deny; handler kiểm `webContents.id`, sender URL và frame URL trước RPC. Preload có hai hàm không nhận token hay Electron event; main chỉ mở URL HTTPS không user/password do host trả. Host hiện không cung cấp URL và trả `NOT_CONFIGURED`; việc xác minh cấu hình server thuộc task tiếp theo. |
| Status truthful, không model/server/runtime giả | **Đạt.** `initialStatus` trả unconfigured/null/missing, background permission `not_requested`, enabled false; không credential trong DTO, không claim/model call. UI hiển thị trạng thái đúng phạm vi. |
| Host restart/new boot, giữ launch record | Boot ID đổi sau stop/crash thông thường có test. `launch-record.json` chỉ là marker để kiểm không xóa file khác; report ghi rõ chưa chứng minh journal launch durable hoặc boot handshake server. Không lấy marker này làm readiness Task2. F2 vẫn cần sửa. |
| Own launchd/resource cleanup, package isolation | Fixture chỉ bootstrap/bootout nhãn `com.2pcrew.v2.test.<uuid>` dưới root riêng, không owner label/persistent install. Hai package và lockfile riêng ghim TS7.0.2/NodeTypes26.6.3/Electron44.5.1, Node floor24.12. Chấp nhận cleanup proof worker; private packaged Node/ServiceManagement còn phase09 theo ruling. Review không tạo launchd label, không thay global/service/DB. |

## Chất lượng và nội dung docs

- Implementation gọn, API preload có phạm vi rõ, clone status trước khi trả, không import v1. Suite có test hành vi quan trọng cho quyền socket/symlink và vòng đời GUI thật, không chỉ mock. Ba findings là thiếu nhánh lỗi/recovery/deadline của host; cần tests cho chính failure đã tái hiện.
- Hai flow có đủ bảy mục chuẩn và các bước `file → symbol` khớp nguồn. Manifest/generate map toàn bộ source/test/package Task1 vào flow đúng. Generated index/files có cả hai flow. Report đã nêu giới hạn unconfigured, Node dev và onboarding/private Node phase09; phần desktop docs khớp thực thi và bằng chứng.
- `gateway-host.md:17` nói RPC “giới hạn thời gian” nhưng hiện chỉ giới hạn idle; `gateway-host.md:19,42` nói recovery sau crash chưa phản ánh residue recovery F2. Khi sửa F2/F3 cần cập nhật mô tả và danh sách tests cùng commit. Đây là hệ quả của findings nguồn, không mở thêm scope docs hoặc coi docs check sạch là chứng minh hành vi runtime.

## Targeted verification và cleanup

Một lệnh `node --input-type=module` với heredoc đã chạy ba fixture lần lượt; mỗi fixture spawn `node v2/gateway/src/host/main.ts <root-riêng>`. Đường tái hiện chính:

1. `connect(host.sock,{allowHalfOpen:true})`; `write('a'.repeat(9000))`; khi nhận data thì `write('b'.repeat(9000))`; chờ 300 ms và kiểm `exitCode/stderr` → F1.
2. Boot host, SIGKILL, await exit; `writeFile(host-recovery.lock,'',{mode:0o600})`; boot lại → F2.
3. Boot host; connect socket; mỗi 200 ms `write('x')`; SIGTERM host; chờ 2100 ms và kiểm child vẫn sống → F3.

Heredoc exit **0** sau khi thu bằng chứng; không phải pass cho host. `finally` destroy toàn bộ socket review, SIGKILL/await chỉ child review còn sống, rồi `rm` chỉ ba `mkdtemp` root của review; output cuối `review-owned roots and children cleaned`. Không sửa source, không stage/commit, không spawn subagent, không chạy server/DB/model hoặc tác động dịch vụ owner.

**Điều kiện Ready:** sửa F1/F2/F3, thêm regression tests cho đúng nhánh lỗi, cập nhật flow gateway và cung cấp verification tương ứng. Không cần mở rộng sang server/runtime hoặc chạy lại suite Phase02 để xử lý ba finding local này.
