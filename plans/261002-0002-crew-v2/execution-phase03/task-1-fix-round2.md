# Task 1 — sửa re-review vòng 2

**Base:** `fc843d2`. **Kết quả:** Đã sửa N1 trong phạm vi khóa OS của gateway; không đổi wire/API desktop/server. Chưa stage/commit.

## N1 và bằng chứng

`man lockf | col -b` trên macOS xác nhận `lockf` xóa lock file khi command kết thúc nếu thiếu `-k`; `-n` từ chối path không tồn tại thay vì tạo mới. `ProcessLock.acquire` trước sửa dùng `-t 0` nhưng thiếu hai cờ này. Test mới giữ fd inode cũ trong lúc `ProcessLock.release`; RED là `lstat(host.guard)` trả `ENOENT` ngay sau release (exit 1), đúng failure review nêu.

Sửa macOS args thành `lockf -k -n -t 0 host.guard <Node helper>`. `-k` giữ file guard để owner mới và contender đang cầm fd cũ cùng tranh một inode; `-n` fail closed nếu path biến mất sau bước kiểm tra, không tự tạo path thay thế. Không thay `flock` trên Linux, helper stdin pipe, recovery legacy hay kiểm PID/UID/type/inode/lsof.

GREEN targeted `node --test --test-name-pattern='macOS guard retains' v2/gateway/test/host-failures.test.ts`: **1/1 pass**. Test ghi device/inode ban đầu, giữ fd cũ, release owner, xác nhận path còn cùng identity; `/usr/bin/lockf` trên `/dev/fd/3` giữ khóa inode ấy, `ProcessLock` contender bị từ chối, sau khi helper thả khóa thì reacquire thành công trên đúng device/inode. Test recovery host còn kiểm guard giữ device/inode qua `SIGKILL` và reboot.

## Kiểm tra và phạm vi

- `pnpm --dir v2/gateway test`: **14/14 pass**, gồm F1/F2/F3 cũ và N1 mới.
- `pnpm --dir v2/gateway typecheck`: exit 0.
- `pnpm exec biome check v2/gateway/src/host/process-lock.ts v2/gateway/test/host-failures.test.ts`: exit 0, không còn fix.
- `git diff --check --` ba file sở hữu: exit 0.
- Không chạy lại desktop: chỉ cờ macOS OS-lock và test/flow gateway đổi; không đổi IPC, preload, Electron hoặc API công khai. Bằng chứng desktop Electron thật 5/5 ở vòng trước vẫn áp dụng cho contract ấy.

Chỉ sửa `v2/gateway/src/host/process-lock.ts`, `v2/gateway/test/host-failures.test.ts`, `v2/docs/flows/gateway-host.md` (R3) và report này. Test dùng root `mkdtemp('crew-v2-lockf-inode-')`, helper/fd riêng, cleanup trong `t.after`; kiểm `ps` cuối không còn process mang tiền tố fixture gateway/lockf. Không dùng owner LaunchAgent, DB, model, global config, không sửa server/planner và không stage/commit.

Giới hạn đã nêu ở vòng trước giữ nguyên: legacy resource có owner sống/metadata hoặc handle không chứng minh được vẫn từ chối recovery, không xóa mù theo timeout; same-UID process chủ động thay file trong thư mục riêng nằm ngoài bằng chứng singleton này.
