# Process R2-1

Mọi process nền, lịch chạy và thay đổi môi trường của R2-1, kèm cách tắt hoặc gỡ. Cập nhật mỗi khi bật hoặc tắt. Không ghi credential.

| Việc | Lệnh / PID | Cổng | Worktree / thư mục | Bắt đầu | Trạng thái | Cách dừng |
|---|---|---|---|---|---|---|
| SP-1 app spike `2P Crew Spike.app` (mở bằng `open`) | PID 21600, mở lại 37276 (12:15), 38248 (12:16) | — | `~/crew-r21-spike/` | 09/10 12:07 | đã tắt 12:16 (TERM/kill -9 theo S3) | menu tray "Thoát" hoặc `osascript -e 'quit app "2P Crew Spike"'` |
| SP-1 sshd spike (con của app) | `/usr/sbin/sshd -D -f ~/crew-r21-spike/sshd_config` PID 21677, 37291, 38273 | 127.0.0.1:22999 | `~/crew-r21-spike/` | 09/10 12:07 | đã tắt 12:18, cổng 22999 trống | `pkill -f "$HOME/crew-r21-spike/sshd_config"` |
| SP-1 phiên `ssh … sleep` (S1, S3a–c) và probe `claude -p` (giới hạn 120 s) | qua cổng 22999 | 127.0.0.1:22999 | `~/crew-r21-spike/` | 09/10 12:08 | tự kết thúc 12:17:40; không còn `sshd-session`/`claude -p` | — |
| SP-1 thư mục spike `~/crew-r21-spike/` (giữ cho S1b/S2b/S4 chờ owner) và hộp thoại TCC ổ rời của `com.2p-solutions.crew.spike` đang chờ bấm | — | — | `~/crew-r21-spike/` | 09/10 12:03 | giữ, không process nào chạy | bước 5 mục "Còn chờ owner" của `spike-report.md` |
| AP-2 kiểm bộ giám sát với sshd thật (vitest tạm `test/zz-real-sshd.local.test.ts`, đã xóa, không commit), HOME tạm `mktemp -d` trong scratchpad, host key/config tạm | sshd PID 82551 → 82559 → 82615 → 82683 (lần chạy 2; lần 1 12:52:22–12:52:27 tương tự) | 127.0.0.1:22998 | `.worktrees/crew-r21-runtime` | 09/10 12:52 | đã tắt 12:52:38 (`stopForQuit`), `lsof -iTCP:22998` rỗng, `pgrep -f realsshd` rỗng; không đụng 2222/PID 16059 | — |
