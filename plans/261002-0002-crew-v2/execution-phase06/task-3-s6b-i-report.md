# Phase06/T3 — Báo cáo lát S6b-i (verb native `execute-tree`, `EXECUTOR_BUSY`)

Ngày 04/10/2026 (Asia/Ho_Chi_Minh). Nhánh `codex/crew-v2-server`, BASE `5b86ce7314b6fa31b34f2d0a18b106161c5e3e44`. Ruling áp dụng: `pm-s6b-rulings-memo-261004.md` mục 2 (Q1), Q4/Q5 (`.leader`, N5) và ruling PM 09:30 trong `progress.md`.

## Kết quả

Status: DONE_WITH_CONCERNS. Commit code+docs: `a1981b7`.

- `operation-native.c`: thêm verb `execute-tree`, dùng chung ABI, kiểm identity, giới hạn thời gian/byte/log/rlimit, môi trường và network với `execute`. Verb `execute` giữ nguyên hành vi: cùng `setpgid`, cùng điều kiện kill, cùng bytes receipt (format string chỉ thêm `%s` rỗng ở chế độ này). Ở chế độ tree:
  1. leader gọi `setsid()` thay vì `setpgid(0,0)`;
  2. trước khi mở gate, parent ghi `{stage}/.leader` = `pid start-giây.micro-giây` (O_EXCL, O_NOFOLLOW, 0600, fsync file và stage; start-time lấy từ `KERN_PROC_PID`). Ghi lỗi thì đóng gate, reap leader và thoát 36;
  3. mỗi vòng (tick 1 giây hoặc mỗi event) liệt kê session, ghi `maxSessionSize`, và gắn `EVFILT_PROC NOTE_EXIT` riêng cho từng thành viên mới (kiểm lại `getsid` sau khi arm, để watch không dính vào pid đã bị tái dùng). Timeout kill `-leader`, leader và từng thành viên vừa liệt kê;
  4. khi leader `NOTE_EXIT`, trước `waitpid`: nhận event còn treo, chụp session (rỗng thì chụp lại lần nữa để chặn race fork-giữa-listing). `survivors` là số thành viên còn trong session. `escaped` là số thành viên đã theo dõi chưa có `NOTE_EXIT` mà không còn trong session (đã `setsid` rời đi; trước khi kết luận có chờ 100 ms cho exit đang bay), cộng thêm 1 nếu có thành viên không theo dõi được. Sau đó kill mọi thứ còn lại (pgid, từng pid trong session, từng thành viên chưa thoát) và chờ tối đa 2 giây tới khi session rỗng và mọi thành viên đã theo dõi đều thoát.
  
  Receipt thêm `mode:"tree"`, `sessionEmptyAtExit`, `survivors`, `escaped`, `maxSessionSize`; `formatVersion` vẫn 1. Ở receipt tree, `treeEmpty` = session đã được chứng minh rỗng (drained) sau leader. `forkObserved` giữ nghĩa cũ.
- `operations.ts`: `executeTree(id, identity, cwd, command, timeoutSeconds)`. PASS khi `mode==='tree' && treeEmpty && (timedOut || (sessionEmptyAtExit && survivors===0 && escaped===0))`; ngoài ra ném `EXECUTOR_LIFETIME_UNKNOWN` và receipt vẫn nằm trên đĩa cho reconcile. Phần spawn/đọc receipt dùng chung (`run`) với `execute`; luật của `execute` không đổi. Exit 20 của helper ở cả hai verb → `EXECUTOR_BUSY` (N5). Helper thoát 20 trước fork và trước mọi ghi vào stage, nên caller có thể thu hồi stage ngay. Không còn exit 20 nào bị gộp vào `EXECUTOR_RECEIPT_MISSING`.
- `ExecutionReceipt` thêm field optional (additive).
- Không nối vào `render-executor.ts` (S6b-ii), không chạm `workspace.ts`, không sửa script build native (`NativeHelper.build` băm source C nên tự build lại bằng clang `-Wall -Wextra -Werror -O2` như cũ).

## Lệch ruling cần PM/phase03-owner xác nhận

1. **`KERN_PROC_SESSION` không tồn tại trên máy này.** macOS 26.6.2 (25G83) trả ENOENT cho `sysctl({CTL_KERN,KERN_PROC,KERN_PROC_SESSION,sid})` (cả dạng 3 và 4 MIB); `sysctlnametomib("kern.proc.session")` cũng lỗi, trong khi `pgrp/pid/all/uid` vẫn có. Probe lưu tại `$TMPDIR/crew-v2-s6b-i/p2.c`/`probe.c` (scratch). Cơ chế thay thế giữ đúng ngữ nghĩa "thành viên session": liệt kê `KERN_PROC_ALL` rồi lọc theo `getsid(pid) == leader`. Probe xác nhận: `getsid` đọc được pid khác user; thành viên `setsid` rời đi biến mất khỏi danh sách; zombie (kể cả leader zombie) **không** có session nên không được đếm. Memo yêu cầu đếm cả zombie chưa reap. Với cơ chế này điều đó không làm được, nhưng zombie đã thoát nên không giữ được tài nguyên hay ghi vào stage. Chi phí: khoảng 650 entry (≈420 KB) và khoảng 650 lần `getsid` cho mỗi tick/event.
2. **Theo dõi thành viên bằng `NOTE_EXIT` riêng** (memo chỉ có đếm session). Cần để RED (3) "con thoát khỏi session" có kết quả UNKNOWN: chỉ đếm session thì tiến trình đã `setsid` rời đi trông y như đã thoát và sẽ được PASS sai. Theo dõi tối đa 256 thành viên; vượt ngưỡng hoặc arm lỗi (khác ESRCH) thì tính là không chứng minh được (`escaped` +1, `treeEmpty=false`). Liệt kê lỗi hoặc session >256 thì helper kill pgid và leader rồi thoát 32 (không có receipt nên caller giữ stage).
3. **Timeout tree trả receipt khi `treeEmpty`**, kể cả lúc `sessionEmptyAtExit=false`: timeout đã SIGKILL cả session trước khi leader chết, nên thành viên còn thấy lúc leader thoát chỉ là đang chết, và drain xác nhận session rỗng. Cách này khớp memo Q4 ("stage `timedOut` trong tree mode đã chứng minh session rỗng → reclaim ngay") và test timeout của bảng lát; luật PASS rút gọn của memo không nói tới trường hợp này.
4. **"Không giữ stage" khi BUSY** được hiện thực ở tầng operations như sau: lỗi phân biệt `EXECUTOR_BUSY`, không receipt, stage chỉ còn `.operation-owner`, và `remove` thành công ngay khi guard được nhả. Việc caller (render-executor) thật sự thu hồi stage khi BUSY thuộc S6b-ii; hiện render-executor vẫn ánh xạ mọi lỗi khác UNKNOWN thành `RENDER_OPERATION_UNAVAILABLE` và giữ stage.

## Phần dư (đã ghi trong docs)

- Hậu duệ gọi `setsid()` **trước** lần quan sát đầu tiên (giữa hai lần liệt kê) thì không thấy được. Test (3) chỉ chứng minh trường hợp thành viên đã được quan sát rồi mới rời session. Đúng phần dư của memo.
- Kill theo pid (survivor/escapee) có cửa sổ tái dùng pid cỡ micro-giây giữa lúc kiểm và lúc kill. Kill theo pgid an toàn vì leader chưa được reap.
- Một exit trùng đúng lúc leader thoát mà vượt quá 100 ms chờ có thể bị tính là `escaped`. Trường hợp này fail-closed (UNKNOWN), không bao giờ cho PASS sai.

## TDD và bằng chứng

| Bước | Lệnh (cwd `v2/gateway`, `NODE_OPTIONS=--max-old-space-size=384`, slot nặng `owner=s6b-i`, gate `heavyEligible` parse JSON) | Kết quả | Log / SHA-256 |
|---|---|---|---|
| RED | `node --test test/workflow-operations-tree.test.ts`, scaffold `executeTree` gọi thẳng `execute` cũ | exit 1, 5/6 fail đúng ngữ nghĩa: fork → `EXECUTOR_LIFETIME_UNKNOWN` (1, 4), survivor/escapee còn sống (2, 3), `EXECUTOR_RECEIPT_MISSING` thay `EXECUTOR_BUSY` (6); (5) regression `execute` pass | `task-3-s6b-i-red.log` `e7931aa3…fa35` |
| GREEN lần 1 | như trên | 6/6 pass | `task-3-s6b-i-green-run1.log` `c6549773…6dbe` |
| Regression | tree + `workflow-operations` + `workflow-registry` + `render-executor` + `isolation-workspace` | 48/48 pass | `task-3-s6b-i-regression.log` `8d33a8b2…39cb` |
| Ổn định + typecheck + biome | tree ×3, `tsc --noEmit`, `biome check` 2 file TS | 6/6 ×3; tsc exit 0; biome chỉ báo format 1 dòng test, đã `--write`, check lại sạch | `task-3-s6b-i-checks.log` `4010ab5b…afff` |
| GREEN cuối (bytes commit) | như regression | exit 0, 48/48 pass | `task-3-s6b-i-green.log` `ce9c02eb…7328` |

Test (`workflow-operations-tree.test.ts`, helper native thật, compile trong test như các test cũ):
1. `sh -c 'echo $$; sleep 1 & wait'` → PASS, `forkObserved=true`, `sessionEmptyAtExit=true`, `survivors=0`, `escaped=0`, `maxSessionSize≥2`. `.leader` là file thường 0600 nlink 1, pid trùng `$$` của leader, start-time hợp lệ.
2. `sh -c 'sleep 32 & echo $!'` → `EXECUTOR_LIFETIME_UNKNOWN`, `survivors≥1`, `sessionEmptyAtExit=false`, `treeEmpty=true`; pid sleep đã chết khi helper trả về.
3. perl ngủ 2 giây trong session, `setsid()` rồi ngủ tiếp; leader thoát sau 4 giây → UNKNOWN, `sessionEmptyAtExit=true`, `survivors=0`, `escaped≥1`; perl đã bị kill.
4. Timeout 1 giây với hai sleep → receipt `timedOut=true`, `treeEmpty=true`, sleep nền đã chết.
5. `execute` cũ với fork → UNKNOWN, `forkObserved=true`, `treeEmpty=false`, không có `mode`, không có `.leader`.
6. perl giữ `flock` trên `.operations.guard` → `execute` và `executeTree` đều `EXECUTOR_BUSY`, không receipt, stage chỉ còn `.operation-owner`; nhả guard thì `remove` xoá được stage.

Docs: `docs/flows/gateway-workflows.md` (bước 9 và bảng Files), `docs/flows.yaml` (thêm test vào `gateway-workflows.tests`), `docs/files.md` sinh lại. Đã chạy trên mirror `git archive HEAD:v2` cộng overlay: `crew-docs generate` (cập nhật `files.md` 1 dòng), `check --all` ok, `check --staged` ok. Manifest sửa dưới `$TMPDIR/crew-v2-manifest.lock` từ lúc đọc HEAD tới commit.

## Tài nguyên và dọn dẹp

- Mọi lượt test giữ `$TMPDIR/crew-v2-heavy-slot.lock` (`owner=s6b-i`) và chỉ chạy khi gate trả `heavyEligible=true`. Một lần gặp slot bận (`web-task4`), hai lần gate trả không eligible; đã nhả slot và chờ, rồi mới chạy GREEN cuối. Lệnh `tsc --noEmit` lần thứ hai chạy ngoài slot (nhẹ, không spawn test).
- Sau mỗi lượt, `ps` không còn tiến trình nào của lát (`sleep 32–36`, perl `setsid`/`LOCKED`). Hook `after` của test chỉ kill pid còn sống mà command vẫn khớp argv riêng của test, nên không bao giờ đụng pid đã bị tái dùng.
- Test cũ `workflow-operations.test.ts` theo thiết kế vẫn giữ lại fixture fork-UNKNOWN (`crew-task4-lifetime-*` trong `$TMPDIR`). Lát này không xoá chúng.

## Concerns

- Lệch 1–3 ở trên cần phase03-owner review diff C, đúng như ruling yêu cầu.
- `render-executor` chưa dùng `EXECUTOR_BUSY`/`executeTree`; việc này thuộc S6b-ii.

## FIX1 (review `task-3-s6b-i-review.md`) — commit `4c4e0aa`

Status: DONE_WITH_CONCERNS. BASE của vòng sửa: `9dfec86` (lúc commit HEAD là `10c73f0`, các commit xen giữa chỉ đụng web/plan phase07). Verb `execute` giữ nguyên hành vi: trong `execute_owned`, mọi dòng đổi đều nằm sau `as_tree`. Thay đổi duy nhất ngoài chế độ tree là tách mã guard trong `main` (M5), áp cho mọi verb như yêu cầu.

| Mục | Sửa | Test (native thật) |
|---|---|---|
| I1 | Trong vòng chờ sau leader, nếu còn thứ phải kill trong khi phán quyết lúc leader thoát là rỗng (`survivors=0, escaped=0`, không timeout), thì `survivors` bị nâng lên `max(remaining,1)`, nên run không bao giờ PASS. Thêm vào đó, thành viên session gồm cả tiến trình sống có **process group đã biết** thuộc session, đọc từ snapshot `KERN_PROC_ALL` nguyên tử (`e_pgid`). Group được học qua `getsid`→`getpgid`→`getsid` trên thành viên đã xác nhận, nên chuỗi fork-thoát nhanh trong group đã biết không lọt qua khe liệt kê/`getsid` nữa. | `a fork chain that outruns per-pid listing…`: chuỗi 2000 hop ở group riêng, leader thoát giữa chuỗi → UNKNOWN, `sessionEmptyAtExit=false`, không còn tiến trình nào |
| I2 | `executeTree` đòi `escaped===0` ở mọi nhánh, kể cả timeout. Escape được ghi **ngay lúc thấy** (`getsid` trả một session sống khác; cờ `left` cố định), trước mọi kill. Cách cũ suy ra escape lúc phán quyết, nên kill lúc timeout xoá mất bằng chứng. | `a timeout with an escaped member is UNKNOWN…` |
| I3 | Bản leader chuẩn là `receipts/{id}.leader` (O_EXCL/O_NOFOLLOW/0600, fsync file và thư mục `receipts`). Không còn bản trong stage. Không ghi được thì exit 36 trước khi mở gate. | Test 1 đọc `receipts/tree-pass.leader` và khẳng định stage không có `.leader`; `the leader record outside the stage is unaffected…` (child ghi `1 0.000000` vào stage `.leader`, bản trong receipts vẫn đúng pid); `execute`/BUSY không tạo `receipts/{id}.leader` |
| M1 | `kill_session` kill mọi group đã học (kể cả leader), leader, mọi thành viên của một listing mới **không giới hạn**, và mọi thành viên đã theo dõi chưa thoát (kể cả đã rời session). Mọi đường lỗi sau gate (32/35, kevent lỗi, liệt kê lỗi/vượt trần, clock lỗi, `fstat` stage lỗi) gọi `settle`: lặp kill tới khi listing không giới hạn rỗng và mọi thành viên đã theo dõi thoát, tối đa 2 giây, rồi mới reap leader. | `a session above 256 members fails closed and kills members in other groups and escaped ones`: thành viên `setpgrp` riêng, thành viên đã `setsid`, 300 sleep → `EXECUTOR_RECEIPT_MISSING`, không receipt, không còn tiến trình nào. Lần chạy đầu bắt được một sleep `sh` vừa fork trong lúc kill; nhờ đó mới thêm `settle`. |
| M2 (ledger) | Hệ quả phụ: kill lúc timeout và lúc chờ dùng listing mới (`kill_session`) thay cho danh sách cũ đã qua một lần quét `tree()`. | — |
| M3 | Thành viên được arm `EV_ADD|EV_CLEAR` với `NOTE_FORK|NOTE_EXIT`; knote tự gỡ khi thành viên thoát. | `a grandchild that leaves the session soon after its fork is observed through member NOTE_FORK`: cháu ở trong session 0,3 s, nằm giữa hai tick |
| M4 (ledger) | Docs bước 9 ghi trần 256 **cộng dồn** cho thành viên được theo dõi, cộng trần 256 mỗi lần liệt kê và 256 group. | Test hopper chạm đúng trần này (`treeEmpty=false`, fail-closed), nên test không khẳng định `treeEmpty` |
| M5 | Guard không phải file thường riêng của user (symlink, sai mode/uid/nlink, mở lỗi, `flock` lỗi khác `EWOULDBLOCK`) → exit 24 → `EXECUTOR_GUARD_INVALID`. Chỉ `EWOULDBLOCK` → 20 → `EXECUTOR_BUSY`. | `an invalid operations guard is EXECUTOR_GUARD_INVALID…` (guard 0644, cả hai verb) |
| M6 | Thêm các test exit 36, drain-kill (hopper, survivor) và session >256 như trên. | — |

### Bằng chứng

| Bước | Kết quả | Log / SHA-256 |
|---|---|---|
| RED (13 test, code `a1981b7`) | exit 1, 7/13 fail đúng ngữ nghĩa: ENOENT `receipts/*.leader` (I3 ×2), thiếu rejection (exit 36, I2, M3), tiến trình còn sống sau overflow (M1), `EXECUTOR_BUSY` thay `EXECUTOR_GUARD_INVALID` (M5). Test hopper (I1) **pass ngay trên code cũ**: helper cũ bắt được chuỗi ở lần liệt kê lúc phán quyết, không tái hiện tất định được nhánh "hai lần liệt kê đều trượt". Sửa I1 dựa trên lập luận của review cộng snapshot group nguyên tử; test giữ vai trò khẳng định bất biến. | `task-3-s6b-i-fix1-red.log` `5db23e0f…4388` |
| GREEN lần 1 | 11/13: I2 vẫn fail (kill lúc timeout xoá bằng chứng escape), overflow còn một sleep → sửa: ghi escape ngay lúc thấy, thêm `settle` | `task-3-s6b-i-fix1-green-run1.log` `386684d3…f886` |
| GREEN lần 2 | 12/13: hopper `treeEmpty=false` vì chạm trần theo dõi cộng dồn (fail-closed đúng) → bỏ khẳng định `treeEmpty` trong test, có ghi lý do | `task-3-s6b-i-fix1-green-run2.log` `8ef884c0…608c` |
| GREEN lần 3 | 13/13 | `task-3-s6b-i-fix1-green-run3.log` `46b9b941…d048` |
| Regression + ổn định + tsc + biome (bytes commit) | tree + `workflow-operations` + `workflow-registry` + `render-executor` + `isolation-workspace` 55/55; tree thêm 2 lần 13/13; `tsc --noEmit` exit 0; biome sạch | `task-3-s6b-i-fix1-green.log` `98ea3896…3f75` |

Mọi lệnh test và cả `tsc` đều chạy trong slot nặng (`owner=s6b-i`), sau khi gate trả `heavyEligible=true`. Sau mỗi lượt `ps` không còn tiến trình của lát. Hook `after` giờ đăng ký marker argv **trước** khi tiến trình mang marker khởi động. Lần RED đầu đăng ký muộn nên ba tiến trình (perl và sleep có marker riêng) sống tới khi tự hết `sleep 30`; khi kiểm tra thì chúng đã tự thoát. Docs: `gateway-workflows.md` bước 9 và bảng Files; `crew-docs generate` không đổi gì, `check --all`/`--staged` ok; manifest sửa dưới `crew-v2-manifest.lock`.

### Concerns FIX1

- Nhánh I1 "drain thấy thành viên khi phán quyết là rỗng" không có RED tất định (xem trên). Snapshot group nguyên tử thu hẹp nó về đúng phần dư đã ghi: thành viên ở group chưa biết.
- Kill theo group đã học dựa vào giả định pid/pgid không bị tái dùng trong một lần chạy (macOS cấp pid tuần tự). Điều này đã ghi trong docs.
- `receipts/{id}.leader` dùng O_EXCL: chạy lại cùng `id` mà bản cũ còn thì exit 36. S6b-ii cần kiểm `absent('receipts', '{id}.leader')` như với `{id}.json`, và dọn file này khi reclaim.
- Câu hỏi còn mở của review (pid = sid có được giữ sau khi leader bị reap hay không) chưa xác minh; reconcile S6b-ii không nên dựa vào `getsid(x)==leaderPid` sau khi helper đã thoát.

## FIX2 (re-review `task-3-s6b-i-fix1-re-review.md`) — commit `b719bf1`

Status: DONE_WITH_CONCERNS. BASE vòng sửa: `4040cd6`. Verb `execute` giữ nguyên byte hành vi. Các hunk đổi trong `execute_owned` chỉ có phán quyết, drain và `extra` của receipt, đều nằm trong khối `as_tree`. `main` không đổi so với FIX1.

Probe trước khi sửa (`$TMPDIR/crew-v2-s6b-i/p4.c`, macOS 26.6.2) đo `kill(-g,0)`: group có thành viên sống cùng uid → 0; group chỉ còn zombie, kể cả leader đã thoát mà chưa reap → EPERM; group đã mất → ESRCH. Vì vậy phép thử áp được cho cả group của leader mà không cần loại riêng leader zombie.

| Mục | Sửa | Test |
|---|---|---|
| N1a | Comment C và docs bước 9 ghi đúng: `KERN_PROC_ALL` qua `proc_iterate()` chỉ gom tập pid dưới lock, còn pgid/stat đọc sau khi nhả lock, nên lần liệt kê **không nguyên tử**. Bất biến chặn chính được ghi rõ: còn phải kill sau khi leader thoát thì không bao giờ PASS. | — (docs/comment) |
| N1b | `groups_alive()`: `kill(-g,0)==0` với group đã biết là còn thành viên sống. Lúc phán quyết: nếu listing ra 0 thì `survivors = groups_alive()`. Lúc xác nhận drain và trong `settle`: còn group sống thì chưa rỗng (drain còn phải kill thì bị nâng `survivors` như I1). | `a fork chain inside the leader group is caught by the kernel group check every time`: chuỗi 1500 hop trong group leader, chạy 3 lần, lần nào cũng UNKNOWN, `survivors≥1`, không còn tiến trình. Test cũ chuỗi ở group riêng vẫn giữ. |
| N2 | Group bị loại ngay khi `kill(-g,0)` trả ESRCH (cả trong `groups_alive` lẫn `kill_groups`). `kill(-g,SIGKILL)` với group đã học chỉ gửi khi listing hiện tại có tiến trình sống `e_pgid==g` mà `getpgid(pid)==g && getsid(pid)==leader`. Group của leader miễn xác nhận vì leader chưa reap giữ id. Kill theo pid từ listing chỉ gửi cho pid có `getsid==leader` (entry chỉ khớp theo group thì không bị kill theo pid). Group sống mà không xác nhận được thì không bị kill, giữ session ở trạng thái chưa rỗng → UNKNOWN. Receipt tree thêm `groupsKnown` (additive). Câu "cửa sổ rất hẹp" đã bỏ khỏi docs, thay bằng mô tả cơ chế mới. | `a learned process group that emptied is pruned and does not block PASS`: thành viên `setpgrp` riêng, ngủ 2 giây rồi thoát; PASS, `groupsKnown===1` (chỉ còn group của leader) |
| N3 | Docs ghi: `receipts/{id}.leader` dùng O_EXCL, caller phải kiểm `absent('receipts','{id}.leader')` trước khi chạy và dọn cùng `{id}.json` khi reclaim. Phần code thuộc S6b-ii. | — |

### Bằng chứng

| Bước | Kết quả | Log / SHA-256 |
|---|---|---|
| RED (15 test; nguồn C tạm khôi phục về bản FIX1 `HEAD`, TS/test mới) | exit 1, 14/15. Test prune fail ở `groupsKnown` (`undefined !== 1`). Test chuỗi trong group leader **pass trên code cũ**: helper cũ bắt được chuỗi bằng listing theo `e_pgid` ở cả 3 lần, nên khe không nguyên tử không tái hiện tất định được. Test mới vì vậy là test bất biến (3 lần lặp), không phải RED. RED của N2 chỉ chứng minh trường "pruned" quan sát được; còn tái dùng pgid thật thì không ép được nếu không quay vòng không gian pid. | `task-3-s6b-i-fix2-red.log` `de50599a…28df` |
| GREEN focused | 15/15 | `task-3-s6b-i-fix2-green-run1.log` `31ebba25…63e9` |
| Regression + ổn định + tsc + biome (bytes commit) | tree + `workflow-operations` + `workflow-registry` + `render-executor` + `isolation-workspace` 57/57; tree thêm 2 lần 15/15; `tsc --noEmit` exit 0; biome sạch | `task-3-s6b-i-fix2-green.log` `86ff1c9d…b5dc` |

Mọi lệnh test và `tsc` đều chạy trong slot nặng sau khi gate trả `heavyEligible=true`. `ps` sau mỗi lượt không còn tiến trình của lát. Docs: `crew-docs generate` không đổi gì, `check --all`/`--staged` ok trên mirror; hook commit ok; manifest sửa dưới lock.

### Concerns FIX2

- N1b và N2 không có RED tất định (lý do ở trên); bằng chứng là test bất biến cộng trường `groupsKnown`.
- Thành viên khác uid (setuid) không được `kill(-g,0)` đếm, vì kernel trả EPERM giống trường hợp chỉ còn zombie. Chúng chỉ được bắt qua liệt kê; điều này đã ghi trong docs.
- N3 (dọn và kiểm `receipts/{id}.leader`) thuộc S6b-ii.
