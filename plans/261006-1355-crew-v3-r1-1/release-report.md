# Kết quả chạy thử `upgrade.sh` trên `upstream/master` (RL-2, Task 7)

Thời điểm: 06/10/2026, 14:44:28 đến 14:45:04 (Asia/Ho_Chi_Minh), trên MacBook (`memory_pressure` báo free 65%).

Lệnh:

```bash
bash crew/release/upgrade.sh upstream/master --base crew/r1-1 \
  --worktree <scratchpad>/crew-upgrade/upstream-master
```

**Kết quả: XANH, thoát 0, tổng 36 giây.** Merge không có conflict nào, kể cả `pnpm-lock.yaml`.

- Nhánh gốc: `crew/r1-1` tại `9301533b3`, gồm 7 commit trong khoảng `8f8a0ab7e..crew/r1-1`.
- `upstream/master` đã merge: `f858207161ba29c01c82f4674aef83d91b74480f`. Bước fetch chạy thật; `master` không đổi so với lần diễn tập S6.
- Nhánh tạm `sync/paperclip-upstream-master` có commit merge `34eadfaa4`. Nhánh được giữ cục bộ làm bằng chứng; worktree tạm đã gỡ.

| Bước của `verify.sh` | Kết quả |
|---|---|
| `node crew/release/check-core-hooks.mjs` | `Hook một dòng: 3/5; mục: 7; lỗi: 0`, 4 cảnh báo `chưa có PR upstream` (P1–P4) |
| `node --test crew/release/check-core-hooks.test.mjs` | 9 pass, 0 fail |
| `corepack pnpm install`, `plugin-sdk ensure-build-deps`, `paperclip-runner build:typescript` | Đều thoát 0 |
| Vitest server `src/__tests__/crew-` + `plugin-loader` | 4 file, 16 test đạt |
| Vitest claude-local, gồm hai file test `*.crew.test.ts` và `execute.remote.test.ts` của upstream | 3 file, 19 test đạt (file của upstream có thêm test mới từ `master`) |
| `tsc --noEmit` cho server, claude-local, `@crew/paperclip-plugin` | Cả ba thoát 0 |

So với diễn tập S6 (cùng đích `f85820716`): S6 bị 1 file và 4 hunk conflict trong `execute.remote.test.ts`. Lần này không có conflict, vì test của Crew đã nằm ở file riêng.

Sau khi chạy: `git worktree list` không còn worktree tạm. Nhánh `v3` của fork vẫn là `8f8a0ab7e`. Không push gì.
