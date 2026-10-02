import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicRecords, hash } from '../../src/journal/atomic-records.ts';
import { installerLog, runBmadInstaller } from '../../src/workflows/builder.ts';
import { OwnedOperations } from '../../src/workflows/operations.ts';
import { manifest, manifestHash, parseArchive } from '../../src/workflows/stage.ts';

const fixtures = new URL('../fixtures/', import.meta.url);
const audit = JSON.parse(await readFile(new URL('workflows/official-audits.json', fixtures), 'utf8'));
const deps = JSON.parse(await readFile(new URL('workflow-builder/dependencies.json', fixtures), 'utf8'));
const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-real-build-')));
const store = await AtomicRecords.open(root);
const operations = await OwnedOperations.open(root, store);
const id = 'real-bmad-build';
const identity = await operations.create(id);
const stage = join(root, 'stages', id);
await store.put('probe', { formatVersion: 1, root, id, identity });
console.log('Owned build:', root);
try {
  const files = await runBmadInstaller(
    stage,
    identity,
    operations,
    await parseArchive(
      await readFile(new URL('workflows/bmad-6.12.0.tgz', fixtures)),
      audit.bmad.source.executables,
    ),
    {
      kind: 'bmad-install',
      dependencies: await readFile(new URL('workflow-builder/dependencies.tgz', fixtures)),
      dependencySha256: deps.payloadSha256,
      dependencyExecutables: deps.executables,
      lockSha256: deps.lockSha256,
      packageSha256: deps.packageSha256,
      nodeVersion: process.version,
      nodeSha256: hash(await readFile(process.execPath)),
      uvPath: '/Users/phannhatquang/.local/bin/uv',
      uvSha256: hash(await readFile('/Users/phannhatquang/.local/bin/uv')),
    },
  );
  await writeFile(
    join(root, 'output-manifest.json'),
    JSON.stringify({ hash: manifestHash(manifest(files)), entries: manifest(files) }, null, 2),
  );
  console.log('Output:', files.length, manifestHash(manifest(files)));
} catch (error) {
  console.error(error);
} finally {
  console.log(await installerLog(stage).catch(() => 'No execution log'));
  await store.close();
}
