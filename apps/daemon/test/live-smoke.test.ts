import { describe, expect, it } from 'vitest';
import { detectSharedPaths, ensureWorktree } from '../src/git/worktree-manager.js';
import { loginProbe } from '../src/health/checks/claude.js';
import { agentEnv, createSdkRunner } from '../src/runner/agent-runner.js';
import type { RolePlanner } from '../src/runner/job-runner.js';
import { probeInventory } from '../src/skills/skill-inventory.js';
import { commentsOf, devTicket, fixture, getTicket, pmTask, useApi } from './helpers/api.js';
import { makeDaemon, waitFor } from './helpers/daemon.js';
import { makeRepo, writeFiles } from './helpers/git.js';

/**
 * Real Agent SDK runs on the owner's subscription login. Opt in with CREW_LIVE_AGENT_TESTS=1; the paid
 * part is one short haiku run plus the login probe.
 */
const live = process.env.CREW_LIVE_AGENT_TESTS === '1';
const api = useApi();

describe.skipIf(!live)('live Agent SDK smoke', () => {
  it('a worktree of a repo with a gitignored .claude sees the same project skills as the main checkout', async () => {
    const repo = makeRepo({ 'README.md': '# live\n', '.gitignore': '.claude/\n' });
    writeFiles(repo, {
      '.claude/skills/shop-domain/SKILL.md':
        '---\nname: shop-domain\ndescription: Nghiệp vụ cửa hàng trực tuyến của dự án thử nghiệm\n---\n\nDùng khi làm việc với giỏ hàng.\n',
    });
    const env = agentEnv(process.env, {});
    const main = await probeInventory({ cwd: repo, env, listTools: null });
    const worktree = ensureWorktree({
      repo,
      key: 'LIVE-1',
      base: 'main',
      sharedPaths: detectSharedPaths(repo),
    });
    const inWorktree = await probeInventory({ cwd: worktree.path, env, listTools: null });
    const project = (inventory: typeof main.inventory) =>
      inventory.skills
        .filter((skill) => skill.source === 'project')
        .map((skill) => skill.name)
        .sort();
    expect(project(main.inventory)).toContain('shop-domain');
    expect(project(inWorktree.inventory)).toEqual(project(main.inventory));
    expect(inWorktree.inventory.skills.find((s) => s.name === 'shop-domain')?.description).toBe(
      'Nghiệp vụ cửa hàng trực tuyến của dự án thử nghiệm',
    );
    const plugin = inWorktree.inventory.skills.filter((skill) => skill.source === 'plugin');
    for (const skill of plugin) expect(skill.name).toContain(':');
    console.info(
      `[live] ${inWorktree.inventory.skills.length} skills (${plugin.length} plugin, e.g. ${plugin
        .slice(0, 3)
        .map((s) => s.name)
        .join(', ')}); ` + `${inWorktree.inventory.mcpServers.length} MCP servers`,
    );
  });

  it('the subscription login works and does not bill an API key', async () => {
    const probe = await loginProbe();
    console.info(`[live] login probe: ${JSON.stringify(probe)}`);
    expect(probe.ok).toBe(true);
    expect(probe.apiKeySource).toBe('none');
  });

  it('a haiku job uses the ticket tools, is guarded, and records total_cost_usd', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const planner: RolePlanner = {
      async plan() {
        return {
          model: 'haiku',
          effort: 'low',
          resumeSessionId: null,
          prompt: [
            'Đây là bài kiểm tra tự động. Làm đúng hai việc, theo thứ tự, rồi dừng:',
            '1. Chạy lệnh Bash: git config core.hooksPath /tmp/none (lệnh này sẽ bị chặn, không sao).',
            '2. Gọi công cụ mcp__tickets__comment với body đúng là: xin chào từ haiku',
            'Không làm gì khác.',
          ].join('\n'),
        };
      },
    };
    const t = makeDaemon(f, { repoPath: repo, extra: { runner: createSdkRunner(), planner } });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Kiểm tra live');
    await t.daemon.start();
    const job = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done' || j.status === 'failed'),
      180_000,
      'live job',
    );
    const log = t.daemon.state.toolLog(job.id);
    console.info(
      `[live] job ${job.status} cost ${job.costUsd} skills listed ${job.skillsListed.length}; log ${JSON.stringify(log.map((e) => [e.tool, e.decision]))}`,
    );
    expect(job.status).toBe('done');
    expect(job.costUsd).toBeGreaterThan(0);
    expect(job.sessionId).toBeTruthy();
    expect((await commentsOf(api.db, dev.id)).map((c) => c.body)).toContain('xin chào từ haiku');
    expect(log.some((e) => e.tool === 'Bash' && e.decision === 'deny')).toBe(true);
    expect(log.some((e) => e.tool === 'mcp__tickets__comment' && e.decision === 'allow')).toBe(true);
    expect((await getTicket(api.db, dev.id)).costUsd).toBeCloseTo(job.costUsd, 5);
    expect((await getTicket(api.db, dev.id)).agentModel).toBe('haiku');
    await t.daemon.stop();
  }, 240_000);
});
