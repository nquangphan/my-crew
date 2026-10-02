import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import { hash } from '../../src/journal/atomic-records.ts';
import { parseArchive } from '../../src/workflows/stage.ts';

const directory = new URL('../fixtures/workflow-builder/', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('dependencies.json', directory), 'utf8'));
const ledger = JSON.parse(await readFile(new URL('provenance.json', directory), 'utf8'));
const payload = await readFile(new URL('dependencies.tgz', directory));
if (hash(payload) !== metadata.payloadSha256) throw new Error('BUNDLE_MISMATCH');
const files = await parseArchive(payload, metadata.executables);
const contents = new Map(files.filter((f) => f.type === 'file').map((f) => [f.path, f.body]));
const records = [];
for (const file of files.filter(
  (f) =>
    f.type === 'file' &&
    /^node_modules\/\.pnpm\/[^/]+\/node_modules\/(?:@[^/]+\/)?[^/]+\/package.json$/.test(f.path),
)) {
  const pkg = JSON.parse(file.body.toString());
  const origin = ledger.records.find(
    (r: { name: string; version: string }) => r.name === pkg.name && r.version === pkg.version,
  );
  if (!origin) throw new Error('UNPINNED_INSTALLED_PACKAGE');
  const response = await fetch(origin.tarballUrl, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !response.body) throw new Error('DOWNLOAD_FAILED');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new Error('ARCHIVE_LIMIT');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== origin.integrity)
    throw new Error('SRI_MISMATCH');
  const prefix = file.path.slice(0, -'package.json'.length);
  let verifiedFiles = 0,
    total = 0;
  const extract = tar.extract();
  const input = Readable.from(bytes).pipe(createGunzip()).pipe(extract);
  for await (const entry of extract) {
    const header = entry.header;
    if (header.type !== 'file') {
      entry.resume();
      continue;
    }
    const parts: Buffer[] = [];
    for await (const chunk of entry) {
      total += chunk.length;
      if (total > 128 * 1024 * 1024) throw new Error('EXPANSION_LIMIT');
      parts.push(Buffer.from(chunk));
    }
    const relative = header.name.split('/').slice(1).join('/');
    const actual = contents.get(prefix + relative);
    if (!actual || hash(actual) !== hash(Buffer.concat(parts)))
      throw new Error(`INSTALLED_FILE_MISMATCH:${pkg.name}:${relative}`);
    verifiedFiles++;
  }
  input.destroy();
  records.push({
    name: pkg.name,
    version: pkg.version,
    integrity: origin.integrity,
    verifiedFiles,
    packageRoot: prefix.slice(0, -1),
  });
}
await writeFile(
  new URL('verified-content.json', directory),
  JSON.stringify({ dependencyPayloadSha256: metadata.payloadSha256, records }, null, 2),
);
console.log(
  'Primary npm file bytes verified:',
  records.length,
  records.reduce((sum, r) => sum + r.verifiedFiles, 0),
);
