import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AttachmentRef, WorkerResult } from '../../src/attachments/contracts.ts';
import { createExtractionJobs } from '../../src/attachments/jobs.ts';
import { createAttachmentPublication } from '../../src/attachments/references.ts';
import { readWorkerFrames, type WorkerInput } from '../../src/attachments/worker-protocol.ts';
import type { ExtractorRunner } from '../../src/attachments/worker-runner.ts';
import type { attachmentAccessFixture } from './attachment-access.ts';
import { sha } from './attachments.ts';
export const fixturePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
// Controlled closed worker result through accepted Task4 framed-byte validation,
// real BlobStore publication and SQL CAS. No parser/native/provider certificate.
export async function publishKnownRepresentation(
  f: Awaited<ReturnType<typeof attachmentAccessFixture>>,
  original: AttachmentRef,
  mode: 'image' | 'text' = 'image',
  beforeCommit?: () => Promise<void>,
) {
  const [job] =
    await f.db`select id from attachment_extractions where attachment_id=${original.attachmentId} and status='pending' order by created_at desc limit 1`;
  assert.ok(job);
  const bytes = mode === 'image' ? fixturePng : Buffer.from('known text');
  let input: WorkerInput | undefined;
  let closed = false;
  const runner: ExtractorRunner = {
    async start(value) {
      input = value;
      closed = false;
      return { workerId: `crew-v2-extract-${value.jobId}-${value.generation}` };
    },
    async inspect() {
      return closed ? 'stopped' : 'running';
    },
    async stop() {
      closed = true;
      return 'stopped';
    },
    async result(_id, directory) {
      assert.ok(input);
      const result: WorkerResult = {
        version: 1,
        jobId: input.jobId,
        generation: input.generation,
        original: input.original,
        extractorVersion: input.extractorVersion,
        configSha256: input.config.policySha256,
        status: 'complete',
        units: [
          {
            id: 'u1',
            locator:
              mode === 'image'
                ? { kind: 'image', width: 1, height: 1, box: [0, 0, 1, 1] }
                : { kind: 'text', byteStart: 0, byteEnd: bytes.length, lineStart: 1, lineEnd: 1 },
            needs: mode === 'image' ? 'vision' : 'text',
            state: 'available',
            reason: null,
          },
        ],
        files: [
          {
            relativeName: mode === 'image' ? 'page-1.png' : 'text-1.txt',
            kind: mode,
            mime: mode === 'image' ? 'image/png' : 'text/plain',
            sha256: sha(bytes),
            byteLength: bytes.length,
            unitIds: ['u1'],
          },
        ],
        problems: [],
      };
      const name = result.files[0]?.relativeName;
      const frames = [
        { kind: 'file-start', name, mime: result.files[0]?.mime, bytes: bytes.length, sha256: sha(bytes) },
        { kind: 'file-chunk', name, base64: bytes.toString('base64') },
        { kind: 'file-end', name },
        { kind: 'result', body: result },
      ]
        .map((frame) => `${JSON.stringify(frame)}\n`)
        .join('');
      async function* chunks() {
        yield Buffer.from(frames);
      }
      const validated = await readWorkerFrames(input, chunks(), join(directory, 'output'));
      closed = true;
      return validated;
    },
  };
  const jobs = createExtractionJobs({
    db: f.db,
    runner,
    store: f.base.store,
    config: f.base.config,
    now: () => new Date(),
    runPublication: (input, work) =>
      createAttachmentPublication(f.db)(input, async (tx) => {
        const result = await work(tx);
        await beforeCommit?.();
        return result;
      }),
  });
  const extraction = await jobs.process(String(job.id));
  assert.equal(closed, true);
  assert.ok(input);
  const ack = JSON.parse(
    await readFile(
      join(f.base.root, 'jobs', String(job.id), input.generation, '.publisher.closed.json'),
      'utf8',
    ),
  ) as { workerId: string; generation: string; state: string };
  assert.equal(ack.state, 'closed');
  assert.equal(ack.generation, input.generation);
  assert.equal(ack.workerId, `crew-v2-extract-${job.id}-${input.generation}`);
  const derivative = extraction.derivatives[0];
  assert.ok(derivative);
  const [row] = await f.db`select blob_key from attachment_derivatives where id=${derivative.id}`;
  assert.equal(
    await f.base.store.verify({
      key: String(row.blob_key),
      sha256: derivative.sha256,
      byteLength: derivative.byteLength,
    }),
    'present',
  );
  return extraction;
}
