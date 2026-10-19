# Gói `policy` — lọc override, bảng model, template research (PO-1, PO-2)

Fork Paperclip, worktree `.worktrees/paperclip-r13-policy` nhánh `crew/r13-policy` từ `v3` `6c20d406c`. Model **opus** (execution policy + bảo mật). Gói ghi: `server/src/crew/{model-policy.ts,issue-create-policy.ts,issue-gate.ts,issue-policy.ts}`, `server/src/__tests__/{crew-model-policy.test.ts,crew-issue-create-policy.test.ts,crew-issue-gate.db.test.ts,crew-issue-gate.test.ts}`. **Không** sửa `core-hooks.ts` (gói `session` giữ): trường mới của `IssueCreateFields` là tùy chọn nên `IssueCreateLike` của registry vẫn gán được.

Lệnh test tầng implementer:

- `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-model-policy.test.ts src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts`
- `corepack pnpm --filter @paperclipai/server typecheck`

## Bối cảnh đã xác minh (08/10, `6c20d406c`)

- `issueAssigneeAdapterOverridesSchema` (`packages/shared/src/validators/issue.ts:296`) = `{ adapterConfig?: Record<string, unknown>, useProjectWorkspace?: boolean }` strict; có trong `createIssueBaseSchema` (l.712) nên có cả ở `createIssueSchema`, `createChildIssueSchema` và `updateIssueSchema` (l.846, `.partial()`).
- Lúc chạy: `parseIssueAssigneeAdapterOverrides` (`heartbeat.ts:5522`, đọc ở l.20336 khi `issue.assigneeAgentId === agent.id`), merge **nông** `{ ...workspaceManagedConfig, ...overrides.adapterConfig }` (l.21130). Agent gửi `command`, `extraArgs`, `env`, `promptTemplate`… sẽ thay cấu hình ghim của R1-2 (wrapper `crew-claude-run`, `--plugin-dir`). `useProjectWorkspace` đổi workspace (l.21127).
- `claude_local` đọc `config.model` (`packages/adapters/claude-local/src/server/execute.ts:496` `resolveClaudeModel`) và `config.effort` (l.436, cờ `--effort` l.906). Danh sách model của adapter (`packages/adapters/claude-local/src/index.ts:29`) có cả `claude-fable-*` và `claude-haiku-4-5`: phải chặn ở Crew.
- H4: `crewBeforeIssueCreate` (`server/src/crew/issue-create-policy.ts`) chạy ở dòng đầu `issueService.create` (`services/issues.ts:9639`), mọi đường tạo (`/children`, `/companies/:id/issues`, accepted-plan decomposition, routine) đi qua. `data` có `labelIds` (destructure ngay sau hook).
- H2: `crewBeforeIssueWrite` (`server/src/crew/issue-gate.ts:287`) trả về sớm khi patch không có `GATE_KEYS = ["status","executionPolicy","executionState","assigneeAgentId"]` (l.273). Kiểm override phải đứng **trước** lần trả về đó. `input.existing.companyId` có sẵn (bản đọc trước khóa).
- Bảng v2: `DEFAULT_COMPLEXITY_MAP` (`V2/packages/shared/src/settings-schemas.ts:251`) trivial haiku/low, small sonnet/medium, medium sonnet/high, large opus/high; `resolveModel` (`V2/apps/daemon/src/roles/model-policy.ts`) không có mặc định khi thiếu complexity, `fable` → opus. O14 bỏ haiku cho code ⇒ trivial thành sonnet/low.
- Template: `buildCrewPolicy` (`issue-policy.ts:165`); `docsGateStages` = review thứ hai trước approval đầu, `pushGateStages` = review sau approval đầu (`issue-gate.ts:125`, `:133`) ⇒ policy `[review, approval]` không có stage docs/push.
- Nhãn: bảng `labels` (`packages/db/src/schema/labels.ts`) `{ id, companyId, name, color }`, unique `(companyId, name)`.

## Task PO-1 — bảng model và lọc override

**Files:**
- Create: `server/src/crew/model-policy.ts`, `server/src/__tests__/crew-model-policy.test.ts`
- Modify: `server/src/crew/issue-create-policy.ts` (`IssueCreateFields`, `CreatePolicyDecision`, `decideCreatePolicy`, `MESSAGES`, `crewBeforeIssueCreate`)
- Modify: `server/src/crew/issue-gate.ts` (`crewBeforeIssueWrite`)
- Test: `server/src/__tests__/crew-issue-create-policy.test.ts`, `server/src/__tests__/crew-issue-gate.db.test.ts`

**Interfaces:**
- Produces: `CREW_COMPLEXITY_MODEL`, `CREW_ALLOWED_MODELS`, `CREW_ALLOWED_EFFORTS`, `CREW_OVERRIDE_FORBIDDEN_MESSAGE`, `checkAgentAdapterOverrides(value: unknown): string[]`; mã `crew_override_forbidden` (gói `roles` giải thích; RA-1 test đối chiếu bảng).

- [ ] **Step 1: Test thất bại** `server/src/__tests__/crew-model-policy.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  CREW_ALLOWED_EFFORTS,
  CREW_ALLOWED_MODELS,
  CREW_COMPLEXITY_MODEL,
  checkAgentAdapterOverrides,
} from "../crew/model-policy.ts";

describe("CREW_COMPLEXITY_MODEL", () => {
  it("không haiku cho code, không fable; chỉ large dùng opus", () => {
    expect(CREW_COMPLEXITY_MODEL).toEqual({
      trivial: { model: "claude-sonnet-5", effort: "low" },
      small: { model: "claude-sonnet-5", effort: "medium" },
      medium: { model: "claude-sonnet-5", effort: "high" },
      large: { model: "claude-opus-5", effort: "high" },
    });
    expect([...CREW_ALLOWED_MODELS].sort()).toEqual(["claude-opus-5", "claude-sonnet-5"]);
    expect([...CREW_ALLOWED_EFFORTS]).toEqual(["low", "medium", "high"]);
  });
});

describe("checkAgentAdapterOverrides", () => {
  it("cho phép rỗng, null và chỉ model/effort trong danh sách", () => {
    expect(checkAgentAdapterOverrides(undefined)).toEqual([]);
    expect(checkAgentAdapterOverrides(null)).toEqual([]);
    expect(checkAgentAdapterOverrides({})).toEqual([]);
    expect(checkAgentAdapterOverrides({ adapterConfig: {} })).toEqual([]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "claude-opus-5", effort: "high" } })).toEqual([]);
  });
  it("liệt kê mọi key lạ và giá trị ngoài danh sách", () => {
    expect(
      checkAgentAdapterOverrides({
        useProjectWorkspace: true,
        adapterConfig: { extraArgs: ["--plugin-dir", "/tmp/x"], command: "/bin/sh", env: {}, model: "claude-fable-5", effort: "max" },
      }),
    ).toEqual([
      "useProjectWorkspace",
      "adapterConfig.extraArgs",
      "adapterConfig.command",
      "adapterConfig.env",
      "adapterConfig.model:claude-fable-5",
      "adapterConfig.effort:max",
    ]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "claude-haiku-4-5" } })).toEqual([
      "adapterConfig.model:claude-haiku-4-5",
    ]);
  });
  it("sai khung", () => {
    expect(checkAgentAdapterOverrides("opus")).toEqual(["shape"]);
    expect(checkAgentAdapterOverrides([])).toEqual(["shape"]);
    expect(checkAgentAdapterOverrides({ adapterConfig: ["x"] })).toEqual(["adapterConfig"]);
  });
});
```

- [ ] **Step 2: Chạy, kỳ vọng FAIL** — `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-model-policy.test.ts` → FAIL `Failed to load url ../crew/model-policy.ts`.

- [ ] **Step 3: Viết `server/src/crew/model-policy.ts`**

```ts
/**
 * Model cho issue con do Trợ Lý tạo, theo độ phức tạp Trợ Lý đánh giá (port bảng complexity của Crew v2).
 * Không haiku cho code, không bao giờ fable. Thiếu đánh giá thì không có mặc định: Trợ Lý phải đánh giá.
 * Bảng này được chép nguyên vào crew/agents/assistant.md (test của crew/agents đối chiếu).
 */
export type CrewComplexity = "trivial" | "small" | "medium" | "large";
export type CrewEffort = "low" | "medium" | "high";

export const CREW_COMPLEXITY_MODEL: Readonly<Record<CrewComplexity, { model: string; effort: CrewEffort }>> = Object.freeze({
  trivial: { model: "claude-sonnet-5", effort: "low" },
  small: { model: "claude-sonnet-5", effort: "medium" },
  medium: { model: "claude-sonnet-5", effort: "high" },
  large: { model: "claude-opus-5", effort: "high" },
});

export const CREW_ALLOWED_MODELS: ReadonlySet<string> = new Set(Object.values(CREW_COMPLEXITY_MODEL).map((c) => c.model));
export const CREW_ALLOWED_EFFORTS: ReadonlySet<string> = new Set<CrewEffort>(["low", "medium", "high"]);

export const CREW_OVERRIDE_FORBIDDEN_MESSAGE =
  "Crew: agent chỉ được đặt model và effort trong assigneeAdapterOverrides.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Vi phạm của `assigneeAdapterOverrides` do agent gửi (rỗng = hợp lệ). Override được merge nông vào cấu hình
 * agent lúc chạy, nên mọi key ngoài `model`/`effort` có thể bỏ ghim Superpowers hoặc wrapper của Crew.
 */
export function checkAgentAdapterOverrides(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) return ["shape"];
  const violations: string[] = [];
  for (const [key, inner] of Object.entries(value)) {
    if (key !== "adapterConfig") {
      violations.push(key);
      continue;
    }
    if (inner === undefined) continue;
    if (!isRecord(inner)) {
      violations.push("adapterConfig");
      continue;
    }
    for (const [configKey, configValue] of Object.entries(inner)) {
      if (configKey === "model") {
        if (typeof configValue !== "string" || !CREW_ALLOWED_MODELS.has(configValue)) {
          violations.push(`adapterConfig.model:${String(configValue)}`);
        }
      } else if (configKey === "effort") {
        if (typeof configValue !== "string" || !CREW_ALLOWED_EFFORTS.has(configValue)) {
          violations.push(`adapterConfig.effort:${String(configValue)}`);
        }
      } else {
        violations.push(`adapterConfig.${configKey}`);
      }
    }
  }
  return violations;
}
```

- [ ] **Step 4: PASS** — chạy lại lệnh Step 2, kỳ vọng 4 passed.

- [ ] **Step 5: Test H4 thất bại** — thêm vào `server/src/__tests__/crew-issue-create-policy.test.ts`

Trong `describe("decideCreatePolicy", …)`:

```ts
  it("agent gửi override ngoài model/effort bị từ chối kèm vi phạm", () => {
    expect(
      decideCreatePolicy({
        data: { createdByAgentId: "e", parentId: "p", assigneeAdapterOverrides: { adapterConfig: { extraArgs: [] } } },
        roles,
        ownerUserId: null,
      }),
    ).toEqual({ kind: "reject", code: "crew_override_forbidden", violations: ["adapterConfig.extraArgs"] });
  });
  it("agent gửi model/effort hợp lệ: template con như thường; board không bị lọc", () => {
    expect(
      decideCreatePolicy({
        data: { createdByAgentId: "e", parentId: "p", assigneeAdapterOverrides: { adapterConfig: { model: "claude-opus-5", effort: "high" } } },
        roles,
        ownerUserId: null,
      }),
    ).toEqual({ kind: "set", template: "child" });
    expect(
      decideCreatePolicy({
        data: { createdByUserId: "owner-1", parentId: "p", assigneeAdapterOverrides: { adapterConfig: { extraArgs: [] } } },
        roles,
        ownerUserId: "owner-1",
      }),
    ).toEqual({ kind: "set", template: "child" });
  });
```

Trong `suite("crew policy in issueService.create", …)` (dùng `seed()` có sẵn):

```ts
  it("agent tạo issue con có override lạ qua createChild bị 422 crew_override_forbidden, không tạo issue", async () => {
    const { companyId, executorId, rootId } = await seed();
    const before = await db.select().from(issues).where(eq(issues.companyId, companyId));
    await expect(
      issueService(db).createChild(rootId, {
        title: "con",
        createdByAgentId: executorId,
        assigneeAgentId: executorId,
        assigneeAdapterOverrides: { adapterConfig: { command: "/bin/sh", model: "claude-fable-5" } },
      } as never),
    ).rejects.toMatchObject({
      status: 422,
      details: { code: "crew_override_forbidden", violations: ["adapterConfig.command", "adapterConfig.model:claude-fable-5"] },
    });
    expect(await db.select().from(issues).where(eq(issues.companyId, companyId))).toHaveLength(before.length);
  });

  it("agent tạo issue con với model/effort hợp lệ: lưu đúng override", async () => {
    const { executorId, rootId } = await seed();
    const { issue } = await issueService(db).createChild(rootId, {
      title: "con",
      createdByAgentId: executorId,
      assigneeAgentId: executorId,
      assigneeAdapterOverrides: { adapterConfig: { model: "claude-opus-5", effort: "high" } },
    } as never);
    const [row] = await db.select().from(issues).where(eq(issues.id, issue.id));
    expect(row!.assigneeAdapterOverrides).toEqual({ adapterConfig: { model: "claude-opus-5", effort: "high" } });
  });

  it("company không có trong file cấu hình: override của agent giữ hành vi stock", async () => {
    const { executorId, rootId } = await seed("absent");
    await expect(
      issueService(db).createChild(rootId, {
        title: "con",
        createdByAgentId: executorId,
        assigneeAgentId: executorId,
        assigneeAdapterOverrides: { adapterConfig: { extraArgs: [] } },
      } as never),
    ).resolves.toBeDefined();
  });
```

(`createChild` trả `{ issue }`, như test "agent tạo issue con qua createChild" có sẵn ở dòng ~201.)

- [ ] **Step 6: Chạy, kỳ vọng FAIL** — `vitest run src/__tests__/crew-issue-create-policy.test.ts`: ca override lạ trả `set child` thay vì reject; ca DB tạo được issue.

- [ ] **Step 7: Sửa `server/src/crew/issue-create-policy.ts`**

```ts
import { CREW_OVERRIDE_FORBIDDEN_MESSAGE, checkAgentAdapterOverrides } from "./model-policy.js";

export interface IssueCreateFields {
  // … các trường có sẵn …
  /** Override cấu hình adapter theo issue; agent chỉ được đặt model/effort (xem model-policy.ts). */
  assigneeAdapterOverrides?: unknown;
}

export type CreatePolicyDecision =
  | { kind: "keep" }
  | {
      kind: "reject";
      code:
        | "crew_agent_root_issue"
        | "crew_roles_unconfigured"
        | "crew_role_assignee"
        | "crew_gate_blocked"
        | "crew_override_forbidden";
      violations?: string[];
    }
  | { kind: "set"; template: "child" }
  | { kind: "set"; template: "root"; ownerUserId: string };
```

Trong nhánh `if (data.createdByAgentId)` của `decideCreatePolicy`, ngay sau kiểm `crew_role_assignee` và trước `return { kind: "set", template: "child" }`:

```ts
    const overrideViolations = checkAgentAdapterOverrides(data.assigneeAdapterOverrides);
    if (overrideViolations.length > 0) {
      return { kind: "reject", code: "crew_override_forbidden", violations: overrideViolations };
    }
```

`MESSAGES` thêm `crew_override_forbidden: CREW_OVERRIDE_FORBIDDEN_MESSAGE`. Trong `crewBeforeIssueCreate`:

```ts
  if (decision.kind === "reject") {
    throw unprocessable(MESSAGES[decision.code], {
      code: decision.code,
      ...(decision.violations ? { violations: decision.violations } : {}),
    });
  }
```

- [ ] **Step 8: PASS** — chạy lại Step 6, kỳ vọng mọi ca PASS (kể cả ca cũ).

- [ ] **Step 9: Test H2 thất bại** — thêm vào `server/src/__tests__/crew-issue-gate.db.test.ts` (dùng helper `company()` và `issue(c, {...})` có sẵn):

```ts
  it("agent PATCH override ngoài model/effort bị 422 crew_override_forbidden, DB không đổi", async () => {
    const c = await company();
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId });
    await expect(
      issueService(db).update(issueId, {
        assigneeAdapterOverrides: { useProjectWorkspace: true, adapterConfig: { extraArgs: ["--plugin-dir", "/tmp/x"] } },
        actorAgentId: c.executorId,
      } as never),
    ).rejects.toMatchObject({
      status: 422,
      details: { code: "crew_override_forbidden", violations: ["useProjectWorkspace", "adapterConfig.extraArgs"] },
    });
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row!.assigneeAdapterOverrides ?? null).toBeNull();
  });

  it("agent PATCH model/effort hợp lệ hoặc null thì được; board đặt gì cũng được", async () => {
    const c = await company();
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId });
    await issueService(db).update(issueId, {
      assigneeAdapterOverrides: { adapterConfig: { model: "claude-sonnet-5", effort: "medium" } },
      actorAgentId: c.executorId,
    } as never);
    await issueService(db).update(issueId, { assigneeAdapterOverrides: null, actorAgentId: c.executorId } as never);
    await issueService(db).update(issueId, {
      assigneeAdapterOverrides: { adapterConfig: { extraArgs: ["--verbose"] } },
      actorUserId: "owner-1",
    } as never);
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row!.assigneeAdapterOverrides).toEqual({ adapterConfig: { extraArgs: ["--verbose"] } });
  });

  it("company không có trong file cấu hình: agent PATCH override như stock", async () => {
    const c = await company("absent");
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId });
    await expect(
      issueService(db).update(issueId, {
        assigneeAdapterOverrides: { adapterConfig: { extraArgs: [] } },
        actorAgentId: c.executorId,
      } as never),
    ).resolves.toBeDefined();
  });
```

- [ ] **Step 10: Chạy, kỳ vọng FAIL** — `vitest run src/__tests__/crew-issue-gate.db.test.ts`: ca đầu không ném.

- [ ] **Step 11: Sửa `server/src/crew/issue-gate.ts`** — import `CREW_OVERRIDE_FORBIDDEN_MESSAGE`, `checkAgentAdapterOverrides` từ `./model-policy.js`; ở **đầu** `crewBeforeIssueWrite`, trước kiểm `GATE_KEYS`:

```ts
export async function crewBeforeIssueWrite(input: IssueWriteHookInput): Promise<void> {
  const patch = input.patch as Readonly<Record<string, unknown>>;
  // Override được merge nông vào cấu hình agent lúc chạy: agent chỉ được đổi model/effort.
  if (input.actorAgentId && Object.hasOwn(patch, "assigneeAdapterOverrides")) {
    const violations = checkAgentAdapterOverrides(patch.assigneeAdapterOverrides);
    if (violations.length > 0) {
      const overrideConfig = await loadCrewCompanyConfig(input.existing.companyId);
      if (overrideConfig.kind !== "absent") {
        throw unprocessable(CREW_OVERRIDE_FORBIDDEN_MESSAGE, { code: "crew_override_forbidden", violations });
      }
    }
  }
  if (!GATE_KEYS.some((key) => Object.hasOwn(patch, key))) return;
  // … phần còn lại giữ nguyên …
```

(Kiểm vi phạm trước rồi mới đọc file cấu hình, nên lệnh ghi hợp lệ không tốn thêm lần đọc.)

- [ ] **Step 12: PASS + typecheck** — `vitest run src/__tests__/crew-model-policy.test.ts src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-issue-gate.test.ts` và `corepack pnpm --filter @paperclipai/server typecheck`.

- [ ] **Step 13: Commit** `feat(crew): chỉ cho agent đặt model và effort trong override của issue`

## Task PO-2 — template research theo nhãn

**Files:**
- Modify: `server/src/crew/issue-policy.ts` (`buildCrewPolicy`, hằng `CREW_RESEARCH_LABEL`)
- Modify: `server/src/crew/issue-create-policy.ts` (`IssueCreateFields.labelIds`, `CreatePolicyDecision`, `decideCreatePolicy`, `crewBeforeIssueCreate`, hàm `hasResearchLabel`)
- Test: `server/src/__tests__/crew-issue-gate.test.ts`, `server/src/__tests__/crew-issue-create-policy.test.ts`

**Interfaces:**
- Produces: `buildCrewPolicy("research", roles, ownerUserId)`; `CREW_RESEARCH_LABEL = "research"`; quyết định `{ kind: "set", template: "research", ownerUserId }`.

- [ ] **Step 1: Test thất bại**

`crew-issue-gate.test.ts` (import thêm `docsGateStages`, `pushGateStages` từ `../crew/issue-gate.ts`):

```ts
describe("template research", () => {
  it("hai stage reviewer → owner, không có stage docs hay push", () => {
    const policy = buildCrewPolicy("research", roles, "owner-1");
    expect(policy.stages.map((s) => [s.type, s.participants.map((p) => p.agentId ?? p.userId)])).toEqual([
      ["review", [REVIEWER]],
      ["approval", ["owner-1"]],
    ]);
    expect(policy.maxReviewRounds).toBe(CREW_MAX_REVIEW_ROUNDS);
    expect(docsGateStages(policy)).toEqual([]);
    expect(pushGateStages(policy)).toEqual([]);
  });
  it("research cần owner", () => {
    expect(() => buildCrewPolicy("research", roles)).toThrow(/owner/);
  });
});
```

`crew-issue-create-policy.test.ts`, trong `describe("decideCreatePolicy", …)`:

```ts
  it("board tạo issue gốc có nhãn research: template research; issue con có nhãn vẫn template con", () => {
    expect(
      decideCreatePolicy({ data: { createdByUserId: "board-2" }, roles, ownerUserId: "owner-1", researchLabel: true }),
    ).toEqual({ kind: "set", template: "research", ownerUserId: "owner-1" });
    expect(
      decideCreatePolicy({ data: { createdByUserId: "board-2", parentId: "p" }, roles, ownerUserId: "owner-1", researchLabel: true }),
    ).toEqual({ kind: "set", template: "child" });
  });
```

Trong `suite("crew policy in issueService.create", …)` (import thêm `labels` từ `@paperclipai/db`):

```ts
  it("board tạo issue gốc có nhãn Research (hoa thường bất kỳ): policy hai stage; không nhãn: bốn stage", async () => {
    const { companyId } = await seed();
    const labelId = randomUUID();
    await db.insert(labels).values({ id: labelId, companyId, name: "Research", color: "#888888" });
    const research = await issueService(db).create(companyId, { title: "r", createdByUserId: "owner-1", labelIds: [labelId] } as never);
    const plain = await issueService(db).create(companyId, { title: "p", createdByUserId: "owner-1" } as never);
    const stagesOf = async (id: string) =>
      ((await db.select().from(issues).where(eq(issues.id, id)))[0]!.executionPolicy as { stages: { type: string }[] }).stages.map((s) => s.type);
    expect(await stagesOf(research.id)).toEqual(["review", "approval"]);
    expect(await stagesOf(plain.id)).toEqual(["review", "review", "approval", "review"]);
  });

  it("nhãn research của company khác không tính", async () => {
    const { companyId } = await seed();
    const other = await seed();
    const labelId = randomUUID();
    await db.insert(labels).values({ id: labelId, companyId: other.companyId, name: "research", color: "#888888" });
    await expect(
      issueService(db).create(companyId, { title: "r", createdByUserId: "owner-1", labelIds: [labelId] } as never),
    ).rejects.toMatchObject({ status: 422 });
  });
```

(Ca thứ hai: stock `assertValidLabelIds` ném 422 "One or more labels are invalid for this company" (`services/issues.ts:7113`), nên nhãn company khác không bao giờ thành research.)

- [ ] **Step 2: Chạy, kỳ vọng FAIL** — `vitest run src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-create-policy.test.ts`.

- [ ] **Step 3: Sửa `server/src/crew/issue-policy.ts`**

```ts
/** Nhãn owner gắn khi tạo issue gốc cho yêu cầu research (không sửa code). */
export const CREW_RESEARCH_LABEL = "research";

/**
 * Template policy của Crew, đã normalize (có id stage/participant).
 * - con: `[review reviewer]`.
 * - gốc: `[review reviewer, review integrator (merge + docs), approval owner, review integrator (push)]`.
 * - research: `[review reviewer, approval owner]` — không integrator, không docs gate, không push.
 */
export function buildCrewPolicy(
  kind: "root" | "child" | "research",
  roles: CrewRoles,
  ownerUserId: string | null = null,
): IssueExecutionPolicy {
  const reviewer = { type: "review", participants: [{ type: "agent", agentId: roles.reviewerAgentId }] };
  let stages: unknown[] = [reviewer];
  if (kind !== "child") {
    if (!ownerUserId) throw new Error(`buildCrewPolicy: ${kind} policy needs an owner user id`);
    const owner = { type: "approval", participants: [{ type: "user", userId: ownerUserId }] };
    const integrator = { type: "review", participants: [{ type: "agent", agentId: roles.integratorAgentId }] };
    stages = kind === "root" ? [reviewer, integrator, owner, integrator] : [reviewer, owner];
  }
  const policy = normalizeIssueExecutionPolicy({ stages, maxReviewRounds: CREW_MAX_REVIEW_ROUNDS });
  if (!policy) throw new Error("buildCrewPolicy: template normalized to null");
  return policy;
}
```

Hai stage integrator dùng chung một object đầu vào là an toàn: `normalizeIssueExecutionPolicy` dựng object mới và cấp `id` mới cho từng stage/participant (`issue-execution-policy.ts:358–379`, `randomUUID()`), không ghi lên đầu vào.

- [ ] **Step 4: Sửa `server/src/crew/issue-create-policy.ts`**

```ts
import { and, eq, inArray, sql } from "drizzle-orm";
import { labels } from "@paperclipai/db";
import { CREW_RESEARCH_LABEL /* , … import có sẵn */ } from "./issue-policy.js";

export interface IssueCreateFields {
  // … như PO-1 …
  labelIds?: readonly string[] | null;
}

// CreatePolicyDecision thêm:
//   | { kind: "set"; template: "research"; ownerUserId: string }

export function decideCreatePolicy(input: {
  data: IssueCreateFields;
  roles: CrewRoles | null;
  ownerUserId: string | null;
  sourceExecutorAgentIds?: readonly string[];
  /** Board tạo issue có nhãn `research` cùng company. */
  researchLabel?: boolean;
}): CreatePolicyDecision {
  // … nhánh agent và hệ thống giữ nguyên …
  if (data.executionPolicy != null || !roles) return { kind: "keep" };
  if (data.parentId) return { kind: "set", template: "child" };
  if (!input.ownerUserId) return { kind: "keep" };
  return input.researchLabel
    ? { kind: "set", template: "research", ownerUserId: input.ownerUserId }
    : { kind: "set", template: "root", ownerUserId: input.ownerUserId };
}

async function hasResearchLabel(db: Db, companyId: string, labelIds: readonly string[] | null | undefined): Promise<boolean> {
  if (!labelIds || labelIds.length === 0) return false;
  const rows = await db
    .select({ id: labels.id })
    .from(labels)
    .where(
      and(
        eq(labels.companyId, companyId),
        inArray(labels.id, [...labelIds]),
        sql`lower(${labels.name}) = ${CREW_RESEARCH_LABEL}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}
```

Trong `crewBeforeIssueCreate`: chỉ truy vấn nhãn khi board tạo issue gốc không policy:

```ts
  const boardRoot = !data.createdByAgentId && !!data.createdByUserId?.trim() && !data.parentId && data.executionPolicy == null;
  const researchLabel = boardRoot ? await hasResearchLabel(input.db, input.companyId, data.labelIds) : false;
  const decision = decideCreatePolicy({ data, roles, ownerUserId, sourceExecutorAgentIds, researchLabel });
  // …
  const policy =
    decision.template === "child"
      ? buildCrewPolicy("child", roles as CrewRoles)
      : buildCrewPolicy(decision.template, roles as CrewRoles, decision.ownerUserId);
```

Sửa chú thích của `decideCreatePolicy`: thêm câu "Board tạo issue gốc có nhãn `research` nhận template research (reviewer → owner)."

- [ ] **Step 5: PASS + typecheck** — lệnh test của gói + `corepack pnpm --filter @paperclipai/server typecheck`.

- [ ] **Step 6: Commit** `feat(crew): issue gốc gắn nhãn research đi reviewer rồi owner`

## Rủi ro

| Rủi ro | Khả năng × ảnh hưởng | Giảm thiểu |
|---|---|---|
| Một đường stock ghi `assigneeAdapterOverrides` không qua `issueService.update`/`create` | Thấp × Cao | Hai hook nằm ở hàm service, mọi route đi qua; AC-3 Cổng 2a gọi REST thật |
| Agent tự `PATCH /api/agents/:id` đổi `adapterConfig` (lối ngang hàng, ngoài phạm vi gói) | Chưa rõ × Cao | AC-3 Cổng 2c kiểm; nếu được thì dừng hỏi owner |
| Upstream đổi tên model (`claude-sonnet-5`) | Trung bình × Trung bình | Một bảng duy nhất, test đối chiếu `assistant.md`; nâng bảng khi nâng adapter |
| Owner gắn nhãn research sau khi tạo | Trung bình × Thấp | Không đổi policy (ruling); board sửa `executionPolicy` hoặc tạo lại |

**Rollback:** revert PO-2 (issue gốc mới lại 4 stage; issue research cũ giữ policy đã ghim) và/hoặc PO-1 (agent lại đặt được override bất kỳ — chỉ revert khi chặn nhầm luồng thật). Không migration, không dữ liệu cần dọn.
