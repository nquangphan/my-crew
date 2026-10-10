import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { MacContext } from '../context.js';
import { missingExecutables } from '../workflows/install.js';
import { describeSource, discoverSources, recordWorktreeWorkflow } from '../workflows/inventory.js';
import { pinDir } from '../workflows/pin.js';
import { assertSkillAllowed } from '../workflows/policy.js';
import { certifiedWorkflows, workflowForPluginDir } from '../workflows/registry.js';
import { checkInitEvent, findInitEvent, selectInitWorkflow } from '../workflows/run-init.js';
import {
  type ExternalRuntime,
  findRuntimeSources,
  type RuntimeSourceFinding,
  trackedRuntimeFiles,
} from '../workflows/runtime-sources.js';
import { treeChecksum } from '../workflows/tree-checksum.js';

export interface WorkflowReport {
  ok: boolean;
  lines: string[];
}

const blocked = (what: string) => `crew-workflow blocked: ${what}`;

/**
 * Kiểm trước mỗi run Paperclip (wrapper gọi): `--plugin-dir` là thư mục ghim của đúng một workflow đã chứng nhận
 * (workflow đó là workflow của run), thư mục ghim đúng checksum, và worktree không có nguồn `blocked` theo workflow này
 * (gồm nạp chéo workflow khác qua `enabledPlugins` và, với BMAD, `_bmad/`).
 */
export async function workflowCheck(
  ctx: MacContext,
  input: { root: string; pluginDir: string },
): Promise<WorkflowReport> {
  const workflow = workflowForPluginDir(ctx, input.pluginDir);
  if (!workflow) {
    const dirs = certifiedWorkflows(ctx).map((w) => pinDir(ctx.home, w.pin));
    return {
      ok: false,
      lines: [
        blocked(
          `--plugin-dir ${input.pluginDir} không phải bản ghim của workflow nào đã chứng nhận (${dirs.join(', ')})`,
        ),
      ],
    };
  }
  const pin = workflow.pin;
  // Trước khi xét nguồn: run bị chặn vẫn cho doctor biết worktree này thuộc workflow nào.
  recordWorktreeWorkflow(ctx.home, input.root, workflow.id);
  const expected = pinDir(ctx.home, pin);
  const lines: string[] = [];
  try {
    assertSkillAllowed(pin, { ...pin, checksum: treeChecksum(expected).checksum });
    const missing = missingExecutables(expected, pin);
    if (missing.length > 0) {
      lines.push(blocked(`${expected} (thiếu bit thực thi: ${missing.join(', ')}; chạy lại crew-mac setup)`));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lines.push(
      blocked(
        `${expected} (${message === 'WORKFLOW_SOURCE_MISMATCH' ? message : `WORKFLOW_SOURCE_MISMATCH: ${message}`})`,
      ),
    );
  }
  const sources = await discoverSources(ctx, input.root, pin);
  for (const s of sources.filter((x) => x.origin === 'blocked')) lines.push(blocked(describeSource(s)));
  if (lines.length > 0) return { ok: false, lines };
  const warnings = sources.filter((s) => s.warning).map((s) => `crew-workflow warn: ${describeSource(s)}`);
  const count = (origin: string) => sources.filter((s) => s.origin === origin).length;
  return {
    ok: true,
    lines: [
      `crew-workflow ok pin=${pin.workflow}@${pin.version} rev=${pin.revision.slice(0, 12)} sum=${pin.checksum.slice(0, 12)} ` +
        `project=${count('project')} pinned-dup=${count('pinned')}`,
      ...warnings,
    ],
  };
}

/** Bản Superpowers ở `dir` (CREW_SUPERPOWERS_DIR của wrapper) có đúng checksum ghim không; null là khớp. */
function superpowersDirFinding(dir: string | undefined, checksum: string): RuntimeSourceFinding | null {
  if (!dir) return { path: 'chưa đặt', reason: 'pin-missing' };
  try {
    if (!statSync(dir).isDirectory()) return { path: dir, reason: 'pin-missing' };
  } catch {
    return { path: dir, reason: 'pin-missing' };
  }
  try {
    return treeChecksum(dir).checksum === checksum ? null : { path: dir, reason: 'pin-mismatch' };
  } catch {
    return { path: dir, reason: 'pin-mismatch' };
  }
}

/**
 * Kiểm trước mỗi run Codex/OpenCode (wrapper gọi): `CREW_SUPERPOWERS_DIR` là bản Superpowers ghim đúng checksum (agent
 * đọc skill ở đó), và gốc worktree không có cấu hình riêng của runtime (`.codex/`, `.opencode/`, `opencode.json[c]`)
 * mà git không theo dõi — file đã commit là của repo dự án, được phép như `.claude/` đã commit.
 */
export async function workflowCheckRuntime(
  ctx: MacContext,
  input: { root: string; runtime: ExternalRuntime; superpowersDir: string | undefined },
): Promise<WorkflowReport> {
  const pin = ctx.superpowersPin;
  recordWorktreeWorkflow(ctx.home, input.root, pin.workflow);
  const lines: string[] = [];
  const pinFinding = superpowersDirFinding(input.superpowersDir, pin.checksum);
  if (pinFinding) {
    const why =
      pinFinding.reason === 'pin-missing'
        ? 'không có thư mục; chạy lại crew-mac setup'
        : `checksum khác bản ghim ${pin.workflow}@${pin.version}; chạy lại crew-mac setup`;
    lines.push(blocked(`CREW_SUPERPOWERS_DIR ${pinFinding.path} (${pinFinding.reason}: ${why})`));
  }
  const tracked = trackedRuntimeFiles(input.root);
  for (const f of findRuntimeSources({ root: input.root, runtime: input.runtime, tracked })) {
    lines.push(
      blocked(`${f.path} (${f.reason}: cấu hình ${input.runtime} trong worktree mà git không theo dõi)`),
    );
  }
  if (lines.length > 0) return { ok: false, lines };
  return { ok: true, lines: [`crew-workflow ok runtime=${input.runtime} superpowers=${pin.version}`] };
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
 * Kiểm sau run: dòng `system/init` trong log stream-json của run chỉ nạp đúng một workflow đã chứng nhận (nhận theo
 * tên plugin) từ thư mục ghim của nó, cộng nguồn được phép (dựng sẵn của CLI, `.claude/` đã commit của repo,
 * Paperclip, connector MCP của tài khoản).
 */
export async function runInitCheck(
  ctx: MacContext,
  input: { root: string; log: string },
): Promise<WorkflowReport> {
  const init = findInitEvent(input.log);
  if (!init) return { ok: false, lines: [blocked('log không có dòng system/init')] };
  const selected = selectInitWorkflow(init, certifiedWorkflows(ctx));
  if ('violation' in selected) return { ok: false, lines: [blocked(selected.violation)] };
  const pin = selected.workflow.pin;
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
    pinDir: pinDir(ctx.home, pin),
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
