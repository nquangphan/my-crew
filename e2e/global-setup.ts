import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS_COMMIT, DOCS_FILES } from '../apps/web/e2e/docs-fixture';
import {
  E2E_DIR,
  E2E_ENV_FILE,
  E2E_ORIGIN,
  E2E_PROJECT_KEY,
  E2E_STATE_FILE,
  type E2eState,
  REPO_ROOT,
  stackEnv,
} from './env';
import { asMachine, compose, ownerSession } from './stack';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const done = await Promise.resolve()
      .then(check)
      .catch(() => false);
    if (done) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * Deploys the stack exactly as on the VPS (scripts/deploy.sh, plus the test layer with its edge nginx on
 * 127.0.0.1), seeds the owner through the api CLI, pairs two machines, syncs a docs snapshot, and starts the
 * daemon under test as the assistant host. Everything is torn down by global-teardown.ts.
 */
export default async function globalSetup(): Promise<void> {
  rmSync(E2E_DIR, { recursive: true, force: true });
  mkdirSync(E2E_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(
    E2E_ENV_FILE,
    [
      'CREW_DOMAIN=127.0.0.1',
      `PUBLIC_ORIGIN=${E2E_ORIGIN}`,
      `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`,
      `SESSION_SECRET=${randomBytes(32).toString('hex')}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );

  // A leftover stack of an aborted run would keep old data; start from nothing.
  compose(['down', '-v', '--remove-orphans']);
  execFileSync('pnpm', ['--filter', '@crew/daemon...', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  execFileSync(join(REPO_ROOT, 'scripts', 'deploy.sh'), {
    cwd: REPO_ROOT,
    env: stackEnv(),
    stdio: 'inherit',
  });

  const username = 'e2e-owner';
  const password = randomBytes(18).toString('base64url');
  const seeded = compose([
    'exec',
    '-T',
    '-e',
    `CREW_OWNER_PASSWORD=${password}`,
    'crew-api',
    'node',
    'dist/cli/seed-owner.js',
    '--username',
    username,
  ]);
  // The seed CLI sets the password only: it prints no two-factor secret or recovery codes.
  if (!seeded.includes(`Owner "${username}" saved.`) || /totp|secret|recovery|otpauth/i.test(seeded)) {
    throw new Error(`unexpected seed-owner output:\n${seeded}`);
  }
  const owner = { username, password };

  // Pair two machines with owner-created codes (the owner session is enough).
  const ownerCall = await ownerSession(owner);
  const pair = async (name: string) => {
    const { pairingCode } = await ownerCall<{ pairingCode: string }>('POST', '/v1/machines/pairing-codes');
    const res = await fetch(`${E2E_ORIGIN}/v1/machines/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: pairingCode,
        name,
        hostname: `${name}.local`,
        os: 'darwin 25.5',
        hardware: { cpus: 8, memGb: 16 },
      }),
    });
    if (res.status !== 201) throw new Error(`pair ${name} → ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { machineId: string; token: string };
    return { id: body.machineId, token: body.token };
  };
  const assistant = await pair('e2e-assistant');
  const projectOwner = await pair('e2e-project-mac');
  await asMachine(assistant.token)('POST', '/v1/daemon/claims', { hostsAssistant: true });
  const project = await asMachine(projectOwner.token)<{ id: string; key: string; name: string }>(
    'POST',
    '/v1/daemon/projects',
    {
      key: E2E_PROJECT_KEY,
      name: 'Shop API',
      description: 'API bán hàng: đơn hàng, thanh toán, hoàn tiền.',
      repoUrl: 'https://github.com/2p/shop-api.git',
      platform: 'web',
    },
  );
  await asMachine(projectOwner.token)('PUT', `/v1/daemon/projects/${E2E_PROJECT_KEY}/docs`, {
    commit: DOCS_COMMIT,
    branch: 'main',
    files: DOCS_FILES,
  });

  // The daemon under test, through the edge nginx like a real machine.
  const daemonHome = join(E2E_DIR, 'crewd-home');
  const logFile = join(E2E_DIR, 'daemon.log');
  const out = openSync(logFile, 'a');
  const daemon = spawn(process.execPath, ['--import', 'tsx', 'fixtures/run-daemon.ts'], {
    cwd: join(REPO_ROOT, 'e2e'),
    env: {
      ...process.env,
      CREW_HOME: daemonHome,
      CREW_TOKEN_STORE: 'file',
      CREW_E2E_API_URL: E2E_ORIGIN,
      CREW_E2E_MACHINE_ID: assistant.id,
      CREW_E2E_TOKEN: assistant.token,
      CREW_E2E_PROJECT_ID: project.id,
    },
    stdio: ['ignore', out, out],
    detached: true,
  });
  closeSync(out);
  daemon.unref();
  if (!daemon.pid) throw new Error('the daemon did not start');
  const state: E2eState = {
    ...owner,
    project: { id: project.id, key: project.key, name: project.name },
    assistant,
    projectOwner,
    daemonPid: daemon.pid,
    daemonHome,
  };
  writeFileSync(E2E_STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  await waitFor(
    () => readFileSync(logFile, 'utf8').includes('"e2e daemon started"'),
    60_000,
    `the daemon to start (see ${logFile})`,
  );
}
