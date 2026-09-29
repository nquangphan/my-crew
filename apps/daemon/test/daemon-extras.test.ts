import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillInventory } from '@crew/shared';
import { describe, expect, inject, it, vi } from 'vitest';
import { machineSkills, machines } from '../../api/src/db/schema.js';
import { createRequestTicket } from '../../api/src/services/ticket-service.js';
import { VpsClient } from '../src/api/vps-client.js';
import { homePaths } from '../src/config.js';
import { docsSnapshot, installCrewDocs } from '../src/git/docs-kit-bridge.js';
import { commentsOf, devTicket, fixture, pmTask, useApi } from './helpers/api.js';
import { manualClock } from './helpers/clock.js';
import { makeDaemon, TEST_TIMINGS, waitFor } from './helpers/daemon.js';
import { git, makeRepo, writeFiles } from './helpers/git.js';

const api = useApi();
const tool = (name: string, input: Record<string, unknown> = {}) => ({
  tool: `mcp__tickets__${name}`,
  input,
});

const MANIFEST = `version: 1
source:
  include: ["src/**"]
flows:
  cart:
    title: Giỏ hàng
    doc: docs/flows/cart.md
    entrypoints: [src/cart.ts]
    files: []
    tests: []
shared: {}
unassigned: []
`;

describe('daemon wiring', () => {
  it('probes the inventory inside a job-like worktree, sends it, and gives it to runs with MCP tools allowed', async () => {
    const f = await fixture(api);
    const repo = makeRepo({ 'README.md': '# r\n', '.gitignore': '.claude/\n' });
    writeFiles(repo, {
      '.claude/skills/shop-domain/SKILL.md': '---\nname: shop-domain\ndescription: d\n---\n',
    });
    const probes: { cwd: string; enabled: string[] }[] = [];
    const inventory: SkillInventory = {
      skills: [{ name: 'shop-domain', source: 'project', description: 'Nghiệp vụ cửa hàng' }],
      mcpServers: [
        { name: 'playwright', source: 'user', status: 'connected', tools: [{ name: 'browser_click' }] },
        { name: 'maestro', source: 'project', status: 'connected', tools: [] },
      ],
    };
    const t = makeDaemon(f, {
      repoPath: repo,
      config: {
        projects: [
          {
            key: f.projectKey,
            repoPath: repo,
            defaultBranch: 'main',
            sharedPaths: [],
            disabledMcpServers: ['maestro'],
          },
        ],
      },
      extra: {
        inventory: true,
        probe: async ({ cwd, enabledMcpjsonServers }) => {
          probes.push({ cwd, enabled: enabledMcpjsonServers });
          if (!cwd.includes('_probe')) return { skills: [], mcpServers: [] };
          // The probe worktree is prepared like a job worktree: the gitignored .claude is linked in.
          expect(lstatSync(join(cwd, '.claude')).isSymbolicLink()).toBe(true);
          return inventory;
        },
      },
    });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id);
    t.book.byTicket.set(dev.id, { skills: ['shop-domain'], steps: [tool('get_ticket')] });
    await t.daemon.start();
    await waitFor(
      async () => (await api.db.select().from(machineSkills)).length >= 2,
      15_000,
      'inventory stored',
    );
    expect(probes.some((p) => p.cwd === join(repo, '.crew/worktrees/_probe'))).toBe(true);
    const run = await waitFor(() => t.book.runs.find((r) => r.ticketId === dev.id), 15_000, 'dev run');
    expect(run.allowedTools).toContain('mcp__playwright__*');
    expect(run.allowedTools).not.toContain('mcp__maestro__*');
    expect(run.enabledMcpjsonServers).toEqual([]);
    expect(run.disabledMcpjsonServers).toEqual(['maestro']);
    expect(run.env.CREW_JOB_ID).toBe(t.daemon.state.jobsForTicket(dev.id)[0]?.id);
    expect(run.env.TMPDIR).toContain(join(homePaths(t.home).tmp));
    expect(run.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    const context = (await run.ticketTools.find((x) => x.name === 'get_ticket')?.handler({}, {})) as {
      content: { text: string }[];
    };
    const block = JSON.parse(context.content[0]?.text ?? '{}').context;
    expect(block.capabilities.skills).toEqual(inventory.skills);
    expect(block.capabilities.mcpServers.map((s: { name: string }) => s.name)).toEqual(['playwright']);
    await t.daemon.stop();
  });

  it('keeps the probe worktree for an hour after a probe, then removes it, and a restart removes an expired one', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const clock = manualClock();
    const probeDir = join(repo, '.crew/worktrees/_probe');
    const t = makeDaemon(f, {
      repoPath: repo,
      extra: {
        inventory: true,
        probe: async () => ({ skills: [], mcpServers: [] }),
        timings: { ...TEST_TIMINGS, probeClock: clock },
      },
    });
    await t.daemon.start();
    await waitFor(
      () => existsSync(probeDir) && t.daemon.state.getMeta(`probeWorktreeUsedAt:${f.projectKey}`),
      15_000,
      'probe worktree used',
    );
    clock.advance(59 * 60_000);
    expect(existsSync(probeDir)).toBe(true);
    clock.advance(60_000);
    expect(existsSync(probeDir)).toBe(false);

    await t.daemon.refreshInventory(f.projectKey);
    expect(existsSync(probeDir)).toBe(true);
    await t.daemon.stop();
    clock.advance(61 * 60_000);
    // A stopped daemon runs no timers; the next start removes the expired worktree.
    expect(existsSync(probeDir)).toBe(true);
    const restarted = makeDaemon(f, {
      repoPath: repo,
      home: t.home,
      extra: { timings: { ...TEST_TIMINGS, probeClock: clock } },
    });
    await restarted.daemon.start();
    expect(existsSync(probeDir)).toBe(false);
    await waitFor(() => restarted.daemon.status().connected, 10_000, 'restarted stream');
    await restarted.daemon.stop();
  });

  it('sends heartbeats with running jobs and the sweep count', async () => {
    const f = await fixture(api);
    const t = makeDaemon(f, { repoPath: makeRepo() });
    await t.daemon.start();
    await t.daemon.heartbeat();
    const [row] = await api.db.select().from(machines);
    expect(row?.resources).toMatchObject({ orphansCleaned: 0 });
    expect(row?.paused).toBe(false);
    t.daemon.pause();
    await waitFor(
      async () => (await api.db.select().from(machines))[0]?.paused === true,
      5_000,
      'paused heartbeat',
    );
    expect(t.daemon.status()).toMatchObject({ paused: true, connected: true });
    await t.daemon.stop();
  });

  it('reports queued and backoff jobs as waiting jobs in the heartbeat', async () => {
    const f = await fixture(api);
    // The client keeps the fetch it was built with, so spy before the daemon exists.
    const sent: unknown[] = [];
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/v1/daemon/heartbeat')) sent.push(JSON.parse(String(init?.body)));
      return realFetch(input, init);
    });
    try {
      const t = makeDaemon(f, { repoPath: null });
      const queued = await createRequestTicket(api.db, { title: 'Đang xếp hàng' });
      const parked = await createRequestTicket(api.db, { title: 'Đang chờ thử lại' });
      const retryAt = new Date(Date.now() + 10 * 60_000).toISOString();
      t.daemon.state.insertJob({ ticketId: queued.id, projectId: null, role: 'assistant', trigger: 'test' });
      const backoff = t.daemon.state.insertJob({
        ticketId: parked.id,
        projectId: null,
        role: 'assistant',
        trigger: 'test',
      });
      t.daemon.state.updateJob(backoff.id, { status: 'backoff', retryAt });
      await t.daemon.heartbeat();
      expect(sent).toHaveLength(1);
      expect((sent[0] as { waitingJobs: unknown[] }).waitingJobs).toEqual(
        expect.arrayContaining([
          { ticketId: queued.id, status: 'queued' },
          { ticketId: parked.id, status: 'backoff', retryAt },
        ]),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('runs assistant jobs on the assistant host in the daemon-owned assistant dir', async () => {
    const f = await fixture(api);
    const { claim } = await import('../../api/src/services/claim-service.js');
    await api.db.transaction((tx) => claim(tx, f.machine.machineId, { hostsAssistant: true }));
    const t = makeDaemon(f, { repoPath: null });
    const request = await createRequestTicket(api.db, { title: 'Thêm trang liên hệ' });
    t.book.byTicket.set(request.id, {
      steps: [tool('get_project_catalog'), tool('comment', { body: 'Đã định tuyến' })],
    });
    await t.daemon.start();
    await waitFor(async () => (await commentsOf(api.db, request.id)).length === 1, 15_000, 'assistant ran');
    const run = t.book.runs.find((r) => r.ticketId === request.id);
    expect(run?.role).toBe('assistant');
    expect(run?.cwd).toBe(homePaths(t.home).assistantDir);
    expect(run?.model).toBe('haiku');
    expect(run?.allowedTools).toContain('mcp__tickets__create_pm_ticket');
    await t.daemon.stop();
  });

  it('docs tools run crew-docs in the worktree, and a docs snapshot syncs to the server', async () => {
    const f = await fixture(api);
    const repo = makeRepo({
      'docs/flows.yaml': MANIFEST,
      'docs/flows/cart.md': '# Giỏ hàng\n',
      'docs/index.md': '# Tổng quan\n',
      'src/cart.ts': 'export {};\n',
      'AGENTS.md': '# AGENTS\n',
    });
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id);
    t.book.byTicket.set(dev.id, {
      steps: [tool('docs_where', { file: 'src/cart.ts' }), tool('docs_flow', { id: 'cart' })],
    });
    await t.daemon.start();
    const run = await waitFor(() => t.book.runs.find((r) => r.ticketId === dev.id), 15_000, 'dev run');
    const where = (await run.ticketTools
      .find((x) => x.name === 'docs_where')
      ?.handler({ file: 'src/cart.ts' }, {})) as {
      content: { text: string }[];
    };
    expect(where.content[0]?.text).toMatch(/^cart\tentrypoint\tdocs\/flows\/cart\.md/);
    const flow = (await run.ticketTools.find((x) => x.name === 'docs_flow')?.handler({ id: 'cart' }, {})) as {
      content: { text: string }[];
    };
    expect(flow.content[0]?.text).toContain('flow: cart');
    await waitFor(() => t.daemon.state.jobsForTicket(dev.id)[0]?.status === 'done', 15_000, 'done');
    // docs-first: the run looked docs up before reading source.
    expect(
      t.daemon.state.toolLog(t.daemon.state.jobsForTicket(dev.id)[0]?.id ?? '').map((e) => e.tool),
    ).toEqual(['mcp__tickets__docs_where', 'mcp__tickets__docs_flow']);

    const snapshot = docsSnapshot(repo);
    expect(snapshot.files.map((file) => file.path).sort()).toEqual([
      'AGENTS.md',
      'docs/flows.yaml',
      'docs/flows/cart.md',
      'docs/index.md',
    ]);
    expect(snapshot.commit).toBe(git(repo, 'rev-parse', 'HEAD').trim());
    const vps = new VpsClient({ apiUrl: f.server.url, token: () => f.machine.token });
    const synced = await vps.syncDocs(f.projectKey, snapshot, `docs-sync:${snapshot.commit}`);
    expect(synced.fileCount).toBe(4);
    await t.daemon.stop();
  });

  it('starts a QC worktree at the paired dev report head_sha', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const { createSubtask } = await import('../../api/src/services/ticket-service.js');
    const { setStatus } = await import('../../api/test/helpers/test-db.js');
    const { submitReport } = await import('../../api/src/services/report-service.js');
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Tính năng có commit');
    const qc = await createSubtask(api.db, { type: 'qc', parentId: pm.id, title: 'QC', pairsWith: dev.id });
    // The dev branch has a commit the default branch does not.
    git(repo, 'checkout', '-q', '-b', 'crew/feature');
    writeFiles(repo, { 'feature.ts': 'export const feature = 1;\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'feature');
    const headSha = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'checkout', '-q', 'main');
    await setStatus(api.db, dev.id, 'in_progress');
    await submitReport(api.db, dev.id, { summaryMd: 'xong', docsFirst: true, headSha });
    await setStatus(api.db, dev.id, 'done');
    const t = makeDaemon(f, { repoPath: repo });
    let head = '';
    t.book.byTicket.set(qc.id, (run) => {
      head = git(run.cwd, 'rev-parse', 'HEAD').trim();
      return { steps: [] };
    });
    await t.daemon.start();
    await waitFor(() => head !== '', 15_000, 'qc run');
    expect(head).toBe(headSha);
    await t.daemon.stop();
  });

  it('stops the jobs of a project whose claim moved to another machine', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Đang làm thì bị chuyển máy');
    t.book.byTicket.set(dev.id, { steps: [{ sleep: 30_000 }] });
    await t.daemon.start();
    const running = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'running'),
      15_000,
      'running',
    );

    const { freshTotp, pairTestMachine, writeHeaders } = await import('../../api/test/helpers/machines.js');
    const other = await pairTestMachine(api.db, 'other-mac');
    const claimed = await f.server.app.inject({
      method: 'POST',
      url: '/v1/daemon/claims',
      headers: writeHeaders(other),
      payload: { projectKey: f.projectKey },
    });
    expect(claimed.statusCode).toBe(202);
    const approved = await f.server.app.inject({
      method: 'POST',
      url: `/v1/claim-requests/${claimed.json().claimRequestId}/approve`,
      headers: f.owner.headers,
      payload: { code: await freshTotp(api.db, f.owner.totpSecret) },
    });
    expect(approved.statusCode).toBe(200);
    const stopped = await waitFor(
      () => t.daemon.state.getJob(running.id)?.status === 'cancelled',
      15_000,
      'job released',
    );
    expect(stopped).toBe(true);
    expect(t.daemon.status().projects).toEqual([{ key: f.projectKey, ownerState: 'other', runnable: false }]);
    await t.daemon.stop();
  });

  it('stop waits for the API calls it started in the background, so none outlives it', async () => {
    const f = await fixture(api);
    // Hold the project refresh the daemon fires when its stream connects.
    let hold = false;
    let held = 0;
    let open = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedFetch: typeof fetch = async (input, init) => {
      open += 1;
      try {
        if (hold && String(input).endsWith('/v1/daemon/projects')) {
          held += 1;
          await gate;
        }
        return await fetch(input, init);
      } finally {
        open -= 1;
      }
    };
    const t = makeDaemon(f, { repoPath: null, extra: { fetch: gatedFetch } });
    await t.daemon.start();
    hold = true;
    await waitFor(() => held === 1, 10_000, 'refresh after the stream connected');

    let stopped = false;
    const stopping = t.daemon.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(open).toBe(0);
  });

  it('installs crew-docs into ~/.crew/bin with a wrapper on the agents PATH', () => {
    const bin = join(makeRepo(), 'bin');
    const installed = installCrewDocs(bin, inject('bundlePath'));
    expect(installed.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(existsSync(join(bin, 'crew-docs'))).toBe(true);
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    expect(execFileSync(join(bin, 'crew-docs'), ['--version'], { encoding: 'utf8' }).trim()).toBe(
      installed.version,
    );
  });
});
