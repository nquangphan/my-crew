import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AppStateStore } from '../src/main/app-state.js';
import { PaperclipHttpError } from '../src/main/paperclip/client.js';
import type { PaperclipEnvironment } from '../src/main/paperclip/types.js';
import type { ExistingMachine } from '../src/main/setup/import-existing.js';
import {
  createMachineStep,
  MACHINE_STEP_STATE,
  machineEnvironmentName,
  REVOKED_MESSAGE,
} from '../src/main/setup/machine-step.js';

const COMPANY = '22222222-2222-4222-8222-222222222222';
const MACHINE_ID = '66666666-6666-4666-8666-666666666666';
const PAPERCLIP_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclip crew-mac-paperclip';
const MACHINE_KEY = 'k'.repeat(43);
const FACTS = {
  listenAddress: '100.100.157.19',
  port: 2222,
  worktreeRoot: '/Users/owner/crew-agents',
  knownHostsLine: '[100.100.157.19]:2222 ssh-ed25519 AAAAhost',
  hostKeyFingerprint: `SHA256:${'A'.repeat(43)}`,
  username: 'owner',
  hostname: 'Phans-MacBook-Pro',
};
const OK = { ok: true, httpStatus: 200, failure: null };
const HTTP_401 = { ok: false, httpStatus: 401, failure: 'http' };

const existing: ExistingMachine = {
  kind: 'existing',
  port: 2233,
  worktreeRoot: '/Users/owner/agents',
  statusUrl: 'http://100.105.105.12:3100',
  companyId: COMPANY,
  hasWebhookSecret: true,
};

const TEMPLATE: PaperclipEnvironment = {
  id: 'env-mini',
  name: 'mac-mini',
  driver: 'ssh',
  status: 'active',
  config: {
    host: '100.105.105.12',
    port: 2222,
    username: 'mini',
    privateKeySecretRef: { type: 'secret_ref', secretId: 'secret-ssh' },
    knownHosts: '[100.105.105.12]:2222 ssh-ed25519 AAAAmini',
  },
  metadata: { workspaceRealizationMode: 'in_place', crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 30 } },
};

interface HarnessOptions {
  /** Kết quả `testStatus` theo thứ tự gọi. */
  tests?: Array<Record<string, unknown>>;
  envs?: PaperclipEnvironment[];
  pairInfo?: () => Promise<{ paperclipSshPublicKey: string }>;
  pair?: () => Promise<{ machineKey: string; pairedAt: string }>;
}

async function harness(detected: ExistingMachine, options: HarnessOptions = {}) {
  const calls: Array<[string, unknown[]]> = [];
  const tests = [...(options.tests ?? [OK])];
  const ops = {
    call: vi.fn(async (op: string, ...args: unknown[]) => {
      calls.push([op, args]);
      switch (op) {
        case 'installCrewMacFrom':
          return { installed: true, version: '0.2.0', backup: null };
        case 'configureStatus':
          return { url: args[0], companyId: args[1], machineId: MACHINE_ID };
        case 'testStatus':
          return tests.shift() ?? OK;
        case 'setup':
          return { changed: ['manifest'], restarted: [], sshdHandoff: 'unchanged' };
        case 'machineFacts':
          return FACTS;
        default:
          return undefined;
      }
    }),
  };
  const client = {
    pairInfo: vi.fn(options.pairInfo ?? (async () => ({ paperclipSshPublicKey: PAPERCLIP_KEY }))),
    pairMachine: vi.fn(async (_input: unknown, _options?: unknown) =>
      (options.pair ?? (async () => ({ machineKey: MACHINE_KEY, pairedAt: '2026-10-11T07:00:00Z' })))(),
    ),
    environments: vi.fn(async () => options.envs ?? [TEMPLATE]),
    createEnvironment: vi.fn(async () => ({ id: 'env-new' })),
    archiveEnvironment: vi.fn(async () => undefined),
  };
  const dir = mkdtempSync(join(tmpdir(), 'machine-step-'));
  const file = join(dir, 'app.json');
  const store = new AppStateStore(file, '0.1.0');
  await store.update((s) => ({
    ...s,
    setup: { ...s.setup, paperclipOrigin: 'https://crew.example.com', companyId: COMPANY },
  }));
  const step = createMachineStep({
    ops: ops as never,
    home: '/Users/owner',
    resourcesPath: '/Applications/2P Crew.app/Contents/Resources',
    detect: async () => detected,
    store,
    client: () => client,
  });
  const opNames = () => calls.map(([op]) => op);
  return { step, calls, opNames, client, store, file, ops };
}

const conflict = (code: string | null) => async () => {
  throw new PaperclipHttpError(409, code);
};

describe('bước machine: ghép tự động', () => {
  it('máy mới ghép không dán gì: environment theo máy, key máy chỉ vào Keychain của company', async () => {
    const { step, calls, opNames, client, store, file } = await harness({ kind: 'fresh' });
    const input: Record<string, unknown> = {};
    const result = await step(input);
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toContain('Đã ghép máy');
    expect(opNames()).toEqual([
      'installCrewMacFrom',
      'configureStatus',
      'setup',
      'machineFacts',
      'setTargetSecret',
      'testStatus',
    ]);
    expect(client.pairInfo).toHaveBeenCalledWith(COMPANY);
    expect(calls[1]?.[1]).toEqual(['https://crew.example.com', COMPANY]);
    expect(calls[2]?.[1]).toEqual([
      { paperclipKey: PAPERCLIP_KEY, port: 2222, worktreeRoot: '/Users/owner/crew-agents' },
    ]);
    expect(client.createEnvironment).toHaveBeenCalledWith(COMPANY, {
      name: 'may-phans-macbook-pro',
      description: 'Máy Phans-MacBook-Pro (ghép từ app 2P Crew)',
      host: '100.100.157.19',
      port: 2222,
      username: 'owner',
      remoteWorkspacePath: '/Users/owner/crew-agents',
      privateKeySecretId: 'secret-ssh',
      knownHosts: FACTS.knownHostsLine,
      crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 30 },
    });
    expect(client.pairMachine).toHaveBeenCalledWith(
      {
        companyId: COMPANY,
        machineId: MACHINE_ID,
        hostname: 'Phans-MacBook-Pro',
        environmentId: 'env-new',
        tailscaleIp: '100.100.157.19',
        port: 2222,
        hostKeyFingerprint: FACTS.hostKeyFingerprint,
      },
      {},
    );
    expect(calls.find(([op]) => op === 'setTargetSecret')?.[1]).toEqual([COMPANY, MACHINE_KEY]);
    expect(calls.find(([op]) => op === 'testStatus')?.[1]).toEqual([COMPANY]);
    expect(store.get().setup.pairedEnvironmentId).toBe('env-new');
    // Key máy không vào app state, kết quả hay input.
    expect(readFileSync(file, 'utf8')).not.toContain(MACHINE_KEY);
    expect(JSON.stringify(result)).not.toContain(MACHINE_KEY);
    expect(JSON.stringify(input)).not.toContain(MACHINE_KEY);
    expect(client.archiveEnvironment).not.toHaveBeenCalled();
  });

  it('dùng lại environment đã tạo của máy (cùng tên, host, cổng, known_hosts), không tạo thêm', async () => {
    const mine: PaperclipEnvironment = {
      ...TEMPLATE,
      id: 'env-mine',
      name: 'may-phans-macbook-pro',
      config: {
        ...TEMPLATE.config,
        host: FACTS.listenAddress,
        port: 2222,
        knownHosts: FACTS.knownHostsLine,
        remoteWorkspacePath: FACTS.worktreeRoot,
      },
    };
    const { step, client, store } = await harness({ kind: 'fresh' }, { envs: [TEMPLATE, mine] });
    expect((await step({})).ok).toBe(true);
    expect(client.createEnvironment).not.toHaveBeenCalled();
    expect(client.pairMachine.mock.calls[0]?.[0]).toMatchObject({ environmentId: 'env-mine' });
    expect(store.get().setup.pairedEnvironmentId).toBe('env-mine');
  });

  it('máy có sẵn gửi thử 2xx (Mac mini): giữ nguyên, không hỏi key, không ghép, không đổi key', async () => {
    const { step, calls, opNames, client, store } = await harness(existing, { tests: [OK] });
    const result = await step({});
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Nhận cài đặt có sẵn');
    expect(opNames()).toEqual(['installCrewMacFrom', 'configureStatus', 'testStatus', 'setup']);
    expect(calls[1]?.[1]).toEqual(['http://100.105.105.12:3100', COMPANY]);
    expect(calls[3]?.[1]).toEqual([{}]);
    expect(client.pairInfo).not.toHaveBeenCalled();
    expect(client.pairMachine).not.toHaveBeenCalled();
    expect(client.environments).not.toHaveBeenCalled();
    expect(store.get().setup.pairedEnvironmentId).toBeNull();
  });

  it.each([
    ['401', HTTP_401],
    ['502', { ok: false, httpStatus: 502, failure: 'http' }],
    ['Keychain không đọc được', { ok: false, httpStatus: null, failure: 'keychain' }],
  ])('máy có sẵn gửi thử lỗi %s thì ghép, giữ cổng và thư mục đang có', async (_label, first) => {
    const { step, calls, opNames, client, store } = await harness(existing, { tests: [first, OK] });
    const result = await step({});
    expect(result).toMatchObject({ ok: true });
    expect(opNames()).toEqual([
      'installCrewMacFrom',
      'configureStatus',
      'testStatus',
      'setup',
      'machineFacts',
      'setTargetSecret',
      'testStatus',
    ]);
    expect(calls[3]?.[1]).toEqual([
      { paperclipKey: PAPERCLIP_KEY, port: 2233, worktreeRoot: '/Users/owner/agents' },
    ]);
    expect(client.pairMachine.mock.calls[0]?.[1]).toEqual({});
    expect(store.get().setup.pairedEnvironmentId).toBe('env-new');
  });

  it('máy có sẵn gửi thử lỗi mạng thì dừng, không ghép, không đụng gì thêm', async () => {
    const { step, opNames, client } = await harness(existing, {
      tests: [{ ok: false, httpStatus: null, failure: 'network' }],
    });
    const result = await step({});
    expect(result.ok).toBe(false);
    expect(result.message).toContain('lỗi mạng');
    expect(opNames()).toEqual(['installCrewMacFrom', 'configureStatus', 'testStatus']);
    expect(client.pairInfo).not.toHaveBeenCalled();
    expect(client.pairMachine).not.toHaveBeenCalled();
  });

  it('server chưa có key Paperclip (409 pair-info) thì mở phần dán tay, không đụng vào máy', async () => {
    const { step, opNames } = await harness({ kind: 'fresh' }, { pairInfo: conflict(null) });
    const result = await step({});
    expect(result).toMatchObject({ ok: false, state: MACHINE_STEP_STATE.manual });
    expect(result.message).toContain('Server chưa có key Paperclip');
    expect(opNames()).toEqual([]);
  });

  it('bản tin thử cuối không 2xx thì bước không đạt, báo mã HTTP và không lưu environment đã ghép', async () => {
    const { step, store } = await harness({ kind: 'fresh' }, { tests: [HTTP_401] });
    const result = await step({});
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Server từ chối bản tin máy (HTTP 401). Kiểm company đã chọn.');
    expect(store.get().setup.pairedEnvironmentId).toBeNull();
  });

  it('máy đã bị gỡ trên web: tự ghép không gửi allowRepair, báo rõ, archive environment vừa tạo', async () => {
    const { step, client, opNames, store } = await harness(existing, {
      tests: [HTTP_401],
      pair: conflict('machine_revoked'),
    });
    const result = await step({});
    expect(result).toMatchObject({ ok: false, state: MACHINE_STEP_STATE.revoked, message: REVOKED_MESSAGE });
    expect(client.pairMachine).toHaveBeenCalledTimes(1);
    expect(client.pairMachine.mock.calls[0]?.[1]).toEqual({});
    expect(client.archiveEnvironment).toHaveBeenCalledWith('env-new');
    expect(opNames()).not.toContain('setTargetSecret');
    expect(store.get().setup.pairedEnvironmentId).toBeNull();
  });

  it('owner bấm "Ghép lại máy này": gửi allowRepair, không gửi thử trước', async () => {
    const { step, client, opNames } = await harness(existing, { tests: [OK] });
    const result = await step({ repair: true });
    expect(result.ok).toBe(true);
    expect(client.pairMachine.mock.calls[0]?.[1]).toEqual({ allowRepair: true });
    expect(opNames().filter((op) => op === 'testStatus')).toHaveLength(1);
    expect(opNames().indexOf('testStatus')).toBeGreaterThan(opNames().indexOf('setTargetSecret'));
  });

  it('máy đang gửi bản tin bằng secret company: giữ nguyên cài đặt, không ghép, không đổi key, không lặp lỗi', async () => {
    const { step, client, opNames, store } = await harness(existing, {
      tests: [{ ok: false, httpStatus: 502, failure: 'http' }],
      pair: conflict('machine_uses_company_secret'),
    });
    const result = await step({});
    expect(result.ok).toBe(true);
    expect(result.message).toContain('giữ nguyên cài đặt');
    expect(result.message).toContain('HTTP 502');
    expect(opNames()).not.toContain('setTargetSecret');
    expect(opNames().filter((op) => op === 'testStatus')).toHaveLength(1);
    expect(client.archiveEnvironment).toHaveBeenCalledWith('env-new');
    expect(store.get().setup.pairedEnvironmentId).toBeNull();
  });

  it('company chưa có environment SSH in_place nào làm khuôn thì báo, không ghép', async () => {
    const { step, client } = await harness({ kind: 'fresh' }, { envs: [] });
    const result = await step({});
    expect(result.ok).toBe(false);
    expect(result.message).toContain('environment SSH in_place');
    expect(client.createEnvironment).not.toHaveBeenCalled();
    expect(client.pairMachine).not.toHaveBeenCalled();
  });

  it('lỗi khác khi ghép thì ném (wizard hiện câu lỗi) sau khi archive environment vừa tạo', async () => {
    const { step, client } = await harness({ kind: 'fresh' }, { pair: conflict(null) });
    await expect(step({})).rejects.toThrow('HTTP 409');
    expect(client.archiveEnvironment).toHaveBeenCalledWith('env-new');
  });

  it('chưa chọn company, manifest hỏng, cài crew-mac bị từ chối', async () => {
    const none = await harness({ kind: 'fresh' });
    await none.store.update((s) => ({ ...s, setup: { ...s.setup, companyId: null } }));
    expect((await none.step({})).message).toContain('chọn company');
    expect((await (await harness({ kind: 'broken', message: 'manifest hỏng' })).step({})).message).toContain(
      'manifest hỏng',
    );
    const refused = await harness(existing);
    refused.ops.call.mockImplementationOnce(async () => ({
      installed: false,
      version: '0.2.0',
      backup: null,
      reason: 'Từ chối cài vì còn run đang chạy',
    }));
    const result = await refused.step({});
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain('còn run đang chạy');
    expect(refused.opNames()).not.toContain('setup');
  });

  it('tên environment theo tên máy', () => {
    expect(machineEnvironmentName('Phans-MacBook-Pro')).toBe('may-phans-macbook-pro');
    expect(machineEnvironmentName("Đại Ca's Mac mini")).toBe('may-i-ca-s-mac-mini');
    expect(machineEnvironmentName('---')).toBe('may-mac');
  });
});

describe('bước machine: nhập tay (dự phòng)', () => {
  it('máy mới cần key và secret; secret vào Keychain của company rồi bị xóa khỏi input; bản tin thử phải 2xx', async () => {
    const { step, calls, opNames, client } = await harness({ kind: 'fresh' });
    expect((await step({ manual: true })).ok).toBe(false);
    expect(
      (await step({ manual: true, paperclipKey: 'ssh-rsa AAAA', webhookSecret: 's' })).message,
    ).toContain('ssh-ed25519');
    expect(calls).toHaveLength(0);
    const input = { manual: true, paperclipKey: 'ssh-ed25519 AAAA key', webhookSecret: 'bi-mat' };
    const result = await step(input);
    expect(result.ok).toBe(true);
    expect(opNames()).toEqual([
      'installCrewMacFrom',
      'configureStatus',
      'setTargetSecret',
      'setup',
      'testStatus',
    ]);
    expect(calls[2]?.[1]).toEqual([COMPANY, 'bi-mat']);
    expect(calls[3]?.[1]).toEqual([
      { paperclipKey: 'ssh-ed25519 AAAA key', port: 2222, worktreeRoot: '/Users/owner/crew-agents' },
    ]);
    expect(input.webhookSecret).toBe('');
    expect(client.pairInfo).not.toHaveBeenCalled();
    expect(client.pairMachine).not.toHaveBeenCalled();
  });

  it('nhập tay mà bản tin thử bị từ chối thì không đạt và giữ phần nhập tay mở', async () => {
    const { step } = await harness({ kind: 'fresh' }, { tests: [HTTP_401] });
    const input = { manual: true, paperclipKey: 'ssh-ed25519 AAAA key', webhookSecret: 'sai' };
    const result = await step(input);
    expect(result).toMatchObject({ ok: false, state: MACHINE_STEP_STATE.manual });
    expect(result.message).toContain('HTTP 401');
    expect(input.webhookSecret).toBe('');
  });

  it('thư mục gốc bị cấm thì lỗi đúng lý do và không gọi gì', async () => {
    const { step, calls } = await harness({ kind: 'fresh' });
    const result = await step({
      manual: true,
      paperclipKey: 'ssh-ed25519 AAAA key',
      webhookSecret: 'x',
      worktreeRoot: '/Volumes/CORSAIR/agents',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('/Volumes');
    expect(calls).toHaveLength(0);
  });
});
