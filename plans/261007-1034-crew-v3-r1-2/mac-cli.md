# Gói `mac-cli` — uninstall an toàn, doctor đúng mức, crew-docs cho integrator (MC-1, MC-2)

Repo Crew, worktree `.worktrees/crew-r12-mac` nhánh `r1-2/crew-mac` từ `v3`. Model sonnet; MC-1 chạm process lifecycle nên reviewer opus. Một worker làm MC-1 rồi MC-2; gói `superpowers-mac` làm tiếp **trên cùng nhánh** sau MC-2 (cùng sửa `setup.ts`, `doctor.ts`, `cli.ts`).

Chuẩn bị: `pnpm install` ở gốc worktree; `pnpm --filter @crew/docs-kit build` (để có `packages/docs-kit/dist/crew-docs.cjs` cho bước kiểm docs trước commit).

Lệnh kiểm ở tầng implementer (dùng ở mọi task):

```bash
pnpm --filter @crew/mac exec vitest run <file test>
pnpm --filter @crew/mac typecheck
pnpm exec biome check apps/crew-mac docs/flows
node packages/docs-kit/dist/crew-docs.cjs check --staged   # sau git add, trước git commit
```

## Bối cảnh đã xác minh

- `apps/crew-mac/src/commands/uninstall.ts` `uninstall(ctx)`: bootout LaunchAgent rồi gỡ file; chưa kiểm run sống. `src/cli.ts` case `uninstall`: `--force` hiện chỉ bỏ qua cảnh báo "phiên đi qua sshd agent".
- `src/reaper/process-table.ts` `listProcesses(runner)` gọi ba lệnh `/bin/ps` (tree, argv, `-E` env); `ProcInfo.runId` chỉ lấy từ env (`PAPERCLIP_RUN_ID`), không từ argv (bài học: argv từng làm giết nhầm `claude -p` của owner). `src/reaper/run-members.ts` `isClaudePrint(p)` = có `runId` + exe là claude + có `--print`/`-p`.
- `src/commands/doctor.ts`: `parsePendingTccPrompts` → `PendingPrompt.subject` là đường dẫn app; `checkTccPending` fail với **mọi** hộp thoại; `checkLoad` gọi `sysctl`/`memory_pressure` theo PATH.
- `packages/docs-kit/src/hook-installer.ts` `BUNDLE_KEY = 'crew-docs.bundle'`: `crew-docs install-hooks` đặt git config này; git worktree dùng chung config của repo.
- Flow: mọi file trên thuộc `mac-setup` (`docs/flows/mac-setup.md`); `process-table.ts`/`run-members.ts` chỉ được import, không sửa.

## Task MC-1: uninstall từ chối khi còn run, doctor chỉ fail TCC của agent

**Files:**
- Modify: `apps/crew-mac/src/commands/uninstall.ts` (`uninstall(ctx, options)`, `liveRunIds`)
- Modify: `apps/crew-mac/src/cli.ts` (case `uninstall`, chuỗi help)
- Modify: `apps/crew-mac/src/commands/doctor.ts` (`isAgentTccSubject`, `checkTccPending`, `checkLoad`)
- Modify: `apps/crew-mac/test/uninstall.test.ts`, `apps/crew-mac/test/doctor.test.ts`, `apps/crew-mac/test/cli.test.ts`, `apps/crew-mac/test/helpers/fake-mac.ts`
- Modify: `docs/flows/mac-setup.md` (mục "Các bước", "Lưu ý quyền macOS (TCC)")

**Interfaces:**
- Produces: `uninstall(ctx: MacContext, options?: { force?: boolean }): Promise<UninstallReport>`; `liveRunIds(runner: CommandRunner): Promise<string[]>`; `isAgentTccSubject(subject: string): boolean`.

- [ ] **Step 1: Thêm handler `/bin/ps` mặc định vào `test/helpers/fake-mac.ts`** — trả `stdout: ''` cho cả ba lệnh, và cho phép truyền `options.ps?: { tree: string; argv: string; env: string }`:

```ts
    .on('/bin/ps', (args) => {
      const ps = options.ps ?? { tree: '', argv: '', env: '' };
      if (args.includes('-E')) return { stdout: ps.env };
      if (args.some((a) => a.includes('comm='))) return { stdout: ps.tree };
      return { stdout: ps.argv };
    })
```

Đổi tên handler `sysctl` → `/usr/sbin/sysctl` và `memory_pressure` → `/usr/bin/memory_pressure` nếu helper hoặc `doctor.test.ts` đang đăng ký theo tên ngắn.

- [ ] **Step 2: Test thất bại cho uninstall** (`test/uninstall.test.ts`)

```ts
const RUN = '0b7f3c2e-7d1a-4c55-9a51-5d0e7a6b9c10';
const LIVE_PS = {
  tree: '  4242     1  4242 ??       00:42 claude\n',
  argv: '  4242 /Users/a/.local/bin/claude --print --output-format stream-json\n',
  env: `  4242 /Users/a/.local/bin/claude --print --output-format stream-json PAPERCLIP_RUN_ID=${RUN} HOME=/Users/a\n`,
};

it('còn run Paperclip đang chạy thì từ chối và chưa gỡ gì', async () => {
  const { home, ctx } = fakeMac({ ps: LIVE_PS });
  seedSpike(home);
  await expect(uninstall(ctx)).rejects.toThrow(SetupError);
  await expect(uninstall(ctx)).rejects.toThrow(RUN);
  expect(existsSync(macPaths(home).spikePlist)).toBe(true);
});

it('--force thì gỡ dù còn run', async () => {
  const { home, ctx } = fakeMac({ ps: LIVE_PS });
  seedSpike(home);
  const report = await uninstall(ctx, { force: true });
  expect(report.removed).toContain(macPaths(home).spikePlist);
});

it('claude -p thủ công của owner (không có PAPERCLIP_RUN_ID) không tính là run', async () => {
  const { home, ctx } = fakeMac({
    ps: { tree: '  5151     1  5151 ttys001  00:10 claude\n', argv: '  5151 claude -p hi\n', env: '  5151 claude -p hi HOME=/Users/a\n' },
  });
  seedSpike(home);
  await expect(uninstall(ctx)).resolves.toBeDefined();
});

it('không đọc được bảng process thì từ chối, trừ --force', async () => {
  const { home, ctx } = fakeMac();
  (ctx.runner as FakeRunner).on('/bin/ps', () => ({ code: 1, stderr: 'ps: lỗi' }));
  seedSpike(home);
  await expect(uninstall(ctx)).rejects.toThrow(/bảng process/);
  await expect(uninstall(ctx, { force: true })).resolves.toBeDefined();
});
```

(import `FakeRunner` từ `./helpers/fake-runner.js`). Nếu định dạng dòng `ps` mẫu không khớp `parsePsTree`, chỉnh theo `TREE_RE` (`pid ppid pgid tty etime comm`) trong `process-table.ts`.

- [ ] **Step 3: Chạy, kỳ vọng FAIL**

Run: `pnpm --filter @crew/mac exec vitest run test/uninstall.test.ts`
Expected: FAIL ở 3 test mới (uninstall chưa kiểm).

- [ ] **Step 4: Sửa `uninstall.ts`**

```ts
import { listProcesses } from '../reaper/process-table.js';
import { isClaudePrint } from '../reaper/run-members.js';
import type { CommandRunner } from '../system.js';

/** Run id của các `claude --print` do Paperclip chạy (PAPERCLIP_RUN_ID trong env), không tính claude thủ công. */
export async function liveRunIds(runner: CommandRunner): Promise<string[]> {
  const procs = await listProcesses(runner);
  return [...new Set(procs.filter(isClaudePrint).map((p) => p.runId as string))].sort();
}

export async function uninstall(ctx: MacContext, options: { force?: boolean } = {}): Promise<UninstallReport> {
  if (ctx.platform !== 'darwin') throw new SetupError('crew-mac chỉ chạy trên macOS.');
  if (!options.force) {
    let live: string[];
    try {
      live = await liveRunIds(ctx.runner);
    } catch (err) {
      throw new SetupError(
        `crew-mac: không đọc được bảng process (${err instanceof Error ? err.message : String(err)}); ` +
          'không chắc còn run nào đang chạy. Thêm --force nếu chắc chắn.',
      );
    }
    if (live.length > 0) {
      throw new SetupError(
        `crew-mac: còn ${live.length} run Paperclip đang chạy trên máy này (${live.join(', ')}). ` +
          'Hủy hoặc chờ các run đó xong trên Paperclip rồi chạy lại, hoặc thêm --force.',
      );
    }
  }
  // … phần còn lại giữ nguyên …
```

- [ ] **Step 5: Sửa `cli.ts`** — `const report = await uninstall(ctx, { force: flags.has('--force') });`; dòng help thành `  crew-mac uninstall [--force]      --force: bỏ qua kiểm phiên sshd agent và run Paperclip đang chạy`. Thêm test vào `test/cli.test.ts`: `uninstall` khi `fakeMac({ ps: LIVE_PS })` trả mã khác 0 và in run id ra stderr (theo cách các test cli hiện có bắt `io.err`).

- [ ] **Step 6: Chạy, kỳ vọng PASS**

Run: `pnpm --filter @crew/mac exec vitest run test/uninstall.test.ts test/cli.test.ts`
Expected: PASS.

- [ ] **Step 7: Test thất bại cho TCC** (`test/doctor.test.ts`)

```ts
import { isAgentTccSubject } from '../src/commands/doctor.js';

describe('isAgentTccSubject', () => {
  it('nhận claude, bản claude theo version và node', () => {
    expect(isAgentTccSubject('/Users/a/.local/share/claude/versions/2.1.289')).toBe(true);
    expect(isAgentTccSubject('/Users/a/.local/bin/claude')).toBe(true);
    expect(isAgentTccSubject('/opt/homebrew/bin/node')).toBe(true);
    expect(isAgentTccSubject('/opt/homebrew/Cellar/node/24.11.0/bin/node')).toBe(true);
    expect(isAgentTccSubject('/Applications/Orca.app')).toBe(false);
    expect(isAgentTccSubject('/Applications/Claude.app')).toBe(false);
  });
});
```

Và hai test qua `doctor(...)` với log `log show` giả (khuôn các test `tcc-pending` hiện có): hộp thoại của `/Applications/Orca.app` → check `tcc-pending` `status: 'warn'`; hộp thoại của `/Users/a/.local/share/claude/versions/2.1.289` → `status: 'fail'`, `hint` chứa `2.1.289`.

- [ ] **Step 8: Chạy, kỳ vọng FAIL**

Run: `pnpm --filter @crew/mac exec vitest run test/doctor.test.ts`
Expected: FAIL (`isAgentTccSubject` chưa có; Orca đang `fail`).

- [ ] **Step 9: Sửa `doctor.ts`**

```ts
/** Hộp thoại quyền của chính agent (claude theo version hoặc node chạy crew-mac/claude) thì chặn agent; app khác thì không. */
export function isAgentTccSubject(subject: string): boolean {
  const name = basename(subject);
  return name === 'claude' || name === 'node' || /\/claude\/versions\/[^/]+$/.test(subject);
}
```

Trong `checkTccPending`, thay khối `if (pending.length > 0)`:

```ts
  const agent = pending.filter((p) => isAgentTccSubject(p.subject));
  const other = pending.filter((p) => !isAgentTccSubject(p.subject));
  const describe = (list: PendingPrompt[]) => list.map((p) => `${p.at} ${p.service} cho ${p.subject}`).join('; ');
  if (agent.length > 0) {
    return {
      ...base,
      status: 'fail',
      detail: [describe(agent), other.length > 0 ? `app khác: ${describe(other)}` : '', unreadable].filter(Boolean).join('; '),
      hint: agent.map(tccHint).join('\n'),
    };
  }
  if (other.length > 0) {
    return {
      ...base,
      status: 'warn',
      detail: [`không phải agent: ${describe(other)}`, unreadable].filter(Boolean).join('; '),
      hint: other.map(tccHint).join('\n'),
    };
  }
```

Trong `checkLoad`: `'/usr/sbin/sysctl'` thay `'sysctl'` (hai chỗ), `'/usr/bin/memory_pressure'` thay `'memory_pressure'`.

- [ ] **Step 10: Chạy, kỳ vọng PASS**

Run: `pnpm --filter @crew/mac exec vitest run test/doctor.test.ts test/uninstall.test.ts test/cli.test.ts`
Run: `pnpm --filter @crew/mac typecheck`
Expected: PASS, 0 lỗi.

- [ ] **Step 11: Sửa `docs/flows/mac-setup.md`** — mục "Các bước", ý uninstall: thêm "Từ chối khi còn `claude --print` có `PAPERCLIP_RUN_ID` (run Paperclip đang chạy) hoặc không đọc được bảng process; `--force` bỏ qua cả kiểm này lẫn kiểm phiên sshd agent." Mục "Lưu ý quyền macOS (TCC)": "`tcc-pending` chỉ `fail` khi hộp thoại thuộc `claude` (kể cả `…/claude/versions/<bản>`) hoặc `node`; hộp thoại của app khác chỉ `warn`." Mục "Dữ liệu"/"Các bước" của doctor tải máy: đường dẫn tuyệt đối `/usr/sbin/sysctl`, `/usr/bin/memory_pressure`.

- [ ] **Step 12: Commit**

```bash
git add apps/crew-mac/src/commands/uninstall.ts apps/crew-mac/src/cli.ts apps/crew-mac/src/commands/doctor.ts \
  apps/crew-mac/test/uninstall.test.ts apps/crew-mac/test/doctor.test.ts apps/crew-mac/test/cli.test.ts \
  apps/crew-mac/test/helpers/fake-mac.ts docs/flows/mac-setup.md
node packages/docs-kit/dist/crew-docs.cjs check --staged
git commit -m "fix(crew-mac): refuse uninstall while Paperclip runs are alive and fail doctor only on agent permission prompts"
```

## Task MC-2: doctor kiểm crew-docs của các worktree agent

**Files:**
- Modify: `apps/crew-mac/src/commands/doctor.ts` (`checkCrewDocs`, gọi trong `doctor` sau `checkWorktreeRoot`)
- Modify: `apps/crew-mac/test/doctor.test.ts`, `apps/crew-mac/test/helpers/fake-mac.ts` (handler `/usr/bin/git`)
- Modify: `docs/flows/mac-setup.md`

**Interfaces:**
- Produces: check `id: 'crew-docs'`. Hợp đồng cho integrator (RO-1): trong worktree có `docs/flows.yaml`, `node "$(git config --get crew-docs.bundle)" check --range <base>..<head>` chạy được.

- [ ] **Step 1: Test thất bại**

```ts
describe('doctor crew-docs', () => {
  it('worktree có docs/flows.yaml mà thiếu crew-docs.bundle thì fail', async () => {
    const { home, ctx, worktreeRoot } = installedMac(); // helper hiện có của doctor.test (manifest + worktree root)
    const wt = join(worktreeRoot, 'integrator');
    mkdirSync(join(wt, 'docs'), { recursive: true });
    writeFileSync(join(wt, 'docs', 'flows.yaml'), 'version: 1\n');
    (ctx.runner as FakeRunner).on('/usr/bin/git', () => ({ code: 1 }));
    const r = (await doctor(ctx, OPTIONS)).find((c) => c.id === 'crew-docs');
    expect(r?.status).toBe('fail');
    expect(r?.detail).toContain('integrator');
  });

  it('bundle có và chạy được thì ok; worktree không dùng crew-docs thì bỏ qua', async () => {
    const { ctx, worktreeRoot } = installedMac();
    const bundle = join(worktreeRoot, '..', 'crew-docs.cjs');
    writeFileSync(bundle, '');
    mkdirSync(join(worktreeRoot, 'a', 'docs'), { recursive: true });
    writeFileSync(join(worktreeRoot, 'a', 'docs', 'flows.yaml'), 'version: 1\n');
    mkdirSync(join(worktreeRoot, 'b'), { recursive: true });
    (ctx.runner as FakeRunner)
      .on('/usr/bin/git', () => ({ stdout: `${bundle}\n` }))
      .on(ctx.nodePath, (args) => (args[1] === '--version' ? { stdout: 'crew-docs 0.1.0\n' } : undefined));
    const r = (await doctor(ctx, OPTIONS)).find((c) => c.id === 'crew-docs');
    expect(r).toMatchObject({ status: 'ok', detail: expect.stringContaining('1 worktree') });
  });
});
```

`installedMac`/`OPTIONS`: dùng đúng helper và hằng số mà `doctor.test.ts` đang dùng để dựng Mac đã cài; nếu helper mang tên khác, dùng tên đó (không tạo helper thứ hai).

- [ ] **Step 2: Chạy, kỳ vọng FAIL**

Run: `pnpm --filter @crew/mac exec vitest run test/doctor.test.ts`
Expected: FAIL (không có check `crew-docs`).

- [ ] **Step 3: Viết `checkCrewDocs`**

```ts
async function checkCrewDocs(ctx: MacContext, manifest: Manifest): Promise<CheckResult> {
  const base = { id: 'crew-docs', title: 'crew-docs cho integrator' };
  if (!existsSync(manifest.worktreeRoot)) return { ...base, status: 'warn', detail: 'chưa có thư mục worktree' };
  const repos = readdirSync(manifest.worktreeRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => join(manifest.worktreeRoot, e.name))
    .filter((dir) => existsSync(join(dir, 'docs', 'flows.yaml')));
  if (repos.length === 0) return { ...base, status: 'ok', detail: 'không có worktree nào dùng crew-docs' };
  const problems: string[] = [];
  for (const dir of repos) {
    const cfg = await ctx.runner.run('/usr/bin/git', ['-C', dir, 'config', '--get', 'crew-docs.bundle'], { timeoutMs: 10_000 });
    const bundle = cfg.stdout.trim();
    if (cfg.code !== 0 || bundle === '') {
      problems.push(`${dir}: chưa có git config crew-docs.bundle`);
      continue;
    }
    if (!existsSync(bundle)) {
      problems.push(`${dir}: ${bundle} không tồn tại`);
      continue;
    }
    const version = await ctx.runner.run(ctx.nodePath, [bundle, '--version'], { timeoutMs: 15_000 });
    if (version.code !== 0) problems.push(`${dir}: ${bundle} --version mã ${version.code}`);
  }
  if (problems.length > 0) {
    return {
      ...base,
      status: 'fail',
      detail: problems.join('; '),
      hint: 'Trong checkout gốc của dự án, chạy "node <đường dẫn crew-docs.cjs> install-hooks" để đặt crew-docs.bundle (worktree dùng chung git config).',
    };
  }
  return { ...base, status: 'ok', detail: `${repos.length} worktree, bundle chạy được` };
}
```

Trong `doctor`, thêm `results.push(await checkCrewDocs(ctx, manifest));` ngay sau `results.push(checkWorktreeRoot(ctx, manifest));`. Import `readdirSync`, `join` nếu chưa có.

- [ ] **Step 4: Chạy, kỳ vọng PASS**

Run: `pnpm --filter @crew/mac exec vitest run test/doctor.test.ts`
Run: `pnpm --filter @crew/mac typecheck`
Expected: PASS.

- [ ] **Step 5: Docs** — `docs/flows/mac-setup.md` mục doctor: thêm check `crew-docs` (worktree có `docs/flows.yaml` phải có `crew-docs.bundle` chạy được; integrator dùng để kiểm docs trên merged commit).

- [ ] **Step 6: Commit**

```bash
git add apps/crew-mac/src/commands/doctor.ts apps/crew-mac/test/doctor.test.ts apps/crew-mac/test/helpers/fake-mac.ts docs/flows/mac-setup.md
node packages/docs-kit/dist/crew-docs.cjs check --staged
git commit -m "feat(crew-mac): doctor checks that agent worktrees can run crew-docs"
```

## Rủi ro và rollback

| Rủi ro | Khả năng × tác động | Giảm thiểu |
|---|---|---|
| `ps -E` không đọc được env của claude chạy từ LaunchAgent → uninstall tưởng không có run | Thấp × Trung bình | R1-1 đã kiểm `ps -E` đọc env claude trên Mac mini; AC-2 kiểm lại với run thật |
| `--force` dùng chung hai nghĩa | Thấp × Thấp | Ruling trong ledger; help text nói rõ |
| Subject TCC dạng bundle id thay vì đường dẫn | Thấp × Thấp | Không khớp → `warn` (không chặn agent sai), `unparsed` vẫn `warn` |

Rollback: revert commit; không có trạng thái máy nào đổi (lệnh chỉ đọc).
