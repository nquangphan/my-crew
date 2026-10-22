import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { BackendError, type BackendRequest, type BackendResponse, type JevBackend } from 'jev-use';
import { afterEach, describe, expect, it } from 'vitest';
import { orphanCheck } from '../src/commands/workflow-check.js';
import { decodeBackgroundInput, type JevCompanyConfig, writeJevConfig } from '../src/jev/config.js';
import {
  BackgroundBusy,
  backgroundSlotDir,
  type GateOptions,
  interpretGateResult,
  jevState,
  liveBackgroundSlots,
  MAX_BACKGROUND,
  runGate,
} from '../src/jev/gate.js';
import { type GateLogEntry, redactCommand } from '../src/jev/log.js';
import { macPaths } from '../src/paths.js';
import { createRunner } from '../src/system.js';
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
    const result = await runGate(t.ctx, event('rm -rf /tmp/tmp.AbC123'), t.options());
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
  it('che mật khẩu dính liền cờ -p của client MySQL, giữ các cờ khác', () => {
    expect(redactCommand('mysql -u root -pS3cretPass -h db orders')).toBe(
      'mysql -u root -p[redacted] -h db orders',
    );
    expect(redactCommand('mysqldump -pabc123 db > x.sql')).toBe('mysqldump -p[redacted] db > x.sql');
    expect(redactCommand('mysql -u root -p db')).toBe('mysql -u root -p db');
  });

  it('người ghi đợi khóa của bước nén log; khóa bị giữ quá lâu thì vẫn ghi', async () => {
    const t = setupGate({ [CID]: entry() }, 'allow');
    mkdirSync(t.paths.jevDir, { recursive: true });
    mkdirSync(`${t.paths.jevLog}.lock`);
    const started = Date.now();
    await runGate(t.ctx, event('ls'), t.options({ background: true }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(t.logLines()).toHaveLength(1);
  });

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

describe('state, kết quả Jev và giới hạn tiến trình nền', () => {
  it('luật thư mục tạm khớp vai trò: thư mục mktemp của run, ở lệnh này hay lệnh trước', () => {
    const state = jevState('/w', null, '/var/folders/ab/T');
    expect(state).toContain('Temporary directory root (TMPDIR): /var/folders/ab/T');
    expect(state).toContain('this run created with mktemp -d');
    expect(state).toContain('in this command or an earlier one');
    expect(state).toContain('/var/folders/ab/T/tmp.XXXXXXXX');
    expect(jevState('/w', { defaultBranch: null, currentBranch: 'x', originIsGithub: true })).toContain(
      'Default branch: unknown (main or master assumed)',
    );
  });

  it('body không phải JSON là bad_response, không phải unreachable', () => {
    expect(
      interpretGateResult({
        decision: 'escalate',
        confidence: 0,
        reason: 'unreachable',
        hint: 'Jev backend failed (network error: SyntaxError: Unexpected token < in JSON at position 0); answer this yourself.',
        backend: 'openrouter',
      }),
    ).toMatchObject({ verdict: 'error', errorCode: 'bad_response' });
  });

  it('đủ tiến trình nền thì ghi error/skipped_bg thay vì tách thêm', async () => {
    const t = setupGate({ [CID]: entry() });
    await runGate(
      t.ctx,
      event('ls'),
      t.options({
        spawnBackground: async () => {
          throw new BackgroundBusy('đủ');
        },
      }),
    );
    expect(t.logLines()[0]).toMatchObject({ verdict: 'error', errorCode: 'skipped_bg', command: 'ls' });
  });

  it('đếm ô tiến trình nền: pid còn sống thì tính, pid chết thì xóa ô', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crew-jev-slots-'));
    writeFileSync(join(dir, String(process.pid)), '');
    writeFileSync(join(dir, '999999'), '');
    writeFileSync(join(dir, 'rác'), '');
    expect(liveBackgroundSlots(dir)).toBe(1);
    expect(readdirSync(dir)).toEqual([String(process.pid)]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(process.platform !== 'darwin')('tiến trình nền thật', () => {
  const RUN_REAL = '55555555-2222-4333-8444-555555555555';
  const cleanup: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
  });

  it('hook tách gate-bg với cwd ~/.crew/jev, env không có biến run, dữ liệu run qua stdin; check mồ côi của run vẫn ok', async () => {
    const t = setupGate({ [CID]: entry() });
    cleanup.push(() => rmSync(t.home, { recursive: true, force: true }));
    // cli.js giả: ghi lại cwd, env, argv, stdin rồi "gọi Jev" 3 giây như gate-bg thật.
    const bin = mkdtempSync(join(tmpdir(), 'crew-jev-bin-'));
    cleanup.push(() => rmSync(bin, { recursive: true, force: true }));
    const record = join(bin, 'record.json');
    const cli = join(bin, 'cli.js');
    writeFileSync(
      cli,
      `const fs = require('node:fs');
const input = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ pid: process.pid, cwd: process.cwd(), env: process.env, argv: process.argv.slice(2), input }));
setTimeout(() => {}, 3000);
`,
    );
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'crew-jev-worktree-')));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const runDir = join(root, '.paperclip-runtime', 'runs', RUN_REAL);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'started'), `${Math.floor(Date.now() / 1000) - 2}\n`);
    const env = {
      ...process.env,
      PAPERCLIP_COMPANY_ID: CID,
      PAPERCLIP_RUN_ID: RUN_REAL,
      PAPERCLIP_AGENT_ID: RUN,
      PAPERCLIP_API_KEY: 'pcp-secret-không-được-lộ',
    };
    const { spawnBackground: _fake, ...real } = t.options({ env });
    const hookEvent = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: root });
    expect(await runGate({ ...t.ctx, cliPath: cli }, hookEvent, real)).toEqual({ stdout: '', logLine: null });

    for (let i = 0; i < 50 && !existsSync(record); i++) await sleep(100);
    const seen = JSON.parse(readFileSync(record, 'utf8')) as {
      pid: number;
      cwd: string;
      env: Record<string, string>;
      argv: string[];
      input: string;
    };
    cleanup.push(() => {
      try {
        process.kill(seen.pid, 'SIGKILL');
      } catch {}
    });
    expect(seen.argv).toEqual(['jev', 'gate-bg']);
    expect(realpathSync(seen.cwd)).toBe(realpathSync(t.paths.jevDir));
    for (const key of ['PAPERCLIP_RUN_ID', 'PAPERCLIP_COMPANY_ID', 'PAPERCLIP_AGENT_ID', 'PAPERCLIP_API_KEY'])
      expect(seen.env[key]).toBeUndefined();
    expect(seen.env.HOME).toBe(process.env.HOME);
    expect(decodeBackgroundInput(seen.input)).toEqual({
      eventJson: hookEvent,
      env: { PAPERCLIP_COMPANY_ID: CID, PAPERCLIP_RUN_ID: RUN_REAL, PAPERCLIP_AGENT_ID: RUN },
    });
    expect(seen.input).not.toContain('pcp-secret');
    // Nhóm process mới (detached) và có ô đếm tiến trình nền.
    const pgid = execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(seen.pid)], {
      encoding: 'utf8',
    }).trim();
    expect(pgid).toBe(String(seen.pid));
    expect(existsSync(join(backgroundSlotDir(t.home), String(seen.pid)))).toBe(true);

    // Lệnh báo xong của agent chạy ngay sau hook, khi gate-bg còn sống.
    const check = await orphanCheck(
      { runner: createRunner(), now: () => new Date(), selfPid: process.pid },
      { root, runId: RUN_REAL },
    );
    expect(check).toEqual({
      ok: true,
      lines: [`crew-workflow ok không còn process nào của run ${RUN_REAL}`],
    });
  }, 20_000);

  it('đủ MAX_BACKGROUND gate-bg đang sống thì spawnGateBackground không tách thêm, hook ghi error/skipped_bg', async () => {
    const t = setupGate({ [CID]: entry() });
    const dir = backgroundSlotDir(t.home);
    mkdirSync(dir, { recursive: true });
    const sleepers = Array.from({ length: MAX_BACKGROUND }, () =>
      spawn('/bin/sleep', ['5'], { stdio: 'ignore' }),
    );
    for (const child of sleepers) writeFileSync(join(dir, String(child.pid)), '');
    try {
      const { spawnBackground: _fake, ...real } = t.options();
      await runGate({ ...t.ctx, cliPath: '/không/có/cli.js' }, event('ls'), real);
      expect(t.logLines()[0]).toMatchObject({ verdict: 'error', errorCode: 'skipped_bg' });
      expect(readdirSync(dir)).toHaveLength(MAX_BACKGROUND);
    } finally {
      for (const child of sleepers) child.kill('SIGKILL');
      rmSync(t.home, { recursive: true, force: true });
    }
  });
});
