# R2-4 — Các gói trong fork Paperclip: `adapters`, `policy`, `plugin`, `agents`, `ops`

Fork ở `~/Documents/projects/crew/.worktrees/…` (cùng repo fork như R2-2/R2-3). Nhánh và worktree theo
[plan.md](plan.md) mục "Nhánh và worktree".

Lệnh kiểm chung (chạy từ gốc worktree):
- **server:** `corepack pnpm --filter @paperclipai/server exec vitest run <file>`, `… exec tsc --noEmit`.
- **adapter:** `corepack pnpm --filter @paperclipai/adapter-codex-local exec vitest run <file>` (tên package đọc trong
  `packages/adapters/codex-local/package.json`; opencode tương tự).
- **plugin:** `corepack pnpm --filter @crew/paperclip-plugin exec vitest run <file>`, `… exec tsc --noEmit`,
  `… build`.
- **agents:** `node --test crew/agents/*.test.mjs`.
- **hook:** `node crew/release/check-core-hooks.mjs`.
- **Test DB (Postgres nhúng):** `ipcs -m` trước, một file một lúc, không chạy cùng `verify.sh`.

---

## Gói `adapters`

### Task AD-1: P5 — `codex_local` `sessionCodec` giữ `remoteExecution`

**Files:**
- Modify: `packages/adapters/codex-local/src/server/index.ts` (`sessionCodec`, l.73–110);
  `crew/release/core-hooks.json` (mục P5 theo I7); `crew/release/verify.sh`.
- Create: `packages/adapters/codex-local/src/server/session-codec.crew.test.ts`.

**Interfaces:** Produces: session params của codex qua SSH có `remoteExecution`, nên
`adapterExecutionTargetSessionMatches` khớp ở run sau.

- [ ] **Step 1: Test đỏ.** Chép `packages/adapters/claude-local/src/server/session-codec.crew.test.ts`, đổi
  import/tên `codex_local`. Thêm ca nhánh acpx: `sessionId` rỗng nên đi `acpxSessionCodec`, kết quả không đổi so với
  stock (so `toEqual` với `acpxSessionCodec.serialize(params)`).
- [ ] **Step 2:** Chạy test, kỳ vọng FAIL ở `toMatchObject({ remoteExecution })`.
- [ ] **Step 3: Vá.** Trong `deserialize` và `serialize` nhánh có `sessionId`, thêm như P3:

```ts
    const remoteExecution = readRecord(record.remoteExecution);   // deserialize; serialize dùng params.remoteExecution
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
      ...(remoteExecution ? { remoteExecution } : {}),
    };
```

  `readRecord`: object không phải mảng thì trả object, còn lại `null`. Khai báo cục bộ nếu file chưa có, như P3.
- [ ] **Step 4:** Chạy test, kỳ vọng PASS. Chạy cả `execute.remote.test.ts` của codex-local, phải không vỡ.
- [ ] **Step 5:**
  - Thêm mục P5 (I7) vào `core-hooks.json`.
  - `verify.sh` thêm:
    - `run 5 corepack pnpm --filter <codex-local> exec vitest run src/server/session-codec.crew.test.ts src/server/execute.remote.test.ts`;
    - `run 6 corepack pnpm --filter <codex-local> exec tsc --noEmit`.
  - `node crew/release/check-core-hooks.mjs` báo P5 khớp anchor 2 lần.
- [ ] **Step 6: Commit** `fix(adapter-codex-local): giữ remoteExecution trong session để resume qua SSH`.

### Task AD-2: P6 + P7 — `opencode_local` chạy `in_place`, không ghi `$HOME/.claude/skills`, giữ `remoteExecution`

**Files:**
- Modify:
  - `packages/adapters/opencode-local/src/server/execute.ts` (khối `executionTarget?.kind === "remote"` l.384–475,
    cwd l.259);
  - `packages/adapters/opencode-local/src/server/index.ts` (`sessionCodec`);
  - `crew/release/{core-hooks.json,verify.sh}`.
- Create: `packages/adapters/opencode-local/src/server/{execute.in-place.crew.test.ts,session-codec.crew.test.ts}`.

- [ ] **Step 1: Test đỏ `execute.in-place.crew.test.ts`.** Chép phần `vi.hoisted` mock của `execute.remote.test.ts`.
  Target SSH có `workspaceRealization: { mode: "in_place", authoritativeRoot: "/Users/agent/worktrees/a" }`.

```ts
it("in_place: không sync/restore workspace, chạy ở authoritativeRoot", async () => {
  await execute(ctxWithTarget(inPlaceTarget));
  expect(prepareWorkspaceForSshExecution).not.toHaveBeenCalled();
  expect(restoreWorkspaceFromSshExecution).not.toHaveBeenCalled();
  const runCall = runChildProcess.mock.calls.find(([, , args]) => (args as string[]).includes("run"));
  expect(JSON.stringify(runCall)).toContain("/Users/agent/worktrees/a");
});
it("in_place: không lệnh shell nào đụng $HOME/.claude/skills", async () => {
  await execute(ctxWithTarget(inPlaceTarget));
  const shell = [...runSshCommand.mock.calls, ...runChildProcess.mock.calls].map((c) => JSON.stringify(c)).join("\n");
  expect(shell).not.toMatch(/\.claude\/skills/);
  expect(shell).not.toMatch(/rm -rf/);
});
it("không in_place: giữ hành vi stock (có sync workspace)", async () => {
  await execute(ctxWithTarget(plainSshTarget));
  expect(prepareWorkspaceForSshExecution).toHaveBeenCalled();
});
```

  `session-codec.crew.test.ts` chép từ claude-local, đổi sang opencode, thêm ca `sessionID` (khóa viết hoa của
  opencode).
- [ ] **Step 2:** Chạy, kỳ vọng FAIL.
- [ ] **Step 3: Vá P6.**
  - Ngay trước khối remote:

```ts
  const inPlaceRoot = executionTarget?.workspaceRealization?.mode === "in_place"
    ? executionTarget.workspaceRealization.authoritativeRoot
    : null;
```

  - Trong `prepareAdapterExecutionTargetRuntime({...})` thêm `workspaceRemoteDir: inPlaceRoot ?? undefined,
    syncWorkspace: inPlaceRoot === null`.
  - Thông điệp log `Syncing ${inPlaceRoot ? "OpenCode runtime assets" : "workspace and OpenCode runtime assets"}`.
  - `effectiveExecutionCwd = inPlaceRoot ?? preparedExecutionTargetRuntime.workspaceRemoteDir ?? effectiveExecutionCwd`.
  - `restoreRemoteWorkspace` vẫn gọi được: không có workspace thì chỉ restore asset.
  - Khối chép skills đổi điều kiện thành `if (!inPlaceRoot && remoteHomeDir && preparedExecutionTargetRuntime.assetDirs.skills)`.
  - Đọc `prepareAdapterExecutionTargetRuntime` để chắc `syncWorkspace: false` có cùng nghĩa như codex/claude, ghi
    `file:dòng` vào commit body.
- [ ] **Step 4: Vá P7** như AD-1 Step 3 trên `opencode-local/src/server/index.ts`.
- [ ] **Step 5:** Chạy hai test mới + `execute.remote.test.ts` + `execute.test.ts` của opencode-local, kỳ vọng PASS.
- [ ] **Step 6:**
  - Mục P6, P7 (I7) vào `core-hooks.json`.
  - `verify.sh`: test 2 file mới + `execute.remote.test.ts`, và `tsc` opencode-local.
  - `check-core-hooks.mjs`.
- [ ] **Step 7: Commit** `fix(adapter-opencode-local): chạy in_place trong worktree, không ghi đè skills của máy, giữ session SSH`.

---

## Gói `policy`

### Task SV-1: Catalog runtime/model và kiểm override theo runtime của assignee

**Files:**
- Modify:
  - `server/src/crew/model-policy.ts`;
  - `server/src/crew/issue-create-policy.ts` (l.79);
  - `server/src/crew/issue-gate.ts` (l.307);
  - `server/src/__tests__/crew-{model-policy,issue-create-policy,issue-gate}.test.ts`;
  - `crew/release/core-hooks.json` (`description` H2/H4: thêm "and check model/effort overrides against the
    assignee's runtime").

**Interfaces:**
- Produces: I1 (đầy đủ), `CREW_MODEL_LINE_RE`, `isCrewRuntime`.
- Consumes: `vision` theo `reports/sp-0-probe.md` O1.

- [ ] **Step 1: Test đỏ** (`crew-model-policy.test.ts`; giữ ca cũ, ca cũ gọi không có `adapterType` phải còn xanh):

```ts
describe("CREW_RUNTIME_CATALOG", () => {
  it("cột claude_local trùng CREW_COMPLEXITY_MODEL", () => {
    for (const [level, choice] of Object.entries(CREW_COMPLEXITY_MODEL)) {
      expect(CREW_RUNTIME_CATALOG.claude_local.byComplexity[level as CrewComplexity]).toEqual(choice);
    }
  });
  it("large chỉ có claude_local", () => {
    expect(CREW_RUNTIME_ORDER.large).toEqual(["claude_local"]);
    expect(CREW_RUNTIME_CATALOG.codex_local.byComplexity.large).toBeUndefined();
    expect(CREW_RUNTIME_CATALOG.opencode_local.byComplexity.large).toBeUndefined();
  });
  it("mọi model trong byComplexity có trong models của runtime", () => {
    for (const spec of Object.values(CREW_RUNTIME_CATALOG)) {
      for (const choice of Object.values(spec.byComplexity)) expect(spec.models).toHaveProperty([choice!.model]);
    }
  });
});
describe("checkAgentAdapterOverrides theo runtime", () => {
  it("codex: model gpt-6-sol + modelReasoningEffort high hợp lệ; effort (key claude) bị chặn", () => {
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "gpt-6-sol", modelReasoningEffort: "high" } }, "codex_local")).toEqual([]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "gpt-6-sol", effort: "high" } }, "codex_local")).toEqual(["adapterConfig.effort"]);
  });
  it("opencode: chỉ model, không key effort nào", () => {
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "opencode-go/kimi-k3" } }, "opencode_local")).toEqual([]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "opencode-go/kimi-k3", variant: "high" } }, "opencode_local")).toEqual(["adapterConfig.variant"]);
  });
  it("model của runtime khác bị chặn, ghi @runtime", () => {
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "claude-opus-5" } }, "opencode_local")).toEqual(["adapterConfig.model:claude-opus-5@opencode_local"]);
  });
  it("adapterType lạ hoặc thiếu: luật Claude như cũ", () => {
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "gpt-6-sol" } }, "hermes")).toEqual(["adapterConfig.model:gpt-6-sol"]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "claude-opus-5", effort: "high" } })).toEqual([]);
  });
});
describe("CREW_MODEL_LINE_RE", () => {
  it("nhận marker mới và cũ", () => {
    expect("crew-model complexity=small runtime=opencode_local model=opencode-go/kimi-k3 effort=default reason=bám khuôn").toMatch(CREW_MODEL_LINE_RE);
    expect("crew-model complexity=large model=claude-opus-5 effort=high reason=bảo mật").toMatch(CREW_MODEL_LINE_RE);
    expect("crew-model complexity=small runtime=gemini_local model=x effort=low reason=y").not.toMatch(CREW_MODEL_LINE_RE);
  });
});
```

  `crew-issue-create-policy.test.ts` thêm ca:
  - agent tạo issue con giao executor `opencode_local` với `model: "claude-opus-5"` → 422,
    `violations: ["adapterConfig.model:claude-opus-5@opencode_local"]`;
  - cùng ca với `opencode-go/kimi-k3` → qua.

  `crew-issue-gate.test.ts` (H2): PATCH đổi `assigneeAgentId` sang executor codex kèm override
  `modelReasoningEffort: "high"` → qua. Kèm `effort` → 422.
- [ ] **Step 2:** Chạy ba file, kỳ vọng FAIL.
- [ ] **Step 3: Viết code.**
  - `model-policy.ts` theo I1.
  - `CREW_ALLOWED_MODELS`/`CREW_ALLOWED_EFFORTS` giữ nghĩa cũ (tập Claude) cho code khác đang import.
  - Ở H4 và H2: lấy `adapterType` của assignee cuối cùng (`patch.assigneeAgentId ?? existing.assigneeAgentId`;
    create dùng `data.assigneeAgentId`) bằng `select adapterType from agents where id = $1 and company_id = $2` trên
    `tx`/`db` có sẵn, rồi truyền vào `checkAgentAdapterOverrides`.
- [ ] **Step 4:** Chạy ba file + `crew-core-hooks.test.ts`, kỳ vọng PASS. `tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(crew): bảng model theo runtime và kiểm override theo runtime của assignee`.

### Task SV-2: Thân H1 — cổng công tắc và reconcile trước run fallback

**Files:**
- Create:
  - `server/src/crew/{runtime-switch,runtime-gate,runtime-fallback}.ts`;
  - `server/src/__tests__/crew-{runtime-gate,runtime-switch.db,runtime-fallback-reconcile}.test.ts`.
- Modify:
  - `server/src/crew/load-gate.ts` (`crewBeforeClaim` gọi runtime gate sau load gate; tính `previousRunId` cho
    fallback);
  - `server/src/crew/retry-progress.ts` (`detachBranch`, `detach`);
  - `server/src/__tests__/crew-{load-gate,retry-progress}.test.ts`;
  - `crew/release/core-hooks.json` (`description` H1:
    `"…; hold runs whose runtime is switched off on their environment; before a runtime fallback run, stop the previous run and release its branch."`).

**Interfaces:** I3 (server), I4. Consumes: `crewRolesTable`/`CrewRolesDb` (`project-roles.ts`),
`derivePluginDatabaseNamespace`, `loadCrewCompanyConfig`, `buildRetryProgressCommand`, `parseRetryProgressOutput`
(tên thật trong `retry-progress.ts`).

- [ ] **Step 1: Test đỏ `crew-runtime-gate.test.ts`** (deps giả, không DB):

```ts
const run = (over: Partial<Run> = {}) => ({ id: RUN, agentId: AGENT, status: "queued", contextSnapshot: { issueId: ISSUE }, ...over }) as Run;
const deps = (over: Partial<RuntimeGateDeps> = {}): RuntimeGateDeps => ({
  loadAgent: async () => ({ companyId: CO, adapterType: "codex_local", defaultEnvironmentId: ENV }),
  isCrewCompany: async () => true,
  switchOn: async () => true,
  hasWaitingMarker: async () => false,
  recordWaiting: vi.fn(async () => undefined),
  ...over,
});
it("công tắc ON thì không giữ", async () => { expect(await evaluateRuntimeGate({ db, run: run() }, deps())).toBe(false); });
it("OFF thì giữ và ghi marker một lần", async () => {
  const d = deps({ switchOn: async () => false });
  expect(await evaluateRuntimeGate({ db, run: run() }, d)).toBe(true);
  expect(d.recordWaiting).toHaveBeenCalledWith(expect.objectContaining({ id: RUN }), { runtime: "codex_local", environmentId: ENV, issueId: ISSUE });
  const d2 = deps({ switchOn: async () => false, hasWaitingMarker: async () => true });
  await evaluateRuntimeGate({ db, run: run() }, d2);
  expect(d2.recordWaiting).not.toHaveBeenCalled();
});
it.each([
  ["run không queued", { run: run({ status: "running" }) }],
  ["agent ngoài 3 runtime", { agent: { companyId: CO, adapterType: "hermes", defaultEnvironmentId: ENV } }],
  ["agent không có environment", { agent: { companyId: CO, adapterType: "codex_local", defaultEnvironmentId: null } }],
  ["company không phải Crew", { crew: false }],
])("%s thì không giữ dù OFF", async (_n, c) => { /* dựng deps theo c, switchOn false → kết quả false */ });
it("deps ném lỗi thì không giữ (fail open cho công tắc) và log", async () => {
  expect(await evaluateRuntimeGate({ db, run: run() }, deps({ switchOn: async () => { throw new Error("x"); } }))).toBe(false);
});
```

  Fail open khi lỗi đọc: lỗi hạ tầng không được chặn mọi run. Mặc định của bảng (I3) do `readRuntimeSwitch` xử lý
  riêng.

  `crew-runtime-switch.db.test.ts` (Postgres nhúng, theo khuôn `crew-project-roles.db.test.ts`):
  - bảng chưa có → mặc định I3;
  - có dòng → đúng giá trị;
  - `opencode_local` có dòng `enabled=true` mà env `CREW_OPENCODE_IN_PLACE_PATCH` không đặt → `false`, đặt `"1"` →
    `true`.

  `crew-runtime-fallback-reconcile.test.ts`:
  - `buildRetryProgressCommand(prev, "/Users/a/wt", { detachBranch: "crew/TPS-9" })` chứa `symbolic-ref --short HEAD`,
    `status --porcelain`, `switch --detach`, và in `crew-retry-detach=`. Nhánh bọc `shellQuote`, regex
    `^crew/[A-Z][A-Z0-9]*-\d+$`, sai thì ném.
  - Parse ba đầu ra mẫu ra `done`/`dirty`/`other-branch`.
  - `crewBeforeClaim` với run `wakeReason=crew_runtime_fallback`:
    - `fallbackPreviousRunId` trả `PREV` → gọi kiểm progress với `PREV` và cwd của lease run `PREV`;
    - `dirty` → comment câu §7.4, `blockIssue`, `scheduleCancel`, trả `true`;
    - marker `crew.runtime_fallback.checked` có rồi thì không SSH lại.
  - Nếu G0 P2 = "cần `cancelSuperseded`": run `queued` của agent cũ, khi quyết định `fallback` mới nhất có
    `from_agent_id = run.agentId` và issue đã đổi assignee → `scheduleCancel(run.id, "crew_runtime_fallback")`, trả
    `true`.
- [ ] **Step 2:** Chạy, kỳ vọng FAIL.
- [ ] **Step 3: Viết code.**
  - `runtime-switch.ts` theo I3: đọc bằng savepoint như `project-roles.ts`, kiểm `to_regclass`.
  - `runtime-gate.ts`: `defaultRuntimeGateDeps`:
    - `loadAgent` qua drizzle `agents`;
    - `isCrewCompany` qua `loadCrewCompanyConfig`;
    - marker theo khuôn `firstNoticeAt`/`recordNotice` của load gate (activity, actor system).
  - `runtime-fallback.ts`: `fallbackPreviousRunId` đọc `crew_runtime_decisions`:
    `kind='fallback' AND to_agent_id=$1 AND issue_id=$2 ORDER BY decided_at DESC LIMIT 1`.
  - `load-gate.ts`:
    - sau `decideBeforeClaim` trả `false`, gọi `evaluateRuntimeGate`;
    - nhánh retry progress nhận `previousRunId` từ `retryOfRunId` hoặc fallback;
    - với fallback truyền `detachBranch = "crew/" + issue.identifier`;
    - marker và tiền tố comment fallback theo I4.
- [ ] **Step 4:** Chạy 3 file mới + `crew-load-gate*.test.ts`, `crew-retry-progress.test.ts`,
  `crew-before-claim.test.ts`, `crew-core-hooks.test.ts`. Kỳ vọng PASS. `tsc --noEmit`. `check-core-hooks.mjs`.
- [ ] **Step 5: Commit** `feat(crew): giữ run khi runtime tắt trên máy và reconcile trước run chuyển runtime`.

---

## Gói `plugin`

### Task PL-1: Bảng, công tắc, quyết định `select`, executor 1–3, bản tin `runtimes`, nút gạt

**Files:**
- Create:
  - `packages/crew-plugin/migrations/0006_runtimes.sql`;
  - `src/runtimes/{catalog,switches,decisions,api}.ts`;
  - test `src/__tests__/{runtimes-catalog,runtime-switches.db,runtime-decisions.db}.test.ts`.
- Modify:
  - `src/roles/{api,data}.ts`;
  - `src/machines/webhook.ts`;
  - `src/ui/machines/**` (nút gạt + dòng runtime);
  - `src/manifest.ts` (capability `issues.wakeup`, `agents.read`; route mới);
  - `src/worker.ts` (1 dòng `registerRuntimesFeature(ctx)`);
  - test `roles.db.test.ts`, `machines.test.ts`, `ui-bundle.test.ts` nếu đổi.

**Interfaces:** I1 (bản chép), I2, I3 (route), I8 (parse), data `crew.runtimeDecisions` `{ issueId } →
Array<{ kind, fromRuntime, toRuntime, model, complexity, trigger, reason, decidedAt }>`.

- [ ] **Step 1: Thử migrator với khối `DO`** (lệch 6). Trong `runtime-switches.db.test.ts`, áp `0001…0006` lên
  Postgres nhúng bằng đúng helper migrate của `roles.db.test.ts`. Nếu migrator từ chối `DO $$` thì đổi sang dạng hai
  câu `DROP CONSTRAINT IF EXISTS` theo tên đọc được từ `pg_constraint` trong test, và ghi lại.

```sql
-- 0006_runtimes.sql (sau hai CREATE TABLE và ba INDEX của I2)
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'plugin_crew_core_0433ea20b6.crew_project_roles'::regclass
      AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%cardinality(executor_agent_ids)%'
  LOOP
    EXECUTE format('ALTER TABLE plugin_crew_core_0433ea20b6.crew_project_roles DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_project_roles
  ADD CONSTRAINT crew_project_roles_executor_count CHECK (cardinality(executor_agent_ids) BETWEEN 1 AND 3);
```

- [ ] **Step 2: Test đỏ.**
  - `runtimes-catalog.test.ts`: bản chép `catalog.ts` bằng nguyên văn I1 (so `toEqual` với literal trong test),
    `CREW_MODEL_LINE_RE` đúng chuỗi I1.
  - `runtime-switches.db.test.ts`:
    - GET company chưa có dòng → mỗi environment executor ra mặc định (claude ON, hai cái kia OFF);
    - PUT bởi actor `user` → 200, đọc lại đúng, audit `crew.runtime_switch.set` có `before/after/actorUserId`;
    - PUT bởi actor `agent` → 403 `Chỉ board được bật/tắt runtime`;
    - `runtime` lạ, `environmentId` không phải uuid, environment không thuộc company → 400.
  - `runtime-decisions.db.test.ts`:
    - event `issue.created` có description chứa marker mới → một dòng `select` (complexity, runtime, model, reason);
    - gửi lại event → vẫn một dòng;
    - không có marker → không ghi;
    - data `crew.runtimeDecisions` trả theo `decided_at` tăng.
  - `roles.db.test.ts`:
    - 3 executor khác runtime → lưu được;
    - 2 executor cùng `adapterType` → 400 `Mỗi runtime tối đa một executor trong project`;
    - 4 executor → 400.
  - `machines.test.ts`:
    - bản tin có `runtimes` hợp lệ → giữ;
    - `runtimes` sai dạng (model id có khoảng trắng, `costDay` âm, 61 model) → bỏ riêng `runtimes`, phần còn lại nhận;
    - bản tin không có `runtimes` → như cũ.
- [ ] **Step 3:** Chạy, kỳ vọng FAIL.
- [ ] **Step 4: Viết code** theo khuôn `roles/api.ts` (actor check, audit), `machines/webhook.ts` (trường tùy chọn
  như `app`), `docs/data.ts` (đăng ký data). UI: mỗi environment một hàng ba nút gạt, nhãn tiếng Việt `Claude Code`,
  `Codex`, `OpenCode Go`, dưới mỗi nút là dòng trạng thái từ `latest.runtimes` (phiên bản, đăng nhập/key, quota ước
  tính). Gạt gọi PUT, lỗi hiện câu server trả.
- [ ] **Step 5:** Chạy toàn bộ test plugin, `tsc --noEmit`, `build`. Kỳ vọng PASS.
- [ ] **Step 6: Commit** `feat(crew-plugin): công tắc runtime theo máy, sổ quyết định runtime, tối đa ba executor`.

### Task PL-2: Fallback cùng máy

**Files:**
- Create: `packages/crew-plugin/src/runtimes/{classify,choose,fallback}.ts`,
  `src/__tests__/{runtime-fallback,runtime-fallback.db}.test.ts`.
- Modify: `src/worker.ts` (1 dòng `registerRuntimeFallback(ctx)`), `src/manifest.ts` (job `runtime-fallback`
  `* * * * *`).

**Interfaces:** I5. Consumes: I1 bản chép, I2, I8 `usable`, regex O4 và nguồn `errorFamily` (P1) từ
`reports/sp-0-probe.md`.

- [ ] **Step 1: Test đỏ `runtime-fallback.test.ts`** (hàm thuần):

```ts
const base = {
  complexity: "medium" as const, hasImages: false, trigger: "quota" as const,
  from: { agentId: A_CODEX, runtime: "codex_local" as const, environmentId: ENV },
  candidates: [
    { agentId: A_CLAUDE, name: "repo-a-executor", runtime: "claude_local" as const, environmentId: ENV, status: "idle" },
    { agentId: A_CODEX, name: "repo-a-codex", runtime: "codex_local" as const, environmentId: ENV, status: "idle" },
    { agentId: A_OC, name: "repo-a-opencode", runtime: "opencode_local" as const, environmentId: ENV, status: "idle" },
  ],
  switches: { claude_local: true, codex_local: true, opencode_local: true },
  health: {}, tried: ["codex_local"] as const, fallbacksSoFar: 0,
};
it("medium từ codex → claude sonnet high", () => {
  expect(chooseFallback(base)).toMatchObject({ kind: "fallback", toAgentId: A_CLAUDE, toRuntime: "claude_local", model: "claude-sonnet-5", effort: "high", reason: "hết quota" });
});
it("bỏ runtime OFF, khác máy, paused, không usable", () => {
  expect(chooseFallback({ ...base, switches: { ...base.switches, claude_local: false } })).toMatchObject({ toRuntime: "opencode_local", model: "opencode-go/glm-5.3" });
  expect(chooseFallback({ ...base, candidates: base.candidates.map((c) => c.agentId === A_CLAUDE ? { ...c, environmentId: OTHER } : c) })).toMatchObject({ toRuntime: "opencode_local" });
  expect(chooseFallback({ ...base, health: { claude_local: { usable: false }, opencode_local: { usable: false } } })).toEqual({ kind: "refused", reason: "không còn runtime nào bật, đã đăng nhập và đủ quota trên máy này" });
});
it("large không fallback", () => {
  expect(chooseFallback({ ...base, complexity: "large", from: { ...base.from, runtime: "claude_local", agentId: A_CLAUDE }, tried: ["claude_local"] }))
    .toEqual({ kind: "refused", reason: "mức large chỉ chạy Claude" });
});
it("đã 2 lần thì từ chối", () => {
  expect(chooseFallback({ ...base, fallbacksSoFar: 2 })).toEqual({ kind: "refused", reason: "đã chuyển 2 lần" });
});
it("issue có ảnh bỏ model không vision", () => {
  // vision của opencode-go/glm-5.3 theo I1 (false nếu G0 không đổi)
  expect(chooseFallback({ ...base, hasImages: true, switches: { ...base.switches, claude_local: false } }))
    .toEqual({ kind: "refused", reason: "issue có ảnh, không còn model đọc được ảnh" });
});
it.each([
  [{ adapterType: "codex_local", errorCode: null, errorFamily: "provider_quota", message: null }, "quota"],
  [{ adapterType: "claude_local", errorCode: "provider_quota", errorFamily: null, message: null }, "quota"],
  [{ adapterType: "opencode_local", errorCode: "process_exit", errorFamily: null, message: "<câu quota thật từ SP-0 O4>" }, "quota"],
  [{ adapterType: "opencode_local", errorCode: "process_exit", errorFamily: null, message: "crew-runtime blocked: thiếu key OpenCode Go trong Keychain (service crew.opencode-go)" }, "auth"],
  [{ adapterType: "codex_local", errorCode: "adapter_engine_unavailable", errorFamily: null, message: null }, "unavailable"],
  [{ adapterType: "codex_local", errorCode: "timeout", errorFamily: null, message: null }, "other"],
  [{ adapterType: "claude_local", errorCode: "process_exit", errorFamily: null, message: "crew-workflow blocked: x" }, "other"],
])("classify %#", (input, expected) => { expect(classifyRuntimeFailure(input)).toBe(expected); });
```

  `runtime-fallback.db.test.ts` (Postgres nhúng + ctx giả cho `issues`/`agents`/`events` theo khuôn
  `attachments-audit.db.test.ts`):
  - **quota:** sự kiện `agent.run.failed` {run R1, agent codex, issue medium có policy Crew} →
    - 1 dòng `fallback` (`trigger=quota`);
    - comment đúng câu I5;
    - `issues.update` với `assigneeAgentId=A_CLAUDE`, `assigneeAdapterOverrides.adapterConfig = { model: "claude-sonnet-5", effort: "high" }`;
    - `requestWakeup` 1 lần với `reason: "crew_runtime_fallback"`.
  - **Idempotent:** gửi lại cùng sự kiện → không thêm dòng, không comment, không update (`duplicate`).
  - **`other`:** không làm gì.
  - **Issue không phải Crew, đã `done`, assignee khác agent của run:** `skipped`.
  - **`large`:** dòng `fallback_refused`, comment từ chối, `status: "blocked"`.
  - **Job `switch_off`:**
    - audit `crew.runtime_gate.waiting` mới cho run R2 (agent opencode, OFF) → fallback sang đích ON;
    - không có đích → một comment chờ, dòng `fallback_refused` có `run_id` R2, **không** block;
    - chạy job lần hai → không comment thêm.
- [ ] **Step 2:** Chạy, kỳ vọng FAIL.
- [ ] **Step 3: Viết code.**
  - Ứng viên lấy từ `crew_project_roles.executor_agent_ids` của project issue, cùng `ctx.agents.get` (adapterType,
    status, `defaultEnvironmentId` hoặc trường tương đương trên `Agent` của SDK; nếu SDK không có trường này thì đọc
    bảng `agents` qua `ctx.db` core read nếu được phép, không được thì ghi lệch và hỏi Trợ Lý).
  - `hasImages`: `listAttachments` có `contentType` bắt đầu `image/`.
  - `complexity`: parse `CREW_MODEL_LINE_RE` trong description, thiếu thì `medium`.
  - `tried`: from/to của các dòng `fallback` của issue + runtime hiện tại.
  - `health`: từ `machine_latest.report.runtimes` của máy có hostname khớp environment. Không ghép được máy thì
    `health` rỗng (usable).
- [ ] **Step 4:** Chạy hai file + toàn bộ test plugin, `tsc`, `build`. Kỳ vọng PASS.
- [ ] **Step 5: Commit** `feat(crew-plugin): chuyển runtime cùng máy khi hết quota, mất đăng nhập hoặc runtime bị tắt`.

---

## Gói `agents`

### Task AG-1: Trợ Lý chọn runtime, executor ngoài Claude

**Files:** Modify `crew/agents/{assistant,executor}.md`, `crew/agents/instructions.test.mjs`.

- [ ] **Step 1: Test đỏ** (`instructions.test.mjs`):
  - bảng runtime/model trong `assistant.md` (mục "Chọn runtime và model") khớp từng ô với I1 + `CREW_RUNTIME_ORDER`.
    Test parse bảng markdown, so với literal chép trong test, cùng literal của PL-1 `runtimes-catalog.test.ts`;
  - `MODEL_LINE_RE` đổi thành `CREW_MODEL_LINE_RE` của I1, và mẫu marker trong `assistant.md` khớp;
  - `assistant.md` có câu "Không chọn runtime theo công tắc; Crew tự chuyển khi runtime tắt hoặc hỏng.";
  - `executor.md` có mục `## Khi bạn chạy Codex hoặc OpenCode` chứa:
    - `"$CREW_SUPERPOWERS_DIR/skills/<tên>/SKILL.md"`;
    - lệnh `workflow-check --runtime`;
    - câu xử lý comment `Crew: chuyển runtime sau run`.
- [ ] **Step 2:** `node --test crew/agents/instructions.test.mjs`, kỳ vọng FAIL.
- [ ] **Step 3: Viết instructions.**
  - **`assistant.md`:**
    - thay bảng `complexity | model | effort` bằng bảng runtime (cột: complexity, thứ tự runtime, model/effort mỗi
      runtime);
    - luật: `large` chỉ Claude; gói có ảnh chỉ model đọc được ảnh (cột "ảnh");
    - chọn runtime đầu tiên trong thứ tự mà project có executor runtime ấy (mục "Executor của company" có cột
      runtime);
    - marker mới;
    - `assigneeAdapterOverrides.adapterConfig` theo key effort của runtime (codex: `modelReasoningEffort`, opencode:
      chỉ `model`);
    - giữ luật "cùng gói một model": cùng gói một runtime và một model.
  - **`executor.md`:** thêm mục `## Khi bạn chạy Codex hoặc OpenCode`:
    - Không có `--plugin-dir`. Bước nào ghi `superpowers:<skill>` thì đọc `"$CREW_SUPERPOWERS_DIR/skills/<skill>/SKILL.md"` rồi làm theo.
    - Trước khi báo xong chạy `"$HOME/.crew/bin/crew-mac" workflow-check --runtime "<codex_local|opencode_local>" --root "$(git rev-parse --show-toplevel)"` thay lệnh có `--plugin-dir`.
    - Comment `Crew: chuyển runtime sau run …` xử lý như comment chạy lại (bước 2 hiện có).
- [ ] **Step 4:** Chạy test, kỳ vọng PASS.
- [ ] **Step 5: Commit** `feat(crew-agents): Trợ Lý chọn runtime và model theo độ khó, executor chạy Codex/OpenCode`.

### Task AG-2: Render, cấu hình agent, script tạo executor runtime

**Files:**
- Modify: `crew/agents/{render-instructions,merge-agent-config}.mjs` + `*.test.mjs`.
- Create: `crew/ops/create-runtime-executor.sh`, `crew/ops/create-runtime-executor.test.mjs`.

**Interfaces:** Produces `crewRuntimeAgentConfig({ runtime, model, effort, home })`:
- `codex_local` → `{ command: \`${home}/.crew/bin/crew-codex-run\`, model, modelReasoningEffort: effort, dangerouslyBypassApprovalsAndSandbox: true, env: {} }`;
- `opencode_local` → `{ command: \`${home}/.crew/bin/crew-opencode-run\`, model, env: {} }`.

Ném lỗi khi model không thuộc I1.

- [ ] **Step 1: Test đỏ.**
  - `render-instructions.test.mjs`: danh sách "Executor của company" in `name · runtime · máy`.
  - `merge-agent-config.test.mjs`:
    - `crewRuntimeAgentConfig` đúng hai dạng trên;
    - model ngoài catalog → ném;
    - không bao giờ có `managedAiConnection`.
  - `create-runtime-executor.test.mjs`:
    - dry-run in body JSON sẽ gửi (`POST /api/companies/<c>/agents`): `adapterType`, `adapterConfig`,
      `defaultEnvironmentId`, `maxConcurrentRuns: 1`, `runtimeConfig.heartbeat.enabled: false`;
    - body đi qua file tạm + `scp` (theo bài học R2-1), không nằm trong chuỗi `ssh`.
- [ ] **Step 2:** Chạy, kỳ vọng FAIL.
- [ ] **Step 3: Viết code.** Script chỉ chạy được với `--company`, `--project`, `--environment`, `--runtime`,
  `--model`, `--name`, `--worktree`. In id agent tạo. Không đụng agent khác.
- [ ] **Step 4:** Chạy test, kỳ vọng PASS.
- [ ] **Step 5: Commit** `feat(crew-agents): cấu hình và script tạo executor Codex/OpenCode`.

---

## Gói `ops`

### Task DP-1: Deploy và dựng executor runtime cho `repo-a`

Model opus. Không file nguồn. Ghi `reports/dp-1-report.md`, ledger, `processes.md`.

- [ ] **Step 1: Điều kiện.**
  - R2-3 DP-1 đã xong (ledger R2-3).
  - RV-1 `DONE` hoặc `DONE_WITH_CONCERNS` không blocker.
  - Ghi câu trả lời owner cho Q1 (nguyên văn) vào ledger. Chưa có thì deploy bản **không** chứa P5–P7: tạo nhánh
    deploy `crew/r2-4-nopatch` bằng `git revert` các commit AD-1/AD-2 trên bản sao, và không làm Step 6–7 cho
    OpenCode.
- [ ] **Step 2:** `crew/release/verify.sh` trên `.worktrees/paperclip-r24-int` (`crew/r2-4`), kỳ vọng XANH. Tag
  cục bộ `crew/v3.4-rc1`.
- [ ] **Step 3: Deploy** theo trình tự Global Constraints:
  - `active-runs.sh` rỗng;
  - backup;
  - `overlay-source.sh`/`deploy.sh`;
  - mốc rollback;
  - health, plugin `crew.core` `ready` (migration `0006` đã áp: `crew/ops/plugin-state.sh`), hai site 200.
  - Server env `CREW_OPENCODE_IN_PLACE_PATCH=1` chỉ khi P6 có trong image.
- [ ] **Step 4: Mac mini (0 run active).**
  - Build `@crew/mac` từ `r2-4`, `installCrewMacFrom`, `crew-mac setup`.
  - Kiểm `~/.crew/bin/crew-{codex,opencode}-run`.
  - Khi P6 đã deploy: `: > ~/.crew/runtimes/opencode-in-place`.
  - `crew-mac doctor` (ghi các check runtime), `crew-mac runtimes status`.
- [ ] **Step 5: Worktree.** Thêm 2 worktree cho executor mới của `repo-a` theo cách R1/R2-3 dựng worktree agent:
  `git -C <repo-a> worktree add <…>/repo-a-codex`, `…/repo-a-opencode`, detached ở `origin/HEAD`.
- [ ] **Step 6: Tạo agent.**
  - `crew/ops/create-runtime-executor.sh` cho `codex_local` (`gpt-6-luna`) và `opencode_local`
    (`opencode-go/deepseek-v4-flash`), environment của Mac mini, metadata `in_place` như executor R1.
  - Áp instructions executor (`apply-roles.sh`, body qua scp).
  - Cập nhật `crew_project_roles` của `repo-a`: 3 executor (PUT route roles, actor board).
  - Áp instructions mới cho Trợ Lý `repo-a`.
- [ ] **Step 7:** Công tắc giữ mặc định (codex/opencode OFF) tới AC. Ghi vào ledger:
  - id agent;
  - worktree;
  - image;
  - mốc rollback;
  - kết quả doctor.

  Ghi ledger R3 các điểm phối hợp (plan "Phối hợp").
