import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configureStatus, machineFacts, setTargetSecret, testStatus } from '../src/commands/status.js';
import { macPaths } from '../src/paths.js';
import { addTarget } from '../src/status/targets.js';
import { fakeMac, PAPERCLIP_PUB } from './helpers/fake-mac.js';
import type { FakeRunner } from './helpers/fake-runner.js';

const COMPANY_A = '22222222-2222-4222-8222-222222222222';
const COMPANY_B = '33333333-3333-4333-8333-333333333333';

function fakeKeychain(runner: FakeRunner, initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(initial));
  runner.on('security', (args, options) => {
    if (args[0] === '-i') {
      const match = /add-generic-password -U -s (\S+) -a crew-mac -w "(.*)"\n$/.exec(String(options.input));
      if (!match) return { code: 1 };
      store.set(match[1] as string, match[2] as string);
      return {};
    }
    if (args[0] === 'find-generic-password') {
      const secret = store.get(args[args.indexOf('-s') + 1] as string);
      return secret === undefined ? { code: 44 } : { stdout: `${secret}\n` };
    }
    return { code: 1 };
  });
  return store;
}

function fetchReturning(status: number | Error) {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (url) => {
    urls.push(String(url));
    if (status instanceof Error) throw status;
    return new Response(null, { status });
  };
  return { urls, fetcher };
}

describe('crew-mac testStatus', () => {
  it('gửi đúng một bản tin máy tới đích của company, trả mã HTTP, không ghi status-last', async () => {
    const { ctx, runner, home } = fakeMac();
    fakeKeychain(runner, { 'crew-mac-status': 'secret-a', 'crew-mac-status-33333333': 'secret-b' });
    configureStatus(ctx, 'https://paperclip.example', COMPANY_A);
    await addTarget(ctx, { companyId: COMPANY_B, secret: 'secret-b' });
    const { urls, fetcher } = fetchReturning(204);
    expect(await testStatus(ctx, COMPANY_B, fetcher)).toEqual({ ok: true, httpStatus: 204, failure: null });
    expect(urls).toEqual(['https://paperclip.example/api/plugins/crew.core/webhooks/machine-status']);
    expect(existsSync(join(home, '.crew', 'status-last.json'))).toBe(false);
  });

  it('server từ chối thì trả mã HTTP và failure http', async () => {
    const { ctx, runner } = fakeMac();
    fakeKeychain(runner, { 'crew-mac-status': 'secret-a' });
    configureStatus(ctx, 'https://paperclip.example', COMPANY_A);
    expect(await testStatus(ctx, COMPANY_A, fetchReturning(401).fetcher)).toEqual({
      ok: false,
      httpStatus: 401,
      failure: 'http',
    });
  });

  it('phân biệt lỗi mạng, thiếu secret Keychain và company không có đích', async () => {
    const { ctx, runner } = fakeMac();
    const keychain = fakeKeychain(runner, { 'crew-mac-status': 'secret-a' });
    configureStatus(ctx, 'https://paperclip.example', COMPANY_A);
    const network = fetchReturning(new TypeError('fetch failed'));
    expect(await testStatus(ctx, COMPANY_A, network.fetcher)).toEqual({
      ok: false,
      httpStatus: null,
      failure: 'network',
    });
    keychain.clear();
    const unused = fetchReturning(200);
    expect(await testStatus(ctx, COMPANY_A, unused.fetcher)).toMatchObject({
      ok: false,
      failure: 'keychain',
    });
    expect(unused.urls).toEqual([]);
    expect(await testStatus(ctx, COMPANY_B, unused.fetcher)).toEqual({
      ok: false,
      httpStatus: null,
      failure: 'no-target',
    });
    await expect(testStatus(ctx, 'khong-phai-uuid', unused.fetcher)).rejects.toThrow('UUID');
  });
});

describe('crew-mac setTargetSecret', () => {
  it('chỉ ghi vào service Keychain của đích thuộc company, qua stdin', async () => {
    const { ctx, runner } = fakeMac();
    const keychain = fakeKeychain(runner, { 'crew-mac-status': 'secret-a' });
    configureStatus(ctx, 'https://paperclip.example', COMPANY_A);
    await addTarget(ctx, { companyId: COMPANY_B, secret: 'secret-b' });
    await setTargetSecret(ctx, COMPANY_B, 'key-may-b');
    expect(keychain.get('crew-mac-status-33333333')).toBe('key-may-b');
    expect(keychain.get('crew-mac-status')).toBe('secret-a');
    const argv = runner.calls.map((call) => call.args.join(' ')).join('\n');
    expect(argv).not.toContain('key-may-b');
  });

  it('company không có đích thì ném, không ghi gì', async () => {
    const { ctx, runner } = fakeMac();
    const keychain = fakeKeychain(runner);
    configureStatus(ctx, 'https://paperclip.example', COMPANY_A);
    await expect(setTargetSecret(ctx, COMPANY_B, 'x')).rejects.toThrow('Chưa có đích');
    expect(keychain.size).toBe(0);
  });
});

describe('crew-mac machineFacts', () => {
  function seedInstall(home: string, ip = '100.100.157.19', port = 2222) {
    const paths = macPaths(home);
    mkdirSync(paths.sshdDir, { recursive: true });
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'crew-mac-host', '-f', paths.hostKey]);
    const pub = readFileSync(`${paths.hostKey}.pub`, 'utf8').trim().split(' ').slice(0, 2).join(' ');
    writeFileSync(
      paths.manifest,
      JSON.stringify({
        version: 1,
        port,
        listenAddress: ip,
        worktreeRoot: join(home, 'crew-agents'),
        paperclipKey: PAPERCLIP_PUB,
        installedAt: '2026-10-11T00:00:00.000Z',
      }),
    );
    writeFileSync(paths.knownHosts, `[${ip}]:${port} ${pub}\n`);
    return { paths, pub };
  }

  it('đọc manifest, known_hosts và fingerprint giống ssh-keygen -lf', async () => {
    const { ctx, runner, home } = fakeMac();
    runner.on('scutil', () => ({ stdout: 'Phans-MacBook-Pro\n' }));
    const { paths, pub } = seedInstall(home);
    const expected = execFileSync('ssh-keygen', ['-lf', `${paths.hostKey}.pub`], { encoding: 'utf8' }).split(
      ' ',
    )[1];
    expect(await machineFacts(ctx)).toEqual({
      listenAddress: '100.100.157.19',
      port: 2222,
      worktreeRoot: join(home, 'crew-agents'),
      knownHostsLine: `[100.100.157.19]:2222 ${pub}`,
      hostKeyFingerprint: expected,
      username: ctx.user,
      hostname: 'Phans-MacBook-Pro',
    });
  });

  it('known_hosts lệch manifest hoặc chưa cài thì ném', async () => {
    const { ctx, runner, home } = fakeMac();
    runner.on('scutil', () => ({ stdout: 'mini\n' }));
    await expect(machineFacts(ctx)).rejects.toThrow('chưa cài crew-mac');
    const { paths, pub } = seedInstall(home);
    writeFileSync(paths.knownHosts, `[100.64.0.9]:2222 ${pub}\n`);
    await expect(machineFacts(ctx)).rejects.toThrow('known_hosts');
  });
});
