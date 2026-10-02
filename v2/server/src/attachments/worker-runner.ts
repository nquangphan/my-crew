import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { WorkerResult } from './contracts.ts';
import { noSymlinkComponents, readPrivateJson, syncDirectory, writePrivateJson } from './storage.ts';
import { readWorkerFrames, validateWorkerInput, type WorkerInput, workerError } from './worker-protocol.ts';
export type ExtractorRunnerConfig = {
  dockerBinary: string;
  imageDigest: string;
  sourceTreeSha256: string;
  storageRoot: string;
  wallMs: number;
};
export interface ExtractorRunner {
  start(input: WorkerInput, directory: string): Promise<{ workerId: string }>;
  inspect(id: string): Promise<'running' | 'stopped' | 'unknown'>;
  stop(id: string): Promise<'stopped' | 'unknown'>;
  result(id: string, directory: string): Promise<WorkerResult>;
}
export type ExtractorBuildReceipt = {
  targetPlatform: 'linux/amd64' | 'linux/arm64';
  libc: 'glibc';
  baseIndexDigest: string;
  basePlatformDigest: string;
  nativePackage: string;
  nativeIntegrity: string;
  lockSha256: string;
  sourceTreeSha256: string;
  imageDigest: string;
  stage: 'diagnostic' | 'production';
  boundaryResult: 'pass' | 'fail' | 'unverified';
  corpusResult: 'pass' | 'fail' | 'unverified';
};
export type DiagnosticReport = {
  kind: 'diagnostic-report';
  imageDigest: string;
  sourceTreeSha256: string;
  checks: { name: string; status: 'pass' | 'fail' | 'unverified'; evidenceSha256: string }[];
};
const runFile = promisify(execFile);
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const workerName = (input: WorkerInput) => `crew-v2-extract-${input.jobId}-${input.generation}`;
function validateConfig(config: ExtractorRunnerConfig): void {
  if (
    !isAbsolute(config.dockerBinary) ||
    !isAbsolute(config.storageRoot) ||
    !/^sha256:[0-9a-f]{64}$/.test(config.imageDigest) ||
    !/^[0-9a-f]{64}$/.test(config.sourceTreeSha256) ||
    !Number.isSafeInteger(config.wallMs) ||
    config.wallMs < 1 ||
    config.wallMs > 120000
  )
    throw workerError('WORKER_CONFIG_INVALID');
}
async function directory(root: string, path: string, exclusive = false): Promise<void> {
  await noSymlinkComponents(root, join(path, '..'));
  try {
    await mkdir(path, { mode: 0o700 });
    await syncDirectory(join(path, '..'));
  } catch (error) {
    if (exclusive || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await noSymlinkComponents(root, path);
  const stat = await lstat(path);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) throw workerError('WORKER_DIRECTORY_INVALID');
}
export async function prepareWorkerDirectory(root: string, input: WorkerInput): Promise<string> {
  validateWorkerInput(input);
  await noSymlinkComponents(root, root);
  if ((await realpath(root)) !== root) throw workerError('WORKER_DIRECTORY_INVALID');
  await directory(root, join(root, 'jobs'));
  await directory(root, join(root, 'jobs', input.jobId));
  const path = join(root, 'jobs', input.jobId, input.generation);
  await directory(root, path, true);
  const st = await lstat(path);
  await writePrivateJson(root, join(path, '.owner.json'), {
    kind: 'job_scratch',
    jobId: input.jobId,
    generation: input.generation,
    nonce: randomUUID(),
    dev: st.dev,
    ino: st.ino,
    uid: st.uid,
  });
  await directory(root, join(path, 'input'));
  await directory(root, join(path, 'output'));
  return path;
}
export async function assertWorkerDirectory(
  root: string,
  path: string,
  input?: WorkerInput,
): Promise<Record<string, unknown>> {
  const rel = relative(root, path);
  if (!/^jobs\/[0-9a-f-]{36}\/[1-9][0-9]{0,18}$/.test(rel)) throw workerError('WORKER_DIRECTORY_INVALID');
  const marker = await readPrivateJson(root, join(path, '.owner.json'));
  const st = await lstat(path);
  if (
    marker.kind !== 'job_scratch' ||
    typeof marker.nonce !== 'string' ||
    marker.dev !== st.dev ||
    marker.ino !== st.ino ||
    marker.uid !== st.uid ||
    rel !== `jobs/${marker.jobId}/${marker.generation}` ||
    (input && (marker.jobId !== input.jobId || marker.generation !== input.generation))
  )
    throw workerError('WORKER_DIRECTORY_INVALID');
  return marker;
}
type Intent = {
  workerId: string;
  nonce: string;
  imageDigest: string;
  sourceTreeSha256: string;
  binary: string;
  binarySha256: string;
  mode: 'diagnostic' | 'extract';
};
async function readIntent(
  config: ExtractorRunnerConfig,
  id: string,
): Promise<{ intent: Intent; path: string } | null> {
  const match = /^crew-v2-extract-([0-9a-f-]{36})-([1-9][0-9]{0,18})$/.exec(id);
  if (!match?.[1] || !match[2]) return null;
  const path = join(config.storageRoot, 'jobs', match[1], match[2]);
  try {
    const owner = await assertWorkerDirectory(config.storageRoot, path);
    const value = await readPrivateJson(config.storageRoot, join(path, '.start-intent.json'));
    if (
      value.workerId !== id ||
      value.nonce !== owner.nonce ||
      value.imageDigest !== config.imageDigest ||
      value.sourceTreeSha256 !== config.sourceTreeSha256 ||
      typeof value.binary !== 'string' ||
      typeof value.binarySha256 !== 'string' ||
      !['extract', 'diagnostic'].includes(String(value.mode))
    )
      return null;
    return { intent: value as Intent, path };
  } catch {
    return null;
  }
}
async function command(intent: Intent, args: string[]): Promise<string> {
  if (
    (await realpath(intent.binary)) !== intent.binary ||
    sha(await readFile(intent.binary)) !== intent.binarySha256
  )
    throw workerError('WORKER_BINARY_CHANGED');
  try {
    const result = await runFile(intent.binary, args, {
      timeout: 10000,
      maxBuffer: 65536,
      env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent' },
    });
    return result.stdout;
  } catch {
    throw workerError('EXTRACTOR_UNAVAILABLE');
  }
}
async function container(
  config: ExtractorRunnerConfig,
  id: string,
): Promise<{ state: 'running' | 'stopped' | 'created'; id: string; intent: Intent } | null> {
  const saved = await readIntent(config, id);
  if (!saved) return null;
  try {
    const rows: unknown = JSON.parse(await command(saved.intent, ['inspect', id]));
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const row = rows[0] as {
      Id?: unknown;
      Image?: unknown;
      Name?: unknown;
      State?: { Running?: unknown; Status?: unknown };
      Config?: { Labels?: Record<string, unknown> };
    };
    if (
      typeof row.Id !== 'string' ||
      !/^[0-9a-f]{64}$/.test(row.Id) ||
      row.Image !== saved.intent.imageDigest ||
      row.Name !== `/${id}` ||
      row.Config?.Labels?.['crew.v2.nonce'] !== saved.intent.nonce ||
      row.Config?.Labels?.['crew.v2.source'] !== config.sourceTreeSha256 ||
      row.Config?.Labels?.['crew.v2.extraction'] !== id
    )
      return null;
    const state =
      row.State?.Running === true
        ? 'running'
        : row.State?.Running === false && ['exited', 'dead'].includes(String(row.State.Status))
          ? 'stopped'
          : row.State?.Running === false && row.State.Status === 'created'
            ? 'created'
            : null;
    return state ? { state, id: row.Id, intent: saved.intent } : null;
  } catch {
    return null;
  }
}
async function stopContainer(config: ExtractorRunnerConfig, id: string): Promise<'stopped' | 'unknown'> {
  let observed = await container(config, id);
  if (!observed) return 'unknown';
  if (observed.state === 'stopped') return 'stopped';
  try {
    await command(observed.intent, ['stop', '--time=1', observed.id]);
  } catch {
    /* inspect remains authority */
  }
  observed = await container(config, id);
  return observed?.state === 'stopped' ? 'stopped' : 'unknown';
}
async function spawnWorkerContainer(
  config: ExtractorRunnerConfig,
  path: string,
  mode: 'diagnostic' | 'extract',
): Promise<{
  id: string;
  stream: AsyncIterable<Uint8Array>;
  closed: Promise<void>;
  failure: Promise<never>;
  fault: () => string | null;
  stop: () => Promise<'stopped' | 'unknown'>;
}> {
  validateConfig(config);
  const owner = await assertWorkerDirectory(config.storageRoot, path);
  const input = validateWorkerInput(JSON.parse(await readFile(join(path, 'input', 'request.json'), 'utf8')));
  if (owner.jobId !== input.jobId || owner.generation !== input.generation)
    throw workerError('WORKER_DIRECTORY_INVALID');
  const id = workerName(input);
  const binary = await realpath(config.dockerBinary);
  const intent: Intent = {
    workerId: id,
    nonce: String(owner.nonce),
    imageDigest: config.imageDigest,
    sourceTreeSha256: config.sourceTreeSha256,
    binary,
    binarySha256: sha(await readFile(binary)),
    mode,
  };
  // EXCL intent is durable before any spawn. Existing/unknown intent never creates a replacement.
  await writePrivateJson(config.storageRoot, join(path, '.start-intent.json'), intent);
  const image: unknown = JSON.parse(await command(intent, ['image', 'inspect', config.imageDigest]));
  if (!Array.isArray(image) || (image[0] as { Id?: unknown }).Id !== config.imageDigest)
    throw workerError('WORKER_IMAGE_INCOMPATIBLE');
  const argv = [
    'create',
    '--log-driver=none',
    '--pull=never',
    '--name',
    id,
    '--label',
    `crew.v2.extraction=${id}`,
    '--label',
    `crew.v2.nonce=${intent.nonce}`,
    '--label',
    `crew.v2.source=${config.sourceTreeSha256}`,
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user=65532:65532',
    '--memory=512m',
    '--memory-swap=512m',
    '--cpus=1',
    '--pids-limit=32',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
    '--mount',
    `type=bind,src=${join(path, 'input')},dst=/input,readonly`,
    '--tmpfs=/output:rw,noexec,nosuid,size=100m,uid=65532,gid=65532',
    config.imageDigest,
    '--mode',
    mode,
  ];
  const actual = (await command(intent, argv)).trim();
  if (!/^[0-9a-f]{64}$/.test(actual)) throw workerError('WORKER_CONTAINER_UNKNOWN');
  await writePrivateJson(config.storageRoot, join(path, '.container.json'), {
    id: actual,
    workerId: id,
    nonce: intent.nonce,
  });
  const checked = await container(config, id);
  if (!checked || checked.id !== actual) throw workerError('WORKER_CONTAINER_UNKNOWN');
  // Revalidate trusted binary immediately before the long-lived attach spawn.
  if (sha(await readFile(binary)) !== intent.binarySha256) throw workerError('WORKER_BINARY_CHANGED');
  const child = spawn(binary, ['start', '--attach', actual], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent' },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(workerError('EXTRACTOR_UNAVAILABLE')));
    child.once('close', () => resolve());
  }).finally(() => clearTimeout(timer));
  closed.catch(() => {});
  let rejectFailure: (error: Error) => void = () => {};
  const failure = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  failure.catch(() => {});
  const stopAttached = async (): Promise<'stopped' | 'unknown'> => {
    const state = await stopContainer(config, id);
    if (state === 'stopped') {
      // The exact container is gone; only this owned attach client remains. Its
      // backpressured pipes must close before awaiting CLI closure, not afterwards.
      child.stdout.destroy();
      child.stderr.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await closed;
    }
    return state;
  };
  let stopping = false;
  let fault: string | null = null;
  const fail = async (code: string) => {
    if (stopping) return;
    stopping = true;
    fault = code;
    const state = await stopAttached();
    rejectFailure(workerError(state === 'stopped' ? code : 'WORKER_CONTAINER_UNKNOWN'));
  };
  let stderr = 0;
  child.stderr.on('data', (bytes: Buffer) => {
    stderr += bytes.length;
    if (stderr > 65536) void fail('WORKER_STDERR_LIMIT');
  });
  timer = setTimeout(() => {
    void fail('WORKER_TIMEOUT');
  }, config.wallMs);
  await writePrivateJson(config.storageRoot, join(path, '.attach.json'), {
    pid: child.pid ?? null,
    workerId: id,
    containerId: actual,
    nonce: intent.nonce,
  });
  return {
    id,
    stream: child.stdout,
    closed,
    failure,
    fault: () => fault,
    stop: stopAttached,
  };
}
export function createDockerExtractorRunner(config: ExtractorRunnerConfig): ExtractorRunner {
  validateConfig(config);
  const frozen = Object.freeze({ ...config });
  return {
    async start() {
      throw workerError('PRODUCTION_CORPUS_REQUIRED');
    },
    async inspect(id) {
      const state = (await container(frozen, id))?.state;
      return state === 'running' || state === 'stopped' ? state : 'unknown';
    },
    async stop(id) {
      return stopContainer(frozen, id);
    },
    async result(id, path) {
      const saved = await readIntent(frozen, id);
      if (!saved || saved.path !== path || saved.intent.mode !== 'extract')
        throw workerError('WORKER_RESULT_UNAVAILABLE');
      if ((await this.inspect(id)) !== 'stopped') throw workerError('WORKER_CONTAINER_UNKNOWN');
      const input = validateWorkerInput(
        JSON.parse(await readFile(join(path, 'input', 'request.json'), 'utf8')),
      );
      const fd = await open(join(path, '.stdout.frames'), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        return await readWorkerFrames(input, fd.createReadStream({ autoClose: false }), join(path, 'output'));
      } finally {
        await fd.close();
      }
    },
  };
}
export async function runExtractorDiagnostic(
  config: ExtractorRunnerConfig,
  path: string,
): Promise<DiagnosticReport> {
  const run = await spawnWorkerContainer(config, path, 'diagnostic');
  let bytes = 0;
  const chunks: Buffer[] = [];
  let failed = false;
  try {
    const consume = async () => {
      for await (const chunk of run.stream) {
        bytes += chunk.length;
        if (bytes > 65536) {
          failed = true;
          await run.stop();
          break;
        }
        chunks.push(Buffer.from(chunk));
      }
      await run.closed;
    };
    await Promise.race([consume(), run.failure]);
    if ((await container(config, run.id))?.state !== 'stopped') throw workerError('WORKER_CONTAINER_UNKNOWN');
    if (failed) throw workerError('WORKER_OUTPUT_LIMIT');
    if (run.fault()) throw workerError(run.fault() ?? 'WORKER_FAILED');
    let report: unknown;
    try {
      report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw workerError('WORKER_DIAGNOSTIC_INVALID');
    }
    const candidate = report as DiagnosticReport;
    if (
      candidate?.kind !== 'diagnostic-report' ||
      !Array.isArray(candidate.checks) ||
      candidate.checks.length > 32 ||
      candidate.checks.some(
        (c) =>
          !c ||
          typeof c.name !== 'string' ||
          !['pass', 'fail', 'unverified'].includes(c.status) ||
          !/^[0-9a-f]{64}$/.test(c.evidenceSha256),
      )
    )
      throw workerError('WORKER_DIAGNOSTIC_INVALID');
    const answer = {
      kind: 'diagnostic-report' as const,
      imageDigest: config.imageDigest,
      sourceTreeSha256: config.sourceTreeSha256,
      checks: candidate.checks,
    };
    await writePrivateJson(config.storageRoot, join(path, '.diagnostic.json'), answer);
    return answer;
  } catch (error) {
    const state = await run.stop();
    if (state === 'unknown') throw workerError('WORKER_CONTAINER_UNKNOWN');
    await run.closed;
    if (failed) throw workerError('WORKER_OUTPUT_LIMIT');
    if (run.fault()) throw workerError(run.fault() ?? 'WORKER_FAILED');
    throw error;
  }
}
export async function removeStoppedWorkerContainer(
  config: ExtractorRunnerConfig,
  id: string,
): Promise<'removed' | 'unknown'> {
  const observed = await container(config, id);
  if (observed?.state !== 'stopped') return 'unknown';
  const saved = await readIntent(config, id);
  if (!saved) return 'unknown';
  // Persist reconciliation receipt before removing an exact stopped ID; never rm -f.
  await writePrivateJson(config.storageRoot, join(saved.path, '.reconciled.json'), {
    workerId: id,
    id: observed.id,
    nonce: observed.intent.nonce,
    state: 'stopped',
  });
  try {
    await command(observed.intent, ['rm', observed.id]);
    return 'removed';
  } catch {
    return 'unknown';
  }
}
