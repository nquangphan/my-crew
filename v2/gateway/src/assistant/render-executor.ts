import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { canonicalJson, hash } from '../journal/atomic-records.ts';
import type { ExecutionReceipt, OwnedIdentity, OwnedOperations } from '../workflows/operations.ts';
import {
  createBmadArtifactInspector,
  type RenderArtifactInspection,
  type RenderLayerPath,
  validateRenderDefinition,
} from './render-artifacts.ts';
import { customizationContext, type RenderDefinition, type WorkflowDefinition } from './workflow-manifest.ts';

export type UvIdentity = { path: string; sha256: string; version: string };
export type RenderOperations = Pick<OwnedOperations, 'root' | 'absent' | 'create' | 'execute' | 'remove'>;
export type RenderExecutorOptions = {
  operations: RenderOperations;
  /** Owner-installed `uv` identity as recorded by the install report; bytes are re-hashed per render. */
  uv: UvIdentity;
  clock: () => Date;
  /** Wall-clock bound enforced by the owned executor, 1–120 s. */
  timeoutSeconds?: number;
};
export type RenderRequest = {
  definition: WorkflowDefinition;
  projectRoot: string;
  attemptId: string;
  operationId: string;
};
export type RenderWitness = {
  uvPath: string;
  uvSha256: string;
  uvVersion: string;
  argv: string[];
  exitCode: number;
  stdoutPath: string;
  startedAt: string;
  endedAt: string;
  operationId: string;
};
export type WorkflowRenderReceipt = {
  kind: 'workflow_render_receipt';
  attemptId: string;
  data: {
    definitionSha256: string;
    customizationSha256: string;
    projectRoot: string;
    generationPath: string;
    inspection: RenderArtifactInspection;
    witness: RenderWitness;
  };
};
export type RenderHaltReason =
  | 'RENDER_NOT_BMAD'
  | 'RENDER_REQUEST_INVALID'
  | 'RENDER_DEFINITION_MISMATCH'
  | 'RENDER_PROJECT_ROOT_MISMATCH'
  | 'RENDER_INPUT_MISMATCH'
  | 'RENDER_UV_UNAVAILABLE'
  | 'RENDER_OPERATION_REUSED'
  | 'RENDER_OPERATION_UNAVAILABLE'
  | 'RENDER_LIFETIME_UNKNOWN'
  | 'RENDER_TIMED_OUT'
  | 'RENDER_EXIT_NONZERO'
  | 'RENDER_STDOUT_MISMATCH'
  | 'RENDER_ARTIFACT_MISMATCH'
  | 'RENDER_CLEANUP_FAILED'
  | 'RENDER_UNEXPECTED_FAILURE';
export type RenderOutcome = { receipt: WorkflowRenderReceipt } | { halt: true; reason: RenderHaltReason };

const skillRoot = '.claude/skills/bmad-build';
const rendererPath = '_bmad/scripts/render_skill.py';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const entryPrefix = 'read and follow ';
const entrySuffix = '/workflow.md';
// Per-file and per-snapshot read bounds match the artifact inspector, which re-applies them.
const maxFileBytes = 16 * 1024 * 1024;
const maxSnapshotBytes = 32 * 1024 * 1024;
const maxLogBytes = 64 * 1024;
const maxGenerationEntries = 512;
const maxGenerationDepth = 32;

class RenderHalt extends Error {
  readonly reason: RenderHaltReason;
  constructor(reason: RenderHaltReason) {
    super(reason);
    this.reason = reason;
  }
}

function halt(reason: RenderHaltReason): never {
  throw new RenderHalt(reason);
}

async function guard<T>(reason: RenderHaltReason, work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RenderHalt) throw error;
    halt(reason);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

/** Absolute, normalized, well-formed and printable: safe to quote in a sandbox profile and argv. */
function lexicalPath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length < 2 ||
    value.length > 4096 ||
    !value.isWellFormed() ||
    !posix.isAbsolute(value) ||
    posix.normalize(value) !== value ||
    value.endsWith('/')
  )
    return false;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127 || character === '"' || character === '\\') return false;
  }
  return true;
}

/** Official renderer slug of the project directory name; the inspector refuses non-ASCII names. */
function projectSlug(projectRoot: string): string | null {
  const baseName = posix.basename(projectRoot);
  if (![...baseName].every((character) => /^[\x20-\x7e]$/.test(character))) return null;
  const cleaned =
    baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project';
  return cleaned.slice(0, 80).replace(/-$/g, '') || 'project';
}

type Budget = { remaining: number };

/**
 * Reads `root/relative` without following any symlink on the way: every parent is a real directory
 * and the file is a single-link regular file within `maxBytes`. Returns null when it is absent.
 */
async function readContained(
  root: string,
  relative: string,
  maxBytes: number,
  budget: Budget,
): Promise<Buffer | null> {
  const parts = relative.split('/');
  for (let index = 1; index < parts.length; index++) {
    const parent = await lstat(join(root, ...parts.slice(0, index))).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (parent === null) return null;
    if (!parent.isDirectory()) throw new Error('RENDER_PATH_NOT_CONTAINED');
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      join(root, relative),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes || stat.size > budget.remaining)
      throw new Error('RENDER_PATH_NOT_CONTAINED');
    // One spare byte detects growth after stat without reading an unbounded file.
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > stat.size) throw new Error('RENDER_PATH_NOT_CONTAINED');
    }
    if (length !== stat.size) throw new Error('RENDER_PATH_NOT_CONTAINED');
    budget.remaining -= length;
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

type InputBytes = {
  projectedFiles: Record<string, Buffer>;
  layerFiles: Record<RenderLayerPath, Buffer | null>;
  sizes: Record<string, number>;
};

async function readInputs(
  projectRoot: string,
  render: RenderDefinition,
  budget: Budget,
): Promise<InputBytes> {
  const projectedFiles: Record<string, Buffer> = {};
  const sizes: Record<string, number> = {};
  for (const path of Object.keys(render.selectedProjectionSha256)) {
    const bytes = await readContained(projectRoot, path, maxFileBytes, budget);
    if (bytes === null) throw new Error('RENDER_INPUT_ABSENT');
    projectedFiles[path] = bytes;
    sizes[path] = bytes.length;
  }
  const layerFiles = {} as Record<RenderLayerPath, Buffer | null>;
  for (const path of Object.keys(render.layers) as RenderLayerPath[]) {
    const bytes = Object.hasOwn(projectedFiles, path)
      ? projectedFiles[path]
      : await readContained(projectRoot, path, maxFileBytes, budget);
    layerFiles[path] = bytes;
    if (bytes !== null) sizes[path] = bytes.length;
  }
  return { projectedFiles, layerFiles, sizes };
}

function inputsMatch(render: RenderDefinition, inputs: InputBytes): boolean {
  for (const [path, expected] of Object.entries(render.selectedProjectionSha256))
    if (hash(inputs.projectedFiles[path]) !== expected) return false;
  for (const [path, expected] of Object.entries(render.layers) as [RenderLayerPath, string | null][]) {
    const bytes = inputs.layerFiles[path];
    if ((bytes === null ? null : hash(bytes)) !== expected) return false;
  }
  return true;
}

/** Skill-relative output names the official renderer derives: every selected `.md` except SKILL.md. */
function outputNames(render: RenderDefinition): string[] {
  return Object.keys(render.selectedProjectionSha256)
    .filter((path) => path.startsWith(`${skillRoot}/`) && path.endsWith('.md'))
    .map((path) => path.slice(skillRoot.length + 1))
    .filter((name) => posix.basename(name) !== 'SKILL.md');
}

async function listGeneration(
  generation: string,
  prefix: string,
  depth: number,
  found: string[],
): Promise<void> {
  if (depth > maxGenerationDepth) throw new Error('RENDER_GENERATION_SHAPE');
  for (const entry of await readdir(join(generation, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (found.length >= maxGenerationEntries) throw new Error('RENDER_GENERATION_SHAPE');
    if (entry.isDirectory()) await listGeneration(generation, relative, depth + 1, found);
    else if (entry.isFile()) found.push(relative);
    else throw new Error('RENDER_GENERATION_SHAPE');
  }
}

function policy(stage: string, projectRoot: string): string {
  // The renderer runs as uv's child Python; process creation stays allowed and is bounded by the
  // owned executor, while every network operation and any write outside the stage or the render
  // destination is denied.
  return `(version 1) (allow default)
(deny network*)
(deny file-write*)
(allow file-write* (subpath ${JSON.stringify(stage)}) (subpath ${JSON.stringify(`${projectRoot}/_bmad/render`)}) (literal "/dev/null"))
`;
}

/**
 * Runs the official BMAD renderer once for one attempt's workspace and measures what it produced.
 * Positive output is only a receipt object to be registered by the caller; any doubt halts.
 */
export function createRenderExecutor(options: RenderExecutorOptions): {
  render(request: RenderRequest): Promise<RenderOutcome>;
} {
  const { operations, clock } = options;
  const uv = { ...options.uv };
  const timeoutSeconds = options.timeoutSeconds ?? 60;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 120)
    throw new Error('RENDER_EXECUTOR_TIMEOUT_INVALID');

  async function produce(request: RenderRequest): Promise<WorkflowRenderReceipt> {
    const definition = request.definition;
    if (!isPlainRecord(definition) || definition.render === undefined) halt('RENDER_NOT_BMAD');
    if (
      !isPlainRecord(definition.render) ||
      (definition.render.source as { name?: unknown })?.name !== 'bmad'
    )
      halt('RENDER_NOT_BMAD');
    const { attemptId, operationId, projectRoot } = request;
    if (
      typeof attemptId !== 'string' ||
      !uuid.test(attemptId) ||
      typeof operationId !== 'string' ||
      !uuid.test(operationId) ||
      !lexicalPath(projectRoot) ||
      !lexicalPath(uv.path) ||
      typeof uv.sha256 !== 'string' ||
      !digest.test(uv.sha256) ||
      typeof uv.version !== 'string' ||
      !/^[\x20-\x7e]{1,128}$/.test(uv.version)
    )
      halt('RENDER_REQUEST_INVALID');
    const slug = projectSlug(projectRoot);
    if (slug === null) halt('RENDER_REQUEST_INVALID');

    // Snapshot the definition and prove it is the exact one its digests name.
    const { render, definitionSha256, customizationSha256 } = await guard(
      'RENDER_DEFINITION_MISMATCH',
      () => {
        const snapshot = structuredClone({
          sha256: definition.sha256,
          skills: definition.skills,
          customizationSha256: definition.customizationSha256,
          render: definition.render,
        }) as Required<WorkflowDefinition>;
        validateRenderDefinition(snapshot.render);
        const customization = customizationContext(
          snapshot.render.source,
          snapshot.render.projection,
          snapshot.render.layers,
        ).sha256;
        // Same digest formula as the workflow-manifest adapter that issued the definition.
        const recomputed = hash(
          canonicalJson({
            source: snapshot.render.source,
            projection: snapshot.render.projection,
            skills: snapshot.skills,
            customizationSha256: customization,
            render: snapshot.render,
          }),
        );
        if (customization !== snapshot.customizationSha256 || recomputed !== snapshot.sha256)
          throw new Error('RENDER_DEFINITION_DIGEST');
        return {
          render: snapshot.render,
          definitionSha256: snapshot.sha256,
          customizationSha256: snapshot.customizationSha256,
        };
      },
    );

    // `{project-root}` must be the canonical workspace directory the runtime will use.
    await guard('RENDER_PROJECT_ROOT_MISMATCH', async () => {
      const stat = await lstat(projectRoot);
      if (!stat.isDirectory() || (await realpath(projectRoot)) !== projectRoot)
        throw new Error('RENDER_PROJECT_ROOT');
    });

    // Refuse drifted inputs before reserving anything or spawning.
    await guard('RENDER_INPUT_MISMATCH', async () => {
      const inputs = await readInputs(projectRoot, render, { remaining: maxSnapshotBytes });
      validateRenderDefinition(render, inputs.sizes);
      if (!inputsMatch(render, inputs)) throw new Error('RENDER_INPUT_DRIFT');
    });

    await guard('RENDER_UV_UNAVAILABLE', async () => {
      const stat = await lstat(uv.path);
      if (!stat.isFile() || hash(await readFile(uv.path)) !== uv.sha256)
        throw new Error('RENDER_UV_IDENTITY');
    });

    const argv = [
      uv.path,
      'run',
      '--no-cache',
      `${projectRoot}/${rendererPath}`,
      '--project-root',
      projectRoot,
      '--skill',
      `${projectRoot}/${skillRoot}`,
    ];
    const stageName = `render-${operationId}`;
    const stage = join(operations.root, 'stages', stageName);
    await guard('RENDER_OPERATION_REUSED', async () => {
      await operations.absent('receipts', `${stageName}.json`);
      await operations.absent('stages', stageName);
    });
    const identity: OwnedIdentity = await guard('RENDER_OPERATION_UNAVAILABLE', () =>
      operations.create(stageName),
    );
    const reclaim = () => operations.remove('stages', stageName, identity);
    const policyPath = join(stage, 'render.sb');
    try {
      // The owned executor points HOME/XDG/TMPDIR inside its working directory: the stage.
      for (const name of ['home', 'tmp']) await mkdir(join(stage, name), { mode: 0o700 });
      await writeFile(policyPath, policy(stage, projectRoot), { flag: 'wx', mode: 0o600 });
    } catch {
      await reclaim().catch(() => undefined);
      halt('RENDER_OPERATION_UNAVAILABLE');
    }

    const startedAt = clock().toISOString();
    let receipt: ExecutionReceipt;
    try {
      receipt = await operations.execute(
        stageName,
        identity,
        stage,
        [
          '/usr/bin/env',
          'UV_OFFLINE=1',
          'UV_NO_CONFIG=1',
          'UV_PYTHON_DOWNLOADS=never',
          'PYTHONDONTWRITEBYTECODE=1',
          '/usr/bin/sandbox-exec',
          '-f',
          policyPath,
          ...argv,
        ],
        timeoutSeconds,
      );
    } catch (error) {
      // Child closure is unproven: the stage stays for owned-operation reconciliation.
      halt(
        error instanceof Error && error.message === 'EXECUTOR_LIFETIME_UNKNOWN'
          ? 'RENDER_LIFETIME_UNKNOWN'
          : 'RENDER_OPERATION_UNAVAILABLE',
      );
    }
    const endedAt = clock().toISOString();

    let result: WorkflowRenderReceipt;
    try {
      result = await measure(receipt);
    } catch (error) {
      await reclaim().catch(() => undefined);
      throw error;
    }
    await guard('RENDER_CLEANUP_FAILED', reclaim);
    return result;

    async function measure(execution: ExecutionReceipt): Promise<WorkflowRenderReceipt> {
      if (execution.timedOut) halt('RENDER_TIMED_OUT');
      if (execution.exitCode === 127) halt('RENDER_UV_UNAVAILABLE');
      if (execution.exitCode !== 0) halt('RENDER_EXIT_NONZERO');

      const rootHash = hash(Buffer.from(projectRoot, 'utf8')).slice(0, 12);
      const generationParent = `${projectRoot}/_bmad/render/bmad-build/${slug}-${rootHash}/`;
      const generationPath = await guard('RENDER_STDOUT_MISMATCH', async () => {
        const log = await readContained(stage, 'execution.log', maxLogBytes, { remaining: maxLogBytes });
        if (log === null) throw new Error('RENDER_STDOUT_ABSENT');
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(log);
        if (!text.startsWith(entryPrefix) || text.indexOf('\n') !== text.length - 1)
          throw new Error('RENDER_STDOUT_SHAPE');
        const entry = text.slice(entryPrefix.length, -1);
        const generation = entry.slice(0, -entrySuffix.length);
        if (
          !entry.endsWith(entrySuffix) ||
          !generation.startsWith(generationParent) ||
          !/^[0-9a-f]{20}$/.test(generation.slice(generationParent.length))
        )
          throw new Error('RENDER_STDOUT_PATH');
        const printed = await readContained(
          projectRoot,
          `${generation.slice(projectRoot.length + 1)}${entrySuffix}`,
          maxFileBytes,
          { remaining: maxFileBytes },
        );
        if (printed === null) throw new Error('RENDER_STDOUT_PATH');
        return generation;
      });

      const inspection = await guard('RENDER_ARTIFACT_MISMATCH', async () => {
        const relative = generationPath.slice(projectRoot.length + 1);
        const names = outputNames(render);
        const listed: string[] = [];
        await listGeneration(generationPath, '', 0, listed);
        const expected = new Set(['manifest.json', ...names]);
        if (listed.length !== expected.size || listed.some((name) => !expected.has(name)))
          throw new Error('RENDER_GENERATION_SHAPE');
        // Re-read the inputs so a change during the render cannot inherit the earlier identity.
        const budget = { remaining: maxSnapshotBytes };
        const inputs = await readInputs(projectRoot, render, budget);
        const manifestBytes = await readContained(
          projectRoot,
          `${relative}/manifest.json`,
          maxFileBytes,
          budget,
        );
        if (manifestBytes === null) throw new Error('RENDER_GENERATION_SHAPE');
        const outputBytes: Record<string, Buffer> = {};
        for (const name of names) {
          const bytes = await readContained(projectRoot, `${relative}/${name}`, maxFileBytes, budget);
          if (bytes === null) throw new Error('RENDER_GENERATION_SHAPE');
          outputBytes[name] = bytes;
        }
        return createBmadArtifactInspector({
          ...render,
          projectRoot,
          generationRoot: generationPath,
        }).inspect({
          generationPath,
          projectedFiles: inputs.projectedFiles,
          layerFiles: inputs.layerFiles,
          manifestBytes,
          outputBytes,
        });
      });

      return {
        kind: 'workflow_render_receipt',
        attemptId,
        data: {
          definitionSha256,
          customizationSha256,
          projectRoot,
          generationPath,
          inspection,
          witness: {
            uvPath: uv.path,
            uvSha256: uv.sha256,
            uvVersion: uv.version,
            argv,
            exitCode: execution.exitCode,
            stdoutPath: `${generationPath}${entrySuffix}`,
            startedAt,
            endedAt,
            operationId,
          },
        },
      };
    }
  }

  return {
    async render(request) {
      try {
        return { receipt: await produce(request) };
      } catch (error) {
        return {
          halt: true,
          reason: error instanceof RenderHalt ? error.reason : 'RENDER_UNEXPECTED_FAILURE',
        };
      }
    },
  };
}
