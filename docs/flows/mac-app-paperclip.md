# App macOS: đăng nhập Paperclip, client REST, thêm/gỡ project

> Flow `mac-app-paperclip`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-app-paperclip`
> in ra đúng danh sách đó.

## Mục đích

App "2P Crew" lấy board API key của owner bằng luồng `cli-auth` có sẵn của Paperclip (owner duyệt trên web), giữ key
trong Keychain sao cho chỉ app đọc được, và gọi REST Paperclip có kiểu (company, project, environment SSH, agent,
instructions, hủy run, vai trò theo project). Thêm/gỡ project (`src/main/projects/`) dùng client này để dựng một bộ
agent riêng cho mỗi project; màn hình Project (`src/renderer/routes/projects.tsx`, kênh `projects:*`) gọi logic đó.

## Điểm vào

- Kênh IPC `paperclip:login(origin)`, `paperclip:loginStatus()`, `paperclip:companies()` (đăng ký trong
  `src/main/paperclip/register.ts` → `registerPaperclip`, gọi từ `src/main/index.ts`).
- `paperclipClient(ctx)` cho code Main khác (sức khỏe/run, wizard, project): client của origin đã đăng nhập trong
  `app.json` (`setup.paperclipOrigin`).
- `addProject(deps, input)` và `removeProject(deps, projectId)` (`src/main/projects/{add-project,remove-project}.ts`):
  logic Main. `deps` = `{ home, env, client, ops, store, log? }`.
- Kênh IPC `projects:list()`, `projects:add(input)`, `projects:remove(projectId)` (`src/main/projects/register.ts` →
  `registerProjects`, logic không phụ thuộc Electron ở `src/main/projects/ipc.ts` → `createProjectsIpc`). Màn hình
  Project ở route `#/projects`.

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
| `agents` | `GET /api/companies/:id/agents` | tìm lại agent đã tạo khi response bị mất |
| `pauseAgent` | `POST /api/agents/:id/pause` | agent không tạo thẳng ở `paused` được |
| `resumeAgent` | `POST /api/agents/:id/resume` | server từ chối agent `pending_approval`/`terminated` (409) |
| `patchAgent` | `PATCH /api/agents/:id` | |
| `getInstructionsFile` | `GET /api/agents/:id/instructions-bundle/file?path=AGENTS.md` | `{ content, hash = contentHash }`; 404 → `null`; hash sai dạng thì ném |
| `putInstructionsFile` | `PUT /api/agents/:id/instructions-bundle/file` | `{ path, content, baseHash }`: `baseHash` = hash của GET; `null` chỉ khi chưa có file (có rồi → 409); thiếu → 422 |
| `cancelRun` | `POST /api/heartbeat-runs/:runId/cancel` | |
| `runWebUrl` | `GET /api/heartbeat-runs/:runId` rồi `GET /api/companies/:id` | `<origin>/<issuePrefix>/agents/<agentId>/runs/<runId>`; prefix nhớ theo company |
| `getRoles` / `setRoles` / `deleteRoles` | `GET`/`POST`/`DELETE /api/plugins/crew.core/api/projects/:projectId/roles` | `companyId` ở query (GET/DELETE) hoặc body (POST); `setRoles` 400 → message kèm lời từ chối của plugin (bỏ key, ≤ 300 ký tự), ví dụ agent đang giữ vai trò ở project nào |

## Thêm project

`addProject(deps, { origin, name, key, executors })`: `origin` là URL git, `key` khớp `^[a-z][a-z0-9-]{1,30}$`,
`executors` 1 hoặc 2. Ném trước mọi lời gọi khi: dữ liệu sai dạng, chưa chọn company (`setup.companyId`), đường dẫn bị
`forbiddenRootReason` chặn, `~/crew-agents/<key>` hoặc `~/crew-projects/<key>` đã có mà chưa có tiến độ, tiến độ đang
dở của khóa này trỏ repo khác, hay số executor khác lần trước.

Tiến độ nằm ở `app.json` → `projects[key]` (`ProjectProgress`). Mỗi bước có trong `done` thì bỏ qua; mỗi id tạo ra
(project, environment, agent) được ghi ngay sau khi có. Lỗi ở bước nào thì ghi `error`, pause mọi agent của project
đang chạy được rồi trả tiến độ (không ném); chạy lại tiếp từ bước dở. Hai lần thêm cùng khóa không chạy song song.

| Bước | Việc |
|------|------|
| `ls-remote` | `git ls-remote --exit-code <origin> HEAD` bằng `/usr/bin/git` của owner (`GIT_TERMINAL_PROMPT=0`, 60 giây). Hỏng → "Không đọc được repo bằng git trên máy này", chưa gọi Paperclip |
| `mirror` | Clone thường (không `--mirror`, vì `crew-mac status` đọc `origin/HEAD`) vào `~/crew-projects/<key>` (10 phút). Có `docs/flows.yaml` thì đặt `crew-docs.bundle` (và `crew-docs.runtime` nếu có) lấy từ repo trong `listStatusRepos`, không có thì `~/.crew/bin/crew-docs.cjs` |
| `project` | Project cùng tên đã có thì dùng lại, không thì `createProject` |
| `status-repo` | `ops.addStatusRepo(projectId, ~/crew-projects/<key>)` |
| `role:<vai>` | Theo thứ tự `executor-1`, (`executor-2`), `assistant`, `reviewer`, `integrator` (executor trước để Trợ Lý có danh sách id). Clone checkout riêng `~/crew-agents/<key>/<vai>`; thêm `.paperclip-runtime/` vào `.git/info/exclude`; `crew-docs.bundle` như trên. Environment `<key>-<vai>`: SSH `in_place`, `remoteWorkspacePath` = checkout, host/user/`knownHosts`/`crewLoadGate` và secret SSH (`privateKeySecretRef.secretId`) lấy từ environment SSH `in_place` đang `active` của máy (cùng cổng `manifest.port` của `crew-mac setup`). Agent `<key>-<vai>`: `claude_local`, `command` = `<home>/.crew/bin/crew-claude-run`, `extraArgs` = bản ghim Superpowers (`setup().superpowers`, kiểm khuôn như `merge-agent-config.mjs`), heartbeat tắt, `maxConcurrentRuns: 1`, `defaultEnvironmentId` = environment trên. Agent (và environment) đã có trên server cùng tên mà chưa có trong tiến độ (response bị mất) thì dùng lại. Rồi giữ agent ở `paused`; tải `AGENTS.md` |
| `roles` | `setRoles(companyId, projectId, { assistantAgentId, executorAgentIds, reviewerAgentId, integratorAgentId })`. Plugin kiểm luật (reviewer ≠ integrator, 1–2 executor, không vai trò chéo giữa project, không agent `terminated`) |
| `check` | `doctor({ probe: false, skipTcc: true })` không có `fail` ở `worktree-workflows`, `worktree-root`; `workflowCheck` sạch cho từng checkout; `getRoles` đọc lại khớp. Đạt thì mới `resumeAgent` các agent đang `paused` |

Agent mới ở `paused` từ ngay sau khi tạo tới bước `check`. Company bật `requireBoardApprovalForNewAgents` thì agent
tạo ra ở `pending_approval`: app không pause agent đó (pause sẽ đưa nó khỏi hàng chờ duyệt), mà hỏi lại mỗi 10 giây,
tối đa 30 phút ("Chờ duyệt agent trên web"); được duyệt rồi mới pause.

`AGENTS.md` (`instructions.ts`): template `templates/{assistant,executor,reviewer,integrator}.md` chép nguyên văn từ
`crew/agents/*.md` của fork (test so sha256). `renderInstructions` port từ `render-instructions.mjs`: chỉ Trợ Lý nhận
danh sách id executor của project (mục "Executor của company", tên mục giữ như template tham chiếu). `uploadInstructions`
theo `add-base.mjs`: GET file lấy hash làm `baseHash` (`null` chỉ khi 404), nội dung đã đúng thì không PUT.

## Gỡ khỏi Mac

`removeProject(deps, projectId)`:

1. Pause agent của project (chỉ agent trong tiến độ của app; agent đang `paused`/`terminated`/`pending_approval` bỏ
   qua). Pause hủy run đang chạy của agent đó.
2. Archive environment riêng của chúng (`PATCH { status: "archived" }`; không bao giờ `DELETE`).
3. `ops.removeStatusRepo(projectId)`.
4. Có dòng vai trò thì `deleteRoles`.
5. Xóa `projects[key]` khỏi `app.json` khi mọi bước xong (lỗi giữa chừng thì giữ để chạy lại).

Không xóa project trên Paperclip, không xóa thư mục: trả `{ removed, manualCommand }` với
`manualCommand = "rm -rf ~/crew-agents/<key> ~/crew-projects/<key>"` để owner tự chạy (rỗng khi project không do app
thêm). Chạy lại khi đã gỡ không lỗi. Project không do app thêm (ví dụ `repo-a` của R1) chỉ bị `remove-repo` và xóa
dòng vai trò, không agent nào bị pause.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/mac-app/src/main/paperclip/types.ts` | Kiểu client (Interface I6) | `PaperclipClient`, `ProjectRoles`, `SshEnvironmentInput`, `ClaudeLocalAgentInput` |
| `apps/mac-app/src/main/paperclip/client.ts` | REST có kiểu, origin, lỗi | `createPaperclipClient`, `normalizeOrigin`, `paperclipRequest`, `PaperclipAuthError`, `PaperclipHttpError` |
| `apps/mac-app/src/main/paperclip/cli-auth.ts` | Đăng nhập `cli-auth` | `createLoginFlow` |
| `apps/mac-app/src/main/paperclip/keychain.ts` | Board key trong Keychain (bản mã) | `createBoardKeyStore`, `BOARD_KEY_SERVICE` |
| `apps/mac-app/src/main/paperclip/register.ts` | Kênh IPC, `security`, `safeStorage` | `registerPaperclip`, `paperclipClient`, `boardKeys` |
| `apps/mac-app/src/main/projects/progress.ts` | Tiến độ trong `app.json`, đường dẫn, tên vai trò | `ProjectDeps`, `ProgressRecorder`, `roleNames`, `projectPaths`, `KEY_RE` |
| `apps/mac-app/src/main/projects/ipc.ts` | Ghép danh sách project REST với trạng thái Mac; thêm/gỡ | `createProjectsIpc` |
| `apps/mac-app/src/main/projects/register.ts` | Đăng ký kênh `projects:*` với deps thật | `registerProjects` |
| `apps/mac-app/src/renderer/routes/projects.tsx` | Màn hình Project: danh sách, wizard thêm, Chạy tiếp, Gỡ khỏi Mac | `ProjectsScreen`, `stepLabel` |
| `apps/mac-app/src/main/projects/add-project.ts` | Các bước thêm project | `addProject`, `runGit` |
| `apps/mac-app/src/main/projects/remove-project.ts` | Gỡ project khỏi Mac | `removeProject` |
| `apps/mac-app/src/main/projects/instructions.ts` | Template, render, `baseHash`, `extraArgs` ghim | `ROLE_TEMPLATES`, `renderInstructions`, `uploadInstructions`, `pinnedExtraArgs` |
| `apps/mac-app/src/main/projects/templates/*.md` | `AGENTS.md` theo vai trò (chép từ fork `crew/agents/*.md`) | |

## Tests

- `apps/mac-app/test/paperclip-client.test.ts`: Paperclip giả trên `127.0.0.1` (`paperclip-fake-server.ts`); Bearer,
  đọc key mỗi lời gọi, timeout, 401/422, log không có key, đường dẫn và body từng route, không có `DELETE`
  environment.
- `apps/mac-app/test/paperclip-cli-auth.test.ts`: body thử thách, `approvalUrl`, poll `pending/approved/expired/cancelled/404`,
  lưu key đúng một lần (kể cả hai poll song song), log không có token.
- `apps/mac-app/test/paperclip-keychain.test.ts`: lệnh `security`, giá trị lưu là bản mã, mã 44, mục cũ không mã hóa,
  giải mã hỏng, lỗi Keychain không lộ key.
- `apps/mac-app/test/projects-fixture.ts`: Paperclip giả có trạng thái (project, environment, agent, `AGENTS.md` có
  `contentHash`, vai trò; luật lỗi, kể cả "server làm rồi mới lỗi"), `OpsBridge` giả, HOME giả và repo git gốc dưới
  `mkdtemp`. Không chạm `~/crew-agents`, `~/.crew` thật hay Paperclip thật.
- `apps/mac-app/test/projects-add.test.ts`: chạy đủ (4 agent, 4 environment, thứ tự pause → vai trò → resume), lỗi ở
  `role:reviewer` rồi chạy tiếp không tạo trùng, response tạo agent bị mất, từ chối trước mọi lời gọi, `ls-remote`
  hỏng, hai executor, chờ duyệt agent, plugin từ chối vai trò, kiểm cuối hỏng không resume.
- `apps/mac-app/test/projects-remove.test.ts`: thứ tự gỡ, không xóa project/thư mục, chạy lại, lỗi giữa chừng, project
  không do app thêm.
- `apps/mac-app/test/projects-instructions.test.ts`: sha256 template, render Trợ Lý, `extraArgs` ghim, `baseHash`.
- `apps/mac-app/test/projects-ipc.test.ts`: `projects:list` ghép project với tiến độ, checkout (thứ tự vai trò, `head`),
  repo docs và commit gửi cuối; project R1 không có vai trò; thêm dở chưa có project; chưa chọn company; thêm → liệt kê
  → gỡ với Paperclip giả và HOME giả.
- `apps/mac-app/test/renderer/projects.test.tsx`: danh sách, khóa sai khóa nút, dữ liệu gửi đi, bước hiện tại + lỗi +
  "Chạy tiếp", "Gỡ khỏi Mac" hỏi xác nhận rồi hiện lệnh xóa thư mục.

## Màn hình Project

- `projects:list` trả `ProjectRow[]`: project từ `GET /projects` của company đang chọn, ghép với `projects[key]` trong
  `app.json` (theo `projectId`) và `listStatusRepos` (repo ảnh chụp docs, `lastCommit` là commit đã gửi cuối — lấy từ
  `status-repos.json`, không phải `status-last.json` vì file đó chỉ ghi kết quả lần gửi). `checkouts` lấy từ tiến độ
  (`head` = `git rev-parse --short HEAD`), nên project R1 không do app thêm có `checkouts` rỗng. Tiến độ chưa có
  project trên Paperclip hiện thành dòng `projectId: ""`, tên = khóa.
- Tiến độ thêm project đi tới renderer qua `state:changed` (mỗi bước ghi `app.json` làm `AppStateStore` báo thay
  đổi); renderer đọc lại `projects:list`. `projects:add` chỉ trả khi xong hoặc lỗi nên renderer giữ khóa đang chạy.
- "Chạy tiếp" gọi lại `projects:add` với `origin`/`key` từ tiến độ, tên từ dòng, số executor đếm từ `agents`.
- "Gỡ khỏi Mac" hỏi xác nhận, gọi `projects:remove`, hiện `removed` và `manualCommand` (nút "Chép lệnh"); app không
  xóa thư mục.
