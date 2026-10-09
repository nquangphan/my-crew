import { FLOWS_MANIFEST_PATH, FlowsManifest } from './flows-schema.js';
import picomatch from 'picomatch';
import { parse as parseYaml } from 'yaml';
import type { TreeReader } from './tree.js';

export { FLOWS_MANIFEST_PATH };

export type ManifestResult =
  | { status: 'missing' }
  | { status: 'invalid'; errors: string[]; raw: unknown }
  | { status: 'ok'; manifest: FlowsManifest; raw: unknown };

/** Parses `docs/flows.yaml` text: YAML errors (including duplicate keys) and schema errors are reported. */
export function parseManifest(text: string): Exclude<ManifestResult, { status: 'missing' }> {
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true, prettyErrors: false });
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { status: 'invalid', errors: [`invalid YAML: ${message}`], raw: null };
  }
  const parsed = FlowsManifest.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      raw,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }
  return { status: 'ok', manifest: parsed.data, raw };
}

export function loadManifest(tree: TreeReader): ManifestResult {
  const text = tree.read(FLOWS_MANIFEST_PATH);
  return text === null ? { status: 'missing' } : parseManifest(text);
}

/** Matches source files: `source.include` minus `source.exclude` (dotfiles included). */
export function sourceMatcher(manifest: FlowsManifest): (path: string) => boolean {
  const include = picomatch(manifest.source.include, { dot: true });
  const exclude =
    manifest.source.exclude.length > 0 ? picomatch(manifest.source.exclude, { dot: true }) : null;
  return (path) => include(path) && !(exclude?.(path) ?? false);
}

/** Every path the manifest maps (flow entrypoints, files and tests, shared files and unassigned paths). */
export function mappedPaths(manifest: FlowsManifest): Set<string> {
  const paths = new Set<string>();
  for (const flow of Object.values(manifest.flows)) {
    for (const path of [...flow.entrypoints, ...flow.files, ...flow.tests]) paths.add(path);
  }
  for (const path of Object.keys(manifest.shared)) paths.add(path);
  for (const entry of manifest.unassigned) paths.add(entry.path);
  return paths;
}

/** Flow ids that list `path` (as an entrypoint, file or test, or through a `shared` entry). */
export function flowsListing(manifest: FlowsManifest, path: string): string[] {
  const ids = new Set<string>();
  for (const [id, flow] of Object.entries(manifest.flows)) {
    if (flow.entrypoints.includes(path) || flow.files.includes(path) || flow.tests.includes(path))
      ids.add(id);
  }
  for (const id of manifest.shared[path] ?? []) ids.add(id);
  return [...ids];
}
