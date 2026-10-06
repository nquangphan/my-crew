# Spike gói `moi-truong`

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
