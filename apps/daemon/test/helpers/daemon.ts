import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { inject } from 'vitest';
import { type DaemonConfig, homePaths, parseConfig } from '../../src/config.js';
import { type CreateDaemonOptions, createDaemon, type Daemon } from '../../src/daemon.js';
import type { AgentRunner, RunAgentOptions } from '../../src/runner/agent-runner.js';
import { defaultPlanner } from '../../src/runner/job-runner.js';
import { ResourceTracker } from '../../src/runner/resource-tracker.js';
import { createScriptedRunner, type ScriptInput } from '../../src/runner/scripted-runner.js';
import { FileTokenStore } from '../../src/secrets.js';
import type { Fixture } from './api.js';
import { onCleanup, tempDir, withDeadline } from './git.js';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `check` until it returns a truthy value, or fails after `timeoutMs`. */
export async function waitFor<T>(
  check: () => T | Promise<T>,
  timeoutMs = 15_000,
  what = 'condition',
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const value = await check();
      if (value) return value as NonNullable<T>;
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}${last ? `: ${(last as Error).message}` : ''}`);
    }
    await sleep(50);
  }
}

export function testConfig(
  f: Fixture,
  repoPath: string | null,
  overrides: Partial<DaemonConfig> = {},
): DaemonConfig {
  return parseConfig({
    apiUrl: f.server.url,
    machineName: 'test-mac',
    machineId: f.machine.machineId,
    projects: repoPath ? [{ key: f.projectKey, repoPath, defaultBranch: 'main' }] : [],
    resources: { maxConcurrentJobs: 4, minFreeMemGb: 0, maxLoadPerCpu: 64 },
    ...overrides,
  });
}

export type ScriptSource = string | ScriptInput | ((run: RunAgentOptions) => string | ScriptInput);

export interface ScriptBook {
  /** Script per ticket id (or key); the fallback is an empty run. */
  byTicket: Map<string, ScriptSource>;
  fallback?: ScriptSource;
  /** Every run the scripted runner received, in order. */
  runs: RunAgentOptions[];
}

export function scriptBook(): ScriptBook {
  return { byTicket: new Map(), runs: [] };
}

export function scriptedRunner(book: ScriptBook, sessionsDir: string): AgentRunner {
  const inner = createScriptedRunner({
    sessionsDir,
    script: (run) => {
      const source = book.byTicket.get(run.ticketId) ??
        book.byTicket.get(run.ticketKey) ??
        book.fallback ?? { steps: [] };
      return typeof source === 'function' ? source(run) : source;
    },
  });
  return async (run) => {
    book.runs.push(run);
    return inner(run);
  };
}

/** Fast timers for tests; spread and extend it when a test passes its own `timings`. */
export const TEST_TIMINGS = {
  heartbeatMs: 60_000,
  tickMs: 100,
  recheckMs: 60_000,
  sweepMs: 10 * 60_000,
  cleanupGraceMs: 2_000,
  stream: { minBackoffMs: 50, maxBackoffMs: 200, idleTimeoutMs: 10_000 },
} satisfies CreateDaemonOptions['timings'];

export interface TestDaemon {
  daemon: Daemon;
  home: string;
  book: ScriptBook;
  config: DaemonConfig;
}

/** Inside the 60 s hook timeout, leaving room to close the API server after it. */
const DAEMON_HALT_DEADLINE_MS = 30_000;

/** A daemon on a temp home (file token store, fast timers, scripted runner, no Docker), stopped after the test. */
export function makeDaemon(
  f: Fixture,
  options: {
    repoPath: string | null;
    home?: string;
    book?: ScriptBook;
    config?: Partial<DaemonConfig>;
    extra?: Partial<CreateDaemonOptions>;
  },
): TestDaemon {
  const home = options.home ?? tempDir('crewd-home-');
  const paths = homePaths(home);
  // Job temp dirs live under /tmp, outside the temp home; runs after the daemon stops (cleanups are LIFO).
  onCleanup(() => rmSync(paths.tmp, { recursive: true, force: true }));
  const tokenStore = new FileTokenStore(paths.tokenFile);
  tokenStore.set(f.machine.token);
  const book = options.book ?? scriptBook();
  const config = testConfig(f, options.repoPath, options.config);
  const daemon = createDaemon({
    config,
    home,
    tokenStore,
    runner: scriptedRunner(book, join(home, 'scripted-sessions')),
    inventory: false,
    // Tests run on a busy dev machine: the slot count is the configured limit, not the live load.
    slots: () => config.resources.maxConcurrentJobs,
    tracker: new ResourceTracker({ dockerBin: null }),
    // Runtime tests use the generic planner; the role workflow tests pass `rolePlanner`.
    planner: defaultPlanner,
    crewDocsSource: inject('bundlePath'),
    logger: process.env.DEBUG_CREWD
      ? (level, message, fields) => console.log(level, message, JSON.stringify(fields))
      : () => {},
    timings: TEST_TIMINGS,
    ...options.extra,
  });
  let stopped = false;
  const stop = daemon.stop.bind(daemon);
  const halt = daemon.halt.bind(daemon);
  daemon.stop = async () => {
    stopped = true;
    await stop();
  };
  daemon.halt = async () => {
    stopped = true;
    await halt();
  };
  onCleanup(async () => {
    if (!stopped)
      await withDeadline(daemon.halt(), DAEMON_HALT_DEADLINE_MS, 'halting a daemon the test left running');
  });
  return { daemon, home, book, config };
}
