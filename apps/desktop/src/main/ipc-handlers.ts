import {
  type DesktopMethod,
  type DesktopOutput,
  type DesktopParsed,
  DesktopRequests,
  isDesktopMethod,
} from '@crew/shared';
import { z } from 'zod';

/** Calls the main process answers itself (windows, dialogs, login item, updater, Terminal). */
export type MainHandlers = { [M in DesktopMethod]?: (input: DesktopParsed<M>) => Promise<DesktopOutput<M>> };

/** Everything else goes to the daemon host. */
export type Forward = (method: DesktopMethod, input: unknown) => Promise<unknown>;

export type IpcResult = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * The renderer is untrusted input: the method must be one of the typed requests and its input must match
 * the request schema before anything runs. Errors come back as a message, never as a thrown object.
 */
export async function dispatchDesktopRequest(
  method: unknown,
  input: unknown,
  main: MainHandlers,
  forward: Forward,
): Promise<IpcResult> {
  if (!isDesktopMethod(method)) return { ok: false, error: 'Thao tác không hợp lệ.' };
  const parsed = DesktopRequests[method].input.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: `Dữ liệu không hợp lệ: ${z.prettifyError(parsed.error)}` };
  try {
    const handler = main[method] as ((value: unknown) => Promise<unknown>) | undefined;
    const result = handler ? await handler(parsed.data) : await forward(method, parsed.data);
    return { ok: true, result: result ?? null };
  } catch (error) {
    return { ok: false, error: (error as Error).message || String(error) };
  }
}

/** Only our own bundled renderer (or the dev server in development) may call the IPC. */
export function isTrustedSender(frameUrl: string | undefined, rendererUrl: string): boolean {
  if (!frameUrl) return false;
  try {
    const frame = new URL(frameUrl);
    const renderer = new URL(rendererUrl);
    return (
      frame.protocol === renderer.protocol &&
      frame.host === renderer.host &&
      frame.pathname === renderer.pathname
    );
  } catch {
    return false;
  }
}
