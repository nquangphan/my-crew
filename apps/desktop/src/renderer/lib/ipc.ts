import type {
  DesktopEventName,
  DesktopEventPayload,
  DesktopInput,
  DesktopMethod,
  DesktopOutput,
} from '@crew/shared';
import { useEffect, useRef } from 'react';

interface CrewBridge {
  invoke: (
    method: string,
    input: unknown,
  ) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
  on: (listener: (name: string, payload: unknown) => void) => () => void;
}

declare global {
  interface Window {
    crew: CrewBridge;
  }
}

/** A typed call to the app; rejects with the Vietnamese message the main process or daemon returned. */
export async function invoke<M extends DesktopMethod>(
  method: M,
  input: DesktopInput<M>,
): Promise<DesktopOutput<M>> {
  const answer = await window.crew.invoke(method, input);
  if (!answer.ok) throw new Error(answer.error);
  return answer.result as DesktopOutput<M>;
}

/** Subscribes to one app event for the lifetime of the component. */
export function useDesktopEvent<E extends DesktopEventName>(
  name: E,
  listener: (payload: DesktopEventPayload<E>) => void,
): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(
    () =>
      window.crew.on((event, payload) => {
        if (event === name) ref.current(payload as DesktopEventPayload<E>);
      }),
    [name],
  );
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/**
 * Sends the renderer's uncaught errors and unhandled rejections (React 19 reports uncaught render errors
 * the same way) to the main process, which writes them to `~/.crew/logs/app.log`.
 */
export function reportRendererErrors(target: Window = window): void {
  const report = (kind: 'error' | 'unhandledrejection', reason: unknown) => {
    const error = reason instanceof Error ? reason : null;
    const message = clip(error?.message ?? String(reason ?? 'lỗi không rõ'), 2_000);
    const stack = error?.stack ? clip(error.stack, 10_000) : undefined;
    target.crew
      .invoke('app.reportError', { kind, message, ...(stack ? { stack } : {}) })
      .catch(() => undefined);
  };
  target.addEventListener('error', (event) => report('error', event.error ?? event.message));
  target.addEventListener('unhandledrejection', (event) => report('unhandledrejection', event.reason));
}
