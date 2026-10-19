# Gói `policy` — H2 logic thật và H4 (PL-1, PL-2)

Fork Paperclip, worktree `.worktrees/paperclip-r12-policy` nhánh `crew/r12-policy` từ `v3` (`e1c3dd2db`). Model opus. Một worker làm PL-1 rồi PL-2.

Chuẩn bị một lần cho gói (từ gốc worktree):

```bash
test "$(git rev-parse --show-toplevel)" = "$(pwd -P)" || exit 1
corepack pnpm install
corepack pnpm --filter @paperclipai/plugin-sdk ensure-build-deps
corepack pnpm --filter @paperclipai/paperclip-runner run build:typescript
```

## Bối cảnh đã xác minh (đọc theo symbol, không đọc cả file)

- `server/src/crew/core-hooks.ts`: `BeforeIssueWriteInput { tx, issueId, existing, patch, actorAgentId, actorUserId }`, `implementations.beforeIssueWrite = async () => {}`, `overrideCrewCoreHooksForTests`. Implementation không import registry (khuôn `load-gate.ts` tự khai báo lại shape).
- `server/src/services/issues.ts`: `update` → `runUpdate` (hook H2 là dòng đầu, trước khi đọc `receiptExisting … .for("update")`); `create: async (companyId, data, dbOrTx = db)` (chỉ một chỗ `    create: async (` trong file); `createChild` gọi `issueService(db).create(parent.companyId, { ...issueData, parentId, … })` và giữ `createdByAgentId` trong `issueData`; `resolveResponsibleUserIdForIssueCreate` cho issue con lấy `responsibleUserId`/`createdByUserId` của cha. Import `crewCoreHooks` đã có ở cuối file.
- `server/src/routes/issues.ts` PATCH: `applyIssueExecutionPolicyTransition` gộp vào patch rồi `updateIssue(tx)`, **sau đó** mới `tx.insert(issueExecutionDecisions)`. Vậy lúc H2 chạy, quyết định của chính request này chưa có trong bảng; H2 nhận ra nó qua `patch.executionState` (`completedStageIds` thêm stage hiện tại, `lastDecisionOutcome: "approved"`) và actor = `currentParticipant`.
- `issue-execution-policy.ts`: `canAutoSkipPendingStage` hoàn tất stage review mà participant duy nhất là executor, không tạo decision; `reviewEscalationUserId` = `responsibleUserId` rồi `createdByUserId`; thoát vòng khi `changesRequestedCount + 1 >= maxReviewRounds` (agent); board override (`allowBoardOverride`) đặt `executionState = null`; `stripMonitorFromExecutionPolicy` (dùng khi heartbeat xóa monitor) bỏ mất `maxReviewRounds`.
- Người gọi `update` không actor: `load-gate.ts` `blockIssue` (`status: "blocked"`), plugin `run-cancelled.ts`, heartbeat xóa monitor (`buildIssueMonitorClearedPatch`). H2 không được chặn các ghi này.

## Task PL-1: H2 — khóa policy, chặn `done` thiếu stage hoặc thiếu docs

**Files:**
- Create: `server/src/crew/issue-policy.ts`
- Create: `server/src/crew/issue-gate.ts`
- Modify: `server/src/crew/core-hooks.ts` (import `crewBeforeIssueWrite`, gán `implementations.beforeIssueWrite`)
- Create: `server/src/__tests__/crew-issue-gate.test.ts` (unit, không DB)
- Create: `server/src/__tests__/crew-issue-gate.db.test.ts` (embedded PG, gọi `issueService(db).update` thật)
- Modify: `server/src/__tests__/crew-core-hooks.test.ts` (bỏ khẳng định "beforeIssueWrite mặc định không chặn")
- Modify: `crew/release/core-hooks.json` (mục H2: `tests` thêm hai file test mới)

**Interfaces:**
- Consumes: `normalizeIssueExecutionPolicy`, `parseIssueExecutionState` (`server/src/services/issue-execution-policy.ts`), `persistActivity` (`server/src/services/activity-log.ts`), `unprocessable` (`server/src/errors.ts`), bảng `agents`, `companies`, `issues`, `issueExecutionDecisions`, `issueComments` (`@paperclipai/db`).
- Produces (dùng ở PL-2, RO-1, AC-2):
  - `CREW_MAX_REVIEW_ROUNDS = 5`
  - `type CrewRole = "reviewer" | "integrator"`, `interface CrewRoles { reviewerAgentId: string; integratorAgentId: string }`
  - `readCrewRole(metadata: unknown): CrewRole | null`, `pickCrewRoles(rows): CrewRoles | null`, `loadCrewRoles(db: Db, companyId: string): Promise<CrewRoles | null>`, `loadCompanyOwnerUserId(db: Db, companyId: string): Promise<string | null>`
  - `buildCrewPolicy(kind: "root" | "child", roles: CrewRoles, ownerUserId?: string | null): IssueExecutionPolicy`
  - `policyGateFingerprint(policy: unknown): string`
  - `CREW_DOCS_CHECK_RE`, `interface DocsCheckEvidence { commit: string; base: string; head: string; exit: 0 | 1 | 2 | 3 }`, `parseDocsCheckEvidence(body: string): DocsCheckEvidence | null`
  - `evaluateIssueGate(facts: IssueGateFacts): IssueGateVerdict`, `crewBeforeIssueWrite(input: IssueWriteHookInput): Promise<void>`

- [ ] **Step 1: Viết test unit thất bại cho `issue-policy.ts`**

`server/src/__tests__/crew-issue-gate.test.ts` (phần 1):

```ts
import { describe, expect, it } from "vitest";
import {
  buildCrewPolicy,
  CREW_MAX_REVIEW_ROUNDS,
  parseDocsCheckEvidence,
  pickCrewRoles,
  policyGateFingerprint,
} from "../crew/issue-policy.ts";

const REVIEWER = "11111111-1111-4111-8111-111111111111";
const INTEGRATOR = "22222222-2222-4222-8222-222222222222";
const EXECUTOR = "33333333-3333-4333-8333-333333333333";
const roles = { reviewerAgentId: REVIEWER, integratorAgentId: INTEGRATOR };
const SHA_BASE = "a".repeat(40);
const SHA_HEAD = "b".repeat(40);

describe("pickCrewRoles", () => {
  it("cần đúng một agent không terminated cho mỗi vai trò", () => {
    const rows = [
      { id: REVIEWER, status: "idle", metadata: { crewRole: "reviewer" } },
      { id: INTEGRATOR, status: "idle", metadata: { crewRole: "integrator" } },
      { id: EXECUTOR, status: "idle", metadata: null },
    ];
    expect(pickCrewRoles(rows)).toEqual(roles);
    expect(pickCrewRoles([...rows, { id: EXECUTOR, status: "idle", metadata: { crewRole: "reviewer" } }])).toBeNull();
    expect(pickCrewRoles([rows[0]!, { ...rows[1]!, status: "terminated" }])).toBeNull();
  });
});

describe("buildCrewPolicy", () => {
  it("issue con chỉ có stage reviewer, 5 vòng", () => {
    const policy = buildCrewPolicy("child", roles);
    expect(policy.maxReviewRounds).toBe(CREW_MAX_REVIEW_ROUNDS);
    expect(policy.stages.map((s) => [s.type, s.participants.map((p) => p.agentId ?? p.userId)])).toEqual([
      ["review", [REVIEWER]],
    ]);
    expect(policy.stages[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("issue gốc có reviewer, integrator rồi owner", () => {
    const policy = buildCrewPolicy("root", roles, "owner-1");
    expect(policy.stages.map((s) => [s.type, s.participants.map((p) => p.agentId ?? p.userId)])).toEqual([
      ["review", [REVIEWER]],
      ["review", [INTEGRATOR]],
      ["approval", ["owner-1"]],
    ]);
  });

  it("issue gốc thiếu owner thì báo lỗi", () => {
    expect(() => buildCrewPolicy("root", roles, null)).toThrow(/owner/);
  });
});

describe("policyGateFingerprint", () => {
  it("bỏ qua id participant và monitor, bắt thay đổi stage", () => {
    const base = buildCrewPolicy("child", roles);
    const sameWithMonitor = {
      ...base,
      stages: base.stages.map((s) => ({ ...s, participants: s.participants.map((p) => ({ ...p, id: "x" })) })),
      monitor: { nextCheckAt: "2026-10-07T10:00:00.000Z" },
    };
    expect(policyGateFingerprint(sameWithMonitor)).toBe(policyGateFingerprint(base));
    expect(policyGateFingerprint({ ...base, stages: [] })).toBe("none");
    expect(policyGateFingerprint(null)).toBe("none");
    const swapped = { ...base, stages: [{ ...base.stages[0]!, participants: [{ type: "agent", agentId: EXECUTOR }] }] };
    expect(policyGateFingerprint(swapped)).not.toBe(policyGateFingerprint(base));
  });
});

describe("parseDocsCheckEvidence", () => {
  it("đọc dòng đầu đúng định dạng", () => {
    const body = `crew-docs-check commit=${SHA_HEAD} range=${SHA_BASE}..${SHA_HEAD} exit=0\n\n\`\`\`\nok\n\`\`\``;
    expect(parseDocsCheckEvidence(body)).toEqual({ commit: SHA_HEAD, base: SHA_BASE, head: SHA_HEAD, exit: 0 });
  });

  it("từ chối commit khác đầu range, chữ hoa, hoặc dòng không phải dòng đầu", () => {
    expect(parseDocsCheckEvidence(`crew-docs-check commit=${SHA_BASE} range=${SHA_BASE}..${SHA_HEAD} exit=0`)).toBeNull();
    expect(parseDocsCheckEvidence(`crew-docs-check commit=${SHA_HEAD.toUpperCase()} range=${SHA_BASE}..${SHA_HEAD} exit=0`)).toBeNull();
    expect(parseDocsCheckEvidence(`ghi chú\ncrew-docs-check commit=${SHA_HEAD} range=${SHA_BASE}..${SHA_HEAD} exit=0`)).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, kỳ vọng FAIL**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.test.ts`
Expected: FAIL, `Failed to load url ../crew/issue-policy.ts`.

- [ ] **Step 3: Viết `server/src/crew/issue-policy.ts`**

```ts
import { eq } from "drizzle-orm";
import { agents, companies, type Db } from "@paperclipai/db";
import type { IssueExecutionPolicy } from "@paperclipai/shared";
import { normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.js";

/** Vòng review agent↔agent tối đa của mọi issue Crew; tới vòng này stage được giao cho owner. */
export const CREW_MAX_REVIEW_ROUNDS = 5;

export type CrewRole = "reviewer" | "integrator";

export interface CrewRoles {
  reviewerAgentId: string;
  integratorAgentId: string;
}

/** Vai trò Crew đặt ở `agents.metadata.crewRole`; executor và Trợ Lý không có vai trò. */
export function readCrewRole(metadata: unknown): CrewRole | null {
  if (!metadata || typeof metadata !== "object") return null;
  const role = (metadata as Record<string, unknown>).crewRole;
  return role === "reviewer" || role === "integrator" ? role : null;
}

/** Đúng một agent còn hoạt động cho mỗi vai trò, hai vai trò là hai agent khác nhau; ngược lại `null`. */
export function pickCrewRoles(
  rows: ReadonlyArray<{ id: string; status: string; metadata: unknown }>,
): CrewRoles | null {
  const only = (role: CrewRole): string | null => {
    const ids = rows.filter((r) => r.status !== "terminated" && readCrewRole(r.metadata) === role).map((r) => r.id);
    return ids.length === 1 ? (ids[0] as string) : null;
  };
  const reviewerAgentId = only("reviewer");
  const integratorAgentId = only("integrator");
  if (!reviewerAgentId || !integratorAgentId || reviewerAgentId === integratorAgentId) return null;
  return { reviewerAgentId, integratorAgentId };
}

export async function loadCrewRoles(db: Db, companyId: string): Promise<CrewRoles | null> {
  const rows = await db
    .select({ id: agents.id, status: agents.status, metadata: agents.metadata })
    .from(agents)
    .where(eq(agents.companyId, companyId));
  return pickCrewRoles(rows);
}

export async function loadCompanyOwnerUserId(db: Db, companyId: string): Promise<string | null> {
  const [row] = await db
    .select({ owner: companies.defaultResponsibleUserId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row?.owner?.trim() || null;
}

/** Template policy của Crew, đã normalize (có id stage/participant). */
export function buildCrewPolicy(
  kind: "root" | "child",
  roles: CrewRoles,
  ownerUserId: string | null = null,
): IssueExecutionPolicy {
  const reviewer = { type: "review", participants: [{ type: "agent", agentId: roles.reviewerAgentId }] };
  let stages: unknown[] = [reviewer];
  if (kind === "root") {
    if (!ownerUserId) throw new Error("buildCrewPolicy: root policy needs an owner user id");
    stages = [
      reviewer,
      { type: "review", participants: [{ type: "agent", agentId: roles.integratorAgentId }] },
      { type: "approval", participants: [{ type: "user", userId: ownerUserId }] },
    ];
  }
  const policy = normalizeIssueExecutionPolicy({ stages, maxReviewRounds: CREW_MAX_REVIEW_ROUNDS });
  if (!policy) throw new Error("buildCrewPolicy: template normalized to null");
  return policy;
}

type LooseStage = { id?: unknown; type?: unknown; participants?: unknown };
type LoosePrincipal = { type?: unknown; agentId?: unknown; userId?: unknown };

/**
 * Phần policy quyết định gate: id/type stage và principal participant. Không gồm monitor, id participant,
 * reviewPreset; `maxReviewRounds` được kiểm riêng ở `evaluateIssueGate`.
 */
export function policyGateFingerprint(policy: unknown): string {
  const stages = (policy as { stages?: unknown } | null)?.stages;
  if (!Array.isArray(stages) || stages.length === 0) return "none";
  return JSON.stringify(
    stages.map((raw) => {
      const stage = raw as LooseStage;
      const participants = Array.isArray(stage.participants) ? (stage.participants as LoosePrincipal[]) : [];
      return {
        id: typeof stage.id === "string" ? stage.id : null,
        type: typeof stage.type === "string" ? stage.type : null,
        participants: participants
          .map((p) => `${String(p.type)}:${String(p.type === "agent" ? p.agentId : p.userId)}`)
          .sort(),
      };
    }),
  );
}

export const CREW_DOCS_CHECK_RE =
  /^crew-docs-check commit=([0-9a-f]{40}) range=([0-9a-f]{7,40})\.\.([0-9a-f]{40}) exit=([0-3])$/;

export interface DocsCheckEvidence {
  commit: string;
  base: string;
  head: string;
  exit: 0 | 1 | 2 | 3;
}

/** Bằng chứng `crew-docs check` của integrator: chỉ dòng đầu, `commit` phải là đầu range (merged commit). */
export function parseDocsCheckEvidence(body: string): DocsCheckEvidence | null {
  const first = body.split("\n", 1)[0]?.trim() ?? "";
  const match = CREW_DOCS_CHECK_RE.exec(first);
  if (!match) return null;
  const [, commit, base, head, exit] = match as unknown as [string, string, string, string, string];
  if (commit !== head) return null;
  return { commit, base, head, exit: Number(exit) as DocsCheckEvidence["exit"] };
}
```

- [ ] **Step 4: Chạy test phần 1, kỳ vọng PASS**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.test.ts`
Expected: PASS (6 test).

- [ ] **Step 5: Viết test unit thất bại cho `evaluateIssueGate`** (nối vào cùng file)

```ts
import { evaluateIssueGate, type IssueGateFacts } from "../crew/issue-gate.ts";

const child = buildCrewPolicy("child", roles);
const root = buildCrewPolicy("root", roles, "owner-1");
const [sReview, sIntegrator, sOwner] = root.stages.map((s) => s.id) as [string, string, string];
const executorPrincipal = { type: "agent", agentId: EXECUTOR, userId: null };

function pending(policy: typeof root, stageId: string, participant: object, completed: string[] = []) {
  const index = policy.stages.findIndex((s) => s.id === stageId);
  return {
    status: "pending",
    currentStageId: stageId,
    currentStageIndex: index,
    currentStageType: policy.stages[index]!.type,
    currentParticipant: participant,
    returnAssignee: executorPrincipal,
    reviewRequest: null,
    completedStageIds: completed,
    lastDecisionId: null,
    lastDecisionOutcome: null,
    changesRequestedCount: 0,
  };
}
function completed(ids: string[]) {
  return {
    status: "completed",
    currentStageId: null,
    currentStageIndex: null,
    currentStageType: null,
    currentParticipant: null,
    returnAssignee: executorPrincipal,
    reviewRequest: null,
    completedStageIds: ids,
    lastDecisionId: null,
    lastDecisionOutcome: "approved",
    changesRequestedCount: 0,
  };
}
const docsOk = {
  evidence: { commit: SHA_HEAD, base: SHA_BASE, head: SHA_HEAD, exit: 0 as const },
  createdAt: new Date("2026-10-07T10:00:00Z"),
};
function facts(over: Partial<IssueGateFacts>): IssueGateFacts {
  return {
    locked: { status: "in_review", executionPolicy: root, executionState: pending(root, sReview, { type: "agent", agentId: REVIEWER, userId: null }) },
    patch: {},
    actor: { kind: "agent", agentId: EXECUTOR },
    roles,
    approvals: [],
    lastChangesRequestedAt: null,
    docsEvidence: null,
    ...over,
  };
}

describe("evaluateIssueGate", () => {
  it("chặn agent đổi stage hoặc xóa policy", () => {
    const shrunk = { ...root, stages: root.stages.slice(0, 1) };
    expect(evaluateIssueGate(facts({ patch: { executionPolicy: shrunk } }))).toMatchObject({ kind: "block", code: "crew_policy_locked" });
    expect(evaluateIssueGate(facts({ patch: { executionPolicy: null } }))).toMatchObject({ kind: "block", code: "crew_policy_locked" });
  });

  it("chặn agent nâng maxReviewRounds nhưng cho bỏ nó (về mặc định 3, chặt hơn)", () => {
    expect(evaluateIssueGate(facts({ patch: { executionPolicy: { ...root, maxReviewRounds: 50 } } }))).toMatchObject({ kind: "block" });
    const { maxReviewRounds: _drop, ...noRounds } = root;
    expect(evaluateIssueGate(facts({ patch: { executionPolicy: noRounds } }))).toEqual({ kind: "allow", notes: [] });
  });

  it("monitor: agent chỉ đổi monitor thì được", () => {
    const withMonitor = { ...root, monitor: { nextCheckAt: "2026-10-07T12:00:00.000Z", notes: null, scheduledBy: "assignee" } };
    expect(evaluateIssueGate(facts({ patch: { executionPolicy: withMonitor } }))).toEqual({ kind: "allow", notes: [] });
  });

  it("board đổi policy thì được", () => {
    expect(evaluateIssueGate(facts({ actor: { kind: "board", userId: "owner-1" }, patch: { executionPolicy: null } }))).toEqual({ kind: "allow", notes: [] });
  });

  it("system done: chặn khi stage reviewer còn chờ", () => {
    const v = evaluateIssueGate(facts({ actor: { kind: "system" }, patch: { status: "done" } }));
    expect(v).toMatchObject({ kind: "block", code: "crew_gate_blocked" });
    expect(v.kind === "block" && v.violations).toContain(`stage_unapproved:${sReview}`);
  });

  it("system ghi blocked không bị đụng", () => {
    expect(evaluateIssueGate(facts({ actor: { kind: "system" }, patch: { status: "blocked" } }))).toEqual({ kind: "allow", notes: [] });
  });

  it("auto-skip: stage hoàn tất mà không có decision thì không tính", () => {
    const v = evaluateIssueGate(facts({
      locked: { status: "in_progress", executionPolicy: child, executionState: null },
      patch: { status: "done", executionState: completed([child.stages[0]!.id]) },
    }));
    expect(v).toMatchObject({ kind: "block" });
  });

  it("decision duy nhất do executor ký thì không tính", () => {
    const v = evaluateIssueGate(facts({
      locked: { status: "in_review", executionPolicy: child, executionState: completed([child.stages[0]!.id]) },
      patch: { status: "done" },
      approvals: [{ stageId: child.stages[0]!.id, actorAgentId: EXECUTOR, actorUserId: null }],
    }));
    expect(v).toMatchObject({ kind: "block" });
  });

  it("owner duyệt stage cuối trong chính request này: cho qua khi các stage trước có decision và docs đạt", () => {
    const v = evaluateIssueGate(facts({
      actor: { kind: "board", userId: "owner-1" },
      locked: { status: "in_review", executionPolicy: root, executionState: pending(root, sOwner, { type: "user", agentId: null, userId: "owner-1" }, [sReview, sIntegrator]) },
      patch: { status: "done", executionState: completed([sReview, sIntegrator, sOwner]) },
      approvals: [
        { stageId: sReview, actorAgentId: REVIEWER, actorUserId: null },
        { stageId: sIntegrator, actorAgentId: INTEGRATOR, actorUserId: null },
      ],
      docsEvidence: docsOk,
    }));
    expect(v).toEqual({ kind: "allow", notes: [] });
  });

  it("integrator hoàn tất stage của mình: thiếu docs, docs lỗi, docs cũ thì chặn; exit 3 cho qua kèm ghi chú", () => {
    const base = {
      actor: { kind: "agent" as const, agentId: INTEGRATOR },
      locked: { status: "in_review", executionPolicy: root, executionState: pending(root, sIntegrator, { type: "agent", agentId: INTEGRATOR, userId: null }, [sReview]) },
      patch: { status: "in_review", executionState: { ...pending(root, sOwner, { type: "user", agentId: null, userId: "owner-1" }, [sReview, sIntegrator]), lastDecisionOutcome: "approved" } },
      approvals: [{ stageId: sReview, actorAgentId: REVIEWER, actorUserId: null }],
    };
    expect(evaluateIssueGate(facts(base))).toMatchObject({ kind: "block", violations: ["docs_missing"] });
    expect(evaluateIssueGate(facts({ ...base, docsEvidence: { ...docsOk, evidence: { ...docsOk.evidence, exit: 1 } } }))).toMatchObject({ kind: "block", violations: ["docs_failed:1"] });
    expect(evaluateIssueGate(facts({ ...base, docsEvidence: docsOk, lastChangesRequestedAt: new Date("2026-10-07T11:00:00Z") }))).toMatchObject({ kind: "block", violations: ["docs_stale"] });
    expect(evaluateIssueGate(facts({ ...base, docsEvidence: { ...docsOk, evidence: { ...docsOk.evidence, exit: 3 } } }))).toEqual({ kind: "allow", notes: ["docs_uninitialized"] });
    expect(evaluateIssueGate(facts({ ...base, docsEvidence: docsOk }))).toEqual({ kind: "allow", notes: [] });
  });

  it("board ép done khi còn stage chờ: cho qua dưới dạng override", () => {
    const v = evaluateIssueGate(facts({ actor: { kind: "board", userId: "owner-1" }, patch: { status: "done", executionState: null } }));
    expect(v.kind).toBe("override");
  });

  it("company chưa cấu hình vai trò: agent không done được", () => {
    expect(evaluateIssueGate(facts({ roles: null, patch: { status: "done" } }))).toMatchObject({ kind: "block", violations: expect.arrayContaining(["roles_unconfigured"]) });
  });

  it("issue không có policy: agent không done được", () => {
    expect(evaluateIssueGate(facts({ locked: { status: "in_progress", executionPolicy: null, executionState: null }, patch: { status: "done" } }))).toMatchObject({ kind: "block", violations: ["policy_missing"] });
  });
});
```

- [ ] **Step 6: Chạy test, kỳ vọng FAIL**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.test.ts`
Expected: FAIL, `Failed to load url ../crew/issue-gate.ts`.

- [ ] **Step 7: Viết `server/src/crew/issue-gate.ts`**

```ts
import { and, desc, eq, like } from "drizzle-orm";
import { type Db, issueComments, issueExecutionDecisions, issues } from "@paperclipai/db";
import type { IssueExecutionPolicy, IssueExecutionStage, IssueExecutionStagePrincipal } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";
import { persistActivity } from "../services/activity-log.js";
import { normalizeIssueExecutionPolicy, parseIssueExecutionState } from "../services/issue-execution-policy.js";
import {
  type CrewRoles,
  type DocsCheckEvidence,
  loadCrewRoles,
  parseDocsCheckEvidence,
  policyGateFingerprint,
} from "./issue-policy.js";

/** Cùng shape với BeforeIssueWriteInput trong core-hooks.ts (không import registry). */
export interface IssueWriteHookInput {
  tx: Db;
  issueId: string;
  existing: typeof issues.$inferSelect;
  patch: Readonly<Partial<typeof issues.$inferInsert>>;
  actorAgentId: string | null | undefined;
  actorUserId: string | null | undefined;
}

export type GateActor = { kind: "agent"; agentId: string } | { kind: "board"; userId: string } | { kind: "system" };

export interface IssueGateFacts {
  locked: { status: string; executionPolicy: unknown; executionState: unknown };
  patch: Readonly<Record<string, unknown>>;
  actor: GateActor;
  roles: CrewRoles | null;
  /** Decision `approved` đã lưu của issue. */
  approvals: ReadonlyArray<{ stageId: string; actorAgentId: string | null; actorUserId: string | null }>;
  lastChangesRequestedAt: Date | null;
  /** Comment `crew-docs-check` mới nhất của agent integrator. */
  docsEvidence: { evidence: DocsCheckEvidence; createdAt: Date } | null;
}

export type IssueGateVerdict =
  | { kind: "allow"; notes: string[] }
  | { kind: "override"; violations: string[] }
  | { kind: "block"; code: "crew_policy_locked" | "crew_gate_blocked"; violations: string[] };

function has(patch: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.hasOwn(patch, key) && patch[key] !== undefined;
}

function safePolicy(value: unknown): IssueExecutionPolicy | null {
  try {
    return normalizeIssueExecutionPolicy(value);
  } catch {
    return null;
  }
}

function roundsOf(policy: unknown): number | null {
  const value = (policy as { maxReviewRounds?: unknown } | null)?.maxReviewRounds;
  return typeof value === "number" ? value : null;
}

function actorIs(principal: IssueExecutionStagePrincipal | null | undefined, actor: GateActor): boolean {
  if (!principal) return false;
  if (principal.type === "agent") return actor.kind === "agent" && actor.agentId === principal.agentId;
  return actor.kind === "board" && actor.userId === principal.userId;
}

function signedBy(principal: IssueExecutionStagePrincipal | null | undefined, a: { actorAgentId: string | null; actorUserId: string | null }): boolean {
  if (!principal) return false;
  return principal.type === "agent" ? a.actorAgentId === principal.agentId : a.actorUserId === principal.userId;
}

export function evaluateIssueGate(f: IssueGateFacts): IssueGateVerdict {
  const notes: string[] = [];
  const policyPatched = has(f.patch, "executionPolicy") || (Object.hasOwn(f.patch, "executionPolicy") && f.patch.executionPolicy === null);
  if (policyPatched && f.actor.kind !== "board") {
    const next = f.patch.executionPolicy ?? null;
    const raised = roundsOf(next) !== null && roundsOf(next) !== roundsOf(f.locked.executionPolicy);
    if (policyGateFingerprint(next) !== policyGateFingerprint(f.locked.executionPolicy) || raised) {
      return { kind: "block", code: "crew_policy_locked", violations: ["policy_changed"] };
    }
  }

  const policy = safePolicy(policyPatched ? (f.patch.executionPolicy ?? null) : f.locked.executionPolicy);
  const lockedState = parseIssueExecutionState(f.locked.executionState);
  const nextState = has(f.patch, "executionState")
    ? parseIssueExecutionState(f.patch.executionState)
    : Object.hasOwn(f.patch, "executionState") && f.patch.executionState === null
      ? null
      : lockedState;
  const nextStatus = has(f.patch, "status") ? String(f.patch.status) : f.locked.status;
  const enteringDone = nextStatus === "done" && f.locked.status !== "done";

  const integratorStage: IssueExecutionStage | null =
    policy && f.roles
      ? (policy.stages.find((s) =>
          s.participants.some((p) => p.type === "agent" && p.agentId === f.roles?.integratorAgentId),
        ) ?? null)
      : null;
  const completingIntegrator =
    integratorStage !== null &&
    (nextState?.completedStageIds ?? []).includes(integratorStage.id) &&
    !(lockedState?.completedStageIds ?? []).includes(integratorStage.id);
  if (!enteringDone && !completingIntegrator) return { kind: "allow", notes };

  const violations: string[] = [];
  if (!f.roles) violations.push("roles_unconfigured");
  if (!policy || policy.stages.length === 0) violations.push("policy_missing");

  const executor = lockedState?.returnAssignee ?? null;
  const approvedInThisWrite = (stage: IssueExecutionStage) =>
    lockedState?.status === "pending" &&
    lockedState.currentStageId === stage.id &&
    nextState?.lastDecisionOutcome === "approved" &&
    (nextState.completedStageIds ?? []).includes(stage.id) &&
    actorIs(lockedState.currentParticipant, f.actor) &&
    !actorIs(executor, f.actor);

  const stagesToCheck = enteringDone ? (policy?.stages ?? []) : integratorStage ? [integratorStage] : [];
  for (const stage of stagesToCheck) {
    const stored = f.approvals.some((a) => a.stageId === stage.id && !signedBy(executor, a));
    if (!stored && !approvedInThisWrite(stage)) violations.push(`stage_unapproved:${stage.id}`);
  }

  if (integratorStage) {
    const docs = f.docsEvidence;
    if (!docs) violations.push("docs_missing");
    else if (f.lastChangesRequestedAt && docs.createdAt.getTime() <= f.lastChangesRequestedAt.getTime()) violations.push("docs_stale");
    else if (docs.evidence.exit === 3) notes.push("docs_uninitialized");
    else if (docs.evidence.exit !== 0) violations.push(`docs_failed:${docs.evidence.exit}`);
  }

  if (violations.length === 0) return { kind: "allow", notes };
  if (f.actor.kind === "board") return { kind: "override", violations };
  return { kind: "block", code: "crew_gate_blocked", violations };
}

const GATE_KEYS = ["status", "executionPolicy", "executionState"] as const;

function actorOf(input: IssueWriteHookInput): GateActor {
  if (input.actorAgentId) return { kind: "agent", agentId: input.actorAgentId };
  if (input.actorUserId) return { kind: "board", userId: input.actorUserId };
  return { kind: "system" };
}

export async function crewBeforeIssueWrite(input: IssueWriteHookInput): Promise<void> {
  const patch = input.patch as Readonly<Record<string, unknown>>;
  if (!GATE_KEYS.some((key) => Object.hasOwn(patch, key))) return;
  const { tx, issueId } = input;
  const [locked] = await tx.select().from(issues).where(eq(issues.id, issueId)).for("update");
  if (!locked) return;
  const actor = actorOf(input);
  const roles = await loadCrewRoles(tx, locked.companyId);
  const decisions = await tx
    .select({
      stageId: issueExecutionDecisions.stageId,
      outcome: issueExecutionDecisions.outcome,
      actorAgentId: issueExecutionDecisions.actorAgentId,
      actorUserId: issueExecutionDecisions.actorUserId,
      createdAt: issueExecutionDecisions.createdAt,
    })
    .from(issueExecutionDecisions)
    .where(eq(issueExecutionDecisions.issueId, issueId));
  const changes = decisions.filter((d) => d.outcome === "changes_requested").map((d) => d.createdAt.getTime());
  let docsEvidence: IssueGateFacts["docsEvidence"] = null;
  if (roles) {
    const [comment] = await tx
      .select({ body: issueComments.body, createdAt: issueComments.createdAt })
      .from(issueComments)
      .where(
        and(
          eq(issueComments.issueId, issueId),
          eq(issueComments.authorAgentId, roles.integratorAgentId),
          like(issueComments.body, "crew-docs-check %"),
        ),
      )
      .orderBy(desc(issueComments.createdAt))
      .limit(1);
    const evidence = comment ? parseDocsCheckEvidence(comment.body) : null;
    if (comment && evidence) docsEvidence = { evidence, createdAt: comment.createdAt };
  }
  const verdict = evaluateIssueGate({
    locked: { status: locked.status, executionPolicy: locked.executionPolicy, executionState: locked.executionState },
    patch,
    actor,
    roles,
    approvals: decisions.filter((d) => d.outcome === "approved"),
    lastChangesRequestedAt: changes.length > 0 ? new Date(Math.max(...changes)) : null,
    docsEvidence,
  });
  if (verdict.kind === "block") {
    const message =
      verdict.code === "crew_policy_locked"
        ? "Crew: agent và tiến trình nền không được sửa stage của executionPolicy."
        : `Crew: chưa đủ điều kiện để hoàn tất: ${verdict.violations.join(", ")}.`;
    throw unprocessable(message, { code: verdict.code, violations: verdict.violations });
  }
  const actorFields =
    actor.kind === "board"
      ? { actorType: "user" as const, actorId: actor.userId }
      : actor.kind === "agent"
        ? { actorType: "agent" as const, actorId: actor.agentId, agentId: actor.agentId }
        : { actorType: "system" as const, actorId: "crew" };
  if (verdict.kind === "override") {
    await persistActivity(tx, {
      companyId: locked.companyId,
      ...actorFields,
      action: "crew.policy.board_override",
      entityType: "issue",
      entityId: issueId,
      issueId,
      details: { violations: verdict.violations, toStatus: patch.status ?? null },
    });
  }
  if (verdict.kind === "allow" && verdict.notes.includes("docs_uninitialized")) {
    await persistActivity(tx, {
      companyId: locked.companyId,
      ...actorFields,
      action: "crew.docs_gate.uninitialized",
      entityType: "issue",
      entityId: issueId,
      issueId,
      details: { note: "repo chưa crew-docs init; docs gate cho qua" },
    });
  }
}
```

Ghi chú cho implementer: `persistActivity` không publish sự kiện (khác `logActivity`), nên activity chỉ tồn tại khi transaction commit. Nếu `issueComments.body` hay `createdAt` có tên khác trong schema, sửa theo `packages/db/src/schema/issue_comments.ts` và ghi lệch vào báo cáo.

- [ ] **Step 8: Chạy test unit, kỳ vọng PASS**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.test.ts`
Expected: PASS (toàn bộ `describe` của file).

- [ ] **Step 9: Gắn vào registry và sửa test registry**

`server/src/crew/core-hooks.ts`: thêm `import { crewBeforeIssueWrite } from "./issue-gate.js";` cạnh import `crewBeforeClaim`, đổi `beforeIssueWrite: async () => {}` thành `beforeIssueWrite: crewBeforeIssueWrite,`.

`server/src/__tests__/crew-core-hooks.test.ts`: trong test "không giữ run nào và không chặn lệnh ghi nào", xóa khối `crewCoreHooks.beforeIssueWrite(...)` và đổi tên test thành `"mặc định không giữ run nào"`. Thêm test:

```ts
const { gateCalls } = vi.hoisted(() => ({ gateCalls: [] as unknown[] }));
vi.mock("../crew/issue-gate.ts", () => ({
  crewBeforeIssueWrite: async (input: unknown) => {
    gateCalls.push(input);
  },
}));

describe("H2 registry", () => {
  it("chuyển nguyên input cho crewBeforeIssueWrite", async () => {
    const input = { tx: {} as Db, issueId: "issue-1", existing: { id: "issue-1" } as never, patch: { status: "done" as const }, actorAgentId: "agent-1", actorUserId: null };
    await crewCoreHooks.beforeIssueWrite(input);
    expect(gateCalls).toEqual([input]);
  });
});
```

- [ ] **Step 10: Viết test embedded PG thất bại** `server/src/__tests__/crew-issue-gate.db.test.ts`

Khung theo `crew-before-claim.test.ts` (`getEmbeddedPostgresTestSupport`, `startEmbeddedPostgresTestDatabase("crew-issue-gate-")`, `createDb`, dọn ở `afterAll`). Seed: company (`defaultResponsibleUserId: "owner-1"`), ba agent `process` (`executor` không metadata, `reviewer` `metadata: { crewRole: "reviewer" }`, `integrator` `metadata: { crewRole: "integrator" }`), issue gốc `status: "in_review"`, `assigneeAgentId: reviewer`, `executionPolicy: buildCrewPolicy("root", roles, "owner-1")`, `executionState` pending ở stage reviewer với `returnAssignee` = executor. Bốn test:

```ts
it("system done khi stage reviewer còn chờ bị 422 và issue giữ nguyên", async () => {
  const { issueId } = await seed();
  await expect(issueService(db).update(issueId, { status: "done" })).rejects.toMatchObject({ status: 422 });
  const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
  expect(row!.status).toBe("in_review");
});

it("agent xóa executionPolicy bị 422 crew_policy_locked", async () => {
  const { issueId, executorId } = await seed();
  await expect(
    issueService(db).update(issueId, { executionPolicy: null, actorAgentId: executorId }),
  ).rejects.toMatchObject({ status: 422, details: { code: "crew_policy_locked" } });
});

it("system ghi blocked vẫn được", async () => {
  const { issueId } = await seed();
  const updated = await issueService(db).update(issueId, { status: "blocked" });
  expect(updated?.status).toBe("blocked");
});

it("board ép done thì được và ghi đúng một activity crew.policy.board_override", async () => {
  const { issueId } = await seed();
  await issueService(db).update(issueId, { status: "done", executionState: null, actorUserId: "owner-1" });
  const rows = await db.select().from(activityLog).where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "crew.policy.board_override")));
  expect(rows).toHaveLength(1);
});
```

Nếu `HttpError` không có field `details`/`status` đúng tên, kiểm `server/src/errors.ts` (`class HttpError`) và đổi matcher theo tên thật.

- [ ] **Step 11: Chạy test DB, kỳ vọng PASS** (sau Step 9 đã gắn registry)

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts src/__tests__/crew-issue-gate.test.ts`
Expected: PASS. Máy không hỗ trợ embedded PG thì suite DB bị skip: ghi rõ vào báo cáo, AC-2 Cổng 2 phủ lại.

- [ ] **Step 12: Chạy test policy stock lân cận để chắc không vỡ hành vi upstream**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issue-execution-policy.test.ts src/__tests__/issue-execution-policy-routes.test.ts`
Expected: PASS (route test mock `issueService` nên không chạy H2; service test thuần). Đỏ thì dừng, báo nguyên văn.

- [ ] **Step 13: Cập nhật `crew/release/core-hooks.json` mục H2** — `tests` thành `["server/src/__tests__/crew-core-hooks.test.ts", "server/src/__tests__/crew-issue-gate.test.ts", "server/src/__tests__/crew-issue-gate.db.test.ts"]`. Chạy `node crew/release/check-core-hooks.mjs` → `Hook một dòng: 3/5 … lỗi: 0`; `corepack pnpm --filter @paperclipai/server exec tsc --noEmit` → 0 lỗi.

- [ ] **Step 14: Commit**

```bash
git add server/src/crew/issue-policy.ts server/src/crew/issue-gate.ts server/src/crew/core-hooks.ts \
  server/src/__tests__/crew-issue-gate.test.ts server/src/__tests__/crew-issue-gate.db.test.ts \
  server/src/__tests__/crew-core-hooks.test.ts crew/release/core-hooks.json
git commit -m "feat(crew): enforce review, integrator and docs gates before issue completion"
```

## Task PL-2: H4 — mọi issue mới có policy Crew

**Files:**
- Create: `server/src/crew/issue-create-policy.ts`
- Modify: `server/src/crew/core-hooks.ts` (`IssueCreateLike`, `BeforeIssueCreateInput`, `beforeIssueCreate` trong `CrewCoreHooks`, `implementations`, `crewCoreHooks`)
- Modify: `server/src/services/issues.ts` — đúng một dòng, dòng đầu thân `create: async (companyId, data, dbOrTx = db) => {`
- Create: `server/src/__tests__/crew-issue-create-policy.test.ts` (unit `decideCreatePolicy` + embedded PG qua `issueService(db).create`/`createChild`)
- Modify: `crew/release/core-hooks.json` (mục H4)

**Interfaces:**
- Consumes: `loadCrewRoles`, `loadCompanyOwnerUserId`, `buildCrewPolicy` (PL-1).
- Produces: `crewCoreHooks.beforeIssueCreate<T extends IssueCreateLike>(input: { db: Db; companyId: string; data: T }): Promise<T>`; `decideCreatePolicy(input): CreatePolicyDecision`; mã lỗi `crew_agent_root_issue`, `crew_roles_unconfigured`, `crew_role_assignee`.

Quy tắc (ruling O4 trong ledger):

| Người tạo (`data`) | Điều kiện | Kết quả |
|---|---|---|
| `createdByAgentId` có | company thiếu vai trò | 422 `crew_roles_unconfigured` |
| `createdByAgentId` có | không `parentId` | 422 `crew_agent_root_issue` |
| `createdByAgentId` có | `assigneeAgentId` là reviewer hoặc integrator | 422 `crew_role_assignee` |
| `createdByAgentId` có | còn lại | `executionPolicy` = template con (thay mọi giá trị agent gửi) |
| không agent | `executionPolicy` khác null | giữ nguyên (quyền owner) |
| không agent | không vai trò | giữ nguyên |
| không agent | có `parentId` | template con |
| không agent | không `parentId`, owner = `createdByUserId` ?? `companies.defaultResponsibleUserId` | template gốc; không có owner thì giữ nguyên |

- [ ] **Step 1: Viết test unit thất bại cho `decideCreatePolicy`**

```ts
import { describe, expect, it } from "vitest";
import { decideCreatePolicy } from "../crew/issue-create-policy.ts";

const roles = { reviewerAgentId: "r", integratorAgentId: "i" };

describe("decideCreatePolicy", () => {
  it("agent tạo issue gốc bị từ chối", () => {
    expect(decideCreatePolicy({ data: { createdByAgentId: "e" }, roles, ownerUserId: "owner-1" })).toEqual({ kind: "reject", code: "crew_agent_root_issue" });
  });
  it("agent tạo issue con: luôn thay bằng template con", () => {
    const d = decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", executionPolicy: { stages: [] } }, roles, ownerUserId: null });
    expect(d).toMatchObject({ kind: "set", template: "child" });
  });
  it("agent giao việc cho reviewer bị từ chối", () => {
    expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", assigneeAgentId: "r" }, roles, ownerUserId: null })).toEqual({ kind: "reject", code: "crew_role_assignee" });
  });
  it("agent tạo khi company chưa có vai trò bị từ chối; board thì giữ nguyên", () => {
    expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p" }, roles: null, ownerUserId: null })).toEqual({ kind: "reject", code: "crew_roles_unconfigured" });
    expect(decideCreatePolicy({ data: { createdByUserId: "owner-1" }, roles: null, ownerUserId: null })).toEqual({ kind: "keep" });
  });
  it("board tạo issue gốc không policy: template gốc với owner là người tạo", () => {
    expect(decideCreatePolicy({ data: { createdByUserId: "owner-1" }, roles, ownerUserId: "default-owner" })).toEqual({ kind: "set", template: "root", ownerUserId: "owner-1" });
  });
  it("board gửi policy riêng thì giữ nguyên", () => {
    expect(decideCreatePolicy({ data: { createdByUserId: "owner-1", executionPolicy: { stages: [] } }, roles, ownerUserId: null })).toEqual({ kind: "keep" });
  });
  it("hệ thống tạo issue gốc: owner mặc định của company, không có thì giữ nguyên", () => {
    expect(decideCreatePolicy({ data: {}, roles, ownerUserId: "default-owner" })).toEqual({ kind: "set", template: "root", ownerUserId: "default-owner" });
    expect(decideCreatePolicy({ data: {}, roles, ownerUserId: null })).toEqual({ kind: "keep" });
  });
});
```

- [ ] **Step 2: Chạy, kỳ vọng FAIL**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts`
Expected: FAIL, không load được `../crew/issue-create-policy.ts`.

- [ ] **Step 3: Viết `server/src/crew/issue-create-policy.ts`**

```ts
import type { Db } from "@paperclipai/db";
import { unprocessable } from "../errors.js";
import { buildCrewPolicy, type CrewRoles, loadCompanyOwnerUserId, loadCrewRoles } from "./issue-policy.js";

/** Cùng shape với IssueCreateLike trong core-hooks.ts (không import registry). */
export interface IssueCreateFields {
  parentId?: string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  assigneeAgentId?: string | null;
  executionPolicy?: unknown;
}

export type CreatePolicyDecision =
  | { kind: "keep" }
  | { kind: "reject"; code: "crew_agent_root_issue" | "crew_roles_unconfigured" | "crew_role_assignee" }
  | { kind: "set"; template: "child" }
  | { kind: "set"; template: "root"; ownerUserId: string };

export function decideCreatePolicy(input: {
  data: IssueCreateFields;
  roles: CrewRoles | null;
  ownerUserId: string | null;
}): CreatePolicyDecision {
  const { data, roles } = input;
  if (data.createdByAgentId) {
    if (!roles) return { kind: "reject", code: "crew_roles_unconfigured" };
    if (!data.parentId) return { kind: "reject", code: "crew_agent_root_issue" };
    if (data.assigneeAgentId && [roles.reviewerAgentId, roles.integratorAgentId].includes(data.assigneeAgentId)) {
      return { kind: "reject", code: "crew_role_assignee" };
    }
    return { kind: "set", template: "child" };
  }
  if (data.executionPolicy != null || !roles) return { kind: "keep" };
  if (data.parentId) return { kind: "set", template: "child" };
  const owner = data.createdByUserId?.trim() || input.ownerUserId;
  return owner ? { kind: "set", template: "root", ownerUserId: owner } : { kind: "keep" };
}

const MESSAGES: Record<Extract<CreatePolicyDecision, { kind: "reject" }>["code"], string> = {
  crew_agent_root_issue: "Crew: agent chỉ được tạo issue con (cần parentId).",
  crew_roles_unconfigured: "Crew: company chưa có đúng một agent reviewer và một agent integrator.",
  crew_role_assignee: "Crew: không giao việc thực thi cho agent reviewer hoặc integrator.",
};

export async function crewBeforeIssueCreate<T extends IssueCreateFields>(input: {
  db: Db;
  companyId: string;
  data: T;
}): Promise<T> {
  const roles = await loadCrewRoles(input.db, input.companyId);
  const needsOwner = !input.data.createdByAgentId && !input.data.parentId && !input.data.createdByUserId?.trim();
  const ownerUserId = needsOwner ? await loadCompanyOwnerUserId(input.db, input.companyId) : null;
  const decision = decideCreatePolicy({ data: input.data, roles, ownerUserId });
  if (decision.kind === "keep") return input.data;
  if (decision.kind === "reject") throw unprocessable(MESSAGES[decision.code], { code: decision.code });
  const policy =
    decision.template === "child"
      ? buildCrewPolicy("child", roles as CrewRoles)
      : buildCrewPolicy("root", roles as CrewRoles, decision.ownerUserId);
  return { ...input.data, executionPolicy: policy } as T;
}
```

- [ ] **Step 4: Chạy unit, kỳ vọng PASS**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts`
Expected: PASS (7 test).

- [ ] **Step 5: Mở rộng registry `server/src/crew/core-hooks.ts`**

```ts
import { crewBeforeIssueCreate } from "./issue-create-policy.js";

/** H4: gọi ở dòng đầu `issueService(db).create`, trước mọi kiểm tra; giá trị trả về thay cho `data`. */
export interface IssueCreateLike {
  parentId?: string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  assigneeAgentId?: string | null;
  executionPolicy?: unknown;
}
export interface BeforeIssueCreateInput<T extends IssueCreateLike> {
  db: Db;
  companyId: string;
  data: T;
}
```

Trong `interface CrewCoreHooks` thêm:

```ts
  /** Trả `data` (có thể đã gắn `executionPolicy` template Crew); ném `HttpError` để từ chối tạo issue. */
  beforeIssueCreate<T extends IssueCreateLike>(input: BeforeIssueCreateInput<T>): Promise<T>;
```

`implementations` thêm `beforeIssueCreate: crewBeforeIssueCreate,`; `crewCoreHooks` thêm `beforeIssueCreate: (input) => implementations.beforeIssueCreate(input),`.

- [ ] **Step 6: Chèn hook H4 một dòng** vào `server/src/services/issues.ts`, dòng đầu thân `create`:

```ts
    create: async (
      companyId: string,
      data: IssueCreateInput,
      dbOrTx: Db | DbTransaction = db,
    ) => {
      data = await crewCoreHooks.beforeIssueCreate({ db, companyId, data });
      const {
```

Không thêm import (đã có `import { crewCoreHooks } from "../crew/core-hooks.js";` ở cuối file).

- [ ] **Step 7: Thêm mục H4 vào `crew/release/core-hooks.json`** (sau H3, trước P1):

```json
{
  "id": "H4",
  "kind": "hook",
  "file": "server/src/services/issues.ts",
  "symbol": "issueService.create",
  "head": "    create: async (",
  "anchor": "      data = await crewCoreHooks.beforeIssueCreate({ db, companyId, data });",
  "importLine": "import { crewCoreHooks } from \"../crew/core-hooks.js\";",
  "description": "Attach the Crew execution-policy template to new issues and refuse agent-created root issues.",
  "upstreamPr": null,
  "tests": ["server/src/__tests__/crew-issue-create-policy.test.ts"]
}
```

Run: `node crew/release/check-core-hooks.mjs`
Expected: `Hook một dòng: 4/5; mục: 8; lỗi: 0`.
Run: `node --test crew/release/check-core-hooks.test.mjs`
Expected: PASS.

- [ ] **Step 8: Viết test embedded PG (nối vào `crew-issue-create-policy.test.ts`)** — khung như PL-1 Step 10, seed company `defaultResponsibleUserId: "owner-1"`, ba agent có vai trò, một issue gốc `createdByUserId: "owner-1"`, `responsibleUserId: "owner-1"`:

```ts
it("agent tạo issue gốc qua service bị 422", async () => {
  await expect(issueService(db).create(companyId, { title: "x", createdByAgentId: executorId })).rejects.toMatchObject({ status: 422 });
});

it("agent tạo issue con qua createChild: policy template con, có responsibleUserId để leo thang", async () => {
  const { issue } = await issueService(db).createChild(rootId, { title: "con", createdByAgentId: executorId, executionPolicy: { stages: [] } } as never);
  const [row] = await db.select().from(issues).where(eq(issues.id, issue.id));
  const policy = row!.executionPolicy as { stages: Array<{ type: string }>; maxReviewRounds: number };
  expect(policy.stages.map((s) => s.type)).toEqual(["review"]);
  expect(policy.maxReviewRounds).toBe(5);
  expect(row!.responsibleUserId).toBe("owner-1");
});

it("board tạo issue gốc không policy: template ba stage, owner là người tạo", async () => {
  const created = await issueService(db).create(companyId, { title: "yêu cầu", createdByUserId: "owner-1" });
  const policy = created.executionPolicy as { stages: Array<{ type: string }> };
  expect(policy.stages.map((s) => s.type)).toEqual(["review", "review", "approval"]);
});
```

Nếu `createChild` trả về khác `{ issue }`, đọc kiểu trả về ở `issues.ts` (`createChild: async (parentIssueId, data)`) và sửa destructure.

- [ ] **Step 9: Chạy cả gói, kỳ vọng PASS**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts src/__tests__/crew-core-hooks.test.ts`
Run: `corepack pnpm --filter @paperclipai/server exec tsc --noEmit`
Expected: PASS, 0 lỗi tsc.

- [ ] **Step 10: Commit**

```bash
git add server/src/crew/issue-create-policy.ts server/src/crew/core-hooks.ts server/src/services/issues.ts \
  server/src/__tests__/crew-issue-create-policy.test.ts crew/release/core-hooks.json
git commit -m "feat(crew): attach the Crew execution policy to every new issue"
```

## Rủi ro và rollback

| Rủi ro | Khả năng × tác động | Giảm thiểu |
|---|---|---|
| Đường stock hợp lệ ghi `executionPolicy` không actor (heartbeat xóa monitor bỏ `maxReviewRounds`) bị H2 chặn, heartbeat lỗi | Trung bình × Cao | Fingerprint không gồm monitor; bỏ `maxReviewRounds` được phép (về 3, chặt hơn); chỉ chặn khi đặt số khác |
| Issue cũ (trước R1-2) không policy: agent không `done` được | Cao × Thấp | Owner ép `done` (board override, có activity) hoặc gắn template qua PATCH board |
| Tính năng stock để agent tạo issue gốc (hire, recovery) bị 422 | Thấp × Trung bình | Ruling O4; AC-2 ghi mọi 422 `crew_agent_root_issue` thấy được trong log để owner xem |
| `like` trên body comment chậm khi issue nhiều comment | Thấp × Thấp | Lọc theo `issueId` + `authorAgentId` trước, có index `issue_comments_issue_idx` |

Rollback: revert hai commit; `implementations.beforeIssueWrite` về no-op và bỏ dòng H4 + mục H4 trong `core-hooks.json` (check-core-hooks phải xanh). Không có migration nên không cần đụng DB.
