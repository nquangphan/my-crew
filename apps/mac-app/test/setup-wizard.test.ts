import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AppStateStore } from '../src/main/app-state.js';
import { checkMachine } from '../src/main/setup/machine-check.js';
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
  const brewNode = async () => ({
    path: '/opt/homebrew/bin/node',
    source: 'homebrew' as const,
    version: '24.11.0',
  });

  it('máy đủ điều kiện thì ok cả bốn', async () => {
    const result = await checkMachine(fakeRunner(healthy), brewNode);
    expect(result.ok).toBe(true);
    expect(result.lines.map((l) => l.id)).toEqual(['macos', 'node', 'tailscale', 'claude']);
    expect(result.lines[1]?.message).toBe('Node 24.11.0 (Homebrew)');
  });

  it('dòng node: tải Node LTS thì báo nguồn; tải lỗi thì không đạt, kèm lỗi và cách sửa', async () => {
    const downloaded = await checkMachine(fakeRunner(healthy), async () => ({
      path: '/Users/owner/.crew/node/bin/node',
      source: 'downloaded',
      version: '24.11.0',
    }));
    expect(downloaded.lines[1]).toEqual({
      id: 'node',
      ok: true,
      message: 'Node 24.11.0 (vừa tải Node LTS, checksum khớp)',
    });
    const failed = await checkMachine(fakeRunner(healthy), async () => {
      throw new Error('Checksum node-v24.11.0-darwin-arm64.tar.gz không khớp SHASUMS256.txt');
    });
    expect(failed.ok).toBe(false);
    expect(failed.lines[1]?.ok).toBe(false);
    expect(failed.lines[1]?.message).toContain('không khớp SHASUMS256.txt');
    expect(failed.lines[1]?.message).toContain('brew install node');
  });

  it('macOS cũ hơn 15 báo đúng câu', async () => {
    const result = await checkMachine(
      fakeRunner({ ...healthy, '/usr/bin/sw_vers -productVersion': { stdout: '14.7\n' } }),
      brewNode,
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
      brewNode,
    );
    expect(result.ok).toBe(false);
    expect(result.lines[2]?.message).toBe('Mở Tailscale và đăng nhập');
    expect(result.lines[3]?.message).toBe('Chạy claude và đăng nhập một lần trong Terminal');
  });
});

const COMPANY = '22222222-2222-4222-8222-222222222222';

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

  it('bước không đi tiếp trả kèm state của bước cho renderer', async () => {
    const { wizard } = wizardHarness({
      check: async () => ({ ok: false, message: 'cần nhập tay', state: 'manual' }),
    });
    expect(await wizard.step('check', {})).toEqual({
      ok: false,
      message: 'cần nhập tay',
      next: 'check',
      state: 'manual',
    });
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
