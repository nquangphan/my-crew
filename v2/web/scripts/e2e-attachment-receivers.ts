/**
 * Upload writer port for the E2E fixture on hosts without the native Linux writer identity (`/proc`).
 * It runs the same DB/storage terminal protocol as the native registry (register, write, closed-ACK) inside
 * the fixture's single Node process, and deliberately has no native process-gone proof (its identity says
 * `fixture-only`). It is reachable only from `e2e-fixture.ts`, which no production entrypoint imports, and
 * `test/attachment-receivers.test.ts` drives its whole protocol against the fixture database.
 */
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  ReceiverRegistration,
  ServerWriterIdentity,
  WriterStopProof,
} from '../../server/src/attachments/contracts.ts';
import type { ManagedReceiverRegistry } from '../../server/src/attachments/receivers.ts';
import { prepareOwnedUpload, writePrivateJson } from '../../server/src/attachments/storage.ts';
import { canonicalJson } from '../../server/src/journal/canonical.ts';
import type { Db } from '../../server/src/platform/contracts.ts';

type Operation = {
  registration: ReceiverRegistration;
  terminal: boolean;
  active: boolean;
  abort: AbortController;
};

export function createFixtureReceivers(input: {
  db: Db;
  root: string;
  storageHostId: string;
  now: () => Date;
}): ManagedReceiverRegistry {
  const identity: ServerWriterIdentity = {
    instanceId: randomUUID(),
    storageHostId: input.storageHostId,
    linuxBootId: 'fixture-only',
    procNamespaceInode: 'fixture-only',
    pid: process.pid,
    startTicks: 'fixture-only',
  };
  const operations = new Map<string, Operation>();
  const proofs = new Map<string, WriterStopProof>();
  return {
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
      if (typeof upload?.ownership_nonce !== 'string') throw new Error('FIXTURE_UPLOAD_NOT_FOUND');
      await prepareOwnedUpload(input.root, attachmentId, upload.ownership_nonce);
      await tx`insert into attachment_server_writers(instance_id,storage_host_id,linux_boot_id,proc_namespace_inode,pid,start_ticks) values(${identity.instanceId},${identity.storageHostId},${identity.linuxBootId},${identity.procNamespaceInode},${identity.pid},${identity.startTicks}) on conflict(instance_id) do nothing`;
      const id = randomUUID();
      const operationNonce = randomUUID();
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
      const existing = proofs.get(id);
      if (existing) return existing;
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
        proofSha256: createHash('sha256')
          .update(Buffer.from(canonicalJson(data)))
          .digest('hex'),
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
}
