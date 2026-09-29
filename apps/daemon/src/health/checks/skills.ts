import type { SkillInventory } from '@crew/shared';
import { removeWorktree } from '../../git/worktree-manager.js';
import { storedInventory } from '../project-views.js';
import { PROBE_WORKTREE_KEY } from '../repo-probe.js';
import { type HealthCheck, type HealthCheckResult, parseFixId, result } from '../types.js';

const MAX_NAMES = 25;

/** `12 skill (3 từ plugin: claude-mem): a, b, c…` */
export function describeSkills(inventory: SkillInventory): string {
  const names = inventory.skills.map((skill) => skill.name);
  const pluginSkills = inventory.skills.filter((skill) => skill.source === 'plugin');
  const namespaces = [
    ...new Set(
      pluginSkills.filter((skill) => skill.name.includes(':')).map((skill) => skill.name.split(':')[0]),
    ),
  ];
  const plugin = pluginSkills.length;
  const shown = names.slice(0, MAX_NAMES).join(', ') + (names.length > MAX_NAMES ? '…' : '');
  const pluginNote =
    plugin > 0 ? ` (${plugin} từ plugin${namespaces.length ? `: ${namespaces.join(', ')}` : ''})` : '';
  return names.length === 0 ? 'Không có skill nào.' : `${names.length} skill${pluginNote}: ${shown}`;
}

export const skillChecks: HealthCheck = {
  id: 'skills',
  group: 'skills',
  async run(ctx) {
    const results: HealthCheckResult[] = [];
    for (const project of ctx.config?.projects ?? []) {
      const key = project.key;
      const refresh = { id: `skills-refresh:${key}`, label: 'Làm mới kho skill' };
      const inventory = storedInventory(ctx, key);
      if (!inventory) {
        results.push(
          result(
            `skills.${key}.inventory`,
            'skills',
            `Skill của ${key}`,
            'yellow',
            'Chưa có kho skill của project (daemon chưa dò trong worktree).',
            refresh,
          ),
        );
        continue;
      }
      results.push(
        result(
          `skills.${key}.inventory`,
          'skills',
          `Skill của ${key}`,
          'green',
          `Trong worktree của job: ${describeSkills(inventory)}`,
        ),
      );
      if (!ctx.probeCheckout || ctx.quick) continue;
      try {
        const checkout = await ctx.probeCheckout(project.repoPath);
        const seen = new Set(inventory.skills.map((skill) => skill.name));
        const missing = checkout.skills.map((skill) => skill.name).filter((name) => !seen.has(name));
        results.push(
          missing.length === 0
            ? result(
                `skills.${key}.match`,
                'skills',
                `Worktree khớp checkout chính (${key})`,
                'green',
                `Worktree thấy đủ ${checkout.skills.length} skill của checkout chính.`,
              )
            : result(
                `skills.${key}.match`,
                'skills',
                `Worktree khớp checkout chính (${key})`,
                'red',
                `Agent trong worktree thiếu ${missing.length} skill mà checkout chính có: ${missing.slice(0, MAX_NAMES).join(', ')}. Kiểm tra "Thư mục dùng chung cho worktree".`,
                { id: `skills-redetect:${key}`, label: 'Dò lại thư mục dùng chung' },
              ),
        );
      } catch (error) {
        results.push(
          result(
            `skills.${key}.match`,
            'skills',
            `Worktree khớp checkout chính (${key})`,
            'yellow',
            `Không dò được skill của checkout chính: ${(error as Error).message}`,
            refresh,
          ),
        );
      }
    }
    const machine = storedInventory(ctx, null);
    if (machine) {
      results.push(
        result('skills.machine', 'skills', 'Skill cấp máy (trợ lý)', 'green', describeSkills(machine)),
      );
    }
    return results;
  },
  async fix(ctx, fixId) {
    const { action, key } = parseFixId(fixId);
    const project = ctx.config?.projects.find((p) => p.key === key);
    if (!project) return;
    if (action === 'skills-redetect') {
      // The probe worktree is rebuilt on the next probe, linking the shared paths detected now.
      removeWorktree(project.repoPath, PROBE_WORKTREE_KEY);
    } else if (action !== 'skills-refresh') {
      return;
    }
    await ctx.daemon?.refreshInventory(project.key);
  },
};
