import { fileURLToPath } from 'node:url';

/**
 * The desktop E2E run has its own API port and database, so it never touches a dev server, dev data, or the
 * web E2E run (8798 / crew_e2e_test).
 */
export const E2E_API_PORT = 8799;
export const E2E_API_URL = `http://127.0.0.1:${E2E_API_PORT}`;
export const E2E_DATABASE_URL =
  process.env.DESKTOP_E2E_DATABASE_URL ?? 'postgres://crew:crew@127.0.0.1:55432/crew_desktop_e2e_test';
export const E2E_ADMIN_DATABASE_URL = E2E_DATABASE_URL.replace(/\/[^/]+$/, '/crew');
/** Written by the prepare step (owner credentials, pairing codes); gitignored and recreated every run. */
export const E2E_STATE_FILE = fileURLToPath(new URL('../../.e2e/state.json', import.meta.url));
/** The staged app (`node scripts/stage-app.mjs`): bundled code plus Electron-ABI native modules. */
export const STAGED_APP = fileURLToPath(new URL('../../.stage/app', import.meta.url));

export interface E2eState {
  username: string;
  password: string;
  totpSecret: string;
  pairingCodes: string[];
  project: { key: string; repoUrl: string };
}

export function assertE2eDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test'))
    throw new Error(`Refusing to use "${name}" for E2E: the name must end with _test`);
}
