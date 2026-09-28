import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { agentEnv, createSdkRunner, type RunAgentOptions, RunControl } from '../src/runner/agent-runner.js';

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

  it('marks a run without a result message as an error', async () => {
    const fake = fakeQuery(() => [init()]);
    const run = await createSdkRunner({ query: fake.query })(options());
    expect(run.isError).toBe(true);
  });
});
