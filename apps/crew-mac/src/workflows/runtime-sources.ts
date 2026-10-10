import { execFileSync } from 'node:child_process';
import { type Dirent, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CrewRuntime } from './registry.js';

/** Runtime ngoài Claude mà `workflow-check --runtime` kiểm. */
export type ExternalRuntime = Exclude<CrewRuntime, 'claude_local'>;

export const EXTERNAL_RUNTIMES: readonly ExternalRuntime[] = ['codex_local', 'opencode_local'];

export interface RuntimeSourceFinding {
  path: string;
  reason: 'runtime-config' | 'pin-mismatch' | 'pin-missing';
}

/**
 * Nguồn cấu hình mỗi CLI tự nạp từ gốc worktree (cwd của run): Codex đọc `.codex/`, OpenCode đọc `.opencode/`,
 * `opencode.json` và `opencode.jsonc`. Chỉ xét gốc worktree vì run luôn chạy ở đó.
 */
const RUNTIME_ENTRIES: Record<ExternalRuntime, readonly string[]> = {
  codex_local: ['.codex'],
  opencode_local: ['.opencode', 'opencode.json', 'opencode.jsonc'],
};

const ALL_ENTRIES = [...new Set(Object.values(RUNTIME_ENTRIES).flat())];

/**
 * File cấu hình runtime mà git theo dõi trong worktree (đường dẫn tương đối, dấu `/`). Không đọc được git (không phải
 * repo, git lỗi) thì trả tập rỗng: mọi file cấu hình runtime đều bị coi là không theo dõi (fail-closed).
 */
export function trackedRuntimeFiles(root: string): Set<string> {
  try {
    const out = execFileSync('/usr/bin/git', ['-C', root, 'ls-files', '-z', '--', ...ALL_ENTRIES], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set(out.split('\0').filter((p) => p.length > 0));
  } catch {
    return new Set();
  }
}

/** Mọi file (và symlink, hay entry không phải thư mục) dưới `rel`; không theo symlink. */
function entriesUnder(root: string, rel: string): string[] {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(join(root, rel));
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [rel];
  let children: Dirent[];
  try {
    children = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    // Không đọc được thư mục: không chứng minh được là sạch, chặn cả thư mục.
    return [rel];
  }
  return children.flatMap((c) => entriesUnder(root, `${rel}/${c.name}`));
}

/** File cấu hình của `runtime` ở gốc worktree mà git không theo dõi: CLI sẽ nạp chúng ngoài tầm kiểm của Crew. */
export function findRuntimeSources(input: {
  root: string;
  runtime: ExternalRuntime;
  tracked: ReadonlySet<string>;
}): RuntimeSourceFinding[] {
  return RUNTIME_ENTRIES[input.runtime]
    .flatMap((entry) => entriesUnder(input.root, entry))
    .filter((path) => !input.tracked.has(path))
    .sort()
    .map((path) => ({ path, reason: 'runtime-config' as const }));
}
