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
  type RenderOperations,
  type RenderOutcome,
  type RenderRequest,
  type UvIdentity,
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

// Python json.dumps(ensure_ascii=False, sort_keys=True, separators=(",", ":")) for string trees.
function pythonCanonical(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${pythonCanonical(record[key])}`)
    .join(',')}}`;
}

async function markdownSources(directory: string, prefix = ''): Promise<Record<string, Buffer>> {
  const found: Record<string, Buffer> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(found, await markdownSources(join(directory, entry.name), name));
    else if (entry.name.endsWith('.md') && name !== 'SKILL.md')
      found[name] = await readFile(join(directory, entry.name));
  }
  return found;
}

type RendererOutcome = { exitCode: number; stdout: string };

/**
 * Behaviour of `_bmad/scripts/render_skill.py` for token-free sources: identity from the absolute
 * project root, renderer bytes and source hashes; publish `{root}/_bmad/render/{skill}/{slug}-{root12}/{gen20}`;
 * an existing generation is compared byte-for-byte and never overwritten; prints the entry path.
 */
async function officialRender(argv: string[]): Promise<RendererOutcome> {
  const projectRoot = argv[argv.indexOf('--project-root') + 1];
  const skill = argv[argv.indexOf('--skill') + 1];
  const sources = await markdownSources(skill);
  if (!sources['workflow.md']) return { exitCode: 1, stdout: 'HALT: workflow.md missing\n' };
  const sourceSha256 = Object.fromEntries(
    Object.entries(sources).map(([name, body]) => [name, sha256(body)]),
  );
  const identity = {
    project_root: projectRoot,
    renderer_sha256: sha256(await readFile(join(projectRoot, '_bmad/scripts/render_skill.py'))),
    resolved_values: {},
    source_sha256: sourceSha256,
  };
  const rootHash = sha256(projectRoot).slice(0, 12);
  const slug = posix
    .basename(projectRoot)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const generationHash = sha256(pythonCanonical(identity)).slice(0, 20);
  const destination = `${projectRoot}/_bmad/render/${posix.basename(skill)}/${slug}-${rootHash}/${generationHash}`;
  const outputs: Record<string, Buffer> = { ...sources };
  const manifestBytes = Buffer.from(
    `${JSON.stringify(
      {
        schema_version: 1,
        skill: posix.basename(skill),
        project_root: projectRoot,
        project_slug: slug,
        root_hash: rootHash,
        generation_hash: generationHash,
        inputs: identity,
        outputs: sourceSha256,
      },
      null,
      2,
    )}\n`,
  );
  const published = { ...outputs, 'manifest.json': manifestBytes };
  const existing = await lstat(destination).catch(() => null);
  if (existing) {
    for (const [name, body] of Object.entries(published)) {
      const current = await readFile(join(destination, name)).catch(() => null);
      if (!current?.equals(body)) return { exitCode: 1, stdout: `HALT: ${destination} differs\n` };
    }
  } else {
    for (const [name, body] of Object.entries(published)) {
      await mkdir(posix.dirname(join(destination, name)), { recursive: true });
      await writeFile(join(destination, name), body, { flag: 'wx' });
    }
  }
  return { exitCode: 0, stdout: `read and follow ${destination}/workflow.md\n` };
}

type ChildResult =
  | { kind: 'exit'; exitCode: number; stdout: string }
  | { kind: 'timeout' }
  | { kind: 'fork' }
  | { kind: 'helper-failure' };
type ExecuteCall = { id: string; cwd: string; command: string[]; timeoutSeconds: number; policy: string };

/**
 * Test double of `OwnedOperations` mirroring the reviewed primitive's contract:
 * `absent` throws when the name exists under the owned parent; `create` makes a private,
 * exclusive `stages/{id}` and returns its identity; `execute` requires that exact stage identity,
 * a timeout of 1–120 s and an absolute command, sends merged stdout/stderr to
 * `stages/{id}/execution.log` (O_EXCL), writes one exclusive receipt `receipts/{id}.json`, throws
 * `EXECUTOR_LIFETIME_UNKNOWN` when a fork is observed and `EXECUTOR_RECEIPT_MISSING` when the helper
 * fails; a timeout is a receipt with `timedOut` and signal exit code; `remove` deletes only that
 * stage identity. The child itself is the scripted `behaviour`, never a real process.
 */
class FakeOperations implements RenderOperations {
  readonly root: string;
  readonly calls: string[] = [];
  readonly executions: ExecuteCall[] = [];
  behaviour: (call: ExecuteCall) => Promise<ChildResult>;
  constructor(root: string, behaviour: (call: ExecuteCall) => Promise<ChildResult>) {
    this.root = root;
    this.behaviour = behaviour;
  }
  async absent(parent: 'stages' | 'sources' | 'projections' | 'quarantine' | 'receipts', id: string) {
    this.calls.push(`absent:${parent}:${id}`);
    if (await lstat(join(this.root, parent, id)).catch(() => null))
      throw new Error('OPERATION_HELPER_FAILED');
  }
  async create(id: string): Promise<OwnedIdentity> {
    this.calls.push(`create:${id}`);
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
  async execute(
    id: string,
    object: OwnedIdentity,
    cwd: string,
    command: string[],
    timeoutSeconds = 90,
  ): Promise<ExecutionReceipt> {
    this.calls.push(`execute:${id}`);
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
      treeEmpty: result.kind !== 'fork',
      forkObserved: result.kind === 'fork',
      exitCode: result.kind === 'exit' ? result.exitCode : 137,
      timedOut: result.kind === 'timeout',
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

type Harness = {
  base: string;
  projectRoot: string;
  definition: WorkflowDefinition;
  operations: FakeOperations;
  uv: UvIdentity;
  times: string[];
  render(overrides?: Partial<RenderRequest>, uv?: UvIdentity): Promise<RenderOutcome>;
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
    const uv: UvIdentity = { path: uvPath, sha256: sha256('uv 0.9.0 test bytes\n'), version: 'uv 0.9.0' };
    const operations = new FakeOperations(join(base, 'ops'), officialChild);
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
      uv,
      times,
      render: (overrides = {}, override = uv) =>
        createRenderExecutor({ operations, uv: override, clock }).render({
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

function halted(outcome: RenderOutcome, reason: string): void {
  assert.deepEqual(outcome, { halt: true, reason });
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
    const argv = expectedArgv(h.projectRoot, h.uv.path);
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
      `absent:stages:render-${operationIds[0]}`,
      `create:render-${operationIds[0]}`,
      `execute:render-${operationIds[0]}`,
      `remove:stages:render-${operationIds[0]}`,
    ]);
    assert.equal(await lstat(stage).catch(() => null), null);

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
  const cases: [ChildResult, string, boolean][] = [
    [{ kind: 'exit', exitCode: 1, stdout: 'HALT: config missing\n' }, 'RENDER_EXIT_NONZERO', true],
    [{ kind: 'exit', exitCode: 2, stdout: '' }, 'RENDER_EXIT_NONZERO', true],
    [{ kind: 'exit', exitCode: 127, stdout: '' }, 'RENDER_UV_UNAVAILABLE', true],
    [{ kind: 'timeout' }, 'RENDER_TIMED_OUT', true],
    [{ kind: 'fork' }, 'RENDER_LIFETIME_UNKNOWN', false],
    [{ kind: 'helper-failure' }, 'RENDER_OPERATION_UNAVAILABLE', false],
  ];
  for (const [result, reason, reclaimed] of cases) {
    await withHarness(async (h) => {
      h.operations.behaviour = async () => result;
      halted(await h.render(), reason);
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
      halted(await h.render(), 'RENDER_STDOUT_MISMATCH');
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
    halted(await h.render(), 'RENDER_ARTIFACT_MISMATCH');
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
      assert.deepEqual(outcome, { halt: true, reason: 'RENDER_ARTIFACT_MISMATCH' }, label);
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
      assert.deepEqual(outcome, { halt: true, reason: 'RENDER_INPUT_MISMATCH' }, label);
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
    await symlink(h.uv.path, join(h.base, 'bin', 'uv-link'));
    halted(await h.render({}, { ...h.uv, path: join(h.base, 'bin', 'uv-link') }), 'RENDER_UV_UNAVAILABLE');
    halted(await h.render({}, { ...h.uv, path: 'uv' }), 'RENDER_REQUEST_INVALID');
    halted(await h.render({}, { ...h.uv, version: '' }), 'RENDER_REQUEST_INVALID');
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
