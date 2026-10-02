import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hash } from '../../src/journal/atomic-records.ts';
import { auditBmadBuild, auditSuperpowersApi } from '../../src/workflows/audit.ts';
import { normalizeBmad } from '../../src/workflows/builder.ts';
import { auditSuperpowersNative } from '../../src/workflows/native-projection.ts';
import { manifest, manifestHash, readTree } from '../../src/workflows/stage.ts';

const fixtures = new URL('../fixtures/', import.meta.url);
const current = JSON.parse(await readFile(new URL('workflows/official-audits.json', fixtures), 'utf8'));
const deps = JSON.parse(await readFile(new URL('workflow-builder/dependencies.json', fixtures), 'utf8'));
const build = {
  kind: 'bmad-install' as const,
  dependencies: await readFile(new URL('workflow-builder/dependencies.tgz', fixtures)),
  dependencySha256: deps.payloadSha256,
  dependencyExecutables: deps.executables,
  lockSha256: deps.lockSha256,
  packageSha256: deps.packageSha256,
  nodeVersion: process.version,
  nodeSha256: hash(await readFile(process.execPath)),
  uvPath: '/Users/phannhatquang/.local/bin/uv',
  uvSha256: hash(await readFile('/Users/phannhatquang/.local/bin/uv')),
};
const roots = process.argv.slice(2);
const first = await readTree(join(roots[0], 'stages/real-bmad-build/build/project'));
const second = await readTree(join(roots[1], 'stages/real-bmad-build/build/project'));
const left = manifest(normalizeBmad(first));
const right = manifest(normalizeBmad(second));
for (let i = 0; i < left.length; i++)
  if (left[i].sha256 !== right[i].sha256)
    console.log(
      'DIFFERENCE',
      left[i].path,
      first[i]?.body.toString().slice(0, 500),
      second[i]?.body.toString().slice(0, 500),
    );
const claude = auditBmadBuild(current.bmad.source.pin, first, second, build, 'claude');
const api = auditBmadBuild(current.bmad.source.pin, first, second, build, 'api');
const superpowersApi = await auditSuperpowersApi(
  current.superpowers.source.pin,
  await readFile(new URL('workflows/superpowers-6.4.2.tgz', fixtures)),
  current.superpowers.source.executables,
);
const { dependencies: _bytes, ...inputs } = build;
await writeFile(
  new URL('workflow-builder/real-projections.json', fixtures),
  JSON.stringify(
    {
      bmad: { claude: { ...claude, build: inputs }, api: { ...api, build: inputs } },
      superpowers: {
        api: superpowersApi,
        codex: await auditSuperpowersNative(
          current.superpowers.source.pin,
          await readFile(new URL('workflows/superpowers-6.4.2.tgz', fixtures)),
          current.superpowers.source.executables,
          hash(
            await readFile(
              new URL(
                '../../../../plans/261002-0002-crew-v2/execution-phase03/superpowers-codex-native-skills-evidence.json',
                import.meta.url,
              ),
            ),
          ),
        ),
      },
    },
    null,
    2,
  ),
);
await writeFile(
  new URL('workflow-builder/independent-builds.json', fixtures),
  JSON.stringify(
    {
      roots,
      canonicalManifestSha256: manifestHash(manifest(normalizeBmad(first))),
      entries: manifest(normalizeBmad(second)),
      receipts: await Promise.all(
        roots.map(async (root) =>
          JSON.parse(await readFile(join(root, 'receipts/real-bmad-build.json'), 'utf8')),
        ),
      ),
    },
    null,
    2,
  ),
);
console.log(claude.expected, api.expected, superpowersApi.expected);
