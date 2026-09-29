import { writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HostHandlers } from './host-main.js';

/**
 * Entry of the daemon host, an Electron utility process forked by the main process's supervisor. It installs
 * the crash handlers before anything else runs, then loads the host (and every library it bundles) with a
 * dynamic import: an error while loading is written to stderr, which the main process forwards to app.log, and
 * ends the process so the supervisor restarts it, instead of leaving a host that never reports ready.
 */

/** Synchronous: on macOS a write to a pipe through `process.stderr` is lost when `process.exit` follows. */
function toStderr(text: string): void {
  try {
    writeSync(2, `${text}\n`);
  } catch {
    // no stderr to report to
  }
}

let handlers: HostHandlers = {
  crash: (error) => {
    toStderr(`daemon host crashed while starting: ${error.stack ?? error.message}`);
    process.exit(1);
  },
  rejection: (reason) => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    toStderr(`daemon host unhandled rejection while starting: ${detail}`);
  },
};
process.on('uncaughtException', (error) => handlers.crash(error));
process.on('unhandledRejection', (reason) => handlers.rejection(reason));

// The role prompts are copied next to this entry, not next to the chunk the host code lands in.
const promptsDir = fileURLToPath(new URL('./prompts/', import.meta.url));
import('./host-main.js').then(
  ({ runHost }) => {
    handlers = runHost(promptsDir);
  },
  (error: unknown) => handlers.crash(error instanceof Error ? error : new Error(String(error))),
);
