import { type ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectionPin, SourcePin } from '../host/status.ts';
import {
  AtomicRecords,
  atomicWrite,
  canonicalJson,
  hash,
  privateDirectory,
  readRecord,
  writeExclusiveRecord,
} from './atomic-records.ts';
import { type NativeProcessIdentity, ProcessIdentity } from './native.ts';
export type LaunchInput = {
  commandId: string;
  ticketId: string;
  processInstanceId: string;
  source: SourcePin;
  projection: ProjectionPin;
};
export type PinAdmissionAuthority = {
  registryRoot: string;
  verify: (input: LaunchInput) => Promise<void>;
};
export type PinAdmissionIntent = LaunchInput & { formatVersion: 1; registryRoot: string };
type PinAdmissionBinding = { formatVersion: 1; registryRoot: string };
export const pinAdmissionMarkerPath = (hostRoot: string): string =>
  join(hostRoot, 'workflows', 'pin-authority.json');
export type AttemptProjectionPin = {
  attemptId: string;
  fence: string;
  processInstanceId: string;
  sourceTreeSha256: string;
  runtime: ProjectionPin['runtime'];
  projectionManifestSha256: string;
  projectionTreeSha256: string;
  installReportId: string;
};
export type LaunchRecord = LaunchInput & {
  formatVersion: 1;
  launchId: string;
  reservedAt: string;
  authorization: AttemptProjectionPin | null;
  lastObservation: 'running' | 'stopped' | 'unknown';
  lastError: string | null;
};
export type ReadyRecord = {
  formatVersion: 1;
  launchId: string;
  processInstanceId: string;
  pid: number;
  startIdentity: string;
  processGroupId: number;
  uid: number;
};
type StopRecord = ReadyRecord & {
  waitedAt: string;
  exitCode: number | null;
  signal: string | null;
  groupEmpty: true;
};
async function nativeSource(): Promise<string> {
  const local = fileURLToPath(new URL('./native-identity.c', import.meta.url));
  try {
    await access(local);
    return local;
  } catch {
    return fileURLToPath(new URL('../../../src/journal/native-identity.c', import.meta.url));
  }
}
export const makeStartIdentity = (launchId: string, p: NativeProcessIdentity): string =>
  `${launchId}:${p.pid}:${p.birth}:${p.processGroupId}:${p.uid}`;
export class ProcessJournal {
  readonly root: string;
  readonly identity: ProcessIdentity;
  private readonly store: AtomicRecords;
  private pinAuthority: PinAdmissionAuthority | null = null;
  private constructor(root: string, store: AtomicRecords, identity: ProcessIdentity) {
    this.root = root;
    this.store = store;
    this.identity = identity;
  }
  static async open(root: string): Promise<ProcessJournal> {
    await privateDirectory(root);
    const path = join(root, 'process-journal');
    const store = await AtomicRecords.open(path);
    try {
      await privateDirectory(join(path, 'proofs'));
      await privateDirectory(join(path, 'admissions'));
      const identity = await ProcessIdentity.open(path, await nativeSource());
      return new ProcessJournal(path, store, identity);
    } catch (error) {
      await store.close();
      throw error;
    }
  }
  async bindPinAdmission(authority: PinAdmissionAuthority): Promise<void> {
    await this.store.transaction(async () => {
      const marker = await readRecord<PinAdmissionBinding>(pinAdmissionMarkerPath(dirname(this.root)));
      const path = join(this.root, 'pin-admission.json');
      const binding = await readRecord<PinAdmissionBinding>(path);
      if (
        authority.registryRoot !== join(dirname(this.root), 'workflows') ||
        marker?.registryRoot !== authority.registryRoot ||
        (binding && binding.registryRoot !== authority.registryRoot)
      )
        throw new Error('PIN_ADMISSION_BINDING_CONFLICT');
      if (!binding)
        await writeExclusiveRecord(path, { formatVersion: 1, registryRoot: authority.registryRoot });
      this.pinAuthority = authority;
    });
  }
  private async admissionAuthority(): Promise<PinAdmissionAuthority | null> {
    const binding = await readRecord<PinAdmissionBinding>(join(this.root, 'pin-admission.json'));
    const marker = await readRecord<PinAdmissionBinding>(pinAdmissionMarkerPath(dirname(this.root)));
    if (binding || marker) {
      if (
        !binding ||
        !this.pinAuthority ||
        binding.registryRoot !== this.pinAuthority.registryRoot ||
        marker?.registryRoot !== binding.registryRoot
      )
        throw new Error('PIN_ADMISSION_NOT_BOUND');
      return this.pinAuthority;
    }
    return null; // Legacy standalone Task2 journal; no managed registry exists.
  }
  async withPinAdmissionBarrier<T>(registryRoot: string, action: () => Promise<T>): Promise<T> {
    return this.store.transaction(async () => {
      if ((await this.admissionAuthority())?.registryRoot !== registryRoot)
        throw new Error('PIN_ADMISSION_NOT_BOUND');
      return action();
    });
  }
  async pendingPinAdmissions(): Promise<PinAdmissionIntent[]> {
    const intents: PinAdmissionIntent[] = [];
    for (const name of await readdir(join(this.root, 'admissions'))) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const intent = await readRecord<PinAdmissionIntent>(join(this.root, 'admissions', name));
      if (!intent) continue;
      const committed = await this.store.get<LaunchRecord>(intent.commandId);
      if (
        !committed ||
        canonicalJson(this.launchInput(committed)) !== canonicalJson(this.launchInput(intent))
      )
        intents.push(intent);
    }
    return intents;
  }
  private launchInput(record: LaunchInput): LaunchInput {
    return {
      commandId: record.commandId,
      ticketId: record.ticketId,
      processInstanceId: record.processInstanceId,
      source: record.source,
      projection: record.projection,
    };
  }
  async reserve(input: LaunchInput): Promise<LaunchRecord> {
    const canonical = canonicalJson(input);
    if (
      !input.commandId ||
      !input.ticketId ||
      !input.processInstanceId ||
      input.source.sourceTreeSha256 !== input.projection.sourceTreeSha256
    )
      throw new Error('INVALID_LAUNCH');
    return this.store.transaction(async () => {
      const authority = await this.admissionAuthority();
      const old = await this.store.get<LaunchRecord>(input.commandId);
      if (old) {
        const {
          formatVersion: _v,
          launchId: _id,
          reservedAt: _at,
          authorization: _auth,
          lastObservation: _observation,
          lastError: _error,
          ...previous
        } = old;
        if (canonicalJson(previous) !== canonical) throw new Error('LAUNCH_CONFLICT');
        await authority?.verify(JSON.parse(canonical));
        return old;
      }
      const records = await this.store.all<LaunchRecord>();
      if (records.some((record) => record.processInstanceId === input.processInstanceId))
        throw new Error('PROCESS_INSTANCE_CONFLICT');
      if (authority) {
        await authority.verify(JSON.parse(canonical));
        const path = join(this.root, 'admissions', `${hash(input.commandId)}.json`);
        const intent: PinAdmissionIntent = {
          ...JSON.parse(canonical),
          formatVersion: 1,
          registryRoot: authority.registryRoot,
        };
        const existing = await readRecord<PinAdmissionIntent>(path);
        if (existing && canonicalJson(existing) !== canonicalJson(intent))
          throw new Error('PIN_ADMISSION_CONFLICT');
        if (!existing) await writeExclusiveRecord(path, intent);
      }
      const record: LaunchRecord = {
        ...JSON.parse(canonical),
        formatVersion: 1,
        launchId: randomUUID(),
        reservedAt: new Date().toISOString(),
        authorization: null,
        lastObservation: 'unknown',
        lastError: 'EXIT_UNPROVEN',
      };
      await this.store.put(input.commandId, record);
      return record;
    });
  }
  async exact(record: LaunchRecord): Promise<LaunchRecord> {
    const stored = await this.store.get<LaunchRecord>(record.commandId);
    if (
      !stored ||
      stored.launchId !== record.launchId ||
      stored.processInstanceId !== record.processInstanceId
    )
      throw new Error('UNKNOWN_LAUNCH');
    const immutable = (r: LaunchRecord) => ({
      commandId: r.commandId,
      ticketId: r.ticketId,
      processInstanceId: r.processInstanceId,
      source: r.source,
      projection: r.projection,
    });
    if (canonicalJson(immutable(record)) !== canonicalJson(immutable(stored)))
      throw new Error('LAUNCH_CONFLICT');
    return stored;
  }
  proofPath(record: LaunchRecord, kind: 'ready' | 'stopped' | 'spawn' | 'tree'): string {
    return join(this.root, 'proofs', `${hash(record.launchId)}-${kind}.json`);
  }
  async ready(record: LaunchRecord): Promise<ReadyRecord | null> {
    await this.exact(record);
    const ready = await readRecord<ReadyRecord>(this.proofPath(record, 'ready'));
    if (ready && (ready.launchId !== record.launchId || ready.processInstanceId !== record.processInstanceId))
      throw new Error('READY_CONFLICT');
    return ready;
  }
  async observe(record: LaunchRecord): Promise<'running' | 'stopped' | 'unknown'> {
    await this.exact(record);
    const ready = await this.ready(record);
    if (!ready) return this.observation(record, 'unknown', 'READY_UNPROVEN');
    const stop = await readRecord<StopRecord>(this.proofPath(record, 'stopped'));
    if (
      stop &&
      stop.launchId === ready.launchId &&
      stop.startIdentity === ready.startIdentity &&
      stop.processGroupId === ready.processGroupId &&
      stop.groupEmpty === true
    )
      return this.observation(record, 'stopped', null);
    const tree = await readRecord<ReadyRecord & { forkObserved: boolean }>(this.proofPath(record, 'tree'));
    if (tree?.forkObserved) return this.observation(record, 'unknown', 'PROCESS_TREE_UNKNOWN');
    const p = await this.identity.probe(ready.pid);
    if (
      !p ||
      p.uid !== process.getuid?.() ||
      p.processGroupId !== ready.pid ||
      makeStartIdentity(record.launchId, p) !== ready.startIdentity
    )
      return this.observation(record, 'unknown', 'PROCESS_IDENTITY_UNPROVEN');
    return this.observation(record, 'running', null);
  }
  private async observation(
    record: LaunchRecord,
    value: 'running' | 'stopped' | 'unknown',
    error: string | null,
  ): Promise<'running' | 'stopped' | 'unknown'> {
    await this.store.transaction(async () => {
      const stored = await this.exact(record);
      if (stored.lastObservation !== value || stored.lastError !== error) {
        stored.lastObservation = value;
        stored.lastError = error;
        await this.store.put(record.commandId, stored);
      }
    });
    return value;
  }
  async authorize(record: LaunchRecord, pin: AttemptProjectionPin): Promise<void> {
    await this.store.transaction(async () => {
      const stored = await this.exact(record);
      if (
        pin.processInstanceId !== stored.processInstanceId ||
        pin.sourceTreeSha256 !== stored.source.sourceTreeSha256 ||
        pin.runtime !== stored.projection.runtime ||
        pin.projectionManifestSha256 !== stored.projection.manifestSha256 ||
        pin.projectionTreeSha256 !== stored.projection.treeSha256 ||
        !pin.installReportId ||
        !pin.attemptId ||
        !/^\d+$/.test(pin.fence)
      )
        throw new Error('PROJECTION_CONFLICT');
      if (stored.authorization && canonicalJson(stored.authorization) !== canonicalJson(pin))
        throw new Error('AUTHORIZATION_CONFLICT');
      stored.authorization = pin;
      await this.store.put(record.commandId, stored);
    });
  }
  async markStopped(record: LaunchRecord): Promise<void> {
    if ((await this.observe(record)) !== 'stopped') throw new Error('EXACT_EXIT_PROOF_REQUIRED');
  }
  async processes(): Promise<LaunchRecord[]> {
    return this.store.all<LaunchRecord>();
  }
  async byInstance(processInstanceId: string): Promise<LaunchRecord | null> {
    return (await this.processes()).find((record) => record.processInstanceId === processInstanceId) ?? null;
  }
  close(): Promise<void> {
    return this.store.close();
  }
}
export type LauncherOptions = {
  command?: string[];
  verifyProjection?: (
    record: LaunchRecord,
    fence: string,
    attemptId: string,
  ) => Promise<AttemptProjectionPin>;
  recheckCapacity?: () => Promise<boolean>;
  onDurableStage?: (
    stage: 'before_spawn_commit' | 'spawned' | 'ready' | 'authorized' | 'released',
    record: LaunchRecord,
  ) => Promise<void>;
};
type ChildEntry = { child: ChildProcess; done: Promise<void>; ready: ReadyRecord | null; released: boolean };
export class Launcher {
  private readonly journal: ProcessJournal;
  private readonly options: LauncherOptions;
  private readonly children = new Map<string, ChildEntry>();
  constructor(journal: ProcessJournal, options: LauncherOptions = {}) {
    this.journal = journal;
    this.options = options;
  }
  async spawnGated(
    record: LaunchRecord,
  ): Promise<{ pid: number; startIdentity: string; processGroupId: number }> {
    await this.journal.exact(record);
    if (this.children.has(record.launchId)) {
      const ready = await this.journal.ready(record);
      if (ready) return ready;
      throw new Error('LAUNCH_PENDING');
    }
    const intentPath = this.journal.proofPath(record, 'spawn');
    if (await readRecord(intentPath)) throw new Error('SPAWN_ALREADY_RESERVED_RECONCILE_REQUIRED');
    await this.options.onDurableStage?.('before_spawn_commit', record);
    try {
      await writeExclusiveRecord(intentPath, {
        formatVersion: 1,
        launchId: record.launchId,
        processInstanceId: record.processInstanceId,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('SPAWN_ALREADY_RESERVED_RECONCILE_REQUIRED');
      throw error;
    }
    const child = fork(
      new URL(import.meta.url.endsWith('.js') ? './gated-helper.js' : './gated-helper.ts', import.meta.url),
      [],
      { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
    );
    const entry: ChildEntry = { child, ready: null, released: false, done: Promise.resolve() };
    this.children.set(record.launchId, entry);
    entry.done = new Promise<void>((resolve) => {
      child.once('exit', async (code, signal) => {
        try {
          const ready = entry.ready ?? (await this.journal.ready(record));
          const tree = await readRecord<ReadyRecord & { treeEmpty: boolean; forkObserved: boolean }>(
            this.journal.proofPath(record, 'tree'),
          );
          if (
            ready &&
            tree &&
            tree.launchId === ready.launchId &&
            tree.startIdentity === ready.startIdentity &&
            tree.treeEmpty === true &&
            tree.forkObserved === false &&
            child.pid === ready.pid &&
            (await this.journal.identity.groupEmpty(ready.processGroupId))
          ) {
            await atomicWrite(this.journal.proofPath(record, 'stopped'), {
              ...ready,
              formatVersion: 1,
              waitedAt: new Date().toISOString(),
              exitCode: code,
              signal,
              groupEmpty: true,
            });
          }
        } catch {
          await this.observationFailure(record);
        } finally {
          resolve();
        }
      });
      child.once('error', () => resolve());
    });
    const ready = await new Promise<ReadyRecord>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('READY_TIMEOUT')), 4000);
      const onExit = () => finish(new Error('EXIT_BEFORE_READY'));
      const onMessage = async (message: unknown) => {
        if ((message as { type: string }).type !== 'READY') return;
        try {
          const ready = await this.journal.ready(record);
          if (!ready || ready.pid !== child.pid || (await this.journal.observe(record)) !== 'running')
            return finish(new Error('READY_IDENTITY_UNKNOWN'));
          entry.ready = ready;
          finish(null, ready);
        } catch (error) {
          finish(error as Error);
        }
      };
      const finish = (error: Error | null, value?: ReadyRecord) => {
        clearTimeout(timer);
        child.off('exit', onExit);
        child.off('message', onMessage);
        child.off('error', onError);
        if (error) reject(error);
        else if (value) resolve(value);
        else reject(new Error('INVALID_READY'));
      };
      const onError = (error: Error) => finish(error);
      child.once('exit', onExit);
      child.on('message', onMessage);
      child.once('error', onError);
      void (async () => {
        await this.options.onDurableStage?.('spawned', record);
        child.send({ type: 'INIT', root: this.journal.root, record, command: this.options.command ?? null });
      })().catch(onError);
    });
    await this.options.onDurableStage?.('ready', record);
    return { pid: ready.pid, startIdentity: ready.startIdentity, processGroupId: ready.processGroupId };
  }
  async release(record: LaunchRecord, fence: string, attemptId: string): Promise<void> {
    const entry = this.children.get(record.launchId);
    if (!entry?.ready || !entry.child.connected) throw new Error('RECONCILE_REQUIRED');
    if (!this.options.command || !this.options.verifyProjection || !this.options.recheckCapacity)
      throw new Error('RELEASE_NOT_CONFIGURED');
    const pin = await this.options.verifyProjection(record, fence, attemptId);
    if (pin.fence !== fence || pin.attemptId !== attemptId) throw new Error('PROJECTION_CONFLICT');
    if ((await this.journal.observe(record)) !== 'running') throw new Error('PROCESS_UNKNOWN');
    if (!(await this.options.recheckCapacity())) throw new Error('CAPACITY_BLOCKED');
    await this.journal.authorize(record, pin);
    await this.options.onDurableStage?.('authorized', record);
    if (entry.released) return;
    await new Promise<void>((resolve, reject) =>
      entry.child.send({ type: 'RELEASE', launchId: record.launchId }, (error: Error | null) =>
        error ? reject(error) : resolve(),
      ),
    );
    entry.released = true;
    await this.options.onDurableStage?.('released', record);
  }
  private async observationFailure(record: LaunchRecord): Promise<void> {
    try {
      await this.journal.observe(record);
    } catch {
      /* Fail closed; durable records remain for recovery. */
    }
  }
  async wait(record: LaunchRecord): Promise<void> {
    const entry = this.children.get(record.launchId);
    if (!entry) throw new Error('NO_WAIT_HANDLE');
    await entry.done;
  }
  async close(): Promise<void> {
    const gated = [...this.children.values()].filter((entry) => !entry.released);
    for (const entry of this.children.values()) {
      if (entry.child.connected) entry.child.disconnect();
      if (entry.released) entry.child.unref();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(gated.map((entry) => entry.done)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1500);
      }),
    ]);
    if (timer) clearTimeout(timer);
  }
}
