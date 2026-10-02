import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';
import { test } from 'node:test';
import { loadAttachmentConfig } from '../src/attachments/config.ts';
import type { WorkerResult } from '../src/attachments/contracts.ts';
import { createExtractionJobs, processExtraction } from '../src/attachments/jobs.ts';
import { createFileBlobStore, prepareOwnedUpload, writePrivateJson } from '../src/attachments/storage.ts';
import {
  readWorkerFrames,
  validateWorkerResult,
  type WorkerInput,
} from '../src/attachments/worker-protocol.ts';
import type { ExtractorRunner } from '../src/attachments/worker-runner.ts';
import { createDockerExtractorRunner, prepareWorkerDirectory } from '../src/attachments/worker-runner.ts';
import type { Db } from '../src/platform/contracts.ts';
import { databaseFixture } from './support/db.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
test('attachment worker duplicate locator cannot bypass coverage by JSON key order', () => {
  const input = workerInputFixture();
  const good = workerResultFixture(input);
  const unit = good.units[0];
  assert.ok(unit);
  const duplicate = {
    ...unit,
    id: 'u2',
    locator: { byteEnd: 5, byteStart: 0, lineEnd: 1, lineStart: 1, kind: 'text' },
  };
  assert.throws(
    () =>
      validateWorkerResult(input, {
        ...good,
        units: [unit, duplicate],
        files: good.files.map((f) => ({ ...f, unitIds: ['u1', 'u2'] })),
      }),
    { code: 'WORKER_RESULT_INVALID' },
  );
});
test('attachment worker Docker inspect rejects foreign identity and pending created start', async () =>
  scratch(async (root) => {
    const input = workerInputFixture();
    const path = await prepareWorkerDirectory(root, input);
    const owner = JSON.parse(await readFile(join(path, '.owner.json'), 'utf8')) as { nonce: string };
    const id = `crew-v2-extract-${input.jobId}-1`;
    const imageDigest = `sha256:${digest('image')}`,
      sourceTreeSha256 = digest('source');
    const binary = join(root, 'owned-docker-fixture');
    const inspection = join(root, 'inspection.json');
    const code = `#!${process.execPath}\nimport {readFileSync} from 'node:fs';process.stdout.write(readFileSync(${JSON.stringify(inspection)}));\n`;
    const { open } = await import('node:fs/promises');
    const handle = await open(binary, 'wx', 0o700);
    try {
      await handle.writeFile(code);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await writePrivateJson(root, join(path, '.start-intent.json'), {
      workerId: id,
      nonce: owner.nonce,
      imageDigest,
      sourceTreeSha256,
      binary,
      binarySha256: digest(code),
      mode: 'diagnostic',
    });
    const config = { dockerBinary: binary, imageDigest, sourceTreeSha256, storageRoot: root, wallMs: 1000 };
    const runner = createDockerExtractorRunner(config);
    const row = {
      Id: digest('container'),
      Image: imageDigest,
      Name: `/${id}`,
      Config: {
        Labels: {
          'crew.v2.nonce': owner.nonce,
          'crew.v2.source': sourceTreeSha256,
          'crew.v2.extraction': id,
        },
      },
      State: { Running: false, Status: 'exited' },
    };
    async function inspect(value: unknown) {
      const fd = await open(inspection, 'w', 0o600);
      try {
        await fd.writeFile(JSON.stringify([value]));
      } finally {
        await fd.close();
      }
      return runner.inspect(id);
    }
    assert.equal(await inspect(row), 'stopped');
    assert.equal(await inspect({ ...row, Image: `sha256:${digest('foreign')}` }), 'unknown');
    assert.equal(
      await inspect({ ...row, Config: { Labels: { ...row.Config.Labels, 'crew.v2.nonce': randomUUID() } } }),
      'unknown',
    );
    assert.equal(await inspect({ ...row, State: { Running: false, Status: 'created' } }), 'unknown');
  }));
export function workerInputFixture(): WorkerInput {
  const config = loadAttachmentConfig({ CREW_V2_ATTACHMENT_STORAGE_ROOT: '/tmp/crew-worker-fixture' });
  return {
    version: 1,
    jobId: randomUUID(),
    generation: '1',
    original: { attachmentId: randomUUID(), sha256: digest('original'), ownerId: 'owner' },
    mime: 'text/plain',
    inputName: 'original',
    extractorVersion: 'fixture-v1',
    config: { policySha256: config.policySha256, limits: config.limits },
  };
}
export function workerResultFixture(input: WorkerInput): WorkerResult {
  return {
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
        locator: { kind: 'text', byteStart: 0, byteEnd: 5, lineStart: 1, lineEnd: 1 },
        needs: 'text',
        state: 'available',
        reason: null,
      },
    ],
    files: [
      {
        relativeName: 'text-1.txt',
        kind: 'text',
        mime: 'text/plain',
        sha256: digest('hello'),
        byteLength: 5,
        unitIds: ['u1'],
      },
    ],
    problems: [],
  };
}
test('attachment worker rejects stale results before persisting derivatives', () => {
  const input = workerInputFixture();
  assert.throws(() => validateWorkerResult(input, { ...workerResultFixture(input), generation: '0' }), {
    code: 'STALE_EXTRACTION_GENERATION',
  });
});
test('attachment worker accepts exact result and rejects identity changes', () => {
  const input = workerInputFixture();
  assert.equal(validateWorkerResult(input, workerResultFixture(input)).files[0]?.byteLength, 5);
  for (const mutation of [
    { jobId: randomUUID() },
    { original: { ...input.original, sha256: digest('other') } },
    { extractorVersion: 'other' },
    { configSha256: digest('other') },
    { version: 2 },
  ]) {
    assert.throws(() => validateWorkerResult(input, { ...workerResultFixture(input), ...mutation }), {
      code: 'WORKER_RESULT_INVALID',
    });
  }
});
test('attachment worker rejects paths sizes hashes and false coverage', () => {
  const input = workerInputFixture();
  const good = workerResultFixture(input);
  const file = good.files[0];
  assert.ok(file);
  for (const mutation of [
    { relativeName: '../../x.txt' },
    { relativeName: 'A.txt' },
    { byteLength: -1 },
    { byteLength: 101 * 1024 * 1024 },
    { sha256: 'bad' },
    { unitIds: ['unknown'] },
    { kind: 'image', mime: 'text/plain' },
  ]) {
    assert.throws(() => validateWorkerResult(input, { ...good, files: [{ ...file, ...mutation }] }), {
      code: 'WORKER_RESULT_INVALID',
    });
  }
  assert.throws(() => validateWorkerResult(input, { ...good, files: [] }), { code: 'WORKER_RESULT_INVALID' });
  assert.throws(
    () =>
      validateWorkerResult(input, {
        ...good,
        units: [{ ...good.units[0], state: 'missing', reason: 'unknown' }],
      }),
    { code: 'WORKER_RESULT_INVALID' },
  );
  assert.throws(() => validateWorkerResult(input, { ...good, units: [good.units[0], good.units[0]] }), {
    code: 'WORKER_RESULT_INVALID',
  });
});
async function scratch(work: (root: string) => Promise<void>): Promise<void> {
  const nonce = randomUUID();
  const root = join(await realpath(tmpdir()), `crew-v2-attachments-worker-${nonce}`);
  // Receipt exists in memory before creation; deletion requires the same dev/ino/UID.
  console.info(`worker fixture intent root=${root} nonce=${nonce} pid=${process.pid}`);
  await mkdir(root, { mode: 0o700 });
  const identity = await lstat(root);
  try {
    await work(root);
  } finally {
    const current = await lstat(root);
    if (current.dev === identity.dev && current.ino === identity.ino && current.uid === identity.uid) {
      await rm(root, { recursive: true });
      console.info(
        `worker fixture removed root=${root} dev=${identity.dev} ino=${identity.ino} uid=${identity.uid}`,
      );
    } else await Promise.reject(new Error('TEST_RESOURCE_IDENTITY_CHANGED'));
  }
}
const chunks = async function* (text: string) {
  const bytes = Buffer.from(text);
  for (let at = 0; at < bytes.length; at += 7) yield bytes.subarray(at, at + 7);
};
const output = (input: WorkerInput) =>
  [
    { kind: 'file-start', name: 'text-1.txt', mime: 'text/plain', bytes: 5, sha256: digest('hello') },
    { kind: 'file-chunk', name: 'text-1.txt', base64: 'aGVsbG8=' },
    { kind: 'file-end', name: 'text-1.txt' },
    { kind: 'result', body: workerResultFixture(input) },
  ]
    .map((frame) => `${JSON.stringify(frame)}\n`)
    .join('');
test('attachment worker bounded frames verify actual bytes and refuse forged terminal', async () => {
  await scratch(async (root) => {
    const input = workerInputFixture();
    const result = await readWorkerFrames(input, chunks(output(input)), root);
    assert.equal(result.files.length, 1);
    assert.equal(await readFile(join(root, 'text-1.txt'), 'utf8'), 'hello');
  });
  await scratch(async (root) => {
    const input = workerInputFixture();
    await assert.rejects(
      readWorkerFrames(input, chunks(output(input).replace('aGVsbG8=', 'd29ybGQ=')), root),
      { code: 'WORKER_FILE_MISMATCH' },
    );
  });
  await scratch(async (root) => {
    const input = workerInputFixture();
    await assert.rejects(
      readWorkerFrames(input, chunks(output(input).replace('"byteLength":5', '"byteLength":4')), root),
      { code: 'WORKER_FILE_MISMATCH' },
    );
  });
});
test('attachment worker frames cannot follow output symlink or reuse a filename', async () => {
  await scratch(async (root) => {
    const input = workerInputFixture();
    await symlink('/dev/null', join(root, 'text-1.txt'));
    await assert.rejects(readWorkerFrames(input, chunks(output(input)), root), { code: 'EEXIST' });
  });
  await scratch(async (root) => {
    const input = workerInputFixture();
    const data = output(input);
    await assert.rejects(readWorkerFrames(input, chunks(data + data), root), {
      code: 'WORKER_FRAME_INVALID',
    });
  });
});
test('attachment worker detects truncated streams and bounds decoded chunk before write', async () => {
  await scratch(async (root) => {
    const input = workerInputFixture();
    await assert.rejects(readWorkerFrames(input, chunks(output(input).slice(0, -1)), root), {
      code: 'WORKER_FRAME_TRUNCATED',
    });
  });
  await scratch(async (root) => {
    const input = workerInputFixture();
    const bomb =
      JSON.stringify({
        kind: 'file-start',
        name: 'bomb.txt',
        mime: 'text/plain',
        bytes: 65537,
        sha256: digest('bomb'),
      }) +
      '\n' +
      JSON.stringify({
        kind: 'file-chunk',
        name: 'bomb.txt',
        base64: Buffer.alloc(65537).toString('base64'),
      }) +
      '\n';
    await assert.rejects(readWorkerFrames(input, chunks(bomb), root), { code: 'WORKER_OUTPUT_LIMIT' });
    assert.equal((await lstat(join(root, 'bomb.txt'))).size, 0);
  });
});
test('attachment worker creates exclusive owned job intent and preserves it on unknown', async () => {
  await scratch(async (root) => {
    const input = workerInputFixture();
    const directory = await prepareWorkerDirectory(root, input);
    assert.ok(directory.endsWith(`/jobs/${input.jobId}/1`));
    assert.equal(JSON.parse(await readFile(join(directory, '.owner.json'), 'utf8')).jobId, input.jobId);
    await assert.rejects(prepareWorkerDirectory(root, input), { code: 'EEXIST' });
  });
});
test('attachment worker extraction defaults denied before Task5 corpus receipt', async () => {
  const runner = createDockerExtractorRunner({
    dockerBinary: '/usr/local/bin/docker',
    imageDigest: `sha256:${digest('image')}`,
    sourceTreeSha256: digest('source'),
    storageRoot: '/tmp/worker',
    wallMs: 120000,
  });
  await assert.rejects(runner.start(workerInputFixture(), '/tmp/worker/jobs/unknown'), {
    code: 'PRODUCTION_CORPUS_REQUIRED',
  });
});
test('attachment worker legacy entry refuses ambient root and configuration', async () => {
  await assert.rejects(
    processExtraction({} as Db, randomUUID(), {} as never, {} as never, () => new Date()),
    { code: 'EXTRACTION_CONFIG_REQUIRED' },
  );
  assert.throws(() =>
    createExtractionJobs({
      db: {} as Db,
      runner: {} as never,
      store: {} as never,
      config: loadAttachmentConfig({ CREW_V2_ATTACHMENT_STORAGE_ROOT: '/tmp/unsafe/../root' }),
      now: () => new Date(),
    }),
  );
});
test('attachment worker stops unterminated nonterminal line before more stream reads', async () =>
  scratch(async (root) => {
    const input = workerInputFixture();
    async function* bomb() {
      yield Buffer.from('{"kind":"file-chunk","name":"a.txt","base64":"');
      yield Buffer.alloc(131072, 65);
      throw new Error('STREAM_WAS_READ_PAST_LINE_LIMIT');
    }
    await assert.rejects(readWorkerFrames(input, bomb(), root), { code: 'WORKER_OUTPUT_LIMIT' });
  }));
test('attachment worker problem codes are allowlisted and messages cannot expose content', () => {
  const input = workerInputFixture();
  const result = {
    ...workerResultFixture(input),
    status: 'partial',
    problems: [{ code: 'LIMIT_EXCEEDED', message: 'private-file-contents', unitIds: ['u1'] }],
  };
  assert.equal(validateWorkerResult(input, result).problems[0]?.message, 'Vượt giới hạn xử lý tệp.');
  assert.throws(
    () =>
      validateWorkerResult(input, {
        ...result,
        problems: [{ code: 'UNREVIEWED_CODE', message: 'anything', unitIds: ['u1'] }],
      }),
    { code: 'WORKER_RESULT_INVALID' },
  );
});
async function jobFixture(db: Db, root: string) {
  const config = loadAttachmentConfig({
    CREW_V2_ATTACHMENT_STORAGE_ROOT: root,
    CREW_V2_ATTACHMENT_WORKER_WALL_MS: '100',
  });
  const conversation = randomUUID(),
    compose = randomUUID(),
    attachmentId = randomUUID(),
    jobId = randomUUID(),
    nonce = randomUUID();
  const store = await createFileBlobStore({
    root,
    persistIntent: async (intent) => {
      if (intent.kind !== 'orphan_derivative') return;
      await db`insert into attachment_gc(id,attachment_id,extraction_id,kind,owned_key,ownership_nonce,state,generation,not_before) values(${randomUUID()},${intent.attachmentId},${intent.extractionId},${intent.kind},${intent.stageKey},${intent.ownershipNonce},'candidate',1,now()+interval '1 hour') on conflict(owned_key) do nothing`;
    },
  });
  await db`insert into attachment_conversations(id) values(${conversation})`;
  await db`insert into attachment_compose_sessions(id,conversation_id,purpose,state,expires_at) values(${compose},${conversation},'assistant_message','submitted',now()+interval '1 hour')`;
  await prepareOwnedUpload(root, attachmentId, nonce);
  const _original = Buffer.from('original');
  await store.receive(
    { attachmentId, generation: '1', expectedBytes: 8, expectedSha256: digest('original') },
    chunks('original'),
    new AbortController().signal,
  );
  await db`insert into attachment_uploads(id,compose_id,file_name,declared_mime,detected_mime,expected_bytes,expected_sha256,storage_key,ownership_nonce,policy_sha256,accepted_config,state,generation,durable_at,linked_at,expires_at) values(${attachmentId},${compose},'fixture.txt','text/plain','text/plain',8,${digest('original')},${`uploads/${attachmentId}/original`},${nonce},${config.policySha256},${db.json(JSON.parse(JSON.stringify({ limits: config.limits })))},'ready',1,now(),now(),now()+interval '1 hour')`;
  await db`insert into attachment_extractions(id,attachment_id,original_sha256,extractor_version,config_sha256,status) values(${jobId},${attachmentId},${digest('original')},'fixture-v1',${config.policySha256},'pending')`;
  let state: 'running' | 'stopped' | 'unknown' = 'stopped';
  let input: WorkerInput | undefined;
  let directory = '';
  let started = 0;
  let stale = false;
  let fenced = false;
  const runner: ExtractorRunner = {
    async start(value, path) {
      started++;
      input = value;
      directory = path;
      state = 'running';
      const [row] = await db`select worker_id,generation from attachment_extractions where id=${jobId}`;
      assert.equal(row.worker_id, `crew-v2-extract-${jobId}-${value.generation}`);
      assert.equal(String(row.generation), value.generation);
      return { workerId: String(row.worker_id) };
    },
    async inspect() {
      return state;
    },
    async stop() {
      return state === 'unknown' ? 'unknown' : 'stopped';
    },
    async result() {
      if (!input) throw new Error('FIXTURE_NOT_STARTED');
      if (state === 'unknown') await new Promise((resolve) => setTimeout(resolve, 200));
      state = state === 'unknown' ? 'unknown' : 'stopped';
      const result = workerResultFixture(input);
      await readWorkerFrames(input, chunks(output(input)), join(directory, 'output'));
      if (fenced) await db`update attachment_extractions set generation=generation+1 where id=${jobId}`;
      return stale ? { ...result, generation: '0' } : result;
    },
  };
  return {
    config,
    store,
    runner,
    jobId,
    setUnknown() {
      state = 'unknown';
    },
    setStale() {
      stale = true;
    },
    setFence() {
      fenced = true;
    },
    get started() {
      return started;
    },
  };
}
test(
  'attachment worker DB generation CAS commits verified bytes once',
  { skip: !env.CREW_V2_TEST_DATABASE_URL },
  () =>
    databaseFixture(9)(async (db) =>
      scratch(async (root) => {
        const f = await jobFixture(db, root);
        const jobs = createExtractionJobs({
          db,
          runner: f.runner,
          store: f.store,
          config: f.config,
          now: () => new Date(),
        });
        const result = await jobs.process(f.jobId);
        assert.equal(result.status, 'complete');
        assert.equal(result.derivatives.length, 1);
        assert.equal(
          await f.store.verify({
            key: `derivatives/${result.original.attachmentId}/${result.id}/${result.derivatives[0]?.id}`,
            sha256: digest('hello'),
            byteLength: 5,
          }),
          'present',
        );
        assert.equal((await jobs.process(f.jobId)).manifestSha256, result.manifestSha256);
        assert.equal(f.started, 1);
      }),
    ),
);
test(
  'attachment worker DB refuses unavailable accepted configuration and stale result',
  { skip: !env.CREW_V2_TEST_DATABASE_URL },
  () =>
    databaseFixture(9)(async (db) =>
      scratch(async (root) => {
        const f = await jobFixture(db, root);
        await db`update attachment_extractions set config_sha256=${digest('old')} where id=${f.jobId}`;
        const jobs = createExtractionJobs({
          db,
          runner: f.runner,
          store: f.store,
          config: f.config,
          now: () => new Date(),
        });
        await assert.rejects(jobs.process(f.jobId), { code: 'CONFIG_NOT_AVAILABLE' });
        assert.equal(f.started, 0);
        await db`update attachment_extractions set config_sha256=${f.config.policySha256} where id=${f.jobId}`;
        f.setStale();
        await assert.rejects(jobs.process(f.jobId), { code: 'STALE_EXTRACTION_GENERATION' });
        const [rows] = await db`select count(*) as n from attachment_derivatives`;
        assert.equal(Number(rows.n), 0);
      }),
    ),
);
test(
  'attachment worker DB expired lease with unknown prior worker blocks replacement',
  { skip: !env.CREW_V2_TEST_DATABASE_URL },
  () =>
    databaseFixture(9)(async (db) =>
      scratch(async (root) => {
        const f = await jobFixture(db, root);
        await db`update attachment_extractions set status='running',generation=1,worker_id=${`crew-v2-extract-${f.jobId}-1`},lease_until=now()-interval '1 hour' where id=${f.jobId}`;
        f.setUnknown();
        const jobs = createExtractionJobs({
          db,
          runner: f.runner,
          store: f.store,
          config: f.config,
          now: () => new Date(),
        });
        await assert.rejects(jobs.process(f.jobId), { code: 'WORKER_CONTAINER_UNKNOWN' });
        const [row] =
          await db`select status,generation,worker_id from attachment_extractions where id=${f.jobId}`;
        assert.equal(row.status, 'running');
        assert.equal(String(row.generation), '1');
        assert.equal(f.started, 0);
      }),
    ),
);
test(
  'attachment worker DB stopped container without publisher closure cannot retry expired generation',
  { skip: !env.CREW_V2_TEST_DATABASE_URL },
  () =>
    databaseFixture(9)(async (db) =>
      scratch(async (root) => {
        const f = await jobFixture(db, root);
        await db`update attachment_extractions set status='running',generation=1,worker_id=${`crew-v2-extract-${f.jobId}-1`},lease_until=now()-interval '1 hour' where id=${f.jobId}`;
        const jobs = createExtractionJobs({
          db,
          runner: f.runner,
          store: f.store,
          config: f.config,
          now: () => new Date(),
        });
        await assert.rejects(jobs.process(f.jobId), { code: 'WORKER_PUBLISHER_UNKNOWN' });
        assert.equal(f.started, 0);
      }),
    ),
);
test(
  'attachment worker DB concurrent call starts once and fencing forbids publication',
  { skip: !env.CREW_V2_TEST_DATABASE_URL },
  () =>
    databaseFixture(9)(async (db) =>
      scratch(async (root) => {
        const f = await jobFixture(db, root);
        f.setFence();
        const jobs = createExtractionJobs({
          db,
          runner: f.runner,
          store: f.store,
          config: f.config,
          now: () => new Date(),
        });
        const first = jobs.process(f.jobId);
        await assert.rejects(jobs.process(f.jobId), { code: 'EXTRACTION_BUSY' });
        await assert.rejects(first, { code: 'STALE_EXTRACTION_GENERATION' });
        assert.equal(f.started, 1);
        const [row] = await db`select count(*) n from attachment_derivatives`;
        assert.equal(Number(row.n), 0);
        const [gc] = await db`select count(*) n from attachment_gc where kind='orphan_derivative'`;
        assert.equal(Number(gc.n), 0);
      }),
    ),
);
