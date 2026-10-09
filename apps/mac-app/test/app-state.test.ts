import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AppStateStore, chromiumUserDataDir, defaultAppState } from '../src/main/app-state.js';

it('tạo file mode 600 với mặc định, update nối tiếp không mất ghi', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-state-'));
  const store = new AppStateStore(join(dir, 'app.json'), '0.1.0');
  await Promise.all([
    store.update((s) => ({ ...s, sshdPid: 1 })),
    store.update((s) => ({ ...s, updateState: 'downloading' })),
  ]);
  const saved = JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8'));
  expect(saved).toMatchObject({ version: 1, appVersion: '0.1.0', sshdPid: 1, updateState: 'downloading' });
  expect(statSync(join(dir, 'app.json')).mode & 0o777).toBe(0o600);
});

it('file hỏng thì dùng mặc định và giữ bản hỏng thành app.json.broken-<giờ>', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-state-'));
  writeFileSync(join(dir, 'app.json'), '{');
  const store = new AppStateStore(join(dir, 'app.json'), '0.1.0');
  expect(store.get()).toEqual(defaultAppState('0.1.0'));
  expect(readdirSync(dir).some((f) => f.startsWith('app.json.broken-'))).toBe(true);
});

it('appVersion luôn là bản đang chạy dù file ghi bản khác', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-state-'));
  writeFileSync(join(dir, 'app.json'), JSON.stringify({ ...defaultAppState('0.0.9'), sshdPid: 7 }));
  const state = new AppStateStore(join(dir, 'app.json'), '0.1.0').get();
  expect(state.appVersion).toBe('0.1.0');
  expect(state.sshdPid).toBe(7);
});

it('get trả bản sao: sửa bản sao không đổi trạng thái', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-state-'));
  const store = new AppStateStore(join(dir, 'app.json'), '0.1.0');
  store.get().update.badVersions.push('9.9.9');
  expect(store.get().update.badVersions).toEqual([]);
});

it('thiếu khóa thì bù mặc định, báo thay đổi cho người nghe', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-state-'));
  writeFileSync(join(dir, 'app.json'), JSON.stringify({ version: 1, sshdOwner: 'app' }));
  const store = new AppStateStore(join(dir, 'app.json'), '0.1.0');
  expect(store.get()).toMatchObject({ sshdOwner: 'app', updateState: 'idle', projects: {} });
  let calls = 0;
  store.onChange(() => calls++);
  await store.update((s) => ({ ...s, sshdPid: 5 }));
  expect(calls).toBe(1);
});

it('userData của Chromium nằm ở thư mục con chromium, cạnh app.json', () => {
  expect(chromiumUserDataDir('/Users/o/Library/Application Support/2P Crew/app.json')).toBe(
    '/Users/o/Library/Application Support/2P Crew/chromium',
  );
});
