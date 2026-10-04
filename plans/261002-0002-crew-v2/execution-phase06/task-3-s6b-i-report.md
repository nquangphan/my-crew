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
