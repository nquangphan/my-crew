# Spike gói `moi-truong`

> **Ghi chú bàn giao (06/10/2026, 12:38, trước S3).** Trạng thái hiện tại để worker sau tiếp tục:
> - Server spike: `/opt/crew-v3-spike` trên VPS, image overlay `crew-v3-spike/paperclip:in-place-6ab1aa8` (upstream `2026.1001.0` cộng 4 chỗ vá trên nhánh `spike/claude-in-place`, commit `6ab1aa8c6`). UI `http://100.105.105.12:3100`. Helper: `api.sh` (gọi API bằng cookie board), `runs.sh <issueId>`, `runlog.sh <runId>`. Rollback về upstream: `docker-compose.yml.bak-upstream`.
> - Company `Crew Spike` `5befeb1a-...`, project `280cf1de-...`, environment `mac-mini` `f92f5dd8-...` (SSH cổng 2222 qua sshd trong phiên Aqua, `in_place`, `remoteWorkspacePath = ~/crew-spike/worktrees/mac-claude`), agent `mac-claude` `37a9e834-...` (`engine cli`, `claude-sonnet-4-6`, `maxConcurrentRuns 1`, `extraArgs --setting-sources project,local`).
> - Worktree fork: `/private/tmp/claude-501/-Users-phannhatquang-Documents-projects-crew/e36ddeb9-c3da-46d0-8e2e-7a956c6cf953/scratchpad/paperclip-in-place`. Dựng overlay: `s2c-upload.sh <commit>` trong scratchpad, rồi `/opt/crew-v3-spike/imgsrc/overlay-job.sh <commit> <tag>` trên VPS.
> - Kết quả: S1 đạt, S2 đạt (với vá `in_place`), S2c đạt. Tiếp theo là S3. Không đụng company của gói `policy`.

Kết quả các ticket S1, S2, S3, S5 của [plan.md](plan.md). Mỗi mục ghi lệnh đã chạy, kết quả, bằng chứng và kết luận. Không có token, mật khẩu hay private key nào trong file này; credential nằm ở `/opt/crew-v3-spike/.env` và `/opt/crew-v3-spike/ssh/` trên VPS (chmod 600/700).

## S1: Dựng Paperclip stock và nối Mac mini làm SSH environment

Thời điểm: 06/10/2026, 09:50 đến 09:57 (Asia/Ho_Chi_Minh).

**Kết luận: ĐẠT** cho phạm vi S1 (server stock chạy trên VPS, chỉ mở qua Tailscale, SSH environment trỏ Mac mini, probe environment pass, agent `claude_local` gắn environment đó). **Có một vấn đề chặn S2**: Claude Code trên Mac mini chưa dùng được trong phiên SSH vì login nằm trong macOS Keychain, xem mục "Vấn đề còn mở".

### Phiên bản và nguồn

- Paperclip: image dựng sẵn của upstream `ghcr.io/paperclipai/paperclip:2026.1001.0`, digest `sha256:08dbadebd4d40550eb336c25c3691f582322a88bae3f1cca101c5dd096bdc9d3`. Label `org.opencontainers.image.revision` = `8f8a0ab7effbd6a0584107d8038736c134ee5047`, đúng commit pin của fork; biến `PAPERCLIP_BUILD_VERSION=v2026.1001.0-0-g8f8a0ab7e`. `/api/health` trả `"commit":"8f8a0ab7effbd6a0584107d8038736c134ee5047"`.
- Cách đưa source lên VPS: không cần. Vì upstream có image đúng tag (workflow `.github/workflows/docker.yml` đẩy tag semver `2026.1001.0` cho mỗi tag `v*`), không clone, không `git archive`, không build trên VPS. Không sửa code Paperclip.
- Database: container `postgres:17-alpine` riêng trong cùng compose project (giống `docker/docker-compose.yml` của upstream), không publish cổng ra host. Lý do chọn DB ngoài thay cho embedded PostgreSQL: S3 cần restart server mà DB vẫn sống.
- Mac mini: macOS 26.6.2, Claude Code `2.1.289`, `claude` ở `/Users/phannhatquang/.local/bin/claude`.

### Bố trí trên VPS (`nhamoiplatform`)

- Thư mục: `/opt/crew-v3-spike` gồm `docker-compose.yml`, `.env` (chmod 600: `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`, `PAPERCLIP_BOARD_EMAIL`, `PAPERCLIP_BOARD_PASSWORD`), `.board-cookies` (chmod 600, session cookie của board admin dùng cho API), `api.sh` (helper gọi API bằng cookie đó), `ssh/` (chmod 700: key Paperclip và `known_hosts` của Mac mini), `data/pgdata`, `data/paperclip`.
- Compose project `crew-v3-spike`, hai container `crew-v3-spike-server-1`, `crew-v3-spike-db-1`, network `crew-v3-spike_default`. Không dùng named volume (bind mount trong `data/`).
- Server: `PAPERCLIP_DEPLOYMENT_MODE=authenticated`, `PAPERCLIP_DEPLOYMENT_EXPOSURE=private`, `PAPERCLIP_PUBLIC_URL=http://100.105.105.12:3100`, `mem_limit: 2g`, `pids_limit: 2048`.
- Cổng: `100.105.105.12:3100` (chỉ IP Tailscale). Không đụng nginx, không gắn domain.

Lệnh chính:

```bash
docker pull ghcr.io/paperclipai/paperclip:2026.1001.0
docker image inspect ghcr.io/paperclipai/paperclip:2026.1001.0 --format '{{json .Config.Labels}}'
cd /opt/crew-v3-spike && docker compose config --quiet && docker compose up -d
```

### Kiểm mạng

| Kiểm | Lệnh | Kết quả |
|---|---|---|
| Health qua Tailscale từ MacBook | `curl http://100.105.105.12:3100/api/health` | `status: ok`, `deploymentMode: authenticated`, `deploymentExposure: private` |
| UI qua Tailscale từ MacBook | `curl -o /dev/null -w '%{http_code}' http://100.105.105.12:3100/` | `200` |
| Cổng không mở ra Internet | `curl http://14.225.224.88:3100/` từ MacBook | không kết nối được (`000`) |
| Socket đang nghe | `ss -ltn \| grep 3100` trên VPS | chỉ `100.105.105.12:3100` |
| Mac mini gọi ngược về Paperclip | `curl http://100.105.105.12:3100/api/health` trên Mac mini | `status: ok` |
| Container tới Mac mini | `ssh` từ trong `crew-v3-spike-server-1` tới `100.102.189.67:22` | tới được sshd (bị từ chối user giả, đúng kỳ vọng) |

### Tài khoản board

Instance `authenticated/private` mới ở trạng thái `bootstrap_pending`. Đã dùng đường claim qua trình duyệt của upstream (`doc/DOCKER.md`, route `POST /api/bootstrap/claim`) bằng API: `POST /api/auth/sign-up/email` rồi `POST /api/bootstrap/claim`. Kết quả `{"claimed":true}`, health chuyển `bootstrapStatus: ready`. User admin ID `Mtye1JcS4JUc3lTZj51hI7nfz1pqMPSI`, email và mật khẩu nằm trong `/opt/crew-v3-spike/.env`. Không dùng `paperclipai auth bootstrap-ceo` vì lệnh đó cần file config mà image Docker không tạo.

### SSH key của Paperclip

```bash
# trên VPS
ssh-keygen -q -t ed25519 -N "" -C crew-v3-spike-paperclip -f /opt/crew-v3-spike/ssh/paperclip_ed25519
ssh-keyscan -T 10 -t ed25519 100.102.189.67 > /opt/crew-v3-spike/ssh/known_hosts
# public key được thêm vào ~/.ssh/authorized_keys của phannhatquang trên Mac mini (comment crew-v3-spike-paperclip)
ssh -i ssh/paperclip_ed25519 -o UserKnownHostsFile=ssh/known_hosts -o StrictHostKeyChecking=yes \
  phannhatquang@100.102.189.67 'echo ok && which claude && claude --version'
```

Kết quả: `ok`, `/Users/phannhatquang/.local/bin/claude`, `2.1.289 (Claude Code)`.

### Đối tượng tạo qua API

| Đối tượng | ID | Ghi chú |
|---|---|---|
| Company `Crew Spike` | `5befeb1a-1578-4656-b913-267494592e53` | issue prefix `CRE` |
| Project `Spike Mac` | `280cf1de-ea80-465f-b42d-869ed9d044f8` | chưa gắn workspace, S2 sẽ quyết `in_place` |
| Environment `mac-mini` (driver `ssh`) | `f92f5dd8-fd34-47df-95a8-6adb87e49ec8` | host `100.102.189.67`, user `phannhatquang`, `remoteWorkspacePath=/Users/phannhatquang/crew-spike/workspaces`, `strictHostKeyChecking=true`, `knownHosts` có sẵn. Private key gửi một lần trong body, Paperclip tự lưu thành secret `fa7b4847-3a92-4651-86e2-bb0d11e69f65`, config chỉ còn `privateKeySecretRef`. |
| Agent `mac-claude` (`claude_local`) | `37a9e834-6aaf-4970-8f89-95dbc8a019f2` | `defaultEnvironmentId` = environment trên, `adapterConfig.engine = "cli"` |

### Probe

1. Probe environment, `POST /api/environments/f92f5dd8-fd34-47df-95a8-6adb87e49ec8/probe`:

   ```json
   {"ok":true,"driver":"ssh","summary":"Connected to phannhatquang@100.102.189.67 and verified the remote workspace path.","details":{"remoteCwd":"/Users/phannhatquang/crew-spike/workspaces"}}
   ```

   **Pass.** Lưu ý: probe chạy `mkdir -p` cho `remoteWorkspacePath` (`ensureSshWorkspaceReady` trong `packages/adapter-utils/src/ssh.ts`), nên `~/crew-spike/workspaces` trên Mac mini đã được tạo ở S1 thay vì S2.

2. Test adapter, `POST /api/companies/<company>/adapters/claude_local/test-environment`:
   - Lần 1 với agent mặc định: `fail`, mã `adapter_engine_unavailable`: "Claude ACP supports sandbox remote targets only; this run targets a non-sandbox remote environment ... explicitly set engine=cli". Engine mặc định của `claude_local` ở bản này là ACP và không chạy được trên SSH environment. Sửa bằng cấu hình (`adapterConfig.engine = "cli"`), không vá code.
   - Lần 2 với `engine=cli`: `warn`. Các check `claude_environment_target` (đang probe trong `mac-mini`), `claude_cwd_valid`, `claude_command_resolvable` đều đạt; check `claude_hello_probe_auth_required` báo "Claude CLI is installed, but login is required."

### Vấn đề còn mở (chặn S2)

Nguyên nhân đã kiểm: Claude Code trên macOS lưu login trong login Keychain (mục `Claude Code-credentials` có tồn tại). Trong phiên SSH không tương tác, Keychain không mở được (`security show-keychain-info` trả "User interaction is not allowed"), nên `claude auth status` qua SSH trả `loggedIn: false` (cả với key của Paperclip lẫn key của MacBook). File `~/.claude/.credentials.json` chỉ chứa trạng thái MCP OAuth, không có login Claude. Phiên GUI trên Mac mini vẫn đăng nhập bình thường.

Lệnh SSH của adapter chạy qua shell đăng nhập của user (zsh đọc `~/.zshenv`), nên cách sửa giữ credential trên Mac, không vá Paperclip và không đưa token lên VPS:

1. Trên Mac mini, trong Terminal của phiên GUI: `claude setup-token` (đăng nhập bằng trình duyệt, ra token dài hạn).
2. Lưu token vào một file chmod 600 trên Mac mini, ví dụ `~/.config/crew-spike/claude-oauth.env` chứa `export CLAUDE_CODE_OAUTH_TOKEN=...`, và thêm một dòng `[ -f ~/.config/crew-spike/claude-oauth.env ] && . ~/.config/crew-spike/claude-oauth.env` vào `~/.zshenv`.
3. Chạy lại test adapter; kỳ vọng `claude_hello_probe_auth_required` biến mất.

Việc này cần Đại Ca (đăng nhập trình duyệt, và sửa Mac mini ngoài phạm vi worker được phép). Không dùng cách Paperclip lưu Claude OAuth token phía server (`applyStoredClaudeLogin`/`storedSessionId`) vì trái Global Constraint "credential AI chỉ nằm trên Mac".

### Ghi chú khác

- Banner khởi động báo `Agent JWT missing`. Mã `server/src/agent-auth-jwt.ts` dùng `BETTER_AUTH_SECRET` khi không có `PAPERCLIP_AGENT_JWT_SECRET`, nên JWT của agent vẫn ký được; banner chỉ cảnh báo. Theo dõi ở S2 khi agent gọi API.
- Image upstream cài sẵn Claude Code CLI trong container server (cho `claude_local` chạy local). Không có login nào trong container; S2 Step 5 sẽ kiểm credential trên VPS.
- Health báo `database_backup_missing` lúc vừa khởi động; Paperclip tự backup mỗi 60 phút vào `/paperclip/instances/default/data/backups` (tức `data/paperclip/instances/default/data/backups` trên VPS).
- RAM VPS sau khi bật: server khoảng 800 MiB, DB khoảng 100 MiB; `free -m` còn khoảng 5,5 GB available. Stack v1 không bị đụng.
- Ảnh chụp UI chưa làm (plan Step 5 có nhắc); UI trả 200 và đăng nhập được bằng tài khoản trong `.env`.

### Cập nhật sau S1 (06/10/2026, 10:40)

Blocker đăng nhập đã được Trợ Lý giải mà không dùng token: một sshd riêng chạy trong phiên desktop (Aqua) của Mac mini, nghe ở `100.102.189.67:2222` (LaunchAgent `com.2p.crew-spike-sshd`). Process vào qua cổng này cùng security session với desktop nên đọc được Keychain. Đã đổi environment `mac-mini` sang `port: 2222`, `knownHosts` là dòng `[100.102.189.67]:2222 ssh-ed25519 ...` (quét lại bằng `ssh-keyscan -p 2222`, đối chiếu khớp với dòng hash Trợ Lý đã ghi trong `/opt/crew-v3-spike/ssh/known_hosts`). Probe lại: `ok:true`, `port 2222`. Test adapter `claude_local` cho agent `mac-claude`: `status: pass`, có `claude_hello_probe_passed`, không còn cảnh báo login.

## S2: Issue thật chạy trên repo của Mac mini

Thời điểm: 06/10/2026, 10:40 đến 10:57 (Asia/Ho_Chi_Minh).

**Kết luận Step 2: (c).** Với stock `v2026.1001.0`, SSH environment kết hợp adapter `claude_local` không có cách nào chạy `in_place` trên repo của Mac mà không vá lõi (adapter `claude_local` là code upstream). Theo chỉ dẫn, dừng S2 ở đây và báo owner. Ngoài ra run thật bị treo, xem Step 3.

### Step 1: Repo thử

```bash
# trên Mac mini (qua cổng 22, key của MacBook)
mkdir -p ~/crew-spike/repo-a && cd ~/crew-spike/repo-a && git init -q -b main
printf '# repo-a\n\nRepo thử cho spike Crew v3.\n' > README.md && git add README.md
git -c user.name="Crew Spike Owner" -c user.email="owner@crew-spike.invalid" commit -q -m "chore: khởi tạo repo thử"
printf 'ghi chu dang lam cua owner, chua commit\n' > owner-wip.txt
```

Trạng thái ban đầu: commit `b66cd7c`, `?? owner-wip.txt`, `shasum owner-wip.txt` = `bb7154e75be057a4fa993651dd86a95060ef2da7`.

### Step 2: Bật `in_place` được không (đọc code fork, commit pin)

1. Chế độ realization được quyết trong `buildWorkspaceRealizationRecord` (`server/src/services/workspace-realization.ts`): `mode = in_place` chỉ khi `lease.metadata.workspaceRealization.mode` hoặc `providerMetadata` của driver ghi `in_place`, ngược lại là `copy`.
2. Driver SSH dựng sẵn (`acquireRunLease` và `realizeWorkspace` của driver `ssh` trong `server/src/services/environment-runtime.ts`) tạo metadata lease cố định trong code: `host`, `port`, `username`, `remoteWorkspacePath`, `remoteCwd`, `executionWorkspaceMode`. Không có trường `workspaceRealization`, không đọc gì từ config hay `metadata` của environment. Vì vậy **(a) không làm được**: không có ô UI/API nào của environment hay project workspace đổi được chế độ này.
3. **(b) không đủ.** Một plugin environment driver có thể trả `providerMetadata.workspaceRealization.mode = "in_place"` cùng `authoritativeRoot`; khi đó `environment-run-orchestrator.ts` chỉ đổi `executionTarget.remoteCwd` thành `authoritativeRoot`. Nhưng adapter `claude_local` không đọc `workspaceRealization` (chỉ `codex_local` có xử lý `in_place`, ở `packages/adapters/codex-local/src/server/execute.ts` và `acp.ts`). `claude_local` (`packages/adapters/claude-local/src/server/execute.ts`) luôn gọi `prepareAdapterExecutionTargetRuntime` mà không truyền `syncWorkspace: false`:
   - Với transport `ssh` (`prepareRemoteManagedRuntime` trong `packages/adapter-utils/src/remote-managed-runtime.ts`): upload thư mục workspace phía server (VPS) lên `<remoteCwd>/.paperclip-runtime/runs/<runId>/workspace`, chạy Claude ở đó, cuối run sync ngược về VPS.
   - Với transport `sandbox` (đường của plugin): stage workspace của VPS thẳng vào `remoteCwd`. Nếu `remoteCwd` là repo thật thì đây là đường ghi đè repo của owner, rủi ro đúng Review Focus 3.
4. Vì vậy **(c)**: muốn `claude_local` làm việc trực tiếp trên repo của Mac theo đúng nghĩa realization `in_place` thì phải sửa adapter `claude_local` (làm giống `codex_local`: khi `workspaceRealization.mode === "in_place"` thì dùng `authoritativeRoot` làm cwd và không sync workspace), cộng thêm driver/plugin trả metadata `in_place`. Đây là patch trong code upstream, không phải hook một dòng.

Bằng chứng thực tế khớp với code: run của S2 chạy với cwd `/Users/phannhatquang/crew-spike/workspaces/.paperclip-runtime/runs/d93b6ada-006e-4f48-a5ca-20723666e774/workspace`, thư mục này chỉ có `.paperclip-runtime/` (bản copy của agent home rỗng trên VPS, vì project chưa có workspace).

Hướng đi không cần vá để owner cân nhắc (chưa kiểm được trọn vẹn vì Step 3 treo): agent chạy trên Mac với `--dangerously-skip-permissions` dưới user của Mac và không bị giới hạn filesystem khi target là remote, nên issue có thể chỉ đường dẫn tuyệt đối của repo để agent `cd` vào và sửa trực tiếp. Cách này đạt mục tiêu "repo nằm trên Mac" nhưng Paperclip không biết repo đó: không có workspace tracking, diff hay khoá chống hai run cùng sửa một repo, và an toàn của file chưa commit hoàn toàn dựa vào agent tuân lời. Đây không phải `in_place` của upstream.

### Step 3: Issue thật

- Agent `mac-claude`: đặt `adapterConfig.model = "claude-sonnet-4-6"` (model rẻ, task đồ chơi), `engine = "cli"`.
- Issue `CRE-1`, ID `cd554a7b-1ceb-435f-a320-598510a02ded`, project `Spike Mac`, giao `mac-claude`. Mô tả chỉ đường dẫn tuyệt đối `/Users/phannhatquang/crew-spike/repo-a`, yêu cầu thêm dòng `hello from crew` vào README.md, commit riêng README.md, không đụng `owner-wip.txt`.
- Run `d93b6ada-006e-4f48-a5ca-20723666e774` (wake `issue_assigned`), bắt đầu 10:42:57. Trên Mac mini thấy `paperclip-bridge-server.mjs` và `claude --print --output-format stream-json --verbose --dangerously-skip-permissions --model claude-sonnet-4-6 ...` chạy trong thư mục run ở trên.
- **Run treo.** Log run dừng ở 10:43:07 sau khi agent gọi tool `Skill` với `skill: "paperclip"`. Transcript của session `4559002d-ff94-482b-aa2a-776e621889fd` trên Mac mini không ghi thêm gì sau 10:43. Process `claude` không có process con, CPU 0%, các kết nối tới API Anthropic đều `CLOSED`, ống stdout tới sshd vẫn mở. 12 phút không tiến triển, repo-a không đổi.
- Chưa tìm ra nguyên nhân và đã dừng điều tra theo giới hạn S2. Những điểm đáng ngờ đã thấy: process `claude` của agent dùng chung `~/.claude` của user trên Mac mini, nên nạp `~/.claude/CLAUDE.md` riêng của user (agent mở đầu bằng "Em sẽ thực hiện ngay nhiệm vụ này cho Đại Ca."), 12 plugin và hook ở 14 sự kiện (`PreToolUse`, `PermissionRequest`, `UserPromptSubmit`, ...) trong `~/.claude/settings.json`. Một run của gói `policy` (model haiku, thư mục `~/crew-spike/policy-workspaces`) cũng đang chạy hơn 12 phút cùng lúc đó; tôi không đụng vào run đó.
- Log stream của run có `rate_limit_event`: `seven_day utilization 0.96` (`allowed_warning`). Tài khoản Claude trên Mac mini đã dùng 96% hạn mức 7 ngày; các bước sau dễ bị chặn vì rate limit.

### Hủy run và dọn process (dữ liệu sớm cho S3)

- 10:54:54 `POST /api/heartbeat-runs/d93b6ada-.../cancel`: run chuyển `cancelled` (`errorCode: cancelled`). Issue `CRE-1` vẫn ở `in_progress`.
- Trên Mac mini: `paperclip-bridge-server.mjs` dừng, phiên sshd đóng, nhưng process `claude` (PID 24200) **thành mồ côi** (PPID chuyển thành 1) và vẫn sống sau hơn 80 giây. `kill -TERM` không làm nó dừng trong 15 giây; phải `kill -KILL`. Đây là bằng chứng cho Review Focus 1 (process mồ côi trên Mac sau khi hủy), S3 cần đo lại có hệ thống.
- Thư mục run `~/crew-spike/workspaces/.paperclip-runtime/runs/d93b6ada-.../` vẫn còn trên Mac mini (không được dọn).

### Step 4: Kiểm trên Mac mini

```bash
cd ~/crew-spike/repo-a && git log --oneline -3 && git status --short && shasum owner-wip.txt
```

Sau khi hủy: chỉ có `b66cd7c chore: khởi tạo repo thử`, `?? owner-wip.txt`, shasum `bb7154e75be057a4fa993651dd86a95060ef2da7` (không đổi). Không có commit của agent vì run treo. `owner-wip.txt` còn nguyên.

### Step 5: Credential trên VPS

| Kiểm | Lệnh | Kết quả |
|---|---|---|
| Biến môi trường của container server | `docker compose exec -T server sh -c 'env \| cut -d= -f1 \| grep -E "ANTHROPIC\|CLAUDE\|OPENAI\|GEMINI"'` | chỉ có `GEMINI_SANDBOX` (cờ của image, không phải credential) |
| Biến môi trường của process Node server (đọc từ host bằng root, `/proc/<pid>/environ` của hai PID trong cgroup của container) | `tr '\0' '\n' < /proc/<pid>/environ \| cut -d= -f1 \| grep -E "ANTHROPIC\|CLAUDE"` | không có `ANTHROPIC_*`, không có `CLAUDE_CODE_OAUTH_TOKEN` |
| File credential trong container | `find / -xdev \( -name .credentials.json -o -name .claude.json -o -name auth.json \)` | không có; `/paperclip/.claude` không tồn tại |
| File credential trong thư mục dữ liệu trên host | `find /opt/crew-v3-spike/data \( -name .credentials.json -o -name .claude.json \)`; `grep -rIl "sk-ant-" /opt/crew-v3-spike/data/paperclip` | không có |

Kết luận Step 5: **đạt**. Login Claude chỉ nằm trên Mac mini. Lưu ý: vì agent dùng `~/.claude` của user, transcript của các run agent được ghi vào `~/.claude/projects/` của user trên Mac mini.

### Step 6: Kết luận S2

- `in_place` theo đúng nghĩa của upstream cho `claude_local` qua SSH: **(c), không làm được nếu không vá lõi** (adapter `claude_local` cộng driver hoặc plugin trả metadata `in_place`). Mặc định là `copy` vào thư mục run trên Mac, sync từ và về VPS.
- Run thật: **không đạt**, agent treo sau lần gọi Skill đầu tiên, chưa rõ nguyên nhân.
- Credential: **đạt**.
- `owner-wip.txt`: không bị đụng, nhưng chưa kiểm được trong một run thành công.
- Hủy run: run đổi trạng thái đúng nhưng để lại process `claude` mồ côi trên Mac, phải dùng SIGKILL.

Theo plan và chỉ dẫn của Trợ Lý: dừng ở đây, chờ owner quyết.

## S2b: Vá `in_place` cho `claude_local` trên SSH environment

Thời điểm: 06/10/2026, 11:00 đến 11:08 (Asia/Ho_Chi_Minh). Bản vá được Đại Ca duyệt sau kết luận (c) của S2. Làm theo TDD, chỉ trong adapter và driver, không đụng `heartbeat.ts` hay `issues.ts`.

**Kết luận: xong bước a và b, dừng ở bước c như chỉ dẫn.** Chưa build image, chưa restart server trên VPS.

### a) Worktree

```bash
cd /Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-v3
git worktree add -b spike/claude-in-place \
  /private/tmp/claude-501/-Users-phannhatquang-Documents-projects-crew/e36ddeb9-c3da-46d0-8e2e-7a956c6cf953/scratchpad/paperclip-in-place \
  8f8a0ab7effbd6a0584107d8038736c134ee5047
git rev-parse --show-toplevel   # đúng thư mục worktree trên, kiểm lại trước lệnh commit
```

Nhánh `v3` của fork vẫn ở `8f8a0ab7e`, không push.

### b) Test trước, vá sau

Cài phụ thuộc một lần: `memory_pressure` trước khi cài báo 69% bộ nhớ trống (máy 24 GB). `corepack pnpm install --frozen-lockfile --prefer-offline` mất 11,4 giây, peak RSS khoảng 1,45 GB, sau khi cài còn 68% trống.

Test hỏng trước:

1. `packages/adapters/claude-local/src/server/execute.remote.test.ts`, test mới "runs in place at the authoritative root without workspace upload or restore": target SSH có `workspaceRealization.mode = "in_place"`, `authoritativeRoot = "/app"`. Kỳ vọng: không gọi `prepareWorkspaceForSshExecution` (upload workspace), không gọi `restoreWorkspaceFromSshExecution`; skills và mcp-config vẫn sync vào `/app/.paperclip-runtime/claude/...`; Claude chạy với `remoteCwd = /app`; `CLAUDE_CONFIG_DIR` lấy từ `adapterConfig.env` đi tới process. Trước khi vá: **hỏng** (`prepareWorkspaceForSshExecution` bị gọi 1 lần).
2. `server/src/__tests__/workspace-realization-ssh-in-place.test.ts` (file mới, 3 test không cần DB): environment SSH không có metadata thì lease giữ `copy`; giá trị lạ (`"mirror"`) bị bỏ qua; metadata `workspaceRealizationMode: "in_place"` thì lease có `workspaceRealization.mode = "in_place"` và `buildWorkspaceRealizationRecord` trả `mode: in_place`, `authoritativeRoot` = `remoteCwd`. Trước khi vá: **hỏng** cả 3 (hàm chưa tồn tại).

Bản vá (commit `ce8c962066161e424c0bee0d6cf0b89683e58b7c` trên nhánh `spike/claude-in-place`, message `feat(environments): run claude_local in place on SSH environments`):

| File | Dòng | Nội dung |
|---|---|---|
| `packages/adapters/claude-local/src/server/execute.ts` | +6 −1 | Khi `executionTarget.workspaceRealization.mode === "in_place"`: truyền `workspaceRemoteDir = authoritativeRoot`, `syncWorkspace: false` vào `prepareAdapterExecutionTargetRuntime`, sửa dòng log. Giống cách `codex_local` đã làm. |
| `server/src/services/workspace-realization.ts` | +13 | Hàm mới `sshLeaseWorkspaceRealization(environment)`: trả `{ workspaceRealization: { mode: "in_place" } }` khi `environment.metadata.workspaceRealizationMode === "in_place"`, ngược lại `{}`. |
| `server/src/services/environment-runtime.ts` | +2 −1 | Import hàm trên và thêm một dòng spread vào metadata lease trong `acquireRunLease` của driver `ssh`. |
| `packages/adapters/claude-local/src/server/execute.remote.test.ts` | +67 | Test 1. |
| `server/src/__tests__/workspace-realization-ssh-in-place.test.ts` | +74 (mới) | Test 2. |

Tổng code không phải test: 3 file, +21 −2. Số chỗ vá lõi: **3** (một khối trong `claude_local/execute.ts`, một hàm mới trong `workspace-realization.ts`, một dòng spread cộng import trong `environment-runtime.ts`). Không có chỗ nào là hook một dòng có registry như Global Constraints mô tả. Không đổi schema config, shared type hay UI.

Cách bật: đặt `metadata.workspaceRealizationMode = "in_place"` cho environment SSH (field `metadata` của environment đã cho sửa qua `PATCH /api/environments/:id` ở bản stock). Thư mục làm việc của agent là `remoteWorkspacePath` của environment, nên trỏ nó vào git worktree riêng của agent trên Mac. Lưu ý: ở `in_place`, runtime asset của adapter (skills, mcp-config, bridge) vẫn được sync vào `<worktree>/.paperclip-runtime/claude/` (giống `codex_local`), nên worktree cần thêm `.paperclip-runtime/` vào `.git/info/exclude`.

`CLAUDE_CONFIG_DIR`: **không cần vá.** Stock đã có `adapterConfig.env`; adapter gộp vào env của process và SSH export từng biến trước lệnh (`export KEY='value';` trong `packages/adapter-utils/src/ssh.ts`). Test 1 kiểm biến này tới được process. Khi đến lúc chạy thật: đặt `adapterConfig.env.CLAUDE_CONFIG_DIR = "/Users/phannhatquang/.crew-agent/claude-config"` cho agent `mac-claude`.

Test đã chạy sau khi vá (chỉ file và package bị đổi, không chạy full suite):

| Lệnh | Kết quả |
|---|---|
| `vitest run src/server/execute.remote.test.ts` (claude-local) | 10/10 pass |
| `vitest run` toàn package `@paperclipai/adapter-claude-local` | 19 file pass, 1 file skip; 300 test pass, 1 skip |
| `pnpm run typecheck` của `@paperclipai/adapter-claude-local` (`tsc --noEmit`) | không lỗi |
| `vitest run` 4 file server: `workspace-realization-ssh-in-place.test.ts`, `environment-run-orchestrator.test.ts`, `environment-runtime.test.ts`, `environment-runtime-driver-contract.test.ts` | 4 file, 112 test pass |
| `tsc --noEmit` của `@paperclipai/server` (sau `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`) | không lỗi; 6 giây, peak RSS khoảng 6,4 GB |

Ghi chú test:

- Script `typecheck` đầy đủ của server chạy `prepare:runner-vendor` trước, bước này build Rust runner và hỏng trên MacBook vì không có `cargo`. Tôi chạy thẳng `tsc --noEmit` của server thay cho script đó.
- Test SSH thật trong `environment-runtime.test.ts` ("acquires and releases an SSH run lease through the runtime seam") dùng sshd fixture của env-lab, mặc định tắt trên macOS, nên test đó chỉ in cảnh báo rồi return. Đường SSH thật sẽ được kiểm khi deploy lên VPS.
- `memory_pressure` sau các lần chạy vẫn khoảng 69% đến 70% trống.

### c) Dừng

Chờ Trợ Lý cho phép build image trên VPS (amd64) và restart server. Khi chạy lại S2 cần: image build từ nhánh `spike/claude-in-place`, environment `mac-mini` có `remoteWorkspacePath` là worktree của agent và `metadata.workspaceRealizationMode = "in_place"`, agent `mac-claude` có `adapterConfig.extraArgs = ["--setting-sources", "project,local"]` (thay cho `CLAUDE_CONFIG_DIR`, xem mục bổ sung ở cuối).

### Vòng sửa 1 sau review (06/10/2026, 11:10 đến 11:15)

Review độc lập bản `ce8c96206`: Spec PASS, Quality NEEDS_FIXES. Đã sửa đúng các điểm được giao; commit mới `5f28832b2e9f78d744ae56379a66f270ad40dfa6` (`test(environments): cover the SSH lease wiring and in-place root`), chỉ đổi hai file test (+80 −7). Code vá không đổi, vẫn **3 chỗ vá lõi**.

1. **Test dây nối của driver SSH.** Thêm hai test vào `server/src/__tests__/workspace-realization-ssh-in-place.test.ts`. Hai test gọi thật `environmentRuntimeService(db).getDriver("ssh").acquireRunLease`, mock `ensureSshWorkspaceReady`, `environmentService().acquireLease` và `resolveEnvironmentDriverConfigForRuntime`. Kỳ vọng: metadata lease có `workspaceRealization: { mode: "in_place" }` khi environment bật, và không có key `workspaceRealization` khi environment không có metadata. Đã kiểm test bắt được lỗi: xoá tạm dòng spread trong `createSshEnvironmentDriver().acquireRunLease` thì "marks the lease in_place when the environment asks for it" **fail** (1 fail, 4 pass); sau đó `git checkout -- server/src/services/environment-runtime.ts` khôi phục, `git diff` sạch.
2. **Test adapter phân biệt hai đường dẫn.** Ca in_place trong `execute.remote.test.ts` giờ có `authoritativeRoot = /Users/agent/worktrees/a` khác `spec.remoteCwd = /app` (và `target.remoteCwd = /app`). Assert skills, mcp-config, `remoteExecution.remoteCwd` và `PAPERCLIP_WORKSPACE_CWD` đều theo `/Users/agent/worktrees/a`. Pass với bản vá hiện tại.
3. **Token MCP nằm trong worktree (rủi ro upstream, không sửa code).** Ở `in_place`, adapter sync `mcp-config` vào `<worktree>/.paperclip-runtime/claude/mcp-config/mcp-config.json`; file này chứa Bearer token để agent gọi lại Paperclip. `codex_local` của upstream cũng đặt runtime asset vào `<root>/.paperclip-runtime/` theo cùng cách. Nếu agent `git add -A` thì token có thể bị commit. Xử lý ở runbook bên dưới, làm thật khi dựng worktree agent trên Mac mini lúc chạy lại S2.
4. **Hai run dùng chung một root.** Đọc code: `startNextQueuedRunForAgent` trong `heartbeat.ts` chỉ start run mới khi số run đang chạy của agent nhỏ hơn `runtimeConfig.heartbeat.maxConcurrentRuns` (tối thiểu 1, mặc định 20). Đã `PATCH /api/agents/37a9e834-...` đặt `runtimeConfig.heartbeat.maxConcurrentRuns = 1` (giữ `enabled: false`). Kết quả API: `{'heartbeat': {'enabled': False, 'maxConcurrentRuns': 1}}`. Quy ước: một environment `in_place` chỉ gắn cho một agent, vì giới hạn này tính theo agent chứ không theo environment.
5. **Ghi nhận, không sửa:**
   - Skill cũ nằm lại: ở `copy` mỗi run có thư mục riêng; ở `in_place` thư mục `<worktree>/.paperclip-runtime/claude/skills` dùng lại giữa các run. `syncDirectoryToSsh` sync đè nhưng có thể để lại file của skill đã gỡ.
   - Khác biệt cwd: phía server, `cwd` local của adapter vẫn là thư mục agent home trên VPS (`/paperclip/...`), còn Claude thực sự chạy ở worktree trên Mac. Log, session và các nơi server đọc cwd local sẽ không phản ánh đúng repo.

Spike **không** dùng managed Claude config của Paperclip. Agent dùng đăng nhập Claude sẵn có trên Mac, với cờ `--setting-sources project,local` (xem mục bổ sung ở cuối; hướng `CLAUDE_CONFIG_DIR` đã bị bỏ). `useManagedRemoteClaudeConfig` chỉ bật cho target `sandbox`, nên với SSH, VPS không gửi config Claude nào sang Mac.

Test chạy lại sau sửa:

| Lệnh | Kết quả |
|---|---|
| `vitest run src/server/execute.remote.test.ts` (claude-local) | 10/10 pass |
| `tsc --noEmit` của `@paperclipai/adapter-claude-local` | không lỗi |
| `vitest run src/__tests__/workspace-realization-ssh-in-place.test.ts` (server) | 5/5 pass |
| `tsc --noEmit` của `@paperclipai/server` | không lỗi |

`memory_pressure` sau khi chạy: 48% trống.

### Runbook khi chạy lại S2 với bản vá (chưa làm)

1. Build image từ nhánh `spike/claude-in-place` trên VPS (amd64), kiểm `free -m` trước. Restart server chỉ khi Trợ Lý cho phép.
2. Trên Mac mini, tạo worktree agent từ repo-a, không dùng checkout của owner: `git -C ~/crew-spike/repo-a worktree add ~/crew-spike/agent-wt/repo-a -b agent/crew-1`.
3. Ghi exclude vào repo chung, không vào worktree: `echo '.paperclip-runtime/' >> "$(git -C ~/crew-spike/agent-wt/repo-a rev-parse --git-common-dir)/info/exclude"`. Sau run đầu, kiểm `git -C ~/crew-spike/agent-wt/repo-a status --short --ignored` thấy `.paperclip-runtime/` ở dạng ignored, còn `git status --short` không thấy nó.
4. Environment `mac-mini`: `remoteWorkspacePath = /Users/phannhatquang/crew-spike/agent-wt/repo-a`, `metadata.workspaceRealizationMode = "in_place"`. Environment này chỉ dành cho agent `mac-claude`.
5. Agent `mac-claude`: `adapterConfig.extraArgs = ["--setting-sources", "project,local"]` và `runtimeConfig.heartbeat.maxConcurrentRuns = 1` (cả hai đã đặt). Không đặt `CLAUDE_CONFIG_DIR`; agent dùng đăng nhập Claude sẵn có trong Keychain của Mac mini.
6. Trong log run và trên Mac mini, ghi bằng chứng: không hook user nào chạy (không có process con của hook trong cây process, không có dòng hook trong stream-json), plugin user không nạp (danh sách plugin/skill ở event `system/init` của stream-json không có plugin của user), agent vẫn thấy skill `paperclip` nạp qua `--add-dir`. Kiểm `~/.claude/projects/<cwd-encoded>/` của worktree có bị ghi transcript hoặc thư mục `memory/` không; nếu có, tìm cờ hoặc biến môi trường stock của Claude Code để tắt (đặt qua `adapterConfig.extraArgs` hoặc `adapterConfig.env`) và ghi lại.
7. Sau run, kiểm: commit mới nằm trên nhánh `agent/crew-1` của worktree; checkout của owner (`~/crew-spike/repo-a`) và `owner-wip.txt` không đổi; `git log` của worktree không chứa `.paperclip-runtime/`.

### Bổ sung: bỏ `CLAUDE_CONFIG_DIR`, dùng `--setting-sources project,local`

Đại Ca bác hướng `CLAUDE_CONFIG_DIR` riêng (use case là app local dùng ngay đăng nhập Claude sẵn có, không bắt đăng nhập lại). Các chỗ nhắc `CLAUDE_CONFIG_DIR` ở phần S2b phía trên giờ chỉ còn giá trị lịch sử: bản vá không phụ thuộc biến này. Test adapter vẫn kiểm một biến trong `adapterConfig.env` tới được process, điều đó vẫn đúng nhưng không còn được dùng.

Thay vào đó dùng cờ CLI `--setting-sources project,local`. Trợ Lý đã thử trên Mac mini qua cổng 2222: cờ này giữ đăng nhập Keychain (claude.ai, max) và không nạp `~/.claude/CLAUDE.md` cá nhân. Không dùng `--bare` vì cờ đó bỏ OAuth/Keychain.

- **Stock có đường truyền cờ, không cần vá thêm:** `claude_local` đọc `adapterConfig.extraArgs` (hoặc `args`) và nối vào cuối dòng lệnh (`args.push(...extraArgs)` trong `execute.ts`, mô tả ở `packages/adapters/claude-local/src/index.ts`: "extraArgs (string[], optional): additional CLI args").
- **Đã đặt cho agent `mac-claude`** qua `PATCH /api/agents/37a9e834-...`: `extraArgs = ["--setting-sources", "project,local"]`, `env` không có `CLAUDE_CONFIG_DIR`. API trả về: `engine cli`, `model claude-sonnet-4-6`, `extraArgs ['--setting-sources', 'project,local']`, `env None`.
- **Lưu ý cần kiểm khi chạy lại S2:** adapter tự thêm `--setting-sources user` chỉ khi `managedAiConnection` bật; spike không bật nên không trùng cờ. Skill của Paperclip được đưa vào qua `--add-dir <...>/.paperclip-runtime/claude/skills`, chưa chắc `--setting-sources project,local` có ảnh hưởng tới skill nạp theo `--add-dir` hay không; runbook bước 6 kiểm agent vẫn thấy skill `paperclip`. Auto-memory và transcript trong `~/.claude/projects/` chưa kiểm, cũng ở bước 6.

## S2 chạy lại (với bản vá `5f28832b2`)

Thời điểm: 06/10/2026, 11:14 đến 11:28 (Asia/Ho_Chi_Minh).

**Kết luận: BLOCKED ở bước dựng image.** Job dựng image bị watchdog dừng vì RAM available của VPS xuống dưới 2 GB, đúng điều kiện dừng Trợ Lý đặt. Chưa đổi image, chưa restart server, chưa chạy lại issue. Server spike vẫn chạy image upstream `2026.1001.0`.

### 1. Dựng image trên VPS

- `free -m` trước khi chạy: available 5442 MiB.
- Source: `git archive` commit `5f28832b2e9f78d744ae56379a66f270ad40dfa6` từ worktree spike (kiểm `git rev-parse --show-toplevel` trước), file tar.gz 38 MB, `scp` lên `/opt/crew-v3-spike/imgsrc/` rồi giải nén vào `imgsrc/src` (138 MB). Không clone, không push fork.
- Một job duy nhất: `docker build --target production` theo `Dockerfile` upstream, tag `crew-v3-spike/paperclip:in-place-5f28832`, build-arg `PAPERCLIP_BUILD_COMMIT=5f28832b2...`, label `org.opencontainers.image.revision` cùng giá trị. Watchdog đọc `MemAvailable` mỗi 5 giây, dưới 2048 MiB thì dừng job. Script ở `/opt/crew-v3-spike/imgsrc/image-job.sh`, log ở `image-job.log` và `ram.log` cùng thư mục.
- Diễn biến: các stage `deps` (pnpm install), Rust runner (`cargo build --release`), `ui build`, `plugin-sdk build` đều xong. RAM available thấp nhất trong các stage đó là 2473 MiB (11:22:07). Tới stage `RUN pnpm --filter @paperclipai/server build` (Dockerfile đặt `NODE_OPTIONS=--max-old-space-size=4096` cho bước này), available giảm từ 2076 MiB (11:26:53) xuống 1505 MiB (11:26:58). Watchdog dừng job lúc 11:26:58: `ERROR: failed to build: failed to solve: Canceled: context canceled`, `JOB_EXIT rc=130 min_avail=1505MiB`.
- Sau khi dừng: không còn process `cargo`, `rustc` hay buildkit; `free -m` available 5091 MiB; các container `crew-crew-*`, `kidy-*`, `2ps-landing-*` và `crew-v3-spike-*` vẫn `Up` như trước. `2ps-landing-app` báo `unhealthy` nhưng `FailingStreak=25606` (khoảng 8,9 ngày với chu kỳ 30 giây), tức đã có từ trước job, không liên quan.
- **Đĩa:** trước job còn 22 GB trống, sau job còn 9,5 GB (81% dùng). Phần lớn là build cache của job này (Docker báo tổng build cache 26,11 GB, 24,07 GB có thể thu hồi, gộp cả cache của các stack khác). Tôi không prune vì ranh giới cấm `docker system prune` và lệnh prune build cache của Docker không tách riêng được cache theo project.

### Việc đã làm xong trước khi chặn

- Mac mini (bước 3): tạo worktree `~/crew-spike/worktrees/mac-claude` trên nhánh `agent/mac-claude` từ `main` (`b66cd7c`) của `~/crew-spike/repo-a`. Ghi `.paperclip-runtime/` vào `/Users/phannhatquang/crew-spike/repo-a/.git/info/exclude` (đường dẫn lấy từ `git rev-parse --git-common-dir`). Kiểm thử bằng cách tạo tạm `.paperclip-runtime/probe`: `git status --short` sạch, `git status --short --ignored` hiện `!! .paperclip-runtime/`; đã xoá file thử. Checkout gốc vẫn `?? owner-wip.txt`, shasum `bb7154e75be057a4fa993651dd86a95060ef2da7` không đổi.
- Mốc để so sau run: `~/.claude/projects` trên Mac mini có 262 thư mục, chưa có thư mục nào cho đường dẫn `crew-spike/worktrees`.
- Agent `mac-claude` đã có `extraArgs ["--setting-sources", "project,local"]` và `maxConcurrentRuns: 1` từ trước. Environment `mac-mini` **chưa** đổi sang `in_place` (để tránh server cũ chạy copy với `remoteWorkspacePath` trỏ vào worktree).

### Phương án để Trợ Lý và Đại Ca chọn

1. **Dựng lại khi được phép chạm ngưỡng thấp hơn**, ví dụ hạ ngưỡng dừng xuống 1 GB. Build cache đã giữ các stage trước, nên lần sau bắt đầu thẳng từ bước `server build`. Bước này cần heap Node tới 4 GB và có thể làm prod thiếu RAM.
2. **Image overlay nhẹ:** `FROM ghcr.io/paperclipai/paperclip:2026.1001.0`, chép đúng ba file nguồn đã đổi, transpile riêng hai file server bằng esbuild có sẵn trong image (không typecheck lại, typecheck đã làm trên MacBook). Adapter `claude_local` được server nạp từ `src` qua `tsx` (package export trỏ `./src/server/index.ts`), nên chỉ cần thay file nguồn. RAM thấp, nhưng không phải bản dựng đầy đủ theo Dockerfile upstream.
3. **Dựng ở máy khác rồi chuyển image** (`docker save` hoặc registry riêng). MacBook là arm64, phải giả lập amd64. Workflow upstream ghi lại rằng giả lập kiến trúc làm bước `server build` treo, nên dễ chậm hoặc treo.
4. **Tạm thêm swap trên VPS**: đụng cấu hình host, ngoài ranh giới của gói này.

Ngoài ra cần quyết có dọn build cache (khoảng 12 GB) hay không. Lệnh dọn sẽ ảnh hưởng chung tới build cache của mọi stack trên VPS.

### Cách 2: image overlay (11:29 đến 11:47)

Trợ Lý chọn cách 2. **Đây là image overlay, không phải bản dựng đầy đủ từ `Dockerfile` upstream.**

- **Image** `crew-v3-spike/paperclip:in-place-5f28832` (ID `3ee720e6dee7`):
  - Gốc: `FROM ghcr.io/paperclipai/paperclip:2026.1001.0`.
  - Một layer `COPY` (303 kB) đưa vào ba file nguồn lấy từ `git archive` của `5f28832b2`: `server/src/services/workspace-realization.ts`, `server/src/services/environment-runtime.ts`, `packages/adapters/claude-local/src/server/execute.ts`.
  - Một layer `RUN` (147 kB) transpile riêng hai file server bằng `esbuild` có sẵn trong image (`--format=esm --platform=node --target=node24`), chép đè vào thư mục output đã biên dịch của server. Không typecheck lại; typecheck đã làm trên MacBook.
  - Adapter `claude_local` không cần biên dịch: package export `./server` trỏ `./src/server/index.ts` và server nạp qua `tsx`.
  - `ENV PAPERCLIP_BUILD_COMMIT=5f28832b2...`, label `org.opencontainers.image.revision=5f28832b2...`, `crew.spike.kind=overlay`.
  - Script ở `/opt/crew-v3-spike/imgsrc/overlay-job.sh`.
- **RAM:** watchdog vẫn ngưỡng 2 GB; available thấp nhất trong job là 5038 MiB. Đĩa không đổi đáng kể (vẫn 9,5 GB trống).
- **Đối chiếu image với diff** (chạy script trong container của image mới):
  - Bản biên dịch của `workspace-realization` có `function sshLeaseWorkspaceRealization`.
  - Bản biên dịch của `environment-runtime` có import hàm đó và dòng `...sshLeaseWorkspaceRealization(input.environment)` trong driver SSH.
  - Nguồn adapter có `workspaceRemoteDir: inPlaceRoot ?? undefined` và `syncWorkspace: inPlaceRoot === null`.
  - Gọi thử hàm đã biên dịch bằng Node: metadata `in_place` trả `{"workspaceRealization":{"mode":"in_place"}}`, metadata `null` trả `{}`.
  - Module `environment-runtime` đã biên dịch nạp được (`environmentRuntimeService function`).
- **Đổi image:**
  - Backup DB trước: `pg_dump -Fc` ra `/opt/crew-v3-spike/backups/paperclip-before-overlay-20261006-1130.dump` (1,4 MB, chmod 600).
  - Lưu `docker-compose.yml.bak-upstream`, đổi `image:` của service `server`, rồi `docker compose up -d --no-deps server`; chỉ server spike bị tạo lại, DB và data giữ nguyên.
  - `/api/health`: `status ok`, `commit 5f28832b2e9f78d744ae56379a66f270ad40dfa6`, `bootstrapStatus ready`; migration `already applied`.
- **Environment `mac-mini`:** `remoteWorkspacePath = /Users/phannhatquang/crew-spike/worktrees/mac-claude`, `metadata.workspaceRealizationMode = "in_place"`, port 2222, secret key giữ nguyên. Probe: `ok:true`, `remoteCwd` là worktree.

### Chạy lại S2 Step 3 đến 5

- **Issue `CRE-2`** (`a112f19b-12a9-4897-b948-9b3751712d76`), giao `mac-claude`. Mô tả: sửa README.md trong thư mục làm việc hiện tại và commit riêng README.md.
- **Run `517bc63e-46f5-4832-b0e1-65062ea7386f`**, bắt đầu 11:40:34.

**Phần bản vá: đạt.** Log run phía Paperclip:

```
[paperclip] Syncing Claude runtime assets to SSH environment phannhatquang@100.102.189.67:2222.
[paperclip] Syncing skills to ssh: 100% (0.2/0.2 MB)
[paperclip] Syncing mcp-config to ssh: 100% (0.0/0.0 MB)
[paperclip] Starting sandbox callback bridge for claude in /Users/phannhatquang/crew-spike/worktrees/mac-claude/.paperclip-runtime/claude/paperclip-bridge.
```

- Log không có dòng upload workspace (bản cũ là "Syncing workspace and Claude runtime assets"). Trên Mac mini không có thư mục `.paperclip-runtime/runs/` (không có bản copy).
- Process `claude` có cwd là `/Users/phannhatquang/crew-spike/worktrees/mac-claude` và có cờ `--setting-sources project,local`.
- `.paperclip-runtime/` (chứa `mcp-config.json` có Bearer token) chỉ hiện ở `git status --ignored`, `git status` sạch.

**Phần chạy agent: không đạt, `claude` treo ngay lúc khởi động.** Log run không có thêm dòng nào sau dòng bridge, không có cả event `system/init`. Bằng chứng gom trong khoảng 4 phút trước khi hủy:

- Process `claude` (PID 56978) là con của `sshd-session` của sshd riêng ở cổng 2222. Không có process con, CPU 0%.
- File descriptor: stdin, stdout, stderr đều là PIPE (adapter đưa prompt qua stdin bằng `--print -`). Có hai kết nối `ESTABLISHED` tới `160.79.104.10:443`.
- `sample`: main thread đứng ở frame trong binary 2.1.289; một thread đứng ở `__ulock_wait2`.
- Bridge `paperclip-bridge-server.mjs` (PID 56910) chạy bình thường.

**Tái hiện ngoài Paperclip.** Gọi thẳng qua cổng 2222 bằng key của Paperclip `claude -p "Reply with exactly: ok" --model claude-sonnet-4-6 --output-format stream-json --verbose < /dev/null`, giới hạn 20 giây mỗi thư mục:

| Thư mục | Git | Kết quả |
|---|---|---|
| `/tmp` | không | xong sau 5 giây, `result success ok` |
| `~/crew-spike/workspaces` | không | xong sau 5 giây |
| thư mục rỗng mới `~/crew-spike/empty-probe` | không | xong sau 4 giây |
| `~/crew-spike/repo-a` (checkout của owner) | có | **treo**, 0 dòng output |
| `~/crew-spike/worktrees/mac-claude` | có (worktree) | **treo**, 0 dòng output |
| repo mới `git init` rỗng | có | **treo**, 0 dòng output |

Kết luận đo được: trong phiên sshd cổng 2222, `claude -p` treo trước khi in bất cứ gì khi cwd là một git repo, kể cả repo rỗng; ngoài git repo thì chạy bình thường. Test adapter (`claude_hello_probe`) cũng `timed_out` trong worktree, có và không có `--setting-sources` đều vậy (45 giây). Chưa biết nguyên nhân, không vá. Run treo ở S2 lần đầu (10:43, cwd không phải git repo, treo sau tool `Skill` đầu tiên) có triệu chứng khác, có thể là lỗi khác.

**Hủy run.** Hủy lúc 11:44:07, run thành `cancelled`, issue `CRE-2` vẫn `in_progress`. Bridge dừng. Process `claude` lại thành mồ côi (PPID 1) và vẫn sống sau 30 giây; `kill -TERM` không dừng được trong 5 giây, phải `kill -KILL`. Ba lần test adapter trước đó (`hello probe`) cũng để lại ba process `claude --print` mồ côi trong worktree (PID 45303, 46376, 47346), không dừng với TERM và đã bị SIGKILL.

**Trạng thái repo sau run:**
- Worktree vẫn ở `b66cd7c`, `git status` sạch, không có commit của agent.
- Checkout gốc `?? owner-wip.txt`, shasum `bb7154e75be057a4fa993651dd86a95060ef2da7` không đổi.

**Runbook step 6:**
- **Hook và plugin user.** Do agent treo trong git repo, phần này đo ở `/tmp`, cùng phiên cổng 2222. Không có `--setting-sources`: 2 event `hook_started`/`hook_response` của `SessionStart`, 16 plugin, 5 MCP server (trong đó có `MCP_DOCKER`, `claude.ai Claude Docs`), 73 skill. Có `--setting-sources project,local`: **không có event hook nào**, MCP server rỗng, 19 skill. Còn 3 plugin `cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-plugin-authoring`, không thuộc danh sách `enabledPlugins` của user; nguồn nạp chưa xác định.
- **Skill `paperclip` qua `--add-dir`:** chưa kiểm được vì agent không khởi động được trong worktree.
- **`~/.claude/projects`:** không có thư mục mới cho đường dẫn worktree (vẫn 0), vì `claude` không đi tới bước ghi transcript. Chưa kết luận được về auto-memory.

**Credential trên VPS (container mới):** env của container và của hai process Node server không có `ANTHROPIC_*` hay `CLAUDE*`. Không có `.credentials.json`/`.claude.json` trong container hay trong `data/`, không có `sk-ant-` trong `data/paperclip`. **Đạt.**

**Kết luận S2 chạy lại:**
- Bản vá `in_place`: chạy đúng trên server thật, không upload hay sync workspace, cwd là worktree, owner không bị đụng.
- Chạy agent: **chặn** vì `claude` treo lúc khởi động khi cwd là git repo, trong phiên sshd cổng 2222. Cần điều tra phía Mac mini/Claude Code trước khi chạy lại; tôi dừng ở đây theo chỉ dẫn.

## S2 chạy lại lần 2 (sau khi gỡ TCC)

Thời điểm: 06/10/2026, 12:16 đến 12:25 (Asia/Ho_Chi_Minh). Server vẫn chạy image overlay `crew-v3-spike/paperclip:in-place-5f28832`; không build và không restart gì. Nguyên nhân treo của lần trước do gói `claude-mac` chứng minh: macOS TCC đang chờ người bấm hộp thoại cho `claude` đọc ổ ngoài `/Volumes/CORSAIR`. Đại Ca đã bấm Allow.

**Kết luận S2 theo plan: ĐẠT, với bản vá `in_place` đã duyệt** (3 chỗ vá lõi, xem S2b). Không có hook một dòng; kết luận gốc của Step 2 vẫn là (c) đối với Paperclip stock.

### Chuẩn bị

- Chuyển `CRE-1` và `CRE-2` (hai issue cũ có run đã hủy) sang `cancelled`, để agent `maxConcurrentRuns = 1` không bị wake lại cho chúng.
- Mốc trên Mac mini: worktree ở `b66cd7c`, `git status` sạch, `.paperclip-runtime/` chỉ ở `--ignored`; `~/.claude/projects` có 266 thư mục, chưa có thư mục cho worktree.

### Step 3: Issue thật

- **Issue `CRE-3`** (`37f89126-3aa6-4bff-ae13-c347464b2622`), giao `mac-claude`: thêm dòng `hello from crew` vào README.md trong thư mục làm việc hiện tại, commit riêng README.md, không add `.paperclip-runtime`.
- **Run `8acaa48d-f782-493e-b442-3492f26734bc`:** bắt đầu 12:16:47, **`succeeded`** lúc 12:17:32 (45 giây). Issue chuyển `done`, có comment báo hash `a59fe54`.
- **Diễn biến trong log run (stream-json):**
  - Paperclip chỉ sync runtime asset: "Syncing Claude runtime assets", skills 0,2 MB, mcp-config. Không có dòng upload workspace.
  - `system/init` lúc 12:16:53 với `cwd = /Users/phannhatquang/crew-spike/worktrees/mac-claude`, `model claude-sonnet-4-6`.
  - Agent gọi `Skill paperclip` (thành công), `Read README.md`, `Edit README.md`, rồi `git add README.md && git commit` (ra `a59fe54`).
  - Agent cập nhật issue qua bridge `PAPERCLIP_API_URL` (`127.0.0.1:<cổng bridge>`). Lần đầu gọi script `scripts/paperclip-issue-update.sh` do skill hướng dẫn: không tồn tại (exit 127). Lần PATCH thứ hai thiếu tiền tố `/api` nên bị bridge trả 403 "Route not allowed". Lần thứ ba (`$PAPERCLIP_API_URL/api/issues/...`) thành công.
  - Cuối run có dòng `[paperclip] Restoring workspace changes from SSH environment ...`. Đã kiểm thư mục của company trên VPS: không có `README.md`, `.git` hay `owner-wip.txt` nào bị chép về; file mới duy nhất trong 10 phút là `claude-runtime/runs/<run>/mcp/mcp-config.json` (asset của adapter).

### Step 4: Kiểm trên Mac mini

```bash
cd ~/crew-spike/worktrees/mac-claude && git log --oneline -3 && git status --short && git status --short --ignored
cd ~/crew-spike/repo-a && git log --oneline -2 main && git status --short && shasum owner-wip.txt
```

- **Worktree:**
  - `a59fe54 docs: thêm hello from crew` trên `b66cd7c`, nhánh `agent/mac-claude`; commit chỉ đổi `README.md` (+1 dòng).
  - `git status --short` sạch; `--ignored` chỉ có `!! .paperclip-runtime/`.
  - Author của commit là identity git toàn cục của user trên Mac mini. Message có thêm hai trailer `Co-Authored-By: Claude Sonnet 4.6` và `Co-Authored-By: Paperclip` (Claude Code và skill tự thêm).
- **Checkout gốc:** `main` vẫn ở `b66cd7c`, `?? owner-wip.txt`, shasum `bb7154e75be057a4fa993651dd86a95060ef2da7` không đổi.
- **Process:** không còn `claude --print` nào của worktree sau run (run kết thúc bình thường, không mồ côi).

### Runbook step 6

| Kiểm | Kết quả |
|---|---|
| Không upload/sync workspace | Đạt: log chỉ có "Syncing Claude runtime assets", không có thư mục `.paperclip-runtime/runs/` trên Mac mini |
| Hook user không chạy | Đạt: 0 event `hook_started` trong log run (lần đo không có `--setting-sources` ở `/tmp` có 2 event `SessionStart`) |
| Plugin user không nạp | Đạt một phần: `init.plugins` chỉ còn `cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-plugin-authoring` (không thuộc `enabledPlugins` của user, nguồn nạp chưa xác định); MCP chỉ có `Paperclip projects`, `Paperclip connections` của Paperclip, không có MCP của user |
| Skill `paperclip` dùng được | Đạt: có trong `init.skills`, tool `Skill paperclip` trả "Launching skill: paperclip". Script `scripts/paperclip-issue-update.sh` mà skill nhắc tới không có trong worktree (đường dẫn tương đối theo cwd); agent tự chuyển sang gọi API qua bridge |
| `~/.claude/projects` | Có ghi: thư mục mới `-Users-phannhatquang-crew-spike-worktrees-mac-claude/` chứa đúng một transcript `0dc346ac-c41f-4eb5-8f86-9ed0cb6d5bb3.jsonl`. Không có thư mục `memory/` (auto-memory không ghi). Claude Code có cờ `--no-session-persistence` (chỉ cho `--print`) để không lưu session, nhưng cờ đó làm session không resume được, trong khi Paperclip resume session theo `taskKey`. Vì vậy chưa bật; để owner quyết. |
| Credential trên VPS | Đạt: env container không có `ANTHROPIC_*`/`CLAUDE*`; không có `.credentials.json`/`.claude.json` trong container; không có `sk-ant-` trong `data/paperclip` |

Ghi chú: `~/.claude/projects` tăng từ 266 lên 269 thư mục trong lúc chạy. Ngoài thư mục của worktree, hai thư mục còn lại là `-Users-phannhatquang-crew-spike-policy-repo` (gói `policy`) và `-private-tmp-tccchk-...` (gói `claude-mac`), không do run này tạo.

### Kết luận S2

| Step | Kết quả |
|---|---|
| 1. Repo thử, `owner-wip.txt` chưa commit | Đạt |
| 2. Bật `in_place` | Stock: (c). Với bản vá đã duyệt (`5f28832b2`, 3 chỗ vá lõi): đạt, bật bằng `environment.metadata.workspaceRealizationMode = "in_place"` |
| 3. Issue thật, run tới khi kết thúc | Đạt: run `succeeded` sau 45 giây, issue `done` |
| 4. Commit mới, `owner-wip.txt` nguyên, không bản sao repo trên VPS | Đạt: commit `a59fe54` trong worktree riêng của agent; checkout của owner không đổi; VPS không có bản sao repo |
| 5. Credential | Đạt |

Việc còn mở cho các bước sau:
- Script `scripts/paperclip-issue-update.sh` của skill `paperclip` không tới được ở chế độ `in_place`.
- 3 plugin `cc-plugin-*` vẫn nạp dù có `--setting-sources project,local`.
- Transcript vẫn ghi vào `~/.claude/projects` của user.
- Commit mang identity git của user trên Mac mini.
- Hủy run để lại process `claude` mồ côi (đo ở S2 lần 1 và lần trước); S3 sẽ đo có hệ thống.

## S2c: Vá `sessionCodec` của `claude_local` (ứng viên gửi upstream)

Thời điểm: 06/10/2026, 12:22 đến 12:37 (Asia/Ho_Chi_Minh). Bản vá đã được duyệt. **Kết luận: ĐẠT**, resume session qua SSH hoạt động.

### Nguyên nhân (xác nhận trong code)

- `execute.ts` của `claude_local` lưu `remoteExecution` (từ `adapterExecutionTargetSessionIdentity`) vào session params của run remote, và chỉ resume khi `adapterExecutionTargetSessionMatches` khớp.
- `sessionCodec` trong `packages/adapters/claude-local/src/server/index.ts` bỏ `remoteExecution` ở cả `serialize` lẫn `deserialize`. Server luôn đi qua codec khi lưu và đọc `agent_task_sessions`, nên identity đã lưu luôn rỗng và mọi run SSH bắt đầu session mới.
- `codex_local` có codec cùng dạng và cũng không giữ `remoteExecution`, nên nhiều khả năng có cùng lỗi khi chạy qua SSH (chưa kiểm thực tế, ngoài phạm vi).

### Test trước, vá sau (nhánh `spike/claude-in-place`, worktree scratchpad)

- Test mới `packages/adapters/claude-local/src/server/session-codec.test.ts` (2 test): round-trip `serialize`/`deserialize` giữ `remoteExecution`; session local không có key này và giá trị không phải object bị bỏ.
- Test mới trong `execute.remote.test.ts`: "resumes an in-place SSH session whose params went through the session codec". Session params đi qua codec rồi vào `execute` với target SSH `in_place` khớp identity; kỳ vọng có `--resume <sessionId>`.
- Trước khi vá: cả 2 test mới **hỏng** (2 fail, 11 pass).
- Vá `index.ts` (+10 dòng): hàm `readRecord`, giữ `remoteExecution` khi là object ở cả hai chiều.
- Sau khi vá: toàn package `@paperclipai/adapter-claude-local` 20 file pass, 1 skip; 303 test pass, 1 skip. `tsc --noEmit` của package không lỗi.
- Commit `6ab1aa8c67631cfdb80d9de4a2f45d9b0da3b4f3` (`fix(claude-local): keep the remote execution identity in session params`, +109 dòng, trong đó 10 dòng code). Đây là chỗ vá lõi thứ 4 của spike, và là **ứng viên gửi upstream** vì sửa lỗi độc lập với `in_place`.

### Image và deploy

- Overlay mới `crew-v3-spike/paperclip:in-place-6ab1aa8`, cùng cách overlay như `5f28832` (không phải bản dựng đầy đủ từ Dockerfile upstream). Chép 4 file nguồn: hai file server và hai file adapter. Chỉ transpile hai file server; adapter nạp từ `src` qua `tsx`.
- Watchdog 2 GB, available thấp nhất là 5112 MiB. Script ở `/opt/crew-v3-spike/imgsrc/overlay-job.sh <commit> <tag>`; nguồn đưa lên bằng `git archive` riêng 4 đường dẫn.
- Kiểm trong image: `sshLeaseWorkspaceRealization` có trong bản biên dịch, `syncWorkspace: inPlaceRoot === null` trong adapter, `remoteExecution ? { remoteExecution }` ở hai chỗ trong `index.ts`. Gọi thử codec trong container: round-trip giữ `remoteExecution`.
- Trước restart: truy vấn `heartbeat_runs` không có run `queued`/`running` ở company nào. Backup DB: `backups/paperclip-before-6ab1aa8-20261006-1229.dump`.
- Đổi `image:` và `docker compose up -d --no-deps server`. `/api/health`: `ok`, commit `6ab1aa8c67631cfdb80d9de4a2f45d9b0da3b4f3`.

### Kiểm resume thật (issue `CRE-4`, `b0b5a406-b974-42ac-9475-2f1123a668a8`)

| Lượt | Run | Wake | Session trước, sau | Ghi chú |
|---|---|---|---|---|
| 1 | `cd81f0b4-2d4a-4bba-b751-2d861adc0e38` | `issue_assigned` | không có, `70498e86` | Agent tự chọn một từ bí mật, chỉ comment "Đã chọn xong từ bí mật." |
| (tự động) | `57a5f3d7-20a6-4ba0-9995-3ecad716a3be` | `finish_successful_run_handoff` | `70498e86`, `96e8b834` | Paperclip tự tạo run vì issue `in_progress` thiếu "disposition". Log: "was saved with a different runtime MCP server set and will not be resumed", nên session mới. Từ bí mật mất ở đây vì tập MCP khác, không do codec. |
| 2 | `ee10e1b4-38e8-4ce0-8edc-98827db2cf99` | comment | `96e8b834`, `96e8b834` | Trả lời "KHÔNG NHỚ", đúng với session `96e8b834` (session này chưa từng biết từ bí mật) |
| 3 | `72a721c4-f919-4b77-a9b1-68cef7a4438d` | comment | `96e8b834`, `96e8b834` | Hỏi lại nội dung của hai lượt trước, cấm đọc lại comment. Trả lời đúng: "(1) KHÔNG NHỚ, (2) GET /api/issues/{issueId}/heartbeat-context" (đúng API agent đã gọi ở run tự động `57a5f3d7`) |

Bằng chứng resume:
- Mọi event stream-json của lượt 2 và 3 có `session_id = 96e8b834-4f7d-4cd5-b009-369dc4b01e4a`.
- Trên Mac mini, `~/.claude/projects/-Users-phannhatquang-crew-spike-worktrees-mac-claude/` vẫn chỉ có 3 file session (`0dc346ac` của CRE-3, `70498e86`, `96e8b834`). File `96e8b834...jsonl` được ghi thêm lúc 12:33 và 12:36, chứa text của comment lượt 2.
- `agent_task_sessions` của task `b0b5a406-...` lưu `remoteExecution = {transport: ssh, host: 100.102.189.67, port: 2222, username: phannhatquang, remoteCwd: <worktree>}`. Trước bản vá, các row cũ (ví dụ của CRE-3) không có key này.
- Log run của Paperclip không in dòng lệnh, nên không có chuỗi `--resume <id>` trong log. Bằng chứng resume là `session_id` trong stream và file transcript được ghi tiếp.

**Dòng log gây hiểu nhầm (lỗi upstream, chỉ ở log, không vá):** lượt 2 và 3 vẫn in `Claude session "96e8b834..." does not match the current remote execution identity and will not be resumed ... Starting a fresh remote session`, dù thực tế có resume. Trong `execute.ts`, nhánh `else if` thứ hai in câu này khi `cwd` đã lưu (đường dẫn phía VPS `/paperclip/.../_default`) khác `effectiveExecutionCwd` (worktree trên Mac), kể cả khi `canResumeSession` đúng. Đề xuất gửi upstream cùng bản vá codec.

**Còn mở:** run tự động `finish_successful_run_handoff` không resume được vì "different runtime MCP server set". Chưa tìm hiểu vì sao tập MCP của run giao việc (`issue_assigned`) khác run tự động.

## S3: Mất kết nối, restart server và hủy run

Thời điểm: 06/10/2026, 12:38 đến 13:06 (Asia/Ho_Chi_Minh). Server overlay `in-place-6ab1aa8`. Agent `mac-claude` chuyển sang `claude-haiku-4-5` cho rẻ, vẫn `in_place` trên worktree `~/crew-spike/worktrees/mac-claude`, `maxConcurrentRuns 1`.

**Kết luận Review Focus 1: KHÔNG ĐẠT ở bản hiện tại.**
- Không có run nào bị báo thành công sai (đạt).
- Có thực thi song song và process mồ côi. Sau khi server restart, process `claude` của run cũ vẫn chạy trên Mac song song với run retry và cả hai cùng commit. Sau cancel, process `claude` vẫn chạy tiếp và vẫn commit. Issue kẹt `in_progress` sau cancel.

### Cách đo

- Issue tạo bằng `/opt/crew-v3-spike/s3-issue.sh <nhãn>`: chạy ở foreground `python3 -c "import time; time.sleep(120)" && echo done-<nhãn> >> long.txt`, rồi commit `long.txt`.
- Lần thử đầu dùng `sleep 120 && ...` như plan. Claude Code tự chặn lệnh dạng "sleep N followed by ..." và agent chuyển lệnh sang chạy nền, nên run kết thúc trước khi kịp ngắt mạng (xem CRE-5).
- Script theo dõi `s3-watch.sh` (scratchpad MacBook) mỗi 10 giây ghi:
  - trạng thái run và issue, đọc qua SSH IP public của VPS;
  - process trên Mac mini có `worktrees/mac-claude`, đọc qua cổng 22 bằng key MacBook (không đi qua VPS).
- Log ở scratchpad: `s3-net.log`, `s3-net2.log`, `s3-restart.log`, `s3-cancel.log`.
- Trước mỗi kịch bản đã kiểm không có process agent nào trên Mac và không có run `queued`/`running` ở bất kỳ company nào.

### Kịch bản 1: tắt Tailscale trên VPS 60 giây

**Cách làm:** script `/opt/crew-v3-spike/s3-tsdown.sh` chạy nền qua SSH IP public: `tailscale down`, chờ 60 giây, `tailscale up --hostname=crew-v3-spike-vps`.
- Lần 1 (CRE-5): down 12:38:45, up 12:39:45.
- Lần 2 (CRE-6): down 12:46:37, up 12:47:37.
- Cả hai lần `up-exit=0`, IP vẫn `100.105.105.12`. Socket `100.105.105.12:3100` vẫn nghe, UI từ MacBook trả 200. `ssh nhamoiplatform` (hostname `14.225.224.88`, IP public) luôn vào được.

**CRE-5** (`b91f1149-...`), lần thử hỏng vì lệnh bị chạy nền:
- Run `06419dbb-...`: Claude Code chặn `sleep 120 && echo ...`; agent chạy lại lệnh nền, trả `result success` lúc 05:38:38 rồi chờ tác vụ nền. Tailscale down lúc 05:38:45 làm SSH rớt, exit 255. Run thành **`failed` (`adapter_failed`)**, không báo thành công.
- Paperclip tự tạo run retry `1a9bd307-...` (`retryOf` run trên) lúc mạng còn mất, run này `failed` (`setup_failed`, không lấy được lease SSH). Issue chuyển **`blocked`** với comment "still has no live execution path".
- Trên Mac: `claude` và `sleep` chết khi SSH rớt (không còn process từ 12:38:50). Không có commit, không có `long.txt`.

**CRE-6** (`ea446932-...`), run `f5b48a20-8608-4911-9816-66b85a29c9b5`:
- 12:46:21 run bắt đầu; 12:46:32 agent chạy lệnh ở foreground; 12:46:37 Tailscale down.
- 12:46:46 `claude` (PID 60556) và bridge (PID 60496) trên Mac có PPID chuyển thành 1, tức phiên sshd đã đóng, nhưng **cả hai vẫn chạy**.
- `claude` tự chạy xong lệnh và commit `03ec6b9 test: s3 net2` lúc 12:48:37. Khi Tailscale đã lên lại, nó gọi API qua bridge (server đọc hàng đợi bridge bằng các kết nối SSH mới) và chuyển issue `done` khoảng 12:49. `claude` tự thoát khoảng 12:49:22.
- Phía server: log run dừng ở 05:46:36. TCP của phiên SSH cũ chỉ báo đứt lúc 05:51:35 ("Connection reset by peer"), tức 5 phút sau. Run thành **`failed` (`claude_transient_upstream`)**, mã lỗi gán nhầm vì đây là mất transport.
- Kết quả: **issue `done` nhưng run `failed`**. Không có run thứ hai cho issue. Bridge mồ côi còn sống ít nhất tới 12:50:50, đã biến mất khi kiểm lúc 12:53.

### Kịch bản 2: restart server khi đang chạy (CRE-7, `a4bb2e58-...`)

- 12:53:35 run `85abde97-c318-4d10-b697-9aa499f587d2` bắt đầu, agent chạy lệnh lúc 12:53:46. 12:53:48 `docker compose restart server` (chỉ container server spike), xong 12:53:50.
- Server cũ chuyển run thành **`interrupted` (`server_shutdown_interrupted`)**. Server mới tạo run retry `ff3f085c-7fa2-4cf6-abd3-450fcb3f3ca6` (`scheduled_retry`, chạy từ 12:54:45), run này **`succeeded`** lúc 12:57:29 và issue `done`.
- **Trên Mac có hai agent chạy song song trên cùng worktree:**
  - `claude` cũ (PID 77751, PPID thành 1 từ 12:53:49) sống tới 12:56:01; bridge của nó (PID 77707) đã chết sau restart.
  - `claude` của run retry (PID 79695) chạy 12:54:45 đến 12:57:18.
  - Hai process chồng lên nhau khoảng 76 giây.
- **Hậu quả:**
  - Hai commit cho cùng một issue: `8617859` lúc 12:55:51 do process mồ côi tạo, `2259c98` lúc 12:56:54 do run retry tạo.
  - `long.txt` có hai dòng `done-restart`.
  - Paperclip chỉ biết run retry; commit của process mồ côi không gắn với run nào.

### Kịch bản 3: hủy run (CRE-8, `04e7388a-...`)

- 13:01:11 run `499b84c7-9234-43e7-8314-e488b2e72ab0` bắt đầu. 13:01:22 `POST /api/heartbeat-runs/<id>/cancel` khi lệnh đang chạy; run thành **`cancelled`** ngay.
- Trên Mac sau 30 giây (13:01:23 đến 13:01:54): `claude` (PID 93467, PPID 1), `zsh` và `python` của lệnh **vẫn chạy**; bridge (PID 93399) đã chết.
- Process mồ côi chạy xong lệnh và **commit `eb94b2f test: s3 cancel` lúc 13:03:26, sau khi run đã bị hủy**, rồi tự thoát lúc 13:05:50 (không gọi được Paperclip vì bridge đã chết).
- Issue **kẹt `in_progress`**: không run nào sống, không tự chuyển trạng thái.

### Trả lời ba câu hỏi của Review Focus 1

| Câu hỏi | Trả lời | Bằng chứng |
|---|---|---|
| Run có bị báo thành công sai? | Không | Mất mạng: `failed` (`adapter_failed`, `claude_transient_upstream`); restart: `interrupted`; cancel: `cancelled`. Nhưng có trường hợp ngược: issue `done` trong khi run `failed` (CRE-6), vì process mồ côi tự hoàn tất và cập nhật issue qua bridge sau khi mạng có lại. |
| Có run thứ hai chạy song song cùng issue? | Có, ở mức process | Paperclip chỉ có một run `running` tại một thời điểm, nhưng sau restart process `claude` của run cũ vẫn chạy song song với run retry, tạo hai commit (CRE-7) |
| Có process mồ côi trên Mac? | Có, cả ba kịch bản | Mất mạng: `claude` và bridge PPID 1 (CRE-6); restart: `claude` PPID 1 sống thêm khoảng 2 phút 12 giây; cancel: `claude` PPID 1 sống thêm khoảng 4 phút 28 giây và commit sau khi hủy. Các lần trước (S2) còn cần `SIGKILL` vì bỏ qua `SIGTERM`. |

Hành vi mặc định của upstream chấp nhận được:
- Trạng thái run phía server đúng (không báo thành công sai).
- Run retry sau restart.
- Chuyển issue `blocked` khi không còn đường chạy (CRE-5).

Hành vi cần xử lý:
- Không dừng process phía Mac khi run kết thúc bất thường.
- Issue kẹt `in_progress` sau cancel.
- Mã lỗi `claude_transient_upstream` khi thực ra mất transport.
- Phát hiện mất SSH chậm 5 phút.

### Nguyên nhân trong code và đề xuất

- Driver SSH trong `server/src/services/environment-runtime.ts` có `releaseRunLease(input)` chỉ gọi `environmentsSvc.releaseLease(...)`; nó bỏ qua `cancelActiveWork`. Driver sandbox thì có xử lý `cancelActiveWork` và lưu biên nhận dừng remote (`remoteTerminationReceipt`). Vì vậy khi cancel, khi reap lúc restart hay khi mất mạng, server chỉ đóng phía ssh client. Phía Mac không nhận tín hiệu nào: phiên `notty` không gửi `SIGHUP`, `claude` không thoát khi stdout/stdin đóng.
- **Đề xuất 1 (ưu tiên, vá ở driver SSH, không cần hook trong `heartbeat.ts`):** trong `releaseRunLease` của driver SSH, khi `cancelActiveWork` hoặc trạng thái là `failed`/`expired`, mở một kết nối SSH mới và dừng mọi process của run. Có thể nhận diện process theo đường dẫn bridge hoặc theo biến môi trường `PAPERCLIP_RUN_ID` trong process tree. Dừng bằng `TERM` rồi `KILL` cả process group, sau đó trả biên nhận dừng như driver sandbox. Cách này phủ cả `cancelRunInternal` lẫn `reapOrphanedRuns` vì cả hai đều đi qua release lease. Đây là chỗ vá lõi thứ 5 nếu làm, một khối nhỏ trong driver.
- **Đề xuất 2 (lớp phòng thủ trên Mac, không vá lõi):** công cụ Crew trên Mac. Ví dụ một wrapper `claude` (đặt qua `adapterConfig.command`) tự giết process group khi phiên SSH cha biến mất (PPID thành 1 hoặc stdout đóng), kèm một LaunchAgent dọn mọi `claude --print` có cwd trong worktree agent mà PPID là 1 quá N phút. Lớp này cần có ngay cả khi có đề xuất 1, vì lúc mất mạng server không vào được Mac để dừng process.
- **Đề xuất 3 (nhỏ):** sau cancel, đưa issue về trạng thái rõ ràng (`todo` hoặc `blocked`) thay vì để `in_progress`. Có thể làm bằng plugin nghe event cancel, không cần vá lõi.
- Hook `beforeClaim`/`reapOrphanedRuns` trong `heartbeat.ts` **không cần** cho Review Focus 1: việc thiếu nằm ở driver SSH (không dừng remote), không nằm ở scheduler.

### Trạng thái sau S3

- Không còn process `claude --print` hay bridge của worktree trên Mac mini.
- Worktree `agent/mac-claude` có thêm các commit thử `03ec6b9`, `8617859`, `2259c98`, `eb94b2f`. Checkout gốc `main` vẫn `b66cd7c`, `owner-wip.txt` shasum không đổi.
- Issue: CRE-5 `blocked`, CRE-6 `done`, CRE-7 `done`, CRE-8 `in_progress` (kẹt sau cancel, giữ nguyên làm bằng chứng).
- Tailscale trên VPS đang lên (`100.105.105.12`), UI health `ok`. RAM VPS available khoảng 5,2 GB.

## S5: Kiểm tải Mac trước khi spawn và hành vi khi Mac offline

Pha 1 (chỉ đọc code fork `6ab1aa8c6`, nhánh `spike/claude-in-place`): 06/10/2026, trước 13:12. Pha 2 (thử thật): 13:12 đến 13:29 (Asia/Ho_Chi_Minh).

**Kết luận S5: ĐẠT với 1 hook (H1 `beforeClaim`).** Plugin sandbox provider không giữ được run ở hàng đợi; hook một dòng ở đầu `claimQueuedRun` giữ được run `queued` khi Mac quá tải và cả khi Mac không tới được, rồi tự chạy khi Mac ổn. Không có hook thì Mac offline làm run `failed` (`setup_failed`) và issue `blocked` ngay, không chuyển environment.

### Pha 1: plugin sandbox provider có giữ được run ở hàng đợi không?

**Kết luận: KHÔNG. Cần hook H1 `beforeClaim` ở đầu `claimQueuedRun`.** Lý do:

1. **Hợp đồng lease không có trạng thái "chờ".** Trong `packages/plugins/sdk/src/protocol.ts` và `define-plugin.ts`, `onEnvironmentAcquireLease` chỉ trả `PluginEnvironmentLease { providerLeaseId, metadata, expiresAt }` hoặc ném lỗi. Không có kết quả kiểu "busy", "retryAfter" hay "deferred". Driver `plugin` trong `environment-runtime.ts` gọi `environmentAcquireLease` rồi `environmentsSvc.acquireLease` ngay, không có nhánh chờ.
2. **Lỗi acquire là lỗi setup của run.** `environment-run-orchestrator.ts` bọc lỗi thành `EnvironmentRunError("lease_acquire_failed")`. Khối catch setup trong `heartbeat.ts` gán `errorCode = "setup_failed"` (trừ vài loại cấu hình), run thành `failed`. Retry tạm thời có giới hạn: `BOUNDED_TRANSIENT_HEARTBEAT_RETRY_DELAYS_MS = [30_000, 30_000]`, tức tối đa 2 lần cách 30 giây. Hết lượt thì issue chuyển `blocked`. Đây đúng là chuỗi "fail rồi retry vòng" plan muốn tránh, và khớp CRE-5 ở S3 (run `failed`, retry `failed` `setup_failed`, issue `blocked`).
3. **Plugin không bọc được SSH driver built-in.** Môi trường `mac-mini` dùng driver `ssh` (`createSshEnvironmentDriver`). Đổi sang driver `plugin` nghĩa là plugin phải tự làm cả transport (`environmentExecute`, realize workspace) thay cho SSH built-in và mất luôn bản vá `in_place` đã làm ở S2b. Như vậy là viết lại transport, trái quyết định owner số 1.
4. **SSH driver không có chỗ cắm.** `acquireRunLease` của driver SSH chỉ chạy `ensureSshWorkspaceReady` (`mkdir -p ... && cd ... && pwd` qua SSH) rồi ghi lease. Không có callback hay event nào trước đó. Probe environment (`environment-probe.ts`) chỉ chạy khi gọi route `POST /environments/:id/probe`, không chạy trước mỗi run.
5. **Không có đường 0 hook nào giữ run `queued`.**
   - Event plugin (`agent.run.started`, ...) chỉ là thông báo sau khi đã claim.
   - Pause agent hay chặn budget làm `claimQueuedRun` gọi `cancelRunInternal`, tức hủy run chứ không giữ.
   - Một cổng chặn phía Mac (ví dụ `ForceCommand` của sshd cổng 2222 trả lỗi khi tải cao) làm `ensureSshWorkspaceReady` lỗi. Kết quả vẫn là `setup_failed`, retry 2 lần rồi `blocked`: "lỗi rõ" nhưng không "chờ".
6. **H1 giữ được run ở hàng đợi mà không cần thêm gì.**
   - Trong `claimQueuedRun`, `return null` để nguyên run ở `queued`; upstream đã dùng cách này cho trường hợp "settling owner" và dependency chưa xong.
   - Scheduler định kỳ (`index.ts`, mỗi `HEARTBEAT_SCHEDULER_INTERVAL_MS`, mặc định 30 giây) gọi `resumeQueuedRuns`, nên run được thử claim lại mỗi 30 giây.
   - `cancelStaleQueuedRun` chỉ hủy run `queued` theo trạng thái issue (đổi assignee, issue terminal, mất execution lock...), không theo thời gian chờ. Run chờ lâu không bị hủy vì lâu.
7. **Không có chuyển environment khi lỗi.** `resolveEnvironment` của orchestrator lấy đúng environment đã chọn; environment `local` chỉ dùng khi run không chọn environment nào, không phải khi environment đã chọn lỗi.

### Thiết kế thử nghiệm Step 2 (hook H1 trên worktree tạm)

- Worktree tạm mới trong scratchpad từ `6ab1aa8c6`, nhánh cục bộ `spike/s5-load-gate`, không đụng `v3`, không push.
- File mới `server/src/services/crew-load-gate.ts`, hàm `crewBeforeClaim(db, run)`:
  - Đọc cấu hình từ file `/paperclip/crew-load-gate.json` (bind mount `data/paperclip` trên VPS), gồm `companyId`, `environmentId`, `agentIds`, `maxLoad1`. Sửa ngưỡng không cần restart.
  - Với run của agent trong danh sách: lấy config SSH của environment bằng `resolveEnvironmentDriverConfigForRuntime` (có sẵn, giải secret private key), chạy `sysctl -n vm.loadavg` bằng `runSshCommand` (timeout 10 giây).
  - Trả `true` (hoãn) khi load 1 phút vượt `maxLoad1` hoặc SSH không tới được; ghi log `crew-load-gate`.
- Hook một dòng ở đầu `claimQueuedRun`: `if (await crewBeforeClaim(db, run)) return null;`, import đặt cuối file.
- Đo trên VPS bằng image overlay (cùng cách `in-place-6ab1aa8`, transpile thêm `heartbeat.ts` và file mới bằng esbuild; watchdog RAM 2 GB):
  - Mac mini lúc đọc có 10 nhân, load khoảng 1,7. Đặt `maxLoad1 = 0.5` để luôn vượt ngưỡng. Tạo issue. Kỳ vọng run nằm `queued` nhiều chu kỳ, không có `setup_failed`, không tạo run retry, không có process `claude` trên Mac.
  - Đổi `maxLoad1 = 50`. Kỳ vọng run được claim trong khoảng 30 giây và chạy xong.
- Step 3 đo hai lần:
  - Lần A: bản có H1 (SSH không tới được nên hoãn).
  - Lần B: tắt gate bằng cách bỏ agent khỏi `agentIds`, để thấy hành vi upstream.
  - Mô phỏng offline: xem pha 2 (đã đổi từ `launchctl bootout` sang `SIGSTOP` listener sshd).

### Pha 2: dựng bản thử

- Worktree tạm `/private/tmp/claude-501/-Users-phannhatquang-Documents-projects-crew/e36ddeb9-c3da-46d0-8e2e-7a956c6cf953/scratchpad/paperclip-s5`, nhánh cục bộ `spike/s5-load-gate`. Commit `acfa0cffa` trên `6ab1aa8c6` gồm:
  - `server/src/services/crew-load-gate.ts`, 56 dòng.
  - `heartbeat.ts` +2 dòng: dòng hook đầu `claimQueuedRun` và dòng import ở cuối file.
  - Không push. Nhánh `v3` không đổi.
  - Chưa chạy `tsc` vì worktree tạm không có `node_modules`. esbuild transpile được và chạy đúng trên server là bằng chứng thay thế.
- Image overlay `crew-v3-spike/paperclip:s5-gate-acfa0cf`:
  - Dựng trên `in-place-6ab1aa8`, transpile hai file `crew-load-gate` và `heartbeat` bằng esbuild.
  - Script `/opt/crew-v3-spike/imgsrc/s5-overlay.sh`, watchdog 2 GB. Build xong rc 0, available thấp nhất 5144 MiB.
  - Kiểm trong image: `crewBeforeClaim` có trong `heartbeat.js` bản biên dịch, bản vá `in_place` vẫn còn.
- Deploy:
  - Trước restart, `s5-active.sh` cho thấy không có run `queued`/`running`/`scheduled_retry` ở company nào.
  - 13:14:31 `docker compose up -d --no-deps server`; health `ok`.
  - Health vẫn báo `commit` `8f8a0ab...` vì `PAPERCLIP_BUILD_COMMIT` dạng rút gọn; `docker inspect` cho thấy đúng image và `PAPERCLIP_BUILD_COMMIT=acfa0cffa`.
- Cấu hình gate ở `/opt/crew-v3-spike/data/paperclip/crew-load-gate.json`; đổi bằng `/opt/crew-v3-spike/s5-gate.sh <on|off> <maxLoad1>`, không cần restart.
- Theo dõi bằng `s5-watch.sh` (scratchpad MacBook), mỗi 10 giây ghi ba thứ:
  - run và issue;
  - log `crew-load-gate` của server;
  - process trong worktree agent trên Mac (qua cổng 22).
- Log ở scratchpad: `s5-overload.log`, `s5-release.log`, `s5-offline-gate.log`, `s5-online-gate.log`, `s5-offline-nogate.log`.

### Step 2: Mac "quá tải" (ngưỡng thấp có chủ đích)

Mac mini có 10 nhân, load 1 phút trong lúc thử là 1,3 đến 2,0.

| Thời điểm | Việc | Kết quả |
|---|---|---|
| 13:15:37 | Gate bật, `maxLoad1 = 0.5`. Tạo `CRE-9` (`f6490dfd-46e0-4613-9090-6e2d83615bed`) | Run `3c242e4b-1350-48b2-b525-560589080ba0` nằm **`queued`** |
| 13:15:38 đến 13:17:53 | Server đo load khoảng mỗi 30 giây (`load1` 1,27 đến 1,45, `defer: true`) | Run vẫn `queued`, issue `todo`. Không `setup_failed`, không run retry, không process nào trên Mac |
| 13:18:22 | Đổi `maxLoad1 = 50` | 13:18:23 run được claim (`load1 2.02, defer: false`), chạy trên `mac-mini` |
| 13:19:13 | | Run `succeeded`, issue `done`, commit `6f306f3 test: s5 overload` trong worktree agent |

Run chờ 2 phút 46 giây dưới cùng một run ID, rồi chạy khoảng 1 giây sau khi bỏ chặn. Lần chạy đó rơi vào nhịp scheduler; trường hợp xấu nhất là chờ một chu kỳ 30 giây.

### Step 3: Mac offline (mô phỏng)

**Cách mô phỏng và lý do đổi so với chỉ dẫn:**
- Lệnh: `kill -STOP` process listener của sshd spike cổng 2222 (PID 17611, LaunchAgent `com.2p.crew-spike-sshd`), sau đó `kill -CONT` để mở lại.
- Không dùng `launchctl bootout`:
  - Plist có `LimitLoadToSessionType Aqua`. Bootstrap lại từ phiên SSH cổng 22 chưa chắc chạy được.
  - Nếu không bootstrap lại được thì cần Đại Ca đăng nhập desktop mới khôi phục.
  - `SIGSTOP` hoàn tác chắc chắn và không đụng các phiên SSH khác.
- Hiệu ứng giống Mac mất mạng: TCP vẫn kết nối được nhưng không có banner. Kiểm trực tiếp từ VPS: `Connection timed out during banner exchange`, exit 255 sau `ConnectTimeout=10`.
- Khác Mac offline thật ở chỗ cổng 22 và Tailscale của Mac vẫn sống. Đây là mô phỏng, không phải tắt Tailscale.

**Lần A, có H1 (gate bật, `maxLoad1 = 50`):**

| Thời điểm | Việc | Kết quả |
|---|---|---|
| 13:20:38 | `SIGSTOP` sshd 2222 | |
| 13:20:40 | Tạo `CRE-10` (`91ee7bf4-e96a-45fb-8885-ee92db0f711a`) | Run `d9d8584e-c5d2-4d5e-9890-f84a612df7be` nằm **`queued`**. Log `crew-load-gate: remote unreachable, run stays queued` khoảng mỗi 30 giây (13:20:50, 13:21:03, 13:21:33, 13:22:03, 13:22:33) |
| 13:22:52 | `SIGCONT` | 13:22:54 run được claim (`load1 1.64`), chạy trên `mac-mini` |
| 13:23:47 | | Run `succeeded`, issue `done`, commit `a5bc583 test: s5 offline-gate` |

**Lần B, không có H1 (gate tắt, tức hành vi upstream cộng các vá S2):**

| Thời điểm | Việc | Kết quả |
|---|---|---|
| 13:24:37 | `SIGSTOP` sshd 2222 | |
| 13:24:38 | Tạo `CRE-11` (`4972d755-2fa1-457e-a28a-6a3f1cb9c768`) | Run `3f08105c-ac63-4fac-b69d-2f823ff5ea80` chạy ngay |
| 13:24:48 | | Run **`failed` (`setup_failed`)**. Lỗi: `Failed to acquire lease for environment "mac-mini" (ssh): Command failed: ssh ... -p 2222 phannhatquang@100.102.189.67 ...`. Không tạo lease nào |
| 13:24:49 | | Issue **`blocked`**, comment hệ thống: "Paperclip automatically retried continuation ... but it still has no live execution path. Moving it to `blocked` so it is visible for intervention." |
| 13:24:49 đến 13:27:37 | | Không có run retry nào (`retryOfRunId` null, `scheduledRetryAttempt` 0) |
| 13:27:56 | `SIGCONT` | Issue vẫn `blocked` lúc 13:28:10, không tự chạy lại |

**Không chuyển environment:**
- Company có ba environment: `mac-mini`, `mac-mini-policy` (của gói policy) và `Local`.
- Lease của các run thành công đều là `mac-mini` (`ssh`, `released`). Run lỗi không có lease nào.
- Không run nào chạy trên `Local` hay `mac-mini-policy`. Lỗi được báo rõ ràng.

### Step 4: Kết luận S5

| Mục | Kết quả |
|---|---|
| Cách làm chọn | Hook **H1 `beforeClaim`** ở đầu `claimQueuedRun`. Hook gọi module Crew đo tải Mac qua SSH; tải cao hoặc không tới được thì trả `null`, run nằm `queued`, scheduler tự thử lại mỗi 30 giây. Không dùng plugin sandbox provider (lý do ở pha 1) |
| Số hook | **1** (H1). Tổng hook lõi theo plan: H2 và H1 là 2, chưa tính 4 chỗ vá adapter/driver của S2b/S2c và đề xuất 1 của S3 |
| Hành vi khi quá tải | Đạt: run chờ, không spawn, không fail, không retry vòng, rồi tự chạy khi tải xuống |
| Hành vi khi offline, có H1 | Đạt: run chờ `queued`, tự chạy khi Mac có lại, không chuyển environment |
| Hành vi khi offline, upstream | "Lỗi rõ ràng" nhưng không chờ: run `failed` `setup_failed` sau khoảng 10 giây, issue `blocked`, không retry, không tự chạy lại khi Mac có lại (cần người can thiệp). Không chuyển environment |

**Việc còn cần khi làm thật (R1):**
- Lấy environment theo run (environment đã chọn của agent, project hoặc issue) thay cho file cấu hình của bản thử. Ngưỡng nằm trong cấu hình Crew, ví dụ `maxLoad1` theo số nhân và/hoặc `memory_pressure`.
- Cache kết quả đo theo environment khoảng 10 đến 15 giây. Mỗi lần Mac không tới được, bản thử chặn khoảng 10 giây trong `claimQueuedRun` (vì `ConnectTimeout=10`), và đo lại cho mỗi run `queued`. Nhiều run chờ cùng lúc sẽ làm chậm tick scheduler.
- Run chờ trong UI chỉ hiện `queued` mà không nói lý do. Nên ghi lý do (quá tải hay offline) bằng activity hoặc comment, có giới hạn tần suất. Nên có ngưỡng thời gian chờ tối đa rồi chuyển issue `blocked` kèm lý do, để không chờ vô hạn.
- Hook cần test trong `crew/release/core-hooks.json` (theo Global Constraints).
- Hành vi khi Mac rớt **giữa chừng** vẫn theo S3 (H1 không phủ); phần đó cần đề xuất 1 và 2 của S3.

### Trạng thái sau S5

- Server spike chạy lại image `crew-v3-spike/paperclip:in-place-6ab1aa8` từ 13:28:30, health `ok`. Image `s5-gate-acfa0cf` vẫn còn để dùng lại. File gate đang ở trạng thái tắt (`agentIds` rỗng); image `6ab1aa8` không đọc file này.
- sshd spike cổng 2222 trên Mac đã `SIGCONT`, trạng thái `S`, đăng nhập được (run CRE-10 chạy sau đó).
- Không còn process nào trong worktree agent trên Mac. Worktree `agent/mac-claude` có thêm commit thử `6f306f3`, `a5bc583`; file `s5.txt` mới.
- Issue: CRE-9 `done`, CRE-10 `done`, CRE-11 `blocked` (giữ làm bằng chứng).
- RAM VPS available khoảng 5,2 GB.
