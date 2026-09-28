import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';

/**
 * The renderer's only door to the app: typed `invoke(method, input)` calls and event subscriptions. The
 * channel names mirror `DESKTOP_INVOKE_CHANNEL` / `DESKTOP_EVENT_CHANNEL` in `@crew/shared` (a sandboxed
 * preload stays a single dependency-free file). Every input is validated again in the main process.
 */
const INVOKE = 'crew:invoke';
const EVENT = 'crew:event';

contextBridge.exposeInMainWorld('crew', {
  invoke: (method: string, input: unknown) => ipcRenderer.invoke(INVOKE, method, input),
  on: (listener: (name: string, payload: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, name: string, payload: unknown) => listener(name, payload);
    ipcRenderer.on(EVENT, handler);
    return () => {
      ipcRenderer.removeListener(EVENT, handler);
    };
  },
});
