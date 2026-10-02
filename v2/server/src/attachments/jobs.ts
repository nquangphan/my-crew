import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, open } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '../journal/canonical.ts';
import type { Db } from '../platform/contracts.ts';
import type { AttachmentConfig } from './config.ts';
import type { BlobStore, Derivative, Extraction } from './contracts.ts';
import { noSymlinkComponents, readPrivateJson, syncDirectory, writePrivateJson } from './storage.ts';
import {
  validateWorkerInput,
  validateWorkerResult,
  type WorkerInput,
  workerError,
} from './worker-protocol.ts';
import { assertWorkerDirectory, type ExtractorRunner, prepareWorkerDirectory } from './worker-runner.ts';
export async function processExtraction(
  _db: Db,
  _id: string,
  _runner: ExtractorRunner,
  _store: BlobStore,
  _now: () => Date,
): Promise<Extraction> {
  throw workerError('EXTRACTION_CONFIG_REQUIRED');
}
type Options = {
  db: Db;
  runner: ExtractorRunner;
  store: BlobStore;
  config: AttachmentConfig;
  now: () => Date;
};
export function createExtractionJobs(options: Options): { process(id: string): Promise<Extraction> } {
  // Capture only trusted operator values. No request roots, ambient env or registry.
  const config: AttachmentConfig = Object.freeze({
    ...options.config,
    limits: Object.freeze({ ...options.config.limits }),
    allowedExtensions: [...options.config.allowedExtensions],
  });
  const { db, runner, store, now } = options;
  if (config.workerConcurrency !== 1) throw workerError('EXTRACTOR_CAPACITY_NOT_AUTHORIZED');
  const identityInput = validateWorkerInput({
    version: 1,
    jobId: randomUUID(),
    generation: '1',
    original: { attachmentId: randomUUID(), sha256: '0'.repeat(64), ownerId: 'owner' },
    mime: 'text/plain',
    inputName: 'original',
    extractorVersion: 'validation',
    config: { policySha256: config.policySha256, limits: config.limits },
  });
  void identityInput;
  const active = new Set<string>();
  async function processJob(id: string): Promise<Extraction> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw workerError('EXTRACTION_ID_INVALID');
    if (active.has(id)) throw workerError('EXTRACTION_BUSY');
    active.add(id);
    let reserved: WorkerInput | undefined;
    let workerId = '';
    let path = '';
    let pending: Promise<unknown> | undefined;
    let publishingClosed = false;
    try {
      const [prior] = await db`select * from attachment_extractions where id=${id}`;
      if (!prior) throw workerError('EXTRACTION_NOT_FOUND');
      if (prior.manifest) return prior.manifest as Extraction;
      if (prior.config_sha256 !== config.policySha256) throw workerError('CONFIG_NOT_AVAILABLE');
      const priorId = prior.worker_id === null ? null : String(prior.worker_id);
      if (priorId) {
        const state = await runner.inspect(priorId);
        if (state !== 'stopped')
          throw workerError(state === 'unknown' ? 'WORKER_CONTAINER_UNKNOWN' : 'EXTRACTION_BUSY');
        if (prior.lease_until && (prior.lease_until as Date).getTime() > now().getTime())
          throw workerError('EXTRACTION_BUSY');
        try {
          const priorPath = join(config.storageRoot, 'jobs', id, String(prior.generation));
          const marker = await assertWorkerDirectory(config.storageRoot, priorPath);
          const ack = await readPrivateJson(config.storageRoot, join(priorPath, '.publisher.closed.json'));
          if (
            ack.nonce !== marker.nonce ||
            ack.workerId !== priorId ||
            ack.generation !== String(prior.generation) ||
            ack.state !== 'closed'
          )
            throw workerError('WORKER_PUBLISHER_UNKNOWN');
        } catch {
          throw workerError('WORKER_PUBLISHER_UNKNOWN');
        }
      }
      const claimed = await db.begin(async (tx) => {
        // Capacity serializes admissions across service instances, not only this local map.
        await tx`select pg_advisory_xact_lock(507004)`;
        const [job] = await tx`select * from attachment_extractions where id=${id} for update`;
        if (
          !job ||
          String(job.generation) !== String(prior.generation) ||
          job.worker_id !== prior.worker_id ||
          job.manifest ||
          job.config_sha256 !== config.policySha256
        )
          throw workerError('STALE_EXTRACTION_GENERATION');
        const [count] =
          await tx`select count(*) as n from attachment_extractions where status='running' and id<>${id}`;
        if (Number(count.n) >= config.workerConcurrency) throw workerError('EXTRACTOR_CAPACITY');
        const [upload] = await tx`select * from attachment_uploads where id=${job.attachment_id} for update`;
        if (
          upload?.state !== 'ready' ||
          !upload.durable_at ||
          !upload.linked_at ||
          upload.expected_sha256 !== job.original_sha256 ||
          upload.owner_id !== 'owner'
        )
          throw workerError('WORKER_ORIGINAL_INVALID');
        const generation = (BigInt(String(job.generation)) + 1n).toString();
        const name = `crew-v2-extract-${id}-${generation}`;
        const input = validateWorkerInput({
          version: 1,
          jobId: id,
          generation,
          original: {
            attachmentId: String(job.attachment_id),
            sha256: String(job.original_sha256),
            ownerId: 'owner',
          },
          mime: String(upload.detected_mime),
          inputName: 'original',
          extractorVersion: String(job.extractor_version),
          config: { policySha256: config.policySha256, limits: config.limits },
        });
        await tx`update attachment_extractions set status='running',generation=${generation},worker_id=${name},lease_until=${new Date(now().getTime() + config.workerWallMs + 10000)},error_code=null where id=${id} and generation=${String(job.generation)}`;
        return {
          input,
          blob: {
            key: String(upload.storage_key),
            sha256: String(upload.expected_sha256),
            byteLength: Number(upload.expected_bytes),
          },
          name,
        };
      });
      reserved = claimed.input;
      workerId = claimed.name;
      if ((await store.verify(claimed.blob)) !== 'present') throw workerError('WORKER_ORIGINAL_INVALID');
      path = await prepareWorkerDirectory(config.storageRoot, reserved);
      const ownership = await assertWorkerDirectory(config.storageRoot, path, reserved);
      await writePrivateJson(config.storageRoot, join(path, '.publisher.intent.json'), {
        pid: globalThis.process.pid,
        workerId,
        generation: reserved.generation,
        nonce: ownership.nonce,
      });
      await db`insert into attachment_gc(id,attachment_id,extraction_id,kind,owned_key,ownership_nonce,state,generation,not_before) values(${randomUUID()},${reserved.original.attachmentId},${id},'job_scratch',${`jobs/${id}/${reserved.generation}`},${String(ownership.nonce)},'candidate',${reserved.generation},${new Date(now().getTime() + config.cleanupGraceMs)})`;
      const inputPath = join(path, 'input');
      const fd = await open(
        join(inputPath, 'original'),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o444,
      );
      try {
        let bytes = 0;
        const hash = createHash('sha256');
        for await (const chunk of await store.open(claimed.blob)) {
          bytes += chunk.length;
          if (bytes > claimed.blob.byteLength || bytes > config.maxFileBytes || chunk.length > 65536)
            throw workerError('WORKER_ORIGINAL_INVALID');
          hash.update(chunk);
          await fd.writeFile(chunk);
        }
        if (bytes !== claimed.blob.byteLength || hash.digest('hex') !== reserved.original.sha256)
          throw workerError('WORKER_ORIGINAL_INVALID');
        await fd.sync();
      } finally {
        await fd.close();
      }
      await writePrivateJson(config.storageRoot, join(inputPath, 'request.json'), reserved);
      await chmod(join(inputPath, 'request.json'), 0o444);
      await chmod(inputPath, 0o755);
      await syncDirectory(inputPath);
      const started = await runner.start(reserved, path);
      if (started.workerId !== workerId) throw workerError('WORKER_CONTAINER_UNKNOWN');
      let timer: ReturnType<typeof setTimeout> | undefined;
      pending = runner.result(workerId, path);
      pending.catch(() => {});
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(workerError('WORKER_TIMEOUT')), config.workerWallMs);
      });
      let raw: unknown;
      try {
        raw = await Promise.race([pending, timeout]);
      } finally {
        clearTimeout(timer);
      }
      const result = validateWorkerResult(reserved, raw);
      if ((await runner.inspect(workerId)) !== 'stopped') throw workerError('WORKER_CONTAINER_UNKNOWN');
      await assertWorkerDirectory(config.storageRoot, path, reserved);
      const derivatives: Derivative[] = [];
      for (const file of result.files) {
        const [current] =
          await db`select generation,status,worker_id from attachment_extractions where id=${id}`;
        if (
          !current ||
          String(current.generation) !== reserved.generation ||
          current.status !== 'running' ||
          current.worker_id !== workerId
        )
          throw workerError('STALE_EXTRACTION_GENERATION');
        const filename = join(path, 'output', file.relativeName);
        await noSymlinkComponents(config.storageRoot, filename);
        const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const st = await handle.stat();
          if (!st.isFile() || st.size !== file.byteLength) throw workerError('WORKER_FILE_MISMATCH');
          const hash = createHash('sha256');
          for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 65536 }))
            hash.update(chunk);
          if (hash.digest('hex') !== file.sha256) throw workerError('WORKER_FILE_MISMATCH');
          const derivativeId = randomUUID();
          const published = await store.publishDerivative(
            {
              attachmentId: reserved.original.attachmentId,
              extractionId: id,
              derivativeId,
              generation: reserved.generation,
              expectedBytes: file.byteLength,
              expectedSha256: file.sha256,
            },
            handle.createReadStream({ autoClose: false, start: 0, highWaterMark: 65536 }),
            new AbortController().signal,
          );
          if (published.sha256 !== file.sha256 || published.byteLength !== file.byteLength)
            throw workerError('WORKER_FILE_MISMATCH');
          derivatives.push({
            id: derivativeId,
            original: reserved.original,
            extractionId: id,
            kind: file.kind,
            mime: file.mime,
            sha256: file.sha256,
            byteLength: file.byteLength,
            unitIds: file.unitIds,
            verification: 'verified',
            extractorVersion: reserved.extractorVersion,
            configSha256: reserved.config.policySha256,
          });
        } finally {
          await handle.close();
        }
      }
      const body = {
        id,
        original: reserved.original,
        status: result.status,
        extractorVersion: reserved.extractorVersion,
        configSha256: reserved.config.policySha256,
        units: result.units,
        derivatives,
        problems: result.problems,
        verification: 'verified' as const,
      };
      const extraction: Extraction = {
        ...body,
        manifestSha256: createHash('sha256').update(canonicalJson(body)).digest('hex'),
      };
      const generation = reserved.generation;
      await db.begin(async (tx) => {
        const [current] = await tx`select * from attachment_extractions where id=${id} for update`;
        if (
          !current ||
          String(current.generation) !== generation ||
          current.status !== 'running' ||
          current.worker_id !== workerId ||
          current.config_sha256 !== config.policySha256 ||
          current.original_sha256 !== extraction.original.sha256
        )
          throw workerError('STALE_EXTRACTION_GENERATION');
        for (const derivative of derivatives)
          await tx`insert into attachment_derivatives(id,extraction_id,attachment_id,blob_key,sha256,byte_length,mime,kind,unit_ids,verification) values(${derivative.id},${id},${derivative.original.attachmentId},${`derivatives/${derivative.original.attachmentId}/${id}/${derivative.id}`},${derivative.sha256},${derivative.byteLength},${derivative.mime},${derivative.kind},${tx.json(derivative.unitIds)},'verified')`;
        await tx`update attachment_extractions set status=${extraction.status},manifest=${tx.json(JSON.parse(canonicalJson(extraction)))},manifest_sha256=${extraction.manifestSha256},completed_at=${now()},lease_until=null,error_code=null where id=${id} and generation=${generation}`;
      });
      publishingClosed = true;
      return extraction;
    } catch (error) {
      const code =
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        /^[A-Z_]+$/.test(error.code)
          ? error.code
          : 'WORKER_FAILED';
      if (reserved) {
        const state = await runner.stop(workerId);
        if (state === 'stopped') {
          if (pending) await pending.catch(() => {});
          publishingClosed = true;
        }
        await db`update attachment_extractions set error_code=${state === 'unknown' ? 'WORKER_CONTAINER_UNKNOWN' : code},status=${state === 'unknown' ? 'running' : 'failed'} where id=${id} and generation=${reserved.generation} and worker_id=${workerId}`;
      }
      throw workerError(code);
    } finally {
      if (publishingClosed && reserved && path) {
        const marker = await assertWorkerDirectory(config.storageRoot, path, reserved);
        await writePrivateJson(config.storageRoot, join(path, '.publisher.closed.json'), {
          workerId,
          generation: reserved.generation,
          nonce: marker.nonce,
          state: 'closed',
        });
      }
      active.delete(id);
    }
  }
  return { process: processJob };
}
