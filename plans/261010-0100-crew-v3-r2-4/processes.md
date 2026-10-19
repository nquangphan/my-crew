# Process, thư mục tạm và bản ghi tạm của R2-4

Mỗi dòng gồm:
- thời điểm (`date`);
- ticket;
- thứ đã tạo (lệnh/PID/cổng/worktree/thư mục/id bản ghi prod);
- cách dừng hoặc gỡ;
- trạng thái: `đang chạy` | `đã gỡ` | `giữ: <lý do>`.

Không để dòng `đang chạy` khi ticket đã xong.

| Thời điểm | Ticket | Thứ đã tạo | Cách dừng/gỡ | Trạng thái |
|---|---|---|---|---|
| 2026-10-10 12:43 | SP-C | thư mục `~/crew-r24-probe/` (HOME/CODEX_HOME tạm, symlink `auth.json`, fixture ps) | `trash ~/crew-r24-probe` | đã gỡ (13:25, trash) |
| 2026-10-10 14:38 | RV-1 | worktree `.worktrees/paperclip-r24-rv` (detached crew/r24) và `.worktrees/crew-r24-rv` (detached r24) cho full suite | `git worktree remove` (để Trợ Lý gỡ) | giữ: Trợ Lý gỡ sau RV-1 |
| 2026-10-10 15:23 | DP-1 | worktree `.worktrees/paperclip-r3-dp` chuyển sang detached `826a49ea6` (crew/r24), có node_modules | giữ cho DP sau; `git checkout --detach <commit>` | giữ: worktree DP dùng chung |
| 2026-10-10 15:23 | DP-1 | worktree `.worktrees/crew-r3-dp2` chuyển sang detached `b76059f` (r24), có node_modules + bản build app | giữ cho DP sau | giữ: worktree build app dùng chung |
| 2026-10-10 15:23 | DP-1 | bản lui app `~/crew-r24-app-prev/2P Crew.app` (= r3x b827114); bundle cũ `~/.Trash/2P Crew-dpx2-dp1r24-1513.app` | `trash ~/crew-r24-app-prev` khi R2-4 chốt | giữ: bản lui |
| 2026-10-10 15:23 | DP-1 | bản lui crew-mac `~/.crew/app/crew-mac.bak-dp1-r24` (cli.js c9d08373…) và `crew-mac.prev` | `trash` khi R2-4 chốt | giữ: bản lui |
| 2026-10-10 15:23 | DP-1 | VPS `/opt/crew-v3-spike/ops.bak-dp1-r24/`, `ops/overlay-826a49ea6.tar.gz`, `ops/deploy-826a49ea6.log`; backup DB 20261010-1509, -1511, -1516 | để nguyên (như các DP trước) | giữ: mốc lui |
| 2026-10-10 15:23 | DP-1 | prod TPS: dòng crew_project_roles repo-a (280cf1de); agent 62d450f3 repo-a-executor-codex, 38a28c7d repo-a-reviewer-codex; environment 07f2fb67, c9996efa; setup run 7438779f, c21e8ace; job máy fb2cefe1 (runtimes-setup); checkout ~/crew-agents/repo-a/{executor,reviewer}-codex | dùng cho AC-C | giữ: dữ liệu R2-4 |
| 2026-10-10 15:23 | DP-1 | không có process nền (verify, build, Playwright đều đã thoát); file phiên đăng nhập scratchpad đã xóa | — | đã gỡ |
| 2026-10-10 16:03 | DP-2 | worktree `.worktrees/paperclip-r3-dp` chuyển sang detached `8fdd145c3` (crew/r24, tag cục bộ `crew/v3.3-rc3`) | giữ cho DP sau; `git checkout --detach <commit>` | giữ: worktree DP dùng chung |
| 2026-10-10 16:03 | DP-2 | VPS `/opt/crew-v3-spike/ops.bak-dp2-r24/`, `ops/overlay-8fdd145c3.tar.gz`, `ops/overlay-8fdd145c3.log`, `ops/deploy-8fdd145c3.log`, image `crew-v3/paperclip:v3-8fdd145c3`; backup DB 20261010-1558, -1559 | để nguyên (như các DP trước) | giữ: mốc lui |
| 2026-10-10 16:03 | DP-2 | không có process nền (verify, overlay, Playwright đều đã thoát); file phiên đăng nhập `state-dp2.json` tự xóa khi script xong | — | đã gỡ |
| 2026-10-10 16:27 | DP-3 | worktree `.worktrees/paperclip-r3-dp` detached `d3ab1ef78` (tag cục bộ `crew/v3.3-rc4`); worktree `.worktrees/crew-r3-dp2` detached `23670d7` (build @crew/mac) | giữ cho DP sau | giữ: worktree DP dùng chung |
| 2026-10-10 16:27 | DP-3 | VPS `ops.bak-dp3-r24/`, `ops/*.bak-dp3-r24` (3 script), `ops/overlay-d3ab1ef78.{tar.gz,log}`, `ops/deploy-d3ab1ef78.log`, image `v3-d3ab1ef78`; backup DB 20261010-1614, -1615 | để nguyên | giữ: mốc lui |
| 2026-10-10 16:27 | DP-3 | Mac `~/.crew/app/crew-mac.bak-dp3-r24` (b76059f) + `crew-mac.prev` | `trash` khi R2-4 chốt | giữ: bản lui |
| 2026-10-10 16:27 | DP-3 | không có process nền (verify, overlay, Playwright, monitor đã thoát); không lưu state đăng nhập | — | đã gỡ |
| 2026-10-10 17:20 | AC-C | prod TPS: issue TPS-103…TPS-109 (103/105/108 cancelled, 104/106/107/109 done); environment 07f2fb67, c9996efa đổi secret sang TPS fa7b4847; agent 62d450f3, 38a28c7d thêm adapterConfig.engine=cli; nhánh local crew/TPS-104, crew/TPS-107 (mac-claude), crew/tps-109 (mac-claude-2), crew/TPS-106 (repo-a/executor-codex), chưa push; ~/.crew/runtimes/codex/{62d450f3,38a28c7d}/ (CODEX_HOME agent); backup DB 20261010-1632 | để nguyên | giữ: dữ liệu nghiệm thu |
| 2026-10-10 17:20 | AC-C | không còn process nền (monitor, Playwright đã thoát); script ở scratchpad acc/, không lưu state đăng nhập | — | đã gỡ |
