# Process, container và thay đổi môi trường của spike stock-first

Mọi thứ đang bật hoặc đã thêm cho spike, kèm cách tắt/gỡ. Cập nhật mỗi khi bật hoặc tắt. Không ghi credential ở đây.

## VPS `nhamoiplatform` (`crew-v3-spike-vps`, Tailscale 100.105.105.12)

| Thứ | Chi tiết | Bật lúc | Trạng thái | Cách tắt/gỡ |
|---|---|---|---|---|
| Compose project `crew-v3-spike` | `/opt/crew-v3-spike/docker-compose.yml` | 06/10/2026 09:52 (S1) | đang chạy | `cd /opt/crew-v3-spike && docker compose down` |
| Container `crew-v3-spike-server-1` | từ 11:30 chạy image overlay `crew-v3-spike/paperclip:in-place-5f28832` (trước đó `ghcr.io/paperclipai/paperclip:2026.1001.0`), cổng `100.105.105.12:3100`, `restart: unless-stopped`, `mem_limit 2g` | 09:52 (S1), tạo lại 11:30 | đang chạy | như trên; quay về upstream: `cp docker-compose.yml.bak-upstream docker-compose.yml && docker compose up -d --no-deps server` |
| Container `crew-v3-spike-db-1` | image `postgres:17-alpine`, không publish cổng ra host | 09:52 (S1) | đang chạy | như trên |
| Network `crew-v3-spike_default` | bridge do compose tạo | 09:52 (S1) | có | tự xoá khi `docker compose down` |
| Image đã pull | `ghcr.io/paperclipai/paperclip:2026.1001.0` (khoảng 1,9 GB), `postgres:17-alpine` | 09:50 (S1) | có | sau khi down: `docker image rm ghcr.io/paperclipai/paperclip:2026.1001.0` (chỉ xoá `postgres:17-alpine` nếu không stack nào khác dùng) |
| Thư mục dữ liệu | `/opt/crew-v3-spike` gồm `.env`, `.board-cookies`, `api.sh`, `ssh/` (key Paperclip, known_hosts), `data/pgdata`, `data/paperclip` | 09:53 (S1) | có | sau khi down: `rm -rf /opt/crew-v3-spike` |

| Image overlay `crew-v3-spike/paperclip:in-place-6ab1aa8` | overlay có thêm vá session codec | 12:28 | đang dùng (từ 12:29) | sau khi down: `docker image rm crew-v3-spike/paperclip:in-place-6ab1aa8` |
| Image overlay `crew-v3-spike/paperclip:s5-gate-acfa0cf` | S5: `in-place-6ab1aa8` cộng hook H1 (`crewBeforeClaim`) | 13:13 (S5) | không dùng; chạy 13:14 đến 13:28 rồi quay về `in-place-6ab1aa8` | sau khi down: `docker image rm crew-v3-spike/paperclip:s5-gate-acfa0cf` |
| File S5 trên VPS | `data/paperclip/crew-load-gate.json` (gate đang tắt), `docker-compose.yml.bak-6ab1aa8`, `s5-issue.sh`, `s5-gate.sh`, `s5-active.sh`, `s5-leases.sh`, `s5-verify.sh`, `imgsrc/s5-overlay.sh`, `imgsrc/src-acfa0cf`, `imgsrc/overlay-acfa0cf.tar` | 13:13 (S5) | có | xoá cùng thư mục spike |
| Image overlay `crew-v3-spike/paperclip:in-place-5f28832` | ID `3ee720e6dee7`, hai layer khoảng 450 kB trên image upstream | 11:29 | không dùng từ 12:29 | sau khi down: `docker image rm crew-v3-spike/paperclip:in-place-5f28832` |
| Backup DB | `/opt/crew-v3-spike/backups/paperclip-before-overlay-20261006-1130.dump`, `paperclip-before-6ab1aa8-20261006-1229.dump` (chmod 600) | 11:30, 12:29 | có | xoá cùng thư mục spike |
| Nguồn dựng image | `/opt/crew-v3-spike/imgsrc/` gồm `paperclip-5f28832.tar.gz`, `src/` (git archive của `5f28832b2`), `image-job.sh`, `image-job.log`, `ram.log` | 11:14 (S2 chạy lại) | job đã dừng (watchdog RAM), không còn process | `rm -rf /opt/crew-v3-spike/imgsrc` |
| Build cache Docker của job dựng image | khoảng 12 GB (đĩa trống giảm từ 22 GB còn 9,5 GB) | 11:15 đến 11:27 | còn | cần owner quyết; lệnh prune build cache ảnh hưởng mọi stack |

Stack `crew` v1 (`/opt/crew`), `kidy-*`, `2ps-landing*` không bị đụng.

## Mac mini `phans-mac-mini` (Tailscale 100.102.189.67, user `phannhatquang`)

| Thứ | Chi tiết | Ai tạo | Cách gỡ |
|---|---|---|---|
| `~/.zshenv` | đưa `claude` vào PATH cho phiên SSH không tương tác; vẫn cần cho cả cổng 22 lẫn cổng 2222 | Trợ Lý, trước S1 | xoá file (hoặc dòng đã thêm) nếu trước đó chưa có `~/.zshenv` |
| Dòng key trong `~/.ssh/authorized_keys` | public key ed25519, comment `crew-v3-spike-paperclip` | S1, 09:55 | `sed -i '' '/crew-v3-spike-paperclip/d' ~/.ssh/authorized_keys` |
| LaunchAgent `com.2p.crew-spike-sshd` | sshd riêng chạy trong phiên desktop (Aqua) để mở được Keychain; plist `~/Library/LaunchAgents/com.2p.crew-spike-sshd.plist`, config và host key ở `~/.crew-spike-sshd/`, nghe `100.102.189.67:2222`. Environment `mac-mini` của Paperclip dùng cổng này từ S2. | Trợ Lý, sau S1 | `launchctl bootout gui/$(id -u)/com.2p.crew-spike-sshd`, rồi `rm ~/Library/LaunchAgents/com.2p.crew-spike-sshd.plist` và `rm -rf ~/.crew-spike-sshd` |
| Cổng 22 (Remote Login của macOS) | giữ nguyên, không gỡ | có sẵn | không đụng |
| `~/crew-spike/workspaces/` | do probe environment của Paperclip tự `mkdir -p` (`remoteWorkspacePath`); chứa thư mục run `.paperclip-runtime/runs/d93b6ada-006e-4f48-a5ca-20723666e774/` còn sót sau khi hủy run S2 | S1 09:56, S2 10:42 | `rm -rf ~/crew-spike` khi xong spike |
| `~/crew-spike/repo-a/` | repo thử của S2 (commit `b66cd7c`, `owner-wip.txt` chưa commit); `.git/info/exclude` có thêm dòng `.paperclip-runtime/` | S2 10:41, exclude 11:15 | như trên |
| `.paperclip-runtime/` trong worktree | skills, mcp-config (có Bearer token), bridge do adapter sync ở chế độ `in_place`; bị ignore qua `info/exclude` | 11:40 | còn | xoá cùng worktree |
| Worktree `~/crew-spike/worktrees/mac-claude` | nhánh `agent/mac-claude` của repo-a, có commit `a59fe54` của agent (CRE-3) | S2 chạy lại, 11:15 | `git -C ~/crew-spike/repo-a worktree remove ~/crew-spike/worktrees/mac-claude && git -C ~/crew-spike/repo-a branch -D agent/mac-claude` |
| Transcript session agent (in_place) | `~/.claude/projects/-Users-phannhatquang-crew-spike-worktrees-mac-claude/` (CRE-3) | S2 lần 2, 12:16 | xoá thư mục đó khi xong spike |
| Transcript session agent | `~/.claude/projects/-Users-phannhatquang-crew-spike-workspaces--paperclip-runtime-runs-*` (agent dùng chung `~/.claude` của user) | S2, 10:43 | xoá các thư mục có tiền tố đó khi xong spike |

Process nền trên Mac mini: run `517bc63e-...` (CRE-2) hủy lúc 11:44:07, process `claude` mồ côi PID 56978 và ba process mồ côi của test adapter (45303, 46376, 47346) đã bị SIGKILL; run S2 `d93b6ada-...` đã hủy lúc 10:54:54; process `claude` mồ côi (PID 24200) đã bị dừng bằng `kill -KILL` lúc 10:57. Không còn process nào của company `Crew Spike` đang chạy. Các process trong `~/crew-spike/policy-workspaces` thuộc gói `policy`, không do gói này bật.

## Đối tượng Paperclip của gói `moi-truong` (company `5befeb1a-1578-4656-b913-267494592e53`)

| Thứ | ID | Trạng thái |
|---|---|---|
| Issue `CRE-1` | `cd554a7b-1ceb-435f-a320-598510a02ded` | `cancelled` (run đã hủy) |
| Issue `CRE-2` | `a112f19b-12a9-4897-b948-9b3751712d76` | `cancelled` (run `517bc63e-46f5-4832-b0e1-65062ea7386f` đã hủy) |
| Issue `CRE-5` đến `CRE-8` | S3: CRE-5 `blocked`, CRE-6 `done`, CRE-7 `done`, CRE-8 `in_progress` (kẹt sau cancel, giữ làm bằng chứng) | các run đã kết thúc |
| Issue `CRE-9` đến `CRE-11` | S5: CRE-9 `done` (quá tải giả), CRE-10 `done` (offline có H1), CRE-11 `blocked` (offline không H1, giữ làm bằng chứng) | các run đã kết thúc |
| Issue `CRE-4` | `b0b5a406-b974-42ac-9475-2f1123a668a8` (kiểm resume S2c) | `done` (4 run đều `succeeded`) |
| Issue `CRE-3` | `37f89126-3aa6-4bff-ae13-c347464b2622` | `done` (run `8acaa48d-f782-493e-b442-3492f26734bc` `succeeded`) |
| Run | `d93b6ada-006e-4f48-a5ca-20723666e774` | `cancelled` |

Script S3 trên VPS: `/opt/crew-v3-spike/s3-issue.sh`, `/opt/crew-v3-spike/s3-tsdown.sh`, log `s3-tailscale.log` (Tailscale đã bật lại, IP `100.105.105.12`). Agent `mac-claude` đang dùng model `claude-haiku-4-5` từ S3.

Helper trên VPS thêm ở S2: `/opt/crew-v3-spike/runs.sh` (xem run và trạng thái của một issue), gỡ cùng thư mục.

## MacBook (S2b)

| Thứ | Chi tiết | Cách gỡ |
|---|---|---|
| Git worktree của fork | `/private/tmp/claude-501/-Users-phannhatquang-Documents-projects-crew/e36ddeb9-c3da-46d0-8e2e-7a956c6cf953/scratchpad/paperclip-in-place`, nhánh `spike/claude-in-place` (commit `5f28832b2`), có `node_modules` riêng | `git -C .worktrees/paperclip-v3 worktree remove --force <đường dẫn trên>` rồi `git -C .worktrees/paperclip-v3 branch -D spike/claude-in-place` (chỉ khi không cần nhánh nữa) |
| Git worktree S5 | `/private/tmp/claude-501/-Users-phannhatquang-Documents-projects-crew/e36ddeb9-c3da-46d0-8e2e-7a956c6cf953/scratchpad/paperclip-s5`, nhánh `spike/s5-load-gate` (commit `acfa0cffa`), không có `node_modules` | `git -C .worktrees/paperclip-v3 worktree remove --force <đường dẫn trên>` rồi `git -C .worktrees/paperclip-v3 branch -D spike/s5-load-gate` |

Không có process nền nào chạy lâu trên MacBook; các lần chạy vitest và tsc đã kết thúc.
