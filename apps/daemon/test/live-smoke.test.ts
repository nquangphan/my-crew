import { describe, expect, it } from 'vitest';
import { detectSharedPaths, ensureWorktree } from '../src/git/worktree-manager.js';
import { loginProbe } from '../src/health/checks/claude.js';
import { agentEnv, createSdkRunner } from '../src/runner/agent-runner.js';
import type { RolePlanner } from '../src/runner/job-runner.js';
import { probeInventory } from '../src/skills/skill-inventory.js';
import { commentsOf, devTicket, fixture, getTicket, pmTask, useApi } from './helpers/api.js';
import { makeDaemon, waitFor } from './helpers/daemon.js';
import { makeRepo, writeFiles } from './helpers/git.js';
import { ownerDescribes, stripesPng, uploadImage } from './helpers/images.js';

/**
 * Real Agent SDK runs on the owner's subscription login. Opt in with CREW_LIVE_AGENT_TESTS=1; the paid
 * part is two short haiku runs plus the login probe.
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

  it('a haiku job sees an image pasted into its ticket and can Read the downloaded file', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const planner: RolePlanner = {
      async plan() {
        return {
          model: 'haiku',
          effort: 'low',
          resumeSessionId: null,
          prompt: [
            'Đây là bài kiểm tra tự động. Ảnh gửi kèm tin nhắn này gồm bốn sọc dọc, mỗi sọc một màu khác nhau.',
            'Ghi màu từng sọc từ trái sang phải bằng một chữ cái: R = đỏ, G = xanh lá, B = xanh dương, Y = vàng (ví dụ GYRB).',
            'Làm đúng bốn việc, theo thứ tự, rồi dừng:',
            '1. Chưa đọc file nào: gọi công cụ mcp__tickets__comment với body đúng là: màu trong ảnh là <bốn chữ cái theo ảnh gửi kèm>',
            '2. Dùng công cụ Read đọc file ảnh theo đúng đường dẫn ghi trong mục "Ảnh đính kèm trong ticket" bên dưới.',
            '3. Gọi mcp__tickets__comment với body đúng là: đọc file được <bốn chữ cái theo file vừa đọc> (hoặc: đọc file lỗi, nếu Read thất bại).',
            '4. Gọi mcp__tickets__handoff_docs với summaryMd đúng là: xong',
            'Không làm gì khác.',
          ].join('\n'),
        };
      },
    };
    const t = makeDaemon(f, { repoPath: repo, extra: { runner: createSdkRunner(), planner } });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Đọc ảnh live');
    // The order of the stripes exists only in the image: never in the prompt or the ticket text.
    const stripes = ['R', 'G', 'B', 'Y']
      .map((letter) => ({ letter, at: Math.random() }))
      .sort((a, b) => a.at - b.at)
      .map((entry) => entry.letter)
      .join('');
    const image = await uploadImage(f, dev.id, stripesPng(stripes));
    await ownerDescribes(f, dev.id, `Ảnh chụp màn hình: ${image.markdown}`);
    await t.daemon.start();
    const job = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done' || j.status === 'failed'),
      180_000,
      'live image job',
    );
    const log = t.daemon.state.toolLog(job.id);
    const bodies = (await commentsOf(api.db, dev.id)).map((c) => c.body);
    console.info(
      `[live] image job ${job.status} cost ${job.costUsd}; stripes ${stripes}; comments ${JSON.stringify(bodies)}; log ${JSON.stringify(log.map((e) => [e.tool, e.decision, e.target]))}`,
    );
    expect(job.status).toBe('done');
    expect(job.imagesSent).toEqual([image.id]);
    // The image block reached the model: it named the stripes before it read any file.
    const firstComment = log.findIndex((e) => e.tool === 'mcp__tickets__comment' && e.decision === 'allow');
    const read = log.findIndex((e) => e.tool === 'Read' && e.target?.endsWith(`${image.id}.png`));
    expect(firstComment).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(firstComment);
    expect(bodies[0]).toContain(`màu trong ảnh là ${stripes}`);
    // The file listed in the prompt is readable during the run.
    expect(log[read]?.decision).toBe('allow');
    expect(bodies.some((body) => body.includes(`đọc file được ${stripes}`))).toBe(true);
    // A tool that ends the run still interrupts the turn of a run that started with images, and its cost is booked.
    expect(job.handoff).toMatchObject({ summaryMd: 'xong' });
    expect(job.costUsd).toBeGreaterThan(0);
    expect((await getTicket(api.db, dev.id)).costUsd).toBeCloseTo(job.costUsd, 5);
    await t.daemon.stop();
  }, 240_000);
});
