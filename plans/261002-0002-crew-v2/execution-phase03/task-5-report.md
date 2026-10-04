# Task 5 — Offline sync, command ACK và ticket fence bridge

Trạng thái: implementation candidate đã frozen, sẵn sàng independent full review; chưa có independent review/acceptance. Recovery giữ lại phần triển khai và
RED/GREEN của worker trước. Không có semantic review cycle nào bị tiêu thụ bởi lỗi model capacity.
Base reviewed dùng để chọn test: `556cd8d`; Task4 admission authority `ea8ff3b`, Task3 actual007
`202233e..8347bd6`, actual008 `d249a82`. Không dùng migration009 hay unfinished peer tests.

## Kết quả và authority

- `GatewayConnection` giữ boot CAS, heartbeat sequence và body/key qua lost reply/reopen.
- `GatewayEventPump` dùng authenticated SSE/poll; cursor chỉ commit sau reconcile. Workflow sync đọc
  desired trước command, persist machine/command và cursor trước write, retry missing slot bằng backoff
  có trần, report immutable trước POST; partial giữ received/applied cũ, superseded hoàn tất command cũ
  một lần và command mới xử lý revision mới. `sync_models` thuộc consumer riêng.
- `TicketCommandBridge` dùng scoped005 command/attempt reads và reviewed bound journal/registry. READY
  trước claim; exact claim UUID/key/body và immutable companion trước RELEASE. Server-stored decision/
  selection là authority; private fixture authorizer không được wired vào production. Reconnect reset
  page anchor UUID mỗi pass. Reconcile command xác thực scope và có durable received/completed ACK.
- Checkpoint/result/stopped/finalize dùng operation riêng. Finalizing giữ guard. Finalize pending có thể
  được kiểm lại bằng operation mới sau response xác nhận; ambiguous reply vẫn replay key cũ. Terminal
  retirement chỉ sau authenticated current005 stopped+finalizedAt, exact tuple/source/companion và local
  native STOP; fsync immutable receipt dưới journal barrier trước khi lọc ref. Giữ LaunchRecord/admission
  history; deny retired reserve/spawn; unknown intent không TTL. Independent registry ref/current/source
  dependency vẫn bảo vệ bytes.
- Pause/cancel lưu lý do trước signal, kiểm command/payload/type/ticket và owned process, chỉ completed ACK
  sau exact STOP. Retry completed ACK khi process đã dừng không signal lại. Gated helper giữ native observer
  sống qua SIGTERM; native handler chỉ forward đến initial child dương còn owned. TERM block qua fork/arm,
  child reset handler/mask trước exec; block và disarm target trước waitpid để tránh PID reuse. Giữ nguyên
  kernel NOTE_EXIT + wait + noFORK và host wait + groupempty, không sửa proof format hay group layout.

## Rulings và phạm vi

Các ruling binding đầy đủ nằm trong `task-5-brief.md` và `progress.md`:

1. Additive terminal receipt producer: `process-journal.ts`, registry retention filtering; không đổi
   LaunchRecord/LaunchInput/version, AtomicRecords, Launcher, SQL005/007/008 hoặc authority server.
2. PM thêm đúng hai ambient declaration server vào gateway tsconfig include cho actual integration test;
   strict/library checking vẫn bật, không skipLibCheck. Build config chỉ include gateway src.
3. Actual no-fork pause/cancel RED chứng minh signal giết observer là bug local. PM duyệt đúng
   `gated-helper.ts` và `native-identity.c`; không coi no-fork stop là unavailable vĩnh viễn. Fork/missing
   witness/startup ambiguity/SIGKILL vẫn UNKNOWN, phase04 full-tree certification chưa được cấp.
4. Final audit phát hiện current source pointer không kiểm lại cached bytes khi mọi projection null.
   PM đã duyệt readonly `verifySource` wrapper của verifier hiện có và call từ sync. RED current thay vì error → GREEN; healthy cache offline không fetch archive, không đổi format/hash/recipe.

Không sửa package/lock, model implementation, server source/migrations, shared docs manifest/generated index,
Git index/commit, v1 hoặc service chung. Ba R3 flow đã cập nhật: gateway-host, gateway-workflows, server-gateway.
PM serialize manifest/generate/check/stage/commit sau khi nhận frozen inventory; không claim docs gate đã PASS.

## Bằng chứng

Thư mục `task5-evidence/` giữ original worker RED/GREEN, command manifest, frozen hashes và toàn bộ log.

- Cover trước source-cache audit: **106/106 PASS**, 20 explicit test files, 191 giây; gồm đúng 12 reviewed
  gateway files tại556cd8d và 8 Task5 files, `--test-concurrency=1`, PostgreSQL18.6 private prefix8. Không chạy
  bốn peer model tests hoặc server glob/migration009. Log `cover-before-source-verification.log`.
- Actual DB selection/default-deny, old fully-applied report, missing/mismatched decision, client-only
  selection và disabled runtime đều bị chặn trước RELEASE. Claim được phép giữ companion sau config update;
  đổi pair cùng attempt409. Lost result/finalize giữ exact distinct keys và đúng một `attempt.finalized`.
- Actual prefix8 sync_models coexistence: workflow poll đi qua command model mà không ACK; command vẫn queued/result null và workflow revision2 mới vẫn applied. Không đọc/ghi model authority hoặc suy modelApplied từ workflow inventory.
- Native pause/cancel RED: `stop-red.log` (2 fail EXACT_EXIT_PROOF_REQUIRED, fork negative pass); approved
  producer fix GREEN3/3 `stop-green.log`. Completed ACK loss RED PROCESS_UNKNOWN → GREEN3/3
  `stop-ack-green.log`. Genuine escaped-fork identity được ghi trong log, guard và refs vẫn giữ.
- Reconcile command auth/ACK RED missing rejection → GREEN `reconcile-red.log`, `reconcile-green.log`.
- Real SIGKILL reserve/spawn/READY/claim/companion/authorized/released **7/7**; no duplicate launch. Gated,
  pending-startup, repeated-TERM, completed observer boundaries **1/1**; ambiguous startup giữ UNKNOWN.
- Retirement SIGKILL trước write/sau write/sau filter **3/3**; reopen giữ đúng ref/receipt, historical launch,
  deny resurrection và GC chỉ sau authority. Fixture lần đầu đọc ready() của retired launch bị từ chối đúng;
  sửa test đọc receipt.stop, không nới production. Hai root thất bại được thu hồi đúng identity sau xác minh
  immutable retirement + native STOP/noFORK; log `retirement-fixture-cleanup.log`.
- Sync partial source/runtime, lost report/ACK, superseded/new command, only-missing-slot retry; independent
  registry ref vẫn giữ bytes sau retirement rồi GC khi ref cuối được release. Lower-UUID reconnect test PASS.
- `build-final.log`, `types-final.log`: build và strict TypeScript PASS sau cache-source fix.
  `native-compile.log`: `clang -Wall -Wextra -Werror -fsyntax-only` PASS; actual tests cũng build helper với
  `-Wall -Wextra -Werror -O2`. Biome exit0, 32 warnings của any/non-null assertions; không claim warning-free.

Final covering **111/111 PASS, 0 fail/skip**, 205.4 giây sau source-cache fix, 21 explicit files
(12 reviewed + 9 Task5), private PostgreSQL prefix8. `cover-final.log`, `cover-exit.json` (exit0),
`cover-command.json` và `candidate-test-files.json` ghi command/manifest chính xác. Frozen inventory 26 files.
Build/strict typecheck/native compile/diff check PASS. PM chỉnh format-only `types:["node"]` trong tsconfig
sau source freeze; targeted Biome đã PASS và inventory SHA đã cập nhật, không đổi flags/includes.

Final Biome exit0/0 errors, **32 advisory warnings**: 18 `noExplicitAny` chỉ trong fixture tests; 14
`noNonNullAssertion` (10 tests, 3 trong bridge, 1 trong journal callback sau configured guard). Đây là warnings
của partial Task5 đã kế thừa, không gán nhầm là baseline đã commit. `biome-warning-summary.json` ghi từng
file/rule; `biome-final-check.log` ghi line cụ thể. Không tắt rule/strict hoặc dùng skipLibCheck. Non-null assertions
đứng sau reserve/local record, operation initialization, record-presence check hoặc authority configured guard;
không cấp dispatch/finalization bằng type assertion. Chưa claim warning-free; independent reviewer đánh giá
cùng toàn bộ source.

## Resource closeout

`resources-final.json` đối chiếu từng exact Task5 root từ log với device/inode/UID và từng known container ID.
Group-empty/PID absence chỉ là observation, không thay native STOP. UNKNOWN roots giữ bytes/reference và được
liệt kê riêng; không prefix-kill, shared prune, global install, owner service restart, owner Keychain hoặc model
call. Các run ban đầu của worker cũ dùng runner cleanup nhưng chưa log exact container ID; report không bịa
ID cho chúng. Final runner log có ID riêng và đã được xác minh absent sau exit.

Đối chiếu cuối: **128 exact Task5 roots**, 99 hiện absent, 29 UNKNOWN giữ nguyên identity; 6 known container
IDs đều absent. Hai genuine-fork UNKNOWN roots của 2 lượt baseline covering cũng được giữ, danh tính hiện
hành nằm ở `baselineUnknown`. Mọi READY có thể đọc trong 29 root giữ lại hiện group empty/PID absent qua
attested native helper, nhưng vẫn giữ UNKNOWN; spawned-before-READY không có đủ witness để khẳng định
STOP. Hai root lỗi fixture retirement đã dọn có receipt/native proof riêng. Baseline test khác dùng cleanup
finally đã được review; không invent root/container IDs mà log cũ không ghi.

## Frozen inventory và giới hạn

`task5-evidence/frozen-inventory.json` là danh mục byte/mode/SHA của source/test/config/R3 candidate; inventory
cover cũ giữ riêng `frozen-before-source-verification.json`. `candidate-test-files.json` tách reviewed/Task5
và explicit exclusions. PM cần map mọi file mới vào gateway-host flow (các flow liên quan đã cập nhật R3).

Các class là API cho composition Task7, chưa wired vào GatewayHost entrypoint. Production dispatch/selection
vẫn default deny tới phase06, final verifier tới phase08; injected fixture không phải production bypass.
Artifact source/projection có hash không đồng nghĩa runtime discovery/isolation certificate. Native no-fork
STOP không chứng nhận process tree có fork; SIGKILL mất wait, escaped child hoặc pending startup thiếu
witness giữ UNKNOWN và không release guard/refs. Development helper dùng compiler hiện có, signed/private
runtime distribution vẫn thuộc phase09. Chưa force PID reuse bằng hệ điều hành; bảo vệ target được kiểm ở
finished-observer boundary và cần independent review thứ tự mask/disarm-before-wait.

Unresolved: independent full task review (bao gồm native/control/receipt/registry verifier/config); serialized docs manifest
checks/commit do controller sở hữu. Không có yêu cầu owner credential, model call hoặc service restart.
