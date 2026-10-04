import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import test from 'node:test';
import { createBmadArtifactInspector, type RenderLayerPath } from '../src/assistant/render-artifacts.ts';
import {
  createRenderExecutor,
  type ExecutableIdentity,
  type RenderJournal,
  type RenderOperations,
  type RenderOutcome,
  type RenderRequest,
  type RenderStageUpdate,
} from '../src/assistant/render-executor.ts';
import { createWorkflowManifest, type WorkflowDefinition } from '../src/assistant/workflow-manifest.ts';
import type { ExecutionReceipt, OwnedIdentity } from '../src/workflows/operations.ts';
import {
  type ManifestEntry,
  type ProjectionPin,
  projectionTreeHash,
  type SourcePin,
} from '../src/workflows/pins.ts';
import { manifest, manifestHash, parseArchive, type TreeFile, writeTree } from '../src/workflows/stage.ts';
import { officialRender } from './support/bmad-render-double.ts';

const fixtures = new URL('./fixtures/', import.meta.url);
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const skillRoot = '.claude/skills/bmad-build';
const layerPaths: readonly RenderLayerPath[] = [
  '_bmad/config.toml',
  '_bmad/config.user.toml',
  '_bmad/custom/config.toml',
  '_bmad/custom/config.user.toml',
  '_bmad/custom/bmad-build.toml',
  '_bmad/custom/bmad-build.user.toml',
  '.claude/skills/bmad-build/customize.toml',
];
const attemptId = '0b8f3c62-5d1e-4a8f-9c3b-2f6d7e8a9b10';
const operationIds = [
  '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60',
  '3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6071',
];

// Synthetic token-free bmad-build tree: the executor and inspector logic are under test, not the
// official renderer. The source pin and source manifest are the real pinned BMAD 6.12.0 archive.
const projected: TreeFile[] = [
  { path: `${skillRoot}/SKILL.md`, type: 'file', mode: 0o644, body: Buffer.from('Run the renderer.\n') },
  { path: `${skillRoot}/workflow.md`, type: 'file', mode: 0o644, body: Buffer.from('Start.\n') },
  { path: `${skillRoot}/steps/step-01.md`, type: 'file', mode: 0o644, body: Buffer.from('Next.\n') },
  { path: `${skillRoot}/customize.toml`, type: 'file', mode: 0o644, body: Buffer.from('title = "Build"\n') },
  { path: '_bmad/scripts/render_skill.py', type: 'file', mode: 0o644, body: Buffer.from('renderer\n') },
  { path: '_bmad/scripts/config_utils.py', type: 'file', mode: 0o644, body: Buffer.from('utils\n') },
  { path: '_bmad/config.toml', type: 'file', mode: 0o644, body: Buffer.from('project_name = "Demo"\n') },
];

let pinned: Promise<{
  source: SourcePin;
  sourceManifest: ManifestEntry[];
  derivation: ProjectionPin['derivation'];
}>;
function pinnedSource() {
  pinned ??= (async () => {
    const audits = JSON.parse(await readFile(new URL('workflows/official-audits.json', fixtures), 'utf8'));
    const builds = JSON.parse(
      await readFile(new URL('workflow-builder/real-projections.json', fixtures), 'utf8'),
    );
    const archive = await readFile(new URL('workflows/bmad-6.12.0.tgz', fixtures));
    const sourceFiles = await parseArchive(archive, audits.bmad.source.executables);
    return {
      source: audits.bmad.source.pin as SourcePin,
      sourceManifest: manifest(sourceFiles),
      derivation: builds.bmad.claude.expected.derivation as ProjectionPin['derivation'],
    };
  })();
  return pinned;
}

function clone(files: TreeFile[]): TreeFile[] {
  return files.map((file) => ({ ...file, body: Buffer.from(file.body) }));
}

async function bmadDefinition(base: string, files: TreeFile[]): Promise<WorkflowDefinition> {
  const { source, sourceManifest, derivation } = await pinnedSource();
  const projectionManifest = manifest(clone(files));
  const pin = {
    runtime: 'claude' as const,
    sourceTreeSha256: source.sourceTreeSha256,
    manifestSha256: manifestHash(projectionManifest),
    derivation,
  };
  const projection: ProjectionPin = { ...pin, treeSha256: projectionTreeHash(pin) };
  const projectionRoot = join(base, 'projection');
  await writeTree(projectionRoot, clone(files));
  return createWorkflowManifest({
    resolve: async () => ({
      sourceRoot: join(base, 'source-not-materialized'),
      projectionRoot,
      manifest: { source: sourceManifest, projection: projectionManifest },
    }),
  }).loadDefinition(source, projection);
}

type ChildResult =
  | { kind: 'exit'; exitCode: number; stdout: string }
  | { kind: 'timeout' }
  | { kind: 'fork' }
  | { kind: 'helper-failure' }
  | { kind: 'busy' }
  | { kind: 'guard-invalid' };
type ExecuteCall = { id: string; cwd: string; command: string[]; timeoutSeconds: number; policy: string };

/**
 * Test double of `OwnedOperations` mirroring the reviewed primitive's contract:
 * `absent` throws when the name exists under the owned parent; `create` makes a private,
 * exclusive `stages/{id}` and returns its identity; `executeTree` requires that exact stage identity,
 * a timeout of 1–120 s and an absolute command. When `.operations.guard` is held it throws
 * `EXECUTOR_BUSY`, and when the guard is not a private regular file `EXECUTOR_GUARD_INVALID`, both
 * before writing anything. Otherwise it writes the session leader record `receipts/{id}.leader`
 * (O_EXCL) before the child starts, sends merged stdout/stderr to `stages/{id}/execution.log`
 * (O_EXCL), writes one exclusive receipt `receipts/{id}.json` (`mode: 'tree'`), throws
 * `EXECUTOR_LIFETIME_UNKNOWN` when the session was not proven empty and `EXECUTOR_RECEIPT_MISSING`
 * when the helper fails; a timeout is a receipt with `timedOut` and signal exit code; `remove` deletes
 * only that stage identity. The child itself is the scripted `behaviour`, never a real process.
 */
// `NativeHelper.run` rejects with the promisified execFile error, whose `code` is the exit status.
function helperExit(code: number): Error {
  return Object.assign(new Error(`Command failed with exit code ${code}`), { code });
}

const leaderLine = '4242 1791072000.123456\n';

class FakeOperations implements RenderOperations {
  readonly root: string;
  readonly calls: string[] = [];
  readonly executions: ExecuteCall[] = [];
  behaviour: (call: ExecuteCall) => Promise<ChildResult>;
  /** Another owned operation holds `.operations.guard`: the helper exits 20 for every action. */
  busy = false;
  constructor(root: string, behaviour: (call: ExecuteCall) => Promise<ChildResult>) {
    this.root = root;
    this.behaviour = behaviour;
  }
  async absent(parent: 'stages' | 'sources' | 'projections' | 'quarantine' | 'receipts', id: string) {
    this.calls.push(`absent:${parent}:${id}`);
    if (this.busy) throw helperExit(20);
    if (await lstat(join(this.root, parent, id)).catch(() => null)) throw helperExit(22);
  }
  async create(id: string): Promise<OwnedIdentity> {
    this.calls.push(`create:${id}`);
    if (this.busy) throw helperExit(20);
    const path = join(this.root, 'stages', id);
    await mkdir(path, { mode: 0o700 });
    const s = await lstat(path);
    return {
      device: String(s.dev),
      inode: String(s.ino),
      ownerUid: s.uid,
      kind: 'directory',
      linkCount: s.nlink,
    };
  }
  async executeTree(
    id: string,
    object: OwnedIdentity,
    cwd: string,
    command: string[],
    timeoutSeconds = 90,
  ): Promise<ExecutionReceipt> {
    this.calls.push(`executeTree:${id}`);
    const stage = join(this.root, 'stages', id);
    const s = await lstat(stage);
    if (String(s.dev) !== object.device || String(s.ino) !== object.inode)
      throw new Error('EXECUTOR_RECEIPT_MISSING');
    if (
      !Number.isInteger(timeoutSeconds) ||
      timeoutSeconds < 1 ||
      timeoutSeconds > 120 ||
      !command[0]?.startsWith('/')
    )
      throw new Error('EXECUTOR_RECEIPT_MISSING');
    const policyIndex = command.indexOf('-f');
    const policy = policyIndex < 0 ? '' : await readFile(command[policyIndex + 1], 'utf8');
    const call = { id, cwd, command: [...command], timeoutSeconds, policy };
    this.executions.push(call);
    const result = await this.behaviour(call);
    if (result.kind === 'busy') throw new Error('EXECUTOR_BUSY');
    if (result.kind === 'guard-invalid') throw new Error('EXECUTOR_GUARD_INVALID');
    await writeFile(join(this.root, 'receipts', `${id}.leader`), leaderLine, { flag: 'wx', mode: 0o600 });
    if (result.kind === 'helper-failure') throw new Error('EXECUTOR_RECEIPT_MISSING');
    const log = await open(
      join(stage, 'execution.log'),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await log.writeFile(result.kind === 'exit' ? result.stdout : '');
    await log.close();
    const receipt: ExecutionReceipt = {
      formatVersion: 1,
      operationId: id,
      device: object.device,
      inode: object.inode,
      treeEmpty: true,
      forkObserved: true,
      exitCode: result.kind === 'exit' ? result.exitCode : 137,
      timedOut: result.kind === 'timeout',
      mode: 'tree',
      sessionEmptyAtExit: result.kind !== 'fork',
      survivors: result.kind === 'fork' ? 1 : 0,
      escaped: 0,
      maxSessionSize: 2,
      groupsKnown: 1,
    };
    await writeFile(join(this.root, 'receipts', `${id}.json`), JSON.stringify(receipt), { flag: 'wx' });
    if (result.kind === 'fork') throw new Error('EXECUTOR_LIFETIME_UNKNOWN');
    return receipt;
  }
  async remove(
    parent: 'stages' | 'sources' | 'projections' | 'quarantine' | 'receipts',
    name: string,
    object: OwnedIdentity,
  ) {
    this.calls.push(`remove:${parent}:${name}`);
    const path = join(this.root, parent, name);
    const s = await lstat(path);
    if (String(s.dev) !== object.device || String(s.ino) !== object.inode)
      throw new Error('OPERATION_HELPER_FAILED');
    await rm(path, { recursive: true });
  }
}

/** Durable render-stage record double: keeps every update in order and can refuse new renders. */
class MemoryJournal implements RenderJournal {
  readonly updates: [string, RenderStageUpdate][] = [];
  reconcileRequired = false;
  async blocked(): Promise<boolean> {
    return this.reconcileRequired;
  }
  async record(operationId: string, update: RenderStageUpdate): Promise<void> {
    this.updates.push([operationId, structuredClone(update)]);
  }
  states(): string[] {
    return this.updates.map(([, update]) => update.state);
  }
}

type Harness = {
  base: string;
  projectRoot: string;
  definition: WorkflowDefinition;
  operations: FakeOperations;
  journal: MemoryJournal;
  uv: ExecutableIdentity;
  python: ExecutableIdentity;
  times: string[];
  render(
    overrides?: Partial<RenderRequest>,
    uv?: ExecutableIdentity,
    python?: ExecutableIdentity,
  ): Promise<RenderOutcome>;
};

const officialChild = async (call: ExecuteCall): Promise<ChildResult> => ({
  kind: 'exit',
  ...(await officialRender(officialArgv(call.command))),
});

function officialArgv(command: string[]): string[] {
  const start = command.findIndex((part) => posix.basename(part) === 'uv');
  return command.slice(start);
}

async function withHarness(run: (h: Harness) => Promise<void>, files = projected): Promise<void> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'crew-render-executor-')));
  try {
    const definition = await bmadDefinition(base, files);
    const projectRoot = join(base, 'workspaces', 'Crew S6a Project');
    await mkdir(join(base, 'workspaces'));
    await writeTree(projectRoot, clone(files));
    for (const parent of ['stages', 'receipts', 'quarantine'])
      await mkdir(join(base, 'ops', parent), { recursive: true, mode: 0o700 });
    await mkdir(join(base, 'bin'));
    const uvPath = join(base, 'bin', 'uv');
    await writeFile(uvPath, 'uv 0.9.0 test bytes\n', { mode: 0o755 });
    const uv: ExecutableIdentity = {
      path: uvPath,
      realpath: uvPath,
      sha256: sha256('uv 0.9.0 test bytes\n'),
      version: 'uv 0.9.0',
    };
    // Homebrew layout: the recorded path is a symlink into the versioned keg.
    await mkdir(join(base, 'cellar'));
    const pythonReal = join(base, 'cellar', 'python3.13');
    await writeFile(pythonReal, 'python 3.13 test bytes\n', { mode: 0o755 });
    await symlink(pythonReal, join(base, 'bin', 'python3'));
    const python: ExecutableIdentity = {
      path: join(base, 'bin', 'python3'),
      realpath: pythonReal,
      sha256: sha256('python 3.13 test bytes\n'),
      version: '3.13.5',
    };
    const operations = new FakeOperations(join(base, 'ops'), officialChild);
    const journal = new MemoryJournal();
    const times: string[] = [];
    let tick = Date.parse('2026-10-04T00:00:00.000Z');
    const clock = () => {
      tick += 1000;
      const now = new Date(tick);
      times.push(now.toISOString());
      return now;
    };
    let next = 0;
    await run({
      base,
      projectRoot,
      definition,
      operations,
      journal,
      uv,
      python,
      times,
      render: (overrides = {}, uvOverride = uv, pythonOverride = python) =>
        createRenderExecutor({
          operations,
          journal,
          prerequisites: { uv: uvOverride, python: pythonOverride },
          clock,
        }).render({
          definition: structuredClone(definition),
          projectRoot,
          attemptId,
          operationId: operationIds[next++ % operationIds.length],
          ...overrides,
        }),
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

/** A halt carries log diagnostics exactly when an execution log exists to measure. */
function halted(outcome: RenderOutcome, reason: string, logged = false): void {
  assert(!('receipt' in outcome), JSON.stringify(outcome));
  assert.equal(outcome.reason, reason);
  assert.equal(outcome.halt, true);
  assert.equal('log' in outcome, logged, `${reason} log diagnostics`);
}

function expectedArgv(projectRoot: string, uvPath: string): string[] {
  return [
    uvPath,
    'run',
    '--no-cache',
    `${projectRoot}/_bmad/scripts/render_skill.py`,
    '--project-root',
    projectRoot,
    '--skill',
    `${projectRoot}/${skillRoot}`,
  ];
}

async function independentInspection(
  projectRoot: string,
  definition: WorkflowDefinition,
  generationPath: string,
) {
  assert(definition.render);
  const projectedFiles: Record<string, Uint8Array> = {};
  for (const path of Object.keys(definition.render.selectedProjectionSha256))
    projectedFiles[path] = await readFile(join(projectRoot, path));
  const layerFiles = {} as Record<RenderLayerPath, Uint8Array | null>;
  for (const path of layerPaths) layerFiles[path] = await readFile(join(projectRoot, path)).catch(() => null);
  const outputBytes: Record<string, Uint8Array> = {};
  for (const name of ['steps/step-01.md', 'workflow.md'])
    outputBytes[name] = await readFile(join(generationPath, name));
  return createBmadArtifactInspector({
    ...definition.render,
    projectRoot,
    generationRoot: generationPath,
  }).inspect({
    generationPath,
    projectedFiles,
    layerFiles,
    manifestBytes: await readFile(join(generationPath, 'manifest.json')),
    outputBytes,
  });
}

test('render executor refuses a non-BMAD definition without reserving or spawning anything', async () => {
  await withHarness(async (h) => {
    const superpowers: WorkflowDefinition = {
      sha256: h.definition.sha256,
      skills: h.definition.skills,
      customizationSha256: h.definition.customizationSha256,
    };
    halted(await h.render({ definition: superpowers }), 'RENDER_NOT_BMAD');
    assert.deepEqual(h.operations.calls, []);
  });
});

test('render executor runs the official uv argv once and returns the exact workflow render receipt', async () => {
  await withHarness(async (h) => {
    const outcome = await h.render();
    assert('receipt' in outcome, JSON.stringify(outcome));
    const argv = expectedArgv(h.projectRoot, h.uv.realpath);
    assert.equal(h.operations.executions.length, 1);
    const [call] = h.operations.executions;
    const stage = join(h.operations.root, 'stages', `render-${operationIds[0]}`);
    assert.equal(call.id, `render-${operationIds[0]}`);
    assert.equal(call.cwd, stage);
    assert.deepEqual(call.command, [
      '/usr/bin/env',
      'UV_OFFLINE=1',
      'UV_NO_CONFIG=1',
      'UV_PYTHON_DOWNLOADS=never',
      `UV_PYTHON=${h.python.realpath}`,
      'PYTHONDONTWRITEBYTECODE=1',
      '/usr/bin/sandbox-exec',
      '-f',
      join(stage, 'render.sb'),
      ...argv,
    ]);
    assert.equal(call.timeoutSeconds, 60);
    assert.match(call.policy, /\(deny network\*\)/);
    assert.match(call.policy, /\(deny file-write\*\)/);
    assert(call.policy.includes(`(subpath ${JSON.stringify(stage)})`));
    assert(call.policy.includes(`(subpath ${JSON.stringify(`${h.projectRoot}/_bmad/render`)})`));
    assert.deepEqual(h.operations.calls, [
      `absent:receipts:render-${operationIds[0]}.json`,
      `absent:receipts:render-${operationIds[0]}.leader`,
      `absent:stages:render-${operationIds[0]}`,
      `create:render-${operationIds[0]}`,
      `executeTree:render-${operationIds[0]}`,
      `remove:stages:render-${operationIds[0]}`,
    ]);
    assert.equal(await lstat(stage).catch(() => null), null);
    // The session leader record is reclaimed with the stage; the execution receipt stays as reuse proof.
    const receipts = join(h.operations.root, 'receipts');
    assert.equal(await lstat(join(receipts, `render-${operationIds[0]}.leader`)).catch(() => null), null);
    assert(await lstat(join(receipts, `render-${operationIds[0]}.json`)));

    const generationPath = outcome.receipt.data.generationPath;
    assert.match(
      generationPath,
      new RegExp(
        `^${h.projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/_bmad/render/bmad-build/crew-s6a-project-${sha256(h.projectRoot).slice(0, 12)}/[0-9a-f]{20}$`,
      ),
    );
    assert.deepEqual(outcome, {
      receipt: {
        kind: 'workflow_render_receipt',
        attemptId,
        data: {
          definitionSha256: h.definition.sha256,
          customizationSha256: h.definition.customizationSha256,
          projectRoot: h.projectRoot,
          generationPath,
          inspection: await independentInspection(h.projectRoot, h.definition, generationPath),
          witness: {
            uvPath: h.uv.path,
            uvSha256: h.uv.sha256,
            uvVersion: h.uv.version,
            python: { path: h.python.path, sha256: h.python.sha256, version: h.python.version },
            argv,
            exitCode: 0,
            stdoutPath: `${generationPath}/workflow.md`,
            startedAt: h.times[0],
            endedAt: h.times[1],
            operationId: operationIds[0],
          },
        },
      },
    });
  });
});

test('render executor leaves an existing byte-identical generation untouched on a second render', async () => {
  await withHarness(async (h) => {
    const first = await h.render();
    assert('receipt' in first);
    const generation = first.receipt.data.generationPath;
    const before = await Promise.all(
      ['manifest.json', 'workflow.md', 'steps/step-01.md'].map(async (name) => {
        const s = await stat(join(generation, name));
        return [name, s.ino, s.mtimeMs, sha256(await readFile(join(generation, name)))];
      }),
    );
    const second = await h.render();
    assert('receipt' in second, JSON.stringify(second));
    assert.equal(h.operations.executions.length, 2);
    assert.equal(second.receipt.data.generationPath, generation);
    assert.deepEqual(second.receipt.data.inspection, first.receipt.data.inspection);
    assert.equal(second.receipt.data.witness.operationId, operationIds[1]);
    const after = await Promise.all(
      ['manifest.json', 'workflow.md', 'steps/step-01.md'].map(async (name) => {
        const s = await stat(join(generation, name));
        return [name, s.ino, s.mtimeMs, sha256(await readFile(join(generation, name)))];
      }),
    );
    assert.deepEqual(after, before);
  });
});

test('render executor never runs one operation twice', async () => {
  await withHarness(async (h) => {
    assert('receipt' in (await h.render({ operationId: operationIds[2] })));
    halted(await h.render({ operationId: operationIds[2] }), 'RENDER_OPERATION_REUSED');
    assert.equal(h.operations.executions.length, 1);
  });
});

test('render executor halts without a receipt on nonzero, unavailable, timed-out or unknown children', async () => {
  const cases: [ChildResult, string, boolean, boolean][] = [
    [{ kind: 'exit', exitCode: 1, stdout: 'HALT: config missing\n' }, 'RENDER_EXIT_NONZERO', true, true],
    [{ kind: 'exit', exitCode: 2, stdout: '' }, 'RENDER_EXIT_NONZERO', true, true],
    [{ kind: 'exit', exitCode: 127, stdout: '' }, 'RENDER_UV_UNAVAILABLE', true, true],
    [{ kind: 'timeout' }, 'RENDER_TIMED_OUT', true, true],
    [{ kind: 'fork' }, 'RENDER_LIFETIME_UNKNOWN', false, true],
    [{ kind: 'helper-failure' }, 'RENDER_OPERATION_UNAVAILABLE', false, false],
  ];
  for (const [result, reason, reclaimed, logged] of cases) {
    await withHarness(async (h) => {
      h.operations.behaviour = async () => result;
      halted(await h.render(), reason, logged);
      assert.equal(h.operations.executions.length, 1, reason);
      const stage = join(h.operations.root, 'stages', `render-${operationIds[0]}`);
      // A stage is reclaimed only when the primitive proved the child closed.
      assert.equal((await lstat(stage).catch(() => null)) === null, reclaimed, reason);
    });
  }
});

test('render executor halts when stdout does not name exactly the rendered workflow entry', async () => {
  const variants: ((stdout: string) => string)[] = [
    (stdout) => stdout.replace(/\/workflow\.md\n$/, '/step-01.md\n'),
    (stdout) => stdout.replace(/\n$/, ''),
    (stdout) => `warning: noise\n${stdout}`,
    (stdout) => `${stdout}extra\n`,
    (stdout) => stdout.replace('read and follow ', 'read and follow ./'),
    (stdout) => stdout.replace(/[0-9a-f]{20}\/workflow/, `${'0'.repeat(20)}/workflow`),
    (stdout) => stdout.replace(/\/_bmad\/render\//, '/_bmad/render/../render/'),
    () => `read and follow /tmp/elsewhere/workflow.md\n`,
    (stdout) => `${stdout}${' '.repeat(70 * 1024)}`,
  ];
  for (const variant of variants) {
    await withHarness(async (h) => {
      h.operations.behaviour = async (call) => {
        const result = await officialRender(officialArgv(call.command));
        return { kind: 'exit', exitCode: result.exitCode, stdout: variant(result.stdout) };
      };
      halted(await h.render(), 'RENDER_STDOUT_MISMATCH', true);
    });
  }
});

test('render executor halts when the printed generation does not match its measured bytes', async () => {
  // A copy of a real generation at another well-formed generation hash fails the D1 identity.
  await withHarness(async (h) => {
    h.operations.behaviour = async (call) => {
      const result = await officialRender(officialArgv(call.command));
      const real = result.stdout.slice('read and follow '.length, -'/workflow.md\n'.length);
      const forged = `${posix.dirname(real)}/${'a'.repeat(20)}`;
      await writeTree(forged, await readTreeFiles(real));
      return { kind: 'exit', exitCode: 0, stdout: `read and follow ${forged}/workflow.md\n` };
    };
    halted(await h.render(), 'RENDER_ARTIFACT_MISMATCH', true);
  });
  const tamper: [string, (generation: string) => Promise<void>][] = [
    ['changed output', (g) => writeFile(join(g, 'workflow.md'), 'Changed.\n')],
    ['extra file', (g) => writeFile(join(g, 'extra.md'), 'Extra.\n')],
    ['missing output', (g) => rm(join(g, 'steps/step-01.md'))],
    [
      'symlinked output',
      async (g) => {
        await writeFile(join(g, 'elsewhere.txt'), 'Next.\n');
        await rm(join(g, 'steps/step-01.md'));
        await symlink('../elsewhere.txt', join(g, 'steps/step-01.md'));
      },
    ],
    [
      'layer changed during render',
      (_g) => writeFile(join(currentRoot, '_bmad/custom/config.toml'), 'x = "1"\n'),
    ],
  ];
  let currentRoot = '';
  for (const [label, edit] of tamper) {
    await withHarness(async (h) => {
      currentRoot = h.projectRoot;
      await mkdir(join(h.projectRoot, '_bmad/custom'), { recursive: true });
      h.operations.behaviour = async (call) => {
        const result = await officialRender(officialArgv(call.command));
        await edit(result.stdout.slice('read and follow '.length, -'/workflow.md\n'.length));
        return { kind: 'exit', ...result };
      };
      const outcome = await h.render();
      assert.equal('reason' in outcome && outcome.reason, 'RENDER_ARTIFACT_MISMATCH', label);
      halted(outcome, 'RENDER_ARTIFACT_MISMATCH', true);
    });
  }
});

async function readTreeFiles(root: string, prefix = ''): Promise<TreeFile[]> {
  const files: TreeFile[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await readTreeFiles(root, path)));
    else files.push({ path, type: 'file', mode: 0o644, body: await readFile(join(root, path)) });
  }
  return files;
}

test('render executor refuses drifted workspace inputs before reserving or spawning', async () => {
  const edits: [string, (root: string) => Promise<void>][] = [
    [
      'optional layer appeared',
      async (root) => {
        await mkdir(join(root, '_bmad/custom'), { recursive: true });
        await writeFile(join(root, '_bmad/custom/bmad-build.toml'), '# override\n');
      },
    ],
    ['required layer removed', (root) => rm(join(root, '_bmad/config.toml'))],
    ['skill source changed', (root) => writeFile(join(root, skillRoot, 'workflow.md'), 'Other.\n')],
    ['renderer changed', (root) => writeFile(join(root, '_bmad/scripts/render_skill.py'), 'other\n')],
    [
      'layer replaced by symlink',
      async (root) => {
        await rm(join(root, '_bmad/config.toml'));
        await writeFile(join(root, 'config-copy.toml'), 'project_name = "Demo"\n');
        await symlink('../config-copy.toml', join(root, '_bmad/config.toml'));
      },
    ],
    [
      'skill directory replaced by symlink',
      async (root) => {
        const { rename } = await import('node:fs/promises');
        await rename(join(root, skillRoot), join(root, 'skill-copy'));
        await symlink('../../skill-copy', join(root, skillRoot));
      },
    ],
  ];
  for (const [label, edit] of edits) {
    await withHarness(async (h) => {
      await edit(h.projectRoot);
      const outcome = await h.render();
      assert.equal('reason' in outcome && outcome.reason, 'RENDER_INPUT_MISMATCH', label);
      halted(outcome, 'RENDER_INPUT_MISMATCH');
      assert.deepEqual(h.operations.calls, [], label);
    });
  }
});

test('render executor binds the project root to the canonical workspace directory', async () => {
  await withHarness(async (h) => {
    const alias = join(h.base, 'alias');
    await symlink(h.projectRoot, alias);
    halted(await h.render({ projectRoot: alias }), 'RENDER_PROJECT_ROOT_MISMATCH');
    halted(
      await h.render({ projectRoot: join(h.base, 'workspaces', 'missing') }),
      'RENDER_PROJECT_ROOT_MISMATCH',
    );
    for (const projectRoot of [
      'workspaces/Crew S6a Project',
      `${h.projectRoot}/`,
      `${h.projectRoot}/../Crew S6a Project`,
      `${h.base}/workspaces/quote"root`,
      `${h.base}/workspaces/caf\u00e9`,
    ])
      halted(await h.render({ projectRoot }), 'RENDER_REQUEST_INVALID');
    assert.deepEqual(h.operations.calls, []);
  });
});

test('render executor requires the recorded uv bytes before spawning', async () => {
  await withHarness(async (h) => {
    halted(await h.render({}, { ...h.uv, sha256: '0'.repeat(64) }), 'RENDER_UV_UNAVAILABLE');
    halted(await h.render({}, { ...h.uv, path: join(h.base, 'bin', 'missing-uv') }), 'RENDER_UV_UNAVAILABLE');
    await mkdir(join(h.base, 'bin', 'uv-dir'));
    halted(await h.render({}, { ...h.uv, path: join(h.base, 'bin', 'uv-dir') }), 'RENDER_UV_UNAVAILABLE');
    // Bounded read: an oversized executable is refused from its size, before hashing.
    const huge = join(h.base, 'bin', 'uv-huge');
    const handle = await open(huge, 'w');
    await handle.truncate(256 * 1024 * 1024 + 1);
    await handle.close();
    halted(await h.render({}, { ...h.uv, path: huge }), 'RENDER_UV_UNAVAILABLE');
    halted(await h.render({}, { ...h.uv, path: 'uv' }), 'RENDER_REQUEST_INVALID');
    halted(await h.render({}, { ...h.uv, version: '' }), 'RENDER_REQUEST_INVALID');
    halted(await h.render({}, { ...h.uv, realpath: 'uv' }), 'RENDER_REQUEST_INVALID');
    // The recorded resolution is part of the identity: a re-pointed link is refused.
    halted(
      await h.render({}, { ...h.uv, realpath: join(h.base, 'bin', 'other-uv') }),
      'RENDER_UV_UNAVAILABLE',
    );
    assert.deepEqual(h.operations.calls, []);
  });
});

test('render executor refuses an inconsistent or unacceptable definition before spawning', async () => {
  await withHarness(async (h) => {
    halted(
      await h.render({ definition: { ...h.definition, sha256: '0'.repeat(64) } }),
      'RENDER_DEFINITION_MISMATCH',
    );
    halted(
      await h.render({ definition: { ...h.definition, customizationSha256: '0'.repeat(64) } }),
      'RENDER_DEFINITION_MISMATCH',
    );
    const crowded = structuredClone(h.definition);
    assert(crowded.render);
    for (let index = 0; index < 128; index++)
      (crowded.render.selectedProjectionSha256 as Record<string, string>)[`${skillRoot}/extra-${index}.md`] =
        '0'.repeat(64);
    halted(await h.render({ definition: crowded }), 'RENDER_DEFINITION_MISMATCH');
    assert.deepEqual(h.operations.calls, []);
  });
});

test('render executor validates attempt and operation identifiers before any effect', async () => {
  await withHarness(async (h) => {
    for (const overrides of [
      { attemptId: '' },
      { attemptId: 'not-a-uuid' },
      { operationId: '../escape' },
      { operationId: operationIds[0].toUpperCase() },
    ])
      halted(await h.render(overrides), 'RENDER_REQUEST_INVALID');
    assert.deepEqual(h.operations.calls, []);
  });
});

test('render executor refuses unpinned files beside the renderer, skill and config before spawning', async () => {
  const edits: [string, (root: string) => Promise<void>][] = [
    ['shadowing module in scripts', (root) => writeFile(join(root, '_bmad/scripts/json.py'), 'import os\n')],
    [
      'bytecode cache in scripts',
      async (root) => {
        await mkdir(join(root, '_bmad/scripts/__pycache__'));
        await writeFile(join(root, '_bmad/scripts/__pycache__/re.cpython-312.pyc'), 'x');
      },
    ],
    [
      'symlink in scripts',
      async (root) => {
        await writeFile(join(root, 'outside.py'), 'print(1)\n');
        await symlink('../../outside.py', join(root, '_bmad/scripts/typing.py'));
      },
    ],
    ['extra file in skill directory', (root) => writeFile(join(root, skillRoot, 'notes.txt'), 'x\n')],
    [
      'extra nested file in skill directory',
      (root) => writeFile(join(root, skillRoot, 'steps/helper.py'), 'x\n'),
    ],
    ['unknown file in _bmad', (root) => writeFile(join(root, '_bmad/other.toml'), 'x = 1\n')],
    ['unknown directory in _bmad', (root) => mkdir(join(root, '_bmad/core'))],
    [
      'unknown file in _bmad/custom',
      async (root) => {
        await mkdir(join(root, '_bmad/custom'));
        await writeFile(join(root, '_bmad/custom/.gitignore'), '*\n');
      },
    ],
    [
      'render directory is a symlink',
      async (root) => {
        await mkdir(join(root, 'elsewhere'));
        await symlink('../elsewhere', join(root, '_bmad/render'));
      },
    ],
  ];
  for (const [label, edit] of edits) {
    await withHarness(async (h) => {
      await edit(h.projectRoot);
      const outcome = await h.render();
      assert.equal('reason' in outcome && outcome.reason, 'RENDER_INPUT_MISMATCH', label);
      assert.deepEqual(h.operations.calls, [], label);
    });
  }
});

test('render executor refuses unpinned files that appear beside the renderer during the render', async () => {
  for (const relative of ['_bmad/scripts/json.py', `${skillRoot}/extra.txt`, '_bmad/extra.toml']) {
    await withHarness(async (h) => {
      h.operations.behaviour = async (call) => {
        const result = await officialRender(officialArgv(call.command));
        await writeFile(join(h.projectRoot, relative), 'x\n');
        return { kind: 'exit', ...result };
      };
      halted(await h.render(), 'RENDER_ARTIFACT_MISMATCH', true);
    });
  }
});

test('render executor tells owned-operation lock contention apart from operation reuse', async () => {
  await withHarness(async (h) => {
    h.operations.busy = true;
    halted(await h.render({ operationId: operationIds[2] }), 'RENDER_OPERATION_BUSY');
    h.operations.busy = false;
    assert('receipt' in (await h.render({ operationId: operationIds[2] })));
    halted(await h.render({ operationId: operationIds[2] }), 'RENDER_OPERATION_REUSED');
    assert.equal(h.operations.executions.length, 1);
  });
});

test('render executor returns the log digest and a sanitized first line when a run halts', async () => {
  await withHarness(async (h) => {
    const stdout =
      `HALT: config missing at ${h.projectRoot}/_bmad/config.toml HOME=/Users/owner/secret ` +
      `seen /Users/owner/.ssh/id_ed25519 caf\u00e9 ${'x'.repeat(400)}\nsecond line /Users/owner\n`;
    h.operations.behaviour = async () => ({ kind: 'exit', exitCode: 1, stdout });
    const outcome = await h.render();
    halted(outcome, 'RENDER_EXIT_NONZERO', true);
    assert('log' in outcome && outcome.log);
    assert.equal(outcome.log.sha256, sha256(stdout));
    assert.equal(
      outcome.log.firstLine,
      `HALT: config missing at {project-root}/_bmad/config.toml HOME={redacted} seen {path} caf? ${'x'.repeat(400)}`.slice(
        0,
        256,
      ),
    );
    assert.doesNotMatch(outcome.log.firstLine, /Users|owner|secret|second/);
    assert.equal(outcome.log.lastLine, 'second line {path}');
  });
  await withHarness(async (h) => {
    h.operations.behaviour = async () => ({ kind: 'fork' });
    const outcome = await h.render();
    halted(outcome, 'RENDER_LIFETIME_UNKNOWN', true);
    assert.deepEqual('log' in outcome && outcome.log, { sha256: sha256(''), firstLine: '', lastLine: '' });
  });
});

test('render executor accepts a symlinked uv by hashing and running the resolved executable', async () => {
  await withHarness(async (h) => {
    const link = join(h.base, 'bin', 'uv-link');
    await symlink(h.uv.path, link);
    const outcome = await h.render({}, { ...h.uv, path: link });
    assert('receipt' in outcome, JSON.stringify(outcome));
    assert.equal(outcome.receipt.data.witness.uvPath, link);
    assert.deepEqual(outcome.receipt.data.witness.argv, expectedArgv(h.projectRoot, h.uv.realpath));
    assert.deepEqual(
      h.operations.executions[0].command.slice(-8),
      expectedArgv(h.projectRoot, h.uv.realpath),
    );
  });
});

test('render executor requires a canonical owned-operation root before reserving a stage', async () => {
  await withHarness(async (h) => {
    const alias = join(h.base, 'ops-alias');
    await symlink(h.operations.root, alias);
    const operations = new FakeOperations(alias, officialChild);
    const outcome = await createRenderExecutor({
      operations,
      journal: h.journal,
      prerequisites: { uv: h.uv, python: h.python },
      clock: () => new Date(),
    }).render({
      definition: structuredClone(h.definition),
      projectRoot: h.projectRoot,
      attemptId,
      operationId: operationIds[0],
    });
    halted(outcome, 'RENDER_OPERATION_UNAVAILABLE');
    assert.deepEqual(operations.calls, []);
  });
});

test('render executor removes bracketed and home paths and credential values from the halt line', async () => {
  await withHarness(async (h) => {
    const line =
      'error: Failed to inspect `/Users/owner/.local/share/uv/python/cpython-3.12` [/opt/homebrew/bin/uv] ' +
      `<~/cfg/uv.toml> {/tmp/x} (~owner/y) at ${h.projectRoot}/_bmad/config.toml Authorization: Bearer abc.def ` +
      'token: s3cr3t api_key=XYZ password = hunter2 Secret:"q w" done';
    h.operations.behaviour = async () => ({ kind: 'exit', exitCode: 2, stdout: `${line}\n` });
    const outcome = await h.render();
    halted(outcome, 'RENDER_EXIT_NONZERO', true);
    assert('log' in outcome && outcome.log);
    assert.equal(
      outcome.log.firstLine,
      'error: Failed to inspect `{path}` [{path}] <{path}> {{path}} ({path}) at {project-root}/_bmad/config.toml ' +
        'Authorization: Bearer {redacted} token: {redacted} api_key={redacted} password = {redacted} ' +
        'Secret:{redacted} done',
    );
    assert.doesNotMatch(outcome.log.firstLine, /Users|owner|homebrew|abc\.def|s3cr3t|XYZ|hunter2|q w/);
  });
});

test('render executor detects a file added and removed beside the renderer during the render', async () => {
  const places = ['_bmad/scripts', `${skillRoot}/steps`, skillRoot, '_bmad'];
  for (const place of places) {
    await withHarness(async (h) => {
      h.operations.behaviour = async (call) => {
        const result = await officialRender(officialArgv(call.command));
        const transient = join(h.projectRoot, place, 'json.py');
        await writeFile(transient, 'import os\n');
        await rm(transient);
        return { kind: 'exit', ...result };
      };
      const outcome = await h.render();
      assert.equal('reason' in outcome && outcome.reason, 'RENDER_ARTIFACT_MISMATCH', place);
    });
  }
  await withHarness(async (h) => {
    h.operations.behaviour = async (call) => {
      const result = await officialRender(officialArgv(call.command));
      await mkdir(join(h.projectRoot, '_bmad/custom'));
      await rm(join(h.projectRoot, '_bmad/custom'), { recursive: true });
      return { kind: 'exit', ...result };
    };
    const outcome = await h.render();
    assert.equal('reason' in outcome && outcome.reason, 'RENDER_ARTIFACT_MISMATCH', 'custom appeared');
  });
});

test('render executor pins the recorded Python through UV_PYTHON and refuses other interpreter bytes', async () => {
  await withHarness(async (h) => {
    const cases: [ExecutableIdentity, string][] = [
      [{ ...h.python, sha256: '0'.repeat(64) }, 'RENDER_PYTHON_UNAVAILABLE'],
      [{ ...h.python, path: join(h.base, 'bin', 'missing-python') }, 'RENDER_PYTHON_UNAVAILABLE'],
      // The link now resolves somewhere else than the install report measured.
      [{ ...h.python, realpath: join(h.base, 'cellar', 'python3.12') }, 'RENDER_PYTHON_UNAVAILABLE'],
      [{ ...h.python, path: 'python3' }, 'RENDER_REQUEST_INVALID'],
      [{ ...h.python, realpath: 'relative/python' }, 'RENDER_REQUEST_INVALID'],
      [{ ...h.python, version: '' }, 'RENDER_REQUEST_INVALID'],
      [{ ...h.python, sha256: 'not-a-digest' }, 'RENDER_REQUEST_INVALID'],
    ];
    for (const [python, reason] of cases) halted(await h.render({}, h.uv, python), reason);
    assert.deepEqual(h.operations.calls, []);
    assert.deepEqual(h.journal.updates, []);
    const outcome = await h.render();
    assert('receipt' in outcome, JSON.stringify(outcome));
    assert(h.operations.executions[0].command.includes(`UV_PYTHON=${h.python.realpath}`));
  });
});

test('render executor records every stage transition durably and frees the session leader record', async () => {
  await withHarness(async (h) => {
    const outcome = await h.render();
    assert('receipt' in outcome, JSON.stringify(outcome));
    assert.deepEqual(h.journal.states(), ['reserved', 'pending', 'complete', 'deleted']);
    assert(h.journal.updates.every(([id]) => id === operationIds[0]));
    const [, pending] = h.journal.updates[1];
    const [, complete] = h.journal.updates[2];
    assert.equal(pending.stageIdentity?.kind, 'directory');
    assert.equal(complete.leader, leaderLine.trim());
    assert.equal(complete.receipt?.mode, 'tree');
    assert.equal(complete.receipt?.forkObserved, true);
    assert.equal(complete.error, null);
  });
});

test('render executor keeps the stage, leader record and an unknown record when closure is unproven', async () => {
  for (const [kind, reason] of [
    ['fork', 'RENDER_LIFETIME_UNKNOWN'],
    ['helper-failure', 'RENDER_OPERATION_UNAVAILABLE'],
  ] as const) {
    await withHarness(async (h) => {
      h.operations.behaviour = async () => ({ kind });
      const outcome = await h.render();
      assert.equal('reason' in outcome && outcome.reason, reason, kind);
      assert.deepEqual(h.journal.states(), ['reserved', 'pending', 'unknown'], kind);
      const [, unknown] = h.journal.updates[2];
      assert.equal(unknown.leader, leaderLine.trim(), kind);
      assert.match(unknown.error ?? '', /^EXECUTOR_/, kind);
      const name = `render-${operationIds[0]}`;
      assert(await lstat(join(h.operations.root, 'stages', name)), kind);
      assert(await lstat(join(h.operations.root, 'receipts', `${name}.leader`)), kind);
      assert(!h.operations.calls.some((call) => call.startsWith('remove:')), kind);
    });
  }
});

test('render executor reclaims the stage and keeps nothing when the executor never started the child', async () => {
  for (const [kind, reason] of [
    ['busy', 'RENDER_OPERATION_BUSY'],
    ['guard-invalid', 'RENDER_OPERATION_GUARD_INVALID'],
  ] as const) {
    await withHarness(async (h) => {
      h.operations.behaviour = async () => ({ kind });
      halted(await h.render(), reason);
      const name = `render-${operationIds[0]}`;
      assert.equal(await lstat(join(h.operations.root, 'stages', name)).catch(() => null), null, kind);
      assert.equal(
        await lstat(join(h.operations.root, 'receipts', `${name}.leader`)).catch(() => null),
        null,
      );
      assert.deepEqual(h.journal.states(), ['reserved', 'pending', 'complete', 'deleted'], kind);
      const [, complete] = h.journal.updates[2];
      assert.equal(complete.receipt, null, kind);
      assert.equal(complete.leader, null, kind);
    });
  }
  await withHarness(async (h) => {
    // The guard check fails before anything is reserved as well.
    h.operations.absent = async () => {
      throw helperExit(24);
    };
    halted(await h.render(), 'RENDER_OPERATION_GUARD_INVALID');
    assert.deepEqual(h.journal.updates, []);
  });
});

test('render executor refuses a run whose session leader record already exists', async () => {
  await withHarness(async (h) => {
    // A crash between writing the leader record and starting the child leaves only that record.
    await writeFile(join(h.operations.root, 'receipts', `render-${operationIds[0]}.leader`), leaderLine, {
      mode: 0o600,
    });
    halted(await h.render(), 'RENDER_OPERATION_REUSED');
    assert(!h.operations.calls.some((call) => call.startsWith('create:')));
    assert.deepEqual(h.journal.updates, []);
  });
});

test('render executor refuses new renders while an earlier render stage awaits reconciliation', async () => {
  await withHarness(async (h) => {
    h.journal.reconcileRequired = true;
    halted(await h.render(), 'RENDER_RECONCILE_REQUIRED');
    assert.deepEqual(h.operations.calls, []);
    assert.deepEqual(h.journal.updates, []);
    h.journal.reconcileRequired = false;
    assert('receipt' in (await h.render()));
  });
});

test('render executor halts without spawning when the durable stage record cannot be written', async () => {
  await withHarness(async (h) => {
    const record = h.journal.record.bind(h.journal);
    h.journal.record = async (id, update) => {
      if (update.state === 'pending') throw new Error('disk full');
      await record(id, update);
    };
    halted(await h.render(), 'RENDER_OPERATION_UNAVAILABLE');
    assert.deepEqual(h.operations.executions, []);
    // Nothing ran, so the reserved stage is reclaimed rather than retained.
    assert.equal(
      await lstat(join(h.operations.root, 'stages', `render-${operationIds[0]}`)).catch(() => null),
      null,
    );
  });
});

test('render executor returns the last non-empty log line, skipping blank lines at either end', async () => {
  await withHarness(async (h) => {
    const stdout =
      '\n\n  \nTraceback (most recent call last):\n' +
      `  File "${h.projectRoot}/_bmad/scripts/render_skill.py", line 9, in <module>\n` +
      "KeyError: 'project_name'\n\n   \n";
    h.operations.behaviour = async () => ({ kind: 'exit', exitCode: 1, stdout });
    const outcome = await h.render();
    halted(outcome, 'RENDER_EXIT_NONZERO', true);
    assert('log' in outcome && outcome.log);
    assert.equal(outcome.log.firstLine, 'Traceback (most recent call last):');
    // Exception names that merely contain "key" are diagnostics, not credentials.
    assert.equal(outcome.log.lastLine, "KeyError: 'project_name'");
  });
  await withHarness(async (h) => {
    // A last line longer than the tail window is never returned as a fragment of its middle.
    const stdout = `first\napi_key=${'s'.repeat(9000)}`;
    h.operations.behaviour = async () => ({ kind: 'exit', exitCode: 1, stdout });
    const outcome = await h.render();
    assert('log' in outcome && outcome.log);
    assert.equal(outcome.log.firstLine, 'first');
    assert.equal(outcome.log.lastLine, '');
  });
});

test('render executor redacts credentials that follow a known path in a halt line', async () => {
  await withHarness(async (h) => {
    const line =
      `fetch ${h.projectRoot}/_bmad/render?token=abc123&x=1 then ${h.uv.path}?secret=zzz ` +
      'keyword stays, apiKey: k1 ACCESS_KEY=k2 ssh-key k3 monkey: banana';
    h.operations.behaviour = async () => ({ kind: 'exit', exitCode: 2, stdout: `${line}\n` });
    const outcome = await h.render();
    assert('log' in outcome && outcome.log);
    assert.equal(
      outcome.log.firstLine,
      'fetch {project-root}/_bmad/render?token={redacted} then {uv}?secret={redacted} ' +
        'keyword stays, apiKey: {redacted} ACCESS_KEY={redacted} ssh-key k3 monkey: banana',
    );
    assert.doesNotMatch(outcome.log.firstLine, /abc123|zzz|k1|k2/);
  });
});

test('render executor detects a closure file rewritten and restored during the render', async () => {
  const places = ['_bmad/config.toml', '_bmad/scripts/config_utils.py', `${skillRoot}/steps/step-01.md`];
  for (const place of places) {
    await withHarness(async (h) => {
      h.operations.behaviour = async (call) => {
        const result = await officialRender(officialArgv(call.command));
        const path = join(h.projectRoot, place);
        const original = await readFile(path);
        await writeFile(path, 'import os\n');
        await writeFile(path, original);
        return { kind: 'exit', ...result };
      };
      const outcome = await h.render();
      assert.equal('reason' in outcome && outcome.reason, 'RENDER_ARTIFACT_MISMATCH', place);
    });
  }
  // An entry added and removed in the project root, `.claude` or `.claude/skills` is seen as well.
  for (const place of ['', '.claude', '.claude/skills']) {
    await withHarness(async (h) => {
      h.operations.behaviour = async (call) => {
        const result = await officialRender(officialArgv(call.command));
        const transient = join(h.projectRoot, place, 'sitecustomize.py');
        await writeFile(transient, 'import os\n');
        await rm(transient);
        return { kind: 'exit', ...result };
      };
      const outcome = await h.render();
      assert.equal('reason' in outcome && outcome.reason, 'RENDER_ARTIFACT_MISMATCH', place || 'root');
    });
  }
});
