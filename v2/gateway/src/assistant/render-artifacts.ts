import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { types } from 'node:util';
import {
  type ProjectionPin,
  type SourcePin,
  validateProjectionPin,
  validateSourcePin,
} from '../workflows/pins.ts';

export type RenderLayerPath =
  | '_bmad/config.toml'
  | '_bmad/config.user.toml'
  | '_bmad/custom/config.toml'
  | '_bmad/custom/config.user.toml'
  | '_bmad/custom/bmad-build.toml'
  | '_bmad/custom/bmad-build.user.toml'
  | '.claude/skills/bmad-build/customize.toml';

export type CapturedRenderExpectation = {
  projectRoot: string;
  generationRoot: string;
  source: SourcePin;
  projection: ProjectionPin;
  selectedProjectionSha256: Readonly<Record<string, string>>;
  layers: Readonly<Record<RenderLayerPath, string | null>>;
};

export type RenderArtifactByteSnapshot = {
  generationPath: string;
  projectedFiles: Readonly<Record<string, Uint8Array>>;
  layerFiles: Readonly<Record<RenderLayerPath, Uint8Array | null>>;
  manifestBytes: Uint8Array;
  outputBytes: Readonly<Record<string, Uint8Array>>;
};

export type RenderArtifactInspection = {
  kind: 'artifact-inspection';
  manifestSha256: string;
  sourceSha256: Readonly<Record<string, string>>;
  outputSha256: Readonly<Record<string, string>>;
  layerSha256: Readonly<Record<RenderLayerPath, string | null>>;
};

const layerPaths = [
  '_bmad/config.toml',
  '_bmad/config.user.toml',
  '_bmad/custom/config.toml',
  '_bmad/custom/config.user.toml',
  '_bmad/custom/bmad-build.toml',
  '_bmad/custom/bmad-build.user.toml',
  '.claude/skills/bmad-build/customize.toml',
] as const satisfies readonly RenderLayerPath[];
const requiredLayers = new Set<RenderLayerPath>([
  '_bmad/config.toml',
  '.claude/skills/bmad-build/customize.toml',
]);
const skillRoot = '.claude/skills/bmad-build/';
const rendererPath = '_bmad/scripts/render_skill.py';
const helperPath = '_bmad/scripts/config_utils.py';
const customizePath = `${skillRoot}customize.toml`;
const skillPath = `${skillRoot}SKILL.md`;
const workflowPath = `${skillRoot}workflow.md`;
const acceptedBmadSourceTree = '45227836f9983671126b31255cab949aeb61611a959d1042f7a2ca679f8f9317';
const digestPattern = /^[0-9a-f]{64}$/;
const mdNamePattern = /^(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/;
const snapshotPattern = /\[\[bmad-snapshot:([A-Za-z0-9_./-]+\.md)\]\]/g;
const maxManifestBytes = 1024 * 1024;
const maxFileBytes = 16 * 1024 * 1024;
const maxTotalBytes = 32 * 1024 * 1024;
const maxSelectedFiles = 128;
const maxOutputFiles = 128;
const maxPathLength = 4096;

function mismatch(): never {
  throw new Error('RENDER_ARTIFACT_MISMATCH');
}

function tooLarge(): never {
  throw new Error('RENDER_ARTIFACT_TOO_LARGE');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !types.isProxy(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function boundedKeys(value: unknown, maximum: number): string[] {
  if (!isPlainRecord(value)) mismatch();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > maximum) tooLarge();
  const result: string[] = [];
  for (const key of ownKeys) {
    if (typeof key !== 'string') mismatch();
    if (key.length > maxPathLength) tooLarge();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) mismatch();
    result.push(key);
  }
  return result;
}

function hasExactKeys(
  value: unknown,
  wanted: readonly string[],
  maximum = wanted.length,
): asserts value is Record<string, unknown> {
  const actual = boundedKeys(value, maximum + 1);
  if (actual.length !== wanted.length || actual.some((key) => !wanted.includes(key))) mismatch();
}

function sameKeys(actual: readonly string[], expected: readonly string[]): void {
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) mismatch();
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && digestPattern.test(value);
}

function checkedAbsolutePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > maxPathLength ||
    !posix.isAbsolute(value) ||
    posix.normalize(value) !== value ||
    value.includes('\\') ||
    value.includes('\0') ||
    !validUnicode(value)
  )
    mismatch();
  return value;
}

function checkedMdName(value: string): void {
  if (value.length > 512 || !mdNamePattern.test(value) || posix.normalize(value) !== value) mismatch();
}

function selectedName(path: string): string | null {
  if (path === rendererPath || path === helperPath || path === customizePath) return null;
  if (!path.startsWith(skillRoot)) mismatch();
  const name = path.slice(skillRoot.length);
  checkedMdName(name);
  return posix.basename(name) === 'SKILL.md' ? null : name;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

type ResolvedCategory = 'string' | 'string-list' | 'review-layers';

const customizationCategories: Readonly<Record<string, ResolvedCategory>> = {
  implementation_handoff: 'string',
  on_complete: 'string',
  open_spec: 'string',
  activation_steps_prepend: 'string-list',
  activation_steps_append: 'string-list',
  persistent_facts: 'string-list',
  review_layers: 'review-layers',
  oneshot_review_layers: 'review-layers',
};

function sourceResolvedCategories(
  sourceTexts: Readonly<Record<string, string>>,
  resolved: unknown,
): Map<string, ResolvedCategory> {
  const resolvedKeys = boundedKeys(resolved, 128);
  const categories = new Map<string, ResolvedCategory>();
  for (const text of Object.values(sourceTexts)) {
    for (const match of text.matchAll(/\{\{config\.([A-Za-z0-9_.-]+)\}\}/g)) {
      categories.set(`config.${match[1]}`, 'string');
    }
    for (const match of text.matchAll(/\{\{\.([A-Za-z0-9_]+)\}\}/g)) {
      const suffix = `.${match[1]}`;
      const matching = resolvedKeys.filter((key) => key.startsWith('config.') && key.endsWith(suffix));
      if (matching.length !== 1) mismatch();
      categories.set(matching[0], 'string');
    }
    for (const match of text.matchAll(/\{workflow\.([A-Za-z0-9_.-]+)\}/g)) {
      if (!Object.hasOwn(customizationCategories, match[1])) mismatch();
      const category = customizationCategories[match[1]];
      categories.set(`customization.workflow.${match[1]}`, category);
    }
  }
  sameKeys(resolvedKeys, [...categories.keys()]);
  return categories;
}

function checkedResolvedValues(resolved: unknown, categories: Map<string, ResolvedCategory>): void {
  for (const [key, category] of categories) {
    const value = (resolved as Record<string, unknown>)[key];
    if (category === 'string') {
      if (typeof value !== 'string' || !validUnicode(value)) mismatch();
      continue;
    }
    if (!Array.isArray(value) || types.isProxy(value)) mismatch();
    if (value.length > 128) tooLarge();
    if (category === 'string-list') {
      for (const item of value) if (typeof item !== 'string' || !item || !validUnicode(item)) mismatch();
      continue;
    }
    const ids = new Set<string>();
    for (const item of value) {
      const keys = boundedKeys(item, 4);
      if (
        keys.length < 3 ||
        keys.length > 4 ||
        !['id', 'name', 'instruction'].every((field) => keys.includes(field)) ||
        keys.some((field) => !['id', 'name', 'instruction', 'when'].includes(field))
      )
        mismatch();
      const layer = item as Record<string, unknown>;
      for (const field of keys) {
        const fieldValue = layer[field];
        if (typeof fieldValue !== 'string' || !validUnicode(fieldValue)) mismatch();
        if (field !== 'instruction' && !fieldValue) mismatch();
      }
      if (ids.has(layer.id as string)) mismatch();
      ids.add(layer.id as string);
    }
  }
}

// Official Python: ensure_ascii=False, sort_keys=True, separators=(",", ":").
// Numeric resolved values are refused because JS and Python number text can differ.
function pythonCanonical(value: unknown): string {
  if (typeof value === 'string') {
    if (!validUnicode(value)) mismatch();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(pythonCanonical).join(',')}]`;
  const keys = boundedKeys(value, 128).sort();
  return `{${keys.map((key) => `${pythonCanonical(key)}:${pythonCanonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

type RenderDefinitionPart = Omit<CapturedRenderExpectation, 'projectRoot' | 'generationRoot'>;

function checkPinBounds(expected: RenderDefinitionPart): void {
  hasExactKeys(expected.source, [
    'name',
    'version',
    'sourceRevision',
    'sourceUrl',
    'payloadSha256',
    'packageIntegrity',
    'sourceManifestSha256',
    'sourceTreeSha256',
  ]);
  for (const key of Object.keys(expected.source)) {
    const value = expected.source[key as keyof SourcePin];
    if (typeof value === 'string' && value.length > 2048) tooLarge();
  }
  hasExactKeys(expected.projection, [
    'runtime',
    'sourceTreeSha256',
    'manifestSha256',
    'treeSha256',
    'derivation',
  ]);
  hasExactKeys(expected.projection.derivation, [
    'tool',
    'version',
    'options',
    'layoutSchema',
    'policySha256',
  ]);
  const options = expected.projection.derivation.options;
  if (!Array.isArray(options) || options.length > 32) tooLarge();
  for (const option of options) if (typeof option !== 'string' || option.length > 4096) mismatch();
}

function checkDefinition(definition: RenderDefinitionPart): string[] {
  checkPinBounds(definition);
  validateSourcePin(definition.source);
  validateProjectionPin(definition.projection);
  if (
    definition.source.name !== 'bmad' ||
    definition.source.sourceTreeSha256 !== definition.projection.sourceTreeSha256 ||
    definition.source.sourceTreeSha256 !== acceptedBmadSourceTree
  )
    mismatch();

  const selected = boundedKeys(definition.selectedProjectionSha256, maxSelectedFiles);
  for (const path of selected) {
    selectedName(path);
    if (!isDigest(definition.selectedProjectionSha256[path])) mismatch();
  }
  for (const required of [rendererPath, helperPath, customizePath, skillPath, workflowPath]) {
    if (!selected.includes(required)) mismatch();
  }
  hasExactKeys(definition.layers, layerPaths);
  for (const path of layerPaths) {
    const expectedHash = definition.layers[path];
    if (requiredLayers.has(path) ? !isDigest(expectedHash) : expectedHash !== null && !isDigest(expectedHash))
      mismatch();
  }
  if (definition.layers[customizePath] !== definition.selectedProjectionSha256[customizePath]) mismatch();
  return selected;
}

function capture(expected: CapturedRenderExpectation): CapturedRenderExpectation {
  hasExactKeys(expected, [
    'projectRoot',
    'generationRoot',
    'source',
    'projection',
    'selectedProjectionSha256',
    'layers',
  ]);
  checkedAbsolutePath(expected.projectRoot);
  checkedAbsolutePath(expected.generationRoot);
  checkDefinition(expected);
  return structuredClone(expected);
}

/**
 * Pure check that a host-independent BMAD render definition is one the inspector can accept: the
 * same pin, accepted-tree, selected-name (≤128 files, normalized `.md` names ≤512) and layer rules
 * as `createBmadArtifactInspector`. With `fileBytes`, it also applies the inspector's byte caps to
 * the size of every selected file and present layer (≤16 MiB each, ≤32 MiB together); `fileBytes`
 * must then name exactly those paths. Throws `RENDER_ARTIFACT_MISMATCH` or
 * `RENDER_ARTIFACT_TOO_LARGE`; returns nothing and grants no authority.
 */
export function validateRenderDefinition(
  definition: RenderDefinitionPart,
  fileBytes?: Readonly<Record<string, number>>,
): void {
  hasExactKeys(definition, ['source', 'projection', 'selectedProjectionSha256', 'layers']);
  const selected = checkDefinition(definition);
  if (fileBytes === undefined) return;
  const present = new Set(selected);
  for (const path of layerPaths) if (definition.layers[path] !== null) present.add(path);
  const sized = boundedKeys(fileBytes, maxSelectedFiles + layerPaths.length);
  sameKeys(sized, [...present]);
  let total = 0;
  for (const path of sized) {
    const bytes = fileBytes[path];
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) mismatch();
    if (bytes > maxFileBytes) tooLarge();
    total += bytes;
  }
  if (total > maxTotalBytes) tooLarge();
}

function snapshotBytes(snapshot: RenderArtifactByteSnapshot): RenderArtifactByteSnapshot {
  hasExactKeys(snapshot, ['generationPath', 'projectedFiles', 'layerFiles', 'manifestBytes', 'outputBytes']);
  checkedAbsolutePath(snapshot.generationPath);
  const projectedNames = boundedKeys(snapshot.projectedFiles, maxSelectedFiles);
  const outputNames = boundedKeys(snapshot.outputBytes, maxOutputFiles);
  hasExactKeys(snapshot.layerFiles, layerPaths);
  for (const name of projectedNames) selectedName(name);
  for (const name of outputNames) checkedMdName(name);

  // Read each field once, through a data descriptor checked above. Intrinsic typed-array
  // accessors avoid caller-defined byteLength/buffer getters during the cap pass.
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const bufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;
  const offsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')?.get;
  const lengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
  if (!bufferGetter || !offsetGetter || !lengthGetter) mismatch();
  let totalBytes = 0;
  const preflight = (value: unknown, maximum = maxFileBytes): Uint8Array => {
    if (
      value === null ||
      typeof value !== 'object' ||
      types.isProxy(value) ||
      !(value instanceof Uint8Array) ||
      ![Uint8Array.prototype, Buffer.prototype].includes(Object.getPrototypeOf(value))
    )
      mismatch();
    let buffer: unknown;
    let offset: number;
    let length: number;
    try {
      buffer = bufferGetter.call(value);
      offset = offsetGetter.call(value);
      length = lengthGetter.call(value);
    } catch {
      mismatch();
    }
    if (!(buffer instanceof ArrayBuffer) || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length))
      mismatch();
    if (length > maximum || totalBytes + length > maxTotalBytes) tooLarge();
    totalBytes += length;
    try {
      return new Uint8Array(buffer, offset, length);
    } catch {
      mismatch();
    }
  };
  const manifestView = preflight(snapshot.manifestBytes, maxManifestBytes);
  const projectedViews: Record<string, Uint8Array> = {};
  for (const name of projectedNames) projectedViews[name] = preflight(snapshot.projectedFiles[name]);
  const layerViews = {} as Record<RenderLayerPath, Uint8Array | null>;
  for (const path of layerPaths) {
    const value = snapshot.layerFiles[path];
    layerViews[path] = value === null ? null : preflight(value);
  }
  const outputViews: Record<string, Uint8Array> = {};
  for (const name of outputNames) outputViews[name] = preflight(snapshot.outputBytes[name]);

  const manifestBytes = Buffer.from(manifestView);
  const projectedFiles: Record<string, Uint8Array> = {};
  const layerFiles = {} as Record<RenderLayerPath, Uint8Array | null>;
  const outputBytes: Record<string, Uint8Array> = {};
  for (const name of projectedNames) projectedFiles[name] = Buffer.from(projectedViews[name]);
  for (const path of layerPaths) {
    const value = layerViews[path];
    layerFiles[path] = value === null ? null : Buffer.from(value);
  }
  for (const name of outputNames) outputBytes[name] = Buffer.from(outputViews[name]);
  return { generationPath: snapshot.generationPath, projectedFiles, layerFiles, manifestBytes, outputBytes };
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    mismatch();
  }
}

function inspect(
  expected: CapturedRenderExpectation,
  supplied: RenderArtifactByteSnapshot,
): RenderArtifactInspection {
  const snapshot = snapshotBytes(supplied);
  const projectedNames = Object.keys(snapshot.projectedFiles);
  sameKeys(projectedNames, Object.keys(expected.selectedProjectionSha256));
  for (const path of projectedNames) {
    if (sha256(snapshot.projectedFiles[path]) !== expected.selectedProjectionSha256[path]) mismatch();
  }
  const layerSha256 = {} as Record<RenderLayerPath, string | null>;
  for (const path of layerPaths) {
    const bytes = snapshot.layerFiles[path];
    const actual = bytes === null ? null : sha256(bytes);
    if (actual !== expected.layers[path]) mismatch();
    layerSha256[path] = actual;
  }
  const projectedCustomize = snapshot.projectedFiles[customizePath];
  const layerCustomize = snapshot.layerFiles[customizePath];
  if (!projectedCustomize || !layerCustomize || Buffer.compare(projectedCustomize, layerCustomize) !== 0)
    mismatch();

  let manifest: unknown;
  try {
    manifest = JSON.parse(decodeUtf8(snapshot.manifestBytes));
  } catch {
    mismatch();
  }
  hasExactKeys(manifest, [
    'schema_version',
    'skill',
    'project_root',
    'project_slug',
    'root_hash',
    'generation_hash',
    'inputs',
    'outputs',
  ]);
  if (
    manifest.schema_version !== 1 ||
    manifest.skill !== 'bmad-build' ||
    manifest.project_root !== expected.projectRoot
  )
    mismatch();
  hasExactKeys(manifest.inputs, ['project_root', 'renderer_sha256', 'resolved_values', 'source_sha256']);
  const inputs = manifest.inputs;
  if (inputs.project_root !== expected.projectRoot || !isDigest(inputs.renderer_sha256)) mismatch();
  if (inputs.renderer_sha256 !== sha256(snapshot.projectedFiles[rendererPath])) mismatch();

  const sources: Record<string, string> = {};
  const sourceTexts: Record<string, string> = {};
  for (const path of projectedNames) {
    const name = selectedName(path);
    if (name === null) continue;
    const source = decodeUtf8(snapshot.projectedFiles[path]);
    for (const match of source.matchAll(snapshotPattern)) {
      if (
        !projectedNames.includes(`${skillRoot}${match[1]}`) ||
        selectedName(`${skillRoot}${match[1]}`) !== match[1]
      )
        mismatch();
    }
    sources[name] = sha256(snapshot.projectedFiles[path]);
    sourceTexts[name] = source;
  }
  if (!Object.hasOwn(sources, 'workflow.md')) mismatch();
  checkedResolvedValues(
    inputs.resolved_values,
    sourceResolvedCategories(sourceTexts, inputs.resolved_values),
  );
  const sourceNames = Object.keys(sources);
  const manifestSources = inputs.source_sha256;
  if (!isPlainRecord(manifestSources)) mismatch();
  sameKeys(boundedKeys(manifestSources, maxSelectedFiles), sourceNames);
  for (const name of sourceNames) if (manifestSources[name] !== sources[name]) mismatch();

  const manifestOutputs = manifest.outputs;
  if (!isPlainRecord(manifestOutputs)) mismatch();
  const outputNames = boundedKeys(manifestOutputs, maxOutputFiles);
  sameKeys(outputNames, sourceNames);
  sameKeys(Object.keys(snapshot.outputBytes), sourceNames);
  const outputs: Record<string, string> = {};
  for (const name of outputNames) {
    checkedMdName(name);
    if (!isDigest(manifestOutputs[name])) mismatch();
    decodeUtf8(snapshot.outputBytes[name]);
    const actual = sha256(snapshot.outputBytes[name]);
    if (actual !== manifestOutputs[name]) mismatch();
    outputs[name] = actual;
  }

  const baseName = posix.basename(expected.projectRoot);
  for (const character of baseName) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 32 || codePoint > 126) mismatch();
  }
  const cleaned =
    baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project';
  const slug = cleaned.slice(0, 80).replace(/-$/g, '') || 'project';
  const rootHash = sha256(Buffer.from(expected.projectRoot, 'utf8')).slice(0, 12);
  const identity = {
    project_root: inputs.project_root,
    renderer_sha256: inputs.renderer_sha256,
    resolved_values: inputs.resolved_values,
    source_sha256: inputs.source_sha256,
  };
  const generationHash = sha256(Buffer.from(pythonCanonical(identity), 'utf8')).slice(0, 20);
  const generationPath = `${expected.projectRoot}/_bmad/render/bmad-build/${slug}-${rootHash}/${generationHash}`;
  if (
    manifest.project_slug !== slug ||
    manifest.root_hash !== rootHash ||
    manifest.generation_hash !== generationHash ||
    expected.generationRoot !== generationPath ||
    snapshot.generationPath !== generationPath
  )
    mismatch();

  return {
    kind: 'artifact-inspection',
    manifestSha256: sha256(snapshot.manifestBytes),
    sourceSha256: sources,
    outputSha256: outputs,
    layerSha256,
  };
}

export function createBmadArtifactInspector(expected: CapturedRenderExpectation): {
  inspect(snapshot: RenderArtifactByteSnapshot): RenderArtifactInspection;
} {
  const captured = capture(expected);
  return { inspect: (snapshot) => inspect(captured, snapshot) };
}
