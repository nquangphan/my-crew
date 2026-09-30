import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DaemonRuntimeResponse, MachineRuntimeState } from '@crew/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { decideRuntime, type LaunchTarget, RuntimeManager } from '../src/main/runtime-manager.js';
import { RuntimeStore } from '../src/main/runtime-store.js';
import { RuntimeRefused, trustedKeys } from '../src/main/runtime-verify.js';
import {
  type Built,
  buildRelease,
  rawEntry,
  rawTarGz,
  releaseFiles,
  runtimeFiles,
  SHELL,
  testKey,
  writeBuiltin,
} from './runtime-fixtures.js';

const trusted = testKey('desktop-trusted');
const stranger = testKey('desktop-stranger');
const KEYS = [{ id: 'test-1', publicKey: trusted.publicKey }];

const dirs: string[] = [];
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crew-runtime-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const refused = (task: () => unknown) => {
  try {
    task();
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeRefused);
    return (error as Error).message;
  }
  throw new Error('expected the bundle to be refused');
};

describe('runtime bundle verification and install', () => {
  it('installs a signed bundle into ~/.crew/runtime/<version> with 0700 folders and verifies it on load', () => {
    const home = tempHome();
    const store = new RuntimeStore(home, KEYS, SHELL);
    const built = buildRelease(trusted.privateKey, '0.3.1');
    const installed = store.install(built.manifest, built.signature, built.bundle);
    expect(installed.dir).toBe(join(home, 'runtime', '0.3.1'));
    expect(readFileSync(join(installed.dir, 'host', 'index.js'), 'utf8')).toContain('0.3.1');
    expect(statSync(join(home, 'runtime')).mode & 0o777).toBe(0o700);
    expect(statSync(installed.dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(installed.dir, 'host', 'index.js')).mode & 0o777).toBe(0o600);
    expect(store.load('0.3.1').manifest.version).toBe('0.3.1');
    store.linkNodeModules(installed.dir, '/Applications/2P Crew.app/Contents/Resources/app/node_modules');
    expect(readlinkSync(join(installed.dir, 'node_modules'))).toContain('2P Crew.app');
    // The link never counts as a bundle file.
    expect(store.load('0.3.1').version).toBe('0.3.1');
  });

  it('refuses a bundle that is unsigned, signed by another key, or whose manifest changed after signing', () => {
    const store = new RuntimeStore(tempHome(), KEYS, SHELL);
    const good = buildRelease(trusted.privateKey, '0.3.1');
    expect(refused(() => store.install(good.manifest, null, good.bundle))).toMatch(/chưa được ký/);
    const foreign = buildRelease(stranger.privateKey, '0.3.1');
    expect(refused(() => store.install(foreign.manifest, foreign.signature, foreign.bundle))).toMatch(
      /Chữ ký/,
    );
    const edited = good.manifest.replace('"0.3.1"', '"0.3.2"');
    expect(refused(() => store.install(edited, good.signature, good.bundle))).toMatch(/Chữ ký/);
    expect(existsSync(join(store.root, '0.3.1'))).toBe(false);
  });

  it('refuses a tampered tarball or a tampered file inside it', () => {
    const store = new RuntimeStore(tempHome(), KEYS, SHELL);
    const good = buildRelease(trusted.privateKey, '0.3.1');
    const flipped = Buffer.from(good.bundle);
    flipped[flipped.length - 10] = (flipped[flipped.length - 10] as number) ^ 0xff;
    expect(refused(() => store.install(good.manifest, good.signature, flipped))).toMatch(/hash không khớp/);

    // A tarball whose host/index.js differs from the manifest (the manifest signs the tarball it names).
    const files = runtimeFiles('0.3.1');
    const evil = new Map(files);
    evil.set('host/index.js', Buffer.from('process.exit(1)'));
    const liar = buildRelease(trusted.privateKey, '0.3.1', {
      files,
      pack: () => rawTarGz([...evil].map(([path, data]) => rawEntry(path, data))),
    });
    expect(refused(() => store.install(liar.manifest, liar.signature, liar.bundle))).toMatch(/bị sửa/);
  });

  it('refuses a bundle for another shell (app version or Electron major)', () => {
    const store = new RuntimeStore(tempHome(), KEYS, SHELL);
    const newer = buildRelease(trusted.privateKey, '0.4.0', {
      shellRange: { app: '>=0.4.0 <0.5.0', electron: '44' },
    });
    expect(refused(() => store.install(newer.manifest, newer.signature, newer.bundle))).toMatch(/0\.4\.0/);
    const electron = buildRelease(trusted.privateKey, '0.3.1', {
      shellRange: { app: '>=0.3.0', electron: '45' },
    });
    expect(refused(() => store.install(electron.manifest, electron.signature, electron.bundle))).toMatch(
      /Electron 45/,
    );
  });

  it('refuses path traversal, absolute paths, links and entries outside the manifest', () => {
    const home = tempHome();
    const store = new RuntimeStore(home, KEYS, SHELL);
    const files = runtimeFiles('0.3.1');
    const hostile = (extra: Buffer) =>
      buildRelease(trusted.privateKey, '0.3.1', {
        files,
        pack: () => rawTarGz([...[...files].map(([path, data]) => rawEntry(path, data)), extra]),
      });
    for (const extra of [
      rawEntry('../../escape.js', Buffer.from('x')),
      rawEntry('host/../../escape.js', Buffer.from('x')),
      rawEntry('/tmp/escape.js', Buffer.from('x')),
      rawEntry('host/link', Buffer.alloc(0), '2', '/etc/passwd'),
      rawEntry('host/hard', Buffer.alloc(0), '1', 'host/index.js'),
      rawEntry('host/extra.js', Buffer.from('x')),
    ]) {
      const built = hostile(extra);
      refused(() => store.install(built.manifest, built.signature, built.bundle));
    }
    expect(existsSync(join(home, 'escape.js'))).toBe(false);
    expect(existsSync(join(store.root, '0.3.1'))).toBe(false);
  });

  it('refuses to run an installed bundle changed on disk', () => {
    const store = new RuntimeStore(tempHome(), KEYS, SHELL);
    const built = buildRelease(trusted.privateKey, '0.3.1');
    const { dir } = store.install(built.manifest, built.signature, built.bundle);
    writeFileSync(join(dir, 'host', 'index.js'), 'globalThis.pwned = true;\n');
    expect(refused(() => store.load('0.3.1'))).toMatch(/bị sửa/);
    writeFileSync(join(dir, 'host', 'index.js'), runtimeFiles('0.3.1').get('host/index.js') as Buffer);
    writeFileSync(join(dir, 'host', 'dropped.js'), 'x');
    expect(refused(() => store.load('0.3.1'))).toMatch(/file lạ/);
  });

  it('trusts test keys only in the E2E test mode', () => {
    expect(
      trustedKeys({ CREW_RUNTIME_TEST_KEYS: trusted.publicKey }).map((key) => key.publicKey),
    ).not.toContain(trusted.publicKey);
    expect(
      trustedKeys({ CREW_DESKTOP_TEST_MODE: '1', CREW_RUNTIME_TEST_KEYS: trusted.publicKey }).map(
        (key) => key.publicKey,
      ),
    ).toContain(trusted.publicKey);
  });
});

describe('which runtime to run', () => {
  const release = (version: string, app = '>=0.3.0 <0.4.0') =>
    releaseFiles(
      buildRelease(trusted.privateKey, version, { shellRange: { app, electron: '44' } }),
      version,
      app,
    );
  const context = { current: '0.3.0', builtin: '0.3.0', bad: {}, shell: SHELL };
  const answer = (
    desired: string | null,
    extra: Partial<DaemonRuntimeResponse> = {},
  ): DaemonRuntimeResponse => ({
    desired: desired ? release(desired) : null,
    pinnedVersion: null,
    latest: desired ? release(desired) : null,
    ...extra,
  });

  it('installs a newer release, stays on the current one, never goes below the shipped one unless pinned', () => {
    expect(decideRuntime(answer('0.3.1'), context).kind).toBe('install');
    expect(decideRuntime(answer('0.3.1'), { ...context, current: '0.3.1' })).toEqual({
      kind: 'stay',
      notice: null,
    });
    expect(decideRuntime(answer(null), context)).toEqual({ kind: 'stay', notice: null });
    // An older unpinned release than the shipped one: the shipped runtime runs.
    expect(decideRuntime(answer('0.2.9'), { ...context, current: '0.3.1' }).kind).toBe('builtin');
    // Pinned to an older release: a rollback to it.
    expect(
      decideRuntime(answer('0.3.1', { pinnedVersion: '0.3.1' }), { ...context, current: '0.3.2' }).kind,
    ).toBe('install');
  });

  it('asks for a dmg when the newest release needs a newer app, and never retries a failed version', () => {
    const decision = decideRuntime(answer('0.3.1', { latest: release('0.4.0', '>=0.4.0') }), {
      ...context,
      current: '0.3.1',
    });
    expect(decision).toMatchObject({ kind: 'stay', notice: expect.stringMatching(/0\.4\.0.*dmg/) });
    const pinnedTooNew = decideRuntime(
      { desired: release('0.4.0', '>=0.4.0'), pinnedVersion: '0.4.0', latest: null },
      context,
    );
    expect(pinnedTooNew).toMatchObject({ kind: 'blocked', state: 'shell_update_required' });
    expect(decideRuntime(answer('0.3.1'), { ...context, bad: { '0.3.1': 'host crashed' } })).toMatchObject({
      kind: 'blocked',
      state: 'rolled_back',
    });
  });
});

describe('runtime update state machine', () => {
  interface Harness {
    manager: RuntimeManager;
    store: RuntimeStore;
    switches: LaunchTarget[];
    states: MachineRuntimeState[];
    releases: Map<string, Built>;
    answer: { value: DaemonRuntimeResponse | null };
    jobs: { running: number };
    clock: { now: number };
    home: string;
  }

  function harness(options: { switchFails?: boolean } = {}): Harness {
    const home = tempHome();
    const builtinDir = join(home, 'app', 'runtime');
    writeBuiltin(builtinDir, '0.3.0');
    mkdirSync(join(home, 'app', 'node_modules'), { recursive: true });
    const store = new RuntimeStore(home, KEYS, SHELL);
    const releases = new Map<string, Built>();
    const answer: { value: DaemonRuntimeResponse | null } = { value: null };
    const switches: LaunchTarget[] = [];
    const states: MachineRuntimeState[] = [];
    const jobs = { running: 0 };
    const clock = { now: Date.parse('2026-09-30T05:00:00.000Z') };
    const manager = new RuntimeManager({
      store,
      builtin: { version: '0.3.0', dir: builtinDir },
      shell: SHELL,
      enabled: true,
      nodeModules: join(home, 'app', 'node_modules'),
      check: async () => answer.value,
      download: async (version) => {
        const built = releases.get(version);
        if (!built) throw new Error('404');
        mkdirSync(store.incoming, { recursive: true });
        const path = join(store.incoming, `${version}.tar.gz`);
        writeFileSync(path, built.bundle);
        return path;
      },
      runningJobs: () => jobs.running,
      switchTo: async (target) => {
        if (options.switchFails && target.source === 'installed') throw new Error('host did not start');
        switches.push(target);
      },
      onState: (state) => states.push(state),
      log: () => undefined,
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
        if (jobs.running > 0) jobs.running -= 1;
      },
      waitForJobsMs: 60_000,
      pollJobsMs: 15_000,
    });
    return { manager, store, switches, states, releases, answer, jobs, clock, home };
  }

  function publish(h: Harness, version: string, pinned: string | null = null): Built {
    const built = buildRelease(trusted.privateKey, version);
    h.releases.set(version, built);
    h.answer.value = {
      desired: releaseFiles(built, version),
      pinnedVersion: pinned,
      latest: releaseFiles(built, version),
    };
    return built;
  }

  it('downloads, verifies, waits for running jobs, then switches the host and window to the new runtime', async () => {
    const h = harness();
    expect(h.manager.select().source).toBe('builtin');
    publish(h, '0.3.1');
    h.jobs.running = 2;
    const state = await h.manager.check();
    expect(state).toMatchObject({ state: 'idle', version: '0.3.1', source: 'installed' });
    expect(h.states.map((s) => s.state)).toEqual([
      'checking',
      'downloading',
      'installing',
      'waiting',
      'waiting',
      'switching',
      'idle',
    ]);
    expect(h.switches.map((target) => [target.version, target.source])).toEqual([['0.3.1', 'installed']]);
    expect(h.switches[0]?.hostEntry).toBe(join(h.home, 'runtime', '0.3.1', 'host', 'index.js'));
    expect(lstatSync(join(h.home, 'runtime', '0.3.1', 'node_modules')).isSymbolicLink()).toBe(true);
    expect(h.store.read()).toMatchObject({
      active: '0.3.1',
      probation: { version: '0.3.1', previous: null },
    });
    // A second check changes nothing; the next launch starts the installed runtime.
    await h.manager.check();
    expect(h.switches).toHaveLength(1);
    h.manager.dispose();
    const relaunched = new RuntimeManager({
      store: new RuntimeStore(h.home, KEYS, SHELL),
      builtin: { version: '0.3.0', dir: join(h.home, 'app', 'runtime') },
      shell: SHELL,
      enabled: true,
      nodeModules: join(h.home, 'app', 'node_modules'),
      check: async () => null,
      download: async () => '',
      runningJobs: () => 0,
      switchTo: async () => undefined,
      onState: () => undefined,
      log: () => undefined,
    });
    expect(relaunched.select()).toMatchObject({ version: '0.3.1', source: 'installed' });
    relaunched.dispose();
  });

  it('refuses a tampered download and keeps running the current runtime', async () => {
    const h = harness();
    h.manager.select();
    const built = publish(h, '0.3.1');
    h.releases.set('0.3.1', { ...built, bundle: Buffer.concat([built.bundle, Buffer.from('x')]) });
    const state = await h.manager.check();
    expect(state).toMatchObject({ state: 'refused', version: '0.3.0', target: '0.3.1' });
    expect(h.switches).toHaveLength(0);
    expect(existsSync(join(h.home, 'runtime', '0.3.1'))).toBe(false);
  });

  it('rolls back when the new host misses the ready timeout twice, and does not retry that version', async () => {
    const h = harness();
    h.manager.select();
    publish(h, '0.3.1');
    await h.manager.check();
    h.manager.onReadyTimeout();
    expect(h.switches).toHaveLength(1);
    h.manager.onReadyTimeout();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.switches.map((target) => target.version)).toEqual(['0.3.1', '0.3.0']);
    expect(h.manager.state()).toMatchObject({ state: 'rolled_back', version: '0.3.0', target: '0.3.1' });
    expect(h.store.read()).toMatchObject({
      active: null,
      probation: null,
      bad: { '0.3.1': expect.any(String) },
    });
    // The failed version is not installed again.
    const again = await h.manager.check();
    expect(again).toMatchObject({ state: 'rolled_back', target: '0.3.1' });
    expect(h.switches).toHaveLength(2);
    h.manager.dispose();
  });

  it('rolls back to the previous installed runtime when the new host crashes repeatedly within 5 minutes', async () => {
    const h = harness();
    h.manager.select();
    publish(h, '0.3.1');
    await h.manager.check();
    h.manager.endProbation();
    publish(h, '0.3.2');
    await h.manager.check();
    expect(h.manager.current().version).toBe('0.3.2');
    h.manager.onHostCrash();
    h.clock.now += 6 * 60 * 1000;
    // Crashes older than 5 minutes do not count.
    h.manager.onHostCrash();
    h.manager.onHostCrash();
    expect(h.manager.current().version).toBe('0.3.2');
    h.manager.onHostCrash();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.manager.current()).toMatchObject({ version: '0.3.1', source: 'installed' });
    expect(h.store.read()).toMatchObject({
      active: '0.3.1',
      bad: { '0.3.2': expect.stringMatching(/3 lần/) },
    });
    h.manager.dispose();
  });

  it('checks again once a runtime on probation proved itself', async () => {
    const h = harness();
    h.manager.select();
    publish(h, '0.3.1');
    await h.manager.check();
    publish(h, '0.3.2');
    await h.manager.check();
    expect(h.manager.current().version).toBe('0.3.1');
    h.manager.endProbation();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.manager.current().version).toBe('0.3.2');
    h.manager.dispose();
  });

  it('rolls back when the switch itself fails', async () => {
    const h = harness({ switchFails: true });
    h.manager.select();
    publish(h, '0.3.1');
    const state = await h.manager.check();
    expect(state).toMatchObject({ state: 'rolled_back', version: '0.3.0', target: '0.3.1' });
    h.manager.dispose();
  });

  it('keeps the active runtime and two previous ones once a new one proved itself', async () => {
    const h = harness();
    h.manager.select();
    for (const version of ['0.3.1', '0.3.2', '0.3.3', '0.3.4']) {
      publish(h, version);
      await h.manager.check();
      h.manager.endProbation();
    }
    expect(h.store.read()).toMatchObject({ active: '0.3.4', history: ['0.3.3', '0.3.2'] });
    expect(existsSync(join(h.store.root, '0.3.1'))).toBe(false);
    expect(existsSync(join(h.store.root, '0.3.2'))).toBe(true);
  });

  it('follows a pin back to an older release, and to the shipped runtime', async () => {
    const h = harness();
    h.manager.select();
    publish(h, '0.3.1');
    await h.manager.check();
    h.manager.endProbation();
    publish(h, '0.3.2');
    await h.manager.check();
    h.manager.endProbation();
    h.answer.value = {
      desired: releaseFiles(h.releases.get('0.3.1') as Built, '0.3.1'),
      pinnedVersion: '0.3.1',
      latest: releaseFiles(h.releases.get('0.3.2') as Built, '0.3.2'),
    };
    await h.manager.check();
    expect(h.manager.current()).toMatchObject({ version: '0.3.1', source: 'installed' });
    h.manager.endProbation();
    const builtin = buildRelease(trusted.privateKey, '0.3.0');
    h.answer.value = { desired: releaseFiles(builtin, '0.3.0'), pinnedVersion: '0.3.0', latest: null };
    await h.manager.check();
    expect(h.manager.current().source).toBe('builtin');
    expect(h.switches.map((target) => target.version)).toEqual(['0.3.1', '0.3.2', '0.3.1', '0.3.0']);
  });

  it('starts the shipped runtime when the active one no longer verifies at launch', async () => {
    const h = harness();
    h.manager.select();
    publish(h, '0.3.1');
    await h.manager.check();
    h.manager.endProbation();
    h.manager.dispose();
    writeFileSync(join(h.store.root, '0.3.1', 'renderer', 'index.html'), '<script>evil()</script>');
    const relaunched = new RuntimeManager({
      store: new RuntimeStore(h.home, KEYS, SHELL),
      builtin: { version: '0.3.0', dir: join(h.home, 'app', 'runtime') },
      shell: SHELL,
      enabled: true,
      nodeModules: join(h.home, 'app', 'node_modules'),
      check: async () => null,
      download: async () => '',
      runningJobs: () => 0,
      switchTo: async () => undefined,
      onState: () => undefined,
      log: () => undefined,
    });
    expect(relaunched.select().source).toBe('builtin');
    expect(h.store.read()).toMatchObject({ active: null, bad: { '0.3.1': expect.stringMatching(/bị sửa/) } });
  });

  it('does nothing in a development build', async () => {
    const home = tempHome();
    const manager = new RuntimeManager({
      store: new RuntimeStore(home, KEYS, SHELL),
      builtin: { version: '0.3.0', dir: join(home, 'runtime-builtin') },
      shell: SHELL,
      enabled: false,
      nodeModules: '',
      check: async () => {
        throw new Error('must not ask the server');
      },
      download: async () => '',
      runningJobs: () => 0,
      switchTo: async () => undefined,
      onState: () => undefined,
      log: () => undefined,
    });
    expect(manager.select().source).toBe('builtin');
    expect(await manager.check()).toMatchObject({ state: 'disabled' });
    expect(existsSync(join(home, 'runtime'))).toBe(false);
  });
});
