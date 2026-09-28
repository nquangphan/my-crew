import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupJob, findOrphans, jobTmpDir, sweepOrphans } from '../src/runner/job-cleanup.js';
import { ResourceOps } from '../src/runner/resource-report.js';
import {
  JOB_TAG,
  parseDockerTime,
  parseLsof,
  parsePsLines,
  ResourceTracker,
} from '../src/runner/resource-tracker.js';
import { StateDb } from '../src/state-db.js';
import { waitFor } from './helpers/daemon.js';
import { onCleanup, tempDir } from './helpers/git.js';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A long-running node process, optionally tagged with a job id and in its own group. */
function spawnSleeper(env: Record<string, string> = {}): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  const pid = child.pid as number;
  onCleanup(() => {
    if (alive(pid)) process.kill(pid, 'SIGKILL');
  });
  return pid;
}

describe('resource tracker parsing', () => {
  it('parses ps, lsof and docker output', () => {
    const ps = parsePsLines('  501  1  501  1168 Tue Sep 29 00:35:17 2026     node server.js --port 1\n');
    expect(ps[0]).toMatchObject({
      pid: 501,
      ppid: 1,
      pgid: 501,
      rssKb: 1168,
      command: 'node server.js --port 1',
    });
    expect(ps[0]?.startedAt).toMatch(/^2026-09-2/);
    expect(parseLsof('p606\nf10\nn*:57158\nf11\nn127.0.0.1:57158\np693\nf10\nn[::1]:7000\n')).toEqual(
      new Map([
        [606, [57158]],
        [693, [7000]],
      ]),
    );
    expect(parseDockerTime('2026-09-29 00:35:17 +0700 +07')?.toISOString()).toBe('2026-09-28T17:35:17.000Z');
    expect(parseDockerTime('2026-09-29 00:35:17 +0000 UTC')?.toISOString()).toBe('2026-09-29T00:35:17.000Z');
  });
});

describe('job cleanup and orphan sweep', () => {
  it('finds tagged processes by env, and never untagged ones', async () => {
    const jobId = '11111111-2222-3333-4444-555555555555';
    const tagged = spawnSleeper({ [JOB_TAG]: jobId });
    const untagged = spawnSleeper();
    const tracker = new ResourceTracker({ dockerBin: null });
    const procs = await waitFor(
      () => {
        const found = tracker.jobProcesses().filter((p) => p.jobId === jobId);
        return found.length > 0 ? found : null;
      },
      5_000,
      'tagged process',
    );
    expect(procs.map((p) => p.pid)).toContain(tagged);
    expect(tracker.jobProcesses().some((p) => p.pid === untagged)).toBe(false);
  });

  it('SIGTERMs the job group and tagged processes, SIGKILLs survivors, deletes the temp dir and records it', async () => {
    const home = tempDir('crewd-home-');
    const tmpRoot = join(home, 'tmp');
    const state = new StateDb(':memory:');
    const job = state.insertJob({ ticketId: 't1', projectId: null, role: 'dev', trigger: 'x' });
    // Ignores SIGTERM, so only the SIGKILL after the grace period stops it.
    const stubborn = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      {
        env: { ...process.env, [JOB_TAG]: job.id },
        stdio: 'ignore',
        detached: true,
      },
    );
    const pid = stubborn.pid as number;
    onCleanup(() => {
      if (alive(pid)) process.kill(pid, 'SIGKILL');
    });
    mkdirSync(jobTmpDir(tmpRoot, job.id), { recursive: true });
    writeFileSync(join(jobTmpDir(tmpRoot, job.id), 'big.bin'), Buffer.alloc(50_000));
    state.updateJob(job.id, { startedAt: new Date().toISOString(), pgid: pid });
    const tracker = new ResourceTracker({ dockerBin: null });
    await waitFor(() => tracker.jobProcesses().some((p) => p.pid === pid), 5_000, 'visible');
    const record = await cleanupJob({ state, tracker, tmpRoot, graceMs: 500 }, state.requireJob(job.id));
    await waitFor(() => !alive(pid), 5_000, 'killed');
    expect(record.pids).toContain(pid);
    expect(record.bytesFreed).toBeGreaterThanOrEqual(50_000);
    expect(existsSync(jobTmpDir(tmpRoot, job.id))).toBe(false);
    expect(state.cleanups({ jobId: job.id })).toHaveLength(1);
  });

  it('sweeps orphans of finished jobs known here, and leaves other daemons’ and running jobs alone', async () => {
    const home = tempDir('crewd-home-');
    const tmpRoot = join(home, 'tmp');
    const state = new StateDb(':memory:');
    const finished = state.insertJob({ ticketId: 'a', projectId: null, role: 'dev', trigger: 'x' });
    state.updateJob(finished.id, { status: 'done', startedAt: new Date().toISOString() });
    const running = state.insertJob({ ticketId: 'b', projectId: null, role: 'dev', trigger: 'x' });
    state.updateJob(running.id, { status: 'running' });
    const orphan = spawnSleeper({ [JOB_TAG]: finished.id });
    const live = spawnSleeper({ [JOB_TAG]: running.id });
    const foreign = spawnSleeper({ [JOB_TAG]: '99999999-8888-7777-6666-555555555555' });
    mkdirSync(jobTmpDir(tmpRoot, finished.id), { recursive: true });
    mkdirSync(jobTmpDir(tmpRoot, running.id), { recursive: true });
    mkdirSync(jobTmpDir(tmpRoot, 'unknown-job'), { recursive: true });
    const tracker = new ResourceTracker({ dockerBin: null });
    await waitFor(() => tracker.jobProcesses().some((p) => p.pid === orphan), 5_000, 'visible');

    const running_ = new Set([running.id]);
    const found = findOrphans({ state, tracker, tmpRoot }, running_);
    expect(found.processes.map((p) => p.pid)).toEqual([orphan]);
    const result = await sweepOrphans({ state, tracker, tmpRoot, graceMs: 500 }, running_);
    expect(result.cleaned).toBeGreaterThanOrEqual(3);
    await waitFor(() => !alive(orphan), 5_000, 'orphan stopped');
    expect(alive(live)).toBe(true);
    expect(alive(foreign)).toBe(true);
    expect(existsSync(jobTmpDir(tmpRoot, finished.id))).toBe(false);
    expect(existsSync(jobTmpDir(tmpRoot, 'unknown-job'))).toBe(false);
    expect(existsSync(jobTmpDir(tmpRoot, running.id))).toBe(true);
  });

  it('resource_report lists what finished jobs left; cleanup_resources acts only on listed, cleanable items', async () => {
    const home = tempDir('crewd-home-');
    const tmpRoot = join(home, 'tmp');
    const state = new StateDb(':memory:');
    const finished = state.insertJob({ ticketId: 'a', projectId: null, role: 'dev', trigger: 'x' });
    state.updateJob(finished.id, {
      status: 'done',
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      endedAt: new Date().toISOString(),
    });
    const running = state.insertJob({ ticketId: 'b', projectId: null, role: 'dev', trigger: 'x' });
    state.updateJob(running.id, { status: 'running', startedAt: new Date().toISOString() });
    const orphan = spawnSleeper({ [JOB_TAG]: finished.id });
    const live = spawnSleeper({ [JOB_TAG]: running.id });
    mkdirSync(jobTmpDir(tmpRoot, finished.id), { recursive: true });
    // A fake docker that lists one container created inside the finished job's window.
    const bin = tempDir('crewd-bin-');
    const docker = join(bin, 'docker');
    const created = new Date(Date.now() - 30_000);
    const stamp = `${created.toISOString().slice(0, 10)} ${created.toISOString().slice(11, 19)} +0000 UTC`;
    writeFileSync(
      docker,
      `#!/bin/sh\nif [ "$1" = ps ]; then printf 'abc123def4567890\\tjob-db\\t${stamp}\\tUp 1 minute\\n'; fi\nif [ "$1" = stop ]; then echo "$2" >> "${bin}/stopped"; fi\n`,
    );
    chmodSync(docker, 0o755);
    const tracker = new ResourceTracker({ dockerBin: docker });
    await waitFor(() => tracker.jobProcesses().some((p) => p.pid === orphan), 5_000, 'visible');
    const removed: string[] = [];
    const ops = new ResourceOps({
      state,
      tracker,
      tmpRoot,
      snapshot: () => ({ cpus: 8, loadAvg1: 1, freeMemGb: 8, totalMemGb: 16, diskFreeGb: 100 }),
      freeSlots: () => 2,
      runningJobIds: () => new Set([running.id]),
      worktrees: async () => [
        {
          projectKey: 'WEB',
          repo: '/r',
          key: 'WEB-1',
          path: '/r/.crew/worktrees/WEB-1',
          ticketStatus: 'done',
        },
        {
          projectKey: 'WEB',
          repo: '/r',
          key: 'WEB-2',
          path: '/r/.crew/worktrees/WEB-2',
          ticketStatus: 'in_progress',
        },
      ],
      removeWorktree: (entry) => removed.push(entry.key),
      graceMs: 500,
    });
    expect((await ops.cleanup([`process:${orphan}`])).refused[0]?.reason).toMatch(/resource_report/);
    const report = await ops.report();
    expect(report.processes.find((p) => p.pid === orphan)).toMatchObject({
      cleanable: true,
      jobStatus: 'done',
    });
    expect(report.processes.find((p) => p.pid === live)).toMatchObject({ cleanable: false });
    expect(report.containers).toEqual([expect.objectContaining({ name: 'job-db', jobId: finished.id })]);
    expect(report.machine.freeSlots).toBe(2);

    const outcome = await ops.cleanup([
      `process:${orphan}`,
      `process:${live}`,
      `tmp:${finished.id}`,
      'worktree:WEB/WEB-1',
      'worktree:WEB/WEB-2',
      'container:abc123def4567890',
      `process:${process.pid}`,
    ]);
    expect(outcome.cleaned.sort()).toEqual(
      [`process:${orphan}`, `tmp:${finished.id}`, 'worktree:WEB/WEB-1', 'container:abc123def4567890'].sort(),
    );
    expect(outcome.refused.map((r) => r.item).sort()).toEqual(
      [`process:${live}`, `process:${process.pid}`, 'worktree:WEB/WEB-2'].sort(),
    );
    await waitFor(() => !alive(orphan), 5_000, 'orphan stopped');
    expect(alive(live)).toBe(true);
    expect(removed).toEqual(['WEB-1']);
    expect(existsSync(join(bin, 'stopped'))).toBe(true);
    expect(state.cleanups({ jobId: finished.id })[0]).toMatchObject({ pids: [orphan] });
  });
});
