import type { DaemonRuntimeResponse, Machine, RuntimeRelease } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importFromGithub } from '../src/services/runtime-service.js';
import { type PairedMachine, pairTestMachine } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import { type TestRelease, testRelease, testSigningKey } from './helpers/runtime-signing.js';
import { eventsOf, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
const trusted = testSigningKey('trusted');
const stranger = testSigningKey('stranger');
const KEYS = [{ id: 'test-key', publicKey: trusted.publicKey }];

let app: FastifyInstance;
let owner: LoggedInOwner;
let a: PairedMachine;
let b: PairedMachine;

beforeEach(async () => {
  app = await makeApp(ctx.db, { runtimeExtraKeys: KEYS });
  owner = await seedAndLogin(app, ctx.db);
  a = await pairTestMachine(ctx.db, 'mac-a');
  b = await pairTestMachine(ctx.db, 'mac-b');
});
afterEach(() => app.close());

const upload = (release: TestRelease) =>
  app.inject({
    method: 'POST',
    url: '/v1/runtime/releases',
    headers: owner.headers,
    payload: { ...release, bundle: release.bundle.toString('base64') },
  });
const desired = async (machine: PairedMachine): Promise<DaemonRuntimeResponse> =>
  (await app.inject({ method: 'GET', url: '/v1/daemon/runtime', headers: machine.auth })).json();
const heartbeat = (machine: PairedMachine, shellVersion: string, version = '0.3.0', state = 'idle') =>
  app.inject({
    method: 'POST',
    url: '/v1/daemon/heartbeat',
    headers: machine.auth,
    payload: {
      resources: { cpus: 8, loadAvg1: 1, freeMemGb: 4, totalMemGb: 16 },
      cliVersion: '2.1.0',
      appVersion: shellVersion,
      runtime: {
        shellVersion,
        version,
        source: 'builtin',
        state,
        target: null,
        message: null,
        checkedAt: null,
      },
    },
  });
const pin = (machine: PairedMachine, version: string | null) =>
  app.inject({
    method: 'PUT',
    url: `/v1/machines/${machine.machineId}/runtime`,
    headers: owner.headers,
    payload: { version },
  });

describe('runtime releases', () => {
  it('stores a signed bundle once and tells the owner and every machine', async () => {
    const release = testRelease(trusted.privateKey, '0.3.1');
    const created = await upload(release);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ version: '0.3.1', source: 'upload', keyId: 'test-key' });
    const sent = await eventsOf(ctx.db, 'runtime.published');
    expect(sent.map((event) => event.targetMachineId).sort()).toEqual(
      [null, a.machineId, b.machineId].sort(),
    );

    // The same bundle again is a no-op; another bundle under the same version is refused.
    expect((await upload(release)).statusCode).toBe(200);
    expect(await eventsOf(ctx.db, 'runtime.published')).toHaveLength(3);
    const other = testRelease(trusted.privateKey, '0.3.1', { bundle: Buffer.from('different') });
    expect((await upload(other)).statusCode).toBe(409);

    const list = await app.inject({ method: 'GET', url: '/v1/runtime/releases', headers: owner.headers });
    expect(list.json().items.map((item: RuntimeRelease) => item.version)).toEqual(['0.3.1']);
  });

  it('refuses an unsigned, foreign-signed, tampered or malformed bundle', async () => {
    const good = testRelease(trusted.privateKey, '0.3.1');
    const cases: TestRelease[] = [
      { ...good, signature: Buffer.alloc(64).toString('base64') },
      testRelease(stranger.privateKey, '0.3.1'),
      { ...good, bundle: Buffer.from('tampered bundle') },
      // The manifest changed after signing.
      { ...good, manifest: good.manifest.replace('0.3.1', '0.3.2') },
      testRelease(trusted.privateKey, '0.3.1', {
        tamper: (manifest) => {
          (manifest.files as Record<string, unknown>)['../escape.js'] = { sha256: 'a'.repeat(64), size: 1 };
        },
      }),
    ];
    for (const release of cases) expect((await upload(release)).statusCode).toBe(400);
    expect(await eventsOf(ctx.db, 'runtime.published')).toHaveLength(0);
  });

  it('gives each machine the newest release its app can run, or the pinned one', async () => {
    expect(await desired(a)).toMatchObject({ desired: null, latest: null, pinnedVersion: null });
    await upload(testRelease(trusted.privateKey, '0.3.1'));
    await upload(testRelease(trusted.privateKey, '0.3.2'));
    await upload(testRelease(trusted.privateKey, '0.4.0', { app: '>=0.4.0 <0.5.0' }));

    await heartbeat(a, '0.3.0');
    const forA = await desired(a);
    expect(forA.desired?.version).toBe('0.3.2');
    expect(forA.desired?.manifest).toContain('"version": "0.3.2"');
    expect(forA.desired?.signature).toMatch(/=$/);
    // 0.4.0 needs a newer app: the machine learns it exists.
    expect(forA.latest?.version).toBe('0.4.0');

    expect((await pin(a, '9.9.9')).statusCode).toBe(404);
    expect((await pin(a, '0.3.1')).json()).toEqual({ machineId: a.machineId, pinnedVersion: '0.3.1' });
    expect(await desired(a)).toMatchObject({ desired: { version: '0.3.1' }, pinnedVersion: '0.3.1' });
    const pinned = await eventsOf(ctx.db, 'runtime.pinned');
    expect(pinned.map((event) => event.targetMachineId)).toEqual([null, a.machineId]);
    // Machine b is not affected; unpinning follows the newest again.
    await heartbeat(b, '0.3.0');
    expect((await desired(b)).desired?.version).toBe('0.3.2');
    await pin(a, null);
    expect((await desired(a)).desired?.version).toBe('0.3.2');
  });

  it('serves the tarball to paired machines only', async () => {
    const release = testRelease(trusted.privateKey, '0.3.1');
    await upload(release);
    const got = await app.inject({ method: 'GET', url: '/v1/daemon/runtime/0.3.1/bundle', headers: a.auth });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('application/gzip');
    expect(got.rawPayload.equals(release.bundle)).toBe(true);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/daemon/runtime/0.3.9/bundle', headers: a.auth }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/daemon/runtime/..%2Fx/bundle', headers: a.auth }))
        .statusCode,
    ).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/daemon/runtime/0.3.1/bundle' })).statusCode).toBe(
      401,
    );
    // The owner routes need the session.
    expect((await app.inject({ method: 'GET', url: '/v1/runtime/latest', headers: a.auth })).statusCode).toBe(
      401,
    );
  });

  it('shows each machine its reported runtime and pin, and tells the owner when it changes', async () => {
    await upload(testRelease(trusted.privateKey, '0.3.1'));
    await heartbeat(a, '0.3.0');
    await heartbeat(a, '0.3.0');
    await heartbeat(a, '0.3.0', '0.3.1', 'idle');
    await pin(a, '0.3.1');
    const changes = await eventsOf(ctx.db, 'machine.runtime_changed');
    expect(changes.map((event) => (event.payload as { data: { version: string } }).data.version)).toEqual([
      '0.3.0',
      '0.3.1',
    ]);
    const machines: Machine[] = (
      await app.inject({ method: 'GET', url: '/v1/machines', headers: owner.headers })
    ).json().items;
    expect(machines.find((machine) => machine.id === a.machineId)?.runtime).toMatchObject({
      reported: { shellVersion: '0.3.0', version: '0.3.1', state: 'idle' },
      pinnedVersion: '0.3.1',
    });
    expect(machines.find((machine) => machine.id === b.machineId)?.runtime).toEqual({
      reported: null,
      pinnedVersion: null,
    });
  });
});

describe('runtime import from GitHub', () => {
  function fakeGithub(releases: { tag: string; release?: TestRelease; signed?: boolean }[]): typeof fetch {
    const files = new Map<string, Buffer>();
    const body = releases.map(({ tag, release, signed = true }) => {
      const version = tag.replace('runtime-v', '');
      const assets: { name: string; size: number; browser_download_url: string }[] = [];
      if (release) {
        const add = (name: string, data: Buffer) => {
          files.set(`https://dl.test/${name}`, data);
          assets.push({ name, size: data.length, browser_download_url: `https://dl.test/${name}` });
        };
        add(`crew-runtime-${version}.tar.gz`, release.bundle);
        add(`crew-runtime-${version}.manifest.json`, Buffer.from(release.manifest));
        if (signed) add(`crew-runtime-${version}.manifest.sig`, Buffer.from(release.signature));
      }
      return { tag_name: tag, draft: false, assets };
    });
    return (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://api.github.com/repos/2p/crew/releases')) return Response.json(body);
      const data = files.get(url);
      return data ? new Response(data) : new Response('missing', { status: 404 });
    }) as typeof fetch;
  }

  it('imports signed releases and skips unsigned, foreign-signed and known ones', async () => {
    await upload(testRelease(trusted.privateKey, '0.3.0'));
    const result = await importFromGithub(ctx.db, {
      repo: '2p/crew',
      keys: KEYS,
      fetch: fakeGithub([
        { tag: 'v0.3.0' },
        { tag: 'runtime-v0.3.0', release: testRelease(trusted.privateKey, '0.3.0') },
        { tag: 'runtime-v0.3.1', release: testRelease(trusted.privateKey, '0.3.1') },
        { tag: 'runtime-v0.3.2', release: testRelease(trusted.privateKey, '0.3.2'), signed: false },
        { tag: 'runtime-v0.3.3', release: testRelease(stranger.privateKey, '0.3.3') },
        { tag: 'runtime-v0.3.4', release: testRelease(trusted.privateKey, '0.3.5') },
      ]),
    });
    expect(result.imported).toEqual(['0.3.1']);
    expect(result.skipped.map((item) => item.tag)).toEqual([
      'runtime-v0.3.2',
      'runtime-v0.3.3',
      'runtime-v0.3.4',
    ]);
    expect(result.skipped[0]?.reason).toMatch(/unsigned/);
    const list = await app.inject({ method: 'GET', url: '/v1/runtime/releases', headers: owner.headers });
    expect(list.json().items.map((item: RuntimeRelease) => [item.version, item.source])).toEqual([
      ['0.3.1', 'github'],
      ['0.3.0', 'upload'],
    ]);
  });

  it('refuses the import route while the import is off', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime/releases/import',
      headers: owner.headers,
    });
    expect(response.statusCode).toBe(400);
  });
});
