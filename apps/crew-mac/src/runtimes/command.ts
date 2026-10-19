import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { MacContext } from '../context.js';
import { keychainKeyFingerprint, keychainKeyState, SAVE_KEY_ARGS, SECURITY_BIN } from './keychain.js';
import { runtimePaths } from './paths.js';

export const RUNTIMES_USAGE =
  'crew-mac runtimes key opencode | key-fingerprint opencode | status [--json] | skills-checksum';

/**
 * Lệnh của agent CLI chạy qua zsh không tương tác: zsh đọc `~/.zshenv` (khối PATH crew-mac ghi), nên thấy đúng các
 * CLI mà sshd agent thấy, kể cả khi crew-mac được app 2P Crew gọi với PATH launchd tối thiểu.
 */
export const AGENT_SHELL = '/bin/zsh';
const AGENT_TIMEOUT_MS = 15_000;

/** Hợp đồng `runtimes status --json` mà app dựng kết quả việc máy `runtimes-setup` (không có key, token, đường auth). */
export interface RuntimesStatus {
  wrappers: { codex: boolean; opencode: boolean };
  codex: { version: string | null; loggedIn: boolean | null };
  opencode: { version: string | null; keyPresent: boolean | null };
}

export interface RuntimesIo {
  err: (line: string) => void;
  /** stdin là Terminal của owner (lệnh nạp key cần security hỏi key trên đó). */
  stdinIsTTY: boolean;
}

class RuntimesUsageError extends Error {}

export async function agentShell(ctx: MacContext, command: string, timeoutMs: number = AGENT_TIMEOUT_MS) {
  return ctx.runner.run(AGENT_SHELL, ['-c', command], { timeoutMs });
}

/** Dòng đầu không rỗng của `<cli> --version`; null khi chưa cài hoặc lỗi. */
export async function cliVersion(ctx: MacContext, cli: string, timeoutMs?: number): Promise<string | null> {
  const result = await agentShell(ctx, `${cli} --version`, timeoutMs);
  if (result.code !== 0 || result.timedOut) return null;
  const line = result.stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  return line ? line.slice(0, 80) : null;
}

async function claudeLoggedIn(ctx: MacContext): Promise<boolean | null> {
  const result = await agentShell(ctx, 'claude auth status');
  if (result.code === 127 || result.timedOut) return null;
  try {
    return (JSON.parse(result.stdout) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return false;
  }
}

/**
 * `codex login status` thoát 0 khi đã đăng nhập (câu trạng thái ra stderr, không đọc nội dung). Giá trị giả định,
 * kiểm lại qua sshd agent trên Mac thật.
 */
export async function codexLoggedIn(ctx: MacContext, timeoutMs?: number): Promise<boolean | null> {
  const result = await agentShell(ctx, 'codex login status', timeoutMs);
  if (result.code === 127 || result.timedOut) return null;
  return result.code === 0;
}

function wrapperInstalled(path: string, runMark: string): boolean {
  try {
    return (statSync(path).mode & 0o111) !== 0 && existsSync(runMark);
  } catch {
    return false;
  }
}

export async function runtimesStatus(
  ctx: MacContext,
): Promise<RuntimesStatus & { claude: RuntimesStatus['codex'] }> {
  const p = runtimePaths(ctx.home);
  const [claudeVersion, claudeAuth, codexVersion, opencodeVersion, keyPresent] = await Promise.all([
    cliVersion(ctx, 'claude'),
    claudeLoggedIn(ctx),
    cliVersion(ctx, 'codex'),
    cliVersion(ctx, 'opencode'),
    keychainKeyState(ctx),
  ]);
  return {
    wrappers: {
      codex: wrapperInstalled(p.codexWrapper, p.runMark),
      opencode: wrapperInstalled(p.opencodeWrapper, p.runMark),
    },
    claude: { version: claudeVersion, loggedIn: claudeVersion === null ? null : claudeAuth },
    codex: { version: codexVersion, loggedIn: codexVersion === null ? null : await codexLoggedIn(ctx) },
    opencode: { version: opencodeVersion, keyPresent },
  };
}

const yesNo = (value: boolean | null) => (value === null ? 'không rõ' : value ? 'có' : 'không');

/**
 * Checksum cây `~/.claude/skills` để so trước/sau một run (run OpenCode/Codex không được đụng skill của Claude).
 * Khác checksum workflow: symlink được tính theo đích của link (không theo link), vì skill của owner hay là symlink.
 */
export function skillsChecksum(root: string): string {
  const entries: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) entries.push(`${path}\0link:${readlinkSync(abs)}`);
      else if (entry.isDirectory()) walk(abs, path);
      else if (entry.isFile())
        entries.push(`${path}\0${createHash('sha256').update(readFileSync(abs)).digest('hex')}`);
      else entries.push(`${path}\0other`);
    }
  };
  walk(root, '');
  entries.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const hash = createHash('sha256');
  for (const line of entries) hash.update(`${line}\n`);
  return hash.digest('hex');
}

function requireOpencode(args: readonly string[]): void {
  if (args.length !== 1 || args[0] !== 'opencode') throw new RuntimesUsageError('chỉ có runtime opencode');
}

export async function runtimesCommand(
  ctx: MacContext,
  args: readonly string[],
  io: RuntimesIo,
): Promise<number> {
  const [sub, ...rest] = args;
  try {
    switch (sub) {
      case 'key': {
        requireOpencode(rest);
        if (!io.stdinIsTTY) {
          io.err(
            'runtimes: cần chạy trong Terminal của owner (security hỏi key trên Terminal, gõ ẩn hai lần)',
          );
          return 2;
        }
        const result = await ctx.runner.run(SECURITY_BIN, SAVE_KEY_ARGS, { stdio: 'inherit' });
        if (result.code !== 0) {
          io.err(`runtimes: security không lưu được key (mã ${result.code})`);
          return 1;
        }
        ctx.out('đã lưu key OpenCode Go vào Keychain (service crew.opencode-go, account crew)');
        return 0;
      }
      case 'key-fingerprint': {
        requireOpencode(rest);
        const fingerprint = await keychainKeyFingerprint(ctx);
        if (fingerprint === null) {
          io.err('runtimes: chưa có key OpenCode Go trong Keychain; chạy "crew-mac runtimes key opencode"');
          return 1;
        }
        ctx.out(fingerprint);
        return 0;
      }
      case 'status': {
        if (rest.length > 1 || (rest.length === 1 && rest[0] !== '--json'))
          throw new RuntimesUsageError('status chỉ nhận --json');
        const status = await runtimesStatus(ctx);
        if (rest[0] === '--json') {
          const { wrappers, codex, opencode } = status;
          ctx.out(JSON.stringify({ wrappers, codex, opencode }));
          return 0;
        }
        const version = (v: string | null) => v ?? 'chưa cài';
        ctx.out(
          `claude_local: ${version(status.claude.version)} · đăng nhập ${yesNo(status.claude.loggedIn)}`,
        );
        ctx.out(`codex_local: ${version(status.codex.version)} · đăng nhập ${yesNo(status.codex.loggedIn)}`);
        ctx.out(
          `opencode_local: ${version(status.opencode.version)} · key ${yesNo(status.opencode.keyPresent)}`,
        );
        return 0;
      }
      case 'skills-checksum': {
        if (rest.length > 0) throw new RuntimesUsageError('skills-checksum không nhận tham số');
        const dir = runtimePaths(ctx.home).claudeSkillsDir;
        if (!existsSync(dir)) {
          ctx.out('không có');
          return 0;
        }
        ctx.out(skillsChecksum(dir));
        return 0;
      }
      default:
        throw new RuntimesUsageError(sub === undefined ? 'thiếu lệnh con' : `không có lệnh con ${sub}`);
    }
  } catch (error) {
    if (error instanceof RuntimesUsageError) {
      io.err(`crew-mac runtimes: ${error.message}\nCách dùng: ${RUNTIMES_USAGE}`);
      return 2;
    }
    io.err(`crew-mac runtimes: ${(error as Error).message}`);
    return 1;
  }
}
