import { fileURLToPath } from 'node:url';

/**
 * The E2E run deploys the real stack (deploy/compose.yml + deploy/compose.test.yml) as compose project
 * `crew-e2e`, reachable only through its edge nginx on 127.0.0.1:18180, and starts one daemon against it.
 */
export const E2E_PROJECT = 'crew-e2e';
export const E2E_EDGE_PORT = 18180;
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_EDGE_PORT}`;
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Secrets, tokens and the daemon home of a run; gitignored and recreated every run. */
export const E2E_DIR = fileURLToPath(new URL('./.e2e/', import.meta.url));
export const E2E_STATE_FILE = `${E2E_DIR}state.json`;
export const E2E_ENV_FILE = `${E2E_DIR}env`;
export const COMPOSE_TEST_FILE = `${REPO_ROOT}deploy/compose.test.yml`;
/** Key of the project the docs snapshot is synced for. */
export const E2E_PROJECT_KEY = 'SHOP';

export interface E2eState {
  username: string;
  password: string;
  project: { id: string; key: string; name: string };
  /** Hosts the assistant; the daemon under test runs as this machine. */
  assistant: { id: string; token: string };
  /** Owns the project (no daemon runs for it); syncs the docs snapshot. */
  projectOwner: { id: string; token: string };
  daemonPid: number;
  daemonHome: string;
}

/** Environment for scripts/deploy.sh and docker compose calls of the E2E stack. */
export function stackEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CREW_PROJECT: E2E_PROJECT,
    CREW_ENV_FILE: E2E_ENV_FILE,
    CREW_COMPOSE_EXTRA: COMPOSE_TEST_FILE,
    CREW_EDGE_PORT: String(E2E_EDGE_PORT),
  };
}

export const composeArgs = [
  'compose',
  '-p',
  E2E_PROJECT,
  '-f',
  `${REPO_ROOT}deploy/compose.yml`,
  '-f',
  COMPOSE_TEST_FILE,
  '--env-file',
  E2E_ENV_FILE,
];
