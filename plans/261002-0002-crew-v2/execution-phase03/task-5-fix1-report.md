# Task 5 — FIX1/5: recovery consumer và chuyển boot có đối chiếu

Candidate sửa một batch đủ F1–F5 của `task-5-review.md`, base `9182e89`. Chưa acceptance; chờ controller commit và independent scoped review. Báo cáo/inventory/evidence Task5 ban đầu giữ nguyên. Không mở thêm semantic fix round cho lỗi fixture hoặc nhánh F5 phát hiện khi tự kiểm.

## Finding và kết quả

| Finding | Thay đổi | Bằng chứng có ý nghĩa |
|---|---|---|
| F1 snapshot desired cũ hoàn tất nhầm command mới | Chỉ SUPERSEDED khi desired revision lớn hơn command. Snapshot thiếu/thấp hơn command được hoãn, không completed. | Focused RED→GREEN với reopen. Actual prefix8 owner update khác maxJobs giữa config GET và command GET; command revision2 được giữ, rồi report/completed đúng một lần. |
| F2 response503 cache vĩnh viễn | Additive `retryTransient` có `http-retries` riêng; Operation format, body/key/first response và `replay()` cũ bất biến. Chỉ500/502/503/504; một send mỗi call, backoff durable1s→60s. Pending attempt ambiguous giữ key/attempt; terminal response settle một lần. | Journal actual AtomicRecords503→lost retry reply→reopen→concurrent recovery→cached success; replay gốc vẫn503. ActualPG chủ động trả503 **sau commit thật** của boot/heartbeat/ACK/report: retry request giống hệt, chỉ một report/heartbeat sequence trong DB. |
| F3 dispatch lỗi làm starvation | Reconcile owned state trước dispatch; catch/persist failure từng record/command, tiếp tục pages; cuối pass trả aggregate errors. Reconcile control chỉ đối chiếu ticket được scoped. | Denied start trước reconcile control ở page sau + reopen: control ACK một lần, không launch denied. ActualPG pause/cancel vẫn hoàn tất qua lost ACK dù start khác bị từ chối; uncertain owned launch được đối chiếu trước. |
| F4 retired history gặp404 sau rebind | `pinRetirement` xác minh immutable receipt trước live scoped read. Chưa có/conflict receipt vẫn lỗi riêng record, giữ refs. | Actual005 finalized+nativeSTOP+retirement rồi project rebind và reopen: scoped old command404 nhưng B hiện hành được ACK. Negative trước retirement: old scope404 vẫn giữ reference, B độc lập tiếp tục. |
| F5 không chuyển durable boot | `advanceBoot` chỉ khi bind actual bridge cùng root. Reconcile/observe trước journal barrier; barrier kiểm exact snapshot/set, pending admission và current scoped tuple+authorization. Immutable history/receipt prior/next/generation trước pending pointer/POST;007 CAS quyết định. | ActualPG running/stopped/retired→boot mới; B lost reply/reopen giữ operation/key; heartbeat reset1; old boot từ chối. Fork UNKNOWN được accounted thành retained-unknown, online boot2 nhưng guard/pin và replacement deny còn nguyên. Orphan admission và current-set race bị từ chối; actual server generation CAS conflict không online giả. |

Self-review F5 bổ sung actual RED `BOOT_RETIRED` cho report đã persist nhưng mất trước send, sau controlled bootB. Consumer replay report/key cũ trước; chỉ response `BOOT_RETIRED` đã xác nhận và tuple boot mới khác mới bỏ pending pointer để pass sau tạo report ID mới từ source/projection được verify lại. HTTP operation/report cũ vẫn bất biến. Committed report cũ được server007 trả receipt trước kiểm boot, còn ambiguous/503 không được đổi key. ActualPG RED→GREEN và final cover chứa regression này.

Advisory sửa docs: workflow backoff cap base60s × jitter0,75–1,25, trần thực75s. Retry HTTP riêng không jitter, cap60s. Không sửa báo cáo frozen ban đầu để xóa lịch sử sai mô tả.

## Authority và lock order

Ruling binding nằm trong `plans/reports/pm-261002-crew-v2-execution.md`:16:02/16:03 full batch; F2 producer extension16:07; F5 refined lifecycle16:11; snapshot16:15 và fixture external module/type resolution16:19/16:22.

F2 chỉ mở ownership `journal/http-operations.ts` và testHTTP hiện hữu. Producer original Operation vẫn version1/immutable first response; retry records là lịch sử bổ sung, không sửa server idempotency semantics. Reply lỗi không chứng minh không có tác động. Mỗi retry dùng transport scoped/authenticated hiện tại và đúng body/key gốc; nontransient response không tự resend. Lịch sử tăng theo các lần retry đã thực hiện, không TTL hoặc xóa receipt. Writer lock riêng serialize recovery; close drain retry store rồi original store.

F5 lock order connection → bridge → journal. Reconcile có thể ghi journal nên chạy trước admission barrier; observe cũng ghi journal, không gọi lại nó bên trong barrier. Dưới barrier chỉ đối chiếu exact snapshot + read scoped005 + lưu receipt/pending connection và boot HTTP. Callback connection nội bộ không mở transaction connection lồng nhau, không lấy registry queue. Không thay AtomicRecords, process-journal, registry, native helpers, Launcher, LaunchRecord/proof schema hoặc SQL005/007/008.

UNKNOWN chỉ được ghi nhận khi exact launch/local authorization/current scoped active hoặc uncertain khớp. Không gọi reconcile STOP, claim, finalize hay retirement cho UNKNOWN; guard005/pin local giữ nguyên và replacement không được RELEASE. Orphan admission, unclaimed launch, sai tuple hoặc set thay đổi phải chặn transition. Receipt retirement đã hợp lệ được skip mà không đòi live scope cũ. Đây là lifecycle receipt phục vụ composition, không chứng nhận runtime/full-tree hoặc final result.

## Validation và phạm vi frozen

Final cover: **121/121 PASS, 0 fail/skip, 230,6 giây**. Chính xác21 test files:12 reviewed gateway files +9 Task5 files, trong đó HTTP test reviewed được thêm regression. Private PostgreSQL18.6 prefix8; không009, không4 peer model tests. File manifest/argv nằm trong `task5-fix1-evidence/cover-command.json`.

- Snapshot frozen `9182e89:v2` cộng đúng13 overlay files (5source,5tests,3R3), đối chiếu byte/mode/SHA ở `frozen-inventory.json`. Không đưa model candidatef687fe3 hay attachment FIX1 vào actual integration imports.
- Snapshot strict build/typecheck PASS; không skipLibCheck/any compiler flag. Native `clang -Wall -Wextra -Werror -fsyntax-only` PASS; native source không đổi. `git diff --check` PASS.
- Targeted Biome10TS files:0errors,33advisories:17 explicit-any đều trong test;16 non-null assertions gồm13 trong test và3 assertion bridge đã có trong candidate9182. Final warning inventory ghi từng vị trí/loại. Không gọi warnings là committed baseline hoặc claim warning-free.
- Focused actualDB14/14PASS trước regression report-transition; regression report-transition1/1PASS riêng. Cover trước nhánh bổ sung120/120PASS,226,5s, giữ riêng `before-report-transition-*`; không lấy union để gọi final cover.
- First actualDB12case run9pass/3fixturefail giữ nguyên: hai assertions gọi observe sau legitimate automatic retirement bị PIN_REFERENCE_RETIRED; sửa test đọc receipt.stop. F1 owner update giống nội dung không sinh revision2; sửa test dùng maxJobs khác. Không nới producer để làm test qua.
- Fixture snapshot compile ban đầu TS2307 thiếu declaration tar-stream được giữ là failed; emitted files lần ấy không được dùng làm buildPASS. PM cho phép riêng loader bare external `tar-stream` qua ordinary existing gateway resolution và temporary tsconfig exact paths tới existing @types/tar-stream3.1.4. Loader/config hashes/argv lưu riêng. Tất cả module khác dùng default resolver; không dependency copy/symlink/install/source fallback hay hook/settings changes. Snapshot compile/typecheck với mapping đã PASS.
- Một cleanup script lỗi relative import trước thực thi, được giữ trong log; sửa đúng đường dẫn rồi cleanup có proof. Không sửa source vì lỗi script.

## Resource reconciliation

FIX1 ghi nhận 127 exact Task5 roots: 106 absent, 21 UNKNOWN giữ identity; thêm 2 baseline fork UNKNOWN từ hai cover. 6 exact private container IDs đều absent. Mọi readable READY còn giữ đã có current attested-helper group/PID observations trong `resources-final.json`; không nâng observation thành STOP. Prior original inventory130 roots (128Task5+2baseline) refresh:99absent,29Task5UNKNOWN+2baselineUNKNOWN giữ đúng identity. Các runner PTY đã reaped; snapshot có 279 file SHA không đổi qua final cover và exact identity cleanup đã absent. Một root snapshot khởi tạo rỗng do Python tar API khác phiên bản được cleanup theo identity trước retry, không orphan archive.

Hai root pause/cancel first-run bị giữ do assertion sai đã được reclaim sau kiểm immutable retirement tuple/nativeSTOP receipt, exact root device/inode/UID, current attested helper groupempty và PID absent. Group/PID observations không tự tạo STOP; receipt đã có là căn cứ. Script+logs `cleanup-retired.mjs`, `retired-cleanup.log`. Fork/orphan/crash UNKNOWN giữ nguyên, không TTL/prune/pattern kill. Original Task5 unknown roots và evidence không bị xóa hay ghi đè.

Snapshot readonly archive có nonce/root/device/inode/UID, member path/type validation; frozen source SHA đối chiếu trước/sau test. Snapshot chỉ cleanup khi own runners/containers đã settle; fixture loader/config evidence được giữ cho review. Không restart shared service, gọi model, owner credential/Keychain hoặc global install.

## Files và handoff

`task5-fix1-evidence/frozen-inventory.json` liệt kê13 file sửa; không thêm source/test path cần manifest mới. R3 cập nhật gateway-host, gateway-workflows, server-gateway; giữ7 canonical headings. `unchanged-candidate-files.json` kiểm phần candidate gốc ngoài diff vẫn SHA cũ. Evidence/report inventory được freeze riêng, không overwrite inventory Task5 ban đầu.

Unresolved: independent scoped SPEC/QUALITY review cả F1–F5 và mọi diff FIX1, controller serialized docs checks/commit. APIs chưa wired vào Task7 host entrypoint. Production dispatch/final verifier, full-tree/runtime/source isolation/signed distribution gates vẫn như report gốc; không dùng fixture authorizer hay hash để cấp runtime certification.
