# App macOS: đăng nhập Paperclip, client REST, thêm/gỡ project, nhận việc trên máy

> Flow `mac-app-paperclip`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-app-paperclip`
> in ra đúng danh sách đó.

## Mục đích

App "2P Crew" lấy board API key của owner bằng luồng `cli-auth` có sẵn của Paperclip (owner duyệt trên web), giữ key
trong Keychain sao cho chỉ app đọc được, và gọi REST Paperclip có kiểu (company, project, environment SSH, agent,
instructions, hủy run, vai trò theo project). Thêm/gỡ project (`src/main/projects/`) dùng client này để dựng một bộ
agent riêng cho mỗi project; màn hình Project (`src/renderer/routes/projects.tsx`, kênh `projects:*`) gọi logic đó.
Cũng bằng board key đó, app nhận việc từ hàng đợi "việc cần làm trên máy" của plugin `crew.core` (`src/main/jobs/`):
wizard trên web Crew xếp việc, app làm trên Mac rồi báo kết quả.

## Điểm vào

- Kênh IPC `paperclip:login(origin)`, `paperclip:loginStatus()`, `paperclip:companies()` (đăng ký trong
  `src/main/paperclip/register.ts` → `registerPaperclip`, gọi từ `src/main/index.ts`).
- `paperclipClient(ctx)` cho code Main khác (sức khỏe/run, wizard, project): client của origin đã đăng nhập trong
  `app.json` (`setup.paperclipOrigin`).
- `addProject(deps, input)` và `removeProject(deps, projectId)` (`src/main/projects/{add-project,remove-project}.ts`):
  logic Main. `deps` = `{ home, env, client, ops, store, log? }`.
- Kênh IPC `projects:list()`, `projects:pickFolder()`, `projects:add(input)`, `projects:remove(projectId)`
  (`src/main/projects/register.ts` → `registerProjects`, logic không phụ thuộc Electron ở `src/main/projects/ipc.ts` →
  `createProjectsIpc`; hộp thoại chọn thư mục `dialog.showOpenDialog({ properties: ['openDirectory'] })` truyền vào
  qua `pickDirectory`). Màn hình Project ở route `#/projects`.
- `registerJobs(ctx)` (`src/main/jobs/register.ts`, gọi từ `src/main/index.ts` sau `registerSshd`): vòng hỏi hàng đợi
  việc trên máy, chạy suốt đời app (xem "Nhận việc trên máy").

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
(`AbortSignal.timeout`). 401 → `PaperclipAuthError` "Cần đăng nhập lại Paperclip"; 403 → `PaperclipForbiddenError`
(con của `PaperclipHttpError`, status 403): "tài khoản không có quyền" (vd. không thuộc company), không bảo đăng nhập
lại và không xóa key (app không bao giờ tự xóa board key); lỗi khác →
`PaperclipHttpError { status, code }`, message chỉ có mã HTTP và `code` (không kèm body). Log (`debug`) chỉ có method,
path không query, status.

| Hàm | Route | Ghi chú |
|-----|-------|---------|
| `me` | `GET /api/cli-auth/me` | `userId` |
| `companies` | `GET /api/companies` | `id`, `name`, `issuePrefix`, `requireBoardApprovalForNewAgents` |
| `projects` | `GET /api/companies/:id/projects` | project có `urlKey`, không có `key` |
| `createProject` | `POST /api/companies/:id/projects` | `{ name, description? }` |
| `environments` | `GET /api/companies/:id/environments` | lấy `privateKeySecretRef.secretId`, `knownHosts` của environment có sẵn; danh sách có thể lẫn environment của company khác |
| `secrets` | `GET /api/companies/:id/secrets` (board key) | chỉ giữ `id`, `name`; lọc khuôn environment theo secret của company |
| `createEnvironment` | `POST /api/companies/:id/environments` | `driver: "ssh"`, `config` (`host`, `port`, `username`, `remoteWorkspacePath`, `privateKeySecretRef`, `knownHosts`, `strictHostKeyChecking: true`), `metadata.workspaceRealizationMode: "in_place"`, `crewLoadGate` tùy chọn |
| `updateEnvironment` | `PATCH /api/environments/:id` `{ status: "active", config: {host, port, username, remoteWorkspacePath, privateKeySecretRef, knownHosts, strictHostKeyChecking} }` | bật lại environment đã archive hoặc sửa cấu hình cũ; server gộp `config`, không gửi `name` |
| `archiveEnvironment` | `PATCH /api/environments/:id` `{ status: "archived" }` | không có hàm xóa: `DELETE` kéo theo secret SSH dùng chung |
| `createAgent` | `POST /api/companies/:id/agents` | `claude_local`, `adapterConfig` = `{ engine: "cli", command, extraArgs, model, env: {} }` như agent R1: `command` phải là `<home>/.crew/bin/crew-claude-run`, `model` bắt buộc (thiếu thì ném, không gọi mạng). Thiếu `engine` thì Paperclip chạy ACP, mà ACP chỉ chạy sandbox nên run trên environment SSH `in_place` hỏng `adapter_engine_unavailable` (TPS-71, AC-6 09/10). `runtimeConfig.heartbeat { enabled: false, maxConcurrentRuns: 1 }`, `defaultEnvironmentId` |
| `getAgent` | `GET /api/agents/:id` | 404 → `null` (chờ duyệt agent khi company bật duyệt). Trả `id`, `name`, `status`, `companyId`, `defaultEnvironmentId`, `engine` (= `adapterConfig.engine`, không có thì `null`); không giữ `env` hay key khác của `adapterConfig` |
| `agents` | `GET /api/companies/:id/agents` | tìm lại agent đã tạo khi response bị mất |
| `pauseAgent` | `POST /api/agents/:id/pause` | agent không tạo thẳng ở `paused` được |
| `resumeAgent` | `POST /api/agents/:id/resume` | server từ chối agent `pending_approval`/`terminated` (409) |
| `patchAgent` | `PATCH /api/agents/:id` | |
| `setAgentPermissions` | `PATCH /api/agents/:id/permissions` | `{ canCreateAgents, canCreateSkills, canAssignTasks }`, cả ba phải là boolean (sai thì ném, không gọi mạng); `canAssignTasks` thêm/bỏ grant `tasks:assign` |
| `getAgentPermissions` | `GET /api/agents/:id` | Đọc như `crew/ops/agent-permissions.sh` của fork: `canCreateAgents` chỉ khi `permissions.canCreateAgents` đúng `true`; `canCreateSkills` trừ khi đúng `false` (server mặc định cho tạo skill); `canAssignTasks` khi `access.grants` có `tasks:assign` (không dùng `access.canAssignTasks`, vì thành viên `active` nào cũng `true` theo mặc định). 404 → `null`; thiếu `access.grants` thì ném |
| `getInstructionsFile` | `GET /api/agents/:id/instructions-bundle/file?path=AGENTS.md` | `{ content, hash = contentHash }`; 404 → `null`; hash sai dạng thì ném |
| `putInstructionsFile` | `PUT /api/agents/:id/instructions-bundle/file` | `{ path, content, baseHash }`: `baseHash` = hash của GET; `null` chỉ khi chưa có file (có rồi → 409); thiếu → 422 |
| `cancelRun` | `POST /api/heartbeat-runs/:runId/cancel` | |
| `runWebUrl` | `GET /api/heartbeat-runs/:runId` rồi `GET /api/companies/:id` | `<origin>/<issuePrefix>/agents/<agentId>/runs/<runId>`; prefix nhớ theo company |
| `getRoles` / `setRoles` / `deleteRoles` | `GET`/`POST`/`DELETE /api/plugins/crew.core/api/projects/:projectId/roles` | `companyId` ở query (GET/DELETE) hoặc body (POST); `setRoles` 400 → message kèm lời từ chối của plugin (bỏ key, ≤ 300 ký tự), ví dụ agent đang giữ vai trò ở project nào; `getRoles` chỉ giữ bốn vai trò app quản lý (bỏ các ô runtime `codexExecutorAgentId`, `opencodeExecutorAgentId`, `codexReviewerAgentId` server trả thêm) để bước `check` so khớp được |
| `pairInfo` | `GET /api/plugins/crew.core/api/machines/pair-info?companyId=` (routeKey `machines.pair-info`) | Trả `{paperclipSshPublicKey}`, chỉ nhận `ssh-ed25519 …` (sai dạng thì ném). Server chưa có key thì `409` → `PaperclipHttpError` 409 (bước Máy mở phần nhập tay, flow `mac-app`) |
| `pairMachine` | `POST /api/plugins/crew.core/api/machines/pair` | Body đúng các key `{companyId, machineId, hostname, environmentId, tailscaleIp, port, hostKeyFingerprint}`, thêm `allowRepair: true` chỉ khi được yêu cầu (owner bấm "Ghép lại máy này"). Trả `{machineKey, pairedAt}`; `machineKey` phải là base64url 43 ký tự, không thì ném. `409` giữ `code` của plugin: `machine_revoked` (máy đã bị gỡ trên web) hay `machine_uses_company_secret` (máy đang gửi bản tin bằng secret company, chưa từng ghép). `400` kèm lời từ chối của plugin. Key máy không vào log (log chỉ có method, path, status) |
| `machineBlockers` | `GET /api/crew/companies/:id/projects/:projectId/machines/blockers` (`?agentIds=` nối bằng dấu phẩy khi có) | Trả danh sách run chờ/đang chạy trên cây đã ghim máy (`blockers`); 404 (server cũ) → `null` |
| `releaseProjectMachines` | `POST /api/crew/companies/:id/projects/:projectId/machines/release` | Body `{agentIds, wholeProject, primaryMachineId}`; server archive environment `@máy` và xếp `remove-checkouts` trên máy khác; trả `{archivedEnvironmentIds, jobs}`; 404 → `null` |
| `provisionProjectMachines` | `POST /api/crew/companies/:id/projects/:projectId/machines/provision` | Body `{exceptMachineId, includeReady, repo:{originUrl, branch}}`; server xếp `ensure-project` cho máy đã ghép khác; 404 → `null` |

## Thêm project

Project đã có sẵn trên máy: thêm project là **chọn folder** repo git trên Mac. App không nhập URL, không clone, và không
ghi gì vào working tree, index hay nhánh đang mở của folder đó (owner có thể đang dở việc ở đó).

`addProject(deps, { folder, name, key, executors })`: `folder` là đường dẫn tuyệt đối, `key` khớp
`^[a-z][a-z0-9-]{1,30}$`, `executors` 1 hoặc 2. Ném trước mọi lời gọi khi: dữ liệu sai dạng, folder không dùng được
(xem dưới), chưa chọn company (`setup.companyId`), đường dẫn checkout bị `forbiddenRootReason` chặn,
`~/crew-agents/<key>` đã có nội dung mà chưa có tiến độ (thư mục rỗng còn lại sau khi gỡ thì được), folder đã được thêm
với khóa khác, tiến độ đang dở của khóa này trỏ folder khác, số executor khác lần trước, hay tiến độ kiểu cũ đã tạo
project/agent (xem "Tiến độ kiểu cũ").

**Kiểm folder** (`src/main/projects/folder.ts` → `inspectFolder`, chỉ đọc, `/usr/bin/git` với `GIT_TERMINAL_PROMPT=0`).
Mỗi ca một lời tiếng Việt:

| Ca | Lời báo (rút gọn) |
|----|-------------------|
| Không tuyệt đối / không có / không phải thư mục | "Folder phải là đường dẫn tuyệt đối", "Không tìm thấy folder …", "… không phải thư mục" |
| Gốc ổ đĩa, HOME, cha của HOME | "Không dùng gốc ổ đĩa, HOME hay thư mục cha của HOME làm project" |
| Không phải repo git | "… không phải repo git: chọn thư mục gốc của repo (thư mục có .git)" |
| Repo bare | "… là repo bare (không có working tree)" |
| Thư mục con của repo | "… là thư mục con của repo <gốc>: chọn đúng thư mục gốc đó" |
| Worktree phụ (`--git-dir` ≠ `--git-common-dir`) | "… là worktree phụ của repo <repo chính>: chọn thư mục repo chính" |
| Không có `origin` | "Repo … chưa có remote origin" |
| Không có nhánh mặc định | "Không xác định được nhánh mặc định (origin/HEAD, main, master): chạy git -C … remote set-head origin --auto" |

Nhánh mặc định (`baseRef`) theo thứ tự `refs/remotes/origin/HEAD` (đích của nó), `origin/main`, `main`,
`origin/master`, `master`. App không fetch (app GUI có thể thiếu `SSH_AUTH_SOCK`); worktree rẽ từ ref đang có.
`/Volumes` **không** bị chặn (ví dụ `/Volumes/CORSAIR/Projects/2ps-landing`): app có Full Disk Access và sshd agent là
con của app nên agent đọc được folder đó qua `.git` chung; ổ ngoài phải đang gắn khi agent chạy. Folder lưu trong
tiến độ là đường dẫn thật (`realpath`) của gốc repo.

Tiến độ nằm ở `app.json` → `projects[key]` (`ProjectProgress`, có `folder`). Mỗi bước có trong `done` thì bỏ qua; mỗi
id tạo ra (project, environment, agent) được ghi ngay sau khi có. Lỗi ở bước nào thì ghi `error`, pause mọi agent của
project đang chạy được rồi trả tiến độ (không ném); chạy lại tiếp từ bước dở. Hai lần thêm cùng khóa không chạy song
song.

| Bước | Việc |
|------|------|
| `folder` | `configureDocsBundle` (`folder.ts`, dùng chung với việc `prepare-checkouts` và `agent-workspace`): luôn cài crew-docs cho repo, kể cả repo chưa có `docs/flows.yaml` (flows có thể thêm sau, lúc đó integrator cần sẵn bundle). Đặt `crew-docs.bundle` và `crew-docs.runtime` trong git config của repo — chung cho mọi worktree. Bundle owner đã đặt mà còn là file thì giữ; nguồn: repo đầu tiên trong `listStatusRepos` có bundle là file, không có thì `~/.crew/bin/crew-docs.cjs` (app tự cài, xem "Bundle và runtime crew-docs"). Runtime chỉ đặt khi chưa có, không phải file, không chạy được hay trỏ vào bundle `.app`/binary Electron (`runtimeProblem`); nguồn: runtime dùng được của repo khác (không bao giờ chép runtime hỏng), không có thì node thật từ `ops.docsNodePath` (dò như `ensureNode`, không có thì tải). Không có node thì ném "Chưa có node dùng được cho crew-docs.runtime…" (bundle đã đặt vẫn giữ). Rồi hook: thư mục hook git đang dùng (`git rev-parse --git-path hooks`, theo `core.hooksPath`; husky `.husky/_` thì xem `.husky/`) chưa có đủ ba dòng `# crew-docs:<hook>` (pre-commit, commit-msg, pre-push) thì chạy `<runtime> <bundle> install-hooks --runtime <runtime> --bundle <bundle>` trong checkout gốc (`runProcess`, 60 giây); lệnh tự nhận husky, lefthook hay `core.hooksPath` riêng của repo (flow `docs-hooks`). Mã khác 0 thì ném "crew-docs install-hooks trong <repo> thất bại (mã N): <dòng lỗi cuối>". Sau cùng `core.hooksPath --local` là `.githooks` tương đối thì đổi thành `<repo>/.githooks` tuyệt đối: `.githooks/` không được track nên worktree agent không có, hooksPath tương đối làm commit trong worktree bỏ qua hook; husky đã được install-hooks tự đổi sang tuyệt đối, hooksPath khác giữ nguyên. Chạy lại khi mọi thứ đã đúng thì không ghi gì |
| `project` | Project cùng tên đã có thì dùng lại, không thì `createProject` |
| `status-repo` | `ops.addStatusRepo(projectId, <folder>, companyId)` (company đang chọn: ảnh chụp docs đi đúng company khi bản tin có nhiều đích) — ảnh chụp docs đọc thẳng folder của owner. `crew-mac status send` chỉ đọc qua git (`git show`/`ls-tree` ở commit `origin/HEAD`, worktree tạm detached trong thư mục tạm), không đọc working tree; mỗi lượt nó `git fetch origin` trong folder (chỉ đổi ref remote) — xem `docs/flows/mac-setup.md` mục "Ảnh chụp docs" |
| `role:<vai>` | Theo thứ tự `executor-1`, (`executor-2`), `assistant`, `reviewer`, `integrator` (executor trước để Trợ Lý có danh sách id). Worktree riêng `~/crew-agents/<key>/<vai>` bằng `git -C <folder> -c core.hooksPath=/dev/null worktree add --no-track -b agent/<key>-<vai> <checkout> <baseRef>` (như R1: worktree của repo gốc, nhánh `agent/…` riêng; hook của repo không chạy). Nhánh `agent/<key>-<vai>` đã có (thêm lại sau khi gỡ) thì `worktree add <checkout> <nhánh>` dùng lại nhánh đó. Worktree đã có đúng chỗ (`--git-common-dir` trùng `.git` của folder, `--show-toplevel` là checkout) thì dùng lại; thư mục khác ở đó thì báo lỗi, không đè. Thêm `.paperclip-runtime/` vào `info/exclude` (file chung trong `.git` của folder, chỉ nối một dòng). Environment `<key>-<vai>`: SSH `in_place`, `remoteWorkspacePath` = checkout, host/user/`knownHosts`/`crewLoadGate` và secret SSH (`privateKeySecretRef.secretId`) lấy từ environment SSH `in_place` đang `active` của máy (`getTemplate`) và có secret SSH thuộc company (`GET /api/companies/:id/secrets`; environment là của cả instance nên có thể là của company khác, secret của họ bị bỏ qua): máy đã ghép (app state có `setup.pairedEnvironmentId`, ghi ở bước Máy, flow `mac-app`) dùng đúng environment đó, phải còn `active` và cùng cổng `manifest.port`, không thì lỗi "Environment đã ghép của máy này … chạy lại bước Máy để ghép lại" (không rơi về environment cùng cổng của máy khác, vì MacBook và Mac mini cùng cổng 2222); máy chưa ghép (Mac mini) giữ cách cũ: environment đầu tiên theo tên cùng cổng `manifest.port` của `crew-mac setup`. Agent `<key>-<vai>`: `claude_local`, `engine: "cli"`, `env: {}`, `model` theo vai như agent R1 (Trợ Lý `claude-opus-5`, executor/reviewer/integrator `claude-sonnet-5`), `command` = `<home>/.crew/bin/crew-claude-run`, `extraArgs` = bản ghim Superpowers (`setup().superpowers`, kiểm khuôn như `merge-agent-config.mjs`), heartbeat tắt, `maxConcurrentRuns: 1`, `defaultEnvironmentId` = environment trên. Agent (và environment) đã có trên server cùng tên mà chưa có trong tiến độ (response bị mất) thì dùng lại. Rồi giữ agent ở `paused`; tải `AGENTS.md` |
| `roles` | `setRoles(companyId, projectId, { assistantAgentId, executorAgentIds, reviewerAgentId, integratorAgentId })`. Plugin kiểm luật (reviewer ≠ integrator, 1–2 executor, không vai trò chéo giữa project, không agent `terminated`) |
| (đặt quyền) | Không phải bước trong `done`: mỗi lần chạy mà `check` chưa xong thì `setAgentPermissions` cho mọi agent của project (tạo mới hay dùng lại) ngay trước `check`, lúc agent còn `paused`. Quyền agent Crew như wizard web và `agent-permissions.sh`: `canCreateAgents: false`, `canCreateSkills: false`, `canAssignTasks` chỉ `true` cho Trợ Lý. Paperclip mặc định cho agent mới cả ba (tạo agent, tạo skill, grant `tasks:assign`); bản app trước không đặt lại (8 agent `visinote-*`, `business-app-*` trên prod 11/10 phải sửa tay). Vì không ghi vào `done`, tiến độ của bản cũ đã qua mọi `role:*` vẫn được đặt quyền khi Chạy tiếp; PATCH lặp lại không đổi gì |
| `check` | `doctor({ probe: false, skipTcc: true })` không có `fail` ở `worktree-workflows`, `worktree-root`; `workflowCheck` sạch cho từng checkout; `getRoles` đọc lại khớp; `getAgent` từng agent đọc lại có `engine` = `cli` (agent dùng lại do bản app cũ tạo thiếu `engine` bị chặn ở đây, phải PATCH `adapterConfig.engine` rồi Chạy tiếp); `getAgentPermissions` từng agent đọc lại đúng quyền agent Crew, lệch thì lỗi "Quyền của agent `<key>-<vai>` chưa bị giới hạn (còn được tạo agent, còn được tạo skill, còn được giao việc / Trợ Lý thiếu quyền giao việc): bấm Chạy tiếp để đặt lại". Đạt hết thì mới `resumeAgent` các agent đang `paused` |

Lần `check` vừa xong (không phải chạy lại sau khi `check` đã có trong `done`) thì app nhờ server dựng sẵn project trên các máy
đã ghép khác (`provisionProjectMachines`, `exceptMachineId` = máy này từ `jobTargets`, `includeReady: false`, `repo` = origin
đã bỏ credential (`stripUrlCredentials`, cùng luật `repoOf` của web: `http(s)://` bỏ cả userinfo, scheme khác chỉ bỏ mật khẩu
nên `ssh://git@…` giữ user máy khác cần để clone) và nhánh gốc); máy offline thì việc chờ trong hàng đợi. Lỗi chỉ ghi log `project-provision-others-failed`,
lần thêm vẫn xong.

Thêm xong không lỗi (`progress.error` là `null`) thì `projects:add` (`ipc.ts` → `onAdded`, nối ở `register.ts`) gọi
`ctx.sendStatusSoon('project-added:<key>')` (flow `mac-app`): bản tin máy mang các checkout `~/crew-agents/<key>/*` mới
được gửi ngay, nên kiểm tra A5 "checkout máy đã báo" của web đạt mà không chờ lượt gửi định kỳ. Thêm dở hay ném lỗi thì
không gửi; gửi lỗi không làm hỏng kết quả thêm.

Những gì app ghi vào folder của owner, tất cả nằm trong `.git`: metadata worktree (`.git/worktrees/<tên>`), nhánh
`agent/<key>-<vai>`, git config `crew-docs.*` (khi chưa có hoặc hỏng), `core.hooksPath` (qua `install-hooks`, `.githooks` thành
đường dẫn tuyệt đối), một dòng `.paperclip-runtime/` trong `info/exclude`. Ngoài `.git`: hook crew-docs do `install-hooks` ghi
(`.githooks/*` chưa track, hoặc nối vào hook husky/lefthook/`core.hooksPath` sẵn có của repo).

### Bundle và runtime crew-docs

Hook git của crew-docs (`hook-installer.ts`, flow `docs-hooks`) và agent đều chạy
`ELECTRON_RUN_AS_NODE=1 "<crew-docs.runtime>" "<crew-docs.bundle>" …`. App đóng gói với fuse `runAsNode: false` (giữ
để bảo vệ Keychain), nên runtime là binary của app (`/Applications/2P Crew.app/Contents/MacOS/2P Crew`) không chạy
như node: mỗi lệnh mở thêm một instance, `second-instance` đưa cửa sổ lên và lệnh thoát 0 mà không kiểm gì (hook docs
im lặng đạt). Vì vậy `crew-docs.runtime` luôn phải là node thật (`docs-runtime.ts`):

- `runtimeProblem(runtime)`: lý do runtime không dùng được — chưa đặt, không phải file, nằm trong `.app`
  (`isInsideAppBundle`, giải symlink), trùng `process.execPath` khi chạy dưới Electron, không có quyền chạy.
- Bundle mang theo: `Contents/Resources/crew-docs.cjs` (build từ `packages/docs-kit`, xem flow `mac-app-update`).
  `installDocsBundle` chép vào `~/.crew/bin/crew-docs.cjs` chỉ khi chưa có hoặc nội dung khác (ghi file tạm rồi
  `rename`, quyền 0644).
- Tự sửa lúc app mở: `registerProjects` gọi `repairDocsOnStart` (chạy nền, không bao giờ ném) → op
  `repairDocsHooks(<Resources>/crew-docs.cjs)` trong utility: cài bundle; chưa có `~/.crew/status-repos.json` (máy
  mới) thì dừng, không dò hay tải node; có thì lấy node (`docsNode`: node đang nhớ, dò đồng bộ, shell đăng nhập, không
  có thì tải như `ensureNode`). Không có node thì để nguyên mọi config, chỉ ghi `nodeError`. Có node thì
  `repairDocsConfig` cho từng repo trong `listStatusRepos`: repo chưa đặt cả hai key (không dùng crew-docs) bỏ qua;
  `crew-docs.bundle` không còn là file thì trỏ về bundle đã cài; `crew-docs.runtime` có `runtimeProblem` thì đặt sang
  node đó; giá trị còn dùng được (kể cả owner tự đặt) giữ nguyên. Kết quả ghi `app.log`: `docs-bundle-installed`,
  `docs-hooks-repaired` (repo, key đã sửa, runtime), `warn` `docs-bundle-install-failed`, `docs-node-missing`,
  `docs-hooks-repair-skipped`, `docs-repair-failed`. Không có bước tay, hộp thoại hay công cụ mới cho owner.

**Tiến độ kiểu cũ.** Bản trước thêm project bằng URL git (bước `ls-remote`, `mirror`, clone vào `~/crew-projects`):
tiến độ đó có `origin` mà không có `folder`. Đọc vẫn được (danh sách, gỡ). Chưa tạo project/agent nào thì lần thêm mới
bỏ tiến độ cũ và làm lại từ đầu; đã tạo thì `addProject` ném "… là kiểu cũ (URL git, bản trước): bấm "Gỡ khỏi Mac"
rồi thêm lại bằng Chọn folder"; màn hình không hiện "Chạy tiếp" cho tiến độ đó.

Agent mới ở `paused` từ ngay sau khi tạo tới bước `check`. Company bật `requireBoardApprovalForNewAgents` thì agent
tạo ra ở `pending_approval`: app không pause agent đó (pause sẽ đưa nó khỏi hàng chờ duyệt), mà hỏi lại mỗi 10 giây,
tối đa 30 phút ("Chờ duyệt agent trên web"); được duyệt rồi mới pause.

`AGENTS.md` (`instructions.ts`): template `templates/{assistant,executor,reviewer,integrator}.md` chép nguyên văn từ
`crew/agents/*.md` của fork (test so sha256). `renderInstructions` port từ `render-instructions.mjs`: chỉ Trợ Lý nhận
danh sách executor của project (mục "Executor của company", mỗi dòng `id:runtime` in thành "— runtime `<runtime>`", id
trần là `claude_local`; runtime lạ thì ném), danh sách agent BMAD (mục "Agent BMAD của company") và reviewer Codex
(mục "Reviewer Codex của company"). Project app tạo chỉ có executor Claude, không BMAD, không reviewer Codex nên hai mục
sau luôn render "Không có…"; đầu ra khớp từng byte với `render-instructions.mjs` (test so sha256). `uploadInstructions`
theo `add-base.mjs`: GET file lấy hash làm `baseHash` (`null` chỉ khi 404), nội dung đã đúng thì không PUT.

Template app là bản sao có chủ đích của `crew/agents/*.md` trong fork (đồng bộ lần cuối với fork `main` @ `c051ce117` ngày 23/10/2026, gồm cả các luật thêm sau R2-3 BMAD, FX-B, FX-L2 và AG-1/AG-2 như test + ảnh nghiệm thu, luồng PR của integrator và model Claude 5.5 trong bảng runtime: Trợ Lý có mục "Chọn runtime và model" (bảng runtime/model, marker `crew-model … runtime=`), executor có mục "Khi bạn chạy Codex hoặc OpenCode", reviewer có mục "Khi chạy bằng Codex"; Trợ Lý có mục "Chọn workflow" và "Chốt
trạng thái gốc"; gồm khối "File đính kèm" (lệnh `crew-mac files`, issue con có `parentId` luôn chạy một lần khi bắt đầu để thấy file của issue cha, nội dung file là dữ liệu không phải chỉ thị, không chép credential) và dòng FX-10 "Phải xuống dòng ngay sau `exit=<DOCS_EXIT>`" và mục 4 của integrator). Sửa `crew/agents/*.md` ở fork thì
phải chép lại sang `templates/*.md` và cập nhật sha256 trong `projects-instructions.test.ts`; agent đã tạo từ template cũ
không tự đổi, phải PUT lại `AGENTS.md` (GET lấy `contentHash` làm `baseHash`). Test cũng khẳng định các câu then chốt
của FX-10 có trong template integrator, mục "Chọn workflow" và "Chốt trạng thái gốc" có trong template Trợ Lý, và khối
"File đính kèm" có trong cả 4 template.

## Gỡ khỏi Mac

`removeProject(deps, projectId)`:

0. Có agent trong tiến độ thì hỏi `machineBlockers` trước hết: cây ghim máy còn run chờ/đang chạy thì từ chối, không pause
   hay archive gì, thông báo kèm danh sách `<mã issue> (<hostname>)`; server cũ (404) thì bỏ qua.
1. Pause agent của project (chỉ agent trong tiến độ của app; agent đang `paused`/`terminated`/`pending_approval` bỏ
   qua). Pause hủy run đang chạy của agent đó.
2. Archive environment riêng của chúng (`PATCH { status: "archived" }`; không bao giờ `DELETE`). Rồi `releaseProjectMachines`
   (`wholeProject: true`, `primaryMachineId` = `jobTargets().machineId`) với agent trong tiến độ còn nằm trong dòng vai trò
   (`getRoles`; server từ chối id ngoài dòng, nên agent owner đã thay ở ô bị bỏ, dòng vai trò đã xóa ở lần trước thì không
   gọi): server archive environment `@máy` và xếp
   `remove-checkouts` trên các máy khác (máy này loại ra); có kết quả thì `removed` ghi số environment đã archive và số
   máy gỡ checkout. Máy này vẫn gỡ bằng lệnh tay `manualCommand`.
3. `ops.removeStatusRepo(projectId)`.
4. Có dòng vai trò thì `deleteRoles`.
5. Xóa `projects[key]` khỏi `app.json` khi mọi bước xong (lỗi giữa chừng thì giữ để chạy lại).

Không xóa project trên Paperclip, không xóa worktree agent, không đụng folder gốc của owner: trả
`{ removed, manualCommand }` với `manualCommand` = `git -C <folder> worktree remove <checkout>` cho từng vai trò (thứ
tự vai trò, nối bằng ` && `, đường dẫn có ký tự lạ thì quote cho `/bin/sh`) để owner tự chạy; git từ chối worktree còn
thay đổi chưa commit. Nhánh `agent/<key>-<vai>` giữ lại (thêm lại cùng khóa thì dùng lại). Tiến độ kiểu cũ thì
`manualCommand = "rm -rf ~/crew-agents/<key> ~/crew-projects/<key>"` như trước; rỗng khi project không do app thêm
hoặc chưa có checkout. Chạy lại khi đã gỡ không lỗi. Project không do app thêm (ví dụ `repo-a` của R1) chỉ bị `remove-repo` và xóa
dòng vai trò, không agent nào bị pause.

## Nhận việc trên máy

Hàng đợi `crew_machine_jobs` của plugin `crew.core` (route board `/api/plugins/crew.core/api/machine-jobs/*`, hợp đồng
ở plan R3 mục I1): web Crew xếp việc cho một máy (`machineId` của bản tin crew-mac), app trên máy đó nhận bằng board key
và báo kết quả. Server không SSH vào Mac để chạy lệnh; app chỉ làm đúng 9 loại việc dưới đây (hai việc gỡ
`remove-checkouts`, `skill-remove` thêm ở R3X, hợp đồng ở plan R3X mục IX1; `runtimes-setup` thêm ở R2-4, hợp đồng I9).
Ô vai trò (`CrewRoleSlot`) có thêm `executor-codex`, `executor-opencode`, `reviewer-codex` (I11): `agent-workspace` và
`remove-checkouts` nhận cả 8 ô lẫn tên thư mục checkout của app (như `executor-1`; khớp `^[a-z][a-z0-9-]{0,30}$`, khác `repo`), còn `prepare-checkouts` vẫn đúng 4 hoặc 5 ô như plugin.
Việc `ensure-project` (server dựng project trên một máy) có `roles` là tên thư mục checkout
tự do (1–8, chữ thường, khác `repo`) và tối đa 5 repo đi kèm; kiểm payload chặn `~/crew-agents/<khóa>/{vai trò, repo, repo đi kèm}`
nằm dưới thư mục cấm. Mã lỗi `clone_auth_failed` thêm cho việc này.

**Vòng hỏi** (`poller.ts` → `createJobsPoller`):

- Company lấy từ bản tin crew-mac (`~/.crew/status.json` qua op `jobTargets` → `listTargets`): mỗi đích là
  `{url, companyId}`, cùng một `machineId`. Chưa cấu hình bản tin (không có `machineId`) thì không hỏi.
- **URL đích bản tin không dùng để hỏi việc** (`targets.ts` → `createTargetResolver`): đích có thể là địa chỉ khác của
  cùng server (vd. Tailscale `http://100.x:3100`), còn board key lưu theo origin đã đăng nhập. Mọi lời gọi hàng đợi đi
  tới `setup.paperclipOrigin` với key của origin đó. Chỉ hỏi company mà tài khoản thấy được (`GET /api/companies` bằng
  board key, nhớ 60 giây, đọc lại khi `app.json` đổi, ví dụ sau khi đăng nhập lại, hoặc khi gặp 403); company có đích
  mà tài khoản không thấy thì bỏ qua kèm lý do. Hai đích cùng company chỉ hỏi một lần. Chưa có origin hay key thì
  `MissingKeyError`, key 401 thì `PaperclipAuthError`: cả hai thành trạng thái "cần đăng nhập lại".
- Mỗi chu kỳ (5 giây khi có cửa sổ hiện, 15 giây khi ẩn) `POST …/machine-jobs/claim {companyId, machineId}` lần lượt
  từng company; 204 là không có việc. Board key đọc lại từ Keychain cho mỗi request.
- **Trạng thái nhận việc** (`poller.status()`, kênh `jobs:status` kèm `origin`): `problem` chung (chưa đăng nhập, key
  hết hạn, chưa có `machineId`, chưa có đích, lỗi đọc company), `needsLogin` (chỉ khi thiếu key hoặc 401) và từng
  company `ok`/lý do (403 → "không có quyền… cần thêm tài khoản vào company", lỗi mạng, bị bỏ qua). Đổi thì Main gửi
  `state:changed`. Màn Sức khỏe hiện khung "Nhận việc từ board" với nút **Đăng nhập lại**.
- Có việc thì làm xong và báo kết quả rồi mới hỏi tiếp, nên máy chỉ làm **một việc một lúc**.
- Đích lỗi (mạng, HTTP) thì lùi dần riêng đích đó: 2, 4, 8… lần chu kỳ, tối đa 60 giây; không ném, đích khác vẫn chạy.
- Việc trả về phải có `id` uuid, đúng `companyId` của đích và đúng `machineId`; sai thì báo `app_error`, không làm.
- Việc vượt **15 phút** (lease của plugin là 17 phút; áp cho mọi loại việc) thì app báo `app_error` "quá thời gian", bật `AbortSignal` (phần ở Main đang tải skill không được bắt đầu ghi file nữa), giết nhóm tiến trình của mọi `git` đang chạy (op `cancelMachineJob` → `killActiveGit`) rồi giết tiến trình phụ.
- Sau chu kỳ hỏi được ít nhất một đích, ghi `jobsAgent: {version: <bản app>, lastPollAt: <ISO>}` vào `app.json`, tối đa
  30 giây một lần (mỗi lần ghi `app.json` làm cửa sổ đọc lại trạng thái). Bản tin máy của crew-mac đọc key này
  (`readJobsAgent`) để web biết app đang nhận việc. Chưa đăng nhập Paperclip, hay mọi company đều lỗi (vd. 403), thì
  không ghi.
- Việc `prepare-checkouts`, `agent-workspace` hay `ensure-project` (web thêm project, thêm agent, hay server dựng project trên máy) làm xong thì Main
  (`register.ts`, `jobCreatedCheckouts`) gọi `ctx.sendStatusSoon('job:<loại>')`: bản tin máy được gửi sau khoảng 2 giây
  (gộp nếu nhiều việc liền nhau), chạy nền, lỗi chỉ ghi log, không đổi kết quả việc.
- Báo kết quả hỏng (mạng) thì chỉ ghi log: việc vẫn `claimed`, hết lease plugin trả về hàng đợi và máy làm lại (mọi việc
  đều chạy lại được).

**Chuẩn bị ở Main** (`remote.ts` → `createJobsRemote().prepare`, có board key): kiểm payload; `prepare-checkouts` có
`setupRunId` thì đọc `GET …/setup-runs/:id?companyId` lấy `projectId` (đọc không được thì `null`: vẫn dựng checkout,
chỉ không thêm repo vào bản tin docs); `skill-sync` tải `GET /api/companies/:c/skills/:id` (slug phải khớp payload)
rồi từng file `GET …/skills/:id/files?path=` (`content`, `encoding` utf8/base64, `executable`), lỗi thì
`skill_fetch_failed`.

**Làm trên máy** (`executors.ts` → `runJob`, chạy trong utilityProcess riêng "2P Crew jobs" qua op `runMachineJob`, để
hủy việc quá giờ được bằng cách giết tiến trình đó mà không đụng các thao tác khác). Trước khi làm: kiểm lại payload
đúng như plugin (`validate.ts`, bảng ca chép từ test của plugin; sai thì `app_error` "Việc không hợp lệ: …") và đường dẫn
(`machineGuardReason`):

- folder repo của owner theo luật thêm project (`folderGuardReason`: chặn gốc ổ đĩa, HOME, cha của HOME; **không** chặn
  `/Volumes` hay `~/Documents` vì app có Full Disk Access và folder chỉ được đọc);
- checkout agent `~/crew-agents/<khóa>/<vai trò>` theo `forbiddenRootReason` của crew-mac (không dưới `/Volumes`,
  `~/Desktop`, `~/Downloads`, không là HOME/cha HOME); áp cho cả checkout sắp gỡ của `remove-checkouts`.

Vi phạm thì `folder_forbidden`.

| Việc | Làm | Kết quả `done` | Mã lỗi |
|------|-----|----------------|--------|
| `inspect-folder {folder}` | `inspectFolder` (như thêm project), `git status --porcelain`, nhánh hiện tại, `crew-docs.bundle` | `{root, branch, remote, docsBundle, clean}`; `remote` bỏ userinfo của `http(s)://` và mật khẩu của scheme khác (`ssh://git@…` giữ user) | `folder_missing`, `folder_not_git` (mọi ca từ chối của `inspectFolder`, kèm lời của nó), `folder_forbidden` |
| `prepare-checkouts {projectKey, folder, roles}` | `configureDocsBundle` (bundle, runtime, hook crew-docs; lỗi thành `git_failed` "Không cài được crew-docs cho <folder>: …"); mỗi vai trò: worktree `~/crew-agents/<khóa>/<vai>` trên nhánh `branch` của payload (`ensureWorktree`, có rồi thì dùng lại), `.paperclip-runtime/` vào `info/exclude`; có `projectId` thì `addStatusRepo(projectId, <folder>, companyId)` một lần | `{checkouts:[{role, path, head}]}` | `checkout_exists` (thư mục có sẵn không phải worktree của repo này, không đè), `git_failed` |
| `agent-workspace {projectKey, folder, role, branch}` | như trên cho một vai trò (executor thứ 2 thêm sau), không đụng worktree khác | `{role, path, head}` | như trên |
| `ensure-project {projectKey, projectId, originUrl, branch, roles, companions}` | `ensure-project.ts` → `ensureProject`. Tìm repo có sẵn theo khóa origin (`originKey`: bỏ credential, `.git`, `/` cuối; `git@host:a/b`, `ssh://…`, `https://…` cùng khóa `host/a/b`, host không phân biệt hoa thường; `file://` và đường tuyệt đối thành đường dẫn), theo thứ tự: repo trong bản tin docs (`statusRepoPaths`), repo chính của mọi thư mục trong `~/crew-agents/*/*`, thư mục con cấp một của thư mục project quen thuộc (`projectRoots`, mặc định `~/Documents/projects`, `~/Projects`, `/Volumes/<ổ>/Projects` có thật); ứng viên phải qua `inspectFolder`. Có một bản thì không bao giờ clone thêm. Không có thì `git clone` vào `~/crew-agents/<khóa>/repo` (hạn 10 phút, `GIT_SSH_COMMAND` mặc định `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new`) rồi `remote set-head origin -a` (hạn 60 giây); chỗ đó đã là repo đọc được thì dùng lại. Chỉ xóa rồi clone lại khi chắc là bản clone dở: thư mục không có `.git`, hoặc có `.git` của chính nó mà `rev-parse HEAD` lỗi kiểu "unknown revision" (chưa có commit), không có nhánh local nào và `git worktree list` chỉ có chính nó. HEAD lỗi kiểu khác (quá giờ, `safe.directory`...), hay repo đã có nhánh/worktree agent thì `git_failed`, không xóa gì (repo chính chứa nhánh và commit chưa push của mọi worktree agent). Symlink hay file thì không đè. Clone lỗi thì xóa thư mục dở. Sau đó `origin/HEAD` trỏ về `origin/<branch>` nếu nhánh có ở remote (chỉ đổi ref local), `configureDocsBundle`, worktree từng vai trò như `prepare-checkouts`. Repo đi kèm: tìm như trên, có thì symlink `~/crew-agents/<khóa>/<tên>` → repo (symlink đúng rồi thì giữ), không có thì clone thẳng vào chỗ đó; chỗ đó có thứ khác (thư mục lạ không rỗng, symlink trỏ chỗ khác hay hỏng, repo khác origin) thì báo, không đè. Chạy lại cho cùng kết quả | `{repoPath, cloned, checkouts:[{role, path, head}], companions:[{name, path}]}` | `clone_auth_failed` (stderr git/ssh báo từ chối key, host key, hỏi mật khẩu, mà không phải mất mạng/DNS (đó là `git_failed`): câu hướng dẫn thêm key `~/.ssh/*.pub` vào GitHub, kiểm `ssh -T git@github.com`, rồi Thêm máy lại), `checkout_exists`, `git_failed` |
| `skill-sync {skillId, slug, version}` | ghi file đã tải vào thư mục tạm cạnh `~/.crew/skills/<company>/<slug>/` rồi đổi tên (thay trọn thư mục cũ); thư mục 0700, file 0600 (`executable` 0700). Đường dẫn file phải tương đối, không `..`, không ký tự điều khiển, ≤ 500 file, ≤ 20 MB | `{sha256, files}` (`treeChecksum` của crew-mac: `<path>\0<sha256 file>\n` đã sắp) | `skill_fetch_failed` |
| `remove-checkouts {projectId, projectKey, roles, removeStatusRepo}` | `roles` 1–8 tên thư mục checkout không trùng (tám ô hoặc tên như `executor-1`, khác `repo`). Mỗi vai (`remove.ts` → `removeCheckouts`): không có → `absent`; đường thật (`realpath`) phải đúng `<realpath HOME>/crew-agents/<khóa>/<vai>` (không symlink ở vai hay ở thư mục khóa) và là gốc một worktree **phụ** (`--git-dir` ≠ `--git-common-dir`, `--show-toplevel` = chính nó); `lsof -t +D <đường thật>` không ra PID (lsof của macOS thoát mã 1 cả khi thấy PID nên chỉ tin stdout; mã khác 0/1 hay không chạy được → coi là bận); `git -c core.fsmonitor=false status --porcelain` rỗng; HEAD tách rời thì commit hiện tại phải thuộc một nhánh/remote. Đủ thì `git --git-dir=<common> worktree remove <path>` **không `--force`** (git nhận worktree chỉ có tệp bị ignore như `.paperclip-runtime/`, từ chối khi có tệp sửa/mới hay worktree bị khóa). Không `worktree prune` (prune chạm cả worktree khác của owner, vd. trên ổ ngoài đang tháo), không xóa nhánh `crew/<khóa>/<vai>`, không đụng folder gốc. Xong: `rmdir ~/crew-agents/<khóa>` nếu rỗng; `removeStatusRepo` → op `removeStatusRepo(projectId)` (bỏ repo docs khỏi bản tin); Main (`register.ts` → `forgetRemovedProject`) xóa tiến độ project đó trong `app.json` | `{removed:[{role, path}], kept:[{role, path, reason, detail}], absent:[role]}`; `reason`: `dirty` (tệp chưa commit, hoặc commit lẻ ở HEAD tách rời), `busy`, `not_worktree`, `git_failed`; `detail` đã làm sạch | không có: checkout giữ lại vẫn là `done` kèm `kept` (owner tự quyết); lỗi bất ngờ → `app_error` |
| `skill-remove {skillId, slug}` | `remove.ts` → `removeSkill`: `~/.crew/skills/<company>/<slug>` không có → `removed:false`; có thì đường thật phải đúng `<realpath HOME>/.crew/skills/<company>/<slug>` (không symlink) rồi xóa đệ quy (`rmSync` không đi theo symlink bên trong), nên không bao giờ chạm `~/.crew/workflows` (Superpowers ghim) | `{removed}` | `folder_forbidden` (symlink ra ngoài, không xóa gì) |
| `runtimes-setup {}` | payload không có trường nào (kể cả `key`). Op `runtimesSetup` trong utilityProcess (`src/utility/ops.ts`): `setup(ctx, {})` cài/cập nhật `crew-codex-run`, `crew-opencode-run`, `crew-run-mark.sh`, rồi `runtimesStatus` (cùng dữ liệu `crew-mac runtimes status --json`). `runtimesResult` chỉ chép các trường của hợp đồng nên key, token, đường dẫn `auth.json` không bao giờ lên hàng đợi; key OpenCode owner nạp tay bằng `crew-mac runtimes key opencode` trong Terminal | `{wrappers:{codex, opencode}, codex:{version, loggedIn}, opencode:{version, keyPresent}}` (`null` = chưa rõ) | `app_error` (setup hay status ném lỗi, câu đã làm sạch) |
| `check {projectKey}` | `doctor` không probe (`skipTcc`) và `workflowCheck` (bản ghim Superpowers) cho từng thư mục trong `~/crew-agents/<khóa>/`, trừ bản clone chính (`.git` là thư mục: `repo`, repo đi kèm clone thẳng) | `{items:[{id, status, title}]}`; `fail` của doctor ở `wrapper`/`worktree-root` thành `error` (`worktree-workflows` quét cả `~/crew-agents` nên chỉ `warn`, workflow từng ô do `workflow:<vai>` kiểm), `fail` ở mục chung của máy (sshd, Tailscale, mục runtime `codex-auth`, `wrapper-codex`, `opencode-key`, `wrapper-opencode`, …) thành `warn` để không chặn project không liên quan; mục workflow `workflow:<vai>`; mục `crew-docs-project` (`error` khi hỏng): trong `~/crew-agents/<khóa>/integrator`, `git config --get crew-docs.bundle` phải trỏ tới file có thật; thiếu thì tự chạy lại `configureDocsBundle` trên checkout gốc (`git worktree list --porcelain`, dòng đầu) rồi kiểm lại, nên run cũ có `checkouts` xong từ bản app chưa cài crew-docs sửa được bằng Chạy tiếp; chưa có worktree integrator cũng là `error` | `check_failed` (có mục `error` của project, hoặc chưa có checkout nào): vẫn gửi `items` trong `result` |

Mọi lỗi gửi lên là mã cố định cộng câu tiếng Việt đã làm sạch (`sanitize.ts` → `sanitizeJobError`: bỏ mã terminal và
ký tự điều khiển trừ tab/xuống dòng, che `scheme://user:pass@` (tới `@` cuối trước `/`, nên mật khẩu chứa `@` cũng che hết) và các mẫu secret chép từ plugin, cắt 300 ký tự không cắt
đôi ký tự). Plugin làm sạch lần nữa.

**Báo kết quả** (`remote.ts` → `submit`): `POST …/machine-jobs/:id/result {companyId, machineId, status, result |
errorCode + errorText}`. `check` thất bại gửi kèm `result`; plugin không nhận `result` khi `failed` (400) thì gửi lại
không có `result`. Body luôn kèm `claimedAt` = đúng `claimedAt` server trả lúc claim; việc đã bị nhận lại thì plugin trả
409 "Việc đã được nhận lại", app chỉ ghi log và bỏ kết quả cũ, không gửi lại.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/mac-app/src/main/paperclip/types.ts` | Kiểu client Paperclip | `PaperclipClient`, `ProjectRoles`, `SshEnvironmentInput`, `ClaudeLocalAgentInput`, `MachinePairInput`, `MachinePairing` |
| `apps/mac-app/src/main/paperclip/client.ts` | REST có kiểu, origin, lỗi | `createPaperclipClient`, `normalizeOrigin`, `paperclipRequest`, `PaperclipAuthError`, `PaperclipHttpError` |
| `apps/mac-app/src/main/paperclip/cli-auth.ts` | Đăng nhập `cli-auth` | `createLoginFlow` |
| `apps/mac-app/src/main/paperclip/keychain.ts` | Board key trong Keychain (bản mã) | `createBoardKeyStore`, `BOARD_KEY_SERVICE` |
| `apps/mac-app/src/main/paperclip/register.ts` | Kênh IPC, `security`, `safeStorage` | `registerPaperclip`, `paperclipClient`, `boardKeys` |
| `apps/mac-app/src/main/projects/progress.ts` | Tiến độ trong `app.json`, đường dẫn, tên vai trò, lệnh gỡ owner tự chạy | `ProjectDeps`, `ProgressRecorder`, `roleNames`, `projectPaths`, `KEY_RE`, `isLegacyProgress`, `manualRemoveCommand` |
| `apps/mac-app/src/main/projects/folder.ts` | Kiểm folder owner chọn, worktree agent, `info/exclude`, bundle crew-docs, `git` của owner | `inspectFolder`, `folderGuardReason`, `suggestKey`, `ensureWorktree`, `isWorktreeOf`, `agentBranch`, `ensureRuntimeExcluded`, `configureDocsBundle`, `runProcess`, `runGit`, `killActiveGit`, `shellQuote` |
| `apps/mac-app/src/main/projects/docs-runtime.ts` | Runtime/bundle crew-docs: kiểm runtime, cài bundle mang theo, tự sửa git config lúc app mở | `runtimeProblem`, `installDocsBundle`, `installedDocsBundle`, `repairDocsConfig`, `repairDocsOnStart`, `DocsRepairReport` |
| `apps/mac-app/src/main/projects/ipc.ts` | Ghép danh sách project REST với trạng thái Mac; chọn folder; thêm/gỡ; thêm xong không lỗi thì gọi `onAdded` | `createProjectsIpc` |
| `apps/mac-app/src/main/projects/register.ts` | Đăng ký kênh `projects:*` với deps thật, hộp thoại chọn thư mục, tự sửa hook crew-docs lúc app mở, gửi bản tin máy sớm sau khi thêm xong | `registerProjects` |
| `apps/mac-app/src/renderer/routes/projects.tsx` | Màn hình Project: danh sách, wizard thêm (Chọn folder), Chạy tiếp, Gỡ khỏi Mac | `ProjectsScreen`, `stepLabel` |
| `apps/mac-app/src/main/projects/add-project.ts` | Các bước thêm project; bộ lọc environment khuôn (kèm điều kiện secret thuộc company) dùng chung với bước Máy | `addProject`, `isInPlaceSshTemplate`, `isCompanyTemplate`, `inPlaceSshTemplates`, `companySecretIds` |
| `apps/mac-app/src/main/projects/remove-project.ts` | Gỡ project khỏi Mac | `removeProject` |
| `apps/mac-app/src/main/projects/instructions.ts` | Template, render, `baseHash`, `extraArgs` ghim | `ROLE_TEMPLATES`, `renderInstructions`, `uploadInstructions`, `pinnedExtraArgs` |
| `apps/mac-app/src/main/projects/templates/*.md` | `AGENTS.md` theo vai trò (chép từ fork `crew/agents/*.md`) | |
| `apps/mac-app/src/main/jobs/types.ts` | Kiểu hàng đợi máy (chép từ plugin), `JobOutcome`, `JobExtras`, `JobError` | `MachineJob`, `JobPayload`, `JobResult`, `JobErrorCode`, `JOB_TIMEOUT_MS` |
| `apps/mac-app/src/main/jobs/validate.ts` | Kiểm payload như plugin, chặn đường dẫn trên máy | `validateJobPayload`, `machineGuardReason`, `checkoutPath` |
| `apps/mac-app/src/main/jobs/sanitize.ts` | Làm sạch lỗi gửi lên, bỏ credential trong URL remote (giữ user `ssh://`) | `sanitizeJobError`, `stripUrlCredentials` |
| `apps/mac-app/src/main/jobs/executors.ts` | 9 loại việc trên máy (chạy trong utilityProcess) | `runJob`, `ExecutorDeps` |
| `apps/mac-app/src/main/jobs/ensure-project.ts` | Dựng project trên máy: tìm repo theo origin hoặc clone, worktree, repo đi kèm | `ensureProject`, `findRepo`, `originKey`, `defaultProjectRoots` |
| `apps/mac-app/src/main/jobs/remove.ts` | Gỡ checkout (giữ checkout bẩn/bận/lạ), xóa bản chép skill, bỏ tiến độ project đã gỡ | `removeCheckouts`, `removeSkill`, `forgetRemovedProject`, `runLsof` |
| `apps/mac-app/src/main/jobs/poller.ts` | Vòng hỏi, lùi dần, một việc một lúc, quá giờ, `jobsAgent`, trạng thái nhận việc | `createJobsPoller`, `MissingKeyError`, `JobsStatus` |
| `apps/mac-app/src/main/jobs/targets.ts` | Hỏi việc ở origin board đã đăng nhập, chỉ company tài khoản thấy được | `createTargetResolver` |
| `apps/mac-app/src/main/jobs/remote.ts` | REST của hàng đợi (claim, result), lấy trước `projectId` và file skill | `createJobsRemote` |
| `apps/mac-app/src/main/jobs/register.ts` | Nối vòng hỏi với Keychain, utilityProcess "2P Crew jobs", `app.json` (`jobsAgent`, bỏ tiến độ sau gỡ project), kênh `jobs:status`; báo đổi trạng thái chỉ gửi vào cửa sổ và `webContents` còn sống; việc tạo checkout xong thì gửi bản tin máy sớm | `registerJobs` |

## Tests

- `apps/mac-app/test/jobs/validate.test.ts`: bảng ca của plugin (chép nguyên), khóa `e2e-x`, folder HOME/cha HOME bị
  chặn, folder dưới `~/Documents`/`/Volumes` được, checkout dưới `/Volumes` bị chặn; `remove-checkouts` (`projectKey`
  `../x`, `roles` rỗng/6 phần tử/trùng/lạ/object, `removeStatusRepo` không boolean, key lạ `force`) và `skill-remove`
  (`slug` `..`, `../workflows`, có `/`, rỗng, 65 ký tự); `runtimes-setup` (payload rỗng, `kind` khớp, trường lạ, không bị chặn theo đường dẫn) và ba ô vai trò mới.
- `apps/mac-app/test/jobs/remove.test.ts` (HOME giả, repo git thật trong `mkdtemp`): sạch (kèm `.paperclip-runtime`) →
  `removed`, nhánh và folder gốc còn; sửa/tệp mới → `kept dirty`; lsof giả trả PID (mã 1) và lsof không chạy được →
  `kept busy`; lsof thật với process đứng ở thư mục con; symlink vai trỏ tới worktree thật bên ngoài, thư mục khóa là
  symlink → `not_worktree`, đích còn; repo clone riêng (worktree chính), thư mục thường → `not_worktree`; HEAD tách rời
  có commit lẻ → `dirty`; worktree bị khóa → `git_failed`; không có → `absent`, chạy lại; gỡ hết → `rmdir`, gọi
  `removeStatusRepo`; `forgetRemovedProject` chỉ bỏ tiến độ khi gỡ project `done`; `skill-remove` xóa đúng thư mục (symlink
  bên trong không kéo theo đích), không có → `false`, slug/thư mục company là symlink sang `~/.crew/workflows` → từ
  chối, `../workflows` → `app_error`.
- `apps/mac-app/test/jobs/executors.test.ts` (HOME giả, repo git thật trong `mkdtemp`): `inspect-folder` (bundle, cây
  sạch/không sạch, remote bỏ credential, `folder_not_git`/`folder_missing`/`folder_forbidden`, key lạ), `prepare-checkouts`
  4 vai trò (nhánh, exclude, bundle, runtime node thật, `addStatusRepo` một lần, chạy lại cho cùng kết quả, không `projectId` thì không
  add-repo, `checkout_exists`, `install-hooks` lỗi → `git_failed` kèm repo và lý do), `agent-workspace` thêm `executor-2` không đụng worktree khác, `skill-sync` (0700, băm
  cây, thay trọn, đường dẫn xấu không ghi gì), `runtimes-setup` (đúng hợp đồng, bỏ trường thừa như key/đường `auth.json`, lỗi → `app_error` đã làm sạch, payload lạ không gọi setup), `check` (mục doctor runtime `fail` chỉ thành `warn`; items, lỗi chung của máy → done kèm `warn`, lỗi worktree/workflow → `check_failed` kèm items, chưa có checkout; `crew-docs-project`: worktree integrator mất bundle thì
  tự cài lại rồi đạt, bundle mất hẳn hay chưa có worktree integrator thì `error`).
- `apps/mac-app/test/jobs/ensure-project.test.ts` (HOME giả, repo git thật trong `mkdtemp`): `originKey` các dạng URL;
  dùng lại repo trong bản tin docs (không clone, có bundle crew-docs), tìm ở thư mục project quen thuộc; không có thì clone
  vào `repo` (`origin/HEAD` đúng), chạy lại cho cùng kết quả; clone dở (không `.git`, hay `.git` không có HEAD) bị clone
  lại; repo có nhánh/worktree mà HEAD hỏng, hay `rev-parse HEAD` lỗi vì quá giờ/`safe.directory` → `git_failed`, không xóa;
  ssh giả từ chối key → `clone_auth_failed`, không để lại thư mục; ssh giả báo không phân giải được host → `git_failed`;
  `defaultProjectRoots` chỉ giữ thư mục có thật; repo đi kèm có sẵn → symlink, chạy lại giữ, thư
  mục lạ chắn chỗ → `checkout_exists` không đè; repo đi kèm không tìm thấy → clone thẳng, `check` bỏ qua bản clone;
  thư mục lạ hay symlink hỏng ở chỗ repo đi kèm khi phải clone → `checkout_exists`, còn nguyên.
- `apps/mac-app/test/jobs/validate.test.ts` còn kiểm `ensure-project` (khóa, nhánh, `roles` 1–8 tên thư mục, repo đi kèm, đường dẫn cấm) và `remove-checkouts` nhận tên thư mục checkout; `remove.test.ts` thêm ca gỡ worktree `executor-1`.
- `apps/mac-app/test/jobs/sanitize.test.ts`: stderr git có `https://user:token@…` và mã màu, mẫu secret, 300 ký tự;
  `stripUrlCredentials` giữ `ssh://git@…`, bỏ mật khẩu `ssh://user:…@`, bỏ cả token `https://token@…`.
- `apps/mac-app/test/jobs/poller.test.ts` (fake timers): claim từng đích, 204, chạy rồi báo, 5/15 giây, lùi tới 60 giây
  riêng đích lỗi, một việc một lúc, quá 15 phút, việc sai company, `lastPollAt` 30 giây một lần, chưa có key, chưa có
  `machineId`, `stop`; trạng thái nhận việc: ổn, chưa có key, 401, 403 (không bảo đăng nhập lại), company bị bỏ qua,
  không có đích, chỉ báo khi đổi.
- `apps/mac-app/test/jobs/targets.test.ts`: đích Tailscale vẫn hỏi ở origin board, company không có quyền bị bỏ qua,
  gộp đích trùng company, chưa có origin, không đích, nhớ 60 giây/`invalidate`/lỗi không nhớ, đổi origin.
- `apps/mac-app/test/jobs/remote.test.ts` (Paperclip giả): đường dẫn/body/Bearer của claim và result, 204, chưa có key
  không gửi gì, lỗi làm sạch, `check` thất bại bị 400 thì gửi lại không `result`, lấy `projectId` từ setup run, tải file
  skill, skill không có hoặc slug khác.

- `apps/mac-app/test/paperclip-client.test.ts`: Paperclip giả trên `127.0.0.1` (`paperclip-fake-server.ts`); Bearer,
  đọc key mỗi lời gọi, timeout, 401/403/422, log không có key, đường dẫn và body từng route, không có `DELETE`
  environment; `createAgent` gửi đúng `adapterConfig` (`engine: "cli"`, `model`, `env: {}`) và từ chối khi thiếu
  `model`; `agents`/`getAgent` trả `engine`, không trả `env`; `setAgentPermissions` gửi đủ ba quyền, từ chối giá trị
  không boolean; `getAgentPermissions` đọc grant `tasks:assign` (không tin `access.canAssignTasks`), thiếu
  `canCreateSkills` là được tạo skill, thiếu `access.grants` thì ném, 404 → `null`. Ghép máy: `pairInfo` đúng route
  và query, key sai dạng thì ném, 409 thành `PaperclipHttpError` 409; `pairMachine` gửi đúng các key, `allowRepair`
  chỉ khi được yêu cầu, log không có key máy, 409 giữ `code` (`machine_revoked`, `machine_uses_company_secret`), key
  máy sai dạng thì ném.
  `machineBlockers`/`releaseProjectMachines`/`provisionProjectMachines`: đúng đường, body và Bearer; 404 (server cũ) thành `null`.
- `apps/mac-app/test/paperclip-cli-auth.test.ts`: body thử thách, `approvalUrl`, poll `pending/approved/expired/cancelled/404`,
  lưu key đúng một lần (kể cả hai poll song song), log không có token.
- `apps/mac-app/test/paperclip-keychain.test.ts`: lệnh `security`, giá trị lưu là bản mã, mã 44, mục cũ không mã hóa,
  giải mã hỏng, lỗi Keychain không lộ key.
- `apps/mac-app/test/projects-fixture.ts`: Paperclip giả có trạng thái (project, environment, agent, `AGENTS.md` có
  `contentHash`, vai trò; luật lỗi, kể cả "server làm rồi mới lỗi"), `OpsBridge` giả, HOME giả, repo bare làm remote
  giả và folder owner (clone của remote đó, nằm ngoài HOME) dưới `mkdtemp`. Không chạm `~/crew-agents`, `~/.crew`,
  `/Volumes` thật hay Paperclip thật.
- `apps/mac-app/test/projects-add.test.ts`: khuôn bỏ qua environment có secret của company khác dù đứng đầu danh sách, chỉ có của company khác thì báo, không tạo; chạy đủ (worktree của folder, nhánh `agent/<key>-<vai>` từ nhánh mặc
  định, `crew-docs.bundle`, `crew-docs.runtime` là node thật, `info/exclude`, không có `~/crew-projects`; 4 agent, 4 environment, thứ tự pause → vai trò →
  resume), folder owner đang dở việc (nhánh khác, sửa chưa commit, file đã add) không đổi gì, bundle có sẵn được giữ,
  lỗi ở `role:reviewer` rồi chạy tiếp không tạo trùng, response tạo agent bị mất, từ chối trước mọi lời gọi, folder
  khác/đã thêm với khóa khác, thư mục lạ ở chỗ checkout không bị đè, gỡ → chạy lệnh in ra → thêm lại dùng lại nhánh,
  tiến độ kiểu cũ, hai executor, chờ duyệt agent, plugin từ chối vai trò, kiểm cuối hỏng không resume, agent đọc lại
  thiếu `engine` cli thì lỗi ở `check` và không resume. Agent tạo ra có `engine: "cli"`, `env: {}`, model theo vai.
  Khuôn environment: máy đã ghép lấy đúng environment đã ghép (không lấy `mac-mini` cùng cổng), máy chưa ghép giữ
  cách cũ, environment đã ghép bị archive thì lỗi bảo ghép lại và không tạo environment nào.
  Quyền: mọi agent bị PATCH quyền agent Crew trước khi resume (chỉ Trợ Lý giữ `tasks:assign`); tiến độ bản cũ đã qua
  mọi `role:*` với agent còn quyền mặc định thì Chạy tiếp đặt quyền rồi resume; Paperclip không áp quyền hay Trợ Lý
  mất `tasks:assign` thì `check` lỗi tiếng Việt và không resume. Paperclip giả cho agent mới quyền mặc định như server
  và có route `PATCH /agents/:id/permissions`.
  Thêm xong thì nhờ server dựng sẵn máy khác; server lỗi không làm hỏng lần thêm; origin `ssh://git:…@` gửi server thành
  `ssh://git@…`.
- `apps/mac-app/test/projects-folder.test.ts`: `inspectFolder` (gốc, `.git` chung, origin, nhánh mặc định và thứ tự
  dự phòng; từng ca từ chối), `folderGuardReason` không chặn `/Volumes`, `suggestKey`.
- `apps/mac-app/test/projects-docs-runtime.test.ts` (HOME giả, repo git thật, binary `.app` giả): `runtimeProblem` từng
  ca; `installDocsBundle` chép khi thiếu/khác, giống hệt không ghi lại, thiếu bản mang theo thì ném; `configureDocsBundle`
  thay runtime trong `.app` bằng node, giữ bundle/runtime owner còn dùng được (không dò node), không chép runtime hỏng
  của repo khác, không có node thì đặt bundle rồi ném lỗi tiếng Việt; cài hook (bundle giả làm như `install-hooks`, và bundle
  thật `packages/docs-kit/dist/crew-docs.cjs` khi đã build): repo chưa có `docs/flows.yaml` vẫn được cài, `.githooks` tương đối
  thành tuyệt đối và worktree thấy cùng thư mục hook, chạy lại không chạy `install-hooks` và không đổi git config hay hook,
  husky và `core.hooksPath` riêng được giữ, `install-hooks` lỗi thì ném câu kèm mã và lý do; `repairDocsConfig` sửa runtime `.app` và bundle mất, giữ repo
  lành, bỏ qua repo không dùng crew-docs, dò node một lần, không có node hay git lỗi thì ghi lý do; `repairDocsOnStart`
  ghi log từng sửa chữa, lỗi chỉ thành `warn`.
- `apps/mac-app/test/projects-remove.test.ts`: thứ tự gỡ, lệnh `git -C … worktree remove …`, không xóa project/worktree,
  folder owner sạch, chạy lại, lỗi giữa chừng, project không do app thêm, quote đường dẫn, tiến độ kiểu cũ.
  Cây ghim máy còn run thì từ chối, không pause hay archive; máy khác được dọn thì `removed` ghi số environment và số máy;
  agent trong tiến độ mà owner đã thay ở ô không gửi server, dòng vai trò đã xóa thì không gọi dọn máy khác.
- `apps/mac-app/test/projects-instructions.test.ts`: sha256 template, render Trợ Lý, `extraArgs` ghim, `baseHash`.
- `apps/mac-app/test/projects-ipc.test.ts`: `projects:list` ghép project với tiến độ, checkout (thứ tự vai trò, `head`),
  repo docs và commit gửi cuối; project R1 không có vai trò; thêm dở chưa có project; chưa chọn company; thêm → liệt kê
  → gỡ với Paperclip giả và HOME giả; `pickFolder` (Hủy, gợi ý tên/khóa, folder hỏng trả `problem`).
- `apps/mac-app/test/projects-ipc-add.test.ts`: `projects:add` thêm xong không lỗi gọi `onAdded` đúng một lần; thêm dở
  (`progress.error`) hay ném lỗi thì không gọi, lỗi vẫn tới người gọi.
- `apps/mac-app/test/renderer/projects.test.tsx`: danh sách, "Chọn folder" hiện đường dẫn và gợi ý tên/khóa, folder
  hỏng khóa nút, khóa sai khóa nút, dữ liệu gửi đi, bước hiện tại + lỗi + "Chạy tiếp", tiến độ kiểu cũ không có "Chạy
  tiếp", "Gỡ khỏi Mac" hỏi xác nhận rồi hiện lệnh bỏ worktree.

## Màn hình Project

- `projects:list` trả `ProjectRow[]`: project từ `GET /projects` của company đang chọn, ghép với `projects[key]` trong
  `app.json` (theo `projectId`) và `listStatusRepos` (repo ảnh chụp docs, `lastCommit` là commit đã gửi cuối — lấy từ
  `status-repos.json`, không phải `status-last.json` vì file đó chỉ ghi kết quả lần gửi). `checkouts` lấy từ tiến độ
  (`head` = `git rev-parse --short HEAD`), nên project R1 không do app thêm có `checkouts` rỗng. Tiến độ chưa có
  project trên Paperclip hiện thành dòng `projectId: ""`, tên = khóa.
- Tiến độ thêm project đi tới renderer qua `state:changed` (mỗi bước ghi `app.json` làm `AppStateStore` báo thay
  đổi); renderer đọc lại `projects:list`. `projects:add` chỉ trả khi xong hoặc lỗi nên renderer giữ khóa đang chạy.
- Wizard "Thêm project": nút "Chọn folder" gọi `projects:pickFolder` (hộp thoại chọn thư mục của macOS mở ở Main);
  trả `{ folder, name, key, problem }` — đường dẫn gốc repo, tên = tên folder, khóa gợi ý (`suggestKey`: bỏ dấu, chữ
  thường, gạch ngang, thêm `p-` nếu bắt đầu bằng số), `problem` = lời kiểm folder (khác null thì khóa nút "Bắt đầu
  thêm"). Tên và khóa sửa được; chọn 1–2 executor.
- "Chạy tiếp" gọi lại `projects:add` với `folder`/`key` từ tiến độ, tên từ dòng, số executor đếm từ `agents`. Tiến độ
  kiểu cũ (không có `folder`) không có "Chạy tiếp", chỉ hiện lời nhắc gỡ rồi thêm lại.
- "Gỡ khỏi Mac" (khi project có trên Mac hoặc có tiến độ) hỏi xác nhận, gọi `projects:remove`, hiện `removed` và
  `manualCommand` (nút "Chép lệnh"); app không xóa worktree, không đụng folder repo.
