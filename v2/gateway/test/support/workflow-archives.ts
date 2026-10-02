import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import type { ProjectionPin, Runtime, SourcePin } from '../../src/host/status.ts';
export type FixtureEntry = {
  path: string;
  body?: string;
  type?: 'file' | 'directory' | 'symlink';
  mode?: number;
  target?: string;
  mtime?: number;
  uid?: number;
};
export const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.entries(v)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(',')}}`;
  return JSON.stringify(v);
}
export async function archive(entries: FixtureEntry[]): Promise<Buffer> {
  const pack = tar.pack();
  const out: Buffer[] = [];
  const done = (async () => {
    for await (const b of pack) out.push(Buffer.from(b));
  })();
  for (const e of entries)
    await new Promise<void>((resolve, reject) =>
      pack.entry(
        {
          name: `package/${e.path}`,
          type: e.type ?? 'file',
          mode: e.mode ?? 0o644,
          linkname: e.target,
          mtime: new Date(e.mtime ?? 0),
          uid: e.uid ?? 0,
        },
        e.body ?? '',
        (err) => (err ? reject(err) : resolve()),
      ),
    );
  pack.finalize();
  await done;
  return gzipSync(Buffer.concat(out));
}
export const entries: FixtureEntry[] = [
  { path: 'skills', type: 'directory', mode: 0o755 },
  { path: 'skills/build', type: 'directory', mode: 0o755 },
  { path: 'skills/build/SKILL.md', body: '# Official fixture skill\n' },
  { path: 'render.sh', body: '#!/bin/sh\nprintf fixture\n', mode: 0o755 },
];
export async function fixture(name: 'bmad' | 'superpowers' = 'bmad', input = entries) {
  const bytes = await archive(input);
  const sourceEntries = input
    .map((e) => ({
      path: e.path.normalize('NFC'),
      type: e.type === 'directory' ? 'dir' : (e.type ?? 'file'),
      mode: e.type === 'symlink' ? null : e.type === 'directory' || e.path === 'render.sh' ? 0o755 : 0o644,
      bytes:
        e.type === 'directory'
          ? 0
          : Buffer.byteLength(e.type === 'symlink' ? (e.target ?? '') : (e.body ?? '')),
      sha256: sha(e.type === 'directory' ? '' : e.type === 'symlink' ? (e.target ?? '') : (e.body ?? '')),
      ...(e.type === 'symlink' ? { target: e.target } : {}),
    }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const sourceManifestSha256 = sha(canonical(sourceEntries));
  const base = {
    name,
    version: name === 'bmad' ? '6.12.0' : '6.4.2',
    sourceRevision:
      name === 'bmad'
        ? '05bfbd46d00766ec88eb9b42e76be2c575d64d7b'
        : '8ca22dba9a94f28898bbce59f2537ff4d87c747d',
    sourceUrl:
      name === 'bmad'
        ? 'https://registry.npmjs.org/bmad-method/-/bmad-method-6.12.0.tgz'
        : 'https://github.com/obra/superpowers/archive/8ca22dba9a94f28898bbce59f2537ff4d87c747d.tar.gz',
    payloadSha256: sha(bytes),
    packageIntegrity:
      name === 'bmad' ? `sha512-${createHash('sha512').update(bytes).digest('base64')}` : null,
    sourceManifestSha256,
  };
  const source: SourcePin = {
    ...base,
    sourceTreeSha256: sha(
      canonical({
        sourceManifestSha256,
        sourceRevision: base.sourceRevision,
        packageIntegrity: base.packageIntegrity,
        payloadSha256: base.payloadSha256,
      }),
    ),
  };
  return {
    source,
    bytes,
    entries: sourceEntries,
    executables: ['render.sh'],
    stream: () => Readable.from([bytes]),
  };
}
export function projection(_source: SourcePin, runtime: Runtime, options: string[] = []) {
  const recipe = {
    tool: 'synthetic-audited-copy',
    version: '1',
    options,
    layoutSchema: `fixture-${runtime}-v1`,
    policySha256: sha('fixture policy'),
    officialEntrypoints: ['skills/build/SKILL.md', 'render.sh'],
  };
  const mappings = [
    { from: 'skills', to: runtime === 'api' ? 'skills' : `.${runtime}/skills` },
    { from: 'render.sh', to: 'render.sh' },
  ];
  return { recipe, mappings };
}
export const validArchive = fixture;
export const badArchive = async () => archive([{ path: '../escape', body: 'bad' }]);
export const codexRecipe = projection;
export const oldPin = fixture;
export const badPin = async () => ({
  ...(await fixture()),
  source: { ...(await fixture()).source, payloadSha256: '0'.repeat(64) },
});
export function projectionAudit(
  f: Awaited<ReturnType<typeof fixture>>,
  runtime: Runtime,
  options: string[] = [],
) {
  const { recipe, mappings } = projection(f.source, runtime, options);
  const mapped = f.entries.map((e) => ({
    ...e,
    path: e.path.startsWith('skills')
      ? e.path.replace(/^skills/, runtime === 'api' ? 'skills' : `.${runtime}/skills`)
      : e.path,
  }));
  const parents = new Set<string>();
  for (const e of mapped) {
    const p = e.path.split('/');
    for (let i = 1; i < p.length; i++) parents.add(p.slice(0, i).join('/'));
  }
  for (const p of parents)
    if (!mapped.some((e) => e.path === p))
      mapped.push({ path: p, type: 'dir', mode: 0o755, bytes: 0, sha256: sha('') });
  mapped.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const derivation = {
    tool: recipe.tool,
    version: recipe.version,
    options: recipe.options,
    layoutSchema: recipe.layoutSchema,
    policySha256: recipe.policySha256,
  };
  const base = {
    runtime,
    sourceTreeSha256: f.source.sourceTreeSha256,
    manifestSha256: sha(canonical(mapped)),
    derivation,
  };
  const expected: ProjectionPin = { ...base, treeSha256: sha(canonical(base)) };
  return { sourceTreeSha256: f.source.sourceTreeSha256, runtime, recipe, expected, mappings };
}
