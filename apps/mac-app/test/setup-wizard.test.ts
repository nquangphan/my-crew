import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AppStateStore } from '../src/main/app-state.js';
import type { ExistingMachine } from '../src/main/setup/import-existing.js';
import { checkMachine } from '../src/main/setup/machine-check.js';
import { createMachineStep } from '../src/main/setup/machine-step.js';
import {
  createDoctorStep,
  createPaperclipStep,
  createWizard,
  STEP_ORDER,
  type WizardDeps,
} from '../src/main/setup/wizard.js';
import { fakeRunner } from './setup-fakes.js';

const TAILSCALE = '/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4';
const CLAUDE = '/bin/zsh -lc claude auth status';

describe('checkMachine', () => {
  const healthy = {
    '/usr/bin/sw_vers -productVersion': { stdout: '26.6.2\n' },
    [TAILSCALE]: { stdout: '100.101.102.103\n' },
    [CLAUDE]: { stdout: '{\n  "loggedIn": true\n}\n' },
  };

  it('máy đủ điều kiện thì ok cả ba', async () => {
    const result = await checkMachine(fakeRunner(healthy));
    expect(result.ok).toBe(true);
    expect(result.lines.map((l) => l.id)).toEqual(['macos', 'tailscale', 'claude']);
  });

  it('macOS cũ hơn 15 báo đúng câu', async () => {
    const result = await checkMachine(
      fakeRunner({ ...healthy, '/usr/bin/sw_vers -productVersion': { stdout: '14.7\n' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatchObject({
      ok: false,
      message: 'Cần macOS 15 trở lên (máy đang chạy 14.7)',
    });
  });

  it('Tailscale chưa chạy hoặc claude chưa đăng nhập', async () => {
    const result = await checkMachine(
      fakeRunner({
        '/usr/bin/sw_vers -productVersion': { stdout: '15.0' },
        [TAILSCALE]: { code: 1, stderr: 'not logged in' },
        [CLAUDE]: { stdout: '{"loggedIn": false}' },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines[1]?.message).toBe('Mở Tailscale và đăng nhập');
    expect(result.lines[2]?.message).toBe('Chạy claude và đăng nhập một lần trong Terminal');
  });
});

const existing: ExistingMachine = {
  kind: 'existing',
  port: 2222,
  worktreeRoot: '/Users/owner/crew-agents',
  statusUrl: 'https://crew.example.com',
  companyId: '11111111-1111-4111-8111-111111111111',
  hasWebhookSecret: true,
};
const COMPANY = '22222222-2222-4222-8222-222222222222';

async function machineHarness(detected: ExistingMachine) {
  const calls: Array<[string, unknown[]]> = [];
  const ops = {
    call: vi.fn(async (op: string, ...args: unknown[]) => {
      calls.push([op, args]);
      if (op === 'installCrewMacFrom') return { installed: true, version: '0.2.0', backup: null };
      if (op === 'setup') return { changed: ['manifest'], restarted: [], sshdHandoff: 'unchanged' };
      return undefined;
    }),
  };
  const dir = mkdtempSync(join(tmpdir(), 'wizard-'));
  const store = new AppStateStore(join(dir, 'app.json'), '0.1.0');
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
  });
  return { step, calls, ops };
}

describe('bước machine', () => {
  it('máy có sẵn: cài crew-mac mang theo rồi setup({}) không cờ, không sinh key', async () => {
    const { step, calls } = await machineHarness(existing);
    const result = await step({});
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Nhận cài đặt có sẵn');
    expect(calls.map(([op]) => op)).toEqual(['installCrewMacFrom', 'configureStatus', 'setup']);
    expect(calls[0]?.[1]).toEqual(['/Applications/2P Crew.app/Contents/Resources/crew-mac']);
    expect(calls[1]?.[1]).toEqual(['https://crew.example.com', COMPANY]);
    expect(calls[2]?.[1]).toEqual([{}]);
    expect(calls.some(([op]) => op === 'setStatusSecret')).toBe(false);
  });

  it('máy có sẵn giữ nguyên url bản tin cũ, chỉ cập nhật company', async () => {
    const { step, calls } = await machineHarness({ ...existing, statusUrl: 'http://100.105.105.12:3100' });
    expect((await step({})).ok).toBe(true);
    expect(calls.find(([op]) => op === 'configureStatus')?.[1]).toEqual([
      'http://100.105.105.12:3100',
      COMPANY,
    ]);
  });

  it('máy có sẵn nhưng chưa có url thì dùng origin Paperclip đang đăng nhập', async () => {
    const { step, calls } = await machineHarness({ ...existing, statusUrl: null });
    await step({});
    expect(calls.find(([op]) => op === 'configureStatus')?.[1]).toEqual([
      'https://crew.example.com',
      COMPANY,
    ]);
  });

  it('máy mới: bắt buộc key ssh-ed25519 và secret, mặc định cổng 2222 và ~/crew-agents', async () => {
    const { step, calls } = await machineHarness({ kind: 'fresh' });
    expect((await step({})).ok).toBe(false);
    expect((await step({ paperclipKey: 'ssh-rsa AAAA', webhookSecret: 's' })).message).toContain(
      'ssh-ed25519',
    );
    expect((await step({ paperclipKey: 'ssh-ed25519 AAAA key', webhookSecret: '' })).ok).toBe(false);
    expect(calls).toHaveLength(0);

    const input = { paperclipKey: 'ssh-ed25519 AAAA key', webhookSecret: 'bi-mat' };
    const result = await step(input);
    expect(result.ok).toBe(true);
    const ops = calls.map(([op]) => op);
    expect(ops).toEqual(['installCrewMacFrom', 'setStatusSecret', 'configureStatus', 'setup']);
    expect(calls[1]?.[1]).toEqual(['bi-mat']);
    expect(calls[3]?.[1]).toEqual([
      { paperclipKey: 'ssh-ed25519 AAAA key', port: 2222, worktreeRoot: '/Users/owner/crew-agents' },
    ]);
    expect(input.webhookSecret).toBe('');
  });

  it('thư mục gốc bị cấm thì lỗi đúng lý do và không gọi gì', async () => {
    const { step, calls } = await machineHarness({ kind: 'fresh' });
    const result = await step({
      paperclipKey: 'ssh-ed25519 AAAA key',
      webhookSecret: 'x',
      worktreeRoot: '/Volumes/CORSAIR/agents',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('/Volumes');
    expect(calls).toHaveLength(0);
  });

  it('manifest hỏng, chưa chọn company, cài crew-mac bị từ chối', async () => {
    expect(
      (await (await machineHarness({ kind: 'broken', message: 'manifest hỏng' })).step({})).message,
    ).toContain('manifest hỏng');
    const refused = await machineHarness(existing);
    refused.ops.call.mockImplementationOnce(async () => ({
      installed: false,
      version: '0.2.0',
      backup: null,
      reason: 'Từ chối cài vì còn run đang chạy',
    }));
    const result = await refused.step({});
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain('còn run đang chạy');
    expect(refused.calls.map(([op]) => op)).not.toContain('setup');
  });
});

function wizardHarness(overrides: Partial<WizardDeps['steps']> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wizard-'));
  const store = new AppStateStore(join(dir, 'app.json'), '0.1.0');
  const loginItem = { set: vi.fn(() => true), enabled: () => true };
  const ok = async () => ({ ok: true, message: 'xong' });
  const steps: WizardDeps['steps'] = {
    check: ok,
    paperclip: ok,
    machine: ok,
    diskAccess: ok,
    sshd: ok,
    doctor: ok,
    ...overrides,
  };
  const wizard = createWizard({ store, loginItem, steps });
  return { wizard, store, loginItem };
}

describe('wizard', () => {
  it('thứ tự bước đúng plan', () => {
    expect(STEP_ORDER).toEqual([
      'check',
      'v2',
      'move',
      'paperclip',
      'machine',
      'disk-access',
      'sshd',
      'doctor',
      'done',
    ]);
  });

  it('bước xong ghi bước kế tiếp vào app.json; bước v2 và move mặc định đi tiếp', async () => {
    const { wizard, store } = wizardHarness();
    expect(await wizard.step('check', {})).toEqual({ ok: true, message: 'xong', next: 'v2' });
    expect(store.get().setup.step).toBe('v2');
    expect(await wizard.step('v2', {})).toMatchObject({ ok: true, next: 'move' });
    expect(await wizard.step('move', {})).toMatchObject({ ok: true, next: 'paperclip' });
    expect(store.get().setup.step).toBe('paperclip');
  });

  it('bước lỗi giữ nguyên bước đang dở; mở lại app tiếp từ bước dở', async () => {
    const { wizard, store } = wizardHarness({
      check: async () => ({ ok: false, message: 'thiếu Tailscale' }),
    });
    expect(await wizard.step('check', {})).toEqual({ ok: false, message: 'thiếu Tailscale', next: 'check' });
    expect(store.get().setup.step).toBe('check');
    await store.update((s) => ({ ...s, setup: { ...s.setup, step: 'machine' } }));
    expect(wizard.state().step).toBe('machine');
  });

  it('không nhảy cóc tới bước chưa tới lượt', async () => {
    const { wizard, store } = wizardHarness();
    const result = await wizard.step('sshd', {});
    expect(result.ok).toBe(false);
    expect(result.next).toBe('check');
    expect(store.get().setup.step).toBe('check');
  });

  it('chạy lại bước cũ không lùi tiến độ', async () => {
    const { wizard, store } = wizardHarness();
    await store.update((s) => ({ ...s, setup: { ...s.setup, step: 'sshd' } }));
    expect(await wizard.step('machine', {})).toMatchObject({ ok: true });
    expect(store.get().setup.step).toBe('sshd');
  });

  it('doctor ok thì sang done; done mới bật login item và chỉ khi mọi bước trước ok', async () => {
    const { wizard, store, loginItem } = wizardHarness();
    expect((await wizard.step('done', {})).ok).toBe(false);
    expect(loginItem.set).not.toHaveBeenCalled();
    await store.update((s) => ({ ...s, setup: { ...s.setup, step: 'doctor' } }));
    expect(await wizard.step('doctor', {})).toMatchObject({ ok: true, next: 'done' });
    expect(store.get().setup.step).toBe('done');
    expect(loginItem.set).not.toHaveBeenCalled();
    expect(await wizard.step('done', {})).toMatchObject({ ok: true, next: 'done' });
    expect(loginItem.set).toHaveBeenCalledWith(true);
  });

  it('login item cần duyệt thì vẫn xong nhưng nhắc owner', async () => {
    const { wizard, store, loginItem } = wizardHarness();
    loginItem.set.mockReturnValue(false);
    await store.update((s) => ({ ...s, setup: { ...s.setup, step: 'done' } }));
    const result = await wizard.step('done', {});
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Mục đăng nhập');
  });

  it('chạy lại bước khi đã done không đổi tiến độ', async () => {
    const { wizard, store } = wizardHarness({ sshd: async () => ({ ok: false, message: 'hỏng' }) });
    await store.update((s) => ({ ...s, setup: { ...s.setup, step: 'done' } }));
    await wizard.step('sshd', {});
    expect(store.get().setup.step).toBe('done');
  });

  it('bước ném lỗi thì thành kết quả lỗi, không ném ra ngoài', async () => {
    const { wizard } = wizardHarness({
      check: async () => {
        throw new Error('hỏng bất ngờ');
      },
    });
    expect(await wizard.step('check', {})).toEqual({ ok: false, message: 'hỏng bất ngờ', next: 'check' });
  });
});

describe('bước paperclip', () => {
  async function paperclipHarness(origin: string | null) {
    const dir = mkdtempSync(join(tmpdir(), 'wizard-'));
    const store = new AppStateStore(join(dir, 'app.json'), '0.1.0');
    await store.update((s) => ({ ...s, setup: { ...s.setup, paperclipOrigin: origin } }));
    const step = createPaperclipStep({ store, companies: async () => [{ id: COMPANY, name: 'TPS' }] });
    return { step, store };
  }
  it('chưa đăng nhập thì lỗi; company lạ thì lỗi; hợp lệ thì ghi companyId', async () => {
    expect((await (await paperclipHarness(null)).step({ companyId: COMPANY })).ok).toBe(false);
    const { step, store } = await paperclipHarness('https://crew.example.com');
    expect((await step({})).message).toBe('Chọn company.');
    expect((await step({ companyId: 'khac' })).ok).toBe(false);
    expect(store.get().setup.companyId).toBeNull();
    expect(await step({ companyId: COMPANY })).toEqual({ ok: true, message: 'Đã chọn company TPS.' });
    expect(store.get().setup.companyId).toBe(COMPANY);
  });
});

describe('bước doctor', () => {
  const result = (status: 'ok' | 'warn' | 'fail') => ({
    id: `c-${status}`,
    title: `Check ${status}`,
    status,
    detail: 'chi tiết',
  });
  it('ok khi 0 fail (warn vẫn qua) và làm mới sức khỏe', async () => {
    const refreshHealth = vi.fn();
    const call = vi.fn(async () => [result('ok'), result('warn')]);
    const outcome = await createDoctorStep({ ops: { call } as never, refreshHealth })({});
    expect(outcome.ok).toBe(true);
    expect(call).toHaveBeenCalledWith('doctor', { probe: true, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(refreshHealth).toHaveBeenCalled();
  });
  it('có fail thì không ok và nêu từng lỗi', async () => {
    const outcome = await createDoctorStep({ ops: { call: async () => [result('fail')] } as never })({});
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('Check fail: chi tiết');
  });
});
