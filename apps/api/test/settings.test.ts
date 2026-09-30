import { DEFAULT_GUARD_POLICY, type EffectiveSettings, type SettingsRevision } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledPrompt } from '../src/services/settings-service.js';
import { type PairedMachine, pairTestMachine, writeHeaders } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import { createTestProject, eventsOf, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance;
let owner: LoggedInOwner;
let a: PairedMachine;
let b: PairedMachine;

beforeEach(async () => {
  app = await makeApp(ctx.db);
  owner = await seedAndLogin(app, ctx.db);
  a = await pairTestMachine(ctx.db, 'mac-a');
  b = await pairTestMachine(ctx.db, 'mac-b');
});
afterEach(() => app.close());

const save = (body: object) =>
  app.inject({ method: 'POST', url: '/v1/settings', headers: owner.headers, payload: body });
const effective = (machine: PairedMachine, etag?: string) =>
  app.inject({
    method: 'GET',
    url: '/v1/daemon/settings',
    headers: { ...machine.auth, ...(etag ? { 'if-none-match': etag } : {}) },
  });
const promptKey = (name: string) => ({ kind: 'prompt', scope: 'global', name });
const resourcesKey = (machineId: string) => ({ kind: 'resources', scope: 'machine', machineId });
const RESOURCES = { maxConcurrentJobs: 5, minFreeMemGb: 2, maxLoadPerCpu: 1.5 };

describe('owner settings', () => {
  it('lists the bundled prompts, variables and defaults', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/settings', headers: owner.headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prompts.map((p: { name: string }) => p.name)).toContain('dev');
    expect(body.prompts.find((p: { name: string }) => p.name === 'dev').defaultText).toBe(
      bundledPrompt('dev'),
    );
    expect(bundledPrompt('dev')).toContain('{{header}}');
    expect(body.variables.map((v: { name: string }) => v.name)).toContain('ticket_key');
    expect(body.defaults.policy).toEqual(DEFAULT_GUARD_POLICY);
    expect(body.active).toEqual([]);
  });

  it('saves versioned revisions with author and note, and refuses a stale base version', async () => {
    const first = await save({
      key: promptKey('dev'),
      content: { text: '{{header}}\nMột' },
      note: 'thử',
      baseVersion: 0,
    });
    expect(first.statusCode).toBe(201);
    const revision: SettingsRevision = first.json().revision;
    expect(revision).toMatchObject({ version: 1, author: 'owner:owner', note: 'thử', name: 'dev' });
    expect(first.json().affectedMachineIds.sort()).toEqual([a.machineId, b.machineId].sort());

    const second = await save({
      key: promptKey('dev'),
      content: { text: '{{header}}\nHai' },
      baseVersion: 1,
    });
    expect(second.json().revision.version).toBe(2);
    const stale = await save({ key: promptKey('dev'), content: { text: 'Ba' }, baseVersion: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.details).toEqual({ currentVersion: 2 });

    const history = await app.inject({
      method: 'GET',
      url: '/v1/settings/history?kind=prompt&scope=global&name=dev',
      headers: owner.headers,
    });
    expect(history.json().items.map((item: SettingsRevision) => item.version)).toEqual([2, 1]);
  });

  it('validates content with the shared schemas', async () => {
    const unknownVar = await save({ key: promptKey('qc'), content: { text: '{{no_such}}' } });
    expect(unknownVar.statusCode).toBe(400);
    expect(unknownVar.json().error.details).toEqual([
      { path: 'text', message: 'Không có biến {{no_such}}.' },
    ]);

    const unsafe = await save({
      key: { kind: 'policy', scope: 'global' },
      content: { ...DEFAULT_GUARD_POLICY, docsPaths: ['../outside/**'] },
    });
    expect(unsafe.statusCode).toBe(400);

    const noSonnet = await save({
      key: { kind: 'models', scope: 'global' },
      content: {
        allow: ['haiku', 'opus'],
        complexityMap: {
          trivial: { model: 'haiku', effort: 'low' },
          small: { model: 'haiku', effort: 'low' },
          medium: { model: 'opus', effort: 'high' },
          large: { model: 'opus', effort: 'high' },
        },
      },
    });
    expect(noSonnet.statusCode).toBe(400);

    const outOfRange = await save({
      key: resourcesKey(a.machineId),
      content: { ...RESOURCES, maxConcurrentJobs: 99 },
    });
    expect(outOfRange.statusCode).toBe(400);
    const wrongScope = await save({ key: { kind: 'resources', scope: 'global' }, content: RESOURCES });
    expect(wrongScope.statusCode).toBe(400);

    const check = await app.inject({
      method: 'POST',
      url: '/v1/settings/validate',
      headers: owner.headers,
      payload: { key: promptKey('qc'), content: { text: '{{> _shared-rules}} {{header}}' } },
    });
    expect(check.json()).toEqual({ ok: true, errors: [] });
  });

  it('diffs two revisions and restores an earlier one as a new version', async () => {
    const one = (await save({ key: promptKey('qc'), content: { text: 'a\nb' } })).json().revision;
    const two = (await save({ key: promptKey('qc'), content: { text: 'a\nc' } })).json().revision;
    const diff = await app.inject({
      method: 'GET',
      url: `/v1/settings/diff?from=${one.id}&to=${two.id}`,
      headers: owner.headers,
    });
    expect(diff.json().lines).toEqual([
      { op: 'same', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'add', text: 'c' },
    ]);
    const restored = await app.inject({
      method: 'POST',
      url: `/v1/settings/revisions/${one.id}/restore`,
      headers: owner.headers,
      payload: {},
    });
    expect(restored.statusCode).toBe(201);
    expect(restored.json().revision).toMatchObject({
      version: 3,
      restoredFrom: 1,
      content: { text: 'a\nb' },
      note: 'Khôi phục bản 1',
    });
  });

  it('tells the owner and the affected machines, and only them', async () => {
    const project = await createTestProject(ctx.db, { ownerMachineId: b.machineId });
    await save({
      key: { kind: 'project_mcp', scope: 'project', projectId: project.id },
      content: { disabledMcpServers: ['figma'] },
    });
    await save({ key: resourcesKey(a.machineId), content: RESOURCES });
    const events = await eventsOf(ctx.db, 'settings.changed');
    expect(events.map((event) => event.targetMachineId)).toEqual([null, b.machineId, null, a.machineId]);
  });

  it('shows which machines picked a revision up from their heartbeats', async () => {
    await save({ key: resourcesKey(a.machineId), content: RESOURCES });
    const expected = (await effective(a)).json().revision;
    const beat = (machine: PairedMachine, revision: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/daemon/heartbeat',
        headers: machine.auth,
        payload: {
          resources: { cpus: 8, loadAvg1: 1, freeMemGb: 8, totalMemGb: 16 },
          cliVersion: '2.1.0',
          settings: { revision, source: 'server', rejected: [] },
        },
      });
    await beat(a, expected);
    await beat(b, 'old');
    const list = await app.inject({ method: 'GET', url: '/v1/machines', headers: owner.headers });
    const byId = new Map(list.json().items.map((m: { id: string; settings: unknown }) => [m.id, m.settings]));
    expect(byId.get(a.machineId)).toMatchObject({ current: true, expectedRevision: expected });
    expect(byId.get(b.machineId)).toMatchObject({ current: false, reported: { revision: 'old' } });
    expect((await eventsOf(ctx.db, 'machine.settings_applied')).length).toBe(2);
  });
});

describe('daemon settings', () => {
  it('merges global and machine overrides with an ETag', async () => {
    const empty = await effective(a);
    expect(empty.statusCode).toBe(200);
    const body: EffectiveSettings = empty.json();
    expect(body).toMatchObject({ prompts: {}, policy: null, models: null, resources: null, projects: {} });
    expect(empty.headers.etag).toBe(`"${body.revision}"`);
    expect((await effective(a, empty.headers.etag as string)).statusCode).toBe(304);

    const globalBudget = { perJobUsd: 3 };
    await save({ key: { kind: 'budgets', scope: 'global' }, content: globalBudget });
    await save({
      key: { kind: 'budgets', scope: 'machine', machineId: a.machineId },
      content: { perJobUsd: 9 },
    });
    await save({ key: promptKey('dev'), content: { text: 'Mới {{header}}' } });
    await save({ key: resourcesKey(a.machineId), content: RESOURCES });

    const forA: EffectiveSettings = (await effective(a)).json();
    const forB: EffectiveSettings = (await effective(b)).json();
    expect(forA).toMatchObject({
      budgets: { perJobUsd: 9 },
      resources: RESOURCES,
      prompts: { dev: 'Mới {{header}}' },
    });
    expect(forB).toMatchObject({ budgets: globalBudget, resources: null });
    expect(forA.revision).not.toBe(body.revision);
    expect((await effective(a, empty.headers.etag as string)).statusCode).toBe(200);

    // Removing the machine override falls back to the global value.
    await save({ key: { kind: 'budgets', scope: 'machine', machineId: a.machineId }, content: null });
    expect((await effective(a)).json().budgets).toEqual(globalBudget);
  });

  it('gives a machine the MCP switches of the projects it owns only', async () => {
    const mine = await createTestProject(ctx.db, { key: 'MINE', ownerMachineId: a.machineId });
    const theirs = await createTestProject(ctx.db, { key: 'THEIRS', ownerMachineId: b.machineId });
    for (const project of [mine, theirs]) {
      await save({
        key: { kind: 'project_mcp', scope: 'project', projectId: project.id },
        content: { disabledMcpServers: [`${project.key.toLowerCase()}-mcp`] },
      });
    }
    expect((await effective(a)).json().projects).toEqual({ MINE: { disabledMcpServers: ['mine-mcp'] } });
  });

  it('imports local values once, only where the server has none', async () => {
    const project = await createTestProject(ctx.db, { ownerMachineId: a.machineId });
    const other = await createTestProject(ctx.db, { key: 'OTHER', ownerMachineId: b.machineId });
    await save({
      key: { kind: 'budgets', scope: 'machine', machineId: a.machineId },
      content: { perJobUsd: 1 },
    });
    const body = {
      resources: RESOURCES,
      budgets: { perJobUsd: 50 },
      folders: { projects: [{ key: project.key, repoPath: '/Users/a/web', sharedPaths: [] }] },
      projects: [
        { key: project.key, disabledMcpServers: ['figma'] },
        { key: other.key, disabledMcpServers: ['figma'] },
      ],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/daemon/settings/import',
      headers: writeHeaders(a),
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      created: ['resources', 'project_folders', `project_mcp:${project.key}`],
      kept: ['budgets'],
    });
    const merged: EffectiveSettings = (await effective(a)).json();
    expect(merged).toMatchObject({
      resources: RESOURCES,
      budgets: { perJobUsd: 1 },
      projects: { [project.key]: { disabledMcpServers: ['figma'] } },
    });
    const history = await app.inject({
      method: 'GET',
      url: `/v1/settings/history?kind=resources&scope=machine&machineId=${a.machineId}`,
      headers: owner.headers,
    });
    expect(history.json().items[0]).toMatchObject({
      author: 'machine:mac-a',
      note: 'Chuyển từ config.yaml của máy mac-a',
    });

    const again = await app.inject({
      method: 'POST',
      url: '/v1/daemon/settings/import',
      headers: writeHeaders(a),
      payload: { resources: { ...RESOURCES, maxConcurrentJobs: 1 } },
    });
    expect(again.json()).toEqual({ created: [], kept: ['resources'] });
  });

  it('lets the owning machine switch its project MCP servers, not another machine', async () => {
    const project = await createTestProject(ctx.db, { ownerMachineId: a.machineId });
    const put = (machine: PairedMachine) =>
      app.inject({
        method: 'PUT',
        url: `/v1/daemon/settings/projects/${project.key}/mcp`,
        headers: writeHeaders(machine),
        payload: { disabledMcpServers: ['figma'] },
      });
    expect((await put(b)).statusCode).toBe(403);
    const ok = await put(a);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().revision).toMatchObject({
      author: 'machine:mac-a',
      content: { disabledMcpServers: ['figma'] },
    });
  });

  it('keeps project folders per machine, with the project default branch, editable by owner and machine', async () => {
    await createTestProject(ctx.db, { ownerMachineId: a.machineId, defaultBranch: 'develop' });
    const folderKey = { kind: 'project_folders', scope: 'machine', machineId: a.machineId };
    expect(
      (await save({ key: folderKey, content: { projects: [{ key: 'WEB', repoPath: 'repo/web' }] } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await save({ key: folderKey, content: { projects: [{ key: 'WEB', repoPath: '/Users/a/../b' }] } }))
        .statusCode,
    ).toBe(400);
    const saved = await save({
      key: folderKey,
      content: { projects: [{ key: 'WEB', repoPath: '/Users/a/web', sharedPaths: ['.cursor/rules'] }] },
    });
    expect(saved.statusCode).toBe(201);
    expect((await effective(a)).json().folders).toEqual({
      projects: [
        { key: 'WEB', repoPath: '/Users/a/web', sharedPaths: ['.cursor/rules'], defaultBranch: 'develop' },
      ],
    });
    expect((await effective(b)).json().folders).toBeNull();

    // The app's folder picker sets one project and keeps the rest (and the shared paths).
    const put = await app.inject({
      method: 'PUT',
      url: '/v1/daemon/settings/project-folders/SHOP',
      headers: writeHeaders(a),
      payload: { repoPath: '/Users/a/shop' },
    });
    expect(put.statusCode).toBe(200);
    const moved = await app.inject({
      method: 'PUT',
      url: '/v1/daemon/settings/project-folders/WEB',
      headers: writeHeaders(a),
      payload: { repoPath: '/Users/a/web2' },
    });
    expect(moved.json().revision.content.projects).toEqual([
      { key: 'SHOP', repoPath: '/Users/a/shop', sharedPaths: [] },
      { key: 'WEB', repoPath: '/Users/a/web2', sharedPaths: ['.cursor/rules'] },
    ]);
    const removed = await app.inject({
      method: 'DELETE',
      url: '/v1/daemon/settings/project-folders/SHOP',
      headers: writeHeaders(a),
    });
    expect(removed.json().revision).toMatchObject({
      author: 'machine:mac-a',
      content: { projects: [{ key: 'WEB', repoPath: '/Users/a/web2', sharedPaths: ['.cursor/rules'] }] },
    });
  });

  it('keeps owner and daemon routes apart', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/settings', headers: a.auth })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/daemon/settings', headers: { cookie: owner.cookie } }))
        .statusCode,
    ).toBe(401);
  });
});
