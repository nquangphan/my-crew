import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { agentEnv, createSdkRunner, type RunAgentOptions, RunControl } from '../src/runner/agent-runner.js';
import type { RunImage } from '../src/runner/ticket-images.js';
import { tinyPng } from './helpers/images.js';

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
    expect(fake.calls[0]?.prompt).toBe('/ak:cook làm việc');
    await createSdkRunner({ query: fake.query })(options({ images: [] }));
    expect(fake.calls[1]?.prompt).toBe('/ak:cook làm việc');
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
});
