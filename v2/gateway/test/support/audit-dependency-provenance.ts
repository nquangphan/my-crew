import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const directory = new URL('../fixtures/workflow-builder/', import.meta.url);
const lock = await readFile(new URL('pnpm-lock.yaml', directory), 'utf8');
const packages = lock.split('\npackages:\n')[1].split('\nsnapshots:\n')[0];
const records = [];
for (const match of packages.matchAll(/^ {2}(.+):\n {4}resolution: \{integrity: ([^}]+)\}/gm)) {
  const key = match[1].replace(/^'|'$/g, '');
  const at = key.lastIndexOf('@');
  const name = key.slice(0, at),
    version = key.slice(at + 1),
    integrity = match[2];
  const metadataUrl = `https://registry.npmjs.org/${name}/${version}`;
  const metadataResponse = await fetch(metadataUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!metadataResponse.ok) throw new Error(`METADATA_STATUS_${metadataResponse.status}`);
  const metadataBytes = Buffer.from(await metadataResponse.arrayBuffer());
  if (metadataBytes.length > 1024 * 1024) throw new Error('METADATA_SIZE_LIMIT');
  const metadata = JSON.parse(metadataBytes.toString());
  const tarballUrl = `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`;
  if (
    metadata.name !== name ||
    metadata.version !== version ||
    metadata.dist.integrity !== integrity ||
    metadata.dist.tarball !== tarballUrl
  )
    throw new Error('DEPENDENCY_PROVENANCE_MISMATCH');
  const response = await fetch(tarballUrl, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !response.body) throw new Error('DEPENDENCY_DOWNLOAD_FAILED');
  const parts: Buffer[] = [];
  let bytes = 0;
  for await (const part of response.body) {
    bytes += part.length;
    if (bytes > 32 * 1024 * 1024) throw new Error('DEPENDENCY_SIZE_LIMIT');
    parts.push(Buffer.from(part));
  }
  const archive = Buffer.concat(parts);
  const measured = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
  if (measured !== integrity) throw new Error('DEPENDENCY_INTEGRITY_MISMATCH');
  records.push({
    name,
    version,
    metadataUrl,
    tarballUrl,
    integrity,
    archiveBytes: bytes,
    payloadSha256: createHash('sha256').update(archive).digest('hex'),
    metadataSha256: createHash('sha256').update(metadataBytes).digest('hex'),
  });
}
await writeFile(
  new URL('provenance.json', directory),
  JSON.stringify(
    {
      registry: 'https://registry.npmjs.org',
      redirects: 'error',
      timeoutMs: 10_000,
      maxArchiveBytes: 32 * 1024 * 1024,
      records,
    },
    null,
    2,
  ),
);
console.log('Verified primary exact metadata and tarball integrity:', records.length);
