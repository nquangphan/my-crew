# Bàn giao Crew v3 — sau R1-1

Viết ngày 07/10/2026 (Asia/Ho_Chi_Minh) cho **Claude Code chạy trên chính Mac mini** làm tiếp. Đọc hết file này trước khi đụng vào máy thật.

## 0. Bạn đang chạy trên Mac mini — đọc trước

- Máy bạn đang chạy **cũng là máy thực thi agent của Paperclip**. Những gì trong mục 3 ghi "trên Mac mini" là ở ngay máy này: chạy lệnh trực tiếp, không cần `ssh -p 2222`. Cổng 2222 là sshd dành cho Paperclip, đừng tắt hay sửa nó.
- **Đừng làm việc trong `~/crew-agents`** (worktree của agent Paperclip, reaper và `crew-mac stop-run` quét thư mục này) và đừng chạy process nền (`nohup`, `setsid`) bên trong đó. Đừng đặt env `PAPERCLIP_RUN_ID` trong phiên của bạn (reaper dọn `claude -p` có biến này).
- Repo Crew **chưa có** trên Mac mini. Lấy về một chỗ ngoài `/Volumes`, `~/Desktop`, `~/Downloads`, ví dụ:
  ```sh
  mkdir -p ~/Documents/projects && cd ~/Documents/projects
  git clone git@github.com:nquangphan/my-crew.git crew && cd crew && git checkout v3
  git clone git@github.com:nquangphan/crew-paperclip.git .worktrees/paperclip-v3
  git -C .worktrees/paperclip-v3 checkout v3
  git -C .worktrees/paperclip-v3 remote add upstream https://github.com/paperclipai/paperclip.git
  corepack pnpm install   # trong repo Crew; fork chỉ install khi cần chạy test của fork
  ```
  GitHub đã đăng nhập sẵn (SSH key và `gh` của tài khoản `nquangphan`). Node 24 ở `/opt/homebrew/bin/node`, có `pnpm`, `corepack`, `gh`.
- Trong tài liệu, đường dẫn `/Users/phannhatquang/Documents/projects/crew` là repo trên MacBook; trên Mac mini dùng chỗ bạn vừa clone. Hook của repo (`.githooks`, `crew-docs`) cài theo `AGENTS.md`.
- **VPS:** Mac mini chưa có alias `nhamoiplatform` mà script vận hành của fork dùng. Thêm vào `~/.ssh/config` của Mac mini trước khi chạy script:
  ```
  Host nhamoiplatform
    HostName 14.225.224.88
    User root
  ```
  Key `~/.ssh/id_rsa` của Mac mini đã được phép vào root (owner chấp nhận). Qua Tailscale thì `root@100.105.105.12`.
- **Script vận hành gắn cứng đường dẫn trên MacBook:** `crew/ops/overlay-source.sh` có `FORK=/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-r1-1` (worktree đó đã gỡ). Trước lần deploy kế tiếp, sửa thành tham số hoặc tính theo vị trí script, trỏ vào fork checkout trên Mac mini. `watch-run.sh` SSH vào Mac mini cổng 2222 — chạy trên chính Mac mini vẫn được nhưng không cần.
- **Tài khoản Claude** trên Mac mini là `congtu.kids` (Max) — dùng chung hạn mức với chính agent Paperclip; từng chạm 96% hạn mức tuần. Kiểm hạn mức trước việc nặng; agent thử dùng haiku.
- **Cổng tải:** phiên làm việc nặng của bạn (install, test) làm tăng load của chính Mac mini; nếu load 1 phút vượt 8 thì run Paperclip sẽ nằm chờ. Đó là đúng thiết kế, không phải lỗi.
- **Không dùng trang theo dõi online, không tạo trang mới** (owner chốt 07/10/2026). Ghi tiến độ vào ledger của plan trong repo.
- Skill điều phối `.agents/skills/tro-ly/` có trong repo; bộ nhớ riêng của Trợ Lý (`.agents/memory/tro-ly/`) không nằm trong repo — tài liệu này thay cho nó.

## 1. Đang ở đâu

- **Hướng:** Crew v3 chạy trên Paperclip gần như nguyên bản ("stock-first"). Spike 06/10 đã chứng minh hướng này; owner chốt **go có điều kiện**. Bằng chứng: [spike-report](../261006-0805-crew-v3-stock-first/spike-report.md).
- **R1-1 (nền và kết nối Mac) đã xong** và đã gộp. Kết quả và việc mang sang R1-2 ở cuối [plan.md](plan.md). Ước lượng tiến độ R1 (v3.0) khoảng 20%: R1-1 xong; còn R1-2 workflow và gate, R1-3 Trợ Lý, R1-4 UI, R1-5 nâng upstream và phát hành (xem [plan stock-first, Phần 2](../261006-0805-crew-v3-stock-first/plan.md)).
- **Việc tiếp theo:** lập plan chi tiết R1-2 (và R1-3) theo cách chia gói ngữ cảnh ở mục 6, bắt đầu bằng 7 việc bắt buộc cuối [plan.md](plan.md). Owner đang cho dừng sau R1-1; hỏi owner trước khi bắt đầu R1-2.

## 2. Code nằm ở đâu

| Repo | Nhánh | Commit | Nội dung Crew v3 |
|---|---|---|---|
| Crew (`/Users/phannhatquang/Documents/projects/crew`, `github.com/nquangphan/my-crew`) | `v3` (đã push) | `dfe917c6` | `apps/crew-mac` (CLI trên Mac), docs flow `mac-setup`/`mac-orphan-reaper`, spec, plan |
| Fork Paperclip (`.worktrees/paperclip-v3`, repo riêng; `origin` = `github.com/nquangphan/crew-paperclip` **public**, `upstream` = `paperclipai/paperclip` MIT) | `v3` (đã push) | `e1c3dd2db` | `server/src/crew/` (hook H1–H3, cổng tải, dừng process), vá P1–P4, `packages/crew-plugin/`, `crew/release/` (`upgrade.sh`, `verify.sh`, `core-hooks.json`), `crew/ops/` (backup, restore, deploy) |

- Gốc của fork là tag `v2026.1001.0` (`8f8a0ab7e`). Danh sách chỗ vá đầy đủ: `crew/release/core-hooks.json` trong fork. Cách kéo upstream về kiểm rồi merge: mục cuối [plan.md](plan.md). Owner chốt **không mở PR upstream**.
- Nhánh cũ còn trong fork để tra cứu (không dùng tiếp): `crew/r1-1`, `crew/rt1-rt2`, `crew/rt3-backup`, `spike/*`, `sync/paperclip-upstream-master`.

## 3. Môi trường đang chạy

**VPS `nhamoiplatform`** (`ssh nhamoiplatform`, root, Ubuntu 24.04, 7,8 GB RAM). Máy này chạy **prod** (crew v1 ở `/opt/crew`, kidy, 2ps-landing sau nginx `2ps-landing-nginx`). Chỉ được đụng:
- `/opt/crew-v3-spike` và compose project `crew-v3-spike` (server Paperclip + `postgres:17`). Server chạy image overlay `crew-v3/paperclip:v3-1b85a07ed`. Deploy dùng script `crew/ops/` của fork (`overlay-source.sh` đóng gói trên máy dev rồi chép lên VPS; `overlay-job.sh`, `deploy.sh`, `rollback.sh` chạy trên VPS; xem `runtime.md` mục RT-4). Bản fork mới hơn (`e1c3dd2db`) chỉ đổi test và fixture, nên không cần deploy lại.
- UI và API: `http://100.105.105.12:3100`, chỉ vào được qua Tailscale. Tài khoản board nằm trong `/opt/crew-v3-spike/.env` (chmod 600). Helper gọi API: `/opt/crew-v3-spike/api.sh`.
- Backup hằng ngày 03:30 bằng systemd timer `crew-v3-spike-backup` (VPS không có cron và rsync). Deploy và rollback bằng script trong `/opt/crew-v3-spike/ops` (bản nguồn ở `crew/ops/` của fork). Không bao giờ dựng image đầy đủ trên VPS (thiếu RAM), chỉ dựng overlay; dừng khi RAM trống dưới 2 GB.
- Ngoại lệ phạm vi đã được owner chấp nhận: `/etc/systemd/system/crew-v3-spike-backup.*` và một dòng `restrict,from="100.102.189.67",command=…` trong `/root/.ssh/authorized_keys` (key kéo backup).

**Mac mini** `phans-mac-mini` (Tailscale `100.102.189.67`, user `phannhatquang`, 10 CPU, 16 GB). Đây là máy chạy agent.
- `crew-mac` cài cố định ở `~/.crew/app/crew-mac` (gói `2f0f5c5d`; cài lại thì đóng gói từ `apps/crew-mac` của repo Crew rồi giải nén đè, chạy `setup` lại — idempotent). Lệnh: `/opt/homebrew/bin/node ~/.crew/app/crew-mac/<cli> setup|doctor|uninstall|reap|stop-run`, launcher `~/.crew/bin/crew-mac`, wrapper `~/.crew/bin/crew-claude-run`.
- LaunchAgent: `com.2p.crew-mac-sshd` (sshd chạy trong phiên desktop, cổng 2222, chỉ nghe IP Tailscale; nhờ vậy Claude Code dùng được login trong Keychain), `com.2p.crew-mac-reaper` (dọn process mồ côi mỗi 60 giây), `com.2p.crew-backup-pull` (kéo backup VPS về `~/crew-backups/vps`).
- Worktree agent: `~/crew-agents/mac-claude` (nhánh `agent/mac-claude-r1` của repo thử `~/crew-spike/repo-a`).
- Tài khoản Claude trên Mac mini là `congtu.kids` (Max), khác tài khoản của MacBook. Owner đồng ý dùng nó cho agent.
- Mac mini phải đang đăng nhập màn hình thì sshd agent mới chạy (khởi động lại thì owner phải đăng nhập lại).
- `doctor` hiện 12/13: mục lỗi là một hộp thoại quyền của app Orca đang chờ, không liên quan agent.

**Paperclip spike:** company "Crew Spike", environment `mac-mini` (SSH cổng 2222, `in_place`, `remoteWorkspacePath` = `~/crew-agents/mac-claude`, `crewLoadGate { maxLoad1: 8, maxWaitMinutes: 60 }`), agent `mac-claude` (`claude_local`, `engine=cli`, `command` = wrapper, `extraArgs ["--setting-sources","project,local"]`, `maxConcurrentRuns 1`, model haiku). Company "Crew Spike Policy" dùng cho thử gate S4.

**MacBook** (`phans-macbook-pro`, Tailscale `100.100.157.19`): máy owner, nơi phiên điều phối trước chạy; có bản repo và các worktree cũ, không cần dùng nữa.

## 4. Quyết định của owner (không tự đổi)

Đủ trong [can-dai-ca-chot.md](../261006-0805-crew-v3-stock-first/can-dai-ca-chot.md) và [sdd-ledger.md](sdd-ledger.md). Những điều dễ vi phạm:
- **Không bao giờ tự gọi model `fable`** (kể cả agent `kongming`). Mạnh nhất được tự dùng là `opus`.
- Không token đăng nhập Claude, không bắt login lại trên máy local: agent dùng login Keychain sẵn có.
- Agent chạy `--setting-sources project,local`; **được** nạp `~/.claude/CLAUDE.md` cá nhân.
- Lõi Paperclip chỉ đổi bằng hook một dòng có registry; ngân sách tối đa 5 **chỉ đếm hook một dòng** (hiện 3). Vá adapter/driver theo dõi riêng trong `core-hooks.json`.
- Repo agent làm việc là git worktree riêng dưới `~/crew-agents`, không bao giờ là checkout của owner.
- Credential AI chỉ nằm trên Mac. Backup trên Mac mini chứa `.env` và key Paperclip, **không cần mã hóa**.
- Key `id_rsa` của Mac mini vào root VPS không giới hạn: **giữ nguyên**, owner chấp nhận rủi ro.
- Push repo Crew được phép sau khi kiểm. Fork đã push, **không mở PR**. Deploy lên VPS ngoài `/opt/crew-v3-spike`, xóa thứ không do mình tạo, sửa `.claude/**`, `AGENTS.md`, `CLAUDE.md` thì phải hỏi owner.
- UI và docs viết tiếng Việt; identifier tiếng Anh; giờ Asia/Ho_Chi_Minh; commit theo Conventional Commits, không nhắc AI.

## 5. Bẫy đã gặp

- **Hộp thoại quyền macOS (TCC):** mỗi lần Claude Code cập nhật bản mới, macOS hỏi lại quyền đọc thư mục bảo vệ (ổ ngoài `/Volumes/CORSAIR`). Nếu chưa ai bấm, `claude` treo im lặng ở 0% CPU và bỏ qua SIGTERM. Kiểm bằng `crew-mac doctor` hoặc `/usr/bin/log` (trong zsh, `log` là lệnh builtin).
- **Bash tool của Claude Code** chạy shell trong process group **và** session riêng; `ps -E` không đọc được biến môi trường của binary Apple. Vì vậy dừng run phải qua `crew-mac stop-run` (cây cha–con cộng worktree), không dừng theo pgid.
- **Claude nạp `<thư mục cha>/.claude/CLAUDE.md`**, nên repo dưới `$HOME` luôn nạp CLAUDE.md của owner.
- **`sessionCodec` của `claude_local`** upstream làm rơi `remoteExecution` (đã vá P3; `codex_local` cũng có lỗi này nhưng chưa vá).
- **Hook `scout-block`** của repo Crew chặn mọi lệnh Bash có chứa các chữ `node_modules`, `dist`, `build`, kể cả trong nội dung heredoc. Đổi cách viết, không sửa hook.
- **Hook R7** (pre-commit) chặn chuỗi giống header private key, kể cả trong test mẫu của plan. Ghép chuỗi lúc chạy, không lách hook.
- **Trước mọi lệnh git ghi trong script:** kiểm `git rev-parse --show-toplevel`. Repo Crew chứa fork Paperclip (repo riêng) trong `.worktrees/`.
- **Tìm code Paperclip theo tên symbol**, không theo số dòng (`heartbeat.ts` khoảng 30 nghìn dòng).

## 6. Cách làm việc owner muốn

- **Chia việc theo gói ngữ cảnh:** vẽ gói (file, symbol, môi trường phải nạp) trước, rồi mới cắt ticket trong gói. Cùng gói thì một worker làm lần lượt (nhắn tiếp, không tạo agent mới); chỉ song song giữa các gói khác nhau và file ghi rời nhau. Reviewer cũng theo gói, không bao giờ review ticket mình làm. Luật đầy đủ ở skill `.agents/skills/tro-ly/references/nhan-viec.md` và `dieu-linh.md`.
- **Quy trình:** Superpowers (`writing-plans`, `subagent-driven-development`, review mỗi ticket, review toàn nhánh cuối bằng `opus`, một đợt sửa). Ghi ledger cho mỗi plan; mọi quyết định tự chốt ghi dạng `Ruling: … — vì … — sai thì …`.
- **Test theo tầng:** implementer chạy test phần mình đổi; reviewer đọc log, không chạy lại suite; full suite chỉ khi phát hành.
- **Báo cáo bằng tiếng Việt, xưng em, gọi owner là Đại Ca**, nói rõ giao việc gì, model nào, tạo mới hay nhắn tiếp.

## 7. Còn treo

- 7 việc bắt buộc đầu R1-2 (cuối [plan.md](plan.md)), quan trọng nhất là: retry sau mất kết nối phải kiểm tiến độ worktree để không commit trùng, và logic thật của hook H2.
- Minor đã hoãn và lý do: [sdd-ledger.md](sdd-ledger.md).
- Owner chưa xử lý: hộp thoại quyền của app Orca trên Mac mini.
- Dọn khi tiện, cần owner đồng ý: các image spike cũ trên VPS (giữ `crew-v3-spike/paperclip:in-place-6ab1aa8` làm đích rollback cho tới khi có bản deploy mới), repo thử `~/crew-spike` trên Mac mini.
