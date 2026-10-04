# Task 5 — Review độc lập SPEC + QUALITY

Ngày: 2026-10-02. Candidate **9182e89**, base **556cd8d**. Candidate chưa được nghiệm thu.

**SPEC: NOT READY. QUALITY: NOT READY.** Có **5 finding P2** xác nhận ở consumer/recovery, liệt kê đầy đủ bên dưới. Không phát hiện P1 mới trong phạm vi producer native/retirement được duyệt. Đây là một batch initial full review; không phải acceptance và không phải một vòng fix bổ sung.

## Candidate và phạm vi đã đối chiếu

- Đọc spec đã duyệt, phase03 plan/Task5 và frozen contracts, `task-5-brief.md`, progress/rulings, toàn bộ `task-5-report.md`, v2 index và các flow `gateway-host`, `gateway-workflows`, `server-gateway`; đối chiếu thêm flow execution/journal để kiểm đúng producer 005.
- Review toàn bộ source mới trong commands/sync/execution, toàn bộ test/support mới Task5, diff producer `process-journal.ts`, `gated-helper.ts`, `native-identity.c`, `registry.ts`, tsconfig và ba flow R3. Manifest/generated file map chứa đủ source/test mới.
- PM cung cấp binding commit `9182e89` và task-only diff `556cd8d..9182e89`. Reviewer không chạy Git theo phạm vi read-only được giao. Tự tính lại bytes/mode/SHA của **26/26 frozen rows**, bytes/SHA của **53/53 evidence rows**: **khớp toàn bộ**, không lấy source unfinished của model/attachment peer làm candidate.
- `task5-evidence/pm-task5-production.diff`: **56,230 bytes**, SHA-256 `8b91addd787e091250900ce3f41c70e139cc223726f64518792ea888cefc3ab0`. Candidate 28 task files gồm hai file map/generated do PM tích hợp; inventory 26 của worker không tự nhận hai file ấy là worker ownership.
- Không sửa implementation, server authority, SQL001–009, proof ABI, Launcher hoặc shared files. Chỉ tạo báo cáo review này.

## Findings phải sửa

### F1 — P2: Snapshot desired cũ có thể hoàn tất nhầm command revision mới

**Vị trí:** `v2/gateway/src/sync/gateway-sync.ts:71`, `:106`, đặc biệt **`:141–143`**.

`reconcile()` đọc config trước rồi đọc command bằng request khác. Owner có thể commit revision 2 giữa hai request: local snapshot vẫn revision 1 nhưng page đã chứa command revision 2. Điều kiện `config.revision !== command.payload.configRevision` coi mọi khác biệt là SUPERSEDED, ACK completed bất biến cho chính command mới. Pass sau đọc đúng revision 2 vẫn bỏ qua local `done`; command đã completed cũng không tự sinh lại. Desired mới không được cài/báo applied dù reconnect tiếp tục thành công.

**Proof:** canary dùng `GatewaySync` + `HttpOperationJournal`/AtomicRecords thật, read fixture trả config 1 và command 2. Sau pass đầu đổi fixture config thành 2 rồi chạy pass thứ hai. Kết quả:

```json
{"completion":{"phase":"completed","result":{"code":"SUPERSEDED","ok":false}},"installCalls":0,"writes":2}
```

Server thực cũng dùng hai read transaction riêng (`server/src/gateway/routes.ts:100–105`, `:127–136`), nên interleaving này hợp lệ; không cần malformed response. Test superseded hiện có chỉ đổi config khi report revision cũ đã gửi, chưa phủ cửa sổ config-read → command-read.

**Yêu cầu sửa/regression:** chỉ supersede khi có config hiện hành chứng minh revision command đã cũ. Khi page đi trước snapshot, refresh hoặc hoãn, giữ cùng command chưa completed. Test barrier owner update giữa hai GET; revision mới phải được cài/report/completed đúng một lần và command cũ vẫn giữ kết quả bất biến.

### F2 — P2: HTTP lỗi tạm thời trở thành lỗi vĩnh viễn trong operation đã cache

**Vị trí mới:** **`v2/gateway/src/commands/http-client.ts:16–19`**; caller cố định operation ở `sync/connection.ts:39–45`, `:69–79`, `sync/gateway-sync.ts:126–132`, `:210–220` và các mutation bridge.

`mutate()` kiểm status sau `HttpOperationJournal.replay()`. Producer đã review ghi mọi response bất biến trước khi trả, và lần replay tiếp theo trả local response mà không gọi transport (`journal/http-operations.ts:102–111`). Vì consumer luôn dùng operation ID cũ và không có đường retry một response lỗi đã xác nhận, một response JSON 503/500 tạm thời khi boot, heartbeat, ACK, report hoặc claim khiến operation hỏng vĩnh viễn, kể cả server đã khỏe và host reopen. Đây khác với lost reply: lost reply ném lỗi trước khi recordResponse nên các test hiện có vẫn xanh.

**Proof:** canary connection dùng transport lần đầu trả 503 `TEMPORARY_UNAVAILABLE`; đổi transport sang 200, đóng/mở connection, gọi `boot()` lại. Cả hai lần đều lỗi; **transportCalls vẫn 1**. Không có request mới tới server đã hồi phục.

**Yêu cầu sửa/regression:** thiết kế phân loại lỗi và recovery ở consumer/transport tương thích immutable journal; giữ history, không đổi body dưới key cũ, không mở khóa dispatch/finalization. Reply ambiguous phải replay đúng key/body; một HTTP lỗi đã xác nhận cần đường phục hồi hữu hạn có căn cứ, không bị kẹt ở cache. Phủ ít nhất boot/heartbeat và ACK/report với 503 → healthy qua reopen, cùng lost reply regression để chứng minh không tạo mutation trùng. Nếu cần sửa producer frozen, xin PM ruling cụ thể trước, không tự đổi hợp đồng journal.

### F3 — P2: Một command bị chặn làm ngừng toàn bộ reconnect và reconciliation khác

**Vị trí:** **`v2/gateway/src/execution/ticket-command-bridge.ts:269–281`**, nhất là `:276`.

Vòng poll gọi `await handle(command)` nối tiếp nhưng không cô lập lỗi theo command; `reconcileOwned()` chỉ chạy sau toàn bộ page. Một start đầu hàng bị `DISPATCH_NOT_CONFIGURED`, stale selection, `CAPACITY_BLOCKED` hoặc `PROCESS_UNKNOWN` sẽ ném lỗi ở mọi pass. Server tiếp tục trả command queued/received ấy theo created order, nên pause/cancel/reconcile ở phía sau và đối chiếu các launch khác không bao giờ được thực hiện. Giữ guard cho attempt không rõ là đúng; làm starvation các attempt độc lập là lỗi.

**Proof:** canary dùng bridge thật, hai command scoped `[start không có permit, reconcile]`, real HTTP journal. Hai lần `reconnect()` đều trả `DISPATCH_NOT_CONFIGURED`, **controlAckCount=0**. Không reserve hoặc spawn workflow. Query thực chỉ trả queued/received theo `(created_at,id)` (`server/src/execution/commands.ts:203`), nên lỗi không tự biến mất ở pass sau.

**Yêu cầu sửa/regression:** reconcile durable owned state trước/độc lập với new dispatch; ghi lỗi/chờ riêng từng command, xử lý tiếp command độc lập nhưng vẫn fail closed cho attempt lỗi. Test có start A bị từ chối/UNKNOWN và pause/cancel B hợp lệ trong cùng page, cùng một launch C cần reconcile; B/C phải tiến triển, A không RELEASE/thả guard hoặc bị ACK thành công giả. Phủ nhiều page và reopen.

### F4 — P2: Lịch sử đã retirement bị scoped 404 sau rebind, chặn reconciliation mãi

**Vị trí:** **`v2/gateway/src/execution/ticket-command-bridge.ts:283–289`**.

`reconcileOwned()` gọi `current(local)` trước khi kiểm `journal.pinRetirement(record)`. LaunchRecord/BridgeRecord lịch sử được giữ đúng ruling. Sau một attempt đã genuine finalized + local STOP + durable retirement, owner được phép đổi checkout/binding. Scoped005 read của command/attempt cũ khi đó trả 404 theo contract. Mọi reconnect vẫn đọc lại history ấy, ném trước nhánh skip retirement, ngăn các record sau tiến triển. Giữ immutable history khiến lỗi không tự hết.

**Proof:** consumer canary chèn một BridgeRecord lịch sử trong root riêng, port journal mô phỏng **receipt retirement đã có**, transport trả scoped-not-found. `reconnect()` lỗi `COMMAND_NOT_FOUND_CURRENT_BINDING`; **retirementLookups=0**. Đây là kiểm thứ tự consumer, không phải bằng chứng OS STOP hay tạo authority retirement mới. Hành vi server thật được xác nhận trong current-scope query `server/src/execution/commands.ts:125–129` và frozen read contract: binding revision khác trả 404.

**Yêu cầu sửa/regression:** cho phép history đã có immutable receipt hợp lệ được skip trước các live scoped read; receipt chưa có/identity xung đột vẫn phải giữ reference và yêu cầu current auth. Không nới ACL/không xóa history. Actual prefix8 regression: complete + retire A, rebind project, reconnect có B hiện hành; A được bỏ qua an toàn và B được reconcile; A chưa retirement thì vẫn fail closed riêng A.

### F5 — P2: Không có đường chuyển durable connection sang boot mới sau host restart

**Vị trí:** **`v2/gateway/src/sync/connection.ts:25–45`**.

Sau khi `current` tồn tại, boot ID khác luôn bị `BOOT_RECONCILIATION_REQUIRED`. API còn lại chỉ heartbeat/close, không có transition để ghi boot mới và previousGeneration sau khi caller đã reconcile. `previousGeneration` chỉ được dùng lúc tạo record lần đầu. Caller dùng `boot()` không truyền ID thì nhận lại boot cũ từ local HTTP cache vô hạn; caller truyền fresh host boot của Task1 thì luôn bị chặn. Vì vậy Task7 không thể compose fresh host boot → generation tiếp theo trên cùng durable root bằng API hiện có. Đây là thiếu producer lifecycle, không phải yêu cầu tự wire GatewayHost entrypoint trong Task5.

**Proof:** boot A/gen1 thành công, đóng/mở connection cùng root, `boot(B,'1')` trả `BOOT_RECONCILIATION_REQUIRED`; `boot()` tiếp theo vẫn trả A/gen1. Canary không giả định rằng việc chờ là reconciliation. Source inspection xác nhận không có API ghi chuyển `current` sau bước đối chiếu của caller.

**Yêu cầu sửa/regression:** bổ sung đường chuyển boot được kiểm soát sau reconciliation thật; pending boot handshake/lost reply vẫn giữ đúng body/key, không xóa journal/pin/operation history. Test A→host restart→reconcile→B/gen2, B mất reply/reopen, heartbeat sequence bắt đầu theo boot B, stale A không chiếm lại boot và historical receipt vẫn replay bất biến. Tích hợp current boot retirement/report retry theo cùng authority.

## Rulings, điểm đã đạt và phần không phải blocker mới

| Hạng mục | Kết luận review |
|---|---|
| Fresh selection và RELEASE | Scoped command/attempt reads, exact source domain pin, durable READY trước claim, companion theo selection và fresh active read trước RELEASE có mặt. Default permit deny giữ nguyên; actual private DB test dùng stored command/decision/current report checks, không biến fixture thành production authority. |
| HTTP reply-loss | Claim/companion/result/stop/finalize/ACK có operation riêng, canonical body/key được persist. `finalizeOp` mới chỉ sau response xác nhận; result/finalize khác key. F2 là response lỗi có status, không phủ nhận các lost-reply test đã đạt. |
| Finalizing và guard | STOP không tự chứng nhận artifact; production verifier vẫn chờ phase08. Captured actual DB evidence giữ guard khi finalizing và chỉ có một finalized event khi fixture verifier chấp nhận. |
| Native TERM | Handler chỉ đọc `sig_atomic_t`, save/restore errno và `kill(child>0,SIGTERM)`; block TERM qua fork/arm, child reset handler/mask trước exec. Reap block TERM/disarm target **trước** waitpid; không thấy đường signal PID đã reap trong handler mới. Helper nhớ pending TERM, giữ observer sau release, không gửi tới ChildProcess đã exit/signal. |
| Native proof boundary | Thành công vẫn cần NOTE_EXIT + exact wait + noFORK receipt, helper wait + groupempty; fork/escaped/missing witness/SIGKILL/startup thiếu witness vẫn UNKNOWN. Completed-observer test không phải ép OS PID reuse; báo cáo worker đã nêu giới hạn này đúng. |
| Retirement và GC | Additive receipt giữ exact source/projection/attempt/fence/process/command, authenticated current stopped/finalizedAt và native STOP; journal barrier + exclusive fsync trước filter. Registry→journal lock order giữ nguyên, callback bridge không lấy registry queue. History/intents không xóa, retired reserve/exact chặn resurrection; other refs/current/dependencies vẫn giữ bytes. F4 là tiêu thụ history sau receipt, không phải premature GC. |
| Registry verifier | Readonly `verifySource` gọi verifier byte/manifest/tree hiện có; null projection không bỏ qua source check. Cached source lành không buộc fetch. Không đổi recipe/hash/format. |
| 008 coexistence | Workflow consumer bỏ qua sync_models và cursor tiếp tục; actual prefix8 test chứng minh model command còn queued/result null trong khi workflow revision2 applied. Không cấp modelApplied bằng generic ACK. |
| Typecheck/config/docs | Strict bật, không skipLibCheck; đúng hai reviewed ambient declarations server; build chỉ include own src. R3 đã bổ sung ba flow; manifest/generated map có file mới. Các tuyên bố recovery trong docs cần cập nhật cùng fix F1–F5. |

Advisory: backoff đang cap base ở 60 giây rồi nhân jitter 0.75–1.25 (`gateway-sync.ts:233–235`), nên trần thực là **75 giây**, khác câu “tối đa 60 giây” trong report/docs. Plan chỉ yêu cầu bounded backoff; đây là sai lệch mô tả nhỏ, không thêm P2 hay yêu cầu một fix wave riêng.

32 Biome warnings được phân loại đúng: 18 any trong tests; 14 non-null gồm 10 tests và 4 production (3 bridge, 1 journal configured callback). Chúng thuộc candidate, không gọi là baseline; không có bằng chứng riêng để nâng thành blocker chỉ vì dùng assertion. F1–F5 dựa trên hành vi thực.

## Validation và giới hạn bằng chứng

- Hash-verified captured final covering: **111/111, 0 fail/skip**, 21 explicit files (12 reviewed + 9 Task5), 205.4 giây, private PostgreSQL prefix8; build/strict types PASS trong captured logs. Đây là proof của candidate trước review, **không phải reviewer tự chạy lại 111 tests**.
- Đọc whole new test/support và captured matrix: seven SIGKILL launch boundaries, three retirement windows, no-fork pause/cancel, fork negative, reply loss, source verification/healthy cache, actual 008 coexistence. Các regression F1–F5 hiện thiếu; 111 PASS không bao phủ chúng.
- Reviewer chạy đúng canary nhỏ bằng Node **v24.14.0**, real AtomicRecords/HTTP journals và fixture transport/ports, exit0. Không dùng owner token, actual server/network, DB/container, native workflow child hoặc model. F4 là consumer-order canary với fixture receipt, được phân biệt rõ với actual DB/OS proof.
- Reviewer chạy `/usr/bin/clang -Wall -Wextra -Werror -fsyntax-only v2/gateway/src/journal/native-identity.c`: **exit0**, không tạo binary output. Không chạy broad suite.
- Signed helper/private Node distribution, full-tree process authority, source isolation, native Read/Skill/MCP/child runtime invoke vẫn **UNVERIFIED** theo phase04/09; không coi đây là finding ngoài approved Task5 scope. Source hash không phải runtime certificate.
- Captured resource inventory có 128 Task5 roots: 99 absent, 29 UNKNOWN giữ identity; hai baseline fork UNKNOWN riêng; sáu known container IDs absent. Reviewer hash-verified inventory; **không tự refresh toàn bộ runtime resource inventory**, không suy PID absence/groupempty là STOP.

## Cleanup của reviewer

Canary tạo đúng root `/private/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-task5-review-ObJJN0`, nonce `524a2380-dba7-436e-9b00-9c42b1a30fb6`, runner PID `37505`, device `16777229`, inode `63648633`, UID `501`. Chỉ có các lock-holder helper của AtomicRecords; mọi store đã close và chờ release helper trước cleanup. Không tạo LaunchRecord process thật, workflow child, launchd label hoặc container. Recheck exact device/inode/UID trước khi xóa own root, sau đó kiểm root **absent**. Không chạm 29+2 UNKNOWN roots hoặc tài nguyên của worker/owner.

## Handoff

Trả cả năm finding cho cùng một scoped fix wave. Giữ approved producer/ABI/server gates; nếu giải pháp F2/F5 cần mở rộng producer ownership thì PM quyết định rõ trước sửa. Sau batch cuối, thêm focused regressions tương ứng, cover đúng candidate manifest và cập nhật R3/evidence; independent scoped re-review cả năm finding và mọi diff phát sinh. Không cần owner secrets, model call hoặc restart service chung.

Unresolved: **F1–F5**; Task5 chưa READY. Không có câu hỏi sản phẩm cần owner trả lời để xác nhận các lỗi đã nêu.
