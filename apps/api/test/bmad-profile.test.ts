import type { BmadProfile } from '@crew/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projects } from '../src/db/schema.js';
import { type PairedMachine, pairTestMachine, writeHeaders } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import { createTestProject, useTestDb } from './helpers/test-db.js';

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

const PROFILE: BmadProfile = {
  version: '6.12.0',
  lastUpdated: '2026-09-24T15:27:41.562Z',
  modules: ['core', 'bmm', 'tea'],
  tools: ['claude-code', 'codex'],
  communicationLanguage: 'Vietnamese',
  documentOutputLanguage: 'Vietnamese',
  outputFolder: '_bmad-output',
  settings: [
    { module: 'core', key: 'project_name', value: 'kidy_school' },
    { module: 'bmm', key: 'project_knowledge', value: '{project-root}/docs' },
    { module: 'tea', key: 'tea_use_playwright_utils', value: 'true' },
  ],
  pins: [{ module: 'tea', tag: 'v1.27.2' }],
};

const put = (machine: PairedMachine, body: unknown, projectKey = 'WEB', key?: string) =>
  app.inject({
    method: 'PUT',
    url: `/v1/daemon/projects/${projectKey}/bmad-profile`,
    headers: writeHeaders(machine, key),
    payload: body as object,
  });
const stored = async () => {
  const [row] = await ctx.db.select().from(projects).where(eq(projects.key, 'WEB'));
  return row?.bmadProfile ?? null;
};

describe('a machine reporting its project BMAD profile', () => {
  it('stores the owning machine profile and shows it to the owner and to every machine', async () => {
    const web = await createTestProject(ctx.db, { ownerMachineId: a.machineId });
    const before = await app.inject({ method: 'GET', url: `/v1/projects/${web.id}`, headers: owner.headers });
    expect(before.json().bmadProfile).toBeNull();
    const res = await put(a, PROFILE);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stored: true, profile: PROFILE });
    expect(await stored()).toEqual(PROFILE);

    const ownerView = await app.inject({
      method: 'GET',
      url: `/v1/projects/${web.id}`,
      headers: owner.headers,
    });
    expect(ownerView.json().bmadProfile).toEqual(PROFILE);
    const machineView = await app.inject({ method: 'GET', url: '/v1/daemon/projects', headers: b.auth });
    expect(machineView.json().items[0].bmadProfile).toEqual(PROFILE);
  });

  it('refuses another machine (403), an unknown project (404) and a bad project key (400)', async () => {
    await createTestProject(ctx.db, { ownerMachineId: a.machineId });
    expect((await put(b, PROFILE)).statusCode).toBe(403);
    expect(await stored()).toBeNull();
    expect((await put(a, PROFILE, 'NOPE')).statusCode).toBe(404);
    expect((await put(a, PROFILE, 'bad-key')).statusCode).toBe(400);
    const unowned = await createTestProject(ctx.db, { key: 'APP', repoUrl: 'https://github.com/2p/app.git' });
    expect(unowned.ownerMachineId).toBeNull();
    expect((await put(a, PROFILE, 'APP')).statusCode).toBe(403);
  });

  it('rejects personal answers, secrets, absolute paths, unknown fields and malformed versions', async () => {
    await createTestProject(ctx.db, { ownerMachineId: a.machineId });
    const bad: unknown[] = [
      { ...PROFILE, settings: [{ module: 'core', key: 'user_name', value: 'Đại Ca' }] },
      { ...PROFILE, settings: [{ module: 'bmm', key: 'user_skill_level', value: 'expert' }] },
      { ...PROFILE, settings: [{ module: 'x', key: 'api_token', value: 'abc' }] },
      { ...PROFILE, settings: [{ module: 'bmb', key: 'out', value: '/Users/me/skills' }] },
      { ...PROFILE, outputFolder: '../outside' },
      { ...PROFILE, version: 'latest' },
      { ...PROFILE, modules: [] },
      { ...PROFILE, modules: ['Bad Module'] },
      { ...PROFILE, userName: 'Đại Ca' },
      { ...PROFILE, pins: [{ module: 'tea', tag: 'main' }] },
    ];
    for (const body of bad) {
      const res = await put(a, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    expect(await stored()).toBeNull();
  });

  it('keeps the newest install: an older profile from a machine that took the project over is not stored', async () => {
    await createTestProject(ctx.db, { ownerMachineId: a.machineId });
    expect((await put(a, PROFILE)).json().stored).toBe(true);

    await ctx.db.update(projects).set({ ownerMachineId: b.machineId }).where(eq(projects.key, 'WEB'));
    const older = {
      ...PROFILE,
      version: '6.10.0',
      lastUpdated: '2026-05-01T08:00:00.000Z',
      modules: ['core'],
    };
    const res = await put(b, older);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stored: false, profile: PROFILE });
    expect(await stored()).toEqual(PROFILE);

    const newer = { ...PROFILE, version: '6.13.0', lastUpdated: '2026-10-01T08:00:00.000Z' };
    expect((await put(b, newer)).json()).toEqual({ stored: true, profile: newer });
    expect(await stored()).toEqual(newer);
  });

  it('stores a profile from an older daemon without pins as having none', async () => {
    await createTestProject(ctx.db, { ownerMachineId: a.machineId });
    const { pins: _pins, ...withoutPins } = PROFILE;
    const res = await put(a, withoutPins);
    expect(res.statusCode).toBe(200);
    expect(await stored()).toEqual({ ...PROFILE, pins: [] });
  });

  it('requires an idempotency key and replays the stored answer on retry', async () => {
    await createTestProject(ctx.db, { ownerMachineId: a.machineId });
    const noKey = await app.inject({
      method: 'PUT',
      url: '/v1/daemon/projects/WEB/bmad-profile',
      headers: a.auth,
      payload: PROFILE,
    });
    expect(noKey.statusCode).toBe(400);
    const first = await put(a, PROFILE, 'WEB', 'bmad-retry-1');
    const again = await put(a, PROFILE, 'WEB', 'bmad-retry-1');
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
  });
});
