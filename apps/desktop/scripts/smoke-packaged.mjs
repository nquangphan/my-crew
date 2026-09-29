#!/usr/bin/env node
/**
 * Smoke check of a packaged macOS app: launches it the way Finder and the login item do (through LaunchServices,
 * `open -n`, so its stdin/stdout/stderr are /dev/null and there is no terminal) with a throwaway crew home and
 * user-data folder, and waits until the main process logs that the daemon host reported ready. Exits non-zero
 * when the host never gets there. The owner's running app, ~/.crew and login item are not touched.
 *
 * Usage: node scripts/smoke-packaged.mjs ["/path/to/2P Crew.app"]   (default: release/mac-<arch>/2P Crew.app)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const appPath =
  process.argv[2] ?? join(root, 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', '2P Crew.app');
const TIMEOUT_MS = 60_000;

if (process.platform !== 'darwin') throw new Error('smoke-packaged runs on macOS only');
if (!existsSync(appPath)) throw new Error(`no packaged app at ${appPath}; run pnpm package:mac first`);

const work = mkdtempSync(join(tmpdir(), 'crew-smoke-'));
const home = join(work, 'crew');
const userData = join(work, 'user-data');
const appLog = join(home, 'logs', 'app.log');

/** The main process of this launch: the parent of the helpers started with our user-data folder. */
function launchedMainPid() {
  const table = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
  for (const line of table.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match?.[3]?.includes(`--user-data-dir=${userData}`)) return Number(match[2]);
  }
  return null;
}

function hostEvents() {
  if (!existsSync(appLog)) return [];
  return readFileSync(appLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === 'daemon-host' || entry.source === 'host');
}

let ok = false;
try {
  execFileSync('open', [
    '-n',
    '-a',
    appPath,
    '--env',
    `CREW_HOME=${home}`,
    '--env',
    `CREW_DESKTOP_USER_DATA=${userData}`,
    '--env',
    'CREW_DESKTOP_TEST_MODE=1',
  ]);
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (hostEvents().some((entry) => entry.event === 'daemon-host' && entry.state === 'running')) {
      ok = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} finally {
  const pid = launchedMainPid();
  if (pid) {
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 40 && launchedMainPid(); i++)
      await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const events = hostEvents();
  if (!ok) console.error(events.map((entry) => JSON.stringify(entry)).join('\n') || `no ${appLog}`);
  rmSync(work, { recursive: true, force: true });
}
console.log(
  ok ? `ok: the daemon host of ${appPath} reported ready` : 'FAILED: the daemon host never reported ready',
);
process.exit(ok ? 0 : 1);
