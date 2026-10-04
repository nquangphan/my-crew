# Task 5 — Scoped re-review FIX1/5

Ngày: 2026-10-02. Base **9182e89**, candidate **7c7c719**.

**SPEC: READY. QUALITY: READY.** F1–F5 **đã xử lý**, không còn finding P1/P2 mở trong phạm vi FIX1 và không phát hiện blocker mới từ các thay đổi được review. Kết luận chỉ áp dụng Task5 candidate này cùng các ruling đã duyệt; không phải acceptance toàn phase03 hay chứng nhận runtime.

## Binding và phạm vi

- Đã đọc toàn bộ original `task-5-review.md`, `task-5-fix1-report.md`, ruling F2/F5 trong `plans/reports/pm-261002-crew-v2-execution.md` (16:07, 16:11), snapshot/dependency-resolution rulings và amendment report qua chuyển boot ở checkpoint16:41.
- Review toàn bộ **13 file diff**: 5 production, 5 tests, 3 flow R3; bao gồm toàn bộ HTTP retry producer mới, boot lifecycle, consumer recovery và test actual prefix8. Đối chiếu với baseline/producer contracts đã đọc trong initial review. Không mở lại native STOP producer ngoài phạm vi; native/process-journal/registry/Launcher/proof ABI không đổi.
- PM cung cấp exact task-only patch `9182e89..7c7c719`: **64,263 bytes**, SHA-256 **`151c65030f66cc5347b45386255813a98fb4a67dff1148308105415182154e65`**; reviewer tự hash và đối chiếu. Patch chỉ có đúng 13 path trong frozen inventory.
- Tự kiểm bytes/mode/SHA **13/13 source/test/docs rows** và bytes/SHA **65/65 evidence rows**: tất cả khớp. Kiểm thêm **15/15 unchanged original candidate files** với SHA inventory gốc: tất cả khớp. Patch PM thêm sau freeze được kiểm riêng, không gọi nó là một trong 65 evidence rows.
- Reviewer không dùng Git hoặc source của peer làm candidate. PM thông báo HEAD sau candidate chỉ thêm tài liệu PM; review binding vẫn là `7c7c719` và 13 frozen byte sets, không phải nhận xét toàn working tree hiện hành.

## Disposition từng finding

| Finding | Kết luận và căn cứ |
|---|---|
| **F1 — stale desired/new command** | **ADDRESSED.** `gateway-sync.ts:142–148` kiểm requested revision hợp lệ, hoãn snapshot thiếu/thấp hơn, chỉ SUPERSEDED khi snapshot cao hơn. Regression unit đóng/mở journal rồi apply revision2 một lần; actual prefix8 đặt owner update khác nội dung giữa hai GET, xác nhận command mới chưa completed ở pass cũ và đúng một report revision2 sau reconnect. |
| **F2 — cached transient response** | **ADDRESSED theo ruling16:07.** `http-client.ts:17` dùng additive `retryTransient`; `http-operations.ts:140–185` có retry store riêng, allowlist500/502/503/504, durable backoff và pending attempt. Original Operation/version/body/key/first response và `replay()` không đổi. Actual AtomicRecords regression503→ambiguous retry→reopen→hai recovery calls đồng thời trả cùng settled response, original replay vẫn503. ActualPG test trả503 **sau commit thật** của boot/heartbeat/received ACK/report/completed ACK, resend chính xác request/key/body, DB chỉ một report và sequence1. |
| **F3 — starvation** | **ADDRESSED.** `ticket-command-bridge.ts:284–338` reconcile owned state trước poll, catch/record riêng rồi tiếp tục command/page và trả aggregate cuối pass. Scoped reconcile control chỉ đối chiếu ticket của chính nó. Regression denied start ở page trước vẫn cho control page sau ACK một lần qua reopen. Actual pause/cancel test có start ticket khác bị từ chối và owned attempt uncertain; control hoàn tất qua mất ACK, denied command vẫn queued, không thêm launch. |
| **F4 — retired history scoped404** | **ADDRESSED.** `ticket-command-bridge.ts:320–324` lấy exact journal record, xác minh immutable retirement rồi skip trước `current()` read. Actual005 finalized + nativeSTOP + receipt → rebind/reopen: old scoped command404 nhưng control hiện hành hoàn tất. Negative chưa retirement giữ ref và lỗi riêng history, control độc lập vẫn tiến triển. Không xóa history hoặc nới server ACL. |
| **F5 — controlled next boot** | **ADDRESSED theo ruling16:11.** `connection.ts:68–116` bổ sung `advanceBoot` default-deny khi chưa bind bridge, prior-generation/next-boot history và durable pending transition trước POST; server007 CAS cấp generation. `ticket-command-bridge.ts:342–414` dùng bridge mutex và existing admission barrier, đối chiếu set/snapshot/current scoped tuple/authorization, không callback mutate journal bên trong barrier. ActualPG phủ running, stopped/finalizing, retired qua rebind, accounted fork UNKNOWN, orphan admission, set race, CAS conflict và lost B reply/reopen; heartbeat B bắt đầu1, guard/pins UNKNOWN còn nguyên và replacement claim bị chặn. |

**Amendment F5 pending old report: ADDRESSED.** `gateway-sync.ts:225–234` chỉ bỏ pending pointer khi operation đã trả `BOOT_RETIRED` và consumer đã được compose với boot tuple khác. Pass kế tiếp verify lại nguồn/projection rồi tạo observation/report ID mới. Report/HTTP operation cũ vẫn tồn tại bất biến; reply ambiguous/503 không vào nhánh này. Actual prefix8 regression report mất **trước send** → advance boot → replay old key nhận409 → new report dưới boot mới; old request hai lần giống nhau, old original response409 còn đọc được, command completed thành công. Server007 committed-report replay trước current-boot check được giữ nguyên, nên không đánh đồng lost committed response với rejected uncommitted observation.

Advisory75s trong initial review đã được sửa đúng ở docs; original frozen report không bị viết lại. Workflow jitter cap thực75s, HTTP retry riêng cap60s.

## Review hợp đồng và điểm dễ sai

### HTTP retry producer

- Writer lock riêng serialize các recovery calls; `close()` drain retry store trước original store. `open()` giải phóng original lock nếu retry store không mở được. Không thêm writer không có lock hoặc đổi AtomicRecords.
- Retry đọc exact original route/method/phase/canonical body/key, so operation ID/key/bodyHash với history, fsync pending trước send. Nếu transport throw hoặc crash trước ghi reply, attempt cuối còn pending và resend cùng key; không phát sinh mutation key mới dựa vào giả định lỗi HTTP chưa commit.
- Mỗi lần gọi tối đa một send. `retryAt` ghi bền vững trước send; backoff trả confirmed response gần nhất, không trả thành công giả cho pending attempt. Nontransient response cuối settle và được dùng lại, không có hidden retry loop.
- Original first response không bị overwrite để làm test xanh. History bổ sung giữ các confirmed retry responses và một pending tail; không TTL/prune. Actual after-commit503 test là bằng chứng quan trọng hơn giả lập “503 nghĩa là chưa chạy”.

### Boot lifecycle và retained UNKNOWN

- Fixed lock order **connection → bridge → journal**. Observe/reconcile có ghi journal chạy trước barrier; trong barrier chỉ recheck records/admissions, live scoped read và callback ghi connection đang giữ. Không có reverse registry queue hay re-entrant connection transaction trong callback.
- Set/LaunchRecord snapshot được so lại dưới admission barrier; orphan intent/unclaimed launch/missing local/current-scope mismatch/companion mismatch chặn transition. Không đổi pin admission hoặc tạo abandoned/STOP authority mới.
- `retained-unknown` chỉ dành cho exact authorized record + active/uncertain scoped attempt; receipt mang record và attempt, giữ reason/identity từ journal. Nó không gọi STOP/claim/finalize/retire cho UNKNOWN và không cho replacement. Đây là thay đổi lifecycle được PM duyệt, không nới proof kernel/full-tree.
- Valid retirement receipt được skip trước old scoped read. Record chưa receipt vẫn phải current auth; không dùng cache lịch sử thay receipt.
- Transition/history precede pending current pointer/POST; lost handshake được tiếp tục bằng `boot()` trên durable pending state. Không xóa HTTP/process/admission history để tạo boot mới. Generation conflict bị từ chối và chưa có generation thì heartbeat bị chặn, không báo online giả.
- Trusted composition vẫn phải tạo GatewaySync theo boot tuple đã được connection trả về và gọi `boot()` để hoàn tất handshake pending sau reopen. Source classes chưa tự wired Task7; đây là handoff API hiện có, không phải yêu cầu worker tự tích hợp host trong FIX1.

## Validation đã kiểm và giới hạn

- Hash-verified **final121/121 PASS, 0 fail/skip**, 230,559ms; exit0 trong final log/exit/results. Chính xác21 explicit files, snapshot **9182e89:v2 +13 owned overlays**, private PostgreSQL prefix8. Prior120/120 là lịch sử trước report amendment, không được cộng/ghép để tạo final121.
- Đã đọc exact test changes, frozen runner/argv, snapshot creation/overlay manifest/stability và fixture resolver. Loader chỉ ánh xạ bare external `tar-stream`; mọi module khác dùng default resolver. Temporary compiler config chỉ exact tar-stream declaration path, không wildcard/skipLibCheck/typeany/source fallback vào peer. Snapshot279 files được captured rehash trước/sau không đổi;13 overlays khớp candidate inventory.
- Captured strict frozen build/typecheck, native `-Wall -Wextra -Werror`, diff check và Biome đều exit0. Initial TS2307 và first DB fixture failures vẫn giữ trong evidence; source/build failed output không bị gọi là PASS. Không đổi source để né lỗi observe trên record đã legitimate retired.
- Biome targeted10TS:0 errors, **33 advisories** (17 any trong tests;16 non-null gồm13 tests và3 bridge assertions có từ9182). Không tắt rule hoặc tuyên bố warning-free. Chưa có căn cứ hành vi để nâng assertion thành finding riêng.
- Đây là kiểm bằng chứng captured + source/diff review; reviewer **không chạy lại broad suite, actualDB hoặc native probes**. Sau đối chiếu, không có khoảng trống mới cần tạo canary; không chạy test từ peer working tree. Vì thế không tuyên bố121 tests do reviewer tự chạy.
- Native handler/STOP producer/retirement authority/registry verifier ngoài13diff được hash-check unchanged, giữ kết luận initial review. Không tự thêm chứng nhận PID reuse/full-tree/nativeRead/runtime invocation. Production dispatch/selection/final verifier vẫn giữ các gate phase06/08; signed/private distribution phase09 chưa được chứng nhận.

## Resource và cleanup

Reviewer không tạo temp root, workflow child, journal lock holder, DB, container, launchd label, model call hoặc truy cập credential trong scoped re-review; không có resource cleanup của reviewer ngoài file báo cáo này.

Resource inventory worker được hash-verified: **127 FIX1 roots**,106 absent/21 UNKNOWN; hai baseline fork UNKNOWN riêng; sáu container IDs absent theo captured reconciliation. Prior original inventory refresh vẫn giữ29 Task5 UNKNOWN+2baseline, không dùng groupempty/PID absence làm STOP. Hai pause/cancel fixture roots được dọn dựa trên immutable retirement/nativeSTOP đã có, không tạo receipt để hợp thức hóa cleanup. Snapshot path trong `snapshot-cleanup.json` được reviewer kiểm hiện **absent**. Reviewer không rescan/reap/xóa bất kỳ UNKNOWN root nào và không claim toàn bộ runtime resource inventory vừa được refresh trực tiếp.

## Handoff

Cho phép PM nghiệm thu **Task5 FIX1 candidate7c7c719** trên phạm vi đã review. Giữ các prerequisite riêng cho Task6/7 và phase04/06/08/09; receipt/source hash và fixture PASS không cấp runtime isolation/discovery/invoke certificate. Không có fix round mới được yêu cầu từ scoped review này.

Unresolved findings trong phạm vi: **0**. Không có câu hỏi owner cần trả lời để đóng F1–F5.
