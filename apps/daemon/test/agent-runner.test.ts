import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type AgentRunResult,
  agentEnv,
  createSdkRunner,
  type RunAgentOptions,
  RunControl,
  type SdkRunnerOptions,
} from '../src/runner/agent-runner.js';
import type { RunImage } from '../src/runner/ticket-images.js';
import { sleep, waitFor } from './helpers/daemon.js';
import { tinyPng } from './helpers/images.js';

/** Polls every few ms (the shared `waitFor` polls too coarsely for the short ceilings used here). */
async function until(check: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}

/** A fake SDK `query` that records its options and replays messages. */
function fakeQuery(messages: (options: Options) => SDKMessage[]) {
  const calls: { prompt: unknown; options: Options }[] = [];
  let interrupted = 0;
  const query = ((params: { prompt: unknown; options: Options }) => {
    calls.push(params);
    const list = messages(params.options);
    const iterator = (async function* () {
      for (const message of list) yield message;
    })();
    return Object.assign(iterator, {
      interrupt: async () => {
        interrupted += 1;
        return undefined;
      },
      close: () => {},
    }) as unknown as Query;
  }) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;
  return { query, calls, interrupted: () => interrupted };
}

const textOf = (message: SDKUserMessage) => String((message.message as { content: unknown }).content);

/**
 * A fake SDK session the test drives message by message. Like the runtime, it reads the prompt stream, and
 * its message stream ends when that input closes (unless `staysOpen`). `events` lists, in order, what the
 * runner did to the session.
 */
function liveQuery(settings: { staysOpen?: boolean; failStop?: string[] } = {}) {
  const calls: { prompt: unknown; options: Options }[] = [];
  const events: string[] = [];
  const received: string[] = [];
  /** The input messages as sent (content blocks included). */
  const messages: SDKUserMessage[] = [];
  const pending: SDKMessage[] = [];
  let ended = false;
  let failure: Error | null = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const query = ((params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    calls.push(params);
    void (async () => {
      for await (const message of params.prompt) {
        messages.push(message);
        received.push(textOf(message));
        events.push(`input:${received.length}`);
      }
      events.push('input-closed');
      if (!settings.staysOpen) ended = true;
      notify();
    })();
    const onAbort = () => {
      events.push('aborted');
      failure = new Error('aborted');
      notify();
    };
    // Like the SDK: an abort, also one that came before the query started, makes the message stream throw.
    const signal = params.options.abortController?.signal;
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort);
    const iterator = (async function* () {
      for (;;) {
        if (failure) throw failure;
        const next = pending.shift();
        if (next) yield next;
        else if (ended) return;
        else
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
      }
    })();
    return Object.assign(iterator, {
      interrupt: async () => {
        events.push('interrupt');
        return undefined;
      },
      stopTask: async (taskId: string) => {
        events.push(`stop:${taskId}`);
        if (settings.failStop?.includes(taskId)) throw new Error(`no task ${taskId}`);
      },
      close: () => {
        events.push('close');
        ended = true;
        notify();
      },
    }) as unknown as Query;
  }) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;
  return {
    query,
    calls,
    events,
    received,
    messages,
    emit(...messages: SDKMessage[]) {
      pending.push(...messages);
      notify();
    },
    /** The process goes away on its own: the message stream ends. */
    die() {
      ended = true;
      notify();
    },
  };
}

/** Starts a run on a live fake session; `settled()` tells whether the run has returned. */
function startRun(
  fake: ReturnType<typeof liveQuery>,
  over: Partial<RunAgentOptions> = {},
  runner: Omit<SdkRunnerOptions, 'query'> = {},
) {
  let done = false;
  const run: Promise<AgentRunResult> = createSdkRunner({ ...runner, query: fake.query })(
    options(over),
  ).finally(() => {
    done = true;
  });
  return { run, settled: () => done };
}

const backgroundTasks = (...ids: string[]) =>
  ({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: ids.map((id) => ({ task_id: id, task_type: 'local_bash', description: `lệnh ${id}` })),
    session_id: 'sess-1',
  }) as unknown as SDKMessage;

const say = (id: string, text: string) =>
  ({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { id, content: [{ type: 'text', text }] },
  }) as unknown as SDKMessage;

const init = (over: Record<string, unknown> = {}) =>
  ({
    type: 'system',
    subtype: 'init',
    session_id: 'sess-1',
    skills: ['ak:scout', 'shop-domain'],
    mcp_servers: [
      { name: 'tickets', status: 'connected' },
      { name: 'playwright', status: 'connected' },
    ],
    model: 'claude-haiku',
    apiKeySource: 'none',
    claude_code_version: '2.1.283',
    ...over,
  }) as unknown as SDKMessage;

const result = (over: Record<string, unknown> = {}) =>
  ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'sess-1',
    total_cost_usd: 0.42,
    modelUsage: { 'claude-haiku': { costUSD: 0.42, inputTokens: 10, outputTokens: 5 } },
    errors: [],
    ...over,
  }) as unknown as SDKMessage;

function options(over: Partial<RunAgentOptions> = {}): RunAgentOptions {
  return {
    jobId: 'job-1',
    ticketId: 't-1',
    ticketKey: 'WEB-1',
    role: 'dev',
    kind: 'agent',
    cwd: '/work',
    model: 'sonnet',
    effort: 'high',
    prompt: '/ak:cook làm việc',
    allowedTools: ['Read', 'mcp__tickets__comment', 'mcp__playwright__*'],
    abortSignal: new AbortController().signal,
    env: agentEnv(
      { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant-should-not-pass' },
      { CREW_JOB_ID: 'job-1', TMPDIR: '/t' },
    ),
    mcpServers: {},
    ticketTools: [],
    preToolUse: async () => ({}),
    enabledMcpjsonServers: ['maestro'],
    control: new RunControl(),
    ...over,
  };
}

const cleanups: (() => void)[] = [];
afterAll(() => {
  for (const cleanup of cleanups) cleanup();
});

describe('SDK agent runner', () => {
  it('runs query() with setting sources, dontAsk, the allowlist, the guard hook and a clean env', async () => {
    const fake = fakeQuery(() => [init(), result()]);
    const seen: string[] = [];
    const run = await createSdkRunner({ query: fake.query })(
      options({ onInit: (info) => seen.push(info.sessionId) }),
    );
    const sdk = fake.calls[0]?.options as Options;
    expect(sdk.settingSources).toEqual(['user', 'project', 'local']);
    expect(sdk.permissionMode).toBe('dontAsk');
    expect(sdk.allowedTools).toEqual(['Read', 'mcp__tickets__comment', 'mcp__playwright__*']);
    expect(sdk.hooks?.PreToolUse?.[0]?.hooks).toHaveLength(1);
    expect(sdk.env).toMatchObject({
      CREW_JOB_ID: 'job-1',
      TMPDIR: '/t',
      CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2',
    });
    expect(sdk.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(sdk.settings).toEqual({ enabledMcpjsonServers: ['maestro'] });
    expect(sdk).not.toHaveProperty('disallowedTools');
    expect(sdk.model).toBe('sonnet');
    expect(sdk.effort).toBe('high');
    expect(typeof sdk.spawnClaudeCodeProcess).toBe('function');
    // The prompt is a stream the daemon drives; its first message is the run's prompt.
    const prompt = fake.calls[0]?.prompt as AsyncIterable<SDKUserMessage>;
    expect(typeof prompt).not.toBe('string');
    const first = await prompt[Symbol.asyncIterator]().next();
    expect(first.value).toEqual({
      type: 'user',
      message: { role: 'user', content: '/ak:cook làm việc' },
      parent_tool_use_id: null,
    });
    expect(run).toMatchObject({
      sessionId: 'sess-1',
      resultSubtype: 'success',
      isError: false,
      totalCostUsd: 0.42,
      skillsListed: ['ak:scout', 'shop-domain'],
      slashCommands: ['ak:cook'],
      apiKeySource: 'none',
      claudeCodeVersion: '2.1.283',
    });
    expect(seen).toEqual(['sess-1']);
  });

  it('sends the prompt as plain text when the run has no images', async () => {
    const fake = fakeQuery(() => [init(), result()]);
    await createSdkRunner({ query: fake.query })(options());
    await createSdkRunner({ query: fake.query })(options({ images: [] }));
    for (const call of fake.calls) {
      // Still the stream the daemon drives (closed once the run ended), with one plain-text message.
      expect(typeof call.prompt).not.toBe('string');
      const sent: SDKUserMessage[] = [];
      for await (const message of call.prompt as AsyncIterable<SDKUserMessage>) sent.push(message);
      expect(sent).toEqual([
        { type: 'user', message: { role: 'user', content: '/ak:cook làm việc' }, parent_tool_use_id: null },
      ]);
    }
  });

  it('sends the prompt text and the images as base64 blocks in one first message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crew-runner-images-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const png = tinyPng(5);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg')]);
    writeFileSync(join(dir, 'a.png'), png);
    writeFileSync(join(dir, 'b.jpg'), jpeg);
    const image = (
      index: number,
      file: string,
      mediaType: RunImage['mediaType'],
      source: string,
    ): RunImage => ({
      index,
      id: `id-${index}`,
      source,
      path: join(dir, file),
      mediaType,
      sizeBytes: 1,
    });
    const fake = fakeQuery(() => [init(), result()]);
    const control = new RunControl();
    const run = await createSdkRunner({ query: fake.query })(
      options({
        control,
        resumeSessionId: 'sess-0',
        maxBudgetUsd: 2,
        images: [
          image(1, 'a.png', 'image/png', 'mô tả ticket WEB-1'),
          image(3, 'b.jpg', 'image/jpeg', 'bình luận thứ 2 của ticket WEB-1 (chủ dự án viết)'),
          image(4, 'gone.png', 'image/png', 'mô tả ticket WEB-1'),
        ],
      }),
    );
    // The run ended without background tasks, so the daemon closed the stream after its single message.
    const sent: SDKUserMessage[] = [];
    const first = fake.calls[0]?.prompt ?? [];
    for await (const message of first as AsyncIterable<SDKUserMessage>) sent.push(message);
    expect(sent).toEqual([
      {
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '/ak:cook làm việc' },
            { type: 'text', text: 'Ảnh 1 (mô tả ticket WEB-1):' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
            },
            { type: 'text', text: 'Ảnh 3 (bình luận thứ 2 của ticket WEB-1 (chủ dự án viết)):' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') },
            },
            // A file that vanished is named, not sent: the run goes on.
            { type: 'text', text: 'Ảnh 4 (mô tả ticket WEB-1): không đọc được file ảnh.' },
          ],
        },
      },
    ]);
    // Everything else about the run is as without images.
    const sdk = fake.calls[0]?.options as Options;
    expect(sdk).toMatchObject({
      resume: 'sess-0',
      maxBudgetUsd: 2,
      permissionMode: 'dontAsk',
      allowedTools: ['Read', 'mcp__tickets__comment', 'mcp__playwright__*'],
      settingSources: ['user', 'project', 'local'],
    });
    expect(sdk.hooks?.PreToolUse?.[0]?.hooks).toHaveLength(1);
    expect(run).toMatchObject({
      sessionId: 'sess-1',
      resultSubtype: 'success',
      isError: false,
      totalCostUsd: 0.42,
      slashCommands: ['ak:cook'],
    });
  });

  it('a run with images still ends its turn after a tool asked to end the run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crew-runner-images-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'a.png'), tinyPng(1));
    const control = new RunControl();
    const fake = fakeQuery(() => {
      control.requestEnd('handoff_docs');
      return [
        init(),
        { type: 'assistant', message: { content: [] } } as unknown as SDKMessage,
        result({ subtype: 'error_during_execution', is_error: true, errors: ['interrupted'] }),
      ];
    });
    const run = await createSdkRunner({ query: fake.query })(
      options({
        control,
        images: [
          {
            index: 1,
            id: 'a',
            source: 'mô tả',
            path: join(dir, 'a.png'),
            mediaType: 'image/png',
            sizeBytes: 1,
          },
        ],
      }),
    );
    expect(fake.interrupted()).toBe(1);
    expect(run).toMatchObject({ endedBy: 'handoff_docs', isError: false, totalCostUsd: 0.42 });
  });

  it('removes a disabled server from the session: its tools are disallowed and the server denied by name', async () => {
    const fake = fakeQuery(() => [init(), result()]);
    await createSdkRunner({ query: fake.query })(
      options({
        disallowedTools: ['mcp__plugin_engineering_asana__*'],
        deniedMcpServers: ['plugin:engineering:asana'],
      }),
    );
    const sdk = fake.calls[0]?.options as Options;
    expect(sdk.disallowedTools).toEqual(['mcp__plugin_engineering_asana__*']);
    expect(sdk.settings).toEqual({
      enabledMcpjsonServers: ['maestro'],
      deniedMcpServers: [{ serverName: 'plugin:engineering:asana' }],
    });
  });

  it('passes resume and the budget, and reports the last API error class', async () => {
    const fake = fakeQuery(() => [
      init(),
      {
        type: 'system',
        subtype: 'api_retry',
        error: 'rate_limit',
        attempt: 10,
        max_retries: 10,
      } as unknown as SDKMessage,
      result({ subtype: 'error_during_execution', is_error: true, errors: ['429'], total_cost_usd: 0.1 }),
    ]);
    const run = await createSdkRunner({ query: fake.query })(
      options({ resumeSessionId: 'sess-0', maxBudgetUsd: 2 }),
    );
    const sdk = fake.calls[0]?.options as Options;
    expect(sdk.resume).toBe('sess-0');
    expect(sdk.maxBudgetUsd).toBe(2);
    expect(run).toMatchObject({
      isError: true,
      apiError: 'rate_limit',
      resultSubtype: 'error_during_execution',
      errors: ['429'],
    });
  });

  it('interrupts the turn after a tool asked to end the run, and treats that as a normal end', async () => {
    const control = new RunControl();
    const fake = fakeQuery(() => {
      control.requestEnd('ask_owner');
      return [
        init(),
        { type: 'assistant', message: { content: [] } } as unknown as SDKMessage,
        result({ subtype: 'error_during_execution', is_error: true, errors: ['interrupted'] }),
      ];
    });
    const run = await createSdkRunner({ query: fake.query })(options({ control }));
    expect(fake.interrupted()).toBe(1);
    expect(run).toMatchObject({ endedBy: 'ask_owner', isError: false });
  });

  it('captures turns, duration, compactions, the last main-agent message and the last five tool calls', async () => {
    const assistant = (id: string, content: unknown[], parent: string | null = null) =>
      ({ type: 'assistant', parent_tool_use_id: parent, message: { id, content } }) as unknown as SDKMessage;
    const tools = ['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) =>
      assistant(`m${index}`, [
        { type: 'tool_use', name: 'Read', input: { file_path: `/work/src/${name}.ts` } },
      ]),
    );
    const fake = fakeQuery(() => [
      init(),
      assistant('m-early', [{ type: 'text', text: 'Bắt đầu.' }]),
      ...tools,
      assistant('m-bash', [{ type: 'tool_use', name: 'Bash', input: { command: 'echo $SECRET' } }]),
      {
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: { trigger: 'auto', pre_tokens: 1 },
      } as unknown as SDKMessage,
      assistant('m-last', [{ type: 'text', text: 'Dòng một.' }]),
      assistant('m-last', [{ type: 'text', text: 'Dòng hai.' }]),
      assistant('m-sub', [{ type: 'text', text: 'từ subagent' }], 'toolu_1'),
      result({ num_turns: 42, duration_ms: 125_000 }),
    ]);
    const out = await createSdkRunner({ query: fake.query })(options());
    expect(out.capture).toEqual({
      numTurns: 42,
      durationMs: 125_000,
      compactions: 1,
      lastMessage: 'Dòng một.\n\nDòng hai.',
      lastTools: [
        { tool: 'Read', target: 'src/c.ts' },
        { tool: 'Read', target: 'src/d.ts' },
        { tool: 'Read', target: 'src/e.ts' },
        { tool: 'Read', target: 'src/f.ts' },
        { tool: 'Bash', target: null },
      ],
    });
  });

  it('marks a run without a result message as an error', async () => {
    const fake = fakeQuery(() => [init()]);
    const run = await createSdkRunner({ query: fake.query })(options());
    expect(run.isError).toBe(true);
  });

  describe('background tasks', () => {
    it('closes the input and ends the run when a result arrives with no background task', async () => {
      const fake = liveQuery();
      const { run, settled } = startRun(fake);
      fake.emit(init());
      await waitFor(() => fake.received.length === 1, 2_000, 'the prompt');
      expect(fake.received).toEqual(['/ak:cook làm việc']);
      await sleep(20);
      // The input stays open until the turn's result.
      expect(fake.events).toEqual(['input:1']);
      expect(settled()).toBe(false);
      fake.emit(result({ num_turns: 3, duration_ms: 900 }));
      const out = await run;
      expect(fake.events).toEqual(['input:1', 'input-closed', 'close']);
      expect(out).toMatchObject({
        resultSubtype: 'success',
        isError: false,
        aborted: false,
        totalCostUsd: 0.42,
        backgroundTasksLeft: [],
        reminded: false,
      });
      expect(out.capture).toMatchObject({ numTurns: 3, durationMs: 900 });
    });

    it('keeps the input open while a background task is alive, then ends after the next turn and sums every turn', async () => {
      const fake = liveQuery();
      const inits: string[] = [];
      const { run, settled } = startRun(fake, { onInit: (info) => inits.push(info.sessionId) });
      fake.emit(
        init(),
        {
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            id: 'm1',
            content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/work/src/a.ts' } }],
          },
        } as unknown as SDKMessage,
        backgroundTasks('t1'),
        say('m2', 'Đang chờ.'),
        result({
          total_cost_usd: 0.1,
          num_turns: 2,
          duration_ms: 1_000,
          modelUsage: { 'claude-haiku': { costUSD: 0.1, inputTokens: 10, outputTokens: 5 } },
        }),
      );
      await sleep(80);
      expect(settled()).toBe(false);
      expect(fake.events).toEqual(['input:1']);

      // The runtime delivers the notification: the task leaves the set and the agent runs another turn.
      fake.emit(
        backgroundTasks(),
        init(),
        say('m3', 'Đã nhận.'),
        result({
          total_cost_usd: 0.25,
          num_turns: 3,
          duration_ms: 500,
          modelUsage: { 'claude-haiku': { costUSD: 0.25, inputTokens: 30, outputTokens: 12 } },
        }),
      );
      const out = await run;
      expect(fake.events).toEqual(['input:1', 'input-closed', 'close']);
      expect(fake.received).toHaveLength(1);
      // `total_cost_usd` and `modelUsage` are cumulative; `num_turns` and `duration_ms` count one turn each.
      expect(out).toMatchObject({
        resultSubtype: 'success',
        isError: false,
        totalCostUsd: 0.25,
        modelUsage: { 'claude-haiku': { costUSD: 0.25, inputTokens: 30, outputTokens: 12 } },
        backgroundTasksLeft: [],
        reminded: false,
      });
      expect(out.capture).toEqual({
        numTurns: 5,
        durationMs: 1_500,
        compactions: 0,
        lastMessage: 'Đã nhận.',
        lastTools: [{ tool: 'Read', target: 'src/a.ts' }],
      });
      // The runtime sends `init` for every turn; the run reports it once.
      expect(inits).toEqual(['sess-1']);
    });

    it('a run with images sends them in the first message of the open stream and keeps it open while a background task is alive', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'crew-runner-images-'));
      cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
      const png = tinyPng(3);
      writeFileSync(join(dir, 'a.png'), png);
      const fake = liveQuery();
      const { run, settled } = startRun(fake, {
        images: [
          {
            index: 1,
            id: 'a',
            source: 'mô tả ticket WEB-1',
            path: join(dir, 'a.png'),
            mediaType: 'image/png',
            sizeBytes: png.length,
          },
          {
            index: 2,
            id: 'b',
            source: 'mô tả ticket WEB-1',
            path: join(dir, 'gone.png'),
            mediaType: 'image/png',
            sizeBytes: 1,
          },
        ],
      });
      fake.emit(init(), backgroundTasks('t1'), say('m1', 'Đang chờ.'), result({ total_cost_usd: 0.1 }));
      await waitFor(() => fake.messages.length === 1, 2_000, 'the first message');
      // `query()` got the daemon's stream, not a one-message iterable that ends.
      const prompt = fake.calls[0]?.prompt;
      expect(typeof prompt).not.toBe('string');
      expect(typeof (prompt as AsyncIterable<SDKUserMessage>)[Symbol.asyncIterator]).toBe('function');
      expect(fake.messages[0]).toEqual({
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '/ak:cook làm việc' },
            { type: 'text', text: 'Ảnh 1 (mô tả ticket WEB-1):' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
            },
            { type: 'text', text: 'Ảnh 2 (mô tả ticket WEB-1): không đọc được file ảnh.' },
          ],
        },
      });
      // The turn ended with the task alive: the input stays open.
      await sleep(80);
      expect(settled()).toBe(false);
      expect(fake.events).toEqual(['input:1']);
      // The notification turn empties the set; only then does the input close.
      fake.emit(backgroundTasks(), init(), say('m2', 'Đã nhận.'), result({ total_cost_usd: 0.3 }));
      const out = await run;
      expect(fake.events).toEqual(['input:1', 'input-closed', 'close']);
      expect(fake.messages).toHaveLength(1);
      expect(out).toMatchObject({
        isError: false,
        resultSubtype: 'success',
        totalCostUsd: 0.3,
        backgroundTasksLeft: [],
        reminded: false,
        slashCommands: ['ak:cook'],
      });
    });

    it('keeps the input open for the notification of a task that ended during the last answer of the turn', async () => {
      const fake = liveQuery();
      const { run, settled } = startRun(fake);
      // The live set is already empty when the turn's result arrives.
      fake.emit(
        init(),
        backgroundTasks('t1'),
        backgroundTasks(),
        say('m1', 'Đang chờ.'),
        result({ total_cost_usd: 0.1, num_turns: 2, duration_ms: 1_000 }),
      );
      await sleep(150);
      expect(settled()).toBe(false);
      expect(fake.events).toEqual(['input:1']);
      // The runtime starts the notification turn right after the result.
      fake.emit(
        init(),
        say('m2', 'Đã nhận.'),
        result({ total_cost_usd: 0.2, num_turns: 1, duration_ms: 300 }),
      );
      const out = await run;
      expect(fake.events).toEqual(['input:1', 'input-closed', 'close']);
      expect(out).toMatchObject({
        isError: false,
        totalCostUsd: 0.2,
        backgroundTasksLeft: [],
        reminded: false,
      });
      expect(out.capture).toMatchObject({ numTurns: 3, durationMs: 1_300, lastMessage: 'Đã nhận.' });
    });

    it('two tasks end at the same moment: the empty result does not close the session', async () => {
      const fake = liveQuery();
      const { run, settled } = startRun(fake, {}, { backgroundSettleMs: 300 });
      fake.emit(
        init(),
        backgroundTasks('a', 'b'),
        say('m1', 'Đang chờ.'),
        result({ total_cost_usd: 0.1, num_turns: 3, duration_ms: 1_000 }),
      );
      await sleep(80);
      // Like runtime 2.1.283: a turn that runs nothing, then the turn that carries the notifications.
      fake.emit(
        backgroundTasks('b'),
        backgroundTasks(),
        init(),
        result({ total_cost_usd: 0.1, num_turns: 0, duration_ms: 1 }),
      );
      await sleep(80);
      expect(settled()).toBe(false);
      expect(fake.events).toEqual(['input:1']);
      fake.emit(
        init(),
        say('m2', 'Đã nhận.'),
        result({ total_cost_usd: 0.2, num_turns: 3, duration_ms: 500 }),
      );
      const out = await run;
      expect(fake.events).toEqual(['input:1', 'input-closed', 'close']);
      expect(out).toMatchObject({
        resultSubtype: 'success',
        isError: false,
        aborted: false,
        totalCostUsd: 0.2,
        backgroundTasksLeft: [],
        reminded: false,
      });
      expect(out.capture).toMatchObject({ numTurns: 6, durationMs: 1_501, lastMessage: 'Đã nhận.' });
    });

    it('two tasks end at the same moment: a separate turn for the second notification still runs', async () => {
      const fake = liveQuery();
      const { run, settled } = startRun(fake, {}, { backgroundSettleMs: 300 });
      fake.emit(init(), backgroundTasks('a', 'b'), result({ total_cost_usd: 0.1, num_turns: 3 }));
      await sleep(80);
      fake.emit(
        backgroundTasks('b'),
        backgroundTasks(),
        init(),
        result({ total_cost_usd: 0.1, num_turns: 0 }),
        init(),
        say('m2', 'Đã nhận a.'),
        result({ total_cost_usd: 0.2, num_turns: 2 }),
      );
      // The session stays open after the first notification turn: one more turn may still be owed.
      await sleep(100);
      expect(settled()).toBe(false);
      fake.emit(init(), say('m3', 'Đã nhận b.'), result({ total_cost_usd: 0.3, num_turns: 2 }));
      const out = await run;
      expect(fake.events).toEqual(['input:1', 'input-closed', 'close']);
      expect(out).toMatchObject({
        isError: false,
        totalCostUsd: 0.3,
        backgroundTasksLeft: [],
        reminded: false,
      });
      expect(out.capture).toMatchObject({ numTurns: 7, lastMessage: 'Đã nhận b.' });
    });

    it('closes cleanly after the settle time when no turn follows an empty result', async () => {
      const fake = liveQuery();
      const { run, settled } = startRun(fake, {}, { backgroundSettleMs: 200 });
      fake.emit(init(), backgroundTasks('a', 'b'), result({ total_cost_usd: 0.1, num_turns: 3 }));
      await sleep(80);
      fake.emit(backgroundTasks(), init(), result({ total_cost_usd: 0.1, num_turns: 0 }));
      await sleep(100);
      expect(settled()).toBe(false);
      const out = await run;
      expect(fake.events).toEqual(['input:1', 'input-closed', 'close']);
      expect(out).toMatchObject({
        resultSubtype: 'success',
        isError: false,
        totalCostUsd: 0.1,
        backgroundTasksLeft: [],
      });
    });

    it('fails the run when the process goes away while the session waits for a background task', async () => {
      const fake = liveQuery();
      const { run, settled } = startRun(fake);
      fake.emit(init(), backgroundTasks('a'), result({ total_cost_usd: 0.1 }));
      await sleep(80);
      expect(settled()).toBe(false);
      fake.die();
      const out = await run;
      // The earlier turn's `success` is not the run's outcome.
      expect(out).toMatchObject({ isError: true, resultSubtype: null, aborted: false, totalCostUsd: 0.1 });
      expect(out.errors).toEqual(['agent process ended while its session was still open']);
      expect(out.backgroundTasksLeft.map((task) => task.id)).toEqual(['a']);
      expect(fake.events).toContain('stop:a');
    });

    it('fails the run when the process goes away in the middle of a later turn', async () => {
      const fake = liveQuery();
      const { run, settled } = startRun(fake);
      fake.emit(
        init(),
        backgroundTasks('a', 'b'),
        say('m1', 'Đang chờ.'),
        result({ total_cost_usd: 0.1, num_turns: 2, duration_ms: 1_000 }),
      );
      await sleep(80);
      expect(settled()).toBe(false);
      // The notification of `a` starts a second turn; `b` is still alive when the process goes.
      fake.emit(backgroundTasks('b'), init(), say('m2', 'Đang xử lý thông báo.'));
      await sleep(80);
      expect(settled()).toBe(false);
      fake.die();
      const out = await run;
      // The first turn's `success` is not the run's outcome: the second turn never reached its result.
      expect(out).toMatchObject({
        isError: true,
        resultSubtype: null,
        aborted: false,
        totalCostUsd: 0.1,
        reminded: false,
      });
      expect(out.errors).toEqual(['agent process ended while its session was still open']);
      expect(out.backgroundTasksLeft.map((task) => task.id)).toEqual(['b']);
      expect(fake.events.filter((event) => event.startsWith('stop:'))).toEqual(['stop:b']);
      expect(out.capture).toMatchObject({
        numTurns: 2,
        durationMs: 1_000,
        lastMessage: 'Đang xử lý thông báo.',
      });
    });

    it('closes after another full wait when the reminder starts no turn, stopping the tasks still alive', async () => {
      const waitMs = 150;
      const fake = liveQuery();
      const { run, settled } = startRun(fake, { backgroundWaitMs: waitMs });
      const startedAt = Date.now();
      fake.emit(init(), backgroundTasks('a'), result({ total_cost_usd: 0.1 }));
      await until(() => fake.received.length === 2, 'the reminder');
      expect(fake.received[1]).toContain('Nhắc từ daemon');
      // No turn answers the reminder: the run is still open well inside the second ceiling.
      await sleep(waitMs / 3);
      expect(settled()).toBe(false);
      expect(fake.events).toEqual(['input:1', 'input:2']);
      // It ends on the second ceiling, not on some later one.
      await until(settled, 'the run to end after the second wait', 10 * waitMs);
      const out = await run;
      // One ceiling before the reminder, another one after it.
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2 * waitMs - 10);
      expect(fake.received).toHaveLength(2);
      expect(fake.events).toEqual(['input:1', 'input:2', 'stop:a', 'input-closed', 'close']);
      expect(out).toMatchObject({
        isError: false,
        resultSubtype: 'success',
        aborted: false,
        totalCostUsd: 0.1,
        reminded: true,
      });
      expect(out.backgroundTasksLeft).toEqual([
        { id: 'a', type: 'local_bash', description: 'lệnh a', ambient: false },
      ]);
    });

    it('reminds once when the wait hits its ceiling, then stops every task and closes after the answering turn', async () => {
      const fake = liveQuery();
      const { run, settled } = startRun(fake, { backgroundWaitMs: 200 });
      fake.emit(init(), backgroundTasks('a', 'b'), result({ total_cost_usd: 0.1 }));
      await until(() => fake.received.length === 2, 'the reminder');
      expect(fake.received[1]).toContain('Nhắc từ daemon');
      expect(fake.received[1]).toContain('lệnh a (id a)');
      expect(fake.received[1]).toContain('lệnh b (id b)');
      // The answering turn outlasts the ceiling; the tasks are still alive when it ends.
      fake.emit(init(), say('m1', 'Em vẫn cần lệnh này.'));
      await sleep(450);
      expect(settled()).toBe(false);
      expect(fake.received).toHaveLength(2);
      fake.emit(result({ total_cost_usd: 0.3 }));
      const out = await run;
      expect(fake.received).toHaveLength(2);
      expect(fake.events).toEqual(['input:1', 'input:2', 'stop:a', 'stop:b', 'input-closed', 'close']);
      expect(out).toMatchObject({ isError: false, totalCostUsd: 0.3, reminded: true });
      expect(out.backgroundTasksLeft).toEqual([
        { id: 'a', type: 'local_bash', description: 'lệnh a', ambient: false },
        { id: 'b', type: 'local_bash', description: 'lệnh b', ambient: false },
      ]);
    });

    it('a task that ends right after the reminder is sent still gets its notification turn', async () => {
      const fake = liveQuery();
      const { run, settled } = startRun(fake, { backgroundWaitMs: 200 });
      fake.emit(init(), backgroundTasks('a'), say('m1', 'Đang chờ.'), result({ total_cost_usd: 0.1 }));
      await until(() => fake.received.length === 2, 'the reminder');
      // The task ends before the reminder's turn starts: the runtime answers the reminder first.
      fake.emit(backgroundTasks(), init(), say('m2', 'Vẫn đang chờ.'), result({ total_cost_usd: 0.2 }));
      await sleep(150);
      // The session stays open for the notification turn the runtime still owes.
      expect(settled()).toBe(false);
      expect(fake.events).toEqual(['input:1', 'input:2']);
      fake.emit(init(), say('m3', 'Đã nhận.'), result({ total_cost_usd: 0.3 }));
      const out = await run;
      expect(out.capture.lastMessage).toBe('Đã nhận.');
      expect(out).toMatchObject({
        resultSubtype: 'success',
        isError: false,
        totalCostUsd: 0.3,
        reminded: true,
        backgroundTasksLeft: [],
      });
      // The reminder went in once, and nothing was left to stop.
      expect(fake.received).toHaveLength(2);
      expect(fake.events).toEqual(['input:1', 'input:2', 'input-closed', 'close']);
    });

    it('does not wait after an error result: the tasks are stopped, a failing stop included, then the input closes', async () => {
      const fake = liveQuery({ failStop: ['a'] });
      const { run } = startRun(fake, { maxBudgetUsd: 1 });
      fake.emit(
        init(),
        backgroundTasks('a', 'b'),
        result({ subtype: 'error_max_budget_usd', is_error: true, errors: ['budget'], total_cost_usd: 1.2 }),
      );
      const out = await run;
      expect(fake.events).toEqual(['input:1', 'stop:a', 'stop:b', 'input-closed', 'close']);
      expect(out).toMatchObject({
        isError: true,
        resultSubtype: 'error_max_budget_usd',
        errors: ['budget'],
        reminded: false,
      });
      expect(out.backgroundTasksLeft.map((task) => task.id)).toEqual(['a', 'b']);
    });

    it('does not wait after a tool asked to end the run: the tasks are stopped before the session closes', async () => {
      const control = new RunControl();
      const fake = liveQuery();
      const { run } = startRun(fake, { control });
      fake.emit(init(), backgroundTasks('a'));
      await waitFor(() => fake.received.length === 1, 2_000, 'the prompt');
      control.requestEnd('handoff_docs');
      fake.emit(
        say('m1', 'Đã bàn giao.'),
        result({ subtype: 'error_during_execution', is_error: true, errors: ['interrupted'] }),
      );
      const out = await run;
      expect(fake.events).toEqual(['input:1', 'interrupt', 'stop:a', 'input-closed', 'close']);
      expect(out).toMatchObject({ endedBy: 'handoff_docs', isError: false, reminded: false });
      expect(out.backgroundTasksLeft.map((task) => task.id)).toEqual(['a']);
    });

    it.each(['mid-turn', 'waiting'] as const)(
      'stops the tasks before the process goes when the run is aborted %s',
      async (phase) => {
        const controller = new AbortController();
        const fake = liveQuery();
        const { run, settled } = startRun(fake, { abortSignal: controller.signal });
        fake.emit(init(), backgroundTasks('a'));
        if (phase === 'waiting') fake.emit(result());
        await sleep(80);
        expect(settled()).toBe(false);
        expect(fake.events).toEqual(['input:1']);
        controller.abort();
        const out = await run;
        expect(fake.events.slice(0, 2)).toEqual(['input:1', 'stop:a']);
        expect(fake.events.indexOf('stop:a')).toBeLessThan(fake.events.indexOf('aborted'));
        expect(out.aborted).toBe(true);
        expect(out.backgroundTasksLeft.map((task) => task.id)).toEqual(['a']);
      },
    );

    it('aborts at once, as before, when no background task is alive', async () => {
      const controller = new AbortController();
      const fake = liveQuery();
      const { run } = startRun(fake, { abortSignal: controller.signal });
      fake.emit(init());
      await waitFor(() => fake.received.length === 1, 2_000, 'the prompt');
      controller.abort();
      const out = await run;
      expect(fake.events.filter((event) => event.startsWith('stop:'))).toEqual([]);
      expect(out).toMatchObject({ aborted: true, backgroundTasksLeft: [] });
    });

    it('reports an abort that came before the run started, without stopping anything', async () => {
      const controller = new AbortController();
      controller.abort();
      const fake = liveQuery();
      const out = await startRun(fake, { abortSignal: controller.signal }).run;
      expect(fake.calls[0]?.options.abortController?.signal.aborted).toBe(true);
      expect(fake.events.filter((event) => event.startsWith('stop:'))).toEqual([]);
      expect(out).toMatchObject({ aborted: true, isError: false, backgroundTasksLeft: [] });
    });

    it('does not wait when the run reports its work as finished: the tasks are stopped and the run ends', async () => {
      const fake = liveQuery();
      const asked: number[] = [];
      const { run } = startRun(fake, {
        workDone: async () => {
          asked.push(fake.events.length);
          return true;
        },
      });
      fake.emit(init(), backgroundTasks('a'), result());
      const out = await run;
      expect(asked).toHaveLength(1);
      expect(fake.events).toEqual(['input:1', 'stop:a', 'input-closed', 'close']);
      expect(out).toMatchObject({ isError: false, resultSubtype: 'success', reminded: false });
      expect(out.backgroundTasksLeft.map((task) => task.id)).toEqual(['a']);
    });

    it('waits when the run reports its work as unfinished', async () => {
      const fake = liveQuery();
      const { run, settled } = startRun(fake, { workDone: () => false });
      fake.emit(init(), backgroundTasks('a'), result());
      await sleep(80);
      expect(settled()).toBe(false);
      fake.emit(backgroundTasks(), init(), result());
      expect((await run).backgroundTasksLeft).toEqual([]);
      expect(fake.events).toEqual(['input:1', 'input-closed', 'close']);
    });

    it('ends the run when a turn starts after the session was closed', async () => {
      const fake = liveQuery({ staysOpen: true });
      const { run, settled } = startRun(fake, { backgroundWaitMs: 200 });
      fake.emit(init(), backgroundTasks('a'), result({ total_cost_usd: 0.1 }));
      await until(() => fake.received.length === 2, 'the reminder');
      // The turn that crossed the reminder ends with the task alive: the session closes.
      fake.emit(init(), result({ total_cost_usd: 0.2 }));
      await until(() => fake.events.includes('input-closed'), 'the input to close');
      expect(settled()).toBe(false);
      // The runtime still starts the reminder's turn: the runner ends the process instead of running it.
      fake.emit(init(), say('m9', 'Trả lời lời nhắc.'));
      const out = await run;
      expect(fake.events).toEqual(['input:1', 'input:2', 'stop:a', 'input-closed', 'close']);
      expect(out).toMatchObject({ isError: false, totalCostUsd: 0.2, reminded: true, aborted: false });
      expect(out.capture.lastMessage).toBeNull();
    });
  });
});
