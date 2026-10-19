import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import {
  addStatusRepo,
  configureStatus,
  listStatusRepos,
  sendDocsSnapshots,
  sendStatus,
} from '../src/commands/status.js';
import { addTarget, listTargets } from '../src/status/targets.js';
import { fakeMac, gitIn } from './helpers/fake-mac.js';
import type { FakeRunner } from './helpers/fake-runner.js';

const COMPANY_A = '22222222-2222-4222-8222-222222222222';
const COMPANY_B = '33333333-3333-4333-8333-333333333333';
const PROJECT_A = '44444444-4444-4444-8444-444444444444';
const PROJECT_B = '55555555-5555-4555-8555-555555555555';

/** Keychain giả: `security -i` ghi theo service, `find-generic-password -s <service> -w` đọc lại. */
function fakeKeychain(runner: FakeRunner, initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(initial));
  runner.on('security', (args, options) => {
    if (args[0] === '-i') {
      const match = /add-generic-password -U -s (\S+) -a crew-mac -w "(.*)"\n$/.exec(String(options.input));
      if (!match) return { code: 1 };
      store.set(match[1] as string, (match[2] as string).replaceAll('\\"', '"').replaceAll('\\\\', '\\'));
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

function recordingFetch(statusFor: (url: string, body: { companyId: string }) => number = () => 200) {
  const requests: { url: string; body: Record<string, unknown>; signature: string | null }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url: String(url), body, signature: new Headers(init?.headers).get('X-Crew-Signature') });
    return new Response('', { status: statusFor(String(url), body) });
  };
  return { requests, fetcher };
}

function commitRepo(dir: string): string {
  mkdirSync(join(dir, 'docs'), { recursive: true });
  gitIn(dir, 'init', '-q', '-b', 'main');
  gitIn(dir, 'config', 'crew-docs.bundle', resolve('../..', 'packages/docs-kit/dist/crew-docs.cjs'));
  writeFileSync(join(dir, 'docs', 'index.md'), '# Docs\n');
  gitIn(dir, 'add', '.');
  gitIn(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

describe('crew-mac status: nhiều đích', () => {
  it('status.json kiểu cũ được đọc như một đích với service Keychain cũ', () => {
    const { ctx, home } = fakeMac();
    writeFileSync(
      join(home, '.crew', 'status.json'),
      JSON.stringify({
        url: 'https://paperclip.example',
        companyId: COMPANY_A,
        machineId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    expect(listTargets(ctx)).toEqual([
      { url: 'https://paperclip.example', companyId: COMPANY_A, keychainService: 'crew-mac-status' },
    ]);
  });

  it('chưa cấu hình hoặc thiếu companyId thì không có đích', () => {
    const { ctx, home } = fakeMac();
    expect(listTargets(ctx)).toEqual([]);
    mkdirSync(join(home, '.crew'), { recursive: true });
    writeFileSync(
      join(home, '.crew', 'status.json'),
      JSON.stringify({ url: 'https://paperclip.example', machineId: '11111111-1111-4111-8111-111111111111' }),
    );
    expect(listTargets(ctx)).toEqual([]);
  });

  it('add-target ghi secret qua stdin vào service riêng của company, không lên argv', async () => {
    const { ctx, runner, home } = fakeMac();
    const store = fakeKeychain(runner);
    const config = configureStatus(ctx, 'https://paperclip.example', COMPANY_A);
    const target = await addTarget(ctx, { companyId: COMPANY_B, secret: 'b-secret"x\n' });
    expect(target).toEqual({
      url: 'https://paperclip.example',
      companyId: COMPANY_B,
      keychainService: 'crew-mac-status-33333333',
    });
    expect(store.get('crew-mac-status-33333333')).toBe('b-secret"x');
    expect(runner.calls.every((c) => c.args.every((a) => !a.includes('b-secret')))).toBe(true);
    const saved = JSON.parse(readFileSync(join(home, '.crew', 'status.json'), 'utf8'));
    expect(saved.machineId).toBe(config.machineId);
    expect(saved.targets).toEqual([
      { url: 'https://paperclip.example', companyId: COMPANY_A, keychainService: 'crew-mac-status' },
      target,
    ]);
    expect(listTargets(ctx)).toHaveLength(2);
    // Gọi lại cùng company: không nhân đôi đích, chỉ ghi lại secret.
    await addTarget(ctx, { companyId: COMPANY_B, secret: 'b2' });
    expect(listTargets(ctx)).toHaveLength(2);
    expect(store.get('crew-mac-status-33333333')).toBe('b2');
  });

  it('add-target cho company của đích cũ giữ service cũ; config lại không làm mất đích phụ', async () => {
    const { ctx, runner } = fakeMac();
    const store = fakeKeychain(runner);
    configureStatus(ctx, 'https://paperclip.example', COMPANY_A);
    await addTarget(ctx, { companyId: COMPANY_A, secret: 'a-new' });
    expect(listTargets(ctx)).toEqual([
      { url: 'https://paperclip.example', companyId: COMPANY_A, keychainService: 'crew-mac-status' },
    ]);
    expect(store.get('crew-mac-status')).toBe('a-new');
    await addTarget(ctx, { companyId: COMPANY_B, secret: 'b' });
    configureStatus(ctx, 'https://paperclip.example', COMPANY_A);
    expect(listTargets(ctx).map((t) => t.companyId)).toEqual([COMPANY_A, COMPANY_B]);
  });

  it('add-target chưa có cấu hình thì cần --url; URL và company sai thì từ chối', async () => {
    const { ctx, runner, home } = fakeMac();
    fakeKeychain(runner);
    await expect(addTarget(ctx, { companyId: COMPANY_B, secret: 's' })).rejects.toThrow('--url');
    await expect(addTarget(ctx, { companyId: 'bad', secret: 's', url: 'https://x.example' })).rejects.toThrow(
      'UUID',
    );
    await expect(
      addTarget(ctx, { companyId: COMPANY_B, secret: 's', url: 'https://u:p@x.example' }),
    ).rejects.toThrow('origin');
    await expect(
      addTarget(ctx, { companyId: COMPANY_B, secret: 'a\nb', url: 'https://x.example' }),
    ).rejects.toThrow('một dòng');
    const target = await addTarget(ctx, { companyId: COMPANY_B, secret: 's', url: 'https://x.example/' });
    expect(target.url).toBe('https://x.example');
    const saved = JSON.parse(readFileSync(join(home, '.crew', 'status.json'), 'utf8'));
    expect(saved.machineId).toMatch(/^[0-9a-f-]{36}$/);
    expect(listTargets(ctx)).toEqual([target]);
  });

  it('send gửi cho từng đích cùng machineId; đích lỗi không chặn đích sau, chỉ in company id', async () => {
    const { ctx, runner, home, out } = fakeMac();
    fakeKeychain(runner, { 'crew-mac-status': 'secret-a', 'crew-mac-status-33333333': 'secret-b' });
    const config = configureStatus(ctx, 'https://paperclip.example', COMPANY_A);
    await addTarget(ctx, { companyId: COMPANY_B, secret: 'secret-b' });
    const { requests, fetcher } = recordingFetch((_url, body) => (body.companyId === COMPANY_A ? 500 : 200));
    await expect(sendStatus(ctx, fetcher)).rejects.toThrow();
    const machine = requests.filter((r) => r.url.endsWith('/machine-status'));
    expect(machine.map((r) => r.body.companyId)).toEqual([COMPANY_A, COMPANY_B]);
    expect(new Set(machine.map((r) => r.body.machineId))).toEqual(new Set([config.machineId]));
    // Mỗi đích ký bằng secret của nó.
    expect(machine[0]?.signature).not.toBe(machine[1]?.signature);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(COMPANY_A);
    expect(out[0]).toContain('HTTP 500');
    expect(out.join('\n')).not.toContain('secret-');
    const last = JSON.parse(readFileSync(join(home, '.crew', 'status-last.json'), 'utf8'));
    expect(last).toMatchObject({
      ok: false,
      httpStatus: 500,
      targets: [
        { companyId: COMPANY_A, ok: false, httpStatus: 500 },
        { companyId: COMPANY_B, ok: true, httpStatus: 200 },
      ],
    });
  });

  it('thiếu secret của một đích chỉ làm hỏng đích đó', async () => {
    const { ctx, runner, out } = fakeMac();
    const store = fakeKeychain(runner, { 'crew-mac-status': 'secret-a' });
    configureStatus(ctx, 'https://paperclip.example', COMPANY_A);
    await addTarget(ctx, { companyId: COMPANY_B, secret: 'x' });
    store.delete('crew-mac-status-33333333');
    const { requests, fetcher } = recordingFetch();
    await expect(sendStatus(ctx, fetcher)).rejects.toThrow();
    expect(requests.map((r) => r.body.companyId)).toEqual([COMPANY_A]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('Keychain');
    expect(out[0]).toContain(COMPANY_B);
  });

  it('ảnh chụp docs: repo có companyId chỉ đi tới đích của company đó, repo không có thì đi đích đầu', async () => {
    const { ctx, runner, home, out } = fakeMac();
    fakeKeychain(runner, { 'crew-mac-status': 'secret-a', 'crew-mac-status-33333333': 'secret-b' });
    configureStatus(ctx, 'https://a.example', COMPANY_A);
    await addTarget(ctx, { companyId: COMPANY_B, secret: 'secret-b', url: 'https://b.example' });
    const repoA = commitRepo(join(home, 'repo-a'));
    const repoB = commitRepo(join(home, 'repo-b'));
    addStatusRepo(ctx, PROJECT_A, repoA);
    addStatusRepo(ctx, PROJECT_B, repoB, COMPANY_B);
    expect(listStatusRepos(ctx).find((r) => r.projectId === PROJECT_B)?.companyId).toBe(COMPANY_B);
    const { requests, fetcher } = recordingFetch();
    expect(await sendDocsSnapshots(ctx, fetcher)).toBe(true);
    expect(out).toEqual([]);
    expect(requests.map((r) => [r.url, r.body.projectId, r.body.companyId])).toEqual([
      ['https://a.example/api/plugins/crew.core/webhooks/docs-snapshot', PROJECT_A, COMPANY_A],
      ['https://b.example/api/plugins/crew.core/webhooks/docs-snapshot', PROJECT_B, COMPANY_B],
    ]);
  });

  it('ảnh chụp docs: repo của company không còn đích thì báo lỗi riêng repo đó', async () => {
    const { ctx, runner, home, out } = fakeMac();
    fakeKeychain(runner, { 'crew-mac-status': 'secret-a' });
    configureStatus(ctx, 'https://a.example', COMPANY_A);
    addStatusRepo(ctx, PROJECT_B, commitRepo(join(home, 'repo-b')), COMPANY_B);
    const { requests, fetcher } = recordingFetch();
    expect(await sendDocsSnapshots(ctx, fetcher)).toBe(false);
    expect(requests).toEqual([]);
    expect(out.join('\n')).toContain(PROJECT_B);
  });

  it('add-repo từ chối companyId không phải UUID', () => {
    const { ctx, home } = fakeMac();
    expect(() => addStatusRepo(ctx, PROJECT_A, commitRepo(join(home, 'r')), 'bad')).toThrow('UUID');
  });

  it('CLI add-target đọc secret từ stdin, không in secret; list-targets in đích', async () => {
    const { ctx, runner } = fakeMac();
    const store = fakeKeychain(runner);
    configureStatus(ctx, 'https://paperclip.example', COMPANY_A);
    const { out: _out, ...context } = ctx;
    const lines: string[] = [];
    const io = {
      out: (line: string) => lines.push(line),
      err: (line: string) => lines.push(line),
      env: {},
      context,
      readStdin: () => 'cli-secret\n',
    };
    expect(await main(['status', 'add-target', '--company', COMPANY_B], io)).toBe(2);
    expect(lines.join('\n')).toContain('--secret-stdin');
    lines.length = 0;
    expect(await main(['status', 'add-target', '--company', COMPANY_B, '--secret-stdin'], io)).toBe(0);
    expect(store.get('crew-mac-status-33333333')).toBe('cli-secret');
    expect(lines.join('\n')).not.toContain('cli-secret');
    lines.length = 0;
    expect(await main(['status', 'list-targets'], io)).toBe(0);
    expect(lines).toEqual([
      `${COMPANY_A}\thttps://paperclip.example\tcrew-mac-status`,
      `${COMPANY_B}\thttps://paperclip.example\tcrew-mac-status-33333333`,
    ]);
  });
});
