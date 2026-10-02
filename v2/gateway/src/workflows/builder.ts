import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { hash } from '../journal/atomic-records.ts';
import type { OwnedIdentity, OwnedOperations } from './operations.ts';
import { parseArchive, readTree, type TreeFile, writeTree } from './stage.ts';

export type BmadBuild = {
  kind: 'bmad-install';
  dependencies: Uint8Array;
  dependencySha256: string;
  dependencyExecutables: string[];
  lockSha256: string;
  packageSha256: string;
  nodeVersion: string;
  nodeSha256: string;
  uvPath: string;
  uvSha256: string;
};
export function bmadBuildPolicy(build: BmadBuild) {
  const { dependencies: _bytes, uvPath: _path, ...inputs } = build;
  return {
    ...inputs,
    metadataPolicy: 'generated-YAML-operational-timestamps-epoch-and-exact-manifest-CSV-hash-v1',
    environment: 'owned-home-xdg-tmp-no-inherited-environment',
    forks: 'deny',
    network: 'deny',
    customModules: 'deny',
    install: [
      'install',
      '--yes',
      '--modules=bmm',
      '--tools=claude-code',
      '--no-shims',
      'core.user_name=Crew',
      'core.communication_language=Vietnamese',
      'core.document_output_language=Vietnamese',
    ],
    runtimeCertificate: null,
  };
}
export async function runBmadInstaller(
  stage: string,
  identity: OwnedIdentity,
  operations: OwnedOperations,
  source: TreeFile[],
  build: BmadBuild,
  beforeExecution: () => Promise<void> = async () => {},
): Promise<TreeFile[]> {
  if (
    build.nodeVersion !== process.version ||
    hash(build.dependencies) !== build.dependencySha256 ||
    hash(await readFile(process.execPath)) !== build.nodeSha256 ||
    hash(await readFile(build.uvPath)) !== build.uvSha256
  )
    throw new Error('BUILDER_INPUT_MISMATCH');
  const deps = await parseArchive(Buffer.from(build.dependencies), build.dependencyExecutables);
  if (deps.some((f) => f.path !== 'node_modules' && !f.path.startsWith('node_modules/')))
    throw new Error('BUILDER_INPUT_MISMATCH');
  const workspace = join(stage, 'build');
  await writeTree(workspace, [...source, ...deps]);
  for (const name of ['home', 'tmp', 'project']) await mkdir(join(workspace, name), { mode: 0o700 });
  // Exact official installer bytes; the update check is denied by process-fork/network confinement.
  const quote = (path: string) => JSON.stringify(path);
  const profile = `(version 1) (allow default)
    (deny process-fork) (deny network*)
    (deny file-read* (subpath "/Users") (subpath "/Library/Caches")
      (subpath "/private/var/folders") (subpath "/private/tmp"))
    (allow file-read-metadata)
    (allow file-read* (literal ${quote(process.execPath)}) (subpath ${quote(stage)}))
    (deny file-write*)
    (allow file-write* (subpath ${quote(stage)}))`;
  const profilePath = join(stage, 'installer.sb');
  await writeFile(profilePath, profile, { mode: 0o600, flag: 'wx' });
  await beforeExecution();
  const receipt = await operations.execute(basename(stage), identity, workspace, [
    '/usr/bin/sandbox-exec',
    '-f',
    profilePath,
    process.execPath,
    join(workspace, 'tools/installer/bmad-cli.js'),
    'install',
    '--directory',
    join(workspace, 'project'),
    '--yes',
    '--modules',
    'bmm',
    '--tools',
    'claude-code',
    '--no-shims',
    '--set',
    'core.user_name=Crew',
    '--set',
    'core.communication_language=Vietnamese',
    '--set',
    'core.document_output_language=Vietnamese',
  ]);
  if (receipt.exitCode !== 0 || receipt.timedOut) throw new Error('OFFICIAL_INSTALLER_FAILED');
  const files = await readTree(join(workspace, 'project'));
  if (!files.some((f) => f.path === '_bmad/scripts/render_skill.py'))
    throw new Error('OFFICIAL_ENTRYPOINT_MISSING');
  return normalizeBmad(files);
}
export function normalizeBmad(files: TreeFile[]): TreeFile[] {
  // Operational timestamps only. Official skill, config, scripts and renderer remain byte intact.
  for (const file of files) {
    if (
      file.type === 'file' &&
      ['_bmad/_config/manifest.yaml', '_bmad/core/config.yaml', '_bmad/bmm/config.yaml'].includes(file.path)
    ) {
      const text = file.body.toString('utf8');
      file.body = Buffer.from(
        text.replace(
          /^(# Date: |\s*(?:installDate|lastUpdated|lastModified): ).*$/gm,
          (_line, prefix) => `${prefix}1970-01-01T00:00:00.000Z`,
        ),
      );
    }
  }
  const manifest = files.find((f) => f.path === '_bmad/_config/manifest.yaml');
  const catalog = files.find((f) => f.path === '_bmad/_config/files-manifest.csv');
  if (!manifest || !catalog) throw new Error('OFFICIAL_MANIFEST_MISSING');
  const changed = new Map(
    files
      .filter((f) =>
        ['_bmad/_config/manifest.yaml', '_bmad/core/config.yaml', '_bmad/bmm/config.yaml'].includes(f.path),
      )
      .map((f) => [f.path.slice(6), hash(f.body)]),
  );
  catalog.body = Buffer.from(
    catalog.body
      .toString('utf8')
      .replace(/^("[^"]*","[^"]*","[^"]*","([^"]*)",)"[a-f0-9]{64}"(?=\r?$)/gm, (line, prefix, path) =>
        changed.has(path) ? `${prefix}"${changed.get(path)}"` : line,
      ),
  );
  return files;
}

export async function installerLog(stage: string): Promise<string> {
  return (await readFile(join(stage, 'execution.log'), 'utf8')).slice(-16_384);
}
