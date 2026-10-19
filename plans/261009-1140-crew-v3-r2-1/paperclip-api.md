# Crew v3 R2-1: gói `paperclip-api` (SP-2, AP-4, PJ-1, PJ-2), kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App lấy được board API key của owner qua luồng `cli-auth` stock (owner duyệt trên web), gọi REST Paperclip có kiểu, và thêm/gỡ một project hoàn toàn từ app. Thêm gồm repo trên Mac, project, bốn agent có environment SSH `in_place` riêng, instructions theo vai trò và vai trò theo project trong DB plugin. Không SSH vào VPS, không sửa lõi.

**Architecture:** `src/main/paperclip/` là client REST mỏng (fetch, `Authorization: Bearer <board key>`), key đọc từ Keychain mỗi lời gọi. `src/main/projects/` là chuỗi bước idempotent ghi tiến độ vào `app.json` (`projects[key]`); chạy lại thì bỏ qua bước đã xong. Instructions vai trò là bản chép của `crew/agents/*.md` trong fork, render bằng port `renderInstructions`; `baseHash` theo `addBase`; cấu hình agent theo `mergeAgentConfig`.

**Tech Stack:** Electron Main (Node 22 `fetch`), `security` CLI cho Keychain, `git` của owner, `@crew/mac` qua `OpsBridge`.

**Spec:** [plan.md](plan.md) (Global Constraints, Review Focus 3, Interface I3, I5, I6, I7) và spec §4 (Keychain), §8 màn hình 3 và 4, §10, §16 Q1.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng gói này:

- Board API key chỉ nằm trong Keychain service `crew-mac-paperclip`, account = origin. Không vào `app.json`, `app.log`, renderer, thông báo lỗi hay test snapshot.
- Origin phải `https://`, trừ `http://127.0.0.1:<cổng>` cho test.
- Mọi request có timeout 15 giây. Lỗi hiển thị tiếng Việt kèm mã HTTP, không kèm body có thể chứa token.
- SP-2 tạo bản ghi thật trên `crew.2p-solutions.com`: chỉ tạo agent ở trạng thái `paused`, tên có tiền tố `spike-r21-`, và dọn hết (agent, environment, thư mục thử, key thử) trong cùng ticket.
- Agent tạo mới: `adapterType: "claude_local"`, `command` = `~/.crew/bin/crew-claude-run` (đường dẫn tuyệt đối), `extraArgs` = `setup().superpowers.extraArgs`, `maxConcurrentRuns = 1`, `defaultEnvironmentId` = environment riêng của agent.
- Không xóa project trên Paperclip, không xóa checkout trên Mac.

---

## Cấu trúc file

| Path | Trách nhiệm |
|---|---|
| `plans/261009-1140-crew-v3-r2-1/spike-report.md` mục S5 | Hợp đồng REST đo thật |
| `apps/mac-app/src/main/paperclip/types.ts` | `PaperclipClient` (I6), `ProjectRoles`, `SshEnvironmentInput`, `ClaudeLocalAgentInput` |
| `apps/mac-app/src/main/paperclip/keychain.ts` | `readBoardKey`, `saveBoardKey`, `deleteBoardKey` |
| `apps/mac-app/src/main/paperclip/cli-auth.ts` | `startLogin`, `pollLogin` |
| `apps/mac-app/src/main/paperclip/client.ts` | `createPaperclipClient(origin, deps)` |
| `apps/mac-app/src/main/projects/{progress,instructions,add-project,remove-project,ipc}.ts` | thêm/gỡ project |
| `apps/mac-app/src/main/projects/templates/{assistant,executor,reviewer,integrator}.md` | chép từ fork `crew/agents/*.md` |
| `apps/mac-app/src/renderer/routes/projects.tsx` | màn hình Project |
| `docs/flows/mac-app-paperclip.md`, khối `mac-app-paperclip` | docs |

---

### Task 1 (SP-2): Spike S5 và cổng G5

**Files:**
- Modify: `plans/261009-1140-crew-v3-r2-1/spike-report.md` (mục S5), `sdd-ledger.md`

**Interfaces:**
- Produces: mục S5 ghi **nguyên văn** (đã che secret):
  - method, path, body tối thiểu và trường trả về cần dùng cho: tạo challenge, poll, `cli-auth/me`, liệt kê company (có `requireBoardApprovalForNewAgents` không), liệt kê/tạo project, liệt kê/tạo/archive environment SSH, tạo/patch agent, GET/PUT `instructions-bundle/file`, `POST /api/heartbeat-runs/:runId/cancel`, cách dựng link run trên web (`/<issuePrefix>/agents/:agentId/runs/:runId`, lấy `agentId` và prefix từ đâu);
  - một dòng `G5: ĐI` hoặc `G5: ĐI qua agent-hires` (company bật duyệt agent mới) hoặc `G5: DỪNG — <lý do>`.

- [ ] **Step 1: Chuẩn bị.** Đọc `server/src/routes/access.ts` l.2765–2900 (`/cli-auth/*`), `server/src/routes/agents.ts` l.4776 (`POST /companies/:companyId/agents`), l.5160–5273 (instructions file), l.6987 (cancel), `server/src/routes/environments.ts` (route tạo/archive), `packages/shared/src/validators/` (schema tạo agent/environment/project). Ghi body tối thiểu dự kiến vào báo cáo trước khi gọi.
- [ ] **Step 2: Lấy key thử.** Trong shell trên Mac:

```bash
ORIGIN=https://crew.2p-solutions.com
curl -sS -X POST "$ORIGIN/api/cli-auth/challenges" -H 'Content-Type: application/json' \
  -d '{"command":"2P Crew app spike","clientName":"2P Crew (spike R2-1)","requestedAccess":"board"}' \
  > ~/crew-r21-s5-challenge.json && chmod 600 ~/crew-r21-s5-challenge.json
jq -r .approvalUrl ~/crew-r21-s5-challenge.json
```

  Gửi `approvalUrl` cho owner duyệt. Poll `GET $ORIGIN/api/cli-auth/challenges/<id>?token=<token>` tới khi duyệt. Lưu `boardApiToken` vào Keychain service `crew-mac-paperclip-spike` bằng cùng cách `setStatusSecret` của crew-mac làm, rồi `rm ~/crew-r21-s5-challenge.json`. Từ đây mọi `curl` đọc key bằng `security find-generic-password -s crew-mac-paperclip-spike -w` trong subshell, không `echo`.
- [ ] **Step 3: Đọc.** `GET /api/cli-auth/me`, `GET /api/companies`, `GET /api/companies/<id>/environments`, `GET /api/companies/<id>/agents` (lấy cấu hình của agent `mac-claude` làm mẫu). Ghi trường `requireBoardApprovalForNewAgents`.
- [ ] **Step 4: Tạo thử.**
  - `mkdir -p ~/crew-agents/spike-r21-s5 && git -C ~/crew-agents/spike-r21-s5 init -q`.
  - Tạo environment SSH `in_place` tên `spike-r21-s5`, `remoteCwd` thư mục đó, dùng lại secret SSH của environment mẫu.
  - Tạo agent `spike-r21-s5` (`claude_local`, `paused`, `maxConcurrentRuns: 1`, `defaultEnvironmentId` vừa tạo).
  - `GET` rồi `PUT instructions-bundle/file` `AGENTS.md` với `baseHash` (null khi chưa có).
  - Ghi mã HTTP và id.
  - Company bật duyệt agent mới thì ghi luồng `agent-hires` thấy được (route, trạng thái agent sau tạo).
- [ ] **Step 5: Dọn.**
  - Xóa hoặc terminate agent thử theo route có thật (ghi route đã dùng).
  - Archive environment thử.
  - `rm -rf ~/crew-agents/spike-r21-s5`.
  - `POST /api/cli-auth/revoke-current` bằng key thử, `security delete-generic-password -s crew-mac-paperclip-spike`.
  - Kiểm `GET` agent/environment không còn ở trạng thái hoạt động.
- [ ] **Step 6: Quyết định G5 và commit.**

```bash
git add plans/261009-1140-crew-v3-r2-1/spike-report.md plans/261009-1140-crew-v3-r2-1/sdd-ledger.md
git commit -m "docs(v3): đo hợp đồng REST Paperclip cho app thêm project"
```

---

### Task 2 (AP-4): Paperclip client và đăng nhập `cli-auth`

**Files:**
- Create: `src/main/paperclip/{types,keychain,cli-auth,client}.ts`, `test/paperclip-{keychain,cli-auth,client}.test.ts`, `docs/flows/mac-app-paperclip.md`
- Modify: `src/main/index.ts` (1 dòng `registerPaperclip`), `docs/flows.yaml` (khối `mac-app-paperclip`)

**Interfaces:**
- Consumes: `spike-report.md` mục S5 (path, body); I5 kênh `paperclip:*`.
- Produces: I6 `PaperclipClient`, `createPaperclipClient(origin: string, deps: { fetch: typeof fetch; readKey: () => Promise<string | null> }): PaperclipClient`; lỗi `PaperclipAuthError` (401/403), `PaperclipHttpError { status: number; code: string | null }`.

- [ ] **Step 1: Test client** (`fetch` giả ghi lại request):
  1. Mọi request có `Authorization: Bearer <key>` và timeout 15 giây (`AbortSignal.timeout`); key đọc lại mỗi lời gọi (`readKey` gọi 2 lần cho 2 request).
  2. 401 → ném `PaperclipAuthError` message "Cần đăng nhập lại Paperclip"; 422 body `{ code: 'x', error: 'y' }` → `PaperclipHttpError` `status 422`, `code 'x'`, message có "422" và không chứa key.
  3. `setRoles(c, p, roles)` gửi `POST /api/plugins/crew.core/api/projects/<p>/roles` body `{ companyId: c, ...roles }`; `getRoles` gửi `GET …/roles?companyId=c` và trả `null` khi body `{ roles: null }`; `deleteRoles` gửi `DELETE …/roles?companyId=c`.
  4. `cancelRun('r')` gửi `POST /api/heartbeat-runs/r/cancel`.
  5. `putInstructionsFile(a, 'AGENTS.md', text, null)` gửi body có `"baseHash": null`; với hash thì đúng hash.
  6. Origin `http://example.com` → ném "Paperclip phải dùng https"; `http://127.0.0.1:3100` hợp lệ.
  7. Spy logger: sau một loạt lời gọi (kể cả lỗi), không dòng log nào chứa key.
- [ ] **Step 2: Test `cli-auth`:** `startLogin(origin, companyId?)` POST `/api/cli-auth/challenges` body `{ command: '2P Crew app', clientName: '2P Crew trên <hostname>', requestedAccess: 'board' }`, trả `approvalUrl` (null thì dựng từ `origin + approvalPath`) và giữ `token` + `boardApiToken` chỉ trong bộ nhớ Main. `pollLogin()`: `pending` → `pending`; `approved` → gọi `saveBoardKey(origin, boardApiToken)` đúng một lần rồi xóa biến; `expired`/`cancelled` → trạng thái tương ứng, không lưu.
- [ ] **Step 3: Test `keychain`** với runner giả: `saveBoardKey` gọi `security add-generic-password -U -s crew-mac-paperclip -a <origin> -w <key>` (đúng cách `setStatusSecret` của crew-mac làm, kể cả rủi ro `-w` đã ghi nhận ở spec §14); `readBoardKey` gọi `find-generic-password -s crew-mac-paperclip -a <origin> -w`, mã 44 → `null`.
- [ ] **Step 4: Cài** theo path/body ở `spike-report.md` S5. `runWebUrl(runId)` theo cách SP-2 ghi. Đăng ký kênh I5 `paperclip:login`, `paperclip:loginStatus`, `paperclip:companies`.
- [ ] **Step 5: Kiểm + docs + commit.** Run: `pnpm --filter @crew/mac-app exec vitest run test/paperclip-*.test.ts && pnpm --filter @crew/mac-app typecheck` → PASS. Khối `mac-app-paperclip` (entrypoint `src/main/paperclip/client.ts`), `docs/flows/mac-app-paperclip.md` (đăng nhập, Keychain, danh sách route dùng).

```bash
git add apps/mac-app docs/flows.yaml docs/flows/mac-app-paperclip.md docs/files.md
git commit -m "feat(mac-app): đăng nhập Paperclip bằng cli-auth và client REST"
```

---

### Task 3 (PJ-1): Thêm và gỡ project

**Files:**
- Create: `src/main/projects/{progress,instructions,add-project,remove-project}.ts`, `src/main/projects/templates/*.md`, test `test/projects-{add,remove,instructions}.test.ts`
- Modify: `docs/flows/mac-app-paperclip.md`, khối `mac-app-paperclip`

**Interfaces:**
- Consumes: I6; I7 (route vai trò); `OpsBridge` (`setup` để lấy `superpowers.extraArgs` và `manifest.port`, `addStatusRepo`, `removeStatusRepo`); `forbiddenRootReason`; `AppStateStore` (`projects`).
- Produces: `addProject(deps, input: AddProjectInput): Promise<ProjectProgress>`, `removeProject(deps, projectId): Promise<{ removed: string[]; manualCommand: string }>`;
  `AddProjectInput = { origin: string; name: string; key: string; executors: 1 | 2 }`. `key` khớp `^[a-z][a-z0-9-]{1,30}$`.

Các bước thêm (mỗi bước bỏ qua nếu đã có trong `progress.done`, lỗi thì ghi `progress.error` và dừng; chạy lại tiếp từ bước dở):

| Bước | Việc | Kết quả lưu |
|---|---|---|
| `ls-remote` | `git ls-remote --exit-code <origin> HEAD` bằng git của owner, timeout 60 giây | — |
| `mirror` | `git clone <origin> ~/crew-projects/<key>` (clone thường, không `--mirror`: `crew-mac status` đọc `origin/HEAD` của clone thường như `~/crew-spike/repo-a` hiện nay); có `docs/flows.yaml` thì `git -C … config crew-docs.bundle <đường dẫn bundle như các checkout hiện có>` | đường dẫn |
| `project` | `createProject(companyId, { name })` | `projectId` |
| `status-repo` | `addStatusRepo(projectId, ~/crew-projects/<key>)` | — |
| `role:<vai>` cho `assistant`, `executor-1`, (`executor-2`), `reviewer`, `integrator` | `forbiddenRootReason(home, ~/crew-agents/<key>/<vai>)` null; clone checkout riêng; `.paperclip-runtime/` vào `.git/info/exclude`; `createEnvironment` (SSH `in_place`, `remoteCwd` = checkout, secret SSH dùng lại theo S5); `createAgent` (tên `<key>-<vai>`, cấu hình chung ở Global Constraints); `putInstructionsFile` `AGENTS.md` (render, `baseHash`) | `agents[vai]` |
| `roles` | `setRoles(companyId, projectId, { assistantAgentId, executorAgentIds, reviewerAgentId, integratorAgentId })` | — |
| `check` | `doctor({ probe: false })` không có `fail` ở `worktree-workflows`, `worktree-root`; `workflowCheck` sạch cho mỗi checkout; `GET roles` khớp | — |

  Company bật `requireBoardApprovalForNewAgents` (S5) thì sau `createAgent` chờ owner duyệt trên web (poll trạng thái agent mỗi 10 giây, tối đa 30 phút, màn hình ghi "Chờ duyệt agent trên web").

- [ ] **Step 1: Test `instructions`.** Port `renderInstructions` (từ `crew/agents/render-instructions.mjs`): `assistant` cần ≥ 1 executor uuid, vai khác không nhận danh sách; port `addBase`: hash 64 hex hoặc `null` khi file chưa có (404), lỗi khác ném. Template chép nguyên văn từ fork; test so sha256 template với file fork lúc viết (ghi hash vào test) để phát hiện lệch.
- [ ] **Step 2: Test `addProject`** với client/ops/git giả:
  1. Chạy đủ: thứ tự gọi đúng bảng; 1 executor → 4 agent, 4 environment; `setRoles` nhận đúng 4 id; `progress.done` đủ.
  2. Lỗi ở `role:reviewer` (client ném 500) → `progress.error` có message, `done` dừng trước `role:reviewer`; chạy lại → không tạo lại project hay agent `assistant`/`executor-1` (đếm lời gọi `createProject` = 1, `createAgent` tổng = 4).
  3. `key` sai dạng hoặc `~/crew-agents/<key>` đã tồn tại mà không có trong progress → từ chối trước mọi lời gọi.
  4. `ls-remote` thất bại → lỗi "Không đọc được repo bằng git trên máy này", không gọi Paperclip.
  5. Hai executor → 5 agent, `executorAgentIds` dài 2, instructions của `assistant` liệt kê cả hai.
  6. Agent tạo ra có `maxConcurrentRuns: 1`, `command` kết thúc bằng `/.crew/bin/crew-claude-run`, `extraArgs` đúng `setup().superpowers.extraArgs`.
- [ ] **Step 3: Test `removeProject`:**
  - Theo thứ tự: `patchAgent(id, { status: 'paused' })` từng agent, `archiveEnvironment`, `removeStatusRepo`, `deleteRoles`.
  - Không gọi xóa project, không `rm` thư mục nào.
  - Trả `manualCommand = 'rm -rf ~/crew-agents/<key> ~/crew-projects/<key>'`.
  - Chạy lại khi đã gỡ → không lỗi.
- [ ] **Step 4: Cài** theo bảng; git chạy bằng `child_process.execFile('/usr/bin/git', …)` với env của owner (đăng nhập git của owner), timeout 10 phút cho clone.
- [ ] **Step 5: Kiểm + docs + commit.** Run: `pnpm --filter @crew/mac-app exec vitest run test/projects-*.test.ts && pnpm --filter @crew/mac-app typecheck` → PASS. `mac-app-paperclip.md` mục "Thêm project" (bảng bước) và "Gỡ khỏi Mac".

```bash
git add apps/mac-app docs/flows.yaml docs/flows/mac-app-paperclip.md docs/files.md
git commit -m "feat(mac-app): thêm và gỡ project với bộ agent riêng"
```

---

### Task 4 (PJ-2): Màn hình Project

**Files:**
- Create: `src/main/projects/ipc.ts`, `src/renderer/routes/projects.tsx`, test `test/projects-ipc.test.ts`, `test/renderer/projects.test.tsx`
- Modify: `src/main/index.ts` (1 dòng), `src/renderer/app.tsx` (1 dòng), `docs/flows/mac-app-paperclip.md`

**Interfaces:**
- Consumes: `addProject`, `removeProject`, `PaperclipClient.projects/getRoles`, `listStatusRepos`, `AppStateStore`.
- Produces: kênh I5 `projects:list|add|remove`; `ProjectRow = { projectId: string; name: string; onMac: boolean; checkouts: { role: string; path: string; head: string | null }[]; docsRepo: string | null; lastSentCommit: string | null; progress: ProjectProgress | null }`.

- [ ] **Step 1: Test `projects:list`.** Ghép project REST với `listStatusRepos` và `progress`:
  - Project có vai trò + checkout → `onMac: true`, `checkouts` 4 dòng (`head` từ `git rev-parse --short HEAD`).
  - Project R1 không có dòng vai trò (vd. `repo-a`) → `onMac` theo `status-repos`, `checkouts` rỗng.
  - `lastSentCommit` đọc từ `~/.crew/status-last.json` nếu có.
- [ ] **Step 2: Test renderer.** Form "Thêm project": URL git, tên, khóa, chọn 1–2 executor; khóa sai dạng thì nút bị khóa kèm lý do; đang chạy hiện bước hiện tại; lỗi hiện message và nút "Chạy tiếp". "Gỡ khỏi Mac" hỏi xác nhận rồi hiện `manualCommand` có nút chép.
- [ ] **Step 3: Cài, kiểm, commit.** Run: `pnpm --filter @crew/mac-app exec vitest run test/projects-ipc.test.ts test/renderer/projects.test.tsx && pnpm --filter @crew/mac-app typecheck` → PASS.

```bash
git add apps/mac-app docs/flows.yaml docs/flows/mac-app-paperclip.md docs/files.md
git commit -m "feat(mac-app): màn hình project trên Mac"
```
