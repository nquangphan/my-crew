# App macOS: đăng nhập Paperclip và client REST

> Flow `mac-app-paperclip`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-app-paperclip`
> in ra đúng danh sách đó.

## Mục đích

App "2P Crew" lấy board API key của owner bằng luồng `cli-auth` có sẵn của Paperclip (owner duyệt trên web), giữ key
trong Keychain sao cho chỉ app đọc được, và gọi REST Paperclip có kiểu (company, project, environment SSH, agent,
instructions, hủy run, vai trò theo project). Thêm/gỡ project và màn hình Project dùng client này (cùng flow, làm sau).

## Điểm vào

- Kênh IPC `paperclip:login(origin)`, `paperclip:loginStatus()`, `paperclip:companies()` (đăng ký trong
  `src/main/paperclip/register.ts` → `registerPaperclip`, gọi từ `src/main/index.ts`).
- `paperclipClient(ctx)` cho code Main khác (sức khỏe/run, wizard, project): client của origin đã đăng nhập trong
  `app.json` (`setup.paperclipOrigin`).

## Các bước đăng nhập

1. `paperclip:login(origin)` → `createLoginFlow().start`: `normalizeOrigin` chỉ nhận `https://<máy>` (hoặc
   `http://127.0.0.1:<cổng>` cho test), không path. `POST /api/cli-auth/challenges` body
   `{ command: "2P Crew app", clientName: "2P Crew trên <hostname>", requestedAccess: "board" }`. Server trả `id`,
   `token` (bí mật của thử thách), `boardApiToken` (key chờ duyệt), `approvalPath`, `approvalUrl`.
2. App mở `approvalUrl` bằng trình duyệt (`shell.openExternal`). `approvalUrl` chỉ dùng khi cùng origin owner đã
   nhập, không thì dựng `origin + approvalPath`. `token` và `boardApiToken` chỉ nằm trong bộ nhớ Main.
3. Renderer gọi `paperclip:loginStatus` mỗi giây → `poll`: `GET /api/cli-auth/challenges/<id>?token=<token>` (không
   cần đăng nhập). `pending` giữ nguyên; `approved` → lưu key vào Keychain đúng một lần, quên key trong bộ nhớ, ghi
   `setup.paperclipOrigin` (đổi origin thì xóa `setup.companyId`); `expired`, `cancelled` hoặc 404 → kết thúc, không
   lưu. Chưa bắt đầu đăng nhập thì trả `expired`.
4. `paperclip:companies` → `GET /api/companies`. Key thấy mọi company của owner, nên app để owner tự chọn (wizard ghi
   `setup.companyId`); company `archived` bị bỏ.

## Keychain: chỉ app đọc được board key

Agent Paperclip chạy cùng user macOS với app (qua sshd của app). Mục tạo bằng `security add-generic-password` có ACL
tin `/usr/bin/security` (partition `apple-tool:`), nên agent đọc được bằng `security find-generic-password -w` không
hộp thoại. Vì vậy:

- `src/main/paperclip/keychain.ts` → `createBoardKeyStore`: mục service `crew-mac-paperclip`, account = origin, giá trị
  `v1:<base64>` là bản mã của key, không phải key. Key gốc không bao giờ nằm trên argv của `security`.
- Mã hóa bằng `safeStorage` của Electron (`register.ts` → `electronCipher`). Khóa giải mã nằm ở mục
  "2P Crew Safe Storage" do chính process app tạo: ACL `decrypt` chỉ tin bản ký của app (designated requirement) và
  partition theo team (`teamid:`; bản chưa ký là `cdhash:`). Process khác đọc mục này thì macOS bật hộp thoại xin
  quyền; khi không được tương tác thì bị từ chối.
- Đọc lại: `find-generic-password -w` lấy bản mã → `safeStorage.decryptString`. Mục không có (mã 44), mục cũ không có
  tiền tố `v1:`, hay không giải mã được (khóa Safe Storage bị xóa, owner bấm từ chối) → `null` = "Cần đăng nhập lại".
- Webhook secret `crew-mac-status` không đổi (CLI và LaunchAgent status cần đọc nó).

Thực nghiệm 09/10/2026 (mục thử `crew-mac-paperclip-test`, giá trị giả, đã xóa): mục tạo bằng `security` đọc được
ngay; theo cách trên, app (Electron) ghi và đọc lại không hộp thoại, `security -w` trên mục `crew-mac-paperclip-test`
chỉ ra bản mã, `security -w` trên mục Safe Storage bị chặn chờ hộp thoại (securityd ghi
`displaying keychain prompt for /usr/bin/security`), process thử khác với tương tác bị tắt nhận `-25293`. Chi tiết ở
sổ R2-1.

Điều kiện để rào này có nghĩa (phần đóng gói, không nằm trong flow này): bản app đóng gói phải tắt các fuse Electron
`RunAsNode`, `EnableNodeOptionsEnvironment`, `EnableNodeCliInspectArguments` (bật
`EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`). Nếu không, process khác chạy chính binary của app với
`ELECTRON_RUN_AS_NODE`/`NODE_OPTIONS=--require`/`--inspect` là chạy mã của nó dưới danh tính app và giải mã được.
Đổi danh tính ký (Apple Development → Developer ID) thì lần đọc đầu macOS hỏi một lần; owner bấm "Luôn cho phép".

## REST dùng

Mọi request: `Authorization: Bearer <board key>` đọc lại từ Keychain mỗi lời gọi, timeout 15 giây
(`AbortSignal.timeout`). 401/403 → `PaperclipAuthError` "Cần đăng nhập lại Paperclip"; lỗi khác →
`PaperclipHttpError { status, code }`, message chỉ có mã HTTP và `code` (không kèm body). Log (`debug`) chỉ có method,
path không query, status.

| Hàm | Route | Ghi chú |
|-----|-------|---------|
| `me` | `GET /api/cli-auth/me` | `userId` |
| `companies` | `GET /api/companies` | `id`, `name`, `issuePrefix`, `requireBoardApprovalForNewAgents` |
| `projects` | `GET /api/companies/:id/projects` | project có `urlKey`, không có `key` |
| `createProject` | `POST /api/companies/:id/projects` | `{ name, description? }` |
| `environments` | `GET /api/companies/:id/environments` | lấy `privateKeySecretRef.secretId`, `knownHosts` của environment có sẵn |
| `createEnvironment` | `POST /api/companies/:id/environments` | `driver: "ssh"`, `config` (`host`, `port`, `username`, `remoteWorkspacePath`, `privateKeySecretRef`, `knownHosts`, `strictHostKeyChecking: true`), `metadata.workspaceRealizationMode: "in_place"`, `crewLoadGate` tùy chọn |
| `archiveEnvironment` | `PATCH /api/environments/:id` `{ status: "archived" }` | không có hàm xóa: `DELETE` kéo theo secret SSH dùng chung |
| `createAgent` | `POST /api/companies/:id/agents` | `claude_local`, `command` phải là `<home>/.crew/bin/crew-claude-run`, `runtimeConfig.heartbeat { enabled: false, maxConcurrentRuns: 1 }`, `defaultEnvironmentId` |
| `getAgent` | `GET /api/agents/:id` | 404 → `null` (chờ duyệt agent khi company bật duyệt) |
| `pauseAgent` | `POST /api/agents/:id/pause` | agent không tạo thẳng ở `paused` được |
| `patchAgent` | `PATCH /api/agents/:id` | |
| `getInstructionsFile` | `GET /api/agents/:id/instructions-bundle/file?path=AGENTS.md` | `{ content, hash = contentHash }`; 404 → `null`; hash sai dạng thì ném |
| `putInstructionsFile` | `PUT /api/agents/:id/instructions-bundle/file` | `{ path, content, baseHash }`: `baseHash` = hash của GET; `null` chỉ khi chưa có file (có rồi → 409); thiếu → 422 |
| `cancelRun` | `POST /api/heartbeat-runs/:runId/cancel` | |
| `runWebUrl` | `GET /api/heartbeat-runs/:runId` rồi `GET /api/companies/:id` | `<origin>/<issuePrefix>/agents/<agentId>/runs/<runId>`; prefix nhớ theo company |
| `getRoles` / `setRoles` / `deleteRoles` | `GET`/`POST`/`DELETE /api/plugins/crew.core/api/projects/:projectId/roles` | `companyId` ở query (GET/DELETE) hoặc body (POST) |

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/mac-app/src/main/paperclip/types.ts` | Kiểu client (Interface I6) | `PaperclipClient`, `ProjectRoles`, `SshEnvironmentInput`, `ClaudeLocalAgentInput` |
| `apps/mac-app/src/main/paperclip/client.ts` | REST có kiểu, origin, lỗi | `createPaperclipClient`, `normalizeOrigin`, `paperclipRequest`, `PaperclipAuthError`, `PaperclipHttpError` |
| `apps/mac-app/src/main/paperclip/cli-auth.ts` | Đăng nhập `cli-auth` | `createLoginFlow` |
| `apps/mac-app/src/main/paperclip/keychain.ts` | Board key trong Keychain (bản mã) | `createBoardKeyStore`, `BOARD_KEY_SERVICE` |
| `apps/mac-app/src/main/paperclip/register.ts` | Kênh IPC, `security`, `safeStorage` | `registerPaperclip`, `paperclipClient`, `boardKeys` |

## Tests

- `apps/mac-app/test/paperclip-client.test.ts`: Paperclip giả trên `127.0.0.1` (`paperclip-fake-server.ts`); Bearer,
  đọc key mỗi lời gọi, timeout, 401/422, log không có key, đường dẫn và body từng route, không có `DELETE`
  environment.
- `apps/mac-app/test/paperclip-cli-auth.test.ts`: body thử thách, `approvalUrl`, poll `pending/approved/expired/cancelled/404`,
  lưu key đúng một lần (kể cả hai poll song song), log không có token.
- `apps/mac-app/test/paperclip-keychain.test.ts`: lệnh `security`, giá trị lưu là bản mã, mã 44, mục cũ không mã hóa,
  giải mã hỏng, lỗi Keychain không lộ key.
