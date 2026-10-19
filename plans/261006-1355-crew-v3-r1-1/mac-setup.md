# Crew v3 R1-1: gói `mac-setup` (MS-1, MS-2), kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cài một Mac thành SSH environment cho Paperclip bằng một lệnh (`crew-mac setup`, kể cả wrapper `crew-claude-run` cho agent), kiểm được bằng `crew-mac doctor` (kể cả hộp thoại quyền macOS đang chờ) và gỡ sạch bằng `crew-mac uninstall`. Kèm một LaunchAgent dọn process `claude --print` của run đã mất kết nối.

**Architecture:** `apps/crew-mac` là một app TypeScript mới trong monorepo Crew, chỉ dùng Node built-in, không phụ thuộc gói khác. Mọi lệnh hệ thống (`launchctl`, `ssh`, `ssh-keygen`, `tailscale`, `/usr/bin/log`, `ps`, `nc`, `sysctl`, `memory_pressure`) đi qua interface `CommandRunner`, nên test dùng runner giả và HOME giả (thư mục tạm). Trạng thái cài đặt nằm trong `~/.crew-mac/manifest.json`. LaunchAgent sshd chạy trong phiên Aqua để `claude` đọc được Keychain. LaunchAgent dọn process chạy `crew-mac reap` mỗi 60 giây.

**Tech Stack:** Node ≥ 22 (Mac mini có `/opt/homebrew/bin/node`), TypeScript 7 (`tsconfig.base.json`: NodeNext, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest 5, Biome 2.5 (2 dấu cách, nháy đơn, dòng 110 ký tự), macOS 26 launchd, OpenSSH 10.3 (`/usr/sbin/sshd`, `/usr/libexec/sshd-session`), Tailscale app (`/Applications/Tailscale.app/Contents/MacOS/Tailscale`), Claude Code 2.1.x.

**Spec:** Khung [plan.md](plan.md) (Global Constraints, Review Focus 1 và 4, mục "Interface giữa các gói") và bằng chứng trên Mac mini trong [spike-claude-mac.md](../261006-0805-crew-v3-stock-first/spike-claude-mac.md) (D1: TCC, D2: CLAUDE.md và plugin builtin), [spike-moi-truong.md](../261006-0805-crew-v3-stock-first/spike-moi-truong.md) (S1–S3), [processes.md](../261006-0805-crew-v3-stock-first/processes.md) (các thứ spike đã cài trên Mac mini).

## Global Constraints

Áp dụng toàn bộ mục Global Constraints của [plan.md](plan.md). Riêng gói này:

- Không đọc, ghi hay gỡ gì trong `~/.claude`, Keychain hay plugin của owner. Không dùng token đăng nhập Claude và không bắt login lại.
- Thư mục gốc worktree mặc định là `~/crew-agents`. Từ chối mọi đường dẫn dưới `/Volumes`, `~/Desktop`, `~/Downloads` (D1: các vùng này kích hoạt hộp thoại TCC và agent treo im lặng). Đặt dưới `$HOME` thì agent nạp `~/.claude/CLAUDE.md` của owner (D2); owner đã chốt chấp nhận.
- Cổng sshd agent mặc định 2222, chỉ nghe trên IP Tailscale lấy từ `tailscale ip -4` (dải 100.64.0.0/10). `ClientAliveInterval 15`, `ClientAliveCountMax 2`: mất mạng khoảng 30 giây thì phiên chết.
- MS-2 coi run là mồ côi sau `graceMs: 60_000`.
- Wrapper `crew-claude-run` dùng nguyên văn hợp đồng của `runtime.md` RT-1.1. Nguồn nằm ở `apps/crew-mac/assets/crew-claude-run.sh`, cài vào `~/.crew/bin/crew-claude-run` (mode 755). `~/.crew` là thư mục của `crewd` v2: chỉ được đụng tới file wrapper.
- Mọi lệnh gọi `/usr/bin/log` bằng đường dẫn tuyệt đối, vì trong zsh `log` là lệnh builtin.
- Mọi lệnh có thể treo đều có giới hạn thời gian, và hết hạn thì gửi `SIGKILL`: `claude` bỏ qua `SIGTERM` và `SIGALRM` khi bị TCC chặn (D1).
- `setup` và `uninstall` idempotent: chạy lại không đổi file nào và không restart dịch vụ khi không có gì khác.
- Thông điệp cho người dùng viết tiếng Việt; identifier, path, label và key viết tiếng Anh. Giờ trong log của reaper theo Asia/Ho_Chi_Minh.
- Không sửa Mac mini khi thực thi plan này. Cài thật trên Mac mini thuộc AC-1.

## Review Focus

Các dòng dưới đây lấy từ Review Focus của khung, kèm những lỗi mà gói này có khả năng gây ra. Dòng nào cũng đã có test ở task sở hữu code.

1. Claude Code tự cập nhật nên đường dẫn `versions/<x>` đổi và TCC hỏi lại quyền. `doctor` phải báo hộp thoại đang chờ, nêu tên binary và chỉ chỗ bấm, không được báo "đạt" (Task 5: `parsePendingTccPrompts` và test `tcc-pending`).
2. `claude -p` trong git repo treo. Phép thử của `doctor` phải tự `SIGKILL` cả phía Mac, không để lại process (Task 5: test nội dung `printProbeScript` và test timeout).
3. Mất mạng giữa VPS và Mac: process `claude --print` của run cũ phải bị dọn, kể cả khi process cha trực tiếp (`zsh -c`, bridge) vẫn sống. Vì vậy nhận diện bằng "không còn `sshd`/`sshd-session` trong chuỗi tổ tiên" thay cho chỉ "PPID = 1" (Task 8: test `isOrphaned`).
4. Không bao giờ đụng phiên `claude` tương tác của owner hay process không có `PAPERCLIP_RUN_ID` (Task 8: test owner interactive, test thiếu run id).
5. `uninstall` chạy qua chính sshd mà nó sắp gỡ sẽ tự cắt phiên giữa chừng. CLI phải từ chối nếu không có `--force` (Task 7: test `SSH_CONNECTION`).

---

## Cấu trúc file

| Path | Trách nhiệm |
|---|---|
| `apps/crew-mac/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` | Khung app, bám `apps/daemon` |
| `apps/crew-mac/src/system.ts` | `CommandRunner`, runner thật có timeout bằng `SIGKILL` |
| `apps/crew-mac/src/context.ts` | `MacContext`, `SetupError` |
| `apps/crew-mac/src/paths.ts` | Label, comment key, đường dẫn trong HOME, `forbiddenRootReason` |
| `apps/crew-mac/src/fs-util.ts` | `readText`, `writeIfChanged` (ghi atomic, đúng mode) |
| `apps/crew-mac/src/manifest.ts` | Đọc/ghi `~/.crew-mac/manifest.json` |
| `apps/crew-mac/src/zshenv.ts` | Khối PATH có đánh dấu; gỡ hai dòng PATH của spike |
| `apps/crew-mac/src/authorized-keys.ts` | Kiểm public key, thêm/gỡ dòng theo comment |
| `apps/crew-mac/src/plist.ts` | Render plist LaunchAgent |
| `apps/crew-mac/src/sshd-config.ts` | Render `sshd_config` |
| `apps/crew-mac/src/launchctl.ts` | `serviceState`, `guiSessionAvailable`, `bootstrap`, `bootout` |
| `apps/crew-mac/src/tailscale.ts` | `tailscaleIpv4` |
| `apps/crew-mac/assets/crew-claude-run.sh`, `apps/crew-mac/src/wrapper.ts` | Wrapper `claude` cho agent (hợp đồng của `runtime.md` RT-1.1) và đường dẫn nguồn của nó |
| `apps/crew-mac/src/commands/setup.ts` | `setup`, `ensureService`, plist spec |
| `apps/crew-mac/src/commands/doctor.ts` | `doctor`, các check, `parsePendingTccPrompts`, `printProbeScript` |
| `apps/crew-mac/src/commands/uninstall.ts` | `uninstall` (kể cả phần spike) |
| `apps/crew-mac/src/reaper/process-table.ts` | Đọc bảng process và env bằng `ps` |
| `apps/crew-mac/src/reaper/select.ts` | Chọn process mồ côi (hàm thuần) |
| `apps/crew-mac/src/reaper/reap.ts` | `reapOnce`: TERM, chờ, KILL, ghi state và log |
| `apps/crew-mac/src/cli.ts` | CLI `crew-mac` |
| `apps/crew-mac/test/helpers/fake-runner.ts`, `fake-mac.ts` | Runner giả, HOME giả |
| `docs/flows/mac-setup.md`, `docs/flows/mac-orphan-reaper.md`, `docs/flows.yaml`, `docs/index.md` | Docs theo luật R2/R3 |

---

### Task 1: Khung app `crew-mac` và `CommandRunner`

**Files:**
- Create: `apps/crew-mac/package.json`
- Create: `apps/crew-mac/tsconfig.json`
- Create: `apps/crew-mac/tsconfig.build.json`
- Create: `apps/crew-mac/vitest.config.ts`
- Create: `apps/crew-mac/src/system.ts`
- Create: `apps/crew-mac/src/context.ts`
- Create: `apps/crew-mac/test/helpers/fake-runner.ts`
- Test: `apps/crew-mac/test/system.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `interface RunResult { code: number; stdout: string; stderr: string; timedOut: boolean }`
  - `interface RunOptions { timeoutMs?: number; input?: string }`
  - `interface CommandRunner { run(command: string, args: readonly string[], options?: RunOptions): Promise<RunResult> }`
  - `createRunner(): CommandRunner`: khi hết `timeoutMs` thì gửi `SIGKILL`; process chết vì signal trả `code` 137; lỗi spawn trả `code` 127.
  - `interface MacContext { home: string; user: string; uid: number; platform: NodeJS.Platform; runner: CommandRunner; now: () => Date; out: (line: string) => void; nodePath: string; cliPath: string }`
  - `class SetupError extends Error`
  - Test helper `class FakeRunner implements CommandRunner` có `on(command, handler)`, `calls`, `commands()`.

- [ ] **Step 1: Tạo khung package**

`apps/crew-mac/package.json`:

```json
{
  "name": "@crew/mac",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "bin": {
    "crew-mac": "./dist/cli.js"
  }
}
```

`apps/crew-mac/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src", "test", "vitest.config.ts"]
}
```

`apps/crew-mac/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "types": ["node"] },
  "include": ["src"]
}
```

`apps/crew-mac/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
```

Chạy: `pnpm install`
Kỳ vọng: pnpm nhận workspace `@crew/mac`, không lỗi.

- [ ] **Step 2: Viết test cho runner thật (sẽ fail)**

`apps/crew-mac/test/system.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRunner } from '../src/system.js';

describe('createRunner', () => {
  it('trả stdout, stderr và mã thoát', async () => {
    const result = await createRunner().run(process.execPath, [
      '-e',
      "process.stdout.write('ra'); process.stderr.write('loi'); process.exit(3)",
    ]);
    expect(result).toEqual({ code: 3, stdout: 'ra', stderr: 'loi', timedOut: false });
  });

  it('đưa input vào stdin', async () => {
    const result = await createRunner().run(
      process.execPath,
      ['-e', "process.stdin.on('data', (d) => process.stdout.write(String(d).toUpperCase()))"],
      { input: 'abc' },
    );
    expect(result.stdout).toBe('ABC');
  });

  it('hết giờ thì SIGKILL kể cả khi process bỏ qua SIGTERM', async () => {
    const started = Date.now();
    const result = await createRunner().run(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      { timeoutMs: 300 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.code).toBe(137);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('lệnh không tồn tại trả 127', async () => {
    const result = await createRunner().run('/khong/co/lenh-nay', []);
    expect(result.code).toBe(127);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Chạy: `pnpm --filter @crew/mac test -- test/system.test.ts`
Kỳ vọng: FAIL vì không tìm thấy `../src/system.js`.

- [ ] **Step 4: Viết `system.ts` và `context.ts`**

`apps/crew-mac/src/system.ts`:

```ts
import { spawn } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  /** Hết hạn thì SIGKILL: claude bỏ qua SIGTERM khi bị TCC chặn. */
  timeoutMs?: number;
  input?: string;
}

export interface CommandRunner {
  run(command: string, args: readonly string[], options?: RunOptions): Promise<RunResult>;
}

export function createRunner(): CommandRunner {
  return {
    run(command, args, options = {}) {
      return new Promise((resolve) => {
        const child = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;
        const finish = (result: RunResult) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(result);
        };
        const timer =
          options.timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                timedOut = true;
                child.kill('SIGKILL');
              }, options.timeoutMs);
        child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
          stderr += chunk;
        });
        child.on('error', (error) => finish({ code: 127, stdout, stderr: error.message, timedOut }));
        child.on('close', (code, signal) =>
          finish({ code: code ?? (signal === 'SIGKILL' ? 137 : 1), stdout, stderr, timedOut }),
        );
        child.stdin.on('error', () => {});
        child.stdin.end(options.input ?? '');
      });
    },
  };
}
```

`apps/crew-mac/src/context.ts`:

```ts
import type { CommandRunner } from './system.js';

export interface MacContext {
  home: string;
  user: string;
  uid: number;
  platform: NodeJS.Platform;
  runner: CommandRunner;
  now: () => Date;
  out: (line: string) => void;
  /** Node cho LaunchAgent reaper; ưu tiên symlink ổn định của Homebrew. */
  nodePath: string;
  /** Đường dẫn thật của dist/cli.js, dùng trong plist reaper. */
  cliPath: string;
}

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}
```

- [ ] **Step 5: Viết `FakeRunner` cho các task sau**

`apps/crew-mac/test/helpers/fake-runner.ts`:

```ts
import type { CommandRunner, RunOptions, RunResult } from '../../src/system.js';

export type FakeHandler = (args: readonly string[], options: RunOptions) => Partial<RunResult> | undefined;

export class FakeRunner implements CommandRunner {
  readonly calls: { command: string; args: string[]; options: RunOptions }[] = [];
  private readonly handlers = new Map<string, FakeHandler>();

  on(command: string, handler: FakeHandler): this {
    this.handlers.set(command, handler);
    return this;
  }

  async run(command: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
    this.calls.push({ command, args: [...args], options });
    const result = this.handlers.get(command)?.(args, options);
    if (!result) return { code: 127, stdout: '', stderr: `fake: không có handler cho ${command}`, timedOut: false };
    return { code: 0, stdout: '', stderr: '', timedOut: false, ...result };
  }

  commands(): string[] {
    return this.calls.map((call) => [call.command, ...call.args].join(' '));
  }
}
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Chạy: `pnpm --filter @crew/mac test -- test/system.test.ts && pnpm --filter @crew/mac typecheck`
Kỳ vọng: 4 test PASS, typecheck không lỗi.

- [ ] **Step 7: Commit**

```bash
git add apps/crew-mac/package.json apps/crew-mac/tsconfig.json apps/crew-mac/tsconfig.build.json \
  apps/crew-mac/vitest.config.ts apps/crew-mac/src/system.ts apps/crew-mac/src/context.ts \
  apps/crew-mac/test/helpers/fake-runner.ts apps/crew-mac/test/system.test.ts pnpm-lock.yaml
git commit -m "feat(crew-mac): khung app và runner lệnh có giới hạn thời gian"
```

---

### Task 2: Sửa `~/.zshenv` và `authorized_keys` theo dấu nhận diện

**Files:**
- Create: `apps/crew-mac/src/zshenv.ts`
- Create: `apps/crew-mac/src/authorized-keys.ts`
- Test: `apps/crew-mac/test/zshenv.test.ts`
- Test: `apps/crew-mac/test/authorized-keys.test.ts`

**Interfaces:**
- Consumes: `SetupError` (Task 1).
- Produces:
  - `PATH_BLOCK_BEGIN = '# >>> crew-mac path >>>'`, `PATH_BLOCK_END = '# <<< crew-mac path <<<'`, `PATH_BLOCK_BODY = 'export PATH="$HOME/.local/bin:$PATH"'`
  - `SPIKE_PATH_COMMENT = '# Crew v3 spike: claude cho phiên SSH không tương tác'`
  - `upsertPathBlock(text: string): string`, `removePathBlock(text: string): string`, `hasPathBlock(text: string): boolean`, `removeSpikePathLines(text: string): string`
  - `parsePublicKey(text: string): { type: string; body: string }` (sai dạng thì ném `SetupError`)
  - `upsertKey(text: string, publicKey: string, comment: string, options?: string): string`
  - `removeKeysByComment(text: string, comment: string): string`
  - `hasKeyComment(text: string, comment: string): boolean`

- [ ] **Step 1: Viết test (sẽ fail)**

`apps/crew-mac/test/zshenv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  hasPathBlock,
  PATH_BLOCK_BEGIN,
  PATH_BLOCK_BODY,
  PATH_BLOCK_END,
  removePathBlock,
  removeSpikePathLines,
  SPIKE_PATH_COMMENT,
  upsertPathBlock,
} from '../src/zshenv.js';

const BLOCK = `${PATH_BLOCK_BEGIN}\n${PATH_BLOCK_BODY}\n${PATH_BLOCK_END}\n`;

describe('khối PATH trong ~/.zshenv', () => {
  it('thêm khối vào file rỗng', () => {
    expect(upsertPathBlock('')).toBe(BLOCK);
  });

  it('giữ nội dung sẵn có và chạy lại không đổi gì', () => {
    const once = upsertPathBlock('export EDITOR=vim');
    expect(once).toBe(`export EDITOR=vim\n${BLOCK}`);
    expect(upsertPathBlock(once)).toBe(once);
    expect(hasPathBlock(once)).toBe(true);
  });

  it('gỡ khối, giữ phần còn lại', () => {
    expect(removePathBlock(`export EDITOR=vim\n${BLOCK}`)).toBe('export EDITOR=vim\n');
    expect(hasPathBlock('export EDITOR=vim\n')).toBe(false);
  });

  it('gỡ đúng hai dòng PATH của spike, không đụng dòng PATH khác', () => {
    const text = `export A=1\n${SPIKE_PATH_COMMENT}\n${PATH_BLOCK_BODY}\nexport PATH="$HOME/bin:$PATH"\n`;
    expect(removeSpikePathLines(text)).toBe('export A=1\nexport PATH="$HOME/bin:$PATH"\n');
  });

  it('không gỡ dòng PATH giống hệt nếu không đi sau comment spike', () => {
    const text = `${PATH_BLOCK_BODY}\n`;
    expect(removeSpikePathLines(text)).toBe(text);
  });
});
```

`apps/crew-mac/test/authorized-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasKeyComment, parsePublicKey, removeKeysByComment, upsertKey } from '../src/authorized-keys.js';
import { SetupError } from '../src/context.js';

const PAPERCLIP = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000 paperclip@vps';
const OWNER = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOwnerMacBookKey0000000000000000000000000 owner@macbook';

describe('authorized_keys', () => {
  it('đọc type và body, bỏ comment gốc', () => {
    expect(parsePublicKey(PAPERCLIP)).toEqual({
      type: 'ssh-ed25519',
      body: 'AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000',
    });
  });

  it('từ chối thứ không phải public key', () => {
    const privateKeyHeader = ['-----BEGIN', 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' ');
    expect(() => parsePublicKey(privateKeyHeader)).toThrow(SetupError);
    expect(() => parsePublicKey('ssh-ed25519')).toThrow(SetupError);
  });

  it('thêm key với comment nhận diện, giữ key của owner, chạy lại không nhân đôi', () => {
    const once = upsertKey(`${OWNER}\n`, PAPERCLIP, 'crew-mac-paperclip');
    expect(once).toBe(
      `${OWNER}\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000 crew-mac-paperclip\n`,
    );
    expect(upsertKey(once, PAPERCLIP, 'crew-mac-paperclip')).toBe(once);
    expect(hasKeyComment(once, 'crew-mac-paperclip')).toBe(true);
  });

  it('thay dòng cũ có cùng body nhưng comment khác (key spike)', () => {
    const spike = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000 crew-v3-spike-paperclip';
    const next = upsertKey(`${spike}\n`, PAPERCLIP, 'crew-mac-paperclip');
    expect(next).not.toContain('crew-v3-spike-paperclip');
    expect(next.trim().split('\n')).toHaveLength(1);
  });

  it('ghi options trước key', () => {
    const next = upsertKey('', PAPERCLIP, 'crew-mac-doctor', 'from="100.64.0.0/10",no-port-forwarding');
    expect(next).toBe(
      'from="100.64.0.0/10",no-port-forwarding ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000 crew-mac-doctor\n',
    );
  });

  it('gỡ theo comment, giữ dòng khác', () => {
    const text = upsertKey(`${OWNER}\n`, PAPERCLIP, 'crew-mac-paperclip');
    expect(removeKeysByComment(text, 'crew-mac-paperclip')).toBe(`${OWNER}\n`);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Chạy: `pnpm --filter @crew/mac test -- test/zshenv.test.ts test/authorized-keys.test.ts`
Kỳ vọng: FAIL vì không tìm thấy module.

- [ ] **Step 3: Viết `zshenv.ts`**

```ts
export const PATH_BLOCK_BEGIN = '# >>> crew-mac path >>>';
export const PATH_BLOCK_END = '# <<< crew-mac path <<<';
export const PATH_BLOCK_BODY = 'export PATH="$HOME/.local/bin:$PATH"';
/** Dòng comment mà spike stock-first đã thêm, ngay trên dòng PATH_BLOCK_BODY. */
export const SPIKE_PATH_COMMENT = '# Crew v3 spike: claude cho phiên SSH không tương tác';

export function removePathBlock(text: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (line === PATH_BLOCK_BEGIN) {
      inside = true;
      continue;
    }
    if (inside) {
      if (line === PATH_BLOCK_END) inside = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

export function upsertPathBlock(text: string): string {
  const without = removePathBlock(text);
  const base = without === '' || without.endsWith('\n') ? without : `${without}\n`;
  return `${base}${PATH_BLOCK_BEGIN}\n${PATH_BLOCK_BODY}\n${PATH_BLOCK_END}\n`;
}

export function hasPathBlock(text: string): boolean {
  const lines = text.split('\n');
  const begin = lines.indexOf(PATH_BLOCK_BEGIN);
  return begin >= 0 && lines[begin + 1] === PATH_BLOCK_BODY && lines[begin + 2] === PATH_BLOCK_END;
}

export function removeSpikePathLines(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === SPIKE_PATH_COMMENT && lines[i + 1] === PATH_BLOCK_BODY) {
      i++;
      continue;
    }
    out.push(lines[i] as string);
  }
  return out.join('\n');
}
```

- [ ] **Step 4: Viết `authorized-keys.ts`**

```ts
import { SetupError } from './context.js';

const KEY_RE = /^(ssh-ed25519|ecdsa-sha2-nistp(?:256|384|521)|ssh-rsa)\s+([A-Za-z0-9+/]+={0,3})(?:\s.*)?$/;

export function parsePublicKey(text: string): { type: string; body: string } {
  const match = KEY_RE.exec(text.trim());
  if (!match) throw new SetupError('Public key SSH không hợp lệ (cần dạng "ssh-ed25519 AAAA... [comment]").');
  return { type: match[1] as string, body: match[2] as string };
}

function lastToken(line: string): string | undefined {
  return line.trim().split(/\s+/).at(-1);
}

function lines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() !== '');
}

function join(rows: string[]): string {
  return rows.length === 0 ? '' : `${rows.join('\n')}\n`;
}

export function upsertKey(text: string, publicKey: string, comment: string, options?: string): string {
  const { type, body } = parsePublicKey(publicKey);
  const kept = lines(text).filter((line) => lastToken(line) !== comment && !line.split(/\s+/).includes(body));
  kept.push(`${options ? `${options} ` : ''}${type} ${body} ${comment}`);
  return join(kept);
}

export function removeKeysByComment(text: string, comment: string): string {
  return join(lines(text).filter((line) => lastToken(line) !== comment));
}

export function hasKeyComment(text: string, comment: string): boolean {
  return lines(text).some((line) => lastToken(line) === comment);
}
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Chạy: `pnpm --filter @crew/mac test -- test/zshenv.test.ts test/authorized-keys.test.ts`
Kỳ vọng: 11 test PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crew-mac/src/zshenv.ts apps/crew-mac/src/authorized-keys.ts \
  apps/crew-mac/test/zshenv.test.ts apps/crew-mac/test/authorized-keys.test.ts
git commit -m "feat(crew-mac): sửa zshenv và authorized_keys theo khối đánh dấu"
```

---

### Task 3: Đường dẫn, file cấu hình sshd, plist, `launchctl`, Tailscale

**Files:**
- Create: `apps/crew-mac/src/paths.ts`
- Create: `apps/crew-mac/src/fs-util.ts`
- Create: `apps/crew-mac/src/manifest.ts`
- Create: `apps/crew-mac/src/sshd-config.ts`
- Create: `apps/crew-mac/src/plist.ts`
- Create: `apps/crew-mac/src/launchctl.ts`
- Create: `apps/crew-mac/src/tailscale.ts`
- Test: `apps/crew-mac/test/render.test.ts`
- Test: `apps/crew-mac/test/system-wrappers.test.ts`

**Interfaces:**
- Consumes: `CommandRunner`, `SetupError` (Task 1); `FakeRunner` (test).
- Produces:
  - Hằng: `SSHD_LABEL = 'com.2p.crew-mac-sshd'`, `REAPER_LABEL = 'com.2p.crew-mac-reaper'`, `SPIKE_LABEL = 'com.2p.crew-spike-sshd'`, `PAPERCLIP_KEY_COMMENT = 'crew-mac-paperclip'`, `DOCTOR_KEY_COMMENT = 'crew-mac-doctor'`, `SPIKE_KEY_COMMENT = 'crew-v3-spike-paperclip'`, `DEFAULT_PORT = 2222`, `TAILSCALE_CANDIDATES`.
  - `macPaths(home: string): MacPaths` (các field liệt kê trong code bên dưới), `forbiddenRootReason(home: string, root: string): string | null`.
  - `readText(path: string): string`, `writeIfChanged(path: string, content: string, mode: number): boolean`.
  - `interface Manifest { version: 1; port: number; listenAddress: string; worktreeRoot: string; paperclipKey: string; installedAt: string }`, `readManifest(path: string): Manifest | null`, `writeManifest(path: string, manifest: Manifest): boolean`.
  - `interface SshdSpec { port: number; listenAddress: string; hostKey: string; pidFile: string; authorizedKeysFile: string; user: string }`, `renderSshdConfig(spec: SshdSpec): string`.
  - `interface PlistSpec { label: string; programArguments: readonly string[]; keepAlive: boolean; startIntervalSec?: number; aquaOnly: boolean; processType: 'Interactive' | 'Background'; stdoutPath?: string; stderrPath?: string }`, `renderPlist(spec: PlistSpec): string`.
  - `interface ServiceState { loaded: boolean; running: boolean; pid: number | null; lastExitCode: number | null }`, `serviceState(runner, uid, label): Promise<ServiceState>`, `guiSessionAvailable(runner, uid): Promise<boolean>`, `bootstrap(runner, uid, plistPath): Promise<void>`, `bootout(runner, uid, label): Promise<boolean>`.
  - `tailscaleIpv4(runner: CommandRunner): Promise<string | null>`.

- [ ] **Step 1: Viết test (sẽ fail)**

`apps/crew-mac/test/render.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeIfChanged } from '../src/fs-util.js';
import { readManifest, writeManifest } from '../src/manifest.js';
import { forbiddenRootReason, macPaths } from '../src/paths.js';
import { renderPlist } from '../src/plist.js';
import { renderSshdConfig } from '../src/sshd-config.js';

describe('forbiddenRootReason', () => {
  const home = '/Users/owner';
  it.each([
    ['/Volumes/CORSAIR/agents', 'Volumes'],
    ['/Users/owner/Desktop/agents', 'Desktop'],
    ['/Users/owner/Downloads', 'Downloads'],
    ['relative/path', 'tuyệt đối'],
  ])('từ chối %s', (root, word) => {
    expect(forbiddenRootReason(home, root)).toContain(word);
  });

  it.each(['/Users/owner/crew-agents', '/Users/Shared/crew-agents', '/Users/owner/Desktopish'])('cho phép %s', (root) => {
    expect(forbiddenRootReason(home, root)).toBeNull();
  });
});

describe('renderSshdConfig', () => {
  it('chỉ nghe IP Tailscale, chỉ key, chỉ user này, phát hiện mất mạng sau khoảng 30 giây', () => {
    const text = renderSshdConfig({
      port: 2222,
      listenAddress: '100.102.189.67',
      hostKey: '/h/.crew-mac/sshd/host_ed25519',
      pidFile: '/h/.crew-mac/sshd/sshd.pid',
      authorizedKeysFile: '/h/.ssh/authorized_keys',
      user: 'owner',
    });
    expect(text.split('\n')).toEqual([
      '# Quản lý bởi crew-mac. Sửa bằng "crew-mac setup", không sửa tay.',
      'Port 2222',
      'ListenAddress 100.102.189.67',
      'HostKey /h/.crew-mac/sshd/host_ed25519',
      'PidFile /h/.crew-mac/sshd/sshd.pid',
      'AuthorizedKeysFile /h/.ssh/authorized_keys',
      'PubkeyAuthentication yes',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'UsePAM no',
      'StrictModes yes',
      'PermitRootLogin no',
      'AllowUsers owner',
      'ClientAliveInterval 15',
      'ClientAliveCountMax 2',
      '',
    ]);
  });
});

describe('renderPlist', () => {
  const xml = renderPlist({
    label: 'com.2p.crew-mac-sshd',
    programArguments: ['/usr/sbin/sshd', '-D', '-f', '/h/a&b/sshd_config'],
    keepAlive: true,
    aquaOnly: true,
    processType: 'Interactive',
  });

  it('có label, escape ký tự XML, giới hạn phiên Aqua', () => {
    expect(xml).toContain('<key>Label</key><string>com.2p.crew-mac-sshd</string>');
    expect(xml).toContain('<string>/h/a&amp;b/sshd_config</string>');
    expect(xml).toContain('<key>LimitLoadToSessionType</key><string>Aqua</string>');
    expect(xml).toContain('<key>KeepAlive</key><true/>');
    expect(xml).not.toContain('StartInterval');
  });

  it.runIf(process.platform === 'darwin')('plutil chấp nhận', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'crew-mac-plist-')), 'a.plist');
    writeFileSync(file, xml);
    expect(spawnSync('/usr/bin/plutil', ['-lint', file]).status).toBe(0);
  });
});

describe('writeIfChanged và manifest', () => {
  it('chỉ ghi khi nội dung đổi, đúng mode', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'crew-mac-fs-')), 'sub', 'x.txt');
    expect(writeIfChanged(file, 'a\n', 0o600)).toBe(true);
    expect(writeIfChanged(file, 'a\n', 0o600)).toBe(false);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(writeIfChanged(file, 'b\n', 0o600)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('b\n');
  });

  it('đọc lại manifest đã ghi', () => {
    const paths = macPaths(mkdtempSync(join(tmpdir(), 'crew-mac-home-')));
    expect(readManifest(paths.manifest)).toBeNull();
    const manifest = {
      version: 1 as const,
      port: 2222,
      listenAddress: '100.102.189.67',
      worktreeRoot: '/Users/owner/crew-agents',
      paperclipKey: 'ssh-ed25519 AAAA',
      installedAt: '2026-10-06T07:00:00.000Z',
    };
    writeManifest(paths.manifest, manifest);
    expect(readManifest(paths.manifest)).toEqual(manifest);
  });
});
```

`apps/crew-mac/test/system-wrappers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bootout, bootstrap, guiSessionAvailable, serviceState } from '../src/launchctl.js';
import { tailscaleIpv4 } from '../src/tailscale.js';
import { FakeRunner } from './helpers/fake-runner.js';

describe('launchctl', () => {
  it('đọc trạng thái đang chạy, pid và mã thoát', async () => {
    const runner = new FakeRunner().on('launchctl', () => ({
      stdout: 'gui/501/com.2p.crew-mac-sshd = {\n\tstate = running\n\tpid = 17611\n\tlast exit code = 0\n}\n',
    }));
    expect(await serviceState(runner, 501, 'com.2p.crew-mac-sshd')).toEqual({
      loaded: true,
      running: true,
      pid: 17611,
      lastExitCode: 0,
    });
    expect(runner.commands()).toEqual(['launchctl print gui/501/com.2p.crew-mac-sshd']);
  });

  it('service chưa nạp', async () => {
    const runner = new FakeRunner().on('launchctl', () => ({ code: 113, stderr: 'Could not find service' }));
    expect(await serviceState(runner, 501, 'x')).toEqual({ loaded: false, running: false, pid: null, lastExitCode: null });
    expect(await guiSessionAvailable(runner, 501)).toBe(false);
    expect(await bootout(runner, 501, 'x')).toBe(false);
  });

  it('bootstrap lỗi thì ném lỗi có stderr', async () => {
    const runner = new FakeRunner().on('launchctl', () => ({ code: 5, stderr: 'Bootstrap failed: 5: Input/output error' }));
    await expect(bootstrap(runner, 501, '/p.plist')).rejects.toThrow('Input/output error');
  });
});

describe('tailscaleIpv4', () => {
  it('thử CLI trên PATH rồi tới CLI trong app', async () => {
    const runner = new FakeRunner()
      .on('tailscale', () => ({ code: 127 }))
      .on('/Applications/Tailscale.app/Contents/MacOS/Tailscale', () => ({ stdout: '100.102.189.67\n' }));
    expect(await tailscaleIpv4(runner)).toBe('100.102.189.67');
  });

  it('bỏ qua IP ngoài dải 100.64.0.0/10', async () => {
    const runner = new FakeRunner()
      .on('tailscale', () => ({ stdout: '100.200.1.1\n' }))
      .on('/Applications/Tailscale.app/Contents/MacOS/Tailscale', () => ({ code: 1 }));
    expect(await tailscaleIpv4(runner)).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Chạy: `pnpm --filter @crew/mac test -- test/render.test.ts test/system-wrappers.test.ts`
Kỳ vọng: FAIL vì không tìm thấy module.

- [ ] **Step 3: Viết `paths.ts`, `fs-util.ts`, `manifest.ts`**

`apps/crew-mac/src/paths.ts`:

```ts
import { isAbsolute, join, resolve } from 'node:path';

export const SSHD_LABEL = 'com.2p.crew-mac-sshd';
export const REAPER_LABEL = 'com.2p.crew-mac-reaper';
export const SPIKE_LABEL = 'com.2p.crew-spike-sshd';
export const PAPERCLIP_KEY_COMMENT = 'crew-mac-paperclip';
export const DOCTOR_KEY_COMMENT = 'crew-mac-doctor';
export const SPIKE_KEY_COMMENT = 'crew-v3-spike-paperclip';
export const DEFAULT_PORT = 2222;
export const TAILSCALE_CANDIDATES = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'] as const;

export function macPaths(home: string) {
  const root = join(home, '.crew-mac');
  const agents = join(home, 'Library', 'LaunchAgents');
  return {
    root,
    manifest: join(root, 'manifest.json'),
    sshdDir: join(root, 'sshd'),
    sshdConfig: join(root, 'sshd', 'sshd_config'),
    hostKey: join(root, 'sshd', 'host_ed25519'),
    sshdPid: join(root, 'sshd', 'sshd.pid'),
    sshdLog: join(root, 'sshd', 'sshd.log'),
    doctorKey: join(root, 'doctor_ed25519'),
    knownHosts: join(root, 'known_hosts'),
    reaperDir: join(root, 'reaper'),
    reaperState: join(root, 'reaper', 'state.json'),
    reaperLog: join(root, 'reaper', 'reaper.log'),
    sshdPlist: join(agents, `${SSHD_LABEL}.plist`),
    reaperPlist: join(agents, `${REAPER_LABEL}.plist`),
    spikePlist: join(agents, `${SPIKE_LABEL}.plist`),
    spikeDir: join(home, '.crew-spike-sshd'),
    authorizedKeys: join(home, '.ssh', 'authorized_keys'),
    zshenv: join(home, '.zshenv'),
    /** Dùng chung thư mục ~/.crew với crewd v2: chỉ được đụng tới bin/crew-claude-run. */
    crewBin: join(home, '.crew', 'bin'),
    wrapper: join(home, '.crew', 'bin', 'crew-claude-run'),
    defaultWorktreeRoot: join(home, 'crew-agents'),
  };
}

export type MacPaths = ReturnType<typeof macPaths>;

/** Lý do không được đặt worktree ở `root`, hoặc null nếu được. */
export function forbiddenRootReason(home: string, root: string): string | null {
  if (!isAbsolute(root)) return 'thư mục gốc worktree phải là đường dẫn tuyệt đối';
  const abs = resolve(root);
  const under = (base: string) => abs === base || abs.startsWith(`${base}/`);
  if (under('/Volumes')) return 'không đặt dưới /Volumes: macOS hỏi quyền ổ ngoài và agent treo im lặng';
  if (under(join(home, 'Desktop'))) return 'không đặt dưới ~/Desktop: thư mục được macOS bảo vệ (TCC)';
  if (under(join(home, 'Downloads'))) return 'không đặt dưới ~/Downloads: thư mục được macOS bảo vệ (TCC)';
  return null;
}
```

`apps/crew-mac/src/fs-util.ts`:

```ts
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Ghi atomic khi nội dung khác; luôn đặt lại mode. Trả true nếu đã ghi. */
export function writeIfChanged(path: string, content: string, mode: number): boolean {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path) && readFileSync(path, 'utf8') === content) {
    chmodSync(path, mode);
    return false;
  }
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content, { mode });
  renameSync(temp, path);
  chmodSync(path, mode);
  return true;
}
```

`apps/crew-mac/src/manifest.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { SetupError } from './context.js';
import { writeIfChanged } from './fs-util.js';

export interface Manifest {
  version: 1;
  port: number;
  listenAddress: string;
  worktreeRoot: string;
  paperclipKey: string;
  installedAt: string;
}

export function readManifest(path: string): Manifest | null {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Manifest>;
  if (
    raw.version !== 1 ||
    typeof raw.port !== 'number' ||
    typeof raw.listenAddress !== 'string' ||
    typeof raw.worktreeRoot !== 'string' ||
    typeof raw.paperclipKey !== 'string' ||
    typeof raw.installedAt !== 'string'
  ) {
    throw new SetupError(`${path} hỏng; xóa file rồi chạy lại "crew-mac setup".`);
  }
  return raw as Manifest;
}

export function writeManifest(path: string, manifest: Manifest): boolean {
  return writeIfChanged(path, `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
}
```

- [ ] **Step 4: Viết `sshd-config.ts` và `plist.ts`**

`apps/crew-mac/src/sshd-config.ts`:

```ts
export interface SshdSpec {
  port: number;
  listenAddress: string;
  hostKey: string;
  pidFile: string;
  authorizedKeysFile: string;
  user: string;
}

export function renderSshdConfig(spec: SshdSpec): string {
  return [
    '# Quản lý bởi crew-mac. Sửa bằng "crew-mac setup", không sửa tay.',
    `Port ${spec.port}`,
    `ListenAddress ${spec.listenAddress}`,
    `HostKey ${spec.hostKey}`,
    `PidFile ${spec.pidFile}`,
    `AuthorizedKeysFile ${spec.authorizedKeysFile}`,
    'PubkeyAuthentication yes',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'UsePAM no',
    'StrictModes yes',
    'PermitRootLogin no',
    `AllowUsers ${spec.user}`,
    // Mất mạng thì sshd-session thoát sau khoảng 30 giây; reaper nhận ra process mồ côi từ đó.
    'ClientAliveInterval 15',
    'ClientAliveCountMax 2',
    '',
  ].join('\n');
}
```

`apps/crew-mac/src/plist.ts`:

```ts
export interface PlistSpec {
  label: string;
  programArguments: readonly string[];
  keepAlive: boolean;
  startIntervalSec?: number;
  aquaOnly: boolean;
  processType: 'Interactive' | 'Background';
  stdoutPath?: string;
  stderrPath?: string;
}

function esc(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function renderPlist(spec: PlistSpec): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${esc(spec.label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...spec.programArguments.map((arg) => `    <string>${esc(arg)}</string>`),
    '  </array>',
  ];
  if (spec.aquaOnly) lines.push('  <key>LimitLoadToSessionType</key><string>Aqua</string>');
  lines.push(`  <key>ProcessType</key><string>${spec.processType}</string>`);
  lines.push('  <key>RunAtLoad</key><true/>');
  if (spec.keepAlive) lines.push('  <key>KeepAlive</key><true/>');
  if (spec.startIntervalSec !== undefined) {
    lines.push(`  <key>StartInterval</key><integer>${spec.startIntervalSec}</integer>`);
  }
  if (spec.stdoutPath) lines.push(`  <key>StandardOutPath</key><string>${esc(spec.stdoutPath)}</string>`);
  if (spec.stderrPath) lines.push(`  <key>StandardErrorPath</key><string>${esc(spec.stderrPath)}</string>`);
  lines.push('</dict>', '</plist>', '');
  return lines.join('\n');
}
```

- [ ] **Step 5: Viết `launchctl.ts` và `tailscale.ts`**

`apps/crew-mac/src/launchctl.ts`:

```ts
import { SetupError } from './context.js';
import type { CommandRunner } from './system.js';

export interface ServiceState {
  loaded: boolean;
  running: boolean;
  pid: number | null;
  lastExitCode: number | null;
}

export async function serviceState(runner: CommandRunner, uid: number, label: string): Promise<ServiceState> {
  const result = await runner.run('launchctl', ['print', `gui/${uid}/${label}`], { timeoutMs: 10_000 });
  if (result.code !== 0) return { loaded: false, running: false, pid: null, lastExitCode: null };
  const pid = /^\s*pid = (\d+)$/m.exec(result.stdout);
  const exit = /^\s*last exit code = (-?\d+)/m.exec(result.stdout);
  return {
    loaded: true,
    running: /^\s*state = running$/m.test(result.stdout),
    pid: pid ? Number(pid[1]) : null,
    lastExitCode: exit ? Number(exit[1]) : null,
  };
}

/** Domain gui/<uid> chỉ tồn tại khi user đang đăng nhập màn hình (phiên Aqua). */
export async function guiSessionAvailable(runner: CommandRunner, uid: number): Promise<boolean> {
  return (await runner.run('launchctl', ['print', `gui/${uid}`], { timeoutMs: 10_000 })).code === 0;
}

export async function bootstrap(runner: CommandRunner, uid: number, plistPath: string): Promise<void> {
  const result = await runner.run('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { timeoutMs: 20_000 });
  if (result.code !== 0) {
    throw new SetupError(`launchctl bootstrap ${plistPath} lỗi (${result.code}): ${result.stderr.trim()}`);
  }
}

/** Trả true nếu service đang nạp và đã được gỡ. */
export async function bootout(runner: CommandRunner, uid: number, label: string): Promise<boolean> {
  return (await runner.run('launchctl', ['bootout', `gui/${uid}/${label}`], { timeoutMs: 20_000 })).code === 0;
}
```

`apps/crew-mac/src/tailscale.ts`:

```ts
import { TAILSCALE_CANDIDATES } from './paths.js';
import type { CommandRunner } from './system.js';

const CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/;

/** IPv4 Tailscale của máy này; CLI không có trên PATH khi cài bản app nên thử cả đường dẫn trong app. */
export async function tailscaleIpv4(runner: CommandRunner): Promise<string | null> {
  for (const command of TAILSCALE_CANDIDATES) {
    const result = await runner.run(command, ['ip', '-4'], { timeoutMs: 10_000 });
    if (result.code !== 0) continue;
    const ip = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .find((line) => CGNAT.test(line));
    if (ip) return ip;
  }
  return null;
}
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Chạy: `pnpm --filter @crew/mac test -- test/render.test.ts test/system-wrappers.test.ts && pnpm --filter @crew/mac typecheck`
Kỳ vọng: toàn bộ PASS (test `plutil` chỉ chạy trên macOS), typecheck sạch.

- [ ] **Step 7: Commit**

```bash
git add apps/crew-mac/src/paths.ts apps/crew-mac/src/fs-util.ts apps/crew-mac/src/manifest.ts \
  apps/crew-mac/src/sshd-config.ts apps/crew-mac/src/plist.ts apps/crew-mac/src/launchctl.ts \
  apps/crew-mac/src/tailscale.ts apps/crew-mac/test/render.test.ts apps/crew-mac/test/system-wrappers.test.ts
git commit -m "feat(crew-mac): render sshd_config, plist và bọc launchctl, tailscale"
```

---

### Task 4: `crew-mac setup`

**Files:**
- Create: `apps/crew-mac/assets/crew-claude-run.sh` (mode 755)
- Create: `apps/crew-mac/src/wrapper.ts`
- Create: `apps/crew-mac/src/commands/setup.ts`
- Create: `apps/crew-mac/test/helpers/fake-mac.ts`
- Test: `apps/crew-mac/test/crew-claude-run.test.ts`
- Test: `apps/crew-mac/test/setup.test.ts`

**Interfaces:**
- Consumes: mọi thứ của Task 1–3.
- Produces:
  - `interface SetupOptions { paperclipKey?: string; port?: number; worktreeRoot?: string }`
  - `interface SetupReport { changed: string[]; restarted: string[]; manifest: Manifest }`
  - `setup(ctx: MacContext, options?: SetupOptions): Promise<SetupReport>`
  - `DOCTOR_KEY_OPTIONS = 'from="100.64.0.0/10",no-port-forwarding,no-agent-forwarding,no-X11-forwarding'`
  - `sshdPlistSpec(paths: MacPaths): PlistSpec`
  - `ensureService(ctx: MacContext, label: string, plistPath: string, mustReload: boolean, requireRunning: boolean): Promise<boolean>` (trả true nếu đã bootstrap lại)
  - Test helper `fakeMac(options?: { tailscaleIp?: string | null; gui?: boolean; spikeLoaded?: boolean }): { home: string; ctx: MacContext; runner: FakeRunner; loaded: Set<string>; out: string[] }`
  - Hằng test `PAPERCLIP_PUB` (dùng lại ở Task 6, 7).
  - `WRAPPER_SOURCE: string` (`src/wrapper.ts`): đường dẫn tuyệt đối tới `apps/crew-mac/assets/crew-claude-run.sh`. Đúng cho cả `src/` lẫn bản build, vì cả hai nằm ngay dưới `apps/crew-mac`.
  - `setup` cài wrapper vào `macPaths(home).wrapper` (`~/.crew/bin/crew-claude-run`), mode 755, nội dung y hệt `WRAPPER_SOURCE`.
  - Hợp đồng wrapper (do `runtime.md` RT-1.1 đặt, dùng nguyên văn): khi `PAPERCLIP_RUN_ID` hợp lệ (chỉ hex và `-`), wrapper ghi `$PWD/.paperclip-runtime/runs/<runId>/pgid` (một số, PGID của chính nó) và `started` (epoch giây), rồi `exec "${CREW_CLAUDE_BIN:-claude}" "$@"`. Không có `PAPERCLIP_RUN_ID` thì chỉ exec. Agent `claude_local` trong Paperclip đặt `adapterConfig.command` bằng đường dẫn này (RT-4).

- [ ] **Step 1: Viết test cho wrapper (sẽ fail)**

`apps/crew-mac/test/crew-claude-run.test.ts` (test ghi PGID và test run id sai dạng lấy từ `runtime.md` RT-1.1):

```ts
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { WRAPPER_SOURCE } from '../src/wrapper.js';

const RUN_A = '11111111-2222-4333-8444-555555555555';
const roots: string[] = [];
const groups: number[] = [];

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'crew-wrapper-'));
  roots.push(root);
  return root;
}

function envWithout(name: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env[name];
  return env;
}

afterEach(() => {
  for (const pgid of groups.splice(0)) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {}
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('crew-claude-run', () => {
  it('file nguồn có quyền chạy', () => {
    expect(statSync(WRAPPER_SOURCE).mode & 0o755).toBe(0o755);
  });

  it('không có PAPERCLIP_RUN_ID thì chỉ exec và chuyển nguyên tham số', () => {
    const root = newRoot();
    const out = execFileSync('/bin/sh', [WRAPPER_SOURCE, '--print', 'a b'], {
      cwd: root,
      env: envWithout('PAPERCLIP_RUN_ID', { CREW_CLAUDE_BIN: '/bin/echo' }),
      encoding: 'utf8',
    });
    expect(out).toBe('--print a b\n');
    expect(existsSync(join(root, '.paperclip-runtime'))).toBe(false);
  });

  it('run id sai dạng thì không ghi gì', () => {
    const root = newRoot();
    execFileSync('/bin/sh', [WRAPPER_SOURCE, '-c', 'true'], {
      cwd: root,
      env: { ...process.env, PAPERCLIP_RUN_ID: '../../etc', CREW_CLAUDE_BIN: '/bin/sh' },
    });
    expect(existsSync(join(root, '.paperclip-runtime'))).toBe(false);
  });

  it.skipIf(process.platform !== 'darwin')('ghi PGID và thời điểm bắt đầu trước khi exec agent', async () => {
    const root = newRoot();
    const child = spawn('/bin/sh', [WRAPPER_SOURCE, '-c', 'exec sleep 301'], {
      cwd: root,
      env: { ...process.env, PAPERCLIP_RUN_ID: RUN_A, CREW_CLAUDE_BIN: '/bin/sh' },
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    groups.push(child.pid as number);
    await sleep(400);
    const dir = join(root, '.paperclip-runtime', 'runs', RUN_A);
    expect(readFileSync(join(dir, 'pgid'), 'utf8').trim()).toBe(String(child.pid));
    const started = Number(readFileSync(join(dir, 'started'), 'utf8').trim());
    expect(Math.abs(started - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Chạy: `pnpm --filter @crew/mac test -- test/crew-claude-run.test.ts`
Kỳ vọng: FAIL vì không tìm thấy `../src/wrapper.js`.

- [ ] **Step 3: Viết wrapper và `wrapper.ts`**

`apps/crew-mac/assets/crew-claude-run.sh` (nguyên văn `runtime.md` RT-1.1 Step 4), rồi chạy `chmod 755 apps/crew-mac/assets/crew-claude-run.sh`:

```sh
#!/bin/sh
# Crew wrapper for claude_local on the Mac (adapterConfig.command).
# Records this run's process group so the server (H3) and crew-mac (MS-2) can stop
# the whole run later, then becomes the agent CLI. The SSH session already gives
# this process its own group, and every exec in the chain keeps the same PID.
if [ -n "${PAPERCLIP_RUN_ID:-}" ]; then
  case "$PAPERCLIP_RUN_ID" in
    *[!0-9a-fA-F-]*) ;;
    *)
      dir="$PWD/.paperclip-runtime/runs/$PAPERCLIP_RUN_ID"
      if mkdir -p "$dir" 2>/dev/null; then
        date +%s > "$dir/started"
        ps -o pgid= -p $$ | tr -d ' ' > "$dir/pgid.tmp" && mv "$dir/pgid.tmp" "$dir/pgid"
      fi
      ;;
  esac
fi
exec "${CREW_CLAUDE_BIN:-claude}" "$@"
```

`apps/crew-mac/src/wrapper.ts`:

```ts
import { fileURLToPath } from 'node:url';

/** Nguồn wrapper crew-claude-run; src/ và bản build cùng nằm ngay dưới apps/crew-mac nên đường dẫn tương đối như nhau. */
export const WRAPPER_SOURCE = fileURLToPath(new URL('../assets/crew-claude-run.sh', import.meta.url));
```

Nếu fork Paperclip đổi `crew/mac/crew-claude-run.sh` thì chép lại nguyên văn vào asset này trong cùng đợt. Hai bản phải giống nhau; `doctor` báo khi bản cài trên Mac khác bản trong repo Crew.

- [ ] **Step 4: Chạy test, xác nhận pass**

Chạy: `pnpm --filter @crew/mac test -- test/crew-claude-run.test.ts`
Kỳ vọng: 4 test PASS trên macOS (trên Linux test thứ tư được bỏ qua).


- [ ] **Step 5: Viết HOME giả và runner giả cho Mac**

`apps/crew-mac/test/helpers/fake-mac.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { MacContext } from '../../src/context.js';
import { SPIKE_LABEL } from '../../src/paths.js';
import { FakeRunner } from './fake-runner.js';

export const PAPERCLIP_PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000 paperclip@vps';

export function fakeMac(options: { tailscaleIp?: string | null; gui?: boolean; spikeLoaded?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'crew-mac-home-'));
  const loaded = new Set<string>(options.spikeLoaded ? [SPIKE_LABEL] : []);
  const labelOf = (target: string | undefined) => String(target).split('/').at(-1) as string;
  const tailscale = () =>
    options.tailscaleIp === null
      ? { code: 1, stderr: 'Tailscale is stopped.' }
      : { stdout: `${options.tailscaleIp ?? '100.102.189.67'}\n` };
  const runner = new FakeRunner()
    .on('launchctl', (args) => {
      const [verb, target] = args;
      if (verb === 'print' && target === 'gui/501') return options.gui === false ? { code: 113 } : { stdout: 'gui/501 = {\n}\n' };
      if (verb === 'print') {
        return loaded.has(labelOf(target))
          ? { stdout: `${target} = {\n\tstate = running\n\tpid = 4242\n\tlast exit code = 0\n}\n` }
          : { code: 113, stderr: 'Could not find service' };
      }
      if (verb === 'bootstrap') {
        loaded.add(basename(String(args[2]), '.plist'));
        return {};
      }
      if (verb === 'bootout') return loaded.delete(labelOf(target)) ? {} : { code: 3, stderr: 'No such process' };
      return { code: 1 };
    })
    .on('tailscale', tailscale)
    .on('/Applications/Tailscale.app/Contents/MacOS/Tailscale', tailscale)
    .on('ssh-keygen', (args) => {
      const file = args[args.indexOf('-f') + 1] as string;
      const comment = args[args.indexOf('-C') + 1] as string;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'PRIVATE\n', { mode: 0o600 });
      writeFileSync(`${file}.pub`, `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake${comment.replaceAll('-', '')} ${comment}\n`);
      return {};
    });
  const out: string[] = [];
  const ctx: MacContext = {
    home,
    user: 'owner',
    uid: 501,
    platform: 'darwin',
    runner,
    now: () => new Date('2026-10-06T07:00:00.000Z'),
    out: (line) => out.push(line),
    nodePath: '/opt/homebrew/bin/node',
    cliPath: '/opt/crew/apps/crew-mac/dist/cli.js',
  };
  return { home, ctx, runner, loaded, out };
}
```

- [ ] **Step 6: Viết test cho setup (sẽ fail)**

`apps/crew-mac/test/setup.test.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setup } from '../src/commands/setup.js';
import { SetupError } from '../src/context.js';
import { macPaths, SSHD_LABEL } from '../src/paths.js';
import { WRAPPER_SOURCE } from '../src/wrapper.js';
import { PATH_BLOCK_BEGIN } from '../src/zshenv.js';
import { fakeMac, PAPERCLIP_PUB } from './helpers/fake-mac.js';

describe('crew-mac setup', () => {
  it('cài sshd phiên Aqua, key, PATH, thư mục worktree và manifest', async () => {
    const { home, ctx, runner, loaded } = fakeMac();
    const paths = macPaths(home);
    writeFileSync(join(home, '.zshenv'), 'export EDITOR=vim\n');
    mkdirSync(join(home, '.ssh'), { recursive: true });
    writeFileSync(paths.authorizedKeys, 'ssh-ed25519 AAAAOwnerKey owner@macbook\n');

    const report = await setup(ctx, { paperclipKey: PAPERCLIP_PUB });

    expect(readFileSync(paths.sshdConfig, 'utf8')).toContain('ListenAddress 100.102.189.67');
    expect(readFileSync(paths.sshdConfig, 'utf8')).toContain('Port 2222');
    expect(readFileSync(paths.sshdPlist, 'utf8')).toContain('<string>Aqua</string>');
    const keys = readFileSync(paths.authorizedKeys, 'utf8');
    expect(keys).toContain('owner@macbook');
    expect(keys).toMatch(/ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey0+ crew-mac-paperclip/);
    expect(keys).toMatch(/^from="100\.64\.0\.0\/10",no-port-forwarding.* crew-mac-doctor$/m);
    expect(statSync(paths.authorizedKeys).mode & 0o777).toBe(0o600);
    expect(readFileSync(paths.zshenv, 'utf8')).toMatch(new RegExp(`^export EDITOR=vim\\n${PATH_BLOCK_BEGIN}`));
    expect(readFileSync(paths.knownHosts, 'utf8')).toMatch(/^\[100\.102\.189\.67\]:2222 ssh-ed25519 \S+\n$/);
    expect(readFileSync(paths.wrapper, 'utf8')).toBe(readFileSync(WRAPPER_SOURCE, 'utf8'));
    expect(statSync(paths.wrapper).mode & 0o777).toBe(0o755);
    expect(existsSync(join(home, 'crew-agents'))).toBe(true);
    expect(loaded.has(SSHD_LABEL)).toBe(true);
    expect(report.restarted).toEqual([SSHD_LABEL]);
    expect(report.manifest).toMatchObject({ port: 2222, listenAddress: '100.102.189.67', worktreeRoot: join(home, 'crew-agents') });
    expect(runner.commands()).toContain(`launchctl bootstrap gui/501 ${paths.sshdPlist}`);
  });

  it('chạy lại không đổi file nào và không restart', async () => {
    const { ctx, runner } = fakeMac();
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    const before = runner.calls.length;
    const report = await setup(ctx);
    expect(report.changed).toEqual([]);
    expect(report.restarted).toEqual([]);
    const later = runner.commands().slice(before);
    expect(later.some((c) => c.includes('bootstrap') || c.includes('bootout') || c.startsWith('ssh-keygen'))).toBe(false);
  });

  it('đổi cổng thì ghi lại config và restart sshd', async () => {
    const { home, ctx, runner } = fakeMac();
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    const before = runner.calls.length;
    const report = await setup(ctx, { port: 2223 });
    expect(readFileSync(macPaths(home).sshdConfig, 'utf8')).toContain('Port 2223');
    expect(report.restarted).toEqual([SSHD_LABEL]);
    expect(runner.commands().slice(before)).toContain(`launchctl bootout gui/501/${SSHD_LABEL}`);
  });

  it.each(['/Volumes/CORSAIR/agents', 'Desktop/agents', 'Downloads/agents'])('từ chối thư mục worktree %s', async (root) => {
    const { home, ctx } = fakeMac();
    const abs = root.startsWith('/') ? root : join(home, root);
    await expect(setup(ctx, { paperclipKey: PAPERCLIP_PUB, worktreeRoot: abs })).rejects.toThrow(SetupError);
  });

  it('từ chối khi chưa có phiên desktop', async () => {
    const { ctx } = fakeMac({ gui: false });
    await expect(setup(ctx, { paperclipKey: PAPERCLIP_PUB })).rejects.toThrow('phiên desktop');
  });

  it('từ chối khi sshd của spike còn chạy', async () => {
    const { ctx } = fakeMac({ spikeLoaded: true });
    await expect(setup(ctx, { paperclipKey: PAPERCLIP_PUB })).rejects.toThrow('com.2p.crew-spike-sshd');
  });

  it('từ chối khi không có IP Tailscale', async () => {
    const { ctx } = fakeMac({ tailscaleIp: null });
    await expect(setup(ctx, { paperclipKey: PAPERCLIP_PUB })).rejects.toThrow('Tailscale');
  });

  it('lần đầu bắt buộc có key Paperclip', async () => {
    const { ctx } = fakeMac();
    await expect(setup(ctx)).rejects.toThrow('--paperclip-key');
  });

  it('từ chối khi không phải macOS', async () => {
    const { ctx } = fakeMac();
    await expect(setup({ ...ctx, platform: 'linux' }, { paperclipKey: PAPERCLIP_PUB })).rejects.toThrow('macOS');
  });
});
```

- [ ] **Step 7: Chạy test, xác nhận fail**

Chạy: `pnpm --filter @crew/mac test -- test/setup.test.ts`
Kỳ vọng: FAIL vì không tìm thấy `../src/commands/setup.js`.

- [ ] **Step 8: Viết `commands/setup.ts`**

```ts
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePublicKey, upsertKey } from '../authorized-keys.js';
import { type MacContext, SetupError } from '../context.js';
import { readText, writeIfChanged } from '../fs-util.js';
import { bootout, bootstrap, guiSessionAvailable, serviceState } from '../launchctl.js';
import { type Manifest, readManifest, writeManifest } from '../manifest.js';
import {
  DEFAULT_PORT,
  DOCTOR_KEY_COMMENT,
  forbiddenRootReason,
  type MacPaths,
  macPaths,
  PAPERCLIP_KEY_COMMENT,
  SPIKE_LABEL,
  SSHD_LABEL,
} from '../paths.js';
import { type PlistSpec, renderPlist } from '../plist.js';
import { renderSshdConfig } from '../sshd-config.js';
import { tailscaleIpv4 } from '../tailscale.js';
import { WRAPPER_SOURCE } from '../wrapper.js';
import { upsertPathBlock } from '../zshenv.js';

export interface SetupOptions {
  paperclipKey?: string;
  port?: number;
  worktreeRoot?: string;
}

export interface SetupReport {
  changed: string[];
  restarted: string[];
  manifest: Manifest;
}

/** Key doctor chỉ vào được từ dải Tailscale và không mở được forwarding. */
export const DOCTOR_KEY_OPTIONS = 'from="100.64.0.0/10",no-port-forwarding,no-agent-forwarding,no-X11-forwarding';

export function sshdPlistSpec(paths: MacPaths): PlistSpec {
  return {
    label: SSHD_LABEL,
    programArguments: ['/usr/sbin/sshd', '-D', '-f', paths.sshdConfig, '-E', paths.sshdLog],
    keepAlive: true,
    aquaOnly: true,
    processType: 'Interactive',
  };
}

async function ensureKeyPair(ctx: MacContext, path: string, comment: string, changed: string[]): Promise<void> {
  if (existsSync(path) && existsSync(`${path}.pub`)) return;
  const result = await ctx.runner.run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', path], {
    timeoutMs: 20_000,
  });
  if (result.code !== 0) throw new SetupError(`ssh-keygen ${path} lỗi: ${result.stderr.trim()}`);
  changed.push(path);
}

function publicKeyOf(path: string): string {
  const { type, body } = parsePublicKey(readFileSync(`${path}.pub`, 'utf8'));
  return `${type} ${body}`;
}

/** Nạp lại service khi config đổi, hoặc khi chưa nạp/chưa chạy. Trả true nếu đã bootstrap. */
export async function ensureService(
  ctx: MacContext,
  label: string,
  plistPath: string,
  mustReload: boolean,
  requireRunning: boolean,
): Promise<boolean> {
  const state = await serviceState(ctx.runner, ctx.uid, label);
  const healthy = requireRunning ? state.running : state.loaded;
  if (healthy && !mustReload) return false;
  if (state.loaded) await bootout(ctx.runner, ctx.uid, label);
  await bootstrap(ctx.runner, ctx.uid, plistPath);
  return true;
}

export async function setup(ctx: MacContext, options: SetupOptions = {}): Promise<SetupReport> {
  if (ctx.platform !== 'darwin') throw new SetupError('crew-mac chỉ chạy trên macOS.');
  const paths = macPaths(ctx.home);
  if (!(await guiSessionAvailable(ctx.runner, ctx.uid))) {
    throw new SetupError(
      'Không thấy phiên desktop (Aqua) của user này. Đăng nhập màn hình Mac rồi chạy lại lệnh trong Terminal của phiên đó.',
    );
  }
  if ((await serviceState(ctx.runner, ctx.uid, SPIKE_LABEL)).loaded) {
    throw new SetupError(
      `LaunchAgent spike ${SPIKE_LABEL} vẫn đang chạy và giữ cổng sshd. Chạy "crew-mac uninstall" trong Terminal trên màn hình Mac rồi setup lại.`,
    );
  }
  const listenAddress = await tailscaleIpv4(ctx.runner);
  if (!listenAddress) {
    throw new SetupError('Không lấy được IP Tailscale ("tailscale ip -4"). Mở app Tailscale, đăng nhập rồi chạy lại.');
  }
  const previous = readManifest(paths.manifest);
  const keyText = options.paperclipKey ?? previous?.paperclipKey;
  if (!keyText) {
    throw new SetupError('Thiếu --paperclip-key (public key SSH của Paperclip: file .pub hoặc chuỗi "ssh-ed25519 AAAA...").');
  }
  const key = parsePublicKey(keyText);
  const paperclipKey = `${key.type} ${key.body}`;
  const port = options.port ?? previous?.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new SetupError(`Cổng ${port} không hợp lệ (cần 1024–65535).`);
  }
  const worktreeRoot = resolve(options.worktreeRoot ?? previous?.worktreeRoot ?? paths.defaultWorktreeRoot);
  const forbidden = forbiddenRootReason(ctx.home, worktreeRoot);
  if (forbidden) throw new SetupError(`${worktreeRoot}: ${forbidden}.`);

  const changed: string[] = [];
  const track = (path: string, didChange: boolean) => {
    if (didChange) changed.push(path);
  };
  mkdirSync(paths.sshdDir, { recursive: true, mode: 0o700 });
  mkdirSync(paths.reaperDir, { recursive: true, mode: 0o700 });
  await ensureKeyPair(ctx, paths.hostKey, 'crew-mac-host', changed);
  await ensureKeyPair(ctx, paths.doctorKey, DOCTOR_KEY_COMMENT, changed);

  const sshdConfig = renderSshdConfig({
    port,
    listenAddress,
    hostKey: paths.hostKey,
    pidFile: paths.sshdPid,
    authorizedKeysFile: paths.authorizedKeys,
    user: ctx.user,
  });
  track(paths.sshdConfig, writeIfChanged(paths.sshdConfig, sshdConfig, 0o600));
  track(
    paths.knownHosts,
    writeIfChanged(paths.knownHosts, `[${listenAddress}]:${port} ${publicKeyOf(paths.hostKey)}\n`, 0o600),
  );
  let keys = upsertKey(readText(paths.authorizedKeys), paperclipKey, PAPERCLIP_KEY_COMMENT);
  keys = upsertKey(keys, publicKeyOf(paths.doctorKey), DOCTOR_KEY_COMMENT, DOCTOR_KEY_OPTIONS);
  track(paths.authorizedKeys, writeIfChanged(paths.authorizedKeys, keys, 0o600));
  track(paths.zshenv, writeIfChanged(paths.zshenv, upsertPathBlock(readText(paths.zshenv)), 0o644));
  track(paths.wrapper, writeIfChanged(paths.wrapper, readFileSync(WRAPPER_SOURCE, 'utf8'), 0o755));
  if (!existsSync(worktreeRoot)) {
    mkdirSync(worktreeRoot, { recursive: true, mode: 0o700 });
    changed.push(worktreeRoot);
  }

  const restarted: string[] = [];
  const sshdPlistChanged = writeIfChanged(paths.sshdPlist, renderPlist(sshdPlistSpec(paths)), 0o644);
  track(paths.sshdPlist, sshdPlistChanged);
  const sshdReload = sshdPlistChanged || changed.includes(paths.sshdConfig) || changed.includes(paths.hostKey);
  if (await ensureService(ctx, SSHD_LABEL, paths.sshdPlist, sshdReload, true)) restarted.push(SSHD_LABEL);

  const manifest: Manifest = {
    version: 1,
    port,
    listenAddress,
    worktreeRoot,
    paperclipKey,
    installedAt: previous?.installedAt ?? ctx.now().toISOString(),
  };
  track(paths.manifest, writeManifest(paths.manifest, manifest));
  return { changed, restarted, manifest };
}
```

- [ ] **Step 9: Chạy test, xác nhận pass**

Chạy: `pnpm --filter @crew/mac test -- test/setup.test.ts && pnpm --filter @crew/mac typecheck`
Kỳ vọng: 11 test PASS (test `it.each` tính từng trường hợp), typecheck sạch.

- [ ] **Step 10: Commit**

```bash
git add apps/crew-mac/assets/crew-claude-run.sh apps/crew-mac/src/wrapper.ts apps/crew-mac/test/crew-claude-run.test.ts \
  apps/crew-mac/src/commands/setup.ts apps/crew-mac/test/helpers/fake-mac.ts apps/crew-mac/test/setup.test.ts
git commit -m "feat(crew-mac): lệnh setup cài sshd phiên desktop, key Paperclip, PATH và wrapper crew-claude-run"
```

---

### Task 5: `crew-mac doctor`

**Files:**
- Create: `apps/crew-mac/src/commands/doctor.ts`
- Test: `apps/crew-mac/test/doctor.test.ts`

**Interfaces:**
- Consumes: `setup` (để dựng HOME đã cài trong test), `macPaths` (kể cả `wrapper`), `readManifest`, `serviceState`, `tailscaleIpv4`, `hasPathBlock`, `forbiddenRootReason`, `readText`, `WRAPPER_SOURCE`.
- Produces:
  - `type CheckStatus = 'ok' | 'warn' | 'fail'`
  - `interface CheckResult { id: string; title: string; status: CheckStatus; detail: string; hint?: string }`
  - `interface DoctorOptions { probe: boolean; tccWindow: string; probeTimeoutSec: number }`
  - `doctor(ctx: MacContext, options: DoctorOptions): Promise<CheckResult[]>`; id các check theo thứ tự: `tailscale`, `sshd-agent`, `sshd-port`, `zshenv-path`, `wrapper`, `worktree-root`, `claude-auth`, `claude-print-git` (khi `probe`), `tcc-pending`, `load`. Nếu chưa cài thì chỉ trả một check `install`.
  - `sshArgs(paths: MacPaths, manifest: Manifest, user: string, remoteCommand: string): string[]`
  - `printProbeScript(worktreeRoot: string, timeoutSec: number): string`
  - `interface PendingPrompt { msgId: string; at: string; service: string; subject: string }`, `parsePendingTccPrompts(logText: string): PendingPrompt[]`, `tccHint(prompt: PendingPrompt): string`
  - `TCC_PREDICATE` (chuỗi predicate của `/usr/bin/log show`)
  - `parseLoad(loadavg: string, ncpu: string, memoryPressure: string): { load1: number; ncpu: number; freePct: number }`

- [ ] **Step 1: Viết test (sẽ fail)**

`apps/crew-mac/test/doctor.test.ts`:

```ts
import { rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  doctor,
  parseLoad,
  parsePendingTccPrompts,
  printProbeScript,
  TCC_PREDICATE,
  tccHint,
} from '../src/commands/doctor.js';
import { setup } from '../src/commands/setup.js';
import { macPaths } from '../src/paths.js';
import { fakeMac, PAPERCLIP_PUB } from './helpers/fake-mac.js';

// Dòng log thật trên Mac mini 06/10/2026 (rút gọn phần đuôi), xem spike-claude-mac.md mục D1.
const TCC_LOG = [
  'Timestamp               Ty Process[PID:TID]',
  '2026-10-06 10:41:02.207 Df tccd[75697:5a8b53a] [com.apple.TCC:access] AUTHREQ_PROMPTING: msgID=75841.27656, service=kTCCServiceSystemPolicyRemovableVolumes, subject=Sub:{/Users/owner/.local/share/claude/versions/2.1.289}Resp:{TCCDProcess: identifier=com.anthropic.claude-code, pid=18951}',
  '2026-10-06 11:57:48.683 Df tccd[75697:5ad68f1] [com.apple.TCC:access] AUTHREQ_PROMPTING: msgID=75841.27701, service=kTCCServiceSystemPolicyDesktopFolder, subject=Sub:{/private/tmp/opendir}Resp:{TCCDProcess: identifier=opendir, pid=84654}',
  '2026-10-06 11:58:10.001 Df tccd[75697:5ad68f1] [com.apple.TCC:access] AUTHREQ_RESULT: msgID=75841.27701, authValue=0, authReason=2, authVersion=1, desired_auth=0, error=(null),',
].join('\n');

const AUTH_OK = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' });

async function installed(sshHandler: (remote: string) => { code?: number; stdout?: string; timedOut?: boolean }) {
  const mac = fakeMac();
  await setup(mac.ctx, { paperclipKey: PAPERCLIP_PUB });
  mac.runner
    .on('/usr/bin/nc', () => ({}))
    .on('ssh', (args) => sshHandler(args.at(-1) as string))
    .on('/usr/bin/log', () => ({ stdout: 'Timestamp               Ty Process[PID:TID]\n' }))
    .on('sysctl', (args) => ({ stdout: args.includes('vm.loadavg') ? '{ 1.47 1.53 1.45 }\n' : '10\n' }))
    .on('memory_pressure', () => ({ stdout: 'System-wide memory free percentage: 55%\n' }));
  return mac;
}

const okSsh = (remote: string) => {
  if (remote.includes('auth status')) return { stdout: AUTH_OK };
  if (remote.includes('crew-claude-run')) return { stdout: '2.1.289 (Claude Code)\n' };
  return { stdout: 'ok\n' };
};

describe('parsePendingTccPrompts', () => {
  it('chỉ trả hộp thoại chưa có kết quả', () => {
    expect(parsePendingTccPrompts(TCC_LOG)).toEqual([
      {
        msgId: '75841.27656',
        at: '2026-10-06 10:41:02.207',
        service: 'kTCCServiceSystemPolicyRemovableVolumes',
        subject: '/Users/owner/.local/share/claude/versions/2.1.289',
      },
    ]);
  });

  it('hướng dẫn nêu tên binary, loại quyền và chỗ bấm', () => {
    const [prompt] = parsePendingTccPrompts(TCC_LOG);
    const hint = tccHint(prompt as NonNullable<typeof prompt>);
    expect(hint).toContain('"2.1.289"');
    expect(hint).toContain('ổ đĩa di động');
    expect(hint).toContain('Allow');
    expect(hint).toContain('Privacy & Security');
  });
});

describe('printProbeScript', () => {
  it('chạy claude -p trong git repo tạm dưới thư mục worktree, tự SIGKILL khi quá hạn và dọn', () => {
    const script = printProbeScript("/Users/owner/crew agents/it's", 90);
    expect(script).toContain(`mktemp -d '/Users/owner/crew agents/it'\\''s/.crew-mac-doctor-XXXXXX'`);
    expect(script).toContain('git -C "$d" init -q');
    expect(script).toContain("claude -p 'Trả lời đúng một từ: ok' --model haiku --setting-sources project,local");
    expect(script).toContain('-lt 90');
    expect(script).toContain('kill -9 "$p"');
    expect(script).toContain('echo CREW_MAC_TIMEOUT');
    expect(script).toContain('rm -rf "$d"');
  });
});

describe('parseLoad', () => {
  it('đọc load 1 phút, số CPU và phần trăm RAM trống', () => {
    expect(parseLoad('{ 1.47 1.53 1.45 }', '10', 'System-wide memory free percentage: 55%')).toEqual({
      load1: 1.47,
      ncpu: 10,
      freePct: 55,
    });
  });
});

describe('crew-mac doctor', () => {
  it('chưa cài thì chỉ báo một lỗi cài đặt', async () => {
    const { ctx } = fakeMac();
    const results = await doctor(ctx, { probe: true, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.map((r) => [r.id, r.status])).toEqual([['install', 'fail']]);
  });

  it('máy đã cài và khỏe thì mọi check đạt', async () => {
    const { ctx, runner } = await installed(okSsh);
    const results = await doctor(ctx, { probe: true, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.map((r) => [r.id, r.status])).toEqual([
      ['tailscale', 'ok'],
      ['sshd-agent', 'ok'],
      ['sshd-port', 'ok'],
      ['zshenv-path', 'ok'],
      ['wrapper', 'ok'],
      ['worktree-root', 'ok'],
      ['claude-auth', 'ok'],
      ['claude-print-git', 'ok'],
      ['tcc-pending', 'ok'],
      ['load', 'ok'],
    ]);
    const log = runner.calls.find((c) => c.command === '/usr/bin/log');
    expect(log?.args).toEqual(['show', '--last', '24h', '--style', 'compact', '--predicate', TCC_PREDICATE]);
    const ssh = runner.calls.find((c) => c.command === 'ssh');
    expect(ssh?.args).toContain('BatchMode=yes');
    expect(ssh?.args).toContain('owner@100.102.189.67');
  });

  it('claude treo: phép thử fail và trỏ sang check TCC', async () => {
    const { ctx } = await installed((remote) =>
      remote.includes('claude -p') ? { code: 124, stdout: 'CREW_MAC_TIMEOUT\n' } : okSsh(remote),
    );
    const results = await doctor(ctx, { probe: true, tccWindow: '24h', probeTimeoutSec: 90 });
    const probe = results.find((r) => r.id === 'claude-print-git');
    expect(probe?.status).toBe('fail');
    expect(probe?.hint).toContain('tcc-pending');
  });

  it('runner phía Mac quá hạn cũng tính là treo', async () => {
    const { ctx } = await installed((remote) =>
      remote.includes('claude -p') ? { code: 137, timedOut: true } : okSsh(remote),
    );
    const results = await doctor(ctx, { probe: true, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'claude-print-git')?.status).toBe('fail');
  });

  it('hộp thoại TCC đang chờ thì fail kèm hướng dẫn', async () => {
    const mac = await installed(okSsh);
    mac.runner.on('/usr/bin/log', () => ({ stdout: TCC_LOG }));
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    const tcc = results.find((r) => r.id === 'tcc-pending');
    expect(tcc?.status).toBe('fail');
    expect(tcc?.detail).toContain('2.1.289');
    expect(tcc?.hint).toContain('Allow');
    expect(results.some((r) => r.id === 'claude-print-git')).toBe(false);
  });

  it('Claude chưa đăng nhập trong phiên sshd thì fail', async () => {
    const { ctx } = await installed((remote) =>
      remote.includes('auth status') ? { stdout: JSON.stringify({ loggedIn: false }) } : okSsh(remote),
    );
    const results = await doctor(ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'claude-auth')?.status).toBe('fail');
  });

  it('IP Tailscale đổi so với config thì fail', async () => {
    const mac = await installed(okSsh);
    mac.runner.on('tailscale', () => ({ stdout: '100.101.1.1\n' }));
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'tailscale')?.status).toBe('fail');
  });

  it('wrapper bị xóa thì fail, bị sửa thì cảnh báo', async () => {
    const mac = await installed(okSsh);
    const paths = macPaths(mac.home);
    writeFileSync(paths.wrapper, '#!/bin/sh\nexec claude "$@"\n', { mode: 0o755 });
    let results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'wrapper')?.status).toBe('warn');
    rmSync(paths.wrapper);
    results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'wrapper')?.status).toBe('fail');
  });

  it('wrapper không chạy được qua sshd agent thì fail', async () => {
    const { ctx } = await installed((remote) =>
      remote.includes('crew-claude-run') ? { code: 127, stderr: 'claude: command not found' } : okSsh(remote),
    );
    const results = await doctor(ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'wrapper')?.status).toBe('fail');
  });

  it('máy quá tải thì cảnh báo', async () => {
    const mac = await installed(okSsh);
    mac.runner.on('sysctl', (args) => ({ stdout: args.includes('vm.loadavg') ? '{ 25.0 20.0 18.0 }\n' : '10\n' }));
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'load')?.status).toBe('warn');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Chạy: `pnpm --filter @crew/mac test -- test/doctor.test.ts`
Kỳ vọng: FAIL vì không tìm thấy `../src/commands/doctor.js`.

- [ ] **Step 3: Viết `commands/doctor.ts`**

```ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { MacContext } from '../context.js';
import { readText } from '../fs-util.js';
import { serviceState } from '../launchctl.js';
import { type Manifest, readManifest } from '../manifest.js';
import { forbiddenRootReason, type MacPaths, macPaths, SSHD_LABEL } from '../paths.js';
import { tailscaleIpv4 } from '../tailscale.js';
import { WRAPPER_SOURCE } from '../wrapper.js';
import { hasPathBlock } from '../zshenv.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

export interface DoctorOptions {
  probe: boolean;
  tccWindow: string;
  probeTimeoutSec: number;
}

export interface PendingPrompt {
  msgId: string;
  at: string;
  service: string;
  subject: string;
}

export const TCC_PREDICATE =
  'process == "tccd" AND (eventMessage CONTAINS "AUTHREQ_PROMPTING" OR eventMessage CONTAINS "AUTHREQ_RESULT")';

const PROMPT_RE = /^(\S+ \S+) .*AUTHREQ_PROMPTING: msgID=([\d.]+), service=(\w+), subject=Sub:\{([^}]*)\}/;
const RESULT_RE = /AUTHREQ_RESULT: msgID=([\d.]+),/;

export function parsePendingTccPrompts(logText: string): PendingPrompt[] {
  const prompts = new Map<string, PendingPrompt>();
  const answered = new Set<string>();
  for (const line of logText.split('\n')) {
    const prompt = PROMPT_RE.exec(line);
    if (prompt) {
      const msgId = prompt[2] as string;
      prompts.set(msgId, { msgId, at: prompt[1] as string, service: prompt[3] as string, subject: prompt[4] as string });
      continue;
    }
    const result = RESULT_RE.exec(line);
    if (result) answered.add(result[1] as string);
  }
  return [...prompts.values()].filter((p) => !answered.has(p.msgId));
}

const SERVICE_VI: Record<string, { what: string; section: string }> = {
  kTCCServiceSystemPolicyRemovableVolumes: { what: 'tệp trên ổ đĩa di động', section: 'Files and Folders' },
  kTCCServiceSystemPolicyNetworkVolumes: { what: 'tệp trên ổ mạng', section: 'Files and Folders' },
  kTCCServiceSystemPolicyDesktopFolder: { what: 'thư mục Desktop', section: 'Files and Folders' },
  kTCCServiceSystemPolicyDownloadsFolder: { what: 'thư mục Downloads', section: 'Files and Folders' },
  kTCCServiceSystemPolicyDocumentsFolder: { what: 'thư mục Documents', section: 'Files and Folders' },
  kTCCServiceSystemPolicyAllFiles: { what: 'toàn bộ ổ đĩa', section: 'Full Disk Access' },
};

export function tccHint(prompt: PendingPrompt): string {
  const known = SERVICE_VI[prompt.service] ?? { what: prompt.service, section: 'Files and Folders' };
  return (
    `Mở màn hình Mac (trực tiếp hoặc qua Chrome Remote Desktop), tìm hộp thoại "${basename(prompt.subject)}" ` +
    `muốn truy cập ${known.what}, bấm "Allow". Nếu không thấy hộp thoại: System Settings → Privacy & Security → ` +
    `${known.section}, bật quyền cho ${prompt.subject}. Claude Code cập nhật bản mới thì đường dẫn đổi và macOS hỏi lại.`
  );
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Script chạy phía Mac: tự SIGKILL claude khi quá hạn để không để lại process treo (claude bỏ qua SIGTERM). */
export function printProbeScript(worktreeRoot: string, timeoutSec: number): string {
  return [
    `d=$(mktemp -d ${shQuote(`${worktreeRoot}/.crew-mac-doctor-XXXXXX`)}) || exit 90`,
    'git -C "$d" init -q || { rm -rf "$d"; exit 91; }',
    'cd "$d" || exit 92',
    `claude -p 'Trả lời đúng một từ: ok' --model haiku --setting-sources project,local </dev/null >"$d.out" 2>&1 &`,
    'p=$!',
    'i=0',
    `while kill -0 "$p" 2>/dev/null && [ "$i" -lt ${timeoutSec} ]; do sleep 1; i=$((i+1)); done`,
    'if kill -0 "$p" 2>/dev/null; then kill -9 "$p"; wait "$p" 2>/dev/null; echo CREW_MAC_TIMEOUT; rc=124; else wait "$p"; rc=$?; fi',
    'cat "$d.out"',
    'cd / && rm -rf "$d" "$d.out"',
    'exit $rc',
  ].join('\n');
}

export function sshArgs(paths: MacPaths, manifest: Manifest, user: string, remoteCommand: string): string[] {
  return [
    '-p',
    String(manifest.port),
    '-i',
    paths.doctorKey,
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    `UserKnownHostsFile=${paths.knownHosts}`,
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ConnectTimeout=5',
    `${user}@${manifest.listenAddress}`,
    remoteCommand,
  ];
}

export function parseLoad(loadavg: string, ncpu: string, memoryPressure: string) {
  const load1 = Number(/\{\s*([\d.]+)/.exec(loadavg)?.[1] ?? Number.NaN);
  const freePct = Number(/free percentage:\s*(\d+)%/.exec(memoryPressure)?.[1] ?? Number.NaN);
  return { load1, ncpu: Number(ncpu.trim()), freePct };
}

async function checkTailscale(ctx: MacContext, manifest: Manifest): Promise<CheckResult> {
  const ip = await tailscaleIpv4(ctx.runner);
  const base = { id: 'tailscale', title: 'Tailscale' };
  if (!ip) return { ...base, status: 'fail', detail: 'không lấy được IP', hint: 'Mở app Tailscale và đăng nhập.' };
  if (ip !== manifest.listenAddress) {
    return {
      ...base,
      status: 'fail',
      detail: `IP hiện tại ${ip}, sshd đang nghe ${manifest.listenAddress}`,
      hint: 'Chạy lại "crew-mac setup" để sshd nghe IP mới, rồi sửa environment trong Paperclip.',
    };
  }
  return { ...base, status: 'ok', detail: ip };
}

async function checkSshdService(ctx: MacContext): Promise<CheckResult> {
  const state = await serviceState(ctx.runner, ctx.uid, SSHD_LABEL);
  const base = { id: 'sshd-agent', title: 'sshd agent (phiên desktop)' };
  if (state.running) return { ...base, status: 'ok', detail: `${SSHD_LABEL} pid ${state.pid}` };
  return {
    ...base,
    status: 'fail',
    detail: state.loaded ? `${SSHD_LABEL} đã nạp nhưng không chạy (mã thoát ${state.lastExitCode})` : `${SSHD_LABEL} chưa nạp`,
    hint: 'Đăng nhập màn hình Mac (LaunchAgent chỉ chạy trong phiên desktop), rồi chạy lại "crew-mac setup". Lỗi chi tiết ở ~/.crew-mac/sshd/sshd.log.',
  };
}

async function checkSshdPort(ctx: MacContext, manifest: Manifest): Promise<CheckResult> {
  const result = await ctx.runner.run('/usr/bin/nc', ['-z', '-G', '3', manifest.listenAddress, String(manifest.port)], {
    timeoutMs: 10_000,
  });
  const where = `${manifest.listenAddress}:${manifest.port}`;
  return result.code === 0
    ? { id: 'sshd-port', title: 'Cổng sshd', status: 'ok', detail: where }
    : { id: 'sshd-port', title: 'Cổng sshd', status: 'fail', detail: `không kết nối được ${where}`, hint: 'Xem ~/.crew-mac/sshd/sshd.log.' };
}

function checkZshenv(paths: MacPaths): CheckResult {
  return hasPathBlock(readText(paths.zshenv))
    ? { id: 'zshenv-path', title: 'PATH cho claude', status: 'ok', detail: paths.zshenv }
    : { id: 'zshenv-path', title: 'PATH cho claude', status: 'fail', detail: `thiếu khối crew-mac trong ${paths.zshenv}`, hint: 'Chạy lại "crew-mac setup".' };
}

async function checkWrapper(ctx: MacContext, paths: MacPaths, manifest: Manifest): Promise<CheckResult> {
  const base = { id: 'wrapper', title: 'Wrapper crew-claude-run' };
  const reinstall = 'Chạy lại "crew-mac setup".';
  if (!existsSync(paths.wrapper)) return { ...base, status: 'fail', detail: `thiếu ${paths.wrapper}`, hint: reinstall };
  if ((statSync(paths.wrapper).mode & 0o111) === 0) {
    return { ...base, status: 'fail', detail: `${paths.wrapper} không có quyền chạy`, hint: reinstall };
  }
  const result = await ctx.runner.run(
    'ssh',
    sshArgs(paths, manifest, ctx.user, '"$HOME/.crew/bin/crew-claude-run" --version'),
    { timeoutMs: 30_000 },
  );
  if (result.code !== 0 || !/Claude Code/.test(result.stdout)) {
    return {
      ...base,
      status: 'fail',
      detail: `chạy qua sshd agent lỗi (mã ${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 200)}`,
      hint: 'Kiểm check zshenv-path và claude có trong ~/.local/bin.',
    };
  }
  if (readFileSync(paths.wrapper, 'utf8') !== readFileSync(WRAPPER_SOURCE, 'utf8')) {
    return { ...base, status: 'warn', detail: `${paths.wrapper} khác bản trong repo Crew`, hint: reinstall };
  }
  return {
    ...base,
    status: 'ok',
    detail: `${paths.wrapper} → ${result.stdout.trim()}; agent đặt adapterConfig.command bằng đường dẫn này`,
  };
}

function checkWorktreeRoot(ctx: MacContext, manifest: Manifest): CheckResult {
  const base = { id: 'worktree-root', title: 'Thư mục worktree' };
  const reason = forbiddenRootReason(ctx.home, manifest.worktreeRoot);
  if (reason) return { ...base, status: 'fail', detail: `${manifest.worktreeRoot}: ${reason}` };
  if (!existsSync(manifest.worktreeRoot)) {
    return { ...base, status: 'fail', detail: `${manifest.worktreeRoot} không tồn tại`, hint: 'Chạy lại "crew-mac setup".' };
  }
  return { ...base, status: 'ok', detail: manifest.worktreeRoot };
}

async function checkClaudeAuth(ctx: MacContext, paths: MacPaths, manifest: Manifest): Promise<CheckResult> {
  const base = { id: 'claude-auth', title: 'Claude đăng nhập (qua sshd agent)' };
  const result = await ctx.runner.run('ssh', sshArgs(paths, manifest, ctx.user, 'claude auth status'), { timeoutMs: 30_000 });
  if (result.code === 255 || result.timedOut) {
    return { ...base, status: 'fail', detail: `không SSH được vào sshd agent: ${result.stderr.trim()}` };
  }
  try {
    const status = JSON.parse(result.stdout) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
    if (status.loggedIn === true) {
      return { ...base, status: 'ok', detail: `${status.authMethod ?? '?'}, gói ${status.subscriptionType ?? '?'}` };
    }
  } catch {
    // Không phải JSON: rơi xuống báo lỗi chung bên dưới.
  }
  return {
    ...base,
    status: 'fail',
    detail: `claude auth status: ${result.stdout.trim().slice(0, 200) || result.stderr.trim().slice(0, 200)}`,
    hint: 'Trên màn hình Mac, mở Terminal, chạy "claude" rồi /login. Nếu đã đăng nhập mà vẫn lỗi thì Keychain đang khóa: khóa rồi mở lại màn hình Mac.',
  };
}

async function checkClaudePrint(
  ctx: MacContext,
  paths: MacPaths,
  manifest: Manifest,
  timeoutSec: number,
): Promise<CheckResult> {
  const base = { id: 'claude-print-git', title: 'claude -p trong git repo' };
  const script = printProbeScript(manifest.worktreeRoot, timeoutSec);
  const result = await ctx.runner.run('ssh', sshArgs(paths, manifest, ctx.user, script), {
    timeoutMs: (timeoutSec + 30) * 1000,
  });
  if (result.timedOut || result.stdout.includes('CREW_MAC_TIMEOUT')) {
    return {
      ...base,
      status: 'fail',
      detail: `claude không trả lời sau ${timeoutSec} giây`,
      hint: 'Thường do hộp thoại quyền macOS đang chờ: xem check tcc-pending ngay bên dưới.',
    };
  }
  if (result.code === 0 && /\bok\b/i.test(result.stdout)) return { ...base, status: 'ok', detail: 'trả lời ok' };
  return { ...base, status: 'fail', detail: `mã ${result.code}: ${result.stdout.trim().slice(-300)}` };
}

async function checkTccPending(ctx: MacContext, window: string): Promise<CheckResult> {
  const base = { id: 'tcc-pending', title: 'Hộp thoại quyền macOS đang chờ' };
  const result = await ctx.runner.run(
    '/usr/bin/log',
    ['show', '--last', window, '--style', 'compact', '--predicate', TCC_PREDICATE],
    { timeoutMs: 240_000 },
  );
  if (result.code !== 0) return { ...base, status: 'warn', detail: `không đọc được log hệ thống: ${result.stderr.trim()}` };
  const pending = parsePendingTccPrompts(result.stdout);
  if (pending.length === 0) return { ...base, status: 'ok', detail: `không có trong ${window} gần nhất` };
  return {
    ...base,
    status: 'fail',
    detail: pending.map((p) => `${p.at} ${p.service} cho ${p.subject}`).join('; '),
    hint: pending.map(tccHint).join('\n'),
  };
}

async function checkLoad(ctx: MacContext): Promise<CheckResult> {
  const [loadavg, ncpu, pressure] = await Promise.all([
    ctx.runner.run('sysctl', ['-n', 'vm.loadavg'], { timeoutMs: 10_000 }),
    ctx.runner.run('sysctl', ['-n', 'hw.ncpu'], { timeoutMs: 10_000 }),
    ctx.runner.run('memory_pressure', ['-Q'], { timeoutMs: 10_000 }),
  ]);
  const load = parseLoad(loadavg.stdout, ncpu.stdout, pressure.stdout);
  const detail = `load 1 phút ${load.load1} / ${load.ncpu} CPU, RAM trống ${load.freePct}%`;
  const busy = load.load1 / load.ncpu > 1.5 || load.freePct < 10;
  return busy
    ? { id: 'load', title: 'Tải máy', status: 'warn', detail, hint: 'Máy đang bận; cổng tải của Paperclip (RT-2) sẽ cho run chờ.' }
    : { id: 'load', title: 'Tải máy', status: 'ok', detail };
}

export async function doctor(ctx: MacContext, options: DoctorOptions): Promise<CheckResult[]> {
  const paths = macPaths(ctx.home);
  const manifest = readManifest(paths.manifest);
  if (!manifest) {
    return [
      {
        id: 'install',
        title: 'Cài đặt',
        status: 'fail',
        detail: `chưa có ${paths.manifest}`,
        hint: 'Chạy "crew-mac setup --paperclip-key <file .pub>" trong Terminal trên màn hình Mac.',
      },
    ];
  }
  const results: CheckResult[] = [];
  results.push(await checkTailscale(ctx, manifest));
  results.push(await checkSshdService(ctx));
  results.push(await checkSshdPort(ctx, manifest));
  results.push(checkZshenv(paths));
  results.push(await checkWrapper(ctx, paths, manifest));
  results.push(checkWorktreeRoot(ctx, manifest));
  results.push(await checkClaudeAuth(ctx, paths, manifest));
  if (options.probe) results.push(await checkClaudePrint(ctx, paths, manifest, options.probeTimeoutSec));
  results.push(await checkTccPending(ctx, options.tccWindow));
  results.push(await checkLoad(ctx));
  return results;
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Chạy: `pnpm --filter @crew/mac test -- test/doctor.test.ts && pnpm --filter @crew/mac typecheck`
Kỳ vọng: toàn bộ PASS, typecheck sạch.

- [ ] **Step 5: Commit**

```bash
git add apps/crew-mac/src/commands/doctor.ts apps/crew-mac/test/doctor.test.ts
git commit -m "feat(crew-mac): lệnh doctor kiểm sshd, đăng nhập Claude, phép thử claude -p và hộp thoại TCC"
```

---

### Task 6: `crew-mac uninstall` (kể cả phần spike)

**Files:**
- Create: `apps/crew-mac/src/commands/uninstall.ts`
- Test: `apps/crew-mac/test/uninstall.test.ts`

**Interfaces:**
- Consumes: `setup`, `fakeMac`, `PAPERCLIP_PUB`, `bootout`, `macPaths`, label và comment ở `paths.ts`, `removeKeysByComment`, `removePathBlock`, `removeSpikePathLines`, `readManifest`, `writeIfChanged`, `readText`.
- Produces:
  - `interface UninstallReport { removed: string[]; kept: string[] }`
  - `uninstall(ctx: MacContext): Promise<UninstallReport>`: gỡ LaunchAgent `REAPER_LABEL`, `SSHD_LABEL`, `SPIKE_LABEL` cùng plist của chúng, các dòng key có comment `crew-mac-paperclip`, `crew-mac-doctor`, `crew-v3-spike-paperclip`, khối PATH crew-mac và hai dòng PATH spike (xóa `~/.zshenv` nếu file còn rỗng), wrapper `~/.crew/bin/crew-claude-run` (và `~/.crew/bin` nếu rỗng), `~/.crew-mac`, `~/.crew-spike-sshd`. Không đụng phần còn lại của `~/.crew` (thư mục của `crewd` v2). Giữ nguyên thư mục worktree (báo trong `kept`).

- [ ] **Step 1: Viết test (sẽ fail)**

`apps/crew-mac/test/uninstall.test.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setup } from '../src/commands/setup.js';
import { uninstall } from '../src/commands/uninstall.js';
import { macPaths, SPIKE_LABEL, SSHD_LABEL } from '../src/paths.js';
import { PATH_BLOCK_BODY, SPIKE_PATH_COMMENT } from '../src/zshenv.js';
import { fakeMac, PAPERCLIP_PUB } from './helpers/fake-mac.js';

const OWNER_KEY = 'ssh-ed25519 AAAAOwnerKey owner@macbook';

function seedSpike(home: string) {
  const paths = macPaths(home);
  mkdirSync(paths.spikeDir, { recursive: true });
  writeFileSync(join(paths.spikeDir, 'sshd_config'), 'Port 2222\n');
  mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(paths.spikePlist, '<plist/>\n');
  writeFileSync(paths.zshenv, `${SPIKE_PATH_COMMENT}\n${PATH_BLOCK_BODY}\n`);
  mkdirSync(join(home, '.ssh'), { recursive: true });
  writeFileSync(
    paths.authorizedKeys,
    `${OWNER_KEY}\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISpikeKey crew-v3-spike-paperclip\n`,
  );
}

describe('crew-mac uninstall', () => {
  it('gỡ phần spike rồi setup cài lại được (kịch bản AC-1)', async () => {
    const { home, ctx, loaded } = fakeMac({ spikeLoaded: true });
    seedSpike(home);
    const paths = macPaths(home);

    const first = await uninstall(ctx);
    expect(first.removed).toContain(`LaunchAgent ${SPIKE_LABEL}`);
    expect(loaded.has(SPIKE_LABEL)).toBe(false);
    expect(existsSync(paths.spikePlist)).toBe(false);
    expect(existsSync(paths.spikeDir)).toBe(false);
    expect(existsSync(paths.zshenv)).toBe(false);
    expect(readFileSync(paths.authorizedKeys, 'utf8')).toBe(`${OWNER_KEY}\n`);

    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    expect(loaded.has(SSHD_LABEL)).toBe(true);
  });

  it('gỡ đúng những gì setup cài, giữ nội dung của owner và thư mục worktree', async () => {
    const { home, ctx, loaded } = fakeMac();
    const paths = macPaths(home);
    writeFileSync(paths.zshenv, 'export EDITOR=vim\n');
    mkdirSync(join(home, '.ssh'), { recursive: true });
    writeFileSync(paths.authorizedKeys, `${OWNER_KEY}\n`);
    mkdirSync(join(home, '.crew'), { recursive: true });
    writeFileSync(join(home, '.crew', 'config.yaml'), 'apiUrl: x\n');
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });

    const report = await uninstall(ctx);

    expect(loaded.size).toBe(0);
    expect(existsSync(paths.sshdPlist)).toBe(false);
    expect(existsSync(paths.root)).toBe(false);
    expect(readFileSync(paths.zshenv, 'utf8')).toBe('export EDITOR=vim\n');
    expect(readFileSync(paths.authorizedKeys, 'utf8')).toBe(`${OWNER_KEY}\n`);
    expect(existsSync(join(home, 'crew-agents'))).toBe(true);
    expect(report.kept).toEqual([join(home, 'crew-agents')]);
    expect(existsSync(paths.wrapper)).toBe(false);
    expect(readFileSync(join(home, '.crew', 'config.yaml'), 'utf8')).toBe('apiUrl: x\n');
  });

  it('chạy lại khi đã gỡ hết thì không lỗi và không gỡ gì', async () => {
    const { ctx } = fakeMac();
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    await uninstall(ctx);
    expect(await uninstall(ctx)).toEqual({ removed: [], kept: [] });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Chạy: `pnpm --filter @crew/mac test -- test/uninstall.test.ts`
Kỳ vọng: FAIL vì không tìm thấy `../src/commands/uninstall.js`.

- [ ] **Step 3: Viết `commands/uninstall.ts`**

```ts
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { removeKeysByComment } from '../authorized-keys.js';
import { type MacContext, SetupError } from '../context.js';
import { readText, writeIfChanged } from '../fs-util.js';
import { bootout } from '../launchctl.js';
import { type Manifest, readManifest } from '../manifest.js';
import {
  DOCTOR_KEY_COMMENT,
  macPaths,
  PAPERCLIP_KEY_COMMENT,
  REAPER_LABEL,
  SPIKE_KEY_COMMENT,
  SPIKE_LABEL,
  SSHD_LABEL,
} from '../paths.js';
import { removePathBlock, removeSpikePathLines } from '../zshenv.js';

export interface UninstallReport {
  removed: string[];
  kept: string[];
}

function manifestOrNull(path: string): Manifest | null {
  try {
    return readManifest(path);
  } catch {
    return null;
  }
}

export async function uninstall(ctx: MacContext): Promise<UninstallReport> {
  if (ctx.platform !== 'darwin') throw new SetupError('crew-mac chỉ chạy trên macOS.');
  const paths = macPaths(ctx.home);
  const manifest = manifestOrNull(paths.manifest);
  const removed: string[] = [];

  for (const label of [REAPER_LABEL, SSHD_LABEL, SPIKE_LABEL]) {
    if (await bootout(ctx.runner, ctx.uid, label)) removed.push(`LaunchAgent ${label}`);
  }
  for (const file of [paths.reaperPlist, paths.sshdPlist, paths.spikePlist]) {
    if (existsSync(file)) {
      rmSync(file);
      removed.push(file);
    }
  }
  if (existsSync(paths.authorizedKeys)) {
    let keys = readText(paths.authorizedKeys);
    for (const comment of [PAPERCLIP_KEY_COMMENT, DOCTOR_KEY_COMMENT, SPIKE_KEY_COMMENT]) {
      keys = removeKeysByComment(keys, comment);
    }
    if (writeIfChanged(paths.authorizedKeys, keys, 0o600)) removed.push(`${paths.authorizedKeys} (key crew-mac và spike)`);
  }
  if (existsSync(paths.zshenv)) {
    const next = removeSpikePathLines(removePathBlock(readText(paths.zshenv)));
    if (next.trim() === '') {
      rmSync(paths.zshenv);
      removed.push(paths.zshenv);
    } else if (writeIfChanged(paths.zshenv, next, 0o644)) {
      removed.push(`${paths.zshenv} (dòng PATH crew-mac và spike)`);
    }
  }
  if (existsSync(paths.wrapper)) {
    rmSync(paths.wrapper);
    removed.push(paths.wrapper);
  }
  if (existsSync(paths.crewBin) && readdirSync(paths.crewBin).length === 0) rmSync(paths.crewBin, { recursive: true });
  for (const dir of [paths.root, paths.spikeDir]) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    }
  }
  return { removed, kept: manifest ? [manifest.worktreeRoot] : [] };
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Chạy: `pnpm --filter @crew/mac test -- test/uninstall.test.ts && pnpm --filter @crew/mac typecheck`
Kỳ vọng: 3 test PASS, typecheck sạch.

- [ ] **Step 5: Commit**

```bash
git add apps/crew-mac/src/commands/uninstall.ts apps/crew-mac/test/uninstall.test.ts
git commit -m "feat(crew-mac): lệnh uninstall gỡ cài đặt crew-mac và phần spike"
```

---

### Task 7: CLI `crew-mac` và docs flow `mac-setup`

**Files:**
- Create: `apps/crew-mac/src/cli.ts`
- Test: `apps/crew-mac/test/cli.test.ts`
- Create: `docs/flows/mac-setup.md`
- Modify: `docs/flows.yaml` (thêm flow `mac-setup` ngay trước dòng `shared:`)
- Modify: `docs/index.md` (bảng "Bản đồ module", thêm một dòng sau dòng `apps/desktop/src/renderer`)
- Regenerate: `docs/index.md` (khối flow tự sinh), `docs/files.md`

**Interfaces:**
- Consumes: `setup`, `doctor`, `uninstall`, `readManifest`, `macPaths`, `DEFAULT_PORT`, `createRunner`.
- Produces:
  - `USAGE: string`
  - `interface CliIo { out: (line: string) => void; err: (line: string) => void; env: NodeJS.ProcessEnv; context?: Partial<MacContext> }`
  - `main(argv: readonly string[], io: CliIo): Promise<number>`: 0 là đạt; 1 là lỗi hoặc doctor có check `fail`; 2 là sai cú pháp hoặc bị từ chối an toàn.
  - `defaultContext(env: NodeJS.ProcessEnv, out: (line: string) => void): MacContext`
  - `stableNodePath(): string`
  - `sshServerPort(env: NodeJS.ProcessEnv): number | null`
  - Task 9 thêm nhánh `reap` vào `main`.

- [ ] **Step 1: Viết test CLI (sẽ fail)**

`apps/crew-mac/test/cli.test.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, sshServerPort, USAGE } from '../src/cli.js';
import { fakeMac, PAPERCLIP_PUB } from './helpers/fake-mac.js';

function io(mac: ReturnType<typeof fakeMac>, env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env, context: mac.ctx } };
}

describe('crew-mac CLI', () => {
  it('lệnh lạ in cách dùng, mã 2', async () => {
    const t = io(fakeMac());
    expect(await main(['lung-tung'], t.io)).toBe(2);
    expect(t.err.join('\n')).toContain(USAGE);
  });

  it('setup đọc key từ file .pub và in việc đã làm', async () => {
    const mac = fakeMac();
    const keyFile = join(mac.home, 'paperclip.pub');
    writeFileSync(keyFile, `${PAPERCLIP_PUB}\n`);
    const t = io(mac);
    expect(await main(['setup', '--paperclip-key', keyFile], t.io)).toBe(0);
    expect(t.out.join('\n')).toContain('sshd agent nghe 100.102.189.67:2222');
    expect(t.out.join('\n')).toContain(`adapterConfig.command = ${mac.home}/.crew/bin/crew-claude-run`);
  });

  it('doctor trả 1 khi có check lỗi', async () => {
    const t = io(fakeMac());
    expect(await main(['doctor', '--no-probe'], t.io)).toBe(1);
    expect(t.out.join('\n')).toContain('[LỖI] Cài đặt');
  });

  it('uninstall từ chối khi đang chạy qua chính sshd agent, trừ khi có --force', async () => {
    const mac = fakeMac();
    const viaAgent = io(mac, { SSH_CONNECTION: '100.88.1.2 51234 100.102.189.67 2222' });
    expect(await main(['uninstall'], viaAgent.io)).toBe(2);
    expect(viaAgent.err.join('\n')).toContain('Terminal trên màn hình Mac');
    const forced = io(mac, { SSH_CONNECTION: '100.88.1.2 51234 100.102.189.67 2222' });
    expect(await main(['uninstall', '--force'], forced.io)).toBe(0);
  });

  it('đọc cổng server từ SSH_CONNECTION', () => {
    expect(sshServerPort({ SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22' })).toBe(22);
    expect(sshServerPort({})).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Chạy: `pnpm --filter @crew/mac test -- test/cli.test.ts`
Kỳ vọng: FAIL vì không tìm thấy `../src/cli.js`.

- [ ] **Step 3: Viết `cli.ts`**

```ts
#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { type CheckStatus, doctor } from './commands/doctor.js';
import { setup } from './commands/setup.js';
import { uninstall } from './commands/uninstall.js';
import type { MacContext } from './context.js';
import { readManifest } from './manifest.js';
import { DEFAULT_PORT, macPaths } from './paths.js';
import { createRunner } from './system.js';

export const USAGE = `crew-mac: cài và kiểm Mac chạy agent cho Crew v3

Cách dùng:
  crew-mac setup --paperclip-key <file .pub | chuỗi key> [--port 2222] [--worktree-root <thư mục>]
  crew-mac doctor [--no-probe] [--tcc-window 24h] [--probe-timeout 90]
  crew-mac uninstall [--force]
  crew-mac reap [--grace-seconds 60] [--dry-run]

Chạy setup và uninstall trong Terminal trên màn hình Mac (phiên desktop), không chạy qua sshd agent.`;

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
  /** Test hook: ghi đè từng phần của context. */
  context?: Partial<MacContext>;
}

class UsageError extends Error {}

function parseFlags(args: readonly string[], valueFlags: readonly string[], boolFlags: readonly string[] = []) {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (valueFlags.includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} cần một giá trị`);
      flags.set(arg, value);
    } else if (boolFlags.includes(arg)) {
      flags.set(arg, true);
    } else {
      throw new UsageError(`không có tuỳ chọn ${arg}`);
    }
  }
  const value = (flag: string) => {
    const v = flags.get(flag);
    return typeof v === 'string' ? v : undefined;
  };
  const number = (flag: string) => {
    const v = value(flag);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new UsageError(`${flag} cần một số`);
    return n;
  };
  return { has: (flag: string) => flags.has(flag), value, number };
}

export function stableNodePath(): string {
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    if (existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

export function defaultContext(env: NodeJS.ProcessEnv, out: (line: string) => void): MacContext {
  return {
    home: env.HOME ?? homedir(),
    user: userInfo().username,
    uid: process.getuid?.() ?? 0,
    platform: process.platform,
    runner: createRunner(),
    now: () => new Date(),
    out,
    nodePath: stableNodePath(),
    cliPath: realpathSync(fileURLToPath(import.meta.url)),
  };
}

export function sshServerPort(env: NodeJS.ProcessEnv): number | null {
  const parts = env.SSH_CONNECTION?.trim().split(/\s+/);
  if (!parts || parts.length !== 4) return null;
  const port = Number(parts[3]);
  return Number.isInteger(port) ? port : null;
}

const STATUS_LABEL: Record<CheckStatus, string> = { ok: 'ĐẠT', warn: 'CẢNH BÁO', fail: 'LỖI' };

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  try {
    const ctx: MacContext = { ...defaultContext(io.env, io.out), ...io.context };
    switch (command) {
      case 'setup': {
        const flags = parseFlags(args, ['--paperclip-key', '--port', '--worktree-root']);
        const key = flags.value('--paperclip-key');
        const report = await setup(ctx, {
          paperclipKey: key === undefined ? undefined : existsSync(key) ? readFileSync(key, 'utf8') : key,
          port: flags.number('--port'),
          worktreeRoot: flags.value('--worktree-root'),
        });
        const m = report.manifest;
        io.out(`sshd agent nghe ${m.listenAddress}:${m.port}; thư mục worktree ${m.worktreeRoot}.`);
        io.out(report.changed.length === 0 ? 'Không có file nào thay đổi.' : `Đã ghi: ${report.changed.join(', ')}`);
        if (report.restarted.length > 0) io.out(`Đã nạp lại: ${report.restarted.join(', ')}`);
        io.out(`Agent claude_local: đặt adapterConfig.command = ${macPaths(ctx.home).wrapper}`);
        io.out('Chạy "crew-mac doctor" để kiểm toàn bộ.');
        return 0;
      }
      case 'doctor': {
        const flags = parseFlags(args, ['--tcc-window', '--probe-timeout'], ['--no-probe']);
        const results = await doctor(ctx, {
          probe: !flags.has('--no-probe'),
          tccWindow: flags.value('--tcc-window') ?? '24h',
          probeTimeoutSec: flags.number('--probe-timeout') ?? 90,
        });
        for (const r of results) {
          io.out(`[${STATUS_LABEL[r.status]}] ${r.title}: ${r.detail}`);
          if (r.hint && r.status !== 'ok') io.out(`    → ${r.hint}`);
        }
        return results.some((r) => r.status === 'fail') ? 1 : 0;
      }
      case 'uninstall': {
        const flags = parseFlags(args, [], ['--force']);
        const sshPort = sshServerPort(io.env);
        const agentPort = (() => {
          try {
            return readManifest(macPaths(ctx.home).manifest)?.port ?? DEFAULT_PORT;
          } catch {
            return DEFAULT_PORT;
          }
        })();
        if (sshPort !== null && (sshPort === agentPort || sshPort === DEFAULT_PORT) && !flags.has('--force')) {
          io.err(
            `crew-mac: phiên này đi qua sshd cổng ${sshPort}; uninstall sẽ cắt chính phiên này giữa chừng. ` +
              'Chạy trong Terminal trên màn hình Mac, hoặc thêm --force nếu chắc chắn.',
          );
          return 2;
        }
        const report = await uninstall(ctx);
        io.out(report.removed.length === 0 ? 'Không còn gì để gỡ.' : `Đã gỡ: ${report.removed.join(', ')}`);
        for (const kept of report.kept) io.out(`Giữ nguyên thư mục worktree ${kept} (có thể còn việc của agent).`);
        return 0;
      }
      default:
        throw new UsageError(command === undefined ? 'thiếu lệnh' : `không có lệnh ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`crew-mac: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    io.err(`crew-mac: ${(error as Error).message}`);
    return 1;
  }
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    env: process.env,
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: Error) => {
      process.stderr.write(`crew-mac: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Chạy: `pnpm --filter @crew/mac test && pnpm --filter @crew/mac typecheck && pnpm --filter @crew/mac build && node apps/crew-mac/dist/cli.js lung-tung; echo "exit=$?"`
Kỳ vọng: mọi test PASS; build tạo `apps/crew-mac/dist/cli.js`; lệnh cuối in cách dùng và `exit=2`.

- [ ] **Step 5: Thêm flow `mac-setup` vào `docs/flows.yaml`**

Chèn ngay trước dòng `shared:` (sau flow `daemon-setup`). Không sửa `source`, `shared`, `unassigned` (luật R6):

```yaml
  mac-setup:
    title: Cài và kiểm Mac chạy agent (crew-mac)
    doc: docs/flows/mac-setup.md
    entrypoints:
      - apps/crew-mac/src/cli.ts
    files:
      - apps/crew-mac/src/system.ts
      - apps/crew-mac/src/context.ts
      - apps/crew-mac/src/paths.ts
      - apps/crew-mac/src/fs-util.ts
      - apps/crew-mac/src/manifest.ts
      - apps/crew-mac/src/zshenv.ts
      - apps/crew-mac/src/authorized-keys.ts
      - apps/crew-mac/src/plist.ts
      - apps/crew-mac/src/sshd-config.ts
      - apps/crew-mac/src/launchctl.ts
      - apps/crew-mac/src/tailscale.ts
      - apps/crew-mac/src/wrapper.ts
      - apps/crew-mac/src/commands/setup.ts
      - apps/crew-mac/src/commands/doctor.ts
      - apps/crew-mac/src/commands/uninstall.ts
    tests:
      - apps/crew-mac/test/system.test.ts
      - apps/crew-mac/test/zshenv.test.ts
      - apps/crew-mac/test/authorized-keys.test.ts
      - apps/crew-mac/test/render.test.ts
      - apps/crew-mac/test/system-wrappers.test.ts
      - apps/crew-mac/test/crew-claude-run.test.ts
      - apps/crew-mac/test/setup.test.ts
      - apps/crew-mac/test/doctor.test.ts
      - apps/crew-mac/test/uninstall.test.ts
      - apps/crew-mac/test/cli.test.ts
```

- [ ] **Step 6: Viết `docs/flows/mac-setup.md`**

```markdown
# Cài và kiểm Mac chạy agent (crew-mac)

> Flow `mac-setup`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-setup` in ra đúng danh sách đó.

## Mục đích

Biến một Mac thành SSH environment cho Paperclip (Crew v3) bằng một lệnh, kiểm được nó và gỡ sạch được. Agent
`claude_local` chạy qua một sshd riêng trong phiên desktop (Aqua) để đọc được đăng nhập Claude trong Keychain,
không cần token và không login lại.

## Điểm vào

- `crew-mac setup --paperclip-key <file .pub>`: chạy trong Terminal trên màn hình Mac.
- `crew-mac doctor [--no-probe]`: chạy bất kỳ lúc nào, kể cả qua SSH.
- `crew-mac uninstall`: chạy trong Terminal trên màn hình Mac (qua sshd agent thì bị từ chối, trừ khi có `--force`).

## Các bước

1. `apps/crew-mac/src/cli.ts` → `main`: đọc cờ, dựng `MacContext` (`defaultContext`), gọi lệnh.
2. `apps/crew-mac/src/commands/setup.ts` → `setup`: kiểm macOS, phiên Aqua (`guiSessionAvailable`), LaunchAgent spike
   còn chạy hay không, IP Tailscale (`tailscaleIpv4`), thư mục worktree (`forbiddenRootReason`); tạo host key và key
   doctor (`ssh-keygen`); ghi `~/.crew-mac/sshd/sshd_config` (`renderSshdConfig`), `known_hosts`, dòng key trong
   `~/.ssh/authorized_keys` (`upsertKey`, comment `crew-mac-paperclip`, `crew-mac-doctor`), khối PATH trong
   `~/.zshenv` (`upsertPathBlock`), wrapper `~/.crew/bin/crew-claude-run` chép từ `apps/crew-mac/assets/crew-claude-run.sh`
   (`WRAPPER_SOURCE`, mode 755); ghi plist `com.2p.crew-mac-sshd` (`renderPlist`) và nạp bằng `ensureService`;
   ghi `~/.crew-mac/manifest.json`. Mọi file ghi qua `writeIfChanged`, nên chạy lại không đổi gì.
3. `apps/crew-mac/src/commands/doctor.ts` → `doctor`: Tailscale, sshd agent và cổng, PATH, wrapper (`checkWrapper`: có,
   chạy được qua sshd agent, giống bản trong repo), thư mục worktree,
   `claude auth status` qua chính sshd agent (`sshArgs`, key doctor), phép thử `claude -p` trong git repo tạm có
   tự `SIGKILL` (`printProbeScript`), hộp thoại TCC đang chờ (`/usr/bin/log show`, `parsePendingTccPrompts`,
   `tccHint`), tải máy (`parseLoad`).
4. `apps/crew-mac/src/commands/uninstall.ts` → `uninstall`: bootout và xóa plist crew-mac lẫn spike
   (`com.2p.crew-spike-sshd`), gỡ key theo comment, gỡ khối PATH và hai dòng PATH spike, xóa `~/.crew-mac` và
   `~/.crew-spike-sshd`, wrapper (và `~/.crew/bin` nếu rỗng). Không đụng phần còn lại của `~/.crew` (của `crewd` v2).
   Giữ nguyên thư mục worktree.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/crew-mac/src/cli.ts` | CLI | `main`, `USAGE`, `defaultContext`, `sshServerPort` |
| `apps/crew-mac/src/system.ts` | Chạy lệnh có giới hạn thời gian (SIGKILL) | `createRunner`, `CommandRunner` |
| `apps/crew-mac/src/context.ts` | Context và lỗi | `MacContext`, `SetupError` |
| `apps/crew-mac/src/paths.ts` | Label, comment key, đường dẫn | `macPaths`, `forbiddenRootReason` |
| `apps/crew-mac/src/fs-util.ts` | Ghi file atomic, chỉ khi đổi | `writeIfChanged`, `readText` |
| `apps/crew-mac/src/manifest.ts` | Trạng thái cài đặt | `readManifest`, `writeManifest` |
| `apps/crew-mac/src/zshenv.ts` | Khối PATH | `upsertPathBlock`, `removePathBlock`, `removeSpikePathLines` |
| `apps/crew-mac/src/authorized-keys.ts` | Dòng key | `parsePublicKey`, `upsertKey`, `removeKeysByComment` |
| `apps/crew-mac/src/plist.ts` | Plist LaunchAgent | `renderPlist` |
| `apps/crew-mac/src/sshd-config.ts` | Cấu hình sshd | `renderSshdConfig` |
| `apps/crew-mac/src/launchctl.ts` | Bọc `launchctl` | `serviceState`, `bootstrap`, `bootout`, `guiSessionAvailable` |
| `apps/crew-mac/src/tailscale.ts` | IP Tailscale | `tailscaleIpv4` |
| `apps/crew-mac/src/wrapper.ts` | Đường dẫn nguồn wrapper | `WRAPPER_SOURCE` |
| `apps/crew-mac/assets/crew-claude-run.sh` | Wrapper `claude` cho agent: ghi `pgid`, `started` của run rồi `exec claude` (bản sao nguyên văn từ fork `crew/mac/crew-claude-run.sh`) | — |
| `apps/crew-mac/src/commands/setup.ts` | Lệnh setup | `setup`, `ensureService`, `sshdPlistSpec` |
| `apps/crew-mac/src/commands/doctor.ts` | Lệnh doctor | `doctor`, `checkWrapper`, `parsePendingTccPrompts`, `printProbeScript` |
| `apps/crew-mac/src/commands/uninstall.ts` | Lệnh uninstall | `uninstall` |

## Dữ liệu

- File trên Mac: `~/.crew-mac/` (manifest, sshd config, host key, key doctor, known_hosts),
  `~/Library/LaunchAgents/com.2p.crew-mac-sshd.plist`, khối `# >>> crew-mac path >>>` trong `~/.zshenv`, dòng key
  `crew-mac-paperclip` và `crew-mac-doctor` trong `~/.ssh/authorized_keys`, wrapper `~/.crew/bin/crew-claude-run`,
  thư mục worktree (mặc định `~/crew-agents`).
- Wrapper ghi `<worktree>/.paperclip-runtime/runs/<runId>/pgid` và `started` cho mỗi run; H3 phía server (RT-1) đọc
  để dừng đúng process group.
- Gọi ngoài: `launchctl`, `ssh-keygen`, `ssh`, `nc`, `tailscale`, `/usr/bin/log`, `sysctl`, `memory_pressure`, `claude`.
- Không đọc hay ghi `~/.claude`, Keychain hay plugin của owner.

## Lưu ý quyền macOS (TCC)

Quyền đọc vùng được bảo vệ gắn theo đường dẫn binary Claude (`~/.local/share/claude/versions/<bản>`). Mỗi lần Claude
Code tự cập nhật, macOS có thể hỏi lại; khi hộp thoại chưa được bấm thì mọi lần đọc vùng đó của agent treo im lặng.
R1 chỉ phát hiện (`doctor`, check `tcc-pending`) và chỉ chỗ bấm. Ký số app cố định quyền là việc của R2.

## Flow liên quan

- `mac-orphan-reaper`: LaunchAgent dọn process `claude --print` mồ côi do `setup` cài.
- `runtime-updates`: bản v2 xử lý quyền ổ đĩa bằng app desktop đã ký; v3 R1 chưa dùng.

## Tests

- `apps/crew-mac/test/setup.test.ts`: cài lần đầu, chạy lại không đổi gì, đổi cổng, từ chối thư mục bị cấm, thiếu phiên desktop, spike còn chạy, thiếu Tailscale.
- `apps/crew-mac/test/doctor.test.ts`: máy khỏe, claude treo, hộp thoại TCC đang chờ, chưa đăng nhập, IP đổi, quá tải.
- `apps/crew-mac/test/crew-claude-run.test.ts`: wrapper chỉ exec khi không có run id, bỏ qua run id sai dạng, ghi PGID và thời điểm bắt đầu.
- `apps/crew-mac/test/uninstall.test.ts`: gỡ phần spike rồi setup lại, gỡ đúng phần đã cài (giữ `~/.crew` của crewd), chạy lại không lỗi.
- `apps/crew-mac/test/cli.test.ts`: cách dùng, đọc key từ file, mã thoát của doctor, chặn uninstall qua sshd agent.
- Các test còn lại kiểm từng module thuần (`zshenv`, `authorized-keys`, `render`, `system-wrappers`, `system`).
```

- [ ] **Step 7: Thêm dòng vào bảng "Bản đồ module" của `docs/index.md`**

Thêm ngay sau dòng `| \`apps/desktop/src/renderer\` | ... |`:

```markdown
| `apps/crew-mac/src` | CLI `crew-mac` cho Crew v3: cài sshd phiên desktop, key Paperclip, PATH, kiểm sức khỏe Mac (kể cả hộp thoại quyền macOS) và dọn process `claude` mồ côi |
```

- [ ] **Step 8: Sinh lại khối tự động và kiểm docs**

Chạy:

```bash
pnpm --filter @crew/docs-kit build
node packages/docs-kit/dist/crew-docs.cjs generate
node packages/docs-kit/dist/crew-docs.cjs flow mac-setup
pnpm lint
```

Kỳ vọng: `generate` cập nhật khối flow trong `docs/index.md` (có dòng `mac-setup`) và `docs/files.md`; `flow mac-setup` in đúng 16 file nguồn và 10 file test; `pnpm lint` không lỗi.

- [ ] **Step 9: Commit**

```bash
git add apps/crew-mac/src/cli.ts apps/crew-mac/test/cli.test.ts docs/flows/mac-setup.md docs/flows.yaml docs/index.md docs/files.md
git commit -m "feat(crew-mac): CLI setup, doctor, uninstall và docs flow mac-setup"
```

---

### Task 8: Nhận diện process `claude --print` mồ côi (MS-2, phần thuần)

**Files:**
- Create: `apps/crew-mac/src/reaper/process-table.ts`
- Create: `apps/crew-mac/src/reaper/select.ts`
- Test: `apps/crew-mac/test/reaper-select.test.ts`

**Interfaces:**
- Consumes: `CommandRunner` (Task 1).
- Produces:
  - `interface ProcInfo { pid: number; ppid: number; pgid: number; comm: string; command: string; runId: string | null }`
  - `parsePsTree(text: string): Map<number, { ppid: number; pgid: number; comm: string }>`
  - `parsePsEnv(text: string): Map<number, string>`
  - `extractRunId(commandWithEnv: string): string | null`
  - `listProcesses(runner: CommandRunner): Promise<ProcInfo[]>`: chạy `/bin/ps -axww -o pid=,ppid=,pgid=,comm=` và `/bin/ps -E -axww -o pid=,command=`.
  - `interface ReaperState { orphanSince: Record<string, string> }` (key `${pid}:${runId}`, giá trị ISO)
  - `interface ReapTarget { pid: number; runId: string; pgid: number; pids: number[]; orphanSince: string }`
  - `isClaudePrint(p: ProcInfo): boolean`, `isOrphaned(p: ProcInfo, byPid: ReadonlyMap<number, ProcInfo>): boolean`
  - `selectTargets(procs: ProcInfo[], state: ReaperState, now: Date, graceMs: number, selfPid: number): { targets: ReapTarget[]; nextState: ReaperState }`

Bằng chứng khả thi (Mac mini, 06/10/2026):
- `ps -E` của cùng user đọc được env lúc exec của binary không phải của Apple. Đã thử: `node` chạy với `PAPERCLIP_RUN_ID=run-node-1` thì `ps -E -o command=` có `PAPERCLIP_RUN_ID=run-node-1`; env của `claude` 2.1.289 cũng đọc được.
- Binary của Apple (`/bin/sleep`, `zsh`, `git`) thì không hiện env. Vì vậy chỉ nhận diện được qua `claude` (hoặc `node`), và các process con được tìm theo cây PPID.
- `comm=` của sshd là tiêu đề process, ví dụ `sshd-session: phannhatquang@notty` và `sshd: /usr/sbin/sshd -D -f ... [listener] ...`, nên phải đặt `comm` ở cột cuối.
- Lệnh SSH không tương tác chạy trong process group riêng: `zsh` của phiên là leader (`pgid == pid`), cha là `sshd-session`. macOS không có `setsid`.

- [ ] **Step 1: Viết test (sẽ fail)**

`apps/crew-mac/test/reaper-select.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  extractRunId,
  listProcesses,
  parsePsEnv,
  parsePsTree,
  type ProcInfo,
} from '../src/reaper/process-table.js';
import { isClaudePrint, isOrphaned, selectTargets } from '../src/reaper/select.js';
import { FakeRunner } from './helpers/fake-runner.js';

const TREE = [
  '    1     0     1 /sbin/launchd',
  '17611     1 17611 sshd: /usr/sbin/sshd -D -f /Users/owner/.crew-mac/sshd/sshd_config [listener] 0 of 10-100 startups',
  '71433 17611 71433 sshd-session: owner [priv]',
  '71435 71433 71433 sshd-session: owner@notty',
  '71436 71435 71436 zsh',
  '71440 71436 71436 claude',
  '80000     1 80000 zsh',
  '80001 80000 80000 claude',
  '80002 80001 80000 git',
  '90000 57355 90000 claude',
].join('\n');

const ENV = [
  '71440 claude --print --output-format stream-json PAPERCLIP_RUN_ID=run-live HOME=/Users/owner',
  '80001 claude --print --output-format stream-json PAPERCLIP_RUN_ID=run-dead HOME=/Users/owner',
  '80002 git status',
  '90000 claude --dangerously-skip-permissions HOME=/Users/owner',
].join('\n');

function procs(): ProcInfo[] {
  const env = parsePsEnv(ENV);
  return [...parsePsTree(TREE)].map(([pid, t]) => {
    const command = env.get(pid) ?? '';
    return { pid, ...t, command, runId: extractRunId(command) };
  });
}

const byPid = (list: ProcInfo[]) => new Map(list.map((p) => [p.pid, p]));
const at = (iso: string) => new Date(iso);

describe('đọc bảng process', () => {
  it('tách pid, ppid, pgid và comm có dấu cách', () => {
    expect(parsePsTree(TREE).get(71435)).toEqual({ ppid: 71433, pgid: 71433, comm: 'sshd-session: owner@notty' });
  });

  it('lấy PAPERCLIP_RUN_ID làm một token riêng', () => {
    expect(extractRunId('claude --print PAPERCLIP_RUN_ID=abc-123 X=1')).toBe('abc-123');
    expect(extractRunId('claude --print XPAPERCLIP_RUN_ID=abc')).toBeNull();
    expect(extractRunId('claude --print')).toBeNull();
  });

  it('listProcesses gọi ps hai lần và ghép theo pid', async () => {
    const runner = new FakeRunner().on('/bin/ps', (args) => ({ stdout: args.includes('-E') ? ENV : TREE }));
    const list = await listProcesses(runner);
    expect(list.find((p) => p.pid === 80001)?.runId).toBe('run-dead');
    expect(runner.commands()).toEqual([
      '/bin/ps -axww -o pid=,ppid=,pgid=,comm=',
      '/bin/ps -E -axww -o pid=,command=',
    ]);
  });
});

describe('chọn process mồ côi', () => {
  it('chỉ nhận claude --print có run id', () => {
    const map = byPid(procs());
    expect(isClaudePrint(map.get(71440) as ProcInfo)).toBe(true);
    expect(isClaudePrint(map.get(90000) as ProcInfo)).toBe(false);
  });

  it('còn sshd-session trong chuỗi tổ tiên thì không mồ côi, kể cả khi cha trực tiếp sống', () => {
    const map = byPid(procs());
    expect(isOrphaned(map.get(71440) as ProcInfo, map)).toBe(false);
    expect(isOrphaned(map.get(80001) as ProcInfo, map)).toBe(true);
  });

  it('lần đầu thấy mồ côi thì chỉ ghi lại thời điểm', () => {
    const { targets, nextState } = selectTargets(procs(), { orphanSince: {} }, at('2026-10-06T07:00:00Z'), 60_000, 999);
    expect(targets).toEqual([]);
    expect(nextState).toEqual({ orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } });
  });

  it('chưa đủ 60 giây thì chưa chọn', () => {
    const state = { orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } };
    const { targets } = selectTargets(procs(), state, at('2026-10-06T07:00:59Z'), 60_000, 999);
    expect(targets).toEqual([]);
  });

  it('quá hạn thì chọn claude, process con và process cùng group có cùng run id', () => {
    const state = { orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } };
    const { targets } = selectTargets(procs(), state, at('2026-10-06T07:01:00Z'), 60_000, 999);
    expect(targets).toEqual([
      { pid: 80001, runId: 'run-dead', pgid: 80000, pids: [80001, 80002], orphanSince: '2026-10-06T07:00:00.000Z' },
    ]);
  });

  it('không bao giờ chọn phiên claude tương tác của owner', () => {
    const list = procs().map((p) => (p.pid === 90000 ? { ...p, ppid: 1 } : p));
    const { targets, nextState } = selectTargets(list, { orphanSince: {} }, at('2026-10-06T09:00:00Z'), 0, 999);
    expect(targets.map((t) => t.pid)).toEqual([80001]);
    expect(Object.keys(nextState.orphanSince)).toEqual(['80001:run-dead']);
  });

  it('không chọn chính process reaper', () => {
    const { targets } = selectTargets(procs(), { orphanSince: {} }, at('2026-10-06T07:00:00Z'), 0, 80002);
    expect(targets[0]?.pids).toEqual([80001]);
  });

  it('bỏ entry state của process đã hết mồ côi hoặc đã chết', () => {
    const state = { orphanSince: { '12345:run-old': '2026-10-06T06:00:00.000Z' } };
    const { nextState } = selectTargets(procs(), state, at('2026-10-06T07:00:00Z'), 60_000, 999);
    expect(nextState.orphanSince['12345:run-old']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Chạy: `pnpm --filter @crew/mac test -- test/reaper-select.test.ts`
Kỳ vọng: FAIL vì không tìm thấy module.

- [ ] **Step 3: Viết `reaper/process-table.ts`**

```ts
import type { CommandRunner } from '../system.js';

export interface ProcInfo {
  pid: number;
  ppid: number;
  pgid: number;
  /** Tiêu đề process (sshd đổi thành "sshd-session: user@notty"). */
  comm: string;
  /** Argv rồi tới env lúc exec, theo `ps -E`; env chỉ có với binary không phải của Apple. */
  command: string;
  runId: string | null;
}

const TREE_RE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/;
const ENV_RE = /^\s*(\d+)\s(.*)$/;
const RUN_ID_RE = /(?:^|\s)PAPERCLIP_RUN_ID=([A-Za-z0-9_-]{1,128})(?=\s|$)/;

export function parsePsTree(text: string): Map<number, { ppid: number; pgid: number; comm: string }> {
  const rows = new Map<number, { ppid: number; pgid: number; comm: string }>();
  for (const line of text.split('\n')) {
    const match = TREE_RE.exec(line);
    if (match) {
      rows.set(Number(match[1]), { ppid: Number(match[2]), pgid: Number(match[3]), comm: (match[4] as string).trim() });
    }
  }
  return rows;
}

export function parsePsEnv(text: string): Map<number, string> {
  const rows = new Map<number, string>();
  for (const line of text.split('\n')) {
    const match = ENV_RE.exec(line);
    if (match) rows.set(Number(match[1]), (match[2] as string).trim());
  }
  return rows;
}

export function extractRunId(commandWithEnv: string): string | null {
  return RUN_ID_RE.exec(commandWithEnv)?.[1] ?? null;
}

export async function listProcesses(runner: CommandRunner): Promise<ProcInfo[]> {
  const tree = await runner.run('/bin/ps', ['-axww', '-o', 'pid=,ppid=,pgid=,comm='], { timeoutMs: 15_000 });
  const env = await runner.run('/bin/ps', ['-E', '-axww', '-o', 'pid=,command='], { timeoutMs: 15_000 });
  if (tree.code !== 0 || env.code !== 0) throw new Error(`ps lỗi: ${tree.stderr} ${env.stderr}`.trim());
  const commands = parsePsEnv(env.stdout);
  return [...parsePsTree(tree.stdout)].map(([pid, row]) => {
    const command = commands.get(pid) ?? '';
    return { pid, ...row, command, runId: extractRunId(command) };
  });
}
```

- [ ] **Step 4: Viết `reaper/select.ts`**

```ts
import type { ProcInfo } from './process-table.js';

export interface ReaperState {
  orphanSince: Record<string, string>;
}

export interface ReapTarget {
  pid: number;
  runId: string;
  pgid: number;
  pids: number[];
  orphanSince: string;
}

const SSHD_RE = /^(?:\/usr\/sbin\/sshd|\/usr\/libexec\/sshd-session|sshd-session|sshd)(?::|\s|$)/;

export function isClaudePrint(p: ProcInfo): boolean {
  if (p.runId === null) return false;
  const tokens = p.command.split(/\s+/);
  const exe = tokens[0] ?? '';
  const isClaude = exe === 'claude' || exe.endsWith('/claude') || /\/claude\/versions\/[^/]+$/.test(exe);
  return isClaude && (tokens.includes('--print') || tokens.includes('-p'));
}

/** Mồ côi khi chuỗi tổ tiên không còn sshd hay sshd-session: phiên SSH của run đã mất. */
export function isOrphaned(p: ProcInfo, byPid: ReadonlyMap<number, ProcInfo>): boolean {
  const seen = new Set<number>();
  let current = p.ppid;
  while (current > 1 && !seen.has(current)) {
    seen.add(current);
    const parent = byPid.get(current);
    if (!parent) return true;
    if (SSHD_RE.test(parent.comm)) return false;
    current = parent.ppid;
  }
  return true;
}

function descendants(rootPid: number, procs: readonly ProcInfo[]): number[] {
  const children = new Map<number, number[]>();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
  const found: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (found.includes(pid)) continue;
    found.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return found;
}

export function selectTargets(
  procs: ProcInfo[],
  state: ReaperState,
  now: Date,
  graceMs: number,
  selfPid: number,
): { targets: ReapTarget[]; nextState: ReaperState } {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const nextState: ReaperState = { orphanSince: {} };
  const targets: ReapTarget[] = [];
  for (const p of procs) {
    if (!isClaudePrint(p) || !isOrphaned(p, byPid)) continue;
    const runId = p.runId as string;
    const key = `${p.pid}:${runId}`;
    const since = state.orphanSince[key] ?? now.toISOString();
    nextState.orphanSince[key] = since;
    if (now.getTime() - Date.parse(since) < graceMs) continue;
    const sameRunInGroup = procs.filter((q) => q.pgid === p.pgid && q.runId === runId).map((q) => q.pid);
    const pids = [...new Set([...descendants(p.pid, procs), ...sameRunInGroup])]
      .filter((pid) => pid > 1 && pid !== selfPid)
      .sort((a, b) => a - b);
    targets.push({ pid: p.pid, runId, pgid: p.pgid, pids, orphanSince: since });
  }
  return { targets, nextState };
}
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Chạy: `pnpm --filter @crew/mac test -- test/reaper-select.test.ts && pnpm --filter @crew/mac typecheck`
Kỳ vọng: toàn bộ PASS, typecheck sạch.

- [ ] **Step 6: Commit**

```bash
git add apps/crew-mac/src/reaper/process-table.ts apps/crew-mac/src/reaper/select.ts apps/crew-mac/test/reaper-select.test.ts
git commit -m "feat(crew-mac): nhận diện process claude --print của run đã mất phiên SSH"
```

---

### Task 9: `crew-mac reap`, LaunchAgent reaper và docs flow `mac-orphan-reaper`

**Files:**
- Create: `apps/crew-mac/src/reaper/reap.ts`
- Test: `apps/crew-mac/test/reaper-reap.test.ts`
- Modify: `apps/crew-mac/src/commands/setup.ts` (thêm `reaperPlistSpec` và nạp reaper)
- Modify: `apps/crew-mac/src/commands/doctor.ts` (thêm `checkReaper`)
- Modify: `apps/crew-mac/src/cli.ts` (thêm nhánh `reap`)
- Modify: `apps/crew-mac/test/setup.test.ts`, `apps/crew-mac/test/doctor.test.ts`, `apps/crew-mac/test/uninstall.test.ts` (kỳ vọng mới)
- Create: `docs/flows/mac-orphan-reaper.md`
- Modify: `docs/flows.yaml`, `docs/flows/mac-setup.md`
- Regenerate: `docs/index.md`, `docs/files.md`

**Interfaces:**
- Consumes: `listProcesses`, `selectTargets`, `ReaperState`, `ReapTarget` (Task 8); `ensureService`, `setup` (Task 4); `doctor` (Task 5); `main` (Task 7); `REAPER_LABEL`, `macPaths`.
- Produces:
  - `interface ReapDeps { runner: CommandRunner; signal: (pid: number, sig: 'SIGTERM' | 'SIGKILL') => void; sleep: (ms: number) => Promise<void>; now: () => Date; selfPid: number }`
  - `interface ReapOptions { graceMs: number; termWaitMs: number; dryRun: boolean; statePath: string; logPath: string }`
  - `readReaperState(path: string): ReaperState`, `vnTime(date: Date): string`
  - `reapOnce(deps: ReapDeps, options: ReapOptions): Promise<ReapTarget[]>`
  - `reaperPlistSpec(ctx: MacContext, paths: MacPaths): PlistSpec` (trong `setup.ts`)
  - Check doctor mới có id `reaper`, đứng ngay sau `sshd-agent`.

- [ ] **Step 1: Viết test cho `reapOnce` (sẽ fail)**

`apps/crew-mac/test/reaper-reap.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reapOnce, vnTime } from '../src/reaper/reap.js';
import { FakeRunner } from './helpers/fake-runner.js';

const TREE = ['    1     0     1 /sbin/launchd', '80000     1 80000 zsh', '80001 80000 80000 claude', '80002 80001 80000 git'].join('\n');
const ENV = ['80001 claude --print PAPERCLIP_RUN_ID=run-dead', '80002 git status'].join('\n');
const TREE_AFTER_TERM = ['    1     0     1 /sbin/launchd', '80001     1 80000 claude'].join('\n');

function setupDeps(trees: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'crew-mac-reaper-'));
  let treeCall = 0;
  const runner = new FakeRunner().on('/bin/ps', (args) => {
    if (args.includes('-E')) return { stdout: ENV };
    const tree = trees[Math.min(treeCall, trees.length - 1)] as string;
    treeCall++;
    return { stdout: tree };
  });
  const signals: string[] = [];
  const sleeps: number[] = [];
  const deps = {
    runner,
    signal: (pid: number, sig: 'SIGTERM' | 'SIGKILL') => {
      signals.push(`${sig} ${pid}`);
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    now: () => new Date('2026-10-06T07:05:00.000Z'),
    selfPid: 999,
  };
  const options = {
    graceMs: 60_000,
    termWaitMs: 10_000,
    dryRun: false,
    statePath: join(dir, 'state.json'),
    logPath: join(dir, 'reaper.log'),
  };
  return { deps, options, signals, sleeps, dir };
}

describe('reapOnce', () => {
  it('lần đầu chỉ ghi nhận, không gửi signal', async () => {
    const t = setupDeps([TREE]);
    expect(await reapOnce(t.deps, t.options)).toEqual([]);
    expect(t.signals).toEqual([]);
    expect(JSON.parse(readFileSync(t.options.statePath, 'utf8'))).toEqual({
      orphanSince: { '80001:run-dead': '2026-10-06T07:05:00.000Z' },
    });
  });

  it('quá hạn: TERM cả cây, chờ, KILL process còn sống, ghi log giờ Việt Nam', async () => {
    const t = setupDeps([TREE, TREE_AFTER_TERM]);
    writeFileSync(t.options.statePath, JSON.stringify({ orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } }));
    const targets = await reapOnce(t.deps, t.options);
    expect(targets.map((x) => x.pid)).toEqual([80001]);
    expect(t.signals).toEqual(['SIGTERM 80001', 'SIGTERM 80002', 'SIGKILL 80001']);
    expect(t.sleeps).toEqual([10_000]);
    const log = readFileSync(t.options.logPath, 'utf8');
    expect(log).toContain('2026-10-06 14:05:00 TERM run=run-dead pid=80001 pgid=80000 pids=80001,80002');
    expect(log).toContain('KILL run=run-dead pids=80001');
    expect(JSON.parse(readFileSync(t.options.statePath, 'utf8'))).toEqual({ orphanSince: {} });
  });

  it('dry-run không gửi signal', async () => {
    const t = setupDeps([TREE]);
    writeFileSync(t.options.statePath, JSON.stringify({ orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } }));
    await reapOnce(t.deps, { ...t.options, dryRun: true });
    expect(t.signals).toEqual([]);
    expect(readFileSync(t.options.logPath, 'utf8')).toContain('SẼ DỌN run=run-dead');
  });

  it('state hỏng thì coi như rỗng', async () => {
    const t = setupDeps([TREE]);
    writeFileSync(t.options.statePath, '{hỏng');
    expect(await reapOnce(t.deps, t.options)).toEqual([]);
  });

  it('vnTime theo Asia/Ho_Chi_Minh', () => {
    expect(vnTime(new Date('2026-10-06T17:30:00.000Z'))).toBe('2026-10-07 00:30:00');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Chạy: `pnpm --filter @crew/mac test -- test/reaper-reap.test.ts`
Kỳ vọng: FAIL vì không tìm thấy `../src/reaper/reap.js`.

- [ ] **Step 3: Viết `reaper/reap.ts`**

```ts
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommandRunner } from '../system.js';
import { listProcesses } from './process-table.js';
import { type ReaperState, type ReapTarget, selectTargets } from './select.js';

export interface ReapDeps {
  runner: CommandRunner;
  signal: (pid: number, sig: 'SIGTERM' | 'SIGKILL') => void;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  selfPid: number;
}

export interface ReapOptions {
  graceMs: number;
  termWaitMs: number;
  dryRun: boolean;
  statePath: string;
  logPath: string;
}

export function readReaperState(path: string): ReaperState {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ReaperState>;
    return { orphanSince: typeof raw.orphanSince === 'object' && raw.orphanSince !== null ? raw.orphanSince : {} };
  } catch {
    return { orphanSince: {} };
  }
}

export function vnTime(date: Date): string {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function send(deps: ReapDeps, pid: number, sig: 'SIGTERM' | 'SIGKILL'): void {
  try {
    deps.signal(pid, sig);
  } catch {
    // Process đã thoát giữa chừng (ESRCH): bỏ qua.
  }
}

export async function reapOnce(deps: ReapDeps, options: ReapOptions): Promise<ReapTarget[]> {
  const procs = await listProcesses(deps.runner);
  const { targets, nextState } = selectTargets(
    procs,
    readReaperState(options.statePath),
    deps.now(),
    options.graceMs,
    deps.selfPid,
  );
  const log: string[] = [];
  for (const t of targets) {
    log.push(
      `${vnTime(deps.now())} ${options.dryRun ? 'SẼ DỌN' : 'TERM'} run=${t.runId} pid=${t.pid} pgid=${t.pgid} ` +
        `pids=${t.pids.join(',')} mồ côi từ ${vnTime(new Date(t.orphanSince))}`,
    );
  }
  if (!options.dryRun && targets.length > 0) {
    for (const t of targets) for (const pid of t.pids) send(deps, pid, 'SIGTERM');
    await deps.sleep(options.termWaitMs);
    const alive = new Map((await listProcesses(deps.runner)).map((p) => [p.pid, p]));
    for (const t of targets) {
      // Chỉ KILL process còn đúng group của run, tránh trúng pid đã bị tái dùng.
      const left = t.pids.filter((pid) => alive.get(pid)?.pgid === t.pgid);
      for (const pid of left) send(deps, pid, 'SIGKILL');
      if (left.length > 0) log.push(`${vnTime(deps.now())} KILL run=${t.runId} pids=${left.join(',')}`);
      delete nextState.orphanSince[`${t.pid}:${t.runId}`];
    }
  }
  mkdirSync(dirname(options.statePath), { recursive: true, mode: 0o700 });
  writeFileSync(options.statePath, `${JSON.stringify(nextState, null, 2)}\n`, { mode: 0o600 });
  if (log.length > 0) appendFileSync(options.logPath, `${log.join('\n')}\n`);
  return targets;
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Chạy: `pnpm --filter @crew/mac test -- test/reaper-reap.test.ts`
Kỳ vọng: 5 test PASS.

- [ ] **Step 5: Sửa test của setup, doctor, uninstall theo hành vi mới (sẽ fail)**

Trong `apps/crew-mac/test/setup.test.ts`:
- Đổi import `import { macPaths, SSHD_LABEL } from '../src/paths.js';` thành `import { macPaths, REAPER_LABEL, SSHD_LABEL } from '../src/paths.js';`.
- Trong test "cài sshd phiên Aqua, ...", thay dòng `expect(report.restarted).toEqual([SSHD_LABEL]);` bằng:

```ts
    expect(report.restarted).toEqual([SSHD_LABEL, REAPER_LABEL]);
    expect(loaded.has(REAPER_LABEL)).toBe(true);
    const reaperPlist = readFileSync(paths.reaperPlist, 'utf8');
    expect(reaperPlist).toContain('<string>/opt/homebrew/bin/node</string>');
    expect(reaperPlist).toContain('<string>/opt/crew/apps/crew-mac/dist/cli.js</string>');
    expect(reaperPlist).toContain('<string>reap</string>');
    expect(reaperPlist).toContain('<key>StartInterval</key><integer>60</integer>');
```

Trong `apps/crew-mac/test/doctor.test.ts`, test "máy đã cài và khỏe thì mọi check đạt": chèn `['reaper', 'ok'],` ngay sau `['sshd-agent', 'ok'],`. Thêm test sau vào cuối `describe('crew-mac doctor', ...)`:

```ts
  it('reaper thoát lỗi thì fail', async () => {
    const mac = await installed(okSsh);
    const base = mac.runner;
    const original = base.run.bind(base);
    base.run = async (command, args, options) =>
      command === 'launchctl' && args[1] === 'gui/501/com.2p.crew-mac-reaper'
        ? { code: 0, stdout: 'state = not running\n\tlast exit code = 1\n', stderr: '', timedOut: false }
        : original(command, args, options);
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'reaper')?.status).toBe('fail');
  });
```

Trong `apps/crew-mac/test/uninstall.test.ts`, test "gỡ đúng những gì setup cài, ...": thêm ngay sau `expect(existsSync(paths.sshdPlist)).toBe(false);`:

```ts
    expect(existsSync(paths.reaperPlist)).toBe(false);
```

Chạy: `pnpm --filter @crew/mac test -- test/setup.test.ts test/doctor.test.ts test/uninstall.test.ts`
Kỳ vọng: FAIL ở các kỳ vọng reaper vừa thêm.

- [ ] **Step 6: Nạp reaper trong `setup.ts`**

Thêm `REAPER_LABEL` vào import từ `../paths.js`, rồi thêm hàm sau ngay dưới `sshdPlistSpec`:

```ts
export function reaperPlistSpec(ctx: MacContext, paths: MacPaths): PlistSpec {
  return {
    label: REAPER_LABEL,
    programArguments: [ctx.nodePath, ctx.cliPath, 'reap'],
    keepAlive: false,
    startIntervalSec: 60,
    aquaOnly: true,
    processType: 'Background',
    stdoutPath: paths.reaperLog,
    stderrPath: paths.reaperLog,
  };
}
```

Trong `setup`, ngay sau dòng `if (await ensureService(ctx, SSHD_LABEL, paths.sshdPlist, sshdReload, true)) restarted.push(SSHD_LABEL);`, thêm:

```ts
  const reaperPlistChanged = writeIfChanged(paths.reaperPlist, renderPlist(reaperPlistSpec(ctx, paths)), 0o644);
  track(paths.reaperPlist, reaperPlistChanged);
  if (await ensureService(ctx, REAPER_LABEL, paths.reaperPlist, reaperPlistChanged, false)) restarted.push(REAPER_LABEL);
```

- [ ] **Step 7: Thêm `checkReaper` trong `doctor.ts`**

Thêm `REAPER_LABEL` vào import từ `../paths.js`, thêm hàm:

```ts
async function checkReaper(ctx: MacContext): Promise<CheckResult> {
  const state = await serviceState(ctx.runner, ctx.uid, REAPER_LABEL);
  const base = { id: 'reaper', title: 'Bộ dọn process mồ côi' };
  if (!state.loaded) return { ...base, status: 'fail', detail: `${REAPER_LABEL} chưa nạp`, hint: 'Chạy lại "crew-mac setup".' };
  if (state.lastExitCode !== null && state.lastExitCode !== 0) {
    return {
      ...base,
      status: 'fail',
      detail: `lần chạy gần nhất thoát mã ${state.lastExitCode}`,
      hint: 'Xem ~/.crew-mac/reaper/reaper.log. Nếu đã chuyển repo Crew hay nâng Node, chạy lại "crew-mac setup".',
    };
  }
  return { ...base, status: 'ok', detail: `${REAPER_LABEL} chạy mỗi 60 giây` };
}
```

Trong `doctor`, ngay sau `results.push(await checkSshdService(ctx));`, thêm `results.push(await checkReaper(ctx));`.

- [ ] **Step 8: Thêm nhánh `reap` trong `cli.ts`**

Thêm import:

```ts
import { reapOnce } from './reaper/reap.js';
```

Thêm nhánh trước `default:` trong `switch`:

```ts
      case 'reap': {
        const flags = parseFlags(args, ['--grace-seconds'], ['--dry-run']);
        const paths = macPaths(ctx.home);
        const targets = await reapOnce(
          {
            runner: ctx.runner,
            signal: (pid, sig) => process.kill(pid, sig),
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            now: ctx.now,
            selfPid: process.pid,
          },
          {
            graceMs: (flags.number('--grace-seconds') ?? 60) * 1000,
            termWaitMs: 10_000,
            dryRun: flags.has('--dry-run'),
            statePath: paths.reaperState,
            logPath: paths.reaperLog,
          },
        );
        if (targets.length > 0) io.out(`Đã xử lý ${targets.length} run mồ côi; chi tiết ở ${paths.reaperLog}.`);
        return 0;
      }
```

- [ ] **Step 9: Chạy toàn bộ test**

Chạy: `pnpm --filter @crew/mac test && pnpm --filter @crew/mac typecheck && pnpm --filter @crew/mac build`
Kỳ vọng: mọi test PASS, typecheck sạch, build xong.

Kiểm thật trên máy dev (macOS, không cần Mac mini):

```bash
PAPERCLIP_RUN_ID=run-local-test node -e "setTimeout(()=>{},120000)" &
node apps/crew-mac/dist/cli.js reap --dry-run --grace-seconds 0; cat ~/.crew-mac/reaper/reaper.log 2>/dev/null; kill %1
```

Kỳ vọng: không có dòng `SẼ DỌN`, vì process thử là `node` chứ không phải `claude --print`. Lệnh này xác nhận `ps -E` chạy được trên máy và reaper không đụng process lạ. Nếu máy dev chưa từng chạy setup thì xóa `~/.crew-mac` sau khi kiểm.

- [ ] **Step 10: Docs flow `mac-orphan-reaper`**

Trong `docs/flows.yaml`, chèn ngay sau khối `mac-setup` (vẫn trước `shared:`):

```yaml
  mac-orphan-reaper:
    title: Dọn process claude mồ côi trên Mac (crew-mac reap)
    doc: docs/flows/mac-orphan-reaper.md
    entrypoints:
      - apps/crew-mac/src/reaper/reap.ts
    files:
      - apps/crew-mac/src/reaper/process-table.ts
      - apps/crew-mac/src/reaper/select.ts
    tests:
      - apps/crew-mac/test/reaper-select.test.ts
      - apps/crew-mac/test/reaper-reap.test.ts
```

Tạo `docs/flows/mac-orphan-reaper.md`:

```markdown
# Dọn process claude mồ côi trên Mac (crew-mac reap)

> Flow `mac-orphan-reaper`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-orphan-reaper` in ra đúng danh sách đó.

## Mục đích

Khi mạng giữa VPS và Mac rớt, server Paperclip không vào được Mac để dừng run. Phiên SSH chết nhưng `claude --print`
vẫn sống và tiếp tục ghi vào worktree. LaunchAgent `com.2p.crew-mac-reaper` chạy `crew-mac reap` mỗi 60 giây, tìm
các process này và dừng chúng. Đây là lớp phòng thủ phía Mac, bổ sung cho hook H3 (RT-1) phía server.

## Điểm vào

- LaunchAgent `com.2p.crew-mac-reaper` (do `crew-mac setup` cài, flow `mac-setup`), `StartInterval` 60 giây.
- Chạy tay: `crew-mac reap [--grace-seconds 60] [--dry-run]`.

## Các bước

1. `apps/crew-mac/src/reaper/process-table.ts` → `listProcesses`: `ps -axww -o pid=,ppid=,pgid=,comm=` cho cây
   process, `ps -E -axww -o pid=,command=` cho env lúc exec; `extractRunId` lấy `PAPERCLIP_RUN_ID`.
2. `apps/crew-mac/src/reaper/select.ts` → `selectTargets`: chỉ xét `claude` chạy `--print`/`-p` có
   `PAPERCLIP_RUN_ID` (`isClaudePrint`); mồ côi khi chuỗi tổ tiên không còn `sshd`/`sshd-session` (`isOrphaned`);
   ghi thời điểm thấy mồ côi lần đầu vào state; quá thời hạn (mặc định 60 giây) thì chọn claude, mọi process con và
   process cùng group có cùng run id.
3. `apps/crew-mac/src/reaper/reap.ts` → `reapOnce`: gửi `SIGTERM`, chờ 10 giây, gửi `SIGKILL` cho process còn
   sống trong đúng group; ghi `~/.crew-mac/reaper/reaper.log` (giờ Asia/Ho_Chi_Minh) và `state.json`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/crew-mac/src/reaper/reap.ts` | Một vòng dọn | `reapOnce`, `readReaperState`, `vnTime` |
| `apps/crew-mac/src/reaper/process-table.ts` | Đọc bảng process và env | `listProcesses`, `parsePsTree`, `parsePsEnv`, `extractRunId` |
| `apps/crew-mac/src/reaper/select.ts` | Chọn process mồ côi | `selectTargets`, `isClaudePrint`, `isOrphaned` |

## Dữ liệu

- File: `~/.crew-mac/reaper/state.json` (`orphanSince` theo `pid:runId`), `~/.crew-mac/reaper/reaper.log`.
- Hợp đồng với RT-1: mỗi run SSH chạy `claude` với biến môi trường `PAPERCLIP_RUN_ID`. Mỗi lệnh SSH không tương
  tác trên macOS đã có process group riêng (shell của phiên là leader).

## Giới hạn

- `ps -E` chỉ cho thấy env lúc exec, và chỉ với binary không phải của Apple. `claude` và `node` đọc được;
  `zsh`, `git`, `sleep` thì không. Vì vậy process con được tìm theo cây PPID.
- Không bao giờ dừng process không có `PAPERCLIP_RUN_ID` hoặc không chạy `--print`, nên phiên `claude` tương tác
  của owner an toàn.
- Mất mạng: `sshd` (`ClientAliveInterval 15`, `ClientAliveCountMax 2`) cắt phiên sau khoảng 30 giây, rồi reaper
  dừng run sau 60 giây mồ côi, chậm nhất thêm một chu kỳ 60 giây của LaunchAgent và 10 giây chờ TERM: tổng cộng
  khoảng 2 phút 40 giây kể từ lúc mất mạng. Run đó coi như hỏng; Paperclip chạy lại theo luồng của nó.

## Flow liên quan

- `mac-setup`: cài và gỡ LaunchAgent reaper; `doctor` có check `reaper`.

## Tests

- `apps/crew-mac/test/reaper-select.test.ts`: đọc `ps`, nhận diện mồ côi kể cả khi cha trực tiếp còn sống, thời hạn, không đụng phiên owner hay chính reaper.
- `apps/crew-mac/test/reaper-reap.test.ts`: TERM rồi KILL, dry-run, state hỏng, giờ Việt Nam.
```

Trong `docs/flows/mac-setup.md`:
- Ở mục "Các bước", bước 2: thêm câu cuối "Ghi plist `com.2p.crew-mac-reaper` (`reaperPlistSpec`) và nạp bằng `ensureService`."
- Ở mục "Các bước", bước 3: thêm `LaunchAgent reaper (check `reaper`)` vào danh sách check, ngay sau "sshd agent và cổng".
- Ở bảng "Files", dòng `commands/setup.ts`: đổi cột "Symbol chính" thành `` `setup`, `ensureService`, `sshdPlistSpec`, `reaperPlistSpec` ``.
- Ở mục "Dữ liệu", thêm `~/Library/LaunchAgents/com.2p.crew-mac-reaper.plist` vào dòng "File trên Mac".

- [ ] **Step 11: Sinh docs, lint, kiểm docs của cả nhánh**

Chạy:

```bash
node packages/docs-kit/dist/crew-docs.cjs generate
node packages/docs-kit/dist/crew-docs.cjs flow mac-orphan-reaper
pnpm lint
pnpm -r typecheck
pnpm --filter @crew/mac test
node packages/docs-kit/dist/crew-docs.cjs check --range "$(git merge-base HEAD main)..HEAD"
```

Kỳ vọng: `flow mac-orphan-reaper` in 3 file nguồn và 2 file test. Lint, typecheck, test sạch. `check --range` không báo lỗi R2/R3: mọi file nguồn mới đều có trong flow, và mọi flow có file bị đổi đều có commit sửa doc. Chạy `check --range` sau khi đã commit ở Step 12; nếu nó báo lỗi thì sửa docs và commit thêm.

- [ ] **Step 12: Commit**

```bash
git add apps/crew-mac/src/reaper/reap.ts apps/crew-mac/test/reaper-reap.test.ts \
  apps/crew-mac/src/commands/setup.ts apps/crew-mac/src/commands/doctor.ts apps/crew-mac/src/cli.ts \
  apps/crew-mac/test/setup.test.ts apps/crew-mac/test/doctor.test.ts apps/crew-mac/test/uninstall.test.ts \
  docs/flows.yaml docs/flows/mac-orphan-reaper.md docs/flows/mac-setup.md docs/index.md docs/files.md
git commit -m "feat(crew-mac): LaunchAgent dọn process claude mồ côi theo PAPERCLIP_RUN_ID"
```

Không push. Push hoặc merge cần approval của owner (Global Constraints của khung).

---

## Rủi ro và rollback

| Rủi ro | Dấu hiệu | Giảm nhẹ | Rollback |
|---|---|---|---|
| Claude Code cập nhật bản mới, TCC hỏi lại quyền theo đường dẫn mới, agent treo im lặng | `doctor`: `claude-print-git` fail, `tcc-pending` fail kèm tên `versions/<bản>` | Worktree đặt ngoài vùng bảo vệ; `doctor` chỉ chỗ bấm. R1 chỉ phát hiện và hướng dẫn; ký số app cố định quyền là việc của R2 | Owner bấm Allow trên màn hình Mac |
| `uninstall` chạy qua sshd agent tự cắt phiên giữa chừng | Mất kết nối, còn sót file | CLI từ chối khi `SSH_CONNECTION` trỏ vào cổng agent (cần `--force`) | Chạy lại `crew-mac uninstall` trong Terminal trên màn hình Mac (idempotent) |
| Mac khởi động lại mà chưa ai đăng nhập màn hình | sshd agent và reaper không chạy (LaunchAgent Aqua), Paperclip báo không vào được | Bật tự đăng nhập cho user agent hoặc đăng nhập qua Chrome Remote Desktop; ghi vào hướng dẫn AC-1 | Không cần; đăng nhập xong thì launchd tự nạp |
| IP Tailscale đổi | `doctor`: `tailscale` fail | `setup` chạy lại thì nghe IP mới | Chạy lại `setup`, sửa environment Paperclip |
| `brew upgrade node` hoặc chuyển repo Crew làm plist reaper trỏ sai | `doctor`: `reaper` fail (mã thoát khác 0) | Plist dùng `/opt/homebrew/bin/node` (symlink ổn định) | Chạy lại `crew-mac setup` |
| `ClientAliveInterval 15 × 2` cắt phiên khi mạng chập chờn dài hơn khoảng 30 giây | Run fail do mất transport | Chủ ý: phiên mất thì run cũ phải dừng (Review Focus 1) | Sửa hai dòng trong `renderSshdConfig` nếu owner muốn thời hạn khác |
| Process mồ côi còn ghi vào worktree trong cửa sổ trước khi bị dọn | `reaper.log` có `TERM` cho run đã bị server đánh fail; commit lạ trong worktree agent | Cửa sổ khoảng 30 giây (sshd) + 60 giây (grace) + tối đa 60 giây (chu kỳ) + 10 giây (TERM); H3 dừng ngay khi server còn vào được Mac | Giảm `--grace-seconds` trong plist reaper; review commit của run bị đánh fail |
| Reaper dừng nhầm process | Có dòng `TERM` lạ trong `reaper.log` | Ba điều kiện cùng lúc: `claude` + `--print`/`-p` + `PAPERCLIP_RUN_ID`, không còn sshd trong chuỗi tổ tiên, mồ côi quá thời hạn; KILL chỉ khi vẫn đúng pgid | `launchctl bootout gui/$(id -u)/com.2p.crew-mac-reaper` |
| Wrapper trong repo Crew lệch bản của fork (`crew/mac/crew-claude-run.sh`), hoặc agent chưa đặt `adapterConfig.command` | H3 không thấy file `pgid` và phải dò theo env; `doctor`: `wrapper` cảnh báo khi bản cài khác bản repo | Chép nguyên văn khi fork đổi; `setup` in đường dẫn cần đặt cho `adapterConfig.command` | Chạy lại `crew-mac setup` |
| Phép thử `claude -p` của `doctor` tốn hạn mức | Hạn mức tuần giảm | Dùng `--model haiku`, prompt một từ; tắt bằng `--no-probe` | Không cần |

Rollback toàn bộ gói: `crew-mac uninstall` trong Terminal trên màn hình Mac, rồi nếu cần quay về spike thì cài lại theo `processes.md` của spike. Về code: revert các commit `feat(crew-mac)` và khối `mac-setup`, `mac-orphan-reaper` trong `docs/flows.yaml`.

## Ghi chú TCC

- Quyền đọc vùng được bảo vệ (ổ ngoài, Desktop, Downloads) gắn theo đường dẫn binary Claude (`~/.local/share/claude/versions/<bản>`), không theo tên app. D1 thấy TCC.db có quyền cho 2.1.273 mà không có cho 2.1.289.
- Khi hộp thoại chưa được bấm, mọi yêu cầu cùng loại xếp hàng phía sau và process đứng yên trong `openat`, không phản ứng với `SIGTERM`.
- Phiên qua sshd LaunchAgent được TCC tính quyền theo chính binary không phải của Apple, không theo sshd. Phiên cổng 22 thì theo `sshd-keygen-wrapper` (đã có Full Disk Access), nhưng phiên đó không mở được Keychain.
- R1: `doctor` phát hiện (`AUTHREQ_PROMPTING` chưa có `AUTHREQ_RESULT` trong `/usr/bin/log`) và chỉ chỗ bấm. R2: app ký số làm responsible process để quyền không mất mỗi lần cập nhật.

## Đề nghị sửa khung (đã xử lý)

Trợ Lý đã đối chiếu với `runtime.md` và chốt ngày 06/10/2026. Các mục dưới đây giữ lại để truy vết.

1. **Tiêu chí mồ côi:** dùng "không còn `sshd`/`sshd-session` trong chuỗi tổ tiên" thay cho "PPID 1". Đã có trong Task 8 (`isOrphaned`, kèm test trường hợp cha trực tiếp còn sống).
2. **Ghi PGID cho H3:** wrapper `crew-claude-run` (hợp đồng `runtime.md` RT-1.1) ghi `pgid` và `started` dưới `.paperclip-runtime/runs/<runId>/`. Wrapper thuộc MS-1: Task 4 cài, Task 5 kiểm (`checkWrapper`), Task 6 gỡ.
3. **`PAPERCLIP_RUN_ID` có trong env lúc exec của `claude`:** `claude_local` export biến này, rồi wrapper `exec` nên `claude` giữ đúng env và PID. Wrapper chỉ chấp nhận hex và `-`, nằm trong tập mà `extractRunId` nhận.
4. **AC-1 chạy trên màn hình Mac và quét lại host key:** CLI `uninstall` từ chối khi chạy qua sshd agent (Task 7). Đã chuyển cho Trợ Lý ghi vào bước AC-1.
5. **`~/Documents`:** chưa kiểm xong; mặc định `~/crew-agents` tránh vùng này. Đã chuyển cho Trợ Lý.
6. **Mac khởi động lại thì cần đăng nhập màn hình:** ghi ở mục "Rủi ro và rollback". Đã chuyển cho Trợ Lý ghi vào phần vận hành.
7. **Cửa sổ mồ côi:** đã rút còn khoảng 30 giây (sshd) + 60 giây (`graceMs`) + tối đa 60 giây (chu kỳ LaunchAgent) + 10 giây (TERM). Xem "Rủi ro và rollback".
