# Crew v3 R3: gói `wizards` (WZ-1..WZ-3), kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm project và tạo agent trên web, mỗi luồng làm đủ bước, chạy tiếp được từ bước dở. Trạng thái sẵn sàng tính đúng cho cả agent do wizard tạo lẫn agent do app Mac tạo.

**Architecture:**
- `src/lib/instructions/` giữ hằng cấu hình agent (I9) và render `AGENTS.md` từ template gốc `crew/agents/*.md` của fork (import `?raw`).
- `src/features/readiness/` tính trạng thái sẵn sàng (I10) bằng hàm thuần, kèm hook ghép dữ liệu.
- `src/features/wizards/` chạy từng bước:
  1. `setup.begin` (khóa bước);
  2. làm việc (REST stock hoặc tạo job máy rồi chờ job xong);
  3. `setup.finish` ghi `refs`.

  Mọi lời gọi dùng `companyId` của setup run.

**Tech Stack:** như [web-ds.md](web-ds.md). Test so sánh render với `node crew/agents/render-instructions.mjs`.

**Spec:** [plan.md](plan.md) (Review Focus 1, 3, 4, 5; Interface I1, I2, I9, I10), spec §4.7, 4.8, §5 ý 1, 2, 6.

## Global Constraints

Áp dụng Global Constraints của [plan.md](plan.md) và [web-ds.md](web-ds.md). Riêng gói này:

- Chỉ ghi `src/features/{readiness,wizards}/**`, `src/lib/instructions/**` và test tương ứng.
- Agent tạo ra phải có đúng I9:
  - `engine: "cli"`, `env: {}`, `maxConcurrentRuns: 1`, heartbeat tắt;
  - quyền `canCreateAgents: false`, `canCreateSkills: false`;
  - Trợ Lý có grant `tasks:assign`.

  Không tạo agent nào thiếu các key này, kể cả ở bước dở.
- Khóa project `e2e-*` chỉ được dùng ở company có tên `Crew E2E` (Review Focus 5).
- Không chạy shell, không SSH. Phần trên Mac đi qua job I1.

---

### Task 1 (WZ-1): Hằng cấu hình agent, render instructions, readiness

**Files:**
- Create:
  - `src/lib/instructions/{agent-config.ts,render.ts,templates.ts,put.ts,index.ts}`
  - `src/features/readiness/{compute.ts,use-readiness.ts,index.ts,locales/*}`
  - `test/lib/instructions/{agent-config,render,put}.test.ts`
  - `test/features/readiness/compute.test.ts`
  - `test/lib/instructions/__fixtures__/rendered/*.md` (sinh bằng `render-instructions.mjs`)

**Interfaces:**
- Consumes:
  - fork `crew/agents/{assistant,executor,reviewer,integrator}.md`, `crew/agents/render-instructions.mjs`, `crew/agents/merge-agent-config.mjs`;
  - `server/src/crew/model-policy.ts` (`CREW_COMPLEXITY_MODEL`, đọc để chép giá trị);
  - `packages/shared` `createAgentSchema`;
  - `api.agents.instructionsFile.get/put`.
- Produces: I9, I10 và `CREW_MODELS: readonly string[]`.

- [ ] **Step 1: Chốt giá trị thật (không code).** Ghi kết quả vào ledger trước khi viết code.
  - Đọc `createAgentSchema` (`packages/shared/src/validators/*agent*`), ghi tên trường đúng cho heartbeat, `maxConcurrentRuns`, `permissions`, `defaultEnvironmentId`.
  - Trên prod, `GET /api/agents/<id tro-ly TPS>` (qua `api.sh`, body không cần), ghi `adapterConfig.command`, dạng `extraArgs`, `runtimeConfig`. Không in token, không in env.
  - So với `apps/mac-app/src/main/projects/{add-project,instructions}.ts` (`git show r2-2:…`).

  Nếu prod và app khác nhau thì lấy giá trị của app (agent `2ps-landing` do app tạo) và ghi rõ lệch. Sửa khối I9 trong `plan.md` cho khớp (commit docs riêng ở repo Crew do Trợ Lý làm).
- [ ] **Step 2: Test render (đỏ)** `render.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
const FORK = resolve(__dirname, '../../../../..');
for (const role of ['assistant', 'executor', 'reviewer', 'integrator'] as const) {
  it(`render ${role} khớp render-instructions.mjs`, () => {
    const vars = { projectName: 'demo', executors: [{ name: 'demo-executor', id: '11111111-1111-4111-8111-111111111111' }, { name: 'demo-executor-2', id: '22222222-2222-4222-8222-222222222222' }] };
    const expected = readFileSync(resolve(__dirname, `__fixtures__/rendered/${role}.md`), 'utf8');
    expect(renderInstructions(role, vars)).toBe(expected);
  });
}
it('fixture sinh từ script gốc', () => {
  // chạy `node crew/agents/render-instructions.mjs` với tham số tương đương (đọc usage của script) và so với fixture
});
```

  Đọc `render-instructions.mjs` để biết tham số thật, rồi viết lệnh sinh fixture vào `test/lib/instructions/__fixtures__/README.md`.
- [ ] **Step 3: Test `put` (đỏ)** `put.test.ts`:
  - `putInstructions` đọc `GET …/instructions-bundle/file?path=AGENTS.md` lấy hash rồi `PUT {path:'AGENTS.md', content, baseHash}`;
  - server trả 409 (hoặc mã xung đột thật, đọc route `PUT /agents/:id/instructions-bundle/file`) thì trả `{ok:false, conflict:true}`;
  - nội dung giống hệt thì không `PUT`, trả `{ok:true, hash}`.
- [ ] **Step 4: Test cấu hình (đỏ)** `agent-config.test.ts`: `crewAgentCreateBody({...})` có đúng các key ở Global Constraints gói này; `extraArgs` đúng thứ tự; không có key lạ; `model` phải thuộc `CREW_MODELS`, nếu không thì ném.
- [ ] **Step 5: Test readiness (đỏ)** `compute.test.ts`, mỗi ca một mã:
  - A1: `engine` thiếu → `not_ready` A1.
  - A2: `extraArgs` trỏ `pinDir` khác `report.superpowers.pinDir` → A2. Report thiếu `pinDir` thì kiểm dạng `--setting-sources project,local --plugin-dir <đường chứa /superpowers/<report.superpowers.pinned>>`.
  - A3: setup run có `instructions_<role>` hash khác hash hiện tại → A3. Agent không có setup run (app tạo) mà file có → đạt.
  - A4: environment `archived` hoặc `remoteWorkspacePath` khác checkout → A4.
  - A5: `report.checkouts` không có path → A5; report `null` → A5 với `resume: none` và chi tiết "Chưa có bản tin máy".
  - A6: không giữ vai trò → A6.
  - A7: `terminated` → `state: 'terminated'`; `paused` → `state: 'paused'`, `failed` rỗng.
  - Project vai trò file (`fileRoles: true`, `roles: null`) mà agent đủ → `ready` (Review Focus 3).
  - Project không có vai trò và không có vai trò file → `not_ready` P1.
- [ ] **Step 6: Chạy, đỏ. Step 7: Cài.**
  - `use-readiness.ts` ghép: `api.agents.list`, `api.environments.get` (theo `defaultEnvironmentId`, cache theo id), roles route mỗi project, `crew.machines`, `crew.setupRuns`.
  - "Vai trò file": project có trong `trackingProjectIds` cũ. Hiện chưa có data cho điều này: dùng `roles.get` trả 404 và project có issue gốc Crew trong `crew.roots` thì coi là `fileRoles`, ghi chú trong code.
- [ ] **Step 8: Xanh, typecheck, lint.**
- [ ] **Step 9: Commit** `feat(crew-web): cấu hình agent Crew, render hướng dẫn và trạng thái sẵn sàng`.

---

### Task 2 (WZ-2): Wizard Thêm project

**Files:**
- Create:
  - `src/features/wizards/{routes.tsx,index.ts,locales/*}`
  - `src/features/wizards/add-project/{add-project-page.tsx,steps.ts,run-step.ts,wait-job.ts,validate.ts}`
  - `test/features/wizards/{add-project.test.ts,wait-job.test.ts,validate.test.ts,add-project-page.test.tsx}`

**Interfaces:**
- Consumes:
  - I1 (`jobs.create`, `crew.machineJobs`), I2 (`setup.create/begin/finish/get`), I9;
  - `api.projects.create`, `api.environments.list/get/create`, `api.agents.create/pause/permissions`, `api.agents.instructionsFile.put`;
  - roles route; `crew.machines` (máy, `pinDir`, `jobsAgent`).
- Produces:
  - route `projects/new` (`?resume=<setupRunId>`);
  - `runAddProjectStep(ctx, run, stepId): Promise<SetupRun>`;
  - `waitJob(jobId, {timeoutMs, signal}): Promise<MachineJob>`, poll 2 giây, hủy được.

Các bước (`SetupStepId`), mỗi bước bỏ qua nếu `steps[id].status === 'done'`:

| Bước | Làm | `refs` |
|---|---|---|
| `inspect` | job `inspect-folder {folder}`; chờ `done` (≤ 2 phút, quá thì "Chờ app"); lỗi `folder_not_git`/`folder_forbidden` dừng ngay | `root`, `branch` |
| `project` | `POST /companies/:c/projects {name}`; ghi `projectId` vào run (`setup.finish … projectId`) | `project` |
| `checkouts` | job `prepare-checkouts {projectKey, folder: root, roles}`; roles = assistant, executor, (executor-2), reviewer, integrator; branch `crew/<key>/<role>` | `checkout_<role>` = path |
| `environments` | với mỗi vai trò: tìm environment mẫu (environment `active`, driver `ssh`, có `crewLoadGate` trong metadata, mới nhất) của company; `POST` environment mới chép `driver`, `config` (host, port, user, secret ref, known hosts) và đặt `remoteWorkspacePath = checkout`, `metadata {workspaceRealizationMode:'in_place', crewLoadGate}`; tên `<key>-<role>` | `environment_<role>` |
| `agents` | với mỗi vai trò: `POST /companies/:c/agents` = `crewAgentCreateBody({name:'<key>-<role>', role, model: ROLE_MODELS[role], pinDir, environmentId})`; rồi `putInstructions` với `renderInstructions(role, {projectName, executors})`; Trợ Lý thêm grant `tasks:assign` (route permissions, body theo `agents.ts:4946`) | `agent_<role>`, `instructions_<role>` |
| `roles` | `POST …/projects/:id/roles {companyId, assistantAgentId, executorAgentIds, reviewerAgentId, integratorAgentId}` | — |
| `check` | job `check {projectKey}`; mục `error` thì bước `failed` kèm danh sách | — |

Lỗi ở bất kỳ bước nào:
1. `setup.finish(failed, error)`;
2. `POST /agents/:id/pause` cho mọi `agent_*` đã có trong `refs`;
3. hiện `Wizard` với lỗi và nút "Chạy tiếp".

Chạy tiếp gọi lại từ bước đầu chưa `done`.

- [ ] **Step 1: Test `validate.ts` (đỏ).**
  - Khóa theo `^[a-z][a-z0-9-]{1,30}$`.
  - `executors ∈ {1,2}`; tên 1–120 ký tự; folder tuyệt đối.
  - Khóa `e2e-demo` ở company tên `2P Solutions` → lỗi "Khóa e2e-* chỉ dùng cho company Crew E2E".
  - Khóa đã có project cùng tên khóa trong company → lỗi.
- [ ] **Step 2: Test `wait-job.ts` (đỏ), fake timers.**
  - `done` → trả job;
  - `failed` → ném `JobFailedError` mang `errorCode`, `errorText`;
  - quá hạn → `JobTimeoutError`;
  - `signal.abort()` → dừng poll.
- [ ] **Step 3: Test luồng (đỏ)** `add-project.test.ts` với `api` giả ghi lại lời gọi:
  - Đủ 7 bước theo đúng thứ tự gọi. Body agent có I9.
  - Lỗi ở `environments` vai trò thứ 2 → run `failed`, `pause` gọi cho agent đã tạo (ở ca này là 0 agent vì `agents` sau `environments`). Thêm ca lỗi ở `roles` → pause đủ 4–5 agent.
  - Chạy tiếp sau lỗi ở `roles` → không tạo lại project/environment/agent (đọc `refs`), chỉ gọi `roles` rồi `check`.
  - `setup.begin` trả 409 → hiện "Đang có người chạy bước này", không gọi gì thêm (Review Focus 1).
  - Đổi company đang chọn giữa bước `environments` và `agents` → mọi lời gọi vẫn mang `companyId` của run (Review Focus 4).
- [ ] **Step 4: Test trang (đỏ)** `add-project-page.test.tsx`:
  - Bước 1 có chọn máy (từ `crew.machines`, máy không `jobsAgent` thì nhãn "App chưa chạy"), ô folder, gợi ý folder đã dùng (từ `crew.machineJobs` `inspect-folder` `done`), khóa, tên, số executor.
  - Mở với `?resume=` thì hiện đúng bước đã xong.
- [ ] **Step 5: Chạy, đỏ. Step 6: Cài. Step 7: Xanh, typecheck, lint.**
- [ ] **Step 8: Commit** `feat(crew-web): wizard thêm project làm đủ bước, chạy tiếp được`.

---

### Task 3 (WZ-3): Wizard Tạo agent và lối "Làm tiếp"

**Files:**
- Create:
  - `src/features/wizards/add-agent/{add-agent-page.tsx,steps.ts,run-step.ts}`
  - `src/features/wizards/resume.ts`
  - `test/features/wizards/{add-agent.test.ts,resume.test.ts,add-agent-page.test.tsx}`
- Modify: `src/features/wizards/{routes.tsx,index.ts,locales/*}`

**Interfaces:**
- Consumes: như WZ-2; `ResumeTarget` (I10).
- Produces:
  - route `agents/new?project=<id>&slot=<slot>` và `?resume=<setupRunId>`;
  - `resumeHref(target: ResumeTarget): string | null`, cho OR-1/OR-2 dùng qua `@/features/wizards`.

Các bước:

| Bước | Làm |
|---|---|
| `agent` | `POST` agent theo I9 (vai trò từ `slot`, model chọn trong `CREW_MODELS`, mặc định `ROLE_MODELS`) |
| `pin` | `PATCH /agents/:id {adapterConfig:{extraArgs}}` (merge) nếu `extraArgs` lệch `pinDir` hiện tại; `putInstructions` |
| `environment` | như WZ-2 cho một vai trò; `PATCH /agents/:id {defaultEnvironmentId}` |
| `workspace` | job `agent-workspace {projectKey, folder, role: slot, branch}`, `folder` lấy từ `refs.root` của setup run `add-project` của project, hoặc `inspect-folder` mới nếu project do app tạo (hỏi folder ở bước 1) |
| `role` | đọc vai trò hiện tại, thay hoặc thêm agent vào `slot`, `POST roles` |
| `assistant-instructions` | nếu tập executor đổi: render lại `AGENTS.md` của Trợ Lý (`putInstructions`) |

- [ ] **Step 1: Test (đỏ).**
  - `add-agent.test.ts`:
    - thêm `executor-2` → đủ 6 bước, bước cuối `PUT` Trợ Lý có tên executor mới;
    - thay reviewer → không có bước `assistant-instructions`;
    - lỗi `workspace` → agent mới bị pause, run `failed`, agent `not_ready` A5 (qua `computeAgentReadiness`).
  - `resume.test.ts`:
    - `{wizard:'add-agent', step:'workspace', agentId}` → `agents/new?resume=<runId>` khi có run;
    - không có run (agent do app tạo, thiếu A2) → `agents/new?fix=<agentId>&step=pin`.

      Wizard chạy chế độ "sửa": bỏ bước `agent`, làm bước được chỉ, rồi các bước sau nếu chưa đạt.
  - `add-agent-page.test.tsx`: agent chưa xong không có trong hộp chọn người nhận (S13.7). Kiểm qua `useProjectReadiness` trả `not_ready`, nên `NewRequestDialog` không có project đó khi vai trò trỏ agent dở.
- [ ] **Step 2: Chạy, đỏ. Step 3: Cài. Step 4: Xanh, typecheck, lint.**
- [ ] **Step 5: Commit** `feat(crew-web): wizard tạo agent và lối làm tiếp từ trạng thái sẵn sàng`.
