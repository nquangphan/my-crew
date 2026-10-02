import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createConnection, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { loadAttachmentConfig } from '../../src/attachments/config.ts';
import type {
  ReceiverRegistration,
  ServerWriterIdentity,
  WriterStopProof,
} from '../../src/attachments/contracts.ts';
import {
  createReceiverRegistry,
  type ManagedReceiverRegistry,
  readLocalWriterIdentity,
} from '../../src/attachments/receivers.ts';
import { createStageServices } from '../../src/attachments/staging.ts';
import {
  createFileBlobStore,
  prepareOwnedUpload,
  readPrivateJson,
  type StorageFault,
  writePrivateJson,
} from '../../src/attachments/storage.ts';
import { connectDb } from '../../src/db/client.ts';
import { captureMigrations, migrate } from '../../src/db/migrate.ts';
import { canonicalJson } from '../../src/journal/canonical.ts';
import { mutate } from '../../src/journal/mutation.ts';
import type { Db, Tx } from '../../src/platform/contracts.ts';
import { owner, ticketFixture } from './tickets.ts';
export const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function* bufferBody(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

// This port proves the DB/storage terminal protocol on macOS; it deliberately has
// no native process-gone proof and does not certify the production Linux writer.
function fixtureReceiverRegistry(input: { db: Db; root: string; now: () => Date }) {
  const identity: ServerWriterIdentity = {
    instanceId: randomUUID(),
    storageHostId: randomUUID(),
    linuxBootId: 'fixture-only',
    procNamespaceInode: 'fixture-only',
    pid: process.pid,
    startTicks: 'fixture-only',
  };
  const operations = new Map<
    string,
    { registration: ReceiverRegistration; terminal: boolean; active: boolean; abort: AbortController }
  >();
  const proofs = new Map<string, WriterStopProof>();
  const registry: ManagedReceiverRegistry = {
    control: {
      async run(id, signal, work) {
        const op = operations.get(id);
        if (!op || op.active || op.terminal) throw new Error('FIXTURE_OPERATION_INVALID');
        op.active = true;
        await input.db`update attachment_receivers set state='writing' where id=${id} and abort_requested=false`;
        try {
          return await work(AbortSignal.any([signal, op.abort.signal]));
        } finally {
          op.active = false;
          op.terminal = true;
        }
      },
    },
    async register(tx, attachmentId, generation) {
      const [upload] = await tx`select ownership_nonce from attachment_uploads where id=${attachmentId}`;
      await prepareOwnedUpload(input.root, attachmentId, String(upload?.ownership_nonce));
      await tx`insert into attachment_server_writers(instance_id,storage_host_id,linux_boot_id,proc_namespace_inode,pid,start_ticks) values(${identity.instanceId},${identity.storageHostId},${identity.linuxBootId},${identity.procNamespaceInode},${identity.pid},${identity.startTicks}) on conflict(instance_id) do nothing`;
      const id = randomUUID(),
        operationNonce = randomUUID();
      const stageKey = `uploads/${attachmentId}/stage.${generation}.${id}`;
      const registration: ReceiverRegistration = {
        id,
        attachmentId,
        generation,
        identity,
        stageKey,
        operationNonce,
        state: 'registered',
        abortRequested: false,
      };
      await writePrivateJson(
        input.root,
        join(input.root, 'uploads', attachmentId, `.operation.${id}.json`),
        registration,
      );
      await tx`insert into attachment_receivers(id,attachment_id,generation,instance_id,stage_key,operation_nonce,state) values(${id},${attachmentId},${generation},${identity.instanceId},${stageKey},${operationNonce},'registered')`;
      operations.set(id, { registration, active: false, terminal: false, abort: new AbortController() });
      return registration;
    },
    async requestAbort(tx, id) {
      await tx`update attachment_receivers set abort_requested=true where id=${id}`;
      operations.get(id)?.abort.abort(new Error('FIXTURE_ABORT'));
    },
    async closeAndAcknowledge(id) {
      const existingProof = proofs.get(id);
      if (existingProof) return existingProof;
      const op = operations.get(id);
      if (!op?.terminal || op.active) throw new Error('FIXTURE_WRITER_STILL_ACTIVE');
      const data = {
        receiverId: id,
        generation: op.registration.generation,
        operationNonce: op.registration.operationNonce,
        identity,
      };
      const proof: WriterStopProof = {
        receiverId: id,
        generation: op.registration.generation,
        kind: 'closed-ack',
        identity,
        proofSha256: sha(Buffer.from(canonicalJson(data))),
        observedAt: input.now().toISOString(),
      };
      await writePrivateJson(
        input.root,
        join(input.root, 'uploads', op.registration.attachmentId, `.closed.${id}.json`),
        data,
      );
      await input.db`update attachment_receivers set state='closed',closed_ack_sha256=${proof.proofSha256},closed_at=${input.now()},stop_proof=${input.db.json(JSON.parse(canonicalJson(proof)))} where id=${id}`;
      proofs.set(id, proof);
      return proof;
    },
    async proveStopped(id) {
      return proofs.get(id) ?? null;
    },
  };
  return { registry, active: () => [...operations.values()].some((op) => op.active) };
}
export async function attachmentFixture(
  db: Db,
  options: {
    env?: Record<string, string>;
    fault?: StorageFault;
    storeFault?: StorageFault;
    nativeReceiver?: boolean;
  } = {},
) {
  const ticket = await ticketFixture(db);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-v2-attachments-')));
  const rootIdentity = await lstat(root);
  const nonce = randomUUID();
  await writePrivateJson(root, join(root, '.fixture-owner.json'), { nonce });
  console.info(
    `attachment DB container ${process.env.CREW_V2_TEST_CONTAINER_ID ?? 'native-worker'} root ${root}`,
  );
  console.info(`attachment DB scratch created ${root} nonceSha256=${sha(Buffer.from(nonce))}`);
  let current = Date.now();
  const clock = {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
  const config = loadAttachmentConfig({ ...options.env, CREW_V2_ATTACHMENT_STORAGE_ROOT: root });
  const store = await createFileBlobStore({
    root,
    fault: options.storeFault,
    persistIntent: async (intent) => {
      await db.begin(async (tx) => {
        const [upload] =
          await tx`select ownership_nonce from attachment_uploads where id=${intent.attachmentId} for update`;
        if (!upload || (intent.kind === 'upload' && upload.ownership_nonce !== intent.ownershipNonce))
          throw new Error('FIXTURE_INTENT_OWNERSHIP_INVALID');
        await tx`insert into attachment_gc(id,attachment_id,extraction_id,kind,owned_key,ownership_nonce,state,generation,not_before) values(${randomUUID()},${intent.attachmentId},${intent.extractionId},${intent.kind},${intent.stageKey},${intent.ownershipNonce},'candidate',${intent.generation.split('.')[0] ?? '0'},${new Date(clock.now().getTime() + config.cleanupGraceMs)}) on conflict(owned_key) do nothing`;
      });
    },
  });
  const fixtureReceivers = fixtureReceiverRegistry({ db, root, now: clock.now });
  const storageHostId = randomUUID();
  const receivers = options.nativeReceiver
    ? createReceiverRegistry({
        db,
        storageRoot: root,
        storageHostId,
        now: clock.now,
        identity: await readLocalWriterIdentity(storageHostId),
      })
    : fixtureReceivers.registry;
  const stage = createStageServices({ db, store, receivers, now: clock.now, config, fault: options.fault });
  return {
    ...ticket,
    root,
    clock,
    config,
    store,
    stage,
    receivers,
    mutationWith: <T>(key: string, body: unknown, work: (tx: Tx) => Promise<T>) =>
      mutate(db, { actor: owner, route: 'fixture:attachment', key, body }, async (tx) => ({
        status: 200,
        body: await work(tx),
      })).then((result) => result.body),
    async close() {
      if (fixtureReceivers.active()) throw new Error('FIXTURE_RECEIVER_ACTIVE');
      const found = await readPrivateJson(root, join(root, '.fixture-owner.json'));
      const actual = await lstat(root);
      if (
        found.nonce !== nonce ||
        actual.isSymbolicLink() ||
        actual.dev !== rootIdentity.dev ||
        actual.ino !== rootIdentity.ino
      )
        throw new Error('FIXTURE_OWNERSHIP_MISMATCH');
      await rm(root, { recursive: true, force: true });
      console.info(`attachment DB scratch removed ${root}`);
    },
  };
}

const nativeNodeImage =
  'node:24.12.0@sha256:929c026d5a4e4a59685b3c1dbc1a8c3eb090aa95373d3a4fd668daa2493c8331';
const execFileAsync = promisify(execFile);
export async function runLinuxReceiverCase(db: Db): Promise<void> {
  const pgId = process.env.CREW_V2_TEST_CONTAINER_ID;
  if (!pgId || !/^[0-9a-f]{64}$/.test(pgId)) throw new Error('NATIVE_PRIVATE_PG_ID_REQUIRED');
  const [row] = await db`select current_database() as name`;
  const database = String(row.name);
  if (!/^crew_v2_test_[0-9a-f]{32}$/.test(database)) throw new Error('NATIVE_PRIVATE_DATABASE_REQUIRED');
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const name = `crew-v2-attachments-native-${randomUUID()}`;
  let nativeId = '';
  try {
    const result = await execFileAsync('docker', [
      'create',
      '--name',
      name,
      '--label',
      'crew.phase05.task1=native-db',
      '--network',
      `container:${pgId}`,
      '--read-only',
      '--cap-drop',
      'ALL',
      '--memory',
      '256m',
      '--cpus',
      '1',
      '--pids-limit',
      '32',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '-v',
      `${repo}:/workspace:ro`,
      '-w',
      '/workspace',
      nativeNodeImage,
      'node',
      'v2/server/test/support/attachments.ts',
      '--native-attachment-probe',
      database,
    ]);
    nativeId = result.stdout.trim();
    if (!/^[0-9a-f]{64}$/.test(nativeId)) throw new Error('NATIVE_CONTAINER_ID_INVALID');
    console.info(`attachment native container created ${nativeId} pg=${pgId} database=${database}`);
    const run = await execFileAsync('docker', ['start', '-a', nativeId], { maxBuffer: 1024 * 1024 });
    console.info(run.stdout.trim());
    const inspection = await execFileAsync('docker', [
      'inspect',
      '--format',
      '{{.State.ExitCode}}',
      nativeId,
    ]);
    assert.equal(inspection.stdout.trim(), '0');
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string };
    if (result.stdout) console.info(result.stdout);
    if (result.stderr) console.info(result.stderr);
    throw error;
  } finally {
    if (nativeId) {
      await execFileAsync('docker', ['rm', '-f', nativeId]);
      console.info(`attachment native container removed ${nativeId}`);
    }
  }
}
export async function verifyAttachmentMigrationRestore(db: Db): Promise<void> {
  const containerId = process.env.CREW_V2_TEST_CONTAINER_ID;
  const baseUrl = process.env.CREW_V2_TEST_DATABASE_URL;
  assert.ok(containerId && /^[0-9a-f]{64}$/.test(containerId));
  assert.ok(baseUrl);
  const set = await captureMigrations(9);
  assert.equal(set.files[7]?.sha256, 'd268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f');
  assert.equal(set.files[8]?.sha256, 'fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a');
  const seed = await ticketFixture(db);
  const [source] = await db`select current_database() as name`;
  const sourceName = String(source.name);
  assert.match(sourceName, /^crew_v2_test_[0-9a-f]{32}$/);
  const admin = postgres(baseUrl, { max: 1 });
  const restore = async (prefix: number, verify: (restored: Db) => Promise<void>) => {
    const dump = spawnSync('docker', ['exec', containerId, 'pg_dump', '-Fc', '-U', 'postgres', sourceName], {
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(dump.status, 0, dump.stderr.toString());
    const name = `crew_v2_test_${randomUUID().replaceAll('-', '')}`;
    let created = false;
    try {
      await admin`create database ${admin(name)}`;
      created = true;
      console.info(`attachment restore created container=${containerId} database=${name} prefix=${prefix}`);
      const result = spawnSync(
        'docker',
        ['exec', '-i', containerId, 'pg_restore', '-U', 'postgres', '-d', name],
        { input: dump.stdout, maxBuffer: 4 * 1024 * 1024 },
      );
      assert.equal(result.status, 0, result.stderr.toString());
      const url = new URL(baseUrl);
      url.pathname = `/${name}`;
      const restored = connectDb(url.toString());
      try {
        await verify(restored);
      } finally {
        await restored.end();
      }
    } finally {
      if (created) {
        await admin`drop database ${admin(name)} with (force)`;
        console.info(`attachment restore removed container=${containerId} database=${name}`);
      }
    }
  };
  const verify = async (restored: Db) => {
    const [marker] = await restored`select system_name from system_identity`;
    assert.equal(marker.system_name, 'crew-v2');
    const tickets = await restored`select id from tickets where id=${seed.request.id}`;
    assert.equal(tickets.length, 1);
    await migrate(restored, set);
    await migrate(restored, set);
    const rows = await restored`select version,checksum from schema_migrations order by version`;
    assert.deepEqual(
      rows.map((row) => ({ version: Number(row.version), checksum: row.checksum })),
      set.files.map((file) => ({ version: file.version, checksum: file.sha256 })),
    );
    const [tables] =
      await restored`select to_regclass('attachment_uploads') as uploads,to_regclass('attachment_input_snapshots') as snapshots,to_regclass('attachment_assistant_grants') as grants`;
    assert.equal(tables.uploads, 'attachment_uploads');
    assert.equal(tables.snapshots, 'attachment_input_snapshots');
    assert.equal(tables.grants, 'attachment_assistant_grants');
    const drift = {
      ...set,
      files: set.files.map((file) => {
        if (file.version !== 9) return file;
        const sql = `${file.sql}\n-- deliberate test-owned drift`;
        return { ...file, sql, sha256: sha(Buffer.from(sql)) };
      }),
    };
    await assert.rejects(migrate(restored, drift), /MIGRATION_DRIFT/);
    const [checksum] = await restored`select checksum from schema_migrations where version=9`;
    assert.equal(checksum.checksum, set.files[8]?.sha256);
  };
  try {
    await restore(8, verify);
    await migrate(db, set);
    const f = await attachmentFixture(db);
    try {
      const compose = await f.mutation('restore-compose', (tx) =>
        f.stage.createCompose(tx, { projectId: f.project.id, ticketId: null, purpose: 'ticket' }, owner),
      );
      const bytes = Buffer.from('preserved');
      const reserved = await f.mutation('restore-reserve', (tx) =>
        f.stage.reserve(
          tx,
          {
            composeSessionId: compose.id,
            expectedRevision: 1,
            fileName: 'restore.txt',
            declaredMime: 'text/plain',
            byteLength: bytes.length,
            sha256: sha(bytes),
          },
          owner,
        ),
      );
      await restore(9, async (restored) => {
        await verify(restored);
        const [upload] =
          await restored`select id,expected_bytes,expected_sha256,storage_key from attachment_uploads where id=${reserved.attachment.attachmentId}`;
        assert.equal(upload.id, reserved.attachment.attachmentId);
        assert.equal(Number(upload.expected_bytes), bytes.length);
        assert.equal(upload.expected_sha256, sha(bytes));
        assert.equal(upload.storage_key, `uploads/${reserved.attachment.attachmentId}/original`);
      });
    } finally {
      await f.close();
    }
  } finally {
    await admin.end();
  }
}
async function nativeReceiverExercise(database: string): Promise<void> {
  if (process.platform !== 'linux' || !/^crew_v2_test_[0-9a-f]{32}$/.test(database))
    throw new Error('NATIVE_TEST_SCOPE_INVALID');
  const sockets = new Set<Socket>();
  const proxy = createServer((inbound) => {
    const outbound = createConnection({ host: '127.0.0.1', port: 5432 });
    sockets.add(inbound);
    sockets.add(outbound);
    inbound.pipe(outbound);
    outbound.pipe(inbound);
    const close = () => {
      inbound.destroy();
      outbound.destroy();
      sockets.delete(inbound);
      sockets.delete(outbound);
    };
    inbound.on('error', close);
    outbound.on('error', close);
    inbound.on('close', close);
    outbound.on('close', close);
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });
  const address = proxy.address();
  assert.ok(address && typeof address !== 'string');
  assert.ok(![5432, 55432].includes(address.port));
  const { connectDb } = await import('../../src/db/client.ts');
  const db = connectDb(`postgres://postgres@127.0.0.1:${address.port}/${database}`);
  let f: Awaited<ReturnType<typeof attachmentFixture>> | undefined;
  let release: () => void = () => {};
  let task: Promise<unknown> | undefined;
  try {
    const fixture = await attachmentFixture(db, {
      nativeReceiver: true,
      env: {
        CREW_V2_ATTACHMENT_UPLOAD_HEARTBEAT_MS: '10',
        CREW_V2_ATTACHMENT_UPLOAD_LEASE_MS: '1000',
        CREW_V2_ATTACHMENT_UPLOAD_MAX_WALL_MS: '3000',
      },
    });
    f = fixture;
    const bytes = Buffer.from('ab');
    const compose = await f.mutation(randomUUID(), (tx) =>
      fixture.stage.createCompose(
        tx,
        { projectId: fixture.project.id, ticketId: null, purpose: 'ticket' },
        owner,
      ),
    );
    const reserved = await f.mutation(randomUUID(), (tx) =>
      fixture.stage.reserve(
        tx,
        {
          composeSessionId: compose.id,
          expectedRevision: 1,
          fileName: 'note.txt',
          declaredMime: 'text/plain',
          byteLength: 2,
          sha256: sha(bytes),
        },
        owner,
      ),
    );
    const id = reserved.attachment.attachmentId;
    let entered: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* chunks() {
      yield bytes.subarray(0, 1);
      entered();
      await barrier;
      yield bytes.subarray(1);
    }
    task = f.stage.receive(id, owner, chunks(), new AbortController().signal);
    await waiting;
    const [receiving] =
      await db`select receiver_id,generation,receive_lease_until from attachment_uploads where id=${id}`;
    const receiverId = String(receiving.receiver_id);
    await assert.rejects(f.receivers.closeAndAcknowledge(receiverId), /STILL_ACTIVE/);
    assert.equal(await f.receivers.proveStopped(receiverId), null);
    f.clock.advance(300);
    let renewed = false;
    for (let i = 0; i < 100; i++) {
      const [live] = await db`select receive_lease_until from attachment_uploads where id=${id}`;
      if ((live.receive_lease_until as Date).getTime() > (receiving.receive_lease_until as Date).getTime()) {
        renewed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(renewed, true);
    release();
    const ready = (await task) as { state: string };
    assert.equal(ready.state, 'ready');
    const proof = await f.receivers.proveStopped(receiverId);
    assert.ok(proof);
    assert.equal(proof.kind, 'closed-ack');
    assert.equal(proof.generation, String(receiving.generation));
    assert.equal(proof.identity.pid, process.pid);
    const [writer] =
      await db`select start_ticks,linux_boot_id,proc_namespace_inode from attachment_server_writers where instance_id=${proof.identity.instanceId}`;
    assert.equal(proof.identity.startTicks, String(writer.start_ticks));
    assert.equal(proof.identity.linuxBootId, writer.linux_boot_id);
    assert.equal(proof.identity.procNamespaceInode, writer.proc_namespace_inode);
    // Breaks if terminal map release makes immutable close ACK impossible to replay.
    const replay = await f.receivers.closeAndAcknowledge(receiverId);
    assert.equal(replay.proofSha256, proof.proofSha256);
    console.info(
      `attachment native exact ACK verified receiver=${receiverId} generation=${proof.generation} instance=${proof.identity.instanceId}`,
    );
    const cancelledCompose = await f.mutation(randomUUID(), (tx) =>
      fixture.stage.createCompose(
        tx,
        { projectId: fixture.project.id, ticketId: null, purpose: 'ticket' },
        owner,
      ),
    );
    const cancelled = await f.mutation(randomUUID(), (tx) =>
      fixture.stage.reserve(
        tx,
        {
          composeSessionId: cancelledCompose.id,
          expectedRevision: 1,
          fileName: 'abort.txt',
          declaredMime: 'text/plain',
          byteLength: 2,
          sha256: sha(bytes),
        },
        owner,
      ),
    );
    let enteredAbort: () => void = () => {};
    const startedAbort = new Promise<void>((resolve) => {
      enteredAbort = resolve;
    });
    const abortBarrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* abortChunks() {
      yield bytes.subarray(0, 1);
      enteredAbort();
      await abortBarrier;
      yield bytes.subarray(1);
    }
    const abortedId = cancelled.attachment.attachmentId;
    task = f.stage.receive(abortedId, owner, abortChunks(), new AbortController().signal);
    const aborted = assert.rejects(task);
    await startedAbort;
    const [active] =
      await db`select receiver_id,generation,receive_lease_until from attachment_uploads where id=${abortedId}`;
    f.clock.advance(2000);
    await assert.rejects(f.stage.receive(abortedId, owner, bufferBody(bytes), new AbortController().signal), {
      code: 'ATTACHMENT_UPLOAD_BUSY',
    });
    const [unchanged] = await db`select generation,receiver_id from attachment_uploads where id=${abortedId}`;
    assert.equal(String(unchanged.generation), String(active.generation));
    assert.equal(unchanged.receiver_id, active.receiver_id);
    await f.mutation(randomUUID(), (tx) =>
      fixture.stage.abandonUpload(
        tx,
        { composeSessionId: cancelledCompose.id, attachmentId: abortedId, expectedRevision: 2 },
        owner,
      ),
    );
    await assert.rejects(f.receivers.closeAndAcknowledge(String(active.receiver_id)), /STILL_ACTIVE/);
    assert.equal(await f.receivers.proveStopped(String(active.receiver_id)), null);
    release();
    await aborted;
    const [terminal] =
      await db`select u.state,u.quota_released_at,u.storage_key,r.state as receiver_state from attachment_uploads u join attachment_receivers r on r.id=u.receiver_id where u.id=${abortedId}`;
    assert.equal(terminal.state, 'abandoned');
    assert.equal(terminal.receiver_state, 'closed');
    assert.equal(terminal.quota_released_at, null);
    assert.equal(
      await f.store.verify({
        key: String(terminal.storage_key),
        sha256: sha(bytes),
        byteLength: bytes.length,
      }),
      'missing',
    );
    const stopped = await f.receivers.proveStopped(String(active.receiver_id));
    assert.ok(stopped);
    assert.equal(stopped.kind, 'closed-ack');
    console.info(
      `attachment native abort terminal verified receiver=${active.receiver_id} generation=${stopped.generation} quota=held`,
    );
  } finally {
    release();
    if (task) await task.catch(() => {});
    if (f) await f.close();
    await db.end();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
}
if (process.argv[2] === '--native-attachment-probe') await nativeReceiverExercise(process.argv[3] ?? '');
