import { useEffect, useRef } from 'react';
import type { IpcAnswer, IpcArgs, IpcChannel, IpcResult } from '../../shared/ipc-contract';

interface CrewBridge {
  invoke: (channel: string, ...args: unknown[]) => Promise<IpcAnswer<unknown>>;
  on: (listener: (name: string) => void) => () => void;
}

declare global {
  interface Window {
    crew: CrewBridge;
  }
}

/** Gọi một kênh; reject với thông báo tiếng Việt mà Main trả về. */
export async function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  const answer = await window.crew.invoke(channel, ...args);
  if (!answer.ok) throw new Error(answer.error);
  return answer.result as IpcResult<C>;
}

/** Chạy `listener` mỗi khi Main báo `state:changed` (renderer gọi lại kênh đọc của mình). */
export function useStateChanged(listener: () => void): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => window.crew.on(() => ref.current()), []);
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** Gửi lỗi chưa bắt của renderer sang Main để ghi `app.log`. */
export function reportRendererErrors(target: Window = window): void {
  const report = (kind: string, reason: unknown) => {
    const error = reason instanceof Error ? reason : null;
    const message = clip(error?.message ?? String(reason ?? 'lỗi không rõ'), 2_000);
    const stack = error?.stack ? clip(error.stack, 10_000) : undefined;
    invoke('app:reportError', { kind, message, ...(stack ? { stack } : {}) }).catch(() => undefined);
  };
  target.addEventListener('error', (event) => report('error', event.error ?? event.message));
  target.addEventListener('unhandledrejection', (event) => report('unhandledrejection', event.reason));
}
