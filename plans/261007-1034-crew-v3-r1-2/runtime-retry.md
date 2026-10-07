# Gói `runtime-retry` — fallback H3, mốc chờ bền, retry không làm lại (RR-1, RR-2)

Fork Paperclip, worktree `.worktrees/paperclip-r12-retry` nhánh `crew/r12-retry` từ `v3` (`e1c3dd2db`). Model opus. Một worker làm RR-1 rồi RR-2. Chuẩn bị như [policy.md](policy.md) (install, ensure-build-deps, build runner). Gói này **không** sửa `core-hooks.ts`/`core-hooks.json` (H1 đã trỏ `crewBeforeClaim`; ngân sách hook không đổi).

## Bối cảnh đã xác minh

- `server/src/crew/remote-stop.ts`: `CREW_REMOTE_STOP_SCRIPT` dòng `if [ "$rc" -ne 126 ] && [ "$rc" -ne 127 ]; then exit "$rc"; fi` — launcher `crew-mac stop-run` thoát 2 (root ngoài `worktreeRoot` hoặc chưa có manifest) bị trả thẳng, H3 ghi `failed`. `readRemoteCwd(metadata)` (chưa export) đọc `metadata.remoteCwd` của lease. `classifyStopError` phân biệt `failed`/`unreachable`.
- `server/src/crew/load-gate.ts`: `evaluateBeforeClaim` lấy `waitingSince` từ `firstNoticeAt(run.id, "waiting")` (activity `crew.load_gate.waiting`). `defaultBeforeClaimDeps.postNotice` comment **trước**, activity **sau** (ruling C4 của R1-1), nên comment lỗi bền → không có activity → `waitingSince = now` mỗi tick → không bao giờ hết hạn.
- `packages/db/src/schema/heartbeat_runs.ts`: `startedAt`, `retryOfRunId` (cột). `environment_leases.ts`: `heartbeatRunId`, `environmentId`, `metadata`, `createdAt`.
- Thư mục `.paperclip-runtime/runs/<runId>/` trên Mac bị xóa khi dừng run, nên mốc thời gian lấy từ DB (`startedAt` của run trước), không từ file `started`.
- `claimQueuedRun` chạy dưới khóa start của agent: hook không được `await` việc hủy (đã có `scheduleCancel` bằng `setImmediate`). SSH trong hook có timeout (probe dùng `LOAD_GATE_PROBE_TIMEOUT_MS = 5_000`).

## Task RR-1: H3 fallback khi stop-run thoát 2, mốc chờ bền của cổng tải

**Files:**
- Modify: `server/src/crew/remote-stop.ts` (dòng chọn fallback trong `CREW_REMOTE_STOP_SCRIPT`, comment đầu script, `export function readRemoteCwd`)
- Modify: `server/src/__tests__/crew-remote-stop.test.ts`
- Modify: `server/src/crew/load-gate.ts` (`BeforeClaimDeps`, `evaluateBeforeClaim`, `defaultBeforeClaimDeps`)
- Modify: `server/src/__tests__/crew-load-gate.test.ts`
- Modify: `server/src/__tests__/crew-before-claim.test.ts` (test "cancels an expired run…" dùng tên dep mới)

**Interfaces:**
- Produces: `readRemoteCwd(metadata): string` (export, RR-2 dùng). `BeforeClaimDeps` mới:
  - `firstNoticeAt(runId: string, kind: NoticeKind): Promise<Date | null>` với `type NoticeKind = "waiting" | "expired" | "waiting_comment" | "expired_comment"` (action `crew.load_gate.<kind>`).
  - `recordNotice(notice: { run; issueId: string | null; kind: "waiting" | "expired"; details: Record<string, unknown> }): Promise<void>` — chỉ ghi activity mốc.
  - `postComment(notice: { run; issueId: string; kind: "waiting" | "expired"; body: string }): Promise<void>` — comment rồi activity `crew.load_gate.<kind>_comment`.
  - Bỏ `postNotice`.

- [ ] **Step 1: Test thất bại cho fallback exit 2** — trong `crew-remote-stop.test.ts`, đổi test `"falls back to the built-in script when the launcher cannot run (exit 126 or 127)"` thành:

```ts
  it("falls back to the built-in script when the launcher refuses the root or cannot run (exit 2, 126, 127)", () => {
    for (const code of [2, 126, 127]) {
      const { home, argsFile } = homeWithLauncher("", code);
      expect(runScript(RUN_A, newRoot(), home)).toMatch(/^crew-stop matched=0 killed=0 remaining=0 via=fallback$/m);
      expect(existsSync(argsFile)).toBe(true);
    }
  });
```

Giữ nguyên test `"passes the launcher's failure exit code through"` (exit 1 vẫn trả thẳng).

- [ ] **Step 2: Chạy, kỳ vọng FAIL ở code 2** (macOS; trên Linux suite bị skip, ghi rõ)

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-remote-stop.test.ts`
Expected: FAIL `falls back … (exit 2, 126, 127)`.

- [ ] **Step 3: Sửa script** — trong `CREW_REMOTE_STOP_SCRIPT`:

```ts
  '  # 2: crew-mac refused the input (root outside its worktree root, or not set up yet) - the fallback',
  '  # still finds the run by its pgid file and PAPERCLIP_RUN_ID. 126/127: the launcher could not run.',
  '  if [ "$rc" -ne 2 ] && [ "$rc" -ne 126 ] && [ "$rc" -ne 127 ]; then exit "$rc"; fi',
```

thay cho hai dòng comment + điều kiện cũ. Sửa comment khối đầu file: "A launcher that refuses the input (exit 2) or cannot run (exit 126/127) also falls through to the fallback in the same SSH command." Đổi `function readRemoteCwd` thành `export function readRemoteCwd`.

- [ ] **Step 4: Chạy, kỳ vọng PASS**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-remote-stop.test.ts`
Expected: PASS.

- [ ] **Step 5: Test thất bại cho mốc chờ bền** — trong `crew-load-gate.test.ts`, thay `harness` bằng bản theo dep mới và thêm hai test:

```ts
type Notices = Partial<Record<"waiting" | "expired" | "waiting_comment" | "expired_comment", Date>>;

function harness(probe: HostProbe, now: Date, notices: Notices = {}, failComment = false) {
  const events: string[] = [];
  const deps: BeforeClaimDeps = {
    loadTarget: async () => ({ environmentId: "env-1", environmentName: "mac-mini", settings: SETTINGS }),
    probeHost: async () => probe,
    firstNoticeAt: async (_runId, kind) => notices[kind] ?? null,
    recordNotice: async (n) => {
      events.push(`mark:${n.kind}`);
      notices[n.kind] = now;
    },
    postComment: async (n) => {
      if (failComment) throw new Error("comment store down");
      events.push(`${n.kind}:${n.issueId}:${n.body}`);
      notices[`${n.kind}_comment`] = now;
    },
    scheduleCancel: (runId, reason) => {
      events.push(`cancel:${runId}:${reason}`);
    },
    blockIssue: async (issueId) => {
      events.push(`blocked:${issueId}`);
    },
    now: () => now,
  };
  const input: BeforeClaimInput = { db: {} as Db, run: run() };
  return { deps, input, events, notices };
}

  it("ghi mốc chờ trước comment: comment lỗi mãi thì run vẫn hết hạn đúng giờ", async () => {
    const notices: Notices = {};
    const first = harness({ ok: false, error: "timeout" }, T0, notices, true);
    expect(await evaluateBeforeClaim(first.input, first.deps)).toBe(true);
    expect(first.events).toEqual(["mark:waiting"]);
    const later = harness({ ok: false, error: "timeout" }, new Date(T0.getTime() + 61 * 60_000), notices, true);
    expect(await evaluateBeforeClaim(later.input, later.deps)).toBe(true);
    expect(later.events.some((e) => e.startsWith("cancel:run-1:"))).toBe(true);
    expect(later.events).toContain("blocked:issue-1");
  });

  it("comment chờ bị lỗi thì được thử lại ở tick sau, mốc không đổi", async () => {
    const notices: Notices = { waiting: T0 };
    const h = harness({ ok: false, error: "timeout" }, new Date(T0.getTime() + 60_000), notices);
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatch(/^waiting:issue-1:/);
    expect(notices.waiting).toEqual(T0);
  });
```

Sửa các test cũ cho dep mới: "posts one waiting notice" kỳ vọng `["mark:waiting", "waiting:issue-1:<body>"]`; "does not repeat the waiting notice" truyền `{ waiting: T0, waiting_comment: T0 }` và kỳ vọng `[]`; "keeps the run queued when writing the waiting notice fails" dùng `failComment = true`; "after maxWaitMinutes…" kỳ vọng thứ tự `cancel`, `mark:expired`, `blocked`, `expired:…`; "only retries the cancel once the expiry was already handled" truyền `{ expired: T0, expired_comment: T0 }`.

- [ ] **Step 6: Chạy, kỳ vọng FAIL** (dep chưa có)

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts`
Expected: FAIL.

- [ ] **Step 7: Sửa `load-gate.ts`**

`BeforeClaimDeps`: thay `firstNoticeAt` và `postNotice` bằng

```ts
  /** Time of the first activity of this kind for the run (persisted, survives restarts), or null. */
  firstNoticeAt(runId: string, kind: NoticeKind): Promise<Date | null>;
  /** Persists the durable marker `crew.load_gate.<kind>`; the wait deadline is counted from the first one. */
  recordNotice(notice: {
    run: BeforeClaimInput["run"];
    issueId: string | null;
    kind: "waiting" | "expired";
    details: Record<string, unknown>;
  }): Promise<void>;
  /** Comments on the issue, then persists `crew.load_gate.<kind>_comment`. A failure is retried next tick. */
  postComment(notice: {
    run: BeforeClaimInput["run"];
    issueId: string;
    kind: "waiting" | "expired";
    body: string;
  }): Promise<void>;
```

với `export type NoticeKind = "waiting" | "expired" | "waiting_comment" | "expired_comment";`.

`evaluateBeforeClaim`, nhánh đã hết hạn và nhánh chờ/hết hạn:

```ts
  if (await deps.firstNoticeAt(run.id, "expired")) {
    deps.scheduleCancel(run.id, expiredReason);
    const issueId = readIssueId(run.contextSnapshot);
    if (issueId && !(await deps.firstNoticeAt(run.id, "expired_comment"))) {
      await logFailure(run.id, "expired comment", () =>
        deps.postComment({ run, issueId, kind: "expired", body: expiredBody(run.id, target) }),
      );
    }
    return true;
  }
  // … probe, decideGate như cũ …
  if (decision.action === "wait") {
    if (!waitingSince) {
      await logFailure(run.id, "waiting marker", () =>
        deps.recordNotice({ run, issueId, kind: "waiting", details: { ...details, deadline: decision.deadline.toISOString() } }),
      );
    }
    if (issueId && !(await deps.firstNoticeAt(run.id, "waiting_comment"))) {
      await logFailure(run.id, "waiting comment", () =>
        deps.postComment({ run, issueId, kind: "waiting", body: waitingBody(run.id, target, decision) }),
      );
    }
    return true;
  }

  deps.scheduleCancel(run.id, `${expiredReason} (${decision.detail})`);
  await logFailure(run.id, "expired marker", () => deps.recordNotice({ run, issueId, kind: "expired", details }));
  if (issueId) await logFailure(run.id, "block issue", () => deps.blockIssue(issueId));
  if (issueId) {
    await logFailure(run.id, "expired comment", () =>
      deps.postComment({ run, issueId, kind: "expired", body: expiredBody(run.id, target, decision.detail) }),
    );
  }
  return true;
```

`waitingBody`/`expiredBody` là hai hàm thuần trong cùng file, trả nguyên văn chuỗi comment hiện có (không đổi nội dung tiếng Việt; `expiredBody` nhận `detail` tùy chọn và bỏ phần ngoặc khi không có).

`defaultBeforeClaimDeps`: `firstNoticeAt` giữ query theo `crew.load_gate.${kind}`; `recordNotice` = `logActivity(db, { …, action: \`crew.load_gate.${notice.kind}\`, details: notice.details })`; `postComment` = `issueService(db).addComment(notice.issueId, notice.body, {}, { authorType: "system" })` rồi `logActivity(db, { …, action: \`crew.load_gate.${notice.kind}_comment\` })`.

`crew-before-claim.test.ts` test "cancels an expired run…": `firstNoticeAt` trả mốc cho `"waiting"` và `null` cho kind khác (không đổi logic).

- [ ] **Step 8: Chạy, kỳ vọng PASS**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-remote-stop.test.ts`
Run: `corepack pnpm --filter @paperclipai/server exec tsc --noEmit`
Expected: PASS, 0 lỗi.

- [ ] **Step 9: Commit**

```bash
git add server/src/crew/remote-stop.ts server/src/crew/load-gate.ts \
  server/src/__tests__/crew-remote-stop.test.ts server/src/__tests__/crew-load-gate.test.ts server/src/__tests__/crew-before-claim.test.ts
git commit -m "fix(crew): fall back when crew-mac refuses a stop and keep the wait deadline durable"
```

## Task RR-2: retry sau mất kết nối kiểm commit trước khi chạy lại

**Files:**
- Create: `server/src/crew/retry-progress.ts`
- Modify: `server/src/crew/load-gate.ts` (`BeforeClaimDeps` thêm 3 dep, `evaluateBeforeClaim` nhánh `claim`, `defaultBeforeClaimDeps`)
- Create: `server/src/__tests__/crew-retry-progress.test.ts`
- Modify: `server/src/__tests__/crew-load-gate.test.ts`

**Interfaces:**
- Consumes: `readRemoteCwd` (RR-1), `runSshCommand` (`@paperclipai/adapter-utils/ssh`), `resolveEnvironmentDriverConfigForRuntime`, `environmentService`, `heartbeatRuns`, `environmentLeases`.
- Produces:
  - `RETRY_PROGRESS_TIMEOUT_MS = 5_000`, `RETRY_SINCE_SLACK_MS = 30_000`
  - `interface RetryCommit { sha: string; committedAt: string; subject: string }`
  - `type RetryProgress = { kind: "none" } | { kind: "checked"; previousRunId: string; previousStartedAt: Date; cwd: string; commits: RetryCommit[] } | { kind: "error"; error: string }`
  - `buildRetryProgressCommand(cwd: string, since: Date): string`, `parseRetryCommits(stdout: string): RetryCommit[]`, `retryProgressComment(p: Extract<RetryProgress, { kind: "checked" }>): string`
  - `createRetryProgressChecker(db: Db, ssh?: { run(config, command, options): Promise<{ stdout: string }> }): (run) => Promise<RetryProgress>`
  - `BeforeClaimDeps.retryChecked(runId): Promise<boolean>` (activity `crew.retry_progress.checked`), `checkRetryProgress(run): Promise<RetryProgress>`, `recordRetryProgress(run, issueId: string | null, progress): Promise<void>` (comment nếu có commit, rồi activity; ném lỗi nếu comment lỗi).
  - Comment bắt đầu bằng `Crew: lần chạy lại` (executor đọc, xem [roles.md](roles.md)).

Luật (ruling trong ledger): chỉ áp cho run có `retryOfRunId` và environment có `crewLoadGate`; kiểm một lần mỗi run (activity đánh dấu); có commit thì comment "kiểm tra và tiếp tục, không làm lại" rồi cho chạy; không có commit thì chỉ ghi activity; lỗi kiểm (SSH, `git` thoát khác 0, ghi comment lỗi) thì xử lý như máy không vào được: giữ `queued`, ghi mốc chờ, hết `maxWaitMinutes` thì hủy và `blocked`.

- [ ] **Step 1: Test unit thất bại** `server/src/__tests__/crew-retry-progress.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildRetryProgressCommand, parseRetryCommits, retryProgressComment } from "../crew/retry-progress.ts";

describe("buildRetryProgressCommand", () => {
  it("quote đường dẫn và dùng mốc ISO", () => {
    expect(buildRetryProgressCommand("/Users/a/crew-agents/mac claude", new Date("2026-10-07T09:20:13.000Z"))).toBe(
      "git -C '/Users/a/crew-agents/mac claude' log --since='2026-10-07T09:20:13.000Z' --format='%H%x09%cI%x09%s' -n 20 HEAD",
    );
    expect(buildRetryProgressCommand("/tmp/it's", new Date(0))).toContain("'/tmp/it'\\''s'");
  });
  it("từ chối đường dẫn tương đối", () => {
    expect(() => buildRetryProgressCommand("crew-agents/x", new Date(0))).toThrow();
  });
});

describe("parseRetryCommits", () => {
  it("đọc sha, giờ commit và tiêu đề, bỏ dòng hỏng", () => {
    const sha = "c".repeat(40);
    expect(parseRetryCommits(`${sha}\t2026-10-07T16:20:43+07:00\tfeat: thêm long.txt\nrác\n`)).toEqual([
      { sha, committedAt: "2026-10-07T16:20:43+07:00", subject: "feat: thêm long.txt" },
    ]);
    expect(parseRetryCommits("")).toEqual([]);
  });
});

describe("retryProgressComment", () => {
  it("liệt kê commit và dặn không làm lại", () => {
    const body = retryProgressComment({
      kind: "checked",
      previousRunId: "11111111-1111-4111-8111-111111111111",
      previousStartedAt: new Date("2026-10-07T09:15:00.000Z"),
      cwd: "/Users/a/crew-agents/mac-claude",
      commits: [{ sha: "c".repeat(40), committedAt: "2026-10-07T16:20:43+07:00", subject: "feat: thêm long.txt" }],
    });
    expect(body.startsWith("Crew: lần chạy lại")).toBe(true);
    expect(body).toContain("cccccccc feat: thêm long.txt");
    expect(body).toContain("16:15");
    expect(body).toContain("không làm lại");
  });
});
```

- [ ] **Step 2: Chạy, kỳ vọng FAIL**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-retry-progress.test.ts`
Expected: FAIL, không load được `../crew/retry-progress.ts`.

- [ ] **Step 3: Viết `server/src/crew/retry-progress.ts`**

```ts
import { desc, eq } from "drizzle-orm";
import { type Db, environmentLeases, heartbeatRuns } from "@paperclipai/db";
import { runSshCommand } from "@paperclipai/adapter-utils/ssh";
import { resolveEnvironmentDriverConfigForRuntime } from "../services/environment-config.js";
import { environmentService } from "../services/environments.js";
import { readRemoteCwd } from "./remote-stop.js";

export const RETRY_PROGRESS_TIMEOUT_MS = 5_000;
/** Mac và VPS có thể lệch đồng hồ vài giây; lấy rộng ra 30 giây trước lúc run trước bắt đầu. */
export const RETRY_SINCE_SLACK_MS = 30_000;

export interface RetryCommit {
  sha: string;
  committedAt: string;
  subject: string;
}

export type RetryProgress =
  | { kind: "none" }
  | { kind: "checked"; previousRunId: string; previousStartedAt: Date; cwd: string; commits: RetryCommit[] }
  | { kind: "error"; error: string };

type Run = typeof heartbeatRuns.$inferSelect;

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildRetryProgressCommand(cwd: string, since: Date): string {
  if (!cwd.startsWith("/")) throw new Error(`crew retry progress: cwd must be absolute: ${cwd}`);
  return `git -C ${quote(cwd)} log --since=${quote(since.toISOString())} --format='%H%x09%cI%x09%s' -n 20 HEAD`;
}

export function parseRetryCommits(stdout: string): RetryCommit[] {
  const commits: RetryCommit[] = [];
  for (const line of stdout.split("\n")) {
    const [sha, committedAt, ...subject] = line.split("\t");
    if (!sha || !/^[0-9a-f]{40}$/.test(sha) || !committedAt) continue;
    commits.push({ sha, committedAt, subject: subject.join("\t").trim() });
  }
  return commits;
}

const TIME = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
});

export function retryProgressComment(p: Extract<RetryProgress, { kind: "checked" }>): string {
  const list = p.commits.map((c) => `- ${c.sha.slice(0, 8)} ${c.subject}`).join("\n");
  return (
    `Crew: lần chạy lại sau khi run \`${p.previousRunId}\` (bắt đầu ${TIME.format(p.previousStartedAt)}) mất kết nối. ` +
    `Run đó đã có ${p.commits.length} commit trong \`${p.cwd}\`:\n${list}\n\n` +
    "Kiểm tra các commit trên rồi tiếp tục phần còn thiếu; không làm lại phần đã commit."
  );
}

type SshRunner = (config: unknown, command: string, options: { timeoutMs: number }) => Promise<{ stdout: string }>;

export function createRetryProgressChecker(
  db: Db,
  runSsh: SshRunner = runSshCommand as unknown as SshRunner,
): (run: Run) => Promise<RetryProgress> {
  return async (run) => {
    const previousRunId = run.retryOfRunId;
    if (!previousRunId) return { kind: "none" };
    try {
      const [previous] = await db
        .select({ startedAt: heartbeatRuns.startedAt })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, previousRunId))
        .limit(1);
      if (!previous?.startedAt) return { kind: "none" };
      const [lease] = await db
        .select({ environmentId: environmentLeases.environmentId, metadata: environmentLeases.metadata })
        .from(environmentLeases)
        .where(eq(environmentLeases.heartbeatRunId, previousRunId))
        .orderBy(desc(environmentLeases.createdAt))
        .limit(1);
      const cwd = readRemoteCwd(lease?.metadata ?? null);
      if (!lease?.environmentId || !cwd) return { kind: "none" };
      const environment = await environmentService(db).getById(lease.environmentId);
      if (!environment) return { kind: "none" };
      const parsed = await resolveEnvironmentDriverConfigForRuntime(db, run.companyId, environment, {
        heartbeatRunId: run.id,
      });
      if (parsed.driver !== "ssh") return { kind: "none" };
      const since = new Date(previous.startedAt.getTime() - RETRY_SINCE_SLACK_MS);
      const result = await runSsh(parsed.config, buildRetryProgressCommand(cwd, since), {
        timeoutMs: RETRY_PROGRESS_TIMEOUT_MS,
      });
      return {
        kind: "checked",
        previousRunId,
        previousStartedAt: previous.startedAt,
        cwd,
        commits: parseRetryCommits(result.stdout),
      };
    } catch (err) {
      const e = err as { stderr?: unknown; message?: unknown };
      const message = typeof e.stderr === "string" && e.stderr.trim() ? e.stderr.trim() : String(e.message ?? err);
      return { kind: "error", error: message.slice(0, 200) };
    }
  };
}
```

- [ ] **Step 4: Chạy, kỳ vọng PASS**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-retry-progress.test.ts`
Expected: PASS (5 test).

- [ ] **Step 5: Test thất bại cho cổng** — trong `crew-load-gate.test.ts`, thêm vào object `deps` của `harness` (RR-1 Step 5) ba dòng mặc định `retryChecked: async () => true,`, `checkRetryProgress: async () => ({ kind: "none" }),`, `recordRetryProgress: async () => {},` (import `type RetryProgress` từ `../crew/retry-progress.ts`), rồi thêm:

```ts
function retryHarness(progress: RetryProgress, opts: { checked?: boolean; failRecord?: boolean } = {}) {
  const h = harness({ ok: true, load1: 1 }, T0);
  const recorded: RetryProgress[] = [];
  h.deps.retryChecked = async () => opts.checked ?? false;
  h.deps.checkRetryProgress = async () => progress;
  h.deps.recordRetryProgress = async (_run, _issueId, p) => {
    if (opts.failRecord) throw new Error("comment store down");
    recorded.push(p);
  };
  h.input.run = run({ retryOfRunId: "prev-1" });
  return { ...h, recorded };
}

  it("retry có commit của run trước: ghi tiến độ rồi cho chạy", async () => {
    const progress: RetryProgress = { kind: "checked", previousRunId: "prev-1", previousStartedAt: T0, cwd: "/w", commits: [{ sha: "c".repeat(40), committedAt: "x", subject: "s" }] };
    const h = retryHarness(progress);
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(false);
    expect(h.recorded).toEqual([progress]);
  });

  it("retry đã kiểm rồi thì không SSH lại", async () => {
    const h = retryHarness({ kind: "error", error: "không được gọi" }, { checked: true });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(false);
    expect(h.recorded).toEqual([]);
  });

  it("git lỗi: giữ queued, ghi mốc chờ với lý do kiểm tiến độ", async () => {
    const h = retryHarness({ kind: "error", error: "fatal: cannot change to '/w'" });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events[0]).toBe("mark:waiting");
    expect(h.events[1]).toMatch(/kiểm tiến độ/);
  });

  it("ghi comment tiến độ lỗi: giữ queued để thử lại", async () => {
    const h = retryHarness({ kind: "checked", previousRunId: "prev-1", previousStartedAt: T0, cwd: "/w", commits: [] }, { failRecord: true });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
  });

  it("run không phải retry: không kiểm tiến độ", async () => {
    const h = retryHarness({ kind: "error", error: "x" });
    h.input.run = run();
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(false);
  });
```

- [ ] **Step 6: Chạy, kỳ vọng FAIL**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts`
Expected: FAIL ở 4 test mới (cổng chưa gọi dep).

- [ ] **Step 7: Sửa `load-gate.ts`**

`BeforeClaimDeps` thêm:

```ts
  /** True once `crew.retry_progress.checked` exists for this run (the check runs once per run). */
  retryChecked(runId: string): Promise<boolean>;
  checkRetryProgress(run: BeforeClaimInput["run"]): Promise<RetryProgress>;
  /** Comments the previous run's commits (when there are any), then persists `crew.retry_progress.checked`. */
  recordRetryProgress(run: BeforeClaimInput["run"], issueId: string | null, progress: RetryProgress): Promise<void>;
```

Trong `evaluateBeforeClaim`, đổi `const decision` thành `let decision` và thay `if (decision.action === "claim") return false;` bằng:

```ts
  const issueId = readIssueId(run.contextSnapshot);
  if (decision.action === "claim") {
    if (!run.retryOfRunId || (await deps.retryChecked(run.id))) return false;
    const progress = await deps.checkRetryProgress(run);
    let failure = progress.kind === "error" ? progress.error : null;
    if (!failure) {
      try {
        await deps.recordRetryProgress(run, issueId, progress);
        return false;
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
      }
    }
    decision = decideGate({
      settings: target.settings,
      probe: { ok: false, error: `kiểm tiến độ lần chạy trước lỗi: ${failure}` },
      waitingSince: waitingSince ?? now,
      now,
    });
  }
```

(xóa khai báo `issueId` trùng phía dưới). `decideGate` với probe `ok: false` không bao giờ trả `claim`, nên luồng đi tiếp vào nhánh `wait`/`expire` đã có.

`defaultBeforeClaimDeps(db)` thêm:

```ts
    async retryChecked(runId) {
      const [row] = await db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(and(eq(activityLog.runId, runId), eq(activityLog.action, "crew.retry_progress.checked")))
        .limit(1);
      return Boolean(row);
    },
    checkRetryProgress: createRetryProgressChecker(db),
    async recordRetryProgress(run, issueId, progress) {
      if (progress.kind === "checked" && progress.commits.length > 0 && issueId) {
        await issueService(db).addComment(issueId, retryProgressComment(progress), {}, { authorType: "system" });
      }
      await logActivity(db, {
        companyId: run.companyId,
        actorType: "system",
        actorId: "crew",
        action: "crew.retry_progress.checked",
        entityType: "heartbeat_run",
        entityId: run.id,
        agentId: run.agentId,
        runId: run.id,
        issueId,
        details:
          progress.kind === "checked"
            ? { previousRunId: progress.previousRunId, cwd: progress.cwd, commits: progress.commits.map((c) => c.sha) }
            : { previousRunId: run.retryOfRunId, skipped: true },
      });
    },
```

- [ ] **Step 8: Test DB cho `createRetryProgressChecker`** (nối vào `crew-retry-progress.test.ts`, khung embedded PG như `crew-before-claim.test.ts`): seed company, agent, environment SSH (`driver: "ssh"`, `config` tối thiểu như các test environment hiện có — đọc `environment-runtime` test fixture nếu cần), run trước (`startedAt = 2026-10-07T09:15:00Z`), lease (`heartbeatRunId` = run trước, `metadata: { remoteCwd: "/Users/a/crew-agents/mac-claude" }`), run retry (`retryOfRunId`). Gọi `createRetryProgressChecker(db, fakeSsh)` với `fakeSsh` ghi lại lệnh và trả một dòng commit:

```ts
it("đọc startedAt và remoteCwd của run trước rồi chạy git log qua SSH", async () => {
  const commands: string[] = [];
  const check = createRetryProgressChecker(db, async (_config, command) => {
    commands.push(command);
    return { stdout: `${"c".repeat(40)}\t2026-10-07T16:20:43+07:00\tfeat: x\n` };
  });
  const progress = await check(retryRun);
  expect(commands[0]).toContain("git -C '/Users/a/crew-agents/mac-claude' log --since='2026-10-07T09:14:30.000Z'");
  expect(progress).toMatchObject({ kind: "checked", commits: [{ subject: "feat: x" }] });
});
```

Nếu `resolveEnvironmentDriverConfigForRuntime` cần secret SSH thật, cho `fakeSsh` nhận `config` bất kỳ và seed environment với cấu hình mà `parseSshEnvironmentConfig` chấp nhận; không giải được trong 15 phút thì chuyển phần DB này sang Cổng 4 của AC-2 và ghi lý do vào báo cáo (giữ test unit).

- [ ] **Step 9: Chạy cả gói, kỳ vọng PASS**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts src/__tests__/crew-retry-progress.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-remote-stop.test.ts`
Run: `corepack pnpm --filter @paperclipai/server exec tsc --noEmit`
Expected: PASS, 0 lỗi.

- [ ] **Step 10: Commit**

```bash
git add server/src/crew/retry-progress.ts server/src/crew/load-gate.ts \
  server/src/__tests__/crew-retry-progress.test.ts server/src/__tests__/crew-load-gate.test.ts
git commit -m "feat(crew): tell a retried run which commits its lost predecessor already made"
```

## Rủi ro và rollback

| Rủi ro | Khả năng × tác động | Giảm thiểu |
|---|---|---|
| SSH `git log` thêm tới 5 giây vào tick claim | Trung bình × Thấp | Chỉ một lần mỗi run retry; timeout 5 giây; sau đó activity đánh dấu |
| Commit của run cũ hơn (trước run trước) rơi vào cửa sổ 30 giây, agent tưởng đã làm | Thấp × Thấp | Comment chỉ dặn "kiểm tra", không tự bỏ việc; agent đọc diff |
| Environment không có `crewLoadGate` thì không kiểm retry | Trung bình × Trung bình | Mac mini đã có `crewLoadGate` (8/60); doctor/AC-2 kiểm; ghi ruling |
| Agent không đọc comment `Crew: lần chạy lại` | Trung bình × Trung bình | RO-1 dặn executor đọc comment `Crew:` trước khi làm; AC-2 kiểm không commit trùng |

Rollback: revert từng commit; script fallback và `load-gate.ts` không đổi schema, không có dữ liệu cần dọn (activity cũ vô hại).
