# Crew v3 R3: gói `mac` (MC-1, MC-2), kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phía Mac cho R3, gồm ba việc:
- `crew-mac` gửi bản tin cho nhiều company, kèm danh sách checkout, tên skill Superpowers và tín hiệu app có đang nhận việc;
- wrapper có chế độ stub cho nghiệm thu;
- app 2P Crew nhận việc từ hàng đợi plugin và làm 5 loại việc trên máy.

**Architecture:**
- Repo Crew, nhánh `r3/mac`.
- `apps/crew-mac/src/status/` thêm `targets.ts` (đọc/ghi đích) và `checkouts.ts` (quét `~/crew-agents/*/*`).
- Wrapper thêm khối stub (I4) đặt sau `workflow-check` và sau bước ghi process group.
- App thêm `src/main/jobs/`:
  - vòng poll cho mỗi đích;
  - executor gọi lại hàm có sẵn (`inspectFolder`, `ensureWorktree`, `ensureRuntimeExcluded`, `addStatusRepo`, `doctor`, `workflowCheck`) qua `ops` (utilityProcess) để không chặn main process.

**Tech Stack:** `@crew/mac` (Node ≥ 22, ESM, Vitest, Biome 2.5), `@crew/mac-app` (Electron 44, electron-vite, Vitest), Keychain (`security`), git.

**Spec:** [plan.md](plan.md) (Review Focus 5, Interface I1, I3, I4), spec §4.6, 4.10, §5 ý 4, 5, §7 "Chế độ stub".

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng gói này:

- Chỉ ghi `apps/crew-mac/**`, `apps/mac-app/**`, `docs/flows/{mac-setup,mac-workflows,mac-app-paperclip}.md`, khối flow của hai app trong `docs/flows.yaml`, `docs/files.md` (sinh), `pnpm-lock.yaml`.
- Test không đụng `~/.crew`, `~/crew-agents`, Keychain thật, sshd 2222, LaunchAgent: dùng HOME giả (`mkdtemp`), runner lệnh giả, service Keychain có tiền tố `crew-test-`.
- Test nhận diện process và đường dẫn dùng chuỗi lấy từ máy thật (ghi nguồn trong test).
- Không in secret: secret đích đọc từ stdin và chỉ đi vào Keychain. Log app lọc trường `token|secret|key|password|authorization` (`redactFields` có sẵn).
- Lệnh:
  - `pnpm --filter @crew/mac test`, `pnpm --filter @crew/mac typecheck`;
  - `pnpm --filter @crew/mac-app test`, `pnpm --filter @crew/mac-app typecheck`;
  - `pnpm lint`;
  - `node packages/docs-kit/dist/crew-docs.cjs check --staged` (build docs-kit trước nếu worktree mới).
- Mỗi ticket bắt đầu bằng `git merge --ff-only r3`.

---

### Task 1 (MC-1): Bản tin nhiều đích, checkout, tên skill, stub

**Files:**
- Create:
  - `apps/crew-mac/src/status/{targets.ts,checkouts.ts}`
  - `apps/crew-mac/assets/crew-e2e-stub.sh`
  - `apps/crew-mac/test/{status-targets,status-checkouts,wrapper-stub}.test.ts`
  - `apps/crew-mac/test/fixtures/stream-json-result.txt`
- Modify:
  - `src/commands/status.ts`: `sendStatus` lặp đích; `sendDocsSnapshots` gửi repo cho đúng company của repo.
  - `src/status/report.ts`: thêm `checkouts`, `superpowers.pinDir`, `superpowers.skills`, `jobsAgent`.
  - `src/status/app-state.ts`: đọc `jobsAgent` từ `app.json`.
  - `src/cli.ts`: nhánh `status add-target`, `status list-targets`.
  - `assets/crew-claude-run.sh`: khối I4.
  - `package.json` (`files` gồm asset mới nếu có danh sách).
  - `docs/flows/{mac-setup,mac-workflows}.md`.

**Interfaces:**
- Consumes: `readStatusConfig`, `configureStatus`, `setStatusSecret`, `addStatusRepo`, `superpowersPinDir`, `readInstalledPlugins`, `readAppState`.
- Produces:
  - I3, I4;
  - `listTargets(ctx): StatusTarget[]`, `addTarget(ctx, {url?, companyId, secret}): Promise<StatusTarget>`;
  - `scanCheckouts(home): Promise<MachineReport['checkouts']>`;
  - `interface StatusTarget { url: string; companyId: string; keychainService: string }`.
  - `StatusRepo` thêm `companyId?: string`; thiếu thì là company của đích đầu tiên.

- [ ] **Step 1: Test đích (đỏ)** `status-targets.test.ts`:
  - `status.json` kiểu cũ `{url, companyId, machineId}` → `listTargets` trả 1 đích, `keychainService` = service cũ `crew-mac-status` (giữ tương thích).
  - `addTarget` company mới → `status.json` có `targets` 2 phần tử. Secret ghi vào service `crew-mac-status-<8 ký tự đầu companyId>` qua runner giả nhận stdin. Đối số runner không chứa secret.
  - `sendStatus` với 2 đích, đích 1 trả 500 → đích 2 vẫn gửi; lệnh thoát khác 0 và in đích lỗi (chỉ in company id).
  - Mỗi body có `companyId` của đích, cùng `machineId`.
  - `sendDocsSnapshots`: repo có `companyId` B chỉ gửi tới đích B.
- [ ] **Step 2: Test checkout (đỏ)** `status-checkouts.test.ts`, HOME giả có `crew-agents/demo/assistant` (repo git thật tạo bằng `git init`), `crew-agents/demo/notes` (không phải git), 70 repo:
  - chỉ thư mục git vào danh sách;
  - tối đa 64, sắp theo path;
  - `head` là 40 hex;
  - `clean` false khi có file chưa track.

  Lỗi đọc một repo thì `head: null, clean: null`, không ném.
- [ ] **Step 3: Test wrapper stub (đỏ)** `wrapper-stub.test.ts`, chạy `sh assets/crew-claude-run.sh` thật với `HOME` giả, `PAPERCLIP_RUN_ID` UUID, `CREW_MAC_BIN` trỏ script giả luôn thoát 0, `CREW_CLAUDE_BIN` trỏ script giả in `REAL-CLAUDE`, `CREW_E2E_STUB_BIN` trỏ `assets/crew-e2e-stub.sh`:
  1. cwd `HOME/crew-agents/e2e-demo/executor` (repo git), có marker `0` → stdout là đúng dòng `stream-json-result.txt`, không có `REAL-CLAUDE`, thoát 0;
  2. cùng cwd, không marker → `REAL-CLAUDE`;
  3. cwd `HOME/crew-agents/demo/executor` có marker → `REAL-CLAUDE`;
  4. `HOME/crew-agents/e2e-link` là symlink tới `HOME/crew-agents/demo/executor` có marker → `REAL-CLAUDE` (`pwd -P`, Review Focus 5);
  5. marker `abc` → ngủ 5 giây (đo bằng `CREW_E2E_STUB_SLEEP=echo` thay `sleep`, in số giây) và marker `9999` → 900;
  6. stub nhận TERM khi đang ngủ → thoát 143.

  Fixture `stream-json-result.txt` là dòng ở I4. Thêm ca parse dòng đó bằng hàm parse của adapter: chép hàm parse (đọc `packages/adapters/claude-local/src/server/parse.ts` của fork) **vào test fixture** dưới dạng chuỗi mẫu. Nếu không chép được độc lập thì ghi ca này cho E2E-1 kiểm bằng run stub thật.
- [ ] **Step 4: Test report (đỏ)** thêm ca vào `status-app.test.ts` hoặc file mới:
  - `app.json` có `jobsAgent {version, lastPollAt}` → report có `jobsAgent`;
  - thư mục Superpowers ghim có `skills/brainstorming/SKILL.md`, `skills/writing-plans/SKILL.md` → `superpowers.skills` = `['brainstorming','writing-plans']`, `pinDir` = đường tuyệt đối.
- [ ] **Step 5: Chạy, đỏ.**
- [ ] **Step 6: Cài.**
  - Khối stub chèn đúng như I4, sau `workflow-check` và sau khi ghi process group.
  - `crew-e2e-stub.sh`:

```sh
#!/bin/sh
# Stub cho nghiệm thu UI Crew: không gọi model. Chỉ chạy khi wrapper thấy checkout e2e-* có tệp đánh dấu.
marker=$1
secs=$(head -n 1 "$marker" 2>/dev/null | tr -cd '0-9')
case "$secs" in ''|*[!0-9]*) secs=5 ;; esac
[ "$secs" -gt 900 ] && secs=900
trap 'exit 143' TERM
${CREW_E2E_STUB_SLEEP:-sleep} "$secs" &
wait $!
printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"crew-e2e-stub","session_id":"crew-e2e-stub","total_cost_usd":0}'
exit 0
```

- [ ] **Step 7: Xanh, typecheck, lint, `crew-docs generate` + `check --staged`.** Cập nhật `mac-setup.md` (đích, `add-target`, key bản tin mới) và `mac-workflows.md` (chế độ stub, hai điều kiện, không bao giờ dùng cho project thật).
- [ ] **Step 8: Commit** `feat(crew-mac): bản tin máy cho nhiều company, danh sách checkout và chế độ stub cho nghiệm thu`.

---

### Task 2 (MC-2): App nhận việc từ hàng đợi máy

**Files:**
- Create:
  - `apps/mac-app/src/main/jobs/{types.ts,poller.ts,validate.ts,executors.ts,sanitize.ts,register.ts}`
  - `apps/mac-app/test/jobs/{poller,validate,executors,sanitize}.test.ts`
- Modify:
  - `apps/mac-app/src/main/index.ts`: một dòng `registerJobs(ctx)` sau `registerSshd`, cộng import.
  - `src/main/app-state.ts`: trường `jobsAgent?: { version: string; lastPollAt: string }`.
  - `src/main/utility/ops.ts` (hoặc nơi khai `OpsApi`): thêm các hàm executor chạy trong utilityProcess.
  - `docs/flows/mac-app-paperclip.md`, `docs/flows.yaml`, `docs/files.md`.

**Interfaces:**
- Consumes:
  - I1 (route `jobs.claim`, `jobs.result`), `listTargets` (MC-1);
  - client REST có board key (`src/main/paperclip/client.ts`, thêm `request(method, path, body)` nếu chưa có hàm chung);
  - `inspectFolder`, `ensureWorktree`, `ensureRuntimeExcluded`, `agentBranch` (`projects/folder.ts`);
  - `addStatusRepo`, `doctor`, `workflowCheck`, `forbiddenRootReason` (`@crew/mac`);
  - `GET /api/companies/:c/skills/:id` và file skill (đọc `server/src/routes/company-skills.ts` để chốt route lấy nội dung file).
- Produces:
  - Ghi `jobsAgent` vào `app.json` mỗi lần poll (bản tin của MC-1 đọc).
  - `runJob(job, deps): Promise<{status:'done', result} | {status:'failed', errorCode, errorText}>`.

- [ ] **Step 1: Test validate (đỏ)** `validate.test.ts`, cùng bảng ca với PL-1 `machine-jobs-validate.test.ts` (chép nguyên mảng ca). Thêm:
  - `folder` dưới `~/Documents` hoặc `/Volumes/X` → `folder_forbidden` (qua `forbiddenRootReason`);
  - `projectKey` `e2e-x` hợp lệ.
- [ ] **Step 2: Test executor (đỏ)** `executors.test.ts` với HOME giả, repo git thật trong `mkdtemp`, client REST giả:
  - `inspect-folder` repo có `git config crew-docs.bundle x` → `{root, branch, docsBundle:'x', clean:true}`; thư mục không phải git → `folder_not_git`.
  - `prepare-checkouts` 4 vai trò → 4 worktree ở `HOME/crew-agents/demo/<role>` trên nhánh `crew/demo/<role>`, `.git/info/exclude` của mỗi worktree có `.paperclip-runtime`, `crew-docs.bundle` đặt, `addStatusRepo` được gọi một lần cho checkout integrator (theo `add-project.ts` hiện tại; đọc lại để giữ đúng). Chạy lần hai → không lỗi, kết quả như lần một (idempotent). Thư mục đích đã có nhưng không phải worktree của repo này → `checkout_exists`.
  - `agent-workspace` thêm `executor-2` → worktree mới, không đụng worktree khác.
  - `skill-sync` → ghi `HOME/.crew/skills/<companyId>/<slug>/` quyền `0700`, `sha256` = băm cây (dùng `tree-checksum` của `@crew/mac` nếu có export, không thì băm danh sách `path\0sha256` đã sắp).
  - `check` → `items` từ `doctor --no-probe` và `workflowCheck` từng checkout; có `error` thì `status:'failed'`, `errorCode:'check_failed'`, `result` vẫn kèm `items` (gửi trong `result`).
- [ ] **Step 3: Test sanitize (đỏ):** stderr git có `https://user:token@github.com/x` và mã màu → `errorText` không có `token@`, không có `\x1b`, ≤ 300 ký tự.
- [ ] **Step 4: Test poller (đỏ)** `poller.test.ts`, fake timers, client giả:
  - 2 đích → mỗi chu kỳ gọi `claim` cho từng đích;
  - `claim` 204 → không làm gì;
  - có việc → chạy executor → `result`;
  - chu kỳ 5 giây khi cửa sổ hiện, 15 giây khi ẩn;
  - `claim` lỗi mạng → backoff tới 60 giây, không ném;
  - đang chạy một việc thì không `claim` thêm (một việc một lúc trên máy);
  - mỗi chu kỳ cập nhật `jobsAgent.lastPollAt`;
  - app chưa có board key → không poll, `jobsAgent` không ghi.
- [ ] **Step 5: Chạy, đỏ. Step 6: Cài.** Executor chạy trong utilityProcess qua `ops.call`. Việc vượt 8 phút thì hủy và báo `app_error` "quá thời gian" (dưới lease 10 phút).
- [ ] **Step 7: Xanh; `pnpm --filter @crew/mac-app build`; lint; docs; `crew-docs check --staged`.**
- [ ] **Step 8: Commit** `feat(mac-app): nhận và làm việc trên máy từ hàng đợi của Crew`.
