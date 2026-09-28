import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { agentEnv, sdkRuntimeVersion } from '../../runner/agent-runner.js';
import { type HealthCheck, type HealthCheckResult, result } from '../types.js';

/** Resuming a session restores its cost only from this Claude Code version on. */
export const MIN_CLAUDE_VERSION = '2.1.277';

/** Compares dotted versions numerically; a missing part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function parseClaudeVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

export interface LoginProbeResult {
  ok: boolean;
  apiKeySource: string | null;
  claudeCodeVersion: string | null;
  subscriptionType: string | null;
  costUsd: number;
  error: string | null;
}

/**
 * One tiny haiku turn with no tools and no settings (the cheapest real call) to prove the subscription
 * login works and that billing does not come from an API key.
 */
export async function loginProbe(
  options: { query?: typeof sdkQuery; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<LoginProbeResult> {
  const query = options.query ?? sdkQuery;
  const cwd = mkdtempSync(join(tmpdir(), 'crew-login-probe-'));
  const probe: LoginProbeResult = {
    ok: false,
    apiKeySource: null,
    claudeCodeVersion: null,
    subscriptionType: null,
    costUsd: 0,
    error: null,
  };
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), options.timeoutMs ?? 120_000);
  const q = query({
    prompt: 'Chỉ trả lời đúng một từ: ok',
    options: {
      cwd,
      model: 'haiku',
      env: agentEnv(options.env ?? process.env, {}),
      settingSources: [],
      tools: [],
      permissionMode: 'dontAsk',
      maxTurns: 1,
      abortController,
    },
  });
  try {
    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') {
        probe.apiKeySource = message.apiKeySource;
        probe.claudeCodeVersion = message.claude_code_version;
        const init = await q.initializationResult().catch(() => null);
        probe.subscriptionType = init?.account?.subscriptionType ?? null;
      } else if (message.type === 'result') {
        probe.costUsd = message.total_cost_usd;
        probe.ok = message.subtype === 'success' && !message.is_error;
        if (!probe.ok)
          probe.error = message.subtype === 'success' ? message.result : message.errors.join('; ');
      }
    }
  } catch (error) {
    probe.error = abortController.signal.aborted ? 'hết thời gian chờ' : (error as Error).message;
  } finally {
    clearTimeout(timer);
    q.close();
    rmSync(cwd, { recursive: true, force: true });
  }
  return probe;
}

export const claudeChecks: HealthCheck = {
  id: 'claude',
  group: 'claude',
  async run(ctx) {
    const results: HealthCheckResult[] = [];
    results.push(
      ctx.env.ANTHROPIC_API_KEY
        ? result(
            'claude.api-key-env',
            'claude',
            'Không có ANTHROPIC_API_KEY',
            'red',
            'ANTHROPIC_API_KEY đang có trong môi trường của dịch vụ: gỡ biến này khỏi môi trường (shell profile, unit systemd) để agent dùng gói đăng ký, không tính phí API.',
            { id: 'api-key-help', label: 'Hướng dẫn gỡ biến' },
          )
        : result(
            'claude.api-key-env',
            'claude',
            'Không có ANTHROPIC_API_KEY',
            'green',
            'Môi trường dịch vụ không có API key.',
          ),
    );

    const runtime = sdkRuntimeVersion();
    results.push(
      runtime && compareVersions(runtime, MIN_CLAUDE_VERSION) >= 0
        ? result(
            'claude.runtime',
            'claude',
            'Runtime Claude Code của Agent SDK',
            'green',
            `Phiên bản ${runtime}.`,
          )
        : result(
            'claude.runtime',
            'claude',
            'Runtime Claude Code của Agent SDK',
            'red',
            runtime
              ? `Runtime ${runtime} cũ hơn ${MIN_CLAUDE_VERSION}: cập nhật app hoặc daemon.`
              : 'Không tìm thấy runtime Claude Code đi kèm Agent SDK: cài lại app hoặc daemon.',
          ),
    );

    const cli = ctx.exec('claude', ['--version']);
    const cliVersion = cli.code === 0 ? parseClaudeVersion(cli.stdout) : null;
    if (!cliVersion) {
      results.push(
        result(
          'claude.cli',
          'claude',
          'Claude Code CLI',
          'yellow',
          'Không tìm thấy lệnh `claude`: cần nó để đăng nhập (`claude` rồi `/login`).',
        ),
      );
    } else if (compareVersions(cliVersion, MIN_CLAUDE_VERSION) < 0) {
      results.push(
        result(
          'claude.cli',
          'claude',
          'Claude Code CLI',
          'red',
          `Phiên bản ${cliVersion} cũ hơn ${MIN_CLAUDE_VERSION}: cập nhật Claude Code.`,
        ),
      );
    } else {
      results.push(result('claude.cli', 'claude', 'Claude Code CLI', 'green', `Phiên bản ${cliVersion}.`));
    }

    if (ctx.skipLoginProbe || ctx.quick) return results;
    const login = { id: 'open-claude-login', label: 'Đăng nhập Claude' };
    const probe = await loginProbe({ query: ctx.query, env: ctx.env });
    if (!probe.ok) {
      results.push(
        result(
          'claude.login',
          'claude',
          'Đăng nhập gói Claude',
          'red',
          `Lượt thử với haiku thất bại (${probe.error ?? 'không rõ lỗi'}). Mở Terminal, chạy \`claude\` rồi \`/login\`.`,
          login,
        ),
      );
    } else if (probe.apiKeySource !== 'none') {
      results.push(
        result(
          'claude.login',
          'claude',
          'Đăng nhập gói Claude',
          'red',
          `Lượt thử đang tính phí qua ${probe.apiKeySource}: chỉ dùng đăng nhập gói đăng ký (\`/login\`).`,
          login,
        ),
      );
    } else if (probe.claudeCodeVersion && compareVersions(probe.claudeCodeVersion, MIN_CLAUDE_VERSION) < 0) {
      results.push(
        result(
          'claude.login',
          'claude',
          'Đăng nhập gói Claude',
          'red',
          `Runtime của Agent SDK là ${probe.claudeCodeVersion}, cần ${MIN_CLAUDE_VERSION} trở lên: cập nhật daemon.`,
        ),
      );
    } else {
      results.push(
        result(
          'claude.login',
          'claude',
          'Đăng nhập gói Claude',
          'green',
          `Gói ${probe.subscriptionType ?? 'đăng ký'}, runtime ${probe.claudeCodeVersion ?? '?'}, lượt thử tốn ${probe.costUsd.toFixed(4)} USD.`,
        ),
      );
    }
    return results;
  },
};
