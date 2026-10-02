import type { ProjectionPin, SourcePin } from '../host/status.ts';
import { canonicalJson, hash } from '../journal/atomic-records.ts';

export type { ProjectionPin, Runtime, SourcePin, Workflow } from '../host/status.ts';
export type AuditedDerivation = ProjectionPin['derivation'] & { officialEntrypoints: string[] };
export type ManifestEntry = {
  path: string;
  type: 'file' | 'dir' | 'symlink';
  mode: 0o644 | 0o755 | null;
  bytes: number;
  sha256: string;
  target?: string;
};
export type WorkflowManifest = { source: ManifestEntry[]; projection: ManifestEntry[] };
export const releases = {
  bmad: {
    version: '6.12.0',
    revision: '05bfbd46d00766ec88eb9b42e76be2c575d64d7b',
    repo: 'bmad-code-org/BMAD-METHOD',
  },
  superpowers: {
    version: '6.4.2',
    revision: '8ca22dba9a94f28898bbce59f2537ff4d87c747d',
    repo: 'obra/superpowers',
  },
} as const;
const digest = /^[0-9a-f]{64}$/;
export function exactObject(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Object.getPrototypeOf(v) !== Object.prototype ||
    Object.keys(v).sort().join(',') !== keys.sort().join(',')
  )
    throw new Error('INVALID_PIN');
}
export function officialSourceUrl(
  pin: Pick<SourcePin, 'name' | 'version' | 'sourceRevision'>,
  value: string,
): URL {
  const r = releases[pin.name];
  if (!r || pin.version !== r.version || pin.sourceRevision !== r.revision)
    throw new Error('UNAPPROVED_RELEASE');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('UNAPPROVED_URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash)
    throw new Error('UNAPPROVED_URL');
  const suffixes = [pin.sourceRevision, `refs/tags/v${pin.version}`];
  const paths =
    url.hostname === 'github.com'
      ? suffixes.map((x) => `/${r.repo}/archive/${x}.tar.gz`)
      : url.hostname === 'codeload.github.com'
        ? suffixes.map((x) => `/${r.repo}/tar.gz/${x}`)
        : [];
  if (pin.name === 'bmad' && url.hostname === 'registry.npmjs.org')
    paths.push(`/bmad-method/-/bmad-method-${pin.version}.tgz`);
  if (!paths.includes(url.pathname)) throw new Error('UNAPPROVED_URL');
  return url;
}
export function validateSourcePin(v: unknown): asserts v is SourcePin {
  exactObject(v, [
    'name',
    'version',
    'sourceRevision',
    'sourceUrl',
    'payloadSha256',
    'packageIntegrity',
    'sourceManifestSha256',
    'sourceTreeSha256',
  ]);
  if (
    !['bmad', 'superpowers'].includes(String(v.name)) ||
    typeof v.version !== 'string' ||
    typeof v.sourceRevision !== 'string' ||
    typeof v.sourceUrl !== 'string' ||
    ![v.payloadSha256, v.sourceManifestSha256, v.sourceTreeSha256].every(
      (x) => typeof x === 'string' && digest.test(x),
    )
  )
    throw new Error('INVALID_PIN');
  const pin = v as SourcePin;
  const url = officialSourceUrl(pin, pin.sourceUrl);
  if (
    pin.packageIntegrity !== null &&
    (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(pin.packageIntegrity) ||
      Buffer.from(pin.packageIntegrity.slice(7), 'base64').length !== 64)
  )
    throw new Error('INVALID_PIN');
  if ((url.hostname === 'registry.npmjs.org') !== (pin.packageIntegrity !== null))
    throw new Error('INVALID_PACKAGE_PROVENANCE');
  if (sourceTreeHash(pin) !== pin.sourceTreeSha256) throw new Error('CHECKSUM_MISMATCH');
}
export function validateProjectionPin(v: unknown): asserts v is ProjectionPin {
  exactObject(v, ['runtime', 'sourceTreeSha256', 'manifestSha256', 'treeSha256', 'derivation']);
  if (
    !['claude', 'codex', 'api'].includes(String(v.runtime)) ||
    ![v.sourceTreeSha256, v.manifestSha256, v.treeSha256].every(
      (x) => typeof x === 'string' && digest.test(x),
    )
  )
    throw new Error('INVALID_PIN');
  exactObject(v.derivation, ['tool', 'version', 'options', 'layoutSchema', 'policySha256']);
  const d = v.derivation;
  if (
    !['tool', 'version', 'layoutSchema'].every(
      (k) => typeof d[k] === 'string' && d[k] && String(d[k]).length < 200,
    ) ||
    !Array.isArray(d.options) ||
    !d.options.every((x) => typeof x === 'string' && x.length < 4096) ||
    typeof d.policySha256 !== 'string' ||
    !digest.test(d.policySha256)
  )
    throw new Error('INVALID_PIN');
  if (projectionTreeHash(v as ProjectionPin) !== v.treeSha256) throw new Error('CHECKSUM_MISMATCH');
}
export const sourceTreeHash = (
  p: Pick<SourcePin, 'sourceManifestSha256' | 'sourceRevision' | 'packageIntegrity' | 'payloadSha256'>,
) =>
  hash(
    canonicalJson({
      sourceManifestSha256: p.sourceManifestSha256,
      sourceRevision: p.sourceRevision,
      packageIntegrity: p.packageIntegrity,
      payloadSha256: p.payloadSha256,
    }),
  );
export const projectionTreeHash = (p: Omit<ProjectionPin, 'treeSha256'>) =>
  hash(
    canonicalJson({
      sourceTreeSha256: p.sourceTreeSha256,
      runtime: p.runtime,
      manifestSha256: p.manifestSha256,
      derivation: p.derivation,
    }),
  );
export const toDomainPin = (p: SourcePin) => ({
  workflow: p.name,
  version: p.version,
  revision: p.sourceRevision,
  checksum: p.sourceTreeSha256,
});
export const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
