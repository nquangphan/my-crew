import { readdir } from 'node:fs/promises';

export interface FolderAccessHooks {
  /** The read of `path` has not answered after `waitingAfterMs`: most likely a macOS permission prompt is open. */
  onWaiting: (path: string) => void;
  /** The read answered after `onWaiting` fired; `error` is its error code when access was refused. */
  onResolved: (path: string, ms: number, error: string | null) => void;
  waitingAfterMs?: number;
  read?: (path: string) => Promise<unknown>;
}

/**
 * macOS privacy protection makes the first read of a folder under ~/Documents, ~/Desktop, ~/Downloads, iCloud
 * Drive or a removable volume wait until the owner answers "Allow 2P Crew to access …" (the grant is tied to the
 * app's signature, so a rebuilt app asks again). The host's git calls are synchronous: run while that prompt is
 * open, they freeze the whole host until someone clicks. Reading each folder asynchronously first moves the
 * wait to a worker thread, so the host keeps answering and logs that it waits. The folders are read one at a
 * time (one worker blocked at most); a refusal answers at once and the git calls that follow report it.
 */
export async function awaitFolderAccess(paths: readonly string[], hooks: FolderAccessHooks): Promise<void> {
  const read = hooks.read ?? readdir;
  for (const path of paths) {
    const started = Date.now();
    let waiting = false;
    const timer = setTimeout(() => {
      waiting = true;
      hooks.onWaiting(path);
    }, hooks.waitingAfterMs ?? 5_000);
    let error: string | null = null;
    try {
      await read(path);
    } catch (caught) {
      error = (caught as NodeJS.ErrnoException).code ?? (caught as Error).message;
    } finally {
      clearTimeout(timer);
    }
    if (waiting) hooks.onResolved(path, Date.now() - started, error);
  }
}
