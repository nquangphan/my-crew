# Re-review độc lập Task05/1 — FIX1/5

**SPEC: READY. QUALITY: READY.** Hai finding F1/F2 của review đầu đã được xử lý. Không tìm thấy finding mới trong toàn bộ diff ba file của FIX1. Không cần semantic fix wave2 cho scope này. PM giữ quyền nghiệm thu Task1; verdict không chứng nhận public API, runtime, extraction isolation hoặc recovery Task7.

Candidate `ec02ac03a7f2bfcc24e6928f38a62e0ea3821cff`; baseline Task1 `f58f27dc96b964d034697a67c5677fb1d3bbacb2`. Scope review là `task-1-fix1-pm.diff`: staging, staging tests và flow server-attachments. Không đưa các commit model/gateway nằm giữa hai SHA vào verdict; không mở lại full schema audit đã hoàn tất trong `task-1-review.md`.

## Original findings và diff mới

| Finding | Kết luận | Bằng chứng source và regression |
|---|---|---|
| F1: ready PUT replay bỏ qua accepted max wall | **Đã đóng** | `verifyReadyReplay` nhận `row.accepted_config.uploadMaxWallMs`, dùng deadline monotonic `performance.now()`, bounded next/verify/cleanup và kiểm caller abort/deadline trước success. Regression thay current factory wall thành5000ms trong khi upload đã reserve100ms vẫn timeout theo100ms; replay đúng trong hạn vẫn ready. |
| F2: EOF prefix1 byte control bỏ kiểm binary-text | **Đã đóng** | `validateDecodedText` chạy cho streaming decode, EOF prefix và fatal flush. Actual PG regression từ chối29 control thấp ngoài tab/LF/CR, kiểm original missing, receiver closed và quota chưa release; EOF UTF8 C3/UTF16 FFFE01 bị reject. Empty/ASCII/tab/LF/CR và split UTF16 hợp lệ còn pass. |

Đã đọc hết helper replay mới và toàn bộ343 dòng test thêm, không chỉ diff chỗ hai lỗi cũ. Helper giữ full-body count/SHA và original verification, không đổi original storage/receiver generation/quota/event. Timeout/caller abort có code409 riêng. Late value không trở thành success nhờ kiểm active sau next và trước trả kết quả; verify và iterator cleanup cũng nằm trong deadline.

Điểm quan trọng của F1 là request result và teardown có trạng thái riêng: WeakMap keyed by Db chứa upload operation; exact operation có cleanup promise, current pending next/verify và return được quan sát rejection. Timeout không xóa ownership ngay. `Promise.allSettled([closing,current])` đợi actual pending work và iterator closure; chỉ `done === true` với matching operation mới xóa registry. Return thiếu khi chưa exhausted, return thất bại hoặc không done giữ unknown/BUSY. Timer/listener của request được dọn. Code không gọi receiver ACK, suy STOP từ TTL hoặc giải phóng quota trên nhánh replay này.

Actual PG regression chứng minh timeout→BUSY ở factory mới dùng cùng Db→producer được release/finally thật→retry ready; cả stalled next lẫn delayed verify được giữ tracked. Caller-abort/rejected pending next và pre-aborted signal không để read mới được nhận như success. Nhánh return thất bại/unknown được xác nhận qua source fail-closed; không mô tả nó là một native regression riêng khi logs không có case riêng đó.

Registry này chỉ chia sẻ trong cùng process/module và cùng Db object. Nó không là distributed receiver registry và không chứng minh cleanup qua process restart. Đây là giới hạn đã nêu trong ruling15:39 và report, phù hợp scope ready replay chỉ đọc bytes. Các writer/recovery gates cũ tiếp tục áp dụng; không dùng PID absent/kernel observation thay cho actual STOP/teardown evidence.

## Tính nguyên vẹn candidate và evidence

Đã đọc original review, FIX1 report/source inventory/evidence/cleanup/freeze, PM rulings15:33/15:39/15:57/16:02/16:24, exact source/test/docs diff và captured logs liên quan. Đã kiểm hash thực tế:

- Cả16 source/test/flow trong FIX1 inventory khớp bytes tại candidate và live worktree. Own3 thay đổi; other13 giữ baseline. Staging SHA `8472c49eb19ae9acf679718f079aacdbe256f1ace82bae656461692c162de7ee`; test `2375711bff9f89dc0e69f03f5ca58f587b18481a8b3a78bb7b2855c41ef85493`; flow `d1aeaa17a4a272cb80f425fbcde9cde1f8c5eee46e5e08587c3b70a783d0a460`.
- Các artifacts trong freeze và từng captured run log khớp SHA. Original Task1 report/inventory/evidence/cleanup không bị sửa. Migration008/009 vẫn đúng checksum pinned `d268ddab…55f8f` / `fe0f888d…75a2a`.
- Đã so **từng entry** của snapshot231-file inventory với Git:227 baseline files khớp f58,3 overlays khớp ec02ac0,1 wrapper khớp saved wrapper SHA. Exact27 test imports; không import unfinished peer tests/source. Không lấy full tree của ec02ac0 làm tested attachment baseline.
- Flow R3 mô tả đúng accepted policy, bounded result, tracked teardown, EOF validator và phạm vi evidence. PM ledger ghi nested/staged/root/canonical docs gates đã pass; reviewer không rerun docs hay sửa manifest.

## Captured tests và native transport

| Evidence | Kết quả giữ nguyên |
|---|---|
| `logs/fix1-red-bounded.log` |2 tests/2 fail, đúng missing timeout và accepted control01; không phải assertion do fixture sai. |
| `logs/fix1-focused.log` |Actual private PG5/5 PASS cho cả hai findings và replay lifecycle. |
| `logs/fix1-native.log` |Actual Linux/private PG FIX1 probe1/1 PASS: timeout/BUSY/actual closure/retry; reject01/C3/FFFE01 có exact closed ACK; positives empty/ASCII/tabLFCR/splitUTF16. |
| `logs/fix1-server-cover.log` |**258 total,255 pass,1 fail,2 platform skips**. Cả5 FIX1 cases, backup/restore/drift và bounded HTTP whole case pass. Failure là ERR_MODULE_NOT_FOUND postgres ở native snapshot-only mount. |
| `logs/fix1-isolated-native-green.log` |Sau approved test-only launcher correction, **whole failed native case1/1 PASS riêng**, gồm exact ACK replay và actual inflight abort/held quota. |
| Typecheck/Biome |Final source và isolated snapshot strict types exit0; scoped Biome2 files sạch, không sửa thêm. |

Đã đọc launcher đã lưu và actual original/transformed argv. Corrected matcher canonicalize trailing slash của exact snapshot volume, kiểm marker nonce, snapshot under root, immutable Nodeimage, private PG64hex namespace, readonly/capdrop/CPU/memory/pids/tmpfs. Transform chỉ đổi mount readonly full checkout và working directory vào chính frozen snapshot; relative source imports vẫn chọn snapshot. Đây là ordinary ancestor dependency resolution cho test. Không sửa support source, copy dependency hoặc tạo symlink/install. Broader test mount không cấp production extraction-isolation certificate. Initial matcher failure còn được giữ, không ghi đè thành pass.

Full cover vẫn là **FAIL258/255/1/2**; focused native1/1 được ghi riêng. Không tuyên bố258PASS bằng phép hợp. Captured evidence đủ để phân loại failure là fixture dependency transport và đóng original findings; không có lý do mới để broad rerun trong scoped review này.

## Cleanup và giới hạn còn lại

Đã đọc cleanup receipt:7 exact native/PG ID absence inspections,32 scratch roots có logged remove hoặc interrupted-fixture exact nonce/dev/ino cleanup; snapshot231 hashes stable và children closed trước exact root removal; launcher own root có identity/removal receipt, immutable image cache giữ lại. Đây là captured cleanup evidence với tập ID được kê rõ, không phải reviewer vừa kiểm live toàn hệ thống hoặc chứng nhận mọi historical runner bằng global delta. Runner không có external ID receipt tiếp tục giữ giới hạn đã nêu trong report.

Reviewer chỉ chạy read-only Git/hash/evidence checks; không rerun suite, không cần narrow behavioral proof mới, không tạo DB/container/socket/child fixture/scratch hay thay source/Git/package/shared service. Chỉ tạo báo cáo này.

Các gate Task2/3/6/7 trong original review vẫn mở đúng ownership: atomic submit/access/active HTTP list/current grant/snapshot/receipt/consumer claim-reply/runtime bridge, true multi-process kill→recover và extraction isolation. Chúng không phải finding mới của FIX1. Không còn finding hoặc câu hỏi chưa giải quyết trong scope re-review này.
