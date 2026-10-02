import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { env } from 'node:process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { loadAttachmentConfig } from '../src/attachments/config.ts';
import { writePrivateJson } from '../src/attachments/storage.ts';
import type { WorkerInput } from '../src/attachments/worker-protocol.ts';
import {
  createDockerExtractorRunner,
  type ExtractorBuildReceipt,
  type ExtractorRunnerConfig,
  prepareWorkerDirectory,
  removeStoppedWorkerContainer,
  runExtractorDiagnostic,
} from '../src/attachments/worker-runner.ts';

const exec = promisify(execFile);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
type Observation = {
  scenario: string;
  containerId: string;
  state: string;
  exitCode: number;
  oomKilled: boolean;
  pid: number;
  result: string;
};
export async function buildAndRunDiagnosticFixture(options: {
  includeExtractors: boolean;
  target: 'linux/amd64' | 'linux/arm64';
}): Promise<ExtractorBuildReceipt> {
  // A PM-owned target build precedes this fixture. This consumes its exact receipt;
  // it does not replace a failed frozen build or silently invoke another builder.
  if (options.includeExtractors) throw new Error('EXTRACTOR_NOT_INSTALLED');
  const receiptPath = env.CREW_V2_EXTRACTOR_BUILD_RECEIPT_PATH;
  if (!receiptPath || !isAbsolute(receiptPath)) throw new Error('EXTRACTOR_BUILD_RECEIPT_REQUIRED');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as ExtractorBuildReceipt;
  assert.equal(receipt.targetPlatform, options.target);
  assert.equal(receipt.stage, 'diagnostic');
  assert.equal(receipt.corpusResult, 'unverified');
  assert.match(receipt.imageDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(receipt.sourceTreeSha256, /^[0-9a-f]{64}$/);
  const dockerBinary = await realpath('/usr/local/bin/docker');
  const inspected = await exec(dockerBinary, ['image', 'inspect', receipt.imageDigest], { maxBuffer: 65536 });
  const image = JSON.parse(inspected.stdout)[0] as { Id: string; Os: string; Architecture: string };
  assert.equal(image.Id, receipt.imageDigest);
  assert.equal(`${image.Os}/${image.Architecture}`, options.target);
  const nonce = randomUUID();
  const root = join(await realpath(tmpdir()), `crew-v2-attachments-live-${nonce}`);
  console.info(`worker live root intent ${root} nonce=${nonce} parentPid=${process.pid}`);
  await mkdir(root, { mode: 0o700 });
  const identity = await lstat(root);
  await writePrivateJson(root, join(root, '.fixture-owner.json'), {
    nonce,
    dev: identity.dev,
    ino: identity.ino,
    uid: identity.uid,
  });
  const foreign = join(root, 'foreign-sentinel');
  await writePrivateJson(root, foreign, { sentinel: randomUUID() });
  const observations: Observation[] = [];
  let safeToRemove = true;
  try {
    for (const scenario of ['boundary', 'pids', 'memory', 'stdout-bomb', 'timeout']) {
      const policy = loadAttachmentConfig({ CREW_V2_ATTACHMENT_STORAGE_ROOT: root });
      const input: WorkerInput = {
        version: 1,
        jobId: randomUUID(),
        generation: '1',
        original: { attachmentId: randomUUID(), sha256: sha('original'), ownerId: 'owner' },
        mime: 'text/plain',
        inputName: 'original',
        extractorVersion: `crew-extractor-v1+pdfjs6.3.289+canvas1.0.3+yauzl3.4.0+saxes6.0.0+${receipt.sourceTreeSha256}`,
        config: { policySha256: policy.policySha256, limits: policy.limits },
      };
      const path = await prepareWorkerDirectory(root, input);
      const inputDirectory = join(path, 'input');
      await writePrivateJson(root, join(inputDirectory, 'request.json'), input);
      await chmod(join(inputDirectory, 'request.json'), 0o444);
      // Exclusive own file, readable only through the readonly input bind.
      const { open } = await import('node:fs/promises');
      const original = await open(join(inputDirectory, 'original'), 'wx', 0o444);
      try {
        await original.writeFile('original');
        await original.sync();
      } finally {
        await original.close();
      }
      await writePrivateJson(root, join(inputDirectory, 'canary.json'), { scenario, foreignPath: foreign });
      await chmod(join(inputDirectory, 'canary.json'), 0o444);
      await chmod(inputDirectory, 0o755);
      const config: ExtractorRunnerConfig = {
        dockerBinary,
        imageDigest: receipt.imageDigest,
        sourceTreeSha256: receipt.sourceTreeSha256,
        storageRoot: root,
        wallMs: scenario === 'timeout' ? 1500 : 20000,
      };
      const workerId = `crew-v2-extract-${input.jobId}-1`;
      console.info(`worker live container intent ${workerId} scenario=${scenario} root=${path}`);
      let outcome = '';
      let diagnostic: Awaited<ReturnType<typeof runExtractorDiagnostic>> | undefined;
      try {
        diagnostic = await runExtractorDiagnostic(config, path);
        outcome = 'report';
      } catch (error) {
        outcome = error instanceof Error ? error.message : 'WORKER_FAILED';
      }
      const runner = createDockerExtractorRunner(config);
      let state = await runner.inspect(workerId);
      if (state === 'running') state = await runner.stop(workerId);
      if (state !== 'stopped') {
        safeToRemove = false;
        throw new Error(`WORKER_CONTAINER_UNKNOWN:${workerId}`);
      }
      const info = await exec(dockerBinary, ['inspect', workerId], { maxBuffer: 65536 });
      const row = JSON.parse(info.stdout)[0] as {
        Id: string;
        State: { Status: string; ExitCode: number; OOMKilled: boolean; Pid: number };
        HostConfig: {
          LogConfig: { Type: string };
          Memory: number;
          MemorySwap: number;
          PidsLimit: number;
          NetworkMode: string;
          ReadonlyRootfs: boolean;
          CapDrop: string[];
          SecurityOpt: string[];
        };
      };
      console.info(
        `worker live stopped ${row.Id} scenario=${scenario} status=${row.State.Status} pid=${row.State.Pid} oom=${row.State.OOMKilled}`,
      );
      assert.equal(row.State.Pid, 0);
      assert.equal(row.HostConfig.Memory, 512 * 1024 * 1024);
      assert.equal(row.HostConfig.MemorySwap, 512 * 1024 * 1024);
      assert.equal(row.HostConfig.PidsLimit, 32);
      assert.equal(row.HostConfig.NetworkMode, 'none');
      assert.equal(row.HostConfig.ReadonlyRootfs, true);
      assert.equal(row.HostConfig.LogConfig.Type, 'none');
      assert.ok(row.HostConfig.CapDrop.includes('ALL'));
      observations.push({
        scenario,
        containerId: row.Id,
        state,
        exitCode: row.State.ExitCode,
        oomKilled: row.State.OOMKilled,
        pid: row.State.Pid,
        result: outcome,
      });
      await writePrivateJson(root, join(path, '.live-observation.json'), observations.at(-1));
      // Removal only after exact ID/labels/image inspection by the production helper.
      assert.equal(await removeStoppedWorkerContainer(config, workerId), 'removed');
      console.info(`worker live container removed ${row.Id}`);
      if (scenario === 'boundary' || scenario === 'pids') {
        assert.ok(diagnostic);
        const expected =
          scenario === 'pids'
            ? ['pids-limit']
            : [
                'selected-original-readable',
                'private-output-writable',
                'network-denied',
                'foreign-host-unavailable',
                'readonly-source',
                'readonly-original',
                'no-credential-db-workflow-env',
                'no-docker-socket',
                'no-host-source',
                'nonroot',
                'native-png-probe',
              ];
        assert.deepEqual(diagnostic.checks.map((check) => check.name).sort(), expected.sort());
        for (const check of diagnostic.checks) assert.equal(check.status, 'pass', check.name);
        assert.equal(diagnostic.kind, 'diagnostic-report');
        console.info(`worker live diagnostic evidence ${JSON.stringify(diagnostic)}`);
      }
      if (scenario === 'memory')
        assert.equal(row.State.OOMKilled, true, 'memory canary must hit actual cgroup bound');
      if (scenario === 'stdout-bomb') assert.equal(outcome, 'WORKER_OUTPUT_LIMIT');
      if (scenario === 'timeout') assert.equal(outcome, 'WORKER_TIMEOUT');
    }
    console.info(`worker live observations ${JSON.stringify(observations)}`);
    return { ...receipt, boundaryResult: 'pass', corpusResult: 'unverified' };
  } finally {
    const current = await lstat(root);
    const marker = JSON.parse(await readFile(join(root, '.fixture-owner.json'), 'utf8')) as { nonce: string };
    if (
      safeToRemove &&
      marker.nonce === nonce &&
      current.dev === identity.dev &&
      current.ino === identity.ino &&
      current.uid === identity.uid
    ) {
      await rm(root, { recursive: true });
      console.info(`worker live root removed ${root}`);
    } else console.info(`worker live root retained ${root}`);
  }
}
test('attachment diagnostic image has no Task5 import dependency', {
  skip: env.CREW_V2_EXTRACTOR_LIVE_TEST !== '1',
}, async () => {
  const result = await buildAndRunDiagnosticFixture({ includeExtractors: false, target: 'linux/amd64' });
  assert.equal(result.stage, 'diagnostic');
  assert.equal(result.boundaryResult, 'pass');
  assert.equal(result.corpusResult, 'unverified');
});
