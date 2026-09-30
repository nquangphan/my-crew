import { EventEmitter } from 'node:events';
import type { FromHost, ToHost } from '@crew/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { DaemonSupervisor, type HostProcess } from '../src/main/daemon-supervisor.js';

interface HostBehaviour {
  /** Stuck before reporting ready (a blocked event loop). */
  neverReady?: boolean;
  /** SIGTERM does nothing (a blocked event loop never runs the handler); only SIGKILL ends it. */
  ignoresTerm?: boolean;
}

/** A scripted stand-in for the utility process: answers requests, can crash, records what it received. */
class FakeHost implements HostProcess {
  static nextPid = 1000;
  readonly pid = FakeHost.nextPid++;
  readonly received: ToHost[] = [];
  private readonly events = new EventEmitter();
  alive = true;
  terminated = false;
  forceKilled = false;

  constructor(
    private readonly answer: (method: string) => unknown = () => null,
    private readonly behaviour: HostBehaviour = {},
  ) {
    if (!behaviour.neverReady) setTimeout(() => this.send({ kind: 'ready' }), 5);
  }

  send(message: FromHost): void {
    if (this.alive) this.events.emit('message', message);
  }

  postMessage(message: ToHost): void {
    this.received.push(message);
    if (message.kind !== 'request') return;
    setTimeout(
      () => this.send({ kind: 'response', id: message.id, ok: true, result: this.answer(message.method) }),
      5,
    );
  }

  onMessage(listener: (message: unknown) => void): void {
    this.events.on('message', listener);
  }

  onExit(listener: (code: number) => void): void {
    this.events.on('exit', listener);
  }

  kill(): void {
    this.terminated = true;
    if (!this.behaviour.ignoresTerm) this.crash(0);
  }

  forceKill(): void {
    this.forceKilled = true;
    this.crash(137);
  }

  crash(code = 1): void {
    if (!this.alive) return;
    this.alive = false;
    setTimeout(() => this.events.emit('exit', code), 1);
  }

  methods(): string[] {
    return this.received.flatMap((message) => (message.kind === 'request' ? [message.method] : []));
  }
}

const until = async (condition: () => boolean, ms = 2_000) => {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const supervisors: DaemonSupervisor[] = [];
afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) await supervisor.stop('requeue');
});

function setup(
  options: {
    initialBackoffMs?: number;
    stableMs?: number;
    readyTimeoutMs?: number;
    killGraceMs?: number;
    behaviour?: (index: number) => HostBehaviour;
  } = {},
) {
  const hosts: FakeHost[] = [];
  const supervisor = new DaemonSupervisor({
    fork: () => {
      const host = new FakeHost(undefined, options.behaviour?.(hosts.length));
      hosts.push(host);
      return host;
    },
    initialBackoffMs: options.initialBackoffMs ?? 20,
    maxBackoffMs: 200,
    stableMs: options.stableMs ?? 60_000,
    ...(options.readyTimeoutMs ? { readyTimeoutMs: options.readyTimeoutMs } : {}),
    ...(options.killGraceMs ? { killGraceMs: options.killGraceMs } : {}),
  });
  supervisors.push(supervisor);
  return { supervisor, hosts };
}

describe('daemon supervisor', () => {
  it('restarts a crashed daemon host with backoff and starts the daemon again with the pause re-applied', async () => {
    const { supervisor, hosts } = setup();
    supervisor.setPaused(true);
    await supervisor.startDaemon();
    await until(() => supervisor.runtime().daemonStarted);
    expect(hosts[0]?.methods()).toEqual(['host.startDaemon', 'daemon.pause']);

    const firstPid = supervisor.runtime().pid;
    hosts[0]?.crash(1);
    await until(() => supervisor.runtime().state === 'crashed');
    expect(supervisor.runtime()).toMatchObject({ restarts: 1, lastExit: 'thoát với mã 1' });

    await until(() => supervisor.runtime().daemonStarted && hosts.length === 2);
    expect(supervisor.runtime().pid).not.toBe(firstPid);
    expect(hosts[1]?.methods()).toEqual(['host.startDaemon', 'daemon.pause']);
  });

  it('kills a host that never reports ready (SIGKILL when SIGTERM is ignored) and restarts it', async () => {
    const { supervisor, hosts } = setup({
      readyTimeoutMs: 60,
      killGraceMs: 30,
      behaviour: (index) => (index === 0 ? { neverReady: true, ignoresTerm: true } : {}),
    });
    const timeouts: unknown[] = [];
    supervisor.on('ready-timeout', (fields) => timeouts.push(fields));
    await supervisor.startDaemon();
    // A request made while the host hangs is answered by the restarted host.
    const pending = supervisor.request('health.get', {});
    await until(() => supervisor.runtime().daemonStarted && hosts.length === 2);
    await expect(pending).resolves.toBeNull();
    expect(timeouts).toEqual([{ pid: hosts[0]?.pid, ms: 60 }]);
    expect(hosts[0]).toMatchObject({ terminated: true, forceKilled: true });
    expect(supervisor.runtime()).toMatchObject({ state: 'running', restarts: 1 });
    expect(supervisor.runtime().lastExit).toContain('không báo sẵn sàng sau');
    expect(hosts[1]?.methods().sort()).toEqual(['health.get', 'host.startDaemon']);
  });

  it('never force-kills or times out a host that reported ready', async () => {
    const { supervisor, hosts } = setup({ readyTimeoutMs: 40, killGraceMs: 10, initialBackoffMs: 10 });
    await supervisor.startDaemon();
    await until(() => supervisor.runtime().daemonStarted);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(hosts).toHaveLength(1);
    supervisor.restart();
    await until(() => hosts.length === 2 && supervisor.runtime().daemonStarted);
    expect(hosts[0]).toMatchObject({ terminated: true, forceKilled: false });
  });

  it('passes the host app-log lines on to the main process', async () => {
    const { supervisor, hosts } = setup();
    const lines: unknown[] = [];
    supervisor.on('host-log', (entry) => lines.push(entry));
    supervisor.start();
    await until(() => supervisor.runtime().state === 'running');
    const entry = { level: 'warn', source: 'host', event: 'api-error', fields: { status: 409 } } as const;
    hosts[0]?.send({ kind: 'log', entry });
    expect(lines).toEqual([entry]);
  });

  it('doubles the backoff on repeated crashes, well under 10 s for the first restart', async () => {
    const { supervisor, hosts } = setup({ initialBackoffMs: 30 });
    supervisor.start();
    await until(() => supervisor.runtime().state === 'running');
    const restartedAfter: number[] = [];
    for (let i = 0; i < 3; i++) {
      const crashedAt = Date.now();
      hosts.at(-1)?.crash(1);
      const count = hosts.length;
      await until(() => hosts.length === count + 1);
      restartedAfter.push(Date.now() - crashedAt);
    }
    expect(restartedAfter[0]).toBeLessThan(10_000);
    expect(restartedAfter[1]).toBeGreaterThanOrEqual(55);
    expect(restartedAfter[2]).toBeGreaterThanOrEqual(115);
  });

  it('rejects requests in flight when the host dies, and answers again after the restart', async () => {
    const { supervisor, hosts } = setup();
    supervisor.start();
    await until(() => supervisor.runtime().state === 'running');
    const host = hosts[0] as FakeHost;
    host.postMessage = (message) => host.received.push(message); // never answers
    const pending = supervisor.request('health.get', {});
    await until(() => host.methods().includes('health.get'));
    host.crash(1);
    await expect(pending).rejects.toThrow('khởi động lại');
    await until(() => supervisor.runtime().state === 'running' && hosts.length === 2);
    await expect(supervisor.request('health.get', {})).resolves.toBeNull();
  });

  it('forwards host events and pushes the app facts after every start', async () => {
    const { supervisor, hosts } = setup();
    const events: string[] = [];
    supervisor.on('host-event', (name: string) => events.push(name));
    supervisor.setFacts({
      version: '0.1.0',
      loginItem: true,
      update: { state: 'disabled', version: null, canAutoInstall: false, downloadUrl: null, message: null },
    });
    supervisor.start();
    await until(() => supervisor.runtime().state === 'running');
    expect(hosts[0]?.received[0]).toMatchObject({ kind: 'facts', facts: { version: '0.1.0' } });
    hosts[0]?.send({ kind: 'event', name: 'health.report', payload: {} });
    await until(() => events.length === 1);
    expect(events).toEqual(['health.report']);
  });

  it('a graceful stop asks the host to stop the daemon in the chosen mode and never restarts it', async () => {
    const { supervisor, hosts } = setup();
    await supervisor.startDaemon();
    await until(() => supervisor.runtime().daemonStarted);
    await supervisor.stop('drain');
    expect(hosts[0]?.received.at(-1)).toMatchObject({
      kind: 'request',
      method: 'host.stopDaemon',
      params: { mode: 'drain' },
    });
    expect(supervisor.runtime().state).toBe('stopped');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hosts).toHaveLength(1);
  });

  it('restart() replaces the host at once (the "restart daemon" fix)', async () => {
    const { supervisor, hosts } = setup({ initialBackoffMs: 10 });
    await supervisor.startDaemon();
    await until(() => supervisor.runtime().daemonStarted);
    supervisor.restart();
    await until(() => hosts.length === 2 && supervisor.runtime().daemonStarted);
    expect(hosts[1]?.methods()).toContain('host.startDaemon');
  });
});
