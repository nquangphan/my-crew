import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import { isIpcChannel, STATE_CHANGED_EVENT } from '../shared/ipc-contract.js';

/**
 * Cửa duy nhất của renderer vào app: `invoke(kênh, ...tham số)` chỉ cho kênh trong `IPC_CHANNELS`, và
 * `on(listener)` nghe sự kiện `state:changed`. Mọi tham số được Main kiểm lại.
 */
contextBridge.exposeInMainWorld('crew', {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!isIpcChannel(channel)) return Promise.reject(new Error(`Kênh không hợp lệ: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (listener: (name: string) => void) => {
    const handler = (_event: IpcRendererEvent) => listener(STATE_CHANGED_EVENT);
    ipcRenderer.on(STATE_CHANGED_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(STATE_CHANGED_EVENT, handler);
    };
  },
});
