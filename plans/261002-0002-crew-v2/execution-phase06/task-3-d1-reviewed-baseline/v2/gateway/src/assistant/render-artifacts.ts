import { createHash } from 'node:crypto';
import { posix } from 'node:path';
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
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function boundedKeys(value: unknown, maximum: number): string[] {
  if (!isPlainRecord(value)) mismatch();
  const result: string[] = [];
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (result.length === maximum || key.length > maxPathLength) tooLarge();
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
    value.includes('\0')
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

function checkedResolvedValue(value: unknown, depth = 0): void {
  if (depth > 8) tooLarge();
  if (typeof value === 'string') {
    if (!validUnicode(value)) mismatch();
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) tooLarge();
    for (const item of value) checkedResolvedValue(item, depth + 1);
    return;
  }
  const keys = boundedKeys(value, 128);
  for (const key of keys) {
    if (!/^[A-Za-z0-9_.-]+$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) mismatch();
    checkedResolvedValue((value as Record<string, unknown>)[key], depth + 1);
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

function checkPinBounds(expected: CapturedRenderExpectation): void {
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
  checkPinBounds(expected);
  validateSourcePin(expected.source);
  validateProjectionPin(expected.projection);
  if (
    expected.source.name !== 'bmad' ||
    expected.source.sourceTreeSha256 !== expected.projection.sourceTreeSha256
  )
    mismatch();

  const selected = boundedKeys(expected.selectedProjectionSha256, maxSelectedFiles);
  for (const path of selected) {
    selectedName(path);
    if (!isDigest(expected.selectedProjectionSha256[path])) mismatch();
  }
  for (const required of [rendererPath, helperPath, customizePath, skillPath, workflowPath]) {
    if (!selected.includes(required)) mismatch();
  }
  hasExactKeys(expected.layers, layerPaths);
  for (const path of layerPaths) {
    const expectedHash = expected.layers[path];
    if (requiredLayers.has(path) ? !isDigest(expectedHash) : expectedHash !== null && !isDigest(expectedHash))
      mismatch();
  }
  return structuredClone(expected);
}

function snapshotBytes(snapshot: RenderArtifactByteSnapshot): RenderArtifactByteSnapshot {
  hasExactKeys(snapshot, ['generationPath', 'projectedFiles', 'layerFiles', 'manifestBytes', 'outputBytes']);
  checkedAbsolutePath(snapshot.generationPath);
  const projectedNames = boundedKeys(snapshot.projectedFiles, maxSelectedFiles);
  const outputNames = boundedKeys(snapshot.outputBytes, maxOutputFiles);
  hasExactKeys(snapshot.layerFiles, layerPaths);
  for (const name of projectedNames) selectedName(name);
  for (const name of outputNames) checkedMdName(name);

  let totalBytes = 0;
  const preflight = (value: unknown, maximum = maxFileBytes): void => {
    if (!(value instanceof Uint8Array)) mismatch();
    if (value.byteLength > maximum || totalBytes + value.byteLength > maxTotalBytes) tooLarge();
    totalBytes += value.byteLength;
  };
  preflight(snapshot.manifestBytes, maxManifestBytes);
  for (const name of projectedNames) preflight(snapshot.projectedFiles[name]);
  for (const path of layerPaths) {
    const value = snapshot.layerFiles[path];
    if (value !== null) preflight(value);
  }
  for (const name of outputNames) preflight(snapshot.outputBytes[name]);

  const manifestBytes = Buffer.from(snapshot.manifestBytes);
  const projectedFiles: Record<string, Uint8Array> = {};
  const layerFiles = {} as Record<RenderLayerPath, Uint8Array | null>;
  const outputBytes: Record<string, Uint8Array> = {};
  for (const name of projectedNames) projectedFiles[name] = Buffer.from(snapshot.projectedFiles[name]);
  for (const path of layerPaths) {
    const value = snapshot.layerFiles[path];
    layerFiles[path] = value === null ? null : Buffer.from(value);
  }
  for (const name of outputNames) outputBytes[name] = Buffer.from(snapshot.outputBytes[name]);
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
  checkedResolvedValue(inputs.resolved_values);

  const sources: Record<string, string> = {};
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
  }
  if (!Object.hasOwn(sources, 'workflow.md')) mismatch();
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
