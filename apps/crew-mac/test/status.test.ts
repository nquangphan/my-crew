import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { configureStatus, sendStatus, setStatusSecret } from '../src/commands/status.js';
import { buildMachineReport } from '../src/status/report.js';
import { signCrewBody } from '../src/status/sign.js';
import { fakeMac } from './helpers/fake-mac.js';

describe('crew-mac status', () => {
  it('ký đúng raw body theo vector webhook', () => {
    expect(signCrewBody('{"a":1}', 'test-secret', 1760000000)).toEqual({
      'X-Crew-Timestamp': '1760000000',
      'X-Crew-Signature': 'sha256=6ee0c20d3f215ce4a77295bac40239010978f18848bf25541d7bb317e3358411',
    });
  });

  it('config sinh UUID một lần và lưu đúng URL', () => {
    const { ctx, home } = fakeMac();
    const a = configureStatus(ctx, 'https://paperclip.example', '22222222-2222-4222-8222-222222222222');
    const b = configureStatus(ctx, 'https://paperclip.example', '22222222-2222-4222-8222-222222222222');
    expect(a.machineId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(b.machineId).toBe(a.machineId);
    expect(b.companyId).toBe('22222222-2222-4222-8222-222222222222');
    expect(JSON.parse(readFileSync(join(home, '.crew', 'status.json'), 'utf8'))).toEqual(a);
  });

  it('bản tin giữ đúng shape, bỏ chi tiết check và mọi secret env', async () => {
    const { ctx, runner } = fakeMac();
    runner.on('/usr/sbin/sysctl', (args) => ({
      stdout: args.includes('vm.loadavg') ? '{ 2.2 2.0 1.0 }' : '10',
    }));
    runner.on('/usr/bin/memory_pressure', () => ({ stdout: 'System-wide memory free percentage: 52%' }));
    runner.on('/usr/bin/log', () => ({ stdout: '' }));
    runner.on('claude', (args) => ({
      stdout: args.includes('--version') ? '2.1.294' : '{"loggedIn":true,"subscriptionType":"max"}',
    }));
    const report = await buildMachineReport(
      ctx,
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      {
        SECRET_ACCESS_TOKEN: 'sk-test-super-secret-value',
      },
    );
    const body = JSON.stringify(report);
    expect(Object.keys(report).slice(0, 3)).toEqual(['version', 'companyId', 'machineId']);
    expect(report).toMatchObject({
      version: 1,
      companyId: '22222222-2222-4222-8222-222222222222',
      machineId: '11111111-1111-4111-8111-111111111111',
      load1: 2.2,
      cpuCount: 10,
      memFreePct: 52,
      claude: { version: '2.1.294', loggedIn: true, plan: 'max' },
    });
    expect(report.checks.every((c) => Object.keys(c).sort().join(',') === 'id,status,title')).toBe(true);
    expect(body).not.toContain('sk-test-super-secret-value');
    expect(body).not.toContain('SECRET_ACCESS_TOKEN');
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(16 * 1024);
  });

  it('set-secret ghi Keychain qua runner và send dùng chữ ký, ghi kết quả', async () => {
    const { ctx, runner, home } = fakeMac();
    const config = configureStatus(ctx, 'https://paperclip.example', '22222222-2222-4222-8222-222222222222');
    runner.on('security', (args) => (args[0] === 'find-generic-password' ? { stdout: 'test-secret\n' } : {}));
    await setStatusSecret(ctx, 'test-secret\n');
    const added = runner.calls.find((c) => c.command === 'security' && c.args[0] === 'add-generic-password');
    expect(added?.args).toEqual([
      'add-generic-password',
      '-U',
      '-s',
      'crew-mac-status',
      '-a',
      'crew-mac',
      '-w',
      'test-secret',
    ]);
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init: init as RequestInit });
      return new Response('', { status: 200 });
    };
    await sendStatus(ctx, fetcher);
    expect(requests[0]?.url).toBe('https://paperclip.example/api/plugins/crew.core/webhooks/machine-status');
    expect(new Headers(requests[0]?.init.headers).get('X-Crew-Signature')).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(JSON.parse(requests[0]?.init.body as string).machineId).toBe(config.machineId);
    expect(JSON.parse(requests[0]?.init.body as string).companyId).toBe(config.companyId);
    expect(JSON.parse(readFileSync(join(home, '.crew', 'status-last.json'), 'utf8')).ok).toBe(true);
  });

  it('lỗi mạng chỉ ghi một dòng không có secret và trạng thái thất bại', async () => {
    const { ctx, runner, home, out } = fakeMac();
    configureStatus(ctx, 'https://paperclip.example', '22222222-2222-4222-8222-222222222222');
    runner.on('security', () => ({ stdout: 'secret-private\n' }));
    await expect(
      sendStatus(ctx, async () => {
        throw new Error('secret-private network');
      }),
    ).rejects.toThrow();
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain('secret-private');
    expect(JSON.parse(readFileSync(join(home, '.crew', 'status-last.json'), 'utf8')).ok).toBe(false);
  });

  it.each([300, 302, 401, 413, 502])('coi HTTP %i là thất bại và lưu status', async (httpStatus) => {
    const { ctx, runner, home } = fakeMac();
    configureStatus(ctx, 'https://paperclip.example', '22222222-2222-4222-8222-222222222222');
    runner.on('security', () => ({ stdout: 'secret-private\n' }));
    await expect(sendStatus(ctx, async () => new Response('', { status: httpStatus }))).rejects.toThrow();
    expect(JSON.parse(readFileSync(join(home, '.crew', 'status-last.json'), 'utf8'))).toMatchObject({
      ok: false,
      httpStatus,
    });
  });

  it('send từ chối config cũ thiếu companyId và báo tiếng Việt', async () => {
    const { ctx, home, out } = fakeMac();
    configureStatus(ctx, 'https://paperclip.example', '22222222-2222-4222-8222-222222222222');
    const configPath = join(home, '.crew', 'status.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    delete config.companyId;
    writeFileSync(configPath, JSON.stringify(config));
    const { out: _out, ...context } = ctx;
    const lines: string[] = [];
    expect(
      await main(['status', 'send'], {
        out: (line) => lines.push(line),
        err: (line) => lines.push(line),
        env: {},
        context,
      }),
    ).toBe(1);
    expect(lines.join('\n')).toContain('companyId');
    expect(lines.join('\n')).toContain('thiếu');
  });

  it('CLI config yêu cầu company UUID', async () => {
    const { ctx } = fakeMac();
    const { out: _out, ...context } = ctx;
    const lines: string[] = [];
    expect(
      await main(['status', 'config', '--url', 'https://paperclip.example', '--company', 'bad'], {
        out: (line) => lines.push(line),
        err: (line) => lines.push(line),
        env: {},
        context,
      }),
    ).toBe(1);
    expect(lines.join('\n')).toContain('UUID');
  });

  it('CLI send thất bại chỉ in một dòng', async () => {
    const { ctx } = fakeMac();
    const { out: _out, ...context } = ctx;
    const lines: string[] = [];
    expect(
      await main(['status', 'send'], {
        out: (line) => lines.push(line),
        err: (line) => lines.push(line),
        env: {},
        context,
      }),
    ).toBe(1);
    expect(lines).toHaveLength(1);
  });
});
