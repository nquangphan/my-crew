# Gói `release` (RL-1, RL-2): registry hook, vá theo dõi riêng và script nâng upstream — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa nhánh `v3` của fork Paperclip về đúng khuôn stock-first: ba hook một dòng (H1–H3) gọi một registry Crew mặc định no-op, các vá adapter/driver đã chứng minh ở spike được port kèm test ở file riêng, plugin Crew rỗng, `crew/release/core-hooks.json` có script kiểm mốc, và `crew/release/upgrade.sh` nâng upstream rồi dừng ở bước đỏ đầu tiên.

**Architecture:** Mọi logic của Crew trong server nằm ở `server/src/crew/`. File lõi chỉ có một dòng gọi `crewCoreHooks.*` ở đầu hàm, và một dòng import đặt ở cuối file. Vá adapter/driver được giữ nhỏ nhất có thể, và helper của chúng cũng đặt ở `server/src/crew/`. `core-hooks.json` là nguồn sự thật cho mọi chỗ đụng lõi. `check-core-hooks.mjs` (Node thuần, không phụ thuộc) đọc file này để kiểm từng mốc. `upgrade.sh` merge upstream vào một nhánh tạm trên worktree riêng, rồi gọi `verify.sh` để kiểm mốc, build phụ thuộc, chạy test vá và typecheck.

**Tech Stack:** Paperclip `v2026.1001.0` (pin `8f8a0ab7e`), Node 24.14, pnpm 9.15.4 qua Corepack, TypeScript 7.0.2, Vitest 4, `node:test`, bash 3.2 (macOS), git worktree.

**Spec:** [Khung R1-1](plan.md) (Global Constraints, mục "Interface giữa các gói"), [kết quả S6](../261006-0805-crew-v3-stock-first/spike-upgrade.md), [quyết định đã chốt](../261006-0805-crew-v3-stock-first/can-dai-ca-chot.md), nhánh bằng chứng `spike/claude-in-place` (`6ab1aa8c6`), `spike/s5-load-gate` (`acfa0cffa`), `spike/upgrade-rehearsal` (`799f7173f`) trong fork.

## Global Constraints

Chép nguyên văn từ khung, áp cho mọi task:

- Không sửa file lõi Paperclip, trừ hook một dòng ở đầu hàm. Mỗi hook có mục trong `crew/release/core-hooks.json` và có test kiểm hook còn tồn tại. Import của hook đặt ở cuối file.
- Ngân sách tối đa 5 chỉ đếm hook một dòng có registry (owner chốt 06/10/2026). Hiện có H1 `claimQueuedRun`, H2 `runUpdate`, H3 `releaseRunLease` của SSH driver. Vá adapter/driver (claude_local in_place, metadata in_place của SSH driver, `sessionCodec`, dòng log resume) ghi riêng trong `core-hooks.json` với loại `adapter-patch`/`driver-patch` và có PR upstream tương ứng.
- Không tạo scheduler, queue hay bảng ticket thứ hai. Paperclip là nguồn trạng thái duy nhất cho issue/run/session.
- Không deploy production, không push fork khi chưa có approval của owner.
- Mỗi process nền ghi lệnh/PID/cổng vào `processes.md` của plan này và dừng khi xong task.

Riêng gói này:

- Fork: `FORK=/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-v3`, nhánh `v3`, bắt đầu từ `8f8a0ab7e`. Commit cục bộ trên `v3`, không push. Trước mỗi lệnh git ghi, chạy `cd "$FORK" && test "$(git rev-parse --show-toplevel)" = "$FORK"`.
- Test của Crew không được thêm vào file test của upstream. Test server của Crew đặt ở `server/src/__tests__/crew-*.test.ts`; `server/tsconfig.json` loại thư mục `__tests__` khỏi `tsc`, giống test spike đã chạy được. Test adapter của Crew đặt ở `packages/adapters/claude-local/src/server/*.crew.test.ts`.
- Máy chạy là MacBook, không có `cargo`. Không gọi script `typecheck` của server, vì nó chạy `prepare:runner-vendor` và cần Rust. Thay vào đó gọi `tsc --noEmit` trực tiếp sau hai bước build trước (Task 0).
- Hook `scout-block` của repo Crew chặn mọi lệnh Bash có chữ `dist` hoặc `node_modules`. File có các chữ đó (ví dụ `packages/crew-plugin/package.json`) phải tạo bằng công cụ ghi file, không dùng heredoc.
- Commit theo Conventional Commits, không nhắc AI, thêm dòng attribution của phiên ở cuối message nếu harness yêu cầu.

## Review Focus

1. Upstream đổi tên, tách hoặc dời hàm có hook, nhưng merge vẫn sạch. Kỳ vọng: `check-core-hooks.mjs` báo đỏ vì anchor biến mất, hoặc vì hook không còn là lệnh đầu tiên. Test ở Task 2 (fixture thiếu anchor, fixture có lệnh chen trước hook).
2. Implementation thật của H3 (RT-1) ném lỗi, ví dụ SSH tới Mac timeout. Kỳ vọng: lease vẫn được trả, run không kẹt. Test ở Task 1 (`releaseRunLease` vẫn gọi `releaseLease` khi hook ném lỗi).
3. `upgrade.sh` chạy nhầm chỗ: không có ref, ref sai, worktree đã tồn tại, hoặc gọi `verify.sh` ngoài gốc worktree. Kỳ vọng: thoát với mã riêng, không tạo nhánh, không ghi vào `v3`. Test ở Task 6.
4. Ai đó thêm hook thứ sáu. Kỳ vọng: kiểm mốc báo đỏ vì vượt ngân sách 5. Test ở Task 2.
5. Mốc hợp lệ nhưng nằm sai driver: anchor của H3 rơi vào driver sandbox thay vì SSH. Kỳ vọng: kiểm mốc báo đỏ vì anchor nằm ngoài scope. Test ở Task 2.

---

## Cấu trúc file

| File | Trách nhiệm | Task |
|---|---|---|
| `server/src/crew/core-hooks.ts` (tạo) | Registry `crewCoreHooks`, kiểu tham số, mặc định no-op, `overrideCrewCoreHooksForTests` | 1 |
| `server/src/services/heartbeat.ts` (sửa) | H1: 1 dòng đầu `claimQueuedRun`, 1 import cuối file | 1 |
| `server/src/services/issues.ts` (sửa) | H2: 1 dòng đầu `runUpdate`, 1 import cuối file | 1 |
| `server/src/services/environment-runtime.ts` (sửa) | H3: 1 dòng đầu `releaseRunLease` của SSH driver; P1: 1 dòng spread metadata trong `acquireRunLease` của SSH driver; 2 import cuối file | 1, 3 |
| `server/src/__tests__/crew-core-hooks.test.ts` (tạo) | Test registry và H3 trong SSH driver | 1 |
| `crew/release/core-hooks.json` (tạo) | Danh sách mọi chỗ đụng lõi | 2, 3, 4 |
| `crew/release/check-core-hooks.mjs` (tạo) | Kiểm mốc theo `core-hooks.json` | 2 |
| `crew/release/check-core-hooks.test.mjs` (tạo) | Test kiểm mốc (`node:test`) | 2 |
| `server/src/crew/ssh-in-place.ts` (tạo) | `sshLeaseWorkspaceRealization` (dời từ `workspace-realization.ts` của spike ra khỏi file lõi) | 3 |
| `server/src/__tests__/crew-ssh-in-place.test.ts` (tạo) | Test P1 | 3 |
| `packages/adapters/claude-local/src/server/execute.ts` (sửa) | P2: `in_place`; P4: điều kiện log resume | 3, 4 |
| `packages/adapters/claude-local/src/server/execute.remote.crew.test.ts` (tạo) | Test P2, P4 và resume qua codec | 3, 4 |
| `packages/adapters/claude-local/src/server/index.ts` (sửa) | P3: `sessionCodec` giữ `remoteExecution` | 4 |
| `packages/adapters/claude-local/src/server/session-codec.crew.test.ts` (tạo) | Test P3 | 4 |
| `packages/crew-plugin/{package.json,tsconfig.json,src/manifest.ts,src/worker.ts}` (tạo) | Plugin rỗng | 5 |
| `server/src/__tests__/crew-plugin-manifest.test.ts` (tạo) | Manifest hợp lệ theo schema của host | 5 |
| `pnpm-lock.yaml` (sửa) | Chỉ thêm importer `packages/crew-plugin` | 5 |
| `crew/release/verify.sh` (tạo) | Kiểm một cây đã merge, dừng ở bước đỏ đầu tiên | 6 |
| `crew/release/upgrade.sh` (tạo) | Fetch, tạo worktree và nhánh tạm, merge ref upstream, gọi `verify.sh` | 6 |
| `crew/release/upgrade.test.mjs` (tạo) | Test đường lỗi của hai script | 6 |
| `plans/261006-1355-crew-v3-r1-1/release-report.md` (repo Crew, tạo) | Kết quả chạy thử trên `upstream/master` | 7 |

## Hợp đồng registry (chốt nguyên văn, `runtime.md` dùng lại)

Module `server/src/crew/core-hooks.ts`:

```ts
import type { Db, heartbeatRuns, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import type { EnvironmentDriverReleaseInput } from "../services/environment-runtime.js";

/** H1: gọi ở dòng đầu `claimQueuedRun` trong `heartbeatService(db)`. */
export interface BeforeClaimInput {
  db: Db;
  run: typeof heartbeatRuns.$inferSelect;
}

/** H2: gọi ở dòng đầu `runUpdate` (closure trong `issueService(db).update`), trước khi khóa dòng issue. */
export interface BeforeIssueWriteInput {
  /** Handle transaction của `runUpdate`; lệnh đọc/ghi qua `tx` nằm cùng transaction với lệnh ghi issue. */
  tx: Db;
  issueId: string;
  /** Bản issue đọc trước khi khóa dòng. Cần số liệu chắc chắn thì đọc lại qua `tx` với `.for("update")`. */
  existing: typeof issues.$inferSelect;
  /** Các cột sắp ghi, kể cả `status` và `executionPolicy` nếu request gửi lên. Không được sửa. */
  patch: Readonly<Partial<typeof issues.$inferInsert>>;
  actorAgentId: string | null | undefined;
  actorUserId: string | null | undefined;
}

/**
 * H3: gọi ở dòng đầu `releaseRunLease` của SSH driver, trước `environmentsSvc.releaseLease`.
 * `db` là tham số `db` của `createSshEnvironmentDriver(db: Db)`; implementation cần nó để giải private key SSH
 * từ secret của Paperclip (server không có `db` dùng chung).
 */
export type RunLeaseReleasedInput = EnvironmentDriverReleaseInput & { db: Db };

export interface CrewCoreHooks {
  /** Trả `true` để giữ run ở `queued` (`claimQueuedRun` trả `null`, scheduler thử lại ở tick sau). Run không ở `queued` thì phải trả `false`. */
  beforeClaim(input: BeforeClaimInput): Promise<boolean>;
  /** Ném `HttpError` (ví dụ `unprocessable(...)` từ `server/src/errors.ts`) để chặn lệnh ghi; transaction rollback. Trả bình thường để cho ghi. */
  beforeIssueWrite(input: BeforeIssueWriteInput): Promise<void>;
  /** Dừng phần việc còn chạy phía remote. Lỗi bị nuốt và ghi log để lease vẫn được trả. */
  onRunLeaseReleased(input: RunLeaseReleasedInput): Promise<void>;
}
```

`EnvironmentDriverReleaseInput` (có sẵn trong `environment-runtime.ts:479`) là `{ cancelActiveWork?: boolean; environment: Environment; lease: EnvironmentLease; status: "released" | "expired" | "failed" }`. Vì vậy `RunLeaseReleasedInput` là `{ db: Db; cancelActiveWork?: boolean; environment: Environment; lease: EnvironmentLease; status: "released" | "expired" | "failed" }`. `Db` import kiểu từ `@paperclipai/db`, giống `import type { Db } from "@paperclipai/db";` ở `heartbeat.ts:82` và `environment-runtime.ts`.

Ba dòng hook, viết đúng nguyên văn:

| Hook | File | Dòng đầu hàm | Import ở cuối file |
|---|---|---|---|
| H1 | `server/src/services/heartbeat.ts`, `async function claimQueuedRun(` | `    if (await crewCoreHooks.beforeClaim({ db, run })) return null;` | `import { crewCoreHooks } from "../crew/core-hooks.js";` |
| H2 | `server/src/services/issues.ts`, `const runUpdate = async (tx: any) => {` | `        await crewCoreHooks.beforeIssueWrite({ tx, issueId: id, existing, patch, actorAgentId, actorUserId });` | `import { crewCoreHooks } from "../crew/core-hooks.js";` |
| H3 | `server/src/services/environment-runtime.ts`, `async releaseRunLease(input) {` trong `function createSshEnvironmentDriver(` | `      await crewCoreHooks.onRunLeaseReleased({ db, ...input });` | `import { crewCoreHooks } from "../crew/core-hooks.js";` |

**Cách đăng ký implementation thật:** plugin Paperclip chạy trong worker process riêng, nên không đăng ký được hook trong process server. RT-1 và RT-2 viết implementation ở `server/src/crew/<module>.ts`, rồi thay giá trị tương ứng trong object `implementations` của `core-hooks.ts` bằng hàm import từ module đó. Ví dụ RT-1 thêm `import { stopRemoteRunOnRelease } from "./remote-stop.js";` và đổi thành `onRunLeaseReleased: stopRemoteRunOnRelease`. Không có lời gọi đăng ký nào ở startup, nên không phải đụng thêm file lõi. `overrideCrewCoreHooksForTests` chỉ dùng trong test. Module implementation không được import `server/src/crew/core-hooks.ts`, để tránh vòng import với file lõi.

## Schema `crew/release/core-hooks.json`

```json
{
  "schemaVersion": 1,
  "base": "v2026.1001.0",
  "entries": [
    {
      "id": "H1",
      "kind": "hook",
      "file": "server/src/services/heartbeat.ts",
      "symbol": "heartbeatService.claimQueuedRun",
      "scope": "chuỗi tùy chọn: anchor phải nằm sau chuỗi này và trước dòng `\\nfunction ` kế tiếp",
      "head": "bắt buộc với kind hook: dòng mở hàm; giữa head và anchor chỉ được có phần chữ ký",
      "anchor": "chuỗi chính xác phải có trong file",
      "occurrences": 1,
      "importLine": "bắt buộc với kind hook: phải nằm trong khối import liền nhau ở cuối file",
      "description": "mô tả tiếng Anh ngắn",
      "upstreamPr": null,
      "tests": ["đường dẫn file test của Crew"]
    }
  ]
}
```

- `kind` thuộc `hook` | `adapter-patch` | `driver-patch`. Số mục `hook` phải ≤ 5.
- `upstreamPr` là URL PR hoặc `null`. `null` ở mục `adapter-patch`/`driver-patch` sinh cảnh báo, không sinh lỗi, vì PR chỉ được mở sau khi owner duyệt push.
- `occurrences` mặc định là 1.

---

## RL-1

### Task 0: Chuẩn bị fork

**Files:** không sửa file nào.

**Interfaces:**
- Consumes: không.
- Produces: nhánh lưu `backup/v3-before-rl1` tại `8f8a0ab7e`; `dist` của `@paperclipai/shared`, `@paperclipai/plugin-sdk` và phần TypeScript của `@paperclipai/paperclip-runner`, cần cho test và `tsc` của server.

- [ ] **Step 1: Kiểm trạng thái và tạo nhánh lưu**

```bash
FORK=/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-v3
cd "$FORK" && test "$(git rev-parse --show-toplevel)" = "$FORK" || exit 1
git rev-parse --abbrev-ref HEAD   # Expected: v3
git rev-parse HEAD                # Expected: 8f8a0ab7effbd6a0584107d8038736c134ee5047
git status --short                # Expected: chỉ "?? .crew-setup/"
git branch backup/v3-before-rl1 v3
```

- [ ] **Step 2: Kiểm bộ nhớ, rồi cài và build phụ thuộc**

```bash
memory_pressure | tail -1   # Dừng nếu free < 25%
cd "$FORK" && corepack pnpm install
corepack pnpm --filter @paperclipai/plugin-sdk ensure-build-deps
corepack pnpm --filter @paperclipai/paperclip-runner run build:typescript
```

Expected: cả ba lệnh thoát 0. Lần diễn tập: install khoảng 23 giây với store đã ấm, build khoảng 2 giây mỗi lệnh. Có cảnh báo `Failed to create bin ... paperclip-runner` trước khi build là bình thường.

- [ ] **Step 3: Đo nền trước khi sửa**

```bash
cd "$FORK"
corepack pnpm --filter @paperclipai/server exec tsc --noEmit; echo EXIT $?
corepack pnpm --filter @paperclipai/adapter-claude-local exec tsc --noEmit; echo EXIT $?
```

Expected: `EXIT 0` cả hai. Nếu đỏ thì dừng và ghi lại, vì lỗi đó có từ trước, không phải do RL-1.

### Task 1: Registry hook và ba dòng H1–H3

**Files:**
- Create: `server/src/crew/core-hooks.ts`
- Create: `server/src/__tests__/crew-core-hooks.test.ts`
- Modify: `server/src/services/heartbeat.ts:17124-17128` (đầu `claimQueuedRun`) và cuối file
- Modify: `server/src/services/issues.ts:10777` (đầu `runUpdate`) và cuối file
- Modify: `server/src/services/environment-runtime.ts:1208-1210` (`releaseRunLease` của `createSshEnvironmentDriver`) và cuối file

**Interfaces:**
- Consumes: `EnvironmentDriverReleaseInput`, `environmentRuntimeService(db).getDriver("ssh")` (có sẵn; `createSshEnvironmentDriver(db: Db)` ở `environment-runtime.ts:1168` có `db` trong scope); `environmentService(db).releaseLease(id, status)` (có sẵn).
- Produces: `crewCoreHooks: CrewCoreHooks`, các kiểu `BeforeClaimInput`, `BeforeIssueWriteInput`, `RunLeaseReleasedInput`, `CrewCoreHooks`, và `overrideCrewCoreHooksForTests(partial: Partial<CrewCoreHooks>): () => void`, đúng nguyên văn mục "Hợp đồng registry".

- [ ] **Step 1: Viết test trước**

`server/src/__tests__/crew-core-hooks.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { Environment, EnvironmentLease } from "@paperclipai/shared";

const { releaseLease } = vi.hoisted(() => ({
  releaseLease: vi.fn(async (id: string, status: string) => ({ id, status })),
}));

vi.mock("../services/environments.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/environments.ts")>()),
  environmentService: () => ({ releaseLease }),
}));

import { environmentRuntimeService } from "../services/environment-runtime.ts";
import { crewCoreHooks, overrideCrewCoreHooksForTests } from "../crew/core-hooks.ts";

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
  vi.clearAllMocks();
});

const environment = { id: "env-1", driver: "ssh", metadata: null } as unknown as Environment;
const lease = { id: "lease-1", companyId: "company-1", provider: "ssh" } as unknown as EnvironmentLease;

const db = { fixture: "db" } as unknown as Db;

function sshDriver() {
  const driver = environmentRuntimeService(db).getDriver("ssh");
  if (!driver) throw new Error("ssh driver missing");
  return driver;
}

describe("crewCoreHooks mặc định", () => {
  it("không giữ run nào và không chặn lệnh ghi nào", async () => {
    await expect(
      crewCoreHooks.beforeClaim({ db: {} as Db, run: { id: "run-1", status: "queued" } as never }),
    ).resolves.toBe(false);
    await expect(
      crewCoreHooks.beforeIssueWrite({
        tx: {} as Db,
        issueId: "issue-1",
        existing: { id: "issue-1" } as never,
        patch: { status: "done" },
        actorAgentId: "agent-1",
        actorUserId: null,
      }),
    ).resolves.toBeUndefined();
    await expect(
      crewCoreHooks.onRunLeaseReleased({ db: {} as Db, environment, lease, status: "released" }),
    ).resolves.toBeUndefined();
  });

  it("override trong test rồi khôi phục được", async () => {
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => true });
    await expect(crewCoreHooks.beforeClaim({ db: {} as Db, run: { id: "run-1" } as never })).resolves.toBe(true);
    restore();
    restore = null;
    await expect(crewCoreHooks.beforeClaim({ db: {} as Db, run: { id: "run-1" } as never })).resolves.toBe(false);
  });
});

describe("H3 trong SSH driver", () => {
  it("gọi onRunLeaseReleased với db của driver và nguyên input trước khi trả lease", async () => {
    const order: string[] = [];
    const seen: unknown[] = [];
    restore = overrideCrewCoreHooksForTests({
      onRunLeaseReleased: async (input) => {
        order.push("hook");
        seen.push(input);
      },
    });
    releaseLease.mockImplementationOnce(async (id: string, status: string) => {
      order.push("release");
      return { id, status };
    });
    const input = { environment, lease, status: "failed" as const, cancelActiveWork: true };

    await sshDriver().releaseRunLease(input);

    expect(order).toEqual(["hook", "release"]);
    expect(seen[0]).toEqual({ db, ...input });
    expect((seen[0] as { db: Db }).db).toBe(db);
    expect(releaseLease).toHaveBeenCalledWith("lease-1", "failed");
  });

  it("vẫn trả lease khi implementation ném lỗi", async () => {
    restore = overrideCrewCoreHooksForTests({
      onRunLeaseReleased: async () => {
        throw new Error("ssh timeout");
      },
    });

    await expect(sshDriver().releaseRunLease({ environment, lease, status: "expired" })).resolves.toEqual({
      id: "lease-1",
      status: "expired",
    });
    expect(releaseLease).toHaveBeenCalledWith("lease-1", "expired");
  });
});
```

- [ ] **Step 2: Chạy test để thấy đỏ**

Run: `cd "$FORK" && corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-core-hooks.test.ts`
Expected: FAIL, lỗi nạp `Failed to load url ../crew/core-hooks.ts` (hoặc "Cannot find module").

- [ ] **Step 3: Tạo registry**

`server/src/crew/core-hooks.ts`: dán nguyên khối ở mục "Hợp đồng registry", rồi nối thêm:

```ts
const implementations: CrewCoreHooks = {
  beforeClaim: async () => false,
  beforeIssueWrite: async () => {},
  onRunLeaseReleased: async () => {},
};

export const crewCoreHooks: CrewCoreHooks = {
  beforeClaim: (input) => implementations.beforeClaim(input),
  beforeIssueWrite: (input) => implementations.beforeIssueWrite(input),
  async onRunLeaseReleased(input) {
    try {
      await implementations.onRunLeaseReleased(input);
    } catch (error) {
      logger.warn(
        { err: error, leaseId: input.lease.id, environmentId: input.environment.id, status: input.status },
        "crew onRunLeaseReleased failed; releasing the lease anyway",
      );
    }
  },
};

export function overrideCrewCoreHooksForTests(partial: Partial<CrewCoreHooks>): () => void {
  const previous = { ...implementations };
  Object.assign(implementations, partial);
  return () => {
    Object.assign(implementations, previous);
  };
}
```

- [ ] **Step 4: Thêm H3**

Trong `server/src/services/environment-runtime.ts`, ở `createSshEnvironmentDriver` (dòng 1208), đổi:

```ts
    async releaseRunLease(input) {
      return await environmentsSvc.releaseLease(input.lease.id, input.status);
    },
```

thành:

```ts
    async releaseRunLease(input) {
      await crewCoreHooks.onRunLeaseReleased({ db, ...input });
      return await environmentsSvc.releaseLease(input.lease.id, input.status);
    },
```

Chỉ sửa khối nằm sau `function createSshEnvironmentDriver(` và trước `function createSandboxEnvironmentDriver(`; driver local có khối giống hệt ở dòng 1127. Thêm dòng cuối file (sau `export type EnvironmentRuntimeService = ...`):

```ts
import { crewCoreHooks } from "../crew/core-hooks.js";
```

- [ ] **Step 5: Chạy test để thấy xanh**

Run: `cd "$FORK" && corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-core-hooks.test.ts`
Expected: PASS, 4 test.

- [ ] **Step 6: Thêm H1 và H2**

`server/src/services/heartbeat.ts`, đầu `claimQueuedRun` (dòng 17124):

```ts
  async function claimQueuedRun(
    run: typeof heartbeatRuns.$inferSelect,
    companyAgents?: AgentOrgRow[],
  ) {
    if (await crewCoreHooks.beforeClaim({ db, run })) return null;
    if (run.status !== "queued") return run;
```

Thêm dòng cuối file: `import { crewCoreHooks } from "../crew/core-hooks.js";`

`server/src/services/issues.ts`, đầu `runUpdate` (dòng 10777):

```ts
      const runUpdate = async (tx: any) => {
        await crewCoreHooks.beforeIssueWrite({ tx, issueId: id, existing, patch, actorAgentId, actorUserId });
        // The receipt baseline must be read under the same row lock as the
```

Thêm dòng cuối file: `import { crewCoreHooks } from "../crew/core-hooks.js";`

- [ ] **Step 7: Typecheck và chạy lại test**

```bash
cd "$FORK"
corepack pnpm --filter @paperclipai/server exec tsc --noEmit; echo EXIT $?
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-core-hooks.test.ts src/adapters/plugin-loader.test.ts
```

Expected: `EXIT 0`; vitest PASS cả 2 file.

- [ ] **Step 8: Commit**

```bash
cd "$FORK" && test "$(git rev-parse --show-toplevel)" = "$FORK" || exit 1
git add server/src/crew/core-hooks.ts server/src/__tests__/crew-core-hooks.test.ts \
  server/src/services/heartbeat.ts server/src/services/issues.ts server/src/services/environment-runtime.ts
git commit -m "feat(crew): add the core hook registry with no-op beforeClaim, beforeIssueWrite and onRunLeaseReleased"
```

### Task 2: `core-hooks.json` và kiểm mốc

**Files:**
- Create: `crew/release/core-hooks.json`
- Create: `crew/release/check-core-hooks.mjs`
- Create: `crew/release/check-core-hooks.test.mjs`

**Interfaces:**
- Consumes: ba dòng hook và import của Task 1.
- Produces: `checkCoreHooks(repoRoot: string, registry: Registry): { errors: string[]; warnings: string[]; hookCount: number }`, `HOOK_BUDGET = 5`. CLI `node crew/release/check-core-hooks.mjs` thoát 0 khi không có lỗi, 1 khi có lỗi. Task 3, 4 thêm mục vào `entries`; Task 6 gọi CLI.

- [ ] **Step 1: Viết test trước**

`crew/release/check-core-hooks.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOOK_BUDGET, checkCoreHooks } from "./check-core-hooks.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IMPORT = 'import { crewCoreHooks } from "../crew/core-hooks.js";';
const ANCHOR = "    if (await crewCoreHooks.beforeClaim({ run })) return null;";
const GOOD = [
  "export function service() {",
  "  async function claim(",
  "    run: Run,",
  "  ) {",
  ANCHOR,
  "    return run;",
  "  }",
  "}",
  "",
  "function other() {",
  "  return 1;",
  "}",
  IMPORT,
  "",
].join("\n");

function fixture(source) {
  const root = mkdtempSync(path.join(tmpdir(), "crew-core-hooks-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src/service.ts"), source);
  return root;
}

function hook(overrides = {}) {
  return {
    id: "H1",
    kind: "hook",
    file: "src/service.ts",
    symbol: "service.claim",
    head: "async function claim(",
    anchor: ANCHOR,
    importLine: IMPORT,
    description: "fixture hook",
    upstreamPr: null,
    tests: [],
    ...overrides,
  };
}

const registry = (entries) => ({ schemaVersion: 1, base: "v2026.1001.0", entries });

test("registry thật của fork đạt", () => {
  const real = JSON.parse(readFileSync(path.join(repoRoot, "crew/release/core-hooks.json"), "utf8"));
  const result = checkCoreHooks(repoRoot, real);
  assert.deepEqual(result.errors, []);
  assert.ok(result.hookCount >= 3 && result.hookCount <= HOOK_BUDGET);
});

test("hook đúng vị trí thì không có lỗi", () => {
  const result = checkCoreHooks(fixture(GOOD), registry([hook()]));
  assert.deepEqual(result.errors, []);
  assert.equal(result.hookCount, 1);
});

test("mất anchor thì đỏ", () => {
  const root = fixture(GOOD.replace(`${ANCHOR}\n`, ""));
  const { errors } = checkCoreHooks(root, registry([hook()]));
  assert.match(errors.join("\n"), /H1: anchor xuất hiện 0 lần trong src\/service\.ts, cần 1/);
});

test("có lệnh chen trước hook thì đỏ", () => {
  const root = fixture(GOOD.replace("  ) {\n", "  ) {\n    const started = Date.now();\n"));
  const { errors } = checkCoreHooks(root, registry([hook()]));
  assert.match(errors.join("\n"), /H1: hook không phải lệnh đầu tiên của service\.claim/);
});

test("import không nằm cuối file thì đỏ", () => {
  const root = fixture(`${IMPORT}\n${GOOD.replace(`${IMPORT}\n`, "")}`);
  const { errors } = checkCoreHooks(root, registry([hook()]));
  assert.match(errors.join("\n"), /H1: import .* không nằm cuối file src\/service\.ts/);
});

test("anchor nằm ngoài scope thì đỏ", () => {
  const { errors } = checkCoreHooks(fixture(GOOD), registry([hook({ scope: "function other(" })]));
  assert.match(errors.join("\n"), /H1: anchor nằm ngoài scope "function other\("/);
});

test("vượt ngân sách hook thì đỏ", () => {
  const entries = Array.from({ length: HOOK_BUDGET + 1 }, (_, index) => hook({ id: `H${index + 1}` }));
  const { errors } = checkCoreHooks(fixture(GOOD), registry(entries));
  assert.match(errors.join("\n"), /Ngân sách hook: 6 > 5/);
});

test("vá adapter chưa có PR upstream chỉ cảnh báo", () => {
  const patch = {
    id: "P9",
    kind: "adapter-patch",
    file: "src/service.ts",
    symbol: "service",
    anchor: "    return run;",
    description: "fixture patch",
    upstreamPr: null,
    tests: [],
  };
  const result = checkCoreHooks(fixture(GOOD), registry([patch]));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, ["P9: chưa có PR upstream"]);
});

test("test được khai báo mà không tồn tại thì đỏ", () => {
  const { errors } = checkCoreHooks(fixture(GOOD), registry([hook({ tests: ["src/missing.test.ts"] })]));
  assert.match(errors.join("\n"), /H1: test src\/missing\.test\.ts không tồn tại/);
});
```

- [ ] **Step 2: Chạy test để thấy đỏ**

Run: `cd "$FORK" && node --test crew/release/check-core-hooks.test.mjs`
Expected: FAIL với `ERR_MODULE_NOT_FOUND` cho `./check-core-hooks.mjs`.

- [ ] **Step 3: Viết script kiểm mốc**

`crew/release/check-core-hooks.mjs`:

```js
#!/usr/bin/env node
// Checks every Crew touch point in Paperclip core against crew/release/core-hooks.json.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HOOK_BUDGET = 5;
const KINDS = new Set(["hook", "adapter-patch", "driver-patch"]);
const REQUIRED = ["id", "kind", "file", "symbol", "anchor", "description"];

function countOccurrences(text, needle) {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

function trailingImports(text) {
  const lines = text.replace(/\s+$/, "").split("\n");
  const imports = [];
  for (let index = lines.length - 1; index >= 0 && lines[index].startsWith("import "); index -= 1) {
    imports.push(lines[index]);
  }
  return imports;
}

export function checkCoreHooks(repoRoot, registry) {
  const errors = [];
  const warnings = [];
  if (registry.schemaVersion !== 1) errors.push("schemaVersion phải là 1");
  const entries = Array.isArray(registry.entries) ? registry.entries : [];
  const hookCount = entries.filter((entry) => entry.kind === "hook").length;
  if (hookCount > HOOK_BUDGET) errors.push(`Ngân sách hook: ${hookCount} > ${HOOK_BUDGET}`);
  const ids = new Set();

  for (const entry of entries) {
    const id = entry.id ?? "(không id)";
    if (ids.has(id)) errors.push(`id trùng: ${id}`);
    ids.add(id);
    const missing = REQUIRED.filter((field) => typeof entry[field] !== "string" || entry[field].length === 0);
    if (entry.kind === "hook") {
      for (const field of ["head", "importLine"]) {
        if (typeof entry[field] !== "string" || entry[field].length === 0) missing.push(field);
      }
    }
    if (!("upstreamPr" in entry)) missing.push("upstreamPr");
    if (missing.length > 0) {
      errors.push(`${id}: thiếu trường ${missing.join(", ")}`);
      continue;
    }
    if (!KINDS.has(entry.kind)) {
      errors.push(`${id}: kind "${entry.kind}" không hợp lệ`);
      continue;
    }
    if (entry.kind !== "hook" && !entry.upstreamPr) warnings.push(`${id}: chưa có PR upstream`);
    for (const testFile of entry.tests ?? []) {
      if (!existsSync(path.join(repoRoot, testFile))) errors.push(`${id}: test ${testFile} không tồn tại`);
    }

    const filePath = path.join(repoRoot, entry.file);
    if (!existsSync(filePath)) {
      errors.push(`${id}: không đọc được ${entry.file}`);
      continue;
    }
    const text = readFileSync(filePath, "utf8");
    const expected = entry.occurrences ?? 1;
    const count = countOccurrences(text, entry.anchor);
    if (count !== expected) {
      errors.push(`${id}: anchor xuất hiện ${count} lần trong ${entry.file}, cần ${expected}`);
      continue;
    }

    let scopeStart = 0;
    let scopeEnd = text.length;
    if (entry.scope) {
      scopeStart = text.indexOf(entry.scope);
      if (scopeStart === -1) {
        errors.push(`${id}: không tìm thấy scope "${entry.scope}" trong ${entry.file}`);
        continue;
      }
      const next = text.indexOf("\nfunction ", scopeStart + entry.scope.length);
      if (next !== -1) scopeEnd = next;
    }
    const at = text.indexOf(entry.anchor, scopeStart);
    if (at === -1 || at >= scopeEnd) {
      errors.push(`${id}: anchor nằm ngoài scope "${entry.scope}"`);
      continue;
    }

    if (entry.importLine && !trailingImports(text).includes(entry.importLine)) {
      errors.push(`${id}: import "${entry.importLine}" không nằm cuối file ${entry.file}`);
    }
    if (entry.kind === "hook") {
      const headAt = text.lastIndexOf(entry.head, at);
      const between = headAt === -1 ? "" : text.slice(headAt + entry.head.length, at);
      const signatureOnly = headAt >= scopeStart && !between.includes(";") && /\{\s*$/.test(entry.head + between);
      if (!signatureOnly) errors.push(`${id}: hook không phải lệnh đầu tiên của ${entry.symbol}`);
    }
  }
  return { errors, warnings, hookCount };
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const registry = JSON.parse(readFileSync(path.join(root, "crew/release/core-hooks.json"), "utf8"));
  const { errors, warnings, hookCount } = checkCoreHooks(root, registry);
  for (const warning of warnings) console.warn(`CẢNH BÁO ${warning}`);
  for (const error of errors) console.error(`LỖI ${error}`);
  console.log(`Hook một dòng: ${hookCount}/${HOOK_BUDGET}; mục: ${registry.entries.length}; lỗi: ${errors.length}`);
  process.exit(errors.length > 0 ? 1 : 0);
}
```

- [ ] **Step 4: Viết `core-hooks.json` với H1–H3**

`crew/release/core-hooks.json`:

```json
{
  "schemaVersion": 1,
  "base": "v2026.1001.0",
  "entries": [
    {
      "id": "H1",
      "kind": "hook",
      "file": "server/src/services/heartbeat.ts",
      "symbol": "heartbeatService.claimQueuedRun",
      "head": "async function claimQueuedRun(",
      "anchor": "    if (await crewCoreHooks.beforeClaim({ db, run })) return null;",
      "importLine": "import { crewCoreHooks } from \"../crew/core-hooks.js\";",
      "description": "Keep a queued run queued while its environment is overloaded or unreachable.",
      "upstreamPr": null,
      "tests": ["server/src/__tests__/crew-core-hooks.test.ts"]
    },
    {
      "id": "H2",
      "kind": "hook",
      "file": "server/src/services/issues.ts",
      "symbol": "issueService.update.runUpdate",
      "head": "const runUpdate = async (tx: any) => {",
      "anchor": "        await crewCoreHooks.beforeIssueWrite({ tx, issueId: id, existing, patch, actorAgentId, actorUserId });",
      "importLine": "import { crewCoreHooks } from \"../crew/core-hooks.js\";",
      "description": "Reject issue writes that skip execution-policy stages or let an agent change executionPolicy.",
      "upstreamPr": null,
      "tests": ["server/src/__tests__/crew-core-hooks.test.ts"]
    },
    {
      "id": "H3",
      "kind": "hook",
      "file": "server/src/services/environment-runtime.ts",
      "symbol": "createSshEnvironmentDriver.releaseRunLease",
      "scope": "function createSshEnvironmentDriver(",
      "head": "async releaseRunLease(input) {",
      "anchor": "      await crewCoreHooks.onRunLeaseReleased({ db, ...input });",
      "importLine": "import { crewCoreHooks } from \"../crew/core-hooks.js\";",
      "description": "Stop the run's remote work when an SSH run lease is released (cancel, failed, expired).",
      "upstreamPr": null,
      "tests": ["server/src/__tests__/crew-core-hooks.test.ts"]
    }
  ]
}
```

- [ ] **Step 5: Chạy test và CLI để thấy xanh**

```bash
cd "$FORK"
node --test crew/release/check-core-hooks.test.mjs
node crew/release/check-core-hooks.mjs; echo EXIT $?
```

Expected: `# pass 9`, `# fail 0`; CLI in `Hook một dòng: 3/5; mục: 3; lỗi: 0` và `EXIT 0`.

- [ ] **Step 6: Commit**

```bash
cd "$FORK" && test "$(git rev-parse --show-toplevel)" = "$FORK" || exit 1
git add crew/release/core-hooks.json crew/release/check-core-hooks.mjs crew/release/check-core-hooks.test.mjs
git commit -m "feat(crew): track core hooks in core-hooks.json and check their anchors"
```

### Task 3: Port `in_place` cho `claude_local` trên SSH (P1 driver, P2 adapter)

Nguồn: `ce8c96206` và `5f28832b2` trên `spike/claude-in-place`. Khác spike: helper chuyển từ `workspace-realization.ts` (file lõi) sang `server/src/crew/ssh-in-place.ts`, và test chuyển sang file riêng của Crew.

**Files:**
- Create: `server/src/crew/ssh-in-place.ts`
- Create: `server/src/__tests__/crew-ssh-in-place.test.ts`
- Create: `packages/adapters/claude-local/src/server/execute.remote.crew.test.ts`
- Modify: `server/src/services/environment-runtime.ts:1199` (metadata trong `acquireRunLease` của SSH driver) và cuối file
- Modify: `packages/adapters/claude-local/src/server/execute.ts:611-626`
- Modify: `crew/release/core-hooks.json`

**Interfaces:**
- Consumes: `buildWorkspaceRealizationRecord` (có sẵn trong `server/src/services/workspace-realization.ts`), `prepareAdapterExecutionTargetRuntime({ workspaceRemoteDir?: string; syncWorkspace?: boolean; ... })` (có sẵn trong adapter-utils).
- Produces: `sshLeaseWorkspaceRealization(environment: Pick<Environment, "metadata">): { workspaceRealization?: { mode: "in_place" } }`. Environment SSH đặt `metadata.workspaceRealizationMode = "in_place"` thì lease có `metadata.workspaceRealization = { mode: "in_place" }`, và `claude_local` chạy tại `authoritativeRoot`, không upload hay restore workspace.

- [ ] **Step 1: Viết test server trước**

`server/src/__tests__/crew-ssh-in-place.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { Environment, EnvironmentLease, WorkspaceRealizationRequest } from "@paperclipai/shared";

const REMOTE_ROOT = "/Users/agent/worktrees/repo-a-agent";

const { acquireLease, ensureSshWorkspaceReady, resolveEnvironmentDriverConfigForRuntime } = vi.hoisted(() => ({
  acquireLease: vi.fn(async (input: Record<string, unknown>) => ({ id: "lease-1", ...input })),
  ensureSshWorkspaceReady: vi.fn(async () => ({ remoteCwd: "/Users/agent/worktrees/repo-a-agent" })),
  resolveEnvironmentDriverConfigForRuntime: vi.fn(async () => ({
    driver: "ssh",
    config: {
      host: "100.64.0.1",
      port: 2222,
      username: "agent",
      remoteWorkspacePath: "/Users/agent/worktrees/repo-a-agent",
      privateKey: null,
      privateKeySecretRef: null,
      knownHosts: null,
      strictHostKeyChecking: true,
    },
  })),
}));

vi.mock("../services/environments.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/environments.ts")>()),
  environmentService: () => ({ acquireLease }),
}));

vi.mock("../services/environment-config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/environment-config.ts")>()),
  resolveEnvironmentDriverConfigForRuntime,
}));

vi.mock("@paperclipai/adapter-utils/ssh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@paperclipai/adapter-utils/ssh")>()),
  ensureSshWorkspaceReady,
}));

import { environmentRuntimeService } from "../services/environment-runtime.ts";
import { buildWorkspaceRealizationRecord } from "../services/workspace-realization.ts";
import { sshLeaseWorkspaceRealization } from "../crew/ssh-in-place.ts";

afterEach(() => {
  vi.clearAllMocks();
});

function sshEnvironment(metadata: Record<string, unknown> | null): Environment {
  return { id: "env-1", driver: "ssh", metadata } as unknown as Environment;
}

function sshLease(environment: Environment): EnvironmentLease {
  return {
    id: "lease-1",
    companyId: "company-1",
    provider: "ssh",
    providerLeaseId: `ssh://agent@100.64.0.1:2222${REMOTE_ROOT}`,
    metadata: {
      driver: "ssh",
      host: "100.64.0.1",
      port: 2222,
      username: "agent",
      remoteWorkspacePath: REMOTE_ROOT,
      remoteCwd: REMOTE_ROOT,
      ...sshLeaseWorkspaceRealization(environment),
    },
  } as unknown as EnvironmentLease;
}

const request = {
  executionWorkspaceId: null,
  requestedMode: null,
  source: {
    kind: "task_session",
    localPath: "/paperclip/agent-home",
    strategy: "project_primary",
    projectId: null,
    projectWorkspaceId: null,
    repoUrl: null,
    repoRef: null,
    branchName: null,
    worktreePath: null,
  },
  additionalSources: [],
  runtimeOverlay: { provisionCommand: null },
} as unknown as WorkspaceRealizationRequest;

describe("SSH workspace realization from environment metadata", () => {
  it("keeps copy mode when the environment does not ask for in_place", () => {
    const environment = sshEnvironment(null);
    expect(sshLeaseWorkspaceRealization(environment)).toEqual({});
    const record = buildWorkspaceRealizationRecord({ environment, lease: sshLease(environment), request });
    expect(record.mode).toBe("copy");
    expect(record.authoritativeRoot).toBe("/paperclip/agent-home");
  });

  it("ignores unknown realization values", () => {
    expect(sshLeaseWorkspaceRealization(sshEnvironment({ workspaceRealizationMode: "mirror" }))).toEqual({});
    expect(sshLeaseWorkspaceRealization(sshEnvironment({ workspaceRealizationMode: ["in_place"] }))).toEqual({});
  });

  it("realizes in place at the remote workspace path when the environment asks for in_place", () => {
    const environment = sshEnvironment({ workspaceRealizationMode: "in_place" });
    expect(sshLeaseWorkspaceRealization(environment)).toEqual({ workspaceRealization: { mode: "in_place" } });
    const record = buildWorkspaceRealizationRecord({ environment, lease: sshLease(environment), request });
    expect(record.mode).toBe("in_place");
    expect(record.authoritativeRoot).toBe(REMOTE_ROOT);
    expect(record.remote.path).toBe(REMOTE_ROOT);
  });
});

describe("SSH driver acquireRunLease", () => {
  async function acquireWith(metadata: Record<string, unknown> | null) {
    const driver = environmentRuntimeService({} as Db).getDriver("ssh");
    if (!driver) throw new Error("ssh driver missing");
    await driver.acquireRunLease({
      companyId: "company-1",
      environment: { id: "env-1", driver: "ssh", status: "active", metadata } as unknown as Environment,
      issueId: null,
      agentId: null,
      heartbeatRunId: null,
      executionWorkspaceId: null,
      executionWorkspaceMode: null,
      executionWorkspaceSettings: null,
      adapterType: null,
      applyCustomImageTemplate: false,
    } as unknown as Parameters<typeof driver.acquireRunLease>[0]);
    expect(acquireLease).toHaveBeenCalledTimes(1);
    return (acquireLease.mock.calls[0]?.[0] as { metadata: Record<string, unknown> }).metadata;
  }

  it("marks the lease in_place when the environment asks for it", async () => {
    const metadata = await acquireWith({ workspaceRealizationMode: "in_place" });
    expect(metadata.remoteCwd).toBe(REMOTE_ROOT);
    expect(metadata.workspaceRealization).toEqual({ mode: "in_place" });
  });

  it("leaves the lease without realization metadata by default", async () => {
    const metadata = await acquireWith(null);
    expect(metadata.remoteCwd).toBe(REMOTE_ROOT);
    expect(metadata).not.toHaveProperty("workspaceRealization");
  });
});
```

- [ ] **Step 2: Viết test adapter trước**

`packages/adapters/claude-local/src/server/execute.remote.crew.test.ts` (phần mock chép từ đầu `execute.remote.test.ts` của upstream, vì `vi.mock` phải nằm trong cùng file):

```ts
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunProcessResult } from "@paperclipai/adapter-utils/server-utils";

const {
  runChildProcess,
  ensureCommandResolvable,
  resolveCommandForLogs,
  prepareWorkspaceForSshExecution,
  restoreWorkspaceFromSshExecution,
  syncDirectoryToSsh,
  startAdapterExecutionTargetPaperclipBridge,
} = vi.hoisted(() => ({
  runChildProcess: vi.fn(async (_runId: string, _command: string, args: string[]): Promise<RunProcessResult> => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: args.includes("--version")
      ? "2.1.251 (Claude Code)\n"
      : [
          JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session-1", model: "claude-sonnet" }),
          JSON.stringify({ type: "assistant", session_id: "claude-session-1", message: { content: [{ type: "text", text: "hello" }] } }),
          JSON.stringify({ type: "result", session_id: "claude-session-1", result: "hello", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }),
        ].join("\n"),
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  })),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "ssh://fixture@127.0.0.1:2222/remote/workspace :: claude"),
  prepareWorkspaceForSshExecution: vi.fn(async () => ({ gitBacked: false })),
  restoreWorkspaceFromSshExecution: vi.fn(async () => undefined),
  syncDirectoryToSsh: vi.fn(async () => undefined),
  startAdapterExecutionTargetPaperclipBridge: vi.fn(async () => ({
    env: {
      PAPERCLIP_API_URL: "http://127.0.0.1:4310",
      PAPERCLIP_API_KEY: "bridge-token",
      PAPERCLIP_API_BRIDGE_MODE: "queue_v1",
    },
    stop: async () => {},
  })),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return { ...actual, ensureCommandResolvable, resolveCommandForLogs, runChildProcess };
});

vi.mock("@paperclipai/adapter-utils/ssh", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/ssh")>(
    "@paperclipai/adapter-utils/ssh",
  );
  return { ...actual, prepareWorkspaceForSshExecution, restoreWorkspaceFromSshExecution, syncDirectoryToSsh };
});

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return { ...actual, startAdapterExecutionTargetPaperclipBridge };
});

import { execute } from "./execute.js";
import { resetClaudeCliCapabilitiesCacheForTests } from "./cli-capabilities.js";

const IN_PLACE_ROOT = "/Users/agent/worktrees/a";

const inPlaceTarget = (remoteCwd: string) => ({
  kind: "remote" as const,
  transport: "ssh" as const,
  remoteCwd,
  workspaceRealization: {
    mode: "in_place" as const,
    authoritativeRoot: IN_PLACE_ROOT,
    pathAliases: [],
    outboundRestorePaths: [],
  },
  spec: {
    host: "127.0.0.1",
    port: 2222,
    username: "fixture",
    remoteWorkspacePath: remoteCwd,
    remoteCwd,
    privateKey: "PRIVATE KEY",
    knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
    strictHostKeyChecking: true,
  },
});

const agent = {
  id: "agent-1",
  companyId: "company-1",
  name: "Claude Coder",
  adapterType: "claude_local",
  adapterConfig: {},
};

describe("claude_local in_place on SSH (Crew)", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    resetClaudeCliCapabilitiesCacheForTests();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function workspace(prefix: string) {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    return workspaceDir;
  }

  it("runs in place at the authoritative root without workspace upload or restore", async () => {
    const workspaceDir = await workspace("crew-claude-in-place-");

    await execute({
      runId: "run-in-place",
      agent,
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { engine: "cli", command: "claude" },
      context: { paperclipWorkspace: { cwd: workspaceDir, source: "task_session" } },
      executionTarget: inPlaceTarget("/app"),
      onLog: async () => {},
    });

    expect(prepareWorkspaceForSshExecution).not.toHaveBeenCalled();
    expect(restoreWorkspaceFromSshExecution).not.toHaveBeenCalled();
    expect(syncDirectoryToSsh).toHaveBeenCalledWith(
      expect.objectContaining({ remoteDir: `${IN_PLACE_ROOT}/.paperclip-runtime/claude/skills` }),
    );
    expect(syncDirectoryToSsh).toHaveBeenCalledWith(
      expect.objectContaining({ remoteDir: `${IN_PLACE_ROOT}/.paperclip-runtime/claude/mcp-config` }),
    );
    const call = runChildProcess.mock.calls.find((entry) => !(entry[2] as string[]).includes("--version")) as unknown as
      | [string, string, string[], { env: Record<string, string>; remoteExecution?: { remoteCwd: string } | null }]
      | undefined;
    expect(call?.[3].remoteExecution?.remoteCwd).toBe(IN_PLACE_ROOT);
    expect(call?.[3].env.PAPERCLIP_WORKSPACE_CWD).toBe(IN_PLACE_ROOT);
  });
});
```

- [ ] **Step 3: Chạy cả hai test để thấy đỏ**

```bash
cd "$FORK"
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-ssh-in-place.test.ts
corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run src/server/execute.remote.crew.test.ts
```

Expected: server FAIL vì không nạp được `../crew/ssh-in-place.ts`. Adapter FAIL ở `expect(prepareWorkspaceForSshExecution).not.toHaveBeenCalled()`, vì upstream vẫn upload workspace.

- [ ] **Step 4: Tạo helper và sửa driver (P1)**

`server/src/crew/ssh-in-place.ts`:

```ts
import type { Environment } from "@paperclipai/shared";

/**
 * SSH lease metadata that opts the run into in-place realization. An SSH
 * environment whose metadata sets `workspaceRealizationMode: "in_place"` runs
 * the agent directly in its remote workspace path; anything else keeps copy.
 */
export function sshLeaseWorkspaceRealization(
  environment: Pick<Environment, "metadata">,
): { workspaceRealization?: { mode: "in_place" } } {
  const metadata = environment.metadata;
  const mode =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).workspaceRealizationMode
      : undefined;
  return mode === "in_place" ? { workspaceRealization: { mode: "in_place" } } : {};
}
```

Trong `server/src/services/environment-runtime.ts`, ở metadata của `acquireRunLease` thuộc `createSshEnvironmentDriver` (dòng 1199):

```ts
          remoteWorkspacePath: parsed.config.remoteWorkspacePath,
          remoteCwd,
          ...sshLeaseWorkspaceRealization(input.environment),
        },
```

Thêm dòng cuối file, ngay sau import của H3:

```ts
import { sshLeaseWorkspaceRealization } from "../crew/ssh-in-place.js";
```

- [ ] **Step 5: Sửa adapter (P2)**

Trong `packages/adapters/claude-local/src/server/execute.ts`, đổi đoạn từ `const preparedExecutionTargetRuntime = executionTargetIsRemote` (dòng 611) đến `workspaceLocalDir: cwd,` thành:

```ts
  const inPlaceRoot = executionTarget?.workspaceRealization?.mode === "in_place"
    ? executionTarget.workspaceRealization.authoritativeRoot
    : null;
  const preparedExecutionTargetRuntime = executionTargetIsRemote
    ? await (async () => {
        await onLog(
          "stdout",
          `[paperclip] Syncing ${inPlaceRoot ? "Claude runtime assets" : "workspace and Claude runtime assets"} to ${describeAdapterExecutionTarget(executionTarget)}.\n`,
        );
        return await prepareAdapterExecutionTargetRuntime({
          runId,
          target: executionTarget,
          adapterKey: "claude",
          timeoutSec,
          workspaceLocalDir: cwd,
          workspaceRemoteDir: inPlaceRoot ?? undefined,
          syncWorkspace: inPlaceRoot === null,
```

Phần còn lại của lời gọi (`installCommand: SANDBOX_INSTALL_COMMAND,` trở đi) giữ nguyên.

- [ ] **Step 6: Thêm P1 và P2 vào `core-hooks.json`**

Nối vào mảng `entries`:

```json
    {
      "id": "P1",
      "kind": "driver-patch",
      "file": "server/src/services/environment-runtime.ts",
      "symbol": "createSshEnvironmentDriver.acquireRunLease",
      "scope": "function createSshEnvironmentDriver(",
      "anchor": "          ...sshLeaseWorkspaceRealization(input.environment),",
      "importLine": "import { sshLeaseWorkspaceRealization } from \"../crew/ssh-in-place.js\";",
      "description": "SSH lease metadata opts the run into in_place realization when environment metadata sets workspaceRealizationMode to in_place.",
      "upstreamPr": null,
      "tests": ["server/src/__tests__/crew-ssh-in-place.test.ts"]
    },
    {
      "id": "P2",
      "kind": "adapter-patch",
      "file": "packages/adapters/claude-local/src/server/execute.ts",
      "symbol": "execute (inPlaceRoot)",
      "anchor": "  const inPlaceRoot = executionTarget?.workspaceRealization?.mode === \"in_place\"",
      "description": "claude_local runs in the authoritative root and skips workspace upload/restore for in_place realization, like codex_local.",
      "upstreamPr": null,
      "tests": ["packages/adapters/claude-local/src/server/execute.remote.crew.test.ts"]
    }
```

- [ ] **Step 7: Chạy test, kiểm mốc, typecheck**

```bash
cd "$FORK"
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-ssh-in-place.test.ts src/__tests__/crew-core-hooks.test.ts
corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run src/server/execute.remote.crew.test.ts src/server/execute.remote.test.ts
node crew/release/check-core-hooks.mjs; echo EXIT $?
corepack pnpm --filter @paperclipai/server exec tsc --noEmit; echo EXIT $?
corepack pnpm --filter @paperclipai/adapter-claude-local exec tsc --noEmit; echo EXIT $?
```

Expected: server PASS 9 test (5 + 4). Adapter PASS cả file Crew lẫn file của upstream (chứng minh không phá hành vi copy). Kiểm mốc in `Hook một dòng: 3/5; mục: 5; lỗi: 0` kèm 2 dòng `CẢNH BÁO P1/P2: chưa có PR upstream`. Hai lệnh tsc in `EXIT 0`.

- [ ] **Step 8: Commit**

```bash
cd "$FORK" && test "$(git rev-parse --show-toplevel)" = "$FORK" || exit 1
git add server/src/crew/ssh-in-place.ts server/src/__tests__/crew-ssh-in-place.test.ts \
  server/src/services/environment-runtime.ts packages/adapters/claude-local/src/server/execute.ts \
  packages/adapters/claude-local/src/server/execute.remote.crew.test.ts crew/release/core-hooks.json
git commit -m "feat(environments): run claude_local in place on SSH environments"
```

### Task 4: `sessionCodec` giữ `remoteExecution` (P3) và dòng log resume (P4)

Nguồn: `6ab1aa8c6` (codec) trên `spike/claude-in-place`, và `e849d304f` (log) trên `spike/upgrade-rehearsal`.

**Files:**
- Create: `packages/adapters/claude-local/src/server/session-codec.crew.test.ts`
- Modify: `packages/adapters/claude-local/src/server/execute.remote.crew.test.ts` (thêm 2 test)
- Modify: `packages/adapters/claude-local/src/server/index.ts:70-121`
- Modify: `packages/adapters/claude-local/src/server/execute.ts:812-816` (nhánh else-if thứ hai của log resume)
- Modify: `crew/release/core-hooks.json`

**Interfaces:**
- Consumes: `inPlaceTarget(remoteCwd: string)` và `agent` trong `execute.remote.crew.test.ts` (Task 3).
- Produces: `sessionCodec.serialize/deserialize` giữ trường `remoteExecution: Record<string, unknown>` khi nó là object, và bỏ trường này khi không phải object.

- [ ] **Step 1: Viết test codec trước**

`packages/adapters/claude-local/src/server/session-codec.crew.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sessionCodec } from "./index.js";

const remoteExecution = {
  transport: "ssh",
  host: "100.64.0.1",
  port: 2222,
  username: "agent",
  remoteCwd: "/Users/agent/worktrees/a",
};

describe("claude_local session codec (Crew)", () => {
  it("keeps the remote execution identity through serialize and deserialize", () => {
    const stored = sessionCodec.serialize({
      sessionId: "12345678-1234-4abc-9def-123456789012",
      cwd: "/paperclip/agent-home",
      remoteExecution,
    });
    expect(stored).toMatchObject({ remoteExecution });
    expect(sessionCodec.deserialize(stored)).toMatchObject({
      sessionId: "12345678-1234-4abc-9def-123456789012",
      remoteExecution,
    });
  });

  it("omits remote execution for local sessions and non-object values", () => {
    const stored = sessionCodec.serialize({ sessionId: "12345678-1234-4abc-9def-123456789012" });
    expect(stored).not.toHaveProperty("remoteExecution");
    expect(sessionCodec.deserialize({ sessionId: "s-1", remoteExecution: "not-an-object" })).not.toHaveProperty(
      "remoteExecution",
    );
    expect(sessionCodec.deserialize({ sessionId: "s-1", remoteExecution: [1] })).not.toHaveProperty("remoteExecution");
  });
});
```

- [ ] **Step 2: Viết test resume và test log trước**

Thêm vào `execute.remote.crew.test.ts`: dòng import `import { sessionCodec } from "./index.js";` ngay sau import `execute`, và hai test này trong `describe`, sau test `in_place`:

```ts
  async function runResumed(workspaceDir: string, logs: string[]) {
    const sessionId = "12345678-1234-4abc-9def-123456789012";
    const stored = sessionCodec.serialize({
      sessionId,
      cwd: workspaceDir,
      remoteExecution: {
        transport: "ssh",
        host: "127.0.0.1",
        port: 2222,
        username: "fixture",
        remoteCwd: IN_PLACE_ROOT,
      },
    });
    await execute({
      runId: "run-in-place-resume",
      agent,
      runtime: {
        sessionId,
        sessionParams: sessionCodec.deserialize(stored),
        sessionDisplayId: sessionId,
        taskKey: null,
      },
      config: { engine: "cli", command: "claude" },
      context: { paperclipWorkspace: { cwd: workspaceDir, source: "task_session" } },
      executionTarget: inPlaceTarget(IN_PLACE_ROOT),
      onLog: async (_stream: string, chunk: string) => {
        logs.push(chunk);
      },
    });
    return sessionId;
  }

  it("resumes an in-place SSH session whose params went through the session codec", async () => {
    const workspaceDir = await workspace("crew-claude-in-place-resume-");
    const sessionId = await runResumed(workspaceDir, []);
    const call = runChildProcess.mock.calls.find((entry) => !(entry[2] as string[]).includes("--version")) as unknown as
      | [string, string, string[]]
      | undefined;
    expect(call?.[2]).toEqual(expect.arrayContaining(["--resume", sessionId]));
  });

  it("does not log a fresh-session notice when the session is resumed", async () => {
    const workspaceDir = await workspace("crew-claude-in-place-resume-log-");
    const logs: string[] = [];
    await runResumed(workspaceDir, logs);
    expect(logs.join("")).not.toContain("will not be resumed");
  });
```

- [ ] **Step 3: Chạy để thấy đỏ**

Run: `cd "$FORK" && corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run src/server/session-codec.crew.test.ts src/server/execute.remote.crew.test.ts`
Expected: FAIL 3 test. Codec test đầu thiếu `remoteExecution`. Test resume thiếu `--resume`. Test log thấy chữ `will not be resumed`.

- [ ] **Step 4: Sửa codec (P3)**

Trong `packages/adapters/claude-local/src/server/index.ts`, thêm sau hàm `readNonEmptyString`:

```ts
function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
```

Trong `deserialize`, thêm sau dòng `const repoRef = ... record.repo_ref);`:

```ts
    const remoteExecution = readRecord(record.remoteExecution);
```

Trong `serialize`, thêm sau dòng `const repoRef = ... params.repo_ref);`:

```ts
    const remoteExecution = readRecord(params.remoteExecution);
```

Trong cả hai object trả về, thêm sau `...(repoRef ? { repoRef } : {}),`:

```ts
      ...(remoteExecution ? { remoteExecution } : {}),
```

- [ ] **Step 5: Chạy lại, thấy còn đúng test log đỏ**

Run: lệnh ở Step 3.
Expected: 2 test codec và test resume PASS. Chỉ còn `does not log a fresh-session notice when the session is resumed` FAIL.

- [ ] **Step 6: Sửa điều kiện log (P4)**

Trong `packages/adapters/claude-local/src/server/execute.ts`, nhánh `else if` thứ hai sau `if (executionTargetIsRemote && runtimeSessionId && isValidUuid && !canResumeSession)`:

```ts
  } else if (
    !canResumeSession &&
    runtimeSessionId &&
    isValidUuid &&
    runtimeSessionCwd.length > 0 &&
    path.resolve(runtimeSessionCwd) !== path.resolve(effectiveExecutionCwd)
  ) {
```

- [ ] **Step 7: Thêm P3, P4 vào `core-hooks.json`**

```json
    {
      "id": "P3",
      "kind": "adapter-patch",
      "file": "packages/adapters/claude-local/src/server/index.ts",
      "symbol": "sessionCodec.serialize/deserialize",
      "anchor": "      ...(remoteExecution ? { remoteExecution } : {}),",
      "occurrences": 2,
      "description": "Session codec keeps remoteExecution so SSH runs can resume their Claude session.",
      "upstreamPr": null,
      "tests": [
        "packages/adapters/claude-local/src/server/session-codec.crew.test.ts",
        "packages/adapters/claude-local/src/server/execute.remote.crew.test.ts"
      ]
    },
    {
      "id": "P4",
      "kind": "adapter-patch",
      "file": "packages/adapters/claude-local/src/server/execute.ts",
      "symbol": "execute (session resume log)",
      "anchor": "  } else if (\n    !canResumeSession &&\n    runtimeSessionId &&\n    isValidUuid &&\n    runtimeSessionCwd.length > 0 &&",
      "description": "Do not log the cwd mismatch / fresh session notice when the session is actually resumed.",
      "upstreamPr": null,
      "tests": ["packages/adapters/claude-local/src/server/execute.remote.crew.test.ts"]
    }
```

- [ ] **Step 8: Chạy test, kiểm mốc, typecheck**

```bash
cd "$FORK"
corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run src/server/session-codec.crew.test.ts src/server/execute.remote.crew.test.ts src/server/execute.remote.test.ts
node crew/release/check-core-hooks.mjs; echo EXIT $?
node --test crew/release/check-core-hooks.test.mjs
corepack pnpm --filter @paperclipai/adapter-claude-local exec tsc --noEmit; echo EXIT $?
```

Expected: vitest PASS cả 3 file. Kiểm mốc in `Hook một dòng: 3/5; mục: 7; lỗi: 0` kèm 4 cảnh báo PR. `node --test` báo `# fail 0`. tsc in `EXIT 0`.

- [ ] **Step 9: Commit**

```bash
cd "$FORK" && test "$(git rev-parse --show-toplevel)" = "$FORK" || exit 1
git add packages/adapters/claude-local/src/server/index.ts packages/adapters/claude-local/src/server/execute.ts \
  packages/adapters/claude-local/src/server/session-codec.crew.test.ts \
  packages/adapters/claude-local/src/server/execute.remote.crew.test.ts crew/release/core-hooks.json
git commit -m "fix(claude-local): keep the remote execution identity in session params and log resume correctly"
```

### Task 5: Plugin Crew rỗng

**Files:**
- Create: `packages/crew-plugin/package.json`, `packages/crew-plugin/tsconfig.json`, `packages/crew-plugin/src/manifest.ts`, `packages/crew-plugin/src/worker.ts` (tạo bằng công cụ ghi file, vì có chữ `dist`)
- Create: `server/src/__tests__/crew-plugin-manifest.test.ts`
- Modify: `pnpm-lock.yaml` (chỉ importer `packages/crew-plugin`)

**Interfaces:**
- Consumes: `pluginManifestV1Schema` từ `@paperclipai/shared`; `definePlugin`, `runWorker`, `PaperclipPluginManifestV1` từ `@paperclipai/plugin-sdk`.
- Produces: package `@crew/paperclip-plugin`, manifest `id: "crew.core"`, `apiVersion: 1`. Các ticket sau thêm capability và handler vào đây.

- [ ] **Step 1: Viết test trước**

`server/src/__tests__/crew-plugin-manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import manifest from "../../../packages/crew-plugin/src/manifest.ts";

describe("manifest plugin Crew", () => {
  it("hợp lệ theo pluginManifestV1Schema của host", () => {
    const result = pluginManifestV1Schema.safeParse(manifest);
    expect(result.success, JSON.stringify(result.error?.issues ?? [])).toBe(true);
    expect(manifest.id).toBe("crew.core");
    expect(manifest.entrypoints.worker).toBe("./dist/worker.js");
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `cd "$FORK" && corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-plugin-manifest.test.ts`
Expected: FAIL, không nạp được `../../../packages/crew-plugin/src/manifest.ts`.

- [ ] **Step 3: Tạo package**

`packages/crew-plugin/package.json`:

```json
{
  "name": "@crew/paperclip-plugin",
  "version": "0.0.0",
  "description": "Crew plugin for Paperclip",
  "type": "module",
  "private": true,
  "paperclipPlugin": {
    "manifest": "./dist/manifest.js",
    "worker": "./dist/worker.js"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@paperclipai/plugin-sdk": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^7.0.2"
  }
}
```

`packages/crew-plugin/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/crew-plugin/src/manifest.ts`:

```ts
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "crew.core",
  apiVersion: 1,
  version: "0.0.0",
  displayName: "Crew",
  description: "Crew plugin for Paperclip.",
  author: "2P Crew",
  categories: ["automation"],
  capabilities: ["issues.read"],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
```

`packages/crew-plugin/src/worker.ts`:

```ts
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup() {},
});

export default plugin;
runWorker(plugin, import.meta.url);
```

`capabilities` phải có ít nhất 1 phần tử (`pluginManifestV1Schema`), và `issues.read` là quyền nhỏ nhất ở mức chỉ đọc. Các ticket RT sẽ thêm `events.subscribe`, `issues.update` và `issue.comments.create` vào manifest `crew.core` khi cần (theo `runtime.md`). RL-1 không thêm trước.

- [ ] **Step 4: Cài để thêm importer, giữ lockfile gọn**

```bash
cd "$FORK" && corepack pnpm install
git diff --stat pnpm-lock.yaml
```

Expected: chỉ có khối `packages/crew-plugin:` (khoảng +13 dòng). Nếu có thêm hunk khác (lần diễn tập gặp pnpm xóa dòng `cpu: [arm64, x64]` của `opencode-ai@1.18.34`), chỉ giữ hunk đầu:

```bash
cd "$FORK" && git diff pnpm-lock.yaml > /private/tmp/crew-lock.patch
python3 - /private/tmp/crew-lock.patch <<'EOF'
import re, sys
text = open(sys.argv[1]).read()
parts = re.split(r'(?m)^(?=@@ )', text)
keep = [p for p in parts[1:] if "packages/crew-plugin:" in p]
open(sys.argv[1], "w").write(parts[0] + "".join(keep))
EOF
git checkout pnpm-lock.yaml && git apply /private/tmp/crew-lock.patch && rm /private/tmp/crew-lock.patch
git diff --stat pnpm-lock.yaml   # Expected: 1 file changed, 13 insertions(+)
```

- [ ] **Step 5: Chạy test và typecheck**

```bash
cd "$FORK"
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-plugin-manifest.test.ts src/adapters/plugin-loader.test.ts
corepack pnpm --filter @crew/paperclip-plugin exec tsc --noEmit; echo EXIT $?
```

Expected: PASS 2 file; `EXIT 0`.

- [ ] **Step 6: Commit**

```bash
cd "$FORK" && test "$(git rev-parse --show-toplevel)" = "$FORK" || exit 1
git add packages/crew-plugin server/src/__tests__/crew-plugin-manifest.test.ts pnpm-lock.yaml
git commit -m "feat(crew): add an empty Crew plugin package"
```

---

## RL-2

### Task 6: `verify.sh` và `upgrade.sh`

**Files:**
- Create: `crew/release/verify.sh`
- Create: `crew/release/upgrade.sh`
- Create: `crew/release/upgrade.test.mjs`

**Interfaces:**
- Consumes: `node crew/release/check-core-hooks.mjs` (Task 2), các file test của Crew (Task 1, 3, 4, 5), remote `upstream` của fork.
- Produces:
  - `crew/release/upgrade.sh <tag-hoặc-ref-upstream> [--base <nhánh>] [--worktree <thư-mục>] [--cleanup]`. Tạo nhánh `sync/paperclip-<nhãn>` trên worktree riêng, mặc định ở `${TMPDIR:-/tmp}/crew-upgrade/<nhãn>`. Nhãn là ref đã bỏ `refs/` và đổi ký tự lạ thành `-`.
  - `crew/release/verify.sh`, chạy từ gốc một worktree.
  - Mã thoát dùng chung: 0 xanh, 2 conflict cần giải tay, 3 kiểm mốc đỏ, 4 cài/build đỏ, 5 test đỏ, 6 typecheck đỏ, 64 sai cách dùng, 65 ref không tồn tại, 66 worktree hoặc nhánh đã tồn tại, 70 sai thư mục.
  - Biến `CREW_UPGRADE_SKIP_FETCH=1` bỏ bước fetch, chỉ dùng cho test.

- [ ] **Step 1: Viết test trước**

`crew/release/upgrade.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const upgrade = path.join(here, "upgrade.sh");
const verify = path.join(here, "verify.sh");
const env = { ...process.env, CREW_UPGRADE_SKIP_FETCH: "1" };

test("không có ref thì in cách dùng và thoát 64", () => {
  const result = spawnSync("bash", [upgrade], { env, encoding: "utf8" });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /Cách dùng/);
});

test("ref không tồn tại thì thoát 65", () => {
  const result = spawnSync("bash", [upgrade, "refs/tags/crew-khong-co-tag-nay"], { env, encoding: "utf8" });
  assert.equal(result.status, 65);
  assert.match(result.stderr, /Không tìm thấy ref/);
});

test("worktree đã tồn tại thì thoát 66 và không tạo nhánh", () => {
  const existing = mkdtempSync(path.join(tmpdir(), "crew-upgrade-exists-"));
  const result = spawnSync("bash", [upgrade, "HEAD", "--worktree", existing], { env, encoding: "utf8" });
  assert.equal(result.status, 66);
  const branch = spawnSync("git", ["-C", here, "show-ref", "--verify", "--quiet", "refs/heads/sync/paperclip-HEAD"]);
  assert.notEqual(branch.status, 0);
});

test("verify.sh từ chối chạy ngoài gốc worktree", () => {
  const result = spawnSync("bash", [verify], { cwd: here, encoding: "utf8" });
  assert.equal(result.status, 70);
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `cd "$FORK" && node --test crew/release/upgrade.test.mjs`
Expected: FAIL 4 test. `bash` báo `No such file or directory` và thoát 127.

- [ ] **Step 3: Viết `verify.sh`**

`crew/release/verify.sh`:

```bash
#!/usr/bin/env bash
# Verify a merged Paperclip fork tree: hook anchors, build prerequisites, Crew patch tests, typecheck.
# Stops at the first red step. Run from the root of the worktree. No cargo needed.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ] || [ "$ROOT" != "$(pwd -P)" ]; then
  echo "Chạy verify.sh từ gốc worktree (đang ở $(pwd -P))" >&2
  exit 70
fi

run() {
  local code="$1"
  shift
  echo "== $*"
  if ! "$@"; then
    echo "ĐỎ (mã $code): $*" >&2
    exit "$code"
  fi
}

run 3 node crew/release/check-core-hooks.mjs
run 3 node --test crew/release/check-core-hooks.test.mjs
run 4 corepack pnpm install
run 4 corepack pnpm --filter @paperclipai/plugin-sdk ensure-build-deps
run 4 corepack pnpm --filter @paperclipai/paperclip-runner run build:typescript
run 5 corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew- src/adapters/plugin-loader.test.ts
run 5 corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run src/server/execute.remote.crew.test.ts src/server/session-codec.crew.test.ts src/server/execute.remote.test.ts
run 6 corepack pnpm --filter @paperclipai/server exec tsc --noEmit
run 6 corepack pnpm --filter @paperclipai/adapter-claude-local exec tsc --noEmit
run 6 corepack pnpm --filter @crew/paperclip-plugin exec tsc --noEmit
echo "XANH: mốc hook đủ, test vá và typecheck đạt"
```

- [ ] **Step 4: Viết `upgrade.sh`**

`crew/release/upgrade.sh`:

```bash
#!/usr/bin/env bash
# Merge an upstream Paperclip tag or ref into a throwaway sync branch on its own worktree,
# then run verify.sh. Never touches the base branch and never pushes.
set -euo pipefail

usage() {
  echo "Cách dùng: crew/release/upgrade.sh <tag-hoặc-ref-upstream> [--base <nhánh>] [--worktree <thư-mục>] [--cleanup]" >&2
  exit 64
}

REF=""
BASE="v3"
WT=""
CLEANUP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base) [ $# -ge 2 ] || usage; BASE="$2"; shift 2 ;;
    --worktree) [ $# -ge 2 ] || usage; WT="$2"; shift 2 ;;
    --cleanup) CLEANUP=1; shift ;;
    -*) usage ;;
    *) [ -z "$REF" ] || usage; REF="$1"; shift ;;
  esac
done
[ -n "$REF" ] || usage

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
LABEL="$(printf '%s' "$REF" | sed 's#^refs/##; s#[^A-Za-z0-9._-]#-#g')"
BRANCH="sync/paperclip-$LABEL"
WT="${WT:-${TMPDIR:-/tmp}/crew-upgrade/$LABEL}"

if [ "${CREW_UPGRADE_SKIP_FETCH:-0}" != "1" ]; then
  git -C "$REPO" fetch upstream --tags
fi
if ! TARGET="$(git -C "$REPO" rev-parse --verify --quiet "$REF^{commit}")"; then
  echo "Không tìm thấy ref: $REF" >&2
  exit 65
fi
if [ -e "$WT" ]; then
  echo "Thư mục worktree đã tồn tại: $WT" >&2
  exit 66
fi
if git -C "$REPO" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "Nhánh đã tồn tại: $BRANCH" >&2
  exit 66
fi

mkdir -p "$(dirname "$WT")"
git -C "$REPO" worktree add -b "$BRANCH" "$WT" "$BASE"
WT="$(cd "$WT" && pwd -P)"
check_toplevel() {
  if [ "$(git -C "$WT" rev-parse --show-toplevel)" != "$WT" ]; then
    echo "Sai worktree: $WT" >&2
    exit 70
  fi
}

check_toplevel
echo "== Merge $REF ($TARGET) vào $BRANCH (từ $BASE), worktree $WT"
if ! git -C "$WT" merge --no-ff -m "chore(sync): merge Paperclip $REF into $BASE" "$TARGET"; then
  CONFLICTS="$(git -C "$WT" diff --name-only --diff-filter=U)"
  if [ "$CONFLICTS" = "pnpm-lock.yaml" ]; then
    echo "Chỉ pnpm-lock.yaml conflict: lấy bản upstream, verify.sh sẽ cài lại importer của Crew"
    check_toplevel
    git -C "$WT" checkout --theirs pnpm-lock.yaml
    git -C "$WT" add pnpm-lock.yaml
    git -C "$WT" commit --no-edit
  else
    echo "Conflict (file: số hunk):" >&2
    while IFS= read -r file; do
      printf '  %s: %s\n' "$file" "$(grep -c '^<<<<<<< ' "$WT/$file" || true)" >&2
    done <<< "$CONFLICTS"
    echo "Giải conflict trong $WT, commit, rồi chạy: (cd $WT && bash crew/release/verify.sh)" >&2
    exit 2
  fi
fi

check_toplevel
(cd "$WT" && bash crew/release/verify.sh)
echo "XANH: $BRANCH tại $(git -C "$WT" rev-parse --short HEAD)"
git -C "$WT" status --short
if [ "$CLEANUP" = "1" ]; then
  git -C "$REPO" worktree remove --force "$WT"
  echo "Đã gỡ worktree, giữ nhánh $BRANCH"
fi
```

Rồi `chmod +x crew/release/verify.sh crew/release/upgrade.sh`.

- [ ] **Step 5: Chạy test để thấy xanh**

Run: `cd "$FORK" && node --test crew/release/upgrade.test.mjs crew/release/check-core-hooks.test.mjs`
Expected: `# pass 13`, `# fail 0`.

- [ ] **Step 6: Chạy `verify.sh` trên chính `v3`**

Run: `cd "$FORK" && bash crew/release/verify.sh; echo EXIT $?`
Expected: dòng cuối `XANH: mốc hook đủ, test vá và typecheck đạt`, rồi `EXIT 0`. Sau đó `git status --short` chỉ còn `?? .crew-setup/`. Nếu `pnpm-lock.yaml` bị sửa lại thì làm lại Step 4 của Task 5.

- [ ] **Step 7: Commit**

```bash
cd "$FORK" && test "$(git rev-parse --show-toplevel)" = "$FORK" || exit 1
git add crew/release/verify.sh crew/release/upgrade.sh crew/release/upgrade.test.mjs
git commit -m "feat(crew): add the upstream upgrade and verify scripts"
```

### Task 7: Chạy thử `upgrade.sh` trên `upstream/master`

**Files:**
- Create (repo Crew, không commit): `plans/261006-1355-crew-v3-r1-1/release-report.md`

**Interfaces:**
- Consumes: `crew/release/upgrade.sh` (Task 6).
- Produces: nhánh cục bộ `sync/paperclip-upstream-master` làm bằng chứng, và báo cáo kết quả cho AC-1.

- [ ] **Step 1: Kiểm máy và chạy**

```bash
memory_pressure | tail -1   # Dừng nếu free < 25%
cd "$FORK" && test "$(git rev-parse --show-toplevel)" = "$FORK" || exit 1
WT=/private/tmp/claude-501/crew-upgrade/upstream-master
date '+%H:%M:%S'; bash crew/release/upgrade.sh upstream/master --worktree "$WT"; echo EXIT $?; date '+%H:%M:%S'
```

Expected: `EXIT 0` và không có conflict, vì test của Crew đã nằm ở file riêng. Nếu `EXIT 2`, ghi danh sách file và số hunk, giải trong `$WT`, commit, rồi chạy `(cd "$WT" && bash crew/release/verify.sh)` tới khi thoát 0. Ghi thời gian giải.

- [ ] **Step 2: Gỡ worktree và kiểm `v3` không đổi**

```bash
cd "$FORK" && git worktree remove --force /private/tmp/claude-501/crew-upgrade/upstream-master
git -C "$FORK" rev-parse --abbrev-ref HEAD                # Expected: v3
git -C "$FORK" log --oneline backup/v3-before-rl1..v3      # Expected: đúng 6 commit của Task 1–6
git -C "$FORK" branch --list 'sync/*'                       # Expected: sync/paperclip-upstream-master
```

- [ ] **Step 3: Ghi `release-report.md`**

Ghi trong repo Crew, không commit: SHA `upstream/master` đã merge, đầu ra của `check-core-hooks.mjs` (số hook, số mục, cảnh báo), mã thoát và thời gian từng bước, conflict (nếu có) kèm cách giải, SHA 6 commit trên `v3` và SHA nhánh `sync/paperclip-upstream-master`.

---

## Rủi ro và rollback

| Rủi ro | Cách giảm | Rollback |
|---|---|---|
| Upstream đổi chữ ký `claimQueuedRun`, `runUpdate` hoặc `releaseRunLease`, nên hook vẫn merge sạch nhưng sai chỗ hoặc thiếu biến | Kiểm mốc (`head`, `scope`, lệnh đầu tiên) và `tsc` trong `verify.sh` | Không merge nhánh `sync/*`; sửa anchor/hook trên nhánh đó rồi chạy lại `verify.sh` |
| Upstream thêm đường ghi issue hoặc đường claim không đi qua H1/H2 | Ngoài phạm vi kiểm mốc; mỗi lần nâng phải đọc diff `heartbeat.ts`/`issues.ts` quanh `claim` và `update` | Như trên |
| Vòng import giữa file lõi và `server/src/crew/` khi RT-1/RT-2 điền implementation | Module implementation không import `core-hooks.ts`; `core-hooks.ts` chỉ import type từ services | Bỏ import implementation trong `core-hooks.ts`, quay về no-op |
| `pnpm install` đổi lockfile ngoài importer Crew | Bước lọc hunk ở Task 5; `upgrade.sh` lấy lockfile của upstream khi chỉ lockfile conflict | `git checkout pnpm-lock.yaml` |
| `verify.sh` tốn RAM khi chạy song song với phiên khác (máy 24 GB) | Kiểm `memory_pressure` trước Task 0 và Task 7; vitest server chạy `maxWorkers: 1` | Dừng, chạy lại khi máy rảnh |

Rollback toàn bộ RL-1/RL-2 (chỉ cục bộ, chưa push): `git -C "$FORK" switch v3 && git -C "$FORK" reset --hard backup/v3-before-rl1`. Lệnh này cần owner đồng ý vì xóa commit. Nhánh `sync/*` bỏ được bằng `git branch -D`.

## Đề nghị sửa khung (đã xử lý)

Trợ Lý đã đối chiếu với `runtime.md` và xử lý các mục dưới đây (06/10/2026). Thay đổi đi kèm: H3 nhận thêm `db` (`RunLeaseReleasedInput = EnvironmentDriverReleaseInput & { db: Db }`, dòng hook `await crewCoreHooks.onRunLeaseReleased({ db, ...input });`), và manifest `crew.core` sẽ được các ticket RT thêm capability.

1. Đã xử lý. **Đường dẫn registry giữ `server/src/crew/core-hooks.ts`.** Ngoài ra có thêm `server/src/crew/ssh-in-place.ts`: helper của vá metadata `in_place` được dời ra khỏi `workspace-realization.ts` (file lõi), nên file lõi chỉ còn 1 dòng spread và 1 import. Test server của Crew nằm ở `server/src/__tests__/crew-*.test.ts`, không nằm trong `server/src/crew/`, vì `tsc` của server loại `__tests__`; nếu không thì phần mock phải viết lại cho đủ kiểu strict.
2. Đã xử lý. **Cách điền hook (RT-1, RT-2):** sửa object `implementations` trong `core-hooks.ts` để trỏ tới module ở `server/src/crew/`. Plugin Crew không đăng ký được hook, vì plugin chạy trong worker process riêng. Khung đang ghi "RL-1 tạo, RT-1/RT-2 điền", vẫn đúng, nhưng nên ghi rõ là "điền trong `server/src/crew/`, không trong plugin". Image overlay của RT-4 phải gồm cả thư mục này.
3. Đã xử lý. **H2 chưa có ticket implementation trong R1-1.** RL-1 chỉ tạo hook no-op. Logic chặn `done` khi thiếu stage và chặn agent sửa `executionPolicy` (kết luận S4) cần một ticket, hoặc ghi rõ là để sang R1-2.
4. Đã xử lý. **"Có PR upstream tương ứng"** chưa làm được trong RL-1 vì không push khi chưa có approval. `upstreamPr` để `null`, và kiểm mốc chỉ cảnh báo. Nên thêm một việc của owner: duyệt mở PR cho P3, P4 (sửa bug thuần) và P1 cùng P2 (tính năng `in_place` cho SSH).
5. Đã xử lý. **Tên mã vá:** khung nói chung chung là "vá adapter/driver". Plan này đặt tên P1 (metadata `in_place` của SSH driver), P2 (`claude_local` `in_place`), P3 (`sessionCodec`), P4 (log resume). `runtime.md` và AC-1 nên dùng cùng tên.
6. Đã xử lý. **RL-2 sinh hai script** (`upgrade.sh` và `verify.sh`). Bảng ticket nên ghi cả hai. Mục nghiệm thu AC-1 "upgrade.sh chạy trên upstream/master" tương ứng Task 7.
7. Đã xử lý. **"Plugin Crew vẫn load" trên server thật** chưa được kiểm trong RL-1. Test chỉ kiểm manifest hợp lệ theo schema của host. Việc cài plugin vào server và thấy nó `ready` nên thuộc RT-4.

## Self-review

- **Phủ yêu cầu:** registry và ba hook (Task 1); `core-hooks.json` có schema và test kiểm mốc (Task 2); port P1–P4 với test ở file riêng (Task 3, 4); plugin rỗng (Task 5); `upgrade.sh` và `verify.sh` có test đường lỗi (Task 6), chạy thử trên `upstream/master` (Task 7); lệnh chạy không cần cargo (Task 0, `verify.sh`); có mục rủi ro/rollback.
- **Placeholder:** không có TBD/TODO. Mọi bước sửa code đều có đoạn code đầy đủ.
- **Nhất quán tên:** `crewCoreHooks`, `overrideCrewCoreHooksForTests`, `sshLeaseWorkspaceRealization`, `checkCoreHooks`, `HOOK_BUDGET`, `inPlaceTarget`, `IN_PLACE_ROOT` dùng giống nhau ở mọi task. Anchor trong JSON khớp đúng dòng code của Task 1, 3 và 4, kể cả thụt lề.
- **Review Focus:** mục 1, 4, 5 có test ở Task 2; mục 2 có test ở Task 1; mục 3 có test ở Task 6.
