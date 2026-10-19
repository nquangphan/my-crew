import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createMoveStep,
  createV2Step,
  detectV2,
  removeV2,
  type V2Deps,
} from '../src/main/setup/v2-removal.js';
import { fakeRunner } from './setup-fakes.js';

const V2_ID = 'com.2p-solutions.crew';
const NEW_ID = 'com.2p-solutions.crew.mac';

/** `/Applications` giả; `bundleId` null = không có app. */
function setup(options: { bundleId: string | null; pids?: string; plistCode?: number }) {
  const applications = mkdtempSync(join(tmpdir(), 'v2-apps-'));
  const appPath = join(applications, '2P Crew.app');
  if (options.bundleId) mkdirSync(join(appPath, 'Contents'), { recursive: true });
  const runner = fakeRunner({
    [`/usr/libexec/PlistBuddy -c Print :CFBundleIdentifier ${appPath}/Contents/Info.plist`]: {
      code: options.plistCode ?? 0,
      stdout: `${options.bundleId}\n`,
    },
    [`/usr/bin/pgrep -f ${appPath}/Contents/MacOS/`]: options.pids ? { stdout: options.pids } : { code: 1 },
    [`/usr/bin/osascript -e tell application "System Events" to delete (every login item whose path is "${appPath}")`]:
      {},
    [`/usr/bin/tccutil reset All ${V2_ID}`]: {},
  });
  const trashItem = vi.fn(async (_path: string) => undefined);
  const deps: V2Deps = {
    applicationsDir: applications,
    runner,
    exists: (path) => {
      try {
        statSync(path);
        return true;
      } catch {
        return false;
      }
    },
    trashItem,
    selfPid: 99999,
  };
  return { deps, runner, trashItem, appPath, applications };
}

function hashTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        out.push(`${path} d ${stat.mode}`);
        walk(path);
      } else {
        out.push(`${path} ${createHash('sha256').update(readFileSync(path)).digest('hex')} ${stat.mode}`);
      }
    }
  };
  walk(root);
  return out;
}

function fakeV2Home(): string {
  const home = mkdtempSync(join(tmpdir(), 'v2-home-'));
  const data = join(home, '.crew');
  for (const dir of ['runtime', 'assistant', 'logs', 'bin']) mkdirSync(join(data, dir), { recursive: true });
  const files: Record<string, string> = {
    'config.yaml': 'server: x\n',
    'desktop.json': '{"a":1}',
    'settings-cache.json': '{}',
    'state.db': 'sqlite',
    'runtime/a.js': 'x',
    'assistant/b.md': 'memo',
    'logs/daemon.log': 'log',
    'bin/crew-mac': '#!/bin/sh',
    'status.json': '{}',
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(data, name), content);
  return home;
}

describe('detectV2', () => {
  it('thấy app v2, chưa chạy', async () => {
    const { deps, appPath } = setup({ bundleId: V2_ID });
    expect(await detectV2(deps)).toEqual({
      appPath,
      bundleId: V2_ID,
      isV2: true,
      running: false,
      isSelf: false,
    });
  });

  it('pgrep thấy pid khác mình thì đang chạy; chỉ pid của chính app mới thì không', async () => {
    expect((await detectV2(setup({ bundleId: V2_ID, pids: '4321\n' }).deps)).running).toBe(true);
    expect((await detectV2(setup({ bundleId: V2_ID, pids: '99999\n' }).deps)).running).toBe(false);
  });

  it('bundle id của app mới thì isSelf, không phải v2', async () => {
    const found = await detectV2(setup({ bundleId: NEW_ID }).deps);
    expect(found).toMatchObject({ isSelf: true, isV2: false, running: false });
  });

  it('không có app, hoặc không đọc được bundle id, thì không phải v2', async () => {
    expect(await detectV2(setup({ bundleId: null }).deps)).toMatchObject({ appPath: null, isV2: false });
    const unreadable = await detectV2(setup({ bundleId: 'x', plistCode: 1 }).deps);
    expect(unreadable).toMatchObject({ bundleId: null, isV2: false });
  });
});

describe('removeV2', () => {
  it('chỉ vào Thùng rác một lần, reset TCC bundle v2 một lần, dữ liệu v2 trong HOME nguyên vẹn', async () => {
    const home = fakeV2Home();
    const before = hashTree(home);
    const { deps, runner, trashItem, appPath } = setup({ bundleId: V2_ID });
    const result = await removeV2(deps, ['login-item', 'trash', 'tcc']);
    expect(trashItem).toHaveBeenCalledTimes(1);
    expect(trashItem).toHaveBeenCalledWith(appPath);
    expect(runner.calls.filter((c) => c === `/usr/bin/tccutil reset All ${V2_ID}`)).toHaveLength(1);
    expect(runner.calls.some((c) => c.includes('/.crew'))).toBe(false);
    expect(result.removed).toHaveLength(3);
    expect(hashTree(home)).toEqual(before);
  });

  it('login item cũ gỡ trước khi chuyển app vào Thùng rác', async () => {
    const { deps, runner, trashItem } = setup({ bundleId: V2_ID });
    const order: string[] = [];
    trashItem.mockImplementation(async () => {
      order.push('trash');
    });
    const original = runner.run.bind(runner);
    runner.run = async (command, args, options) => {
      if (command === '/usr/bin/osascript') order.push('login-item');
      return original(command, args, options);
    };
    await removeV2(deps, ['login-item', 'trash', 'tcc']);
    expect(order).toEqual(['login-item', 'trash']);
  });

  it('luôn nhắc login item SMAppService gỡ tay trong Cài đặt hệ thống', async () => {
    const { deps } = setup({ bundleId: V2_ID });
    const result = await removeV2(deps, ['login-item', 'trash', 'tcc']);
    expect(result.blocked).toBe(false);
    expect(result.manual.join('\n')).toContain('Mục đăng nhập');
  });

  it('app v2 đang chạy: không làm gì, nhờ owner thoát', async () => {
    const { deps, runner, trashItem } = setup({ bundleId: V2_ID, pids: '4321\n' });
    const result = await removeV2(deps, ['login-item', 'trash', 'tcc']);
    expect(trashItem).not.toHaveBeenCalled();
    expect(runner.calls.some((c) => c.includes('osascript') || c.includes('tccutil'))).toBe(false);
    expect(result).toMatchObject({
      removed: [],
      blocked: true,
      manual: ['Thoát app 2P Crew cũ (menu → Thoát) rồi bấm Thử lại'],
    });
  });

  it('bundle trong Applications là chính app mới: không vào Thùng rác, không đụng login item, vẫn reset TCC v2', async () => {
    const { deps, runner, trashItem } = setup({ bundleId: NEW_ID });
    const result = await removeV2(deps, ['login-item', 'trash', 'tcc']);
    expect(trashItem).not.toHaveBeenCalled();
    expect(runner.calls.some((c) => c.includes('osascript'))).toBe(false);
    expect(runner.calls).toContain(`/usr/bin/tccutil reset All ${V2_ID}`);
    expect(result.removed).toHaveLength(1);
  });

  it('không có app v2: không có gì để gỡ', async () => {
    const { deps, runner, trashItem } = setup({ bundleId: null });
    expect(await removeV2(deps, ['login-item', 'trash', 'tcc'])).toEqual({
      removed: [],
      manual: [],
      blocked: false,
    });
    expect(trashItem).not.toHaveBeenCalled();
    expect(runner.calls.some((c) => c.includes('tccutil'))).toBe(false);
  });

  it('chỉ làm đúng các hành động owner xác nhận', async () => {
    const { deps, runner, trashItem } = setup({ bundleId: V2_ID });
    await removeV2(deps, ['tcc']);
    expect(trashItem).not.toHaveBeenCalled();
    expect(runner.calls.some((c) => c.includes('osascript'))).toBe(false);
    expect(runner.calls).toContain(`/usr/bin/tccutil reset All ${V2_ID}`);
  });

  it('osascript lỗi thì dặn gỡ tay, vẫn chuyển app vào Thùng rác', async () => {
    const { deps, runner, trashItem } = setup({ bundleId: V2_ID });
    const original = runner.run.bind(runner);
    runner.run = async (command, args, options) =>
      command === '/usr/bin/osascript'
        ? { code: 1, stdout: '', stderr: 'not allowed', timedOut: false }
        : original(command, args, options);
    const result = await removeV2(deps, ['login-item', 'trash']);
    expect(trashItem).toHaveBeenCalledTimes(1);
    expect(result.manual.join('\n')).toContain('Mục đăng nhập');
  });

  it('nguồn không nhắc thư mục dữ liệu v2', () => {
    const source = readFileSync(join(__dirname, '../src/main/setup/v2-removal.ts'), 'utf8');
    expect(source).not.toMatch(/['"`]\.crew|\/\.crew|~\/\.crew/);
  });
});

describe('createV2Step', () => {
  it('không có app v2 thì đi tiếp không cần xác nhận', async () => {
    const { deps, trashItem } = setup({ bundleId: null });
    const out = await createV2Step(deps)({});
    expect(out.ok).toBe(true);
    expect(trashItem).not.toHaveBeenCalled();
  });

  it('có app v2 mà chưa xác nhận thì không làm gì và không đi tiếp', async () => {
    const { deps, runner, trashItem } = setup({ bundleId: V2_ID });
    const out = await createV2Step(deps)({});
    expect(out.ok).toBe(false);
    expect(trashItem).not.toHaveBeenCalled();
    expect(runner.calls.some((c) => c.includes('tccutil') || c.includes('osascript'))).toBe(false);
  });

  it('xác nhận xong thì ở lại bước (để hiện hướng dẫn) rồi Tiếp mới đi', async () => {
    const { deps, trashItem } = setup({ bundleId: V2_ID });
    const out = await createV2Step(deps)({ confirm: ['login-item', 'trash', 'tcc'] });
    expect(out).toMatchObject({ ok: true, stay: true });
    expect(out.message).toContain('Mục đăng nhập');
    expect(trashItem).toHaveBeenCalledTimes(1);
  });

  it('hành động ngoài danh sách bị bỏ qua', async () => {
    const { deps, trashItem } = setup({ bundleId: V2_ID });
    await createV2Step(deps)({ confirm: ['rm-data'] });
    expect(trashItem).not.toHaveBeenCalled();
  });

  it('app mới ghi đè chỗ app v2: đi tiếp với {}, reset TCC khi xác nhận', async () => {
    const { deps, runner } = setup({ bundleId: NEW_ID });
    expect((await createV2Step(deps)({})).ok).toBe(true);
    expect(runner.calls.some((c) => c.includes('tccutil'))).toBe(false);
    await createV2Step(deps)({ confirm: ['tcc', 'trash'] });
    expect(runner.calls).toContain(`/usr/bin/tccutil reset All ${V2_ID}`);
  });

  it('app v2 đang chạy: báo lỗi, không đi tiếp', async () => {
    const { deps } = setup({ bundleId: V2_ID, pids: '4321\n' });
    const out = await createV2Step(deps)({ confirm: ['trash'] });
    expect(out).toMatchObject({ ok: false });
    expect(out.message).toContain('Thoát app 2P Crew cũ');
  });
});

describe('createMoveStep', () => {
  const base = (over: Partial<Parameters<typeof createMoveStep>[0]> = {}) => {
    const { deps } = setup({ bundleId: null });
    const move = vi.fn((_opts: { conflictHandler: (type: string) => boolean }) => true);
    const stepDeps = {
      isPackaged: true,
      isInApplicationsFolder: () => false,
      moveToApplicationsFolder: move,
      detect: () => detectV2(deps),
      ...over,
    };
    return { stepDeps, move, deps };
  };

  it('đã ở Applications thì ok, không chuyển', async () => {
    const { stepDeps, move } = base({ isInApplicationsFolder: () => true });
    expect((await createMoveStep(stepDeps)({})).ok).toBe(true);
    expect(move).not.toHaveBeenCalled();
  });

  it('bản chưa đóng gói thì bỏ qua', async () => {
    const { stepDeps, move } = base({ isPackaged: false });
    const out = await createMoveStep(stepDeps)({});
    expect(out.ok).toBe(true);
    expect(move).not.toHaveBeenCalled();
  });

  it('chưa xác nhận thì không chuyển', async () => {
    const { stepDeps, move } = base();
    expect((await createMoveStep(stepDeps)({})).ok).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });

  it('còn app v2 trong Applications thì từ chối, không chuyển', async () => {
    const v2 = setup({ bundleId: V2_ID });
    const { stepDeps, move } = base({ detect: () => detectV2(v2.deps) });
    const out = await createMoveStep(stepDeps)({ confirm: true });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('Gỡ app 2P Crew cũ');
    expect(move).not.toHaveBeenCalled();
  });

  it('xác nhận thì chuyển; chỉ từ chối ghi đè bản đang chạy', async () => {
    const { stepDeps, move } = base();
    const out = await createMoveStep(stepDeps)({ confirm: true });
    expect(out.ok).toBe(true);
    const { conflictHandler } = move.mock.calls[0]?.[0] ?? { conflictHandler: () => false };
    expect(conflictHandler('exists')).toBe(true);
    expect(conflictHandler('existsAndRunning')).toBe(false);
  });

  it('bị từ chối vì bản đang chạy thì nhờ thoát bản đó', async () => {
    const move = vi.fn((opts: { conflictHandler: (type: string) => boolean }) => {
      opts.conflictHandler('existsAndRunning');
      return false;
    });
    const { stepDeps } = base({ moveToApplicationsFolder: move });
    const out = await createMoveStep(stepDeps)({ confirm: true });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('Thoát bản 2P Crew đang chạy trong Applications');
  });

  it('chuyển thất bại vì lý do khác thì báo lỗi', async () => {
    const { stepDeps } = base({ moveToApplicationsFolder: () => false });
    expect((await createMoveStep(stepDeps)({ confirm: true })).ok).toBe(false);
  });
});
