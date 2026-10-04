# Phase06/T3 — Re-review FIX1 S6b-i (lens bảo mật, phase03-owner)

Ngày 04/10/2026 (Asia/Ho_Chi_Minh). Phạm vi: `a1981b7..4c4e0aa`, chỉ `operation-native.c`, `operations.ts`, `workflow-operations-tree.test.ts`, `docs/flows/gateway-workflows.md`; các file web/server lọt vào range là của task khác. Đọc mục FIX1 trong `task-3-s6b-i-report.md`. Không chạy lại suite.

Có kiểm tra thêm một nguồn ngoài: `proc_iterate()` trong XNU (`bsd/kern/kern_proc.c`, apple-oss-distributions/xnu, nhánh main). Hàm này gom danh sách pid khi giữ `proc_list_lock`, **nhả lock**, rồi mới gọi callout (`proc_find` + đọc `kinfo_proc`) cho từng pid. `KERN_PROC_ALL` đi qua `proc_iterate`, nên snapshot **không nguyên tử** ở mức dữ liệu từng tiến trình.

## Verdict từng mục

| Mục | Verdict | Căn cứ |
|---|---|---|
| I1 | **ADDRESSED** (bất biến review yêu cầu). ⚠️ Lập luận phụ chưa kín, xem N1. | `operation-native.c` vòng drain: nếu `!timed && survivors==0 && escaped==0` mà còn `remaining>0 \|\| alive>0` thì `survivors=max(remaining,1)`. Lần liệt kê xác nhận khác 0 → `drained=0` → `treeEmpty=false`. Mọi lần kill sau khi leader thoát đều ra UNKNOWN. |
| I2 | **ADDRESSED** | `operations.ts`: điều kiện `escaped===0` áp cho mọi nhánh. C ghi `left` ngay khi `getsid` trả một session sống khác (`note_escapes` mỗi tick, trước mọi kill, và ở đầu `kill_session`). `escapes()` cập nhật lại sau drain. Test timeout+escape. |
| I3 | **ADDRESSED** | Bản leader chuyển sang `receipts/{id}.leader`: `openat(receipts,…)`, O_EXCL/O_NOFOLLOW/0600, fsync file + `receipts`. Sandbox render không ghi được `receipts/`. Không còn bản trong stage. Test child giả mạo `.leader` trong stage. Không có consumer nào liệt kê `receipts/` theo đuôi (`registry.ts:320,564` và `operations.ts:188` chỉ đọc `{id}.json`), nên không xung đột tên. |
| M1 | **ADDRESSED** | `settle()` chạy ở mọi đường lỗi sau gate (fstat, clock, kevent/EV_ERROR, liệt kê lỗi/vượt trần ở vòng chính, lúc phán quyết và lúc drain). `kill_session` + listing không giới hạn + thành viên đã theo dõi còn `getsid>0`, chặn 2 s, rồi mới `waitpid`. Các đường trước gate (31, 36) không có gì chạy. |
| M3 | **ADDRESSED** | Thành viên được arm `EV_ADD\|EV_CLEAR`, `NOTE_FORK\|NOTE_EXIT`; `member_event` vẫn chỉ đánh dấu khi có bit EXIT. Test cháu ở trong session 0,3 s. |
| M5 | **ADDRESSED** | Guard sai/mở lỗi/`flock` lỗi khác `EWOULDBLOCK` → 24 → `EXECUTOR_GUARD_INVALID`; chỉ `EWOULDBLOCK` → 20. Exit 24 áp cho mọi verb. Đã kiểm consumer: `render-executor.ts:421-426` `helperFailure` ánh xạ 24 thành `RENDER_OPERATION_UNAVAILABLE` (không retry), hợp lý hơn BUSY cũ. Không chỗ nào khác so khớp mã 20. |
| M6 | **ADDRESSED** | Có test cho exit 36, hopper (I1, khẳng định bất biến, không phải RED tất định), timeout+escape, >256, guard sai. Marker argv đăng ký trước khi spawn; `after` kill theo marker riêng. |

**Đường `execute` cũ:** vẫn byte-identical trong `execute_owned`. Mọi dòng thêm đều nằm sau `if(as_tree)` hoặc `as_tree?…`: các đường lỗi 35/32 giữ nguyên `kill(child)`/`waitpid` khi không ở tree mode, kill lúc timeout giữ nguyên, `groups[0]` chỉ đặt ở tree mode, format receipt không đổi. Thay đổi duy nhất chạm `execute` là tách mã guard 20/24 trong `main`, đúng theo yêu cầu M5.

## Các điểm worker vừa thêm

- **Escape ghi nhận lúc thấy:** đúng hướng. Dương tính giả chỉ xảy ra khi pid của thành viên đã thoát bị tái dùng trước khi `NOTE_EXIT` được absorb (cần quay vòng pid), và nó fail-closed. Bỏ khoảng chờ 100 ms cho exit đang bay cũng an toàn: knote `NOTE_EXIT` được post trong đường `exit` trước khi cha kịp reap, và `absorb(queue,child,0)` ở đầu bước phán quyết đã rút hết event trong hàng.
- **Đường lỗi kill tới khi rỗng (≤2 s):** chặn thời gian đúng; clock lỗi thì chỉ chạy một vòng. **Có thể kill ngoài session** qua group đã học khi pgid bị tái dùng (N2). Kill theo pid từ phép thử `getsid` và kill thành viên đã rời session (vẫn là hậu duệ của ta) thì chấp nhận được.
- **`receipts/{id}.leader` O_EXCL:** đúng cho tính toàn vẹn, nhưng chưa có ai dọn (N3).
- **Exit 24 cho mọi verb:** không gây breakage, xem M5.
- **Trần 256 fail-closed:** listing >256 → `settle` + exit 32, không receipt. Tổng thành viên theo dõi >256 hoặc group >256 → `untracked` → `escaped≥1` và `drained=0` → UNKNOWN. Listing vượt trần trong drain → `settle`, `drained` giữ 0 → UNKNOWN. Kín.

## Findings mới

**Important**

- **N1: lập luận "snapshot nguyên tử" trong comment C (`operation-native.c`, khối comment session tracking) và docs bước 9 là sai.** `KERN_PROC_ALL` chỉ nguyên tử ở **tập pid**; `e_pgid`/`p_stat` được đọc sau khi nhả lock (`proc_iterate`). Một chuỗi fork→exit trong group đã biết vẫn có thể lọt: pid X có trong danh sách, nhưng tới lúc callout thì X đã là zombie hoặc đã bị reap, còn con Y sinh sau khi gom danh sách thì không có trong danh sách. Hệ quả thực tế bị chặn bởi I1: chuỗi phải trượt liên tiếp hai lần liệt kê lúc phán quyết, lần drain đầu và lần xác nhận. Đây là PASS sai có xác suất thấp, không phải lỗ mở. Nhưng một khẳng định bảo mật sai trong code/docs là thứ S6b-ii và reconcile sẽ dựa vào. **Sửa:** (a) sửa comment/docs cho đúng: tập pid nguyên tử, dữ liệu từng tiến trình thì không; (b) thêm phép thử nguyên tử thật cho group đã biết: lúc phán quyết và lúc xác nhận drain, `kill(-g,0)==0` với mọi `g` trong `groups` (kernel duyệt member của pgrp dưới lock của pgrp) → coi là survivor. Group của leader cũng được thử bằng cách này; leader là zombie nên cần loại nó, ví dụ chỉ coi `g==child` là còn người khi listing hoặc `getsid` khẳng định. Như vậy chuỗi trong group đã biết bị bắt tất định, phần dư chỉ còn "group chưa biết", đúng như docs đang mô tả.

**Minor**

- **N2: tái dùng pgid → kill/đếm ngoài session (`in_session`, `kill_session`).** `groups[]` không bao giờ bị loại. Khi một group đã học trở nên rỗng mà id của nó bị cấp lại cho group leader của một tiến trình cùng uid không liên quan (shell job, app), `kill(-g,SIGKILL)` giết cả group đó, và phép thử `e_pgid` đếm nó là thành viên (rồi kill theo pid). Cần quay vòng pid trong ≤~122 s, và chỉ trúng cùng uid. Cửa sổ là phần còn lại của lần chạy, không phải "rất hẹp" như docs viết. **Sửa:** bỏ `g` khỏi `groups` ngay khi `kill(-g,0)` trả ESRCH; trước `kill(-g,SIGKILL)` cũng yêu cầu `kill(-g,0)==0`, và ở mỗi snapshot có ít nhất một entry `e_pgid==g` mà `getsid==leader` (một `getsid` cho mỗi group, không mở lại khe chuỗi). Sửa câu docs về độ rộng cửa sổ.
- **N3: `receipts/{id}.leader` không được dọn và chặn chạy lại.** Bản cũ còn thì lần chạy cùng `id` → 36 → `EXECUTOR_RECEIPT_MISSING`, không phân biệt được với lỗi khác. Một crash giữa lúc ghi leader và lúc mở gate để lại bản leader của một lần chạy chưa từng chạy. S6b-ii phải: `absent('receipts', '{id}.leader')` trước spawn (như `render-executor.ts:564` làm với `.json`); reconcile chấp nhận leader không có receipt khi `pid+start-time` không còn; quyết định vòng đời file này cùng `{id}.json`. Không chặn lát này.

## Assessment

**Task quality:** Approved với điều kiện. I1/I2/I3/M1/M3/M5/M6 ADDRESSED; `execute` cũ byte-identical; không thấy breakage chức năng mới. Tôi chỉ chặn ở N1(a): phải sửa comment và docs sai trước khi merge vào chuỗi S6b-ii. N1(b) nên làm ngay vì nhỏ và biến chuỗi trong group đã biết thành bắt tất định. Nếu PM muốn hoãn thì ghi N1(b) và N2 vào ledger S6b-ii. N3 thuộc S6b-ii.

**Phase03-owner:** chấp nhận diff C của FIX1 với cùng điều kiện như trên.
