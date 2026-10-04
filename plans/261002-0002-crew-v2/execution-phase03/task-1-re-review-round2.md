# Task1 — re-review vòng sửa 2

**READY: Yes cho Task1 local gateway/desktop shell. N1 addressed; approve scoped fix.** Không còn finding trong phần sửa N1. Kết luận không chứng nhận server/journal/workflow/runtime hoặc quyền dịch vụ nền ở các task/phase sau.

## Phạm vi

Candidate `14a0f7f..a42e0a7`, đúng ba file: `v2/gateway/src/host/process-lock.ts`, `v2/gateway/test/host-failures.test.ts`, `v2/docs/flows/gateway-host.md`. Đọc `task-1-fix-round2.md` và diff; chỉ kiểm N1 guard inode, regression trực tiếp và side effect của sửa đổi. Giữ kết luận F1/F3/legacy residue ở lượt trước, không mở lại hoặc review broad Task1/server/desktop.

## N1 và correspondence nguồn/test

- **Nguồn:** macOS args tại `process-lock.ts:39` đổi thành `lockf -k -n -t 0` trên guard đã tạo/kiểm chứng. `-k` giữ file sau helper exit, loại bỏ split giữa inode cũ bị unlink và path mới; `-n` từ chối path mất sau bước kiểm tra, không để utility tự tạo lại. Linux args, helper pipe, release/acquisition/error lifecycle và legacy recovery không đổi.
- **Regression trực tiếp:** test mới `macOS guard retains one inode across release and old-fd contender ordering` thực hiện đúng lịch reviewer đã tái hiện: giữ fd guard cũ, release owner, kiểm path/dev/inode còn nguyên; holder `/dev/fd/3` chiếm chính inode đó, ProcessLock contender bị từ chối; sau holder exit thì reacquire thành công và vẫn cùng dev/inode. Đây là cùng race fixture của N1, nên không cần reviewer chạy lại.
- **Crash/reboot:** test residue cũ bổ sung assertion dev/inode guard giữ nguyên trước crash, sau SIGKILL và sau host reboot. Guard tồn tại không có nghĩa khóa còn giữ; holder/OS lock tiếp tục quyết định quyền sở hữu.
- **Docs:** gateway flow nói rõ `lockf -k -n`, guard ổn định qua stop/crash/reacquire và test fd cũ. Mô tả mới khớp nguồn/test, giữ cấu trúc bảy mục. Không thêm source/test mới nên không cần manifest mapping mới cho vòng này.

## Verification và changed-contract regression

Chấp nhận bằng chứng worker/controller đã cung cấp:

- Targeted N1 regression **1/1 pass**, sau RED `ENOENT` trước sửa.
- Gateway suite **14/14 pass**, typecheck exit0, Biome hai file sạch, diff check ba file sạch.
- Nested/root docs checks qua.
- Không đổi API/IPC/preload/Electron/DTO hoặc truth unconfigured; bằng chứng desktop Electron thật **5/5** trước đó vẫn áp dụng. Không cần desktop/server repeat cho diff cờ lockf + assertions/docs này.

Không phát hiện regression mới do thay đổi cờ: guard đã được tạo riêng tư trước utility, `-n` phù hợp thứ tự hiện tại; `-k` giữ cùng inode thay vì đổi quyền/token/socket. Legacy PID/UID/type/inode/open-handle checks và các hạn chế đã công bố giữ nguyên. Không suy diễn khả năng chống thao túng chủ động same-UID từ regression ordering này.

Reviewer không tạo fixture/process/label, không rerun suite, không install, sửa source, stage/commit, spawn subagent, gọi model hoặc tác động shared/owner services. Chỉ tạo báo cáo này; không có tài nguyên reviewer cần cleanup.

**Kết luận:** N1 đã đóng bằng fix hẹp và regression đúng failure. F1/F3 và residue cũ của F2 giữ trạng thái addressed. Task1 sẵn sàng dùng làm dependency local cho task tiếp theo trong phạm vi PM đã duyệt.
