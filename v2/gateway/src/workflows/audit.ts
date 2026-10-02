import { createHash } from 'node:crypto';
import { canonicalJson, hash } from '../journal/atomic-records.ts';
import {
  officialSourceUrl,
  projectionTreeHash,
  type SourcePin,
  sourceTreeHash,
  validateSourcePin,
} from './pins.ts';
import type { ProjectionAudit, SourceAudit } from './registry.ts';
import { manifest, manifestHash, parseArchive, validateFiles } from './stage.ts';
export type SourceIdentity = Pick<
  SourcePin,
  'name' | 'version' | 'sourceRevision' | 'sourceUrl' | 'payloadSha256' | 'packageIntegrity'
>;
// Produces an audit candidate. The controller must review and preapprove these pins; it grants no runtime permission.
export async function buildSourceAudit(
  identity: SourceIdentity,
  bytes: Buffer,
  executables: string[],
): Promise<SourceAudit> {
  officialSourceUrl(identity, identity.sourceUrl);
  if (hash(bytes) !== identity.payloadSha256) throw new Error('CHECKSUM_MISMATCH');
  if (
    identity.packageIntegrity &&
    `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== identity.packageIntegrity
  )
    throw new Error('PACKAGE_INTEGRITY_MISMATCH');
  const files = await parseArchive(bytes, executables);
  const sourceManifestSha256 = manifestHash(manifest(files));
  const base = {
    name: identity.name,
    version: identity.version,
    sourceRevision: identity.sourceRevision,
    sourceUrl: identity.sourceUrl,
    payloadSha256: identity.payloadSha256,
    packageIntegrity: identity.packageIntegrity,
    sourceManifestSha256,
  };
  const pin = { ...base, sourceTreeSha256: sourceTreeHash(base) };
  validateSourcePin(pin);
  if (identity.name === 'bmad' && identity.packageIntegrity) {
    const pkg = files.find((f) => f.path === 'package.json' && f.type === 'file');
    if (!pkg) throw new Error('OFFICIAL_MANIFEST_MISSING');
    const metadata = JSON.parse(pkg.body.toString('utf8'));
    if (metadata.name !== 'bmad-method' || metadata.version !== identity.version)
      throw new Error('PACKAGE_MANIFEST_MISMATCH');
  }
  return { pin, executables: [...executables] };
}
export async function auditSuperpowersClaude(
  source: SourcePin,
  bytes: Buffer,
  executables: string[],
): Promise<ProjectionAudit> {
  validateSourcePin(source);
  if (source.name !== 'superpowers' || hash(bytes) !== source.payloadSha256)
    throw new Error('PROJECTION_UNAVAILABLE');
  const files = await parseArchive(bytes, executables);
  if (manifestHash(manifest(files)) !== source.sourceManifestSha256) throw new Error('CHECKSUM_MISMATCH');
  const plugin = files.find((f) => f.path === '.claude-plugin/plugin.json' && f.type === 'file');
  if (!plugin) throw new Error('OFFICIAL_MANIFEST_MISSING');
  const metadata = JSON.parse(plugin.body.toString('utf8'));
  if (metadata.name !== 'superpowers' || metadata.version !== source.version)
    throw new Error('PACKAGE_MANIFEST_MISMATCH');
  const policy = {
    runtime: 'claude',
    layout: '.claude-plugin/plugin.json+skills+hooks',
    sourceRevision: source.sourceRevision,
    network: 'adapter-controlled',
    isolationCertificate: null,
  };
  const recipe = {
    tool: 'crew-reviewed-official-layout-copy',
    version: '1',
    options: ['claude-plugin-dir'],
    layoutSchema: 'superpowers-claude-plugin-v1',
    policySha256: hash(canonicalJson(policy)),
    officialEntrypoints: [
      '.claude-plugin/plugin.json',
      'skills/using-superpowers/SKILL.md',
      'hooks/hooks.json',
      'hooks/session-start',
      'hooks/run-hook.cmd',
    ],
  };
  for (const path of recipe.officialEntrypoints)
    if (!files.some((f) => f.path === path && f.type === 'file'))
      throw new Error('OFFICIAL_ENTRYPOINT_MISSING');
  const mappings = ['.claude-plugin/plugin.json', 'skills', 'hooks'].map((from) => ({ from, to: from }));
  const projected = validateFiles(
    files
      .filter((f) => mappings.some((m) => f.path === m.from || f.path.startsWith(`${m.from}/`)))
      .map((f) => ({ ...f, body: Buffer.from(f.body) })),
  );
  const { officialEntrypoints: _e, ...derivation } = recipe;
  const base = {
    runtime: 'claude' as const,
    sourceTreeSha256: source.sourceTreeSha256,
    manifestSha256: manifestHash(manifest(projected)),
    derivation,
  };
  return {
    sourceTreeSha256: source.sourceTreeSha256,
    runtime: 'claude',
    recipe,
    expected: { ...base, treeSha256: projectionTreeHash(base) },
    mappings,
  };
}
