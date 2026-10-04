# Phase06/T3 — Review S6b-i (`execute-tree`, `executeTree`, `EXECUTOR_BUSY`, `.leader`) — spec + quality + security, phase03-owner

Ngày 04/10/2026 (Asia/Ho_Chi_Minh). Nhánh `codex/crew-v2-server`, commit `a1981b7` (diff `a1981b7^..a1981b7`, log loại trừ). Căn cứ: `pm-s6b-rulings-memo-261004.md` Q1/Q4/Q5, ruling PM `progress.md` 09:30 và 10:20, báo cáo `task-3-s6b-i-report.md`. Đã đọc toàn bộ `operation-native.c`, `operations.ts`, `native.ts` (spawn/run), ba call site của `execute` (`builder.ts:75`, `isolation/workspace.ts:213`, `assistant/render-executor.ts:589`), policy Seatbelt render (`render-executor.ts:429-437`) và test mới. Không chạy lại suite. Có chạy một probe nhỏ ở scratchpad (không đụng repo) trên máy này (macOS 26.6.2, 25G83): `sysctl({CTL_KERN,KERN_PROC,KERN_PROC_SESSION,sid})` → `ENOENT`; `getsid(zombie)` → `-1/ESRCH`. Hai khẳng định nền của implementer đúng.

### Spec Compliance

| Yêu cầu | Kết quả |
|---|---|
| Verb mới `execute-tree` trong `operation-native.c` | ✅ `:314` |
| `execute` cũ giữ nguyên hành vi (C) | ✅ Đã diff từng nhánh: `setpgid(0,0)` giữ nguyên (`:175`, toán tử ba ngôi đúng ưu tiên); nhánh `member_event` (`:208`) không bao giờ chạy khi chỉ leader được arm; kill timeout chỉ thêm khi `as_tree` (`:218`); receipt `treeEmpty = !forked` và `extra=""` cho bytes receipt y hệt; không có `.leader`. Test 5 khóa lại. |
| Leader `setsid()` | ✅ `:175` |
| `.leader` = pid + start-time, O_EXCL/O_NOFOLLOW/0600, fsync file + stage, trước khi mở gate | ✅ `:193-201`; fd mở sau `fork` nên không rò vào child. ⚠️ nằm trong vùng child ghi được — xem I3. |
| Liệt kê session mỗi tick, ghi `maxSessionSize` | ✅ (thay cơ chế, xem ⚠️1) `:210-215` |
| Timeout kill `-leader` + từng thành viên | ✅ `:218` |
| Leader `NOTE_EXIT`: liệt kê trước `waitpid`, survivors → kill + chờ ≤2 s | ✅ `:220-243` |
| **PASS chỉ khi session rỗng đúng lúc leader thoát; còn gì phải kill → UNKNOWN** | ❌ Vòng drain có bằng chứng session không rỗng sau leader nhưng không hạ phán quyết (I1); nhánh timeout bỏ qua `escaped` (I2). |
| Giới hạn thời gian/output và sandbox giống `execute` | ✅ cùng child env, rlimit 64 MiB, log O_EXCL, quét stage 256 MiB/30.000/128, deadline CLOCK_MONOTONIC; thêm tối đa ~2,1 s drain có chặn. Sandbox là argv của caller, không đổi. |
| `OwnedOperations.executeTree` | ✅ `operations.ts:144-159`; luật so sánh `=== true`/`=== 0` nên receipt thiếu field → fail-closed. |
| Exit 20 → `EXECUTOR_BUSY`, không giữ stage | ✅ `operations.ts:182`; guard kiểm ở `operation-native.c:262` trước `dir_at`, trước fork và mọi ghi stage. ⚠️4, M5. |
| `ExecutionReceipt` additive, `formatVersion` 1 | ✅ |
| Docs flow (R2/R3) | ✅ `gateway-workflows.md` bước 9 + bảng Files, `flows.yaml`, `files.md` |

⚠️ Lệch cần PM/phase03-owner xác nhận:

1. **`KERN_PROC_SESSION` → `KERN_PROC_ALL` + `getsid()==leader`.** Chấp nhận: đã probe lại, sysctl session trả ENOENT; `getsid` là truy vấn kernel trực tiếp trên tiến trình hiện tại nên ngữ nghĩa "thành viên session" giữ đúng. Một pid trong snapshot bị tái dùng trước `getsid` chỉ được tính khi tiến trình mới thật sự ở trong session của ta, nên không gây đếm nhầm ra ngoài.
2. **Zombie không được đếm** (memo đòi đếm). Chấp nhận: zombie không chạy code, không ghi stage. Cha của zombie hoặc còn trong session (bị đếm), hoặc đã `setsid` đi (bị đếm `escaped` nếu đã watch), hoặc là leader (đã chết, launchd reap). Không mở đường PASS sai.
3. **Timeout tree trả receipt khi `treeEmpty` dù `sessionEmptyAtExit=false`.** Nhất quán với Q4 ("stage `timedOut` trong tree mode đã chứng minh session rỗng → reclaim ngay"). "PASS chỉ khi rỗng lúc leader thoát" là luật chứng minh closure của một lần chạy thành công. Ở timeout, chính helper SIGKILL cả session trước khi leader chết, và `timedOut=true` vẫn là HALT với caller (`builder.ts:96`). Receipt ở đây chỉ chứng nhận lifetime đã biết, không chứng nhận thành công. **Điều kiện:** phải loại `escaped>0` (I2). Có lỗi đó thì receipt timeout có thể che hậu duệ của một thành viên đã rời session.
4. **BUSY: stage không bị giữ** chỉ đúng ở tầng operations. `isolation/workspace.ts:229-235` vẫn ghi `state:'unknown'` khi `execute` ném `EXECUTOR_BUSY` (trước đây là `EXECUTOR_RECEIPT_MISSING`; hành vi giữ stage không đổi, chỉ đổi chuỗi lỗi). `render-executor.ts:603-609` ánh xạ BUSY thành `RENDER_OPERATION_UNAVAILABLE` và giữ stage. Cả hai thuộc S6b-ii. Không có consumer nào so khớp chuỗi `EXECUTOR_RECEIPT_MISSING` ngoài FakeOperations trong test.
5. **Theo dõi `NOTE_EXIT` từng thành viên** (memo không có). Chấp nhận và cần có: chỉ đếm session thì không phân biệt được "đã thoát" với "đã `setsid` rời đi".

### Security trace

- **Chọn đích kill.** `kill(-child)` an toàn: leader chưa bị reap trong suốt quá trình theo dõi (`waitpid` ở `:244` nằm sau mọi kill), nên pgid/sid = pid leader không thể bị cấp cho tiến trình khác. Kill theo pid (`:218`, `:238-239`) có TOCTOU giữa liệt kê và `kill`. Ở `:218` cửa sổ còn kéo dài qua cả một lần quét `tree()` của stage (tới 30.000 entry). Tác động bị chặn bởi hai điều: `kill` không đặc quyền chỉ trúng tiến trình cùng uid, và XNU cấp pid tuần tự tới 99.999 nên muốn tái dùng phải quay vòng pid trong vài ms. Rủi ro thấp nhưng không phải "never" (M2).
- **Leader pid reuse.** `.leader` mang start-time (`p_starttime` từ `KERN_PROC_PID`, kiểm `p_pid==child` và `size`) nên reconcile phân biệt được pid tái dùng. Nhưng file nằm trong stage, mà child ghi được stage (`render.sb` `allow file-write* (subpath stage)`; ngay cả `execute` thì cwd/HOME/TMPDIR cũng ở trong stage). Bằng chứng reconcile vì vậy nằm trong vùng do tiến trình không tin cậy kiểm soát (I3).
- **Liệt kê.** `KERN_PROC_ALL` với buffer dư 25% + 16 entry, retry ENOMEM 4 lần, `realloc` tăng dần, đếm theo `size` trả về. Không thấy overflow thực tế. Session >256 hoặc liệt kê lỗi → exit 32, không receipt (fail-closed).
- **Watch.** `EV_ADD|EV_ONESHOT NOTE_EXIT` với `udata`=index, rồi kiểm lại `getsid` sau khi arm. `member_event` đối chiếu `members[index-1].pid==ident`, nên knote cũ của index đã tái dùng bị bỏ qua. ESRCH được coi là đã thoát; lỗi khác → `untracked` → `escaped+1` và `drained=0`. Fail-closed.
- **fd vào child.** Child đóng mọi fd ≥3 trước `execve` (`:179`), kể cả guard (lock vẫn do parent giữ). `.leader` và `proc_table` tạo sau fork. Không rò.
- **Đặc quyền.** `getsid` đọc được tiến trình khác uid. `kill` chỉ trúng cùng uid. Không giả định root.
- **Phán quyết.** Nhánh thường: `survivors==0` với một lần xác nhận lại, chờ 100 ms cho exit đang bay trước khi kết luận `escaped`. Đúng hướng fail-closed, trừ I1/I2.
- **Đường lỗi.** Các đường `return 32/35` ở chế độ tree (`:207`, `:212`, `:217`, `:227`, `:231`) chỉ kill `child` hoặc `-child`. Thành viên ở process group riêng hoặc đã rời session không bị kill. Phán quyết vẫn fail-closed (không receipt) nhưng tiến trình rò (M1).
- **Signal/reentrancy.** Helper không cài handler. EINTR ở vòng chính và `waitpid` đã xử lý. Không có vấn đề reentrancy.
- **Đồng hồ.** CLOCK_MONOTONIC, độ phân giải giây (deadline và drain 2 s thực tế rơi vào khoảng 1–2 s). Như `execute` cũ, chấp nhận.
- **Exit 20.** Cũng trả cho lỗi toàn vẹn guard (symlink, sai mode/uid/nlink, `openat` lỗi), không chỉ "bận". Vẫn an toàn vì không có gì chạy, nhưng nhãn BUSY sai nghĩa (M5).

### Phase03-owner verdict

**Chấp nhận transfer về hình dạng, chưa chấp nhận bytes hiện tại.** Verb `execute` cũ giữ nguyên ngữ nghĩa ở C (đã diff). Thay đổi TS duy nhất với installer/workspace là chuỗi lỗi exit 20, không consumer nào phụ thuộc. Helper build lại do hash source đổi là đúng. Regression installer có test 5 và nhóm 48/48 của implementer. Cơ chế `KERN_PROC_ALL`+`getsid` và watch `NOTE_EXIT` từng thành viên được phép thay cho `KERN_PROC_SESSION`. Phase03 yêu cầu sửa I1 và I2 trong `operation-native.c`/`operations.ts` trước khi S6b-ii gọi `executeTree`. I3 phải sửa trước khi bất kỳ reconcile nào (Q4) đọc `.leader`, tốt nhất ngay trong lát này vì nó đổi vị trí file mà ABI ghi.

### Strengths

- Leader không bị reap tới cuối nên `kill(-leader)` không thể trúng nhóm lạ. Lý do này được ghi rõ trong comment và docs.
- Kiểm lại `getsid` sau khi arm watch, cộng với đối chiếu `udata`/`ident`, chặn được watch dính vào pid tái dùng.
- Mọi điểm không chứng minh được (`untracked`, liệt kê lỗi, session >256, drain quá 2 s) đều dẫn tới UNKNOWN hoặc không có receipt.
- RED có nghĩa: 5/6 fail đúng lý do trước khi có verb. Test escape mô phỏng đúng `setsid` sau khi đã bị quan sát.

### Issues

**Critical:** không có.

**Important**

- **I1 — `operation-native.c:232-241` (phán quyết tính ở `:224-230`).** Vòng drain có thể thấy `remaining>0` (hoặc thành viên đã watch còn sống) trong khi `survivors==0 && escaped==0`, rồi kill, chờ rỗng và ghi `sessionEmptyAtExit=true, survivors=0, treeEmpty=true`. Kết quả là `executeTree` PASS. **Vì sao:** sau khi leader chết, tiến trình mới chỉ có thể sinh từ thành viên đã tồn tại lúc leader thoát. Một tiến trình thấy được trong drain vì vậy là bằng chứng trực tiếp rằng session không rỗng lúc leader thoát: hai lần liệt kê đã bị chuỗi fork→exit vượt qua (snapshot `KERN_PROC_ALL` rồi `getsid` không nguyên tử, member fork con rồi thoát giữa hai bước, lặp hai lần). Code có bằng chứng mà không dùng, vi phạm luật "còn gì phải kill → LIFETIME_UNKNOWN". **Sửa:** khi `!timed`, lần lặp drain nào thấy `remaining>0 || alive>0` thì ép `survivors=max(survivors,remaining,1)` (hoặc cờ `drainKilled` làm `sessionEmptyAtExit=false`) trước khi ghi receipt. Thêm test chuỗi fork nhanh, chấp nhận dạng xác suất hoặc chỉ khẳng định bất biến "drain đã kill ⇒ không PASS".
- **I2 — `operations.ts:152-156`.** Nhánh `timedOut===true` bỏ qua `escaped`. Ở timeout, thành viên đã watch mà `setsid` rời đi sẽ bị kill và chờ thoát (`alive==0`), nhưng con nó sinh **sau khi** rời session thì không thuộc session và không được watch. Receipt khi đó `treeEmpty=true`, `executeTree` trả receipt "lifetime đã biết", Q4 reclaim stage ngay trong khi hậu duệ vẫn còn chạy. Cùng tình huống mà không timeout thì đã ra UNKNOWN. **Sửa:** `treeEmpty===true && escaped===0 && (timedOut===true || (sessionEmptyAtExit===true && survivors===0))`. Thêm test timeout + escape.
- **I3 — `operation-native.c:193-201`; vùng ghi `render-executor.ts:436`.** `.leader` nằm trong stage mà child (cùng uid, Seatbelt cho ghi `subpath stage`) sửa/xoá/thay được. Reconcile sau crash (Q4: "`.leader` pid không còn và session rỗng → giải tỏa") có thể bị lừa bằng một pid giả đã chết, dẫn tới reclaim stage và gỡ chặn `RENDER_RECONCILE_REQUIRED` trong khi session thật vẫn chạy và có thể ghi `{projectRoot}/_bmad/render`. **Sửa:** ghi bản leader vào `receipts/` (fd `receipts` đã mở và đã kiểm identity ở `:165`, sandbox render không cho ghi), ví dụ `receipts/{id}.leader` O_EXCL/0600 + fsync file và thư mục. Nếu giữ bản trong stage thì chỉ để chẩn đoán, và reconcile S6b-ii chỉ tin bản ngoài stage.

**Minor**

- **M1 — `operation-native.c:207,212,217,227,231`.** Đường lỗi ở chế độ tree chỉ kill `child`/`-child`. Thành viên ở pgid riêng, thành viên đã rời session và thành viên trong `session_pids`/`members` cuối cùng đều không bị kill trước `return`. **Sửa:** gom một hàm `kill_tracked()` (kill `-child`, `child`, mọi `session_pids` lần liệt kê thành công cuối và mọi `members` chưa `exited`) và gọi ở mọi đường lỗi sau gate.
- **M2 — `operation-native.c:218,238-239`.** Kill theo pid không kiểm lại danh tính ngay trước `kill`. Ở `:218` danh sách đã cũ qua cả một lần quét `tree()`. **Sửa:** với `session_pids` thì kiểm `getsid(pid)==child` ngay trước `kill`; với nhánh timeout thì liệt kê lại sau quét hoặc đưa kill lên trước quét. Thu hẹp cửa sổ; phần dư còn lại đã ghi trong docs.
- **M3 — `operation-native.c:137`.** Thành viên chỉ được arm `NOTE_EXIT`. Fork của cháu không đánh thức vòng lặp, nên cửa sổ "rời session trước lần quan sát đầu" lên tới 1 s cho mọi đời sau con trực tiếp của leader. **Sửa:** arm `NOTE_FORK|NOTE_EXIT` (thêm `EV_CLEAR`, bỏ `EV_ONESHOT` hoặc giữ ONESHOT riêng cho EXIT) để mỗi fork trong cây kích hoạt liệt kê ngay. Thu hẹp phần dư từ khoảng giây xuống khoảng micro-giây.
- **M4 — `operation-native.c:112,136`.** Trần 256 của `members` là tích lũy cả đời lần chạy (không bao giờ thu hồi slot đã `exited`). Lệnh sinh hơn 256 tiến trình ngắn trong vòng đời sẽ luôn ra UNKNOWN. Với `uv`→Python thì ổn. **Sửa:** ghi trần này trong docs bước 9, hoặc tái dùng slot đã `exited`.
- **M5 — `operation-native.c:262`; `operations.ts:180-182`.** Exit 20 gộp "guard đang bị giữ" với "guard sai loại/mode/uid/nlink/symlink/openat lỗi", và tất cả đều thành `EXECUTOR_BUSY`. Vẫn an toàn (không có gì chạy) nhưng che một tín hiệu toàn vẹn. **Sửa:** tối thiểu sửa comment TS và docs ("guard không lấy được"). Tách mã exit chỉ khi phase03 chấp nhận đổi ABI cho mọi verb.
- **M6 — `gateway/test/workflow-operations-tree.test.ts`.** Thiếu test cho: exit 36 (`.leader` không ghi được), timeout + escape (I2), drain thấy thành viên khi phán quyết là rỗng (I1), session >256 → exit 32. Đồng bộ dựa trên `sleep` có biên rộng (2 s/4 s, tick 1 s) nên ổn định; test timeout 1 s có deadline độ phân giải giây (bắn sau 0–1 s) nhưng không làm sai khẳng định.

### Assessment

**Task quality:** Needs fixes

Sửa I1 và I2 (vài dòng trong C và TS, kèm test), chuyển `.leader` ra `receipts/` (I3), rồi re-review có trọng tâm trên diff sửa. Không cần chạy lại toàn suite ngoài `workflow-operations-tree.test.ts` + `workflow-operations.test.ts` + `workflow-registry.test.ts`, vì source C đổi nên helper build lại.

### Unresolved questions

- XNU có giữ pid = sid của session còn thành viên không cấp lại sau khi leader đã bị reap không (khi helper trả UNKNOWN rồi reap leader)? Câu này quyết định reconcile ở S6b-ii có được dùng `getsid(x)==leaderPid` làm bằng chứng sau khi helper đã thoát hay không. Chưa xác minh ở lát này.
