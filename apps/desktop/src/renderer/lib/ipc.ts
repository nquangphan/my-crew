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
