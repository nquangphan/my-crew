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
- Kênh IPC `projects:list()`, `projects:pickFolder()`, `projects:add(input)`, `projects:remove(projectId)`
  (`src/main/projects/register.ts` → `registerProjects`, logic không phụ thuộc Electron ở `src/main/projects/ipc.ts` →
  `createProjectsIpc`; hộp thoại chọn thư mục `dialog.showOpenDialog({ properties: ['openDirectory'] })` truyền vào
  qua `pickDirectory`). Màn hình Project ở route `#/projects`.

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
| `createAgent` | `POST /api/companies/:id/agents` | `claude_local`, `adapterConfig` = `{ engine: "cli", command, extraArgs, model, env: {} }` như agent R1: `command` phải là `<home>/.crew/bin/crew-claude-run`, `model` bắt buộc (thiếu thì ném, không gọi mạng). Thiếu `engine` thì Paperclip chạy ACP, mà ACP chỉ chạy sandbox nên run trên environment SSH `in_place` hỏng `adapter_engine_unavailable` (TPS-71, AC-6 09/10). `runtimeConfig.heartbeat { enabled: false, maxConcurrentRuns: 1 }`, `defaultEnvironmentId` |
| `getAgent` | `GET /api/agents/:id` | 404 → `null` (chờ duyệt agent khi company bật duyệt). Trả `id`, `name`, `status`, `companyId`, `defaultEnvironmentId`, `engine` (= `adapterConfig.engine`, không có thì `null`); không giữ `env` hay key khác của `adapterConfig` |
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
| `folder` | Nhánh mặc định có `docs/flows.yaml` (`git cat-file -e <baseRef>:docs/flows.yaml`) thì đặt `crew-docs.bundle` (và `crew-docs.runtime` nếu chưa có) trong git config của repo — chung cho mọi worktree. Giá trị owner đã đặt mà còn là file thì giữ, không ghi đè. Nguồn: repo đầu tiên trong `listStatusRepos` có bundle hợp lệ, không có thì `~/.crew/bin/crew-docs.cjs` |
| `project` | Project cùng tên đã có thì dùng lại, không thì `createProject` |
| `status-repo` | `ops.addStatusRepo(projectId, <folder>)` — ảnh chụp docs đọc thẳng folder của owner. `crew-mac status send` chỉ đọc qua git (`git show`/`ls-tree` ở commit `origin/HEAD`, worktree tạm detached trong thư mục tạm), không đọc working tree; mỗi lượt nó `git fetch origin` trong folder (chỉ đổi ref remote) — xem `docs/flows/mac-setup.md` mục "Ảnh chụp docs" |
| `role:<vai>` | Theo thứ tự `executor-1`, (`executor-2`), `assistant`, `reviewer`, `integrator` (executor trước để Trợ Lý có danh sách id). Worktree riêng `~/crew-agents/<key>/<vai>` bằng `git -C <folder> -c core.hooksPath=/dev/null worktree add --no-track -b agent/<key>-<vai> <checkout> <baseRef>` (như R1: worktree của repo gốc, nhánh `agent/…` riêng; hook của repo không chạy). Nhánh `agent/<key>-<vai>` đã có (thêm lại sau khi gỡ) thì `worktree add <checkout> <nhánh>` dùng lại nhánh đó. Worktree đã có đúng chỗ (`--git-common-dir` trùng `.git` của folder, `--show-toplevel` là checkout) thì dùng lại; thư mục khác ở đó thì báo lỗi, không đè. Thêm `.paperclip-runtime/` vào `info/exclude` (file chung trong `.git` của folder, chỉ nối một dòng). Environment `<key>-<vai>`: SSH `in_place`, `remoteWorkspacePath` = checkout, host/user/`knownHosts`/`crewLoadGate` và secret SSH (`privateKeySecretRef.secretId`) lấy từ environment SSH `in_place` đang `active` của máy (cùng cổng `manifest.port` của `crew-mac setup`). Agent `<key>-<vai>`: `claude_local`, `engine: "cli"`, `env: {}`, `model` theo vai như agent R1 (Trợ Lý `claude-opus-5`, executor/reviewer/integrator `claude-sonnet-5`), `command` = `<home>/.crew/bin/crew-claude-run`, `extraArgs` = bản ghim Superpowers (`setup().superpowers`, kiểm khuôn như `merge-agent-config.mjs`), heartbeat tắt, `maxConcurrentRuns: 1`, `defaultEnvironmentId` = environment trên. Agent (và environment) đã có trên server cùng tên mà chưa có trong tiến độ (response bị mất) thì dùng lại. Rồi giữ agent ở `paused`; tải `AGENTS.md` |
| `roles` | `setRoles(companyId, projectId, { assistantAgentId, executorAgentIds, reviewerAgentId, integratorAgentId })`. Plugin kiểm luật (reviewer ≠ integrator, 1–2 executor, không vai trò chéo giữa project, không agent `terminated`) |
| `check` | `doctor({ probe: false, skipTcc: true })` không có `fail` ở `worktree-workflows`, `worktree-root`; `workflowCheck` sạch cho từng checkout; `getRoles` đọc lại khớp; `getAgent` từng agent đọc lại có `engine` = `cli` (agent dùng lại do bản app cũ tạo thiếu `engine` bị chặn ở đây, phải PATCH `adapterConfig.engine` rồi Chạy tiếp). Đạt hết thì mới `resumeAgent` các agent đang `paused` |

Những gì app ghi vào folder của owner, tất cả nằm trong `.git`: metadata worktree (`.git/worktrees/<tên>`), nhánh
`agent/<key>-<vai>`, git config `crew-docs.*` (khi chưa có), một dòng `.paperclip-runtime/` trong `info/exclude`.

**Tiến độ kiểu cũ.** Bản trước thêm project bằng URL git (bước `ls-remote`, `mirror`, clone vào `~/crew-projects`):
tiến độ đó có `origin` mà không có `folder`. Đọc vẫn được (danh sách, gỡ). Chưa tạo project/agent nào thì lần thêm mới
bỏ tiến độ cũ và làm lại từ đầu; đã tạo thì `addProject` ném "… là kiểu cũ (URL git, bản trước): bấm "Gỡ khỏi Mac"
rồi thêm lại bằng Chọn folder"; màn hình không hiện "Chạy tiếp" cho tiến độ đó.

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

Không xóa project trên Paperclip, không xóa worktree agent, không đụng folder gốc của owner: trả
`{ removed, manualCommand }` với `manualCommand` = `git -C <folder> worktree remove <checkout>` cho từng vai trò (thứ
tự vai trò, nối bằng ` && `, đường dẫn có ký tự lạ thì quote cho `/bin/sh`) để owner tự chạy; git từ chối worktree còn
thay đổi chưa commit. Nhánh `agent/<key>-<vai>` giữ lại (thêm lại cùng khóa thì dùng lại). Tiến độ kiểu cũ thì
`manualCommand = "rm -rf ~/crew-agents/<key> ~/crew-projects/<key>"` như trước; rỗng khi project không do app thêm
hoặc chưa có checkout. Chạy lại khi đã gỡ không lỗi. Project không do app thêm (ví dụ `repo-a` của R1) chỉ bị `remove-repo` và xóa
dòng vai trò, không agent nào bị pause.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/mac-app/src/main/paperclip/types.ts` | Kiểu client Paperclip | `PaperclipClient`, `ProjectRoles`, `SshEnvironmentInput`, `ClaudeLocalAgentInput` |
| `apps/mac-app/src/main/paperclip/client.ts` | REST có kiểu, origin, lỗi | `createPaperclipClient`, `normalizeOrigin`, `paperclipRequest`, `PaperclipAuthError`, `PaperclipHttpError` |
| `apps/mac-app/src/main/paperclip/cli-auth.ts` | Đăng nhập `cli-auth` | `createLoginFlow` |
| `apps/mac-app/src/main/paperclip/keychain.ts` | Board key trong Keychain (bản mã) | `createBoardKeyStore`, `BOARD_KEY_SERVICE` |
| `apps/mac-app/src/main/paperclip/register.ts` | Kênh IPC, `security`, `safeStorage` | `registerPaperclip`, `paperclipClient`, `boardKeys` |
| `apps/mac-app/src/main/projects/progress.ts` | Tiến độ trong `app.json`, đường dẫn, tên vai trò, lệnh gỡ owner tự chạy | `ProjectDeps`, `ProgressRecorder`, `roleNames`, `projectPaths`, `KEY_RE`, `isLegacyProgress`, `manualRemoveCommand` |
| `apps/mac-app/src/main/projects/folder.ts` | Kiểm folder owner chọn, worktree agent, `info/exclude`, `git` của owner | `inspectFolder`, `folderGuardReason`, `suggestKey`, `ensureWorktree`, `agentBranch`, `ensureRuntimeExcluded`, `runGit`, `shellQuote` |
| `apps/mac-app/src/main/projects/ipc.ts` | Ghép danh sách project REST với trạng thái Mac; chọn folder; thêm/gỡ | `createProjectsIpc` |
| `apps/mac-app/src/main/projects/register.ts` | Đăng ký kênh `projects:*` với deps thật, hộp thoại chọn thư mục | `registerProjects` |
| `apps/mac-app/src/renderer/routes/projects.tsx` | Màn hình Project: danh sách, wizard thêm (Chọn folder), Chạy tiếp, Gỡ khỏi Mac | `ProjectsScreen`, `stepLabel` |
| `apps/mac-app/src/main/projects/add-project.ts` | Các bước thêm project | `addProject` |
| `apps/mac-app/src/main/projects/remove-project.ts` | Gỡ project khỏi Mac | `removeProject` |
| `apps/mac-app/src/main/projects/instructions.ts` | Template, render, `baseHash`, `extraArgs` ghim | `ROLE_TEMPLATES`, `renderInstructions`, `uploadInstructions`, `pinnedExtraArgs` |
| `apps/mac-app/src/main/projects/templates/*.md` | `AGENTS.md` theo vai trò (chép từ fork `crew/agents/*.md`) | |

## Tests

- `apps/mac-app/test/paperclip-client.test.ts`: Paperclip giả trên `127.0.0.1` (`paperclip-fake-server.ts`); Bearer,
  đọc key mỗi lời gọi, timeout, 401/422, log không có key, đường dẫn và body từng route, không có `DELETE`
  environment; `createAgent` gửi đúng `adapterConfig` (`engine: "cli"`, `model`, `env: {}`) và từ chối khi thiếu
  `model`; `agents`/`getAgent` trả `engine`, không trả `env`.
- `apps/mac-app/test/paperclip-cli-auth.test.ts`: body thử thách, `approvalUrl`, poll `pending/approved/expired/cancelled/404`,
  lưu key đúng một lần (kể cả hai poll song song), log không có token.
- `apps/mac-app/test/paperclip-keychain.test.ts`: lệnh `security`, giá trị lưu là bản mã, mã 44, mục cũ không mã hóa,
  giải mã hỏng, lỗi Keychain không lộ key.
- `apps/mac-app/test/projects-fixture.ts`: Paperclip giả có trạng thái (project, environment, agent, `AGENTS.md` có
  `contentHash`, vai trò; luật lỗi, kể cả "server làm rồi mới lỗi"), `OpsBridge` giả, HOME giả, repo bare làm remote
  giả và folder owner (clone của remote đó, nằm ngoài HOME) dưới `mkdtemp`. Không chạm `~/crew-agents`, `~/.crew`,
  `/Volumes` thật hay Paperclip thật.
- `apps/mac-app/test/projects-add.test.ts`: chạy đủ (worktree của folder, nhánh `agent/<key>-<vai>` từ nhánh mặc
  định, `crew-docs.bundle`, `info/exclude`, không có `~/crew-projects`; 4 agent, 4 environment, thứ tự pause → vai trò →
  resume), folder owner đang dở việc (nhánh khác, sửa chưa commit, file đã add) không đổi gì, bundle có sẵn được giữ,
  lỗi ở `role:reviewer` rồi chạy tiếp không tạo trùng, response tạo agent bị mất, từ chối trước mọi lời gọi, folder
  khác/đã thêm với khóa khác, thư mục lạ ở chỗ checkout không bị đè, gỡ → chạy lệnh in ra → thêm lại dùng lại nhánh,
  tiến độ kiểu cũ, hai executor, chờ duyệt agent, plugin từ chối vai trò, kiểm cuối hỏng không resume, agent đọc lại
  thiếu `engine` cli thì lỗi ở `check` và không resume. Agent tạo ra có `engine: "cli"`, `env: {}`, model theo vai.
- `apps/mac-app/test/projects-folder.test.ts`: `inspectFolder` (gốc, `.git` chung, origin, nhánh mặc định và thứ tự
  dự phòng; từng ca từ chối), `folderGuardReason` không chặn `/Volumes`, `suggestKey`.
- `apps/mac-app/test/projects-remove.test.ts`: thứ tự gỡ, lệnh `git -C … worktree remove …`, không xóa project/worktree,
  folder owner sạch, chạy lại, lỗi giữa chừng, project không do app thêm, quote đường dẫn, tiến độ kiểu cũ.
- `apps/mac-app/test/projects-instructions.test.ts`: sha256 template, render Trợ Lý, `extraArgs` ghim, `baseHash`.
- `apps/mac-app/test/projects-ipc.test.ts`: `projects:list` ghép project với tiến độ, checkout (thứ tự vai trò, `head`),
  repo docs và commit gửi cuối; project R1 không có vai trò; thêm dở chưa có project; chưa chọn company; thêm → liệt kê
  → gỡ với Paperclip giả và HOME giả; `pickFolder` (Hủy, gợi ý tên/khóa, folder hỏng trả `problem`).
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
