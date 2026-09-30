import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type SDKMessage, query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { detectSharedPaths, ensureWorktree } from '../src/git/worktree-manager.js';
import { loginProbe } from '../src/health/checks/claude.js';
import { type AgentRunResult, agentEnv, createSdkRunner, RunControl } from '../src/runner/agent-runner.js';
import type { RolePlanner } from '../src/runner/job-runner.js';
import { probeInventory } from '../src/skills/skill-inventory.js';
import { commentsOf, devTicket, fixture, getTicket, pmTask, useApi } from './helpers/api.js';
import { makeDaemon, waitFor } from './helpers/daemon.js';
import { makeRepo, tempDir, writeFiles } from './helpers/git.js';

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

  it('a background command outlives the turn that started it, and its notification starts the next turn', async () => {
    const { run, cwd, marker, results, taskSets, notifications, markerAtFirstResult } = await backgroundRun([
      'Đây là bài kiểm tra tự động. Làm đúng các việc sau:',
      '1. Gọi công cụ Bash với run_in_background: true và command đúng là: sleep 12 && echo xong > done.txt',
      '2. Ngay sau đó kết thúc lượt, chỉ trả lời "đang chờ". Không gọi sleep, không chờ, không kiểm tra lệnh.',
      '3. Khi được thông báo lệnh nền đã xong, chạy lệnh Bash: cat done.txt > seen.txt rồi trả lời "đã nhận".',
    ]);
    const first = results[0];
    const last = results.at(-1);
    if (!first || !last) throw new Error('the run produced no result message');
    const markerAfterFirstResultMs = existsSync(marker) ? statSync(marker).mtimeMs - first.at : null;
    console.info(
      `[live] background run: ${describeRun(run, results, taskSets, notifications)}; done.txt written ${markerAfterFirstResultMs} ms after the first result`,
    );

    expect(run).toMatchObject({ isError: false, resultSubtype: 'success', aborted: false });
    // The first turn ended while the command was still running, and the command was in the live task set.
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(markerAtFirstResult).toBe(false);
    expect(taskSets.some((set) => set.at <= first.at && set.tasks.length > 0)).toBe(true);
    // It survived well past the 5 seconds the runtime grants once the input is closed.
    expect(markerAfterFirstResultMs).toBeGreaterThan(5_000);
    // The runtime notified the agent, which then ran the turn the prompt asked for.
    expect(notifications.some((entry) => entry.at > first.at && entry.status === 'completed')).toBe(true);
    expect(readFileSync(join(cwd, 'seen.txt'), 'utf8').trim()).toBe('xong');
    // A clean end: nothing left to stop, no reminder; the run carries every turn.
    expect(run.backgroundTasksLeft).toEqual([]);
    expect(run.reminded).toBe(false);
    expect(run.totalCostUsd).toBe(last.message.total_cost_usd);
    expect(run.totalCostUsd).toBeGreaterThan(first.message.total_cost_usd);
    expect(run.capture.numTurns).toBe(results.reduce((sum, entry) => sum + entry.message.num_turns, 0));
    expect(run.capture.durationMs).toBe(results.reduce((sum, entry) => sum + entry.message.duration_ms, 0));
  }, 240_000);

  it('a background command that ends while the agent writes the last answer of its turn still gets its notification turn', async () => {
    const { run, cwd, results, taskSets, notifications } = await backgroundRun([
      'Đây là bài kiểm tra tự động. Làm đúng các việc sau, theo thứ tự:',
      '1. Gọi công cụ Bash với run_in_background: true và command đúng là: sleep 3 && echo xong > done.txt',
      '2. Ngay sau đó, KHÔNG gọi thêm công cụ nào, viết một bài văn khoảng 700 từ về lịch sử cây lúa nước rồi kết thúc lượt.',
      '3. Chỉ khi được thông báo lệnh nền đã xong (ở một lượt sau), chạy lệnh Bash: cat done.txt > seen.txt rồi trả lời "đã nhận".',
    ]);
    const first = results[0];
    if (!first) throw new Error('the run produced no result message');
    // Whether the run hit the case at all depends on the model's pace; the outcome must hold either way.
    const endedBeforeFirstResult = taskSets.some((set) => set.at <= first.at && set.tasks.length === 0);
    console.info(
      `[live] late notification run (task ended before the first result: ${endedBeforeFirstResult}): ${describeRun(run, results, taskSets, notifications)}`,
    );
    expect(run).toMatchObject({ isError: false, resultSubtype: 'success', aborted: false });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(readFileSync(join(cwd, 'seen.txt'), 'utf8').trim()).toBe('xong');
    expect(run.backgroundTasksLeft).toEqual([]);
    expect(run.reminded).toBe(false);
  }, 240_000);
});

type ResultMessage = Extract<SDKMessage, { type: 'result' }>;
interface Timed<T> {
  at: number;
  message: T;
}
interface TaskSet {
  at: number;
  tasks: Record<string, unknown>[];
}
interface Notification {
  at: number;
  status: string;
}

/**
 * One haiku run of the SDK runner in a temp dir with only Bash allowed, with every message the runner reads
 * recorded together with its arrival time. `done.txt` is the file the prompt's background command writes.
 */
async function backgroundRun(prompt: string[]) {
  const cwd = tempDir('crew-live-bg-');
  const marker = join(cwd, 'done.txt');
  const seen: Timed<SDKMessage>[] = [];
  let markerAtFirstResult: boolean | null = null;
  const tapped: typeof sdkQuery = (params) => {
    const q = sdkQuery(params);
    const tap: typeof q = new Proxy(q, {
      get(target, property) {
        if (property === Symbol.asyncIterator) return () => tap;
        if (property === 'next') {
          return async (...args: Parameters<typeof q.next>) => {
            const step = await target.next(...args);
            if (!step.done) {
              if (step.value.type === 'result' && markerAtFirstResult === null)
                markerAtFirstResult = existsSync(marker);
              seen.push({ at: Date.now(), message: step.value });
            }
            return step;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return tap;
  };
  const run = await createSdkRunner({ query: tapped })({
    jobId: 'live-bg',
    ticketId: 'live-bg',
    ticketKey: 'LIVE-BG',
    role: 'dev',
    kind: 'agent',
    cwd,
    model: 'haiku',
    effort: 'low',
    prompt: prompt.join('\n'),
    allowedTools: ['Bash'],
    abortSignal: new AbortController().signal,
    env: agentEnv(process.env, {}),
    mcpServers: {},
    ticketTools: [],
    preToolUse: async () => ({}),
    control: new RunControl(),
    backgroundWaitMs: 120_000,
  });
  const results = seen.filter((entry): entry is Timed<ResultMessage> => entry.message.type === 'result');
  const system = (subtype: string) =>
    seen.filter((entry) => entry.message.type === 'system' && (entry.message.subtype as string) === subtype);
  const taskSets: TaskSet[] = system('background_tasks_changed').map((entry) => ({
    at: entry.at,
    tasks: (entry.message as unknown as { tasks: Record<string, unknown>[] }).tasks,
  }));
  const notifications: Notification[] = system('task_notification').map((entry) => ({
    at: entry.at,
    status: (entry.message as unknown as { status: string }).status,
  }));
  return {
    run,
    cwd,
    marker,
    results,
    taskSets,
    notifications,
    markerAtFirstResult: markerAtFirstResult as boolean | null,
  };
}

/** The numbers of every result next to what the runner reported for the whole run. */
function describeRun(
  run: AgentRunResult,
  results: Timed<ResultMessage>[],
  taskSets: TaskSet[],
  notifications: Notification[],
): string {
  return `${results.length} results ${JSON.stringify(
    results.map((entry) => ({
      subtype: entry.message.subtype,
      total_cost_usd: entry.message.total_cost_usd,
      num_turns: entry.message.num_turns,
      duration_ms: entry.message.duration_ms,
      duration_api_ms: entry.message.duration_api_ms,
      modelCostUsd: Object.values(entry.message.modelUsage).map((usage) => usage.costUSD),
    })),
  )}; task sets ${JSON.stringify(taskSets.map((set) => set.tasks))}; notifications ${JSON.stringify(
    notifications.map((entry) => entry.status),
  )}; run ${JSON.stringify({
    totalCostUsd: run.totalCostUsd,
    numTurns: run.capture.numTurns,
    durationMs: run.capture.durationMs,
    reminded: run.reminded,
    backgroundTasksLeft: run.backgroundTasksLeft,
  })}`;
}
