import {
  IPC_CHANNELS,
  type IpcAnswer,
  type IpcArgs,
  type IpcChannel,
  type IpcResult,
} from '../shared/ipc-contract.js';

interface IpcMainLike {
  handle(
    channel: string,
    listener: (
      event: { senderFrame?: { url: string } | null },
      ...args: unknown[]
    ) => Promise<IpcAnswer<unknown>>,
  ): void;
}

export interface IpcOptions {
  /** URL của frame gửi có phải renderer của app. */
  isTrusted: (url: string) => boolean;
  log: (event: string, fields: Record<string, unknown>) => void;
}

export interface IpcRegistry {
  handle<C extends IpcChannel>(
    channel: C,
    handler: (...args: IpcArgs<C>) => Promise<IpcResult<C>> | IpcResult<C>,
  ): void;
}

/** Renderer đúng khi URL cùng thư mục file (bản đóng gói) hoặc cùng origin (dev server). */
export function isTrustedSender(url: string, rendererUrl: string): boolean {
  try {
    const sender = new URL(url);
    const renderer = new URL(rendererUrl);
    if (renderer.protocol === 'file:') {
      const dir = renderer.pathname.slice(0, renderer.pathname.lastIndexOf('/') + 1);
      return sender.protocol === 'file:' && sender.pathname.startsWith(dir);
    }
    return sender.origin === renderer.origin;
  } catch {
    return false;
  }
}

/**
 * Đăng ký `ipcMain.handle` cho đúng các kênh của `IPC_CHANNELS` (kênh lạ không có handler nên Electron từ chối).
 * Kênh có trong danh sách mà chưa ai cài handler trả `Chưa hỗ trợ: <kênh>`. Lỗi của handler thành `{ ok: false }`.
 */
export function registerIpc(ipcMain: IpcMainLike, options: IpcOptions): IpcRegistry {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (event, ...args) => {
      const url = event.senderFrame?.url ?? '';
      if (!options.isTrusted(url)) {
        options.log('ipc-untrusted-sender', { channel, url });
        return { ok: false, error: 'Nguồn gửi không được tin cậy' };
      }
      const handler = handlers.get(channel);
      if (!handler) return { ok: false, error: `Chưa hỗ trợ: ${channel}` };
      try {
        return { ok: true, result: await handler(...(args as never[])) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.log('ipc-error', { channel, message });
        return { ok: false, error: message };
      }
    });
  }
  return {
    handle(channel, handler) {
      handlers.set(channel, handler as (...args: never[]) => unknown);
    },
  };
}
