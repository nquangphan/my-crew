# Crew v3 R2-1: gói `mac-cli` (MC-1…MC-4), kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@crew/mac` dùng được như thư viện trong app, biết chế độ `sshdOwner: "app" | "launchd"` (chuyển qua lại không để hai chủ cổng 2222), `doctor` kiểm đúng chủ sshd và quan hệ TCC, bản tin máy báo phiên bản app, và app cài được bản `crew-mac` nó mang theo. CLI vẫn chạy độc lập như hôm nay.

**Architecture:** Giữ nguyên cấu trúc `apps/crew-mac` (mọi lệnh hệ thống qua `CommandRunner`, test bằng runner giả và HOME giả trong `test/helpers/{fake-mac,fake-runner}.ts`). Thêm `src/index.ts` làm entry thư viện, `src/context-factory.ts` (tách `defaultContext` khỏi `cli.ts`), `src/sshd-owner.ts` (chuyển chủ), `src/status/app-state.ts` (đọc `app.json`), `src/install-cli.ts` (cài bản mang theo). Manifest giữ `version: 1`, thêm trường tùy chọn.

**Tech Stack:** Node ≥ 22 ESM, TypeScript 7 (NodeNext, strict), Vitest 5, Biome 2.5 (2 dấu cách, nháy đơn, dòng 110 ký tự).

**Spec:** [plan.md](plan.md) (Global Constraints, Review Focus 2, Interface I1, I2, I3, I8) và spec §5 (check `tcc-owner`), §7, §9 "Báo phiên bản lên web".

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng gói này:

- Không đổi hành vi CLI hiện có khi không truyền cờ mới: `setup`, `doctor`, `uninstall`, `status`, `reap`, `stop-run` cho cùng đầu vào ra cùng kết quả (test cũ giữ nguyên, không sửa kỳ vọng cũ).
- Đổi chủ sshd (cả hai chiều) từ chối khi còn run đang chạy, và khi lệnh đang chạy qua chính sshd agent (`SSH_CONNECTION` trỏ cổng agent), trừ khi có `--force`. Dùng lại `assertNoLiveRuns`/kiểm `SSH_CONNECTION` sẵn có của `uninstall`.
- Chỉ TERM listener khớp pidfile `~/.crew-mac/sshd/sshd.pid` và argv có `-f ~/.crew-mac/sshd/sshd_config`. Không bao giờ gửi tín hiệu cho `sshd-session`.
- Không ghi file nào trong `~/Library/Application Support/2P Crew/` (của app). `crew-mac` chỉ đọc `app.json`.
- Test chạy trên HOME giả; không test nào gọi `launchctl` thật.

---

## Cấu trúc file

| Path | Trách nhiệm |
|---|---|
| `apps/crew-mac/src/index.ts` | Entry thư viện, export đúng danh sách I1 |
| `apps/crew-mac/src/context-factory.ts` | `createMacContext`, `stableNodePath` (chuyển từ `cli.ts`) |
| `apps/crew-mac/src/sshd-owner.ts` | `SshdOwner`, `resolveSshdOwner`, `handOffToApp`, `takeBackToLaunchd` |
| `apps/crew-mac/src/manifest.ts` | Thêm `sshdOwner?` |
| `apps/crew-mac/src/commands/{setup,doctor,uninstall}.ts` | Dùng `sshd-owner.ts`; check `sshd-agent` theo chế độ, check `tcc-owner` |
| `apps/crew-mac/src/status/app-state.ts` | `readAppState(path)` |
| `apps/crew-mac/src/status/report.ts` | `MachineReport.app?` |
| `apps/crew-mac/src/install-cli.ts` | `installCrewMacFrom` |

---

### Task 1 (MC-1): `@crew/mac` thành thư viện

**Files:**
- Create: `apps/crew-mac/src/index.ts`, `apps/crew-mac/src/context-factory.ts`, `apps/crew-mac/test/index.test.ts`
- Modify: `apps/crew-mac/package.json`, `apps/crew-mac/tsconfig.build.json`, `apps/crew-mac/src/cli.ts:108-128` (bỏ `stableNodePath`, `defaultContext`, gọi `createMacContext`), `docs/flows.yaml` (khối `mac-setup` thêm 2 file), `docs/flows/mac-setup.md`

**Interfaces:**
- Produces: I1 (đủ tên trong plan.md, trừ `installCrewMacFrom` do Task 4 và `readAppState` do Task 3 thêm dòng export).

- [ ] **Step 1: Test export**

```ts
import { describe, expect, it } from 'vitest';
import * as lib from '../src/index.js';

describe('@crew/mac thư viện', () => {
  it('export đủ hàm app cần', () => {
    for (const name of ['setup', 'doctor', 'uninstall', 'scanUninstallBlockers', 'configureStatus', 'setStatusSecret',
      'addStatusRepo', 'removeStatusRepo', 'listStatusRepos', 'readStatusConfig', 'sendStatus', 'stopRun',
      'listProcesses', 'readCwds', 'isClaudePrint', 'readManifest', 'macPaths', 'forbiddenRootReason',
      'createMacContext', 'workflowCheck', 'SetupError']) {
      expect(typeof (lib as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(lib.SSHD_LABEL).toBe('com.2p.crew-mac-sshd');
    expect(lib.DEFAULT_PORT).toBe(2222);
  });
  it('createMacContext dùng cliPath được truyền, không dùng đường dẫn của chính module', () => {
    const ctx = lib.createMacContext({ env: { HOME: '/tmp/h', USER: 'u' }, out: () => {}, cliPath: '/tmp/h/.crew/app/crew-mac/dist/cli.js' });
    expect(ctx.cliPath).toBe('/tmp/h/.crew/app/crew-mac/dist/cli.js');
    expect(ctx.home).toBe('/tmp/h');
  });
});
```

Run: `pnpm --filter @crew/mac exec vitest run test/index.test.ts` → FAIL.

- [ ] **Step 2: Cài.** `context-factory.ts` chứa nguyên thân `stableNodePath` và `defaultContext` hiện ở `cli.ts:108-128`, đổi chữ ký thành `createMacContext(input: { env: NodeJS.ProcessEnv; out: (line: string) => void; cliPath: string; nodePath?: string }): MacContext`. `cli.ts` gọi `createMacContext({ env: io.env, out: io.out, cliPath: realpathSync(fileURLToPath(import.meta.url)) })`. `index.ts`:

```ts
export { setup, type SetupOptions, type SetupReport } from './commands/setup.js';
export { doctor, type CheckResult, type CheckStatus, type DoctorOptions } from './commands/doctor.js';
export { uninstall, scanUninstallBlockers } from './commands/uninstall.js';
export {
  configureStatus, setStatusSecret, addStatusRepo, removeStatusRepo, listStatusRepos, readStatusConfig, sendStatus,
  type StatusConfig, type StatusRepo,
} from './commands/status.js';
export { stopRun } from './commands/stop-run.js';
export { workflowCheck, type WorkflowReport } from './commands/workflow-check.js';
export { listProcesses, readCwds, type ProcInfo } from './reaper/process-table.js';
export { isClaudePrint } from './reaper/select.js';
export { readManifest, type Manifest } from './manifest.js';
export { macPaths, forbiddenRootReason, SSHD_LABEL, DEFAULT_PORT, type MacPaths } from './paths.js';
export { SetupError, type MacContext } from './context.js';
export { createMacContext } from './context-factory.js';
```

  `package.json` thêm `"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`; `tsconfig.build.json` thêm `"declaration": true`.

- [ ] **Step 3: Kiểm.** Run: `pnpm --filter @crew/mac exec vitest run && pnpm --filter @crew/mac typecheck && pnpm --filter @crew/mac build && ls apps/crew-mac/dist/index.d.ts` → toàn bộ test cũ PASS (CLI không đổi), có `index.d.ts`.
- [ ] **Step 4: Docs + commit.** `flows.yaml` khối `mac-setup` thêm `apps/crew-mac/src/index.ts`, `apps/crew-mac/src/context-factory.ts` vào `files`, `apps/crew-mac/test/index.test.ts` vào `tests`; `mac-setup.md` mục Files + câu "app 2P Crew import `@crew/mac`". `crew-docs generate`.

```bash
git add apps/crew-mac docs/flows.yaml docs/flows/mac-setup.md docs/files.md
git commit -m "feat(crew-mac): xuất @crew/mac làm thư viện cho app macOS"
```

---

### Task 2 (MC-2): Chế độ `sshdOwner`, `doctor` theo chủ sshd, `tcc-owner`

**Files:**
- Create: `apps/crew-mac/src/sshd-owner.ts`, `apps/crew-mac/test/sshd-owner.test.ts`
- Modify: `src/manifest.ts`, `src/commands/setup.ts` (`SetupOptions`, `SetupReport`, thân `setup`), `src/commands/doctor.ts` (`checkSshdService` l.172, thêm `checkTccOwner`), `src/commands/uninstall.ts`, `src/cli.ts` (cờ `--sshd-owner`, `--force` cho `setup`), `src/index.ts` (export `SshdOwner`), test `test/{setup,doctor,uninstall,cli}.test.ts`, `docs/flows/mac-setup.md`, khối `mac-setup`

**Interfaces:**
- Consumes: `bootout`, `serviceState` (`src/launchctl.ts`), `sshdPlistSpec`, `ensureService` (`setup.ts`), `assertNoLiveRuns` (`uninstall.ts:88`, đổi thành `export`), `sshServerPort` (`cli.ts:130`).
- Produces: I2. `export type SshdOwner = 'launchd' | 'app'`; `resolveSshdOwner(manifest: Manifest | null, requested: SshdOwner | undefined): SshdOwner`; `handOffToApp(ctx, paths): Promise<boolean>` (true khi có bootout); `takeBackToLaunchd(ctx, paths, opts: { waitMs: number }): Promise<void>`; `SetupReport.sshdHandoff: 'app' | 'launchd' | 'unchanged'`; check id `tcc-owner`.

- [ ] **Step 1: Test thuần `resolveSshdOwner`**

```ts
import { resolveSshdOwner } from '../src/sshd-owner.js';
it('không cờ thì giữ chủ hiện có; cài mới là launchd', () => {
  expect(resolveSshdOwner(null, undefined)).toBe('launchd');
  expect(resolveSshdOwner({ ...BASE_MANIFEST }, undefined)).toBe('launchd');
  expect(resolveSshdOwner({ ...BASE_MANIFEST, sshdOwner: 'app' }, undefined)).toBe('app');
  expect(resolveSshdOwner({ ...BASE_MANIFEST, sshdOwner: 'app' }, 'launchd')).toBe('launchd');
});
```

  (`BASE_MANIFEST` là manifest hợp lệ đang có trong `test/setup.test.ts`; chuyển vào `test/helpers/fake-mac.ts` nếu cần dùng chung.)

- [ ] **Step 2: Test `setup` chiều sang app** (trong `test/setup.test.ts`, dùng `fakeMac()` + runner giả):
  1. Máy đã cài `launchd`, plist sshd tồn tại, `launchctl print` trả `state = running` → `setup(ctx, { sshdOwner: 'app' })`: runner ghi nhận đúng một `launchctl bootout gui/<uid>/com.2p.crew-mac-sshd`; file plist sshd không còn; manifest có `sshdOwner: 'app'`; không có `launchctl bootstrap` nào cho sshd; `report.sshdHandoff === 'app'`; `sshd_config` và host key không đổi nội dung.
  2. Chạy lại cùng lệnh → không bootout, `sshdHandoff === 'unchanged'`, `report.changed` rỗng (idempotent).
  3. Có run đang chạy (runner giả trả process `claude --print` có `PAPERCLIP_RUN_ID`) → ném `SetupError` chứa "run đang chạy", không bootout; với `force: true` thì chạy.
  4. (trong `test/cli.test.ts`, vì kiểm `SSH_CONNECTION` nằm ở `cli.ts` `sshServerPort`) `crew-mac setup --sshd-owner app` với env `SSH_CONNECTION="100.1.2.3 5555 100.4.5.6 2222"` và manifest cổng 2222 → mã thoát khác 0, thông báo chứa "qua chính sshd agent", runner không có `bootout`; thêm `--force` thì chạy.
  5. Cài mới không cờ → như hôm nay (ghi plist, bootstrap), manifest không có `sshdOwner` hoặc `launchd`.

- [ ] **Step 3: Test `setup` chiều về launchd** (Review Focus 2):
  1. Manifest `app`, pidfile chứa 4242, `ps` giả: 4242 sống với argv `/usr/sbin/sshd -D -f <sshdConfig> -E …` trong 2 lần kiểm đầu rồi biến mất → manifest được ghi `launchd` **trước** lần kiểm pid đầu tiên (thứ tự trong log runner/fs giả), không gửi `kill`, rồi ghi plist + bootstrap.
  2. Pid 4242 vẫn sống sau `waitMs` (test truyền `waitMs: 50`) với argv khớp → gửi đúng một `SIGTERM` tới 4242 rồi bootstrap.
  3. Pid 4242 sống nhưng argv là `sshd-session: u@notty` → không `kill`, không bootstrap, ném `SetupError` chứa "pid 4242 không phải listener của crew-mac".
  4. Pidfile không có → bootstrap ngay.

- [ ] **Step 4: Test `doctor`:**
  1. Manifest `app`, pidfile 4242 sống, argv khớp, `ps -o ppid=` → 4100, `ps -o comm= -p 4100` → `/Applications/2P Crew.app/Contents/MacOS/2P Crew` → `sshd-agent` `ok` detail chứa "con của 2P Crew"; `tcc-owner` `ok`.
  2. Như 1 nhưng cha là `/sbin/launchd` (pid 1) → `sshd-agent` `warn` "listener mồ côi (app đã thoát hoặc crash)", gợi ý "Mở 2P Crew"; `tcc-owner` `warn`.
  3. Manifest `app`, không có pidfile hay pid chết → `sshd-agent` `fail`, hint "Mở 2P Crew (app giữ sshd agent ở chế độ này)".
  4. Manifest `launchd` → `sshd-agent` như cũ (test cũ không đổi); `tcc-owner` `warn` "chế độ LaunchAgent, quyền macOS gắn theo bản Claude".

- [ ] **Step 5: Test `uninstall` chế độ app:** không bootout `com.2p.crew-mac-sshd`, không đụng listener của app, các phần khác như cũ, `report` có dòng "sshd do app 2P Crew giữ: thoát app để dừng".

- [ ] **Step 6: Cài `sshd-owner.ts`**

```ts
import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { MacContext } from './context.js';
import { SetupError } from './context.js';
import { bootout } from './launchctl.js';
import type { Manifest } from './manifest.js';
import { type MacPaths, SSHD_LABEL } from './paths.js';

export type SshdOwner = 'launchd' | 'app';

export function resolveSshdOwner(manifest: Manifest | null, requested: SshdOwner | undefined): SshdOwner {
  return requested ?? manifest?.sshdOwner ?? 'launchd';
}

export async function handOffToApp(ctx: MacContext, paths: MacPaths): Promise<boolean> {
  const booted = await bootout(ctx.runner, ctx.uid, SSHD_LABEL);
  if (existsSync(paths.sshdPlist)) rmSync(paths.sshdPlist);
  return booted;
}

/** Gọi sau khi manifest đã ghi `launchd`, để app thấy và tự dừng listener của nó. */
export async function takeBackToLaunchd(ctx: MacContext, paths: MacPaths, opts: { waitMs: number }): Promise<void> {
  const pid = readPid(paths.sshdPid);
  if (pid === null) return;
  const deadline = ctx.now().getTime() + opts.waitMs;
  while (ctx.now().getTime() < deadline) {
    if (!(await alive(ctx, pid))) return;
    await sleep(500);
  }
  const argv = await commandOf(ctx, pid);
  if (argv === null) return;
  if (!isCrewListener(argv, paths.sshdConfig)) {
    throw new SetupError(`pid ${pid} không phải listener của crew-mac (${argv}); không dừng. Kiểm "lsof -nP -iTCP" rồi chạy lại.`);
  }
  await ctx.runner.run('/bin/kill', ['-TERM', String(pid)], { timeoutMs: 5000 });
}
```

  `readPid`, `alive` (`/bin/ps -o pid= -p`), `commandOf` (`/bin/ps -o command= -p`), `isCrewListener` (argv[0] là `/usr/sbin/sshd`, có `-f <sshdConfig>`, không chứa `sshd-session`), `sleep` (khi test thì `ctx.now` giả tiến theo) viết trong cùng file. Lệnh `ps`/`kill` đi qua `ctx.runner` như mọi lệnh khác của crew-mac.
  `setup()`:
  - `const owner = resolveSshdOwner(manifest, options.sshdOwner)`; owner khác manifest và không `options.force` thì `await assertNoLiveRuns(ctx)`. `SetupOptions` thêm `force?: boolean`. Kiểm `SSH_CONNECTION` làm ở `cli.ts` trước khi gọi `setup` (giống `uninstall`).
  - `owner === 'app'`: bỏ qua `ensureService(sshdPlistSpec)` và gọi `handOffToApp`.
  - `owner === 'launchd'` mà manifest đang `app`: ghi manifest trước, `takeBackToLaunchd(ctx, paths, { waitMs: 15_000 })`, rồi `ensureService` như cũ.

- [ ] **Step 7: Cài `doctor`** — `checkSshdService(ctx, manifest)` rẽ theo `manifest?.sshdOwner`; `checkTccOwner` dùng cùng dữ liệu (pid, cha). `isAgentTccSubject` (l.555) coi subject/identifier `com.2p-solutions.crew.mac` là của agent (spec §5: hộp thoại của app tính là của agent); thêm ca test trong `test/status-tcc.test.ts` hoặc `test/doctor.test.ts`: prompt có identifier `com.2p-solutions.crew.mac` → `tcc-pending` `fail`. Đặt `tcc-owner` ngay sau `sshd-agent` trong danh sách check. Bản tin máy dùng id check, nên `tcc-owner` xuất hiện trong `checks` của bản tin (chỉ `id/status/title`).
- [ ] **Step 8: CLI** — `crew-mac setup [--sshd-owner app|launchd] [--force]`, giá trị khác thì `UsageError('--sshd-owner chỉ nhận app hoặc launchd')`; cập nhật chuỗi trợ giúp dòng 30. Test `cli.test.ts`: cờ sai → mã thoát 64 và thông báo.
- [ ] **Step 9: Kiểm.** Run: `pnpm --filter @crew/mac exec vitest run test/sshd-owner.test.ts test/setup.test.ts test/doctor.test.ts test/uninstall.test.ts test/cli.test.ts && pnpm --filter @crew/mac typecheck` → PASS.
- [ ] **Step 10: Docs + commit.** `mac-setup.md`: mục "Chủ sshd agent" (bảng hai chế độ, lệnh chuyển, luật từ chối khi có run, check `tcc-owner`); khối `mac-setup` thêm `src/sshd-owner.ts` và test.

```bash
git add apps/crew-mac docs/flows.yaml docs/flows/mac-setup.md docs/files.md
git commit -m "feat(crew-mac): chế độ app giữ sshd agent và check tcc-owner"
```

---

### Task 3 (MC-3): Trường `app` trong bản tin máy

**Files:**
- Create: `apps/crew-mac/src/status/app-state.ts`, `apps/crew-mac/test/status-app.test.ts`
- Modify: `src/paths.ts` (thêm `appState: join(home, 'Library', 'Application Support', '2P Crew', 'app.json')`), `src/status/report.ts` (`MachineReport.app?`, `buildMachineReport`), `src/index.ts` (export `readAppState`), `docs/flows/mac-setup.md`, khối `mac-setup`

**Interfaces:**
- Consumes: I3 (`appVersion`, `sshdOwner`, `updateState`).
- Produces: I8; `readAppState(path: string): AppReport | null` với `AppReport = { version: string; sshdOwner: 'app' | 'launchd'; updateState: 'idle' | 'downloading' | 'waiting-idle' | 'installing' | 'probation' | 'rolled-back' }` khai trong `src/status/app-state.ts` (crew-mac không import kiểu từ app).

- [ ] **Step 1: Test**

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readAppState } from '../src/status/app-state.js';

const dir = mkdtempSync(join(tmpdir(), 'app-state-'));
const file = (name: string, body: string) => { const p = join(dir, name); writeFileSync(p, body); return p; };

it('đọc đúng ba trường', () => {
  const p = file('ok.json', JSON.stringify({ version: 1, appVersion: '0.1.0', sshdOwner: 'app', updateState: 'idle', sshdPid: 9 }));
  expect(readAppState(p)).toEqual({ version: '0.1.0', sshdOwner: 'app', updateState: 'idle' });
});
it('thiếu file, JSON hỏng, giá trị lạ thì null và không ném', () => {
  expect(readAppState(join(dir, 'none.json'))).toBeNull();
  expect(readAppState(file('bad.json', '{'))).toBeNull();
  expect(readAppState(file('odd.json', JSON.stringify({ version: 1, appVersion: '0.1.0', sshdOwner: 'x', updateState: 'idle' })))).toBeNull();
  expect(readAppState(file('long.json', JSON.stringify({ version: 1, appVersion: 'x'.repeat(33), sshdOwner: 'app', updateState: 'idle' })))).toBeNull();
});
```

  Trong `test/status.test.ts` thêm: HOME giả có `app.json` hợp lệ → body POST có `app` đúng; không có file → body không có key `app`.

- [ ] **Step 2: Cài** `readAppState` (semver `^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`, ≤ 32 ký tự; `updateState` thuộc 6 giá trị I3) và gắn `...(app ? { app } : {})` vào `buildMachineReport`.
- [ ] **Step 3: Kiểm.** `pnpm --filter @crew/mac exec vitest run test/status-app.test.ts test/status.test.ts && pnpm --filter @crew/mac typecheck` → PASS.
- [ ] **Step 4: Docs + commit.** `mac-setup.md` mục Dữ liệu: trường `app` (I8) và điều kiện plugin đã deploy (DP-1).

```bash
git add apps/crew-mac docs/flows.yaml docs/flows/mac-setup.md docs/files.md
git commit -m "feat(crew-mac): bản tin máy báo phiên bản app 2P Crew"
```

---

### Task 4 (MC-4): Cài bản `crew-mac` app mang theo

**Files:**
- Create: `apps/crew-mac/src/install-cli.ts`, `apps/crew-mac/test/install-cli.test.ts`
- Modify: `src/index.ts` (export `installCrewMacFrom`), `docs/flows/mac-setup.md`, khối `mac-setup`

**Interfaces:**
- Consumes: `renderLauncher(nodePath, cliPath)`, `parseLauncher(text)` (`src/launcher.ts`), `writeIfChanged` (`src/fs-util.ts`), kiểm run của `scanUninstallBlockers`.
- Produces: `installCrewMacFrom(ctx: MacContext, srcDir: string): Promise<{ installed: boolean; version: string; backup: string | null; reason?: string }>`. `srcDir` là thư mục gói đã build (`package.json`, `dist/**`, `assets/**`); app truyền `process.resourcesPath + '/crew-mac'`.

- [ ] **Step 1: Test** (HOME giả):
  1. `~/.crew/app/crew-mac` có bản `0.0.1` (file `package.json` `version`), `srcDir` bản `0.0.2` → sau gọi: `~/.crew/app/crew-mac/package.json` là `0.0.2`, `~/.crew/app/crew-mac.prev/package.json` là `0.0.1`, launcher `~/.crew/bin/crew-mac` trỏ `~/.crew/app/crew-mac/dist/cli.js` (đọc lại bằng `parseLauncher`), `installed: true`, `backup` = đường dẫn `.prev`.
  2. Gọi lại với cùng `srcDir` (nội dung `dist/cli.js` giống, so bằng sha256 toàn cây) → `installed: false`, không đổi `mtime` thư mục.
  3. Có run đang chạy → `installed: false`, `reason` chứa "run đang chạy", không đổi gì.
  4. `srcDir` thiếu `dist/cli.js` → ném `SetupError`, bản đang cài nguyên vẹn.
  5. Đã có `.prev` cũ → bị thay bằng bản vừa bị thay thế (chỉ giữ 1 bản).
  6. Lỗi giữa chừng (giả lập `renameSync` thứ hai ném) → `~/.crew/app/crew-mac` vẫn là bản cũ (đổi tên lại từ `.prev`).
- [ ] **Step 2: Cài.** Chép `srcDir` → `~/.crew/app/crew-mac.new` (`cpSync` recursive), kiểm `dist/cli.js` tồn tại, `rmSync(.prev)`, `renameSync(crew-mac → crew-mac.prev)`, `renameSync(crew-mac.new → crew-mac)` (lỗi thì `renameSync(.prev → crew-mac)` và ném), rồi `writeIfChanged(paths.launcher, renderLauncher(ctx.nodePath, <cli mới>), 0o755)`. Không chạy lại `setup` (app gọi `setup` riêng khi cần).
- [ ] **Step 3: Kiểm.** `pnpm --filter @crew/mac exec vitest run test/install-cli.test.ts test/launcher.test.ts && pnpm --filter @crew/mac typecheck` → PASS.
- [ ] **Step 4: Docs + commit.** `mac-setup.md` mục "Cài bản mang theo của app".

```bash
git add apps/crew-mac docs/flows.yaml docs/flows/mac-setup.md docs/files.md
git commit -m "feat(crew-mac): cài bản crew-mac do app mang theo, giữ một bản lui"
```
