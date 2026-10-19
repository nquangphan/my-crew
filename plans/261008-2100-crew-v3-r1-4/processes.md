# Process R1-4

| Việc | Lệnh / PID | Cổng | Worktree | Bắt đầu | Trạng thái | Cách dừng |
|---|---|---|---|---|---|---|
| UI-1 | `codex exec -m gpt-6-sol` (task nền của Trợ Lý) | — | `.worktrees/paperclip-r14-plugin` | 08/10 21:15 | đang chạy | chờ kết thúc |
| MC-1 | `codex exec -m gpt-6-sol` (task nền của Trợ Lý) | — | `.worktrees/crew-r14-mac` | 08/10 21:15 | đang chạy | chờ kết thúc |
| UI-1 | — | — | `.worktrees/paperclip-r14-plugin` | 08/10 21:15 | đã xong 21:33 | — |
| MC-1 | — | — | `.worktrees/crew-r14-mac` | 08/10 21:15 | đã xong 21:26 | — |
| MC-2 | `codex exec -m gpt-6-sol` | — | `.worktrees/crew-r14-mac` | 08/10 21:27 | đang chạy | chờ kết thúc |
| UI-2 | `codex exec -m gpt-6-sol` | — | `.worktrees/paperclip-r14-plugin` | 08/10 21:41 | đang chạy | chờ kết thúc |
| UI-3 | `codex exec -m gpt-6-sol` | — | `.worktrees/paperclip-r14-docs` | 08/10 21:41 | đang chạy | chờ kết thúc |
| UI-4 | `codex exec -m gpt-6-sol` | — | `.worktrees/paperclip-r14-machines` | 08/10 21:41 | đang chạy | chờ kết thúc |
| status job (launchd) | com.2p.crew-mac-status | — | Mac | 08/10 22:24 | TẠM DỪNG 22:35 (bootout) vì probe TCC chậm; bật lại sau bản sửa | `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.2p.crew-mac-status.plist` |
| status job (launchd) | com.2p.crew-mac-status | — | Mac | 08/10 22:57 bật lại | ĐANG CHẠY (tính năng, giữ) | `launchctl bootout gui/$UID/com.2p.crew-mac-status` |
| Codex | — | — | — | — | không còn phiên nào | — |
