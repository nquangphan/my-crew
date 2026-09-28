/**
 * Starts the real 2P Crew daemon for the E2E suite with the test config in daemon-test-config.yaml:
 * scripted agent runs, no inventory probe, no crew-docs install. Runs until SIGTERM, then stops cleanly.
 *
 * Env: CREW_HOME (absolute, the daemon home), CREW_E2E_API_URL, CREW_E2E_MACHINE_ID, CREW_E2E_TOKEN,
 * CREW_E2E_PROJECT_ID. Started by e2e/global-setup.ts through tsx.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createDaemon,
  createScriptedRunner,
  FileTokenStore,
  homePaths,
  parseConfig,
  ResourceTracker,
  type RunAgentOptions,
} from '@crew/daemon';
import { parse } from 'yaml';

interface ScriptEntry {
  stage: string;
  run: number;
  steps: Record<string, unknown>[];
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const home = env('CREW_HOME');
const projectId = env('CREW_E2E_PROJECT_ID');
const fixture = parse(readFileSync(new URL('./daemon-test-config.yaml', import.meta.url), 'utf8')) as {
  daemon: Record<string, unknown>;
  scripts: ScriptEntry[];
};
if (!fixture?.daemon || !Array.isArray(fixture.scripts))
  throw new Error('daemon-test-config.yaml is malformed');

const config = parseConfig({
  ...fixture.daemon,
  apiUrl: env('CREW_E2E_API_URL'),
  machineId: env('CREW_E2E_MACHINE_ID'),
});
const paths = homePaths(home);
mkdirSync(paths.home, { recursive: true });
const tokenStore = new FileTokenStore(paths.tokenFile);
tokenStore.set(env('CREW_E2E_TOKEN'));

/** Jobs seen per ticket and step, so the nth job of a step picks the entry with `run: n`. */
const served = new Map<string, string[]>();
function scriptFor(run: RunAgentOptions) {
  const key = `${run.ticketId}|${run.stage ?? ''}`;
  const jobs = served.get(key) ?? [];
  if (!jobs.includes(run.jobId)) jobs.push(run.jobId);
  served.set(key, jobs);
  const n = jobs.indexOf(run.jobId) + 1;
  const entry = fixture.scripts.find((candidate) => candidate.stage === run.stage && candidate.run === n);
  log('info', 'scripted run', { ticket: run.ticketKey, stage: run.stage, run: n, matched: Boolean(entry) });
  return { skills: [], mcpServers: [], steps: (entry?.steps ?? []) as never[] };
}

function fill(value: unknown, run: RunAgentOptions): unknown {
  if (typeof value === 'string')
    return value.replaceAll('@{project}', projectId).replaceAll('@{key}', run.ticketKey);
  if (Array.isArray(value)) return value.map((item) => fill(item, run));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, run)]));
  }
  return value;
}

function log(level: string, message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), level, message, ...fields }));
}

const daemon = createDaemon({
  config,
  home,
  tokenStore,
  runner: createScriptedRunner({
    sessionsDir: join(home, 'scripted-sessions'),
    script: scriptFor,
    resolve: (input, run) => fill(input, run) as Record<string, unknown>,
  }),
  inventory: false,
  crewDocsSource: null,
  tracker: new ResourceTracker({ dockerBin: null }),
  slots: () => config.resources.maxConcurrentJobs,
  logger: log,
});

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    daemon.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        log('error', 'stop failed', { error: String(error) });
        process.exit(1);
      },
    );
  });
}

await daemon.start();
log('info', 'e2e daemon started', { machineId: config.machineId, apiUrl: config.apiUrl });
