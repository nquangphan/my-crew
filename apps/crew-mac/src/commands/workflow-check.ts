import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { MacContext } from '../context.js';
import { comparablePath } from '../paths.js';
import { missingExecutables } from '../workflows/install.js';
import { discoverSources } from '../workflows/inventory.js';
import { superpowersPinDir, type WorkflowPin } from '../workflows/pin.js';
import { assertSkillAllowed } from '../workflows/policy.js';
import { checkInitEvent, findInitEvent } from '../workflows/run-init.js';
import { treeChecksum } from '../workflows/tree-checksum.js';

export interface WorkflowReport {
  ok: boolean;
  lines: string[];
}

const blocked = (what: string) => `crew-workflow blocked: ${what}`;

/**
 * Kiểm trước mỗi run Paperclip (wrapper gọi): `--plugin-dir` đúng thư mục ghim, thư mục ghim đúng checksum, và worktree
 * không có nguồn `blocked`.
 */
export async function workflowCheck(
  ctx: MacContext,
  input: { root: string; pluginDir: string; pin?: WorkflowPin },
): Promise<WorkflowReport> {
  const pin = input.pin ?? ctx.superpowersPin;
  const expected = superpowersPinDir(ctx.home, pin);
  const lines: string[] = [];
  if (comparablePath(input.pluginDir) !== comparablePath(expected)) {
    lines.push(blocked(`--plugin-dir ${input.pluginDir} không phải bản ghim ${expected}`));
  } else {
    try {
      assertSkillAllowed(pin, { ...pin, checksum: treeChecksum(expected).checksum });
      const missing = missingExecutables(expected, pin);
      if (missing.length > 0) {
        lines.push(
          blocked(`${expected} (thiếu bit thực thi: ${missing.join(', ')}; chạy lại crew-mac setup)`),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lines.push(
        blocked(
          `${expected} (${message === 'WORKFLOW_SOURCE_MISMATCH' ? message : `WORKFLOW_SOURCE_MISMATCH: ${message}`})`,
        ),
      );
    }
  }
  const sources = await discoverSources(ctx, input.root, pin);
  for (const s of sources.filter((x) => x.origin === 'blocked')) {
    lines.push(blocked(`${s.path} (${s.reason ?? 'nguồn ngoài danh sách cho phép'})`));
  }
  if (lines.length > 0) return { ok: false, lines };
  const count = (origin: string) => sources.filter((s) => s.origin === origin).length;
  return {
    ok: true,
    lines: [
      `crew-workflow ok pin=${pin.workflow}@${pin.version} project=${count('project')} pinned-dup=${count('pinned')}`,
    ],
  };
}

function frontmatterName(file: string): string | null {
  try {
    return /^---\n[\s\S]*?^name:\s*(\S+)\s*$/m.exec(readFileSync(file, 'utf8'))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Tên skill Paperclip đưa vào run (`SKILL.md` dưới `<root>/.paperclip-runtime`, bỏ `runs/`), tối đa 6 cấp. */
function paperclipSkillNames(root: string): string[] {
  const names: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !(depth === 0 && e.name === 'runs')) walk(join(dir, e.name), depth + 1);
      else if (e.isFile() && e.name === 'SKILL.md') {
        names.push(basename(dir));
        const named = frontmatterName(join(dir, e.name));
        if (named) names.push(named);
      }
    }
  };
  const base = join(root, '.paperclip-runtime');
  if (existsSync(base)) walk(base, 0);
  return names;
}

/**
 * Kiểm sau run: dòng `system/init` trong log stream-json của run chỉ nạp Superpowers từ thư mục ghim, cộng nguồn được
 * phép (dựng sẵn của CLI, `.claude/` đã commit của repo, Paperclip, connector MCP của tài khoản).
 */
export async function runInitCheck(
  ctx: MacContext,
  input: { root: string; log: string; pin?: WorkflowPin },
): Promise<WorkflowReport> {
  const pin = input.pin ?? ctx.superpowersPin;
  const init = findInitEvent(input.log);
  if (!init) return { ok: false, lines: [blocked('log không có dòng system/init')] };
  const sources = (await discoverSources(ctx, input.root, pin)).filter((s) => s.origin !== 'blocked');
  const namesOf = (kind: 'skill' | 'agent') =>
    sources
      .filter((s) => s.kind === kind)
      .flatMap((s) => {
        const file = kind === 'skill' ? join(s.path, 'SKILL.md') : s.path;
        const named = frontmatterName(file);
        return [basename(s.path).replace(/\.md$/, ''), ...(named ? [named] : [])];
      });
  const { violations, pinnedSkills } = checkInitEvent(init, {
    pin,
    pinDir: superpowersPinDir(ctx.home, pin),
    projectPlugins: sources
      .filter((s) => s.kind === 'plugin' && s.origin === 'project')
      .map((s) => s.path.slice(s.path.lastIndexOf('#') + 1)),
    skills: [...namesOf('skill'), ...paperclipSkillNames(input.root)],
    agents: namesOf('agent'),
    checksumOf: (dir) => {
      try {
        return treeChecksum(dir).checksum;
      } catch {
        return null;
      }
    },
  });
  if (violations.length > 0) return { ok: false, lines: violations.map(blocked) };
  return {
    ok: true,
    lines: [
      `crew-workflow init ok: ${pin.workflow}@${pin.version} từ bản ghim, ${pinnedSkills} skill ${pin.workflow}:*`,
    ],
  };
}
