# R2-4 — Gói `mac-runtimes` (repo Crew, `apps/crew-mac`)

- **Nhánh:** `r24/mac-runtimes`, worktree `.worktrees/crew-r24-runtimes`, rẽ từ `r2-4`. `r2-4` rẽ từ `r2-3` sau khi
  R2-3 MW-4 đã ff.
- **Nạp chung:**
  - `apps/crew-mac/{assets/crew-claude-run.sh,src/wrapper.ts,src/paths.ts,src/context.ts,src/system.ts,src/cli.ts}`;
  - `src/commands/{setup,doctor,workflow-check}.ts`;
  - `src/workflows/{registry,pin,inventory}.ts`;
  - `src/reaper/{run-members,select}.ts`;
  - `src/status/report.ts`;
  - test `test/{crew-claude-run,setup,doctor,workflow-check,reaper-select,status-report}.test.ts`;
  - `reports/sp-0-probe.md`;
  - Interface I6, I7, I8 trong [plan.md](plan.md).
- **Lệnh kiểm mỗi ticket:**
  - `pnpm --filter @crew/mac test -- <file test của ticket>`;
  - `pnpm --filter @crew/mac typecheck`;
  - `pnpm exec biome check apps/crew-mac docs`;
  - `node packages/docs-kit/dist/crew-docs.cjs check --staged`.
- **Test:**
  - HOME tạm (`mkdtempSync(join(tmpdir(), 'crew-rt-'))`), không đụng `~/.crew`, `~/.codex`, Keychain thật;
  - Keychain giả qua `CREW_SECURITY_BIN`;
  - CLI giả qua `CREW_CODEX_BIN`/`CREW_OPENCODE_BIN`, chỉ cho test, cùng kiểu `CREW_CLAUDE_BIN`.

### Task MR-1: Wrapper Codex/OpenCode, Keychain, setup, doctor

**Files:**
- Create:
  - `apps/crew-mac/assets/{crew-run-mark.sh,crew-codex-run.sh,crew-opencode-run.sh}`;
  - `apps/crew-mac/src/runtimes/{paths.ts,keychain.ts,command.ts}`;
  - `apps/crew-mac/test/{crew-codex-run,crew-opencode-run,runtimes-keychain,runtimes-command}.test.ts`;
  - `docs/flows/mac-runtimes.md`.
- Modify:
  - `apps/crew-mac/src/wrapper.ts` (thêm `CODEX_WRAPPER_SOURCE`, `OPENCODE_WRAPPER_SOURCE`, `RUN_MARK_SOURCE`);
  - `apps/crew-mac/src/paths.ts` (`codexWrapper`, `opencodeWrapper`, `runMark`, `runtimesRoot`, `superpowersDirFile`);
  - `src/commands/setup.ts` (cài 3 file, ghi `superpowers-dir`);
  - `src/commands/doctor.ts` (4 check);
  - `src/cli.ts` (nhánh `runtimes`);
  - `src/index.ts`;
  - `test/{setup,doctor}.test.ts`;
  - `docs/flows.yaml` (khối `mac-runtimes`), `docs/flows/mac-setup.md`, `docs/files.md` (sinh).

**Interfaces:**
- Consumes: `superpowersPinDir(home)` (R2-3 `pin.ts`); `sshArgs` (doctor); `writeIfChanged` (setup).
- Produces:
  - wrapper I6;
  - `macPaths(home).{codexWrapper,opencodeWrapper,runMark,runtimesRoot,superpowersDirFile}`;
  - `KEYCHAIN_SERVICE = 'crew.opencode-go'`, `KEYCHAIN_ACCOUNT = 'crew'`;
  - `keychainHasKey(ctx): Promise<boolean>`;
  - `runtimesCommand(ctx, argv): Promise<number>`, gồm:
    - `runtimes key opencode` (stdin);
    - `runtimes status`;
    - `runtimes skills-checksum`;
    - `runtimes key-fingerprint opencode`.

- [ ] **Step 1: Test đỏ cho `crew-codex-run`** (`test/crew-codex-run.test.ts`):

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODEX_WRAPPER_SOURCE } from '../src/wrapper.js';

const RUN = '11111111-2222-4333-8444-555555555555';
const AGENT = '22222222-3333-4444-8555-666666666666';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'crew-rt-'));
  const root = join(home, 'wt'); mkdirSync(root);
  const asset = join(home, 'asset-home'); mkdirSync(join(asset, 'skills'), { recursive: true });
  writeFileSync(join(asset, 'config.toml'), 'model = "gpt-6-luna"\n');
  mkdirSync(join(home, '.codex')); writeFileSync(join(home, '.codex', 'auth.json'), '{"x":1}', { mode: 0o600 });
  const bin = join(home, 'codex'); const seen = join(home, 'codex.env');
  writeFileSync(bin, `#!/bin/sh\nenv > '${seen}'\nprintf '%s\\n' "$@" >> '${seen}'\n`, { mode: 0o755 });
  const crewMac = join(home, 'crew-mac'); writeFileSync(crewMac, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return { home, root, asset, bin, seen, crewMac };
}
function run(t: ReturnType<typeof setup>, env: Record<string, string>): { code: number; stderr: string } {
  try {
    execFileSync('/bin/sh', [CODEX_WRAPPER_SOURCE, 'exec', '--json', '-'], {
      cwd: t.root, stdio: 'pipe',
      env: { PATH: '/usr/bin:/bin', HOME: t.home, CODEX_HOME: t.asset, CREW_CODEX_BIN: t.bin, CREW_MAC_BIN: t.crewMac, ...env },
    });
    return { code: 0, stderr: '' };
  } catch (e) { const x = e as { status: number; stderr: Buffer }; return { code: x.status, stderr: x.stderr.toString() }; }
}

describe('crew-codex-run', () => {
  it('dựng CODEX_HOME riêng của agent, auth.json là symlink, asset không bị thêm file', () => {
    const t = setup();
    expect(run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT }).code).toBe(0);
    const home = join(t.home, '.crew', 'runtimes', 'codex', AGENT);
    expect(readlinkSync(join(home, 'auth.json'))).toBe(join(t.home, '.codex', 'auth.json'));
    expect(lstatSync(join(home, 'skills')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toContain('gpt-6-luna');
    expect(readdirSync(t.asset).sort()).toEqual(['config.toml', 'skills']);
    expect(readFileSync(t.seen, 'utf8')).toContain(`CODEX_HOME=${home}`);
    expect(existsSync(join(t.root, '.paperclip-runtime', 'runs', RUN, 'pgid'))).toBe(true);
  });
  it('thiếu đăng nhập thì thoát 78, không chạy codex', () => {
    const t = setup(); execFileSync('rm', [join(t.home, '.codex', 'auth.json')]);
    const r = run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
    expect(r.code).toBe(78);
    expect(r.stderr).toMatch(/^crew-runtime blocked: Codex chưa đăng nhập trên máy/m);
    expect(existsSync(t.seen)).toBe(false);
  });
  it('PAPERCLIP_AGENT_ID sai dạng trong run thì thoát 78', () => {
    const t = setup();
    expect(run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: '../x' }).code).toBe(78);
  });
  it('workflow-check từ chối thì thoát 78', () => {
    const t = setup(); writeFileSync(t.crewMac, '#!/bin/sh\necho "crew-workflow blocked: x" >&2\nexit 1\n', { mode: 0o755 });
    expect(run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT }).code).toBe(78);
  });
  it('ngoài run (adapter gọi --version) thì dùng thư mục shared, không ghi run marker', () => {
    const t = setup();
    expect(run(t, {}).code).toBe(0);
    expect(readFileSync(t.seen, 'utf8')).toContain(`CODEX_HOME=${join(t.home, '.crew', 'runtimes', 'codex', 'shared')}`);
    expect(existsSync(join(t.root, '.paperclip-runtime'))).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, phải đỏ.** `pnpm --filter @crew/mac test -- test/crew-codex-run.test.ts`. Kỳ vọng: FAIL vì
  `CODEX_WRAPPER_SOURCE` không có.

- [ ] **Step 3: Viết `assets/crew-run-mark.sh`.** Chép nguyên khối ghi `started`/`pgid` của `crew-claude-run.sh`
  (từ `case "$PAPERCLIP_RUN_ID" in` tới `esac`), đặt trong hàm `crew_run_mark` không đối số. Không đổi
  `crew-claude-run.sh`.

- [ ] **Step 4: Viết `assets/crew-codex-run.sh`:**

```sh
#!/bin/sh
# Crew wrapper for codex_local on the Mac (adapterConfig.command). Credential stays on the Mac:
# the adapter's CODEX_HOME asset is never given an auth.json, so the lease-release copy-back has nothing to send.
# CREW_CODEX_BIN, CREW_MAC_BIN exist for tests only.
here=$(cd "$(dirname "$0")" && pwd)
. "$here/crew-run-mark.sh"
uuid_re='^[0-9a-fA-F]\{8\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{12\}$'
slot=shared
if [ -n "${PAPERCLIP_RUN_ID:-}" ]; then
  if ! printf '%s' "${PAPERCLIP_AGENT_ID:-}" | grep -q "$uuid_re"; then
    echo "crew-runtime blocked: thiếu PAPERCLIP_AGENT_ID" >&2; exit 78
  fi
  slot=$PAPERCLIP_AGENT_ID
  "${CREW_MAC_BIN:-$HOME/.crew/bin/crew-mac}" workflow-check --runtime codex_local --root "$PWD" >&2 || {
    echo "crew-workflow blocked: crew-mac workflow-check từ chối run này (xem các dòng trên)" >&2; exit 78; }
fi
if [ ! -e "$HOME/.codex/auth.json" ]; then
  echo 'crew-runtime blocked: Codex chưa đăng nhập trên máy (chạy "codex login" trong phiên desktop)' >&2; exit 78
fi
asset=${CODEX_HOME:-}
dest="$HOME/.crew/runtimes/codex/$slot"
umask 077
mkdir -p "$dest/sessions" || exit 78
if [ -n "$asset" ] && [ "$asset" != "$dest" ]; then
  [ -f "$asset/config.toml" ] && cp "$asset/config.toml" "$dest/config.toml.tmp" && mv "$dest/config.toml.tmp" "$dest/config.toml"
  if [ -d "$asset/skills" ]; then rm -f "$dest/skills"; ln -s "$asset/skills" "$dest/skills"; fi
fi
ln -sfn "$HOME/.codex/auth.json" "$dest/auth.json"
export CODEX_HOME="$dest"
sp_file="$HOME/.crew/runtimes/superpowers-dir"
[ -r "$sp_file" ] && CREW_SUPERPOWERS_DIR=$(cat "$sp_file") && export CREW_SUPERPOWERS_DIR
[ -n "${PAPERCLIP_RUN_ID:-}" ] && crew_run_mark
exec "${CREW_CODEX_BIN:-codex}" "$@"
```

- [ ] **Step 5: Chạy test, phải xanh.** Cùng lệnh Step 2. Kỳ vọng: PASS 5/5.

- [ ] **Step 6: Test đỏ cho `crew-opencode-run`** (`test/crew-opencode-run.test.ts`). Cùng khuôn Step 1, khác:
  - `CREW_SECURITY_BIN` là script giả in chuỗi mốc `MOC-KEY-7Q4ZK-r24` khi đối số có `-w`, thoát 44 khi đặt
    `FAKE_NO_KEY=1`.
  - Opencode giả ghi `env` và argv ra file.

  Các ca:

```ts
it('key chỉ vào env của opencode; không có trong argv, stderr, stdout, file dưới HOME', () => {
  const t = setupOpencode();
  const r = runOpencode(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
  expect(r.code).toBe(0);
  const seen = readFileSync(t.seen, 'utf8');
  expect(seen).toMatch(/^CREW_OPENCODE_GO_KEY=MOC-KEY-7Q4ZK-r24$/m);           // env của process con
  expect(seen.split('\n--argv--\n')[1]).not.toContain('MOC-KEY');            // argv
  expect(r.stdout + r.stderr).not.toContain('MOC-KEY');
  const leaks = execFileSync('/usr/bin/grep', ['-rl', 'MOC-KEY', join(t.home, '.crew')], { encoding: 'utf8' }).trim();
  expect(leaks).toBe('');   // grep thoát 1 khi không thấy: bọc try, coi status 1 là rỗng
});
it('OPENCODE_CONFIG_CONTENT trỏ {env:CREW_OPENCODE_GO_KEY} và cho phép external_directory', () => {
  const seen = readFileSync(runAndGetSeen(), 'utf8');
  const line = seen.split('\n').find((l) => l.startsWith('OPENCODE_CONFIG_CONTENT='))!;
  const cfg = JSON.parse(line.slice('OPENCODE_CONFIG_CONTENT='.length));
  expect(cfg.provider['opencode-go'].options.apiKey).toBe('{env:CREW_OPENCODE_GO_KEY}');
  expect(cfg.permission.external_directory).toBe('allow');
});
it('XDG_DATA_HOME riêng của agent, giữ XDG_CONFIG_HOME adapter đưa vào', () => {
  const t = setupOpencode();
  runOpencode(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT, XDG_CONFIG_HOME: join(t.home, 'asset-xdg') });
  const seen = readFileSync(t.seen, 'utf8');
  expect(seen).toContain(`XDG_DATA_HOME=${join(t.home, '.crew', 'runtimes', 'opencode', AGENT, 'data')}`);
  expect(seen).toContain(`XDG_CONFIG_HOME=${join(t.home, 'asset-xdg')}`);
});
it('thiếu key trong Keychain thì 78 với câu cố định, không chạy opencode', () => {
  const t = setupOpencode();
  const r = runOpencode(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT, FAKE_NO_KEY: '1' });
  expect(r.code).toBe(78);
  expect(r.stderr).toContain('crew-runtime blocked: thiếu key OpenCode Go trong Keychain (service crew.opencode-go)');
  expect(existsSync(t.seen)).toBe(false);
});
```

  Nếu G0 O2 chốt biến/khuôn cấu hình khác thì sửa chuỗi kỳ vọng theo `reports/sp-0-probe.md` trước khi chạy.

- [ ] **Step 7: Chạy test, phải đỏ.**

- [ ] **Step 8: Viết `assets/crew-opencode-run.sh`.**
  - Khuôn Step 4: phần đầu (mark, uuid, workflow-check với `opencode_local`) giống.
  - Phần riêng:

```sh
key=$("${CREW_SECURITY_BIN:-/usr/bin/security}" find-generic-password -s crew.opencode-go -a crew -w 2>/dev/null) || key=""
if [ -z "$key" ]; then
  echo 'crew-runtime blocked: thiếu key OpenCode Go trong Keychain (service crew.opencode-go); owner chạy "crew-mac runtimes key opencode"' >&2; exit 78
fi
CREW_OPENCODE_GO_KEY=$key; unset key; export CREW_OPENCODE_GO_KEY
base="$HOME/.crew/runtimes/opencode/$slot"; umask 077; mkdir -p "$base/data" "$base/state" "$base/cache" "$base/config" || exit 78
export XDG_DATA_HOME="$base/data" XDG_STATE_HOME="$base/state" XDG_CACHE_HOME="$base/cache"
[ -n "${XDG_CONFIG_HOME:-}" ] || export XDG_CONFIG_HOME="$base/config"
export OPENCODE_CONFIG_CONTENT='{"provider":{"opencode-go":{"options":{"apiKey":"{env:CREW_OPENCODE_GO_KEY}"}}},"permission":{"edit":"allow","bash":"allow","external_directory":"allow"}}'
```

  - Rồi `CREW_SUPERPOWERS_DIR`, `crew_run_mark`, `exec "${CREW_OPENCODE_BIN:-opencode}" "$@"`.

- [ ] **Step 9: Chạy test, phải xanh.**

- [ ] **Step 10: Test đỏ `runtimes-keychain.test.ts` + `runtimes-command.test.ts`.** Runner giả (`ctx.runner`) ghi
  lệnh. Các ca:
  - `runtimes key opencode` chạy `security add-generic-password -U -s crew.opencode-go -a crew -w` với
    `stdio: 'inherit'`:
    - `-w` đứng cuối, không giá trị, nên `security` tự hỏi key trên terminal (gõ ẩn, hai lần). Key không bao giờ đi
      qua argv hay qua `crew-mac`;
    - không có TTY (`!process.stdin.isTTY`) thì exit 2 `runtimes: cần chạy trong Terminal của owner`;
    - mã 0 thì in `đã lưu`.
  - Test khẳng định argv gửi runner đúng như trên, kết thúc bằng `-w`, không có phần tử sau `-w`.
  - Output không chứa key.
  - `runtimes status` in 3 dòng:
    - `claude_local: <phiên bản> · đăng nhập <có|không>`;
    - `codex_local: …`;
    - `opencode_local: <phiên bản> · key <có|không>`.

    Dùng `keychainHasKey` (không `-w`).
  - `runtimes skills-checksum` in sha256 của cây `~/.claude/skills`:
    - dùng lại `treeChecksum` của `workflows/tree-checksum.ts`;
    - thư mục thiếu thì in `không có`.
  - `runtimes key-fingerprint opencode` in 12 hex đầu của sha256(key). Key đọc qua `security -w` trong process, không
    in key.

- [ ] **Step 11: Viết `src/runtimes/{paths,keychain,command}.ts`, nhánh `case 'runtimes'` trong `cli.ts`, export
  trong `index.ts`.** Chạy test, phải xanh.

- [ ] **Step 12: Setup và doctor (test đỏ trước).**
  - `test/setup.test.ts` thêm ca:
    - `setup` ghi `~/.crew/bin/{crew-codex-run,crew-opencode-run}` 0755 và `crew-run-mark.sh` 0644;
    - ghi `~/.crew/runtimes/superpowers-dir` = `superpowersPinDir(home)` (0600).
  - `test/doctor.test.ts` thêm 4 check. Runner giả trả đầu ra lấy từ SP-0:
    - `wrapper-codex`: file có, chạy được `crew-codex-run --version` qua sshd agent;
    - `wrapper-opencode`: tương tự, kèm `opencode-in-place`: `warn` khi `~/.crew/runtimes/opencode-in-place` không có
      (DP-1 ghi file này khi P6 đã deploy);
    - `codex-auth`: `codex login status` qua sshd agent, câu đạt theo SP-0 C1;
    - `opencode-key`: `keychainHasKey`, lỗi kèm gợi ý `crew-mac runtimes key opencode`.

    Codex/OpenCode chưa cài thì `warn` (không phải `fail`): máy chưa dùng runtime đó.
  - Viết code tới khi xanh.

- [ ] **Step 13: Docs.**
  - `docs/flows/mac-runtimes.md` (tiếng Việt):
    - mục đích, luồng wrapper;
    - bảng exit 78;
    - Keychain service/account;
    - thư mục `~/.crew/runtimes`;
    - lệnh `runtimes`;
    - ranh giới credential.
  - Khối `mac-runtimes` trong `docs/flows.yaml` liệt kê file mới.
  - `docs/flows/mac-setup.md` thêm 2 wrapper + 4 check.
  - `node packages/docs-kit/dist/crew-docs.cjs generate`.

- [ ] **Step 14: Kiểm và commit.**
  - Lệnh kiểm của gói.
  - `git add apps/crew-mac docs && git commit -m "feat(crew-mac): wrapper Codex và OpenCode Go, key trong Keychain, doctor runtime"`.

### Task MR-2: `workflow-check --runtime` và sổ workflow

**Files:**
- Create: `apps/crew-mac/src/workflows/runtime-sources.ts`, `test/workflow-check-runtime.test.ts`.
- Modify:
  - `src/workflows/registry.ts` (`runtimes` của `superpowers`: `['claude_local','codex_local','opencode_local']`, kiểu
    `readonly CrewRuntime[]`);
  - `src/commands/workflow-check.ts`;
  - `src/cli.ts` (cờ `--runtime` trong nhánh có sẵn);
  - `test/workflows-registry.test.ts`;
  - `docs/flows/{mac-runtimes,mac-workflows}.md`.

**Interfaces:**
- Consumes: `treeChecksum`, `SUPERPOWERS_PIN`, `superpowersPinDir`, `certifiedWorkflows` (R2-3).
- Produces:

```ts
export type CrewRuntime = 'claude_local' | 'codex_local' | 'opencode_local';
export interface RuntimeSourceFinding { path: string; reason: 'runtime-config' | 'pin-mismatch' | 'pin-missing' }
export function findRuntimeSources(input: { root: string; runtime: 'codex_local' | 'opencode_local'; tracked: ReadonlySet<string> }): RuntimeSourceFinding[];
export async function workflowCheckRuntime(ctx: MacContext, input: { root: string; runtime: 'codex_local' | 'opencode_local' }): Promise<{ ok: boolean; lines: string[] }>;
```

- [ ] **Step 1: Test đỏ:**

```ts
it('chặn cấu hình runtime trong worktree không được git theo dõi', () => {
  const root = tmpRepo({ untracked: ['.codex/config.toml', '.opencode/agent/x.md', 'opencode.json'] });
  expect(findRuntimeSources({ root, runtime: 'opencode_local', tracked: new Set() }).map((f) => f.path).sort())
    .toEqual(['.opencode/agent/x.md', 'opencode.json']);
  expect(findRuntimeSources({ root, runtime: 'codex_local', tracked: new Set() }).map((f) => f.path))
    .toEqual(['.codex/config.toml']);
});
it('file được git theo dõi thì không chặn', () => {
  const root = tmpRepo({ tracked: ['opencode.json'] });
  expect(findRuntimeSources({ root, runtime: 'opencode_local', tracked: new Set(['opencode.json']) })).toEqual([]);
});
it('CREW_SUPERPOWERS_DIR lệch bản ghim thì chặn với pin-mismatch', async () => {
  const r = await workflowCheckRuntime(ctxWithEnv({ CREW_SUPERPOWERS_DIR: '/tmp/khac' }), { root: tmpRepo({}), runtime: 'codex_local' });
  expect(r.ok).toBe(false);
  expect(r.lines[0]).toMatch(/^crew-workflow blocked: CREW_SUPERPOWERS_DIR/);
});
it('CLI: workflow-check --runtime codex_local --root <dir> thoát 0 khi sạch, 1 khi bị chặn; --runtime lạ thoát 2', async () => { /* gọi main(['workflow-check', ...]) như test cli hiện có */ });
```

- [ ] **Step 2: Chạy test, phải đỏ.**

- [ ] **Step 3: Viết code.**
  - `tracked` lấy bằng `git -C root ls-files -z -- .codex .opencode opencode.json opencode.jsonc`.
  - Pin so bằng `treeChecksum(CREW_SUPERPOWERS_DIR) === SUPERPOWERS_PIN.checksum`.
  - Dòng ok: `crew-workflow ok runtime=<r> superpowers=<version>`.
- [ ] **Step 4: Chạy test, phải xanh.** Chạy thêm toàn bộ test `workflow*` của R2-3.
- [ ] **Step 5: Docs + commit** `feat(crew-mac): kiểm nguồn nạp chéo cho run Codex và OpenCode`.

### Task MR-3: Bộ dọn nhận `codex exec` và `opencode run`

**Files:**
- Modify: `apps/crew-mac/src/reaper/{run-members,select}.ts`, `test/{run-members,reaper-select}.test.ts`,
  `docs/flows/mac-orphan-reaper.md`.
- Create: `test/fixtures/ps/{codex-exec,opencode-run}.txt` (chép dòng `ps` đã làm sạch từ `reports/sp-0-probe.md`;
  Codex là dòng dựng từ `codex-args.ts`, có ghi chú đầu file).

**Interfaces:**
- Produces: `isAgentPrint(p: ProcInfo): boolean`. `isClaudePrint` giữ nguyên để không vỡ import.

- [ ] **Step 1: Test đỏ:**

```ts
it.each([
  ['claude --print', '/Users/u/.local/bin/claude --print --output-format stream-json', true],
  ['codex exec', readFixture('codex-exec.txt'), true],
  ['opencode run', readFixture('opencode-run.txt'), true],
  ['codex login', '/Users/u/.local/bin/codex login status', false],
  ['opencode models', '/opt/homebrew/bin/opencode models opencode-go', false],
  ['opencode serve', '/opt/homebrew/bin/opencode serve', false],
])('%s', (_name, command, expected) => {
  expect(isAgentPrint({ pid: 10, ppid: 1, pgid: 10, comm: 'x', command, runId: RUN } as ProcInfo)).toBe(expected);
});
it('không có runId thì không phải agent run', () => {
  expect(isAgentPrint({ pid: 10, ppid: 1, pgid: 10, comm: 'x', command: readFixture('codex-exec.txt'), runId: null } as ProcInfo)).toBe(false);
});
it('selectTargets chọn opencode run mồ côi quá hạn', () => { /* như ca claude hiện có, đổi command */ });
```

- [ ] **Step 2: Chạy test, phải đỏ.**
- [ ] **Step 3: Viết code.**
  - Exe = token đầu: `codex`, `*/codex`, `opencode`, `*/opencode`, hoặc `node …/codex.js`/`…/opencode` nếu fixture SP-0
    cho thấy chạy qua node.
  - Subcommand: token kế = `exec` / `run`.
- [ ] **Step 4: Chạy test, phải xanh.**
- [ ] **Step 5: Docs + commit** `feat(crew-mac): bộ dọn nhận run Codex và OpenCode mồ côi`.

### Task MR-4: Bản tin `runtimes`

**Files:**
- Create: `apps/crew-mac/src/status/runtimes.ts`, `test/status-runtimes.test.ts`.
- Modify: `src/status/report.ts` (gắn `runtimes` khi đọc được, không làm hỏng bản tin khi lỗi),
  `test/status-report.test.ts`, `docs/flows/mac-runtimes.md`.

**Interfaces:**
- Consumes: `keychainHasKey` (MR-1); `ctx.runner`.
- Produces: `RuntimesReport` (I8), `buildRuntimesReport(ctx): Promise<RuntimesReport>`.

- [ ] **Step 1: Test đỏ.** Runner giả trả đầu ra thật đã chụp ở SP-0 và (cho stats) bảng `opencode stats` như mẫu
  dưới.

```ts
const STATS = `│ opencode-go/kimi-k3 │\n│  Cost  $2.7210 │\n│ opencode-go/kimi-k2.6 │\n│  Cost  $0.2099 │`;
it('cộng Cost của mọi model opencode-go theo 1/7/30 ngày', async () => {
  const r = await buildRuntimesReport(fakeCtx({ 'opencode stats --days 1 --models': STATS, 'opencode stats --days 7 --models': STATS, 'opencode stats --days 30 --models': STATS }));
  expect(r.opencode.costDay).toBeCloseTo(2.9309, 4);
});
it('model list chỉ id opencode-go hợp lệ, tối đa 60', async () => { /* 70 dòng → 60 */ });
it('codex quota từ session jsonl mới nhất, không đọc auth.json', async () => {
  // HOME tạm có ~/.codex/sessions/2026/10/10/a.jsonl chứa rate_limits theo tên trường SP-0 C3, và auth.json chứa chuỗi mốc
  const r = await buildRuntimesReport(ctxWithHome(home));
  expect(r.codex.primaryUsedPct).toBe(42);
  expect(JSON.stringify(r)).not.toContain('MOC-AUTH');
});
it('mọi lệnh lỗi hoặc thiếu CLI → null, không ném', async () => { /* runner trả code 127 */ });
it('bản tin có runtimes vẫn ≤ 16 KB và không chứa key Keychain giả', async () => { /* buildMachineReport */ });
```

- [ ] **Step 2: Chạy test, phải đỏ.**
- [ ] **Step 3: Viết code.**
  - Parse `Cost  $<số>` sau dòng `opencode-go/`. Bỏ model khác provider.
  - Timeout mỗi lệnh 10 giây, chạy song song với phần còn lại của `buildMachineReport`.
- [ ] **Step 4: Chạy test, phải xanh.**
- [ ] **Step 5: Docs + commit** `feat(crew-mac): bản tin máy báo trạng thái Codex và OpenCode Go`.
