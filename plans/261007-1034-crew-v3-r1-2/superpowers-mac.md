# Gói `superpowers-mac` — ghim Superpowers, chặn nạp skill chéo (SP-1, SP-2, SP-3)

Repo Crew, **cùng nhánh** `r1-2/crew-mac` (worktree `.worktrees/crew-r12-mac`), làm sau MC-2. Model opus (thiết kế cách ly). Lệnh kiểm như [mac-cli.md](mac-cli.md). SP-1 chạy song song với MC-1 vì không sửa code.

## Bối cảnh đã xác minh (07/10/2026, Mac mini)

- Owner cài `superpowers@claude-plugins-official` **6.4.1**, `gitCommitSha` `5bf4e78011075bcfc0dc295f0724994cd123ee71`, scope **project** cho `/Volumes/CORSAIR/Projects/my-crew` (không phải user-scope như gói ngữ cảnh ghi), `installPath` `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1`. Thư mục có 231 file (không tính thư mục rỗng `.in_use`), không có symlink, không phải repo git.
- Checksum cây theo thuật toán dưới đây: `3f0ff8c82c0795dae8de3cc3ef358364d4f3de81e78b86e1d64b03ac2f9cbd9a`.
- V2 ghim `6.4.2` (`8ca22dba…`); ruling: ghim đúng bản owner đang cài (6.4.1), không dùng bản V2.
- `claude --help` (2.1.289) có `--plugin-dir <path>` ("Load a plugin from a directory … for this session only") và `--settings`. Chưa kiểm `--plugin-dir` dưới `--setting-sources project,local` (SP-1).
- `~/.claude/skills` của owner có `find-skills`, `synced`, `tro-ly` (skill user-scope); `--setting-sources project,local` có chặn chúng không thì chưa biết (SP-1).
- Repo dự án có thể commit `.claude/` riêng (ví dụ repo Crew có `.claude/agents/*`, `.claude/settings.json`, hooks). Owner đã chốt cho nạp nguồn `project`.
- `apps/crew-mac/src/paths.ts`: `~/.crew` dùng chung với crewd v2 (`runtime/`, `assistant/`, `state.db`); `bin/crew-claude-run`, `bin/crew-mac`, `app/` là của crew-mac. Thư mục mới `~/.crew/workflows/` chưa ai dùng.
- Wrapper `apps/crew-mac/assets/crew-claude-run.sh` ghi `pgid`/`started` khi có `PAPERCLIP_RUN_ID` rồi `exec claude "$@"`. Fork có bản sao fixture `server/src/__tests__/fixtures/crew-claude-run.sh` cho test H3.

**Thuật toán checksum cây** (đã chạy để ra con số trên): duyệt mọi file thường dưới thư mục gốc, bỏ entry `.in_use` ở cấp gốc, symlink hay loại file khác là lỗi; sắp đường dẫn tương đối (dấu `/`) theo byte; với mỗi file nối chuỗi `<đường dẫn>\0<sha256 hex của nội dung>\n`; checksum = sha256 hex của toàn chuỗi. Tương đương shell:

```bash
cd "$DIR" && find . -type f ! -path './.in_use/*' | LC_ALL=C sort | while IFS= read -r f; do
  printf '%s\0%s\n' "${f#./}" "$(shasum -a 256 "$f" | cut -d' ' -f1)"; done | shasum -a 256
```

## Task SP-1: Spike — `--plugin-dir` và nguồn skill lọt vào run

**Files:**
- Create: `plans/261007-1034-crew-v3-r1-2/spike-superpowers.md` (kết quả; repo Crew, commit cùng plan)
- Không sửa code.

Chạy trên Mac mini, trong Terminal của phiên làm việc (không qua sshd agent), **không** đặt `PAPERCLIP_RUN_ID`, thư mục thử **ngoài** `~/crew-agents`. Ba lượt `claude -p` dùng `--model haiku` (quota tài khoản từng 96%).

- [ ] **Step 1: Dựng repo thử**

```bash
SCR="$(mktemp -d)/sp-spike" && mkdir -p "$SCR" && cd "$SCR" && git init -q && git commit -q --allow-empty -m init
mkdir -p .claude/skills/spike-project-skill
printf -- '---\nname: spike-project-skill\ndescription: Skill thử của project\n---\nx\n' > .claude/skills/spike-project-skill/SKILL.md
git add .claude && git commit -q -m "project skill"
PIN="$HOME/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1"
echo "$SCR"
```

- [ ] **Step 2: Ba lượt, mỗi lượt chỉ giữ dòng `system/init`**

```bash
cd "$SCR"
SUM() { cd "$PIN" && find . -type f ! -path './.in_use/*' | LC_ALL=C sort | while IFS= read -r f; do printf '%s\0%s\n' "${f#./}" "$(shasum -a 256 "$f" | cut -d' ' -f1)"; done | shasum -a 256; cd "$SCR"; }
SUM > sum-before.txt
claude -p --model haiku --max-turns 1 --output-format stream-json --verbose --setting-sources project,local --plugin-dir "$PIN" "Trả lời đúng một chữ: ok" | head -1 > a-plugin-dir.json
claude -p --model haiku --max-turns 1 --output-format stream-json --verbose --setting-sources project,local "Trả lời đúng một chữ: ok" | head -1 > b-no-plugin.json
claude -p --model haiku --max-turns 1 --output-format stream-json --verbose --setting-sources local --plugin-dir "$PIN" "Trả lời đúng một chữ: ok" | head -1 > c-local-only.json
for f in a-plugin-dir b-no-plugin c-local-only; do
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sys.argv[1], d.get("type"), d.get("subtype")); [print(" ", k, d.get(k)) for k in ("plugins","skills","slash_commands","agents")]' "$f.json"
done
```

Sau ba lượt: `SUM > sum-after.txt && diff sum-before.txt sum-after.txt` — phải giống nhau và bằng `3f0ff8c8…bd9a` (claude không ghi vào thư mục plugin). Nếu dòng đầu không phải `system/init` hoặc không có khóa `skills`/`plugins`, ghi nguyên văn các khóa có thật.

- [ ] **Step 3: Ghi `spike-superpowers.md`** — bảng ba lượt × (Superpowers từ `$PIN` có không; `spike-project-skill` có không; `find-skills`/`synced`/`tro-ly` của `~/.claude/skills` có không; plugin khác có không), kèm nguyên văn danh sách. Kết luận theo luật:
  - A có `superpowers:*` từ `$PIN` → giữ ruling `--plugin-dir`, làm SP-2/SP-3 như dưới.
  - A không có → dừng, báo Trợ Lý `BLOCKED` kèm bảng; Trợ Lý áp nhánh dự phòng của ruling (settings project-scope trong worktree) và sửa SP-2/SP-3 trước khi làm tiếp.
  - Skill user (`~/.claude/skills`) lọt vào A → báo Trợ Lý `DONE_WITH_CONCERNS`; đây là nạp chéo không chặn được bằng kiểm tĩnh trong worktree, cần owner chốt (câu hỏi cuối ledger).
- [ ] **Step 4: Dọn** `rm -rf "$SCR"`; không còn process `claude` nào của spike (`pgrep -fl "sp-spike"` rỗng).

## Task SP-2: Pin Superpowers, cài bản ghim, doctor kiểm

**Files:**
- Create: `apps/crew-mac/src/workflows/pin.ts`, `apps/crew-mac/src/workflows/policy.ts`, `apps/crew-mac/src/workflows/tree-checksum.ts`, `apps/crew-mac/src/workflows/install.ts`
- Modify: `apps/crew-mac/src/paths.ts` (`workflowsRoot`, sửa comment về `~/.crew`)
- Modify: `apps/crew-mac/src/commands/setup.ts` (gọi `installSuperpowersPin`, in `extraArgs`)
- Modify: `apps/crew-mac/src/commands/doctor.ts` (check `superpowers-pin`)
- Create: `apps/crew-mac/test/workflows-pin.test.ts`
- Modify: `apps/crew-mac/test/setup.test.ts`, `apps/crew-mac/test/doctor.test.ts`, `apps/crew-mac/test/helpers/fake-mac.ts` (seed `installed_plugins.json` + cây plugin giả khi test cần)
- Create: `docs/flows/mac-workflows.md`; Modify: `docs/flows.yaml` (thêm flow `mac-workflows`, không đụng `source`/`shared`/`unassigned`), `docs/flows/mac-setup.md`

**Interfaces:**
- Produces:
  - `interface WorkflowPin { workflow: 'superpowers'; version: string; revision: string; checksum: string }`, `SUPERPOWERS_PIN`, `SUPERPOWERS_PLUGIN_KEY = 'superpowers@claude-plugins-official'`
  - `superpowersPinDir(home: string, pin?: WorkflowPin): string` → `<home>/.crew/workflows/superpowers/6.4.1-5bf4e7801107`
  - `agentExtraArgs(pinDir: string): string[]` → `['--setting-sources', 'project,local', '--plugin-dir', pinDir]`
  - `samePin(a, b): boolean`, `assertSkillAllowed(run: WorkflowPin, origin: WorkflowPin): void` (ném `Error('WORKFLOW_SOURCE_MISMATCH')`)
  - `treeChecksum(root: string): { checksum: string; files: number }`
  - `readInstalledPlugins(home: string, key: string): Array<{ installPath: string; version: string; gitCommitSha: string | null }>`
  - `installSuperpowersPin(ctx: MacContext, pin?: WorkflowPin): { dir: string; changed: boolean }`

- [ ] **Step 1: Test thất bại** `apps/crew-mac/test/workflows-pin.test.ts`

```ts
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentExtraArgs, SUPERPOWERS_PIN, superpowersPinDir } from '../src/workflows/pin.js';
import { assertSkillAllowed, samePin } from '../src/workflows/policy.js';
import { treeChecksum } from '../src/workflows/tree-checksum.js';

function fixtureTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crew-tree-'));
  mkdirSync(join(dir, 'dir'));
  mkdirSync(join(dir, '.in_use'));
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  writeFileSync(join(dir, 'dir', 'b.txt'), 'b\n');
  writeFileSync(join(dir, '.in_use', 'lock'), 'x\n');
  return dir;
}

describe('treeChecksum', () => {
  it('khớp đúng thuật toán shell (bỏ .in_use ở gốc)', () => {
    expect(treeChecksum(fixtureTree())).toEqual({
      checksum: '887ad97e9e3f192940fb5320cd393c82f31fa65da974ee62ff923e37fe75b6e5',
      files: 2,
    });
  });
  it('từ chối symlink', () => {
    const dir = fixtureTree();
    symlinkSync('/etc/hosts', join(dir, 'dir', 'link'));
    expect(() => treeChecksum(dir)).toThrow(/symlink/);
  });
});

describe('pin', () => {
  it('ghim Superpowers 6.4.1 đúng bản owner cài', () => {
    expect(SUPERPOWERS_PIN).toEqual({
      workflow: 'superpowers',
      version: '6.4.1',
      revision: '5bf4e78011075bcfc0dc295f0724994cd123ee71',
      checksum: '3f0ff8c82c0795dae8de3cc3ef358364d4f3de81e78b86e1d64b03ac2f9cbd9a',
    });
    expect(superpowersPinDir('/Users/a')).toBe('/Users/a/.crew/workflows/superpowers/6.4.1-5bf4e7801107');
    expect(agentExtraArgs('/p')).toEqual(['--setting-sources', 'project,local', '--plugin-dir', '/p']);
  });
  it('assertSkillAllowed chỉ cho đúng pin', () => {
    expect(samePin(SUPERPOWERS_PIN, { ...SUPERPOWERS_PIN })).toBe(true);
    expect(() => assertSkillAllowed(SUPERPOWERS_PIN, { ...SUPERPOWERS_PIN, checksum: '0'.repeat(64) })).toThrow('WORKFLOW_SOURCE_MISMATCH');
  });
});
```

- [ ] **Step 2: Chạy, kỳ vọng FAIL**

Run: `pnpm --filter @crew/mac exec vitest run test/workflows-pin.test.ts`
Expected: FAIL, không load được `../src/workflows/pin.js`.

- [ ] **Step 3: Viết ba file thuần**

`apps/crew-mac/src/workflows/pin.ts`:

```ts
import { join } from 'node:path';

export interface WorkflowPin {
  workflow: 'superpowers';
  version: string;
  revision: string;
  checksum: string;
}

/** Bản owner cài trên Mac mini ngày 07/10/2026 (claude-plugins-official). Nâng bản = sửa hằng số này và chạy lại setup. */
export const SUPERPOWERS_PIN: WorkflowPin = {
  workflow: 'superpowers',
  version: '6.4.1',
  revision: '5bf4e78011075bcfc0dc295f0724994cd123ee71',
  checksum: '3f0ff8c82c0795dae8de3cc3ef358364d4f3de81e78b86e1d64b03ac2f9cbd9a',
};

export const SUPERPOWERS_PLUGIN_KEY = 'superpowers@claude-plugins-official';

export function superpowersPinDir(home: string, pin: WorkflowPin = SUPERPOWERS_PIN): string {
  return join(home, '.crew', 'workflows', pin.workflow, `${pin.version}-${pin.revision.slice(0, 12)}`);
}

/** Đặt vào `adapterConfig.extraArgs` của agent claude_local. */
export function agentExtraArgs(pinDir: string): string[] {
  return ['--setting-sources', 'project,local', '--plugin-dir', pinDir];
}
```

`apps/crew-mac/src/workflows/policy.ts` (port `v2/src/workflow-policy.ts`, bỏ BMAD và `workflowsReady` vì R1 chỉ một workflow):

```ts
import type { WorkflowPin } from './pin.js';

export function samePin(a: WorkflowPin, b: WorkflowPin): boolean {
  return a.workflow === b.workflow && a.version === b.version && a.revision === b.revision && a.checksum === b.checksum;
}

export function assertSkillAllowed(run: WorkflowPin, origin: WorkflowPin): void {
  if (!samePin(run, origin)) throw new Error('WORKFLOW_SOURCE_MISMATCH');
}
```

`apps/crew-mac/src/workflows/tree-checksum.ts`:

```ts
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SetupError } from '../context.js';

/** Checksum cây thư mục workflow; thuật toán ghi ở docs/flows/mac-workflows.md. */
export function treeChecksum(root: string): { checksum: string; files: number } {
  const files: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (rel === '' && entry.name === '.in_use') continue;
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new SetupError(`symlink trong cây workflow: ${path}`);
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else if (entry.isFile()) files.push(path);
      else throw new SetupError(`entry không phải file thường trong cây workflow: ${path}`);
    }
  };
  walk(root, '');
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const hash = createHash('sha256');
  for (const path of files) {
    const digest = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
    hash.update(`${path}\0${digest}\n`);
  }
  return { checksum: hash.digest('hex'), files: files.length };
}
```

- [ ] **Step 4: Chạy, kỳ vọng PASS**

Run: `pnpm --filter @crew/mac exec vitest run test/workflows-pin.test.ts`
Expected: PASS (5 test).

- [ ] **Step 5: Test thất bại cho cài đặt** (nối vào `workflows-pin.test.ts`)

```ts
import { fakeMac } from './helpers/fake-mac.js';
import { installSuperpowersPin } from '../src/workflows/install.js';

function seedOwnerPlugin(home: string, version: string, sha: string): string {
  const installPath = join(home, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers', version);
  mkdirSync(join(installPath, 'dir'), { recursive: true });
  mkdirSync(join(installPath, '.in_use'), { recursive: true });
  writeFileSync(join(installPath, 'a.txt'), 'a\n');
  writeFileSync(join(installPath, 'dir', 'b.txt'), 'b\n');
  writeFileSync(
    join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'superpowers@claude-plugins-official': [{ scope: 'project', installPath, version, gitCommitSha: sha }] } }),
  );
  return installPath;
}
const FIXTURE_PIN = { workflow: 'superpowers' as const, version: '9.9.9', revision: 'f'.repeat(40), checksum: '887ad97e9e3f192940fb5320cd393c82f31fa65da974ee62ff923e37fe75b6e5' };

describe('installSuperpowersPin', () => {
  it('copy bản owner đúng pin vào ~/.crew/workflows, lần hai không đổi gì', () => {
    const { home, ctx } = fakeMac();
    seedOwnerPlugin(home, '9.9.9', 'f'.repeat(40));
    const first = installSuperpowersPin(ctx, FIXTURE_PIN);
    expect(first).toEqual({ dir: join(home, '.crew', 'workflows', 'superpowers', '9.9.9-ffffffffffff'), changed: true });
    expect(treeChecksum(first.dir).checksum).toBe(FIXTURE_PIN.checksum);
    expect(installSuperpowersPin(ctx, FIXTURE_PIN).changed).toBe(false);
  });
  it('owner cài bản khác pin thì báo lỗi rõ, không tạo thư mục', () => {
    const { home, ctx } = fakeMac();
    seedOwnerPlugin(home, '9.9.8', 'e'.repeat(40));
    expect(() => installSuperpowersPin(ctx, FIXTURE_PIN)).toThrow(/9\.9\.9/);
  });
  it('thư mục pin có sẵn mà lệch checksum thì từ chối ghi đè', () => {
    const { home, ctx } = fakeMac();
    seedOwnerPlugin(home, '9.9.9', 'f'.repeat(40));
    const dir = installSuperpowersPin(ctx, FIXTURE_PIN).dir;
    writeFileSync(join(dir, 'a.txt'), 'bị sửa\n');
    expect(() => installSuperpowersPin(ctx, FIXTURE_PIN)).toThrow(/lệch checksum/);
  });
});
```

- [ ] **Step 6: Chạy, kỳ vọng FAIL**

Run: `pnpm --filter @crew/mac exec vitest run test/workflows-pin.test.ts`
Expected: FAIL (không có `install.js`).

- [ ] **Step 7: Viết `apps/crew-mac/src/workflows/install.ts`**

```ts
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type MacContext, SetupError } from '../context.js';
import { SUPERPOWERS_PIN, SUPERPOWERS_PLUGIN_KEY, superpowersPinDir, type WorkflowPin } from './pin.js';
import { treeChecksum } from './tree-checksum.js';

export function readInstalledPlugins(
  home: string,
  key: string,
): Array<{ installPath: string; version: string; gitCommitSha: string | null }> {
  const file = join(home, '.claude', 'plugins', 'installed_plugins.json');
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { plugins?: Record<string, unknown> };
    const entries = parsed.plugins?.[key];
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((raw) => {
      const e = raw as { installPath?: unknown; version?: unknown; gitCommitSha?: unknown };
      return typeof e.installPath === 'string' && typeof e.version === 'string'
        ? [{ installPath: e.installPath, version: e.version, gitCommitSha: typeof e.gitCommitSha === 'string' ? e.gitCommitSha : null }]
        : [];
    });
  } catch {
    return [];
  }
}

/** Copy bản Superpowers owner đã cài (đúng version, revision, checksum) vào thư mục ghim của crew-mac. */
export function installSuperpowersPin(ctx: MacContext, pin: WorkflowPin = SUPERPOWERS_PIN): { dir: string; changed: boolean } {
  const dir = superpowersPinDir(ctx.home, pin);
  if (existsSync(dir)) {
    if (treeChecksum(dir).checksum === pin.checksum) return { dir, changed: false };
    throw new SetupError(`${dir} lệch checksum so với bản ghim ${pin.version}; xóa thư mục đó rồi chạy lại crew-mac setup.`);
  }
  const source = readInstalledPlugins(ctx.home, SUPERPOWERS_PLUGIN_KEY)
    .filter((e) => e.version === pin.version && e.gitCommitSha === pin.revision && existsSync(e.installPath))
    .find((e) => treeChecksum(e.installPath).checksum === pin.checksum);
  if (!source) {
    throw new SetupError(
      `Chưa có Superpowers ${pin.version} (${pin.revision.slice(0, 12)}) đúng checksum trong ~/.claude/plugins. ` +
        `Cài bằng "/plugin install ${SUPERPOWERS_PLUGIN_KEY}" đúng bản ${pin.version} rồi chạy lại.`,
    );
  }
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
  cpSync(source.installPath, tmp, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => !(dirname(src) === source.installPath && src.endsWith('/.in_use')),
  });
  if (treeChecksum(tmp).checksum !== pin.checksum) {
    rmSync(tmp, { recursive: true, force: true });
    throw new SetupError(`Bản copy Superpowers lệch checksum; không cài.`);
  }
  renameSync(tmp, dir);
  return { dir, changed: true };
}
```

- [ ] **Step 8: Gắn vào setup và doctor**

`setup.ts`, trong `setup(ctx, options)` sau bước cài wrapper: 

```ts
  const pin = installSuperpowersPin(ctx);
  report.push(pin.changed ? `Superpowers ${SUPERPOWERS_PIN.version} ghim tại ${pin.dir}` : `Superpowers ghim sẵn tại ${pin.dir}`);
  ctx.out(`adapterConfig.extraArgs cho agent claude_local: ${JSON.stringify(agentExtraArgs(pin.dir))}`);
```

(dùng đúng biến/kiểu báo cáo mà `setup` đang dùng; nếu `SetupReport` có mảng `steps`/`changed`, thêm vào đó thay vì `report.push`).

`doctor.ts`, thêm và gọi sau `checkLauncher`:

```ts
function checkSuperpowersPin(ctx: MacContext, pin: WorkflowPin = SUPERPOWERS_PIN): CheckResult {
  const base = { id: 'superpowers-pin', title: `Superpowers ${pin.version} đã ghim` };
  const dir = superpowersPinDir(ctx.home, pin);
  if (!existsSync(dir)) return { ...base, status: 'fail', detail: `chưa có ${dir}`, hint: 'Chạy "crew-mac setup".' };
  try {
    const sum = treeChecksum(dir);
    if (sum.checksum !== pin.checksum) {
      return { ...base, status: 'fail', detail: `${dir} lệch checksum`, hint: `Xóa ${dir} rồi chạy "crew-mac setup".` };
    }
    const owner = readInstalledPlugins(ctx.home, SUPERPOWERS_PLUGIN_KEY).map((e) => e.version);
    return { ...base, status: 'ok', detail: `${dir} (${sum.files} file); bản owner đang cài: ${owner.join(', ') || 'không có'}` };
  } catch (err) {
    return { ...base, status: 'fail', detail: err instanceof Error ? err.message : String(err) };
  }
}
```

`paths.ts`: thêm `workflowsRoot: join(home, '.crew', 'workflows'),` và sửa comment dòng `crewBin`: "Dùng chung thư mục ~/.crew với crewd v2: crew-mac chỉ đụng `bin/crew-claude-run`, `bin/crew-mac`, `app/` và `workflows/`."

Test không thể dựng cây có đúng checksum của bản thật, nên `SetupOptions` và `DoctorOptions` thêm field `superpowersPin?: WorkflowPin` (mặc định `SUPERPOWERS_PIN`; CLI không truyền), `setup` gọi `installSuperpowersPin(ctx, options.superpowersPin)`, `checkSuperpowersPin(ctx, options.superpowersPin)`. Chuyển `seedOwnerPlugin` và `FIXTURE_PIN` sang `test/helpers/fake-mac.ts` để dùng chung. `setup.test.ts`: mọi lời gọi `setup` cũ truyền `superpowersPin: FIXTURE_PIN` và seed plugin giả; test mới kỳ vọng `ctx.out` có dòng chứa `"--plugin-dir"` và `9.9.9-ffffffffffff`; test mới "owner chưa cài Superpowers đúng bản thì setup báo SetupError chứa 9.9.9". `doctor.test.ts`: `superpowers-pin` `fail` khi chưa có thư mục, `ok` sau `installSuperpowersPin`.

- [ ] **Step 9: Chạy, kỳ vọng PASS**

Run: `pnpm --filter @crew/mac exec vitest run test/workflows-pin.test.ts test/setup.test.ts test/doctor.test.ts`
Run: `pnpm --filter @crew/mac typecheck`
Expected: PASS.

- [ ] **Step 10: Docs và flow** — thêm vào `docs/flows.yaml` sau flow `mac-orphan-reaper`, trước `shared:`:

```yaml
  mac-workflows:
    title: Ghim Superpowers và chặn nạp skill chéo trên Mac
    doc: docs/flows/mac-workflows.md
    entrypoints:
      - apps/crew-mac/src/workflows/install.ts
    files:
      - apps/crew-mac/src/workflows/pin.ts
      - apps/crew-mac/src/workflows/policy.ts
      - apps/crew-mac/src/workflows/tree-checksum.ts
    tests:
      - apps/crew-mac/test/workflows-pin.test.ts
```

Tạo `docs/flows/mac-workflows.md` theo cấu trúc `docs/flows/mac-setup.md` (Mục đích, Điểm vào, Các bước, Files, Dữ liệu, Flow liên quan, Tests; theo `packages/docs-kit/STANDARD.md`): pin 6.4.1 và lý do, thư mục `~/.crew/workflows/superpowers/<version>-<rev12>`, thuật toán checksum, `extraArgs`, cách nâng bản (sửa `SUPERPOWERS_PIN`, chạy setup trên mọi Mac, cập nhật `adapterConfig`). `mac-setup.md`: bước setup cài pin, check doctor `superpowers-pin`. Chạy `node packages/docs-kit/dist/crew-docs.cjs generate`.

- [ ] **Step 11: Commit**

```bash
git add apps/crew-mac/src/workflows apps/crew-mac/src/paths.ts apps/crew-mac/src/commands/setup.ts apps/crew-mac/src/commands/doctor.ts \
  apps/crew-mac/test/workflows-pin.test.ts apps/crew-mac/test/setup.test.ts apps/crew-mac/test/doctor.test.ts apps/crew-mac/test/helpers/fake-mac.ts \
  docs/flows.yaml docs/flows/mac-workflows.md docs/flows/mac-setup.md docs/index.md
node packages/docs-kit/dist/crew-docs.cjs check --staged
git commit -m "feat(crew-mac): pin Superpowers for agents and check the pinned copy in doctor"
```

(`docs/index.md` chỉ khi `generate` đổi nó.)

## Task SP-3: Chặn nạp chéo — inventory, `workflow-check`, wrapper

**Files:**
- Create: `apps/crew-mac/src/workflows/inventory.ts`
- Create: `apps/crew-mac/src/commands/workflow-check.ts`
- Modify: `apps/crew-mac/src/cli.ts` (case `workflow-check`, help)
- Modify: `apps/crew-mac/assets/crew-claude-run.sh`
- Create: `apps/crew-mac/test/workflows-inventory.test.ts`, `apps/crew-mac/test/workflow-check.test.ts`
- Modify: `apps/crew-mac/test/crew-claude-run.test.ts`
- Modify: `docs/flows.yaml` (flow `mac-workflows`: entrypoint `workflow-check.ts`, file `inventory.ts`, hai test mới), `docs/flows/mac-workflows.md`

**Interfaces:**
- Consumes: `SUPERPOWERS_PIN`, `superpowersPinDir`, `treeChecksum`, `assertSkillAllowed`, `readInstalledPlugins` (SP-2), `comparablePath` (`paths.ts`).
- Produces:
  - `type Origin = 'pinned' | 'paperclip' | 'project' | 'blocked'`
  - `interface DiscoveredSource { path: string; kind: 'skill' | 'agent' | 'command' | 'plugin' | 'settings'; origin: Origin; reason?: string }`
  - `classifyOrigin(input: { path: string; root: string; pinDir: string; tracked: boolean }): Origin`
  - `discoverSources(ctx: MacContext, root: string, pin?: WorkflowPin): Promise<DiscoveredSource[]>`
  - `workflowCheck(ctx: MacContext, input: { root: string; pluginDir: string; pin?: WorkflowPin }): Promise<{ ok: boolean; lines: string[] }>`
  - CLI: `crew-mac workflow-check --root <abs> --plugin-dir <abs>` → in `crew-workflow ok pin=superpowers@6.4.1 …` exit 0; `crew-workflow blocked: <path> (<lý do>)` exit 78; đầu vào sai exit 2.
  - Wrapper: khi `PAPERCLIP_RUN_ID` khác rỗng, thiếu `--plugin-dir` hoặc `workflow-check` khác 0 → in lý do ra stderr, exit 78, **không** exec claude. Biến `CREW_MAC_BIN` (mặc định `$HOME/.crew/bin/crew-mac`) chỉ để test.

Luật phân loại (ruling trong ledger):

| Nguồn trong worktree `<root>` | Origin |
|---|---|
| Thư mục `--plugin-dir` = thư mục ghim, checksum đúng | `pinned` |
| Dưới `<root>/.paperclip-runtime/` (skill Paperclip qua `--add-dir`) | `paperclip` |
| `<root>/.claude/{skills,agents,commands}/*`, `<root>/.claude/settings.json` được git track | `project` |
| Cùng các chỗ trên nhưng **không** được git track (agent hay ai đó thả vào) | `blocked` |
| `<root>/.claude/settings.local.json` có `enabledPlugins` hoặc `hooks` | `blocked` |
| `enabledPlugins` (settings.json track) có `superpowers@*` mà mọi `installPath` lệch checksum pin | `blocked` (`WORKFLOW_SOURCE_MISMATCH`) |
| `enabledPlugins` có `superpowers@*` đúng checksum pin | `pinned` (trùng bản, không hại) |
| plugin khác trong `enabledPlugins` của settings.json track | `project` |

- [ ] **Step 1: Test thất bại** `apps/crew-mac/test/workflows-inventory.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { classifyOrigin } from '../src/workflows/inventory.js';

const root = '/Users/a/crew-agents/exec';
const pinDir = '/Users/a/.crew/workflows/superpowers/6.4.1-5bf4e7801107';

describe('classifyOrigin', () => {
  it('phân loại theo vị trí và git track', () => {
    expect(classifyOrigin({ path: `${pinDir}/skills/brainstorming`, root, pinDir, tracked: false })).toBe('pinned');
    expect(classifyOrigin({ path: `${root}/.paperclip-runtime/claude/skills/paperclip`, root, pinDir, tracked: false })).toBe('paperclip');
    expect(classifyOrigin({ path: `${root}/.claude/skills/x`, root, pinDir, tracked: true })).toBe('project');
    expect(classifyOrigin({ path: `${root}/.claude/skills/x`, root, pinDir, tracked: false })).toBe('blocked');
    expect(classifyOrigin({ path: '/Users/a/.claude/skills/tro-ly', root, pinDir, tracked: false })).toBe('blocked');
  });
});
```

và `discoverSources` trên repo git thật trong `mkdtemp` (dùng runner thật `createRunner()` của `src/system.ts` cho `git`): repo có `.claude/skills/tracked` (đã commit) + `.claude/skills/stray` (chưa commit) + `.claude/settings.local.json` `{"hooks":{}}` → kỳ vọng `tracked` là `project`, `stray` và `settings.local.json` là `blocked`. Thêm test **"plugin project lệch pin"** (Review Focus 5): `.claude/settings.json` (commit) `{"enabledPlugins":{"superpowers@claude-plugins-official":true}}`, `installed_plugins.json` của home giả trỏ cây có checksum khác pin → nguồn `plugin` `blocked` với `reason` chứa `WORKFLOW_SOURCE_MISMATCH`.

- [ ] **Step 2: Chạy, kỳ vọng FAIL**

Run: `pnpm --filter @crew/mac exec vitest run test/workflows-inventory.test.ts`
Expected: FAIL (không có `inventory.js`).

- [ ] **Step 3: Viết `apps/crew-mac/src/workflows/inventory.ts`**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { MacContext } from '../context.js';
import { comparablePath } from '../paths.js';
import { readInstalledPlugins } from './install.js';
import { SUPERPOWERS_PIN, superpowersPinDir, type WorkflowPin } from './pin.js';
import { assertSkillAllowed } from './policy.js';
import { treeChecksum } from './tree-checksum.js';

export type Origin = 'pinned' | 'paperclip' | 'project' | 'blocked';

export interface DiscoveredSource {
  path: string;
  kind: 'skill' | 'agent' | 'command' | 'plugin' | 'settings';
  origin: Origin;
  reason?: string;
}

function contained(parent: string, child: string): boolean {
  const rel = relative(comparablePath(parent), comparablePath(child));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && rel !== '..');
}

/** Port từ v2 isolation/inventory.ts `classifyOrigin`, giản lược: không sandbox, chỉ vị trí + git track. */
export function classifyOrigin(input: { path: string; root: string; pinDir: string; tracked: boolean }): Origin {
  if (contained(input.pinDir, input.path)) return 'pinned';
  if (contained(join(input.root, '.paperclip-runtime'), input.path)) return 'paperclip';
  if (contained(input.root, input.path) && input.tracked) return 'project';
  return 'blocked';
}

async function isTracked(ctx: MacContext, root: string, path: string): Promise<boolean> {
  const r = await ctx.runner.run('/usr/bin/git', ['-C', root, 'ls-files', '--', relative(root, path)], { timeoutMs: 10_000 });
  return r.code === 0 && r.stdout.trim() !== '';
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function discoverSources(
  ctx: MacContext,
  root: string,
  pin: WorkflowPin = SUPERPOWERS_PIN,
): Promise<DiscoveredSource[]> {
  const pinDir = superpowersPinDir(ctx.home, pin);
  const found: DiscoveredSource[] = [];
  for (const [kind, sub] of [['skill', 'skills'], ['agent', 'agents'], ['command', 'commands']] as const) {
    const dir = join(root, '.claude', sub);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const origin = classifyOrigin({ path, root, pinDir, tracked: await isTracked(ctx, root, path) });
      found.push({ path, kind, origin, ...(origin === 'blocked' ? { reason: 'không được git track trong worktree agent' } : {}) });
    }
  }
  const local = join(root, '.claude', 'settings.local.json');
  const localJson = existsSync(local) ? readJson(local) : null;
  if (localJson && (localJson.enabledPlugins || localJson.hooks)) {
    found.push({ path: local, kind: 'settings', origin: 'blocked', reason: 'settings.local.json bật plugin hoặc hook trong worktree agent' });
  }
  const shared = join(root, '.claude', 'settings.json');
  if (existsSync(shared)) {
    const tracked = await isTracked(ctx, root, shared);
    const json = readJson(shared);
    if (!tracked) found.push({ path: shared, kind: 'settings', origin: 'blocked', reason: 'settings.json không được git track' });
    const plugins = (json?.enabledPlugins ?? {}) as Record<string, unknown>;
    for (const [key, on] of Object.entries(plugins)) {
      if (on !== true) continue;
      if (!key.startsWith(`${pin.workflow}@`)) {
        found.push({ path: `${shared}#${key}`, kind: 'plugin', origin: tracked ? 'project' : 'blocked' });
        continue;
      }
      const same = readInstalledPlugins(ctx.home, key).some((e) => {
        try {
          assertSkillAllowed(pin, { ...pin, version: e.version, revision: e.gitCommitSha ?? '', checksum: treeChecksum(e.installPath).checksum });
          return true;
        } catch {
          return false;
        }
      });
      found.push({ path: `${shared}#${key}`, kind: 'plugin', origin: same ? 'pinned' : 'blocked', ...(same ? {} : { reason: 'WORKFLOW_SOURCE_MISMATCH' }) });
    }
  }
  return found;
}
```

- [ ] **Step 4: Chạy, kỳ vọng PASS**

Run: `pnpm --filter @crew/mac exec vitest run test/workflows-inventory.test.ts`
Expected: PASS.

- [ ] **Step 5: Test thất bại cho lệnh** `apps/crew-mac/test/workflow-check.test.ts` — dùng `FIXTURE_PIN` + cây giả của SP-2 (helper chung `seedOwnerPlugin` chuyển sang `test/helpers/fake-mac.ts`):
  - đúng pin, worktree sạch → `{ ok: true }`, dòng đầu bắt đầu `crew-workflow ok pin=superpowers@9.9.9`;
  - `pluginDir` là cache của owner (không phải thư mục ghim) → `ok: false`, dòng chứa `không phải bản ghim`;
  - thư mục ghim bị sửa một file → `ok: false`, dòng chứa `WORKFLOW_SOURCE_MISMATCH`;
  - worktree có `.claude/skills/stray` chưa track → `ok: false`, dòng `crew-workflow blocked: <root>/.claude/skills/stray (không được git track trong worktree agent)`.
  - qua `cli`: thiếu `--root` → mã 2; blocked → mã 78.

- [ ] **Step 6: Chạy, kỳ vọng FAIL**

Run: `pnpm --filter @crew/mac exec vitest run test/workflow-check.test.ts`
Expected: FAIL.

- [ ] **Step 7: Viết `apps/crew-mac/src/commands/workflow-check.ts` và case CLI**

```ts
import type { MacContext } from '../context.js';
import { comparablePath } from '../paths.js';
import { discoverSources } from '../workflows/inventory.js';
import { SUPERPOWERS_PIN, superpowersPinDir, type WorkflowPin } from '../workflows/pin.js';
import { assertSkillAllowed } from '../workflows/policy.js';
import { treeChecksum } from '../workflows/tree-checksum.js';

export async function workflowCheck(
  ctx: MacContext,
  input: { root: string; pluginDir: string; pin?: WorkflowPin },
): Promise<{ ok: boolean; lines: string[] }> {
  const pin = input.pin ?? SUPERPOWERS_PIN;
  const expected = superpowersPinDir(ctx.home, pin);
  const lines: string[] = [];
  if (comparablePath(input.pluginDir) !== comparablePath(expected)) {
    lines.push(`crew-workflow blocked: --plugin-dir ${input.pluginDir} không phải bản ghim ${expected}`);
  } else {
    try {
      assertSkillAllowed(pin, { ...pin, checksum: treeChecksum(expected).checksum });
    } catch (err) {
      lines.push(`crew-workflow blocked: ${expected} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  const sources = await discoverSources(ctx, input.root, pin);
  for (const s of sources.filter((x) => x.origin === 'blocked')) {
    lines.push(`crew-workflow blocked: ${s.path} (${s.reason ?? 'nguồn ngoài danh sách cho phép'})`);
  }
  if (lines.length > 0) return { ok: false, lines };
  const count = (o: string) => sources.filter((s) => s.origin === o).length;
  return {
    ok: true,
    lines: [`crew-workflow ok pin=${pin.workflow}@${pin.version} project=${count('project')} pinned-dup=${count('pinned')}`],
  };
}
```

`cli.ts`:

```ts
      case 'workflow-check': {
        const flags = parseFlags(args, ['--root', '--plugin-dir']);
        const root = flags.value('--root');
        const pluginDir = flags.value('--plugin-dir');
        if (!root || !pluginDir || !isAbsolute(root) || !isAbsolute(pluginDir)) {
          io.err('crew-mac workflow-check --root <đường dẫn tuyệt đối> --plugin-dir <đường dẫn tuyệt đối>');
          return 2;
        }
        const report = await workflowCheck(ctx, { root, pluginDir });
        for (const line of report.lines) (report.ok ? io.out : io.err)(line);
        return report.ok ? 0 : 78;
      }
```

Help thêm dòng `  crew-mac workflow-check --root <worktree> --plugin-dir <dir>   (wrapper gọi trước mỗi run)`.

- [ ] **Step 8: Wrapper** — `apps/crew-mac/assets/crew-claude-run.sh`, chèn ngay sau dòng comment đầu, trước `if [ -n "${PAPERCLIP_RUN_ID:-}" ]; then` hiện có:

```sh
# Runs started by Paperclip must use the pinned Superpowers copy and nothing loaded from outside it.
if [ -n "${PAPERCLIP_RUN_ID:-}" ]; then
  plugin_dir=""
  prev=""
  for arg in "$@"; do
    [ "$prev" = "--plugin-dir" ] && plugin_dir=$arg
    prev=$arg
  done
  if [ -z "$plugin_dir" ]; then
    echo "crew-claude-run: thiếu --plugin-dir của Superpowers đã ghim trong adapterConfig.extraArgs (chạy crew-mac setup để xem giá trị)" >&2
    exit 78
  fi
  "${CREW_MAC_BIN:-$HOME/.crew/bin/crew-mac}" workflow-check --root "$PWD" --plugin-dir "$plugin_dir" >&2 || exit 78
fi
```

`test/crew-claude-run.test.ts`: các test hiện có đặt `PAPERCLIP_RUN_ID` → thêm `--plugin-dir /x` vào args và `CREW_MAC_BIN` trỏ script giả `#!/bin/sh\nexit 0`. Thêm ba test: thiếu `--plugin-dir` → exit 78, không chạy claude giả, không tạo `pgid`; `CREW_MAC_BIN` giả exit 78 → wrapper exit 78, claude giả không chạy; không có `PAPERCLIP_RUN_ID` → không gọi `CREW_MAC_BIN` (script giả ghi file đánh dấu, kỳ vọng không có file).

Không đồng bộ fixture `server/src/__tests__/fixtures/crew-claude-run.sh` của fork: test H3 cần hợp đồng `pgid`/`started`, không cần bước kiểm workflow (ruling).

- [ ] **Step 9: Chạy, kỳ vọng PASS**

Run: `pnpm --filter @crew/mac exec vitest run test/workflows-inventory.test.ts test/workflow-check.test.ts test/crew-claude-run.test.ts test/cli.test.ts`
Run: `pnpm --filter @crew/mac test && pnpm --filter @crew/mac typecheck && pnpm --filter @crew/mac build`
Expected: PASS toàn package (đây là package bị đổi; không chạy suite khác).

- [ ] **Step 10: Docs** — flow `mac-workflows` trong `docs/flows.yaml`: `entrypoints` thêm `apps/crew-mac/src/commands/workflow-check.ts`; `files` thêm `apps/crew-mac/src/workflows/inventory.ts`; `tests` thêm `apps/crew-mac/test/workflows-inventory.test.ts`, `apps/crew-mac/test/workflow-check.test.ts`. `docs/flows/mac-workflows.md`: bảng phân loại nguồn, mã thoát 78 của wrapper, cách đọc dòng `crew-workflow blocked` trong log run. `mac-setup.md`: lệnh mới `workflow-check` trong `cli.ts`. Chạy `node packages/docs-kit/dist/crew-docs.cjs generate`.

- [ ] **Step 11: Commit**

```bash
git add apps/crew-mac/src/workflows/inventory.ts apps/crew-mac/src/commands/workflow-check.ts apps/crew-mac/src/cli.ts \
  apps/crew-mac/assets/crew-claude-run.sh apps/crew-mac/test docs/flows.yaml docs/flows/mac-workflows.md docs/flows/mac-setup.md docs/index.md
node packages/docs-kit/dist/crew-docs.cjs check --staged
git commit -m "feat(crew-mac): refuse agent runs that load skills outside the pinned Superpowers copy"
```

## Rủi ro và rollback

| Rủi ro | Khả năng × tác động | Giảm thiểu |
|---|---|---|
| `--plugin-dir` không nạp dưới `--setting-sources project,local` | Trung bình × Cao | SP-1 kiểm trước; dự phòng settings project-scope (ruling) |
| Skill user `~/.claude/skills` vẫn lọt | Trung bình × Trung bình | SP-1 phát hiện; hỏi owner (không tự đổi `HOME`/`CLAUDE_CONFIG_DIR` vì owner đã chốt dùng Keychain) |
| Repo dự án commit `superpowers@…` bản khác → mọi run bị chặn | Thấp × Trung bình | Dòng `blocked` nói rõ; owner chọn bỏ enabledPlugins hoặc nâng pin |
| Claude ghi file vào thư mục plugin lúc chạy → checksum lệch, run sau bị chặn | Thấp × Cao | SP-1 kiểm `treeChecksum` thư mục cache trước/sau lượt A; lệch thì báo Trợ Lý trước khi làm SP-2 |
| Wrapper thêm ~200 ms mỗi run | Cao × Thấp | Chấp nhận |

Rollback: bỏ `--plugin-dir` khỏi `extraArgs` không đủ (wrapper chặn); rollback = cài lại gói crew-mac bản trước SP-3 (`~/.crew/app/crew-mac-<sha>.tgz` cũ) và chạy `setup`. Thư mục `~/.crew/workflows/` để nguyên, vô hại.
