import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDaemon,
  createScriptedRunner,
  type Daemon,
  FileTokenStore,
  homePaths,
  parseConfig,
  ResourceTracker,
  type RunAgentOptions,
} from '../../daemon/src/library.js';
import { E2E_API_URL } from './e2e-env';

export interface ScriptedDaemon {
  daemon: Daemon;
  /** Every run the daemon started, with the prompt it rendered. */
  runs: RunAgentOptions[];
  stop(): Promise<void>;
}

/**
 * The real daemon (stream, settings, scheduler, role planner, ticket tools) of a paired machine, in this test
 * process, with scripted agent runs: each run comments the prompt line that contains `marker`, so a test can
 * see on the web which prompt the job rendered. `stop()` stops it and removes its temp home.
 */
export async function startScriptedDaemon(input: {
  machineId: string;
  machineName: string;
  token: string;
  marker: string;
}): Promise<ScriptedDaemon> {
  const home = mkdtempSync(join(tmpdir(), 'crew-e2e-daemon-'));
  const paths = homePaths(home);
  const tokenStore = new FileTokenStore(paths.tokenFile);
  tokenStore.set(input.token);
  const config = parseConfig({
    apiUrl: E2E_API_URL,
    machineName: input.machineName,
    machineId: input.machineId,
    projects: [],
    resources: { maxConcurrentJobs: 1, minFreeMemGb: 0, maxLoadPerCpu: 64 },
  });
  const runs: RunAgentOptions[] = [];
  const runner = createScriptedRunner({
    sessionsDir: join(home, 'scripted-sessions'),
    script: (run) => {
      runs.push(run);
      const line = run.prompt.split('\n').find((text) => text.includes(input.marker));
      return {
        steps: [
          {
            tool: 'mcp__tickets__select_capabilities',
            input: { skills: [], mcps: [], noneReason: 'bước E2E chỉ bình luận' },
          },
          {
            tool: 'mcp__tickets__comment',
            input: { body: line ? `Prompt của lượt chạy: ${line.trim()}` : 'Prompt không có dấu E2E' },
          },
        ],
      };
    },
  });
  const daemon = createDaemon({
    config,
    home,
    tokenStore,
    runner,
    inventory: false,
    crewDocsSource: null,
    tracker: new ResourceTracker({ dockerBin: null }),
    slots: () => 1,
    logger: () => {},
    timings: { heartbeatMs: 5_000, tickMs: 200, stream: { minBackoffMs: 100, maxBackoffMs: 500 } },
  });
  await daemon.start();
  let stopped = false;
  return {
    daemon,
    runs,
    async stop() {
      if (stopped) return;
      stopped = true;
      await daemon.stop();
      rmSync(home, { recursive: true, force: true });
      rmSync(paths.tmp, { recursive: true, force: true });
    },
  };
}
