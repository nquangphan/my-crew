import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { MacContext } from '../context.js';
import { comparablePath } from '../paths.js';
import { readInstalledPlugins } from './install.js';
import { superpowersPinDir, type WorkflowPin } from './pin.js';
import { assertSkillAllowed } from './policy.js';
import { treeChecksum } from './tree-checksum.js';

export type Origin = 'pinned' | 'paperclip' | 'project' | 'blocked';

export interface DiscoveredSource {
  path: string;
  kind: 'skill' | 'agent' | 'command' | 'plugin' | 'settings';
  origin: Origin;
  reason?: string;
}

export const UNTRACKED_REASON = 'không được git track trong worktree agent';

function contained(parent: string, child: string): boolean {
  const rel = relative(comparablePath(parent), comparablePath(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Nguồn ở `path` thuộc loại nào, theo vị trí so với thư mục ghim và worktree, và việc nó có được git track. */
export function classifyOrigin(input: {
  path: string;
  root: string;
  pinDir: string;
  tracked: boolean;
}): Origin {
  if (contained(input.pinDir, input.path)) return 'pinned';
  if (contained(join(input.root, '.paperclip-runtime'), input.path)) return 'paperclip';
  if (contained(input.root, input.path) && input.tracked) return 'project';
  return 'blocked';
}

/**
 * Được track = git có file dưới `path` và không có file nào chưa track (kể cả bị ignore) dưới đó: thả thêm một file
 * vào thư mục skill đã commit cũng tính là nguồn lạ. Worktree không phải repo git thì không có gì được track.
 */
async function isTracked(ctx: MacContext, root: string, path: string): Promise<boolean> {
  const rel = relative(root, path);
  const opts = { timeoutMs: 10_000 };
  const tracked = await ctx.runner.run('/usr/bin/git', ['-C', root, 'ls-files', '--', rel], opts);
  if (tracked.code !== 0 || tracked.stdout.trim() === '') return false;
  const others = await ctx.runner.run('/usr/bin/git', ['-C', root, 'ls-files', '--others', '--', rel], opts);
  return others.code === 0 && others.stdout.trim() === '';
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function enabledPluginKeys(json: Record<string, unknown> | null): string[] {
  const plugins = json?.enabledPlugins;
  if (plugins === null || typeof plugins !== 'object') return [];
  return Object.entries(plugins as Record<string, unknown>)
    .filter(([, on]) => on === true)
    .map(([key]) => key);
}

/** Có bản cài nào của plugin `key` trùng đúng bản ghim (version, revision, checksum cây). */
function matchesPin(ctx: MacContext, key: string, pin: WorkflowPin): boolean {
  return readInstalledPlugins(ctx.home, key).some((e) => {
    try {
      assertSkillAllowed(pin, {
        ...pin,
        version: e.version,
        revision: e.gitCommitSha ?? '',
        checksum: treeChecksum(e.installPath).checksum,
      });
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Mọi nguồn skill/agent/command/plugin/settings trong `.claude/` của worktree mà claude sẽ nạp dưới
 * `--setting-sources project,local`, kèm loại nguồn. Nguồn ngoài worktree (`~/.claude`) không quét được ở đây;
 * `--setting-sources` đã chặn chúng (đo ở spike SP-1).
 */
export async function discoverSources(
  ctx: MacContext,
  root: string,
  pin: WorkflowPin = ctx.superpowersPin,
): Promise<DiscoveredSource[]> {
  const pinDir = superpowersPinDir(ctx.home, pin);
  const found: DiscoveredSource[] = [];
  for (const [kind, sub] of [
    ['skill', 'skills'],
    ['agent', 'agents'],
    ['command', 'commands'],
  ] as const) {
    const dir = join(root, '.claude', sub);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      const origin = classifyOrigin({ path, root, pinDir, tracked: await isTracked(ctx, root, path) });
      found.push({ path, kind, origin, ...(origin === 'blocked' ? { reason: UNTRACKED_REASON } : {}) });
    }
  }
  const local = join(root, '.claude', 'settings.local.json');
  const localJson = existsSync(local) ? readJson(local) : null;
  if (existsSync(local) && (localJson === null || localJson.enabledPlugins || localJson.hooks)) {
    found.push({
      path: local,
      kind: 'settings',
      origin: 'blocked',
      reason:
        localJson === null
          ? 'settings.local.json không đọc được trong worktree agent'
          : 'settings.local.json bật plugin hoặc hook trong worktree agent',
    });
  }
  const shared = join(root, '.claude', 'settings.json');
  if (existsSync(shared)) {
    const tracked = await isTracked(ctx, root, shared);
    if (!tracked) {
      found.push({
        path: shared,
        kind: 'settings',
        origin: 'blocked',
        reason: 'settings.json không được git track',
      });
    }
    for (const key of enabledPluginKeys(readJson(shared))) {
      const path = `${shared}#${key}`;
      if (!key.startsWith(`${pin.workflow}@`)) {
        found.push({
          path,
          kind: 'plugin',
          origin: tracked ? 'project' : 'blocked',
          ...(tracked ? {} : { reason: 'settings.json không được git track' }),
        });
      } else if (matchesPin(ctx, key, pin)) {
        found.push({ path, kind: 'plugin', origin: 'pinned' });
      } else {
        found.push({
          path,
          kind: 'plugin',
          origin: 'blocked',
          reason: `WORKFLOW_SOURCE_MISMATCH: ${key} bật trong repo nhưng bản cài khác bản ghim ${pin.version}`,
        });
      }
    }
  }
  return found;
}
