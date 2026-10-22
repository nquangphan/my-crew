import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { BackendError, type BackendRequest, type BackendResponse, type JevBackend } from 'jev-use';
import { describe, expect, it } from 'vitest';
import { type JevCompanyConfig, writeJevConfig } from '../src/jev/config.js';
import { type GateOptions, runGate } from '../src/jev/gate.js';
import type { GateLogEntry } from '../src/jev/log.js';
import { macPaths } from '../src/paths.js';
import { fakeMac } from './helpers/fake-mac.js';

const CID = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';
const KEY = 'sk-or-test-0123456789abcdefABCDEF';

function entry(overrides: Partial<JevCompanyConfig> = {}): JevCompanyConfig {
  return {
    version: 3,
    enabled: true,
    gateMode: 'shadow',
    model: 'typesafe/jev-1.14',
    threshold: 0.5,
    timeoutMs: 2500,
    keyFingerprint: 'abcdefabcdef',
    pulledAt: '2026-10-06T07:00:00.000Z',
    ...overrides,
  };
}

function event(command: string, tool = 'Bash'): string {
  return JSON.stringify({
    session_id: 's',
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: { command },
    cwd: '/Users/owner/crew-agents/p/executor',
  });
}

/** Backend giả: trả verdict cố định (hoặc treo/ném), ghi lại mọi request. */
function stubBackend(
  answer: 'allow' | 'deny' | 'hang' | 'throw' | 'timeout-error',
  confidence = 0.95,
): {
  backend: JevBackend;
  requests: BackendRequest[];
  options: Array<{ apiKey: string; timeoutMs: number }>;
} {
  const requests: BackendRequest[] = [];
  const options: Array<{ apiKey: string; timeoutMs: number }> = [];
  const backend: JevBackend = {
    name: 'stub',
    judge(request): Promise<BackendResponse> {
      requests.push(request);
      if (answer === 'hang') return new Promise(() => {});
      if (answer === 'throw') return Promise.reject(new BackendError('stub', 'HTTP 503: down', 503));
      if (answer === 'timeout-error')
        return Promise.reject(new BackendError('stub', 'request timed out after 500ms'));
      const other = answer === 'allow' ? 'deny' : 'allow';
      return Promise.resolve({
        answers: [{ answer, confidence, distribution: { [answer]: confidence, [other]: 1 - confidence } }],
      });
    },
  };
  return { backend, requests, options };
}

function setupGate(
  config: Record<string, JevCompanyConfig> | null,
  backendAnswer: Parameters<typeof stubBackend>[0] = 'allow',
  confidence?: number,
  keychain: { code?: number; stdout?: string } = { stdout: `${KEY}\n` },
) {
  const mac = fakeMac();
  const paths = macPaths(mac.home);
  if (config) writeJevConfig(paths.jevConfig, { companies: config });
  mac.runner.on('/usr/bin/security', () => keychain);
  mac.runner.on('git', (args) => {
    const joined = args.join(' ');
    if (joined.includes('refs/remotes/origin/HEAD')) return { stdout: 'origin/main\n' };
    if (joined.includes('get-url')) return { stdout: 'https://github.com/o/r.git\n' };
    return { stdout: 'crew/x\n' };
  });
  const stub = stubBackend(backendAnswer, confidence);
  const spawned: string[] = [];
  const options = (extra: Partial<GateOptions> = {}): GateOptions => ({
    env: { PAPERCLIP_COMPANY_ID: CID, PAPERCLIP_RUN_ID: RUN },
    background: false,
    spawnBackground: async (json) => {
      spawned.push(json);
    },
    createBackend: (o) => {
      stub.options.push({ apiKey: o.apiKey, timeoutMs: o.timeoutMs });
      return stub.backend;
    },
    ...extra,
  });
  const logLines = (): GateLogEntry[] =>
    existsSync(paths.jevLog)
      ? readFileSync(paths.jevLog, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as GateLogEntry)
      : [];
  return { ...mac, paths, stub, spawned, options, logLines };
}

describe('runGate: không làm gì', () => {
  it('không có config thì không in, không log, không tách tiến trình', async () => {
    const t = setupGate(null);
    expect(await runGate(t.ctx, event('git push -f'), t.options())).toEqual({ stdout: '', logLine: null });
    expect(t.spawned).toEqual([]);
    expect(existsSync(t.paths.jevLog)).toBe(false);
  });

  it('Jev tắt thì không log', async () => {
    const t = setupGate({ [CID]: entry({ enabled: false }) });
    expect((await runGate(t.ctx, event('ls'), t.options())).stdout).toBe('');
    expect(t.spawned).toEqual([]);
    expect(existsSync(t.paths.jevLog)).toBe(false);
  });

  it('tool không phải Bash thì không log', async () => {
    const t = setupGate({ [CID]: entry() });
    await runGate(t.ctx, event('x', 'Write'), t.options());
    expect(t.spawned).toEqual([]);
    expect(existsSync(t.paths.jevLog)).toBe(false);
  });

  it('PAPERCLIP_COMPANY_ID không có trong config thì không làm gì', async () => {
    const t = setupGate({ [CID]: entry() });
    await runGate(t.ctx, event('ls'), t.options({ env: { PAPERCLIP_COMPANY_ID: OTHER } }));
    expect(t.spawned).toEqual([]);
  });

  it('không có PAPERCLIP_COMPANY_ID thì dùng company duy nhất', async () => {
    const t = setupGate({ [CID]: entry() });
    await runGate(t.ctx, event('ls'), t.options({ env: {} }));
    expect(t.spawned).toHaveLength(1);
  });
});

describe('runGate: shadow', () => {
  it('tiến trình chính tách tiến trình nền và trả ngay, không gọi Jev, không đọc Keychain', async () => {
    const t = setupGate({ [CID]: entry() }, 'hang');
    const raw = event('git push --force origin crew/x');
    expect(await runGate(t.ctx, raw, t.options())).toEqual({ stdout: '', logLine: null });
    expect(t.spawned).toEqual([raw]);
    expect(t.stub.requests).toHaveLength(0);
    expect(t.runner.calls).toHaveLength(0);
  });

  it('tiến trình nền gọi Jev, ghi verdict deny nhưng vẫn cho chạy', async () => {
    const t = setupGate({ [CID]: entry() }, 'deny');
    const result = await runGate(
      t.ctx,
      event('git push --force origin crew/x'),
      t.options({ background: true }),
    );
    expect(result.stdout).toBe('');
    const [line] = t.logLines();
    expect(line).toMatchObject({
      v: 1,
      companyId: CID,
      runId: RUN,
      agentId: null,
      cwd: '/Users/owner/crew-agents/p/executor',
      mode: 'shadow',
      category: 'force_push',
      blocking: false,
      verdict: 'deny',
      applied: 'allow',
      confidence: 0.95,
      errorCode: null,
      model: 'typesafe/jev-1.14',
      command: 'git push --force origin crew/x',
    });
    expect(line?.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(statSync(t.paths.jevLog).mode & 0o777).toBe(0o600);
    expect(t.stub.options[0]?.apiKey).toBe(KEY);
  });
});

describe('runGate: enforce', () => {
  it('lệnh thuộc nhóm và Jev deny thì in JSON deny có lý do tiếng Việt', async () => {
    const t = setupGate({ [CID]: entry({ gateMode: 'enforce' }) }, 'deny', 0.93);
    const result = await runGate(t.ctx, event('git push --force origin crew/x'), t.options());
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Crew Jev chặn: force_push (độ tin 0.93). Lệnh này nằm trong mục "Không bao giờ" của vai trò.',
      },
    });
    expect(t.spawned).toEqual([]);
    expect(t.logLines()).toMatchObject([
      { mode: 'enforce', category: 'force_push', blocking: true, verdict: 'deny', applied: 'deny' },
    ]);
    expect(t.stub.options[0]?.timeoutMs).toBeLessThanOrEqual(2500);
  });

  it('gửi Jev state tiếng Anh có cwd, nhánh mặc định, luật và lệnh đã che', async () => {
    const t = setupGate({ [CID]: entry({ gateMode: 'enforce' }) }, 'allow');
    await runGate(t.ctx, event(`git push origin main -o token=${KEY}`), t.options());
    const state = String(t.stub.requests[0]?.state);
    expect(state).toContain('/Users/owner/crew-agents/p/executor');
    expect(state).toContain('Default branch: main');
    expect(state).toContain('mktemp -d');
    expect(state).not.toContain(KEY);
    expect(t.logLines()[0]).toMatchObject({ category: 'push_default', verdict: 'allow', applied: 'allow' });
  });

  it('lệnh thuộc nhóm mà Jev allow thì cho chạy', async () => {
    const t = setupGate({ [CID]: entry({ gateMode: 'enforce' }) }, 'allow');
    const result = await runGate(t.ctx, event('D=$(mktemp -d)\nrm -rf "$D"'), t.options());
    expect(result.stdout).toBe('');
    expect(t.logLines()[0]).toMatchObject({ category: 'rm_recursive', blocking: true, verdict: 'allow' });
  });

  it('Jev không chắc (escalate) thì cho chạy và ghi escalate', async () => {
    const t = setupGate({ [CID]: entry({ gateMode: 'enforce', threshold: 0.9 }) }, 'deny', 0.6);
    const result = await runGate(t.ctx, event('rm -rf build'), t.options());
    expect(result.stdout).toBe('');
    expect(t.logLines()[0]).toMatchObject({ verdict: 'escalate', applied: 'allow', reason: 'unsure' });
  });

  it('lệnh không thuộc nhóm thì không chờ Jev: tách tiến trình nền rồi trả ngay', async () => {
    const t = setupGate({ [CID]: entry({ gateMode: 'enforce' }) }, 'hang');
    const started = Date.now();
    expect(await runGate(t.ctx, event('git status'), t.options())).toEqual({ stdout: '', logLine: null });
    expect(Date.now() - started).toBeLessThan(200);
    expect(t.spawned).toHaveLength(1);
    expect(t.stub.requests).toHaveLength(0);
  });

  it('lệnh không có git push thì không chạy git', async () => {
    const t = setupGate({ [CID]: entry({ gateMode: 'enforce' }) }, 'deny');
    await runGate(t.ctx, event('rm -rf build'), t.options());
    expect(t.runner.calls.some((c) => c.command === 'git')).toBe(false);
  });
});

describe('runGate: fail-open', () => {
  const enforce = () => ({ [CID]: entry({ gateMode: 'enforce', timeoutMs: 500 }) });

  it('Jev quá hạn thì cho chạy, log error/timeout', async () => {
    const t = setupGate(enforce(), 'hang');
    const started = Date.now();
    const result = await runGate(t.ctx, event('git push -f origin crew/x'), t.options());
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.stdout).toBe('');
    expect(t.logLines()[0]).toMatchObject({ verdict: 'error', applied: 'allow', errorCode: 'timeout' });
  });

  it('backend tự báo quá hạn thì cũng là timeout', async () => {
    const t = setupGate(enforce(), 'timeout-error');
    await runGate(t.ctx, event('git push -f origin crew/x'), t.options());
    expect(t.logLines()[0]).toMatchObject({ verdict: 'error', errorCode: 'timeout' });
  });

  it('mạng hay HTTP lỗi thì cho chạy, log error/unreachable', async () => {
    const t = setupGate(enforce(), 'throw');
    const result = await runGate(t.ctx, event('git push -f origin crew/x'), t.options());
    expect(result.stdout).toBe('');
    expect(t.logLines()[0]).toMatchObject({ verdict: 'error', applied: 'allow', errorCode: 'unreachable' });
  });

  it('không có key trong Keychain thì cho chạy, log error/no_key, không gọi Jev', async () => {
    const t = setupGate(enforce(), 'deny', 0.99, { code: 44 });
    const result = await runGate(t.ctx, event('git push -f origin crew/x'), t.options());
    expect(result.stdout).toBe('');
    expect(t.stub.requests).toHaveLength(0);
    expect(t.logLines()[0]).toMatchObject({ verdict: 'error', applied: 'allow', errorCode: 'no_key' });
  });

  it('stdin hỏng thì cho chạy, log error/bad_event', async () => {
    const t = setupGate(enforce());
    expect((await runGate(t.ctx, '{not json', t.options())).stdout).toBe('');
    expect(t.logLines()[0]).toMatchObject({ verdict: 'error', errorCode: 'bad_event', command: '' });
  });

  it('Bash mà thiếu command thì là bad_event', async () => {
    const t = setupGate(enforce());
    await runGate(t.ctx, JSON.stringify({ tool_name: 'Bash', tool_input: {} }), t.options());
    expect(t.logLines()[0]).toMatchObject({ errorCode: 'bad_event' });
  });

  it('tách tiến trình nền lỗi thì vẫn cho chạy, log error/internal', async () => {
    const t = setupGate({ [CID]: entry() });
    const result = await runGate(
      t.ctx,
      event('ls'),
      t.options({
        spawnBackground: async () => {
          throw new Error('spawn EAGAIN');
        },
      }),
    );
    expect(result.stdout).toBe('');
    expect(t.logLines()[0]).toMatchObject({ verdict: 'error', errorCode: 'internal', command: 'ls' });
  });

  it('config hỏng thì coi như không có', async () => {
    const t = setupGate(null);
    mkdirSync(t.paths.jevDir, { recursive: true });
    writeFileSync(t.paths.jevConfig, '{');
    expect((await runGate(t.ctx, event('rm -rf x'), t.options())).stdout).toBe('');
  });
});

describe('dòng log', () => {
  it('che credential trong lệnh và cắt 2000 ký tự, dòng nhỏ hơn 4 KiB', async () => {
    const t = setupGate({ [CID]: entry() }, 'allow');
    const long = `curl -H "Authorization: Bearer ${KEY}" https://x/${'é'.repeat(3000)}`;
    await runGate(t.ctx, event(long), t.options({ background: true }));
    const raw = readFileSync(t.paths.jevLog, 'utf8');
    expect(raw).not.toContain(KEY);
    expect(raw).toContain('[redacted]');
    expect(Buffer.byteLength(raw.trim(), 'utf8')).toBeLessThan(4096);
    expect((t.logLines()[0]?.command.length ?? 0) <= 2000).toBe(true);
  });
});
