import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readlink, unlink } from 'node:fs/promises';
import { createConnection, createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { canonicalJson } from '../journal/canonical.ts';
import type { Db, Id, Tx } from '../platform/contracts.ts';
import type {
  ReceiverRegistration,
  ReceiverRegistry,
  ServerWriterIdentity,
  WriterStopProof,
} from './contracts.ts';
import {
  noSymlinkComponents,
  prepareOwnedUpload,
  readPrivateJson,
  syncDirectory,
  writePrivateJson,
} from './storage.ts';

export type ReceiverOperationControl = {
  run<T>(receiverId: Id, signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
};
export type ManagedReceiverRegistry = ReceiverRegistry & { control: ReceiverOperationControl };
export function parseLinuxStartTicks(stat: string): string {
  const close = stat.lastIndexOf(')');
  if (close < 0 || !/^\d+ \(/.test(stat)) throw new Error('PROC_STAT_INVALID');
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const ticks = fields[19];
  if (!ticks || !/^\d+$/.test(ticks)) throw new Error('PROC_STAT_INVALID');
  return ticks;
}
export async function readLocalWriterIdentity(
  storageHostId: Id,
  instanceId: Id = randomUUID(),
): Promise<ServerWriterIdentity> {
  if (process.platform !== 'linux') throw new Error('LINUX_WRITER_REQUIRED');
  const [boot, namespace, stat] = await Promise.all([
    readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
    readlink('/proc/self/ns/pid'),
    readFile('/proc/self/stat', 'utf8'),
  ]);
  const inode = /^pid:\[(\d+)\]$/.exec(namespace)?.[1];
  if (!inode) throw new Error('PROC_NAMESPACE_INVALID');
  return Object.freeze({
    instanceId,
    storageHostId,
    linuxBootId: boot.trim(),
    procNamespaceInode: inode,
    pid: process.pid,
    startTicks: parseLinuxStartTicks(stat),
  });
}
export async function observeWriterStopped(
  writer: ServerWriterIdentity,
  current: ServerWriterIdentity,
): Promise<boolean> {
  // An absence is only meaningful after verifying the observer's exact host/boot/namespace.
  if (
    !Number.isSafeInteger(writer.pid) ||
    writer.pid <= 0 ||
    !/^[0-9]+$/.test(writer.startTicks) ||
    !/^[0-9]+$/.test(writer.procNamespaceInode) ||
    !/^[0-9a-f-]{36}$/.test(writer.linuxBootId)
  )
    return false;
  if (
    process.platform !== 'linux' ||
    writer.storageHostId !== current.storageHostId ||
    writer.linuxBootId !== current.linuxBootId ||
    writer.procNamespaceInode !== current.procNamespaceInode
  )
    return false;
  try {
    const stat = await readFile(`/proc/${writer.pid}/stat`, 'utf8');
    return parseLinuxStartTicks(stat) !== writer.startTicks;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}
export function createReceiverRegistry(input: {
  db: Db;
  storageRoot: string;
  storageHostId: Id;
  now: () => Date;
  identity: ServerWriterIdentity;
}): ManagedReceiverRegistry {
  if (input.identity.storageHostId !== input.storageHostId) throw new Error('RECEIVER_HOST_MISMATCH');
  const identity = Object.freeze({ ...input.identity });
  const operations = new Map<
    Id,
    { registration: ReceiverRegistration; terminal: boolean; active: boolean }
  >();
  async function record(id: Id, tx: Db | Tx): Promise<Record<string, unknown>> {
    const [row] =
      await tx`select r.*,w.storage_host_id,w.linux_boot_id,w.proc_namespace_inode,w.pid,w.start_ticks from attachment_receivers r join attachment_server_writers w on w.instance_id=r.instance_id where r.id=${id}`;
    if (!row) throw new Error('RECEIVER_NOT_FOUND');
    return row;
  }
  function storedIdentity(row: Record<string, unknown>): ServerWriterIdentity {
    return {
      instanceId: String(row.instance_id),
      storageHostId: String(row.storage_host_id),
      linuxBootId: String(row.linux_boot_id),
      procNamespaceInode: String(row.proc_namespace_inode),
      pid: Number(row.pid),
      startTicks: String(row.start_ticks),
    };
  }
  function socketPath(id: Id): string {
    return join(input.storageRoot, 'control', `${id}.sock`);
  }
  async function notifyAbort(row: Record<string, unknown>): Promise<void> {
    const path = socketPath(String(row.id));
    await noSymlinkComponents(input.storageRoot, path);
    if (!(await lstat(path)).isSocket()) throw new Error('RECEIVER_SOCKET_INVALID');
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(path);
      socket.setTimeout(1000);
      socket.once('connect', () =>
        socket.end(canonicalJson({ action: 'abort', nonce: row.operation_nonce })),
      );
      socket.once('timeout', () => socket.destroy(new Error('RECEIVER_ABORT_UNKNOWN')));
      socket.once('error', reject);
      socket.once('close', () => resolve());
    });
  }
  async function removeSocket(path: string): Promise<void> {
    try {
      await unlink(path);
      await syncDirectory(join(input.storageRoot, 'control'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const registry: ManagedReceiverRegistry = {
    control: {
      async run(receiverId, signal, work) {
        const operation = operations.get(receiverId);
        if (!operation || operation.active || operation.terminal)
          throw new Error('RECEIVER_OPERATION_INVALID');
        const row = await record(receiverId, input.db);
        if (row.abort_requested || row.state !== 'registered') throw new Error('RECEIVER_ABORTED');
        operation.active = true;
        const abort = new AbortController();
        const combined = AbortSignal.any([signal, abort.signal]);
        const path = socketPath(receiverId);
        let server: Server | undefined;
        let ownsSocket = false;
        try {
          const controlDir = join(input.storageRoot, 'control');
          try {
            await mkdir(controlDir, { mode: 0o700 });
            await syncDirectory(input.storageRoot);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
          }
          await noSymlinkComponents(input.storageRoot, controlDir);
          server = createServer((socket) => {
            let data = '';
            socket.setTimeout(1000, () => socket.destroy());
            socket.on('error', () => {});
            socket.on('data', (chunk) => {
              data += chunk.toString();
              if (data.length > 512) socket.destroy();
            });
            socket.on('end', () => {
              try {
                const request = JSON.parse(data) as { action: string; nonce: string };
                if (request.action === 'abort' && request.nonce === operation.registration.operationNonce)
                  abort.abort(new Error('RECEIVER_ABORTED'));
              } catch {
                /* malformed private message cannot control operation */
              }
              socket.destroy();
            });
          });
          const listener = server;
          await new Promise<void>((resolve, reject) => {
            listener.once('error', reject);
            listener.listen(path, resolve);
          });
          ownsSocket = true;
          await chmod(path, 0o600);
          await syncDirectory(controlDir);
          await input.db`update attachment_receivers set state='writing' where id=${receiverId} and state='registered' and abort_requested=false`;
          const [current] =
            await input.db`select state,abort_requested from attachment_receivers where id=${receiverId}`;
          if (current?.state !== 'writing' || current.abort_requested) throw new Error('RECEIVER_ABORTED');
          return await work(combined);
        } finally {
          // All work (including rejected stream writes) settles before terminal and ACK.
          const listener = server;
          if (listener?.listening)
            await new Promise<void>((resolve, reject) => listener.close((e) => (e ? reject(e) : resolve())));
          if (ownsSocket) await removeSocket(path);
          operation.active = false;
          operation.terminal = true;
        }
      },
    },
    async register(tx, attachmentId, generation) {
      if (!/^[1-9][0-9]*$/.test(generation)) throw new Error('RECEIVER_GENERATION_INVALID');
      const measured = await readLocalWriterIdentity(identity.storageHostId, identity.instanceId);
      if (canonicalJson(measured) !== canonicalJson(identity))
        throw new Error('RECEIVER_IDENTITY_UNVERIFIED');
      await tx`insert into attachment_server_writers(instance_id,storage_host_id,linux_boot_id,proc_namespace_inode,pid,start_ticks) values(${identity.instanceId},${identity.storageHostId},${identity.linuxBootId},${identity.procNamespaceInode},${identity.pid},${identity.startTicks}) on conflict(instance_id) do nothing`;
      const [writer] =
        await tx`select * from attachment_server_writers where instance_id=${identity.instanceId}`;
      if (
        !writer ||
        canonicalJson(storedIdentity({ ...writer, instance_id: writer.instance_id })) !==
          canonicalJson(identity)
      )
        throw new Error('RECEIVER_IDENTITY_CONFLICT');
      const [upload] =
        await tx`select ownership_nonce from attachment_uploads where id=${attachmentId} for update`;
      if (!upload) throw new Error('RECEIVER_UPLOAD_MISSING');
      await prepareOwnedUpload(input.storageRoot, attachmentId, String(upload.ownership_nonce));
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
        input.storageRoot,
        join(input.storageRoot, 'uploads', attachmentId, `.operation.${id}.json`),
        registration,
      );
      await tx`insert into attachment_receivers(id,attachment_id,generation,instance_id,stage_key,operation_nonce,state) values(${id},${attachmentId},${generation},${identity.instanceId},${stageKey},${operationNonce},'registered')`;
      operations.set(id, { registration, terminal: false, active: false });
      return registration;
    },
    async requestAbort(tx, receiverId) {
      const [row] =
        await tx`update attachment_receivers set abort_requested=true where id=${receiverId} and state<>'closed' returning *`;
      if (!row) return;
      // Persisted request remains authoritative; unavailable socket means unknown, never stop proof.
      try {
        await notifyAbort(row);
      } catch {
        /* heartbeat sees durable flag after commit */
      }
    },
    async closeAndAcknowledge(receiverId) {
      const operation = operations.get(receiverId);
      if (!operation) {
        // Terminal map release must not erase a durable exact-operation ACK.
        // Replay consumes the verified immutable proof; it never fabricates closure.
        const replay = await registry.proveStopped(receiverId);
        if (replay?.kind === 'closed-ack') return replay;
        throw new Error('RECEIVER_WRITER_STILL_ACTIVE');
      }
      if (!operation.terminal || operation.active) throw new Error('RECEIVER_WRITER_STILL_ACTIVE');
      const row = await record(receiverId, input.db);
      if (row.instance_id !== identity.instanceId) throw new Error('RECEIVER_NOT_LOCAL');
      const data = {
        receiverId,
        generation: String(row.generation),
        operationNonce: String(row.operation_nonce),
        identity,
      };
      const digest = createHash('sha256').update(canonicalJson(data)).digest('hex');
      const path = join(
        input.storageRoot,
        'uploads',
        String(row.attachment_id),
        `.closed.${receiverId}.json`,
      );
      try {
        await writePrivateJson(input.storageRoot, path, data);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (canonicalJson(await readPrivateJson(input.storageRoot, path)) !== canonicalJson(data))
          throw new Error('RECEIVER_ACK_CONFLICT');
      }
      const proof: WriterStopProof = {
        receiverId,
        generation: String(row.generation),
        kind: 'closed-ack',
        identity,
        proofSha256: digest,
        observedAt: input.now().toISOString(),
      };
      await input.db`update attachment_receivers set state='closed',closed_ack_sha256=${digest},closed_at=${input.now()},stop_proof=${input.db.json(JSON.parse(canonicalJson(proof)))} where id=${receiverId} and instance_id=${identity.instanceId}`;
      operations.delete(receiverId);
      return proof;
    },
    async proveStopped(receiverId) {
      const row = await record(receiverId, input.db);
      const writer = storedIdentity(row);
      const dir = join(input.storageRoot, 'uploads', String(row.attachment_id));
      try {
        const owner = await readPrivateJson(input.storageRoot, join(dir, '.owner.json'));
        const [upload] =
          await input.db`select ownership_nonce from attachment_uploads where id=${row.attachment_id as Id}`;
        const registration = await readPrivateJson(
          input.storageRoot,
          join(dir, `.operation.${receiverId}.json`),
        );
        if (
          !upload ||
          owner.nonce !== upload.ownership_nonce ||
          registration.id !== receiverId ||
          registration.operationNonce !== row.operation_nonce ||
          registration.generation !== String(row.generation) ||
          canonicalJson(registration.identity) !== canonicalJson(writer)
        )
          return null;
        const data = await readPrivateJson(input.storageRoot, join(dir, `.closed.${receiverId}.json`));
        const digest = createHash('sha256').update(canonicalJson(data)).digest('hex');
        if (
          data.receiverId === receiverId &&
          data.generation === String(row.generation) &&
          data.operationNonce === row.operation_nonce &&
          canonicalJson(data.identity) === canonicalJson(writer) &&
          (!row.closed_ack_sha256 || row.closed_ack_sha256 === digest)
        ) {
          const proof: WriterStopProof = {
            receiverId,
            generation: String(row.generation),
            kind: 'closed-ack',
            identity: writer,
            proofSha256: digest,
            observedAt: input.now().toISOString(),
          };
          await input.db`update attachment_receivers set state='closed',closed_ack_sha256=${digest},closed_at=coalesce(closed_at,${input.now()}),stop_proof=${input.db.json(JSON.parse(canonicalJson(proof)))} where id=${receiverId}`;
          return proof;
        }
        return null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      }
      const current = await readLocalWriterIdentity(identity.storageHostId, identity.instanceId);
      if (!(await observeWriterStopped(writer, current))) return null;
      const proof: WriterStopProof = {
        receiverId,
        generation: String(row.generation),
        kind: 'native-process-gone',
        identity: writer,
        proofSha256: createHash('sha256')
          .update(canonicalJson({ receiverId, generation: String(row.generation), writer, current }))
          .digest('hex'),
        observedAt: input.now().toISOString(),
      };
      await input.db`update attachment_receivers set stop_proof=${input.db.json(JSON.parse(canonicalJson(proof)))} where id=${receiverId} and stop_proof is null`;
      return proof;
    },
  };
  return registry;
}
