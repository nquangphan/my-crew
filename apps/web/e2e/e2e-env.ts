import { fileURLToPath } from 'node:url';

/**
 * Deterministic ports and the dedicated database of the E2E run. They differ from the dev defaults
 * (API 8787, Vite 5173, database `crew`) so an E2E run never touches a dev server or dev data.
 */
export const E2E_API_PORT = 8798;
export const E2E_WEB_PORT = 4178;
export const E2E_WEB_ORIGIN = `http://127.0.0.1:${E2E_WEB_PORT}`;
export const E2E_API_URL = `http://127.0.0.1:${E2E_API_PORT}`;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://crew:crew@127.0.0.1:55432/crew_e2e_test';
/** Admin connection used only to create the E2E database when it does not exist yet. */
export const E2E_ADMIN_DATABASE_URL = E2E_DATABASE_URL.replace(/\/[^/]+$/, '/crew');
/** Written by the prepare step (owner credentials, machine tokens); gitignored and recreated every run. */
export const E2E_STATE_FILE = fileURLToPath(new URL('../.e2e/state.json', import.meta.url));

export function assertE2eDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test'))
    throw new Error(`Refusing to use "${name}" for E2E: the name must end with _test`);
}

/** Written by the prepare step, before the API starts. */
export interface PreparedState {
  username: string;
  password: string;
  totpSecret: string;
  pairingCodes: [string, string];
}

/** Completed by the global setup, once the API is up. */
export interface E2eState extends PreparedState {
  project: { id: string; key: string; name: string };
  /** Owns the project and hosts the assistant. */
  machineA: { id: string; name: string; token: string };
  /** Owns nothing; used for the takeover-approval flow. */
  machineB: { id: string; name: string; token: string };
}
