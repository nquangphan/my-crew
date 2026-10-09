import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIpc } from '../src/main/ipc.js';
import { IPC_CHANNELS, STATE_CHANGED_EVENT } from '../src/shared/ipc-contract.js';

describe('IPC_CHANNELS', () => {
  it('không trùng tên và đủ kênh của từng gói', () => {
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length);
    for (const channel of [
      'health:run',
      'health:last',
      'runs:list',
      'runs:cancel',
      'runs:openWeb',
      'health:action',
      'logs:tail',
      'logs:reveal',
      'setup:state',
      'setup:step',
      'setup:v2Detect',
      'paperclip:login',
      'paperclip:loginStatus',
      'paperclip:companies',
      'projects:list',
      'projects:add',
      'projects:remove',
      'update:state',
      'update:check',
      'update:installWhenIdle',
      'update:rollback',
    ]) {
      expect(IPC_CHANNELS, channel).toContain(channel);
    }
  });
});

describe('preload', () => {
  const exposed: Record<
    string,
    { invoke: (c: string, ...a: unknown[]) => Promise<unknown>; on: (l: (n: string) => void) => () => void }
  > = {};
  const ipcRenderer = {
    invoke: vi.fn(async () => ({ ok: true, result: 1 })),
    on: vi.fn(),
    removeListener: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetModules();
    ipcRenderer.invoke.mockClear();
    vi.doMock('electron', () => ({
      contextBridge: {
        exposeInMainWorld: (name: string, api: never) => {
          exposed[name] = api;
        },
      },
      ipcRenderer,
    }));
    await import('../src/preload/index.js');
  });

  it('chỉ chuyển kênh nằm trong IPC_CHANNELS', async () => {
    for (const channel of IPC_CHANNELS) await exposed.crew?.invoke(channel);
    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(IPC_CHANNELS.length);
    await expect(exposed.crew?.invoke('shell:exec', 'rm')).rejects.toThrow('Kênh không hợp lệ: shell:exec');
    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(IPC_CHANNELS.length);
  });

  it('đăng ký và gỡ người nghe sự kiện state:changed', () => {
    const off = exposed.crew?.on(() => undefined);
    expect(ipcRenderer.on).toHaveBeenCalledWith(STATE_CHANGED_EVENT, expect.any(Function));
    off?.();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(STATE_CHANGED_EVENT, expect.any(Function));
  });
});

describe('registerIpc', () => {
  const fakeIpc = () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    return { handlers, ipcMain: { handle: (c: string, f: never) => void handlers.set(c, f) } };
  };
  const trusted = { senderFrame: { url: 'file:///app/out/renderer/index.html' } };
  const options = { isTrusted: (url: string) => url.startsWith('file:///app/'), log: vi.fn() };

  it('chỉ handle kênh trong danh sách', () => {
    const { handlers, ipcMain } = fakeIpc();
    registerIpc(ipcMain, options);
    expect([...handlers.keys()].sort()).toEqual([...IPC_CHANNELS].sort());
  });

  it('kênh chưa có handler trả lỗi "Chưa hỗ trợ"', async () => {
    const { handlers, ipcMain } = fakeIpc();
    registerIpc(ipcMain, options);
    expect(await handlers.get('health:run')?.(trusted, true)).toEqual({
      ok: false,
      error: 'Chưa hỗ trợ: health:run',
    });
  });

  it('gọi handler đã đăng ký, chuyển lỗi thành {ok:false}', async () => {
    const { handlers, ipcMain } = fakeIpc();
    const registry = registerIpc(ipcMain, options);
    registry.handle('runs:list', async () => []);
    registry.handle('logs:reveal', async () => {
      throw new Error('hỏng');
    });
    expect(await handlers.get('runs:list')?.(trusted)).toEqual({ ok: true, result: [] });
    expect(await handlers.get('logs:reveal')?.(trusted, 'app')).toEqual({ ok: false, error: 'hỏng' });
  });

  it('từ chối người gửi không tin cậy', async () => {
    const { handlers, ipcMain } = fakeIpc();
    const registry = registerIpc(ipcMain, options);
    registry.handle('runs:list', async () => []);
    const answer = await handlers.get('runs:list')?.({ senderFrame: { url: 'https://evil.example/' } });
    expect(answer).toEqual({ ok: false, error: 'Nguồn gửi không được tin cậy' });
  });
});
