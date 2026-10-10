import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_SHELL } from '../src/runtimes/command.js';
import { KEYCHAIN_SERVICE, SECURITY_BIN } from '../src/runtimes/keychain.js';
import { buildMachineReport, MACHINE_REPORT_MAX_BYTES } from '../src/status/report.js';
import { buildRuntimesReport, MAX_RUNTIME_MODELS } from '../src/status/runtimes.js';
import { fakeMac } from './helpers/fake-mac.js';

const STATS = [
  '┌────────────────────────────────────────┐',
  '│                OVERVIEW                │',
  '│Total Cost                       $9.9900│',
  '│Avg Cost/Day                     $3.3300│',
  '│ opencode-go/kimi-k3                    │',
  '│  Messages                           12 │',
  '│  Cost                           $2.7210│',
  '├────────────────────────────────────────┤',
  '│ opencode-go/kimi-k2.6                  │',
  '│  Cost                           $0.2099│',
  '├────────────────────────────────────────┤',
  '│ anthropic/claude-x                     │',
  '│  Cost                           $5.0000│',
].join('\n');

interface Answers {
  [command: string]: { code?: number; stdout?: string; stderr?: string; timedOut?: boolean };
}

const HEALTHY: Answers = {
  'codex --version': { stdout: 'codex-cli 0.161.0\n' },
  'codex login status': { stderr: 'Logged in using ChatGPT\n' },
  'opencode --version': { stdout: '1.18.35\n' },
  'opencode stats --days 1 --models': { stdout: STATS },
  'opencode stats --days 7 --models': { stdout: STATS },
  'opencode stats --days 30 --models': { stdout: STATS },
  'opencode models opencode-go': { stdout: 'opencode-go/kimi-k3\nopencode-go/glm-5.3\n' },
};

function machine(answers: Answers, keyCode = 0) {
  const mac = fakeMac();
  mac.runner
    .on(AGENT_SHELL, (args) => answers[args.at(-1) as string] ?? { code: 127, stderr: 'command not found' })
    .on(SECURITY_BIN, () => ({ code: keyCode }));
  return mac;
}

/** Ghi một dòng `token_count` giống session thật (SP-C) vào `<dir>/sessions/...`. */
function writeSession(
  dir: string,
  name: string,
  events: { ts: string; used: number; resetsAt: number; window?: number }[],
) {
  const folder = join(dir, 'sessions', '2026', '10', '10');
  mkdirSync(folder, { recursive: true });
  const lines = events.map((e) =>
    JSON.stringify({
      timestamp: e.ts,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          limit_id: 'codex',
          primary: { used_percent: e.used, window_minutes: e.window ?? 10080, resets_at: e.resetsAt },
          secondary: null,
        },
      },
    }),
  );
  writeFileSync(join(folder, name), `${['{"type":"session_meta"}', ...lines].join('\n')}\n`);
}

const FUTURE = Math.floor(Date.parse('2026-10-16T12:59:50Z') / 1000);

describe('buildRuntimesReport', () => {
  it('cộng Cost của mọi model opencode-go theo 1/7/30 ngày, bỏ provider khác và phần tổng quan', async () => {
    const { ctx } = machine(HEALTHY);
    const r = await buildRuntimesReport(ctx);
    expect(r.opencode.costDay).toBeCloseTo(2.9309, 4);
    expect(r.opencode.costWeek).toBeCloseTo(2.9309, 4);
    expect(r.opencode.costMonth).toBeCloseTo(2.9309, 4);
    expect(r.opencode).toMatchObject({ version: '1.18.35', keyPresent: true });
    expect(r.codex).toMatchObject({ version: 'codex-cli 0.161.0', loggedIn: true });
  });

  it('model list chỉ id opencode-go hợp lệ, tối đa 60', async () => {
    const lines = [
      ...Array.from({ length: 70 }, (_, i) => `opencode-go/model-${i}`),
      'anthropic/claude-x',
      'opencode-go/Bad Name',
      `opencode-go/${'a'.repeat(120)}`,
      '',
    ].join('\n');
    const { ctx } = machine({ ...HEALTHY, 'opencode models opencode-go': { stdout: lines } });
    const r = await buildRuntimesReport(ctx);
    expect(r.opencode.models).toHaveLength(MAX_RUNTIME_MODELS);
    expect(r.opencode.models[0]).toBe('opencode-go/model-0');
    expect(r.opencode.models.every((m) => /^[a-z0-9._/-]+$/.test(m) && m.length <= 120)).toBe(true);
  });

  it('codex quota từ session jsonl mới nhất ở cả hai nơi, không đọc auth.json', async () => {
    const mac = machine(HEALTHY);
    const { ctx, home } = mac;
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'auth.json'), '{"access_token":"MOC-AUTH"}');
    writeSession(join(home, '.codex'), 'old.jsonl', [
      { ts: '2026-10-10T01:00:00.000Z', used: 11, resetsAt: FUTURE },
    ]);
    writeSession(join(home, '.crew', 'runtimes', 'codex', 'agent-1'), 'new.jsonl', [
      { ts: '2026-10-10T05:00:00.000Z', used: 19, resetsAt: FUTURE },
      { ts: '2026-10-10T05:30:00.000Z', used: 42, resetsAt: FUTURE },
    ]);
    const r = await buildRuntimesReport(ctx);
    expect(r.codex.primaryUsedPct).toBe(42);
    expect(r.codex.resetsAt).toBe('2026-10-16T12:59:50.000Z');
    expect(JSON.stringify(r)).not.toContain('MOC-AUTH');
  });

  it('quota lấy sự kiện mới nhất theo timestamp dù nằm ở file cũ hơn', async () => {
    const mac = machine(HEALTHY);
    const { ctx, home } = mac;
    writeSession(join(home, '.codex'), 'a.jsonl', [
      { ts: '2026-10-10T09:00:00.000Z', used: 77, resetsAt: FUTURE },
    ]);
    writeSession(join(home, '.crew', 'runtimes', 'codex', 'agent-1'), 'b.jsonl', [
      { ts: '2026-10-10T03:00:00.000Z', used: 5, resetsAt: FUTURE },
    ]);
    expect((await buildRuntimesReport(ctx)).codex.primaryUsedPct).toBe(77);
  });

  it('cửa sổ quota đã qua hạn hoặc số ngoài 0..100 thì quota là null', async () => {
    const expired = machine(HEALTHY);
    writeSession(join(expired.home, '.codex'), 'a.jsonl', [
      {
        ts: '2026-10-05T09:00:00.000Z',
        used: 100,
        resetsAt: Math.floor(Date.parse('2026-10-05T10:00:00Z') / 1000),
      },
    ]);
    const a = await buildRuntimesReport(expired.ctx);
    expect([a.codex.primaryUsedPct, a.codex.resetsAt]).toEqual([null, null]);

    const bad = machine(HEALTHY);
    writeSession(join(bad.home, '.codex'), 'a.jsonl', [
      { ts: '2026-10-10T09:00:00.000Z', used: 250, resetsAt: FUTURE },
    ]);
    expect((await buildRuntimesReport(bad.ctx)).codex.primaryUsedPct).toBeNull();
  });

  it('không có session hoặc dòng hỏng thì quota null', async () => {
    const mac = machine(HEALTHY);
    const folder = join(mac.home, '.codex', 'sessions', '2026', '10', '10');
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'x.jsonl'),
      'not json\n{"type":"event_msg","payload":{"type":"token_count"}}\n',
    );
    const r = await buildRuntimesReport(mac.ctx);
    expect([r.codex.primaryUsedPct, r.codex.resetsAt]).toEqual([null, null]);
  });

  it('thiếu CLI hoặc lệnh lỗi → null, không ném', async () => {
    const { ctx } = machine({}, 44);
    const r = await buildRuntimesReport(ctx);
    expect(r).toEqual({
      codex: { version: null, loggedIn: null, primaryUsedPct: null, resetsAt: null },
      opencode: {
        version: null,
        keyPresent: false,
        costDay: null,
        costWeek: null,
        costMonth: null,
        models: [],
      },
    });
  });

  it('OpenCode chưa có key: stats lỗi vẫn trả trạng thái rõ, không ném', async () => {
    const answers: Answers = {
      ...HEALTHY,
      'opencode stats --days 1 --models': { code: 1, stderr: 'API key is missing' },
      'opencode stats --days 7 --models': { code: 1, stderr: 'API key is missing' },
      'opencode stats --days 30 --models': { code: 1, stderr: 'API key is missing' },
    };
    const { ctx } = machine(answers, 44);
    const r = await buildRuntimesReport(ctx);
    expect(r.opencode).toMatchObject({
      version: '1.18.35',
      keyPresent: false,
      costDay: null,
      costWeek: null,
      costMonth: null,
    });
    expect(JSON.stringify(r)).not.toContain('API key is missing');
  });

  it('codex login thoát khác 0 → loggedIn false; timeout → null', async () => {
    const out = await buildRuntimesReport(
      machine({ ...HEALTHY, 'codex login status': { code: 1, stderr: 'Not logged in' } }).ctx,
    );
    expect(out.codex.loggedIn).toBe(false);
    const slow = await buildRuntimesReport(
      machine({ ...HEALTHY, 'codex login status': { code: 1, timedOut: true } }).ctx,
    );
    expect(slow.codex.loggedIn).toBeNull();
  });

  it('mỗi lệnh có timeout 10 giây và key Keychain không bao giờ bị đọc', async () => {
    const mac = machine(HEALTHY);
    await buildRuntimesReport(mac.ctx);
    const shell = mac.runner.calls.filter((c) => c.command === AGENT_SHELL);
    expect(shell.length).toBeGreaterThan(0);
    expect(shell.every((c) => c.options.timeoutMs === 10_000)).toBe(true);
    const security = mac.runner.calls.filter((c) => c.command === SECURITY_BIN);
    expect(security.every((c) => !c.args.includes('-w') && c.args.includes(KEYCHAIN_SERVICE))).toBe(true);
  });
});

describe('buildMachineReport với runtimes', () => {
  it('gắn khối runtimes và vẫn dưới 64 KB khi models đầy 60 id dài 120 ký tự', async () => {
    const ids = Array.from(
      { length: 60 },
      (_, i) => `opencode-go/${String(i).padStart(2, '0')}${'m'.repeat(106)}`,
    );
    const mac = machine({ ...HEALTHY, 'opencode models opencode-go': { stdout: ids.join('\n') } });
    const report = await buildMachineReport(
      mac.ctx,
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(report.runtimes?.opencode.models).toHaveLength(60);
    expect(report.runtimes?.codex.version).toBe('codex-cli 0.161.0');
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThanOrEqual(MACHINE_REPORT_MAX_BYTES);
  });

  it('runner ném lỗi thì bản tin vẫn tạo được và các trường runtimes là null', async () => {
    const mac = fakeMac();
    mac.runner.on(AGENT_SHELL, () => {
      throw new Error('hỏng');
    });
    const report = await buildMachineReport(
      mac.ctx,
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(report.runtimes?.codex).toMatchObject({ version: null, loggedIn: null });
    expect(report.runtimes?.opencode.models).toEqual([]);
  });
});
