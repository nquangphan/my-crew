import type { MachineCommand, MachineCommandRequest } from '@crew/shared';
import { describe, expect, it } from 'vitest';
import { devTicket, type Fixture, fixture, pmTask, useApi } from './helpers/api.js';
import { makeDaemon, waitFor } from './helpers/daemon.js';
import { makeRepo } from './helpers/git.js';

const api = useApi();

async function ask(f: Fixture, body: MachineCommandRequest): Promise<MachineCommand> {
  const res = await f.server.app.inject({
    method: 'POST',
    url: `/v1/machines/${f.machine.machineId}/commands`,
    headers: f.owner.headers,
    payload: body,
  });
  if (res.statusCode !== 201) throw new Error(`command refused: ${res.statusCode} ${res.body}`);
  return res.json();
}

async function outcome(f: Fixture, id: string): Promise<MachineCommand> {
  return waitFor(
    async () => {
      const res = await f.server.app.inject({
        method: 'GET',
        url: `/v1/machines/${f.machine.machineId}/commands/${id}`,
        headers: f.owner.headers,
      });
      const command: MachineCommand = res.json();
      return command.status === 'done' || command.status === 'failed' ? command : null;
    },
    10_000,
    `command ${id} finished`,
  );
}

describe('remote machine commands', () => {
  it('pauses and resumes the daemon, lists its jobs and reports actions it cannot do', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Việc để liệt kê');
    t.book.byTicket.set(dev.id, { steps: [] });
    await t.daemon.start();
    await waitFor(() => t.daemon.state.jobsForTicket(dev.id).length > 0, 10_000, 'dev job');

    const pause = await outcome(f, (await ask(f, { action: 'pause' })).id);
    expect(pause).toMatchObject({ status: 'done', result: { paused: true } });
    expect(t.daemon.status().paused).toBe(true);
    const resume = await outcome(f, (await ask(f, { action: 'resume' })).id);
    expect(resume).toMatchObject({ status: 'done', result: { paused: false } });
    expect(t.daemon.status().paused).toBe(false);

    const jobs = await outcome(f, (await ask(f, { action: 'jobs.list' })).id);
    expect(jobs.status).toBe('done');
    expect(jobs.result).toEqual(
      expect.arrayContaining([expect.objectContaining({ ticketId: dev.id, ticketKey: dev.key })]),
    );

    // The CLI daemon has no log file or health dashboard: it says so instead of hanging.
    const logs = await outcome(f, (await ask(f, { action: 'logs.tail', limit: 10 })).id);
    expect(logs).toMatchObject({ status: 'failed', error: expect.stringContaining('Log gần nhất') });
    const missing = await outcome(f, (await ask(f, { action: 'inventory.refresh', projectKey: 'NOPE' })).id);
    expect(missing).toMatchObject({ status: 'failed', error: 'Máy này chưa có thư mục cho dự án NOPE.' });
    await t.daemon.stop();
  });

  it('runs handlers the hosting app adds, and reports their errors scrubbed', async () => {
    const f = await fixture(api);
    const t = makeDaemon(f, {
      repoPath: null,
      extra: {
        commandHandlers: {
          'health.run': async ({ quick }) => ({
            generatedAt: new Date().toISOString(),
            results: [
              {
                id: 'claude.cli',
                group: 'claude',
                title: 'Claude CLI',
                status: 'green',
                detail: `quick=${quick}`,
              },
            ],
            summary: { status: 'green', failing: [] },
          }),
          'bmad.install': async () => {
            throw new Error('npx lỗi với token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
          },
        },
      },
    });
    await t.daemon.start();
    const health = await outcome(f, (await ask(f, { action: 'health.run', quick: true })).id);
    expect(health).toMatchObject({
      status: 'done',
      result: { results: [{ id: 'claude.cli', detail: 'quick=true' }] },
    });
    const bmad = await outcome(f, (await ask(f, { action: 'bmad.install', projectKey: 'WEB' })).id);
    expect(bmad.status).toBe('failed');
    expect(bmad.error).not.toContain('sk-ant-api03');
    await t.daemon.stop();
  });

  it('gives a project up when the owner asks from the web', async () => {
    const f = await fixture(api);
    const t = makeDaemon(f, { repoPath: makeRepo() });
    await t.daemon.start();
    await waitFor(() => t.daemon.status().projects[0]?.ownerState === 'mine', 10_000, 'project owned');
    const release = await outcome(
      f,
      (await ask(f, { action: 'project.release', projectKey: f.projectKey })).id,
    );
    expect(release).toMatchObject({ status: 'done', result: { status: 'released' } });
    expect(t.daemon.status().projects[0]?.ownerState).toBe('unowned');
    await t.daemon.stop();
  });
});
