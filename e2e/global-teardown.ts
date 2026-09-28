import { existsSync, readFileSync, rmSync } from 'node:fs';
import { E2E_DIR, E2E_STATE_FILE, type E2eState } from './env';
import { compose } from './stack';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Stops the daemon (SIGTERM, then SIGKILL after 15 s), removes the stack with its volumes, then the run dir. */
export default async function globalTeardown(): Promise<void> {
  if (existsSync(E2E_STATE_FILE)) {
    const state = JSON.parse(readFileSync(E2E_STATE_FILE, 'utf8')) as E2eState;
    if (alive(state.daemonPid)) {
      process.kill(state.daemonPid, 'SIGTERM');
      for (let i = 0; i < 60 && alive(state.daemonPid); i++) await sleep(250);
      if (alive(state.daemonPid)) process.kill(state.daemonPid, 'SIGKILL');
    }
  }
  if (process.env.CREW_E2E_KEEP_STACK === '1') {
    console.log(`CREW_E2E_KEEP_STACK=1: stack and ${E2E_DIR} kept for inspection`);
    return;
  }
  compose(['down', '-v', '--remove-orphans']);
  rmSync(E2E_DIR, { recursive: true, force: true });
}
