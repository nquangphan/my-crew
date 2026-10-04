# Phase06/T3 — Re-review FIX2 S6b-i (lens bảo mật, phase03-owner)

Ngày 04/10/2026 (Asia/Ho_Chi_Minh). Phạm vi: `4c4e0aa..b719bf1`, gồm `operation-native.c`, `operations.ts`, `workflow-operations-tree.test.ts` và `docs/flows/gateway-workflows.md` bước 9. Đọc mục FIX2 trong `task-3-s6b-i-report.md`. Không chạy lại suite.

## Verdict

| Mục | Verdict | Căn cứ |
|---|---|---|
| N1a | **ADDRESSED** | Comment C và docs giờ ghi đúng: `proc_iterate()` gom tập pid dưới lock rồi mới đọc pgid/stat, nên lần liệt kê không nguyên tử. Bất biến chặn chính được nêu rõ. |
| N1b | **ADDRESSED** | `groups_alive()` dùng `kill(-g,0)==0` cho group đã biết. (1) Lúc phán quyết: listing ra 0 thì `survivors=groups_alive()`. (2) Điều kiện vào nhánh xác nhận drain và chính phép xác nhận đều đòi `!groups_alive()`. (3) `settle` dùng cùng phép thử. Chuỗi fork trong group đã biết bị bắt tất định: fork đưa con vào pgrp của cha trước khi cha có thể thoát, và kernel duyệt member của pgrp dưới lock, nên lúc nào group cũng có ít nhất một member sống. Group của leader chỉ còn leader zombie thì trả EPERM, không được tính, nên một run sạch vẫn PASS được. |
| N2 | **ADDRESSED** | Group bị prune khi ESRCH, ở cả `groups_alive` lẫn `kill_groups`. `kill(-g,SIGKILL)` chỉ gửi khi `group_confirmed` thấy, trong listing hiện tại, một entry sống có `e_pgid==g`, `getpgid==g` và `getsid==leader`. Kill theo pid đòi `getsid==leader` (khớp theo group thôi thì không kill). Group bị tái dùng mà không xác nhận được thì không bị kill; nó chỉ làm `groups_alive()>0` → UNKNOWN, tức là âm tính giả fail-closed chứ không kill nhầm. Khe giữa lúc xác nhận và lúc kill chỉ bằng một syscall, đúng như docs ghi. `groupsKnown` là field additive, TS không dùng làm luật. |

## Ba điểm kiểm thêm

1. **Miễn trừ group của leader: không mở lại rủi ro kill nhầm.** Mọi lời gọi `kill_session`/`settle`/`kill_groups` đều nằm **trước** `waitpid(child)`, kể cả các đường lỗi: EV_ERROR gọi `settle` → `kill(child)` → `waitpid`; các đường 32/35 đều gọi `settle` rồi mới `waitpid`. Vậy lúc gửi `kill(-leader)` thì leader luôn còn sống hoặc là zombie. pid của nó chưa được giải phóng, nên không tiến trình nào mang pid đó để tạo group cùng id. Sau `waitpid` không còn lời kill nào. Rủi ro chỉ quay lại nếu sau này có code gọi `kill_session` sau khi reap. Nên giữ bất biến này trong comment (hiện đã có câu "The leader stays unreaped…").
2. **EPERM của `kill(-g,0)`: không tạo PASS sai thực tế.** Kernel chỉ trả EPERM khi group còn member nhưng không member nào ta signal được. Process setuid vẫn giữ real uid của ta nên vẫn signal được và được đếm. EPERM chỉ xảy ra với zombie hoặc tiến trình đã đổi hẳn real uid (ví dụ root daemon gọi `setuid`). Tiến trình như vậy, nếu sống lâu, vẫn được liệt kê qua `getsid`/`e_pgid` → `survivors>0`. Drain không kill được nó → hết 2 s → `drained=0` → UNKNOWN. PASS sai chỉ xảy ra với một **chuỗi fork khác real uid** lọt qua mọi lần liệt kê (hai lần lúc phán quyết, lần drain, lần xác nhận). Lớp này đã có trong phần dư của docs, và trong renderer đã pin thì không thực tế (không tty, Seatbelt). Chấp nhận.
3. **`execute` cũ: vẫn byte-identical.** Mọi hunk nằm trong hàm chỉ chạy ở tree mode (`groups_alive`, `group_confirmed`, `kill_groups`, `kill_session`, `settle`) hoặc trong khối `if(as_tree)`. Format receipt chính không đổi; `extra` chỉ được điền ở tree mode. `main` không đổi so với FIX1.

## Findings mới

- **Minor, docs bước 9:** vẫn còn câu "Helper kill mọi group đã học, mọi thành viên…" ở đoạn phán quyết. Câu này mâu thuẫn với cơ chế mới (chỉ kill group đã xác nhận cộng group của leader, chỉ kill pid đã được `getsid` xác nhận). Sửa câu đó cho khớp; không chặn.
- **Không có breakage.** `extra[192]` đủ chỗ cho cả `groupsKnown`: phần cố định khoảng 98 ký tự, cộng 4 số nguyên mỗi số tối đa 11 ký tự là khoảng 142 < 192, nên không bị cắt. Mỗi `kill_session` tốn ba lần snapshot, có chặn và chấp nhận được. Run `uv`→Python bình thường chỉ có group của leader, nên không đổi kết quả PASS.

## Assessment

**Task quality:** Approved. N1a/N1b/N2 ADDRESSED, `execute` byte-identical, không có breakage. Sửa câu docs Minor khi tiện. N3 (kiểm và dọn `receipts/{id}.leader`) vẫn thuộc S6b-ii.

**Phase03-owner:** chấp nhận diff C của S6b-i tại `b719bf1` để đóng lát.
