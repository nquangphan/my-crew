# Gói `session` — chung session giữa issue con cùng gói (SP-1, BR-1)

Fork Paperclip, worktree `.worktrees/paperclip-r13-session` nhánh `crew/r13-session` từ `v3` `6c20d406c`. Model **opus** (đụng claim/scheduler). Gói ghi: `server/src/crew/{bundle-resume.ts,core-hooks.ts}`, `server/src/__tests__/{crew-claim-resume-contract.test.ts,crew-bundle-resume.test.ts}`, `crew/release/core-hooks.json`, `crew/ops/inspect-image.sh`; nhánh no-go thêm một dòng trong `server/src/services/heartbeat.ts`.

Lệnh test tầng implementer (chạy từ gốc worktree):

- `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-claim-resume-contract.test.ts src/__tests__/crew-bundle-resume.test.ts src/__tests__/crew-core-hooks.test.ts src/__tests__/crew-before-claim.test.ts`
- `node crew/release/check-core-hooks.mjs`
- `corepack pnpm --filter @paperclipai/server typecheck`

## Bối cảnh đã xác minh (08/10, `6c20d406c`)

- H1 là dòng đầu `claimQueuedRun` (`server/src/services/heartbeat.ts:17128`): `if (await crewCoreHooks.beforeClaim({ db, run })) return null;`. Ngay sau đó `const context = parseObject(run.contextSnapshot)` (l.17149) đọc **object `run`** đã truyền vào hook. Lệnh claim (`.set({ status: "running", … })` l.17458) không ghi `contextSnapshot`, nên giá trị đã ghi DB trước đó giữ nguyên.
- `executeRun` (l.19931) đọc lại run từ DB (`let run = await getRun(runId)` l.19953), lấy `context = parseObject(run.contextSnapshot)` (l.20132), rồi `explicitResumeSessionParams = normalizeResumeParamsForAdapter(adapterType, sessionCodec.deserialize(parseObject(context.resumeSessionParams)))` (l.20558). `previousSessionParams = explicitResumeSessionParams ?? … taskSessionForRun …` (l.21366): **tham số tường minh thắng** cả `shouldResetTaskSessionForWake` (wake `issue_assigned`) lẫn `sessionConfigFreshness.reset` (l.21362). Adapter nhận `runtime: { sessionId, sessionParams, sessionDisplayId, taskKey }` (`runtimeForAdapter` l.22534, `AdapterExecutionContext.runtime` trong `packages/adapter-utils/src/types.ts:197`).
- Hai chỗ stock vẫn bỏ session sau đó: `evaluateSessionCompaction` xoay session quá dài (l.22495) và `managedAiRuntime` không tương thích credential (l.22521). Cả hai là hành vi đúng; ghi vào rủi ro.
- Stock enqueue với `payload.resumeFromRunId` lưu `resumeFromRunId`, `resumeSessionDisplayId`, `resumeSessionParams` vào `contextSnapshot` (l.26331–26340). `resolveExplicitResumeSessionOverride` (l.12156) dùng `agent_task_sessions` của `taskKey` của run nguồn; khi `taskSession.lastRunId === resumeFromRunId` thì dùng chính `sessionParamsJson` của task session đó (`buildExplicitResumeSessionOverride` l.5275, `canReuseTaskSessionParams`). Crew làm tương đương: lấy task session của A, `resumeFromRunId = lastRunId`, `resumeSessionParams = sessionParamsJson` (dạng đã serialize, `executeRun` tự deserialize như đường task session thường). Không import `heartbeat.ts` (tránh vòng import: `heartbeat.ts` import `core-hooks.ts`).
- Quan hệ blocker: `issue_relations` (`packages/db/src/schema/issue_relations.ts`), `type = 'blocks'`, `issueId` = **issue chặn** (A), `relatedIssueId` = issue bị chặn (B) (`services/issues.ts:2545`, `:7352`).
- `agent_task_sessions`: unique `(companyId, agentId, adapterType, taskKey)`, cột `sessionParamsJson`, `sessionDisplayId`, `lastRunId`, `updatedAt`. Spike Step 6: sau run B resume, `agent_task_sessions(task_key=B)` giữ session của A; các wake sau của B tiếp tục session đó.
- `claimQueuedRun` hủy run khi issue còn blocker chưa xong (l.17240–17262) **sau** H1; nên H1 chỉ nối khi A đã `done`.
- Harness test: `server/src/__tests__/crew-before-claim.test.ts` mock `../adapters/index.js` (`getServerAdapter` trả `{ supportsLocalAgentJwt: false, execute }`), seed company/agent `process`/issue/run `queued`, gọi `heartbeatService(db).resumeQueuedRuns()` + `drainActiveRunExecutions()`.

## Task SP-1 — spike O12 (hợp đồng claim → adapter)

**Files:**
- Create: `server/src/__tests__/crew-claim-resume-contract.test.ts`
- Create: `plans/261008-0850-crew-v3-r1-3/spike-session.md` (repo Crew; worker gửi nội dung cho Trợ Lý ghi nếu không có quyền ghi repo Crew)

Test này giữ lại lâu dài: nó khóa hợp đồng stock "tham số resume ghi vào run trước claim tới được adapter", để lần nâng upstream biết ngay nếu đổi.

- [ ] **Step 1: Viết test**

```ts
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agentTaskSessions,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueRelations,
  issues,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { overrideCrewCoreHooksForTests } from "../crew/core-hooks.ts";
import { heartbeatService } from "../services/heartbeat.js";

// Stock contract the Crew claim hook relies on: resume fields written onto a queued run before
// claimQueuedRun parses it reach the adapter, even for wakes that normally force a fresh session.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("resume fields set before claim reach the adapter", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let restore: (() => void) | null = null;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-claim-resume-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterEach(() => {
    restore?.();
    restore = null;
    execute.mockReset();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function seed(wakeReason: string) {
    const companyId = randomUUID(), agentId = randomUUID(), issueA = randomUUID(), issueB = randomUUID();
    const runA = randomUUID(), runB = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew resume",
      issuePrefix: `R${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner",
    });
    await db.insert(agents).values({
      id: agentId, companyId, name: "Executor", role: "engineer", status: "idle", adapterType: "process",
      adapterConfig: {}, permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    });
    await db.insert(issues).values([
      { id: issueA, companyId, title: "A", status: "done", assigneeAgentId: agentId, responsibleUserId: "owner" },
      { id: issueB, companyId, title: "B", status: "todo", assigneeAgentId: agentId, responsibleUserId: "owner" },
    ]);
    await db.insert(issueRelations).values({ companyId, issueId: issueA, relatedIssueId: issueB, type: "blocks" });
    await db.insert(heartbeatRuns).values({
      id: runA, companyId, agentId, status: "succeeded", invocationSource: "automation", responsibleUserId: "owner",
      contextSnapshot: { issueId: issueA }, sessionIdBefore: null, sessionIdAfter: "sess-a",
    });
    await db.insert(agentTaskSessions).values({
      companyId, agentId, adapterType: "process", taskKey: issueA,
      sessionParamsJson: { sessionId: "sess-a" }, sessionDisplayId: "sess-a", lastRunId: runA,
    });
    await db.insert(heartbeatRuns).values({
      id: runB, companyId, agentId, status: "queued", invocationSource: "automation", responsibleUserId: "owner",
      contextSnapshot: { issueId: issueB, taskKey: issueB, wakeReason },
    });
    return { companyId, agentId, issueA, issueB, runA, runB };
  }

  async function claimAll() {
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
  }

  function setResumeBeforeClaim(runId: string, sourceRunId: string) {
    restore = overrideCrewCoreHooksForTests({
      beforeClaim: async ({ db: hookDb, run }) => {
        if (run.id !== runId) return false;
        const next = {
          ...(run.contextSnapshot ?? {}),
          resumeFromRunId: sourceRunId,
          resumeSessionDisplayId: "sess-a",
          resumeSessionParams: { sessionId: "sess-a" },
        };
        await hookDb.update(heartbeatRuns).set({ contextSnapshot: next }).where(eq(heartbeatRuns.id, runId));
        run.contextSnapshot = next;
        return false;
      },
    });
  }

  for (const wakeReason of ["issue_blockers_resolved", "issue_assigned"]) {
    it(`wake ${wakeReason}: adapter nhận session của A`, async () => {
      execute.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "ok", sessionId: "sess-a" });
      const s = await seed(wakeReason);
      setResumeBeforeClaim(s.runB, s.runA);
      await claimAll();
      const call = execute.mock.calls.find(([ctx]) => ctx.runId === s.runB);
      expect(call, "run B không được thực thi").toBeDefined();
      expect(call![0].runtime).toMatchObject({ sessionId: "sess-a" });
      const [session] = await db
        .select()
        .from(agentTaskSessions)
        .where(and(eq(agentTaskSessions.agentId, s.agentId), eq(agentTaskSessions.taskKey, s.issueB)));
      expect(session?.sessionDisplayId ?? (session?.sessionParamsJson as { sessionId?: string } | null)?.sessionId).toBe("sess-a");
    }, 30_000);
  }

  it("đối chứng: không đặt gì thì run B mở session mới", async () => {
    execute.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "ok" });
    const s = await seed("issue_blockers_resolved");
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => false });
    await claimAll();
    const call = execute.mock.calls.find(([ctx]) => ctx.runId === s.runB);
    expect(call).toBeDefined();
    expect(call![0].runtime.sessionId ?? null).toBeNull();
  }, 30_000);
});
```

- [ ] **Step 2: Chạy**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-claim-resume-contract.test.ts`
Expected (go): 3 passed. Nếu assertion `agentTaskSessions(taskKey=B)` lệch vì adapter mock không trả session theo dạng stock đọc (`sessionId` trong kết quả `execute`), đọc chỗ stock lưu task session sau run (`upsertTaskSession` trong `heartbeat.ts`) và sửa **giá trị trả về của mock**, không sửa assertion `runtime`.

- [ ] **Step 3: Kết luận vào `spike-session.md`**

Ghi: commit, lệnh, số test đạt, trích `runtime` của run B ở cả hai wake, và một dòng kết luận:
- **go** khi hai ca wake đều có `runtime.sessionId = "sess-a"` và đối chứng `null` → BR-1 dùng H1 (giữ 4/5 hook).
- **no-go** khi `runtime.sessionId` không phải `sess-a` vì stock ghi đè/xóa trường resume giữa claim và adapter (ghi dòng code chịu trách nhiệm) → BR-1 dùng nhánh H5 bên dưới.

- [ ] **Step 4: Commit** `test(crew): khóa hợp đồng resume ghi trước claim tới adapter`

## Task BR-1 — `bundle-resume.ts` và nối vào H1

**Files:**
- Create: `server/src/crew/bundle-resume.ts`
- Create: `server/src/__tests__/crew-bundle-resume.test.ts`
- Modify: `server/src/crew/core-hooks.ts` (`implementations.beforeClaim`, chú thích `BeforeClaimInput`/`beforeClaim`)
- Modify: `crew/release/core-hooks.json` (mục H1: `description`, `tests`)
- Modify: `crew/ops/inspect-image.sh` (danh sách file `crew/*.js`: thêm `bundle-resume`, `model-policy`)

**Interfaces:**
- Produces: `CREW_BUNDLE_RE`, `parseCrewBundle`, `pickBundlePredecessor`, `findBundlePredecessor`, `applyBundleResume`, `applyBundleResumeSafely` (chữ ký ở dưới và mục Interface của [plan.md](plan.md)).
- Consumes: không có gì của gói khác.

- [ ] **Step 1: Test thất bại** `server/src/__tests__/crew-bundle-resume.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
  agentTaskSessions,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueRelations,
  issues,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import {
  applyBundleResume,
  applyBundleResumeSafely,
  parseCrewBundle,
  pickBundlePredecessor,
} from "../crew/bundle-resume.ts";
import { heartbeatService } from "../services/heartbeat.js";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});

describe("parseCrewBundle", () => {
  it("đọc dòng marker ở giữa mô tả", () => {
    expect(parseCrewBundle("Làm A\ncrew-bundle id=greet seq=2\nAC: …")).toEqual({ id: "greet", seq: 2 });
    expect(parseCrewBundle("x\r\ncrew-bundle id=greet-api seq=10\r\n")).toEqual({ id: "greet-api", seq: 10 });
  });
  it("từ chối id hoa, seq 0, chữ thừa và mô tả rỗng", () => {
    expect(parseCrewBundle("crew-bundle id=Greet seq=1")).toBeNull();
    expect(parseCrewBundle("crew-bundle id=greet seq=0")).toBeNull();
    expect(parseCrewBundle("crew-bundle id=greet seq=1 thêm")).toBeNull();
    expect(parseCrewBundle(null)).toBeNull();
  });
});

describe("pickBundlePredecessor", () => {
  const session = (lastRunId: string, at: number) => ({
    lastRunId,
    sessionParamsJson: { sessionId: lastRunId },
    sessionDisplayId: lastRunId,
    updatedAt: new Date(at),
  });
  const c = (issueId: string, description: string, status = "done", s = session(`run-${issueId}`, 1)) => ({
    issueId, status, description, session: s,
  });
  it("chọn tiền nhiệm cùng gói, seq lớn nhất nhỏ hơn seq của mình, đã done và có session", () => {
    const picked = pickBundlePredecessor({ id: "greet", seq: 3 }, [
      c("a", "crew-bundle id=greet seq=1"),
      c("b", "crew-bundle id=greet seq=2"),
      c("x", "crew-bundle id=readme seq=2"),
      c("d", "crew-bundle id=greet seq=4"),
    ]);
    expect(picked?.issueId).toBe("b");
  });
  it("bỏ blocker chưa done, không marker, hoặc không có session của agent", () => {
    expect(pickBundlePredecessor({ id: "greet", seq: 2 }, [c("a", "crew-bundle id=greet seq=1", "in_review")])).toBeNull();
    expect(pickBundlePredecessor({ id: "greet", seq: 2 }, [c("a", "không marker")])).toBeNull();
    expect(pickBundlePredecessor({ id: "greet", seq: 2 }, [{ ...c("a", "crew-bundle id=greet seq=1"), session: null }])).toBeNull();
  });
});

describe("applyBundleResumeSafely", () => {
  it("lỗi DB thì fail open, không ném", async () => {
    const db = { select: () => { throw new Error("db down"); } } as unknown as Db;
    const run = { id: "r", companyId: "c", agentId: "a", status: "queued", contextSnapshot: { issueId: "i" } } as never;
    await expect(applyBundleResumeSafely({ db, run })).resolves.toBe("skipped");
  });
});

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("nối session trong gói qua H1", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-bundle-resume-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterEach(() => execute.mockReset());
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  type SeedOptions = {
    bDescription?: string;
    aDescription?: string;
    aStatus?: string;
    sessionOwner?: "same" | "other";
    bOwnSession?: boolean;
    wakeReason?: string;
  };

  async function seed(o: SeedOptions = {}) {
    const companyId = randomUUID(), agentId = randomUUID(), otherAgentId = randomUUID();
    const issueA = randomUUID(), issueB = randomUUID(), runA = randomUUID(), runB = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew bundle",
      issuePrefix: `B${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner",
    });
    const agent = (id: string, name: string) => ({
      id, companyId, name, role: "engineer", status: "idle", adapterType: "process",
      adapterConfig: {}, permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    });
    await db.insert(agents).values([agent(agentId, "Executor 1"), agent(otherAgentId, "Executor 2")]);
    await db.insert(issues).values([
      {
        id: issueA, companyId, title: "A", status: o.aStatus ?? "done", assigneeAgentId: agentId, responsibleUserId: "owner",
        description: o.aDescription ?? "Việc A\ncrew-bundle id=greet seq=1",
      },
      {
        id: issueB, companyId, title: "B", status: "todo", assigneeAgentId: agentId, responsibleUserId: "owner",
        description: o.bDescription ?? "Việc B\ncrew-bundle id=greet seq=2",
      },
    ]);
    await db.insert(issueRelations).values({ companyId, issueId: issueA, relatedIssueId: issueB, type: "blocks" });
    const sessionAgent = o.sessionOwner === "other" ? otherAgentId : agentId;
    await db.insert(heartbeatRuns).values({
      id: runA, companyId, agentId: sessionAgent, status: "succeeded", invocationSource: "automation",
      responsibleUserId: "owner", contextSnapshot: { issueId: issueA }, sessionIdAfter: "sess-a",
    });
    await db.insert(agentTaskSessions).values({
      companyId, agentId: sessionAgent, adapterType: "process", taskKey: issueA,
      sessionParamsJson: { sessionId: "sess-a" }, sessionDisplayId: "sess-a", lastRunId: runA,
    });
    if (o.bOwnSession) {
      await db.insert(agentTaskSessions).values({
        companyId, agentId, adapterType: "process", taskKey: issueB,
        sessionParamsJson: { sessionId: "sess-b" }, sessionDisplayId: "sess-b", lastRunId: null,
      });
    }
    await db.insert(heartbeatRuns).values({
      id: runB, companyId, agentId, status: "queued", invocationSource: "automation", responsibleUserId: "owner",
      contextSnapshot: { issueId: issueB, taskKey: issueB, wakeReason: o.wakeReason ?? "issue_blockers_resolved" },
    });
    return { companyId, agentId, issueA, issueB, runA, runB };
  }

  async function claimAll() {
    execute.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "ok" });
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
  }
  const runtimeOf = (runId: string) => execute.mock.calls.find(([ctx]) => ctx.runId === runId)?.[0].runtime;
  const resumeActivities = (runId: string) =>
    db.select().from(activityLog).where(and(eq(activityLog.entityId, runId), eq(activityLog.action, "crew.bundle_resume")));

  for (const wakeReason of ["issue_blockers_resolved", "issue_assigned"]) {
    it(`cùng gói, wake ${wakeReason}: run B resume session của A và ghi dấu`, async () => {
      const s = await seed({ wakeReason });
      await claimAll();
      expect(runtimeOf(s.runB)).toMatchObject({ sessionId: "sess-a" });
      const [row] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
      expect(row!.contextSnapshot).toMatchObject({
        resumeFromRunId: s.runA,
        crewBundleResume: { bundle: "greet", fromIssueId: s.issueA },
      });
      expect(await resumeActivities(s.runB)).toHaveLength(1);
    }, 30_000);
  }

  it("khác gói: không nối", async () => {
    const s = await seed({ bDescription: "crew-bundle id=readme seq=1" });
    await claimAll();
    expect(runtimeOf(s.runB)?.sessionId ?? null).toBeNull();
    expect(await resumeActivities(s.runB)).toHaveLength(0);
  }, 30_000);

  it("B không có marker: không nối", async () => {
    const s = await seed({ bDescription: "Việc B" });
    await claimAll();
    expect(runtimeOf(s.runB)?.sessionId ?? null).toBeNull();
  }, 30_000);

  it("session trên A thuộc agent khác: không nối", async () => {
    const s = await seed({ sessionOwner: "other" });
    await claimAll();
    expect(runtimeOf(s.runB)?.sessionId ?? null).toBeNull();
  }, 30_000);

  it("B đã có session riêng: để stock dùng session của B", async () => {
    const s = await seed({ bOwnSession: true });
    expect(await applyBundleResume({ db, run: (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB)))[0]! })).toBe("skipped");
  }, 30_000);

  it("A chưa done: không nối (claim sau đó tự hủy vì còn blocker)", async () => {
    const s = await seed({ aStatus: "in_review" });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
  }, 30_000);

  it("run đã có resumeFromRunId (wake tay): giữ nguyên", async () => {
    const s = await seed();
    await db
      .update(heartbeatRuns)
      .set({ contextSnapshot: { issueId: s.issueB, resumeFromRunId: "manual" } })
      .where(eq(heartbeatRuns.id, s.runB));
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
  }, 30_000);

  it("run không còn queued: không ghi", async () => {
    const s = await seed();
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, s.runB));
    expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
    const [after] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(after!.contextSnapshot).not.toHaveProperty("resumeFromRunId");
  }, 30_000);
});
```

- [ ] **Step 2: Chạy, kỳ vọng FAIL**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-bundle-resume.test.ts`
Expected: FAIL `Failed to load url ../crew/bundle-resume.ts`.

- [ ] **Step 3: Viết `server/src/crew/bundle-resume.ts`**

```ts
import { and, eq, inArray, sql } from "drizzle-orm";
import { agentTaskSessions, agents, type Db, heartbeatRuns, issueRelations, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logActivity } from "../services/activity-log.js";

/** Dòng marker gói trong mô tả issue con, do Trợ Lý ghi. */
export const CREW_BUNDLE_RE = /^crew-bundle id=([a-z0-9][a-z0-9-]{0,39}) seq=([1-9][0-9]{0,2})$/m;

export interface CrewBundle {
  id: string;
  seq: number;
}

export function parseCrewBundle(description: string | null | undefined): CrewBundle | null {
  if (!description) return null;
  const match = CREW_BUNDLE_RE.exec(description.replace(/\r\n/g, "\n"));
  return match ? { id: match[1]!, seq: Number(match[2]) } : null;
}

export interface BundleSession {
  lastRunId: string | null;
  sessionParamsJson: Record<string, unknown> | null;
  sessionDisplayId: string | null;
  updatedAt: Date;
}

export interface BundlePredecessorCandidate {
  issueId: string;
  status: string;
  description: string | null;
  /** Task session của chính agent của run trên issue này (null nếu agent chưa làm issue đó). */
  session: BundleSession | null;
}

export type BundlePredecessor = BundlePredecessorCandidate & { seq: number; session: BundleSession & { lastRunId: string } };

/** Tiền nhiệm: blocker trực tiếp cùng gói, seq nhỏ hơn, đã `done`, agent có session trên đó; seq lớn nhất thắng. */
export function pickBundlePredecessor(
  own: CrewBundle,
  candidates: readonly BundlePredecessorCandidate[],
): BundlePredecessor | null {
  const eligible: BundlePredecessor[] = [];
  for (const candidate of candidates) {
    const bundle = parseCrewBundle(candidate.description);
    const session = candidate.session;
    if (!bundle || bundle.id !== own.id || bundle.seq >= own.seq) continue;
    if (candidate.status !== "done" || !session?.lastRunId || !session.sessionParamsJson) continue;
    eligible.push({ ...candidate, seq: bundle.seq, session: { ...session, lastRunId: session.lastRunId } });
  }
  eligible.sort((a, b) => b.seq - a.seq || b.session.updatedAt.getTime() - a.session.updatedAt.getTime());
  return eligible[0] ?? null;
}

export interface BundleResumeTarget {
  bundle: CrewBundle;
  predecessor: BundlePredecessor;
}

/**
 * Tìm session để issue `issueId` của agent nối tiếp. Null khi issue không giao cho agent, không có marker gói,
 * agent đã có session riêng trên issue này, hoặc không có tiền nhiệm hợp lệ.
 */
export async function findBundlePredecessor(
  db: Db,
  input: { companyId: string; agentId: string; issueId: string },
): Promise<BundleResumeTarget | null> {
  const [issue] = await db
    .select({ assigneeAgentId: issues.assigneeAgentId, description: issues.description })
    .from(issues)
    .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)));
  if (!issue || issue.assigneeAgentId !== input.agentId) return null;
  const bundle = parseCrewBundle(issue.description);
  if (!bundle) return null;
  const [agent] = await db.select({ adapterType: agents.adapterType }).from(agents).where(eq(agents.id, input.agentId));
  if (!agent) return null;
  const sessionScope = and(
    eq(agentTaskSessions.companyId, input.companyId),
    eq(agentTaskSessions.agentId, input.agentId),
    eq(agentTaskSessions.adapterType, agent.adapterType),
  );
  const own = await db
    .select({ id: agentTaskSessions.id })
    .from(agentTaskSessions)
    .where(and(sessionScope, eq(agentTaskSessions.taskKey, input.issueId)))
    .limit(1);
  if (own.length > 0) return null;
  const blockers = await db
    .select({ issueId: issues.id, status: issues.status, description: issues.description })
    .from(issueRelations)
    .innerJoin(issues, eq(issueRelations.issueId, issues.id))
    .where(
      and(
        eq(issueRelations.companyId, input.companyId),
        eq(issueRelations.type, "blocks"),
        eq(issueRelations.relatedIssueId, input.issueId),
      ),
    );
  if (blockers.length === 0) return null;
  const sessions = await db
    .select({
      taskKey: agentTaskSessions.taskKey,
      lastRunId: agentTaskSessions.lastRunId,
      sessionParamsJson: agentTaskSessions.sessionParamsJson,
      sessionDisplayId: agentTaskSessions.sessionDisplayId,
      updatedAt: agentTaskSessions.updatedAt,
    })
    .from(agentTaskSessions)
    .where(and(sessionScope, inArray(agentTaskSessions.taskKey, blockers.map((b) => b.issueId))));
  const byKey = new Map(sessions.map((s) => [s.taskKey, s]));
  const predecessor = pickBundlePredecessor(
    bundle,
    blockers.map((b) => ({ ...b, session: byKey.get(b.issueId) ?? null })),
  );
  return predecessor ? { bundle, predecessor } : null;
}

/**
 * Chạy trong H1 sau khi cổng tải cho claim. Ghi tham số resume giống `payload.resumeFromRunId` của stock vào
 * `contextSnapshot` của run (DB, có điều kiện còn `queued`, và object `run` mà `claimQueuedRun` đọc tiếp).
 * `executeRun` ưu tiên tham số tường minh này hơn việc reset session của wake `issue_assigned`.
 */
export async function applyBundleResume(input: {
  db: Db;
  run: typeof heartbeatRuns.$inferSelect;
}): Promise<"applied" | "skipped"> {
  const { db, run } = input;
  if (run.status !== "queued") return "skipped";
  const context = (run.contextSnapshot ?? {}) as Record<string, unknown>;
  const issueId = typeof context.issueId === "string" && context.issueId ? context.issueId : null;
  if (!issueId || context.resumeFromRunId != null || context.resumeSessionParams != null) return "skipped";
  const target = await findBundlePredecessor(db, { companyId: run.companyId, agentId: run.agentId, issueId });
  if (!target) return "skipped";
  const { bundle, predecessor } = target;
  const patch = {
    resumeFromRunId: predecessor.session.lastRunId,
    resumeSessionDisplayId: predecessor.session.sessionDisplayId,
    resumeSessionParams: predecessor.session.sessionParamsJson,
    crewBundleResume: { bundle: bundle.id, fromIssueId: predecessor.issueId },
  };
  const [updated] = await db
    .update(heartbeatRuns)
    .set({
      contextSnapshot: sql`coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "queued")))
    .returning({ contextSnapshot: heartbeatRuns.contextSnapshot });
  if (!updated) return "skipped";
  run.contextSnapshot = updated.contextSnapshot;
  await logActivity(db, {
    companyId: run.companyId,
    actorType: "system",
    actorId: "crew",
    action: "crew.bundle_resume",
    entityType: "heartbeat_run",
    entityId: run.id,
    agentId: run.agentId,
    runId: run.id,
    issueId,
    details: { bundle: bundle.id, fromIssueId: predecessor.issueId, toIssueId: issueId, resumeFromRunId: predecessor.session.lastRunId },
  });
  return "applied";
}

/** Lỗi bất kỳ: run chạy session mới như stock (không giữ run, không ném). */
export async function applyBundleResumeSafely(input: {
  db: Db;
  run: typeof heartbeatRuns.$inferSelect;
}): Promise<"applied" | "skipped"> {
  try {
    return await applyBundleResume(input);
  } catch (err) {
    logger.warn({ err, runId: input.run.id }, "crew-bundle-resume: failed open, run starts a fresh session");
    return "skipped";
  }
}
```

`logActivity` nhận `issueId` cho entity `heartbeat_run` như `load-gate.ts` (`recordNotice`).

- [ ] **Step 4: Nối vào H1** — `server/src/crew/core-hooks.ts`

Thêm import `import { applyBundleResumeSafely } from "./bundle-resume.js";` và đổi:

```ts
const implementations: CrewCoreHooks = {
  beforeClaim: async (input) => {
    if (await crewBeforeClaim(input)) return true;
    await applyBundleResumeSafely(input);
    return false;
  },
```

Sửa chú thích của `beforeClaim` trong `CrewCoreHooks`: "Trả `true` để giữ run ở `queued` … Khi trả `false`, bản Crew có thể ghi tham số resume của gói (`resumeFromRunId`, `resumeSessionParams`, `resumeSessionDisplayId`) vào `run.contextSnapshot` (cả DB lẫn object `run`) trước khi claim."

- [ ] **Step 5: Registry** — `crew/release/core-hooks.json` mục H1: `description` = `"Keep a queued run queued while its environment is overloaded or unreachable; when claimed, resume the previous issue's session within a Crew bundle."`, `tests` thêm `"server/src/__tests__/crew-bundle-resume.test.ts"` và `"server/src/__tests__/crew-claim-resume-contract.test.ts"`. `anchor` giữ nguyên.

- [ ] **Step 6: `crew/ops/inspect-image.sh`** — danh sách `for f in core-hooks … handoff-rewake` thêm `bundle-resume model-policy`.

- [ ] **Step 7: Chạy, kỳ vọng PASS**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-bundle-resume.test.ts src/__tests__/crew-claim-resume-contract.test.ts src/__tests__/crew-core-hooks.test.ts src/__tests__/crew-before-claim.test.ts && node crew/release/check-core-hooks.mjs && corepack pnpm --filter @paperclipai/server typecheck`
Expected: mọi test PASS; checker in 4 hook, không lỗi; typecheck rc 0.

- [ ] **Step 8: Commit** `feat(crew): nối session của issue trước trong cùng gói khi claim`

## Nhánh no-go của SP-1 (H5 `beforeWakeup`, owner đã duyệt)

Chỉ làm khi `spike-session.md` kết luận no-go. Thay Step 3–5 của BR-1 bằng:

- `server/src/crew/core-hooks.ts`: thêm `export interface BeforeWakeupInput { db: Db; agentId: string; opts: WakeupOptionsLike }` với `WakeupOptionsLike = { payload?: Record<string, unknown> | null; contextSnapshot?: Record<string, unknown> | null }`, method `beforeWakeup<T extends WakeupOptionsLike>(input: { db: Db; agentId: string; opts: T }): Promise<T>` trong `CrewCoreHooks`, `implementations.beforeWakeup = crewBeforeWakeup`, wrapper bắt lỗi trả nguyên `opts`.
- `server/src/crew/bundle-resume.ts`: `crewBeforeWakeup` — `issueId = opts.payload?.issueId ?? opts.contextSnapshot?.issueId`; bỏ qua khi thiếu `issueId` hoặc đã có `payload.resumeFromRunId`; đọc `agents.companyId` của `agentId`; `findBundlePredecessor(...)`; có kết quả thì trả `{ ...opts, payload: { ...(opts.payload ?? {}), resumeFromRunId: predecessor.session.lastRunId } }` và ghi activity `crew.bundle_resume` (`entityType: "issue"`, `entityId: issueId`). Stock tự dựng `resumeSessionParams` (l.26331).
- `server/src/services/heartbeat.ts`: **một dòng** đầu `enqueueWakeup` (l.26076): `    opts = await crewCoreHooks.beforeWakeup({ db, agentId, opts });`.
- `crew/release/core-hooks.json`: mục `H5` (`kind: "hook"`, `file: "server/src/services/heartbeat.ts"`, `symbol: "heartbeatService.enqueueWakeup"`, `head: "async function enqueueWakeup(agentId: string, opts: WakeupOptions = {}, executionWaitRequestId?: string) {"`, `anchor` = dòng trên, `importLine` như H1, `tests: ["server/src/__tests__/crew-bundle-resume.test.ts"]`). `inspect-image.sh`: không đổi đếm `heartbeat` (chỉ in số).
- Test: thay `claimAll` trong ca DB bằng `heartbeatService(db).wakeup(agentId, { source: "automation", reason: "issue_blockers_resolved", payload: { issueId: issueB } })` rồi `resumeQueuedRuns`/`drainActiveRunExecutions`; giữ nguyên assertion `runtime.sessionId`, activity; đổi assertion `contextSnapshot.resumeFromRunId` giữ nguyên. Bỏ hai ca `applyBundleResume` trực tiếp, thêm ca `crewBeforeWakeup` với `payload.resumeFromRunId` sẵn thì trả nguyên.

## Rủi ro

| Rủi ro | Khả năng × ảnh hưởng | Giảm thiểu |
|---|---|---|
| Upstream đổi chỗ `executeRun` đọc `context.resumeSessionParams` hoặc thứ tự parse sau H1 | Thấp × Cao | Test hợp đồng SP-1 nằm trong `crew-` suite của `verify.sh`, đỏ ngay khi nâng |
| Session A quá dài, stock xoay session (`evaluateSessionCompaction`) | Trung bình × Thấp | Đúng hành vi; gói ≤ ~7 file nặng (ruling); AC-3 ghi nếu gặp |
| Hai claim song song cùng run | Thấp × Thấp | `UPDATE … WHERE status='queued'` + bỏ qua khi đã có `resumeFromRunId` |
| Cùng gói nhưng khác model (override) | Thấp × Trung bình | Trợ Lý giữ một model mỗi gói (RA-1); Claude Code `--resume` vẫn chạy với `--model` khác |

**Rollback:** revert commit BR-1 (H1 trở lại chỉ cổng tải; run B mở session mới như stock); test hợp đồng có thể giữ. Không có dữ liệu cần dọn (chỉ thêm khóa trong `contextSnapshot` của run cũ).
