import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { canonicalJson, hash } from '../journal/atomic-records.ts';
import {
  type ManifestEntry,
  type ProjectionPin,
  type SourcePin,
  validateProjectionPin,
  validateSourcePin,
  type WorkflowManifest,
} from '../workflows/pins.ts';
import type { WorkflowRegistry } from '../workflows/registry.ts';
import { manifestHash } from '../workflows/stage.ts';
import {
  type CapturedRenderExpectation,
  type RenderLayerPath,
  validateRenderDefinition,
} from './render-artifacts.ts';

export type RenderDefinition = Omit<CapturedRenderExpectation, 'projectRoot' | 'generationRoot'>;

export type WorkflowDefinition = {
  sha256: string;
  skills: { path: string; sha256: string }[];
  customizationSha256: string;
  render?: RenderDefinition;
};

type Layers = Readonly<Partial<Record<RenderLayerPath, string | null>>>;

export type CustomizationContext = {
  schema: 'crew-v2:workflow-customization:1';
  workflow: SourcePin['name'];
  sourceTreeSha256: string;
  projectionTreeSha256: string;
  layers: Layers;
};

const customizationSchema = 'crew-v2:workflow-customization:1';
const digest = /^[0-9a-f]{64}$/;
const bmadSkillRoot = '.claude/skills/bmad-build/';
const bmadSkill = `${bmadSkillRoot}SKILL.md`;
const bmadWorkflow = `${bmadSkillRoot}workflow.md`;
const bmadCustomize = `${bmadSkillRoot}customize.toml`;
const bmadScripts = ['_bmad/scripts/render_skill.py', '_bmad/scripts/config_utils.py'];
// Official render_skill.py layer order; the projected customize.toml is the skill base layer.
const bmadLayers = [
  '_bmad/config.toml',
  '_bmad/config.user.toml',
  '_bmad/custom/config.toml',
  '_bmad/custom/config.user.toml',
  '_bmad/custom/bmad-build.toml',
  '_bmad/custom/bmad-build.user.toml',
  bmadCustomize,
] as const satisfies readonly RenderLayerPath[];
const requiredBmadLayers: readonly RenderLayerPath[] = ['_bmad/config.toml', bmadCustomize];
// Mirrors the markdown names the BMAD artifact inspector accepts for selected skill sources.
const bmadMarkdown = /^(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/;

const byPath = (a: { path: string }, b: { path: string }) =>
  Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));

function invalidContext(): never {
  throw new Error('INVALID_CUSTOMIZATION_CONTEXT');
}

/**
 * Shared, pure customization identity for both official workflows. Superpowers carries the measured
 * empty layer set of its pinned projection; BMAD carries all seven render layers (SHA-256 or null).
 */
export function customizationContext(
  source: SourcePin,
  projection: ProjectionPin,
  layers: Layers,
): { context: CustomizationContext; sha256: string } {
  const pinnedSource = structuredClone(source);
  const pinnedProjection = structuredClone(projection);
  validateSourcePin(pinnedSource);
  validateProjectionPin(pinnedProjection);
  if (pinnedSource.sourceTreeSha256 !== pinnedProjection.sourceTreeSha256)
    throw new Error('SOURCE_PROJECTION_MISMATCH');
  if (layers === null || typeof layers !== 'object' || Object.getPrototypeOf(layers) !== Object.prototype)
    invalidContext();
  const keys = Object.keys(layers);
  const measured: Partial<Record<RenderLayerPath, string | null>> = {};
  if (pinnedSource.name === 'superpowers') {
    if (keys.length !== 0) invalidContext();
  } else {
    if (
      keys.length !== bmadLayers.length ||
      keys.some((key) => !(bmadLayers as readonly string[]).includes(key))
    )
      invalidContext();
    for (const path of bmadLayers) {
      const value = layers[path];
      if (value === null && !requiredBmadLayers.includes(path)) measured[path] = null;
      else if (typeof value === 'string' && digest.test(value)) measured[path] = value;
      else invalidContext();
    }
  }
  const context: CustomizationContext = {
    schema: customizationSchema,
    workflow: pinnedSource.name,
    sourceTreeSha256: pinnedSource.sourceTreeSha256,
    projectionTreeSha256: pinnedProjection.treeSha256,
    layers: measured,
  };
  return { context, sha256: hash(canonicalJson(context)) };
}

const skillPath = /^skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/;

async function readPinnedFile(root: string, entry: ManifestEntry): Promise<void> {
  const parts = entry.path.split('/');
  for (let index = 1; index < parts.length; index++) {
    const parent = await lstat(join(root, ...parts.slice(0, index)));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('WORKFLOW_SKILL_MISMATCH');
  }
  const file = await open(
    join(root, entry.path),
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size !== entry.bytes ||
      hash(await file.readFile()) !== entry.sha256
    )
      throw new Error('WORKFLOW_SKILL_MISMATCH');
  } finally {
    await file.close();
  }
}

function assertPinnedManifests(
  manifests: WorkflowManifest,
  source: SourcePin,
  projection: ProjectionPin,
): void {
  if (
    manifestHash(manifests.source) !== source.sourceManifestSha256 ||
    manifestHash(manifests.projection) !== projection.manifestSha256
  )
    throw new Error('WORKFLOW_MANIFEST_MISMATCH');
}

function definition(
  source: SourcePin,
  projection: ProjectionPin,
  skills: WorkflowDefinition['skills'],
  layers: Layers,
  selectedProjectionSha256?: Record<string, string>,
): WorkflowDefinition {
  const customizationSha256 = customizationContext(source, projection, layers).sha256;
  const render: RenderDefinition | undefined = selectedProjectionSha256
    ? {
        source: structuredClone(source),
        projection: structuredClone(projection),
        selectedProjectionSha256,
        layers: structuredClone(layers) as RenderDefinition['layers'],
      }
    : undefined;
  return {
    sha256: hash(canonicalJson({ source, projection, skills, customizationSha256, render: render ?? null })),
    skills,
    customizationSha256,
    ...(render ? { render } : {}),
  };
}

// BMAD tier one: the pinned projection selects skill sources, renderer scripts and the seven
// customization layers. The render receipt is latched later by the server; nothing executes here.
async function loadBmadDefinition(
  registry: Pick<WorkflowRegistry, 'resolve'>,
  source: SourcePin,
  projection: ProjectionPin,
): Promise<WorkflowDefinition> {
  if (projection.runtime !== 'claude') throw new Error('WORKFLOW_DEFINITION_UNAVAILABLE');
  const resolved = await registry.resolve(source, projection);
  const entries = new Map(resolved.manifest.projection.map((entry) => [entry.path, entry]));
  const selected: ManifestEntry[] = [];
  for (const entry of entries.values()) {
    if (!entry.path.startsWith(bmadSkillRoot)) continue;
    if (entry.type === 'symlink') throw new Error('WORKFLOW_SKILL_MISMATCH');
    if (entry.type !== 'file') continue;
    const name = entry.path.slice(bmadSkillRoot.length);
    if (name.endsWith('.md') && !bmadMarkdown.test(name)) throw new Error('WORKFLOW_SKILL_MISMATCH');
    if (entry.path === bmadCustomize || name.endsWith('.md')) selected.push(entry);
  }
  for (const path of bmadScripts) {
    const entry = entries.get(path);
    if (entry && entry.type !== 'file') throw new Error('WORKFLOW_SKILL_MISMATCH');
    if (entry) selected.push(entry);
  }
  const layers = {} as Record<RenderLayerPath, string | null>;
  const layerEntries: ManifestEntry[] = [];
  for (const path of bmadLayers) {
    const entry = entries.get(path);
    if (entry && entry.type !== 'file') throw new Error('WORKFLOW_SKILL_MISMATCH');
    if (!entry && requiredBmadLayers.includes(path)) throw new Error('WORKFLOW_SKILL_MISMATCH');
    layers[path] = entry ? entry.sha256 : null;
    if (entry && path !== bmadCustomize) layerEntries.push(entry);
  }
  const selectedPaths = new Set(selected.map((entry) => entry.path));
  for (const required of [bmadSkill, bmadWorkflow, bmadCustomize, ...bmadScripts])
    if (!selectedPaths.has(required)) throw new Error('WORKFLOW_SKILL_MISMATCH');
  selected.sort(byPath);
  const selectedProjectionSha256 = Object.fromEntries(selected.map((entry) => [entry.path, entry.sha256]));
  // Refuse, before reading bytes, any selection the render artifact inspector could never accept.
  validateRenderDefinition(
    { source, projection, selectedProjectionSha256, layers },
    Object.fromEntries([...selected, ...layerEntries].map((entry) => [entry.path, entry.bytes])),
  );
  for (const entry of [...selected, ...layerEntries]) await readPinnedFile(resolved.projectionRoot, entry);
  assertPinnedManifests(resolved.manifest, source, projection);

  const skills = selected
    .filter((entry) => entry.path.endsWith('.md') && posix.basename(entry.path) !== 'SKILL.md')
    .map((entry) => ({ path: entry.path, sha256: entry.sha256 }));
  return definition(source, projection, skills, layers, selectedProjectionSha256);
}

export function createWorkflowManifest(registry: Pick<WorkflowRegistry, 'resolve'>) {
  return {
    async loadDefinition(source: SourcePin, projection: ProjectionPin): Promise<WorkflowDefinition> {
      const pinnedSource = structuredClone(source);
      const pinnedProjection = structuredClone(projection);
      validateSourcePin(pinnedSource);
      if (pinnedSource.sourceTreeSha256 !== pinnedProjection.sourceTreeSha256)
        throw new Error('SOURCE_PROJECTION_MISMATCH');
      validateProjectionPin(pinnedProjection);
      if (pinnedSource.name === 'bmad') return loadBmadDefinition(registry, pinnedSource, pinnedProjection);
      if (pinnedSource.name !== 'superpowers') throw new Error('WORKFLOW_DEFINITION_UNAVAILABLE');

      const resolved = await registry.resolve(pinnedSource, pinnedProjection);
      const sourceEntries = new Map(resolved.manifest.source.map((entry) => [entry.path, entry]));
      const projectionEntries = new Map(resolved.manifest.projection.map((entry) => [entry.path, entry]));
      const skills = [...sourceEntries.values()]
        .filter((entry) => skillPath.test(entry.path))
        .sort(byPath)
        .map((entry) => ({ path: entry.path, sha256: entry.sha256 }));
      if (skills.length === 0) throw new Error('WORKFLOW_SKILL_MISMATCH');
      for (const skill of skills) {
        const fromSource = sourceEntries.get(skill.path);
        const fromProjection = projectionEntries.get(skill.path);
        if (
          !fromSource ||
          !fromProjection ||
          fromSource.type !== 'file' ||
          fromProjection.type !== 'file' ||
          fromSource.sha256 !== fromProjection.sha256
        )
          throw new Error('WORKFLOW_SKILL_MISMATCH');
        await readPinnedFile(resolved.sourceRoot, fromSource);
        await readPinnedFile(resolved.projectionRoot, fromProjection);
      }
      assertPinnedManifests(resolved.manifest, pinnedSource, pinnedProjection);
      return definition(pinnedSource, pinnedProjection, skills, {});
    },
  };
}
