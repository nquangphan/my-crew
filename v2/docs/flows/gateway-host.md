# Host cổng macOS Crew v2

## Mục đích

Giữ cổng IPC và định danh một lần khởi động trong tiến trình Node riêng với cửa sổ Electron. Đóng hoặc crash ứng dụng giao diện không dừng host. Host hiện công bố trạng thái chưa cấu hình. Task 2 cung cấp API journal tiến trình/HTTP, telemetry và tài nguyên độc lập; tích hợp server/reconcile và workflow thuộc những task kế tiếp, chưa được gắn vào entrypoint Task 1.

## Điểm vào

- `gateway/src/host/main.ts` tạo `GatewayHost` và xử lý SIGINT/SIGTERM.
- `gateway/src/host/gateway-host.ts` quản lý thư mục riêng, recovery và vòng đời; `gateway/src/host/process-lock.ts` giữ khóa theo tiến trình.
- `gateway/src/ipc/server.ts` phục vụ `GET status` và `POST open-ui` qua Unix socket.

## Các bước

1. `gateway/src/host/main.ts` → `new GatewayHost(...).start()`: khởi động host Node riêng. Lệnh `pnpm --dir v2/gateway build` tạo entrypoint `v2/gateway/dist/src/host/main.js` bằng Node ≥24.12.
2. `gateway/src/host/gateway-host.ts` → `GatewayHost.start`, `GatewayHost.removeProvenLegacyResidue`; `gateway/src/host/process-lock.ts` → `ProcessLock.acquire`: kiểm tra thư mục trạng thái thuộc UID hiện tại, chiếm khóa OS trên `host.guard` theo vòng đời tiến trình, rồi kiểm chứng loại/UID/mode/inode và owner cũ trước khi xóa residue `host.lock`, `host-recovery.lock`, socket và token. Trên macOS, `lockf -k -n` giữ nguyên file guard sau khi thả khóa và không tự tạo lại path đã mất, nên contender dùng cùng inode. PID còn sống hoặc danh tính không rõ thì từ chối takeover; file lock rỗng chỉ được thu hồi khi không có handle đang mở.
3. `gateway/src/ipc/server.ts` → `GatewayRpcServer.start`, `GatewayRpcServer.handle`, `GatewayRpcServer.dispatch`: tạo token và socket mode `0600`, yêu cầu token cùng nonce mới cho từng RPC, giới hạn frame 8192 byte và deadline tuyệt đối 1500 ms từ lúc nhận connection. Mỗi socket chỉ nhận một response; lỗi client không làm host thoát. Node macOS hiện không cung cấp API peer UID trực tiếp nên host dựa vào quyền thư mục/token/socket.
4. `gateway/src/host/status.ts` → `initialStatus`; `gateway/src/ipc/server.ts` → `GatewayRpcServer.dispatch`: `GET status` trả `GatewayStatus` với boot ID mới; `POST open-ui` trả `NOT_CONFIGURED` cho tới khi có URL server được cấu hình và kiểm chứng.
5. `gateway/src/host/main.ts` → `host.stop({ drain: true })`; `gateway/src/host/gateway-host.ts` → `GatewayHost.stop`; `gateway/src/ipc/server.ts` → `GatewayRpcServer.stop`: SIGTERM/SIGINT ngừng nhận connection, đóng frame dở ngay, drain request đang xử lý tối đa 300 ms, rồi đóng socket và xóa token. `gateway/src/host/process-lock.ts` → `ProcessLock.release` thả khóa OS nhưng giữ `host.guard` trên đĩa với cùng device/inode qua stop/crash và lần chiếm khóa tiếp theo.

### Journal, gate và tài nguyên

Các API dưới đây là nền tảng Task 2; `GatewayHost` hiện chưa tự mở journal, claim, sync workflow hoặc gọi model.

1. `gateway/src/journal/atomic-records.ts` → `AtomicRecords.open`, `writeExclusiveRecord`, `atomicWrite`: chọn định dạng JSON `formatVersion: 1` trong các thư mục riêng `0700`, record `0600`. Mỗi store dùng `ProcessLock` riêng tại `.writer/host.guard`; lock mất thì từ chối ghi. Ghi record bằng file tạm exclusive/no-follow → fsync file → rename → fsync directory. Spawn intent dùng `O_EXCL` trực tiếp để hai launcher không cùng tạo child; file intent dở vẫn chặn retry. Recovery đọc record đã rename, bỏ qua `.pending-*`, từ chối version/loại/UID/mode/link count không hợp lệ; không thu hồi record unresolved theo TTL.
2. `gateway/src/journal/process-journal.ts` → `ProcessJournal.reserve`, `Launcher.spawnGated`; `gateway/src/journal/gated-helper.ts`: reserve exact source + một projection trước spawn; command ID cũ trả cùng launch UUID và input khác bị từ chối. Helper riêng có process group riêng, fsync READY kèm UUID/PID/start identity/PGID/UID trước khi báo parent. Trước RELEASE chỉ làm thao tác journal, probe native và chờ channel; channel đóng trước release thì thoát, không chạy command workflow.
   Admission/GC của registry managed: `WorkflowRegistry.open(...,{processJournal})` gọi `ProcessJournal.bindPinAdmission` với validator đọc immutable pair. Marker `workflows/pin-authority.json`, binding `process-journal/pin-admission.json` và registry journal-root record được fsync riêng, không đổi LaunchInput/LaunchRecord/version1. `reserve` giữ journal transaction từ kiểm binding + resolve pair đến ghi intent `admissions/<hash(commandId)>.json` rồi commit LaunchRecord; cùng `withPinAdmissionBarrier` serialize GC snapshot/quarantine/unlink. Lock order registry queue → journal queue; validator chỉ đọc immutable tree, không lấy registry queue ngược lại. Journal standalone cũ chỉ reserve khi không có managed marker; journal reopened/chưa bind từ chối `PIN_ADMISSION_NOT_BOUND` trước launch. Bind transition chờ transaction standalone đang chạy; current refs cũ được giữ. `pendingPinAdmissions` kê riêng intent chưa có exact committed record; crash không thả intent theo TTL/boolean. Intent committed được dedupe với actual LaunchRecord, không phải xóa terminal reference. Task5/Phase04 consumer bắt buộc giữ bound registry+journal cùng host root trước managed reserve; registry thiếu journal attachment không được published GC. Không callback viết/re-enter journal transaction bên trong barrier.
3. `gateway/src/journal/process-journal.ts` → `Launcher.release`, `ProcessJournal.authorize`: mặc định `RELEASE_NOT_CONFIGURED`; consumer phải cung cấp command, callback đọc pin server sau claim/reconcile và callback lấy capacity mới. So exact fence/attempt/process/source/runtime/projection/report, ghi durable authorization rồi mới mở gate. Helper nhận RELEASE tối đa một lần trước mọi await, nên retry đồng thời không chạy command hai lần. Mất reply/restart phải query server attempt/command trước callback release; Task 2 không cung cấp claim permit hoặc đổi guard server.
4. `gateway/src/journal/native.ts`, `gateway/src/journal/native-identity.c` → `ProcessIdentity.probe`, `ProcessIdentity.groupEmpty`: helper dùng `proc_pidinfo(PROC_PIDTBSDINFO)` lấy start sec/usec, UID và PGID. Start identity gắn launch UUID + PID + sec/usec + PGID + UID; PID thiếu, reuse, identity đổi hoặc probe lỗi đều `unknown`. Supervisor native chặn initial child trên pipe, arm `EVFILT_PROC` với `NOTE_FORK | NOTE_EXIT` trước exec và wait đúng child. Chỉ receipt không fork + kernel exit + parent wait đúng helper + `sysctl(KERN_PROC_PGRP)` xác nhận group rỗng mới tạo stopped proof. Bất kỳ fork nào, kể cả descendant đổi group/`setsid`, giữ tree `unknown` bền vững; macOS không hỗ trợ `NOTE_TRACK` từ 10.5 nên không suy ra toàn cây đã chết. `markStopped` chỉ kiểm chứng proof này, không nhận boolean/PID từ caller.
5. `gateway/src/journal/http-operations.ts` → `HttpOperationJournal.prepare`, `recordResponse`, `replay`: canonical body theo key UTF-16, body SHA-256, method/route/phase/key được fsync trước send. Mỗi logical operation/phase có UUID key riêng; input đổi dưới cùng ID bị từ chối, finalize không dùng key result. Restart replay cùng route/body/key; response ghi durable và immutable. Field body mang tên token/password/secret bị từ chối; transport nhận deep-frozen body, không có credential trong log. Consumer vẫn phải giữ credential ngoài body và query server sau ambiguous reply.
6. `gateway/src/resources/registry.ts`, `gateway/src/resources/native-resources.c` → `ResourceRegistry.reserveOwnedPath`, `createAndAttest`, `registerProcess`, `cleanup`: reserve UUID trước tạo directory exclusive bằng `mkdirat`/directory FD, callback chỉ xây dữ liệu trong path do host sở hữu, sau đó kiểm device/inode/UID/type và fsync identity; `linkCount` của directory chỉ là snapshot quan sát, vì output runtime hoặc partial delete có thể đổi số này. Regular file vẫn bắt buộc `st_nlink === 1` ở scan và ngay trước unlink để chặn hardlink alias. Crash trước attest giữ reservation chưa được quyền xóa. Layout lưu identity root/objects/quarantine qua restart; process ownership riêng gắn exact launch/start identity. Cleanup cần mọi process của run có stopped proof, không retention/other-run reference và không abort. Native reopen FD `O_NOFOLLOW`, so identity và scan không theo symlink/foreign mount/hardlink, `renameatx_np(RENAME_EXCL)` sang quarantine, so lại identity rồi mới `unlinkat` qua FD. Parent/symlink/hardlink/mismatch hoặc lỗi native giữ resource với lỗi sanitized. Restart sau rename trước record update chỉ nhận lại cùng inode trong quarantine khi path objects thiếu và parent identity khớp; abort sau quarantine giữ bytes để retry. Crash sau delete trước durable receipt giữ lỗi/missing proof để xử lý thủ công, không bịa ownership từ path đã biến mất.
7. `gateway/src/telemetry/capacity.ts`, `gateway/src/telemetry/macos-provider.ts` → `DispatchCapacity.sampleAndDecide`, `MacOsTelemetryProvider.sample`: sample mới cho mỗi implement/review/fix; `os.loadavg`, `availableParallelism`, `vm_stat`, `sysctl kern.memorystatus_vm_pressure_level`, `statfs` và process registry. Tuổi monotonic/wall quá 15 giây, thiếu sample, pressure warn/critical, RAM <2 GiB, disk <5 GiB, load/CPU >1, vượt min(configured/request max jobs) hoặc ownership key trùng đều chờ. Capacity chỉ là advisory để phase06 lưu rationale/decision, không tự claim.

### Đồng bộ, command bridge và retirement (Task 5)

`GatewayConnection` giữ boot CAS và heartbeat body/sequence/key bền vững qua mất reply; boot ID khác
bắt buộc reconcile. `GatewayEventPump` dùng SSE làm tín hiệu thức dậy, fallback poll `/v2/events` và chỉ
commit cursor sau reconcile thành công. `GatewaySync` đọc desired trước command, lưu từng command theo
machine/ID trước cursor; nguồn hoặc projection lỗi giữ received, báo partial và retry backoff có base tối đa 60 giây và jitter 0,75–1,25 (trần thực 75 giây).
Khi `SyncOptions.definitions` được cấp (thường là `createWorkflowManifest(registry)`), mỗi projection vừa báo `current` được gắn thêm `definition` `{sha256, skills, customizationSha256}` (kèm `render` nếu BMAD claude có) do `loadDefinition` trả; definition không có sẵn (BMAD ngoài claude, lỗi đọc) thì slot vẫn `current` nhưng không có trường này. Chỉ `WORKFLOW_DEFINITION_UNAVAILABLE` được bỏ qua; lỗi khác (ví dụ `WORKFLOW_SKILL_MISMATCH`) đưa slot sang `error` với `DEFINITION_FAILED` và mã lỗi đã lọc. Không cấp `definitions` thì report giữ nguyên hình dạng cũ. Khi `SyncOptions.prerequisites` được cấp (thường là `probeRenderPrerequisites` với đường dẫn `uv` của owner) và definition có `render` (BMAD claude), sync gọi nó với `projectionRoot` của projection đó và gắn thêm `prerequisites = {uv, python}`, mỗi phần là `{path, realpath, sha256, version}`; trường này additive, không đổi `definition` nên phép so definition của server không đổi. Đo lỗi (máy chưa có `uv` hay Python ≥3.11) chỉ bỏ trường, slot vẫn `current` với definition. Server hiện dùng schema strict cho install report nên chưa nhận trường này; host chưa cấp option cho tới khi schema server mở (lát đăng ký receipt). Mỗi report mới có ID riêng; report mất reply dùng đúng body/key cũ. Revision bị thay thế hoàn tất command cũ
với SUPERSEDED; revision mới dùng command mới. Namespace sync_models thuộc consumer riêng.
Config và command là hai GET riêng: command có revision cao hơn snapshot phải chờ pass mới;
chỉ revision thấp hơn desired hiện hành mới được SUPERSEDED.

`HttpOperationJournal.retryTransient` giữ nguyên `replay` và response đầu bất biến trong
`http-operations`; `http-retries` chứa từng attempt/response bổ sung. Chỉ 500/502/503/504 được gửi lại,
mỗi lần gọi tối đa một send, cùng route/body/key gốc; lịch chờ durable tăng tới 60 giây. Attempt mất
reply giữ nguyên qua reopen; response thành công settle một lần. Lỗi HTTP không chứng minh chưa có tác động;
actual server receipt dưới cùng key quyết định kết quả. Khi report pending thuộc boot cũ, trước hết replay đúng key; chỉ response BOOT_RETIRED đã xác nhận và tuple boot mới khác mới cho phép pass sau tạo report ID mới từ cache được verify lại. Operation/report cũ vẫn bất biến; reply ambiguous hoặc 503 không đi nhánh thay report. Không tạo mutation key mới để né lỗi.

`GatewayConnection.advanceBoot` chỉ chạy khi bind actual `TicketCommandBridge` cùng host root;
mặc định từ chối. Lock order là connection → bridge → journal; callback nội bộ chỉ ghi connection đang
được giữ, không mở lại transaction connection hay gọi registry. Bridge đối chiếu owned records trước,
observe bên ngoài journal barrier, rồi kiểm lại toàn bộ snapshot/admission và scoped attempt/companion
bên trong barrier. `retained-unknown` chỉ áp dụng cho exact active/uncertain đã nhận diện: được online
boot mới nhưng giữ guard/pin, không STOP/claim/finalize/retire hay cho replacement RELEASE.
Orphan admission, thiếu claim/tuple hoặc snapshot đổi thì từ chối. History/receipt prior boot + generation +
next boot và pending pointer được fsync trước POST; server007 CAS vẫn quyết định generation. Mất reply
reopen dùng lại pending boot/body/key; boot cũ không lấy lại quyền, heartbeat boot mới bắt đầu sequence 1.


`TicketCommandBridge` chỉ nhận command từ scoped authenticated read. Permit production mặc định từ chối;
permit fixture được tách riêng. Reserve dùng registry+journal đã bind, READY trước claim, rồi xác nhận
attempt hiện hành và companion server-stored selection trước RELEASE. Mất reply replay đúng UUID/key/body;
005 pagination bắt đầu từ null mỗi pass, không dùng UUID làm durable cursor. Reconcile command cũng kiểm
scope và ACK received/completed bền vững. Reconnect đối chiếu owned state trước dispatch, ghi failure riêng từng command rồi tiếp tục các page/control độc lập; cuối pass trả aggregate lỗi. Reconcile control chỉ đối chiếu ticket của nó, nên failure ticket khác không chặn ACK. Receipt retirement hợp lệ được kiểm và skip trước live scoped GET; history thiếu/conflict receipt vẫn fail closed riêng record. Result, stopped reconciliation và finalize có operation key riêng;
finalizing giữ guard; finalize còn pending được kiểm lại bằng operation mới sau response xác nhận.

Pause/cancel kiểm command type/ticket/payload và exact launch trước signal owned PGID; lưu stop reason
trước tác động, ACK completed chỉ sau exact STOP. Retry ACK sau khi process đã dừng dùng lại chứng cứ và
operation cũ. Helper xử lý TERM: gate chưa mở dùng gate-closed receipt; đã release thì giữ observer sống và
forward TERM đến ChildProcess supervisor riêng, kể cả pending startup. Native supervisor block TERM qua
fork/arm kqueue, child phục hồi default handler/mask trước exec; handler chỉ signal PID con dương còn thuộc
observer. Trước waitpid có thể tái sử dụng PID, supervisor block TERM và xóa target. Proof vẫn cần kernel
NOTE_EXIT, wait đúng child, không fork, rồi host wait đúng helper và group empty. Startup thiếu witness,
SIGKILL/restart hoặc bất kỳ fork nào vẫn UNKNOWN; không suy STOP từ group empty.

Retirement là receipt bất biến riêng `process-journal/retirements/<launch-hash>.json`, không xóa LaunchRecord
hay admission intent. `bindPinRetirementAuthority` mặc định chưa cấu hình; bridge bind current scoped 005
read và so exact command/attempt/fence/process/source/companion, state stopped và finalizedAt. Sau native
STOP, `retirePinReference` giữ journal barrier, kiểm lại tuple và fsync exclusive receipt trước khi GC lọc
process ref. Exact replay giữ receipt cũ; mismatch bị từ chối. `processes()` vẫn trả lịch sử, unknown intent
vẫn giữ pin; reserve/spawn/authorize của identity đã retired bị chặn. Registry ref/current/dependency khác
vẫn bảo vệ bytes độc lập. Production final verifier còn chờ phase08; private DB fixture không cấp authority
production. Các class này là producer/consumer API, chưa tự wired vào entrypoint GatewayHost.

Native helper development chỉ compile bằng `/usr/bin/clang` đã có vào cache riêng của fixture/host. Source snapshot riêng và binary SHA-256, device/inode/UID/mode `0700` cùng identity cache được attested; helper thiếu/hỏng thì fail closed, không dùng `ps lstart` có độ phân giải giây làm proof. Phase09 phải đóng gói helper ký sẵn và private Node, không yêu cầu người dùng cuối có compiler. Phase04 cần supervisor/spawn broker hoặc confinement kiểm chứng được toàn cây trước khi cho runtime có fork chuyển sang stopped/cleanup.

## Files

| Đường dẫn | Vai trò |
|---|---|
| `gateway/package.json`, `gateway/pnpm-lock.yaml`, `gateway/tsconfig.json`, `gateway/tsconfig.build.json` | Gói độc lập, phiên bản Node/TypeScript và build |
| `gateway/src/host/status.ts` | `GatewayStatus`, `WorkflowStatus`, `SourcePin`, `ProjectionPin` và trạng thái ban đầu |
| `gateway/src/host/gateway-host.ts`, `gateway/src/host/process-lock.ts`, `gateway/src/host/main.ts` | Vòng đời host, khóa OS theo tiến trình, entrypoint |
| `gateway/src/ipc/server.ts` | RPC và quyền socket |
| `gateway/test/host-lifecycle.test.ts`, `gateway/test/host-failures.test.ts` | Process, crash, quyền socket, LaunchAgent thử nghiệm và hồi quy framing/recovery/deadline/drain |
| `gateway/src/journal/atomic-records.ts`, `gateway/src/journal/http-operations.ts` | Store atomic/version 1, lock theo store, canonical HTTP operation replay |
| `gateway/src/journal/process-journal.ts`, `gateway/src/journal/gated-helper.ts` | Process journal, READY/RELEASE và stopped proof |
| `gateway/src/journal/native.ts`, `gateway/src/journal/native-identity.c` | Build/attest native helper, exact start identity và supervisor fail closed khi fork |
| `gateway/src/resources/registry.ts`, `gateway/src/resources/native-resources.c` | Ownership registry và cleanup qua FD/quarantine/no-follow |
| `gateway/src/telemetry/capacity.ts`, `gateway/src/telemetry/macos-provider.ts` | Sample macOS mới và quyết định capacity |
| `gateway/test/journal.test.ts`, `gateway/test/http-operations.test.ts`, `gateway/test/resources.test.ts`, `gateway/test/telemetry.test.ts` | Crash/replay/identity/ownership/telemetry regression |
| `gateway/test/support/journal-fixture.ts`, `gateway/test/support/owned-run.ts` | Fixture host crash và run có exact stopped proof |
| `gateway/test/support/host.ts`, `gateway/test/support/ui-client.ts` | Fixture RPC, client mới, LaunchAgent thử nghiệm và cleanup |
| `gateway/src/sync/connection.ts`, `gateway/src/sync/event-pump.ts`, `gateway/src/sync/gateway-sync.ts` | Boot/heartbeat, SSE/poll và workflow sync bền vững |
| `gateway/src/commands/contracts.ts`, `gateway/src/commands/http-client.ts` | DTO consumer, authenticated transport và exact mutation replay |
| `gateway/src/execution/ticket-command-bridge.ts` | Fenced claim, companion, reconnect, stop, finalize và terminal receipt |
| `gateway/test/connection.test.ts`, `gateway/test/event-pump.test.ts`, `gateway/test/sync.test.ts` | Lost reply/cursor/partial/superseded sync; prerequisites chỉ cạnh definition BMAD có `render`, không đổi definition, đo lỗi thì bỏ trường |
| `gateway/test/execution-bridge.test.ts`, `gateway/test/execution-bridge-db.test.ts`, `gateway/test/execution-crash.test.ts`, `gateway/test/stop-control.test.ts`, `gateway/test/pin-retirement.test.ts`, `gateway/test/retirement-crash.test.ts` | Actual 005/007, SIGKILL, native TERM và retirement/GC |
| `gateway/test/support/bridge-fixture.ts`, `gateway/test/support/bridge-crash-worker.ts`, `gateway/test/support/pin-retirement-crash-worker.ts` | Private root identity, synthetic audited recipes và owned crash worker |

## Dữ liệu

Pin admission metadata nằm ngoài hashed LaunchRecord store và không đổi producer version1. `workflows/pin-authority.json` cùng durable journal binding chặn writer unbound; admission intent chứa exact command/ticket/process/source/projection/registry root. Unknown intent giữ pair, bytes và lý do riêng tới producer resolution được review; genuine005-finalization release của process records vẫn thuộc Task5.

`GatewayStatus` có `bootId`, `bootGeneration`, `serverConnection`, desired/applied revision, trạng thái source/projection cho BMAD và Superpowers, process đang chạy/chưa chắc chắn, thời điểm telemetry và quyền dịch vụ nền. Lúc này `bootGeneration`, cả hai revision và telemetry là `null`; connection là `unconfigured`, các slot là `missing`. Host không chứa token server, không claim ticket và không gọi model. Token IPC chỉ nằm trong thư mục riêng, không trả cho renderer.

Dependency gateway được ghim `tar-stream@3.1.7` và `@types/tar-stream@3.1.4` trong package/lock riêng. Parser streaming kiểm archive trước publish; producer BMAD riêng chỉ chạy exact installer trong owned staging với frozen dependency/native authority, không nhập dependency global. Hành vi nguồn/projection và retention được mô tả trong flow `gateway-workflows`.

## Flow liên quan

`desktop-shell` kết nối IPC; consumer reconnect/workflow/sync phase03 sẽ gắn các journal/capacity/registry vào host và cung cấp dữ liệu thực cho DTO. Bản build development dùng Node của môi trường v2. Bản app ký, private Node đóng gói và đăng ký dịch vụ nền bền vững qua ServiceManagement thuộc phase09; không tự đăng ký nhãn của owner khi build/test.

## Tests

`pnpm --dir v2/gateway test` build host rồi kiểm tra boot ID giữ nguyên qua UI client exit, boot ID đổi sau restart, socket/token `0600`, client không xác thực bị từ chối, symlink token không được ghi đè, recovery sau crash và residue lock rỗng, contender sống không takeover, frame oversized hai lần không crash, drip frame hết deadline tuyệt đối, SIGTERM và active dispatch drain hữu hạn. Regression macOS giữ fd guard cũ trong lúc release, xác nhận device/inode ổn định, contender không thể lấy khóa trên cùng inode và lần reacquire vẫn dùng inode ấy; crash/reboot host cũng giữ inode. Trên macOS, fixture dùng riêng nhãn `com.2pcrew.v2.test.<uuid>` và `launchctl bootout` chính nhãn đó sau test; non-macOS bỏ qua test launchd với lý do rõ ràng.

Task 2 kiểm tra thêm HTTP lost reply qua socket thật cho claim/checkpoint/reconcile/result/finalize/ACK/install report, restart replay exact key/body/route, command reserve/concurrent writer, hai launcher có barrier không spawn child thứ hai, SIGKILL fixture host tại reserve/spawn/READY/claim request/reply/auth/gate, birth mismatch, capacity block, helper tamper và entrypoint đã build. Resource tests dùng process thật đã stopped để kiểm nested scratch delete/idempotence, symlink/parent swap/hardlink/dirty/reference/unattested/owner checkout giữ bytes, recover quarantine qua restart và abort sau quarantine rồi retry. Regression cho child READY-gated thật thêm/xóa file và subdirectory sau attest, nhận exact stopped proof rồi cleanup/idempotence dù directory link count đổi; fixture `uchg` trên directory riêng sau quarantine gây partial native deletion thật, giữ lỗi/identity qua restart và retry sau khi gỡ flag. Test escaped descendant giữ `PROCESS_TREE_UNKNOWN` qua restart. Telemetry kiểm hai sample độc lập đổi pressure và sample macOS thật. Lệnh focused đúng vị trí flag: `pnpm --dir v2/gateway exec node --test --test-name-pattern='journal|telemetry|resources' test/journal.test.ts test/http-operations.test.ts test/resources.test.ts test/telemetry.test.ts`; full suite vẫn dùng `pnpm --dir v2/gateway test`.

FIX2 kiểm actual reservation cùng GC tại snapshot/quarantine/delete, reserve-first intent trước journal commit, unbound/reopen/bind transition và writer exclusion; SIGKILL tại admission/commit/native quarantine rồi restart xác nhận retained intent hoặc reserve deny, kể cả reclaim quarantine đang delete. `gateway/test/workflow-admission.test.ts` và support `workflow-admission-crash-worker.ts` sở hữu fixture roots; không Launcher/model call hay sửa native stop proof.

Task 5 kiểm thêm ma trận actual PostgreSQL prefix8: selection/decision/report sai hoặc runtime bị tắt không
RELEASE, companion vẫn giữ selection claim sau config update, lost result/finalize với terminal event duy nhất,
production final pending và native pause/cancel/ACK replay. SIGKILL thật tại reserve/spawn/READY/claim/companion/
authorize/release không tạo launch thứ hai; root UNKNOWN được giữ cùng device/inode/UID. Gated/pending-startup/
repeated-TERM/completed helper và fork escaped process vẫn giữ ranh giới STOP. Gateway tsconfig include thêm
đúng hai ambient declaration đã review của server (`platform/thread-stream.d.ts`, `platform/picomatch.d.ts`)
cho actual integration imports; strict và library checking vẫn bật, build config chỉ compile gateway src.

GatewaySync gọi readonly `WorkflowRegistry.verifySource` trước báo source current, kể cả mọi projection null; healthy cache không fetch lại archive, source bị sửa báo error. Prefix8 coexistence test để sync_models queued/result null trong khi workflow cursor tiến và revision mới vẫn applied.

Task6 bổ sung script `pnpm --dir v2/gateway isolation:probe -- --runtime claude|codex --no-model` gọi fixture cách ly có chọn runtime và kiểm API inventory. Không gửi prompt/turn/auth hay gọi model. Kết quả test/CLI không là chứng nhận native Read/Skill/MCP/child; các bề mặt chưa đo vẫn UNVERIFIED và production disabled. Helper thuộc flow `gateway-workflows`; package script thuộc flow này.

Fixture `retirement-crash.test.ts` sau SIGKILL chờ lấy được khóa OS thật ở hai thư mục journal và workflow, rồi release trước khi mở fixture lại. Chỉ retry lỗi đúng `Host guard unavailable (75)`, deadline1500ms/backoff10–100ms; không xóa lockfile, force unlock hay suy STOP từ deadline/PID. Full cover126/127 còn lưu một lỗi timing baseline; whole file sau sửa3/3 PASS, không gộp thành127 PASS. Production ProcessLock/STOP proof giữ nguyên.

### Phase04 runtime companion trước RELEASE

`BridgeOptions.beforeRelease` là callback additive được capture lúc mở bridge; bridge truyền actual
LaunchRecord, current active Attempt, accepted immutable companion007 và fresh scoped Command dưới
clone deep-frozen. Callback hoàn tất sau companion và trước launcher.release hiện hữu. Throw hoặc
non-void result chặn RELEASE; không thay process identity, không thả guard/pin. Runtime consumer ghi
exclusive RuntimePin/input/entrypoint companion và fsync trước trả; launcher vẫn dùng check current
companion/capacity cũ. Callback không được re-enter bridge hoặc journal transaction. Generic bridge
không hook giữ producer protocol cũ; runtime production bắt buộc binding mới, mặc định fail closed.
Chi tiết authority, threat model và chứng cứ chưa đo ở `gateway-runtime`.
