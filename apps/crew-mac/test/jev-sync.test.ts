import { createHmac } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configureStatus } from '../src/commands/status.js';
import { type JevCompanyConfig, keyFingerprint, readJevConfig, writeJevConfig } from '../src/jev/config.js';
import { formatGateLine } from '../src/jev/log.js';
import {
  EVENTS_MAX_BYTES,
  EVENTS_MAX_LINES,
  LOG_KEEP_BYTES,
  LOG_MAX_BYTES,
  pullJevConfig,
  pushJevEvents,
} from '../src/jev/sync.js';
import { macPaths } from '../src/paths.js';
import { LEGACY_KEYCHAIN_SERVICE, type StatusTarget } from '../src/status/targets.js';
import { fakeMac } from './helpers/fake-mac.js';

const CID = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const TARGET_SECRET = 'target-secret-private';
const KEY = 'sk-or-test-0123456789abcdefABCDEF';
const target: StatusTarget = {
  url: 'https://paperclip.example',
  companyId: CID,
  keychainService: LEGACY_KEYCHAIN_SERVICE,
};

const jevEntry = (): JevCompanyConfig => ({
  version: 1,
  enabled: true,
  gateMode: 'shadow',
  model: 'typesafe/jev-1.14',
  threshold: 0.5,
  timeoutMs: 2500,
  keyFingerprint: null,
  pulledAt: '2026-10-06T06:59:00.000Z',
});

interface Sent {
  url: string;
  headers: Headers;
  body: string;
}

/** Mac giả có Keychain trong bộ nhớ: secret của đích, và mục `crew.jev.<cid>` ghi/xóa được. */
function setupSync() {
  const mac = fakeMac();
  const machine = configureStatus(mac.ctx, 'https://paperclip.example', CID);
  const keychain = new Map<string, string>([[LEGACY_KEYCHAIN_SERVICE, TARGET_SECRET]]);
  const service = (args: readonly string[]) => args[args.indexOf('-s') + 1] as string;
  mac.runner.on('security', (args, options) => {
    if (args[0] === 'find-generic-password') {
      const value = keychain.get(service(args));
      return value === undefined ? { code: 44 } : { stdout: `${value}\n` };
    }
    if (args[0] === '-i') {
      const match = /add-generic-password -U -s (\S+) -a crew-mac -w "(.*)"\n$/.exec(String(options.input));
      if (!match) return { code: 1 };
      keychain.set(match[1] as string, match[2] as string);
      return {};
    }
    return { code: 1 };
  });
  mac.runner.on('/usr/bin/security', (args) => {
    const name = service(args);
    if (args[0] === 'find-generic-password') {
      const value = keychain.get(name);
      return value === undefined ? { code: 44 } : { stdout: `${value}\n` };
    }
    if (args[0] === 'delete-generic-password') return keychain.delete(name) ? {} : { code: 44 };
    return { code: 1 };
  });
  const sent: Sent[] = [];
  const respond = (status: number, json: unknown = {}): typeof fetch =>
    (async (url, init) => {
      sent.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response(JSON.stringify(json), { status });
    }) as typeof fetch;
  return { ...mac, paths: macPaths(mac.home), machineId: machine.machineId, keychain, sent, respond };
}

const settings = (extra: Record<string, unknown> = {}) => ({
  version: 7,
  enabled: true,
  gateMode: 'enforce',
  model: 'typesafe/jev-1.14',
  threshold: 0.6,
  timeoutMs: 2000,
  serverShadow: false,
  hasKey: true,
  keyFingerprint: keyFingerprint(KEY),
  ...extra,
});

describe('pullJevConfig', () => {
  it('POST ký HMAC đúng dạng tới /jev/machine/pull với appliedVersion và vân tay hiện tại', async () => {
    const t = setupSync();
    const result = await pullJevConfig(t.ctx, target, t.respond(200, settings({ apiKey: KEY })));
    expect(result).toEqual({ ok: true, errorCode: null });
    const [request] = t.sent;
    expect(request?.url).toBe(`https://paperclip.example/api/crew/companies/${CID}/jev/machine/pull`);
    const ts = request?.headers.get('x-crew-timestamp') as string;
    expect(ts).toBe(String(Math.floor(t.ctx.now().getTime() / 1000)));
    const expected = createHmac('sha256', TARGET_SECRET).update(`${ts}.${request?.body}`).digest('hex');
    expect(request?.headers.get('x-crew-signature')).toBe(`sha256=${expected}`);
    expect(JSON.parse(request?.body as string)).toEqual({
      version: 1,
      companyId: CID,
      machineId: t.machineId,
      sentAt: t.ctx.now().toISOString(),
      appliedVersion: 0,
      keyFingerprint: null,
    });
  });

  it('có apiKey thì ghi Keychain crew.jev.<cid> qua stdin, ghi config 0600 không có key', async () => {
    const t = setupSync();
    await pullJevConfig(t.ctx, target, t.respond(200, settings({ apiKey: KEY })));
    expect(t.keychain.get(`crew.jev.${CID}`)).toBe(KEY);
    expect(t.runner.calls.some((c) => c.args.some((a) => a.includes(KEY)))).toBe(false);
    const raw = readFileSync(t.paths.jevConfig, 'utf8');
    expect(raw).not.toContain(KEY);
    expect(statSync(t.paths.jevConfig).mode & 0o777).toBe(0o600);
    expect(readJevConfig(t.paths.jevConfig)?.companies[CID]).toEqual({
      version: 7,
      enabled: true,
      gateMode: 'enforce',
      model: 'typesafe/jev-1.14',
      threshold: 0.6,
      timeoutMs: 2000,
      keyFingerprint: keyFingerprint(KEY),
      pulledAt: t.ctx.now().toISOString(),
    });
  });

  it('không có apiKey thì không ghi Keychain; lần kéo sau gửi vân tay và version đã áp', async () => {
    const t = setupSync();
    await pullJevConfig(t.ctx, target, t.respond(200, settings({ apiKey: KEY })));
    const writes = () => t.runner.calls.filter((c) => c.command === 'security' && c.args[0] === '-i').length;
    expect(writes()).toBe(1);
    await pullJevConfig(t.ctx, target, t.respond(200, settings()));
    expect(writes()).toBe(1);
    expect(JSON.parse(t.sent[1]?.body as string)).toMatchObject({
      appliedVersion: 7,
      keyFingerprint: keyFingerprint(KEY),
    });
  });

  it('hasKey:false thì xóa key khỏi Keychain', async () => {
    const t = setupSync();
    t.keychain.set(`crew.jev.${CID}`, KEY);
    await pullJevConfig(t.ctx, target, t.respond(200, settings({ hasKey: false, keyFingerprint: null })));
    expect(t.keychain.has(`crew.jev.${CID}`)).toBe(false);
    expect(readJevConfig(t.paths.jevConfig)?.companies[CID]?.keyFingerprint).toBeNull();
  });

  it('server trả mã không 2xx thì không ghi config, trả mã lỗi', async () => {
    const t = setupSync();
    expect(await pullJevConfig(t.ctx, target, t.respond(401, { error: 'bad_signature' }))).toEqual({
      ok: false,
      errorCode: 'http_401',
    });
    expect(existsSync(t.paths.jevConfig)).toBe(false);
  });

  it('response sai dạng (key nhiều dòng, threshold ngoài khoảng) thì bad_response, không ghi gì', async () => {
    const t = setupSync();
    for (const bad of [
      settings({ apiKey: `${KEY}\nx` }),
      settings({ threshold: 2 }),
      settings({ gateMode: 'block' }),
    ]) {
      expect((await pullJevConfig(t.ctx, target, t.respond(200, bad))).errorCode).toBe('bad_response');
    }
    expect(t.keychain.has(`crew.jev.${CID}`)).toBe(false);
    expect(existsSync(t.paths.jevConfig)).toBe(false);
  });

  it('lỗi mạng thì network; không đọc được secret đích thì keychain', async () => {
    const t = setupSync();
    const down = (async () => {
      throw new Error(`down ${TARGET_SECRET}`);
    }) as typeof fetch;
    expect((await pullJevConfig(t.ctx, target, down)).errorCode).toBe('network');
    t.keychain.delete(LEGACY_KEYCHAIN_SERVICE);
    expect((await pullJevConfig(t.ctx, target, t.respond(200, settings()))).errorCode).toBe('keychain');
  });

  it('giữ cấu hình của company khác', async () => {
    const t = setupSync();
    writeJevConfig(t.paths.jevConfig, {
      companies: {
        [OTHER]: {
          version: 1,
          enabled: false,
          gateMode: 'shadow',
          model: 'typesafe/jev-1.14',
          threshold: 0.5,
          timeoutMs: 2500,
          keyFingerprint: null,
          pulledAt: '2026-10-06T06:00:00.000Z',
        },
      },
    });
    await pullJevConfig(t.ctx, target, t.respond(200, settings()));
    expect(Object.keys(readJevConfig(t.paths.jevConfig)?.companies ?? {}).sort()).toEqual(
      [CID, OTHER].sort(),
    );
  });
});

function writeLog(path: string, companies: string[], command = 'ls'): void {
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  // Mỗi company định dạng một lần rồi lặp lại: `redactSecrets` trên lệnh dài tốn vài ms mỗi dòng.
  const cache = new Map<string, string>();
  const line = (companyId: string) =>
    formatGateLine({
      at: new Date('2026-10-06T07:00:00.000Z'),
      companyId,
      runId: null,
      agentId: null,
      cwd: '/x',
      mode: 'shadow',
      category: null,
      blocking: false,
      verdict: 'allow',
      applied: 'allow',
      confidence: 0.9,
      reason: null,
      errorCode: null,
      latencyMs: 300,
      model: 'typesafe/jev-1.14',
      command,
    });
  const lines = companies.map((companyId) => {
    if (!cache.has(companyId)) cache.set(companyId, line(companyId));
    return cache.get(companyId) as string;
  });
  appendFileSync(path, `${lines.join('\n')}\n`);
}

describe('pushJevEvents', () => {
  const events = (s: Sent) => JSON.parse(s.body).events as Array<{ companyId: string }>;

  it('chỉ đẩy dòng của company đích, ký HMAC; con trỏ tiến khi 2xx nên lần sau không gửi lại', async () => {
    const t = setupSync();
    writeLog(t.paths.jevLog, [CID, OTHER, CID]);
    const result = await pushJevEvents(t.ctx, target, t.respond(200, { accepted: 2, duplicates: 0 }));
    expect(result).toEqual({ ok: true, errorCode: null, sent: 2, rejected: 0 });
    expect(t.sent).toHaveLength(1);
    const [request] = t.sent;
    expect(request?.url).toBe(`https://paperclip.example/api/crew/companies/${CID}/jev/machine/events`);
    expect(request?.headers.get('x-crew-signature')).toMatch(/^sha256=[0-9a-f]{64}$/);
    const body = JSON.parse(request?.body as string);
    expect(body).toMatchObject({ version: 1, companyId: CID, machineId: t.machineId });
    expect(events(request as Sent).map((e) => e.companyId)).toEqual([CID, CID]);
    await pushJevEvents(t.ctx, target, t.respond(200));
    expect(t.sent).toHaveLength(1);
  });

  it('server lỗi thì con trỏ đứng yên và lần sau gửi lại đúng các dòng đó', async () => {
    const t = setupSync();
    writeLog(t.paths.jevLog, [CID, CID]);
    expect(await pushJevEvents(t.ctx, target, t.respond(503))).toEqual({
      ok: false,
      errorCode: 'http_503',
      sent: 0,
      rejected: 0,
    });
    await pushJevEvents(t.ctx, target, t.respond(200));
    expect(t.sent.map((s) => events(s).length)).toEqual([2, 2]);
  });

  it(`chia lô ≤ ${EVENTS_MAX_LINES} dòng`, async () => {
    const t = setupSync();
    writeLog(
      t.paths.jevLog,
      Array.from({ length: 1200 }, () => CID),
    );
    expect((await pushJevEvents(t.ctx, target, t.respond(200))).sent).toBe(1200);
    expect(t.sent.map((s) => events(s).length)).toEqual([500, 500, 200]);
  });

  it('chia lô theo body ≤ 256 KiB', async () => {
    const t = setupSync();
    writeLog(
      t.paths.jevLog,
      Array.from({ length: 300 }, () => CID),
      `echo ${'x'.repeat(1990)}`,
    );
    await pushJevEvents(t.ctx, target, t.respond(200));
    expect(t.sent.length).toBeGreaterThan(1);
    expect(t.sent.every((s) => Buffer.byteLength(s.body) <= EVENTS_MAX_BYTES)).toBe(true);
    expect(t.sent.reduce((n, s) => n + events(s).length, 0)).toBe(300);
  });

  it('dòng đang ghi dở (chưa có xuống dòng) để lượt sau', async () => {
    const t = setupSync();
    writeLog(t.paths.jevLog, [CID]);
    appendFileSync(t.paths.jevLog, '{"v":1,"companyId"');
    await pushJevEvents(t.ctx, target, t.respond(200));
    expect(events(t.sent[0] as Sent)).toHaveLength(1);
  });

  it('đẩy hết mà file > 5 MiB thì cắt file về 0', async () => {
    const t = setupSync();
    writeLog(
      t.paths.jevLog,
      Array.from({ length: 2300 }, () => CID),
      `echo ${'x'.repeat(1990)}`,
    );
    expect(statSync(t.paths.jevLog).size).toBeGreaterThan(5 * 1024 * 1024);
    const result = await pushJevEvents(t.ctx, target, t.respond(200));
    expect(result).toMatchObject({ ok: true, sent: 2300 });
    expect(statSync(t.paths.jevLog).size).toBe(0);
    writeLog(t.paths.jevLog, [CID]);
    await pushJevEvents(t.ctx, target, t.respond(200));
    expect(events(t.sent.at(-1) as Sent)).toHaveLength(1);
  });

  it('không có log thì không gửi gì', async () => {
    const t = setupSync();
    expect(await pushJevEvents(t.ctx, target, t.respond(200))).toEqual({
      ok: true,
      errorCode: null,
      sent: 0,
      rejected: 0,
    });
    expect(t.sent).toHaveLength(0);
  });

  it('server báo rejected thì trả số dòng bị loại', async () => {
    const t = setupSync();
    writeLog(t.paths.jevLog, [CID, CID, CID]);
    const result = await pushJevEvents(
      t.ctx,
      target,
      t.respond(200, { accepted: 1, duplicates: 0, rejected: 2 }),
    );
    expect(result).toMatchObject({ ok: true, sent: 3, rejected: 2 });
  });

  it('lượt khác đang giữ khóa đồng bộ thì bỏ qua, không gửi gì', async () => {
    const t = setupSync();
    writeLog(t.paths.jevLog, [CID]);
    mkdirSync(`${t.paths.jevLog}.sync.lock`);
    expect(await pushJevEvents(t.ctx, target, t.respond(200))).toMatchObject({ ok: true, sent: 0 });
    expect(t.sent).toHaveLength(0);
  });

  it('cắt file chỉ chờ company có cấu hình Jev, không chờ đích chưa từng có Jev', async () => {
    const t = setupSync();
    writeJevConfig(t.paths.jevConfig, { companies: { [CID]: jevEntry() } });
    // Đích thứ hai (OTHER) có trong status.json nhưng chưa từng kéo cấu hình Jev.
    const statusPath = join(t.home, '.crew', 'status.json');
    const status = JSON.parse(readFileSync(statusPath, 'utf8'));
    status.targets = [
      { url: 'https://paperclip.example', companyId: CID, keychainService: LEGACY_KEYCHAIN_SERVICE },
      { url: 'https://other.example', companyId: OTHER, keychainService: 'crew-mac-status-33333333' },
    ];
    writeFileSync(statusPath, JSON.stringify(status));
    writeLog(
      t.paths.jevLog,
      Array.from({ length: 2300 }, () => CID),
      `echo ${'x'.repeat(1990)}`,
    );
    await pushJevEvents(t.ctx, target, t.respond(200));
    expect(statSync(t.paths.jevLog).size).toBe(0);
  });

  it('file vượt 20 MiB vì một đích lỗi lâu: giữ 10 MiB cuối, ghi một dòng dropped cho company bị mất dòng', async () => {
    const t = setupSync();
    writeJevConfig(t.paths.jevConfig, { companies: { [CID]: jevEntry(), [OTHER]: jevEntry() } });
    writeLog(
      t.paths.jevLog,
      Array.from({ length: 9300 }, () => OTHER),
      `echo ${'x'.repeat(1990)}`,
    );
    writeLog(t.paths.jevLog, [CID, CID]);
    const before = statSync(t.paths.jevLog).size;
    expect(before).toBeGreaterThan(LOG_MAX_BYTES);
    const result = await pushJevEvents(t.ctx, target, t.respond(200));
    expect(result).toMatchObject({ ok: true, sent: 2 });
    const after = readFileSync(t.paths.jevLog, 'utf8');
    expect(Buffer.byteLength(after)).toBeLessThanOrEqual(LOG_KEEP_BYTES + 4096);
    const lines = after.trim().split('\n');
    // Mọi dòng còn lại là dòng nguyên vẹn; dòng cuối là tổng kết dropped của OTHER.
    expect(lines.every((line) => JSON.parse(line).v === 1)).toBe(true);
    const last = JSON.parse(lines.at(-1) as string);
    expect(last).toMatchObject({ companyId: OTHER, verdict: 'error', errorCode: 'dropped', command: '' });
    const keptOther = lines.filter(
      (l) => JSON.parse(l).companyId === OTHER && !l.includes('"dropped"'),
    ).length;
    expect(Number(last.reason.replace('dropped:', ''))).toBe(9300 - keptOther);
    // Con trỏ của CID vẫn trỏ cuối phần đã đẩy; dòng dropped (của OTHER) nằm sau và không gửi cho CID.
    await pushJevEvents(t.ctx, target, t.respond(200));
    expect(t.sent).toHaveLength(1);
  });
});
